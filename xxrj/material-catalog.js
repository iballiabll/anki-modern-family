/**
 * XXRJ 共享资料目录。
 *
 * 复盘录入和每日计划共用这一份结构：
 *   科目 → 资料 / 试卷 → 年份 · 套卷 / 分册 · 章节 → 实际题号
 *
 * 只收录确认存在的资料：
 *   · 数学：武忠祥复习全书、2027 张宇1000题、2027 新东方1000题、
 *           2027 李永乐660题、2027 李林880题、数学一 / 二 / 三历年真题
 *   · 英语：英语一 / 英语二历年真题，模块题号按整卷真实编号排
 *   · 408：王道四本书课后题、408 统考真题
 *
 * 习题册每章题量各版本不同，所以不伪造 1–N：题号范围由使用者在界面上
 * 按自己手里的书填写（例如 1-30、1-10,15,20），填过的范围会记住，
 * 下次同一个分册、同一章自动带出来。
 */
(function () {
  "use strict";

  /** 数学只保这几本 + 真题；bookKey 是和 math-books.js 对齐的进度键。 */
  const MATH_BOOKS = [
    { id: "wzx-full", label: "2027 武忠祥复习全书", bookKey: "jinbang" },
    { id: "zy1000", label: "2027 张宇1000题", bookKey: "zy1000" },
    { id: "xdf1000", label: "2027 新东方1000题", bookKey: "xdf1000" },
    { id: "lyl660", label: "2027 李永乐660题", bookKey: "lyl660" },
    { id: "ll880", label: "2027 李林880题", bookKey: "ll880" },
  ];

  /** 习题册换版本时至少还能选分册，章节以 math-books.js 为准。 */
  const FALLBACK_SECTIONS = [
    { id: "高等数学", label: "高等数学", chapters: [] },
    { id: "线性代数", label: "线性代数", chapters: [] },
    { id: "概率论与数理统计", label: "概率论与数理统计", chapters: [] },
  ];

  const MATH_YEARS = Array.from({ length: 2026 - 2010 + 1 }, (_, index) => 2010 + index);
  const CS408_YEARS = Array.from({ length: 2026 - 2009 + 1 }, (_, index) => 2009 + index);
  const MATH_PAPERS = ["数学一", "数学二", "数学三"];

  const CS408_WANGDAO = [
    {
      id: "ds",
      label: "数据结构",
      chapters: ["绪论", "线性表", "栈、队列和数组", "串", "树与二叉树", "图", "查找", "排序"],
    },
    {
      id: "co",
      label: "计算机组成原理",
      chapters: [
        "计算机系统概述",
        "数据的表示和运算",
        "存储系统",
        "指令系统",
        "中央处理器",
        "总线",
        "输入/输出系统",
      ],
    },
    {
      id: "os",
      label: "操作系统",
      chapters: [
        "计算机系统概述",
        "进程与线程",
        "处理机调度",
        "同步与互斥",
        "死锁",
        "内存管理",
        "文件管理",
        "输入/输出管理",
      ],
    },
    {
      id: "net",
      label: "计算机网络",
      chapters: [
        "计算机网络体系结构",
        "物理层",
        "数据链路层",
        "网络层",
        "传输层",
        "应用层",
      ],
    },
  ];

  /** 每日任务「单词斩」可选词库，id 直接对应 vocab.html?deck=... */
  const VOCAB_DECKS = [
    { id: "llyc2027", label: "恋练有词 2027", title: "恋练有词 2027 备考词库" },
    { id: "kaoyan1", label: "考研英语一核心词", title: "考研英语一 · 核心词库" },
    { id: "kaoyan2", label: "考研英语二核心词", title: "考研英语二 · 核心词库" },
    { id: "cet4", label: "四级核心词", title: "四级核心词库" },
    { id: "cet6", label: "六级核心词", title: "六级核心词库" },
    { id: "basic", label: "零基础高频词", title: "零基础高频词库" },
  ];

  function mathBook(key) {
    const books = Array.isArray(window.YANTU_MATH?.books) ? window.YANTU_MATH.books : [];
    return books.find((book) => book.key === key) || null;
  }

  function kaoyanIndex() {
    return window.IBALL_KAOYAN_INDEX && Array.isArray(window.IBALL_KAOYAN_INDEX.papers)
      ? window.IBALL_KAOYAN_INDEX
      : null;
  }

  function normalizeSections(book) {
    if (!book || !Array.isArray(book.sections) || !book.sections.length) return FALLBACK_SECTIONS;
    return book.sections
      .filter((section) => section && section.name)
      .map((section) => ({
        id: section.name,
        label: section.name,
        chapters: (Array.isArray(section.chapters) ? section.chapters : []).map((chapter) => ({
          id: chapter,
          label: chapter,
        })),
      }));
  }

  function mathBookSource(id) {
    const config = MATH_BOOKS.find((item) => item.id === id) || MATH_BOOKS[0];
    const book = mathBook(config.bookKey);
    return {
      id: config.id,
      label: config.label,
      kind: "book",
      family: "math",
      bookKey: config.bookKey,
      needsRange: true,
      sections: normalizeSections(book),
    };
  }

  function mathZhentiSource(subject) {
    const paper = MATH_PAPERS.includes(subject) ? subject : "数学一";
    return {
      id: "math-zhenti",
      label: "数学历年真题",
      kind: "zhenti",
      family: "math",
      needsRange: false,
      years: MATH_YEARS,
      papers: [paper],
      defaultPaper: paper,
      questionNumbers({ year }) {
        // 2021 年起数学改为 10 选择 + 6 填空 + 6 解答，共 22 题；此前为 23 题。
        return numberRange(1, Number(year) >= 2021 ? 22 : 23);
      },
    };
  }

  function englishTrackLabel(track) {
    const index = kaoyanIndex();
    const item = index?.tracks?.find((entry) => entry.id === track);
    return item ? item.label : track === "english-ii" ? "英语二" : "英语一";
  }

  function englishYears(track) {
    const index = kaoyanIndex();
    if (!index) return [];
    const years = index.papers
      .filter((paper) => paper.track === track && Number(paper.year) >= 2010)
      .map((paper) => Number(paper.year));
    return [...new Set(years)].sort((left, right) => left - right);
  }

  const ENGLISH_SECTION_ORDER = {
    cloze: 0,
    "reading-text-1": 1,
    "reading-text-2": 2,
    "reading-text-3": 3,
    "reading-text-4": 4,
    "new-question-type": 5,
    translation: 6,
    writing: 7,
  };

  function englishPaper(track, year) {
    const index = kaoyanIndex();
    if (!index) return null;
    return (
      index.papers.find(
        (paper) => paper.track === track && Number(paper.year) === Number(year),
      ) || null
    );
  }

  /**
   * 英语真题模块按整卷真实题号排：完形 1–20，阅读 Text 1–4 依次接上，
   * 新题型、翻译、写作按英语一 / 英语二各自的真实题量继续编号，
   * 所以英二翻译只有 1 题、写作 2 题，题号和英一不一样。
   */
  function englishModules(track, year) {
    const paper = englishPaper(track, year);
    if (!paper || !Array.isArray(paper.sections)) return [];
    const ordered = [...paper.sections].sort((left, right) => {
      const leftOrder = ENGLISH_SECTION_ORDER[left.section] ?? 99;
      const rightOrder = ENGLISH_SECTION_ORDER[right.section] ?? 99;
      return leftOrder - rightOrder;
    });
    let cursor = 1;
    return ordered.map((section) => {
      const count =
        section.kind === "writing" ? 2 : Math.max(0, Number(section.questions) || 0);
      const numbers = count ? numberRange(cursor, cursor + count - 1) : [];
      cursor += count;
      return {
        id: section.section,
        label: section.label,
        kind: section.kind,
        numbers,
        count,
      };
    });
  }

  function englishSource(track) {
    const label = `${englishTrackLabel(track)}历年真题`;
    return {
      id: track,
      label,
      kind: "zhenti",
      family: "english",
      needsRange: false,
      years: englishYears(track),
      papers: [englishTrackLabel(track)],
      defaultPaper: englishTrackLabel(track),
      modules(year) {
        return englishModules(track, year);
      },
      questionNumbers({ year, module }) {
        const hit = englishModules(track, year).find(
          (item) => item.id === module || item.label === module,
        );
        return hit ? [...hit.numbers] : [];
      },
    };
  }

  function wangdaoSource() {
    return {
      id: "wangdao",
      label: "王道课后题",
      kind: "book",
      family: "cs408",
      needsRange: true,
      sections: CS408_WANGDAO.map((book) => ({
        id: book.id,
        label: book.label,
        chapters: book.chapters.map((chapter) => ({ id: chapter, label: chapter })),
      })),
    };
  }

  function cs408ZhentiSource() {
    return {
      id: "cs408-zhenti",
      label: "408 历年真题",
      kind: "zhenti",
      family: "cs408",
      needsRange: false,
      years: CS408_YEARS,
      papers: ["408 统考"],
      defaultPaper: "408 统考",
      questionNumbers() {
        // 408 统考固定 40 道单选 + 7 道综合，共 47 题。
        return numberRange(1, 47);
      },
    };
  }

  function numberRange(from, to) {
    const start = Math.max(1, Number(from) || 1);
    const end = Math.min(500, Math.max(start, Number(to) || start));
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }

  /** 解析 "1-30"、"1-10,15,20"、"1 2 3" 这类手写题号。 */
  function parseRange(text, max = 500) {
    const source = String(text || "").trim();
    if (!source) return [];
    const out = new Set();
    source
      .split(/[、,，;；\s]+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const range = part.match(/^(\d+)\s*[-~—到]\s*(\d+)$/);
        if (range) {
          const from = Number(range[1]);
          const to = Number(range[2]);
          if (!Number.isFinite(from) || !Number.isFinite(to)) return;
          const start = Math.max(1, Math.min(from, to));
          const end = Math.min(max, Math.max(from, to));
          for (let number = start; number <= end; number += 1) out.add(number);
          return;
        }
        const single = Number(part.replace(/[^\d]/g, ""));
        if (Number.isFinite(single) && single > 0 && single <= max) out.add(single);
      });
    return [...out].sort((left, right) => left - right);
  }

  function formatNumbers(numbers) {
    const list = [...new Set((numbers || []).map(Number).filter((item) => item > 0))].sort(
      (left, right) => left - right,
    );
    if (!list.length) return "";
    const parts = [];
    let start = list[0];
    let end = list[0];
    for (let index = 1; index <= list.length; index += 1) {
      const current = list[index];
      if (current === end + 1) {
        end = current;
        continue;
      }
      parts.push(start === end ? String(start) : `${start}-${end}`);
      start = current;
      end = current;
    }
    return parts.join("、");
  }

  const MATH_SOURCE_IDS = [...MATH_BOOKS.map((item) => item.id), "math-zhenti"];
  const ENGLISH_SOURCES = { "英语一": "english-i", "英语二": "english-ii" };
  const CS408_SOURCE_IDS = ["wangdao", "cs408-zhenti"];

  function subjectFamily(subject) {
    const value = String(subject || "");
    if (value.startsWith("数学")) return "math";
    if (value.startsWith("英语")) return "english";
    if (value.includes("408")) return "cs408";
    return "";
  }

  function sources(subject) {
    const family = subjectFamily(subject);
    if (family === "math") {
      return MATH_SOURCE_IDS.map((id) =>
        id === "math-zhenti" ? mathZhentiSource(subject) : mathBookSource(id),
      );
    }
    if (family === "english") {
      // 英语一只有英一真题，英语二只有英二真题，不再互相串。
      return [englishSource(ENGLISH_SOURCES[subject] || "english-i")];
    }
    if (family === "cs408") {
      return CS408_SOURCE_IDS.map((id) =>
        id === "wangdao" ? wangdaoSource() : cs408ZhentiSource(),
      );
    }
    return [];
  }

  /** 旧记录只存了资料名时，用它猜一个科目族，方便把资料对象找回来。 */
  function subjectFamilyOfAlias(value) {
    const text = String(value || "");
    if (/英语/.test(text)) return text.includes("二") ? "英语二" : "英语一";
    if (/408|王道/.test(text)) return "408";
    if (/数学|题|真题/.test(text)) return "数学一";
    return "";
  }

  /**
   * 历史下拉框和封神之路章节页用过的资料写法。
   * 只做「旧名 → 目录」的搬家，新界面不再出现这些旧选项。
   */
  const LEGACY_SOURCES = {
    "1000题": { id: "zy1000" },
    "张宇1000题": { id: "zy1000" },
    "2027张宇1000题": { id: "zy1000" },
    "新东方1000题": { id: "xdf1000" },
    "660": { id: "lyl660" },
    "李永乐660题": { id: "lyl660" },
    "880": { id: "ll880" },
    "李林880题": { id: "ll880" },
    "复习全书": { id: "wzx-full" },
    "武忠祥复习全书": { id: "wzx-full" },
    "数学一真题": { id: "math-zhenti", subject: "数学一", paper: "数学一" },
    "数学二真题": { id: "math-zhenti", subject: "数学二", paper: "数学二" },
    "数学三真题": { id: "math-zhenti", subject: "数学三", paper: "数学三" },
    "历年真题": { id: "math-zhenti" },
    "英语一真题": { id: "english-i", subject: "英语一" },
    "英语二真题": { id: "english-ii", subject: "英语二" },
    "王道": { id: "wangdao", subject: "408" },
    "王道课后题": { id: "wangdao", subject: "408" },
    "408真题": { id: "cs408-zhenti", subject: "408" },
    "408 真题": { id: "cs408-zhenti", subject: "408" },
  };

  /** 旧英语模块名 → 目录里的真实模块名。 */
  const LEGACY_ENGLISH_MODULES = {
    "英语完形": "完形",
    "英语完型": "完形",
    "英语阅读 Part A": "阅读 Text 1",
    "英语阅读": "阅读 Text 1",
    "英语新题型": "新题型",
    "英语翻译": "翻译",
    "英语写作": "写作",
  };

  /** 支持用 id 或界面上看到的名称取值，历史记录里的旧名称也能对上。 */
  function source(subject, value) {
    const wanted = String(value || "").trim();
    if (!wanted) return null;
    const find = (list) =>
      list.find((item) => item.id === wanted || item.label === wanted) || null;
    return find(sources(subject)) || find(sources(subjectFamilyOfAlias(wanted)));
  }

  /** 任意历史写法（旧资料名 / 教材页 tab / 新 id / 新名称）都解析成目录对象。 */
  function resolveSource(subject, value) {
    const wanted = String(value || "").trim();
    if (!wanted) return null;
    const alias = LEGACY_SOURCES[wanted];
    if (alias) {
      const target = alias.subject || subject || subjectFamilyOfAlias(wanted);
      return sources(target).find((item) => item.id === alias.id) || null;
    }
    return source(subject, wanted);
  }

  function sourceLabel(subject, value) {
    const hit = resolveSource(subject, value);
    return hit ? hit.label : String(value || "").trim();
  }

  function subjectOfFamily(family, fallback) {
    if (family === "english") return fallback === "英语二" ? "英语二" : "英语一";
    if (family === "cs408") return "408";
    return ["数学一", "数学二", "数学三"].includes(fallback) ? fallback : "数学一";
  }

  /**
   * 把历史记录 / 任务里的科目、资料、年份、卷种、模块搬到新目录的写法。
   * 认不出来的资料原样保留，绝不猜一个题号范围。
   */
  function migrateFields(entry, { withModule = true } = {}) {
    const input = entry && typeof entry === "object" ? entry : {};
    const rawSubject = String(input.subject || "").trim();
    const rawSource = String(input.source || "").trim();
    const alias = LEGACY_SOURCES[rawSource] || null;
    const hit = resolveSource(alias?.subject || rawSubject, rawSource);
    if (!hit) return {};

    const subject = subjectOfFamily(hit.family, alias?.subject || rawSubject);
    const out = { subject, source: hit.label };

    if (hit.kind === "zhenti") {
      const papers = Array.isArray(hit.papers) ? hit.papers : [];
      const wantedPaper = String(input.paper || "").trim();
      const fallbackPaper =
        alias?.paper ||
        (["数学一", "数学二", "数学三"].includes(rawSubject) ? rawSubject : "") ||
        hit.defaultPaper ||
        papers[0] ||
        "";
      out.paper = papers.includes(wantedPaper) ? wantedPaper : fallbackPaper;
      if (hit.family === "math" && ["数学二", "数学三"].includes(out.paper)) {
        out.subject = out.paper;
      }
      const rawModule = String(input.module || "").trim();
      if (withModule && hit.family === "english") {
        const wantedModule = String(input.module || "").trim();
        if (!wantedModule) out.module = "";
        else if (hit.modules(input.year).some((item) => item.id === wantedModule || item.label === wantedModule)) {
          out.module = wantedModule;
        } else {
          out.module = LEGACY_ENGLISH_MODULES[wantedModule] || wantedModule;
        }
      } else if (withModule && rawModule && !/^(?:408\s*)?真题$/.test(rawModule)) {
        // 数学 / 408 真题没有模块可选，旧记录里的章节信息挪到章节字段保留。
        out.module = "";
        out.chapter = rawModule;
      }
      return out;
    }

    if (!withModule) return out;
    const rawModule = String(input.module || "").trim();
    if (!rawModule) return out;
    const stripped = rawModule.replace(/^王道\s*[·・]\s*/, "");
    const sections = hit.sections || [];
    const exact = sections.find((item) => item.id === stripped || item.label === stripped);
    if (exact) {
      out.module = exact.label;
      return out;
    }
    const [head, ...rest] = stripped.split(/\s*[·・]\s*/).filter(Boolean);
    const section = sections.find((item) => item.id === head || item.label === head);
    if (section && rest.length) {
      out.module = section.label;
      // 章节按书里的写法保留；换版本对不上时界面上仍能看到原来的章节名。
      out.chapter = rest.join(" · ");
    }
    return out;
  }

  function questionRangeText(entry) {
    const input = entry && typeof entry === "object" ? entry : {};
    if (String(input.questionRange || "").trim()) return String(input.questionRange).trim();
    const numbers = questionNumbers(resolveSource(input.subject, input.source), input);
    return numbers.length ? formatNumbers(numbers) : "";
  }

  /** 结构化任务 / 记录用一行标题描述，格式和历史记录一致。 */
  function taskTitle(entry) {
    const input = entry && typeof entry === "object" ? entry : {};
    const hit = resolveSource(input.subject, input.source);
    const parts = [hit ? hit.label : String(input.source || "").trim()];
    if (input.year) parts.push(String(input.year));
    if (input.paper) parts.push(String(input.paper));
    if (input.module) {
      // 下拉框存的是目录 id，标题里要用界面上看到的名字。
      const moduleHit = modules(hit, { year: input.year, paper: input.paper }).find(
        (item) => item.id === input.module || item.label === input.module,
      );
      parts.push(moduleHit ? moduleHit.label : String(input.module));
    }
    if (input.chapter) parts.push(String(input.chapter));
    const range = questionRangeText(input);
    if (range) parts.push(`第 ${range} 题`);
    return parts.filter(Boolean).join(" · ");
  }

  function modules(sourceItem, { year, paper } = {}) {
    if (!sourceItem) return [];
    if (sourceItem.kind === "zhenti" && typeof sourceItem.modules === "function") {
      return sourceItem.modules(year, paper);
    }
    if (sourceItem.kind === "book") {
      return sourceItem.sections.map((section) => ({ id: section.id, label: section.label }));
    }
    return [];
  }

  function chapters(sourceItem, moduleId) {
    if (!sourceItem || sourceItem.kind !== "book") return [];
    const section = sourceItem.sections.find(
      (item) => item.id === moduleId || item.label === moduleId,
    );
    return section ? section.chapters : [];
  }

  function questionNumbers(sourceItem, selection = {}) {
    if (!sourceItem) return [];
    if (sourceItem.kind === "zhenti") return sourceItem.questionNumbers(selection) || [];
    // 任务里存的是 questionRange，记录里也是，旧代码用 range：三个都认。
    return parseRange(selection.range ?? selection.questionRange, 500);
  }

  /** 记录 / 任务里保存的字段统一走这里，保证和界面看到的格子一致。 */
  function describe(sourceItem, selection = {}) {
    if (!sourceItem) return "";
    const parts = [sourceItem.label];
    if (sourceItem.kind === "zhenti") {
      if (selection.year) parts.push(String(selection.year));
      if (selection.paper) parts.push(selection.paper);
      if (selection.module) {
        const hit = modules(sourceItem, selection).find(
          (item) => item.id === selection.module || item.label === selection.module,
        );
        if (hit) parts.push(hit.label);
      }
    } else {
      if (selection.module) parts.push(selection.module);
      if (selection.chapter) parts.push(selection.chapter);
    }
    const numbers = questionNumbers(sourceItem, selection);
    if (numbers.length) parts.push(`第 ${formatNumbers(numbers)} 题`);
    return parts.filter(Boolean).join(" · ");
  }

  /* ------------------------------------------------- 手写题号范围记忆 */

  const RANGE_KEY = "yantu:ranges:v1";

  function readRangeStore() {
    try {
      const raw = localStorage.getItem(RANGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function rangeCacheKey(sourceItem, module, chapter) {
    const id = sourceItem ? sourceItem.id : "";
    return [id, module || "", chapter || ""].join("|");
  }

  function savedRange(sourceItem, module, chapter) {
    if (!sourceItem || sourceItem.kind !== "book") return "";
    const value = readRangeStore()[rangeCacheKey(sourceItem, module, chapter)];
    return typeof value === "string" ? value : "";
  }

  function rememberRange(sourceItem, module, chapter, text) {
    if (!sourceItem || sourceItem.kind !== "book") return "";
    const value = String(text || "").trim().slice(0, 120);
    const store = readRangeStore();
    if (!value) {
      delete store[rangeCacheKey(sourceItem, module, chapter)];
    } else {
      store[rangeCacheKey(sourceItem, module, chapter)] = value;
    }
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(store));
    } catch {
      // 隐私模式下记不住，但当前这次录入照常可用。
    }
    return value;
  }

  function vocabDeck(id) {
    return VOCAB_DECKS.find((item) => item.id === id) || VOCAB_DECKS[0];
  }

  window.YANTU_MATERIALS = {
    subjects: ["数学一", "数学二", "数学三", "英语一", "英语二", "408"],
    subjectFamily,
    sources,
    source,
    resolveSource,
    sourceLabel,
    migrateFields,
    taskTitle,
    questionRangeText,
    modules,
    chapters,
    questionNumbers,
    describe,
    parseRange,
    formatNumbers,
    numberRange,
    mathBookSource,
    englishModules,
    cs408WangdaoBooks: CS408_WANGDAO,
    mathYears: MATH_YEARS,
    cs408Years: CS408_YEARS,
    rangeKey: RANGE_KEY,
    savedRange,
    rememberRange,
    vocabDecks: VOCAB_DECKS,
    vocabDeck,
  };
})();
