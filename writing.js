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
  const SHARD_CACHE_PREFIX = "iball-writing-shard:";
  const DRAFT_PREFIX = "iball-writing-draft:";
  const GRADE_PREFIX = "iball-writing-grade:";
  const LAST_PROMPT_KEY = "iball-writing-last-prompt";
  const API_TIMEOUT_MS = 20000;
  const MIN_WORDS = 1;
  const EXAM_ORDER = ["cet4", "cet6", "english-i", "english-ii"];
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
    shards: new Map(),
    shardPromises: new Map(),
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
      return Object.keys(window.localStorage);
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

  function shardCacheKey(name) {
    return `${SHARD_CACHE_PREFIX}${name}`;
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

  function selectPrompt(id) {
    const item = (state.index?.items || []).find((entry) => entry.id === id);
    if (!item) {
      return;
    }
    state.activeId = id;
    state.activePrompt = null;
    storageSet(LAST_PROMPT_KEY, id);
    renderPromptList();
    renderTaskLoading(item);
    setStatus("正在读取题目…");

    loadShard(item.shard)
      .then((shard) => {
        if (state.activeId !== id) {
          return;
        }
        const prompt = (shard.prompts || []).find((entry) => entry.id === id);
        if (!prompt) {
          throw new Error("题目数据里没有找到这一题");
        }
        state.activePrompt = prompt;
        renderTask(prompt, item);
        loadDraftIntoEditor(prompt);
        renderCachedGrade(prompt);
        setStatus("");
      })
      .catch((error) => {
        if (state.activeId !== id) {
          return;
        }
        renderTaskError(error);
        setStatus(error.message || "题目加载失败，请重试", true);
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
    level.textContent = `满分参考：${maxScoreOf(prompt.exam)} 分`;
    foot.append(limit, level);
    els.taskBody.append(foot);
    updateWordMeter();
  }

  function maxScoreOf(exam) {
    return window.IBALL_WRITING_GRADE?.MAX_SCORES?.[exam] || 15;
  }

  function loadDraftIntoEditor(prompt) {
    const draft = readJson(draftKey(prompt.id));
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
      return;
    }
    const savedAt = new Date().toISOString();
    const ok = writeJson(draftKey(prompt.id), { text, savedAt });
    setDraftStatus(
      ok ? `草稿已保存 · ${formatTime(savedAt)}` : "草稿无法写入本机存储，仍可继续写作",
      !ok,
    );
    renderDraftCount();
  }

  function renderCachedGrade(prompt) {
    const cached = readJson(gradeKey(prompt.id));
    if (cached?.result) {
      state.grade = cached.result;
      renderGrade(cached.result, { cached: true });
      setStatus(`已恢复上次批改结果 · ${formatTime(cached.savedAt)}`);
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

  function runGrade() {
    const prompt = state.activePrompt;
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
    band.textContent = `评级：${result.band?.label || "已完成"}`;
    const meta = document.createElement("span");
    meta.textContent = `${result.words} 词 · ${result.paragraphs} 段 · ${result.sentences} 句 · ${
      (result.dimensions || []).map((item) => `${item.label} ${item.score}`).join(" / ")
    }`;
    const engine = document.createElement("span");
    engine.className = "writing-engine";
    engine.textContent =
      result.engine === "ai" ? "AI 批改" : "本地规则引擎 · 断网可用";
    copy.append(band, meta, engine);
    head.append(score, copy);
    fragment.append(head);

    if (options.cached) {
      const hint = document.createElement("p");
      hint.className = "writing-panel-hint";
      hint.textContent = "这是本机保存的上次批改结果，改动作文后重新点“批改作文”即可刷新。";
      fragment.append(hint);
    }

    if ((result.dimensions || []).length) {
      fragment.append(sectionTitle("分项得分", "满分按考试类型折算"));
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
        value.textContent = `${item.score} / ${item.max}`;
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
      item.textContent = paragraph;
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
      state.grade = null;
      clearResult();
      updateWordMeter();
      setDraftStatus("草稿和上次批改结果已清空");
      renderPromptList();
    });

    els.essayInput?.addEventListener("input", () => {
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
