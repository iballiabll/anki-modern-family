/**
 * 作文批改页面控制器。
 *
 * 加载策略：
 *   1. 首屏只请求 writing-data/index.json（约 50KB），拿到考试 / 年份 / 题目标题；
 *   2. 只有真正选中某一道题时，才按 shard 请求对应年份的作文数据；
 *   3. 已下载的分片与草稿写进 localStorage（带 try/catch，配额满时静默降级），
 *      重复进入页面不再重复请求。
 *
 * 批改策略：先用本地规则引擎（writing-grade.js）立刻给出结果，保证断网可用；
 * 再异步请求 /api/grade 尝试更细的 AI 批改，接口不可用时保留本地结果，界面不阻塞。
 */
(function () {
  "use strict";

  const INDEX_URL = "./writing-data/index.json";
  const TEMPLATE_INDEX_URL = "./writing-data/templates/index.json";
  const SHARD_CACHE_PREFIX = "iball-writing-shard:";
  const TEMPLATE_CACHE_PREFIX = "iball-writing-template:";
  const DRAFT_PREFIX = "iball-writing-draft:";
  const GRADE_PREFIX = "iball-writing-grade:";
  const LAST_PROMPT_KEY = "iball-writing-last-prompt";
  const API_TIMEOUT_MS = 20000;
  const MIN_WORDS = 1;
  const EXAM_ORDER = ["cet4", "cet6", "english-i", "english-ii"];
  const TEMPLATE_KIND_ORDER = ["all", "small", "large"];
  const EXAM_LABELS = {
    cet4: "四级",
    cet6: "六级",
    "english-i": "考研英语一",
    "english-ii": "考研英语二",
  };

  const state = {
    index: null,
    exam: "cet4",
    year: "",
    query: "",
    draftOnly: false,
    activeId: "",
    activePrompt: null,
    promptPromise: null,
    editorTouched: false,
    shards: new Map(),
    shardPromises: new Map(),
    templateIndex: null,
    templateExam: "cet4",
    templateKind: "all",
    templateActiveId: "",
    templateShards: new Map(),
    templatePromises: new Map(),
    templateIndexPromise: null,
    templateLoadPromise: null,
    templateObserver: null,
    method: null,
    methodPromise: null,
    phraseBank: null,
    grade: null,
    grading: false,
    saveTimer: 0,
  };

  const els = {};

  function cacheDom() {
    [
      "heroStats",
      "examTabs",
      "yearSelect",
      "promptSearch",
      "draftOnlyButton",
      "draftCount",
      "clearDraftButton",
      "promptMeta",
      "promptList",
      "taskTitle",
      "taskMeta",
      "taskBody",
      "draftStatus",
      "essayInput",
      "wordMeterBar",
      "wordCount",
      "gradeButton",
      "modelButton",
      "speakModelButton",
      "gradeStatus",
      "gradeResult",
      "templateSection",
      "templateMeta",
      "templateExamTabs",
      "templateKindTabs",
      "templateList",
      "templateDetail",
      "templateJumpLink",
      "methodSection",
      "methodMeta",
      "methodBody",
      "writingWordPanel",
      "writingWordClose",
      "writingWordSpeak",
      "writingWordTitle",
      "writingWordPhonetic",
      "writingWordStatus",
      "writingWordMeanings",
      "writingWordPhraseSection",
      "writingWordPhrases",
      "writingWordContext",
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 隐私模式下 localStorage 可能不可写，忽略即可。
    }
  }

  function storageKeys() {
    try {
      // 注意：Storage 上 Object.keys() 只给方法名，得按下标取键。
      const storage = window.localStorage;
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) {
          keys.push(key);
        }
      }
      return keys;
    } catch {
      return [];
    }
  }

  function readJson(key) {
    const raw = storageGet(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      return storageSet(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  function countWords(text) {
    if (window.IBALL_WRITING_GRADE?.countWords) {
      return window.IBALL_WRITING_GRADE.countWords(text);
    }
    return (String(text).match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || [])
      .length;
  }

  function draftKey(id) {
    return `${DRAFT_PREFIX}${id}`;
  }

  function gradeKey(id) {
    return `${GRADE_PREFIX}${id}`;
  }

  /* ------------------------------------------------ 作答统计（学习记录） */

  // 作文没有官方分值，统计只记「写了 / 批改了 / 评分多少」，不换算考试成绩。
  const ExamScores = window.ExamScores || null;
  const SCORE_ITEM_ID = "essay";

  function scoreMeta(prompt) {
    if (!prompt) {
      return null;
    }
    return {
      exam: prompt.exam,
      paperId: `writing-${prompt.id}`,
      paperLabel: prompt.paperTitle
        ? `${prompt.paperTitle}｜${prompt.label || ""}`
        : prompt.label || prompt.id,
      sectionId: "writing",
      sectionLabel: [prompt.examLabel || EXAM_LABELS[prompt.exam] || "", prompt.part, "写作"]
        .filter(Boolean)
        .join(" · "),
    };
  }

  function recordDraftScore(prompt, text) {
    const meta = scoreMeta(prompt);
    if (!ExamScores || !meta) {
      return;
    }
    const words = countWords(text);
    if (!words) {
      ExamScores.removeSubjective({ ...meta, itemId: SCORE_ITEM_ID });
      return;
    }
    ExamScores.recordSubjective({
      ...meta,
      itemId: SCORE_ITEM_ID,
      label: prompt.label || "作文",
      status: "draft",
      words,
      note: "草稿完成度，站点不对作文给出官方分数。",
    });
  }

  function recordGradeScore(prompt, result) {
    const meta = scoreMeta(prompt);
    if (!ExamScores || !meta || !result) {
      return;
    }
    const score = Number(result.score);
    const maxScore = Number(result.maxScore);
    ExamScores.recordSubjective({
      ...meta,
      itemId: SCORE_ITEM_ID,
      label: prompt.label || "作文",
      status: "graded",
      words: countWords(els.essayInput?.value || ""),
      score: Number.isFinite(score) ? score : null,
      maxScore: Number.isFinite(maxScore) ? maxScore : null,
      note: `学习评分（非官方）：${result.engine === "ai" ? "AI 批改" : "本地规则引擎"}`,
    });
  }

  function clearScore(prompt) {
    const meta = scoreMeta(prompt);
    if (!ExamScores || !meta) {
      return;
    }
    ExamScores.removeSubjective({ ...meta, itemId: SCORE_ITEM_ID });
  }

  function shardCacheKey(name) {
    return `${SHARD_CACHE_PREFIX}${name}`;
  }

  function templateCacheKey(name) {
    return `${TEMPLATE_CACHE_PREFIX}${name}`;
  }

  function hasDraft(id) {
    const draft = readJson(draftKey(id));
    return Boolean(draft && String(draft.text || "").trim());
  }

  function listDraftIds() {
    return storageKeys()
      .filter((key) => key.startsWith(DRAFT_PREFIX))
      .map((key) => key.slice(DRAFT_PREFIX.length));
  }

  function renderDraftCount() {
    const ids = listDraftIds();
    if (els.draftCount) {
      els.draftCount.textContent = String(ids.length);
    }
    if (els.draftOnlyButton) {
      els.draftOnlyButton.classList.toggle("is-active", state.draftOnly);
      els.draftOnlyButton.setAttribute("aria-pressed", String(state.draftOnly));
      els.draftOnlyButton.disabled = ids.length === 0;
    }
  }

  function itemsForExam() {
    const items = state.index?.items || [];
    return items.filter((item) => item.exam === state.exam);
  }

  function yearsForExam() {
    const years = new Set(itemsForExam().map((item) => Number(item.year)));
    return [...years].sort((left, right) => right - left);
  }

  function filteredItems() {
    const query = state.query.trim().toLowerCase();
    return itemsForExam().filter((item) => {
      if (state.year && String(item.year) !== String(state.year)) {
        return false;
      }
      if (state.draftOnly && !hasDraft(item.id)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        item.label,
        item.part,
        item.paperTitle,
        item.examLabel,
        item.year,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderHeroStats() {
    if (!els.heroStats || !state.index) {
      return;
    }
    const items = state.index.items || [];
    const counts = EXAM_ORDER.map((exam) => {
      const total = items.filter((item) => item.exam === exam).length;
      return `${EXAM_LABELS[exam]} ${total}`;
    });
    els.heroStats.textContent = "";
    counts.forEach((label) => {
      const chip = document.createElement("span");
      chip.className = "hero-stat";
      chip.textContent = label;
      els.heroStats.append(chip);
    });
    const note = document.createElement("span");
    note.className = "hero-stat is-soft";
    note.textContent = "按年份分片懒加载";
    els.heroStats.append(note);
  }

  function renderYearSelect() {
    if (!els.yearSelect) {
      return;
    }
    const years = yearsForExam();
    if (state.year && !years.some((year) => String(year) === String(state.year))) {
      state.year = "";
    }
    els.yearSelect.textContent = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "全部年份";
    els.yearSelect.append(all);
    years.forEach((year) => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = `${year} 年`;
      els.yearSelect.append(option);
    });
    els.yearSelect.value = state.year;
  }

  function renderPromptList() {
    if (!els.promptList) {
      return;
    }
    const list = filteredItems();
    els.promptList.textContent = "";

    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "writing-prompt-empty";
      empty.textContent = state.draftOnly
        ? "当前筛选下还没有草稿。先挑一道题写几句，草稿会自动保存在本机。"
        : "没有匹配的题目，换个年份或关键词再试。";
      els.promptList.append(empty);
    } else {
      let currentYear = "";
      const fragment = document.createDocumentFragment();
      list.forEach((item) => {
        const yearLabel = String(item.year);
        if (yearLabel !== currentYear) {
          currentYear = yearLabel;
          const year = document.createElement("p");
          year.className = "writing-prompt-year";
          year.textContent = `${yearLabel} 年`;
          fragment.append(year);
        }
        fragment.append(createPromptRow(item));
      });
      els.promptList.append(fragment);
    }

    if (els.promptMeta) {
      const total = itemsForExam().length;
      els.promptMeta.textContent = `当前 ${list.length} 题 / 本考试共 ${total} 题`;
    }
    renderDraftCount();
  }

  function createPromptRow(item) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "writing-prompt-row";
    row.dataset.promptId = item.id;
    if (item.id === state.activeId) {
      row.classList.add("is-active");
      row.setAttribute("aria-current", "true");
    }

    const title = document.createElement("strong");
    title.textContent = `${item.label}｜${item.paperTitle}`;

    const meta = document.createElement("span");
    meta.textContent = `${item.wordLimit || "按题目要求"} · ${item.part || item.label}`;

    const tags = document.createElement("span");
    tags.className = "writing-prompt-tags";
    if (item.hasModel) {
      tags.append(makeTag("含范文", "is-model"));
    }
    if (hasDraft(item.id)) {
      tags.append(makeTag("有草稿", "is-draft"));
    }
    if (readJson(gradeKey(item.id))) {
      tags.append(makeTag("已批改", "is-graded"));
    }

    row.append(title, meta, tags);
    row.addEventListener("click", () => selectPrompt(item.id));
    return row;
  }

  function makeTag(text, extraClass) {
    const tag = document.createElement("span");
    tag.className = `writing-tag ${extraClass || ""}`.trim();
    tag.textContent = text;
    return tag;
  }

  function setStatus(message, isError) {
    if (!els.gradeStatus) {
      return;
    }
    els.gradeStatus.textContent = message || "";
    els.gradeStatus.classList.toggle("is-error", Boolean(isError));
  }

  function setDraftStatus(message, isError) {
    if (!els.draftStatus) {
      return;
    }
    els.draftStatus.textContent = message;
    els.draftStatus.classList.toggle("is-error", Boolean(isError));
  }

  function loadShard(name) {
    if (state.shards.has(name)) {
      return Promise.resolve(state.shards.get(name));
    }
    if (state.shardPromises.has(name)) {
      return state.shardPromises.get(name);
    }
    const cached = readJson(shardCacheKey(name));
    if (cached && Array.isArray(cached.prompts)) {
      state.shards.set(name, cached);
      return Promise.resolve(cached);
    }
    const url = state.index?.shards?.[name];
    if (!url) {
      return Promise.reject(new Error(`缺少分片地址：${name}`));
    }
    const promise = fetch(url, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`题目数据加载失败（${response.status}）`);
        }
        return response.json();
      })
      .then((data) => {
        state.shards.set(name, data);
        state.shardPromises.delete(name);
        writeJson(shardCacheKey(name), data);
        return data;
      })
      .catch((error) => {
        state.shardPromises.delete(name);
        throw error;
      });
    state.shardPromises.set(name, promise);
    return promise;
  }

  function templateExamConfig(exam) {
    return state.templateIndex?.exams?.[exam] || null;
  }

  function loadTemplateIndex() {
    if (state.templateIndex) {
      return Promise.resolve(state.templateIndex);
    }
    if (state.templateIndexPromise) {
      return state.templateIndexPromise;
    }
    const promise = fetch(TEMPLATE_INDEX_URL, {
      headers: { Accept: "application/json" },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`模板索引加载失败（${response.status}）`);
        }
        return response.json();
      })
      .then((data) => {
        if (!data || typeof data !== "object" || !data.exams) {
          throw new Error("模板索引格式不正确");
        }
        state.templateIndex = data;
        state.templateIndexPromise = null;
        return data;
      })
      .catch((error) => {
        state.templateIndexPromise = null;
        throw error;
      });
    state.templateIndexPromise = promise;
    return promise;
  }

  function loadTemplateShard(exam) {
    if (state.templateShards.has(exam)) {
      return Promise.resolve(state.templateShards.get(exam));
    }
    if (state.templatePromises.has(exam)) {
      return state.templatePromises.get(exam);
    }
    const cached = readJson(templateCacheKey(exam));
    if (cached && Array.isArray(cached.templates)) {
      state.templateShards.set(exam, cached);
      return Promise.resolve(cached);
    }
    if (!state.templateIndex) {
      return loadTemplateIndex().then(() => {
        if (state.templateShards.has(exam)) {
          return state.templateShards.get(exam);
        }
        return loadTemplateShard(exam);
      });
    }
    const url = templateExamConfig(exam)?.url;
    if (!url) {
      return Promise.reject(new Error(`缺少模板分片地址：${exam}`));
    }
    const promise = fetch(url, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`模板数据加载失败（${response.status}）`);
        }
        return response.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.templates)) {
          throw new Error("模板数据格式不正确");
        }
        state.templateShards.set(exam, data);
        state.templatePromises.delete(exam);
        writeJson(templateCacheKey(exam), data);
        return data;
      })
      .catch((error) => {
        state.templatePromises.delete(exam);
        throw error;
      });
    state.templatePromises.set(exam, promise);
    return promise;
  }

  function syncTemplateTabs() {
    els.templateExamTabs?.querySelectorAll("[data-exam]").forEach((tab) => {
      const active = tab.dataset.exam === state.templateExam;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
    els.templateKindTabs?.querySelectorAll("[data-kind]").forEach((tab) => {
      const active = tab.dataset.kind === state.templateKind;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    });
  }

  function visibleTemplates() {
    const templates = state.templateShards.get(state.templateExam)?.templates || [];
    if (state.templateKind === "all") {
      return templates;
    }
    return templates.filter((template) => template.kind === state.templateKind);
  }

  function renderTemplateMeta() {
    if (!els.templateMeta) {
      return;
    }
    const config = templateExamConfig(state.templateExam);
    const count = visibleTemplates().length;
    const label = config?.examLabel || EXAM_LABELS[state.templateExam] || "模板";
    const target = config?.wordTarget ? ` · ${config.wordTarget}` : "";
    els.templateMeta.textContent = `${label} · ${count} 个模板${target}`;
  }

  function makeTemplateTag(text, extraClass) {
    const tag = document.createElement("span");
    tag.className = `writing-template-tag ${extraClass || ""}`.trim();
    tag.textContent = text;
    return tag;
  }

  function createTemplateCard(template) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "writing-template-card";
    card.dataset.templateId = template.id;
    card.setAttribute("role", "listitem");
    if (template.id === state.templateActiveId) {
      card.classList.add("is-active");
      card.setAttribute("aria-current", "true");
    }

    const title = document.createElement("strong");
    title.textContent = template.title || template.genre || "作文模板";
    const meta = document.createElement("span");
    meta.textContent = template.kindLabel || "";
    const tags = document.createElement("span");
    tags.className = "writing-template-tags";
    if (template.kind) {
      tags.append(
        makeTemplateTag(template.kind === "small" ? "小作文" : "大作文", "is-kind"),
      );
    }
    if (template.genre) {
      tags.append(makeTemplateTag(template.genre, "is-genre"));
    }

    card.append(title, meta, tags);
    card.addEventListener("click", () => selectTemplate(template.id));
    return card;
  }

  function appendSlotText(container, text) {
    const value = String(text || "");
    const slotPattern = /\{[^{}]+\}/g;
    let lastIndex = 0;
    let match = slotPattern.exec(value);
    while (match) {
      if (match.index > lastIndex) {
        container.append(document.createTextNode(value.slice(lastIndex, match.index)));
      }
      const slot = document.createElement("span");
      slot.className = "writing-template-slot";
      slot.textContent = match[0];
      container.append(slot);
      lastIndex = match.index + match[0].length;
      match = slotPattern.exec(value);
    }
    if (lastIndex < value.length) {
      container.append(document.createTextNode(value.slice(lastIndex)));
    }
  }

  /* ------------------------------------------------ 模板点词查义 */

  const WORD_TOKEN_RE = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g;
  const WORD_SLOT_RE = /\{[^{}]+\}/g;

  function normalizeWordKey(value) {
    return String(value || "")
      .replace(/[’‘`]/g, "'")
      .toLowerCase()
      .trim();
  }

  function sentenceTokens(value) {
    const clean = String(value || "").replace(WORD_SLOT_RE, " ");
    return clean.match(WORD_TOKEN_RE) || [];
  }

  function createWordToken(word, sentence, index) {
    const token = document.createElement("span");
    token.className = "word-token";
    token.textContent = word;
    token.dataset.word = word;
    token.dataset.sentence = sentence;
    token.dataset.tokenIndex = String(index);
    token.setAttribute("role", "button");
    token.setAttribute("tabindex", "0");
    token.title = "点击查看释义与固定搭配";
    token.setAttribute("aria-label", `查看 ${word} 的释义与固定搭配`);
    return token;
  }

  // 把英文句子渲染成可点单词；花括号槽位保留为不可点的占位标记。
  function appendExplainableText(container, text, sentence) {
    const value = String(text || "");
    if (!value) {
      return;
    }
    const context = String(sentence || value);
    let tokenIndex = 0;
    const appendPlain = (chunk) => {
      if (!chunk) {
        return;
      }
      WORD_TOKEN_RE.lastIndex = 0;
      let cursor = 0;
      let match = WORD_TOKEN_RE.exec(chunk);
      if (!match) {
        container.append(document.createTextNode(chunk));
        return;
      }
      while (match) {
        if (match.index > cursor) {
          container.append(
            document.createTextNode(chunk.slice(cursor, match.index)),
          );
        }
        container.append(createWordToken(match[0], context, tokenIndex));
        tokenIndex += 1;
        cursor = match.index + match[0].length;
        match = WORD_TOKEN_RE.exec(chunk);
      }
      if (cursor < chunk.length) {
        container.append(document.createTextNode(chunk.slice(cursor)));
      }
    };

    WORD_SLOT_RE.lastIndex = 0;
    let lastIndex = 0;
    let slotMatch = WORD_SLOT_RE.exec(value);
    while (slotMatch) {
      appendPlain(value.slice(lastIndex, slotMatch.index));
      const slot = document.createElement("span");
      slot.className = "writing-template-slot";
      slot.textContent = slotMatch[0];
      container.append(slot);
      lastIndex = slotMatch.index + slotMatch[0].length;
      slotMatch = WORD_SLOT_RE.exec(value);
    }
    appendPlain(value.slice(lastIndex));
  }

  // 点击某个词时，优先命中包含它的两到三个词的固定搭配。
  function matchPhraseAt(tokens, index) {
    const index2 = window.CollocationIndex;
    if (!index2 || typeof index2.lookup !== "function" || !tokens.length) {
      return null;
    }
    if (!Number.isInteger(index) || index < 0 || index >= tokens.length) {
      return null;
    }
    for (let size = 3; size >= 2; size -= 1) {
      const from = Math.max(0, index - size + 1);
      const to = Math.min(index, tokens.length - size);
      for (let start = from; start <= to; start += 1) {
        const hit = index2.lookup(tokens.slice(start, start + size).join(" "));
        if (hit?.phrase) {
          return hit;
        }
      }
    }
    return null;
  }

  function relatedWritingPhrases(word, sentence) {
    const index2 = window.CollocationIndex;
    if (!index2) {
      return [];
    }
    const seen = new Set();
    const out = [];
    const push = (item) => {
      if (!item?.phrase || seen.has(item.phrase)) {
        return;
      }
      seen.add(item.phrase);
      out.push(item);
    };
    if (typeof index2.findInText === "function") {
      (index2.findInText(sentence) || []).forEach(push);
    }
    if (typeof index2.containing === "function") {
      (index2.containing(word, 8) || []).forEach(push);
    }
    return out.slice(0, 8);
  }

  function renderWritingWordMeanings(items) {
    const box = els.writingWordMeanings;
    if (!box) {
      return;
    }
    box.replaceChildren();
    const usable = (items || [])
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (!usable.length) {
      return;
    }
    const list = document.createElement("ul");
    usable.forEach((meaning) => {
      const item = document.createElement("li");
      item.textContent = meaning;
      list.append(item);
    });
    box.append(list);
  }

  function renderWritingWordPhrases(items) {
    const box = els.writingWordPhrases;
    const section = els.writingWordPhraseSection;
    if (!box || !section) {
      return;
    }
    box.replaceChildren();
    const usable = (items || []).filter((item) => item?.phrase);
    section.hidden = usable.length === 0;
    if (!usable.length) {
      return;
    }
    const list = document.createElement("ul");
    usable.forEach((item) => {
      const entry = document.createElement("li");
      const phrase = document.createElement("strong");
      phrase.className = "word-token";
      phrase.lang = "en";
      phrase.textContent = item.phrase;
      phrase.dataset.word = item.phrase;
      phrase.dataset.sentence = item.phrase;
      phrase.dataset.tokenIndex = "-1";
      phrase.setAttribute("role", "button");
      phrase.setAttribute("tabindex", "0");
      phrase.title = "点击查看释义与固定搭配";
      phrase.setAttribute("aria-label", `查看 ${item.phrase} 的释义与固定搭配`);
      entry.append(phrase);
      const meaning = String(item.meaning || "").trim();
      if (meaning) {
        const copy = document.createElement("span");
        copy.textContent = meaning;
        entry.append(copy);
      }
      list.append(entry);
    });
    box.append(list);
  }

  async function lookupWritingVocab(word) {
    const index = window.VocabIndex;
    if (!index || typeof index.lookup !== "function") {
      return null;
    }
    try {
      const entry = await index.lookup(word);
      return entry && (entry.meaning || entry.phonetic) ? entry : null;
    } catch {
      return null;
    }
  }

  async function openWritingWordPanel(word, sentence, rawIndex) {
    const panel = els.writingWordPanel;
    const phrase = String(word || "").trim();
    if (!panel || !phrase) {
      return;
    }
    const clean = String(sentence || phrase)
      .replace(WORD_SLOT_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
    const tokens = sentenceTokens(clean);
    let index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index >= tokens.length) {
      index = tokens.findIndex(
        (token) => normalizeWordKey(token) === normalizeWordKey(phrase),
      );
    }
    state.wordLookupRun = (state.wordLookupRun || 0) + 1;
    const run = state.wordLookupRun;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    panel.scrollTop = 0;
    if (els.writingWordTitle) {
      els.writingWordTitle.textContent = phrase;
    }
    if (els.writingWordPhonetic) {
      els.writingWordPhonetic.textContent = "";
    }
    if (els.writingWordContext) {
      els.writingWordContext.textContent = clean;
    }
    if (els.writingWordStatus) {
      els.writingWordStatus.textContent = "正在查本地词库…";
    }
    renderWritingWordMeanings([]);
    renderWritingWordPhrases([]);

    await window.CollocationIndex?.load?.();
    if (run !== state.wordLookupRun || panel.hidden) {
      return;
    }
    const exact = window.CollocationIndex?.lookup?.(phrase);
    const phraseHit = exact?.phrase ? exact : matchPhraseAt(tokens, index);
    if (phraseHit?.phrase && els.writingWordTitle) {
      els.writingWordTitle.textContent = phraseHit.phrase;
    }

    const vocab = await lookupWritingVocab(phrase);
    if (run !== state.wordLookupRun || panel.hidden) {
      return;
    }
    const meanings = [];
    if (phraseHit?.meaning && phraseHit.meaning !== vocab?.meaning) {
      meanings.push(phraseHit.meaning);
    }
    if (vocab?.meaning) {
      meanings.push(vocab.meaning);
    }
    if (vocab?.phonetic && els.writingWordPhonetic) {
      els.writingWordPhonetic.textContent = vocab.phonetic;
    }
    renderWritingWordMeanings(meanings);
    renderWritingWordPhrases(relatedWritingPhrases(phrase, clean));
    if (els.writingWordStatus) {
      els.writingWordStatus.textContent = meanings.length
        ? `${vocab?.source || "本地词库"} · ${
            (vocab?.kind || (phraseHit ? "phrase" : "word")) === "phrase"
              ? "短语"
              : "单词"
          }`
        : "本地词库暂时没有收录这个词，先参考下面的固定搭配。";
    }
  }

  function closeWritingWordPanel() {
    const panel = els.writingWordPanel;
    if (!panel) {
      return;
    }
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    state.wordLookupRun = (state.wordLookupRun || 0) + 1;
  }

  function speakWritingWord() {
    const text = els.writingWordTitle?.textContent || "";
    if (!text || !window.IballSpeech?.speakSequence) {
      return;
    }
    window.IballSpeech.speakSequence([{ text, lang: "en-US" }], {
      label: "作文查词",
      rate: 0.86,
    });
  }

  function makeTemplateBlock(title, hint) {
    const block = document.createElement("section");
    block.className = "writing-template-block";
    const heading = document.createElement("h4");
    heading.textContent = title;
    if (hint) {
      const note = document.createElement("span");
      note.textContent = hint;
      heading.append(note);
    }
    block.append(heading);
    return block;
  }

  function makeTemplateNote(title, items, extraClass) {
    const note = document.createElement("section");
    note.className = `writing-template-note ${extraClass || ""}`.trim();
    const heading = document.createElement("h5");
    heading.textContent = title;
    note.append(heading);
    const list = document.createElement("ul");
    (items || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.append(li);
    });
    note.append(list);
    return note;
  }

  function renderTeacherBlock(teacher) {
    const block = makeTemplateBlock(
      "老师视角 · 怎么用这套模板",
      teacher.role || "按考研阅卷与教学视角整理",
    );
    block.classList.add("writing-template-teacher-block");

    if ((teacher.scoring || []).length) {
      const scoring = document.createElement("section");
      scoring.className = "writing-teacher-section is-scoring";
      const h = document.createElement("h5");
      h.textContent = "阅卷怎么给分";
      const ul = document.createElement("ul");
      teacher.scoring.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        ul.append(li);
      });
      scoring.append(h, ul);
      block.append(scoring);
    }

    if ((teacher.steps || []).length) {
      const steps = document.createElement("section");
      steps.className = "writing-teacher-section is-steps";
      const h = document.createElement("h5");
      h.textContent = "老师的写作步骤";
      const ol = document.createElement("ol");
      teacher.steps.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        ol.append(li);
      });
      steps.append(h, ol);
      block.append(steps);
    }

    if ((teacher.warnings || []).length) {
      const warn = document.createElement("section");
      warn.className = "writing-teacher-section is-warning";
      const h = document.createElement("h5");
      h.textContent = "老师最想提醒";
      const ul = document.createElement("ul");
      teacher.warnings.forEach((line) => {
        const li = document.createElement("li");
        li.textContent = line;
        ul.append(li);
      });
      warn.append(h, ul);
      block.append(warn);
    }

    if ((teacher.keyPhrases || []).length) {
      const keys = document.createElement("section");
      keys.className = "writing-teacher-section is-keyphrases";
      const h = document.createElement("h5");
      h.textContent = "重点功能句（点英文单词可查释义与搭配）";
      const list = document.createElement("div");
      list.className = "writing-teacher-phrases";
      (teacher.keyPhrases || []).forEach((item) => {
        const text =
          typeof item === "string" ? item : item?.en || item?.phrase || "";
        if (!text) {
          return;
        }
        const card = document.createElement("article");
        card.className = "writing-teacher-phrase";
        const slotText = typeof item === "string" ? "" : item?.slot || "";
        if (slotText) {
          const slot = document.createElement("span");
          slot.className = "writing-teacher-phrase-slot";
          slot.textContent = slotText;
          card.append(slot);
        }
        const en = document.createElement("p");
        en.className = "writing-teacher-phrase-en";
        appendExplainableText(en, text, text);
        card.append(en);
        const zhText = typeof item === "string" ? "" : String(item?.zh || "").trim();
        if (zhText) {
          const zh = document.createElement("p");
          zh.className = "writing-teacher-phrase-zh";
          zh.textContent = zhText;
          card.append(zh);
        }
        list.append(card);
      });
      keys.append(h, list);
      block.append(keys);
    }

    if (teacher.timePlan) {
      const time = document.createElement("p");
      time.className = "writing-teacher-time";
      time.textContent = `考场时间：${teacher.timePlan}`;
      block.append(time);
    }

    return block;
  }

  function speakTemplateLines(lines, label) {
    const content = (lines || []).filter(Boolean);
    if (!content.length) {
      return;
    }
    if (!window.IballSpeech?.speakSequence) {
      els.templateMeta && (els.templateMeta.textContent = "当前浏览器不支持朗读。");
      return;
    }
    window.IballSpeech.speakSequence(
      content.map((text) => ({ text, lang: "en-US" })),
      { label, rate: 0.88 },
    );
  }

  function templateSkeletonText(template) {
    return (template.skeleton || [])
      .map((step) =>
        [step.section, step.en, step.zh, step.note].filter(Boolean).join("\n"),
      )
      .join("\n\n");
  }

  function fallbackCopyText(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    area.remove();
    return copied;
  }

  function copyTemplateSkeleton(template, button) {
    const text = templateSkeletonText(template);
    const done = () => {
      if (!button) {
        return;
      }
      const original = button.textContent;
      button.textContent = "已复制";
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(done)
        .catch(() => {
          if (fallbackCopyText(text)) {
            done();
          }
        });
      return;
    }
    if (fallbackCopyText(text)) {
      done();
    }
  }

  function createTemplateActions(template) {
    const actions = document.createElement("div");
    actions.className = "writing-template-actions";

    const speakSkeleton = document.createElement("button");
    speakSkeleton.type = "button";
    speakSkeleton.className = "tool-button";
    speakSkeleton.textContent = "朗读骨架";
    speakSkeleton.addEventListener("click", () =>
      speakTemplateLines(
        (template.skeleton || []).map((step) => step.en),
        "模板骨架朗读",
      ),
    );

    const speakDemo = document.createElement("button");
    speakDemo.type = "button";
    speakDemo.className = "tool-button";
    speakDemo.textContent = "朗读示例";
    speakDemo.addEventListener("click", () =>
      speakTemplateLines(template.demo?.paragraphs, "模板示例朗读"),
    );

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "tool-button";
    copy.textContent = "复制骨架";
    copy.addEventListener("click", () => copyTemplateSkeleton(template, copy));

    actions.append(speakSkeleton, speakDemo, copy);
    return actions;
  }

  function renderTemplateDetail(template) {
    if (!els.templateDetail) {
      return;
    }
    els.templateDetail.textContent = "";
    if (!template) {
      const empty = document.createElement("p");
      empty.className = "writing-template-empty";
      empty.textContent = "挑一个模板，这里会显示段落骨架、功能句、示例与自查清单。";
      els.templateDetail.append(empty);
      return;
    }

    const head = document.createElement("div");
    head.className = "writing-template-head";
    const title = document.createElement("h3");
    title.textContent = template.title || template.genre || "作文模板";
    const scenario = document.createElement("p");
    scenario.className = "writing-template-scenario";
    scenario.textContent = template.scenario || "";
    head.append(title, scenario);
    els.templateDetail.append(head, createTemplateActions(template));

    const skeletonBlock = makeTemplateBlock(
      "段落骨架",
      "先替换花括号槽位，再按题目补充具体信息",
    );
    const skeleton = document.createElement("div");
    skeleton.className = "writing-template-skeleton";
    (template.skeleton || []).forEach((step) => {
      const item = document.createElement("article");
      item.className = "writing-template-step";
      const section = document.createElement("span");
      section.className = "writing-template-step-section";
      section.textContent = step.section || "";
      const en = document.createElement("p");
      en.className = "writing-template-step-en";
      appendExplainableText(en, step.en, step.en);
      const zh = document.createElement("p");
      zh.className = "writing-template-step-zh";
      zh.textContent = step.zh || "";
      item.append(section, en, zh);
      if (step.note) {
        const note = document.createElement("p");
        note.className = "writing-template-step-note";
        note.textContent = `提示：${step.note}`;
        item.append(note);
      }
      skeleton.append(item);
    });
    skeletonBlock.append(skeleton);
    els.templateDetail.append(skeletonBlock);

    const phraseBlock = makeTemplateBlock(
      "可替换功能句",
      "按功能挑句子，不要原样堆满整篇",
    );
    const phrases = document.createElement("ul");
    phrases.className = "writing-template-phrases";
    (template.phrases || []).forEach((phrase) => {
      const item = document.createElement("li");
      item.className = "writing-template-phrase";
      const fn = document.createElement("strong");
      fn.textContent = phrase.function || "功能句";
      const en = document.createElement("em");
      appendExplainableText(en, phrase.en || "", phrase.en || "");
      const zh = document.createElement("span");
      zh.textContent = phrase.zh || "";
      item.append(fn, en, zh);
      phrases.append(item);
    });
    phraseBlock.append(phrases);
    els.templateDetail.append(phraseBlock);

    const demoBlock = makeTemplateBlock(
      "示例段落",
      "压缩版示例，考场按目标词数扩写",
    );
    const demo = document.createElement("div");
    demo.className = "writing-template-demo";
    if (template.demo?.topic) {
      const topic = document.createElement("p");
      topic.className = "writing-template-demo-topic";
      topic.textContent = `题目：${template.demo.topic}`;
      demo.append(topic);
    }
    const paragraphs = template.demo?.paragraphs || [];
    paragraphs.forEach((paragraph, index) => {
      const item = document.createElement("div");
      item.className = "writing-template-demo-paragraph";
      const en = document.createElement("p");
      en.className = "writing-template-demo-en";
      appendExplainableText(en, paragraph, paragraph);
      item.append(en);
      const translation = template.demo?.translation?.[index];
      if (translation) {
        const zh = document.createElement("p");
        zh.className = "writing-template-demo-zh";
        zh.textContent = translation;
        item.append(zh);
      }
      demo.append(item);
    });
    if (!paragraphs.length) {
      const empty = document.createElement("p");
      empty.className = "writing-template-empty";
      empty.textContent = "这个模板暂时没有示例段落，先按骨架和功能句练习。";
      demo.append(empty);
    }
    if (template.demo?.note) {
      const note = document.createElement("p");
      note.className = "writing-template-demo-note";
      note.textContent = template.demo.note;
      demo.append(note);
    }
    demoBlock.append(demo);
    els.templateDetail.append(demoBlock);

    const notes = document.createElement("div");
    notes.className = "writing-template-notes";
    notes.append(
      makeTemplateNote("避坑清单", template.pitfalls, "is-pitfall"),
      makeTemplateNote("套用清单", template.adapt),
    );
    els.templateDetail.append(notes);

    if (template.teacher) {
      els.templateDetail.append(renderTeacherBlock(template.teacher));
    }

    const foot = document.createElement("p");
    foot.className = "writing-template-foot";
    foot.textContent =
      "模板只解决结构和衔接，内容分要靠题干关键词、真实例子与自己的表达。";
    els.templateDetail.append(foot);
  }

  function renderTemplateList() {
    if (!els.templateList) {
      return;
    }
    const list = visibleTemplates();
    els.templateList.textContent = "";
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "writing-template-empty";
      empty.textContent = "当前考试和类型下还没有模板，换一个筛选条件。";
      els.templateList.append(empty);
      renderTemplateDetail(null);
      renderTemplateMeta();
      return;
    }
    if (!list.some((template) => template.id === state.templateActiveId)) {
      state.templateActiveId = list[0].id;
    }
    const fragment = document.createDocumentFragment();
    list.forEach((template) => fragment.append(createTemplateCard(template)));
    els.templateList.append(fragment);
    renderTemplateDetail(
      list.find((template) => template.id === state.templateActiveId) || list[0],
    );
    renderTemplateMeta();
  }

  function renderTemplateLibrary() {
    syncTemplateTabs();
    renderTemplateList();
  }

  function renderTemplateLoading(message) {
    if (els.templateMeta) {
      els.templateMeta.textContent = message || "正在读取模板…";
    }
    if (els.templateList) {
      els.templateList.textContent = "";
      const empty = document.createElement("p");
      empty.className = "writing-template-empty";
      empty.textContent = message || "正在读取模板…";
      els.templateList.append(empty);
    }
    if (els.templateDetail) {
      els.templateDetail.textContent = "";
      const empty = document.createElement("p");
      empty.className = "writing-template-empty";
      empty.textContent = "模板加载完成后，这里会显示段落骨架、功能句、示例与自查清单。";
      els.templateDetail.append(empty);
    }
  }

  function renderTemplateError(error) {
    const message = error?.message || "模板加载失败";
    if (els.templateMeta) {
      els.templateMeta.textContent = "模板加载失败";
    }
    if (els.templateList) {
      els.templateList.textContent = "";
      const empty = document.createElement("p");
      empty.className = "writing-template-empty";
      empty.textContent = `${message}。可以重试，题库其它功能不受影响。`;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "tool-button";
      retry.textContent = "重新加载模板";
      retry.addEventListener("click", () => {
        renderTemplateLoading("正在重新读取模板…");
        ensureTemplates();
      });
      empty.append(document.createElement("br"), retry);
      els.templateList.append(empty);
    }
    if (els.templateDetail) {
      els.templateDetail.textContent = "";
      const empty = document.createElement("p");
      empty.className = "writing-template-empty";
      empty.textContent = "模板数据暂时没读到，不影响作文批改、范文和讲解。";
      els.templateDetail.append(empty);
    }
  }

  function ensureTemplates() {
    if (state.templateLoadPromise) {
      return state.templateLoadPromise;
    }
    state.templateLoadPromise = loadTemplateIndex()
      .then(() => loadTemplateShard(state.templateExam))
      .then(() => {
        state.templateLoadPromise = null;
        renderTemplateLibrary();
      })
      .catch((error) => {
        state.templateLoadPromise = null;
        renderTemplateError(error);
      });
    return state.templateLoadPromise;
  }

  function selectTemplate(id) {
    state.templateActiveId = id;
    renderTemplateList();
  }

  function switchTemplateExam(exam) {
    if (!EXAM_ORDER.includes(exam) || exam === state.templateExam) {
      return;
    }
    state.templateExam = exam;
    state.templateActiveId = "";
    syncTemplateTabs();
    renderTemplateLoading(`正在读取${EXAM_LABELS[exam] || "模板"}模板…`);
    loadTemplateShard(exam)
      .then(() => {
        if (state.templateExam === exam) {
          renderTemplateLibrary();
        }
      })
      .catch((error) => {
        if (state.templateExam === exam) {
          renderTemplateError(error);
        }
      });
  }

  function switchTemplateKind(kind) {
    if (!TEMPLATE_KIND_ORDER.includes(kind) || kind === state.templateKind) {
      return;
    }
    state.templateKind = kind;
    syncTemplateTabs();
    if (state.templateShards.has(state.templateExam)) {
      renderTemplateLibrary();
    } else {
      renderTemplateLoading("正在读取模板…");
      ensureTemplates();
    }
  }

  function setupTemplateLazyLoad() {
    const section = els.templateSection;
    if (!section) {
      return;
    }
    const load = () => {
      if (EXAM_ORDER.includes(state.exam) && state.exam !== state.templateExam) {
        state.templateExam = state.exam;
        state.templateActiveId = "";
        syncTemplateTabs();
      }
      ensureTemplates();
    };
    els.templateJumpLink?.addEventListener("click", load);
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) {
            return;
          }
          observer.disconnect();
          state.templateObserver = null;
          load();
        },
        { rootMargin: "0px" },
      );
      observer.observe(section);
      state.templateObserver = observer;
      return;
    }
    const rect = section.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      load();
    }
  }

  const METHOD_URL = "./writing-data/kaoyan-method.json";
  const PHRASE_BANK_URL = "./writing-data/phrase-bank.json";

  function makePhraseBankToken(phrase, example) {
    const token = document.createElement("span");
    token.className = "word-token";
    token.lang = "en";
    token.textContent = phrase;
    token.dataset.word = phrase;
    token.dataset.sentence = example || phrase;
    token.dataset.tokenIndex = "-1";
    token.setAttribute("role", "button");
    token.setAttribute("tabindex", "0");
    token.title = "点击查看释义与固定搭配";
    token.setAttribute("aria-label", `查看 ${phrase} 的释义与固定搭配`);
    return token;
  }

  /* 短语与固定搭配库：按写作功能分组，英文条目可点击查释义与搭配 */
  function renderPhraseBank(container) {
    const data = state.phraseBank;
    if (!container || !data || !(data.groups || []).length) {
      return;
    }
    const block = makeTemplateBlock(
      "短语与固定搭配库",
      "按写作功能分类整理，点英文条目可查释义与搭配。",
    );
    block.classList.add("writing-method-phrases");
    if (data.note) {
      const note = document.createElement("p");
      note.className = "writing-method-phrase-note";
      note.textContent = data.note;
      block.append(note);
    }

    const grid = document.createElement("div");
    grid.className = "writing-method-phrase-grid";
    (data.groups || []).forEach((group) => {
      const card = document.createElement("section");
      card.className = "writing-method-phrase-group";
      const h = document.createElement("h5");
      h.textContent = group.title || "";
      card.append(h);
      if (group.intro) {
        const intro = document.createElement("p");
        intro.className = "writing-method-phrase-intro";
        intro.textContent = group.intro;
        card.append(intro);
      }
      const ul = document.createElement("ul");
      (group.items || []).forEach((item) => {
        const li = document.createElement("li");
        const top = document.createElement("div");
        top.className = "writing-method-phrase-top";
        top.append(makePhraseBankToken(item.en || "", item.example || ""));
        [item.level, item.slot].filter(Boolean).forEach((text) => {
          const tag = document.createElement("span");
          tag.className = "writing-method-phrase-tag";
          tag.textContent = text;
          top.append(tag);
        });
        li.append(top);
        if (item.zh) {
          const zh = document.createElement("p");
          zh.className = "writing-method-phrase-zh";
          zh.textContent = item.zh;
          li.append(zh);
        }
        if (item.example) {
          const ex = document.createElement("p");
          ex.className = "writing-method-phrase-example";
          appendExplainableText(ex, item.example, item.example);
          li.append(ex);
        }
        ul.append(li);
      });
      card.append(ul);
      grid.append(card);
    });
    block.append(grid);
    container.append(block);
  }

  function renderMethodLoading(message) {
    if (!els.methodBody) return;
    els.methodBody.textContent = "";
    const p = document.createElement("p");
    p.className = "writing-template-empty";
    p.textContent = message || "正在读取方法论…";
    els.methodBody.append(p);
    if (els.methodMeta) els.methodMeta.textContent = message || "正在读取方法论…";
  }

  function renderMethod() {
    const data = state.method;
    if (!data || !els.methodBody) return;
    els.methodBody.textContent = "";

    /* 万能原因体系 */
    const reasons = data.universalReasons;
    if (reasons) {
      const block = makeTemplateBlock(reasons.title, reasons.intro);
      block.classList.add("writing-method-reasons");
      const grid = document.createElement("div");
      grid.className = "writing-method-reason-grid";
      (reasons.items || []).forEach((item) => {
        const card = document.createElement("article");
        card.className = "writing-method-reason";
        const head = document.createElement("div");
        head.className = "writing-method-reason-head";
        const badge = document.createElement("span");
        badge.className = "writing-method-reason-badge";
        badge.textContent = `万能原因 ${item.index}`;
        const name = document.createElement("strong");
        name.textContent = item.name || "";
        head.append(badge, name);
        card.append(head);

        const fit = document.createElement("p");
        fit.className = "writing-method-reason-fit";
        fit.textContent = `适用：${item.fit || ""}`;
        card.append(fit);

        const en = document.createElement("p");
        en.className = "writing-method-reason-en";
        appendSlotText(en, item.skeleton || "");
        card.append(en);

        const zh = document.createElement("p");
        zh.className = "writing-method-reason-zh";
        zh.textContent = item.zh || "";
        card.append(zh);

        if (item.usage) {
          const usage = document.createElement("p");
          usage.className = "writing-method-reason-usage";
          usage.textContent = `老师提示：${item.usage}`;
          card.append(usage);
        }
        grid.append(card);
      });
      block.append(grid);
      els.methodBody.append(block);
    }

    /* 三段式结构 */
    const structure = data.structure;
    if (structure) {
      const block = makeTemplateBlock(structure.title, structure.intro);
      block.classList.add("writing-method-structure");
      [structure.large, structure.small].filter(Boolean).forEach((group) => {
        const wrap = document.createElement("section");
        wrap.className = "writing-method-structure-group";
        const h = document.createElement("h5");
        h.textContent = group.label || "";
        wrap.append(h);
        (group.paragraphs || []).forEach((para) => {
          const item = document.createElement("article");
          item.className = "writing-method-structure-item";
          const top = document.createElement("div");
          top.className = "writing-method-structure-top";
          const no = document.createElement("span");
          no.className = "writing-method-structure-no";
          no.textContent = para.no || "";
          const goal = document.createElement("strong");
          goal.textContent = para.goal || "";
          const budget = document.createElement("em");
          budget.textContent = para.budget || "";
          top.append(no, goal, budget);
          item.append(top);
          const ul = document.createElement("ul");
          (para.points || []).forEach((pt) => {
            const li = document.createElement("li");
            li.textContent = pt;
            ul.append(li);
          });
          item.append(ul);
          wrap.append(item);
        });
        block.append(wrap);
      });
      els.methodBody.append(block);
    }

    /* 逻辑关系词链 */
    const logic = data.logicChain;
    if (logic) {
      const block = makeTemplateBlock(logic.title, logic.intro);
      block.classList.add("writing-method-logic");
      const ul = document.createElement("ul");
      ul.className = "writing-method-logic-list";
      (logic.groups || []).forEach((g) => {
        const li = document.createElement("li");
        const fn = document.createElement("strong");
        fn.textContent = g.function || "";
        const opts = document.createElement("span");
        opts.textContent = (g.options || []).join(" ｜ ");
        li.append(fn, opts);
        ul.append(li);
      });
      block.append(ul);
      els.methodBody.append(block);
    }

    /* 话题主题词 */
    const topics = data.topicWords;
    if (topics) {
      const block = makeTemplateBlock(topics.title, topics.intro);
      block.classList.add("writing-method-topics");
      const grid = document.createElement("div");
      grid.className = "writing-method-topic-grid";
      (topics.groups || []).forEach((g) => {
        const card = document.createElement("article");
        card.className = "writing-method-topic";
        const h = document.createElement("h5");
        h.textContent = g.topic || "";
        card.append(h);
        const ul = document.createElement("ul");
        (g.words || []).forEach((pair) => {
          const li = document.createElement("li");
          const en = document.createElement("code");
          en.textContent = pair[0];
          const zh = document.createElement("span");
          zh.textContent = pair[1];
          li.append(en, zh);
          ul.append(li);
        });
        card.append(ul);
        grid.append(card);
      });
      block.append(grid);
      els.methodBody.append(block);
    }

    /* 自检清单 */
    const check = data.selfCheck;
    if (check) {
      const block = makeTemplateBlock(check.title, check.intro);
      block.classList.add("writing-method-check");
      (check.blocks || []).forEach((b) => {
        const sec = document.createElement("section");
        sec.className = "writing-method-check-item";
        const h = document.createElement("h5");
        h.textContent = b.name || "";
        sec.append(h);
        if (b.detail) {
          const d = document.createElement("p");
          d.className = "writing-method-check-detail";
          d.textContent = b.detail;
          sec.append(d);
        }
        const ul = document.createElement("ul");
        (b.rules || []).forEach((r) => {
          const li = document.createElement("li");
          li.textContent = r;
          ul.append(li);
        });
        sec.append(ul);
        block.append(sec);
      });
      els.methodBody.append(block);
    }

    renderPhraseBank(els.methodBody);

    if (els.methodMeta) {
      const n = (reasons?.items || []).length;
      const groups = (state.phraseBank?.groups || []).length;
      els.methodMeta.textContent = groups
        ? `方法论已就绪 · 万能原因 ${n} 条 · 短语库 ${groups} 组`
        : `方法论已就绪 · 万能原因 ${n} 条`;
    }
  }

  async function ensureMethod() {
    if (state.method) {
      renderMethod();
      return;
    }
    if (state.methodPromise) {
      await state.methodPromise;
      return;
    }
    renderMethodLoading("正在读取方法论…");
    state.methodPromise = (async () => {
      try {
        const [res, bankRes] = await Promise.all([
          fetch(METHOD_URL, { cache: "force-cache" }),
          fetch(PHRASE_BANK_URL, { cache: "force-cache" }).catch(() => null),
        ]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        state.method = await res.json();
        if (bankRes && bankRes.ok) {
          try {
            state.phraseBank = await bankRes.json();
          } catch (error) {
            state.phraseBank = null;
            console.warn("[writing] 短语库解析失败", error);
          }
        }
        renderMethod();
      } catch (error) {
        renderMethodLoading("方法论读取失败，请刷新页面重试。");
        console.warn("[writing] 方法论加载失败", error);
      } finally {
        state.methodPromise = null;
      }
    })();
    await state.methodPromise;
  }

  function setupMethodLazyLoad() {
    const section = els.methodSection;
    if (!section) return;
    const load = () => ensureMethod();
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          load();
        },
        { rootMargin: "0px" },
      );
      observer.observe(section);
      return;
    }
    const rect = section.getBoundingClientRect();
    if (rect.top < window.innerHeight) load();
  }

  function selectPrompt(id) {
    const item = (state.index?.items || []).find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    state.activeId = id;
    state.activePrompt = null;    state.editorTouched = false;
    storageSet(LAST_PROMPT_KEY, id);
    renderPromptList();
    renderTaskLoading(item);
    setStatus("正在读取题目…");

    const task = loadShard(item.shard)
      .then((shard) => {
        if (state.activeId !== id) {
          return null;
        }
        const prompt = (shard.prompts || []).find((entry) => entry.id === id);
        if (!prompt) {
          throw new Error("题目数据里没有找到这一题");
        }
        state.activePrompt = prompt;
        renderTask(prompt, item);
        // 题目分片可能比用户手速慢，先敲下的内容不能被空草稿盖掉。
        loadDraftIntoEditor(prompt, { keepUserText: state.editorTouched });
        renderCachedGrade(prompt);
        setStatus("");
        return prompt;
      })
      .catch((error) => {
        if (state.activeId !== id) {
          return null;
        }
        renderTaskError(error);
        setStatus(error.message || "题目加载失败，请重试", true);
        return null;
      });

    state.promptPromise = task;
    task.finally(() => {
      if (state.promptPromise === task) {
        state.promptPromise = null;
      }
    });
  }

  function renderTaskLoading(item) {
    if (!els.taskTitle || !els.taskBody) {
      return;
    }
    els.taskTitle.textContent = item.label || "题目";
    if (els.taskMeta) {
      els.taskMeta.textContent = `${item.paperTitle} · 正在加载`;
    }
    els.taskBody.textContent = "";
    const loading = document.createElement("p");
    loading.className = "writing-empty";
    loading.textContent = "正在加载题干、提纲与评分标准…";
    els.taskBody.append(loading);
  }

  function renderTaskError(error) {
    if (!els.taskBody) {
      return;
    }
    els.taskBody.textContent = "";
    const message = document.createElement("p");
    message.className = "writing-empty";
    message.textContent = `题目加载失败：${error.message || "未知错误"}。可以点左侧其它题目重试。`;
    els.taskBody.append(message);
  }

  function renderTask(prompt, item) {
    if (!els.taskBody) {
      return;
    }
    els.taskTitle.textContent = prompt.label || item.label || "题目";
    if (els.taskMeta) {
      els.taskMeta.textContent = [
        prompt.examLabel,
        prompt.year ? `${prompt.year} 年` : "",
        prompt.wordLimit,
        prompt.sourceKind === "curated" ? "题材整理" : "真题题干",
      ]
        .filter(Boolean)
        .join(" · ");
    }

    els.taskBody.textContent = "";
    const paperTitle = document.createElement("p");
    paperTitle.className = "writing-paper-title";
    paperTitle.textContent = prompt.paperTitle || item.paperTitle || "";
    els.taskBody.append(paperTitle);

    const blocks = [];
    if ((prompt.directions || []).length) {
      blocks.push({
        title: "Directions",
        lines: prompt.directions,
        className: "writing-directions",
      });
    }
    if (prompt.prompt) {
      blocks.push({
        title: "题干",
        lines: [prompt.prompt],
        className: "writing-directions",
      });
    }
    if ((prompt.outline || []).length) {
      blocks.push({ title: "写作提纲", lines: prompt.outline });
    }
    if ((prompt.points || []).length) {
      blocks.push({ title: "采分点", lines: prompt.points });
    }
    if ((prompt.rubric || []).length) {
      blocks.push({ title: "评分标准", lines: prompt.rubric });
    }
    if ((prompt.pitfalls || []).length) {
      blocks.push({
        title: "常见失分点",
        lines: prompt.pitfalls,
        className: "is-pitfall",
      });
    }

    blocks.forEach((block) => {
      if (block.className === "writing-directions") {
        const paragraph = document.createElement("p");
        paragraph.className = "writing-directions";
        paragraph.textContent = block.lines.join("\n");
        els.taskBody.append(paragraph);
        return;
      }
      const section = document.createElement("section");
      section.className = `writing-note-block ${block.className || ""}`.trim();
      const heading = document.createElement("h3");
      heading.textContent = block.title;
      const list = document.createElement("ul");
      block.lines.forEach((line) => {
        const itemEl = document.createElement("li");
        itemEl.textContent = line;
        list.append(itemEl);
      });
      section.append(heading, list);
      els.taskBody.append(section);
    });

    const foot = document.createElement("div");
    foot.className = "writing-task-foot";
    const limit = document.createElement("span");
    limit.className = "writing-tag";
    limit.textContent = prompt.wordLimit ? `字数：${prompt.wordLimit}` : "字数：按题目要求";
    const level = document.createElement("span");
    level.className = "writing-tag";
    level.textContent = `满分参考：${maxScoreOf(prompt.exam, prompt)} 分`;
    foot.append(limit, level);
    els.taskBody.append(foot);
    updateWordMeter();
  }

  function maxScoreOf(exam, prompt) {
    const engine = window.IBALL_WRITING_GRADE;
    if (engine?.taskMaxScore) {
      return engine.taskMaxScore(exam, prompt);
    }
    return engine?.MAX_SCORES?.[exam] || 15;
  }

  function loadDraftIntoEditor(prompt, options = {}) {
    const draft = readJson(draftKey(prompt.id));
    if (options.keepUserText) {
      state.grade = null;
      updateWordMeter();
      scheduleDraftSave();
      setDraftStatus("题目刚加载完，已保留你先写下的内容");
      return;
    }
    els.essayInput.value = draft?.text || "";
    state.grade = null;
    updateWordMeter();
    setDraftStatus(draft?.savedAt ? `已恢复本机草稿 · ${formatTime(draft.savedAt)}` : "草稿自动保存在本机");
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function updateWordMeter() {
    const text = els.essayInput?.value || "";
    const words = countWords(text);
    const prompt = state.activePrompt;
    const min = Number(prompt?.wordLimitMin) || 0;
    const max = Number(prompt?.wordLimitMax) || 0;
    if (els.wordCount) {
      els.wordCount.textContent = min || max ? `${words} / ${min || "?"}-${max || "?"} 词` : `${words} 词`;
    }
    if (els.wordMeterBar) {
      const target = max || min || 120;
      const ratio = Math.max(0, Math.min(1, words / Math.max(target, 1)));
      els.wordMeterBar.style.width = `${Math.round(ratio * 100)}%`;
      const meter = els.wordMeterBar.parentElement;
      if (meter) {
        meter.classList.toggle("is-low", Boolean(min) && words < min * 0.8);
        meter.classList.toggle("is-over", Boolean(max) && words > max * 1.15);
      }
    }
  }

  function scheduleDraftSave() {
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveDraft, 420);
  }

  function saveDraft() {
    const prompt = state.activePrompt;
    if (!prompt) {
      return;
    }
    const text = els.essayInput.value;
    if (!text.trim()) {
      storageRemove(draftKey(prompt.id));
      setDraftStatus("草稿已清空");
      renderDraftCount();
      recordDraftScore(prompt, "");
      return;
    }
    const savedAt = new Date().toISOString();
    const ok = writeJson(draftKey(prompt.id), { text, savedAt });
    setDraftStatus(
      ok ? `草稿已保存 · ${formatTime(savedAt)}` : "草稿无法写入本机存储，仍可继续写作",
      !ok,
    );
    renderDraftCount();
    if (!state.grade) {
      recordDraftScore(prompt, text);
    }
  }

  function renderCachedGrade(prompt) {
    const cached = readJson(gradeKey(prompt.id));
    if (cached?.result) {
      state.grade = cached.result;
      renderGrade(cached.result, { cached: true });
      setStatus(`已恢复上次批改结果 · ${formatTime(cached.savedAt)}`);
      recordGradeScore(prompt, cached.result);
      return;
    }
    state.grade = null;
    if (els.gradeResult) {
      els.gradeResult.textContent = "";
    }
    setStatus("");
  }

  function clearResult() {
    if (els.gradeResult) {
      els.gradeResult.textContent = "";
    }
  }

  function gradeLocally(text, prompt) {
    const engine = window.IBALL_WRITING_GRADE;
    if (!engine?.grade) {
      return null;
    }
    return engine.grade({ text, prompt });
  }

  function requestServerGrade(text, prompt) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    return fetch("./api/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        text,
        exam: prompt.exam,
        prompt: {
          id: prompt.id,
          exam: prompt.exam,
          label: prompt.label,
          part: prompt.part,
          prompt: prompt.prompt,
          directions: prompt.directions,
          outline: prompt.outline,
          points: prompt.points,
          rubric: prompt.rubric,
          wordLimit: prompt.wordLimit,
          wordLimitMin: prompt.wordLimitMin,
          wordLimitMax: prompt.wordLimitMax,
        },
      }),
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`批改接口 ${response.status}`);
        }
        return response.json();
      })
      .finally(() => window.clearTimeout(timer));
  }

  async function runGrade() {
    let prompt = state.activePrompt;
    if (!prompt && state.promptPromise) {
      // 题目分片还在路上时点“批改”，等它回来再继续，别误报“没选题”。
      setStatus("正在读取题目…");
      prompt = await state.promptPromise;
    }
    if (!prompt) {
      setStatus("先从左边的题目列表里选一道题。", true);
      return;
    }
    if (state.grading) {
      return;
    }
    const text = els.essayInput.value.trim();
    if (countWords(text) < MIN_WORDS) {
      setStatus("还没有可批改的内容，先写几句再提交。", true);
      els.essayInput.focus();
      return;
    }

    const local = gradeLocally(text, prompt);
    if (local) {
      state.grade = local;
      renderGrade(local, { cached: false });
      writeJson(gradeKey(prompt.id), { result: local, savedAt: new Date().toISOString() });
      recordGradeScore(prompt, local);
    } else {
      clearResult();
    }

    state.grading = true;
    if (els.gradeButton) {
      els.gradeButton.disabled = true;
      els.gradeButton.textContent = "批改中…";
    }
    setStatus(local ? "本地批改已完成，正在请求更细的 AI 批改…" : "正在批改…");

    requestServerGrade(text, prompt)
      .then((payload) => {
        const result = payload?.result;
        if (!payload?.ok || !result) {
          throw new Error(payload?.message || "批改服务暂时不可用");
        }
        state.grade = result;
        renderGrade(result, { cached: false });
        writeJson(gradeKey(prompt.id), { result, savedAt: new Date().toISOString() });
        recordGradeScore(prompt, result);
        setStatus(
          result.engine === "ai"
            ? "AI 批改完成，结果已保存在本机。"
            : "批改完成（规则引擎），结果已保存在本机。",
        );
      })
      .catch((error) => {
        if (local) {
          setStatus(
            `已给出本地批改结果；AI 批改不可用（${error.message || "网络错误"}），稍后可再试。`,
          );
        } else {
          setStatus(`批改失败：${error.message || "未知错误"}`, true);
        }
      })
      .finally(() => {
        state.grading = false;
        if (els.gradeButton) {
          els.gradeButton.disabled = false;
          els.gradeButton.textContent = "批改作文";
        }
      });
  }

  function mergeIssueRanges(issues, length) {
    const ranges = [];
    issues
      .map((issue) => ({
        start: Math.max(0, Number(issue.start) || 0),
        end: Math.min(length, Number(issue.end) || 0),
        issue,
      }))
      .filter((range) => range.end > range.start)
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .forEach((range) => {
        const last = ranges[ranges.length - 1];
        if (last && range.start < last.end) {
          last.end = Math.max(last.end, range.end);
          last.issues.push(range.issue);
          return;
        }
        ranges.push({ start: range.start, end: range.end, issues: [range.issue] });
      });
    return ranges;
  }

  function buildAnnotatedEssay(text, issues) {
    const container = document.createElement("p");
    container.className = "writing-review";
    const ranges = mergeIssueRanges(issues || [], text.length);
    let cursor = 0;
    ranges.forEach((range) => {
      if (range.start > cursor) {
        container.append(document.createTextNode(text.slice(cursor, range.start)));
      }
      const mark = document.createElement("mark");
      mark.className = "writing-mark";
      mark.title = range.issues
        .map((issue) => `${issue.label}：${issue.explanation || ""}${issue.suggestion ? ` → ${issue.suggestion}` : ""}`)
        .join("\n");
      mark.textContent = text.slice(range.start, range.end);
      container.append(mark);
      cursor = range.end;
    });
    if (cursor < text.length) {
      container.append(document.createTextNode(text.slice(cursor)));
    }
    return container;
  }

  function sectionTitle(text, hint) {
    const heading = document.createElement("h3");
    heading.className = "writing-section-title";
    heading.textContent = text;
    if (hint) {
      const span = document.createElement("span");
      span.textContent = hint;
      heading.append(span);
    }
    return heading;
  }

  function lessonStatusLabel(status) {
    if (status === "good") {
      return "已达标";
    }
    if (status === "weak") {
      return "优先处理";
    }
    return "需加强";
  }

  function renderLesson(result) {
    const lesson = result?.lesson;
    if (!lesson || typeof lesson !== "object") {
      return null;
    }
    const hasContent =
      lesson.overview ||
      lesson.focus ||
      (lesson.taskBreakdown || []).length ||
      (lesson.paragraphMap || []).length ||
      (lesson.sentenceWalkthrough || []).length ||
      (lesson.scoreStrategy || []).length ||
      (lesson.patterns || []).length ||
      (lesson.checklist || []).length;
    if (!hasContent) {
      return null;
    }

    const section = document.createElement("section");
    section.className = "writing-lesson";
    section.append(
      sectionTitle("作文讲解", "针对你的原文：审题 → 段落 → 逐句 → 升格 → 复写"),
    );

    if (lesson.overview) {
      const overview = document.createElement("p");
      overview.className = "writing-lesson-overview";
      overview.textContent = lesson.overview;
      section.append(overview);
    }

    if (lesson.focus) {
      const focus = document.createElement("p");
      focus.className = "writing-lesson-focus";
      const label = document.createElement("strong");
      label.textContent = "下一版优先：";
      focus.append(label, document.createTextNode(lesson.focus));
      section.append(focus);
    }

    const addBlock = (title, hint, open) => {
      const details = document.createElement("details");
      details.className = "writing-lesson-block";
      if (open) {
        details.open = true;
      }
      const summary = document.createElement("summary");
      const label = document.createElement("span");
      label.className = "writing-lesson-block-title";
      label.textContent = title;
      const note = document.createElement("span");
      note.className = "writing-lesson-block-hint";
      note.textContent = hint || "";
      summary.append(label, note);
      const body = document.createElement("div");
      body.className = "writing-lesson-block-body";
      details.append(summary, body);
      section.append(details);
      return body;
    };

    if ((lesson.taskBreakdown || []).length) {
      const body = addBlock(
        "审题与评分重点",
        `${lesson.taskBreakdown.length} 个检查项`,
        true,
      );
      const grid = document.createElement("div");
      grid.className = "writing-lesson-grid";
      lesson.taskBreakdown.forEach((item) => {
        const card = document.createElement("div");
        card.className = "writing-lesson-card";
        const head = document.createElement("div");
        head.className = "writing-lesson-card-head";
        const label = document.createElement("strong");
        label.textContent = item.label || "检查项";
        const status = document.createElement("span");
        status.className = `writing-lesson-status is-${item.status || "warn"}`;
        status.textContent = lessonStatusLabel(item.status);
        head.append(label, status);
        const detail = document.createElement("p");
        detail.textContent = item.detail || "";
        card.append(head, detail);
        grid.append(card);
      });
      body.append(grid);
    }

    if ((lesson.paragraphMap || []).length) {
      const body = addBlock(
        "逐段讲解",
        `${lesson.paragraphMap.length} 段，按你的段落顺序`,
        true,
      );
      const list = document.createElement("ol");
      list.className = "writing-paragraph-list";
      lesson.paragraphMap.forEach((item) => {
        const card = document.createElement("li");
        card.className = "writing-paragraph-item";
        const head = document.createElement("div");
        head.className = "writing-paragraph-head";
        const title = document.createElement("strong");
        title.textContent = `第 ${item.paragraph || "?"} 段 · ${item.role || "段落"}`;
        const summary = document.createElement("span");
        summary.textContent = item.summary || "";
        head.append(title, summary);
        card.append(head);
        [
          ["做得好的", item.strength],
          ["具体短板", item.weakness],
          ["本段改法", item.action],
        ].forEach(([label, value]) => {
          if (!value) {
            return;
          }
          const row = document.createElement("p");
          const strong = document.createElement("strong");
          strong.textContent = `${label}：`;
          row.append(strong, document.createTextNode(value));
          card.append(row);
        });
        list.append(card);
      });
      body.append(list);
    }

    if ((lesson.sentenceWalkthrough || []).length) {
      const body = addBlock(
        "逐句讲解",
        `${lesson.sentenceWalkthrough.length} 句，原句均来自你的作文`,
        true,
      );
      const list = document.createElement("ol");
      list.className = "writing-sentence-list";
      lesson.sentenceWalkthrough.forEach((item) => {
        const card = document.createElement("li");
        card.className = "writing-sentence-item";
        const original = document.createElement("p");
        original.className = "writing-sentence-original";
        original.textContent = item.original || "";
        card.append(original);
        [
          ["诊断", item.diagnosis],
          ["为什么", item.why],
          ["升格写法", item.upgrade],
          ["检查方法", item.note],
        ].forEach(([label, value]) => {
          if (!value) {
            return;
          }
          const row = document.createElement("p");
          if (label === "升格写法") {
            row.className = "writing-sentence-upgrade";
          }
          const strong = document.createElement("strong");
          strong.textContent = `${label}：`;
          row.append(strong, document.createTextNode(value));
          card.append(row);
        });
        list.append(card);
      });
      body.append(list);
    }

    if ((lesson.scoreStrategy || []).length) {
      const body = addBlock(
        "提分优先级",
        "按投入产出排序，先做前面的",
        false,
      );
      const list = document.createElement("ol");
      list.className = "writing-strategy-list";
      lesson.scoreStrategy.forEach((item) => {
        const row = document.createElement("li");
        const priority = document.createElement("span");
        priority.className = "writing-strategy-priority";
        priority.textContent = `优先 ${item.priority || ""}`;
        const action = document.createElement("p");
        action.textContent = item.action || "";
        row.append(priority, action);
        if (item.expectedGain) {
          const gain = document.createElement("em");
          gain.textContent = `预计 ${item.expectedGain}`;
          row.append(gain);
        }
        list.append(row);
      });
      body.append(list);
    }

    if ((lesson.patterns || []).length) {
      const body = addBlock(
        "可迁移句式",
        "先理解逻辑，再换成自己的内容",
        false,
      );
      const grid = document.createElement("div");
      grid.className = "writing-pattern-grid";
      lesson.patterns.forEach((item) => {
        const card = document.createElement("div");
        card.className = "writing-pattern-card";
        const pattern = document.createElement("code");
        pattern.textContent = item.pattern || "";
        const usage = document.createElement("p");
        usage.textContent = item.usage || "";
        card.append(pattern, usage);
        if (item.example) {
          const example = document.createElement("p");
          example.className = "writing-pattern-example";
          example.textContent = `Example: ${item.example}`;
          card.append(example);
        }
        grid.append(card);
      });
      body.append(grid);
    }

    if ((lesson.checklist || []).length) {
      const body = addBlock("复写清单", "下一版交卷前逐项打勾", false);
      const list = document.createElement("ul");
      list.className = "writing-checklist";
      lesson.checklist.forEach((item) => {
        const row = document.createElement("li");
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        const text = document.createElement("span");
        text.textContent = String(item || "");
        label.append(box, text);
        row.append(label);
        list.append(row);
      });
      body.append(list);
    }

    return section;
  }

  function renderGrade(result, options = {}) {
    if (!els.gradeResult) {
      return;
    }
    els.gradeResult.textContent = "";
    const fragment = document.createDocumentFragment();

    const head = document.createElement("div");
    head.className = "writing-score-head";
    const score = document.createElement("div");
    score.className = "writing-score-value";
    const scoreStrong = document.createElement("strong");
    scoreStrong.textContent = String(result.score);
    const scoreSmall = document.createElement("small");
    scoreSmall.textContent = `/ ${result.maxScore}`;
    score.append(scoreStrong, scoreSmall);
    const copy = document.createElement("div");
    copy.className = "writing-score-copy";
    const band = document.createElement("strong");
    band.textContent = `${result.taskType ? `${result.taskType} · ` : ""}评级：${
      result.band?.label || "已完成"
    }${result.band?.range ? ` · ${result.band.range}` : ""}`;
    const meta = document.createElement("span");
    meta.textContent = `${result.words} 词 · ${result.paragraphs} 段 · ${result.sentences} 句 · ${
      (result.dimensions || [])
        .map(
          (item) =>
            `${item.label} ${item.scaled ?? item.score}${item.points ? `/${item.points}` : ""}`,
        )
        .join(" / ")
    }`;
    const engine = document.createElement("span");
    engine.className = "writing-engine";
    engine.textContent =
      (result.engine === "ai" ? "AI 批改" : "本地规则引擎 · 断网可用") +
      (result.official === false ? " · 非官方模拟分" : "");
    copy.append(band, meta, engine);
    head.append(score, copy);
    fragment.append(head);

    if (result.scoreNotice) {
      const notice = document.createElement("p");
      notice.className = "writing-panel-hint";
      notice.textContent = result.scoreNotice;
      fragment.append(notice);
    }

    if (options.cached) {
      const hint = document.createElement("p");
      hint.className = "writing-panel-hint";
      // 旧缓存（讲解功能上线前保存的）没有 lesson，提示用户重新批改一次。
      hint.textContent = result.lesson
        ? "这是本机保存的上次批改结果，改动作文后重新点“批改作文”即可刷新。"
        : "这是本机保存的旧版批改结果，还没有逐段逐句讲解；重新点“批改作文”即可生成。";
      fragment.append(hint);
    }

    const lesson = renderLesson(result);
    if (lesson) {
      fragment.append(lesson);
    }

    if ((result.dimensions || []).length) {
      const dimensionHint = result.taskType
        ? `${result.taskType} · 满分 ${result.maxScore} 分`
        : `满分 ${result.maxScore} 分`;
      fragment.append(sectionTitle("分项得分", dimensionHint));
      const dimensions = document.createElement("div");
      dimensions.className = "writing-dimensions";
      result.dimensions.forEach((item) => {
        const card = document.createElement("div");
        card.className = "writing-dimension";
        const headRow = document.createElement("div");
        headRow.className = "writing-dimension-head";
        const label = document.createElement("span");
        label.textContent = item.label;
        const value = document.createElement("span");
        value.textContent = `${item.scaled ?? item.score} / ${item.points ?? item.max}`;
        headRow.append(label, value);
        const bar = document.createElement("div");
        bar.className = "writing-dimension-bar";
        const fill = document.createElement("span");
        fill.style.width = `${Math.max(0, Math.min(100, item.score))}%`;
        bar.append(fill);
        card.append(headRow, bar);
        if (item.note) {
          const note = document.createElement("p");
          note.textContent = item.note;
          card.append(note);
        }
        dimensions.append(card);
      });
      fragment.append(dimensions);
    }

    const text = els.essayInput.value.trim();
    if (text) {
      fragment.append(
        sectionTitle(
          "逐句标注",
          `${result.issueCount || 0} 处问题，鼠标悬停可看解释`,
        ),
      );
      fragment.append(buildAnnotatedEssay(text, result.issues || []));
    }

    if ((result.issues || []).length) {
      const list = document.createElement("ul");
      list.className = "writing-issues";
      result.issues.slice(0, 20).forEach((issue) => {
        const item = document.createElement("li");
        item.className = "writing-issue";
        const title = document.createElement("strong");
        title.textContent = `${issue.label} · ${issue.severity === "error" ? "错误" : "建议"}`;
        const body = document.createElement("p");
        body.textContent = issue.explanation || "";
        const fix = document.createElement("p");
        const code = document.createElement("code");
        code.textContent = issue.original || "";
        fix.append(code, document.createTextNode(` → ${issue.suggestion || ""}`));
        item.append(title, body, fix);
        list.append(item);
      });
      fragment.append(sectionTitle("问题清单", "按出现顺序排列"));
      fragment.append(list);
    }

    if ((result.replacements || []).length) {
      fragment.append(sectionTitle("词汇替换建议", "优先替换出现次数最多的表达"));
      const list = document.createElement("ul");
      list.className = "writing-improvements";
      result.replacements.forEach((item) => {
        const card = document.createElement("li");
        card.className = "writing-improvement";
        const headRow = document.createElement("div");
        headRow.className = "writing-improvement-head";
        const from = document.createElement("s");
        from.textContent = item.from;
        const arrow = document.createElement("span");
        arrow.textContent = "→";
        const to = document.createElement("em");
        to.textContent = item.to;
        headRow.append(from, arrow, to);
        const reason = document.createElement("p");
        reason.textContent = `${item.reason}（出现 ${item.count} 次）`;
        card.append(headRow, reason);
        list.append(card);
      });
      fragment.append(list);
    }

    if ((result.sentenceTips || []).length) {
      fragment.append(sectionTitle("句式优化", "按优先级排序"));
      const list = document.createElement("ul");
      list.className = "writing-issues";
      result.sentenceTips.forEach((tip) => {
        const item = document.createElement("li");
        item.className = "writing-issue";
        const title = document.createElement("strong");
        title.textContent = tip.title;
        const body = document.createElement("p");
        body.textContent = tip.detail;
        item.append(title, body);
        if (tip.excerpt) {
          const excerpt = document.createElement("p");
          excerpt.textContent = `例句：${tip.excerpt}`;
          item.append(excerpt);
        }
        list.append(item);
      });
      fragment.append(list);
    }

    if ((result.feedback || []).length) {
      fragment.append(sectionTitle("总评", "阅卷视角"));
      const review = document.createElement("p");
      review.className = "writing-review";
      review.textContent = result.feedback.join("\n");
      fragment.append(review);
    }

    if ((result.nextSteps || []).length) {
      fragment.append(sectionTitle("下一步", "照着改一遍比再看一遍有效"));
      const list = document.createElement("ul");
      list.className = "writing-next-steps";
      result.nextSteps.forEach((step) => {
        const item = document.createElement("li");
        item.textContent = step;
        list.append(item);
      });
      fragment.append(list);
    }

    els.gradeResult.append(fragment);
    renderModelSection();
  }

  function currentModel() {
    const prompt = state.activePrompt;
    if (!prompt) {
      return null;
    }
    const result = state.grade;
    const score = result?.score;
    return { prompt, result, score };
  }

  function renderModelSection() {
    if (!els.gradeResult) {
      return;
    }
    const existing = els.gradeResult.querySelector(".writing-model");
    if (existing) {
      existing.remove();
    }
    const context = currentModel();
    if (!context) {
      return;
    }
    const { prompt, result } = context;
    const paragraphs = (prompt.model || []).length
      ? prompt.model
      : result?.model?.paragraphs || [];
    const translations = prompt.modelTranslation || [];
    if (!paragraphs.length) {
      return;
    }

    const section = document.createElement("section");
    section.className = "writing-model";
    section.hidden = true;
    section.append(sectionTitle("范文参考", prompt.model?.length ? "本题目参考范文" : "按题干生成"));

    if (!prompt.model?.length && result?.model?.notice) {
      const notice = document.createElement("p");
      notice.className = "writing-panel-hint";
      notice.textContent = result.model.notice;
      section.append(notice);
    }

    const body = document.createElement("div");
    body.className = "writing-model-text";
    paragraphs.forEach((paragraph) => {
      const item = document.createElement("p");
      appendExplainableText(item, paragraph, paragraph);
      body.append(item);
    });
    section.append(body);

    if (translations.length) {
      const zh = document.createElement("div");
      zh.className = "writing-model-zh";
      translations.forEach((paragraph) => {
        const item = document.createElement("p");
        item.textContent = paragraph;
        zh.append(item);
      });
      section.append(zh);
    }

    const actions = document.createElement("div");
    actions.className = "writing-task-foot";
    const speak = document.createElement("button");
    speak.type = "button";
    speak.className = "tool-button";
    speak.textContent = "朗读范文";
    speak.addEventListener("click", () => speakModel(paragraphs));
    const hide = document.createElement("button");
    hide.type = "button";
    hide.className = "tool-button";
    hide.textContent = "收起范文";
    hide.addEventListener("click", () => {
      section.hidden = true;
    });
    actions.append(speak, hide);
    section.append(actions);

    els.gradeResult.append(section);
  }

  function speakModel(paragraphs) {
    if (!window.IballSpeech?.speakSequence) {
      setStatus("当前浏览器不支持朗读，请更换 Chrome 或 Edge。", true);
      return;
    }
    window.IballSpeech.speakSequence(
      (paragraphs || []).map((text) => ({ text, lang: "en-US" })),
      { label: "范文朗读", rate: 0.9 },
    );
  }

  function toggleModel() {
    const section = els.gradeResult?.querySelector(".writing-model");
    if (!section) {
      if (!state.grade) {
        setStatus("先点“批改作文”，生成结果后就能看到范文参考。", true);
        return;
      }
      renderModelSection();
    }
    const target = els.gradeResult?.querySelector(".writing-model");
    if (target) {
      target.hidden = !target.hidden;
      if (!target.hidden) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function bindEvents() {
    els.examTabs?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-exam]");
      if (!button) {
        return;
      }
      const exam = button.dataset.exam;
      if (!EXAM_ORDER.includes(exam) || exam === state.exam) {
        return;
      }
      state.exam = exam;
      state.year = "";
      state.activeId = "";
      state.activePrompt = null;
      state.editorTouched = false;
      state.grade = null;
      els.examTabs.querySelectorAll("[data-exam]").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-pressed", String(active));
      });
      els.essayInput.value = "";
      clearResult();
      setStatus("");
      renderYearSelect();
      renderPromptList();
      renderEmptyTask();
      updateWordMeter();
    });

    els.yearSelect?.addEventListener("change", () => {
      state.year = els.yearSelect.value;
      renderPromptList();
    });

    let searchTimer = 0;
    els.promptSearch?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.query = els.promptSearch.value;
        renderPromptList();
      }, 180);
    });

    els.draftOnlyButton?.addEventListener("click", () => {
      state.draftOnly = !state.draftOnly;
      renderPromptList();
    });

    els.clearDraftButton?.addEventListener("click", () => {
      if (!state.activePrompt) {
        setStatus("先选一道题。", true);
        return;
      }
      storageRemove(draftKey(state.activePrompt.id));
      storageRemove(gradeKey(state.activePrompt.id));
      els.essayInput.value = "";
      state.editorTouched = false;
      state.grade = null;
      clearResult();
      updateWordMeter();
      setDraftStatus("草稿和上次批改结果已清空");
      clearScore(state.activePrompt);
      renderPromptList();
    });

    els.essayInput?.addEventListener("input", () => {
      state.editorTouched = true;
      updateWordMeter();
      scheduleDraftSave();
    });

    els.gradeButton?.addEventListener("click", runGrade);
    els.modelButton?.addEventListener("click", toggleModel);
    els.speakModelButton?.addEventListener("click", () => {
      const prompt = state.activePrompt;
      if (!prompt) {
        setStatus("先选一道题。", true);
        return;
      }
      const paragraphs = (prompt.model || []).length
        ? prompt.model
        : state.grade?.model?.paragraphs || [];
      if (!paragraphs.length) {
        setStatus("这道题暂时没有范文，先点“批改作文”生成框架范文。", true);
        return;
      }
      speakModel(paragraphs);
    });

    els.templateExamTabs?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-exam]");
      if (!button) {
        return;
      }
      switchTemplateExam(button.dataset.exam);
    });

    els.templateKindTabs?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-kind]");
      if (!button) {
        return;
      }
      switchTemplateKind(button.dataset.kind);
    });

    document.addEventListener("click", (event) => {
      if (event.target.closest("#writingWordClose")) {
        closeWritingWordPanel();
        return;
      }
      const token = event.target.closest(".writing-page .word-token");
      if (!token) {
        return;
      }
      event.preventDefault();
      openWritingWordPanel(
        token.dataset.word,
        token.dataset.sentence,
        token.dataset.tokenIndex,
      );
    });

    document.addEventListener("keydown", (event) => {
      if (
        event.key === "Escape" &&
        els.writingWordPanel &&
        !els.writingWordPanel.hidden
      ) {
        closeWritingWordPanel();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      const token = event.target.closest(".writing-page .word-token");
      if (!token) {
        return;
      }
      event.preventDefault();
      openWritingWordPanel(
        token.dataset.word,
        token.dataset.sentence,
        token.dataset.tokenIndex,
      );
    });

    els.writingWordSpeak?.addEventListener("click", speakWritingWord);
  }

  function renderEmptyTask() {
    if (!els.taskBody) {
      return;
    }
    els.taskTitle.textContent = "题目与评分标准";
    if (els.taskMeta) {
      els.taskMeta.textContent = "";
    }
    els.taskBody.textContent = "";
    const empty = document.createElement("p");
    empty.className = "writing-empty";
    empty.textContent = "从左侧挑一道题开始写作，题干、提纲、采分点与评分标准会显示在这里。";
    els.taskBody.append(empty);
  }

  function restoreInitialSelection() {
    const lastId = storageGet(LAST_PROMPT_KEY);
    const item = (state.index?.items || []).find((entry) => entry.id === lastId);
    if (item && EXAM_ORDER.includes(item.exam)) {
      state.exam = item.exam;
      els.examTabs?.querySelectorAll("[data-exam]").forEach((tab) => {
        const active = tab.dataset.exam === item.exam;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-pressed", String(active));
      });
      renderYearSelect();
      renderPromptList();
      selectPrompt(item.id);
      return;
    }
    const first = filteredItems()[0];
    if (first) {
      selectPrompt(first.id);
    } else {
      renderEmptyTask();
    }
  }

  function init() {
    cacheDom();
    bindEvents();
    setupTemplateLazyLoad();
    setupMethodLazyLoad();
    renderDraftCount();
    updateWordMeter();
    fetch(INDEX_URL, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`题库索引加载失败（${response.status}）`);
        }
        return response.json();
      })
      .then((data) => {
        state.index = data;
        renderHeroStats();
        renderYearSelect();
        renderPromptList();
        restoreInitialSelection();
      })
      .catch((error) => {
        if (els.promptMeta) {
          els.promptMeta.textContent = "题库加载失败";
        }
        renderTaskError(error);
        setStatus(error.message || "题库加载失败，请刷新重试", true);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();