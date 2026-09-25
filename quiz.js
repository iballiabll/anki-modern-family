/**
 * 单词测试页。
 *
 * 出题、判卷都在服务端完成：这里只拿到题面，答案由服务端保存，
 * 交卷后服务端返回分数、错词和该账号的最好成绩。
 */
(function () {
  "use strict";

  const SCOPE_META = {
    cet4: { label: "四级", description: "四级核心词" },
    kaoyan: { label: "考研", description: "考研英语词表" },
    all: { label: "所有单词", description: "基础 + 四级 + 六级 + 考研" },
    total: {
      label: "总榜单",
      description: "已完成范围的平均正确率，考过一个就能上榜",
    },
  };

  const state = {
    username: "",
    admin: false,
    tab: "cet4",
    pools: {},
    defaultSize: 20,
    bests: {},
    total: null,
    totalCompleted: 0,
    totalRanges: 3,
    lastScope: "",
    session: null,
    answers: [],
    index: 0,
    boardScope: "total",
    submitting: false,
    boardLoading: false,
  };

  const elements = {};

  function $(id) {
    return document.getElementById(id);
  }

  function collectElements() {
    [
      "accountChip",
      "gate",
      "quizBody",
      "poolStats",
      "startPanel",
      "startTitle",
      "startSubtitle",
      "quizSize",
      "quizDirection",
      "startQuizButton",
      "bestSummary",
      "startMessage",
      "questionPanel",
      "questionCounter",
      "questionScore",
      "questionProgressBar",
      "questionPrompt",
      "questionPhonetic",
      "questionOptions",
      "questionPrev",
      "questionNext",
      "questionSubmit",
      "questionMessage",
      "resultPanel",
      "resultRing",
      "resultPercent",
      "resultTitle",
      "resultSubtitle",
      "wrongList",
      "retryButton",
      "resultBoardButton",
      "backToStartButton",
      "boardPanel",
      "boardSubtitle",
      "boardMessage",
      "boardMe",
      "boardList",
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

  function setMessage(element, message) {
    if (!element) {
      return;
    }
    element.textContent = message || "";
    element.hidden = !message;
  }

  function showGate() {
    if (elements.gate) {
      elements.gate.hidden = false;
    }
    if (elements.quizBody) {
      elements.quizBody.hidden = true;
    }
  }

  function showBody() {
    if (elements.gate) {
      elements.gate.hidden = true;
    }
    if (elements.quizBody) {
      elements.quizBody.hidden = false;
    }
  }

  /**
   * 总榜平均分。接口里叫 totalScore（新）或 total（旧字段），
   * 考过任意一个范围就会出现数字，否则返回 null。
   */
  function toTotalScore(data) {
    const raw = data?.totalScore !== undefined ? data.totalScore : data?.total;
    if (raw === null || raw === undefined || raw === "") {
      return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function toTotalCompleted(data) {
    const value = Number(data?.totalCompleted);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function toTotalRanges(data) {
    const value = Number(data?.totalRanges);
    return Number.isFinite(value) && value > 0 ? value : 3;
  }

  /** 总榜里没考过的范围要到的是 null，不能当成 0 分显示。 */
  function formatBoardPart(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    const num = Number(value);
    return Number.isFinite(num) ? `${num}%` : "—";
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      return "";
    }
    return new Date(parsed).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderPoolStats() {
    const rows = ["cet4", "kaoyan", "all"]
      .filter((scope) => Number(state.pools[scope]) > 0)
      .map(
        (scope) =>
          `<div><dt>${SCOPE_META[scope].label}</dt><dd>${Number(
            state.pools[scope],
          ).toLocaleString("zh-CN")}</dd></div>`,
      );
    elements.poolStats.innerHTML = rows.join("");
  }

  function renderTabs() {
    document.querySelectorAll(".quiz-tab").forEach((button) => {
      const active = button.dataset.scope === state.tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  function renderBoardTabs() {
    document.querySelectorAll(".quiz-board-tab").forEach((button) => {
      const active = button.dataset.boardScope === state.boardScope;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  function boardScopeLabel(scope) {
    return scope === "total" ? "总榜" : `${SCOPE_META[scope].label}榜`;
  }

  function setActivePanel(name) {
    elements.startPanel.hidden = name !== "start";
    elements.questionPanel.hidden = name !== "question";
    elements.resultPanel.hidden = name !== "result";
    elements.boardPanel.hidden = name !== "board";
  }

  function renderBestSummary() {
    const scope = state.tab;
    const best = state.bests[scope];
    if (!best) {
      elements.bestSummary.hidden = true;
      elements.bestSummary.innerHTML = "";
      return;
    }
    const totalHint =
      Number.isFinite(state.total)
        ? `　总榜综合：<strong>${state.total}%</strong>（已考 ${state.totalCompleted}/${state.totalRanges}）`
        : "";
    elements.bestSummary.innerHTML = `本范围最好成绩：<strong>${best.score}/${best.total}（${best.percent}%）</strong>　${formatDate(best.at)}${totalHint}`;
    elements.bestSummary.hidden = false;
  }

  function renderStartPanel() {
    const meta = SCOPE_META[state.tab];
    elements.startTitle.textContent = `${meta.label}测试`;
    elements.startSubtitle.textContent = `服务端出题，判卷只看服务端答案；范围：${meta.description}`;
    setMessage(elements.startMessage, "");
    renderBestSummary();
  }

  async function loadOverview() {
    const data = await requestJson("./api/quiz");
    state.pools = data.pools || {};
    state.defaultSize = Number(data.defaultSize) || 20;
    state.bests = data.bests || {};
    state.total = toTotalScore(data);
    state.totalCompleted = toTotalCompleted(data);
    state.totalRanges = toTotalRanges(data);
    if (state.defaultSize === 20) {
      elements.quizSize.value = "20";
    }
    renderPoolStats();
    renderStartPanel();
  }

  async function refreshLeaderboard() {
    if (state.boardLoading) {
      return;
    }
    state.boardLoading = true;
    const scope = state.boardScope;
    elements.boardSubtitle.textContent = `${boardScopeLabel(scope)} · 正在读取`;
    setMessage(elements.boardMessage, "");
    try {
      const data = await requestJson(
        `./api/leaderboard?scope=${encodeURIComponent(scope)}`,
      );
      elements.boardSubtitle.textContent = `${boardScopeLabel(
        scope,
      )} · 共 ${data.players || 0} 人上榜`;

      if (data.me) {
        const meProgress = data.me.parts
          ? `　已考 ${data.me.completed || 0}/${data.me.totalRanges || 3}`
          : "";
        elements.boardMe.innerHTML = `我的排名：第 <strong>${data.me.rank}</strong> 名　${data.me.percent}%（${data.me.score}/${data.me.total}）${meProgress}`;
        elements.boardMe.hidden = false;
      } else {
        elements.boardMe.hidden = true;
        elements.boardMe.innerHTML = "";
      }

      if (!data.top || data.top.length === 0) {
        elements.boardList.innerHTML =
          '<li class="quiz-board-row"><span class="quiz-board-rank">—</span><span class="quiz-board-name">还没有人上这个榜，考一套就能占住第一。</span><span></span></li>';
        return;
      }

      const meName = state.username;
      elements.boardList.innerHTML = data.top
        .map((row) => {
          const isMe = row.username === meName;
          const parts = row.parts
            ? `已考 ${row.completed || 0}/${row.totalRanges || 3} · 四级 ${formatBoardPart(
                row.parts.cet4,
              )} · 考研 ${formatBoardPart(row.parts.kaoyan)} · 全部 ${formatBoardPart(
                row.parts.all,
              )}`
            : formatDate(row.at);
          return `<li class="quiz-board-row${isMe ? " is-me" : ""}">
            <span class="quiz-board-rank">${row.rank}</span>
            <span class="quiz-board-name">${escapeHtml(row.username)}${
              isMe ? "（我）" : ""
            }<span class="quiz-board-meta">${escapeHtml(parts)}</span></span>
            <span class="quiz-board-score">${row.percent}%<span class="quiz-board-meta">${row.score}/${row.total}</span></span>
          </li>`;
        })
        .join("");
    } catch (error) {
      elements.boardList.innerHTML = "";
      setMessage(
        elements.boardMessage,
        error?.message || "榜单暂时不可用。",
      );
    } finally {
      state.boardLoading = false;
    }
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

  function renderQuestion() {
    const question = state.session?.questions?.[state.index];
    if (!question) {
      return;
    }
    const total = state.session.questions.length;
    elements.questionCounter.textContent = `第 ${state.index + 1} / ${total} 题`;
    const answered = state.answers.filter(
      (value) => Number.isInteger(value) && value >= 0,
    ).length;
    elements.questionScore.textContent = `已作答 ${answered}`;
    elements.questionProgressBar.style.width = `${
      ((state.index + 1) / total) * 100
    }%`;

    elements.questionPrompt.textContent = question.prompt;
    elements.questionPhonetic.textContent = question.phonetic || "";
    elements.questionPhonetic.hidden = !question.phonetic;

    const selected = state.answers[state.index];
    elements.questionOptions.innerHTML = question.options
      .map((option, optionIndex) => {
        const isSelected = selected === optionIndex;
        return `<button class="quiz-option${
          isSelected ? " is-selected" : ""
        }" type="button" data-option="${optionIndex}">
          <span class="quiz-option-marker">${String.fromCharCode(
            65 + optionIndex,
          )}</span>
          <span>${escapeHtml(option)}</span>
        </button>`;
      })
      .join("");

    elements.questionPrev.disabled = state.index === 0;
    const isLast = state.index === total - 1;
    elements.questionNext.hidden = isLast;
    elements.questionSubmit.hidden = !isLast;
    setMessage(elements.questionMessage, "");
  }

  function selectOption(optionIndex) {
    state.answers[state.index] = optionIndex;
    renderQuestion();
  }

  function goToQuestion(index) {
    if (index < 0 || index >= (state.session?.questions?.length || 0)) {
      return;
    }
    state.index = index;
    renderQuestion();
  }

  async function startQuiz() {
    elements.startQuizButton.disabled = true;
    elements.startQuizButton.textContent = "正在出题…";
    setMessage(elements.startMessage, "");
    try {
      const data = await requestJson("./api/quiz", {
        method: "POST",
        body: JSON.stringify({
          action: "start",
          scope: state.tab,
          size: Number(elements.quizSize.value) || state.defaultSize,
          direction: elements.quizDirection.value,
        }),
      });
      state.session = data;
      state.answers = new Array(data.questions.length).fill(-1);
      state.index = 0;
      setActivePanel("question");
      renderQuestion();
    } catch (error) {
      if (error.status === 404) {
        setMessage(
          elements.startMessage,
          "当前访问的是静态备份，没有账号服务，测试暂时不可用。",
        );
      } else {
        setMessage(
          elements.startMessage,
          error?.message || "出题失败，请稍后重试。",
        );
      }
    } finally {
      elements.startQuizButton.disabled = false;
      elements.startQuizButton.textContent = "开始测试";
    }
  }

  async function submitQuiz() {
    if (state.submitting || !state.session) {
      return;
    }
    const unanswered = state.answers.filter(
      (value) => !Number.isInteger(value) || value < 0,
    ).length;
    if (unanswered > 0) {
      setMessage(
        elements.questionMessage,
        `还有 ${unanswered} 题没有作答，补完再交卷。`,
      );
      const firstUnanswered = state.answers.findIndex(
        (value) => !Number.isInteger(value) || value < 0,
      );
      goToQuestion(firstUnanswered);
      return;
    }

    state.submitting = true;
    elements.questionSubmit.disabled = true;
    elements.questionSubmit.textContent = "判卷中…";
    setMessage(elements.questionMessage, "");

    try {
      const data = await requestJson("./api/quiz", {
        method: "POST",
        body: JSON.stringify({
          action: "submit",
          sessionId: state.session.sessionId,
          answers: state.answers,
        }),
      });
      state.bests = data.bests || state.bests;
      state.total = toTotalScore(data);
      state.totalCompleted = toTotalCompleted(data);
      state.totalRanges = toTotalRanges(data);
      renderResult(data);
      setActivePanel("result");
    } catch (error) {
      setMessage(
        elements.questionMessage,
        error?.message || "交卷失败，请重新打开一套题。",
      );
    } finally {
      state.submitting = false;
      elements.questionSubmit.disabled = false;
      elements.questionSubmit.textContent = "交卷";
    }
  }

  function renderResult(data) {
    state.lastScope = data.scope || state.tab;
    elements.resultPercent.textContent = `${data.percent}%`;
    elements.resultRing.style.borderColor =
      data.percent >= 80 ? "#2f6d57" : data.percent >= 60 ? "#b8860b" : "#b4533c";
    elements.resultTitle.textContent = data.improved
      ? "刷新了本范围最好成绩"
      : "测试完成";

    const wrongCount = data.wrong?.length || 0;
    elements.resultSubtitle.textContent = `答对 ${data.score} / ${data.total} 题，错 ${wrongCount} 题。错词已经并入你的云端错词表。${
      data.improved ? "" : "本次没有超过历史最好成绩，榜单保持原纪录。"
    }`;

    if (wrongCount === 0) {
      elements.wrongList.innerHTML =
        '<div class="quiz-wrong-item"><strong>全对</strong><span>这一套没有错词，换更高的题量继续挑战。</span></div>';
      return;
    }
    elements.wrongList.innerHTML = data.wrong
      .slice(0, 60)
      .map(
        (item) =>
          `<div class="quiz-wrong-item"><strong>${escapeHtml(
            item.word,
          )}</strong><span>${escapeHtml(item.meaning)}</span></div>`,
      )
      .join("");
  }

  function backToStart() {
    state.session = null;
    state.answers = [];
    state.index = 0;
    setActivePanel("start");
    renderStartPanel();
  }

  function switchTab(scope) {
    if (!SCOPE_META[scope] || scope === state.tab) {
      return;
    }
    state.tab = scope;
    state.session = null;
    renderTabs();
    if (scope === "total") {
      setActivePanel("board");
      refreshLeaderboard();
      return;
    }
    setActivePanel("start");
    renderStartPanel();
  }

  function openBoard(scope) {
    state.boardScope = SCOPE_META[scope] ? scope : "total";
    state.tab = "total";
    renderTabs();
    renderBoardTabs();
    setActivePanel("board");
    refreshLeaderboard();
  }

  function bindEvents() {
    document.querySelectorAll(".quiz-tab").forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.scope));
    });
    document.querySelectorAll(".quiz-board-tab").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.boardScope === state.boardScope) {
          return;
        }
        state.boardScope = button.dataset.boardScope;
        renderBoardTabs();
        refreshLeaderboard();
      });
    });
    elements.startQuizButton.addEventListener("click", startQuiz);
    elements.questionOptions.addEventListener("click", (event) => {
      const option = event.target.closest("[data-option]");
      if (option) {
        selectOption(Number(option.dataset.option));
      }
    });
    elements.questionPrev.addEventListener("click", () =>
      goToQuestion(state.index - 1),
    );
    elements.questionNext.addEventListener("click", () =>
      goToQuestion(state.index + 1),
    );
    elements.questionSubmit.addEventListener("click", submitQuiz);
    elements.retryButton.addEventListener("click", startQuiz);
    elements.resultBoardButton.addEventListener("click", () =>
      openBoard(state.lastScope || state.tab),
    );
    elements.backToStartButton.addEventListener("click", backToStart);
  }

  async function init() {
    collectElements();
    bindEvents();
    renderTabs();
    renderBoardTabs();

    const session = window.iballSession
      ? await window.iballSession.probe()
      : null;

    if (!session || session.mode !== "server" || !session.authenticated) {
      showGate();
      return;
    }

    state.username = session.user || "用户";
    state.admin = Boolean(session.admin);
    if (window.iballAccounts) {
      window.iballAccounts.activate(session.account?.id || "");
    }
    elements.accountChip.textContent = state.username;
    elements.accountChip.hidden = false;
    showBody();

    try {
      await loadOverview();
    } catch (error) {
      setMessage(
        elements.startMessage,
        error?.message || "测试服务暂时不可用。",
      );
    }
  }

  init().catch((error) => {
    console.error(error);
    showGate();
  });
})();
