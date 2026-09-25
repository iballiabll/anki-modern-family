/**
 * 管理端接口（只有管理员账号可用）。
 *
 *   GET  ?action=overview   一次拿齐：在线/调用统计 + 用户列表 + 找回申请 + 榜单规模
 *   GET  ?action=activity   实时活动 + 最近请求流
 *   GET  ?action=resets     只取找回申请
 *   POST { action: "invite-code", code }      设置邀请码（留空 = 关闭邀请码）
 *   POST { action: "invite-generate", prefix } 随机生成并保存一个邀请码
 *   POST { action: "reset-token", userId, ttlMinutes } 生成一次性重置令牌
 *   POST { action: "handle-reset", requestId }         标记找回申请已处理
 *
 * 有意不返回：口令散列、进度正文、作文内容、用户自己填的 API Key。
 * 管理端只看到「谁在什么时候调了哪个接口、有多少数据、错词几条」。
 */

const { isAdminUser, readJsonBody, resolveSessionUser, clientIp } = require("./_session.js");
const {
  StoreError,
  createResetToken,
  listResetRequests,
  listUsers,
  markResetRequestHandled,
} = require("./_user-store.js");
const {
  generateInviteCode,
  inviteCodeStatus,
  setInviteCode,
} = require("./_site-settings.js");
const { SCOPES, allBests, quizStats, totalScoreFor } = require("./_quiz-store.js");
const { progressSummary } = require("./_progress-store.js");
const telemetryStore = require("./_telemetry.js");

async function buildOverview() {
  const [users, resets, monitor, bests, quiz, invite, storage] =
    await Promise.all([
      listUsers(),
      listResetRequests({ limit: 30 }).catch(() => []),
      telemetryStore.summary().catch(() => ({
        callsLastHour: 0,
        errorsLastHour: 0,
        avgMsLastHour: 0,
        endpoints: [],
        online: 0,
        activity: [],
      })),
      allBests().catch(() => ({})),
      quizStats().catch(() => ({ players: 0, activeSessions: 0, playsToday: 0 })),
      inviteCodeStatus().catch(() => ({ required: false })),
      require("./_user-store.js").storageStatus().catch(() => ({ ready: false })),
    ]);

  const summaries = await Promise.all(
    users.map((user) => progressSummary(user.id).catch(() => null)),
  );
  const progressById = new Map(
    summaries
      .filter(Boolean)
      .map((item) => [item.userId, item]),
  );
  const nameById = new Map(users.map((user) => [user.id, user.username]));
  const activityById = new Map(
    (monitor.activity || []).map((entry) => [entry.userId, entry]),
  );

  return {
    ok: true,
    serverTime: new Date().toISOString(),
    storage,
    // 邀请码回显给管理员是有意的：这是站长自己设的注册口令，需要随时转达给学生。
    invite: {
      required: Boolean(invite.required),
      updatedAt: invite.updatedAt || "",
      code: invite.inviteCode || "",
      // 环境变量兜底时也要能看到实际生效的码，否则没法发给学生。
      effectiveCode: invite.effectiveCode || invite.inviteCode || "",
      envFallback: Boolean(invite.envFallback),
    },
    monitor: {
      online: monitor.online || 0,
      callsLastHour: monitor.callsLastHour || 0,
      errorsLastHour: monitor.errorsLastHour || 0,
      avgMsLastHour: monitor.avgMsLastHour || 0,
      endpoints: monitor.endpoints || [],
      activity: monitor.activity || [],
    },
    quiz: {
      ...quiz,
      scopes: SCOPES,
      withScore: Object.keys(bests).length,
    },
    users: users.map((user) => {
      const progress = progressById.get(user.id);
      const scopes = bests[user.id] || {};
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        passwordUpdatedAt: user.passwordUpdatedAt,
        keys: progress?.keys || 0,
        bytes: progress?.bytes || 0,
        wrongWords: progress?.wrongWords || 0,
        progressUpdatedAt: progress?.updatedAt || "",
        online: Boolean(activityById.get(user.id)?.online),
        page: activityById.get(user.id)?.page || "",
        lastSeenAt: activityById.get(user.id)?.lastSeenAt || "",
        bests: Object.fromEntries(
          SCOPES.map((scope) => [scope, Number(scopes[scope]?.percent) || 0]),
        ),
        total: totalScoreFor(scopes),
      };
    }),
    resets: resets.map((item) => ({
      id: item.id,
      username: item.username || nameById.get(item.userId) || "",
      userId: item.userId,
      createdAt: item.createdAt,
      handledAt: item.handledAt || "",
      handledBy: item.handledBy || "",
      note: item.note || "",
    })),
  };
}

async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  const user = await resolveSessionUser(request).catch(() => null);
  telemetryStore.annotate(response, {
    user: user?.username || "",
    userId: user?.id || "",
    ip: clientIp(request),
  });

  if (!user || !isAdminUser(user)) {
    response.status(403).json({ ok: false, message: "只有管理员可以访问这个接口。" });
    return;
  }

  try {
    if (request.method === "GET") {
      const action = String(request.query?.action || "overview");
      if (action === "activity") {
        const [monitor, recent] = await Promise.all([
          telemetryStore.summary(),
          telemetryStore.recent({ limit: 80 }),
        ]);
        response.status(200).json({ ok: true, monitor, recent });
        return;
      }
      if (action === "resets") {
        response.status(200).json({
          ok: true,
          resets: await listResetRequests({ limit: 50 }),
        });
        return;
      }
      response.status(200).json(await buildOverview());
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "不支持的请求方式" });
      return;
    }

    const body = await readJsonBody(request);

    if (body.action === "invite-code") {
      const saved = await setInviteCode(body.code);
      telemetryStore.setMeta(response, { inviteChanged: true });
      response.status(200).json({
        ok: true,
        invite: {
          required: Boolean(saved.inviteCode),
          updatedAt: saved.updatedAt,
          // 邀请码回显给管理员是必要的，否则没法转达给学生。
          code: saved.inviteCode,
        },
      });
      return;
    }

    if (body.action === "invite-generate") {
      const code = generateInviteCode(body.prefix);
      const saved = await setInviteCode(code);
      response.status(200).json({
        ok: true,
        invite: { required: true, updatedAt: saved.updatedAt, code },
      });
      return;
    }

    if (body.action === "reset-token") {
      const result = await createResetToken({
        userId: body.userId,
        ttlMinutes: body.ttlMinutes,
      });
      telemetryStore.setMeta(response, { resetTokenFor: result.username });
      response.status(200).json({
        ok: true,
        username: result.username,
        token: result.token,
        expiresAt: result.expiresAt,
      });
      return;
    }

    if (body.action === "handle-reset") {
      const result = await markResetRequestHandled({
        requestId: body.requestId,
        handledBy: user.username,
      });
      if (!result) {
        response.status(404).json({ ok: false, message: "没有这条找回申请。" });
        return;
      }
      response.status(200).json({ ok: true, ...result });
      return;
    }

    response.status(400).json({ ok: false, message: "无效的操作" });
  } catch (error) {
    if (error instanceof StoreError) {
      response.status(error.statusCode).json({ ok: false, message: error.message });
      return;
    }
    response.status(500).json({
      ok: false,
      message: error.message || "管理服务暂时不可用。",
    });
  }
}

module.exports = telemetryStore.wrap("admin", handler);
