/**
 * 会话层：HMAC 签名 Cookie 的签发、校验，以及请求体解析。
 *
 * Cookie 载荷里带 userId / username / authVersion：
 *   · userId 是权限判断的唯一依据，客户端传来的任何 ID 都不被信任；
 *   · authVersion 在改密码（含找回重置）时自增，旧 Cookie 立刻失效。
 *
 * 兼容旧版仅含 username 的 Cookie：这类会话只在账号从未改过密码时放行，
 * 站长自己重置一次密码即可把过去所有老会话清掉。
 */

const crypto = require("crypto");
const { findById, findByUsername } = require("./_user-store.js");

const COOKIE_NAME = "iball_cabin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
// 别改这个字符串：改了等于把所有已登录设备踢下线。
const SESSION_SIGNING_REVISION = "username-iball-password-2026-09-17";
const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseCookies(header = "") {
  return String(header || "")
    .split(";")
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator < 0) {
        return cookies;
      }
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
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

function secret() {
  return String(process.env.SESSION_SECRET || "");
}

function getSignature(payload) {
  return crypto
    .createHmac("sha256", secret())
    .update(`${SESSION_SIGNING_REVISION}:${payload}`)
    .digest("base64url");
}

function createSession(user) {
  const payload = base64UrlEncode(
    JSON.stringify({
      userId: user.id,
      username: user.username,
      authVersion: Number(user.authVersion) || 1,
      expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
    }),
  );
  return `${payload}.${getSignature(payload)}`;
}

/** 只验签与过期时间，不查用户库；返回载荷或 null。 */
function verifySessionToken(token) {
  if (!token || !secret()) {
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
    return session;
  } catch {
    return null;
  }
}

/**
 * 完整校验一次请求：验签 + 查用户 + 比对 authVersion。
 * 返回用户记录（含 passwordHash，调用方注意别外泄）或 null。
 */
async function resolveSessionUser(request) {
  const cookies = parseCookies(request.headers?.cookie || "");
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  if (!session) {
    return null;
  }

  if (session.userId) {
    const user = await findById(session.userId).catch(() => null);
    if (!user) {
      return null;
    }
    if ((Number(user.authVersion) || 1) !== (Number(session.authVersion) || 1)) {
      return null;
    }
    return user;
  }

  // 旧版 Cookie：没有 userId，改过密码的账号一律不接受。
  const legacy = await findByUsername(session.username).catch(() => null);
  if (!legacy || legacy.passwordUpdatedAt) {
    return null;
  }
  return legacy;
}

function publicAccount(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    createdAt: user.createdAt || "",
  };
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

function sessionCookieFor(request, user) {
  return createCookie(
    createSession(user),
    SESSION_MAX_AGE,
    request.headers?.host,
  );
}

function clearCookieFor(request) {
  return createCookie("", 0, request.headers?.host);
}

function clientIp(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return (
    forwarded ||
    String(request.headers?.["x-real-ip"] || "").trim() ||
    request.socket?.remoteAddress ||
    "unknown"
  );
}

async function readJsonBody(request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const body = request.body;
  if (!body) {
    return {};
  }
  if (typeof body === "object") {
    return body;
  }
  if (Buffer.byteLength(String(body)) > maxBytes) {
    throw new HttpError("请求内容过大", 413);
  }
  try {
    const parsed = JSON.parse(String(body));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new HttpError("请求内容不是合法的 JSON", 400);
  }
}

/** 管理员账号名：优先 ADMIN_USERNAME，其次站长账号 APP_USERNAME，最后 iball。 */
function adminUsername() {
  const configured = String(
    process.env.ADMIN_USERNAME || process.env.APP_USERNAME || "",
  ).trim();
  return configured && configured.toLowerCase() !== "wzh"
    ? configured
    : "iball";
}

function isAdminUser(user) {
  return Boolean(
    user &&
      String(user.username || "").toLowerCase() ===
        adminUsername().toLowerCase(),
  );
}

module.exports = {
  COOKIE_NAME,
  SESSION_MAX_AGE,
  SESSION_SIGNING_REVISION,
  HttpError,
  adminUsername,
  clearCookieFor,
  clientIp,
  createCookie,
  createSession,
  isAdminUser,
  parseCookies,
  publicAccount,
  readJsonBody,
  resolveSessionUser,
  safeEqual,
  sessionCookieFor,
  verifySessionToken,
};
