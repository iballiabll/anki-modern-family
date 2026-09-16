const GOOGLE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MAX_TEXTS = 24;
const MAX_TEXT_LENGTH = 6000;
const MAX_TOTAL_LENGTH = 30000;
const translationCache = new Map();

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

function splitText(text, maxLength) {
  const source = cleanText(text);
  if (source.length <= maxLength) {
    return source ? [source] : [];
  }

  const sentences = source
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks = [];
  let current = "";

  const pushCurrent = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };

  sentences.forEach((sentence) => {
    if (sentence.length > maxLength) {
      pushCurrent();
      for (let index = 0; index < sentence.length; index += maxLength) {
        chunks.push(sentence.slice(index, index + maxLength));
      }
      return;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxLength) {
      pushCurrent();
      current = sentence;
      return;
    }
    current = candidate;
  });

  pushCurrent();
  return chunks;
}

async function readBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "object") {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

async function requestGoogleChunk(text) {
  const endpoint = new URL(GOOGLE_ENDPOINT);
  endpoint.searchParams.set("client", "gtx");
  endpoint.searchParams.set("sl", "en");
  endpoint.searchParams.set("tl", "zh-CN");
  endpoint.searchParams.set("dt", "t");
  endpoint.searchParams.set("q", text);

  const response = await fetch(endpoint, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "application/json,text/plain,*/*",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Google translation failed: ${response.status}`);
  }

  const data = await response.json();
  const segments = Array.isArray(data?.[0]) ? data[0] : [];
  const translation = segments
    .map((segment) => (Array.isArray(segment) ? segment[0] : ""))
    .join("")
    .trim();

  if (!translation) {
    throw new Error("Google returned an empty translation");
  }
  return translation;
}

async function translateWithGoogle(text) {
  const chunks = splitText(text, 1500);
  const translations = [];
  for (const chunk of chunks) {
    translations.push(await requestGoogleChunk(chunk));
  }
  return translations.join(" ");
}

async function translateWithMyMemory(text) {
  const chunks = splitText(text, 450);
  const translations = [];

  for (const chunk of chunks) {
    const endpoint = new URL(MYMEMORY_ENDPOINT);
    endpoint.searchParams.set("q", chunk);
    endpoint.searchParams.set("langpair", "en|zh-CN");

    const response = await fetch(endpoint, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`MyMemory translation failed: ${response.status}`);
    }

    const data = await response.json();
    const translation = cleanText(data?.responseData?.translatedText);
    if (!translation || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(translation)) {
      throw new Error("MyMemory returned an invalid translation");
    }
    translations.push(translation);
  }

  return translations.join(" ");
}

async function translateText(text) {
  const source = cleanText(text);
  if (!source) {
    return "";
  }

  const cacheKey = source.toLocaleLowerCase("en-US");
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  let translation = "";
  try {
    translation = await translateWithGoogle(source);
  } catch (googleError) {
    console.warn("Google translation fallback:", googleError.message);
    translation = await translateWithMyMemory(source);
  }

  if (translationCache.size >= 500) {
    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }
  translationCache.set(cacheKey, translation);
  return translation;
}

module.exports = async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "不支持的请求方式" });
    return;
  }

  const body = await readBody(request.body);
  const texts = (Array.isArray(body.texts) ? body.texts : []).map(cleanText);
  const totalLength = texts.reduce((sum, text) => sum + text.length, 0);

  if (
    texts.length === 0 ||
    texts.length > MAX_TEXTS ||
    texts.some((text) => !text || text.length > MAX_TEXT_LENGTH) ||
    totalLength > MAX_TOTAL_LENGTH
  ) {
    response.status(400).json({
      ok: false,
      message: "翻译内容为空或超过单次处理上限",
    });
    return;
  }

  const translations = [];
  const failed = [];

  for (let index = 0; index < texts.length; index += 1) {
    try {
      translations.push(await translateText(texts[index]));
    } catch (error) {
      console.error("Translation failed:", error);
      translations.push("");
      failed.push(index);
    }
  }

  if (failed.length === texts.length && texts.length > 0) {
    response.status(502).json({
      ok: false,
      message: "翻译服务暂时不可用，请稍后重试",
      failed,
    });
    return;
  }

  response.status(200).json({ ok: true, translations, failed });
};
