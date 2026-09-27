"use strict";

/**
 * 在线时长 / 模块使用的聚合回归。
 *
 * 只写临时 DATA_DIR，不碰仓库里的 work/data；心跳时间用 Date.now 打桩，
 * 毫秒级就能跑完跨小时、跨天的场景。
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "iball-telemetry-"));
process.env.SESSION_SECRET = "test-telemetry-secret";
process.env.DATA_DIR = scratch;

const telemetry = require("../api/_telemetry.js");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// 2026-09-27T01:00Z = 北京时间 09:00，整段场景都落在同一个自然日里。
const base = Date.parse("2026-09-27T01:00:00.000Z");

async function atTime(ms, task) {
  const original = Date.now;
  Date.now = () => ms;
  try {
    return await task(ms);
  } finally {
    Date.now = original;
  }
}

function beat(userId, page, title, ms) {
  return atTime(ms, () =>
    telemetry.recordActivity({
      userId,
      username: userId,
      page,
      title,
      ua: "test-agent",
      ip: "127.0.0.1",
    }),
  );
}

async function summaryAt(ms) {
  return atTime(ms, () => telemetry.summary());
}

test.after(async () => {
  await telemetry.flush().catch(() => {});
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("模块名从页面路径和标题推出来", () => {
  assert.equal(telemetry.moduleForPage("/vocab", ""), "词汇库");
  assert.equal(telemetry.moduleForPage("/xxrj/", "错题本 · 小屋"), "小屋 · 错题本");
  assert.equal(telemetry.moduleForPage("/xxrj/", ""), "小屋");
  assert.equal(telemetry.moduleForPage("/", "首页"), "首页");
  assert.equal(telemetry.moduleForPage("/nope/deep", ""), "其他");
});

test("dayKey 按北京时间切天", () => {
  assert.equal(telemetry.dayKey(Date.parse("2026-09-27T15:30:00Z")), "2026-09-27");
  assert.equal(telemetry.dayKey(Date.parse("2026-09-27T16:30:00Z")), "2026-09-28");
});

test("在线时长按心跳间隔累加，超时算新会话", async () => {
  const userId = "student-duration";
  await beat(userId, "/vocab", "词汇库", base);
  await beat(userId, "/vocab", "词汇库", base + MINUTE);
  await beat(userId, "/xxrj/", "错题本 · 小屋", base + 2 * MINUTE);
  // 中间断了 10 分钟：这段不计时长，只记成新的一次会话。
  await beat(userId, "/xxrj/", "错题本 · 小屋", base + 12 * MINUTE);

  const summary = await summaryAt(base + 12 * MINUTE);
  const entry = summary.activity.find((item) => item.userId === userId);
  assert.ok(entry, "活动记录应该能查到");
  assert.equal(entry.onlineMs, 2 * MINUTE);
  assert.equal(entry.onlineMsToday, 2 * MINUTE);
  assert.equal(entry.beats, 4);
  assert.equal(entry.sessions, 1);
  assert.equal(entry.online, true);

  const vocab = entry.modules.find((item) => item.name === "词汇库");
  const review = entry.modules.find((item) => item.name === "小屋 · 错题本");
  assert.equal(vocab.ms, 2 * MINUTE, "间隔算给上一次心跳所在的模块");
  assert.equal(vocab.beats, 2);
  assert.equal(review.ms, 0);
  assert.equal(review.beats, 2);
  assert.equal(entry.modules[0].name, "词汇库", "模块按停留时长排序");
});

test("超过 3 分钟没有心跳就不算时长，也不误判在线", async () => {
  const userId = "student-offline";
  await beat(userId, "/leaderboard", "排行榜", base);
  await beat(userId, "/leaderboard", "排行榜", base + 30 * MINUTE);

  const summary = await summaryAt(base + 34 * MINUTE);
  const entry = summary.activity.find((item) => item.userId === userId);
  assert.equal(entry.onlineMs, 0);
  assert.equal(entry.sessions, 1);
  assert.equal(entry.online, false, "超过 3 分钟没有心跳就不算在线");
});

test("模块与按天时长都有上限", async () => {
  const userId = "student-caps";
  for (let index = 0; index < 30; index += 1) {
    await beat(userId, "/xxrj/", `M${index} · 小屋`, base + index * MINUTE);
  }
  const store = await telemetry.load();
  const modules = Object.keys(store.activity[userId].modules || {});
  assert.equal(modules.length, 24, "模块最多留 24 个");

  const dayUser = "student-days";
  for (let day = 0; day < 15; day += 1) {
    const start = base + day * 24 * HOUR;
    await beat(dayUser, "/vocab", "词汇库", start);
    await beat(dayUser, "/vocab", "词汇库", start + MINUTE);
  }
  const days = Object.keys((await telemetry.load()).activity[dayUser].days || {});
  assert.equal(days.length, 14, "按天时长最多留 14 天");
  assert.equal(days.includes("2026-09-27"), false, "先丢最旧的一天");

  const summary = await summaryAt(base + 14 * 24 * HOUR + MINUTE);
  const entry = summary.activity.find((item) => item.userId === dayUser);
  assert.equal(entry.onlineMs, 15 * MINUTE);
  assert.equal(entry.days.length, 7, "接口只回最近 7 天");
});

test("forgetActivity 能把一个账号的活动记录整个删掉", async () => {
  const userId = "student-forget";
  await beat(userId, "/vocab", "词汇库", base);
  assert.equal(await telemetry.forgetActivity(userId), true);
  assert.equal(await telemetry.forgetActivity(userId), false, "重复删除返回 false");

  const summary = await summaryAt(base);
  assert.equal(
    summary.activity.some((item) => item.userId === userId),
    false,
  );
});
