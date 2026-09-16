import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = process.argv[2];
const outputPath = path.join(root, "intensive-data.js");

if (!sourcePath) {
  console.error(
    "Usage: node scripts/build-intensive-data.mjs <cet4-listening-source.html>",
  );
  process.exit(1);
}

const pieceMetadata = new Map([
  [
    1,
    {
      section: "Section A",
      type: "短篇新闻",
      title: "含糖饮料与健康风险",
      questionRange: "Questions 1–2",
    },
  ],
  [
    3,
    {
      section: "Section A",
      type: "短篇新闻",
      title: "垃圾堆中找回的 17 世纪名画",
      questionRange: "Questions 3–4",
    },
  ],
  [
    5,
    {
      section: "Section A",
      type: "短篇新闻",
      title: "四岁女孩雪地求助",
      questionRange: "Questions 5–7",
    },
  ],
  [
    8,
    {
      section: "Section B",
      type: "长对话",
      title: "南非新朋友与橄榄球",
      questionRange: "Questions 8–11",
    },
  ],
  [
    12,
    {
      section: "Section B",
      type: "长对话",
      title: "学习方法与学习指南",
      questionRange: "Questions 12–15",
    },
  ],
  [
    16,
    {
      section: "Section C",
      type: "听力篇章",
      title: "黄金法则的边界",
      questionRange: "Questions 16–18",
    },
  ],
  [
    19,
    {
      section: "Section C",
      type: "听力篇章",
      title: "职场多元化为何效果有限",
      questionRange: "Questions 19–21",
    },
  ],
  [
    22,
    {
      section: "Section C",
      type: "听力篇章",
      title: "书面与口头沟通的文化差异",
      questionRange: "Questions 22–25",
    },
  ],
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
      .replace(
        /<span class="exam-pno[^"]*"[^>]*>[\s\S]*?<\/span>/gi,
        "",
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractParagraphs(chunk) {
  const paragraphs = [];
  const paragraphPattern =
    /<p id="p-(\d+)-(\d+)" class="lt-en"[^>]*>([\s\S]*?)<\/p>\s*<p class="lt-zh"[^>]*>([\s\S]*?)<\/p>/g;

  for (const match of chunk.matchAll(paragraphPattern)) {
    const paragraphNumber = Number.parseInt(match[2], 10);
    paragraphs.push({
      number: paragraphNumber,
      english: cleanHtml(match[3]),
      chinese: cleanHtml(match[4]),
    });
  }

  return paragraphs;
}

function extractGrammar(source) {
  const grammarItems = [];
  const itemPattern =
    /<li class="sdg__item" id="sdg-(\d+)"[\s\S]*?<\/li>/g;

  for (const match of source.matchAll(itemPattern)) {
    const item = match[0];
    const sourceQuestion = Number.parseInt(
      item.match(/data-pdh-piece="(\d+)"/)?.[1] || "0",
      10,
    );
    const paragraphMatch = item.match(/href="#p-(\d+)-(\d+)"/);
    const sentence = cleanHtml(
      item.match(/<span lang="en"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "",
    );
    const location = cleanHtml(
      item.match(/<span class="sdg__pos"[^>]*>([\s\S]*?)<\/span>/)?.[1] ||
        "",
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
      paragraphNumber: paragraphMatch
        ? Number.parseInt(paragraphMatch[2], 10)
        : null,
      location,
      sentence,
      explanation,
    });
  }

  return grammarItems;
}

function extractPieces(source, grammarItems) {
  const pieces = [];
  const piecePattern =
    /<div id="(lt-\d+)" class="lt-piece[\s\S]*?(?=<div id="lt-\d+" class="lt-piece|<\/main>)/g;

  for (const match of source.matchAll(piecePattern)) {
    const firstQuestion = Number.parseInt(
      match[1].replace("lt-", ""),
      10,
    );
    const metadata = pieceMetadata.get(firstQuestion);

    if (!metadata) {
      continue;
    }

    const paragraphs = extractParagraphs(match[0]);
    const pieceGrammar = grammarItems.filter(
      (item) => item.sourceQuestion === firstQuestion,
    );
    const grammarByParagraph = new Map();

    pieceGrammar.forEach((item) => {
      if (!item.paragraphNumber) {
        return;
      }
      const current = grammarByParagraph.get(item.paragraphNumber) || [];
      current.push(item);
      grammarByParagraph.set(item.paragraphNumber, current);
    });

    paragraphs.forEach((paragraph) => {
      paragraph.grammar = grammarByParagraph.get(paragraph.number) || [];
    });

    pieces.push({
      id: match[1],
      firstQuestion,
      ...metadata,
      paragraphs,
      extensionGrammar: pieceGrammar.filter(
        (item) => !item.paragraphNumber,
      ),
    });
  }

  return pieces.sort((left, right) => left.firstQuestion - right.firstQuestion);
}

const source = await fs.readFile(sourcePath, "utf8");
const grammarItems = extractGrammar(source);
const pieces = extractPieces(source, grammarItems);
const paragraphCount = pieces.reduce(
  (total, piece) => total + piece.paragraphs.length,
  0,
);

if (pieces.length !== 8 || paragraphCount < 50 || grammarItems.length < 40) {
  throw new Error(
    `Unexpected extraction result: ${pieces.length} pieces, ${paragraphCount} paragraphs, ${grammarItems.length} grammar items.`,
  );
}

const data = {
  meta: {
    title: "2022 年 6 月四级听力第 1 套",
    subtitle: "全文翻译与语法精读",
    sourceUrl:
      "https://english-exam.lazynote.cn/cet4/sections/listening/2022-06-1/",
    generatedAt: new Date().toISOString().slice(0, 10),
    pieceCount: pieces.length,
    paragraphCount,
    grammarCount: grammarItems.length,
  },
  pieces,
};

const output = `// Generated from the public CET4 listening study page.\nwindow.IBALL_INTENSIVE_DATA = ${JSON.stringify(
  data,
  null,
  2,
)};\n`;

await fs.writeFile(outputPath, output, "utf8");
console.log(
  `Generated intensive-data.js with ${pieces.length} pieces, ${paragraphCount} paragraphs and ${grammarItems.length} grammar notes.`,
);
