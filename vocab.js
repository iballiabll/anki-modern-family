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

  const FAVORITE_KEY = "iball_vocab_favorites_v1";
  const WORDBOOK_KEY = "iball_vocab_wordbook_v1";
  const PREFS_KEY = "iball_vocab_prefs_v1";

  const PAGE_SIZE = 60;

  // 考研英语一 / 英语二共用同一份考研核心词表，界面上分开呈现。
  const DECKS = {
    kaoyan1: { deck: "kaoyan", label: "考研英语一", title: "考研英语一 · 核心词库" },
    kaoyan2: { deck: "kaoyan", label: "考研英语二", title: "考研英语二 · 核心词库" },
    llyc2027: {
      deck: "llyc2027",
      label: "恋练有词",
      title: "恋练有词 2027 · 备考词库",
    },
    cet4: { deck: "cet4", label: "四级", title: "四级核心词库" },
    cet6: { deck: "cet6", label: "六级", title: "六级核心词库" },
    basic: { deck: "basic", label: "零基础", title: "零基础高频词库" },
  };

  const els = {
    board: document.querySelector(".vocab-board"),
    deckSelect: document.getElementById("deckSelect"),
    search: document.getElementById("searchInput"),
    sortGroup: document.querySelector(".segmented-control[aria-label='排序方式']"),
    favoriteOnly: document.getElementById("favoriteOnlyButton"),
    favoriteCount: document.getElementById("favoriteCount"),
    hideKnown: document.getElementById("hideKnownButton"),
    knownCount: document.getElementById("knownCount"),
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
    deckKey: "kaoyan1",
    deckWords: [],
    visibleCount: PAGE_SIZE,
    query: "",
    sort: "default",
    favoriteOnly: false,
    hideKnown: false,
    activeWord: "",
    detailToken: 0,
    recite: new Map(),
    favorites: new Set(),
    wordbook: new Map(),
    prefs: { deckKey: "kaoyan1", sort: "default" },
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
    const config = DECKS[deckKey] || DECKS.kaoyan1;
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
    return (DECKS[state.deckKey] || DECKS.kaoyan1).deck;
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
          "点一个状态就会记下来，斩过的词不再进每日任务";
      } else if (record.status === "known") {
        els.reciteStatus.textContent = `已斩 · 已记 ${record.reviews} 次 · 不再进每日任务`;
      } else {
        els.reciteStatus.textContent = `${
          reciteApi()?.statusLabel(record.status) || record.status
        } · 已记 ${record.reviews} 次`;
      }
    }
  }

  function recordRecite(status) {
    const api = reciteApi();
    if (!api || !state.activeWord) {
      showToast("背词记录接口还没就绪，稍后再试");
      return;
    }
    const saved = api.record({
      deck: currentDeckId(),
      word: state.activeWord,
      status,
      source: `vocab:${state.deckKey}`,
    });
    if (saved) {
      showToast(
        status === "known"
          ? "已斩：这个词之后不再进每日任务"
          : `已记为「${api.statusLabel(status)}」`,
      );
    }
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
      (item) => item.deck === (DECKS[state.deckKey] || DECKS.kaoyan1).deck,
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
        return `
          <button class="vocab-row${
            key === normalize(state.activeWord) ? " is-active" : ""
          }" type="button" data-word="${escapeHtml(word)}">
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
          </button>`;
      })
      .join("");
    if (els.loadMore) {
      els.loadMore.hidden = shown.length >= words.length;
    }
    updateListStatus(shown.length, words.length);
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
    const config = DECKS[state.deckKey] || DECKS.kaoyan1;
    const total = state.deckWords.length;
    const slain = slainCount();
    els.deckMeta.textContent = `${config.label} · 共 ${total} 词 · 已斩 ${slain} · 待背 ${Math.max(
      total - slain,
      0,
    )}`;
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
    const config = DECKS[deckKey] ? deckKey : "kaoyan1";
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
      state.visibleCount = PAGE_SIZE;
      syncCounters();
      renderList();
    });

    els.list?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-word]");
      if (row) {
        openWord(row.dataset.word);
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
    }
    const focusWord = (params.get("word") || "").trim();

    bindEvents();
    window.IballVocabRecite?.subscribe(() => {
      refreshRecite();
      renderList();
      renderStats();
      syncCounters();
      syncReciteBar();
      updateDeckMeta();
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
