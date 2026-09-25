/*
 * 六级翻译 + 写作精读页。
 * 每套试卷按需加载（cet6-extra-data/<id>.js），进入页面只拉当前套，
 * 点击单词查本地词库 / 在线词典、标记生词，作文可写草稿并统计字数。
 */
(function () {
  "use strict";

  const Deck = window.IballDeck;
  const fallback = document.querySelector("#cet6ExtraContent");
  if (!Deck) {
    if (fallback) {
      fallback.textContent = "站内词库加载失败，请刷新页面后重试。";
    }
    return;
  }

  const {
    STORAGE_KEYS,
    getItemKey,
    getReadingDocuments,
    persistSet,
    restoreSet,
    saveReadingDocument,
  } = Deck;

  const PAPERS = Array.isArray(window.IBALL_CET6_EXTRA_PAPERS)
    ? window.IBALL_CET6_EXTRA_PAPERS
    : [];
  const LIBRARY = (window.IBALL_CET6_EXTRA_LIBRARY =
    window.IBALL_CET6_EXTRA_LIBRARY || {});
  const WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  const PHONETIC_PLACEHOLDERS = new Set(["暂无音标", "音标查询中"]);
  const LOADED_FLAG = "__iballCet6ExtraLoaded";
  const CATEGORY = "六级";
  const SECTION = "六级翻译与写作";
  const PAPER_STORAGE_KEY = "iball-cet6-extra-paper";
  const DISPLAY_STORAGE_KEY = "iball-cet6-extra-display";
  const ANSWER_STORAGE_KEY = "iball-cet6-extra-answers";
  const DRAFT_STORAGE_KEY = "iball-cet6-extra-drafts";
  const DISPLAY_MODES = ["bilingual", "english", "chinese"];
  const LEVEL_NAMES = ["四级", "六级", "考研"];
  const MIN_WORDS = 150;
  const MAX_WORDS = 200;

  const state = {
    paperId: "",
    data: null,
    displayMode: readStoredValue(DISPLAY_STORAGE_KEY) || "bilingual",
    showAnswers: readStoredValue(ANSWER_STORAGE_KEY) !== "hidden",
    unknown: restoreSet(STORAGE_KEYS.unknown),
    known: restoreSet(STORAGE_KEYS.known),
    drafts: readStoredMap(DRAFT_STORAGE_KEY),
    activeWord: null,
    lookupRun: 0,
    speechRun: 0,
    speaking: false,
    lookupCache: new Map(),
    sectionNodes: [],
  };

  const elements = {
    layout: document.querySelector("#cet6ExtraLayout"),
    content: document.querySelector("#cet6ExtraContent"),
    navigation: document.querySelector("#pieceNavigation"),
    heroStats: document.querySelector("#heroStats"),
    paperSelect: document.querySelector("#paperSelect"),
    modeButtons: [
      ...document.querySelectorAll("[data-display-mode]"),
    ],
    answerToggleButton: document.querySelector("#answerToggleButton"),
    readAllButton: document.querySelector("#readAllButton"),
    wordPanel: document.querySelector("#wordPanel"),
    closeWordPanelButton: document.querySelector("#closeWordPanelButton"),
    markUnknownButton: document.querySelector("#markUnknownButton"),
    markKnownButton: document.querySelector("#markKnownButton"),
    wordPanelTitle: document.querySelector("#wordPanelTitle"),
    wordPanelPhonetic: document.querySelector("#wordPanelPhonetic"),
    wordLevelBadges: document.querySelector("#wordLevelBadges"),
    wordLookupStatus: document.querySelector("#wordLookupStatus"),
    wordMeanings: document.querySelector("#wordMeanings"),
    wordPhraseSection: document.querySelector("#wordPhraseSection"),
    wordPhrases: document.querySelector("#wordPhrases"),
    wordSynonymSection: document.querySelector("#wordSynonymSection"),
    wordSynonyms: document.querySelector("#wordSynonyms"),
    wordContextSentence: document.querySelector("#wordContextSentence"),
    wordContextTranslation: document.querySelector("#wordContextTranslation"),
    wordNoteInput: document.querySelector("#wordNoteInput"),
    speakWordButton: document.querySelector("#speakWordButton"),
    toast: document.querySelector("#toast"),
  };

  let toastTimer = 0;
  let voices = [];

  /* ---------------------------------------------------------------- 工具 */

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
      /* 存储不可用时只在本次访问生效，不阻塞阅读。 */
    }
  }

  function readStoredMap(key) {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function persistMap(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 忽略存储异常。 */
    }
  }

  function showToast(message) {
    if (!elements.toast) {
      return;
    }
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2400);
  }

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function normalizeWord(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z'’\-]/g, "")
      .trim();
  }

  function isUsablePhonetic(value) {
    const text = String(value || "").trim();
    return Boolean(text) && !PHONETIC_PLACEHOLDERS.has(text);
  }

  function countWords(text) {
    const matches = String(text || "").match(WORD_PATTERN);
    return matches ? matches.length : 0;
  }

  function getCombinedMeaning(meanings, note) {
    const list = (Array.isArray(meanings) ? meanings : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 4);
    const parts = [...list];
    if (note) {
      parts.push(`补充：${note}`);
    }
    return parts.join("；");
  }

  function makeWordId(phrase, sentence) {
    const base = `${normalizeWord(phrase)}|${String(sentence || "")
      .trim()
      .slice(0, 80)}`;
    let hash = 0;
    for (let index = 0; index < base.length; index += 1) {
      hash = (hash * 31 + base.charCodeAt(index)) | 0;
    }
    return `${normalizeWord(phrase) || "word"}-${Math.abs(hash).toString(36)}`;
  }

  /* --------------------------------------------------------------- 语音 */

  function refreshVoices() {
    voices = window.speechSynthesis?.getVoices?.() || [];
  }

  function getPreferredVoice() {
    if (!voices.length) {
      return null;
    }
    return (
      voices.find(
        (voice) =>
          /^en[-_](US|GB)/i.test(voice.lang) &&
          /samantha|zira|aria|jenny|emma|ava|serena|google/i.test(voice.name),
      ) ||
      voices.find((voice) => /^en[-_]US/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) ||
      null
    );
  }

  function stopSpeech() {
    state.speechRun += 1;
    state.speaking = false;
    try {
      window.speechSynthesis?.cancel?.();
    } catch {
      /* 忽略取消异常。 */
    }
    updateReadAllButton();
  }

  function updateReadAllButton() {
    if (!elements.readAllButton) {
      return;
    }
    elements.readAllButton.classList.toggle("is-playing", state.speaking);
    elements.readAllButton.textContent = state.speaking
      ? "停止播放"
      : "全文朗读";
    elements.readAllButton.setAttribute("aria-pressed", String(state.speaking));
  }

  function speakText(text, runId, onDone, onError) {
    const source = String(text || "").trim();
    if (!source || !window.speechSynthesis) {
      onError?.();
      return false;
    }
    const utterance = new window.SpeechSynthesisUtterance(source);
    const voice = getPreferredVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.onend = () => {
      if (runId === state.speechRun) {
        onDone?.();
      }
    };
    utterance.onerror = () => {
      if (runId === state.speechRun) {
        onError?.();
      }
    };
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function playSequence(texts, triggerButton, label) {
    const list = (Array.isArray(texts) ? texts : [])
      .map((text) => String(text || "").trim())
      .filter(Boolean);
    if (!list.length) {
      showToast("这一套没有可朗读的英文内容");
      return;
    }
    if (state.speaking && state.speechButton === triggerButton) {
      stopSpeech();
      showToast("已停止朗读");
      return;
    }
    stopSpeech();
    const run = state.speechRun;
    state.speaking = true;
    state.speechButton = triggerButton;
    updateReadAllButton();
    const finish = (message) => {
      if (run !== state.speechRun) {
        return;
      }
      state.speaking = false;
      state.speechButton = null;
      updateReadAllButton();
      if (message) {
        showToast(message);
      }
    };
    const playNext = (index) => {
      if (run !== state.speechRun) {
        return;
      }
      if (index >= list.length) {
        finish(label ? `${label}朗读完毕` : "朗读完毕");
        return;
      }
      const started = speakText(
        list[index],
        run,
        () => playNext(index + 1),
        () => finish("浏览器语音不可用，可点击单词单独朗读"),
      );
      if (!started) {
        finish("浏览器语音不可用，可点击单词单独朗读");
      }
    };
    playNext(0);
  }

  /* ------------------------------------------------------------ 数据加载 */

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (LIBRARY[state.paperId]) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () =>
        reject(new Error("试卷数据加载失败，请检查网络后重试")),
      );
      document.head.append(script);
    });
  }

  async function loadPaperData(paperId) {
    if (LIBRARY[paperId]) {
      return LIBRARY[paperId];
    }
    const meta = PAPERS.find((paper) => paper.id === paperId);
    if (!meta) {
      throw new Error(`没有找到试卷 ${paperId}`);
    }
    await loadScriptOnce(meta.file);
    if (!LIBRARY[paperId]) {
      throw new Error("试卷数据格式异常，请刷新页面后重试");
    }
    return LIBRARY[paperId];
  }

  /* -------------------------------------------------------------- 选择器 */

  function buildPaperSelect() {
    if (!elements.paperSelect) {
      return;
    }
    const select = elements.paperSelect;
    select.replaceChildren();
    const groups = new Map();
    PAPERS.forEach((paper) => {
      const groupLabel = `${paper.year} 年`;
      if (!groups.has(groupLabel)) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = groupLabel;
        groups.set(groupLabel, optgroup);
        select.append(optgroup);
      }
      const option = document.createElement("option");
      option.value = paper.id;
      option.textContent = paper.label;
      groups.get(groupLabel).append(option);
    });
    select.value = state.paperId;
  }

  function pickPaper() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("paper");
    const stored = readStoredValue(PAPER_STORAGE_KEY);
    const candidates = [requested, stored];
    for (const candidate of candidates) {
      if (candidate && PAPERS.some((paper) => paper.id === candidate)) {
        return candidate;
      }
    }
    const newest = [...PAPERS].sort((left, right) =>
      right.id.localeCompare(left.id),
    );
    return newest[0]?.id || "";
  }

  function setLocationParam(paperId, push) {
    const url = new URL(window.location.href);
    url.searchParams.set("paper", paperId);
    const next = `${url.pathname}${url.search}`;
    if (push) {
      window.history.pushState({}, "", next);
    } else {
      window.history.replaceState({}, "", next);
    }
  }

  /* ---------------------------------------------------------- 单词渲染 */

  function splitSentenceRanges(text) {
    const ranges = [];
    const source = String(text || "");
    const pattern = /[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g;
    let match = pattern.exec(source);
    while (match) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0].trim(),
      });
      match = pattern.exec(source);
    }
    return ranges;
  }

  function sentenceAt(ranges, index, fallbackText) {
    const hit = ranges.find((range) => index >= range.start && index < range.end);
    return hit ? hit.text : String(fallbackText || "");
  }

  function appendEnglishText(container, text, context = {}) {
    const source = String(text || "");
    const ranges = splitSentenceRanges(source);
    let lastIndex = 0;
    let match = WORD_PATTERN.exec(source);
    while (match) {
      if (match.index > lastIndex) {
        container.append(document.createTextNode(source.slice(lastIndex, match.index)));
      }
      const raw = match[0];
      const button = document.createElement("button");
      button.type = "button";
      button.className = "word-token";
      button.textContent = raw;
      button.dataset.word = raw;
      const sentence = sentenceAt(ranges, match.index, source);
      button.dataset.wordId = makeWordId(raw, sentence);
      button.addEventListener("click", () => {
        openWordPanel(raw, sentence, context.translation || "");
      });
      container.append(button);
      lastIndex = match.index + raw.length;
      match = WORD_PATTERN.exec(source);
    }
    if (lastIndex < source.length) {
      container.append(document.createTextNode(source.slice(lastIndex)));
    }
  }

  /* -------------------------------------------------------- 翻译 / 写作 */

  function createSection(title, kicker, id) {
    const section = createElement("section", "cet6-x-section");
    section.id = id;
    const head = createElement("div", "cet6-x-section-head");
    head.append(
      createElement("p", "cet6-x-kicker", kicker),
      createElement("h2", "", title),
    );
    section.append(head);
    return section;
  }

  function renderAnswerBlock(container, rows) {
    const wrapper = createElement("div", "cet6-x-answer");
    rows.forEach((row) => wrapper.append(row));
    wrapper.append(
      createElement(
        "p",
        "cet6-x-answer-hint",
        "参考答案已隐藏，点击上方“显示参考答案”查看。",
      ),
    );
    container.append(wrapper);
    return wrapper;
  }

  function renderTranslation(data) {
    const translation = data?.translation;
    const section = createSection(
      translation?.title || "汉译英（段落翻译）",
      "CET-6 TRANSLATION",
      "translation",
    );
    if (!translation) {
      section.append(createElement("p", "cet6-x-empty", "本套暂无翻译题数据。"));
      return section;
    }

    if (translation.directions) {
      section.append(createElement("p", "cet6-x-directions", translation.directions));
    }

    const metaRow = createElement("div", "cet6-x-meta-row");
    const sentenceCount = Array.isArray(translation.sentences)
      ? translation.sentences.length
      : 0;
    [
      translation.part || "Part IV",
      `${sentenceCount} 句逐句拆解`,
      `${countWords(translation.reference)} 词参考译文`,
      "先自己译，再逐句对答案",
    ].forEach((label) => metaRow.append(createElement("span", "cet6-x-chip", label)));
    section.append(metaRow);

    if (translation.chinese) {
      const block = createElement("div", "cet6-x-block");
      block.append(createElement("strong", "", "中文原文"));
      block.append(createElement("p", "cet6-x-cn", translation.chinese));
      section.append(block);
    }

    const sentences = Array.isArray(translation.sentences)
      ? translation.sentences
      : [];
    if (sentences.length) {
      section.append(createElement("h3", "cet6-x-group-title", "逐句拆解与参考译文"));
      const list = createElement("div", "cet6-x-sentences");
      sentences.forEach((sentence, index) => {
        list.append(createSentenceCard(sentence, index));
      });
      section.append(list);
    }

    if (translation.reference) {
      section.append(
        createElement("h3", "cet6-x-group-title", "整段参考译文（答案）"),
      );
      const ref = createElement("div", "cet6-x-ref");
      ref.append(createElement("span", "cet6-x-ref-label", "参考译文"));
      const paragraph = createElement("p", "cet6-x-en");
      appendEnglishText(paragraph, translation.reference, {
        translation: translation.chinese || "",
      });
      ref.append(paragraph);
      renderAnswerBlock(section, [ref]);
    }

    if (Array.isArray(translation.cohesion) && translation.cohesion.length) {
      section.append(createElement("h3", "cet6-x-group-title", "句间衔接"));
      const list = createElement("ul", "cet6-x-list");
      translation.cohesion.forEach((item) => {
        const row = createElement("li", "cet6-x-item");
        row.append(createElement("strong", "", item.core || "衔接"));
        row.append(createElement("span", "", item.detail || ""));
        list.append(row);
      });
      section.append(list);
    }

    if (Array.isArray(translation.terms) && translation.terms.length) {
      section.append(createElement("h3", "cet6-x-group-title", "术语与固定译法"));
      const list = createElement("ul", "cet6-x-list");
      translation.terms.forEach((item) => {
        const row = createElement("li", "cet6-x-item");
        row.append(createElement("strong", "", item.core || "术语"));
        row.append(createElement("span", "", item.detail || ""));
        list.append(row);
      });
      section.append(list);
    }

    if (Array.isArray(translation.globalNotes) && translation.globalNotes.length) {
      section.append(createElement("h3", "cet6-x-group-title", "全篇总评"));
      const list = createElement("ul", "cet6-x-list");
      translation.globalNotes.forEach((item) => {
        const row = createElement("li", "cet6-x-item");
        row.append(
          createElement("strong", "", `${item.label || "要点"}：${item.core || ""}`),
        );
        row.append(createElement("span", "", item.detail || ""));
        list.append(row);
      });
      section.append(list);
    }

    return section;
  }

  function createSentenceCard(sentence, index) {
    const card = createElement("article", "cet6-x-sentence");
    const head = createElement("div", "cet6-x-sentence-head");
    head.append(
      createElement("span", "cet6-x-sentence-no", `第 ${sentence.number || index + 1} 句`),
    );
    if (sentence.reference) {
      const play = createElement("button", "paragraph-play-button", "朗读本句");
      play.type = "button";
      play.addEventListener("click", () => {
        playSequence([sentence.reference], play, "本句");
      });
      head.append(play);
    }
    card.append(head);

    if (sentence.chinese) {
      card.append(createElement("p", "cet6-x-cn", sentence.chinese));
    }

    const steps = Array.isArray(sentence.steps) ? sentence.steps : [];
    steps.forEach((step) => {
      const block = createElement("div", "cet6-x-block");
      block.append(
        createElement("strong", "", `${step.label || "要点"}：${step.core || ""}`),
      );
      if (step.detail) {
        block.append(createElement("p", "", step.detail));
      }
      card.append(block);
    });

    if (sentence.reference) {
      const ref = createElement("div", "cet6-x-ref");
      ref.append(createElement("span", "cet6-x-ref-label", "参考译文"));
      const paragraph = createElement("p", "cet6-x-en");
      appendEnglishText(paragraph, sentence.reference, {
        translation: sentence.chinese || "",
      });
      ref.append(paragraph);
      renderAnswerBlock(card, [ref]);
    }

    return card;
  }

  function renderListBlock(section, title, items, keyA, keyB) {
    if (!Array.isArray(items) || !items.length) {
      return;
    }
    section.append(createElement("h3", "cet6-x-group-title", title));
    const list = createElement("ul", "cet6-x-list");
    items.forEach((item) => {
      const row = createElement("li", "cet6-x-item");
      row.append(createElement("strong", "", item[keyA] || item.core || ""));
      row.append(createElement("span", "", item[keyB] || item.detail || ""));
      list.append(row);
    });
    section.append(list);
  }

  function renderFactList(section, items) {
    if (!Array.isArray(items) || !items.length) {
      return;
    }
    section.append(createElement("h3", "cet6-x-group-title", "审题要点"));
    const list = createElement("ul", "cet6-x-list");
    items.forEach((item) => {
      const row = createElement("li", "cet6-x-item");
      row.append(createElement("strong", "", item.label || item.core || "要点"));
      if (item.label && item.core) {
        row.append(createElement("em", "cet6-x-fact-core", item.core));
      }
      row.append(createElement("span", "", item.detail || ""));
      list.append(row);
    });
    section.append(list);
  }

  function renderWriting(data) {
    const writing = data?.writing;
    const section = createSection(
      writing?.title || "写作（Part I）",
      "CET-6 WRITING",
      "writing",
    );
    if (!writing) {
      section.append(createElement("p", "cet6-x-empty", "本套暂无写作题数据。"));
      return section;
    }

    if (writing.directions) {
      section.append(createElement("p", "cet6-x-directions", writing.directions));
    }

    const essayParagraphs = Array.isArray(writing.essay)
      ? writing.essay.map((item) => String(item || "")).filter(Boolean)
      : String(writing.essay || "")
          .split(/\n{2,}/)
          .map((item) => item.trim())
          .filter(Boolean);
    const essayText = essayParagraphs.join(" ");

    const metaRow = createElement("div", "cet6-x-meta-row");
    [
      writing.part || "Part I",
      `范文 ${writing.wordCount || countWords(essayText)} 词`,
      `${MIN_WORDS}-${MAX_WORDS} 词要求`,
      "先列提纲，再背句型",
    ].forEach((label) => metaRow.append(createElement("span", "cet6-x-chip", label)));
    section.append(metaRow);

    renderFactList(section, writing.facts);
    renderListBlock(section, "论点与素材", writing.points, "core", "detail");

    const grid = createElement("div", "cet6-x-writing-grid");

    const outlineCard = createElement("div", "cet6-x-card");
    outlineCard.append(createElement("h3", "", "段落提纲"));
    const outline = Array.isArray(writing.outline) ? writing.outline : [];
    if (outline.length) {
      const list = document.createElement("ol");
      list.className = "cet6-x-outline";
      outline.forEach((item) => {
        const row = document.createElement("li");
        const tag = item.no || item.label || "";
        if (tag) {
          row.append(createElement("span", "cet6-x-tag", tag));
        }
        row.append(document.createTextNode(item.core || item.label || ""));
        if (item.detail) {
          const detail = document.createElement("em");
          detail.textContent = item.detail;
          row.append(detail);
        }
        list.append(row);
      });
      outlineCard.append(list);
    } else {
      outlineCard.append(createElement("p", "cet6-x-empty", "暂无提纲数据。"));
    }
    grid.append(outlineCard);

    const essayCard = createElement("div", "cet6-x-card");
    essayCard.append(createElement("h3", "", "参考范文"));
    if (essayParagraphs.length) {
      const body = createElement("div", "cet6-x-essay");
      const translations = Array.isArray(writing.essayTranslation)
        ? writing.essayTranslation.map((item) => String(item || "").trim())
        : String(writing.essayTranslation || "")
            .split(/\n{2,}/)
            .map((item) => item.trim())
            .filter(Boolean);
      const paired = translations.length === essayParagraphs.length;
      essayParagraphs.forEach((text, index) => {
        const english = createElement("p", "cet6-x-en");
        appendEnglishText(english, text, {
          translation: paired ? translations[index] : "",
        });
        body.append(english);
        if (paired && translations[index]) {
          body.append(createElement("p", "cet6-x-essay-zh", translations[index]));
        }
      });
      if (!paired && translations.length) {
        body.append(
          createElement(
            "p",
            "cet6-x-essay-zh",
            `${translations.length > 1 ? "参考译文：" : ""}${translations.join(" ")}`,
          ),
        );
      }
      renderAnswerBlock(essayCard, [body]);
    } else {
      essayCard.append(createElement("p", "cet6-x-empty", "暂无范文数据。"));
    }
    grid.append(essayCard);

    const rubricCard = createElement("div", "cet6-x-card");
    rubricCard.append(createElement("h3", "", "评分要点"));
    const rubric = Array.isArray(writing.rubric) ? writing.rubric : [];
    if (rubric.length) {
      const list = createElement("ul", "cet6-x-rubric");
      rubric.forEach((item) => {
        const row = createElement("li", "cet6-x-rubric-row");
        row.append(
          createElement(
            "strong",
            "",
            item.dim || item.label || item.core || "评分项",
          ),
        );
        if (item.dim && item.core) {
          row.append(createElement("em", "cet6-x-fact-core", item.core));
        }
        row.append(createElement("span", "", item.detail || ""));
        list.append(row);
      });
      rubricCard.append(list);
    } else {
      rubricCard.append(createElement("p", "cet6-x-empty", "暂无评分数据。"));
    }
    grid.append(rubricCard);

    section.append(grid);

    if (Array.isArray(writing.breakdown) && writing.breakdown.length) {
      section.append(createElement("h3", "cet6-x-group-title", "范文逐句拆解"));
      const list = createElement("ul", "cet6-x-list");
      writing.breakdown.forEach((item) => {
        const row = createElement("li", "cet6-x-item");
        const head = createElement("strong", "");
        if (item.tag) {
          head.append(createElement("span", "cet6-x-tag", item.tag));
        }
        head.append(document.createTextNode(item.core || ""));
        row.append(head);
        row.append(createElement("span", "", item.detail || ""));
        list.append(row);
      });
      section.append(list);
    }

    if (Array.isArray(writing.pitfalls) && writing.pitfalls.length) {
      const box = createElement("div", "cet6-x-pitfalls");
      box.append(createElement("strong", "", "常见扣分点"));
      const list = document.createElement("ul");
      writing.pitfalls.forEach((item) => {
        const text =
          typeof item === "string"
            ? item
            : `${item.core || ""}${item.detail ? `：${item.detail}` : ""}`;
        list.append(createElement("li", "", text));
      });
      box.append(list);
      section.append(box);
    }

    section.append(createDraftBlock(writing));
    return section;
  }

  function createDraftBlock(writing) {
    const wrapper = createElement("div", "cet6-x-draft");
    const label = createElement("strong", "", "我的作文草稿");
    const textarea = document.createElement("textarea");
    textarea.rows = 8;
    textarea.maxLength = 4000;
    textarea.placeholder = "在这里写你的作文，草稿自动存在本机浏览器。";
    textarea.value = state.drafts[state.paperId] || "";
    textarea.setAttribute("aria-label", "六级作文草稿");
    textarea.lang = "en";

    const foot = createElement("div", "cet6-x-draft-foot");
    const count = createElement("span", "cet6-x-draft-count", "");
    const hint = createElement(
      "span",
      "",
      `要求 ${MIN_WORDS}-${MAX_WORDS} 词，草稿只保存在本机。`,
    );
    foot.append(count, hint);

    const updateCount = () => {
      const value = countWords(textarea.value);
      count.textContent = `当前 ${value} 词`;
      count.classList.toggle("is-over", value > MAX_WORDS);
    };
    updateCount();

    let saveTimer = 0;
    textarea.addEventListener("input", () => {
      updateCount();
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        state.drafts[state.paperId] = textarea.value;
        persistMap(DRAFT_STORAGE_KEY, state.drafts);
      }, 400);
    });

    wrapper.append(label, textarea, foot);
    wrapper.dataset.essayWords = String(writing.wordCount || "");
    return wrapper;
  }

  /* ------------------------------------------------------------- 渲染页 */

  function renderNavigation(sections) {
    if (!elements.navigation) {
      return;
    }
    elements.navigation.replaceChildren();
    const heading = createElement("p", "piece-navigation-title", "本篇导航");
    elements.navigation.append(heading);
    sections.forEach((section) => {
      const link = document.createElement("a");
      link.className = "piece-navigation-link";
      link.href = `#${section.id}`;
      link.textContent = section.dataset.label || section.id;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        section.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      elements.navigation.append(link);
    });
  }

  function renderHeroStats() {
    if (!elements.heroStats) {
      return;
    }
    const totals = PAPERS.reduce(
      (accumulator, paper) => {
        accumulator.translation += paper.hasTranslation ? 1 : 0;
        accumulator.writing += paper.hasWriting ? 1 : 0;
        accumulator.sentences += Number(paper.sentenceCount) || 0;
        return accumulator;
      },
      { translation: 0, writing: 0, sentences: 0 },
    );
    const chips = [
      { value: PAPERS.length, label: "套真题" },
      { value: totals.translation, label: "套翻译" },
      { value: totals.writing, label: "套作文" },
      { value: totals.sentences, label: "句逐句拆解" },
    ];
    elements.heroStats.replaceChildren();
    chips.forEach((chip) => {
      const node = createElement("span", "stat-chip");
      node.append(
        createElement("strong", "", String(chip.value)),
        createElement("span", "", chip.label),
      );
      elements.heroStats.append(node);
    });
  }

  function renderError(message) {
    if (!elements.content) {
      return;
    }
    const wrapper = createElement("div", "loading-state");
    wrapper.append(
      createElement("strong", "", "内容暂时打不开"),
      createElement("span", "", message),
    );
    elements.content.replaceChildren(wrapper);
    elements.navigation?.replaceChildren();
  }

  function renderPaper(data) {
    if (!elements.content) {
      return;
    }
    const fragment = document.createDocumentFragment();
    const translation = renderTranslation(data);
    translation.dataset.label = "翻译";
    const writing = renderWriting(data);
    writing.dataset.label = "写作";
    fragment.append(translation, writing);
    elements.content.replaceChildren(fragment);
    state.sectionNodes = [translation, writing];
    renderNavigation(state.sectionNodes);
    setDisplayMode(state.displayMode);
    setAnswerVisibility(state.showAnswers);
    updateTokenMarks();
  }

  async function openPaper(paperId, options = {}) {
    if (!paperId) {
      renderError("没有找到可用的试卷数据。");
      return;
    }
    state.paperId = paperId;
    if (elements.paperSelect) {
      elements.paperSelect.value = paperId;
    }
    writeStoredValue(PAPER_STORAGE_KEY, paperId);
    if (options.push !== false) {
      setLocationParam(paperId, Boolean(options.push));
    }
    closeWordPanel();
    stopSpeech();
    if (elements.content) {
      const loading = createElement("div", "loading-state");
      loading.append(
        createElement("strong", "", "正在读取这套翻译与作文"),
        createElement("span", "", "只加载当前这一套，其他试卷按需再取。"),
      );
      elements.content.replaceChildren(loading);
    }
    try {
      const data = await loadPaperData(paperId);
      state.data = data;
      renderPaper(data);
    } catch (error) {
      console.error(error);
      renderError(error?.message || "试卷加载失败，请刷新后重试。");
    }
  }

  /* -------------------------------------------------------- 显示与答案 */

  function setDisplayMode(mode) {
    const next = DISPLAY_MODES.includes(mode) ? mode : "bilingual";
    state.displayMode = next;
    document.body.classList.toggle("is-english-only", next === "english");
    document.body.classList.toggle("is-chinese-only", next === "chinese");
    elements.modeButtons.forEach((button) => {
      const isActive = button.dataset.displayMode === next;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    writeStoredValue(DISPLAY_STORAGE_KEY, next);
  }

  function setAnswerVisibility(visible) {
    state.showAnswers = visible;
    document.body.classList.toggle("hides-answers", !visible);
    if (elements.answerToggleButton) {
      elements.answerToggleButton.textContent = visible
        ? "隐藏参考答案"
        : "显示参考答案";
      elements.answerToggleButton.setAttribute("aria-pressed", String(visible));
    }
    writeStoredValue(ANSWER_STORAGE_KEY, visible ? "visible" : "hidden");
  }

  /* --------------------------------------------------------- 生词与标记 */

  function getReadingDocumentId() {
    return `cet6-extra-${state.paperId}`;
  }

  function getReadingDocumentShell() {
    const id = getReadingDocumentId();
    const existing = getReadingDocuments().find((document) => document.id === id);
    if (existing) {
      return existing;
    }
    return {
      id,
      title: `${state.data?.meta?.label || state.paperId} 翻译写作生词`,
      category: CATEGORY,
      section: SECTION,
      createdAt: Date.now(),
      paragraphs: [],
      words: [],
    };
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

  function renderWordLevelBadges(levels) {
    if (!elements.wordLevelBadges) {
      return;
    }
    const list = (levels || []).filter((level) => LEVEL_NAMES.includes(level));
    elements.wordLevelBadges.replaceChildren();
    if (!list.length) {
      elements.wordLevelBadges.hidden = true;
      return;
    }
    elements.wordLevelBadges.hidden = false;
    list.forEach((level) => {
      const chip = createElement("span", "phrase-level", level);
      chip.classList.add(
        level === "四级" ? "is-cet4" : level === "六级" ? "is-cet6" : "is-kaoyan",
      );
      elements.wordLevelBadges.append(chip);
    });
  }

  function renderMeanings(meanings) {
    if (!elements.wordMeanings) {
      return;
    }
    elements.wordMeanings.replaceChildren();
    if (!meanings.length) {
      elements.wordMeanings.append(
        createElement("p", "word-lookup-status", "暂无释义，可手动补充后标记生词。"),
      );
      return;
    }
    const list = document.createElement("ul");
    meanings.forEach((meaning) => list.append(createElement("li", "", meaning)));
    elements.wordMeanings.append(list);
  }

  function renderPhrases(phrases) {
    if (!elements.wordPhraseSection || !elements.wordPhrases) {
      return;
    }
    elements.wordPhrases.replaceChildren();
    const list = (phrases || []).filter((item) => item?.phrase);
    if (!list.length) {
      elements.wordPhraseSection.hidden = true;
      return;
    }
    elements.wordPhraseSection.hidden = false;
    const ul = document.createElement("ul");
    list.slice(0, 6).forEach((item) => {
      const li = document.createElement("li");
      li.append(createElement("strong", "", item.phrase));
      if (item.meaning) {
        li.append(createElement("span", "", item.meaning));
      }
      ul.append(li);
    });
    elements.wordPhrases.append(ul);
  }

  function renderSynonyms(entries) {
    if (!elements.wordSynonymSection || !elements.wordSynonyms) {
      return;
    }
    elements.wordSynonyms.replaceChildren();
    const list = (entries || []).filter((item) => item?.word || item?.phrase);
    if (!list.length) {
      elements.wordSynonymSection.hidden = true;
      return;
    }
    elements.wordSynonymSection.hidden = false;
    const ul = document.createElement("ul");
    list.slice(0, 8).forEach((item) => {
      const li = document.createElement("li");
      li.append(createElement("strong", "", item.word || item.phrase));
      const levels = (item.levels || [])
        .filter((level) => LEVEL_NAMES.includes(level))
        .join(" / ");
      if (item.meaning || levels) {
        li.append(
          createElement(
            "span",
            "",
            [levels, item.meaning].filter(Boolean).join(" · "),
          ),
        );
      }
      ul.append(li);
    });
    elements.wordSynonyms.append(ul);
  }

  function renderPanelPhonetic(value) {
    if (!elements.wordPanelPhonetic) {
      return;
    }
    elements.wordPanelPhonetic.textContent = isUsablePhonetic(value)
      ? value
      : "暂无音标";
  }

  function openWordPanel(phrase, sentence, translation) {
    const item = {
      id: makeWordId(phrase, sentence || phrase),
      phrase,
      sentence: sentence || phrase,
      translation: translation || "",
      meaning: "",
      phonetic: "",
    };
    state.activeWord = { phrase, sentence: item.sentence, translation: item.translation, item, meanings: [] };
    if (elements.wordPanelTitle) {
      elements.wordPanelTitle.textContent = phrase;
    }
    renderPanelPhonetic("");
    renderWordLevelBadges([]);
    renderMeanings([]);
    renderPhrases([]);
    renderSynonyms([]);
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = "正在查询词典…";
    }
    if (elements.wordContextSentence) {
      elements.wordContextSentence.textContent = item.sentence;
    }
    if (elements.wordContextTranslation) {
      elements.wordContextTranslation.textContent =
        item.translation || "当前语境暂无译文。";
    }
    if (elements.wordNoteInput) {
      elements.wordNoteInput.value = "";
    }
    updateWordPanelMarkState();
    if (elements.wordPanel) {
      elements.wordPanel.hidden = false;
      elements.wordPanel.setAttribute("aria-hidden", "false");
    }
    elements.layout?.classList.add("has-word-panel");
    lookupActiveWord();
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
      (isUsablePhonetic(data.phonetic) && data.phonetic) ||
      activeWord.item.phonetic ||
      "";
    activeWord.item.meaning = getCombinedMeaning(activeWord.meanings, "");
    activeWord.item.phrases = Array.isArray(data.phrases) ? data.phrases : [];
    renderPanelPhonetic(activeWord.item.phonetic);
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = meanings.length
        ? statusText
        : "词典没有返回释义，可手动补充";
    }
    renderMeanings(activeWord.meanings);
    renderPhrases(activeWord.item.phrases);
    renderWordLevelBadges(activeWord.item.levels || []);
    renderSynonyms(activeWord.item.synonyms || []);
  }

  async function lookupActiveWord() {
    const activeWord = state.activeWord;
    if (!activeWord) {
      return;
    }
    const cacheKey = normalizeWord(activeWord.phrase);
    const cached = state.lookupCache.get(cacheKey);
    if (cached) {
      applyWordResult(activeWord, cached, "已从本次缓存读取释义");
      return;
    }
    const run = ++state.lookupRun;
    let localData = null;
    try {
      const index = window.VocabIndex;
      if (index && typeof index.lookup === "function") {
        localData = await index.lookup(activeWord.phrase).catch(() => null);
      }
    } catch {
      localData = null;
    }
    if (run !== state.lookupRun || state.activeWord !== activeWord) {
      return;
    }
    if (localData && (localData.translations?.length || localData.definitions?.length)) {
      const collocationIndex = window.CollocationIndex;
      if (
        collocationIndex &&
        typeof collocationIndex.lookup === "function" &&
        !(localData.phrases || []).length
      ) {
        const hits = await collocationIndex
          .lookup(normalizeWord(activeWord.phrase))
          .catch(() => []);
        if (run !== state.lookupRun || state.activeWord !== activeWord) {
          return;
        }
        localData.phrases = (hits || []).slice(0, 6).map((item) => ({
          phrase: item.phrase || item.text || "",
          meaning: item.meaning || item.translation || "",
        }));
      }
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      state.lookupCache.set(cacheKey, localData);
      applyWordResult(activeWord, localData, "已读取站内词库与固定搭配");
      return;
    }
    try {
      const response = await fetch(
        `./api/word?word=${encodeURIComponent(normalizeWord(activeWord.phrase))}`,
        { credentials: "same-origin" },
      );
      const data = await response.json().catch(() => ({}));
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "暂时没有查到这个词");
      }
      state.lookupCache.set(cacheKey, data);
      applyWordResult(activeWord, data, "已从在线词典读取释义");
    } catch (error) {
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      if (localData) {
        applyWordResult(activeWord, localData, "已读取站内词库；在线词典暂时不可用");
        return;
      }
      if (elements.wordLookupStatus) {
        elements.wordLookupStatus.textContent = `${
          error.message || "查询失败"
        }，可手动补充释义`;
      }
      renderMeanings(activeWord.meanings || []);
      renderPhrases([]);
    }
  }

  function saveActiveWordMark(mark) {
    const activeWord = state.activeWord;
    if (!activeWord) {
      return;
    }
    const note = String(elements.wordNoteInput?.value || "").trim();
    const phraseText = (activeWord.item.phrases || [])
      .filter((item) => item?.phrase)
      .slice(0, 4)
      .map((item) =>
        item.meaning ? `${item.phrase}（${item.meaning}）` : item.phrase,
      )
      .join("；");
    const meaning = [
      getCombinedMeaning(activeWord.meanings, note),
      phraseText ? `固定搭配：${phraseText}` : "",
    ]
      .filter(Boolean)
      .join("；");
    const item = {
      ...activeWord.item,
      phrase: activeWord.phrase,
      sentence: activeWord.sentence,
      translation: activeWord.translation,
      meaning: meaning || activeWord.item.meaning || "查看上下文理解用法",
      addedAt: activeWord.item.addedAt || Date.now(),
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
    activeWord.item = item;
    updateTokenMarks();
    updateWordPanelMarkState();
    showToast(
      mark === "unknown"
        ? `${item.phrase} 已加入六级不会`
        : `${item.phrase} 已标记为掌握`,
    );
  }

  /* ------------------------------------------------------------- 事件 */

  function bindEvents() {
    elements.paperSelect?.addEventListener("change", (event) => {
      openPaper(event.target.value, { push: true });
    });

    elements.modeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setDisplayMode(button.dataset.displayMode);
      });
    });

    elements.answerToggleButton?.addEventListener("click", () => {
      setAnswerVisibility(!state.showAnswers);
    });

    elements.readAllButton?.addEventListener("click", () => {
      const essayTexts = Array.isArray(state.data?.writing?.essay)
        ? state.data.writing.essay
        : [state.data?.writing?.essay || ""];
      const texts = state.data
        ? [
            ...(state.data.translation?.sentences || []).map(
              (sentence) => sentence.reference,
            ),
            ...(state.data.translation?.reference
              ? [state.data.translation.reference]
              : []),
            ...essayTexts,
          ]
        : [];
      playSequence(texts, elements.readAllButton, "本套");
    });

    elements.closeWordPanelButton?.addEventListener("click", closeWordPanel);
    elements.markUnknownButton?.addEventListener("click", () =>
      saveActiveWordMark("unknown"),
    );
    elements.markKnownButton?.addEventListener("click", () =>
      saveActiveWordMark("known"),
    );
    elements.speakWordButton?.addEventListener("click", () => {
      const activeWord = state.activeWord;
      if (!activeWord) {
        return;
      }
      playSequence([activeWord.phrase], elements.speakWordButton, "单词");
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.activeWord) {
        closeWordPanel();
      }
    });
    window.addEventListener("beforeunload", stopSpeech);
  }

  function initialize() {
    if (!PAPERS.length) {
      renderError("没有找到可用的六级翻译写作数据。");
      return;
    }
    state.paperId = pickPaper();
    buildPaperSelect();
    bindEvents();
    refreshVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices);
    renderHeroStats();
    setDisplayMode(state.displayMode);
    setAnswerVisibility(state.showAnswers);
    updateReadAllButton();
    openPaper(state.paperId, { push: false });
    window.addEventListener("popstate", () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("paper");
      if (requested && requested !== state.paperId) {
        openPaper(requested, { push: false });
      }
    });
  }

  window.cet6Extra = { state, openPaper, setDisplayMode, setAnswerVisibility };
  window[LOADED_FLAG] = true;
  initialize();
})();
