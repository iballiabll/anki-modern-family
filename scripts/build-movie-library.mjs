/**
 * Builds the movie intensive-reading library for one episode.
 *
 * Sources:
 *   - The structured transcript produced by build-movie-script.mjs
 *   - The user's Anki CSV cards, when present
 *   - The curated markdown word list, when present
 *   - The reviewed full-script translation and grammar-note files, when present
 *
 * Usage:
 *   node scripts/build-movie-library.mjs S01E01
 *   node scripts/build-movie-library.mjs S01E01 --translate
 *
 * The --translate flag only fills blocks that could not be matched to a
 * user-provided or curated translation. Machine translations are stored
 * separately and are always marked in the generated page.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const episode = process.argv[2] || "S01E01";
const shouldTranslate = process.argv.includes("--translate");
const showDirectory = path.join(root, "materials", "电影", "摩登家庭");
const outputDirectory = path.join(root, "movie-data");
const sourceLinesPath = path.join(
  showDirectory,
  `${episode.toLowerCase()}-lines.json`,
);
const sourceCardsPath = path.join(showDirectory, `${episode}-Anki词卡.csv`);
const sourceMarkdownPath = path.join(showDirectory, `${episode} 完整 100.md`);
const outputPath = path.join(outputDirectory, `${episode}.js`);
const manifestPath = path.join(outputDirectory, "index.js");
const machineCachePath = path.join(
  outputDirectory,
  `${episode.toLowerCase()}-machine-translations.json`,
);
const reviewedTranslationsPath = path.join(
  showDirectory,
  `${episode.toLowerCase()}-reviewed-translations.json`,
);
const grammarNotesPath = path.join(
  showDirectory,
  `${episode.toLowerCase()}-grammar-notes.json`,
);
const scenesConfigPath = path.join(
  showDirectory,
  `${episode.toLowerCase()}-scenes.json`,
);
const cuesPath = path.join(
  showDirectory,
  episode,
  `${episode}-cues.json`,
);

const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MACHINE_MARKER = "\n<<<IBALL-MOVIE>>>\n";
const MAX_TRANSLATION_BATCH = 10;
const TRANSLATION_CONCURRENCY = 1;
let googleTranslationAvailable = true;

// Hand-curated scene map for S01E01. Later episodes get a per-episode
// <id>-scenes.json when one exists, otherwise scenes are derived from the
// largest dialogue gaps so the layout script stays episode-agnostic.
const S01E01_SCENE_RANGES = [
  { start: 1, end: 25, title: "开场：Claire 叫大家吃早餐" },
  { start: 26, end: 48, title: "Gloria、Manny 与足球赛" },
  { start: 49, end: 93, title: "领养 Lily：机场与初见" },
  { start: 94, end: 122, title: "Luke、Dylan 与家里的小冲突" },
  { start: 123, end: 144, title: "BB 枪事件" },
  { start: 145, end: 172, title: "Jay、Gloria 的相处" },
  { start: 173, end: 202, title: "Lily 夜里哭与壁画冲突" },
  { start: 203, end: 219, title: "Mitchell 还没告诉家人" },
  { start: 220, end: 255, title: "Dylan 到访，Phil 滑倒" },
  { start: 256, end: 290, title: "Manny 的表白计划" },
  { start: 291, end: 346, title: "Alex、Haley 与性教育" },
  { start: 347, end: 383, title: "晚饭准备与家庭对话" },
  { start: 384, end: 411, title: "Mitchell 宣布领养" },
  { start: 412, end: 442, title: "Lily 登场与家庭合照" },
  { start: 443, end: 461, title: "结尾：我们来自不同的世界" },
];

const DAILY_ALTERNATIVES = new Map(
  Object.entries({
    "just a sec": ["Hold on a second.", "One moment, please."],
    "get down here": ["Come downstairs!", "Come down, please."],
    "way too short": ["far too short", "much too short"],
    "got his head stuck": ["got his head wedged", "got his head caught"],
    "out of control": ["completely out of hand", "running wild"],
    "take it down a notch": ["Dial it back a bit.", "Take it easy."],
    "broke up": ["split up", "called it quits"],
    "better off": ["better off without him", "in a better place"],
    "by the way": ["incidentally", "speaking of which"],
    "take that kid out": ["sub him out", "pull him from the game"],
    "be a surrogate": ["carry the baby for them", "be a gestational carrier"],
    "give a speech": ["say a few words", "make a speech"],
    "turn it off": ["shut it off", "switch it off"],
    "might as well": ["we may as well", "it makes sense to"],
    "hang on a second": ["hold on a moment", "give me a second"],
    "follow through": ["see it through", "keep your word"],
    "works for me": ["that works for me", "I'm fine with that"],
    "for God's sake": ["for heaven's sake", "for goodness' sake"],
    "watch it": ["Watch your step.", "Mind your tone."],
    "screwing up": ["messing up", "making mistakes"],
    "happy for you": ["glad for you", "really pleased for you"],
    "fell out of the window": ["tumbled out the window", "went out the window"],
    "fall asleep": ["get to sleep", "drift off"],
    "get mad": ["get angry", "lose your temper"],
    "turns into": ["becomes", "develops into"],
    "scare him": ["put the fear in him", "give him a talking-to"],
    "keep it real": ["stay true to yourself", "keep it honest"],
    "in such a bad mood": ["in a really foul mood", "in a terrible mood"],
    "respect their privacy": ["give them some privacy", "give them space"],
    "well done": ["nice work", "good job"],
    "learned your lesson": ["learned your lesson", "learned the hard way"],
    "freaking out": ["losing it", "completely panicking"],
    "come say hello": ["come say hi", "come over and say hello"],
    "stop worrying": ["try not to worry", "put your mind at ease"],
    "took it outside": ["take it outside", "settle it outside"],
    "no need to prove it": ["you don't have to prove anything", "no need to show off"],
  }),
);

const TOKEN_REPAIRS = new Map(
  Object.entries({
    iwas: ["i", "was"],
    hewas: ["he", "was"],
    shewas: ["she", "was"],
    theywere: ["they", "were"],
    wewere: ["we", "were"],
    youwere: ["you", "were"],
    itwas: ["it", "was"],
    dont: ["don't"],
    didnt: ["didn't"],
    doesnt: ["doesn't"],
    isnt: ["isn't"],
    wasnt: ["wasn't"],
    werent: ["weren't"],
    cant: ["can't"],
    couldnt: ["couldn't"],
    wouldnt: ["wouldn't"],
    shouldnt: ["shouldn't"],
    thats: ["that's"],
    whats: ["what's"],
    youre: ["you're"],
    theyre: ["they're"],
    weve: ["we've"],
    ive: ["i've"],
    im: ["i'm"],
    stuk: ["stuck"],
    suprised: ["surprised"],
    importand: ["important"],
    everyting: ["everything"],
    somthing: ["something"],
  }),
);

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "him",
  "his",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => value.length > 0));
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMultiline(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function parseCardBack(value) {
  const lines = cleanMultiline(value).split("\n");
  const meanings = [];
  const phonetics = [];
  const translationLines = [];

  lines.forEach((line) => {
    const meaning = line.match(/^释义\s*[：:]\s*(.+)$/);
    if (meaning) {
      meanings.push(meaning[1].trim());
      return;
    }
    const phonetic = line.match(/^音标\s*[：:]\s*(.+)$/);
    if (phonetic) {
      phonetics.push(phonetic[1].trim());
      return;
    }
    translationLines.push(line);
  });

  return {
    translation: cleanText(translationLines.join(" ")),
    meaning: meanings.filter(Boolean).join("；"),
    phonetic: phonetics.filter(Boolean).join("；"),
  };
}

function parseAnkiCards(raw) {
  const rows = parseCsv(String(raw || "").replace(/^\uFEFF/, ""));
  const cards = [];

  rows.forEach((row) => {
    const front = cleanText(row[0]);
    const back = cleanMultiline(row[1]);
    if (
      !front ||
      !back ||
      front.startsWith("#") ||
      front.toLocaleLowerCase("en-US") === "front"
    ) {
      return;
    }

    const parsed = parseCardBack(back);
    cards.push({
      id: `card-${cards.length + 1}`,
      front,
      ...parsed,
    });
  });

  return cards;
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((value) => value.trim().replace(/\*\*(.*?)\*\*/g, "$1"));
}

function parseCuratedEntries(raw) {
  const lines = String(raw || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    if (!/^\|.*\|$/.test(line.trim())) {
      return false;
    }
    const columns = splitMarkdownRow(line);
    return columns.includes("#") && columns.includes("词/短语");
  });

  if (headerIndex < 0) {
    return [];
  }

  const headers = splitMarkdownRow(lines[headerIndex]);
  const columnIndex = (name) => headers.indexOf(name);
  const phraseIndex = columnIndex("词/短语");
  const meaningIndex = columnIndex("释义");
  const phoneticIndex = columnIndex("IPA");
  const sentenceIndex = columnIndex("英文原句");
  const translationIndex = columnIndex("译句");

  return lines
    .slice(headerIndex + 2)
    .filter((line) => /^\|/.test(line.trim()))
    .map((line, index) => {
      const row = splitMarkdownRow(line);
      const phrase = cleanText(row[phraseIndex]);
      const sentence = cleanText(row[sentenceIndex]);
      const translation = cleanText(row[translationIndex]);
      if (!phrase && !sentence) {
        return null;
      }
      return {
        id: `entry-${index + 1}`,
        phrase: phrase || sentence,
        meaning: cleanText(row[meaningIndex]),
        phonetic: cleanText(row[phoneticIndex]),
        sentence,
        translation,
      };
    })
    .filter(Boolean);
}

function expandToken(token) {
  return TOKEN_REPAIRS.get(token) || [token];
}

function tokenize(value) {
  const normalized = String(value || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[’‘`]/g, "'")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9' -]+/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(" ")
    .flatMap((token) => expandToken(token))
    .filter(Boolean);
}

function isContentToken(token) {
  return token.length >= 3 && !STOP_WORDS.has(token);
}

function buildFlatTokens(blocks) {
  return blocks.flatMap((block) =>
    tokenize(block.text).map((token) => ({
      token,
      blockIndex: block.i,
    })),
  );
}

function normalizedEditDistance(left, right) {
  if (left.length === 0) {
    return right.length;
  }
  if (right.length === 0) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitution,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function findBestRange(sourceTokens, flatTokens, tokenFrequency) {
  if (!sourceTokens.length || !flatTokens.length) {
    return null;
  }

  const anchorCandidates = sourceTokens
    .map((token, index) => ({
      token,
      index,
      frequency: tokenFrequency.get(token) || 0,
    }))
    .filter((entry) => isContentToken(entry.token) || sourceTokens.length === 1)
    .sort((left, right) => left.frequency - right.frequency);

  const anchors = anchorCandidates.slice(0, 4);
  const starts = new Set();
  anchors.forEach((anchor) => {
    flatTokens.forEach((entry, flatIndex) => {
      if (entry.token !== anchor.token) {
        return;
      }
      const estimated = flatIndex - anchor.index;
      for (let offset = -4; offset <= 4; offset += 1) {
        const candidate = estimated + offset;
        if (candidate >= 0 && candidate < flatTokens.length) {
          starts.add(candidate);
        }
      }
    });
  });

  if (!starts.size) {
    return null;
  }

  let best = null;
  const minLength = Math.max(1, sourceTokens.length - 10);
  const maxLength = sourceTokens.length + 14;

  starts.forEach((start) => {
    const lengthCeiling = Math.min(maxLength, flatTokens.length - start);
    for (let length = minLength; length <= lengthCeiling; length += 1) {
      const windowTokens = flatTokens
        .slice(start, start + length)
        .map((entry) => entry.token);
      const distance = normalizedEditDistance(sourceTokens, windowTokens);
      const score =
        1 - distance / Math.max(sourceTokens.length, windowTokens.length);
      if (!best || score > best.score) {
        best = {
          start,
          end: start + length - 1,
          score,
        };
      }
    }
  });

  if (!best || best.score < 0.56) {
    return null;
  }

  const startBlock = flatTokens[best.start].blockIndex;
  const endBlock = flatTokens[best.end].blockIndex;
  if (endBlock - startBlock > 28) {
    return null;
  }

  return {
    startBlock,
    endBlock,
    score: best.score,
    tokenCount: best.end - best.start + 1,
  };
}

function makeHumanCandidates(blocks, cards, entries) {
  const flatTokens = buildFlatTokens(blocks);
  const tokenFrequency = new Map();
  flatTokens.forEach((entry) => {
    tokenFrequency.set(entry.token, (tokenFrequency.get(entry.token) || 0) + 1);
  });

  const candidates = [];

  const addCandidate = (source, quality) => {
    const sourceTokens = tokenize(source.sentence || source.front);
    const range = findBestRange(sourceTokens, flatTokens, tokenFrequency);
    if (!range || !source.translation) {
      return;
    }

    candidates.push({
      ...range,
      quality,
      translation: cleanText(source.translation),
      translationSource: quality >= 4 ? "curated" : "card",
      keyPhrase: cleanText(source.phrase || ""),
      meaning: cleanText(source.meaning),
      phonetic: cleanText(source.phonetic),
      sourceId: source.id,
      sourceText: cleanText(source.sentence || source.front),
    });
  };

  entries.forEach((entry) => addCandidate(entry, 5));
  cards.forEach((card) => addCandidate(card, 3));

  candidates.sort(
    (left, right) =>
      left.endBlock - right.endBlock ||
      left.startBlock - right.startBlock ||
      right.score - left.score,
  );

  return candidates;
}

function selectNonOverlapping(candidates, blockCount) {
  const byEnd = Array.from({ length: blockCount + 2 }, () => []);
  candidates.forEach((candidate) => {
    if (
      candidate.startBlock >= 1 &&
      candidate.endBlock <= blockCount &&
      candidate.startBlock <= candidate.endBlock
    ) {
      byEnd[candidate.endBlock].push(candidate);
    }
  });

  const scores = new Array(blockCount + 1).fill(0);
  const choices = new Array(blockCount + 1).fill(null);
  const previous = new Array(blockCount + 1).fill(null);

  for (let block = 1; block <= blockCount; block += 1) {
    scores[block] = scores[block - 1];
    choices[block] = null;

    byEnd[block].forEach((candidate) => {
      const coverage = candidate.endBlock - candidate.startBlock + 1;
      const value =
        scores[candidate.startBlock - 1] +
        coverage * candidate.quality +
        candidate.score * 3;
      if (value > scores[block]) {
        scores[block] = value;
        choices[block] = candidate;
        previous[block] = candidate.startBlock - 1;
      }
    });
  }

  const selected = [];
  let cursor = blockCount;
  while (cursor > 0) {
    const choice = choices[cursor];
    if (!choice) {
      cursor -= 1;
      continue;
    }
    selected.push(choice);
    cursor = previous[cursor];
  }

  return selected.sort((left, right) => left.startBlock - right.startBlock);
}

function collectAlternatives(text) {
  const normalized = tokenize(text).join(" ");
  const matches = [];
  DAILY_ALTERNATIVES.forEach((alternatives, phrase) => {
    if (` ${normalized} `.includes(` ${tokenize(phrase).join(" ")} `)) {
      matches.push({ phrase, alternatives });
    }
  });
  return matches.slice(0, 3);
}

async function sleep(milliseconds) {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function requestGoogleTranslation(text) {
  if (!googleTranslationAvailable) {
    throw new Error("Google translation is temporarily unavailable");
  }

  const endpoint = new URL(GOOGLE_ENDPOINT);
  endpoint.searchParams.set("client", "gtx");
  endpoint.searchParams.set("sl", "en");
  endpoint.searchParams.set("tl", "zh-CN");
  endpoint.searchParams.set("dt", "t");
  endpoint.searchParams.set("q", text);

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json,text/plain,*/*",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Google translation failed: ${response.status}`);
  }

  const data = await response.json();
  return (Array.isArray(data?.[0]) ? data[0] : [])
    .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
    .join("")
    .trim();
}

async function requestMyMemoryTranslation(text) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const endpoint = new URL(MYMEMORY_ENDPOINT);
    endpoint.searchParams.set("q", text);
    endpoint.searchParams.set("langpair", "en|zh-CN");

    try {
      const response = await fetch(endpoint, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!response.ok) {
        throw new Error(`MyMemory translation failed: ${response.status}`);
      }

      const data = await response.json();
      const translation = cleanText(data?.responseData?.translatedText);
      if (
        !translation ||
        /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translation)
      ) {
        throw new Error("MyMemory returned an invalid translation");
      }
      return translation;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError || new Error("MyMemory translation failed");
}

async function translateOne(text) {
  try {
    const translation = await requestGoogleTranslation(text);
    if (translation) {
      return translation;
    }
  } catch {
    googleTranslationAvailable = false;
    // Fall through to the secondary free service.
  }
  return requestMyMemoryTranslation(text);
}

async function translateBatch(texts) {
  const joined = texts.join(MACHINE_MARKER);
  let translation = "";
  try {
    translation = await requestGoogleTranslation(joined);
  } catch {
    translation = "";
  }

  const segments = translation
    .split(/<<<\s*IBALL-MOVIE\s*>>>/i)
    .map(cleanText);
  if (segments.length === texts.length && segments.every(Boolean)) {
    return segments;
  }

  const results = [];
  for (const text of texts) {
    results.push(await translateOne(text));
    await sleep(220);
  }
  return results;
}

async function translateBatchConcurrent(texts) {
  const results = new Array(texts.length).fill("");

  for (
    let start = 0;
    start < texts.length;
    start += TRANSLATION_CONCURRENCY
  ) {
    const group = texts.slice(start, start + TRANSLATION_CONCURRENCY);
    const translations = await Promise.all(
      group.map(async (text) => {
        try {
          return await translateOne(text);
        } catch {
          return "";
        }
      }),
    );
    translations.forEach((translation, index) => {
      results[start + index] = translation;
    });
    await sleep(120);
  }

  return results;
}

async function loadMachineCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(machineCachePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function fillMachineTranslations(uncoveredBlocks, cache) {
  const pending = uncoveredBlocks.filter(
    (block) => !cleanText(cache[String(block.i)]),
  );

  if (shouldTranslate && pending.length) {
    console.log(`Machine translating ${pending.length} uncovered block(s)...`);
    for (
      let start = 0;
      start < pending.length;
      start += MAX_TRANSLATION_BATCH
    ) {
      const batch = pending.slice(start, start + MAX_TRANSLATION_BATCH);
      const translations = await translateBatchConcurrent(
        batch.map((block) => block.text),
      );
      batch.forEach((block, index) => {
        const translation = cleanText(translations[index]);
        if (translation) {
          cache[String(block.i)] = translation;
        }
      });

      await fs.writeFile(
        machineCachePath,
        `${JSON.stringify(cache, null, 2)}\n`,
        "utf8",
      );
      const completed = Math.min(start + batch.length, pending.length);
      console.log(`Translated ${completed}/${pending.length}`);
    }
  } else if (pending.length) {
    console.warn(
      `${pending.length} block(s) have no curated or machine translation. Re-run with --translate to fill them.`,
    );
  }

  return cache;
}

function collectGrammarNotes(rangeBlocks, grammarNotes) {
  return rangeBlocks
    .map((block) => cleanText(grammarNotes[String(block.i)]))
    .filter(Boolean);
}

function buildSegments(
  blocks,
  selected,
  machineCache,
  reviewedTranslations,
  grammarNotes,
  cueTranslations,
) {
  const segments = [];
  const covered = new Set();

  selected.forEach((candidate) => {
    const rangeBlocks = blocks.filter(
      (block) =>
        block.i >= candidate.startBlock && block.i <= candidate.endBlock,
    );
    rangeBlocks.forEach((block) => covered.add(block.i));
    segments.push({
      start: candidate.startBlock,
      end: candidate.endBlock,
      translation: candidate.translation,
      translationSource: candidate.translationSource,
      matchScore: Number(candidate.score.toFixed(3)),
      keyPhrase: candidate.keyPhrase,
      meaning: candidate.meaning,
      phonetic: candidate.phonetic,
      sourceId: candidate.sourceId,
      sourceText: candidate.sourceText,
      grammarNotes: collectGrammarNotes(rangeBlocks, grammarNotes),
      alternatives: collectAlternatives(
        rangeBlocks.map((block) => block.text).join(" "),
      ),
      blocks: rangeBlocks.map((block) => ({ ...block })),
    });
  });

  blocks.forEach((block) => {
    if (covered.has(block.i)) {
      return;
    }
    const reviewedTranslation = cleanText(
      reviewedTranslations[String(block.i)],
    );
    // The bilingual subtitle pass already carries a translation for every
    // cue; use it when the reviewed map has a gap so nothing renders blank.
    const cueTranslation = reviewedTranslation
      ? ""
      : cleanText(cueTranslations?.get(block.i));
    const translation =
      reviewedTranslation ||
      cueTranslation ||
      cleanText(machineCache[String(block.i)]);
    segments.push({
      start: block.i,
      end: block.i,
      translation,
      translationSource: reviewedTranslation
        ? "reviewed"
        : cueTranslation
          ? "reviewed"
          : translation
            ? "machine"
            : "missing",
      matchScore: null,
      keyPhrase: "",
      meaning: "",
      phonetic: "",
      sourceId: "",
      sourceText: block.text,
      grammarNotes: collectGrammarNotes([block], grammarNotes),
      alternatives: collectAlternatives(block.text),
      blocks: [{ ...block }],
    });
  });

  return segments.sort((left, right) => left.start - right.start);
}

function truncateTitle(text, limit) {
  const cleaned = cleanText(text)
    .replace(/\s+/g, " ")
    .replace(/^[-–—\s]+/, "")
    .split(/\s+[-–—]\s+/)[0]
    .trim();
  if (!cleaned) {
    return "";
  }
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

function autoSceneRanges(blocks) {
  const usable = blocks.filter(
    (block) => Number.isFinite(block.start) && Number.isFinite(block.end),
  );
  if (usable.length < 4) {
    return [];
  }

  const duration = usable[usable.length - 1].end - usable[0].start;
  const targetScenes = Math.min(
    18,
    Math.max(10, Math.round((Number.isFinite(duration) ? duration : 1200) / 110)),
  );
  // Keep every scene long enough to read as a scene: a handful of unusually
  // long silences would otherwise produce one-line fragments.
  const minBlocks = Math.max(6, Math.floor(usable.length / (targetScenes * 2)));

  const gaps = [];
  for (let index = 1; index < usable.length; index += 1) {
    const gap = usable[index].start - usable[index - 1].end;
    if (gap > 0) {
      gaps.push({ gap, index });
    }
  }
  gaps.sort((left, right) => right.gap - left.gap);

  let ranges = [{ start: 0, end: usable.length - 1 }];
  gaps.forEach((gap) => {
    if (ranges.length >= targetScenes) {
      return;
    }
    const host = ranges.find(
      (range) => gap.index > range.start && gap.index <= range.end,
    );
    if (!host) {
      return;
    }
    const leftSize = gap.index - host.start;
    const rightSize = host.end - gap.index + 1;
    if (leftSize < minBlocks || rightSize < minBlocks) {
      return;
    }
    const replacement = [
      { start: host.start, end: gap.index - 1 },
      { start: gap.index, end: host.end },
    ];
    ranges = ranges
      .flatMap((range) => (range === host ? replacement : [range]))
      .sort((left, right) => left.start - right.start);
  });

  // Absorb any still-short tail into its neighbour so no scene is a stub.
  for (let pass = 0; pass < 4; pass += 1) {
    const small = ranges.findIndex(
      (range) => range.end - range.start + 1 < minBlocks,
    );
    if (small === -1 || ranges.length < 3) {
      break;
    }
    const target =
      small === 0
        ? 1
        : small === ranges.length - 1
          ? small - 1
          : ranges[small - 1].end - ranges[small - 1].start <
              ranges[small + 1].end - ranges[small + 1].start
            ? small - 1
            : small + 1;
    const merged = {
      start: Math.min(ranges[small].start, ranges[target].start),
      end: Math.max(ranges[small].end, ranges[target].end),
    };
    ranges = ranges
      .filter((_, index) => index !== small && index !== target)
      .concat(merged)
      .sort((left, right) => left.start - right.start);
  }

  return ranges.map((range) => ({
    start: usable[range.start].i,
    end: usable[range.end].i,
  }));
}

function titleFromBlocks(range, lineById) {
  const first = lineById.get(range.start);
  const zh = truncateTitle(first?.zh, 16);
  if (zh) {
    return zh;
  }
  const en = truncateTitle(first?.text, 34);
  return en || `Scene ${range.start}`;
}

async function resolveSceneRanges(blocks, cues) {
  if (episode === "S01E01") {
    return S01E01_SCENE_RANGES;
  }

  const raw = await readOptional(scenesConfigPath);
  if (raw.trim()) {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.scenes;
    if (Array.isArray(list) && list.length) {
      return list
        .filter((scene) => Number.isFinite(scene?.start) && Number.isFinite(scene?.end))
        .map((scene) => ({
          start: scene.start,
          end: scene.end,
          title: cleanText(scene.title) || `Scene ${scene.start}`,
        }));
    }
  }

  const timeline = cues.length
    ? cues.map((cue) => ({
        i: cue.index,
        start: cue.sourceStart,
        end: cue.sourceEnd,
      }))
    : blocks;
  const lineById = cues.length
    ? new Map(cues.map((cue) => [cue.index, { text: cue.en, zh: cue.zh }]))
    : new Map(blocks.map((block) => [block.i, block]));

  return autoSceneRanges(timeline).map((range) => ({
    ...range,
    title: titleFromBlocks(range, lineById),
  }));
}

function buildScenes(segments, sceneRanges) {
  const scenes = sceneRanges.map((scene, index) => ({
    id: `scene-${index + 1}`,
    start: scene.start,
    end: scene.end,
    title: scene.title,
    segments: segments.filter(
      (segment) =>
        segment.start >= scene.start && segment.start <= scene.end,
    ),
  })).filter((scene) => scene.segments.length > 0);

  // A curated range list can be shorter than the transcript (the subtitle
  // pass finds lines the older edit did not). Anything left over is attached
  // to the closest preceding scene so no dialogue is dropped from the page.
  const placed = new Set(
    scenes.flatMap((scene) => scene.segments.map((segment) => segment.start)),
  );
  const orphans = segments.filter((segment) => !placed.has(segment.start));
  orphans.forEach((segment) => {
    const host =
      scenes.filter((scene) => scene.end <= segment.start).pop() || scenes[0];
    if (host) {
      host.end = Math.max(host.end, segment.end);
      host.segments.push(segment);
    }
  });
  scenes.forEach((scene) => {
    scene.segments.sort((left, right) => left.start - right.start);
  });
  return scenes;
}

async function readOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseJsonObject(raw, filePath) {
  if (!raw.trim()) {
    return {};
  }
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  } catch {
    throw new Error(`Invalid JSON object in ${filePath}`);
  }
}

async function main() {
  const transcript = JSON.parse(await fs.readFile(sourceLinesPath, "utf8"));
  const blocks = Array.isArray(transcript.blocks) ? transcript.blocks : [];
  if (!blocks.length) {
    throw new Error(`No dialogue blocks found in ${sourceLinesPath}`);
  }

  const [cardsRaw, markdownRaw, reviewedRaw, grammarRaw] = await Promise.all([
    readOptional(sourceCardsPath),
    readOptional(sourceMarkdownPath),
    readOptional(reviewedTranslationsPath),
    readOptional(grammarNotesPath),
  ]);
  const cuesRaw = await readOptional(cuesPath);
  const cues = cuesRaw ? (JSON.parse(cuesRaw).clips ?? []) : [];
  const cards = cardsRaw ? parseAnkiCards(cardsRaw) : [];
  const entries = markdownRaw ? parseCuratedEntries(markdownRaw) : [];
  const reviewedTranslations = parseJsonObject(
    reviewedRaw,
    reviewedTranslationsPath,
  );
  const grammarNotes = parseJsonObject(grammarRaw, grammarNotesPath);
  const humanCandidates = makeHumanCandidates(blocks, cards, entries);
  const selected = selectNonOverlapping(humanCandidates, blocks.length);
  const covered = new Set();
  selected.forEach((candidate) => {
    for (
      let block = candidate.startBlock;
      block <= candidate.endBlock;
      block += 1
    ) {
      covered.add(block);
    }
  });

  const uncoveredBlocks = blocks.filter((block) => !covered.has(block.i));
  const machineCache = await loadMachineCache();
  const cueTranslations = new Map(
    cues
      .filter((cue) => cleanText(cue.zh))
      .map((cue) => [cue.index, cue.zh]),
  );
  const translationFallbackBlocks = uncoveredBlocks.filter(
    (block) =>
      !cleanText(reviewedTranslations[String(block.i)]) &&
      !cueTranslations.has(block.i),
  );
  await fillMachineTranslations(translationFallbackBlocks, machineCache);
  const segments = buildSegments(
    blocks,
    selected,
    machineCache,
    reviewedTranslations,
    grammarNotes,
    cueTranslations,
  );
  const sceneRanges = await resolveSceneRanges(blocks, cues);
  const scenes = buildScenes(segments, sceneRanges);

  const translatedCount = segments.filter(
    (segment) => segment.translationSource !== "missing",
  ).length;
  const curatedCount = segments.filter(
    (segment) => segment.translationSource === "curated",
  ).length;
  const cardCount = segments.filter(
    (segment) => segment.translationSource === "card",
  ).length;
  const reviewedCount = segments.filter(
    (segment) => segment.translationSource === "reviewed",
  ).length;
  const machineCount = segments.filter(
    (segment) => segment.translationSource === "machine",
  ).length;
  const missingCount = segments.length - translatedCount;

  const vocabulary = new Set();
  blocks.forEach((block) => {
    const matches = String(block?.text || "").match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g);
    (matches || []).forEach((word) => vocabulary.add(word.toLowerCase()));
  });

  const payload = {
    episode,
    show: "摩登家庭",
    title: `Modern Family ${episode}`,
    generatedBy: "scripts/build-movie-library.mjs",
    generatedAt: new Date().toISOString().slice(0, 10),
    source: transcript.source || `${episode} 台词原文.txt`,
    blockCount: blocks.length,
    wordCount: Number(transcript.wordCount) || 0,
    vocabCount: vocabulary.size,
    sceneCount: scenes.length,
    segmentCount: segments.length,
    translationStats: {
      curated: curatedCount,
      card: cardCount,
      reviewed: reviewedCount,
      machine: machineCount,
      missing: missingCount,
    },
    entries,
    cards,
    scenes,
  };

  await fs.mkdir(outputDirectory, { recursive: true });
  const output = `// Generated by scripts/build-movie-library.mjs.\n(window.IBALL_MOVIE_LIBRARY = window.IBALL_MOVIE_LIBRARY || {})[${JSON.stringify(
    episode,
  )}] = ${JSON.stringify(payload, null, 2)};\n`;
  await fs.writeFile(outputPath, output, "utf8");

  const existingManifest = await readOptional(manifestPath);
  const manifestMatch = existingManifest.match(
    /window\.IBALL_MOVIE_EPISODES\s*=\s*(\[[\s\S]*?\]);/,
  );
  let manifest = [];
  if (manifestMatch) {
    try {
      manifest = JSON.parse(manifestMatch[1]);
    } catch {
      manifest = [];
    }
  }

  const entry = {
    id: episode,
    label: episode,
    title: payload.title,
    file: `./movie-data/${episode}.js`,
    blockCount: payload.blockCount,
    wordCount: payload.wordCount,
    vocabCount: payload.vocabCount,
    sceneCount: payload.sceneCount,
    translationStats: payload.translationStats,
  };
  manifest = manifest
    .filter((item) => item.id !== episode)
    .concat(entry)
    .sort((left, right) => right.id.localeCompare(left.id));
  const manifestOutput = `// Generated by scripts/build-movie-library.mjs\nwindow.IBALL_MOVIE_EPISODES = ${JSON.stringify(
    manifest,
    null,
    2,
  )};\n`;
  await fs.writeFile(manifestPath, manifestOutput, "utf8");

  console.log(
    `${episode}: ${blocks.length} blocks, ${segments.length} segments, ${scenes.length} scenes`,
  );
  console.log(
    `Translations: curated ${curatedCount}, card ${cardCount}, reviewed ${reviewedCount}, machine ${machineCount}, missing ${missingCount}`,
  );
  console.log(
    `Wrote ${path.relative(root, outputPath)} and ${path.relative(root, manifestPath)}`,
  );
}

await main();
