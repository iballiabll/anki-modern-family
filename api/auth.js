const crypto = require("crypto");

const COOKIE_NAME = "iball_cabin_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

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
    .update(payload)
    .digest("base64url");
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
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  const cookies = parseCookies(request.headers.cookie || "");

  if (request.method === "GET") {
    const username = verifySession(cookies[COOKIE_NAME]);
    response.status(200).json({
      authenticated: Boolean(username),
      user: username || null,
    });
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "不支持的请求方式" });
    return;
  }

  const body = await readBody(request.body);

  if (body.action === "logout") {
    response.setHeader("Set-Cookie", createCookie("", 0, request.headers.host));
    response.status(200).json({ ok: true });
    return;
  }

  if (body.action !== "login") {
    response.status(400).json({ ok: false, message: "无效的操作" });
    return;
  }

  const configured =
    Boolean(process.env.APP_USERNAME) &&
    Boolean(process.env.APP_PASSWORD) &&
    Boolean(process.env.SESSION_SECRET);

  if (!configured) {
    response.status(503).json({
      ok: false,
      message: "登录服务尚未配置，请先在 Vercel 中设置账号和密码。",
    });
    return;
  }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const credentialsMatch =
    safeEqual(username, process.env.APP_USERNAME) &&
    safeEqual(password, process.env.APP_PASSWORD);

  if (!credentialsMatch) {
    response.status(401).json({ ok: false, message: "账号或密码不正确" });
    return;
  }

  response.setHeader(
    "Set-Cookie",
    createCookie(
      createSession(username),
      SESSION_MAX_AGE,
      request.headers.host,
    ),
  );
  response.status(200).json({ ok: true, user: username });
};
