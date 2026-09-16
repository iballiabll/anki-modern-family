const MANIFEST_PATH = "./resources.json";
const STORAGE_KEY = "iball-listening-cabin-known";
const FAVORITES_STORAGE_KEY = "iball-listening-cabin-favorites";
const UNKNOWN_STORAGE_KEY = "iball-listening-cabin-unknown";

const state = {
  resources: [],
  decks: new Map(),
  activeResourceId: "",
  known: new Set(),
  favorites: new Set(),
  unknown: new Set(),
  view: "all",
  query: "",
  user: "",
};

const elements = {
  loginView: document.querySelector("#loginView"),
  loginForm: document.querySelector("#loginForm"),
  loginButton: document.querySelector("#loginButton"),
  loginError: document.querySelector("#loginError"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  appView: document.querySelector("#appView"),
  userLabel: document.querySelector("#userLabel"),
  logoutButton: document.querySelector("#logoutButton"),
  resourceCount: document.querySelector("#resourceCount"),
  resourceList: document.querySelector("#resourceList"),
  activeTitle: document.querySelector("#activeTitle"),
  activeDescription: document.querySelector("#activeDescription"),
  progressRing: document.querySelector("#progressRing"),
  progressPercent: document.querySelector("#progressPercent"),
  progressText: document.querySelector("#progressText"),
  searchInput: document.querySelector("#searchInput"),
  viewSwitcher: document.querySelector("#viewSwitcher"),
  viewButtons: document.querySelectorAll("[data-view]"),
  favoriteCount: document.querySelector("#favoriteCount"),
  unknownCount: document.querySelector("#unknownCount"),
  visibleCount: document.querySelector("#visibleCount"),
  cardGrid: document.querySelector("#cardGrid"),
  emptyState: document.querySelector("#emptyState"),
  footerResource: document.querySelector("#footerResource"),
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => value.length > 0));
}

function extractAnnotation(back) {
  const groups = [...String(back || "").matchAll(/（([^（）]+)）/g)];
  if (groups.length === 0) {
    return null;
  }

  const annotation = groups.at(-1)[1].trim();
  const firstPart = annotation.split(/[，,]/)[0].trim();
  const equalsIndex = firstPart.indexOf("=");

  if (equalsIndex < 0) {
    return null;
  }

  const phrase = firstPart.slice(0, equalsIndex).trim();
  const remainder = firstPart.slice(equalsIndex + 1).trim();
  const phoneticMatch = remainder.match(/^(.*?)\s*\/([^/]+)\//);

  return {
    phrase,
    meaning: phoneticMatch ? phoneticMatch[1].trim() : remainder,
    phonetic: phoneticMatch ? `/${phoneticMatch[2].trim()}/` : "",
    fullMatch: groups.at(-1)[0],
  };
}

function parseAnkiDeck(text, resource, index) {
  const metadata = {};
  const dataRows = [];

  parseCsv(text.replace(/^\uFEFF/, "")).forEach((row) => {
    if (row[0]?.startsWith("#")) {
      const separatorIndex = row[0].indexOf(":");
      if (separatorIndex > 0) {
        metadata[row[0].slice(0, separatorIndex)] = row[0]
          .slice(separatorIndex + 1)
          .trim();
      }
      return;
    }
    dataRows.push(row);
  });

  const columns = String(metadata["#columns"] || "Front,Back")
    .split(",")
    .map((column) => column.trim());
  const frontIndex = Math.max(0, columns.indexOf("Front"));
  const backIndex = Math.max(1, columns.indexOf("Back"));

  return dataRows
    .map((row, itemIndex) => {
      const sentence = String(row[frontIndex] || "").trim();
      const back = String(row[backIndex] || "").trim();
      if (!sentence && !back) {
        return null;
      }

      const annotation = extractAnnotation(back);
      const translation = annotation
        ? back.replace(annotation.fullMatch, "").trim()
        : back;
      const phrase = annotation?.phrase || sentence || `词汇 ${itemIndex + 1}`;

      return {
        id: `${resource.id}:${index + 1}:${itemIndex + 1}`,
        phrase,
        phonetic: annotation?.phonetic || "",
        meaning: annotation?.meaning || "查看原句理解用法",
        sentence,
        translation,
      };
    })
    .filter(Boolean);
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((value) => value.trim().replace(/\*\*(.*?)\*\*/g, "$1"));
}

function parseMarkdownDeck(text, resource, index) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    if (!/^\|.*\|$/.test(line.trim())) {
      return false;
    }
    const headers = splitMarkdownRow(line);
    return headers.includes("#") && headers.includes("词/短语");
  });

  if (headerIndex < 0) {
    return [];
  }

  const headers = splitMarkdownRow(lines[headerIndex]);
  const findColumn = (...names) =>
    headers.findIndex((header) => names.includes(header));
  const phraseIndex = findColumn("词/短语");
  const meaningIndex = findColumn("释义");
  const phoneticIndex = findColumn("IPA");
  const sentenceIndex = findColumn("英文原句");
  const translationIndex = findColumn("译句");

  return lines
    .slice(headerIndex + 2)
    .filter((line) => /^\|/.test(line.trim()))
    .map((line, itemIndex) => {
      const row = splitMarkdownRow(line);
      const phrase = String(row[phraseIndex] || "").trim();
      const sentence = String(row[sentenceIndex] || "").trim();
      if (!phrase && !sentence) {
        return null;
      }

      return {
        id: `${resource.id}:${index + 1}:${itemIndex + 1}`,
        phrase: phrase || sentence,
        phonetic: String(row[phoneticIndex] || "").trim(),
        meaning: String(row[meaningIndex] || "").trim() || "查看原句理解用法",
        sentence,
        translation: String(row[translationIndex] || "").trim(),
      };
    })
    .filter(Boolean);
}

function parseDeck(text, resource, index) {
  if (resource.format === "markdown-table") {
    return parseMarkdownDeck(text, resource, index);
  }
  return parseAnkiDeck(text, resource, index);
}

function restoreSet(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(stored)) {
      return new Set(stored);
    }
  } catch {
    return new Set();
  }
  return new Set();
}

function persistSet(storageKey, values) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...values]));
  } catch {
    // Marks still work for the current visit when storage is unavailable.
  }
}

function restoreMarks() {
  state.known = restoreSet(STORAGE_KEY);
  state.favorites = restoreSet(FAVORITES_STORAGE_KEY);
  state.unknown = restoreSet(UNKNOWN_STORAGE_KEY);
}

function getActiveResource() {
  return state.resources.find(
    (resource) => resource.id === state.activeResourceId,
  );
}

function getActiveItems() {
  return state.decks.get(state.activeResourceId) || [];
}

function getItemKey(resourceId, item) {
  return `${resourceId}:${item.id}`;
}

function getCollectionEntries(collection) {
  return state.resources.flatMap((resource) =>
    (state.decks.get(resource.id) || [])
      .filter((item) =>
        collection.has(getItemKey(resource.id, item)),
      )
      .map((item) => ({ item, resource })),
  );
}

function getBaseEntries() {
  if (state.view === "favorites") {
    return getCollectionEntries(state.favorites);
  }
  if (state.view === "unknown") {
    return getCollectionEntries(state.unknown);
  }

  const resource = getActiveResource();
  return resource
    ? getActiveItems().map((item) => ({ item, resource }))
    : [];
}

function getVisibleEntries() {
  const query = normalizeText(state.query).trim();
  const entries = getBaseEntries();

  if (!query) {
    return entries;
  }

  return entries.filter(({ item }) => {
    const searchable = [
      item.phrase,
      item.phonetic,
      item.meaning,
      item.sentence,
      item.translation,
    ].join(" ");
    return normalizeText(searchable).includes(query);
  });
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

function formatResourceIndex(index) {
  return String(index + 1).padStart(2, "0");
}

function createResourceButton(resource, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "resource-button";
  button.dataset.resourceId = resource.id;
  button.setAttribute(
    "aria-pressed",
    String(resource.id === state.activeResourceId),
  );
  button.classList.toggle("is-active", resource.id === state.activeResourceId);

  const badge = document.createElement("span");
  badge.className = "resource-index";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = formatResourceIndex(index);

  const copy = document.createElement("span");
  copy.className = "resource-copy";

  const title = document.createElement("strong");
  title.textContent = resource.title;

  const meta = document.createElement("span");
  meta.textContent = resource.group || "上传素材";

  copy.append(title, meta);

  const count = document.createElement("span");
  count.className = "resource-count";
  count.textContent = String((state.decks.get(resource.id) || []).length);

  button.append(badge, copy, count);
  button.addEventListener("click", () => {
    state.activeResourceId = resource.id;
    state.view = "all";
    state.query = "";
    elements.searchInput.value = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  return button;
}

function renderResourceList() {
  const fragment = document.createDocumentFragment();
  state.resources.forEach((resource, index) => {
    fragment.append(createResourceButton(resource, index));
  });
  elements.resourceList.replaceChildren(fragment);
  elements.resourceCount.textContent = String(state.resources.length);
}

function createCard(entry, index) {
  const { item, resource } = entry;
  const card = document.createElement("article");
  const itemKey = getItemKey(resource.id, item);
  const isKnown = state.known.has(itemKey);
  const isFavorite = state.favorites.has(itemKey);
  const isUnknown = state.unknown.has(itemKey);
  card.className = "vocab-card";
  card.classList.toggle("is-known", isKnown);
  card.classList.toggle("is-favorite", isFavorite);
  card.classList.toggle("is-unknown", isUnknown);

  const head = document.createElement("div");
  head.className = "card-head";

  const number = document.createElement("span");
  number.className = "card-number";
  number.setAttribute("aria-hidden", "true");
  number.textContent = formatResourceIndex(index);

  const phraseBlock = document.createElement("div");
  phraseBlock.className = "phrase-block";

  const source = document.createElement("span");
  source.className = "card-source";
  source.textContent = resource.title;
  source.hidden = state.view === "all";

  const phrase = document.createElement("h2");
  phrase.className = "phrase";
  phrase.lang = "en";
  phrase.textContent = item.phrase;

  const phonetic = document.createElement("p");
  phonetic.className = "phonetic";
  phonetic.lang = "en";
  phonetic.textContent = item.phonetic;
  phonetic.hidden = !item.phonetic;

  phraseBlock.append(source, phrase, phonetic);

  const speakButton = document.createElement("button");
  speakButton.className = "speak-button";
  speakButton.type = "button";
  speakButton.textContent = "朗读";
  speakButton.setAttribute("aria-label", `播放 ${item.phrase} 的发音`);
  speakButton.addEventListener("click", () => speak(item.phrase));

  head.append(number, phraseBlock, speakButton);

  const meaning = document.createElement("p");
  meaning.className = "meaning";
  meaning.textContent = item.meaning;

  const sentence = document.createElement("p");
  sentence.className = "sentence";
  sentence.lang = "en";
  sentence.textContent = item.sentence;

  if (item.translation) {
    const translation = document.createElement("span");
    translation.className = "translation";
    translation.textContent = item.translation;
    sentence.append(translation);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const favoriteButton = document.createElement("button");
  favoriteButton.className = "favorite-button";
  favoriteButton.type = "button";
  favoriteButton.textContent = isFavorite ? "已收藏" : "收藏";
  favoriteButton.setAttribute("aria-pressed", String(isFavorite));
  favoriteButton.setAttribute(
    "aria-label",
    `${isFavorite ? "取消收藏" : "收藏"} ${item.phrase}`,
  );
  favoriteButton.addEventListener("click", () => {
    if (state.favorites.has(itemKey)) {
      state.favorites.delete(itemKey);
    } else {
      state.favorites.add(itemKey);
    }
    persistSet(FAVORITES_STORAGE_KEY, state.favorites);
    render();
  });

  const unknownButton = document.createElement("button");
  unknownButton.className = "unknown-button";
  unknownButton.type = "button";
  unknownButton.textContent = isUnknown ? "已标不会" : "不会";
  unknownButton.setAttribute("aria-pressed", String(isUnknown));
  unknownButton.setAttribute(
    "aria-label",
    `${isUnknown ? "取消标记" : "标记"} ${item.phrase} 为不会`,
  );
  unknownButton.addEventListener("click", () => {
    if (state.unknown.has(itemKey)) {
      state.unknown.delete(itemKey);
    } else {
      state.unknown.add(itemKey);
      state.known.delete(itemKey);
      persistSet(STORAGE_KEY, state.known);
    }
    persistSet(UNKNOWN_STORAGE_KEY, state.unknown);
    render();
  });

  const knownButton = document.createElement("button");
  knownButton.className = "known-button";
  knownButton.type = "button";
  knownButton.textContent = isKnown ? "已掌握" : "标记掌握";
  knownButton.setAttribute("aria-pressed", String(isKnown));
  knownButton.addEventListener("click", () => {
    if (state.known.has(itemKey)) {
      state.known.delete(itemKey);
    } else {
      state.known.add(itemKey);
      state.unknown.delete(itemKey);
      persistSet(UNKNOWN_STORAGE_KEY, state.unknown);
    }
    persistSet(STORAGE_KEY, state.known);
    render();
  });

  actions.append(favoriteButton, unknownButton, knownButton);
  card.append(head, meaning, sentence, actions);
  return card;
}

function updateProgress() {
  const items = getActiveItems();
  const knownCount = items.filter((item) =>
    state.known.has(getItemKey(state.activeResourceId, item)),
  ).length;
  const percent = items.length
    ? Math.round((knownCount / items.length) * 100)
    : 0;

  elements.progressRing.style.setProperty("--progress", `${percent}%`);
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressText.textContent = `${knownCount} / ${items.length} 已掌握`;
}

function updateViewSwitcher() {
  elements.viewButtons.forEach((button) => {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  elements.favoriteCount.textContent = String(state.favorites.size);
  elements.unknownCount.textContent = String(state.unknown.size);
}

function render() {
  const resource = getActiveResource();
  const visibleEntries = getVisibleEntries();
  const fragment = document.createDocumentFragment();

  visibleEntries.forEach((entry, index) => {
    fragment.append(createCard(entry, index));
  });

  elements.cardGrid.replaceChildren(fragment);
  elements.visibleCount.textContent = String(visibleEntries.length);
  elements.cardGrid.hidden = visibleEntries.length === 0;

  if (state.view === "favorites") {
    elements.activeTitle.textContent = "收藏集";
    elements.activeDescription.textContent =
      "汇总所有素材中手动收藏的词汇，方便集中复习。";
    elements.footerResource.textContent = `收藏集 · ${state.favorites.size} 条`;
  } else if (state.view === "unknown") {
    elements.activeTitle.textContent = "不会的单词";
    elements.activeDescription.textContent =
      "汇总所有素材中标记为不会的词汇，掌握后可随时移出。";
    elements.footerResource.textContent = `不会的单词 · ${state.unknown.size} 条`;
  } else if (resource) {
    elements.activeTitle.textContent = resource.title;
    elements.activeDescription.textContent =
      resource.description || resource.group || "上传素材";
    elements.footerResource.textContent = `${resource.title} · ${
      getActiveItems().length
    } 条`;
  }

  if (visibleEntries.length > 0) {
    elements.emptyState.hidden = true;
  } else {
    elements.emptyState.hidden = false;
    const title = elements.emptyState.querySelector("strong");
    const copy = elements.emptyState.querySelector("span");
    if (state.query) {
      title.textContent = "没有找到匹配内容";
      copy.textContent = "换一个关键词，或切换到其他视图。";
    } else if (state.view === "favorites") {
      title.textContent = "收藏集还是空的";
      copy.textContent = "在任意词汇卡片上点“收藏”，它会汇总到这里。";
    } else if (state.view === "unknown") {
      title.textContent = "还没有标记不会的单词";
      copy.textContent = "遇到不熟的词汇时点“不会”，之后可在这里集中复习。";
    } else {
      title.textContent = "素材里还没有卡片";
      copy.textContent = "请检查对应 CSV 文件是否已经上传。";
    }
  }

  renderResourceList();
  updateProgress();
  updateViewSwitcher();
}

function showLogin(message = "") {
  elements.loginView.hidden = false;
  elements.appView.hidden = true;
  elements.loginError.textContent = message;
  elements.loginError.hidden = !message;
  elements.username.focus();
}

async function showApp(user) {
  state.user = user;
  elements.userLabel.textContent = user;
  elements.loginView.hidden = true;
  elements.appView.hidden = false;

  if (state.resources.length === 0) {
    await loadLibrary();
  } else {
    render();
  }
  elements.searchInput.focus();
}

async function requestAuth(payload = {}, method = "POST") {
  const response = await fetch("./api/auth", {
    method,
    headers:
      method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(payload) : undefined,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function checkSession() {
  try {
    const { response, data } = await requestAuth({}, "GET");
    if (response.ok && data.authenticated) {
      await showApp(data.user || "用户");
      return;
    }
  } catch {
    // The login form will report connection problems after submission.
  }
  showLogin();
}

async function loadLibrary() {
  elements.activeTitle.textContent = "正在加载素材";
  elements.activeDescription.textContent =
    "正在读取素材清单和对应的词汇文件。";
  elements.emptyState.hidden = false;

  try {
    const manifestResponse = await fetch(MANIFEST_PATH, { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error(`资源清单加载失败：${manifestResponse.status}`);
    }

    const manifest = await manifestResponse.json();
    state.resources = Array.isArray(manifest.resources)
      ? manifest.resources
      : [];
    const deckEntries = await Promise.all(
      state.resources.map(async (resource, index) => {
        const response = await fetch(resource.file, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`${resource.title} 加载失败：${response.status}`);
        }
        const text = await response.text();
        return [resource.id, parseDeck(text, resource, index)];
      }),
    );
    state.decks = new Map(deckEntries);

    if (!state.activeResourceId && state.resources.length > 0) {
      state.activeResourceId = state.resources[0].id;
    }
    render();
  } catch (error) {
    state.resources = [];
    state.decks = new Map();
    elements.activeTitle.textContent = "素材加载失败";
    elements.activeDescription.textContent =
      "请检查 materials 目录和素材文件是否已经上传。";
    elements.emptyState.hidden = false;
    elements.emptyState.querySelector("strong").textContent = "暂时无法打开素材";
    elements.emptyState.querySelector("span").textContent =
      "刷新页面后重试，或检查控制台中的具体错误。";
    console.error(error);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "登录中...";
  elements.loginError.hidden = true;

  try {
    const { response, data } = await requestAuth({
      action: "login",
      username: elements.username.value.trim(),
      password: elements.password.value,
    });

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "账号或密码不正确");
    }

    elements.password.value = "";
    await showApp(data.user || elements.username.value.trim());
  } catch (error) {
    showLogin(error.message || "登录服务暂时不可用");
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = "登录";
  }
}

async function handleLogout() {
  elements.logoutButton.disabled = true;
  try {
    await requestAuth({ action: "logout" });
  } catch {
    // Clear the local view even if the network request fails.
  }
  elements.logoutButton.disabled = false;
  state.user = "";
  showLogin();
}

elements.loginForm.addEventListener("submit", handleLogin);
elements.logoutButton.addEventListener("click", handleLogout);
elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
elements.viewSwitcher.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) {
    return;
  }
  state.view = button.dataset.view;
  render();
});

restoreMarks();
checkSession();
