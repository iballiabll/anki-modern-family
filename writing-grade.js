/**
 * 作文批改规则引擎（浏览器 + 服务端共用）。
 *
 * 设计原则：
 *  1. 纯本地、零依赖，断网也能给出完整批改结果；
 *  2. 只报高置信度问题，宁可少报也不要误报，避免误导备考；
 *  3. 输出结构固定：总分 / 分项 / 语法问题（带字符区间便于标红）/ 词汇替换 /
 *     句式建议 / 逐段逐句讲解 / 下一步动作，供 api/grade.js 与 writing.js 复用。
 *
 * 语法规则参考了站内 refs/zh-en-translation-polish 的 chinglish_scan 思路：
 * 每条规则只针对一个高频中式英语/一致性错误，给出可直接替换的写法。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IBALL_WRITING_GRADE = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SCORES = {
    "english-i": 30,
    "english-ii": 25,
    cet4: 15,
    cet6: 15,
  };

  // 考研英语写作按 Part A / Part B 分别计分；MAX_SCORES 保留为整卷参考值，
  // 兼容没有 part 信息的旧调用。
  const TASK_MAX_SCORES = {
    "english-i": { "Part A": 10, "Part B": 20 },
    "english-ii": { "Part A": 10, "Part B": 15 },
  };

  // 阅卷档位表按题目满分区分。每档给出分值与核心表现，供讲解和前端展示。
  const KAOYAN_BAND_TABLE = {
    10: [
      { key: "band5", label: "第五档", range: "9-10 分", min: 9, max: 10, descriptor: "很好地完成任务；要点齐全，语法和词汇准确，衔接自然，格式和语体恰当。" },
      { key: "band4", label: "第四档", range: "7-8 分", min: 7, max: 8, descriptor: "较好地完成任务；包含所有要点但少数阐述不足，语言基本准确，格式语体基本恰当。" },
      { key: "band3", label: "第三档", range: "5-6 分", min: 5, max: 6, descriptor: "基本完成任务；遗漏部分内容，存在一些语言错误但基本不影响理解。" },
      { key: "band2", label: "第二档", range: "3-4 分", min: 3, max: 4, descriptor: "未能按要求完成任务；遗漏或无效表达较多，语言错误影响理解，格式或语体不当。" },
      { key: "band1", label: "第一档", range: "1-2 分", min: 1, max: 2, descriptor: "内容严重不足或偏题；语言错误频繁，结构混乱，基本没有完成交际目的。" },
      { key: "zero", label: "零分", range: "0 分", min: 0, max: 0, descriptor: "空白、完全跑题、照抄无关内容，或几乎无法判断为有效英文作文。" },
    ],
    20: [
      { key: "band5", label: "第五档", range: "17-20 分", min: 17, max: 20, descriptor: "很好地完成任务；包含并有效阐述所有内容要点，语言准确，衔接自然，格式语体恰当。" },
      { key: "band4", label: "第四档", range: "13-16 分", min: 13, max: 16, descriptor: "较好地完成任务；包含所有要点但少数阐述不足，复杂结构偶有错误，衔接较自然。" },
      { key: "band3", label: "第三档", range: "9-12 分", min: 9, max: 12, descriptor: "基本完成任务；遗漏部分内容，存在一些语言错误但基本不影响理解。" },
      { key: "band2", label: "第二档", range: "5-8 分", min: 5, max: 8, descriptor: "未能按要求完成任务；内容遗漏较多，语言结构单调，错误影响理解。" },
      { key: "band1", label: "第一档", range: "1-4 分", min: 1, max: 4, descriptor: "内容严重不足或偏题；语言错误频繁，结构混乱，基本没有完成交际目的。" },
      { key: "zero", label: "零分", range: "0 分", min: 0, max: 0, descriptor: "空白、完全跑题、照抄无关内容，或几乎无法判断为有效英文作文。" },
    ],
    15: [
      { key: "band5", label: "第五档", range: "13-15 分", min: 13, max: 15, descriptor: "很好地完成任务；内容要点齐全并有效阐述，语言准确，衔接自然，格式语体恰当。" },
      { key: "band4", label: "第四档", range: "10-12 分", min: 10, max: 12, descriptor: "较好地完成任务；包含所有要点但少数阐述不足，语言基本准确，衔接较自然。" },
      { key: "band3", label: "第三档", range: "7-9 分", min: 7, max: 9, descriptor: "基本完成任务；遗漏部分内容，存在一些语言错误但基本不影响理解。" },
      { key: "band2", label: "第二档", range: "4-6 分", min: 4, max: 6, descriptor: "未能按要求完成任务；遗漏或无效表达较多，错误影响理解，衔接不足。" },
      { key: "band1", label: "第一档", range: "1-3 分", min: 1, max: 3, descriptor: "内容严重不足或偏题；语言错误频繁，结构混乱，基本没有完成交际目的。" },
      { key: "zero", label: "零分", range: "0 分", min: 0, max: 0, descriptor: "空白、完全跑题、照抄无关内容，或几乎无法判断为有效英文作文。" },
    ],
  };

  // 维度分值来自考研英语 Skill 的评分细则，各 Part 分值合计等于题目满分。
  const PART_DIMENSIONS = {
    "english-i:Part A": [
      { key: "task", label: "任务完成与格式", points: 3 },
      { key: "structure", label: "组织与衔接", points: 2 },
      { key: "language", label: "语法与句式", points: 2 },
      { key: "lexis", label: "词汇与语域", points: 2 },
      { key: "mechanics", label: "拼写与格式", points: 1 },
    ],
    "english-ii:Part A": [
      { key: "task", label: "任务完成与格式", points: 3 },
      { key: "structure", label: "组织与衔接", points: 2 },
      { key: "language", label: "语法与句式", points: 2 },
      { key: "lexis", label: "词汇与语域", points: 2 },
      { key: "mechanics", label: "拼写与格式", points: 1 },
    ],
    "english-i:Part B": [
      { key: "task", label: "任务完成与扣题", points: 6 },
      { key: "content", label: "内容展开与论证", points: 4 },
      { key: "structure", label: "组织与段落逻辑", points: 3 },
      { key: "language", label: "语法与句式", points: 3 },
      { key: "lexis", label: "词汇与语域", points: 3 },
      { key: "mechanics", label: "拼写与格式", points: 1 },
    ],
    "english-ii:Part B": [
      { key: "task", label: "任务完成与扣题", points: 5 },
      { key: "content", label: "内容展开与论证", points: 3 },
      { key: "structure", label: "组织与段落逻辑", points: 2 },
      { key: "language", label: "语法与句式", points: 2 },
      { key: "lexis", label: "词汇与语域", points: 2 },
      { key: "mechanics", label: "拼写与格式", points: 1 },
    ],
  };

  const EXAM_LABELS = {
    "english-i": "考研英语一",
    "english-ii": "考研英语二",
    cet4: "大学英语四级",
    cet6: "大学英语六级",
  };

  const DIMENSIONS = [
    { key: "task", label: "任务完成", weight: 0.3 },
    { key: "structure", label: "结构衔接", weight: 0.2 },
    { key: "language", label: "语言准确", weight: 0.3 },
    { key: "lexis", label: "词汇表达", weight: 0.2 },
  ];

  const STOP_WORDS = new Set(
    (
      "a an the and or but if because so that this these those it its their your our my his her there " +
      "in on at of to for with from as by about into over after before while when where which who whom " +
      "is are was were be been being am do does did done have has had having will would shall should can " +
      "could may might must not no nor than then them they we you he she i me him us one two three four " +
      "write writing essay answer sheet words word part following below above more most least about " +
      "please read use using based example examples give given according you should write"
    ).split(/\s+/),
  );

  const VOWEL_SOUND_EXCEPTIONS = new Set(
    (
      "university universities unique uniform uniformly unit units union unions unique united universal " +
      "universe useful useless user users usual usually utility utilities utilize utopia utopian " +
      "european europe eulogy euphemism unanimous ubiquit"
    ).split(/\s+/),
  );

  const CONSONANT_SOUND_AN = new Set(
    "honest honestly honesty hour hours hourly heir heiress honour honor honourable honorable".split(
      /\s+/,
    ),
  );

  const CONTRACTIONS = {
    dont: "do not",
    cant: "cannot",
    wont: "will not",
    isnt: "is not",
    arent: "are not",
    doesnt: "does not",
    didnt: "did not",
    couldnt: "could not",
    shouldnt: "should not",
    wouldnt: "would not",
    wasnt: "was not",
    werent: "were not",
    hasnt: "has not",
    havent: "have not",
    hadnt: "had not",
  };

  const PLURAL_VERB_FIX = {
    is: "are",
    was: "were",
    has: "have",
    does: "do",
    goes: "go",
    makes: "make",
    needs: "need",
    shows: "show",
  };

  const SINGULAR_VERB_FIX = {
    are: "is",
    were: "was",
    have: "has",
    do: "does",
    go: "goes",
    make: "makes",
    take: "takes",
    come: "comes",
    like: "likes",
    think: "thinks",
    need: "needs",
    want: "wants",
    help: "helps",
    show: "shows",
  };

  const COMPARATIVE_FIX = {
    better: "better",
    worse: "worse",
    easier: "easier",
    harder: "harder",
    bigger: "bigger",
    smaller: "smaller",
    higher: "higher",
    lower: "lower",
    cheaper: "cheaper",
    stronger: "stronger",
  };

  const UNCOUNTABLE_FIX = {
    advices: "advice",
    informations: "information",
    knowledges: "knowledge",
    equipments: "equipment",
    furnitures: "furniture",
    researches: "research",
    softwares: "software",
    homeworks: "homework",
    progresses: "progress",
    evidences: "evidence",
  };

  const VOCAB_UPGRADES = [
    {
      pattern: /\b(?:a lot of|lots of)\b/gi,
      to: "a considerable number of",
      reason: "书面语中 a lot of 偏口语，换成数量短语更正式。",
    },
    {
      pattern: /\bmore and more\b/gi,
      to: "an increasing number of",
      reason: "more and more 是中式高频套话，用 an increasing number of 更贴合阅卷语域。",
    },
    {
      // 排除 very much 和 very + 动词：这两类换成 particularly 会写出病句，
      // 动词用法交给下面的“中式语序”规则单独处理。
      pattern: /\bvery\s+(?!(?:much|like|love|enjoy|hate|want|need|hope|appreciate|miss|care)\b)(?=\w)/gi,
      to: "particularly / remarkably",
      reason: "very + 形容词偏弱，用程度副词或更强的形容词提升表达力度。",
      safeRewrite: true,
    },
    {
      pattern: /\bgood\b/gi,
      to: "beneficial / positive",
      reason: "good 语义模糊，换成具体褒义词能体现词汇量。",
    },
    {
      pattern: /\bbad\b/gi,
      to: "detrimental / adverse",
      reason: "bad 偏口语，议论文里用 detrimental / adverse 更准确。",
    },
    {
      pattern: /\bbig\b/gi,
      to: "substantial / considerable",
      reason: "big 过于宽泛，可换成更精确的形容词。",
    },
    {
      pattern: /\bimportant\b/gi,
      to: "significant / crucial",
      reason: "important 使用过度，轮换 significant / crucial 可加分。",
      safeRewrite: true,
    },
    {
      pattern: /\bi think\b/gi,
      to: "I believe / It is my view that",
      reason: "I think 重复出现会显得口语化，可轮换表达观点的句式。",
    },
    {
      pattern: /\bpeople\b/gi,
      to: "individuals / the public",
      reason: "people 高频重复，轮换 individuals / the public 更书面。",
      safeRewrite: true,
    },
    {
      pattern: /\bthing(s)?\b/gi,
      to: "aspect / factor",
      reason: "thing 语义空泛，换成 aspect / factor 更具体。",
    },
    {
      pattern: /\bnowadays\b/gi,
      to: "in contemporary society",
      reason: "nowadays 略口语，in contemporary society 更适合议论文开头。",
    },
    {
      pattern: /\bget\b/gi,
      to: "obtain / acquire",
      reason: "get 偏口语，正式写作可用 obtain / acquire。",
    },
    {
      // 只标“help + 人”的动词用法；your help / the help of 这类名词用法
      // 换成 facilitate 会直接写错，宁可少报。
      pattern: /\bhelp\b(?=\s+(?:me|us|you|him|her|them|people|students|others|children|readers|society)\b)/gi,
      to: "assist / support",
      reason: "help + 人 可换成 assist / support；名词的 help 用 assistance。",
      // 该 pattern 已限定为 help + 人 的动词结构，直接替换不会破坏语法。
      safeRewrite: true,
    },
    {
      pattern: /\bshow\b/gi,
      to: "demonstrate / indicate",
      reason: "图表或论证中的 show 可换成 demonstrate / indicate。",
    },
    {
      pattern: /\bmany\b/gi,
      to: "numerous / a large number of",
      reason: "many 高频重复，可轮换 numerous / a large number of。",
      safeRewrite: true,
    },
    {
      pattern: /\buse\b/gi,
      to: "employ / utilize",
      reason: "use 使用频繁时可换成 employ / utilize。",
    },
    {
      pattern: /\bproblem\b/gi,
      to: "challenge / issue",
      reason: "problem 可轮换 challenge / issue 提升表达多样性。",
      safeRewrite: true,
    },
    {
      pattern: /\bso\b/gi,
      to: "therefore / consequently",
      reason: "so 偏口语，议论文用 therefore / consequently 更连贯。",
    },
  ];

  const TRANSITIONS = [
    "however",
    "therefore",
    "moreover",
    "furthermore",
    "in addition",
    "nevertheless",
    "consequently",
    "for instance",
    "for example",
    "in conclusion",
    "to begin with",
    "first of all",
    "on the contrary",
    "as a result",
    "in other words",
    "meanwhile",
    "besides",
    "ultimately",
  ];

  function countWords(text) {
    return (String(text).match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  }

  function splitSentences(text) {
    const source = String(text || "");
    const sentences = [];
    const regex = /[^.!?\n]+[.!?]*/g;
    let match;
    while ((match = regex.exec(source))) {
      const raw = match[0];
      const value = raw.trim();
      if (!value) {
        continue;
      }
      const offset = raw.indexOf(value);
      sentences.push({
        text: value,
        start: match.index + (offset > 0 ? offset : 0),
        end: match.index + (offset > 0 ? offset : 0) + value.length,
      });
    }
    return sentences;
  }

  function splitParagraphDetails(text) {
    const source = String(text || "");
    const details = [];
    const regex = /[^\n]+/g;
    let match;
    while ((match = regex.exec(source))) {
      const value = match[0].trim();
      if (!value) {
        continue;
      }
      const offset = match[0].indexOf(value);
      const start = match.index + Math.max(0, offset);
      details.push({
        index: details.length + 1,
        text: value,
        start,
        end: start + value.length,
      });
    }
    return details;
  }

  function splitParagraphs(text) {
    return splitParagraphDetails(text).map((paragraph) => paragraph.text);
  }

  function tokens(text) {
    return (String(text).toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) || []).filter(
      (word) => word.length > 2,
    );
  }

  function keywords(text, limit) {
    const frequency = new Map();
    tokens(text).forEach((word) => {
      if (STOP_WORDS.has(word) || word.length < 4) {
        return;
      }
      frequency.set(word, (frequency.get(word) || 0) + 1);
    });
    return [...frequency.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([word]) => word);
  }

  function scanRules(text, rules) {
    const issues = [];
    rules.forEach((rule) => {
      const flags = rule.pattern.flags.includes("g")
        ? rule.pattern.flags
        : `${rule.pattern.flags}g`;
      const regex = new RegExp(rule.pattern.source, flags);
      let match;
      while ((match = regex.exec(text))) {
        if (!match[0]) {
          regex.lastIndex += 1;
          continue;
        }
        const built = rule.build(match, text);
        if (!built) {
          continue;
        }
        const start = Number.isFinite(built.start) ? built.start : match.index;
        const end = Number.isFinite(built.end)
          ? built.end
          : match.index + match[0].length;
        issues.push({
          id: rule.id,
          type: rule.type || "grammar",
          label: rule.label,
          severity: rule.severity || "error",
          start,
          end,
          original: built.original || text.slice(start, end),
          suggestion: built.suggestion || "",
          explanation: built.explanation || rule.explanation || "",
        });
      }
    });
    return issues;
  }

  const GRAMMAR_RULES = [
    {
      id: "plural-subject",
      label: "主谓一致",
      pattern: /\b(people|students|children|teachers|they|we|you)\s+(is|was|has|does)\b/gi,
      explanation: "复数主语后面要用复数谓语。",
      build(match) {
        const verb = match[2].toLowerCase();
        const start = match.index + match[0].lastIndexOf(match[2]);
        return {
          start,
          end: start + match[2].length,
          original: match[2],
          suggestion: PLURAL_VERB_FIX[verb] || match[2],
        };
      },
    },
    {
      id: "singular-subject",
      label: "主谓一致",
      pattern:
        /\b(he|she|it|this|that|everyone|someone|nobody|each)\s+(are|were|have|do|go|make|take|come|like|think|need|want|help|show)\b/gi,
      explanation: "第三人称单数主语后面的谓语要用单数形式。",
      build(match) {
        const verb = match[2].toLowerCase();
        const start = match.index + match[0].lastIndexOf(match[2]);
        return {
          start,
          end: start + match[2].length,
          original: match[2],
          suggestion: SINGULAR_VERB_FIX[verb] || match[2],
        };
      },
    },
    {
      id: "there-be-plural",
      label: "There be 句型",
      pattern:
        /\bthere\s+(is|was)\s+(many|several|numerous|two|three|four|five|lots\s+of|a\s+lot\s+of|plenty\s+of)\b/gi,
      explanation: "There be 句型采用就近原则，后面是复数名词时用 are / were。",
      build(match) {
        const verb = match[1].toLowerCase();
        const start = match.index + match[0].lastIndexOf(match[1]);
        return {
          start,
          end: start + match[1].length,
          original: match[1],
          suggestion: verb === "is" ? "are" : "were",
        };
      },
    },
    {
      id: "double-comparative",
      label: "比较级重复",
      pattern:
        /\b(more|most)\s+(better|worse|easier|harder|bigger|smaller|higher|lower|cheaper|stronger|more)\b/gi,
      explanation: "比较级本身已含“更”的意思，不需要再加 more / most。",
      build(match) {
        const start = match.index;
        return {
          start,
          end: start + match[0].length,
          original: match[0],
          suggestion: COMPARATIVE_FIX[match[2].toLowerCase()] || match[2],
        };
      },
    },
    {
      id: "uncountable-plural",
      label: "不可数名词",
      pattern:
        /\b(advices|informations|knowledges|equipments|furnitures|researches|softwares|homeworks|progresses|evidences)\b/gi,
      explanation: "该名词在英语中通常不可数，不加复数词尾。",
      build(match) {
        const start = match.index;
        return {
          start,
          end: start + match[0].length,
          original: match[0],
          suggestion: UNCOUNTABLE_FIX[match[0].toLowerCase()] || match[0],
        };
      },
    },
    {
      id: "cannot-split",
      label: "拼写规范",
      pattern: /\bcan\s+not\b/gi,
      severity: "warning",
      explanation: "规范写法是 cannot，一般不分开写。",
      build(match) {
        return {
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          suggestion: "cannot",
        };
      },
    },
    {
      id: "although-but",
      label: "连词重复",
      pattern: /\b(?:although|though)\b[^.!?]{0,120}?\bbut\b/gi,
      explanation: "although / though 与 but 不能同时出现在一个句子里，保留其一即可。",
      build(match) {
        const start = match.index + match[0].toLowerCase().lastIndexOf("but");
        return {
          start,
          end: start + 3,
          original: "but",
          suggestion: "（删去 but）",
        };
      },
    },
    {
      id: "because-so",
      label: "连词重复",
      pattern: /\bbecause\b[^.!?]{0,120}?\bso\b/gi,
      explanation: "because 与 so 不能同时使用，二选一。",
      build(match) {
        const start = match.index + match[0].toLowerCase().lastIndexOf("so");
        return {
          start,
          end: start + 2,
          original: "so",
          suggestion: "（删去 so）",
        };
      },
    },
    {
      id: "article-a-vowel",
      label: "冠词",
      pattern: /\ba\s+([a-z]+)\b/gi,
      explanation: "元音音素开头的单词前用 an。",
      build(match) {
        const word = match[1].toLowerCase();
        if (!/^[aeiou]/.test(word) || VOWEL_SOUND_EXCEPTIONS.has(word)) {
          return null;
        }
        return {
          start: match.index,
          end: match.index + 1,
          original: "a",
          suggestion: "an",
        };
      },
    },
    {
      id: "article-an-consonant",
      label: "冠词",
      pattern: /\ban\s+([A-Za-z][a-z]+)\b/g,
      explanation: "辅音音素开头的单词前用 a。",
      build(match) {
        const word = match[1].toLowerCase();
        if (/^[aeiou]/.test(word) || CONSONANT_SOUND_AN.has(word)) {
          return null;
        }
        return {
          start: match.index,
          end: match.index + 2,
          original: "an",
          suggestion: "a",
        };
      },
    },
    {
      id: "contraction",
      label: "正式语域",
      pattern:
        /\b(dont|cant|wont|isnt|arent|doesnt|didnt|couldnt|shouldnt|wouldnt|wasnt|werent|hasnt|havent|hadnt)\b/gi,
      severity: "warning",
      explanation: "考试作文建议使用完整形式，避免口语缩写。",
      build(match) {
        const start = match.index;
        return {
          start,
          end: start + match[0].length,
          original: match[0],
          suggestion: CONTRACTIONS[match[0].toLowerCase()] || match[0],
        };
      },
    },
    {
      id: "its-not",
      label: "拼写易混",
      pattern:
        /\bits\s+(not|a|an|the|very|important|difficult|easy|clear|necessary|possible|true|because|going|been)\b/gi,
      explanation: "这里是 it is 的缩写 it's，its 表示“它的”。",
      build(match) {
        const start = match.index;
        return {
          start,
          end: start + 3,
          original: "its",
          suggestion: "it's",
        };
      },
    },
    {
      id: "redundant-opinion",
      label: "语义重复",
      pattern: /\b(?:in my (?:humble )?opinion|personally)\s*,?\s*i\s+(?:think|believe)\b/gi,
      severity: "warning",
      explanation: "观点表达重复，保留一种说法即可。",
      build(match) {
        return {
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          suggestion: "In my opinion, ...",
        };
      },
    },
    {
      id: "duplicate-word",
      label: "重复词",
      pattern: /\b([A-Za-z]{3,})\s+\1\b/gi,
      explanation: "同一个词连续出现两次，删除多余的一个。",
      build(match) {
        return {
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          suggestion: match[1],
        };
      },
    },
    {
      id: "very-verb",
      label: "中式语序",
      // “I very like it”是最典型的中文直译；very 不能直接修饰动词。
      // like 单列一条并强制带宾语，避免把 “very like a human” 这种介词用法误判。
      pattern: /\bvery\s+like(?=\s+(?:it|this|that|these|those|them|him|her|you|me|us|the)\b)/gi,
      explanation: "very 不能直接修饰动词，要么用 really，要么把 very much 放到动词后面。",
      build(match) {
        return {
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          suggestion: "really like",
          explanation: `“${match[0]}”是中文语序，英语写成 really like 或 like ... very much。`,
        };
      },
    },
    {
      id: "very-verb-plain",
      label: "中式语序",
      pattern: /\bvery\s+(love|enjoy|hate|want|need|hope|appreciate|miss|care)\b/gi,
      explanation: "very 不能直接修饰动词，用 really 或把 very much 放到动词后面。",
      build(match) {
        return {
          start: match.index,
          end: match.index + match[0].length,
          original: match[0],
          suggestion: `really ${match[1].toLowerCase()}`,
          explanation: `“${match[0]}”是中文语序，英语写成 really ${match[1].toLowerCase()} 或 ${match[1].toLowerCase()} ... very much。`,
        };
      },
    },
    {
      id: "missing-space",
      label: "标点格式",
      pattern: /\b[a-z]{2,}[,;:][A-Za-z]/g,
      severity: "warning",
      explanation: "英文标点后面需要加一个空格。",
      build(match) {
        const start = match.index;
        return {
          start,
          end: start + match[0].length,
          original: match[0],
          suggestion: `${match[0].slice(0, -1)} ${match[0].slice(-1)}`,
        };
      },
    },
  ];

  function collectSentenceIssues(text) {
    const issues = [];
    const sentences = splitSentences(text);
    sentences.forEach((sentence, index) => {
      const firstChar = sentence.text.charAt(0);
      if (/[a-z]/.test(firstChar)) {
        const previous = text.slice(Math.max(0, sentence.start - 3), sentence.start);
        const isAbbreviation = /(^|\s)[A-Za-z]\.\s*$/.test(previous);
        if (!isAbbreviation) {
          issues.push({
            id: "sentence-case",
            type: "grammar",
            label: "句首大写",
            severity: "warning",
            start: sentence.start,
            end: sentence.start + 1,
            original: firstChar,
            suggestion: firstChar.toUpperCase(),
            explanation: "句首首字母要大写。",
          });
        }
      }
      if (index === sentences.length - 1 && !/[.!?]["')\]]?$/.test(sentence.text)) {
        issues.push({
          id: "sentence-end",
          type: "grammar",
          label: "句末标点",
          severity: "warning",
          start: Math.max(sentence.start, sentence.end - 1),
          end: sentence.end,
          original: sentence.text.slice(-1),
          suggestion: `${sentence.text.slice(-1)}.`,
          explanation: "每个句子结尾要有句号、问号或感叹号。",
        });
      }
    });
    return issues;
  }

  function collectReplacements(text) {
    const items = [];
    VOCAB_UPGRADES.forEach((rule) => {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      const hit = text.match(regex);
      if (!hit || !hit.length) {
        return;
      }
      if (rule.pattern.source.includes("very")) {
        // very 只在出现两次以上时才提示，避免动辄让全文变样。
        if (hit.length < 2) {
          return;
        }
      }
      items.push({
        from: hit[0],
        to: rule.to,
        count: hit.length,
        reason: rule.reason,
        // 带上原正则，逐句讲解里才能复用同一套句型限制。
        source: rule.pattern.source,
        flags: rule.pattern.flags,
        // 只有语法上确认安全的规则才允许被逐句改写直接套用。
        safeRewrite: Boolean(rule.safeRewrite),
      });
    });
    return items.sort((left, right) => right.count - left.count);
  }

  function collectSentenceTips(text, sentences) {
    const tips = [];
    const longSentences = sentences.filter(
      (sentence) => countWords(sentence.text) >= 32,
    );
    if (longSentences.length) {
      tips.push({
        title: "长句拆分",
        detail: `有 ${longSentences.length} 个句子超过 30 词，建议拆成两句，用分号或连接词衔接。`,
        excerpt: longSentences[0].text.slice(0, 90),
      });
    }

    const openers = new Map();
    sentences.forEach((sentence) => {
      const opener = sentence.text.split(/\s+/).slice(0, 2).join(" ").toLowerCase();
      if (opener.length < 4) {
        return;
      }
      openers.set(opener, (openers.get(opener) || 0) + 1);
    });
    const repeated = [...openers.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1]);
    if (repeated.length) {
      tips.push({
        title: "句式变化",
        detail: `"${repeated[0][0]}" 作为句首出现了 ${repeated[0][1]} 次，可换成分词短语、状语从句或倒装，让句式有起伏。`,
        excerpt: "",
      });
    }

    const passive = (text.match(/\b(?:is|are|was|were|be|been)\s+\w+(?:ed|en)\b/gi) || [])
      .length;
    const sentenceCount = Math.max(sentences.length, 1);
    if (passive / sentenceCount > 0.5) {
      tips.push({
        title: "被动语态偏多",
        detail: "被动句占比偏高，适当改回主动语态，论证会更有力度。",
        excerpt: "",
      });
    }

    if (sentences.length >= 3 && !/\b(?:which|who|that|because|although|while|when|if)\b/i.test(text)) {
      tips.push({
        title: "从句缺失",
        detail: "全文没有出现从句，建议至少写 1-2 个定语从句或状语从句，体现句式复杂度。",
        excerpt: "",
      });
    }

    return tips;
  }

  function scoreTask(text, prompt) {
    const words = countWords(text);
    const paragraphs = splitParagraphs(text).length;
    const notes = [];
    let score = 0;

    const min = Number(prompt?.wordLimitMin) || 0;
    const max = Number(prompt?.wordLimitMax) || 0;
    if (!min && !max) {
      score += 70;
    } else if (words >= min * 0.9 && words <= max * 1.1) {
      score += 100;
    } else if (words >= min * 0.75 && words <= max * 1.3) {
      score += 78;
      notes.push("字数接近但未完全落在要求区间，注意留出 2-3 轮检查余量。");
    } else {
      score += 48;
      notes.push(
        words < min
          ? `字数不足：当前 ${words} 词，要求 ${prompt?.wordLimit || `${min}-${max} 词`}。`
          : `字数超标：当前 ${words} 词，超出要求上限，阅卷会按扣分处理。`,
      );
    }

    if (paragraphs >= 3) {
      score += 100;
    } else if (paragraphs === 2) {
      score += 76;
      notes.push("只有两段，建议拆成“引入—论证—结论”三段结构。");
    } else {
      score += 50;
      notes.push("全文只有一段，务必分段，段落是阅卷老师的第一印象。");
    }

    const promptKeys = keywords(
      [prompt?.prompt, (prompt?.directions || []).join(" "), (prompt?.points || []).join(" ")].join(" "),
      8,
    );
    const essayTokens = new Set(tokens(text));
    const hit = promptKeys.filter((word) => essayTokens.has(word));
    const coverage = promptKeys.length ? hit.length / promptKeys.length : 1;
    score += Math.round(coverage * 100);
    if (promptKeys.length && coverage < 0.5) {
      notes.push("与题目关键词重合较少，注意回扣题干，别写成通用模板文。");
    }

    const tooShort = Boolean(min) && words < min * 0.6;
    const tooLong = Boolean(max) && words > max * 1.5;
    const offTopic = promptKeys.length >= 3 && coverage < 0.2;
    if (tooShort) {
      notes.push("篇幅明显不足，任务完成和内容展开都会受到限制。");
    }
    if (tooLong) {
      notes.push("篇幅明显超出要求，容易带来重复和偏题，组织分会受影响。");
    }

    return {
      score: score / 3,
      keywords: promptKeys,
      hits: hit,
      coverage,
      tooShort,
      tooLong,
      offTopic,
      notes,
    };
  }

  function scoreStructure(text, sentences) {
    const paragraphs = splitParagraphs(text);
    const notes = [];
    let transitionCount = 0;
    paragraphs.forEach((paragraph) => {
      const lower = paragraph.toLowerCase();
      if (TRANSITIONS.some((word) => lower.includes(word))) {
        transitionCount += 1;
      }
    });
    let score = paragraphs.length ? (transitionCount / paragraphs.length) * 100 : 50;
    if (transitionCount === 0) {
      notes.push("几乎没有使用连接词，建议在段首加入 However / Moreover / Therefore 等衔接语。");
      score = 55;
    } else if (transitionCount < Math.ceil(paragraphs.length / 2)) {
      score = Math.max(score, 68);
      notes.push("连接词偏少，至少让每两段中的一段有显性衔接。");
    } else {
      score = Math.max(score, 88);
    }

    if (sentences.length >= 4 && sentences.length <= 18) {
      score = Math.min(100, score + 6);
    } else if (sentences.length > 22) {
      notes.push("句子数量偏多，可能有碎片化表达，合并同类信息。");
      score = Math.max(45, score - 10);
    }
    return { score, notes, transitionCount };
  }

  function scoreLanguage(text, issues) {
    const words = Math.max(countWords(text), 1);
    const errors = issues.filter((issue) => issue.severity === "error").length;
    const warnings = issues.length - errors;
    const penaltyPer100 = (errors * 14 + warnings * 6) / (words / 100);
    const score = Math.max(35, 100 - penaltyPer100);
    const notes = [];
    if (errors === 0 && warnings === 0) {
      notes.push("没有检出明显语法错误，继续保持。");
    } else {
      notes.push(`检出 ${errors} 处明确错误、${warnings} 处可优化表达，先改错误再润色。`);
    }
    return { score, notes, errors, warnings };
  }

  function scoreLexis(text, replacements) {
    const list = tokens(text);
    const unique = new Set(list);
    const diversity = list.length ? unique.size / list.length : 0;
    let score = Math.min(100, 45 + diversity * 90);
    const notes = [];
    if (list.length >= 60 && diversity < 0.42) {
      notes.push("用词重复度偏高，注意同义替换。");
    }
    if (list.length < 60) {
      score = Math.max(40, score - 8);
    }
    const penalty = Math.min(18, replacements.reduce((sum, item) => sum + item.count, 0) * 2);
    score = Math.max(40, score - penalty);
    if (replacements.length) {
      notes.push(`有 ${replacements.length} 类口语化/低分表达可以升级为更书面化的词。`);
    }
    return { score, notes, diversity };
  }

  function bandOf(ratio) {
    if (ratio >= 0.85) {
      return { key: "excellent", label: "优秀" };
    }
    if (ratio >= 0.7) {
      return { key: "good", label: "良好" };
    }
    if (ratio >= 0.6) {
      return { key: "pass", label: "合格" };
    }
    return { key: "weak", label: "待提升" };
  }

  function isKaoyan(exam) {
    return exam === "english-i" || exam === "english-ii";
  }

  function resolvePart(prompt) {
    const raw = String(prompt?.part || "").trim();
    if (/part\s*a\b/i.test(raw) || /^a$/i.test(raw)) {
      return "Part A";
    }
    if (/part\s*b\b/i.test(raw) || /^b$/i.test(raw)) {
      return "Part B";
    }
    const labelMatch = String(prompt?.label || "").match(/part\s*([ab])\b/i);
    if (labelMatch) {
      return `Part ${labelMatch[1].toUpperCase()}`;
    }
    const id = String(prompt?.id || "");
    if (/\d{2}$/.test(id)) {
      const lastTwo = id.slice(-2);
      if (lastTwo === "51" || lastTwo === "47") {
        return "Part A";
      }
      if (lastTwo === "52" || lastTwo === "48") {
        return "Part B";
      }
    }
    if (prompt?.exam === "english-ii" && /-p[12]$/i.test(id)) {
      return id.endsWith("1") ? "Part A" : "Part B";
    }
    return null;
  }

  function bandForScore(score, maxScore, exam, part) {
    const value = Math.round(Number(score) || 0);
    if (isKaoyan(exam) && part && KAOYAN_BAND_TABLE[maxScore]) {
      const table = KAOYAN_BAND_TABLE[maxScore];
      const band =
        table.find((item) => value >= item.min) || table[table.length - 1];
      return { ...band, fiveBand: true };
    }
    return {
      ...bandOf(value / (Number(maxScore) || 1)),
      fiveBand: false,
    };
  }

  function resolveScoringPlan(exam, prompt) {
    const part = resolvePart(prompt);
    const track = TASK_MAX_SCORES[exam];
    if (isKaoyan(exam) && part && track?.[part]) {
      return {
        part,
        maxScore: track[part],
        fiveBand: true,
        dimensions: (PART_DIMENSIONS[`${exam}:${part}`] || []).map((item) => ({
          ...item,
        })),
      };
    }
    const maxScore = MAX_SCORES[exam] || MAX_SCORES.cet6;
    return {
      part,
      maxScore,
      fiveBand: false,
      dimensions: DIMENSIONS.map((item) => ({
        key: item.key,
        label: item.label,
        points: Math.round(item.weight * maxScore * 10) / 10,
      })),
    };
  }

  function taskMaxScore(exam, prompt) {
    return resolveScoringPlan(exam, prompt).maxScore;
  }

  function scoreContent(text, prompt, task) {
    const notes = [];
    const words = countWords(text);
    const sentenceCount = splitSentences(text).length;
    let score = task.score * 0.55 + Math.min(100, 42 + sentenceCount * 7) * 0.45;
    if (words < 70 && Number(prompt?.wordLimitMin) >= 100) {
      score -= 12;
      notes.push("展开明显不足，至少用两个理由或细节把主体段写满。");
    }
    if (task.keywords.length && task.coverage < 0.5) {
      score -= 8;
      notes.push("内容与题干关键词结合不够，论证容易显得空泛。");
    }
    return {
      score: Math.max(25, Math.min(100, score)),
      notes,
      sentenceCount,
    };
  }

  function wantsSmallWritingFormat(prompt, part) {
    if (part !== "Part A") {
      return false;
    }
    const source = [
      prompt?.label,
      prompt?.prompt,
      (prompt?.directions || []).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    return /(letter|email|notice|reply|write\s+to|应用文|小作文|书信|通知)/i.test(
      source,
    );
  }

  function scoreMechanics(text, issues, prompt, part) {
    const notes = [];
    const mechanicIssues = (issues || []).filter((issue) =>
      /拼写|标点|大写/.test(issue.label || ""),
    );
    const errors = mechanicIssues.filter(
      (issue) => issue.severity === "error",
    ).length;
    const warnings = mechanicIssues.length - errors;
    let score = 100 - errors * 16 - warnings * 8;
    if (mechanicIssues.length) {
      notes.push(
        `拼写、标点或大小写共检出 ${mechanicIssues.length} 处，机械分先从这里补。`,
      );
    }

    let formatIssue = false;
    if (wantsSmallWritingFormat(prompt, part)) {
      const source = [prompt?.prompt, (prompt?.directions || []).join(" ")]
        .filter(Boolean)
        .join(" ");
      const noticeTask = /notice|通知/i.test(source) && !/letter|email|书信/i.test(source);
      if (noticeTask) {
        const hasHeading = /(^|\n)\s*notice\b/i.test(text);
        if (!hasHeading) {
          score -= 20;
          formatIssue = true;
          notes.push("通知类应用文建议有 Notice 标题，格式分会被压低。");
        }
      } else {
        const hasGreeting =
          /(^|\n)\s*(dear\b[^\n]{0,60}[,:]|hello\b[^\n]{0,50}[,:]|hi\b[^\n]{0,50}[,:])/i.test(
            text,
          );
        const hasSignoff =
          /(yours\s+(sincerely|faithfully|truly)|best\s+(regards|wishes)|sincerely|kind regards|li ming\b)/i.test(
            text,
          );
        if (!hasGreeting) {
          score -= 20;
          formatIssue = true;
          notes.push("书信或邮件缺少称呼，任务格式不完整。");
        }
        if (!hasSignoff) {
          score -= 15;
          formatIssue = true;
          notes.push("书信或邮件缺少落款或署名，任务格式不完整。");
        }
      }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      notes,
      issues: mechanicIssues.length,
      formatIssue,
    };
  }

  function resolveDeductionCaps({
    exam,
    part,
    maxScore,
    task,
    language,
    mechanics,
    words,
  }) {
    if (!isKaoyan(exam) || !part || !KAOYAN_BAND_TABLE[maxScore]) {
      return [];
    }
    const capFor = (bandKey) =>
      KAOYAN_BAND_TABLE[maxScore].find((item) => item.key === bandKey)?.max ??
      maxScore;
    const caps = [];
    if (task.offTopic) {
      caps.push({
        cap: capFor("band2"),
        reason: "内容与题干基本无关，按第二档封顶。",
      });
    } else if (mechanics.formatIssue) {
      caps.push({
        cap: capFor("band3"),
        reason: "应用文格式或体裁不完整，即使句子流畅也按第三档封顶。",
      });
    }
    const blockingErrors =
      (language.errors || 0) >= Math.max(4, Math.ceil(words / 35));
    if (blockingErrors) {
      caps.push({
        cap: capFor("band3"),
        reason: "多处错误反复影响理解，按第三档封顶。",
      });
    }
    return caps;
  }

  function buildModelEssay(prompt) {
    const source = [
      prompt?.prompt,
      (prompt?.directions || []).join(" "),
      (prompt?.points || []).join(" "),
    ]
      .filter(Boolean)
      .join(" ");
    const keys = keywords(source, 3);
    const topic = keys.length ? keys.join(" / ") : "the issue raised in the prompt";
    return {
      source: "generated",
      notice:
        "这是站内按题干关键词生成的框架范文，用于学结构和句式；正式备考请以真题范文与本题目参考范文为准。",
      keywords: keys,
      paragraphs: [
        `The prompt brings our attention to ${topic}. In my view, this issue deserves serious consideration, because it influences not only the choices of individuals but also the development of society as a whole.`,
        `To begin with, ${topic} has a direct effect on the way people live and work. Take everyday life as an example: small decisions, repeated over time, gradually produce remarkable results. Furthermore, once people understand this connection, they are more likely to act responsibly and to encourage others to follow suit.`,
        `In conclusion, ${topic} should not be treated as a distant concern. By raising public awareness, improving education and taking practical action, we can turn this awareness into lasting benefits for both individuals and society.`,
      ],
    };
  }

  function shorten(value, limit) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }

  function uniqueStrings(values) {
    const seen = new Set();
    return (values || []).filter((value) => {
      const text = String(value || "").trim();
      if (!text || seen.has(text)) {
        return false;
      }
      seen.add(text);
      return true;
    });
  }

  function normalizeSuggestion(value) {
    const suggestion = String(value || "").trim();
    if (!suggestion) {
      return "";
    }
    if (/^（删去.*）$|^\(delete.*\)$/i.test(suggestion)) {
      return "";
    }
    return suggestion;
  }

  function applyIssueFixes(text, offset, issues) {
    const edits = (issues || [])
      .map((issue) => ({
        start: Number(issue.start) - offset,
        end: Number(issue.end) - offset,
        original: String(issue.original || ""),
        replacement: normalizeSuggestion(issue.suggestion),
      }))
      .filter(
        (edit) =>
          Number.isFinite(edit.start) &&
          Number.isFinite(edit.end) &&
          edit.start >= 0 &&
          edit.end > edit.start &&
          edit.end <= String(text).length,
      )
      .sort((left, right) => right.start - left.start);

    let output = String(text || "");
    let nextStart = output.length + 1;
    edits.forEach((edit) => {
      if (edit.end > nextStart) {
        return;
      }
      const current = output.slice(edit.start, edit.end);
      if (edit.original && current !== edit.original) {
        return;
      }
      if (edit.replacement === current) {
        nextStart = edit.start;
        return;
      }
      output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`;
      nextStart = edit.start;
    });
    return output;
  }

  function buildTaskBreakdown(context) {
    const {
      task,
      structure,
      language,
      lexis,
      prompt,
      words,
      paragraphs,
    } = context;
    const min = Number(prompt?.wordLimitMin) || 0;
    const max = Number(prompt?.wordLimitMax) || 0;
    const items = [];

    if (min || max) {
      const within = words >= min * 0.9 && words <= max * 1.1;
      const near = words >= min * 0.75 && words <= max * 1.3;
      items.push({
        label: "字数要求",
        status: within ? "good" : near ? "warn" : "weak",
        detail: `当前 ${words} 词，要求 ${prompt?.wordLimit || `${min || "?"}-${max || "?"} 词`}。`,
      });
    } else {
      items.push({
        label: "篇幅完整度",
        status: words >= 100 ? "good" : words >= 70 ? "warn" : "weak",
        detail: `本题没有明确词数限制，当前 ${words} 词，重点看论证是否完整。`,
      });
    }

    const promptKeywords = task.keywords || [];
    const hits = task.hits || [];
    const coverage = promptKeywords.length ? hits.length / promptKeywords.length : 1;
    items.push({
      label: "内容扣题",
      status: coverage >= 0.7 ? "good" : coverage >= 0.5 ? "warn" : "weak",
      detail: hits.length
        ? `题干关键词命中：${hits.join("、")}。每段都要回到这个主题，不能只在开头提一次。`
        : "题干核心词在正文中复现较少，先补一个与题目直接相关的中心句。",
    });

    items.push({
      label: "段落结构",
      status: paragraphs >= 3 ? "good" : paragraphs === 2 ? "warn" : "weak",
      detail:
        paragraphs >= 3
          ? `共有 ${paragraphs} 段，段落数量符合常见考试作文结构。`
          : `只有 ${paragraphs} 段，建议按“引入观点 - 分点论证 - 总结回扣”重新分段。`,
    });

    const transitionTarget = Math.max(1, Math.ceil(paragraphs / 2));
    items.push({
      label: "衔接手段",
      status:
        structure.transitionCount >= transitionTarget
          ? "good"
          : structure.transitionCount > 0
            ? "warn"
            : "weak",
      detail: `检出 ${structure.transitionCount} 处显性衔接。连接词要表达真实逻辑，不要为了凑分机械堆砌。`,
    });

    items.push({
      label: "语言准确",
      status:
        language.errors === 0 && language.warnings <= 2
          ? "good"
          : language.errors === 0
            ? "warn"
            : "weak",
      detail: `明确错误 ${language.errors} 处，可优化表达 ${language.warnings} 处。先修错误，再润色。`,
    });

    items.push({
      label: "词汇表达",
      status:
        lexis.score >= 80 ? "good" : lexis.score >= 65 ? "warn" : "weak",
      detail: `词汇多样性约 ${Math.round(lexis.diversity * 100)}%，优先替换重复出现且语义空泛的词。`,
    });

    return items.slice(0, 6);
  }

  function buildParagraphMap(context) {
    const { paragraphDetails, sentences, issues, prompt } = context;
    const promptKeyword = (context.task.keywords || [])[0] || "题目主题";
    const total = paragraphDetails.length;

    return paragraphDetails.map((paragraph, offset) => {
      const relatedIssues = issues.filter(
        (issue) => issue.end > paragraph.start && issue.start < paragraph.end,
      );
      const relatedSentences = sentences.filter(
        (sentence) =>
          sentence.end > paragraph.start && sentence.start < paragraph.end,
      );
      const lower = paragraph.text.toLowerCase();
      const paragraphWords = countWords(paragraph.text);
      const transition = TRANSITIONS.find((word) => lower.includes(word)) || "";
      const errors = relatedIssues.filter(
        (issue) => issue.severity === "error",
      ).length;
      const warnings = relatedIssues.length - errors;
      const role =
        total === 1
          ? "整篇"
          : offset === 0
            ? "引入段"
            : offset === total - 1
              ? "结论段"
              : "论证段";
      const thesisCue =
        /\b(?:i (?:believe|think|argue)|in my (?:view|opinion)|it is (?:clear|evident|important)|should|must|need to)\b/i.test(
          paragraph.text,
        );
      const evidenceCue =
        /\b(?:for example|for instance|such as|because|therefore|as a result|take .* as an example)\b/i.test(
          paragraph.text,
        );
      const conclusionCue =
        /\b(?:in conclusion|to sum up|overall|in short|therefore|ultimately|only by)\b/i.test(
          paragraph.text,
        );

      const strengths = [];
      if (!errors) {
        strengths.push("没有检出明确语法错误");
      }
      if (transition) {
        strengths.push(`有显性衔接（${transition}）`);
      }
      if (relatedSentences.length >= 2) {
        strengths.push("信息展开比较完整");
      }
      if (role === "引入段" && thesisCue) {
        strengths.push("中心观点比较明确");
      }
      if (role === "论证段" && evidenceCue) {
        strengths.push("有例证或因果支撑");
      }
      if (role === "结论段" && conclusionCue) {
        strengths.push("收束和回扣比较明显");
      }

      const weaknesses = [];
      if (errors) {
        weaknesses.push(`有 ${errors} 处明确错误`);
      }
      if (warnings) {
        weaknesses.push(`有 ${warnings} 处可优化表达`);
      }
      if (!transition && total > 1) {
        weaknesses.push("缺少段内或段首衔接");
      }
      if (paragraphWords < 18) {
        weaknesses.push("本段篇幅偏薄");
      }
      if (role === "引入段" && !thesisCue) {
        weaknesses.push("中心观点不够明确");
      }
      if (role === "论证段" && !evidenceCue) {
        weaknesses.push("还停留在观点，缺少例子或原因");
      }
      if (role === "结论段" && !conclusionCue) {
        weaknesses.push("结论没有明显收束");
      }

      let action = "保留本段有效表达，把其中一个简单句改成含从句的复合句。";
      if (errors) {
        action = `先改掉${uniqueStrings(
          relatedIssues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.label),
        ).join("、")}，再把本段完整读一遍，确认主谓和标点接通。`;
      } else if (warnings) {
        action = "先处理可优化表达，再给本段补一个更准确的书面词或连接语。";
      } else if (!transition && total > 1) {
        action = "在段首补一个与上一段真实逻辑相符的连接语，再做一次顺读检查。";
      } else if (paragraphWords < 18) {
        action = "补一个具体例子、原因或结果，至少增加 1 句有效支撑。";
      } else if (role === "引入段" && !thesisCue) {
        action = "在段末补一句明确立场，让阅卷老师一眼看到你的中心观点。";
      } else if (role === "论证段" && !evidenceCue) {
        action = "按“观点 - 原因或例子 - 回扣主题”补全本段。";
      } else if (role === "结论段" && !conclusionCue) {
        action = `补一句总结，并回扣题目核心词“${promptKeyword}”。`;
      }

      return {
        paragraph: paragraph.index,
        role,
        summary: `${paragraphWords} 词，${relatedSentences.length} 句，从“${shorten(paragraph.text, 64)}”展开。`,
        strength: strengths.join("；") || "能看出本段的基本写作意图。",
        weakness: weaknesses.join("；") || "暂时没有结构性硬伤。",
        action,
      };
    });
  }

  function buildSentenceWalkthrough(context) {
    const { sentences, issues, sentenceTips, replacements, paragraphDetails } =
      context;
    const candidates = [];

    sentences.forEach((sentence) => {
      const relatedIssues = issues.filter(
        (issue) => issue.end > sentence.start && issue.start < sentence.end,
      );
      if (relatedIssues.length) {
        candidates.push({
          sentence,
          issues: relatedIssues,
          tip: null,
          priority: relatedIssues.some((issue) => issue.severity === "error")
            ? 2
            : 1,
        });
      }
    });

    const longTip = (sentenceTips || []).find(
      (tip) => tip.title === "长句拆分" && tip.excerpt,
    );
    if (longTip) {
      const excerpt = String(longTip.excerpt).slice(0, 32);
      const sentence = sentences.find((item) =>
        item.text.slice(0, 32).startsWith(excerpt),
      );
      if (
        sentence &&
        !candidates.some((item) => item.sentence.start === sentence.start)
      ) {
        candidates.push({
          sentence,
          issues: [],
          tip: longTip,
          priority: 0,
        });
      }
    }

    // 短句（Yours sincerely / Li Ming 之类）上的标点小问题不值得占一张讲解卡；
    // 只有真的存在硬错误时才让短句进卡，否则交给后面的补句逻辑讲长句。
    const contentCandidates = candidates.filter(
      (item) => countWords(item.sentence.text) >= 6,
    );
    const shortWithError = candidates.filter(
      (item) =>
        countWords(item.sentence.text) < 6 &&
        item.issues.some((issue) => issue.severity === "error"),
    );
    const ranked = contentCandidates
      .concat(shortWithError)
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          right.issues.length - left.issues.length ||
          left.sentence.start - right.sentence.start,
      )
      .slice(0, 5);

    // 逐句讲解至少覆盖 3 句，否则一篇十几句的作文只讲一句，看起来像没讲完。
    // 先补每段开头句，再补其余句子；字数太短的（Yours sincerely 之类）跳过。
    const target = Math.min(Math.max(3, Math.ceil(sentences.length / 4)), 6);
    const selected = ranked.slice(0, target);
    if (selected.length < target && sentences.length) {
      const taken = new Set(selected.map((item) => item.sentence.start));
      const structuralTips = [
        {
          title: "开头句点评",
          detail:
            "开头句要第一时间交代写作目的或立场。检查它是否让读者立刻知道这封信或这篇文章要解决什么。",
          note: "把开头句压到一句，目的或观点放在主句里，背景放从句。",
          upgrade:
            "把背景压缩成短语或从句放到句首，主句只保留“我写这封信 / 这篇文章要做什么”。",
        },
        {
          title: "论证句点评",
          detail:
            "论证句要靠具体证据支撑。补一个时间、数字、人名或亲历场景，判断才站得住。",
          note: "每写一个判断，先问自己“凭什么”，再把答案写进同一段。",
          upgrade:
            "先保留判断句作主句，再在后面补一个具体细节（时间、数字或亲历场景）作为证据。",
        },
        {
          title: "衔接句点评",
          detail:
            "衔接句负责交代两句之间的关系。检查连接词是否真的表达因果、转折或递进。",
          note: "把连接词前后各读一遍，逻辑不成立就换一个。",
          upgrade:
            "把真实关系写出来：因果用 because / therefore，转折用 although / however，然后整段读一遍确认逻辑成立。",
        },
        {
          title: "收束句点评",
          detail:
            "收束句要回扣题干关键词，并给出明确的态度、请求或结果，不要只留客套话。",
          note: "把题干核心词搬进收束句，再做一次同义替换。",
          upgrade:
            "回扣题干关键词，最后半句给出明确的态度、请求或结果，替换掉纯客套话。",
        },
      ];
      // 中间句的讲法按顺序轮换：论证 → 举例 → 条件让步，避免整页都是同一句话。
      const argumentTips = [
        structuralTips[1],
        {
          title: "举例句点评",
          detail:
            "这句话在讲道理，但还没有例子支撑。补一个人、一件事或一个数字，读者才会信。",
          note: "抽象判断后面紧跟一个具体例子，是备考作文里性价比最高的补法。",
          upgrade: "保留这句作主句，再用 for example / such as 接一个具体案例。",
        },
        {
          title: "条件句点评",
          detail:
            "这句下了结论，却没有交代结论在什么条件下成立。补一个条件或让步，论证会稳很多。",
          note: "先让步再给结论（Although ... , ...），比直接下结论更站得住。",
          upgrade:
            "把结论放进主句，用 Although / Even if 从句先承认一种相反情况。",
        },
      ];
      let argumentCursor = 0;
      const pickArgumentTip = () => {
        const tip = argumentTips[argumentCursor % argumentTips.length];
        argumentCursor += 1;
        return tip;
      };
      const openings = (paragraphDetails || [])
        .map((paragraph, index) => {
          const sentence = sentences.find(
            (item) =>
              item.start >= paragraph.start && item.end <= paragraph.end,
          );
          return sentence
            ? {
                sentence,
                tip: {
                  ...structuralTips[0],
                  title: `第 ${index + 1} 段开头句`,
                },
              }
            : null;
        })
        .filter(Boolean);
      const pool = [
        ...openings,
        ...sentences.map((sentence) => ({
          sentence,
          tip:
            sentence.start === sentences[sentences.length - 1].start
              ? structuralTips[3]
              : /\b(however|therefore|moreover|furthermore|because|although|while|as a result|for example|first|second|finally)\b/i.test(
                    sentence.text,
                  )
                ? structuralTips[2]
                : // 中间句轮换不同讲法，避免每张卡都是同一句“补一个具体细节”。
                  pickArgumentTip(),
        })),
      ];
      pool.forEach((entry) => {
        if (selected.length >= target || taken.has(entry.sentence.start)) {
          return;
        }
        if (countWords(entry.sentence.text) < 6) {
          return;
        }
        taken.add(entry.sentence.start);
        selected.push({
          sentence: entry.sentence,
          issues: [],
          tip: entry.tip,
          priority: -1,
        });
      });
    }

    if (!selected.length && sentences.length) {
      const longest = [...sentences].sort(
        (left, right) =>
          countWords(right.text) - countWords(left.text) ||
          left.start - right.start,
      )[0];
      selected.push({
        sentence: longest,
        issues: [],
        tip: {
          title: "升格示范",
          detail:
            "这是全文信息量较大的句子，先保证主谓宾清楚，再把背景或补充信息放到从句、后置修饰或下一句。",
        },
        priority: 0,
      });
    }

    const noteMap = {
      主谓一致: "找主语时先跳过介词短语和修饰语，谓语只跟主语中心词一致。",
      冠词: "判断用 a 还是 an 看的是发音，不是只看首字母。",
      连词重复: "一个从句只保留一个主从连接词，中文的“因为……所以……”不能逐字搬进英语。",
      正式语域: "考试作文尽量用完整形式，缩写和口语词都会拉低正式度。",
      拼写易混: "its 表示“它的”，it's 才是 it is，检查时先还原缩写。",
      语义重复: "观点表达保留一个就够，把多余词组换成具体论证。",
      中式语序: "very 不能直接修饰动词，程度要么用 really，要么用 … very much。",
      标点格式: "英文标点后留一个空格，句末必须有终止标点。",
      句首大写: "每个完整句的首字母都要大写，缩写句也要检查。",
    };

    return selected.map((item) => {
      const labels = uniqueStrings(item.issues.map((issue) => issue.label));
      const errors = item.issues.filter(
        (issue) => issue.severity === "error",
      ).length;
      const warnings = item.issues.length - errors;
      const explanations = uniqueStrings(
        item.issues.map((issue) => issue.explanation),
      );
      const original = item.sentence.text;
      let upgrade = applyIssueFixes(
        original,
        item.sentence.start,
        item.issues,
      );
      let diagnosis = "";
      let why = "";
      let note = "";

      if (item.issues.length) {
        diagnosis = errors
          ? `这句有 ${errors} 处明确错误${warnings ? `、${warnings} 处可优化表达` : ""}（${labels.join("、")}）。`
          : `这句没有硬错误，但有 ${warnings} 处表达可以更书面、更准确（${labels.join("、")}）。`;
        why =
          explanations.join(" ") ||
          "问题集中在句子内部搭配和正式语域，需要在不改变原意的前提下重写。";
        note =
          noteMap[item.issues[0].label] ||
          "改完后把整句读一遍，确认主语、谓语和补充信息没有互相遮挡。";
      } else {
        diagnosis = `${item.tip?.title || "升格示范"}：这句没有硬错误，重点看信息是否具体、衔接是否清楚。`;
        why =
          item.tip?.detail ||
          "句子本身没有错误，但信息层次还可以更清楚，适合用来练习从句和衔接。";
        // 没有硬错误的句子优先给一个看得见的替换示范，实在没有可替换词时
        // 才退回写法建议，避免每张卡片都是同一句套话。
        const escapeRule = (value) =>
          String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // 规则自带句型限制（例如 help 必须是 help + 人），逐句判断和替换
        // 都要沿用原正则，否则不同句子里的名词用法会被误改。
        const hitRegex = (rule) =>
          rule.source
            ? new RegExp(rule.source, rule.flags || "i")
            : new RegExp(escapeRule(rule.from), "i");
        const hit = (replacements || []).find(
          (rule) =>
            rule.from &&
            // 只自动套用 safeRewrite 规则，避免把名词 help 改成 facilitate 这类病句。
            rule.safeRewrite &&
            hitRegex(rule).test(original),
        );
        let polished = "";
        if (hit) {
          const matched = original.match(hitRegex(hit))[0];
          // 规则里的 to 常写成“A / B”两个备选，直接套用会得到
          // “particularly / remarkablyimportant”这种脏结果，这里只取第一个
          // 备选，并在规则本身吃掉空格时把空格补回来。
          const first = String(hit.to).split("/")[0].trim();
          const joiner = /\s$/.test(matched) ? " " : "";
          polished = original.replace(hitRegex(hit), `${first}${joiner}`);
        }
        upgrade =
          polished ||
          item.tip?.upgrade ||
          "保留原句意思，把主干先写完整，再把时间、原因或例子放进从句或下一句，避免一个句子承担太多信息。";
        note =
          item.tip?.note ||
          "升格不是把词换难，而是让主干、逻辑和修饰关系更清楚。";
      }

      return {
        original,
        diagnosis,
        why,
        upgrade,
        note,
      };
    });
  }

  function buildScoreStrategy(context) {
    const {
      dimensions,
      language,
      task,
      structure,
      lexis,
      replacements,
      sentenceTips,
      paragraphDetails,
      maxScore,
      words,
      prompt,
    } = context;
    const dimension = (key) =>
      dimensions.find((item) => item.key === key) || {
        score: 70,
        weight: 0.2,
      };
    const gainFor = (key) => {
      const item = dimension(key);
      const gap = Math.max(0, 100 - Number(item.score || 0));
      const gain = (gap / 100) * Number(item.weight || 0.2) * maxScore;
      return Math.max(0.5, Math.round(gain * 2) / 2);
    };
    const gainText = (key) => `+${gainFor(key)} 分左右`;
    const candidates = [];
    const min = Number(prompt?.wordLimitMin) || 0;
    const max = Number(prompt?.wordLimitMax) || 0;
    const promptKeywords = task.keywords || [];
    const hits = task.hits || [];
    const coverage = promptKeywords.length ? hits.length / promptKeywords.length : 1;
    const missingTransitions = paragraphDetails
      .filter(
        (paragraph) =>
          !TRANSITIONS.some((word) =>
            paragraph.text.toLowerCase().includes(word),
          ),
      )
      .slice(0, 2)
      .map((paragraph) => `第 ${paragraph.index} 段`);

    if (language.errors) {
      candidates.push({
        order: 10,
        dimensionKey: "language",
        action: `先处理 ${language.errors} 处明确错误（${uniqueStrings(
          context.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.label),
        ).join("、")}）。每改一处都把这句完整读一遍，避免只换单词没改结构。`,
      });
    }

    if (task.score < 80 || (min && words < min) || (max && words > max)) {
      const wordAdvice =
        min && words < min
          ? `先把字数补到 ${min} 词以上，新增内容必须是原因、例子或结果。`
          : max && words > max
            ? `把字数压回 ${max} 词以内，优先删掉重复解释和空泛套话。`
            : "把每段的中心句写得更明确，保证段落都在回答题目。";
      candidates.push({
        order: 20,
        dimensionKey: "task",
        action: wordAdvice,
      });
    }

    if (structure.score < 85) {
      candidates.push({
        order: 30,
        dimensionKey: "structure",
        action: `给${missingTransitions.join("、") || "段首"}补一个真实逻辑连接语，再检查每段是否只承担一个任务。`,
      });
    }

    if (coverage < 0.6) {
      candidates.push({
        order: 40,
        dimensionKey: "task",
        action: `把题干关键词${promptKeywords.slice(0, 3).map((word) => `“${word}”`).join("、")}分别写进引入段和结论段，避免通用模板。`,
      });
    }

    if (replacements.length) {
      const top = replacements[0];
      candidates.push({
        order: 60,
        dimensionKey: "lexis",
        action: `先替换最明显的低分表达：${top.from} → ${top.to}。整篇最多替换 ${Math.min(
          top.count,
          3,
        )} 次，保留原意最重要。`,
      });
    } else if (lexis.score < 80) {
      candidates.push({
        order: 65,
        dimensionKey: "lexis",
        action: "从每段挑一个语义空泛的词，换成更准确的名词或动词，不追求生僻词。",
      });
    }

    if (sentenceTips.length) {
      candidates.push({
        order: 70,
        dimensionKey: "structure",
        action: `优先完成“${sentenceTips[0].title}”：${sentenceTips[0].detail}`,
      });
    }

    if (!candidates.length) {
      candidates.push({
        order: 80,
        dimensionKey: "lexis",
        action: "全文已经比较稳。下一版只做两个动作：把一个简单句升格为复合句，再换一次重复词。",
      });
      candidates.push({
        order: 90,
        dimensionKey: "task",
        action: "在结论段补一个具体行动或建议，让文章从“观点正确”提升到“论证充分”。",
      });
    }

    return candidates
      .sort((left, right) => left.order - right.order)
      .slice(0, 4)
      .map((item, index) => ({
        priority: index + 1,
        action: item.action,
        expectedGain: gainText(item.dimensionKey),
      }));
  }

  function buildPatterns(exam, task) {
    const topic = (task.keywords || [])[0] || "the issue";
    const patterns = [
      {
        pattern: "From my perspective, ... is not merely ..., but ...",
        usage: "用来把中心观点写得更具体，不改变原意，只增加层次。",
        example: `From my perspective, ${topic} is not merely a personal choice, but a matter that deserves public attention.`,
      },
      {
        pattern: "This phenomenon can be attributed to two factors: ... and ...",
        usage: "原因分析段的主题句，后面必须接两个具体原因，不能只报句式。",
        example:
          "This phenomenon can be attributed to two factors: limited awareness and insufficient practical guidance.",
      },
      {
        pattern: "While it is true that ..., ...",
        usage: "让步转折句，用来避免观点绝对化，适合中段展开。",
        example: `While it is true that ${topic} brings convenience, it also requires responsibility and sound judgment.`,
      },
      {
        pattern: "Only by ... can we ...",
        usage: "结论段强调条件和行动，注意倒装后的语序。",
        example:
          "Only by combining education with practical action can we turn awareness into lasting change.",
      },
    ];

    if (exam === "english-ii") {
      patterns.unshift({
        pattern: "The chart illustrates a marked change in ..., from ... to ...",
        usage: "图表作文第一段先写对象、时间、单位和趋势，不要直接空谈观点。",
        example:
          "The chart illustrates a marked change in online learning, from 30% in 2020 to 65% in 2024.",
      });
    }

    return patterns.slice(0, 3);
  }

  function buildChecklist(context) {
    const {
      language,
      replacements,
      sentenceTips,
      words,
      paragraphs,
      prompt,
      task,
    } = context;
    const min = Number(prompt?.wordLimitMin) || 0;
    const max = Number(prompt?.wordLimitMax) || 0;
    const checklist = [
      min || max
        ? `复写前确认全文落在 ${min || "?"}-${max || "?"} 词之间，当前 ${words} 词。`
        : `复写前确认全文至少 ${Math.max(100, words)} 词，并保留清晰的引入、论证和结论。`,
      `确认全文有 ${Math.max(3, paragraphs)} 段，每段只承担一个中心任务。`,
      "每段至少有一个真实逻辑连接语，不要为了凑衔接而堆 however / moreover。",
    ];

    if (language.errors) {
      checklist.push(
        `优先消灭 ${language.errors} 处明确错误，再检查句首大写和句末标点。`,
      );
    } else {
      checklist.push("全文已无明显硬错误，复写时继续检查主谓一致和冠词。");
    }

    if (replacements.length) {
      checklist.push(
        `至少完成一次重点替换：${replacements[0].from} → ${replacements[0].to}。`,
      );
    } else {
      checklist.push("从每段挑一个空泛词，替换成更准确但不生僻的表达。");
    }

    if (sentenceTips.length) {
      checklist.push(`按“${sentenceTips[0].title}”改写 1-2 句，并在复写后朗读一遍。`);
    } else {
      checklist.push("把一个简单句升格为复合句，并保证逻辑关系真实存在。");
    }

    checklist.push(
      `结论段回扣题干核心词“${(task.keywords || [])[0] || "题目主题"}”，写清一个具体行动或结果。`,
    );
    return checklist.slice(0, 7);
  }

  function buildLesson(context) {
    const {
      exam,
      score,
      maxScore,
      band,
      words,
      paragraphs,
      sentences,
      dimensions,
      language,
      replacements,
      prompt,
      partLabel,
    } = context;
    const sortedDimensions = [...dimensions].sort(
      (left, right) => left.score - right.score,
    );
    const weakest = sortedDimensions[0] || {
      label: "语言准确",
      score: 0,
    };
    const strongest = sortedDimensions[sortedDimensions.length - 1] || {
      label: "任务完成",
      score: 0,
    };
    const priorityAction = language.errors
      ? `先改掉 ${language.errors} 处明确错误`
      : replacements.length
        ? `先把“${replacements[0].from}”替换成更准确的表达`
        : `先把“${weakest.label}”从 ${weakest.score} 分往上拉`;

    return {
      overview: `这道题属于${EXAM_LABELS[exam] || exam}${partLabel ? ` ${partLabel}` : ""}。你这篇作文共 ${words} 词、${paragraphs} 段、${sentences.length} 句，当前 ${score} / ${maxScore} 分（${band.label}${band.range ? ` · ${band.range}` : ""}）。${strongest.label}是相对优势，${weakest.label}是最需要补的短板。讲解按“审题 - 段落 - 逐句 - 升格 - 复写”展开，所有原句都取自你这篇作文。`,
      focus: priorityAction + "；改完后再处理段落展开和词汇升级。",
      taskBreakdown: buildTaskBreakdown(context),
      paragraphMap: buildParagraphMap(context),
      sentenceWalkthrough: buildSentenceWalkthrough(context),
      scoreStrategy: buildScoreStrategy(context),
      patterns: buildPatterns(exam, context.task),
      checklist: buildChecklist(context),
    };
  }

  function grade(input) {
    const text = String(input?.text || "").trim();
    const prompt = input?.prompt || {};
    const exam = prompt.exam || input?.exam || "cet6";
    const plan = resolveScoringPlan(exam, prompt);
    const maxScore = plan.maxScore;

    const sentences = splitSentences(text);
    const paragraphDetails = splitParagraphDetails(text);
    const paragraphs = paragraphDetails.map((paragraph) => paragraph.text);
    const grammarIssues = [
      ...scanRules(text, GRAMMAR_RULES),
      ...collectSentenceIssues(text),
    ].sort((left, right) => left.start - right.start);
    const replacements = collectReplacements(text);
    const sentenceTips = collectSentenceTips(text, sentences);

    const task = scoreTask(text, prompt);
    const structure = scoreStructure(text, sentences);
    const language = scoreLanguage(text, grammarIssues);
    const lexis = scoreLexis(text, replacements);
    const mechanics = scoreMechanics(text, grammarIssues, prompt, plan.part);
    const content = scoreContent(text, prompt, task);
    const parts = { task, structure, language, lexis, content, mechanics };

    const weighted = plan.dimensions.map((dimension) => ({
      ...dimension,
      rawScore: Math.max(0, Math.min(100, parts[dimension.key]?.score || 0)),
    }));
    const uncapped = weighted.reduce(
      (sum, dimension) => sum + (dimension.rawScore / 100) * dimension.points,
      0,
    );
    const words = countWords(text);
    const caps = resolveDeductionCaps({
      exam,
      part: plan.part,
      maxScore,
      task,
      language,
      mechanics,
      words,
    });
    const scoreCap = caps.reduce(
      (lowest, item) => Math.min(lowest, item.cap),
      maxScore,
    );
    const score = Math.round(Math.min(uncapped, scoreCap) * 10) / 10;
    const band = bandForScore(score, maxScore, exam, plan.part);

    const dimensions = weighted.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      weight: maxScore ? dimension.points / maxScore : 0,
      score: Math.round(dimension.rawScore),
      max: 100,
      points: Math.round(dimension.points * 10) / 10,
      scaled:
        Math.round((dimension.rawScore / 100) * dimension.points * 10) / 10,
      note: (parts[dimension.key]?.notes || []).join(" "),
    }));

    const partLabel =
      plan.part === "Part A"
        ? "Part A · 小作文"
        : plan.part === "Part B"
          ? "Part B · 大作文"
          : "";
    const hasPromptDetail =
      Boolean(String(prompt?.prompt || "").trim()) ||
      (prompt?.directions || []).length > 0;
    const taskProvisional = !hasPromptDetail;
    const scoreNotice = isKaoyan(exam)
      ? `非官方模拟评分：按考研英语${exam === "english-i" ? "一" : "二"}${partLabel ? ` ${partLabel}` : ""}的评分标准给出，仅供练习定位。${
          taskProvisional
            ? "题干或图片不完整，任务完成分仅供参考。"
            : ""
        }`
      : "本地练习估算分，非官方成绩。";

    const lesson = buildLesson({
      text,
      prompt,
      exam,
      maxScore,
      score,
      band,
      words,
      paragraphs: paragraphs.length,
      paragraphDetails,
      sentences,
      dimensions,
      issues: grammarIssues,
      replacements,
      sentenceTips,
      task,
      structure,
      language,
      lexis,
      mechanics,
      content,
      partLabel,
    });

    const feedback = [];
    feedback.push(
      `总评：${words} 词、${paragraphs.length} 段、${sentences.length} 句，得分 ${score} / ${maxScore}（${band.label}${band.range ? ` · ${band.range}` : ""}）。`,
    );
    feedback.push(
      ...task.notes,
      ...structure.notes,
      ...language.notes,
      ...lexis.notes,
      ...mechanics.notes,
    );
    caps.forEach((item) => feedback.push(`封顶提示：${item.reason}`));
    if (!feedback.length) {
      feedback.push("整体完成度不错，继续保持并把重点放在语言多样性上。");
    }

    const nextSteps = [];
    if (task.notes.length) {
      nextSteps.push("先补齐字数与分段，保证结构分不丢。");
    }
    if (mechanics.formatIssue) {
      nextSteps.push("先补全称呼、落款或标题等格式要素，再润色句子。");
    }
    if (language.errors > 0) {
      nextSteps.push(`优先改掉标红的 ${language.errors} 处语法错误，再谈润色。`);
    }
    if (replacements.length) {
      nextSteps.push("把口语化表达替换成书面词，优先处理出现次数最多的那一类。");
    }
    if (sentenceTips.length) {
      nextSteps.push("按句式建议重写 1-2 个长句或重复句首的句子。");
    }
    if (!nextSteps.length) {
      nextSteps.push("试着把其中两处简单句合并成含从句的复合句，冲更高档位。");
    }

    return {
      engine: "local-rules",
      exam,
      maxScore,
      score,
      band,
      part: plan.part,
      partLabel,
      taskType: `${EXAM_LABELS[exam] || exam}${partLabel ? ` · ${partLabel}` : ""}`,
      official: false,
      scoreNotice,
      taskProvisional,
      caps,
      words,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      dimensions,
      issues: grammarIssues.slice(0, 40),
      issueCount: grammarIssues.length,
      replacements: replacements.slice(0, 12),
      sentenceTips,
      feedback,
      nextSteps,
      lesson,
      keywords: task.keywords,
      keywordHits: task.hits,
      diversity: Math.round(lexis.diversity * 100) / 100,
      model: prompt.model && prompt.model.length ? null : buildModelEssay(prompt),
      gradedAt: new Date().toISOString(),
    };
  }

  return {
    grade,
    buildModelEssay,
    countWords,
    splitSentences,
    splitParagraphs,
    keywords,
    MAX_SCORES,
    TASK_MAX_SCORES,
    resolvePart,
    taskMaxScore,
    bandForScore,
  };
});
