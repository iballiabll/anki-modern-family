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

  function appendEnglishTokens(
    target,
    text,
    sentence,
    issueId,
    paragraphIndex,
    sentenceZh,
  ) {
    const source = String(text || "");
    let cursor = 0;
    WORD_PATTERN.lastIndex = 0;
    let match = WORD_PATTERN.exec(source);
    while (match) {
      if (match.index > cursor) {
        target.append(document.createTextNode(source.slice(cursor, match.index)));
      }
      const phrase = match[0];
      const key = normalizeWord(phrase);
      const token = el("span", "word-token", phrase);
      token.dataset.word = key;
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
      match = WORD_PATTERN.exec(source);
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

  function renderReadingTab(data) {
    const block = el("div", "periodical-block");
    if (!(data.reading || []).length) {
      block.append(el("p", "periodical-empty", "这一期没有精读讲义。"));
      return block;
    }

    data.reading.forEach((piece) => {
      const card = el("article", "periodical-card");
      const head = el("div", "periodical-card-head");
      const headCopy = el("div");
      headCopy.append(
        el(
          "h3",
          "",
          piece.headline?.titleZh
            ? `${piece.headline.titleZh}`
            : piece.headline?.title || "精读讲义",
        ),
      );
      const subParts = [
        piece.headline?.title,
        piece.headline?.source,
        piece.headline?.series,
      ].filter(Boolean);
      if (subParts.length) {
        headCopy.append(el("p", "", subParts.join(" · ")));
      }

      const actions = el("div", "periodical-card-actions");
      const originalLink = el("a", "periodical-icon-button", "查看原件");
      originalLink.href = fileUrl(piece.file);
      originalLink.target = "_blank";
      originalLink.rel = "noopener noreferrer";
      const readButton = el("button", "periodical-icon-button", "整篇朗读");
      readButton.type = "button";
      readButton.dataset.readAll = "reading";
      actions.append(originalLink, readButton);
      head.append(headCopy, actions);
      card.append(head);

      const paragraphs = el("div", "periodical-paragraphs");
      (piece.paragraphs || []).forEach((paragraph, order) => {
        const row = el("div", "periodical-paragraph");
        row.append(
          el("span", "periodical-paragraph-index", String(paragraph.index || order + 1)),
        );
        const tools = el("div", "periodical-paragraph-tools");
        const playAll = el("button", "periodical-icon-button", "本段");
        playAll.type = "button";
        playAll.addEventListener("click", () =>
          speakParagraph(paragraph.en, playAll),
        );
        tools.append(playAll);
        row.append(tools);

        const english = el("p", "periodical-en");
        english.lang = "en";
        appendEnglishTokens(
          english,
          paragraph.en,
          buildSentenceFromParagraph(paragraph.en),
          data.meta.id,
          paragraph.index || order + 1,
          paragraph.zh,
        );
        row.append(english);

        if (paragraph.zh) {
          row.append(el("p", "periodical-zh", paragraph.zh));
        } else {
          row.append(
            el(
              "p",
              "periodical-zh is-empty",
              "暂无逐段中文译文，完整译文见同期的精读讲义原件。",
            ),
          );
        }
        paragraphs.append(row);
      });
      card.append(paragraphs);
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
          row.append(
            el(
              "span",
              "periodical-paragraph-index",
              String(paragraph.index || order + 1),
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
          const english = el("p", "periodical-en");
          english.lang = "en";
          appendEnglishTokens(
            english,
            paragraph.text,
            paragraph.text,
            data.meta.id,
            paragraph.index || order + 1,
          );
          row.append(english);
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

  function openWordPanel(phrase, sentence, issueId, paragraphIndex, sentenceZh) {
    state.activeWord = {
      phrase,
      sentence: sentence || phrase,
      sentenceZh: sentenceZh || "",
      issueId,
      paragraphIndex,
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
    renderPhrases([]);
    renderExamples([]);
    updateWordPanelMarkState();
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
    renderPhrases(Array.isArray(data.phrases) ? data.phrases : []);
    renderExamples(buildWordExamples(data, state.activeWord));
    state.activeWord.meanings = meanings;
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
