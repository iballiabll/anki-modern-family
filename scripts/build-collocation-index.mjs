import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "vocab-index.json");
const outputPath = path.join(root, "collocation-index.json");

// 位掩码压缩：1 = 四级，2 = 六级，4 = 考研。
const LEVELS = [
  { name: "四级", bit: 1 },
  { name: "六级", bit: 2 },
  { name: "考研", bit: 4 },
];

function levelMask(rawLabel) {
  const label = String(rawLabel || "");
  return LEVELS.reduce(
    (mask, level) => (label.includes(level.name) ? mask | level.bit : mask),
    0,
  );
}

function cleanMeaning(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const raw = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  const entries = raw && raw.entries ? raw.entries : {};
  const phrases = {};

  for (const [key, entry] of Object.entries(entries)) {
    if (!Array.isArray(entry) || entry[4] !== "phrase") {
      continue;
    }
    const phrase = String(entry[0] || key).trim().toLowerCase();
    if (!phrase || !phrase.includes(" ")) {
      continue;
    }
    const mask = levelMask(entry[3]);
    if (!mask) {
      continue;
    }
    const existing = phrases[phrase];
    const meaning = cleanMeaning(entry[2]);
    if (existing) {
      existing[0] |= mask;
      if (!existing[1] && meaning) {
        existing[1] = meaning;
      }
      continue;
    }
    phrases[phrase] = [mask, meaning];
  }

  const sortedKeys = Object.keys(phrases).sort();
  const ordered = {};
  for (const key of sortedKeys) {
    ordered[key] = phrases[key];
  }

  const payload = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: "vocab-index.json（四级 / 六级 / 考研短语表）",
    levels: LEVELS.map((level) => level.name),
    count: sortedKeys.length,
    entries: ordered,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");
  const bytes = (await fs.stat(outputPath)).size;
  console.log(
    `Generated collocation-index.json with ${sortedKeys.length} phrases (${(
      bytes / 1024
    ).toFixed(1)} KB).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
