/**
 * 会话探测：区分「自建服务器上有账号接口」和「GitHub 静态镜像」两种形态。
 *
 * - server：服务器返回了会话信息，按 authenticated 决定是否放行；
 * - local：接口不存在或不可达（静态镜像、后端重启中），页面仍可浏览，
 *   学习进度走 localStorage，这样搬瓦工机器挂掉时 GitHub 备份还能用。
 */
(function () {
  const ENDPOINT = "./api/auth";
  const TIMEOUT_MS = 6000;
  const LOCAL_MODE_STATUSES = new Set([404, 405, 501, 502, 503, 504]);

  let cached = null;
  let inflight = null;

  async function request() {
    const controller =
      typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(ENDPOINT, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined,
      });
      const data = await response.json().catch(() => ({}));

      if (LOCAL_MODE_STATUSES.has(response.status)) {
        return {
          mode: "local",
          reason: data.message || "当前访问的是静态备份，未连接账号服务。",
        };
      }

      return {
        mode: "server",
        authenticated: Boolean(data.authenticated),
        user: data.user || "",
        registration: data.registration || {
          enabled: false,
          inviteRequired: false,
        },
      };
    } catch {
      return {
        mode: "local",
        reason: "无法连接账号服务，已切换到本地进度模式。",
      };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function probe(options = {}) {
    if (cached && !options.force) {
      return cached;
    }
    if (inflight && !options.force) {
      return inflight;
    }

    inflight = request().then((result) => {
      cached = result;
      inflight = null;
      return result;
    });
    return inflight;
  }

  window.iballSession = {
    probe,
    reset() {
      cached = null;
      inflight = null;
    },
  };
})();
