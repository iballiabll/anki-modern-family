const YOUDAO_ENDPOINT = "https://dict.youdao.com/jsonapi";
const MAX_WORD_LENGTH = 64;

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
  };
}

module.exports = async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader(
    "Cache-Control",
    "public, s-maxage=604800, stale-while-revalidate=86400",
  );

  if (request.method !== "GET") {
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
    !/^[a-z]+(?:['’-][a-z]+)*$/.test(word)
  ) {
    response.status(400).json({ ok: false, message: "请输入有效的英文单词" });
    return;
  }

  try {
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

    const data = await dictionaryResponse.json();
    const result = formatDictionary(data, word);

    if (result.translations.length === 0 && result.definitions.length === 0) {
      response.status(404).json({ ok: false, message: "暂时没有查到这个词" });
      return;
    }

    response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Word lookup failed:", error);
    response.status(502).json({
      ok: false,
      message: "词典服务暂时不可用，请稍后再试",
    });
  }
};
