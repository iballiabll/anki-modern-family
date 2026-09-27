/**
 * 词汇库页面。
 *
 * 数据分三层，全部懒加载：
 *   vocab-index/lexemes.json       清单（几 KB）：分片表、各考试词表统计
 *   vocab-index/deck-<考试>.json   词表（几十 KB）：只要单词清单
 *   vocab-index/word-quick.json    点词索引（约 1 MB）：音标 / 释义 / 标签
 *   vocab-index/shard-map.json     词 -> 分片号（约 60 KB）
 *   vocab-index/lexemes-<n>.json   词卡分片（600-900 KB）：点到哪个词才取哪一片
 *
 * 收藏、生词本、学习进度都只写 localStorage。
 */
(function () {
  "use strict";

  // 词表文件不常改，但一旦更新就必须绕开旧 CDN 副本。
  // 发布新词表时同步更新这个版本号，避免部分节点继续返回旧词数。
  const DATA_VERSION = "20260927-867effa";
  const versioned = (url) => `${url}?v=${DATA_VERSION}`;
  const INDEX_URL = versioned("./vocab-index/lexemes.json");
  const QUICK_URL = versioned("./vocab-index/word-quick.json");
  const SHARD_MAP_URL = versioned("./vocab-index/shard-map.json");
  /** 排序方式：默认词书顺序 / 高频（单元）顺序 / 字母序。 */
  const SORT_MODES = ["default", "frequency", "alpha"];
  const DRAW_ORDERS = ["sequential", "random"];
  const DRAW_SCOPES = ["all", "unlearned", "known", "fuzzy", "unknown", "favorites"];
  // 0 = 不限时间，其余是「近 N 天（含今天）有背词记录」。
  const DRAW_DAY_RANGES = [0, 1, 3, 7, 30];
  const DRAW_SCOPE_LABELS = {
    all: "所有",
    unlearned: "未斩",
    known: "已斩",
    fuzzy: "模糊",
    unknown: "不会",
    favorites: "收藏",
  };

  const FAVORITE_KEY = "iball_vocab_favorites_v1";
  const WORDBOOK_KEY = "iball_vocab_wordbook_v1";
  const PREFS_KEY = "iball_vocab_prefs_v1";

  const PAGE_SIZE = 60;

  // 默认落在 2027 备考词库；考研英语一 / 英语二共用同一份考研核心词表，界面上分开呈现。
  const DEFAULT_DECK = "llyc2027";
  const DECKS = {
    llyc2027: {
      deck: "llyc2027",
      label: "恋练有词",
      title: "恋练有词 2027 · 备考词库",
    },
    kaoyan1: { deck: "kaoyan", label: "考研英语一", title: "考研英语一 · 核心词库" },
    kaoyan2: { deck: "kaoyan", label: "考研英语二", title: "考研英语二 · 核心词库" },
    cet4: { deck: "cet4", label: "四级", title: "四级核心词库" },
    cet6: { deck: "cet6", label: "六级", title: "六级核心词库" },
    basic: { deck: "basic", label: "零基础", title: "零基础高频词库" },
  };

  /** 认不出来的词库（历史偏好 / URL 参数）一律回退到默认词库。 */
  function deckConfig(deckKey) {
    return DECKS[deckKey] || DECKS[DEFAULT_DECK];
  }

  const els = {
    board: document.querySelector(".vocab-board"),
    deckSelect: document.getElementById("deckSelect"),
    search: document.getElementById("searchInput"),
    sortGroup: document.querySelector(".segmented-control[aria-label='排序方式']"),
    favoriteOnly: document.getElementById("favoriteOnlyButton"),
    favoriteCount: document.getElementById("favoriteCount"),
    hideKnown: document.getElementById("hideKnownButton"),
    knownCount: document.getElementById("knownCount"),
    blurMode: document.getElementById("blurModeButton"),
    drawMode: document.getElementById("drawModeButton"),
    wordbookButton: document.getElementById("wordbookButton"),
    wordbookCount: document.getElementById("wordbookCount"),
    clearProgress: document.getElementById("clearProgressButton"),
    heroStats: document.getElementById("heroStats"),
    deckTitle: document.getElementById("deckTitle"),
    deckMeta: document.getElementById("deckMeta"),
    list: document.getElementById("vocabList"),
    loadMore: document.getElementById("loadMoreButton"),
    listStatus: document.getElementById("listStatus"),
    panel: document.getElementById("wordPanel"),
    detail: document.getElementById("wordDetail"),
    reciteBar: document.getElementById("reciteBar"),
    reciteStatus: document.getElementById("reciteStatus"),
    speakWord: document.getElementById("speakWordButton"),
    favoriteWord: document.getElementById("favoriteWordButton"),
    wordbookToggle: document.getElementById("wordbookToggleButton"),
    closeWord: document.getElementById("closeWordButton"),
    drawPanel: document.getElementById("drawPanel"),
    drawStatus: document.getElementById("drawStatus"),
    drawWord: document.getElementById("drawWord"),
    drawPhonetic: document.getElementById("drawPhonetic"),
    drawKicker: document.getElementById("drawKicker"),
    drawAnswer: document.getElementById("drawAnswer"),
    drawReveal: document.getElementById("drawRevealButton"),
    drawReciteActions: document.getElementById("drawReciteActions"),
    drawControls: document.getElementById("drawControls"),
    drawNext: document.getElementById("drawNextButton"),
    drawClose: document.getElementById("drawCloseButton"),
    wordbookPanel: document.getElementById("wordbookPanel"),
    wordbookList: document.getElementById("wordbookList"),
    exportWordbook: document.getElementById("exportWordbookButton"),
    copyWordbook: document.getElementById("copyWordbookButton"),
    clearWordbook: document.getElementById("clearWordbookButton"),
    closeWordbook: document.getElementById("closeWordbookButton"),
    progressBar: document.getElementById("readingProgress"),
    toast: document.getElementById("toast"),
  };

  const state = {
    index: null,
    indexPromise: null,
    quick: null,
    quickPhrases: null,
    quickPromise: null,
    quickLoadingStarted: false,
    shardMap: null,
    shardMapPromise: null,
    shardCache: new Map(),
    deckCache: new Map(),
    deckKey: DEFAULT_DECK,
    deckWords: [],
    visibleCount: PAGE_SIZE,
    query: "",
    sort: "default",
    favoriteOnly: false,
    hideKnown: false,
    blurMode: false,
    drawOpen: false,
    drawWord: "",
    drawRevealed: false,
    drawSeen: new Set(),
    drawOrder: "random",
    drawScope: "all",
    drawDays: 0,
    activeWord: "",
    detailToken: 0,
    recite: new Map(),
    favorites: new Set(),
    wordbook: new Map(),
    prefs: {
      deckKey: DEFAULT_DECK,
      sort: "default",
      hideKnown: false,
      drawOrder: "random",
      drawScope: "all",
      drawDays: 0,
    },
  };

  /* ------------------------------------------------------------- 小工具 */

  function readStore(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }
      const value = JSON.parse(raw);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let toastTimer = 0;

  function showToast(message) {
    if (!els.toast) {
      return;
    }
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 2400);
  }

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  /* ------------------------------------------------------------- 数据层 */

  function fetchJson(url) {
    return fetch(url, { cache: "force-cache" }).then((response) => {
      if (!response.ok) {
        throw new Error(`${url} 加载失败（${response.status}）`);
      }
      return response.json();
    });
  }

  function loadIndex() {
    if (!state.indexPromise) {
      state.indexPromise = fetchJson(INDEX_URL).then((data) => {
        state.index = data;
        return data;
      });
    }
    return state.indexPromise;
  }

  /** 点词索引体积较大，等首屏渲染完再后台取，失败也不影响词表。 */
  function loadQuickIndex() {
    if (!state.quickPromise) {
      state.quickPromise = fetchJson(QUICK_URL)
        .then((data) => {
          state.quick = data?.words && typeof data.words === "object" ? data.words : {};
          state.quickPhrases =
            data?.phrases && typeof data.phrases === "object" ? data.phrases : {};
          renderList();
          renderStats();
          return state.quick;
        })
        .catch(() => {
          state.quick = {};
          state.quickPhrases = {};
          return state.quick;
        });
    }
    return state.quickPromise;
  }

  function scheduleQuickIndex() {
    if (state.quickLoadingStarted) {
      return;
    }
    state.quickLoadingStarted = true;
    const run = () => loadQuickIndex();
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 2500 });
      return;
    }
    window.setTimeout(run, 900);
  }

  function loadShardMap() {
    if (!state.shardMapPromise) {
      state.shardMapPromise = fetchJson(SHARD_MAP_URL)
        .then((data) => {
          state.shardMap = data?.words && typeof data.words === "object" ? data.words : {};
          return state.shardMap;
        })
        .catch(() => {
          state.shardMap = {};
          return state.shardMap;
        });
    }
    return state.shardMapPromise;
  }

  function loadDeck(deckKey) {
    const config = deckConfig(deckKey);
    const cacheKey = config.deck;
    if (state.deckCache.has(cacheKey)) {
      return Promise.resolve(state.deckCache.get(cacheKey));
    }
    return fetchJson(versioned(`./vocab-index/deck-${cacheKey}.json`)).then((data) => {
      const words = Array.isArray(data?.words) ? data.words : [];
      state.deckCache.set(cacheKey, words);
      return words;
    });
  }

  /** 词卡详情：只拉这个词所在的分片，取回后缓存，重复点不重复下载。 */
  async function loadLexeme(word) {
    const key = normalize(word);
    if (!key) {
      return null;
    }
    const map = await loadShardMap();
    const shard = map[key];
    if (!shard) {
      return null;
    }
    if (!state.shardCache.has(shard)) {
      const payload = await fetchJson(versioned(`./vocab-index/lexemes-${shard}.json`));
      const byWord = new Map();
      for (const entry of Array.isArray(payload?.words) ? payload.words : []) {
        byWord.set(normalize(entry.word), entry);
      }
      state.shardCache.set(shard, byWord);
      // 分片最多缓存 3 片，避免长时间浏览后内存膨胀。
      while (state.shardCache.size > 3) {
        const oldest = state.shardCache.keys().next().value;
        state.shardCache.delete(oldest);
      }
    }
    return state.shardCache.get(shard)?.get(key) || null;
  }

  /** 轻量释义：点词索引里的「音标 / 释义 / 标签」。 */
  function quickEntry(word) {
    const key = normalize(word);
    // 固定搭配与短语存在 phrases 段（例如 according to、ice cream）。
    const raw = state.quick?.[key] || state.quickPhrases?.[key];
    if (!raw) {
      return null;
    }
    const [phonetic = "", meaning = "", tags = ""] = String(raw).split("\t");
    return {
      phonetic,
      meaning,
      tags: tags.split(/\s+/).filter(Boolean),
    };
  }

  /* ----------------------------------------------------------- 背词记录 */

  /**
   * 背词记录走 vocab-recite-api.js（window.IballVocabRecite）：
   * account-store.js 已把 localStorage 按账号隔离并同步到 ./api/progress，
   * 所以这里只读写这个接口，不再自己拼存储键。
   */
  function reciteApi() {
    return window.IballVocabRecite || null;
  }

  function currentDeckId() {
    return deckConfig(state.deckKey).deck;
  }

  function reciteRecord(word) {
    return state.recite.get(normalize(word)) || null;
  }

  /** 已斩 = 已经会的词，每日任务不再排它。 */
  function isSlain(word) {
    return reciteRecord(word)?.status === "known";
  }

  function slainCount() {
    let count = 0;
    for (const record of state.recite.values()) {
      if (record.status === "known") {
        count += 1;
      }
    }
    return count;
  }

  function refreshRecite() {
    const api = reciteApi();
    const next = new Map();
    if (api) {
      for (const item of api.getRecords(currentDeckId())) {
        next.set(normalize(item.word), item);
      }
    }
    state.recite = next;
  }

  function syncReciteBar() {
    if (!els.reciteBar) {
      return;
    }
    const active = state.activeWord;
    els.reciteBar.hidden = !active;
    if (!active) {
      return;
    }
    const record = reciteRecord(active);
    els.reciteBar.querySelectorAll("[data-recite]").forEach((node) => {
      const isActive = Boolean(record) && node.dataset.recite === record.status;
      node.classList.toggle("is-active", isActive);
      node.classList.toggle(`is-${node.dataset.recite}`, isActive);
      node.setAttribute("aria-pressed", String(isActive));
    });
    if (els.reciteStatus) {
      if (!record) {
        els.reciteStatus.textContent =
          "点一个状态就会记下来；再点当前状态可以取消";
      } else if (record.status === "known") {
        els.reciteStatus.textContent = `已斩 · 已记 ${record.reviews} 次 · 再点可取消斩`;
      } else {
        els.reciteStatus.textContent = `${
          reciteApi()?.statusLabel(record.status) || record.status
        } · 已记 ${record.reviews} 次 · 再点可取消`;
      }
    }
  }

  function recordRecite(status, word = state.activeWord, options = {}) {
    const api = reciteApi();
    const targetWord = String(word || "").trim();
    if (!api || !targetWord) {
      showToast("背词记录接口还没就绪，稍后再试");
      return false;
    }
    const existing = reciteRecord(targetWord);
    if (existing?.status === status) {
      if (api.remove(currentDeckId(), targetWord)) {
        showToast(
          status === "known"
            ? "已取消斩：这个词会回到未背"
            : `已取消「${api.statusLabel(status)}」标记`,
        );
      }
      return true;
    }
    const saved = api.record({
      deck: currentDeckId(),
      word: targetWord,
      status,
      source: options.source || `vocab:${state.deckKey}`,
    });
    if (saved) {
      showToast(
        status === "known"
          ? "已斩：这个词之后不再进每日任务"
          : status === "unknown"
            ? "已记为「不会」，会回到待攻克"
            : `已记为「${api.statusLabel(status)}」`,
      );
    }
    return Boolean(saved);
  }

  /* --------------------------------------------------------------- 渲染 */

  function currentDeckWords() {
    return state.deckWords;
  }

  function filteredWords() {
    const query = state.query;
    let words = currentDeckWords();
    if (state.favoriteOnly) {
      words = words.filter((word) => state.favorites.has(normalize(word)));
    }
    if (state.hideKnown) {
      words = words.filter((word) => !isSlain(word));
    }
    if (query) {
      const isAscii = /^[a-z0-9'\-.\s]+$/i.test(query);
      words = words.filter((word) => {
        const key = normalize(word);
        if (isAscii && key.includes(query)) {
          return true;
        }
        const quick = quickEntry(word);
        if (!quick) {
          return false;
        }
        return (
          normalize(quick.meaning).includes(query) || quick.tags.join(" ").includes(query)
        );
      });
    }
    // 「默认词书顺序」和「高频 / 单元顺序」都直接用词表文件的原始顺序
    // （kaoyan、cet、basic 词表本身就是按词频导出的，恋练有词 2027 是按单元顺序导出的），
    // 只有字母序需要在这里重新排序。
    if (state.sort === "alpha") {
      words = [...words].sort((left, right) => left.localeCompare(right));
    }
    return words;
  }

  function renderStats() {
    if (!els.heroStats) {
      return;
    }
    const deck = state.index?.decks?.find(
      (item) => item.deck === deckConfig(state.deckKey).deck,
    );
    const chips = [
      { value: String(deck?.words ?? currentDeckWords().length), label: "词库词量" },
      { value: String(slainCount()), label: "已斩" },
      { value: String(state.recite.size), label: "已学" },
      { value: String(state.favorites.size), label: "已收藏" },
      { value: String(state.wordbook.size), label: "生词本" },
      {
        value: state.quick ? "已就绪" : "加载中",
        label: "点词释义",
      },
    ];
    els.heroStats.innerHTML = chips
      .map(
        (chip) =>
          `<span class="stat-chip"><strong>${escapeHtml(chip.value)}</strong><span>${escapeHtml(
            chip.label,
          )}</span></span>`,
      )
      .join("");
  }

  function renderList() {
    if (!els.list) {
      return;
    }
    const words = filteredWords();
    if (!words.length) {
      const waitingQuick =
        Boolean(state.query) && !state.quick && !/^[a-z0-9'\-.\s]+$/i.test(state.query);
      els.list.innerHTML =
        `<p class="vocab-empty">${
          waitingQuick
            ? "正在取点词索引，中文释义马上就能搜…"
            : "这个条件下没有单词。换个词库，或清掉搜索词再试。"
        }</p>`;
      if (els.loadMore) {
        els.loadMore.hidden = true;
      }
      updateListStatus(words.length, words.length);
      return;
    }
    const shown = words.slice(0, state.visibleCount);
    els.list.innerHTML = shown
      .map((word, index) => {
        const key = normalize(word);
        const quick = quickEntry(word);
        const marks = [];
        if (state.favorites.has(key)) {
          marks.push('<span class="is-marked">已收藏</span>');
        }
        if (state.wordbook.has(key)) {
          marks.push('<span class="is-marked">生词本</span>');
        }
        const recited = reciteRecord(word);
        if (recited) {
          marks.push(
            `<span class="is-recited is-${escapeHtml(recited.status)}">${escapeHtml(
              reciteApi()?.statusBadge?.(recited.status) ||
                reciteApi()?.statusLabel(recited.status) ||
                recited.status,
            )}</span>`,
          );
        }
        const status = recited?.status || "";
        const quickActions = [
          { status: "known", label: "斩", title: "直接标记已经会了；再点取消斩" },
          { status: "fuzzy", label: "模糊", title: "直接标记还没记牢；再点取消" },
          { status: "unknown", label: "不会", title: "直接标记不认识；再点取消" },
        ];
        return `
          <div class="vocab-row${
            key === normalize(state.activeWord) ? " is-active" : ""
          }" data-word="${escapeHtml(word)}">
            <button
              class="vocab-row-main"
              type="button"
              data-open-word="${escapeHtml(word)}"
              aria-label="查看 ${escapeHtml(word)} 的完整词卡"
            >
              <span class="vocab-row-index">${index + 1}</span>
              <span class="vocab-row-copy">
                <span class="vocab-row-word">${escapeHtml(word)}${
                  quick?.phonetic ? `<small>/${escapeHtml(quick.phonetic)}/</small>` : ""
                }</span>
                <span class="vocab-row-meaning">${escapeHtml(
                  quick?.meaning || "词卡详情按分片懒加载，点击查看例句与词根",
                )}</span>
              </span>
              <span class="vocab-row-flags">${marks.join("") || "<span>未学</span>"}</span>
            </button>
            <div class="vocab-row-actions" role="group" aria-label="${escapeHtml(
              word,
            )} 的快捷背词记录">
              ${quickActions
                .map(
                  (action) => `
                    <button
                      class="vocab-quick-button is-${action.status}${
                        status === action.status ? " is-active" : ""
                      }"
                      type="button"
                      data-quick-recite="${action.status}"
                      data-word="${escapeHtml(word)}"
                      aria-pressed="${status === action.status}"
                      title="${action.title}"
                    >${action.label}</button>`,
                )
                .join("")}
            </div>
          </div>`;
      })
      .join("");
    if (els.loadMore) {
      els.loadMore.hidden = shown.length >= words.length;
    }
    updateListStatus(shown.length, words.length);
    if (state.drawOpen) {
      renderDrawCard();
    }
  }

  function updateListStatus(shown, total) {
    if (els.listStatus) {
      els.listStatus.textContent = `已显示 ${shown} / ${total} 个单词`;
    }
  }

  function updateDeckMeta() {
    if (!els.deckMeta || !state.deckWords.length) {
      return;
    }
    const config = deckConfig(state.deckKey);
    const total = state.deckWords.length;
    const slain = slainCount();
    els.deckMeta.textContent = `${config.label} · 共 ${total} 词 · 已斩 ${slain} · 未背 ${Math.max(
      total - slain,
      0,
    )}`;
  }

  function drawScopeLabel() {
    return DRAW_SCOPE_LABELS[state.drawScope] || DRAW_SCOPE_LABELS.all;
  }

  function drawDaysLabel() {
    if (state.drawDays === 1) {
      return "今天";
    }
    if (state.drawDays > 1) {
      return `近 ${state.drawDays} 天`;
    }
    return "不限时间";
  }

  /** 背词时间戳统一按本地日期读，ISO 里的 UTC 日期在早上会差一天。 */
  function reciteDayKey(value) {
    const text = String(value || "");
    if (!text) {
      return "";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return text;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return text.slice(0, 10);
    }
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** 某个词有背词记录的日期集合：history 为主，记录的 firstAt / lastAt 兜底。 */
  function drawDayKeys(word) {
    const key = normalize(word);
    const days = new Set();
    if (!key) {
      return days;
    }
    const snapshot = reciteApi()?.getSnapshot?.();
    const deckId = currentDeckId();
    const history = Array.isArray(snapshot?.history) ? snapshot.history : [];
    history.forEach((item) => {
      if (!item || normalize(item.word) !== key) {
        return;
      }
      if (deckId && item.deck && item.deck !== deckId) {
        return;
      }
      const day = reciteDayKey(item.at);
      if (day) {
        days.add(day);
      }
    });
    const record = reciteRecord(word);
    if (record) {
      [record.firstAt, record.lastAt].forEach((stamp) => {
        const day = reciteDayKey(stamp);
        if (day) {
          days.add(day);
        }
      });
    }
    return days;
  }

  function drawDaysMatch(word) {
    if (!state.drawDays) {
      return true;
    }
    const now = new Date();
    const from = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (state.drawDays - 1),
    );
    const pad = (number) => String(number).padStart(2, "0");
    const fromKey = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
    for (const day of drawDayKeys(word)) {
      if (day >= fromKey) {
        return true;
      }
    }
    return false;
  }

  function drawOrderLabel() {
    return state.drawOrder === "sequential" ? "顺序版" : "非顺序版";
  }

  function drawEmptyHint() {
    if (!state.deckWords.length) {
      return "词表还在加载，稍后再试。";
    }
    const dayText = state.drawDays ? drawDaysLabel() : "";
    if (state.drawScope === "favorites") {
      return dayText
        ? `收藏夹里${dayText}还没有背词记录，把「记录时间」改成不限再试。`
        : "收藏夹里还没有词，打开词卡点「收藏」后再来。";
    }
    if (state.drawScope === "unlearned") {
      return dayText
        ? `${dayText}背过的词都已经斩了，换个时间范围再试。`
        : "当前范围里的词都已经斩了，没有未斩的词可抽。";
    }
    if (state.drawScope === "known") {
      return state.hideKnown
        ? "当前开着「只看未背」，关掉它才能抽斩过的词。"
        : dayText
          ? `${dayText}没有斩过的词，换个时间范围再试。`
          : "还没有斩过的词，先在列表点「斩」。";
    }
    if (state.drawScope === "fuzzy") {
      return dayText
        ? `${dayText}没有标记「模糊」的词，换个时间范围再试。`
        : "还没有标记「模糊」的词，先在列表点「模糊」。";
    }
    if (state.drawScope === "unknown") {
      return dayText
        ? `${dayText}没有标记「不会」的词，换个时间范围再试。`
        : "还没有标记「不会」的词，先在列表点「不会」。";
    }
    if (dayText) {
      return `${dayText}没有背词记录，换个时间范围，或把「记录时间」改成不限。`;
    }
    if (state.hideKnown) {
      return "当前开着「只看未背」，可以关掉后再抽全部词。";
    }
    if (state.favoriteOnly) {
      return "当前只显示收藏词，关掉「收藏夹」后再试。";
    }
    if (state.query) {
      return "当前搜索没有匹配词，换个关键词再试。";
    }
    return "换个词库或调整筛选后再试。";
  }

  /** 范围只看状态（未斩 / 已斩 / 模糊 / 不会 / 收藏），没背过的词算未斩。 */
  function drawScopeMatch(word) {
    const status = reciteRecord(word)?.status || "";
    switch (state.drawScope) {
      case "unlearned":
        return status !== "known";
      case "known":
        return status === "known";
      case "fuzzy":
        return status === "fuzzy";
      case "unknown":
        return status === "unknown";
      case "favorites":
        return state.favorites.has(normalize(word));
      default:
        return true;
    }
  }

  function drawCandidates() {
    return filteredWords().filter((word) => drawScopeMatch(word) && drawDaysMatch(word));
  }

  function pickDrawWord(candidates) {
    const validKeys = new Set(candidates.map((word) => normalize(word)));
    for (const key of [...state.drawSeen]) {
      if (!validKeys.has(key)) {
        state.drawSeen.delete(key);
      }
    }

    const currentKey = normalize(state.drawWord);
    let remaining = candidates.filter(
      (word) => !state.drawSeen.has(normalize(word)),
    );
    if (!remaining.length) {
      state.drawSeen.clear();
      if (currentKey && candidates.length > 1 && validKeys.has(currentKey)) {
        state.drawSeen.add(currentKey);
      }
      remaining = candidates.filter(
        (word) => !state.drawSeen.has(normalize(word)),
      );
    }

    let selected = "";
    if (state.drawOrder === "sequential") {
      selected = remaining[0] || "";
    } else if (remaining.length) {
      selected = remaining[Math.floor(Math.random() * remaining.length)];
    }
    if (!selected && candidates.length) {
      selected = candidates.find((word) => normalize(word) !== currentKey) || candidates[0];
    }
    if (selected) {
      state.drawSeen.add(normalize(selected));
    }
    return selected;
  }

  function syncDrawControls() {
    els.drawControls?.querySelectorAll("[data-draw-order]").forEach((node) => {
      const active = node.dataset.drawOrder === state.drawOrder;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });
    els.drawControls?.querySelectorAll("[data-draw-scope]").forEach((node) => {
      const active = node.dataset.drawScope === state.drawScope;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });
    els.drawControls?.querySelectorAll("[data-draw-days]").forEach((node) => {
      const active = Number(node.dataset.drawDays) === state.drawDays;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });
  }

  function renderDrawCard() {
    if (!els.drawPanel || !els.drawWord || !els.drawAnswer) {
      return;
    }
    const candidates = drawCandidates();
    const candidateKeys = new Set(candidates.map((word) => normalize(word)));
    if (state.drawWord && !candidateKeys.has(normalize(state.drawWord))) {
      state.drawWord = "";
      state.drawRevealed = false;
    }
    if (els.drawKicker) {
      els.drawKicker.textContent =
        state.drawOrder === "sequential" ? "SEQUENTIAL CARD" : "RANDOM CARD";
    }
    if (els.drawStatus) {
      const pool = `${drawOrderLabel()} · ${drawScopeLabel()} · ${drawDaysLabel()} · 共 ${candidates.length} 词`;
      els.drawStatus.textContent = state.drawWord
        ? `${pool} · 本轮已抽 ${Math.min(state.drawSeen.size, candidates.length)} 张`
        : `${pool}${candidates.length ? " · 点「下一张」开始" : " · 暂无可抽词"}`;
    }
    if (!state.drawWord) {
      els.drawWord.textContent = candidates.length ? "准备抽卡…" : "当前范围里没有可抽的词";
      if (els.drawPhonetic) {
        els.drawPhonetic.textContent = candidates.length ? "点「下一张」开始" : drawEmptyHint();
      }
      els.drawAnswer.hidden = true;
      if (els.drawReveal) {
        els.drawReveal.hidden = true;
      }
      if (els.drawReciteActions) {
        els.drawReciteActions.hidden = true;
      }
      return;
    }

    const quick = quickEntry(state.drawWord);
    els.drawWord.textContent = state.drawWord;
    if (els.drawPhonetic) {
      els.drawPhonetic.textContent = quick?.phonetic ? `/${quick.phonetic}/` : "";
    }
    els.drawAnswer.innerHTML = `<p>${escapeHtml(
      quick?.meaning || "释义正在加载，稍后会显示在这里。",
    )}</p>`;
    els.drawAnswer.hidden = !state.drawRevealed;
    if (els.drawReveal) {
      els.drawReveal.hidden = state.drawRevealed;
    }
    if (els.drawReciteActions) {
      els.drawReciteActions.hidden = !state.drawRevealed;
    }
    const status = reciteRecord(state.drawWord)?.status || "";
    els.drawReciteActions?.querySelectorAll("[data-draw-recite]").forEach((node) => {
      const active = node.dataset.drawRecite === status;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });
  }

  function nextDrawCard() {
    if (!state.drawOpen) {
      return;
    }
    const candidates = drawCandidates();
    state.drawWord = pickDrawWord(candidates);
    state.drawRevealed = false;
    renderDrawCard();
    if (state.drawWord && !quickEntry(state.drawWord)) {
      loadQuickIndex().then(() => {
        if (state.drawOpen && state.drawWord) {
          renderDrawCard();
        }
      });
    }
  }

  function resetDrawRound() {
    state.drawWord = "";
    state.drawRevealed = false;
    state.drawSeen.clear();
    if (state.drawOpen) {
      nextDrawCard();
    } else {
      renderDrawCard();
    }
  }

  function openDrawMode() {
    if (!els.drawPanel) {
      return;
    }
    state.drawOpen = true;
    state.drawSeen.clear();
    els.drawPanel.hidden = false;
    nextDrawCard();
    syncCounters();
    window.requestAnimationFrame(() => {
      els.drawPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function closeDrawMode() {
    state.drawOpen = false;
    state.drawRevealed = false;
    state.drawWord = "";
    state.drawSeen.clear();
    if (els.drawPanel) {
      els.drawPanel.hidden = true;
    }
    syncCounters();
  }

  function revealDrawCard() {
    if (!state.drawWord) {
      return;
    }
    state.drawRevealed = true;
    renderDrawCard();
    if (!quickEntry(state.drawWord)) {
      loadQuickIndex().then(() => {
        if (state.drawOpen && state.drawWord) {
          renderDrawCard();
        }
      });
    }
  }

  function recordDrawRecite(status) {
    const word = state.drawWord;
    if (!word) {
      return;
    }
    const changed = recordRecite(status, word, {
      source: `vocab-draw:${state.deckKey}`,
    });
    if (!changed) {
      return;
    }
    state.drawRevealed = true;
    renderDrawCard();
    window.setTimeout(() => {
      if (state.drawOpen) {
        nextDrawCard();
      }
    }, 180);
  }

  function renderDetail(entry, word, options = {}) {
    if (!els.detail) {
      return;
    }
    els.detail.classList.toggle("is-loading", Boolean(options.loading));
    if (!entry) {
      const quick = quickEntry(word);
      els.detail.innerHTML = `
        <div class="vocab-head-word">
          <h3>${escapeHtml(word)}</h3>
          ${
            quick?.phonetic
              ? `<div class="vocab-head-line"><span>/${escapeHtml(quick.phonetic)}/</span></div>`
              : ""
          }
        </div>
        <div class="vocab-block">
          <h4>释义</h4>
          <p>${escapeHtml(quick?.meaning || "正在取这个词的完整词卡…")}</p>
        </div>
        ${
          quick?.tags?.length
            ? `<div class="vocab-block"><h4>收录考试</h4><div class="vocab-head-line">${quick.tags
                .map((tag) => `<span class="vocab-tag">${escapeHtml(tag)}</span>`)
                .join("")}</div></div>`
            : ""
        }`;
      return;
    }
    const blocks = [];
    blocks.push(`
      <div class="vocab-head-word">
        <h3>${escapeHtml(entry.word)}</h3>
        <div class="vocab-head-line">
          ${entry.phonetic ? `<span>/${escapeHtml(entry.phonetic)}/</span>` : ""}
          ${(entry.tags || [])
            .map((tag) => `<span class="vocab-tag">${escapeHtml(tag)}</span>`)
            .join("")}
        </div>
      </div>`);
    if (entry.translation?.length) {
      blocks.push(`
        <div class="vocab-block">
          <h4>释义</h4>
          <ul>${entry.translation.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        </div>`);
    } else if (!entry.definition?.length) {
      blocks.push(`
        <div class="vocab-block">
          <h4>释义</h4>
          <p>ECDict 暂未收录这个词，可以先记拼写与读音，再结合真题语境理解。</p>
        </div>`);
    }
    if (entry.example) {
      blocks.push(`
        <div class="vocab-block">
          <h4>例句 / 英释</h4>
          <p class="vocab-example" lang="en">${escapeHtml(entry.example)}</p>
        </div>`);
    }
    if (entry.definition?.length > 1) {
      blocks.push(`
        <div class="vocab-block">
          <h4>英文释义</h4>
          <ul>${entry.definition
            .filter((line) => line !== entry.example)
            .slice(0, 3)
            .map((line) => `<li lang="en">${escapeHtml(line)}</li>`)
            .join("")}</ul>
        </div>`);
    }
    if (entry.wordroot) {
      const root = entry.wordroot;
      blocks.push(`
        <div class="vocab-block">
          <h4>词根词缀（记忆法）</h4>
          <p>词根 <strong>${escapeHtml(root.root || "")}</strong>${
            root.meaning ? ` · ${escapeHtml(root.meaning)}` : ""
          }${root.class ? ` · ${escapeHtml(root.class)}` : ""}</p>
          ${root.example ? `<p lang="en">${escapeHtml(root.example)}</p>` : ""}
          ${root.origin ? `<p>${escapeHtml(root.origin)}</p>` : ""}
        </div>`);
    }
    if (entry.resemble) {
      blocks.push(`
        <div class="vocab-block">
          <h4>形近 / 近义词辨析</h4>
          <p>${escapeHtml((entry.resemble.group || []).join(" / "))}</p>
          <p>${escapeHtml(entry.resemble.note || "")}</p>
        </div>`);
    }
    if (entry.exchange?.length) {
      blocks.push(`
        <div class="vocab-block">
          <h4>词形变化</h4>
          <ul>${entry.exchange.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
        </div>`);
    }
    els.detail.innerHTML = blocks.join("");
  }

  function renderWordbook() {
    if (!els.wordbookList) {
      return;
    }
    const entries = [...state.wordbook.entries()];
    if (!entries.length) {
      els.wordbookList.innerHTML =
        '<p class="vocab-empty">生词本还是空的。在词卡上点「加入生词本」就会存到这里。</p>';
      return;
    }
    els.wordbookList.innerHTML = entries
      .map(([key, record]) => {
        const quick = quickEntry(record.word);
        return `
          <div class="vocab-wordbook-item">
            <div>
              <strong>${escapeHtml(record.word)}</strong>
              <span>${escapeHtml(quick?.meaning || record.meaning || "点开词表可看完整词卡")}</span>
            </div>
            <button class="compact-button" type="button" data-remove-word="${escapeHtml(
              key,
            )}">移出</button>
          </div>`;
      })
      .join("");
  }

  function syncCounters() {
    if (els.favoriteCount) {
      els.favoriteCount.textContent = String(state.favorites.size);
    }
    if (els.knownCount) {
      els.knownCount.textContent = String(slainCount());
    }
    els.hideKnown?.setAttribute("aria-pressed", String(state.hideKnown));
    els.hideKnown?.classList.toggle("is-primary", state.hideKnown);
    els.blurMode?.setAttribute("aria-pressed", String(state.blurMode));
    els.blurMode?.classList.toggle("is-primary", state.blurMode);
    if (els.blurMode) {
      els.blurMode.textContent = state.blurMode ? "恢复清晰" : "释义模糊";
      els.blurMode.title = state.blurMode
        ? "恢复全部释义；模糊时点某个单词可以只看这一条"
        : "遮住列表和词卡的释义，点击开始模糊复习";
    }
    els.drawMode?.setAttribute("aria-pressed", String(state.drawOpen));
    els.drawMode?.classList.toggle("is-primary", state.drawOpen);
    if (els.drawMode) {
      els.drawMode.textContent = state.drawOpen ? "关闭抽卡" : "抽卡复习";
    }
    syncDrawControls();
    document.body.classList.toggle("is-vocab-blur", state.blurMode);
    if (els.wordbookCount) {
      els.wordbookCount.textContent = String(state.wordbook.size);
    }
    els.favoriteOnly?.setAttribute("aria-pressed", String(state.favoriteOnly));
    els.favoriteOnly?.classList.toggle("is-primary", state.favoriteOnly);
    const wordKey = normalize(state.activeWord);
    els.favoriteWord?.setAttribute("aria-pressed", String(state.favorites.has(wordKey)));
    els.favoriteWord?.classList.toggle("is-primary", state.favorites.has(wordKey));
    els.wordbookToggle?.setAttribute("aria-pressed", String(state.wordbook.has(wordKey)));
    els.wordbookToggle?.classList.toggle("is-primary", state.wordbook.has(wordKey));
    if (els.wordbookToggle && state.activeWord) {
      els.wordbookToggle.textContent = state.wordbook.has(wordKey)
        ? "移出生词本"
        : "加入生词本";
    }
    syncReciteBar();
  }

  function setPanelOpen(open) {
    if (!els.panel) {
      return;
    }
    els.panel.hidden = !open;
    els.board?.classList.toggle("has-detail", open);
  }

  /** 关掉模糊复习时，把所有「临时看清」的单条释义一起还原。 */
  function clearReveals() {
    document
      .querySelectorAll(
        ".vocab-row.is-revealed, .vocab-block.is-revealed, .vocab-draw-answer.is-revealed",
      )
      .forEach((node) => node.classList.remove("is-revealed"));
  }

  /* ----------------------------------------------------------- 交互逻辑 */

  async function openWord(word) {
    state.activeWord = word;
    const token = (state.detailToken += 1);
    setPanelOpen(true);
    renderDetail(null, word, { loading: true });
    syncCounters();
    renderList();
    try {
      const entry = await loadLexeme(word);
      if (token !== state.detailToken) {
        return;
      }
      renderDetail(entry, word, { loading: false });
    } catch (error) {
      if (token !== state.detailToken) {
        return;
      }
      renderDetail(null, word, { loading: false });
      showToast(error?.message || "词卡加载失败，稍后再试");
    }
  }

  function toggleFavorite(word) {
    const key = normalize(word);
    if (!key) {
      return;
    }
    if (state.favorites.has(key)) {
      state.favorites.delete(key);
      showToast("已取消收藏");
    } else {
      state.favorites.add(key);
      showToast("已加入收藏夹");
    }
    writeStore(FAVORITE_KEY, [...state.favorites]);
    syncCounters();
    renderList();
    renderStats();
  }

  function toggleWordbook(word) {
    const key = normalize(word);
    if (!key) {
      return;
    }
    if (state.wordbook.has(key)) {
      state.wordbook.delete(key);
      showToast("已移出生词本");
    } else {
      const quick = quickEntry(word);
      state.wordbook.set(key, {
        word,
        meaning: quick?.meaning || "",
        at: Date.now(),
      });
      showToast("已加入生词本");
    }
    writeStore(WORDBOOK_KEY, [...state.wordbook.entries()]);
    syncCounters();
    renderList();
    renderWordbook();
    renderStats();
  }

  function speakWord() {
    if (!state.activeWord) {
      return;
    }
    if (window.IballSpeech?.speakSequence) {
      window.IballSpeech.speakSequence([state.activeWord], {
        label: `朗读 ${state.activeWord}`,
        rate: 0.9,
      });
      return;
    }
    if (!("speechSynthesis" in window)) {
      showToast("这台浏览器不支持朗读");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(state.activeWord);
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  function exportWordbook() {
    const payload = {
      exportedAt: new Date().toISOString(),
      deck: state.deckKey,
      words: [...state.wordbook.entries()].map(([key, record]) => ({
        word: record.word,
        meaning: quickEntry(record.word)?.meaning || record.meaning || "",
        key,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `iball-wordbook-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function copyWordbook() {
    const text = [...state.wordbook.values()].map((record) => record.word).join("\n");
    if (!text) {
      showToast("生词本是空的");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制单词表");
    } catch {
      showToast("复制失败，请用「导出 JSON」");
    }
  }

  async function selectDeck(deckKey) {
    const config = DECKS[deckKey] ? deckKey : DEFAULT_DECK;
    closeDrawMode();
    state.deckKey = config;
    state.prefs.deckKey = config;
    state.visibleCount = PAGE_SIZE;
    refreshRecite();
    if (els.deckSelect) {
      els.deckSelect.value = config;
    }
    if (els.deckTitle) {
      els.deckTitle.textContent = DECKS[config].title;
    }
    const frequencyButton = els.sortGroup?.querySelector("[data-sort='frequency']");
    if (frequencyButton) {
      // 恋练有词按教材单元顺序输出，回退排序时提示成“单元顺序”更准确。
      frequencyButton.textContent = config === "llyc2027" ? "单元顺序" : "高频优先";
    }
    if (els.deckMeta) {
      els.deckMeta.textContent = "正在取词表…";
    }
    if (els.list) {
      els.list.innerHTML =
        '<div class="loading-state"><strong>正在准备词表</strong><span>只读取当前这一份考试词表。</span></div>';
    }
    try {
      state.deckWords = await loadDeck(config);
      updateDeckMeta();
      renderList();
      renderStats();
      syncCounters();
    } catch (error) {
      if (els.list) {
        els.list.innerHTML = `<p class="vocab-empty">${escapeHtml(
          error?.message || "词表加载失败",
        )}</p>`;
      }
    }
    writeStore(PREFS_KEY, state.prefs);
  }

  function clearProgress() {
    if (
      !window.confirm("清空收藏夹、生词本、当前词库的背词记录和排序偏好吗？这一步不能撤销。")
    ) {
      return;
    }
    state.favorites.clear();
    state.wordbook.clear();
    writeStore(FAVORITE_KEY, []);
    writeStore(WORDBOOK_KEY, []);
    reciteApi()?.clear(currentDeckId());
    refreshRecite();
    syncCounters();
    renderList();
    renderWordbook();
    renderStats();
    updateDeckMeta();
    showToast("已清空本机词汇记录");
  }

  function scrollProgress() {
    if (!els.progressBar) {
      return;
    }
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
    els.progressBar.style.transform = `scaleX(${ratio})`;
  }

  /* ------------------------------------------------------------- 事件绑定 */

  function bindEvents() {
    els.deckSelect?.addEventListener("change", (event) => {
      selectDeck(event.target.value);
    });

    let searchTimer = 0;
    els.search?.addEventListener("input", (event) => {
      window.clearTimeout(searchTimer);
      const value = normalize(event.target.value);
      searchTimer = window.setTimeout(() => {
        state.query = value;
        state.visibleCount = PAGE_SIZE;
        renderList();
        if (value && !state.quick) {
          loadQuickIndex().then(() => renderList());
        }
      }, 140);
    });

    els.sortGroup?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-sort]");
      if (!button) {
        return;
      }
      state.sort = SORT_MODES.includes(button.dataset.sort) ? button.dataset.sort : "default";
      state.prefs.sort = state.sort;
      els.sortGroup.querySelectorAll("[data-sort]").forEach((node) => {
        const active = node === button;
        node.classList.toggle("is-active", active);
        node.setAttribute("aria-pressed", String(active));
      });
      state.visibleCount = PAGE_SIZE;
      renderList();
      writeStore(PREFS_KEY, state.prefs);
    });

    els.favoriteOnly?.addEventListener("click", () => {
      state.favoriteOnly = !state.favoriteOnly;
      state.visibleCount = PAGE_SIZE;
      syncCounters();
      renderList();
    });

    els.hideKnown?.addEventListener("click", () => {
      state.hideKnown = !state.hideKnown;
      state.prefs.hideKnown = state.hideKnown;
      state.visibleCount = PAGE_SIZE;
      syncCounters();
      renderList();
      writeStore(PREFS_KEY, state.prefs);
    });

    els.blurMode?.addEventListener("click", () => {
      state.blurMode = !state.blurMode;
      if (!state.blurMode) {
        clearReveals();
      }
      syncCounters();
      showToast(
        state.blurMode
          ? "释义已模糊：点某个单词只看这一条，按钮会跟着页面滚动"
          : "释义已恢复清晰",
      );
    });

    els.drawMode?.addEventListener("click", () => {
      if (state.drawOpen) {
        closeDrawMode();
      } else {
        openDrawMode();
      }
    });

    els.drawControls?.addEventListener("click", (event) => {
      const order = event.target.closest("[data-draw-order]");
      if (order) {
        const nextOrder = DRAW_ORDERS.includes(order.dataset.drawOrder)
          ? order.dataset.drawOrder
          : "random";
        if (nextOrder !== state.drawOrder) {
          state.drawOrder = nextOrder;
          state.prefs.drawOrder = nextOrder;
          writeStore(PREFS_KEY, state.prefs);
          syncDrawControls();
          resetDrawRound();
        }
        return;
      }
      const scope = event.target.closest("[data-draw-scope]");
      if (scope) {
        const nextScope = DRAW_SCOPES.includes(scope.dataset.drawScope)
          ? scope.dataset.drawScope
          : "all";
        if (nextScope !== state.drawScope) {
          state.drawScope = nextScope;
          state.prefs.drawScope = nextScope;
          writeStore(PREFS_KEY, state.prefs);
          syncDrawControls();
          resetDrawRound();
        }
        return;
      }
      const days = event.target.closest("[data-draw-days]");
      if (days) {
        const parsed = Number(days.dataset.drawDays);
        const nextDays = DRAW_DAY_RANGES.includes(parsed) ? parsed : 0;
        if (nextDays !== state.drawDays) {
          state.drawDays = nextDays;
          state.prefs.drawDays = nextDays;
          writeStore(PREFS_KEY, state.prefs);
          syncDrawControls();
          resetDrawRound();
        }
      }
    });

    els.list?.addEventListener("click", (event) => {
      const quick = event.target.closest("[data-quick-recite]");
      if (quick) {
        recordRecite(quick.dataset.quickRecite, quick.dataset.word, {
          source: `vocab-list:${state.deckKey}`,
        });
        return;
      }
      const row = event.target.closest(".vocab-row");
      if (row) {
        // 模糊复习时第一下先把这一条看清，再点才进词卡。
        if (state.blurMode && !row.classList.contains("is-revealed")) {
          row.classList.add("is-revealed");
          return;
        }
        openWord(row.dataset.openWord || row.dataset.word);
      }
    });

    els.detail?.addEventListener("click", (event) => {
      if (!state.blurMode) {
        return;
      }
      const block = event.target.closest(".vocab-block");
      if (block && !block.classList.contains("is-revealed")) {
        block.classList.add("is-revealed");
      }
    });

    els.drawAnswer?.addEventListener("click", () => {
      if (state.blurMode) {
        els.drawAnswer.classList.add("is-revealed");
      }
    });

    els.loadMore?.addEventListener("click", () => {
      state.visibleCount += PAGE_SIZE;
      renderList();
    });

    els.closeWord?.addEventListener("click", () => {
      setPanelOpen(false);
    });

    els.speakWord?.addEventListener("click", speakWord);
    els.favoriteWord?.addEventListener("click", () => toggleFavorite(state.activeWord));
    els.wordbookToggle?.addEventListener("click", () => toggleWordbook(state.activeWord));

    els.reciteBar?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-recite]");
      if (button) {
        recordRecite(button.dataset.recite);
      }
    });

    els.drawReveal?.addEventListener("click", revealDrawCard);
    els.drawNext?.addEventListener("click", nextDrawCard);
    els.drawClose?.addEventListener("click", closeDrawMode);
    els.drawReciteActions?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-draw-recite]");
      if (button) {
        recordDrawRecite(button.dataset.drawRecite);
      }
    });

    els.wordbookButton?.addEventListener("click", () => {
      const open = els.wordbookPanel.hidden;
      els.wordbookPanel.hidden = !open;
      if (open) {
        renderWordbook();
        els.wordbookPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });

    els.closeWordbook?.addEventListener("click", () => {
      els.wordbookPanel.hidden = true;
    });

    els.wordbookList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-word]");
      if (!button) {
        return;
      }
      const key = button.dataset.removeWord;
      const record = state.wordbook.get(key);
      if (record) {
        toggleWordbook(record.word);
      }
    });

    els.clearWordbook?.addEventListener("click", () => {
      if (!state.wordbook.size) {
        showToast("生词本是空的");
        return;
      }
      if (!window.confirm("清空生词本？")) {
        return;
      }
      state.wordbook.clear();
      writeStore(WORDBOOK_KEY, []);
      syncCounters();
      renderWordbook();
      renderList();
      renderStats();
    });

    els.exportWordbook?.addEventListener("click", exportWordbook);
    els.copyWordbook?.addEventListener("click", copyWordbook);
    els.clearProgress?.addEventListener("click", clearProgress);

    window.addEventListener("scroll", scrollProgress, { passive: true });
    window.addEventListener("resize", scrollProgress);
  }

  async function init() {
    state.favorites = new Set(readStore(FAVORITE_KEY, []));
    const savedWordbook = readStore(WORDBOOK_KEY, []);
    state.wordbook = new Map(
      Array.isArray(savedWordbook)
        ? savedWordbook
            .filter((entry) => Array.isArray(entry) && entry[0])
            .map(([key, record]) => [String(key), record || { word: key }])
        : [],
    );
    const prefs = readStore(PREFS_KEY, null);
    if (prefs && typeof prefs === "object") {
      state.prefs = { ...state.prefs, ...prefs };
      state.sort = SORT_MODES.includes(state.prefs.sort) ? state.prefs.sort : "default";
      state.hideKnown = Boolean(state.prefs.hideKnown);
      state.drawOrder = DRAW_ORDERS.includes(state.prefs.drawOrder)
        ? state.prefs.drawOrder
        : "random";
      state.drawScope = DRAW_SCOPES.includes(state.prefs.drawScope)
        ? state.prefs.drawScope
        : "all";
      const prefDays = Number(state.prefs.drawDays);
      state.drawDays = DRAW_DAY_RANGES.includes(prefDays) ? prefDays : 0;
    }

    // 封神之路等页面用 ?deck=llyc2027&word=xxx 直接跳到某张词卡。
    const params = new URLSearchParams(window.location.search);
    const deckParam = params.get("deck");
    if (deckParam && DECKS[deckParam]) {
      state.prefs.deckKey = deckParam;
    }
    const hideKnownParam = params.get("hideKnown");
    if (hideKnownParam === "1" || hideKnownParam === "true") {
      state.hideKnown = true;
      state.prefs.hideKnown = true;
    }
    // 每日任务里的「单词斩」入口：?deck=xxx&draw=1&drawScope=unlearned
    const drawScopeParam = params.get("drawScope");
    if (drawScopeParam && DRAW_SCOPES.includes(drawScopeParam)) {
      state.drawScope = drawScopeParam;
      state.prefs.drawScope = drawScopeParam;
    }
    const drawOrderParam = params.get("drawOrder");
    if (drawOrderParam && DRAW_ORDERS.includes(drawOrderParam)) {
      state.drawOrder = drawOrderParam;
      state.prefs.drawOrder = drawOrderParam;
    }
    const drawDaysParam = Number(params.get("drawDays"));
    if (DRAW_DAY_RANGES.includes(drawDaysParam)) {
      state.drawDays = drawDaysParam;
      state.prefs.drawDays = drawDaysParam;
    }
    const drawParam = params.get("draw");
    const startDraw = drawParam === "1" || drawParam === "true";
    const focusWord = (params.get("word") || "").trim();

    bindEvents();
    window.IballVocabRecite?.subscribe(() => {
      refreshRecite();
      renderList();
      renderStats();
      syncCounters();
      syncReciteBar();
      updateDeckMeta();
      if (state.drawOpen) {
        renderDrawCard();
      }
    });
    refreshRecite();
    syncCounters();
    renderStats();
    scrollProgress();

    els.sortGroup?.querySelectorAll("[data-sort]").forEach((node) => {
      const active = node.dataset.sort === state.sort;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    });

    try {
      await loadIndex();
    } catch {
      // 清单失败不影响词表本身，词库统计会退回本地计数。
    }
    await selectDeck(state.prefs.deckKey);
    if (startDraw) {
      openDrawMode();
    }
    if (focusWord) {
      if (els.search) {
        els.search.value = focusWord;
      }
      openWord(focusWord);
    }
    scheduleQuickIndex();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
