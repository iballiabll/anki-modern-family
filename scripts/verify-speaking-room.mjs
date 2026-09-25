#!/usr/bin/env node
/**
 * 口语房间自检。
 *
 * 这个页面最容易悄悄坏掉的地方不是样式，而是「聊着聊着变成考官」：
 * 素材包里混进书面语、本地回复开始纠错、接口回来的话带了评分腔。
 * 所以这里逐条盯住四件事：
 *   1. 人物包与话题库的结构、数量、英文里有没有混进中文；
 *   2. 本地回复生成器连聊 80 轮，是否还像真人、有没有重复和教师腔；
 *   3. 接口回复的清洗与兜底解析（JSON / 代码块 / 纯文本）；
 *   4. speaking.html 的脚本顺序和 #id 是否和 speaking.js 对得上。
 *
 * 退出码 0 = 全部通过；1 = 存在错误。
 */
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const MAX_DETAILS = 14;

const errors = [];
const notes = [];

const CJK_RE = /[\u3400-\u9fff]/;
/** 除了引擎自己的教师腔正则，再加一层「一看就是老师」的词。 */
const TEACHER_WORDS =
  /\b(?:grammar|pronunciation|vocabulary|lesson|homework|practice|practise|exercise|exam|score|band|correct|correction|mistake|teacher|tutor|student)\b/i;

function fail(message) {
  errors.push(message);
}

function isFilledString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function loadWindowScript(source, globalName) {
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 20_000 });
  const value = sandbox.window[globalName];
  if (!value) {
    throw new Error(`${globalName} 没有挂到 window 上`);
  }
  return value;
}

function checkEnglish(value, where) {
  if (!isFilledString(value)) {
    fail(`${where}: 缺少英文句子`);
    return;
  }
  if (CJK_RE.test(value)) {
    fail(`${where}: 英文句子里混进了中文「${value.slice(0, 40)}」`);
  }
}

function checkChinese(value, where) {
  if (!isFilledString(value)) {
    fail(`${where}: 缺少中文`);
  }
}

/* ------------------------------------------------------------ 1. 人物包 */

function checkPersonaPair(pair, where) {
  checkEnglish(pair?.en, where);
  checkChinese(pair?.zh, where);
}

function checkPersona(persona, index) {
  const where = `人物 ${persona?.id || index + 1}`;
  ["id", "name", "city", "job", "summary", "tagline", "wake"].forEach((field) => {
    if (!isFilledString(persona?.[field])) {
      fail(`${where}: 缺少 ${field}`);
    }
  });
  if (CJK_RE.test(String(persona?.name || ""))) {
    fail(`${where}: name 应该是英文名`);
  }

  if (!Array.isArray(persona?.openers) || persona.openers.length < 2) {
    fail(`${where}: openers 少于 2 句`);
  } else {
    persona.openers.forEach((opener, openerIndex) =>
      checkPersonaPair(opener, `${where} 开场白 ${openerIndex + 1}`),
    );
  }

  ["stories", "opinions"].forEach((field) => {
    const groups = persona?.[field];
    const tags = groups && typeof groups === "object" ? Object.keys(groups) : [];
    if (tags.length < 3) {
      fail(`${where}: ${field} 的 tag 少于 3 组`);
      return;
    }
    tags.forEach((tag) => {
      const list = groups[tag];
      if (!Array.isArray(list) || list.length === 0) {
        fail(`${where}: ${field}.${tag} 为空`);
        return;
      }
      list.forEach((item, itemIndex) =>
        checkPersonaPair(item, `${where} ${field}.${tag} 第 ${itemIndex + 1} 条`),
      );
    });
  });

  if (!persona?.habits || typeof persona.habits !== "object") {
    fail(`${where}: 缺少 habits`);
  }
}

function checkTopic(topic, index) {
  const where = `话题 ${topic?.id || index + 1}`;
  ["id", "label", "labelEn"].forEach((field) => {
    if (!isFilledString(topic?.[field])) {
      fail(`${where}: 缺少 ${field}`);
    }
  });
  checkChinese(topic?.label, `${where} label`);
  if (!Array.isArray(topic?.angles) || topic.angles.length < 3) {
    fail(`${where}: angles 少于 3 个`);
    return;
  }
  topic.angles.forEach((angle, angleIndex) => {
    checkEnglish(angle?.en, `${where} angle ${angleIndex + 1}`);
    checkChinese(angle?.zh, `${where} angle ${angleIndex + 1}`);
  });
}

function checkPack(pack) {
  const personas = Array.isArray(pack?.personas) ? pack.personas : [];
  const topics = Array.isArray(pack?.topics) ? pack.topics : [];

  if (personas.length < 8) {
    fail(`人物至少 8 个，当前 ${personas.length} 个`);
  }
  if (topics.length < 8) {
    fail(`话题至少 8 个，当前 ${topics.length} 个`);
  }
  const personaIds = new Set();
  personas.forEach((persona, index) => {
    checkPersona(persona, index);
    if (personaIds.has(persona?.id)) {
      fail(`人物 id 重复：${persona?.id}`);
    }
    personaIds.add(persona?.id);
  });
  const topicIds = new Set();
  topics.forEach((topic, index) => {
    checkTopic(topic, index);
    if (topicIds.has(topic?.id)) {
      fail(`话题 id 重复：${topic?.id}`);
    }
    topicIds.add(topic?.id);
  });

  const angles = topics.reduce(
    (total, topic) => total + (Array.isArray(topic?.angles) ? topic.angles.length : 0),
    0,
  );
  notes.push(`人物 ${personas.length} 个，话题 ${topics.length} 个，转场问题 ${angles} 条`);
  return { personas, topics };
}

/* --------------------------------------------------------- 2. 本地对话 */

/** 一串有长有短、有中文也有含糊回答的话，模拟真人学习者的输入。 */
const LEARNER_SCRIPT = [
  "I just got home from work, it was a long day.",
  "yeah",
  "I don't know.",
  "Honestly I spent the whole afternoon fixing a bug in my side project.",
  "I very like building small robots.",
  "嗯，我想说我今天特别累",
  "My roommate made hot pot and we ate way too much.",
  "What do you usually do after a long shift?",
  "nothing",
  "I'm trying to run three times a week but I keep skipping it.",
  "Work has been busy. I had two meetings back to back and then a deadline moved up.",
  "okay",
  "I watched a documentary about deep sea creatures last night.",
  "I am agree with you on that.",
  "Sorry, my cat just knocked something over.",
  "I have 26 years old.",
  "The weather here finally cooled down, so I walked to the grocery store.",
  "maybe",
  "I want to visit my parents next month but the flights are expensive.",
  "open the light, it's dark in here",
  "I've been learning to cook Thai food, the basil stir fry is my best one so far.",
  "I'm bored of my usual lunch places.",
  "I slept like four hours and I'm running on coffee.",
];

function simulateConversation(engine, persona, topics) {
  const state = {
    seed: 7,
    turnCount: 0,
    visitedTopics: [],
  };
  const lines = [];
  const shifts = [];
  const turns = 80;

  for (let index = 0; index < turns; index += 1) {
    const learnerText = LEARNER_SCRIPT[index % LEARNER_SCRIPT.length];
    state.turnCount = index + 1;
    const reply = engine.generateLocalReply({
      persona,
      state,
      learnerText,
      topics,
    });
    if (!reply || !isFilledString(reply.en)) {
      fail(`第 ${index + 1} 轮没有生成英文回复（输入：${learnerText.slice(0, 30)}）`);
      break;
    }
    lines.push({ turn: index + 1, learnerText, ...reply });
    if (reply.topicShift) {
      shifts.push(index + 1);
    }
  }
  return { lines, shifts, state };
}

function checkConversationQuality(engine, persona, topics) {
  const { lines, shifts, state } = simulateConversation(engine, persona, topics);
  const where = `本地对话（${persona.id}）`;

  let teacherHits = 0;
  let repeated = 0;
  lines.forEach((line, index) => {
    checkEnglish(line.en, `${where} 第 ${line.turn} 轮`);
    if (TEACHER_WORDS.test(line.en)) {
      fail(`${where} 第 ${line.turn} 轮像老师在说话：${line.en.slice(0, 70)}`);
      teacherHits += 1;
    }
    engine.TEACHER_TELLS.forEach((pattern) => {
      pattern.lastIndex = 0;
      if (pattern.test(line.en)) {
        fail(`${where} 第 ${line.turn} 轮命中教师腔：${line.en.slice(0, 70)}`);
        teacherHits += 1;
      }
    });
    const words = line.en.split(/\s+/).filter(Boolean).length;
    if (words > 60) {
      fail(`${where} 第 ${line.turn} 轮太长（${words} 词），不像打电话`);
    }
    if ((line.en.match(/\?/g) || []).length > 1) {
      fail(`${where} 第 ${line.turn} 轮一次问了多个问题`);
    }
    if (index > 0 && lines[index - 1].en === line.en) {
      repeated += 1;
    }
  });

  const unique = new Set(lines.map((line) => line.en)).size;
  const ratio = lines.length ? unique / lines.length : 0;
  // 本地素材是有限的，长聊一定会循环；但 8 轮之内不能出现同一句。
  const lastSeen = new Map();
  lines.forEach((line, index) => {
    const seenAt = lastSeen.get(line.en);
    if (seenAt !== undefined && index + 1 - seenAt <= 8) {
      fail(`${where} 第 ${index + 1} 轮和第 ${seenAt} 轮说了同一句：${line.en.slice(0, 60)}`);
    }
    lastSeen.set(line.en, index + 1);
  });
  if (ratio < 0.5) {
    fail(`${where} 重复率过高：${lines.length} 轮里只有 ${unique} 句不重复`);
  }
  if (!shifts.length) {
    fail(`${where} 连续含糊回答没有换话题`);
  }
  if (!state.visitedTopics.length) {
    fail(`${where} 全程没有换过话题`);
  }

  // 中文输入应该用一句自然的过渡接住，而不是回中文。
  const chineseLine = lines.find((line) => CJK_RE.test(line.learnerText));
  if (!chineseLine) {
    fail(`${where} 没有测到中文输入`);
  } else if (CJK_RE.test(chineseLine.en)) {
    fail(`${where} 中文输入时回复也变成了中文`);
  }

  // 极短回答要被追问，而不是被当成完整回答敷衍过去。
  const shortLine = lines.find((line) => line.learnerText === "yeah");
  const longLine = lines.find((line) => line.learnerText.startsWith("I just got home"));
  if (shortLine && longLine && shortLine.en.length >= longLine.en.length) {
    fail(`${where} 对「yeah」的回复比对长回答还长，追问逻辑可疑`);
  }

  notes.push(
    `${where}：${lines.length} 轮，去重 ${unique} 句，换话题 ${shifts.length} 次，教师腔 ${teacherHits} 次`,
  );
  return lines;
}

function checkPrompt(engine, persona, history) {
  const prompt = engine.buildPartnerPrompt({
    persona,
    history,
    topic: { id: "week", label: "最近" },
  });
  const required = [
    "NOT a teacher",
    "Never correct their grammar",
    persona.name,
    "THEM:",
    "YOU:",
  ];
  required.forEach((needle) => {
    if (!prompt.includes(needle)) {
      fail(`接口提示词缺少「${needle}」`);
    }
  });
  if (/\bscore\b|\bband\s*\d/i.test(prompt.replace(/Never mention[^\n]*/gi, ""))) {
    fail("接口提示词里出现了评分口径");
  }
}

/* ------------------------------------------------------- 3. 接口回复清洗 */

function checkParser(engine) {
  const json = engine.parsePartnerReply(
    '{"say":"Yeah, that tracks. I had the same week.","zh":"是啊，我也这样。","mood":"warm"}',
  );
  if (!json || json.en !== "Yeah, that tracks. I had the same week." || json.source !== "api") {
    fail("parsePartnerReply 解析标准 JSON 失败");
  }

  const fenced = engine.parsePartnerReply(
    '```json\n{"say":"Honestly, same here.","zh":"老实说我也是。"}\n```',
  );
  if (!fenced || fenced.en !== "Honestly, same here.") {
    fail("parsePartnerReply 解析代码块 JSON 失败");
  }

  const embedded = engine.parsePartnerReply(
    'Sure!\n{"say":"I mostly cook at home now.","zh":"我现在基本在家做。"}\nHope that helps.',
  );
  if (!embedded || embedded.en !== "I mostly cook at home now.") {
    fail("parsePartnerReply 没有从散文里抠出 JSON");
  }

  const plain = engine.parsePartnerReply("I just got back from a run | 我刚跑步回来");
  if (!plain || plain.en !== "I just got back from a run" || plain.zh !== "我刚跑步回来") {
    fail("parsePartnerReply 的纯文本兜底失败");
  }

  const cleaned = engine.parsePartnerReply(
    '{"say":"That\'s a great question. I burned the rice again last night.","zh":"我又把饭煮糊了。"}',
  );
  if (!cleaned || /great question/i.test(cleaned.en)) {
    fail("parsePartnerReply 没有清掉「That's a great question」");
  }

  if (engine.parsePartnerReply("Good job!") !== null) {
    fail("纯教师腔回复没有被拦住，应该返回 null 让页面退回本地陪聊");
  }
  if (!engine.isTeacherOnly("That's a great question.")) {
    fail("isTeacherOnly 没有认出「That's a great question」");
  }
  if (engine.isTeacherOnly("I burned the rice again last night.")) {
    fail("isTeacherOnly 把正常口语当成了教师腔");
  }

  const stripped = engine.stripTeacherTells(
    "Let's practice. I made ramen last night, it was actually good. Your pronunciation is getting better.",
  );
  if (/practice|pronunciation/i.test(stripped) || !/ramen/i.test(stripped)) {
    fail(`stripTeacherTells 结果不对：${stripped.slice(0, 80)}`);
  }
}

/* ------------------------------------------------------------- 4. 复盘卡 */

function checkRecap(engine, topics) {
  const history = [
    { role: "partner", english: "I ended up covering somebody else's patients too.", chinese: "我还替别人看了病人。" },
    { role: "user", english: "I very like my new keyboard.", chinese: "" },
    { role: "partner", english: "That's a great question.", chinese: "这个问题很好。" },
    { role: "user", english: "open the light please", chinese: "" },
  ];
  const recap = engine.buildRecap({ history, topics });
  if (!recap || !Array.isArray(recap.keep) || !Array.isArray(recap.fixes) || !Array.isArray(recap.next)) {
    fail("buildRecap 结构不对");
    return;
  }
  if (recap.stats.turns !== 2 || recap.stats.partnerTurns !== 2) {
    fail(`buildRecap 统计不对：${JSON.stringify(recap.stats)}`);
  }
  if (!recap.fixes.some((item) => item.better === "I really like my new keyboard.")) {
    fail("buildRecap 没有抓住 I very like 这类中式表达");
  }
  if (!recap.fixes.some((item) => /turn on the light/i.test(item.better))) {
    fail("buildRecap 没有抓住 open the light");
  }
  if (recap.keep.some((item) => /great question/i.test(item.en))) {
    fail("buildRecap 把教师腔句子收进了 keep");
  }
  if (recap.next.length > 3) {
    fail("buildRecap 的 next 超过 3 条");
  }
}

/* ---------------------------------------------------------- 5. 页面接线 */

function checkHtmlIntegration(html, script) {
  const order = [
    "account-store.js",
    "session-guard.js",
    "speech-transport.js",
    "study-core.js",
    "speaking-personas.js",
    "speaking-engine.js",
    "speaking.js",
  ];
  let cursor = -1;
  order.forEach((file) => {
    const index = html.indexOf(file, cursor + 1);
    if (index === -1) {
      fail(`speaking.html 没有按顺序加载 ${file}`);
      return;
    }
    cursor = index;
  });
  if (!html.includes("speaking.css")) {
    fail("speaking.html 没有引入 speaking.css");
  }
  if (/https?:\/\/(?!github\.com)[^"']+\.js/i.test(html)) {
    fail("speaking.html 引入了站外脚本，页面应该只跑自己的代码");
  }

  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  const used = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
  [...new Set(used)].forEach((id) => {
    if (!ids.has(id)) {
      fail(`speaking.js 用到了 speaking.html 里不存在的 #${id}`);
    }
  });
  notes.push(`页面接线：${ids.size} 个 #id，脚本引用 ${new Set(used).size} 个`);
}

/* --------------------------------------------------------------- 主流程 */

const [personaSource, engineSource, roomScript, html] = await Promise.all([
  fs.readFile(path.join(root, "speaking-personas.js"), "utf8"),
  fs.readFile(path.join(root, "speaking-engine.js"), "utf8"),
  fs.readFile(path.join(root, "speaking.js"), "utf8"),
  fs.readFile(path.join(root, "speaking.html"), "utf8"),
]);

try {
  new vm.Script(roomScript, { filename: "speaking.js" });
} catch (error) {
  fail(`speaking.js 有语法错误：${error.message}`);
}

const pack = loadWindowScript(personaSource, "IballSpeakingPersonas");
const engine = loadWindowScript(engineSource, "IballSpeakingEngine");
const { personas, topics } = checkPack(pack);

if (personas.length && topics.length) {
  const history = [];
  personas.slice(0, 3).forEach((persona) => {
    const lines = checkConversationQuality(engine, persona, topics);
    lines.slice(0, 6).forEach((line) => {
      history.push({ role: "partner", english: line.en, chinese: line.zh || "" });
      history.push({ role: "user", english: line.learnerText });
    });
  });
  checkPrompt(engine, personas[0], history);
}

checkParser(engine);
checkRecap(engine, topics);
checkHtmlIntegration(html, roomScript);

notes.forEach((note) => console.log(`note: ${note}`));
if (errors.length) {
  console.error(`口语房间自检发现 ${errors.length} 个问题：`);
  errors.slice(0, MAX_DETAILS).forEach((error) => console.error(` - ${error}`));
  if (errors.length > MAX_DETAILS) {
    console.error(` ... 另外还有 ${errors.length - MAX_DETAILS} 个`);
  }
  process.exit(1);
}
console.log("口语房间自检通过。");
