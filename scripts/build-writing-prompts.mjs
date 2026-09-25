/**
 * 从真题语料里抽出作文题目，生成写作模块的题库：
 *   writing-data/index.json        轻量清单（筛选用：考试、年份、题型、字数）
 *   writing-data/<shard>.json      按「考试 + 年份」分片的完整题目（题干、提纲、范文、评分点）
 *
 * 数据来源（都是站内已经生成好的语料，不额外下载）：
 *   kaoyan-data/<paper>.js     考研英语一 / 英语二，sections 里 kind === "writing" 的 writingParts
 *   cet6-extra-data/<id>.js    六级写作，paper.writing
 *   cet4-writing-papers.js     四级写作题库（人工整理，sourceKind: "curated"）
 *
 * 用法：
 *   node scripts/build-writing-prompts.mjs
 *   node scripts/build-writing-prompts.mjs --print  只打印结构，不写文件
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const printOnly = process.argv.includes("--print");
const OUT_DIR = path.join(root, "writing-data");

const EXAM_LABELS = {
  "english-i": "考研英语一",
  "english-ii": "考研英语二",
  cet4: "四级",
  cet6: "六级",
};

/** 在沙箱里跑一份语料文件，拿到它挂到 window 上的数据。 */
async function evaluate(filePath, symbol) {
  const source = await fs.readFile(filePath, "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: filePath, timeout: 5000 });
  return sandbox.window[symbol];
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLines(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.map(cleanText).filter(Boolean);
}

/** facts / points / outline / breakdown / rubric / pitfalls 都是 {label|no, core, detail} 结构。 */
function cleanNoteList(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") {
        return cleanText(item);
      }
      const head = [item.label, item.no, item.tag, item.dim]
        .map(cleanText)
        .filter(Boolean)
        .join(" · ");
      const core = cleanText(item.core);
      const detail = cleanText(item.detail);
      const body = [core, detail].filter(Boolean).join("：");
      return [head, body].filter(Boolean).join("｜");
    })
    .filter(Boolean);
}

/** 逐段范文：既接受字符串数组，也接受整段文本。 */
function cleanEssay(value) {
  if (!value) {
    return [];
  }
  const list = Array.isArray(value) ? value : [value];
  return list.map(cleanText).filter(Boolean);
}

/**
 * 字数要求优先从题干里解析（"160-200 words" / "about 100 words" /
 * "at least 150 words but no more than 200 words"），题干的固定字段只作兜底。
 */
function parseWordLimit(rawValue, promptText) {
  const label = cleanText(rawValue);
  const source = cleanText(promptText).toLowerCase();
  const build = (min, max) => {
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return {
      label: low === high ? `约 ${low} 词` : `${low}-${high} 词`,
      min: low,
      max: high,
      target: Math.round((low + high) / 2),
    };
  };

  const range = source.match(
    /(\d{2,3})\s*(?:-|–|—|~|至|到)\s*(\d{2,3})\s*words?/,
  );
  if (range) {
    return build(Number(range[1]), Number(range[2]));
  }
  const bounded = source.match(
    /at least\s+(\d{2,3})\s*words?[^.]*?no more than\s+(\d{2,3})\s*words?/,
  );
  if (bounded) {
    return build(Number(bounded[1]), Number(bounded[2]));
  }
  const about = source.match(/(?:about|around|approximately)\s+(\d{2,3})\s*words?/);
  if (about) {
    return build(Number(about[1]), Number(about[1]));
  }
  const atLeast = source.match(/at least\s+(\d{2,3})\s*words?/);
  if (atLeast) {
    return build(Number(atLeast[1]), Number(atLeast[1]) + 40);
  }
  const noMore = source.match(/no (?:more|less) than\s+(\d{2,3})\s*words?/);
  if (noMore) {
    return build(Number(noMore[1]) - 40, Number(noMore[1]));
  }
  const anyWords = source.match(/(\d{2,3})\s*words?/);
  if (anyWords) {
    return build(Number(anyWords[1]), Number(anyWords[1]));
  }
  if (label && /^\d+$/.test(label)) {
    return build(Number(label), Number(label));
  }
  return { label, min: 0, max: 0, target: 0 };
}

function shardName(exam, year) {
  return `${exam}-${year || "unknown"}`;
}

async function collectKaoyan() {
  const dir = path.join(root, "kaoyan-data");
  const names = (await fs.readdir(dir)).filter(
    (name) => name.endsWith(".js") && name !== "index.js",
  );
  const prompts = [];

  for (const name of names) {
    const id = name.replace(/\.js$/, "");
    let payload;
    try {
      payload = await evaluate(path.join(dir, name), "IBALL_KAOYAN_LIBRARY");
    } catch {
      continue;
    }
    const paper = payload?.[id] || Object.values(payload || {})[0];
    if (!paper) {
      continue;
    }
    const exam = paper.track;
    const examLabel = paper.trackLabel || EXAM_LABELS[exam] || exam;

    for (const section of paper.sections || []) {
      if (section.kind !== "writing") {
        continue;
      }
      const parts = Array.isArray(section.writingParts)
        ? section.writingParts
        : [];
      const list = parts.length ? parts : [section];

      list.forEach((part, index) => {
        const promptText = cleanLines([
          part.prompt,
          part.text,
          part.stem,
          part.directions,
        ]).join(" ");
        if (!promptText) {
          return;
        }
        const number = Number(part.number) || index + 1;
        const partName = cleanText(part.part) || `Part ${index + 1}`;
        // 极个别年份的真题语料缺字数要求，按考研写作惯例兜底：
        // Part A 应用文约 100 词，Part B 短文 160-200 词。
        const wordLimit = parseWordLimit(part.wordLimit, promptText);
        if (wordLimit.min === 0) {
          const isPartA = /part\s*a/i.test(partName);
          Object.assign(
            wordLimit,
            isPartA
              ? { label: "约 100 词", min: 100, max: 100, target: 100 }
              : { label: "160-200 词", min: 160, max: 200, target: 180 },
          );
        }
        const points =
          Number.isFinite(Number(part.points)) && Number(part.points) > 0
            ? [`满分 ${Number(part.points)} 分`]
            : cleanNoteList(part.points);

        prompts.push({
          id: `${paper.id}-p${number}`,
          exam,
          examLabel,
          year: paper.year,
          kind: "kaoyan",
          label: `${partName} · 第 ${number} 题`,
          shortLabel: partName,
          part: partName,
          directions: cleanLines(section.directions),
          prompt: promptText,
          outline: cleanNoteList(part.outline || section.outline),
          points,
          facts: [],
          rubric: cleanNoteList(part.rubric),
          pitfalls: cleanNoteList(part.pitfalls),
          wordLimit: wordLimit.label,
          wordLimitMin: wordLimit.min,
          wordLimitMax: wordLimit.max,
          model: cleanLines(part.model || part.sample || part.reference),
          modelTranslation: [],
          breakdown: [],
          paperTitle: paper.title,
          sourceUrl: cleanText(paper.source?.url),
          shard: shardName(exam, paper.year),
        });
      });
    }
  }
  return prompts;
}

async function collectCet6() {
  const dir = path.join(root, "cet6-extra-data");
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".js"));
  } catch {
    return [];
  }
  const prompts = [];

  for (const name of names) {
    const id = name.replace(/\.js$/, "");
    let payload;
    try {
      payload = await evaluate(path.join(dir, name), "IBALL_CET6_EXTRA_LIBRARY");
    } catch {
      continue;
    }
    const paper = payload?.[id] || Object.values(payload || {})[0];
    const writing = paper?.writing;
    if (!writing) {
      continue;
    }
    const year =
      Number(paper?.meta?.year) || Number(String(id).slice(0, 4)) || null;
    const items = Array.isArray(writing) ? writing : [writing];

    items.forEach((item, index) => {
      const directions = cleanLines(item.directions);
      const promptText =
        cleanLines([item.prompt, item.text]).join(" ") || directions.join(" ");
      if (!promptText) {
        return;
      }
      const partName = cleanText(item.part) || `Part ${index + 1}`;
      const wordLimit = parseWordLimit("", directions.join(" "));

      prompts.push({
        id: `${id}-w${index + 1}`,
        exam: "cet6",
        examLabel: EXAM_LABELS.cet6,
        year,
        kind: "cet6",
        label: `${partName} · 写作`,
        shortLabel: partName,
        part: partName,
        directions,
        prompt: promptText,
        outline: cleanNoteList(item.outline),
        points: cleanNoteList(item.points),
        facts: cleanNoteList(item.facts),
        rubric: cleanNoteList(item.rubric),
        pitfalls: cleanNoteList(item.pitfalls),
        wordLimit: wordLimit.label,
        wordLimitMin: wordLimit.min,
        wordLimitMax: wordLimit.max,
        model: cleanEssay(item.essay),
        modelTranslation: cleanLines(item.essayTranslation),
        breakdown: cleanNoteList(item.breakdown),
        paperTitle: paper?.meta?.title || `六级 ${id}`,
        sourceUrl: cleanText(paper?.meta?.sourceUrl || item.sourceUrl),
        shard: shardName("cet6", year),
      });
    });
  }
  return prompts;
}

/**
 * 四级写作没有站内真题语料，题库来自人工整理的 cet4-writing-papers.js。
 * 每篇 paper 用 meta.sourceKind 标注数据性质，页面据此显示“题材整理”，
 * 避免把整理题当成官方真题原文。
 */
async function collectCet4() {
  let payload;
  try {
    payload = await evaluate(
      path.join(root, "cet4-writing-papers.js"),
      "IBALL_CET4_WRITING_PAPERS",
    );
  } catch {
    return [];
  }
  const prompts = [];

  (payload?.papers || []).forEach((paper) => {
    const id = cleanText(paper?.id);
    const year = Number(paper?.meta?.year) || null;
    if (!id || !year) {
      return;
    }
    const items = Array.isArray(paper.writing) ? paper.writing : [];

    items.forEach((item, index) => {
      const directions = cleanLines(item.directions);
      const promptText = cleanLines([item.prompt, item.text]).join(" ") ||
        directions.join(" ");
      if (!promptText) {
        return;
      }
      const partName = cleanText(item.part) || `Part ${index + 1}`;
      const wordLimit = parseWordLimit("", [promptText, ...directions].join(" "));

      prompts.push({
        id: `${id}-w${index + 1}`,
        exam: "cet4",
        examLabel: EXAM_LABELS.cet4,
        year,
        kind: "cet4",
        label: `${partName} · 写作`,
        shortLabel: partName,
        part: partName,
        directions,
        prompt: promptText,
        outline: cleanNoteList(item.outline),
        points: cleanNoteList(item.points),
        facts: cleanNoteList(item.facts),
        rubric: cleanNoteList(item.rubric),
        pitfalls: cleanNoteList(item.pitfalls),
        wordLimit: wordLimit.label,
        wordLimitMin: wordLimit.min,
        wordLimitMax: wordLimit.max,
        model: cleanEssay(item.essay),
        modelTranslation: cleanLines(item.essayTranslation),
        breakdown: cleanNoteList(item.breakdown),
        sourceKind: cleanText(paper?.meta?.sourceKind) || "curated",
        paperTitle: cleanText(paper?.meta?.title) || `四级写作 ${year}`,
        sourceUrl: cleanText(paper?.meta?.sourceUrl || item.sourceUrl),
        shard: shardName("cet4", year),
      });
    });
  });
  return prompts;
}

const [kaoyan, cet6, cet4] = await Promise.all([
  collectKaoyan(),
  collectCet6(),
  collectCet4(),
]);
const prompts = [...kaoyan, ...cet6, ...cet4]
  .filter((item) => item.prompt)
  .map((item) => ({
    ...item,
    promptWords: item.prompt.split(/\s+/).filter(Boolean).length,
  }))
  .sort(
    (left, right) =>
      (right.year || 0) - (left.year || 0) ||
      String(left.exam).localeCompare(String(right.exam)) ||
      String(left.label).localeCompare(String(right.label), "zh-CN"),
  );

if (printOnly) {
  const counts = prompts.reduce((accumulator, item) => {
    accumulator[item.exam] = (accumulator[item.exam] || 0) + 1;
    return accumulator;
  }, {});
  console.log(
    JSON.stringify(
      {
        total: prompts.length,
        counts,
        kaoyanWithoutModel: prompts.filter(
          (item) => item.kind === "kaoyan" && item.model.length === 0,
        ).length,
        sample: prompts.slice(0, 2),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const exams = [...new Set(prompts.map((item) => item.exam))].sort();
const years = [...new Set(prompts.map((item) => item.year).filter(Boolean))].sort(
  (left, right) => right - left,
);
const shardMap = {};
prompts.forEach((item) => {
  shardMap[item.shard] = `./writing-data/${item.shard}.json`;
});

const index = {
  note: "由 scripts/build-writing-prompts.mjs 生成，请勿手工修改。",
  total: prompts.length,
  exams,
  examLabels: EXAM_LABELS,
  years,
  updatedAt: new Date().toISOString().slice(0, 10),
  shards: shardMap,
  items: prompts.map((item) => ({
    id: item.id,
    exam: item.exam,
    examLabel: item.examLabel,
    year: item.year,
    label: item.label,
    part: item.part,
    paperTitle: item.paperTitle,
    wordLimit: item.wordLimit,
    wordLimitMin: item.wordLimitMin,
    wordLimitMax: item.wordLimitMax,
    hasModel: item.model.length > 0,
    shard: item.shard,
  })),
};

const grouped = new Map();
prompts.forEach((item) => {
  const bucket = grouped.get(item.shard) || [];
  bucket.push(item);
  grouped.set(item.shard, bucket);
});

await fs.mkdir(OUT_DIR, { recursive: true });
const existing = await fs.readdir(OUT_DIR).catch(() => []);
await Promise.all(
  existing
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .map((name) => fs.rm(path.join(OUT_DIR, name), { force: true })),
);
await fs.writeFile(
  path.join(OUT_DIR, "index.json"),
  JSON.stringify(index),
  "utf8",
);
await Promise.all(
  [...grouped.entries()].map(([shard, items]) =>
    fs.writeFile(
      path.join(OUT_DIR, `${shard}.json`),
      JSON.stringify({
        note: "由 scripts/build-writing-prompts.mjs 生成，请勿手工修改。",
        shard,
        total: items.length,
        prompts: items,
      }),
      "utf8",
    ),
  ),
);

console.log(
  JSON.stringify(
    {
      total: prompts.length,
      kaoyan: kaoyan.length,
      cet6: cet6.length,
      cet4: cet4.length,
      shards: grouped.size,
      exams,
      years: years.length,
    },
    null,
    2,
  ),
);
