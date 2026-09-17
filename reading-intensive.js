(function () {
  "use strict";

  const Deck = window.IballDeck;
  if (!Deck) {
    const fallback = document.querySelector("#readingIntensiveContent");
    if (fallback) {
      fallback.textContent = "阅读精读数据加载失败，请刷新页面。";
    }
    return;
  }

  const {
    STORAGE_KEYS,
    cleanReadingText,
    getItemKey,
    getReadingDocuments,
    hashReadingValue,
    persistSet,
    restoreSet,
    saveReadingDocument,
  } = Deck;

  const papers = Array.isArray(window.IBALL_READING_PAPERS)
    ? window.IBALL_READING_PAPERS.slice()
    : [];
  const library = (window.IBALL_READING_LIBRARY =
    window.IBALL_READING_LIBRARY || {});

  const WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  const PHONETIC_PLACEHOLDERS = new Set(["暂无音标", "音标查询中"]);
  const READING_CATEGORY = "四级";
  const READING_SECTION = "四级阅读精读";
  const PAPER_STORAGE_KEY = "iball-reading-paper";
  const PIECE_STORAGE_KEY = "iball-reading-piece";
  const KIND_STORAGE_KEY = "iball-reading-kind";
  const CUE_STORAGE_KEY = "iball-reading-cues";
  const DISPLAY_STORAGE_KEY = "iball-reading-display-mode";
  const ANSWER_STORAGE_KEY = "iball-reading-answers";
  const REVEAL_STORAGE_KEY = "iball-reading-revealed";
  const CLOZE_TRANSLATION_STORAGE_KEY = "iball-reading-cloze-translation";

  const KIND_LABELS = {
    cloze: "选词填空",
    matching: "段落匹配",
    careful: "仔细阅读",
  };
  const KIND_SHORT = {
    cloze: "选词填空",
    matching: "段落匹配",
    careful: "仔细阅读",
  };
  const PHRASE_LEVEL_SHORT = { 四级: "四", 六级: "六", 考研: "研" };
  const PHRASE_LEVEL_CLASS = {
    四级: "is-cet4",
    六级: "is-cet6",
    考研: "is-kaoyan",
  };
  const LEVEL_NAMES = ["四级", "六级", "考研"];

  const state = {
    paperId: "",
    pieceId: "",
    kindFilter: "all",
    data: null,
    openRun: 0,
    lookupRun: 0,
    activeWord: null,
    paragraphIndex: new Map(),
    lookupCache: new Map(),
    unknown: restoreSet(STORAGE_KEYS.unknown),
    known: restoreSet(STORAGE_KEYS.known),
    toastTimer: 0,
    speechRun: 0,
    allSpeaking: false,
    showCues: true,
    clozeTranslation: true,
    answers: readStoredMap(ANSWER_STORAGE_KEY),
    revealed: readStoredMap(REVEAL_STORAGE_KEY),
    blankIndex: new Map(),
  };

  const elements = {
    readingProgress: document.querySelector("#readingProgress"),
    sourceLink: document.querySelector("#sourceLink"),
    heroStats: document.querySelector("#heroStats"),
    layout: document.querySelector("#readingIntensiveLayout"),
    yearSelect: document.querySelector("#yearSelect"),
    monthSelect: document.querySelector("#monthSelect"),
    setSelect: document.querySelector("#setSelect"),
    kindSelect: document.querySelector("#kindSelect"),
    pieceNavigation: document.querySelector("#pieceNavigation"),
    content: document.querySelector("#readingIntensiveContent"),
    cueToggleButton: document.querySelector("#cueToggleButton"),
    answerToggleButton: document.querySelector("#answerToggleButton"),
    clozeTranslationButton: document.querySelector("#clozeTranslationButton"),
    readAllButton: document.querySelector("#readAllButton"),
    toast: document.querySelector("#toast"),
    displayModeButtons: document.querySelectorAll("[data-display-mode]"),
    wordPanel: document.querySelector("#wordPanel"),
    wordPanelTitle: document.querySelector("#wordPanelTitle"),
    wordPanelPhonetic: document.querySelector("#wordPanelPhonetic"),
    wordLevelBadges: document.querySelector("#wordLevelBadges"),
    speakWordButton: document.querySelector("#speakWordButton"),
    wordLookupStatus: document.querySelector("#wordLookupStatus"),
    wordMeanings: document.querySelector("#wordMeanings"),
    wordPhraseSection: document.querySelector("#wordPhraseSection"),
    wordPhrases: document.querySelector("#wordPhrases"),
    wordSynonymSection: document.querySelector("#wordSynonymSection"),
    wordSynonyms: document.querySelector("#wordSynonyms"),
    wordContextSentence: document.querySelector("#wordContextSentence"),
    wordContextTranslation: document.querySelector("#wordContextTranslation"),
    wordNoteInput: document.querySelector("#wordNoteInput"),
    markUnknownButton: document.querySelector("#markUnknownButton"),
    markKnownButton: document.querySelector("#markKnownButton"),
    closeWordPanelButton: document.querySelector("#closeWordPanelButton"),
  };

  let activeSpeechButton = null;
  let voices = [];
  let scrollFrame = 0;

  /* ------------------------------------------------------------- helpers */

  function showToast(message) {
    if (!elements.toast) {
      return;
    }
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2600);
  }

  function readStoredValue(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function writeStoredValue(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 存储不可用时其余功能照常工作。
    }
  }

  function readStoredMap(key) {
    try {
      const parsed = JSON.parse(readStoredValue(key) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }

  function persistAnswers() {
    writeStoredValue(ANSWER_STORAGE_KEY, JSON.stringify(state.answers));
  }

  function persistRevealed() {
    writeStoredValue(REVEAL_STORAGE_KEY, JSON.stringify(state.revealed));
  }

  function getAnswerKey(number) {
    return `${state.paperId}|${number}`;
  }

  function normalizeWord(value) {
    return String(value || "")
      .toLocaleLowerCase("en-US")
      .replace(/[’]/g, "'");
  }

  function cleanPhonetic(value) {
    const text = String(value || "").trim();
    return PHONETIC_PLACEHOLDERS.has(text) ? "" : text;
  }

  function isUsablePhonetic(value) {
    const text = cleanPhonetic(value);
    return text && text !== "-" ? text : "";
  }

  function hasUsableWordResult(value) {
    if (!value) {
      return false;
    }
    return Boolean(
      isUsablePhonetic(value.phonetic) ||
        (Array.isArray(value.translations) && value.translations.length) ||
        (Array.isArray(value.definitions) && value.definitions.length),
    );
  }

  function renderPanelPhonetic(value) {
    if (!elements.wordPanelPhonetic) {
      return;
    }
    elements.wordPanelPhonetic.textContent =
      isUsablePhonetic(value) || "暂无音标";
  }

  function makeWordId(phrase, sentence, kind = "word") {
    const prefix = kind === "phrase" ? "phrase" : "word";
    return `${prefix}-${hashReadingValue(
      `${normalizeWord(phrase)}|${cleanReadingText(sentence, 1200)}`,
    )}`;
  }

  function getCombinedMeaning(meanings, note) {
    return [
      ...new Set(
        [...meanings, note]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ]
      .join("；")
      .slice(0, 800);
  }

  function parseLevels(source) {
    const text = String(source || "");
    return LEVEL_NAMES.filter((level) => text.includes(level));
  }

  function normalizePhraseKey(value) {
    return String(value || "")
      .replace(/[’‘`]/g, "'")
      .toLowerCase()
      .replace(/[.…]+/g, " ")
      .replace(/[^a-z0-9'\- ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* -------------------------------------------------------------- speech */

  function refreshVoices() {
    if (!("speechSynthesis" in window)) {
      voices = [];
      return;
    }
    voices = Array.from(window.speechSynthesis.getVoices() || []);
  }

  function getPreferredVoice() {
    if (!voices.length) {
      refreshVoices();
    }
    return (
      voices.find((voice) => /^en-US$/i.test(voice.lang)) ||
      voices.find((voice) => /^en[-_]/i.test(voice.lang)) ||
      voices.find((voice) => /english/i.test(voice.name)) ||
      null
    );
  }

  function setSpeechButtonState(button, speaking) {
    if (!button) {
      return;
    }
    if (!button.dataset.idleLabel) {
      button.dataset.idleLabel = button.textContent.trim();
    }
    if (speaking) {
      if (activeSpeechButton && activeSpeechButton !== button) {
        setSpeechButtonState(activeSpeechButton, false);
      }
      activeSpeechButton = button;
      button.classList.add("is-playing");
      button.setAttribute("aria-pressed", "true");
      button.textContent = "停止";
      return;
    }
    button.classList.remove("is-playing");
    button.setAttribute("aria-pressed", "false");
    button.textContent = button.dataset.idleLabel;
    if (activeSpeechButton === button) {
      activeSpeechButton = null;
    }
  }

  function updateReadAllButton() {
    if (!elements.readAllButton) {
      return;
    }
    elements.readAllButton.classList.toggle("is-playing", state.allSpeaking);
    elements.readAllButton.textContent = state.allSpeaking
      ? "停止播放"
      : "朗读本篇";
    elements.readAllButton.setAttribute("aria-pressed", String(state.allSpeaking));
  }

  function stopSpeech() {
    state.speechRun += 1;
    state.allSpeaking = false;
    if (activeSpeechButton) {
      setSpeechButtonState(activeSpeechButton, false);
    }
    updateReadAllButton();
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function speakText(text, runId, onDone, onError) {
    const speakable = String(text || "").trim();
    if (
      runId !== state.speechRun ||
      !speakable ||
      !("speechSynthesis" in window) ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      return false;
    }

    const utterance = new window.SpeechSynthesisUtterance(speakable);
    const voice = getPreferredVoice();
    utterance.lang = voice?.lang || "en-US";
    utterance.voice = voice;
    utterance.rate = 0.88;
    utterance.pitch = 1;

    let finished = false;
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      onDone?.();
    };

    utterance.onend = finish;
    utterance.onerror = (event) => {
      finished = true;
      onError?.(event);
    };

    window.speechSynthesis.speak(utterance);
    return true;
  }

  function playParagraph(text, button) {
    const speakable = String(text || "").trim();
    if (!speakable) {
      showToast("这一段没有可朗读的内容");
      return;
    }
    if (activeSpeechButton === button && button.classList.contains("is-playing")) {
      stopSpeech();
      return;
    }
    stopSpeech();
    const run = state.speechRun;
    const started = speakText(
      speakable,
      run,
      () => setSpeechButtonState(button, false),
      () => {
        setSpeechButtonState(button, false);
        showToast("朗读中断，请稍后重试");
      },
    );
    if (!started) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    setSpeechButtonState(button, true);
  }

  function playSequence(texts, triggerButton) {
    const speakables = texts
      .map((text) => String(text || "").trim())
      .filter(Boolean);
    if (!speakables.length) {
      showToast("当前篇目没有可朗读的内容");
      return;
    }
    if (state.allSpeaking) {
      stopSpeech();
      return;
    }

    stopSpeech();
    state.allSpeaking = true;
    const run = state.speechRun;
    let index = 0;
    updateReadAllButton();

    const finish = (message) => {
      state.allSpeaking = false;
      updateReadAllButton();
      if (message) {
        showToast(message);
      }
    };

    const playNext = () => {
      if (run !== state.speechRun || !state.allSpeaking) {
        return;
      }
      if (index >= speakables.length) {
        finish("播放完成");
        return;
      }
      const started = speakText(
        speakables[index],
        run,
        () => {
          index += 1;
          window.setTimeout(playNext, 140);
        },
        () => finish("播放中止，请稍后重试"),
      );
      if (!started) {
        finish("当前浏览器不支持语音朗读");
      }
    };

    playNext();
  }

  /* ------------------------------------------------------------ settings */

  function setDisplayMode(mode) {
    const englishOnly = mode === "english";
    document.body.classList.toggle("is-english-only", englishOnly);
    elements.displayModeButtons.forEach((button) => {
      const active = button.dataset.displayMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    writeStoredValue(DISPLAY_STORAGE_KEY, englishOnly ? "english" : "bilingual");
  }

  function setCueVisibility(visible) {
    state.showCues = visible;
    document.body.classList.toggle("is-cues-hidden", !visible);
    if (elements.cueToggleButton) {
      elements.cueToggleButton.textContent = visible
        ? "隐藏答案提示"
        : "显示答案提示";
      elements.cueToggleButton.setAttribute("aria-pressed", String(!visible));
      elements.cueToggleButton.classList.toggle("is-muted", !visible);
    }
    writeStoredValue(CUE_STORAGE_KEY, visible ? "shown" : "hidden");
  }

  /* --------------------------------------------------------- paper utils */

  function parsePaperId(paperId) {
    const match = /^(\d{4})-(\d{2})-(\d+)$/.exec(paperId || "");
    if (!match) {
      return null;
    }
    return { year: match[1], month: match[2], set: match[3] };
  }

  function getPaperMeta(paperId) {
    return papers.find((paper) => paper.id === paperId) || null;
  }

  function getPiece(kind, index) {
    const pieces = state.data?.pieces || [];
    return (
      pieces.find(
        (piece) =>
          piece.kind === kind &&
          (index === undefined || Number(piece.index || 1) === index),
      ) || null
    );
  }

  function getPieceById(pieceId) {
    return (state.data?.pieces || []).find((piece) => piece.id === pieceId) || null;
  }

  function loadPaperData(paperId) {
    const meta = getPaperMeta(paperId);
    if (!meta) {
      return Promise.reject(new Error("没有找到这份试卷。"));
    }
    if (library[meta.id]) {
      return Promise.resolve(library[meta.id]);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = meta.file;
      script.async = true;
      script.dataset.paperSource = meta.id;
      script.addEventListener("load", () => {
        const data = window.IBALL_READING_LIBRARY?.[meta.id];
        if (data) {
          resolve(data);
        } else {
          reject(new Error("试卷数据为空。"));
        }
      });
      script.addEventListener("error", () => {
        reject(new Error("试卷数据下载失败，请检查网络后重试。"));
      });
      document.head.append(script);
    });
  }

  function getLocationParams() {
    try {
      return new URLSearchParams(window.location.search);
    } catch {
      return new URLSearchParams();
    }
  }

  function setLocationParams(patch, push) {
    try {
      const url = new URL(window.location.href);
      Object.entries(patch).forEach(([key, value]) => {
        if (value) {
          url.searchParams.set(key, value);
        } else {
          url.searchParams.delete(key);
        }
      });
      const next = `${url.pathname}${url.search}${url.hash}`;
      if (push) {
        window.history.pushState(patch, "", next);
      } else {
        window.history.replaceState(patch, "", next);
      }
    } catch {
      // 地址栏更新失败不影响阅读。
    }
  }

  function showLoading(meta) {
    if (!elements.content) {
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "loading-state";
    const title = document.createElement("strong");
    title.textContent = `正在读取${meta?.label || "阅读精读"}`;
    const copy = document.createElement("span");
    copy.textContent = "首次打开需要几秒，请稍候。";
    wrapper.append(title, copy);
    elements.content.replaceChildren(wrapper);
  }

  async function openPaper(paperId, options = {}) {
    const meta = getPaperMeta(paperId);
    if (!meta) {
      renderError("没有找到这份试卷。");
      return;
    }

    const run = ++state.openRun;
    showLoading(meta);
    stopSpeech();
    closeWordPanel();

    try {
      const data = await loadPaperData(meta.id);
      if (run !== state.openRun) {
        return;
      }
      state.paperId = meta.id;
      state.data = data;
      state.lookupCache.clear();
      indexParagraphs();
      syncCascade(meta.id);
      setLocationParams(
        {
          paper: meta.id,
          piece: state.pieceId || "",
          kind: state.kindFilter === "all" ? "" : state.kindFilter,
        },
        Boolean(options.push),
      );
      writeStoredValue(PAPER_STORAGE_KEY, meta.id);
      renderPage();
      if (options.scrollTo) {
        scrollToPiece(options.scrollTo);
      } else if (options.toTop !== false) {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (error) {
      if (run !== state.openRun) {
        return;
      }
      console.error(error);
      renderError(error?.message || "阅读精读加载失败，请刷新后重试。");
    }
  }

  function indexParagraphs() {
    state.paragraphIndex.clear();
    state.blankIndex.clear();
    (state.data?.pieces || []).forEach((piece) => {
      (piece.paragraphs || []).forEach((paragraph) => {
        const id = `${piece.id}-p${paragraph.number}`;
        state.paragraphIndex.set(id, paragraph);
      });
      (piece.blanks || []).forEach((blank) => {
        state.blankIndex.set(blank.number, blank);
      });
    });
  }

  function scrollToPiece(pieceId) {
    if (!pieceId) {
      return;
    }
    const target = document.getElementById(pieceId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /* ------------------------------------------------------- cascade menu */

  function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function fillSelect(select, options, value) {
    if (!select) {
      return;
    }
    const fragment = document.createDocumentFragment();
    options.forEach(({ value: optionValue, label }) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      fragment.append(option);
    });
    select.replaceChildren(fragment);
    if (value && options.some((option) => option.value === value)) {
      select.value = value;
    }
  }

  function syncCascade(paperId) {
    const parsed = parsePaperId(paperId);
    if (!parsed) {
      return;
    }
    const years = uniqueValues(papers.map((paper) => parsePaperId(paper.id)?.year)).sort(
      (left, right) => right.localeCompare(left),
    );
    fillSelect(
      elements.yearSelect,
      years.map((year) => ({ value: year, label: `${year} 年` })),
      parsed.year,
    );

    const months = uniqueValues(
      papers
        .map((paper) => parsePaperId(paper.id))
        .filter((item) => item?.year === parsed.year)
        .map((item) => item.month),
    ).sort((left, right) => right.localeCompare(left));
    fillSelect(
      elements.monthSelect,
      months.map((month) => ({ value: month, label: `${Number(month)} 月` })),
      parsed.month,
    );

    const sets = papers
      .map((paper) => ({ paper, parsed: parsePaperId(paper.id) }))
      .filter(
        (item) =>
          item.parsed?.year === parsed.year && item.parsed?.month === parsed.month,
      )
      .sort((left, right) => left.parsed.set.localeCompare(right.parsed.set));
    fillSelect(
      elements.setSelect,
      sets.map((item) => ({
        value: item.paper.id,
        label: `第 ${item.parsed.set} 套 · ${item.paper.questionCount || 0} 题`,
      })),
      paperId,
    );
  }

  function handleYearChange() {
    const year = elements.yearSelect?.value;
    if (!year) {
      return;
    }
    const first = papers
      .map((paper) => ({ paper, parsed: parsePaperId(paper.id) }))
      .filter((item) => item.parsed?.year === year)
      .sort(
        (left, right) =>
          right.parsed.month.localeCompare(left.parsed.month) ||
          left.parsed.set.localeCompare(right.parsed.set),
      )[0];
    if (first) {
      openPaper(first.paper.id, { push: true });
    }
  }

  function handleMonthChange() {
    const year = elements.yearSelect?.value;
    const month = elements.monthSelect?.value;
    if (!year || !month) {
      return;
    }
    const first = papers
      .map((paper) => ({ paper, parsed: parsePaperId(paper.id) }))
      .filter(
        (item) => item.parsed?.year === year && item.parsed?.month === month,
      )
      .sort((left, right) => left.parsed.set.localeCompare(right.parsed.set))[0];
    if (first) {
      openPaper(first.paper.id, { push: true });
    }
  }

  function handleKindChange() {
    state.kindFilter = elements.kindSelect?.value || "all";
    writeStoredValue(KIND_STORAGE_KEY, state.kindFilter);
    if (state.kindFilter === "all") {
      state.pieceId = "";
    } else {
      const piece = getPiece(state.kindFilter, 1);
      state.pieceId = piece?.id || state.pieceId;
    }
    setLocationParams(
      {
        piece: state.pieceId || "",
        kind: state.kindFilter === "all" ? "" : state.kindFilter,
      },
      true,
    );
    renderPage();
  }

  /* ------------------------------------------------------ navigation tree */

  function createNavPieceLink(paper, piece) {
    const link = document.createElement("a");
    link.className = "nav-piece-link";
    link.href = `?paper=${encodeURIComponent(paper.id)}&piece=${encodeURIComponent(
      piece.id,
    )}#${piece.id}`;
    link.dataset.paperTarget = paper.id;
    link.dataset.pieceTarget = piece.id;
    link.dataset.kind = piece.kind;
    if (paper.id === state.paperId && piece.id === state.pieceId) {
      link.classList.add("is-active");
    }

    const name = document.createElement("span");
    name.className = "nav-piece-name";
    name.textContent =
      piece.kind === "careful"
        ? `仔细阅读 ${piece.index || 1}`
        : KIND_LABELS[piece.kind] || piece.type || piece.id;

    const range = document.createElement("span");
    range.className = "nav-piece-range";
    range.textContent = String(piece.questionRange || "").replace(/^第\s*/, "");

    link.append(name, range);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      state.pieceId = piece.id;
      if (state.paperId === paper.id) {
        writeStoredValue(PIECE_STORAGE_KEY, piece.id);
        setLocationParams({ piece: piece.id }, true);
        updateNavigationState();
        scrollToPiece(piece.id);
        return;
      }
      openPaper(paper.id, { push: true, scrollTo: piece.id });
    });
    return link;
  }

  function buildNavigation() {
    if (!elements.pieceNavigation) {
      return;
    }
    const fragment = document.createDocumentFragment();

    const heading = document.createElement("div");
    heading.className = "navigation-heading";
    const headingTitle = document.createElement("strong");
    headingTitle.textContent = "阅读分块总览";
    const headingMeta = document.createElement("span");
    headingMeta.textContent = `${papers.length} 套 · 2022-2026`;
    heading.append(headingTitle, headingMeta);
    fragment.append(heading);

    const byYear = new Map();
    papers.forEach((paper) => {
      const parsed = parsePaperId(paper.id);
      if (!parsed) {
        return;
      }
      if (!byYear.has(parsed.year)) {
        byYear.set(parsed.year, new Map());
      }
      const byMonth = byYear.get(parsed.year);
      if (!byMonth.has(parsed.month)) {
        byMonth.set(parsed.month, []);
      }
      byMonth.get(parsed.month).push({ paper, parsed });
    });

    [...byYear.entries()]
      .sort((left, right) => right[0].localeCompare(left[0]))
      .forEach(([year, months]) => {
        const yearDetails = document.createElement("details");
        yearDetails.className = "nav-year";
        const yearSummary = document.createElement("summary");
        const yearLabel = document.createElement("span");
        yearLabel.textContent = `${year} 年`;
        const yearCount = document.createElement("span");
        yearCount.className = "nav-count";
        yearCount.textContent = `${[...months.values()].reduce(
          (total, items) => total + items.length,
          0,
        )} 套`;
        yearSummary.append(yearLabel, yearCount);
        yearDetails.append(yearSummary);
        if (year === parsePaperId(state.paperId)?.year) {
          yearDetails.open = true;
        }

        [...months.entries()]
          .sort((left, right) => right[0].localeCompare(left[0]))
          .forEach(([month, items]) => {
            const monthDetails = document.createElement("details");
            monthDetails.className = "nav-month";
            const monthSummary = document.createElement("summary");
            const monthLabel = document.createElement("span");
            monthLabel.textContent = `${Number(month)} 月`;
            const monthCount = document.createElement("span");
            monthCount.className = "nav-count";
            monthCount.textContent = `${items.length} 套`;
            monthSummary.append(monthLabel, monthCount);
            monthDetails.append(monthSummary);
            if (
              year === parsePaperId(state.paperId)?.year &&
              month === parsePaperId(state.paperId)?.month
            ) {
              monthDetails.open = true;
            }

            items
              .sort((left, right) =>
                left.parsed.set.localeCompare(right.parsed.set),
              )
              .forEach(({ paper }) => {
                const setDetails = document.createElement("details");
                setDetails.className = "nav-set";
                const setSummary = document.createElement("summary");
                const setLabel = document.createElement("span");
                setLabel.textContent = `第 ${paper.set} 套`;
                const setCount = document.createElement("span");
                setCount.className = "nav-count";
                setCount.textContent = `${paper.pieceCount || 4} 篇`;
                setSummary.append(setLabel, setCount);
                setDetails.append(setSummary);
                const isCurrent = paper.id === state.paperId;
                if (isCurrent) {
                  setDetails.open = true;
                }

                const list = document.createElement("div");
                list.className = "nav-piece-list";
                (paper.types || []).forEach((type) => {
                  const piece = {
                    id: `${paper.id}-${type.kind}${
                      type.kind === "careful" ? `-${type.index}` : ""
                    }`,
                    kind: type.kind,
                    index: type.index,
                    range: type.range,
                  };
                  list.append(createNavPieceLink(paper, piece));
                });
                setDetails.append(list);
                monthDetails.append(setDetails);
              });

            yearDetails.append(monthDetails);
          });

        fragment.append(yearDetails);
      });

    elements.pieceNavigation.replaceChildren(fragment);
  }

  function updateNavigationState() {
    elements.pieceNavigation
      ?.querySelectorAll(".nav-piece-link")
      .forEach((link) => {
        const isActive =
          link.dataset.pieceTarget === state.pieceId &&
          link.dataset.paperTarget === state.paperId;
        link.classList.toggle("is-active", isActive);
        if (isActive) {
          const details = link.closest("details.nav-set");
          if (details) {
            details.open = true;
          }
        }
      });
  }

  /* ----------------------------------------------------------- marking */

  function getReadingDocumentId() {
    return `reading-intensive-${state.paperId}`;
  }

  function getReadingDocument() {
    const id = getReadingDocumentId();
    return getReadingDocuments().find((document) => document.id === id) || null;
  }

  function getReadingDocumentShell() {
    const existing = getReadingDocument();
    if (existing) {
      return existing;
    }
    const meta = state.data?.meta || {};
    return {
      id: getReadingDocumentId(),
      title: `${meta.title || state.paperId} 阅读生词`,
      category: READING_CATEGORY,
      section: READING_SECTION,
      createdAt: Date.now(),
      paragraphs: [],
      words: [],
    };
  }

  function getStoredWord(phrase, sentence, kind = "word") {
    const document = getReadingDocument();
    if (!document) {
      return null;
    }
    const id = makeWordId(phrase, sentence, kind);
    return document.words.find((word) => word.id === id) || null;
  }

  function updateTokenMarks() {
    const documentId = getReadingDocumentId();
    elements.content?.querySelectorAll(".word-token").forEach((token) => {
      const key = getItemKey(documentId, { id: token.dataset.wordId });
      token.classList.toggle("is-unknown-token", state.unknown.has(key));
      token.classList.toggle("is-known-token", state.known.has(key));
    });
  }

  function updateWordPanelMarkState() {
    const activeWord = state.activeWord;
    if (!activeWord) {
      return;
    }
    const key = getItemKey(getReadingDocumentId(), activeWord.item);
    const isUnknown = state.unknown.has(key);
    const isKnown = state.known.has(key);
    elements.markUnknownButton?.classList.toggle("is-active", isUnknown);
    elements.markKnownButton?.classList.toggle("is-active", isKnown);
    elements.markUnknownButton?.setAttribute("aria-pressed", String(isUnknown));
    elements.markKnownButton?.setAttribute("aria-pressed", String(isKnown));
  }

  function saveActiveWordMark(mark) {
    const activeWord = state.activeWord;
    if (!activeWord) {
      return;
    }

    const note = String(elements.wordNoteInput?.value || "").trim();
    const meanings = activeWord.meanings || [];
    const phraseText = (activeWord.item.phrases || [])
      .filter((item) => item?.phrase)
      .slice(0, 4)
      .map((item) =>
        item.meaning ? `${item.phrase}（${item.meaning}）` : item.phrase,
      )
      .join("；");
    const synonymText = (activeWord.synonyms || [])
      .slice(0, 5)
      .map((item) => item.word)
      .join("、");
    const meaning = [
      getCombinedMeaning(meanings, note),
      phraseText ? `固定搭配：${phraseText}` : "",
      synonymText ? `同义替换：${synonymText}` : "",
    ]
      .filter(Boolean)
      .join("；");

    const item = {
      ...activeWord.item,
      id:
        activeWord.item.id ||
        makeWordId(activeWord.phrase, activeWord.sentence, activeWord.kind),
      phrase: activeWord.phrase,
      sentence: activeWord.sentence,
      translation: activeWord.translation,
      meaning: meaning || activeWord.item.meaning || "查看上下文理解用法",
      addedAt: activeWord.item.addedAt || Date.now(),
      phonetic:
        isUsablePhonetic(activeWord.item.phonetic) ||
        isUsablePhonetic(elements.wordPanelPhonetic?.textContent),
    };

    const shell = getReadingDocumentShell();
    const words = shell.words.filter((word) => word.id !== item.id);
    words.push(item);
    const saved = saveReadingDocument({ ...shell, words });
    if (!saved) {
      showToast("保存失败，请检查浏览器存储空间");
      return;
    }

    const key = getItemKey(saved.id, item);
    if (mark === "unknown") {
      state.known.delete(key);
      state.unknown.add(key);
    } else {
      state.unknown.delete(key);
      state.known.add(key);
    }
    persistSet(STORAGE_KEYS.known, state.known);
    persistSet(STORAGE_KEYS.unknown, state.unknown);
    state.activeWord.item = item;
    updateTokenMarks();
    updateWordPanelMarkState();
    showToast(
      mark === "unknown"
        ? `${item.phrase} 已加入四级阅读不会`
        : `${item.phrase} 已标记为掌握`,
    );
  }

  /* --------------------------------------------------- synonym library */

  const synonym = {
    entries: null,
    groups: new Map(),
    forms: null,
    loading: null,
  };

  function coreMeaning(meaning) {
    const first = String(meaning || "").split(/[；;，,、：:]/)[0] || "";
    return first
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[.…]/g, "")
      .replace(/[的了地得]$/, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function buildSynonymGroups(entries) {
    synonym.groups.clear();
    Object.keys(entries).forEach((key) => {
      const entry = entries[key];
      const core = coreMeaning(entry?.[2]);
      if (
        core.length < 2 ||
        core.length > 10 ||
        !/^[\u4e00-\u9fff]+$/.test(core)
      ) {
        return;
      }
      if (!synonym.groups.has(core)) {
        synonym.groups.set(core, []);
      }
      synonym.groups.get(core).push(key);
    });
  }

  // 词库只收原形，这里补一层词形回退：applicants → applicant、written → write。
  function wordForms(word) {
    const index = window.CollocationIndex;
    if (index && typeof index.formsFor === "function") {
      return [...index.formsFor(word)];
    }
    const forms = new Set([word]);
    if (!/^[a-z]+$/.test(word) || word.length < 3) {
      return forms;
    }
    const last = word.at(-1);
    const beforeLast = word.at(-2);
    forms.add(`${word}s`);
    if (last === "y" && !"aeiou".includes(beforeLast)) {
      forms.add(`${word.slice(0, -1)}ies`);
      return forms;
    }
    if (last === "e") {
      forms.add(`${word}d`);
      forms.add(`${word.slice(0, -1)}ing`);
      return forms;
    }
    forms.add(`${word}ed`);
    forms.add(`${word}ing`);
    return forms;
  }

  function buildFormIndex(entries) {
    const forms = new Map();
    Object.keys(entries).forEach((key) => {
      const entry = entries[key];
      if (!entry || entry[4] === "phrase" || !/^[a-z][a-z'-]*$/.test(key)) {
        return;
      }
      wordForms(key).forEach((form) => {
        const normalized = String(form || "").toLowerCase();
        if (normalized && !forms.has(normalized)) {
          forms.set(normalized, key);
        }
      });
    });
    synonym.forms = forms;
  }

  async function ensureSynonymIndex() {
    if (synonym.entries) {
      return synonym.entries;
    }
    if (synonym.loading) {
      return synonym.loading;
    }
    synonym.loading = (async () => {
      const index = window.VocabIndex;
      if (!index || typeof index.load !== "function") {
        return null;
      }
      // 固定搭配索引与词库并行加载，保证首屏的搭配行不是空的。
      const collocations = Promise.resolve(
        window.CollocationIndex && typeof window.CollocationIndex.load === "function"
          ? window.CollocationIndex.load()
          : null,
      ).catch(() => null);
      const entries = await index.load().catch(() => null);
      await collocations;
      if (!entries) {
        return null;
      }
      synonym.entries = entries;
      buildSynonymGroups(entries);
      buildFormIndex(entries);
      buildCollocationBank(entries);
      return entries;
    })();
    return synonym.loading;
  }

  function lookupBankEntry(value) {
    if (!synonym.entries) {
      return null;
    }
    const index = window.VocabIndex;
    const key =
      index && typeof index.normalizeKey === "function"
        ? index.normalizeKey(value)
        : normalizePhraseKey(value);
    let entry = synonym.entries[key];
    if (!entry && synonym.forms && key && !key.includes(" ")) {
      const base = synonym.forms.get(key);
      entry = base ? synonym.entries[base] : null;
    }
    if (!entry) {
      return null;
    }
    return {
      word: entry[0] || value,
      phonetic: isUsablePhonetic(entry[1]),
      meaning: entry[2] || "",
      levels: parseLevels(entry[3]),
      kind: entry[4] || "word",
    };
  }

  function synonymPeers(value, limit = 8) {
    const entry = lookupBankEntry(value);
    if (!entry) {
      return [];
    }
    const core = coreMeaning(entry.meaning);
    const keys = synonym.groups.get(core) || [];
    const self = normalizePhraseKey(entry.word);
    return keys
      .filter((key) => key !== self)
      .map((key) => lookupBankEntry(key))
      .filter(Boolean)
      .slice(0, limit);
  }

  const LEVEL_WEIGHTS = { 四级: 4, 六级: 2, 考研: 1 };
  const collocationBank = { byToken: null };

  function buildCollocationBank(entries) {
    const byToken = new Map();
    Object.keys(entries).forEach((key) => {
      const entry = entries[key];
      if (!entry || entry[4] !== "phrase") {
        return;
      }
      const tokens = key.split(" ").filter(Boolean);
      if (tokens.length < 2 || tokens.length > 6) {
        return;
      }
      const item = {
        word: entry[0] || key,
        meaning: entry[2] || "",
        levels: parseLevels(entry[3]),
        length: tokens.length,
      };
      new Set(tokens).forEach((token) => {
        if (token.length < 3) {
          return;
        }
        if (!byToken.has(token)) {
          byToken.set(token, []);
        }
        byToken.get(token).push(item);
      });
    });
    collocationBank.byToken = byToken;
  }

  function levelWeight(levels) {
    return (Array.isArray(levels) ? levels : []).reduce(
      (total, level) => total + (LEVEL_WEIGHTS[level] || 0),
      0,
    );
  }

  function collocationsForWord(value, limit = 8) {
    if (!synonym.entries || !collocationBank.byToken) {
      return [];
    }
    const index = window.VocabIndex;
    const key =
      index && typeof index.normalizeKey === "function"
        ? index.normalizeKey(value)
        : normalizePhraseKey(value);
    if (!key) {
      return [];
    }
    const candidates = new Map();
    key.split(" ").forEach((token) => {
      (collocationBank.byToken.get(token) || []).forEach((item) => {
        const itemKey = normalizePhraseKey(item.word);
        if (!itemKey || itemKey === key || candidates.has(itemKey)) {
          return;
        }
        candidates.set(itemKey, { ...item, key: itemKey });
      });
    });
    return [...candidates.values()]
      .sort((left, right) => {
        const weight = levelWeight(right.levels) - levelWeight(left.levels);
        if (weight !== 0) {
          return weight;
        }
        if (left.length !== right.length) {
          return left.length - right.length;
        }
        return left.word.length - right.word.length;
      })
      .slice(0, limit);
  }

  function createLevelBadges(levels) {
    const usable = (Array.isArray(levels) ? levels : []).filter(
      (level) => PHRASE_LEVEL_SHORT[level],
    );
    if (!usable.length) {
      return null;
    }
    const wrap = document.createElement("span");
    wrap.className = "phrase-levels";
    usable.forEach((level) => {
      const badge = document.createElement("i");
      badge.className = `phrase-level ${PHRASE_LEVEL_CLASS[level] || ""}`.trim();
      badge.textContent = PHRASE_LEVEL_SHORT[level];
      badge.title = `${level}词汇`;
      wrap.append(badge);
    });
    return wrap;
  }

  function createSynonymChip(entry, paragraphId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "synonym-chip";
    button.dataset.word = entry.word;
    button.dataset.wordKind = entry.kind === "phrase" ? "phrase" : "word";
    if (paragraphId) {
      button.dataset.paragraphId = paragraphId;
    }

    const text = document.createElement("span");
    text.className = "synonym-chip-text";
    text.lang = "en";
    text.textContent = entry.word;
    button.append(text);

    const badges = createLevelBadges(entry.levels);
    if (badges) {
      button.append(badges);
    }
    if (entry.meaning) {
      const meaning = document.createElement("em");
      meaning.textContent = entry.meaning.split(/[；;]/)[0].slice(0, 28);
      button.append(meaning);
    }
    button.title = `${entry.word}：${entry.meaning || "查看释义"}`;
    button.setAttribute("aria-label", `查看 ${entry.word} 的释义与同义替换`);
    return button;
  }

  function createSynonymBlock(pairs, paragraphId, options = {}) {
    const usable = (Array.isArray(pairs) ? pairs : []).filter(
      (pair) => pair.origin || pair.option,
    );
    if (!usable.length || !synonym.entries) {
      return null;
    }
    const roles =
      Array.isArray(options.roles) && options.roles.length >= 2
        ? options.roles
        : ["原文", "选项"];

    const block = document.createElement("div");
    block.className = "synonym-block";

    const label = document.createElement("span");
    label.className = "synonym-label";
    label.textContent = "四六级考研替换词库";
    block.append(label);

    const seen = new Set();
    usable.slice(0, 4).forEach((pair) => {
      const row = document.createElement("div");
      row.className = "synonym-row";

      [
        { value: pair.origin, role: roles[0] },
        { value: pair.option, role: roles[1] },
      ].forEach(({ value, role }, index) => {
        const phrase = String(value || "").trim();
        if (!phrase) {
          return;
        }
        if (index > 0) {
          const arrow = document.createElement("span");
          arrow.className = "synonym-arrow";
          arrow.setAttribute("aria-hidden", "true");
          arrow.textContent = "→";
          row.append(arrow);
        }

        const side = document.createElement("div");
        side.className = "synonym-side";

        const head = document.createElement("div");
        head.className = "synonym-head";
        const roleTag = document.createElement("span");
        roleTag.className = "synonym-role";
        roleTag.textContent = role;
        const text = document.createElement("strong");
        text.lang = "en";
        text.textContent = phrase;
        head.append(roleTag, text);
        side.append(head);

        const entry = lookupBankEntry(phrase);
        if (entry) {
          const meta = document.createElement("div");
          meta.className = "synonym-meta";
          const badges = createLevelBadges(entry.levels);
          if (badges) {
            meta.append(badges);
          }
          if (entry.phonetic) {
            const phonetic = document.createElement("span");
            phonetic.className = "synonym-phonetic";
            phonetic.lang = "en";
            phonetic.textContent = entry.phonetic;
            meta.append(phonetic);
          }
          if (meta.childElementCount) {
            side.append(meta);
          }
          if (entry.meaning) {
            const meaning = document.createElement("p");
            meaning.className = "synonym-meaning";
            meaning.textContent = entry.meaning.slice(0, 120);
            side.append(meaning);
          }
        } else {
          const hint = document.createElement("p");
          hint.className = "synonym-meaning is-muted";
          hint.textContent = "不在四六级/考研词库中，点击句子里的单词可查词典。";
          side.append(hint);
        }

        row.append(side);
      });

      block.append(row);

      const peers = [];
      [pair.origin, pair.option].forEach((value) => {
        synonymPeers(value, 6).forEach((peer) => {
          const key = normalizePhraseKey(peer.word);
          if (!key || seen.has(key)) {
            return;
          }
          if (
            key === normalizePhraseKey(pair.origin) ||
            key === normalizePhraseKey(pair.option)
          ) {
            return;
          }
          seen.add(key);
          peers.push(peer);
        });
      });

      if (peers.length) {
        const candidates = document.createElement("div");
        candidates.className = "synonym-candidates";
        const hint = document.createElement("span");
        hint.className = "synonym-candidates-label";
        hint.textContent = "可能出现的替换";
        candidates.append(hint);
        peers.slice(0, 8).forEach((peer) => {
          candidates.append(createSynonymChip(peer, paragraphId));
        });
        block.append(candidates);
      }
    });

    return block;
  }

  function collectPieceReplacementChips(piece) {
    const chips = new Map();

    const add = (entry) => {
      if (!entry || !entry.word) {
        return;
      }
      const key = normalizePhraseKey(entry.word);
      if (!key || chips.has(key)) {
        return;
      }
      chips.set(key, entry);
    };
    const addValue = (value) => add(lookupBankEntry(value));

    (piece.questions || []).forEach((question) => {
      (question.pairs || []).forEach((pair) => {
        addValue(pair.origin);
        addValue(pair.option);
      });

      const insights = matchingInsights(question, piece);
      if (insights) {
        insights.words.forEach(add);
        insights.pairs.forEach((pair) => {
          addValue(pair.origin);
          addValue(pair.option);
        });
        insights.phrases.forEach((phrase) => {
          add({
            word: phrase.phrase,
            kind: "phrase",
            levels: phrase.levels,
            meaning: phrase.meaning,
            phonetic: "",
          });
        });
      }
    });

    return [...chips.values()].sort((left, right) => {
      const weight = levelWeight(right.levels) - levelWeight(left.levels);
      if (weight !== 0) {
        return weight;
      }
      if (left.kind !== right.kind) {
        return left.kind === "phrase" ? 1 : -1;
      }
      return right.word.length - left.word.length;
    });
  }

  function createPieceReplacementSection(piece) {
    if (!synonym.entries) {
      return null;
    }
    const entries = collectPieceReplacementChips(piece);
    if (entries.length < 2) {
      return null;
    }
    const block = document.createElement("section");
    block.className = "piece-replacement-block";

    const head = document.createElement("div");
    head.className = "piece-replacement-head";
    const title = document.createElement("strong");
    title.textContent = "本篇同义替换词";
    const meta = document.createElement("span");
    meta.textContent = `${entries.length} 个四六级/考研词条`;
    head.append(title, meta);
    block.append(head);

    const list = document.createElement("div");
    list.className = "synonym-candidates";
    entries.slice(0, 30).forEach((entry) => {
      list.append(createSynonymChip(entry, `${piece.id}-p1`));
    });
    block.append(list);
    return block;
  }

  /* --------------------------------------------------------- word panel */

  function getParagraphById(paragraphId) {
    return state.paragraphIndex.get(paragraphId) || null;
  }

  function renderMeanings(meanings) {
    if (!elements.wordMeanings) {
      return;
    }
    elements.wordMeanings.replaceChildren();
    if (!meanings.length) {
      return;
    }
    const list = document.createElement("ul");
    meanings.forEach((meaning) => {
      const item = document.createElement("li");
      item.textContent = meaning;
      list.append(item);
    });
    elements.wordMeanings.append(list);
  }

  function renderWordLevelBadges(levels) {
    if (!elements.wordLevelBadges) {
      return;
    }
    elements.wordLevelBadges.replaceChildren();
    const badges = createLevelBadges(levels);
    if (!badges) {
      elements.wordLevelBadges.hidden = true;
      return;
    }
    elements.wordLevelBadges.hidden = false;
    elements.wordLevelBadges.append(badges);
  }

  function renderPhrases(phrases) {
    if (!elements.wordPhrases || !elements.wordPhraseSection) {
      return;
    }
    elements.wordPhrases.replaceChildren();
    const usable = (Array.isArray(phrases) ? phrases : []).filter(
      (item) => item?.phrase,
    );
    elements.wordPhraseSection.hidden = usable.length === 0;
    if (!usable.length) {
      return;
    }
    const list = document.createElement("ul");
    usable.slice(0, 8).forEach((item) => {
      const entry = document.createElement("li");
      const phrase = document.createElement("strong");
      phrase.lang = "en";
      phrase.textContent = item.phrase;
      entry.append(phrase);
      const meaning = String(item.meaning || "").trim();
      if (meaning) {
        const copy = document.createElement("span");
        copy.textContent = meaning;
        entry.append(copy);
      }
      list.append(entry);
    });
    elements.wordPhrases.append(list);
  }

  function renderWordSynonyms(entry) {
    if (!elements.wordSynonyms || !elements.wordSynonymSection) {
      return;
    }
    elements.wordSynonyms.replaceChildren();
    const peers = synonymPeers(entry, 10);
    elements.wordSynonymSection.hidden = peers.length === 0;
    if (!peers.length) {
      return;
    }
    const list = document.createElement("div");
    list.className = "synonym-candidates";
    peers.forEach((peer) => {
      list.append(createSynonymChip(peer, ""));
    });
    elements.wordSynonyms.append(list);
  }

  function openWordPanel(phrase, paragraph, item, kind = "word") {
    state.activeWord = {
      phrase,
      kind,
      sentence: paragraph?.english || phrase,
      translation: paragraph?.chinese || "",
      item: { ...item },
      meanings: [],
      synonyms: [],
    };

    if (elements.wordPanelTitle) {
      elements.wordPanelTitle.textContent = phrase;
    }
    if (elements.wordPanelPhonetic) {
      elements.wordPanelPhonetic.textContent =
        isUsablePhonetic(item.phonetic) || "音标查询中";
    }
    renderWordLevelBadges(item.levels || []);
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = "正在查询词典…";
    }
    elements.wordMeanings?.replaceChildren();
    renderPhrases([]);
    renderWordSynonyms(phrase);
    if (elements.wordContextSentence) {
      elements.wordContextSentence.textContent = paragraph?.english || phrase;
    }
    if (elements.wordContextTranslation) {
      elements.wordContextTranslation.textContent =
        paragraph?.chinese || "当前段落暂无翻译。";
    }
    if (elements.wordNoteInput) {
      elements.wordNoteInput.value =
        item.meaning && item.meaning !== "查看上下文理解用法"
          ? item.meaning
          : "";
    }

    updateWordPanelMarkState();
    if (elements.wordPanel) {
      elements.wordPanel.hidden = false;
      elements.wordPanel.setAttribute("aria-hidden", "false");
    }
    elements.layout?.classList.add("has-word-panel");
  }

  function closeWordPanel() {
    state.lookupRun += 1;
    state.activeWord = null;
    if (elements.wordPanel) {
      elements.wordPanel.hidden = true;
      elements.wordPanel.setAttribute("aria-hidden", "true");
    }
    elements.layout?.classList.remove("has-word-panel");
  }

  function applyWordResult(activeWord, data, statusText) {
    const meanings = [
      ...(Array.isArray(data.translations) ? data.translations : []),
      ...(Array.isArray(data.definitions) ? data.definitions : []),
    ].filter((meaning, index, list) => meaning && list.indexOf(meaning) === index);

    activeWord.meanings = meanings.slice(0, 8);
    activeWord.item.phonetic =
      isUsablePhonetic(data.phonetic) ||
      isUsablePhonetic(activeWord.item.phonetic);
    activeWord.item.meaning = getCombinedMeaning(activeWord.meanings, "");
    activeWord.item.phrases = Array.isArray(data.phrases) ? data.phrases : [];

    renderPanelPhonetic(
      isUsablePhonetic(data.phonetic) || activeWord.item.phonetic,
    );
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = meanings.length
        ? statusText
        : "词典没有返回释义，可手动补充";
    }
    renderMeanings(activeWord.meanings);
    renderPhrases(activeWord.item.phrases);
  }

  async function lookupLocalEntry(value) {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function") {
      return null;
    }
    return index.lookup(value).catch(() => null);
  }

  function mergeWordData(localData, remoteData) {
    const localTranslations = Array.isArray(localData?.translations)
      ? localData.translations
      : [];
    const remoteTranslations = Array.isArray(remoteData?.translations)
      ? remoteData.translations
      : [];
    const localDefinitions = Array.isArray(localData?.definitions)
      ? localData.definitions
      : [];
    const remoteDefinitions = Array.isArray(remoteData?.definitions)
      ? remoteData.definitions
      : [];
    return {
      translations: [...localTranslations, ...remoteTranslations].filter(
        (meaning, index, list) => meaning && list.indexOf(meaning) === index,
      ),
      definitions: [...localDefinitions, ...remoteDefinitions].filter(
        (meaning, index, list) => meaning && list.indexOf(meaning) === index,
      ),
      phonetic:
        isUsablePhonetic(remoteData?.phonetic) ||
        isUsablePhonetic(localData?.phonetic),
      phrases: Array.isArray(remoteData?.phrases) ? remoteData.phrases : [],
      examples: Array.isArray(remoteData?.examples) ? remoteData.examples : [],
      remoteChecked: true,
    };
  }

  async function fetchWordData(value) {
    const response = await fetch(
      `./api/word?word=${encodeURIComponent(normalizeWord(value))}`,
      { credentials: "same-origin" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "暂时没有查到这个词");
    }
    return data;
  }

  async function lookupActiveWord() {
    const activeWord = state.activeWord;
    if (!activeWord) {
      return;
    }

    const cacheKey = normalizeWord(activeWord.phrase);
    const cached = state.lookupCache.get(cacheKey);
    if (
      cached &&
      cached.remoteChecked &&
      !cached.remoteFailed &&
      hasUsableWordResult(cached)
    ) {
      applyWordResult(activeWord, cached, "已从本次缓存读取释义");
      return;
    }

    const run = ++state.lookupRun;
    let localData = null;
    try {
      const localEntry = await lookupLocalEntry(activeWord.phrase);
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      if (localEntry?.meaning) {
        localData = {
          translations: [localEntry.meaning],
          definitions: [],
          phonetic: isUsablePhonetic(localEntry.phonetic),
          phrases: [],
          examples: [],
        };
        if (localEntry.levels?.length) {
          renderWordLevelBadges(localEntry.levels);
        }
        if (localData.phonetic) {
          state.lookupCache.set(cacheKey, localData);
          applyWordResult(
            activeWord,
            localData,
            `已从本地词库读取释义与音标（${localEntry.source}）`,
          );
          return;
        }
      }

      const data = await fetchWordData(activeWord.phrase);
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }

      if (localData) {
        const merged = mergeWordData(localData, data);
        state.lookupCache.set(cacheKey, merged);
        applyWordResult(
          activeWord,
          merged,
          merged.phonetic
            ? "本地词库释义，在线词典已补充音标与固定搭配"
            : "本地词库释义；在线词典暂未提供音标",
        );
        return;
      }

      const remoteReady = hasUsableWordResult(data);
      state.lookupCache.set(cacheKey, {
        ...data,
        remoteChecked: remoteReady,
        remoteFailed: !remoteReady,
      });
      applyWordResult(
        activeWord,
        data,
        remoteReady
          ? "已查询到释义与固定搭配"
          : "在线词典暂时没有返回释义，可手动补充",
      );
    } catch (error) {
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      if (localData) {
        applyWordResult(
          activeWord,
          localData,
          "已读取本地释义；在线音标暂时不可用",
        );
        return;
      }
      if (elements.wordPanelPhonetic) {
        renderPanelPhonetic(activeWord.item.phonetic);
      }
      if (elements.wordLookupStatus) {
        elements.wordLookupStatus.textContent = `${error.message || "查询失败"}，可手动补充释义`;
      }
      renderMeanings(activeWord.meanings || []);
      renderPhrases([]);
    }
  }

  function openWordFromTrigger(button) {
    const phrase = button.dataset.word;
    if (!phrase) {
      return;
    }
    const kind = button.dataset.wordKind === "phrase" ? "phrase" : "word";
    const paragraph = getParagraphById(button.dataset.paragraphId);
    const existing = getStoredWord(phrase, paragraph?.english || "", kind);
    const entry = lookupBankEntry(phrase);
    const item = existing
      ? {
          ...existing,
          levels: existing.levels?.length ? existing.levels : entry?.levels || [],
        }
      : {
          id: makeWordId(phrase, paragraph?.english || "", kind),
          phrase,
          meaning: entry?.meaning || "",
          phonetic: entry?.phonetic || "",
          levels: entry?.levels || [],
        };
    if (existing) {
      item.id = existing.id;
    }
    openWordPanel(phrase, paragraph, item, kind);
    lookupActiveWord();
  }

  /* --------------------------------------------------------- rendering */

  function createStat(value, label) {
    const chip = document.createElement("span");
    chip.className = "stat-chip";
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const copy = document.createElement("span");
    copy.textContent = label;
    chip.append(strong, copy);
    return chip;
  }

  function renderHeroStats() {
    if (!elements.heroStats) {
      return;
    }
    const years = uniqueValues(papers.map((paper) => parsePaperId(paper.id)?.year)).sort();
    const questionCount = papers.reduce(
      (total, paper) => total + (Number(paper.questionCount) || 0),
      0,
    );
    elements.heroStats.replaceChildren(
      createStat(
        years.length ? `${years[0]}-${years[years.length - 1]}` : "—",
        "年份跨度",
      ),
      createStat(papers.length, "套试卷"),
      createStat("3", "个题型"),
      createStat(questionCount, "道题目"),
    );
  }

  function appendEnglishText(container, text, paragraphId) {
    const source = String(text || "");
    const blankPattern = /__\((\d+)\)__/g;
    let cursor = 0;
    let blankMatch = blankPattern.exec(source);

    const appendPlain = (segment) => {
      let lastIndex = 0;
      let match = WORD_PATTERN.exec(segment);
      while (match) {
        if (match.index > lastIndex) {
          container.append(
            document.createTextNode(segment.slice(lastIndex, match.index)),
          );
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "word-token";
        button.dataset.word = match[0];
        button.dataset.paragraphId = paragraphId;
        button.dataset.wordId = makeWordId(match[0], source);
        button.textContent = match[0];
        button.setAttribute(
          "aria-label",
          `查看单词 ${match[0]} 的释义与固定搭配`,
        );
        container.append(button);
        lastIndex = match.index + match[0].length;
        match = WORD_PATTERN.exec(segment);
      }
      if (lastIndex < segment.length) {
        container.append(document.createTextNode(segment.slice(lastIndex)));
      }
    };

    while (blankMatch) {
      appendPlain(source.slice(cursor, blankMatch.index));
      const number = blankMatch[1];
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "blank-slot";
      slot.dataset.blankNumber = number;
      slot.id = `blank-slot-${number}`;
      slot.setAttribute("aria-label", `第 ${number} 空`);

      const slotNumber = document.createElement("span");
      slotNumber.className = "blank-slot-number";
      slotNumber.textContent = number;
      const slotPick = document.createElement("span");
      slotPick.className = "blank-slot-pick";
      slotPick.textContent = state.answers[getAnswerKey(number)] || "?";
      slot.append(slotNumber, slotPick);
      slot.addEventListener("click", () => {
        const row = document.getElementById(`blank-row-${number}`);
        row?.scrollIntoView({ behavior: "smooth", block: "center" });
        row?.querySelector("select")?.focus();
      });
      container.append(slot);
      cursor = blankMatch.index + blankMatch[0].length;
      blankMatch = blankPattern.exec(source);
    }
    appendPlain(source.slice(cursor));
  }

  function createCueBlock(paragraph) {
    const cues = (Array.isArray(paragraph.cues) ? paragraph.cues : []).filter(
      (cue) => cue?.label || cue?.tip,
    );
    if (!cues.length) {
      return null;
    }
    const block = document.createElement("div");
    block.className = "cue-block";
    const head = document.createElement("div");
    head.className = "cue-head";
    const kicker = document.createElement("span");
    kicker.className = "cue-kicker";
    kicker.textContent = "答案高发";
    head.append(kicker);

    const labels = new Set();
    cues.forEach((cue) => {
      const label = String(cue.label || "").trim();
      if (!label || labels.has(label)) {
        return;
      }
      labels.add(label);
      const chip = document.createElement("span");
      chip.className = "cue-chip";
      chip.textContent = label;
      head.append(chip);
    });
    block.append(head);

    const tips = [];
    const seenTips = new Set();
    cues.forEach((cue) => {
      const tip = String(cue.tip || "").trim();
      if (!tip || seenTips.has(tip)) {
        return;
      }
      seenTips.add(tip);
      tips.push(tip);
    });
    if (tips.length) {
      const list = document.createElement("ul");
      list.className = "cue-tip-list";
      tips.forEach((tip) => {
        const item = document.createElement("li");
        item.textContent = tip;
        list.append(item);
      });
      block.append(list);
    }
    return block;
  }

  function createKeyWordRow(paragraph, paragraphId) {
    const words = (Array.isArray(paragraph.keyWords) ? paragraph.keyWords : [])
      .map((word) => String(word || "").trim())
      .filter(Boolean)
      .slice(0, 6);
    if (!words.length) {
      return null;
    }
    const row = document.createElement("div");
    row.className = "key-word-row";
    const label = document.createElement("span");
    label.className = "key-word-label";
    label.textContent = "重点词";
    row.append(label);
    words.forEach((word) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "key-word-chip";
      button.dataset.word = word;
      button.dataset.paragraphId = paragraphId;
      button.textContent = word;
      button.setAttribute("aria-label", `查看 ${word} 的释义与固定搭配`);
      row.append(button);
    });
    return row;
  }

  function collectPhraseEntries(paragraph, limit = 14) {
    const collected = new Map();
    const index = window.CollocationIndex;

    const add = (item) => {
      const phrase = String(item?.phrase || "").trim();
      if (!phrase) {
        return;
      }
      const key = normalizePhraseKey(phrase);
      if (!key) {
        return;
      }
      const levels = (Array.isArray(item.levels) ? item.levels : []).filter(
        (level) => PHRASE_LEVEL_SHORT[level],
      );
      const mask = Number(item.mask) || 0;
      const existing = collected.get(key);
      if (existing) {
        existing.levels = [...new Set([...existing.levels, ...levels])];
        existing.mask |= mask;
        if (!existing.meaning && item.meaning) {
          existing.meaning = String(item.meaning).trim();
        }
        return;
      }
      collected.set(key, {
        phrase,
        levels,
        mask,
        meaning: String(item.meaning || "").trim(),
      });
    };

    if (typeof index?.findInText === "function") {
      index.findInText(paragraph?.english || "").forEach(add);
    }

    return [...collected.values()]
      .sort((left, right) => {
        if (right.mask !== left.mask) {
          return right.mask - left.mask;
        }
        const leftWords = left.phrase.split(" ").length;
        const rightWords = right.phrase.split(" ").length;
        if (rightWords !== leftWords) {
          return rightWords - leftWords;
        }
        return left.phrase.localeCompare(right.phrase);
      })
      .slice(0, limit);
  }

  function createPhraseChip(entry, paragraphId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "key-word-chip phrase-chip";
    button.dataset.word = entry.phrase;
    button.dataset.wordKind = "phrase";
    button.dataset.paragraphId = paragraphId;
    if (entry.levels.length) {
      button.dataset.phraseLevels = entry.levels.join("|");
    }
    if (entry.meaning) {
      button.dataset.phraseMeaning = entry.meaning.slice(0, 400);
    }

    const text = document.createElement("span");
    text.className = "phrase-chip-text";
    text.lang = "en";
    text.textContent = entry.phrase;
    button.append(text);

    const badges = createLevelBadges(entry.levels);
    if (badges) {
      button.append(badges);
    }
    const levelText = entry.levels.length
      ? `${entry.levels.join("、")}固定搭配`
      : "固定搭配";
    button.setAttribute("aria-label", `查看${levelText} ${entry.phrase} 的释义`);
    return button;
  }

  function createPhraseChipList(phrases, paragraphId, className) {
    const wrap = document.createElement("div");
    wrap.className = className;
    phrases.forEach((entry) => {
      wrap.append(createPhraseChip(entry, paragraphId));
    });
    return wrap;
  }

  function createPhraseRow(paragraph, paragraphId, limit = 14) {
    const phrases = collectPhraseEntries(paragraph, limit);
    if (!phrases.length) {
      return null;
    }
    const row = document.createElement("div");
    row.className = "key-word-row phrase-row";
    const label = document.createElement("span");
    label.className = "key-word-label";
    label.textContent = "固定搭配";
    row.append(label);
    phrases.forEach((entry) => {
      row.append(createPhraseChip(entry, paragraphId));
    });
    return row;
  }

  function createTipBlock(piece) {
    const tips = (Array.isArray(piece.tips) ? piece.tips : [])
      .map((tip) => String(tip || "").trim())
      .filter(Boolean);
    if (!tips.length) {
      return null;
    }
    const block = document.createElement("section");
    block.className = "tip-block";
    const head = document.createElement("div");
    head.className = "tip-head";
    const kicker = document.createElement("span");
    kicker.className = "tip-kicker";
    kicker.textContent = "本篇技巧";
    head.append(kicker);
    if (piece.type) {
      const type = document.createElement("span");
      type.className = "tip-type";
      type.textContent = piece.type;
      head.append(type);
    }
    const list = document.createElement("ul");
    list.className = "tip-list";
    tips.forEach((tip) => {
      const item = document.createElement("li");
      item.textContent = tip;
      list.append(item);
    });
    block.append(head, list);
    return block;
  }

  function createParagraphRow(paragraph, piece) {
    const paragraphId = `${piece.id}-p${paragraph.number}`;
    state.paragraphIndex.set(paragraphId, paragraph);

    const row = document.createElement("article");
    row.className = "paragraph-row";
    row.id = paragraphId;

    const toolbar = document.createElement("div");
    toolbar.className = "paragraph-toolbar";

    const number = document.createElement("span");
    number.className = "paragraph-number";
    number.textContent = paragraph.letter
      ? `P${paragraph.number} · ${paragraph.letter}`
      : `P${paragraph.number}`;
    toolbar.append(number);

    const play = document.createElement("button");
    play.type = "button";
    play.className = "paragraph-play-button";
    play.textContent = "朗读";
    play.addEventListener("click", () =>
      playParagraph(paragraph.english, play),
    );
    toolbar.append(play);
    row.append(toolbar);

    const english = document.createElement("p");
    english.className = "paragraph-english";
    english.lang = "en";
    appendEnglishText(english, paragraph.english, paragraphId);
    row.append(english);

    const chinese = document.createElement("p");
    chinese.className = "paragraph-chinese";
    chinese.textContent = paragraph.chinese || "本段暂无译文。";
    row.append(chinese);

    const cue = createCueBlock(paragraph);
    if (cue) {
      row.append(cue);
    }
    const keyWords = createKeyWordRow(paragraph, paragraphId);
    if (keyWords) {
      row.append(keyWords);
    }
    const phrases = createPhraseRow(paragraph, paragraphId);
    if (phrases) {
      row.append(phrases);
    }
    return row;
  }

  /* ------------------------------------------------------ question cards */

  /* ------------------------------------------------ 段落匹配考点推导 */

  const MATCHING_STOP_TOKENS = new Set([
    "however", "therefore", "thus", "moreover", "although", "though", "while",
    "whereas", "because", "since", "when", "where", "which", "that", "this",
    "these", "those", "there", "their", "them", "then", "than", "also",
    "always", "usually", "really", "quite", "rather", "perhaps", "instead",
    "besides", "simply", "actually", "generally", "especially", "such", "some",
    "any", "many", "much", "more", "most", "very", "only", "just", "even",
    "ever", "never", "still", "yet", "too", "again", "once", "upon",
  ]);

  function tokenizeWords(value) {
    const index = window.CollocationIndex;
    if (index && typeof index.tokenize === "function") {
      return index.tokenize(value);
    }
    return (
      String(value || "")
        .replace(/[’‘`]/g, "'")
        .toLowerCase()
        .match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || []
    );
  }

  function resolveAnswerParagraph(question, piece) {
    const letter = String(question?.answer || "").trim().toUpperCase();
    if (!letter) {
      return null;
    }
    return (
      (piece?.paragraphs || []).find(
        (paragraph) => String(paragraph.letter || "").toUpperCase() === letter,
      ) || null
    );
  }

  // 从题干 / 答案段 / 干扰段里挑出四六级与考研词汇，题干命中排在最前。
  function collectMatchingWords(groups, limit = 12) {
    const scored = new Map();
    groups.forEach(({ text, score }) => {
      tokenizeWords(text).forEach((token) => {
        if (token.length < 3 || MATCHING_STOP_TOKENS.has(token)) {
          return;
        }
        const entry = lookupBankEntry(token);
        if (!entry || entry.kind === "phrase" || !entry.levels.length) {
          return;
        }
        const key = normalizePhraseKey(entry.word);
        if (!key) {
          return;
        }
        const current = scored.get(key);
        if (current) {
          current.score = Math.max(current.score, score);
          current.forms.add(token);
          return;
        }
        scored.set(key, { ...entry, score, forms: new Set([token]) });
      });
    });

    return [...scored.values()]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        const weight = levelWeight(right.levels) - levelWeight(left.levels);
        if (weight !== 0) {
          return weight;
        }
        return right.word.length - left.word.length;
      })
      .slice(0, limit);
  }

  // 题干与答案段的对应关系：同词变形或同义改写，就是段落匹配最常考的替换。
  function collectMatchingPairs(stemText, anchorText, limit = 6) {
    const collect = (text) => {
      const found = new Map();
      tokenizeWords(text).forEach((token) => {
        if (token.length < 3 || MATCHING_STOP_TOKENS.has(token)) {
          return;
        }
        const entry = lookupBankEntry(token);
        if (!entry || entry.kind === "phrase") {
          return;
        }
        const key = normalizePhraseKey(entry.word);
        if (key && !found.has(key)) {
          found.set(key, { token, entry, key });
        }
      });
      return found;
    };

    const stem = collect(stemText);
    const anchor = collect(anchorText);
    if (!stem.size || !anchor.size) {
      return [];
    }

    const pairs = [];
    const seen = new Set();
    const push = (anchorItem, stemItem, why) => {
      if (pairs.length >= limit) {
        return;
      }
      const id = `${anchorItem.token}|${stemItem.token}`;
      if (seen.has(id)) {
        return;
      }
      seen.add(id);
      pairs.push({
        origin: anchorItem.token,
        option: stemItem.token,
        why,
      });
    };

    stem.forEach((stemItem, key) => {
      const anchorItem = anchor.get(key);
      if (anchorItem && anchorItem.token !== stemItem.token) {
        push(anchorItem, stemItem, "同词不同词形，题干与原文互相指同一件事");
      }
    });
    stem.forEach((stemItem) => {
      const core = coreMeaning(stemItem.entry.meaning);
      if (core.length < 2 || pairs.length >= limit) {
        return;
      }
      anchor.forEach((anchorItem) => {
        if (anchorItem.key === stemItem.key) {
          return;
        }
        if (coreMeaning(anchorItem.entry.meaning) !== core) {
          return;
        }
        push(anchorItem, stemItem, "同义改写，段落匹配常在这里换词");
      });
    });

    return pairs.slice(0, limit);
  }

  // 题干里的搭配优先，其次才是答案段里的搭配。
  function collectMatchingPhrases(stemText, anchorText, limit = 6) {
    const index = window.CollocationIndex;
    if (!index || typeof index.findInText !== "function") {
      return [];
    }
    const scored = new Map();
    const add = (items, score) => {
      (items || []).forEach((item) => {
        const phrase = String(item?.phrase || "").trim();
        if (!phrase) {
          return;
        }
        const key = normalizePhraseKey(phrase);
        if (!key) {
          return;
        }
        const mask = Number(item.mask) || 0;
        const levels = (Array.isArray(item.levels) ? item.levels : []).filter(
          (level) => PHRASE_LEVEL_SHORT[level],
        );
        const existing = scored.get(key);
        if (existing) {
          existing.score = Math.max(existing.score, score);
          existing.mask |= mask;
          existing.levels = [...new Set([...existing.levels, ...levels])];
          if (!existing.meaning && item.meaning) {
            existing.meaning = String(item.meaning).trim();
          }
          return;
        }
        scored.set(key, {
          phrase,
          levels,
          mask,
          score,
          words: phrase.split(" ").length,
          meaning: String(item.meaning || "").trim(),
        });
      });
    };
    add(index.findInText(stemText || ""), 6);
    add(index.findInText(anchorText || ""), 3);

    return [...scored.values()]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (right.mask !== left.mask) {
          return right.mask - left.mask;
        }
        if (right.words !== left.words) {
          return right.words - left.words;
        }
        return left.phrase.localeCompare(right.phrase);
      })
      .slice(0, limit);
  }

  const matchingInsightCache = new WeakMap();

  function matchingInsights(question, piece) {
    if (!question || question.kind !== "match" || !synonym.entries) {
      return null;
    }
    const cached = matchingInsightCache.get(question);
    if (cached) {
      return cached;
    }
    const paragraph = resolveAnswerParagraph(question, piece);
    const stem = question.stem || "";
    const locate = question.locate?.english || "";
    const anchor = [paragraph?.english, locate].filter(Boolean).join(" ");
    const traps = (question.distractors || [])
      .map((item) => item.source)
      .filter(Boolean)
      .join(" ");
    const insights = {
      letter: String(question.answer || "").trim(),
      paragraphId: paragraph ? `${piece.id}-p${paragraph.number}` : "",
      words: collectMatchingWords([
        { text: stem, score: 6 },
        { text: anchor, score: 3 },
        { text: traps, score: 1 },
      ]),
      pairs: collectMatchingPairs(stem, anchor),
      phrases: collectMatchingPhrases(stem, anchor),
    };
    matchingInsightCache.set(question, insights);
    return insights;
  }

  function createAnalysisHint(text) {
    const hint = document.createElement("p");
    hint.className = "analysis-hint";
    hint.textContent = text;
    return hint;
  }

  function createPairsList(pairs) {
    const list = document.createElement("ul");
    list.className = "analysis-pairs";
    pairs.forEach((pair) => {
      const item = document.createElement("li");
      const origin = document.createElement("span");
      origin.lang = "en";
      origin.textContent = pair.origin || "—";
      const arrow = document.createElement("span");
      arrow.className = "analysis-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "↔";
      const option = document.createElement("span");
      option.lang = "en";
      option.textContent = pair.option || "—";
      item.append(origin, arrow, option);
      if (pair.why) {
        const why = document.createElement("em");
        why.textContent = pair.why;
        item.append(why);
      }
      list.append(item);
    });
    return list;
  }

  function createAnalysisRow(label) {
    const row = document.createElement("div");
    row.className = "analysis-row";
    const tag = document.createElement("span");
    tag.className = "analysis-label";
    tag.textContent = label;
    const body = document.createElement("div");
    body.className = "analysis-body";
    row.append(tag, body);
    return { row, body };
  }

  function createQuestionAnalysis(question, piece) {
    const block = document.createElement("div");
    block.className = "question-analysis";
    block.hidden = true;

    const answer = createAnalysisRow("答案");
    const answerLine = document.createElement("p");
    answerLine.className = "analysis-answer";
    const letter = document.createElement("strong");
    letter.lang = "en";
    letter.textContent = question.answer || "—";
    answerLine.append(letter);
    if (question.typeNote) {
      const type = document.createElement("span");
      type.className = "analysis-type";
      type.textContent = question.typeNote;
      answerLine.append(type);
    }
    answer.body.append(answerLine);
    block.append(answer.row);

    const locate = question.locate || {};
    if (locate.english || locate.chinese) {
      const row = createAnalysisRow(
        locate.label ? `定位 ${locate.label}` : "定位",
      );
      if (locate.english) {
        const english = document.createElement("p");
        english.lang = "en";
        english.textContent = locate.english;
        row.body.append(english);
      }
      if (locate.chinese) {
        const chinese = document.createElement("p");
        chinese.lang = "zh-CN";
        chinese.textContent = locate.chinese;
        row.body.append(chinese);
      }
      block.append(row.row);
    }

    const pairs = (Array.isArray(question.pairs) ? question.pairs : []).filter(
      (pair) => pair.origin || pair.option,
    );
    if (pairs.length) {
      const replace = createAnalysisRow("替换");
      replace.body.append(createPairsList(pairs));

      const synonymBlock = createSynonymBlock(
        pairs,
        `${piece.id}-q${question.number}`,
      );
      if (synonymBlock) {
        replace.body.append(synonymBlock);
      }
      block.append(replace.row);
    }

    const insights = matchingInsights(question, piece);
    if (insights) {
      if (insights.words.length) {
        const row = createAnalysisRow("考点词");
        const chips = document.createElement("div");
        chips.className = "analysis-chips";
        insights.words.forEach((entry) => {
          chips.append(createSynonymChip(entry, insights.paragraphId));
        });
        row.body.append(chips);
        row.body.append(
          createAnalysisHint(
            "题干、答案段与干扰段里的四六级/考研词，点词可查音标释义，也能直接标记掌握或不会。",
          ),
        );
        block.append(row.row);
      }

      if (insights.pairs.length) {
        const row = createAnalysisRow("替换");
        row.body.append(createPairsList(insights.pairs));
        const synonymBlock = createSynonymBlock(
          insights.pairs,
          insights.paragraphId,
          { roles: ["原文", "题干"] },
        );
        if (synonymBlock) {
          row.body.append(synonymBlock);
        }
        block.append(row.row);
      }

      if (insights.phrases.length) {
        const row = createAnalysisRow("搭配");
        row.body.append(
          createPhraseChipList(insights.phrases, insights.paragraphId, "analysis-chips"),
        );
        row.body.append(
          createAnalysisHint(
            "题干与答案段中出现的固定搭配，优先看题干里的那几条，做匹配题时它们通常就是替换信号。",
          ),
        );
        block.append(row.row);
      }
    }

    const verdicts = [
      ...(Array.isArray(question.verdicts) ? question.verdicts : []),
      ...(Array.isArray(question.distractors)
        ? question.distractors.map((item) => ({
            letter: item.letter,
            flag: item.flag || "易误选",
            reason: item.reason,
            source: item.source,
          }))
        : []),
    ].filter((verdict) => verdict.reason);
    if (verdicts.length) {
      const exclude = createAnalysisRow("排除");
      const list = document.createElement("ul");
      list.className = "analysis-verdicts";
      verdicts.forEach((verdict) => {
        const item = document.createElement("li");
        const head = document.createElement("div");
        head.className = "verdict-head";
        const verdictLetter = document.createElement("span");
        verdictLetter.className = "verdict-letter";
        verdictLetter.lang = "en";
        verdictLetter.textContent = verdict.letter ? `${verdict.letter})` : "";
        head.append(verdictLetter);
        if (verdict.flag) {
          const flag = document.createElement("span");
          flag.className = "verdict-flag";
          flag.textContent = verdict.flag;
          head.append(flag);
        }
        item.append(head);
        const reason = document.createElement("p");
        reason.className = "verdict-reason";
        reason.textContent = verdict.reason;
        item.append(reason);
        if (verdict.source) {
          const source = document.createElement("p");
          source.className = "verdict-source";
          source.lang = "en";
          source.textContent = verdict.source;
          item.append(source);
        }
        list.append(item);
      });
      exclude.body.append(list);
      block.append(exclude.row);
    }

    const notes = (Array.isArray(question.notes) ? question.notes : []).filter(
      (note) => note?.text,
    );
    if (notes.length) {
      const noteRow = createAnalysisRow("拆解");
      notes.forEach((note) => {
        const line = document.createElement("p");
        if (note.label) {
          const tag = document.createElement("strong");
          tag.textContent = `${note.label}：`;
          line.append(tag);
        }
        line.append(document.createTextNode(note.text));
        noteRow.body.append(line);
      });
      block.append(noteRow.row);
    }

    return block;
  }

  function applyQuestionCardState(card, question) {
    const key = getAnswerKey(question.number);
    const selected = state.answers[key] || "";
    const revealed = Boolean(state.revealed[key]);
    const correct = Boolean(selected) && selected === question.answer;

    card.classList.toggle("is-answered", Boolean(selected));
    card.classList.toggle("is-revealed", revealed);
    card.dataset.revealed = String(revealed);

    card.querySelectorAll(".question-option").forEach((button) => {
      const letter = button.dataset.letter;
      button.classList.toggle(
        "is-selected",
        Boolean(selected) && letter === selected,
      );
      button.classList.toggle("is-correct", revealed && letter === question.answer);
      button.classList.toggle(
        "is-wrong",
        revealed &&
          Boolean(selected) &&
          letter === selected &&
          letter !== question.answer,
      );
      button.setAttribute(
        "aria-pressed",
        String(Boolean(selected) && letter === selected),
      );
    });

    const analysis = card.querySelector(".question-analysis");
    if (analysis) {
      analysis.hidden = !revealed;
    }
    const toggle = card.querySelector(".question-analysis-toggle");
    if (toggle) {
      toggle.textContent = revealed ? "收起解析" : "查看解析";
    }

    const feedback = card.querySelector(".question-feedback");
    if (feedback) {
      const suffix = question.typeNote ? ` · ${question.typeNote}` : "";
      if (!revealed) {
        feedback.className = "question-feedback";
        feedback.textContent = selected
          ? `已选择 ${selected}，点“验证答案”查看结果。`
          : "";
      } else if (!selected) {
        feedback.className = "question-feedback is-revealed";
        feedback.textContent = `正确答案 ${question.answer}${suffix}`;
      } else if (correct) {
        feedback.className = "question-feedback is-correct";
        feedback.textContent = `答对了 · 正确答案 ${question.answer}${suffix}`;
      } else {
        feedback.className = "question-feedback is-wrong";
        feedback.textContent = `选错了：你选了 ${selected}，正确答案是 ${question.answer}${suffix}`;
      }
    }
  }

  function createChoiceQuestionCard(question, piece) {
    const card = document.createElement("article");
    card.className = "question-card";
    card.id = `question-${question.number}`;
    card.dataset.questionNumber = String(question.number);

    const head = document.createElement("header");
    head.className = "question-head";
    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = `第 ${question.number} 题`;
    head.append(number);
    if (question.typeNote) {
      const type = document.createElement("span");
      type.className = "question-type";
      type.textContent = question.typeNote;
      head.append(type);
    }
    if (question.locate?.label) {
      const locate = document.createElement("a");
      locate.className = "question-locate";
      locate.href = `#${piece.id}-p${
        String(question.locate.label).replace(/[^0-9]/g, "") || "1"
      }`;
      locate.textContent = `定位 ${question.locate.label}`;
      head.append(locate);
    }
    card.append(head);

    const stem = document.createElement("p");
    stem.className = "question-stem";
    stem.lang = "en";
    stem.textContent = question.stem || "";
    card.append(stem);

    if (question.stemTranslation) {
      const translation = document.createElement("p");
      translation.className = "question-stem-translation";
      translation.textContent = question.stemTranslation;
      card.append(translation);
    }

    const contextId = `${piece.id}-q${question.number}`;
    state.paragraphIndex.set(contextId, {
      number: question.number,
      english: question.stem || "",
      chinese: question.stemTranslation || "",
    });

    const options = document.createElement("div");
    options.className = "question-options";
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", `第 ${question.number} 题选项`);
    (question.choices || []).forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-option";
      button.dataset.letter = choice.letter;

      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.lang = "en";
      letter.textContent = choice.letter;

      const text = document.createElement("span");
      text.className = "option-text";
      text.lang = "en";
      text.textContent = choice.text;

      button.append(letter, text);
      if (choice.translation) {
        const translation = document.createElement("em");
        translation.className = "option-translation";
        translation.textContent = choice.translation;
        button.append(translation);
      }
      button.addEventListener("click", () => {
        state.answers[getAnswerKey(question.number)] = choice.letter;
        persistAnswers();
        applyQuestionCardState(card, question);
      });
      options.append(button);
    });
    card.append(options);

    const actions = document.createElement("div");
    actions.className = "question-actions";

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "question-submit";
    submit.textContent = "验证答案";
    submit.addEventListener("click", () => {
      if (!state.answers[getAnswerKey(question.number)]) {
        showToast("先选一个选项再验证");
        return;
      }
      state.revealed[getAnswerKey(question.number)] = true;
      persistRevealed();
      applyQuestionCardState(card, question);
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "question-reset";
    reset.textContent = "重做";
    reset.addEventListener("click", () => {
      delete state.answers[getAnswerKey(question.number)];
      delete state.revealed[getAnswerKey(question.number)];
      persistAnswers();
      persistRevealed();
      applyQuestionCardState(card, question);
    });

    const analysisToggle = document.createElement("button");
    analysisToggle.type = "button";
    analysisToggle.className = "question-analysis-toggle";
    analysisToggle.textContent = "查看解析";
    analysisToggle.addEventListener("click", () => {
      const key = getAnswerKey(question.number);
      state.revealed[key] = !state.revealed[key];
      persistRevealed();
      applyQuestionCardState(card, question);
    });

    actions.append(submit, reset, analysisToggle);
    card.append(actions);

    const feedback = document.createElement("p");
    feedback.className = "question-feedback";
    card.append(feedback);
    card.append(createQuestionAnalysis(question, piece));
    applyQuestionCardState(card, question);
    return card;
  }

  function createMatchingQuestionCard(question, piece) {
    const card = document.createElement("article");
    card.className = "question-card";
    card.id = `question-${question.number}`;
    card.dataset.questionNumber = String(question.number);

    const head = document.createElement("header");
    head.className = "question-head";
    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = `第 ${question.number} 题`;
    head.append(number);
    if (question.typeNote) {
      const type = document.createElement("span");
      type.className = "question-type";
      type.textContent = question.typeNote;
      head.append(type);
    }
    card.append(head);

    const stem = document.createElement("p");
    stem.className = "question-stem";
    stem.lang = "en";
    stem.textContent = question.stem || "";
    card.append(stem);
    if (question.stemTranslation) {
      const translation = document.createElement("p");
      translation.className = "question-stem-translation";
      translation.textContent = question.stemTranslation;
      card.append(translation);
    }

    const letters = (piece.paragraphMap || [])
      .map((item) => item.letter)
      .filter(Boolean);

    const options = document.createElement("div");
    options.className = "question-options is-letter-grid";
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", `第 ${question.number} 题段落选择`);
    letters.forEach((letter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-option is-letter-option";
      button.dataset.letter = letter;
      const text = document.createElement("span");
      text.className = "option-letter";
      text.lang = "en";
      text.textContent = letter;
      button.append(text);
      button.setAttribute("aria-label", `选择 ${letter} 段`);
      button.addEventListener("click", () => {
        state.answers[getAnswerKey(question.number)] = letter;
        persistAnswers();
        applyQuestionCardState(card, question);
      });
      options.append(button);
    });
    card.append(options);

    const actions = document.createElement("div");
    actions.className = "question-actions";

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "question-submit";
    submit.textContent = "验证答案";
    submit.addEventListener("click", () => {
      if (!state.answers[getAnswerKey(question.number)]) {
        showToast("先选一个字母再验证");
        return;
      }
      state.revealed[getAnswerKey(question.number)] = true;
      persistRevealed();
      applyQuestionCardState(card, question);
    });

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "question-reset";
    reset.textContent = "重做";
    reset.addEventListener("click", () => {
      delete state.answers[getAnswerKey(question.number)];
      delete state.revealed[getAnswerKey(question.number)];
      persistAnswers();
      persistRevealed();
      applyQuestionCardState(card, question);
    });

    const analysisToggle = document.createElement("button");
    analysisToggle.type = "button";
    analysisToggle.className = "question-analysis-toggle";
    analysisToggle.textContent = "查看解析";
    analysisToggle.addEventListener("click", () => {
      const key = getAnswerKey(question.number);
      state.revealed[key] = !state.revealed[key];
      persistRevealed();
      applyQuestionCardState(card, question);
    });

    actions.append(submit, reset, analysisToggle);
    card.append(actions);

    const feedback = document.createElement("p");
    feedback.className = "question-feedback";
    card.append(feedback);
    card.append(createQuestionAnalysis(question, piece));
    applyQuestionCardState(card, question);
    return card;
  }

  function applyBlankRowState(row, blank) {
    const key = getAnswerKey(blank.number);
    const picked = state.answers[key] || "";
    const revealed = Boolean(state.revealed[key]);
    const correct = picked && picked === blank.answerLetter;

    row.classList.toggle("is-answered", Boolean(picked));
    row.classList.toggle("is-correct", revealed && correct);
    row.classList.toggle(
      "is-wrong",
      revealed && Boolean(picked) && !correct,
    );

    const status = row.querySelector(".blank-status");
    if (status) {
      if (!revealed) {
        status.textContent = picked ? "已选，待验证" : "";
        status.className = "blank-status";
      } else if (correct) {
        status.textContent = "✓ 正确";
        status.className = "blank-status is-correct";
      } else {
        status.textContent = `✗ 应为 ${blank.answer || "—"}`;
        status.className = "blank-status is-wrong";
      }
    }

    const analysis = row.querySelector(".blank-analysis");
    if (analysis) {
      analysis.hidden = !revealed;
    }

    const slot = document.getElementById(`blank-slot-${blank.number}`);
    if (slot) {
      const pick = slot.querySelector(".blank-slot-pick");
      if (pick) {
        pick.textContent = picked || "?";
      }
      slot.classList.toggle("is-correct", revealed && correct);
      slot.classList.toggle("is-wrong", revealed && Boolean(picked) && !correct);
    }
  }

  function createBlankWordCard(label, entry) {
    if (!entry) {
      return null;
    }
    const card = document.createElement("div");
    card.className = "blank-word-card";

    const head = document.createElement("div");
    head.className = "blank-word-head";
    const title = document.createElement("strong");
    title.lang = "en";
    title.textContent = entry.word;
    head.append(title);
    const badges = createLevelBadges(entry.levels);
    if (badges) {
      head.append(badges);
    }
    if (entry.phonetic) {
      const phonetic = document.createElement("span");
      phonetic.lang = "en";
      phonetic.textContent = entry.phonetic;
      head.append(phonetic);
    }
    card.append(head);

    const meaning = document.createElement("p");
    meaning.className = "blank-word-meaning";
    meaning.textContent = `${label}：${entry.meaning || "词库暂无释义"}`;
    card.append(meaning);
    return card;
  }

  function createCollocationChip(item, paragraphId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "blank-collocation-chip";
    button.dataset.word = item.word;
    button.dataset.wordKind = "phrase";
    if (paragraphId) {
      button.dataset.paragraphId = paragraphId;
    }

    const text = document.createElement("span");
    text.lang = "en";
    text.textContent = item.word;
    button.append(text);

    const badges = createLevelBadges(item.levels);
    if (badges) {
      button.append(badges);
    }
    const meaning = String(item.meaning || "").split(/[；;]/)[0].trim();
    if (meaning) {
      const hint = document.createElement("em");
      hint.textContent = meaning.slice(0, 24);
      button.append(hint);
    }
    button.title = `${item.word}：${item.meaning || "查看搭配释义"}`;
    button.setAttribute("aria-label", `查看固定搭配 ${item.word} 的释义`);
    return button;
  }

  function createBlankReplacementBlock(blank, piece) {
    if (!synonym.entries) {
      return null;
    }
    const entry = lookupBankEntry(blank.answerWord);
    const peers = synonymPeers(blank.answerWord, 8);
    const collocations = collocationsForWord(blank.answerWord, 10);
    if (!entry && !peers.length && !collocations.length) {
      return null;
    }

    const block = document.createElement("div");
    block.className = "blank-replacement-block";

    const label = document.createElement("span");
    label.className = "blank-replacement-label";
    label.textContent = "四六级考研词库 · 同义替换与固定搭配";
    block.append(label);

    const grid = document.createElement("div");
    grid.className = "blank-replacement-grid";
    const answerCard = createBlankWordCard("答案词条", entry);
    if (answerCard) {
      grid.append(answerCard);
    }
    block.append(grid);

    const paragraphId = `${piece.id}-p1`;
    if (peers.length) {
      const candidates = document.createElement("div");
      candidates.className = "synonym-candidates";
      const hint = document.createElement("span");
      hint.className = "synonym-candidates-label";
      hint.textContent = "同义替换";
      candidates.append(hint);
      peers.forEach((peer) => {
        candidates.append(createSynonymChip(peer, paragraphId));
      });
      block.append(candidates);
    }

    if (collocations.length) {
      const list = document.createElement("div");
      list.className = "blank-collocations";
      const hint = document.createElement("span");
      hint.className = "synonym-candidates-label";
      hint.textContent = "固定搭配";
      list.append(hint);
      collocations.forEach((item) => {
        list.append(createCollocationChip(item, paragraphId));
      });
      block.append(list);
    } else {
      const empty = document.createElement("p");
      empty.className = "blank-replacement-empty";
      empty.textContent = "本地词库暂无该词固定搭配，可点击单词查在线词典。";
      block.append(empty);
    }

    return block;
  }

  function createBlankRow(blank, piece) {
    const row = document.createElement("article");
    row.className = "blank-row";
    row.id = `blank-row-${blank.number}`;

    const number = document.createElement("span");
    number.className = "blank-number";
    number.textContent = String(blank.number);

    const select = document.createElement("select");
    select.className = "blank-select";
    select.setAttribute("aria-label", `第 ${blank.number} 空选择答案`);
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "选择 A–O";
    select.append(placeholder);
    (piece.wordBank || []).forEach((item) => {
      const option = document.createElement("option");
      option.value = item.letter;
      option.textContent = `${item.letter}) ${item.word}`;
      select.append(option);
    });
    select.value = state.answers[getAnswerKey(blank.number)] || "";
    select.addEventListener("change", () => {
      const key = getAnswerKey(blank.number);
      if (select.value) {
        state.answers[key] = select.value;
      } else {
        delete state.answers[key];
      }
      persistAnswers();
      applyBlankRowState(row, blank);
      updatePieceProgress(piece);
    });

    const status = document.createElement("span");
    status.className = "blank-status";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "blank-analysis-toggle";
    toggle.textContent = "词性依据";

    row.append(number, select, status, toggle);

    const analysis = document.createElement("div");
    analysis.className = "blank-analysis";
    analysis.hidden = true;

    const answer = document.createElement("p");
    answer.className = "blank-answer";
    const answerLabel = document.createElement("strong");
    answerLabel.textContent = "答案：";
    const answerValue = document.createElement("span");
    answerValue.lang = "en";
    answerValue.textContent = blank.answer || "—";
    answer.append(answerLabel, answerValue);
    if (blank.pos) {
      const pos = document.createElement("em");
      pos.textContent = `【${blank.pos}】`;
      answer.append(pos);
    }
    analysis.append(answer);

    if (blank.posSlot) {
      const slot = document.createElement("p");
      slot.className = "blank-slot-reason";
      const label = document.createElement("strong");
      label.textContent = "词性槽：";
      slot.append(label, document.createTextNode(blank.posSlot));
      analysis.append(slot);
    }
    if (blank.reason) {
      const reason = document.createElement("p");
      const label = document.createElement("strong");
      label.textContent = "依据：";
      reason.append(label, document.createTextNode(blank.reason));
      analysis.append(reason);
    }
    const rivals = (blank.rivals || []).filter((rival) => rival?.word);
    if (rivals.length) {
      const list = document.createElement("ul");
      list.className = "blank-rivals";
      rivals.forEach((rival) => {
        const item = document.createElement("li");
        const word = document.createElement("strong");
        word.lang = "en";
        word.textContent = `${rival.letter || ""}${rival.letter ? ")" : ""} ${
          rival.word
        }`;
        item.append(word);
        const rivalEntry = lookupBankEntry(rival.word);
        const rivalBadges = createLevelBadges(rivalEntry?.levels || []);
        if (rivalBadges) {
          item.append(rivalBadges);
        }
        const why = String(rival.detail || rival.why || "").trim();
        if (why) {
          const copy = document.createElement("span");
          copy.textContent = why;
          item.append(copy);
        }
        list.append(item);
      });
      analysis.append(list);
    }
    const replacement = createBlankReplacementBlock(blank, piece);
    if (replacement) {
      analysis.append(replacement);
    }
    row.append(analysis);

    toggle.addEventListener("click", () => {
      analysis.hidden = !analysis.hidden;
    });

    applyBlankRowState(row, blank);
    return row;
  }

  function createClozeSection(piece) {
    const wrap = document.createElement("section");
    wrap.className = "cloze-practice";

    const head = document.createElement("div");
    head.className = "cloze-practice-head";
    const title = document.createElement("strong");
    title.textContent = "选词填空作答区";
    const meta = document.createElement("span");
    meta.textContent = "先判断词性，再定语义，最后通读校验";
    head.append(title, meta);
    wrap.append(head);

    const bank = document.createElement("div");
    bank.className = "word-bank";
    (piece.wordBank || []).forEach((item) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "word-bank-chip";
      chip.dataset.word = item.word;
      chip.dataset.paragraphId = `${piece.id}-p1`;

      const letter = document.createElement("i");
      letter.textContent = item.letter;
      const text = document.createElement("span");
      text.lang = "en";
      text.textContent = item.word;
      chip.append(letter, text);
      const entry = lookupBankEntry(item.word);
      const badges = createLevelBadges(entry?.levels || []);
      if (badges) {
        const levelRow = document.createElement("span");
        levelRow.className = "word-bank-levels";
        levelRow.append(badges);
        chip.append(levelRow);
      }
      if (entry?.meaning) {
        chip.title = `${item.word}：${entry.meaning.slice(0, 60)}`;
      }
      chip.setAttribute(
        "aria-label",
        `查看选项 ${item.letter} ${item.word} 的释义与固定搭配`,
      );
      bank.append(chip);
    });
    wrap.append(bank);

    const rows = document.createElement("div");
    rows.className = "blank-rows";
    (piece.blanks || []).forEach((blank) => {
      rows.append(createBlankRow(blank, piece));
    });
    wrap.append(rows);

    const actions = document.createElement("div");
    actions.className = "cloze-actions";

    const checkAll = document.createElement("button");
    checkAll.type = "button";
    checkAll.className = "question-submit";
    checkAll.textContent = "验证全部";
    checkAll.addEventListener("click", () => {
      const answered = (piece.blanks || []).filter(
        (blank) => state.answers[getAnswerKey(blank.number)],
      ).length;
      if (!answered) {
        showToast("先给空格选上答案再验证");
        return;
      }
      (piece.blanks || []).forEach((blank) => {
        state.revealed[getAnswerKey(blank.number)] = true;
      });
      persistRevealed();
      rows.querySelectorAll(".blank-row").forEach((row, index) => {
        applyBlankRowState(row, piece.blanks[index]);
      });
      updatePieceProgress(piece);
    });

    const resetAll = document.createElement("button");
    resetAll.type = "button";
    resetAll.className = "question-reset";
    resetAll.textContent = "清空本区";
    resetAll.addEventListener("click", () => {
      (piece.blanks || []).forEach((blank) => {
        const key = getAnswerKey(blank.number);
        delete state.answers[key];
        delete state.revealed[key];
      });
      persistAnswers();
      persistRevealed();
      rows.querySelectorAll(".blank-row").forEach((row, index) => {
        const select = row.querySelector("select");
        if (select) {
          select.value = "";
        }
        applyBlankRowState(row, piece.blanks[index]);
      });
      updatePieceProgress(piece);
    });

    actions.append(checkAll, resetAll);
    wrap.append(actions);
    return wrap;
  }

  function updatePieceProgress(piece) {
    const section = document.getElementById(piece.id);
    const progress = section?.querySelector(".piece-progress");
    if (!progress) {
      return;
    }
    const numbers =
      piece.kind === "cloze"
        ? (piece.blanks || []).map((blank) => blank.number)
        : (piece.questions || []).map((question) => question.number);
    const done = numbers.filter((number) => state.answers[getAnswerKey(number)])
      .length;
    const right = numbers.filter((number) => {
      const key = getAnswerKey(number);
      const answer =
        piece.kind === "cloze"
          ? (piece.blanks || []).find((blank) => blank.number === number)
              ?.answerLetter
          : (piece.questions || []).find(
              (question) => question.number === number,
            )?.answer;
      return state.revealed[key] && state.answers[key] === answer;
    }).length;
    progress.textContent = `已作答 ${done}/${numbers.length} · 已答对 ${right}`;
  }

  function createPieceSection(piece, index) {
    const section = document.createElement("section");
    section.className = `piece-section piece-k-${piece.kind}`;
    section.id = piece.id;
    section.dataset.pieceId = piece.id;
    section.dataset.pieceKind = piece.kind;
    if (piece.kind === "cloze") {
      section.classList.add("is-cloze");
      if (state.clozeTranslation) {
        section.classList.add("is-translation-shown");
      }
    }

    const head = document.createElement("header");
    head.className = "piece-head";

    const copy = document.createElement("div");
    copy.className = "piece-head-copy";

    const kicker = document.createElement("span");
    kicker.className = `piece-kicker piece-type is-section-${piece.kind}`;
    kicker.textContent = `${KIND_SHORT[piece.kind] || piece.type}${
      piece.kind === "careful" ? ` ${piece.index || index + 1}` : ""
    }`;

    const title = document.createElement("h2");
    title.textContent = piece.title || KIND_LABELS[piece.kind] || "阅读篇目";

    const meta = document.createElement("div");
    meta.className = "piece-meta";
    if (piece.questionRange) {
      const range = document.createElement("span");
      range.textContent = piece.questionRange;
      meta.append(range);
    }
    const progress = document.createElement("span");
    progress.className = "piece-progress";
    meta.append(progress);

    copy.append(kicker, title, meta);
    head.append(copy);
    section.append(head);

    const tipBlock = createTipBlock(piece);
    if (tipBlock) {
      section.append(tipBlock);
    }

    const paragraphs = document.createElement("div");
    paragraphs.className = "paragraph-list";
    (piece.paragraphs || []).forEach((paragraph) => {
      paragraphs.append(createParagraphRow(paragraph, piece));
    });
    section.append(paragraphs);

    if (piece.kind === "matching" && (piece.paragraphMap || []).length) {
      const map = document.createElement("section");
      map.className = "paragraph-map";
      const mapHead = document.createElement("div");
      mapHead.className = "paragraph-map-head";
      const mapTitle = document.createElement("strong");
      mapTitle.textContent = "A–O 段落速览";
      const mapMeta = document.createElement("span");
      mapMeta.textContent = "先记主旨指纹，再回原文定位";
      mapHead.append(mapTitle, mapMeta);
      map.append(mapHead);

      const list = document.createElement("div");
      list.className = "paragraph-map-list";
      (piece.paragraphMap || []).forEach((item) => {
        const card = document.createElement("div");
        card.className = "paragraph-map-item";
        const letter = document.createElement("a");
        letter.className = "paragraph-map-letter";
        letter.href = `#${piece.id}-p${item.number || ""}`;
        letter.textContent = item.letter;
        const body = document.createElement("div");
        const fingerprint = document.createElement("strong");
        fingerprint.textContent = item.fingerprint || "";
        const gist = document.createElement("p");
        gist.textContent = item.gist || "";
        body.append(fingerprint, gist);
        card.append(letter, body);
        list.append(card);
      });
      map.append(list);
      section.append(map);
    }

    if (piece.kind === "cloze") {
      section.append(createClozeSection(piece));
    }

    const replacement = createPieceReplacementSection(piece);
    if (replacement) {
      section.append(replacement);
    }

    if ((piece.questions || []).length) {
      const questionSection = document.createElement("section");
      questionSection.className = "question-section";
      const qHead = document.createElement("div");
      qHead.className = "question-section-head";
      const qTitle = document.createElement("h3");
      qTitle.textContent =
        piece.kind === "matching" ? "段落匹配作答" : "逐题解析与验证";
      const qMeta = document.createElement("span");
      qMeta.textContent = piece.questionRange || "";
      qHead.append(qTitle, qMeta);
      questionSection.append(qHead);

      const list = document.createElement("div");
      list.className = "question-list";
      (piece.questions || []).forEach((question) => {
        list.append(
          question.kind === "match"
            ? createMatchingQuestionCard(question, piece)
            : createChoiceQuestionCard(question, piece),
        );
      });
      questionSection.append(list);
      section.append(questionSection);
    }

    if (piece.kind === "cloze") {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cloze-translation-toggle";
      toggle.textContent = "显示译文（含答案，建议做完再看）";
      toggle.addEventListener("click", () => {
        const shown = section.classList.toggle("is-translation-shown");
        toggle.textContent = shown
          ? "隐藏译文"
          : "显示译文（含答案，建议做完再看）";
      });
      head.append(toggle);
    }

    const play = document.createElement("button");
    play.type = "button";
    play.className = "piece-play-button";
    play.textContent = "朗读本篇";
    play.addEventListener("click", () =>
      playSequence(
        (piece.paragraphs || []).map((paragraph) => paragraph.english),
        play,
      ),
    );
    head.append(play);

    updatePieceProgress(piece);
    return section;
  }

  /* ------------------------------------------------------------- render */

  function renderError(message) {
    if (!elements.content) {
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "error-state";
    const title = document.createElement("strong");
    title.textContent = "内容读取失败";
    const copy = document.createElement("span");
    copy.textContent = message;
    wrapper.append(title, copy);
    elements.content.replaceChildren(wrapper);
  }

  function getVisiblePieces() {
    const pieces = state.data?.pieces || [];
    if (state.kindFilter === "all") {
      return pieces;
    }
    return pieces.filter((piece) => piece.kind === state.kindFilter);
  }

  function renderPage() {
    if (!elements.content || !state.data) {
      return;
    }
    const pieces = getVisiblePieces();
    const fragment = document.createDocumentFragment();

    const meta = state.data.meta || {};
    const overview = document.createElement("section");
    overview.className = "reading-overview";
    const overviewTitle = document.createElement("h2");
    overviewTitle.textContent = meta.title || state.paperId;
    const overviewCopy = document.createElement("p");
    overviewCopy.textContent = meta.subtitle || "";
    const stats = document.createElement("div");
    stats.className = "hero-stats";
    stats.append(
      createStat(meta.pieceCount || pieces.length, "篇目"),
      createStat(meta.questionCount || 0, "题目"),
      createStat(meta.phraseCount || 0, "固定搭配"),
      createStat(meta.cueCount || 0, "答案提示"),
    );
    overview.append(overviewTitle, overviewCopy, stats);
    fragment.append(overview);

    pieces.forEach((piece, index) => {
      fragment.append(createPieceSection(piece, index));
    });

    elements.content.replaceChildren(fragment);
    updateNavigationState();
    updateTokenMarks();
    if (elements.answerToggleButton) {
      const total = pieces.reduce(
        (sum, piece) =>
          sum +
          (piece.kind === "cloze"
            ? (piece.blanks || []).length
            : (piece.questions || []).length),
        0,
      );
      elements.answerToggleButton.textContent = `一键显示全部答案（${total}）`;
    }
  }

  function revealAllAnswers() {
    const pieces = getVisiblePieces();
    const numbers = [];
    pieces.forEach((piece) => {
      if (piece.kind === "cloze") {
        (piece.blanks || []).forEach((blank) => numbers.push(blank.number));
      } else {
        (piece.questions || []).forEach((question) =>
          numbers.push(question.number),
        );
      }
    });
    const allRevealed =
      numbers.length > 0 &&
      numbers.every((number) => state.revealed[getAnswerKey(number)]);
    numbers.forEach((number) => {
      const key = getAnswerKey(number);
      if (allRevealed) {
        delete state.revealed[key];
      } else {
        state.revealed[key] = true;
      }
    });
    persistRevealed();

    pieces.forEach((piece) => {
      const section = document.getElementById(piece.id);
      if (!section) {
        return;
      }
      if (piece.kind === "cloze") {
        section.querySelectorAll(".blank-row").forEach((row, index) => {
          applyBlankRowState(row, piece.blanks[index]);
        });
      } else {
        (piece.questions || []).forEach((question) => {
          const card = document.getElementById(`question-${question.number}`);
          if (card) {
            applyQuestionCardState(card, question);
          }
        });
      }
      updatePieceProgress(piece);
    });

    if (elements.answerToggleButton) {
      elements.answerToggleButton.textContent = allRevealed
        ? "一键显示全部答案"
        : "一键隐藏全部答案";
      elements.answerToggleButton.classList.toggle("is-muted", !allRevealed);
    }
  }

  function updateReadingState() {
    if (!elements.readingProgress) {
      return;
    }
    const height = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = height > 0 ? Math.min(1, window.scrollY / height) : 0;
    elements.readingProgress.style.width = `${(ratio * 100).toFixed(2)}%`;
  }

  function requestReadingStateUpdate() {
    if (scrollFrame) {
      return;
    }
    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = 0;
      updateReadingState();
    });
  }

  function bindEvents() {
    elements.yearSelect?.addEventListener("change", handleYearChange);
    elements.monthSelect?.addEventListener("change", handleMonthChange);
    elements.setSelect?.addEventListener("change", () => {
      const value = elements.setSelect?.value;
      if (value) {
        openPaper(value, { push: true });
      }
    });
    elements.kindSelect?.addEventListener("change", handleKindChange);

    elements.displayModeButtons.forEach((button) => {
      button.addEventListener("click", () =>
        setDisplayMode(button.dataset.displayMode),
      );
    });
    elements.cueToggleButton?.addEventListener("click", () =>
      setCueVisibility(!state.showCues),
    );
    elements.answerToggleButton?.addEventListener("click", revealAllAnswers);
    elements.readAllButton?.addEventListener("click", () => {
      const pieces = getVisiblePieces();
      playSequence(
        pieces.flatMap((piece) =>
          (piece.paragraphs || []).map((paragraph) => paragraph.english),
        ),
        elements.readAllButton,
      );
    });
    elements.closeWordPanelButton?.addEventListener("click", closeWordPanel);
    elements.speakWordButton?.addEventListener("click", () => {
      const phrase = state.activeWord?.phrase;
      if (phrase) {
        playParagraph(phrase, elements.speakWordButton);
      }
    });
    elements.markUnknownButton?.addEventListener("click", () =>
      saveActiveWordMark("unknown"),
    );
    elements.markKnownButton?.addEventListener("click", () =>
      saveActiveWordMark("known"),
    );

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest(
        ".word-token, .key-word-chip, .synonym-chip, .word-bank-chip",
      );
      if (!trigger || !elements.content?.contains(trigger)) {
        return;
      }
      event.preventDefault();
      openWordFromTrigger(trigger);
    });

    window.addEventListener("scroll", requestReadingStateUpdate, {
      passive: true,
    });
    window.addEventListener("resize", requestReadingStateUpdate);
    window.addEventListener("popstate", () => {
      const params = getLocationParams();
      const paperId = params.get("paper");
      if (paperId && paperId !== state.paperId) {
        state.pieceId = params.get("piece") || "";
        state.kindFilter = params.get("kind") || "all";
        openPaper(paperId, { toTop: false, scrollTo: state.pieceId });
      }
    });
    if ("speechSynthesis" in window) {
      window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
    }
  }

  async function initialize() {
    renderHeroStats();
    buildNavigation();
    bindEvents();
    ensureSynonymIndex().then(() => {
      if (state.data) {
        renderPage();
      }
    });

    const params = getLocationParams();
    state.kindFilter =
      params.get("kind") || readStoredValue(KIND_STORAGE_KEY) || "all";
    if (elements.kindSelect) {
      elements.kindSelect.value = state.kindFilter;
    }
    state.pieceId = params.get("piece") || readStoredValue(PIECE_STORAGE_KEY) || "";
    const storedDisplay = readStoredValue(DISPLAY_STORAGE_KEY);
    setDisplayMode(storedDisplay === "english" ? "english" : "bilingual");
    setCueVisibility(readStoredValue(CUE_STORAGE_KEY) !== "hidden");

    const paperId =
      params.get("paper") ||
      readStoredValue(PAPER_STORAGE_KEY) ||
      papers[0]?.id ||
      "";
    if (!paperId) {
      renderError("阅读精读数据尚未生成。");
      return;
    }
    await openPaper(paperId, {
      toTop: false,
      scrollTo: state.pieceId,
    });
    updateReadingState();
  }

  initialize();
})();
