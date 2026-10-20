(function () {
  "use strict";

  const Deck = window.IballDeck;
  if (!Deck) {
    document.body.textContent = "卡片数据加载失败，请刷新页面。";
    return;
  }

  const {
    DEFAULT_UNIT_SIZE,
    STORAGE_KEYS,
    buildDeckUnits,
    buildReviewQueue,
    computeReviewSchedule,
    fetchLibrary,
    formatReviewInterval,
    getItemKey,
    getReviewDayKey,
    persistSet,
    readJson,
    restoreSet,
    writeJson,
  } = Deck;

  const SWIPE_THRESHOLD = 68;
  const SWIPE_VELOCITY = 0.42;
  const AUTO_ADVANCE_DELAY = 260;

  const state = {
    categories: [],
    resources: [],
    decks: new Map(),
    scope: "all",
    category: "all",
    section: "all",
    resourceId: "all",
    unitKey: "all",
    limit: 50,
    queue: [],
    queueSummary: null,
    index: 0,
    revealed: false,
    completed: false,
    known: restoreSet(STORAGE_KEYS.known),
    unknown: restoreSet(STORAGE_KEYS.unknown),
    progress: {},
    daily: { date: "", reviewedKeys: [], newKeys: [] },
    drag: null,
    autoAdvanceTimer: 0,
    toastTimer: 0,
    wheelTimer: 0,
    suppressClick: false,
  };

  const elements = {
    scopeTitle: document.querySelector("#scopeTitle"),
    scopeMeta: document.querySelector("#scopeMeta"),
    scopeToggleButton: document.querySelector("#scopeToggleButton"),
    scopeControls: document.querySelector("#scopeControls"),
    categorySelect: document.querySelector("#categorySelect"),
    sectionSelect: document.querySelector("#sectionSelect"),
    resourceSelect: document.querySelector("#resourceSelect"),
    unitSelect: document.querySelector("#unitSelect"),
    limitSelect: document.querySelector("#limitSelect"),
    queueStatus: document.querySelector("#queueStatus"),
    positionLabel: document.querySelector("#positionLabel"),
    reviewProgressBar: document.querySelector("#reviewProgressBar"),
    reviewStage: document.querySelector("#reviewStage"),
    reviewCard: document.querySelector("#reviewCard"),
    cardDeck: document.querySelector("#cardDeck"),
    speakButton: document.querySelector("#speakButton"),
    cardWord: document.querySelector("#cardWord"),
    cardPhonetic: document.querySelector("#cardPhonetic"),
    cardAnswer: document.querySelector("#cardAnswer"),
    cardMeaning: document.querySelector("#cardMeaning"),
    exampleBlock: document.querySelector("#exampleBlock"),
    cardSentence: document.querySelector("#cardSentence"),
    cardTranslation: document.querySelector("#cardTranslation"),
    revealButton: document.querySelector("#revealButton"),
    completionView: document.querySelector("#completionView"),
    completionTitle: document.querySelector("#completionTitle"),
    completionCopy: document.querySelector("#completionCopy"),
    completionRestartButton: document.querySelector(
      "#completionRestartButton",
    ),
    emptyView: document.querySelector("#emptyView"),
    emptyTitle: document.querySelector("#emptyTitle"),
    emptyCopy: document.querySelector("#emptyCopy"),
    previousButton: document.querySelector("#previousButton"),
    unknownButton: document.querySelector("#unknownButton"),
    knownButton: document.querySelector("#knownButton"),
    nextButton: document.querySelector("#nextButton"),
    restartButton: document.querySelector("#restartButton"),
    reviewMessage: document.querySelector("#reviewMessage"),
    toast: document.querySelector("#toast"),
  };

  function compareCategoryNames(left, right) {
    const order = ["0基础", "四级", "六级", "考研", "电影", "其他"];
    const leftIndex = order.indexOf(left);
    const rightIndex = order.indexOf(right);
    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex - rightIndex;
    }
    if (leftIndex >= 0) {
      return -1;
    }
    if (rightIndex >= 0) {
      return 1;
    }
    return left.localeCompare(right, "zh-CN");
  }

  function getResourceItems(resource) {
    return resource ? state.decks.get(resource.id) || [] : [];
  }

  function getResourceById(resourceId) {
    return state.resources.find((resource) => resource.id === resourceId);
  }

  function getScopedResources() {
    return state.resources
      .filter((resource) => !resource.attachment)
      .filter(
        (resource) =>
          state.scope !== "unknown" ||
          getResourceItems(resource).some((item) =>
            state.unknown.has(getItemKey(resource.id, item)),
          ),
      )
      .filter(
        (resource) =>
          state.category === "all" || resource.category === state.category,
      )
      .filter(
        (resource) =>
          state.category === "all" ||
          state.section === "all" ||
          (resource.section || "") === state.section,
      )
      .filter(
        (resource) =>
          state.resourceId === "all" || resource.id === state.resourceId,
      );
  }

  function getScopedEntries() {
    const resources = getScopedResources();
    const selectedResource = getResourceById(state.resourceId);
    if (selectedResource && state.unitKey !== "all") {
      const unit = buildDeckUnits(getResourceItems(selectedResource)).find(
        (item) => item.key === state.unitKey,
      );
      if (unit && unit.index > 0) {
        return unit.items
          .filter(
            (item) =>
              state.scope !== "unknown" ||
              state.unknown.has(getItemKey(selectedResource.id, item)),
          )
          .map((item) => ({
            item,
            resource: selectedResource,
          }));
      }
    }

    return resources.flatMap((resource) =>
      getResourceItems(resource)
        .filter(
          (item) =>
            state.scope !== "unknown" ||
            state.unknown.has(getItemKey(resource.id, item)),
        )
        .map((item) => ({ item, resource })),
    );
  }

  function getScopeTitle() {
    const parts = [];
    if (state.scope === "unknown") {
      parts.push("不会复习");
    }
    parts.push(state.category === "all" ? "整个素材库" : state.category);
    if (state.category !== "all" && state.section !== "all") {
      parts.push(state.section);
    }
    const resource = getResourceById(state.resourceId);
    if (resource) {
      parts.push(resource.title);
      if (state.unitKey !== "all") {
        const unit = buildDeckUnits(getResourceItems(resource)).find(
          (item) => item.key === state.unitKey,
        );
        if (unit) {
          parts.push(unit.label);
        }
      }
    }
    return parts.join(" · ");
  }

  function getScopeMeta() {
    const entries = getScopedEntries();
    const dailyLabel = state.daily.reviewedKeys.length
      ? `今日已复习 ${state.daily.reviewedKeys.length} 张`
      : "今日尚未复习";
    return `${entries.length} 张卡片 · ${dailyLabel}`;
  }

  function restoreReviewData() {
    const progress = readJson(STORAGE_KEYS.reviewProgress, {});
    state.progress =
      progress && typeof progress === "object" && !Array.isArray(progress)
        ? progress
        : {};

    const today = getReviewDayKey();
    const daily = readJson(STORAGE_KEYS.reviewDaily, {});
    if (daily && daily.date === today) {
      state.daily = {
        date: today,
        reviewedKeys: Array.isArray(daily.reviewedKeys)
          ? daily.reviewedKeys.filter((key) => typeof key === "string")
          : [],
        newKeys: Array.isArray(daily.newKeys)
          ? daily.newKeys.filter((key) => typeof key === "string")
          : [],
      };
      return;
    }
    state.daily = { date: today, reviewedKeys: [], newKeys: [] };
  }

  function persistProgress() {
    writeJson(STORAGE_KEYS.reviewProgress, state.progress);
  }

  function persistDaily() {
    writeJson(STORAGE_KEYS.reviewDaily, state.daily);
  }

  function readScopeFromUrl() {
    const params = new URLSearchParams(window.location.search);
    state.scope = params.get("scope") === "unknown" ? "unknown" : "all";
    state.category = params.get("category") || "all";
    state.section = params.get("section") || "all";
    state.resourceId = params.get("resource") || "all";
    state.unitKey = params.get("unit") || "all";

    const limit = params.get("limit");
    if (limit === "all") {
      state.limit = Number.POSITIVE_INFINITY;
    } else if (Number(limit) > 0) {
      state.limit = Math.max(1, Number(limit));
    }
  }

  function syncScopeToUrl() {
    const url = new URL(window.location.href);
    const values = {
      scope: state.scope === "unknown" ? "unknown" : "",
      category: state.category === "all" ? "" : state.category,
      section: state.section === "all" ? "" : state.section,
      resource: state.resourceId === "all" ? "" : state.resourceId,
      unit: state.unitKey === "all" ? "" : state.unitKey,
      limit:
        state.limit === Number.POSITIVE_INFINITY ? "all" : String(state.limit),
    };

    Object.entries(values).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      } else {
        url.searchParams.delete(key);
      }
    });
    window.history.replaceState(null, "", url);
  }

  function makeOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function renderCategoryOptions() {
    const categories = [...state.categories].sort(
      (left, right) =>
        compareCategoryNames(left.name, right.name),
    );
    if (
      state.category !== "all" &&
      !categories.some((category) => category.name === state.category)
    ) {
      state.category = "all";
      state.section = "all";
      state.resourceId = "all";
      state.unitKey = "all";
    }

    const fragment = document.createDocumentFragment();
    fragment.append(makeOption("all", "整个素材库"));
    categories.forEach((category) => {
      fragment.append(makeOption(category.name, category.name));
    });
    elements.categorySelect.replaceChildren(fragment);
    elements.categorySelect.value = state.category;
  }

  function renderSectionOptions() {
    const category = state.categories.find(
      (item) => item.name === state.category,
    );
    const sections = category?.sections || [];
    if (
      state.section !== "all" &&
      !sections.includes(state.section)
    ) {
      state.section = "all";
    }

    const fragment = document.createDocumentFragment();
    fragment.append(
      makeOption(
        "all",
        state.category === "all" ? "整个素材库" : "整个分类",
      ),
    );
    sections.forEach((section) => {
      fragment.append(makeOption(section, section));
    });
    elements.sectionSelect.replaceChildren(fragment);
    elements.sectionSelect.value = state.section;
    elements.sectionSelect.disabled =
      state.category === "all" || sections.length === 0;
  }

  function getResourcesForCurrentCategory() {
    return state.resources
      .filter((resource) => !resource.attachment)
      .filter(
        (resource) =>
          state.category === "all" || resource.category === state.category,
      )
      .filter(
        (resource) =>
          state.category === "all" ||
          state.section === "all" ||
          (resource.section || "") === state.section,
      );
  }

  function renderResourceOptions() {
    const resources = getResourcesForCurrentCategory().sort((left, right) =>
      left.title.localeCompare(right.title, "zh-CN"),
    );
    if (
      state.resourceId !== "all" &&
      !resources.some((resource) => resource.id === state.resourceId)
    ) {
      state.resourceId = "all";
      state.unitKey = "all";
    }

    if (
      state.category !== "all" &&
      state.resourceId === "all" &&
      resources.length === 1
    ) {
      state.resourceId = resources[0].id;
      state.unitKey = "all";
    }

    const fragment = document.createDocumentFragment();
    fragment.append(
      makeOption(
        "all",
        resources.length ? "当前范围内全部素材" : "暂无可抽卡素材",
      ),
    );
    resources.forEach((resource) => {
      const prefix =
        state.category === "all" ? `${resource.category} · ` : "";
      fragment.append(makeOption(resource.id, `${prefix}${resource.title}`));
    });
    elements.resourceSelect.replaceChildren(fragment);
    elements.resourceSelect.value = state.resourceId;
    elements.resourceSelect.disabled = resources.length <= 1;
  }

  function renderUnitOptions() {
    const resource = getResourceById(state.resourceId);
    const units = resource ? buildDeckUnits(getResourceItems(resource)) : [];
    const hasUnits = units.some((unit) => unit.index > 0);
    if (
      state.unitKey !== "all" &&
      !units.some((unit) => unit.key === state.unitKey && unit.index > 0)
    ) {
      state.unitKey = "all";
    }

    const fragment = document.createDocumentFragment();
    fragment.append(makeOption("all", hasUnits ? "整套" : "全部"));
    units.forEach((unit) => {
      if (unit.index < 1) {
        return;
      }
      fragment.append(makeOption(unit.key, `${unit.label} · ${unit.detail}`));
    });
    elements.unitSelect.replaceChildren(fragment);
    elements.unitSelect.value = state.unitKey;
    elements.unitSelect.disabled = !hasUnits;
  }

  function renderScopeControls() {
    renderCategoryOptions();
    renderSectionOptions();
    renderResourceOptions();
    renderUnitOptions();
    elements.limitSelect.value =
      state.limit === Number.POSITIVE_INFINITY ? "all" : String(state.limit);

    const title = getScopeTitle();
    elements.scopeTitle.textContent = title;
    elements.scopeMeta.textContent = getScopeMeta();
  }

  function getNewLimit() {
    return state.limit === Number.POSITIVE_INFINITY ? 999999 : state.limit;
  }

  function rebuildQueue() {
    window.clearTimeout(state.autoAdvanceTimer);
    const entries = getScopedEntries();
    const summary = buildReviewQueue(entries, {
      progress: state.progress,
      daily: state.daily,
      newLimit: getNewLimit(),
    });
    state.queue = summary.queue;
    state.queueSummary = summary;
    state.index = 0;
    state.revealed = false;
    state.completed = state.queue.length === 0;
    render();
  }

  function getCurrentEntry() {
    return state.queue[state.index] || null;
  }

  function getMark(entry) {
    if (!entry) {
      return "";
    }
    const key = getItemKey(entry.resource.id, entry.item);
    if (state.known.has(key)) {
      return "known";
    }
    if (state.unknown.has(key)) {
      return "unknown";
    }
    return "";
  }

  function setMark(entry, mark) {
    const key = getItemKey(entry.resource.id, entry.item);
    state.known.delete(key);
    state.unknown.delete(key);
    if (mark === "known") {
      state.known.add(key);
    } else if (mark === "unknown") {
      state.unknown.add(key);
    }
    persistSet(STORAGE_KEYS.known, state.known);
    persistSet(STORAGE_KEYS.unknown, state.unknown);
  }

  function markDaily(entry, isNew) {
    const today = getReviewDayKey();
    if (state.daily.date !== today) {
      state.daily = { date: today, reviewedKeys: [], newKeys: [] };
    }
    const cardKey = entry.item.id;
    if (!state.daily.reviewedKeys.includes(cardKey)) {
      state.daily.reviewedKeys.push(cardKey);
    }
    if (isNew && !state.daily.newKeys.includes(cardKey)) {
      state.daily.newKeys.push(cardKey);
    }
    persistDaily();
  }

  function markCurrent(mark) {
    const entry = getCurrentEntry();
    if (!entry || state.completed) {
      return;
    }

    const currentMark = getMark(entry);
    if (currentMark === mark) {
      setMark(entry, "");
      showToast(mark === "known" ? "已取消掌握" : "已取消不会");
      render();
      return;
    }

    setMark(entry, mark);
    const previous = state.progress[entry.item.id];
    const isNew = !previous || !Number(previous.reps);
    const grade = mark === "known" ? "good" : "again";
    const record = computeReviewSchedule(previous, grade, Date.now());
    state.progress[entry.item.id] = record;
    persistProgress();
    markDaily(entry, isNew);

    showToast(
      mark === "known"
        ? `已掌握 · ${formatReviewInterval(record.dueAt - Date.now())}`
        : "已加入不会 · 稍后重练",
    );
    render();

    window.clearTimeout(state.autoAdvanceTimer);
    state.autoAdvanceTimer = window.setTimeout(() => {
      if (getCurrentEntry() === entry) {
        move(1);
      }
    }, AUTO_ADVANCE_DELAY);
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      elements.toast.classList.remove("is-visible");
    }, 1600);
  }

  function speakCurrent() {
    const entry = getCurrentEntry();
    if (!entry || !("speechSynthesis" in window)) {
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(entry.item.phrase);
    const voices = window.speechSynthesis.getVoices();
    const voice =
      voices.find(
        (item) =>
          /^en-US$/i.test(item.lang) &&
          /(natural|neural|online|google|samantha|aria|jenny)/i.test(
            item.name,
          ),
      ) || voices.find((item) => /^en-US$/i.test(item.lang));
    if (voice) {
      utterance.voice = voice;
    }
    utterance.lang = "en-US";
    utterance.rate = 0.9;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function revealCurrent() {
    if (!getCurrentEntry() || state.revealed) {
      return;
    }
    state.revealed = true;
    renderCard();
  }

  function renderCard() {
    const entry = getCurrentEntry();
    const hasCard = Boolean(entry) && !state.completed;
    elements.reviewCard.hidden = !hasCard;
    elements.completionView.hidden = hasCard || !state.completed;
    elements.emptyView.hidden = hasCard || state.completed;

    [elements.previousButton, elements.nextButton].forEach((button) => {
      button.disabled = !hasCard;
    });
    [elements.unknownButton, elements.knownButton, elements.speakButton].forEach(
      (button) => {
        button.disabled = !hasCard;
      },
    );
    elements.revealButton.disabled = !hasCard || state.revealed;

    if (!hasCard) {
      if (state.completed) {
        const reviewed = state.queue.length;
        elements.completionTitle.textContent = reviewed
          ? "本轮抽卡完成"
          : "当前范围暂时没有卡片";
        elements.completionCopy.textContent = reviewed
          ? `本轮处理了 ${reviewed} 张卡片，标记和复习进度已同步。`
          : "可以调整范围，或稍后等待新的到期卡片。";
      } else {
        elements.emptyTitle.textContent = "正在准备卡片";
        elements.emptyCopy.textContent = "请稍候。";
      }
      return;
    }

    const { item, resource } = entry;
    const mark = getMark(entry);
    elements.cardDeck.textContent = `${resource.category} · ${resource.title}`;
    elements.cardWord.textContent = item.phrase || "";
    elements.cardPhonetic.textContent = item.phonetic || "";
    elements.cardPhonetic.hidden = !item.phonetic;
    elements.cardMeaning.textContent = item.meaning || "暂无释义";
    elements.cardSentence.textContent = item.sentence || "";
    elements.cardSentence.hidden = !item.sentence;
    elements.cardTranslation.textContent = item.translation || "";
    elements.cardTranslation.hidden = !item.translation;
    elements.exampleBlock.hidden = !item.sentence && !item.translation;
    elements.cardAnswer.hidden = !state.revealed;
    elements.revealButton.textContent = state.revealed
      ? "释义已显示"
      : "显示释义";

    elements.unknownButton.classList.toggle("is-active", mark === "unknown");
    elements.knownButton.classList.toggle("is-active", mark === "known");
    elements.unknownButton.textContent =
      mark === "unknown" ? "已标不会" : "不会";
    elements.knownButton.textContent = mark === "known" ? "已掌握" : "掌握";
    elements.unknownButton.setAttribute(
      "aria-pressed",
      String(mark === "unknown"),
    );
    elements.knownButton.setAttribute(
      "aria-pressed",
      String(mark === "known"),
    );

    const record = state.progress[item.id];
    elements.reviewMessage.textContent = record?.reps
      ? `已复习 ${record.reps} 次${
          record.lapses ? ` · 遗忘 ${record.lapses} 次` : ""
        }`
      : "新卡片";
  }

  function renderProgress() {
    const total = state.queue.length;
    const position = total ? Math.min(state.index + 1, total) : 0;
    const percentage = total
      ? state.completed
        ? 100
        : (state.index / total) * 100
      : 0;
    elements.positionLabel.textContent = `${position} / ${total}`;
    elements.reviewProgressBar.style.width = `${percentage}%`;

    if (state.completed) {
      elements.queueStatus.textContent = "本轮已完成";
      return;
    }
    if (!total) {
      elements.queueStatus.textContent = "没有待抽卡片";
      return;
    }
    const due = state.queueSummary?.dueCount || 0;
    const fresh = Math.max(0, total - due);
    elements.queueStatus.textContent =
      `到期 ${due} 张 · 新卡 ${fresh} 张`;
  }

  function render() {
    renderScopeControls();
    renderProgress();
    renderCard();
  }

  function clearDragStyles() {
    elements.reviewCard.classList.remove(
      "is-dragging",
      "is-settling",
      "is-entering-next",
      "is-entering-previous",
    );
    elements.reviewCard.style.transform = "";
    elements.reviewCard.style.opacity = "";
  }

  function animateCard(direction) {
    clearDragStyles();
    const className =
      direction > 0 ? "is-entering-next" : "is-entering-previous";
    elements.reviewCard.classList.add(className);
    window.setTimeout(() => {
      elements.reviewCard.classList.remove(className);
    }, 240);
  }

  function move(direction) {
    window.clearTimeout(state.autoAdvanceTimer);
    if (!state.queue.length) {
      return;
    }
    if (direction > 0 && state.completed) {
      return;
    }
    if (direction > 0 && state.index >= state.queue.length - 1) {
      state.index = state.queue.length;
      state.completed = true;
      state.revealed = false;
      render();
      animateCard(1);
      return;
    }
    if (direction < 0) {
      if (state.completed) {
        state.index = state.queue.length - 1;
        state.completed = false;
      } else if (state.index > 0) {
        state.index -= 1;
      } else {
        resetDragPosition();
        return;
      }
    } else {
      state.index += 1;
    }
    state.revealed = false;
    render();
    animateCard(direction);
  }

  function resetDragPosition() {
    elements.reviewCard.classList.add("is-settling");
    elements.reviewCard.style.transform = "";
    window.setTimeout(() => {
      elements.reviewCard.classList.remove("is-settling");
    }, 200);
  }

  function onPointerDown(event) {
    if (
      event.button !== 0 ||
      !getCurrentEntry() ||
      event.target.closest("button, a, select")
    ) {
      return;
    }
    state.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: performance.now(),
      moved: false,
    };
    elements.reviewCard.setPointerCapture(event.pointerId);
    elements.reviewCard.classList.add("is-dragging");
  }

  function onPointerMove(event) {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaY) > 8 || Math.abs(deltaX) > 8) {
      drag.moved = true;
    }
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      return;
    }
    drag.lastY = event.clientY;
    drag.lastAt = performance.now();
    elements.reviewCard.style.transform = `translateY(${deltaY}px) rotate(${Math.max(
      -1.8,
      Math.min(1.8, deltaY / 90),
    )}deg)`;
    elements.reviewCard.style.opacity = String(
      Math.max(0.58, 1 - Math.abs(deltaY) / 720),
    );
  }

  function endPointerDrag(event) {
    const drag = state.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaY = event.clientY - drag.startY;
    const elapsed = Math.max(1, performance.now() - drag.lastAt);
    const velocity = deltaY / elapsed;
    const shouldMove =
      Math.abs(deltaY) >= SWIPE_THRESHOLD ||
      (Math.abs(velocity) >= SWIPE_VELOCITY && Math.abs(deltaY) >= 24);
    state.suppressClick = drag.moved;
    state.drag = null;
    if (elements.reviewCard.hasPointerCapture(event.pointerId)) {
      elements.reviewCard.releasePointerCapture(event.pointerId);
    }
    elements.reviewCard.classList.remove("is-dragging");

    if (shouldMove) {
      move(deltaY < 0 ? 1 : -1);
      return;
    }
    resetDragPosition();
  }

  function onCardClick(event) {
    if (state.suppressClick) {
      state.suppressClick = false;
      return;
    }
    if (event.target.closest("button, a")) {
      return;
    }
    const wasDragged =
      state.drag?.moved ||
      Math.abs(Number.parseFloat(elements.reviewCard.style.transform || "0")) >
        0;
    if (!wasDragged) {
      revealCurrent();
    }
  }

  function onWheel(event) {
    if (!getCurrentEntry() || Math.abs(event.deltaY) < 24) {
      return;
    }
    event.preventDefault();
    if (state.wheelTimer) {
      return;
    }
    state.wheelTimer = window.setTimeout(() => {
      state.wheelTimer = 0;
    }, 420);
    move(event.deltaY > 0 ? 1 : -1);
  }

  function onKeyDown(event) {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.tagName === "SELECT" ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      revealCurrent();
      return;
    }
    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      speakCurrent();
      return;
    }
    if (event.key === "1") {
      event.preventDefault();
      markCurrent("unknown");
      return;
    }
    if (event.key === "2") {
      event.preventDefault();
      markCurrent("known");
    }
  }

  function setScopeControlVisibility(visible) {
    elements.scopeControls.hidden = !visible;
    elements.scopeToggleButton.setAttribute(
      "aria-expanded",
      String(visible),
    );
    elements.scopeToggleButton.textContent = visible ? "收起范围" : "调整范围";
  }

  function resetUnitAndRebuild() {
    state.unitKey = "all";
    syncScopeToUrl();
    rebuildQueue();
  }

  function bindEvents() {
    elements.scopeToggleButton.addEventListener("click", () => {
      setScopeControlVisibility(elements.scopeControls.hidden);
    });
    elements.categorySelect.addEventListener("change", (event) => {
      state.category = event.target.value;
      state.section = "all";
      state.resourceId = "all";
      state.unitKey = "all";
      syncScopeToUrl();
      rebuildQueue();
    });
    elements.sectionSelect.addEventListener("change", (event) => {
      state.section = event.target.value;
      state.resourceId = "all";
      state.unitKey = "all";
      syncScopeToUrl();
      rebuildQueue();
    });
    elements.resourceSelect.addEventListener("change", (event) => {
      state.resourceId = event.target.value;
      resetUnitAndRebuild();
    });
    elements.unitSelect.addEventListener("change", (event) => {
      state.unitKey = event.target.value;
      syncScopeToUrl();
      rebuildQueue();
    });
    elements.limitSelect.addEventListener("change", (event) => {
      state.limit =
        event.target.value === "all"
          ? Number.POSITIVE_INFINITY
          : Number(event.target.value);
      syncScopeToUrl();
      rebuildQueue();
    });

    elements.reviewCard.addEventListener("pointerdown", onPointerDown);
    elements.reviewCard.addEventListener("pointermove", onPointerMove);
    elements.reviewCard.addEventListener("pointerup", endPointerDrag);
    elements.reviewCard.addEventListener("pointercancel", endPointerDrag);
    elements.reviewCard.addEventListener("click", onCardClick);
    elements.reviewCard.addEventListener("wheel", onWheel, { passive: false });
    elements.reviewCard.addEventListener("keydown", onKeyDown);

    elements.previousButton.addEventListener("click", () => move(-1));
    elements.nextButton.addEventListener("click", () => move(1));
    elements.unknownButton.addEventListener("click", () =>
      markCurrent("unknown"),
    );
    elements.knownButton.addEventListener("click", () => markCurrent("known"));
    elements.speakButton.addEventListener("click", speakCurrent);
    elements.revealButton.addEventListener("click", revealCurrent);
    elements.restartButton.addEventListener("click", rebuildQueue);
    elements.completionRestartButton.addEventListener("click", rebuildQueue);
    document.addEventListener("keydown", onKeyDown);
  }

  async function initialize() {
    readScopeFromUrl();
    restoreReviewData();
    bindEvents();
    setScopeControlVisibility(window.innerWidth >= 760);

    try {
      const session = window.iballSession
        ? await window.iballSession.probe()
        : { mode: "server", authenticated: false };
      // 静态镜像（GitHub 备份）没有账号接口，仍然放行。
      if (session.mode !== "local" && !session.authenticated) {
        window.location.replace("./index.html");
        return;
      }

      const library = await fetchLibrary("./resources.json");
      state.categories = library.categories;
      state.resources = library.resources;
      state.decks = library.decks;
      renderScopeControls();
      syncScopeToUrl();
      rebuildQueue();
    } catch (error) {
      state.queue = [];
      state.completed = false;
      elements.scopeTitle.textContent = "卡片加载失败";
      elements.scopeMeta.textContent = "请刷新页面后重试。";
      elements.emptyTitle.textContent = "暂时无法打开卡片";
      elements.emptyCopy.textContent = "请检查网络和素材文件后重试。";
      elements.emptyView.hidden = false;
      console.error(error);
    }
  }

  window.reviewApp = {
    state,
    elements,
    getScopedEntries,
    rebuildQueue,
    move,
    markCurrent,
    revealCurrent,
    speakCurrent,
  };

  initialize();
})();
