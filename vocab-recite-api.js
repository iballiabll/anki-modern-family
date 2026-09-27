/**
 * 背词记录接口 v1（window.IballVocabRecite）。
 *
 * 供词汇库页面、封神之路（xxrj/）等同一站点内的页面读写“这个词我背过没有”：
 *   getSnapshot()                   整份快照 { version, updatedAt, records, history }
 *   getRecords(deck?)               记录数组，可按词库过滤
 *   getRecord(deck, word)           单条记录或 null
 *   summary(deck?)                  各状态计数，用于进度条
 *   daily(deck?, { days })          每日学习情况：今日新学 / 复习、连续天数、近 N 天
 *   record({ deck, word, status })  记一次（已会（斩）/ 模糊 / 不认识）
 *   remove(deck, word)              删除一条
 *   clear(deck?)                    清空某个词库或全部
 *   exportJson() / importJson()     备份与合并导入
 *   subscribe(listener)             订阅变更，返回取消订阅函数
 *
 * 存储：localStorage 键 iball_vocab_recite_v1，必须在本脚本之前引入
 * account-store.js —— 它会按账号隔离键名，并在登录状态下把变更同步到
 * ./api/progress（POST 合并），所以同一账号在其他设备也能读到这批记录。
 * 未登录或静态镜像下写入的仍是同一个键，只是不跨设备同步。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "iball_vocab_recite_v1";
  const HISTORY_LIMIT = 500;
  // known 就是词卡上的「斩」：这个词已经会了，之后不再进每日任务。
  const STATUSES = { known: "已会", fuzzy: "模糊", unknown: "不认识" };
  const STATUS_BADGES = { known: "已斩", fuzzy: "模糊", unknown: "不认识" };
  const STATUS_KEYS = Object.keys(STATUSES);

  const listeners = new Set();
  let memory = null;
  let memoryRaw = null;

  function emptyState() {
    return { version: 1, updatedAt: "", records: {}, history: [] };
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function recordId(deck, word) {
    return `${deck || "unknown"}::${normalizeKey(word)}`;
  }

  function sanitizeState(raw) {
    const state = emptyState();
    if (!raw || typeof raw !== "object") {
      return state;
    }
    state.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
    if (raw.records && typeof raw.records === "object") {
      for (const [id, value] of Object.entries(raw.records)) {
        if (!value || typeof value !== "object" || !value.word) {
          continue;
        }
        const status = STATUS_KEYS.includes(value.status) ? value.status : "fuzzy";
        state.records[id] = {
          deck: String(value.deck || "unknown"),
          word: String(value.word),
          status,
          reviews: Number(value.reviews) || 1,
          firstAt: value.firstAt || value.lastAt || "",
          lastAt: value.lastAt || value.firstAt || "",
          source: value.source ? String(value.source) : "",
        };
      }
    }
    if (Array.isArray(raw.history)) {
      state.history = raw.history
        .filter((item) => item && item.word && STATUS_KEYS.includes(item.status))
        .slice(-HISTORY_LIMIT);
    }
    return state;
  }

  /**
   * 每次读都比对一遍底层的原始字符串：换账号、云端回写、另一个标签页
   * 写入之后这里都会自然失效，不会拿着旧账号的缓存算每日进度。
   */
  function readState() {
    let text = null;
    try {
      text = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      text = null;
    }
    if (memory && text === memoryRaw) {
      return memory;
    }
    memoryRaw = text;
    let raw = null;
    try {
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    memory = sanitizeState(raw);
    return memory;
  }

  function writeState(state) {
    memory = state;
    memoryRaw = JSON.stringify(state);
    try {
      window.localStorage.setItem(STORAGE_KEY, memoryRaw);
    } catch {
      // 隐私模式或配额不足时保留内存副本，页面功能照常。
    }
  }

  function emit() {
    const snapshot = getSnapshot();
    for (const listener of [...listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn("[iball] 背词记录订阅回调出错", error);
      }
    }
    try {
      window.dispatchEvent(
        new CustomEvent("iball:vocab-recite", { detail: snapshot }),
      );
    } catch {
      // 老浏览器不支持 CustomEvent 时忽略。
    }
  }

  function getSnapshot() {
    const state = readState();
    return {
      version: state.version,
      updatedAt: state.updatedAt,
      records: Object.values(state.records).map((item) => ({ ...item })),
      history: state.history.map((item) => ({ ...item })),
    };
  }

  function getRecords(deck) {
    const state = readState();
    return Object.values(state.records)
      .filter((item) => !deck || item.deck === deck)
      .map((item) => ({ ...item }));
  }

  function getRecord(deck, word) {
    const state = readState();
    const item = state.records[recordId(deck, word)];
    return item ? { ...item } : null;
  }

  function summary(deck) {
    const totals = { total: 0, known: 0, fuzzy: 0, unknown: 0, reviews: 0 };
    for (const item of Object.values(readState().records)) {
      if (deck && item.deck !== deck) {
        continue;
      }
      totals.total += 1;
      totals.reviews += item.reviews || 0;
      if (totals[item.status] !== undefined) {
        totals[item.status] += 1;
      }
    }
    return totals;
  }

  function localDayKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function shiftDay(date, offset) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  }

  /**
   * 每日学习情况。封神之路的「恋练有词」面板直接吃这一份，不用自己数历史。
   *
   * 口径：
   *   · 新学 = 某个词的 firstAt 落在今天；
   *   · 复习 = 今天记的次数减去今天新学的词数（同一天反复记只算一次新学）；
   *   · 连续天数 = 从今天（今天没记就从昨天）往前数的连续有记录日；
   *   · history 只留最近 500 条，所以日期集合额外用记录的 firstAt / lastAt 兜底。
   */
  function daily(deck, options = {}) {
    const state = readState();
    const dayCount = Math.min(Math.max(Number(options.days) || 7, 1), 31);
    const now = options.now ? new Date(options.now) : new Date();
    const today = Number.isNaN(now.getTime()) ? new Date() : now;
    const deckId = deck ? String(deck) : "";

    const records = Object.values(state.records).filter(
      (item) => !deckId || item.deck === deckId,
    );
    const history = state.history.filter((item) => !deckId || item.deck === deckId);

    const perDay = new Map();
    const activeDays = new Set();

    function bucketFor(dayKey) {
      let bucket = perDay.get(dayKey);
      if (!bucket) {
        bucket = { total: 0, known: 0, fuzzy: 0, unknown: 0 };
        perDay.set(dayKey, bucket);
      }
      return bucket;
    }

    for (const item of history) {
      const dayKey = localDayKey(item.at);
      if (!dayKey) {
        continue;
      }
      const bucket = bucketFor(dayKey);
      bucket.total += 1;
      if (bucket[item.status] !== undefined) {
        bucket[item.status] += 1;
      }
      activeDays.add(dayKey);
    }
    for (const item of records) {
      for (const stamp of [item.firstAt, item.lastAt]) {
        const dayKey = localDayKey(stamp);
        if (dayKey) {
          activeDays.add(dayKey);
        }
      }
    }

    const todayKey = localDayKey(today);
    const todayBucket = perDay.get(todayKey) || {
      total: 0,
      known: 0,
      fuzzy: 0,
      unknown: 0,
    };
    const newWordsToday = records.filter(
      (item) => localDayKey(item.firstAt) === todayKey,
    ).length;

    let streak = 0;
    let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!activeDays.has(localDayKey(cursor))) {
      cursor = shiftDay(cursor, -1);
    }
    while (activeDays.has(localDayKey(cursor)) && streak < 3650) {
      streak += 1;
      cursor = shiftDay(cursor, -1);
    }

    const days = [];
    for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
      const date = shiftDay(today, -offset);
      const dayKey = localDayKey(date);
      const bucket = perDay.get(dayKey) || {
        total: 0,
        known: 0,
        fuzzy: 0,
        unknown: 0,
      };
      days.push({
        date: dayKey,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        weekday: ["日", "一", "二", "三", "四", "五", "六"][date.getDay()],
        isToday: dayKey === todayKey,
        ...bucket,
      });
    }

    let known = 0;
    let fuzzy = 0;
    let unknown = 0;
    let reviews = 0;
    for (const item of records) {
      if (item.status === "known") {
        known += 1;
      } else if (item.status === "fuzzy") {
        fuzzy += 1;
      } else if (item.status === "unknown") {
        unknown += 1;
      }
      reviews += item.reviews || 0;
    }

    return {
      deck: deckId,
      date: todayKey,
      updatedAt: state.updatedAt,
      today: {
        studied: todayBucket.total,
        newWords: newWordsToday,
        reviews: Math.max(todayBucket.total - newWordsToday, 0),
        known: todayBucket.known,
        fuzzy: todayBucket.fuzzy,
        unknown: todayBucket.unknown,
      },
      streak,
      totals: {
        studied: records.length,
        known,
        fuzzy,
        unknown,
        reviews,
        remaining: Math.max(records.length - known, 0),
      },
      days,
    };
  }

  function record({ deck, word, status, reviewedAt, source } = {}) {
    const key = normalizeKey(word);
    const state = sanitizeState(readState());
    if (!key || !STATUS_KEYS.includes(status)) {
      return null;
    }
    const id = recordId(deck, key);
    const at = reviewedAt || new Date().toISOString();
    const existing = state.records[id];
    state.records[id] = {
      deck: String(deck || "unknown"),
      word: String(word || key).trim(),
      status,
      reviews: (existing?.reviews || 0) + 1,
      firstAt: existing?.firstAt || at,
      lastAt: at,
      source: source ? String(source) : existing?.source || "",
    };
    state.history.push({
      deck: String(deck || "unknown"),
      word: key,
      status,
      at,
    });
    state.history = state.history.slice(-HISTORY_LIMIT);
    state.updatedAt = at;
    writeState(state);
    emit();
    return { ...state.records[id] };
  }

  function remove(deck, word) {
    const state = sanitizeState(readState());
    const id = recordId(deck, word);
    if (!state.records[id]) {
      return false;
    }
    delete state.records[id];
    state.history = state.history.filter(
      (item) => !(item.deck === String(deck || "unknown") && item.word === normalizeKey(word)),
    );
    state.updatedAt = new Date().toISOString();
    writeState(state);
    emit();
    return true;
  }

  function clear(deck) {
    if (!deck) {
      writeState(emptyState());
      emit();
      return;
    }
    const state = sanitizeState(readState());
    for (const [id, item] of Object.entries(state.records)) {
      if (item.deck === deck) {
        delete state.records[id];
      }
    }
    state.history = state.history.filter((item) => item.deck !== deck);
    state.updatedAt = new Date().toISOString();
    writeState(state);
    emit();
  }

  function exportJson() {
    const snapshot = getSnapshot();
    snapshot.exportedAt = new Date().toISOString();
    snapshot.source = "iball-vocab-recite";
    return JSON.stringify(snapshot, null, 2);
  }

  /** merge=false 时整份替换；默认合并，按 lastAt 取较新的一条。 */
  function importJson(payload, options = {}) {
    const incoming =
      typeof payload === "string" ? JSON.parse(payload) : payload;
    const parsed = sanitizeState(incoming);
    const merge = options.merge !== false;
    const state = merge ? sanitizeState(readState()) : emptyState();
    for (const [id, item] of Object.entries(parsed.records)) {
      const current = state.records[id];
      if (!current || String(item.lastAt) >= String(current.lastAt)) {
        state.records[id] = { ...item };
      }
    }
    const history = merge ? [...state.history, ...parsed.history] : parsed.history;
    state.history = history
      .filter((item) => item && item.word && STATUS_KEYS.includes(item.status))
      .slice(-HISTORY_LIMIT);
    state.updatedAt = new Date().toISOString();
    writeState(state);
    emit();
    return getSnapshot();
  }

  function subscribe(listener, options = {}) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    if (options.immediate) {
      listener(getSnapshot());
    }
    return () => listeners.delete(listener);
  }

  // 换账号、或被别的标签页写过之后，订阅方要能重新算一遍。
  if (window.iballAccounts?.onChange) {
    try {
      window.iballAccounts.onChange(() => {
        memory = null;
        memoryRaw = null;
        emit();
      });
    } catch {
      // 账号模块版本不匹配时忽略，本地记录照常。
    }
  }
  window.addEventListener("storage", (event) => {
    if (event?.key && String(event.key).includes(STORAGE_KEY)) {
      emit();
    }
  });

  window.IballVocabRecite = {
    version: 1,
    storageKey: STORAGE_KEY,
    statuses: { ...STATUSES },
    statusLabel(status) {
      return STATUSES[status] || status || "";
    },
    statusBadge(status) {
      return STATUS_BADGES[status] || STATUSES[status] || status || "";
    },
    getSnapshot,
    getRecords,
    getRecord,
    summary,
    daily,
    record,
    remove,
    clear,
    exportJson,
    importJson,
    subscribe,
  };
})();
