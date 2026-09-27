/**
 * 数据备份接口（只有管理员账号可用）。
 *
 *   GET  ?                   备份状态（只含元数据）
 *   POST { action: "backup" } 触发一次备份，立刻返回，前端轮询状态
 *
 * 对外只暴露：是否配置、仓库/分支、上次备份时间、文件数、字节数、提交链接。
 * 不返回任何数据正文、口令散列、GitHub token 或 Blob 哈希。
 */

const {
  clientIp,
  isAdminUser,
  readJsonBody,
  resolveSessionUser,
} = require("./_session.js");
const telemetryStore = require("./_telemetry.js");

// 模块级单飞：同一进程里同一时间只允许一次备份。
let runningBackup = null;

function loadBackupModule() {
  return import("../scripts/backup-data.mjs");
}

/** 二次白名单，确保任何实现改动都不会把额外字段漏给前端。 */
function publicBackup(payload, running) {
  const source = payload && typeof payload === "object" ? payload : {};
  const status =
    source.status && typeof source.status === "object" ? source.status : source;
  return {
    configured: Boolean(source.configured),
    running: Boolean(running),
    repo: String(source.repo || ""),
    branch: String(source.branch || ""),
    status: {
      lastStatus: String(status.lastStatus || "never"),
      lastRunAt: String(status.lastRunAt || ""),
      startedAt: String(status.startedAt || ""),
      durationMs: Number(status.durationMs) || 0,
      trigger: String(status.trigger || ""),
      snapshot: String(status.snapshot || ""),
      fileCount: Number(status.fileCount) || 0,
      bytes: Number(status.bytes) || 0,
      commitSha: String(status.commitSha || ""),
      commitUrl: String(status.commitUrl || ""),
      message: String(status.message || ""),
    },
  };
}

/**
 * 后台跑一次备份并把结果写进状态文件。失败不抛出，状态文件里会有原因，
 * 前端轮询 GET 就能看到。
 */
function startBackup(trigger) {
  if (runningBackup) {
    return false;
  }
  const task = (async () => {
    const { runBackup } = await loadBackupModule();
    return runBackup({ trigger });
  })();
  runningBackup = task;
  task
    .catch((error) => {
      // runBackup 自己会把失败原因写进状态文件；这里只兜底日志，避免未处理拒绝。
      console.error("[backup] 备份任务异常：", error?.message || error);
    })
    .finally(() => {
      if (runningBackup === task) {
        runningBackup = null;
      }
    });
  return true;
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
      const { readBackupStatus } = await loadBackupModule();
      const payload = await readBackupStatus();
      response.status(200).json({
        ok: true,
        backup: publicBackup(payload, Boolean(runningBackup)),
      });
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, message: "不支持的请求方式" });
      return;
    }

    const body = await readJsonBody(request);
    if (body.action !== "backup") {
      response.status(400).json({ ok: false, message: "无效的操作" });
      return;
    }

    const { readBackupStatus } = await loadBackupModule();
    const current = await readBackupStatus();
    if (!current.configured) {
      response.status(409).json({
        ok: false,
        message:
          "服务器没有配置 GITHUB_BACKUP_TOKEN，无法备份。请先在部署环境变量里配置后再试。",
      });
      return;
    }

    if (!startBackup("manual")) {
      response.status(409).json({
        ok: false,
        message: "已经有一次备份在进行中，请等它结束。",
      });
      return;
    }

    telemetryStore.setMeta(response, { backupStarted: true });
    response.status(202).json({
      ok: true,
      started: true,
      message: "备份已开始，完成后这里会自动刷新。",
      backup: publicBackup(current, true),
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error?.message || "备份服务暂时不可用。",
    });
  }
}

module.exports = telemetryStore.wrap("backup", handler);
