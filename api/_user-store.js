/**
 * 账号存储：单文件 JSON + scrypt 口令散列。
 *
 * 自建服务器（搬瓦工等）上把 DATA_DIR 指到持久目录即可；本机默认写在
 * work/data/ 下（该目录已在 .gitignore 里，不会被提交到 GitHub）。
 * 口令只保存 scrypt 散列，散列参数随记录一起存，便于以后调高强度。
 *
 * 存储格式：
 *   { version: 1, users: [{ id, username, email, passwordHash, createdAt, lastLoginAt }] }
 *   passwordHash = scrypt$N$r$p$saltBase64$hashBase64
 */

const crypto = require("crypto");
const fsConstants = require("fs").constants;
const fsp = require("fs/promises");
const path = require("path");

const STORE_VERSION = 1;
const STORE_FILE = "users.json";
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

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
  return { version: STORE_VERSION, users: [] };
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
    const users = Array.isArray(parsed?.users) ? parsed.users : [];
    return { version: STORE_VERSION, users };
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
    { version: STORE_VERSION, users: store.users },
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

async function findByUsername(username) {
  const key = usernameKey(username);
  const store = await readStore();
  return store.users.find((user) => usernameKey(user.username) === key) || null;
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
    createdAt: new Date().toISOString(),
    lastLoginAt: "",
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
 * 校验账号密码，成功时更新最后登录时间并返回公开用户信息。
 * 失败返回 null，不区分“账号不存在”和“密码错误”，避免撞库探测。
 */
async function verifyCredentials(username, password) {
  const user = await findByUsername(username);
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
    }
    return store;
  });

  return publicUser({ ...user, lastLoginAt });
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
  dataDir,
  ensureUser,
  findByEmail,
  findByUsername,
  hashPassword,
  normalizeEmail,
  publicUser,
  storageStatus,
  storePath,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyCredentials,
  verifyPassword,
};
