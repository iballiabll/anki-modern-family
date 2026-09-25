/**
 * Self-check for the CET-6 libraries that feed cet6.html / cet6-reading.html /
 * cet6-listening.html / cet6-extra.html.
 *
 * Usage:
 *   node scripts/verify-cet6-library.mjs
 *
 * Exits with a non-zero code when any set fails a structural check, so the
 * result can be used as an acceptance gate instead of eyeballing the page.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLACEHOLDER = /(待补充|待完善|待翻译|TODO|FIXME|lorem ipsum|占位)/i;
const OPTION_LETTERS = ["A", "B", "C", "D"];
// 选词填空是 15 选 10，答案字母范围是 A–O，不是 A–D。
const CLOZE_LETTERS = "ABCDEFGHIJKLMNO".split("");

const failures = [];
const stats = {
  readingSets: 0,
  readingQuestions: 0,
  readingParagraphs: 0,
  clozeBlanks: 0,
  extraSets: 0,
  translationSentences: 0,
  writingEssays: 0,
  listeningSets: 0,
  listeningQuestions: 0,
  listeningParagraphs: 0,
  clozeWordBanks: 0,
  carefulWithoutLocate: 0,
  matchingWithoutDistractors: 0,
};
const reportedMissing = [];

function loadScript(relativePath, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(root, relativePath), "utf8"), sandbox);
  const library = sandbox.window[globalName];
  if (!library) {
    throw new Error(`${relativePath} 没有导出 ${globalName}`);
  }
  return library;
}

function dataPath(file) {
  return file.replace(/^\.\//, "");
}

/**
 * 范文与译文在数据里是段落数组（每段一项），这里统一压成可校验文本。
 */
function text(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function fail(id, message) {
  failures.push(`${id}: ${message}`);
}

function requireValue(id, condition, message) {
  if (!condition) {
    fail(id, message);
  }
  return condition;
}

function checkPlainText(id, label, value, minLength = 1) {
  const body = text(value);
  requireValue(id, body.length >= minLength, `${label} 内容过短或缺失`);
  requireValue(id, !PLACEHOLDER.test(body), `${label} 命中占位文案`);
}

/**
 * 定位字段在数据里是对象（{ label, english, chinese }），有的题因为源站只给了
 * 答案行图标而缺定位。这里统一压成可校验的文本。
 */
function locateBody(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "object") {
    return [value.label, value.english, value.chinese]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function pairOrigins(question) {
  return (Array.isArray(question.pairs) ? question.pairs : [])
    .map((pair) => text(pair?.origin))
    .filter(Boolean);
}

const EXPECTED_READING_KINDS = "careful,careful,cloze,matching";
const KIND_LABELS = { careful: "仔细阅读", matching: "段落匹配", cloze: "选词填空" };

/**
 * 索引里如实标注的缺口允许题型缺失；没有标注时仍按完整四篇校验。
 */
function expectedKindsFor(entry) {
  const missing = Array.isArray(entry.missing) ? entry.missing.map((item) => text(item)) : [];
  return EXPECTED_READING_KINDS.split(",")
    .filter((kind) => !missing.includes(KIND_LABELS[kind]))
    .join(",");
}

function verifyReadingSet(entry) {
  const id = entry.id;
  const library = loadScript(dataPath(entry.file), "IBALL_CET6_READING_LIBRARY");
  const data = library[id];
  if (!requireValue(id, Boolean(data), "数据文件里没有这一套")) {
    return;
  }

  const pieces = Array.isArray(data.pieces) ? data.pieces : [];
  const missing = Array.isArray(entry.missing) ? entry.missing.map((item) => text(item)) : [];
  if (missing.length) {
    reportedMissing.push(`${id}（缺 ${missing.join("、")}）`);
    requireValue(
      id,
      Array.isArray(data.meta?.missing) &&
        missing.every((kind) => data.meta.missing.map((item) => text(item)).includes(kind)),
      `索引写缺 ${missing.join("、")}，但 meta.missing 没有同步标注`,
    );
  }
  requireValue(id, pieces.length === entry.pieceCount, `篇数为 ${pieces.length}，索引写 ${entry.pieceCount}`);
  requireValue(
    id,
    pieces.map((piece) => piece.kind).sort().join(",") === expectedKindsFor(entry),
    `题型组合异常：${pieces.map((piece) => piece.kind).join("/")}`,
  );

  const paragraphs = pieces.reduce((total, piece) => total + (piece.paragraphs || []).length, 0);
  const questions = pieces.reduce((total, piece) => total + (piece.questions || []).length, 0);
  const blanks = pieces.reduce((total, piece) => total + (piece.blanks || []).length, 0);

  requireValue(id, paragraphs === entry.paragraphCount, `段落 ${paragraphs} 段，索引写 ${entry.paragraphCount} 段`);
  requireValue(
    id,
    questions + blanks === entry.questionCount,
    `题目 ${questions}+${blanks} 处，索引写 ${entry.questionCount} 题`,
  );
  requireValue(id, text(data.meta?.title) === text(entry.title), "meta.title 与索引不一致");

  for (const piece of pieces) {
    requireValue(id, Array.isArray(piece.paragraphs) && piece.paragraphs.length > 0, `${piece.kind} 篇没有正文段落`);
    for (const paragraph of piece.paragraphs || []) {
      checkPlainText(id, `${piece.kind} 第 ${paragraph.number} 段英文`, paragraph.english, 20);
      checkPlainText(id, `${piece.kind} 第 ${paragraph.number} 段译文`, paragraph.chinese, 6);
    }
    requireValue(id, Array.isArray(piece.tips) && piece.tips.length > 0, `${piece.kind} 缺少做题提示`);

    if (piece.kind === "cloze") {
      const bank = piece.wordBank || [];
      const blankList = piece.blanks || [];
      requireValue(id, bank.length === 15, `选词填空词库 ${bank.length} 个，应为 15 个`);
      requireValue(id, blankList.length === 10, `选词填空空格 ${blankList.length} 个，应为 10 个`);
      requireValue(
        id,
        bank.every((item) => CLOZE_LETTERS.includes(text(item?.letter))),
        "选词填空词库字母超出 A–O",
      );
      requireValue(
        id,
        bank.every((item) => text(item?.word).length > 0),
        "选词填空词库存在空单词",
      );
      requireValue(
        id,
        new Set(bank.map((item) => text(item?.letter))).size === bank.length,
        "选词填空词库存在重复字母",
      );
      blankList.forEach((blank, index) => {
        requireValue(id, blank.number === 26 + index, `第 ${index + 1} 个空题号是 ${blank.number}，应为 ${26 + index}`);
        requireValue(id, Boolean(text(blank.answerWord)), `第 ${blank.number} 空缺少答案词`);
        requireValue(
          id,
          bank.some((item) => text(item?.word) === text(blank.answerWord)),
          `第 ${blank.number} 空答案 ${blank.answerWord} 不在词库中`,
        );
        requireValue(id, CLOZE_LETTERS.includes(blank.answerLetter), `第 ${blank.number} 空答案字母异常：${blank.answerLetter}`);
        requireValue(
          id,
          bank.some(
            (item) =>
              text(item?.letter) === text(blank.answerLetter) &&
              text(item?.word) === text(blank.answerWord),
          ),
          `第 ${blank.number} 空答案字母 ${blank.answerLetter} 与答案词 ${blank.answerWord} 不对应`,
        );
        checkPlainText(id, `第 ${blank.number} 空解析`, blank.reason, 10);
      });
      stats.clozeWordBanks += 1;
      stats.clozeBlanks += blankList.length;
      continue;
    }

    const questionList = piece.questions || [];
    if (piece.kind === "matching") {
      requireValue(id, questionList.length === 10, `段落匹配 ${questionList.length} 题，应为 10 题`);
      questionList.forEach((question) => {
        checkPlainText(id, `段落匹配第 ${question.number} 题题干`, question.stem, 10);
        checkPlainText(id, `段落匹配第 ${question.number} 题译文`, question.stemTranslation, 4);
        requireValue(id, /^[A-Z]$/.test(text(question.answer)), `段落匹配第 ${question.number} 题答案异常：${question.answer}`);
        checkPlainText(id, `段落匹配第 ${question.number} 题定位`, locateBody(question.locate), 4);
        requireValue(
          id,
          Array.isArray(question.notes) && question.notes.length > 0,
          `段落匹配第 ${question.number} 题缺少解析`,
        );
        requireValue(
          id,
          Array.isArray(question.pairs),
          `段落匹配第 ${question.number} 题缺少 evidence 数组`,
        );
        const distractors = Array.isArray(question.distractors) ? question.distractors : [];
        if (distractors.length === 0) {
          // 源站对部分题只给定位与改写，整题没有 rp-disc 区块，构建时已标注
          // distractorGap。这类题仍必须有解析和改写对兜底，避免真丢数据被放过。
          requireValue(
            id,
            question.distractorGap === true,
            `段落匹配第 ${question.number} 题缺少干扰项归因且未标注源站缺口`,
          );
          requireValue(
            id,
            pairOrigins(question).length > 0,
            `段落匹配第 ${question.number} 题既无辨邻项也无改写对`,
          );
          stats.matchingWithoutDistractors += 1;
        }
      });
      continue;
    }

    requireValue(id, questionList.length === 5, `仔细阅读 ${piece.index} 有 ${questionList.length} 题，应为 5 题`);
    questionList.forEach((question) => {
      checkPlainText(id, `仔细阅读第 ${question.number} 题题干`, question.stem, 10);
      checkPlainText(id, `仔细阅读第 ${question.number} 题译文`, question.stemTranslation, 4);
      const choices = Array.isArray(question.choices) ? question.choices : [];
      requireValue(id, choices.length === 4, `仔细阅读第 ${question.number} 题选项 ${choices.length} 个，应为 4 个`);
      choices.forEach((choice, choiceIndex) => {
        requireValue(
          id,
          text(choice.letter) === OPTION_LETTERS[choiceIndex],
          `仔细阅读第 ${question.number} 题选项字母顺序异常：${choice.letter}`,
        );
        checkPlainText(id, `仔细阅读第 ${question.number} 题 ${choice.letter} 选项`, choice.text, 3);
        checkPlainText(id, `仔细阅读第 ${question.number} 题 ${choice.letter} 选项译文`, choice.translation, 2);
      });
      requireValue(
        id,
        choices.some((choice) => text(choice.letter) === text(question.answer)),
        `仔细阅读第 ${question.number} 题答案 ${question.answer} 不在选项中`,
      );
      // 源站对主旨/态度题只给答案行定位图标，不给【定位】行，这类题允许缺定位，
      // 但必须有 evidence 句兜底，避免整题解析断链。
      if (question.locate) {
        requireValue(
          id,
          Boolean(text(question.locate.label)) && Boolean(text(question.locate.english)),
          `仔细阅读第 ${question.number} 题定位缺少段落标记或英文原文`,
        );
      } else {
        stats.carefulWithoutLocate += 1;
        requireValue(
          id,
          pairOrigins(question).length > 0,
          `仔细阅读第 ${question.number} 题既无定位也无 evidence 句`,
        );
      }
      requireValue(
        id,
        Array.isArray(question.verdicts) && question.verdicts.length > 0,
        `仔细阅读第 ${question.number} 题缺少逐项排除解析`,
      );
      (question.verdicts || []).forEach((verdict) => {
        requireValue(
          id,
          OPTION_LETTERS.includes(text(verdict.letter)),
          `仔细阅读第 ${question.number} 题排除项字母异常：${verdict.letter}`,
        );
        // 正确项只标 ✓，干扰项必须给出排除理由。
        if (verdict.ok !== true) {
          checkPlainText(
            id,
            `仔细阅读第 ${question.number} 题 ${verdict.letter} 排除说明`,
            verdict.note || verdict.why,
            6,
          );
        } else {
          checkPlainText(
            id,
            `仔细阅读第 ${question.number} 题 ${verdict.letter} 正确标记`,
            verdict.flag,
            2,
          );
        }
      });
      requireValue(
        id,
        (question.verdicts || []).some(
          (verdict) => text(verdict.letter) === text(question.answer) && verdict.ok === true,
        ) || pairOrigins(question).length > 0,
        `仔细阅读第 ${question.number} 题解析没有指向正确答案`,
      );
    });
  }

  stats.readingSets += 1;
  stats.readingQuestions += questions + blanks;
  stats.readingParagraphs += paragraphs;
}

function verifyExtraSet(entry) {
  const id = entry.id;
  const library = loadScript(dataPath(entry.file), "IBALL_CET6_EXTRA_LIBRARY");
  const data = library[id];
  if (!requireValue(id, Boolean(data), "数据文件里没有这一套")) {
    return;
  }
  const missing = Array.isArray(entry.missing) ? entry.missing : [];
  if (missing.length) {
    reportedMissing.push(`${id}（${missing.join("、")}）`);
  }
  requireValue(id, Array.isArray(data.meta?.missing), "meta.missing 不是数组，无法如实标注缺口");

  const translation = data.translation;
  requireValue(id, Boolean(translation), "缺少翻译模块");
  if (translation) {
    checkPlainText(id, "翻译原文", translation.chinese, 60);
    checkPlainText(id, "翻译参考译文", translation.reference, 60);
    const sentences = Array.isArray(translation.sentences) ? translation.sentences : [];
    requireValue(
      id,
      sentences.length === translation.sentenceCount,
      `逐句拆解 ${sentences.length} 句，meta 写 ${translation.sentenceCount} 句`,
    );
    // 源站有的篇章本来就只拆 3 句，低于 3 句才说明抓取缺段。
    requireValue(id, sentences.length >= 3, `逐句拆解只有 ${sentences.length} 句，疑为不完整`);
    sentences.forEach((sentence) => {
      // 源文里有 “社会生活多种多样。” 这类短句，按 6 字兜底即可。
      checkPlainText(id, `第 ${sentence.number} 句中文`, sentence.chinese, 6);
      checkPlainText(id, `第 ${sentence.number} 句参考译文`, sentence.reference, 10);
      requireValue(
        id,
        Array.isArray(sentence.steps) && sentence.steps.length > 0,
        `第 ${sentence.number} 句缺少拆解步骤`,
      );
    });
    requireValue(
      id,
      Array.isArray(translation.terms) && translation.terms.length > 0,
      "翻译缺少术语一致性说明",
    );
    stats.translationSentences += sentences.length;
  }

  const writing = data.writing;
  requireValue(id, Boolean(writing), "缺少写作模块");
  if (writing) {
    checkPlainText(id, "写作题目要求", writing.directions, 30);
    checkPlainText(id, "写作范文", writing.essay, 200);
    checkPlainText(id, "写作范文译文", writing.essayTranslation, 80);
    requireValue(
      id,
      Array.isArray(writing.breakdown) && writing.breakdown.length >= 2,
      "写作缺少段落级拆解",
    );
    requireValue(
      id,
      Array.isArray(writing.rubric) && writing.rubric.length >= 3,
      "写作缺少评分维度",
    );
    requireValue(
      id,
      Array.isArray(writing.pitfalls) && writing.pitfalls.length > 0,
      "写作缺少易错点提醒",
    );
    const words = text(writing.essay).split(/\s+/).filter(Boolean).length;
    requireValue(id, words >= 120, `写作范文只有 ${words} 词，低于六级作文体量`);
    stats.writingEssays += 1;
  }

  stats.extraSets += 1;
}

function verifyListeningSet(entry) {
  const id = entry.id;
  const library = loadScript(dataPath(entry.file), "IBALL_CET6_LISTENING_LIBRARY");
  const data = library[id];
  if (!requireValue(id, Boolean(data), "数据文件里没有这一套")) {
    return;
  }
  const pieces = Array.isArray(data.pieces) ? data.pieces : [];
  requireValue(id, pieces.length === entry.pieceCount, `听力篇数 ${pieces.length}，索引写 ${entry.pieceCount}`);

  const paragraphs = pieces.reduce((total, piece) => total + (piece.paragraphs || []).length, 0);
  const questions = pieces.reduce((total, piece) => total + (piece.questions || []).length, 0);
  const grammar = pieces.reduce(
    (total, piece) =>
      total + (piece.paragraphs || []).reduce((inner, paragraph) => inner + (paragraph.grammar || []).length, 0),
    0,
  );
  requireValue(id, paragraphs === entry.paragraphCount, `听力段落 ${paragraphs}，索引写 ${entry.paragraphCount}`);
  requireValue(id, questions === entry.questionCount, `听力题目 ${questions}，索引写 ${entry.questionCount}`);
  requireValue(id, grammar === entry.grammarCount, `听力语法点 ${grammar}，索引写 ${entry.grammarCount}`);

  for (const piece of pieces) {
    requireValue(id, Array.isArray(piece.paragraphs) && piece.paragraphs.length > 0, `${piece.id} 没有听力原文段落`);
    requireValue(
      id,
      Array.isArray(piece.questions) && piece.questions.length > 0,
      `${piece.id} 没有题目`,
    );
    for (const paragraph of piece.paragraphs || []) {
      // 听力原文按对白逐句切段，"M: Yes." 这类短应答是正常内容，
      // 单段只做最小存在性校验，截断由下面的整篇总量兜底。
      checkPlainText(id, `${piece.id} 第 ${paragraph.number} 段原文`, paragraph.english, 6);
      checkPlainText(id, `${piece.id} 第 ${paragraph.number} 段译文`, paragraph.chinese, 4);
    }
    const englishVolume = (piece.paragraphs || []).reduce(
      (total, paragraph) => total + text(paragraph.english).length,
      0,
    );
    const chineseVolume = (piece.paragraphs || []).reduce(
      (total, paragraph) => total + text(paragraph.chinese).length,
      0,
    );
    requireValue(id, englishVolume >= 400, `${piece.id} 听力原文仅 ${englishVolume} 字符，疑为截断`);
    requireValue(id, chineseVolume >= 150, `${piece.id} 听力译文仅 ${chineseVolume} 字符，疑为截断`);
    for (const question of piece.questions || []) {
      checkPlainText(id, `听力第 ${question.number} 题题干`, question.stem, 10);
      checkPlainText(id, `听力第 ${question.number} 题译文`, question.stemTranslation, 4);
      const choices = Array.isArray(question.choices) ? question.choices : [];
      requireValue(id, choices.length === 4, `听力第 ${question.number} 题选项 ${choices.length} 个，应为 4 个`);
      choices.forEach((choice, choiceIndex) => {
        requireValue(
          id,
          text(choice.letter) === OPTION_LETTERS[choiceIndex],
          `听力第 ${question.number} 题选项字母异常：${choice.letter}`,
        );
        checkPlainText(id, `听力第 ${question.number} 题 ${choice.letter} 选项`, choice.text, 3);
        checkPlainText(id, `听力第 ${question.number} 题 ${choice.letter} 选项译文`, choice.translation, 2);
      });
      requireValue(
        id,
        choices.some((choice) => text(choice.letter) === text(question.answer)),
        `听力第 ${question.number} 题答案 ${question.answer} 不在选项中`,
      );
      checkPlainText(id, `听力第 ${question.number} 题原文定位`, question.locateEnglish, 5);
      checkPlainText(id, `听力第 ${question.number} 题定位译文`, question.locateChinese, 4);
      requireValue(
        id,
        Array.isArray(question.verdicts) && question.verdicts.length >= 3,
        `听力第 ${question.number} 题缺少排除解析`,
      );
    }
  }

  stats.listeningSets += 1;
  stats.listeningQuestions += questions;
  stats.listeningParagraphs += paragraphs;
}

const readingIndex = loadScript("cet6-papers.js", "IBALL_CET6_READING_PAPERS");
readingIndex.forEach(verifyReadingSet);

const extraIndex = loadScript("cet6-extra-papers.js", "IBALL_CET6_EXTRA_PAPERS");
extraIndex.forEach(verifyExtraSet);

const listeningIndex = loadScript("cet6-listening-papers.js", "IBALL_CET6_LISTENING_PAPERS");
listeningIndex.forEach(verifyListeningSet);

console.log("== 六级题库自检 ==");
console.log(
  `阅读：${stats.readingSets} 套 / ${stats.readingQuestions} 题（含 ${stats.clozeBlanks} 个选词空） / ${stats.readingParagraphs} 段`,
);
console.log(
  `选词填空词库：${stats.clozeWordBanks} 套 × 15 词；仔细阅读主主旨/态度题无单段定位：${stats.carefulWithoutLocate} 题（均已用 evidence 句兜底）`,
);
console.log(
  `段落匹配：源站未提供辨邻项的题 ${stats.matchingWithoutDistractors} 题（均已用改写对兜底）`,
);
console.log(
  `翻译写作：${stats.extraSets} 套 / ${stats.translationSentences} 句逐句拆解 / ${stats.writingEssays} 篇范文`,
);
console.log(
  `听力：${stats.listeningSets} 套 / ${stats.listeningQuestions} 题 / ${stats.listeningParagraphs} 段原文`,
);
if (reportedMissing.length) {
  console.log(`索引如实标注的缺口：${reportedMissing.length} 套`);
  reportedMissing.slice(0, 10).forEach((item) => console.log(` · ${item}`));
  if (reportedMissing.length > 10) {
    console.log(` · ...另外 ${reportedMissing.length - 10} 套`);
  }
}

if (failures.length) {
  console.error(`\n发现 ${failures.length} 个问题：`);
  failures.slice(0, 40).forEach((message) => console.error(` - ${message}`));
  if (failures.length > 40) {
    console.error(` ...另外 ${failures.length - 40} 个问题未列出`);
  }
  const grouped = new Map();
  for (const message of failures) {
    const shape = message
      .replace(/^[^:]+:\s*/, "")
      .replace(/\d+/g, "N");
    grouped.set(shape, (grouped.get(shape) || 0) + 1);
  }
  console.error("\n按类型汇总：");
  [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([shape, count]) => console.error(` - ${count} × ${shape}`));
  process.exit(1);
}

if (!stats.readingSets || !stats.extraSets || !stats.listeningSets) {
  console.error("\n有一类六级数据完全没有加载成功。");
  process.exit(1);
}

console.log("\n六级题库自检通过：套数、题型、选项、答案与逐句拆解齐全。");
