/**
 * 词汇库：把各模块里标记为「不会」的单词统一归集到一份可筛选、可追溯的清单。
 *
 * 数据键 iball_vocab_library_v1 是数组，account-store 已经把它登记成
 * 「清单型」键：多设备同步时按 word 做并集合并 + 删除墓碑，
 * 手机 / 平板离线新增的单词不会被整键覆盖冲掉。
 *
 * 记录结构：
 *   {
 *     word, phonetic, meaning, status: "unknown",
 *     sources: [{
 *       level, module, paperId, paperTitle, pieceId, pieceTitle,
 *       kind, question, paragraph, sentence, translation, url, at,
 *     }],
 *     at, updatedAt,
 *   }
 *
 * 同一个词在不同模块、不同文章里出现时保留全部来源，词条只存一条；
 * 来源里的 url 是回跳原文的地址，带上 ?word= 参数让原文高亮定位。
 */
(function () {
  "use strict";

  const KEY = "iball_vocab_library_v1";
  const MAX_ENTRIES = 3000;
  const MAX_SOURCES_PER_WORD = 12;

  const LEVEL_LABELS = {
    cet4: "四级",
    cet6: "六级",
    kaoyan: "考研",
    periodical: "外刊",
    basic: "零基础",
    wordbook: "我的词书",
  };
  const MODULE_LABELS = {
    reading: "阅读",
    listening: "听力",
    writing: "写作",
    exam: "真题",
    periodical: "外刊",
    userbook: "词书",
  };

  const listeners = new Set();

  function normalize(word) {
    return String(word ?? "").trim().toLowerCase();
  }

  function levelLabel(level) {
    return LEVEL_LABELS[level] || String(level || "其他");
  }

  function moduleLabel(module) {
    return MODULE_LABELS[module] || String(module || "真题");
  }

  /** 「四级阅读」「六级听力」「外刊」这种来源短标签。 */
  function sourceLabel(source) {
    if (!source) {
      return "其他";
    }
    if (source.level === "wordbook" || source.module === "userbook") {
      return "我的词书";
    }
    if (source.level === "periodical" || source.module === "periodical") {
      return "外刊";
    }
    return `${levelLabel(source.level)}${moduleLabel(source.module)}`;
  }

  function sourceKey(source) {
    return [
      source?.level || "",
      source?.module || "",
      source?.bookId || "",
      source?.paperId || "",
      source?.pieceId || "",
      source?.kind || "",
      source?.question || "",
      source?.sentence || "",
    ].join("|");
  }

  function readRaw() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeRaw(list) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  function normalizeRecord(record) {
    if (!record || typeof record !== "object") {
      return null;
    }
    const word = String(record.word || "").trim();
    if (!word) {
      return null;
    }
    const sources = Array.isArray(record.sources)
      ? record.sources.filter((item) => item && typeof item === "object")
      : record.source && typeof record.source === "object"
        ? [record.source]
        : [];
    return {
      word,
      phonetic: String(record.phonetic || ""),
      meaning: String(record.meaning || ""),
      status: "unknown",
      sources,
      at: Number(record.at || record.updatedAt || Date.now()),
      updatedAt: Number(record.updatedAt || record.at || Date.now()),
    };
  }

  function list() {
    return readRaw()
      .map(normalizeRecord)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function get(word) {
    const key = normalize(word);
    if (!key) {
      return null;
    }
    return list().find((record) => normalize(record.word) === key) || null;
  }

  function has(word) {
    return Boolean(get(word));
  }

  function count() {
    return readRaw().length;
  }

  function notify() {
    const snapshot = list();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn("[iball] 词汇库监听器出错", error);
      }
    });
    try {
      window.dispatchEvent(
        new CustomEvent("iball:vocab-library-change", {
          detail: { count: snapshot.length },
        }),
      );
    } catch {
      // 老浏览器不支持 CustomEvent 构造时忽略。
    }
  }

  /**
   * 把一个生词收进词汇库。
   *
   * @param {{word: string, phonetic?: string, meaning?: string, source?: object}} entry
   * @returns {object|null} 落库后的记录；写失败返回 null。
   */
  function add(entry) {
    const word = String(entry?.word || "").trim();
    const key = normalize(word);
    if (!key) {
      return null;
    }
    const source =
      entry.source && typeof entry.source === "object"
        ? { ...entry.source, at: Number(entry.source.at || Date.now()) }
        : null;
    const now = Date.now();
    const records = list();
    const existing = records.find((record) => normalize(record.word) === key);
    let record;
    if (existing) {
      const sources = Array.isArray(existing.sources) ? [...existing.sources] : [];
      if (source) {
        const incomingKey = sourceKey(source);
        const duplicated = sources.some((item) => sourceKey(item) === incomingKey);
        if (duplicated) {
          const index = sources.findIndex(
            (item) => sourceKey(item) === incomingKey,
          );
          // 同一条来源重复标记时只刷新时间，避免来源列表无限膨胀。
          sources[index] = { ...sources[index], ...source, at: now };
        } else {
          sources.unshift(source);
        }
      }
      record = {
        ...existing,
        word: existing.word || word,
        phonetic:
          existing.phonetic || String(entry.phonetic || "").trim(),
        meaning: String(entry.meaning || "").trim() || existing.meaning,
        status: "unknown",
        sources: sources.slice(0, MAX_SOURCES_PER_WORD),
        updatedAt: now,
      };
    } else {
      record = {
        word,
        phonetic: String(entry?.phonetic || "").trim(),
        meaning: String(entry?.meaning || "").trim(),
        status: "unknown",
        sources: source ? [source] : [],
        at: now,
        updatedAt: now,
      };
    }
    const next = [record, ...records.filter((item) => normalize(item.word) !== key)];
    const trimmed = next.slice(0, MAX_ENTRIES);
    if (!writeRaw(trimmed)) {
      return null;
    }
    notify();
    return record;
  }

  function remove(word) {
    const key = normalize(word);
    if (!key) {
      return false;
    }
    const records = list();
    const next = records.filter((record) => normalize(record.word) !== key);
    if (next.length === records.length) {
      return false;
    }
    writeRaw(next);
    notify();
    return true;
  }

  function removeMany(words) {
    const keys = new Set(
      (Array.isArray(words) ? words : [words]).map(normalize).filter(Boolean),
    );
    if (!keys.size) {
      return 0;
    }
    const records = list();
    const next = records.filter((record) => !keys.has(normalize(record.word)));
    const removed = records.length - next.length;
    if (removed > 0) {
      writeRaw(next);
      notify();
    }
    return removed;
  }

  /**
   * 只撤掉某一条来源，来源都撤完时删掉整个词条。
   *
   * 用于「词书里标不会的词自动进词汇库，改回已斩 / 模糊后移出」这类场景：
   * 各模块自己标进来的来源不会被误删。
   *
   * @param {string} word
   * @param {(source: object) => boolean} predicate 返回 true 的来源会被撤掉
   * @returns {boolean} 是否有改动
   */
  function removeSource(word, predicate) {
    const key = normalize(word);
    if (!key || typeof predicate !== "function") {
      return false;
    }
    const records = list();
    const record = records.find((item) => normalize(item.word) === key);
    if (!record) {
      return false;
    }
    const sources = Array.isArray(record.sources) ? record.sources : [];
    const kept = sources.filter((source) => {
      try {
        return !predicate(source);
      } catch {
        return true;
      }
    });
    if (kept.length === sources.length) {
      return false;
    }
    const next = records.filter((item) => normalize(item.word) !== key);
    if (kept.length) {
      next.unshift({
        ...record,
        sources: kept,
        updatedAt: Date.now(),
      });
    }
    if (!writeRaw(next)) {
      return false;
    }
    notify();
    return true;
  }

  function clear() {
    writeRaw([]);
    notify();
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** 生成某条来源的回跳地址：没有现成 url 时按模块拼一个。 */
  function returnUrl(source) {
    if (!source) {
      return "";
    }
    if (source.url) {
      return String(source.url);
    }
    if (source.level === "wordbook" || source.module === "userbook") {
      const bookId = String(source.bookId || "").trim();
      return bookId ? `./vocab.html?userbook=${encodeURIComponent(bookId)}` : "";
    }
    const word = String(source.word || "").trim();
    const params = new URLSearchParams();
    if (word) {
      params.set("word", word);
    }
    if (source.issueId) {
      params.set("issue", String(source.issueId));
      return `./periodical.html?${params.toString()}`;
    }
    if (source.paperId) {
      params.set("paper", String(source.paperId));
    }
    if (source.pieceId) {
      params.set("piece", String(source.pieceId));
    }
    const page =
      source.level === "kaoyan"
        ? "./kaoyan.html"
        : source.module === "listening"
          ? "./intensive.html"
          : source.module === "reading" && source.level === "cet6"
            ? "./cet6-reading.html"
            : "./reading-intensive.html";
    return `${page}?${params.toString()}`;
  }

  /** 一条来源的完整描述：四级阅读 · 2023年6月第1套 · 仔细阅读 · 第3题。 */
  function describeSource(source) {
    if (!source) {
      return "";
    }
    const parts = [sourceLabel(source)];
    if (source.bookTitle) {
      parts.push(String(source.bookTitle));
    }
    if (source.paperTitle) {
      parts.push(String(source.paperTitle));
    }
    if (source.pieceTitle) {
      parts.push(String(source.pieceTitle));
    } else if (source.kind) {
      parts.push(String(source.kind));
    }
    if (source.question) {
      parts.push(`第${String(source.question).replace(/^第|\s*题$/g, "")}题`);
    } else if (source.paragraph) {
      parts.push(`第${source.paragraph}段`);
    }
    return parts.join(" · ");
  }

  // 同一浏览器不同标签页之间同步：account-store 写的是带命名空间前缀的原始键，
  // 这里按后缀匹配，切回词汇库页面时自动刷新。
  window.addEventListener("storage", (event) => {
    if (event?.key && String(event.key).endsWith(`:${KEY}`)) {
      notify();
    }
  });

  window.IballVocabLibrary = {
    KEY,
    normalize,
    levelLabel,
    moduleLabel,
    sourceLabel,
    describeSource,
    returnUrl,
    add,
    remove,
    removeMany,
    removeSource,
    has,
    get,
    list,
    count,
    clear,
    subscribe,
  };
})();
