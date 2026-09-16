const CSV_PATH = "./anki-modern-family-S01E01.csv";

const elements = {
  cardGrid: document.querySelector("#cardGrid"),
  emptyState: document.querySelector("#emptyState"),
  searchInput: document.querySelector("#searchInput"),
  clearSearch: document.querySelector("#clearSearch"),
  visibleCount: document.querySelector("#visibleCount"),
  totalCount: document.querySelector("#totalCount"),
  deckName: document.querySelector("#deckName"),
};

let allCards = [];

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

  return rows.filter((currentRow) => currentRow.some((value) => value.length > 0));
}

function parseDeck(text) {
  const metadata = {};
  const dataRows = [];

  parseCsv(text.replace(/^\uFEFF/, "")).forEach((row) => {
    if (row[0]?.startsWith("#")) {
      const separatorIndex = row[0].indexOf(":");
      if (separatorIndex > 0) {
        metadata[row[0].slice(0, separatorIndex)] = row[0].slice(separatorIndex + 1);
      }
      return;
    }

    dataRows.push(row);
  });

  const columns = String(metadata["#columns"] || "Front,Back")
    .split(",")
    .map((column) => column.trim());
  const frontIndex = columns.indexOf("Front");
  const backIndex = columns.indexOf("Back");

  return {
    deck: metadata["#deck"] || "追剧英语",
    cards: dataRows
      .map((row) => ({
        front: String(row[frontIndex] || "").trim(),
        back: String(row[backIndex] || "").trim(),
      }))
      .filter((card) => card.front || card.back),
  };
}

function normalizeSearchText(value) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function getMatchingCards() {
  const terms = normalizeSearchText(elements.searchInput.value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return allCards;
  }

  return allCards.filter((card) => {
    const haystack = normalizeSearchText(`${card.front} ${card.back}`);
    return terms.every((term) => haystack.includes(term));
  });
}

function createCard(card, index) {
  const article = document.createElement("article");
  article.className = "vocab-card";

  const number = document.createElement("span");
  number.className = "card-index";
  number.setAttribute("aria-hidden", "true");
  number.textContent = String(index + 1).padStart(2, "0");

  const front = document.createElement("p");
  front.className = "front";
  front.lang = "en";
  front.textContent = card.front;

  const divider = document.createElement("div");
  divider.className = "divider";
  divider.setAttribute("aria-hidden", "true");

  const back = document.createElement("p");
  back.className = "back";
  back.lang = "zh-CN";
  back.textContent = card.back;

  article.append(number, front, divider, back);
  return article;
}

function render() {
  const matchingCards = getMatchingCards();
  const fragment = document.createDocumentFragment();

  matchingCards.forEach((card, index) => {
    fragment.append(createCard(card, index));
  });

  elements.cardGrid.replaceChildren(fragment);
  elements.visibleCount.textContent = String(matchingCards.length);
  elements.totalCount.textContent = String(allCards.length);
  elements.emptyState.hidden = matchingCards.length !== 0;
  elements.cardGrid.hidden = matchingCards.length === 0;
  elements.clearSearch.hidden = elements.searchInput.value.length === 0;
}

async function loadDeck() {
  try {
    const response = await fetch(CSV_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`CSV request failed with status ${response.status}`);
    }

    const text = await response.text();
    const deck = parseDeck(text);
    allCards = deck.cards;
    elements.deckName.textContent = deck.deck;
    render();
  } catch (error) {
    elements.cardGrid.hidden = true;
    elements.emptyState.hidden = false;
    elements.emptyState.querySelector("strong").textContent = "卡片加载失败";
    elements.emptyState.querySelector("span").textContent = "请刷新页面后重试";
    console.error(error);
  }
}

elements.searchInput.addEventListener("input", render);
elements.clearSearch.addEventListener("click", () => {
  elements.searchInput.value = "";
  elements.searchInput.focus();
  render();
});

loadDeck();
