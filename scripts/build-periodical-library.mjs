#!/usr/bin/env node
/**
 * 把 scripts/extract-periodical.py 产出的原始结构化数据整理成站点可直接懒加载的外刊库。
 *
 * 输入：.cache 下任意一次提取产物目录里的 manifest.json 与 NNN.json
 * 输出：
 *   periodical-papers.js          —— 期号清单（首页计数用，体积很小）
 *   periodical-index.js           —— 侧栏索引（日期 / 主题 / 板块覆盖）
 *   periodical-data/<id>.js       —— 单期完整内容，按需加载
 */
import fs from "node:fs/promises";
import path from "node:path";
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

function hasFlag(name) {
  return args.includes(name);
}

const rawDir = path.resolve(root, readArg("--raw", ".cache/periodical-raw2"));
const outDir = path.resolve(root, readArg("--out", "."));
const dataDir = path.join(outDir, "periodical-data");
const quiet = hasFlag("--quiet");

const THEME_PREFIX = "考研那些事儿之";
const KIND_LABELS = {
  layout: "杂志排版",
  reading: "精读",
  source: "原文",
  test: "检验题",
  qa: "答疑",
};
const KIND_ORDER = ["source", "reading", "test", "qa", "layout"];

function log(message) {
  if (!quiet) {
    console.log(message);
  }
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028|\u2029/g, "");
}

function compact(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// 提取脚本里同一个字段可能是字符串，也可能是分行数组，这里统一成一行文本。
function flatten(value) {
  if (Array.isArray(value)) {
    return compact(value.map((part) => compact(part)).filter(Boolean).join(" "));
  }
  return compact(value);
}

function themeFromSeries(series) {
  const value = compact(series);
  if (!value) {
    return "";
  }
  const trimmed = value.startsWith(THEME_PREFIX)
    ? value.slice(THEME_PREFIX.length)
    : value.replace(/^考研那些事[儿⼉]之/, "");
  return trimmed.replace(/系列$/, "").trim();
}

/* --------------------------------------------------- 精读词条结构化解析 */
/*
 * 精读 PDF 里每个词条都是一段连排文字：
 *   bond n. /bɒnd/ an agreement by ... 债券；公债【考研大纲词汇】 Government bonds ... 政府债券...
 * 提取脚本按行给出 head/definition/gloss/example/exampleZh，字段边界并不稳定。
 * 这里把它们重新拼回原文再按「词性 → 音标 → 英英释义 → 中文 → 例句 → 例句译文」切分，
 * 原始字段同时保留在结果里作为兜底，解析不出的内容在页面上照原样显示，不会被吞掉。
 */

const CJK_CHAR = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const LATIN_CHAR = /[A-Za-z]/;
const VOCAB_POS_PATTERN =
  /^(phrasal verb|phrasal-verb|phrase|idiom|abbr\.|n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|int\.)\s*/i;
const VOCAB_STOP_PATTERN = /^(SYN|ANT)\b/i;

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 连排文字里中英文交替出现，先按字符类别切块，再判断每块是义项、例句还是中文释义。
// PDF 连排会把词条名和词性/释义粘在一起，这里只做「截断」不做改写。
const VOCAB_TERM_STOP =
  /(?:^|[\s(])(phrasal[\s-]?verb|phrase|idiom|abbr\.|adj\.|adv\.|n\.|v\.|vt\.|vi\.|a\.|prep\.|conj\.|pron\.|num\.|int\.)/i;
const VOCAB_TERM_GLUE_MARK = /(phrasalverb|phrase|idiom|abbr|adj|adv|[anv])\./i;
const VOCAB_TERM_GLUE_TAIL = /(phrasalverb|phrase|idiom)$/i;

function cleanVocabTerm(rawTerm) {
  let value = compact(rawTerm).replace(/[\u3400-\u9FFF\uF900-\uFAFF][\s\S]*$/, "");
  value = value.replace(/[^A-Za-z0-9\s'’/-]+$/g, "");
  const slash = value.search(/\s\//);
  if (slash > 0) {
    value = value.slice(0, slash);
  }
  const stop = VOCAB_TERM_STOP.exec(value);
  if (stop) {
    value = value.slice(0, stop.index + stop[0].indexOf(stop[1]));
  } else if (!/\s/.test(value)) {
    const glued = VOCAB_TERM_GLUE_MARK.exec(value);
    if (glued && glued.index >= 3) {
      value = value.slice(0, glued.index);
    }
  }
  if (!/\s/.test(value) && value.length > 8) {
    value = value.replace(VOCAB_TERM_GLUE_TAIL, "");
    value = value.replace(/(abbr|adj|adv|[anv])\.$/i, "").replace(/[^A-Za-z0-9'’/-]+$/g, "");
  }
  return value.trim();
}

function splitScriptRuns(text) {
  const runs = [];
  let current = "";
  let mode = "";
  const flush = () => {
    const value = current.trim();
    if (value) {
      runs.push({ kind: mode, text: value });
    }
    current = "";
  };
  for (const char of String(text || "")) {
    const next = CJK_CHAR.test(char) ? "zh" : LATIN_CHAR.test(char) ? "en" : mode || "en";
    if (!mode) {
      mode = next;
    }
    if (next !== mode) {
      flush();
      mode = next;
    }
    current += char;
  }
  flush();
  return runs;
}

function parseVocabEntry(item) {
  const levels = [];
  const raw = [item.head, item.definition, item.gloss, item.example, item.exampleZh]
    .map(flatten)
    .filter(Boolean);
  let text = raw.join(" ").replace(/\s+/g, " ").trim();
  text = text.replace(/【([^】]{1,20})】/g, (_, group) => {
    levels.push(group.trim());
    return " ";
  });

  let phonetic = flatten(item.phonetic);
  const phoneticMatch = /\/[^/\s][^/]{0,40}\//.exec(text);
  if (phoneticMatch) {
    if (!phonetic) {
      phonetic = phoneticMatch[0];
    }
    text = text.replace(phoneticMatch[0], " ");
  }

  let pos = flatten(item.pos).replace(/[.。]$/, "");
  let body = text.trim();
  const leadingPos = VOCAB_POS_PATTERN.exec(body);
  if (leadingPos) {
    if (!pos) {
      pos = leadingPos[1].toLowerCase();
    }
    body = body.slice(leadingPos[0].length);
  }
  body = body.replace(/^[\s;,:.-]+/, "").replace(/\s+/g, " ").trim();

  const senses = [];
  const synonyms = [];
  let sense = null;
  const startSense = (value) => ({
    pos: value || "",
    phonetic: "",
    defEn: "",
    defZh: "",
    exampleEn: "",
    exampleZh: "",
  });
  const pushSense = () => {
    if (sense && (sense.defEn || sense.defZh || sense.exampleEn || sense.exampleZh)) {
      senses.push(sense);
    }
    sense = null;
  };

  splitScriptRuns(body).forEach((run) => {
    const value = run.text.trim();
    if (!value) {
      return;
    }
    if (run.kind === "en") {
      if (VOCAB_STOP_PATTERN.test(value)) {
        const match = /^(SYN|ANT)\b[:\s]*(.*)$/i.exec(value);
        let rest = match ? match[2].trim() : "";
        const split = rest.match(/^(.*?[a-z.)])\s+(?=[A-Z][a-z]+\s)/);
        if (split) {
          synonyms.push(`${match[1].toUpperCase()} ${split[1].trim()}`);
          rest = rest.slice(split[1].length).trim();
        } else {
          synonyms.push(`${match[1].toUpperCase()} ${rest}`.trim());
          rest = "";
        }
        if (rest) {
          if (!sense) {
            sense = startSense("");
          }
          sense.exampleEn = rest;
        }
        return;
      }

      const innerPos = VOCAB_POS_PATTERN.exec(value);
      const looksLikeExample =
        /^[A-Z"“(]/.test(value) && sense && sense.defEn && sense.defZh && !sense.exampleEn;
      if (innerPos && sense && (sense.defEn || sense.defZh)) {
        pushSense();
        sense = startSense(innerPos[1].toLowerCase());
        const rest = value.slice(innerPos[0].length).trim();
        if (rest) {
          sense.defEn = rest;
        }
        return;
      }
      if (innerPos && !sense) {
        sense = startSense(innerPos[1].toLowerCase());
        const rest = value.slice(innerPos[0].length).trim();
        if (rest) {
          sense.defEn = rest;
        }
        return;
      }
      if (looksLikeExample) {
        sense.exampleEn = value;
        return;
      }
      if (!sense) {
        sense = startSense("");
      }
      if (sense.defEn && sense.defZh && !sense.exampleEn) {
        sense.exampleEn = value;
      } else {
        sense.defEn = sense.defEn ? `${sense.defEn} ${value}` : value;
      }
      return;
    }

    if (!sense) {
      sense = startSense("");
    }
    if (sense.exampleEn && !sense.exampleZh) {
      sense.exampleZh = value;
    } else if (!sense.defZh) {
      sense.defZh = value;
    } else if (sense.exampleZh) {
      sense.defZh = `${sense.defZh} ${value}`;
    } else {
      sense.defZh = `${sense.defZh} ${value}`;
    }
  });
  pushSense();

  const term = cleanVocabTerm(item.term);
  const termRaw = compact(item.term);
  return {
    term,
    ...(termRaw && termRaw !== term ? { termRaw } : {}),
    head: compact(item.head),
    pos,
    phonetic,
    levels,
    synonyms,
    senses,
    definition: flatten(item.definition),
    gloss: flatten(item.gloss),
    example: flatten(item.example),
    exampleZh: flatten(item.exampleZh),
    tags: (item.tags || []).map(compact).filter(Boolean),
  };
}

// 词条按首次出现挂到具体段落；拼不出来（PDF 粘连、改写、术语变体）的进整篇兜底区。
function termForms(term) {
  const base = compact(term).toLowerCase();
  if (!base) {
    return [];
  }
  const forms = new Set([base]);
  if (/[a-z]$/.test(base)) {
    forms.add(`${base}s`);
    forms.add(`${base}ed`);
    forms.add(`${base}d`);
    forms.add(`${base}ing`);
    if (/y$/.test(base)) {
      const stem = base.slice(0, -1);
      forms.add(`${stem}ies`);
      forms.add(`${stem}ied`);
      forms.add(`${stem}ier`);
      forms.add(`${stem}iest`);
      forms.add(`${stem}ily`);
    }
    if (/(s|x|z|ch|sh)$/.test(base)) {
      forms.add(`${base}es`);
    }
  }
  return [...forms].filter((form) => form.length >= 3).sort((left, right) => right.length - left.length);
}

function placeVocabInParagraphs(vocab, paragraphs) {
  const buckets = paragraphs.map(() => []);
  const unplaced = [];
  vocab.forEach((item) => {
    const patterns = termForms(item.term)
      .slice(0, 10)
      .map((form) => new RegExp(`(^|[^a-z])${escapeRegExp(form)}([^a-z]|$)`));
    let hit = -1;
    let label = "";
    for (let index = 0; index < paragraphs.length; index += 1) {
      const source = String(paragraphs[index].en || "");
      if (!source) {
        continue;
      }
      if (patterns.some((pattern) => pattern.test(source.toLowerCase()))) {
        hit = index;
        break;
      }
      // PDF 粘连出来的词（comealongway）在正文里其实是分开写的，按字母流找回真实写法。
      const surface = surfaceSpan(source, item.term);
      if (surface) {
        hit = index;
        label = surface;
        break;
      }
    }
    if (hit === -1) {
      unplaced.push(item.term);
      return;
    }
    buckets[hit].push(label && label !== item.term ? { term: item.term, label } : { term: item.term });
  });
  return { buckets, unplaced };
}

// 只比较字母、忽略空格与连字符，用于把词条定位回正文中的真实写法。
function lettersOnly(text) {
  const stream = [];
  const source = String(text || "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index].toLowerCase();
    if (char >= "a" && char <= "z") {
      stream.push({ char, index });
    }
  }
  return stream;
}

function surfaceSpan(text, term) {
  const letters = String(term || "").toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length < 3) {
    return "";
  }
  const stream = lettersOnly(text);
  const flat = stream.map((item) => item.char).join("");
  const at = flat.indexOf(letters);
  if (at === -1) {
    return "";
  }
  const start = stream[at].index;
  const end = stream[at + letters.length - 1].index;
  // 两端必须是字母边界，否则 "bar" 会被错当成 "barrier" 的前三个字母。
  const before = String(text)[start - 1] || " ";
  const after = String(text)[end + 1] || " ";
  if (/[a-z]/i.test(before) || /[a-z]/i.test(after)) {
    return "";
  }
  const label = String(text).slice(start, end + 1).replace(/\s+/g, " ").trim();
  return label.length <= 48 ? label : "";
}

function issueLabel(dateKey, range) {
  if (!dateKey) {
    return "未标注日期";
  }
  const [year, month, day] = dateKey.split("-");
  const base = `${Number(year)} 年 ${Number(month)} 月 ${Number(day)} 日`;
  if (range) {
    const [, endMonth, endDay] = range.split("|")[1]?.split("-") || [];
    if (endMonth && endDay) {
      return `${base} - ${Number(endMonth)} 月 ${Number(endDay)} 日`;
    }
  }
  return base;
}

function readingPayload(entry, magazineEntry) {
  const paragraphs = (entry.reading?.paragraphs || [])
    .map((block) => ({
      index: block.index,
      en: compact(block.en),
      zh: compact(block.zh),
    }))
    .filter((block) => block.en || block.zh);
  const vocab = (entry.reading?.vocab || [])
    .map((item) => parseVocabEntry(item))
    .filter((item) => item.term);
  if (!paragraphs.length && !vocab.length) {
    return null;
  }
  const placed = placeVocabInParagraphs(vocab, paragraphs);
  paragraphs.forEach((paragraph, order) => {
    paragraph.vocab = placed.buckets[order] || [];
  });
  return {
    file: entry.file,
    headline: entry.headline || {},
    magazineIntro: compact(
      magazineEntry?.reading?.magazineIntro || entry.reading?.magazineIntro,
    ),
    magazineDifficulty: compact(
      magazineEntry?.reading?.magazineDifficulty ||
        entry.reading?.magazineDifficulty,
    ),
    magazineFile: compact(magazineEntry?.file || entry.file),
    paragraphs,
    vocab,
    vocabUnplaced: placed.unplaced,
    sections: sectionPayload(entry),
  };
}

function magazineForReading(entry, magazines) {
  if (!magazines.length) {
    return null;
  }
  const title = compact(entry.headline?.title);
  if (title) {
    const matched = magazines.find(
      (magazine) => compact(magazine.headline?.title) === title,
    );
    if (matched) {
      return matched;
    }
  }
  return magazines.length === 1 ? magazines[0] : null;
}

// 精读讲义里的「今日翻译作业 / 今日句子分析 / 写作积累」引用写作 Para.3 或 (Para. 4)，
// 用它把每个小节挂回具体段落，页面就能在段落旁边直接显示语法与写作旁注。
const SECTION_REF_PATTERN = /^\s*(?:\d+\s*[.、)]\s*)?[（(]?\s*para\s*\.?\s*(\d+)/i;

function sectionPayload(entry) {
  const sections = (entry.reading?.sections || [])
    .map((section) => {
      const lines = (section.lines || [])
        .map((line) => ({
          kind: line.kind === "zh" ? "zh" : "en",
          text: compact(line.text),
        }))
        .filter((line) => line.text);
      if (!lines.length) {
        return null;
      }
      const groups = [];
      let current = { ref: 0, lines: [] };
      lines.forEach((line) => {
        const match = line.kind === "zh" ? null : SECTION_REF_PATTERN.exec(line.text);
        if (match && current.lines.length) {
          groups.push(current);
          current = { ref: 0, lines: [] };
        }
        if (match && !current.ref) {
          current.ref = Number(match[1]) || 0;
        }
        current.lines.push(line);
      });
      if (current.lines.length) {
        groups.push(current);
      }
      return { heading: compact(section.heading), groups };
    })
    .filter(Boolean);
  return sections;
}

function testPayload(entry) {
  const items = (entry.test?.items || [])
    .map((item) => ({
      number: item.number,
      stem: compact(item.stem),
      options: (item.options || []).map((option) => ({
        key: option.key,
        text: compact(option.text),
      })),
      answer: item.answer || "",
      kicker: compact(item.kicker),
      analysis: (item.analysis || []).map(compact).filter(Boolean),
    }))
    .filter((item) => item.stem || item.options.length || item.answer);
  const passage = (entry.test?.passage || []).map(compact).filter(Boolean);
  if (!items.length && !passage.length) {
    return null;
  }
  return {
    file: entry.file,
    type: entry.testType || "other",
    instructions: (entry.test?.instructions || []).map(compact).filter(Boolean),
    passage,
    items,
  };
}

function qaPayload(entry) {
  const items = (entry.items || [])
    .map((item) => ({
      locator: compact(item.locator),
      sentence: compact(item.sentence),
      question: compact(item.question),
      answer: compact(item.answer),
    }))
    .filter((item) => item.sentence || item.question);
  if (!items.length) {
    return null;
  }
  return { file: entry.file, items };
}

function articlePayload(entry) {
  const articles = (entry.articles || [])
    .map((article) => ({
      title: compact(article.title),
      titleZh: compact(article.titleZh),
      source: compact(article.source),
      publishedOn: compact(article.publishedOn),
      paragraphs: (article.paragraphs || [])
        .map((block) => ({ index: block.index, text: compact(block.text) }))
        .filter((block) => block.text),
    }))
    .filter((article) => article.title || article.paragraphs.length);
  if (!articles.length) {
    return null;
  }
  return { file: entry.file, articles };
}

function originalRecord(entry, relativeRaw) {
  return {
    kind: entry.kind,
    label: KIND_LABELS[entry.kind] || entry.kind,
    file: entry.file,
    ext: path.extname(entry.file).toLowerCase(),
    bytes: entry.bytes ?? null,
    date: entry.date || "",
    range: entry.range || "",
    title: compact(entry.headline?.title || ""),
    sourcePath: compact(entry.sourcePath || ""),
    raw: relativeRaw,
  };
}

function buildIssue(dateKey, entries) {
  const sorted = [...entries].sort((left, right) => {
    const leftRank = KIND_ORDER.indexOf(left.kind);
    const rightRank = KIND_ORDER.indexOf(right.kind);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.file.localeCompare(right.file, "zh-CN");
  });

  const articles = [];
  const reading = [];
  const tests = [];
  const qa = [];
  const originals = [];
  const sources = new Set();
  const themes = new Set();
  const magazines = entries.filter((entry) => entry.kind === "layout");
  const titles = [];
  let range = "";

  for (const entry of sorted) {
    originals.push(originalRecord(entry, path.relative(outDir, rawDir)));
    if (!range && entry.range) {
      range = entry.range;
    }
    const headline = entry.headline || {};
    const theme = themeFromSeries(headline.series);
    if (theme) {
      themes.add(theme);
    }
    if (headline.source) {
      sources.add(headline.source);
    }
    if (headline.title) {
      titles.push({ title: headline.title, titleZh: headline.titleZh || "" });
    }

    if (entry.kind === "source") {
      const payload = articlePayload(entry);
      if (payload) {
        articles.push(payload);
        payload.articles.forEach((article) => {
          if (article.source) {
            sources.add(article.source);
          }
        });
      }
      continue;
    }
    if (entry.kind === "reading") {
      const payload = readingPayload(entry, magazineForReading(entry, magazines));
      if (payload) {
        reading.push(payload);
      }
      continue;
    }
    if (entry.kind === "test") {
      const payload = testPayload(entry);
      if (payload) {
        tests.push(payload);
      }
      continue;
    }
    if (entry.kind === "qa") {
      const payload = qaPayload(entry);
      if (payload) {
        qa.push(payload);
      }
    }
  }

  const articleCount = articles.reduce((total, group) => total + group.articles.length, 0);
  const paragraphCount = reading.reduce(
    (total, group) => total + group.paragraphs.length,
    0,
  );
  const vocabCount = reading.reduce((total, group) => total + group.vocab.length, 0);
  const sectionCount = reading.reduce(
    (total, group) => total + (group.sections || []).length,
    0,
  );
  const questionCount = tests.reduce(
    // 完形填空没有独立题干，新题型所有小题共用一组 A-G 候选，因此按小题数统计。
    (total, group) => total + group.items.filter((item) => item.stem || item.options.length || item.answer).length,
    0,
  );
  const qaCount = qa.reduce((total, group) => total + group.items.length, 0);

  const primary = titles[0] || { title: "", titleZh: "" };
  return {
    meta: {
      id: dateKey,
      label: issueLabel(dateKey, range),
      date: dateKey,
      range,
      theme: [...themes][0] || "",
      themes: [...themes],
      sources: [...sources],
      title: primary.title,
      titleZh: primary.titleZh,
      counts: {
        article: articleCount,
        paragraph: paragraphCount,
        vocab: vocabCount,
        section: sectionCount,
        question: questionCount,
        qa: qaCount,
        original: originals.length,
        layout: originals.filter((item) => item.kind === "layout").length,
      },
      tabs: {
        articles: articleCount > 0,
        reading: paragraphCount > 0 || vocabCount > 0,
        tests: questionCount > 0,
        qa: qaCount > 0,
        originals: originals.length > 0,
      },
    },
    articles,
    reading,
    tests,
    qa,
    originals,
  };
}

async function main() {
  const manifestPath = path.join(rawDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

  const buckets = new Map();
  for (const item of manifest.files) {
    const entry = JSON.parse(await fs.readFile(path.join(rawDir, item.json), "utf8"));
    const key = entry.date || entry.range || "undated";
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(entry);
  }

  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });

  const issues = [];
  for (const [key, entries] of [...buckets].sort((left, right) =>
    right[0].localeCompare(left[0]),
  )) {
    const issue = buildIssue(key, entries);
    const file = `periodical-data/${key}.js`;
    await fs.writeFile(
      path.join(outDir, file),
      `// Generated by scripts/build-periodical-library.mjs\n(window.IBALL_PERIODICAL_LIBRARY = window.IBALL_PERIODICAL_LIBRARY || {})[${safeJson(key)}] = ${safeJson(issue)};\n`,
      "utf8",
    );
    issues.push({
      id: key,
      file,
      label: issue.meta.label,
      date: issue.meta.date,
      theme: issue.meta.theme,
      themes: issue.meta.themes,
      range: issue.meta.range,
      title: issue.meta.title,
      titleZh: issue.meta.titleZh,
      sources: issue.meta.sources,
      counts: issue.meta.counts,
      tabs: issue.meta.tabs,
    });
  }

  const themeCounter = new Map();
  issues.forEach((issue) => {
    (issue.themes.length ? issue.themes : ["综合"]).forEach((theme) => {
      themeCounter.set(theme, (themeCounter.get(theme) || 0) + 1);
    });
  });
  const themes = [...themeCounter]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "zh-CN"));

  const totalCounts = issues.reduce(
    (total, issue) => {
      total.article += issue.counts.article;
      total.paragraph += issue.counts.paragraph;
      total.vocab += issue.counts.vocab;
      total.question += issue.counts.question;
      total.qa += issue.counts.qa;
      total.original += issue.counts.original;
      return total;
    },
    { article: 0, paragraph: 0, vocab: 0, question: 0, qa: 0, original: 0 },
  );

  const index = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: path.relative(root, rawDir).split(path.sep).join("/"),
    totals: { issues: issues.length, ...totalCounts, themes: themes.length },
    themes,
    issues,
  };
  await fs.writeFile(
    path.join(outDir, "periodical-index.js"),
    `// Generated by scripts/build-periodical-library.mjs\nwindow.IBALL_PERIODICAL_INDEX = ${safeJson(index)};\n`,
    "utf8",
  );

  const papers = issues.map((issue) => ({
    id: issue.id,
    label: issue.label,
    title: issue.title || issue.label,
    titleZh: issue.titleZh,
    theme: issue.theme,
    counts: issue.counts,
    file: issue.file,
  }));
  await fs.writeFile(
    path.join(outDir, "periodical-papers.js"),
    `// Generated by scripts/build-periodical-library.mjs\nwindow.IBALL_PERIODICAL_PAPERS = ${safeJson(papers)};\n`,
    "utf8",
  );

  log(
    `外刊库已生成：${issues.length} 期 / ${totalCounts.article} 篇文章 / ${totalCounts.question} 道检验题 / ${totalCounts.original} 份原件`,
  );
  log(`主题：${themes.map((theme) => `${theme.name}(${theme.count})`).join("、") || "无"}`);
}

await main();
