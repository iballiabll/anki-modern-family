/**
 * 作文批改规则引擎（浏览器 + 服务端共用）。
 *
 * 设计原则：
 *  1. 纯本地、零依赖，断网也能给出完整批改结果；
 *  2. 只报高置信度问题，宁可少报也不要误报，避免误导备考；
 *  3. 输出结构固定：总分 / 分项 / 语法问题（带字符区间便于标红）/ 词汇替换 /
 *     句式建议 / 下一步动作，供 api/grade.js 与 writing.js 复用。
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
      pattern: /\bvery\s+(?=\w)/gi,
      to: "particularly / remarkably",
      reason: "very + 形容词偏弱，用程度副词或更强的形容词提升表达力度。",
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
      pattern: /\bhelp\b/gi,
      to: "facilitate / contribute to",
      reason: "help 使用过度时可换成 facilitate / contribute to。",
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

  function splitParagraphs(text) {
    return String(text || "")
      .split(/\n\s*\n|\n/)
      .map((item) => item.trim())
      .filter(Boolean);
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

    return { score: score / 3, keywords: promptKeys, hits: hit, notes };
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

  function grade(input) {
    const text = String(input?.text || "").trim();
    const prompt = input?.prompt || {};
    const exam = prompt.exam || input?.exam || "cet6";
    const maxScore = MAX_SCORES[exam] || MAX_SCORES.cet6;

    const sentences = splitSentences(text);
    const paragraphs = splitParagraphs(text);
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
    const parts = { task, structure, language, lexis };

    const raw = DIMENSIONS.reduce(
      (sum, dimension) => sum + (parts[dimension.key]?.score || 0) * dimension.weight,
      0,
    );
    const ratio = Math.max(0, Math.min(1, raw / 100));
    const score = Math.round(ratio * maxScore * 10) / 10;
    const band = bandOf(ratio);

    const dimensions = DIMENSIONS.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      weight: dimension.weight,
      score: Math.round(parts[dimension.key].score),
      max: 100,
      scaled: Math.round(ratio * maxScore * 10) / 10,
      note: (parts[dimension.key].notes || []).join(" "),
    }));

    const feedback = [];
    feedback.push(
      `总评：${countWords(text)} 词、${paragraphs.length} 段、${sentences.length} 句，得分 ${score} / ${maxScore}（${band.label}）。`,
    );
    feedback.push(...task.notes, ...structure.notes, ...language.notes, ...lexis.notes);
    if (!feedback.length) {
      feedback.push("整体完成度不错，继续保持并把重点放在语言多样性上。");
    }

    const nextSteps = [];
    if (task.notes.length) {
      nextSteps.push("先补齐字数与分段，保证结构分不丢。");
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
      words: countWords(text),
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      dimensions,
      issues: grammarIssues.slice(0, 40),
      issueCount: grammarIssues.length,
      replacements: replacements.slice(0, 12),
      sentenceTips,
      feedback,
      nextSteps,
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
  };
});
