/**
 * 生成「听句 / 跟读」模块用的练习数据：
 *   study-data/index.json      剧集索引（集号、句数、时长，用于懒加载）
 *   study-data/<集号>.json     单集练习素材（真原声时间轴 + 台词 + 译文）
 *
 * 数据来源全部是站内已有产物，不引入新的第三方内容：
 *   movie-data/<集号>.js           台词、逐句译文、固定搭配、语法提示
 *   movie-data/audio/<集号>.json   精灵音频的时间轴（cue / lineCue）
 *
 * 用法：
 *   node scripts/build-study-library.mjs
 *   node scripts/build-study-library.mjs --check   只校验已生成的数据
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const movieDir = path.join(root, "movie-data");
const audioDir = path.join(movieDir, "audio");
const outDir = path.join(root, "study-data");
const checkOnly = process.argv.includes("--check");
const today = new Date().toISOString().slice(0, 10);

/** 用最小宿主执行站内生成的数据文件，取出挂在 window 上的对象。 */
async function loadWindowScript(file) {
  const source = await fs.readFile(file, "utf8");
  const holder = {};
  const run = new Function("window", `${source}\nreturn window;`);
  return run(holder);
}

function clean(value, limit = 600) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

async function readEpisode(id) {
  const dataFile = path.join(movieDir, `${id}.js`);
  const audioFile = path.join(audioDir, `${id}.json`);
  const [lib, audio] = await Promise.all([
    loadWindowScript(dataFile),
    fs.readFile(audioFile, "utf8").then((text) => JSON.parse(text)),
  ]);
  const episode = lib.IBALL_MOVIE_LIBRARY?.[id];
  if (!episode) {
    throw new Error(`${id}: movie-data 中缺少该集`);
  }
  if (audio.status !== "ready" || !Array.isArray(audio.lineCues)) {
    throw new Error(`${id}: 原声时间轴不可用`);
  }

  const lines = audio.lineCues
    .map((cue) => ({
      id: clean(cue.id, 24),
      segmentId: clean(cue.segmentId, 24),
      start: round(cue.start),
      end: round(cue.end),
      text: clean(cue.text, 400),
    }))
    .filter((line) => line.text && line.end > line.start);

  const segments = [];
  (episode.scenes || []).forEach((scene) => {
    (scene.segments || []).forEach((segment) => {
      const text = (segment.blocks || [])
        .map((block) => clean(block.text, 400))
        .filter(Boolean)
        .join(" ");
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end)) {
        return;
      }
      segments.push({
        id: clean(segment.id, 32),
        sceneId: clean(scene.id, 24),
        sceneTitle: clean(scene.title, 120),
        start: round(start),
        end: round(end),
        text,
        translation: clean(segment.translation, 600),
        keyPhrase: clean(segment.keyPhrase, 80),
        meaning: clean(segment.meaning, 120),
        phonetic: clean(segment.phonetic, 80),
        grammarNotes: (segment.grammarNotes || [])
          .map((note) => clean(note, 240))
          .filter(Boolean)
          .slice(0, 3),
      });
    });
  });

  const duration = Math.max(
    ...lines.map((line) => line.end),
    ...segments.map((segment) => segment.end),
    0,
  );

  return {
    payload: {
      generatedBy: "scripts/build-study-library.mjs",
      generatedAt: today,
      id,
      title: clean(episode.title || id, 80),
      sprite: `./movie-data/audio/${audio.sprite || `${id}.mp3`}`,
      duration: round(duration),
      lines,
      segments,
    },
    summary: {
      id,
      title: clean(episode.title || id, 80),
      file: `study-data/${id}.json`,
      duration: round(duration),
      sceneCount: segments.reduce(
        (total, segment, index, list) =>
          total + (index === 0 || list[index - 1].sceneId !== segment.sceneId ? 1 : 0),
        0,
      ),
      segmentCount: segments.length,
      lineCount: lines.length,
    },
  };
}

async function main() {
  if (checkOnly) {
    const index = JSON.parse(
      await fs.readFile(path.join(outDir, "index.json"), "utf8"),
    );
    const problems = [];
    for (const episode of index.episodes) {
      const file = path.join(root, episode.file);
      const payload = JSON.parse(await fs.readFile(file, "utf8"));
      if (payload.segments.length !== episode.segmentCount) {
        problems.push(`${episode.id}: 段落数不一致`);
      }
      if (payload.lines.length !== episode.lineCount) {
        problems.push(`${episode.id}: 台词数不一致`);
      }
      if (!payload.segments.every((segment) => segment.translation)) {
        problems.push(`${episode.id}: 存在没有译文的段落`);
      }
    }
    if (problems.length) {
      console.error("study-data 校验失败：\n" + problems.join("\n"));
      process.exitCode = 1;
      return;
    }
    console.log(`study-data 校验通过：${index.episodes.length} 集`);
    return;
  }

  const indexSource = await loadWindowScript(path.join(movieDir, "index.js"));
  const episodes = indexSource.IBALL_MOVIE_EPISODES || [];
  await fs.mkdir(outDir, { recursive: true });

  const summaries = [];
  for (const episode of episodes) {
    const { payload, summary } = await readEpisode(episode.id);
    await fs.writeFile(
      path.join(outDir, `${episode.id}.json`),
      `${JSON.stringify(payload)}\n`,
    );
    summaries.push(summary);
    console.log(
      `${episode.id}: ${summary.segmentCount} 段 / ${summary.lineCount} 句 / ${summary.duration}s`,
    );
  }

  await fs.writeFile(
    path.join(outDir, "index.json"),
    `${JSON.stringify(
      {
        generatedBy: "scripts/build-study-library.mjs",
        generatedAt: today,
        episodeCount: summaries.length,
        episodes: summaries,
      },
      null,
      2,
    )}\n`,
  );
  const total = summaries.reduce((sum, item) => sum + item.lineCount, 0);
  console.log(`已生成 ${summaries.length} 集练习数据，共 ${total} 句台词。`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
