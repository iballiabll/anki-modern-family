(function () {
  "use strict";

  const Deck = window.IballDeck;
  if (!Deck) {
    const fallback = document.querySelector("#intensiveContent");
    if (fallback) {
      fallback.textContent = "精读数据加载失败，请刷新页面。";
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

  const LISTENING_LEVEL =
    window.IBALL_INTENSIVE_LEVEL === "cet6" ? "cet6" : "cet4";
  const LEVEL_CONFIG =
    LISTENING_LEVEL === "cet6"
      ? {
          label: "六级",
          category: "六级",
          section: "六级听力精读",
          eyebrow: "CET-6 LISTENING",
          title: "六级听力全文精读",
          description:
            "2015 至 2026 年六级听力全文翻译、出题点提醒、技巧提示与逐句语法精读。",
          storagePrefix: "iball-cet6-listening",
          papers: Array.isArray(window.IBALL_CET6_LISTENING_PAPERS)
            ? window.IBALL_CET6_LISTENING_PAPERS.slice()
            : [],
          library: (window.IBALL_CET6_LISTENING_LIBRARY =
            window.IBALL_CET6_LISTENING_LIBRARY || {}),
        }
      : {
          label: "四级",
          category: "四级",
          section: "四级听力精读",
          eyebrow: "CET-4 LISTENING",
          title: "四级听力全文精读",
          description:
            "2022 至 2026 年四级听力全文翻译、出题点提醒、技巧提示与逐句语法精读。",
          storagePrefix: "iball-intensive",
          papers: Array.isArray(window.IBALL_INTENSIVE_PAPERS)
            ? window.IBALL_INTENSIVE_PAPERS.slice()
            : [],
          library: (window.IBALL_INTENSIVE_LIBRARY =
            window.IBALL_INTENSIVE_LIBRARY || {}),
        };
  const papers = LEVEL_CONFIG.papers;
  const library = LEVEL_CONFIG.library;
  const WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  const PHONETIC_PLACEHOLDERS = new Set(["暂无音标", "音标查询中"]);
  const INTENSIVE_CATEGORY = LEVEL_CONFIG.category;
  const INTENSIVE_SECTION = LEVEL_CONFIG.section;
  const PAPER_STORAGE_KEY = `${LEVEL_CONFIG.storagePrefix}-paper`;
  const CUE_STORAGE_KEY = `${LEVEL_CONFIG.storagePrefix}-cues`;
  const DISPLAY_STORAGE_KEY = `${LEVEL_CONFIG.storagePrefix}-display-mode`;
  const ANSWER_STORAGE_KEY = `${LEVEL_CONFIG.storagePrefix}-answers`;

  const state = {
    paperId: "",
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
    answers: readStoredAnswers(),
    questionIndex: new Map(),
  };

  const elements = {
    readingProgress: document.querySelector("#readingProgress"),
    sourceLink: document.querySelector("#sourceLink"),
    heroStats: document.querySelector("#heroStats"),
    heroEyebrow: document.querySelector(".hero-eyebrow"),
    heroDescription: document.querySelector(".hero-description"),
    layout: document.querySelector("#intensiveLayout"),
    paperSelect: document.querySelector("#paperSelect"),
    pieceNavigation: document.querySelector("#pieceNavigation"),
    content: document.querySelector("#intensiveContent"),
    cueToggleButton: document.querySelector("#cueToggleButton"),
    grammarToggleButton: document.querySelector("#grammarToggleButton"),
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
    wordExampleSection: document.querySelector("#wordExampleSection"),
    wordExamples: document.querySelector("#wordExamples"),
    wordContextSentence: document.querySelector("#wordContextSentence"),
    wordContextTranslation: document.querySelector("#wordContextTranslation"),
    wordNoteInput: document.querySelector("#wordNoteInput"),
    markUnknownButton: document.querySelector("#markUnknownButton"),
    markKnownButton: document.querySelector("#markKnownButton"),
    closeWordPanelButton: document.querySelector("#closeWordPanelButton"),
  };

  let activeSpeechButton = null;
  let activeSequenceButton = null;
  let voices = [];
  let scrollFrame = 0;

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

  function readStoredAnswers() {
    try {
      const parsed = JSON.parse(readStoredValue(ANSWER_STORAGE_KEY) || "{}");
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
        [...meanings, note].map((value) => String(value || "").trim()).filter(Boolean),
      ),
    ]
      .join("；")
      .slice(0, 800);
  }

  /* ---------------------------------------------------------------- speech */

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
    elements.readAllButton.textContent = state.allSpeaking ? "停止播放" : "全文播放";
    elements.readAllButton.setAttribute("aria-pressed", String(state.allSpeaking));
  }

  function stopSpeech() {
    state.speechRun += 1;
    state.allSpeaking = false;
    if (activeSpeechButton) {
      setSpeechButtonState(activeSpeechButton, false);
    }
    if (activeSequenceButton) {
      activeSequenceButton.classList.remove("is-playing");
      activeSequenceButton = null;
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
      if (
        runId === state.speechRun &&
        event.error !== "canceled" &&
        event.error !== "interrupted"
      ) {
        onError?.(event.error || "speech-error");
      }
      finish();
    };

    window.speechSynthesis.speak(utterance);
    return true;
  }

  function playParagraph(text, button) {
    if (button.classList.contains("is-playing")) {
      stopSpeech();
      showToast("已停止朗读");
      return;
    }

    stopSpeech();
    const runId = state.speechRun;
    setSpeechButtonState(button, true);

    const started = speakText(
      text,
      runId,
      () => {
        if (runId === state.speechRun) {
          setSpeechButtonState(button, false);
        }
      },
      () => showToast("当前浏览器无法朗读这段内容"),
    );

    if (!started) {
      setSpeechButtonState(button, false);
      showToast("当前浏览器不支持语音朗读");
    }
  }

  function playSequence(texts, triggerButton) {
    if (state.allSpeaking) {
      stopSpeech();
      showToast("已停止播放");
      return;
    }

    stopSpeech();
    const speakables = (Array.isArray(texts) ? texts : [])
      .map((text) => String(text || "").trim())
      .filter(Boolean);
    if (
      !speakables.length ||
      !("speechSynthesis" in window) ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }

    const runId = state.speechRun;
    state.allSpeaking = true;
    if (triggerButton) {
      activeSequenceButton = triggerButton;
      triggerButton.classList.add("is-playing");
    }
    updateReadAllButton();

    const finish = (message = "") => {
      if (runId !== state.speechRun) {
        return;
      }
      state.allSpeaking = false;
      if (activeSequenceButton) {
        activeSequenceButton.classList.remove("is-playing");
        activeSequenceButton = null;
      }
      updateReadAllButton();
      if (message) {
        showToast(message);
      }
    };

    /*
     * 整段一次交给统一播放通道：句子之间不再插 140ms 延时（那是断句感的主要来源），
     * 暂停 / 继续 / 重播由右下角控制条接管。
     */
    if (typeof window.IballSpeech?.speakSequence === "function") {
      const started = window.IballSpeech.speakSequence(speakables, {
        label: "全文播放",
        rate: 0.88,
        onFinish: (message) => finish(message || "播放完成"),
        onError: () => finish("播放中止，请稍后重试"),
        onUnsupported: () => finish("当前浏览器不支持语音朗读"),
      });
      if (!started) {
        finish("当前浏览器不支持语音朗读");
      }
      return;
    }

    let index = 0;
    const playNext = () => {
      if (runId !== state.speechRun || !state.allSpeaking) {
        return;
      }
      if (index >= speakables.length) {
        finish("播放完成");
        return;
      }

      const started = speakText(
        speakables[index],
        runId,
        () => {
          index += 1;
          window.setTimeout(playNext, 140);
        },
        () => {
          finish("播放中止，请稍后重试");
        },
      );

      if (!started) {
        finish("当前浏览器不支持语音朗读");
      }
    };

    playNext();
  }

  /* ------------------------------------------------------------- settings */

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

  function getGrammarNotes() {
    return Array.from(
      elements.content?.querySelectorAll("details.grammar-note") || [],
    );
  }

  function updateGrammarToggle() {
    const notes = getGrammarNotes();
    const allOpen = notes.length > 0 && notes.every((note) => note.open);
    if (elements.grammarToggleButton) {
      elements.grammarToggleButton.textContent = allOpen
        ? "收起全部语法"
        : "展开全部语法";
      elements.grammarToggleButton.setAttribute("aria-pressed", String(allOpen));
    }
  }

  function toggleAllGrammar() {
    const notes = getGrammarNotes();
    const shouldOpen = notes.some((note) => !note.open);
    notes.forEach((note) => {
      note.open = shouldOpen;
    });
    updateGrammarToggle();
  }

  /* ------------------------------------------------------- intensive data */

  function getPaperMeta(paperId) {
    return papers.find((paper) => paper.id === paperId) || null;
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
        const data = library[meta.id];
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

  function getPaperFromLocation() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("paper") || "";
    } catch {
      return "";
    }
  }

  function setPaperInLocation(paperId, push) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("paper", paperId);
      const next = `${url.pathname}${url.search}${url.hash}`;
      if (push) {
        window.history.pushState({ paper: paperId }, "", next);
      } else {
        window.history.replaceState({ paper: paperId }, "", next);
      }
    } catch {
      // 地址栏更新失败不影响阅读。
    }
  }

  function populatePaperSelect() {
    if (!elements.paperSelect) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const groups = new Map();
    papers.forEach((paper) => {
      const match = /^(\d{4})-(\d{2})-(\d+)$/.exec(paper.id || "");
      const year = match?.[1] || "";
      const month = match?.[2] || "";
      const set = match?.[3] || "";
      const groupLabel = match ? `${year} 年 ${month} 月` : "其他年份";
      if (!groups.has(groupLabel)) {
        groups.set(groupLabel, []);
      }
      groups.get(groupLabel).push({ paper, set });
    });

    groups.forEach((items, groupLabel) => {
      const group = document.createElement("optgroup");
      group.label = groupLabel;
      items.forEach(({ paper, set }) => {
        const option = document.createElement("option");
        option.value = paper.id;
        option.textContent = set
          ? `第 ${set} 套${
              Number.isFinite(paper.questionCount)
                ? ` · ${paper.questionCount} 题`
                : ""
            }`
          : paper.label || paper.title || paper.id;
        group.append(option);
      });
      fragment.append(group);
    });
    elements.paperSelect.replaceChildren(fragment);
  }

  function showLoading(meta) {
    if (!elements.content) {
      return;
    }
    const wrapper = document.createElement("div");
    wrapper.className = "loading-state";

    const title = document.createElement("strong");
    title.textContent = `正在读取${meta?.label || "精读内容"}`;

    const copy = document.createElement("span");
    copy.textContent = "首次打开需要几秒，请稍候。";

    wrapper.append(title, copy);
    elements.content.replaceChildren(wrapper);
    elements.pieceNavigation?.replaceChildren();
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
      if (elements.paperSelect) {
        elements.paperSelect.value = meta.id;
      }
      setPaperInLocation(meta.id, Boolean(options.push));
      writeStoredValue(PAPER_STORAGE_KEY, meta.id);
      renderPage();
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch (error) {
      if (run !== state.openRun) {
        return;
      }
      console.error(error);
      renderError(error?.message || "精读内容加载失败，请刷新后重试。");
    }
  }

  /* ------------------------------------------------------------- marking */

  function getIntensiveDocumentId() {
    const prefix =
      LISTENING_LEVEL === "cet6" ? "cet6-intensive" : "intensive";
    return `${prefix}-${state.paperId}`;
  }

  function getIntensiveDocument() {
    const id = getIntensiveDocumentId();
    return (
      getReadingDocuments().find((document) => document.id === id) || null
    );
  }

  function getIntensiveDocumentShell() {
    const existing = getIntensiveDocument();
    if (existing) {
      return existing;
    }

    const meta = state.data?.meta || {};
    return {
      id: getIntensiveDocumentId(),
      title: `${meta.title || state.paperId} 听力生词`,
      category: INTENSIVE_CATEGORY,
      section: INTENSIVE_SECTION,
      createdAt: Date.now(),
      paragraphs: [],
      words: [],
    };
  }

  function getStoredWord(phrase, sentence, kind = "word") {
    const document = getIntensiveDocument();
    if (!document) {
      return null;
    }
    const id = makeWordId(phrase, sentence, kind);
    return document.words.find((word) => word.id === id) || null;
  }

  function updateTokenMarks() {
    const documentId = getIntensiveDocumentId();
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
    const key = getItemKey(getIntensiveDocumentId(), activeWord.item);
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
    const meaning = [
      getCombinedMeaning(meanings, note),
      phraseText ? `固定搭配：${phraseText}` : "",
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
      meaning:
        meaning ||
        activeWord.item.meaning ||
        "查看上下文理解用法",
      addedAt: activeWord.item.addedAt || Date.now(),
      phonetic:
        isUsablePhonetic(activeWord.item.phonetic) ||
        isUsablePhonetic(elements.wordPanelPhonetic?.textContent),
    };

    const shell = getIntensiveDocumentShell();
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
        ? `${item.phrase} 已加入${INTENSIVE_CATEGORY}不会`
        : `${item.phrase} 已标记为掌握`,
    );
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
    const badges = createPhraseLevelBadges(levels);
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

  function renderExamples(examples) {
    if (!elements.wordExamples || !elements.wordExampleSection) {
      return;
    }
    elements.wordExamples.replaceChildren();
    const usable = (Array.isArray(examples) ? examples : []).filter(
      (item) => item?.english,
    );
    elements.wordExampleSection.hidden = usable.length === 0;
    if (!usable.length) {
      return;
    }

    usable.slice(0, 3).forEach((item) => {
      const entry = document.createElement("div");
      entry.className = "word-example";

      const english = document.createElement("p");
      english.lang = "en";
      english.textContent = item.english;
      entry.append(english);

      const chinese = String(item.chinese || "").trim();
      if (chinese) {
        const copy = document.createElement("p");
        copy.textContent = chinese;
        entry.append(copy);
      }
      elements.wordExamples.append(entry);
    });
  }

  function openWordPanel(phrase, paragraph, item, kind = "word") {
    state.activeWord = {
      phrase,
      kind,
      sentence: paragraph?.english || phrase,
      translation: paragraph?.chinese || "",
      item: { ...item },
      meanings: [],
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
    renderExamples([]);
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
    renderExamples(Array.isArray(data.examples) ? data.examples : []);
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
    const remotePhrases = Array.isArray(remoteData?.phrases)
      ? remoteData.phrases
      : [];
    const remoteExamples = Array.isArray(remoteData?.examples)
      ? remoteData.examples
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
      phrases: remotePhrases,
      examples: remoteExamples,
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
      renderExamples([]);
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
    const chipLevels = String(button.dataset.phraseLevels || "")
      .split("|")
      .map((level) => level.trim())
      .filter((level) => PHRASE_LEVEL_SHORT[level]);
    const chipMeaning = String(button.dataset.phraseMeaning || "").trim();
    const item = existing
      ? {
          ...existing,
          levels: existing.levels?.length ? existing.levels : chipLevels,
        }
      : {
          id: makeWordId(phrase, paragraph?.english || "", kind),
          phrase,
          meaning: chipMeaning,
          phonetic: "",
          levels: chipLevels,
        };
    if (existing) {
      item.id = existing.id;
    }
    openWordPanel(phrase, paragraph, item, kind);
    lookupActiveWord();
  }

  /* ------------------------------------------------------------ rendering */

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

  function createNavigationLink(piece, index) {
    const link = document.createElement("a");
    link.className = "navigation-link";
    link.href = `#${piece.id}`;
    link.dataset.pieceTarget = piece.id;

    const number = document.createElement("span");
    number.className = "navigation-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const copy = document.createElement("span");
    copy.className = "navigation-copy";

    const title = document.createElement("strong");
    title.textContent = piece.title || piece.type || `第 ${index + 1} 篇`;

    const meta = document.createElement("span");
    const metaParts = [];
    if (piece.section) {
      metaParts.push(piece.section);
    }
    if (piece.questionRange) {
      metaParts.push(piece.questionRange);
    }
    const questionTotal = Array.isArray(piece.questions)
      ? piece.questions.filter((question) => question?.stem).length
      : 0;
    if (questionTotal) {
      metaParts.push(`${questionTotal} 题`);
      link.dataset.questionTargets = piece.questions
        .filter((question) => question?.stem)
        .map((question) => question.number)
        .join(",");
    }
    meta.textContent = metaParts.join(" · ");

    copy.append(title, meta);
    link.append(number, copy);
    return link;
  }

  function createGrammarNote(item) {
    const details = document.createElement("details");
    details.className = "grammar-note";
    details.dataset.grammarId = String(item.id ?? "");

    const summary = document.createElement("summary");
    summary.className = "grammar-summary";

    const tag = document.createElement("span");
    tag.className = "grammar-tag";
    tag.textContent = "语法";

    const sentence = document.createElement("strong");
    sentence.textContent = item.sentence || item.location || "点击查看语法拆解";

    const body = document.createElement("div");
    body.className = "grammar-body";

    const location = document.createElement("p");
    location.className = "grammar-location";
    location.textContent = item.location || "延伸语法";

    const explanation = document.createElement("p");
    explanation.className = "grammar-explanation";
    explanation.textContent = item.explanation || "暂无详细解析。";

    summary.append(tag, sentence);
    body.append(location, explanation);
    details.append(summary, body);
    return details;
  }

  function appendEnglishText(container, text, paragraphId) {
    const source = String(text || "");
    let lastIndex = 0;
    let match = WORD_PATTERN.exec(source);

    while (match) {
      if (match.index > lastIndex) {
        container.append(
          document.createTextNode(source.slice(lastIndex, match.index)),
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
      match = WORD_PATTERN.exec(source);
    }

    if (lastIndex < source.length) {
      container.append(document.createTextNode(source.slice(lastIndex)));
    }
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

  const PHRASE_LEVEL_SHORT = { 四级: "四", 六级: "六", 考研: "研" };
  const PHRASE_LEVEL_CLASS = {
    四级: "is-cet4",
    六级: "is-cet6",
    考研: "is-kaoyan",
  };

  function normalizePhraseKey(value) {
    return String(value || "")
      .replace(/[’‘`]/g, "'")
      .toLowerCase()
      .replace(/[.…]+/g, " ")
      .replace(/[^a-z0-9'\- ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function collectPhraseEntries(paragraph) {
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
        const merged = new Set([...existing.levels, ...levels]);
        existing.levels = [...merged];
        existing.mask |= mask;
        if (!existing.meaning && item.meaning) {
          existing.meaning = String(item.meaning).trim();
        }
        existing.seeded = existing.seeded || Boolean(item.seeded);
        return;
      }

      collected.set(key, {
        phrase,
        levels,
        mask,
        meaning: String(item.meaning || "").trim(),
        phonetic: String(item.phonetic || "").trim(),
        seeded: Boolean(item.seeded),
      });
    };

    (Array.isArray(paragraph?.phrases) ? paragraph.phrases : []).forEach((raw) => {
      const phrase = String(raw || "").trim();
      if (!phrase) {
        return;
      }
      const local =
        typeof index?.lookup === "function" ? index.lookup(phrase) : null;
      if (local) {
        add({
          ...local,
          levels: local.levels.length ? local.levels : [INTENSIVE_CATEGORY],
          mask: local.mask || 1,
          seeded: true,
        });
        return;
      }
      add({ phrase, levels: [INTENSIVE_CATEGORY], mask: 1, seeded: true });
    });

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
      .slice(0, 14);
  }

  function createPhraseLevelBadges(levels) {
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
      badge.title = `${level}固定搭配`;
      wrap.append(badge);
    });
    return wrap;
  }

  function createPhraseRow(paragraph, paragraphId) {
    const phrases = collectPhraseEntries(paragraph);
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

      const badges = createPhraseLevelBadges(entry.levels);
      if (badges) {
        button.append(badges);
      }

      const levelText = entry.levels.length
        ? `${entry.levels.join("、")}固定搭配`
        : "固定搭配";
      button.setAttribute("aria-label", `查看${levelText} ${entry.phrase} 的释义`);
      row.append(button);
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

    const type = document.createElement("span");
    type.className = "tip-type";
    type.textContent = piece.type || "";

    head.append(kicker);
    if (piece.type) {
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

  /* --------------------------------------------------------- 逐题验证 */

  function getQuestionContext(question, piece) {
    const paragraphId = question.paragraphNumber
      ? `${piece.id}-p${question.paragraphNumber}`
      : "";
    const paragraph = paragraphId
      ? state.paragraphIndex.get(paragraphId)
      : null;
    if (paragraph) {
      return { id: paragraphId, paragraph };
    }

    const fallbackId = `${piece.id}-q${question.number}`;
    if (!state.paragraphIndex.has(fallbackId)) {
      state.paragraphIndex.set(fallbackId, {
        number: question.number,
        english: question.stem,
        chinese: question.stemTranslation,
      });
    }
    return { id: fallbackId, paragraph: state.paragraphIndex.get(fallbackId) };
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

  function createQuestionAnalysis(question) {
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

    if (question.answerText) {
      const text = document.createElement("span");
      text.lang = "en";
      text.textContent = question.answerText;
      answerLine.append(text);
    }
    if (question.type) {
      const type = document.createElement("span");
      type.className = "analysis-type";
      type.textContent = question.type;
      answerLine.append(type);
    }
    answer.body.append(answerLine);
    block.append(answer.row);

    if (question.locateEnglish || question.locateChinese) {
      const locate = createAnalysisRow(
        question.paragraphNumber ? `定位 P${question.paragraphNumber}` : "定位",
      );
      if (question.locateEnglish) {
        const english = document.createElement("p");
        english.lang = "en";
        english.textContent = question.locateEnglish;
        locate.body.append(english);
      }
      if (question.locateChinese) {
        const chinese = document.createElement("p");
        chinese.lang = "zh-CN";
        chinese.textContent = question.locateChinese;
        locate.body.append(chinese);
      }
      block.append(locate.row);
    }

    if (question.signalCore || question.signalDetail) {
      const signal = createAnalysisRow("信号");
      if (question.signalCore) {
        const core = document.createElement("p");
        core.className = "analysis-signal";
        core.textContent = question.signalCore;
        signal.body.append(core);
      }
      if (question.signalDetail) {
        const detail = document.createElement("p");
        detail.textContent = question.signalDetail;
        signal.body.append(detail);
      }
      block.append(signal.row);
    }

    const pairs = (Array.isArray(question.pairs) ? question.pairs : []).filter(
      (pair) => pair.origin || pair.option,
    );
    if (pairs.length) {
      const replace = createAnalysisRow("替换");
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
      replace.body.append(list);
      block.append(replace.row);
    }

    const verdicts = (
      Array.isArray(question.verdicts) ? question.verdicts : []
    ).filter((verdict) => verdict.reason);
    if (verdicts.length) {
      const exclude = createAnalysisRow("排除");
      const list = document.createElement("ul");
      list.className = "analysis-verdicts";
      verdicts.forEach((verdict) => {
        const item = document.createElement("li");

        const head = document.createElement("div");
        head.className = "verdict-head";
        const letter = document.createElement("span");
        letter.className = "verdict-letter";
        letter.lang = "en";
        letter.textContent = verdict.letter ? `${verdict.letter})` : "";
        head.append(letter);
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

    return block;
  }

  function applyQuestionCardState(card, question) {
    const selected = state.answers[getAnswerKey(question.number)] || "";
    const revealed = card.dataset.revealed === "true";
    const correct = Boolean(selected) && selected === question.answer;

    card.classList.toggle("is-answered", Boolean(selected));
    card.classList.toggle("is-revealed", revealed);

    card.querySelectorAll(".question-option").forEach((button) => {
      const letter = button.dataset.letter;
      button.classList.toggle("is-selected", Boolean(selected) && letter === selected);
      button.classList.toggle("is-correct", revealed && letter === question.answer);
      button.classList.toggle(
        "is-wrong",
        revealed && Boolean(selected) && letter === selected && letter !== question.answer,
      );
      button.setAttribute("aria-pressed", String(Boolean(selected) && letter === selected));
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
      const suffix = question.type ? ` · ${question.type}` : "";
      if (!revealed) {
        feedback.className = "question-feedback";
        feedback.textContent = selected
          ? `已选择 ${selected}，点“提交答案”验证。`
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

  function createQuestionCard(question, piece, context) {
    const card = document.createElement("article");
    card.className = "question-card";
    card.id = `question-${question.number}`;
    card.dataset.questionNumber = String(question.number);
    card.dataset.revealed = state.answers[getAnswerKey(question.number)]
      ? "true"
      : "false";

    const head = document.createElement("header");
    head.className = "question-head";

    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = `第 ${question.number} 题`;
    head.append(number);

    if (question.type) {
      const type = document.createElement("span");
      type.className = "question-type";
      type.textContent = question.type;
      head.append(type);
    }

    if (question.paragraphNumber) {
      const locate = document.createElement("a");
      locate.className = "question-locate";
      locate.href = `#${piece.id}-p${question.paragraphNumber}`;
      locate.textContent = `定位 P${question.paragraphNumber}`;
      head.append(locate);
    }

    const stem = document.createElement("p");
    stem.className = "question-stem";
    stem.lang = "en";
    appendEnglishText(stem, question.stem, context.id);

    const options = document.createElement("div");
    options.className = "question-options";
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", `第 ${question.number} 题选项`);

    question.choices.forEach((choice) => {
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
      button.addEventListener("click", () => {
        state.answers[getAnswerKey(question.number)] = choice.letter;
        persistAnswers();
        applyQuestionCardState(card, question);
        updateQuestionProgress();
      });
      options.append(button);
    });

    const actions = document.createElement("div");
    actions.className = "question-actions";

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "question-submit";
    submit.textContent = "提交答案";
    submit.addEventListener("click", () => {
      if (!state.answers[getAnswerKey(question.number)]) {
        showToast("先选一个选项再提交");
        return;
      }
      card.dataset.revealed = "true";
      applyQuestionCardState(card, question);
      updateQuestionProgress();
    });

    const translationToggle = document.createElement("button");
    translationToggle.type = "button";
    translationToggle.className = "question-translation-toggle";
    translationToggle.textContent = "显示译文";

    const analysisToggle = document.createElement("button");
    analysisToggle.type = "button";
    analysisToggle.className = "question-analysis-toggle";
    analysisToggle.textContent = "查看解析";
    analysisToggle.addEventListener("click", () => {
      card.dataset.revealed =
        card.dataset.revealed === "true" ? "false" : "true";
      applyQuestionCardState(card, question);
    });

    actions.append(submit, translationToggle, analysisToggle);

    const feedback = document.createElement("p");
    feedback.className = "question-feedback";
    feedback.setAttribute("role", "status");

    const translation = document.createElement("div");
    translation.className = "question-translation";
    translation.hidden = true;
    if (question.stemTranslation) {
      const stemCopy = document.createElement("p");
      stemCopy.className = "question-stem-translation";
      stemCopy.lang = "zh-CN";
      stemCopy.textContent = question.stemTranslation;
      translation.append(stemCopy);
    }
    const translationList = document.createElement("ul");
    question.choices.forEach((choice) => {
      if (!choice.translation) {
        return;
      }
      const item = document.createElement("li");
      const letter = document.createElement("span");
      letter.lang = "en";
      letter.textContent = `${choice.letter})`;
      const text = document.createElement("span");
      text.lang = "zh-CN";
      text.textContent = choice.translation;
      item.append(letter, text);
      translationList.append(item);
    });
    if (translationList.childElementCount) {
      translation.append(translationList);
    }

    translationToggle.addEventListener("click", () => {
      translation.hidden = !translation.hidden;
      translationToggle.textContent = translation.hidden ? "显示译文" : "隐藏译文";
    });

    const analysis = createQuestionAnalysis(question);

    card.append(head, stem, options, actions, feedback, translation, analysis);
    return card;
  }

  function createQuestionSection(piece) {
    const questions = (Array.isArray(piece.questions) ? piece.questions : [])
      .filter((question) => question?.stem && Array.isArray(question.choices))
      .slice()
      .sort((left, right) => left.number - right.number);
    if (!questions.length) {
      return null;
    }

    const section = document.createElement("section");
    section.className = "question-section";
    section.dataset.pieceId = piece.id;

    const head = document.createElement("div");
    head.className = "question-section-head";

    const title = document.createElement("h3");
    title.textContent = "逐题验证";

    const progress = document.createElement("span");
    progress.className = "question-progress";
    progress.dataset.questionProgress = questions
      .map((question) => question.number)
      .join(",");

    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "question-reset";
    reset.textContent = "重做本篇";
    reset.addEventListener("click", () => {
      questions.forEach((question) => {
        delete state.answers[getAnswerKey(question.number)];
      });
      persistAnswers();
      section.querySelectorAll(".question-card").forEach((card) => {
        const number = Number.parseInt(card.dataset.questionNumber || "", 10);
        const question = state.questionIndex.get(number);
        if (!question) {
          return;
        }
        card.dataset.revealed = "false";
        const translation = card.querySelector(".question-translation");
        if (translation) {
          translation.hidden = true;
        }
        const translationToggle = card.querySelector(
          ".question-translation-toggle",
        );
        if (translationToggle) {
          translationToggle.textContent = "显示译文";
        }
        applyQuestionCardState(card, question);
      });
      updateQuestionProgress();
      showToast("已清空本篇作答记录");
    });

    head.append(title, progress, reset);

    const list = document.createElement("div");
    list.className = "question-list";
    questions.forEach((question) => {
      const context = getQuestionContext(question, piece);
      const card = createQuestionCard(question, piece, context);
      state.questionIndex.set(question.number, question);
      applyQuestionCardState(card, question);
      list.append(card);
    });

    section.append(head, list);
    return section;
  }

  function updateQuestionProgress() {
    elements.content
      ?.querySelectorAll("[data-question-progress]")
      .forEach((node) => {
        const numbers = String(node.dataset.questionProgress || "")
          .split(",")
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value));
        let answered = 0;
        let correct = 0;
        numbers.forEach((number) => {
          const selected = state.answers[getAnswerKey(number)];
          if (!selected) {
            return;
          }
          answered += 1;
          const question = state.questionIndex.get(number);
          if (question && selected === question.answer) {
            correct += 1;
          }
        });
        node.textContent = answered
          ? `已作答 ${answered}/${numbers.length} · 正确 ${correct}`
          : `共 ${numbers.length} 题`;
      });
  }

  function createParagraphRow(paragraph, piece, paragraphId) {
    const grammar = Array.isArray(paragraph.grammar) ? paragraph.grammar : [];
    const cues = Array.isArray(paragraph.cues) ? paragraph.cues : [];

    const row = document.createElement("div");
    row.className = "paragraph-row";
    row.classList.toggle("has-grammar", grammar.length > 0);
    row.classList.toggle("has-cue", cues.length > 0);
    row.dataset.paragraphNumber = String(paragraph.number);
    row.dataset.grammarCount = String(grammar.length);

    const number = document.createElement("span");
    number.className = "paragraph-number";
    number.textContent = String(paragraph.number).padStart(2, "0");
    number.setAttribute("aria-label", `第 ${paragraph.number} 段`);

    const toolbar = document.createElement("div");
    toolbar.className = "paragraph-toolbar";

    if (cues.length) {
      const cueCount = document.createElement("span");
      cueCount.className = "cue-count";
      cueCount.textContent = `${cues.length} 处出题点`;
      toolbar.append(cueCount);
    }

    const grammarCount = document.createElement("span");
    grammarCount.className = "grammar-count";
    grammarCount.textContent = grammar.length ? `${grammar.length} 处语法` : "";

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "paragraph-play-button";
    playButton.textContent = "播放本段";
    playButton.setAttribute("aria-label", `播放第 ${paragraph.number} 段英文`);
    playButton.addEventListener("click", () => {
      playParagraph(paragraph.english, playButton);
    });

    const english = document.createElement("p");
    english.className = "paragraph-english";
    english.lang = "en";
    appendEnglishText(english, paragraph.english, paragraphId);

    const chinese = document.createElement("p");
    chinese.className = "paragraph-chinese";
    chinese.lang = "zh-CN";
    chinese.textContent = paragraph.chinese || "";

    toolbar.append(grammarCount, playButton);
    row.append(number, toolbar, english, chinese);

    const keyWords = createKeyWordRow(paragraph, paragraphId);
    if (keyWords) {
      row.append(keyWords);
    }

    const phraseRow = createPhraseRow(paragraph, paragraphId);
    if (phraseRow) {
      row.append(phraseRow);
    }

    const cueBlock = createCueBlock(paragraph);
    if (cueBlock) {
      row.append(cueBlock);
    }

    if (grammar.length) {
      const grammarList = document.createElement("div");
      grammarList.className = "grammar-list";
      grammar.forEach((item) => {
        grammarList.append(createGrammarNote(item));
      });
      row.append(grammarList);
    }

    playButton.dataset.pieceId = piece.id;
    return row;
  }

  function createPieceSection(piece, index) {
    const section = document.createElement("article");
    section.className = "intensive-piece";
    section.id = piece.id;
    section.dataset.pieceId = piece.id;

    const paragraphs = Array.isArray(piece.paragraphs) ? piece.paragraphs : [];
    const extensionGrammar = Array.isArray(piece.extensionGrammar)
      ? piece.extensionGrammar
      : [];

    const head = document.createElement("header");
    head.className = "piece-head";

    const copy = document.createElement("div");
    copy.className = "piece-head-copy";

    const kicker = document.createElement("p");
    kicker.className = "piece-kicker";

    const sectionName = document.createElement("span");
    sectionName.textContent = piece.section || "";

    const type = document.createElement("span");
    type.className = "piece-type";
    const sectionKey = String(piece.section || "").match(/[ABC]$/)?.[0]?.toLowerCase();
    if (sectionKey) {
      type.classList.add(`is-section-${sectionKey}`);
    }
    type.textContent = piece.type || "";

    const questionRange = document.createElement("span");
    questionRange.textContent = piece.questionRange || "";
    kicker.append(sectionName, type, questionRange);

    const title = document.createElement("h2");
    title.textContent = piece.title || piece.type || `第 ${index + 1} 篇`;

    const paragraphGrammarCount = paragraphs.reduce(
      (total, paragraph) =>
        total + (Array.isArray(paragraph.grammar) ? paragraph.grammar.length : 0),
      0,
    );
    const grammarTotal = paragraphGrammarCount + extensionGrammar.length;
    const meta = document.createElement("p");
    meta.className = "piece-meta";
    meta.textContent = `${String(index + 1).padStart(2, "0")} · ${paragraphs.length} 段 · ${grammarTotal} 处语法`;

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "piece-play-button";
    playButton.textContent = "播放本篇";
    playButton.setAttribute("aria-label", `播放第 ${index + 1} 篇英文全文`);
    playButton.addEventListener("click", () => {
      playSequence(
        paragraphs.map((paragraph) => paragraph.english),
        playButton,
      );
    });

    copy.append(kicker, title, meta);
    head.append(copy, playButton);
    section.append(head);

    const tipBlock = createTipBlock(piece);
    if (tipBlock) {
      section.append(tipBlock);
    }

    const paragraphList = document.createElement("div");
    paragraphList.className = "paragraph-list";
    paragraphs.forEach((paragraph) => {
      const paragraphId = `${piece.id}-p${paragraph.number}`;
      state.paragraphIndex.set(paragraphId, paragraph);
      paragraphList.append(createParagraphRow(paragraph, piece, paragraphId));
    });
    section.append(paragraphList);

    const questionSection = createQuestionSection(piece);
    if (questionSection) {
      section.append(questionSection);
    }

    if (extensionGrammar.length) {
      const extension = document.createElement("section");
      extension.className = "extension-section";

      const heading = document.createElement("div");
      heading.className = "extension-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "延伸语法";

      const headingMeta = document.createElement("span");
      headingMeta.textContent = `${extensionGrammar.length} 处补充`;

      heading.append(headingTitle, headingMeta);
      extension.append(heading);
      extensionGrammar.forEach((item) => {
        extension.append(createGrammarNote(item));
      });
      section.append(extension);
    }

    return section;
  }

  function renderError(message) {
    if (!elements.content) {
      return;
    }

    const state_ = document.createElement("div");
    state_.className = "error-state";

    const title = document.createElement("strong");
    title.textContent = "精读内容暂时无法显示";

    const copy = document.createElement("span");
    copy.textContent = message;

    state_.append(title, copy);
    elements.content.replaceChildren(state_);
    elements.pieceNavigation?.replaceChildren();
    elements.heroStats?.replaceChildren();
  }

  function updateReadingState() {
    const documentElement = document.documentElement;
    const maxScroll =
      documentElement.scrollHeight - documentElement.clientHeight;
    const ratio =
      maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;

    if (elements.readingProgress) {
      elements.readingProgress.style.transform = `scaleX(${ratio})`;
    }

    const pieces = state.data?.pieces || [];
    const marker = window.innerWidth <= 640 ? 92 : 124;
    let activeId = pieces[0]?.id || "";

    pieces.forEach((piece) => {
      const pieceElement = document.getElementById(piece.id);
      if (pieceElement && pieceElement.getBoundingClientRect().top <= marker) {
        activeId = piece.id;
      }
    });

    if (ratio > 0.995 && pieces.length) {
      activeId = pieces.at(-1).id;
    }

    elements.pieceNavigation
      ?.querySelectorAll("[data-piece-target]")
      .forEach((link) => {
        const active = link.dataset.pieceTarget === activeId;
        link.classList.toggle("is-active", active);
        if (active) {
          link.setAttribute("aria-current", "true");
        } else {
          link.removeAttribute("aria-current");
        }
      });
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

  function renderPage() {
    const data = state.data;
    if (!data || !Array.isArray(data.pieces) || data.pieces.length === 0) {
      renderError("没有读取到听力精读数据。");
      return;
    }

    const pieces = data.pieces;
    const paragraphCount = pieces.reduce(
      (total, piece) =>
        total + (Array.isArray(piece.paragraphs) ? piece.paragraphs.length : 0),
      0,
    );
    const grammarCount = pieces.reduce(
      (total, piece) =>
        total +
        (Array.isArray(piece.paragraphs) ? piece.paragraphs : []).reduce(
          (subtotal, paragraph) =>
            subtotal +
            (Array.isArray(paragraph.grammar) ? paragraph.grammar.length : 0),
          0,
        ) +
        (Array.isArray(piece.extensionGrammar)
          ? piece.extensionGrammar.length
          : 0),
      0,
    );
    const cueCount = pieces.reduce(
      (total, piece) =>
        total +
        (Array.isArray(piece.paragraphs) ? piece.paragraphs : []).reduce(
          (subtotal, paragraph) =>
            subtotal + (Array.isArray(paragraph.cues) ? paragraph.cues.length : 0),
          0,
        ),
      0,
    );
    const phraseCount = pieces.reduce(
      (total, piece) =>
        total +
        (Array.isArray(piece.paragraphs) ? piece.paragraphs : []).reduce(
          (subtotal, paragraph) => subtotal + collectPhraseEntries(paragraph).length,
          0,
        ),
      0,
    );
    const questionCount = pieces.reduce(
      (total, piece) =>
        total + (Array.isArray(piece.questions) ? piece.questions.length : 0),
      0,
    );

    document.title = `${data.meta?.title || `${LEVEL_CONFIG.label}听力`} · 听力精读 · iball的小屋`;
    if (elements.heroEyebrow) {
      elements.heroEyebrow.textContent =
        data.meta?.title || LEVEL_CONFIG.eyebrow;
    }
    if (elements.heroDescription) {
      elements.heroDescription.textContent =
        data.meta?.subtitle ||
        "逐段对照翻译，标注爱出答案的位置，点击单词看释义与固定搭配。";
    }
    if (elements.sourceLink) {
      if (data.meta?.sourceUrl) {
        elements.sourceLink.href = data.meta.sourceUrl;
      }
      elements.sourceLink.textContent = "原文出处";
    }

    elements.heroStats?.replaceChildren(
      createStat(pieces.length, "篇听力"),
      createStat(paragraphCount, "段原文"),
      createStat(questionCount, "道选择题"),
      createStat(phraseCount, "个固定搭配"),
      createStat(cueCount, "处出题点"),
      createStat(grammarCount, "处语法"),
    );

    state.paragraphIndex.clear();
    state.questionIndex.clear();

    const navigation = document.createDocumentFragment();
    const heading = document.createElement("div");
    heading.className = "navigation-heading";
    heading.textContent = "篇目导航";
    navigation.append(heading);
    pieces.forEach((piece, index) => {
      navigation.append(createNavigationLink(piece, index));
    });
    elements.pieceNavigation?.replaceChildren(navigation);

    const content = document.createDocumentFragment();
    pieces.forEach((piece, index) => {
      content.append(createPieceSection(piece, index));
    });
    elements.content?.replaceChildren(content);

    setDisplayMode(
      readStoredValue(DISPLAY_STORAGE_KEY) === "english" ? "english" : "bilingual",
    );
    setCueVisibility(readStoredValue(CUE_STORAGE_KEY) !== "hidden");

    updateGrammarToggle();
    updateTokenMarks();
    updateReadingState();
  }

  /* --------------------------------------------------------------- events */

  elements.displayModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDisplayMode(button.dataset.displayMode);
    });
  });

  elements.cueToggleButton?.addEventListener("click", () => {
    setCueVisibility(!state.showCues);
  });

  elements.grammarToggleButton?.addEventListener("click", toggleAllGrammar);

  elements.readAllButton?.addEventListener("click", () => {
    playSequence(
      (state.data?.pieces || []).flatMap((piece) =>
        (Array.isArray(piece.paragraphs) ? piece.paragraphs : []).map(
          (paragraph) => paragraph.english,
        ),
      ),
      elements.readAllButton,
    );
  });

  elements.paperSelect?.addEventListener("change", (event) => {
    const paperId = event.target.value;
    if (paperId && paperId !== state.paperId) {
      openPaper(paperId, { push: true });
    }
  });

  elements.content?.addEventListener("click", (event) => {
    const trigger = event.target.closest(".word-token, .key-word-chip");
    if (trigger instanceof HTMLElement) {
      openWordFromTrigger(trigger);
    }
  });

  elements.content?.addEventListener(
    "toggle",
    (event) => {
      if (event.target instanceof HTMLDetailsElement) {
        updateGrammarToggle();
      }
    },
    true,
  );

  elements.closeWordPanelButton?.addEventListener("click", closeWordPanel);
  elements.markUnknownButton?.addEventListener("click", () => {
    saveActiveWordMark("unknown");
  });
  elements.markKnownButton?.addEventListener("click", () => {
    saveActiveWordMark("known");
  });
  elements.speakWordButton?.addEventListener("click", () => {
    const activeWord = state.activeWord;
    if (activeWord) {
      playParagraph(activeWord.phrase, elements.speakWordButton);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeWordPanel();
    }
  });

  window.addEventListener("popstate", () => {
    const paperId = getPaperFromLocation();
    if (paperId && paperId !== state.paperId) {
      openPaper(paperId, { push: false });
    }
  });

  window.addEventListener("scroll", requestReadingStateUpdate, {
    passive: true,
  });
  window.addEventListener("resize", requestReadingStateUpdate);
  window.addEventListener("pagehide", stopSpeech);

  if ("speechSynthesis" in window) {
    refreshVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
  }

  function initialize() {
    document.title = `${LEVEL_CONFIG.title} · iball的小屋`;
    const pageTitle = document.querySelector("#pageTitle");
    if (pageTitle) {
      pageTitle.textContent = LEVEL_CONFIG.title;
    }
    const description = document.querySelector(".hero-description");
    if (description) {
      description.textContent = LEVEL_CONFIG.description;
    }
    if (!papers.length) {
      renderError("没有找到可用的听力精读试卷。");
      return;
    }

    populatePaperSelect();
    setCueVisibility(readStoredValue(CUE_STORAGE_KEY) !== "hidden");

    const requested = getPaperFromLocation();
    const stored = readStoredValue(PAPER_STORAGE_KEY);
    const initialId = getPaperMeta(requested)
      ? requested
      : getPaperMeta(stored)
        ? stored
        : papers[0].id;

    openPaper(initialId, { push: false });

    // 搭配索引 280KB 左右，只影响标记高亮；先出正文，空闲后再拉。
    const warmCollocations = () => {
      refreshCollocationHighlights();
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(warmCollocations, { timeout: 2500 });
    } else {
      window.setTimeout(warmCollocations, 700);
    }
  }

  let collocationRefreshRun = 0;

  function refreshCollocationHighlights() {
    const index = window.CollocationIndex;
    if (!index || typeof index.load !== "function") {
      return;
    }
    const run = ++collocationRefreshRun;
    Promise.resolve(index.load())
      .then((built) => {
        if (!built || run !== collocationRefreshRun) {
          return;
        }
        const apply = () => {
          if (run !== collocationRefreshRun || !state.data) {
            return true;
          }
          if (!state.paragraphIndex.size) {
            return false;
          }
          const scrollY = window.scrollY;
          renderPage();
          updateTokenMarks();
          window.scrollTo({ top: scrollY, behavior: "auto" });
          return true;
        };
        if (!apply()) {
          window.setTimeout(() => {
            if (!apply()) {
              window.setTimeout(apply, 1200);
            }
          }, 400);
        }
      })
      .catch(() => {});
  }

  window.intensiveReading = {
    state,
    elements,
    openPaper,
    renderPage,
    saveActiveWordMark,
  };

  initialize();
})();
