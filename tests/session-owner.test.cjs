"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PASSWORD = "verify-owner-password";
const OWNER_HASH = crypto
  .createHash("sha256")
  .update(PASSWORD)
  .digest("hex");

// DATA_DIR 指向一个普通文件，模拟 Vercel 那种写不进账号目录的只读镜像。
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "iball-session-"));
const blocked = path.join(scratch, "not-a-directory");
fs.writeFileSync(blocked, "blocked");

process.env.SESSION_SECRET = "test-session-secret";
process.env.APP_USERNAME = "iball";
process.env.APP_PASSWORD_SHA256 = OWNER_HASH;
process.env.DATA_DIR = blocked;

const session = require("../api/_session.js");

test.after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function cookieHeader(token) {
  return `${session.COOKIE_NAME}=${encodeURIComponent(token)}`;
}

test("无状态站长会话不查账号库也能通过校验", async () => {
  const user = await session.resolveSessionUser({
    headers: { cookie: cookieHeader(session.createOwnerSession()) },
  });

  assert.ok(user, "站长会话应当有效");
  assert.equal(user.id, "owner-iball");
  assert.equal(user.username, "iball");
  assert.equal(session.isAdminUser(user), true);
});

test("改 APP_PASSWORD_SHA256 后旧的无状态会话立即失效", async () => {
  const token = session.createOwnerSession();
  process.env.APP_PASSWORD_SHA256 = crypto
    .createHash("sha256")
    .update("another-password")
    .digest("hex");

  try {
    const user = await session.resolveSessionUser({
      headers: { cookie: cookieHeader(token) },
    });
    assert.equal(user, null);
  } finally {
    process.env.APP_PASSWORD_SHA256 = OWNER_HASH;
  }

  const restored = await session.resolveSessionUser({
    headers: { cookie: cookieHeader(session.createOwnerSession()) },
  });
  assert.ok(restored, "换回口令散列后应重新可用");
});

test("签名被改过的站长会话不被接受", async () => {
  const token = session.createOwnerSession();
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

  const user = await session.resolveSessionUser({
    headers: { cookie: cookieHeader(tampered) },
  });
  assert.equal(user, null);
});
