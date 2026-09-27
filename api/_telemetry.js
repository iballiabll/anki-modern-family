/**
 * 监控：记录谁在什么时候调了哪个接口、有没有报错、耗时多少。
 *
 * 边界（有意为之）：
 *   · 只记录接口名、状态码、耗时、账号名和页面路径；
 *   · 不记录请求体、作文内容、对话内容、密码、API Key、Authorization；
 *   · IP 只留加盐散列，不落原文；
 *   · 内存里最多留 2000 条 / 30 天，超过就丢最旧的，单文件不会无限涨。
 */

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");
const { dataDir } = require("./_user-store.js");

const MAX_EVENTS = 2000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const FLUSH_DELAY_MS = 2500;
const MAX_ACTIVITY_USERS = 200;
const MAX_MODULES = 24;
const MAX_DAYS = 14;
// 学生都在国内，按 UTC+8 切天，避免 VPS 用 UTC 时「今天」少 8 小时。
const DAY_OFFSET_MS = 8 * 60 * 60 * 1000;

const annotations = new WeakMap();
let memory = null;
let loadPromise = null;
let flushTimer = null;
let flushChain = Promise.resolve();

function telemetryPath() {
  return path.join(dataDir(), "telemetry.json");
}

function emptyMemory() {
  return { version: 1, events: [], activity: {}, updatedAt: "" };
}

async function load() {
  if (memory) {
    return memory;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await fsp.readFile(telemetryPath(), "utf8");
        const parsed = JSON.parse(raw);
        memory = {
          version: 1,
          events: Array.isArray(parsed?.events) ? parsed.events : [],
          activity:
            parsed?.activity && typeof parsed.activity === "object"
              ? parsed.activity
              : {},
          updatedAt: parsed?.updatedAt || "",
        };
      } catch {
        memory = emptyMemory();
      }
      return memory;
    })();
  }
  return loadPromise;
}

function scheduleFlush() {
  if (flushTimer) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().catch(() => {});
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

async function flush() {
  flushChain = flushChain.then(async () => {
    const store = await load();
    const now = Date.now();
    store.events = store.events
      .filter((event) => now - Number(event.at || 0) < MAX_AGE_MS)
      .slice(-MAX_EVENTS);
    const activityEntries = Object.entries(store.activity)
      .sort(
        (left, right) =>
          Date.parse(right[1]?.lastSeenAt || 0) -
          Date.parse(left[1]?.lastSeenAt || 0),
      )
      .slice(0, MAX_ACTIVITY_USERS);
    store.activity = Object.fromEntries(activityEntries);
    store.updatedAt = new Date(now).toISOString();

    await fsp.mkdir(dataDir(), { recursive: true, mode: 0o700 });
    const payload = `${JSON.stringify(store, null, 2)}\n`;
    const tempPath = `${telemetryPath()}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tempPath, payload, { mode: 0o600 });
    await fsp.rename(tempPath, telemetryPath());
  });
  return flushChain;
}

function hashIp(request) {
  const raw = String(
    request?.headers?.["x-forwarded-for"] ||
      request?.headers?.["x-real-ip"] ||
      request?.socket?.remoteAddress ||
      "",
  )
    .split(",")[0]
    .trim();
  return hashIpValue(raw);
}

function hashIpValue(raw) {
  const value = String(raw || "").trim();
  if (!value) {
    return "";
  }
  return crypto
    .createHash("sha256")
    .update(`${process.env.SESSION_SECRET || "iball"}:${value}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * 落到文件里的 IP 一律是散列。
 *
 * 调用方有的已经传散列，有的图省事直接传 clientIp() 出来的原文，
 * 所以在存储这一层统一过一遍：看着像 IP 就散列，否则当成已有散列直接用。
 * 这样不会再出现「注释说脱敏、文件里躺着明文 IP」的情况。
 */
function privacyIp(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const looksLikeIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(text);
  const looksLikeIpv6 = text.includes(":") && /^[0-9a-fA-F:.]+$/.test(text);
  return looksLikeIpv4 || looksLikeIpv6 ? hashIpValue(text) : text;
}

function short(value, max = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** UTC+8 的 YYYY-MM-DD，用来按「国内今天」汇总在线时长。 */
function dayKey(timestamp = Date.now()) {
  return new Date(Number(timestamp) + DAY_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * 心跳只带页面路径和标题，模块名在服务端推。
 * 小屋是单页应用，用页面标题区分站内的计划 / 错题本 / 待复盘等页面。
 */
function moduleForPage(page, title = "") {
  const path = String(page || "")
    .trim()
    .toLowerCase();
  if (path.startsWith("/xxrj")) {
    const label = String(title || "")
      .split(/[·|｜|,，:：\-—]/)[0]
      .trim()
      .slice(0, 20);
    return label ? `小屋 · ${label}` : "小屋";
  }
  const rules = [
    ["/vocab", "词汇库"],
    ["/review", "错词复习"],
    ["/quiz", "单词测试"],
    ["/leaderboard", "排行榜"],
    ["/listen", "听力"],
    ["/shadow", "跟读"],
    ["/speaking", "口语"],
    ["/intensive", "精读"],
    ["/periodical", "外刊"],
    ["/reading", "阅读"],
    ["/movie", "影视"],
    ["/writing", "写作"],
    ["/kaoyan", "考研"],
    ["/admin", "控制台"],
  ];
  for (const [prefix, label] of rules) {
    if (path.startsWith(prefix)) {
      return label;
    }
  }
  if (!path || path === "/" || path.endsWith("/index.html")) {
    return "首页";
  }
  return "其他";
}

async function record(event) {
  const store = await load();
  store.events.push({
    id: crypto.randomUUID().slice(0, 8),
    at: Date.now(),
    name: short(event.name, 40) || "api",
    method: short(event.method, 8).toUpperCase() || "GET",
    status: Number(event.status) || 200,
    ms: Math.max(0, Number(event.ms) || 0),
    user: short(event.user, 32),
    userId: short(event.userId, 40),
    ip: short(privacyIp(event.ip), 16),
    ua: short(event.ua, 60),
    meta: event.meta && typeof event.meta === "object" ? event.meta : {},
    error: short(event.error, 120),
  });
  if (store.events.length > MAX_EVENTS) {
    store.events = store.events.slice(-MAX_EVENTS);
  }
  scheduleFlush();
}

/**
 * 记一次页面心跳，并顺手算出在线时长和模块使用。
 *
 * 在线时长按相邻两次心跳的间隔累加，间隔超过 ONLINE_WINDOW_MS 的那段不算
 * （合盖、关网页或长时间挂后台都会自然断开），并记成新的一次会话。这一段
 * 时间算在「上一次心跳所在模块」头上，更接近实际待在哪。
 */
async function recordActivity({ userId, username, page, title, ua, ip }) {
  if (!userId) {
    return null;
  }
  const store = await load();
  const key = String(userId);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const current = store.activity[key] || {
    userId: key,
    username: "",
    page: "",
    title: "",
    beats: 0,
    sessions: 0,
    onlineMs: 0,
    modules: {},
    days: {},
    firstSeenAt: now,
    lastSeenAt: now,
    pages: {},
  };
  const pageKey = short(page, 60) || "/";
  const module = short(moduleForPage(pageKey, title), 40) || "其他";
  const previousSeenMs = Date.parse(current.lastSeenAt || "");
  const gapMs = Number.isFinite(previousSeenMs) ? nowMs - previousSeenMs : 0;
  const countedMs = gapMs > 0 && gapMs <= ONLINE_WINDOW_MS ? gapMs : 0;

  current.username = short(username, 32) || current.username;
  current.page = pageKey;
  current.title = short(title, 60);
  current.beats = Number(current.beats || 0) + 1;
  current.sessions = Number(current.sessions || 0) + (gapMs > ONLINE_WINDOW_MS ? 1 : 0);
  current.modules =
    current.modules && typeof current.modules === "object" ? current.modules : {};
  const bucket = current.modules[module] || { beats: 0, ms: 0 };
  bucket.beats = Number(bucket.beats || 0) + 1;
  current.modules[module] = bucket;

  if (countedMs > 0) {
    current.onlineMs = Number(current.onlineMs || 0) + countedMs;
    // 间隔算给上一次心跳所在的模块，代表这段时间实际待在哪。
    const spentOn = current.lastModule && current.modules[current.lastModule]
      ? current.lastModule
      : module;
    current.modules[spentOn].ms = Number(current.modules[spentOn].ms || 0) + countedMs;
    current.days = current.days && typeof current.days === "object" ? current.days : {};
    const day = dayKey(nowMs);
    current.days[day] = Number(current.days[day] || 0) + countedMs;
  }
  current.lastModule = module;
  current.lastSeenAt = now;
  current.lastIp = short(privacyIp(ip), 16);
  current.ua = short(ua, 60);
  current.pages = current.pages && typeof current.pages === "object" ? current.pages : {};
  current.pages[pageKey] = Number(current.pages[pageKey] || 0) + 1;
  // 页面、模块、按天时长都有上限，防止长年累月把文件撑大。
  const pages = Object.entries(current.pages).sort(
    (left, right) => right[1] - left[1],
  );
  current.pages = Object.fromEntries(pages.slice(0, 40));
  const modules = Object.entries(current.modules)
    .sort(
      (left, right) =>
        Number(right[1]?.ms || 0) - Number(left[1]?.ms || 0) ||
        Number(right[1]?.beats || 0) - Number(left[1]?.beats || 0),
    )
    .slice(0, MAX_MODULES);
  current.modules = Object.fromEntries(modules);
  const days = Object.entries(current.days)
    .sort((left, right) => String(right[0]).localeCompare(String(left[0])))
    .slice(0, MAX_DAYS);
  current.days = Object.fromEntries(days);

  store.activity[key] = current;
  scheduleFlush();
  return current;
}

/** 删除账号时一起忘掉这个人的活动记录，控制台里不留半个人。 */
async function forgetActivity(userId) {
  const key = String(userId || "").trim();
  if (!key) {
    return false;
  }
  const store = await load();
  if (!store.activity || !store.activity[key]) {
    return false;
  }
  delete store.activity[key];
  scheduleFlush();
  return true;
}

/** 处理函数里调用 telemetry.annotate(response, {...}) 给这次请求打标签。 */
function annotate(response, fields = {}) {
  if (!response || typeof response !== "object") {
    return;
  }
  const current = annotations.get(response) || {};
  annotations.set(response, { ...current, ...fields });
}

function setMeta(response, meta = {}) {
  const current = annotations.get(response) || {};
  annotations.set(response, {
    ...current,
    meta: { ...(current.meta || {}), ...meta },
  });
}

/**
 * 包一层请求处理函数：记录耗时和状态码。
 * 抛出的异常照常往上抛，由接口自己决定怎么回。
 */
function wrap(name, handler) {
  return async function instrumented(request, response) {
    const started = Date.now();
    let failure = "";
    try {
      return await handler(request, response);
    } catch (error) {
      failure = error?.message || "未知错误";
      throw error;
    } finally {
      const fields = annotations.get(response) || {};
      annotations.delete(response);
      const status = Number(response?.statusCode) || (failure ? 500 : 200);
      record({
        name,
        method: request?.method,
        status,
        ms: Date.now() - started,
        user: fields.user || "",
        userId: fields.userId || "",
        ip: fields.ip || hashIp(request),
        ua: request?.headers?.["user-agent"],
        meta: fields.meta || {},
        error: failure,
      }).catch(() => {});
    }
  };
}

async function recent({ limit = 60, since = 0, user = "", onlyErrors = false } = {}) {
  const store = await load();
  const size = Math.min(400, Math.max(1, Number(limit) || 60));
  const filterUser = String(user || "").toLowerCase();
  return store.events
    .filter((event) => Number(event.at) >= Number(since || 0))
    .filter((event) => !onlyErrors || Number(event.status) >= 400)
    .filter(
      (event) =>
        !filterUser ||
        String(event.user || "").toLowerCase() === filterUser,
    )
    .slice(-size)
    .reverse();
}

function summarize(events) {
  const now = Date.now();
  const hour = events.filter((event) => now - Number(event.at) < 60 * 60 * 1000);
  const byName = new Map();
  let errors = 0;
  let totalMs = 0;
  for (const event of hour) {
    const key = event.name || "api";
    byName.set(key, (byName.get(key) || 0) + 1);
    if (Number(event.status) >= 400) {
      errors += 1;
    }
    totalMs += Number(event.ms) || 0;
  }
  const endpoints = [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count);
  return {
    callsLastHour: hour.length,
    errorsLastHour: errors,
    avgMsLastHour: hour.length ? Math.round(totalMs / hour.length) : 0,
    endpoints,
  };
}

async function summary() {
  const store = await load();
  const now = Date.now();
  const today = dayKey(now);
  const activity = Object.values(store.activity || {})
    .map((entry) => {
      const days = Object.entries(entry.days || {})
        .map(([date, ms]) => ({ date, ms: Math.round(Number(ms) || 0) }))
        .sort((left, right) => String(right.date).localeCompare(String(left.date)))
        .slice(0, 7);
      const modules = Object.entries(entry.modules || {})
        .map(([name, stats]) => ({
          name,
          beats: Number(stats?.beats) || 0,
          ms: Math.round(Number(stats?.ms) || 0),
        }))
        .sort(
          (left, right) =>
            right.ms - left.ms || right.beats - left.beats || left.name.localeCompare(right.name),
        )
        .slice(0, 8);
      return {
        ...entry,
        online: now - Date.parse(entry.lastSeenAt || 0) < ONLINE_WINDOW_MS,
        minutesAgo: Math.max(
          0,
          Math.round((now - Date.parse(entry.lastSeenAt || 0)) / 60000),
        ),
        onlineMs: Math.round(Number(entry.onlineMs) || 0),
        onlineMsToday: Math.round(Number((entry.days || {})[today]) || 0),
        sessions: Math.max(1, Number(entry.sessions) || 0),
        modules,
        days,
      };
    })
    .sort(
      (left, right) =>
        Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0),
    );
  return {
    ...summarize(store.events || []),
    online: activity.filter((entry) => entry.online).length,
    activity,
    updatedAt: store.updatedAt,
  };
}

module.exports = {
  MAX_EVENTS,
  ONLINE_WINDOW_MS,
  annotate,
  dayKey,
  flush,
  forgetActivity,
  hashIp,
  load,
  moduleForPage,
  recent,
  record,
  recordActivity,
  setMeta,
  summary,
  telemetryPath,
  wrap,
};
