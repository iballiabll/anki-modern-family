/**
 * 把公开的《恋练有词》词头表整理成站内词库源数据。
 *
 * 输入是公开仓库 blueweiwei/wordbook-llyc 的
 * `2025恋练有词考研英语词汇.txt`（词头 + 章节/单元顺序，不含释义）。
 * 该仓库未标注许可证，因此这里只保留「词头与顺序」这类事实信息，
 * 释义、音标、例句一律由 MIT 许可的 ECDict 在 build-vocab-shards.mjs 里补齐。
 *
 * 用法：
 *   node scripts/build-llyc-deck.mjs
 *   node scripts/build-llyc-deck.mjs --input <词头txt> --out <输出json>
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const inputPath = path.resolve(
  root,
  argValue(
    "--input",
    path.join(".cache", "llyc-source", "2025恋练有词考研英语词汇.txt"),
  ),
);
const outputPath = path.resolve(
  root,
  argValue("--out", path.join("data", "llyc-2027-words.json")),
);

const UNIT_PATTERN = /^#Chapter\s+(\d+)\s+(.+?)\s+Unit\s+(\d+)\s*$/;
const CHAPTER_PATTERN = /^#Chapter\s+(\d+)\s+(.+)$/;
const BONUS_PATTERN = /^#加分宝\s+(.+)$/;

function normalizeWord(value) {
  return String(value || "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isHeadword(value) {
  return /^[a-z][a-z0-9'.\-]*(?: [a-z][a-z0-9'.\-]*)*$/.test(value);
}

const raw = await fs.readFile(inputPath, "utf8");
const lines = raw.split(/\r?\n/);

const units = [];
const seen = new Set();
const allWords = [];
let current = null;
let skipped = 0;

for (const rawLine of lines) {
  const line = String(rawLine || "").trim();
  if (!line) {
    continue;
  }
  if (line.startsWith("#")) {
    const unitMatch = line.match(UNIT_PATTERN);
    if (unitMatch) {
      const chapter = Number(unitMatch[1]);
      const unit = Number(unitMatch[3]);
      current = {
        id: `c${String(chapter).padStart(2, "0")}u${String(unit).padStart(2, "0")}`,
        chapter,
        chapterTitle: unitMatch[2].trim(),
        unit,
        label: `Unit ${String(unit).padStart(2, "0")}`,
        words: [],
      };
      units.push(current);
      continue;
    }
    const chapterMatch = line.match(CHAPTER_PATTERN);
    if (chapterMatch) {
      const chapter = Number(chapterMatch[1]);
      const title = chapterMatch[2].trim();
      current = {
        id: `c${String(chapter).padStart(2, "0")}`,
        chapter,
        chapterTitle: title,
        unit: null,
        label: title,
        words: [],
      };
      units.push(current);
      continue;
    }
    const bonusMatch = line.match(BONUS_PATTERN);
    if (bonusMatch) {
      const title = bonusMatch[1].trim();
      current = {
        id: `bonus-${units.filter((item) => item.id.startsWith("bonus-")).length + 1}`,
        chapter: null,
        chapterTitle: "加分宝",
        unit: null,
        label: `加分宝 · ${title}`,
        words: [],
      };
      units.push(current);
      continue;
    }
    continue;
  }

  const word = normalizeWord(line);
  if (!isHeadword(word)) {
    skipped += 1;
    continue;
  }
  if (seen.has(word)) {
    continue;
  }
  seen.add(word);
  allWords.push(word);
  if (current) {
    current.words.push(word);
  }
}

const payload = {
  note: "由 scripts/build-llyc-deck.mjs 生成，请勿手工修改。",
  deck: "llyc2027",
  label: "恋练有词",
  title: "恋练有词 2027 · 备考词库",
  provenance: {
    headwords:
      "blueweiwei/wordbook-llyc《2025恋练有词考研英语词汇.txt》（词头与单元顺序，仓库最近提交于 2026-07-20）",
    meanings: "skywind3000/ECDict（MIT）：音标、释义、词形变化、词根与形近词",
    disclaimer:
      "公开渠道暂无《恋练有词 2027》官方电子词表；本词库以可获取到的最新公开词表的词头与顺序作为 2027 备考基线，释义等由 ECDict 补齐，并非官方 2027 版电子书。",
  },
  stats: {
    words: allWords.length,
    units: units.length,
    skipped,
  },
  units,
  words: allWords,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 1)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      input: inputPath,
      output: outputPath,
      words: allWords.length,
      units: units.length,
      skipped,
    },
    null,
    2,
  ),
);
