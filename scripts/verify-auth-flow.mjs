/**
 * 登录回跳与榜单会话回归。
 *
 * 用法：
 *   node scripts/verify-auth-flow.mjs --base http://127.0.0.1:4176
 *
 * 这个脚本只操作测试服务，不读取生产账号库。
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
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
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
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

function check(label, condition, detail = "") {
  console.log(
    `${condition ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  results.push(Boolean(condition));
}

async function waitForQuizBody(page, timeout = 15000) {
  await page.waitForFunction(
    () => {
      const body = document.querySelector("#quizBody");
      const gate = document.querySelector("#gate");
      return Boolean(body && !body.hidden && gate?.hidden);
    },
    { timeout },
  );
}

async function waitForAuthAttempt(page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      if (new URL(window.location.href).pathname === "/quiz.html") {
        return true;
      }
      const error = document.querySelector("#loginError");
      const notice = document.querySelector("#authNotice");
      return (
        (error && !error.hidden && error.textContent.trim()) ||
        (notice && !notice.hidden && notice.textContent.trim())
      );
    },
    { timeout },
  );
  return page.evaluate(() => ({
    path: new URL(window.location.href).pathname,
    error: document.querySelector("#loginError")?.textContent.trim() || "",
    notice: document.querySelector("#authNotice")?.textContent.trim() || "",
  }));
}

async function registerFromIndex(page, base, username, password, hash = "register") {
  await page.goto(
    `${base}/index.html?next=%2Fquiz.html#${hash}`,
    { waitUntil: "load", timeout: 30000 },
  );
  await page.waitForSelector("#loginForm:not([hidden])", { timeout: 15000 });
  if (hash === "register") {
    await page.click("#authModeRegister");
  }
  await page.fill("#username", username);
  await page.fill("#password", password);
  if (hash === "register") {
    await page.fill("#email", `${username}@example.com`);
  }
  await page.click("#loginButton");
}

async function main() {
  const base = arg("base", "http://127.0.0.1:4176").replace(/\/$/, "");
  const browser = await chromium.launch({
    executablePath: await findBrowser(),
    headless: true,
  });
  const stamp = Date.now().toString(36);
  const password = "AuthFlow-Test-2026";

  try {
    console.log(`浏览器验收目标：${base}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${base}/quiz.html`, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#gate:not([hidden])", { timeout: 15000 });
    const gateHref = await page.locator("#gateAction").getAttribute("href");
    check(
      "未登录测试页带安全的登录回跳地址",
      gateHref?.includes("index.html") &&
        gateHref.includes("next=%2Fquiz.html") &&
        gateHref.includes("#login"),
      gateHref || "(空)",
    );

    await Promise.all([page.waitForURL(/index\.html/, { timeout: 15000 }), page.click("#gateAction")]);
    await page.waitForSelector("#loginForm:not([hidden])", { timeout: 15000 });
    check("登录入口能打开首页登录面板", await page.locator("#loginForm").isVisible());

    const username = `authflow${stamp}`;
    await page.click("#authModeRegister");
    await page.fill("#username", username);
    await page.fill("#password", password);
    await page.fill("#email", `${username}@example.com`);
    await page.click("#loginButton");
    const authAttempt = await waitForAuthAttempt(page);
    check(
      "注册请求被账号服务接受",
      authAttempt.path === "/quiz.html" && !authAttempt.error,
      JSON.stringify(authAttempt),
    );

    await page.waitForFunction(
      () => new URL(window.location.href).pathname === "/quiz.html",
      { timeout: 30000 },
    );
    await waitForQuizBody(page);
    check("注册完成后自动回到测试页", /quiz\.html/.test(page.url()), page.url());

    const board = await page.evaluate(async () => {
      const response = await fetch("/api/leaderboard?scope=total", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      return { status: response.status, ok: Boolean(data.ok) };
    });
    check("回跳后的榜单请求不再反复要求登录", board.status === 200 && board.ok, JSON.stringify(board));
    await context.close();

    // 再模拟一次“旧标签页停留太久，另一个标签页登录后切回来”的真实场景。
    const oldContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const oldPage = await oldContext.newPage();
    const loginPage = await oldContext.newPage();
    await oldPage.goto(`${base}/quiz.html`, { waitUntil: "load", timeout: 30000 });
    await oldPage.waitForSelector("#gate:not([hidden])", { timeout: 15000 });

    const secondUser = `authflow${stamp}b`;
    await registerFromIndex(loginPage, base, secondUser, password);
    const secondAttempt = await waitForAuthAttempt(loginPage);
    check(
      "第二个标签页注册请求被账号服务接受",
      secondAttempt.path === "/quiz.html" && !secondAttempt.error,
      JSON.stringify(secondAttempt),
    );
    await loginPage.waitForFunction(
      () => new URL(window.location.href).pathname === "/quiz.html",
      { timeout: 30000 },
    );
    await waitForQuizBody(loginPage);
    await oldPage.bringToFront();
    // headless Chromium 不一定会为 bringToFront 触发页面焦点事件；
    // 显式派发一次，等价于用户从另一个标签页切回来。
    await oldPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    await waitForQuizBody(oldPage, 20000);
    check(
      "旧标签页切回后会重新探测会话并放行",
      true,
      oldPage.url(),
    );
    await oldContext.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => !item).length;
  console.log(`\n共 ${results.length} 项，通过 ${results.length - failed}，失败 ${failed}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
