/**
 * 词库索引延后加载的验收关卡。
 *
 * 电影页的“考试词标记”和“本句词汇”依赖 vocab-index.json（约 1.3MB）和
 * collocation-index.json（约 280KB）。这两个索引被挪到了浏览器空闲时段再拉，
 * 好处是首屏先出台词，风险是拉不回来或拉完了没人重渲染。
 *
 * 本脚本检查的就是后半句：等空闲加载跑完，标记和本句词汇必须真的出现，
 * 且过程中没有报错。顺带打印索引到位与首屏渲染的时间差，方便看加载策略效果。
 *
 * 用法：
 *   node scripts/verify-movie-indexes.mjs --base http://127.0.0.1:4175
 *   node scripts/verify-movie-indexes.mjs --base https://www.iball.top --episode S01E24
 *
 * 依赖随 Codex 运行时附带的 playwright-core 与系统 Chrome，不需要额外下载。
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const RUNTIME_MODULES =
  process.env.CODEX_PLAYWRIGHT_MODULES ||
  "C:/Users/iball/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const require = createRequire(path.join(RUNTIME_MODULES, "index.js"));
const { chromium } = require("playwright-core");

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error("找不到 Chrome/Edge 可执行文件");
}

const base = arg("base", "http://127.0.0.1:4175").replace(/\/+$/, "");
const episode = arg("episode", "S01E24").toUpperCase();
const settleMs = Number(arg("settle", "15000"));

const browser = await chromium.launch({
  executablePath: await findBrowser(),
  headless: true,
});

const failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const indexArrivals = {};
  const startedAt = Date.now();
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    const name = response.url().split("/").pop();
    if (name === "vocab-index.json" || name === "collocation-index.json") {
      if (indexArrivals[name] === undefined) {
        indexArrivals[name] = Date.now() - startedAt;
      }
    }
  });

  await page.goto(`${base}/movie.html`, { waitUntil: "load", timeout: 90000 });
  const loadMs = await page.evaluate(
    () => Math.round(performance.getEntriesByType("navigation")[0]?.loadEventEnd || 0),
  );

  const labels = await page.locator("#episodeSelect option").allTextContents();
  const label = labels.find((text) => text.includes(episode));
  if (!label) {
    throw new Error(`剧集下拉里没有 ${episode}`);
  }
  await page.selectOption("#episodeSelect", { label });

  // 空闲加载有 2500ms 的超时兜底，加上 1.6MB 索引的解析，留足时间再断言。
  await page.waitForTimeout(settleMs);

  const stats = await page.evaluate(() => ({
    segments: document.querySelectorAll(".movie-line").length,
    playButtons: document.querySelectorAll(".movie-play-button").length,
    sentenceVocabBlocks: document.querySelectorAll(".movie-sentence-vocab").length,
    markedTokens: document.querySelectorAll(".word-token[data-levels]").length,
    totalTokens: document.querySelectorAll(".word-token").length,
  }));

  if (!stats.segments || !stats.playButtons) {
    failures.push("台词正文没有渲染出来");
  }
  if (!stats.sentenceVocabBlocks) {
    failures.push("空闲加载跑完后仍然没有“本句词汇”块，索引可能没拉回来");
  }
  if (!stats.markedTokens) {
    failures.push("空闲加载跑完后没有任何带考试词标记的单词");
  }
  if (consoleErrors.length) {
    failures.push(`页面报错：${consoleErrors.slice(0, 3).join(" | ")}`);
  }

  console.log(`${episode}  首屏 load=${loadMs}ms`);
  console.log(
    `  segments=${stats.segments} 逐句按钮=${stats.playButtons} ` +
      `本句词汇块=${stats.sentenceVocabBlocks} ` +
      `考试词标记=${stats.markedTokens}/${stats.totalTokens}`,
  );
  Object.entries(indexArrivals).forEach(([name, end]) => {
    console.log(`  ${name} 到位=${end === null ? "未知" : `${Math.round(end)}ms`}`);
  });

  await context.close();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\n不合格：");
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}
console.log("\n索引延后加载：合格");
