/**
 * xxrj 待复盘页面 + 管理端备份卡片 / 账号治理的浏览器验收。
 *
 * 用法：
 *   node scripts/verify-xxrj.mjs --base http://127.0.0.1:4175 --out ../verify-shots
 *
 * 可选：--password <站长口令> 时额外打开 /admin.html 检查备份卡片、
 * 在线时长 / 模块使用列，以及停用、恢复、删除账号的完整流程；
 * 不传就跳过管理端那一段（备份接口本身由 tests/backup-api.test.cjs 覆盖）。
 *
 * 只在本地测试服务上跑，用的是浏览器自带的 localStorage，不碰生产数据。
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

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function findBrowser() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // 继续找下一个已安装的浏览器。
    }
  }
  throw new Error("找不到 Chrome/Edge 可执行文件");
}

const results = [];

function check(label, ok, detail = "") {
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`);
  results.push(Boolean(ok));
}

/** 和页面 dateKey 口径一致：本地时区的 YYYY-MM-DD。 */
function localDateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function prepareContext(browser, viewport, base, out, name) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  // 未登录时这几个接口回 401 是正常的会话探测，favicon 404 与功能无关。
  const SILENT_401 = /\/api\/(auth|progress|telemetry)/;
  const isExpected = (url = "") => SILENT_401.test(url) || url.endsWith("/favicon.ico");
  const isExpectedResponse = (status, url = "") =>
    (status === 401 && SILENT_401.test(url)) || url.endsWith("/favicon.ico");
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location()?.url || "";
    if (isExpected(location)) return;
    errors.push(`console: ${message.text()} (${location})`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() < 400 || isExpectedResponse(response.status(), response.url())) return;
    errors.push(`response ${response.status()}: ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    if (failure && failure.errorText !== "net::ERR_ABORTED" && !isExpected(request.url())) {
      errors.push(`requestfailed: ${request.url()} ${failure.errorText}`);
    }
  });
  await page.goto(`${base}/xxrj/`, { waitUntil: "load", timeout: 30000 });
  // 每次验收都从空白数据开始，避免上一次的浏览器数据影响断言。
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".review-summary-card", { timeout: 15000 });
  return { context, page, errors, out, name };
}

async function openDailyReview(page) {
  await page.locator(".sidebar .nav-item[data-screen='daily-review']").click();
  await page.waitForSelector("h1:text-is('待复盘')", { timeout: 10000 });
}

async function addKnowledge(page, { topic, detail }) {
  await page.locator("[data-knowledge-new]").first().click();
  await page.waitForSelector("#knowledge-modal:not([hidden])", { timeout: 10000 });
  await page.fill("#knowledge-topic", topic);
  await page.selectOption("#knowledge-subject", "数学一");
  await page.fill("#knowledge-review", localDateKey());
  await page.fill("#knowledge-detail", detail);
  await page.click("#save-knowledge");
  await page.waitForSelector("#knowledge-modal", { state: "hidden", timeout: 10000 });
}

async function desktopFlow(browser, base, out) {
  const { context, page, errors } = await prepareContext(browser, DESKTOP, base, out, "xxrj-desktop");
  try {
    const freshSummary = await page.locator(".review-summary-card").innerText();
    check("总览出现待复盘汇总卡", /待复盘/.test(freshSummary), freshSummary.split("\n")[0]);
    check("空白数据时提示没有到期复盘", /今天没有到期的复盘/.test(freshSummary), freshSummary.replace(/\s+/g, " ").slice(0, 80));

    const navItem = page.locator(".sidebar .nav-item[data-screen='daily-review']");
    check("侧栏有待复盘入口", (await navItem.count()) === 1);
    check("初始状态复盘徽章隐藏", await page.locator("#review-badge").isHidden());

    await openDailyReview(page);
    check("待复盘页标题正确", (await page.locator("#crumb-current").innerText()) === "待复盘");
    check(
      "空状态给出新增入口",
      /还没有待复盘的知识点/.test(await page.locator("#app").innerText()),
    );

    const topic = "验收知识点：无穷级数敛散性判定";
    await addKnowledge(page, { topic, detail: "比值法忘了开 n 次方" });
    const card = page.locator(".knowledge-card").first();
    await card.waitFor({ timeout: 10000 });
    check("新增后卡片出现", (await page.locator(".knowledge-card").count()) === 1);
    check("卡片显示知识点标题", (await card.locator(".knowledge-topic").innerText()) === topic);
    const cardText = await card.innerText();
    check("今天到期的标签正确", /今天到期/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 60));
    check("初始复盘次数为 0", /已复盘 0 次/.test(cardText));
    check("徽章显示待复盘条数", (await page.locator("#review-badge").innerText()) === "1");

    await page.click("[data-review-filter='due']");
    check("今天到期筛选命中 1 条", (await page.locator(".knowledge-card").count()) === 1);
    await page.click("[data-review-filter='mastered']");
    check("已掌握筛选为空", (await page.locator(".knowledge-card").count()) === 0);
    await page.click("[data-review-filter='all']");

    const logText = "这次自己推完判定步骤，比值法没再出错";
    await page.click("[data-knowledge-log]");
    await page.waitForSelector("#review-log-modal:not([hidden])", { timeout: 10000 });
    await page.fill("#review-log-text", logText);
    await page.click("#save-review-log");
    await page.waitForSelector("#review-log-modal", { state: "hidden", timeout: 10000 });
    await card.waitFor({ timeout: 10000 });
    const afterLog = await card.innerText();
    check("复盘历史追加一条", (await card.locator(".knowledge-logs li").count()) === 1);
    check("复盘正文可见", /比值法没再出错/.test(afterLog));
    check("复盘次数加一", /已复盘 1 次/.test(afterLog));
    check("状态自动转为已复盘", /已复盘/.test(await card.locator(".knowledge-tags").innerText()));
    check("复盘收尾后回到未排期", /未排期/.test(await card.locator(".knowledge-tags").innerText()));
    check("复盘收尾后徽章清零", await page.locator("#review-badge").isHidden());

    // 第二条：填下次日期＝重新排队，状态回到待复盘。
    const reschedule = new Date();
    reschedule.setDate(reschedule.getDate() + 2);
    await page.click("[data-knowledge-log]");
    await page.waitForSelector("#review-log-modal:not([hidden])", { timeout: 10000 });
    await page.fill("#review-log-text", "第二次复盘：把判定步骤写成模板");
    await page.fill("#review-log-next", localDateKey(reschedule));
    await page.click("#save-review-log");
    await page.waitForSelector("#review-log-modal", { state: "hidden", timeout: 10000 });
    const afterReschedule = await card.innerText();
    check("填日期后重新排队", /待复盘/.test(afterReschedule));
    check("重新排队显示新日期", afterReschedule.includes(`下次 ${localDateKey(reschedule)}`));
    check("复盘历史累计两条", (await card.locator(".knowledge-logs li").count()) === 2);

    await page.click("[data-knowledge-snooze][data-days='3']");
    await card.waitFor({ timeout: 10000 });
    const afterSnooze = await card.innerText();
    check("顺延后不再是今天到期", !/今天到期/.test(afterSnooze));
    check("顺延后显示下次日期", /下次 20\d\d-\d\d-\d\d/.test(afterSnooze));
    check("顺延后仍可继续复盘", /待复盘/.test(await card.locator(".knowledge-tags").innerText()));

    // 刷新页面：复盘历史必须留在 localStorage 里。
    await page.reload({ waitUntil: "load" });
    await openDailyReview(page);
    const reloaded = page.locator(".knowledge-card").first();
    await reloaded.waitFor({ timeout: 10000 });
    const afterReload = await reloaded.innerText();
    check("刷新后复盘历史仍在", /比值法没再出错/.test(afterReload));
    check("刷新后第二条复盘也在", /把判定步骤写成模板/.test(afterReload));
    check("刷新后复盘次数仍在", /已复盘 2 次/.test(afterReload));
    check("刷新后顺延日期仍在", /下次 20\d\d-\d\d-\d\d/.test(afterReload));
    // 截图留在卡片有复盘的这一刻，方便人工复核排版。
    await page.screenshot({ path: path.join(out, "xxrj-desktop.png"), fullPage: false });

    await reloaded.locator("[data-knowledge-status]").selectOption("已掌握");
    await page.waitForTimeout(300);
    const masteredCard = page.locator(".knowledge-card").first();
    check(
      "切到已掌握后标签更新",
      /已掌握/.test(await masteredCard.locator(".knowledge-tags").innerText()),
    );
    check(
      "已掌握后徽章清零",
      await page.locator("#review-badge").isHidden(),
    );

    await page.locator(".sidebar .nav-item[data-screen='dashboard']").click();
    await page.waitForSelector(".review-summary-card", { timeout: 10000 });
    const summaryAfter = await page.locator(".review-summary-card").innerText();
    check("已掌握后总览显示无到期复盘", /今天没有到期的复盘/.test(summaryAfter));
    check("总览统计知识点总数", /共 1 条/.test(summaryAfter));

    await openDailyReview(page);
    page.once("dialog", (dialog) => dialog.accept());
    await page.click("[data-knowledge-remove]");
    await page.waitForTimeout(500);
    check("删除后卡片消失", (await page.locator(".knowledge-card").count()) === 0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("桌面无横向溢出", overflow <= 0, `${overflow}px`);
    check("桌面无控制台错误", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await context.close();
  }
}

async function mobileFlow(browser, base, out) {
  const { context, page, errors } = await prepareContext(browser, MOBILE, base, out, "xxrj-mobile");
  try {
    await page.locator(".mobile-nav button[data-screen='daily-review']").click();
    await page.waitForSelector("h1:text-is('待复盘')", { timeout: 10000 });
    check("手机端底部导航能进待复盘", (await page.locator("#crumb-current").innerText()) === "待复盘");

    // 弹窗开着的时候量尺寸，才量得到真实的移动端排版。
    await page.locator("[data-knowledge-new]").first().click();
    await page.waitForSelector("#knowledge-modal:not([hidden])", { timeout: 10000 });
    const modalBox = await page.evaluate(() => {
      const modal = document.querySelector("#knowledge-modal .modal");
      const rect = modal.getBoundingClientRect();
      return { width: rect.width, left: rect.left, right: rect.right, viewport: window.innerWidth };
    });
    check(
      "手机端弹窗不超出视口",
      modalBox.right <= modalBox.viewport + 1 && modalBox.left >= -1 && modalBox.width > 0,
      `modal=${Math.round(modalBox.width)}px viewport=${modalBox.viewport}px`,
    );

    await page.fill("#knowledge-topic", "手机验收：矩阵相似对角化条件");
    await page.selectOption("#knowledge-subject", "数学一");
    await page.fill("#knowledge-review", localDateKey());
    await page.fill("#knowledge-detail", "忘记检查特征向量个数");
    await page.click("#save-knowledge");
    await page.waitForSelector("#knowledge-modal", { state: "hidden", timeout: 10000 });
    const card = page.locator(".knowledge-card").first();
    await card.waitFor({ timeout: 10000 });
    check("手机端新增知识点成功", (await page.locator(".knowledge-card").count()) === 1);

    const cardText = await card.innerText();
    check("手机端卡片标签完整", /今天到期/.test(cardText) && /待复盘/.test(cardText));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check("手机端无横向溢出", overflow <= 0, `${overflow}px`);

    await page.click("[data-knowledge-log]");
    await page.waitForSelector("#review-log-modal:not([hidden])", { timeout: 10000 });
    await page.fill("#review-log-text", "手机端写一条复盘");
    await page.click("#save-review-log");
    await page.waitForSelector("#review-log-modal", { state: "hidden", timeout: 10000 });
    check("手机端能写复盘", /手机端写一条复盘/.test(await page.locator(".knowledge-card").first().innerText()));

    check("手机端无控制台错误", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.screenshot({ path: path.join(out, "xxrj-mobile.png"), fullPage: false });
  } finally {
    await context.close();
  }
}

async function adminFlow(browser, base, out, password) {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  let studentContext = null;
  try {
    const login = await page.request.post(`${base}/api/auth`, {
      data: { action: "login", username: "iball", password },
    });
    check("管理端登录成功", login.status() === 200, `HTTP ${login.status()}`);

    // 造一个学生账号，并让他真的在 /xxrj/ 上发一次心跳，管理台才有数据可看。
    const studentName = `verify${Date.now().toString(36).slice(-6)}`;
    const studentPassword = "verify-student-pass-1";
    studentContext = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
    const studentPage = await studentContext.newPage();
    const register = await studentPage.request.post(`${base}/api/auth`, {
      data: { action: "register", username: studentName, password: studentPassword },
    });
    check("验收学生账号注册成功", register.status() === 201, `HTTP ${register.status()}`);
    const heartbeat = studentPage
      .waitForResponse(
        (response) =>
          response.url().includes("/api/telemetry") &&
          response.request().method() === "POST",
        { timeout: 20000 },
      )
      .catch(() => null);
    await studentPage.goto(`${base}/xxrj/`, { waitUntil: "load", timeout: 30000 });
    await studentPage.waitForSelector(".review-summary-card", { timeout: 15000 });
    const beat = await heartbeat;
    check(
      "登录后的小屋页面会发心跳",
      Boolean(beat && beat.status() === 200),
      beat ? `HTTP ${beat.status()}` : "没有心跳",
    );

    await page.goto(`${base}/admin.html`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#adminBody:not([hidden])", { timeout: 15000 });
    const badge = page.locator("#backupBadge");
    await badge.waitFor({ timeout: 10000 });
    const badgeText = await badge.innerText();
    const metaText = await page.locator("#backupMeta").innerText();
    check("备份卡片渲染状态徽章", /未配置|从未|从未备份/.test(badgeText), badgeText);
    check("备份卡片显示仓库与上次备份", /iball-cabin-backup/.test(metaText), metaText.replace(/\s+/g, " ").slice(0, 90));
    check("未配置时立即备份按钮禁用", await page.locator("#backupRun").isDisabled());

    await page.locator("#backupBadge").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, "xxrj-admin-backup.png"), fullPage: false });

    const activityHead = await page
      .locator("#activityBody")
      .locator("xpath=ancestor::table")
      .locator("thead th")
      .allInnerTexts();
    check(
      "活动表有在线时长与模块使用列",
      activityHead.includes("在线时长") && activityHead.includes("模块使用"),
      activityHead.join(" / "),
    );
    const userHead = await page
      .locator("#userBody")
      .locator("xpath=ancestor::table")
      .locator("thead th")
      .allInnerTexts();
    check("账号表有状态列", userHead.includes("状态"), userHead.join(" / "));

    const activityRow = page.locator("#activityBody tr", { hasText: studentName }).first();
    await activityRow.waitFor({ timeout: 15000 });
    const activityText = (await activityRow.innerText()).replace(/\s+/g, " ");
    check(
      "活动表显示在线时长",
      /今天/.test(activityText) && /累计/.test(activityText),
      activityText.slice(0, 90),
    );
    check("活动表显示小屋模块", /小屋/.test(activityText), activityText.slice(0, 90));
    check(
      "模块标签渲染成胶囊",
      (await activityRow.locator(".admin-module").count()) >= 1,
      await activityRow
        .locator(".admin-module")
        .first()
        .innerText()
        .catch(() => ""),
    );

    const userRow = page.locator("#userBody tr", { hasText: studentName }).first();
    await userRow.waitFor({ timeout: 15000 });
    check("账号行显示正常状态", /正常/.test(await userRow.innerText()));

    // 手机端：表格在卡片内部横向滚动，整页不能溢出。
    const mobileContext = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 1 });
    try {
      const mobilePage = await mobileContext.newPage();
      const mobileLogin = await mobilePage.request.post(`${base}/api/auth`, {
        data: { action: "login", username: "iball", password },
      });
      check("手机端管理台登录成功", mobileLogin.status() === 200, `HTTP ${mobileLogin.status()}`);
      await mobilePage.goto(`${base}/admin.html`, { waitUntil: "load", timeout: 30000 });
      await mobilePage.waitForSelector("#adminBody:not([hidden])", { timeout: 15000 });
      const mobileRow = mobilePage
        .locator("#activityBody tr", { hasText: studentName })
        .first();
      await mobileRow.waitFor({ timeout: 15000 });
      const mobileOverflow = await mobilePage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check("手机端管理台无横向溢出", mobileOverflow <= 0, `${mobileOverflow}px`);
      const chipOverflow = await mobileRow.locator(".admin-modules").evaluate((node) => {
        const box = node.getBoundingClientRect();
        const chips = [...node.querySelectorAll(".admin-module")].map((chip) =>
          chip.getBoundingClientRect(),
        );
        const widest = Math.max(0, ...chips.map((chip) => chip.right - box.right));
        return Math.round(widest);
      });
      check("手机端模块标签不越出单元格", chipOverflow <= 1, `${chipOverflow}px`);
      await mobileRow.scrollIntoViewIfNeeded();
      await mobilePage.screenshot({
        path: path.join(out, "xxrj-admin-mobile.png"),
        fullPage: false,
      });
    } finally {
      await mobileContext.close();
    }

    // 停用：对方会话立刻失效。
    page.once("dialog", (dialog) => dialog.accept());
    await userRow.locator("[data-user-disable]").click();
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll("#userBody tr")].some(
          (row) => row.textContent.includes(name) && /已停用/.test(row.textContent),
        ),
      studentName,
      { timeout: 15000 },
    );
    check("停用后账号行标记已停用", /已停用/.test(await userRow.innerText()));
    check(
      "停用提示可见",
      /已停用/.test(await page.locator("#userMessage").innerText()),
      (await page.locator("#userMessage").innerText()).slice(0, 60),
    );
    const kicked = await studentPage.request.get(`${base}/api/auth`);
    const kickedBody = await kicked.json().catch(() => ({}));
    check(
      "停用后学生会话立刻失效",
      kickedBody.authenticated === false,
      JSON.stringify(kickedBody).slice(0, 80),
    );
    await userRow.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, "xxrj-admin-users.png"), fullPage: false });

    // 恢复：可以重新登录。
    await userRow.locator("[data-user-enable]").click();
    await page.waitForFunction(
      (name) =>
        [...document.querySelectorAll("#userBody tr")].some(
          (row) => row.textContent.includes(name) && /正常/.test(row.textContent),
        ),
      studentName,
      { timeout: 15000 },
    );
    const relogin = await studentPage.request.post(`${base}/api/auth`, {
      data: { action: "login", username: studentName, password: studentPassword },
    });
    check("恢复后学生可以重新登录", relogin.status() === 200, `HTTP ${relogin.status()}`);

    // 删除：账号行和活动行一起消失。
    page.once("dialog", (dialog) => dialog.accept());
    await userRow.locator("[data-user-delete]").click();
    await page.waitForFunction(
      (name) =>
        ![...document.querySelectorAll("#userBody tr")].some((row) =>
          row.textContent.includes(name),
        ) &&
        ![...document.querySelectorAll("#activityBody tr")].some((row) =>
          row.textContent.includes(name),
        ),
      studentName,
      { timeout: 15000 },
    );
    check("删除后账号行与活动行一起消失", true);
    check("管理端无脚本错误", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    if (studentContext) {
      await studentContext.close();
    }
    await context.close();
  }
}

async function main() {
  const base = arg("base", "http://127.0.0.1:4175").replace(/\/$/, "");
  const out = path.resolve(arg("out", "../verify-shots"));
  const password = arg("password");
  await fs.mkdir(out, { recursive: true });

  const executablePath = await findBrowser();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await desktopFlow(browser, base, out);
    await mobileFlow(browser, base, out);
    if (password) {
      await adminFlow(browser, base, out, password);
    } else {
      console.log("[SKIP] 管理端备份与账号治理 — 未提供 --password");
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(`\nxxrj 验收：${results.length - failed} 项通过，${failed} 项失败`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
