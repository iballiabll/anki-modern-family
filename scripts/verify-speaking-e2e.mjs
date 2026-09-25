/**
 * 口语 / 听力升级的浏览器验收脚本。
 *
 * 覆盖范围：
 *   1. 账号级数据隔离：学习进度接口只认登录态，不认客户端传的 userId；
 *   2. 练习台：真实生活场景筛选、雅思口语 Part 1 → 2 → 3 全流程、报告维度；
 *   3. 自由对话：本地免费陪练的话题轮换、自定义 API 失败后自动回退；
 *   4. 日常听力：按套懒加载、句子列表可播放；
 *   5. 开源方案索引：模块筛选、关键词过滤、跳转 GitHub 搜索、Esc 关闭；
 *   6. 桌面端与移动端的横向溢出、控制台错误、首屏耗时、口语素材懒加载。
 *
 * 用法：
 *   node scripts/verify-speaking-e2e.mjs --base http://127.0.0.1:4175
 *
 * 只跑本地测试服务，不接触生产环境。
 */

import fs from "node:fs/promises";
import http from "node:http";
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

const base = arg("base", "http://127.0.0.1:4176");
const outDir = path.resolve(arg("out", "../verify-shots/speaking"));
const results = [];

function check(label, condition, detail = "") {
  console.log(
    `${condition ? "[PASS]" : "[FAIL]"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  results.push(Boolean(condition));
}

/* ------------------------------------------------------------------ */
/* 一、接口层：账号数据必须互相隔离                                     */
/* ------------------------------------------------------------------ */

function cookieOf(response) {
  const list =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  const cookie = list.map((item) => item.split(";")[0]).join("; ");
  if (!cookie) {
    throw new Error("注册没有返回登录 Cookie");
  }
  return cookie;
}

async function request(
  pathname,
  { method = "GET", body, cookie, forwardedFor } = {},
) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

/**
 * 注册接口按 IP 限流（每小时 6 次）。接口层用例并发跑在同一个回环地址上，
 * 这里按代理语义给每条用例一个独立来源 IP，避免和浏览器用例抢配额。
 */
async function register(name) {
  const { response, data } = await request("/api/auth", {
    method: "POST",
    forwardedFor: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    body: {
      action: "register",
      username: name,
      password: "Test-Passw0rd!",
      email: `${name}@example.com`,
    },
  });
  if (!response.ok || !data.ok) {
    throw new Error(`注册 ${name} 失败：${data.message || response.status}`);
  }
  return cookieOf(response);
}

async function verifyAccountIsolation() {
  console.log("\n== 接口层：账号数据隔离");
  const stamp = Date.now().toString(36);
  const cookieA = await register(`speakA${stamp}`);
  const cookieB = await register(`speakB${stamp}`);

  const marker = {
    entries: {
      "iball:wrong-words": {
        v: [{ word: "isolation-probe", at: Date.now() }],
        t: Date.now(),
      },
    },
  };
  const written = await request("/api/progress", {
    method: "POST",
    body: marker,
    cookie: cookieA,
  });
  check(
    "账号 A 能写入自己的学习进度",
    written.response.ok && written.data.ok,
    `written=${written.data.written ?? "-"}`,
  );

  const readA = await request("/api/progress", { cookie: cookieA });
  const hasA = Boolean(readA.data.entries?.["iball:wrong-words"]);
  check("账号 A 读回自己的进度", hasA, hasA ? "命中探针 key" : "没读到");

  const readB = await request("/api/progress", { cookie: cookieB });
  const leaked = Boolean(readB.data.entries?.["iball:wrong-words"]);
  check(
    "账号 B 看不到 A 的进度",
    !leaked,
    `B 的进度条数 ${Object.keys(readB.data.entries || {}).length}`,
  );

  const anon = await request("/api/progress");
  check(
    "未登录访问进度接口被拒绝",
    anon.response.status === 401,
    `HTTP ${anon.response.status}`,
  );
}

/* ------------------------------------------------------------------ */
/* 二、浏览器层工具                                                     */
/* ------------------------------------------------------------------ */

/**
 * 故意打不通的自定义 API：用高位空闲端口，避免 Chrome 把端口当成不安全端口
 * 另外报一条 net::ERR_UNSAFE_PORT。
 */
const BAD_API_URL = "http://127.0.0.1:45999/v1";
const BAD_API_HOST = "127.0.0.1:45999";

/**
 * 用户自己填的接口地址不能只存进 localStorage 就算数，得真的被调用过。
 * 这里起一个最小的 OpenAI 兼容 mock：/chat/completions 返回一句可识别的回复，
 * 其它路径按语音转写格式返回 text，顺便把收到的请求留给断言用。
 */
const MOCK_REPLY_MARKER = "Mock endpoint picked up your question about weekend plans.";
const MOCK_TRANSCRIPT = "This transcript came from the mock speech endpoint.";

async function startMockApi() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type,x-api-key",
      "access-control-allow-methods": "POST,OPTIONS",
      "content-type": "application/json",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      calls.push({
        url: req.url || "",
        method: req.method || "",
        authorization: req.headers.authorization || "",
        xApiKey: req.headers["x-api-key"] || "",
        body: Buffer.concat(chunks).toString("utf8"),
      });
      const payload = (req.url || "").endsWith("/chat/completions")
        ? {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    reply_en: MOCK_REPLY_MARKER,
                    reply_zh: "这是 mock 接口返回的回复。",
                    corrected_text: "",
                    corrections: [],
                    better_expression: "",
                    ielts_tip: "",
                  }),
                },
              },
            ],
          }
        : { text: MOCK_TRANSCRIPT };
      res.writeHead(200, headers);
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function attachDiagnostics(page) {
  const errors = [];
  const requests = [];
  page.on("request", (item) => requests.push(item.url()));
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    // 刻意打不通的接口会自带一条资源加载失败，不属于站点缺陷。
    // Chrome 这类报错正文只有 "Failed to load resource: ..."，URL 在 location 里。
    const consoleSource = message.location()?.url || "";
    if (
      message.text().includes(BAD_API_HOST) ||
      consoleSource.includes(BAD_API_HOST)
    ) {
      return;
    }
    errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.url().includes(BAD_API_HOST)) {
      return;
    }
    errors.push(
      `requestfailed: ${request.url()} ${request.failure()?.errorText || ""}`,
    );
  });
  return { errors, requests };
}

async function openPracticeStudio(page) {
  await page.click("#practiceButton");
  await page.waitForSelector("#practiceStudio:not([hidden])", {
    timeout: 10000,
  });
}

/**
 * 首页有「欢迎回来」遮罩，先走一遍真实注册流程再进小屋；
 * 注册走的是页面上的表单，和用户手动操作完全一致。
 *
 * 注册接口按来源 IP 限流（每 IP 每小时 6 次），反复跑验收时回环地址很快
 * 就用完了配额。这里和接口层用例一样按代理语义换一个来源 IP，其余表单
 * 交互保持原样。
 */
async function enterCabin(page, username) {
  const password = "Test-Passw0rd!";
  const overlay = page.locator("#welcomeOverlay");
  let trickle = null;
  if (await overlay.isVisible().catch(() => false)) {
    const forwardedFor = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    trickle = (route) =>
      route.continue({
        headers: {
          ...route.request().headers(),
          "x-forwarded-for": forwardedFor,
        },
      });
    await page.route("**/api/auth", trickle);
    await page.click("#authModeRegister");
    await page.fill("#username", username);
    await page.fill("#password", password);
    const email = page.locator("#email");
    if (await email.isVisible().catch(() => false)) {
      await email.fill(`${username}@example.com`);
    }
    await page.click("#loginButton");
  }
  await page.waitForSelector("#appView:not([hidden])", { timeout: 20000 });
  if (trickle) {
    await page.unroute("**/api/auth", trickle);
  }
}

async function answerTextarea(page, selector, submitSelector, text) {
  await page.fill(selector, text);
  await page.click(submitSelector);
  await page.waitForTimeout(140);
}

const SAMPLE_ANSWER =
  "I usually start my day with a short walk, because it helps me clear my head before work.";

async function verifyPracticeStudio(page, { mobile = false, mockApi } = {}) {
  const tag = mobile ? "移动端" : "桌面端";
  const { errors, requests } = attachDiagnostics(page);
  const started = Date.now();
  await page.goto(`${base}/index.html`, {
    waitUntil: "load",
    timeout: 30000,
  });
  const loadMs = Date.now() - started;
  await page.waitForTimeout(400);

  const packsDuringBoot = requests.filter((url) =>
    /speaking-(scenarios|ielts)\.js/.test(url),
  );
  check(
    `${tag}：首屏不加载口语素材`,
    packsDuringBoot.length === 0,
    `${packsDuringBoot.length} 个请求`,
  );

  if (!mobile) {
    check(`${tag}：首屏加载 ${loadMs}ms（上限 3000ms）`, loadMs < 3000, "");
  }

  const account = `speakui${mobile ? "m" : "d"}${Date.now().toString(36)}`;
  await enterCabin(page, account);
  check(`${tag}：注册后进入小屋主界面`, true, account);
  // 登录前页面会探测 /api/progress、/api/telemetry，返回 401 是预期行为；
  // 后续只统计进门之后的报错。
  errors.length = 0;

  // 首屏 3000ms 之外再给懒加载留一点余量，避免 CI 抖动。
  await openPracticeStudio(page);
  await page.click("#practiceIeltsTab");
  await page.waitForFunction(
    () => {
      const button = document.querySelector("#ieltsStartButton");
      return Boolean(button && !button.disabled);
    },
    { timeout: 15000 },
  );
  const packsAfterTab = requests.filter((url) =>
    /speaking-(scenarios|ielts)\.js/.test(url),
  );
  check(
    `${tag}：进入口语标签才拉取素材`,
    packsAfterTab.length >= 2,
    `${packsAfterTab.length} 个请求`,
  );

  // 场景筛选：真实生活应命中 8 个成人场景。
  await page.click("#practiceDialogueTab");
  await page.waitForSelector(".dialogue-scenario-button", { timeout: 10000 });
  const filterLabels = await page
    .locator(".dialogue-scenario-filter")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  check(
    `${tag}：场景筛选有全部 / 基础 / 真实三档`,
    filterLabels.length === 3 &&
      filterLabels.some((label) => label.includes("真实")),
    filterLabels.join(" / "),
  );

  await page
    .locator(".dialogue-scenario-filter", { hasText: "真实" })
    .first()
    .click();
  await page.waitForTimeout(300);
  const adultCount = await page
    .locator(".dialogue-scenario-button.is-adult")
    .count();
  const adultActive = await page
    .locator(".dialogue-scenario-filter.is-active")
    .first()
    .textContent();
  check(
    `${tag}：真实生活场景 8 个且筛选态生效`,
    adultCount === 8 && adultActive.includes("真实"),
    `${adultCount} 个场景，当前筛选「${adultActive.trim()}」`,
  );

  // 切回雅思，跑完整流程：Part 1 ×5 → 准备 → Part 2 → Part 3 ×4 → 报告。
  await page.click("#practiceIeltsTab");
  await page.waitForSelector("#ieltsStartButton:not([hidden])", {
    timeout: 10000,
  });
  await page.click("#ieltsStartButton");
  await page.waitForSelector("#ieltsPromptBlock:not([hidden])", {
    timeout: 10000,
  });
  const part1Label = await page.locator("#ieltsPartLabel").textContent();
  check(
    `${tag}：雅思从 Part 1 开始`,
    part1Label.includes("Part 1"),
    part1Label.trim(),
  );

  for (let index = 0; index < 5; index += 1) {
    await answerTextarea(
      page,
      "#ieltsAnswerInput",
      "#ieltsSubmitButton",
      SAMPLE_ANSWER,
    );
  }

  await page.waitForSelector("#ieltsPrepSkipButton:not([hidden])", {
    timeout: 10000,
  });
  const prepLabel = await page.locator("#ieltsPartLabel").textContent();
  const timerBefore = await page.locator("#ieltsTimer").textContent();
  await page.waitForTimeout(1600);
  const timerAfter = await page.locator("#ieltsTimer").textContent();
  check(
    `${tag}：Part 2 准备计时在走`,
    prepLabel.includes("Part 2") && timerBefore !== timerAfter,
    `${timerBefore.trim()} -> ${timerAfter.trim()}`,
  );

  await page.click("#ieltsPrepSkipButton");
  await page.waitForTimeout(200);
  await answerTextarea(
    page,
    "#ieltsAnswerInput",
    "#ieltsSubmitButton",
    SAMPLE_ANSWER,
  );
  await page.waitForTimeout(200);
  const part3Label = await page.locator("#ieltsPartLabel").textContent();
  check(
    `${tag}：Part 2 交卷后进入 Part 3`,
    part3Label.includes("Part 3"),
    part3Label.trim(),
  );

  for (let index = 0; index < 4; index += 1) {
    await answerTextarea(
      page,
      "#ieltsAnswerInput",
      "#ieltsSubmitButton",
      SAMPLE_ANSWER,
    );
  }

  await page.waitForSelector("#ieltsReport:not([hidden])", {
    timeout: 10000,
  });
  const dimensions = await page.locator(".ielts-dimension").count();
  const partRows = await page.locator(".ielts-report-part").count();
  const noteText = await page.locator(".ielts-report-note").first().textContent();
  check(
    `${tag}：生成 5 维评分报告`,
    dimensions === 5,
    `${dimensions} 个维度`,
  );
  check(
    `${tag}：报告按 Part 1/2/3 分项`,
    partRows === 3,
    `${partRows} 行`,
  );
  check(
    `${tag}：成绩标注为本地练习估算`,
    /练习|估算|参考/.test(noteText),
    noteText.replace(/\s+/g, " ").slice(0, 40),
  );

  // 自由对话：本地免费陪练 + 话题轮换。
  await page.click("#practiceFreeTab");
  await page.waitForSelector("#freeAnswerInput", { timeout: 10000 });
  const autoSpeak = page.locator("#freeAutoSpeak");
  if (await autoSpeak.isChecked()) {
    await autoSpeak.uncheck();
  }
  const topicBefore = await page.locator("#freeTopic").inputValue();
  await answerTextarea(page, "#freeAnswerInput", "#freeSubmitButton", "Hi.");
  await page.waitForTimeout(300);
  // 开场白本身就是一条 assistant 消息，真正的回复要看最后一条。
  const shortReply = await page
    .locator(".free-message.is-assistant:not(.is-loading) .free-message-en")
    .last()
    .textContent();
  check(
    `${tag}：短句会被要求补充理由`,
    /reason|detail|again/i.test(shortReply),
    shortReply.replace(/\s+/g, " ").slice(0, 60),
  );

  for (let index = 0; index < 4; index += 1) {
    await answerTextarea(
      page,
      "#freeAnswerInput",
      "#freeSubmitButton",
      SAMPLE_ANSWER,
    );
  }
  await page.waitForTimeout(300);
  const topicAfter = await page.locator("#freeTopic").inputValue();
  check(
    `${tag}：聊满几轮后自动换话题`,
    topicBefore !== topicAfter,
    `${topicBefore} -> ${topicAfter}`,
  );

  // 自定义 API 打不通时必须回退到本地陪练，而不是卡死界面。
  await page.selectOption("#freeChatMode", "api");
  await page.waitForSelector("#freeChatApiFields:not([hidden])", {
    timeout: 5000,
  });
  await page.fill("#freeChatApiUrl", BAD_API_URL);
  await page.fill("#freeChatApiModel", "gpt-4o-mini");
  await page.click("#freeChatApiSaveButton");
  const assistantBefore = await page
    .locator(".free-message.is-assistant:not(.is-loading)")
    .count();
  await answerTextarea(
    page,
    "#freeAnswerInput",
    "#freeSubmitButton",
    SAMPLE_ANSWER,
  );
  await page.waitForFunction(
    () => /回退|失败|切换/.test(document.querySelector("#freeChatApiStatus")?.textContent || ""),
    { timeout: 15000 },
  );
  await page.waitForTimeout(400);
  const fallback = await page.locator("#freeChatApiStatus").textContent();
  const assistantAfter = await page
    .locator(".free-message.is-assistant:not(.is-loading)")
    .count();
  const stillUsable = await page.locator("#freeAnswerInput").isEnabled();
  check(
    `${tag}：Chat API 失败后回退本地陪练`,
    /本地免费陪练/.test(fallback) && stillUsable && assistantAfter > assistantBefore,
    `${fallback.replace(/\s+/g, " ").slice(0, 48)}；回复 ${assistantBefore} -> ${assistantAfter}`,
  );

  // 换成用户自己填的、能通的接口：配置要落盘、刷新还在，而且请求真的打到那里。
  const mockUrl = mockApi.url;
  await page.selectOption("#freeChatMode", "api");
  await page.fill("#freeChatApiUrl", mockUrl);
  await page.fill("#freeChatApiModel", "mock-chat-model");
  await page.fill("#freeChatApiKey", "mock-key");
  await page.selectOption("#freeChatApiAuth", "bearer");
  await page.click("#freeChatApiSaveButton");
  await page.waitForFunction(
    (url) =>
      document.querySelector("#freeChatApiUrl")?.value === url &&
      /已保存/.test(
        document.querySelector("#freeChatApiStatus")?.textContent || "",
      ),
    mockUrl,
    { timeout: 8000 },
  );

  const storedSettings = await page.evaluate(() =>
    window.localStorage.getItem("iball-listening-cabin-speaking-settings"),
  );
  let parsedSettings = {};
  try {
    parsedSettings = JSON.parse(storedSettings || "{}");
  } catch {
    parsedSettings = {};
  }
  check(
    `${tag}：自定义 Chat 接口写入浏览器配置`,
    parsedSettings.freeChatApiUrl === mockUrl &&
      parsedSettings.freeChatApiKey === "mock-key",
    `url=${parsedSettings.freeChatApiUrl || "空"}`,
  );

  await page.reload({ waitUntil: "load", timeout: 30000 });
  await openPracticeStudio(page);
  await page.click("#practiceFreeTab");
  await page.waitForSelector("#freeAnswerInput", { timeout: 10000 });
  const restoredUrl = await page.locator("#freeChatApiUrl").inputValue();
  const restoredMode = await page.locator("#freeChatMode").inputValue();
  check(
    `${tag}：刷新后自定义接口配置还在`,
    restoredUrl === mockUrl && restoredMode === "api",
    `mode=${restoredMode} url=${restoredUrl}`,
  );
  const storedConversation = await page.evaluate(() =>
    window.localStorage.getItem("iball-listening-cabin-free-conversation"),
  );
  let parsedConversation = [];
  try {
    parsedConversation = JSON.parse(storedConversation || "[]");
  } catch {
    parsedConversation = [];
  }
  const restoredMessages = await page
    .locator(".free-message:not(.is-loading)")
    .count();
  check(
    `${tag}：自由对话记录刷新后仍保留`,
    Array.isArray(parsedConversation) &&
      parsedConversation.length >= 6 &&
      restoredMessages === parsedConversation.length,
    `存储 ${parsedConversation.length} 条 / 页面 ${restoredMessages} 条`,
  );

  const callsBefore = mockApi.calls.length;
  await answerTextarea(
    page,
    "#freeAnswerInput",
    "#freeSubmitButton",
    SAMPLE_ANSWER,
  );
  await page
    .waitForFunction(
      (marker) => (document.body.textContent || "").includes(marker),
      MOCK_REPLY_MARKER,
      { timeout: 20000 },
    )
    .catch(() => {});
  const chatCall = mockApi.calls
    .slice(callsBefore)
    .find((item) => item.url.endsWith("/chat/completions"));
  check(
    `${tag}：自由对话真的请求了自定义接口`,
    Boolean(chatCall) &&
      chatCall.authorization === "Bearer mock-key" &&
      chatCall.body.includes("mock-chat-model"),
    chatCall
      ? `${chatCall.url} auth=${chatCall.authorization || "无"}`
      : "没有收到请求",
  );
  const mockReply = await page
    .locator(".free-message.is-assistant:not(.is-loading) .free-message-en")
    .last()
    .textContent();
  check(
    `${tag}：自定义接口的回复显示在对话里`,
    (mockReply || "").includes(MOCK_REPLY_MARKER),
    (mockReply || "").replace(/\s+/g, " ").slice(0, 56),
  );

  // 语音识别接口（练习台）同样是用户自己填的，配置也要跨刷新保留。
  await page.click("#practiceDialogueTab");
  await page.selectOption("#practiceMode", "api");
  await page.fill("#practiceApiUrl", mockUrl);
  await page.fill("#practiceApiModel", "mock-whisper-model");
  await page.fill("#practiceApiKey", "mock-key");
  await page.click("#practiceApiSaveButton");
  await page.waitForTimeout(200);
  const practiceStatus = await page.locator("#practiceApiStatus").textContent();
  check(
    `${tag}：语音识别接口配置可保存`,
    /已保存/.test(practiceStatus || ""),
    (practiceStatus || "").trim().slice(0, 40),
  );

  await page.reload({ waitUntil: "load", timeout: 30000 });
  await openPracticeStudio(page);
  await page.click("#practiceDialogueTab");
  const practiceUrlAfter = await page.locator("#practiceApiUrl").inputValue();
  const practiceModeAfter = await page.locator("#practiceMode").inputValue();
  check(
    `${tag}：语音接口配置刷新后仍在`,
    practiceUrlAfter === mockUrl && practiceModeAfter === "api",
    `mode=${practiceModeAfter} url=${practiceUrlAfter}`,
  );

  // 收尾截图 + 溢出检查。
  await page.evaluate(() =>
    window.scrollTo({ top: 0, behavior: "instant" }),
  );
  await page.waitForTimeout(200);
  const shot = path.join(outDir, mobile ? "practice-mobile.png" : "practice-desktop.png");
  await page.screenshot({ path: shot, fullPage: false });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(
    `${tag}：练习台没有横向溢出`,
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
  );
  check(
    `${tag}：练习台没有控制台报错`,
    errors.length === 0,
    errors.slice(0, 3).join(" | ") || "无",
  );
  console.log(`   截图: ${shot}`);
}

async function verifyOpenSourcePanel(page, { mobile = false } = {}) {
  const tag = mobile ? "移动端" : "桌面端";
  console.log(`\n== ${tag}：开源方案索引`);
  const { errors } = attachDiagnostics(page);
  await page.goto(`${base}/index.html`, { waitUntil: "load", timeout: 30000 });
  await enterCabin(page, `osindex${Math.random().toString(36).slice(2, 10)}`);

  await page.click("#openSourceButton");
  await page.waitForSelector("#openSourcePanel:not([hidden])", {
    timeout: 10000,
  });
  check(
    `${tag}：开源方案索引可以打开`,
    await page.locator("#openSourceList .open-source-item").count() >= 10,
    `${await page.locator("#openSourceList .open-source-item").count()} 条`,
  );
  check(
    `${tag}：索引条目都带仓库链接`,
    (await page.locator("#openSourceList .open-source-link").count()) ===
      (await page.locator("#openSourceList .open-source-item").count()),
    `链接 ${await page.locator("#openSourceList .open-source-link").count()} 个`,
  );

  const filters = page.locator(".open-source-filter");
  const filterCount = await filters.count();
  check(`${tag}：按模块筛选可用`, filterCount >= 5, `${filterCount} 个筛选`);
  await page.click('[data-open-source-filter="ielts"]');
  const ieltsCount = await page.locator("#openSourceList .open-source-item").count();
  check(
    `${tag}：筛选后只剩对应模块条目`,
    ieltsCount > 0 && ieltsCount < 5,
    `${ieltsCount} 条`,
  );
  await page.click('[data-open-source-filter="all"]');

  await page.fill("#openSourceQuery", "ecdict");
  const filtered = await page.locator("#openSourceList .open-source-item").count();
  check(`${tag}：关键词在索引内过滤`, filtered === 1, `${filtered} 条`);
  await page.fill("#openSourceQuery", "");

  if (!mobile) {
    const popupPromise = page.waitForEvent("popup", { timeout: 10000 });
    await page.click("#openSourceSubmit");
    const popup = await popupPromise;
    const popupUrl = popup.url();
    check(
      "桌面端：可以跳转 GitHub 搜索",
      popupUrl.startsWith("https://github.com/search") &&
        popupUrl.includes("q="),
      popupUrl,
    );
    await popup.close();
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(160);
  check(
    `${tag}：Esc 可以关闭索引`,
    await page.locator("#openSourcePanel").isHidden(),
    `hidden=${await page.locator("#openSourcePanel").isHidden()}`,
  );

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(
    `${tag}：索引没有横向溢出`,
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
  );
  check(
    `${tag}：索引没有控制台报错`,
    errors.length === 0,
    errors.slice(0, 3).join(" | ") || "无",
  );
}

async function verifyDailyListening(page) {
  console.log("\n== 桌面端：日常听力模块");
  const { errors, requests } = attachDiagnostics(page);
  await page.goto(`${base}/listen.html`, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#sourceSelect", { timeout: 10000 });
  await page.selectOption("#sourceSelect", "daily");
  await page.waitForFunction(
    () => (document.querySelector("#setSelect")?.options.length || 0) > 1,
    { timeout: 15000 },
  );
  const paperCount = await page.locator("#setSelect option").count();
  check("日常听力套数可选", paperCount >= 4, `${paperCount} 个选项`);

  await page.waitForFunction(
    () => document.querySelectorAll(".listen-item").length > 0,
    { timeout: 15000 },
  );
  const itemCount = await page.locator(".listen-item").count();
  check("日常听力渲染句子列表", itemCount > 0, `${itemCount} 句`);

  const loaded = requests.filter((url) =>
    url.includes("/daily-listening-data/"),
  );
  check(
    "日常听力按套懒加载（只取当前一份）",
    loaded.length === 1,
    loaded.map((url) => url.split("/").pop()).join(", ") || "(无)",
  );

  await page.locator(".listen-item").first().click();
  await page.waitForTimeout(600);
  const playLabel = await page.locator("#playButtonLabel").textContent();
  check(
    "句子可播放且播放键进入播放态",
    /停止|暂停|播放/.test(playLabel),
    `按键文案「${playLabel.trim()}」`,
  );

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(
    "听力页没有横向溢出",
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
  );
  check(
    "听力页没有控制台报错",
    errors.length === 0,
    errors.slice(0, 3).join(" | ") || "无",
  );
  const shot = path.join(outDir, "listen-daily.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`   截图: ${shot}`);
}

/**
 * 独立口语房间：从主站入口点进去，换人、开场、接一轮、看复盘。
 * 把「像打电话」这件事拆成可断言的行为，顺带守住移动端不横向溢出。
 */
const SPOKEN_LINE =
  "I spent most of the weekend fixing my bike, and now my hands are covered in grease.";

async function verifySpeakingRoom(page, { mobile = false } = {}) {
  const tag = mobile ? "移动端" : "桌面端";
  console.log(`\n== ${tag}：独立口语房间`);
  const { errors, requests } = attachDiagnostics(page);

  await page.goto(`${base}/index.html`, { waitUntil: "load", timeout: 30000 });
  const entry = page.locator('a.library-shortcut[href="./speaking.html"]');
  check(
    `${tag}：主站素材库有口语房间入口`,
    await entry.count() > 0,
    "library-shortcuts",
  );

  await page.goto(`${base}/speaking.html`, {
    waitUntil: "load",
    timeout: 30000,
  });
  await page.waitForSelector(".persona-card", { timeout: 15000 });

  const personaCount = await page.locator(".persona-card").count();
  check(`${tag}：人物卡片渲染`, personaCount >= 8, `${personaCount} 个`);

  const topicCount = await page.locator("#speakingTopic option").count();
  check(`${tag}：开场话题可选`, topicCount >= 10, `${topicCount} 个`);

  // Headless 里没有可用音源，切到「只看文本」，同时也验证了模式开关。
  await page.click('#modeGroup [data-mode="quiet"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('#modeGroup [data-mode="quiet"]')
        ?.classList.contains("is-active"),
    { timeout: 5000 },
  );
  check(`${tag}：陪聊方式可以切换`, true, "只看文本");

  // 挑最后一张卡片，确认换人真的会改通话对象。
  const target = page.locator(".persona-card").nth(personaCount - 1);
  const targetName = (
    (await target.locator(".persona-name strong").textContent()) || ""
  ).trim();
  await target.click();
  const callName = ((await page.locator("#callName").textContent()) || "").trim();
  check(
    `${tag}：换人后通话栏跟着换`,
    callName === targetName && callName.length > 0,
    `${callName || "(空)"}`,
  );

  await page.click("#speakingStartButton");
  await page.waitForFunction(
    () => document.querySelectorAll(".call-message.is-partner").length >= 1,
    { timeout: 10000 },
  );
  const opener = (
    (await page.locator(".call-message.is-partner .call-bubble").first().textContent()) ||
    ""
  ).trim();
  check(
    `${tag}：开场白由对方先说`,
    opener.length > 0,
    opener.slice(0, 40),
  );

  await page.fill("#speakingInput", SPOKEN_LINE);
  await page.click("#speakingSendButton");
  await page.waitForSelector(".call-message.is-user", { timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".call-message.is-partner").length >= 2,
    { timeout: 15000 },
  );

  const userLine = (
    (await page.locator(".call-message.is-user .call-bubble").first().textContent()) ||
    ""
  ).trim();
  check(`${tag}：我这句话进了通话记录`, userLine === SPOKEN_LINE, "");

  const reply = (
    (await page.locator(".call-message.is-partner .call-bubble").last().textContent()) ||
    ""
  ).trim();
  check(
    `${tag}：对方接了话而不是复读`,
    reply.length > 0 && reply !== opener && reply !== SPOKEN_LINE,
    reply.slice(0, 40),
  );
  check(
    `${tag}：本地陪聊不碰外部接口`,
    !requests.some((url) => url.includes("chat/completions")),
    "0 次外部请求",
  );

  await page.click("#speakingRecapButton");
  await page.waitForSelector("#speakingRecapPanel:not([hidden])", {
    timeout: 10000,
  });
  const statCount = await page.locator(".recap-stat").count();
  const blockCount = await page.locator("#recapBody .recap-block").count();
  check(
    `${tag}：复盘给出统计和三块建议`,
    statCount >= 3 && blockCount >= 3,
    `${statCount} 个统计 / ${blockCount} 块`,
  );

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  check(
    `${tag}：口语房间没有横向溢出`,
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `scrollWidth=${metrics.scrollWidth} clientWidth=${metrics.clientWidth}`,
  );
  check(
    `${tag}：口语房间没有控制台报错`,
    errors.length === 0,
    errors.slice(0, 3).join(" | ") || "无",
  );

  const shot = path.join(outDir, `speaking-room-${mobile ? "mobile" : "desktop"}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`   截图: ${shot}`);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  console.log(`验收目标：${base}`);

  await verifyAccountIsolation();

  const executablePath = await findBrowser();
  const mockApi = await startMockApi();
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const desktop = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await verifyPracticeStudio(await desktop.newPage(), { mockApi });
    await verifyOpenSourcePanel(await desktop.newPage());
    await verifySpeakingRoom(await desktop.newPage());
    await desktop.close();

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await verifyPracticeStudio(await mobile.newPage(), {
      mobile: true,
      mockApi,
    });
    await verifyOpenSourcePanel(await mobile.newPage(), { mobile: true });
    await verifySpeakingRoom(await mobile.newPage(), { mobile: true });
    await mobile.close();

    const listen = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await verifyDailyListening(await listen.newPage());
    await listen.close();
  } finally {
    await browser.close();
    await mockApi.close();
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\n共 ${results.length} 项，通过 ${passed}，失败 ${failed}`);
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
