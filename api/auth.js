/**
 * 账号接口：注册 / 登录 / 退出 / 会话查询。
 *
 * 自建服务器上账号存在 DATA_DIR/users.json（见 api/_user-store.js），
 * 会话是 HMAC 签名 Cookie，不需要数据库。
 *
 * 环境变量：
 *   SESSION_SECRET        必填，签名 Cookie 用；缺省时登录整体不可用
 *   APP_USERNAME          站长账号，默认 iball（历史 wzh 自动迁移）
 *   APP_PASSWORD_SHA256   站长口令的 SHA-256，默认沿用仓库内置的历史值
 *   REGISTRATION_ENABLED  是否开放注册，默认 true
 *   REGISTRATION_CODE     可选邀请码，设置后注册必须填对
 *   MAX_USERS             账号上限，默认 20
 */

const crypto = require("crypto");
const {
  StoreError,
  countUsers,
  createUser,
  ensureUser,
  storageStatus,
  verifyCredentials,
} = require("./_user-store.js");

const COOKIE_NAME = "iball_cabin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const PASSWORD_SHA256 =
  "481f6cc0511143ccdd7e2d1b1b94faf0a700a8b49cd13922a70b5ae28acaa8c5";
const SESSION_SIGNING_REVISION = "username-iball-password-2026-09-17";
const DEFAULT_USERNAME = "iball";
const LEGACY_USERNAMES = new Set(["wzh"]);
const MAX_BODY_BYTES = 4096;
const DEFAULT_MAX_USERS = 20;

// 简易内存限流：按 IP 和 IP+账号两条线计数，进程重启即清零。
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const LIMITS = {
  loginPerIp: 12,
  loginPerAccount: 5,
  registerPerIp: 6,
};
const attempts = new Map();

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) {
      return cookies;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getSignature(payload) {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "")
    .update(`${SESSION_SIGNING_REVISION}:${payload}`)
    .digest("base64url");
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function getConfiguredUsername() {
  const configured = String(process.env.APP_USERNAME || "").trim();
  return !configured || LEGACY_USERNAMES.has(configured)
    ? DEFAULT_USERNAME
    : configured;
}

/**
 * 站长账号不能被注册抢注：旧版单账号登录靠 APP_USERNAME + 内置口令散列，
 * 一旦被陌生人注册走，站长就再也进不去了。
 */
function isReservedUsername(username) {
  const key = String(username || "").trim().toLowerCase();
  if (!key) {
    return false;
  }
  return key === getConfiguredUsername().toLowerCase() || LEGACY_USERNAMES.has(key);
}

function createSession(username) {
  const payload = base64UrlEncode(
    JSON.stringify({
      username,
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    }),
  );
  return `${payload}.${getSignature(payload)}`;
}

function verifySession(token) {
  if (!token || !process.env.SESSION_SECRET) {
    return null;
  }

  const separator = token.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!safeEqual(signature, getSignature(payload))) {
    return null;
  }

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (
      !session.username ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt < Date.now()
    ) {
      return null;
    }
    return session.username;
  } catch {
    return null;
  }
}

function isLocalHost(host = "") {
  return (
    /^localhost(?::\d+)?$/i.test(host) ||
    /^127\.0\.0\.1(?::\d+)?$/i.test(host)
  );
}

function createCookie(value, maxAge, host) {
  const secure = isLocalHost(host) ? "" : "; Secure";
  return `${COOKIE_NAME}=${encodeURIComponent(
    value,
  )}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

async function readBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "object") {
    return body;
  }
  if (Buffer.byteLength(String(body)) > MAX_BODY_BYTES) {
    throw new StoreError("请求内容过大", 413);
  }
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function clientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return (
    forwarded ||
    String(request.headers["x-real-ip"] || "").trim() ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

function hitLimit(key, max, windowMs) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    if (attempts.size > 5000) {
      for (const [itemKey, item] of attempts) {
        if (item.resetAt <= now) {
          attempts.delete(itemKey);
        }
      }
    }
    return { blocked: false };
  }

  record.count += 1;
  return {
    blocked: record.count > max,
    retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
  };
}

function clearLimit(key) {
  attempts.delete(key);
}

function registrationPolicy() {
  const enabled = String(process.env.REGISTRATION_ENABLED ?? "true")
    .trim()
    .toLowerCase();
  const maxUsers = Number(process.env.MAX_USERS || DEFAULT_MAX_USERS);
  const inviteCode = String(process.env.REGISTRATION_CODE || "");
  return {
    enabled: !["0", "false", "off", "no"].includes(enabled),
    inviteRequired: Boolean(inviteCode),
    maxUsers:
      Number.isFinite(maxUsers) && maxUsers > 0 ? maxUsers : DEFAULT_MAX_USERS,
  };
}

async function openRegistrationState() {
  const policy = registrationPolicy();
  // Vercel 的部署目录是只读的，写不进 users.json。与其让用户填完表单才
  // 报错，不如直接把注册标成不可用；真实注册只在自建服务器上开放。
  const storage = await storageStatus();
  let userCount = 0;
  try {
    userCount = await countUsers();
  } catch {
    userCount = 0;
  }
  return {
    enabled:
      policy.enabled && storage.ready && userCount < policy.maxUsers,
    storageReady: storage.ready,
    inviteRequired: policy.inviteRequired,
    maxUsers: policy.maxUsers,
    userCount,
    remainingSlots: Math.max(0, policy.maxUsers - userCount),
  };
}

function sessionCookieFor(request, username) {
  return createCookie(
    createSession(username),
    SESSION_MAX_AGE,
    request.headers.host,
  );
}

/**
 * 旧版单账号登录：站长账号 + 仓库内置口令散列仍然可用，命中后把账号
 * 补进用户库，方便平滑迁移到多账号模式。
 */
function applyLegacyOwnerLogin(request, response, username, password) {
  const configuredUsername = getConfiguredUsername();
  const expectedHash = String(
    process.env.APP_PASSWORD_SHA256 || PASSWORD_SHA256,
  ).toLowerCase();
  const matches =
    safeEqual(username.toLowerCase(), configuredUsername.toLowerCase()) &&
    safeEqual(hashPassword(password), expectedHash);
  if (!matches) {
    return false;
  }

  response.setHeader(
    "Set-Cookie",
    sessionCookieFor(request, configuredUsername),
  );
  response.status(200).json({
    ok: true,
    user: configuredUsername,
    migrated: true,
  });
  ensureUser({ username: configuredUsername, password }).catch(() => {});
  return true;
}

async function handleRegister(request, response, body) {
  const inviteCode = String(process.env.REGISTRATION_CODE || "");
  const ip = clientIp(request);
  const policy = await openRegistrationState();

  if (!policy.enabled) {
    const message =
      !policy.storageReady
        ? "这台服务器没有可写的账号目录，注册未启用。请到主站注册。"
        : policy.remainingSlots === 0
        ? `账号数量已达上限（${policy.maxUsers} 个），如需新增请调整服务器上的 MAX_USERS。`
        : "本站当前未开放注册。";
    response.status(403).json({ ok: false, message });
    return;
  }

  const limit = hitLimit(
    `register:${ip}`,
    LIMITS.registerPerIp,
    REGISTER_WINDOW_MS,
  );
  if (limit.blocked) {
    response.status(429).json({ ok: false, message: "注册太频繁，请稍后再试。" });
    return;
  }

  if (inviteCode && !safeEqual(String(body.inviteCode || "").trim(), inviteCode)) {
    response.status(403).json({ ok: false, message: "邀请码不正确。" });
    return;
  }

  if (isReservedUsername(body.username)) {
    response
      .status(409)
      .json({ ok: false, message: "这个账号是站长保留账号，请换一个。" });
    return;
  }

  const user = await createUser({
    username: body.username,
    password: body.password,
    email: body.email,
  });

  response.setHeader("Set-Cookie", sessionCookieFor(request, user.username));
  response.status(201).json({ ok: true, user: user.username, account: user });
}

async function handleLogin(request, response, body) {
  const ip = clientIp(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const accountKey = `login:${ip}:${username.toLowerCase()}`;

  const ipLimit = hitLimit(`login:${ip}`, LIMITS.loginPerIp, ATTEMPT_WINDOW_MS);
  const accountLimit = hitLimit(
    accountKey,
    LIMITS.loginPerAccount,
    ATTEMPT_WINDOW_MS,
  );
  if (ipLimit.blocked || accountLimit.blocked) {
    response
      .status(429)
      .json({ ok: false, message: "尝试次数过多，请过一会儿再登录。" });
    return;
  }

  const account = await verifyCredentials(username, password).catch(() => null);
  if (account) {
    clearLimit(accountKey);
    response.setHeader(
      "Set-Cookie",
      sessionCookieFor(request, account.username),
    );
    response.status(200).json({ ok: true, user: account.username, account });
    return;
  }

  if (applyLegacyOwnerLogin(request, response, username, password)) {
    clearLimit(accountKey);
    return;
  }

  response.status(401).json({ ok: false, message: "账号或密码不正确" });
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  const cookies = parseCookies(request.headers.cookie || "");

  try {
    if (request.method === "GET") {
      const username = verifySession(cookies[COOKIE_NAME]);
      response.status(200).json({
        authenticated: Boolean(username),
        user: username || null,
        registration: await openRegistrationState(),
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "不支持的请求方式" });
      return;
    }

    const body = await readBody(request.body);

    if (body.action === "logout") {
      response.setHeader(
        "Set-Cookie",
        createCookie("", 0, request.headers.host),
      );
      response.status(200).json({ ok: true });
      return;
    }

    if (!process.env.SESSION_SECRET) {
      response.status(503).json({
        ok: false,
        message:
          "登录服务尚未配置，请先在服务器上设置 SESSION_SECRET（见 deploy/README.md）。",
      });
      return;
    }

    if (body.action === "register") {
      await handleRegister(request, response, body);
      return;
    }

    if (body.action === "login") {
      await handleLogin(request, response, body);
      return;
    }

    response.status(400).json({ ok: false, message: "无效的操作" });
  } catch (error) {
    if (error instanceof StoreError) {
      response
        .status(error.statusCode)
        .json({ ok: false, message: error.message });
      return;
    }

    const storage = await storageStatus();
    response.status(500).json({
      ok: false,
      message: storage.ready
        ? "账号服务暂时不可用，请稍后重试。"
        : "服务器无法写入账号目录，请检查 DATA_DIR 权限。",
    });
  }
};

// 供脚本与验收用例直接引用，避免测试里再抄一份参数。
module.exports.__internals = {
  COOKIE_NAME,
  SESSION_SIGNING_REVISION,
  createSession,
  verifySession,
  hashPassword,
  clientIp,
  isReservedUsername,
};
