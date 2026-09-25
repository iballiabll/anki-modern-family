/**
 * Prepares the Modern Family S01 media pipeline.
 *
 * Two jobs:
 *
 *   node scripts/prepare-movie-media.mjs map
 *     Reads every local MKV plus the downloaded subtitle packs, then matches
 *     each video file to its real episode by correlating the speech/music
 *     energy envelope of the audio with the on/off pattern of the subtitles.
 *     The file names of the downloads are not trustworthy, so the match is
 *     derived from content and written to work/movie-episode-map.json.
 *
 *   node scripts/prepare-movie-media.mjs build S01E01 [S01E02 ...]
 *     Cuts one sprite per episode: every dialogue cue becomes a clip, all
 *     clips are concatenated with a short gap, and a subtitle file with the
 *     sprite's own timeline is written next to it. Nothing is guessed: the
 *     cue times come from the subtitle file, shifted by the offset measured by
 *     "map".
 *
 * The sprite keeps the site small: only the spoken seconds are stored instead
 * of the full 21 minutes of every episode.
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDirectory = path.resolve(root, "..");
const toolsDirectory = path.join(workDirectory, "tools");
const subsDirectory = path.join(workDirectory, "subs");
const mapPath = path.join(workDirectory, "movie-episode-map.json");
const showDirectory = path.join(root, "materials", "电影", "摩登家庭");

const FFMPEG =
  process.env.FFMPEG_PATH ||
  path.join(
    toolsDirectory,
    "ffmpeg",
    "ffmpeg-9.0.2-essentials_build",
    "bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
const FFPROBE = path.join(path.dirname(FFMPEG), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

const VIDEO_DIRECTORY = process.env.MOVIE_VIDEO_DIR || "C:\\Users\\iball\\Desktop";
const VIDEO_PATTERN = /^S01E24 \((\d+)\)\.mkv$/i;

const ENGLISH_SUBTITLE_DIR = path.join(subsDirectory, "MF_S01_EN");
const BILINGUAL_SUBTITLE_DIR = path.join(subsDirectory, "MF_S01_BI");

const BIN_SECONDS = 0.1;
const COARSE_SECONDS = 1;
const COARSE_LAG_LIMIT = 90;
const FINE_LAG_LIMIT = 8;
/**
 * A subtitle line cannot point outside the video. Offsets are therefore only
 * searched inside the band that keeps every cue within [0, duration]; the
 * tolerance absorbs container/audio length differences of a few frames.
 */
const OFFSET_TOLERANCE = 1;

function log(...args) {
  console.log(...args);
}

function round(value, digits = 3) {
  return Number(Number(value).toFixed(digits));
}

function parseTimestamp(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,2})$/);
  if (!match) {
    return NaN;
  }
  const [, hours, minutes, seconds, centiseconds] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(centiseconds.padEnd(2, "0")) / 100
  );
}

/**
 * ASS dialogue lines carry inline override blocks and \N line breaks. The
 * bilingual packs put the Chinese first and the English second.
 */
function stripAssText(raw) {
  const text = String(raw || "")
    .replace(/\{\\i?n?[^}]*\}/gi, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
  return text;
}

function isScreenText(raw) {
  return /\\pos\(/.test(String(raw || "")) || /\\p1/.test(String(raw || ""));
}

function splitBilingual(text) {
  const rows = text.split("\n").map((row) => row.trim()).filter(Boolean);
  const english = [];
  const chinese = [];
  rows.forEach((row) => {
    const cjk = (row.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (row.match(/[A-Za-z]/g) || []).length;
    if (cjk > 0 && cjk >= latin) {
      chinese.push(row);
    } else if (latin > 0) {
      english.push(row);
    } else if (cjk > 0) {
      chinese.push(row);
    }
  });
  return { en: english.join(" ").trim(), zh: chinese.join("").trim() };
}

/**
 * Subtitle files come from mixed sources: the Chinese pack is UTF-16LE with a
 * BOM, the English pack is plain UTF-8. Decode by BOM so the Chinese column
 * survives instead of turning into replacement characters.
 */
async function readSubtitleText(filePath) {
  const buffer = await fs.readFile(filePath);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  const text = buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function parseAss(filePath) {
  const raw = await readSubtitleText(filePath);
  const cues = [];
  raw.split(/\r?\n/).forEach((line) => {
    if (!/^Dialogue:/i.test(line)) {
      return;
    }
    const payload = line.slice(line.indexOf(":") + 1);
    const parts = payload.split(",");
    if (parts.length < 10) {
      return;
    }
    const start = parseTimestamp(parts[1]);
    const end = parseTimestamp(parts[2]);
    const rawText = parts.slice(9).join(",");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }
    if (isScreenText(rawText)) {
      return;
    }
    const { en, zh } = splitBilingual(stripAssText(rawText));
    if (!en && !zh) {
      return;
    }
    cues.push({
      start: round(start),
      end: round(end),
      en,
      zh,
    });
  });
  cues.sort((left, right) => left.start - right.start);
  return cues;
}

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘`]/g, "'")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speechMask(cues, seconds, binSeconds = BIN_SECONDS) {
  const bins = Math.max(1, Math.round(seconds / binSeconds));
  const mask = new Float32Array(bins);
  cues.forEach((cue) => {
    const from = Math.max(0, Math.floor(cue.start / binSeconds));
    const to = Math.min(bins - 1, Math.ceil(cue.end / binSeconds));
    for (let index = from; index <= to; index += 1) {
      mask[index] = 1;
    }
  });
  return mask;
}

function downsample(values, factor) {
  const bins = Math.floor(values.length / factor);
  const out = new Float32Array(bins);
  for (let index = 0; index < bins; index += 1) {
    let total = 0;
    for (let offset = 0; offset < factor; offset += 1) {
      total += values[index * factor + offset];
    }
    out[index] = total / factor;
  }
  return out;
}

function normalize(values) {
  const out = new Float32Array(values.length);
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
  }
  const mean = sum / Math.max(1, values.length);
  let variance = 0;
  for (let index = 0; index < values.length; index += 1) {
    const diff = values[index] - mean;
    variance += diff * diff;
  }
  const deviation = Math.sqrt(variance / Math.max(1, values.length)) || 1;
  for (let index = 0; index < values.length; index += 1) {
    out[index] = (values[index] - mean) / deviation;
  }
  return out;
}

/** Pearson correlation of the subtitle mask against the audio envelope. */
function correlate(envelope, mask, lagBins) {
  const length = Math.min(envelope.length, mask.length);
  const from = Math.max(0, lagBins);
  const to = Math.min(length, mask.length + lagBins);
  let count = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  for (let index = from; index < to; index += 1) {
    const maskIndex = index - lagBins;
    if (maskIndex < 0 || maskIndex >= mask.length || index >= envelope.length) {
      continue;
    }
    const a = envelope[index];
    const b = mask[maskIndex];
    count += 1;
    sumA += a;
    sumB += b;
    sumAA += a * a;
    sumBB += b * b;
    sumAB += a * b;
  }
  if (count < 60) {
    return 0;
  }
  const numerator = count * sumAB - sumA * sumB;
  const denominator =
    Math.sqrt(count * sumAA - sumA * sumA) *
    Math.sqrt(count * sumBB - sumB * sumB);
  return denominator ? numerator / denominator : 0;
}

function bestLag(envelope, mask, minBins, maxBins, stepBins = 1) {
  let best = { score: -2, lag: 0 };
  for (let lag = minBins; lag <= maxBins; lag += stepBins) {
    const score = correlate(envelope, mask, lag);
    if (score > best.score) {
      best = { score, lag };
    }
  }
  return best;
}

/**
 * The offset band in which a subtitle pack can possibly belong to a video:
 * cue times shifted by the offset have to stay inside the video itself.
 */
function allowedOffsetRange(duration, firstCueStart, lastCueEnd) {
  return [
    Math.max(-COARSE_LAG_LIMIT, -firstCueStart - OFFSET_TOLERANCE),
    Math.min(COARSE_LAG_LIMIT, duration - lastCueEnd + OFFSET_TOLERANCE),
  ];
}

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath],
      { windowsHide: true },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const value = Number.parseFloat(output.trim());
      if (code !== 0 || !Number.isFinite(value)) {
        reject(new Error(`ffprobe failed for ${filePath}`));
        return;
      }
      resolve(value);
    });
  });
}

/**
 * Decodes the first audio stream once and keeps a 100 ms loudness envelope.
 * Speech, laughter and music all raise the envelope, which is exactly what the
 * subtitle on/off pattern should follow.
 */
function energyProfile(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      [
        "-v", "error",
        "-i", filePath,
        "-map", "0:a:0",
        "-ac", "1",
        "-ar", "16000",
        "-f", "s16le",
        "-",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const samplesPerBin = 1600;
    const bins = [];
    let carry = Buffer.alloc(0);
    let sumSquares = 0;
    let count = 0;
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      let buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buffer.length - (buffer.length % 2);
      for (let offset = 0; offset < usable; offset += 2) {
        const value = buffer.readInt16LE(offset) / 32768;
        sumSquares += value * value;
        count += 1;
        if (count >= samplesPerBin) {
          bins.push(Math.sqrt(sumSquares / count));
          sumSquares = 0;
          count = 0;
        }
      }
      carry = usable === buffer.length ? Buffer.alloc(0) : buffer.subarray(usable);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg failed for ${filePath}: ${stderr.slice(0, 400)}`));
        return;
      }
      resolve(Float32Array.from(bins));
    });
  });
}

async function loadSubtitlePacks() {
  const englishFiles = (await fs.readdir(ENGLISH_SUBTITLE_DIR))
    .filter((name) => name.toLowerCase().endsWith(".ass"))
    .sort();
  const bilingualFiles = (await fs.readdir(BILINGUAL_SUBTITLE_DIR))
    .filter((name) => name.toLowerCase().endsWith(".ass"))
    .sort();

  const english = new Map();
  for (const name of englishFiles) {
    const id = (name.match(/S01E(\d{2})/i) || [])[1];
    if (!id) {
      continue;
    }
    const cues = await parseAss(path.join(ENGLISH_SUBTITLE_DIR, name));
    english.set(`S01E${id}`, { file: name, cues });
  }

  const bilingual = new Map();
  for (const name of bilingualFiles) {
    const id = (name.match(/S01E(\d{2})/i) || [])[1];
    if (!id) {
      continue;
    }
    const cues = await parseAss(path.join(BILINGUAL_SUBTITLE_DIR, name));
    bilingual.set(`S01E${id}`, { file: name, cues });
  }

  return { english, bilingual };
}

function similarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b || a.includes(b) || b.includes(a)) {
    return 1;
  }
  const aWords = new Set(a.split(" "));
  const bWords = new Set(b.split(" "));
  let shared = 0;
  aWords.forEach((word) => {
    if (bWords.has(word)) {
      shared += 1;
    }
  });
  return (2 * shared) / (aWords.size + bWords.size);
}

function overlapSeconds(left, right) {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

/**
 * Both packs carry translator notes such as "[WTF=What the FUCK意思是搞毛啊]".
 * They are not dialogue: no clip should be cut for them and they must not show
 * up as a subtitle line on the site.
 */
function isTranslatorNote(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return cjk >= 3 && /[[\]]/.test(text);
}

/**
 * Builds the per-episode line table the site reads.
 *
 * The English pack is the reference for cue boundaries, because the audio
 * clips are cut on those times. The two packs were not released together
 * though: a few blocks are split differently and the text-only match used to
 * drift after the first disagreement. Cues are therefore paired by time
 * overlap first, text similarity decides between competing candidates, and
 * pure text matching is only a conservative fallback when the packs disagree
 * about timing.
 */
function buildEpisodeLines(englishCues, bilingualCues) {
  const used = new Set();
  const rows = [];
  const textless = [];

  englishCues.forEach((cue) => {
    const en = cue.en.trim();
    if (!en) {
      textless.push(cue);
      return;
    }
    if (isTranslatorNote(en)) {
      return;
    }
    rows.push({ start: cue.start, end: cue.end, en, zh: "", paired: false });
  });
  rows.sort((left, right) => left.start - right.start);

  const overlaps = (row, cue) =>
    overlapSeconds(row, cue) >= 0.25 || Math.abs(cue.start - row.start) <= 0.6;

  // Pass 1: time overlap wins, text similarity breaks the tie.
  rows.forEach((row) => {
    let best = null;
    bilingualCues.forEach((cue, index) => {
      if (used.has(index) || !cue.en || !overlaps(row, cue)) {
        return;
      }
      const score = similarity(row.en, cue.en);
      if (!best || score > best.score + 1e-9) {
        best = { index, score };
      }
    });
    if (best && best.score >= 0.3) {
      used.add(best.index);
      row.zh = bilingualCues[best.index].zh;
      row.paired = true;
    }
  });

  // Pass 2: when the bilingual pack merges several English lines into one
  // block, only the first row can carry that Chinese sentence. The other rows
  // are still considered placed so the text fallback does not steal a cue.
  rows.forEach((row) => {
    if (row.paired) {
      return;
    }
    const owner = bilingualCues.find(
      (cue, index) =>
        used.has(index) && cue.en && normalizeText(cue.en).includes(normalizeText(row.en)),
    );
    if (owner) {
      row.paired = true;
      row.mergedInto = true;
    }
  });

  // Pass 3: text-only fallback for rows the timing pass could not place.
  let cursor = 0;
  rows.forEach((row) => {
    if (row.paired) {
      return;
    }
    let best = { index: -1, score: 0 };
    for (
      let index = Math.max(0, cursor - 4);
      index < Math.min(bilingualCues.length, cursor + 260);
      index += 1
    ) {
      const cue = bilingualCues[index];
      if (used.has(index) || !cue.en) {
        continue;
      }
      const score = similarity(row.en, cue.en);
      if (score > best.score) {
        best = { index, score };
      }
    }
    if (best.index >= 0 && best.score >= 0.8) {
      used.add(best.index);
      cursor = best.index + 1;
      row.paired = true;
      row.zh = bilingualCues[best.index].zh;
    }
  });

  // Pass 4: some English cues are translator notes with no dialogue, while the
  // bilingual pack carries the actual line at that moment. Recover those.
  let filled = 0;
  textless.forEach((cue) => {
    const index = bilingualCues.findIndex(
      (other, position) =>
        !used.has(position) &&
        other.en &&
        (overlapSeconds(cue, other) >= 0.25 || Math.abs(other.start - cue.start) <= 0.6),
    );
    if (index < 0) {
      return;
    }
    const other = bilingualCues[index];
    used.add(index);
    filled += 1;
    rows.push({
      start: cue.start,
      end: Math.max(cue.end, other.end),
      en: other.en,
      zh: other.zh,
      paired: true,
      filled: true,
    });
  });

  rows.sort((left, right) => left.start - right.start);
  const output = rows.map((row, index) => ({
    index: index + 1,
    start: round(row.start),
    end: round(row.end),
    en: row.en.replace(/\s+/g, " ").trim(),
    zh: row.zh || "",
  }));
  return {
    rows: output,
    matched: output.filter((row) => row.zh).length,
    filled,
    total: output.length,
  };
}

async function mapEpisodes() {
  await fs.mkdir(subsDirectory, { recursive: true });
  const { english, bilingual } = await loadSubtitlePacks();
  const videoFiles = (await fs.readdir(VIDEO_DIRECTORY))
    .filter((name) => VIDEO_PATTERN.test(name))
    .sort((left, right) => {
      const a = Number(left.match(VIDEO_PATTERN)[1]);
      const b = Number(right.match(VIDEO_PATTERN)[1]);
      return a - b;
    });

  log(`subtitle packs: english=${english.size} bilingual=${bilingual.size}`);
  log(`video files: ${videoFiles.length}`);

  const videos = [];
  const concurrency = Number(process.env.MOVIE_ANALYZE_CONCURRENCY || 4);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, videoFiles.length) }, async () => {
      while (index < videoFiles.length) {
        const name = videoFiles[index];
        index += 1;
        const filePath = path.join(VIDEO_DIRECTORY, name);
        const duration = await probeDuration(filePath);
        const envelope = await energyProfile(filePath);
        videos.push({
          file: name,
          path: filePath,
          duration: round(duration),
          envelope,
        });
        log(`  analysed ${name} (${round(duration, 1)}s, ${envelope.length} bins)`);
      }
    }),
  );
  videos.sort((left, right) => Number(left.file.match(VIDEO_PATTERN)[1]) - Number(right.file.match(VIDEO_PATTERN)[1]));

  const episodes = [...english.keys()].sort();
  const masks = new Map();
  episodes.forEach((id) => {
    const cues = english.get(id).cues;
    const lastCueEnd = Math.max(...cues.map((cue) => cue.end));
    const seconds = lastCueEnd + 5;
    masks.set(id, {
      coarse: downsample(speechMask(cues, seconds), Math.round(COARSE_SECONDS / BIN_SECONDS)),
      fine: speechMask(cues, seconds),
      firstCueStart: cues[0].start,
      lastCueEnd,
    });
  });

  const results = new Map();
  for (const video of videos) {
    const profileCoarse = downsample(normalize(video.envelope), Math.round(COARSE_SECONDS / BIN_SECONDS));
    const scored = episodes
      .map((id) => {
        const maskSet = masks.get(id);
        const allowed = allowedOffsetRange(video.duration, maskSet.firstCueStart, maskSet.lastCueEnd);
        if (allowed[1] < allowed[0]) {
          return { id, score: -2, lag: 0, allowed };
        }
        const coarse = bestLag(
          profileCoarse,
          maskSet.coarse,
          Math.round(allowed[0] / COARSE_SECONDS),
          Math.round(allowed[1] / COARSE_SECONDS),
        );
        return { id, score: coarse.score, lag: coarse.lag * COARSE_SECONDS, allowed };
      })
      .sort((left, right) => right.score - left.score);
    results.set(video.file, { video, scored });
  }

  // Greedy assignment over the coarse scores keeps the mapping one-to-one.
  const assigned = new Map();
  const takenEpisodes = new Set();
  const pending = [...results.entries()].flatMap(([file, value]) =>
    value.scored.map((candidate) => ({ file, ...candidate })),
  );
  pending.sort((left, right) => right.score - left.score);
  for (const candidate of pending) {
    if (assigned.has(candidate.file) || takenEpisodes.has(candidate.id)) {
      continue;
    }
    assigned.set(candidate.file, candidate);
    takenEpisodes.add(candidate.id);
  }

  const report = [];
  assigned.forEach((candidate, file) => {
    const video = results.get(file).video;
    const id = candidate.id;
    const envelopeFine = normalize(video.envelope);
    const maskFine = masks.get(id).fine;
    const allowed = allowedOffsetRange(
      video.duration,
      masks.get(id).firstCueStart,
      masks.get(id).lastCueEnd,
    );
    // Coarse lags only ranked the candidates; the offset itself is measured on
    // the full-resolution envelope inside the physically possible band.
    const refined = bestLag(
      envelopeFine,
      maskFine,
      Math.round(allowed[0] / BIN_SECONDS),
      Math.round(allowed[1] / BIN_SECONDS),
      1,
    );
    const offset = round(refined.lag * BIN_SECONDS);
    const allowedBins = [
      Math.round(allowed[0] / BIN_SECONDS),
      Math.round(allowed[1] / BIN_SECONDS),
    ];

    // Drift check: compare the best local offset in the first and last third.
    const thirds = [0, 1, 2].map((third) => {
      const from = Math.floor((envelopeFine.length * third) / 3);
      const to = Math.floor((envelopeFine.length * (third + 1)) / 3);
      const sliceEnvelope = envelopeFine.subarray(from, to);
      const sliceMask = maskFine.subarray(
        Math.max(0, from - Math.round(offset / BIN_SECONDS)),
        Math.max(0, to - Math.round(offset / BIN_SECONDS)),
      );
      if (sliceEnvelope.length < 120 || sliceMask.length < 120) {
        return null;
      }
      const local = bestLag(
        sliceEnvelope,
        sliceMask,
        Math.max(-FINE_LAG_LIMIT * 6, allowedBins[0] - refined.lag),
        Math.min(FINE_LAG_LIMIT * 6, allowedBins[1] - refined.lag),
      );
      return local.score > 0.15 ? round(local.lag * BIN_SECONDS) : null;
    });

    report.push({
      episode: id,
      file,
      path: video.path,
      duration: video.duration,
      offsetSeconds: offset,
      score: round(refined.score, 3),
      coarseScore: round(candidate.score, 3),
      lastCueEnd: round(masks.get(id).lastCueEnd),
      tailSeconds: round(video.duration - masks.get(id).lastCueEnd - offset),
      firstThirdOffset: thirds[0],
      secondThirdOffset: thirds[1],
      lastThirdOffset: thirds[2],
      runnersUp: results
        .get(file)
        .scored.filter((item) => item.id !== id)
        .slice(0, 3)
        .map((item) => ({ id: item.id, score: round(item.score, 3) })),
    });
  });

  report.sort((left, right) => left.episode.localeCompare(right.episode));

  const translations = {};
  report.forEach((entry) => {
    const englishCues = english.get(entry.episode).cues;
    const bilingualPack = bilingual.get(entry.episode);
    if (!bilingualPack) {
      translations[entry.episode] = { matched: 0, total: englishCues.length };
      return;
    }
    const { rows, matched, filled, total } = buildEpisodeLines(englishCues, bilingualPack.cues);
    entry.bilingualSource = bilingualPack.file;
    entry.cueCount = total;
    entry.translationMatch = matched;
    entry.translationFilled = filled;
    translations[entry.episode] = { matched, filled, total, rows };
  });

  report.forEach((entry) => {
    log(
      `  ${entry.episode} <= ${entry.file}  offset=${entry.offsetSeconds}s  score=${entry.score} ` +
        `(next best ${entry.runnersUp[0]?.score ?? "-"})  zh=${entry.translationMatch ?? 0}/${entry.cueCount ?? 0}  ` +
        `tail=${entry.tailSeconds}s`,
    );
  });

  await fs.writeFile(
    mapPath,
    `${JSON.stringify(
      {
        generatedBy: "scripts/prepare-movie-media.mjs",
        generatedAt: new Date().toISOString(),
        subtitleSources: {
          english: path.relative(root, ENGLISH_SUBTITLE_DIR),
          bilingual: path.relative(root, BILINGUAL_SUBTITLE_DIR),
        },
        episodes: report,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(subsDirectory, "modern-family-s01-lines.json"),
    `${JSON.stringify(translations, null, 2)}\n`,
    "utf8",
  );
  log(`wrote ${path.relative(root, mapPath)}`);
}

function assTimestamp(seconds) {
  const value = Math.max(0, seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  const centis = Math.round((value - Math.floor(value)) * 100);
  const carry = centis >= 100 ? 1 : 0;
  const finalSeconds = secs + carry;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(
    finalSeconds >= 60 ? finalSeconds - 60 : finalSeconds,
  ).padStart(2, "0")}.${String(carry && finalSeconds >= 60 ? 0 : centis >= 100 ? 0 : centis).padStart(2, "0")}`;
}

function srtTimestamp(seconds) {
  const value = Math.max(0, seconds);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  const millis = Math.round((value - Math.floor(value)) * 1000);
  const date = new Date(Date.UTC(2000, 0, 1, hours, minutes, secs, millis));
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")},${String(
    date.getUTCMilliseconds(),
  ).padStart(3, "0")}`;
}

function decodePcm(filePath, sampleRate) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      [
        "-v", "error",
        "-i", filePath,
        "-map", "0:a:0",
        "-ac", "1",
        "-ar", String(sampleRate),
        "-f", "s16le",
        "-",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg decode failed: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

function encodeMp3(pcm, sampleRate, bitrate, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      FFMPEG,
      [
        "-v", "error",
        "-y",
        "-f", "s16le",
        "-ar", String(sampleRate),
        "-ac", "1",
        "-i", "pipe:0",
        "-c:a", "libmp3lame",
        "-b:a", bitrate,
        outputPath,
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg encode failed: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve();
    });
    child.stdin.end(pcm);
  });
}

async function readEpisodeMap() {
  const raw = await fs.readFile(mapPath, "utf8").catch(() => "");
  if (!raw) {
    throw new Error(`missing ${mapPath}; run "node scripts/prepare-movie-media.mjs map" first`);
  }
  return JSON.parse(raw);
}

async function buildEpisodes(ids) {
  const map = await readEpisodeMap();
  const linesRaw = await fs.readFile(
    path.join(subsDirectory, "modern-family-s01-lines.json"),
    "utf8",
  );
  const lines = JSON.parse(linesRaw);
  const { bilingual } = await loadSubtitlePacks();
  const sampleRate = Number(process.env.MOVIE_SAMPLE_RATE || 24000);
  const bitrate = process.env.MOVIE_MP3_BITRATE || "32k";
  const gapSeconds = Number(process.env.MOVIE_GAP_SECONDS || 0.18);
  const gapSamples = Math.round(gapSeconds * sampleRate);
  const fadeSamples = Math.round(0.008 * sampleRate);

  for (const id of ids) {
    const entry = map.episodes.find((item) => item.episode === id);
    if (!entry) {
      throw new Error(`episode ${id} missing from the map`);
    }
    const cueRows = lines[id]?.rows;
    if (!Array.isArray(cueRows) || !cueRows.length) {
      throw new Error(`episode ${id} has no subtitle lines`);
    }
    const bilingualCues = bilingual.get(id)?.cues || [];
    const pcm = await decodePcm(entry.path, sampleRate);
    const totalSamples = pcm.length / 2;
    const offset = entry.offsetSeconds;

    const clips = [];
    let cursor = 0;
    cueRows.forEach((row) => {
      const startSeconds = row.start + offset;
      const endSeconds = row.end + offset;
      let startSample = Math.round(startSeconds * sampleRate);
      let endSample = Math.round(endSeconds * sampleRate);
      startSample = Math.max(0, Math.min(totalSamples, startSample));
      endSample = Math.max(startSample, Math.min(totalSamples, endSample));
      if (endSample - startSample < Math.round(0.12 * sampleRate)) {
        endSample = Math.min(totalSamples, startSample + Math.round(0.12 * sampleRate));
      }
      if (endSample <= startSample) {
        return;
      }
      const length = endSample - startSample;
      const buffer = Buffer.alloc(length * 2);
      pcm.copy(buffer, 0, startSample * 2, endSample * 2);
      // Soften the cut so the concatenated sprite does not click.
      for (let index = 0; index < fadeSamples && index < length; index += 1) {
        const gain = index / fadeSamples;
        const head = Math.round(buffer.readInt16LE(index * 2) * gain);
        buffer.writeInt16LE(head, index * 2);
        const tailIndex = length - 1 - index;
        const tail = Math.round(buffer.readInt16LE(tailIndex * 2) * gain);
        buffer.writeInt16LE(tail, tailIndex * 2);
      }
      clips.push({
        index: row.index,
        en: row.en,
        zh: row.zh,
        sourceStart: row.start,
        sourceEnd: row.end,
        spriteStart: cursor / sampleRate,
        spriteEnd: (cursor + length) / sampleRate,
        buffer,
      });
      cursor += length + gapSamples;
    });

    const sprite = Buffer.concat(
      clips.flatMap((clip) => [clip.buffer, Buffer.alloc(gapSamples * 2)]),
    );
    const episodeDirectory = path.join(showDirectory, id);
    await fs.mkdir(episodeDirectory, { recursive: true });
    const mp3Path = path.join(episodeDirectory, `${id}.mp3`);
    await encodeMp3(sprite, sampleRate, bitrate, mp3Path);
    const stats = await fs.stat(mp3Path);

    const srtBody = clips
      .map((clip, position) =>
        [
          position + 1,
          `${srtTimestamp(clip.spriteStart)} --> ${srtTimestamp(clip.spriteEnd)}`,
          clip.en.replace(/\s+/g, " ").trim(),
        ].join("\n"),
      )
      .join("\n\n");
    await fs.writeFile(path.join(episodeDirectory, `${id}.srt`), `${srtBody}\n`, "utf8");

    const blocks = clips.map((clip, position) => ({
      i: position + 1,
      speaker: "",
      text: clip.en.replace(/\s+/g, " ").trim(),
    }));
    const translations = {};
    clips.forEach((clip, position) => {
      if (clip.zh) {
        translations[String(position + 1)] = clip.zh;
      }
    });
    await fs.writeFile(
      path.join(showDirectory, `${id.toLowerCase()}-lines.json`),
      `${JSON.stringify({ episode: id, source: entry.bilingualSource, blocks }, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(showDirectory, `${id.toLowerCase()}-reviewed-translations.json`),
      `${JSON.stringify(translations, null, 2)}\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(episodeDirectory, `${id}-cues.json`),
      `${JSON.stringify(
        {
          episode: id,
          source: entry.file,
          offsetSeconds: offset,
          bilingualMissing: bilingualCues.length ? 0 : 1,
          clips: clips.map((clip) => ({
            index: clip.index,
            en: clip.en,
            zh: clip.zh,
            sourceStart: clip.sourceStart,
            sourceEnd: clip.sourceEnd,
            spriteStart: round(clip.spriteStart),
            spriteEnd: round(clip.spriteEnd),
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    log(
      `${id}: ${clips.length} clips, sprite ${round(stats.size / 1024 / 1024, 2)} MB, ` +
        `speech ${round(sprite.length / 2 / sampleRate / 60, 1)} min, zh ${clips.filter((clip) => clip.zh).length}`,
    );
  }
}

async function main() {
  const command = process.argv[2] || "map";
  if (command === "map") {
    await mapEpisodes();
    return;
  }
  if (command === "diagnose") {
    const ids = process.argv.slice(3).map((value) => value.toUpperCase());
    const { english, bilingual } = await loadSubtitlePacks();
    const targets = ids.length ? ids : [...english.keys()].sort();
    for (const id of targets) {
      const englishCues = english.get(id)?.cues || [];
      const bilingualCues = bilingual.get(id)?.cues || [];
      const { rows, matched, filled, total } = buildEpisodeLines(englishCues, bilingualCues);
      log(
        `${id}: english=${englishCues.length} bilingual=${bilingualCues.length} ` +
          `rows=${total} zh=${matched} recovered=${filled}`,
      );
      rows.filter((row) => !row.zh).slice(0, 10).forEach((row) => {
        const nearby = bilingualCues
          .filter((cue) => Math.abs(cue.start - row.start) <= 2)
          .slice(0, 3)
          .map((cue) => `${round(cue.start, 2)}s "${cue.en}"`)
          .join(" | ");
        log(`  #${row.index} @${row.start}s en="${row.en}" -> ${nearby || "(none)"}`);
      });
    }
    return;
  }
  if (command === "build") {
    const ids = process.argv.slice(3).map((value) => value.toUpperCase());
    if (!ids.length) {
      throw new Error("usage: node scripts/prepare-movie-media.mjs build S01E01 [S01E02 ...]");
    }
    await buildEpisodes(ids);
    return;
  }
  if (command === "timestamp") {
    console.log(assTimestamp(Number(process.argv[3] || 0)));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

await main();
