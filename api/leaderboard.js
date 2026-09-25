/**
 * 单词测试榜单。
 *
 *   ?scope=cet4|kaoyan|all   单榜：每个账号在该范围的最好成绩
 *   ?scope=total             总榜：已完成范围最好成绩的平均分，考过一个就能上榜
 *
 * 只输出用户名和成绩，不带邮箱、IP 或任何进度内容。需要登录才能看，
 * 免得榜单把站内用户名暴露给未登录的访客。
 */

const { clientIp, resolveSessionUser } = require("./_session.js");
const { listUsers } = require("./_user-store.js");
const {
  SCOPES,
  allBests,
  normalizeScope,
  totalEntryFor,
} = require("./_quiz-store.js");
const telemetry = require("./_telemetry.js");

const TOP_LIMIT = 50;

function sortRows(rows) {
  return rows.sort((left, right) => {
    if (right.percent !== left.percent) {
      return right.percent - left.percent;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.total !== left.total) {
      return right.total - left.total;
    }
    return String(left.at).localeCompare(String(right.at));
  });
}

async function buildBoard(scope) {
  const [bests, users] = await Promise.all([allBests(), listUsers()]);
  const nameById = new Map(users.map((user) => [user.id, user.username]));
  const rows = [];

  for (const [userId, scopes] of Object.entries(bests)) {
    const username = nameById.get(userId);
    if (!username) {
      continue;
    }

    if (scope === "total") {
      const entry = totalEntryFor(scopes);
      if (!entry) {
        continue;
      }
      // score/total 只统计已完成的范围，所以「已考 1 门」显示 80/100 而不是 80/300。
      const donePercents = SCOPES.map((item) => entry.parts[item]).filter(
        (value) => Number.isFinite(value),
      );
      rows.push({
        userId,
        username,
        percent: entry.percent,
        score: donePercents.reduce((sum, value) => sum + value, 0),
        total: donePercents.length * 100,
        completed: entry.completed,
        totalRanges: entry.totalRanges,
        at:
          SCOPES.map((item) =>
            Number.isFinite(entry.parts[item]) ? scopes[item]?.at || "" : "",
          )
            .sort()
            .pop() || "",
        parts: entry.parts,
      });
      continue;
    }

    const entry = scopes[scope];
    if (!entry) {
      continue;
    }
    rows.push({
      userId,
      username,
      percent: Number(entry.percent) || 0,
      score: Number(entry.score) || 0,
      total: Number(entry.total) || 0,
      at: entry.at || "",
    });
  }

  sortRows(rows);
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
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
    response.status(401).json({ ok: false, message: "登录后才能查看榜单。" });
    return;
  }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "不支持的请求方式" });
    return;
  }

  try {
    const raw = String(request.query?.scope || "total").toLowerCase();
    const scope = raw === "total" ? "total" : normalizeScope(raw) || "total";
    const rows = await buildBoard(scope);
    const top = rows.slice(0, TOP_LIMIT).map((row) => ({
      rank: row.rank,
      username: row.username,
      percent: row.percent,
      score: row.score,
      total: row.total,
      at: row.at,
      ...(row.parts ? { parts: row.parts } : {}),
      ...(row.completed ? { completed: row.completed, totalRanges: row.totalRanges } : {}),
    }));
    const me = rows.find((row) => row.userId === user.id) || null;

    telemetry.setMeta(response, { scope, players: rows.length });
    response.status(200).json({
      ok: true,
      scope,
      updatedAt: new Date().toISOString(),
      players: rows.length,
      top,
      me: me
        ? {
            rank: me.rank,
            username: me.username,
            percent: me.percent,
            score: me.score,
            total: me.total,
            at: me.at,
            ...(me.parts ? { parts: me.parts } : {}),
            ...(me.completed
              ? { completed: me.completed, totalRanges: me.totalRanges }
              : {}),
          }
        : null,
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error.message || "榜单暂时不可用，请稍后重试。",
    });
  }
}

const wrapped = telemetry.wrap("leaderboard", handler);
wrapped.__internals = { buildBoard, sortRows };
module.exports = wrapped;
