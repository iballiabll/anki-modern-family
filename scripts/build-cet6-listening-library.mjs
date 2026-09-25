// Builds the 六级听力精读 library from the public CET-6 listening pages.
// Usage: node scripts/build-cet6-listening-library.mjs [paperId ...]

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "cet6-listening-data");
const manifestPath = path.join(root, "cet6-listening-papers.js");
const SOURCE_ROOT = "https://english-exam.lazynote.cn/cet6/sections/listening";
const COLLOCATION_PATH = path.join(root, "data", "cet6-collocations.txt");
const LEVEL_LABEL = "六级";
const LIBRARY_VAR = "IBALL_CET6_LISTENING_LIBRARY";
const PAPERS_VAR = "IBALL_CET6_LISTENING_PAPERS";
const FILE_DIR = "./cet6-listening-data/";

const DEFAULT_PAPERS = [
  "2015-06-1",
  "2015-06-2",
  "2015-06-3",
  "2015-12-1",
  "2015-12-2",
  "2015-12-3",
  "2016-06-1",
  "2016-06-2",
  "2016-12-1",
  "2016-12-2",
  "2017-06-1",
  "2017-06-2",
  "2017-12-1",
  "2017-12-2",
  "2018-06-1",
  "2018-06-2",
  "2018-12-1",
  "2018-12-2",
  "2019-06-1",
  "2019-06-2",
  "2019-12-1",
  "2019-12-2",
  "2020-07-1",
  "2020-09-1",
  "2020-12-1",
  "2020-12-2",
  "2021-06-1",
  "2021-06-2",
  "2021-12-1",
  "2021-12-2",
  "2022-06-1",
  "2022-09-1",
  "2022-12-1",
  "2022-12-2",
  "2023-03-1",
  "2023-06-1",
  "2023-06-2",
  "2023-12-1",
  "2023-12-2",
  "2024-06-1",
  "2024-06-2",
  "2024-12-1",
  "2024-12-2",
  "2025-06-1",
  "2025-06-2",
  "2025-12-1",
  "2025-12-2",
  "2026-06-1",
  "2026-06-2",
];

// 听力答案最爱出现的位置：命中越多，这段越可能是考点段。
const CUE_RULES = [
  {
    label: "转折对比处",
    pattern:
      /\b(?:but|however|yet|although|though|actually|in fact|instead|on the other hand|rather than)\b/i,
    tip: "转折词后面才是重点：听到 but / however / actually，前面说的通常是干扰项，答案紧随其后。",
  },
  {
    label: "因果结果处",
    pattern:
      /\b(?:because|so|therefore|thus|as a result|that's why|due to|since|lead to|caused)\b/i,
    tip: "原因和结果都可能设题：记下 because 后面的原因、so 后面的结果，注意选项把因果颠倒。",
  },
  {
    label: "建议方案处",
    pattern:
      /\b(?:why don't you|why not|you should|you'd better|you have to|let's|let us|how about|what about|have you tried|maybe you)\b/i,
    tip: "长对话里建议句几乎必出题：why don't you / you should / let's 之后就是答案。",
  },
  {
    label: "态度观点处",
    pattern:
      /\b(?:i think|i believe|in my opinion|i'm afraid|i'd rather|i prefer|i doubt|to be honest|personally)\b/i,
    tip: "说话人态度常设题：I'm afraid 多为否定，I'd rather / I prefer 表示偏好，别被第一个说话人带偏。",
  },
  {
    label: "数字时间处",
    pattern:
      /\b(?:\d|percent|dollars?|pounds?|cents?|years?|months?|weeks?|minutes?|hours?|miles?|kilometers?|degrees?|quarter|half)\b/i,
    tip: "数字、时间、价格必设题：边听边记，注意近音数字和同义改写（a quarter = 15 minutes）。",
  },
  {
    label: "列举顺序处",
    pattern:
      /\b(?:first|second|third|next|then|finally|last|another|also|besides)\b/i,
    tip: "序数词后是分点信息：第一题常在 first，最后一题常在 finally / last 附近，选项按顺序出现。",
  },
  {
    label: "强调重点处",
    pattern:
      /\b(?:important|the key|the point|remember|notice|mainly|most|especially|in particular|focus on)\b/i,
    tip: "强调词后面是本段核心，正确答案通常是这句话的同义替换，而不是原词照读。",
  },
  {
    label: "计划打算处",
    pattern:
      /\b(?:going to|gonna|will|plan to|intend to|would like to|expect to|decide to)\b/i,
    tip: "将来计划常设题：注意 plan to / going to / decide to 后面的动作和时间。",
  },
  {
    label: "条件假设处",
    pattern: /\b(?:if|unless|as long as|provided that|otherwise)\b/i,
    tip: "条件句常设题：听清条件是否成立，避免把没发生的假设当成事实。",
  },
];

const PIECE_TIPS = {
  短篇新闻: [
    "新闻第一句是导语，主旨题答案几乎都在开头，先抓住 who / what / where。",
    "数字、地点、结果是细节题高频点，听到就速记。",
    "结尾常补一句后续进展，最后一题常考这里。",
  ],
  长对话: [
    "答案多出现在第二个说话人的回答里，疑问句之后更要紧跟。",
    "听到建议、决定、态度词就做记号，这是长对话最爱出题的位置。",
    "题目顺序与对话顺序基本一致，不要跳着找答案。",
  ],
  听力篇章: [
    "篇章按顺序出题，第一题通常在开头两句内出现。",
    "转折、因果、列举三类句子是答案聚集区。",
    "最后一段的总结句常对应最后一题。",
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
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "")
      .replace(/<span class="exam-pno[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n"),
  )
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function getPieceType(promptText) {
  const text = promptText.toLowerCase();
  if (text.includes("news report")) {
    return "短篇新闻";
  }
  if (text.includes("conversation")) {
    return "长对话";
  }
  return "听力篇章";
}

function getSection(firstQuestion) {
  if (firstQuestion <= 7) {
    return "Section A";
  }
  if (firstQuestion <= 15) {
    return "Section B";
  }
  return "Section C";
}

function buildTitle(chinese) {
  const text = chinese
    .replace(/^[“"'「『]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "听力原文精读";
  }
  const stopped = /^(.{6,22}?)[，。；！？,;.!?]/.exec(text);
  if (stopped) {
    return stopped[1];
  }
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}

function extractKeyWords(english) {
  const seen = new Set();
  const candidates = [];
  const words = english.match(/[A-Za-z][A-Za-z'-]{5,}/g) || [];
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
  return CUE_RULES.filter((rule) => rule.pattern.test(english))
    .slice(0, 3)
    .map((rule) => ({ label: rule.label, tip: rule.tip }));
}

/* ------------------------------------------------------- 固定搭配识别 */

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const OBJECT_PLACEHOLDER = String.raw`(?:[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,1})`;
const POSSESSIVE_PLACEHOLDER = String.raw`(?:one['’]s|my|your|his|her|its|our|their|[A-Za-z][A-Za-z'-]*['’]s?)`;
const INFLECTION_EXEMPT = new Set(
  (
    "a an the and or but nor if as at by for from in into of off on out over " +
    "to up upon with within without than that this these those it its he she " +
    "they we you i me him her us them my your his our their one all any both " +
    "each either neither no not so some such very too also just only even still " +
    "yet ever never always often again more most less least much many few little " +
    "own same other another every here there when where why how what which who " +
    "whom whose whether because although though while before after since until " +
    "till during among between across along around behind below beneath beside " +
    "beyond despite except inside outside through throughout toward towards under " +
    "underneath against about above down back away forward together apart"
  ).split(" "),
);

const IRREGULAR_GROUPS = [
  ["be", "am", "is", "are", "was", "were", "been", "being"],
  ["have", "has", "had", "having"],
  ["do", "does", "did", "done", "doing"],
  ["go", "goes", "went", "gone", "going"],
  ["make", "makes", "made", "making"],
  ["take", "takes", "took", "taken", "taking"],
  ["get", "gets", "got", "gotten", "getting"],
  ["give", "gives", "gave", "given", "giving"],
  ["come", "comes", "came", "coming"],
  ["see", "sees", "saw", "seen", "seeing"],
  ["know", "knows", "knew", "known", "knowing"],
  ["think", "thinks", "thought", "thinking"],
  ["find", "finds", "found", "finding"],
  ["say", "says", "said", "saying"],
  ["tell", "tells", "told", "telling"],
  ["become", "becomes", "became", "becoming"],
  ["leave", "leaves", "left", "leaving"],
  ["feel", "feels", "felt", "feeling"],
  ["put", "puts", "putting"],
  ["bring", "brings", "brought", "bringing"],
  ["begin", "begins", "began", "begun", "beginning"],
  ["keep", "keeps", "kept", "keeping"],
  ["hold", "holds", "held", "holding"],
  ["write", "writes", "wrote", "written", "writing"],
  ["stand", "stands", "stood", "standing"],
  ["hear", "hears", "heard", "hearing"],
  ["let", "lets", "letting"],
  ["mean", "means", "meant", "meaning"],
  ["set", "sets", "setting"],
  ["meet", "meets", "met", "meeting"],
  ["run", "runs", "ran", "running"],
  ["pay", "pays", "paid", "paying"],
  ["sit", "sits", "sat", "sitting"],
  ["speak", "speaks", "spoke", "spoken", "speaking"],
  ["lie", "lies", "lay", "lain", "lying"],
  ["lead", "leads", "led", "leading"],
  ["read", "reads", "reading"],
  ["grow", "grows", "grew", "grown", "growing"],
  ["lose", "loses", "lost", "losing"],
  ["fall", "falls", "fell", "fallen", "falling"],
  ["send", "sends", "sent", "sending"],
  ["build", "builds", "built", "building"],
  ["understand", "understands", "understood", "understanding"],
  ["draw", "draws", "drew", "drawn", "drawing"],
  ["break", "breaks", "broke", "broken", "breaking"],
  ["spend", "spends", "spent", "spending"],
  ["sell", "sells", "sold", "selling"],
  ["buy", "buys", "bought", "buying"],
  ["wear", "wears", "wore", "worn", "wearing"],
  ["choose", "chooses", "chose", "chosen", "choosing"],
  ["seek", "seeks", "sought", "seeking"],
  ["drive", "drives", "drove", "driven", "driving"],
  ["eat", "eats", "ate", "eaten", "eating"],
  ["fight", "fights", "fought", "fighting"],
  ["forget", "forgets", "forgot", "forgotten", "forgetting"],
  ["ride", "rides", "rode", "ridden", "riding"],
  ["rise", "rises", "rose", "risen", "rising"],
  ["sing", "sings", "sang", "sung", "singing"],
  ["sleep", "sleeps", "slept", "sleeping"],
  ["teach", "teaches", "taught", "teaching"],
  ["throw", "throws", "threw", "thrown", "throwing"],
  ["wake", "wakes", "woke", "woken", "waking"],
  ["win", "wins", "won", "winning"],
  ["show", "shows", "showed", "shown", "showing"],
  ["catch", "catches", "caught", "catching"],
  ["cut", "cuts", "cutting"],
  ["deal", "deals", "dealt", "dealing"],
  ["fit", "fits", "fitting"],
  ["hang", "hangs", "hung", "hanging"],
  ["learn", "learns", "learned", "learnt", "learning"],
  ["light", "lights", "lit", "lighting"],
  ["prove", "proves", "proved", "proven", "proving"],
  ["shoot", "shoots", "shot", "shooting"],
  ["shut", "shuts", "shutting"],
  ["spread", "spreads", "spreading"],
  ["strike", "strikes", "struck", "striking"],
  ["sweep", "sweeps", "swept", "sweeping"],
  ["swim", "swims", "swam", "swum", "swimming"],
  ["tear", "tears", "tore", "torn", "tearing"],
  ["wake", "wakes", "woke", "woken", "waking"],
];

const IRREGULAR_FORMS = new Map();
IRREGULAR_GROUPS.forEach((group) => {
  group.forEach((form) => IRREGULAR_FORMS.set(form, group));
});

function inflectedWordPattern(word) {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_FORMS.get(lower);
  if (irregular) {
    return `(?:${irregular.map(escapeRegExp).join("|")})`;
  }

  const forms = new Set([lower]);
  if (
    lower.length < 3 ||
    INFLECTION_EXEMPT.has(lower) ||
    /['’]/.test(lower)
  ) {
    return escapeRegExp(lower);
  }

  if (/[^aeiou]y$/.test(lower)) {
    const stem = lower.slice(0, -1);
    forms.add(`${stem}ies`);
    forms.add(`${stem}ied`);
    forms.add(`${lower}ing`);
  } else {
    if (/(?:s|x|z|ch|sh|o)$/.test(lower)) {
      forms.add(`${lower}es`);
    } else {
      forms.add(`${lower}s`);
    }

    if (lower.endsWith("e")) {
      forms.add(`${lower}d`);
      forms.add(`${lower.slice(0, -1)}ing`);
    } else {
      forms.add(`${lower}ed`);
      forms.add(`${lower}ing`);
    }

    if (/[^aeiou][aeiou][^aeiouwxy]$/.test(lower)) {
      const doubled = `${lower}${lower.at(-1)}`;
      forms.add(`${doubled}ed`);
      forms.add(`${doubled}ing`);
    }
  }

  return `(?:${[...forms].map(escapeRegExp).join("|")})`;
}

function collocationTokenToPattern(token) {
  const normalized = token.replace(/[’‘]/g, "'");
  if (/^sb\.?'?s$/i.test(normalized) || /^sb\.s$/i.test(normalized)) {
    return POSSESSIVE_PLACEHOLDER;
  }
  if (/^one's$/i.test(normalized)) {
    return POSSESSIVE_PLACEHOLDER;
  }
  if (/^s(?:b|th)\.?$/i.test(normalized)) {
    return OBJECT_PLACEHOLDER;
  }
  if (/^[a-z]+(?:['-][a-z]+)*$/i.test(normalized)) {
    return inflectedWordPattern(normalized);
  }
  return null;
}

function collocationToPatternSource(entry) {
  const tokens = entry
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  if (tokens.some((token) => token.includes("…"))) {
    return "";
  }

  const patterns = tokens.map(collocationTokenToPattern);
  if (patterns.some((pattern) => !pattern)) {
    return "";
  }

  // 短语必须作为完整单词/词组出现，避免 "son ordered" 命中 "on order"。
  return String.raw`(?<![A-Za-z0-9'-])${patterns.join(
    String.raw`\s+`,
  )}(?![A-Za-z0-9'-])`;
}

async function loadCollocations() {
  let raw = "";
  try {
    raw = await fs.readFile(COLLOCATION_PATH, "utf8");
  } catch {
    return [];
  }

  const seen = new Set();
  const entries = [];
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      const source = collocationToPatternSource(line);
      if (!source) {
        return;
      }
      seen.add(key);
      entries.push({
        text: line,
        key: line,
        source,
        weight: line.split(/\s+/).length,
      });
    });

  // 长短语优先，避免 "a lot" 抢先吃掉 "a lot of"。
  entries.sort(
    (left, right) =>
      right.weight - left.weight || right.text.length - left.text.length,
  );
  return entries;
}

function findCollocations(english, collocations, limit = 18) {
  if (!english || collocations.length === 0) {
    return [];
  }

  const claimed = new Array(english.length).fill(false);
  const hits = [];

  for (const entry of collocations) {
    const pattern = new RegExp(entry.source, "gi");
    let match = pattern.exec(english);
    while (match) {
      const start = match.index;
      const end = start + match[0].length;
      if (match[0].trim()) {
        let free = true;
        for (let index = start; index < end; index += 1) {
          if (claimed[index]) {
            free = false;
            break;
          }
        }
        if (free) {
          for (let index = start; index < end; index += 1) {
            claimed[index] = true;
          }
          hits.push({
            text: match[0].replace(/\s+/g, " ").trim(),
            key: entry.key,
            start,
          });
        }
      }
      if (pattern.lastIndex === match.index) {
        pattern.lastIndex += 1;
      }
      match = pattern.exec(english);
    }
  }

  const seen = new Set();
  return hits
    .sort((left, right) => left.start - right.start)
    .filter((hit) => {
      const dedupeKey = hit.key.toLocaleLowerCase("en-US");
      if (seen.has(dedupeKey)) {
        return false;
      }
      seen.add(dedupeKey);
      return true;
    })
    .slice(0, limit)
    .map((hit) => hit.key);
}

/* --------------------------------------------------------- 题目解析 */

function extractQuestionBlocks(source) {
  const starts = [];
  const marker = /<div id="q-(\d+)" class="lqp-unit"/g;
  let match = marker.exec(source);
  while (match) {
    starts.push({ number: Number.parseInt(match[1], 10), index: match.index });
    match = marker.exec(source);
  }

  return starts.map((start, index) => {
    const next = starts[index + 1];
    let end = source.length;
    if (next) {
      end = next.index;
    } else {
      const scriptIndex = source.indexOf("<script", start.index);
      if (scriptIndex > start.index) {
        end = scriptIndex;
      }
    }
    return { number: start.number, html: source.slice(start.index, end) };
  });
}

function pickText(html, pattern) {
  const match = pattern.exec(html);
  return match ? cleanHtml(match[1]) : "";
}

function parseChoices(html) {
  const pattern = /<span data-pdh-letter="([A-D])"[^>]*>([\s\S]*?)<\/span>/g;
  const choices = [];
  for (const match of html.matchAll(pattern)) {
    choices.push({ letter: match[1], text: cleanHtml(match[2]) });
  }
  return choices;
}

function parseChoiceTranslations(html) {
  const listMatch = /<ul class="lqp-trans-choices"[\s\S]*?>([\s\S]*?)<\/ul>/.exec(
    html,
  );
  if (!listMatch) {
    return new Map();
  }
  const pattern =
    /<span class="lqp-trans-letter"[^>]*>([A-D])\)<\/span>([\s\S]*?)(?=<\/li>)/g;
  const map = new Map();
  for (const match of listMatch[1].matchAll(pattern)) {
    map.set(match[1], cleanHtml(match[2]));
  }
  return map;
}

function parsePairs(html) {
  const listMatch = /<ul class="rp-pairs[^"]*"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  if (!listMatch) {
    return [];
  }

  const pairs = [];
  const itemPattern = /<li class="rp-pair"[\s\S]*?<\/li>/g;
  for (const item of listMatch[1].matchAll(itemPattern)) {
    const origin = pickText(
      item[0],
      /<span class="rp-pair-orig"[^>]*>([\s\S]*?)<\/span>/,
    );
    const option = pickText(
      item[0],
      /<span class="rp-pair-opt"[^>]*>([\s\S]*?)<\/span>/,
    );
    const why = pickText(
      item[0],
      /<span class="lqp-pair-why"[^>]*>([\s\S]*?)<\/span>/,
    );
    if (origin || option || why) {
      pairs.push({ origin, option, why });
    }
  }
  return pairs;
}

function parseVerdicts(html) {
  const listMatch = /<ul class="rp-verdicts"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  if (!listMatch) {
    return [];
  }

  const verdicts = [];
  const itemPattern = /<li class="rp-verdict[^"]*"[\s\S]*?<\/li>/g;
  for (const item of listMatch[1].matchAll(itemPattern)) {
    const letter = pickText(
      item[0],
      /<span class="rp-verdict-letter"[^>]*>([\s\S]*?)<\/span>/,
    ).replace(/[)\s]+$/, "");
    const flag = pickText(
      item[0],
      /<span class="rp-flag[^"]*"[^>]*>([\s\S]*?)<\/span>/,
    );
    const reason = pickText(
      item[0],
      /<span class="rp-verdict-reason"[^>]*>([\s\S]*?)<\/span>/,
    );
    const source = pickText(
      item[0],
      /<p class="lqp-source"[^>]*>([\s\S]*?)<\/p>/,
    );
    if (letter || reason) {
      verdicts.push({ letter, flag, reason, source });
    }
  }
  return verdicts;
}

function extractQuestions(source) {
  const questions = [];

  extractQuestionBlocks(source).forEach((block) => {
    const html = block.html;
    const answer = pickText(
      html,
      /<strong class="rp-ans"[^>]*>([\s\S]*?)<\/strong>/,
    );
    const stem = pickText(
      html,
      /<p class="rp-stem-en"[^>]*>([\s\S]*?)<\/p>/,
    );
    const choices = parseChoices(html);
    if (!stem || choices.length === 0) {
      return;
    }

    const translations = parseChoiceTranslations(html);
    const locateMatch = /<a class="[^"]*rp-locate-p[^"]*"[^>]*href="#p-(\d+)-(\d+)"/.exec(
      html,
    );
    const signalMatch =
      /<p class="rp-text"[^>]*>[\s\S]*?<strong class="lqp-signal-core"[^>]*>([\s\S]*?)<\/strong>([\s\S]*?)<\/p>/.exec(
        html,
      );

    questions.push({
      number: block.number,
      type: pickText(
        html,
        /<span class="rp-qtype"[^>]*>([\s\S]*?)<\/span>/,
      )
        .replace(/[（）()]/g, "")
        .trim(),
      stem,
      stemTranslation: pickText(
        html,
        /<p class="lqp-trans-stem"[^>]*>([\s\S]*?)<\/p>/,
      ),
      choices: choices.map((choice) => ({
        ...choice,
        translation: translations.get(choice.letter) || "",
      })),
      answer,
      answerText: pickText(
        html,
        /<span class="lqp-correct"[^>]*>([\s\S]*?)<\/span>/,
      ),
      pieceNumber: locateMatch ? Number.parseInt(locateMatch[1], 10) : 0,
      paragraphNumber: locateMatch ? Number.parseInt(locateMatch[2], 10) : 0,
      locateEnglish: pickText(
        html,
        /<p class="rp-locate-en"[^>]*>([\s\S]*?)<\/p>/,
      ),
      locateChinese: pickText(
        html,
        /<p class="rp-locate-zh"[^>]*>([\s\S]*?)<\/p>/,
      ),
      signalCore: signalMatch ? cleanHtml(signalMatch[1]) : "",
      signalDetail: signalMatch
        ? cleanHtml(signalMatch[2]).replace(/^[。，、：:；;\s]+/, "")
        : "",
      pairs: parsePairs(html),
      verdicts: parseVerdicts(html),
    });
  });

  return questions;
}

function attachQuestions(pieces, questions) {
  questions.forEach((question) => {
    const piece =
      pieces.find(
        (candidate) => candidate.firstQuestion === question.pieceNumber,
      ) || null;
    question.pieceId = piece ? piece.id : "";
    if (piece) {
      piece.questions.push(question);
    }
  });
}

function extractGrammar(source) {
  const grammarItems = [];
  const itemPattern = /<li class="sdg__item" id="sdg-(\d+)"[\s\S]*?<\/li>/g;

  for (const match of source.matchAll(itemPattern)) {
    const item = match[0];
    const sourceQuestion = Number.parseInt(
      item.match(/data-pdh-piece="(\d+)"/)?.[1] || "0",
      10,
    );
    const sentence = cleanHtml(
      item.match(/<span lang="en"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "",
    );
    const location = cleanHtml(
      item.match(/<span class="sdg__pos"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "",
    );
    const explanation = cleanHtml(
      item.match(/<p class="sdg__review"[^>]*>([\s\S]*?)<\/p>/)?.[1] || "",
    );

    if (!sourceQuestion || !sentence || !explanation) {
      continue;
    }

    grammarItems.push({
      id: Number.parseInt(match[1], 10),
      sourceQuestion,
      paragraphNumber: null,
      location,
      sentence,
      explanation,
    });
  }

  return grammarItems;
}

function extractPieces(source, grammarItems, collocations) {
  const pieces = [];
  const piecePattern =
    /<div id="(lt-\d+)" class="lt-piece[\s\S]*?(?=<div id="lt-\d+" class="lt-piece|<\/main>)/g;

  for (const match of source.matchAll(piecePattern)) {
    const firstQuestion = Number.parseInt(match[1].replace("lt-", ""), 10);
    const headMatch = /<div class="lt-piece-head"[^>]*>([\s\S]*?)<\/div>/.exec(
      match[0],
    );
    const promptText = cleanHtml(headMatch?.[1] || "");
    const paragraphs = [];
    const paragraphPattern =
      /<p id="p-(\d+)-(\d+)" class="lt-en"[^>]*>([\s\S]*?)<\/p>\s*<p class="lt-zh"[^>]*>([\s\S]*?)<\/p>/g;

    for (const paragraphMatch of match[0].matchAll(paragraphPattern)) {
      const english = cleanHtml(paragraphMatch[3]);
      const chinese = cleanHtml(paragraphMatch[4]);
      if (!english) {
        continue;
      }
      const paragraphNumber = Number.parseInt(paragraphMatch[2], 10);
      const grammar = grammarItems.filter(
        (note) =>
          note.sourceQuestion === firstQuestion &&
          note.sentence &&
          english.includes(note.sentence.slice(0, 40)),
      );
      paragraphs.push({
        number: paragraphNumber,
        english,
        chinese,
        keyWords: extractKeyWords(english),
        phrases: findCollocations(english, collocations),
        cues: analyzeCues(english),
        grammar: grammar.map((note) => ({
          id: note.id,
          sourceQuestion: note.sourceQuestion,
          paragraphNumber,
          location: note.location,
          sentence: note.sentence,
          explanation: note.explanation,
        })),
      });
    }

    if (paragraphs.length === 0) {
      continue;
    }

    const type = getPieceType(promptText);
    pieces.push({
      id: match[1],
      firstQuestion,
      section: getSection(firstQuestion),
      type,
      title: buildTitle(paragraphs[0].chinese),
      questionRange: "",
      prompt: promptText,
      tips: PIECE_TIPS[type] || [],
      questions: [],
      paragraphs,
    });
  }

  pieces.sort((left, right) => left.firstQuestion - right.firstQuestion);
  pieces.forEach((piece, index) => {
    const next = pieces[index + 1];
    const last = next ? next.firstQuestion - 1 : 25;
    piece.questionRange =
      last > piece.firstQuestion
        ? `Questions ${piece.firstQuestion}–${last}`
        : `Question ${piece.firstQuestion}`;
  });
  return pieces;
}

async function buildPaper(paperId, collocations) {
  const url = `${SOURCE_ROOT}/${paperId}/`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; iball-cabin build)" },
  });
  if (!response.ok) {
    throw new Error(`${paperId}: HTTP ${response.status}`);
  }
  const source = await response.text();
  const grammarItems = extractGrammar(source);
  const pieces = extractPieces(source, grammarItems, collocations);
  const questions = extractQuestions(source);
  attachQuestions(pieces, questions);

  if (pieces.length < 4) {
    throw new Error(`${paperId}: extracted only ${pieces.length} pieces`);
  }

  const paragraphCount = pieces.reduce(
    (total, piece) => total + piece.paragraphs.length,
    0,
  );
  const grammarCount = pieces.reduce(
    (total, piece) =>
      total +
      piece.paragraphs.reduce(
        (innerTotal, paragraph) => innerTotal + paragraph.grammar.length,
        0,
      ),
    0,
  );
  const phraseCount = pieces.reduce(
    (total, piece) =>
      total +
      piece.paragraphs.reduce(
        (innerTotal, paragraph) => innerTotal + paragraph.phrases.length,
        0,
      ),
    0,
  );
  const questionCount = pieces.reduce(
    (total, piece) => total + piece.questions.length,
    0,
  );
  const { year, month, set } = parsePaperId(paperId);
  const data = {
    meta: {
      id: paperId,
      title: `${year} 年 ${month} 月${LEVEL_LABEL}听力第 ${set} 套`,
      subtitle:
        "逐段对照翻译、固定搭配、出题点提醒，逐题作答验证并给出定位与排除解析。",
      sourceUrl: url,
      generatedAt: new Date().toISOString().slice(0, 10),
      pieceCount: pieces.length,
      paragraphCount,
      grammarCount,
      phraseCount,
      questionCount,
    },
    pieces,
  };

  const output = `// Generated from the public CET6 listening study page.\n(window.${LIBRARY_VAR} = window.${LIBRARY_VAR} || {})[${JSON.stringify(
    paperId,
  )}] = ${JSON.stringify(data, null, 2)};\n`;
  await fs.writeFile(path.join(outputDir, `${paperId}.js`), output, "utf8");

  return {
    id: paperId,
    label: `${year} 年 ${month} 月 · 第 ${set} 套`,
    file: `${FILE_DIR}${paperId}.js`,
    pieceCount: pieces.length,
    paragraphCount,
    grammarCount,
    phraseCount,
    questionCount,
    title: data.meta.title,
  };
}

const requested = process.argv.slice(2);
const papers = requested.length > 0 ? requested : DEFAULT_PAPERS;

await fs.mkdir(outputDir, { recursive: true });

const collocations = await loadCollocations();
console.log(`Loaded ${collocations.length} CET-6 collocations.`);

const summary = [];
for (const paperId of papers) {
  try {
    const entry = await buildPaper(paperId, collocations);
    summary.push(entry);
    console.log(
      `${entry.id}: ${entry.pieceCount} pieces, ${entry.paragraphCount} paragraphs, ${entry.grammarCount} grammar notes, ${entry.phraseCount} phrases, ${entry.questionCount} questions`,
    );
  } catch (error) {
    console.error(`${paperId}: ${error.message}`);
  }
}

summary.sort((left, right) => right.id.localeCompare(left.id));
const manifest = `// Generated by scripts/build-cet6-listening-library.mjs\nwindow.${PAPERS_VAR} = ${JSON.stringify(
  summary,
  null,
  2,
)};\n`;
await fs.writeFile(manifestPath, manifest, "utf8");
console.log(`\nWrote ${summary.length} papers to ${path.relative(root, outputDir)}.`);
