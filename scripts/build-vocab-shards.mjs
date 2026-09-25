/**
 * 生成词汇分片数据：
 *   vocab-index/word-quick.json   点词查义用的轻量索引（词 -> 音标/释义/标签）
 *   vocab-index/lexemes-<deck>.json  模块用的词卡分片（例句、词根、记忆法）
 *
 * 数据来源：
 *   vocab-index.json                  站内考试词表（决定“属于哪类考试”）
 *   ECDict (skywind3000/ECDict)       音标、词性、英释、交换形式
 *   ECDict wordroot.txt / resemble.txt  词根词缀与形近词（记忆法）
 *
 * 用法：
 *   node scripts/build-vocab-shards.mjs            正常生成
 *   node scripts/build-vocab-shards.mjs --report   只统计不写文件
 *   ECDICT_CSV=... ECDICT_EXTRAS_DIR=... 可覆盖数据源路径
 */
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");

const ECDICT_CSV =
  process.env.ECDICT_CSV ||
  path.join(
    root,
    "..",
    "refs",
    "ecdict",
    "ecdict.csv",
  );
const ECDICT_EXTRAS_DIR =
  process.env.ECDICT_EXTRAS_DIR || path.join(root, "..", "refs", "ecdict");
const OUT_DIR = path.join(root, "vocab-index");
const VOCAB_INDEX = path.join(root, "vocab-index.json");

const DECKS = [
  { key: "kaoyan", label: "考研", title: "考研核心词库" },
  { key: "cet6", label: "六级", title: "六级核心词库" },
  { key: "cet4", label: "四级", title: "四级核心词库" },
  { key: "basic", label: "零基础", title: "零基础高频词库" },
];

const SHARD_WORD_LIMIT = 900;
const CORE_FREQUENCY = 3000;

/* ------------------------------------------------------------------ CSV */

/** 逐行解析 CSV，正确处理引号、转义引号与字段内换行。 */
async function parseCsv(filePath, onRow) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let row = [];
  let field = "";
  let quoted = false;
  let header = null;

  const flushRow = () => {
    row.push(field);
    field = "";
    if (!header) {
      header = row.map((item) => item.trim());
    } else if (row.some((item) => item.length)) {
      onRow(header, row);
    }
    row = [];
  };

  for await (const rawLine of reader) {
    const chars = rawLine.split("");
    if (quoted) {
      // 上一行走在引号内部：这一行原样接回当前字段。
      field += "\n";
    }
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index];
      if (quoted) {
        if (char === '"') {
          if (chars[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else {
        field += char;
      }
    }
    // 引号仍未闭合：字段跨行，继续读下一行。
    if (!quoted) {
      flushRow();
    }
  }
  if (field.length || row.length) {
    flushRow();
  }
}

/* ---------------------------------------------------------------- 工具 */

function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\[网络\][^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toLines(value, limit) {
  return String(value || "")
    .split("\n")
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function splitPartOfSpeech(value) {
  const text = cleanText(value);
  if (!text) {
    return [];
  }
  return [
    ...new Set(
      text
        .split(/[,/；;|\s]+/)
        .map((item) => item.trim().replace(/\.$/, ""))
        .filter((item) => /^[a-z]{1,6}$/i.test(item)),
    ),
  ].slice(0, 4);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/* ---------------------------------------------------------------- 主流程 */

const vocabIndex = JSON.parse(await fs.readFile(VOCAB_INDEX, "utf8"));
const vocabByWord = new Map();
const vocabByPhrase = new Map();
for (const entry of Object.values(vocabIndex.entries)) {
  const [word, phonetic, meaning, source, kind] = entry;
  const key = String(word || "").toLowerCase().trim();
  if (!key) {
    continue;
  }
  const record = {
    word,
    key,
    phonetic: cleanText(phonetic),
    meaning: cleanText(meaning),
    tags: String(source || "")
      .split("·")
      .map((item) => item.trim())
      .filter(Boolean),
    kind: kind === "phrase" ? "phrase" : "word",
  };
  if (record.kind === "word" && !vocabByWord.has(key)) {
    vocabByWord.set(key, record);
  } else if (record.kind === "phrase" && !vocabByPhrase.has(key)) {
    vocabByPhrase.set(key, record);
  }
}

let ecdictRows = 0;
let ecdictMatched = 0;
const ecdict = new Map();
const collected = new Map(DECKS.map((deck) => [deck.key, []]));

const deckKeysByTag = new Map([
  ["考研", "kaoyan"],
  ["六级", "cet6"],
  ["四级", "cet4"],
  ["零基础", "basic"],
]);

await parseCsv(ECDICT_CSV, (header, row) => {
  const record = {};
  header.forEach((name, index) => {
    record[name] = row[index] ?? "";
  });
  const key = String(record.word || "").toLowerCase().trim();
  if (!key) {
    return;
  }
  ecdictRows += 1;
  const local = vocabByWord.get(key);
  if (!local) {
    return;
  }
  ecdictMatched += 1;
  const tag = cleanText(record.tag).toLowerCase();
  const frequency = Number(record.frq) || 0;
  ecdict.set(key, {
    phonetic: cleanText(record.phonetic),
    translation: cleanText(record.translation),
    definition: cleanText(record.definition),
    pos: splitPartOfSpeech(record.pos || record.translation),
    exchange: cleanText(record.exchange),
    frq: frequency,
    tag,
  });
});

const wordrootRaw = await readJson(
  path.join(ECDICT_EXTRAS_DIR, "wordroot.txt"),
  {},
);
const resembleMap = await buildResembleMap(
  path.join(ECDICT_EXTRAS_DIR, "resemble.txt"),
);

/** resemble.txt 是「形近/近义词辨析」文本块，解析成 词 -> 辨析 的索引。 */
async function buildResembleMap(filePath) {
  const raw = await fs.readFile(filePath, "utf8").catch(() => "");
  const map = new Map();
  if (!raw) {
    return map;
  }
  const blocks = raw.split(/^%/m).slice(1);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const words = lines
      .shift()
      .split(/[,，、]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const note = lines.join("\n").trim().slice(0, 600);
    if (!words.length || !note) {
      continue;
    }
    for (const word of words) {
      if (!map.has(word)) {
        map.set(word, { group: words, note });
      }
    }
  }
  return map;
}

/** 把 exchange 字段（p:/i:/s:/r: 等）翻译成可读的变形提示。 */
function describeExchange(exchange) {
  if (!exchange) {
    return [];
  }
  const labels = {
    p: "过去式/过去分词",
    d: "过去分词",
    i: "现在分词",
    s: "复数/三单",
    r: "比较级",
    t: "最高级",
    "0": "原形",
    "1": "原形变化",
  };
  const hints = [];
  for (const chunk of String(exchange).split("/")) {
    const [code, value] = chunk.split(":");
    if (!value) {
      continue;
    }
    hints.push(`${labels[code] || code || "变形"}：${cleanText(value)}`);
  }
  return hints;
}

function buildEntry(local, extra) {
  const translationLines = toLines(extra?.translation || local.meaning, 6);
  const definitionLines = toLines(extra?.definition, 3).slice(0, 3);
  const root = matchesWordroot(local.key, wordrootRaw);
  const resemble = resembleMap.get(local.key) || null;
  const exampleSource = definitionLines.find((item) => item.length > 12);
  const exchangeHints = describeExchange(extra?.exchange);
  return {
    word: local.word,
    phonetic: extra?.phonetic || local.phonetic || "",
    pos: extra?.pos?.length ? extra.pos : [],
    translation: translationLines,
    definition: definitionLines,
    exchange: exchangeHints,
    frq: extra?.frq || 0,
    tags: local.tags,
    wordroot: root
      ? {
          root: cleanText(root.root),
          meaning: cleanText(root.meaning),
          class: cleanText(root.class),
          example: Array.isArray(root.example)
            ? root.example.slice(0, 5).join(" / ")
            : cleanText(root.example),
          origin: cleanText(root.origin),
        }
      : null,
    resemble: resemble
      ? {
          group: resemble.group.slice(0, 8),
          note: resemble.note.split("\n").slice(0, 3).join(" ").slice(0, 260),
        }
      : null,
    example: exampleSource || "",
  };
}

/**
 * wordroot.txt 以「词根名」为键。这里做保守匹配：
 * 只在词首/词尾出现，或词根本身较长（>=4）时允许词中出现，取最长命中。
 */
function matchesWordroot(word, table) {
  let best = null;
  let bestLength = 0;
  for (const [name, value] of Object.entries(table)) {
    const pieces = name
      .split(/[,，/\s]+/)
      .map((item) => item.replace(/^-+|-+$/g, "").toLowerCase())
      .filter((item) => item.length >= 3 && /^[a-z]+$/.test(item));
    for (const piece of pieces) {
      const atStart = word.startsWith(piece);
      const atEnd = word.endsWith(piece);
      const inside = piece.length >= 5 && word.includes(piece);
      if (!atStart && !atEnd && !inside) {
        continue;
      }
      if (piece.length > bestLength) {
        bestLength = piece.length;
        best = { ...value, root: name };
      }
    }
  }
  return best;
}

for (const [, local] of vocabByWord) {
  const extra = ecdict.get(local.key);
  const entry = buildEntry(local, extra);
  let assigned = false;
  for (const tag of local.tags) {
    const deckKey = deckKeysByTag.get(tag);
    if (deckKey) {
      collected.get(deckKey).push(entry);
      assigned = true;
    }
  }
  if (!assigned) {
    collected.get("basic").push(entry);
  }
}

/* --------------------------------------------------- 轻量点词索引（全站） */

const quickWords = {};
for (const [, local] of vocabByWord) {
  const extra = ecdict.get(local.key);
  const meaning = cleanText(extra?.translation || local.meaning);
  // 紧凑格式：音标\t释义\t标签；词形由键本身还原，避免重复存储。
  quickWords[local.key] = [
    local.phonetic || extra?.phonetic || "",
    meaning,
    local.tags.join(" "),
  ].join("\t");
}
const quickPhrases = {};
for (const [, local] of vocabByPhrase) {
  quickPhrases[local.key] = [local.phonetic, local.meaning, local.tags.join(" ")]
    .filter(Boolean)
    .join("\t");
}

const quickPayload = {
  note: "由 scripts/build-vocab-shards.mjs 生成，请勿手工修改。",
  format: "word -> 音标\\t释义\\t标签",
  source: "站内考试词表 + ECDict (skywind3000/ECDict)",
  words: quickWords,
  phrases: quickPhrases,
};

/* ------------------------------------------------------------ 分片输出 */

// 全局去重后按词频排序：高频词先出现在前面的分片，实现“先学核心词”。
const allEntries = [];
const seenWords = new Set();
for (const deck of DECKS) {
  for (const entry of collected.get(deck.key)) {
    const key = entry.word.toLowerCase();
    if (seenWords.has(key)) {
      continue;
    }
    seenWords.add(key);
    allEntries.push(entry);
  }
}
allEntries.sort((a, b) => b.frq - a.frq || a.word.localeCompare(b.word));

const shardCount = Math.max(1, Math.ceil(allEntries.length / SHARD_WORD_LIMIT));
const shardWords = [];
// 词 -> 分片文件：词卡详情按需只取一个分片，避免整库下载。
const shardMap = {};
const outputs = [];
for (let index = 0; index < shardCount; index += 1) {
  const slice = allEntries.slice(
    index * SHARD_WORD_LIMIT,
    (index + 1) * SHARD_WORD_LIMIT,
  );
  const fileName = `lexemes-${index + 1}.json`;
  for (const entry of slice) {
    shardMap[entry.word.toLowerCase()] = index + 1;
  }
  outputs.push([
    fileName,
    {
      note: "由 scripts/build-vocab-shards.mjs 生成，请勿手工修改。",
      shard: index + 1,
      total: shardCount,
      words: slice,
    },
  ]);
  shardWords.push(slice);
}

// 每份考试词表额外导出词表清单，用于筛选与进度统计。
for (const deck of DECKS) {
  const entries = collected.get(deck.key);
  outputs.push([
    `deck-${deck.key}.json`,
    {
      note: "由 scripts/build-vocab-shards.mjs 生成，请勿手工修改。",
      deck: deck.key,
      label: deck.label,
      title: deck.title,
      words: entries.map((item) => item.word),
    },
  ]);
}

const summary = DECKS.map((deck) => {
  const entries = collected.get(deck.key);
  const coverage = [];
  shardWords.forEach((slice, shardIndex) => {
    const hits = slice.filter((item) =>
      item.tags.some((tag) => deckKeysByTag.get(tag) === deck.key),
    ).length;
    if (hits) {
      coverage.push({ shard: shardIndex + 1, hits, total: slice.length });
    }
  });
  return {
    deck: deck.key,
    label: deck.label,
    title: deck.title,
    words: entries.length,
    coverage,
    withPhonetic: entries.filter((item) => item.phonetic).length,
    withExample: entries.filter((item) => item.example).length,
    withWordroot: entries.filter((item) => item.wordroot).length,
    withResemble: entries.filter((item) => item.resemble).length,
  };
});

const manifest = {
  note: "由 scripts/build-vocab-shards.mjs 生成，请勿手工修改。",
  source: "站内考试词表 + ECDict (skywind3000/ECDict)",
  updatedAt: new Date().toISOString().slice(0, 10),
  quick: "word-quick.json",
  shardMap: "shard-map.json",
  shardSize: SHARD_WORD_LIMIT,
  totalWords: allEntries.length,
  shards: Array.from({ length: shardCount }, (_, index) => ({
    shard: index + 1,
    file: `lexemes-${index + 1}.json`,
    words: shardWords[index].length,
  })),
  decks: summary,
};

if (reportOnly) {
  console.log(
    JSON.stringify({ ecdictRows, ecdictMatched, summary }, null, 2),
  );
  process.exit(0);
}

await fs.mkdir(OUT_DIR, { recursive: true });
const existing = await fs.readdir(OUT_DIR).catch(() => []);
for (const name of existing) {
  if (/^lexemes-.*\.json$/.test(name)) {
    await fs.rm(path.join(OUT_DIR, name));
  }
}

await fs.writeFile(
  path.join(OUT_DIR, "word-quick.json"),
  JSON.stringify(quickPayload),
  "utf8",
);
await fs.writeFile(
  path.join(OUT_DIR, "lexemes.json"),
  JSON.stringify(manifest),
  "utf8",
);
await fs.writeFile(
  path.join(OUT_DIR, "shard-map.json"),
  JSON.stringify({
    note: "由 scripts/build-vocab-shards.mjs 生成，请勿手工修改。",
    format: "word -> 分片号（对应 lexemes-<n>.json）",
    words: shardMap,
  }),
  "utf8",
);
for (const [fileName, payload] of outputs) {
  await fs.writeFile(
    path.join(OUT_DIR, fileName),
    JSON.stringify(payload),
    "utf8",
  );
}

const quickSize = (await fs.stat(path.join(OUT_DIR, "word-quick.json"))).size;
console.log(
  JSON.stringify(
    {
      ecdictRows,
      ecdictMatched,
      quickWords: Object.keys(quickWords).length,
      quickPhrases: Object.keys(quickPhrases).length,
      quickBytes: quickSize,
      decks: summary,
    },
    null,
    2,
  ),
);
