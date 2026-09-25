(function () {
  "use strict";

  const Deck = window.IballDeck;
  if (!Deck) {
    document.body.textContent = "阅读数据加载失败，请刷新页面。";
    return;
  }

  const {
    STORAGE_KEYS,
    cleanReadingText,
    deleteReadingDocument,
    getItemKey,
    getReadingDocuments,
    hashReadingValue,
    persistSet,
    restoreSet,
    saveReadingDocument,
  } = Deck;

  const MAX_READING_LENGTH = 240000;
  const MAX_PARAGRAPHS = 160;
  const TRANSLATION_BATCH_ITEMS = 8;
  const TRANSLATION_BATCH_CHARACTERS = 4800;
  const MAMMOTH_URL =
    "https://cdn.jsdelivr.net/npm/mammoth@1.9.1/mammoth.browser.min.js";
  const PDF_MODULE_URL =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
  const PDF_WORKER_URL =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  const WORD_PATTERN = /[A-Za-z]+(?:['’\-][A-Za-z]+)*/g;
  const PHONETIC_PLACEHOLDERS = new Set(["暂无音标", "音标查询中"]);

  const state = {
    documents: [],
    activeDocumentId: "",
    activeWord: null,
    displayMode: "bilingual",
    lookupRun: 0,
    translationRun: 0,
    speechRun: 0,
    allSpeaking: false,
    known: restoreSet(STORAGE_KEYS.known),
    unknown: restoreSet(STORAGE_KEYS.unknown),
    toastTimer: 0,
  };

  const elements = {
    readingCount: document.querySelector("#readingCount"),
    readingList: document.querySelector("#readingList"),
    newReadingButton: document.querySelector("#newReadingButton"),
    sidebarNewButton: document.querySelector("#sidebarNewButton"),
    uploadPanel: document.querySelector("#uploadPanel"),
    uploadForm: document.querySelector("#uploadForm"),
    readingTitle: document.querySelector("#readingTitle"),
    readingCategory: document.querySelector("#readingCategory"),
    readingSection: document.querySelector("#readingSection"),
    readingFile: document.querySelector("#readingFile"),
    fileDropZone: document.querySelector("#fileDropZone"),
    fileLabel: document.querySelector("#fileLabel"),
    readingText: document.querySelector("#readingText"),
    createReadingButton: document.querySelector("#createReadingButton"),
    clearUploadButton: document.querySelector("#clearUploadButton"),
    uploadStatus: document.querySelector("#uploadStatus"),
    documentPanel: document.querySelector("#documentPanel"),
    documentTitle: document.querySelector("#documentTitle"),
    documentMeta: document.querySelector("#documentMeta"),
    documentStats: document.querySelector("#documentStats"),
    deleteReadingButton: document.querySelector("#deleteReadingButton"),
    translateButton: document.querySelector("#translateButton"),
    readAllButton: document.querySelector("#readAllButton"),
    translationProgressBar: document.querySelector("#translationProgressBar"),
    readerContent: document.querySelector("#readerContent"),
    wordPanel: document.querySelector("#wordPanel"),
    wordPanelTitle: document.querySelector("#wordPanelTitle"),
    wordPanelPhonetic: document.querySelector("#wordPanelPhonetic"),
    speakWordButton: document.querySelector("#speakWordButton"),
    wordLookupStatus: document.querySelector("#wordLookupStatus"),
    wordMeanings: document.querySelector("#wordMeanings"),
    wordContextSentence: document.querySelector("#wordContextSentence"),
    wordContextTranslation: document.querySelector("#wordContextTranslation"),
    wordNoteInput: document.querySelector("#wordNoteInput"),
    markUnknownButton: document.querySelector("#markUnknownButton"),
    markKnownButton: document.querySelector("#markKnownButton"),
    closeWordPanelButton: document.querySelector("#closeWordPanelButton"),
    displayModeButtons: document.querySelectorAll("[data-display-mode]"),
    toast: document.querySelector("#toast"),
  };

  function showToast(message) {
    if (!elements.toast) {
      return;
    }
    window.clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    state.toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2400);
  }

  function setUploadStatus(message, isError = false) {
    if (!elements.uploadStatus) {
      return;
    }
    elements.uploadStatus.textContent = message;
    elements.uploadStatus.classList.toggle("is-error", isError);
  }

  function getActiveDocument() {
    return (
      state.documents.find(
        (document) => document.id === state.activeDocumentId,
      ) || null
    );
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

  function renderPanelPhonetic(value) {
    elements.wordPanelPhonetic.textContent =
      isUsablePhonetic(value) || "暂无音标";
  }

  function makeWordId(phrase, sentence) {
    return `word-${hashReadingValue(
      `${normalizeWord(phrase)}|${cleanReadingText(sentence, 1200)}`,
    )}`;
  }

  function getParagraphById(document, paragraphId) {
    return (
      document.paragraphs.find((paragraph) => paragraph.id === paragraphId) ||
      null
    );
  }

  function getWordEntry(document, phrase, sentence) {
    const normalizedPhrase = normalizeWord(phrase);
    const normalizedSentence = cleanReadingText(sentence, 1200);
    return (
      document.words.find(
        (word) =>
          normalizeWord(word.phrase) === normalizedPhrase &&
          cleanReadingText(word.sentence, 1200) === normalizedSentence,
      ) || null
    );
  }

  function getWordItem(document, phrase, sentence, existing = null) {
    if (existing) {
      return { ...existing };
    }
    return {
      id: makeWordId(phrase, sentence),
      phrase: cleanReadingText(phrase, 120),
      phonetic: "",
      meaning: "",
      sentence: cleanReadingText(sentence, 1200),
      translation: "",
      addedAt: Date.now(),
    };
  }

  function getDocumentWordCount(document) {
    return document.paragraphs.reduce(
      (total, paragraph) =>
        total + (paragraph.english.match(WORD_PATTERN) || []).length,
      0,
    );
  }

  function getDocumentUniqueWordCount(document) {
    const words = new Set();
    document.paragraphs.forEach((paragraph) => {
      (paragraph.english.match(WORD_PATTERN) || []).forEach((word) => {
        words.add(normalizeWord(word));
      });
    });
    return words.size;
  }

  function getDocumentUnknownCount(document) {
    return document.words.filter((word) =>
      state.unknown.has(getItemKey(document.id, word)),
    ).length;
  }

  function renderReadingList() {
    elements.readingCount.textContent = String(state.documents.length);
    elements.readingList.replaceChildren();

    if (state.documents.length === 0) {
      const empty = document.createElement("p");
      empty.className = "reading-list-empty";
      empty.textContent = "还没有上传题目。";
      elements.readingList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    state.documents.forEach((readingDocument) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reading-list-item";
      button.classList.toggle(
        "is-active",
        readingDocument.id === state.activeDocumentId,
      );
      button.dataset.documentId = readingDocument.id;

      const title = document.createElement("strong");
      title.textContent = readingDocument.title;

      const meta = document.createElement("span");
      meta.textContent = `${readingDocument.category} · ${readingDocument.section}`;

      const count = document.createElement("span");
      count.className = "reading-list-count";
      count.textContent = `${readingDocument.words.length} 词`;

      button.append(title, meta, count);
      button.addEventListener("click", () => openDocument(readingDocument.id));
      fragment.append(button);
    });
    elements.readingList.append(fragment);
  }

  function updateDocumentStats(document) {
    const wordCount = getDocumentWordCount(document);
    const uniqueCount = getDocumentUniqueWordCount(document);
    const unknownCount = getDocumentUnknownCount(document);
    elements.documentStats.textContent = `${document.paragraphs.length} 段 · ${wordCount} 个可点词 · ${uniqueCount} 个不同单词 · ${unknownCount} 个不会`;
    elements.documentMeta.textContent = `${document.category} · ${document.section}`;
  }

  function appendEnglishText(container, text, paragraph) {
    const source = String(text || "");
    let lastIndex = 0;
    let match = WORD_PATTERN.exec(source);

    while (match) {
      if (match.index > lastIndex) {
        container.append(document.createTextNode(source.slice(lastIndex, match.index)));
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "word-token";
      button.dataset.word = match[0];
      button.dataset.paragraphId = paragraph.id;
      button.dataset.wordId = makeWordId(match[0], paragraph.english);
      button.textContent = match[0];
      button.setAttribute("aria-label", `查看单词 ${match[0]} 的释义`);
      container.append(button);

      lastIndex = match.index + match[0].length;
      match = WORD_PATTERN.exec(source);
    }

    if (lastIndex < source.length) {
      container.append(document.createTextNode(source.slice(lastIndex)));
    }
  }

  function updateReaderMarks() {
    const document = getActiveDocument();
    if (!document) {
      return;
    }

    elements.readerContent.querySelectorAll(".word-token").forEach((token) => {
      const key = getItemKey(document.id, { id: token.dataset.wordId });
      token.classList.toggle("is-unknown-token", state.unknown.has(key));
      token.classList.toggle("is-known-token", state.known.has(key));
    });
  }

  function renderReader(readingDocument) {
    elements.readerContent.replaceChildren();
    const fragment = document.createDocumentFragment();

    readingDocument.paragraphs.forEach((paragraph, index) => {
      const article = document.createElement("article");
      article.className = "reader-paragraph";
      article.dataset.paragraphId = paragraph.id;

      const head = document.createElement("div");
      head.className = "reader-paragraph-head";

      const number = document.createElement("span");
      number.className = "reader-paragraph-number";
      number.textContent = String(index + 1).padStart(2, "0");

      const readButton = document.createElement("button");
      readButton.type = "button";
      readButton.className = "paragraph-read-button";
      readButton.dataset.speakParagraph = paragraph.id;
      readButton.textContent = "朗读";
      readButton.setAttribute("aria-label", `朗读第 ${index + 1} 段`);

      head.append(number, readButton);

      const english = document.createElement("p");
      english.className = "reader-english";
      english.lang = "en";
      appendEnglishText(english, paragraph.english, paragraph);

      const translation = document.createElement("p");
      translation.className = "reader-translation";
      translation.dataset.paragraphId = paragraph.id;
      translation.textContent = paragraph.chinese || "尚未翻译";
      translation.classList.toggle("is-empty", !paragraph.chinese);

      article.append(head, english, translation);
      fragment.append(article);
    });

    if (readingDocument.paragraphs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "reader-empty";
      empty.textContent = "这份题目还没有可阅读的正文。";
      fragment.append(empty);
    }

    elements.readerContent.append(fragment);
    setDisplayMode(state.displayMode);
    updateReaderMarks();
  }

  function renderActiveDocument() {
    const document = getActiveDocument();
    if (!document) {
      elements.documentPanel.hidden = true;
      elements.uploadPanel.hidden = false;
      return;
    }

    elements.uploadPanel.hidden = true;
    elements.documentPanel.hidden = false;
    elements.documentTitle.textContent = document.title;
    updateDocumentStats(document);
    renderReader(document);
    updateTranslationButton(document);
  }

  function openDocument(documentId) {
    if (!state.documents.some((document) => document.id === documentId)) {
      return;
    }
    stopSpeech();
    state.translationRun += 1;
    state.activeDocumentId = documentId;
    closeWordPanel();
    renderReadingList();
    renderActiveDocument();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showUploadPanel() {
    stopSpeech();
    state.translationRun += 1;
    elements.documentPanel.hidden = true;
    elements.uploadPanel.hidden = false;
    closeWordPanel();
    renderReadingList();
    window.setTimeout(() => elements.readingTitle.focus(), 0);
  }

  function setDisplayMode(mode) {
    state.displayMode = mode === "english" ? "english" : "bilingual";
    elements.documentPanel.classList.toggle(
      "is-english-only",
      state.displayMode === "english",
    );
    elements.displayModeButtons.forEach((button) => {
      const active = button.dataset.displayMode === state.displayMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateTranslationButton(document = getActiveDocument()) {
    if (!elements.translateButton || !document) {
      return;
    }
    const missingCount = document.paragraphs.filter(
      (paragraph) => !paragraph.chinese,
    ).length;
    elements.translateButton.textContent =
      missingCount > 0 ? `翻译全文 (${missingCount})` : "重新翻译全文";
    elements.translateButton.disabled = false;
  }

  function setTranslationBusy(busy) {
    elements.translateButton.disabled = busy;
    elements.documentPanel.classList.toggle("is-translating", busy);
    elements.translationProgressBar.style.width = busy ? "2%" : "0%";
  }

  function getExtractedFileName(fileName) {
    return String(fileName || "")
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim();
  }

  function splitIntoParagraphs(value) {
    const text = cleanReadingText(value, MAX_READING_LENGTH);
    if (!text) {
      return [];
    }

    const blocks = text.split(/\n\s*\n+|\n+/).map((part) => part.trim());
    const paragraphs = [];

    blocks.forEach((block) => {
      if (!block) {
        return;
      }
      if (block.length <= 7000) {
        paragraphs.push(block);
        return;
      }
      for (let index = 0; index < block.length; index += 7000) {
        paragraphs.push(block.slice(index, index + 7000));
      }
    });

    return paragraphs.slice(0, MAX_PARAGRAPHS).map((english, index) => ({
      id: `paragraph-${index + 1}-${hashReadingValue(english)}`,
      english,
      chinese: "",
    }));
  }

  function loadExternalScript(url, isReady) {
    if (isReady()) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => {
        script.remove();
        reject(new Error("外部解析组件加载超时"));
      }, 18000);

      script.src = url;
      script.async = true;
      script.onload = () => {
        window.clearTimeout(timer);
        if (isReady()) {
          resolve();
        } else {
          reject(new Error("外部解析组件初始化失败"));
        }
      };
      script.onerror = () => {
        window.clearTimeout(timer);
        script.remove();
        reject(new Error("外部解析组件加载失败"));
      };
      document.head.append(script);
    });
  }

  async function extractDocx(file) {
    await loadExternalScript(
      MAMMOTH_URL,
      () => typeof window.mammoth?.extractRawText === "function",
    );
    const result = await window.mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    });
    return result.value || "";
  }

  async function extractPdf(file) {
    const pdfjs = await import(PDF_MODULE_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    }).promise;
    const pageTexts = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const lines = [];
      let currentLine = [];
      let previousY = null;

      textContent.items.forEach((item) => {
        const y = Number(item.transform?.[5]);
        if (
          currentLine.length &&
          Number.isFinite(y) &&
          Number.isFinite(previousY) &&
          Math.abs(y - previousY) > 3
        ) {
          lines.push(currentLine.join(" "));
          currentLine = [];
        }
        if (item.str) {
          currentLine.push(item.str.trim());
        }
        if (Number.isFinite(y)) {
          previousY = y;
        }
      });

      if (currentLine.length) {
        lines.push(currentLine.join(" "));
      }
      pageTexts.push(lines.filter(Boolean).join("\n"));
      page.cleanup();
    }

    await pdf.destroy();
    return pageTexts.join("\n\n");
  }

  function extractHtmlText(source) {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    parsed
      .querySelectorAll("script,style,noscript,svg,iframe,canvas")
      .forEach((node) => node.remove());
    parsed.querySelectorAll("br").forEach((node) => {
      node.replaceWith(document.createTextNode("\n"));
    });
    parsed
      .querySelectorAll("p,div,section,article,li,h1,h2,h3,h4,blockquote")
      .forEach((node) => node.append(document.createTextNode("\n")));
    return parsed.body?.textContent || "";
  }

  async function readFileContent(file) {
    const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US") || "";
    if (["txt", "md", "markdown"].includes(extension)) {
      return file.text();
    }
    if (["html", "htm"].includes(extension)) {
      return extractHtmlText(await file.text());
    }
    if (extension === "docx") {
      return extractDocx(file);
    }
    if (extension === "pdf") {
      return extractPdf(file);
    }
    throw new Error("暂不支持这种文件格式，请使用 TXT、Markdown、DOCX 或 PDF。");
  }

  async function importFile(file) {
    if (!file) {
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      throw new Error("文件超过 25MB，请先压缩或改为粘贴文本。");
    }

    elements.fileLabel.textContent = `${file.name} · 正在读取`;
    setUploadStatus("正在读取题目文件，请稍候。");
    try {
      const content = cleanReadingText(
        await readFileContent(file),
        MAX_READING_LENGTH,
      );
      if (!content) {
        throw new Error("文件里没有读取到可用文字。");
      }
      elements.readingText.value = content;
      if (!elements.readingTitle.value.trim()) {
        elements.readingTitle.value = getExtractedFileName(file.name);
      }
      elements.fileLabel.textContent = file.name;
      setUploadStatus(
        `已读取 ${content.length.toLocaleString("zh-CN")} 个字符，可以继续生成阅读。`,
      );
    } catch (error) {
      elements.fileLabel.textContent = file.name;
      setUploadStatus(error.message || "文件读取失败。", true);
    } finally {
      elements.readingFile.value = "";
    }
  }

  function createNewDocument(event) {
    event.preventDefault();
    const title = elements.readingTitle.value.trim();
    const category = elements.readingCategory.value;
    const section = elements.readingSection.value.trim() || "阅读理解";
    const rawText = elements.readingText.value;

    if (!title) {
      setUploadStatus("请先填写题目名称。", true);
      elements.readingTitle.focus();
      return;
    }

    const paragraphs = splitIntoParagraphs(rawText);
    if (paragraphs.length === 0) {
      setUploadStatus("请粘贴英文原文或先导入题目文件。", true);
      elements.readingText.focus();
      return;
    }

    const createdAt = Date.now();
    const saved = saveReadingDocument({
      id: `reading-${createdAt}-${hashReadingValue(`${category}|${title}`)}`,
      title,
      category,
      section,
      createdAt,
      paragraphs,
      words: [],
    });
    if (!saved) {
      setUploadStatus("保存失败，请检查浏览器存储空间。", true);
      return;
    }

    state.documents = getReadingDocuments();
    setUploadStatus("题目已加入素材库。");
    elements.uploadForm.reset();
    elements.fileLabel.textContent = "TXT / Markdown / DOCX / PDF";
    elements.readingCategory.value = category;
    elements.readingSection.value = "阅读理解";
    openDocument(saved.id);
    showToast(`${title} 已加入${category}分类`);
  }

  function openWordPanel(phrase, sentence, paragraphId, item) {
    const readingDocument = getActiveDocument();
    if (!readingDocument) {
      return;
    }
    const paragraph = getParagraphById(readingDocument, paragraphId);
    state.activeWord = {
      documentId: readingDocument.id,
      phrase,
      sentence,
      translation: paragraph?.chinese || "",
      paragraphId,
      item: { ...item },
      meanings: [],
    };

    elements.wordPanelTitle.textContent = phrase;
    elements.wordPanelPhonetic.textContent =
      isUsablePhonetic(item.phonetic) || "音标查询中";
    elements.wordLookupStatus.textContent = "正在查询词典…";
    elements.wordMeanings.replaceChildren();
    elements.wordContextSentence.textContent = sentence;
    elements.wordContextTranslation.textContent =
      paragraph?.chinese || "当前段落尚未翻译。";
    elements.wordNoteInput.value =
      item.meaning && item.meaning !== "查看上下文理解用法"
        ? item.meaning
        : "";
    updateWordPanelMarkState();
    elements.wordPanel.hidden = false;
    elements.wordPanel.setAttribute("aria-hidden", "false");
    document.body.classList.add("has-word-panel");
  }

  function renderMeanings(meanings) {
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

  function getCombinedMeaning(meanings, note) {
    return [...new Set([...meanings, note].map((value) => String(value || "").trim()).filter(Boolean))]
      .join("；")
      .slice(0, 800);
  }

  async function lookupLocalEntry(value) {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function") {
      return null;
    }
    return index.lookup(value).catch(() => null);
  }

  function mergeWordData(localData, remoteData) {
    const localMeanings = Array.isArray(localData?.translations)
      ? localData.translations
      : [];
    const remoteMeanings = [
      ...(Array.isArray(remoteData?.translations)
        ? remoteData.translations
        : []),
      ...(Array.isArray(remoteData?.definitions) ? remoteData.definitions : []),
    ];

    return {
      translations: [...localMeanings, ...remoteMeanings].filter(
        (meaning, index, list) => meaning && list.indexOf(meaning) === index,
      ),
      definitions: [],
      phonetic:
        isUsablePhonetic(remoteData?.phonetic) ||
        isUsablePhonetic(localData?.phonetic),
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
    const document = getActiveDocument();
    if (!activeWord || !document || activeWord.documentId !== document.id) {
      return;
    }

    const existing = getWordEntry(
      document,
      activeWord.phrase,
      activeWord.sentence,
    );
    if (
      existing?.meaning &&
      existing.meaning !== "查看上下文理解用法" &&
      isUsablePhonetic(existing.phonetic)
    ) {
      renderPanelPhonetic(existing.phonetic);
      elements.wordLookupStatus.textContent = "已从阅读生词本读取释义";
      renderMeanings([existing.meaning]);
      activeWord.item = { ...existing };
      activeWord.meanings = [existing.meaning];
      return;
    }

    const run = ++state.lookupRun;
    let localData =
      existing?.meaning && existing.meaning !== "查看上下文理解用法"
        ? {
            translations: [existing.meaning],
            definitions: [],
            phonetic: isUsablePhonetic(existing.phonetic),
          }
        : null;
    try {
      const localEntry = await lookupLocalEntry(activeWord.phrase);
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      if (localEntry?.meaning) {
        localData = {
          translations: [
            ...(localData?.translations || []),
            localEntry.meaning,
          ].filter(
            (meaning, index, list) => meaning && list.indexOf(meaning) === index,
          ),
          definitions: [],
          phonetic:
            isUsablePhonetic(localEntry.phonetic) ||
            isUsablePhonetic(localData?.phonetic),
          source: localEntry.source,
        };
        if (localData.phonetic) {
          const meanings = localData.translations;
          activeWord.meanings = meanings;
          activeWord.item.phonetic =
            isUsablePhonetic(localData.phonetic) ||
            isUsablePhonetic(activeWord.item.phonetic);
          activeWord.item.meaning = getCombinedMeaning(meanings, "");
          renderPanelPhonetic(localData.phonetic);
          elements.wordLookupStatus.textContent = `已从本地词库读取释义与音标（${localEntry.source}）`;
          renderMeanings(meanings);
          return;
        }
      }

      const data = await fetchWordData(activeWord.phrase);
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }

      if (localData) {
        const merged = mergeWordData(localData, data);
        const meanings = merged.translations;
        activeWord.meanings = meanings.slice(0, 8);
        activeWord.item.phonetic =
          isUsablePhonetic(merged.phonetic) ||
          isUsablePhonetic(activeWord.item.phonetic);
        activeWord.item.meaning = getCombinedMeaning(activeWord.meanings, "");
        renderPanelPhonetic(
          isUsablePhonetic(merged.phonetic) || activeWord.item.phonetic,
        );
        elements.wordLookupStatus.textContent = merged.phonetic
          ? "本地词库释义，在线词典已补充音标"
          : "本地词库释义；在线词典暂未提供音标";
        renderMeanings(activeWord.meanings);
        return;
      }

      const meanings = [
        ...(Array.isArray(data.translations) ? data.translations : []),
        ...(Array.isArray(data.definitions) ? data.definitions : []),
      ].filter((meaning, index, list) => meaning && list.indexOf(meaning) === index);

      activeWord.meanings = meanings.slice(0, 8);
      activeWord.item.phonetic =
        isUsablePhonetic(data.phonetic) ||
        isUsablePhonetic(activeWord.item.phonetic);
      activeWord.item.meaning = getCombinedMeaning(activeWord.meanings, "");
      renderPanelPhonetic(
        isUsablePhonetic(data.phonetic) || activeWord.item.phonetic,
      );
      elements.wordLookupStatus.textContent = meanings.length
        ? "已查询到释义"
        : "词典没有返回释义";
      renderMeanings(activeWord.meanings);
    } catch (error) {
      if (run !== state.lookupRun || state.activeWord !== activeWord) {
        return;
      }
      if (localData) {
        const meanings = localData.translations || [];
        activeWord.meanings = meanings;
        activeWord.item.phonetic =
          isUsablePhonetic(localData.phonetic) ||
          isUsablePhonetic(activeWord.item.phonetic);
        activeWord.item.meaning = getCombinedMeaning(meanings, "");
        renderPanelPhonetic(
          isUsablePhonetic(localData.phonetic) || activeWord.item.phonetic,
        );
        elements.wordLookupStatus.textContent =
          "已读取本地释义；在线音标暂时不可用";
        renderMeanings(meanings);
        return;
      }
      renderPanelPhonetic(activeWord.item.phonetic);
      elements.wordLookupStatus.textContent = `${error.message || "查询失败"}，可手动补充释义`;
      renderMeanings(activeWord.meanings);
    }
  }

  function updateWordPanelMarkState() {
    const document = getActiveDocument();
    const activeWord = state.activeWord;
    if (!document || !activeWord) {
      return;
    }
    const key = getItemKey(document.id, activeWord.item);
    const isUnknown = state.unknown.has(key);
    const isKnown = state.known.has(key);
    elements.markUnknownButton.classList.toggle("is-active", isUnknown);
    elements.markKnownButton.classList.toggle("is-active", isKnown);
    elements.markUnknownButton.setAttribute("aria-pressed", String(isUnknown));
    elements.markKnownButton.setAttribute("aria-pressed", String(isKnown));
  }

  function closeWordPanel() {
    state.lookupRun += 1;
    state.activeWord = null;
    elements.wordPanel.hidden = true;
    elements.wordPanel.setAttribute("aria-hidden", "true");
    document.body.classList.remove("has-word-panel");
  }

  function openWordFromToken(button) {
    const document = getActiveDocument();
    if (!document) {
      return;
    }
    const paragraph = getParagraphById(document, button.dataset.paragraphId);
    if (!paragraph) {
      return;
    }
    const phrase = button.dataset.word;
    const existing = getWordEntry(document, phrase, paragraph.english);
    const item = getWordItem(document, phrase, paragraph.english, existing);
    if (existing) {
      item.id = existing.id;
    }
    openWordPanel(phrase, paragraph.english, paragraph.id, item);
    lookupActiveWord();
  }

  function saveActiveWordMark(mark) {
    const document = getActiveDocument();
    const activeWord = state.activeWord;
    if (!document || !activeWord) {
      return;
    }

    const note = elements.wordNoteInput.value.trim();
    const meanings = activeWord.meanings || [];
    const item = {
      ...activeWord.item,
      id: activeWord.item.id || makeWordId(activeWord.phrase, activeWord.sentence),
      phrase: activeWord.phrase,
      sentence: activeWord.sentence,
      translation: activeWord.translation,
      meaning:
        getCombinedMeaning(meanings, note) ||
        activeWord.item.meaning ||
        "查看上下文理解用法",
      addedAt: activeWord.item.addedAt || Date.now(),
      phonetic:
        isUsablePhonetic(activeWord.item.phonetic) ||
        isUsablePhonetic(elements.wordPanelPhonetic.textContent),
    };

    const words = document.words.filter((word) => word.id !== item.id);
    words.push(item);
    const saved = saveReadingDocument({ ...document, words });
    if (!saved) {
      showToast("保存失败，请检查浏览器存储空间");
      return;
    }

    const wordKey = getItemKey(saved.id, item);
    if (mark === "unknown") {
      state.known.delete(wordKey);
      state.unknown.add(wordKey);
    } else {
      state.unknown.delete(wordKey);
      state.known.add(wordKey);
    }
    persistSet(STORAGE_KEYS.known, state.known);
    persistSet(STORAGE_KEYS.unknown, state.unknown);
    state.documents = getReadingDocuments();
    state.activeDocumentId = saved.id;
    state.activeWord.item = item;
    renderReadingList();
    updateDocumentStats(saved);
    updateReaderMarks();
    updateWordPanelMarkState();
    showToast(
      mark === "unknown"
        ? `${item.phrase} 已加入${saved.category}不会`
        : `${item.phrase} 已标记为掌握`,
    );
  }

  function deleteActiveDocument() {
    const document = getActiveDocument();
    if (!document) {
      return;
    }
    if (!window.confirm(`确定删除“${document.title}”吗？已标记的卡片也会从复习中移除。`)) {
      return;
    }

    const keys = new Set(
      document.words.map((word) => getItemKey(document.id, word)),
    );
    keys.forEach((key) => {
      state.known.delete(key);
      state.unknown.delete(key);
    });
    persistSet(STORAGE_KEYS.known, state.known);
    persistSet(STORAGE_KEYS.unknown, state.unknown);
    deleteReadingDocument(document.id);
    state.documents = getReadingDocuments();
    state.activeDocumentId = state.documents[0]?.id || "";
    closeWordPanel();
    if (state.activeDocumentId) {
      renderReadingList();
      renderActiveDocument();
    } else {
      renderReadingList();
      showUploadPanel();
    }
    showToast("题目已删除");
  }

  function buildTranslationBatches(paragraphs) {
    const batches = [];
    let current = [];
    let currentLength = 0;
    paragraphs.forEach((paragraph) => {
      const length = paragraph.english.length;
      if (
        current.length > 0 &&
        (current.length >= TRANSLATION_BATCH_ITEMS ||
          currentLength + length > TRANSLATION_BATCH_CHARACTERS)
      ) {
        batches.push(current);
        current = [];
        currentLength = 0;
      }
      current.push(paragraph);
      currentLength += length;
    });
    if (current.length) {
      batches.push(current);
    }
    return batches;
  }

  async function translateActiveDocument() {
    let document = getActiveDocument();
    if (!document || elements.translateButton.disabled) {
      return;
    }

    const missing = document.paragraphs.filter(
      (paragraph) => !paragraph.chinese,
    );
    if (missing.length === 0) {
      document.paragraphs.forEach((paragraph) => {
        paragraph.chinese = "";
      });
      saveReadingDocument(document);
      state.documents = getReadingDocuments();
      renderActiveDocument();
      showToast("已清除旧翻译，可以重新翻译");
      return;
    }

    const run = ++state.translationRun;
    const batches = buildTranslationBatches(missing);
    let completed = 0;
    let failedCount = 0;
    setTranslationBusy(true);
    elements.translationProgressBar.style.width = "3%";

    try {
      for (const batch of batches) {
        const response = await fetch("./api/translate", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts: batch.map((paragraph) => paragraph.english),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (run !== state.translationRun) {
          return;
        }
        if (!response.ok || !data.ok) {
          throw new Error(data.message || "翻译服务暂时不可用");
        }

        const translations = Array.isArray(data.translations)
          ? data.translations
          : [];
        batch.forEach((paragraph, index) => {
          const translation = String(translations[index] || "").trim();
          if (translation) {
            paragraph.chinese = translation;
            const node = elements.readerContent.querySelector(
              `.reader-translation[data-paragraph-id="${paragraph.id}"]`,
            );
            if (node) {
              node.textContent = translation;
              node.classList.remove("is-empty");
            }
          } else {
            failedCount += 1;
          }
        });

        const saved = saveReadingDocument(document);
        if (saved) {
          document = saved;
          state.activeDocumentId = saved.id;
        }
        completed += batch.length;
        const progress = Math.round(
          (completed / Math.max(1, missing.length)) * 100,
        );
        elements.translationProgressBar.style.width = `${Math.min(
          100,
          progress,
        )}%`;
      }

      state.documents = getReadingDocuments();
      const savedDocument = getActiveDocument();
      if (savedDocument) {
        updateDocumentStats(savedDocument);
        updateTranslationButton(savedDocument);
      }
      showToast(
        failedCount
          ? `已完成翻译，${failedCount} 段暂时失败`
          : "全文翻译完成",
      );
    } catch (error) {
      if (run === state.translationRun) {
        showToast(error.message || "翻译失败，请稍后重试");
      }
    } finally {
      if (run === state.translationRun) {
        setTranslationBusy(false);
      }
    }
  }

  function getPreferredVoice() {
    if (!("speechSynthesis" in window)) {
      return null;
    }
    const voices = Array.from(window.speechSynthesis.getVoices() || []);
    return (
      voices.find((voice) => /^en-US$/i.test(voice.lang)) ||
      voices.find((voice) => /^en[-_]/i.test(voice.lang)) ||
      voices.find((voice) => /english/i.test(voice.name)) ||
      null
    );
  }

  function stopSpeech() {
    state.speechRun += 1;
    state.allSpeaking = false;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    elements.readAllButton.classList.remove("is-playing");
    elements.readAllButton.textContent = "全文播放";
    elements.readAllButton.setAttribute("aria-pressed", "false");
    elements.readerContent.querySelectorAll(".paragraph-read-button").forEach(
      (button) => button.classList.remove("is-playing"),
    );
  }

  function speakText(text, run, onDone) {
    if (
      run !== state.speechRun ||
      !("speechSynthesis" in window) ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      return false;
    }
    const utterance = new window.SpeechSynthesisUtterance(String(text || "").trim());
    const voice = getPreferredVoice();
    utterance.lang = voice?.lang || "en-US";
    utterance.voice = voice;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.onend = onDone;
    utterance.onerror = onDone;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  function speakWord() {
    const activeWord = state.activeWord;
    if (!activeWord) {
      return;
    }
    stopSpeech();
    const run = state.speechRun;
    if (!speakText(activeWord.phrase, run)) {
      showToast("当前浏览器不支持语音朗读");
    }
  }

  function readAll() {
    const document = getActiveDocument();
    if (!document) {
      return;
    }
    if (state.allSpeaking) {
      stopSpeech();
      return;
    }
    stopSpeech();
    const run = state.speechRun;
    const texts = document.paragraphs.map((paragraph) => paragraph.english);
    if (
      !texts.length ||
      !("speechSynthesis" in window) ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }

    state.allSpeaking = true;
    elements.readAllButton.classList.add("is-playing");
    elements.readAllButton.textContent = "停止播放";
    elements.readAllButton.setAttribute("aria-pressed", "true");

    const finishAll = (message) => {
      if (run !== state.speechRun) {
        return;
      }
      state.allSpeaking = false;
      elements.readAllButton.classList.remove("is-playing");
      elements.readAllButton.textContent = "全文播放";
      elements.readAllButton.setAttribute("aria-pressed", "false");
      if (message) {
        showToast(message);
      }
    };

    // 一次排队整段文本，段落之间不再插 120ms 延时，暂停 / 重播走统一控制条。
    if (typeof window.IballSpeech?.speakSequence === "function") {
      const started = window.IballSpeech.speakSequence(texts, {
        label: "全文播放",
        rate: 0.9,
        onFinish: (message) => finishAll(message || "全文播放完成"),
        onError: () => finishAll("全文播放中止，请稍后重试"),
        onUnsupported: () => finishAll("当前浏览器不支持语音朗读"),
      });
      if (!started) {
        finishAll("当前浏览器不支持语音朗读");
      }
      return;
    }

    let index = 0;

    const next = () => {
      if (run !== state.speechRun || !state.allSpeaking) {
        return;
      }
      if (index >= texts.length) {
        finishAll("全文播放完成");
        return;
      }
      const current = index;
      index += 1;
      if (!speakText(texts[current], run, () => window.setTimeout(next, 120))) {
        stopSpeech();
        showToast("当前浏览器不支持语音朗读");
      }
    };
    next();
  }

  function readParagraph(paragraphId) {
    const document = getActiveDocument();
    const paragraph = document
      ? getParagraphById(document, paragraphId)
      : null;
    if (!paragraph) {
      return;
    }
    stopSpeech();
    const run = state.speechRun;
    const button = elements.readerContent.querySelector(
      `.paragraph-read-button[data-speak-paragraph="${paragraphId}"]`,
    );
    button?.classList.add("is-playing");
    if (
      !speakText(paragraph.english, run, () => {
        button?.classList.remove("is-playing");
      })
    ) {
      button?.classList.remove("is-playing");
      showToast("当前浏览器不支持语音朗读");
    }
  }

  function onReaderClick(event) {
    const wordButton = event.target.closest(".word-token");
    if (wordButton) {
      openWordFromToken(wordButton);
      return;
    }
    const readButton = event.target.closest(".paragraph-read-button");
    if (readButton) {
      readParagraph(readButton.dataset.speakParagraph);
    }
  }

  function bindEvents() {
    elements.newReadingButton.addEventListener("click", showUploadPanel);
    elements.sidebarNewButton.addEventListener("click", showUploadPanel);
    elements.uploadForm.addEventListener("submit", createNewDocument);
    elements.clearUploadButton.addEventListener("click", () => {
      elements.uploadForm.reset();
      elements.fileLabel.textContent = "TXT / Markdown / DOCX / PDF";
      setUploadStatus("");
      elements.readingTitle.focus();
    });
    elements.readingFile.addEventListener("change", (event) => {
      importFile(event.target.files?.[0]).catch((error) => {
        setUploadStatus(error.message || "文件读取失败。", true);
      });
    });
    elements.fileDropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      elements.fileDropZone.classList.add("is-dragging");
    });
    elements.fileDropZone.addEventListener("dragleave", () => {
      elements.fileDropZone.classList.remove("is-dragging");
    });
    elements.fileDropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      elements.fileDropZone.classList.remove("is-dragging");
      importFile(event.dataTransfer?.files?.[0]).catch((error) => {
        setUploadStatus(error.message || "文件读取失败。", true);
      });
    });
    elements.displayModeButtons.forEach((button) => {
      button.addEventListener("click", () =>
        setDisplayMode(button.dataset.displayMode),
      );
    });
    elements.readerContent.addEventListener("click", onReaderClick);
    elements.translateButton.addEventListener("click", translateActiveDocument);
    elements.readAllButton.addEventListener("click", readAll);
    elements.speakWordButton.addEventListener("click", speakWord);
    elements.closeWordPanelButton.addEventListener("click", closeWordPanel);
    elements.markUnknownButton.addEventListener("click", () =>
      saveActiveWordMark("unknown"),
    );
    elements.markKnownButton.addEventListener("click", () =>
      saveActiveWordMark("known"),
    );
    elements.deleteReadingButton.addEventListener(
      "click",
      deleteActiveDocument,
    );
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeWordPanel();
      }
    });
    window.addEventListener("pagehide", stopSpeech);
  }

  async function checkSession() {
    try {
      const response = await fetch("./api/auth", {
        credentials: "same-origin",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.authenticated) {
        window.location.replace("./index.html");
        return false;
      }
      return true;
    } catch {
      showToast("登录状态检查失败，请刷新页面重试");
      return false;
    }
  }

  async function initialize() {
    state.documents = getReadingDocuments();
    renderReadingList();
    bindEvents();
    await checkSession();
  }

  window.readingApp = {
    state,
    elements,
    importFile,
    openDocument,
    translateActiveDocument,
    saveActiveWordMark,
    splitIntoParagraphs,
  };

  initialize();
})();
