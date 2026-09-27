"use strict";

/**
 * 备份接口的权限和字段白名单回归。
 *
 * 这里不碰任何真实仓库：DATA_DIR 指向临时目录，GITHUB_BACKUP_TOKEN 一律不配置，
 * 所以 POST 永远走不到 GitHub 网络请求，只会命中“未配置”分支。
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PASSWORD = "verify-backup-password";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "iball-backup-"));

process.env.SESSION_SECRET = "test-session-secret";
process.env.APP_USERNAME = "iball";
process.env.APP_PASSWORD_SHA256 = crypto
  .createHash("sha256")
  .update(PASSWORD)
  .digest("hex");
process.env.DATA_DIR = scratch;
process.env.BACKUP_REPO = "iballiabll/iball-cabin-backup";
delete process.env.GITHUB_BACKUP_TOKEN;

const authHandler = require("../api/auth.js");
const backupHandler = require("../api/backup.js");

test.after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function call(handler, { method, body, cookie }) {
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
      socket: { remoteAddress: "127.0.0.1" },
    };
    handler(request, response).catch(reject);
  });
}

let adminCookie = null;

test("管理员登录后拿到会话 Cookie", async () => {
  const login = await call(authHandler, {
    method: "POST",
    body: { action: "login", username: "iball", password: PASSWORD },
  });
  assert.equal(login.statusCode, 200);
  assert.ok(login.headers["set-cookie"], "登录成功必须下发 Cookie");
  adminCookie = String(login.headers["set-cookie"]).split(";")[0];
});

test("没有会话时备份接口一律 403", async () => {
  const read = await call(backupHandler, { method: "GET" });
  assert.equal(read.statusCode, 403);
  assert.equal(read.body.ok, false);

  const start = await call(backupHandler, {
    method: "POST",
    body: { action: "backup" },
  });
  assert.equal(start.statusCode, 403);
});

test("管理员可以读状态，未配置时如实返回 configured=false", async () => {
  const read = await call(backupHandler, { method: "GET", cookie: adminCookie });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.ok, true);
  assert.equal(read.body.backup.configured, false);
  assert.equal(read.body.backup.running, false);
  assert.equal(read.body.backup.repo, "iballiabll/iball-cabin-backup");
  assert.equal(read.body.backup.status.lastStatus, "never");
});

test("未配置 token 时触发备份返回 409，不排队也不写状态", async () => {
  const before = fs.existsSync(path.join(scratch, "backup-status.json"));
  const start = await call(backupHandler, {
    method: "POST",
    cookie: adminCookie,
    body: { action: "backup" },
  });
  assert.equal(start.statusCode, 409);
  assert.equal(start.body.ok, false);
  assert.match(start.body.message, /GITHUB_BACKUP_TOKEN/);
  // 未配置时不能落下“已开始”的状态文件。
  assert.equal(fs.existsSync(path.join(scratch, "backup-status.json")), before);
});

test("未知 action 返回 400，不支持的方法返回 405", async () => {
  const bad = await call(backupHandler, {
    method: "POST",
    cookie: adminCookie,
    body: { action: "wipe" },
  });
  assert.equal(bad.statusCode, 400);

  const method = await call(backupHandler, { method: "DELETE", cookie: adminCookie });
  assert.equal(method.statusCode, 405);
});

test("状态接口只回元数据，落盘文件里的额外字段不会漏出去", async () => {
  const statusPath = path.join(scratch, "backup-status.json");
  fs.writeFileSync(
    statusPath,
    JSON.stringify({
      version: 1,
      lastStatus: "ok",
      lastRunAt: "2026-09-27T01:00:00.000Z",
      startedAt: "2026-09-27T00:59:58.000Z",
      durationMs: 2000,
      trigger: "manual",
      snapshot: "snapshots/20260927-005958Z",
      fileCount: 3,
      bytes: 4096,
      commitSha: "abc123",
      commitUrl: "https://github.com/iballiabll/iball-cabin-backup/commit/abc123",
      message: "已备份 3 个文件",
      // 以下都是不该被接口回显的敏感字段。
      token: "ghp_should-never-leak",
      passwordHash: "deadbeefdeadbeef",
      contents: "account data body",
    }),
    "utf8",
  );

  const read = await call(backupHandler, { method: "GET", cookie: adminCookie });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.backup.status.lastStatus, "ok");
  assert.equal(read.body.backup.status.fileCount, 3);
  assert.equal(read.body.backup.status.bytes, 4096);

  const serialized = JSON.stringify(read.body);
  assert.doesNotMatch(serialized, /should-never-leak/);
  assert.doesNotMatch(serialized, /deadbeef/);
  assert.doesNotMatch(serialized, /account data body/);
  assert.equal(read.body.backup.status.token, undefined);
  assert.equal(read.body.backup.status.passwordHash, undefined);
  assert.equal(read.body.backup.status.contents, undefined);
});

test("状态文件损坏时按“从未备份”展示，而不是 500", async () => {
  fs.writeFileSync(path.join(scratch, "backup-status.json"), "{ not json", "utf8");
  const read = await call(backupHandler, { method: "GET", cookie: adminCookie });
  assert.equal(read.statusCode, 200);
  assert.equal(read.body.backup.status.lastStatus, "never");
});

test("空仓库首次备份会先初始化 main 再提交快照", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "iball-backup-empty-"));
  fs.writeFileSync(path.join(dataDir, "users.json"), '{"users":[]}', "utf8");
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    GITHUB_BACKUP_TOKEN: process.env.GITHUB_BACKUP_TOKEN,
    BACKUP_REPO: process.env.BACKUP_REPO,
    BACKUP_BRANCH: process.env.BACKUP_BRANCH,
  };
  process.env.DATA_DIR = dataDir;
  process.env.GITHUB_BACKUP_TOKEN = "test-token";
  process.env.BACKUP_REPO = "iballiabll/iball-cabin-backup";
  process.env.BACKUP_BRANCH = "main";

  const calls = [];
  const originalFetch = global.fetch;
  let headReads = 0;
  global.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    const parsed = new URL(String(url));
    calls.push(`${method} ${parsed.pathname}`);
    if (parsed.pathname === "/repos/iballiabll/iball-cabin-backup") {
      return new Response(
        JSON.stringify({
          full_name: "iballiabll/iball-cabin-backup",
          private: true,
          archived: false,
        }),
        { status: 200 },
      );
    }
    if (parsed.pathname.endsWith("/git/ref/heads/main")) {
      headReads += 1;
      if (headReads === 1) {
        // GitHub 对没有任何提交的空仓库返回 409，而不是 404；而且此时
        // 连创建 blob 都会被拒绝，必须先用 Contents API 建首个提交。
        return new Response(JSON.stringify({ message: "Git Repository is empty." }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify({ object: { sha: "init-sha" } }), { status: 200 });
    }
    if (parsed.pathname.endsWith("/contents/README.md")) {
      assert.equal(method, "PUT");
      return new Response(JSON.stringify({ commit: { sha: "init-sha" } }), { status: 201 });
    }
    if (parsed.pathname.endsWith("/git/commits/init-sha")) {
      return new Response(JSON.stringify({ tree: { sha: "init-tree" } }), { status: 200 });
    }
    if (parsed.pathname.endsWith("/git/blobs")) {
      return new Response(JSON.stringify({ sha: "blob-sha" }), { status: 201 });
    }
    if (parsed.pathname.endsWith("/git/trees")) {
      return new Response(JSON.stringify({ sha: "tree-sha" }), { status: 201 });
    }
    if (parsed.pathname.endsWith("/git/commits")) {
      return new Response(JSON.stringify({ sha: "commit-sha" }), { status: 201 });
    }
    if (parsed.pathname.endsWith("/git/refs/heads/main")) {
      assert.equal(method, "PATCH");
      return new Response(JSON.stringify({ ref: "refs/heads/main" }), { status: 201 });
    }
    throw new Error(`unexpected fetch: ${method} ${parsed.pathname}`);
  };

  try {
    const { runBackup } = await import("../scripts/backup-data.mjs");
    const result = await runBackup({ trigger: "cli" });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.commitSha, "commit-sha");
    assert.ok(
      calls.includes("PUT /repos/iballiabll/iball-cabin-backup/contents/README.md"),
      "空仓库应该先用 Contents API 初始化 README",
    );
    assert.ok(
      calls.includes("PATCH /repos/iballiabll/iball-cabin-backup/git/refs/heads/main"),
      "初始化后的快照提交应该更新 main",
    );
    assert.equal(headReads, 2, "初始化前后各读一次 HEAD");
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
