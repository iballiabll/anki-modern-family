"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PASSWORD = "verify-owner-password";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "iball-auth-"));
const blocked = path.join(scratch, "not-a-directory");
fs.writeFileSync(blocked, "blocked");

process.env.SESSION_SECRET = "test-session-secret";
process.env.APP_USERNAME = "iball";
process.env.APP_PASSWORD_SHA256 = crypto
  .createHash("sha256")
  .update(PASSWORD)
  .digest("hex");
process.env.DATA_DIR = blocked;

const handler = require("../api/auth.js");

test.after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function callAuth({ method, body, cookie, host = "www.iball.top" }) {
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
      headers: { host, ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      socket: { remoteAddress: "127.0.0.1" },
    };
    handler(request, response).catch(reject);
  });
}

test("只读镜像上的站长登录会下发会话 Cookie", async () => {
  const login = await callAuth({
    method: "POST",
    body: { action: "login", username: "iball", password: PASSWORD },
  });

  assert.equal(login.statusCode, 200);
  assert.equal(login.body.ok, true);
  // 回归点：这里以前返回 account.id = ""，页面因此拿不到可用的账号身份。
  assert.equal(login.body.account.id, "owner-iball");
  const setCookie = login.headers["set-cookie"];
  assert.ok(setCookie, "登录成功必须下发 Cookie");
  assert.match(setCookie, /^iball_cabin_session=/);

  // 刷新页面时用的就是这一步：带上 Cookie 再查一次会话。
  const probe = await callAuth({
    method: "GET",
    cookie: String(setCookie).split(";")[0],
  });
  assert.equal(probe.statusCode, 200);
  assert.equal(probe.body.authenticated, true);
  assert.equal(probe.body.user, "iball");
  assert.equal(probe.body.account.id, "owner-iball");
  assert.equal(probe.body.registration.storageReady, false);
});

test("口令不对时既不下发 Cookie 也不放行", async () => {
  const login = await callAuth({
    method: "POST",
    body: { action: "login", username: "iball", password: "wrong-password" },
  });

  assert.equal(login.statusCode, 401);
  assert.equal(login.headers["set-cookie"], undefined);
});
