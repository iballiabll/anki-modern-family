const MANIFEST_PATH = "./resources.json";
const WORD_API_PATH = "./api/word";
const STORAGE_KEY = "iball-listening-cabin-known";
const FAVORITES_STORAGE_KEY = "iball-listening-cabin-favorites";
const UNKNOWN_STORAGE_KEY = "iball-listening-cabin-unknown";
const CATEGORY_ORDER = ["四级", "六级", "考研", "电影", "其他"];
const wordLookupCache = new Map();
let activeWordButton = null;
let wordLookupRequestId = 0;

const state = {
  resources: [],
  categories: [],
  decks: new Map(),
  activeResourceId: "",
  known: new Set(),
  favorites: new Set(),
  unknown: new Set(),
  view: "all",
  query: "",
  materialQuery: "",
  favoriteCategory: "all",
  showAllMeanings: false,
  meaningReveals: new Set(),
  meaningHides: new Set(),
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
  materialSearchInput: document.querySelector("#materialSearchInput"),
  resourceList: document.querySelector("#resourceList"),
  activeTitle: document.querySelector("#activeTitle"),
  activeDescription: document.querySelector("#activeDescription"),
  progressRing: document.querySelector("#progressRing"),
  progressPercent: document.querySelector("#progressPercent"),
  progressText: document.querySelector("#progressText"),
  searchInput: document.querySelector("#searchInput"),
  showAllMeaningsButton: document.querySelector("#showAllMeaningsButton"),
  hideAllMeaningsButton: document.querySelector("#hideAllMeaningsButton"),
  viewSwitcher: document.querySelector("#viewSwitcher"),
  viewButtons: document.querySelectorAll("[data-view]"),
  collectionFilters: document.querySelector("#collectionFilters"),
  collectionFilterList: document.querySelector("#collectionFilterList"),
  favoriteCount: document.querySelector("#favoriteCount"),
  unknownCount: document.querySelector("#unknownCount"),
  visibleCount: document.querySelector("#visibleCount"),
  cardGrid: document.querySelector("#cardGrid"),
  emptyState: document.querySelector("#emptyState"),
  footerResource: document.querySelector("#footerResource"),
  wordPopover: document.querySelector("#wordPopover"),
  wordPopoverWord: document.querySelector("#wordPopoverWord"),
  wordPopoverPhonetic: document.querySelector("#wordPopoverPhonetic"),
  wordPopoverContent: document.querySelector("#wordPopoverContent"),
  wordPopoverClose: document.querySelector("#wordPopoverClose"),
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN");
}

function compareCategoryNames(left, right) {
  const leftIndex = CATEGORY_ORDER.indexOf(left);
  const rightIndex = CATEGORY_ORDER.indexOf(right);

  if (leftIndex >= 0 && rightIndex >= 0) {
    return leftIndex - rightIndex;
  }
  if (leftIndex >= 0) {
    return -1;
  }
  if (rightIndex >= 0) {
    return 1;
  }
  return left.localeCompare(right, "zh-CN");
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

function isMeaningVisible(itemKey) {
  return state.showAllMeanings
    ? !state.meaningHides.has(itemKey)
    : state.meaningReveals.has(itemKey);
}

function setAllMeaningsVisible(visible) {
  state.showAllMeanings = visible;
  state.meaningReveals.clear();
  state.meaningHides.clear();
  render();
}

function getCollectionEntries(collection, category = "all") {
  return state.resources
    .filter(
      (resource) => category === "all" || resource.category === category,
    )
    .flatMap((resource) =>
      (state.decks.get(resource.id) || [])
        .filter((item) =>
          collection.has(getItemKey(resource.id, item)),
        )
        .map((item) => ({ item, resource })),
    );
}

function getBaseEntries() {
  if (state.view === "favorites") {
    return getCollectionEntries(state.favorites, state.favoriteCategory);
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

function normalizeLookupWord(value) {
  return String(value || "")
    .trim()
    .replace(/[’]/g, "'")
    .toLocaleLowerCase("en-US");
}

function setWordButtonExpanded(button, expanded) {
  if (button) {
    button.setAttribute("aria-expanded", String(expanded));
  }
}

function closeWordPopover() {
  wordLookupRequestId += 1;
  elements.wordPopover.hidden = true;
  setWordButtonExpanded(activeWordButton, false);
  activeWordButton = null;
}

function positionWordPopover(anchor) {
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = elements.wordPopover.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 8;
  const maxLeft = Math.max(
    viewportPadding,
    window.innerWidth - popoverRect.width - viewportPadding,
  );
  const maxTop = Math.max(
    viewportPadding,
    window.innerHeight - popoverRect.height - viewportPadding,
  );
  const centeredLeft =
    anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
  let top = anchorRect.bottom + gap;

  if (top > maxTop) {
    top = anchorRect.top - popoverRect.height - gap;
  }

  elements.wordPopover.style.left = `${Math.min(
    Math.max(centeredLeft, viewportPadding),
    maxLeft,
  )}px`;
  elements.wordPopover.style.top = `${Math.min(
    Math.max(top, viewportPadding),
    maxTop,
  )}px`;
}

function renderWordPopoverContent(result) {
  const content = document.createDocumentFragment();
  const translations = Array.isArray(result.translations)
    ? result.translations
    : [];
  const definitions = Array.isArray(result.definitions)
    ? result.definitions
    : [];

  if (translations.length > 0) {
    const label = document.createElement("span");
    label.className = "word-popover-label";
    label.textContent = "中文释义";
    content.append(label);

    translations.forEach((translation) => {
      const meaning = document.createElement("p");
      meaning.className = "word-popover-meaning";
      meaning.textContent = translation;
      content.append(meaning);
    });
  } else if (definitions.length > 0) {
    const label = document.createElement("span");
    label.className = "word-popover-label";
    label.textContent = "英文释义";
    content.append(label);

    definitions.forEach((definition) => {
      const meaning = document.createElement("p");
      meaning.className = "word-popover-meaning";
      meaning.textContent = definition;
      content.append(meaning);
    });
  } else {
    const message = document.createElement("p");
    message.className = "word-popover-status is-error";
    message.textContent = "暂时没有查到这个词。";
    content.append(message);
  }

  elements.wordPopoverContent.replaceChildren(content);
}

async function lookupWord(word, anchor) {
  const normalizedWord = normalizeLookupWord(word);
  if (!normalizedWord) {
    return;
  }

  if (activeWordButton === anchor && !elements.wordPopover.hidden) {
    closeWordPopover();
    return;
  }

  setWordButtonExpanded(activeWordButton, false);
  activeWordButton = anchor;
  setWordButtonExpanded(activeWordButton, true);
  elements.wordPopover.hidden = false;
  elements.wordPopoverWord.textContent = normalizedWord;
  elements.wordPopoverPhonetic.textContent = "";
  elements.wordPopoverPhonetic.hidden = true;

  const loading = document.createElement("p");
  loading.className = "word-popover-status";
  loading.textContent = "正在查询...";
  elements.wordPopoverContent.replaceChildren(loading);
  positionWordPopover(anchor);

  const requestId = ++wordLookupRequestId;

  try {
    let result = wordLookupCache.get(normalizedWord);
    if (!result) {
      const response = await fetch(
        `${WORD_API_PATH}?word=${encodeURIComponent(normalizedWord)}`,
        { cache: "no-store" },
      );
      result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "暂时没有查到这个词");
      }

      if (wordLookupCache.size >= 300) {
        wordLookupCache.delete(wordLookupCache.keys().next().value);
      }
      wordLookupCache.set(normalizedWord, result);
    }

    if (requestId !== wordLookupRequestId) {
      return;
    }

    elements.wordPopoverWord.textContent = result.word || normalizedWord;
    elements.wordPopoverPhonetic.textContent = result.phonetic || "";
    elements.wordPopoverPhonetic.hidden = !result.phonetic;
    renderWordPopoverContent(result);
    positionWordPopover(anchor);
  } catch (error) {
    if (requestId !== wordLookupRequestId) {
      return;
    }

    const message = document.createElement("p");
    message.className = "word-popover-status is-error";
    message.textContent = error.message || "查询失败，请稍后再试。";
    elements.wordPopoverContent.replaceChildren(message);
    positionWordPopover(anchor);
  }
}

function createSentenceText(text) {
  const fragment = document.createDocumentFragment();
  const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  const source = String(text || "");
  let lastIndex = 0;
  let match = pattern.exec(source);

  while (match) {
    if (match.index > lastIndex) {
      fragment.append(source.slice(lastIndex, match.index));
    }

    const word = match[0];
    const wordButton = document.createElement("button");
    wordButton.className = "word-lookup";
    wordButton.type = "button";
    wordButton.dataset.word = word;
    wordButton.textContent = word;
    wordButton.setAttribute("aria-haspopup", "dialog");
    wordButton.setAttribute("aria-expanded", "false");
    wordButton.setAttribute("aria-label", `查看 ${word} 的释义`);
    wordButton.addEventListener("click", (event) => {
      event.stopPropagation();
      lookupWord(word, wordButton);
    });
    fragment.append(wordButton);

    lastIndex = pattern.lastIndex;
    match = pattern.exec(source);
  }

  if (lastIndex < source.length) {
    fragment.append(source.slice(lastIndex));
  }

  return fragment;
}

function formatResourceIndex(index) {
  return String(index + 1).padStart(2, "0");
}

function getCategoryDefinitions() {
  const categories = new Map();

  function registerCategory(name, sections = []) {
    const categoryName = String(name || "").trim();
    if (!categoryName) {
      return;
    }

    if (!categories.has(categoryName)) {
      categories.set(categoryName, new Set());
    }

    const sectionSet = categories.get(categoryName);
    sections.forEach((section) => {
      const sectionName = String(section || "").trim();
      if (sectionName) {
        sectionSet.add(sectionName);
      }
    });
  }

  state.categories.forEach((category) => {
    const categoryName =
      typeof category === "string" ? category : category?.name;
    const sections = Array.isArray(category?.sections)
      ? category.sections
      : [];
    registerCategory(categoryName, sections);
  });

  state.resources.forEach((resource) => {
    registerCategory(resource.category || "未分类素材", [
      resource.section || "",
    ]);
  });

  return [...categories.entries()]
    .sort(([left], [right]) => compareCategoryNames(left, right))
    .map(([name, sections]) => ({
      name,
      sections: [...sections].sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
    }));
}

function matchesMaterialQuery(resource, query) {
  const searchable = [
    resource.category,
    resource.section,
    resource.title,
    resource.description,
    resource.file,
  ].join(" ");
  return normalizeText(searchable).includes(query);
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
  meta.textContent = resource.section || resource.category || "上传素材";

  copy.append(title, meta);

  const count = document.createElement("span");
  count.className = "resource-count";
  count.textContent = String((state.decks.get(resource.id) || []).length);

  button.append(badge, copy, count);
  button.addEventListener("click", () => {
    state.activeResourceId = resource.id;
    state.view = "all";
    state.query = "";
    state.favoriteCategory = "all";
    elements.searchInput.value = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  return button;
}

function renderResourceList() {
  const query = normalizeText(state.materialQuery).trim();
  const definitions = getCategoryDefinitions();
  const fragment = document.createDocumentFragment();
  let visibleResourceCount = 0;
  let visibleCategoryCount = 0;

  definitions.forEach((category) => {
    const categoryResources = state.resources.filter(
      (resource) =>
        (resource.category || "未分类素材") === category.name,
    );
    const categoryNameMatches =
      Boolean(query) && normalizeText(category.name).includes(query);
    const visibleResources = categoryResources.filter(
      (resource) =>
        !query || categoryNameMatches || matchesMaterialQuery(resource, query),
    );

    const sectionNames = new Set(category.sections);
    categoryResources.forEach((resource) => {
      if (resource.section) {
        sectionNames.add(resource.section);
      }
    });
    visibleResources.forEach((resource) => {
      if (resource.section) {
        sectionNames.add(resource.section);
      }
    });

    const visibleSections = [...sectionNames].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    ).filter((section) => {
      if (!query || categoryNameMatches) {
        return true;
      }
      return (
        normalizeText(section).includes(query) ||
        visibleResources.some((resource) => resource.section === section)
      );
    });

    if (
      query &&
      !categoryNameMatches &&
      visibleResources.length === 0 &&
      visibleSections.length === 0
    ) {
      return;
    }

    visibleCategoryCount += 1;
    visibleResourceCount += visibleResources.length;

    const group = document.createElement("section");
    group.className = "resource-group";

    const heading = document.createElement("div");
    heading.className = "resource-group-heading";

    const headingName = document.createElement("strong");
    headingName.textContent = category.name;

    const headingCount = document.createElement("span");
    headingCount.textContent = String(visibleResources.length);

    heading.append(headingName, headingCount);
    group.append(heading);

    const directResources = visibleResources.filter(
      (resource) => !resource.section,
    );
    directResources.forEach((resource) => {
      group.append(
        createResourceButton(resource, state.resources.indexOf(resource)),
      );
    });

    visibleSections.forEach((section) => {
      const sectionResources = visibleResources.filter(
        (resource) => resource.section === section,
      );
      const sectionLabel = document.createElement("div");
      sectionLabel.className = "resource-section-label";
      sectionLabel.textContent = section;
      group.append(sectionLabel);

      if (sectionResources.length === 0) {
        const empty = document.createElement("p");
        empty.className = "resource-empty";
        empty.textContent = "暂无素材";
        group.append(empty);
        return;
      }

      sectionResources.forEach((resource) => {
        group.append(
          createResourceButton(resource, state.resources.indexOf(resource)),
        );
      });
    });

    if (!directResources.length && !visibleSections.length) {
      const empty = document.createElement("p");
      empty.className = "resource-empty";
      empty.textContent = "暂无素材";
      group.append(empty);
    }

    fragment.append(group);
  });

  if (visibleCategoryCount === 0) {
    const empty = document.createElement("p");
    empty.className = "resource-search-empty";
    empty.textContent = "没有找到匹配素材";
    fragment.append(empty);
  }

  elements.resourceList.replaceChildren(fragment);
  elements.resourceCount.textContent = String(
    query ? visibleResourceCount : state.resources.length,
  );
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
  source.textContent = resource.description || resource.title;
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
  sentence.append(createSentenceText(item.sentence));

  if (item.translation) {
    const translation = document.createElement("span");
    translation.className = "translation";
    translation.textContent = item.translation;
    sentence.append(translation);
  }

  const answerPanel = document.createElement("div");
  const meaningVisible = isMeaningVisible(itemKey);
  answerPanel.className = "answer-panel";
  answerPanel.classList.toggle("is-visible", meaningVisible);

  const meaningRevealButton = document.createElement("button");
  meaningRevealButton.className = "meaning-reveal-button";
  meaningRevealButton.type = "button";
  meaningRevealButton.textContent = meaningVisible
    ? "关闭本条释义"
    : "显示本条释义";
  meaningRevealButton.setAttribute(
    "aria-expanded",
    String(meaningVisible),
  );
  meaningRevealButton.setAttribute(
    "aria-label",
    `${meaningVisible ? "关闭" : "显示"} ${item.phrase} 的释义`,
  );
  meaningRevealButton.addEventListener("click", () => {
    const visible = isMeaningVisible(itemKey);
    if (state.showAllMeanings) {
      if (visible) {
        state.meaningHides.add(itemKey);
      } else {
        state.meaningHides.delete(itemKey);
      }
    } else if (visible) {
      state.meaningReveals.delete(itemKey);
    } else {
      state.meaningReveals.add(itemKey);
    }
    render();
  });

  answerPanel.append(meaningRevealButton, meaning, sentence);

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
  card.append(head, answerPanel, actions);
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

function renderCollectionFilters() {
  const isFavoritesView = state.view === "favorites";
  elements.collectionFilters.hidden = !isFavoritesView;

  if (!isFavoritesView) {
    elements.collectionFilterList.replaceChildren();
    return;
  }

  const definitions = getCategoryDefinitions();
  const categoryNames = new Set(definitions.map((category) => category.name));
  if (
    state.favoriteCategory !== "all" &&
    !categoryNames.has(state.favoriteCategory)
  ) {
    state.favoriteCategory = "all";
  }

  const favoriteEntries = getCollectionEntries(state.favorites, "all");
  const counts = new Map();
  favoriteEntries.forEach(({ resource }) => {
    counts.set(resource.category, (counts.get(resource.category) || 0) + 1);
  });

  const filters = [
    {
      category: "all",
      label: "全部收藏集",
      count: favoriteEntries.length,
    },
    ...definitions.map((category) => ({
      category: category.name,
      label: `${category.name}收藏集`,
      count: counts.get(category.name) || 0,
    })),
  ];

  const fragment = document.createDocumentFragment();
  filters.forEach((filter) => {
    const button = document.createElement("button");
    const isActive = filter.category === state.favoriteCategory;
    button.type = "button";
    button.className = "collection-filter-button";
    button.classList.toggle("is-active", isActive);
    button.dataset.category = filter.category;
    button.setAttribute("aria-pressed", String(isActive));

    const label = document.createElement("span");
    label.textContent = filter.label;

    const count = document.createElement("span");
    count.className = "collection-filter-count";
    count.textContent = String(filter.count);

    button.append(label, count);
    button.addEventListener("click", () => {
      state.favoriteCategory = filter.category;
      render();
    });
    fragment.append(button);
  });

  elements.collectionFilterList.replaceChildren(fragment);
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

function updateMeaningControls() {
  elements.showAllMeaningsButton.classList.toggle(
    "is-active",
    state.showAllMeanings,
  );
  elements.hideAllMeaningsButton.classList.toggle(
    "is-active",
    !state.showAllMeanings,
  );
  elements.showAllMeaningsButton.setAttribute(
    "aria-pressed",
    String(state.showAllMeanings),
  );
  elements.hideAllMeaningsButton.setAttribute(
    "aria-pressed",
    String(!state.showAllMeanings),
  );
}

function render() {
  closeWordPopover();
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
    const isAllFavorites = state.favoriteCategory === "all";
    const collectionName = isAllFavorites
      ? "全部收藏集"
      : `${state.favoriteCategory}收藏集`;
    elements.activeTitle.textContent = collectionName;
    elements.activeDescription.textContent = isAllFavorites
      ? "汇总所有素材中手动收藏的词汇，方便集中复习。"
      : `汇总“${state.favoriteCategory}”分类中手动收藏的词汇，方便集中复习。`;
    elements.footerResource.textContent = `${collectionName} · ${visibleEntries.length} 条`;
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
      title.textContent =
        state.favoriteCategory === "all"
          ? "收藏集还是空的"
          : `${state.favoriteCategory}收藏集还是空的`;
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
  updateMeaningControls();
  renderCollectionFilters();
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
    state.categories = Array.isArray(manifest.categories)
      ? manifest.categories
      : [];
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
    state.categories = [];
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
elements.materialSearchInput.addEventListener("input", (event) => {
  state.materialQuery = event.target.value;
  renderResourceList();
});
elements.showAllMeaningsButton.addEventListener("click", () => {
  setAllMeaningsVisible(true);
});
elements.hideAllMeaningsButton.addEventListener("click", () => {
  setAllMeaningsVisible(false);
});
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
elements.wordPopoverClose.addEventListener("click", closeWordPopover);
document.addEventListener("click", (event) => {
  if (
    elements.wordPopover.hidden ||
    elements.wordPopover.contains(event.target) ||
    event.target.closest(".word-lookup")
  ) {
    return;
  }
  closeWordPopover();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.wordPopover.hidden) {
    const button = activeWordButton;
    closeWordPopover();
    button?.focus();
  }
});
window.addEventListener("resize", closeWordPopover);
window.addEventListener("scroll", closeWordPopover, { passive: true });

restoreMarks();
checkSession();
