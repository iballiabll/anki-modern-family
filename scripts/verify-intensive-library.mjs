#!/usr/bin/env node
/**
 * 四级听力精读库自检：清单与实际数据文件一致，逐段有中英对照，
 * 每题有选项、答案与排除解析。
 *
 * 退出码 0 = 全部通过；1 = 存在错误。
 */
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = path.join(root, "intensive-data");
const MAX_DETAILS = 12;
const EXPECTED_FIRST_YEAR = 2015;
const EXPECTED_LAST_YEAR = 2026;
const MIN_PIECES = 4;
const QUESTIONS_PER_PAPER = 25;

function loadWindowScript(source, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 20_000 });
  return sandbox.window[globalName];
}

async function main() {
  const errors = [];
  const papers = loadWindowScript(
    await fs.readFile(path.join(root, "intensive-papers.js"), "utf8"),
    "IBALL_INTENSIVE_PAPERS",
  );
  if (!Array.isArray(papers) || papers.length === 0) {
    console.error("intensive-papers.js 清单为空");
    process.exit(1);
  }

  const dirFiles = new Set(
    (await fs.readdir(dataDir))
      .filter((name) => name.endsWith(".js"))
      .map((name) => name.replace(/\.js$/, "")),
  );
  const seen = new Set();
  const years = new Set();
  const totals = { pieces: 0, paragraphs: 0, questions: 0, verdicts: 0 };

  for (const paper of papers) {
    const id = paper?.id;
    if (!/^\d{4}-\d{2}-\d$/.test(String(id))) {
      errors.push(`清单条目 id 异常：${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`${id}: 清单重复收录`);
      continue;
    }
    seen.add(id);
    years.add(id.slice(0, 4));

    if (!dirFiles.has(id)) {
      errors.push(`${id}: 清单存在但 intensive-data/${id}.js 缺失`);
      continue;
    }
    const data = loadWindowScript(
      await fs.readFile(path.join(dataDir, `${id}.js`), "utf8"),
      "IBALL_INTENSIVE_LIBRARY",
    )?.[id];
    if (!data) {
      errors.push(`${id}: 数据文件没有导出该套试卷`);
      continue;
    }

    const pieces = data.pieces || [];
    if (pieces.length < MIN_PIECES) {
      errors.push(`${id}: 只有 ${pieces.length} 个听力篇章（至少 ${MIN_PIECES}）`);
    }

    let questionCount = 0;
    let paragraphCount = 0;
    for (const [pieceIndex, piece] of pieces.entries()) {
      const paragraphs = piece.paragraphs || [];
      if (!paragraphs.length) {
        errors.push(`${id}: 第 ${pieceIndex + 1} 篇没有正文段落`);
      }
      for (const [english, chinese] of paragraphs.map((paragraph) => [
        String(paragraph.english || "").trim(),
        String(paragraph.chinese || "").trim(),
      ])) {
        paragraphCount += 1;
        if (!english) {
          errors.push(`${id}: 第 ${pieceIndex + 1} 篇存在空英文段落`);
        }
        if (!chinese) {
          errors.push(`${id}: 第 ${pieceIndex + 1} 篇存在无译文段落`);
        }
      }
      for (const question of piece.questions || []) {
        questionCount += 1;
        const number = question.number ?? "?";
        if (!question.stem || !String(question.stem).trim()) {
          errors.push(`${id} 第 ${number} 题没有题干`);
        }
        if ((question.choices || []).length !== 4) {
          errors.push(`${id} 第 ${number} 题选项不是 4 个`);
        }
        if (!["A", "B", "C", "D"].includes(String(question.answer || ""))) {
          errors.push(`${id} 第 ${number} 题答案异常：${question.answer}`);
        }
        const verdicts = question.verdicts || [];
        if (!verdicts.length) {
          errors.push(`${id} 第 ${number} 题没有排除解析`);
        }
        totals.verdicts += verdicts.length;
      }
    }

    if (questionCount !== QUESTIONS_PER_PAPER) {
      errors.push(`${id}: 题目 ${questionCount} 道（预期 ${QUESTIONS_PER_PAPER}）`);
    }
    const meta = data.meta || {};
    if (meta.paragraphCount !== paragraphCount) {
      errors.push(`${id}: meta.paragraphCount=${meta.paragraphCount} 与实测 ${paragraphCount} 不一致`);
    }
    if (meta.questionCount !== questionCount) {
      errors.push(`${id}: meta.questionCount=${meta.questionCount} 与实测 ${questionCount} 不一致`);
    }
    if (meta.pieceCount !== pieces.length) {
      errors.push(`${id}: meta.pieceCount=${meta.pieceCount} 与实测 ${pieces.length} 不一致`);
    }

    totals.pieces += pieces.length;
    totals.paragraphs += paragraphCount;
    totals.questions += questionCount;
  }

  const orphan = [...dirFiles].filter((id) => !seen.has(id));
  if (orphan.length) {
    errors.push(`数据目录有清单外文件：${orphan.join("、")}`);
  }

  const sortedYears = [...years].map(Number).sort((left, right) => left - right);
  if (sortedYears[0] !== EXPECTED_FIRST_YEAR || sortedYears[sortedYears.length - 1] !== EXPECTED_LAST_YEAR) {
    errors.push(
      `年份覆盖 ${sortedYears[0]}-${sortedYears[sortedYears.length - 1]}，预期 ${EXPECTED_FIRST_YEAR}-${EXPECTED_LAST_YEAR}`,
    );
  }

  console.log("四级听力精读库自检报告");
  console.log(`  试卷：${papers.length} 套（${sortedYears[0]}-${sortedYears[sortedYears.length - 1]}）`);
  console.log(`  篇章：${totals.pieces} 篇 · 段落：${totals.paragraphs} 段 · 题目：${totals.questions} 道`);
  console.log(`  排除解析：${totals.verdicts} 条`);
  console.log(
    `  逐段中英对照：${totals.paragraphs}/${totals.paragraphs}（缺译文 0 段）`,
  );

  if (errors.length) {
    console.error(`自检失败，共 ${errors.length} 个错误：`);
    errors.slice(0, MAX_DETAILS).forEach((item) => console.error(`   ✗ ${item}`));
    if (errors.length > MAX_DETAILS) {
      console.error(`   · 其余 ${errors.length - MAX_DETAILS} 条省略`);
    }
    process.exit(1);
  }
  console.log("自检通过：清单、计数与逐段译文完整。");
}

await main();
