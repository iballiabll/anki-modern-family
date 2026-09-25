#!/usr/bin/env node
/**
 * 口语 / 日常听力模块自检。
 *
 * 覆盖三件事：
 *   1. 成人真实场景包与雅思题库的字段结构、题量和前后引用是否自洽；
 *   2. 日常听力索引里的段数、场景数是否和 daily-listening-data/ 正文一致；
 *   3. app.js 里用到了的 #id 是否真的存在于 index.html（防止元素改名后静默失效）。
 *
 * 退出码 0 = 全部通过；1 = 存在错误。
 */
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const MAX_DETAILS = 12;

function loadWindowScript(source, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 20_000 });
  return sandbox.window[globalName];
}

function isFilledString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 场景包和雅思题库共用的关键词结构：label + 若干等价说法。 */
function checkKeywords(keywords, where, errors) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    errors.push(`${where}: keywords 为空`);
    return;
  }
  keywords.forEach((keyword, index) => {
    const label = `${where}: 关键词 ${index + 1}`;
    if (!isFilledString(keyword?.label)) {
      errors.push(`${label} 缺少 label`);
    }
    if (!Array.isArray(keyword?.options) || keyword.options.length < 2) {
      errors.push(`${label} 的 options 少于 2 组`);
      return;
    }
    keyword.options.forEach((group, groupIndex) => {
      if (!Array.isArray(group) || group.length === 0) {
        errors.push(`${label} 第 ${groupIndex + 1} 组 options 为空`);
        return;
      }
      group.forEach((variant, variantIndex) => {
        if (!isFilledString(variant)) {
          errors.push(`${label} 第 ${groupIndex + 1} 组第 ${variantIndex + 1} 条为空`);
        }
      });
    });
  });
}

/** 情景对话轮次与雅思题目共用同一套渲染结构。 */
function checkTurn(turn, where, errors) {
  ["speaker", "prompt", "promptZh", "sample", "sampleZh"].forEach((field) => {
    if (!isFilledString(turn?.[field])) {
      errors.push(`${where}: 缺少 ${field}`);
    }
  });
  checkKeywords(turn?.keywords, where, errors);
}

function checkScenarios(scenarios, errors) {
  if (!Array.isArray(scenarios) || scenarios.length < 6) {
    errors.push(`成人场景包至少要有 6 个场景，当前 ${scenarios?.length ?? 0} 个`);
    return;
  }
  const seen = new Set();
  scenarios.forEach((scenario, index) => {
    const where = `场景 ${scenario?.id || index + 1}`;
    if (!isFilledString(scenario?.id)) {
      errors.push(`${where}: 缺少 id`);
    } else if (seen.has(scenario.id)) {
      errors.push(`${where}: id 重复`);
    } else {
      seen.add(scenario.id);
    }
    ["title", "titleEn", "category", "level", "role", "summary"].forEach(
      (field) => {
        if (!isFilledString(scenario?.[field])) {
          errors.push(`${where}: 缺少 ${field}`);
        }
      },
    );
    if (!Array.isArray(scenario?.phrases) || scenario.phrases.length === 0) {
      errors.push(`${where}: phrases 为空`);
    }
    if (!Array.isArray(scenario?.turns) || scenario.turns.length < 4) {
      errors.push(`${where}: turns 少于 4 轮`);
      return;
    }
    scenario.turns.forEach((turn, turnIndex) => {
      checkTurn(turn, `${where} 第 ${turnIndex + 1} 轮`, errors);
    });
  });
}

function checkIelts(pack, errors) {
  if (!pack || typeof pack !== "object") {
    errors.push("雅思题库没有挂到 window.IBALL_SPEAKING_IELTS");
    return;
  }
  if (!Number.isFinite(pack.prepSeconds) || pack.prepSeconds <= 0) {
    errors.push("雅思题库缺少有效的 prepSeconds");
  }
  if (!Number.isFinite(pack.longTurnSeconds) || pack.longTurnSeconds <= 0) {
    errors.push("雅思题库缺少有效的 longTurnSeconds");
  }

  const part1 = Array.isArray(pack.part1) ? pack.part1 : [];
  if (part1.length < 3) {
    errors.push(`雅思 Part 1 话题组至少 3 个，当前 ${part1.length} 个`);
  }
  part1.forEach((group, index) => {
    const where = `雅思 Part 1 话题组 ${group?.id || index + 1}`;
    if (!isFilledString(group?.id)) {
      errors.push(`${where}: 缺少 id`);
    }
    if (!isFilledString(group?.label)) {
      errors.push(`${where}: 缺少 label`);
    }
    if (!Array.isArray(group?.questions) || group.questions.length < 4) {
      errors.push(`${where}: 问题少于 4 道`);
      return;
    }
    group.questions.forEach((question, questionIndex) => {
      checkTurn(question, `${where} 第 ${questionIndex + 1} 题`, errors);
    });
  });

  const part2 = Array.isArray(pack.part2) ? pack.part2 : [];
  if (part2.length < 3) {
    errors.push(`雅思 Part 2 题卡至少 3 张，当前 ${part2.length} 张`);
  }
  const part3 = Array.isArray(pack.part3) ? pack.part3 : [];
  const part3Ids = new Set();
  part3.forEach((group, index) => {
    const where = `雅思 Part 3 讨论组 ${group?.id || index + 1}`;
    if (!isFilledString(group?.id)) {
      errors.push(`${where}: 缺少 id`);
    } else if (part3Ids.has(group.id)) {
      errors.push(`${where}: id 重复`);
    } else {
      part3Ids.add(group.id);
    }
    if (!isFilledString(group?.for)) {
      errors.push(`${where}: 缺少 for 字段，无法和 Part 2 题卡对应`);
    }
    if (!Array.isArray(group?.questions) || group.questions.length < 3) {
      errors.push(`${where}: 追问少于 3 道`);
      return;
    }
    group.questions.forEach((question, questionIndex) => {
      checkTurn(question, `${where} 第 ${questionIndex + 1} 题`, errors);
    });
  });

  const cardIds = new Set();
  part2.forEach((card, index) => {
    const where = `雅思 Part 2 题卡 ${card?.id || index + 1}`;
    if (!isFilledString(card?.id)) {
      errors.push(`${where}: 缺少 id`);
    } else if (cardIds.has(card.id)) {
      errors.push(`${where}: id 重复`);
    } else {
      cardIds.add(card.id);
    }
    if (!isFilledString(card?.topicLine)) {
      errors.push(`${where}: 缺少 topicLine`);
    }
    if (!Array.isArray(card?.bullets) || card.bullets.length < 3) {
      errors.push(`${where}: bullets 少于 3 条`);
    }
    if (!Array.isArray(card?.bulletsZh) || card.bulletsZh.length !== card.bullets?.length) {
      errors.push(`${where}: bulletsZh 和 bullets 数量不一致`);
    }
    if (!isFilledString(card?.sample) || !isFilledString(card?.sampleZh)) {
      errors.push(`${where}: 缺少范文或范文中译`);
    }
    checkKeywords(card?.keywords, where, errors);
    if (!isFilledString(card?.part3Id)) {
      errors.push(`${where}: 缺少 part3Id`);
    } else if (!part3Ids.has(card.part3Id)) {
      errors.push(`${where}: part3Id 指向不存在的 Part 3 讨论组`);
    }
  });
  part3.forEach((group) => {
    if (isFilledString(group?.for) && !cardIds.has(group.for)) {
      errors.push(`雅思 Part 3 讨论组 ${group.for} 没有对应的 Part 2 题卡`);
    }
  });
}

function checkDailyPapers(index, libraries, errors) {
  if (!Array.isArray(index) || index.length === 0) {
    errors.push("日常听力索引为空");
    return;
  }
  const seen = new Set();
  index.forEach((paper, position) => {
    const where = `日常听力 ${paper?.id || position + 1}`;
    if (!isFilledString(paper?.id)) {
      errors.push(`${where}: 缺少 id`);
      return;
    }
    if (seen.has(paper.id)) {
      errors.push(`${where}: id 重复`);
    }
    seen.add(paper.id);
    ["label", "title", "file"].forEach((field) => {
      if (!isFilledString(paper?.[field])) {
        errors.push(`${where}: 缺少 ${field}`);
      }
    });
    const payload = libraries.get(paper.id);
    if (!payload) {
      errors.push(`${where}: 没有对应的正文数据`);
      return;
    }
    const pieces = Array.isArray(payload.pieces) ? payload.pieces : [];
    const paragraphCount = pieces.reduce(
      (total, piece) => total + (Array.isArray(piece?.paragraphs) ? piece.paragraphs.length : 0),
      0,
    );
    if (pieces.length !== paper.pieceCount) {
      errors.push(
        `${where}: 索引写 ${paper.pieceCount} 个场景，正文实际 ${pieces.length} 个`,
      );
    }
    if (paragraphCount !== paper.paragraphCount) {
      errors.push(
        `${where}: 索引写 ${paper.paragraphCount} 段，正文实际 ${paragraphCount} 段`,
      );
    }
    if (payload.meta?.pieceCount !== pieces.length) {
      errors.push(
        `${where}: meta.pieceCount 是 ${payload.meta?.pieceCount}，正文实际 ${pieces.length}`,
      );
    }
    if (payload.meta?.paragraphCount !== paragraphCount) {
      errors.push(
        `${where}: meta.paragraphCount 是 ${payload.meta?.paragraphCount}，正文实际 ${paragraphCount}`,
      );
    }
    if (payload.meta?.title !== paper.title) {
      errors.push(`${where}: 索引标题和正文 meta.title 不一致`);
    }
    const questionFields = [
      paper.questionCount,
      payload.meta?.questionCount,
    ].filter((value) => value !== undefined);
    const realQuestions = pieces.reduce(
      (total, piece) => total + (Array.isArray(piece?.questions) ? piece.questions.length : 0),
      0,
    );
    questionFields.forEach((value) => {
      if (value !== realQuestions) {
        errors.push(
          `${where}: 标注了 ${value} 道题，但正文只有 ${realQuestions} 道，日常听力不做题目就不要写这个字段`,
        );
      }
    });
    pieces.forEach((piece, pieceIndex) => {
      const pieceWhere = `${where} 第 ${pieceIndex + 1} 个场景`;
      if (!isFilledString(piece?.id)) {
        errors.push(`${pieceWhere}: 缺少 id`);
      }
      ["section", "type"].forEach((field) => {
        if (!isFilledString(piece?.[field])) {
          errors.push(`${pieceWhere}: 缺少 ${field}`);
        }
      });
      const paragraphs = Array.isArray(piece?.paragraphs) ? piece.paragraphs : [];
      if (paragraphs.length === 0) {
        errors.push(`${pieceWhere}: 没有正文段落`);
      }
      paragraphs.forEach((paragraph, paragraphIndex) => {
        const paragraphWhere = `${pieceWhere} 第 ${paragraphIndex + 1} 段`;
        if (!isFilledString(paragraph?.english)) {
          errors.push(`${paragraphWhere}: 缺少英文原文`);
        }
        if (!isFilledString(paragraph?.chinese)) {
          errors.push(`${paragraphWhere}: 缺少中译`);
        }
        if (paragraph?.number !== paragraphIndex + 1) {
          errors.push(
            `${paragraphWhere}: number 是 ${paragraph?.number}，应为 ${paragraphIndex + 1}`,
          );
        }
      });
    });
  });
}

/** app.js 里写了 querySelector("#x") 却找不到对应元素，等于功能默认失效。 */
function checkElementIds(appSource, htmlSource, errors) {
  const htmlIds = new Set(
    [...htmlSource.matchAll(/id="([^"]+)"/g)].map((match) => match[1]),
  );
  const referenced = new Set(
    [...appSource.matchAll(/querySelector\(\s*"#([A-Za-z0-9_-]+)"\s*\)/g)].map(
      (match) => match[1],
    ),
  );
  [...referenced].sort().forEach((id) => {
    if (!htmlIds.has(id)) {
      errors.push(`app.js 取了 #${id}，但 index.html 里没有这个元素`);
    }
  });
}

async function main() {
  const errors = [];

  const scenarios = loadWindowScript(
    await fs.readFile(path.join(root, "speaking-scenarios.js"), "utf8"),
    "IBALL_SPEAKING_SCENARIOS",
  );
  checkScenarios(scenarios, errors);

  const ielts = loadWindowScript(
    await fs.readFile(path.join(root, "speaking-ielts.js"), "utf8"),
    "IBALL_SPEAKING_IELTS",
  );
  checkIelts(ielts, errors);

  const index = loadWindowScript(
    await fs.readFile(path.join(root, "daily-listening-papers.js"), "utf8"),
    "IBALL_DAILY_LISTENING_PAPERS",
  );
  const libraries = new Map();
  for (const paper of Array.isArray(index) ? index : []) {
    const file = path.join(root, "daily-listening-data", `${paper.id}.js`);
    const library = loadWindowScript(
      await fs.readFile(file, "utf8"),
      "IBALL_DAILY_LISTENING_LIBRARY",
    );
    libraries.set(paper.id, library?.[paper.id]);
  }
  checkDailyPapers(index, libraries, errors);

  checkElementIds(
    await fs.readFile(path.join(root, "app.js"), "utf8"),
    await fs.readFile(path.join(root, "index.html"), "utf8"),
    errors,
  );

  if (errors.length) {
    console.error(`口语模块自检未通过，共 ${errors.length} 项：`);
    errors.slice(0, MAX_DETAILS).forEach((message) => console.error(`  - ${message}`));
    if (errors.length > MAX_DETAILS) {
      console.error(`  ...其余 ${errors.length - MAX_DETAILS} 项略`);
    }
    process.exitCode = 1;
    return;
  }

  const scenarioCount = Array.isArray(scenarios) ? scenarios.length : 0;
  const turnCount = (Array.isArray(scenarios) ? scenarios : []).reduce(
    (total, scenario) => total + (Array.isArray(scenario.turns) ? scenario.turns.length : 0),
    0,
  );
  const ieltsQuestions =
    (ielts?.part1 || []).reduce((total, group) => total + group.questions.length, 0) +
    (ielts?.part2 || []).length +
    (ielts?.part3 || []).reduce((total, group) => total + group.questions.length, 0);
  console.log(
    [
      `成人场景 ${scenarioCount} 个 / ${turnCount} 轮`,
      `雅思题目 ${ieltsQuestions} 道（含 ${(ielts?.part2 || []).length} 张题卡）`,
      `日常听力 ${(index || []).length} 套`,
    ].join("；"),
  );
  console.log("口语模块自检通过。");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
