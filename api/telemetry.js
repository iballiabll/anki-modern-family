/**
 * 前端心跳：记录「谁在哪个页面、最近什么时候活跃」。
 *
 * 只收页面路径和标题，不收页面内容；IP 只留加盐散列。管理台的实时面板
 * 靠这个心跳算在线人数，具体接口调用统计由 _telemetry.wrap 记录。
 */

const {
  ONLINE_WINDOW_MS,
  recordActivity,
  summary,
} = require("./_telemetry.js");
const {
  clientIp,
  readJsonBody,
  resolveSessionUser,
} = require("./_session.js");
const telemetry = require("./_telemetry.js");

function short(value, max) {
  return String(value || "").trim().slice(0, max);
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
    response.status(401).json({ ok: false, message: "未登录" });
    return;
  }

  try {
    if (request.method === "GET") {
      const data = await summary();
      const mine =
        data.activity.find((entry) => entry.userId === user.id) || null;
      response.status(200).json({
        ok: true,
        online: data.online,
        onlineWindowMs: ONLINE_WINDOW_MS,
        me: mine,
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "不支持的请求方式" });
      return;
    }

    const body = await readJsonBody(request, 4096);
    const entry = await recordActivity({
      userId: user.id,
      username: user.username,
      page: short(body.page, 60) || "/",
      title: short(body.title, 60),
      ua: short(request.headers?.["user-agent"], 60),
      ip: clientIp(request),
    });
    const data = await summary();
    response.status(200).json({
      ok: true,
      online: data.online,
      beats: entry?.beats || 0,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error.message || "心跳上报失败",
    });
  }
}

module.exports = telemetry.wrap("telemetry", handler);
