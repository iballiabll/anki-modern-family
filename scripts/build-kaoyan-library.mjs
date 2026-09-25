/**
 * 考研英语题库构建脚本。
 *
 * 从 kaoyan-english 语料目录读取英语一 / 英语二历年真题，解析出
 * 阅读、完形、新题型、翻译、写作五个板块，按试卷输出
 * kaoyan-data/<track>-<year>.js，供 kaoyan.html 点击后再加载。
 *
 * 语料目录优先级：
 *   1. 环境变量 KAOYAN_CORPUS_DIR
 *   2. 仓库内 kaoyan-corpus/papers
 *   3. 本机 Codex skill 目录 .codex/skills/kaoyan-english/references/papers
 *
 * 原始语料是「无空行的硬换行 Markdown」，因此全部按行解析：
 * 段落用「短行 + 句末标点」的启发式合并，题目按编号行切分。
 * 语料里的 Echo 内容是非官方学习材料，输出时原样保留并单独标注。
 *
 * 找不到语料时只提示并保留已有产物，不阻塞整站构建。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "kaoyan-data");
const reportPath = path.join(outputRoot, "build-report.json");
const generatedAt = new Date().toISOString().slice(0, 10);

const TRACKS = [
  { id: "english-i", label: "英语一", short: "英一" },
  { id: "english-ii", label: "英语二", short: "英二" },
];

const SECTION_ORDER = [
  "reading-text-1",
  "reading-text-2",
  "reading-text-3",
  "reading-text-4",
  "cloze",
  "new-question-type",
  "translation",
  "writing",
];

const SECTION_KIND = {
  cloze: "cloze",
  "new-question-type": "new-question-type",
  translation: "translation",
  writing: "writing",
};

const KIND_LABEL = {
  reading: "阅读",
  cloze: "完形",
  "new-question-type": "新题型",
  translation: "翻译",
  writing: "写作",
};

function candidateCorpusRoots() {
  const roots = [];
  if (process.env.KAOYAN_CORPUS_DIR) {
    roots.push(path.resolve(process.env.KAOYAN_CORPUS_DIR));
  }
  roots.push(path.join(root, "kaoyan-corpus", "papers"));
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (home) {
    roots.push(
      path.join(
        home,
        ".codex",
        "skills",
        "kaoyan-english",
        "references",
        "papers",
      ),
    );
  }
  return roots;
}

async function findCorpusRoot() {
  for (const candidate of candidateCorpusRoots()) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // 继续尝试下一个候选目录。
    }
  }
  return null;
}

/* --------------------------------------------------------------- 文本工具 */

function normalizeText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}

function collapse(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .trim();
}

function stripMarkdownEmphasis(value) {
  return String(value || "")
    .replace(/[*_`]/g, "")
    .trim();
}

function toLines(markdown) {
  return normalizeText(markdown)
    .split("\n")
    .map((line) => line.replace(/\s+$/, "").trim());
}

function countWords(text) {
  const matches = String(text || "").match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g);
  return matches ? matches.length : 0;
}

const TERMINAL_RE = /[.!?]["'”’)\]]?$/;
const HEADING_RE =
  /^(#{1,6}\s|Part\s+[A-C]\b|Section\s+[IVX]+\b(?:\s+\w+)?$|Text\s+\d+\s*$)/i;

function isHeadingLine(line) {
  if (!line) {
    return false;
  }
  if (/^#{1,6}\s/.test(line)) {
    return true;
  }
  if (/^Text\s+\d+\s*$/i.test(line)) {
    return true;
  }
  if (/^Part\s+[AB]\s*$/i.test(line)) {
    return true;
  }
  if (/^Section\s+[IVX]+\b.*$/i.test(line) && line.length <= 44) {
    return true;
  }
  return false;
}

/** 把硬换行的若干行还原成连续文本：行尾连字符直接接下一行，其余补空格。 */
function joinWrapped(lines) {
  let output = "";
  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    if (!output) {
      output = line;
      return;
    }
    if (/-$/.test(output) && /^[a-z(]/.test(line)) {
      output += line;
      return;
    }
    output += ` ${line}`;
  });
  return collapse(output);
}

/**
 * 段落还原：原文档只保留硬换行，遇到「明显短于版心宽度且以句末标点结束」
 * 的行就断段；markerPattern 命中时额外起一段（用于新题型的分人物/分空段落）。
 */
function splitParagraphs(lines, options = {}) {
  const clean = lines.filter((line) => line && !/^<!--/.test(line));
  if (!clean.length) {
    return [];
  }
  const widths = clean
    .map((line) => line.length)
    .sort((left, right) => left - right);
  const wrapWidth = widths[Math.floor(widths.length * 0.9)] || 80;
  const shortLine = Math.max(46, Math.min(64, Math.round(wrapWidth * 0.68)));
  const maxWidth = widths[widths.length - 1] || wrapWidth;

  const collect = (shouldBreak) => {
    const groups = [];
    let buffer = [];
    const flush = () => {
      const text = joinWrapped(buffer);
      if (text) {
        groups.push(text);
      }
      buffer = [];
    };

    clean.forEach((line, index) => {
      if (options.markerPattern && index > 0 && options.markerPattern.test(line)) {
        flush();
      }
      buffer.push(line);
      const isLast = index === clean.length - 1;
      if (!isLast && TERMINAL_RE.test(line) && shouldBreak(line)) {
        flush();
      }
    });
    flush();
    return groups;
  };

  // 严格规则：只有「明显短于版心且以句末标点结束」的行才断段。
  const strict = collect((line) => line.length <= shortLine);
  if (strict.length >= 3) {
    return strict;
  }
  // 语料版心较宽时，段落末行可能接近满行，严格规则会把整篇正文并成一段。
  // 此时放宽为「没有写满最宽行就断段」，避免出现单段长文。
  const loose = collect((line) => line.length < maxWidth - 1);
  return loose.length > strict.length ? loose : strict;
}

/** 取出 Directions 段（直到 "(N points)"），返回正文行。 */
function extractDirections(lines) {
  const start = lines.findIndex(
    (line) => /^Directions:/i.test(line) || /^\d{1,3}\.\s*Directions:/i.test(line),
  );
  if (start === -1) {
    return {
      directions: [],
      body: lines.filter((line) => line && !isHeadingLine(line)),
    };
  }
  const buffer = [];
  let index = start + 1;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    buffer.push(line);
    if (/\(\s*\d+(?:\.\d+)?\s*points?\s*\)/i.test(line) || /^points?\)/i.test(line)) {
      index += 1;
      break;
    }
  }
  const directions = buffer.length ? [collapse(buffer.join(" "))] : [];
  const body = lines
    .slice(index)
    .filter((line) => line && !isHeadingLine(line));
  return { directions, body };
}

const BRACKET_OPTION = /^\[([A-H])\]\s*(.*)$/;
const DOT_OPTION = /^([A-H])[.)]\s+(.*)$/;

/** 语料里选项有两种写法：`[A] xxx` 和 `A. xxx`，同一份文件只用一种。 */
function detectOptionStyles(lines) {
  let bracket = 0;
  let dot = 0;
  lines.forEach((line) => {
    if (BRACKET_OPTION.test(line)) {
      bracket += 1;
    } else if (DOT_OPTION.test(line)) {
      dot += 1;
    }
  });
  return { bracket, dot, useDot: bracket === 0 && dot >= 3 };
}

function parseOptionLine(line, useDot) {
  const bracket = line.match(BRACKET_OPTION);
  if (bracket) {
    return { key: bracket[1], text: collapse(stripMarkdownEmphasis(bracket[2])) };
  }
  if (useDot) {
    const dot = line.match(DOT_OPTION);
    if (dot) {
      return { key: dot[1], text: collapse(stripMarkdownEmphasis(dot[2])) };
    }
  }
  return null;
}

/** 一行里塞了全部选项（完形）或 `[A]…[D]` 混排时使用。 */
function parseOptionsInline(text) {
  const source = String(text || "");
  const marker = /\[[A-H]\]/.test(source)
    ? /\[([A-H])\]\s*/g
    : /(?:^|\s)([A-H])[.)]\s+/g;
  const hits = [];
  let match = marker.exec(source);
  while (match) {
    hits.push({
      key: match[1],
      start: match.index + match[0].indexOf(match[1]),
      end: marker.lastIndex,
    });
    match = marker.exec(source);
  }
  return hits
    .map((hit, index) => {
      const next = hits[index + 1];
      return {
        key: hit.key,
        text: collapse(stripMarkdownEmphasis(source.slice(hit.end, next ? next.start : source.length))),
      };
    })
    .filter((option) => option.text);
}

function parseEnrichment(markdown) {
  if (!markdown) {
    return [];
  }
  return normalizeText(markdown)
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) {
        return null;
      }
      const heading = lines[0].match(/^(#{2,4})\s+(.*)$/);
      if (heading) {
        return {
          type: heading[1].length >= 4 ? "subheading" : "heading",
          text: collapse(stripMarkdownEmphasis(heading[2])),
        };
      }
      if (/^>/.test(lines[0])) {
        return {
          type: "note",
          text: collapse(lines.map((line) => line.replace(/^>\s*/, "")).join(" ")),
        };
      }
      if (/^[-*+]\s/.test(lines[0])) {
        return {
          type: "bullets",
          items: lines
            .filter((line) => /^[-*+]\s/.test(line))
            .map((line) => collapse(stripMarkdownEmphasis(line.replace(/^[-*+]\s*/, "")))),
        };
      }
      return { type: "paragraph", text: collapse(stripMarkdownEmphasis(lines.join(" "))) };
    })
    .filter(Boolean);
}

function splitEnrichment(markdown) {
  const text = normalizeText(markdown);
  const startTag = "<!-- echo-enrichment:start -->";
  const endTag = "<!-- echo-enrichment:end -->";
  const start = text.indexOf(startTag);
  if (start === -1) {
    return { main: text, enrichment: "" };
  }
  const end = text.indexOf(endTag);
  const main = text.slice(0, start);
  const enrichment =
    end === -1 ? text.slice(start + startTag.length) : text.slice(start + startTag.length, end);
  return { main, enrichment };
}

/* --------------------------------------------------------------- 板块解析 */

const QUESTION_LINE = /^(\d{1,3})\.\s*(.*)$/;
const OPTION_LINE = /^\[([A-G])\]\s*(.*)$/;

function appendContinuation(target, key, line) {
  const previous = target[key];
  if (previous && TERMINAL_RE.test(previous)) {
    return false;
  }
  target[key] = collapse(`${previous} ${stripMarkdownEmphasis(line)}`);
  return true;
}

function parseReading(markdown, answers, meta, options = {}) {
  const { sectionId = "", questionMap = {} } = options;
  const lines = toLines(markdown);
  let questionStart = lines.findIndex((line) => {
    const match = line.match(QUESTION_LINE);
    return match && Number(match[1]) >= 21 && Number(match[1]) <= 40;
  });
  if (questionStart === -1) {
    questionStart = lines.length;
  }
  const { useDot } = detectOptionStyles(lines.slice(questionStart));
  // 语料正文开头带 "## 2010 考研英语一 Reading Text 1" 与 "Text 1" 两级标题，
  // 直接断段会把标题粘进第一段，这里先把标题行剔除再还原段落。
  const passageLines = lines
    .slice(0, questionStart)
    .filter((line) => !isHeadingLine(line));
  const paragraphs = splitParagraphs(passageLines);
  const questions = [];
  const dropped = [];
  let current = null;
  // question-map.json 是题号归属的权威来源，用它挡掉串到下篇的题干。
  const ownedBySection = (number) => {
    const entry = questionMap && questionMap[String(number)];
    if (!entry) {
      return true;
    }
    return !sectionId || entry.section === sectionId;
  };

  for (let index = questionStart; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || isHeadingLine(line)) {
      continue;
    }
    const questionMatch = line.match(QUESTION_LINE);
    if (questionMatch && Number(questionMatch[1]) >= 21) {
      const number = Number(questionMatch[1]);
      if (!ownedBySection(number)) {
        if (!dropped.includes(number)) {
          dropped.push(number);
        }
        current = null;
        continue;
      }
      current = {
        number,
        stem: collapse(stripMarkdownEmphasis(questionMatch[2])),
        options: [],
        answer: answers[String(number)] || "",
      };
      questions.push(current);
      continue;
    }
    const option = current ? parseOptionLine(line, useDot) : null;
    if (option) {
      current.options.push(option);
      continue;
    }
    if (!current) {
      continue;
    }
    if (!current.options.length) {
      appendContinuation(current, "stem", line);
      continue;
    }
    const last = current.options[current.options.length - 1];
    appendContinuation(last, "text", line);
  }

  return {
    kind: meta.kind,
    kindLabel: KIND_LABEL[meta.kind],
    paragraphs,
    questions,
    droppedQuestionNumbers: dropped,
    options: [],
  };
}

function parseCloze(markdown, answers, meta) {
  const lines = toLines(markdown);
  const { directions, body } = extractDirections(lines);
  const passageLines = [];
  const questions = [];
  const { useDot } = detectOptionStyles(body);

  body.forEach((line) => {
    const match = line.match(/^(\d{1,3})\.\s*(?:\[A\]|A[.)])\s*(.*)$/);
    if (match) {
      const number = Number(match[1]);
      const optionSource = line.replace(/^\d{1,3}\.\s*/, "");
      questions.push({
        number,
        stem: "",
        options: parseOptionsInline(optionSource),
        answer: answers[String(number)] || "",
      });
      return;
    }
    const option = questions.length ? parseOptionLine(line, useDot) : null;
    if (option && !/^\d/.test(line)) {
      const last = questions[questions.length - 1];
      last.options.push(option);
      return;
    }
    passageLines.push(line);
  });

  return {
    kind: meta.kind,
    kindLabel: KIND_LABEL[meta.kind],
    directions,
    paragraphs: splitParagraphs(passageLines),
    questions,
    options: [],
    blankNumbers: questions.map((question) => question.number),
  };
}

function findItemNumbers(text) {
  const numbers = [];
  const seen = new Set();
  const pattern = /(?:\((\d{2})\)|(?:^|[\s.、])(\d{2})\.\s*(?=_{2,}|$|\s))/gm;
  let match = pattern.exec(text);
  while (match) {
    const number = Number(match[1] || match[2]);
    if (number >= 36 && number <= 52 && !seen.has(number)) {
      seen.add(number);
      numbers.push(number);
    }
    match = pattern.exec(text);
  }
  return numbers;
}

function describeMarker(text, number) {
  const index = text.indexOf(`(${number})`);
  if (index === -1) {
    return "";
  }
  const tail = text.slice(index + `(${number})`.length).replace(/^[\s_:]+/, "");
  const firstLine = tail.split("\n")[0] || "";
  if (!firstLine || /^_{2,}/.test(tail)) {
    return "";
  }
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] || firstLine;
  return collapse(sentence).slice(0, 90);
}

/** `[ G ]` / `[G]` 统一成 `[G] `，方便后续识别备选项行。 */
function normalizeOptionMarkers(line) {
  return String(line || "").replace(/^\[\s*([A-G])\s*\]\s*/, "[$1] ");
}

/**
 * 「人物 / 作品匹配」类新题型把备选项和题干挤在同一行：
 *   41. Sue Rexford [B] Students whose extracurricular activity has ...
 * 这里把这类行拆成「题干行 + 备选项行」，交给统一的选项解析流程。
 */
function splitInlineOptions(lines) {
  const output = [];
  lines.forEach((rawLine) => {
    const line = normalizeOptionMarkers(rawLine);
    const inline = line.match(/^(\d{1,3})\.\s+([^[\]]{2,}?)\s*\[([A-G])\]\s*(.*)$/);
    if (!inline) {
      output.push(line);
      return;
    }
    output.push(`${inline[1]}. ${inline[2]}`.trim());
    const optionText = `${inline[4] || ""}`.trim();
    output.push(optionText ? `[${inline[3]}] ${optionText}` : `[${inline[3]}]`);
  });
  return output;
}

/** 收集 `41. 陈述句…` 形式的题干（判断正误 / 匹配题的左栏内容）。 */
function collectNumberedStatements(lines, minNumber = 36, maxNumber = 52) {
  const collected = new Map();
  let current = null;
  lines.forEach((line) => {
    const match = line.match(/^(\d{1,3})\.\s*(.*)$/);
    const number = match ? Number(match[1]) : Number.NaN;
    if (match && number >= minNumber && number <= maxNumber) {
      current = { number, lines: match[2] ? [match[2]] : [] };
      collected.set(number, current);
      return;
    }
    if (!current) {
      return;
    }
    if (/^\[\s*[A-G]\s*\]/.test(line) || /^(?:\(\d{2}\)|\d{1,3}\.\s)/.test(line)) {
      current = null;
      return;
    }
    current.lines.push(line);
  });
  const statements = new Map();
  collected.forEach((value, key) => {
    statements.set(key, joinWrapped(value.lines));
  });
  return statements;
}

/** 清理新题型题干里的排版残留（箭头、孤立编号、题号标记等）。 */
function cleanNewQuestionStem(value, number) {
  let text = collapse(stripMarkdownEmphasis(value || ""));
  if (!text) {
    return "";
  }
  text = text
    .replace(/[→←]/g, " ")
    .replace(/\b[A-H]\b(?=\s*(?:\d{2}\b|$))/g, " ");
  const numbers = String(number);
  text = text
    .replace(new RegExp(`(^|\\s)\\(${numbers}\\)(?=\\s|$)`, "g"), " ")
    .replace(new RegExp(`(^|\\s)${numbers}\\.(?=\\s|$)`, "g"), " ");
  text = text
    .replace(/\s*[_]{2,}\s*/g, " ")
    .replace(/^[\s"“”'’.,;:、-]+/, "")
    .replace(/[\s"“”'’,;:、-]+$/, "");
  return collapse(text);
}

function parseNewQuestionType(markdown, answers, meta) {
  const lines = toLines(markdown);
  const { directions, body } = extractDirections(lines);
  const normalized = splitInlineOptions(body);
  const options = [];
  const textLines = [];
  let currentOption = null;
  const { useDot } = detectOptionStyles(normalized);

  normalized.forEach((line) => {
    const option = parseOptionLine(line, useDot);
    if (option) {
      currentOption = option;
      options.push(currentOption);
      return;
    }
    if (
      currentOption &&
      !TERMINAL_RE.test(currentOption.text) &&
      !/^\d{1,3}\.\s/.test(line) &&
      !/^(?:\(\d{2}\)|\d{1,3}\.\s*_{2,})/.test(line)
    ) {
      appendContinuation(currentOption, "text", line);
      return;
    }
    currentOption = null;
    textLines.push(line);
  });

  const paragraphs = splitParagraphs(textLines, {
    markerPattern: /^(?:\(\d{2}\)|\d{2}\.\s*_{2,})/,
  });
  const bodyText = paragraphs.join("\n");
  const answerKeys = Object.keys(answers || {})
    .map((key) => Number(key))
    .filter((number) => Number.isFinite(number))
    .sort((left, right) => left - right);
  const numbers = findItemNumbers(bodyText);
  const merged = numbers.length >= answerKeys.length ? numbers : answerKeys;
  const statements = collectNumberedStatements(
    splitInlineOptions(textLines),
  );
  const answerValues = new Set(
    Object.values(answers || {}).map((value) => String(value || "").trim().toUpperCase()),
  );
  const trueFalse =
    answerValues.size > 0 &&
    [...answerValues].every((value) => value === "T" || value === "F");
  const isUsableStem = (value) =>
    Boolean(value) && /[A-Za-z]{3}/.test(value) && value.replace(/[^A-Za-z]/g, "").length >= 4;
  const questions = merged.map((number) => {
    const candidates = [
      cleanNewQuestionStem(describeMarker(bodyText, number), number),
      cleanNewQuestionStem(statements.get(number), number),
    ];
    const stem = candidates.find(isUsableStem) || (trueFalse ? `判断第 ${number} 题` : `第 ${number} 题`);
    return {
      number,
      stem,
      options: [],
      answer: answers[String(number)] || "",
    };
  });

  return {
    kind: meta.kind,
    kindLabel: KIND_LABEL[meta.kind],
    directions,
    paragraphs,
    questions,
    options,
    answerMode: trueFalse ? "true-false" : "pool",
    questionNumbers: merged,
  };
}

function extractReferenceTranslations(enrichment) {
  const references = [];
  const seen = new Set();
  if (!enrichment) {
    return references;
  }
  toLines(enrichment).forEach((line) => {
    const match = line.match(/^(\d{2})\.\s+(\S.*)$/);
    if (!match) {
      return;
    }
    const number = Number(match[1]);
    if (number < 46 || number > 52 || seen.has(number)) {
      return;
    }
    seen.add(number);
    references.push({ number, text: collapse(stripMarkdownEmphasis(match[2])) });
  });
  if (!references.length) {
    const blocks = parseEnrichment(enrichment);
    const heading = blocks.findIndex(
      (block) => block.type === "heading" && /参考译文/.test(block.text),
    );
    for (let index = heading + 1; index > 0 && index < blocks.length; index += 1) {
      if (blocks[index].type === "paragraph" && blocks[index].text.length > 30) {
        references.push({ number: 46, text: blocks[index].text });
        break;
      }
    }
  }
  return references;
}

function parseTranslation(markdown, answers, meta, options = {}) {
  const { enrichment = "" } = options;
  const lines = toLines(markdown);
  const { directions, body } = extractDirections(lines);
  const paragraphs = splitParagraphs(body);
  const text = paragraphs.join("\n");
  const markers = [];
  const markerPattern = /\((\d{2})\)/g;
  let match = markerPattern.exec(text);
  while (match) {
    const number = Number(match[1]);
    if (number >= 46 && number <= 52) {
      markers.push({ number, index: match.index, end: match.index + match[0].length });
    }
    match = markerPattern.exec(text);
  }
  const references = extractReferenceTranslations(enrichment);
  const referenceOf = (number) =>
    (references.find((item) => item.number === number) || {}).text || "";

  const segments = markers.map((marker, index) => {
    const next = markers[index + 1];
    const raw = text.slice(marker.end, next ? next.index : text.length);
    return {
      number: marker.number,
      text: collapse(stripMarkdownEmphasis(raw)),
    };
  });
  const segmentParagraphs = markers.length
    ? markers.map((marker, index) => {
        const next = markers[index + 1];
        const end = next ? next.index : text.length;
        return `${text.slice(0, marker.index)}${text.slice(marker.index, end)}`.slice(
          marker.index,
          end,
        );
      })
    : [];

  const questions = segments.length
    ? segments.map((segment) => ({
        number: segment.number,
        stem: segments.length > 1 ? `翻译第 ${segment.number} 句` : "全文翻译",
        options: [],
        answer: "",
        reference: referenceOf(segment.number),
      }))
    : [
        {
          number: references.length ? references[0].number : 46,
          stem: "全文翻译",
          options: [],
          answer: "",
          reference: referenceOf(references.length ? references[0].number : 46),
        },
      ];

  return {
    kind: meta.kind,
    kindLabel: KIND_LABEL[meta.kind],
    directions,
    paragraphs,
    segmentParagraphs,
    segments,
    questions,
    options: [],
  };
}

function parseWriting(markdown) {
  const lines = toLines(markdown);
  const parts = [];
  let current = null;

  lines.forEach((line) => {
    const partMatch = line.match(/^Part\s+([AB])\s*$/i);
    if (partMatch) {
      current = {
        part: `Part ${partMatch[1].toUpperCase()}`,
        number: 0,
        promptLines: [],
        points: 0,
        wordLimit: "",
      };
      parts.push(current);
      return;
    }
    if (!current || isHeadingLine(line)) {
      return;
    }
    const numberMatch = line.match(/^(\d{1,3})\.\s*Directions:\s*(.*)$/);
    if (numberMatch) {
      current.number = Number(numberMatch[1]);
      if (numberMatch[2]) {
        current.promptLines.push(numberMatch[2]);
      }
      return;
    }
    current.promptLines.push(line);
  });

  return parts.map((part) => {
    const raw = part.promptLines.join("\n");
    const limit = raw.match(/about\s+([\d\s-]+?)\s*words/i);
    // 语料里分值的写法不统一：(20 points)、（20 points）、( 10 points)。
    const pointsPattern = /[（(]\s*(\d+)\s*(?:points?|分)\s*[)）]/i;
    const points = raw.match(pointsPattern);
    return {
      part: part.part,
      number: part.number,
      points: points ? Number(points[1]) : 0,
      wordLimit: limit ? collapse(limit[1]) : "",
      prompt: collapse(raw.replace(pointsPattern, "").trim()),
    };
  });
}

/* ----------------------------------------------------------------- 试卷构建 */

const PARSERS = {
  reading: parseReading,
  cloze: parseCloze,
  "new-question-type": parseNewQuestionType,
  translation: parseTranslation,
};

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sectionMeta(sectionId, track, year) {
  const kind = SECTION_KIND[sectionId] || "reading";
  const index = Number((sectionId.match(/reading-text-(\d)/) || [])[1] || 0);
  const label =
    kind === "reading"
      ? `阅读 Text ${index}`
      : kind === "cloze"
        ? "完形填空"
        : kind === "new-question-type"
          ? "新题型"
          : kind === "translation"
            ? "翻译"
            : "写作";
  const shortLabel =
    kind === "reading"
      ? `T${index}`
      : kind === "cloze"
        ? "完形"
        : kind === "new-question-type"
          ? "新题型"
          : kind === "translation"
            ? "翻译"
            : "写作";
  return {
    id: `${track}-${year}-${sectionId}`,
    section: sectionId,
    kind,
    kindLabel: KIND_LABEL[kind],
    label,
    shortLabel,
    track,
    year,
  };
}

function validateSection(section, sectionId) {
  const warnings = [];
  if (section.kind === "writing") {
    if (!section.writingParts.length) {
      warnings.push(`${sectionId} 未解析到 Part A / Part B`);
    }
    return warnings;
  }
  if (!section.paragraphs.length && !section.questions.length) {
    warnings.push(`${sectionId} 解析结果为空`);
    return warnings;
  }
  if (section.kind === "reading") {
    // 语料串号时已按 question-map.json 裁掉不属于本篇的题干，这里允许 4-5 题。
    if (section.questions.length < 4 || section.questions.length > 5) {
      warnings.push(`${sectionId} 题量 ${section.questions.length}，期望 4-5`);
    }
    section.questions.forEach((question) => {
      if (question.options.length !== 4) {
        warnings.push(
          `${sectionId} 第 ${question.number} 题选项 ${question.options.length} 个，期望 4`,
        );
      }
      if (!question.stem) {
        warnings.push(`${sectionId} 第 ${question.number} 题题干为空`);
      }
    });
  }
  if (section.kind === "cloze") {
    if (section.questions.length !== 20) {
      warnings.push(`${sectionId} 空格 ${section.questions.length} 个，期望 20`);
    }
    section.questions.forEach((question) => {
      if (question.options.length !== 4) {
        warnings.push(
          `${sectionId} 第 ${question.number} 空选项 ${question.options.length} 个，期望 4`,
        );
      }
    });
  }
  if (section.kind === "new-question-type" && section.questions.length !== 5) {
    warnings.push(`${sectionId} 题量 ${section.questions.length}，期望 5`);
  }
  if (section.kind === "translation" && !section.paragraphs.length) {
    warnings.push(`${sectionId} 缺少待翻译原文`);
  }
  return warnings;
}

async function buildPaper(track, year, corpusRoot) {
  const directory = path.join(corpusRoot, track, String(year));
  const answersFile = await readJson(path.join(directory, "answers.json"), {});
  const answerMap = answersFile.answers || {};
  const meta = await readJson(path.join(directory, "meta.json"), {});
  const questionMap = await readJson(path.join(directory, "question-map.json"), {});
  const reportedSections = Array.isArray(meta.sections) ? meta.sections : SECTION_ORDER;
  const trackInfo = TRACKS.find((item) => item.id === track);
  const sections = [];
  const warnings = [];

  for (const sectionId of SECTION_ORDER) {
    if (!reportedSections.includes(sectionId)) {
      continue;
    }
    const raw = await readText(path.join(directory, `${sectionId}.md`));
    if (!raw) {
      warnings.push(`缺少 ${sectionId}.md`);
      continue;
    }
    const { main, enrichment } = splitEnrichment(raw);
    const metaInfo = sectionMeta(sectionId, track, year);
    const parsed =
      metaInfo.kind === "writing"
        ? { paragraphs: [], questions: [], options: [] }
        : PARSERS[metaInfo.kind](
            main,
            answerMap[sectionId] || {},
            metaInfo,
            { sectionId, questionMap, enrichment },
          );
    const writingParts = metaInfo.kind === "writing" ? parseWriting(main) : [];

    const section = {
      ...metaInfo,
      title: `${year} 考研${trackInfo.label} ${
        sectionId.startsWith("reading-text")
          ? `阅读 Text ${sectionId.slice(-1)}`
          : metaInfo.label
      }`,
      directions: parsed.directions || [],
      paragraphs: parsed.paragraphs || [],
      segmentParagraphs: parsed.segmentParagraphs || [],
      segments: parsed.segments || [],
      options: parsed.options || [],
      questions: parsed.questions || [],
      writingParts,
      answerMode: parsed.answerMode || "",
      droppedQuestionNumbers: parsed.droppedQuestionNumbers || [],
      blankNumbers: parsed.blankNumbers || [],
      enrichment: parseEnrichment(enrichment),
      enrichmentNotice: enrichment
        ? "以下为 Echo 生成的非官方参考译文与学习解析，仅用于自测、批改和复盘。"
        : "",
      wordCount: countWords(
        [
          ...(parsed.paragraphs || []),
          ...(parsed.questions || []).map((item) => item.stem),
          ...writingParts.map((item) => item.prompt),
        ].join(" "),
      ),
    };
    warnings.push(...validateSection(section, sectionId).map((item) => `${sectionId}：${item}`));
    sections.push(section);
  }

  const stats = {
    sections: sections.length,
    paragraphs: sections.reduce((total, section) => total + section.paragraphs.length, 0),
    questions: sections.reduce((total, section) => total + section.questions.length, 0),
    words: sections.reduce((total, section) => total + section.wordCount, 0),
    enrichment: sections.reduce((total, section) => total + section.enrichment.length, 0),
  };

  return {
    paper: {
      id: `${track}-${year}`,
      track,
      trackLabel: trackInfo.label,
      trackShort: trackInfo.short,
      year,
      title: `${year} 考研${trackInfo.label}`,
      generatedAt,
      generatedBy: "scripts/build-kaoyan-library.mjs",
      source: "kaoyan-english 真题语料（Echo 内容为非官方学习材料）",
      stats,
      sections,
    },
    warnings,
    notes: sections.flatMap((section) =>
      (section.droppedQuestionNumbers || []).map(
        (number) =>
          `${section.section}：语料串入第 ${number} 题，已按 question-map.json 裁掉`,
      ),
    ),
  };
}

/* ------------------------------------------------------------------- 主流程 */

const corpusRoot = await findCorpusRoot();
if (!corpusRoot) {
  console.warn(
    "未找到考研语料目录，保留现有 kaoyan-data 产物。可通过 KAOYAN_CORPUS_DIR 指定。",
  );
  process.exit(0);
}

await fs.mkdir(outputRoot, { recursive: true });

const index = [];
const report = {
  generatedAt,
  corpus: "kaoyan-english references/papers（本机语料目录路径不写入产物）",
  papers: [],
  warnings: [],
  notes: [],
};

for (const track of TRACKS) {
  for (let year = 2010; year <= 2026; year += 1) {
    const directory = path.join(corpusRoot, track.id, String(year));
    try {
      const stat = await fs.stat(directory);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    const { paper, warnings, notes } = await buildPaper(track.id, year, corpusRoot);
    const fileName = `${paper.id}.js`;
    const payload = `// Generated by scripts/build-kaoyan-library.mjs. 语料来源：kaoyan-english（Echo 解析为非官方学习材料）。\n(window.IBALL_KAOYAN_LIBRARY = window.IBALL_KAOYAN_LIBRARY || {})[${JSON.stringify(
      paper.id,
    )}] = ${JSON.stringify(paper)};\n`;
    await fs.writeFile(path.join(outputRoot, fileName), payload, "utf8");
    index.push({
      id: paper.id,
      track: paper.track,
      trackLabel: paper.trackLabel,
      trackShort: paper.trackShort,
      year: paper.year,
      label: paper.title,
      file: `./kaoyan-data/${fileName}`,
      stats: paper.stats,
      sections: paper.sections.map((section) => ({
        id: section.id,
        section: section.section,
        kind: section.kind,
        kindLabel: section.kindLabel,
        label: section.label,
        shortLabel: section.shortLabel,
        paragraphs: section.paragraphs.length,
        questions: section.questions.length,
        enrichment: section.enrichment.length,
      })),
    });
    report.papers.push({ id: paper.id, stats: paper.stats, warnings, notes });
    report.warnings.push(...warnings.map((warning) => `${paper.id}：${warning}`));
    report.notes.push(...notes.map((note) => `${paper.id}：${note}`));
  }
}

index.sort((left, right) => {
  if (left.track !== right.track) {
    return left.track.localeCompare(right.track);
  }
  return right.year - left.year;
});

const indexPayload = `// Generated by scripts/build-kaoyan-library.mjs\nwindow.IBALL_KAOYAN_INDEX = ${JSON.stringify(
  {
    generatedAt,
    source: "kaoyan-english 真题语料",
    tracks: TRACKS,
    papers: index,
  },
  null,
  2,
)};\n`;

await fs.writeFile(path.join(outputRoot, "index.js"), indexPayload, "utf8");
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(
  `已生成 ${index.length} 套考研试卷，共 ${index.reduce(
    (total, paper) => total + paper.stats.questions,
    0,
  )} 道题、${index.reduce((total, paper) => total + paper.stats.words, 0)} 个英文词。`,
);
if (report.warnings.length) {
  console.warn(`有 ${report.warnings.length} 条解析提示，详见 kaoyan-data/build-report.json`);
}
