(function () {
  "use strict";

  const INDEX = window.IBALL_PERIODICAL_INDEX;
  const PAPERS = Array.isArray(window.IBALL_PERIODICAL_PAPERS)
    ? window.IBALL_PERIODICAL_PAPERS
    : [];
  const LIBRARY = (window.IBALL_PERIODICAL_LIBRARY =
    window.IBALL_PERIODICAL_LIBRARY || {});

  const FILES_BASE = "./periodical-files/";
  const WORD_API = "./api/word";
  const STATE_KEY = "iball-periodical-state";
  const WORD_PATTERN = /[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/g;
  const CLOZE_BLANK_PATTERN = /_{2,}\u3010(\d+)\u3011_{2,}/g;

  const TAB_LABELS = {
    reading: "精读",
    articles: "原文",
    tests: "检验题",
    qa: "答疑",
    originals: "原件",
    vocab: "我的生词",
  };

  const KIND_LABELS = {
    reading: "阅读理解",
    cloze: "完形填空",
    "gap-fill": "新题型 · 7 选 5",
    ordering: "新题型 · 段落排序",
    "new-question-type": "新题型",
    translation: "翻译",
    layout: "杂志排版",
    source: "原文",
    test: "检验题",
    qa: "答疑",
  };

  const ORIGINAL_KIND_LABELS = {
    layout: "杂志排版",
    reading: "精读讲义",
    source: "原文",
    test: "检验题",
    qa: "答疑",
  };

  const elements = {};
  const state = {
    issueId: "",
    tab: "reading",
    previousTab: "reading",
    displayMode: "bilingual",
    query: "",
    theme: "all",
    source: "all",
    originalKind: "all",
    originalIssueFilter: false,
    data: null,
    loadingRun: 0,
    activeWord: null,
    lookupRun: 0,
    lookupCache: new Map(),
    quickIndex: null,
    quickIndexPromise: null,
    readingRun: 0,
    unknown: new Map(),
    picked: {},
    revealed: {},
    allRevealed: false,
  };

  /* --------------------------------------------------------------- 工具 */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null && text !== "") {
      node.textContent = text;
    }
    return node;
  }

  function normalizeWord(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^[^a-z]+|[^a-z]+$/g, "");
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(0)} KB`;
    }
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function fileUrl(fileName) {
    return `${FILES_BASE}${encodeURIComponent(String(fileName || ""))}`;
  }

  function readStoredState() {
    try {
      const raw = window.localStorage.getItem(STATE_KEY);
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw);
      if (saved && typeof saved === "object") {
        if (Array.isArray(saved.unknown)) {
          saved.unknown.forEach((item) => {
            if (item && item.phrase) {
              state.unknown.set(normalizeWord(item.phrase), item);
            }
          });
        }
        if (saved.picked && typeof saved.picked === "object") {
          state.picked = saved.picked;
        }
        if (saved.revealed && typeof saved.revealed === "object") {
          state.revealed = saved.revealed;
        }
        if (saved.issueId) {
          state.issueId = saved.issueId;
        }
        if (saved.tab && TAB_LABELS[saved.tab]) {
          state.tab = saved.tab;
          state.previousTab = saved.tab;
        }
        if (saved.displayMode === "english") {
          state.displayMode = "english";
        } else {
          state.displayMode = "bilingual";
        }
      }
    } catch {
      /* 忽略损坏的本地状态 */
    }
  }

  let persistTimer = 0;
  function persistState() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          STATE_KEY,
          JSON.stringify({
            issueId: state.issueId,
            tab: state.previousTab,
            displayMode: state.displayMode,
            unknown: [...state.unknown.values()].slice(-400),
            picked: state.picked,
            revealed: state.revealed,
          }),
        );
      } catch {
        /* 存储不可用时静默降级 */
      }
    }, 220);
  }

  /* ------------------------------------------------------------- 数据层 */

  function loadScriptOnce(src, hasLoaded) {
    if (hasLoaded && hasLoaded()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () =>
        reject(new Error(`数据下载失败：${src}`)),
      );
      document.head.append(script);
    });
  }

  function getIssues() {
    const list =
      (INDEX && Array.isArray(INDEX.issues) && INDEX.issues) ||
      PAPERS ||
      [];
    return list.slice().sort((left, right) =>
      String(right.date || right.id).localeCompare(String(left.date || left.id)),
    );
  }

  function getIssueMeta(issueId) {
    return getIssues().find((issue) => issue.id === issueId) || null;
  }

  function loadIssueData(issueId) {
    const meta = getIssueMeta(issueId);
    if (!meta) {
      return Promise.reject(new Error("没有找到这一期外刊。"));
    }
    if (LIBRARY[meta.id]) {
      return Promise.resolve(LIBRARY[meta.id]);
    }
    return loadScriptOnce(meta.file, () => LIBRARY[meta.id]).then(() => {
      const data = LIBRARY[meta.id];
      if (!data) {
        throw new Error("这一期的数据为空。");
      }
      return data;
    });
  }

  function prefetchNeighbours(issueId) {
    const issues = getIssues();
    const index = issues.findIndex((issue) => issue.id === issueId);
    if (index < 0) {
      return;
    }
    const warm = () => {
      [index - 1, index + 1].forEach((offset) => {
        const neighbour = issues[offset];
        if (neighbour && !LIBRARY[neighbour.id]) {
          loadScriptOnce(neighbour.file, () => LIBRARY[neighbour.id]).catch(
            () => {},
          );
        }
      });
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(warm, { timeout: 2200 });
    } else {
      window.setTimeout(warm, 900);
    }
  }

  /* ----------------------------------------------------------- 时间轴导航 */

  function matchesIssueFilter(issue) {
    if (state.theme !== "all" && !(issue.themes || []).includes(state.theme)) {
      return false;
    }
    if (
      state.source !== "all" &&
      !(issue.sources || []).includes(state.source)
    ) {
      return false;
    }
    const query = normalizeText(state.query).replace(/\s+/g, "");
    if (!query) {
      return true;
    }
    const haystack = normalizeText(
      [
        issue.label,
        issue.title,
        issue.titleZh,
        issue.theme,
        (issue.themes || []).join(" "),
        (issue.sources || []).join(" "),
      ].join(" "),
    ).replace(/\s+/g, "");
    return haystack.includes(query);
  }

  function renderNavigation() {
    const nav = elements.issueNavigation;
    if (!nav) {
      return;
    }
    nav.textContent = "";

    const visible = getIssues().filter(matchesIssueFilter);
    const wrapper = el("div", "periodical-timeline");

    const search = el("div", "periodical-search");
    const label = el("label", "", "在时间轴中筛选");
    label.setAttribute("for", "timelineSearchInput");
    const input = el("input");
    input.type = "search";
    input.id = "timelineSearchInput";
    input.placeholder = "标题 / 来源 / 主题";
    input.value = state.query;
    input.autocomplete = "off";
    input.addEventListener("input", () => {
      state.query = input.value;
      if (elements.issueSearchInput && elements.issueSearchInput !== input) {
        elements.issueSearchInput.value = input.value;
      }
      renderNavigation();
    });
    const meta = el(
      "p",
      "periodical-search-meta",
      `显示 ${visible.length} / ${getIssues().length} 期`,
    );
    search.append(label, input, meta);
    wrapper.append(search);

    if (!visible.length) {
      wrapper.append(
        el(
          "p",
          "periodical-timeline-empty",
          "没有符合条件的期号，试试清空搜索或把主题、来源切回“全部”。",
        ),
      );
      nav.append(wrapper);
      return;
    }

    const groups = new Map();
    visible.forEach((issue) => {
      const month = String(issue.date || issue.id).slice(0, 7);
      if (!groups.has(month)) {
        groups.set(month, []);
      }
      groups.get(month).push(issue);
    });

    [...groups.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .forEach(([month, issues]) => {
        const group = el("section", "periodical-month");
        const [year, monthNumber] = month.split("-");
        const heading = el("h3", "periodical-month-title");
        heading.append(
          document.createTextNode(`${year} 年 ${Number(monthNumber)} 月`),
          el("span", "", `${issues.length} 期`),
        );
        group.append(heading);

        const list = el("ul", "periodical-issue-list");
        issues.forEach((issue) => {
          const item = el("li");
          const button = el("button", "periodical-issue-button");
          button.type = "button";
          button.classList.toggle("is-active", issue.id === state.issueId);

          const day = String(issue.date || issue.id).slice(8, 10);
          const title = el(
            "strong",
            "",
            `${Number(day)} 日 · ${
              issue.titleZh || issue.title || issue.label || issue.id
            }`,
          );
          const sub = el(
            "small",
            "",
            [
              issue.title && issue.titleZh ? issue.title : "",
              `${issue.counts?.paragraph || 0} 段精读 · ${
                issue.counts?.question || 0
              } 题`,
            ]
              .filter(Boolean)
              .join(" · "),
          );
          const tags = el("span", "periodical-issue-tags");
          if (issue.theme) {
            tags.append(el("span", "periodical-mini-tag is-theme", issue.theme));
          }
          (issue.sources || []).slice(0, 2).forEach((source) => {
            tags.append(el("span", "periodical-mini-tag", source));
          });
          if (!issue.theme && !(issue.sources || []).length) {
            tags.append(el("span", "periodical-mini-tag", "原件归档"));
          }

          button.append(title, sub, tags);
          button.addEventListener("click", () => openIssue(issue.id));
          item.append(button);
          list.append(item);
        });
        group.append(list);
        wrapper.append(group);
      });

    nav.append(wrapper);
  }

  function fillSelect(select, options, value, onChange, allLabel) {
    if (!select) {
      return;
    }
    const previous = value;
    select.textContent = "";
    if (allLabel) {
      const option = document.createElement("option");
      option.value = "all";
      option.textContent = allLabel;
      select.append(option);
    }
    options.forEach(({ value: optionValue, label }) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      select.append(option);
    });
    select.value = previous;
  }

  function renderIssueSelect() {
    const select = elements.issueSelect;
    if (!select) {
      return;
    }
    select.textContent = "";
    getIssues().forEach((issue) => {
      const option = document.createElement("option");
      option.value = issue.id;
      option.textContent = `${issue.label} · ${
        issue.titleZh || issue.title || "原件归档"
      }`;
      select.append(option);
    });
    select.value = state.issueId;
  }

  function renderFilters() {
    const issues = getIssues();
    const themes = new Map();
    const sources = new Map();
    issues.forEach((issue) => {
      (issue.themes || []).forEach((theme) => {
        themes.set(theme, (themes.get(theme) || 0) + 1);
      });
      (issue.sources || []).forEach((source) => {
        sources.set(source, (sources.get(source) || 0) + 1);
      });
    });
    fillSelect(
      elements.themeSelect,
      [...themes.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name, count]) => ({ value: name, label: `${name}（${count}）` })),
      state.theme,
      null,
      "全部主题",
    );
    fillSelect(
      elements.sourceSelect,
      [...sources.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([name, count]) => ({ value: name, label: `${name}（${count}）` })),
      state.source,
      null,
      "全部来源",
    );
  }

  /* --------------------------------------------------------------- 渲染头 */

  function renderHeroStats() {
    const target = elements.heroStats;
    if (!target) {
      return;
    }
    const totals = (INDEX && INDEX.totals) || {};
    const chips = [
      ["期号", formatNumber(totals.issues)],
      ["文章", formatNumber(totals.article)],
      ["精读段落", formatNumber(totals.paragraph)],
      ["生词", formatNumber(totals.vocab)],
      ["检验题", formatNumber(totals.question)],
      ["原件", formatNumber(totals.original)],
    ];
    target.textContent = "";
    chips.forEach(([label, value]) => {
      const chip = el("span", "stat-chip");
      chip.append(el("strong", "", value), document.createTextNode(label));
      target.append(chip);
    });
  }

  function getAvailableTabs(data) {
    if (!data) {
      return [];
    }
    const tabs = data.meta?.tabs || {};
    const available = [];
    if (tabs.reading && (data.reading || []).length) {
      available.push("reading");
    }
    if (tabs.articles && (data.articles || []).length) {
      available.push("articles");
    }
    if (tabs.tests && (data.tests || []).length) {
      available.push("tests");
    }
    if (tabs.qa && (data.qa || []).length) {
      available.push("qa");
    }
    if ((data.originals || []).length) {
      available.push("originals");
    }
    return available;
  }

  function tabCount(data, tab) {
    if (!data) {
      return 0;
    }
    if (tab === "reading") {
      return (data.reading || []).reduce(
        (total, item) => total + (item.paragraphs || []).length,
        0,
      );
    }
    if (tab === "articles") {
      return (data.articles || []).reduce(
        (total, file) => total + (file.articles || []).length,
        0,
      );
    }
    if (tab === "tests") {
      return (data.tests || []).reduce(
        (total, test) => total + (test.items || []).length,
        0,
      );
    }
    if (tab === "qa") {
      return (data.qa || []).reduce(
        (total, group) => total + (group.items || []).length,
        0,
      );
    }
    if (tab === "originals") {
      return (data.originals || []).length;
    }
    if (tab === "vocab") {
      return state.unknown.size;
    }
    return 0;
  }

  function renderTabBar() {
    const bar = elements.tabBar;
    if (!bar) {
      return;
    }
    bar.textContent = "";
    const available = getAvailableTabs(state.data);
    available.forEach((tab) => {
      const button = el("button", "periodical-tab");
      button.type = "button";
      button.classList.toggle("is-active", state.tab === tab);
      button.append(
        document.createTextNode(TAB_LABELS[tab]),
        el("small", "", String(tabCount(state.data, tab))),
      );
      button.addEventListener("click", () => {
        state.tab = tab;
        state.previousTab = tab;
        persistState();
        renderContent();
      });
      bar.append(button);
    });
  }

  /* --------------------------------------------------------------- 精读 */

  function buildSentenceFromParagraph(text) {
    return String(text || "").trim();
  }

  /* --------------------------------------------- 固定搭配 / 段落旁注 */

  const PHRASE_LEVEL_SHORT = { 四级: "四", 六级: "六", 考研: "研" };
  const PHRASE_LEVEL_CLASS = {
    四级: "is-cet4",
    六级: "is-cet6",
    考研: "is-kaoyan",
  };
  const phraseState = { ready: false, loading: null, scheduled: false };

  /** 搭配索引和词库并行预热；加载完成后补一次渲染，首屏不会白等。 */
  function ensurePhraseIndex() {
    if (phraseState.loading) {
      return phraseState.loading;
    }
    const tasks = [];
    if (window.CollocationIndex && typeof window.CollocationIndex.load === "function") {
      tasks.push(window.CollocationIndex.load().catch(() => null));
    }
    if (window.VocabIndex && typeof window.VocabIndex.load === "function") {
      tasks.push(window.VocabIndex.load().catch(() => null));
    }
    phraseState.loading = Promise.all(tasks).then(() => {
      phraseState.ready = Boolean(window.CollocationIndex?.ready);
      return phraseState.ready;
    });
    return phraseState.loading;
  }

  function schedulePhraseRender() {
    if (phraseState.ready || phraseState.scheduled) {
      return;
    }
    phraseState.scheduled = true;
    ensurePhraseIndex().then((ready) => {
      phraseState.scheduled = false;
      if (!ready) {
        return;
      }
      if (state.data && (state.tab === "reading" || state.tab === "articles")) {
        renderContent();
      }
    });
  }

  function phrasesInText(text, limit) {
    const index = window.CollocationIndex;
    if (!index || typeof index.findInText !== "function" || !index.ready) {
      return [];
    }
    return index.findInText(String(text || "")).slice(0, limit);
  }

  /** 点单个词时，从「当前句子里出现的搭配 + 精确命中」里挑出属于这个词的搭配。 */
  function phrasesForWord(word, sentence) {
    const index = window.CollocationIndex;
    if (!index || !index.ready || typeof index.findInText !== "function") {
      return [];
    }
    const forms = new Set();
    const key = normalizeWord(word);
    if (key) {
      forms.add(key);
      if (typeof index.formsFor === "function") {
        index.formsFor(key).forEach((form) => forms.add(String(form).toLowerCase()));
      }
    }
    const exact = typeof index.lookup === "function" ? index.lookup(word) : null;
    const pool = [];
    if (exact) {
      pool.push({ item: exact, always: true });
    }
    index.findInText(sentence || word).forEach((item) => pool.push({ item, always: false }));

    const seen = new Set();
    const result = [];
    pool.forEach(({ item, always }) => {
      const phrase = String(item?.phrase || "");
      if (!phrase) {
        return;
      }
      const lower = phrase.toLowerCase();
      if (seen.has(lower)) {
        return;
      }
      if (!always && forms.size) {
        const tokens =
          typeof index.tokenize === "function" ? index.tokenize(phrase) : [];
        if (tokens.length && !tokens.some((token) => forms.has(token))) {
          return;
        }
      }
      seen.add(lower);
      result.push(item);
    });
    return result.slice(0, 8);
  }

  function createPhraseBadges(levels) {
    const usable = (Array.isArray(levels) ? levels : []).filter(
      (level) => PHRASE_LEVEL_SHORT[level],
    );
    if (!usable.length) {
      return null;
    }
    const wrap = el("span", "phrase-levels");
    usable.forEach((level) => {
      const badge = el(
        "i",
        `phrase-level ${PHRASE_LEVEL_CLASS[level] || ""}`.trim(),
        PHRASE_LEVEL_SHORT[level],
      );
      badge.title = `${level}词汇`;
      wrap.append(badge);
    });
    return wrap;
  }

  function createPhraseChip(entry, context) {
    const button = el("button", "key-word-chip phrase-chip");
    button.type = "button";
    const text = el("span", "phrase-chip-text", entry.phrase);
    text.lang = "en";
    button.append(text);
    const badges = createPhraseBadges(entry.levels);
    if (badges) {
      button.append(badges);
    }
    if (entry.meaning) {
      button.title = `${entry.phrase}：${entry.meaning}`;
    }
    button.setAttribute(
      "aria-label",
      `查看固定搭配 ${entry.phrase} 的释义${entry.meaning ? `：${entry.meaning}` : ""}`,
    );
    button.addEventListener("click", () => {
      openWordPanel(
        entry.phrase,
        context.sentence,
        context.issueId,
        context.paragraphIndex,
        context.sentenceZh,
        [entry],
      );
    });
    return button;
  }

  function createPhraseRow(text, context, limit) {
    const phrases = phrasesInText(text, limit || 10);
    if (!phrases.length) {
      return null;
    }
    const row = el("div", "key-word-row phrase-row");
    row.append(el("span", "key-word-label", "固定搭配"));
    phrases.forEach((entry) => row.append(createPhraseChip(entry, context)));
    return row;
  }

  /* ------------------------------- 词条卡（对标精读版绿色词条块） */

  function wordSenses(entry) {
    return (entry.senses || []).filter(
      (sense) => sense.defEn || sense.defZh || sense.exampleEn || sense.exampleZh,
    );
  }

  function wordRawLines(entry) {
    return [entry.head, entry.definition, entry.gloss, entry.example, entry.exampleZh]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  /**
   * 单个词条：词性、音标、英英释义、中文释义、词表级别、例句与例句译文。
   * 结构化解析失败时回退到 PDF 原始字段，保证讲解只增不减。
   */
  function createWordCard(entry, context) {
    const card = el("article", "periodical-word-card");
    const head = el("p", "periodical-word-head");
    const term = el("strong", "periodical-word-term", entry.label || entry.term);
    term.lang = "en";
    head.append(term);
    if (entry.pos) {
      head.append(el("i", "periodical-word-pos", entry.pos));
    }
    if (isUsablePhonetic(entry.phonetic)) {
      head.append(el("span", "periodical-word-phonetic", entry.phonetic));
    }
    card.append(head);

    const levels = (entry.levels || []).map((level) => String(level).trim()).filter(Boolean);
    if (levels.length) {
      const row = el("p", "periodical-word-levels");
      levels.forEach((level) => row.append(el("span", "periodical-word-level", level)));
      card.append(row);
    }

    const senses = wordSenses(entry);
    if (senses.length) {
      const list = el("ol", "periodical-word-senses");
      senses.forEach((sense) => {
        const item = el("li", "periodical-word-sense");
        if (sense.pos) {
          item.append(el("i", "periodical-word-sense-pos", sense.pos));
        }
        if (sense.defEn) {
          const text = el("p", "periodical-word-def-en", sense.defEn);
          text.lang = "en";
          item.append(text);
        }
        if (sense.defZh) {
          item.append(el("p", "periodical-word-def-zh", sense.defZh));
        }
        if (sense.exampleEn) {
          const text = el("p", "periodical-word-ex-en", sense.exampleEn);
          text.lang = "en";
          item.append(text);
        }
        if (sense.exampleZh) {
          item.append(el("p", "periodical-word-ex-zh", sense.exampleZh));
        }
        list.append(item);
      });
      card.append(list);
    } else {
      const raw = el("div", "periodical-word-raw");
      wordRawLines(entry).forEach((line) =>
        raw.append(el("p", "periodical-word-raw-line", line)),
      );
      card.append(raw);
    }

    if ((entry.synonyms || []).length) {
      const syn = el("p", "periodical-word-syn", entry.synonyms.join(" · "));
      syn.lang = "en";
      card.append(syn);
    }

    const actions = el("div", "periodical-word-actions");
    const lookup = el("button", "periodical-word-action", "查词");
    lookup.type = "button";
    lookup.addEventListener("click", () =>
      openWordPanel(
        entry.term,
        context.sentence,
        context.issueId,
        context.paragraphIndex,
        context.sentenceZh,
      ),
    );
    const speak = el("button", "periodical-word-action", "朗读");
    speak.type = "button";
    speak.addEventListener("click", () =>
      speakText(entry.label || entry.term, { runId: null }, speak, state.readingRun),
    );
    actions.append(lookup, speak);
    card.append(actions);
    return card;
  }

  function resolveParagraphVocab(paragraph, vocabIndex) {
    return (paragraph.vocab || [])
      .map((item) => {
        const term = typeof item === "string" ? item : item?.term;
        const entry = vocabIndex.get(term);
        if (!entry) {
          return null;
        }
        return item?.label && item.label !== entry.term
          ? { ...entry, label: item.label }
          : entry;
      })
      .filter(Boolean);
  }

  function createVocabList(entries, context) {
    const list = el("div", "periodical-word-list");
    entries.forEach((entry) => list.append(createWordCard(entry, context)));
    return list;
  }

  /* ------------------------- 句子分析（成分色块，对齐杂志版黄绿青标注） */

  const SYNTAX_TOKENS = [
    "非限定性定语从句",
    "限定性定语从句",
    "水平/程度状语",
    "宾语从句",
    "主语从句",
    "表语从句",
    "同位语从句",
    "定语从句",
    "状语从句",
    "名词性从句",
    "宾语补足语",
    "主语补足语",
    "形式主语",
    "形式宾语",
    "独立主格",
    "真正的主语",
    "非谓语动词",
    "时间状语",
    "地点状语",
    "方式状语",
    "原因状语",
    "目的状语",
    "结果状语",
    "条件状语",
    "让步状语",
    "伴随状语",
    "范围状语",
    "程度状语",
    "比较状语",
    "后置定语",
    "前置定语",
    "并列连词",
    "并列谓语",
    "并列宾语",
    "关系代词",
    "关系副词",
    "介词短语",
    "名词短语",
    "分词短语",
    "引导词",
    "主句",
    "分句",
    "主语",
    "谓语",
    "系动词",
    "系语",
    "宾语",
    "表语",
    "定语",
    "状语",
    "补语",
    "同位语",
    "插入语",
    "连词",
  ].sort((left, right) => right.length - left.length);

  const SYNTAX_CLAUSE_PATTERN =
    /^(主句|分句\s*\d*|并列句|宾语从句|主语从句|表语从句|同位语从句|非限定性定语从句|限定性定语从句|定语从句|状语从句|名词性从句|时间状语从句|条件状语从句|让步状语从句|原因状语从句|结果状语从句|目的状语从句|地点状语从句|方式状语从句|比较状语从句|伴随状语从句|独立主格|插入语)(?:[（(][^）)]*[）)])?\s*[：:]?$/;

  const SYNTAX_TONES = [
    { pattern: /从句|主句|分句|引导词|连词/, tone: "is-clause" },
    { pattern: /状语/, tone: "is-adverbial" },
    { pattern: /定语|同位语/, tone: "is-modifier" },
    { pattern: /主语|形式主语|形式宾语/, tone: "is-subject" },
    { pattern: /谓语|系动词|系语/, tone: "is-verb" },
    { pattern: /宾语|表语|补语/, tone: "is-object" },
  ];

  /** 把「主语谓语宾语」这类连排标注拆回成分列表；拆不出就整体当说明文字。 */
  function syntaxChips(text) {
    const value = String(text || "")
      .replace(/[\s；;：:，,。、（）()\-—…“”"'’]/g, "");
    if (!value || value.length > 40) {
      return null;
    }
    const chips = [];
    let rest = value;
    while (rest) {
      const token = SYNTAX_TOKENS.find((item) => rest.startsWith(item));
      if (!token) {
        return null;
      }
      chips.push(token);
      rest = rest.slice(token.length);
    }
    return chips.length ? chips : null;
  }

  function syntaxTone(chip) {
    const found = SYNTAX_TONES.find((item) => item.pattern.test(chip));
    return found ? found.tone : "is-clause";
  }

  function createSyntaxChips(chips) {
    const row = el("div", "periodical-syntax-chips");
    chips.forEach((chip) =>
      row.append(el("i", `periodical-syntax-chip ${syntaxTone(chip)}`, chip)),
    );
    return row;
  }

  function buildSyntaxParts(group) {
    const head = { en: [], zh: [] };
    const parts = [];
    const notes = [];
    let clause = "";
    let inBody = false;
    let current = null;
    (group.lines || []).forEach((line) => {
      const text = String(line.text || "").trim();
      if (!text) {
        return;
      }
      const isZh = line.kind !== "en";
      if (!inBody && isZh && (syntaxChips(text) || SYNTAX_CLAUSE_PATTERN.test(text))) {
        inBody = true;
      }
      if (!inBody) {
        head[isZh ? "zh" : "en"].push(text);
        return;
      }
      if (!isZh) {
        current = { clause, en: text, chips: [] };
        parts.push(current);
        clause = "";
        return;
      }
      const chips = syntaxChips(text);
      if (chips) {
        if (current && !current.chips.length) {
          current.chips = chips;
        } else {
          notes.push(text);
        }
        return;
      }
      if (SYNTAX_CLAUSE_PATTERN.test(text)) {
        clause = text.replace(/\s*[：:]\s*$/, "");
        return;
      }
      notes.push(text);
    });
    return { head, parts, notes };
  }

  const SYNTAX_LEGEND = [
    { label: "从句 / 引导词", tone: "is-clause" },
    { label: "状语", tone: "is-adverbial" },
    { label: "定语 / 同位语", tone: "is-modifier" },
    { label: "主语", tone: "is-subject" },
    { label: "谓语", tone: "is-verb" },
    { label: "宾语 / 表语 / 补语", tone: "is-object" },
  ];

  function createSyntaxBlock(title, groups) {
    const details = el("details", "periodical-aside-details periodical-syntax");
    details.append(el("summary", "periodical-aside-label", title));
    let rendered = 0;
    groups.forEach((group) => {
      const built = buildSyntaxParts(group);
      const body = el("div", "periodical-aside-body");
      if (built.head.en.length || built.head.zh.length) {
        const source = el("div", "periodical-syntax-source");
        built.head.en.forEach((text) => {
          const line = el("p", "periodical-syntax-source-en", text);
          line.lang = "en";
          source.append(line);
        });
        built.head.zh.forEach((text) =>
          source.append(el("p", "periodical-syntax-source-zh", text)),
        );
        body.append(source);
      }
      if (built.parts.length) {
        const list = el("ol", "periodical-syntax-parts");
        built.parts.forEach((part) => {
          const item = el("li", "periodical-syntax-part");
          if (part.clause) {
            item.append(el("span", "periodical-syntax-clause", part.clause));
          }
          const english = el("p", "periodical-syntax-en", part.en);
          english.lang = "en";
          item.append(english);
          if (part.chips.length) {
            item.append(createSyntaxChips(part.chips));
          }
          list.append(item);
        });
        body.append(list);
      }
      if (built.notes.length) {
        const notes = el("div", "periodical-syntax-notes");
        built.notes.forEach((text) => notes.append(el("p", "periodical-note-zh", text)));
        body.append(notes);
      }
      if (!body.childNodes.length) {
        return;
      }
      rendered += 1;
      details.append(body);
    });
    if (!rendered) {
      return null;
    }
    const legend = el("p", "periodical-syntax-legend");
    legend.append(el("span", "periodical-syntax-legend-label", "成分色标（机读整理）"));
    SYNTAX_LEGEND.forEach((item) =>
      legend.append(el("i", `periodical-syntax-chip ${item.tone}`, item.label)),
    );
    details.append(legend);
    return details;
  }

  function createHomeworkBlock(groups) {
    const details = el("details", "periodical-aside-details periodical-homework");
    details.open = true;
    details.append(el("summary", "periodical-aside-label", "今日翻译作业"));
    groups.forEach((group) => {
      const body = el("div", "periodical-aside-body");
      renderNoteLines(body, group.lines);
      details.append(body);
    });
    return details;
  }

  /** 把「今日句子分析 / 写作积累」按 Para 序号挂回对应段落。 */
  function buildParagraphNotes(piece) {
    const notes = new Map();
    (piece.sections || []).forEach((section) => {
      const heading = String(section.heading || "");
      (section.groups || []).forEach((group) => {
        const ref = Number(group.ref) || 0;
        if (!ref) {
          return;
        }
        const bucket =
          notes.get(ref) || { analysis: [], writing: [], homework: [] };
        if (heading.includes("句子分析")) {
          bucket.analysis.push(group);
        } else if (heading.includes("写作积累")) {
          bucket.writing.push(group);
        } else if (heading.includes("翻译")) {
          bucket.homework.push(group);
        }
        notes.set(ref, bucket);
      });
    });
    return notes;
  }

  function renderNoteLines(target, lines) {
    (lines || []).forEach((line) => {
      if (line.kind === "en") {
        const paragraph = el("p", "periodical-note-en", line.text);
        paragraph.lang = "en";
        target.append(paragraph);
        return;
      }
      const text = String(line.text || "");
      const short = text.length <= 16 && !/[。！？；]/.test(text);
      target.append(
        el("p", short ? "periodical-note-label" : "periodical-note-zh", text),
      );
    });
  }

  function createNoteDetails(title, groups) {
    const details = el("details", "periodical-aside-details");
    details.append(el("summary", "periodical-aside-label", title));
    groups.forEach((group) => {
      const body = el("div", "periodical-aside-body");
      renderNoteLines(body, group.lines);
      details.append(body);
    });
    return details;
  }

  function createParagraphAside(paragraph, notes, context) {
    const note = notes.get(context.paragraphIndex) || null;
    const phrases = phrasesInText(paragraph.en, 8);
    const vocab = resolveParagraphVocab(paragraph, context.vocabIndex);
    if (!phrases.length && !note && !vocab.length) {
      return null;
    }
    const aside = el("aside", "periodical-aside");
    aside.setAttribute("aria-label", `第 ${context.paragraphIndex} 段旁注`);

    if (vocab.length) {
      const block = el("section", "periodical-aside-block periodical-vocab-block");
      block.append(el("span", "periodical-aside-label", `本段词条 · ${vocab.length}`));
      block.append(createVocabList(vocab, context));
      aside.append(block);
    }
    if (phrases.length) {
      const block = el("section", "periodical-aside-block");
      block.append(el("span", "periodical-aside-label", "固定搭配"));
      const chips = el("div", "periodical-aside-chips");
      phrases.forEach((entry) => chips.append(createPhraseChip(entry, context)));
      block.append(chips);
      aside.append(block);
    }
    if (note?.analysis?.length) {
      const syntax = createSyntaxBlock("语法 · 长难句分析", note.analysis);
      aside.append(syntax || createNoteDetails("语法 · 长难句分析", note.analysis));
    }
    if (note?.homework?.length) {
      aside.append(createHomeworkBlock(note.homework));
    }
    if (note?.writing?.length) {
      aside.append(createNoteDetails("写作积累", note.writing));
    }
    return aside;
  }

  function appendSectionDigest(card, piece) {
    const sections = piece.sections || [];
    if (!sections.length) {
      return;
    }
    const details = el("details", "periodical-sections");
    details.append(
      el(
        "summary",
        "periodical-sections-summary",
        `精读讲义 · ${sections.map((section) => section.heading).join(" / ")}`,
      ),
    );
    sections.forEach((section) => {
      details.append(el("h4", "periodical-section-title", section.heading));
      const body = el("div", "periodical-section-body");
      (section.groups || []).forEach((group) => {
        renderNoteLines(body, group.lines);
      });
      details.append(body);
    });
    card.append(details);
  }

  function escapeRegExpLiteral(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 杂志版把本期重点词在正文里标红，这里用段落词条的真实写法拼一个高亮正则；
   * 匹配不到词条时退化成原来的逐词切分，不影响任何既有交互。
   */
  function keyTermSource(terms) {
    const list = (terms || [])
      .map((item) => (typeof item === "string" ? item : item?.label || item?.term))
      .map((value) => String(value || "").trim())
      .filter((value) => value.length >= 3 && /[A-Za-z]/.test(value))
      .sort((left, right) => right.length - left.length)
      .slice(0, 40)
      .map(escapeRegExpLiteral);
    return list.length ? list.join("|") : "";
  }

  function appendEnglishTokens(
    target,
    text,
    sentence,
    issueId,
    paragraphIndex,
    sentenceZh,
    keyTerms,
  ) {
    const source = String(text || "");
    const keys = keyTermSource(keyTerms);
    const pattern = new RegExp(
      keys ? `(${keys})|(${WORD_PATTERN.source})` : `(${WORD_PATTERN.source})`,
      "gi",
    );
    let cursor = 0;
    let match = pattern.exec(source);
    while (match) {
      if (match.index > cursor) {
        target.append(document.createTextNode(source.slice(cursor, match.index)));
      }
      const phrase = match[1] || match[2];
      const key = normalizeWord(phrase);
      const token = el("span", "word-token", phrase);
      token.dataset.word = key;
      if (match[1]) {
        token.classList.add("is-key-token");
      }
      if (state.unknown.has(key)) {
        token.classList.add("is-unknown-token");
      }
      token.setAttribute("role", "button");
      token.setAttribute("tabindex", "0");
      const open = () =>
        openWordPanel(phrase, sentence, issueId, paragraphIndex, sentenceZh);
      token.addEventListener("click", open);
      token.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      target.append(token);
      cursor = match.index + phrase.length;
      match = pattern.exec(source);
    }
    if (cursor < source.length) {
      target.append(document.createTextNode(source.slice(cursor)));
    }
  }

  function paragraphPlayButton(text, runIdHolder) {
    const button = el("button", "periodical-icon-button", "朗读");
    button.type = "button";
    button.addEventListener("click", () => {
      speakText(
        text,
        runIdHolder,
        button,
        state.readingRun,
      );
    });
    return button;
  }

  /* --------------------------------------- 杂志版卡头 / 脉络 / 整篇速览 */

  /** 机读难度：按平均句长估算，只作阅读节奏参考，不是出版方评级。 */
  function readingDifficulty(piece) {
    const paragraphs = piece.paragraphs || [];
    let words = 0;
    let sentences = 0;
    paragraphs.forEach((paragraph) => {
      const text = String(paragraph.en || "");
      words += (text.match(/[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/g) || []).length;
      sentences += Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) || []).length);
    });
    if (!words || !sentences) {
      return null;
    }
    const average = words / sentences;
    let level = "基础";
    if (average >= 30) {
      level = "高阶";
    } else if (average >= 25) {
      level = "挑战";
    } else if (average >= 20) {
      level = "进阶";
    }
    return {
      level,
      average: Math.round(average),
      words,
      sentences,
      paragraphs: paragraphs.length,
    };
  }

  /** 卡头：栏目标签、中英标题、来源、系列、期号、机读难度。 */
  function renderReadingHead(piece, data) {
    const meta = data.meta || {};
    const headline = piece.headline || {};
    const head = el("div", "periodical-card-head periodical-mag-head");
    const copy = el("div", "periodical-mag-copy");

    const kicker = el("p", "periodical-mag-kicker");
    kicker.append(el("span", "periodical-mag-tag", "精读讲义"));
    (meta.themes || []).slice(0, 3).forEach((theme) =>
      kicker.append(el("span", "periodical-mag-tag is-theme", theme)),
    );
    copy.append(kicker);

    copy.append(
      el(
        "h3",
        "periodical-mag-title",
        headline.titleZh || headline.title || meta.titleZh || "精读讲义",
      ),
    );
    if (headline.title) {
      const english = el("p", "periodical-mag-title-en", headline.title);
      english.lang = "en";
      copy.append(english);
    }

    const facts = [
      { label: "来源", value: headline.source || (meta.sources || [])[0] },
      { label: "系列", value: headline.series },
      { label: "期号", value: meta.label || meta.id },
      {
        label: "篇幅",
        value: (piece.paragraphs || []).length
          ? `${(piece.paragraphs || []).length} 段 · ${(piece.vocab || []).length} 个精读词条`
          : "",
      },
    ].filter((item) => item.value);
    if (facts.length) {
      const row = el("p", "periodical-mag-meta");
      facts.forEach((item) => {
        const cell = el("span", "periodical-mag-meta-item");
        cell.append(el("i", "periodical-mag-meta-label", item.label));
        cell.append(el("span", "periodical-mag-meta-value", item.value));
        row.append(cell);
      });
      copy.append(row);
    }

    const difficulty = readingDifficulty(piece);
    if (difficulty) {
      const row = el("p", "periodical-mag-levels");
      const badge = el(
        "span",
        "periodical-mag-level",
        `机读难度 · ${difficulty.level}`,
      );
      badge.title = `机读整理：平均每句约 ${difficulty.average} 词，共 ${difficulty.sentences} 句。不是出版方官方评级。`;
      row.append(badge);
      row.append(
        el(
          "span",
          "periodical-mag-level is-quiet",
          `平均句长 ${difficulty.average} 词`,
        ),
      );
      copy.append(row);
    }

    head.append(copy);
    return head;
  }

  /** 文章脉络：由每段中文首句机读整理，明确标注非 PDF 原文。 */
  function firstSentenceOf(text) {
    const value = String(text || "").trim();
    if (!value) {
      return "";
    }
    const match = value.match(/^[^。！？；.!?]*[。！？；.!?]?/);
    return ((match && match[0]) || value).trim() || value;
  }

  function renderOutline(piece) {
    const paragraphs = piece.paragraphs || [];
    const items = paragraphs
      .map((paragraph, order) => {
        const index = paragraph.index || order + 1;
        const zh = String(paragraph.zh || "").trim();
        const en = String(paragraph.en || "").trim();
        const source = zh || en;
        if (!source) {
          return null;
        }
        const first = firstSentenceOf(source);
        return {
          index,
          text: first.trim().slice(0, 90),
          lang: zh ? "zh" : "en",
        };
      })
      .filter(Boolean);
    if (items.length < 2) {
      return null;
    }

    const details = el("details", "periodical-outline");
    const summary = el(
      "summary",
      "periodical-outline-summary",
      `文章脉络 · 机读整理（${items.length} 段）`,
    );
    details.append(summary);
    const list = el("ol", "periodical-outline-list");
    items.forEach((item) => {
      const li = el("li", "periodical-outline-item");
      li.append(el("span", "periodical-outline-index", `Para. ${item.index}`));
      const text = el("span", "periodical-outline-text", item.text);
      text.lang = item.lang;
      li.append(text);
      list.append(li);
    });
    details.append(list);
    details.append(
      el(
        "p",
        "periodical-outline-note",
        "脉络取每段首句机读整理，用于快速定位段落，不是 PDF 原文，也不替代精读讲义。",
      ),
    );
    return details;
  }

  /** 词条速览里，索引查不到的写法原样保留，绝不因为解析不到就丢词。 */
  function vocabEntriesFromTerms(terms, vocabIndex, fallbackLabel) {
    const seen = new Set();
    const entries = [];
    (terms || []).forEach((item) => {
      const term = String((typeof item === "string" ? item : item?.term) || "").trim();
      if (!term) {
        return;
      }
      const key = term.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const entry = vocabIndex.get(term);
      const label =
        (typeof item === "object" && item?.label) || fallbackLabel || "";
      if (entry) {
        entries.push(
          label && label !== entry.term ? { ...entry, label } : entry,
        );
        return;
      }
      entries.push({
        term,
        label: label || term,
        senses: [],
        levels: [],
        synonyms: [],
      });
    });
    return entries;
  }

  /** 整篇速览：未挂段词条 + 全篇词条 + 全篇固定搭配。 */
  function appendArticlePanels(card, piece, context) {
    const vocabIndex = context.vocabIndex || new Map();
    const unplaced = vocabEntriesFromTerms(piece.vocabUnplaced, vocabIndex);
    const unplacedKeys = new Set(
      unplaced.map((entry) => String(entry.term || "").toLowerCase()),
    );
    // 未挂段词条单独成块展示，整篇列表里就不再重复出现同名词条。
    const placed = vocabEntriesFromTerms(
      (piece.vocab || []).map((entry) => entry.term),
      vocabIndex,
    ).filter((entry) => !unplacedKeys.has(String(entry.term || "").toLowerCase()));
    const total = unplaced.length + placed.length;

    if (total) {
      const details = el("details", "periodical-article-panel periodical-vocab-panel");
      const summaryParts = [`整篇词条速览 · ${total} 条`];
      if (unplaced.length) {
        summaryParts.push(`其中 ${unplaced.length} 条未机械挂到段落`);
      }
      details.append(
        el("summary", "periodical-article-panel-summary", summaryParts.join(" · ")),
      );
      const body = el("div", "periodical-article-panel-body");
      if (unplaced.length) {
        const block = el("section", "periodical-unplaced");
        block.append(
          el(
            "p",
            "periodical-unplaced-note",
            `以下 ${unplaced.length} 条词条在精读讲义里出现，但机械定位没有匹配到具体段落，因此在段落旁注里不会重复出现，在此原样保留（不删词、不改写）。`,
          ),
        );
        const unplacedList = createVocabList(unplaced, {
          ...context,
          paragraphIndex: 0,
        });
        unplacedList.querySelectorAll(".periodical-word-card").forEach((entry) => {
          entry.classList.add("is-unplaced");
        });
        block.append(unplacedList);
        body.append(block);
      }
      if (placed.length) {
        body.append(createVocabList(placed, { ...context, paragraphIndex: 0 }));
      }
      details.append(body);
      card.append(details);
    }

    const phrases = [];
    const seen = new Set();
    (piece.paragraphs || []).forEach((paragraph, order) => {
      const paragraphIndex = paragraph.index || order + 1;
      phrasesInText(paragraph.en, 14).forEach((entry) => {
        const key = String(entry?.phrase || "").toLowerCase();
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        phrases.push({
          entry,
          context: {
            ...context,
            paragraphIndex,
            sentence: buildSentenceFromParagraph(paragraph.en),
            sentenceZh: paragraph.zh,
          },
        });
      });
    });

    if (phrases.length) {
      const details = el("details", "periodical-article-panel periodical-phrase-panel");
      details.append(
        el(
          "summary",
          "periodical-article-panel-summary",
          `整篇固定搭配速览 · ${phrases.length} 条`,
        ),
      );
      const body = el("div", "periodical-article-panel-body");
      const chips = el("div", "periodical-aside-chips");
      phrases.slice(0, 80).forEach((item) => {
        chips.append(createPhraseChip(item.entry, item.context));
      });
      body.append(chips);
      body.append(
        el(
          "p",
          "periodical-outline-note",
          "搭配命中来自站内四／六／考研搭配词表，点开可查释义、级别与当前语境。",
        ),
      );
      details.append(body);
      card.append(details);
    }
  }

  function renderReadingTab(data) {
    const block = el("div", "periodical-block");
    if (!(data.reading || []).length) {
      block.append(el("p", "periodical-empty", "这一期没有精读讲义。"));
      return block;
    }
    schedulePhraseRender();

    data.reading.forEach((piece) => {
      const card = el("article", "periodical-card periodical-mag");
      const vocabIndex = new Map(
        (piece.vocab || []).map((entry) => [entry.term, entry]),
      );
      const head = renderReadingHead(piece, data);
      const actions = el("div", "periodical-card-actions");
      const originalLink = el("a", "periodical-icon-button", "查看原件");
      originalLink.href = fileUrl(piece.file);
      originalLink.target = "_blank";
      originalLink.rel = "noopener noreferrer";
      const readButton = el("button", "periodical-icon-button", "整篇朗读");
      readButton.type = "button";
      readButton.dataset.readAll = "reading";
      actions.append(originalLink, readButton);
      head.append(actions);
      card.append(head);

      const outline = renderOutline(piece);
      if (outline) {
        card.append(outline);
      }

      const paragraphs = el("div", "periodical-paragraphs");
      const notes = buildParagraphNotes(piece);
      (piece.paragraphs || []).forEach((paragraph, order) => {
        const row = el("div", "periodical-paragraph");
        const paragraphIndex = paragraph.index || order + 1;
        const context = {
          sentence: buildSentenceFromParagraph(paragraph.en),
          sentenceZh: paragraph.zh,
          issueId: data.meta.id,
          paragraphIndex,
          vocabIndex,
        };
        const note = notes.get(paragraphIndex) || null;
        if (note?.homework?.length) {
          row.classList.add("is-homework");
        }
        row.append(
          el("span", "periodical-paragraph-index", String(paragraphIndex)),
        );
        const tools = el("div", "periodical-paragraph-tools");
        const playAll = el("button", "periodical-icon-button", "本段");
        playAll.type = "button";
        playAll.addEventListener("click", () =>
          speakParagraph(paragraph.en, playAll),
        );
        tools.append(playAll);
        row.append(tools);

        const main = el("div", "periodical-paragraph-main");
        if (note?.homework?.length) {
          main.append(el("span", "periodical-homework-flag", "今日翻译作业"));
        }
        const english = el("p", "periodical-en");
        english.lang = "en";
        appendEnglishTokens(
          english,
          paragraph.en,
          context.sentence,
          data.meta.id,
          paragraphIndex,
          paragraph.zh,
          paragraph.vocab,
        );
        main.append(english);

        if (paragraph.zh) {
          main.append(el("p", "periodical-zh", paragraph.zh));
        } else {
          main.append(
            el(
              "p",
              "periodical-zh is-empty",
              "暂无逐段中文译文，完整译文见同期的精读讲义原件。",
            ),
          );
        }
        row.append(main);

        const aside = createParagraphAside(paragraph, notes, context);
        if (aside) {
          row.classList.add("has-aside");
          row.append(aside);
        }
        paragraphs.append(row);
      });
      card.append(paragraphs);
      appendArticlePanels(card, piece, {
        issueId: data.meta.id,
        paragraphIndex: 0,
        sentence: "",
        sentenceZh: "",
        vocabIndex,
      });
      appendSectionDigest(card, piece);
      block.append(card);
      readButton.addEventListener("click", () => {
        const text = (piece.paragraphs || [])
          .map((paragraph) => paragraph.en)
          .filter(Boolean)
          .join(" ");
        speakText(text, { runId: null }, readButton, state.readingRun);
      });
    });

    return block;
  }

  /* --------------------------------------------------------------- 原文 */

  function renderArticlesTab(data) {
    const block = el("div", "periodical-block");
    if (!(data.articles || []).length) {
      block.append(el("p", "periodical-empty", "这一期没有拆分出来的原文。"));
      return block;
    }
    schedulePhraseRender();
    data.articles.forEach((file) => {
      (file.articles || []).forEach((article) => {
        const card = el("article", "periodical-card");
        const head = el("div", "periodical-card-head");
        const headCopy = el("div");
        headCopy.append(el("h3", "", article.titleZh || article.title || "原文"));
        headCopy.append(
          el(
            "p",
            "",
            [article.title, article.source, article.publishedOn]
              .filter(Boolean)
              .join(" · ") || file.file,
          ),
        );
        const actions = el("div", "periodical-card-actions");
        const link = el("a", "periodical-icon-button", "查看原件");
        link.href = fileUrl(file.file);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        actions.append(link);
        head.append(headCopy, actions);
        card.append(head);

        const paragraphs = el("div", "periodical-paragraphs");
        (article.paragraphs || []).forEach((paragraph, order) => {
          const row = el("div", "periodical-paragraph");
          const paragraphIndex = paragraph.index || order + 1;
          row.append(
            el(
              "span",
              "periodical-paragraph-index",
              String(paragraphIndex),
            ),
          );
          const tools = el("div", "periodical-paragraph-tools");
          tools.append(
            paragraphPlayButton(
              String(paragraph.text || "").trim(),
              { runId: null },
            ),
          );
          row.append(tools);
          const main = el("div", "periodical-paragraph-main");
          const english = el("p", "periodical-en");
          english.lang = "en";
          appendEnglishTokens(
            english,
            paragraph.text,
            paragraph.text,
            data.meta.id,
            paragraphIndex,
          );
          main.append(english);
          const phraseRow = createPhraseRow(paragraph.text, {
            sentence: paragraph.text,
            sentenceZh: "",
            issueId: data.meta.id,
            paragraphIndex,
          }, 12);
          if (phraseRow) {
            main.append(phraseRow);
          }
          row.append(main);
          paragraphs.append(row);
        });
        card.append(paragraphs);
        block.append(card);
      });
    });
    return block;
  }

  /* ------------------------------------------------------------- 检验题 */

  function pickedKey(issueId, number) {
    return `${issueId}:${number}`;
  }

  function getPicked(issueId, number) {
    return state.picked[pickedKey(issueId, number)] || "";
  }

  function setPicked(issueId, number, value) {
    state.picked[pickedKey(issueId, number)] = value;
    persistState();
  }

  function isRevealed(issueId) {
    return Boolean(state.revealed[issueId] || state.allRevealed);
  }

  function renderChoiceQuestions(test, issueId) {
    const wrap = el("div");
    const revealed = isRevealed(issueId);
    (test.items || []).forEach((item) => {
      const picked = getPicked(issueId, item.number);
      const question = el("div", "periodical-question");
      const stem = el("p", "periodical-question-stem");
      stem.append(
        el("span", "periodical-question-number", String(item.number)),
        el("span", "", item.stem || "根据文章内容选择最佳答案。"),
      );
      question.append(stem);

      const options = el("div", "periodical-options");
      (item.options || []).forEach((option) => {
        const button = el("button", "periodical-option");
        button.type = "button";
        button.append(
          el("span", "periodical-option-key", option.key),
          el("span", "", option.text),
        );
        if (picked === option.key) {
          button.classList.add("is-picked");
        }
        if (revealed) {
          if (option.key === item.answer) {
            button.classList.add("is-correct");
          } else if (picked === option.key) {
            button.classList.add("is-wrong");
          }
        }
        button.addEventListener("click", () => {
          setPicked(
            issueId,
            item.number,
            getPicked(issueId, item.number) === option.key ? "" : option.key,
          );
          renderContent();
        });
        options.append(button);
      });
      question.append(options);

      if (revealed) {
        const answerRow = el("div", "periodical-answer-row");
        answerRow.append(
          el("span", "periodical-answer-box", `答案 ${item.answer}`),
        );
        if (picked && picked !== item.answer) {
          answerRow.append(
            el("span", "periodical-answer-box is-wrong", `你选了 ${picked}`),
          );
        } else if (picked) {
          answerRow.append(el("span", "periodical-answer-box", "答对了"));
        }
        question.append(answerRow);
      }

      if (revealed && (item.analysis || []).length) {
        const details = el("details");
        details.append(el("summary", "grammar-summary", "查看解析"));
        const body = el("div", "grammar-body");
        body.append(
          el("p", "grammar-explanation", (item.analysis || []).join("\n")),
        );
        details.append(body);
        question.append(details);
      }
      wrap.append(question);
    });
    return wrap;
  }

  function renderCloze(test, issueId) {
    const wrap = el("div");
    const revealed = isRevealed(issueId);
    const answerByNumber = new Map(
      (test.items || []).map((item) => [String(item.number), item]),
    );

    const passage = el("div", "periodical-cloze-passage");
    (test.passage || []).forEach((paragraph) => {
      const holder = el("p", "periodical-en");
      holder.lang = "en";
      holder.style.margin = "0 0 10px";
      const source = String(paragraph || "");
      let cursor = 0;
      CLOZE_BLANK_PATTERN.lastIndex = 0;
      let match = CLOZE_BLANK_PATTERN.exec(source);
      while (match) {
        if (match.index > cursor) {
          holder.append(document.createTextNode(source.slice(cursor, match.index)));
        }
        const number = match[1];
        const item = answerByNumber.get(number);
        const picked = getPicked(issueId, number);
        const blank = el("button", "periodical-blank");
        blank.type = "button";
        blank.textContent = picked || number;
        if (picked) {
          blank.classList.add("is-answered");
        }
        if (revealed && item) {
          if (picked === item.answer) {
            blank.classList.add("is-correct");
          } else if (picked) {
            blank.classList.add("is-wrong");
          } else {
            blank.classList.add("is-answered");
          }
          blank.textContent = `${number} · ${item.answer}`;
        }
        blank.dataset.question = number;
        holder.append(blank);
        cursor = match.index + match[0].length;
        match = CLOZE_BLANK_PATTERN.exec(source);
      }
      if (cursor < source.length) {
        holder.append(document.createTextNode(source.slice(cursor)));
      }
      passage.append(holder);
    });
    wrap.append(passage);

    const questions = el("div");
    (test.items || []).forEach((item) => {
      const picked = getPicked(issueId, item.number);
      const question = el("div", "periodical-question");
      question.dataset.question = String(item.number);
      const stem = el("p", "periodical-question-stem");
      stem.append(
        el("span", "periodical-question-number", String(item.number)),
        el("span", "", "选出最符合上下文的一项。"),
      );
      question.append(stem);

      const options = el("div", "periodical-options");
      (item.options || []).forEach((option) => {
        const button = el("button", "periodical-option");
        button.type = "button";
        button.append(
          el("span", "periodical-option-key", option.key),
          el("span", "", option.text),
        );
        if (picked === option.key) {
          button.classList.add("is-picked");
        }
        if (revealed) {
          if (option.key === item.answer) {
            button.classList.add("is-correct");
          } else if (picked === option.key) {
            button.classList.add("is-wrong");
          }
        }
        button.addEventListener("click", () => {
          setPicked(
            issueId,
            item.number,
            getPicked(issueId, item.number) === option.key ? "" : option.key,
          );
          renderContent();
        });
        options.append(button);
      });
      question.append(options);

      if (revealed) {
        const answerRow = el("div", "periodical-answer-row");
        answerRow.append(
          el("span", "periodical-answer-box", `答案 ${item.answer}`),
          el("span", "", item.kicker || ""),
        );
        question.append(answerRow);
        if ((item.analysis || []).length) {
          const details = el("details");
          details.append(el("summary", "grammar-summary", "查看解析"));
          const body = el("div", "grammar-body");
          body.append(
            el("p", "grammar-explanation", (item.analysis || []).join("\n")),
          );
          details.append(body);
          question.append(details);
        }
      }
      questions.append(question);
    });
    wrap.append(questions);
    return wrap;
  }

  function extractCandidates(passage) {
    const candidates = [];
    const rest = [];
    (passage || []).forEach((line) => {
      const text = String(line || "");
      const match = text.match(/^\[([A-G])\]\s*(.+)$/s);
      if (match) {
        candidates.push({ key: match[1], text: match[2].trim() });
      } else {
        rest.push(text);
      }
    });
    return { candidates, rest };
  }

  function renderGapFill(test, issueId) {
    const wrap = el("div");
    const revealed = isRevealed(issueId);
    const { candidates, rest } = extractCandidates(test.passage);

    if (rest.length) {
      const instructions = el("div", "periodical-test-instructions");
      rest.forEach((line) => {
        instructions.append(el("p", "", line));
      });
      wrap.append(instructions);
    }

    if (candidates.length) {
      const box = el("div", "periodical-candidates");
      box.append(el("h4", "", "候选段落"));
      const list = el("ol", "");
      candidates.forEach((candidate) => {
        const item = el("li");
        const strong = el("strong", "", `[${candidate.key}] `);
        item.append(strong, document.createTextNode(candidate.text));
        list.append(item);
      });
      box.append(list);
      wrap.append(box);
    }

    const questions = el("div");
    (test.items || []).forEach((item) => {
      const picked = getPicked(issueId, item.number);
      const question = el("div", "periodical-question");
      const stem = el("p", "periodical-question-stem");
      stem.append(
        el("span", "periodical-question-number", String(item.number)),
        el("span", "", item.stem || "为这个空位选择最合适的段落。"),
      );
      question.append(stem);

      const options = el("div", "periodical-options");
      const keys = candidates.length
        ? candidates.map((candidate) => candidate.key)
        : "ABCDEFG".split("");
      keys.forEach((key) => {
        const button = el("button", "periodical-option");
        button.type = "button";
        button.append(el("span", "periodical-option-key", key));
        if (picked === key) {
          button.classList.add("is-picked");
        }
        if (revealed) {
          if (key === item.answer) {
            button.classList.add("is-correct");
          } else if (picked === key) {
            button.classList.add("is-wrong");
          }
        }
        button.addEventListener("click", () => {
          setPicked(
            issueId,
            item.number,
            getPicked(issueId, item.number) === key ? "" : key,
          );
          renderContent();
        });
        options.append(button);
      });
      question.append(options);

      if (revealed) {
        const answerRow = el("div", "periodical-answer-row");
        answerRow.append(el("span", "periodical-answer-box", `答案 ${item.answer}`));
        question.append(answerRow);
        if ((item.analysis || []).length) {
          const details = el("details");
          details.append(el("summary", "grammar-summary", "查看解析"));
          const body = el("div", "grammar-body");
          body.append(
            el("p", "grammar-explanation", (item.analysis || []).join("\n")),
          );
          details.append(body);
          question.append(details);
        }
      }
      questions.append(question);
    });
    wrap.append(questions);
    return wrap;
  }

  function renderTestsTab(data) {
    const block = el("div", "periodical-block");
    if (!(data.tests || []).length) {
      block.append(el("p", "periodical-empty", "这一期没有检验题。"));
      return block;
    }
    block.append(
      el(
        "p",
        "periodical-note",
        "以下检验题为第三方模拟练习，非官方真题；答案与解析按原始资料如实呈现，未作改写。",
      ),
    );
    data.tests.forEach((test) => {
      const card = el("section", "periodical-test");
      const head = el("div", "periodical-test-head");
      head.append(
        el("h3", "", KIND_LABELS[test.type] || "检验题"),
        el("span", "", `${(test.items || []).length} 小题 · ${test.file}`),
      );
      card.append(head);

      if ((test.instructions || []).length) {
        const instructions = el("div", "periodical-test-instructions");
        if (test.type === "cloze" || test.type === "reading") {
          test.instructions.forEach((line) => {
            instructions.append(el("p", "", line));
          });
        }
        if (instructions.childNodes.length) {
          card.append(instructions);
        }
      }

      if (test.type === "reading") {
        card.append(renderChoiceQuestions(test, data.meta.id));
      } else if (test.type === "cloze") {
        card.append(renderCloze(test, data.meta.id));
      } else {
        card.append(renderGapFill(test, data.meta.id));
      }

      const link = el("a", "periodical-icon-button", "查看原件");
      link.href = fileUrl(test.file);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const actions = el("div", "periodical-card-actions");
      actions.style.marginTop = "14px";
      actions.append(link);
      card.append(actions);
      block.append(card);
    });
    return block;
  }

  /* --------------------------------------------------------------- 答疑 */

  function renderQaTab(data) {
    const block = el("div", "periodical-block");
    if (!(data.qa || []).length) {
      block.append(el("p", "periodical-empty", "这一期没有答疑记录。"));
      return block;
    }
    data.qa.forEach((group) => {
      const card = el("section", "periodical-card");
      const head = el("div", "periodical-card-head");
      head.append(
        el("h3", "", "答疑汇总"),
        el("p", "", group.file || ""),
      );
      card.append(head);
      (group.items || []).forEach((item) => {
        const row = el("div", "periodical-qa-item");
        const sentence = el("p", "periodical-qa-sentence");
        appendEnglishTokens(
          sentence,
          item.sentence,
          item.sentence,
          data.meta.id,
          0,
        );
        row.append(sentence);
        if (item.question) {
          row.append(el("p", "periodical-qa-label", "提问"));
          row.append(el("p", "periodical-qa-body", item.question));
        }
        if (item.answer) {
          row.append(el("p", "periodical-qa-label", "解答"));
          row.append(el("p", "periodical-qa-body", item.answer));
        }
        if (!item.question && !item.answer) {
          row.append(
            el("p", "periodical-qa-body", "原始答疑资料未记录问答内容。"),
          );
        }
        card.append(row);
      });
      block.append(card);
    });
    return block;
  }

  /* --------------------------------------------------------------- 原件 */

  function renderOriginalsTab(data) {
    const block = el("div", "periodical-block");
    const originals = (data.originals || []).slice().sort((left, right) => {
      const kindOrder = ["layout", "reading", "source", "test", "qa"];
      const kindDiff = kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
      if (kindDiff !== 0) {
        return kindDiff;
      }
      return String(left.file).localeCompare(String(right.file), "zh-CN");
    });

    if (!originals.length) {
      block.append(el("p", "periodical-empty", "这一期没有归档原件。"));
      return block;
    }

    const card = el("section", "periodical-card");
    const head = el("div", "periodical-card-head");
    const headCopy = el("div");
    headCopy.append(
      el("h3", "", "原件清单"),
      el(
        "p",
        "",
        `${originals.length} 份 · 合计 ${formatBytes(
          originals.reduce((total, item) => total + (Number(item.bytes) || 0), 0),
        )}`,
      ),
    );
    head.append(headCopy);
    card.append(head);

    const filters = el("div", "periodical-original-filters");
    const kinds = [...new Set(originals.map((item) => item.kind))];
    [{ key: "all", label: "全部" }]
      .concat(
        kinds.map((kind) => ({
          key: kind,
          label: ORIGINAL_KIND_LABELS[kind] || kind,
        })),
      )
      .forEach((entry) => {
        const button = el("button", "periodical-original-filter", entry.label);
        button.type = "button";
        button.classList.toggle("is-active", state.originalKind === entry.key);
        button.addEventListener("click", () => {
          state.originalKind = entry.key;
          renderContent();
        });
        filters.append(button);
      });
    card.append(filters);

    const visible = originals.filter(
      (item) => state.originalKind === "all" || item.kind === state.originalKind,
    );
    const list = el("ul", "periodical-original-list");
    visible.forEach((item) => {
      const row = el("li", "periodical-original-item");
      const copy = el("div", "periodical-original-copy");
      copy.append(
        el("strong", "", item.title || item.file),
        el(
          "span",
          "",
          [
            ORIGINAL_KIND_LABELS[item.kind] || item.kind,
            item.file,
            formatBytes(item.bytes),
            item.sourcePath,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      const actions = el("div", "periodical-original-actions");
      const open = el("a", "periodical-icon-button", "打开");
      open.href = fileUrl(item.file);
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      const download = el("a", "periodical-icon-button", "另存");
      download.href = fileUrl(item.file);
      download.setAttribute("download", item.file);
      actions.append(open, download);
      row.append(copy, actions);
      list.append(row);
    });
    card.append(list);
    block.append(card);
    return block;
  }

  /* ------------------------------------------------------------- 生词本 */

  function renderVocabTab() {
    const block = el("div", "periodical-block");
    const words = [...state.unknown.values()].sort((left, right) =>
      String(right.savedAt || "").localeCompare(String(left.savedAt || "")),
    );
    if (!words.length) {
      block.append(
        el(
          "p",
          "periodical-empty",
          "还没有标记生词。阅读精读时点任意单词，在右侧面板点“不会”即可加入。",
        ),
      );
      return block;
    }
    const card = el("section", "periodical-card");
    const head = el("div", "periodical-card-head");
    head.append(
      el("h3", "", "我的生词"),
      el("p", "", `共 ${words.length} 个，保存在本机浏览器`),
    );
    card.append(head);
    const list = el("ul", "periodical-original-list");
    words.forEach((word) => {
      const row = el("li", "periodical-original-item");
      const copy = el("div", "periodical-original-copy");
      copy.append(
        el("strong", "", word.phrase),
        el(
          "span",
          "",
          [word.meaning, word.issueId, word.sentence]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 220),
        ),
      );
      const actions = el("div", "periodical-original-actions");
      const remove = el("button", "periodical-icon-button", "移除");
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.unknown.delete(normalizeWord(word.phrase));
        persistState();
        updateMarkSummary();
        renderContent();
      });
      actions.append(remove);
      row.append(copy, actions);
      list.append(row);
    });
    card.append(list);
    block.append(card);
    return block;
  }

  /* ----------------------------------------------------------- 内容主入口 */

  function renderIssueHead(data) {
    const head = el("section", "periodical-issue-head");
    const kicker = el("p", "periodical-issue-kicker");
    kicker.append(
      document.createTextNode(data.meta.label),
      el("span", "", "·"),
      el("span", "", `${data.originals?.length || 0} 份原件`),
    );
    head.append(kicker);
    const title = el("h2");
    title.append(
      document.createTextNode(data.meta.titleZh || data.meta.title || data.meta.label),
    );
    if (data.meta.titleZh && data.meta.title) {
      title.append(el("span", "", data.meta.title));
    }
    head.append(title);

    const summary = el("div", "periodical-issue-summary");
    if (data.meta.theme) {
      summary.append(el("span", "periodical-chip is-accent", data.meta.theme));
    }
    (data.meta.sources || []).forEach((source) => {
      summary.append(el("span", "periodical-chip is-source", source));
    });
    (data.meta.themes || [])
      .filter((theme) => theme !== data.meta.theme)
      .forEach((theme) => {
        summary.append(el("span", "periodical-chip", theme));
      });
    const counts = data.meta.counts || {};
    [
      counts.paragraph ? `精读 ${counts.paragraph} 段` : "",
      counts.vocab ? `生词 ${counts.vocab}` : "",
      counts.question ? `检验题 ${counts.question}` : "",
      counts.qa ? `答疑 ${counts.qa}` : "",
    ]
      .filter(Boolean)
      .forEach((text) => summary.append(el("span", "periodical-chip", text)));
    head.append(summary);
    return head;
  }

  function renderContent() {
    const content = elements.periodicalContent;
    if (!content || !state.data) {
      return;
    }
    content.textContent = "";
    const available = getAvailableTabs(state.data);
    if (state.tab !== "vocab" && !available.includes(state.tab)) {
      state.tab = available[0] || "originals";
    }
    content.append(renderIssueHead(state.data));

    const bar = el("div", "periodical-tabs");
    bar.setAttribute("role", "tablist");
    bar.id = "periodicalTabBar";
    content.append(bar);
    elements.tabBar = bar;
    renderTabBar();

    if (state.tab === "reading") {
      content.append(renderReadingTab(state.data));
    } else if (state.tab === "articles") {
      content.append(renderArticlesTab(state.data));
    } else if (state.tab === "tests") {
      content.append(renderTestsTab(state.data));
    } else if (state.tab === "qa") {
      content.append(renderQaTab(state.data));
    } else if (state.tab === "vocab") {
      content.append(renderVocabTab());
    } else {
      content.append(renderOriginalsTab(state.data));
    }
    updateMarkSummary();
  }

  function renderError(message) {
    const content = elements.periodicalContent;
    if (!content) {
      return;
    }
    content.textContent = "";
    const box = el("div", "error-state");
    box.append(el("strong", "", "外刊加载失败"), el("span", "", message));
    content.append(box);
  }

  async function openIssue(issueId) {
    const meta = getIssueMeta(issueId);
    if (!meta) {
      return;
    }
    const run = ++state.loadingRun;
    state.issueId = issueId;
    state.originalKind = "all";
    renderIssueSelect();
    if (elements.issueSelect) {
      elements.issueSelect.value = issueId;
    }
    renderNavigation();
    persistState();
    if (elements.periodicalContent) {
      elements.periodicalContent.textContent = "";
      const loading = el("div", "loading-state");
      loading.append(
        el("strong", "", `正在读取 ${meta.label}`),
        el("span", "", "只加载这一期的数据，其余期号保持待命。"),
      );
      elements.periodicalContent.append(loading);
    }
    try {
      const data = await loadIssueData(issueId);
      if (run !== state.loadingRun) {
        return;
      }
      state.data = data;
      renderContent();
      prefetchNeighbours(issueId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      if (run !== state.loadingRun) {
        return;
      }
      console.error(error);
      renderError("这一期的数据下载失败，请检查网络后刷新页面重试。");
    }
  }

  /* --------------------------------------------------------------- 查词 */

  function isUsablePhonetic(value) {
    const text = String(value || "").trim();
    return Boolean(text) && !["暂无音标", "音标查询中"].includes(text);
  }

  function updateWordPanelMarkState() {
    if (!elements.markUnknownButton || !state.activeWord) {
      return;
    }
    const marked = state.unknown.has(normalizeWord(state.activeWord.phrase));
    elements.markUnknownButton.textContent = marked ? "已标记不会" : "不会";
    elements.markUnknownButton.classList.toggle("is-active", marked);
  }

  function renderMeanings(meanings) {
    const target = elements.wordMeanings;
    if (!target) {
      return;
    }
    target.textContent = "";
    if (!meanings.length) {
      return;
    }
    const list = el("ul");
    meanings.forEach((meaning) => {
      const item = el("li");
      const dot = el("span", "", "•");
      item.append(dot, document.createTextNode(meaning));
      list.append(item);
    });
    target.append(list);
  }

  function renderPhrases(phrases) {
    const section = elements.wordPhraseSection;
    const target = elements.wordPhrases;
    if (!section || !target) {
      return;
    }
    target.textContent = "";
    if (!phrases.length) {
      section.hidden = true;
      return;
    }
    const list = el("ul");
    phrases.slice(0, 6).forEach((phrase) => {
      const item = el("li");
      item.append(
        el("strong", "", phrase.phrase || phrase.en || ""),
        el("span", "", phrase.meaning || phrase.zh || ""),
      );
      list.append(item);
    });
    target.append(list);
    section.hidden = false;
  }

  function renderExamples(examples) {
    const section = elements.wordExampleSection;
    const target = elements.wordExamples;
    if (!section || !target) {
      return;
    }
    target.textContent = "";
    if (!examples.length) {
      section.hidden = true;
      return;
    }
    examples.slice(0, 3).forEach((example) => {
      const item = el("p", "word-example-item", example.text);
      item.lang = example.lang || "en";
      if (example.zh) {
        item.append(el("span", "word-example-zh", example.zh));
      }
      target.append(item);
    });
    section.hidden = false;
  }

  /* ------------------------------------------------- 本地词库优先（离线可用） */

  const QUICK_INDEX_FILE = "./vocab-index/word-quick.json";
  const QUICK_INDEX_KEY = "iball-periodical-quick-index-v1";

  function readStoredQuickIndex() {
    try {
      const raw = window.localStorage.getItem(QUICK_INDEX_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && parsed.words ? parsed : null;
    } catch {
      return null;
    }
  }

  async function loadQuickIndex() {
    if (state.quickIndex !== null) {
      return state.quickIndex;
    }
    if (state.quickIndexPromise) {
      return state.quickIndexPromise;
    }
    const stored = readStoredQuickIndex();
    if (stored) {
      state.quickIndex = stored;
      return stored;
    }
    state.quickIndexPromise = (async () => {
      try {
        const manifestResponse = await fetch("./vocab-index/lexemes.json", {
          credentials: "same-origin",
        });
        const manifest = await manifestResponse.json().catch(() => ({}));
        const response = await fetch(QUICK_INDEX_FILE, {
          credentials: "same-origin",
        });
        const data = await response.json();
        if (!data || !data.words) {
          throw new Error("本地词库格式异常");
        }
        data.version = manifest.updatedAt || "";
        state.quickIndex = data;
        try {
          window.localStorage.setItem(QUICK_INDEX_KEY, JSON.stringify(data));
        } catch {
          // 本地存储写满时忽略，查询仍然可用。
        }
        return data;
      } catch {
        state.quickIndex = false;
        return false;
      } finally {
        state.quickIndexPromise = null;
      }
    })();
    return state.quickIndexPromise;
  }

  /** 把「音标\t释义\t标签」的紧凑记录还原成词卡数据。 */
  function parseQuickRecord(display, key, raw) {
    if (!raw) {
      return null;
    }
    const [phonetic, meaning, tags] = String(raw).split("\t");
    const translations = String(meaning || "")
      .split(/[；;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      word: display || key,
      phonetic: phonetic || "",
      translations: translations.length ? translations : [meaning].filter(Boolean),
      definitions: [],
      phrases: [],
      tags: String(tags || "").split(/\s+/).filter(Boolean),
      source: "local-vocab",
    };
  }

  async function lookupActiveWordLocal(active) {
    const index = await loadQuickIndex();
    if (!index) {
      return null;
    }
    const key = normalizeWord(active.phrase);
    const record =
      index.words?.[key] ??
      index.phrases?.[key] ??
      index.words?.[key.replace(/[^a-z]/g, "")] ??
      null;
    return parseQuickRecord(active.phrase, key, record);
  }

  /** 站内词库索引兜底：弱网时外刊点词也能直接出释义。 */
  async function lookupActiveWordIndex(word) {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function") {
      return null;
    }
    const entry = await index.lookup(word).catch(() => null);
    if (!entry || !entry.meaning) {
      return null;
    }
    return {
      word: entry.word || word,
      phonetic: entry.phonetic || "",
      translations: String(entry.meaning)
        .split(/[；;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
      definitions: [],
      phrases: [],
      tags: [],
      source: "local-vocab",
    };
  }

  function openWordPanel(
    phrase,
    sentence,
    issueId,
    paragraphIndex,
    sentenceZh,
    presetPhrases,
  ) {
    const presets =
      Array.isArray(presetPhrases) && presetPhrases.length
        ? presetPhrases
        : phrasesForWord(phrase, sentence);
    state.activeWord = {
      phrase,
      sentence: sentence || phrase,
      sentenceZh: sentenceZh || "",
      issueId,
      paragraphIndex,
      presets,
    };
    highlightActiveToken(phrase);
    if (elements.wordPanelTitle) {
      elements.wordPanelTitle.textContent = phrase;
    }
    if (elements.wordPanelPhonetic) {
      elements.wordPanelPhonetic.textContent = "";
    }
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = "正在查询词典…";
    }
    if (elements.wordContextSentence) {
      elements.wordContextSentence.textContent = sentence || phrase;
    }
    if (elements.wordContextTranslation) {
      elements.wordContextTranslation.textContent =
        sentenceZh || "当前语境暂无译文。";
    }
    renderMeanings([]);
    renderPhrases(presets);
    renderExamples([]);
    updateWordPanelMarkState();
    if (!presets.length) {
      // 搭配索引可能还在下载，就绪后补一次，不阻塞词卡先出现。
      ensurePhraseIndex().then((ready) => {
        if (!ready || state.activeWord?.phrase !== phrase) {
          return;
        }
        const late = phrasesForWord(phrase, sentence);
        if (late.length) {
          state.activeWord.presets = late;
          renderPhrases(late);
        }
      });
    }
    if (elements.wordPanel) {
      elements.wordPanel.hidden = false;
      elements.wordPanel.setAttribute("aria-hidden", "false");
    }
    elements.layout?.classList.add("has-word-panel");
    revealWordPanel();
    lookupActiveWord();
  }

  function closeWordPanel() {
    state.lookupRun += 1;
    state.activeWord = null;
    highlightActiveToken("");
    if (elements.wordPanel) {
      elements.wordPanel.hidden = true;
      elements.wordPanel.setAttribute("aria-hidden", "true");
    }
    elements.layout?.classList.remove("has-word-panel");
  }

  /** 给当前点击的单词加高亮，避免用户找不到查的是哪个词。 */
  function highlightActiveToken(word) {
    document
      .querySelectorAll(".word-token.is-active-token")
      .forEach((token) => token.classList.remove("is-active-token"));
    if (!word) {
      return;
    }
    const key = normalizeWord(word);
    const target = document.querySelector(
      `.word-token[data-word="${CSS.escape(key)}"]`,
    );
    target?.classList.add("is-active-token");
  }

  /** 侧栏在桌面端紧跟阅读位置；窄屏抽屉直接可见，不需要滚动。 */
  function revealWordPanel() {
    const panel = elements.wordPanel;
    if (!panel || window.matchMedia("(max-width: 900px)").matches) {
      return;
    }
    const top = panel.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight - 120) {
      panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  async function lookupActiveWord() {
    const active = state.activeWord;
    if (!active) {
      return;
    }
    const word = normalizeWord(active.phrase);
    const run = ++state.lookupRun;
    if (state.lookupCache.has(word)) {
      applyWordResult(state.lookupCache.get(word), "来自本地缓存");
      return;
    }
    // 先查站内本地词库：命中就不用等在线词典，弱网也能查词。
    const local = await lookupActiveWordLocal(active);
    if (run !== state.lookupRun || !state.activeWord) {
      return;
    }
    if (local && local.translations.length) {
      state.lookupCache.set(word, local);
      applyWordResult(local, "本地词库");
      return;
    }
    const indexed = await lookupActiveWordIndex(word);
    if (run !== state.lookupRun || !state.activeWord) {
      return;
    }
    if (indexed) {
      state.lookupCache.set(word, indexed);
      applyWordResult(indexed, "站内词库");
      return;
    }
    try {
      const response = await fetch(
        `${WORD_API}?word=${encodeURIComponent(word)}`,
        { credentials: "same-origin" },
      );
      const data = await response.json().catch(() => ({}));
      if (run !== state.lookupRun || !state.activeWord) {
        return;
      }
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "暂时没有查到这个词");
      }
      state.lookupCache.set(word, data);
      applyWordResult(data, "在线词典");
    } catch (error) {
      if (run !== state.lookupRun) {
        return;
      }
      if (elements.wordLookupStatus) {
        elements.wordLookupStatus.textContent =
          error.message || "查词失败，请稍后重试";
      }
    }
  }

  function applyWordResult(data, statusText) {
    if (!state.activeWord) {
      return;
    }
    const meanings = [
      ...(Array.isArray(data.translations) ? data.translations : []),
      ...(Array.isArray(data.definitions) ? data.definitions : []),
    ].filter((item, index, list) => item && list.indexOf(item) === index);
    if (elements.wordPanelPhonetic) {
      elements.wordPanelPhonetic.textContent = isUsablePhonetic(data.phonetic)
        ? data.phonetic
        : "暂无音标";
    }
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = meanings.length
        ? statusText
        : "词典没有返回释义";
    }
    renderMeanings(meanings.slice(0, 8));
    renderPhrases(
      mergePhraseList(
        state.activeWord.presets,
        Array.isArray(data.phrases) ? data.phrases : [],
      ),
    );
    renderExamples(buildWordExamples(data, state.activeWord));
    state.activeWord.meanings = meanings;
  }

  /** 本地搭配库和在线词典的固定搭配合并去重，先本地后词典。 */
  function mergePhraseList(presets, extra) {
    const list = [];
    const seen = new Set();
    [...(presets || []), ...(extra || [])].forEach((item) => {
      const phrase = String(item?.phrase || item?.en || "").trim();
      if (!phrase) {
        return;
      }
      const key = phrase.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      list.push({ ...item, phrase });
    });
    return list;
  }

  /** 例句优先用词典释义里的完整句，其次回退到当前外刊语境。 */
  function buildWordExamples(data, active) {
    const examples = [];
    const candidates = [
      ...(Array.isArray(data?.examples) ? data.examples : []),
      ...(Array.isArray(data.definitions) ? data.definitions : []),
    ];
    candidates.forEach((item) => {
      const text =
        typeof item === "string" ? item : item?.text || item?.en || "";
      const trimmed = String(text || "").trim();
      if (trimmed.split(/\s+/).length < 5) {
        return;
      }
      if (examples.some((entry) => entry.text === trimmed)) {
        return;
      }
      examples.push({ text: trimmed, lang: "en" });
    });
    if (active?.sentence && examples.length < 2) {
      const sentence = String(active.sentence).trim();
      if (sentence && !examples.some((entry) => entry.text === sentence)) {
        examples.unshift({
          text: sentence,
          zh: active.sentenceZh || "",
          lang: "en",
        });
      }
    }
    return examples;
  }

  function markActiveWord(mode) {
    const active = state.activeWord;
    if (!active) {
      return;
    }
    const key = normalizeWord(active.phrase);
    if (mode === "unknown") {
      const existing = state.unknown.get(key);
      state.unknown.set(key, {
        phrase: active.phrase,
        meaning: (active.meanings || []).slice(0, 2).join("；"),
        sentence: active.sentence,
        issueId: active.issueId,
        savedAt: existing?.savedAt || new Date().toISOString(),
      });
    } else {
      state.unknown.delete(key);
    }
    persistState();
    updateWordPanelMarkState();
    updateMarkSummary();
    if (state.tab === "reading" || state.tab === "articles") {
      document
        .querySelectorAll(`.word-token[data-word="${CSS.escape(key)}"]`)
        .forEach((token) => {
          token.classList.toggle("is-unknown-token", state.unknown.has(key));
        });
    }
  }

  function updateMarkSummary() {
    if (elements.markSummaryButton) {
      elements.markSummaryButton.textContent = `我的生词 ${state.unknown.size}`;
      elements.markSummaryButton.classList.toggle(
        "is-playing",
        state.tab === "vocab",
      );
    }
    if (elements.answerToggleButton) {
      elements.answerToggleButton.textContent = isRevealed(state.issueId)
        ? "隐藏本期答案"
        : "显示本期答案";
    }
  }

  /* --------------------------------------------------------------- 朗读 */

  let speechToken = 0;

  /**
   * 部分 Windows 语音只调 cancel() 停不干净，上一段会继续说，两次朗读就叠在一起。
   * 先 pause 再 cancel、随后 resume 复位，才是硬停止。
   */
  function haltSpeech() {
    const synth = window.speechSynthesis;
    if (!synth) {
      return;
    }
    synth.pause();
    synth.cancel();
    synth.resume();
  }

  function speakText(text, holder, button, runId) {
    if (!("speechSynthesis" in window)) {
      return;
    }
    const value = String(text || "").trim();
    if (!value) {
      return;
    }
    // 每次朗读都认领一个新令牌，过期的结束回调不再改动按钮，免得旧的一段收尾时
    // 把新的一段标成已停止。
    const token = (speechToken += 1);
    haltSpeech();
    const utterance = new SpeechSynthesisUtterance(value.slice(0, 2400));
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    const voice = window.speechSynthesis
      .getVoices()
      .find((candidate) => /en[-_]US/i.test(candidate.lang));
    if (voice) {
      utterance.voice = voice;
    }
    const releaseButton = () => {
      if (!button || button.dataset.speechToken !== String(token)) {
        return;
      }
      delete button.dataset.speechToken;
      button.classList.remove("is-playing");
    };
    if (button) {
      button.dataset.speechToken = String(token);
      button.classList.add("is-playing");
    }
    utterance.addEventListener("end", releaseButton);
    utterance.addEventListener("error", releaseButton);
    window.speechSynthesis.speak(utterance);
  }

  function speakParagraph(text, button) {
    speakText(text, null, button, state.readingRun);
  }

  function readAll() {
    if (!state.data) {
      return;
    }
    const paragraphs =
      state.tab === "articles"
        ? (state.data.articles || []).flatMap((file) =>
            (file.articles || []).flatMap((article) =>
              (article.paragraphs || []).map((paragraph) => paragraph.text),
            ),
          )
        : (state.data.reading || []).flatMap((piece) =>
            (piece.paragraphs || []).map((paragraph) => paragraph.en),
          );
    const texts = paragraphs
      .map((paragraph) => String(paragraph || "").trim())
      .filter(Boolean);
    if (!texts.length) {
      return;
    }

    /*
     * 原来把整期正文拼成一个字符串再朗读，超过 2400 字会被截断，而且整段丢给浏览器
     * 经常在中途哑掉。这里改成按段落整批排队：段落之间首尾相接，且不再截断。
     */
    if (typeof window.IballSpeech?.speakSequence === "function") {
      const button = elements.readAllButton;
      const finish = () => {
        button?.classList.remove("is-playing");
        button?.removeAttribute("aria-pressed");
        if (button) {
          button.textContent = "全文播放";
        }
      };
      if (state.allSpeaking) {
        window.IballSpeech.stop();
        state.allSpeaking = false;
        finish();
        return;
      }
      const started = window.IballSpeech.speakSequence(texts, {
        label: "外刊全文播放",
        rate: 0.95,
        onFinish: () => {
          state.allSpeaking = false;
          finish();
        },
        onUnsupported: () => showToast("当前浏览器不支持语音朗读"),
      });
      if (started) {
        state.allSpeaking = true;
        button?.classList.add("is-playing");
        button?.setAttribute("aria-pressed", "true");
        if (button) {
          button.textContent = "停止播放";
        }
        return;
      }
    }

    const text = texts.join(" ");
    state.readingRun += 1;
    speakText(text, null, elements.readAllButton, state.readingRun);
  }

  /* --------------------------------------------------------------- 初始化 */

  function cacheElements() {
    elements.heroStats = document.querySelector("#heroStats");
    elements.issueSelect = document.querySelector("#issueSelect");
    elements.themeSelect = document.querySelector("#themeSelect");
    elements.sourceSelect = document.querySelector("#sourceSelect");
    elements.issueSearchInput = document.querySelector("#issueSearchInput");
    elements.issueNavigation = document.querySelector("#issueNavigation");
    elements.periodicalContent = document.querySelector("#periodicalContent");
    elements.layout = document.querySelector("#periodicalLayout");
    elements.answerToggleButton = document.querySelector("#answerToggleButton");
    elements.markSummaryButton = document.querySelector("#markSummaryButton");
    elements.readAllButton = document.querySelector("#readAllButton");
    elements.wordPanel = document.querySelector("#wordPanel");
    elements.wordPanelTitle = document.querySelector("#wordPanelTitle");
    elements.wordPanelPhonetic = document.querySelector("#wordPanelPhonetic");
    elements.wordLookupStatus = document.querySelector("#wordLookupStatus");
    elements.wordMeanings = document.querySelector("#wordMeanings");
    elements.wordPhraseSection = document.querySelector("#wordPhraseSection");
    elements.wordPhrases = document.querySelector("#wordPhrases");
    elements.wordExampleSection = document.querySelector("#wordExampleSection");
    elements.wordExamples = document.querySelector("#wordExamples");
    elements.wordContextSentence = document.querySelector("#wordContextSentence");
    elements.wordContextTranslation = document.querySelector(
      "#wordContextTranslation",
    );
    elements.markUnknownButton = document.querySelector("#markUnknownButton");
    elements.markKnownButton = document.querySelector("#markKnownButton");
    elements.closeWordPanelButton = document.querySelector(
      "#closeWordPanelButton",
    );
    elements.speakWordButton = document.querySelector("#speakWordButton");
    elements.readingProgress = document.querySelector("#readingProgress");
  }

  function bindEvents() {
    elements.issueSelect?.addEventListener("change", (event) => {
      openIssue(event.target.value);
    });
    elements.themeSelect?.addEventListener("change", (event) => {
      state.theme = event.target.value;
      renderNavigation();
    });
    elements.sourceSelect?.addEventListener("change", (event) => {
      state.source = event.target.value;
      renderNavigation();
    });
    elements.issueSearchInput?.addEventListener("input", (event) => {
      state.query = event.target.value;
      renderNavigation();
    });
    document.querySelectorAll("[data-display-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.displayMode = button.dataset.displayMode;
        document
          .querySelectorAll("[data-display-mode]")
          .forEach((candidate) => {
            const active = candidate === button;
            candidate.classList.toggle("is-active", active);
            candidate.setAttribute("aria-pressed", String(active));
          });
        document.body.classList.toggle(
          "is-english-only",
          state.displayMode === "english",
        );
        persistState();
      });
    });
    elements.answerToggleButton?.addEventListener("click", () => {
      if (!state.issueId) {
        return;
      }
      const wasRevealed = isRevealed(state.issueId);
      state.allRevealed = false;
      state.revealed[state.issueId] = !wasRevealed;
      persistState();
      renderContent();
    });
    elements.markSummaryButton?.addEventListener("click", () => {
      if (state.tab === "vocab") {
        state.tab = state.previousTab === "vocab" ? "reading" : state.previousTab;
      } else {
        state.previousTab = state.tab;
        state.tab = "vocab";
      }
      renderContent();
    });
    elements.readAllButton?.addEventListener("click", readAll);
    elements.closeWordPanelButton?.addEventListener("click", closeWordPanel);
    elements.markUnknownButton?.addEventListener("click", () =>
      markActiveWord("unknown"),
    );
    elements.markKnownButton?.addEventListener("click", () =>
      markActiveWord("known"),
    );
    elements.speakWordButton?.addEventListener("click", () => {
      if (state.activeWord) {
        speakText(state.activeWord.phrase, null, elements.speakWordButton, 0);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.wordPanel?.hidden) {
        closeWordPanel();
      }
    });
    window.addEventListener("scroll", () => {
      const progress = elements.readingProgress;
      if (!progress) {
        return;
      }
      const height =
        document.documentElement.scrollHeight - window.innerHeight;
      const ratio = height > 0 ? window.scrollY / height : 0;
      progress.style.transform = `scaleX(${Math.min(Math.max(ratio, 0), 1)})`;
    });
  }

  function init() {
    cacheElements();
    readStoredState();
    // 搭配索引与站内词库在首屏后台预热，段落旁注和查词都不用等。
    ensurePhraseIndex();
    renderHeroStats();
    renderFilters();

    const issues = getIssues();
    if (!issues.length) {
      renderError("没有读到外刊索引，请刷新页面重试。");
      return;
    }
    const initial =
      issues.find((issue) => issue.id === state.issueId)?.id || issues[0].id;
    state.issueId = initial;
    renderIssueSelect();
    renderFilters();

    document.body.classList.toggle(
      "is-english-only",
      state.displayMode === "english",
    );
    document.querySelectorAll("[data-display-mode]").forEach((button) => {
      const active = button.dataset.displayMode === state.displayMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    bindEvents();
    renderNavigation();
    openIssue(initial);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
