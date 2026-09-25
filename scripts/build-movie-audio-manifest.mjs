/**
 * Builds the per-episode original-audio cue manifest for the movie page.
 *
 * Media lookup, for episode S01E01 of 摩登家庭:
 *   materials/电影/摩登家庭/S01E01/   and   materials/电影/摩登家庭/
 * with base names "S01E01" and "s01e01".
 *
 *   - .srt / .vtt supply the per-line timings.
 *   - .mp3 / .m4a / .aac / .wav / .ogg / .opus / .flac become the audio
 *     sprite and are copied into movie-data/audio/ so the page can resolve
 *     them the same way on every host.
 *   - A video-only episode is reported as "needs-ffmpeg". This script never
 *     shells out, so nothing is guessed silently.
 *
 * The manifest keeps two aligned views:
 *   - cues: one cue per rendered segment, used as a safe fallback.
 *   - lineCues: one cue per dialogue block, so a multi-sentence segment can
 *     still play its original audio sentence by sentence.
 *
 * Cue ids use the "segment-<start>" key the player already looks up. Line cue
 * ids use "b<block-index>", matching the block ids in the movie data.
 *
 * No timing is ever invented. Without media the honest result is
 * status "no-media", sprite null, cues [], and the page falls back to browser
 * speech synthesis for every line.
 *
 * Usage:
 *   node scripts/build-movie-audio-manifest.mjs
 *   node scripts/build-movie-audio-manifest.mjs S01E01
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedEpisode = process.argv[2] && !process.argv[2].startsWith("-")
  ? process.argv[2].toUpperCase()
  : "";
const movieDataDirectory = path.join(root, "movie-data");
const outputDirectory = path.join(movieDataDirectory, "audio");
const showName = "摩登家庭";
// MOVIE_MEDIA_DIR lets a test point the lookup at a scratch folder.
const showDirectory = process.env.MOVIE_MEDIA_DIR
  ? path.resolve(root, process.env.MOVIE_MEDIA_DIR)
  : path.join(root, "materials", "电影", showName);

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".aac", ".wav", ".ogg", ".opus", ".flac"];
const SUBTITLE_EXTENSIONS = [".srt", ".vtt"];
const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".mov", ".webm", ".avi"];

const NOTE_NO_MEDIA =
  "未找到该集的原声音频与字幕文件，页面回退到浏览器朗读。把音视频和字幕放进 materials/电影/摩登家庭/<集号>/ 后重跑本脚本即可。";
const NOTE_NEEDS_FFMPEG =
  "只找到视频文件。抽取音轨需要 ffmpeg，本脚本不代为调用，请先导出音频与字幕。";
const NOTE_UNALIGNED =
  "找到媒体文件，但字幕行与台词无法对齐，已保留空 cues 以免配错音。请检查字幕语言或行数。";
const NOTE_NEEDS_AUDIO =
  "字幕已逐句对齐，但缺少音轨文件。把该集音频放进同一目录后重跑本脚本，逐句原声即可生效。";

function partialNote(coverage) {
  return `字幕只对齐了 ${Math.round(coverage * 100)}% 的台词，其余句子继续使用浏览器朗读。`;
}

function readOptional(filePath) {
  return fs.readFile(filePath, "utf8").catch(() => "");
}

function isFile(filePath) {
  return fs
    .stat(filePath)
    .then((stats) => stats.isFile())
    .catch(() => false);
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[’‘`]/g, "'")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimestamp(value) {
  const match = String(value || "")
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,4})$/);
  if (!match) {
    return NaN;
  }
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  // A punchy editor can emit ",1000"; read the fraction by digit count so a
  // 4-digit fraction still lands on the right second.
  const fraction = Number(match[4]) / 10 ** match[4].length;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

function parseSubtitle(raw) {
  const normalized = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const cues = [];

  normalized.split(/\n{2,}/).forEach((chunk) => {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      return;
    }
    if (/^WEBVTT/i.test(lines[0]) || /^NOTE\b/i.test(lines[0])) {
      return;
    }

    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      return;
    }
    const timing = lines[timingIndex].split("-->");
    const start = parseTimestamp(timing[0]);
    const end = parseTimestamp(
      String(timing[1] || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)[0],
    );
    const text = lines
      .slice(timingIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return;
    }
    cues.push({ start, end, text });
  });

  return cues;
}

async function loadEpisodeIds() {
  const manifestRaw = await readOptional(path.join(movieDataDirectory, "index.js"));
  const match = manifestRaw.match(/window\.IBALL_MOVIE_EPISODES\s*=\s*(\[[\s\S]*?\]);/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      const ids = parsed
        .map((item) => String(item?.id || "").toUpperCase())
        .filter(Boolean);
      if (ids.length) {
        return ids;
      }
    } catch {
      // Fall through to a directory scan.
    }
  }

  const entries = await fs.readdir(movieDataDirectory).catch(() => []);
  return entries
    .filter((name) => name.endsWith(".js") && name !== "index.js")
    .map((name) => path.basename(name, ".js").toUpperCase())
    .sort();
}

async function loadEpisodePayload(id) {
  const raw = await readOptional(path.join(movieDataDirectory, `${id}.js`));
  if (!raw.trim()) {
    return null;
  }
  const match = raw.match(/=\s*(\{[\s\S]*\});\s*$/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function collectSegments(payload) {
  const segments = [];
  const scenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
  scenes.forEach((scene) => {
    (Array.isArray(scene?.segments) ? scene.segments : []).forEach((segment) => {
      const start = Number(segment?.start);
      const end = Number.isFinite(Number(segment?.end)) ? Number(segment.end) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return;
      }
      const blocks = (Array.isArray(segment?.blocks) ? segment.blocks : [])
        .map((block) => ({
          i: Number(block?.i),
          text: String(block?.text || "").trim(),
        }))
        .filter((block) => Number.isFinite(block.i));
      segments.push({
        id: start === end ? `segment-${start}` : `segment-${start}-${end}`,
        start,
        end,
        text: blocks.map((block) => block.text).join(" ").trim(),
        lineIds: blocks.map((block) => `b${block.i}`),
        lines: blocks.map((block) => ({ id: `b${block.i}`, text: block.text })),
      });
    });
  });
  return segments;
}

async function findMedia(baseDirectory, baseNames) {
  const result = { subtitle: "", audio: "", video: "" };
  const extensions = [
    { key: "subtitle", list: SUBTITLE_EXTENSIONS },
    { key: "audio", list: AUDIO_EXTENSIONS },
    { key: "video", list: VIDEO_EXTENSIONS },
  ];

  for (const baseName of baseNames) {
    for (const { key, list } of extensions) {
      if (result[key]) {
        continue;
      }
      for (const extension of list) {
        const candidate = path.join(baseDirectory, `${baseName}${extension}`);
        if (await isFile(candidate)) {
          result[key] = candidate;
          break;
        }
      }
    }
  }

  return result;
}

async function locateMedia(id) {
  const baseNames = [id, id.toLowerCase()];
  const directories = [path.join(showDirectory, id), showDirectory];

  for (const directory of directories) {
    const media = await findMedia(directory, baseNames);
    if (media.subtitle || media.audio || media.video) {
      return media;
    }
  }

  return { subtitle: "", audio: "", video: "" };
}

function flattenLines(segments) {
  const flat = [];
  segments.forEach((segment) => {
    segment.lines.forEach((line, lineIndex) => {
      flat.push({ segment, line, lineIndex, text: line.text });
    });
  });
  return flat;
}

function textsLookAlike(left, right) {
  const rawLeft = String(left || "").replace(/\s+/g, " ").trim().toLowerCase();
  const rawRight = String(right || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (rawLeft && rawLeft === rawRight) {
    return true;
  }
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return false;
  }
  return a === b || a.includes(b) || b.includes(a);
}

function aggregateCues(segments, pairs) {
  const bySegment = new Map();
  pairs.forEach((pair) => {
    const list = bySegment.get(pair.segmentId) || [];
    list.push(pair);
    bySegment.set(pair.segmentId, list);
  });

  return segments
    .filter((segment) => bySegment.has(segment.id))
    .map((segment) => {
      const list = bySegment.get(segment.id);
      return {
        id: segment.id,
        start: Number(Math.min(...list.map((pair) => pair.start)).toFixed(3)),
        end: Number(Math.max(...list.map((pair) => pair.end)).toFixed(3)),
        text: segment.text,
        lineIds: segment.lineIds,
        matchedLines: list.length,
        totalLines: segment.lines.length,
      };
    });
}

function buildLineCues(segments, pairs) {
  const linesById = new Map();
  segments.forEach((segment) => {
    segment.lines.forEach((line) => {
      linesById.set(line.id, { line, segment });
    });
  });

  return pairs
    .map((pair) => {
      const entry = linesById.get(pair.lineId);
      if (!entry) {
        return null;
      }
      return {
        id: pair.lineId,
        segmentId: pair.segmentId,
        start: Number(Number(pair.start).toFixed(3)),
        end: Number(Number(pair.end).toFixed(3)),
        text: entry.line.text,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.start - right.start);
}

function pairCuesToSegments(subtitleCues, segments) {
  const flatLines = flattenLines(segments);
  if (!flatLines.length || !subtitleCues.length) {
    return { alignment: null, cues: [], lineCues: [], coverage: 0 };
  }

  // One subtitle line per dialogue line: keep the file order, but only trust
  // it when most of the text actually looks alike.
  if (subtitleCues.length === flatLines.length) {
    const pairs = [];
    let alike = 0;
    flatLines.forEach((line, index) => {
      const cue = subtitleCues[index];
      if (textsLookAlike(line.text, cue.text)) {
        alike += 1;
      }
      pairs.push({
        lineId: line.line.id,
        segmentId: line.segment.id,
        start: cue.start,
        end: cue.end,
      });
    });
    const ratio = alike / flatLines.length;
    if (ratio >= 0.8) {
      return {
        alignment: "count",
        cues: aggregateCues(segments, pairs),
        lineCues: buildLineCues(segments, pairs),
        coverage: 1,
      };
    }
  }

  // Subtitle files often merge or split dialogue; match by text instead.
  const byText = new Map();
  subtitleCues.forEach((cue) => {
    const key = normalizeText(cue.text);
    if (key && !byText.has(key)) {
      byText.set(key, cue);
    }
  });

  const pairs = [];
  flatLines.forEach((line) => {
    const key = normalizeText(line.text);
    const cue = key ? byText.get(key) : null;
    if (cue) {
      pairs.push({
        lineId: line.line.id,
        segmentId: line.segment.id,
        start: cue.start,
        end: cue.end,
      });
    }
  });

  const coverage = pairs.length / flatLines.length;
  if (!pairs.length) {
    return { alignment: null, cues: [], lineCues: [], coverage: 0 };
  }
  return {
    alignment: coverage >= 0.9 ? "text" : "partial",
    cues: aggregateCues(segments, pairs),
    lineCues: buildLineCues(segments, pairs),
    coverage,
  };
}

async function buildEpisodeManifest(id) {
  const payload = await loadEpisodePayload(id);
  const segments = collectSegments(payload);
  const dialogueLineCount = segments.reduce(
    (total, segment) => total + segment.lines.length,
    0,
  );
  const media = await locateMedia(id);
  const notes = [];
  let status = "no-media";
  let sprite = null;
  let alignment = null;
  let cues = [];
  let lineCues = [];
  let subtitleCueCount = 0;

  if (media.audio) {
    const extension = path.extname(media.audio);
    const fileName = `${id}${extension}`;
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.copyFile(media.audio, path.join(outputDirectory, fileName));
    sprite = fileName;
    status = "ready";
  } else if (media.video) {
    status = "needs-ffmpeg";
    notes.push(NOTE_NEEDS_FFMPEG);
  }

  if (media.subtitle) {
    const subtitleRaw = await readOptional(media.subtitle);
    const subtitleCues = parseSubtitle(subtitleRaw);
    subtitleCueCount = subtitleCues.length;
    if (!subtitleCues.length) {
      notes.push(`${path.relative(root, media.subtitle)} 里没有解析到带时间轴的字幕行。`);
    } else if (!segments.length) {
      notes.push("没有读到台词分段，无法生成切片。");
    } else {
      const paired = pairCuesToSegments(subtitleCues, segments);
      alignment = paired.alignment;
      cues = paired.cues;
      lineCues = paired.lineCues;
      if (!paired.alignment) {
        notes.push(NOTE_UNALIGNED);
        if (status === "ready") {
          status = "unaligned";
        }
      } else if (paired.alignment === "partial") {
        notes.push(partialNote(paired.coverage));
      }
    }
  } else if (status === "ready") {
    notes.push("找到音频但缺少字幕，无法切成逐句原声，已保留空 cues。");
    status = "unaligned";
  } else if (status === "no-media") {
    notes.push(NOTE_NO_MEDIA);
  }

  if (!cues.length && sprite && status === "ready") {
    status = "unaligned";
  }

  if (cues.length && !sprite && status === "no-media") {
    status = "needs-audio";
    notes.push(NOTE_NEEDS_AUDIO);
  }

  return {
    episode: id,
    status,
    generatedBy: "scripts/build-movie-audio-manifest.mjs",
    generatedAt: new Date().toISOString().slice(0, 10),
    sprite,
    alignment,
    cueCount: cues.length,
    lineCueCount: lineCues.length,
    segmentCount: segments.length,
    dialogueLineCount,
    subtitleCueCount,
    sources: {
      subtitle: media.subtitle ? path.relative(root, media.subtitle) : "",
      audio: media.audio ? path.relative(root, media.audio) : "",
      video: media.video ? path.relative(root, media.video) : "",
    },
    notes,
    cues,
    lineCues,
  };
}

async function main() {
  const allIds = await loadEpisodeIds();
  const ids = requestedEpisode
    ? allIds.filter((id) => id === requestedEpisode)
    : allIds;

  if (!ids.length) {
    console.warn(
      requestedEpisode
        ? `没有找到剧集 ${requestedEpisode} 的数据文件。`
        : "movie-data 下还没有剧集数据，跳过原声清单生成。",
    );
    return;
  }

  await fs.mkdir(outputDirectory, { recursive: true });
  const summary = [];

  for (const id of ids) {
    const manifest = await buildEpisodeManifest(id);
    await fs.writeFile(
      path.join(outputDirectory, `${id}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    summary.push({
      id,
      status: manifest.status,
      cueCount: manifest.cueCount,
      lineCueCount: manifest.lineCueCount,
      segmentCount: manifest.segmentCount,
    });
    console.log(
      `${id}: ${manifest.status}, ${manifest.cueCount}/${manifest.segmentCount} 句原声切片`,
    );
    manifest.notes.forEach((note) => console.log(`  - ${note}`));
  }

  // Keep the union of every episode that was ever built, so running the
  // script for a single episode does not drop the other entries.
  const indexPath = path.join(outputDirectory, "index.json");
  let previous = [];
  try {
    const parsed = JSON.parse(await fs.readFile(indexPath, "utf8"));
    if (Array.isArray(parsed?.episodes)) {
      previous = parsed.episodes;
    }
  } catch {
    previous = [];
  }
  const merged = previous
    .filter((item) => item?.id && !summary.some((entry) => entry.id === item.id))
    .concat(summary)
    .sort((left, right) => String(right.id).localeCompare(String(left.id)));

  await fs.writeFile(
    indexPath,
    `${JSON.stringify(
      {
        generatedBy: "scripts/build-movie-audio-manifest.mjs",
        generatedAt: new Date().toISOString().slice(0, 10),
        episodes: merged,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`Wrote ${path.relative(root, outputDirectory)} 下的原声清单。`);
}

await main();
