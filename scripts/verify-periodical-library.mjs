#!/usr/bin/env node
/**
 * 外刊库自检：校验期号清单与实际数据文件一致、题目结构完整、正文没有混入推广语。
 *
 * 退出码 0 = 全部通过；1 = 存在错误。
 */
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
function readArg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1] || fallback;
}

const libraryRoot = path.resolve(root, readArg("--dir", "."));
const MAX_DETAILS = 12;

// 阅读理解：每题必须有题干 + 四个选项 + 答案。
const STEM_TYPES = new Set(["reading"]);
// 完形填空：空格嵌在正文里，因此没有独立题干，但每题仍有四个选项。
const BLANK_TYPES = new Set(["cloze"]);
// 新题型（7选5 / 段落排序 / 小标题匹配）：所有小题共用一组 A-G 候选，只校验答案。
const SHARED_OPTION_TYPES = new Set(["gap-fill", "ordering", "heading"]);
// 构建脚本按“小题数”统计检验题：完形填空没有题干，新题型没有逐题选项。
function countedQuestions(items) {
  return items.filter((item) => item.stem || item.options.length || item.answer).length;
}
const PROMO_PATTERNS = [
  "关注微信公众号",
  "公众号：",
  "加入训练营",
  "资料禁言群",
  "版权所有",
  "禁止传播",
];

function loadWindowScript(source, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 20_000 });
  return sandbox.window[globalName];
}

async function main() {
  const errors = [];
  const warnings = [];

  let index;
  try {
    index = loadWindowScript(
      await fs.readFile(path.join(libraryRoot, "periodical-index.js"), "utf8"),
      "IBALL_PERIODICAL_INDEX",
    );
  } catch (error) {
    console.error(`无法读取 periodical-index.js：${error.message}`);
    process.exit(1);
  }

  const papers = loadWindowScript(
    await fs.readFile(path.join(libraryRoot, "periodical-papers.js"), "utf8"),
    "IBALL_PERIODICAL_PAPERS",
  );

  if (!index?.issues?.length) {
    errors.push("periodical-index.js 中没有期号");
  }
  if (papers?.length !== index?.issues?.length) {
    errors.push(
      `periodical-papers.js 期号数 ${papers?.length ?? 0} 与索引 ${index?.issues?.length ?? 0} 不一致`,
    );
  }

  const totals = { issues: 0, article: 0, paragraph: 0, vocab: 0, question: 0, qa: 0, original: 0 };
  const kindStats = new Map();
  let promoHits = 0;
  let missingAnswers = 0;
  let incompleteOptions = 0;

  for (const issue of index.issues) {
    const file = path.join(libraryRoot, issue.file);
    let payload;
    try {
      payload = loadWindowScript(
        await fs.readFile(file, "utf8"),
        "IBALL_PERIODICAL_LIBRARY",
      )?.[issue.id];
    } catch (error) {
      errors.push(`读取 ${issue.file} 失败：${error.message}`);
      continue;
    }
    if (!payload) {
      errors.push(`${issue.file} 中缺少期号 ${issue.id}`);
      continue;
    }

    totals.issues += 1;
    const articles = payload.articles.flatMap((group) => group.articles);
    const readingParagraphs = payload.reading.flatMap((group) => group.paragraphs);
    const vocab = payload.reading.flatMap((group) => group.vocab);
    const questions = payload.tests.flatMap((group) =>
      group.items.map((item) => ({ ...item, type: group.type, file: group.file })),
    );
    const qa = payload.qa.flatMap((group) => group.items);

    totals.article += articles.length;
    totals.paragraph += readingParagraphs.length;
    totals.vocab += vocab.length;
    totals.question += countedQuestions(questions);
    totals.qa += qa.length;
    totals.original += payload.originals.length;

    const counts = issue.counts;
    const recomputed = {
      article: articles.length,
      paragraph: readingParagraphs.length,
      vocab: vocab.length,
      question: countedQuestions(questions),
      qa: qa.length,
      original: payload.originals.length,
      layout: payload.originals.filter((item) => item.kind === "layout").length,
    };
    Object.keys(recomputed).forEach((key) => {
      if (counts[key] !== recomputed[key]) {
        errors.push(
          `${issue.id} 的 ${key} 计数不一致：索引 ${counts[key]}，实际 ${recomputed[key]}`,
        );
      }
    });

    payload.originals.forEach((item) => {
      const stat = kindStats.get(item.kind) || { count: 0, bytes: 0 };
      stat.count += 1;
      stat.bytes += item.bytes || 0;
      kindStats.set(item.kind, stat);
    });

    readingParagraphs.forEach((block) => {
      if (!block.en && !block.zh) {
        errors.push(`${issue.id} 精读存在空段落 ${block.index}`);
      }
      if (block.en && block.en.length < 40) {
        warnings.push(`${issue.id} 精读段落 ${block.index} 英文偏短（${block.en.length} 字符）`);
      }
    });

    for (const item of questions) {
      if (!item.answer) {
        missingAnswers += 1;
        warnings.push(`${issue.id} 第 ${item.number} 题缺少答案（${item.file}）`);
      }
      if (STEM_TYPES.has(item.type) && !item.stem) {
        incompleteOptions += 1;
        warnings.push(`${issue.id} 第 ${item.number} 题缺少题干（${item.file}）`);
      }
      if ((STEM_TYPES.has(item.type) || BLANK_TYPES.has(item.type)) && item.options.length !== 4) {
        incompleteOptions += 1;
        warnings.push(
          `${issue.id} 第 ${item.number} 题选项数为 ${item.options.length}（${item.file}）`,
        );
      }
      if (SHARED_OPTION_TYPES.has(item.type) && !item.analysis.length) {
        warnings.push(`${issue.id} 第 ${item.number} 题缺少解析（${item.file}）`);
      }
    }

    const haystack = [
      ...articles.flatMap((article) => article.paragraphs.map((block) => block.text)),
      ...readingParagraphs.flatMap((block) => [block.en, block.zh]),
      ...questions.flatMap((item) => [item.stem, ...item.analysis]),
      ...qa.flatMap((item) => [item.question, item.answer, item.sentence]),
    ].join("\n");
    PROMO_PATTERNS.forEach((pattern) => {
      if (haystack.includes(pattern)) {
        promoHits += 1;
        warnings.push(`${issue.id} 正文仍含推广语片段“${pattern}”`);
      }
    });
  }

  const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  console.log("外刊库自检报告");
  console.log(`  期号：${totals.issues}（索引 ${index.issues.length}）`);
  console.log(
    `  文章：${totals.article} · 精读段落：${totals.paragraph} · 生词条：${totals.vocab}`,
  );
  console.log(`  检验题：${totals.question} · 答疑：${totals.qa} · 原件：${totals.original}`);
  console.log(
    `  原件构成：${[...kindStats]
      .map(([kind, stat]) => `${kind} ${stat.count} 份/${formatBytes(stat.bytes)}`)
      .join("，")}`,
  );
  console.log(`  主题：${index.themes.map((theme) => theme.name).join("、")}`);
  console.log(`  结构告警：${warnings.length} 条（选项/答案 ${incompleteOptions + missingAnswers} 处）`);

  if (warnings.length) {
    warnings.slice(0, MAX_DETAILS).forEach((item) => console.log(`   · ${item}`));
    if (warnings.length > MAX_DETAILS) {
      console.log(`   · 其余 ${warnings.length - MAX_DETAILS} 条告警省略`);
    }
  }

  if (errors.length) {
    console.error(`自检失败，共 ${errors.length} 个错误：`);
    errors.slice(0, MAX_DETAILS).forEach((item) => console.error(`   ✗ ${item}`));
    process.exit(1);
  }

  console.log("外刊库自检通过：期号、计数与数据文件一致。");
}

await main();
