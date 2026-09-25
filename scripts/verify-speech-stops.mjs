/**
 * 朗读硬停止验收：确认每次“朗读”真正开声之前，一定先把上一段停掉。
 *
 * 用法：
 *   node scripts/verify-speech-stops.mjs --base http://127.0.0.1:4175
 *
 * 页面里的 speechSynthesis 会被换成记录调用的替身，SpeechSynthesisUtterance
 * 也换成可以手动触发 end / error 的替身，因此断言不依赖机器上装了哪些语音包。
 */

import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
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

const STOP_SEQUENCE = ["pause", "cancel", "resume", "speak"];

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

const failures = [];

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ok    ${label}`);
    return;
  }
  console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  failures.push(label);
}

function sameSequence(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

async function installSpeechStub(page) {
  await page.addInitScript(() => {
    const NativeUtterance = window.SpeechSynthesisUtterance;
    const recorder = { calls: [], utterances: [] };
    window.__speech = recorder;

    class RecordingUtterance extends NativeUtterance {
      constructor(text) {
        super(text);
        recorder.utterances.push(this);
      }
    }
    window.SpeechSynthesisUtterance = RecordingUtterance;

    const stub = {
      paused: false,
      pending: false,
      speaking: false,
      isStub: true,
      pause() {
        recorder.calls.push("pause");
      },
      cancel() {
        recorder.calls.push("cancel");
      },
      resume() {
        recorder.calls.push("resume");
      },
      speak() {
        recorder.calls.push("speak");
      },
      getVoices() {
        // 故意返回空列表：页面就不会去设 utterance.voice，替身也不需要伪造语音对象。
        return [];
      },
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      get: () => stub,
    });
  });
}

async function readCalls(page) {
  return page.evaluate(() => (window.__speech?.calls || []).slice());
}

async function stubInstalled(page) {
  return page.evaluate(
    () => window.speechSynthesis?.isStub === true && Array.isArray(window.__speech?.calls),
  );
}

async function pressEnd(page, index) {
  await page.evaluate((position) => {
    window.__speech.utterances[position]?.dispatchEvent(new Event("end"));
  }, index);
}

async function buttonPlaying(locator, index) {
  return locator.nth(index).evaluate((element) => element.classList.contains("is-playing"));
}

async function verifyPeriodical(browser, base) {
  console.log("\n外刊精读 · periodical.html");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSpeechStub(page);
  await page.goto(`${base}/periodical.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".periodical-paragraph-tools .periodical-icon-button", {
    timeout: 45000,
  });

  check("页面装入验收替身", await stubInstalled(page));

  const buttons = page.locator(".periodical-paragraph-tools .periodical-icon-button");
  check("精读段落的朗读按钮可用", (await buttons.count()) >= 2, `count=${await buttons.count()}`);

  await buttons.nth(0).click();
  check(
    "第一次朗读：先停后说",
    sameSequence(await readCalls(page), STOP_SEQUENCE),
    JSON.stringify(await readCalls(page)),
  );
  check("朗读中的按钮有播放态", await buttonPlaying(buttons, 0));

  await buttons.nth(1).click();
  check(
    "换一段朗读：又先停一次再开口",
    sameSequence(await readCalls(page), [...STOP_SEQUENCE, ...STOP_SEQUENCE]),
    JSON.stringify(await readCalls(page)),
  );

  await buttons.nth(1).click();
  check(
    "同一按钮再读：每次都重新停一遍",
    sameSequence(await readCalls(page), [...STOP_SEQUENCE, ...STOP_SEQUENCE, ...STOP_SEQUENCE]),
    JSON.stringify(await readCalls(page)),
  );

  await pressEnd(page, 1);
  check(
    "上一段迟到的结束回调不会掐掉新一段",
    (await buttonPlaying(buttons, 1)) === true,
  );

  await pressEnd(page, 2);
  check("当前一段读完后按钮复位", (await buttonPlaying(buttons, 1)) === false);
  check("朗读过程没有脚本报错", errors.length === 0, errors.join(" | "));

  await context.close();
}

async function verifyMovie(browser, base) {
  console.log("\n美剧台词精读 · movie.html（原声缺失时走浏览器语音）");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installSpeechStub(page);
  // 把逐句清单换成没有精灵音频的版本，逼播放按钮落到浏览器语音分支。
  await page.route("**/movie-data/audio/*.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sprite: null, cues: [], lineCues: [] }),
    }),
  );
  await page.goto(`${base}/movie.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".movie-play-button", { timeout: 45000 });

  check("页面装入验收替身", await stubInstalled(page));

  const buttons = page.locator(".movie-play-button");
  check("台词行的播放按钮可用", (await buttons.count()) >= 2, `count=${await buttons.count()}`);

  await buttons.nth(0).click();
  check(
    "第一次朗读：先停后说",
    sameSequence(await readCalls(page), STOP_SEQUENCE),
    JSON.stringify(await readCalls(page)),
  );

  await buttons.nth(1).click();
  check(
    "换一句朗读：先停掉上一句",
    sameSequence(await readCalls(page), [...STOP_SEQUENCE, ...STOP_SEQUENCE]),
    JSON.stringify(await readCalls(page)),
  );
  check("朗读过程没有脚本报错", errors.length === 0, errors.join(" | "));

  await context.close();
}

async function main() {
  const base = arg("base", "http://127.0.0.1:4175").replace(/\/$/, "");
  const browser = await chromium.launch({
    executablePath: await findBrowser(),
    headless: true,
  });
  try {
    await verifyPeriodical(browser, base);
    await verifyMovie(browser, base);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.log(`\n${failures.length} 项未通过：`);
    failures.forEach((label) => console.log(`  - ${label}`));
    process.exitCode = 1;
    return;
  }
  console.log("\n朗读硬停止验收通过：两处页面都先停后说，旧回调不会干扰新一段。");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
