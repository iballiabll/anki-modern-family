/**
 * Verifies that the dialogue sprites were cut from the right moments.
 *
 * For every requested episode the original MKV is decoded again and compared
 * against its own cue list: the loudness inside the dialogue windows has to be
 * clearly higher than in the gaps between them. That is an independent check of
 * the offset measured by scripts/prepare-movie-media.mjs - if the offset were
 * wrong, the clips would land on silence or on the wrong scene.
 *
 *   node scripts/verify-movie-media.mjs [S01E01 S01E02 ...]
 *
 * With no argument every episode of the map is checked. The command fails when
 * an episode misses the separation threshold, so it can be used as a gate.
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDirectory = path.resolve(root, "..");
const mapPath = path.join(workDirectory, "movie-episode-map.json");
const linesPath = path.join(workDirectory, "subs", "modern-family-s01-lines.json");
const FFMPEG =
  process.env.FFMPEG_PATH ||
  path.join(
    workDirectory,
    "tools",
    "ffmpeg",
    "ffmpeg-9.0.2-essentials_build",
    "bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );

const SAMPLE_RATE = 16000;
const BIN_SECONDS = 0.02;
const MIN_SEPARATION_DB = 6;
const MAX_QUIET_CUE_PERCENT = 5;

function log(...args) {
  console.log(...args);
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function decodeMono(filePath, sampleRate) {
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
        reject(new Error(`ffmpeg failed: ${stderr.slice(0, 300)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

/** Root-mean-square loudness per fixed-size bin, in dBFS. */
function loudnessBins(pcm, sampleRate) {
  const samplesPerBin = Math.max(1, Math.round(BIN_SECONDS * sampleRate));
  const total = Math.floor(pcm.length / 2 / samplesPerBin);
  const bins = new Float64Array(total);
  for (let index = 0; index < total; index += 1) {
    let sum = 0;
    for (let offset = 0; offset < samplesPerBin; offset += 1) {
      const value = pcm.readInt16LE((index * samplesPerBin + offset) * 2) / 32768;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / samplesPerBin);
    bins[index] = 20 * Math.log10(rms + 1e-6);
  }
  return bins;
}

function median(values) {
  if (!values.length) {
    return Number.NaN;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : Number.NaN;
}

function windowLoudness(bins, fromSeconds, toSeconds) {
  const from = Math.max(0, Math.floor(fromSeconds / BIN_SECONDS));
  const to = Math.min(bins.length, Math.ceil(toSeconds / BIN_SECONDS));
  if (to - from < 2) {
    return Number.NaN;
  }
  return mean(Array.from(bins.subarray(from, to)));
}

/**
 * Loudest short window inside a cue. A one-word line such as "So-" only lasts a
 * few frames, so its average level stays low even when it was cut correctly;
 * the peak still shows that the clip landed on speech.
 */
function peakLoudness(bins, fromSeconds, toSeconds, peakSeconds = 0.2) {
  const from = Math.max(0, Math.floor(fromSeconds / BIN_SECONDS));
  const to = Math.min(bins.length, Math.ceil(toSeconds / BIN_SECONDS));
  const width = Math.max(1, Math.round(peakSeconds / BIN_SECONDS));
  if (to - from < width) {
    return Number.NaN;
  }
  let best = -Infinity;
  for (let start = from; start + width <= to; start += 1) {
    let sum = 0;
    for (let offset = 0; offset < width; offset += 1) {
      sum += bins[start + offset];
    }
    const level = sum / width;
    if (level > best) {
      best = level;
    }
  }
  return best;
}

async function main() {
  const ids = process.argv.slice(2).map((value) => value.toUpperCase());
  const map = JSON.parse(await fs.readFile(mapPath, "utf8"));
  const lines = JSON.parse(await fs.readFile(linesPath, "utf8"));
  const targets = ids.length
    ? map.episodes.filter((entry) => ids.includes(entry.episode))
    : map.episodes;
  const failures = [];

  for (const entry of targets) {
    const rows = lines[entry.episode]?.rows || [];
    if (!rows.length) {
      failures.push(`${entry.episode}: no cue rows`);
      continue;
    }
    const pcm = await decodeMono(entry.path, SAMPLE_RATE);
    const bins = loudnessBins(pcm, SAMPLE_RATE);
    const duration = pcm.length / 2 / SAMPLE_RATE;
    const offset = entry.offsetSeconds;

    const cueWindows = [];
    const quietCues = [];
    let firstCueLevel = Number.NaN;
    rows.forEach((row) => {
      const level = windowLoudness(bins, row.start + offset, row.end + offset);
      const peak = peakLoudness(bins, row.start + offset, row.end + offset);
      if (!Number.isFinite(level)) {
        return;
      }
      cueWindows.push({ level, peak, row });
      if (row.index === 1) {
        firstCueLevel = level;
      }
    });
    const cueLevels = cueWindows.map((entry) => entry.level);

    const gapLevels = [];
    for (let index = 1; index < rows.length; index += 1) {
      const from = rows[index - 1].end + offset + 0.3;
      const to = rows[index].start + offset - 0.3;
      if (to - from < 0.4 || from < 0 || to > duration) {
        continue;
      }
      const level = windowLoudness(bins, from, to);
      if (Number.isFinite(level)) {
        gapLevels.push(level);
      }
    }

    const cueMedian = median(cueLevels);
    const gapMedian = median(gapLevels);
    const separation = cueMedian - gapMedian;
    // A cue counts as misaligned only when even its loudest moment stays at the
    // level of the surrounding silence.
    cueWindows.forEach((entry) => {
      if (entry.peak <= gapMedian + 3) {
        quietCues.push(entry);
      }
    });
    const quietPercent = (100 * quietCues.length) / cueLevels.length;
    const ok = separation >= MIN_SEPARATION_DB && quietPercent <= MAX_QUIET_CUE_PERCENT;

    log(
      `${entry.episode}  ${ok ? "ok  " : "FAIL"}  offset=${offset}s  cues=${cueLevels.length}  ` +
        `gapWindows=${gapLevels.length}  cueMedian=${round(cueMedian)}dB  gapMedian=${round(gapMedian)}dB  ` +
        `separation=${round(separation)}dB  quietCues=${round(quietPercent)}%  ` +
        `firstCue=${round(firstCueLevel)}dB`,
    );
    if (!ok) {
      [...quietCues]
        .sort((left, right) => left.level - right.level)
        .slice(0, 5)
        .forEach((entry) => {
          log(
            `      quiet #${entry.row.index} @${entry.row.start}s peak=${round(entry.peak)}dB ` +
              `"${entry.row.en.slice(0, 70)}"`,
          );
        });
      failures.push(
        `${entry.episode}: separation ${round(separation)}dB (need ${MIN_SEPARATION_DB}), quiet ${round(quietPercent)}%`,
      );
    }
  }

  if (failures.length) {
    log(`\n${failures.length} episode(s) failed:`);
    failures.forEach((message) => log(`  - ${message}`));
    process.exitCode = 1;
    return;
  }
  log(`\nall ${targets.length} checked episode(s) pass the speech/silence separation gate`);
}

await main();
