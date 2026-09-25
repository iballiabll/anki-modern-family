/**
 * 账号本地空间 + 云端进度同步。
 *
 * 这个文件必须放在每个页面所有脚本的最前面：它把 window.localStorage 换成
 * 一层「按当前账号命名空间」的包装，站点里原有的读写代码一行都不用改，
 * 数据就自动分账号存放了。
 *
 *   登录后：iball:v1:<accountId>:<原键>
 *   未登录 / 静态镜像：iball:v1:guest:<原键>
 *
 * 设计取舍：
 *   · 旧版全局数据不复制给任何账号。两个学生共用一台电脑时，谁都不会
 *     看到对方的收藏、错词和复习进度；
 *   · 每个键都带毫秒时间戳，换设备时由服务端按键比时间合并，手机和平板
 *     不会互相覆盖；
 *   · 删除用墓碑记录同步；写坏的、超大的值直接不往服务端送；
 *   · 服务端不可达时（GitHub 静态镜像、服务器挂了）所有读写照常落在本地，
 *     只是不参与同步，页面不会白屏。
 */
(function () {
  "use strict";

  const VALUE_PREFIX = "iball:v1:";
  const META_PREFIX = "iball:__meta__:";
  const ACCOUNT_KEY = "iball:__account__";
  const GUEST_NAMESPACE = "guest";
  const MAX_TOMBSTONES = 400;
  const MAX_ENTRY_BYTES = 256 * 1024;
  const MAX_ENTRIES = 400;
  const SYNC_DEBOUNCE_MS = 2500;
  const SYNC_RETRY_MS = 15000;
  const HEARTBEAT_MS = 60000;

  // ── 底层存储 ──────────────────────────────────────────────────────────
  // 优先用真的 localStorage；被隐私模式禁用时退回内存，功能照常只是不持久。
  let backing = null;
  try {
    const candidate = window.localStorage;
    const probe = "__iball_probe__";
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
    backing = candidate;
  } catch {
    backing = null;
  }

  const memory = new Map();
  const memoryStore = {
    get length() {
      return memory.size;
    },
    key(index) {
      return [...memory.keys()][index] ?? null;
    },
    getItem(key) {
      const id = String(key);
      return memory.has(id) ? memory.get(id) : null;
    },
    setItem(key, value) {
      memory.set(String(key), String(value));
    },
    removeItem(key) {
      memory.delete(String(key));
    },
    clear() {
      memory.clear();
    },
  };
  const store = backing || memoryStore;
  const persistent = Boolean(backing);

  function readRaw(key) {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      store.setItem(key, value);
      return true;
    } catch {
      // 配额满（QuotaExceeded）时会走到这里，静默失败好过让页面崩掉。
      return false;
    }
  }

  function removeRaw(key) {
    try {
      store.removeItem(key);
    } catch {
      // 同上，忽略。
    }
  }

  // 浏览器里没有 Buffer，用 TextEncoder 量字节数（和 node 端口径一致）。
  const encoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

  function byteLength(text) {
    if (encoder) {
      return encoder.encode(text).length;
    }
    return text.length;
  }

  // ── 命名空间元数据 ────────────────────────────────────────────────────
  // meta 里只放「哪些键存在 + 各自的时间戳」，值本身仍然是独立的存储项。
  function emptyMeta() {
    return { version: 1, keys: {}, tombstones: {} };
  }

  function metaKeyFor(namespace) {
    return `${META_PREFIX}${namespace}`;
  }

  function valueKeyFor(namespace, key) {
    return `${VALUE_PREFIX}${namespace}:${key}`;
  }

  function readMeta(namespace) {
    const rawValue = readRaw(metaKeyFor(namespace));
    if (!rawValue) {
      return emptyMeta();
    }
    try {
      const parsed = JSON.parse(rawValue);
      return {
        version: 1,
        keys: parsed?.keys && typeof parsed.keys === "object" ? parsed.keys : {},
        tombstones:
          parsed?.tombstones && typeof parsed.tombstones === "object"
            ? parsed.tombstones
            : {},
      };
    } catch {
      return emptyMeta();
    }
  }

  function writeMeta(namespace, meta) {
    writeRaw(metaKeyFor(namespace), JSON.stringify(meta));
  }

  function pruneTombstones(tombstones) {
    const entries = Object.entries(tombstones || {}).sort(
      (left, right) => Number(right[1]?.t || 0) - Number(left[1]?.t || 0),
    );
    return Object.fromEntries(entries.slice(0, MAX_TOMBSTONES));
  }

  // ── 当前命名空间 ──────────────────────────────────────────────────────
  let namespace = GUEST_NAMESPACE;
  let accountId = "";
  let meta = emptyMeta();

  function loadNamespace() {
    const saved = readRaw(ACCOUNT_KEY);
    namespace = saved && /^[A-Za-z0-9_-]{1,64}$/.test(saved) ? saved : GUEST_NAMESPACE;
    accountId = namespace === GUEST_NAMESPACE ? "" : namespace;
    meta = readMeta(namespace);
  }

  function persistNamespace() {
    writeRaw(ACCOUNT_KEY, namespace);
    writeMeta(namespace, meta);
  }

  const listeners = new Set();
  const writeListeners = new Set();

  function notifyNamespace() {
    for (const listener of listeners) {
      try {
        listener({ namespace, accountId });
      } catch (error) {
        console.error(error);
      }
    }
  }

  function notifyWrite(key, kind) {
    for (const listener of writeListeners) {
      try {
        listener({ key, kind, namespace });
      } catch (error) {
        console.error(error);
      }
    }
  }

  function ownerKeys() {
    return Object.keys(meta.keys);
  }

  function rawKeysInNamespace() {
    const prefix = `${VALUE_PREFIX}${namespace}:`;
    const keys = [];
    try {
      for (let index = 0; index < store.length; index += 1) {
        const rawKey = store.key(index);
        if (rawKey && rawKey.startsWith(prefix)) {
          keys.push(rawKey.slice(prefix.length));
        }
      }
    } catch {
      // 枚举失败时退回 meta 记录的那份键，至少能保证读写一致。
      return ownerKeys();
    }
    return keys;
  }

  function touch(key, time) {
    meta.keys[key] = { t: time };
    delete meta.tombstones[key];
  }

  function dropKeyToMakeRoom() {
    const keys = ownerKeys();
    if (keys.length < MAX_ENTRIES) {
      return;
    }
    const oldest = keys
      .map((key) => ({ key, t: Number(meta.keys[key]?.t || 0) }))
      .sort((left, right) => left.t - right.t)[0];
    if (!oldest) {
      return;
    }
    delete meta.keys[oldest.key];
    removeRaw(valueKeyFor(namespace, oldest.key));
  }

  // ── 公开的 localStorage 兼容层 ────────────────────────────────────────
  const localStorageBridge = {
    get length() {
      return rawKeysInNamespace().length;
    },
    key(index) {
      return rawKeysInNamespace()[index] ?? null;
    },
    getItem(key) {
      const id = String(key);
      if (!Object.prototype.hasOwnProperty.call(meta.keys, id)) {
        return null;
      }
      const value = readRaw(valueKeyFor(namespace, id));
      // 存储被外部清掉过时，顺手把悬空的 meta 记录也收拾干净。
      if (value === null) {
        delete meta.keys[id];
        persistNamespace();
        return null;
      }
      return value;
    },
    setItem(key, value) {
      const id = String(key);
      const text = String(value);
      if (byteLength(text) > MAX_ENTRY_BYTES) {
        console.warn(`[iball] 这条数据超过 256 KB，未保存：${id}`);
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(meta.keys, id)) {
        dropKeyToMakeRoom();
      }
      touch(id, Date.now());
      writeRaw(valueKeyFor(namespace, id), text);
      persistNamespace();
      notifyWrite(id, "set");
    },
    removeItem(key) {
      const id = String(key);
      const existed = Object.prototype.hasOwnProperty.call(meta.keys, id);
      delete meta.keys[id];
      removeRaw(valueKeyFor(namespace, id));
      meta.tombstones[id] = { t: Date.now() };
      meta.tombstones = pruneTombstones(meta.tombstones);
      persistNamespace();
      if (existed) {
        notifyWrite(id, "remove");
      }
    },
    clear() {
      for (const key of ownerKeys()) {
        removeRaw(valueKeyFor(namespace, key));
        meta.tombstones[key] = { t: Date.now() };
      }
      meta.keys = {};
      meta.tombstones = pruneTombstones(meta.tombstones);
      persistNamespace();
      for (const key of Object.keys(meta.tombstones)) {
        notifyWrite(key, "remove");
      }
    },
  };

  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        return localStorageBridge;
      },
    });
  } catch (error) {
    console.warn("[iball] 无法接管 localStorage，账号隔离已失效。", error);
  }

  // ── 快照：上传给服务端的那份数据 ──────────────────────────────────────
  function pickEntries(keys) {
    const entries = {};
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(meta.keys, key)) {
        continue;
      }
      const value = readRaw(valueKeyFor(namespace, key));
      if (value === null) {
        continue;
      }
      entries[key] = { v: value, t: Number(meta.keys[key]?.t || Date.now()) };
    }
    return entries;
  }

  function snapshot() {
    return {
      entries: pickEntries(ownerKeys()),
      tombstones: { ...meta.tombstones },
    };
  }

  /**
   * 把服务端合并后的结果写回本地。
   * 拿不准的时候以时间戳大的为准，避免把本地更新的内容冲掉。
   */
  function applySnapshot(incoming = {}) {
    let changed = 0;
    const entries =
      incoming.entries && typeof incoming.entries === "object"
        ? incoming.entries
        : {};
    const tombstones =
      incoming.tombstones && typeof incoming.tombstones === "object"
        ? incoming.tombstones
        : {};

    for (const [key, item] of Object.entries(entries)) {
      const incomingTime = Number(item?.t || 0);
      const currentTime = Number(meta.keys[key]?.t || 0);
      if (currentTime && currentTime >= incomingTime) {
        continue;
      }
      const value =
        typeof item?.v === "string" ? item.v : JSON.stringify(item?.v ?? null);
      if (value === null || value === undefined) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(meta.keys, key)) {
        dropKeyToMakeRoom();
      }
      meta.keys[key] = { t: incomingTime || Date.now() };
      delete meta.tombstones[key];
      writeRaw(valueKeyFor(namespace, key), value);
      changed += 1;
    }

    for (const [key, item] of Object.entries(tombstones)) {
      const incomingTime = Number(item?.t || 0);
      const currentTime = Number(meta.keys[key]?.t || 0);
      if (currentTime > incomingTime) {
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(meta.keys, key)) {
        delete meta.keys[key];
        removeRaw(valueKeyFor(namespace, key));
        changed += 1;
      }
      meta.tombstones[key] = { t: incomingTime || Date.now() };
    }

    meta.tombstones = pruneTombstones(meta.tombstones);
    persistNamespace();
    return changed;
  }

  // ── 云端同步 ──────────────────────────────────────────────────────────
  const sync = {
    enabled: false,
    reason: "",
    state: "idle", // idle | pending | syncing | error | off
    lastSyncedAt: "",
    lastError: "",
    dirty: new Set(),
    dirtyTombstones: new Set(),
    epoch: 0,
    timer: null,
    inflight: false,
    listeners: new Set(),
  };

  function syncStatus() {
    return {
      enabled: sync.enabled,
      state: sync.state,
      reason: sync.reason,
      lastSyncedAt: sync.lastSyncedAt,
      lastError: sync.lastError,
      pending: sync.dirty.size + sync.dirtyTombstones.size,
    };
  }

  function notifySync() {
    const status = syncStatus();
    for (const listener of sync.listeners) {
      try {
        listener(status);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function scheduleSync(delay = SYNC_DEBOUNCE_MS) {
    if (!sync.enabled) {
      return;
    }
    sync.state = "pending";
    notifySync();
    if (sync.timer) {
      clearTimeout(sync.timer);
    }
    sync.timer = setTimeout(() => {
      sync.timer = null;
      runSync().catch(() => {});
    }, delay);
  }

  function trackWrite({ key, kind }) {
    if (!sync.enabled) {
      return;
    }
    sync.epoch += 1;
    if (kind === "remove") {
      sync.dirty.delete(key);
      sync.dirtyTombstones.add(key);
    } else {
      sync.dirtyTombstones.delete(key);
      sync.dirty.add(key);
    }
    scheduleSync();
  }

  async function postProgress(body, keepalive) {
    const response = await fetch("./api/progress", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: Boolean(keepalive),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || `同步失败（${response.status}）`);
    }
    return data;
  }

  async function runSync({ full = false, keepalive = false } = {}) {
    if (!sync.enabled || sync.inflight) {
      return null;
    }
    const keys = full ? ownerKeys() : [...sync.dirty];
    const tombKeys = full ? Object.keys(meta.tombstones) : [...sync.dirtyTombstones];
    if (!full && keys.length === 0 && tombKeys.length === 0) {
      sync.state = "idle";
      notifySync();
      return null;
    }

    const epoch = sync.epoch;
    const entries = pickEntries(keys);
    const tombstones = {};
    for (const key of tombKeys) {
      if (meta.tombstones[key]) {
        tombstones[key] = meta.tombstones[key];
      }
    }

    sync.inflight = true;
    sync.state = "syncing";
    notifySync();

    try {
      const data = await postProgress({ entries, tombstones }, keepalive);
      // 请求期间又写过东西的话，保留这些脏键等下一轮再传。
      if (sync.epoch === epoch) {
        sync.dirty.clear();
        sync.dirtyTombstones.clear();
        if (data.entries || data.tombstones) {
          applySnapshot({ entries: data.entries, tombstones: data.tombstones });
        }
      } else {
        for (const key of Object.keys(entries)) {
          sync.dirty.delete(key);
        }
        for (const key of Object.keys(tombstones)) {
          sync.dirtyTombstones.delete(key);
        }
        applySnapshot({ entries: data.entries, tombstones: data.tombstones });
      }
      sync.state = "idle";
      sync.lastError = "";
      sync.lastSyncedAt = new Date().toISOString();
      if (sync.dirty.size || sync.dirtyTombstones.size) {
        scheduleSync(SYNC_DEBOUNCE_MS);
      }
      return data;
    } catch (error) {
      sync.state = "error";
      sync.lastError = error?.message || "同步失败";
      scheduleSync(SYNC_RETRY_MS);
      return null;
    } finally {
      sync.inflight = false;
      notifySync();
    }
  }

  /**
   * 登录完成后调用：先把本地这份推上去（第一次用全量），
   * 服务端按时间戳合并，再把合并结果回写到本地。
   */
  async function enableSync() {
    if (!persistent) {
      sync.reason = "浏览器不允许本地存储，进度只保留在内存里。";
      sync.enabled = false;
      sync.state = "off";
      notifySync();
      return null;
    }
    sync.enabled = true;
    sync.reason = "";
    sync.dirty = new Set(ownerKeys());
    sync.dirtyTombstones = new Set(Object.keys(meta.tombstones));
    const result = await runSync({ full: true });
    if (!result) {
      sync.state = "error";
      notifySync();
    }
    return result;
  }

  function disableSync(reason = "") {
    sync.enabled = false;
    sync.state = "off";
    sync.reason = reason;
    sync.dirty.clear();
    sync.dirtyTombstones.clear();
    if (sync.timer) {
      clearTimeout(sync.timer);
      sync.timer = null;
    }
    notifySync();
  }

  function flushSync() {
    if (!sync.enabled) {
      return Promise.resolve(null);
    }
    if (sync.timer) {
      clearTimeout(sync.timer);
      sync.timer = null;
    }
    return runSync({ keepalive: true });
  }

  /**
   * 切换账号命名空间。返回 true 表示确实换了人，调用方需要重新读取本地状态。
   */
  function activate(nextAccountId) {
    const clean = String(nextAccountId || "").replace(/[^A-Za-z0-9_-]/g, "");
    const next = clean || GUEST_NAMESPACE;
    if (next === namespace) {
      return false;
    }
    if (sync.enabled && (sync.dirty.size || sync.dirtyTombstones.size)) {
      // 换人之前尽量把这轮改动送出去，送不掉也不会串到下一个账号。
      flushSync().catch(() => {});
    }
    namespace = next;
    accountId = next === GUEST_NAMESPACE ? "" : next;
    meta = readMeta(namespace);
    persistNamespace();
    notifyNamespace();
    return true;
  }

  // ── 页面心跳：管理台的「实时」靠这个 ──────────────────────────────────
  let heartbeatTimer = null;

  async function beat() {
    if (!sync.enabled) {
      return null;
    }
    try {
      const response = await fetch("./api/telemetry", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page: window.location.pathname || "/",
          title: document.title || "",
        }),
      });
      return await response.json().catch(() => null);
    } catch {
      return null;
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) {
      return;
    }
    beat().catch(() => {});
    heartbeatTimer = setInterval(() => beat().catch(() => {}), HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  // ── 收尾：离开页面前把没同步的内容送出去 ──────────────────────────────
  writeListeners.add(trackWrite);
  window.addEventListener("pagehide", () => {
    flushSync().catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushSync().catch(() => {});
    } else {
      beat().catch(() => {});
    }
  });

  loadNamespace();
  persistNamespace();

  window.iballAccounts = {
    GUEST_NAMESPACE,
    activate,
    accountId() {
      return accountId;
    },
    namespace() {
      return namespace;
    },
    isGuest() {
      return namespace === GUEST_NAMESPACE;
    },
    persistent,
    snapshot,
    applySnapshot,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    rawStore: store,
  };

  window.iballProgress = {
    disableSync,
    enableSync,
    flushSync,
    runSync,
    snapshot,
    startHeartbeat,
    stopHeartbeat,
    status: syncStatus,
    onStatus(listener) {
      sync.listeners.add(listener);
      listener(syncStatus());
      return () => sync.listeners.delete(listener);
    },
  };
})();
