/**
 * 口语房间：像打电话那样跟一个真人聊天，不是考官问答。
 *
 * 三块拼起来：
 *   1. speaking-personas.js 提供人物与话题，speaking-engine.js 决定这一轮说什么；
 *   2. speech-transport.js 念对方的话（优先美音），study-core.js 的识别器把你的话转成文字；
 *   3. 记录写进 localStorage，account-store.js 会按账号分开存放，聊完用 buildRecap 出一份复盘。
 *
 * 接口地址、模型名和密钥只留在这台设备的 localStorage 里，只有选了「我的接口」并按下发送时，
 * 才会带着最近几轮对话去请求你自己填的那个地址。
 */
(function () {
  const PACK = window.IballSpeakingPersonas || null;
  const ENGINE = window.IballSpeakingEngine || null;
  const SPEECH = window.IballSpeech || null;
  const STUDY = window.IballStudy || null;

  const PERSONAS = Array.isArray(PACK?.personas) ? PACK.personas : [];
  const TOPICS = Array.isArray(PACK?.topics) ? PACK.topics : [];

  const THREADS_KEY = "iball-speaking-room-v1";
  const PREFS_KEY = "iball-speaking-room-prefs-v1";
  /** 主站口语练习台的接口设置，第一次进这个页面时拿它当默认值，省得重填一遍。 */
  const SITE_API_SETTINGS_KEY = "iball-listening-cabin-speaking-settings";
  const MAX_MESSAGES = 80;
  const API_TIMEOUT_MS = 45_000;
  const AVATAR_COLORS = [
    "#153c35",
    "#426d80",
    "#8a6a3f",
    "#7b4a55",
    "#3f6b53",
    "#5b5a86",
    "#a05a3c",
    "#3d5a51",
  ];

  const MODES = {
    local: {
      note: "本地陪聊：对方的话由这台设备现编，不联网，也不用填接口。",
      hint: "本地陪聊在浏览器里生成回复，不连网",
    },
    api: {
      note: "我的接口：每一轮都会带上这段对话去请求你自己填的地址，密钥不上传到本站。",
      hint: "回复由你自己的接口生成",
    },
    quiet: {
      note: "只看文本：不朗读，适合安静环境或者没戴耳机的时候。",
      hint: "不朗读，只看文字",
    },
  };

  /** data-state 只认 CSS 里写好的四个值，所以「结束」也归到 idle。 */
  const STATUS = {
    ready: { state: "idle", label: "还没开始" },
    idle: { state: "idle", label: "等你说话" },
    speaking: { state: "speaking", label: "对方在说" },
    listening: { state: "listening", label: "正在听你说" },
    thinking: { state: "thinking", label: "对方在想" },
    ended: { state: "idle", label: "通话结束" },
  };

  const els = {
    personaList: document.getElementById("personaList"),
    callAvatar: document.getElementById("callAvatar"),
    callName: document.getElementById("callName"),
    callMeta: document.getElementById("callMeta"),
    callStatus: document.getElementById("callStatus"),
    callTimer: document.getElementById("callTimer"),
    callLog: document.getElementById("callLog"),
    callEmpty: document.getElementById("callEmpty"),
    startButton: document.getElementById("speakingStartButton"),
    recapButton: document.getElementById("speakingRecapButton"),
    input: document.getElementById("speakingInput"),
    micButton: document.getElementById("speakingMicButton"),
    sendButton: document.getElementById("speakingSendButton"),
    composer: document.getElementById("composer"),
    composerHint: document.getElementById("composerHint"),
    topicButton: document.getElementById("speakingTopicButton"),
    replayButton: document.getElementById("speakingReplayButton"),
    modeGroup: document.getElementById("modeGroup"),
    modeNote: document.getElementById("modeNote"),
    settingsHint: document.getElementById("settingsHint"),
    topicSelect: document.getElementById("speakingTopic"),
    rateGroup: document.getElementById("rateGroup"),
    autoSpeak: document.getElementById("speakingAutoSpeak"),
    apiFields: document.getElementById("apiFields"),
    apiUrl: document.getElementById("speakingApiUrl"),
    apiModel: document.getElementById("speakingApiModel"),
    apiKey: document.getElementById("speakingApiKey"),
    apiAuth: document.getElementById("speakingApiAuth"),
    apiSaveButton: document.getElementById("speakingApiSaveButton"),
    apiStatus: document.getElementById("speakingApiStatus"),
    recapPanel: document.getElementById("speakingRecapPanel"),
    recapBody: document.getElementById("recapBody"),
    recapClose: document.getElementById("speakingRecapClose"),
    accountChip: document.getElementById("accountChip"),
    toast: document.getElementById("toast"),
  };

  const state = {
    personaId: PERSONAS[0]?.id || "",
    mode: "local",
    topicId: "",
    rate: 1,
    autoSpeak: true,
    showChinese: true,
    api: { url: "", model: "", key: "", auth: "bearer" },
    /** personaId -> { messages, engine, topicId, updatedAt } */
    threads: {},
    callActive: false,
    callStartedAt: 0,
    timerId: 0,
    pending: false,
    sending: false,
    recording: false,
    recognitionFailed: false,
    recognizer: null,
    lastLine: "",
  };

  /* ------------------------------------------------------------- 小工具 */

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

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  let toastTimer = 0;

  function showToast(message) {
    if (!els.toast || !message) {
      return;
    }
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
      () => els.toast.classList.remove("is-visible"),
      2600,
    );
  }

  function currentPersona() {
    return (
      PERSONAS.find((persona) => persona.id === state.personaId) || PERSONAS[0]
    );
  }

  /** 引擎状态和消息放在同一条 thread 里，一起落盘，刷新后能接着聊。 */
  function currentThread() {
    let thread = state.threads[state.personaId];
    if (!thread || typeof thread !== "object") {
      thread = {};
      state.threads[state.personaId] = thread;
    }
    if (!Array.isArray(thread.messages)) {
      thread.messages = [];
    }
    if (!thread.engine || typeof thread.engine !== "object") {
      thread.engine = { seed: Math.floor(Math.random() * 100000), turnCount: 0 };
    }
    return thread;
  }

  function persistThreads() {
    writeStore(THREADS_KEY, { version: 1, threads: state.threads });
  }

  function persistPrefs() {
    writeStore(PREFS_KEY, {
      version: 1,
      personaId: state.personaId,
      mode: state.mode,
      topicId: state.topicId,
      rate: state.rate,
      autoSpeak: state.autoSpeak,
      showChinese: state.showChinese,
      apiUrl: state.api.url,
      apiModel: state.api.model,
      apiKey: state.api.key,
      apiAuth: state.api.auth,
    });
  }

  function loadThreads() {
    const stored = readStore(THREADS_KEY, null);
    const raw = stored?.threads && typeof stored.threads === "object" ? stored.threads : {};
    const known = new Set(PERSONAS.map((persona) => persona.id));
    const threads = {};
    Object.entries(raw).forEach(([id, thread]) => {
      if (known.has(id) && thread && typeof thread === "object") {
        threads[id] = thread;
      }
    });
    state.threads = threads;
  }

  function loadPrefs() {
    const stored = readStore(PREFS_KEY, null);
    if (stored && typeof stored === "object") {
      if (PERSONAS.some((persona) => persona.id === stored.personaId)) {
        state.personaId = stored.personaId;
      }
      if (MODES[stored.mode]) {
        state.mode = stored.mode;
      }
      if (TOPICS.some((topic) => topic.id === stored.topicId)) {
        state.topicId = stored.topicId;
      }
      if (Number(stored.rate) > 0) {
        state.rate = Number(stored.rate);
      }
      state.autoSpeak = stored.autoSpeak !== false;
      state.showChinese = stored.showChinese !== false;
      if (typeof stored.apiUrl === "string") {
        state.api.url = stored.apiUrl.trim();
      }
      if (typeof stored.apiModel === "string") {
        state.api.model = stored.apiModel.trim();
      }
      if (typeof stored.apiKey === "string") {
        state.api.key = stored.apiKey.trim();
      }
      if (["bearer", "x-api-key", "none"].includes(stored.apiAuth)) {
        state.api.auth = stored.apiAuth;
      }
    }

    if (state.api.url || state.api.key) {
      return;
    }
    // 这个页面头一次打开时，把主站口语练习台里的接口设置搬过来。
    const site = readStore(SITE_API_SETTINGS_KEY, null);
    if (!site || typeof site !== "object") {
      return;
    }
    state.api.url = String(site.freeChatApiUrl || "").trim();
    state.api.model = String(site.freeChatApiModel || "").trim();
    state.api.key = String(site.freeChatApiKey || "").trim();
    if (["bearer", "x-api-key", "none"].includes(site.freeChatApiAuth)) {
      state.api.auth = site.freeChatApiAuth;
    }
  }

  /* ------------------------------------------------------------- 渲染 */

  function setStatus(key) {
    const entry = STATUS[key] || STATUS.idle;
    if (els.callStatus) {
      els.callStatus.dataset.state = entry.state;
      els.callStatus.textContent = entry.label;
    }
  }

  function setHint(text) {
    if (els.composerHint) {
      els.composerHint.textContent = text;
    }
  }

  function renderPersonas() {
    if (!els.personaList) {
      return;
    }
    els.personaList.textContent = "";
    PERSONAS.forEach((persona, index) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "persona-card";
      card.dataset.personaId = persona.id;
      card.setAttribute("role", "listitem");
      if (persona.id === state.personaId) {
        card.classList.add("is-active");
        card.setAttribute("aria-current", "true");
      }

      const top = document.createElement("span");
      top.className = "persona-card-top";
      const avatar = document.createElement("span");
      avatar.className = "persona-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = String(persona.name || "?").slice(0, 1);
      avatar.style.background = AVATAR_COLORS[index % AVATAR_COLORS.length];
      const name = document.createElement("span");
      name.className = "persona-name";
      const strong = document.createElement("strong");
      strong.textContent = persona.name || "Someone";
      const sub = document.createElement("span");
      sub.textContent = `${persona.city || ""}${persona.job ? ` · ${persona.job}` : ""}`;
      name.append(strong, sub);
      top.append(avatar, name);

      const tagline = document.createElement("p");
      tagline.className = "persona-tagline";
      tagline.textContent = persona.tagline || persona.summary || "";

      card.append(top, tagline);

      if (persona.summary) {
        const summary = document.createElement("p");
        summary.className = "persona-summary";
        summary.textContent = persona.summary;
        card.append(summary);
      }

      const count = Array.isArray(currentThreadMessages(persona.id))
        ? currentThreadMessages(persona.id).length
        : 0;
      if (persona.id === state.personaId && count > 0) {
        const badge = document.createElement("span");
        badge.className = "persona-badge";
        badge.textContent = `聊过 ${count} 句`;
        card.append(badge);
      }

      els.personaList.append(card);
    });
  }

  function currentThreadMessages(personaId) {
    return state.threads[personaId]?.messages || [];
  }

  function renderCallHeader() {
    const persona = currentPersona();
    if (!persona) {
      return;
    }
    if (els.callAvatar) {
      els.callAvatar.textContent = String(persona.name || "?").slice(0, 1);
    }
    if (els.callName) {
      els.callName.textContent = persona.name || "";
    }
    if (els.callMeta) {
      els.callMeta.textContent = [persona.city, persona.job]
        .filter(Boolean)
        .join(" · ");
    }
  }

  function buildMessageNode(message) {
    const row = document.createElement("div");
    row.className = `call-message is-${message.role === "user" ? "user" : "partner"}`;

    const bubble = document.createElement("div");
    bubble.className = "call-bubble";
    bubble.textContent = message.english;
    row.append(bubble);

    if (message.chinese) {
      const zh = document.createElement("div");
      zh.className = "call-zh";
      zh.textContent = message.chinese;
      zh.hidden = !state.showChinese;
      row.append(zh);
    }

    const tools = document.createElement("div");
    tools.className = "call-tools";

    if (message.role === "partner") {
      const replay = document.createElement("button");
      replay.type = "button";
      replay.className = "call-tool";
      replay.textContent = "重听";
      replay.title = "再念一遍这一句";
      replay.addEventListener("click", () => speakNow(message.english));
      tools.append(replay);

      if (message.chinese) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "call-tool";
        toggle.textContent = "中文";
        toggle.title = "显示或隐藏中文";
        toggle.classList.toggle("is-on", state.showChinese);
        toggle.setAttribute("aria-pressed", String(state.showChinese));
        toggle.addEventListener("click", () => {
          state.showChinese = !state.showChinese;
          persistPrefs();
          renderMessages();
        });
        tools.append(toggle);
      }
    }

    if (tools.childElementCount) {
      row.append(tools);
    }
    return row;
  }

  function buildPendingNode() {
    const row = document.createElement("div");
    row.className = "call-message is-partner is-pending";
    const bubble = document.createElement("div");
    bubble.className = "call-bubble";
    bubble.textContent = `${currentPersona()?.name || "对方"}正在想怎么说…`;
    row.append(bubble);
    return row;
  }

  function renderMessages() {
    if (!els.callLog) {
      return;
    }
    const thread = currentThread();
    els.callLog
      .querySelectorAll(".call-message")
      .forEach((node) => node.remove());

    const empty = !thread.messages.length && !state.pending;
    if (els.callEmpty) {
      els.callEmpty.hidden = !empty;
      if (empty) {
        els.callEmpty.textContent = "选好人物，按下「开始通话」，对方会先说第一句。";
      }
    }

    thread.messages.forEach((message) => {
      els.callLog.append(buildMessageNode(message));
    });
    if (state.pending) {
      els.callLog.append(buildPendingNode());
    }
    els.callLog.scrollTop = els.callLog.scrollHeight;
  }

  function renderMode() {
    const mode = MODES[state.mode] || MODES.local;
    if (els.modeNote) {
      els.modeNote.textContent = mode.note;
    }
    if (els.settingsHint) {
      els.settingsHint.textContent = mode.hint;
    }
    if (els.modeGroup) {
      els.modeGroup
        .querySelectorAll("[data-mode]")
        .forEach((button) => {
          const active = button.dataset.mode === state.mode;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", String(active));
        });
    }
    if (els.apiFields) {
      els.apiFields.hidden = state.mode !== "api";
    }
  }

  function renderSettings() {
    if (els.rateGroup) {
      els.rateGroup.querySelectorAll("[data-rate]").forEach((button) => {
        const active = Number(button.dataset.rate) === Number(state.rate);
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    if (els.autoSpeak) {
      els.autoSpeak.checked = state.autoSpeak;
    }
    if (els.topicSelect && els.topicSelect.value !== state.topicId) {
      els.topicSelect.value = state.topicId;
    }
    if (els.apiUrl) {
      els.apiUrl.value = state.api.url;
    }
    if (els.apiModel) {
      els.apiModel.value = state.api.model;
    }
    if (els.apiKey) {
      els.apiKey.value = state.api.key;
    }
    if (els.apiAuth) {
      els.apiAuth.value = state.api.auth;
    }
  }

  function buildTopicOptions() {
    if (!els.topicSelect) {
      return;
    }
    els.topicSelect.textContent = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "让 ta 自己挑";
    els.topicSelect.append(auto);
    TOPICS.forEach((topic) => {
      const option = document.createElement("option");
      option.value = topic.id;
      option.textContent = topic.label || topic.id;
      els.topicSelect.append(option);
    });
    els.topicSelect.value = state.topicId;
  }

  /** 通话按钮、输入框和快捷按钮的可用状态只在这里改，省得散落各处。 */
  function syncComposer() {
    const active = state.callActive;
    const recognizerSupported = Boolean(state.recognizer?.supported);
    if (els.input) {
      els.input.disabled = !active;
    }
    if (els.sendButton) {
      els.sendButton.disabled = !active;
    }
    if (els.micButton) {
      els.micButton.disabled = !active || !recognizerSupported;
      els.micButton.title = recognizerSupported
        ? "点一下开始说话，停下来会自动发出去"
        : "这台浏览器没有语音识别，直接打字也一样";
      els.micButton.classList.toggle("is-recording", state.recording);
      els.micButton.setAttribute("aria-pressed", String(state.recording));
    }
    if (els.topicButton) {
      els.topicButton.disabled = !active;
    }
    if (els.replayButton) {
      els.replayButton.disabled = !active || !state.lastLine;
    }
    if (els.recapButton) {
      els.recapButton.disabled = !currentThread().messages.length;
    }
    if (els.startButton) {
      els.startButton.textContent = active ? "结束通话" : "开始通话";
    }
    if (!active) {
      setHint("先按「开始通话」");
    } else if (!state.recording) {
      setHint("Enter 发送，Shift + Enter 换行");
    }
  }

  /* ------------------------------------------------------------- 朗读 */

  function speakNow(text) {
    const line = String(text || "").trim();
    if (!line) {
      return;
    }
    if (!SPEECH) {
      showToast("这个页面没有加载语音模块");
      return;
    }
    if (!SPEECH.supportsSpeech?.()) {
      showToast("这台浏览器不支持语音合成，用 Chrome 或 Edge 试试");
      return;
    }
    const started = SPEECH.speak(line, {
      rate: state.rate,
      label: currentPersona()?.name || "朗读",
      onUnsupported: () => showToast("这台浏览器不支持语音合成"),
      onFinish: () => {
        if (state.callActive) {
          setStatus("idle");
        }
      },
    });
    if (!started) {
      return;
    }
    setStatus("speaking");
  }

  /** 自动朗读要尊重「只看文本」和「自动念」两个开关，手动点重听则不受影响。 */
  function speakAuto(text) {
    if (state.mode === "quiet" || !state.autoSpeak) {
      return;
    }
    speakNow(text);
  }

  function stopSpeech() {
    if (SPEECH?.isActive?.()) {
      SPEECH.stop();
    }
  }

  /* ------------------------------------------------------------- 记录 */

  function appendMessage(partial) {
    const english = String(partial?.english || "").trim();
    if (!english) {
      return null;
    }
    const thread = currentThread();
    const message = {
      role: partial.role === "user" ? "user" : "partner",
      english,
      chinese: String(partial.chinese || "").trim(),
      mood: String(partial.mood || "").trim(),
      topicId: String(partial.topicId || "").trim(),
      source: partial.source === "api" ? "api" : "local",
      createdAt: Date.now(),
    };
    thread.messages.push(message);
    if (thread.messages.length > MAX_MESSAGES) {
      thread.messages.splice(0, thread.messages.length - MAX_MESSAGES);
    }
    thread.updatedAt = message.createdAt;
    if (message.topicId) {
      thread.topicId = message.topicId;
    }
    if (message.role === "partner") {
      state.lastLine = message.english;
    }
    persistThreads();
    return message;
  }

  function syncLastLine() {
    const messages = currentThread().messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "partner") {
        state.lastLine = messages[index].english;
        return;
      }
    }
    state.lastLine = "";
  }

  /* ------------------------------------------------------------- 计时 */

  function renderTimer() {
    if (!els.callTimer) {
      return;
    }
    const seconds = state.callActive
      ? (Date.now() - state.callStartedAt) / 1000
      : 0;
    els.callTimer.textContent = formatClock(seconds);
  }

  function startTimer() {
    window.clearInterval(state.timerId);
    state.callStartedAt = Date.now();
    renderTimer();
    state.timerId = window.setInterval(renderTimer, 1000);
  }

  function stopTimer() {
    window.clearInterval(state.timerId);
    state.timerId = 0;
  }

  /* ------------------------------------------------------------- 开场 / 收线 */

  /** 选了开场话题就先聊它；引擎靠 visitedTopics 决定换话题的顺序。 */
  function buildOpener() {
    const thread = currentThread();
    const persona = currentPersona();
    const opener = ENGINE.pickOpener({ persona, state: thread.engine });
    const topic = TOPICS.find((item) => item.id === state.topicId);
    if (!topic || !Array.isArray(topic.angles) || !topic.angles.length) {
      return { ...opener, topicId: "" };
    }
    const angle = topic.angles[0];
    thread.engine.visitedTopics = [topic.id];
    return {
      en: `${opener.en} ${angle.en}`,
      zh: `${opener.zh || ""}${angle.zh || ""}`,
      mood: opener.mood || "chatting",
      topicId: topic.id,
      source: "local",
    };
  }

  function openCall() {
    const opener = buildOpener();
    appendMessage({
      role: "partner",
      english: opener.en,
      chinese: opener.zh,
      mood: opener.mood,
      topicId: opener.topicId,
      source: opener.source,
    });
    renderMessages();
    syncComposer();
    speakAuto(opener.en);
    if (state.mode === "quiet" || !state.autoSpeak) {
      setStatus("idle");
    }
  }

  function startCall() {
    state.callActive = true;
    state.pending = false;
    startTimer();
    renderCallHeader();
    syncLastLine();
    const thread = currentThread();
    if (thread.messages.length) {
      // 接着上次聊：不重复开场白，也不突然念旧句子。
      renderMessages();
      setStatus("idle");
    } else {
      setStatus("thinking");
      openCall();
    }
    syncComposer();
  }

  function endCall() {
    state.callActive = false;
    state.pending = false;
    state.sending = false;
    stopTimer();
    stopSpeech();
    stopRecording(true);
    renderTimer();
    setStatus("ended");
    renderMessages();
    syncComposer();
  }

  function selectPersona(personaId) {
    if (!PERSONAS.some((persona) => persona.id === personaId)) {
      return;
    }
    const restart = state.callActive;
    if (restart) {
      endCall();
    }
    state.personaId = personaId;
    persistPrefs();
    renderPersonas();
    renderCallHeader();
    syncLastLine();
    renderMessages();
    syncComposer();
    if (restart) {
      startCall();
    }
  }

  /* ------------------------------------------------------------- 麦克风 */

  function setupRecognition() {
    if (!STUDY?.createRecognizer) {
      state.recognizer = null;
      return;
    }
    state.recognizer = STUDY.createRecognizer({
      lang: "en-US",
      onResult: ({ final, interim }) => {
        const text = `${final || ""} ${interim || ""}`.replace(/\s+/g, " ").trim();
        if (text && els.input) {
          els.input.value = text;
        }
      },
      onError: (code) => {
        state.recognitionFailed = true;
        stopRecording(false);
        state.recognizer?.abort?.();
        if (code === "not-allowed" || code === "service-not-allowed") {
          showToast("麦克风权限被拒绝了，也可以直接打字");
        } else if (code === "no-speech") {
          showToast("没听到声音，再说一次");
        } else if (code === "audio-capture") {
          showToast("找不到麦克风");
        } else {
          showToast(`语音识别出错：${code}`);
        }
      },
      onEnd: () => {
        const text = String(els.input?.value || "").trim();
        const failed = state.recognitionFailed;
        stopRecording(true);
        if (!failed && text && state.callActive && !state.sending) {
          sendTurn(text);
        }
      },
    });
  }

  function stopRecording(silent) {
    state.recording = false;
    if (els.micButton) {
      els.micButton.classList.remove("is-recording");
      els.micButton.setAttribute("aria-pressed", "false");
    }
    if (!silent && state.callActive) {
      setHint("Enter 发送，Shift + Enter 换行");
      setStatus("idle");
    }
  }

  function toggleRecording() {
    if (!state.callActive) {
      showToast("先按「开始通话」再说话");
      return;
    }
    if (!state.recognizer?.supported) {
      showToast("这台浏览器没有语音识别，直接打字也一样");
      return;
    }
    if (state.recording) {
      state.recognizer.stop();
      return;
    }
    stopSpeech();
    state.recognitionFailed = false;
    state.recording = true;
    if (els.input) {
      els.input.value = "";
    }
    els.micButton?.classList.add("is-recording");
    els.micButton?.setAttribute("aria-pressed", "true");
    setHint("正在听你说，说完停一下就会自动发出去");
    setStatus("listening");
    state.recognizer.start();
  }

  /* ------------------------------------------------------------- 接口 */

  function resolveEndpoint(raw) {
    const value = String(raw || "").trim();
    if (!value) {
      throw new Error("还没填 Chat 接口地址");
    }
    let resolved;
    try {
      resolved = new URL(value, window.location.href);
    } catch {
      throw new Error("接口地址不是有效的网址");
    }
    const pathname = resolved.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/v1") {
      resolved.pathname = `${pathname || "/v1"}/chat/completions`;
    }
    return resolved.toString();
  }

  function buildApiHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (!state.api.key || state.api.auth === "none") {
      return headers;
    }
    if (state.api.auth === "x-api-key") {
      headers["x-api-key"] = state.api.key;
    } else {
      headers.Authorization = `Bearer ${state.api.key}`;
    }
    return headers;
  }

  function readApiContent(payload) {
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content.trim();
    }
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === "string" ? part : part?.text || ""))
        .join("")
        .trim();
    }
    const legacy = payload?.choices?.[0]?.text;
    return typeof legacy === "string" ? legacy.trim() : "";
  }

  async function requestApiReply() {
    const endpoint = resolveEndpoint(state.api.url);
    const thread = currentThread();
    const topic =
      TOPICS.find((item) => item.id === (thread.topicId || state.topicId)) || null;
    const body = {
      model: state.api.model || "gpt-4o-mini",
      temperature: 0.9,
      max_tokens: 400,
      messages: [
        {
          role: "system",
          content: ENGINE.buildPartnerPrompt({
            persona: currentPersona(),
            history: thread.messages,
            topic,
          }),
        },
        ...ENGINE.buildHistoryMessages(thread.messages, 12),
      ],
    };

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const send = (payload) =>
      fetch(endpoint, {
        method: "POST",
        headers: buildApiHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

    try {
      let response = await send(body);
      let responseText = await response.text();
      // 有些 OpenAI 兼容服务不收采样参数，去掉再试一次。
      if (!response.ok && (response.status === 400 || response.status === 422)) {
        response = await send({ model: body.model, messages: body.messages });
        responseText = await response.text();
      }

      let payload = null;
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.message ||
          responseText ||
          `接口返回 ${response.status}`;
        throw new Error(String(message).slice(0, 160));
      }

      const reply = ENGINE.parsePartnerReply(readApiContent(payload));
      if (!reply) {
        throw new Error("接口返回的内容里读不出英文回复");
      }
      return reply;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`接口 ${Math.round(API_TIMEOUT_MS / 1000)} 秒没有响应`);
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  /* ------------------------------------------------------------- 对话 */

  /** 话题跳转那一条会多带一句口头语，拼到前面才像真人接话。 */
  function withExtra(reply) {
    const extra = reply?.extra;
    if (!extra?.en) {
      return reply;
    }
    return {
      ...reply,
      en: `${extra.en} ${reply.en}`.replace(/\s+/g, " ").trim(),
      zh: `${extra.zh || ""}${reply.zh || ""}`,
    };
  }

  function localReply(learnerText, forceTopic) {
    const thread = currentThread();
    const reply = ENGINE.generateLocalReply({
      persona: currentPersona(),
      state: thread.engine,
      learnerText,
      topics: TOPICS,
      forceTopic,
    });
    return withExtra(reply);
  }

  function replyToMessage(reply) {
    const thread = currentThread();
    appendMessage({
      role: "partner",
      english: reply.en,
      chinese: reply.zh,
      mood: reply.mood,
      topicId: reply.topicId || thread.topicId,
      source: reply.source,
    });
    renderMessages();
    syncComposer();
    speakAuto(reply.en);
    if (state.mode === "quiet" || !state.autoSpeak) {
      setStatus("idle");
    }
  }

  async function sendTurn(rawText) {
    const text = String(rawText || "").replace(/\s+/g, " ").trim();
    if (!text || state.sending) {
      return;
    }
    if (!state.callActive) {
      showToast("先按「开始通话」");
      return;
    }

    stopSpeech();
    const thread = currentThread();
    thread.engine.turnCount = (thread.engine.turnCount || 0) + 1;
    appendMessage({ role: "user", english: text });
    if (els.input) {
      els.input.value = "";
    }
    state.sending = true;
    state.pending = true;
    setStatus("thinking");
    renderMessages();
    syncComposer();

    try {
      let reply = null;
      if (state.mode === "api") {
        try {
          reply = await requestApiReply();
        } catch (error) {
          showToast(
            `接口没接通：${error?.message || "请求失败"}，先用本地陪聊顶上`,
          );
        }
      }
      if (!reply) {
        reply = localReply(text, false);
      }
      replyToMessage(reply);
    } catch (error) {
      showToast(error?.message || "这一轮没接上，再说一次");
    } finally {
      state.pending = false;
      state.sending = false;
      renderMessages();
      syncComposer();
    }
  }

  /** 卡住的时候让对方自己起个头：这一轮永远走本地，不花你的接口配额。 */
  function shiftTopic() {
    if (!state.callActive || state.sending) {
      return;
    }
    stopSpeech();
    state.pending = true;
    state.sending = true;
    setStatus("thinking");
    renderMessages();
    try {
      replyToMessage(localReply("", true));
    } catch (error) {
      showToast(error?.message || "换话题失败了，再点一次");
    } finally {
      state.pending = false;
      state.sending = false;
      renderMessages();
      syncComposer();
    }
  }

  function replayLast() {
    if (!state.lastLine) {
      showToast("还没有可以重听的句子");
      return;
    }
    speakNow(state.lastLine);
  }

  /* ------------------------------------------------------------- 复盘 */

  function recapBlock(title, items) {
    const block = document.createElement("div");
    block.className = "recap-block";
    const heading = document.createElement("h3");
    heading.textContent = title;
    block.append(heading);

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "recap-empty";
      empty.textContent = "这一段还没有能挑出来的句子。";
      block.append(empty);
      return block;
    }

    const list = document.createElement("ul");
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "recap-item";
      const strong = document.createElement("strong");
      strong.textContent = item.title;
      li.append(strong);
      if (item.detail) {
        const span = document.createElement("span");
        span.textContent = item.detail;
        li.append(span);
      }
      list.append(li);
    });
    block.append(list);
    return block;
  }

  function renderRecap(recap) {
    if (!els.recapBody) {
      return;
    }
    els.recapBody.textContent = "";

    const stats = document.createElement("div");
    stats.className = "recap-stats";
    [
      `你说 ${recap.stats.turns} 句`,
      `对方说 ${recap.stats.partnerTurns} 句`,
      `共 ${recap.stats.learnerWords} 个英文词`,
      `平均 ${recap.stats.averageWords} 词一句`,
    ].forEach((text) => {
      const chip = document.createElement("span");
      chip.className = "recap-stat";
      chip.textContent = text;
      stats.append(chip);
    });
    els.recapBody.append(stats);

    els.recapBody.append(
      recapBlock(
        "可以顺手拿走的说法",
        recap.keep.map((item) => ({ title: item.en, detail: item.zh })),
      ),
    );
    els.recapBody.append(
      recapBlock(
        "更像母语者的说法",
        recap.fixes.map((item) => ({
          title: `${item.you} → ${item.better}`,
          detail: item.why,
        })),
      ),
    );
    els.recapBody.append(
      recapBlock(
        "下次可以聊",
        recap.next.map((item) => ({
          title: item.en,
          detail: `${item.label || ""}${item.zh ? ` · ${item.zh}` : ""}`,
        })),
      ),
    );

    const note = document.createElement("p");
    note.className = "recap-empty";
    note.textContent =
      "这些都是从这段对话里挑出来的，是朋友式的提醒，不是考试评分。";
    els.recapBody.append(note);
  }

  function openRecap() {
    const thread = currentThread();
    if (!thread.messages.length) {
      showToast("先聊两句再复盘");
      return;
    }
    const recap = ENGINE.buildRecap({
      history: thread.messages,
      topics: TOPICS,
      source: state.mode === "api" ? "api" : "local",
    });
    renderRecap(recap);
    if (els.recapPanel) {
      els.recapPanel.hidden = false;
      els.recapPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function closeRecap() {
    if (els.recapPanel) {
      els.recapPanel.hidden = true;
    }
  }

  /* ------------------------------------------------------------- 事件 */

  function bindEvents() {
    els.startButton?.addEventListener("click", () => {
      if (state.callActive) {
        endCall();
      } else {
        startCall();
      }
    });
    els.recapButton?.addEventListener("click", openRecap);
    els.recapClose?.addEventListener("click", closeRecap);
    els.replayButton?.addEventListener("click", replayLast);
    els.topicButton?.addEventListener("click", shiftTopic);
    els.micButton?.addEventListener("click", toggleRecording);

    els.personaList?.addEventListener("click", (event) => {
      const card = event.target.closest?.("[data-persona-id]");
      if (card) {
        selectPersona(card.dataset.personaId);
      }
    });

    els.composer?.addEventListener("submit", (event) => {
      event.preventDefault();
      sendTurn(els.input?.value || "");
    });

    els.input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendTurn(els.input.value);
      }
    });

    els.modeGroup?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-mode]");
      if (!button || !MODES[button.dataset.mode]) {
        return;
      }
      state.mode = button.dataset.mode;
      persistPrefs();
      renderMode();
      if (state.mode === "quiet") {
        stopSpeech();
      }
    });

    els.rateGroup?.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-rate]");
      if (!button) {
        return;
      }
      const rate = Number(button.dataset.rate);
      if (!(rate > 0)) {
        return;
      }
      state.rate = rate;
      persistPrefs();
      renderSettings();
    });

    els.autoSpeak?.addEventListener("change", () => {
      state.autoSpeak = els.autoSpeak.checked;
      persistPrefs();
      if (!state.autoSpeak) {
        stopSpeech();
      }
    });

    els.topicSelect?.addEventListener("change", () => {
      state.topicId = els.topicSelect.value;
      persistPrefs();
    });

    els.apiSaveButton?.addEventListener("click", () => {
      state.api = {
        url: String(els.apiUrl?.value || "").trim(),
        model: String(els.apiModel?.value || "").trim(),
        key: String(els.apiKey?.value || "").trim(),
        auth: String(els.apiAuth?.value || "bearer"),
      };
      persistPrefs();
      if (els.apiStatus) {
        els.apiStatus.classList.remove("is-error");
        els.apiStatus.classList.add("is-ok");
        els.apiStatus.textContent = state.api.url
          ? "已保存在这台设备，密钥不会上传本站"
          : "已清空接口地址";
      }
      showToast("接口设置已保存在这台设备");
    });
  }

  /* ------------------------------------------------------------- 启动 */

  async function hydrateAccount() {
    const session = window.iballSession
      ? await window.iballSession.probe()
      : null;
    if (!session || session.mode !== "server" || !session.authenticated) {
      return;
    }
    window.iballAccounts?.activate(session.account?.id || "");
    if (els.accountChip) {
      els.accountChip.textContent = session.user || "已登录";
      els.accountChip.hidden = false;
    }
    // 换了命名空间就得重新读一次，否则看到的是访客那份记录。
    loadThreads();
    loadPrefs();
    buildTopicOptions();
    renderPersonas();
    renderCallHeader();
    syncLastLine();
    renderMessages();
    renderMode();
    renderSettings();
    syncComposer();
  }

  function boot() {
    if (!ENGINE || !PERSONAS.length || !els.personaList) {
      console.error("[speaking] 缺少人物包或对话引擎，口语房间无法初始化");
      if (els.callEmpty) {
        els.callEmpty.textContent = "人物数据没有加载成功，刷新一下再试。";
      }
      return;
    }
    loadThreads();
    loadPrefs();
    buildTopicOptions();
    renderPersonas();
    renderCallHeader();
    syncLastLine();
    renderMessages();
    renderMode();
    renderSettings();
    setupRecognition();
    syncComposer();
    setStatus("ready");
    renderTimer();
    bindEvents();
    hydrateAccount().catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 给浏览器验收脚本留一个只读入口，正式流程不依赖它。
  window.IballSpeakingRoom = {
    state,
    personaCount: () => PERSONAS.length,
    topicCount: () => TOPICS.length,
    messageCount: () => currentThread().messages.length,
    escapeHtml,
  };
})();
