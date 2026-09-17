const YOUDAO_ENDPOINT = "https://dict.youdao.com/jsonapi";
const FREE_DICTIONARY_PRIMARY_ENDPOINT =
  "https://freedictionaryapi.com/api/v1/entries/en/";
const FREE_DICTIONARY_ENDPOINT =
  "https://api.dictionaryapi.dev/api/v2/entries/en/";
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MAX_WORD_LENGTH = 64;
const SINGLE_WORD_PATTERN = /^[a-z][a-z'-]*$/i;

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addUnique(target, value) {
  const text = cleanText(value);
  if (text && !target.includes(text)) {
    target.push(text);
  }
}

function collectTranslations(data) {
  const translations = [];

  toArray(data?.ec?.word).forEach((wordEntry) => {
    toArray(wordEntry?.trs).forEach((group) => {
      toArray(group?.tr).forEach((entry) => {
        addUnique(translations, entry?.l?.i);
      });
    });
  });

  if (translations.length > 0) {
    return translations;
  }

  toArray(data?.web_trans?.["web-translation"]).forEach((entry) => {
    toArray(entry?.trans).forEach((translation) => {
      addUnique(translations, translation?.value);
    });
  });

  return translations;
}

function collectDefinitions(data) {
  const definitions = [];

  toArray(data?.ee?.word).forEach((wordEntry) => {
    toArray(wordEntry?.trs).forEach((group) => {
      const partOfSpeech = cleanText(group?.pos);
      toArray(group?.tr).forEach((entry) => {
        const definition = cleanText(entry?.l?.i);
        if (definition) {
          addUnique(
            definitions,
            partOfSpeech ? `${partOfSpeech} ${definition}` : definition,
          );
        }
      });
    });
  });

  return definitions;
}

function collectPhrases(data) {
  const phrases = [];

  toArray(data?.phrs?.phrs).forEach((entry) => {
    const phrase = cleanText(entry?.phr?.headword?.l?.i);
    if (!phrase || phrases.some((item) => item.phrase === phrase)) {
      return;
    }
    const meaning = toArray(entry?.phr?.trs)
      .map((group) => cleanText(group?.tr?.l?.i))
      .filter(Boolean)
      .join("；");
    phrases.push({ phrase, meaning });
  });

  return phrases.slice(0, 12);
}

function collectExamples(data) {
  const examples = [];
  const pairs = toArray(data?.blng_sents_part?.["sentence-pair"]);

  pairs.forEach((pair) => {
    const english = cleanText(pair?.sentence || pair?.["sentence-eng"]);
    if (!english || examples.some((item) => item.english === english)) {
      return;
    }
    examples.push({
      english,
      chinese: cleanText(pair?.["sentence-translation"]),
    });
  });

  return examples.slice(0, 3);
}

function normalizePhonetic(value) {
  const text = cleanText(value).replace(/^\/+|\/+$/g, "");
  return text ? `/${text}/` : "";
}

function isSingleWord(word) {
  return SINGLE_WORD_PATTERN.test(word);
}

async function fetchFallbackPhonetic(word) {
  if (!isSingleWord(word)) {
    return "";
  }

  try {
    const response = await fetch(
      `${FREE_DICTIONARY_ENDPOINT}${encodeURIComponent(word)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      return "";
    }

    const entries = toArray(await response.json());
    for (const entry of entries) {
      const direct = normalizePhonetic(entry?.phonetic);
      if (direct) {
        return direct;
      }
      for (const item of toArray(entry?.phonetics)) {
        const phonetic = normalizePhonetic(item?.text);
        if (phonetic) {
          return phonetic;
        }
      }
    }
  } catch {
    return "";
  }

  return "";
}

async function fetchFreeEntry(word) {
  const entry = { phonetic: "", definitions: [], examples: [] };

  if (!isSingleWord(word)) {
    return entry;
  }

  // 先用响应更快的 freedictionaryapi，再退回 dictionaryapi.dev。
  try {
    const response = await fetch(
      `${FREE_DICTIONARY_PRIMARY_ENDPOINT}${encodeURIComponent(word)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (response.ok) {
      const data = await response.json();
      toArray(data?.entries).forEach((item) => {
        if (!entry.phonetic) {
          toArray(item?.pronunciations).some((pronunciation) => {
            if (pronunciation?.type && pronunciation.type !== "ipa") {
              return false;
            }
            const text = normalizePhonetic(pronunciation?.text);
            if (text) {
              entry.phonetic = text;
              return true;
            }
            return false;
          });
        }

        const partOfSpeech = cleanText(item?.partOfSpeech);
        toArray(item?.senses).forEach((sense) => {
          const definition = cleanText(sense?.definition);
          if (definition) {
            addUnique(
              entry.definitions,
              partOfSpeech ? `${partOfSpeech} ${definition}` : definition,
            );
          }
          if (entry.examples.length < 3) {
            const example = toArray(sense?.examples).map(cleanText).find(Boolean);
            if (example) {
              addUnique(entry.examples, example);
            }
          }
        });
      });
    }
  } catch {
    // 继续尝试下一个免费词典。
  }

  if (entry.phonetic && entry.definitions.length > 0) {
    entry.definitions = entry.definitions.slice(0, 6);
    return entry;
  }

  try {
    const response = await fetch(
      `${FREE_DICTIONARY_ENDPOINT}${encodeURIComponent(word)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!response.ok) {
      entry.definitions = entry.definitions.slice(0, 6);
      return entry;
    }

    const entries = toArray(await response.json());
    entries.forEach((item) => {
      if (!entry.phonetic) {
        entry.phonetic = normalizePhonetic(item?.phonetic);
        toArray(item?.phonetics).some((phonetic) => {
          const text = normalizePhonetic(phonetic?.text);
          if (text) {
            entry.phonetic = text;
            return true;
          }
          return false;
        });
      }

      toArray(item?.meanings).forEach((meaning) => {
        const partOfSpeech = cleanText(meaning?.partOfSpeech);
        toArray(meaning?.definitions).forEach((definition) => {
          const text = cleanText(definition?.definition);
          if (text) {
            addUnique(
              entry.definitions,
              partOfSpeech ? `${partOfSpeech} ${text}` : text,
            );
          }
          if (entry.examples.length < 3 && cleanText(definition?.example)) {
            addUnique(entry.examples, cleanText(definition?.example));
          }
        });
      });
    });

    entry.definitions = entry.definitions.slice(0, 6);
    entry.examples = entry.examples.slice(0, 3);
  } catch {
    return entry;
  }

  return entry;
}

async function fetchMachineGloss(word) {
  try {
    const endpoint = new URL(MYMEMORY_ENDPOINT);
    endpoint.searchParams.set("q", word);
    endpoint.searchParams.set("langpair", "en|zh-CN");

    const response = await fetch(endpoint, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) {
      return "";
    }

    const data = await response.json();
    const gloss = cleanText(data?.responseData?.translatedText);
    if (
      !gloss ||
      /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(gloss) ||
      gloss.toLocaleLowerCase("en-US") === word.toLocaleLowerCase("en-US")
    ) {
      return "";
    }
    return gloss;
  } catch {
    return "";
  }
}

async function fetchYoudao(word) {
  const endpoint = new URL(YOUDAO_ENDPOINT);
  endpoint.searchParams.set("q", word);

  const dictionaryResponse = await fetch(endpoint, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://dict.youdao.com/",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!dictionaryResponse.ok) {
    throw new Error(`Dictionary request failed: ${dictionaryResponse.status}`);
  }

  return formatDictionary(await dictionaryResponse.json(), word);
}

function formatDictionary(data, fallbackWord) {
  const entry = toArray(data?.ec?.word)[0] || {};
  const simpleEntry = toArray(data?.simple?.word)[0] || {};
  const word = cleanText(data?.input) || fallbackWord;
  const phonetic =
    cleanText(entry.usphone) ||
    cleanText(entry.ukphone) ||
    cleanText(simpleEntry.usphone) ||
    cleanText(simpleEntry.ukphone);

  return {
    word,
    phonetic,
    translations: collectTranslations(data),
    definitions: collectDefinitions(data),
    phrases: collectPhrases(data),
    examples: collectExamples(data),
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");

  if (request.method !== "GET") {
    response.setHeader("Cache-Control", "no-store");
    response.status(405).json({ ok: false, message: "不支持的请求方式" });
    return;
  }

  const rawWord = Array.isArray(request.query?.word)
    ? request.query.word[0]
    : request.query?.word;
  const word = cleanText(rawWord).toLocaleLowerCase("en-US");

  if (
    !word ||
    word.length > MAX_WORD_LENGTH ||
    !/^[a-z]+(?:['’-][a-z]+)*(?: [a-z]+(?:['’-][a-z]+)*){0,4}$/.test(word)
  ) {
    response.setHeader("Cache-Control", "no-store");
    response
      .status(400)
      .json({ ok: false, message: "请输入有效的英文单词或短语" });
    return;
  }

  const sources = [];
  let youdaoFailed = false;
  let result = {
    word,
    phonetic: "",
    translations: [],
    definitions: [],
    phrases: [],
    examples: [],
  };

  // 有道是主词典，被限流或超时的时候继续走免费词典，不再直接报错。
  try {
    result = await fetchYoudao(word);
    sources.push("youdao");
  } catch (error) {
    youdaoFailed = true;
    console.warn("Youdao lookup fallback:", error.message);
  }

  if (!result.phonetic || result.translations.length === 0) {
    const freeEntry = await fetchFreeEntry(word);
    if (!result.phonetic && freeEntry.phonetic) {
      result.phonetic = freeEntry.phonetic;
    }
    if (result.definitions.length === 0 && freeEntry.definitions.length > 0) {
      result.definitions = freeEntry.definitions;
    }
    if (result.examples.length === 0 && freeEntry.examples.length > 0) {
      result.examples = freeEntry.examples;
    }
    if (
      freeEntry.phonetic ||
      freeEntry.definitions.length > 0 ||
      freeEntry.examples.length > 0
    ) {
      sources.push("free-dictionary");
    }
  }

  if (!result.phonetic) {
    result.phonetic = await fetchFallbackPhonetic(word);
  }

  if (result.translations.length === 0) {
    const gloss = await fetchMachineGloss(word);
    if (gloss) {
      result.translations.push(gloss);
      sources.push("mymemory");
    }
  }

  const hasContent =
    Boolean(result.phonetic) ||
    result.translations.length > 0 ||
    result.definitions.length > 0;

  if (!hasContent) {
    // 失败结果不能进 CDN 缓存，否则一次超时会被放大成整周查不到词。
    response.setHeader("Cache-Control", "no-store");
    response.status(youdaoFailed ? 502 : 404).json({
      ok: false,
      message: youdaoFailed
        ? "词典服务暂时不可用，请稍后再试"
        : "暂时没有查到这个词",
    });
    return;
  }

  response.setHeader(
    "Cache-Control",
    "public, s-maxage=604800, stale-while-revalidate=86400",
  );
  response.status(200).json({ ok: true, ...result, sources });
};
