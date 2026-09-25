/**
 * 美剧台词精读页。
 *
 * 数据来自 movie-data/*.js（由 scripts/build-movie-library.mjs 生成）。
 * 查词优先级：站内单词库 → 站内固定搭配库 → 在线词典接口。
 * 生词标记写入 IballDeck 的阅读文档，分类固定为「电影」，因此复习页
 * 里会和四级、六级、考研的「不会」分开成组。
 */
(function () {
  "use strict";

  const Deck = window.IballDeck;
  if (!Deck) {
    const fallback = document.querySelector("#movieContent");
    if (fallback) {
      fallback.textContent = "台词数据加载失败，请刷新页面。";
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

  const episodes = Array.isArray(window.IBALL_MOVIE_EPISODES)
    ? window.IBALL_MOVIE_EPISODES.slice()
    : [];
  const library = (window.IBALL_MOVIE_LIBRARY = window.IBALL_MOVIE_LIBRARY || {});
  const scriptPromises = new Map();

  const WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  const PHONETIC_PLACEHOLDERS = new Set(["暂无音标", "音标查询中"]);
  const MOVIE_CATEGORY = "电影";
  const MOVIE_SECTION = "美剧台词精读";
  const EPISODE_STORAGE_KEY = "iball-movie-episode";
  const DISPLAY_STORAGE_KEY = "iball-movie-display-mode";
  const LEVELS_STORAGE_KEY = "iball-movie-level-marks";
  const ALTERNATIVES_STORAGE_KEY = "iball-movie-alternatives";
  const SENTENCE_VOCAB_STORAGE_KEY = "iball-movie-sentence-vocab";
  const AUDIO_MANIFEST_DIR = "./movie-data/audio/";
  const LEVEL_NAMES = ["四级", "六级", "考研"];
  const LEVEL_SHORT = { 四级: "四", 六级: "六", 考研: "研" };
  const LEVEL_CLASS = {
    四级: "is-cet4",
    六级: "is-cet6",
    考研: "is-kaoyan",
  };
  const SOURCE_META = {
    curated: {
      label: "精讲",
      className: "is-curated",
      hint: "人工精翻",
    },
    card: {
      label: "词卡",
      className: "is-card",
      hint: "来自本机 Anki 词卡",
    },
    reviewed: {
      label: "精翻",
      className: "is-curated",
      hint: "逐句人工校对",
    },
    machine: {
      label: "机翻补全",
      className: "is-machine",
      hint: "机器翻译，仅作理解参考",
    },
    missing: {
      label: "暂无翻译",
      className: "is-missing",
      hint: "",
    },
  };

  const state = {
    episodeId: "",
    data: null,
    segments: new Map(),
    segmentOrder: [],
    phraseCache: new Map(),
    wordLevels: new Map(),
    collocationReady: false,
    indexRun: 0,
    lookupRun: 0,
    activeWord: null,
    lookupCache: new Map(),
    unknown: restoreSet(STORAGE_KEYS.unknown),
    known: restoreSet(STORAGE_KEYS.known),
    displayMode: "bilingual",
    showLevels: readStoredValue(LEVELS_STORAGE_KEY) !== "hidden",
    showAlternatives: readStoredValue(ALTERNATIVES_STORAGE_KEY) !== "hidden",
    speechRun: 0,
    allSpeaking: false,
    sentenceVocab: new Map(),
    sentenceVocabReady: false,
    showSentenceVocab: readStoredValue(SENTENCE_VOCAB_STORAGE_KEY) !== "hidden",
    audioManifest: null,
    audioManifestId: "",
    audioRun: 0,
    audioButton: null,
    audioCue: null,
    audioCleanup: null,
    activeSceneId: "",
    toastTimer: 0,
    scrollFrame: 0,
  };

  const elements = {
    readingProgress: document.querySelector("#readingProgress"),
    sourceLink: document.querySelector("#sourceLink"),
    heroStats: document.querySelector("#heroStats"),
    layout: document.querySelector("#movieLayout"),
    episodeSelect: document.querySelector("#episodeSelect"),
    sceneNavigation: document.querySelector("#sceneNavigation"),
    content: document.querySelector("#movieContent"),
    levelToggleButton: document.querySelector("#levelToggleButton"),
    sentenceVocabToggleButton: document.querySelector(
      "#sentenceVocabToggleButton",
    ),
    alternativeToggleButton: document.querySelector("#alternativeToggleButton"),
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
  let sceneObserver = null;

  /* ------------------------------------------------------------- 小工具 */

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

  function normalizeWord(value) {
    return String(value || "")
      .toLocaleLowerCase("en-US")
      .replace(/[’‘`]/g, "'")
      .trim();
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

  function getSegmentId(segment, index) {
    return `line-${segment.start}-${segment.end}-${index}`;
  }

  function getSegmentText(segment) {
    return (Array.isArray(segment?.blocks) ? segment.blocks : [])
      .map((block) => cleanReadingText(block?.text, 600))
      .filter(Boolean)
      .join(" ");
  }

  /* --------------------------------------------------------------- 朗读 */

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

  function supportsSpeech() {
    return (
      "speechSynthesis" in window &&
      typeof window.SpeechSynthesisUtterance === "function"
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
      : "全集播放";
    elements.readAllButton.setAttribute("aria-pressed", String(state.allSpeaking));
  }

  function stopSpeech() {
    stopAudioPlayback();
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
    if (runId !== state.speechRun || !speakable || !supportsSpeech()) {
      return false;
    }

    const utterance = new window.SpeechSynthesisUtterance(speakable);
    const voice = getPreferredVoice();
    utterance.lang = voice?.lang || "en-US";
    utterance.voice = voice;
    utterance.rate = 0.9;
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

  function playTexts(texts, button) {
    const usable = (Array.isArray(texts) ? texts : [])
      .map((text) => String(text || "").trim())
      .filter(Boolean);
    if (!usable.length) {
      return;
    }

    if (button?.classList.contains("is-playing")) {
      stopSpeech();
      showToast("已停止朗读");
      return;
    }

    stopSpeech();
    if (!supportsSpeech()) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }

    const runId = state.speechRun;
    let index = 0;
    setSpeechButtonState(button, true);

    const finish = (message = "") => {
      if (runId !== state.speechRun) {
        return;
      }
      setSpeechButtonState(button, false);
      if (message) {
        showToast(message);
      }
    };

    const playNext = () => {
      if (runId !== state.speechRun) {
        return;
      }
      if (index >= usable.length) {
        finish();
        return;
      }
      const started = speakText(
        usable[index],
        runId,
        () => {
          index += 1;
          window.setTimeout(playNext, 130);
        },
        () => finish("朗读中止，请稍后重试"),
      );
      if (!started) {
        finish("当前浏览器不支持语音朗读");
      }
    };

    playNext();
  }

  function playSequence(texts, triggerButton) {
    const usable = (Array.isArray(texts) ? texts : [])
      .map((text) => String(text || "").trim())
      .filter(Boolean);
    if (!usable.length) {
      return;
    }

    if (state.allSpeaking) {
      stopSpeech();
      showToast("已停止播放");
      return;
    }

    stopSpeech();
    if (!supportsSpeech()) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }

    const runId = state.speechRun;
    let index = 0;
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

    const playNext = () => {
      if (runId !== state.speechRun || !state.allSpeaking) {
        return;
      }
      if (index >= usable.length) {
        finish("播放完成");
        return;
      }
      const started = speakText(
        usable[index],
        runId,
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

  /* ------------------------------------------------------------- 原声播放 */

  let audioElement = null;

  function getAudioElement() {
    if (!audioElement) {
      audioElement = new Audio();
      audioElement.preload = "none";
    }
    return audioElement;
  }

  function stopAudioPlayback(message) {
    state.audioRun += 1;
    state.audioCue = null;
    if (state.audioButton) {
      setSpeechButtonState(state.audioButton, false);
      state.audioButton = null;
    }
    if (state.audioCleanup) {
      state.audioCleanup();
    }
    if (audioElement) {
      audioElement.pause();
    }
    if (message) {
      showToast(message);
    }
  }

  function isCurrentAudioRun(run) {
    return run === state.audioRun;
  }

  function playAudioCues(cues, button) {
    const usable = (Array.isArray(cues) ? cues : []).filter(
      (cue) =>
        cue &&
        Number.isFinite(Number(cue.start)) &&
        Number.isFinite(Number(cue.end)) &&
        Number(cue.end) > Number(cue.start),
    );
    if (!usable.length || !state.audioManifest?.spriteUrl) {
      return false;
    }

    if (state.audioButton === button && state.audioCue) {
      stopAudioPlayback("已停止原声");
      return true;
    }

    stopSpeech();
    const run = state.audioRun;
    const audio = getAudioElement();
    let index = 0;

    const cleanup = () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
      state.audioCleanup = null;
    };

    const finish = (message) => {
      if (!isCurrentAudioRun(run)) {
        return;
      }
      cleanup();
      state.audioCue = null;
      if (state.audioButton) {
        setSpeechButtonState(state.audioButton, false);
        state.audioButton = null;
      }
      if (message) {
        showToast(message);
      }
    };

    const playNext = () => {
      if (!isCurrentAudioRun(run)) {
        return;
      }
      if (index >= usable.length) {
        finish("原声播放完成");
        return;
      }
      const cue = usable[index];
      state.audioCue = cue;
      try {
        audio.currentTime = Math.max(0, Number(cue.start) || 0);
      } catch {
        // 元数据未就绪时浏览器会在 canplay 后接受跳转，继续播放即可。
      }
      const started = audio.play();
      if (started && typeof started.catch === "function") {
        started.catch(() => {
          if (!isCurrentAudioRun(run)) {
            return;
          }
          cleanup();
          state.audioCue = null;
          if (state.audioButton) {
            setSpeechButtonState(state.audioButton, false);
            state.audioButton = null;
          }
          showToast("原声加载失败，可点击“朗读”使用浏览器语音");
        });
      }
    };

    function handleTimeUpdate() {
      if (!isCurrentAudioRun(run)) {
        return;
      }
      const cue = state.audioCue;
      if (!cue) {
        return;
      }
      if (audio.currentTime >= Number(cue.end) - 0.03) {
        index += 1;
        playNext();
      }
    }

    function handleEnded() {
      if (!isCurrentAudioRun(run)) {
        return;
      }
      index += 1;
      playNext();
    }

    function handleError() {
      if (!isCurrentAudioRun(run)) {
        return;
      }
      cleanup();
      state.audioCue = null;
      if (state.audioButton) {
        setSpeechButtonState(state.audioButton, false);
        state.audioButton = null;
      }
      showToast("原声文件不可用，可点击“朗读”使用浏览器语音");
    }

    cleanup();
    audio.pause();
    audio.src = state.audioManifest.spriteUrl;
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    state.audioCleanup = cleanup;
    state.audioButton = button;
    setSpeechButtonState(button, true);
    playNext();
    return true;
  }

  function findAudioCue(view) {
    const map = state.audioManifest?.cueMap;
    if (!map || !view) {
      return null;
    }
    return (
      map.get(view.id) ||
      map.get(`segment-${view.number}`) ||
      map.get(String(view.number)) ||
      null
    );
  }

  function findAudioCues(view) {
    const map = state.audioManifest?.lineCueMap;
    const blocks = Array.isArray(view?.blocks) ? view.blocks : [];
    if (!map || !blocks.length) {
      return [];
    }
    const cues = blocks
      .map((block) => map.get(`b${Number(block.i)}`))
      .filter(Boolean);
    return cues.length === blocks.length ? cues : [];
  }

  function playSegmentEnglish(view, button) {
    const lineCues = findAudioCues(view);
    if (lineCues.length && playAudioCues(lineCues, button)) {
      return;
    }
    const cue = findAudioCue(view);
    if (cue && playAudioCues([cue], button)) {
      return;
    }
    playTexts(
      view.blocks.map((block) => block.text),
      button,
    );
  }

  function playSceneEnglish(views, button) {
    const lineCues = views.flatMap(findAudioCues);
    const lineCount = views.reduce(
      (total, view) =>
        total + (Array.isArray(view.blocks) ? view.blocks.length : 0),
      0,
    );
    if (
      lineCues.length &&
      lineCues.length === lineCount &&
      playAudioCues(lineCues, button)
    ) {
      return;
    }
    const cues = views.map(findAudioCue).filter(Boolean);
    if (
      cues.length &&
      cues.length === views.length &&
      playAudioCues(cues, button)
    ) {
      return;
    }
    playTexts(
      views.flatMap((view) => view.blocks.map((block) => block.text)),
      button,
    );
  }

  async function loadAudioManifest(id) {
    if (state.audioManifestId === id) {
      return state.audioManifest;
    }
    state.audioManifestId = id;
    state.audioManifest = null;
    try {
      const response = await fetch(
        `${AUDIO_MANIFEST_DIR}${encodeURIComponent(id)}.json`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        return null;
      }
      const data = await response.json().catch(() => null);
      if (!data?.sprite || !Array.isArray(data.cues)) {
        return null;
      }
      const cueMap = new Map();
      data.cues.forEach((cue) => {
        if (cue?.id) {
          cueMap.set(String(cue.id), cue);
        }
      });
      const lineCueMap = new Map();
      (Array.isArray(data.lineCues) ? data.lineCues : []).forEach((cue) => {
        if (cue?.id) {
          lineCueMap.set(String(cue.id), cue);
        }
      });
      data.cueMap = cueMap;
      data.lineCueMap = lineCueMap;
      data.spriteUrl = new URL(
        data.sprite,
        new URL(AUDIO_MANIFEST_DIR, document.baseURI),
      ).href;
      state.audioManifest = data;
      return data;
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------- 显示设置 */

  function setDisplayMode(mode) {
    const englishOnly = mode === "english";
    const chineseOnly = mode === "chinese";
    state.displayMode = englishOnly ? "english" : chineseOnly ? "chinese" : "bilingual";
    document.body.classList.toggle("is-english-only", englishOnly);
    document.body.classList.toggle("is-chinese-only", chineseOnly);

    elements.displayModeButtons.forEach((button) => {
      const isActive = button.dataset.displayMode === state.displayMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    writeStoredValue(DISPLAY_STORAGE_KEY, state.displayMode);
  }

  function setLevelVisibility(visible) {
    state.showLevels = visible;
    document.body.classList.toggle("hides-levels", !visible);
    document.body.classList.toggle("marks-levels", visible);
    if (elements.levelToggleButton) {
      elements.levelToggleButton.textContent = visible
        ? "隐藏考试词标记"
        : "显示考试词标记";
      elements.levelToggleButton.setAttribute("aria-pressed", String(visible));
    }
    writeStoredValue(LEVELS_STORAGE_KEY, visible ? "visible" : "hidden");
  }

  function setSentenceVocabVisibility(visible) {
    state.showSentenceVocab = visible;
    document.body.classList.toggle("hides-sentence-vocab", !visible);
    if (elements.sentenceVocabToggleButton) {
      elements.sentenceVocabToggleButton.textContent = visible
        ? "隐藏本句词汇"
        : "显示本句词汇";
      elements.sentenceVocabToggleButton.setAttribute(
        "aria-pressed",
        String(visible),
      );
    }
    writeStoredValue(
      SENTENCE_VOCAB_STORAGE_KEY,
      visible ? "visible" : "hidden",
    );
  }

  function setAlternativeVisibility(visible) {
    state.showAlternatives = visible;
    document.body.classList.toggle("hides-alternatives", !visible);
    if (elements.alternativeToggleButton) {
      elements.alternativeToggleButton.textContent = visible
        ? "隐藏替换说法"
        : "显示替换说法";
      elements.alternativeToggleButton.setAttribute(
        "aria-pressed",
        String(visible),
      );
    }
    writeStoredValue(
      ALTERNATIVES_STORAGE_KEY,
      visible ? "visible" : "hidden",
    );
  }

  /* --------------------------------------------------------------- 数据 */

  function getEpisodeMeta(id) {
    return episodes.find((item) => item.id === id) || null;
  }

  function loadEpisodeScript(id) {
    const meta = getEpisodeMeta(id);
    if (library[id]) {
      return Promise.resolve(library[id]);
    }
    if (!meta?.file) {
      return Promise.reject(new Error("没有找到这集台词数据"));
    }
    if (!scriptPromises.has(id)) {
      scriptPromises.set(
        id,
        new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = meta.file;
          script.async = true;
          script.addEventListener("load", () => {
            if (library[id]) {
              resolve(library[id]);
            } else {
              reject(new Error("台词数据内容为空"));
            }
          });
          script.addEventListener("error", () => {
            scriptPromises.delete(id);
            reject(new Error("台词数据加载失败"));
          });
          document.head.append(script);
        }),
      );
    }
    return scriptPromises.get(id);
  }

  function getEpisodeFromLocation() {
    const params = new URLSearchParams(window.location.search);
    return params.get("episode") || params.get("e") || "";
  }

  function setEpisodeInLocation(id, push) {
    const url = new URL(window.location.href);
    url.searchParams.set("episode", id);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (push === false) {
      window.history.replaceState({}, "", next);
    } else {
      window.history.pushState({ episode: id }, "", next);
    }
  }

  function populateEpisodeSelect() {
    if (!elements.episodeSelect) {
      return;
    }
    const fragment = document.createDocumentFragment();
    episodes.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      const parts = [item.label];
      if (item.wordCount) {
        parts.push(`${item.wordCount} 词`);
      }
      option.textContent = parts.join(" · ");
      fragment.append(option);
    });
    elements.episodeSelect.replaceChildren(fragment);
    elements.episodeSelect.value = state.episodeId;
  }

  function buildSegmentIndex(data) {
    state.segments = new Map();
    state.segmentOrder = [];
    state.phraseCache = new Map();
    state.sentenceVocab = new Map();
    state.sentenceVocabReady = false;

    const scenes = Array.isArray(data?.scenes) ? data.scenes : [];
    scenes.forEach((scene) => {
      (Array.isArray(scene.segments) ? scene.segments : []).forEach(
        (segment, index) => {
          const id = getSegmentId(segment, index);
          const view = {
            id,
            sceneId: scene.id,
            sceneTitle: scene.title,
            number:
              segment.start === segment.end
                ? String(segment.start)
                : `${segment.start}-${segment.end}`,
            english: getSegmentText(segment),
            translation: cleanReadingText(segment.translation, 1200),
            translationSource: SOURCE_META[segment.translationSource]
              ? segment.translationSource
              : "missing",
            keyPhrase: cleanReadingText(segment.keyPhrase, 120),
            meaning: cleanReadingText(segment.meaning, 400),
            phonetic: cleanPhonetic(segment.phonetic),
            grammarNotes: (
              Array.isArray(segment.grammarNotes) ? segment.grammarNotes : []
            )
              .map((note) => cleanReadingText(note, 500))
              .filter(Boolean),
            blocks: (Array.isArray(segment.blocks) ? segment.blocks : []).map(
              (block) => ({
                i: Number(block.i) || 0,
                speaker: cleanReadingText(block.speaker, 40),
                stage: cleanReadingText(block.stage, 60),
                text: cleanReadingText(block.text, 600),
              }),
            ),
            alternatives: (
              Array.isArray(segment.alternatives) ? segment.alternatives : []
            )
              .map((item) => ({
                phrase: cleanReadingText(item?.phrase, 60),
                alternatives: (
                  Array.isArray(item?.alternatives) ? item.alternatives : []
                )
                  .map((value) => cleanReadingText(value, 160))
                  .filter(Boolean),
              }))
              .filter((item) => item.alternatives.length),
          };
          state.segments.set(id, view);
          state.segmentOrder.push(view);
        },
      );
    });
  }

  function renderHeroStats(data) {
    if (!elements.heroStats) {
      return;
    }
    const stats = data?.translationStats || {};
    const human =
      (Number(stats.curated) || 0) +
      (Number(stats.card) || 0) +
      (Number(stats.reviewed) || 0);
    const chips = [
      { value: data?.blockCount || 0, label: "句台词" },
      { value: data?.sceneCount || 0, label: "个场景" },
      { value: data?.vocabCount || 0, label: "个不重复单词" },
      { value: human, label: "句逐句精翻" },
    ];
    if (Number(stats.machine) > 0) {
      chips.push({
        value: Number(stats.machine),
        label: "句机翻补全",
      });
    }
    const audioCueCount = Array.isArray(state.audioManifest?.lineCues)
      ? state.audioManifest.lineCues.length
      : 0;
    chips.push(
      audioCueCount
        ? { value: audioCueCount, label: "句原声切片" }
        : { value: "TTS", label: "原声缺失时浏览器朗读" },
    );
    elements.heroStats.replaceChildren(
      ...chips.map((chip) => createStat(chip.value, chip.label)),
    );
  }

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

  function showLoading(meta) {
    if (!elements.content) {
      return;
    }
    if (elements.sceneNavigation) {
      elements.sceneNavigation.replaceChildren();
    }
    const box = document.createElement("div");
    box.className = "loading-state";
    const title = document.createElement("strong");
    title.textContent = `正在读取 ${meta?.title || meta?.label || "台词"}`;
    const hint = document.createElement("span");
    hint.textContent = "请稍候。";
    box.append(title, hint);
    elements.content.replaceChildren(box);
  }

  function renderError(message) {
    if (!elements.content) {
      return;
    }
    const box = document.createElement("div");
    box.className = "error-state";
    const title = document.createElement("strong");
    title.textContent = "台词读取失败";
    const hint = document.createElement("span");
    hint.textContent = message || "请刷新页面后重试。";
    box.append(title, hint);
    elements.content.replaceChildren(box);
  }

  async function openEpisode(id, options = {}) {
    const meta = getEpisodeMeta(id);
    if (!meta) {
      renderError("没有找到可用的剧集数据。");
      return;
    }

    state.episodeId = id;
    writeStoredValue(EPISODE_STORAGE_KEY, id);
    populateEpisodeSelect();
    if (options.push !== false) {
      setEpisodeInLocation(id, true);
    } else {
      setEpisodeInLocation(id, false);
    }
    if (elements.sourceLink && meta.file) {
      elements.sourceLink.href = meta.file.replace("../", "./");
    }
    showLoading(meta);

    try {
      const [data] = await Promise.all([
        loadEpisodeScript(id),
        loadAudioManifest(id),
      ]);
      if (state.episodeId !== id) {
        return;
      }
      state.data = data;
      buildSegmentIndex(data);
      state.collocationReady = false;
      renderHeroStats(data);
      renderPage();
      updateReadAllButton();
      refreshIndices();
    } catch (error) {
      renderError(error?.message || "台词数据加载失败。");
    }
  }

  /* ------------------------------------------------------- 站内词库索引 */

  async function loadCollocations() {
    const index = window.CollocationIndex;
    if (!index || typeof index.load !== "function") {
      return;
    }
    await Promise.resolve(index.load()).catch(() => null);
    state.collocationReady = Boolean(index.ready);
  }

  async function loadWordLevels() {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function") {
      return;
    }
    const loaded = await Promise.resolve(
      typeof index.load === "function" ? index.load() : true,
    ).catch(() => null);
    if (!loaded) {
      return;
    }

    const tokens = new Set();
    state.segmentOrder.forEach((view) => {
      tokenizeWords(view.english).forEach((token) => tokens.add(token));
    });

    const pending = [];
    tokens.forEach((token) => {
      const key = normalizeWord(token);
      if (!key || state.wordLevels.has(key)) {
        return;
      }
      pending.push(
        Promise.resolve(index.lookup(token))
          .catch(() => null)
          .then((entry) => {
            const source = String(entry?.source || "");
            const levels = LEVEL_NAMES.filter((level) =>
              source.includes(level),
            );
            state.wordLevels.set(key, levels);
          }),
      );
    });

    if (pending.length) {
      await Promise.all(pending);
    }
  }

  function getVocabLevelWeight(levels) {
    if (levels.includes("考研")) {
      return 3;
    }
    if (levels.includes("六级")) {
      return 2;
    }
    if (levels.includes("四级")) {
      return 1;
    }
    return 0;
  }

  async function buildSentenceVocabulary() {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function" || !state.wordLevels.size) {
      state.sentenceVocab = new Map();
      state.sentenceVocabReady = false;
      return;
    }

    const vocabulary = new Map();
    const pending = [];

    state.segmentOrder.forEach((view) => {
      const seen = new Set();
      const records = [];
      tokenizeWords(view.english).forEach((token) => {
        const key = normalizeWord(token);
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        const levels = state.wordLevels.get(key) || [];
        if (!levels.length) {
          return;
        }
        const record = {
          word: token,
          key,
          phonetic: "",
          meaning: "",
          levels,
          wordId: makeWordId(token, view.english),
        };
        records.push(record);
        pending.push(
          Promise.resolve(index.lookup(token))
            .catch(() => null)
            .then((entry) => {
              if (!entry) {
                return;
              }
              record.phonetic = cleanPhonetic(entry.phonetic);
              record.meaning = String(entry.meaning || "").trim();
            }),
        );
      });

      records.sort(
        (left, right) =>
          getVocabLevelWeight(right.levels) -
            getVocabLevelWeight(left.levels) ||
          left.word.localeCompare(right.word),
      );
      vocabulary.set(view.id, records.slice(0, 10));
    });

    if (pending.length) {
      await Promise.all(pending);
    }
    state.sentenceVocab = vocabulary;
    state.sentenceVocabReady = true;
  }

  async function refreshIndices() {
    const run = ++state.indexRun;
    await Promise.all([loadCollocations(), loadWordLevels()]);
    if (run !== state.indexRun) {
      return;
    }
    await buildSentenceVocabulary();
    if (run !== state.indexRun) {
      return;
    }
    renderPagePreservingScroll();
  }

  function tokenizeWords(value) {
    const source = String(value || "");
    const found = source.match(WORD_PATTERN);
    return Array.isArray(found) ? found : [];
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

  function getPhraseEntries(view) {
    if (state.phraseCache.has(view.id)) {
      return state.phraseCache.get(view.id);
    }
    if (!state.collocationReady) {
      return [];
    }

    const index = window.CollocationIndex;
    const collected = new Map();
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
        (level) => LEVEL_SHORT[level],
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
      index.findInText(view.english).forEach(add);
    }

    const extra = view.keyPhrase;
    const extraKey = normalizePhraseKey(extra);
    if (extraKey && !collected.has(extraKey)) {
      const local =
        typeof index?.lookup === "function" ? index.lookup(extra) : null;
      add(
        local
          ? { ...local, levels: local.levels, mask: local.mask }
          : { phrase: extra, levels: [], mask: 0, meaning: view.meaning },
      );
    }

    const sorted = [...collected.values()]
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
      .slice(0, 16);

    state.phraseCache.set(view.id, sorted);
    return sorted;
  }

  /* --------------------------------------------------------- 渲染台词页 */

  function renderPage() {
    if (!elements.content || !state.data) {
      return;
    }
    const scenes = Array.isArray(state.data.scenes) ? state.data.scenes : [];
    const fragment = document.createDocumentFragment();

    const legend = createLegend();
    if (legend) {
      fragment.append(legend);
    }

    scenes.forEach((scene, index) => {
      fragment.append(createSceneSection(scene, index));
    });

    elements.content.replaceChildren(fragment);
    renderNavigation(scenes);
    updateTokenMarks();
    observeScenes();
  }

  function renderPagePreservingScroll() {
    const scrollY = window.scrollY;
    renderPage();
    window.scrollTo({ top: scrollY, behavior: "auto" });
  }

  function createLegend() {
    if (!state.showLevels) {
      return null;
    }
    const legend = document.createElement("div");
    legend.className = "movie-legend";

    const label = document.createElement("span");
    label.textContent = "词库标记";
    legend.append(label);

    [
      { level: "四级", text: "四级词" },
      { level: "六级", text: "六级词" },
      { level: "考研", text: "考研词" },
    ].forEach((item) => {
      const wrapper = document.createElement("span");
      wrapper.className = "movie-legend-item";
      const line = document.createElement("span");
      line.className = `movie-legend-line ${LEVEL_CLASS[item.level] || ""}`.trim();
      const copy = document.createElement("span");
      copy.textContent = item.text;
      wrapper.append(line, copy);
      legend.append(wrapper);
    });

    return legend;
  }

  function renderNavigation(scenes) {
    if (!elements.sceneNavigation) {
      return;
    }
    const fragment = document.createDocumentFragment();

    const heading = document.createElement("p");
    heading.className = "navigation-heading";
    heading.textContent = `${state.data?.show || "剧集"} · ${
      state.data?.episode || ""
    }`;
    fragment.append(heading);

    scenes.forEach((scene, index) => {
      const link = document.createElement("a");
      link.className = "navigation-link";
      link.href = `#${scene.id}`;
      link.dataset.sceneTarget = scene.id;

      const number = document.createElement("span");
      number.className = "navigation-number";
      number.textContent = String(index + 1).padStart(2, "0");

      const copy = document.createElement("span");
      copy.className = "navigation-copy";
      const title = document.createElement("strong");
      title.textContent = scene.title || `场景 ${index + 1}`;
      const meta = document.createElement("small");
      const count = (Array.isArray(scene.segments) ? scene.segments : []).length;
      meta.textContent = `${count} 段`;
      copy.append(title, meta);

      link.append(number, copy);
      fragment.append(link);
    });

    elements.sceneNavigation.replaceChildren(fragment);
  }

  function createSceneSection(scene, index) {
    const section = document.createElement("article");
    section.className = "movie-scene";
    section.id = scene.id;
    section.dataset.sceneId = scene.id;

    const segments = Array.isArray(scene.segments) ? scene.segments : [];
    const views = segments
      .map((segment, position) =>
        state.segments.get(getSegmentId(segment, position)),
      )
      .filter(Boolean);

    const head = document.createElement("header");
    head.className = "movie-scene-head";

    const copy = document.createElement("div");
    copy.className = "movie-scene-copy";

    const kicker = document.createElement("p");
    kicker.className = "movie-scene-kicker";
    const tag = document.createElement("span");
    tag.className = "movie-scene-tag";
    tag.textContent = `SCENE ${String(index + 1).padStart(2, "0")}`;
    const range = document.createElement("span");
    range.textContent = `台词 ${scene.start}-${scene.end}`;
    kicker.append(tag, range);

    const title = document.createElement("h2");
    title.textContent = scene.title || `场景 ${index + 1}`;

    const meta = document.createElement("p");
    meta.className = "movie-scene-meta";
    const translated = views.filter(
      (view) => view.translationSource !== "missing",
    ).length;
    meta.textContent = `${views.length} 段 · 已有 ${translated} 段译文`;

    copy.append(kicker, title, meta);

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "movie-scene-play";
    playButton.textContent = "播放本场";
    playButton.setAttribute(
      "aria-label",
      `播放 ${scene.title || `场景 ${index + 1}`} 的英文台词`,
    );
    playButton.addEventListener("click", () => {
      playSceneEnglish(views, playButton);
    });

    head.append(copy, playButton);

    const list = document.createElement("div");
    list.className = "movie-line-list";
    views.forEach((view) => list.append(createLineRow(view)));

    section.append(head, list);
    return section;
  }

  function createLineRow(view) {
    const row = document.createElement("div");
    row.className = "movie-line";
    row.id = view.id;
    row.dataset.segmentId = view.id;
    row.dataset.segmentNumber = view.number;

    const number = document.createElement("span");
    number.className = "movie-line-number";
    number.textContent = view.number;
    number.setAttribute("aria-label", `第 ${view.number} 句`);

    const body = document.createElement("div");
    body.className = "movie-line-body";

    const dialogue = document.createElement("div");
    dialogue.className = "movie-dialogue";
    view.blocks.forEach((block) => {
      const line = document.createElement("p");
      line.className = "movie-dialogue-line";
      line.lang = "en";
      if (block.speaker) {
        const speaker = document.createElement("span");
        speaker.className = "movie-speaker";
        speaker.textContent = block.speaker;
        line.append(speaker);
      }
      appendEnglishText(line, block.text, view.id);
      dialogue.append(line);

      if (block.stage) {
        const stage = document.createElement("span");
        stage.className = "movie-stage";
        stage.textContent = `（${block.stage}）`;
        dialogue.append(stage);
      }
    });

    const translation = document.createElement("p");
    translation.className = "movie-translation";
    translation.lang = "zh-CN";
    translation.textContent = view.translation || "";

    body.append(dialogue);
    if (view.translation) {
      body.append(translation);
    }

    const grammarNotes = createGrammarNotes(view);
    if (grammarNotes) {
      body.append(grammarNotes);
    }

    const sentenceVocab = createSentenceVocabBlock(view);
    if (sentenceVocab) {
      body.append(sentenceVocab);
    }

    const foot = document.createElement("div");
    foot.className = "movie-line-foot";

    const sourceMeta = SOURCE_META[view.translationSource] || SOURCE_META.missing;
    const badge = document.createElement("span");
    badge.className = `movie-source-badge ${sourceMeta.className}`.trim();
    badge.textContent = sourceMeta.label;
    if (sourceMeta.hint) {
      badge.title = sourceMeta.hint;
    }
    foot.append(badge);

    if (view.translationSource === "machine" && sourceMeta.hint) {
      const hint = document.createElement("span");
      hint.className = "movie-machine-hint";
      hint.textContent = sourceMeta.hint;
      foot.append(hint);
    }

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "movie-play-button";
    playButton.textContent = "播放";
    playButton.setAttribute("aria-label", `播放第 ${view.number} 句英文`);
    playButton.addEventListener("click", () => {
      playSegmentEnglish(view, playButton);
    });
    foot.append(playButton);

    body.append(foot);

    const phraseRow = createPhraseRow(view);
    if (phraseRow) {
      body.append(phraseRow);
    }

    const alternatives = createAlternativeBlock(view);
    if (alternatives) {
      body.append(alternatives);
    }

    row.append(number, body);
    return row;
  }

  function appendEnglishText(container, text, segmentId) {
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
      button.dataset.segmentId = segmentId;
      button.dataset.wordId = makeWordId(match[0], source);
      button.textContent = match[0];
      const levels = state.wordLevels.get(normalizeWord(match[0]));
      if (levels?.length) {
        button.dataset.levels = levels.join(" ");
      }
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

  function createPhraseLevelBadges(levels) {
    const usable = (Array.isArray(levels) ? levels : []).filter(
      (level) => LEVEL_SHORT[level],
    );
    if (!usable.length) {
      return null;
    }

    const wrap = document.createElement("span");
    wrap.className = "phrase-levels";
    usable.forEach((level) => {
      const badge = document.createElement("i");
      badge.className = `phrase-level ${LEVEL_CLASS[level] || ""}`.trim();
      badge.textContent = LEVEL_SHORT[level];
      badge.title = `${level}固定搭配`;
      wrap.append(badge);
    });
    return wrap;
  }

  function createPhraseRow(view) {
    const phrases = getPhraseEntries(view);
    if (!phrases.length) {
      return null;
    }

    const row = document.createElement("div");
    row.className = "movie-phrase-row";

    const label = document.createElement("span");
    label.className = "movie-phrase-label";
    label.textContent = "固定搭配";
    row.append(label);

    phrases.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "key-word-chip phrase-chip";
      button.dataset.word = entry.phrase;
      button.dataset.wordKind = "phrase";
      button.dataset.segmentId = view.id;
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
      button.setAttribute(
        "aria-label",
        `查看${levelText} ${entry.phrase} 的释义`,
      );
      row.append(button);
    });

    return row;
  }

  function createSentenceVocabBlock(view) {
    if (!state.sentenceVocabReady) {
      return null;
    }
    const entries = state.sentenceVocab.get(view.id) || [];
    if (!entries.length) {
      return null;
    }

    const block = document.createElement("div");
    block.className = "movie-sentence-vocab";

    const label = document.createElement("span");
    label.className = "movie-sentence-vocab-label";
    label.textContent = `本句词汇 ${entries.length}`;
    block.append(label);

    const list = document.createElement("div");
    list.className = "movie-sentence-vocab-list";

    entries.forEach((entry) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sentence-vocab-chip";
      button.dataset.word = entry.word;
      button.dataset.segmentId = view.id;
      button.dataset.wordId = entry.wordId;

      const head = document.createElement("span");
      head.className = "sentence-vocab-head";

      const word = document.createElement("strong");
      word.lang = "en";
      word.textContent = entry.word;
      head.append(word);

      const levels = createPhraseLevelBadges(entry.levels);
      if (levels) {
        head.append(levels);
      }

      if (entry.phonetic) {
        const phonetic = document.createElement("small");
        phonetic.className = "sentence-vocab-phonetic";
        phonetic.lang = "en";
        phonetic.textContent = entry.phonetic;
        head.append(phonetic);
      }
      button.append(head);

      if (entry.meaning) {
        const meaning = document.createElement("span");
        meaning.className = "sentence-vocab-meaning";
        meaning.textContent = entry.meaning.slice(0, 90);
        button.append(meaning);
      }

      button.setAttribute(
        "aria-label",
        `查看 ${entry.word} 的释义与固定搭配`,
      );
      list.append(button);
    });

    block.append(list);
    return block;
  }

  function createGrammarNotes(view) {
    const notes = Array.isArray(view.grammarNotes) ? view.grammarNotes : [];
    if (!notes.length) {
      return null;
    }

    const block = document.createElement("div");
    block.className = "movie-grammar-notes";

    const label = document.createElement("span");
    label.className = "movie-grammar-label";
    label.textContent = "语法 / 考点";

    const list = document.createElement("ul");
    list.className = "movie-grammar-list";
    notes.forEach((note) => {
      const item = document.createElement("li");
      item.textContent = note;
      list.append(item);
    });

    block.append(label, list);
    return block;
  }

  function createAlternativeBlock(view) {
    const groups = view.alternatives.filter(
      (item) => item.alternatives.length > 0,
    );
    if (!groups.length) {
      return null;
    }

    const block = document.createElement("div");
    block.className = "movie-alternatives";

    const label = document.createElement("span");
    label.className = "movie-alternatives-label";
    label.textContent = "日常还可以说";
    block.append(label);

    const list = document.createElement("ul");
    list.className = "movie-alternative-list";
    groups.forEach((group) => {
      const item = document.createElement("li");
      if (group.phrase) {
        const phrase = document.createElement("strong");
        phrase.lang = "en";
        phrase.textContent = group.phrase;
        item.append(phrase);
      }
      const copy = document.createElement("span");
      copy.lang = "en";
      copy.textContent = group.alternatives.join(" / ");
      item.append(copy);
      list.append(item);
    });
    block.append(list);
    return block;
  }

  function observeScenes() {
    if (typeof IntersectionObserver !== "function" || !elements.content) {
      return;
    }
    sceneObserver?.disconnect();
    sceneObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        if (!visible.length) {
          return;
        }
        setActiveScene(visible[0].target.id);
      },
      { rootMargin: "-88px 0px -60% 0px", threshold: 0 },
    );
    elements.content
      .querySelectorAll(".movie-scene")
      .forEach((scene) => sceneObserver.observe(scene));
  }

  function setActiveScene(sceneId) {
    if (!sceneId || sceneId === state.activeSceneId) {
      return;
    }
    state.activeSceneId = sceneId;
    elements.sceneNavigation
      ?.querySelectorAll("[data-scene-target]")
      .forEach((link) => {
        link.classList.toggle("is-active", link.dataset.sceneTarget === sceneId);
      });
  }

  /* ------------------------------------------------------- 生词标记状态 */

  function getMovieDocumentId() {
    return `movie-${state.episodeId}`;
  }

  function getMovieDocument() {
    const id = getMovieDocumentId();
    return getReadingDocuments().find((document) => document.id === id) || null;
  }

  function getMovieDocumentShell() {
    const existing = getMovieDocument();
    if (existing) {
      return existing;
    }
    return {
      id: getMovieDocumentId(),
      title: `${state.data?.title || state.episodeId} 台词生词`,
      category: MOVIE_CATEGORY,
      section: `${state.data?.show || "美剧"} ${state.episodeId}`,
      createdAt: Date.now(),
      paragraphs: [],
      words: [],
    };
  }

  function getStoredWord(phrase, sentence, kind = "word") {
    const document = getMovieDocument();
    if (!document) {
      return null;
    }
    const id = makeWordId(phrase, sentence, kind);
    return document.words.find((word) => word.id === id) || null;
  }

  function updateTokenMarks() {
    const documentId = getMovieDocumentId();
    elements.content
      ?.querySelectorAll(".word-token, .sentence-vocab-chip")
      .forEach((token) => {
        const key = getItemKey(documentId, { id: token.dataset.wordId });
        token.classList.toggle("is-unknown-token", state.unknown.has(key));
        token.classList.toggle("is-known-token", state.known.has(key));
      });
    updateNavigationCounts();
  }

  function updateNavigationCounts() {
    elements.content?.querySelectorAll(".movie-scene").forEach((scene) => {
      const unknownCount = scene.querySelectorAll(
        ".word-token.is-unknown-token",
      ).length;
      scene.classList.toggle("has-unknown", unknownCount > 0);
      const link = elements.sceneNavigation?.querySelector(
        `[data-scene-target="${scene.id}"]`,
      );
      if (!link) {
        return;
      }
      let chip = link.querySelector(".navigation-unknown");
      if (!unknownCount) {
        chip?.remove();
        return;
      }
      if (!chip) {
        chip = document.createElement("em");
        chip.className = "navigation-unknown";
        link.append(chip);
      }
      chip.textContent = `不会 ${unknownCount}`;
    });
  }

  function updateWordPanelMarkState() {
    const activeWord = state.activeWord;
    if (!activeWord) {
      return;
    }
    const key = getItemKey(getMovieDocumentId(), activeWord.item);
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
      meaning: meaning || activeWord.item.meaning || "查看上下文理解用法",
      addedAt: activeWord.item.addedAt || Date.now(),
      phonetic:
        isUsablePhonetic(activeWord.item.phonetic) ||
        isUsablePhonetic(elements.wordPanelPhonetic?.textContent),
    };

    const shell = getMovieDocumentShell();
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
        ? `${item.phrase} 已加入电影不会`
        : `${item.phrase} 已标记为掌握`,
    );
  }

  /* ------------------------------------------------------------- 单词面板 */

  function getSegmentById(segmentId) {
    return state.segments.get(segmentId) || null;
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
    usable.slice(0, 10).forEach((item) => {
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

  function getContextPhrases(view, phrase) {
    if (!view) {
      return [];
    }
    const key = normalizeWord(phrase);
    if (!key || key.includes(" ")) {
      return [];
    }
    const hits = getPhraseEntries(view);
    return hits
      .filter((item) => ` ${normalizeWord(item.phrase)} `.includes(` ${key} `))
      .slice(0, 6)
      .map((item) => ({ phrase: item.phrase, meaning: item.meaning }));
  }

  function openWordPanel(phrase, view, item, kind = "word") {
    state.activeWord = {
      phrase,
      kind,
      sentence: view?.english || phrase,
      translation: view?.translation || "",
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
      elements.wordLookupStatus.textContent = "正在查询词库…";
    }
    elements.wordMeanings?.replaceChildren();
    renderPhrases(getContextPhrases(view, phrase));
    renderExamples([]);
    if (elements.wordContextSentence) {
      elements.wordContextSentence.textContent = view?.english || phrase;
    }
    if (elements.wordContextTranslation) {
      elements.wordContextTranslation.textContent =
        view?.translation || "当前段落暂无翻译。";
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
    if (Array.isArray(data.levels) && data.levels.length) {
      activeWord.item.levels = data.levels;
      renderWordLevelBadges(data.levels);
    }

    renderPanelPhonetic(
      isUsablePhonetic(data.phonetic) || activeWord.item.phonetic,
    );
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = meanings.length
        ? statusText
        : "词库没有返回释义，可手动补充";
    }
    renderMeanings(activeWord.meanings);
    const merged = [
      ...(Array.isArray(activeWord.item.phrases)
        ? activeWord.item.phrases
        : []),
      ...getContextPhrases(
        getSegmentById(activeWord.segmentId),
        activeWord.phrase,
      ),
    ];
    const seen = new Set();
    renderPhrases(
      merged.filter((item) => {
        const key = normalizePhraseKey(item?.phrase);
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      }),
    );
    renderExamples(Array.isArray(data.examples) ? data.examples : []);
  }

  async function lookupLocalWord(value) {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function") {
      return null;
    }
    const entry = await Promise.resolve(index.lookup(value)).catch(() => null);
    if (!entry?.meaning && !entry?.phonetic) {
      return null;
    }
    const source = String(entry.source || "");
    return {
      translations: entry.meaning ? [entry.meaning] : [],
      definitions: [],
      phonetic: cleanPhonetic(entry.phonetic),
      phrases: [],
      examples: [],
      levels: LEVEL_NAMES.filter((level) => source.includes(level)),
      sourceLabel: source || "站内词库",
    };
  }

  function lookupLocalPhrase(value) {
    const index = window.CollocationIndex;
    if (!index || typeof index.lookup !== "function" || !index.ready) {
      return null;
    }
    const entry = index.lookup(value);
    if (!entry?.phrase) {
      return null;
    }
    return {
      translations: entry.meaning ? [entry.meaning] : [],
      definitions: [],
      phonetic: "",
      phrases: [],
      examples: [],
      levels: Array.isArray(entry.levels) ? entry.levels : [],
      sourceLabel: entry.levels?.length
        ? `站内固定搭配库（${entry.levels.join("、")}）`
        : "站内固定搭配库",
    };
  }

  function mergeWordData(localData, remoteData) {
    const mergeList = (left, right) =>
      [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);

    return {
      translations: mergeList(localData?.translations, remoteData?.translations),
      definitions: mergeList(localData?.definitions, remoteData?.definitions),
      phonetic:
        isUsablePhonetic(remoteData?.phonetic) ||
        isUsablePhonetic(localData?.phonetic),
      phrases: Array.isArray(remoteData?.phrases) ? remoteData.phrases : [],
      examples: Array.isArray(remoteData?.examples) ? remoteData.examples : [],
      levels: localData?.levels || [],
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

    const cacheKey = `${activeWord.kind}|${normalizeWord(activeWord.phrase)}`;
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
    const isPhrase = activeWord.kind === "phrase";
    let localData = null;
    try {
      localData = isPhrase
        ? lookupLocalPhrase(activeWord.phrase) ||
          (await lookupLocalWord(activeWord.phrase))
        : await lookupLocalWord(activeWord.phrase);

      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }

      if (isUsablePhonetic(localData?.phonetic) && localData.translations.length) {
        state.lookupCache.set(cacheKey, localData);
        applyWordResult(
          activeWord,
          localData,
          `已从${localData.sourceLabel}读取释义与音标`,
        );
        return;
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
            ? `站内${localData.sourceLabel}释义，在线词典补充了音标与搭配`
            : `站内${localData.sourceLabel}释义；在线词典暂未提供音标`,
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
          ? "已查询在线词典释义与固定搭配"
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
          `已读取站内${localData.sourceLabel}释义；在线词典暂时不可用`,
        );
        return;
      }
      if (elements.wordPanelPhonetic) {
        renderPanelPhonetic(activeWord.item.phonetic);
      }
      if (elements.wordLookupStatus) {
        elements.wordLookupStatus.textContent = `${
          error.message || "查询失败"
        }，可手动补充释义`;
      }
      renderMeanings(activeWord.meanings || []);
      renderExamples([]);
    }
  }

  function openWordFromTrigger(button) {
    const phrase = button.dataset.word;
    if (!phrase) {
      return;
    }
    const kind = button.dataset.wordKind === "phrase" ? "phrase" : "word";
    const view = getSegmentById(button.dataset.segmentId);
    const existing = getStoredWord(phrase, view?.english || "", kind);
    const chipLevels = String(button.dataset.phraseLevels || "")
      .split("|")
      .map((level) => level.trim())
      .filter((level) => LEVEL_SHORT[level]);
    const chipMeaning = String(button.dataset.phraseMeaning || "").trim();
    const item = existing
      ? {
          ...existing,
          levels: existing.levels?.length ? existing.levels : chipLevels,
        }
      : {
          id: makeWordId(phrase, view?.english || "", kind),
          phrase,
          meaning: chipMeaning,
          phonetic: "",
          levels: chipLevels,
        };

    state.activeWord = null;
    openWordPanel(phrase, view, item, kind);
    if (state.activeWord) {
      state.activeWord.segmentId = view?.id || "";
    }
    lookupActiveWord();
  }

  /* --------------------------------------------------------- 顶部与滚动 */

  function updateReadingProgress() {
    if (!elements.readingProgress) {
      return;
    }
    const scrollable =
      document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
    elements.readingProgress.style.transform = `scaleX(${Math.min(
      1,
      Math.max(0, ratio),
    )})`;
  }

  function requestProgressUpdate() {
    if (state.scrollFrame) {
      return;
    }
    state.scrollFrame = window.requestAnimationFrame(() => {
      state.scrollFrame = 0;
      updateReadingProgress();
    });
  }

  /* ------------------------------------------------------------- 事件 */

  function bindEvents() {
    elements.content?.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-word]");
      if (!trigger) {
        return;
      }
      event.preventDefault();
      openWordFromTrigger(trigger);
    });

    elements.closeWordPanelButton?.addEventListener("click", closeWordPanel);

    elements.markUnknownButton?.addEventListener("click", () => {
      saveActiveWordMark("unknown");
    });
    elements.markKnownButton?.addEventListener("click", () => {
      saveActiveWordMark("known");
    });

    elements.speakWordButton?.addEventListener("click", () => {
      const activeWord = state.activeWord;
      if (!activeWord) {
        return;
      }
      playTexts([activeWord.phrase], elements.speakWordButton);
    });

    elements.episodeSelect?.addEventListener("change", (event) => {
      const id = String(event.target.value || "");
      if (id) {
        stopSpeech();
        openEpisode(id, { push: true });
      }
    });

    elements.displayModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        setDisplayMode(button.dataset.displayMode);
      });
    });

    elements.levelToggleButton?.addEventListener("click", () => {
      setLevelVisibility(!state.showLevels);
      renderPagePreservingScroll();
    });

    elements.sentenceVocabToggleButton?.addEventListener("click", () => {
      setSentenceVocabVisibility(!state.showSentenceVocab);
    });

    elements.alternativeToggleButton?.addEventListener("click", () => {
      setAlternativeVisibility(!state.showAlternatives);
    });

    elements.readAllButton?.addEventListener("click", () => {
      const lineCues = state.segmentOrder.flatMap(findAudioCues);
      const lineCount = state.segmentOrder.reduce(
        (total, view) =>
          total + (Array.isArray(view.blocks) ? view.blocks.length : 0),
        0,
      );
      if (
        lineCues.length &&
        lineCues.length === lineCount &&
        playAudioCues(lineCues, elements.readAllButton)
      ) {
        return;
      }
      const cues = state.segmentOrder.map(findAudioCue).filter(Boolean);
      if (
        cues.length &&
        cues.length === state.segmentOrder.length &&
        playAudioCues(cues, elements.readAllButton)
      ) {
        return;
      }
      playSequence(
        state.segmentOrder.flatMap((view) =>
          view.blocks.map((block) => block.text),
        ),
        elements.readAllButton,
      );
    });

    window.addEventListener("scroll", requestProgressUpdate, { passive: true });
    window.addEventListener("resize", requestProgressUpdate);
    window.addEventListener("popstate", () => {
      const requested = getEpisodeFromLocation();
      if (requested && requested !== state.episodeId) {
        openEpisode(requested, { push: false });
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.activeWord) {
        closeWordPanel();
      }
    });
    window.addEventListener("beforeunload", stopSpeech);
  }

  function initialize() {
    if (!episodes.length) {
      renderError("没有找到可用的剧集数据。");
      return;
    }

    bindEvents();
    refreshVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices);

    setDisplayMode(readStoredValue(DISPLAY_STORAGE_KEY) || "bilingual");
    setLevelVisibility(state.showLevels);
    setSentenceVocabVisibility(state.showSentenceVocab);
    setAlternativeVisibility(state.showAlternatives);
    updateReadAllButton();
    updateReadingProgress();

    const requested = getEpisodeFromLocation();
    const stored = readStoredValue(EPISODE_STORAGE_KEY);
    const initialId = getEpisodeMeta(requested)
      ? requested
      : getEpisodeMeta(stored)
        ? stored
        : episodes[0].id;

    openEpisode(initialId, { push: false });
  }

  window.movieReading = {
    state,
    elements,
    openEpisode,
    renderPage,
    saveActiveWordMark,
  };

  initialize();
})();
