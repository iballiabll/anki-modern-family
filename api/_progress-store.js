/**
 * 学习进度存储：一个账号一个文件 DATA_DIR/progress/<userId>.json。
 *
 * 结构是「按 key 带时间戳」的合并表，而不是整份覆盖：
 *   entries:    { "<localStorage 键>": { v: 任意 JSON, t: 毫秒时间戳 } }
 *   tombstones: { "<localStorage 键>": { t: 毫秒时间戳 } }
 * 多设备各自带时间戳上传，服务端只保留更新的那一份，删除用墓碑记录同步，
 * 这样手机和平板不会互相把对方的进度抹掉。
 *
 * 安全约定：
 *   · 调用者必须传会话里解析出来的 userId，绝不接受客户端自带 ID；
 *   · 落盘前递归剔除 apiKey / token / password 之类的字段；
 *   · 单条值超过 256 KB、键数超过上限的直接丢弃，防止磁盘被撑爆。
 */

const fsp = require("fs/promises");
const path = require("path");
const { dataDir } = require("./_user-store.js");

const PROGRESS_DIR = "progress";
const STORE_VERSION = 1;
const MAX_ENTRIES = 400;
const MAX_TOMBSTONES = 400;
const MAX_VALUE_BYTES = 256 * 1024;
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// 这些键里可能塞着用户自己的大模型 API Key，落盘前一律删掉。
const SENSITIVE_KEY_PATTERN =
  /^(api[-_]?key|apikey|key|token|access[-_]?token|refresh[-_]?token|authorization|auth|secret|client[-_]?secret|password|passwd|credential|session)$/i;

let writeChain = Promise.resolve();

function withWriteLock(task) {
  const result = writeChain.then(task, task);
  writeChain = result.catch(() => {});
  return result;
}

function progressDir() {
  return path.join(dataDir(), PROGRESS_DIR);
}

function safeFileName(userId) {
  return String(userId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 64);
}

function progressPath(userId) {
  const name = safeFileName(userId);
  if (!name) {
    throw new Error("progressPath 需要 userId");
  }
  return path.join(progressDir(), `${name}.json`);
}

function emptyStore(userId) {
  return {
    version: STORE_VERSION,
    userId: safeFileName(userId),
    updatedAt: "",
    entries: {},
    tombstones: {},
  };
}

function stripSensitive(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 2000).map((item) => stripSensitive(item, depth + 1));
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      continue;
    }
    result[key] = stripSensitive(item, depth + 1);
  }
  return result;
}

/**
 * localStorage 里存的是字符串；能解析成 JSON 就按 JSON 存，
 * 这样服务端剔敏感字段时能真正看清结构。
 */
function normalizeIncomingValue(rawValue) {
  if (typeof rawValue !== "string") {
    return stripSensitive(rawValue);
  }
  const text = rawValue;
  if (text.length > MAX_VALUE_BYTES) {
    return undefined;
  }
  try {
    return stripSensitive(JSON.parse(text));
  } catch {
    return text;
  }
}

function serializeValue(value) {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function sanitizeKey(key) {
  const value = String(key || "").trim();
  if (!value || value.length > 120) {
    return "";
  }
  if (SENSITIVE_KEY_PATTERN.test(value)) {
    return "";
  }
  return value;
}

async function readProgressStore(userId) {
  try {
    const raw = await fsp.readFile(progressPath(userId), "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: STORE_VERSION,
      userId: safeFileName(userId),
      updatedAt: parsed?.updatedAt || "",
      entries: parsed?.entries && typeof parsed.entries === "object" ? parsed.entries : {},
      tombstones:
        parsed?.tombstones && typeof parsed.tombstones === "object"
          ? parsed.tombstones
          : {},
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyStore(userId);
    }
    throw error;
  }
}

async function writeProgressStore(store) {
  const dir = progressDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const target = progressPath(store.userId);
  const payload = `${JSON.stringify(store, null, 2)}\n`;
  const tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, payload, { mode: 0o600 });
  await fsp.rename(tempPath, target);
  return store;
}

function pruneTombstones(tombstones, now = Date.now()) {
  const kept = Object.entries(tombstones)
    .filter(([, item]) => now - Number(item?.t || 0) < TOMBSTONE_TTL_MS)
    .sort((left, right) => Number(right[1]?.t || 0) - Number(left[1]?.t || 0))
    .slice(0, MAX_TOMBSTONES);
  return Object.fromEntries(kept);
}

/** 客户端拉取：只回传值和时间戳，不含任何服务端内部字段。 */
async function readProgress(userId) {
  const store = await readProgressStore(userId);
  return {
    updatedAt: store.updatedAt,
    entries: store.entries,
    tombstones: store.tombstones,
  };
}

/**
 * 客户端上传：逐键比较时间戳，新的覆盖旧的；墓碑比值新就删掉这个键。
 * 返回实际写入的键数，方便前端知道同步是否生效。
 */
async function mergeProgress(userId, snapshot = {}) {
  const incomingEntries =
    snapshot.entries && typeof snapshot.entries === "object"
      ? snapshot.entries
      : {};
  const incomingTombstones =
    snapshot.tombstones && typeof snapshot.tombstones === "object"
      ? snapshot.tombstones
      : {};

  return withWriteLock(async () => {
    const store = await readProgressStore(userId);
    const now = Date.now();
    let written = 0;
    let skipped = 0;

    for (const [rawKey, item] of Object.entries(incomingEntries)) {
      const key = sanitizeKey(rawKey);
      if (!key) {
        skipped += 1;
        continue;
      }
      const incomingTime = Number(item?.t || now);
      const current = store.entries[key];
      if (current && Number(current.t || 0) >= incomingTime) {
        continue;
      }
      const value = normalizeIncomingValue(item?.v);
      if (value === undefined) {
        skipped += 1;
        continue;
      }
      store.entries[key] = { v: value, t: incomingTime };
      delete store.tombstones[key];
      written += 1;
    }

    for (const [rawKey, item] of Object.entries(incomingTombstones)) {
      const key = sanitizeKey(rawKey);
      if (!key) {
        continue;
      }
      const incomingTime = Number(item?.t || now);
      const current = store.entries[key];
      if (current && Number(current.t || 0) > incomingTime) {
        continue;
      }
      store.tombstones[key] = { t: incomingTime };
      if (current) {
        delete store.entries[key];
        written += 1;
      }
    }

    const entryKeys = Object.keys(store.entries);
    if (entryKeys.length > MAX_ENTRIES) {
      entryKeys
        .sort(
          (left, right) =>
            Number(store.entries[left].t || 0) -
            Number(store.entries[right].t || 0),
        )
        .slice(0, entryKeys.length - MAX_ENTRIES)
        .forEach((key) => {
          delete store.entries[key];
        });
    }
    store.tombstones = pruneTombstones(store.tombstones, now);
    store.updatedAt = new Date(now).toISOString();

    await writeProgressStore(store);
    return {
      written,
      skipped,
      keys: Object.keys(store.entries).length,
      updatedAt: store.updatedAt,
    };
  });
}

function readEntryArray(store, key) {
  const entry = store.entries[key];
  if (!entry) {
    return [];
  }
  const value = typeof entry.v === "string" ? entry.v : entry.v;
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 管理端用的汇总：只看体量、更新时间和错词数量，不把内容吐给前端。 */
async function progressSummary(userId) {
  const store = await readProgressStore(userId).catch(() => emptyStore(userId));
  const entries = Object.entries(store.entries);
  let bytes = 0;
  for (const [, item] of entries) {
    bytes += Buffer.byteLength(serializeValue(item.v) || "", "utf8");
  }
  const wrongWords = [
    ...readEntryArray(store, "iball-quiz-wrong-v1"),
    ...readEntryArray(store, "iball_vocab_wordbook_v1"),
  ].length;
  return {
    userId: safeFileName(userId),
    keys: entries.length,
    bytes,
    wrongWords,
    updatedAt: store.updatedAt,
  };
}

module.exports = {
  MAX_ENTRIES,
  MAX_VALUE_BYTES,
  mergeProgress,
  progressDir,
  progressPath,
  progressSummary,
  readProgress,
  sanitizeKey,
  stripSensitive,
};
