/**
 * 浏览器验收脚本：用系统 Chrome 打开本地 dev server 的页面，
 * 收集控制台错误、截图，并对关键交互做断言。
 *
 * 用法：
 *   node scripts/verify-browser.mjs --base http://127.0.0.1:4175 --out ../verify-shots
 *
 * 依赖随 Codex 运行时附带的 playwright-core，浏览器用系统已安装的 Chrome，
 * 因此不需要额外下载 Chromium。
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

async function capture(browser, { base, out, name, url, viewport, actions }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    errors.push(`requestfailed: ${request.url()} ${failure?.errorText || ""}`);
  });

  await page.goto(`${base}${url}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(600);

  const notes = [];
  const checks = [];
  if (actions) {
    await actions({ page, notes, errors, checks, requests });
  }

  const shot = path.join(out, `${name}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  const metrics = await page.evaluate(() => ({
    title: document.title,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyText: document.body.innerText.slice(0, 180).replace(/\s+/g, " "),
  }));
  await context.close();
  return { name, url, errors, notes, checks, shot, metrics, requests };
}

async function main() {
  const base = arg("base", "http://127.0.0.1:4175");
  const out = path.resolve(arg("out", "../verify-shots"));
  await fs.mkdir(out, { recursive: true });
  const executablePath = await findBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });

  const results = [];
  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 390, height: 844 };

  results.push(
    await capture(browser, {
      base,
      out,
      name: "periodical-desktop",
      url: "/periodical.html",
      viewport: desktop,
      actions: async ({ page, notes, checks, requests }) => {
        const dataFiles = () =>
          [...new Set(requests.filter((url) => url.includes("/periodical-data/")))].map(
            (url) => url.split("/periodical-data/")[1],
          );
        const initial = dataFiles();
        checks.push({
          name: "首屏不做全量加载",
          ok: initial.length > 0 && initial.length <= 3,
          detail: `${initial.length} 份: ${initial.join(", ") || "(无)"}`,
        });

        const issueCards = await page.locator(".periodical-issue-button").count();
        checks.push({
          name: "时间轴渲染期号卡片",
          ok: issueCards > 0,
          detail: `${issueCards} 张卡片`,
        });

        // 检验题：切标签后应能看到题干，并可通过按钮显示答案。
        const tab = page.getByRole("button", { name: /^检验题|检测题/ }).first();
        if (await tab.count()) {
          await tab.click();
          await page.waitForTimeout(500);
        }
        const questionCount = await page.locator(".periodical-question").count();
        checks.push({
          name: "检验题可见",
          ok: questionCount > 0,
          detail: `${questionCount} 道题`,
        });
        const answerButton = page.locator("#answerToggleButton");
        if (await answerButton.count()) {
          await answerButton.click();
          await page.waitForTimeout(500);
          const revealed = await page.locator(".periodical-answer-row").count();
          checks.push({
            name: "答案开关生效",
            ok: revealed > 0,
            detail: `${revealed} 处答案节点`,
          });
        } else {
          checks.push({ name: "答案开关存在", ok: false, detail: "未找到按钮" });
        }

        // 精读：点单词应弹释义并计入「我的生词」。
        const backTab = page.getByRole("button", { name: /^精读/ }).first();
        if (await backTab.count()) {
          await backTab.click();
          await page.waitForTimeout(400);
        }
        const word = page.locator(".word-token").first();
        if (await word.count()) {
          const before = await page.locator("#markSummaryButton").innerText().catch(() => "");
          await word.click();
          await page.waitForTimeout(400);
          const markUnknown = page.locator("#markUnknownButton");
          if (await markUnknown.count()) {
            await markUnknown.click();
            await page.waitForTimeout(300);
          }
          const after = await page.locator("#markSummaryButton").innerText().catch(() => "");
          const popover = await page.locator("#wordPanel:not([hidden])").count();
          checks.push({
            name: "点词弹释义",
            ok: popover > 0,
            detail: `弹层 ${popover} 个`,
          });
          checks.push({
            name: "标记不会后生词计数更新",
            ok: before !== after,
            detail: `${before.trim() || "(空)"} -> ${after.trim() || "(空)"}`,
          });
        } else {
          checks.push({ name: "存在可点单词", ok: false, detail: "未找到单词节点" });
        }

        // 原件：应至少有 PDF/DOCX 链接。
        const originals = await page.locator('a[href$=".pdf"], a[href*=".pdf"], a[href*=".docx"]').count();
        checks.push({
          name: "原件链接存在",
          ok: originals > 0,
          detail: `${originals} 个下载入口`,
        });

        // 切换期号只应新增一份数据文件。
        const select = page.locator("#issueSelect");
        if (await select.count()) {
          const options = await select.locator("option").evaluateAll((nodes) =>
            nodes.map((node) => node.value).filter(Boolean),
          );
          if (options.length > 1) {
            await select.selectOption(options[1]);
            await page.waitForTimeout(900);
            const after = dataFiles();
            checks.push({
              name: "切期后仍按需加载",
              ok: after.length <= 4 && after.length >= initial.length,
              detail: `${initial.length} -> ${after.length} 份: ${after.join(", ")}`,
            });
          }
        }
        notes.push(`数据文件请求: ${dataFiles().join(", ")}`);
      },
    }),
  );

  results.push(
    await capture(browser, {
      base,
      out,
      name: "periodical-mobile",
      url: "/periodical.html",
      viewport: mobile,
    }),
  );

  for (const [name, url] of [
    ["index-desktop", "/index.html"],
    ["kaoyan-desktop", "/kaoyan.html"],
    ["cet6-desktop", "/cet6.html"],
  ]) {
    results.push(
      await capture(browser, {
        base,
        out,
        name,
        url,
        viewport: desktop,
      }),
    );
  }

  await browser.close();

  let failed = 0;
  for (const result of results) {
    const overflow = result.metrics.scrollWidth > result.metrics.clientWidth + 1;
    const failedChecks = result.checks.filter((check) => !check.ok);
    if (result.errors.length || overflow || failedChecks.length) {
      failed += 1;
    }
    console.log(`\n== ${result.name} (${result.url})`);
    console.log(`   标题: ${result.metrics.title}`);
    console.log(
      `   宽度: scrollWidth=${result.metrics.scrollWidth} clientWidth=${result.metrics.clientWidth}${overflow ? "  <-- 横向溢出" : ""}`,
    );
    console.log(`   截图: ${result.shot}`);
    for (const note of result.notes) {
      console.log(`   · ${note}`);
    }
    for (const check of result.checks) {
      console.log(`   ${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    }
    for (const error of result.errors.slice(0, 6)) {
      console.log(`   ! ${error}`);
    }
  }
  console.log(`\n合计 ${results.length} 页，异常 ${failed} 页`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
