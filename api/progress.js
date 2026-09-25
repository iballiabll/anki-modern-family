/**
 * 学习进度同步接口。
 *
 * 客户端把当前账号命名的 localStorage 快照（entries + tombstones）推上来，
 * 服务端按 key 的时间戳合并，再把合并后的结果回给客户端。
 *
 * 安全边界：userId 只从签名 Cookie 里解析，客户端传什么 ID 都不作数；
 * 落盘前由 _progress-store 递归剔除 apiKey / token / password 之类的字段。
 */

const {
  clientIp,
  readJsonBody,
  resolveSessionUser,
} = require("./_session.js");
const { mergeProgress, readProgress } = require("./_progress-store.js");
const telemetry = require("./_telemetry.js");

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
    response.status(401).json({ ok: false, message: "登录状态已失效，请重新登录。" });
    return;
  }

  try {
    if (request.method === "GET") {
      const snapshot = await readProgress(user.id);
      telemetry.setMeta(response, {
        keys: Object.keys(snapshot.entries).length,
      });
      response.status(200).json({ ok: true, ...snapshot });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "不支持的请求方式" });
      return;
    }

    const body = await readJsonBody(request);
    const result = await mergeProgress(user.id, body);
    const snapshot = await readProgress(user.id);
    telemetry.setMeta(response, { written: result.written, keys: result.keys });
    response.status(200).json({
      ok: true,
      ...result,
      entries: snapshot.entries,
      tombstones: snapshot.tombstones,
      updatedAt: snapshot.updatedAt,
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      ok: false,
      message: error.message || "进度同步失败，请稍后重试。",
    });
  }
}

module.exports = telemetry.wrap("progress", handler);
