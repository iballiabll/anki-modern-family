(function () {
  "use strict";

  const Deck = window.IballDeck;
  if (!Deck) {
    const fallback = document.querySelector("#kaoyanContent");
    if (fallback) {
      fallback.textContent = "考研题库数据加载失败，请刷新页面。";
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

  const INDEX_PATH = "./kaoyan-data/index.js";
  const LIBRARY = (window.IBALL_KAOYAN_LIBRARY = window.IBALL_KAOYAN_LIBRARY || {});
  const WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  const PHONETIC_PLACEHOLDERS = new Set(["暂无音标", "音标查询中"]);
  const READING_CATEGORY = "考研";
  const READING_SECTION = "考研英语真题";
  const TRACK_STORAGE_KEY = "iball-kaoyan-track";
  const YEAR_STORAGE_KEY = "iball-kaoyan-year";
  const KIND_STORAGE_KEY = "iball-kaoyan-kind";
  const DISPLAY_STORAGE_KEY = "iball-kaoyan-display-mode";
  const ANSWER_STORAGE_KEY = "iball-kaoyan-answers";
  const REVEAL_STORAGE_KEY = "iball-kaoyan-revealed";
  const DRAFT_STORAGE_KEY = "iball-kaoyan-drafts";

  const KIND_LABELS = {
    reading: "阅读理解",
    cloze: "完形填空",
    "new-question-type": "新题型",
    translation: "翻译",
    writing: "写作",
  };
  const KIND_FILTERS = [
    { value: "all", label: "全部题型" },
    { value: "reading", label: "阅读理解" },
    { value: "cloze", label: "完形填空" },
    { value: "new-question-type", label: "新题型" },
    { value: "translation", label: "翻译" },
    { value: "writing", label: "写作" },
  ];
  const LEVEL_NAMES = ["四级", "六级", "考研"];
  const PLACEHOLDER_STEM = /^(第\s*\d+\s*题|翻译第\s*\d+\s*句|全文翻译)$/;

  const WRITING_OPEN_SOURCE = [
    {
      label: "考研英语作文模板导航（无 License，仅思路参考）",
      url: "https://github.com/Withnoidea/Postgraduate-Entrance-Examination-English-Composition-Navigation",
    },
    {
      label: "writing_agent（无 License，仅思路参考）",
      url: "https://github.com/skysyk12/writing_agent",
    },
    {
      label: "Kaoyan-English-Writing-Tutor（无 License，仅思路参考）",
      url: "https://github.com/oliveranderson1089-crypto/Kaoyan-English-Writing-Tutor",
    },
  ];

  const WRITING_GUIDES = {
    notice: {
      label: "通知 / 告示结构",
      steps: [
        "标题与称呼：顶部写 Notice / Notice to ...，必要时补一句 Dear ...",
        "目的句：交代活动或招募背景，例如 This notice is intended to inform you that ...。",
        "硬信息：把时间、地点、名额、资格等要点逐条写清楚，用 at / on / in 精确表达。",
        "行动指引：说明报名方式与截止时间，例如 Those who are interested are expected to ...。",
        "收束与署名：一句话表示感谢或期待，落款用题目给定单位名，不要写自己的真实姓名。",
      ],
      phrases: [
        { en: "This notice is intended to inform you that ...", zh: "本通知旨在告知……" },
        { en: "Those who are interested are expected to sign up before ...", zh: "有意者请在……之前报名。" },
        { en: "For further details, please contact ... at ...", zh: "如需了解更多信息，请通过……联系……" },
        { en: "Your participation will be highly appreciated.", zh: "衷心期待你的参与。" },
      ],
    },
    letter: {
      label: "书信结构",
      steps: [
        "称呼：Dear ..., 首行顶格，逗号结尾。",
        "开篇目的：一句交代写信原因，I am writing to express / invite / apply ...。",
        "主体要点：题目给出几个要点就写几段，一段一个要点，先总说再举例。",
        "礼貌收尾：I would appreciate it if you could ... / Looking forward to your reply.",
        "落款：Yours sincerely, + 题目指定署名。",
      ],
      phrases: [
        { en: "I am writing to express my sincere gratitude for ...", zh: "我写信是为了对……表达诚挚谢意。" },
        { en: "I would appreciate it if you could take my application into consideration.", zh: "如果您能考虑我的申请，我将不胜感激。" },
        { en: "I am looking forward to your early reply.", zh: "期待您的早日回复。" },
        { en: "Please feel free to contact me if you need further information.", zh: "如需更多信息，请随时联系我。" },
      ],
    },
    chart: {
      label: "图表作文结构",
      steps: [
        "首段概述：用一句话点明图表主题，例如 The chart illustrates the changes in ...。",
        "数据描述：挑选两到三个对比最明显的时间点或类别，用 rise / fall / remain stable 描述趋势。",
        "过渡句：This phenomenon can be attributed to several factors. 引出原因分析。",
        "原因段：两到三个原因，从个人、社会、技术三个层次选两个写透。",
        "结论段：回到主题给判断或建议，避免只在结尾重复数据。",
      ],
      phrases: [
        { en: "The chart illustrates the changes in ... over the period from ... to ...", zh: "该图表展示了……期间……的变化。" },
        { en: "There was a sharp rise in ..., climbing from ... to ...", zh: "……急剧上升，从……增长到……。" },
        { en: "Several factors can account for this trend.", zh: "这一趋势可以归因于几个因素。" },
        { en: "It is advisable for us to ... in order to ...", zh: "为了……，我们宜……。" },
      ],
    },
    picture: {
      label: "图画作文结构",
      steps: [
        "首段描写：As is vividly shown in the picture, ... 用一句话写画面，一句话写文字说明。",
        "寓意解读：点出画面背后的社会现象或价值判断，例如 The drawing is meant to remind us that ...。",
        "分析段：写两个层面的原因或影响，社会层面 + 个人层面。",
        "结论段：给态度与行动，So significant is the issue that ... 收束。",
      ],
      phrases: [
        { en: "As is vividly shown in the picture, ...", zh: "正如图片生动展示的那样……" },
        { en: "The drawing is meant to remind us that ...", zh: "这幅画意在提醒我们……" },
        { en: "So significant is this issue that we cannot afford to ignore it.", zh: "这一问题如此重要，我们无法忽视。" },
        { en: "Only by taking joint efforts can we ...", zh: "只有共同努力，我们才能……" },
      ],
    },
    essay: {
      label: "议论文结构",
      steps: [
        "首段入题：背景句 + 观点句，观点句必须明确表态。",
        "主体一：第一个理由，用现象或例子支撑，避免空泛。",
        "主体二：第二个理由或让步反驳，保证两段逻辑不同层。",
        "结论段：重申观点并给出可执行建议，不引入新论点。",
      ],
      phrases: [
        { en: "When it comes to ..., opinions vary from person to person.", zh: "谈到……，人们看法不一。" },
        { en: "From my perspective, ... plays a decisive role in ...", zh: "在我看来，……在……中起决定作用。" },
        { en: "Admittedly, ..., yet the benefits far outweigh the drawbacks.", zh: "诚然……，但利远大于弊。" },
        { en: "Therefore, it is high time that we took action to ...", zh: "因此，我们该采取行动……了。" },
      ],
    },
  };

  const WRITING_CHECKLIST = [
    "题目要求的每个要点都写到了吗？漏一个要点通常直接扣分。",
    "第一段有没有明确的任务句，让阅卷人一眼看出文章目的？",
    "段落之间有没有连接词（To begin with / Moreover / Therefore）？",
    "句式是否出现长短交替，而不是全部简单句？",
    "是否出现过长的定语从句或生僻拼写，导致错误风险变高？",
    "落款、署名、字数是否符合同一题的具体要求？",
  ];

  const USER_TEMPLATE_NOTE =
    "你提供的百度网盘作文模板已下载并接入站点素材库（考研 · 作文模板），共 5 份：《作文资料使用方法》《万能模板1_大作文》《万能模板1_小作文》《大作文资料》《小作文资料》，可在「素材库 → 考研」里直接下载原件。站内保存的是你的原始资料，不冒充官方范文，也不改写其中的模板内容；下面的结构框架、模板句与开源思路参考是站点原创整理，用于对照片中的模板自查。";

  const USER_TEMPLATE_LINKS = [
    {
      label: "来源：英语一作文模板(1)（提取码 iq7m）",
      url: "https://pan.baidu.com/s/1xPlY6BPtsjusXa4bFWqxfQ?pwd=iq7m",
    },
    {
      label: "来源：英语一作文模板 / 小众作文模板（提取码 iq7m）",
      url: "https://pan.baidu.com/s/1dfhHIFjB9KYLTbb_dOUuxA?pwd=iq7m",
    },
    {
      label: "来源：小众英语作文模板（提取码 iq7m）",
      url: "https://pan.baidu.com/s/1I-H3GWCG-cXQ_WCimPgybQ?pwd=iq7m",
    },
  ];

  const state = {
    index: null,
    track: "all",
    year: "",
    kind: "all",
    paperId: "",
    data: null,
    openRun: 0,
    lookupRun: 0,
    speechRun: 0,
    activeWord: null,
    activeSpeechButton: null,
    allSpeaking: false,
    lookupCache: new Map(),
    // 原文定位结果按「试卷 + 题号」缓存，切标签来回时不用重复计算。
    locatorCache: new Map(),
    unknown: restoreSet(STORAGE_KEYS.unknown),
    known: restoreSet(STORAGE_KEYS.known),
    choices: readStoredMap(ANSWER_STORAGE_KEY),
    revealed: readStoredMap(REVEAL_STORAGE_KEY),
    drafts: readStoredMap(DRAFT_STORAGE_KEY),
    toastTimer: 0,
    sectionNodes: [],
  };

  const elements = {
    readingProgress: document.querySelector("#readingProgress"),
    heroStats: document.querySelector("#heroStats"),
    layout: document.querySelector("#kaoyanLayout"),
    trackSelect: document.querySelector("#trackSelect"),
    yearSelect: document.querySelector("#yearSelect"),
    kindSelect: document.querySelector("#kindSelect"),
    pieceNavigation: document.querySelector("#pieceNavigation"),
    content: document.querySelector("#kaoyanContent"),
    answerToggleButton: document.querySelector("#answerToggleButton"),
    resetAnswersButton: document.querySelector("#resetAnswersButton"),
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
    wordContextSentence: document.querySelector("#wordContextSentence"),
    wordContextTranslation: document.querySelector("#wordContextTranslation"),
    wordNoteInput: document.querySelector("#wordNoteInput"),
    markUnknownButton: document.querySelector("#markUnknownButton"),
    markKnownButton: document.querySelector("#markKnownButton"),
    closeWordPanelButton: document.querySelector("#closeWordPanelButton"),
  };

  let voices = [];

  /* ------------------------------------------------------------ 存储帮助 */

  function readStoredValue(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function writeStoredValue(key, value) {
    try {
      if (value) {
        window.localStorage.setItem(key, value);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // 隐私模式下写入失败时不影响阅读。
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
      showToast("浏览器存储写入失败，本次标记可能不会保留");
    }
  }

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

  function normalizeWord(value) {
    return String(value || "")
      .replace(/[’‘`]/g, "'")
      .toLowerCase()
      .replace(/^[^a-z]+|[^a-z'-]+$/g, "")
      .trim();
  }

  function isUsablePhonetic(value) {
    const text = String(value || "").trim();
    return Boolean(text) && !PHONETIC_PLACEHOLDERS.has(text);
  }

  function hasUsableWordResult(value) {
    if (!value) {
      return false;
    }
    const meanings = [
      ...(Array.isArray(value.translations) ? value.translations : []),
      ...(Array.isArray(value.definitions) ? value.definitions : []),
    ].filter(Boolean);
    return meanings.length > 0 || isUsablePhonetic(value.phonetic);
  }

  function parseLevels(source) {
    const text = String(source || "");
    return LEVEL_NAMES.filter((level) => text.includes(level));
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

  function countWords(text) {
    const matches = String(text || "").match(WORD_PATTERN);
    return matches ? matches.length : 0;
  }

  /* -------------------------------------------------------------- TTS */

  function refreshVoices() {
    if (!("speechSynthesis" in window)) {
      return;
    }
    voices = window.speechSynthesis.getVoices() || [];
  }

  function getPreferredVoice() {
    if (!voices.length) {
      refreshVoices();
    }
    return (
      voices.find((voice) => /en[-_]US/i.test(voice.lang) && /natural|google|aria|jenny/i.test(voice.name)) ||
      voices.find((voice) => /en[-_]US/i.test(voice.lang)) ||
      voices.find((voice) => /^en/i.test(voice.lang)) ||
      null
    );
  }

  function stopSpeech() {
    state.speechRun += 1;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (state.activeSpeechButton) {
      state.activeSpeechButton.classList.remove("is-playing");
      state.activeSpeechButton = null;
    }
    state.allSpeaking = false;
    updateReadAllButton();
  }

  function updateReadAllButton() {
    if (!elements.readAllButton) {
      return;
    }
    elements.readAllButton.classList.toggle("is-playing", state.allSpeaking);
    elements.readAllButton.textContent = state.allSpeaking ? "停止播放" : "全文播放";
  }

  function speakText(text, runId, onDone, onError) {
    const source = String(text || "").trim();
    if (!source) {
      onError?.();
      return false;
    }
    if (!("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      onError?.();
      return false;
    }
    const utterance = new window.SpeechSynthesisUtterance(source);
    utterance.lang = "en-US";
    utterance.rate = 0.94;
    const voice = getPreferredVoice();
    if (voice) {
      utterance.voice = voice;
    }
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
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function playSingle(text, button, label) {
    if (button && button.classList.contains("is-playing")) {
      stopSpeech();
      return;
    }
    stopSpeech();
    const run = state.speechRun;
    if (!button) {
      speakText(text, run, null, () => showToast("当前浏览器不支持语音朗读"));
      return;
    }
    state.activeSpeechButton = button;
    button.classList.add("is-playing");
    const started = speakText(
      text,
      run,
      () => {
        button.classList.remove("is-playing");
        state.activeSpeechButton = null;
      },
      () => {
        button.classList.remove("is-playing");
        state.activeSpeechButton = null;
        showToast("当前浏览器不支持语音朗读");
      },
    );
    if (!started) {
      button.classList.remove("is-playing");
      state.activeSpeechButton = null;
      showToast("当前浏览器不支持语音朗读");
      return;
    }
    if (label) {
      showToast(`正在朗读${label}`);
    }
  }

  function playSequence(texts, triggerButton, label) {
    const list = texts.map((text) => String(text || "").trim()).filter(Boolean);
    if (!list.length) {
      showToast("当前板块没有可朗读的英文内容");
      return;
    }
    if (state.allSpeaking) {
      stopSpeech();
      return;
    }
    stopSpeech();
    state.allSpeaking = true;
    state.activeSpeechButton = triggerButton || null;
    triggerButton?.classList.add("is-playing");
    updateReadAllButton();
    const run = state.speechRun;

    const finish = (message) => {
      state.allSpeaking = false;
      triggerButton?.classList.remove("is-playing");
      state.activeSpeechButton = null;
      updateReadAllButton();
      if (message) {
        showToast(message);
      }
    };

    // 交给全站朗读通道：整段一次排队，句与句之间不再插延时，
    // 并且自动获得控制条上的暂停 / 继续 / 重播。
    if (window.IballSpeech?.speakSequence) {
      const started = window.IballSpeech.speakSequence(
        list.map((text) => ({ text, rate: 0.94 })),
        {
          label: label || "真题朗读",
          onFinish: (message) => {
            if (run !== state.speechRun) {
              return;
            }
            if (message === "已停止播放") {
              finish("已停止朗读");
              return;
            }
            finish(message || `${label || "本篇"}朗读完成`);
          },
          onError: () => {
            if (run === state.speechRun) {
              finish("朗读中断，请稍后重试");
            }
          },
          onUnsupported: () => finish("当前浏览器不支持语音朗读"),
        },
      );
      if (!started) {
        finish("当前浏览器不支持语音朗读");
      }
      return;
    }

    const playNext = (index) => {
      if (run !== state.speechRun) {
        return;
      }
      if (index >= list.length) {
        finish(`${label || "本篇"}朗读完成`);
        return;
      }
      const started = speakText(
        list[index],
        run,
        () => playNext(index + 1),
        () => finish("朗读中断，请稍后重试"),
      );
      if (!started) {
        finish("当前浏览器不支持语音朗读");
      }
    };

    playNext(0);
  }

  /* ------------------------------------------------------------- 数据层 */

  function loadScriptOnce(src, flag) {
    if (flag && flag()) {
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

  async function loadIndex() {
    if (!window.IBALL_KAOYAN_INDEX) {
      await loadScriptOnce(INDEX_PATH, () => window.IBALL_KAOYAN_INDEX);
    }
    const index = window.IBALL_KAOYAN_INDEX;
    if (!index || !Array.isArray(index.papers)) {
      throw new Error("题库索引为空");
    }
    state.index = index;
    return index;
  }

  function getPaperMeta(paperId) {
    return (state.index?.papers || []).find((paper) => paper.id === paperId) || null;
  }

  function loadPaperData(paperId) {
    const meta = getPaperMeta(paperId);
    if (!meta) {
      return Promise.reject(new Error("没有找到这套试卷。"));
    }
    if (LIBRARY[meta.id]) {
      return Promise.resolve(LIBRARY[meta.id]);
    }
    return loadScriptOnce(meta.file, () => LIBRARY[meta.id]).then(() => {
      const data = LIBRARY[meta.id];
      if (!data) {
        throw new Error("试卷数据为空。");
      }
      return data;
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

  function getPapersForTrack(track) {
    return (state.index?.papers || [])
      .filter((paper) => track === "all" || paper.track === track)
      .sort((left, right) => {
        if (left.year !== right.year) {
          return right.year - left.year;
        }
        return left.track.localeCompare(right.track);
      });
  }

  function fillSelect(select, options, value) {
    if (!select) {
      return;
    }
    select.replaceChildren();
    options.forEach(({ value: optionValue, label }) => {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      select.append(option);
    });
    if (value && options.some((option) => option.value === value)) {
      select.value = value;
    }
  }

  function buildFilters() {
    const tracks = state.index?.tracks || [];
    fillSelect(
      elements.trackSelect,
      [
        { value: "all", label: "英语一 + 英语二" },
        ...tracks.map((track) => ({ value: track.id, label: track.label })),
      ],
      state.track,
    );
    fillSelect(
      elements.kindSelect,
      KIND_FILTERS.map((item) => ({ value: item.value, label: item.label })),
      state.kind,
    );
    syncYearSelect();
  }

  function syncYearSelect(preferredPaperId) {
    const papers = getPapersForTrack(state.track);
    const years = [...new Set(papers.map((paper) => String(paper.year)))];
    const preferred =
      (preferredPaperId && String(getPaperMeta(preferredPaperId)?.year || "")) ||
      state.year ||
      years[0] ||
      "";
    fillSelect(
      elements.yearSelect,
      years.map((year) => ({ value: year, label: `${year} 年` })),
      preferred,
    );
    state.year = elements.yearSelect?.value || preferred;
  }

  function pickPaper() {
    const params = getLocationParams();
    const candidates = [
      params.get("paper"),
      readStoredValue("iball-kaoyan-paper"),
      state.paperId,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const meta = getPaperMeta(candidate);
      if (!meta) {
        continue;
      }
      if (state.track !== "all" && meta.track !== state.track) {
        continue;
      }
      if (state.year && String(meta.year) !== String(state.year)) {
        continue;
      }
      return meta;
    }

    const papers = getPapersForTrack(state.track).filter(
      (paper) => !state.year || String(paper.year) === String(state.year),
    );
    return papers[papers.length - 1] || getPapersForTrack(state.track)[0] || null;
  }

  function renderHeroStats() {
    if (!elements.heroStats || !state.index) {
      return;
    }
    const papers = state.index.papers;
    const totals = papers.reduce(
      (accumulator, paper) => {
        accumulator.questions += Number(paper.stats?.questions) || 0;
        accumulator.words += Number(paper.stats?.words) || 0;
        return accumulator;
      },
      { questions: 0, words: 0 },
    );
    const chips = [
      { value: `${papers.length}`, label: "套真题" },
      { value: `${totals.questions}`, label: "道题目" },
      { value: `${Math.round(totals.words / 1000)}k`, label: "英文词" },
      { value: "2010-2026", label: "年份跨度" },
    ];
    elements.heroStats.replaceChildren(
      ...chips.map((chip) => {
        const node = document.createElement("span");
        node.className = "stat-chip";
        const strong = document.createElement("strong");
        strong.textContent = chip.value;
        const label = document.createElement("span");
        label.textContent = chip.label;
        node.append(strong, label);
        return node;
      }),
    );
  }

  /* ------------------------------------------------------------ 文本渲染 */

  function splitSentenceRanges(text) {
    const ranges = [];
    const source = String(text || "");
    const pattern = /[^.!?]+[.!?]+["'”’)\]]*|[^.!?]+$/g;
    let match = pattern.exec(source);
    while (match) {
      const value = match[0].trim();
      if (value) {
        ranges.push({
          start: match.index,
          end: match.index + match[0].length,
          text: value,
        });
      }
      match = pattern.exec(source);
    }
    return ranges;
  }

  function sentenceAt(ranges, index, fallback) {
    const hit = ranges.find((range) => index >= range.start && index < range.end);
    return hit ? hit.text : fallback;
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
      const sentence = sentenceAt(ranges, match.index, source);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "word-token";
      button.dataset.word = match[0];
      button.dataset.sentence = sentence;
      button.dataset.translation = context.translation || "";
      button.dataset.sectionId = context.sectionId || "";
      button.dataset.wordId = makeWordId(match[0], sentence);
      button.textContent = match[0];
      button.setAttribute("aria-label", `查看单词 ${match[0]} 的释义与固定搭配`);
      container.append(button);
      lastIndex = match.index + match[0].length;
      match = WORD_PATTERN.exec(source);
    }
    if (lastIndex < source.length) {
      container.append(document.createTextNode(source.slice(lastIndex)));
    }
  }

  function appendClozeText(container, text, context, blankNumbers) {
    const source = String(text || "");
    const ranges = splitSentenceRanges(source);
    const pattern = /\d{1,2}/g;
    let lastIndex = 0;
    let match = pattern.exec(source);
    while (match) {
      const before = source[match.index - 1];
      const after = source[match.index + match[0].length];
      const isBlank =
        blankNumbers.has(Number(match[0])) &&
        before !== "-" &&
        after !== "-" &&
        !/\d/.test(before || "") &&
        !/\d/.test(after || "");
      if (!isBlank) {
        match = pattern.exec(source);
        continue;
      }

      if (match.index > lastIndex) {
        const chunk = source.slice(lastIndex, match.index);
        const chunkStart = lastIndex;
        const rangeIndex = chunkStart + Math.max(0, chunk.length - 1);
        appendChunkWithTokens(
          container,
          chunk,
          context,
          ranges,
          chunkStart,
        );
      }
      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = "kaoyan-blank";
      slot.dataset.blankNumber = match[0];
      const numberLabel = document.createElement("span");
      numberLabel.className = "kaoyan-blank-number";
      numberLabel.textContent = match[0];
      const pick = document.createElement("span");
      pick.className = "kaoyan-blank-pick";
      pick.textContent = state.choices[`${state.paperId}|${match[0]}`] || "·";
      slot.append(numberLabel, pick);
      slot.addEventListener("click", () => {
        const target = elements.content?.querySelector(
          `[data-question-number="${match[0]}"]`,
        );
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.classList.add("is-highlighted");
        window.setTimeout(() => target?.classList.remove("is-highlighted"), 1400);
      });
      container.append(slot);
      lastIndex = match.index + match[0].length;
      match = pattern.exec(source);
    }
    if (lastIndex < source.length) {
      appendChunkWithTokens(
        container,
        source.slice(lastIndex),
        context,
        ranges,
        lastIndex,
      );
    }
  }

  function appendChunkWithTokens(container, chunk, context, ranges, offset) {
    const source = String(chunk || "");
    let lastIndex = 0;
    WORD_PATTERN.lastIndex = 0;
    let match = WORD_PATTERN.exec(source);
    while (match) {
      if (match.index > lastIndex) {
        container.append(document.createTextNode(source.slice(lastIndex, match.index)));
      }
      const absoluteIndex = offset + match.index;
      const sentence = sentenceAt(ranges, absoluteIndex, "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "word-token";
      button.dataset.word = match[0];
      button.dataset.sentence = sentence;
      button.dataset.translation = context.translation || "";
      button.dataset.sectionId = context.sectionId || "";
      button.dataset.wordId = makeWordId(match[0], sentence || match[0]);
      button.textContent = match[0];
      button.setAttribute("aria-label", `查看单词 ${match[0]} 的释义与固定搭配`);
      container.append(button);
      lastIndex = match.index + match[0].length;
      match = WORD_PATTERN.exec(source);
    }
    if (lastIndex < source.length) {
      container.append(document.createTextNode(source.slice(lastIndex)));
    }
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

  /* ------------------------------------------------------------ 答案解析层 */

  // 停用词只用于「原文定位」的关键词提取，不参与判分，也不会改写任何题目内容。
  const LOCATOR_STOPWORDS = new Set([
    "about", "above", "after", "again", "against", "almost", "along", "also",
    "although", "among", "another", "answer", "anyone", "anything", "because",
    "become", "before", "behind", "being", "below", "besides", "better",
    "between", "beyond", "both", "cannot", "could", "does", "doing", "done",
    "down", "during", "each", "either", "else", "even", "ever", "every",
    "first", "following", "from", "further", "given", "have", "having", "here",
    "however", "instead", "into", "itself", "just", "least", "less", "like",
    "made", "make", "many", "might", "more", "most", "much", "must", "near",
    "need", "never", "next", "none", "nothing", "often", "once", "only",
    "other", "others", "ought", "over", "own", "passage", "probably",
    "question", "rather", "same", "says", "should", "since", "some", "still",
    "such", "than", "that", "their", "them", "then", "there", "these", "they",
    "this", "those", "though", "through", "thus", "under", "until", "upon",
    "very", "were", "what", "when", "where", "whether", "which", "while",
    "will", "with", "within", "without", "would", "your", "yours",
  ]);

  function locatorTokens(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .split(/[^a-z']+/)
      .map((token) => token.replace(/^'+|'+$/g, ""))
      .map((token) => token.replace(/ies$/, "y").replace(/(es|s|ed|ing)$/, ""))
      .filter((token) => token.length >= 4 && !LOCATOR_STOPWORDS.has(token));
  }

  function splitSourceSentences(text) {
    return String(text || "")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  // 用题干 + 正确选项的关键词在原文里找最接近的一句，属于可复核的机械定位，
  // 不是人工撰写的解析，因此界面上标注为「机读定位」。
  function locateSourceSentence(targets, paragraphs) {
    const list = Array.isArray(paragraphs) ? paragraphs : [];
    const wanted = [...new Set(locatorTokens(targets.filter(Boolean).join(" ")))];
    if (!list.length || !wanted.length) {
      return null;
    }
    let best = null;
    list.forEach((paragraph, paragraphIndex) => {
      splitSourceSentences(paragraph).forEach((sentence) => {
        const available = new Set(locatorTokens(sentence));
        let hits = 0;
        wanted.forEach((token) => {
          if (available.has(token)) {
            hits += 1;
          }
        });
        if (!hits) {
          return;
        }
        const score = hits / wanted.length + Math.min(hits, 4) * 0.05;
        if (!best || score > best.score) {
          best = {
            score,
            hits,
            sentence,
            paragraphIndex,
            coverage: hits / wanted.length,
          };
        }
      });
    });
    if (!best) {
      return null;
    }
    if (best.hits >= 2 || (wanted.length === 1 && best.hits === 1)) {
      return { ...best, kind: "sentence" };
    }
    return null;
  }

  // 句子级没命中时退到段落级：统计各段的关键词命中数，给出回读区间。
  function locateSourceParagraph(targets, paragraphs) {
    const list = Array.isArray(paragraphs) ? paragraphs : [];
    const wanted = [...new Set(locatorTokens(targets.filter(Boolean).join(" ")))];
    if (!list.length || !wanted.length) {
      return null;
    }
    let best = null;
    list.forEach((paragraph, paragraphIndex) => {
      const available = new Set(locatorTokens(paragraph));
      let hits = 0;
      wanted.forEach((token) => {
        if (available.has(token)) {
          hits += 1;
        }
      });
      if (hits >= 2 && (!best || hits > best.hits)) {
        best = { paragraphIndex, hits, kind: "paragraph" };
      }
    });
    return best;
  }

  function answerOptionText(question, options, answer) {
    const key = String(answer || "").trim().toUpperCase();
    if (!key) {
      return "";
    }
    const pool = Array.isArray(options?.pool) ? options.pool : [];
    const fromQuestion = (question.options || []).find(
      (option) => String(option.key).toUpperCase() === key,
    );
    if (fromQuestion?.text) {
      return fromQuestion.text;
    }
    const fromPool = pool.find(
      (option) => String(option.key).toUpperCase() === key,
    );
    return fromPool?.text || "";
  }

  function createAnalysisBlock(question, options) {
    const answer = String(question.answer || "").trim();
    const optionText = answerOptionText(question, options, answer);
    const reference = String(question.reference || "").trim();
    const cacheKey = questionKey(question.number);
    let locator = state.locatorCache.get(cacheKey);
    if (locator === undefined) {
      const targets = [question.stem, optionText];
      locator =
        locateSourceSentence(targets, options?.paragraphs) ||
        locateSourceParagraph(targets, options?.paragraphs) ||
        null;
      state.locatorCache.set(cacheKey, locator);
    }
    if (!answer && !reference && !locator) {
      return null;
    }

    const details = createElement("details", "question-analysis");
    details.append(createElement("summary", "question-analysis-summary", "答案解析"));
    const body = createElement("div", "question-analysis-body");

    if (answer) {
      const answerLine = createElement("p", "question-analysis-answer");
      answerLine.append(createElement("span", "question-analysis-label", "正确答案"));
      answerLine.append(
        document.createTextNode(
          optionText ? `${answer}. ${optionText}` : answer,
        ),
      );
      body.append(answerLine);
    }

    if (reference) {
      const referenceLine = createElement("p", "question-analysis-reference");
      referenceLine.append(
        createElement("span", "question-analysis-label", "参考解析 / 译文"),
      );
      referenceLine.append(document.createTextNode(reference));
      body.append(referenceLine);
    }

    if (locator?.kind === "sentence") {
      const locatorLine = createElement("p", "question-analysis-locator");
      locatorLine.append(
        createElement(
          "span",
          "question-analysis-label",
          `原文定位 P${locator.paragraphIndex + 1}`,
        ),
      );
      const sentence = createElement("span", "question-analysis-sentence");
      sentence.lang = "en";
      sentence.textContent = locator.sentence;
      locatorLine.append(sentence);
      body.append(locatorLine);
    } else if (locator?.kind === "paragraph") {
      const locatorLine = createElement("p", "question-analysis-locator");
      locatorLine.append(
        createElement(
          "span",
          "question-analysis-label",
          `段落定位 P${locator.paragraphIndex + 1}`,
        ),
      );
      locatorLine.append(
        document.createTextNode(
          `题干与选项的关键词集中在第 ${locator.paragraphIndex + 1} 段（命中 ${locator.hits} 个），建议以该段为主要回读区间。`,
        ),
      );
      body.append(locatorLine);
    } else if (answer && optionText) {
      const locatorLine = createElement("p", "question-analysis-locator");
      locatorLine.append(
        createElement("span", "question-analysis-label", "定位提示"),
      );
      locatorLine.append(
        document.createTextNode(
          "题干与选项都是原文的同义改写，机读未命中关键词，建议回读全文后结合正确选项复核。",
        ),
      );
      body.append(locatorLine);
    }

    if (answer && optionText && options?.paragraphs?.length) {
      body.append(
        createElement(
          "p",
          "question-analysis-note",
          "解析为基于真题原文的机读定位，仅用于快速回查原文；选项正误以官方答案为准。",
        ),
      );
    }

    details.append(body);
    return details;
  }

  /* -------------------------------------------------------------- 作答层 */

  function questionKey(number) {
    return `${state.paperId}|${number}`;
  }

  function getChoice(number) {
    return state.choices[questionKey(number)] || "";
  }

  function isRevealed(number) {
    return Boolean(state.revealed[questionKey(number)]);
  }

  function isPaperRevealed() {
    return Boolean(state.revealed[`paper|${state.paperId}`]);
  }

  function setChoice(number, value) {
    state.choices[questionKey(number)] = value;
    persistMap(ANSWER_STORAGE_KEY, state.choices);
  }

  function revealQuestion(number) {
    state.revealed[questionKey(number)] = true;
    persistMap(REVEAL_STORAGE_KEY, state.revealed);
  }

  function updateAnswerToggleButton() {
    if (!elements.answerToggleButton) {
      return;
    }
    elements.answerToggleButton.textContent = isPaperRevealed()
      ? "隐藏全部答案"
      : "一键显示全部答案";
  }

  function refreshQuestionCard(card) {
    const number = Number(card.dataset.questionNumber);
    const answer = card.dataset.answer || "";
    const choice = getChoice(number);
    const revealed = isRevealed(number) || isPaperRevealed();
    card.classList.toggle("is-answered", Boolean(choice));
    card.classList.toggle("is-revealed", revealed);
    card.querySelectorAll("[data-option-key]").forEach((option) => {
      const key = option.dataset.optionKey;
      option.classList.toggle("is-selected", key === choice);
      option.classList.toggle("is-correct", revealed && key === answer);
      option.classList.toggle(
        "is-wrong",
        revealed && Boolean(choice) && key === choice && key !== answer,
      );
      option.setAttribute("aria-pressed", String(key === choice));
    });
    const feedback = card.querySelector(".question-feedback");
    if (feedback) {
      if (!choice) {
        feedback.textContent = revealed ? `参考答案：${answer}` : "";
        feedback.className = "question-feedback is-revealed";
      } else if (choice === answer) {
        feedback.textContent = `回答正确：${answer}`;
        feedback.className = "question-feedback is-correct";
      } else {
        feedback.textContent = `回答错误，正确答案是 ${answer}`;
        feedback.className = "question-feedback is-wrong";
      }
      if (!choice && !revealed) {
        feedback.textContent = "";
      }
    }
    const analysis = card.querySelector(".question-analysis");
    if (analysis) {
      analysis.open = revealed;
    }
  }

  function refreshBlankSlots() {
    elements.content?.querySelectorAll(".kaoyan-blank").forEach((slot) => {
      const number = Number(slot.dataset.blankNumber);
      const choice = getChoice(number);
      const card = elements.content?.querySelector(
        `[data-question-number="${number}"]`,
      );
      const answer = card?.dataset.answer || "";
      const pick = slot.querySelector(".kaoyan-blank-pick");
      if (pick) {
        pick.textContent = choice || "·";
      }
      const revealed = isRevealed(number) || isPaperRevealed();
      slot.classList.toggle("is-correct", Boolean(choice) && choice === answer);
      slot.classList.toggle(
        "is-wrong",
        Boolean(choice) && choice !== answer && revealed,
      );
    });
  }

  function refreshQuestionProgress() {
    const cards = [...(elements.content?.querySelectorAll("[data-question-number]") || [])];
    if (!cards.length) {
      return;
    }
    const answered = cards.filter((card) => getChoice(Number(card.dataset.questionNumber))).length;
    const correct = cards.filter((card) => {
      const number = Number(card.dataset.questionNumber);
      return getChoice(number) && getChoice(number) === card.dataset.answer;
    }).length;
    const progress = elements.content?.querySelector("#questionProgress");
    if (progress) {
      progress.textContent = `已作答 ${answered} / ${cards.length} 题 ｜ 正确 ${correct} 题`;
    }
  }

  function createQuestionCard(question, options) {
    const card = createElement("div", "question-card");
    card.dataset.questionNumber = String(question.number);
    card.dataset.answer = String(question.answer || "");

    const head = createElement("div", "question-head");
    head.append(createElement("span", "question-number", `第 ${question.number} 题`));
    if (options?.badge) {
      head.append(createElement("span", "question-type", options.badge));
    }
    card.append(head);

    const stem = String(question.stem || "").trim();
    if (stem && !PLACEHOLDER_STEM.test(stem)) {
      const stemNode = createElement("p", "question-stem");
      appendEnglishText(stemNode, stem, {
        sectionId: options?.sectionId || "",
        translation: options?.translation || "",
      });
      card.append(stemNode);
    }

    const list = createElement(
      "div",
      options?.letterGrid ? "question-options kaoyan-letter-grid" : "question-options",
    );
    const optionList = options?.letterGrid
      ? (options.pool || []).map((item) => ({
          key: item.key,
          text: "",
        }))
      : options?.truth
        ? [
            { key: "T", text: "正确 (True)" },
            { key: "F", text: "错误 (False)" },
          ]
        : question.options || [];

    optionList.forEach((item) => {
      const button = createElement("button", "question-option");
      button.type = "button";
      button.dataset.optionKey = item.key;
      button.append(createElement("span", "option-letter", item.key));
      if (item.text) {
        button.append(createElement("span", "option-text", item.text));
      }
      button.addEventListener("click", () => {
        setChoice(question.number, item.key);
        const answer = card.dataset.answer || "";
        if (item.key !== answer) {
          revealQuestion(question.number);
        }
        refreshQuestionCard(card);
        refreshBlankSlots();
        refreshQuestionProgress();
      });
      list.append(button);
    });
    card.append(list);

    const actions = createElement("div", "question-actions");
    const reset = createElement("button", "question-reset", "重置本题");
    reset.type = "button";
    reset.addEventListener("click", () => {
      delete state.choices[questionKey(question.number)];
      delete state.revealed[questionKey(question.number)];
      persistMap(ANSWER_STORAGE_KEY, state.choices);
      persistMap(REVEAL_STORAGE_KEY, state.revealed);
      refreshQuestionCard(card);
      refreshBlankSlots();
      refreshQuestionProgress();
    });
    actions.append(reset);
    card.append(actions);
    card.append(createElement("p", "question-feedback"));
    const analysis = createAnalysisBlock(question, options);
    if (analysis) {
      card.append(analysis);
    }
    refreshQuestionCard(card);
    return card;
  }

  function createQuestionSection(sections, options = {}) {
    const wrapper = createElement("section", "question-section");
    const head = createElement("div", "question-section-head");
    head.append(createElement("h3", "", options.title || "题目"));
    head.append(createElement("span", "question-progress", "尚未作答"));
    const progress = head.querySelector(".question-progress");
    if (progress) {
      progress.id = "questionProgress";
    }
    wrapper.append(head);
    const list = createElement("div", options.grid ? "question-grid" : "question-list");
    if (options.grid) {
      list.className = "kaoyan-question-grid";
    }
    sections.forEach(({ question, config }) => {
      list.append(createQuestionCard(question, config));
    });
    wrapper.append(list);
    refreshQuestionProgress();
    return wrapper;
  }

  /* --------------------------------------------------------- 板块渲染器 */

  function createPieceShell(section, index) {
    const article = createElement("article", "intensive-piece kaoyan-piece");
    article.id = `section-${section.id}`;
    article.dataset.sectionId = section.id;
    article.dataset.kind = section.kind;

    const head = createElement("header", "piece-head");
    const copy = createElement("div", "piece-head-copy");
    const kicker = createElement("p", "piece-kicker");
    const typeClass = ["is-section-a", "is-section-b", "is-section-c"][index % 3];
    kicker.append(createElement("span", `piece-type ${typeClass}`, `板块 ${index + 1}`));
    kicker.append(createElement("span", "", KIND_LABELS[section.kind] || section.kindLabel || ""));
    kicker.append(createElement("span", "", `${section.trackLabel || ""} ${section.year || ""}`));
    copy.append(kicker);
    copy.append(createElement("h2", "", section.label || section.title || "板块"));
    const metaText = [
      section.questions?.length ? `${section.questions.length} 题` : "",
      section.paragraphs?.length ? `${section.paragraphs.length} 段` : "",
      section.wordCount ? `${section.wordCount} 词` : "",
    ]
      .filter(Boolean)
      .join(" ｜ ");
    copy.append(createElement("p", "piece-meta", metaText));
    head.append(copy);
    article.append(head);
    return article;
  }

  function createPlayButton(texts, label) {
    const button = createElement("button", "piece-play-button", "播放本篇");
    button.type = "button";
    button.addEventListener("click", () => playSequence(texts, button, label));
    return button;
  }

  function renderParagraphList(article, section, paragraphs, options = {}) {
    const list = createElement("div", "paragraph-list");
    const blankNumbers = new Set((section.blankNumbers || []).map(Number));
    paragraphs.forEach((text, index) => {
      const row = createElement("div", "paragraph-row");
      row.append(createElement("span", "paragraph-number", `P${index + 1}`));
      const toolbar = createElement("div", "paragraph-toolbar");
      toolbar.append(createElement("span", "grammar-count", `${countWords(text)} 词`));
      const play = createElement("button", "paragraph-play-button", "朗读本段");
      play.type = "button";
      play.addEventListener("click", () => playSingle(text, play, "本段"));
      toolbar.append(play);
      row.append(toolbar);
      const paragraph = createElement("p", "paragraph-english");
      const context = {
        sectionId: section.id,
        translation: options.translation || "",
      };
      if (options.cloze && blankNumbers.size) {
        appendClozeText(paragraph, text, context, blankNumbers);
      } else {
        appendEnglishText(paragraph, text, context);
      }
      row.append(paragraph);
      list.append(row);
    });
    article.append(list);
  }

  function renderEnrichment(article, section) {
    const items = Array.isArray(section.enrichment) ? section.enrichment : [];
    if (!items.length) {
      return;
    }
    const block = createElement("details", "kaoyan-enrichment");
    const summary = createElement(
      "summary",
      "kaoyan-enrichment-summary",
      `Echo 难点评析与参考译文（非官方，${items.length} 条）`,
    );
    summary.style.cursor = "pointer";
    block.append(summary);
    items.forEach((item) => {
      if (!item) {
        return;
      }
      if (item.type === "heading") {
        block.append(createElement("h4", "", item.text || ""));
        return;
      }
      if (item.type === "note") {
        block.append(createElement("p", "is-note", item.text || ""));
        return;
      }
      if (item.type === "bullets") {
        const list = document.createElement("ul");
        (item.items || []).forEach((entry) => {
          list.append(createElement("li", "", entry));
        });
        block.append(list);
        return;
      }
      block.append(createElement("p", "", item.text || ""));
    });
    article.append(block);
  }

  function renderReading(article, section) {
    const head = article.querySelector(".piece-head");
    head.append(
      createPlayButton(section.paragraphs || [], section.label),
    );
    renderParagraphList(article, section, section.paragraphs || []);
    article.append(
      createQuestionSection(
        (section.questions || []).map((question) => ({
          question,
          config: {
            badge: "阅读",
            sectionId: section.id,
            paragraphs: section.paragraphs || [],
          },
        })),
        { title: "阅读题目" },
      ),
    );
  }

  function renderCloze(article, section) {
    const head = article.querySelector(".piece-head");
    head.append(createPlayButton(section.paragraphs || [], section.label));
    const callout = createElement(
      "p",
      "kaoyan-callout",
    );
    callout.innerHTML =
      "<strong>用法：</strong>正文中的编号可点击，会跳到对应空格；选错会立刻显示正确选项。完形只提供答案链与难点评析，不提供官方译文。";
    article.append(callout);
    renderParagraphList(article, section, section.paragraphs || [], { cloze: true });
    article.append(
      createQuestionSection(
        (section.questions || []).map((question) => ({
          question,
          config: {
            badge: `第 ${question.number} 空`,
            sectionId: section.id,
            paragraphs: section.paragraphs || [],
          },
        })),
        { title: "20 道完形填空", grid: true },
      ),
    );
    renderEnrichment(article, section);
  }

  function renderNewQuestionType(article, section) {
    const head = article.querySelector(".piece-head");
    head.append(createPlayButton(section.paragraphs || [], section.label));
    const isTruth = section.answerMode === "true-false";
    const callout = createElement("p", "kaoyan-callout");
    callout.innerHTML = isTruth
      ? "<strong>题型：</strong>判断正误。选项只有 True / False，选错会立刻给出正确答案。"
      : "<strong>题型：</strong>从下方 A-G 备选段落中为每一空选出最合适的一段。字母选项不会显示多余文字，避免和备选段落重复。";
    article.append(callout);

    if (!isTruth) {
      const pool = createElement("div", "kaoyan-pool-list");
      (section.options || []).forEach((option) => {
        const item = createElement("div", "kaoyan-pool-item");
        item.append(createElement("span", "kaoyan-pool-letter", option.key));
        const text = createElement("p", "kaoyan-pool-text");
        appendEnglishText(text, option.text || "", { sectionId: section.id });
        item.append(text);
        pool.append(item);
      });
      article.append(pool);
      renderParagraphList(article, section, section.paragraphs || [], {
        cloze: false,
      });
      article.append(
        createQuestionSection(
          (section.questions || []).map((question) => ({
            question,
            config: {
              badge: "段落匹配",
              sectionId: section.id,
              letterGrid: true,
              pool: section.options || [],
              paragraphs: section.paragraphs || [],
            },
          })),
          { title: "段落匹配题目", grid: true },
        ),
      );
      return;
    }

    renderParagraphList(article, section, section.paragraphs || []);
    article.append(
      createQuestionSection(
        (section.questions || []).map((question) => ({
          question,
          config: {
            badge: "判断正误",
            sectionId: section.id,
            truth: true,
            paragraphs: section.paragraphs || [],
          },
        })),
        { title: "判断正误题目", grid: true },
      ),
    );
  }

  function renderTranslation(article, section) {
    const head = article.querySelector(".piece-head");
    const segmentTexts = (section.segments || []).map((segment) => segment.text || "");
    head.append(
      createPlayButton(
        segmentTexts.length ? segmentTexts : section.paragraphs || [],
        section.label,
      ),
    );
    const callout = createElement("p", "kaoyan-callout");
    callout.innerHTML =
      "<strong>用法：</strong>先自己翻译，再点开参考译文对照。参考译文与评析均为 Echo 生成的非官方学习材料，只用于自测与复盘。";
    article.append(callout);

    const referenceByNumber = new Map(
      (section.questions || []).map((question) => [
        Number(question.number),
        question.reference || "",
      ]),
    );

    if (segmentTexts.length) {
      const wrapper = createElement("div", "kaoyan-segments");
      (section.segments || []).forEach((segment) => {
        const reference = referenceByNumber.get(Number(segment.number)) || "";
        const card = createElement("div", "kaoyan-segment");
        const segHead = createElement("div", "kaoyan-segment-head");
        segHead.append(createElement("span", "kaoyan-segment-number", String(segment.number)));
        segHead.append(createElement("span", "", `${countWords(segment.text)} 词`));
        const play = createElement("button", "paragraph-play-button", "朗读本句");
        play.type = "button";
        play.addEventListener("click", () =>
          playSingle(segment.text || "", play, `第 ${segment.number} 句`),
        );
        segHead.append(play);
        card.append(segHead);
        const english = createElement("p", "paragraph-english");
        appendEnglishText(english, segment.text || "", {
          sectionId: section.id,
          translation: reference,
        });
        card.append(english);
        if (reference) {
          const referenceNode = createElement("div", "kaoyan-reference");
          referenceNode.append(createElement("span", "kaoyan-reference-label", "参考译文"));
          referenceNode.append(document.createTextNode(reference));
          card.append(referenceNode);
        }
        wrapper.append(card);
      });
      article.append(wrapper);
    } else {
      const wholeReference = referenceByNumber.get(Number(section.questions?.[0]?.number)) || "";
      renderParagraphList(article, section, section.paragraphs || [], {
        translation: wholeReference,
      });
      if (wholeReference) {
        const referenceNode = createElement("div", "kaoyan-reference");
        referenceNode.style.margin = "0 26px 22px";
        referenceNode.append(createElement("span", "kaoyan-reference-label", "参考译文（整段）"));
        referenceNode.append(document.createTextNode(wholeReference));
        article.append(referenceNode);
      }
    }
    renderEnrichment(article, section);
  }

  function resolveGuide(prompt) {
    const text = String(prompt || "");
    if (/notice/i.test(text)) {
      return { key: "notice", guide: WRITING_GUIDES.notice };
    }
    if (/letter|write to|e-mail|email/i.test(text)) {
      return { key: "letter", guide: WRITING_GUIDES.letter };
    }
    if (/chart|graph|figure|table|percentage|subscriptions/i.test(text)) {
      return { key: "chart", guide: WRITING_GUIDES.chart };
    }
    if (/picture|drawing|cartoon|photo/i.test(text)) {
      return { key: "picture", guide: WRITING_GUIDES.picture };
    }
    return { key: "essay", guide: WRITING_GUIDES.essay };
  }

  function draftKey(part) {
    return `${state.paperId}|${part}`;
  }

  function createWritingCard(part, section) {
    const card = createElement("div", "kaoyan-writing-card");
    const head = createElement("div", "kaoyan-writing-head");
    head.append(createElement("strong", "", `${part.part} · 第 ${part.number} 题`));
    const limits = [
      part.points ? `${part.points} 分` : "",
      part.wordLimit ? `约 ${part.wordLimit} 词` : "",
    ]
      .filter(Boolean)
      .join(" ｜ ");
    head.append(createElement("span", "", limits));
    card.append(head);

    const prompt = createElement("p", "kaoyan-writing-prompt");
    appendEnglishText(prompt, part.prompt || "", { sectionId: section.id });
    card.append(prompt);

    const { guide: selected } = resolveGuide(part.prompt);
    const structure = createElement("div", "kaoyan-writing-block");
    structure.append(createElement("strong", "", `${selected.label}（站点原创，非官方范文）`));
    const steps = createElement("ol", "kaoyan-template-steps");
    selected.steps.forEach((step, index) => {
      const item = createElement("li", "kaoyan-template-step");
      item.append(createElement("em", "", String(index + 1)));
      item.append(createElement("span", "", step));
      steps.append(item);
    });
    structure.append(steps);
    card.append(structure);

    const phrases = createElement("div", "kaoyan-writing-block");
    phrases.append(createElement("strong", "", "可套用句型（通用模板句）"));
    const phraseList = createElement("div", "kaoyan-phrase-list");
    selected.phrases.forEach((phrase) => {
      const row = createElement("div", "kaoyan-phrase-row");
      row.append(createElement("strong", "", phrase.en));
      row.append(createElement("span", "", phrase.zh));
      phraseList.append(row);
    });
    phrases.append(phraseList);
    card.append(phrases);

    const checklist = createElement("div", "kaoyan-writing-block");
    checklist.append(createElement("strong", "", "写完自查"));
    const list = createElement("ul", "kaoyan-checklist");
    WRITING_CHECKLIST.forEach((item) => {
      list.append(createElement("li", "", item));
    });
    checklist.append(list);
    card.append(checklist);

    const refs = createElement("div", "kaoyan-writing-block");
    refs.append(createElement("strong", "", "开源思路参考"));
    refs.append(
      createElement(
        "span",
        "kaoyan-writing-hint",
        "这些仓库没有 License，只登记思路来源，未复制其中任何模板文本。",
      ),
    );
    const refList = createElement("div", "kaoyan-ref-list");
    WRITING_OPEN_SOURCE.forEach((item) => {
      const link = createElement("a", "kaoyan-ref-chip", item.label);
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      refList.append(link);
    });
    refs.append(refList);
    card.append(refs);

    const draft = createElement("div", "kaoyan-draft");
    const label = createElement("strong", "", "我的草稿");
    const textarea = document.createElement("textarea");
    textarea.rows = 8;
    textarea.placeholder = "在这里写你的作文，自动保存到本机浏览器。";
    textarea.value = state.drafts[draftKey(part.part)] || "";
    const foot = createElement("div", "kaoyan-draft-foot");
    const counter = createElement("span", "kaoyan-word-count");
    const updateCount = () => {
      const words = countWords(textarea.value);
      const target = Number(part.wordLimit) || 0;
      counter.textContent = target
        ? `${words} 词 ｜ 参考 ${target} 词`
        : `${words} 词`;
      counter.classList.toggle("is-ready", Boolean(target) && words >= target);
    };
    const persistDraft = () => {
      state.drafts[draftKey(part.part)] = textarea.value;
      persistMap(DRAFT_STORAGE_KEY, state.drafts);
    };
    textarea.addEventListener("input", () => {
      updateCount();
      persistDraft();
    });
    updateCount();
    const actions = createElement("div", "kaoyan-draft-actions");
    const clear = createElement("button", "question-reset", "清空草稿");
    clear.type = "button";
    clear.addEventListener("click", () => {
      textarea.value = "";
      persistDraft();
      updateCount();
      showToast("草稿已清空");
    });
    actions.append(clear);
    foot.append(counter, actions);
    draft.append(label, textarea, foot);
    card.append(draft);
    return card;
  }

  function renderWriting(article, section) {
    const notice = createElement("p", "kaoyan-callout");
    notice.innerHTML = `<strong>模板导入说明：</strong>${USER_TEMPLATE_NOTE}`;
    const links = createElement("div", "kaoyan-ref-list");
    links.style.marginTop = "9px";
    USER_TEMPLATE_LINKS.forEach((item) => {
      const link = createElement("a", "kaoyan-ref-chip", item.label);
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      links.append(link);
    });
    notice.append(links);
    article.append(notice);

    const grid = createElement("div", "kaoyan-writing-grid");
    (section.writingParts || []).forEach((part) => {
      grid.append(createWritingCard(part, section));
    });
    article.append(grid);
  }

  function renderSection(section, index) {
    const article = createPieceShell(section, index);
    switch (section.kind) {
      case "reading":
        renderReading(article, section);
        break;
      case "cloze":
        renderCloze(article, section);
        break;
      case "new-question-type":
        renderNewQuestionType(article, section);
        break;
      case "translation":
        renderTranslation(article, section);
        break;
      case "writing":
        renderWriting(article, section);
        break;
      default:
        renderParagraphList(article, section, section.paragraphs || []);
        break;
    }
    return article;
  }

  function renderNavigation(paper) {
    if (!elements.pieceNavigation) {
      return;
    }
    elements.pieceNavigation.replaceChildren();
    elements.pieceNavigation.append(createElement("div", "navigation-heading", "板块导航"));
    state.sectionNodes = [];
    (paper.sections || []).forEach((section, index) => {
      const link = createElement("a", "navigation-link");
      link.href = `#section-${section.id}`;
      link.dataset.sectionId = section.id;
      link.append(createElement("span", "navigation-number", String(index + 1)));
      const copy = createElement("span", "navigation-copy");
      copy.append(createElement("strong", "", section.label || section.title || ""));
      copy.append(
        createElement(
          "span",
          "",
          [
            KIND_LABELS[section.kind] || "",
            section.questions?.length ? `${section.questions.length} 题` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        ),
      );
      link.append(copy);
      link.addEventListener("click", (event) => {
        event.preventDefault();
        document
          .querySelector(`#section-${CSS.escape(section.id)}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      elements.pieceNavigation.append(link);
    });
  }

  function renderOverview(paper) {
    const overview = createElement("section", "kaoyan-overview");
    overview.append(createElement("h2", "", paper.title || paper.id));
    overview.append(
      createElement(
        "p",
        "",
        `${paper.trackLabel} · ${paper.year} 年 · ${paper.stats?.sections || paper.sections.length} 个板块 · ${paper.stats?.questions || 0} 题 · ${paper.stats?.words || 0} 词。数据来自 kaoyan-english 真题语料，按套懒加载，本页只请求当前这一套。`,
      ),
    );
    const grid = createElement("div", "kaoyan-overview-grid");
    (paper.sections || []).forEach((section, index) => {
      const card = createElement("a", "kaoyan-overview-card");
      card.href = `#section-${section.id}`;
      card.append(createElement("strong", "", `${index + 1}. ${section.label || ""}`));
      card.append(
        createElement(
          "span",
          "",
          `${KIND_LABELS[section.kind] || ""} · ${section.questions?.length || 0} 题`,
        ),
      );
      card.addEventListener("click", (event) => {
        event.preventDefault();
        document
          .querySelector(`#section-${CSS.escape(section.id)}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      grid.append(card);
    });
    overview.append(grid);
    const badges = createElement("div", "kaoyan-badges");
    badges.append(createElement("span", "kaoyan-badge", "点词查释义"));
    badges.append(createElement("span", "kaoyan-badge", "标记生词进卡组"));
    badges.append(createElement("span", "kaoyan-badge", "逐题作答与答案开关"));
    badges.append(createElement("span", "kaoyan-badge is-source", "Echo 译文为非官方学习材料"));
    overview.append(badges);
    return overview;
  }

  function renderPaper(paper) {
    if (!elements.content) {
      return;
    }
    const fragment = document.createDocumentFragment();
    fragment.append(renderOverview(paper));
    const sections = (paper.sections || []).filter(
      (section) => state.kind === "all" || section.kind === state.kind,
    );
    if (!sections.length) {
      fragment.append(
        createElement(
          "div",
          "kaoyan-overview",
          "这套试卷没有所选题型，换一个题型筛选试试。",
        ),
      );
    }
    sections.forEach((section) => {
      const index = (paper.sections || []).indexOf(section);
      fragment.append(renderSection(section, index));
    });
    elements.content.replaceChildren(fragment);
    state.sectionNodes = [...elements.content.querySelectorAll(".kaoyan-piece")];
    updateAnswerToggleButton();
    refreshBlankSlots();
    refreshQuestionProgress();
    updateTokenMarks();
    updateActiveNavigation();
  }

  function renderLoading(meta) {
    if (!elements.content) {
      return;
    }
    const wrapper = createElement("div", "loading-state");
    wrapper.append(createElement("strong", "", `正在读取 ${meta?.label || "试卷"}`));
    wrapper.append(createElement("span", "", "按套懒加载，只请求这一套真题数据。"));
    elements.content.replaceChildren(wrapper);
  }

  function renderError(message) {
    if (!elements.content) {
      return;
    }
    const wrapper = createElement("div", "error-state");
    wrapper.append(createElement("strong", "", "数据没有加载成功"));
    wrapper.append(createElement("span", "", message || "请刷新页面重试。"));
    elements.content.replaceChildren(wrapper);
  }

  async function openPaper(paperId, options = {}) {
    const meta = getPaperMeta(paperId);
    if (!meta) {
      renderError("没有找到这套试卷。");
      return;
    }
    const run = ++state.openRun;
    renderLoading(meta);
    stopSpeech();
    closeWordPanel();
    try {
      const data = await loadPaperData(meta.id);
      if (run !== state.openRun) {
        return;
      }
      state.paperId = meta.id;
      state.data = data;
      if (state.kind === "all") {
        const paramKind = getLocationParams().get("kind");
        if (paramKind && KIND_FILTERS.some((item) => item.value === paramKind)) {
          state.kind = paramKind;
          if (elements.kindSelect) {
            elements.kindSelect.value = paramKind;
          }
        }
      }
      writeStoredValue("iball-kaoyan-paper", meta.id);
      renderNavigation(data);
      renderPaper(data);
      setLocationParams(
        {
          paper: meta.id,
          kind: state.kind === "all" ? "" : state.kind,
        },
        false,
      );
      if (options.scrollTo) {
        document
          .querySelector(`#section-${CSS.escape(options.scrollTo)}`)
          ?.scrollIntoView({ behavior: "auto", block: "start" });
      } else if (options.toTop !== false) {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (error) {
      if (run !== state.openRun) {
        return;
      }
      console.error(error);
      renderError(error?.message || "试卷加载失败，请刷新后重试。");
    }
  }

  /* --------------------------------------------------------- 生词与标记 */

  function getReadingDocumentId() {
    return `kaoyan-${state.paperId}`;
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
    return {
      id: getReadingDocumentId(),
      title: `${state.data?.title || state.paperId} 生词`,
      category: READING_CATEGORY,
      section: READING_SECTION,
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
      chip.classList.add(level === "四级" ? "is-cet4" : level === "六级" ? "is-cet6" : "is-kaoyan");
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
    meanings.forEach((meaning) => {
      list.append(createElement("li", "", meaning));
    });
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

  function renderPanelPhonetic(value) {
    if (!elements.wordPanelPhonetic) {
      return;
    }
    elements.wordPanelPhonetic.textContent = isUsablePhonetic(value) ? value : "暂无音标";
  }

  function openWordPanel(phrase, sentence, translation) {
    state.activeWord = {
      phrase,
      sentence: sentence || phrase,
      translation: translation || "",
      item: {
        id: makeWordId(phrase, sentence || phrase),
        phrase,
        sentence: sentence || phrase,
        translation: translation || "",
        meaning: "",
        phonetic: "",
      },
      meanings: [],
    };
    if (elements.wordPanelTitle) {
      elements.wordPanelTitle.textContent = phrase;
    }
    renderPanelPhonetic("");
    renderWordLevelBadges([]);
    if (elements.wordLookupStatus) {
      elements.wordLookupStatus.textContent = "正在查询词典…";
    }
    renderMeanings([]);
    renderPhrases([]);
    if (elements.wordContextSentence) {
      elements.wordContextSentence.textContent = state.activeWord.sentence;
    }
    if (elements.wordContextTranslation) {
      elements.wordContextTranslation.textContent =
        translation || "当前语境暂无译文。";
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
  }

  async function lookupLocalEntry(value) {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function") {
      return null;
    }
    return index.lookup(value).catch(() => null);
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
    if (cached && hasUsableWordResult(cached)) {
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
          phonetic: isUsablePhonetic(localEntry.phonetic) ? localEntry.phonetic : "",
          phrases: [],
          examples: [],
        };
        if (localEntry.levels?.length) {
          renderWordLevelBadges(localEntry.levels);
        }
        state.lookupCache.set(cacheKey, localData);
        applyWordResult(
          activeWord,
          localData,
          `已从本地词库读取释义${localEntry.source ? `（${localEntry.source}）` : ""}`,
        );
      }

      const data = await fetchWordData(activeWord.phrase);
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      const merged = {
        translations: [
          ...(localData?.translations || []),
          ...(data.translations || []),
        ].filter((value, index, list) => value && list.indexOf(value) === index),
        definitions: Array.isArray(data.definitions) ? data.definitions : [],
        phonetic: isUsablePhonetic(data.phonetic)
          ? data.phonetic
          : localData?.phonetic || "",
        phrases: Array.isArray(data.phrases) ? data.phrases : [],
        examples: Array.isArray(data.examples) ? data.examples : [],
      };
      state.lookupCache.set(cacheKey, merged);
      applyWordResult(
        activeWord,
        merged,
        merged.phonetic
          ? "本地词库 + 在线词典释义已合并"
          : "已读取释义；在线词典暂未提供音标",
      );
    } catch (error) {
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      if (localData) {
        applyWordResult(activeWord, localData, "已读取本地释义；在线词典暂时不可用");
        return;
      }
      if (elements.wordLookupStatus) {
        elements.wordLookupStatus.textContent = `${error.message || "查询失败"}，可手动补充释义`;
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
      .map((item) => (item.meaning ? `${item.phrase}（${item.meaning}）` : item.phrase))
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
        ? `${item.phrase} 已加入考研不会`
        : `${item.phrase} 已标记为掌握`,
    );
  }

  /* -------------------------------------------------------------- 其他 UI */

  function updateActiveNavigation() {
    if (!state.sectionNodes.length) {
      return;
    }
    const threshold = 150;
    let activeId = state.sectionNodes[0].dataset.sectionId;
    state.sectionNodes.forEach((node) => {
      if (node.getBoundingClientRect().top <= threshold) {
        activeId = node.dataset.sectionId;
      }
    });
    elements.pieceNavigation
      ?.querySelectorAll(".navigation-link")
      .forEach((link) => {
        link.classList.toggle("is-active", link.dataset.sectionId === activeId);
      });
  }

  function updateProgressBar() {
    if (!elements.readingProgress) {
      return;
    }
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = height > 0 ? Math.min(1, Math.max(0, scrollTop / height)) : 0;
    elements.readingProgress.style.width = `${ratio * 100}%`;
  }

  function setDisplayMode(mode) {
    const next = mode === "english" ? "english" : "bilingual";
    document.body.classList.toggle("is-english-only", next === "english");
    elements.displayModeButtons.forEach((button) => {
      const active = button.dataset.displayMode === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    writeStoredValue(DISPLAY_STORAGE_KEY, next);
  }

  function toggleAllAnswers() {
    const revealed = isPaperRevealed();
    if (revealed) {
      Object.keys(state.revealed)
        .filter((key) => key.startsWith(`${state.paperId}|`))
        .forEach((key) => {
          delete state.revealed[key];
        });
      delete state.revealed[`paper|${state.paperId}`];
    } else {
      state.revealed[`paper|${state.paperId}`] = true;
    }
    persistMap(REVEAL_STORAGE_KEY, state.revealed);
    elements.content?.querySelectorAll("[data-question-number]").forEach((card) => {
      refreshQuestionCard(card);
    });
    refreshBlankSlots();
    updateAnswerToggleButton();
    showToast(revealed ? "已隐藏全部答案" : "已显示全部答案");
  }

  function resetPaperAnswers() {
    Object.keys(state.choices)
      .filter((key) => key.startsWith(`${state.paperId}|`))
      .forEach((key) => {
        delete state.choices[key];
      });
    Object.keys(state.revealed)
      .filter((key) => key.startsWith(`${state.paperId}|`))
      .forEach((key) => {
        delete state.revealed[key];
      });
    delete state.revealed[`paper|${state.paperId}`];
    persistMap(ANSWER_STORAGE_KEY, state.choices);
    persistMap(REVEAL_STORAGE_KEY, state.revealed);
    elements.content?.querySelectorAll("[data-question-number]").forEach((card) => {
      refreshQuestionCard(card);
    });
    refreshBlankSlots();
    refreshQuestionProgress();
    updateAnswerToggleButton();
    showToast("已清空本套作答");
  }

  function playWholePaper() {
    const texts = [];
    state.sectionNodes.forEach((node) => {
      node.querySelectorAll(".paragraph-english").forEach((paragraph) => {
        const text = paragraph.textContent || "";
        if (text.trim()) {
          texts.push(text.trim());
        }
      });
      if (node.dataset.kind === "writing") {
        node.querySelectorAll(".kaoyan-writing-prompt").forEach((prompt) => {
          const text = prompt.textContent || "";
          if (text.trim()) {
            texts.push(text.trim());
          }
        });
      }
    });
    playSequence(texts, elements.readAllButton, "整套试卷");
  }

  function bindEvents() {
    elements.trackSelect?.addEventListener("change", () => {
      state.track = elements.trackSelect.value;
      writeStoredValue(TRACK_STORAGE_KEY, state.track);
      syncYearSelect();
      const meta = pickPaper();
      if (meta) {
        openPaper(meta.id, { push: true });
      }
    });
    elements.yearSelect?.addEventListener("change", () => {
      state.year = elements.yearSelect.value;
      writeStoredValue(YEAR_STORAGE_KEY, state.year);
      const meta = pickPaper();
      if (meta) {
        openPaper(meta.id, { push: true });
      }
    });
    elements.kindSelect?.addEventListener("change", () => {
      state.kind = elements.kindSelect.value;
      writeStoredValue(KIND_STORAGE_KEY, state.kind);
      if (state.data) {
        renderPaper(state.data);
        setLocationParams({ kind: state.kind === "all" ? "" : state.kind }, true);
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    });
    elements.displayModeButtons.forEach((button) => {
      button.addEventListener("click", () =>
        setDisplayMode(button.dataset.displayMode),
      );
    });
    elements.answerToggleButton?.addEventListener("click", toggleAllAnswers);
    elements.resetAnswersButton?.addEventListener("click", resetPaperAnswers);
    elements.readAllButton?.addEventListener("click", playWholePaper);
    elements.closeWordPanelButton?.addEventListener("click", closeWordPanel);
    elements.markUnknownButton?.addEventListener("click", () =>
      saveActiveWordMark("unknown"),
    );
    elements.markKnownButton?.addEventListener("click", () =>
      saveActiveWordMark("known"),
    );
    elements.speakWordButton?.addEventListener("click", () => {
      if (state.activeWord) {
        playSingle(state.activeWord.phrase, elements.speakWordButton, "单词");
      }
    });
    elements.content?.addEventListener("click", (event) => {
      const trigger = event.target.closest(".word-token");
      if (!trigger) {
        return;
      }
      event.preventDefault();
      openWordPanel(
        trigger.dataset.word || trigger.textContent || "",
        trigger.dataset.sentence || "",
        trigger.dataset.translation || "",
      );
    });
    window.addEventListener("scroll", () => {
      updateProgressBar();
      window.requestAnimationFrame(updateActiveNavigation);
    });
    window.addEventListener("popstate", () => {
      const meta = pickPaper();
      if (meta) {
        openPaper(meta.id);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.wordPanel?.hidden) {
        closeWordPanel();
      }
    });
    if ("speechSynthesis" in window) {
      refreshVoices();
      window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
    }
  }

  async function boot() {
    const params = getLocationParams();
    state.track = params.get("track") || readStoredValue(TRACK_STORAGE_KEY) || "all";
    state.year = params.get("year") || readStoredValue(YEAR_STORAGE_KEY) || "";
    state.kind = params.get("kind") || readStoredValue(KIND_STORAGE_KEY) || "all";
    if (!KIND_FILTERS.some((item) => item.value === state.kind)) {
      state.kind = "all";
    }
    try {
      await loadIndex();
    } catch (error) {
      console.error(error);
      renderError("题库索引加载失败，请刷新页面重试。");
      return;
    }
    if (state.track !== "all" && !(state.index.tracks || []).some((track) => track.id === state.track)) {
      state.track = "all";
    }
    buildFilters();
    renderHeroStats();
    bindEvents();
    setDisplayMode(readStoredValue(DISPLAY_STORAGE_KEY) || "bilingual");
    const meta = pickPaper();
    if (!meta) {
      renderError("题库里没有可选试卷。");
      return;
    }
    await openPaper(meta.id, { toTop: false });
    updateProgressBar();
  }

  boot();
})();
