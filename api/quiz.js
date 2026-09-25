/**
 * 单词测试接口。
 *
 *   GET  ?action=stats   个人最好成绩 + 词库规模
 *   POST { action: "start", scope, size, direction }
 *   POST { action: "submit", sessionId, answers }
 *
 * 判卷完全在服务端做（见 api/_quiz-store.js），客户端提交的分数一律忽略；
 * 交卷后把错词并进该账号的云端错词表，换设备也能看到。
 */

const {
  clientIp,
  readJsonBody,
  resolveSessionUser,
} = require("./_session.js");
const { mergeProgress, readProgress } = require("./_progress-store.js");
const {
  DEFAULT_QUESTIONS,
  SCOPE_DECKS,
  SCOPES,
  bestsForUser,
  consumeSession,
  createSession,
  loadPools,
  normalizeScope,
  poolSummary,
  saveBest,
  totalScoreFor,
} = require("./_quiz-store.js");
const telemetry = require("./_telemetry.js");

const WRONG_WORDS_KEY = "iball-quiz-wrong-v1";
const MAX_WRONG_WORDS = 500;

function readArrayEntry(store, key) {
  const entry = store.entries[key];
  if (!entry) {
    return [];
  }
  const value = entry.v;
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

/**
 * 错词并进云端错词表：按单词去重，新的排在前面，最多留 500 条。
 * 这样「记录单词的错词」不依赖浏览器，换设备也在。
 */
async function appendWrongWords(userId, words) {
  const incoming = (Array.isArray(words) ? words : [])
    .map((item) => ({
      word: String(item?.word || "").trim(),
      meaning: String(item?.meaning || "").trim(),
      at: new Date().toISOString(),
    }))
    .filter((item) => item.word);
  if (incoming.length === 0) {
    return { added: 0, total: 0 };
  }

  const store = await readProgress(userId);
  const existing = readArrayEntry(store, WRONG_WORDS_KEY).filter((item) =>
    item && typeof item === "object",
  );
  const seen = new Set(incoming.map((item) => item.word.toLowerCase()));
  const merged = [...incoming, ...existing.filter((item) => !seen.has(String(item.word || "").toLowerCase()))]
    .slice(0, MAX_WRONG_WORDS);

  await mergeProgress(userId, {
    entries: {
      [WRONG_WORDS_KEY]: { v: merged, t: Date.now() },
    },
  });

  return { added: incoming.length, total: merged.length };
}

async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  const user = await resolveSessionUser(request).catch(() => null);
  telemetry.annotate(response, {
    user: user?.username || "",
    userId: user?.id || "",
    ip: clientIp(request),
  });

  if (!user) {
    response.status(401).json({ ok: false, message: "登录后才能参加单词测试。" });
    return;
  }

  try {
    if (request.method === "GET") {
      const [bests, pools] = await Promise.all([
        bestsForUser(user.id),
        poolSummary().catch(() => ({})),
      ]);
      const totalScore = totalScoreFor(bests);
      response.status(200).json({
        ok: true,
        scopes: SCOPES,
        defaultSize: DEFAULT_QUESTIONS,
        pools,
        bests,
        total: totalScore,
        totalScore,
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "不支持的请求方式" });
      return;
    }

    const body = await readJsonBody(request);

    if (body.action === "start") {
      const scope = normalizeScope(body.scope) || "cet4";
      const session = await createSession({
        userId: user.id,
        scope,
        size: body.size,
        direction: body.direction,
      });
      telemetry.setMeta(response, { scope, size: session.questions.length });
      response.status(200).json({ ok: true, ...session });
      return;
    }

    if (body.action === "submit") {
      const result = await consumeSession({
        userId: user.id,
        sessionId: body.sessionId,
        answers: body.answers,
      });
      const saved = await saveBest({
        userId: user.id,
        scope: result.scope,
        score: result.score,
        total: result.total,
        percent: result.percent,
        wrongWords: result.wrong.length,
      });
      const wrongStore = await appendWrongWords(user.id, result.wrong).catch(
        () => ({ added: 0, total: 0 }),
      );
      const bests = await bestsForUser(user.id);
      const totalScore = totalScoreFor(bests);
      telemetry.setMeta(response, {
        scope: result.scope,
        score: result.score,
        total: result.total,
        improved: saved.improved,
      });
      response.status(200).json({
        ok: true,
        scope: result.scope,
        direction: result.direction,
        score: result.score,
        // 本次卷子的题量。总榜平均分单独放在 totalScore，两者不要混用。
        total: result.total,
        percent: result.percent,
        wrong: result.wrong,
        detail: result.detail,
        improved: saved.improved,
        best: saved.best,
        bests,
        totalScore,
        wrongWords: wrongStore,
      });
      return;
    }

    if (body.action === "scopes") {
      const pools = await poolSummary();
      response.status(200).json({ ok: true, scopes: Object.keys(SCOPE_DECKS), pools });
      return;
    }

    response.status(400).json({ ok: false, message: "无效的操作" });
  } catch (error) {
    response.status(error.statusCode || 400).json({
      ok: false,
      message: error.message || "测试服务暂时不可用，请稍后重试。",
    });
  }
}

const wrapped = telemetry.wrap("quiz", handler);
wrapped.__internals = { WRONG_WORDS_KEY, appendWrongWords };
module.exports = wrapped;
