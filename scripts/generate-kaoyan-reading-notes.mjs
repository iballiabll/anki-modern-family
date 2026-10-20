#!/usr/bin/env node
/**
 * 考研英语阅读整段参考译文生成脚本。
 *
 * 为 kaoyan-data/<track>-<year>.js 里每个阅读 Text 的每一段生成「整段中文
 * 参考译文初稿」，写入 kaoyan-reading-notes/<track>-<year>.json，再由
 * scripts/build-kaoyan-library.mjs 合并进站点数据。
 *
 * 口径：
 * - 译文来自公开机器翻译接口（有道智云 demo 接口）的初稿，属于非官方学习
 *   材料，页面必须标注「机器初稿」，不能冒充官方译文或人工精校译文。
 * - 只翻译站点已有的真题语料，不复制任何第三方仓库的译文或解析文本。
 * - 支持断点续传：原文 hash 未变的段落不会重复请求，可随时中断重跑。
 *
 * 用法：
 *   node scripts/generate-kaoyan-reading-notes.mjs                     # 全量补齐
 *   node scripts/generate-kaoyan-reading-notes.mjs --track english-i --year 2010
 *   node scripts/generate-kaoyan-reading-notes.mjs --limit 8 --dry-run
 *   node scripts/generate-kaoyan-reading-notes.mjs --force --concurrency 2
 *
 * 参数：
 *   --track <english-i|english-ii>  只处理某一科
 *   --year <2010>                   只处理某一年
 *   --years <2010-2026>             处理年份区间
 *   --limit <n>                     本次最多新翻多少段（已缓存的段落不算）
 *   --concurrency <n>               并发请求数，默认 2
 *   --interval <ms>                 两次请求之间的最小间隔，默认 350
 *   --force                         忽略缓存，重翻所有段落
 *   --dry-run                       只输出待翻译统计，不发请求
 *   --out <dir>                     输出目录，默认 kaoyan-reading-notes
 *   --export <file>                 只导出待翻译清单（JSON），不发请求
 *   --import <file>                 导入外部译文结果（JSON），再补翻剩余段落
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = path.join(root, "kaoyan-data");
const outRoot = path.resolve(root, arg("out", "kaoyan-reading-notes"));
const provider = "youdao-aidemo";
const endpoint = "https://aidemo.youdao.com/trans";
const maxChunkLength = 1500;

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const options = {
  track: arg("track", ""),
  year: arg("year", ""),
  years: arg("years", ""),
  limit: Number(arg("limit", "0")) || 0,
  concurrency: Math.max(1, Math.min(6, Number(arg("concurrency", "2")) || 2)),
  interval: Math.max(0, Number(arg("interval", "1200")) || 0),
  retries: Math.max(1, Math.min(8, Number(arg("retries", "5")) || 5)),
  force: hasFlag("force"),
  dryRun: hasFlag("dry-run"),
  exportFile: arg("export", ""),
  importFile: arg("import", ""),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collapse(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function hashText(text) {
  return crypto.createHash("sha1").update(String(text || "")).digest("hex").slice(0, 16);
}

function yearList() {
  if (options.year) {
    return [Number(options.year)].filter(Number.isFinite);
  }
  if (options.years) {
    const [start, end] = options.years.split("-").map(Number);
    const last = Number.isFinite(end) ? end : start;
    const years = [];
    for (let year = start; year <= last; year += 1) {
      years.push(year);
    }
    return years;
  }
  return [];
}

/** 按句末标点把超长段落切成接口可以接受的块，避免 GET 参数过长。 */
function splitForRequest(text, maxLength = maxChunkLength) {
  const source = collapse(text);
  if (source.length <= maxLength) {
    return [source];
  }
  const pieces = source
    .split(/(?<=[.!?。！？])\s+/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";
  const push = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };
  pieces.forEach((piece) => {
    if (piece.length > maxLength) {
      push();
      for (let index = 0; index < piece.length; index += maxLength) {
        chunks.push(piece.slice(index, index + maxLength));
      }
      return;
    }
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length > maxLength) {
      push();
      current = piece;
      return;
    }
    current = candidate;
  });
  push();
  return chunks;
}

async function requestYoudao(text) {
  const url = new URL(endpoint);
  url.searchParams.set("q", text);
  url.searchParams.set("from", "en");
  url.searchParams.set("to", "zh-CHS");
  const response = await fetch(url, {
    headers: { "user-agent": "iball-site-reading-notes/1.0" },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  const code = String(payload?.errorCode ?? "0");
  if (code && code !== "0") {
    const error = new Error(`errorCode ${code}`);
    if (code === "411" || code === "429") {
      error.rateLimited = true;
    }
    throw error;
  }
  const parts = Array.isArray(payload?.translation)
    ? payload.translation
    : [payload?.translation || ""];
  const translated = collapse(decodeEntities(parts.map((item) => String(item || "")).join("")));
  if (!translated) {
    throw new Error("接口返回空译文");
  }
  return translated;
}

let gate = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;

function markRateLimited(ms) {
  cooldownUntil = Math.max(cooldownUntil, Date.now() + ms);
}

/** 串行放行请求，让两次请求之间至少间隔 options.interval 毫秒。 */
async function acquireSlot() {
  let release = () => {};
  const previous = gate;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  const cooldown = cooldownUntil - Date.now();
  if (cooldown > 0) {
    await sleep(cooldown);
  }
  const wait = lastRequestAt + options.interval - Date.now();
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
  release();
}

async function translateParagraph(text) {
  const chunks = splitForRequest(text);
  const parts = [];
  for (const chunk of chunks) {
    let lastError = null;
    for (let attempt = 1; attempt <= options.retries; attempt += 1) {
      await acquireSlot();
      try {
        parts.push(await requestYoudao(chunk));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (error?.rateLimited) {
          markRateLimited(60000);
        }
        if (attempt < options.retries) {
          const backoff = error?.rateLimited
            ? 20000 * attempt * attempt
            : 800 * attempt * attempt;
          await sleep(backoff);
        }
      }
    }
    if (lastError) {
      throw lastError;
    }
  }
  return parts.join("");
}

function loadPaper(fileName) {
  const filePath = path.join(dataRoot, fileName);
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(filePath, "utf8"), sandbox, { filename: filePath });
  const id = fileName.replace(/\.js$/, "");
  return sandbox.window.IBALL_KAOYAN_LIBRARY?.[id] || null;
}

async function readNotes(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeNotes(filePath, notes) {
  notes.generatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
}

function emptyNotes(paper) {
  return {
    id: paper.id,
    track: paper.track,
    year: paper.year,
    provider,
    note: "整段参考译文为公开机器翻译接口生成的初稿，非官方译文，仅用于对照理解。",
    generatedAt: new Date().toISOString(),
    sections: {},
  };
}

function normalizeNotes(notes, paper) {
  const normalized = notes && typeof notes === "object" ? notes : emptyNotes(paper);
  if (!normalized.id) {
    normalized.id = paper.id;
  }
  if (
    !normalized.sections ||
    typeof normalized.sections !== "object" ||
    Array.isArray(normalized.sections)
  ) {
    normalized.sections = {};
  }
  return normalized;
}

function summarizeNotesProvider(notes) {
  const providers = new Set();
  for (const section of Object.values(notes.sections || {})) {
    const paragraphs = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
    for (const item of paragraphs) {
      if (item && String(item.zh || "").trim() && item.provider) {
        providers.add(String(item.provider));
      }
    }
  }
  if (providers.size === 1) {
    return [...providers][0];
  }
  return providers.size > 1 ? "mixed-public-mt" : notes.provider || provider;
}

function listPapers() {
  const years = yearList();
  return fs.readdir(dataRoot).then((entries) =>
    entries
      .filter((name) => /^english-(i|ii)-\d{4}\.js$/.test(name))
      .filter((name) => !options.track || name.startsWith(`${options.track}-`))
      .filter((name) => {
        if (!years.length) {
          return true;
        }
        return years.includes(Number(name.match(/-(\d{4})\.js$/)[1]));
      })
      .sort(),
  );
}

async function runPool(tasks, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor];
        cursor += 1;
        await worker(task);
      }
    },
  );
  await Promise.all(workers);
}

async function main() {
  const files = await listPapers();
  if (!files.length) {
    console.error("没有找到匹配的 kaoyan-data 试卷文件，请先运行 scripts/build-kaoyan-library.mjs。");
    process.exitCode = 1;
    return;
  }

  const papers = [];
  for (const fileName of files) {
    const paper = loadPaper(fileName);
    if (!paper) {
      console.warn(`跳过 ${fileName}：未能读取试卷数据`);
      continue;
    }
    const notesPath = path.join(outRoot, `${paper.id}.json`);
    const notes = normalizeNotes(await readNotes(notesPath), paper);
    papers.push({ paper, notes, notesPath, fileName, saving: Promise.resolve() });
  }

  const buildTasks = () => {
    const tasks = [];
    for (const entry of papers) {
      const sections = (entry.paper.sections || []).filter(
        (section) => section.kind === "reading" && (section.paragraphs || []).length,
      );
      for (const section of sections) {
        const stored = entry.notes.sections?.[section.section] || {};
        const paragraphs = Array.isArray(stored.paragraphs) ? stored.paragraphs : [];
        section.paragraphs.forEach((text, index) => {
          const source = collapse(text);
          const hash = hashText(source);
          const cached = paragraphs[index];
          const reusable =
            !options.force && cached && cached.hash === hash && String(cached.zh || "").trim();
          tasks.push({
            entry,
            section,
            index,
            source,
            hash,
            cached,
            reusable,
            key: `${entry.paper.id}|${section.section}|${index}`,
          });
        });
      }
    }
    return tasks;
  };

  const saveEntry = async (entry) => {
    entry.saving = entry.saving.then(() => writeNotes(entry.notesPath, entry.notes));
    return entry.saving;
  };

  const tasks = [];
  tasks.push(...buildTasks());

  const pending = tasks.filter((task) => !task.reusable);

  if (options.exportFile) {
    const payload = {
      provider: arg("provider", "google-vps"),
      generatedAt: new Date().toISOString(),
      count: pending.length,
      paragraphs: pending.map((task) => ({
        key: task.key,
        paperId: task.entry.paper.id,
        section: task.section.section,
        label: task.section.label,
        index: task.index,
        hash: task.hash,
        text: task.source,
      })),
    };
    const exportPath = path.resolve(root, options.exportFile);
    await fs.mkdir(path.dirname(exportPath), { recursive: true });
    await fs.writeFile(exportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`已导出 ${pending.length} 段待翻译文本：${exportPath}`);
    return;
  }

  if (options.importFile) {
    const importPath = path.resolve(root, options.importFile);
    const raw = JSON.parse(await fs.readFile(importPath, "utf8"));
    const results = raw?.results && typeof raw.results === "object" ? raw.results : {};
    const byKey = new Map(tasks.map((task) => [task.key, task]));
    let imported = 0;
    let skipped = 0;
    const touched = new Set();
    for (const [key, item] of Object.entries(results)) {
      const task = byKey.get(key);
      const zh = collapse(item?.zh || "");
      if (!task || !zh || (item?.hash && item.hash !== task.hash)) {
        skipped += 1;
        continue;
      }
      const bucket = task.entry.notes.sections?.[task.section.section] || {
        label: task.section.label,
        title: task.section.title,
        paragraphs: [],
      };
      task.entry.notes.sections[task.section.section] = bucket;
      bucket.label = task.section.label;
      bucket.title = task.section.title;
      if (!Array.isArray(bucket.paragraphs)) {
        bucket.paragraphs = [];
      }
      bucket.paragraphs[task.index] = {
        hash: task.hash,
        en: task.source,
        zh,
        provider: item?.provider || raw.provider || arg("provider", "google-vps"),
        generatedAt: new Date().toISOString(),
      };
      touched.add(task.entry);
      imported += 1;
    }
    for (const entry of touched) {
      entry.notes.provider = summarizeNotesProvider(entry.notes);
      if (!options.dryRun) {
        await saveEntry(entry);
      }
    }
    console.log(`已导入 ${imported} 段外部译文，忽略 ${skipped} 条过期或无法匹配的记录。`);
  }

  const remainingTasks = buildTasks().filter((task) => !task.reusable);
  console.log(
    `阅读段落 ${tasks.length} 段：已有可用译文 ${tasks.length - remainingTasks.length} 段，` +
      `本次待翻译 ${remainingTasks.length} 段（provider=${provider}，并发 ${options.concurrency}）。`,
  );
  if (options.dryRun) {
    remainingTasks.slice(0, 20).forEach((task) => {
      console.log(`- ${task.entry.paper.id} ${task.section.label} P${task.index + 1}`);
    });
    if (remainingTasks.length > 20) {
      console.log(`  ... 其余 ${remainingTasks.length - 20} 段省略`);
    }
    return;
  }

  const queue = options.limit ? remainingTasks.slice(0, options.limit) : remainingTasks;
  let done = 0;
  let failed = 0;

  await runPool(queue, options.concurrency, async (task) => {
    let zh = "";
    let errorMessage = "";
    try {
      zh = await translateParagraph(task.source);
    } catch (error) {
      errorMessage = error?.message || String(error);
    }
    done += 1;
    const bucket = task.entry.notes.sections?.[task.section.section] || {
      label: task.section.label,
      title: task.section.title,
      paragraphs: [],
    };
    task.entry.notes.sections[task.section.section] = bucket;
    bucket.label = task.section.label;
    bucket.title = task.section.title;
    if (!Array.isArray(bucket.paragraphs)) {
      bucket.paragraphs = [];
    }
    bucket.paragraphs[task.index] = zh
      ? {
          hash: task.hash,
          en: task.source,
          zh,
          provider,
          generatedAt: new Date().toISOString(),
        }
      : {
          hash: task.hash,
          en: task.source,
          error: errorMessage,
          attemptedAt: new Date().toISOString(),
        };
    if (!zh) {
      failed += 1;
    }
    await saveEntry(task.entry);
    const status = zh ? "ok" : `失败：${errorMessage}`;
    console.log(
      `[${done}/${queue.length}] ${task.entry.paper.id} ${task.section.label} P${task.index + 1} ${status}`,
    );
  });

  // 已缓存段落也要补写文件（例如旧文件缺少 label 时），保证结构完整。
  for (const entry of papers) {
    if (Object.keys(entry.notes.sections || {}).length) {
      await saveEntry(entry);
    }
  }

  const totalStored = papers.reduce(
    (sum, entry) =>
      sum +
      Object.values(entry.notes.sections || {}).reduce(
        (count, section) =>
          count +
          (section.paragraphs || []).filter((item) => String(item?.zh || "").trim()).length,
        0,
      ),
    0,
  );
  console.log(`本次完成 ${queue.length} 段，失败 ${failed} 段；缓存中现有译文 ${totalStored} 段。`);
  if (failed) {
    console.error("存在失败段落，重新运行同一命令即可续跑未完成部分。");
    process.exitCode = 1;
  }
  if (options.limit && remainingTasks.length > queue.length) {
    console.log(
      `本次受 --limit 限制还有 ${remainingTasks.length - queue.length} 段未翻译，可再次运行续跑。`,
    );
  }
}

await main();
