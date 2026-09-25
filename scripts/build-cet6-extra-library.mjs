// Builds the 六级 翻译 (Part IV) 与 写作 (Part I) 精读库。
// Sources: /cet6/sections/{paperId}/{part-iv|part1}/
// Usage: node scripts/build-cet6-extra-library.mjs [paperId ...]
//        node scripts/build-cet6-extra-library.mjs --probe 2024-06-1
//        node scripts/build-cet6-extra-library.mjs --kind translation

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "cet6-extra-data");
const manifestPath = path.join(root, "cet6-extra-papers.js");
const cacheDir = path.join(root, ".cache", "cet6-extra-source");
const ORIGIN = "https://english-exam.lazynote.cn";
const USER_AGENT = "Mozilla/5.0 (compatible; iball-cabin cet6 builder)";
const MIN_YEAR = 2015;
const MAX_YEAR = 2026;

const KINDS = {
  translation: {
    key: "translation",
    label: "翻译",
    indexPage: "/cet6/sections/chinese-english-translation/",
    slug: "part-iv",
    slugIsPerPaper: false,
  },
  writing: {
    key: "writing",
    label: "写作",
    indexPage: "/cet6/sections/writing/",
    slug: "part1",
    slugIsPerPaper: true,
  },
};

const builtPapers = new Map();

/* ------------------------------------------------------------- helpers */

function decodeEntities(value) {
  return String(value || "")
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

function stripComments(value) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?template\b[^>]*>/gi, "");
}

function stripScripts(value) {
  return String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
}

// 行内文本：保留 <strong>/<span> 里的字，丢掉标签本身。
function cleanHtml(value) {
  return decodeEntities(
    stripComments(value)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|div|h[1-6])>/gi, "\n"),
  )
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0|\u2002|\u2003|\u2009|\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function inlineText(value) {
  return cleanHtml(value).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

// 从 startIndex 起，按同名标签配对切出完整元素，避免正则跨块误吞。
function sliceBalanced(html, startIndex, tagName) {
  const name = tagName.toLowerCase();
  const open = new RegExp(`<${name}\\b`, "gi");
  const close = new RegExp(`</${name}\\s*>`, "gi");
  open.lastIndex = startIndex;
  const firstOpen = open.exec(html);
  if (!firstOpen) {
    return "";
  }

  let depth = 0;
  let cursor = startIndex;
  while (cursor < html.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (!nextClose) {
      return html.slice(startIndex);
    }
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    cursor = nextClose.index + nextClose[0].length;
    if (depth <= 0) {
      return html.slice(startIndex, cursor);
    }
  }
  return html.slice(startIndex);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 按 class 取元素；className 支持 "a b" 这种多类同时命中的写法。
function blocksByClass(html, className) {
  const required = className.split(/\s+/).filter(Boolean);
  const pattern = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*class="([^"]*)"[^>]*>`,
    "gi",
  );
  const blocks = [];
  let match = pattern.exec(html);
  while (match) {
    const classes = match[2].split(/\s+/);
    if (required.every((name) => classes.includes(name))) {
      const block = sliceBalanced(html, match.index, match[1]);
      if (block) {
        blocks.push(block);
      }
      pattern.lastIndex = match.index + block.length;
    }
    match = pattern.exec(html);
  }
  return blocks;
}

function blockById(html, id) {
  const pattern = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) {
    return "";
  }
  return sliceBalanced(html, match.index, match[1]);
}

function firstBlockByIdPrefix(html, prefix) {
  const pattern = new RegExp(
    `<([a-z][a-z0-9]*)\\b[^>]*\\bid="${escapeRegExp(prefix)}[^"]*"[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  if (!match) {
    return "";
  }
  return sliceBalanced(html, match.index, match[1]);
}

function textOf(html, regex) {
  const match = regex.exec(html);
  return match ? inlineText(match[1]) : "";
}

function paragraphTexts(html) {
  const blocks = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [];
  return blocks.map((item) => inlineText(item)).filter(Boolean);
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

/* --------------------------------------------------------- translation */

function parseKeyedRows(block) {
  const rows = [];
  for (const row of blocksByClass(block, "rp-row")) {
    const label = textOf(
      row,
      /<span[^>]*class="[^"]*rp-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ).replace(/[【】]/g, "");
    if (!label) {
      continue;
    }
    const core = textOf(
      row,
      /<(?:strong|p)[^>]*class="[^"]*tp-core[^"]*"[^>]*>([\s\S]*?)<\/(?:strong|p)>/i,
    );
    const detail = textOf(
      row,
      /<span[^>]*class="[^"]*tp-detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const body = textOf(
      row,
      /<p[^>]*class="[^"]*rp-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    rows.push({ label, core, detail, body });
  }
  return rows;
}

function parseChunkList(block) {
  const chunks = [];
  for (const item of blocksByClass(block, "tqp-chunk")) {
    const core = textOf(
      item,
      /<strong[^>]*class="[^"]*tp-core[^"]*"[^>]*>([\s\S]*?)<\/strong>/i,
    );
    const detail = textOf(
      item,
      /<span[^>]*class="[^"]*tp-detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (core || detail) {
      chunks.push({ core, detail });
    }
  }
  return chunks;
}

function parseTranslationPage(source, { paperId, url }) {
  const html = stripScripts(source);
  const directions = blockById(html, "directions");
  const referenceBlock = blockById(html, "translation");
  const reference = inlineText(
    textOf(
      referenceBlock,
      /<div[^>]*class="[^"]*tp-para[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ),
  );

  const cohesion = [];
  const cohesionBlock = blockById(html, "cohesion");
  for (const item of cohesionBlock.match(/<li\b[\s\S]*?<\/li>/gi) || []) {
    const core = textOf(
      item,
      /<strong[^>]*class="[^"]*tp-core[^"]*"[^>]*>([\s\S]*?)<\/strong>/i,
    );
    const detail = textOf(
      item,
      /<span[^>]*class="[^"]*tp-detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (core || detail) {
      cohesion.push({ core, detail });
    }
  }

  // 专名·文化词与通读建境都在 #parsing 的 #global 块里，按 rp-row 标签取用。
  const parsingHead = blockById(html, "parsing");
  const globalBlock = parsingHead ? blockById(parsingHead, "global") : "";
  let terms = [];
  const globalNotes = [];
  for (const row of blocksByClass(globalBlock, "rp-row")) {
    const label = textOf(
      row,
      /<span[^>]*class="[^"]*rp-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ).replace(/[【】]/g, "");
    const chunks = parseChunkList(row);
    if (chunks.length) {
      terms = terms.concat(chunks);
      continue;
    }
    const core = textOf(
      row,
      /<strong[^>]*class="[^"]*tp-core[^"]*"[^>]*>([\s\S]*?)<\/strong>/i,
    );
    const body = textOf(
      row,
      /<p[^>]*class="[^"]*rp-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    if (label && (core || body)) {
      globalNotes.push({ label, core, detail: body });
    }
  }

  const sentences = [];
  for (const unit of blocksByClass(html, "tqp-unit")) {
    const numberMatch = /id="s-(\d+)"/i.exec(unit);
    const stem = textOf(
      unit,
      /<p[^>]*class="[^"]*tqp-stem[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    const finalText = textOf(
      unit,
      /<p[^>]*class="[^"]*tqp-final[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    const steps = [];
    for (const row of blocksByClass(unit, "rp-row")) {
      const label = textOf(
        row,
        /<span[^>]*class="[^"]*rp-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      ).replace(/[【】]/g, "");
      if (!label || label === "译文") {
        continue;
      }
      const core = textOf(
        row,
        /<strong[^>]*class="[^"]*tp-core[^"]*"[^>]*>([\s\S]*?)<\/strong>/i,
      );
      const detail = textOf(
        row,
        /<span[^>]*class="[^"]*tp-detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      );
      const body = textOf(
        row,
        /<p[^>]*class="[^"]*rp-text[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
      );
      const chunks = parseChunkList(row);
      if (core || detail || body || chunks.length) {
        steps.push({ label, core, detail: detail || body, chunks });
      }
    }
    const chinese = stem.replace(/^\d+[.、]\s*/, "").trim();
    if (!chinese) {
      continue;
    }
    sentences.push({
      number: numberMatch ? Number.parseInt(numberMatch[1], 10) : sentences.length + 1,
      chinese,
      reference: finalText,
      steps,
    });
  }

  if (!sentences.length || !reference) {
    throw new Error(
      `${paperId}/translation: extracted ${sentences.length} sentence(s), reference=${reference ? "yes" : "no"}`,
    );
  }

  return {
    kind: "translation",
    part: "Part IV",
    title: `${paperId} 汉译英（段落翻译）`,
    directions: inlineText(directions),
    chinese: sentences.map((item) => item.chinese).join(""),
    reference,
    cohesion,
    terms,
    globalNotes,
    sentences,
    sentenceCount: sentences.length,
    sourceUrl: url,
  };
}

/* ------------------------------------------------------------- writing */

function parseFactBlock(block) {
  const facts = [];
  for (const item of blocksByClass(block, "wf-fact")) {
    const label = textOf(
      item,
      /<span[^>]*class="[^"]*wf-fact__label[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const core = textOf(
      item,
      /<p[^>]*class="[^"]*wf-fact__core[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    const detail = textOf(
      item,
      /<p[^>]*class="[^"]*wf-fact__detail[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    );
    if (label || core) {
      facts.push({ label, core, detail });
    }
  }
  return facts;
}

function parsePointBlock(block) {
  const points = [];
  for (const item of blocksByClass(block, "wf-points__item")) {
    const label = textOf(
      item,
      /<span[^>]*class="[^"]*wf-points__label[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const core = textOf(
      item,
      /<span[^>]*class="[^"]*wf-points__core[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const detail = textOf(
      item,
      /<span[^>]*class="[^"]*wf-points__detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (core || detail) {
      points.push({ label, core, detail });
    }
  }
  return points;
}

function parseWritingPage(source, { paperId, url }) {
  const html = stripScripts(source);
  const directions = blockById(html, "directions");
  const essayBlock = blockById(html, "essay");
  const essay = paragraphTexts(essayBlock);
  const essayTranslation = blocksByClass(html, "wp-trans__para").map(inlineText);

  const outline = [];
  for (const item of blocksByClass(html, "w-outline__item")) {
    const no = textOf(
      item,
      /<span[^>]*class="[^"]*w-outline__no[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const core = textOf(
      item,
      /<span[^>]*class="[^"]*w-outline__core[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const detail = textOf(
      item,
      /<span[^>]*class="[^"]*w-outline__detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (no || core) {
      outline.push({ no, core, detail });
    }
  }

  const breakdown = [];
  for (const item of blocksByClass(html, "wp-breakdown__item")) {
    const tag = textOf(
      item,
      /<span[^>]*class="[^"]*wp-tag[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    ).replace(/[【】]/g, "");
    const core = textOf(
      item,
      /<span[^>]*class="[^"]*wp-breakdown__core[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const detail = inlineText(item.replace(/<span[^>]*class="[^"]*wp-tag[^"]*"[\s\S]*?<\/span>/i, "")
      .replace(/<span[^>]*class="[^"]*wp-breakdown__core[^"]*"[\s\S]*?<\/span>/i, ""));
    if (tag || core) {
      breakdown.push({ tag, core, detail });
    }
  }

  const rubric = [];
  for (const item of blocksByClass(html, "rubric__item")) {
    const dim = textOf(
      item,
      /<span[^>]*class="[^"]*rubric__dim[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const core = textOf(
      item,
      /<span[^>]*class="[^"]*rubric__core[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const detail = textOf(
      item,
      /<span[^>]*class="[^"]*rubric__detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (dim || core) {
      rubric.push({ dim, core, detail });
    }
  }

  const pitfalls = [];
  for (const item of blocksByClass(html, "pitfalls__item")) {
    const core = textOf(
      item,
      /<span[^>]*class="[^"]*pitfalls__core[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    const detail = textOf(
      item,
      /<span[^>]*class="[^"]*pitfalls__detail[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (core || detail) {
      pitfalls.push({ core, detail });
    }
  }

  const analysis = firstBlockByIdPrefix(html, "analysis");
  const facts = parseFactBlock(analysis || html);
  const pointsBlock = html.slice(
    html.indexOf('<div class="wf-points"') >= 0
      ? html.indexOf('<div class="wf-points"')
      : 0,
  );
  const points = parsePointBlock(pointsBlock);

  if (!essay.length && !outline.length) {
    throw new Error(`${paperId}/writing: nothing extracted`);
  }

  return {
    kind: "writing",
    part: "Part I",
    title: `${paperId} 写作（Part I）`,
    directions: inlineText(directions),
    facts,
    points,
    outline,
    essay,
    essayTranslation,
    breakdown,
    rubric,
    pitfalls,
    wordCount: essay.join(" ").split(/\s+/).filter(Boolean).length,
    sourceUrl: url,
  };
}

/* ----------------------------------------------------------- discovery */

async function discoverPapers() {
  const map = new Map();
  const ensure = (paperId) => {
    if (!map.has(paperId)) {
      map.set(paperId, { translation: "", writing: "" });
    }
    return map.get(paperId);
  };

  for (const kind of Object.values(KINDS)) {
    let html = "";
    try {
      html = await fetchPage(`${ORIGIN}${kind.indexPage}`);
    } catch (error) {
      console.warn(`Index ${kind.indexPage} unavailable: ${error.message}`);
      continue;
    }
    const pattern = new RegExp(
      `\\/cet6\\/sections\\/(\\d{4}-\\d{2}-\\d+)\\/([a-z0-9-]+)\\/`,
      "g",
    );
    for (const match of html.matchAll(pattern)) {
      const paperId = match[1];
      const slug = match[2];
      const { year } = parsePaperId(paperId);
      if (year < MIN_YEAR || year > MAX_YEAR) {
        continue;
      }
      if (slug !== kind.slug) {
        continue;
      }
      ensure(paperId)[kind.key] = slug;
    }
  }

  return [...map.entries()]
    .map(([id, slugs]) => ({ id, ...slugs }))
    .sort((left, right) => right.id.localeCompare(left.id));
}

/* --------------------------------------------------------------- build */

async function buildPaper(paper, { useCache }) {
  const { year, month, set } = parsePaperId(paper.id);
  const bundle = {
    meta: {
      id: paper.id,
      label: `${year} 年 ${month} 月 · 第 ${set} 套`,
      title: `${year} 年 ${month} 月六级翻译与写作第 ${set} 套`,
      year,
      month,
      set,
      generatedAt: new Date().toISOString().slice(0, 10),
      sourceUrl: `${ORIGIN}/cet6/`,
    },
    translation: null,
    writing: null,
  };
  const missing = [];

  for (const kind of Object.values(KINDS)) {
    const slug = paper[kind.key];
    if (!slug) {
      missing.push(kind.label);
      continue;
    }
    const url = `${ORIGIN}/cet6/sections/${paper.id}/${slug}/`;
    if (!useCache) {
      await fs.rm(cachePathFor(url), { force: true });
    }
    try {
      const source = await fetchPage(url, { useCache });
      bundle[kind.key] =
        kind.key === "translation"
          ? parseTranslationPage(source, { paperId: paper.id, url })
          : parseWritingPage(source, { paperId: paper.id, url });
    } catch (error) {
      missing.push(kind.label);
      console.warn(`  skip ${paper.id}/${kind.key}: ${error.message}`);
    }
    await sleep(80);
  }

  bundle.meta.missing = missing;
  if (!bundle.translation && !bundle.writing) {
    throw new Error(`${paper.id}: no translation or writing extracted`);
  }

  const output = `// Generated by scripts/build-cet6-extra-library.mjs from public CET-6 study pages.\n(window.IBALL_CET6_EXTRA_LIBRARY = window.IBALL_CET6_EXTRA_LIBRARY || {})[${JSON.stringify(
    paper.id,
  )}] = ${JSON.stringify(bundle, null, 2)};\n`;
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, `${paper.id}.js`), output, "utf8");
  builtPapers.set(paper.id, bundle);

  return {
    id: paper.id,
    label: bundle.meta.label,
    year,
    month,
    set,
    file: `./cet6-extra-data/${paper.id}.js`,
    title: bundle.meta.title,
    missing,
    hasTranslation: Boolean(bundle.translation),
    hasWriting: Boolean(bundle.writing),
    sentenceCount: bundle.translation?.sentenceCount || 0,
    essayParagraphs: bundle.writing?.essay.length || 0,
  };
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
const kindIndex = args.indexOf("--kind");
let kindFilter = "";
if (kindIndex !== -1) {
  kindFilter = args[kindIndex + 1];
  args.splice(kindIndex, 2);
  if (!KINDS[kindFilter]) {
    console.error(`Unknown --kind ${kindFilter}`);
    process.exit(1);
  }
}
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

console.log(`Building ${papers.length} CET-6 translation/writing paper(s)...`);

const summary = [];
const entries = await mapLimit(papers, 3, async (paper) => {
  try {
    const entry = await buildPaper(paper, { useCache: !noCache });
    console.log(
      `${entry.id}: translation=${entry.hasTranslation ? entry.sentenceCount : "—"} writing=${entry.hasWriting ? entry.essayParagraphs : "—"}${entry.missing.length ? ` missing=${entry.missing.join("/")}` : ""}`,
    );
    return entry;
  } catch (error) {
    console.error(`${paper.id}: ${error.message}`);
    return null;
  }
});

entries.filter(Boolean).forEach((entry) => summary.push(entry));

if (!summary.length) {
  console.error("No papers were built.");
  process.exit(1);
}

if (probe) {
  const sample = builtPapers.get(summary[0].id);
  console.log(JSON.stringify(sample, null, 2).slice(0, 8000));
}

summary.sort((left, right) => right.id.localeCompare(left.id));
const manifest = `// Generated by scripts/build-cet6-extra-library.mjs\nwindow.IBALL_CET6_EXTRA_PAPERS = ${JSON.stringify(
  summary,
  null,
  2,
)};\n`;

if (!requested.length) {
  await fs.writeFile(manifestPath, manifest, "utf8");
  console.log(
    `\nWrote ${summary.length} papers to ${path.relative(root, outputDir)} and updated cet6-extra-papers.js.`,
  );
} else {
  console.log(`\nWrote ${summary.length} paper file(s). Manifest left untouched.`);
}
