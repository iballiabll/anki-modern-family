/**
 * 封神之路 · 本地数据层。
 *
 * 所有学习数据（计划任务、录入记录、章节进度、目标设置）都存在这里，
 * 默认是空的，只有自己录入才会产生数据。存储键交给 account-store.js
 * 做的账号命名空间包装，所以同一台电脑上不同 iball 账号互不可见，
 * 登录后还会跟着 /api/progress 自动同步。这里不接入任何第三方账号。
 */
(function () {
  "use strict";

  const KEY = "yantu:v1";
  const VERSION = 3;
  const MIN_ROUND = 1;
  const MAX_ROUND = 5;
  const KNOWLEDGE_STATUS = ["待复盘", "已复盘", "已掌握"];

  function nowISO() {
    return new Date().toISOString();
  }

  /** 本地日期（YYYY-MM-DD），和 app.js 的 dateKey 保持一致，避免跨时区偏一天。 */
  function todayKey(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function defaultProfile() {
    return {
      examDate: "2027-12-25",
      school: "",
      major: "",
      target: { math: 130, english: 75, cs408: 115, politics: 70 },
      showPolitics: false,
    };
  }

  function emptyState() {
    return {
      version: VERSION,
      profile: defaultProfile(),
      tasks: [],
      records: [],
      knowledge: [],
      progress: {},
      bookRounds: {},
      meta: { createdAt: nowISO(), updatedAt: "" },
    };
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function cleanRound(value, fallback = MIN_ROUND) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return fallback;
    return Math.max(MIN_ROUND, Math.min(MAX_ROUND, number));
  }

  function cleanBookRounds(value) {
    const out = {};
    if (!isObject(value)) return out;
    for (const [key, round] of Object.entries(value)) {
      const normalizedKey = String(key || "").trim().slice(0, 160);
      if (!normalizedKey) continue;
      out[normalizedKey] = cleanRound(round);
    }
    return out;
  }

  /** 把线上/导入的数据补全成当前版本的结构，缺字段一律退回默认值。 */
  function normalize(raw) {
    const base = emptyState();
    if (!isObject(raw)) {
      return base;
    }
    const profile = isObject(raw.profile) ? raw.profile : {};
    const target = isObject(profile.target) ? profile.target : {};
    return {
      version: VERSION,
      profile: {
        examDate: typeof profile.examDate === "string" && profile.examDate ? profile.examDate : base.profile.examDate,
        school: typeof profile.school === "string" ? profile.school : "",
        major: typeof profile.major === "string" ? profile.major : "",
        target: {
          math: Number(target.math) || base.profile.target.math,
          english: Number(target.english) || base.profile.target.english,
          cs408: Number(target.cs408) || base.profile.target.cs408,
          politics: Number(target.politics) || base.profile.target.politics,
        },
        showPolitics: Boolean(profile.showPolitics),
      },
      tasks: (Array.isArray(raw.tasks) ? raw.tasks : []).filter(isObject).map((task) => ({
        id: String(task.id || uid()),
        date: String(task.date || ""),
        title: String(task.title || "").slice(0, 200),
        subject: String(task.subject || ""),
        minutes: Math.max(0, Number(task.minutes) || 0),
        priority: ["高", "中", "低"].includes(task.priority) ? task.priority : "中",
        note: String(task.note || "").slice(0, 500),
        done: Boolean(task.done),
        createdAt: String(task.createdAt || nowISO()),
        updatedAt: String(task.updatedAt || task.createdAt || nowISO()),
      })),
      records: (Array.isArray(raw.records) ? raw.records : []).filter(isObject).map((record) => ({
        id: String(record.id || uid()),
        date: String(record.date || ""),
        subject: String(record.subject || ""),
        source: String(record.source || ""),
        year: String(record.year || ""),
        paper: String(record.paper || ""),
        module: String(record.module || ""),
        kind: String(record.kind || ""),
        question: String(record.question || ""),
        status: String(record.status || "套卷成绩"),
        full: Math.max(0, Number(record.full) || 0),
        score: Math.max(0, Number(record.score) || 0),
        correct: Math.max(0, Number(record.correct) || 0),
        count: Math.max(0, Number(record.count) || 0),
        minutes: Math.max(0, Number(record.minutes) || 0),
        errorType: String(record.errorType || ""),
        reviewDate: String(record.reviewDate || ""),
        reviewCount: Math.max(0, Number(record.reviewCount) || 0),
        lastReviewDate: String(record.lastReviewDate || ""),
        errorCount: Math.max(0, Number(record.errorCount) || 0),
        explanation: String(record.explanation || "").slice(0, 6000),
        note: String(record.note || "").slice(0, 2000),
        round: cleanRound(record.round),
        createdAt: String(record.createdAt || nowISO()),
        updatedAt: String(record.updatedAt || record.createdAt || nowISO()),
      })),
      knowledge: (Array.isArray(raw.knowledge) ? raw.knowledge : [])
        .filter(isObject)
        .map((item) => ({
          id: String(item.id || uid()),
          date: String(item.date || ""),
          subject: String(item.subject || ""),
          topic: String(item.topic || "").slice(0, 200),
          detail: String(item.detail || "").slice(0, 4000),
          reviewDate: String(item.reviewDate || ""),
          status: KNOWLEDGE_STATUS.includes(item.status) ? item.status : "待复盘",
          reviewCount: Math.max(0, Number(item.reviewCount) || 0),
          lastReviewDate: String(item.lastReviewDate || ""),
          logs: cleanKnowledgeLogs(item.logs),
          createdAt: String(item.createdAt || nowISO()),
          updatedAt: String(item.updatedAt || item.createdAt || nowISO()),
        })),
      progress: progress(),
      bookRounds: cleanBookRounds(raw.bookRounds),
      meta: {
        createdAt: String(raw.meta?.createdAt || nowISO()),
        updatedAt: String(raw.meta?.updatedAt || ""),
      },
    };

    function progress() {
      const out = {};
      if (isObject(raw.progress)) {
        for (const [key, value] of Object.entries(raw.progress)) {
          if (!isObject(value)) continue;
          out[key] = {
            done: Math.max(0, Number(value.done) || 0),
            total: Math.max(0, Number(value.total) || 0),
            accuracy: Math.max(0, Math.min(100, Number(value.accuracy) || 0)),
            wrong: Math.max(0, Number(value.wrong) || 0),
            note: String(value.note || "").slice(0, 1000),
            updatedAt: String(value.updatedAt || nowISO()),
          };
        }
      }
      return out;
    }
  }

  /** 复盘笔记只追加不覆盖，每条带自己的时间戳，最多留最近 200 条。 */
  function cleanKnowledgeLogs(value) {
    const list = Array.isArray(value) ? value : [];
    return list
      .filter(isObject)
      .map((item) => ({
        at: String(item.at || nowISO()),
        text: String(item.text || "").slice(0, 2000),
      }))
      .filter((item) => item.text)
      .slice(-200);
  }

  function cleanProgress(value) {
    const source = isObject(value) ? value : {};
    return {
      done: Math.max(0, Number(source.done) || 0),
      total: Math.max(0, Number(source.total) || 0),
      accuracy: Math.max(0, Math.min(100, Number(source.accuracy) || 0)),
      wrong: Math.max(0, Number(source.wrong) || 0),
      note: String(source.note || "").slice(0, 1000),
      updatedAt: String(source.updatedAt || nowISO()),
    };
  }

  function cleanTask(input, base) {
    const source = isObject(input) ? input : {};
    const previous = isObject(base) ? base : {};
    return {
      id: String(source.id || previous.id || uid()),
      date: String(source.date ?? previous.date ?? ""),
      title: String(source.title ?? previous.title ?? "").slice(0, 200),
      subject: String(source.subject ?? previous.subject ?? ""),
      minutes: Math.max(0, Number(source.minutes ?? previous.minutes) || 0),
      priority: ["高", "中", "低"].includes(source.priority)
        ? source.priority
        : ["高", "中", "低"].includes(previous.priority)
          ? previous.priority
          : "中",
      note: String(source.note ?? previous.note ?? "").slice(0, 500),
      done: source.done === undefined ? Boolean(previous.done) : Boolean(source.done),
      createdAt: String(source.createdAt || previous.createdAt || nowISO()),
      updatedAt: nowISO(),
    };
  }

  function cleanRecord(input, base) {
    const source = isObject(input) ? input : {};
    const previous = isObject(base) ? base : {};
    const pick = (key) => (source[key] === undefined ? previous[key] : source[key]);
    return {
      id: String(source.id || previous.id || uid()),
      date: String(pick("date") || ""),
      subject: String(pick("subject") || ""),
      source: String(pick("source") || ""),
      year: String(pick("year") || ""),
      paper: String(pick("paper") || ""),
      module: String(pick("module") || ""),
      kind: String(pick("kind") || ""),
      question: String(pick("question") || ""),
      status: String(pick("status") || "套卷成绩"),
      full: Math.max(0, Number(pick("full")) || 0),
      score: Math.max(0, Number(pick("score")) || 0),
      correct: Math.max(0, Number(pick("correct")) || 0),
      count: Math.max(0, Number(pick("count")) || 0),
      minutes: Math.max(0, Number(pick("minutes")) || 0),
      errorType: String(pick("errorType") || ""),
      reviewDate: String(pick("reviewDate") || ""),
      reviewCount: Math.max(0, Number(pick("reviewCount")) || 0),
      lastReviewDate: String(pick("lastReviewDate") || ""),
      errorCount: Math.max(0, Number(pick("errorCount")) || 0),
      explanation: String(pick("explanation") || "").slice(0, 6000),
      note: String(pick("note") || "").slice(0, 2000),
      round: cleanRound(pick("round"), cleanRound(previous.round)),
      createdAt: String(source.createdAt || previous.createdAt || nowISO()),
      updatedAt: nowISO(),
    };
  }

  function cleanKnowledge(input, base) {
    const source = isObject(input) ? input : {};
    const previous = isObject(base) ? base : {};
    const pick = (key) => (source[key] === undefined ? previous[key] : source[key]);
    const status = pick("status");
    return {
      id: String(source.id || previous.id || uid()),
      date: String(pick("date") || ""),
      subject: String(pick("subject") || ""),
      topic: String(pick("topic") || "").slice(0, 200),
      detail: String(pick("detail") || "").slice(0, 4000),
      reviewDate: String(pick("reviewDate") || ""),
      status: KNOWLEDGE_STATUS.includes(status) ? status : "待复盘",
      reviewCount: Math.max(0, Number(pick("reviewCount")) || 0),
      lastReviewDate: String(pick("lastReviewDate") || ""),
      logs: cleanKnowledgeLogs(pick("logs")),
      createdAt: String(source.createdAt || previous.createdAt || nowISO()),
      updatedAt: nowISO(),
    };
  }

  function uid() {
    return `y${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  let state = loadFromStorage();
  const listeners = new Set();

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : emptyState();
    } catch {
      return emptyState();
    }
  }

  function notify(reason) {
    for (const listener of listeners) {
      try {
        listener(state, reason);
      } catch {
        // 单个订阅者出错不影响其它页面区域刷新。
      }
    }
  }

  function persist(reason = "update") {
    state.meta.updatedAt = nowISO();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // 隐私模式或配额满时保留内存里的数据，页面照常可用。
    }
    notify(reason);
    return state;
  }

  window.YANTU_STORE = {
    KEY,
    get() {
      return state;
    },
    profile() {
      return state.profile;
    },
    updateProfile(patch) {
      const next = isObject(patch) ? patch : {};
      state.profile = {
        ...state.profile,
        ...(next.examDate === undefined ? {} : { examDate: String(next.examDate || state.profile.examDate) }),
        ...(next.school === undefined ? {} : { school: String(next.school).slice(0, 80) }),
        ...(next.major === undefined ? {} : { major: String(next.major).slice(0, 80) }),
        ...(next.showPolitics === undefined ? {} : { showPolitics: Boolean(next.showPolitics) }),
        ...(isObject(next.target)
          ? {
              target: {
                ...state.profile.target,
                ...Object.fromEntries(
                  Object.entries(next.target)
                    .map(([key, value]) => [key, Math.max(0, Number(value) || 0)])
                    .filter(([key]) => ["math", "english", "cs408", "politics"].includes(key)),
                ),
              },
            }
          : {}),
      };
      return persist("profile");
    },
    tasks() {
      return state.tasks;
    },
    tasksOf(date) {
      return state.tasks
        .filter((task) => task.date === date)
        .sort((left, right) => Number(left.done) - Number(right.done) || left.createdAt.localeCompare(right.createdAt));
    },
    getTask(id) {
      return state.tasks.find((task) => task.id === id) || null;
    },
    addTask(input) {
      const task = cleanTask(input);
      state.tasks.push(task);
      persist("tasks");
      return task;
    },
    updateTask(id, patch) {
      const index = state.tasks.findIndex((task) => task.id === id);
      if (index < 0) return null;
      state.tasks[index] = cleanTask({ ...patch, id }, state.tasks[index]);
      persist("tasks");
      return state.tasks[index];
    },
    removeTask(id) {
      const before = state.tasks.length;
      state.tasks = state.tasks.filter((task) => task.id !== id);
      if (state.tasks.length === before) return false;
      persist("tasks");
      return true;
    },
    records() {
      return state.records;
    },
    recordsOf(subjects) {
      const list = Array.isArray(subjects) ? subjects : [subjects];
      return state.records
        .filter((record) => list.includes(record.subject))
        .sort((left, right) => (right.date + right.createdAt).localeCompare(left.date + left.createdAt));
    },
    getRecord(id) {
      return state.records.find((record) => record.id === id) || null;
    },
    upsertRecord(input) {
      const source = isObject(input) ? input : {};
      const index = source.id ? state.records.findIndex((record) => record.id === source.id) : -1;
      if (index >= 0) {
        state.records[index] = cleanRecord(source, state.records[index]);
        persist("records");
        return state.records[index];
      }
      const record = cleanRecord(source);
      state.records.push(record);
      persist("records");
      return record;
    },
    removeRecord(id) {
      const before = state.records.length;
      state.records = state.records.filter((record) => record.id !== id);
      if (state.records.length === before) return false;
      persist("records");
      return true;
    },
    knowledge() {
      return [...state.knowledge].sort((left, right) =>
        `${right.date}${right.createdAt}`.localeCompare(`${left.date}${left.createdAt}`),
      );
    },
    knowledgeOf(date) {
      return state.knowledge
        .filter((item) => item.date === date)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },
    getKnowledge(id) {
      return state.knowledge.find((item) => item.id === id) || null;
    },
    addKnowledge(input) {
      const item = cleanKnowledge(input);
      state.knowledge.push(item);
      persist("knowledge");
      return item;
    },
    updateKnowledge(id, patch) {
      const index = state.knowledge.findIndex((item) => item.id === id);
      if (index < 0) return null;
      state.knowledge[index] = cleanKnowledge({ ...patch, id }, state.knowledge[index]);
      persist("knowledge");
      return state.knowledge[index];
    },
    /** 复盘笔记按时间戳追加，历史一条都不覆盖。 */
    appendKnowledgeLog(id, text) {
      const index = state.knowledge.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const line = String(text || "").trim().slice(0, 2000);
      if (!line) return state.knowledge[index];
      const current = state.knowledge[index];
      state.knowledge[index] = cleanKnowledge(
        {
          id,
          logs: [...current.logs, { at: nowISO(), text: line }],
          reviewCount: (Number(current.reviewCount) || 0) + 1,
          lastReviewDate: todayKey(),
          status: current.status === "待复盘" ? "已复盘" : current.status,
        },
        current,
      );
      persist("knowledge");
      return state.knowledge[index];
    },
    removeKnowledge(id) {
      const before = state.knowledge.length;
      state.knowledge = state.knowledge.filter((item) => item.id !== id);
      if (state.knowledge.length === before) return false;
      persist("knowledge");
      return true;
    },
    progressOf(key) {
      return state.progress[key] || null;
    },
    bookRound(key) {
      const normalizedKey = String(key || "").trim();
      return normalizedKey ? cleanRound(state.bookRounds[normalizedKey]) : MIN_ROUND;
    },
    setBookRound(key, round) {
      const normalizedKey = String(key || "").trim().slice(0, 160);
      if (!normalizedKey) return MIN_ROUND;
      const value = cleanRound(round);
      state.bookRounds[normalizedKey] = value;
      persist("book-round");
      return value;
    },
    setProgress(key, patch) {
      if (!key) return null;
      state.progress[key] = cleanProgress({ ...(state.progress[key] || {}), ...(isObject(patch) ? patch : {}) });
      persist("progress");
      return state.progress[key];
    },
    removeProgress(key) {
      if (!state.progress[key]) return false;
      delete state.progress[key];
      persist("progress");
      return true;
    },
    removeProgressKeys(keys) {
      const list = (Array.isArray(keys) ? keys : [keys]).map((key) => String(key || "")).filter(Boolean);
      let removed = false;
      for (const key of list) {
        if (!state.progress[key]) continue;
        delete state.progress[key];
        removed = true;
      }
      if (removed) persist("progress");
      return removed;
    },
    enteredChapters() {
      return Object.keys(state.progress).length;
    },
    reload() {
      state = loadFromStorage();
      notify("reload");
      return state;
    },
    persist,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      state = emptyState();
      persist("reset");
      return state;
    },
    replace(raw) {
      state = normalize(raw);
      persist("import");
      return state;
    },
    exportJSON() {
      return JSON.stringify(state, null, 2);
    },
    usageBytes() {
      try {
        return new Blob([JSON.stringify(state)]).size;
      } catch {
        return 0;
      }
    },
    uid,
    nowISO,
  };
})();
