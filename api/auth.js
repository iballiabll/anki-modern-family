/**
 * 账号接口：注册 / 登录 / 退出 / 会话查询 / 找回密码。
 *
 * 自建服务器上账号存在 DATA_DIR/users.json（见 api/_user-store.js），
 * 会话是 HMAC 签名 Cookie（见 api/_session.js），不需要数据库。
 *
 * 找回密码不依赖发信服务：用户提交申请 → 管理端生成一次性令牌 →
 * 用户拿令牌自己改密码。这样小站不用配 SMTP 也能有真实的找回流程。
 *
 * 环境变量：
 *   SESSION_SECRET        必填，签名 Cookie 用；缺省时登录整体不可用
 *   APP_USERNAME          站长账号，默认 iball（历史 wzh 自动迁移）
 *   APP_PASSWORD_SHA256   站长口令的 SHA-256，默认沿用仓库内置的历史值
 *   ADMIN_USERNAME        管理端账号，默认跟随 APP_USERNAME
 *   REGISTRATION_ENABLED  是否开放注册，默认 true
 *   REGISTRATION_CODE     邀请码兜底；管理端设置过邀请码后以设置文件为准
 *   MAX_USERS             账号上限，默认 20
 */

const crypto = require("crypto");
const {
  StoreError,
  countUsers,
  createUser,
  findByUsername,
  requestPasswordReset,
  resetPasswordWithToken,
  storageStatus,
  verifyCredentials,
} = require("./_user-store.js");
const {
  COOKIE_NAME,
  clearCookieFor,
  clientIp,
  isAdminUser,
  publicAccount,
  readJsonBody,
  resolveSessionUser,
  safeEqual,
  sessionCookieFor,
} = require("./_session.js");
const {
  effectiveInviteCode,
  inviteCodeStatus,
} = require("./_site-settings.js");
const telemetry = require("./_telemetry.js");

const PASSWORD_SHA256 =
  "481f6cc0511143ccdd7e2d1b1b94faf0a700a8b49cd13922a70b5ae28acaa8c5";
const SESSION_SIGNING_REVISION = "username-iball-password-2026-09-17";
const DEFAULT_USERNAME = "iball";
const LEGACY_USERNAMES = new Set(["wzh"]);
const DEFAULT_MAX_USERS = 20;

// 简易内存限流：按 IP 和 IP+账号两条线计数，进程重启即清零。
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const RESET_WINDOW_MS = 60 * 60 * 1000;
const LIMITS = {
  loginPerIp: 12,
  loginPerAccount: 5,
  registerPerIp: 6,
  resetPerIp: 8,
};
const attempts = new Map();

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
  return {
    enabled: !["0", "false", "off", "no"].includes(enabled),
    maxUsers:
      Number.isFinite(maxUsers) && maxUsers > 0 ? maxUsers : DEFAULT_MAX_USERS,
  };
}

/**
 * 注册是否可用。Vercel 的部署目录是只读的，写不进 users.json。与其让用户
 * 填完表单才报错，不如直接把注册标成不可用；真实注册只在自建服务器上开放。
 */
async function openRegistrationState() {
  const policy = registrationPolicy();
  const [storage, inviteCode] = await Promise.all([
    storageStatus(),
    effectiveInviteCode().catch(() => ""),
  ]);
  const userCount = await countUsers().catch(() => 0);
  return {
    enabled: policy.enabled && storage.ready && userCount < policy.maxUsers,
    storageReady: storage.ready,
    inviteRequired: Boolean(inviteCode),
    maxUsers: policy.maxUsers,
    userCount,
    remainingSlots: Math.max(0, policy.maxUsers - userCount),
  };
}

/**
 * 旧版单账号登录：站长账号 + 仓库内置口令散列仍然可用，命中后把账号补进
 * 用户库，方便平滑迁移到多账号模式。返回值是带 authVersion 的完整记录，
 * 只有这样签出来的 Cookie 才能在站长改过密码之后继续被识别。
 */
async function ensureOwnerAccount(username, password) {
  const existing = await findByUsername(username).catch(() => null);
  if (existing) {
    return existing;
  }
  await createUser({ username, password }).catch(() => {});
  return findByUsername(username).catch(() => null);
}

async function applyLegacyOwnerLogin(request, response, username, password) {
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

  const owner = await ensureOwnerAccount(configuredUsername, password);
  if (!owner) {
    // 用户库暂时写不进去时，仍然让站长用旧口令进入浏览状态。
    response.status(200).json({
      ok: true,
      user: configuredUsername,
      account: { id: "", username: configuredUsername, email: "" },
      migrated: false,
      message: "账号目录不可写，本次登录不保存云端进度。",
    });
    return true;
  }

  response.setHeader("Set-Cookie", sessionCookieFor(request, owner));
  telemetry.annotate(response, {
    user: owner.username,
    userId: owner.id,
    ip: clientIp(request),
  });
  response.status(200).json({
    ok: true,
    user: owner.username,
    account: publicAccount(owner),
    admin: isAdminUser(owner),
    migrated: true,
  });
  return true;
}

async function handleRegister(request, response, body) {
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

  const inviteCode = await effectiveInviteCode().catch(() => "");
  if (
    inviteCode &&
    !safeEqual(String(body.inviteCode || "").trim(), inviteCode)
  ) {
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
  const record = await findByUsername(user.username).catch(() => null);
  if (record) {
    response.setHeader("Set-Cookie", sessionCookieFor(request, record));
  }
  telemetry.annotate(response, { user: user.username, userId: user.id, ip });
  response.status(201).json({
    ok: true,
    user: user.username,
    account: user,
  });
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
    response.setHeader("Set-Cookie", sessionCookieFor(request, account));
    telemetry.annotate(response, {
      user: account.username,
      userId: account.id,
      ip,
    });
    response.status(200).json({
      ok: true,
      user: account.username,
      account: publicAccount(account),
      admin: isAdminUser(account),
    });
    return;
  }

  if (await applyLegacyOwnerLogin(request, response, username, password)) {
    clearLimit(accountKey);
    return;
  }

  response.status(401).json({ ok: false, message: "账号或密码不正确" });
}

/**
 * 找回申请：账号不存在也返回同样的成功文案，避免用这个接口探测账号是否存在。
 */
async function handleResetRequest(request, response, body) {
  const ip = clientIp(request);
  const login = String(body.login || body.username || "").trim();
  const limit = hitLimit(`reset:${ip}`, LIMITS.resetPerIp, RESET_WINDOW_MS);
  if (limit.blocked) {
    response
      .status(429)
      .json({ ok: false, message: "提交太频繁，请过一会儿再试。" });
    return;
  }

  if (!login) {
    response.status(400).json({ ok: false, message: "请填写账号或邮箱" });
    return;
  }

  const result = await requestPasswordReset({
    login,
    note: body.note,
  }).catch(() => ({ recorded: false }));

  telemetry.setMeta(response, { resetRequested: result.recorded });
  response.status(200).json({
    ok: true,
    recorded: result.recorded,
    message:
      "找回申请已提交。站长在管理台生成一次性令牌后会转交给你，30 分钟内有效。",
  });
}

async function handleResetPassword(request, response, body) {
  const ip = clientIp(request);
  const limit = hitLimit(
    `reset-submit:${ip}`,
    LIMITS.resetPerIp,
    RESET_WINDOW_MS,
  );
  if (limit.blocked) {
    response
      .status(429)
      .json({ ok: false, message: "尝试太频繁，请过一会儿再试。" });
    return;
  }

  const result = await resetPasswordWithToken({
    token: body.token,
    password: body.password,
  });
  telemetry.annotate(response, {
    user: result.user.username,
    userId: result.user.id,
    ip,
  });
  response.status(200).json({
    ok: true,
    user: result.user.username,
    account: result.user,
    message: "密码已重置，其他设备上的登录已失效，请用新密码登录。",
  });
}

async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  telemetry.annotate(response, { ip: clientIp(request) });

  try {
    if (request.method === "GET") {
      const user = await resolveSessionUser(request).catch(() => null);
      response.status(200).json({
        authenticated: Boolean(user),
        user: user?.username || null,
        account: user ? publicAccount(user) : null,
        admin: isAdminUser(user),
        serviceConfigured: Boolean(String(process.env.SESSION_SECRET || "")),
        registration: await openRegistrationState(),
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "不支持的请求方式" });
      return;
    }

    const body = await readJsonBody(request);

    if (body.action === "logout") {
      response.setHeader("Set-Cookie", clearCookieFor(request));
      response.status(200).json({ ok: true });
      return;
    }

    if (body.action === "invite-status") {
      const status = await inviteCodeStatus().catch(() => ({ required: false }));
      // 只回「要不要邀请码」，绝不把邀请码本身读给未登录的浏览器。
      response.status(200).json({ ok: true, required: Boolean(status.required) });
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

    if (body.action === "reset-request") {
      await handleResetRequest(request, response, body);
      return;
    }

    if (body.action === "reset-password") {
      await handleResetPassword(request, response, body);
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
    if (error && typeof error.statusCode === "number" && error.message) {
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
}

const wrapped = telemetry.wrap("auth", handler);

// 供脚本与验收用例直接引用，避免测试里再抄一份参数。
wrapped.__internals = {
  COOKIE_NAME,
  SESSION_SIGNING_REVISION,
  hashPassword,
  clientIp,
  isReservedUsername,
};

module.exports = wrapped;
