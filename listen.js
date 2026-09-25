/**
 * 听句精听页面。
 *
 * 素材两种来源：
 *   movie —— study-data/<集数>.json，逐句时间轴指回整集精灵音频，原声真人发音；
 *   cet6  —— cet6-listening-data/<套>.js，站内没有公开音频，用浏览器语音合成朗读，
 *            界面上明确标注，不假装是原声。
 *
 * 句子数据、判分、录音、存储都走 study-core.js（window.IballStudy），
 * 朗读与暂停 / 重播控制条走 speech-transport.js（window.IballSpeech）。
 *
 * 加载策略：先只读 3KB 的 study-data/index.json 和题干清单，
 * 真正点开某一集 / 某一套时再按需取那一份 JSON，取回后在内存里缓存本次会话。
 */
(function () {
  "use strict";

  const study = window.IballStudy;

  const INDEX_URL = "./study-data/index.json";
  const CET6_PAPERS_URL = "./cet6-listening-papers.js";
  const ANSWER_KEY = "iball_listen_answers_v1";
  const WRONG_KEY = "iball_listen_wrong_v1";
  const PREFS_KEY = "iball_listen_prefs_v1";
  const WRONG_PASS_LINE = 85;

  const els = {
    list: document.getElementById("listenList"),
    sourceSelect: document.getElementById("sourceSelect"),
    setSelect: document.getElementById("setSelect"),
    rateGroup: document.querySelector(".segmented-control"),
    revealToggle: document.getElementById("revealToggleButton"),
    wrongBookButton: document.getElementById("wrongBookButton"),
    wrongCount: document.getElementById("wrongCount"),
    clearButton: document.getElementById("clearAnswersButton"),
    player: document.getElementById("listenPlayer"),
    progress: document.getElementById("listenProgress"),
    prev: document.getElementById("prevButton"),
    play: document.getElementById("playButton"),
    playLabel: document.getElementById("playButtonLabel"),
    replay: document.getElementById("replayButton"),
    next: document.getElementById("nextButton"),
    loop: document.getElementById("loopToggle"),
    sourceMeta: document.getElementById("listenSourceMeta"),
    timer: document.getElementById("listenTimer"),
    heroStats: document.getElementById("heroStats"),
    answerNumber: document.getElementById("answerSentenceNumber"),
    answerPlay: document.getElementById("answerPlayButton"),
    answerSlow: document.getElementById("answerSlowButton"),
    answerAttempts: document.getElementById("answerAttempts"),
    input: document.getElementById("answerInput"),
    submit: document.getElementById("submitAnswerButton"),
    showAnswer: document.getElementById("showAnswerButton"),
    nextSentence: document.getElementById("nextSentenceButton"),
    result: document.getElementById("answerResult"),
    reference: document.getElementById("answerReference"),
    referenceEn: document.querySelector("#answerReference .listen-reference-en"),
    referenceZh: document.querySelector("#answerReference .listen-reference-zh"),
    wrongPanel: document.getElementById("wrongBookPanel"),
    wrongList: document.getElementById("wrongList"),
    exportWrong: document.getElementById("exportWrongButton"),
    clearWrong: document.getElementById("clearWrongButton"),
    closeWrong: document.getElementById("closeWrongButton"),
    progressBar: document.getElementById("readingProgress"),
    toast: document.getElementById("toast"),
  };

  const state = {
    source: "movie",
    movieIndex: null,
    cet6Papers: null,
    sets: [],
    setId: "",
    setLabel: "",
    items: [],
    cursor: 0,
    rate: 0.9,
    reveal: false,
    loop: false,
    playing: false,
    loadingToken: 0,
    loadError: "",
    answers: study?.readStore(ANSWER_KEY, {}) || {},
    wrong: study?.readStore(WRONG_KEY, []) || [],
    cache: new Map(),
    indexPromise: null,
  };

  /* ------------------------------------------------------------- 小工具 */

  function setHtml(node, html) {
    if (node) {
      node.innerHTML = html;
    }
  }

  function escapeHtml(value) {
    return study ? study.escapeHtml(value) : String(value ?? "");
  }

  function showToast(message) {
    if (!els.toast) {
      return;
    }
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      els.toast.classList.remove("is-visible");
    }, 2600);
  }

  /* ------------------------------------------------------------- 素材加载 */

  async function ensureMovieIndex() {
    if (state.movieIndex) {
      return state.movieIndex;
    }
    if (!state.indexPromise) {
      const promise = (async () => {
        const data = await study.fetchJson(INDEX_URL);
        const episodes = (data.episodes || []).slice().sort((left, right) =>
          String(left.id).localeCompare(String(right.id)),
        );
        state.movieIndex = episodes;
        return episodes;
      })();
      state.indexPromise = promise;
    }
    return state.indexPromise;
  }

  async function ensureCet6Papers() {
    if (state.cet6Papers) {
      return state.cet6Papers;
    }
    await study.loadScript(CET6_PAPERS_URL);
    const papers = window.IBALL_CET6_LISTENING_PAPERS || [];
    state.cet6Papers = papers;
    return papers;
  }

  async function resolveSets(source) {
    if (source === "cet6") {
      const papers = await ensureCet6Papers();
      return papers.map((paper) => ({
        id: paper.id,
        label: paper.label || paper.title || paper.id,
        file: paper.file,
        detail: `${paper.paragraphCount || 0} 段 · ${paper.questionCount || 0} 题`,
      }));
    }
    const episodes = await ensureMovieIndex();
    return episodes.map((episode) => ({
      id: episode.id,
      label: episode.title || episode.id,
      file: episode.file,
      detail: `${episode.lineCount || 0} 句 · ${Math.round((episode.duration || 0) / 60)} 分钟`,
    }));
  }

  async function fetchSetPayload(source, set) {
    const cacheKey = `${source}:${set.id}`;
    if (state.cache.has(cacheKey)) {
      return state.cache.get(cacheKey);
    }
    if (source === "cet6") {
      await study.loadScript(set.file);
      const library = window.IBALL_CET6_LISTENING_LIBRARY || {};
      const payload = library[set.id];
      if (!payload) {
        throw new Error("该套听力正文没有找到");
      }
      state.cache.set(cacheKey, payload);
      return payload;
    }
    /*
     * 逐句时间轴刻意不做本地缓存：它必须和 movie-data/audio/<集>.mp3 精灵音频同版本，
     * 缓存到旧时间轴配上新音频就会串到别的台词上（movie.js 里踩过同一个坑）。
     */
    const payload = await study.fetchJson(set.file);
    state.cache.set(cacheKey, payload);
    return payload;
  }

  async function loadSet(source, setId, options = {}) {
    state.source = source;
    state.setId = setId;
    state.loadingToken += 1;
    const token = state.loadingToken;
    state.loadError = "";
    stopPlayback();

    const setMeta = state.sets.find((item) => item.id === setId) || { id: setId, label: setId };
    state.setLabel = setMeta.label;
    setHtml(
      els.list,
      `<div class="loading-state">
         <strong>正在准备听写素材</strong>
         <span>${escapeHtml(setMeta.label)} 按需加载，只读取这一份。</span>
       </div>`,
    );
    els.sourceMeta.textContent = `正在加载：${setMeta.label}`;

    try {
      const payload = await fetchSetPayload(source, setMeta);
      if (token !== state.loadingToken) {
        return;
      }
      state.items =
        source === "cet6" ? study.buildCet6Items(payload) : study.buildMovieItems(payload);
      if (!state.items.length) {
        throw new Error("这份素材没有可用句子");
      }
      state.cursor = 0;
      renderList();
      renderWrongCount();
      syncCursor({ autoplay: false, scroll: false });
      savePrefs();
      if (options.jumpItemId) {
        jumpToItemId(options.jumpItemId, options.autoplay !== false);
      }
    } catch (error) {
      if (token !== state.loadingToken) {
        return;
      }
      state.items = [];
      state.loadError = error?.message || "素材加载失败";
      setHtml(
        els.list,
        `<div class="error-state">
           <strong>素材没能加载出来</strong>
           <span>${escapeHtml(state.loadError)}</span>
           <button class="tool-button" type="button" data-retry="1">重新加载</button>
         </div>`,
      );
      els.sourceMeta.textContent = `加载失败：${state.loadError}`;
      showToast(state.loadError);
    }
  }

  async function refreshSets(options = {}) {
    const source = els.sourceSelect.value;
    setHtml(els.setSelect, `<option value="">正在读取清单…</option>`);
    try {
      state.sets = await resolveSets(source);
    } catch (error) {
      state.sets = [];
      setHtml(els.setSelect, `<option value="">清单读取失败</option>`);
      showToast(error?.message || "清单读取失败");
      return;
    }
    const options_ = state.sets
      .map(
        (item) =>
          `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}（${escapeHtml(
            item.detail,
          )}）</option>`,
      )
      .join("");
    setHtml(els.setSelect, options_ || `<option value="">没有可用素材</option>`);
    const preferred =
      options.preferId && state.sets.some((item) => item.id === options.preferId)
        ? options.preferId
        : state.sets[0]?.id;
    if (preferred) {
      els.setSelect.value = preferred;
      await loadSet(source, preferred, options);
    }
  }

  /* --------------------------------------------------------------- 渲染 */

  function currentItem() {
    return state.items[state.cursor] || null;
  }

  function answerKey() {
    return `${state.source}:${state.setId}`;
  }

  function answerFor(item) {
    if (!item) {
      return null;
    }
    return state.answers[answerKey()]?.[item.id] || null;
  }

  function renderList() {
    if (!els.list) {
      return;
    }
    const rows = state.items
      .map((item, index) => {
        const saved = answerFor(item);
        const stateLabel = saved ? `${saved.percent}%` : "";
        const stateKind = saved ? (saved.percent >= WRONG_PASS_LINE ? "hit" : "miss") : "";
        return `<button class="listen-item${saved ? " is-revealed" : ""}" type="button" data-index="${index}">
          <span class="listen-item-index">${String(index + 1).padStart(3, "0")}</span>
          <span class="listen-item-body">
            <span class="listen-item-en" lang="en">${escapeHtml(item.text)}</span>
            ${item.zh ? `<span class="listen-item-zh">${escapeHtml(item.zh)}</span>` : ""}
          </span>
          <span class="listen-item-state" data-state="${stateKind}">${escapeHtml(stateLabel)}</span>
        </button>`;
      })
      .join("");
    setHtml(els.list, rows);
    els.list.classList.toggle("is-masked", !state.reveal);
    renderStats();
  }

  function renderStats() {
    if (!els.heroStats) {
      return;
    }
    const bucket = state.answers[answerKey()] || {};
    const done = state.items.filter((item) => bucket[item.id]).length;
    const scores = Object.values(bucket).map((entry) => entry.percent || 0);
    const average = scores.length
      ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
      : 0;
    const chips = [
      { value: String(state.items.length), label: "本份句子" },
      { value: String(done), label: "已听写" },
      { value: average ? `${average}%` : "--", label: "平均分" },
      { value: String(state.wrong.length), label: "错题本" },
    ];
    setHtml(
      els.heroStats,
      chips
        .map(
          (chip) =>
            `<span class="stat-chip"><strong>${escapeHtml(chip.value)}</strong><span>${escapeHtml(
              chip.label,
            )}</span></span>`,
        )
        .join(""),
    );
  }

  function updateItemVisual(index) {
    const node = els.list?.querySelector(`.listen-item[data-index="${index}"]`);
    if (!node) {
      return;
    }
    els.list.querySelectorAll(".listen-item.is-current").forEach((element) => {
      element.classList.remove("is-current");
    });
    node.classList.add("is-current");
  }

  function scrollItemIntoView(index) {
    const node = els.list?.querySelector(`.listen-item[data-index="${index}"]`);
    if (!node || !els.list) {
      return;
    }
    const listBox = els.list.getBoundingClientRect();
    const itemBox = node.getBoundingClientRect();
    if (itemBox.top >= listBox.top && itemBox.bottom <= listBox.bottom) {
      return;
    }
    node.scrollIntoView({ block: "nearest" });
  }

  function renderAttempts(item) {
    if (!els.answerAttempts) {
      return;
    }
    const saved = answerFor(item);
    els.answerAttempts.textContent = saved
      ? `已提交 ${saved.attempts || 1} 次 · 上次 ${saved.percent}%`
      : "";
  }

  function renderResult(score) {
    if (!els.result) {
      return;
    }
    if (!score) {
      els.result.textContent = "";
      return;
    }
    const diff = score.diff
      .map((entry) => {
        if (entry.type === "hit") {
          return `<span class="diff-hit">${escapeHtml(entry.display)}</span>`;
        }
        if (entry.type === "miss") {
          return `<span class="diff-miss">${escapeHtml(entry.display)}</span>`;
        }
        return `<span class="diff-extra">${escapeHtml(entry.display)}</span>`;
      })
      .join("");
    const note =
      score.percent >= WRONG_PASS_LINE
        ? "这句过了，继续下一句。"
        : `${score.missing.length} 个词没听出来，再听一遍试试。`;
    setHtml(
      els.result,
      `<div class="listen-score">
         <div class="listen-score-head">
           <span class="listen-score-value">${score.percent}%</span>
           <span class="listen-score-note">命中 ${Math.round(
             score.accuracy * score.wordCount,
           )} / ${score.wordCount} 词 · ${escapeHtml(note)}</span>
         </div>
         <div class="listen-diff">${diff}</div>
       </div>`,
    );
  }

  function renderReference(item, visible) {
    if (!els.reference) {
      return;
    }
    if (!item || !visible) {
      els.reference.hidden = true;
      return;
    }
    els.reference.hidden = false;
    if (els.referenceEn) {
      els.referenceEn.textContent = item.text;
    }
    if (els.referenceZh) {
      els.referenceZh.textContent = item.zh
        ? `${item.zhLabel}：${item.zh}`
        : "这份素材没有配译文。";
    }
  }

  /* ---------------------------------------------------------- 当前句控制 */

  function syncCursor(options = {}) {
    const item = currentItem();
    const total = state.items.length;
    if (els.progress) {
      els.progress.textContent = `第 ${total ? state.cursor + 1 : 0} / ${total} 句`;
    }
    updateItemVisual(state.cursor);
    if (options.scroll !== false) {
      scrollItemIntoView(state.cursor);
    }
    if (els.prev) {
      els.prev.disabled = !total || state.cursor === 0;
    }
    if (els.next) {
      els.next.disabled = !total || state.cursor >= total - 1;
    }
    if (els.answerNumber) {
      els.answerNumber.textContent = item
        ? `第 ${state.cursor + 1} 句${item.scene ? ` · ${item.scene}` : ""}`
        : "先选一份素材";
    }
    if (els.sourceMeta) {
      const mode = state.source === "cet6" ? "浏览器朗读（站内无公开音频）" : "真人原声";
      els.sourceMeta.textContent = item
        ? `${state.setLabel} · ${mode}`
        : state.loadError || "正在准备素材…";
    }
    if (els.timer) {
      if (item && item.mode === "audio") {
        els.timer.textContent = `${study?.formatTime(item.start) || "0:00"} / ${
          study?.formatTime(item.end) || "0:00"
        }`;
      } else {
        els.timer.textContent = "--:-- / --:--";
      }
    }
    if (els.input) {
      els.input.value = answerFor(item)?.text || "";
      els.input.disabled = !item;
    }
    renderAttempts(item);
    renderResult(null);
    renderReference(item, false);
    if (options.autoplay) {
      playCurrent();
    }
  }

  function setPlayingUi(playing) {
    state.playing = playing;
    if (els.play) {
      els.play.classList.toggle("is-playing", playing);
    }
    if (els.playLabel) {
      els.playLabel.textContent = playing ? "暂停" : "播放";
    }
  }

  function stopPlayback() {
    study?.stopAudio?.();
    study?.stopSpeech?.();
    setPlayingUi(false);
  }

  function playCurrent(options = {}) {
    const item = currentItem();
    if (!item) {
      showToast("先选一份素材");
      return;
    }
    stopPlayback();
    const rate = Number(options.rate) > 0 ? Number(options.rate) : state.rate;
    const onEnd = () => {
      setPlayingUi(false);
      if (state.loop) {
        window.setTimeout(() => {
          if (state.loop) {
            playCurrent({ rate });
          }
        }, 420);
      }
    };
    if (item.mode === "audio") {
      const ok = study?.playRange?.({
        start: item.start,
        end: item.end,
        sprite: item.sprite,
        rate,
        label: `听句 · ${state.setLabel}`,
        onEnd,
        onError: (message) => {
          setPlayingUi(false);
          showToast(message || "原声播放失败");
        },
      });
      if (!ok) {
        showToast("这一句缺少音频时间轴");
        return;
      }
    } else {
      const ok = study?.speak?.(item.text, {
        rate,
        label: `听句 · ${state.setLabel}`,
        onFinish: onEnd,
        onUnsupported: () => showToast("当前浏览器不支持语音合成"),
      });
      if (!ok) {
        showToast("当前浏览器不支持语音合成");
        return;
      }
    }
    setPlayingUi(true);
  }

  function togglePlay() {
    if (!state.playing) {
      playCurrent();
      return;
    }
    if (window.IballSpeech?.isActive?.()) {
      window.IballSpeech.toggle();
      if (els.playLabel) {
        els.playLabel.textContent = window.IballSpeech.isPaused?.() ? "继续" : "暂停";
      }
      return;
    }
    stopPlayback();
  }

  function moveCursor(step) {
    const nextIndex = state.cursor + step;
    if (nextIndex < 0 || nextIndex >= state.items.length) {
      return;
    }
    state.cursor = nextIndex;
    syncCursor({ autoplay: true });
  }

  function jumpToItemId(itemId, autoplay) {
    const index = state.items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return false;
    }
    state.cursor = index;
    syncCursor({ autoplay: Boolean(autoplay) });
    return true;
  }

  /* --------------------------------------------------------------- 判分 */

  function saveAnswers() {
    study?.writeStore(ANSWER_KEY, state.answers);
  }

  function saveWrong() {
    study?.writeStore(WRONG_KEY, state.wrong);
  }

  function recordWrong(item, score, answer) {
    const key = `${state.source}:${state.setId}:${item.id}`;
    const existing = state.wrong.find((entry) => entry.key === key);
    const payload = {
      key,
      source: state.source,
      setId: state.setId,
      setLabel: state.setLabel,
      itemId: item.id,
      order: state.cursor,
      text: item.text,
      zh: item.zh,
      answer,
      percent: score.percent,
      at: Date.now(),
    };
    if (existing) {
      existing.percent = Math.min(existing.percent, score.percent);
      existing.answer = answer;
      existing.at = payload.at;
      existing.order = payload.order;
      existing.setLabel = payload.setLabel;
      existing.count = (existing.count || 1) + 1;
    } else {
      payload.count = 1;
      state.wrong.unshift(payload);
    }
    state.wrong = state.wrong.slice(0, 300);
    saveWrong();
    renderWrongCount();
    renderStats();
  }

  function submitAnswer() {
    const item = currentItem();
    if (!item) {
      showToast("先选一份素材");
      return;
    }
    const value = els.input?.value.trim() || "";
    if (!value) {
      showToast("先写下你听到的英文");
      els.input?.focus();
      return;
    }
    const score = study.scoreText(value, item.text);
    const key = answerKey();
    state.answers[key] = state.answers[key] || {};
    const previous = state.answers[key][item.id];
    state.answers[key][item.id] = {
      text: value,
      percent: score.percent,
      attempts: (previous?.attempts || 0) + 1,
      at: Date.now(),
    };
    saveAnswers();
    renderResult(score);
    renderReference(item, true);
    renderAttempts(item);
    const node = els.list?.querySelector(`.listen-item[data-index="${state.cursor}"]`);
    if (node) {
      node.classList.add("is-revealed");
      const badge = node.querySelector(".listen-item-state");
      if (badge) {
        badge.textContent = `${score.percent}%`;
        badge.dataset.state = score.percent >= WRONG_PASS_LINE ? "hit" : "miss";
      }
    }
    if (score.percent < WRONG_PASS_LINE) {
      recordWrong(item, score, value);
    }
    renderStats();
  }

  function revealCurrentAnswer() {
    const item = currentItem();
    if (!item) {
      return;
    }
    renderReference(item, true);
    const node = els.list?.querySelector(`.listen-item[data-index="${state.cursor}"]`);
    node?.classList.add("is-revealed");
  }

  function toggleReveal() {
    state.reveal = !state.reveal;
    els.list?.classList.toggle("is-masked", !state.reveal);
    if (els.revealToggle) {
      els.revealToggle.textContent = state.reveal ? "隐藏原文" : "显示原文";
    }
    savePrefs();
  }

  function clearSession() {
    const key = answerKey();
    if (!state.answers[key]) {
      showToast("这一份还没有听写记录");
      return;
    }
    if (!window.confirm("清空这一份听写的判分记录？错题本不受影响。")) {
      return;
    }
    delete state.answers[key];
    saveAnswers();
    renderList();
    syncCursor({ autoplay: false });
    showToast("已清空本次听写记录");
  }

  /* ------------------------------------------------------------- 错题本 */

  function renderWrongCount() {
    if (els.wrongCount) {
      els.wrongCount.textContent = String(state.wrong.length);
    }
  }

  function renderWrongList() {
    if (!els.wrongList) {
      return;
    }
    if (!state.wrong.length) {
      setHtml(els.wrongList, `<p class="listen-empty">还没有错句。听写低于 ${WRONG_PASS_LINE}% 的句子会自动记到这里。</p>`);
      return;
    }
    setHtml(
      els.wrongList,
      state.wrong
        .map(
          (entry, index) => `<article class="listen-wrong-item">
            <div class="listen-wrong-head">
              <span class="listen-wrong-source">${escapeHtml(entry.setLabel)} · 第 ${
                (entry.order || 0) + 1
              } 句 · ${entry.percent}%${entry.count > 1 ? ` · 错 ${entry.count} 次` : ""}</span>
              <span class="listen-wrong-actions-inline">
                <button class="compact-button" type="button" data-wrong-jump="${index}">跳过去</button>
                <button class="compact-button" type="button" data-wrong-remove="${index}">移除</button>
              </span>
            </div>
            <p class="listen-wrong-line"><strong>原句：</strong>${escapeHtml(entry.text)}</p>
            <p class="listen-wrong-line"><strong>你写的：</strong>${escapeHtml(entry.answer)}</p>
            ${entry.zh ? `<p class="listen-wrong-line"><strong>参考译文：</strong>${escapeHtml(entry.zh)}</p>` : ""}
          </article>`,
        )
        .join(""),
    );
  }

  function toggleWrongPanel(force) {
    if (!els.wrongPanel) {
      return;
    }
    const next = typeof force === "boolean" ? force : els.wrongPanel.hidden;
    els.wrongPanel.hidden = !next;
    if (next) {
      renderWrongList();
      els.wrongPanel.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  async function jumpToWrong(index) {
    const entry = state.wrong[index];
    if (!entry) {
      return;
    }
    if (entry.source !== state.source) {
      els.sourceSelect.value = entry.source;
      await refreshSets({ preferId: entry.setId });
    } else if (entry.setId !== state.setId) {
      const option = state.sets.find((item) => item.id === entry.setId);
      if (option) {
        els.setSelect.value = option.id;
      }
      await loadSet(entry.source, entry.setId);
    }
    if (!jumpToItemId(entry.itemId, false)) {
      showToast("这句不在当前素材里，可能已经重新生成过时间轴");
      return;
    }
    toggleWrongPanel(false);
    playCurrent();
  }

  function exportWrong() {
    if (!state.wrong.length) {
      showToast("错题本是空的");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify({ generatedAt: stamp, items: state.wrong }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `listen-wrong-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("错题本已导出");
  }

  /* ---------------------------------------------------------------- 偏好 */

  function savePrefs() {
    study?.writeStore(PREFS_KEY, {
      source: state.source,
      movieSet: state.source === "movie" ? state.setId : undefined,
      cet6Set: state.source === "cet6" ? state.setId : undefined,
      rate: state.rate,
      reveal: state.reveal,
    });
  }

  function restorePrefs() {
    const prefs = study?.readStore(PREFS_KEY, null);
    if (!prefs) {
      return;
    }
    state.rate = Number(prefs.rate) > 0 ? Number(prefs.rate) : state.rate;
    state.reveal = Boolean(prefs.reveal);
    if (prefs.source === "cet6" || prefs.source === "movie") {
      state.source = prefs.source;
    }
    state.prefSetId = state.source === "cet6" ? prefs.cet6Set : prefs.movieSet;
  }

  function syncRateButtons() {
    els.rateGroup?.querySelectorAll(".segment-button").forEach((button) => {
      const active = Number(button.dataset.rate) === state.rate;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  /* --------------------------------------------------------------- 事件 */

  function bindEvents() {
    els.sourceSelect?.addEventListener("change", () => {
      state.prefSetId = "";
      refreshSets();
    });

    els.setSelect?.addEventListener("change", () => {
      if (els.setSelect.value) {
        loadSet(els.sourceSelect.value, els.setSelect.value);
      }
    });

    els.rateGroup?.addEventListener("click", (event) => {
      const button = event.target.closest(".segment-button");
      if (!button) {
        return;
      }
      state.rate = Number(button.dataset.rate) || 1;
      syncRateButtons();
      savePrefs();
    });

    els.list?.addEventListener("click", (event) => {
      const retry = event.target.closest("[data-retry]");
      if (retry) {
        loadSet(state.source, state.setId);
        return;
      }
      const item = event.target.closest(".listen-item");
      if (!item) {
        return;
      }
      const index = Number(item.dataset.index);
      if (!Number.isFinite(index) || index === state.cursor) {
        playCurrent();
        return;
      }
      state.cursor = index;
      syncCursor({ autoplay: true });
    });

    els.play?.addEventListener("click", togglePlay);
    els.prev?.addEventListener("click", () => moveCursor(-1));
    els.next?.addEventListener("click", () => moveCursor(1));
    els.replay?.addEventListener("click", () => playCurrent());
    els.answerPlay?.addEventListener("click", () => playCurrent());
    els.answerSlow?.addEventListener("click", () => playCurrent({ rate: 0.7 }));
    els.loop?.addEventListener("change", () => {
      state.loop = Boolean(els.loop.checked);
    });

    els.submit?.addEventListener("click", submitAnswer);
    els.showAnswer?.addEventListener("click", revealCurrentAnswer);
    els.nextSentence?.addEventListener("click", () => moveCursor(1));
    els.revealToggle?.addEventListener("click", toggleReveal);
    els.clearButton?.addEventListener("click", clearSession);

    els.input?.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        submitAnswer();
      }
    });

    els.wrongBookButton?.addEventListener("click", () => toggleWrongPanel());
    els.closeWrong?.addEventListener("click", () => toggleWrongPanel(false));
    els.clearWrong?.addEventListener("click", () => {
      if (!state.wrong.length) {
        showToast("错题本已经是空的");
        return;
      }
      if (!window.confirm("清空错题本？这一步不能撤销。")) {
        return;
      }
      state.wrong = [];
      saveWrong();
      renderWrongCount();
      renderWrongList();
      renderStats();
      showToast("错题本已清空");
    });
    els.exportWrong?.addEventListener("click", exportWrong);
    els.wrongList?.addEventListener("click", (event) => {
      const jump = event.target.closest("[data-wrong-jump]");
      if (jump) {
        jumpToWrong(Number(jump.dataset.wrongJump));
        return;
      }
      const remove = event.target.closest("[data-wrong-remove]");
      if (remove) {
        state.wrong.splice(Number(remove.dataset.wrongRemove), 1);
        saveWrong();
        renderWrongCount();
        renderWrongList();
        renderStats();
      }
    });

    document.addEventListener(
      "play",
      (event) => {
        if (event.target instanceof HTMLMediaElement) {
          setPlayingUi(true);
        }
      },
      true,
    );
    document.addEventListener(
      "pause",
      (event) => {
        if (event.target instanceof HTMLMediaElement) {
          setPlayingUi(false);
        }
      },
      true,
    );

    document.addEventListener("keydown", (event) => {
      if (event.target.closest("textarea, input, select")) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowLeft") {
        moveCursor(-1);
      } else if (event.code === "ArrowRight") {
        moveCursor(1);
      }
    });

    window.addEventListener(
      "scroll",
      () => {
        if (!els.progressBar) {
          return;
        }
        const height = document.documentElement.scrollHeight - window.innerHeight;
        const ratio = height > 0 ? Math.min(window.scrollY / height, 1) : 0;
        els.progressBar.style.transform = `scaleX(${ratio})`;
      },
      { passive: true },
    );
  }

  /* ---------------------------------------------------------------- 启动 */

  async function init() {
    if (!study) {
      setHtml(
        els.list,
        `<div class="error-state">
           <strong>听句模块没能启动</strong>
           <span>缺少 study-core.js，请刷新页面重试。</span>
         </div>`,
      );
      return;
    }
    bindEvents();
    restorePrefs();
    els.sourceSelect.value = state.source;
    syncRateButtons();
    if (els.revealToggle) {
      els.revealToggle.textContent = state.reveal ? "隐藏原文" : "显示原文";
    }
    els.list?.classList.toggle("is-masked", !state.reveal);
    renderWrongCount();
    await refreshSets({ preferId: state.prefSetId });
  }

  init();
})();
