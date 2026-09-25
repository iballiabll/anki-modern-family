/**
 * 账号存储：单文件 JSON + scrypt 口令散列。
 *
 * 自建服务器（搬瓦工等）上把 DATA_DIR 指到持久目录即可；本机默认写在
 * work/data/ 下（该目录已在 .gitignore 里，不会被提交到 GitHub）。
 * 口令只保存 scrypt 散列，散列参数随记录一起存，便于以后调高强度。
 *
 * 存储格式：
 *   { version: 2, users: [...], resetRequests: [...] }
 *   user = { id, username, email, passwordHash, authVersion, createdAt,
 *            lastLoginAt, passwordUpdatedAt, resetTokens: [{ hash, expiresAt }] }
 *   passwordHash = scrypt$N$r$p$saltBase64$hashBase64
 *
 * authVersion 每改一次密码就 +1，登录 Cookie 里带着它，重置密码后旧会话
 * 立刻失效；find 系列函数会自动给 1.0 时代的老记录补默认值。
 */

const crypto = require("crypto");
const fsConstants = require("fs").constants;
const fsp = require("fs/promises");
const path = require("path");

const STORE_VERSION = 2;
const STORE_FILE = "users.json";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_TOKEN_MAX_ACTIVE = 3;
const RESET_REQUEST_COOLDOWN_MS = 10 * 60 * 1000;
const RESET_REQUEST_KEEP = 50;

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

class StoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "StoreError";
    this.statusCode = statusCode;
  }
}

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function dataDir() {
  const configured = String(process.env.DATA_DIR || "").trim();
  return configured
    ? path.resolve(configured)
    : path.join(repoRoot(), "work", "data");
}

function storePath() {
  return path.join(dataDir(), STORE_FILE);
}

// 同一个进程里串行化写入，避免两个注册请求互相覆盖。
let writeChain = Promise.resolve();

function withWriteLock(task) {
  const result = writeChain.then(task, task);
  writeChain = result.catch(() => {});
  return result;
}

function emptyStore() {
  return { version: STORE_VERSION, users: [], resetRequests: [] };
}

/**
 * 补齐旧记录缺的字段。读的时候顺手归一化，写回去自然就升级成新格式，
 * 不需要单独的迁移脚本。
 */
function normalizeUser(user) {
  if (!user || typeof user !== "object") {
    return user;
  }
  return {
    ...user,
    id: user.id || crypto.randomUUID(),
    email: user.email || "",
    authVersion: Number(user.authVersion) || 1,
    createdAt: user.createdAt || "",
    lastLoginAt: user.lastLoginAt || "",
    passwordUpdatedAt: user.passwordUpdatedAt || "",
    resetTokens: Array.isArray(user.resetTokens) ? user.resetTokens : [],
  };
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function usernameKey(value) {
  return normalizeUsername(value).toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || "",
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || "",
  };
}

async function readStore() {
  let raw;
  try {
    raw = await fsp.readFile(storePath(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed?.users)
      ? parsed.users.map(normalizeUser)
      : [];
    const resetRequests = Array.isArray(parsed?.resetRequests)
      ? parsed.resetRequests
      : [];
    return { version: STORE_VERSION, users, resetRequests };
  } catch {
    throw new StoreError(
      "账号数据文件无法解析，已停止写入以免覆盖。请检查 " + storePath(),
      500,
    );
  }
}

async function writeStore(store) {
  const dir = dataDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });

  const payload = JSON.stringify(
    {
      version: STORE_VERSION,
      users: store.users,
      resetRequests: store.resetRequests || [],
    },
    null,
    2,
  );
  const tempPath = `${storePath()}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, `${payload}\n`, { mode: 0o600 });
  await fsp.rename(tempPath, storePath());
  return store;
}

async function updateStore(mutator) {
  return withWriteLock(async () => {
    const store = await readStore();
    const next = (await mutator(store)) || store;
    return writeStore(next);
  });
}

function validateUsername(username) {
  const value = normalizeUsername(username);
  if (!value) {
    throw new StoreError("请填写账号");
  }
  if (!USERNAME_PATTERN.test(value)) {
    throw new StoreError("账号需 3-24 位，只能使用字母、数字、下划线或短横线");
  }
  return value;
}

function validatePassword(password, username = "") {
  const value = String(password || "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new StoreError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw new StoreError(`密码不能超过 ${MAX_PASSWORD_LENGTH} 位`);
  }
  if (username && value.toLowerCase() === String(username).toLowerCase()) {
    throw new StoreError("密码不能和账号相同");
  }
  return value;
}

function validateEmail(email) {
  const value = normalizeEmail(email);
  if (!value) {
    return "";
  }
  if (!EMAIL_PATTERN.test(value) || value.length > 200) {
    throw new StoreError("邮箱格式不正确");
  }
  return value;
}

function scryptAsync(password, salt, keylen, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

async function hashPassword(password) {
  const value = String(password);
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(value, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, n, r, p, saltBase64, hashBase64] = parts;
  const salt = Buffer.from(saltBase64, "base64");
  const expected = Buffer.from(hashBase64, "base64");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  let derived;
  try {
    derived = await scryptAsync(String(password), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false;
  }

  return (
    derived.length === expected.length &&
    crypto.timingSafeEqual(derived, expected)
  );
}

async function countUsers() {
  const store = await readStore();
  return store.users.length;
}

/** 管理端与榜单用：返回不带口令散列的用户列表（按注册时间升序）。 */
async function listUsers() {
  const store = await readStore();
  return store.users
    .map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email || "",
      createdAt: user.createdAt || "",
      lastLoginAt: user.lastLoginAt || "",
      passwordUpdatedAt: user.passwordUpdatedAt || "",
      authVersion: Number(user.authVersion) || 1,
    }))
    .sort((left, right) =>
      String(left.createdAt).localeCompare(String(right.createdAt)),
    );
}

async function findByUsername(username) {
  const key = usernameKey(username);
  const store = await readStore();
  return (
    store.users.find((user) => usernameKey(user.username) === key) || null
  );
}

async function findById(id) {
  const key = String(id || "").trim();
  if (!key) {
    return null;
  }
  const store = await readStore();
  return store.users.find((user) => user.id === key) || null;
}

/** 登录入口可以是账号，也可以是注册时填的邮箱。 */
async function findByLogin(login) {
  const value = String(login || "").trim();
  if (!value) {
    return null;
  }
  if (value.includes("@")) {
    return findByEmail(value);
  }
  const byName = await findByUsername(value);
  return byName || findByEmail(value);
}

async function findByEmail(email) {
  const key = normalizeEmail(email);
  if (!key) {
    return null;
  }
  const store = await readStore();
  return store.users.find((user) => normalizeEmail(user.email) === key) || null;
}

async function createUser({ username, password, email = "" }) {
  const name = validateUsername(username);
  const pass = validatePassword(password, name);
  const mail = validateEmail(email);

  const passwordHash = await hashPassword(pass);
  const user = {
    id: crypto.randomUUID(),
    username: name,
    email: mail,
    passwordHash,
    authVersion: 1,
    createdAt: new Date().toISOString(),
    lastLoginAt: "",
    passwordUpdatedAt: "",
    resetTokens: [],
  };

  await updateStore((store) => {
    if (store.users.some((item) => usernameKey(item.username) === usernameKey(name))) {
      throw new StoreError("这个账号已经注册过了", 409);
    }
    if (mail && store.users.some((item) => normalizeEmail(item.email) === mail)) {
      throw new StoreError("这个邮箱已经注册过了", 409);
    }
    store.users.push(user);
    return store;
  });

  return publicUser(user);
}

/**
 * 校验账号密码，成功时更新最后登录时间并返回完整用户记录。
 * 失败返回 null，不区分“账号不存在”和“密码错误”，避免撞库探测。
 * 注意：返回值带 passwordHash，只允许服务端内部使用，发给前端前要走 publicUser。
 */
async function verifyCredentials(username, password) {
  const user = await findByLogin(username);
  if (!user) {
    return null;
  }

  const matched = await verifyPassword(password, user.passwordHash);
  if (!matched) {
    return null;
  }

  const lastLoginAt = new Date().toISOString();
  await updateStore((store) => {
    const target = store.users.find((item) => item.id === user.id);
    if (target) {
      target.lastLoginAt = lastLoginAt;
      Object.assign(target, normalizeUser(target));
    }
    return store;
  });

  return normalizeUser({ ...user, lastLoginAt });
}

/** 改密码：authVersion +1，所有旧会话立即失效，已发出去的找回令牌作废。 */
async function updatePassword({
  userId,
  password,
  markUpdated = true,
  consumeTokenHash = "",
}) {
  const id = String(userId || "").trim();
  if (!id) {
    throw new StoreError("缺少账号标识", 400);
  }

  const existing = await findById(id);
  if (!existing) {
    throw new StoreError("账号不存在", 404);
  }
  const pass = validatePassword(password, existing.username);
  const passwordHash = await hashPassword(pass);
  const passwordUpdatedAt = new Date().toISOString();
  let nextVersion = 1;

  await updateStore((store) => {
    const target = store.users.find((item) => item.id === id);
    if (!target) {
      throw new StoreError("账号不存在", 404);
    }
    // 带令牌重置时，在同一个写锁里再确认一次令牌仍然存在且没过期，
    // 这样并发提交同一个令牌只会有一个成功。
    if (consumeTokenHash) {
      const record = (target.resetTokens || []).find(
        (item) => item.hash === consumeTokenHash,
      );
      if (!record) {
        throw new StoreError("重置令牌无效或已被使用", 400);
      }
      if (Date.parse(record.expiresAt || 0) <= Date.now()) {
        throw new StoreError("重置令牌已过期，请让站长重新生成", 400);
      }
    }
    nextVersion = (Number(target.authVersion) || 1) + 1;
    target.passwordHash = passwordHash;
    target.authVersion = nextVersion;
    if (markUpdated) {
      target.passwordUpdatedAt = passwordUpdatedAt;
    }
    target.resetTokens = [];
    return store;
  });

  return {
    user: publicUser({ ...existing, authVersion: nextVersion }),
    authVersion: nextVersion,
    passwordUpdatedAt,
  };
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

/**
 * 记录一次找回申请。查不到账号也返回 ok，避免用找回接口探测账号是否存在。
 * 同一账号 10 分钟内只留一条有效申请，防止刷爆管理端列表。
 */
async function requestPasswordReset({ login, note = "" }) {
  const value = String(login || "").trim();
  const now = Date.now();
  const user = await findByLogin(value).catch(() => null);
  if (!user) {
    return { recorded: false };
  }

  const request = {
    id: crypto.randomUUID(),
    userId: user.id,
    username: user.username,
    login: value,
    note: String(note || "").slice(0, 200),
    createdAt: new Date(now).toISOString(),
    handledAt: "",
    handledBy: "",
  };
  let recorded = true;

  await updateStore((store) => {
    const recent = (store.resetRequests || []).find(
      (item) =>
        item.userId === user.id &&
        !item.handledAt &&
        now - Date.parse(item.createdAt || 0) < RESET_REQUEST_COOLDOWN_MS,
    );
    if (recent) {
      recorded = false;
      return store;
    }
    store.resetRequests = [request, ...(store.resetRequests || [])].slice(
      0,
      RESET_REQUEST_KEEP,
    );
    return store;
  });

  return { recorded, request: recorded ? request : null };
}

async function listResetRequests({ limit = 20 } = {}) {
  const store = await readStore();
  return (store.resetRequests || []).slice(0, Math.max(1, limit));
}

async function markResetRequestHandled({ requestId, handledBy = "" }) {
  const id = String(requestId || "").trim();
  const handledAt = new Date().toISOString();
  let found = false;

  await updateStore((store) => {
    const target = (store.resetRequests || []).find((item) => item.id === id);
    if (target) {
      target.handledAt = handledAt;
      target.handledBy = String(handledBy || "");
      found = true;
    }
    return store;
  });

  return found ? { requestId: id, handledAt } : null;
}

/**
 * 生成一次性重置令牌：只把 SHA-256 落盘，明文只在这一个响应里出现。
 * 30 分钟有效，同一账号最多同时存在 3 个，用完或改完密码即全部作废。
 */
async function createResetToken({ userId, ttlMinutes = 30 }) {
  const id = String(userId || "").trim();
  const user = await findById(id);
  if (!user) {
    throw new StoreError("账号不存在", 404);
  }

  const ttl = Math.min(
    24 * 60,
    Math.max(5, Number(ttlMinutes) || RESET_TOKEN_TTL_MS / 60000),
  );
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const record = { hash: hashResetToken(token), createdAt: new Date().toISOString(), expiresAt };

  await updateStore((store) => {
    const target = store.users.find((item) => item.id === id);
    if (!target) {
      throw new StoreError("账号不存在", 404);
    }
    const now = Date.now();
    const alive = (target.resetTokens || [])
      .filter((item) => Date.parse(item.expiresAt || 0) > now)
      .slice(-(RESET_TOKEN_MAX_ACTIVE - 1));
    target.resetTokens = [...alive, record];
    return store;
  });

  return { token, expiresAt, username: user.username };
}

/**
 * 用令牌重置密码：验令牌、改密码、作废其余令牌三步在一次写入里完成，
 * 保证令牌只能成功用一次。
 */
async function resetPasswordWithToken({ token, password }) {
  const raw = String(token || "").trim();
  if (!raw) {
    throw new StoreError("请填写重置令牌", 400);
  }
  const hash = hashResetToken(raw);
  const store = await readStore();
  const now = Date.now();
  const owner = store.users.find((user) =>
    (user.resetTokens || []).some((item) => item.hash === hash),
  );
  if (!owner) {
    throw new StoreError("重置令牌无效或已被使用", 400);
  }
  const record = owner.resetTokens.find((item) => item.hash === hash);
  if (Date.parse(record.expiresAt || 0) <= now) {
    throw new StoreError("重置令牌已过期，请让站长重新生成", 400);
  }

  return updatePassword({
    userId: owner.id,
    password,
    consumeTokenHash: hash,
  });
}

/** 把环境变量里的站长账号补进用户库，方便从旧版单账号登录平滑迁移。 */
async function ensureUser({ username, password, email = "" }) {
  const existing = await findByUsername(username);
  if (existing) {
    return { user: publicUser(existing), created: false };
  }

  const user = await createUser({ username, password, email });
  return { user, created: true };
}

async function storageStatus() {
  const dir = dataDir();
  try {
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    await fsp.access(dir, fsConstants.W_OK);
    return { ready: true, dir, file: storePath() };
  } catch (error) {
    return { ready: false, dir, file: storePath(), message: error.message };
  }
}

module.exports = {
  STORE_VERSION,
  StoreError,
  countUsers,
  createUser,
  createResetToken,
  dataDir,
  ensureUser,
  findById,
  findByEmail,
  findByLogin,
  findByUsername,
  hashPassword,
  listResetRequests,
  listUsers,
  markResetRequestHandled,
  normalizeEmail,
  normalizeUser,
  publicUser,
  requestPasswordReset,
  resetPasswordWithToken,
  storageStatus,
  storePath,
  updatePassword,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyCredentials,
  verifyPassword,
};
