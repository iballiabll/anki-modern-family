/**
 * 跟读台。
 *
 * 一句的完整流程：播原音（可 0.7x）→ 数三秒准备 → 录音 → 语音识别 → 词级对齐评分。
 * 「连续跟读」把这个流程串成一条不断开的循环，自动推进到下一句，直到手动停止或整份练完。
 *
 * 录音只在本机处理：MediaRecorder 拿到 Blob 后只存在内存里（刷新即失效），
 * 语音识别用浏览器自带的 Web Speech API，录音不会上传到本站服务器。
 */
(function () {
  "use strict";

  const study = window.IballStudy;

  const INDEX_URL = "./study-data/index.json";
  const CET6_PAPERS_URL = "./cet6-listening-papers.js";
  const RECORD_KEY = "iball_shadow_records_v1";
  const NOTE_KEY = "iball_shadow_notes_v1";
  const PREFS_KEY = "iball_shadow_prefs_v1";
  const PREPARE_SECONDS = 3;
  const GOOD_SCORE = 85;
  const FAIR_SCORE = 65;

  const els = {
    list: document.getElementById("shadowList"),
    sourceSelect: document.getElementById("sourceSelect"),
    setSelect: document.getElementById("setSelect"),
    rateGroup: document.getElementById("rateGroup"),
    continuousButton: document.getElementById("continuousButton"),
    clearButton: document.getElementById("clearRecordsButton"),
    micCheck: document.getElementById("micCheckButton"),
    player: document.getElementById("shadowPlayer"),
    progress: document.getElementById("shadowProgress"),
    prev: document.getElementById("prevButton"),
    play: document.getElementById("playButton"),
    playLabel: document.getElementById("playButtonLabel"),
    slow: document.getElementById("slowButton"),
    replay: document.getElementById("replayButton"),
    next: document.getElementById("nextButton"),
    loop: document.getElementById("loopToggle"),
    sourceMeta: document.getElementById("shadowSourceMeta"),
    timer: document.getElementById("shadowTimer"),
    heroStats: document.getElementById("heroStats"),
    scriptScene: document.getElementById("scriptScene"),
    scriptText: document.getElementById("scriptText"),
    scriptZh: document.getElementById("scriptZh"),
    scriptFocus: document.getElementById("scriptFocus"),
    scriptNotes: document.getElementById("scriptNotes"),
    recordButton: document.getElementById("recordButton"),
    recordButtonLabel: document.getElementById("recordButtonLabel"),
    recordTimer: document.getElementById("recordTimer"),
    stopRecord: document.getElementById("stopRecordButton"),
    playRecord: document.getElementById("playRecordButton"),
    scoreButton: document.getElementById("scoreButton"),
    recordStatus: document.getElementById("recordStatus"),
    meter: document.getElementById("recordMeter"),
    meterBar: document.getElementById("recordMeterBar"),
    meterText: document.getElementById("recordMeterText"),
    result: document.getElementById("shadowResult"),
    noteInput: document.getElementById("noteInput"),
    progressBar: document.getElementById("readingProgress"),
    toast: document.getElementById("toast"),
  };

  const state = {
    source: "movie",
    sets: [],
    setId: "",
    setLabel: "",
    items: [],
    cursor: 0,
    rate: 1,
    loop: false,
    playing: false,
    continuous: false,
    runToken: 0,
    recording: false,
    indexPromise: null,
    cet6Papers: null,
    cache: new Map(),
    records: study?.readStore(RECORD_KEY, {}) || {},
    notes: study?.readStore(NOTE_KEY, {}) || {},
    audioUrls: new Map(),
    pendingBlob: null,
    recorder: null,
    recognizer: null,
    lastTranscript: "",
    recordStartedAt: 0,
    recordTimerId: 0,
    recordLimitId: 0,
    recordTarget: 0,
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
    showToast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function currentItem() {
    return state.items[state.cursor] || null;
  }

  function setKey() {
    return `${state.source}:${state.setId}`;
  }

  function recordFor(item) {
    if (!item) {
      return null;
    }
    return state.records[setKey()]?.[item.id] || null;
  }

  function noteFor(item) {
    if (!item) {
      return "";
    }
    return state.notes[`${setKey()}:${item.id}`] || "";
  }

  function badgeFor(record) {
    if (!record) {
      return { text: "", kind: "" };
    }
    if (typeof record.percent !== "number") {
      return { text: "已录", kind: "recorded" };
    }
    const kind =
      record.percent >= GOOD_SCORE ? "good" : record.percent >= FAIR_SCORE ? "fair" : "weak";
    return { text: `${record.percent}%`, kind };
  }

  /* ----------------------------------------------------------- 素材加载 */

  async function resolveSets(source) {
    if (source === "cet6") {
      if (!state.cet6Papers) {
        await study.loadScript(CET6_PAPERS_URL);
        state.cet6Papers = window.IBALL_CET6_LISTENING_PAPERS || [];
      }
      return state.cet6Papers.map((paper) => ({
        id: paper.id,
        label: paper.label || paper.title || paper.id,
        file: paper.file,
        detail: `${paper.paragraphCount || 0} 段`,
      }));
    }
    if (!state.indexPromise) {
      state.indexPromise = study.fetchJson(INDEX_URL).then((data) =>
        (data.episodes || [])
          .slice()
          .sort((left, right) => String(left.id).localeCompare(String(right.id))),
      );
    }
    const episodes = await state.indexPromise;
    return episodes.map((episode) => ({
      id: episode.id,
      label: episode.title || episode.id,
      file: episode.file,
      detail: `${episode.lineCount || 0} 句`,
    }));
  }

  async function fetchSetPayload(source, set) {
    const cacheKey = `${source}:${set.id}`;
    if (state.cache.has(cacheKey)) {
      return state.cache.get(cacheKey);
    }
    let payload;
    if (source === "cet6") {
      await study.loadScript(set.file);
      payload = (window.IBALL_CET6_LISTENING_LIBRARY || {})[set.id];
      if (!payload) {
        throw new Error("该套听力正文没有找到");
      }
    } else {
      // 时间轴必须和精灵音频同版本，因此不做本地缓存（与 movie.js 的取舍一致）。
      payload = await study.fetchJson(set.file);
    }
    state.cache.set(cacheKey, payload);
    return payload;
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
    setHtml(
      els.setSelect,
      state.sets
        .map(
          (item) =>
            `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}（${escapeHtml(
              item.detail,
            )}）</option>`,
        )
        .join("") || `<option value="">没有可用素材</option>`,
    );
    const preferred =
      options.preferId && state.sets.some((item) => item.id === options.preferId)
        ? options.preferId
        : state.sets[0]?.id;
    if (preferred) {
      els.setSelect.value = preferred;
      await loadSet(source, preferred);
    }
  }

  async function loadSet(source, setId) {
    releaseAudioUrls();
    stopContinuous({ silent: true });
    state.source = source;
    state.setId = setId;
    const meta = state.sets.find((item) => item.id === setId) || { id: setId, label: setId };
    state.setLabel = meta.label;
    setHtml(
      els.list,
      `<div class="loading-state">
         <strong>正在准备跟读素材</strong>
         <span>${escapeHtml(meta.label)} 按需加载，只读取这一份。</span>
       </div>`,
    );
    els.sourceMeta.textContent = `正在加载：${meta.label}`;

    try {
      const payload = await fetchSetPayload(source, meta);
      state.items =
        source === "cet6" ? study.buildCet6Items(payload) : study.buildMovieItems(payload);
      if (!state.items.length) {
        throw new Error("这份素材没有可用句子");
      }
      state.cursor = 0;
      renderList();
      syncCursor();
      savePrefs();
    } catch (error) {
      state.items = [];
      setHtml(
        els.list,
        `<div class="error-state">
           <strong>素材没能加载出来</strong>
           <span>${escapeHtml(error?.message || "未知错误")}</span>
           <button class="tool-button" type="button" data-retry="1">重新加载</button>
         </div>`,
      );
      els.sourceMeta.textContent = error?.message || "素材加载失败";
      showToast(error?.message || "素材加载失败");
    }
  }

  /* --------------------------------------------------------------- 渲染 */

  function renderList() {
    if (!els.list) {
      return;
    }
    setHtml(
      els.list,
      state.items
        .map((item, index) => {
          const badge = badgeFor(recordFor(item));
          return `<button class="shadow-line" type="button" data-index="${index}">
            <span class="shadow-line-index">${String(index + 1).padStart(3, "0")}</span>
            <span class="shadow-line-text" lang="en">${escapeHtml(item.text)}</span>
            <span class="shadow-line-badge" data-state="${badge.kind}">${escapeHtml(badge.text)}</span>
          </button>`;
        })
        .join(""),
    );
    renderStats();
  }

  function renderStats() {
    if (!els.heroStats) {
      return;
    }
    const bucket = state.records[setKey()] || {};
    const entries = Object.values(bucket);
    const scored = entries.filter((entry) => typeof entry.percent === "number");
    const average = scored.length
      ? Math.round(scored.reduce((sum, entry) => sum + entry.percent, 0) / scored.length)
      : 0;
    const chips = [
      { value: String(state.items.length), label: "本份句子" },
      { value: String(entries.length), label: "已跟读" },
      { value: average ? `${average}%` : "--", label: "平均分" },
      {
        value: recognizerSupported() ? "可用" : "不可用",
        label: "语音评分",
      },
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

  function renderScript(item) {
    if (!item) {
      if (els.scriptText) {
        els.scriptText.textContent = "先选一份素材，这里会显示当前要跟读的句子。";
      }
      if (els.scriptZh) {
        els.scriptZh.textContent = "";
      }
      if (els.scriptScene) {
        els.scriptScene.textContent = "";
      }
      if (els.scriptFocus) {
        els.scriptFocus.textContent = "";
      }
      if (els.scriptNotes) {
        els.scriptNotes.textContent = "";
      }
      return;
    }
    if (els.scriptText) {
      els.scriptText.textContent = item.text;
    }
    if (els.scriptZh) {
      els.scriptZh.textContent = item.zh ? `${item.zhLabel}：${item.zh}` : "";
    }
    if (els.scriptScene) {
      els.scriptScene.textContent = item.scene || "";
    }
    if (els.scriptFocus) {
      const chips = [];
      if (item.keyPhrase) {
        chips.push(`重点搭配：${item.keyPhrase}${item.meaning ? `（${item.meaning}）` : ""}`);
      }
      if (item.phonetic) {
        chips.push(`音标：${item.phonetic}`);
      }
      setHtml(els.scriptFocus, chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join(""));
    }
    if (els.scriptNotes) {
      setHtml(
        els.scriptNotes,
        (item.grammarNotes || [])
          .map((note) => `<p>${escapeHtml(note)}</p>`)
          .join(""),
      );
    }
  }

  function syncCursor(options = {}) {
    const item = currentItem();
    const total = state.items.length;
    if (els.progress) {
      els.progress.textContent = `第 ${total ? state.cursor + 1 : 0} / ${total} 句`;
    }
    els.list?.querySelectorAll(".shadow-line.is-current").forEach((node) => {
      node.classList.remove("is-current");
    });
    const node = els.list?.querySelector(`.shadow-line[data-index="${state.cursor}"]`);
    node?.classList.add("is-current");
    if (node) {
      const box = els.list.getBoundingClientRect();
      const itemBox = node.getBoundingClientRect();
      if (itemBox.top < box.top || itemBox.bottom > box.bottom) {
        node.scrollIntoView({ block: "nearest" });
      }
    }
    if (els.prev) {
      els.prev.disabled = !total || state.cursor === 0;
    }
    if (els.next) {
      els.next.disabled = !total || state.cursor >= total - 1;
    }
    if (els.sourceMeta) {
      const mode = state.source === "cet6" ? "浏览器朗读（站内无公开音频）" : "真人原声";
      els.sourceMeta.textContent = item ? `${state.setLabel} · ${mode}` : "正在准备素材…";
    }
    if (els.timer) {
      els.timer.textContent =
        item && item.mode === "audio"
          ? `${study.formatTime(item.start)} / ${study.formatTime(item.end)}`
          : "--:-- / --:--";
    }
    renderScript(item);
    renderResult(recordFor(item), false);
    if (els.noteInput) {
      els.noteInput.value = noteFor(item);
      els.noteInput.disabled = !item;
    }
    if (els.playRecord) {
      els.playRecord.disabled = !state.audioUrls.has(item?.id);
    }
    if (els.scoreButton) {
      els.scoreButton.disabled = !(state.audioUrls.has(item?.id) && state.lastTranscript);
    }
  }

  function renderResult(record, live) {
    if (!els.result) {
      return;
    }
    if (!record) {
      els.result.textContent = "";
      return;
    }
    const hasScore = typeof record.percent === "number";
    const diff = (record.diff || [])
      .map((entry) => {
        const kind = entry.type === "hit" ? "is-hit" : entry.type === "miss" ? "is-miss" : "is-extra";
        return `<span class="${kind}">${escapeHtml(entry.display)}</span>`;
      })
      .join("");
    const level = !hasScore
      ? "已录音"
      : record.percent >= GOOD_SCORE
        ? `过关（≥${GOOD_SCORE}%）`
        : record.percent >= FAIR_SCORE
          ? "接近了，再跟一遍"
          : "差得比较多，先慢速听一遍";
    setHtml(
      els.result,
      `<div class="shadow-score">
         <div class="shadow-score-head">
           <span class="shadow-score-value">${hasScore ? `${record.percent}%` : "—"}</span>
           <span class="shadow-score-note">${escapeHtml(level)}${
             live ? " · 刚刚录音" : ""
           }</span>
         </div>
         ${diff ? `<div class="shadow-diff">${diff}</div>` : ""}
         ${
           record.transcript
             ? `<p class="shadow-heard"><strong>识别到的句子：</strong>${escapeHtml(
                 record.transcript,
               )}</p>`
             : `<p class="shadow-heard"><strong>提示：</strong>这台浏览器没有提供语音识别，只保留了录音，请自己对比原音。</p>`
         }
       </div>`,
    );
  }

  /* ------------------------------------------------------------- 播放 */

  function setPlayingUi(playing) {
    state.playing = playing;
    els.play?.classList.toggle("is-playing", playing);
    if (els.playLabel) {
      els.playLabel.textContent = playing ? "播放中…" : "播放原音";
    }
  }

  function stopPlayback() {
    study?.stopAudio?.();
    study?.stopSpeech?.();
    setPlayingUi(false);
  }

  /** 播一句原音，返回的 Promise 在播完后 resolve（等待期间可以被 stop 打断）。 */
  function playOriginal(options = {}) {
    const item = currentItem();
    if (!item) {
      return Promise.resolve(false);
    }
    const rate = Number(options.rate) > 0 ? Number(options.rate) : state.rate;
    const token = state.runToken;
    stopPlayback();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(fallback);
        setPlayingUi(false);
        resolve(token === state.runToken);
      };
      const fallback = window.setTimeout(finish, options.timeout || 26000);

      if (item.mode === "audio") {
        const ok = study.playRange({
          start: item.start,
          end: item.end,
          sprite: item.sprite,
          rate,
          label: `跟读 · ${state.setLabel}`,
          onEnd: finish,
          onError: (message) => {
            showToast(message || "原声播放失败");
            finish();
          },
        });
        if (!ok) {
          showToast("这一句缺少音频时间轴");
          finish();
          return;
        }
        window.clearTimeout(fallback);
        window.setTimeout(finish, ((item.end - item.start) / rate) * 1000 + 1600);
      } else {
        const ok = study.speak(item.text, {
          rate,
          label: `跟读 · ${state.setLabel}`,
          onFinish: finish,
          onUnsupported: () => showToast("当前浏览器不支持语音合成"),
        });
        if (!ok) {
          showToast("当前浏览器不支持语音合成");
          finish();
          return;
        }
      }
      setPlayingUi(true);
    });
  }

  function togglePlay() {
    if (!state.playing) {
      playOriginal();
      return;
    }
    if (window.IballSpeech?.isActive?.()) {
      window.IballSpeech.toggle();
      if (els.playLabel) {
        els.playLabel.textContent = window.IballSpeech.isPaused?.() ? "继续原音" : "播放中…";
      }
      return;
    }
    stopPlayback();
  }

  function moveCursor(step, options = {}) {
    const nextIndex = state.cursor + step;
    if (nextIndex < 0 || nextIndex >= state.items.length) {
      return false;
    }
    state.cursor = nextIndex;
    syncCursor();
    if (options.autoplay) {
      playOriginal();
    }
    return true;
  }

  /* ------------------------------------------------------------- 录音 */

  function setRecordStatus(text) {
    if (els.recordStatus) {
      els.recordStatus.textContent = text;
    }
  }

  function setRecordingUi(recording) {
    state.recording = recording;
    els.recordButton?.classList.toggle("is-recording", recording);
    els.player?.classList.toggle("is-recording", recording);
    if (els.recordButtonLabel) {
      els.recordButtonLabel.textContent = recording ? "停止并评分" : "开始跟读";
    }
    if (els.meter) {
      els.meter.hidden = !recording;
    }
    if (els.stopRecord) {
      els.stopRecord.disabled = !recording;
    }
    if (els.recordButton) {
      els.recordButton.disabled = false;
    }
  }

  // 语音识别支持与否只探测一次，避免每次渲染都新建识别实例。
  let recognizerSupportCache = null;

  function recognizerSupported() {
    if (recognizerSupportCache === null) {
      recognizerSupportCache = Boolean(study?.createRecognizer?.({})?.supported);
    }
    return recognizerSupportCache;
  }

  function recordTargetSeconds(item) {
    if (!item) {
      return 6;
    }
    if (item.mode === "audio") {
      return Math.min(Math.max((item.end - item.start) * 1.8, 4), 22);
    }
    const words = study.tokenize(item.text).length;
    return Math.min(Math.max(words * 0.42 + 2.5, 4), 22);
  }

  function updateRecordTimer() {
    const elapsed = (Date.now() - state.recordStartedAt) / 1000;
    if (els.recordTimer) {
      els.recordTimer.textContent = study.formatTime(elapsed);
    }
    if (els.meterBar) {
      const ratio = state.recordTarget ? Math.min(elapsed / state.recordTarget, 1) : 0;
      els.meterBar.style.width = `${Math.round(ratio * 100)}%`;
    }
    if (els.meterText) {
      const left = Math.max(state.recordTarget - elapsed, 0);
      els.meterText.textContent = `录音中 · 还有 ${left.toFixed(1)} 秒`;
    }
  }

  function clearRecordTimers() {
    window.clearInterval(state.recordTimerId);
    window.clearTimeout(state.recordLimitId);
    state.recordTimerId = 0;
    state.recordLimitId = 0;
  }

  /** 录一句：返回 { blob, transcript, supported }。 */
  async function recordOnce() {
    const item = currentItem();
    if (!item) {
      return null;
    }
    state.recorder = study.createRecorder();
    if (!state.recorder.supported) {
      showToast("这台浏览器不支持录音，请用 Chrome 或 Edge 打开");
      return { unsupported: true };
    }
    state.lastTranscript = "";
    state.recognizer = study.createRecognizer({
      onResult: ({ final, interim }) => {
        state.lastTranscript = `${final} ${interim}`.trim();
      },
      onError: (code) => {
        if (code && code !== "no-speech" && code !== "aborted") {
          setRecordStatus(`识别中断（${code}）`);
        }
      },
    });
    try {
      await state.recorder.start();
    } catch (error) {
      showToast(error?.message || "拿不到麦克风权限");
      setRecordStatus("麦克风不可用");
      return { unsupported: true };
    }
    state.recognizer.start();
    state.recordStartedAt = Date.now();
    state.recordTarget = recordTargetSeconds(item);
    clearRecordTimers();
    state.recordTimerId = window.setInterval(updateRecordTimer, 120);
    state.recordLimitId = window.setTimeout(() => {
      if (state.recording) {
        stopRecording({ auto: true });
      }
    }, state.recordTarget * 1000);
    updateRecordTimer();
    setRecordingUi(true);
    setRecordStatus("录音中，读完会自动停");

    return new Promise((resolve) => {
      state.pendingResolve = resolve;
    });
  }

  function stopRecording(options = {}) {
    if (!state.recording) {
      return;
    }
    clearRecordTimers();
    setRecordingUi(false);
    setRecordStatus(options.auto ? "时间到，正在评分" : "正在评分");
    state.recognizer?.stop();
    const recognizer = state.recognizer;
    const recorder = state.recorder;
    const resolve = state.pendingResolve;
    state.pendingResolve = null;

    const finish = async () => {
      const blob = await recorder.stop();
      if (blob) {
        const item = currentItem();
        if (item) {
          const previous = state.audioUrls.get(item.id);
          if (previous) {
            URL.revokeObjectURL(previous);
          }
          state.audioUrls.set(item.id, URL.createObjectURL(blob));
        }
      }
      return { blob, transcript: state.lastTranscript };
    };
    // 语音识别收尾通常比录音慢半拍，等一小会儿再取最终文本。
    const recognitionDone = new Promise((done) => {
      if (!recognizer?.supported) {
        done();
        return;
      }
      window.setTimeout(done, options.auto ? 1800 : 1200);
    });
    Promise.all([finish(), recognitionDone]).then(([result]) => {
      resolve?.(result);
    });
  }

  function scoreRecording(transcript) {
    const item = currentItem();
    if (!item) {
      return null;
    }
    const text = String(transcript || "").trim();
    const bucket = (state.records[setKey()] = state.records[setKey()] || {});
    if (!text) {
      bucket[item.id] = { percent: null, transcript: "", at: Date.now() };
      study.writeStore(RECORD_KEY, state.records);
      renderResult(bucket[item.id], true);
      updateBadge(state.cursor, bucket[item.id]);
      renderStats();
      return null;
    }
    const score = study.scoreText(text, item.text);
    bucket[item.id] = {
      percent: score.percent,
      transcript: text,
      diff: score.diff,
      at: Date.now(),
    };
    study.writeStore(RECORD_KEY, state.records);
    renderResult(bucket[item.id], true);
    updateBadge(state.cursor, bucket[item.id]);
    renderStats();
    return score;
  }

  function updateBadge(index, record) {
    const node = els.list?.querySelector(`.shadow-line[data-index="${index}"] .shadow-line-badge`);
    if (!node) {
      return;
    }
    const badge = badgeFor(record);
    node.textContent = badge.text;
    node.dataset.state = badge.kind;
  }

  /** 听自己的录音。 */
  function playMyRecording() {
    const item = currentItem();
    const url = state.audioUrls.get(item?.id);
    if (!url) {
      showToast("这一句还没有录音");
      return;
    }
    stopPlayback();
    const audio = new Audio(url);
    audio.dataset.speechLabel = "我的跟读";
    audio.hidden = true;
    document.body.append(audio);
    audio.addEventListener("ended", () => audio.remove(), { once: true });
    audio.play().catch(() => showToast("浏览器阻止了播放，请再点一次"));
  }

  function releaseAudioUrls() {
    state.audioUrls.forEach((url) => URL.revokeObjectURL(url));
    state.audioUrls.clear();
    state.lastTranscript = "";
    if (els.playRecord) {
      els.playRecord.disabled = true;
    }
    if (els.scoreButton) {
      els.scoreButton.disabled = true;
    }
  }

  /* --------------------------------------------------------- 连续跟读 */

  function setContinuousUi(active) {
    if (els.continuousButton) {
      els.continuousButton.textContent = active ? "停止连续跟读" : "开始连续跟读";
      els.continuousButton.classList.toggle("is-playing", active);
      els.continuousButton.classList.toggle("is-primary", !active);
    }
  }

  async function runContinuous() {
    if (!state.items.length) {
      showToast("先选一份素材");
      return;
    }
    if (!recognizerSupported()) {
      showToast("这台浏览器没有语音识别，连续跟读仍可录音，但没有分数");
    }
    state.runToken += 1;
    state.continuous = true;
    setContinuousUi(true);

    while (state.continuous && state.cursor < state.items.length) {
      setRecordStatus("播放原音");
      const played = await playOriginal();
      if (!state.continuous || !played) {
        break;
      }
      for (let count = PREPARE_SECONDS; count > 0; count -= 1) {
        setRecordStatus(`准备跟读… ${count}`);
        if (els.meterText) {
          els.meterText.textContent = `准备跟读，${count} 秒后开始录音`;
        }
        await wait(1000);
        if (!state.continuous) {
          break;
        }
      }
      if (!state.continuous) {
        break;
      }
      const result = await recordOnce();
      if (!state.continuous) {
        break;
      }
      if (!result || result.unsupported) {
        state.continuous = false;
        break;
      }
      scoreRecording(result.transcript);
      setRecordStatus("本句完成");
      await wait(1100);
      if (!state.continuous) {
        break;
      }
      if (!moveCursor(1)) {
        setRecordStatus("整份练完了");
        showToast("这一份已经跟读完，可以换一份或回到第一句");
        break;
      }
    }
    state.continuous = false;
    setContinuousUi(false);
    if (!state.recording) {
      setRecordStatus("待机");
    }
  }

  function stopContinuous(options = {}) {
    if (!state.continuous && !state.recording) {
      return;
    }
    state.continuous = false;
    state.runToken += 1;
    if (state.recording) {
      stopRecording({ auto: false });
    }
    stopPlayback();
    setContinuousUi(false);
    setRecordStatus("已停止");
    if (!options.silent) {
      showToast("已停止连续跟读");
    }
  }

  /* ------------------------------------------------------------- 存储 */

  function clearRecords() {
    const key = setKey();
    if (!state.records[key]) {
      showToast("这一份还没有跟读记录");
      return;
    }
    if (!window.confirm("清空这一份的跟读评分？（录音本来就不保存，笔记也保留）")) {
      return;
    }
    delete state.records[key];
    study.writeStore(RECORD_KEY, state.records);
    releaseAudioUrls();
    renderList();
    syncCursor();
    showToast("已清空本次跟读评分");
  }

  function saveNote() {
    const item = currentItem();
    if (!item || !els.noteInput) {
      return;
    }
    const key = `${setKey()}:${item.id}`;
    const value = els.noteInput.value.trim();
    if (value) {
      state.notes[key] = value;
    } else {
      delete state.notes[key];
    }
    study.writeStore(NOTE_KEY, state.notes);
  }

  function savePrefs() {
    study.writeStore(PREFS_KEY, {
      source: state.source,
      setId: state.setId,
      rate: state.rate,
    });
  }

  function restorePrefs() {
    const prefs = study?.readStore(PREFS_KEY, null);
    if (!prefs) {
      return;
    }
    if (prefs.source === "movie" || prefs.source === "cet6") {
      state.source = prefs.source;
    }
    if (Number(prefs.rate) > 0) {
      state.rate = Number(prefs.rate);
    }
    state.prefSetId = prefs.setId || "";
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
      if (event.target.closest("[data-retry]")) {
        loadSet(state.source, state.setId);
        return;
      }
      const line = event.target.closest(".shadow-line");
      if (!line) {
        return;
      }
      const index = Number(line.dataset.index);
      if (!Number.isFinite(index)) {
        return;
      }
      state.cursor = index;
      syncCursor();
      playOriginal();
    });

    els.play?.addEventListener("click", togglePlay);
    els.slow?.addEventListener("click", () => playOriginal({ rate: 0.7 }));
    els.replay?.addEventListener("click", () => playOriginal());
    els.prev?.addEventListener("click", () => moveCursor(-1, { autoplay: true }));
    els.next?.addEventListener("click", () => moveCursor(1, { autoplay: true }));
    els.loop?.addEventListener("change", () => {
      state.loop = Boolean(els.loop.checked);
    });

    els.recordButton?.addEventListener("click", async () => {
      if (state.recording) {
        stopRecording();
        return;
      }
      stopPlayback();
      const result = await recordOnce();
      if (result && !result.unsupported) {
        scoreRecording(result.transcript);
      }
    });
    els.stopRecord?.addEventListener("click", () => stopRecording());
    els.playRecord?.addEventListener("click", playMyRecording);
    els.scoreButton?.addEventListener("click", () => {
      if (!state.lastTranscript) {
        showToast("这次录音没有识别文本，重新录一遍吧");
        return;
      }
      scoreRecording(state.lastTranscript);
    });

    els.continuousButton?.addEventListener("click", () => {
      if (state.continuous) {
        stopContinuous();
      } else {
        runContinuous();
      }
    });
    els.clearButton?.addEventListener("click", clearRecords);
    els.micCheck?.addEventListener("click", async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        showToast("麦克风可用，可以开始跟读");
      } catch (error) {
        showToast(
          error?.name === "NotAllowedError"
            ? "麦克风权限被拒绝，请在浏览器地址栏右侧放行"
            : "拿不到麦克风，检查一下设备",
        );
      }
    });

    els.noteInput?.addEventListener("change", saveNote);
    els.noteInput?.addEventListener("blur", saveNote);

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
      "beforeunload",
      () => {
        state.audioUrls.forEach((url) => URL.revokeObjectURL(url));
      },
      { passive: true },
    );

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

  /* --------------------------------------------------------------- 启动 */

  async function init() {
    if (!study) {
      setHtml(
        els.list,
        `<div class="error-state">
           <strong>跟读模块没能启动</strong>
           <span>缺少 study-core.js，请刷新页面重试。</span>
         </div>`,
      );
      return;
    }
    bindEvents();
    restorePrefs();
    if (els.sourceSelect) {
      els.sourceSelect.value = state.source;
    }
    syncRateButtons();
    await refreshSets({ preferId: state.prefSetId });
    renderStats();
  }

  init();
})();
