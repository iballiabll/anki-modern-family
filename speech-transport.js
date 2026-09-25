/**
 * 朗读 / 原声的统一播放控制条。
 *
 * 站内带朗读的页面（台词精读、真题精读、外刊、四级、六级、复习）原本各写一套
 * speechSynthesis 调用：能开始、能停止，但没有暂停和重播，长句还会因为
 * 停顿与重复 speak 而断成一段段。
 *
 * 这里把播放收敛成一条通道：
 *   1. speakSequence() 一次把整段排队交给浏览器，浏览器自己首尾相接播完，
 *      中间不再插入 setTimeout 间隔，听感上就是连贯的一整段；
 *   2. 同时接管原生 speechSynthesis.speak()，老模块不改代码也能拿到
 *      暂停 / 继续 / 重播 / 停止；
 *   3. <audio> 原声播放（美剧精灵音频、听力材料）同样被记录，
 *      暂停与重播按句生效，不会串到下一句。
 */
(function () {
  "use strict";

  if (window.IballSpeech) {
    return;
  }

  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  const supportsSpeech = Boolean(
    synth && typeof window.SpeechSynthesisUtterance === "function",
  );

  const state = {
    mode: "idle", // idle | speech | audio
    label: "",
    items: [],
    index: 0,
    token: 0,
    paused: false,
    selfPaused: false,
    dismissed: false,
    legacyPending: 0,
    fallbackIndex: -1,
    audio: null,
    audioStart: 0,
    hideTimer: 0,
    resumeTimer: 0,
  };

  /* ------------------------------------------------------------ 控制条 UI */

  const ICONS = {
    pause:
      '<path d="M14 4h-4v16h4z"/><path d="M10 4H6v16h4z"/>',
    play: '<path d="M6 3.5 20 12 6 20.5z"/>',
    replay:
      '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  function icon(name) {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round">' +
      ICONS[name] +
      "</svg>"
    );
  }

  let ui = null;

  function buildUi() {
    if (ui) {
      return ui;
    }
    const bar = document.createElement("div");
    bar.className = "speech-transport";
    bar.hidden = true;
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "朗读控制");
    bar.innerHTML =
      '<span class="speech-transport-dot" aria-hidden="true"></span>' +
      '<span class="speech-transport-label"></span>' +
      '<span class="speech-transport-actions">' +
      `<button class="speech-transport-button" type="button" data-speech-action="toggle" title="暂停" aria-label="暂停">${icon("pause")}</button>` +
      `<button class="speech-transport-button" type="button" data-speech-action="replay" title="重播当前" aria-label="重播当前">${icon("replay")}</button>` +
      `<button class="speech-transport-button" type="button" data-speech-action="stop" title="停止" aria-label="停止">${icon("stop")}</button>` +
      `<button class="speech-transport-button is-ghost" type="button" data-speech-action="hide" title="收起控制条" aria-label="收起控制条">${icon("close")}</button>` +
      "</span>";

    bar.addEventListener("click", (event) => {
      const button = event.target.closest("[data-speech-action]");
      if (!button) {
        return;
      }
      const action = button.dataset.speechAction;
      if (action === "toggle") {
        toggle();
      } else if (action === "replay") {
        replay();
      } else if (action === "stop") {
        stop();
      } else if (action === "hide") {
        dismiss();
      }
    });

    document.body.append(bar);
    ui = {
      bar,
      label: bar.querySelector(".speech-transport-label"),
      toggle: bar.querySelector('[data-speech-action="toggle"]'),
    };
    return ui;
  }

  function dismiss() {
    if (!ui) {
      return;
    }
    ui.bar.hidden = true;
    state.dismissed = true;
  }

  function setToggleIcon(paused) {
    const view = buildUi();
    view.toggle.innerHTML = icon(paused ? "play" : "pause");
    const label = paused ? "继续" : "暂停";
    view.toggle.title = label;
    view.toggle.setAttribute("aria-label", label);
    view.toggle.classList.toggle("is-paused", paused);
  }

  function statusText() {
    if (state.mode === "audio") {
      return state.label ? `${state.label} · 原声` : "原声播放中";
    }
    const total = state.items.length;
    if (total > 1) {
      return `${state.label || "朗读"} · 第 ${Math.min(state.index + 1, total)}/${total} 句`;
    }
    return state.label || "朗读中";
  }

  function render() {
    if (state.mode === "idle") {
      if (ui) {
        ui.bar.hidden = true;
      }
      return;
    }
    const view = buildUi();
    if (state.dismissed) {
      view.bar.hidden = true;
    } else {
      view.bar.hidden = false;
    }
    view.label.textContent = (state.paused ? "已暂停 · " : "") + statusText();
    view.bar.classList.toggle("is-paused", state.paused);
    setToggleIcon(state.paused);
  }

  function scheduleHide(delay = 1200) {
    window.clearTimeout(state.hideTimer);
    state.hideTimer = window.setTimeout(() => {
      if (state.mode === "idle" && ui) {
        ui.bar.hidden = true;
      }
    }, delay);
  }

  /* -------------------------------------------------------------- 朗读内核 */

  function splitChunks(text, maxLength = 180) {
    const source = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!source) {
      return [];
    }
    if (source.length <= maxLength) {
      return [source];
    }
    const sentences = source.match(/[^.!?;:]+[.!?;:]?/g) || [source];
    const chunks = [];
    let buffer = "";
    sentences.forEach((sentence) => {
      const piece = sentence.trim();
      if (!piece) {
        return;
      }
      if (!buffer) {
        buffer = piece;
        return;
      }
      if ((buffer + " " + piece).length <= maxLength) {
        buffer += " " + piece;
        return;
      }
      chunks.push(buffer);
      buffer = piece;
    });
    if (buffer) {
      chunks.push(buffer);
    }
    return chunks;
  }

  function preferredVoice() {
    const voices = Array.from(synth?.getVoices?.() || []);
    if (!voices.length) {
      return null;
    }
    return (
      voices.find((voice) => /^en-US$/i.test(voice.lang)) ||
      voices.find((voice) => /^en[-_]/i.test(voice.lang)) ||
      voices.find((voice) => /english/i.test(voice.name)) ||
      null
    );
  }

  function normalizeItems(input) {
    const list = Array.isArray(input) ? input : [input];
    const items = [];
    list.forEach((entry) => {
      if (entry === null || entry === undefined) {
        return;
      }
      if (typeof entry === "string") {
        items.push({ text: entry });
        return;
      }
      if (entry.text) {
        items.push(entry);
      }
    });
    return items
      .map((entry) => ({ ...entry, text: String(entry.text).trim() }))
      .filter((entry) => entry.text);
  }

  function cancelSpeech() {
    if (!synth) {
      return;
    }
    // 部分 Windows 语音在 cancel() 之后仍会念完当前句，先 pause 再 cancel
    // 才能真正静音；resume() 用来把引擎从 paused 状态复位。
    try {
      synth.pause();
      synth.cancel();
      synth.resume();
    } catch {
      synth.cancel();
    }
  }

  function finish(message, options) {
    state.mode = "idle";
    state.paused = false;
    state.selfPaused = false;
    state.items = [];
    state.index = 0;
    state.audio = null;
    state.legacyPending = 0;
    if (message) {
      status = message;
    }
    render();
    scheduleHide();
    if (options?.onFinish) {
      try {
        options.onFinish(message);
      } catch (error) {
        console.error("[speech] finish callback failed", error);
      }
    }
  }

  let finishCallback = null;
  let status = "";

  function complete(message, token, options) {
    if (token !== undefined && token !== state.token) {
      return;
    }
    finish(message, options);
  }

  /**
   * 排队朗读。整段一次性丢给浏览器，句子之间不再插延时，
   * 依赖 utterance 的 onstart/onend 驱动高亮与进度。
   */
  function speakSequence(input, options = {}) {
    const items = normalizeItems(input);
    if (!supportsSpeech) {
      options.onUnsupported?.();
      return false;
    }
    if (!items.length) {
      return false;
    }

    stop({ silent: true });
    const token = state.token;
    const rate = Number(options.rate) > 0 ? Number(options.rate) : 0.9;
    const voice = options.voice || preferredVoice();
    state.mode = "speech";
    state.dismissed = false;
    state.label = options.label || "朗读";
    state.items = items;
    state.index = 0;
    state.paused = false;
    state.selfPaused = false;
    state.fallbackIndex = -1;
    state.legacyPending = 0;
    finishCallback = options.onFinish || null;
    render();

    let delivered = 0;
    items.forEach((item, index) => {
      splitChunks(item.text).forEach((chunk, chunkIndex) => {
        const utterance = new window.SpeechSynthesisUtterance(chunk);
        utterance.lang = item.lang || voice?.lang || "en-US";
        if (voice) {
          utterance.voice = voice;
        }
        utterance.rate = Number(item.rate) > 0 ? Number(item.rate) : rate;
        utterance.pitch = 1;
        const isFirstChunk = chunkIndex === 0;
        utterance.onstart = () => {
          if (token !== state.token) {
            return;
          }
          state.index = index;
          state.paused = false;
          render();
          if (isFirstChunk) {
            item.onStart?.();
          }
        };
        utterance.onend = () => {
          if (token !== state.token) {
            return;
          }
          delivered += 1;
          if (isFirstChunk) {
            item.onEnd?.();
          }
          if (delivered >= items.length && state.mode === "speech") {
            complete("", token, options);
          }
        };
        utterance.onerror = (event) => {
          const reason = event?.error || "speech-error";
          if (reason === "canceled" || reason === "interrupted") {
            return;
          }
          if (token !== state.token) {
            return;
          }
          options.onError?.(reason);
          complete("", token, options);
        };
        synth.speak(utterance);
      });
    });
    return true;
  }

  /* ------------------------------------------------------------ 暂停 / 继续 */

  function pause() {
    if (state.mode === "audio") {
      if (state.audio && !state.audio.paused) {
        state.selfPaused = true;
        state.audio.pause();
        state.paused = true;
        render();
      }
      return;
    }
    if (state.mode !== "speech" || !synth) {
      return;
    }
    synth.pause();
    state.paused = true;
    state.selfPaused = true;
    render();
    const token = state.token;
    // Chrome 对超长 utterance 的 pause() 偶发无效，400ms 后确认一次，
    // 真没停就从当前句重放，避免"暂停了却还在念"的错觉。
    window.clearTimeout(state.resumeTimer);
    state.resumeTimer = window.setTimeout(() => {
      if (token !== state.token || state.mode !== "speech") {
        return;
      }
      if (synth.paused || !synth.speaking) {
        return;
      }
      state.fallbackIndex = state.index;
      cancelSpeech();
      state.paused = true;
      render();
    }, 400);
  }

  function resume() {
    if (state.mode === "audio") {
      if (state.audio) {
        state.audio.play().catch(() => {});
      }
      state.paused = false;
      state.selfPaused = false;
      render();
      return;
    }
    if (state.mode !== "speech") {
      return;
    }
    window.clearTimeout(state.resumeTimer);
    if (state.fallbackIndex >= 0) {
      const index = state.fallbackIndex;
      state.fallbackIndex = -1;
      state.paused = false;
      const rest = state.items.slice(index);
      const options = { label: state.label, onFinish: finishCallback };
      speakSequence(rest, options);
      return;
    }
    synth?.resume();
    state.paused = false;
    state.selfPaused = false;
    render();
  }

  function toggle() {
    if (state.mode === "idle") {
      return;
    }
    if (state.paused) {
      resume();
    } else {
      pause();
    }
  }

  function replay() {
    if (state.mode === "audio") {
      const audio = state.audio;
      if (!audio) {
        return;
      }
      try {
        audio.currentTime = Math.max(0, state.audioStart || 0);
      } catch {
        // 元数据没就绪时浏览器会忽略这次跳转，继续播放即可。
      }
      audio.play().catch(() => {});
      state.paused = false;
      state.selfPaused = false;
      render();
      return;
    }
    if (state.mode !== "speech") {
      return;
    }
    const items = state.items.length ? state.items : state.legacyItem ? [state.legacyItem] : [];
    if (!items.length) {
      return;
    }
    const current = Math.min(state.index, items.length - 1);
    const label = state.label;
    const options = { label, onFinish: finishCallback };
    if (items.length === 1) {
      speakSequence(items, options);
      return;
    }
    // 多句时"重播当前"重放当前一句并继续往下播，避免每次跳回开头。
    speakSequence(items.slice(current), options);
  }

  function stop(localOptions = {}) {
    const wasActive = state.mode !== "idle";
    const callback = finishCallback;
    state.token += 1;
    state.dismissed = false;
    finishCallback = null;
    window.clearTimeout(state.resumeTimer);
    window.clearTimeout(state.hideTimer);
    if (synth) {
      cancelSpeech();
    }
    if (state.audio) {
      try {
        state.audio.pause();
      } catch {
        // 元素已销毁时忽略
      }
    }
    state.mode = "idle";
    state.paused = false;
    state.selfPaused = false;
    state.items = [];
    state.index = 0;
    state.fallbackIndex = -1;
    state.legacyItem = null;
    state.legacyPending = 0;
    if (ui) {
      ui.bar.hidden = true;
    }
    if (callback && !localOptions.silent) {
      try {
        callback(localOptions.reason || "已停止播放");
      } catch (error) {
        console.error("[speech] stop callback failed", error);
      }
    }
    if (!localOptions.silent && wasActive) {
      render();
      scheduleHide(600);
    }
    return wasActive;
  }

  /* ------------------------------------------------- 兼容老模块的直接调用 */

  if (synth) {
    const nativeSpeak = synth.speak.bind(synth);
    const nativeCancel = synth.cancel.bind(synth);

    synth.speak = function patchedSpeak(utterance) {
      if (utterance && utterance.text) {
        state.legacyItem = {
          text: String(utterance.text),
          rate: utterance.rate,
          lang: utterance.lang,
        };
        if (state.mode === "idle") {
          state.mode = "speech";
          state.dismissed = false;
          state.label = "朗读";
          state.items = [state.legacyItem];
          state.index = 0;
          state.paused = false;
          state.token += 1;
          finishCallback = null;
          state.legacyPending = 0;
          render();
        }
        const token = state.token;
        state.legacyPending += 1;
        const settle = () => {
          if (token !== state.token) {
            return;
          }
          state.legacyPending = Math.max(0, state.legacyPending - 1);
          if (state.legacyPending === 0 && state.mode === "speech") {
            complete("", token);
          }
        };
        utterance.addEventListener?.("end", settle);
        utterance.addEventListener?.("error", (event) => {
          if (event?.error === "canceled" || event?.error === "interrupted") {
            if (token === state.token) {
              state.legacyPending = Math.max(0, state.legacyPending - 1);
            }
            return;
          }
          settle();
        });
      }
      return nativeSpeak(utterance);
    };

    synth.cancel = function patchedCancel() {
      const result = nativeCancel();
      if (state.mode === "speech") {
        state.mode = "idle";
        state.paused = false;
        state.selfPaused = false;
        state.items = [];
        state.legacyPending = 0;
        if (ui) {
          ui.bar.hidden = true;
        }
      }
      return result;
    };
  }

  /* ------------------------------------------------------------ 原声 <audio> */

  function watchMedia(event) {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement)) {
      return;
    }
    if (event.type === "play") {
      if (state.audio !== media) {
        state.audioStart = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      }
      state.mode = "audio";
      state.dismissed = false;
      state.audio = media;
      state.paused = false;
      state.selfPaused = false;
      state.label = media.dataset.speechLabel || media.getAttribute("title") || "音频";
      render();
      return;
    }
    if (event.type === "seeked") {
      if (state.audio !== media) {
        return;
      }
      // 美剧精灵音频每句都要跳一次播放头，跳转点就是这一句的重播起点。
      state.audioStart = Number.isFinite(media.currentTime) ? media.currentTime : 0;
      return;
    }
    if (event.type === "ended") {
      if (state.audio === media) {
        finish();
      }
      return;
    }
    if (event.type === "pause") {
      if (state.audio !== media || state.selfPaused) {
        return;
      }
      // 模块自己的停止按钮同样会触发 pause：那不是"暂停中"，是播完了。
      state.mode = "idle";
      state.audio = null;
      state.paused = false;
      render();
      scheduleHide(600);
    }
  }

  ["play", "pause", "ended", "seeked"].forEach((type) => {
    document.addEventListener(type, watchMedia, true);
  });

  window.addEventListener("beforeunload", () => {
    try {
      synth?.cancel();
    } catch {
      // 浏览器卸载阶段忽略
    }
  });

  window.IballSpeech = {
    speakSequence,
    speak: (text, options) => speakSequence([{ text }], options),
    pause,
    resume,
    toggle,
    replay,
    stop: () => stop(),
    isActive: () => state.mode !== "idle",
    isPaused: () => state.paused,
    setLabel: (label) => {
      state.label = label;
      render();
    },
    splitChunks,
    supportsSpeech: () => supportsSpeech,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (state.mode !== "idle") {
        render();
      }
    });
  }
})();
