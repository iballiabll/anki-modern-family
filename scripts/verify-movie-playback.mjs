/**
 * 逐句原声播放的验收关卡。
 *
 * 整集原声是一个把每句台词首尾相接拼起来的“精灵音频”。只要播放器没有在句尾
 * 真正暂停，音频元素就会顺着往下播，听感上就是这一句里混进了后面几句台词。
 * 本脚本用系统 Chrome 打开电影页，随机抽样若干句，检查：
 *
 *   1. 播放请求的时间点确实落在这一句（或这一段的几句）上；
 *   2. 停下来时没有越过最后一句的结束点；
 *   3. 停下来之后音频元素处于 paused 状态。
 *
 * 用法：
 *   node scripts/verify-movie-playback.mjs --base http://127.0.0.1:4175
 *   node scripts/verify-movie-playback.mjs --base https://www.iball.top --episode S01E24
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
const samples = Math.max(4, Number(arg("samples", "12")));
const maxOvershoot = Number(arg("maxOvershoot", "0.07"));
const maxUndershoot = Number(arg("maxUndershoot", "0.35"));

const manifestUrl = `${base}/movie-data/audio/${episode}.json`;
const response = await fetch(manifestUrl);
if (!response.ok) {
  throw new Error(`${manifestUrl} 返回 ${response.status}`);
}
const manifest = await response.json();
const cues = [...(manifest.lineCues || [])].sort((left, right) => left.start - right.start);
if (!cues.length) {
  throw new Error(`${episode} 没有逐句原声切片`);
}

function nearestCue(seconds) {
  let best = null;
  let bestDelta = Infinity;
  cues.forEach((cue) => {
    const delta = Math.abs(Number(cue.start) - seconds);
    if (delta < bestDelta) {
      best = cue;
      bestDelta = delta;
    }
  });
  return bestDelta <= 0.08 ? best : null;
}

const browser = await chromium.launch({
  executablePath: await findBrowser(),
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const failures = [];
const rows = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__cueLog = [];
    const log = (entry) => window.__cueLog.push({ ...entry, wall: performance.now() });
    const OriginalAudio = window.Audio;
    window.__cueAudio = [];
    function PatchedAudio(...args) {
      const element = new OriginalAudio(...args);
      window.__cueAudio.push(element);
      return element;
    }
    PatchedAudio.prototype = OriginalAudio.prototype;
    window.Audio = PatchedAudio;

    const proto = window.HTMLMediaElement.prototype;
    const originalPlay = proto.play;
    const originalPause = proto.pause;
    proto.play = function patchedPlay(...args) {
      if (window.__cueAudio.includes(this)) {
        log({ type: "play", t: this.currentTime });
      }
      return originalPlay.apply(this, args);
    };
    proto.pause = function patchedPause(...args) {
      if (window.__cueAudio.includes(this)) {
        log({ type: "pause", t: this.currentTime });
      }
      return originalPause.apply(this, args);
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLMediaElement.prototype,
      "currentTime",
    );
    Object.defineProperty(window.HTMLMediaElement.prototype, "currentTime", {
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        if (window.__cueAudio.includes(this)) {
          log({ type: "seek", t: Number(value) });
        }
        descriptor.set.call(this, value);
      },
    });
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  await page.goto(`${base}/movie.html`, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(1200);

  const labels = await page.locator("#episodeSelect option").allTextContents();
  const label = labels.find((text) => text.includes(episode));
  if (!label) {
    throw new Error(`剧集下拉里没有 ${episode}（现有：${labels.slice(0, 5).join(" / ")}）`);
  }
  await page.selectOption("#episodeSelect", { label });
  await page.waitForTimeout(2200);

  const buttons = page.locator(".movie-play-button");
  const total = await buttons.count();
  if (!total) {
    throw new Error("电影页没有渲染出逐句播放按钮");
  }

  const step = Math.max(1, Math.floor(total / samples));
  const indexes = [];
  for (let value = 0; value < total && indexes.length < samples; value += step) {
    indexes.push(value);
  }

  for (const index of indexes) {
    const marker = await page.evaluate(() => window.__cueLog.length);
    await buttons.nth(index).click({ timeout: 15000 }).catch((error) => {
      failures.push(`第 ${index + 1} 个按钮点击失败：${error.message.split("\n")[0]}`);
    });

    // 每次起播前播放器都会先 pause 一次（此时停在上一句的收句位置），
    // 所以只认“最后一次跳转之后”发生的暂停。
    const deadline = Date.now() + 30000;
    let stopped = null;
    while (Date.now() < deadline) {
      const events = await page.evaluate((from) => window.__cueLog.slice(from), marker);
      const seeks = events.filter((event) => event.type === "seek");
      const lastSeek = seeks[seeks.length - 1];
      if (lastSeek) {
        const pause = events
          .filter(
            (event) =>
              event.type === "pause" &&
              event.wall > lastSeek.wall &&
              event.t >= Number(lastSeek.t) - 0.05,
          )
          .pop();
        if (pause) {
          stopped = {
            seeks: seeks.map((event) => event.t),
            pause: pause.t,
          };
          break;
        }
      }
      await page.waitForTimeout(120);
    }

    if (!stopped) {
      failures.push(`按钮 ${index + 1}：播放后没有观察到暂停，音频可能还在往下播`);
      await buttons.nth(index).click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
      rows.push({ index: index + 1, result: "no-pause" });
      continue;
    }

    const played = stopped.seeks
      .map((seconds) => nearestCue(seconds))
      .filter(Boolean);
    if (!played.length) {
      failures.push(`按钮 ${index + 1}：播放位置 ${stopped.seeks.join(",")} 对不上任何切片`);
      rows.push({ index: index + 1, result: "unmatched" });
      continue;
    }

    const last = played[played.length - 1];
    const overshoot = Number((stopped.pause - Number(last.end)).toFixed(3));
    const state = await page.evaluate(() =>
      (window.__cueAudio || []).map((element) => ({
        paused: element.paused,
        t: Number(element.currentTime.toFixed(3)),
      })),
    );
    const leaked = state.filter((item) => !item.paused);
    const row = {
      index: index + 1,
      cues: played.map((cue) => cue.id).join("+"),
      cueEnd: Number(Number(last.end).toFixed(3)),
      stoppedAt: Number(stopped.pause.toFixed(3)),
      overshoot,
      paused: leaked.length === 0,
    };
    rows.push(row);

    if (overshoot > maxOvershoot) {
      failures.push(
        `按钮 ${row.index}（${row.cues}）：在切片结束点之后又播了 ${overshoot}s，越界到下一句`,
      );
    }
    if (overshoot < -maxUndershoot) {
      failures.push(
        `按钮 ${row.index}（${row.cues}）：提前 ${Math.abs(overshoot)}s 收句，尾音被截掉`,
      );
    }
    if (leaked.length) {
      failures.push(
        `按钮 ${row.index}：收句后音频元素仍在播放（t=${leaked[0].t}s）`,
      );
    }
    await page.waitForTimeout(180);
  }

  rows.forEach((row) => {
    console.log(
      row.result
        ? `#${row.index}\t${row.result}`
        : `#${row.index}\t${row.cues}\tstop=${row.stoppedAt}\tend=${row.cueEnd}\tover=${row.overshoot}\tpaused=${row.paused}`,
    );
  });
  if (consoleErrors.length) {
    failures.push(`控制台报错：${consoleErrors.slice(0, 3).join(" | ")}`);
  }
  await context.close();
} finally {
  await browser.close();
}

console.log(
  `\n${episode}：抽样 ${rows.length} 句，${failures.length ? `${failures.length} 项不合格` : "全部合格"}`,
);
failures.forEach((failure) => console.log(`  ✗ ${failure}`));
process.exit(failures.length ? 1 : 0);
