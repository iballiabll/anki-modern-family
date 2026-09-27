"use strict";

/**
 * 管理端账号治理回归：停用 / 恢复 / 删除，以及会话踢出与数据清理。
 *
 * 全程只写临时 DATA_DIR，不发外部请求，也不碰仓库里的 work/data。
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const OWNER_PASSWORD = "verify-admin-password";
const STUDENT_PASSWORD = "student-password-1";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "iball-admin-"));

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

process.env.SESSION_SECRET = "test-admin-secret";
process.env.APP_USERNAME = "iball";
process.env.APP_PASSWORD_SHA256 = sha256(OWNER_PASSWORD);
process.env.DATA_DIR = scratch;
process.env.REGISTRATION_ENABLED = "false";

const authHandler = require("../api/auth.js");
const adminHandler = require("../api/admin.js");
const telemetry = require("../api/_telemetry.js");
const session = require("../api/_session.js");
const userStore = require("../api/_user-store.js");
const progressStore = require("../api/_progress-store.js");
const quizStore = require("../api/_quiz-store.js");

test.after(async () => {
  await telemetry.flush().catch(() => {});
  fs.rmSync(scratch, { recursive: true, force: true });
});

function call(handler, { method, body, cookie, query }) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let statusCode = 200;
    let payload = null;
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve({ statusCode, headers, body: payload });
      }
    };
    const response = {
      get statusCode() {
        return statusCode;
      },
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = value;
        return response;
      },
      status(code) {
        statusCode = code;
        return response;
      },
      json(data) {
        payload = data;
        finish();
        return response;
      },
      end() {
        finish();
        return response;
      },
    };
    const request = {
      method,
      headers: {
        host: "app.iball.top",
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      query: query || {},
      socket: { remoteAddress: "127.0.0.1" },
    };
    Promise.resolve(handler(request, response)).catch(reject);
  });
}

function cookieOf(result) {
  assert.ok(result.headers["set-cookie"], "登录成功必须下发 Cookie");
  return String(result.headers["set-cookie"]).split(";")[0];
}

function login(username, password) {
  return call(authHandler, {
    method: "POST",
    body: { action: "login", username, password },
  });
}

async function overview(cookie) {
  const result = await call(adminHandler, {
    method: "GET",
    cookie,
    query: { action: "overview" },
  });
  assert.equal(result.statusCode, 200);
  return result.body;
}

let ownerCookie = null;
let ownerId = "";
let studentId = "";
let studentCookie = null;

test("准备：站长登录、学生账号注册并登录", async () => {
  const owner = await login("iball", OWNER_PASSWORD);
  assert.equal(owner.statusCode, 200);
  ownerCookie = cookieOf(owner);
  ownerId = owner.body.account.id;

  const student = await userStore.createUser({
    username: "student-a",
    password: STUDENT_PASSWORD,
    email: "student-a@example.com",
  });
  studentId = student.id;

  const logged = await login("student-a", STUDENT_PASSWORD);
  assert.equal(logged.statusCode, 200);
  studentCookie = cookieOf(logged);
});

test("非管理员访问管理接口一律 403", async () => {
  const anonymous = await call(adminHandler, {
    method: "GET",
    query: { action: "overview" },
  });
  assert.equal(anonymous.statusCode, 403);

  const student = await call(adminHandler, {
    method: "GET",
    cookie: studentCookie,
    query: { action: "overview" },
  });
  assert.equal(student.statusCode, 403);
});

test("管理台能看到账号的在线时长与模块使用", async () => {
  await telemetry.recordActivity({
    userId: studentId,
    username: "student-a",
    page: "/vocab",
    title: "词汇库",
    ua: "test-agent",
    ip: "127.0.0.1",
  });

  const data = await overview(ownerCookie);
  const row = data.users.find((item) => item.id === studentId);
  assert.ok(row, "账号列表应该有这个学生");
  assert.equal(row.disabled, false);
  assert.equal(row.sessions, 1);
  assert.equal(Array.isArray(row.modules), true);
  assert.equal(row.modules[0].name, "词汇库");
});

test("停用会立刻踢下线并禁止再登录", async () => {
  const disabled = await call(adminHandler, {
    method: "POST",
    cookie: ownerCookie,
    body: { action: "user-disable", userId: studentId, reason: "测试停用" },
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.body.user.disabled, true);

  const record = await userStore.findById(studentId);
  assert.equal(record.disabled, true);
  assert.equal(record.disabledReason, "测试停用");
  assert.equal(record.authVersion, 2, "停用要让旧 Cookie 的 authVersion 失效");

  const resolved = await session.resolveSessionUser({
    headers: { cookie: studentCookie },
  });
  assert.equal(resolved, null, "已停用账号的旧会话必须立刻失效");

  const blocked = await login("student-a", STUDENT_PASSWORD);
  assert.equal(blocked.statusCode, 401);
  assert.equal(blocked.body.message, "账号或密码不正确", "不暴露账号被停用");

  const data = await overview(ownerCookie);
  assert.equal(data.users.find((item) => item.id === studentId).disabled, true);
});

test("恢复后可以重新登录", async () => {
  const enabled = await call(adminHandler, {
    method: "POST",
    cookie: ownerCookie,
    body: { action: "user-enable", userId: studentId },
  });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.body.user.disabled, false);

  const record = await userStore.findById(studentId);
  assert.equal(record.disabled, false);
  assert.equal(record.disabledReason, "");

  const logged = await login("student-a", STUDENT_PASSWORD);
  assert.equal(logged.statusCode, 200);
  studentCookie = cookieOf(logged);
});

test("不能停用或删除自己", async () => {
  const disableSelf = await call(adminHandler, {
    method: "POST",
    cookie: ownerCookie,
    body: { action: "user-disable", userId: ownerId },
  });
  assert.equal(disableSelf.statusCode, 400);

  const deleteSelf = await call(adminHandler, {
    method: "POST",
    cookie: ownerCookie,
    body: { action: "user-delete", userId: ownerId, confirm: true },
  });
  assert.equal(deleteSelf.statusCode, 400);
  assert.ok(await userStore.findById(ownerId), "站长账号必须还在");
});

test("删除账号要确认，确认后连进度、成绩、测试会话和活动记录一起清", async () => {
  await progressStore.mergeProgress(studentId, {
    entries: {
      "iball-quiz-wrong-v1": {
        v: [{ word: "apple", meaning: "苹果" }],
        t: Date.now(),
      },
    },
  });
  await quizStore.saveBest({
    userId: studentId,
    scope: "cet4",
    score: 9,
    total: 10,
    percent: 90,
    wrongWords: 1,
  });

  const now = Date.now();
  fs.writeFileSync(
    path.join(scratch, "quiz-sessions.json"),
    JSON.stringify({
      version: 1,
      sessions: {
        "sess-student": {
          id: "sess-student",
          userId: studentId,
          scope: "cet4",
          direction: "en-zh",
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
          submittedAt: "",
          key: ["apple"],
          words: [],
        },
        "sess-other": {
          id: "sess-other",
          userId: "someone-else",
          scope: "cet4",
          direction: "en-zh",
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
          submittedAt: "",
          key: ["banana"],
          words: [],
        },
      },
    }),
    "utf8",
  );

  await telemetry.recordActivity({
    userId: studentId,
    username: "student-a",
    page: "/quiz",
    title: "单词测试",
    ua: "test-agent",
    ip: "127.0.0.1",
  });

  const denied = await call(adminHandler, {
    method: "POST",
    cookie: ownerCookie,
    body: { action: "user-delete", userId: studentId },
  });
  assert.equal(denied.statusCode, 400, "没有 confirm 不能删除");
  assert.ok(await userStore.findById(studentId));

  const deleted = await call(adminHandler, {
    method: "POST",
    cookie: ownerCookie,
    body: { action: "user-delete", userId: studentId, confirm: true },
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.body.cleaned.progress, true);
  assert.equal(deleted.body.cleaned.quiz, true);

  assert.equal(await userStore.findById(studentId), null);
  assert.equal((await progressStore.progressSummary(studentId)).keys, 0);
  assert.deepEqual(await quizStore.bestsForUser(studentId), {});

  const sessions = JSON.parse(
    fs.readFileSync(path.join(scratch, "quiz-sessions.json"), "utf8"),
  );
  assert.equal(
    Object.values(sessions.sessions).some((item) => item.userId === studentId),
    false,
  );
  assert.ok(sessions.sessions["sess-other"], "不能误删别人的测试会话");

  const summary = await telemetry.summary();
  assert.equal(
    summary.activity.some((item) => item.userId === studentId),
    false,
    "活动记录也要一起清掉",
  );

  const data = await overview(ownerCookie);
  assert.equal(data.users.some((item) => item.id === studentId), false);
});
