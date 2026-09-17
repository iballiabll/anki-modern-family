(function () {
  const INDEX_PATH = "vocab-index.json";

  let indexPromise = null;
  let entries = null;

  function normalizeKey(value) {
    return String(value || "")
      .replace(/[’‘`]/g, "'")
      .toLowerCase()
      .replace(/[.…]+/g, " ")
      .replace(/[^a-z0-9'\- ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function load() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_PATH, { cache: "force-cache" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          entries = data && data.entries ? data.entries : null;
          return entries;
        })
        .catch(() => {
          indexPromise = null;
          return null;
        });
    }
    return indexPromise;
  }

  async function lookup(value) {
    const key = normalizeKey(value);
    if (!key) {
      return null;
    }

    const map = entries || (await load());
    const entry = map ? map[key] : null;
    if (!entry) {
      return null;
    }

    return {
      word: entry[0],
      phonetic: entry[1] || "",
      meaning: entry[2] || "",
      source: entry[3] || "本地词库",
      kind: entry[4] || "word",
    };
  }

  window.VocabIndex = {
    load,
    lookup,
    normalizeKey,
    size: () => (entries ? Object.keys(entries).length : 0),
  };
})();
