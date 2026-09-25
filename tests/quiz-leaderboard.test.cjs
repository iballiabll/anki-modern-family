/**
 * 榜单聚合测试。
 *
 * 之前的回归是：总榜要求三个范围全考过，人少时长期空榜，看起来像摆设。
 * 这里直接往临时 DATA_DIR 写 users.json / quiz.json，再调用真实的
 * buildBoard()，确保「考过一个就能上榜」「完成度只做同分裁决」这两条。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iball-quiz-test-"));
process.env.DATA_DIR = dataDir;

const { totalEntryFor, totalScoreFor } = require("../api/_quiz-store.js");
const leaderboard = require("../api/leaderboard.js");
const { buildBoard } = leaderboard.__internals;

function writeUsers(users) {
  const records = users.map((user, index) => ({
    id: user.id,
    username: user.username,
    email: user.email || "",
    passwordHash: "scrypt$1$1$1$c2FsdA==$aGFzaA==",
    authVersion: 1,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    lastLoginAt: "",
    passwordUpdatedAt: "",
    resetTokens: [],
  }));
  fs.writeFileSync(
    path.join(dataDir, "users.json"),
    JSON.stringify({ version: 2, users: records, resetRequests: [] }),
  );
}

function writeBests(bests) {
  fs.writeFileSync(
    path.join(dataDir, "quiz.json"),
    JSON.stringify({ version: 1, bests }),
  );
}

function entry(percent, score) {
  return {
    score: score ?? percent,
    total: 100,
    percent,
    at: "2026-02-01T00:00:00.000Z",
    wrongWords: 0,
  };
}

test("totalEntryFor：一个范围都没考过时返回 null", () => {
  assert.equal(totalEntryFor({}), null);
  assert.equal(totalEntryFor({ cet4: {} }), null);
  assert.equal(totalScoreFor({}), null);
});

test("totalEntryFor：考过一个范围就能算出综合分，其他范围留 null", () => {
  const summary = totalEntryFor({ cet4: entry(80) });
  assert.equal(summary.percent, 80);
  assert.equal(summary.completed, 1);
  assert.equal(summary.totalRanges, 3);
  assert.equal(summary.parts.cet4, 80);
  assert.equal(summary.parts.kaoyan, null);
  assert.equal(summary.parts.all, null);
  assert.equal(totalScoreFor({ cet4: entry(80) }), 80);
});

test("totalEntryFor：两个和三个范围取平均并四舍五入", () => {
  const two = totalEntryFor({ cet4: entry(80), kaoyan: entry(91) });
  assert.equal(two.percent, 86);
  assert.equal(two.completed, 2);

  const three = totalEntryFor({
    cet4: entry(80),
    kaoyan: entry(91),
    all: entry(90),
  });
  assert.equal(three.percent, 87);
  assert.equal(three.completed, 3);
});

test("totalEntryFor：0 分也是已考，不会被当成没考", () => {
  const summary = totalEntryFor({ cet4: entry(0, 0) });
  assert.equal(summary.completed, 1);
  assert.equal(summary.percent, 0);
});

test("总榜：只考一个范围的人也会上榜，未考范围显示为 null", async () => {
  writeUsers([{ id: "u1", username: "alice" }]);
  writeBests({ u1: { cet4: entry(80) } });

  const rows = await buildBoard("total");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "alice");
  assert.equal(rows[0].percent, 80);
  assert.equal(rows[0].completed, 1);
  assert.equal(rows[0].totalRanges, 3);
  assert.equal(rows[0].score, 80);
  assert.equal(rows[0].total, 100);
  assert.equal(rows[0].parts.kaoyan, null);
});

test("总榜：综合分优先，同分时考得更全的排前面", async () => {
  writeUsers([
    { id: "u1", username: "one-range" },
    { id: "u2", username: "two-ranges" },
    { id: "u3", username: "top-score" },
  ]);
  writeBests({
    u1: { cet4: entry(90) },
    u2: { cet4: entry(90), kaoyan: entry(90) },
    u3: { cet4: entry(100), all: entry(100) },
  });

  const rows = await buildBoard("total");
  assert.deepEqual(
    rows.map((row) => row.username),
    ["top-score", "two-ranges", "one-range"],
  );
  assert.deepEqual(
    rows.map((row) => row.rank),
    [1, 2, 3],
  );
  assert.equal(rows[0].percent, 100);
  assert.equal(rows[0].completed, 2);
  assert.equal(rows[1].completed, 2);
  assert.equal(rows[2].completed, 1);
});

test("单榜：只收录考过该范围的账号", async () => {
  writeUsers([
    { id: "u1", username: "alice" },
    { id: "u2", username: "bob" },
  ]);
  writeBests({
    u1: { cet4: entry(60) },
    u2: { kaoyan: entry(99) },
  });

  const rows = await buildBoard("cet4");
  assert.deepEqual(
    rows.map((row) => row.username),
    ["alice"],
  );
});

test("榜单：已删除账号的成绩不会残留", async () => {
  writeUsers([{ id: "u1", username: "alice" }]);
  writeBests({
    u1: { cet4: entry(70) },
    ghost: { cet4: entry(100) },
  });

  const rows = await buildBoard("cet4");
  assert.deepEqual(
    rows.map((row) => row.username),
    ["alice"],
  );
});
