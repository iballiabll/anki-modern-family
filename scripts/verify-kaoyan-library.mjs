/**
 * Self-check for the generated kaoyan library.
 *
 * Usage:
 *   node scripts/verify-kaoyan-library.mjs           # verify generated data
 *   node scripts/verify-kaoyan-library.mjs --rebuild # run the builder first
 *
 * Exits with a non-zero code when any paper fails a structural check, so the
 * result can be used as an acceptance gate instead of eyeballing the report.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(root, "kaoyan-data");
const EXPECTED_TRACKS = [
  { id: "english-i", label: "英语一" },
  { id: "english-ii", label: "英语二" },
];
const EXPECTED_YEARS = [];
for (let year = 2010; year <= 2026; year += 1) {
  EXPECTED_YEARS.push(year);
}
const OPTION_KEYS = ["A", "B", "C", "D"];

function loadScript(relativePath, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, relativePath), "utf8"), sandbox);
  const library = sandbox.window[globalName];
  if (!library) {
    throw new Error(`${relativePath} 没有导出 ${globalName}`);
  }
  return library;
}

const index = loadScript("kaoyan-data/index.js", "IBALL_KAOYAN_INDEX");
const failures = [];
const stats = {
  papers: 0,
  questions: 0,
  options: 0,
  references: 0,
  paragraphs: 0,
  writingParts: 0,
};
const seen = new Set();

function fail(paperId, message) {
  failures.push(`${paperId}: ${message}`);
}

function requireValue(paperId, condition, message) {
  if (!condition) {
    fail(paperId, message);
  }
  return condition;
}

function checkQuestion(paperId, section, question, expectedOptions, options = {}) {
  const label = `${section.section} 第 ${question?.number ?? "?"} 题`;
  requireValue(paperId, Number.isFinite(question?.number), `${label} 缺少题号`);
  if (options.requireStem !== false) {
    requireValue(
      paperId,
      typeof question?.stem === "string" && question.stem.trim().length > 0,
      `${label} 缺少题干`,
    );
  }

  if (expectedOptions > 0) {
    const options = Array.isArray(question?.options) ? question.options : [];
    requireValue(
      paperId,
      options.length === expectedOptions,
      `${label} 选项数为 ${options.length}，应为 ${expectedOptions}`,
    );
    options.forEach((option) => {
      stats.options += 1;
      requireValue(
        paperId,
        OPTION_KEYS.includes(String(option?.key || "").toUpperCase()),
        `${label} 选项字母异常：${option?.key}`,
      );
      requireValue(
        paperId,
        typeof option?.text === "string" && option.text.trim().length > 0,
        `${label} 选项 ${option?.key} 内容为空`,
      );
    });
    requireValue(
      paperId,
      OPTION_KEYS.includes(String(question?.answer || "").toUpperCase()),
      `${label} 答案缺失或不是 A-D：${question?.answer}`,
    );
  }

  stats.questions += 1;
}

function checkReading(paperId, section) {
  const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
  requireValue(paperId, paragraphs.length >= 2, `${section.label} 正文段落过少`);
  paragraphs.forEach((paragraph, index) => {
    stats.paragraphs += 1;
    requireValue(
      paperId,
      typeof paragraph === "string" && paragraph.trim().length > 40,
      `${section.label} 第 ${index + 1} 段内容过短`,
    );
  });

  const questions = Array.isArray(section.questions) ? section.questions : [];
  // 少数语料把下一篇的题干粘在本篇末尾，构建时已按 question-map.json 裁掉。
  requireValue(
    paperId,
    questions.length >= 4 && questions.length <= 5,
    `${section.label} 题量为 ${questions.length}，应为 4-5`,
  );
  questions.forEach((question) => checkQuestion(paperId, section, question, 4));
}

function checkCloze(paperId, section) {
  const questions = Array.isArray(section.questions) ? section.questions : [];
  requireValue(paperId, questions.length === 20, `${section.label} 空数为 ${questions.length}，应为 20`);
  const numbers = questions.map((question) => Number(question?.number)).sort((a, b) => a - b);
  requireValue(
    paperId,
    numbers.every((value, index) => value === index + 1),
    `${section.label} 题号不连续：${numbers.join(",")}`,
  );
  const passage = (Array.isArray(section.paragraphs) ? section.paragraphs : []).join(" ");
  requireValue(paperId, passage.trim().length > 200, `${section.label} 完形正文过短`);
  questions.forEach((question) => {
    checkQuestion(paperId, section, question, 4, { requireStem: false });
    const number = Number(question?.number);
    const marker = new RegExp(`(^|[^0-9])${number}([^0-9]|$)`);
    requireValue(
      paperId,
      marker.test(passage),
      `${section.label} 正文中找不到第 ${number} 空的空格标记`,
    );
  });
}

function checkNewQuestionType(paperId, section) {
  const questions = Array.isArray(section.questions) ? section.questions : [];
  requireValue(
    paperId,
    questions.length === 5,
    `${section.label} 题量为 ${questions.length}，应为 5`,
  );
  questions.forEach((question) => {
    stats.questions += 1;
    requireValue(
      paperId,
      String(question?.answer || "").trim().length > 0,
      `${section.label} 第 ${question?.number} 题缺少答案`,
    );
  });
  const pool = Array.isArray(section.options) ? section.options : [];
  const pools = new Set(
    questions.map((question) => String(question?.answer || "").trim().toUpperCase()),
  );
  const isTrueFalse =
    section.answerMode === "true-false" ||
    (pools.size > 0 && [...pools].every((value) => value === "T" || value === "F"));
  if (isTrueFalse) {
    // 2010 英二判断题没有 A-G 备选池，答案直接是 T/F。
    questions.forEach((question) => {
      requireValue(
        paperId,
        String(question?.stem || "").trim().length > 0,
        `${section.label} 第 ${question?.number} 题缺少题干`,
      );
      requireValue(
        paperId,
        /^[TF]$/.test(String(question?.answer || "").trim().toUpperCase()),
        `${section.label} 第 ${question?.number} 题答案不是 T/F`,
      );
    });
    return;
  }
  requireValue(
    paperId,
    pool.length >= 5,
    `${section.label} 备选段落数为 ${pool.length}，应不少于 5`,
  );
}

function checkTranslation(paperId, section) {
  const questions = Array.isArray(section.questions) ? section.questions : [];
  requireValue(
    paperId,
    questions.length >= 1,
    `${section.label} 没有解析出翻译小题`,
  );
  const paragraphs = Array.isArray(section.paragraphs) ? section.paragraphs : [];
  const hasSourceText =
    paragraphs.join(" ").trim().length > 80 ||
    questions.some((question) => String(question?.stem || "").trim().length > 80);
  requireValue(paperId, hasSourceText, `${section.label} 缺少待翻译原文`);
  questions.forEach((question) => {
    stats.questions += 1;
    requireValue(
      paperId,
      String(question?.stem || "").trim().length > 0,
      `${section.label} 第 ${question?.number} 句缺少原文`,
    );
    const reference = String(question?.reference || "").trim();
    requireValue(
      paperId,
      reference.length > 0,
      `${section.label} 第 ${question?.number} 句缺少参考译文`,
    );
    if (reference) {
      stats.references += 1;
    }
  });
}

function checkWriting(paperId, section) {
  const parts = Array.isArray(section.writingParts) ? section.writingParts : [];
  requireValue(
    paperId,
    parts.length === 2,
    `${section.label} 作文部分为 ${parts.length}，应为 2（Part A / Part B）`,
  );
  const labels = parts.map((part) => String(part?.part || "").toUpperCase());
  requireValue(paperId, labels.some((label) => label.includes("A")), `${section.label} 缺少 Part A`);
  requireValue(paperId, labels.some((label) => label.includes("B")), `${section.label} 缺少 Part B`);
  parts.forEach((part) => {
    stats.writingParts += 1;
    requireValue(
      paperId,
      String(part?.prompt || "").trim().length > 20,
      `${section.label} ${part?.part} 题目内容过短`,
    );
    requireValue(
      paperId,
      Number(part?.points) > 0,
      `${section.label} ${part?.part} 缺少分值`,
    );
  });
}

const checkers = {
  reading: checkReading,
  cloze: checkCloze,
  "new-question-type": checkNewQuestionType,
  translation: checkTranslation,
  writing: checkWriting,
};

for (const track of EXPECTED_TRACKS) {
  for (const year of EXPECTED_YEARS) {
    const id = `${track.id}-${year}`;
    const entry = index.papers.find((paper) => paper.id === id);
    if (!entry) {
      failures.push(`${id}: 索引缺少该套试卷`);
      continue;
    }
    seen.add(id);
    const library = loadScript(entry.file, "IBALL_KAOYAN_LIBRARY");
    const paper = library[id];
    if (!paper) {
      failures.push(`${id}: 数据文件没有导出试卷内容`);
      continue;
    }
    stats.papers += 1;

    requireValue(id, paper.track === track.id, `track 字段为 ${paper.track}`);
    requireValue(id, Number(paper.year) === year, `year 字段为 ${paper.year}`);

    const sections = Array.isArray(paper.sections) ? paper.sections : [];
    requireValue(id, sections.length === 8, `小节数为 ${sections.length}，应为 8`);
    const bySection = new Map(sections.map((section) => [section.section, section]));

    for (let textIndex = 1; textIndex <= 4; textIndex += 1) {
      const key = `reading-text-${textIndex}`;
      const section = bySection.get(key);
      if (!section) {
        fail(id, `缺少 ${key}`);
        continue;
      }
      checkReading(id, section);
    }

    for (const key of ["cloze", "new-question-type", "translation", "writing"]) {
      const section = bySection.get(key);
      if (!section) {
        fail(id, `缺少 ${key}`);
        continue;
      }
      const checker = checkers[section.kind] || checkers[key];
      if (!checker) {
        fail(id, `${key} 类型为 ${section.kind}，无法校验`);
        continue;
      }
      checker(id, section);
    }
  }
}

for (const paper of index.papers) {
  if (!seen.has(paper.id)) {
    failures.push(`${paper.id}: 索引里的试卷未被校验`);
  }
}

const totalExpected = EXPECTED_TRACKS.length * EXPECTED_YEARS.length;
console.log("== 考研英语题库自检 ==");
console.log(`试卷：${stats.papers}/${totalExpected} 套`);
console.log(
  `题目：${stats.questions} 题 ｜ 选项：${stats.options} 个 ｜ 参考译文：${stats.references} 句`,
);
console.log(
  `正文段落：${stats.paragraphs} 段 ｜ 作文题目：${stats.writingParts} 个`,
);

if (failures.length) {
  console.error(`\n发现 ${failures.length} 个问题：`);
  failures.slice(0, 40).forEach((message) => console.error(` - ${message}`));
  if (failures.length > 40) {
    console.error(` ...另外 ${failures.length - 40} 个问题未列出`);
  }
  process.exit(1);
}

if (stats.papers !== totalExpected) {
  console.error(`\n试卷数量不足：${stats.papers}/${totalExpected}`);
  process.exit(1);
}

console.log("\n全部校验通过。");
