/**
 * Turns a plain-text episode transcript into structured dialogue blocks.
 *
 * Usage:
 *   node scripts/build-movie-script.mjs "S01E01" [source.txt]
 *
 * The source defaults to the transcript stored next to the generated JSON, so
 * the script can be re-run after the .txt is refreshed.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const episode = process.argv[2] || "S01E01";
const showDirectory = path.join(root, "materials", "电影", "摩登家庭");
const sourcePath =
  process.argv[3] || path.join(showDirectory, `${episode} 台词原文.txt`);
const outputPath = path.join(showDirectory, `${episode.toLowerCase()}-lines.json`);

// Transcript sources only label a handful of speakers, so the parser keeps the
// list small and treats everything else in square brackets as a stage cue.
const SPEAKERS = new Set([
  "Claire",
  "Phil",
  "Alex",
  "Haley",
  "Luke",
  "Jay",
  "Gloria",
  "Mitchell",
  "Cameron",
  "Manny",
  "Dylan",
  "Lily",
  "Josh",
  "Boy",
  "Man",
  "Woman",
]);

const HEADER_STOP = /^={4,}$/;

function parseTranscript(raw) {
  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let current = null;
  let headerDone = false;

  const flush = () => {
    if (current && current.text) {
      blocks.push(current);
    }
    current = null;
  };

  const addStage = (cue) => {
    const target = current || blocks[blocks.length - 1];
    if (!target || !cue) {
      return;
    }
    target.stage = target.stage ? `${target.stage}；${cue}` : cue;
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!headerDone) {
      if (HEADER_STOP.test(line)) {
        headerDone = true;
      }
      return;
    }

    if (!line) {
      flush();
      return;
    }

    const tagged = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (tagged) {
      const tag = tagged[1].trim();
      const rest = tagged[2].trim();
      if (SPEAKERS.has(tag)) {
        flush();
        current = { speaker: tag, text: rest };
        return;
      }
      addStage(tag);
      if (!rest) {
        return;
      }
      if (!current) {
        current = { speaker: null, text: "" };
      }
      current.text = current.text ? `${current.text} ${rest}` : rest;
      return;
    }

    if (!current) {
      current = { speaker: null, text: "" };
    }
    current.text = current.text ? `${current.text} ${line}` : line;
  });

  flush();

  return blocks.map((block, index) => ({
    i: index + 1,
    speaker: block.speaker || "",
    text: block.text.replace(/\s+/g, " ").trim(),
    ...(block.stage ? { stage: block.stage } : {}),
  }));
}

async function main() {
  const raw = await fs.readFile(sourcePath, "utf8");
  const blocks = parseTranscript(raw);
  const words = blocks.reduce(
    (total, block) => total + block.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  const payload = {
    episode,
    generatedBy: "scripts/build-movie-script.mjs",
    source: path.basename(sourcePath),
    blockCount: blocks.length,
    wordCount: words,
    blocks,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `${episode}: ${blocks.length} 个对白块，${words} 个英文词 -> ${path.relative(root, outputPath)}`,
  );
}

await main();
