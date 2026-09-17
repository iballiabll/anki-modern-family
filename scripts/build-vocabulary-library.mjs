import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");
const skipNetwork = process.argv.includes("--offline");

const MISSING_MEANING = "暂无释义，可打开词卡用有道查询";
const YOUDAO_ENDPOINT = "https://dict.youdao.com/jsonapi";
const PHRASE_CACHE_PATH = path.join(
  root,
  "data",
  "phrase-meanings.json",
);
const PHONETIC_OVERRIDES_PATH = path.join(
  root,
  "data",
  "vocab-phonetic-overrides.json",
);

function resolveSource(envName, fileName) {
  const override = process.env[envName];
  return override ? path.resolve(override) : path.join(os.tmpdir(), fileName);
}

const DECKS = [
  {
    key: "cet4",
    label: "四级",
    title: "四级核心词库",
    wordTitle: "四级单词表",
    phraseTitle: "四级短语表",
    tag: "cet4",
    directory: path.join(root, "materials", "四级", "词库"),
    wordFileName: "四级单词表.csv",
    phraseFileName: "四级短语表.csv",
    phraseSourcePath: resolveSource("CET4_PHRASES", "cet4-phrases.txt"),
    phraseSourceName: "2ndLA/english-phrases · CET-4 短语表",
    words: new Map(),
    phrases: [],
  },
  {
    key: "cet6",
    label: "六级",
    title: "六级核心词库",
    wordTitle: "六级单词表",
    phraseTitle: "六级短语表",
    tag: "cet6",
    directory: path.join(root, "materials", "六级", "词库"),
    wordFileName: "六级单词表.csv",
    phraseFileName: "六级短语表.csv",
    phraseSourcePath: resolveSource("CET6_PHRASES", "cet6-phrases.txt"),
    phraseSourceName: "2ndLA/english-phrases · CET-6 短语表",
    words: new Map(),
    phrases: [],
  },
  {
    key: "ky",
    label: "考研",
    title: "考研核心词库",
    wordTitle: "考研单词表",
    phraseTitle: "考研短语表",
    tag: "ky",
    directory: path.join(root, "materials", "考研", "词库"),
    wordFileName: "考研单词表.csv",
    phraseFileName: "考研短语表.csv",
    phraseSourcePath: resolveSource("KY_PHRASES", "npee-phrases.txt"),
    phraseSourceName: "2ndLA/english-phrases · 考研短语表",
    words: new Map(),
    phrases: [],
  },
];

const ecdictPath = resolveSource("ECDICT_CSV", "ecdict.csv");
const indexFileName = "vocab-index.json";
const zeroLibraryPath = path.join(
  root,
  "materials",
  "0基础",
  "Level 1-2",
  "零基础词汇讲义Level1-2_词汇表.csv",
);

function normalizeHeadword(value) {
  return String(value || "")
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePhraseKey(value) {
  return normalizeHeadword(value)
    .replace(/[.…]+/g, " ")
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 把 sb./sth./one's 等写法归一，同一条短语的不同写法只保留一条。
function canonicalPhraseKey(value) {
  return normalizePhraseKey(value)
    .replace(/\b(sb 's|sbs)\b/g, "sb's")
    .replace(/\b(one's|someone's|somebody's)\b/g, "sb's")
    .replace(/\b(someone|somebody|one|sb)\b/g, "sb")
    .replace(/\bsomething\b/g, "sth")
    .replace(/\b(do|doing|does|did|done|to do)\s+sth\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cleanTranslation(value, maxLength = 260) {
  const lines = String(value || "")
    .split(/\\n|\n/)
    .map((line) => cleanText(line))
    .filter((line) => line && !/^\[网络\]/.test(line) && !/^\[网络释义\]/.test(line));
  const text = lines
    .join("；")
    .replace(/；{2,}/g, "；")
    .replace(/^；+|；+$/g, "")
    .trim();

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).replace(/[，,；;、\s]+$/g, "")}…`;
}

function cleanDefinition(value, maxLength = 200) {
  const lines = String(value || "")
    .split(/\\n|\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const text = lines.slice(0, 2).join("；").trim();

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).replace(/[，,；;、\s]+$/g, "")}…`;
}

function formatPhonetic(value) {
  const text = cleanText(value).replace(/^\/+|\/+$/g, "");
  return text ? `/${text}/` : "";
}

async function* parseCsvStream(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  let field = "";
  let row = [];
  let inQuotes = false;
  let quotePending = false;

  for await (const chunk of stream) {
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];

      if (quotePending) {
        quotePending = false;
        if (char === '"') {
          field += '"';
          continue;
        }
        inQuotes = false;
      }

      if (inQuotes) {
        if (char === '"') {
          if (index + 1 >= chunk.length) {
            quotePending = true;
          } else if (chunk[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
          continue;
        }
        field += char;
        continue;
      }

      if (char === '"' && field.length === 0) {
        inQuotes = true;
        continue;
      }
      if (char === ",") {
        row.push(field);
        field = "";
        continue;
      }
      if (char === "\n") {
        row.push(field);
        field = "";
        yield row;
        row = [];
        continue;
      }
      if (char === "\r") {
        continue;
      }
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

async function readCsvFile(filePath) {
  const rows = [];
  for await (const row of parseCsvStream(filePath)) {
    rows.push(row);
  }
  return rows;
}

async function loadPhraseSources() {
  let total = 0;

  for (const deck of DECKS) {
    const text = await fs.readFile(deck.phraseSourcePath, "utf8");
    const seen = new Set();
    const phrases = [];

    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .forEach((rawLine) => {
        const phrase = cleanText(rawLine);
        if (!phrase || phrase.startsWith("#") || !/\s/.test(phrase)) {
          return;
        }
        const key = canonicalPhraseKey(phrase);
        if (!key || seen.has(key)) {
          return;
        }
        seen.add(key);
        phrases.push({ phrase, key, meaning: "", definition: "" });
      });

    deck.phrases = phrases;
    total += phrases.length;
  }

  return total;
}

function buildPhraseLookup() {
  const lookup = new Map();
  DECKS.forEach((deck) => {
    deck.phrases.forEach((entry) => {
      if (!lookup.has(entry.key)) {
        lookup.set(entry.key, []);
      }
      lookup.get(entry.key).push(entry);
    });
  });
  return lookup;
}

function isPhraseHeadword(value) {
  return /\s/.test(String(value || "").trim());
}

async function scanEcdict(phraseLookup) {
  let rowIndex = 0;
  let headwordCount = 0;
  const matchedPhrases = new Set();

  for await (const row of parseCsvStream(ecdictPath)) {
    rowIndex += 1;
    if (rowIndex % 200000 === 0) {
      console.log(`  ... 已扫描 ${rowIndex} 行`);
    }
    if (row.length < 8) {
      continue;
    }

    const headword = cleanText(row[0]);
    if (!headword) {
      continue;
    }
    headwordCount += 1;

    const tags = cleanText(row[7]).split(/\s+/).filter(Boolean);
    if (tags.length > 0) {
      DECKS.forEach((deck) => {
        if (!tags.includes(deck.tag)) {
          return;
        }
        const key = normalizeHeadword(headword);
        if (!key || deck.words.has(key)) {
          return;
        }
        deck.words.set(key, {
          word: headword,
          phonetic: formatPhonetic(row[1]),
          meaning: cleanTranslation(row[3]),
          definition: cleanDefinition(row[2]),
        });
      });
    }

    if (!isPhraseHeadword(headword)) {
      continue;
    }

    const phraseKey = canonicalPhraseKey(headword);
    const targets = phraseLookup.get(phraseKey);
    if (!targets || matchedPhrases.has(phraseKey)) {
      continue;
    }

    const meaning = cleanTranslation(row[3], 180);
    if (!meaning) {
      continue;
    }

    matchedPhrases.add(phraseKey);
    targets.forEach((entry) => {
      entry.meaning = meaning;
      entry.definition = cleanDefinition(row[2], 160);
    });
  }

  return { rowIndex, headwordCount, matchedPhrases: matchedPhrases.size };
}

function cleanYoudaoText(value) {
  return cleanText(String(value || "").replace(/<[^>]*>/g, ""));
}

function pickYoudaoMeaning(data) {
  const entries = data?.ec?.word || [];
  const curated = [];

  entries.forEach((entry) => {
    (entry.trs || []).forEach((group) => {
      (group.tr || []).forEach((item) => {
        const text = cleanYoudaoText(item?.l?.i);
        if (text && !curated.includes(text)) {
          curated.push(text);
        }
      });
    });
  });

  if (curated.length > 0) {
    return cleanTranslation(curated.join("\\n"), 200);
  }

  const key = cleanYoudaoText(data?.input).toLowerCase();
  const web = [];

  (data?.web_trans?.["web-translation"] || []).forEach((entry) => {
    if (cleanYoudaoText(entry?.key).toLowerCase() !== key) {
      return;
    }
    (entry.trans || []).forEach((item) => {
      const text = cleanYoudaoText(item?.value);
      if (
        !text ||
        text.length > 30 ||
        /[a-z]{4,}/i.test(text) ||
        /»|<|>/.test(text) ||
        web.includes(text)
      ) {
        return;
      }
      web.push(text);
    });
  });

  return web.length > 0 ? cleanTranslation(web.join("\\n"), 120) : "";
}

function pickYoudaoPhonetic(data) {
  const entry = data?.ec?.word?.[0] || data?.simple?.word?.[0] || {};
  return formatPhonetic(entry.usphone || entry.ukphone || "");
}

async function fetchYoudao(phrase) {
  const endpoint = new URL(YOUDAO_ENDPOINT);
  endpoint.searchParams.set("q", phrase);

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://dict.youdao.com/",
    },
    signal: AbortSignal.timeout(9000),
  });

  if (response.status === 429) {
    throw new Error("rate-limited");
  }
  if (!response.ok) {
    throw new Error(`http-${response.status}`);
  }

  const data = await response.json();
  return {
    meaning: pickYoudaoMeaning(data),
    phonetic: pickYoudaoPhonetic(data),
  };
}

async function loadPhraseCache() {
  const text = await fs.readFile(PHRASE_CACHE_PATH, "utf8").catch(() => "");
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn(`短语释义缓存无法解析，将重新生成：${error.message}`);
    return {};
  }
}

async function savePhraseCache(cache) {
  await fs.mkdir(path.dirname(PHRASE_CACHE_PATH), { recursive: true });
  const sorted = {};
  Object.keys(cache)
    .sort((left, right) => left.localeCompare(right, "en"))
    .forEach((key) => {
      sorted[key] = cache[key];
    });
  await fs.writeFile(
    PHRASE_CACHE_PATH,
    `${JSON.stringify(sorted, null, 1)}\n`,
    "utf8",
  );
}

function applyPhraseCache(cache) {
  let applied = 0;

  DECKS.forEach((deck) => {
    deck.phrases.forEach((entry) => {
      if (entry.meaning) {
        return;
      }
      const cached = cache[entry.key];
      if (!cached) {
        return;
      }
      entry.meaning = cached.meaning || "";
      entry.phonetic = cached.phonetic || "";
      if (entry.meaning) {
        applied += 1;
      }
    });
  });

  return applied;
}

async function fillMissingPhraseMeanings(cache) {
  const pending = new Map();

  DECKS.forEach((deck) => {
    deck.phrases.forEach((entry) => {
      if (!entry.meaning && !cache[entry.key]) {
        pending.set(entry.key, entry.phrase);
      }
    });
  });

  if (skipNetwork) {
    console.log(`离线模式：跳过 ${pending.size} 条待查询短语。`);
    return { fetched: 0, failed: 0, skipped: pending.size };
  }

  const queue = [...pending.entries()];
  let fetched = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const [key, phrase] = queue[cursor];
      cursor += 1;
      let attempt = 0;

      while (attempt < 3) {
        attempt += 1;
        try {
          const result = await fetchYoudao(phrase);
          cache[key] = {
            phrase,
            meaning: result.meaning,
            phonetic: result.phonetic,
          };
          fetched += 1;
          break;
        } catch (error) {
          if (attempt >= 3) {
            failed += 1;
            console.warn(`  查询失败：${phrase}（${error.message}）`);
            break;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, attempt * 2500),
          );
        }
      }

      if (fetched % 100 === 0 && fetched > 0) {
        console.log(`  ... 已补充 ${fetched}/${queue.length} 条短语释义`);
        await savePhraseCache(cache);
      }
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
  };

  await Promise.all([worker(), worker()]);
  await savePhraseCache(cache);
  applyPhraseCache(cache);

  return { fetched, failed, skipped: 0 };
}

function escapeCsvField(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  return `${rows
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\n")}\n`;
}

function buildWordCsv(deck) {
  const words = [...deck.words.values()].sort((left, right) =>
    left.word.localeCompare(right.word, "en"),
  );
  const rows = [
    [`# ${deck.wordTitle} · 共 ${words.length} 词 · 每 50 词一个单元`],
    ["# 释义来源：ECDICT（MIT License）https://github.com/skywind3000/ECDICT"],
    ["单词", "音标", "中文释义", "英文释义"],
  ];

  words.forEach((word) => {
    rows.push([word.word, word.phonetic, word.meaning, word.definition]);
  });

  return toCsv(rows);
}

function buildPhraseCsv(deck) {
  const phrases = [...deck.phrases].sort((left, right) =>
    left.phrase.localeCompare(right.phrase, "en"),
  );
  const rows = [
    [`# ${deck.phraseTitle} · 共 ${phrases.length} 条 · 每 50 条一个单元`],
    [
      `# 短语来源：${deck.phraseSourceName}（CC BY-SA 4.0）；释义来源：ECDICT（MIT License）`,
    ],
    ["单词", "音标", "中文释义", "英文释义"],
  ];

  phrases.forEach((entry) => {
    rows.push([
      entry.phrase,
      entry.phonetic || "",
      entry.meaning || MISSING_MEANING,
      entry.definition,
    ]);
  });

  return toCsv(rows);
}

function compactMeaning(value, maxLength) {
  const text = cleanText(value);
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength);
  const boundary = Math.max(
    cut.lastIndexOf("；"),
    cut.lastIndexOf("，"),
    cut.lastIndexOf("、"),
  );
  return `${(boundary > maxLength * 0.5 ? cut.slice(0, boundary) : cut).trim()}…`;
}

async function loadZeroLibraryEntries() {
  const entries = [];
  const rows = await readCsvFile(zeroLibraryPath).catch(() => []);
  const header = rows.find((row) =>
    row.map((cell) => cleanText(cell)).includes("单词"),
  );
  if (!header) {
    return entries;
  }

  const headerIndex = rows.indexOf(header);
  const headers = header.map((cell) => cleanText(cell));
  const wordIndex = headers.indexOf("单词");
  const phoneticIndex = headers.indexOf("音标");
  const meaningIndex = headers.indexOf("中文释义");

  rows.slice(headerIndex + 1).forEach((row) => {
    const word = cleanText(row[wordIndex]);
    if (!word || word === "单词") {
      return;
    }
    entries.push({
      word,
      phonetic: formatPhonetic(row[phoneticIndex]),
      meaning: cleanTranslation(row[meaningIndex], 160),
      source: "零基础",
      kind: "word",
    });
  });

  return entries;
}

function buildIndexEntries(zeroEntries) {
  const entries = new Map();

  const addEntry = (entry) => {
    const key = normalizeHeadword(entry.word);
    if (!key) {
      return;
    }
    const existing = entries.get(key);
    if (!existing) {
      entries.set(key, {
        word: entry.word,
        phonetic: entry.phonetic,
        meaning: entry.meaning,
        sources: [entry.source],
        kind: entry.kind,
      });
      return;
    }
    if (entry.phonetic && !existing.phonetic) {
      existing.phonetic = entry.phonetic;
    }
    if (!existing.meaning && entry.meaning) {
      existing.meaning = entry.meaning;
    }
    if (!existing.sources.includes(entry.source)) {
      existing.sources.push(entry.source);
    }
  };

  DECKS.forEach((deck) => {
    deck.words.forEach((word) => {
      addEntry({
        word: word.word,
        phonetic: word.phonetic,
        meaning: compactMeaning(word.meaning, 150),
        source: deck.label,
        kind: "word",
      });
    });
    deck.phrases.forEach((entry) => {
      addEntry({
        word: entry.phrase,
        phonetic: entry.phonetic || "",
        meaning: compactMeaning(entry.meaning, 150),
        source: deck.label,
        kind: "phrase",
      });
    });
  });

  zeroEntries.forEach(addEntry);
  return entries;
}

async function applyPhoneticOverrides(indexEntries) {
  const overrides = await fs
    .readFile(PHONETIC_OVERRIDES_PATH, "utf8")
    .then((raw) => JSON.parse(raw))
    .catch(() => ({}));
  let applied = 0;

  Object.entries(overrides).forEach(([word, phonetic]) => {
    const key = normalizeHeadword(word);
    const entry = indexEntries.get(key);
    if (!entry || entry.phonetic || !cleanText(phonetic)) {
      return;
    }
    entry.phonetic = formatPhonetic(phonetic);
    applied += 1;
  });

  return applied;
}

async function writeOutputs(indexEntries) {
  for (const deck of DECKS) {
    await fs.mkdir(deck.directory, { recursive: true });
    await fs.writeFile(
      path.join(deck.directory, deck.wordFileName),
      buildWordCsv(deck),
      "utf8",
    );
    await fs.writeFile(
      path.join(deck.directory, deck.phraseFileName),
      buildPhraseCsv(deck),
      "utf8",
    );
  }

  const payload = {
    note: "由 scripts/build-vocabulary-library.mjs 生成，请勿手工修改。",
    fields: ["word", "phonetic", "meaning", "source", "kind"],
    entries: {},
  };

  [...indexEntries.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .forEach(([key, entry]) => {
      payload.entries[key] = [
        entry.word,
        entry.phonetic,
        entry.meaning,
        entry.sources.join(" · "),
        entry.kind,
      ];
    });

  const filePath = path.join(root, indexFileName);
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
  return filePath;
}

async function main() {
  console.log(`数据源：${ecdictPath}`);

  const phraseCount = await loadPhraseSources();
  const phraseLookup = buildPhraseLookup();

  console.log("扫描 ECDICT ...");
  const stats = await scanEcdict(phraseLookup);

  const phraseCache = await loadPhraseCache();
  const cachedCount = applyPhraseCache(phraseCache);
  if (cachedCount > 0) {
    console.log(`从缓存补充短语释义：${cachedCount} 条`);
  }
  const fetchStats = await fillMissingPhraseMeanings(phraseCache);

  const zeroEntries = await loadZeroLibraryEntries();
  const indexEntries = buildIndexEntries(zeroEntries);
  const overriddenPhonetics = await applyPhoneticOverrides(indexEntries);

  console.log("");
  console.log(`ECDICT 行数：${stats.rowIndex}，有效词条：${stats.headwordCount}`);
  if (fetchStats.fetched > 0 || fetchStats.failed > 0) {
    console.log(
      `有道短语补录：新增 ${fetchStats.fetched} 条，失败 ${fetchStats.failed} 条`,
    );
  }
  DECKS.forEach((deck) => {
    const matched = deck.phrases.filter((entry) => entry.meaning).length;
    const missing = deck.phrases.length - matched;
    console.log(
      `${deck.label}：单词 ${deck.words.size}，短语 ${deck.phrases.length}（已匹配释义 ${matched}，缺失 ${missing}）`,
    );
  });
  console.log(`零基础词条：${zeroEntries.length}`);
  if (overriddenPhonetics > 0) {
    console.log(`已补齐本地音标：${overriddenPhonetics} 条`);
  }
  console.log(`查词索引条目：${indexEntries.size}（短语源共 ${phraseCount} 条）`);

  if (reportOnly) {
    const missingSamples = DECKS.flatMap((deck) =>
      deck.phrases
        .filter((entry) => !entry.meaning)
        .slice(0, 8)
        .map((entry) => `${deck.label} · ${entry.phrase}`),
    );
    console.log("");
    console.log("未匹配示例：");
    missingSamples.forEach((sample) => console.log(`  ${sample}`));
    return;
  }

  const indexFile = await writeOutputs(indexEntries);
  console.log("");
  console.log(`已写入六个词库 CSV 与 ${path.relative(root, indexFile)}`);
}

await main();
