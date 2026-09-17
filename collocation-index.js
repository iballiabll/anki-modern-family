(function () {
  "use strict";

  const script = document.currentScript;
  const baseUrl = script && script.src
    ? new URL(".", script.src)
    : new URL("./", window.location.href);
  const INDEX_PATH = new URL("collocation-index.json", baseUrl).href;
  const LEVEL_NAMES = ["四级", "六级", "考研"];
  const LEVEL_BITS = [1, 2, 4];
  const MAX_PHRASE_TOKENS = 8;

  // 不规则动词首词变形，用于把 "take care of" 这类短语匹配到 took / taken / taking。
  const IRREGULAR_FORMS = {
    be: ["am", "is", "are", "was", "were", "been", "being"],
    become: ["becomes", "became", "becoming"],
    begin: ["begins", "began", "begun", "beginning"],
    break: ["breaks", "broke", "broken", "breaking"],
    bring: ["brings", "brought", "bringing"],
    build: ["builds", "built", "building"],
    buy: ["buys", "bought", "buying"],
    catch: ["catches", "caught", "catching"],
    choose: ["chooses", "chose", "chosen", "choosing"],
    come: ["comes", "came", "coming"],
    deal: ["deals", "dealt", "dealing"],
    do: ["does", "did", "done", "doing"],
    draw: ["draws", "drew", "drawn", "drawing"],
    drink: ["drinks", "drank", "drunk", "drinking"],
    drive: ["drives", "drove", "driven", "driving"],
    eat: ["eats", "ate", "eaten", "eating"],
    fall: ["falls", "fell", "fallen", "falling"],
    feel: ["feels", "felt", "feeling"],
    fight: ["fights", "fought", "fighting"],
    find: ["finds", "found", "finding"],
    fly: ["flies", "flew", "flown", "flying"],
    forget: ["forgets", "forgot", "forgotten", "forgetting"],
    get: ["gets", "got", "gotten", "getting"],
    give: ["gives", "gave", "given", "giving"],
    go: ["goes", "went", "gone", "going"],
    grow: ["grows", "grew", "grown", "growing"],
    have: ["has", "had", "having"],
    hear: ["hears", "heard", "hearing"],
    hold: ["holds", "held", "holding"],
    keep: ["keeps", "kept", "keeping"],
    know: ["knows", "knew", "known", "knowing"],
    lead: ["leads", "led", "leading"],
    leave: ["leaves", "left", "leaving"],
    lend: ["lends", "lent", "lending"],
    let: ["lets", "letting"],
    lie: ["lies", "lay", "lain", "lying"],
    lose: ["loses", "lost", "losing"],
    make: ["makes", "made", "making"],
    mean: ["means", "meant", "meaning"],
    meet: ["meets", "met", "meeting"],
    pay: ["pays", "paid", "paying"],
    put: ["puts", "putting"],
    read: ["reads", "reading"],
    rise: ["rises", "rose", "risen", "rising"],
    run: ["runs", "ran", "running"],
    say: ["says", "said", "saying"],
    see: ["sees", "saw", "seen", "seeing"],
    sell: ["sells", "sold", "selling"],
    send: ["sends", "sent", "sending"],
    set: ["sets", "setting"],
    show: ["shows", "showed", "shown", "showing"],
    sit: ["sits", "sat", "sitting"],
    speak: ["speaks", "spoke", "spoken", "speaking"],
    spend: ["spends", "spent", "spending"],
    stand: ["stands", "stood", "standing"],
    take: ["takes", "took", "taken", "taking"],
    teach: ["teaches", "taught", "teaching"],
    tell: ["tells", "told", "telling"],
    think: ["thinks", "thought", "thinking"],
    throw: ["throws", "threw", "thrown", "throwing"],
    understand: ["understands", "understood", "understanding"],
    wear: ["wears", "wore", "worn", "wearing"],
    win: ["wins", "won", "winning"],
    write: ["writes", "wrote", "written", "writing"],
  };

  const VOWELS = "aeiou";

  // 全为功能词的条目（如 "and then"、"and that"）不构成考点搭配，直接跳过。
  const STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "nor", "so", "if", "than", "then",
    "of", "to", "in", "on", "at", "for", "with", "without", "by", "as",
    "is", "am", "are", "was", "were", "be", "been", "being", "do", "does",
    "did", "done", "have", "has", "had", "will", "would", "shall", "should",
    "can", "could", "may", "might", "must", "this", "that", "these", "those",
    "it", "its", "he", "she", "they", "them", "we", "us", "you", "i", "me",
    "his", "her", "their", "our", "your", "my", "which", "who", "whom",
    "whose", "what", "when", "where", "why", "how", "there", "here", "not",
    "no", "all", "any", "some", "one", "such", "very", "just", "only",
    "also", "too", "more", "most", "much", "many",
  ]);

  let loadPromise = null;
  let entries = null;
  let firstWordMap = null;
  let entriesByKey = null;

  function tokenize(value) {
    return (
      String(value || "")
        .replace(/[’‘`]/g, "'")
        .toLowerCase()
        .match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) || []
    );
  }

  function formsFor(word) {
    const forms = new Set([word]);
    const irregular = IRREGULAR_FORMS[word];
    if (irregular) {
      irregular.forEach((form) => forms.add(form));
    }
    if (!/^[a-z]+$/.test(word) || word.length < 3) {
      return forms;
    }

    const last = word.at(-1);
    const beforeLast = word.at(-2);
    forms.add(`${word}s`);

    if (last === "y" && !VOWELS.includes(beforeLast)) {
      forms.add(`${word.slice(0, -1)}ies`);
      forms.add(`${word.slice(0, -1)}ied`);
      return forms;
    }

    if (last === "e") {
      forms.add(`${word}d`);
      forms.add(`${word.slice(0, -1)}ing`);
      return forms;
    }

    forms.add(`${word}ed`);
    forms.add(`${word}ing`);

    const isCvc =
      !VOWELS.includes(last) &&
      VOWELS.includes(beforeLast) &&
      !VOWELS.includes(word.at(-3) || "") &&
      !"wxy".includes(last);
    if (isCvc || (word.length <= 4 && !VOWELS.includes(last))) {
      forms.add(`${word}${last}ed`);
      forms.add(`${word}${last}ing`);
    }
    return forms;
  }

  function buildIndex(rawEntries) {
    const map = new Map();
    const byKey = new Map();

    for (const [phrase, value] of Object.entries(rawEntries || {})) {
      const tokens = tokenize(phrase);
      if (tokens.length < 2 || tokens.length > MAX_PHRASE_TOKENS) {
        continue;
      }
      if (!tokens.some((token) => !STOPWORDS.has(token))) {
        continue;
      }
      const mask = Number(value?.[0]) || 0;
      if (!mask) {
        continue;
      }
      const item = {
        phrase: phrase.replace(/\s+/g, " ").trim(),
        tokens,
        mask,
        meaning: String(value?.[1] || "").trim(),
      };
      byKey.set(tokens.join(" "), item);
      for (const form of formsFor(tokens[0])) {
        const list = map.get(form) || [];
        list.push(item);
        map.set(form, list);
      }
    }

    for (const list of map.values()) {
      list.sort((left, right) => right.tokens.length - left.tokens.length);
    }

    firstWordMap = map;
    entriesByKey = byKey;
    entries = rawEntries || {};
    return byKey;
  }

  function load() {
    if (!loadPromise) {
      loadPromise = fetch(INDEX_PATH, { cache: "force-cache" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (!data || !data.entries) {
            return null;
          }
          return buildIndex(data.entries);
        })
        .catch(() => {
          loadPromise = null;
          return null;
        });
    }
    return loadPromise;
  }

  function levelsForMask(mask) {
    const levels = [];
    LEVEL_BITS.forEach((bit, index) => {
      if (mask & bit) {
        levels.push(LEVEL_NAMES[index]);
      }
    });
    return levels;
  }

  function toPublicItem(item) {
    return {
      phrase: item.phrase,
      levels: levelsForMask(item.mask),
      mask: item.mask,
      meaning: item.meaning,
      phonetic: "",
    };
  }

  function lookup(value) {
    if (!entriesByKey) {
      return null;
    }
    const key = tokenize(value).join(" ");
    const item = key ? entriesByKey.get(key) : null;
    return item ? toPublicItem(item) : null;
  }

  function findInText(value) {
    if (!firstWordMap) {
      return [];
    }
    const tokens = tokenize(value);
    if (!tokens.length) {
      return [];
    }

    const consumed = new Uint8Array(tokens.length);
    const found = [];
    const seen = new Set();

    for (let start = 0; start < tokens.length; start += 1) {
      if (consumed[start]) {
        continue;
      }
      const candidates = firstWordMap.get(tokens[start]);
      if (!candidates || !candidates.length) {
        continue;
      }

      for (const item of candidates) {
        const length = item.tokens.length;
        if (start + length > tokens.length) {
          continue;
        }
        let matched = true;
        for (let offset = 1; offset < length; offset += 1) {
          if (tokens[start + offset] !== item.tokens[offset]) {
            matched = false;
            break;
          }
        }
        if (!matched) {
          continue;
        }

        for (let offset = 0; offset < length; offset += 1) {
          consumed[start + offset] = 1;
        }
        const publicItem = toPublicItem(item);
        const key = publicItem.phrase.toLowerCase();
        if (seen.has(key)) {
          break;
        }
        seen.add(key);
        publicItem.start = start;
        found.push(publicItem);
        break;
      }
    }

    found.sort((left, right) => left.start - right.start);
    return found.map((item) => {
      const { start, ...rest } = item;
      return { ...rest, index: start };
    });
  }

  window.CollocationIndex = {
    load,
    lookup,
    findInText,
    tokenize,
    levelsForMask,
    get ready() {
      return Boolean(entriesByKey);
    },
    size: () => (entries ? Object.keys(entries).length : 0),
  };
})();
