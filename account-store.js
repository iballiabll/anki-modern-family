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
  const OWNER_NAMESPACE_PREFIX = "owner-";
  const VALUE_KEY_PATTERN = /^iball:v1:([A-Za-z0-9_-]{1,64}):([\s\S]+)$/;
  const MAX_TOMBSTONES = 400;
  const MAX_ENTRY_BYTES = 256 * 1024;
  const MAX_ENTRIES = 400;
  const SYNC_DEBOUNCE_MS = 2500;
  const SYNC_RETRY_MS = 15000;
  const HEARTBEAT_MS = 60000;

  // 收藏、生词本这类「清单」型键：值是一个数组，语义是集合而不是快照。
  // 如果按整键时间戳后写覆盖，手机离线加的单词会被平板稍后上传的旧清单
  // 冲掉。这里登记这些键，同步时改成并集合并 + 本机删除墓碑。
  const LIST_MERGE_KEYS = new Map([
    ["iball_vocab_favorites_v1", (item) => String(item ?? "")],
    ["iball-listening-cabin-favorites", (item) => String(item ?? "")],
    ["iball-listening-cabin-known", (item) => String(item ?? "")],
    ["iball-listening-cabin-unknown", (item) => String(item ?? "")],
    [
      "iball_vocab_wordbook_v1",
      (item) =>
        Array.isArray(item)
          ? String(item[0] ?? "")
          : String(item?.word ?? ""),
    ],
    [
      "iball_vocab_library_v1",
      (item) =>
        Array.isArray(item)
          ? String(item[0] ?? "")
          : String(item?.word ?? ""),
    ],
    // 我的词书：一本书一条，按 id 并集合并（另一台设备建的词书不会丢）。
    [
      "iball_vocab_userbooks_v1",
      (item) =>
        Array.isArray(item)
          ? String(item[0] ?? "")
          : String(item?.id ?? ""),
    ],
    // 词书逐词进度：一条记录一个 deck+word，两端各背几个词时不会互相覆盖。
    [
      "iball_vocab_userbook_progress_v1",
      (item) =>
        item && typeof item === "object"
          ? `${String(item.deck || "")}::${String(item.word || "").toLowerCase()}`
          : Array.isArray(item)
            ? String(item[0] ?? "")
            : "",
    ],
  ]);
  const MAX_LIST_REMOVALS = 300;
  const LIST_REMOVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  // 接口地址跟着本文件的位置走，而不是当前页面：子目录里的页面
  // 用 ../account-store.js 引入时，"api/progress" 仍然指向站点根目录。
  const API_BASE = (() => {
    const src = document.currentScript?.src || "";
    if (src) {
      try {
        return new URL(".", src).href;
      } catch {
        // 下面还有兜底。
      }
    }
    return new URL("./", window.location.href).href;
  })();

  function apiUrl(path) {
    return `${API_BASE}${path}`;
  }

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
    return { version: 1, keys: {}, tombstones: {}, removed: {}, added: {} };
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
        removed:
          parsed?.removed && typeof parsed.removed === "object"
            ? parsed.removed
            : {},
        added:
          parsed?.added && typeof parsed.added === "object"
            ? parsed.added
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

  // ── 清单型键的并集合并 ────────────────────────────────────────────────
  function parseListValue(text) {
    if (typeof text !== "string" || !text) {
      return null;
    }
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function pruneListRemovals(removals) {
    const now = Date.now();
    const entries = Object.entries(removals || {})
      .filter(([, time]) => now - Number(time || 0) < LIST_REMOVAL_TTL_MS)
      .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0));
    return Object.fromEntries(entries.slice(0, MAX_LIST_REMOVALS));
  }

  /**
   * 本机把一个清单键写成新数组时，记下每个词条的「加入时间」与「删除时间」。
   *
   * 删除时间会跟着进度同步上服务端：另一台设备拿着旧清单来同步时，靠它
   * 判断「这个词是对方删掉的，不该被并集带回来」。加入时间用于区分
   * 「对方删掉之后我又手动收藏」（应保留）和「我这台只是没收到删除通知」
   * （应按删除处理）。
   */
  function trackListDelta(key, previousText, nextText) {
    const identify = LIST_MERGE_KEYS.get(key);
    if (!identify) {
      return;
    }
    const before = parseListValue(previousText);
    const after = parseListValue(nextText);
    if (!before || !after) {
      return;
    }
    const previousTime = Number(meta.keys[key]?.t || 0) || Date.now();
    const now = Date.now();
    const beforeIds = new Set(before.map(identify).filter(Boolean));
    const afterIds = new Set(after.map(identify).filter(Boolean));
    const removals = meta.removed[key] || {};
    const additions = meta.added[key] || {};
    for (const id of afterIds) {
      if (!beforeIds.has(id) || !additions[id]) {
        // 新收藏用当前时间；本来就有的条目没有记录时，保守地沿用
        // 上一次整键写入时间，避免把旧条目伪装成刚收藏。
        additions[id] = beforeIds.has(id) ? previousTime : now;
      }
      delete removals[id];
    }
    for (const id of beforeIds) {
      if (!afterIds.has(id)) {
        removals[id] = now;
        delete additions[id];
      }
    }
    meta.removed[key] = pruneListRemovals(removals);
    meta.added[key] = additions;
  }

  /**
   * 把本机清单和远端清单并起来，逐个词条判断「加入」还是「删除」更新：
   *   · 这一条同时出现在某份清单里，且那份清单的时间戳晚于删除时间
   *     —— 说明删掉之后有人重新收藏过，以加入为准；
   *   · 否则删除记录赢，并集不会把删掉的词带回来。
   * 返回 null 表示这份数据不是清单格式，调用方退回整键时间戳比较。
   */
  function mergeListValue(key, localText, remoteText, remoteTime) {
    const identify = LIST_MERGE_KEYS.get(key);
    if (!identify) {
      return null;
    }
    const local = parseListValue(localText);
    const remote = parseListValue(remoteText);
    if (!local || !remote) {
      return null;
    }
    const localTime = Number(meta.keys[key]?.t || 0);
    const removals = meta.removed[key] || {};
    const additions = meta.added[key] || {};
    const ordered = [];
    const byId = new Map();
    const localIds = new Set();
    const remoteIds = new Set();
    const push = (items, source) => {
      const ids = source === "remote" ? remoteIds : localIds;
      for (const item of items) {
        const id = identify(item);
        if (!id) {
          continue;
        }
        ids.add(id);
        if (!byId.has(id)) {
          ordered.push(id);
          byId.set(id, item);
        } else if (source === "remote") {
          byId.set(id, item);
        }
      }
    };
    push(local, "local");
    push(remote, "remote");
    const merged = [];
    for (const id of ordered) {
      const removedAt = Number(removals[id] || 0);
      const presenceTime = Math.max(
        localIds.has(id) ? Number(additions[id] || localTime || 0) : 0,
        remoteIds.has(id) ? Number(remoteTime || 0) : 0,
      );
      if (removedAt && presenceTime <= removedAt) {
        // 删除发生在任何一次已知的「在场」之后：以删除为准。
        delete additions[id];
        continue;
      }
      if (removedAt) {
        delete removals[id];
      }
      additions[id] = Math.max(Number(additions[id] || 0), presenceTime);
      merged.push(byId.get(id));
    }
    meta.removed[key] = pruneListRemovals(removals);
    meta.added[key] = additions;
    return { text: JSON.stringify(merged), merged };
  }

  /**
   * 同步用的「删除记录」清单：只挑还年轻的记录，避免把服务端撑大。
   */
  function activeRemovals() {
    const result = {};
    for (const [key, items] of Object.entries(meta.removed)) {
      const pruned = pruneListRemovals(items);
      meta.removed[key] = pruned;
      if (Object.keys(pruned).length) {
        result[key] = pruned;
      }
    }
    return result;
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
      const previous =
        Object.prototype.hasOwnProperty.call(meta.keys, id) &&
        LIST_MERGE_KEYS.has(id)
          ? readRaw(valueKeyFor(namespace, id))
          : null;
      if (previous !== null) {
        trackListDelta(id, previous, text);
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
        delete meta.removed[key];
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
      removed: activeRemovals(),
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
    const removed =
      incoming.removed && typeof incoming.removed === "object"
        ? incoming.removed
        : {};

    // 先把对方带过来的删除记录并进来，下面合并清单时才知道哪些词
    // 是被别的设备删掉的。逐词条取较新的删除时间。
    for (const [key, items] of Object.entries(removed)) {
      if (!items || typeof items !== "object") {
        continue;
      }
      const target = meta.removed[key] || (meta.removed[key] = {});
      for (const [rawId, time] of Object.entries(items)) {
        const id = String(rawId);
        const value = Number(time || 0);
        if (!id || !value) {
          continue;
        }
        if (Number(target[id] || 0) < value) {
          target[id] = value;
        }
      }
      meta.removed[key] = pruneListRemovals(target);
    }

    for (const [key, item] of Object.entries(entries)) {
      const incomingTime = Number(item?.t || 0);
      const currentTime = Number(meta.keys[key]?.t || 0);
      const value =
        typeof item?.v === "string" ? item.v : JSON.stringify(item?.v ?? null);
      if (value === null || value === undefined) {
        continue;
      }
      // 清单型键：先并集再落盘，另一台设备的旧清单不会冲掉本机离线新增。
      if (LIST_MERGE_KEYS.has(key)) {
        const localText = readRaw(valueKeyFor(namespace, key));
        const merged =
          localText === null
            ? null
            : mergeListValue(key, localText, value, incomingTime);
        if (merged) {
          if (merged.text === localText) {
            if (incomingTime > currentTime) {
              meta.keys[key] = { t: incomingTime };
            }
            continue;
          }
          meta.keys[key] = { t: Date.now() };
          delete meta.tombstones[key];
          writeRaw(valueKeyFor(namespace, key), merged.text);
          changed += 1;
          if (sync.enabled) {
            // 并集结果还要推回服务端，另一台设备才能拿到同一条。
            sync.dirty.add(key);
          }
          continue;
        }
      }
      if (currentTime && currentTime >= incomingTime) {
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
    const response = await fetch(apiUrl("api/progress"), {
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
      // 删除记录体积很小，每轮都全量带上：服务端负责按词条取较新的时间，
      // 另一台设备才能知道「这个词是对面删的」，而不是靠自己猜。
      const data = await postProgress(
        { entries, tombstones, removed: activeRemovals() },
        keepalive,
      );
      // 请求期间又写过东西的话，保留这些脏键等下一轮再传。
      if (sync.epoch === epoch) {
        sync.dirty.clear();
        sync.dirtyTombstones.clear();
        if (data.entries || data.tombstones || data.removed) {
          applySnapshot({
            entries: data.entries,
            tombstones: data.tombstones,
            removed: data.removed,
          });
        }
      } else {
        for (const key of Object.keys(entries)) {
          sync.dirty.delete(key);
        }
        for (const key of Object.keys(tombstones)) {
          sync.dirtyTombstones.delete(key);
        }
        applySnapshot({
          entries: data.entries,
          tombstones: data.tombstones,
          removed: data.removed,
        });
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
   * 把旧站长命名空间（owner-*）里的本地数据并进当前账号。
   *
   * 9 月底用户库故障期间，部分设备拿到的是无状态站长会话，进度写进了
   * owner-<名字> 空间；会话恢复正常后，这些只落本地、还没上传过的数据
   * （尤其是收藏）必须跟着账号走。只认 owner-* → 普通账号这一个方向：
   * guest 空间不动，共用设备上别人的浏览数据不会被并进登录账号。
   */
  function importOwnerData() {
    if (
      namespace === GUEST_NAMESPACE ||
      namespace.startsWith(OWNER_NAMESPACE_PREFIX)
    ) {
      return 0;
    }
    const rawKeys = [];
    try {
      for (let index = 0; index < store.length; index += 1) {
        rawKeys.push(store.key(index));
      }
    } catch {
      return 0;
    }

    let changed = 0;
    const seen = new Set();
    for (const rawKey of rawKeys) {
      const match = rawKey ? VALUE_KEY_PATTERN.exec(rawKey) : null;
      if (!match) {
        continue;
      }
      const sourceNamespace = match[1];
      const sourceKey = match[2];
      if (!sourceNamespace.startsWith(OWNER_NAMESPACE_PREFIX)) {
        continue;
      }
      const dedupe = `${sourceNamespace}:${sourceKey}`;
      if (seen.has(dedupe)) {
        continue;
      }
      seen.add(dedupe);
      const sourceTime = Number(
        readMeta(sourceNamespace).keys?.[sourceKey]?.t || 0,
      );
      if (!sourceTime) {
        continue;
      }
      const currentTime = Math.max(
        Number(meta.keys[sourceKey]?.t || 0),
        Number(meta.tombstones[sourceKey]?.t || 0),
      );
      if (currentTime >= sourceTime) {
        continue;
      }
      const value = readRaw(rawKey);
      if (value === null) {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(meta.keys, sourceKey)) {
        dropKeyToMakeRoom();
      }
      if (!writeRaw(valueKeyFor(namespace, sourceKey), value)) {
        continue;
      }
      meta.keys[sourceKey] = { t: sourceTime };
      delete meta.tombstones[sourceKey];
      changed += 1;
    }
    return changed;
  }

  /**
   * 切换账号命名空间。返回 true 表示确实换了人，调用方需要重新读取本地状态。
   */
  function activate(nextAccountId) {
    const clean = String(nextAccountId || "").replace(/[^A-Za-z0-9_-]/g, "");
    const next = clean || GUEST_NAMESPACE;
    if (next === namespace) {
      // 已经在同一个账号上：顺手补一次旧站长数据的合并，部署后第一次
      // 加载、以及会话收敛后的设备都靠这里把 owner-* 的存量捞过来。
      if (importOwnerData() > 0) {
        persistNamespace();
        notifyNamespace();
        return true;
      }
      return false;
    }
    if (sync.enabled && (sync.dirty.size || sync.dirtyTombstones.size)) {
      // 换人之前尽量把这轮改动送出去，送不掉也不会串到下一个账号。
      flushSync().catch(() => {});
    }
    namespace = next;
    accountId = next === GUEST_NAMESPACE ? "" : next;
    meta = readMeta(namespace);
    importOwnerData();
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
      const response = await fetch(apiUrl("api/telemetry"), {
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

  /**
   * 心跳只在页面处于前台时跑：后台标签页不算在线，
   * 管理台的「在线时长」因此贴近真实使用时间，而不是挂着网页的时间。
   */
  function startHeartbeat() {
    if (heartbeatTimer || document.hidden) {
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
      stopHeartbeat();
      flushSync().catch(() => {});
    } else {
      startHeartbeat();
    }
  });

  loadNamespace();
  persistNamespace();

  // ── 会话引导：每个页面都把命名空间对齐服务端会话，并接入同步 ────────────
  // 以前只有 index.html 的 app.js 会激活账号，词汇库、听力等独立页面既不
  // 激活也不开同步，收藏只落在设备本地，别的设备看不到。这里补齐这条链路：
  // 页面加载时问一次服务端「我是谁」，命名空间真的变了就刷新一次让页面脚本
  // 用新空间重新读数；未登录时留在 guest，不发同步请求。
  const BOOT_RELOAD_FLAG = "iball:namespace-reload";

  function bootReloadOnce() {
    let alreadyReloaded = true;
    try {
      alreadyReloaded =
        sessionStorage.getItem(BOOT_RELOAD_FLAG) === "1";
    } catch {
      // 读写不了 sessionStorage（隐私模式）时干脆不刷新，避免来回跳。
    }
    if (!alreadyReloaded) {
      try {
        sessionStorage.setItem(BOOT_RELOAD_FLAG, "1");
      } catch {
        // 忽略，上面的判断已经保证不会再刷。
      }
      window.location.reload();
      return true;
    }
    try {
      sessionStorage.removeItem(BOOT_RELOAD_FLAG);
    } catch {
      // 同上。
    }
    return false;
  }

  async function bootSession() {
    if (!persistent) {
      return;
    }
    let payload = null;
    try {
      const response = await fetch(apiUrl("api/auth"), {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return;
      }
      payload = await response.json();
    } catch {
      // 网络不通（静态镜像、服务端故障）：保持当前命名空间，功能照常。
      return;
    }

    const nextAccountId =
      payload?.authenticated && payload?.account?.id
        ? String(payload.account.id)
        : "";
    if (!nextAccountId && namespace === GUEST_NAMESPACE) {
      return;
    }

    const before = namespace;
    const changed = activate(nextAccountId);
    if ((changed || namespace !== before) && bootReloadOnce()) {
      return;
    }
    if (!nextAccountId) {
      // 登出：命名空间已经切回 guest，这一轮不用同步。
      return;
    }
    enableSync().catch(() => {});
    startHeartbeat();
  }

  bootSession().catch(() => {});

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
