/**
 * Shared vocabulary data layer.
 *
 * Loaded by index.html (app.js) and review.html (review.js) so both pages agree
 * on CSV parsing, card ids, unit grouping, marks and spaced-repetition math.
 */
(function (global) {
  "use strict";

  const MANIFEST_PATH = "./resources.json";
  const DEFAULT_UNIT_SIZE = 50;
  const REVIEW_DAY_MS = 24 * 60 * 60 * 1000;
  const REVIEW_LEARNING_STEPS_MS = [60 * 1000, 10 * 60 * 1000];
  const REVIEW_MAX_INTERVAL_DAYS = 365;
  const REVIEW_GRADES = ["again", "hard", "good", "easy"];
  const STORAGE_KEYS = {
    known: "iball-listening-cabin-known",
    favorites: "iball-listening-cabin-favorites",
    unknown: "iball-listening-cabin-unknown",
    reviewProgress: "iball-listening-cabin-review-v1",
    reviewDaily: "iball-listening-cabin-review-daily-v1",
    readings: "iball-listening-cabin-readings-v1",
  };

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

  function normalizeCsvHeader(value) {
    return String(value || "")
      .replace(/^\uFEFF/, "")
      .trim();
  }

  function findVocabularyHeaderRow(rows) {
    return rows.findIndex((row) => {
      const headers = row.map(normalizeCsvHeader);
      return (
        headers.includes("单词") &&
        (headers.includes("中文释义") ||
          headers.includes("英文例句") ||
          headers.includes("例句"))
      );
    });
  }

  function cleanVocabularyText(value) {
    return String(value || "")
      .replace(/\s*\d*\s*<<\s*零基础词汇讲义Level\s*\d+/gi, " ")
      .replace(/线｜教研团队/gi, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function removeEmbeddedVocabularyCard(value) {
    const marker =
      /\s+\d{1,4}\s*\.\s*[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3}\s+\/[^/\n]+\//;
    const match = marker.exec(value);
    return match ? value.slice(0, match.index) : value;
  }

  function splitVocabularyExample(value) {
    const englishParts = [];
    const chineseParts = [];
    const segments = String(value || "")
      .split(/\s*\|\s*/)
      .map((segment) => removeEmbeddedVocabularyCard(segment).trim())
      .filter(Boolean);

    segments.forEach((segment) => {
      const chineseIndex = segment.search(/[\u3400-\u9fff]/);
      const rawEnglish =
        chineseIndex >= 0 ? segment.slice(0, chineseIndex) : segment;
      const rawChinese = chineseIndex >= 0 ? segment.slice(chineseIndex) : "";
      const english = cleanVocabularyText(rawEnglish).replace(
        /^[\s,;:.!?-]+|[\s,;:|-]+$/g,
        "",
      );
      const chinese = cleanVocabularyText(rawChinese);

      if (english) {
        englishParts.push(english);
      }
      if (chinese) {
        chineseParts.push(chinese);
      }
    });

    return {
      sentence: englishParts.join(" | "),
      translation: chineseParts.join(" | "),
    };
  }

  function parseVocabularyDeck(rows, headerIndex, resource, index) {
    const headers = rows[headerIndex].map(normalizeCsvHeader);
    const findColumn = (...names) =>
      headers.findIndex((header) => names.includes(header));
    const phraseIndex = findColumn("单词", "词/短语", "Front");
    const phoneticIndex = findColumn("音标", "IPA");
    const partOfSpeechIndex = findColumn("词性");
    const meaningIndex = findColumn("中文释义", "释义", "Back");
    const sentenceIndex = findColumn("英文例句", "例句", "英文释义");

    if (phraseIndex < 0) {
      return [];
    }

    return rows
      .slice(headerIndex + 1)
      .map((row, itemIndex) => {
        const phrase = cleanVocabularyText(row[phraseIndex]);
        if (!phrase || findVocabularyHeaderRow([row]) === 0) {
          return null;
        }

        const partOfSpeech = cleanVocabularyText(row[partOfSpeechIndex]);
        const meaning = cleanVocabularyText(row[meaningIndex]);
        const example = splitVocabularyExample(row[sentenceIndex]);
        const combinedMeaning = [partOfSpeech, meaning]
          .filter(Boolean)
          .join(" ");

        return {
          id: `${resource.id}:${index + 1}:${itemIndex + 1}`,
          phrase,
          phonetic: cleanVocabularyText(row[phoneticIndex]),
          meaning: combinedMeaning || "查看例句理解用法",
          sentence: example.sentence || phrase,
          translation: example.translation,
        };
      })
      .filter(Boolean);
  }

  function parseAnkiDeck(text, resource, index) {
    const metadata = {};
    const dataRows = [];
    const rows = parseCsv(text.replace(/^\uFEFF/, ""));
    const vocabularyHeaderIndex = findVocabularyHeaderRow(rows);

    if (vocabularyHeaderIndex >= 0) {
      return parseVocabularyDeck(
        rows,
        vocabularyHeaderIndex,
        resource,
        index,
      );
    }

    rows.forEach((row) => {
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
    const phoneticIndex = findColumn("IPA", "音标");
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
    if (resource.attachment) {
      return [];
    }
    if (resource.format === "markdown-table") {
      return parseMarkdownDeck(text, resource, index);
    }
    return parseAnkiDeck(text, resource, index);
  }

  function formatUnitNumber(number) {
    return String(number).padStart(2, "0");
  }

  function buildDeckUnits(items, size = DEFAULT_UNIT_SIZE) {
    const units = [
      {
        index: -1,
        key: "all",
        label: "整套",
        detail: `全部 ${items.length} 张`,
        start: 0,
        end: items.length,
        items,
      },
    ];

    if (items.length <= size) {
      return units;
    }

    for (let start = 0; start < items.length; start += size) {
      const index = start / size + 1;
      const chunk = items.slice(start, start + size);
      units.push({
        index,
        key: `unit-${formatUnitNumber(index)}`,
        label: `Unit ${formatUnitNumber(index)}`,
        detail: `第 ${start + 1}-${start + chunk.length} 张 · ${chunk.length} 张`,
        start,
        end: start + chunk.length,
        items: chunk,
      });
    }

    return units;
  }

  function getItemKey(resourceId, item) {
    return `${resourceId}:${item.id}`;
  }

  function clampReviewEase(value) {
    return Math.min(3.1, Math.max(1.3, value));
  }

  function computeReviewSchedule(previous, grade, now = Date.now()) {
    const base = previous || {};
    const ease = clampReviewEase(Number(base.ease) || 2.5);
    const previousInterval = Math.max(0, Number(base.intervalDays) || 0);
    const reps = Math.max(0, Number(base.reps) || 0);
    const lapses = Math.max(0, Number(base.lapses) || 0);
    const status = base.status === "review" ? "review" : "learning";
    const step = Math.max(0, Number(base.step) || 0);
    const isReview = status === "review" && previousInterval >= 1;

    const schedule = (intervalDays, nextEase, nextStep, nextStatus, dueAt) => {
      const capped = Math.min(REVIEW_MAX_INTERVAL_DAYS, intervalDays);
      const fuzzed =
        capped >= 3 ? capped * (0.97 + Math.random() * 0.06) : capped;
      const finalDays = Math.max(0, Math.round(fuzzed * 100) / 100);
      return {
        ease: clampReviewEase(nextEase),
        intervalDays: finalDays,
        step: nextStep,
        status: nextStatus,
        reps: reps + 1,
        lapses,
        lastGrade: grade,
        reviewedAt: now,
        dueAt:
          Number.isFinite(dueAt) && dueAt > 0
            ? dueAt
            : now + finalDays * REVIEW_DAY_MS,
      };
    };

    if (grade === "again") {
      return schedule(0, ease - 0.2, 0, "learning", now + 60 * 1000);
    }

    if (grade === "hard") {
      if (isReview) {
        return schedule(
          Math.max(1, previousInterval * 1.2),
          ease - 0.15,
          step,
          "review",
        );
      }
      const delay = step === 0 ? 2 * 60 * 1000 : 8 * 60 * 1000;
      return schedule(0, ease, step, "learning", now + delay);
    }

    if (grade === "good") {
      if (isReview) {
        return schedule(previousInterval * ease, ease, step, "review");
      }
      const nextStep = step + 1;
      if (nextStep >= REVIEW_LEARNING_STEPS_MS.length) {
        return schedule(1, ease, nextStep, "review", now + REVIEW_DAY_MS);
      }
      return schedule(
        0,
        ease,
        nextStep,
        "learning",
        now + REVIEW_LEARNING_STEPS_MS[nextStep],
      );
    }

    if (isReview) {
      return schedule(
        Math.max(2, previousInterval * ease * 1.3),
        ease + 0.15,
        step,
        "review",
      );
    }

    const easyStep = Math.max(step, REVIEW_LEARNING_STEPS_MS.length);
    return schedule(4, ease + 0.15, easyStep, "review", now + 4 * REVIEW_DAY_MS);
  }

  function formatReviewInterval(milliseconds) {
    const value = Number(milliseconds);
    if (!Number.isFinite(value) || value <= 0) {
      return "现在";
    }

    const minutes = value / 60000;
    if (minutes < 1) {
      return "1 分钟内";
    }
    if (minutes < 60) {
      return `${Math.round(minutes)} 分钟后`;
    }

    const hours = minutes / 60;
    if (hours < 24) {
      return `${Math.round(hours)} 小时后`;
    }

    const days = Math.round(hours / 24);
    if (days < 30) {
      return `${days} 天后`;
    }
    if (days < 365) {
      return `${Math.round(days / 30)} 个月后`;
    }
    return `${Math.round(days / 365)} 年后`;
  }

  function getReviewDayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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

  function readJson(storageKey, fallback) {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      return stored === null || stored === undefined ? fallback : stored;
    } catch {
      return fallback;
    }
  }

  function writeJson(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function cleanReadingText(value, maxLength = 5000) {
    return String(value || "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxLength);
  }

  function hashReadingValue(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).padStart(6, "0");
  }

  function normalizeReadingWord(word, index = 0) {
    const phrase = cleanReadingText(word?.phrase, 120);
    if (!phrase) {
      return null;
    }

    const sentence = cleanReadingText(word?.sentence, 1200);
    const id =
      cleanReadingText(word?.id, 160).replace(/[^a-zA-Z0-9:_-]/g, "") ||
      `word-${index + 1}-${hashReadingValue(`${phrase}|${sentence}`)}`;

    return {
      id,
      phrase,
      phonetic: cleanReadingText(word?.phonetic, 120),
      meaning: cleanReadingText(word?.meaning, 800) || "查看上下文理解用法",
      sentence: sentence || phrase,
      translation: cleanReadingText(word?.translation, 1200),
      addedAt: Math.max(0, Number(word?.addedAt) || Date.now()),
    };
  }

  function normalizeReadingParagraph(paragraph, index = 0) {
    if (typeof paragraph === "string") {
      const english = cleanReadingText(paragraph, 8000);
      return english ? { id: `paragraph-${index + 1}`, english, chinese: "" } : null;
    }

    const english = cleanReadingText(paragraph?.english, 8000);
    if (!english) {
      return null;
    }

    return {
      id:
        cleanReadingText(paragraph?.id, 120).replace(/[^a-zA-Z0-9:_-]/g, "") ||
        `paragraph-${index + 1}`,
      english,
      chinese: cleanReadingText(paragraph?.chinese, 12000),
    };
  }

  function normalizeReadingDocument(document, index = 0) {
    if (!document || typeof document !== "object") {
      return null;
    }

    const title = cleanReadingText(document.title, 160) || `上传题目 ${index + 1}`;
    const category = cleanReadingText(document.category, 40) || "其他";
    const createdAt = Math.max(0, Number(document.createdAt) || Date.now());
    const id =
      cleanReadingText(document.id, 160).replace(/[^a-zA-Z0-9:_-]/g, "") ||
      `reading-${createdAt}-${hashReadingValue(`${category}|${title}`)}`;
    const paragraphs = (Array.isArray(document.paragraphs) ? document.paragraphs : [])
      .map(normalizeReadingParagraph)
      .filter(Boolean);
    const words = (Array.isArray(document.words) ? document.words : [])
      .map(normalizeReadingWord)
      .filter(Boolean);

    return {
      id,
      title,
      category,
      section: cleanReadingText(document.section, 80) || "上传阅读",
      createdAt,
      updatedAt: Math.max(0, Number(document.updatedAt) || createdAt),
      paragraphs,
      words,
    };
  }

  function getReadingDocuments() {
    const stored = readJson(STORAGE_KEYS.readings, []);
    const documents = Array.isArray(stored)
      ? stored
      : Array.isArray(stored?.documents)
        ? stored.documents
        : [];

    return documents
      .map(normalizeReadingDocument)
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function saveReadingDocument(document) {
    const normalized = normalizeReadingDocument(document);
    if (!normalized) {
      return null;
    }

    normalized.updatedAt = Date.now();
    const documents = getReadingDocuments().filter(
      (item) => item.id !== normalized.id,
    );
    documents.unshift(normalized);
    writeJson(STORAGE_KEYS.readings, documents);
    return normalized;
  }

  function deleteReadingDocument(documentId) {
    const id = cleanReadingText(documentId, 160);
    const documents = getReadingDocuments();
    const nextDocuments = documents.filter((document) => document.id !== id);
    writeJson(STORAGE_KEYS.readings, nextDocuments);
    return nextDocuments.length !== documents.length;
  }

  function buildReadingItems(document) {
    const normalized = normalizeReadingDocument(document);
    if (!normalized) {
      return [];
    }

    return normalized.words.map((word) => ({
      id: word.id,
      phrase: word.phrase,
      phonetic: word.phonetic,
      meaning: word.meaning,
      sentence: word.sentence,
      translation: word.translation,
    }));
  }

  function mergeLibraryCategories(categories, resources) {
    const byName = new Map();

    (Array.isArray(categories) ? categories : []).forEach((category) => {
      if (!category?.name) {
        return;
      }
      byName.set(category.name, {
        name: category.name,
        sections: [...new Set(Array.isArray(category.sections) ? category.sections : [])],
      });
    });

    (Array.isArray(resources) ? resources : []).forEach((resource) => {
      if (!resource?.category) {
        return;
      }
      const category = byName.get(resource.category) || {
        name: resource.category,
        sections: [],
      };
      if (resource.section && !category.sections.includes(resource.section)) {
        category.sections.push(resource.section);
      }
      byName.set(resource.category, category);
    });

    return [...byName.values()];
  }

  function readingResource(document) {
    return {
      id: document.id,
      title: document.title,
      category: document.category,
      section: document.section,
      group: document.category,
      description: [document.category, document.section, document.title]
        .filter(Boolean)
        .join(" · "),
      file: "",
      format: "reading-upload",
      attachment: false,
      reading: true,
    };
  }

  /**
   * Reads only the material manifest so the navigation can render right away,
   * before any vocabulary file is downloaded.
   */
  async function fetchLibraryManifest(manifestPath = MANIFEST_PATH) {
    const manifestResponse = await fetch(manifestPath, { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error(`资源清单加载失败：${manifestResponse.status}`);
    }

    const manifest = await manifestResponse.json();
    const categories = Array.isArray(manifest.categories)
      ? manifest.categories
      : [];
    const staticResources = Array.isArray(manifest.resources)
      ? manifest.resources
      : [];
    const readingResources = getReadingDocuments().map(readingResource);
    const resources = [...staticResources, ...readingResources];

    return {
      categories: mergeLibraryCategories(categories, resources),
      resources,
    };
  }

  /**
   * Material files are requested with their content hash so browsers can keep
   * them in the HTTP cache instead of downloading them on every visit.
   */
  function materialRequestUrl(resource) {
    if (!resource?.file) {
      return "";
    }
    return resource.hash
      ? `${resource.file}?v=${encodeURIComponent(resource.hash)}`
      : resource.file;
  }

  async function fetchLibraryDeck(resource, index = 0) {
    if (!resource || typeof resource !== "object") {
      return [];
    }

    if (resource.reading) {
      const document = getReadingDocuments().find(
        (item) => item.id === resource.id,
      );
      return document ? buildReadingItems(document) : [];
    }

    if (resource.attachment || !resource.file) {
      return [];
    }

    const response = await fetch(materialRequestUrl(resource), {
      cache: resource.hash ? "force-cache" : "no-store",
    });
    if (!response.ok) {
      throw new Error(`${resource.title} 加载失败：${response.status}`);
    }

    const text = await response.text();
    return parseDeck(text, resource, index);
  }

  async function fetchLibraryDecks(resources) {
    const list = Array.isArray(resources) ? resources : [];
    const deckEntries = await Promise.all(
      list.map(async (resource, index) => [
        resource.id,
        await fetchLibraryDeck(resource, index),
      ]),
    );

    return new Map(deckEntries);
  }

  async function fetchLibrary(manifestPath = MANIFEST_PATH) {
    const { categories, resources } = await fetchLibraryManifest(manifestPath);
    const decks = await fetchLibraryDecks(resources);
    return { categories, resources, decks };
  }

  /**
   * Splits a scoped card list into the queue shown by both review surfaces:
   * cards that are due first, then new cards within today's limit.
   */
  function buildReviewQueue(entries, options = {}) {
    const progress = options.progress || {};
    const daily = options.daily || {};
    const newLimit = Math.max(0, Number(options.newLimit) || 0);
    const now = Number(options.now) || Date.now();
    const reviewedKeys = Array.isArray(daily.reviewedKeys)
      ? daily.reviewedKeys
      : [];
    const newKeys = Array.isArray(daily.newKeys) ? daily.newKeys : [];
    const dueEntries = [];
    const freshEntries = [];
    let masteredCount = 0;

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const record = progress[entry.item.id];
      if (!record || typeof record !== "object" || !Number(record.reps)) {
        freshEntries.push(entry);
        return;
      }
      if ((Number(record.dueAt) || 0) <= now) {
        dueEntries.push(entry);
        return;
      }
      masteredCount += 1;
    });

    dueEntries.sort(
      (left, right) =>
        (Number(progress[left.item.id]?.dueAt) || 0) -
        (Number(progress[right.item.id]?.dueAt) || 0),
    );

    const remainingNew = Math.max(0, newLimit - newKeys.length);

    return {
      queue: [...dueEntries, ...freshEntries.slice(0, remainingNew)],
      dueEntries,
      freshEntries,
      dueCount: dueEntries.length,
      freshCount: freshEntries.length,
      masteredCount,
      remainingNew,
      reviewedCount: reviewedKeys.length,
    };
  }

  global.IballDeck = {
    MANIFEST_PATH,
    DEFAULT_UNIT_SIZE,
    REVIEW_DAY_MS,
    REVIEW_LEARNING_STEPS_MS,
    REVIEW_MAX_INTERVAL_DAYS,
    REVIEW_GRADES,
    STORAGE_KEYS,
    parseCsv,
    parseDeck,
    formatUnitNumber,
    buildDeckUnits,
    getItemKey,
    clampReviewEase,
    computeReviewSchedule,
    formatReviewInterval,
    getReviewDayKey,
    restoreSet,
    persistSet,
    readJson,
    writeJson,
    cleanReadingText,
    hashReadingValue,
    getReadingDocuments,
    saveReadingDocument,
    deleteReadingDocument,
    buildReadingItems,
    fetchLibrary,
    fetchLibraryManifest,
    fetchLibraryDeck,
    fetchLibraryDecks,
    materialRequestUrl,
    buildReviewQueue,
  };
})(window);
