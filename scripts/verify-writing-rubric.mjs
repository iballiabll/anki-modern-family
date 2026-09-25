// 校验考研英语写作评分是否按 Part A / Part B 分值和五档标准执行。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engine = require(path.join(root, "writing-grade.js"));

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}${detail ? ` · ${detail}` : ""}`);
    return;
  }
  failed += 1;
  console.error(`  FAIL ${label}${detail ? ` · ${detail}` : ""}`);
}

function dimensionPoints(result) {
  return (result.dimensions || []).reduce(
    (sum, item) => sum + Number(item.points || 0),
    0,
  );
}

const letter = [
  "Dear Paul,",
  "I am writing to tell you more about the Chinese families' handwritten letters I posted yesterday.",
  "Each letter records an ordinary family's true feelings, so they are priceless historical records.",
  "They are currently on public display in the city library, and the exhibition is open to everyone.",
  "I am very keen to show you around if you visit, because seeing the real letters is quite different from looking at photos online.",
  "I hope you can come and see them in person soon.",
  "Yours sincerely,",
  "Li Ming",
].join("\n\n");

const partA = {
  id: "english-i-2026-p51",
  exam: "english-i",
  label: "Part A · 第 51 题",
  part: "Part A",
  prompt:
    "Read the following email from your friend Paul and write him a reply about the Chinese families' handwritten letters. You should write about 100 words on the ANSWER SHEET.",
  directions: ["Do not use your own name in your email; use Li Ming instead."],
  points: ["满分 10 分"],
  wordLimit: "约 100 词",
  wordLimitMin: 100,
  wordLimitMax: 100,
};
const partB = {
  id: "english-i-2026-p52",
  exam: "english-i",
  label: "Part B · 第 52 题",
  part: "Part B",
  prompt:
    "Write an essay based on the charts about consumer acceptance of elder-care robots. In your essay, you should describe the charts, interpret them, and give your comments. Write your answer in 160-200 words.",
  directions: [],
  points: ["满分 20 分"],
  wordLimit: "160-200 词",
  wordLimitMin: 160,
  wordLimitMax: 200,
};
const partB2 = {
  id: "english-ii-2026-p48",
  exam: "english-ii",
  label: "Part B · 第 48 题",
  part: "Part B",
  prompt:
    "Write an essay based on the chart about the survey. You should describe the chart, interpret it, and give your comments. Write your answer in about 150 words.",
  directions: [],
  points: ["满分 15 分"],
  wordLimit: "约 150 词",
  wordLimitMin: 150,
  wordLimitMax: 150,
};

console.log("考研写作评分维度与分值");
const gradeA = engine.grade({ text: letter, prompt: partA });
check("英语一 Part A 满分 10", gradeA.maxScore === 10, `maxScore=${gradeA.maxScore}`);
check("英语一 Part A 识别为五档制", gradeA.band?.fiveBand === true);
check(
  "英语一 Part A 维度分合计 10",
  dimensionPoints(gradeA) === 10,
  `points=${dimensionPoints(gradeA)}`,
);
check(
  "英语一 Part A 含任务/组织/语法/词汇/机械五项",
  ["task", "structure", "language", "lexis", "mechanics"].every((key) =>
    (gradeA.dimensions || []).some((item) => item.key === key),
  ),
);
check("英语一 Part A 标为非官方模拟分", gradeA.official === false && /非官方模拟评分/.test(gradeA.scoreNotice || ""));
check(
  "英语一 Part A 维度折算分之和等于总分",
  Math.abs(
    (gradeA.dimensions || []).reduce((sum, item) => sum + item.scaled, 0) -
      gradeA.score,
  ) <= 0.4,
  `sum=${(gradeA.dimensions || []).reduce((sum, item) => sum + item.scaled, 0).toFixed(1)} score=${gradeA.score}`,
);

const gradeB = engine.grade({ text: letter, prompt: partB });
check("英语一 Part B 满分 20", gradeB.maxScore === 20, `maxScore=${gradeB.maxScore}`);
check("英语一 Part B 维度分合计 20", dimensionPoints(gradeB) === 20, `points=${dimensionPoints(gradeB)}`);
check(
  "英语一 Part B 含内容展开维度",
  (gradeB.dimensions || []).some((item) => item.key === "content"),
);

const gradeB2 = engine.grade({ text: letter, prompt: partB2 });
check("英语二 Part B 满分 15", gradeB2.maxScore === 15, `maxScore=${gradeB2.maxScore}`);
check("英语二 Part B 维度分合计 15", dimensionPoints(gradeB2) === 15, `points=${dimensionPoints(gradeB2)}`);

console.log("五档标准");
const bandCases = [
  [10, 10, "第五档"],
  [8, 10, "第四档"],
  [6, 10, "第三档"],
  [4, 10, "第二档"],
  [2, 10, "第一档"],
  [0, 10, "零分"],
  [18, 20, "第五档"],
  [14, 20, "第四档"],
  [10, 20, "第三档"],
  [6, 20, "第二档"],
  [2, 20, "第一档"],
  [14, 15, "第五档"],
  [11, 15, "第四档"],
  [8, 15, "第三档"],
  [5, 15, "第二档"],
  [2, 15, "第一档"],
];
bandCases.forEach(([score, max, label]) => {
  const band = engine.bandForScore(score, max, "english-i", "Part A");
  check(`${max} 分制 ${score} 分 → ${label}`, band.label === label, band.label);
});

console.log("Part 识别与旧调用兼容");
check(
  "只凭 id 识别 Part A",
  engine.resolvePart({ id: "english-i-2026-p51" }) === "Part A",
);
check(
  "只凭 label 识别 Part B",
  engine.resolvePart({ label: "Part B · 第 52 题" }) === "Part B",
);
check(
  "taskMaxScore 读取 Part A",
  engine.taskMaxScore("english-i", { id: "english-i-2026-p51" }) === 10,
);
check(
  "taskMaxScore 读取 Part B",
  engine.taskMaxScore("english-ii", { id: "english-ii-2026-p48" }) === 15,
);

const legacy = engine.grade({ text: letter, prompt: { exam: "english-i" } });
check("无 part 时回落整卷 30 分", legacy.maxScore === 30, `maxScore=${legacy.maxScore}`);
check("无 part 时仍用四档评级", legacy.band?.fiveBand === false, legacy.band?.label);
const cetLegacy = engine.grade({ text: letter, prompt: { exam: "cet6" } });
check("四六级逻辑不受影响", cetLegacy.maxScore === 15, `maxScore=${cetLegacy.maxScore}`);

console.log(`\n写作评分验收：${passed} 项通过，${failed} 项失败`);
if (failed) {
  process.exit(1);
}
