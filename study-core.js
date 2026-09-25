/**
 * 听句 / 跟读两个模块共用的底层能力。
 *
 * 这里只做三件事，避免两个页面各写一套：
 *   1. 精灵原声播放：整集台词拼成一个 mp3，按 [start, end] 播放某一句，
 *      用逐帧 + 定时器双保险在句尾精确收声，绝不把下一句带出来；
 *   2. 朗读：统一走 IballSpeech（整段排队，带暂停 / 重播控制条）；
 *   3. 评分与存储：词级对齐打分（Levenshtein 对齐 + 错词定位）、
 *      录音（MediaRecorder）与语音识别（Web Speech API）的兼容包装、
 *      localStorage 读写。
 */
(function () {
  "use strict";

  if (window.IballStudy) {
    return;
  }

  /* --------------------------------------------------------------- 文本处理 */

  const CONTRACTIONS = [
    ["can't", "cannot"],
    ["won't", "will not"],
    ["n't", " not"],
    ["'re", " are"],
    ["'ve", " have"],
    ["'ll", " will"],
    ["'d", " would"],
    ["'m", " am"],
  ];

  function normalizeText(text) {
    let value = String(text || "").toLowerCase();
    CONTRACTIONS.forEach(([from, to]) => {
      value = value.split(from).join(to);
    });
    return value
      .replace(/[^a-z0-9'\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(text) {
    const normalized = normalizeText(text);
    return normalized ? normalized.split(" ").filter(Boolean) : [];
  }

  function displayTokens(text) {
    return String(text || "")
      .replace(/[^\p{L}\p{N}'\-\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
  }

  /**
   * 词级对齐：把用户输入和参考文本做编辑距离对齐，得到
   *   accuracy  命中词 / 参考词（0-1）
   *   diff      逐词结果（miss / hit / extra），供高亮展示
   *   missing   漏掉的词，extras 多说的词
   */
  function scoreText(spoken, reference) {
    const expected = tokenize(reference);
    const actual = tokenize(spoken);
    const rows = expected.length + 1;
    const cols = actual.length + 1;
    const table = Array.from({ length: rows }, () => new Array(cols).fill(0));

    for (let i = 0; i < rows; i += 1) {
      table[i][0] = i;
    }
    for (let j = 0; j < cols; j += 1) {
      table[0][j] = j;
    }
    for (let i = 1; i < rows; i += 1) {
      for (let j = 1; j < cols; j += 1) {
        const cost = expected[i - 1] === actual[j - 1] ? 0 : 1;
        table[i][j] = Math.min(
          table[i - 1][j] + 1,
          table[i][j - 1] + 1,
          table[i - 1][j - 1] + cost,
        );
      }
    }

    const ops = [];
    let i = expected.length;
    let j = actual.length;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && table[i][j] === table[i - 1][j - 1] + (expected[i - 1] === actual[j - 1] ? 0 : 1)) {
        ops.push({
          type: expected[i - 1] === actual[j - 1] ? "hit" : "miss",
          expected: expected[i - 1],
          actual: actual[j - 1],
        });
        i -= 1;
        j -= 1;
      } else if (i > 0 && table[i][j] === table[i - 1][j] + 1) {
        ops.push({ type: "miss", expected: expected[i - 1], actual: "" });
        i -= 1;
      } else {
        ops.push({ type: "extra", expected: "", actual: actual[j - 1] });
        j -= 1;
      }
    }
    ops.reverse();

    const hits = ops.filter((op) => op.type === "hit").length;
    const accuracy = expected.length ? hits / expected.length : 0;
    const referenceWords = displayTokens(reference);
    const diff = ops.map((op) => {
      const index = expected.indexOf(op.expected);
      return {
        type: op.type,
        expected: op.expected,
        actual: op.actual,
        display:
          op.expected && referenceWords[index] ? referenceWords[index] : op.expected || op.actual,
      };
    });

    return {
      accuracy,
      percent: Math.round(accuracy * 100),
      diff,
      missing: diff.filter((item) => item.type === "miss").map((item) => item.expected),
      extras: diff.filter((item) => item.type === "extra").map((item) => item.actual),
      wordCount: expected.length,
    };
  }

  /* ------------------------------------------------------------ 精灵原声播放 */

  let media = null;
  let watcherFrame = 0;
  let watcherTimer = 0;
  let finishHandler = null;

  function clearWatcher() {
    if (watcherFrame) {
      cancelAnimationFrame(watcherFrame);
      watcherFrame = 0;
    }
    if (watcherTimer) {
      clearTimeout(watcherTimer);
      watcherTimer = 0;
    }
  }

  function getMedia() {
    if (!media) {
      media = document.createElement("audio");
      media.preload = "none";
      media.dataset.speechLabel = "原声";
      /*
       * 必须真正挂到文档里：控制条是用捕获阶段的 document 监听接住 play/pause 的，
       * 游离节点的事件不会走到 document，暂停和重播按钮就会失灵。
       */
      media.hidden = true;
      document.body.append(media);
    }
    return media;
  }

  function stopAudio() {
    clearWatcher();
    finishHandler = null;
    if (media && !media.paused) {
      media.pause();
    }
  }

  function playRange(options) {
    const start = Number(options.start);
    const end = Number(options.end);
    const sprite = String(options.sprite || "");
    if (!sprite || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return false;
    }
    const element = getMedia();
    clearWatcher();
    finishHandler = typeof options.onEnd === "function" ? options.onEnd : null;

    const begin = () => {
      element.playbackRate = Number(options.rate) > 0 ? Number(options.rate) : 1;
      element.dataset.speechLabel = options.label || "原声";
      try {
        element.currentTime = start;
      } catch {
        // 元数据还没就绪时忽略，canplay 分支会再来一次
      }
      const playResult = element.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {
          options.onError?.("浏览器阻止了自动播放，请再点一次");
        });
      }
      watch(start, end);
    };

    const applySource = () => {
      const current = element.getAttribute("src") || "";
      if (current.endsWith(sprite)) {
        begin();
        return;
      }
      element.src = sprite;
      element.addEventListener("loadedmetadata", begin, { once: true });
      element.load();
    };

    applySource();
    return true;
  }

  /** 逐帧盯住播放位置，再用定时器兜底（后台标签页里 rAF 会被挂起）。 */
  function watch(start, end) {
    const element = media;
    const finish = () => {
      clearWatcher();
      if (!element) {
        return;
      }
      element.pause();
      const handler = finishHandler;
      finishHandler = null;
      handler?.();
    };

    const tick = () => {
      watcherFrame = 0;
      if (!element) {
        return;
      }
      if (element.currentTime >= end - 0.02) {
        finish();
        return;
      }
      if (element.currentTime < start - 0.35) {
        element.currentTime = start;
      }
      watcherFrame = requestAnimationFrame(tick);
    };
    watcherFrame = requestAnimationFrame(tick);

    const guard = () => {
      watcherTimer = 0;
      if (!element) {
        return;
      }
      const remaining = end - element.currentTime;
      if (remaining <= 0.15) {
        finish();
        return;
      }
      watcherTimer = setTimeout(guard, Math.min(Math.max(remaining * 1000, 80), 400));
    };
    watcherTimer = setTimeout(
      guard,
      Math.min(Math.max((end - start) * 1000, 80), 400),
    );
  }

  /* ---------------------------------------------------------------- 朗读 */

  function speak(text, options = {}) {
    const items = (Array.isArray(text) ? text : [text])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (!items.length) {
      return false;
    }
    if (window.IballSpeech?.speakSequence) {
      return window.IballSpeech.speakSequence(items, {
        label: options.label || "朗读",
        rate: Number(options.rate) > 0 ? Number(options.rate) : 0.92,
        onFinish: options.onFinish,
        onUnsupported: options.onUnsupported,
      });
    }
    if (!("speechSynthesis" in window)) {
      options.onUnsupported?.();
      return false;
    }
    items.forEach((item) => {
      const utterance = new SpeechSynthesisUtterance(item);
      utterance.lang = "en-US";
      utterance.rate = Number(options.rate) > 0 ? Number(options.rate) : 0.92;
      window.speechSynthesis.speak(utterance);
    });
    return true;
  }

  function stopSpeech() {
    if (window.IballSpeech?.stop) {
      window.IballSpeech.stop();
      return;
    }
    window.speechSynthesis?.cancel?.();
  }

  /* ------------------------------------------------------------ 录音 / 识别 */

  function createRecorder() {
    const supported = Boolean(
      navigator.mediaDevices?.getUserMedia && window.MediaRecorder,
    );
    let stream = null;
    let recorder = null;
    let chunks = [];
    let resolveStop = null;

    return {
      supported,
      async start() {
        if (!supported) {
          throw new Error("当前浏览器不支持录音，请用 Chrome 或 Edge 打开");
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size) {
            chunks.push(event.data);
          }
        });
        recorder.addEventListener("stop", () => {
          const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
          stream?.getTracks().forEach((track) => track.stop());
          stream = null;
          resolveStop?.(blob);
          resolveStop = null;
        });
        recorder.start();
      },
      stop() {
        return new Promise((resolve) => {
          if (!recorder || recorder.state === "inactive") {
            resolve(null);
            return;
          }
          resolveStop = resolve;
          recorder.stop();
        });
      },
      cancel() {
        try {
          recorder?.state !== "inactive" && recorder?.stop();
        } catch {
          // 忽略
        }
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
      },
    };
  }

  function createRecognizer(options = {}) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      return { supported: false, start() {}, stop() {}, abort() {} };
    }
    const recognition = new Ctor();
    recognition.lang = options.lang || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    let finalText = "";
    recognition.addEventListener("result", (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript || "";
        if (result.isFinal) {
          finalText = `${finalText} ${transcript}`.trim();
        } else {
          interim = `${interim} ${transcript}`.trim();
        }
      }
      options.onResult?.({
        final: finalText,
        interim,
        confidence: event.results[event.results.length - 1]?.[0]?.confidence ?? 0,
      });
    });
    recognition.addEventListener("error", (event) => {
      options.onError?.(event?.error || "recognition-error");
    });
    recognition.addEventListener("end", () => options.onEnd?.());

    return {
      supported: true,
      start() {
        finalText = "";
        try {
          recognition.start();
        } catch {
          // 连续点击时浏览器会抛出，忽略即可
        }
      },
      stop() {
        try {
          recognition.stop();
        } catch {
          // 忽略
        }
      },
      abort() {
        try {
          recognition.abort();
        } catch {
          // 忽略
        }
      },
    };
  }

  /* ------------------------------------------------------------- 本地存储 */

  function readStore(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(value / 60);
    const rest = value % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ------------------------------------------------------------ 素材归一化 */

  const scriptPromises = new Map();

  /** 按需插一段脚本，同一个地址只加载一次。 */
  function loadScript(src) {
    if (scriptPromises.has(src)) {
      return scriptPromises.get(src);
    }
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.addEventListener("load", () => resolve(true));
      script.addEventListener("error", () => {
        scriptPromises.delete(src);
        reject(new Error(`脚本加载失败：${src}`));
      });
      document.head.append(script);
    });
    scriptPromises.set(src, promise);
    return promise;
  }

  function fetchJson(url, options = {}) {
    return fetch(url, { credentials: "same-origin", ...options }).then((response) => {
      if (!response.ok) {
        throw new Error(`数据加载失败（${response.status}）`);
      }
      return response.json();
    });
  }

  /** 太长的一段按句号切开，再按上限合并，避免一句要听 / 读 40 秒。 */
  function splitLongText(text, maxLength = 210) {
    const value = String(text || "").trim();
    if (value.length <= maxLength) {
      return value ? [value] : [];
    }
    const parts = value
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const merged = [];
    parts.forEach((part) => {
      const last = merged[merged.length - 1];
      if (last && last.length + part.length + 1 <= maxLength) {
        merged[merged.length - 1] = `${last} ${part}`;
      } else {
        merged.push(part);
      }
    });
    return merged.length ? merged : [value];
  }

  /** 六级听力正文带「W: / M:」说话人前缀，单独拆出来，不参与判分。 */
  function stripSpeaker(text) {
    const match = String(text || "").match(/^([A-Za-z]{1,2})\s*[:：]\s*/);
    return {
      speaker: match ? match[1].toUpperCase() : "",
      text: match ? String(text).slice(match[0].length) : String(text || ""),
    };
  }

  /**
   * 美剧素材（study-data/<集>.json）→ 逐句条目。
   * 译文按「所在整段」给出：中文译文本就是整段翻译，不假装是逐句译文。
   */
  function buildMovieItems(payload) {
    const segments = new Map(
      (payload.segments || []).map((segment) => [String(segment.id), segment]),
    );
    return (payload.lines || [])
      .map((line, index) => {
        const segment = segments.get(String(line.segmentId)) || {};
        const text = String(line.text || "").trim();
        if (!text) {
          return null;
        }
        return {
          index,
          id: String(line.id || `line-${index}`),
          text,
          zh: String(segment.translation || ""),
          zhLabel: "所在整段译文",
          scene: String(segment.sceneTitle || ""),
          keyPhrase: String(segment.keyPhrase || ""),
          phonetic: String(segment.phonetic || ""),
          meaning: String(segment.meaning || ""),
          grammarNotes: Array.isArray(segment.grammarNotes) ? segment.grammarNotes : [],
          mode: "audio",
          start: Number(line.start) || 0,
          end: Number(line.end) || 0,
          sprite: String(payload.sprite || ""),
        };
      })
      .filter(Boolean);
  }

  /** 六级听力素材（IBALL_CET6_LISTENING_LIBRARY）→ 逐句条目。 */
  function buildCet6Items(payload) {
    const items = [];
    (payload.pieces || []).forEach((piece) => {
      (piece.paragraphs || []).forEach((paragraph) => {
        const en = stripSpeaker(paragraph.english);
        const zhPart = stripSpeaker(paragraph.chinese);
        splitLongText(en.text).forEach((sentence, offset) => {
          const prefix = en.speaker ? `${en.speaker}: ` : "";
          items.push({
            index: items.length,
            id: `${piece.id}-${paragraph.number}-${offset + 1}`,
            text: `${prefix}${sentence}`,
            zh: zhPart.text,
            zhLabel: "本段译文",
            scene: `${piece.section} · ${piece.type}${piece.title ? ` · ${piece.title}` : ""}`,
            keyPhrase: "",
            phonetic: "",
            meaning: "",
            grammarNotes: [],
            mode: "speech",
            start: 0,
            end: 0,
            sprite: "",
          });
        });
      });
    });
    return items;
  }

  window.IballStudy = {
    normalizeText,
    tokenize,
    displayTokens,
    scoreText,
    playRange,
    stopAudio,
    speak,
    stopSpeech,
    createRecorder,
    createRecognizer,
    readStore,
    writeStore,
    formatTime,
    escapeHtml,
    loadScript,
    fetchJson,
    splitLongText,
    stripSpeaker,
    buildMovieItems,
    buildCet6Items,
  };
})();
