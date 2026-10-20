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
 * 收藏、生词本、学习进度都只写 localStorage；写入的键都带 iball_ 前缀，
 * account-store 负责按清单 / 映射合并后同步到账号云端（多端一致）。
 *
 * 词汇库分两级入口：
 *   不会的单词 → vocab-library.js 归集的各模块生词（来源可筛选、可回溯原文）
 *   我的词书   → vocab-userbook.js 里用户自己导入的词书 + 逐词进度
 */
(function () {
  "use strict";

  // 词表文件不常改，但一旦更新就必须绕开旧 CDN 副本。
  // 发布新词表时同步更新这个版本号，避免部分节点继续返回旧词数。
  const DATA_VERSION = "20261020-basic1440";
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

  /**
   * 词汇库的来源筛选。
   *
   * level 命中「来源」；core 命中对应的核心词表；两者同时存在时取并集
   * （例如「四级全部」= 四级核心词 + 各模块里收进来的四级生词）。
   */
  const LIBRARY_FILTERS = [
    { key: "all", label: "全部来源", hint: "所有级别、所有来源的汇总" },
    { key: "cet4:reading", label: "四级阅读不会", level: "cet4", module: "reading" },
    { key: "cet4:listening", label: "四级听力不会", level: "cet4", module: "listening" },
    { key: "cet4:unknown", label: "四级全部不会", level: "cet4" },
    { key: "cet4:core", label: "四级核心词", core: "cet4" },
    { key: "cet4:all", label: "四级全部", level: "cet4", core: "cet4" },
    { key: "cet6:reading", label: "六级阅读不会", level: "cet6", module: "reading" },
    { key: "cet6:listening", label: "六级听力不会", level: "cet6", module: "listening" },
    { key: "cet6:unknown", label: "六级全部不会", level: "cet6" },
    { key: "cet6:core", label: "六级核心词", core: "cet6" },
    { key: "cet6:all", label: "六级全部", level: "cet6", core: "cet6" },
    { key: "kaoyan:reading", label: "考研阅读不会", level: "kaoyan", module: "reading" },
    { key: "kaoyan:unknown", label: "考研全部不会", level: "kaoyan" },
    { key: "kaoyan:core", label: "考研核心词", core: "kaoyan" },
    { key: "kaoyan:all", label: "考研全部", level: "kaoyan", core: "kaoyan" },
    { key: "periodical", label: "外刊生词", level: "periodical" },
    { key: "wordbook", label: "我的词书", level: "wordbook" },
  ];

  // 核心词筛选按需加载对应词表；加载失败只影响这几个筛选，不影响来源筛选。
  const LIBRARY_CORE_DECKS = { cet4: "cet4", cet6: "cet6", kaoyan: "kaoyan1" };

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
    basic: { deck: "basic", label: "零基础", title: "零基础词汇讲义 Level 1–2" },
  };

  /** 认不出来的词库（历史偏好 / URL 参数）一律回退到默认词库。 */
  function deckConfig(deckKey) {
    return DECKS[deckKey] || DECKS[DEFAULT_DECK];
  }

  const els = {
    board: document.querySelector(".vocab-board"),
    listBoard: document.getElementById("wordPanel")?.closest(".vocab-board") || null,
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
    libraryButton: document.getElementById("libraryButton"),
    libraryCount: document.getElementById("libraryCount"),
    libraryBoard: document.getElementById("libraryBoard"),
    libraryMeta: document.getElementById("libraryMeta"),
    librarySearch: document.getElementById("librarySearch"),
    librarySelectAll: document.getElementById("librarySelectAllButton"),
    libraryClearSelection: document.getElementById("libraryClearSelectionButton"),
    libraryCustom: document.getElementById("libraryCustomButton"),
    librarySelectedCount: document.getElementById("librarySelectedCount"),
    libraryReview: document.getElementById("libraryReviewButton"),
    libraryDeleteSelected: document.getElementById("libraryDeleteSelectedButton"),
    libraryClose: document.getElementById("libraryCloseButton"),
    libraryFilters: document.getElementById("libraryFilters"),
    libraryList: document.getElementById("libraryList"),
    libraryLoadMore: document.getElementById("libraryLoadMoreButton"),
    libraryStatus: document.getElementById("libraryStatus"),
    libraryProgressFilters: document.getElementById("libraryProgressFilters"),
    libraryBack: document.getElementById("libraryBackButton"),
    libraryEntry: document.getElementById("libraryEntry"),
    libraryEntryNotebook: document.getElementById("libraryEntryNotebook"),
    libraryEntryNotebookCount: document.getElementById("libraryEntryNotebookCount"),
    libraryEntryBooks: document.getElementById("libraryEntryBooks"),
    libraryEntryBooksCount: document.getElementById("libraryEntryBooksCount"),
    libraryBooksView: document.getElementById("libraryBooksView"),
    libraryBookList: document.getElementById("libraryBookList"),
    libraryBooksStatus: document.getElementById("libraryBooksStatus"),
    libraryBookImport: document.getElementById("libraryBookImportButton"),
    libraryBookExportAll: document.getElementById("libraryBookExportAllButton"),
    libraryBookView: document.getElementById("libraryBookView"),
    libraryBookSearch: document.getElementById("libraryBookSearch"),
    libraryBookExport: document.getElementById("libraryBookExportButton"),
    libraryBookRename: document.getElementById("libraryBookRenameButton"),
    libraryBookReview: document.getElementById("libraryBookReviewButton"),
    libraryBookDelete: document.getElementById("libraryBookDeleteButton"),
    libraryBookProgressFilters: document.getElementById("libraryBookProgressFilters"),
    libraryBookListWords: document.getElementById("libraryBookListWords"),
    libraryBookLoadMore: document.getElementById("libraryBookLoadMoreButton"),
    libraryBookStatus: document.getElementById("libraryBookStatus"),
    libraryNotebookView: document.getElementById("libraryNotebookView"),
    libraryImportDialog: document.getElementById("libraryImportDialog"),
    libraryImportName: document.getElementById("libraryImportName"),
    libraryImportText: document.getElementById("libraryImportText"),
    libraryImportFile: document.getElementById("libraryImportFile"),
    libraryImportFileButton: document.getElementById("libraryImportFileButton"),
    libraryImportConfirm: document.getElementById("libraryImportConfirmButton"),
    libraryImportCancel: document.getElementById("libraryImportCancelButton"),
    libraryImportStatus: document.getElementById("libraryImportStatus"),
    libraryModeSwitches: Array.from(document.querySelectorAll("[data-library-mode]")),
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
    basicQuick: new Map(),
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
    libraryOpen: false,
    libraryView: "entry",
    libraryBookId: "",
    libraryBookSearch: "",
    libraryBookVisibleCount: PAGE_SIZE,
    libraryFilters: new Set(),
    libraryFilterMode: "all",
    libraryProgressFilters: new Set(),
    libraryProgressMode: "all",
    libraryBookProgressFilters: new Set(),
    libraryBookProgressMode: "all",
    libraryQuery: "",
    librarySelected: new Set(),
    libraryCustomOnly: false,
    libraryVisibleCount: PAGE_SIZE,
    libraryCoreSets: new Map(),
    libraryCorePromise: null,
    drawPoolOverride: null,
    drawPoolLabel: "",
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

  function formatPhonetic(value) {
    const text = String(value || "").trim().replace(/^[/\[\s]+|[/\]\s]+$/g, "");
    return text ? `/${text}/` : "";
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
      if (cacheKey === "basic") {
        state.basicQuick = new Map((data.entries || []).map(([word, phonetic, meaning]) => [
          normalize(word), { phonetic, meaning, tags: ["零基础"] },
        ]));
      }
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
    const entry = state.shardCache.get(shard)?.get(key) || null;
    if (state.deckKey === "basic" && entry?.basic) {
      return { ...entry, phonetic: entry.basic.phonetic, translation: entry.basic.translation,
        example: entry.basic.examples?.[0] || entry.example, handoutExamples: entry.basic.examples,
        handoutGroup: entry.basic.group, handoutHeadword: entry.basic.headword };
    }
    return entry;
  }

  /** 轻量释义：点词索引里的「音标 / 释义 / 标签」。 */
  function quickEntry(word) {
    const key = normalize(word);
    if (state.deckKey === "basic" && state.basicQuick.has(key)) return state.basicQuick.get(key);
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
    // （零基础按讲义 Level / Day，恋练有词按单元；其他词库按各自导出顺序），
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
                  quick?.phonetic ? `<small>${escapeHtml(formatPhonetic(quick.phonetic))}</small>` : ""
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
    if (Array.isArray(state.drawPoolOverride)) {
      // 词汇库「复习当前」：直接把筛选结果当词池，不再叠加抽卡范围条件。
      return state.drawPoolOverride.filter((word) => Boolean(normalize(word)));
    }
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
      const pool = state.drawPoolOverride
        ? `${state.drawPoolLabel || "自定义词池"} · 共 ${candidates.length} 词`
        : `${drawOrderLabel()} · ${drawScopeLabel()} · ${drawDaysLabel()} · 共 ${candidates.length} 词`;
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
      els.drawPhonetic.textContent = formatPhonetic(quick?.phonetic);
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

  function openDrawMode(options = {}) {
    if (!els.drawPanel) {
      return;
    }
    state.drawPoolOverride = Array.isArray(options.pool) ? options.pool.slice() : null;
    state.drawPoolLabel = state.drawPoolOverride
      ? String(options.label || "自定义词池")
      : "";
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
    state.drawPoolOverride = null;
    state.drawPoolLabel = "";
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
              ? `<div class="vocab-head-line"><span>${escapeHtml(formatPhonetic(quick.phonetic))}</span></div>`
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
          ${entry.phonetic ? `<span>${escapeHtml(formatPhonetic(entry.phonetic))}</span>` : ""}
          ${entry.handoutGroup ? `<span class="vocab-tag">${escapeHtml(entry.handoutGroup)}</span>` : ""}
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
    if (entry.handoutExamples?.length > 1) {
      blocks.push(`<div class="vocab-block"><h4>讲义补充例句</h4>${entry.handoutExamples.slice(1)
        .map(line => `<p class="vocab-example">${escapeHtml(line)}</p>`).join("")}</div>`);
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
    syncLibraryCounters();
    syncReciteBar();
  }

  function setPanelOpen(open) {
    if (!els.panel) {
      return;
    }
    els.panel.hidden = !open;
    // 词卡面板会在「词库」和「我的词汇库」两个板之间搬动，has-detail 跟随所在板。
    document.querySelectorAll(".vocab-board").forEach((board) => {
      board.classList.toggle("has-detail", open && board.contains(els.panel));
    });
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
      frequencyButton.textContent = config === "basic" ? "讲义顺序" : config === "llyc2027" ? "单元顺序" : "高频优先";
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

  /* ------------------------------------------------------------- 词汇库 */

  // 词汇库数据由各模块的「不会」标记写入，account-store 负责多端同步；
  // 这里只做展示、筛选、勾选组合与回跳原文。

  function libraryApi() {
    return window.IballVocabLibrary || null;
  }

  function librarySourceLevel(source) {
    const level = String(source?.level || "").trim();
    if (level) {
      return level;
    }
    return String(source?.module || "").trim() === "periodical" ? "periodical" : "";
  }

  function libraryFilterConfig(key) {
    return LIBRARY_FILTERS.find((item) => item.key === key) || null;
  }

  function libraryCoreSet(level) {
    return state.libraryCoreSets.get(level) || null;
  }

  function libraryRecordMatches(record, filterKey) {
    if (!filterKey || filterKey === "all") {
      return true;
    }
    const filter = libraryFilterConfig(filterKey);
    if (!filter) {
      return true;
    }
    const sources = Array.isArray(record?.sources) ? record.sources : [];
    const sourceMatch = filter.level
      ? sources.some((source) => {
          if (librarySourceLevel(source) !== filter.level) {
            return false;
          }
          return !filter.module || String(source?.module || "") === filter.module;
        })
      : false;
    if (filter.module || !filter.core) {
      return sourceMatch;
    }
    const core = libraryCoreSet(filter.core);
    const coreMatch = core ? core.has(normalize(record?.word)) : false;
    return filter.level ? sourceMatch || coreMatch : coreMatch;
  }

  function libraryRecords() {
    const api = libraryApi();
    return api ? api.list() : [];
  }

  function userbookApi() {
    return window.IballVocabUserbook || null;
  }

  function libraryMatchesFilters(record, filters) {
    if (!filters || !filters.size) {
      return true;
    }
    return [...filters].some((key) => libraryRecordMatches(record, key));
  }

  /** 一个词当前的背词进度：优先词书里的逐词记录，其次当前词库的背词记录。 */
  function libraryProgressStatus(word) {
    const latest = userbookApi()?.latestStatusFor?.(word);
    if (latest?.status) {
      return latest.status;
    }
    const recite = window.IballVocabRecite;
    const record = recite?.getRecord?.(state.deckKey, word);
    return record?.status || "none";
  }

  function libraryFilteredRecords() {
    let records = libraryRecords();
    if (state.libraryFilterMode !== "all") {
      records = records.filter((record) =>
        libraryMatchesFilters(record, state.libraryFilters),
      );
    }
    if (state.libraryProgressMode !== "all") {
      records = records.filter((record) =>
        state.libraryProgressFilters.has(libraryProgressStatus(record.word)),
      );
    }
    if (state.libraryCustomOnly) {
      records = records.filter((record) =>
        state.librarySelected.has(normalize(record.word)),
      );
    }
    const query = state.libraryQuery;
    if (query) {
      records = records.filter((record) => {
        if (normalize(record.word).includes(query)) {
          return true;
        }
        if (normalize(record.meaning).includes(query)) {
          return true;
        }
        const quick = quickEntry(record.word);
        if (quick && normalize(quick.meaning).includes(query)) {
          return true;
        }
        const api = libraryApi();
        return (Array.isArray(record.sources) ? record.sources : []).some((source) =>
          normalize(api?.describeSource?.(source) || "").includes(query),
        );
      });
    }
    return records;
  }

  /** 核心词筛选按需加载词表；词表是现成的，加载完重渲染一次即可。 */
  function ensureLibraryCoreSets() {
    if (state.libraryCorePromise) {
      return state.libraryCorePromise;
    }
    const entries = Object.entries(LIBRARY_CORE_DECKS);
    state.libraryCorePromise = Promise.all(
      entries.map(async ([level, deckKey]) => {
        if (state.libraryCoreSets.has(level)) {
          return;
        }
        try {
          const words = await loadDeck(deckKey);
          state.libraryCoreSets.set(
            level,
            new Set(words.map((word) => normalize(word)).filter(Boolean)),
          );
        } catch {
          state.libraryCoreSets.set(level, new Set());
        }
      }),
    ).then(() => {
      state.libraryCorePromise = null;
      if (state.libraryOpen) {
        renderLibraryBoard();
      }
    });
    return state.libraryCorePromise;
  }

  const LIBRARY_PROGRESS_FILTERS = [
    { key: "all", label: "全部" },
    { key: "none", label: "未背" },
    { key: "known", label: "已斩" },
    { key: "fuzzy", label: "模糊" },
    { key: "unknown", label: "不会" },
  ];

  function libraryBooks() {
    return userbookApi()?.listBooks?.() || [];
  }

  function libraryMetaText() {
    const total = libraryRecords().length;
    const books = libraryBooks();
    if (state.libraryView === "book") {
      const book = userbookApi()?.getBook?.(state.libraryBookId);
      if (book) {
        return `${book.name} · ${book.words.length} 词 · 标「不会」自动进「不会的单词」`;
      }
      return "词书不存在或已被删除";
    }
    if (state.libraryView === "books") {
      return `${books.length} 本词书 · 导入后逐词记 未背 / 已斩 / 模糊 / 不会`;
    }
    if (state.libraryView === "notebook") {
      return `共 ${total} 词 · 当前筛选 ${libraryFilteredRecords().length} 词 · 随账号同步`;
    }
    return `不会的单词 ${total} 词 · 我的词书 ${books.length} 本`;
  }

  function syncLibraryCounters() {
    const total = libraryRecords().length;
    const books = libraryBooks();
    if (els.libraryCount) {
      els.libraryCount.textContent = String(total);
    }
    if (els.libraryEntryNotebookCount) {
      els.libraryEntryNotebookCount.textContent = `${total} 词`;
    }
    if (els.libraryEntryBooksCount) {
      els.libraryEntryBooksCount.textContent = `${books.length} 本`;
    }
    if (els.librarySelectedCount) {
      els.librarySelectedCount.textContent = String(state.librarySelected.size);
    }
    if (els.libraryClearSelection) {
      els.libraryClearSelection.hidden = state.librarySelected.size === 0;
    }
    els.libraryCustom?.setAttribute("aria-pressed", String(state.libraryCustomOnly));
    els.libraryCustom?.classList.toggle("is-primary", state.libraryCustomOnly);
    if (els.libraryDeleteSelected) {
      els.libraryDeleteSelected.disabled = state.librarySelected.size === 0;
    }
  }

  function syncLibraryModeSwitches() {
    els.libraryModeSwitches.forEach((group) => {
      const name = String(group.dataset.libraryMode || "");
      const mode =
        name === "source"
          ? state.libraryFilterMode
          : name === "progress"
            ? state.libraryProgressMode
            : state.libraryBookProgressMode;
      group.querySelectorAll("[data-library-mode-value]").forEach((button) => {
        const active = button.dataset.libraryModeValue === mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    });
  }

  function renderLibraryFilters() {
    if (!els.libraryFilters) {
      return;
    }
    const records = libraryRecords();
    els.libraryFilters.innerHTML = LIBRARY_FILTERS.map((filter) => {
      const corePending = Boolean(filter.core) && !libraryCoreSet(filter.core);
      const count =
        filter.key === "all"
          ? records.length
          : records.filter((record) => libraryRecordMatches(record, filter.key)).length;
      const active =
        filter.key === "all"
          ? state.libraryFilterMode === "all" || !state.libraryFilters.size
          : state.libraryFilters.has(filter.key);
      return `
        <button
          class="library-chip${active ? " is-active" : ""}"
          type="button"
          data-library-filter="${escapeHtml(filter.key)}"
          aria-pressed="${active}"
          title="${escapeHtml(filter.hint || filter.label)}"
        >${escapeHtml(filter.label)}<span class="library-chip-count">${
          corePending ? `${count}+` : count
        }</span></button>`;
    }).join("");
  }

  /** 进度筛选（未背 / 已斩 / 模糊 / 不会）在三处复用：不会的单词 + 我的词书。 */
  function renderLibraryProgressFilters() {
    if (!els.libraryProgressFilters) {
      return;
    }
    const records = libraryRecords();
    const counts = { all: records.length, none: 0, known: 0, fuzzy: 0, unknown: 0 };
    records.forEach((record) => {
      const status = libraryProgressStatus(record.word);
      counts[status] = (counts[status] || 0) + 1;
    });
    els.libraryProgressFilters.innerHTML = LIBRARY_PROGRESS_FILTERS.map((filter) => {
      const active =
        filter.key === "all"
          ? state.libraryProgressMode === "all" || !state.libraryProgressFilters.size
          : state.libraryProgressFilters.has(filter.key);
      return `
        <button
          class="library-chip${active ? " is-active" : ""}"
          type="button"
          data-library-progress="${escapeHtml(filter.key)}"
          aria-pressed="${active}"
        >${escapeHtml(filter.label)}<span class="library-chip-count">${
          counts[filter.key] || 0
        }</span></button>`;
    }).join("");
  }

  function librarySourceHtml(source) {
    const api = libraryApi();
    const label = api?.sourceLabel ? api.sourceLabel(source) : "其他";
    const desc = api?.describeSource ? api.describeSource(source) : "";
    const url = api?.returnUrl ? api.returnUrl(source) : "";
    const isWordbook = source?.level === "wordbook" || source?.module === "userbook";
    const sentence = source?.sentence
      ? `<span class="library-source-sentence">${escapeHtml(
          String(source.sentence).slice(0, 160),
        )}</span>`
      : "";
    return `
      <li class="library-source">
        <span class="library-source-chip">${escapeHtml(label)}</span>
        <span class="library-source-desc">${escapeHtml(desc)}</span>
        ${
          url
            ? `<a class="library-source-link" href="${escapeHtml(url)}">${
                isWordbook ? "回到词书" : "回到原文"
              }</a>`
            : ""
        }
        ${sentence}
      </li>`;
  }

  function libraryCardHtml(record) {
    const key = normalize(record.word);
    const quick = quickEntry(record.word);
    const phonetic = record.phonetic || quick?.phonetic || "";
    const meaning =
      record.meaning || quick?.meaning || "释义还没加载，点开词卡可以看完整内容。";
    const sources = Array.isArray(record.sources) ? record.sources : [];
    const picked = state.librarySelected.has(key);
    const status = libraryProgressStatus(record.word);
    const statusLabel = userbookApi()?.statusLabel?.(status) || "未背";
    return `
      <article class="library-card${picked ? " is-picked" : ""}" data-word="${escapeHtml(
        record.word,
      )}">
        <header class="library-card-head">
          <label class="library-pick" title="勾选后可以做自定义组合或批量删除">
            <input
              type="checkbox"
              data-library-pick="${escapeHtml(record.word)}"
              ${picked ? "checked" : ""}
              aria-label="勾选 ${escapeHtml(record.word)}"
            />
          </label>
          <button class="library-word" type="button" data-library-open="${escapeHtml(
            record.word,
          )}" aria-label="查看 ${escapeHtml(record.word)} 的词卡">
            <span class="library-word-text">${escapeHtml(record.word)}</span>
            ${phonetic ? `<small>${escapeHtml(formatPhonetic(phonetic))}</small>` : ""}
            <span class="library-progress-badge is-${escapeHtml(status)}">${escapeHtml(
              statusLabel,
            )}</span>
          </button>
          <button
            class="library-remove"
            type="button"
            data-library-remove="${escapeHtml(record.word)}"
            title="从词汇库删除；原文里的「不会」标记不受影响"
          >删除</button>
        </header>
        <p class="library-meaning">${escapeHtml(meaning)}</p>
        ${
          sources.length
            ? `<ul class="library-sources">${sources
                .map((source) => librarySourceHtml(source))
                .join("")}</ul>`
            : `<p class="library-source-desc">这条记录没有来源信息，可能是旧版本数据。</p>`
        }
      </article>`;
  }

  function renderLibraryList() {
    if (!els.libraryList) {
      return;
    }
    const pendingCore =
      state.libraryFilterMode === "all"
        ? null
        : [...state.libraryFilters]
            .map((key) => libraryFilterConfig(key))
            .find((filter) => filter?.core && !libraryCoreSet(filter.core));
    if (pendingCore) {
      ensureLibraryCoreSets();
      els.libraryList.innerHTML = `<p class="vocab-empty">正在加载「${escapeHtml(
        pendingCore.label,
      )}」的词表…</p>`;
      if (els.libraryLoadMore) {
        els.libraryLoadMore.hidden = true;
      }
      if (els.libraryStatus) {
        els.libraryStatus.textContent = "正在加载词表";
      }
      return;
    }
    const total = libraryRecords().length;
    const records = libraryFilteredRecords();
    if (!records.length) {
      els.libraryList.innerHTML = `<p class="vocab-empty">${
        total
          ? "当前筛选下没有单词。换个来源筛选、清掉搜索词或取消自定义组合再试。"
          : "词汇库里还没有单词。去精读、听力或真题里把不认识的词标记一下，这里会自动归集。"
      }</p>`;
      if (els.libraryLoadMore) {
        els.libraryLoadMore.hidden = true;
      }
      if (els.libraryStatus) {
        els.libraryStatus.textContent = total
          ? `共 ${total} 词，当前筛选 0 词`
          : "词汇库是空的";
      }
      return;
    }
    const shown = records.slice(0, state.libraryVisibleCount);
    els.libraryList.innerHTML = shown
      .map((record) => libraryCardHtml(record))
      .join("");
    if (els.libraryLoadMore) {
      els.libraryLoadMore.hidden = shown.length >= records.length;
    }
    if (els.libraryStatus) {
      els.libraryStatus.textContent = `已显示 ${shown.length} / ${records.length} 个单词`;
    }
  }

  /* ------------------------------------------- 我的词书：列表 / 某本词书 */

  function renderLibraryBooks() {
    const api = userbookApi();
    const books = libraryBooks();
    if (els.libraryBookList) {
      if (!books.length) {
        els.libraryBookList.innerHTML = `<p class="vocab-empty">还没有词书。点「导入词书」，把要背的词表导进来：一行一个词，也可以粘贴 CSV / JSON 或选择文件。</p>`;
      } else {
        els.libraryBookList.innerHTML = books
          .map((book) => {
            const totals = api?.summary?.(api.deckFor(book.id)) || {
              known: 0,
              fuzzy: 0,
              unknown: 0,
            };
            const studied = totals.known + totals.fuzzy + totals.unknown;
            const percent = book.words.length
              ? Math.min(100, Math.round((studied / book.words.length) * 100))
              : 0;
            return `
              <button class="library-book-card" type="button" data-library-book="${escapeHtml(
                book.id,
              )}">
                <span class="library-book-head">
                  <strong>${escapeHtml(book.name)}</strong>
                  <span class="library-book-count">${book.words.length} 词</span>
                </span>
                <span class="library-book-meta">已斩 ${totals.known} · 模糊 ${totals.fuzzy} · 不会 ${totals.unknown} · 未背 ${Math.max(
                  0,
                  book.words.length - studied,
                )}</span>
                <span class="library-book-bar" aria-hidden="true"><i style="width:${percent}%"></i></span>
              </button>`;
          })
          .join("");
      }
    }
    if (els.libraryBooksStatus) {
      els.libraryBooksStatus.textContent = books.length
        ? `共 ${books.length} 本词书 · 词书里标「不会」的词会自动进「不会的单词」`
        : "";
    }
  }

  /** 某本词书按 进度 + 搜索 过滤后的词表（也是「复习当前」的数据源）。 */
  function libraryBookWords() {
    const api = userbookApi();
    const book = api?.getBook?.(state.libraryBookId) || null;
    if (!api || !book) {
      return { book: null, words: [] };
    }
    const progress = api.progressMap(api.deckFor(book.id));
    let words = book.words.map((entry) => ({
      ...entry,
      status: progress.get(api.normalizeWord(entry.word))?.status || "none",
    }));
    if (state.libraryBookProgressMode !== "all" && state.libraryBookProgressFilters.size) {
      words = words.filter((item) => state.libraryBookProgressFilters.has(item.status));
    }
    const query = state.libraryBookSearch;
    if (query) {
      words = words.filter(
        (item) =>
          api.normalizeWord(item.word).includes(query) ||
          normalize(item.meaning).includes(query),
      );
    }
    return { book, words };
  }

  function bookWordCardHtml(item) {
    const status = item.status;
    const label = userbookApi()?.statusLabel?.(status) || "未背";
    const quick = quickEntry(item.word);
    const phonetic = item.phonetic || quick?.phonetic || "";
    const meaning = item.meaning || quick?.meaning || "没有释义，点开词卡可以看完整内容。";
    const actions = [
      ["known", "已斩"],
      ["fuzzy", "模糊"],
      ["unknown", "不会"],
      ["none", "未背"],
    ]
      .map(
        ([key, text]) => `
          <button
            class="library-status-button${status === key ? " is-active" : ""}"
            type="button"
            data-book-status="${key}"
            data-book-word="${escapeHtml(item.word)}"
            aria-pressed="${status === key}"
          >${text}</button>`,
      )
      .join("");
    return `
      <article class="library-card library-book-word" data-word="${escapeHtml(item.word)}">
        <header class="library-card-head">
          <button class="library-word" type="button" data-library-open="${escapeHtml(
            item.word,
          )}" aria-label="查看 ${escapeHtml(item.word)} 的词卡">
            <span class="library-word-text">${escapeHtml(item.word)}</span>
            ${phonetic ? `<small>${escapeHtml(formatPhonetic(phonetic))}</small>` : ""}
          </button>
          <span class="library-progress-badge is-${escapeHtml(status)}">${escapeHtml(
            label,
          )}</span>
        </header>
        <p class="library-meaning">${escapeHtml(meaning)}</p>
        <div class="library-status-actions" role="group" aria-label="标记 ${escapeHtml(
          item.word,
        )} 的背词进度">${actions}</div>
      </article>`;
  }

  function renderLibraryBookProgressFilters() {
    if (!els.libraryBookProgressFilters) {
      return;
    }
    const api = userbookApi();
    const book = api?.getBook?.(state.libraryBookId);
    const counts = { all: 0, none: 0, known: 0, fuzzy: 0, unknown: 0 };
    if (api && book) {
      const progress = api.progressMap(api.deckFor(book.id));
      book.words.forEach((entry) => {
        const status = progress.get(api.normalizeWord(entry.word))?.status || "none";
        counts[status] = (counts[status] || 0) + 1;
        counts.all += 1;
      });
    }
    els.libraryBookProgressFilters.innerHTML = LIBRARY_PROGRESS_FILTERS.map((filter) => {
      const active =
        filter.key === "all"
          ? state.libraryBookProgressMode === "all" ||
            !state.libraryBookProgressFilters.size
          : state.libraryBookProgressFilters.has(filter.key);
      return `
        <button
          class="library-chip${active ? " is-active" : ""}"
          type="button"
          data-book-progress="${escapeHtml(filter.key)}"
          aria-pressed="${active}"
        >${escapeHtml(filter.label)}<span class="library-chip-count">${
          counts[filter.key] || 0
        }</span></button>`;
    }).join("");
  }

  function renderLibraryBook() {
    const api = userbookApi();
    const book = api?.getBook?.(state.libraryBookId) || null;
    renderLibraryBookProgressFilters();
    if (els.libraryBookListWords) {
      if (!book) {
        els.libraryBookListWords.innerHTML = `<p class="vocab-empty">这本书不存在，可能已经在另一台设备上删掉了。</p>`;
      }
    }
    if (els.libraryBookView) {
      els.libraryBookView.classList.toggle("is-missing", !book);
    }
    if (!book || !els.libraryBookListWords) {
      if (els.libraryBookStatus) {
        els.libraryBookStatus.textContent = "";
      }
      if (els.libraryBookLoadMore) {
        els.libraryBookLoadMore.hidden = true;
      }
      return;
    }
    const { words } = libraryBookWords();
    if (!words.length) {
      els.libraryBookListWords.innerHTML = `<p class="vocab-empty">${
        book.words.length
          ? "当前筛选下没有单词，换个进度筛选或清掉搜索词再试。"
          : "这本书是空的。"
      }</p>`;
      if (els.libraryBookLoadMore) {
        els.libraryBookLoadMore.hidden = true;
      }
      if (els.libraryBookStatus) {
        els.libraryBookStatus.textContent = `共 ${book.words.length} 词，当前筛选 0 词`;
      }
      return;
    }
    const shown = words.slice(0, state.libraryBookVisibleCount);
    els.libraryBookListWords.innerHTML = shown.map((item) => bookWordCardHtml(item)).join("");
    if (els.libraryBookLoadMore) {
      els.libraryBookLoadMore.hidden = shown.length >= words.length;
    }
    if (els.libraryBookStatus) {
      els.libraryBookStatus.textContent = `已显示 ${shown.length} / ${words.length} 个单词`;
    }
    if (els.libraryBookSearch && els.libraryBookSearch.value !== state.libraryBookSearch) {
      els.libraryBookSearch.value = state.libraryBookSearch;
    }
  }

  function renderLibraryBoard() {
    if (!els.libraryBoard) {
      return;
    }
    const views = {
      entry: els.libraryEntry,
      books: els.libraryBooksView,
      book: els.libraryBookView,
      notebook: els.libraryNotebookView,
    };
    if (state.libraryView === "book" && !userbookApi()?.getBook?.(state.libraryBookId)) {
      state.libraryView = "books";
    }
    Object.entries(views).forEach(([name, node]) => {
      if (node) {
        node.hidden = name !== state.libraryView;
      }
    });
    if (els.libraryBack) {
      els.libraryBack.hidden = state.libraryView === "entry";
      els.libraryBack.textContent = state.libraryView === "book" ? "返回词书列表" : "返回入口";
    }
    syncLibraryModeSwitches();
    if (state.libraryView === "notebook") {
      renderLibraryFilters();
      renderLibraryProgressFilters();
      renderLibraryList();
    } else if (state.libraryView === "books") {
      renderLibraryBooks();
    } else if (state.libraryView === "book") {
      renderLibraryBook();
    }
    syncLibraryCounters();
    if (els.libraryMeta) {
      els.libraryMeta.textContent = libraryMetaText();
    }
  }

  function setLibraryView(view, bookId = "") {
    const allowed = ["entry", "books", "book", "notebook"];
    state.libraryView = allowed.includes(view) ? view : "entry";
    if (state.libraryView === "book") {
      state.libraryBookId = String(bookId || state.libraryBookId || "");
      state.libraryBookVisibleCount = PAGE_SIZE;
    }
    renderLibraryBoard();
    els.libraryBoard?.querySelector(".vocab-list-panel")?.scrollTo?.({ top: 0 });
  }

  /** 词卡面板跟着打开的那块板走：词库板 / 词汇库板共用同一个面板。 */
  function moveWordPanel(target) {
    if (!els.panel || !target || els.panel.parentElement === target) {
      return;
    }
    els.panel.hidden = true;
    target.appendChild(els.panel);
    document.querySelectorAll(".vocab-board").forEach((board) => {
      board.classList.toggle("has-detail", !els.panel.hidden && board.contains(els.panel));
    });
  }

  function setLibraryOpen(open) {
    if (!els.libraryBoard) {
      return;
    }
    state.libraryOpen = Boolean(open);
    els.libraryBoard.hidden = !state.libraryOpen;
    // 打开词汇库时收起顶部大 hero，让两级入口直接出现在首屏。
    document.documentElement.dataset.vocabLibraryOpen = String(
      state.libraryOpen,
    );
    document.querySelectorAll(".vocab-board").forEach((board) => {
      if (board !== els.libraryBoard) {
        board.hidden = state.libraryOpen;
      }
    });
    if (state.libraryOpen) {
      moveWordPanel(els.libraryBoard);
      state.libraryVisibleCount = PAGE_SIZE;
      state.libraryBookVisibleCount = PAGE_SIZE;
      renderLibraryBoard();
      if (!state.quick) {
        loadQuickIndex().then(() => {
          if (state.libraryOpen) {
            renderLibraryBoard();
          }
        });
      }
      window.requestAnimationFrame(() => {
        els.libraryBoard?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } else {
      moveWordPanel(els.listBoard);
    }
    els.libraryButton?.setAttribute("aria-pressed", String(state.libraryOpen));
    els.libraryButton?.classList.toggle("is-primary", state.libraryOpen);
    syncLibraryCounters();
  }

  function reviewLibraryFilter() {
    const records = libraryFilteredRecords();
    if (!records.length) {
      showToast("当前筛选没有可复习的单词");
      return;
    }
    const labels = [...state.libraryFilters]
      .map((key) => libraryFilterConfig(key)?.label)
      .filter(Boolean);
    openDrawMode({
      pool: records.map((record) => record.word),
      label: `不会的单词 · ${labels.length ? labels.join(" + ") : "全部来源"}`,
    });
  }

  function reviewLibraryBook() {
    const book = userbookApi()?.getBook?.(state.libraryBookId);
    const { words } = libraryBookWords();
    if (!book || !words.length) {
      showToast("当前筛选没有可复习的单词");
      return;
    }
    openDrawMode({
      pool: words.map((item) => item.word),
      label: `我的词书 · ${book.name}`,
    });
  }

  /* --------------------------------------------------- 筛选 / 词书操作 */

  function currentLibraryFilterSet(scope) {
    if (scope === "source") {
      return state.libraryFilters;
    }
    if (scope === "progress") {
      return state.libraryProgressFilters;
    }
    return state.libraryBookProgressFilters;
  }

  function currentLibraryFilterMode(scope) {
    if (scope === "source") {
      return state.libraryFilterMode;
    }
    if (scope === "progress") {
      return state.libraryProgressMode;
    }
    return state.libraryBookProgressMode;
  }

  function setLibraryFilterMode(scope, mode) {
    const value = ["all", "single", "multi"].includes(mode) ? mode : "all";
    const selected = currentLibraryFilterSet(scope);
    if (scope === "source") {
      state.libraryFilterMode = value;
    } else if (scope === "progress") {
      state.libraryProgressMode = value;
    } else {
      state.libraryBookProgressMode = value;
    }
    if (value === "all") {
      selected.clear();
    } else if (value === "single" && selected.size > 1) {
      const first = [...selected][0];
      selected.clear();
      selected.add(first);
    }
    renderLibraryBoard();
  }

  /** 点筛选 chip：全部模式→单选；单选模式→替换；多选模式→叠加 / 取消。 */
  function toggleLibraryFilter(scope, key, isAllKey) {
    const selected = currentLibraryFilterSet(scope);
    const modeKey =
      scope === "source"
        ? "libraryFilterMode"
        : scope === "progress"
          ? "libraryProgressMode"
          : "libraryBookProgressMode";
    if (isAllKey) {
      state[modeKey] = "all";
      selected.clear();
    } else if (state[modeKey] === "multi") {
      if (selected.has(key)) {
        selected.delete(key);
      } else {
        selected.add(key);
      }
      if (!selected.size) {
        state[modeKey] = "all";
      }
    } else {
      state[modeKey] = "single";
      selected.clear();
      selected.add(key);
    }
    if (scope === "source") {
      state.libraryVisibleCount = PAGE_SIZE;
    } else if (scope === "progress") {
      state.libraryVisibleCount = PAGE_SIZE;
    } else {
      state.libraryBookVisibleCount = PAGE_SIZE;
    }
    renderLibraryBoard();
  }

  function downloadTextFile(filename, text, mime = "text/plain;charset=utf-8") {
    try {
      const blob = new Blob([String(text)], { type: mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch {
      return false;
    }
  }

  function safeFilename(name) {
    return (
      String(name || "词书")
        .replace(/[\\/:*?"<>|]+/g, "_")
        .trim()
        .slice(0, 40) || "词书"
    );
  }

  function exportLibraryBook(bookId) {
    const api = userbookApi();
    const book = api?.getBook?.(bookId);
    if (!api || !book) {
      showToast("词书不存在");
      return;
    }
    const text = api.exportBook(book.id);
    if (!downloadTextFile(`${safeFilename(book.name)}.csv`, `\uFEFF${text}`, "text/csv;charset=utf-8")) {
      showToast("导出失败，浏览器拦住了下载");
      return;
    }
    showToast(`已导出「${book.name}」`);
  }

  function exportAllLibraryBooks() {
    const api = userbookApi();
    const books = libraryBooks();
    if (!api || !books.length) {
      showToast("还没有词书可以导出");
      return;
    }
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      books,
      progress: api.listProgress(),
    };
    if (
      !downloadTextFile(
        `我的词书-${books.length}本.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8",
      )
    ) {
      showToast("导出失败，浏览器拦住了下载");
      return;
    }
    showToast(`已导出 ${books.length} 本词书`);
  }

  function openLibraryImport() {
    if (!els.libraryImportDialog) {
      return;
    }
    els.libraryImportDialog.hidden = false;
    if (els.libraryImportName) {
      els.libraryImportName.value = "";
    }
    if (els.libraryImportText) {
      els.libraryImportText.value = "";
    }
    if (els.libraryImportStatus) {
      els.libraryImportStatus.textContent = "";
    }
    window.requestAnimationFrame(() => els.libraryImportName?.focus());
  }

  function closeLibraryImport() {
    if (els.libraryImportDialog) {
      els.libraryImportDialog.hidden = true;
    }
  }

  function submitLibraryImport() {
    const api = userbookApi();
    if (!api) {
      return;
    }
    const words = api.parseImport(els.libraryImportText?.value || "");
    if (!words.length) {
      if (els.libraryImportStatus) {
        els.libraryImportStatus.textContent =
          "没解析出单词。一行一个词就行，例如：apple 苹果。";
      }
      return;
    }
    const typedName = String(els.libraryImportName?.value || "").trim();
    const book = api.createBook({
      name: typedName || `导入词书 ${new Date().toLocaleDateString("zh-CN")}`,
      words,
    });
    if (!book) {
      if (els.libraryImportStatus) {
        els.libraryImportStatus.textContent =
          "导入失败：本地存储写不进去，可能是浏览器空间满了。";
      }
      return;
    }
    closeLibraryImport();
    showToast(`已导入「${book.name}」共 ${book.words.length} 词`);
    setLibraryView("book", book.id);
  }

  function renameLibraryBook() {
    const api = userbookApi();
    const book = api?.getBook?.(state.libraryBookId);
    if (!api || !book) {
      return;
    }
    const name = window.prompt("词书名称", book.name);
    if (name === null) {
      return;
    }
    const updated = api.updateBook(book.id, { name });
    if (updated) {
      showToast(`已重命名为「${updated.name}」`);
    }
  }

  function deleteLibraryBook() {
    const api = userbookApi();
    const book = api?.getBook?.(state.libraryBookId);
    if (!api || !book) {
      return;
    }
    if (
      !window.confirm(
        `删除词书「${book.name}」？这本书的背词进度会一起删除，已经从这本书收进「不会的单词」的词也会移出。`,
      )
    ) {
      return;
    }
    api.removeBook(book.id);
    state.libraryBookProgressFilters.clear();
    state.libraryBookProgressMode = "all";
    showToast(`已删除「${book.name}」`);
    setLibraryView("books");
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

    /* ------------------------------------------------------- 词汇库事件 */

    els.libraryButton?.addEventListener("click", () => {
      setLibraryOpen(!state.libraryOpen);
    });

    els.libraryClose?.addEventListener("click", () => {
      setLibraryOpen(false);
    });

    els.libraryBack?.addEventListener("click", () => {
      setLibraryView(state.libraryView === "book" ? "books" : "entry");
    });

    els.libraryEntryNotebook?.addEventListener("click", () => setLibraryView("notebook"));
    els.libraryEntryBooks?.addEventListener("click", () => setLibraryView("books"));

    els.libraryBoard?.addEventListener("click", (event) => {
      const modeButton = event.target.closest("[data-library-mode-value]");
      if (modeButton) {
        const group = modeButton.closest("[data-library-mode]");
        setLibraryFilterMode(group?.dataset.libraryMode, modeButton.dataset.libraryModeValue);
        return;
      }
      const bookCard = event.target.closest("[data-library-book]");
      if (bookCard) {
        setLibraryView("book", bookCard.dataset.libraryBook);
      }
    });

    els.libraryImportCancel?.addEventListener("click", closeLibraryImport);
    els.libraryImportConfirm?.addEventListener("click", submitLibraryImport);
    els.libraryImportFileButton?.addEventListener("click", () => els.libraryImportFile?.click());
    els.libraryImportFile?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (els.libraryImportText) {
          els.libraryImportText.value = String(reader.result || "");
        }
        if (els.libraryImportName && !els.libraryImportName.value.trim()) {
          els.libraryImportName.value = file.name.replace(/\.[^.]+$/, "").slice(0, 60);
        }
        if (els.libraryImportStatus) {
          const parsed = userbookApi()?.parseImport?.(String(reader.result || "")) || [];
          els.libraryImportStatus.textContent = parsed.length
            ? `已读入 ${file.name}，识别到 ${parsed.length} 个单词`
            : `已读入 ${file.name}，但没识别出单词，检查一下格式`;
        }
      };
      reader.readAsText(file, "utf-8");
      event.target.value = "";
    });

    els.libraryBookImport?.addEventListener("click", openLibraryImport);
    els.libraryBookExportAll?.addEventListener("click", exportAllLibraryBooks);
    els.libraryBookExport?.addEventListener("click", () =>
      exportLibraryBook(state.libraryBookId),
    );
    els.libraryBookRename?.addEventListener("click", renameLibraryBook);
    els.libraryBookDelete?.addEventListener("click", deleteLibraryBook);
    els.libraryBookReview?.addEventListener("click", reviewLibraryBook);

    let libraryBookSearchTimer = 0;
    els.libraryBookSearch?.addEventListener("input", (event) => {
      window.clearTimeout(libraryBookSearchTimer);
      const value = normalize(event.target.value);
      libraryBookSearchTimer = window.setTimeout(() => {
        state.libraryBookSearch = value;
        state.libraryBookVisibleCount = PAGE_SIZE;
        renderLibraryBook();
      }, 140);
    });

    els.libraryBookLoadMore?.addEventListener("click", () => {
      state.libraryBookVisibleCount += PAGE_SIZE;
      renderLibraryBook();
    });

    els.libraryBookProgressFilters?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-book-progress]");
      if (!chip) {
        return;
      }
      const key = chip.dataset.bookProgress;
      toggleLibraryFilter("bookProgress", key, key === "all");
    });

    els.libraryBookListWords?.addEventListener("click", (event) => {
      const open = event.target.closest("[data-library-open]");
      if (open) {
        openWord(open.dataset.libraryOpen);
        return;
      }
      const statusButton = event.target.closest("[data-book-status]");
      if (!statusButton) {
        return;
      }
      const api = userbookApi();
      const book = api?.getBook?.(state.libraryBookId);
      const word = statusButton.dataset.bookWord;
      const status = statusButton.dataset.bookStatus;
      if (!api || !book || !word) {
        return;
      }
      const deck = api.deckFor(book.id);
      if (status === "none") {
        api.clearStatus(deck, word);
        showToast(`「${word}」标记为未背`);
      } else {
        api.setStatus({ deck, word, status, source: `userbook:${book.id}` });
        showToast(
          status === "unknown"
            ? `「${word}」标记为不会，已收进「不会的单词」`
            : `「${word}」标记为${api.statusLabel(status)}`,
        );
      }
      renderLibraryBook();
    });

    let librarySearchTimer = 0;
    els.librarySearch?.addEventListener("input", (event) => {
      window.clearTimeout(librarySearchTimer);
      const value = normalize(event.target.value);
      librarySearchTimer = window.setTimeout(() => {
        state.libraryQuery = value;
        state.libraryVisibleCount = PAGE_SIZE;
        renderLibraryBoard();
      }, 140);
    });

    els.libraryFilters?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-library-filter]");
      if (!chip) {
        return;
      }
      const key = chip.dataset.libraryFilter;
      if (!libraryFilterConfig(key)) {
        return;
      }
      toggleLibraryFilter("source", key, key === "all");
      if (els.libraryList) {
        els.libraryList.scrollTop = 0;
      }
    });

    els.libraryProgressFilters?.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-library-progress]");
      if (!chip) {
        return;
      }
      const key = chip.dataset.libraryProgress;
      toggleLibraryFilter("progress", key, key === "all");
    });

    els.libraryList?.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        return;
      }
      const open = event.target.closest("[data-library-open]");
      if (open) {
        openWord(open.dataset.libraryOpen);
        return;
      }
      const remove = event.target.closest("[data-library-remove]");
      if (remove) {
        const word = remove.dataset.libraryRemove;
        const api = libraryApi();
        if (!api) {
          return;
        }
        if (!window.confirm(`把「${word}」从词汇库删除？原文里的「不会」标记不受影响。`)) {
          return;
        }
        api.remove(word);
        state.librarySelected.delete(normalize(word));
        renderLibraryBoard();
        showToast(`已从词汇库删除「${word}」`);
      }
    });

    els.libraryList?.addEventListener("change", (event) => {
      const input = event.target.closest("[data-library-pick]");
      if (!input) {
        return;
      }
      const key = normalize(input.dataset.libraryPick);
      if (!key) {
        return;
      }
      if (input.checked) {
        state.librarySelected.add(key);
      } else {
        state.librarySelected.delete(key);
      }
      input.closest(".library-card")?.classList.toggle("is-picked", input.checked);
      syncLibraryCounters();
      if (els.libraryMeta) {
        els.libraryMeta.textContent = libraryMetaText();
      }
      if (state.libraryCustomOnly) {
        renderLibraryList();
      }
    });

    els.librarySelectAll?.addEventListener("click", () => {
      const records = libraryFilteredRecords();
      if (!records.length) {
        showToast("当前筛选没有可勾选的单词");
        return;
      }
      records.forEach((record) => {
        state.librarySelected.add(normalize(record.word));
      });
      renderLibraryBoard();
      showToast(`已勾选 ${records.length} 个单词`);
    });

    els.libraryClearSelection?.addEventListener("click", () => {
      state.librarySelected.clear();
      state.libraryCustomOnly = false;
      renderLibraryBoard();
    });

    els.libraryCustom?.addEventListener("click", () => {
      if (!state.librarySelected.size) {
        showToast("先勾选几个单词，再用自定义组合筛选");
        return;
      }
      state.libraryCustomOnly = !state.libraryCustomOnly;
      state.libraryVisibleCount = PAGE_SIZE;
      renderLibraryBoard();
    });

    els.libraryReview?.addEventListener("click", reviewLibraryFilter);

    els.libraryDeleteSelected?.addEventListener("click", () => {
      const api = libraryApi();
      const words = [...state.librarySelected];
      if (!api || !words.length) {
        showToast("先勾选要删除的单词");
        return;
      }
      if (
        !window.confirm(
          `从词汇库删除勾选的 ${words.length} 个单词？原文里的「不会」标记不受影响。`,
        )
      ) {
        return;
      }
      const removed = api.removeMany(words);
      state.librarySelected.clear();
      state.libraryCustomOnly = false;
      renderLibraryBoard();
      showToast(`已删除 ${removed} 个单词`);
    });

    els.libraryLoadMore?.addEventListener("click", () => {
      state.libraryVisibleCount += PAGE_SIZE;
      renderLibraryList();
    });

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
    const libraryParam = params.get("library");
    const startLibrary = libraryParam === "1" || libraryParam === "true";
    const libraryViewParam = (params.get("libraryView") || "").trim();
    const userbookParam = (params.get("userbook") || "").trim();

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
    window.IballVocabLibrary?.subscribe?.(() => {
      syncLibraryCounters();
      if (els.libraryMeta) {
        els.libraryMeta.textContent = libraryMetaText();
      }
      if (state.libraryOpen) {
        renderLibraryBoard();
      }
    });
    window.IballVocabUserbook?.subscribe?.(() => {
      syncLibraryCounters();
      if (state.libraryOpen) {
        renderLibraryBoard();
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
    if (startLibrary) {
      setLibraryOpen(true);
    }
    if (startLibrary && ["entry", "books", "notebook"].includes(libraryViewParam)) {
      setLibraryView(libraryViewParam);
    }
    if (userbookParam) {
      setLibraryOpen(true);
      state.libraryVisibleCount = PAGE_SIZE;
      setLibraryView("book", userbookParam);
    }
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
