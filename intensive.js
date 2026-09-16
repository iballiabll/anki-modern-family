(() => {
  "use strict";

  const data = window.IBALL_INTENSIVE_DATA;
  const elements = {
    readingProgress: document.querySelector("#readingProgress"),
    sourceLink: document.querySelector("#sourceLink"),
    heroStats: document.querySelector("#heroStats"),
    pieceNavigation: document.querySelector("#pieceNavigation"),
    content: document.querySelector("#intensiveContent"),
    grammarToggleButton: document.querySelector("#grammarToggleButton"),
    readAllButton: document.querySelector("#readAllButton"),
    toast: document.querySelector("#toast"),
    displayModeButtons: document.querySelectorAll("[data-display-mode]"),
    heroEyebrow: document.querySelector(".hero-eyebrow"),
    heroDescription: document.querySelector(".hero-description"),
  };

  let toastTimer = 0;
  let speechRun = 0;
  let activeSpeechButton = null;
  let activeSequenceButton = null;
  let allSpeaking = false;
  let voices = [];
  let scrollFrame = 0;

  function showToast(message) {
    if (!elements.toast) {
      return;
    }

    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 2200);
  }

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
    elements.readAllButton.classList.toggle("is-playing", allSpeaking);
    elements.readAllButton.textContent = allSpeaking ? "停止播放" : "全文播放";
    elements.readAllButton.setAttribute("aria-pressed", String(allSpeaking));
  }

  function stopSpeech() {
    speechRun += 1;
    allSpeaking = false;
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
      runId !== speechRun ||
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
        runId === speechRun &&
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
    const runId = speechRun;
    setSpeechButtonState(button, true);

    const started = speakText(
      text,
      runId,
      () => {
        if (runId === speechRun) {
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
    if (allSpeaking) {
      stopSpeech();
      showToast("已停止播放");
      return;
    }

    stopSpeech();
    if (
      !texts.length ||
      !("speechSynthesis" in window) ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      showToast("当前浏览器不支持语音朗读");
      return;
    }

    const runId = speechRun;
    let index = 0;
    allSpeaking = true;
    if (triggerButton) {
      activeSequenceButton = triggerButton;
      triggerButton.classList.add("is-playing");
    }
    updateReadAllButton();

    const finish = (message = "") => {
      if (runId !== speechRun) {
        return;
      }
      allSpeaking = false;
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
      if (runId !== speechRun || !allSpeaking) {
        return;
      }
      if (index >= texts.length) {
        finish("播放完成");
        return;
      }

      const started = speakText(
        texts[index],
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

  function setDisplayMode(mode) {
    const englishOnly = mode === "english";
    document.body.classList.toggle("is-english-only", englishOnly);

    elements.displayModeButtons.forEach((button) => {
      const active = button.dataset.displayMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    try {
      window.localStorage.setItem(
        "iball-intensive-display-mode",
        englishOnly ? "english" : "bilingual",
      );
    } catch {
      // Reading mode still works when storage is unavailable.
    }
  }

  function getGrammarNotes() {
    return Array.from(
      elements.content?.querySelectorAll("details.grammar-note") || [],
    );
  }

  function updateGrammarToggle() {
    const notes = getGrammarNotes();
    const allOpen =
      notes.length > 0 && notes.every((note) => note.open);
    if (elements.grammarToggleButton) {
      elements.grammarToggleButton.textContent = allOpen
        ? "收起全部语法"
        : "展开全部语法";
      elements.grammarToggleButton.setAttribute(
        "aria-pressed",
        String(allOpen),
      );
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
    title.textContent = piece.title;

    const meta = document.createElement("span");
    meta.textContent = `${piece.section} · ${piece.questionRange}`;

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
    sentence.textContent =
      item.sentence || item.location || "点击查看语法拆解";

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

  function createParagraphRow(paragraph, piece) {
    const row = document.createElement("div");
    row.className = "paragraph-row";
    row.classList.toggle("has-grammar", paragraph.grammar.length > 0);
    row.dataset.paragraphNumber = String(paragraph.number);
    row.dataset.grammarCount = String(paragraph.grammar.length);

    const number = document.createElement("span");
    number.className = "paragraph-number";
    number.textContent = String(paragraph.number).padStart(2, "0");
    number.setAttribute("aria-label", `第 ${paragraph.number} 段`);

    const toolbar = document.createElement("div");
    toolbar.className = "paragraph-toolbar";

    const grammarCount = document.createElement("span");
    grammarCount.className = "grammar-count";
    grammarCount.textContent = paragraph.grammar.length
      ? `${paragraph.grammar.length} 处语法`
      : "";

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "paragraph-play-button";
    playButton.textContent = "播放本段";
    playButton.setAttribute(
      "aria-label",
      `播放第 ${paragraph.number} 段英文`,
    );
    playButton.addEventListener("click", () => {
      playParagraph(paragraph.english, playButton);
    });

    const english = document.createElement("p");
    english.className = "paragraph-english";
    english.lang = "en";
    english.textContent = paragraph.english;

    const chinese = document.createElement("p");
    chinese.className = "paragraph-chinese";
    chinese.lang = "zh-CN";
    chinese.textContent = paragraph.chinese;

    toolbar.append(grammarCount, playButton);
    row.append(number, toolbar, english, chinese);

    if (paragraph.grammar.length) {
      const grammarList = document.createElement("div");
      grammarList.className = "grammar-list";
      paragraph.grammar.forEach((item) => {
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

    const head = document.createElement("header");
    head.className = "piece-head";

    const copy = document.createElement("div");
    copy.className = "piece-head-copy";

    const kicker = document.createElement("p");
    kicker.className = "piece-kicker";

    const sectionName = document.createElement("span");
    sectionName.textContent = piece.section;

    const type = document.createElement("span");
    type.className = "piece-type";
    const sectionKey = piece.section.match(/[ABC]$/)?.[0]?.toLowerCase();
    if (sectionKey) {
      type.classList.add(`is-section-${sectionKey}`);
    }
    type.textContent = piece.type;

    const questionRange = document.createElement("span");
    questionRange.textContent = piece.questionRange;
    kicker.append(sectionName, type, questionRange);

    const title = document.createElement("h2");
    title.textContent = piece.title;

    const paragraphGrammarCount = piece.paragraphs.reduce(
      (total, paragraph) => total + paragraph.grammar.length,
      0,
    );
    const grammarTotal =
      paragraphGrammarCount + piece.extensionGrammar.length;
    const meta = document.createElement("p");
    meta.className = "piece-meta";
    meta.textContent = `${String(index + 1).padStart(2, "0")} · ${piece.paragraphs.length} 段 · ${grammarTotal} 处语法`;

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "piece-play-button";
    playButton.textContent = "播放本篇";
    playButton.setAttribute("aria-label", `播放${piece.title}英文全文`);
    playButton.addEventListener("click", () => {
      playSequence(
        piece.paragraphs.map((paragraph) => paragraph.english),
        playButton,
      );
    });

    copy.append(kicker, title, meta);
    head.append(copy, playButton);

    const paragraphList = document.createElement("div");
    paragraphList.className = "paragraph-list";
    piece.paragraphs.forEach((paragraph) => {
      paragraphList.append(createParagraphRow(paragraph, piece));
    });

    section.append(head, paragraphList);

    if (piece.extensionGrammar.length) {
      const extension = document.createElement("section");
      extension.className = "extension-section";

      const heading = document.createElement("div");
      heading.className = "extension-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "延伸语法";

      const headingMeta = document.createElement("span");
      headingMeta.textContent = `${piece.extensionGrammar.length} 处补充`;

      heading.append(headingTitle, headingMeta);
      extension.append(heading);
      piece.extensionGrammar.forEach((item) => {
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

    const state = document.createElement("div");
    state.className = "error-state";

    const title = document.createElement("strong");
    title.textContent = "精读内容暂时无法显示";

    const copy = document.createElement("span");
    copy.textContent = message;

    state.append(title, copy);
    elements.content.replaceChildren(state);
    elements.pieceNavigation?.replaceChildren();
    elements.heroStats?.replaceChildren();
  }

  function updateReadingState() {
    const documentElement = document.documentElement;
    const maxScroll =
      documentElement.scrollHeight - documentElement.clientHeight;
    const ratio =
      maxScroll > 0
        ? Math.min(1, Math.max(0, window.scrollY / maxScroll))
        : 0;

    if (elements.readingProgress) {
      elements.readingProgress.style.transform = `scaleX(${ratio})`;
    }

    const pieces = data?.pieces || [];
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
    if (!data || !Array.isArray(data.pieces) || data.pieces.length === 0) {
      renderError("没有读取到听力精读数据。");
      return;
    }

    const pieces = data.pieces;
    const paragraphCount = pieces.reduce(
      (total, piece) => total + piece.paragraphs.length,
      0,
    );
    const grammarCount = pieces.reduce(
      (total, piece) =>
        total +
        piece.paragraphs.reduce(
          (subtotal, paragraph) => subtotal + paragraph.grammar.length,
          0,
        ) +
        piece.extensionGrammar.length,
      0,
    );

    document.title = `${data.meta?.title || "听力全文"} · 语法精读 · iball的小屋`;
    if (elements.heroEyebrow) {
      elements.heroEyebrow.textContent =
        data.meta?.title || "CET-4 LISTENING INTENSIVE";
    }
    if (elements.heroDescription) {
      elements.heroDescription.textContent =
        data.meta?.subtitle ||
        "逐段对照翻译，难点句子点击展开语法拆解。";
    }
    if (elements.sourceLink && data.meta?.sourceUrl) {
      elements.sourceLink.href = data.meta.sourceUrl;
    }

    elements.heroStats?.replaceChildren(
      createStat(pieces.length, "篇听力"),
      createStat(paragraphCount, "段原文"),
      createStat(grammarCount, "处语法"),
    );

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

    try {
      const savedMode = window.localStorage.getItem(
        "iball-intensive-display-mode",
      );
      setDisplayMode(savedMode === "english" ? "english" : "bilingual");
    } catch {
      setDisplayMode("bilingual");
    }

    updateGrammarToggle();
    updateReadingState();
  }

  elements.displayModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setDisplayMode(button.dataset.displayMode);
    });
  });

  elements.grammarToggleButton?.addEventListener("click", toggleAllGrammar);
  elements.readAllButton?.addEventListener("click", () => {
    playSequence(
      (data?.pieces || []).flatMap((piece) =>
        piece.paragraphs.map((paragraph) => paragraph.english),
      ),
      elements.readAllButton,
    );
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

  window.addEventListener("scroll", requestReadingStateUpdate, {
    passive: true,
  });
  window.addEventListener("resize", requestReadingStateUpdate);
  window.addEventListener("beforeunload", stopSpeech);

  if ("speechSynthesis" in window) {
    refreshVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoices);
  }

  try {
    renderPage();
  } catch (error) {
    console.error(error);
    renderError("页面初始化时发生错误，请刷新后重试。");
  }
})();
