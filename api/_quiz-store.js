/**
 * 单词测试与榜单存储。
 *
 * 计分规则（防作弊的关键）：出题时服务端把正确答案写进 quiz-sessions.json，
 * 只把题面和一个随机 sessionId 发给浏览器；提交时按服务端存的答案重新算分。
 * 客户端既看不到答案，也没有任何入口直接写分数。
 *
 * 词库来自仓库里的 vocab-index/：
 *   deck-cet4.json / deck-kaoyan.json  只要单词清单
 *   word-quick.json                    单词 -> 音标 / 释义 / 标签
 */

const crypto = require("crypto");
const fsp = require("fs/promises");
const path = require("path");
const { dataDir } = require("./_user-store.js");

const SCOPES = ["cet4", "kaoyan", "all"];
const SCOPE_DECKS = {
  cet4: ["cet4"],
  kaoyan: ["kaoyan"],
  all: ["basic", "cet4", "cet6", "kaoyan"],
};
const SESSION_TTL_MS = 20 * 60 * 1000;
const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 50;
const DEFAULT_QUESTIONS = 20;
const MAX_SESSIONS = 400;

let writeChain = Promise.resolve();
let poolCache = null;
let poolPromise = null;

function withWriteLock(task) {
  const result = writeChain.then(task, task);
  writeChain = result.catch(() => {});
  return result;
}

function repoRoot() {
  return path.resolve(__dirname, "..");
}

function dataFile(name) {
  return path.join(dataDir(), name);
}

async function readJsonFile(file, fallback) {
  try {
    const raw = await fsp.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(file, value) {
  const dir = dataDir();
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, payload, { mode: 0o600 });
  await fsp.rename(tempPath, file);
}

function normalizeScope(scope) {
  const value = String(scope || "").trim().toLowerCase();
  return SCOPES.includes(value) ? value : "";
}

/** "vt. 放弃, 抛弃\nn. 放任" -> "vt. 放弃, 抛弃"（题面只留前一小段，避免太长）。 */
function cleanMeaning(raw) {
  const text = String(raw || "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 46) {
    return text;
  }
  const cut = text.slice(0, 46);
  const boundary = Math.max(
    cut.lastIndexOf(","),
    cut.lastIndexOf(";"),
    cut.lastIndexOf("，"),
    cut.lastIndexOf("；"),
  );
  const base = boundary >= 12 ? cut.slice(0, boundary) : cut;
  return `${base.replace(/[,;，；]\s*$/, "").trim()}…`;
}

async function loadPools() {
  if (poolCache) {
    return poolCache;
  }
  if (poolPromise) {
    return poolPromise;
  }

  poolPromise = (async () => {
    const quick = await readJsonFile(
      path.join(repoRoot(), "vocab-index", "word-quick.json"),
      {},
    );
    const meanings = quick.words && typeof quick.words === "object" ? quick.words : {};
    const pools = {};

    for (const scope of SCOPES) {
      const seen = new Set();
      const pool = [];
      for (const deck of SCOPE_DECKS[scope]) {
        const data = await readJsonFile(
          path.join(repoRoot(), "vocab-index", `deck-${deck}.json`),
          {},
        );
        const words = Array.isArray(data.words) ? data.words : [];
        for (const rawWord of words) {
          const word = String(rawWord || "").trim();
          const key = word.toLowerCase();
          if (!word || seen.has(key)) {
            continue;
          }
          const record = meanings[word] || meanings[key];
          if (!record) {
            continue;
          }
          const [phonetic = "", definition = ""] = String(record).split("\t");
          const meaning = cleanMeaning(definition);
          if (!meaning || meaning.length < 2) {
            continue;
          }
          seen.add(key);
          pool.push({ word, phonetic: phonetic.trim(), meaning });
        }
      }
      pools[scope] = pool;
    }

    poolCache = pools;
    poolPromise = null;
    return pools;
  })().catch((error) => {
    poolPromise = null;
    throw error;
  });

  return poolPromise;
}

async function poolSummary() {
  const pools = await loadPools();
  return Object.fromEntries(
    SCOPES.map((scope) => [scope, pools[scope].length]),
  );
}

function randomInt(max) {
  return max <= 1 ? 0 : crypto.randomInt(max);
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/**
 * 出题：从同一范围内随机取单词，干扰项也来自同一范围，
 * 保证四个选项在同一个难度层级上。
 */
function buildQuestions(pool, size, direction) {
  const picked = shuffle(pool).slice(0, size);
  const questions = [];

  for (const item of picked) {
    const optionSource = [];
    let guard = 0;
    while (optionSource.length < 3 && guard < 400) {
      guard += 1;
      const candidate = pool[randomInt(pool.length)];
      if (!candidate || candidate.word === item.word) {
        continue;
      }
      const value = direction === "zh-en" ? candidate.word : candidate.meaning;
      if (value === (direction === "zh-en" ? item.word : item.meaning)) {
        continue;
      }
      if (
        optionSource.includes(value) ||
        questions.some((question) => question.prompt === value)
      ) {
        continue;
      }
      optionSource.push(value);
    }
    while (optionSource.length < 3) {
      optionSource.push(`—${optionSource.length + 1}`);
    }

    const correct = direction === "zh-en" ? item.word : item.meaning;
    const options = shuffle([correct, ...optionSource]);
    questions.push({
      id: questions.length + 1,
      prompt: direction === "zh-en" ? item.meaning : item.word,
      phonetic: direction === "zh-en" ? "" : item.phonetic,
      options,
      answer: options.indexOf(correct),
      word: item.word,
      meaning: item.meaning,
    });
  }

  return questions;
}

async function readSessions() {
  return readJsonFile(dataFile("quiz-sessions.json"), {
    version: 1,
    sessions: {},
  });
}

async function writeSessions(store) {
  const now = Date.now();
  const entries = Object.entries(store.sessions || {})
    .filter(([, session]) => {
      const expires = Date.parse(session.expiresAt || 0);
      return Number.isFinite(expires) && expires > now - 60 * 60 * 1000;
    })
    .sort(
      (left, right) =>
        Date.parse(right[1].createdAt || 0) - Date.parse(left[1].createdAt || 0),
    )
    .slice(0, MAX_SESSIONS);
  await writeJsonFile(dataFile("quiz-sessions.json"), {
    version: 1,
    sessions: Object.fromEntries(entries),
  });
}

async function createSession({ userId, scope, size, direction }) {
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) {
    throw new Error("未知的测试范围");
  }
  const dir = direction === "zh-en" ? "zh-en" : "en-zh";
  const total = Math.min(
    MAX_QUESTIONS,
    Math.max(MIN_QUESTIONS, Number(size) || DEFAULT_QUESTIONS),
  );
  const pools = await loadPools();
  const pool = pools[normalizedScope];
  if (pool.length < 8) {
    throw new Error("这个词库暂时没有足够的题目");
  }

  const questions = buildQuestions(pool, Math.min(total, pool.length), dir);
  const sessionId = crypto.randomBytes(18).toString("base64url");
  const now = Date.now();
  const session = {
    id: sessionId,
    userId: String(userId),
    scope: normalizedScope,
    direction: dir,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    submittedAt: "",
    key: questions.map((question) => question.answer),
    words: questions.map((question) => ({
      word: question.word,
      meaning: question.meaning,
    })),
  };

  await withWriteLock(async () => {
    const store = await readSessions();
    store.sessions[sessionId] = session;
    await writeSessions(store);
  });

  return {
    sessionId,
    scope: normalizedScope,
    direction: dir,
    expiresAt: session.expiresAt,
    questions: questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      phonetic: question.phonetic,
      options: question.options,
    })),
  };
}

/**
 * 判卷：答案取服务端存的那一份，客户端提交的分数一律忽略。
 * 交卷后会话标记为已提交，重复提交同一个 sessionId 会被拒绝。
 */
async function consumeSession({ userId, sessionId, answers }) {
  const id = String(sessionId || "").trim();
  if (!id) {
    throw new Error("缺少答题会话");
  }

  return withWriteLock(async () => {
    const store = await readSessions();
    const session = store.sessions[id];
    if (!session || session.userId !== String(userId)) {
      throw new Error("答题会话不存在或不属于当前账号");
    }
    if (session.submittedAt) {
      throw new Error("这套题已经交过卷了，重新开一套吧");
    }
    if (Date.parse(session.expiresAt || 0) <= Date.now()) {
      throw new Error("答题超时，请重新开一套题");
    }

    const list = Array.isArray(answers) ? answers : [];
    let score = 0;
    const wrong = [];
    const detail = session.key.map((answer, index) => {
      const submitted = Number(list[index]);
      const correct = Number.isInteger(submitted) && submitted === answer;
      if (correct) {
        score += 1;
      } else {
        wrong.push({
          word: session.words[index].word,
          meaning: session.words[index].meaning,
        });
      }
      return { index, expected: answer, submitted: Number.isInteger(submitted) ? submitted : -1, correct };
    });

    session.submittedAt = new Date().toISOString();
    store.sessions[id] = session;
    await writeSessions(store);

    const total = session.key.length;
    return {
      scope: session.scope,
      direction: session.direction,
      score,
      total,
      percent: total ? Math.round((score / total) * 100) : 0,
      wrong,
      detail,
    };
  });
}

async function readBestsStore() {
  return readJsonFile(dataFile("quiz.json"), { version: 1, bests: {} });
}

/** 每个账号每个范围只保留最好的一次成绩。返回是否刷新了纪录。 */
async function saveBest({ userId, scope, score, total, percent, wrongWords }) {
  const id = String(userId);
  const normalizedScope = normalizeScope(scope);
  if (!normalizedScope) {
    throw new Error("未知的测试范围");
  }
  const at = new Date().toISOString();
  const entry = {
    score,
    total,
    percent,
    at,
    wrongWords: Number(wrongWords) || 0,
  };

  return withWriteLock(async () => {
    const store = await readBestsStore();
    store.bests[id] = store.bests[id] || {};
    const current = store.bests[id][normalizedScope];
    const improved =
      !current ||
      entry.percent > current.percent ||
      (entry.percent === current.percent && entry.score > current.score);
    if (improved) {
      store.bests[id][normalizedScope] = entry;
      await writeJsonFile(dataFile("quiz.json"), store);
    } else {
      current.lastAt = at;
      await writeJsonFile(dataFile("quiz.json"), store);
    }
    return { improved, best: store.bests[id][normalizedScope] };
  });
}

async function bestsForUser(userId) {
  const store = await readBestsStore();
  return store.bests[String(userId)] || {};
}

/** 总榜按三个范围的最佳正确率取平均，三个范围都考过才计入。 */
function totalScoreFor(bests = {}) {
  const values = SCOPES.map((scope) => Number(bests[scope]?.percent));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function allBests() {
  const store = await readBestsStore();
  return store.bests || {};
}

async function quizStats() {
  const [bests, sessions] = await Promise.all([
    readBestsStore(),
    readSessions(),
  ]);
  const activeSessions = Object.values(sessions.sessions || {}).filter(
    (session) =>
      !session.submittedAt && Date.parse(session.expiresAt || 0) > Date.now(),
  ).length;
  const today = new Date().toISOString().slice(0, 10);
  let playsToday = 0;
  for (const userBests of Object.values(bests.bests || {})) {
    for (const entry of Object.values(userBests)) {
      if (String(entry?.at || "").startsWith(today)) {
        playsToday += 1;
      }
    }
  }
  return {
    players: Object.keys(bests.bests || {}).length,
    activeSessions,
    playsToday,
  };
}

module.exports = {
  DEFAULT_QUESTIONS,
  SCOPE_DECKS,
  SCOPES,
  allBests,
  bestsForUser,
  cleanMeaning,
  createSession,
  consumeSession,
  loadPools,
  normalizeScope,
  poolSummary,
  quizStats,
  saveBest,
  totalScoreFor,
};
