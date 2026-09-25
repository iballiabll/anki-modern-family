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

function readingPayload(entry) {
  const paragraphs = (entry.reading?.paragraphs || [])
    .map((block) => ({
      index: block.index,
      en: compact(block.en),
      zh: compact(block.zh),
    }))
    .filter((block) => block.en || block.zh);
  const vocab = (entry.reading?.vocab || [])
    .map((item) => ({
      term: compact(item.term),
      head: compact(item.head),
      definition: flatten(item.definition),
      gloss: flatten(item.gloss),
      example: flatten(item.example),
      exampleZh: flatten(item.exampleZh),
      tags: item.tags || [],
    }))
    .filter((item) => item.term);
  if (!paragraphs.length && !vocab.length) {
    return null;
  }
  return {
    file: entry.file,
    headline: entry.headline || {},
    paragraphs,
    vocab,
  };
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
      const payload = readingPayload(entry);
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
