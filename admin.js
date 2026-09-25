/**
 * 站长控制台。
 *
 * 只跟 ./api/admin 打交道，服务端会再验一次管理员身份：
 *   · 概览（账号、数据规模、邀请码、找回申请）用「刷新」按需拉取；
 *   · 在线情况与请求流每 15 秒轮询一次，标签页切到后台就暂停。
 *
 * 这里刻意只展示统计和路径，不展示任何密码、API Key 或用户正文。
 */
(function () {
  "use strict";

  const POLL_MS = 15000;

  const state = {
    loading: false,
    pollTimer: null,
    tokens: new Map(),
    resets: [],
    users: [],
    stats: { accounts: 0, scored: 0, playsToday: 0, active: 0 },
  };

  const elements = {};

  function $(id) {
    return document.getElementById(id);
  }

  function collectElements() {
    [
      "liveState",
      "refreshButton",
      "adminGate",
      "gateTitle",
      "gateCopy",
      "adminBody",
      "adminUpdated",
      "storageBadge",
      "statCards",
      "inviteInput",
      "inviteSave",
      "inviteGenerate",
      "inviteClear",
      "inviteStatus",
      "inviteMessage",
      "endpointList",
      "activityBody",
      "userBody",
      "resetBody",
      "resetMessage",
      "requestList",
    ].forEach((id) => {
      elements[id] = $(id);
    });
  }

  async function requestJson(url, options) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: {
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
        ...(options?.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error(data.message || `请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        default:
          return "&#39;";
      }
    });
  }

  function formatDateTime(value) {
    const parsed = Date.parse(value || "");
    if (!Number.isFinite(parsed)) {
      return "—";
    }
    return new Date(parsed).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatClock(value) {
    const parsed = Date.parse(value || "");
    if (!Number.isFinite(parsed)) {
      return "—";
    }
    return new Date(parsed).toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function clockFromMs(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) {
      return "—";
    }
    return formatClock(new Date(ms).toISOString());
  }

  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }

  function setMessage(element, message, tone = "") {
    if (!element) {
      return;
    }
    element.textContent = message || "";
    element.hidden = !message;
    if (tone) {
      element.dataset.tone = tone;
    } else {
      delete element.dataset.tone;
    }
  }

  function setLiveState(status, text) {
    if (!elements.liveState) {
      return;
    }
    elements.liveState.dataset.state = status;
    elements.liveState.textContent = text;
  }

  function showGate(title, copy) {
    elements.gateTitle.textContent = title;
    elements.gateCopy.textContent = copy;
    elements.adminGate.hidden = false;
    elements.adminBody.hidden = true;
    setLiveState("error", "未连接");
  }

  function showBody() {
    elements.adminGate.hidden = true;
    elements.adminBody.hidden = false;
  }

  function statCard(label, value, hint, tone) {
    return `<article class="admin-stat"${tone ? ` data-tone="${tone}"` : ""}>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ""}
    </article>`;
  }

  function renderStats(monitor) {
    const online = Number(monitor?.online) || 0;
    const calls = Number(monitor?.callsLastHour) || 0;
    const errors = Number(monitor?.errorsLastHour) || 0;
    const avg = Number(monitor?.avgMsLastHour) || 0;
    const { accounts, scored, playsToday, active } = state.stats;

    elements.statCards.innerHTML = [
      statCard("当前在线", `${online} 人`, "3 分钟内有心跳", "gold"),
      statCard("近一小时调用", `${calls} 次`, "含所有接口", "blue"),
      statCard(
        "近一小时错误",
        `${errors} 次`,
        errors === 0 ? "没有报错" : "看下面的请求流",
        errors > 0 ? "coral" : "",
      ),
      statCard("平均耗时", `${avg} ms`, "近一小时接口平均", ""),
      statCard("注册账号", `${accounts} 个`, "含管理员", ""),
      statCard("有成绩账号", `${scored} 个`, "至少考过一次", "blue"),
      statCard("今日测试", `${playsToday} 次`, "当天最好成绩条数", "gold"),
      statCard("进行中的试卷", `${active} 份`, "还没交卷", ""),
    ].join("");
  }

  function renderStorage(storage) {
    const badge = elements.storageBadge;
    if (!storage) {
      badge.textContent = "存储状态未知";
      badge.dataset.tone = "warn";
      return;
    }
    if (storage.ready) {
      badge.textContent = `数据目录可写 · ${state.stats.accounts} 个账号`;
      delete badge.dataset.tone;
      return;
    }
    badge.textContent = `数据目录不可写：${storage.message || "请检查权限"}`;
    badge.dataset.tone = "error";
  }

  function renderInvite(invite) {
    const code = String(invite?.code || "");
    if (document.activeElement !== elements.inviteInput) {
      elements.inviteInput.value = code;
    }
    if (code) {
      elements.inviteStatus.textContent = `已启用，注册需要邀请码${
        invite?.updatedAt ? `（${formatDateTime(invite.updatedAt)} 更新）` : ""
      }。`;
    } else if (invite?.envFallback) {
      const effective = String(invite?.effectiveCode || "");
      elements.inviteStatus.textContent = effective
        ? `当前用的是服务器环境变量 REGISTRATION_CODE：${effective}（在下面保存一个新邀请码即可覆盖）。`
        : "当前用的是服务器环境变量 REGISTRATION_CODE；在下面保存一个新邀请码即可覆盖。";
    } else {
      elements.inviteStatus.textContent = "未启用：任何人都可以注册。";
    }
  }

  function renderEndpoints(endpoints) {
    const rows = Array.isArray(endpoints) ? endpoints : [];
    if (rows.length === 0) {
      elements.endpointList.innerHTML =
        '<p class="admin-note">最近一小时还没有接口调用。</p>';
      return;
    }
    elements.endpointList.innerHTML = rows
      .map(
        (row) => `<div class="admin-endpoint">
          <span class="admin-endpoint-name">${escapeHtml(row.name)}</span>
          <span class="admin-endpoint-count">${Number(row.count) || 0} 次</span>
        </div>`,
      )
      .join("");
  }

  function renderActivity(activity) {
    const rows = Array.isArray(activity) ? activity : [];
    if (rows.length === 0) {
      elements.activityBody.innerHTML =
        '<tr class="admin-empty-row"><td colspan="5">还没有页面心跳。学生打开任意页面后会出现在这里。</td></tr>';
      return;
    }
    elements.activityBody.innerHTML = rows
      .map((row) => {
        const online = row.online;
        return `<tr>
          <td><span class="admin-account">${escapeHtml(row.username || row.userId)}</span></td>
          <td><span class="admin-pill" data-tone="${online ? "live" : "muted"}">${
            online ? "在线" : "离线"
          }</span></td>
          <td>${escapeHtml(row.title || "—")}<span class="admin-sub">${escapeHtml(
            row.page || "",
          )}</span></td>
          <td>${Number(row.beats) || 0} 次</td>
          <td>${escapeHtml(String(row.minutesAgo ?? 0))} 分钟前<span class="admin-sub">${formatDateTime(
            row.lastSeenAt,
          )}</span></td>
        </tr>`;
      })
      .join("");
  }

  function renderUsers(users) {
    state.users = Array.isArray(users) ? users : [];
    if (state.users.length === 0) {
      elements.userBody.innerHTML =
        '<tr class="admin-empty-row"><td colspan="7">还没有注册账号。</td></tr>';
      return;
    }
    elements.userBody.innerHTML = state.users
      .map((user) => {
        const token = state.tokens.get(user.id);
        const tokenCell = token
          ? `<div class="admin-token"><code>${escapeHtml(token.token)}</code><span class="admin-sub">有效期至 ${formatDateTime(
              token.expiresAt,
            )}</span></div>`
          : '<span class="admin-sub">未生成</span>';
        return `<tr>
          <td><span class="admin-account">${escapeHtml(user.username)}</span>${
            user.online
              ? '<span class="admin-pill" data-tone="live">在线</span>'
              : ""
          }<span class="admin-sub">最近登录 ${formatDateTime(user.lastLoginAt)}</span></td>
          <td>${escapeHtml(user.email || "—")}</td>
          <td>${formatDateTime(user.createdAt)}</td>
          <td>${Number(user.keys) || 0} 条 · ${formatBytes(user.bytes)}</td>
          <td>${Number(user.wrongWords) || 0} 条</td>
          <td>${Number(user.bests?.cet4) || 0}% / ${Number(user.bests?.kaoyan) || 0}% / ${
            Number(user.bests?.all) || 0
          }%<span class="admin-sub">${
            user.total === null || user.total === undefined
              ? "总榜未集齐"
              : `总榜 ${user.total}%`
          }</span></td>
          <td><div class="admin-row-actions">
            <button class="admin-mini" type="button" data-reset-token="${escapeHtml(
              user.id,
            )}">生成重置码</button>
          </div>${tokenCell}</td>
        </tr>`;
      })
      .join("");
  }

  function renderResets(resets) {
    state.resets = Array.isArray(resets) ? resets : [];
    if (state.resets.length === 0) {
      elements.resetBody.innerHTML =
        '<tr class="admin-empty-row"><td colspan="5">没有待处理的找回申请。</td></tr>';
      return;
    }
    elements.resetBody.innerHTML = state.resets
      .map((item) => {
        const token = state.tokens.get(item.userId);
        const handled = Boolean(item.handledAt);
        const tokenCell = token
          ? `<div class="admin-token"><code>${escapeHtml(token.token)}</code><span class="admin-sub">有效期至 ${formatDateTime(
              token.expiresAt,
            )}</span></div>`
          : '<span class="admin-sub">未生成</span>';
        return `<tr>
          <td><span class="admin-account">${escapeHtml(item.username || item.userId)}</span></td>
          <td>${formatDateTime(item.createdAt)}</td>
          <td><span class="admin-pill" data-tone="${handled ? "muted" : "warn"}">${
            handled ? `已处理 ${formatDateTime(item.handledAt)}` : "待处理"
          }</span></td>
          <td>${tokenCell}</td>
          <td><div class="admin-row-actions">
            <button class="admin-mini" type="button" data-reset-token="${escapeHtml(
              item.userId,
            )}">生成重置码</button>
            <button class="admin-mini" type="button" data-handle-reset="${escapeHtml(
              item.id,
            )}"${handled ? " disabled" : ""}>标记已处理</button>
          </div></td>
        </tr>`;
      })
      .join("");
  }

  function renderRequests(recent) {
    const rows = Array.isArray(recent) ? recent : [];
    if (rows.length === 0) {
      elements.requestList.innerHTML =
        '<li class="admin-note">还没有请求记录。</li>';
      return;
    }
    elements.requestList.innerHTML = rows
      .map((event) => {
        const failed = Number(event.status) >= 400;
        const meta = event.meta && Object.keys(event.meta).length
          ? ` · ${Object.entries(event.meta)
              .map(([key, value]) => `${key}=${value}`)
              .join(" ")}`
          : "";
        return `<li class="admin-request" data-status="${failed ? "error" : "ok"}">
          <span class="admin-request-time">${clockFromMs(event.at)}</span>
          <span class="admin-request-name" title="${escapeHtml(
            event.method || "GET",
          )} /api/${escapeHtml(event.name || "")}">${escapeHtml(event.name || "api")}</span>
          <span class="admin-request-user">${escapeHtml(event.user || "未登录")}</span>
          <span class="admin-request-status">${Number(event.status) || 200}</span>
          <span class="admin-request-ms" title="${escapeHtml(meta)}">${Number(
            event.ms,
          ) || 0} ms</span>
        </li>`;
      })
      .join("");
  }

  async function loadOverview({ silent = false } = {}) {
    if (state.loading) {
      return;
    }
    state.loading = true;
    if (!silent) {
      elements.refreshButton.disabled = true;
      setLiveState("idle", "刷新中…");
    }
    try {
      const data = await requestJson("./api/admin");
      showBody();
      elements.adminUpdated.textContent = `服务器时间 ${formatDateTime(
        data.serverTime,
      )} · 上次落盘 ${
        data.monitor?.updatedAt ? formatDateTime(data.monitor.updatedAt) : "—"
      }`;
      state.stats = {
        accounts: Array.isArray(data.users) ? data.users.length : 0,
        scored: Number(data.quiz?.withScore) || 0,
        playsToday: Number(data.quiz?.playsToday) || 0,
        active: Number(data.quiz?.activeSessions) || 0,
      };
      renderStorage(data.storage);
      renderStats(data.monitor);
      renderInvite(data.invite);
      renderEndpoints(data.monitor?.endpoints);
      renderActivity(data.monitor?.activity);
      renderUsers(data.users);
      renderResets(data.resets);
      setLiveState("live", `实时同步中 · ${formatClock(data.serverTime)}`);
    } catch (error) {
      if (error.status === 403 || error.status === 401) {
        showGate(
          "当前账号不是管理员",
          "只有站长账号能看这个页面。请用管理员账号登录后回来刷新。",
        );
        return;
      }
      setLiveState("error", error?.message || "读取失败");
      setMessage(elements.resetMessage, error?.message || "读取失败", "error");
    } finally {
      state.loading = false;
      elements.refreshButton.disabled = false;
    }
  }

  async function pollActivity() {
    if (document.hidden || state.loading) {
      return;
    }
    try {
      const data = await requestJson("./api/admin?action=activity");
      const monitor = data.monitor || {};
      renderStats(monitor);
      renderEndpoints(monitor.endpoints);
      renderActivity(monitor.activity);
      renderRequests(data.recent);
      setLiveState("live", `实时同步中 · ${formatClock(new Date().toISOString())}`);
    } catch (error) {
      if (error.status === 403 || error.status === 401) {
        showGate(
          "当前账号不是管理员",
          "登录状态可能已过期，请重新用管理员账号登录。",
        );
        stopPolling();
        return;
      }
      setLiveState("stale", error?.message || "同步中断");
    }
  }

  async function saveInvite(code) {
    elements.inviteSave.disabled = true;
    elements.inviteGenerate.disabled = true;
    elements.inviteClear.disabled = true;
    setMessage(elements.inviteMessage, "");
    try {
      const data = await requestJson("./api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "invite-code", code }),
      });
      renderInvite(data.invite);
      if (data.invite?.code) {
        setMessage(
          elements.inviteMessage,
          `已保存，把邀请码发给学生：${data.invite.code}`,
        );
      } else {
        setMessage(elements.inviteMessage, "已关闭邀请码，现在任何人都能注册。", "warn");
      }
    } catch (error) {
      setMessage(elements.inviteMessage, error?.message || "保存失败", "error");
    } finally {
      elements.inviteSave.disabled = false;
      elements.inviteGenerate.disabled = false;
      elements.inviteClear.disabled = false;
    }
  }

  async function generateInvite() {
    elements.inviteGenerate.disabled = true;
    setMessage(elements.inviteMessage, "");
    try {
      const data = await requestJson("./api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "invite-generate", prefix: "CABIN" }),
      });
      if (data.invite?.code) {
        elements.inviteInput.value = data.invite.code;
      }
      renderInvite(data.invite);
      setMessage(
        elements.inviteMessage,
        `新邀请码已生效：${data.invite?.code || ""}`,
      );
    } catch (error) {
      setMessage(elements.inviteMessage, error?.message || "生成失败", "error");
    } finally {
      elements.inviteGenerate.disabled = false;
    }
  }

  async function issueResetToken(userId) {
    setMessage(elements.resetMessage, "");
    try {
      const data = await requestJson("./api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "reset-token", userId, ttlMinutes: 60 }),
      });
      state.tokens.set(userId, {
        token: data.token,
        expiresAt: data.expiresAt,
      });
      renderUsers(state.users);
      renderResets(state.resets);
      setMessage(
        elements.resetMessage,
        `${data.username || "该账号"} 的重置码：${data.token}（有效期至 ${formatDateTime(
          data.expiresAt,
        )}，只能用来改一次密码）`,
      );
    } catch (error) {
      setMessage(elements.resetMessage, error?.message || "生成失败", "error");
    }
  }

  async function handleReset(requestId) {
    setMessage(elements.resetMessage, "");
    try {
      await requestJson("./api/admin", {
        method: "POST",
        body: JSON.stringify({ action: "handle-reset", requestId }),
      });
      setMessage(elements.resetMessage, "已标记为处理完成。");
      await loadOverview({ silent: true });
    } catch (error) {
      setMessage(elements.resetMessage, error?.message || "操作失败", "error");
    }
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => {
      pollActivity();
    }, POLL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function bindEvents() {
    elements.refreshButton.addEventListener("click", () => {
      loadOverview();
      pollActivity();
    });

    elements.inviteSave.addEventListener("click", () => {
      saveInvite(elements.inviteInput.value.trim());
    });
    elements.inviteGenerate.addEventListener("click", generateInvite);
    elements.inviteClear.addEventListener("click", () => {
      elements.inviteInput.value = "";
      saveInvite("");
    });

    for (const body of [elements.userBody, elements.resetBody]) {
      body.addEventListener("click", (event) => {
        const tokenButton = event.target.closest("[data-reset-token]");
        if (tokenButton) {
          issueResetToken(tokenButton.dataset.resetToken);
          return;
        }
        const handleButton = event.target.closest("[data-handle-reset]");
        if (handleButton) {
          handleReset(handleButton.dataset.handleReset);
        }
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        pollActivity();
      }
    });
  }

  async function init() {
    collectElements();
    bindEvents();

    const session = window.iballSession
      ? await window.iballSession.probe()
      : null;

    if (!session || session.mode !== "server") {
      showGate(
        "当前访问的是静态备份",
        "GitHub 备份页没有账号服务，控制台只能在自建服务器上打开。",
      );
      return;
    }
    if (!session.authenticated) {
      showGate(
        "需要登录",
        "请先用管理员账号登录，再回到这一页。",
      );
      return;
    }
    if (!session.admin) {
      showGate(
        "当前账号不是管理员",
        "这个页面只对站长账号开放。",
      );
      return;
    }

    if (window.iballAccounts) {
      window.iballAccounts.activate(session.account?.id || "");
    }

    showBody();
    await loadOverview();
    await pollActivity();
    startPolling();
  }

  init().catch((error) => {
    console.error(error);
    if (elements.adminGate) {
      showGate("控制台加载失败", error?.message || "请稍后重试。");
    }
  });
})();
