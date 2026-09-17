// Builds the 四级阅读精读 library from the public CET-4 reading pages.
// Sources: /cet4/sections/{paperId}/{part3-section-a|b|c}/
// Usage: node scripts/build-reading-library.mjs [paperId ...]
//        node scripts/build-reading-library.mjs --probe 2022-06-1

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "reading-data");
const manifestPath = path.join(root, "reading-papers.js");
const cacheDir = path.join(root, ".cache", "reading-source");
const ORIGIN = "https://english-exam.lazynote.cn";
const USER_AGENT = "Mozilla/5.0 (compatible; iball-cabin reading builder)";
const builtPapers = new Map();
const MIN_YEAR = 2022;
const MAX_YEAR = 2026;

const INDEX_PAGES = {
  careful: "/cet4/sections/reading/",
  matching: "/cet4/sections/long-reading/",
  cloze: "/cet4/sections/banked-cloze/",
};

// Fallback map used when the index pages cannot be fetched.
const FALLBACK_PAPERS = {
  "2022-06-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2022-06-2": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2022-09-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2022-12-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2022-12-2": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2022-12-3": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2023-03-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2023-06-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2023-06-2": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2023-06-3": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2023-12-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2023-12-2": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2023-12-3": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2024-06-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2024-06-2": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2024-06-3": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2024-12-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2024-12-2": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2024-12-3": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2025-06-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2025-06-2": { careful: ["part3-section-c", "part3-section-c-2"] },
  "2025-06-3": { careful: ["part3-section-c", "part3-section-c-2"] },
  "2025-12-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2025-12-2": { careful: ["part3-section-c", "part3-section-c-2"] },
  "2025-12-3": { careful: ["part3-section-c", "part3-section-c-2"] },
  "2026-06-1": { careful: ["part3-section-c-1", "part3-section-c-2"] },
  "2026-06-2": { careful: ["part3-section-c", "part3-section-c-2"] },
  "2026-06-3": { careful: ["part3-section-c-1", "part3-section-c-2"] },
};

const PIECE_TYPE = {
  careful: { type: "仔细阅读", short: "仔细", slugLabel: "仔细阅读" },
  matching: { type: "段落匹配", short: "匹配", slugLabel: "段落匹配" },
  cloze: { type: "选词填空", short: "完形", slugLabel: "选词填空" },
};

// 阅读题最爱设题的位置。命中越多，这段越值得逐句精读。
const CUE_RULES = [
  {
    label: "转折对比",
    pattern:
      /\b(?:but|however|yet|nevertheless|nonetheless|although|though|instead|on the contrary|by contrast|rather than|whereas)\b/i,
    tip: "转折词之后才是作者真正的立场：but / however / instead 常把前面的事实推翻，正确项多出自这一句。",
  },
  {
    label: "因果结果",
    pattern:
      /\b(?:because|since|therefore|thus|hence|as a result|result in|lead to|contribute to|due to|owing to|so that)\b/i,
    tip: "因果处必设题：because 后面是原因，therefore / result in 后面是结果，选项常把因果对调来干扰。",
  },
  {
    label: "研究观点",
    pattern:
      /\b(?:researchers?|scientists?|studies|study|survey|report|according to|found that|suggests? that|argues? that|points? out|believes? that)\b/i,
    tip: "研究结论与专家观点是细节题、态度题的高发区：主句动词（found / suggests / argues）后面的内容才是答案。",
  },
  {
    label: "举例说明",
    pattern:
      /\b(?:for example|for instance|such as|including|take .{1,24} as an example|like)\b/i,
    tip: "例子本身通常不选，考的是例子要证明的观点，答案往往在例子的前一句或后一句。",
  },
  {
    label: "定义解释",
    pattern:
      /\b(?:means?|refers? to|is defined as|is known as|in other words|that is|namely)\b/i,
    tip: "定义句常直接对应词汇题或细节题：means / refers to 后面的解释就是答案句。",
  },
  {
    label: "数据事实",
    pattern:
      /\b(?:\d+(?:\.\d+)?\s?(?:percent|%|million|billion|thousand)|one in \w+|三分之|half of)\b/i,
    tip: "百分比、数量和年份是细节题最爱：原文数字常被换成同义表达（a quarter = 25%），注意单位与对象。",
  },
  {
    label: "强调突出",
    pattern:
      /\b(?:above all|most importantly|especially|particularly|in fact|indeed|actually|the key|mainly)\b/i,
    tip: "强调词后是本段核心，主旨题与推断题的答案常在这里，注意不要被前面的铺垫带偏。",
  },
  {
    label: "条件假设",
    pattern: /\b(?:if|unless|otherwise|as long as|provided that|only when)\b/i,
    tip: "条件句要分清是否成立：选项常把假设说成事实，或把条件方向反过来说。",
  },
  {
    label: "结论总结",
    pattern:
      /\b(?:in conclusion|to conclude|overall|ultimately|in short|in brief|to sum up|all in all|as a whole)\b/i,
    tip: "结尾总结句常对应主旨题与最后一道题，读文章时务必把最后两句读完。",
  },
  {
    label: "列举顺序",
    pattern:
      /\b(?:first(?:ly)?|second(?:ly)?|third(?:ly)?|next|then|finally|lastly|another|also|besides|moreover)\b/i,
    tip: "序数词与补充连接词常对应段落匹配题的信息点，题干往往就是其中一条的改写。",
  },
];

const PIECE_TIPS = {
  仔细阅读: [
    "先读题干圈出定位词，再回原文找同义替换；正确项几乎不会照抄原文原词。",
    "转折、因果、研究结论三处是答案高发区，读到时立刻做记号。",
    "每题只有一个最佳答案：把四个选项都回原文核对一遍，排除偷换对象、绝对化和范围扩大的干扰项。",
  ],
  段落匹配: [
    "先用段落主旨图建立 15 段的信息地图，再拿题干里的独特名词、数字、专有词回扫。",
    "题干与原文是同义改写关系，看到整句照抄反而要提高警惕。",
    "一段可以被选多次，不要因为某段已用过就排除它。",
  ],
  选词填空: [
    "先给 15 个选项标词性（名词/动词/形容词/副词），再按空格的语法槽筛选。",
    "空格前后各看三四个词：情态动词后接原形、冠词与名词之间多填形容词。",
    "填完后通读全文检查语义与搭配，词性对但搭配错的选项同样要排除。",
  ],
};

const STOP_WORDS = new Set([
  "about", "above", "across", "after", "again", "against", "almost",
  "along", "already", "although", "always", "among", "another", "anything",
  "around", "because", "become", "became", "before", "behind", "being",
  "below", "better", "between", "beyond", "cannot", "certain", "could",
  "didn't", "doesn't", "doing", "don't", "during", "either", "enough",
  "even", "every", "everything", "first", "found", "getting", "going",
  "great", "having", "herself", "himself", "however", "instead", "isn't",
  "itself", "might", "maybe", "moreover", "myself", "never", "nothing",
  "often", "other", "others", "perhaps", "please", "pretty", "probably",
  "quite", "rather", "really", "right", "should", "since", "somebody",
  "something", "sometimes", "still", "such", "than", "that's", "their",
  "them", "themselves", "there", "these", "they", "thing", "think",
  "this", "those", "though", "through", "today", "together", "tonight",
  "toward", "under", "until", "upon", "very", "want", "wasn't", "well",
  "were", "what", "when", "where", "whether", "which", "while", "who's",
  "whose", "will", "with", "within", "without", "would", "you're",
  "you've", "your", "yours",
]);

/* ------------------------------------------------------------- helpers */

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function cleanHtml(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n"),
  )
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0|\u2002|\u2003|\u2009|\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripScripts(source) {
  return String(source || "").replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

function parsePaperId(paperId) {
  const match = /^(\d{4})-(\d{2})-(\d+)$/.exec(paperId);
  if (!match) {
    throw new Error(`Unsupported paper id: ${paperId}`);
  }
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    set: Number.parseInt(match[3], 10),
  };
}

function ensureSentence(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

function cachePathFor(url) {
  const digest = createHash("sha1").update(url).digest("hex").slice(0, 20);
  return path.join(cacheDir, `${digest}.html`);
}

async function fetchPage(url, { useCache = true } = {}) {
  const file = cachePathFor(url);
  if (useCache) {
    const cached = await fs.readFile(file, "utf8").catch(() => "");
    if (cached) {
      return cached;
    }
  }

  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  const text = await response.text();
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, text, "utf8");
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractKeyWords(english) {
  const seen = new Set();
  const candidates = [];
  const words = String(english || "").match(/[A-Za-z][A-Za-z'-]{5,}/g) || [];
  words.forEach((raw) => {
    const word = raw.toLowerCase().replace(/^'+|'+$/g, "");
    if (word.length < 7 || STOP_WORDS.has(word) || seen.has(word)) {
      return;
    }
    seen.add(word);
    candidates.push(word);
  });
  return candidates
    .sort((left, right) => right.length - left.length)
    .slice(0, 4)
    .sort(
      (left, right) =>
        english.toLowerCase().indexOf(left) - english.toLowerCase().indexOf(right),
    );
}

function analyzeCues(english) {
  return CUE_RULES.filter((rule) => rule.pattern.test(String(english || "")))
    .slice(0, 3)
    .map((rule) => ({ label: rule.label, tip: rule.tip }));
}

function buildTitle(chinese, fallback) {
  const text = String(chinese || "")
    .replace(/^[“"'「『]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return fallback;
  }
  const stopped = /^(.{4,20}?)[，。；！？,;.!?]/.exec(text);
  if (stopped) {
    return stopped[1];
  }
  return text.length > 16 ? `${text.slice(0, 16)}…` : text;
}

/* --------------------------------------------------------- HTML parsing */

// Splits a document into blocks that start at every marker match.
function splitBlocks(source, marker) {
  const pattern = new RegExp(marker.source, marker.flags.includes("g")
    ? marker.flags
    : `${marker.flags}g`);
  const starts = [];
  let match = pattern.exec(source);
  while (match) {
    starts.push({ index: match.index, match });
    if (pattern.lastIndex === match.index) {
      pattern.lastIndex += 1;
    }
    match = pattern.exec(source);
  }

  return starts.map((start, index) => {
    const next = starts[index + 1];
    let end = next ? next.index : source.length;
    if (!next) {
      const scriptIndex = source.indexOf("<script", start.index);
      if (scriptIndex > start.index) {
        end = scriptIndex;
      }
    }
    return {
      index: start.index,
      captures: start.match.slice(1),
      html: source.slice(start.index, end),
    };
  });
}

function pickText(html, pattern) {
  const match = pattern.exec(html);
  return match ? cleanHtml(match[1]) : "";
}

function extractParagraphs(source) {
  const paragraphs = [];
  const pattern =
    /<div[^>]*\bid="p-(\d+)"[^>]*>([\s\S]*?)<p class="lt-zh"[^>]*>([\s\S]*?)<\/p>/g;

  for (const match of stripScripts(source).matchAll(pattern)) {
    const number = Number.parseInt(match[1], 10);
    const inner = match[2];
    const letter =
      /data-pdh-letter="([A-O])"/.exec(inner)?.[1] || "";
    const english = cleanHtml(
      inner
        .replace(
          /<span class="exam-pno[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
          "",
        )
        .replace(/<span class="select-none"[^>]*>[\s\S]*?<\/span>/gi, ""),
    );
    const chinese = cleanHtml(match[3]);
    if (!english) {
      continue;
    }
    paragraphs.push({
      number,
      letter,
      english,
      chinese,
      keyWords: extractKeyWords(english),
      cues: analyzeCues(english),
      phrases: [],
    });
  }

  return paragraphs;
}

function parseQuestionUnit(html) {
  const stem =
    pickText(
      html,
      /<(?:span|div)[^>]*data-pdh-stem[^>]*>([\s\S]*?)<\/(?:span|div)>/,
    ) || "";
  const stemTranslation = pickText(
    html,
    /<p class="lqp-stem"[^>]*>([\s\S]*?)<\/p>/,
  );
  const answer = pickText(
    html,
    /<strong class="rp-ans"[^>]*>([\s\S]*?)<\/strong>/,
  );
  const typeNote = pickText(
    html,
    /<span class="rp-qtype"[^>]*>([\s\S]*?)<\/span>/,
  );

  const choices = [];
  const choicePattern =
    /<span data-pdh-letter="([A-D])"[^>]*>([\s\S]*?)<\/span>/g;
  for (const match of html.matchAll(choicePattern)) {
    choices.push({ letter: match[1], text: cleanHtml(match[2]) });
  }

  const translationList =
    /<ul class="lqp-trans-choices"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] || "";
  const translations = new Map();
  if (translationList) {
    const pattern =
      /<span class="lqp-trans-letter"[^>]*>([A-D])\)<\/span>([\s\S]*?)(?=<\/li>)/g;
    for (const match of translationList.matchAll(pattern)) {
      translations.set(match[1], cleanHtml(match[2]));
    }
  }

  const notes = [];
  const locateMatch = /<a class="[^"]*rp-locate-p[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(
    html,
  );
  const locate = locateMatch
    ? {
        label: cleanHtml(locateMatch[1]),
        english: pickText(html, /<p class="rp-locate-en"[^>]*>([\s\S]*?)<\/p>/),
        chinese: pickText(html, /<p class="rp-locate-zh"[^>]*>([\s\S]*?)<\/p>/),
      }
    : null;

  const pairs = [];
  const pairsList = /<ul class="rp-pairs[^"]*"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] || "";
  for (const item of splitBlocks(pairsList, /<li class="rp-pair"/)) {
    const origin = pickText(
      item.html,
      /<span class="rp-pair-orig"[^>]*>([\s\S]*?)<\/span>/,
    );
    const option = pickText(
      item.html,
      /<span class="rp-pair-opt"[^>]*>([\s\S]*?)<\/span>/,
    );
    const why = pickText(
      item.html,
      /<p class="rp-pair-why"[^>]*>([\s\S]*?)<\/p>/,
    );
    if (origin || option || why) {
      pairs.push({ origin, option, why });
    }
  }

  const verdicts = [];
  const verdictsList =
    /<ul class="rp-verdicts"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] || "";
  for (const item of splitBlocks(verdictsList, /<li class="(?:is-ok|is-bad) rp-verdict"/)) {
    const isOk = /class="is-ok rp-verdict"/.test(item.html);
    const letter = pickText(
      item.html,
      /<span class="rp-verdict-letter"[^>]*>([\s\S]*?)<\/span>/,
    ).replace(/[)\s]+$/, "");
    const flag = pickText(
      item.html,
      /<span class="rp-flag[^"]*"[^>]*>([\s\S]*?)<\/span>/,
    );
    const note = pickText(
      item.html,
      /<p class="rp-verdict-note"[^>]*>([\s\S]*?)<\/p>/,
    );
    const itemPairs = [];
    const pairList =
      /<ul class="rp-pairs[^"]*"[^>]*>([\s\S]*?)<\/ul>/.exec(item.html)?.[1] || "";
    for (const pair of splitBlocks(pairList, /<li class="rp-pair"/)) {
      const origin = pickText(
        pair.html,
        /<span class="rp-pair-orig"[^>]*>([\s\S]*?)<\/span>/,
      );
      const option = pickText(
        pair.html,
        /<span class="rp-pair-opt"[^>]*>([\s\S]*?)<\/span>/,
      );
      if (origin || option) {
        itemPairs.push({ origin, option });
      }
    }
    if (letter || note || flag) {
      verdicts.push({ letter, ok: isOk, flag, note, pairs: itemPairs });
    }
  }

  const distractors = [];
  const discList = /<ul class="rp-disc"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] || "";
  for (const item of splitBlocks(discList, /<li class="rp-disc-item"/)) {
    const letter = pickText(
      item.html,
      /<span class="rp-disc-letter"[^>]*>([\s\S]*?)<\/span>/,
    );
    const reason = pickText(
      item.html,
      /<p class="rp-disc-reason"[^>]*>([\s\S]*?)<\/p>/,
    );
    const sourceText = pickText(
      item.html,
      /<p class="rp-disc-source"[^>]*>([\s\S]*?)<\/p>/,
    );
    if (letter || reason) {
      distractors.push({ letter, reason, source: sourceText });
    }
  }

  for (const row of splitBlocks(html, /<div class="rp-row"/)) {
    const label = pickText(
      row.html,
      /<span class="rp-tag"[^>]*>【([^】]+)】<\/span>/,
    );
    if (!label) {
      continue;
    }
    if (/^(答案|定位|选项|改写|辨邻|竞争词)$/.test(label)) {
      continue;
    }
    const core = pickText(
      row.html,
      /<p class="rp-reason-core"[^>]*>([\s\S]*?)<\/p>/,
    );
    const detail = pickText(
      row.html,
      /<p class="rp-reason-detail"[^>]*>([\s\S]*?)<\/p>/,
    );
    if (core || detail) {
      notes.push({ label, text: detail || core, core });
      continue;
    }
    const text = pickText(row.html, /<p class="rp-text"[^>]*>([\s\S]*?)<\/p>/);
    if (text) {
      notes.push({ label, text });
    }
  }

  const rivals = [];
  const rivalsList = /<ul class="rp-rivals"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] || "";
  for (const item of splitBlocks(rivalsList, /<li class="rp-rival"/)) {
    const letter = pickText(
      item.html,
      /<span class="rp-rival-letter"[^>]*>([\s\S]*?)<\/span>/,
    ).replace(/[)\s]+$/, "");
    const word = pickText(
      item.html,
      /<span class="rp-rival-word"[^>]*>([\s\S]*?)<\/span>/,
    );
    const why = pickText(
      item.html,
      /<span class="rp-rival-why"[^>]*>([\s\S]*?)<\/span>/,
    );
    const detail = pickText(
      item.html,
      /<p class="rp-rival-detail"[^>]*>([\s\S]*?)<\/p>/,
    );
    if (letter || word || detail) {
      rivals.push({ letter, word, why, detail });
    }
  }

  return {
    stem,
    stemTranslation,
    answer,
    typeNote,
    choices: choices.map((choice) => ({
      ...choice,
      translation: translations.get(choice.letter) || "",
    })),
    locate,
    pairs,
    verdicts,
    distractors,
    notes,
    rivals,
  };
}

function parseNumberedUnits(source, marker) {
  return splitBlocks(source, marker).map((block) => ({
    number: Number.parseInt(block.captures[0], 10),
    parsed: parseQuestionUnit(block.html),
  }));
}

/* ------------------------------------------------------ section parsers */

function parseCarefulPage(source, { paperId, slug, index }) {
  const paragraphs = extractParagraphs(source);
  const rangeMatch = /Questions?\s+(\d+)\s+to\s+(\d+)\s+are based on the following passage/i.exec(
    stripScripts(source),
  );
  const units = parseNumberedUnits(
    stripScripts(source),
    /<div id="q-(\d+)" class="lqp-unit"/,
  );
  const questions = units
    .map((unit) => ({
      number: unit.number,
      kind: "choice",
      typeNote: unit.parsed.typeNote.replace(/[（）()]/g, "").trim(),
      stem: unit.parsed.stem,
      stemTranslation: unit.parsed.stemTranslation,
      choices: unit.parsed.choices,
      answer: unit.parsed.answer,
      locate: unit.parsed.locate,
      pairs: unit.parsed.pairs,
      verdicts: unit.parsed.verdicts,
      notes: unit.parsed.notes,
    }))
    .filter((question) => question.stem);

  if (!paragraphs.length || !questions.length) {
    throw new Error(
      `${paperId}/${slug}: careful extraction produced ${paragraphs.length} paragraphs and ${questions.length} questions`,
    );
  }

  const first = rangeMatch ? Number.parseInt(rangeMatch[1], 10) : questions[0].number;
  const last = rangeMatch
    ? Number.parseInt(rangeMatch[2], 10)
    : questions[questions.length - 1].number;

  return {
    kind: "careful",
    index,
    paragraphs,
    questions,
    questionRange: `第 ${first}–${last} 题`,
    prompt: "Questions are based on the following passage. 每题 1 个最佳选项。",
    title: buildTitle(paragraphs[0].chinese, `仔细阅读 第 ${index} 篇`),
  };
}

function parseMatchingPage(source, { paperId, slug }) {
  const clean = stripScripts(source);
  const paragraphs = extractParagraphs(source);
  const units = parseNumberedUnits(clean, /<div id="q-(\d+)" class="lqp-unit"/);
  const questions = units
    .map((unit) => ({
      number: unit.number,
      kind: "match",
      typeNote: unit.parsed.typeNote,
      stem: unit.parsed.stem,
      stemTranslation: unit.parsed.stemTranslation,
      answer: unit.parsed.answer,
      locate: unit.parsed.locate,
      pairs: unit.parsed.pairs,
      distractors: unit.parsed.distractors,
      notes: unit.parsed.notes,
    }))
    .filter((question) => question.stem);

  const paragraphMap = [];
  for (const item of splitBlocks(clean, /<li class="pmap__item"/)) {
    const letter = pickText(
      item.html,
      /<a class="pmap__letter[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    );
    const gist = pickText(item.html, /<p class="pmap__gist"[^>]*>([\s\S]*?)<\/p>/);
    const fingerprint = pickText(
      item.html,
      /<p class="pmap__fp"[^>]*>([\s\S]*?)<\/p>/,
    ).replace(/^信息指纹\s*/, "");
    if (letter && gist) {
      paragraphMap.push({ letter, gist, fingerprint });
    }
  }

  if (paragraphs.length < 5 || questions.length < 5) {
    throw new Error(
      `${paperId}/${slug}: matching extraction produced ${paragraphs.length} paragraphs and ${questions.length} statements`,
    );
  }

  const first = questions[0].number;
  const last = questions[questions.length - 1].number;

  return {
    kind: "matching",
    index: 1,
    paragraphs,
    paragraphMap,
    questions,
    questionRange: `第 ${first}–${last} 题`,
    prompt:
      "从 A–O 段落中为每句找出信息来源，一段可以重复选择。",
    title: buildTitle(paragraphs[0].chinese, "段落匹配"),
  };
}

function maskClozeTranslation(chinese, answers, cursor) {
  let text = String(chinese || "");
  let position = cursor.value;
  for (const answer of answers) {
    const word = String(answer || "").trim();
    if (!word) {
      continue;
    }
    const pattern = new RegExp(
      `(^|[^A-Za-z\\u4e00-\\u9fff])(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "i",
    );
    const slice = text.slice(position);
    const match = pattern.exec(slice);
    if (!match) {
      continue;
    }
    const start = position + match.index + match[1].length;
    text = `${text.slice(0, start)}＿＿${text.slice(start + word.length)}`;
    position = start + 2;
  }
  cursor.value = position;
  return text;
}

function parseClozePage(source, { paperId, slug }) {
  const clean = stripScripts(source);
  const paragraphs = extractParagraphs(source);
  const units = parseNumberedUnits(clean, /<div id="q-(\d+)" class="rp-unit"/);

  const blanks = units.map((unit) => {
    const answer = unit.parsed.answer;
    const answerMatch = /([A-Z])\)\s*(.+)/.exec(answer);
    const answerWord = answerMatch?.[2]?.trim() || answer;
    const reason = unit.parsed.notes.find((note) => note.label === "依据");
    const posSlot = unit.parsed.notes.find((note) => note.label === "词性槽");
    return {
      number: unit.number,
      answer,
      answerLetter: answerMatch?.[1] || "",
      answerWord,
      pos: unit.parsed.typeNote,
      posSlot: posSlot ? posSlot.text : "",
      reason: reason ? reason.text : "",
      rivals: unit.parsed.rivals,
    };
  });

  const wordBank = [];
  const bankPattern =
    /<span class="select-none"[^>]*>([A-O])\)<\/span>\s*<span>([^<]*)<\/span>/g;
  for (const match of clean.matchAll(bankPattern)) {
    const word = cleanHtml(match[2]);
    if (word && !wordBank.some((item) => item.letter === match[1])) {
      wordBank.push({ letter: match[1], word });
    }
  }

  if (paragraphs.length < 1 || blanks.length < 5) {
    throw new Error(
      `${paperId}/${slug}: cloze extraction produced ${paragraphs.length} paragraphs and ${blanks.length} blanks`,
    );
  }

  // 原文里空格是 <u> 26 </u> 这样的编号，统一换成 __(26)__ 标记。
  const blankNumbers = new Set(blanks.map((blank) => blank.number));
  const answersByNumber = new Map(
    blanks.map((blank) => [blank.number, blank.answerWord]),
  );
  paragraphs.forEach((paragraph) => {
    for (const number of blankNumbers) {
      paragraph.english = paragraph.english.replace(
        new RegExp(`(^|[^0-9])${number}(?![0-9])`),
        `$1 __(${number})__ `,
      );
    }
    paragraph.english = paragraph.english.replace(/\s+/g, " ").trim();
  });

  // 官方译文把答案写进了句子里，逐空按顺序打码，避免直接剧透。
  const cursor = { value: 0 };
  paragraphs.forEach((paragraph) => {
    const answers = blanks.map((blank) => answersByNumber.get(blank.number));
    paragraph.chinese = maskClozeTranslation(paragraph.chinese, answers, cursor);
  });

  const first = blanks[0].number;
  const last = blanks[blanks.length - 1].number;
  return {
    kind: "cloze",
    index: 1,
    paragraphs,
    wordBank,
    blanks,
    questions: [],
    questionRange: `第 ${first}–${last} 题`,
    prompt:
      "从 A–O 词库中为每个空格选出最合适的词，每个词只能用一次。",
    title: buildTitle(paragraphs[0].chinese, "选词填空"),
  };
}

/* ------------------------------------------------------------ discovery */

async function discoverPapers() {
  const map = new Map();
  const ensure = (paperId) => {
    if (!map.has(paperId)) {
      map.set(paperId, { careful: [], matching: [], cloze: [] });
    }
    return map.get(paperId);
  };

  for (const [kind, page] of Object.entries(INDEX_PAGES)) {
    let html = "";
    try {
      html = await fetchPage(`${ORIGIN}${page}`);
    } catch (error) {
      console.warn(`Index ${page} unavailable: ${error.message}`);
      continue;
    }
    const pattern = /\/cet4\/sections\/(\d{4}-\d{2}-\d+)\/([a-z0-9-]+)\//g;
    for (const match of html.matchAll(pattern)) {
      const paperId = match[1];
      const slug = match[2];
      const { year } = parsePaperId(paperId);
      if (year < MIN_YEAR || year > MAX_YEAR) {
        continue;
      }
      if (kind === "careful" && !slug.startsWith("part3-section-c")) {
        continue;
      }
      if (kind === "matching" && slug !== "part3-section-b") {
        continue;
      }
      if (kind === "cloze" && slug !== "part3-section-a") {
        continue;
      }
      const entry = ensure(paperId);
      if (!entry[kind].includes(slug)) {
        entry[kind].push(slug);
      }
    }
  }

  const papers = [];
  const ids = new Set([...map.keys(), ...Object.keys(FALLBACK_PAPERS)]);
  for (const paperId of ids) {
    const { year, month, set } = parsePaperId(paperId);
    if (year < MIN_YEAR || year > MAX_YEAR) {
      continue;
    }
    const discovered = map.get(paperId) || {};
    const fallback = FALLBACK_PAPERS[paperId] || {};
    const careful = (discovered.careful?.length
      ? discovered.careful
      : fallback.careful || []
    ).sort();
    const matching = discovered.matching?.length
      ? discovered.matching
      : fallback.matching || ["part3-section-b"];
    const cloze = discovered.cloze?.length
      ? discovered.cloze
      : fallback.cloze || ["part3-section-a"];
    papers.push({ id: paperId, year, month, set, careful, matching, cloze });
  }
  papers.sort((left, right) => right.id.localeCompare(left.id));
  return papers;
}

/* --------------------------------------------------------------- build */

function countStats(pieces) {
  const paragraphCount = pieces.reduce(
    (total, piece) => total + piece.paragraphs.length,
    0,
  );
  const questionCount = pieces.reduce(
    (total, piece) => total + (piece.questions?.length || 0) + (piece.blanks?.length || 0),
    0,
  );
  const cueCount = pieces.reduce(
    (total, piece) =>
      total +
      piece.paragraphs.reduce(
        (innerTotal, paragraph) => innerTotal + paragraph.cues.length,
        0,
      ),
    0,
  );
  const phraseCount = pieces.reduce(
    (total, piece) =>
      total + piece.paragraphs.reduce(
        (innerTotal, paragraph) => innerTotal + paragraph.keyWords.length,
        0,
      ),
    0,
  );
  return { paragraphCount, questionCount, cueCount, phraseCount };
}

async function buildPiece(paperId, kind, slug, index) {
  const url = `${ORIGIN}/cet4/sections/${paperId}/${slug}/`;
  const source = await fetchPage(url);
  const parsed =
    kind === "careful"
      ? parseCarefulPage(source, { paperId, slug, index })
      : kind === "matching"
        ? parseMatchingPage(source, { paperId, slug })
        : parseClozePage(source, { paperId, slug });

  const meta = PIECE_TYPE[kind];
  return {
    id: `${paperId}-${kind}${kind === "careful" ? `-${index}` : ""}`,
    kind,
    type: meta.type,
    typeShort: meta.short,
    index,
    sourceUrl: url,
    tips: PIECE_TIPS[meta.type] || [],
    ...parsed,
  };
}

async function buildPaper(paper, { useCache }) {
  const jobs = [];
  paper.careful.forEach((slug, index) => {
    jobs.push(buildPieceWithCache(paper.id, "careful", slug, index + 1, useCache));
  });
  paper.matching.forEach((slug) => {
    jobs.push(buildPieceWithCache(paper.id, "matching", slug, 1, useCache));
  });
  paper.cloze.forEach((slug) => {
    jobs.push(buildPieceWithCache(paper.id, "cloze", slug, 1, useCache));
  });

  const settled = await Promise.allSettled(jobs);
  const pieces = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      pieces.push(result.value);
      return;
    }
    console.warn(`  skip ${paper.id} job#${index}: ${result.reason?.message}`);
  });

  const order = { cloze: 0, matching: 1, careful: 2 };
  pieces.sort(
    (left, right) =>
      order[left.kind] - order[right.kind] ||
      (left.index || 1) - (right.index || 1),
  );

  if (!pieces.length) {
    throw new Error(`${paper.id}: no reading pieces extracted`);
  }

  const stats = countStats(pieces);
  const data = {
    meta: {
      id: paper.id,
      label: `${paper.year} 年 ${paper.month} 月 · 第 ${paper.set} 套`,
      title: `${paper.year} 年 ${paper.month} 月四级阅读第 ${paper.set} 套`,
      subtitle:
        "选词填空、段落匹配、仔细阅读全题型：逐段中英对照、考点位置提醒、逐题解析与同义替换。",
      year: paper.year,
      month: paper.month,
      set: paper.set,
      sourceUrl: `${ORIGIN}/cet4/sections/reading/`,
      generatedAt: new Date().toISOString().slice(0, 10),
      pieceCount: pieces.length,
      ...stats,
    },
    pieces,
  };

  const output = `// Generated by scripts/build-reading-library.mjs from public CET-4 reading study pages.\n(window.IBALL_READING_LIBRARY = window.IBALL_READING_LIBRARY || {})[${JSON.stringify(
    paper.id,
  )}] = ${JSON.stringify(data, null, 2)};\n`;
  await fs.writeFile(path.join(outputDir, `${paper.id}.js`), output, "utf8");
  builtPapers.set(paper.id, data);

  return {
    id: paper.id,
    label: data.meta.label,
    year: paper.year,
    month: paper.month,
    set: paper.set,
    file: `./reading-data/${paper.id}.js`,
    pieceCount: pieces.length,
    types: pieces.map((piece) => ({
      kind: piece.kind,
      index: piece.index,
      label: `${piece.type}${piece.kind === "careful" ? ` ${piece.index}` : ""}`,
      range: piece.questionRange,
    })),
    ...stats,
    title: data.meta.title,
  };
}

async function buildPieceWithCache(paperId, kind, slug, index, useCache) {
  if (!useCache) {
    const url = `${ORIGIN}/cet4/sections/${paperId}/${slug}/`;
    await fs.rm(cachePathFor(url), { force: true });
  }
  return buildPiece(paperId, kind, slug, index);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/* ---------------------------------------------------------------- main */

const args = process.argv.slice(2);
const probe = args.includes("--probe");
const noCache = args.includes("--refresh");
const requested = args.filter((arg) => !arg.startsWith("--"));

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(cacheDir, { recursive: true });

const discovered = await discoverPapers();
const papers = requested.length
  ? discovered.filter((paper) => requested.includes(paper.id))
  : discovered;

if (!papers.length) {
  console.error("No papers matched the requested ids.");
  process.exit(1);
}

console.log(
  `Building ${papers.length} reading paper(s) across ${MIN_YEAR}-${MAX_YEAR}...`,
);

const summary = [];
const entries = await mapLimit(papers, 3, async (paper) => {
  try {
    const entry = await buildPaper(paper, { useCache: !noCache });
    console.log(
      `${entry.id}: ${entry.pieceCount} pieces, ${entry.paragraphCount} paragraphs, ${entry.questionCount} questions, ${entry.cueCount} cues`,
    );
    return entry;
  } catch (error) {
    console.error(`${paper.id}: ${error.message}`);
    return null;
  } finally {
    await sleep(120);
  }
});

entries.filter(Boolean).forEach((entry) => summary.push(entry));

if (!summary.length) {
  console.error("No papers were built.");
  process.exit(1);
}

if (probe) {
  const probePaper = summary[0];
  const sample = builtPapers.get(probePaper.id);
  console.log(
    JSON.stringify(
      {
        id: probePaper.id,
        meta: sample.meta,
        pieces: sample.pieces.map((piece) => ({
          id: piece.id,
          kind: piece.kind,
          title: piece.title,
          range: piece.questionRange,
          paragraphs: piece.paragraphs.length,
          questions: piece.questions.length,
          blanks: piece.blanks?.length || 0,
          wordBank: piece.wordBank?.length || 0,
          paragraphMap: piece.paragraphMap?.length || 0,
          firstQuestion: piece.questions[0] || null,
          firstBlank: piece.blanks?.[0] || null,
          firstParagraph: piece.paragraphs[0],
        })),
      },
      null,
      2,
    ),
  );
}

summary.sort((left, right) => right.id.localeCompare(left.id));
const manifest = `// Generated by scripts/build-reading-library.mjs\nwindow.IBALL_READING_PAPERS = ${JSON.stringify(
  summary,
  null,
  2,
)};\n`;

if (!requested.length) {
  await fs.writeFile(manifestPath, manifest, "utf8");
  console.log(
    `\nWrote ${summary.length} papers to ${path.relative(root, outputDir)} and updated reading-papers.js.`,
  );
} else {
  console.log(
    `\nWrote ${summary.length} paper file(s). Manifest left untouched for partial builds.`,
  );
}
