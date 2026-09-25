#!/usr/bin/env node
/**
 * 考研英语真题完整性核验。
 *
 * 逐套读取 kaoyan-data/english-{i,ii}-<year>.js，按需求口径核验：
 *   1. 2011–2026 英语一 / 英语二每年都在；
 *   2. 每年 5 个题型齐全：完形填空、阅读理解、新题型、翻译、写作；
 *   3. 单选（完形 20 空、阅读 4×5）每题恰好 4 个选项；
 *   4. 每道客观题都有非空答案，且答案落在自己的选项集合内；
 *   5. 翻译有参考译文、写作 Part A / Part B 题干非空；
 *   6. 统计「机读原文定位」的可命中率（页面里的答案解析依赖它）。
 *
 * 输出：
 *   work/kaoyan-coverage-report.md   逐年逐题状态表
 *   退出码 0 = 结构无缺口；1 = 存在缺项
 *
 * 用法：
 *   node scripts/verify-kaoyan-coverage.mjs
 *   node scripts/verify-kaoyan-coverage.mjs --years 2011-2026 --out work/kaoyan-coverage-report.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const dataRoot = path.resolve(root, arg("dir", "kaoyan-data"));
const reportPath = path.resolve(root, arg("out", "work/kaoyan-coverage-report.md"));

// 需求要求覆盖 2011–2026；2010 属于语料里多出来的一套，单列不参与判定。
const REQUIRED_YEARS = (() => {
  const range = arg("years", "2011-2026").split("-").map(Number);
  const start = range[0];
  const end = range[1] || range[0];
  const years = [];
  for (let year = start; year <= end; year += 1) {
    years.push(year);
  }
  return years;
})();

const TRACKS = [
  { id: "english-i", label: "英语一" },
  { id: "english-ii", label: "英语二" },
];

const SECTION_RULES = {
  reading: { label: "阅读理解", sections: 4, questions: 20 },
  cloze: { label: "完形填空", sections: 1, questions: 20 },
  "new-question-type": { label: "新题型", sections: 1, questions: 5 },
  translation: { label: "翻译", sections: 1 },
  writing: { label: "写作", sections: 1 },
};

// 与 kaoyan.js 的 locatorTokens 保持一致：客观题本身没有官方解析，
// 页面用「题干 + 正确选项」的关键词回查原文，这里统计它的可命中率。
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

function locateSourceSentence(targets, paragraphs) {
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  const wanted = [...new Set(locatorTokens(targets.filter(Boolean).join(" ")))];
  if (!list.length || !wanted.length) {
    return null;
  }
  let best = null;
  list.forEach((paragraph, paragraphIndex) => {
    String(paragraph || "")
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .forEach((sentence) => {
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
          best = { score, hits, paragraphIndex };
        }
      });
  });
  if (!best) {
    return null;
  }
  if (best.hits >= 2 || (wanted.length === 1 && best.hits === 1)) {
    return best;
  }
  return null;
}

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
      best = { paragraphIndex, hits };
    }
  });
  return best;
}

function loadPaper(source, file) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: file, timeout: 20_000 });
  const library = sandbox.window.IBALL_KAOYAN_LIBRARY || {};
  const ids = Object.keys(library);
  if (ids.length !== 1) {
    throw new Error(`${file} 应只导出一套试卷，实际 ${ids.length} 套`);
  }
  return library[ids[0]];
}

function isChoiceQuestion(question) {
  return Array.isArray(question.options) && question.options.length > 0;
}

function checkPaper(track, year, paper) {
  const errors = [];
  const warnings = [];
  const sections = Array.isArray(paper.sections) ? paper.sections : [];
  const byKind = (kind) => sections.filter((section) => section.kind === kind);
  const summary = {};

  for (const [kind, rule] of Object.entries(SECTION_RULES)) {
    const found = byKind(kind);
    if (found.length !== rule.sections) {
      errors.push(
        `${rule.label}：应有 ${rule.sections} 个板块，实际 ${found.length} 个`,
      );
    }
    summary[kind] = found;
  }

  // 客观题：选项数、答案存在性、答案是否落在选项集合内。
  let objectiveCount = 0;
  let objectiveWithFourOptions = 0;
  let objectiveWithAnswer = 0;
  let objectiveAnswerInOptions = 0;
  let locatorHits = 0;
  let sentenceLocatorHits = 0;
  let paragraphLocatorHits = 0;

  for (const section of sections) {
    if (section.kind !== "reading" && section.kind !== "cloze") {
      continue;
    }
    for (const question of section.questions || []) {
      objectiveCount += 1;
      const options = Array.isArray(question.options) ? question.options : [];
      if (options.length === 4) {
        objectiveWithFourOptions += 1;
      } else {
        errors.push(
          `${section.label || section.kind} 第 ${question.number} 题：选项 ${options.length} 个（应为 4 个）`,
        );
      }
      const keys = options.map((option) => String(option.key || "").toUpperCase());
      const answer = String(question.answer || "").trim().toUpperCase();
      if (answer) {
        objectiveWithAnswer += 1;
      } else {
        errors.push(
          `${section.label || section.kind} 第 ${question.number} 题：缺少答案`,
        );
      }
      if (answer && keys.includes(answer)) {
        objectiveAnswerInOptions += 1;
      } else if (answer) {
        errors.push(
          `${section.label || section.kind} 第 ${question.number} 题：答案 ${answer} 不在选项中`,
        );
      }
      const answerText =
        options.find((option) => String(option.key || "").toUpperCase() === answer)
          ?.text || "";
      const locator = locateSourceSentence(
        [question.stem, answerText],
        section.paragraphs,
      );
      if (locator) {
        locatorHits += 1;
        sentenceLocatorHits += 1;
      } else if (locateSourceParagraph([question.stem, answerText], section.paragraphs)) {
        locatorHits += 1;
        paragraphLocatorHits += 1;
      }
      if (question.reference) {
        warnings.push(
          `${section.label || section.kind} 第 ${question.number} 题带参考解析（可用于替换机读定位）`,
        );
      }
    }
  }

  // 新题型：答案必须在候选池里（匹配题 A-G / 判断正误 T-F）。
  for (const section of byKind("new-question-type")) {
    const pool = new Set(
      (section.options || []).map((option) => String(option.key || "").toUpperCase()),
    );
    const truth = section.answerMode === "true-false";
    for (const question of section.questions || []) {
      const answer = String(question.answer || "").trim().toUpperCase();
      if (!answer) {
        errors.push(`新题型 第 ${question.number} 题：缺少答案`);
        continue;
      }
      const allowed = truth ? ["T", "F"] : [...pool];
      if (allowed.length && !allowed.includes(answer)) {
        errors.push(
          `新题型 第 ${question.number} 题：答案 ${answer} 不在候选集合（${allowed.join("/")}）内`,
        );
      }
    }
  }

  // 翻译：英语一 5 句 + 5 条参考译文；英语二 1 段 + 1 条参考译文。
  for (const section of byKind("translation")) {
    const questions = section.questions || [];
    const expected = track === "english-i" ? 5 : 1;
    if (questions.length !== expected) {
      errors.push(`翻译：应有 ${expected} 道小题，实际 ${questions.length} 道`);
    }
    const segments = section.segments || [];
    if (track === "english-i" && segments.length !== 5) {
      errors.push(`翻译：应有 5 个待译句，实际 ${segments.length} 个`);
    }
    questions.forEach((question) => {
      if (!String(question.reference || question.answer || "").trim()) {
        errors.push(`翻译 第 ${question.number} 题：缺少参考译文`);
      }
    });
  }

  // 写作：Part A / Part B 两段题干。
  for (const section of byKind("writing")) {
    const parts = section.writingParts || [];
    if (parts.length < 2) {
      errors.push(`写作：应解析出 Part A / Part B，实际 ${parts.length} 段`);
    }
    parts.forEach((part, index) => {
      if (!String(part.prompt || "").trim()) {
        errors.push(`写作 ${part.part || `第 ${index + 1} 段`}：题干为空`);
      }
    });
  }

  for (const [kind, rule] of Object.entries(SECTION_RULES)) {
    if (!rule.questions) {
      continue;
    }
    const total = byKind(kind).reduce(
      (sum, section) => sum + (section.questions || []).length,
      0,
    );
    if (total !== rule.questions) {
      errors.push(`${rule.label}：应有 ${rule.questions} 道题，实际 ${total} 道`);
    }
  }

  return {
    errors,
    warnings,
    stats: {
      sections: sections.length,
      objectiveCount,
      objectiveWithFourOptions,
      objectiveWithAnswer,
      objectiveAnswerInOptions,
      locatorHits,
      sentenceLocatorHits,
      paragraphLocatorHits,
      readingTexts: byKind("reading").length,
      clozeQuestions: (byKind("cloze")[0]?.questions || []).length,
      newTypeQuestions: (byKind("new-question-type")[0]?.questions || []).length,
      translationQuestions: (byKind("translation")[0]?.questions || []).length,
      writingParts: (byKind("writing")[0]?.writingParts || []).length,
    },
  };
}

async function main() {
  const results = [];
  const failures = [];

  for (const track of TRACKS) {
    for (const year of REQUIRED_YEARS) {
      const file = `${track.id}-${year}.js`;
      const absolute = path.join(dataRoot, file);
      let source;
      try {
        source = await fs.readFile(absolute, "utf8");
      } catch {
        failures.push(`${track.label} ${year}：缺少数据文件 ${file}`);
        results.push({ track, year, missing: true, errors: [`缺少 ${file}`], stats: null });
        continue;
      }
      let paper;
      try {
        paper = loadPaper(source, file);
      } catch (error) {
        failures.push(`${track.label} ${year}：${error.message}`);
        results.push({ track, year, errors: [error.message], stats: null });
        continue;
      }
      const checked = checkPaper(track.id, year, paper);
      checked.errors.forEach((message) => {
        failures.push(`${track.label} ${year}：${message}`);
      });
      results.push({ track, year, ...checked });
    }
  }

  // 多出来的年份（例如 2010）登记但不参与判定。
  const extras = [];
  for (const track of TRACKS) {
    const files = await fs.readdir(dataRoot).catch(() => []);
    files
      .filter((file) => file.startsWith(`${track.id}-`) && file.endsWith(".js"))
      .forEach((file) => {
        const year = Number(file.replace(`${track.id}-`, "").replace(".js", ""));
        if (Number.isFinite(year) && !REQUIRED_YEARS.includes(year)) {
          extras.push(`${track.label} ${year}`);
        }
      });
  }

  const totalObjective = results.reduce(
    (sum, item) => sum + (item.stats?.objectiveCount || 0),
    0,
  );
  const totalLocator = results.reduce(
    (sum, item) => sum + (item.stats?.locatorHits || 0),
    0,
  );
  const totalFourOptions = results.reduce(
    (sum, item) => sum + (item.stats?.objectiveWithFourOptions || 0),
    0,
  );
  const totalAnswers = results.reduce(
    (sum, item) => sum + (item.stats?.objectiveAnswerInOptions || 0),
    0,
  );

  const lines = [];
  lines.push("# 考研英语真题完整性核验报告");
  lines.push("");
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push(`- 数据目录：\`kaoyan-data/\``);
  lines.push(`- 覆盖年份：${REQUIRED_YEARS[0]}–${REQUIRED_YEARS[REQUIRED_YEARS.length - 1]}`);
  lines.push(`- 试卷数量：${results.filter((item) => !item.missing).length} 套（英语一 + 英语二）`);
  lines.push(
    `- 客观题：${totalObjective} 道，4 选项 ${totalFourOptions} 道，答案落位 ${totalAnswers} 道，机读原文定位命中 ${totalLocator} 道（${
      totalObjective ? Math.round((totalLocator / totalObjective) * 100) : 0
    }%）`,
  );
  lines.push(`- 结论：${failures.length === 0 ? "**无缺年缺题**" : `**存在 ${failures.length} 条缺口**`}`);
  lines.push("");
  if (extras.length) {
    lines.push(`> 额外语料（不影响判定）：${[...new Set(extras)].join("、")}`);
    lines.push("");
  }

  for (const track of TRACKS) {
    lines.push(`## ${track.label}`);
    lines.push("");
    lines.push(
      "| 年份 | 完形(20) | 阅读(4×5) | 新题型(5) | 翻译 | 写作(2) | 客观题选项4 | 答案落位 | 机读定位 | 状态 |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    results
      .filter((item) => item.track.id === track.id)
      .forEach((item) => {
        if (item.missing || !item.stats) {
          lines.push(
            `| ${item.year} | — | — | — | — | — | — | — | — | ❌ 缺数据 |`,
          );
          return;
        }
        const stats = item.stats;
        const ok = item.errors.length === 0;
        const cell = (value, expected) =>
          value === expected ? `${value}` : `**${value}/${expected}**`;
        lines.push(
          `| ${item.year} | ${cell(stats.clozeQuestions, 20)} | ${
            stats.readingTexts === 4 ? "4" : `**${stats.readingTexts}/4**`
          }×5=${cell(stats.readingTexts * 5, 20)} | ${cell(
            stats.newTypeQuestions,
            5,
          )} | ${
            item.track.id === "english-i"
              ? cell(stats.translationQuestions, 5)
              : cell(stats.translationQuestions, 1)
          } | ${cell(stats.writingParts, 2)} | ${
            stats.objectiveCount
              ? `${stats.objectiveWithFourOptions}/${stats.objectiveCount}`
              : "—"
          } | ${
            stats.objectiveCount
              ? `${stats.objectiveAnswerInOptions}/${stats.objectiveCount}`
              : "—"
          } | ${stats.locatorHits}/${stats.objectiveCount} | ${
            ok ? "✅" : "❌"
          } |`,
        );
      });
    lines.push("");
  }

  lines.push("## 判定口径");
  lines.push("");
  lines.push("- 完形填空 20 空、阅读理解 4 篇 × 5 题、新题型 5 题、翻译（英语一 5 句 / 英语二 1 段）、写作 Part A + Part B。");
  lines.push("- 单选（完形 / 阅读）必须恰好 4 个选项，答案必须落在选项 key 内。");
  lines.push("- 翻译必须带参考译文；写作两段题干不得为空。");
  lines.push("- 客观题语料不含官方解析，页面使用「正确选项 + 机读原文定位」补足，因此统计定位命中率。");
  lines.push("");

  if (failures.length) {
    lines.push("## 缺口明细");
    lines.push("");
    failures.forEach((message) => lines.push(`- ${message}`));
    lines.push("");
  } else {
    lines.push("## 缺口明细");
    lines.push("");
    lines.push("- 无。");
    lines.push("");
  }

  lines.push("## 逐年逐题状态");
  lines.push("");
  results.forEach((item) => {
    lines.push(
      `### ${item.track.label} ${item.year} — ${item.errors.length ? "❌" : "✅"}`,
    );
    lines.push("");
    if (!item.stats) {
      lines.push("- 数据文件缺失。");
      lines.push("");
      return;
    }
    lines.push(
      `- 板块 ${item.stats.sections} 个：完形 ${item.stats.clozeQuestions} 空、阅读 ${
        item.stats.readingTexts
      } 篇 ${item.stats.readingTexts * 5} 题、新题型 ${
        item.stats.newTypeQuestions
      } 题、翻译 ${item.stats.translationQuestions} 题、写作 ${item.stats.writingParts} 段`,
    );
    lines.push(
      `- 客观题 ${item.stats.objectiveCount} 道：四选项 ${item.stats.objectiveWithFourOptions} 道、答案落位 ${item.stats.objectiveAnswerInOptions} 道、机读定位 ${item.stats.locatorHits} 道`,
    );
    if (item.errors.length) {
      item.errors.forEach((message) => lines.push(`- ❌ ${message}`));
    } else {
      lines.push("- ✅ 五年年题型齐全，选项 / 答案 / 参考译文 / 写作题干校验通过");
    }
    lines.push("");
  });

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");

  console.log(`核验完成：${results.length} 套试卷`);
  console.log(
    `客观题 ${totalObjective} 道 ｜ 四选项 ${totalFourOptions} ｜ 答案落位 ${totalAnswers} ｜ 机读定位 ${totalLocator}`,
  );
  console.log(`报告：${path.relative(root, reportPath)}`);
  if (failures.length) {
    console.error(`发现 ${failures.length} 条缺口：`);
    failures.slice(0, 20).forEach((message) => console.error(` - ${message}`));
    return 1;
  }
  console.log("结论：2011–2026 英语一 / 英语二均为 5 题型齐全，无缺年缺题。");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
