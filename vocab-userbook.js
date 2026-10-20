/**
 * 「我的词书」：用户自己导入的词书 + 逐词进度（v1）。
 *
 * 词汇库页的分工：
 *   · 不会的单词  → vocab-library.js（各模块标记「不会」的词 + 词书里标「不会」的词）
 *   · 我的词书    → 本文件（用户导入的词书，逐词记 未背 / 已斩 / 模糊 / 不会）
 *
 * 存储（两个键都是「清单型」，account-store 已登记，多端按条并集合并）：
 *   iball_vocab_userbooks_v1
 *     [{ id, name, note, words: [{word, phonetic, meaning}], createdAt, updatedAt }]
 *   iball_vocab_userbook_progress_v1
 *     [{ deck, word, status, reviews, firstAt, lastAt, source, updatedAt }]
 *
 * 进度按「一条记录 = 一个 deck+word」保存，两台设备各背几个词时互相不会覆盖；
 * 同一个词两边都改过，按同步顺序后到的一方为准（并在验收报告里注明）。
 *
 * 互通：进度标成 unknown（不会）的词自动进 IballVocabLibrary；改回
 * 已斩 / 模糊时撤掉该词书来源，词从「不会的单词」里移出。
 */
(function () {
  "use strict";

  const BOOKS_KEY = "iball_vocab_userbooks_v1";
  const PROGRESS_KEY = "iball_vocab_userbook_progress_v1";
  const MAX_BOOKS = 60;
  const MAX_WORDS_PER_BOOK = 2000;
  const MAX_PROGRESS = 6000;
  const STATUSES = ["known", "fuzzy", "unknown"];
  const STATUS_LABELS = { known: "已斩", fuzzy: "模糊", unknown: "不会", none: "未背" };
  const DECK_PREFIX = "userbook:";

  const listeners = new Set();

  /* ------------------------------------------------------------- 小工具 */

  function normalizeWord(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function readArray(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeArray(key, list) {
    try {
      window.localStorage.setItem(key, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  function makeId() {
    const stamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 7);
    return `bk-${stamp}-${random}`;
  }

  function deckFor(bookId) {
    return `${DECK_PREFIX}${String(bookId || "").trim()}`;
  }

  function bookIdFromDeck(deck) {
    const text = String(deck || "");
    return text.startsWith(DECK_PREFIX) ? text.slice(DECK_PREFIX.length) : "";
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || "未背";
  }

  /* ------------------------------------------------------------- 词书 */

  function sanitizeWord(entry) {
    if (!entry) {
      return null;
    }
    const word = String(entry.word ?? entry[0] ?? "").trim();
    if (!word) {
      return null;
    }
    return {
      word,
      phonetic: String(entry.phonetic || "").trim(),
      meaning: String(entry.meaning || entry.translation || "").trim(),
    };
  }

  function sanitizeBook(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const id = String(raw.id || "").trim();
    if (!id) {
      return null;
    }
    const seen = new Set();
    const words = [];
    (Array.isArray(raw.words) ? raw.words : []).forEach((item) => {
      const word = sanitizeWord(item);
      if (!word) {
        return;
      }
      const key = normalizeWord(word.word);
      if (!key || seen.has(key) || words.length >= MAX_WORDS_PER_BOOK) {
        return;
      }
      seen.add(key);
      words.push(word);
    });
    return {
      id,
      name: String(raw.name || "未命名词书").slice(0, 60),
      note: String(raw.note || "").slice(0, 200),
      words,
      createdAt: Number(raw.createdAt || raw.updatedAt || Date.now()),
      updatedAt: Number(raw.updatedAt || raw.createdAt || Date.now()),
    };
  }

  function listBooks() {
    return readArray(BOOKS_KEY)
      .map(sanitizeBook)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function getBook(bookId) {
    const id = String(bookId || "").trim();
    if (!id) {
      return null;
    }
    return listBooks().find((book) => book.id === id) || null;
  }

  function saveBooks(books) {
    const trimmed = books
      .map(sanitizeBook)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_BOOKS);
    return writeArray(BOOKS_KEY, trimmed);
  }

  function createBook({ name, note = "", words = [] } = {}) {
    const cleanWords = [];
    const seen = new Set();
    (Array.isArray(words) ? words : []).forEach((item) => {
      const word = sanitizeWord(item);
      if (!word) {
        return;
      }
      const key = normalizeWord(word.word);
      if (!key || seen.has(key) || cleanWords.length >= MAX_WORDS_PER_BOOK) {
        return;
      }
      seen.add(key);
      cleanWords.push(word);
    });
    if (!cleanWords.length) {
      return null;
    }
    const now = Date.now();
    const book = {
      id: makeId(),
      name: String(name || "").trim().slice(0, 60) || `导入词书 ${cleanWords.length} 词`,
      note: String(note || "").slice(0, 200),
      words: cleanWords,
      createdAt: now,
      updatedAt: now,
    };
    const books = listBooks();
    if (books.length >= MAX_BOOKS) {
      books.sort((left, right) => left.updatedAt - right.updatedAt);
      books.shift();
    }
    books.unshift(book);
    if (!saveBooks(books)) {
      return null;
    }
    notify();
    return book;
  }

  function updateBook(bookId, patch = {}) {
    const id = String(bookId || "").trim();
    if (!id) {
      return null;
    }
    let updated = null;
    const books = listBooks().map((book) => {
      if (book.id !== id) {
        return book;
      }
      updated = {
        ...book,
        name:
          patch.name === undefined
            ? book.name
            : String(patch.name || "").trim().slice(0, 60) || book.name,
        note: patch.note === undefined ? book.note : String(patch.note || "").slice(0, 200),
        words: Array.isArray(patch.words) ? patch.words : book.words,
        updatedAt: Date.now(),
      };
      return updated;
    });
    if (!updated || !saveBooks(books)) {
      return null;
    }
    notify();
    return updated;
  }

  function removeBook(bookId) {
    const id = String(bookId || "").trim();
    if (!id) {
      return false;
    }
    const books = listBooks();
    const next = books.filter((book) => book.id !== id);
    if (next.length === books.length) {
      return false;
    }
    saveBooks(next);
    // 词书没了，这本书的进度和「不会的单词」来源也一起清掉，避免脏数据。
    const deck = deckFor(id);
    const progress = listProgressRaw();
    const kept = progress.filter((item) => item.deck !== deck);
    if (kept.length !== progress.length) {
      writeArray(PROGRESS_KEY, kept);
    }
    const api = window.IballVocabLibrary;
    if (api?.removeSource) {
      api.list().forEach((record) => {
        api.removeSource(
          record.word,
          (source) => source?.level === "wordbook" && source?.bookId === id,
        );
      });
    }
    notify();
    return true;
  }

  /* ------------------------------------------------------------- 进度 */

  function progressId(deck, word) {
    return `${String(deck || "").trim()}::${normalizeWord(word)}`;
  }

  function sanitizeProgress(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const deck = String(raw.deck || "").trim();
    const word = String(raw.word || "").trim();
    const status = STATUSES.includes(raw.status) ? raw.status : "";
    if (!deck || !word || !status) {
      return null;
    }
    return {
      deck,
      word,
      status,
      reviews: Math.max(0, Number(raw.reviews) || 1),
      firstAt: String(raw.firstAt || raw.lastAt || ""),
      lastAt: String(raw.lastAt || raw.firstAt || ""),
      source: String(raw.source || ""),
      updatedAt: Number(raw.updatedAt || Date.now()),
    };
  }

  function listProgressRaw() {
    return readArray(PROGRESS_KEY).map(sanitizeProgress).filter(Boolean);
  }

  function listProgress(deck) {
    const progress = listProgressRaw();
    return deck ? progress.filter((item) => item.deck === deck) : progress;
  }

  function getProgress(deck, word) {
    const id = progressId(deck, word);
    return (
      listProgressRaw().find((item) => progressId(item.deck, item.word) === id) ||
      null
    );
  }

  function progressMap(deck) {
    const map = new Map();
    listProgress(deck).forEach((item) => {
      map.set(normalizeWord(item.word), item);
    });
    return map;
  }

  /** 同一个词在任意词书 / 任意状态里最近的一次记录，供「不会的单词」筛进度用。 */
  function latestStatusFor(word) {
    const key = normalizeWord(word);
    if (!key) {
      return null;
    }
    let best = null;
    listProgressRaw().forEach((item) => {
      if (normalizeWord(item.word) !== key) {
        return;
      }
      const at = Date.parse(item.lastAt) || item.updatedAt || 0;
      if (!best || at >= best.at) {
        best = { status: item.status, at, deck: item.deck };
      }
    });
    return best;
  }

  function syncLibrarySource(record, book) {
    const api = window.IballVocabLibrary;
    if (!api) {
      return;
    }
    const isUnknown = record.status === "unknown";
    if (isUnknown) {
      api.add({
        word: record.word,
        source: {
          level: "wordbook",
          module: "userbook",
          bookId: book?.id || bookIdFromDeck(record.deck),
          bookTitle: book?.name || "我的词书",
          kind: "词书",
          at: Date.now(),
        },
      });
      return;
    }
    if (api.removeSource) {
      api.removeSource(
        record.word,
        (source) =>
          source?.level === "wordbook" &&
          source?.bookId === (book?.id || bookIdFromDeck(record.deck)),
      );
    }
  }

  /**
   * 记一次词书进度。
   *
   * @param {{deck: string, word: string, status: string, phonetic?: string,
   *          meaning?: string, source?: string}} entry
   */
  function setStatus(entry) {
    const deck = String(entry?.deck || "").trim();
    const word = String(entry?.word || "").trim();
    const status = STATUSES.includes(entry?.status) ? entry.status : "";
    if (!deck || !word || !status) {
      return null;
    }
    const id = progressId(deck, word);
    const previous = getProgress(deck, word);
    const now = Date.now();
    const record = {
      deck,
      word,
      status,
      reviews: previous && previous.status === status ? previous.reviews : (previous?.reviews || 0) + 1,
      firstAt: previous?.firstAt || new Date(now).toISOString(),
      lastAt: new Date(now).toISOString(),
      source: String(entry.source || previous?.source || ""),
      updatedAt: now,
    };
    const progress = listProgressRaw().filter(
      (item) => progressId(item.deck, item.word) !== id,
    );
    progress.unshift(record);
    if (!writeArray(PROGRESS_KEY, progress.slice(0, MAX_PROGRESS))) {
      return null;
    }
    const book = getBook(bookIdFromDeck(deck));
    syncLibrarySource(record, book);
    notify();
    return record;
  }

  function clearStatus(deck, word) {
    const id = progressId(deck, word);
    const progress = listProgressRaw();
    const next = progress.filter(
      (item) => progressId(item.deck, item.word) !== id,
    );
    if (next.length === progress.length) {
      return false;
    }
    writeArray(PROGRESS_KEY, next);
    const api = window.IballVocabLibrary;
    const bookId = bookIdFromDeck(deck);
    if (api?.removeSource) {
      api.removeSource(
        word,
        (source) => source?.level === "wordbook" && source?.bookId === bookId,
      );
    }
    notify();
    return true;
  }

  function summary(deck) {
    const totals = { total: 0, known: 0, fuzzy: 0, unknown: 0, none: 0 };
    const progress = listProgress(deck);
    progress.forEach((item) => {
      totals.total += 1;
      if (totals[item.status] !== undefined) {
        totals[item.status] += 1;
      }
    });
    if (deck) {
      const book = getBook(bookIdFromDeck(deck));
      totals.none = Math.max(0, (book?.words.length || 0) - totals.total);
    }
    return totals;
  }

  /* ------------------------------------------------------------- 导入解析 */

  const WORD_PATTERN = /^[A-Za-z][A-Za-z'’.\- ]{0,48}$/;

  function cleanCell(value) {
    return String(value ?? "")
      .replace(/^\uFEFF/, "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
  }

  function splitLine(line) {
    const text = String(line || "").trim();
    if (!text || text.startsWith("#")) {
      return null;
    }
    const delimiters = ["\t", ",", "，", "|", ";", "；"];
    for (const delimiter of delimiters) {
      if (text.includes(delimiter)) {
        const parts = text.split(delimiter).map(cleanCell);
        const head = parts.shift() || "";
        if (WORD_PATTERN.test(head)) {
          return { word: head, meaning: parts.filter(Boolean).join("；") };
        }
      }
    }
    const spaced = text.match(/^([A-Za-z][A-Za-z'’.\- ]*?)\s+(.*)$/);
    if (spaced && WORD_PATTERN.test(spaced[1].trim())) {
      return { word: spaced[1].trim(), meaning: cleanCell(spaced[2]) };
    }
    return WORD_PATTERN.test(text) ? { word: text, meaning: "" } : null;
  }

  /**
   * 解析导入内容。支持：
   *   · JSON：["apple", ...] / [{word, meaning, phonetic}] / {words: [...]}
   *   · CSV / TSV / 纯文本：一行一个词，可写 `word,释义,音标` 或 `word 释义`
   * 表头行（word/单词）会自动跳过。
   */
  function parseImport(text) {
    const raw = String(text || "").trim();
    if (!raw) {
      return [];
    }
    if (/^[[{]/.test(raw)) {
      try {
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.words)
            ? parsed.words
            : Array.isArray(parsed?.list)
              ? parsed.list
              : [];
        const words = [];
        list.forEach((item) => {
          if (typeof item === "string") {
            const parsedLine = splitLine(item) || { word: item, meaning: "" };
            if (WORD_PATTERN.test(parsedLine.word)) {
              words.push(parsedLine);
            }
            return;
          }
          const word = sanitizeWord({
            word: item?.word || item?.headWord || item?.name,
            phonetic: item?.phonetic || item?.usphone || item?.ukphone || "",
            meaning:
              item?.meaning ||
              item?.translation ||
              item?.definition ||
              (Array.isArray(item?.translations)
                ? item.translations
                    .map((entry) => entry?.translation || entry?.desc || "")
                    .filter(Boolean)
                    .join("；")
                : ""),
          });
          if (word && WORD_PATTERN.test(word.word)) {
            words.push(word);
          }
        });
        return dedupe(words);
      } catch {
        // 不是合法 JSON 就按纯文本继续解析。
      }
    }
    const words = [];
    raw.split(/\r?\n/).forEach((line) => {
      const parsed = splitLine(line);
      if (!parsed) {
        return;
      }
      if (/^(word|单词|词条)$/i.test(parsed.word)) {
        return;
      }
      words.push(parsed);
    });
    return dedupe(words);
  }

  function dedupe(words) {
    const seen = new Set();
    const result = [];
    words.forEach((item) => {
      const word = sanitizeWord(item);
      if (!word) {
        return;
      }
      const key = normalizeWord(word.word);
      if (!key || seen.has(key) || result.length >= MAX_WORDS_PER_BOOK) {
        return;
      }
      seen.add(key);
      result.push(word);
    });
    return result;
  }

  function exportBook(bookId) {
    const book = getBook(bookId);
    if (!book) {
      return "";
    }
    const progress = progressMap(deckFor(book.id));
    const lines = ["word,meaning,phonetic,status"];
    book.words.forEach((word) => {
      const record = progress.get(normalizeWord(word.word));
      const cells = [
        word.word,
        word.meaning,
        word.phonetic,
        record ? statusLabel(record.status) : "未背",
      ].map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    });
    return lines.join("\n");
  }

  /* ------------------------------------------------------------- 订阅 */

  function notify() {
    const snapshot = { books: listBooks(), progress: listProgressRaw() };
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn("[iball] 词书监听器出错", error);
      }
    });
    try {
      window.dispatchEvent(
        new CustomEvent("iball:vocab-userbook-change", {
          detail: { books: snapshot.books.length },
        }),
      );
    } catch {
      // 老浏览器不支持 CustomEvent 构造时忽略。
    }
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  window.addEventListener("storage", (event) => {
    const key = String(event?.key || "");
    if (key.endsWith(`:${BOOKS_KEY}`) || key.endsWith(`:${PROGRESS_KEY}`)) {
      notify();
    }
  });

  window.IballVocabUserbook = {
    BOOKS_KEY,
    PROGRESS_KEY,
    STATUSES,
    statusLabel,
    normalizeWord,
    deckFor,
    bookIdFromDeck,
    listBooks,
    getBook,
    createBook,
    updateBook,
    removeBook,
    listProgress,
    getProgress,
    progressMap,
    latestStatusFor,
    setStatus,
    clearStatus,
    summary,
    parseImport,
    exportBook,
    subscribe,
  };
})();
