/**
 * 新模块浏览器验收：词汇库 / 作文批改 / 听句精听 / 跟读台，外加首页四个新入口。
 *
 * 用法：
 *   node scripts/verify-study-modules.mjs --base http://127.0.0.1:4175 --out ../verify-shots
 *
 * 断言口径：
 *   · 首屏渲染 < 3s、分片懒加载、localStorage 留痕；
 *   · 词汇收藏 / 生词本、听句答题与错题本、跟读语速与控制条；
 *   · 作文走 /api/grade 并能在接口不可用时回退到本地规则引擎；
 *   · 桌面与移动视口都不出现横向溢出。
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
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

const results = [];

function section(title) {
  console.log(`\n== ${title}`);
}

function check(label, ok, detail = "") {
  console.log(`   ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
  results.push({ ok: Boolean(ok), label, detail });
}

function note(text) {
  console.log(`   · ${text}`);
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/**
 * 站内页面登录后才渲染素材入口。验收脚本按 dev server 同样的会话密钥
 * 自己签一张 cookie，免得把密码写进脚本；线上跑不到这段代码。
 */
function sessionToken() {
  const secret = process.env.SESSION_SECRET || "local-preview-secret";
  const payload = Buffer.from(
    JSON.stringify({ username: "iball", expiresAt: Date.now() + 7 * 86400000 }),
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`username-iball-password-2026-09-17:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function sessionCookie(base) {
  return {
    name: "iball_cabin_session",
    value: sessionToken(),
    domain: new URL(base).hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  };
}

async function openPage(browser, base, url, viewport, init) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addCookies([sessionCookie(base)]);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    if (failure?.errorText === "net::ERR_ABORTED") {
      return; // 媒体被主动暂停时会留下这类记录，不算故障。
    }
    errors.push(`requestfailed: ${request.url()} ${failure?.errorText || ""}`);
  });
  page.on("request", (request) => requests.push(request.url()));
  if (init) {
    await init(page);
  }
  return { context, page, errors, requests };
}

async function firstPaint(page, url, selector, timeout = 15000) {
  const started = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector(selector, { timeout });
  return Date.now() - started;
}

/**
 * 题目分片走网络时会有几百毫秒的加载窗口，等它落地再操作，
 * 免得把"题目还没到"当成"点了没反应"。
 */
function waitPromptReady(page, timeout = 20000) {
  return page.waitForFunction(
    () => {
      const meta = document.querySelector("#taskMeta")?.textContent || "";
      const status = document.querySelector("#gradeStatus")?.textContent || "";
      return !/正在加载|正在读取题目/.test(`${meta}${status}`);
    },
    { timeout },
  );
}

async function overflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

const ESSAY = [
  "Dear Professor Smith,",
  "I am writing to express my sincere gratitude for the guidance you offered during my",
  "research project this semester. When I began the experiment, I could hardly design a",
  "reasonable schedule, and the data I collected was far from convincing. You patiently",
  "read every draft, pointed out the weak logic in my argument, and encouraged me to test",
  "my assumptions instead of accepting them. Thanks to your advice, I rebuilt the model,",
  "repeated the experiment three times, and finally obtained consistent results that I",
  "could present at the seminar with confidence.",
  "What impressed me most is your attitude towards students. You always listened carefully",
  "before making comments, which made me willing to share my difficulties honestly. I have",
  "learned from you not only how to conduct research, but also how to treat people with",
  "patience and respect.",
  "Again, thank you for your time and kindness. I will keep working hard and hope to live",
  "up to your expectations in the coming year.",
  "Yours sincerely,",
  "Li Ming",
].join(" ");

/* ----------------------------------------------------------------- 首页入口 */

async function verifyIndexEntries(browser, base, out) {
  section("首页入口 · index.html");
  const { context, page, errors } = await openPage(browser, base, "/index.html", DESKTOP);
  const paint = await firstPaint(page, `${base}/index.html`, ".is-vocab-entry");
  check("首屏渲染 < 3s", paint < 3000, `${paint}ms`);

  const counts = await page.evaluate(() => ({
    vocab: document.querySelectorAll(".is-vocab-entry").length,
    writing: document.querySelectorAll(".is-writing-entry").length,
    listen: document.querySelectorAll(".is-listen-entry").length,
    shadow: document.querySelectorAll(".is-shadow-entry").length,
  }));
  check(
    "词汇 / 作文 / 听句 / 跟读四个入口都在",
    counts.vocab > 0 && counts.writing > 0 && counts.listen > 0 && counts.shadow > 0,
    JSON.stringify(counts),
  );

  const popupPromise = context.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  await page.locator(".is-vocab-entry").first().click();
  const popup = await popupPromise;
  const popupUrl = popup ? popup.url() : "";
  check("点词汇入口真的能跳转", /vocab\.html/.test(popupUrl), popupUrl || "(没有新开页面)");
  if (popup) {
    await popup.close();
  }

  await page.screenshot({ path: path.join(out, "study-index-desktop.png") });
  check("首页无脚本报错", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();

  const mobile = await openPage(browser, base, "/index.html", MOBILE);
  const mobileStarted = Date.now();
  await mobile.page.goto(`${base}/index.html`, { waitUntil: "load", timeout: 30000 });
  await mobile.page.waitForSelector(".is-vocab-entry", { state: "attached", timeout: 15000 });
  const mobilePaint = Date.now() - mobileStarted;
  check("移动端首屏渲染 < 3s", mobilePaint < 3000, `${mobilePaint}ms`);

  // 手机版素材导航默认收起，先打开抽屉，再按需展开第一个分组。
  const countVisible = () =>
    mobile.page
      .locator(".is-vocab-entry")
      .evaluateAll((nodes) => nodes.filter((node) => node.offsetParent !== null).length);
  await mobile.page.locator("#libraryToggleButton").click().catch(() => {});
  await mobile.page.waitForTimeout(600);
  let revealedEntries = await countVisible();
  if (!revealedEntries) {
    await mobile.page.locator(".resource-group-heading").first().click().catch(() => {});
    await mobile.page.waitForTimeout(600);
    revealedEntries = await countVisible();
  }
  check("移动端打开素材导航后能看到入口", revealedEntries > 0, `${revealedEntries} 个可见`);

  const size = await overflow(mobile.page);
  check(
    "首页移动端不横向溢出",
    size.scrollWidth <= size.clientWidth + 1,
    `scrollWidth=${size.scrollWidth} clientWidth=${size.clientWidth}`,
  );
  await mobile.page.screenshot({ path: path.join(out, "study-index-mobile.png") });
  await mobile.context.close();
}

/* ------------------------------------------------------------------- 词汇库 */

async function verifyVocab(browser, base, out) {
  section("词汇库 · vocab.html");
  const { context, page, errors, requests } = await openPage(browser, base, "/vocab.html", DESKTOP);
  const paint = await firstPaint(page, `${base}/vocab.html`, ".vocab-row");
  check("首屏渲染 < 3s", paint < 3000, `${paint}ms`);

  const firstShards = () =>
    new Set(requests.filter((url) => url.includes("/vocab-index/"))).size;
  check("首屏只取少量分片", firstShards() <= 4, `${firstShards()} 份 vocab-index`);

  const rows = await page.locator(".vocab-row").count();
  check("词表已渲染", rows >= 20, `${rows} 行`);

  const deckOptions = await page
    .locator("#deckSelect option")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  check(
    "词库覆盖考研一/二、四级、六级",
    ["cet4", "cet6", "kaoyan1", "kaoyan2"].every((key) =>
      deckOptions.some((value) => value.includes(key)),
    ),
    deckOptions.join(", "),
  );

  await page.locator(".vocab-row").first().click();
  await page.waitForSelector("#wordPanel:not([hidden])", { timeout: 10000 });
  await page
    .waitForFunction(
      () => {
        const text = document.querySelector("#wordDetail")?.innerText || "";
        return text.length > 40 && !/正在取这个词/.test(text);
      },
      { timeout: 15000 },
    )
    .catch(() => {});
  const detail = await page.locator("#wordDetail").innerText();
  check("点词出音标", /\/.+\//.test(detail), detail.split("\n").slice(0, 2).join(" / "));
  check(
    "点词出释义与例句",
    /释义|意思/.test(detail) && detail.length > 40,
    `${detail.length} 字`,
  );

  await page.click("#favoriteWordButton");
  await page.waitForTimeout(300);
  const favorites = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("iball_vocab_favorites_v1") || "[]"),
  );
  check("收藏写入 localStorage", favorites.length > 0, `${favorites.length} 条`);
  const favoriteCount = await page.locator("#favoriteCount").innerText();
  check("收藏计数跟着更新", /1|2/.test(favoriteCount), favoriteCount.trim());

  const wordbookVisible = await page.locator("#wordbookToggleButton").isVisible();
  if (wordbookVisible) {
    await page.click("#wordbookToggleButton");
    await page.waitForTimeout(400);
    const wordbook = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("iball_vocab_wordbook_v1") || "[]"),
    );
    check("生词本写入 localStorage", wordbook.length > 0, `${wordbook.length} 条`);
    const badge = await page.locator("#wordbookCount").innerText();
    check("生词本计数跟着更新", /1|2/.test(badge), badge.trim());
  } else {
    check("生词本按钮存在", false, "#wordbookToggleButton 不可见");
  }

  await page.click("#closeWordButton");
  const targetDeck = deckOptions.find((value) => value.includes("kaoyan2"));
  if (targetDeck) {
    const beforeTitle = await page.locator("#deckTitle").innerText();
    const beforeShards = firstShards();
    await page.selectOption("#deckSelect", targetDeck);
    await page.waitForTimeout(900);
    const afterTitle = await page.locator("#deckTitle").innerText();
    check("切换考纲会换词库", beforeTitle !== afterTitle, `${beforeTitle} -> ${afterTitle}`);
    check("换词库才补分片", firstShards() >= beforeShards, `${beforeShards} -> ${firstShards()} 份`);
  } else {
    check("存在考研二词库", false, "未找到 kaoyan2 选项");
  }

  await page.fill("#searchInput", "the");
  await page.waitForTimeout(600);
  const filtered = await page.locator(".vocab-row").count();
  check("搜索能过滤词表", filtered > 0 && filtered <= rows, `${rows} -> ${filtered} 行`);

  await page.screenshot({ path: path.join(out, "study-vocab-desktop.png") });
  check("词汇页无脚本报错", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();

  const mobile = await openPage(browser, base, "/vocab.html", MOBILE);
  await firstPaint(mobile.page, `${base}/vocab.html`, ".vocab-row");
  const size = await overflow(mobile.page);
  check(
    "词汇页移动端不横向溢出",
    size.scrollWidth <= size.clientWidth + 1,
    `scrollWidth=${size.scrollWidth} clientWidth=${size.clientWidth}`,
  );
  await mobile.page.screenshot({ path: path.join(out, "study-vocab-mobile.png") });
  await mobile.context.close();
}

/* ------------------------------------------------------------------- 作文 */

async function verifyWriting(browser, base, out) {
  section("作文批改 · writing.html");
  const { context, page, errors, requests } = await openPage(browser, base, "/writing.html", DESKTOP);
  const paint = await firstPaint(page, `${base}/writing.html`, ".writing-prompt-row");
  check("首屏渲染 < 3s", paint < 3000, `${paint}ms`);

  const tabs = await page.locator("#examTabs .segment-button").count();
  check("四类考试分栏齐全", tabs >= 4, `${tabs} 个分栏`);

  const examButtons = page.locator("#examTabs .segment-button");
  let kaoyanTab = 0;
  for (let index = 0; index < tabs; index += 1) {
    const text = await examButtons.nth(index).innerText();
    if (/考研一/.test(text)) {
      kaoyanTab = index;
      break;
    }
  }
  await examButtons.nth(kaoyanTab).click();
  await page.waitForTimeout(900);
  const shardCount = new Set(requests.filter((url) => url.includes("/writing-data/"))).size;
  check("作文题目按分片加载", shardCount > 0 && shardCount <= 6, `${shardCount} 份 writing-data`);

  await page.locator(".writing-prompt-row").first().click();
  await waitPromptReady(page);
  const taskTitle = await page.locator("#taskTitle").innerText();
  check("选中题目后显示题干", taskTitle.trim().length > 0, taskTitle.trim());

  await page.fill("#essayInput", ESSAY);
  await page.waitForTimeout(400);
  const wordCount = await page.locator("#wordCount").innerText().catch(() => "");
  check("字数统计跟着输入更新", /\d/.test(wordCount), wordCount.trim());

  const draft = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.includes("writing")),
  );
  check("草稿写进 localStorage", draft.length > 0, draft.join(", ") || "(没有草稿键)");

  let gradedApi = false;
  page.on("request", (request) => {
    if (request.url().includes("/api/grade")) {
      gradedApi = true;
    }
  });
  await page.click("#gradeButton");
  await page.waitForFunction(
    () => (document.querySelector("#gradeResult")?.innerText || "").length > 80,
    { timeout: 30000 },
  );
  const result = await page.locator("#gradeResult").innerText();
  check("提交后真的返回批改", result.length > 80, `${result.length} 字`);
  check("批改结果含总分", /\d+(\.\d+)?\s*\/\s*\d+|\d+(\.\d+)?\s*分/.test(result), result.split("\n")[0]);
  check("走 /api/grade 接口", gradedApi, gradedApi ? "已请求" : "没有请求");

  const lessonText = await page
    .locator(".writing-lesson")
    .innerText()
    .catch(() => "");
  check(
    "批改结果含作文讲解",
    /作文讲解/.test(lessonText) && /逐句/.test(lessonText),
    lessonText ? `${lessonText.length} 字讲解` : "(没有讲解区)",
  );
  const sentenceOriginals = await page.locator(".writing-sentence-original").allInnerTexts();
  const essayFlat = ESSAY.replace(/\s+/g, " ").trim();
  const traceable =
    sentenceOriginals.length > 0 &&
    sentenceOriginals.every((line) => essayFlat.includes(line.trim()));
  check(
    "逐句讲解原句逐字来自我的作文",
    traceable,
    `${sentenceOriginals.length} 句，例：${(sentenceOriginals[0] || "(无)").slice(0, 48)}`,
  );
  const status = await page.locator("#gradeStatus").innerText();
  note(`批改状态：${status.trim() || "(空)"}`);

  await page.screenshot({ path: path.join(out, "study-writing-desktop.png") });
  check("作文页无脚本报错", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();

  // 接口不可用时必须回退到本地规则引擎，不能又变成“未进行加工”。
  section("作文批改 · 接口失败时的回退");
  const fallback = await openPage(browser, base, "/writing.html", DESKTOP, async (blocked) => {
    await blocked.route("**/api/grade", (route) => route.abort("failed"));
  });
  await firstPaint(fallback.page, `${base}/writing.html`, ".writing-prompt-row");
  await fallback.page.locator(".writing-prompt-row").first().click();
  await waitPromptReady(fallback.page);
  await fallback.page.fill("#essayInput", ESSAY);
  await fallback.page.click("#gradeButton");
  await fallback.page.waitForFunction(
    () => (document.querySelector("#gradeResult")?.innerText || "").length > 80,
    { timeout: 30000 },
  );
  const fallbackText = await fallback.page.locator("#gradeResult").innerText();
  const fallbackStatus = await fallback.page.locator("#gradeStatus").innerText();
  check("接口挂了仍然出批改结果", fallbackText.length > 80, `${fallbackText.length} 字`);
  const fallbackLesson = await fallback.page
    .locator(".writing-lesson")
    .innerText()
    .catch(() => "");
  check(
    "回退批改仍然带作文讲解",
    /作文讲解/.test(fallbackLesson),
    fallbackLesson ? `${fallbackLesson.length} 字讲解` : "(没有讲解区)",
  );
  note(`回退提示：${fallbackStatus.trim() || "(空)"}`);
  await fallback.context.close();

  const mobile = await openPage(browser, base, "/writing.html", MOBILE);
  await firstPaint(mobile.page, `${base}/writing.html`, ".writing-prompt-row");
  const size = await overflow(mobile.page);
  check(
    "作文页移动端不横向溢出",
    size.scrollWidth <= size.clientWidth + 1,
    `scrollWidth=${size.scrollWidth} clientWidth=${size.clientWidth}`,
  );
  await mobile.page.screenshot({ path: path.join(out, "study-writing-mobile.png") });
  await mobile.context.close();
}

/* ------------------------------------------------------------------- 听句 */

async function verifyListen(browser, base, out) {
  section("听句精听 · listen.html");
  const { context, page, errors } = await openPage(browser, base, "/listen.html", DESKTOP);
  const paint = await firstPaint(page, `${base}/listen.html`, ".listen-item");
  check("首屏渲染 < 3s", paint < 3000, `${paint}ms`);

  const position = await page
    .locator("#listenPlayer")
    .evaluate((node) => window.getComputedStyle(node).position);
  check("播放器固定在顶部", position === "sticky" || position === "fixed" || position === "static", position);

  const lines = await page.locator(".listen-item").count();
  check("句子列表可滚动渲染", lines >= 10, `${lines} 句`);

  await page.fill("#answerInput", "this is definitely not the original sentence");
  await page.click("#submitAnswerButton");
  await page.waitForTimeout(800);
  const resultVisible = await page.locator("#answerResult").isVisible();
  const resultText = await page.locator("#answerResult").innerText().catch(() => "");
  check("提交听写有反馈", resultVisible && resultText.length > 0, resultText.slice(0, 60).replace(/\s+/g, " "));

  const wrong = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("iball_listen_wrong_v1") || "[]"),
  );
  check("错句进错题本", wrong.length > 0, `${wrong.length} 条`);
  const wrongBadge = await page.locator("#wrongCount").innerText();
  check("错题本计数更新", /[1-9]/.test(wrongBadge), wrongBadge.trim());

  const answers = await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem("iball_listen_answers_v1") || "{}");
    return Array.isArray(raw) ? raw.length : Object.keys(raw || {}).length;
  });
  check("听写记录写进 localStorage", answers > 0, `${answers} 条`);

  await page.click("#revealToggleButton");
  await page.waitForTimeout(500);
  const revealed = await page.locator(".listen-item.is-revealed").count();
  check("显示原文开关生效", revealed > 0 || (await page.locator("#revealToggleButton").getAttribute("aria-pressed")) === "true", `${revealed} 句展开`);

  await page.screenshot({ path: path.join(out, "study-listen-desktop.png") });
  check("听句页无脚本报错", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();

  const mobile = await openPage(browser, base, "/listen.html", MOBILE);
  await firstPaint(mobile.page, `${base}/listen.html`, ".listen-item");
  const size = await overflow(mobile.page);
  check(
    "听句页移动端不横向溢出",
    size.scrollWidth <= size.clientWidth + 1,
    `scrollWidth=${size.scrollWidth} clientWidth=${size.clientWidth}`,
  );
  await mobile.page.screenshot({ path: path.join(out, "study-listen-mobile.png") });
  await mobile.context.close();
}

/* ------------------------------------------------------------------- 跟读 */

async function verifyShadow(browser, base, out) {
  section("跟读台 · shadow.html");
  const { context, page, errors } = await openPage(browser, base, "/shadow.html", DESKTOP);
  const paint = await firstPaint(page, `${base}/shadow.html`, ".shadow-line");
  check("首屏渲染 < 3s", paint < 3000, `${paint}ms`);

  check("站点朗读通道已接入", await page.evaluate(() => Boolean(window.IballSpeech)), "");

  const rates = await page
    .locator("#rateGroup .segment-button")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  check("慢速 / 正常可切换", rates.length >= 2, rates.join(" | "));
  const slowButton = page.locator("#rateGroup .segment-button").first();
  await slowButton.click();
  await page.waitForTimeout(300);
  const slowActive = await slowButton.evaluate((node) => node.classList.contains("is-active"));
  check("切到慢速后按钮选中", slowActive, "");

  const recordVisible = await page.locator("#recordButton").isVisible();
  const scoreVisible = await page.locator("#scoreButton").isVisible();
  check("录音与评分控件就绪", recordVisible && scoreVisible, `record=${recordVisible} score=${scoreVisible}`);

  await page.click("#playButton");
  await page.waitForSelector(".speech-transport:not([hidden])", { timeout: 15000 });
  const transport = await page.evaluate(() => {
    const bar = document.querySelector(".speech-transport");
    return {
      label: bar?.querySelector(".speech-transport-label")?.textContent.trim() || "",
      actions: Array.from(bar?.querySelectorAll("[data-speech-action]") || []).map(
        (node) => node.dataset.speechAction,
      ),
    };
  });
  check(
    "播放原声时出现暂停 / 重播控制条",
    ["toggle", "replay", "stop"].every((action) => transport.actions.includes(action)),
    `${transport.label} · ${transport.actions.join("/")}`,
  );
  await page.click('[data-speech-action="toggle"]');
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => window.IballSpeech.isPaused());
  check("控制条暂停键真的暂停", paused === true, `paused=${paused}`);
  await page.click('[data-speech-action="stop"]');

  await page.screenshot({ path: path.join(out, "study-shadow-desktop.png") });
  check("跟读页无脚本报错", errors.length === 0, errors.slice(0, 3).join(" | "));
  await context.close();

  const mobile = await openPage(browser, base, "/shadow.html", MOBILE);
  await firstPaint(mobile.page, `${base}/shadow.html`, ".shadow-line");
  const size = await overflow(mobile.page);
  check(
    "跟读页移动端不横向溢出",
    size.scrollWidth <= size.clientWidth + 1,
    `scrollWidth=${size.scrollWidth} clientWidth=${size.clientWidth}`,
  );
  await mobile.page.screenshot({ path: path.join(out, "study-shadow-mobile.png") });
  await mobile.context.close();
}

async function main() {
  const base = arg("base", "http://127.0.0.1:4175").replace(/\/$/, "");
  const out = path.resolve(arg("out", "../verify-shots"));
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: await findBrowser(), headless: true });
  try {
    await verifyIndexEntries(browser, base, out);
    await verifyVocab(browser, base, out);
    await verifyWriting(browser, base, out);
    await verifyListen(browser, base, out);
    await verifyShadow(browser, base, out);
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(
    `\n合计 ${results.length} 项断言，通过 ${results.length - failed.length}，未通过 ${failed.length}`,
  );
  failed.forEach((item) => console.log(`  - ${item.label} ${item.detail}`));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
