/**
 * 作文批改接口。
 *
 * 设计原则：本地规则引擎永远可用，AI 只做增量增强。
 *  - 未配置任何 AI Key 时：直接返回 writing-grade.js 的规则批改结果；
 *  - 配置了 Key 时：再请求一次大模型，把反馈/建议合并进规则结果；
 *  - AI 超时或返回异常时：静默回退到规则结果，前端不会因此失败。
 */
const localEngine = require("../writing-grade.js");

const MAX_TEXT_LENGTH = 6000;
const MIN_TEXT_LENGTH = 10;
const EXAM_WHITELIST = new Set(["english-i", "english-ii", "cet4", "cet6"]);
const AI_TIMEOUT_MS = 12000;

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

async function readBody(body) {
  if (!body) {
    return {};
  }
  if (typeof body === "object") {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function getAiConfig() {
  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    "";
  if (!apiKey) {
    return null;
  }

  const provider = process.env.AI_PROVIDER || "";
  const baseUrl =
    process.env.AI_BASE_URL ||
    (provider === "deepseek" || process.env.DEEPSEEK_API_KEY
      ? "https://api.deepseek.com/v1"
      : "https://api.openai.com/v1");
  const model =
    process.env.AI_MODEL ||
    (baseUrl.includes("deepseek") ? "deepseek-chat" : "gpt-4o-mini");

  return { apiKey, baseUrl, model };
}

function buildAiPrompt({ text, exam, prompt, local }) {
  const maxScore = local.maxScore;
  const taskTitle = cleanText(prompt?.label || prompt?.prompt).slice(0, 300);
  const taskBody = cleanText(prompt?.prompt).slice(0, 800);

  return [
    "你是中国研究生入学考试/大学英语四六级的资深阅卷老师。",
    `考试类型：${exam}，满分 ${maxScore} 分。`,
    taskTitle ? `作文题目：${taskTitle}` : "",
    taskBody ? `题目要求：${taskBody}` : "",
    "请批改下面这篇学生作文，只输出一个 JSON 对象，不要输出任何解释性文字。",
    "JSON 结构必须是：",
    '{"score": 数字, "feedback": ["中文评语", "..."], "replacements": [{"from":"原词","to":"建议词","reason":"原因"}], "sentenceTips": ["句式建议"], "issues": [{"start": 数字, "end": 数字, "type": "grammar|word|style", "message": "问题说明", "suggestion": "改法"}], "lesson": {"overview":"整篇中文讲解","focus":"下一版最优先动作","taskBreakdown":[{"label":"审题项","status":"good|warn|weak","detail":"结合本文的说明"}],"paragraphMap":[{"index":1,"role":"引入段","summary":"本段作用","strength":"写得好的地方","weakness":"具体短板","action":"本段改法"}],"sentenceWalkthrough":[{"original":"必须逐字引用学生作文中的完整句子","diagnosis":"问题诊断","why":"语法或写作原因","upgrade":"在不改变原意前提下改写后的完整句子","note":"可迁移的检查方法"}],"scoreStrategy":[{"priority":1,"action":"具体改法","expectedGain":"+1 分左右"}],"patterns":[{"pattern":"英文句式","usage":"适用场景","example":"英文示例"}],"checklist":["复写检查项"]}}',
    "要求：score 不得超过满分；issues 的 start/end 必须是原文中的字符下标（从 0 开始，end 不含），只标注高置信度错误；没有把握就少报。",
    "lesson 必须围绕这篇作文讲解：sentenceWalkthrough.original 必须逐字出现在学生原文中，不能编造；paragraphMap 必须与原文实际段落数和顺序一致；优先讲为什么错、如何保留原意改写、下一版先做什么；不要只输出通用模板。",
    "学生作文：",
    text,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseAiJson(content) {
  const source = cleanText(content)
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeIssues(issues, textLength, existing) {
  const seen = new Set(
    (existing || []).map((issue) => `${issue.start}:${issue.end}:${issue.message}`),
  );
  const list = [];

  (Array.isArray(issues) ? issues : []).forEach((issue) => {
    const start = Math.max(0, Math.min(textLength, Number(issue?.start) || 0));
    const end = Math.max(0, Math.min(textLength, Number(issue?.end) || 0));
    const message = cleanText(issue?.message).slice(0, 160);
    if (!message || end <= start) {
      return;
    }
    const key = `${start}:${end}:${message}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    list.push({
      start,
      end,
      type: ["grammar", "word", "style"].includes(issue?.type)
        ? issue.type
        : "grammar",
      message,
      suggestion: cleanText(issue?.suggestion).slice(0, 160),
    });
  });

  return list;
}

function normalizeReplacements(replacements) {
  return (Array.isArray(replacements) ? replacements : [])
    .map((item) => ({
      from: cleanText(item?.from).slice(0, 60),
      to: cleanText(item?.to).slice(0, 60),
      reason: cleanText(item?.reason).slice(0, 120),
    }))
    .filter((item) => item.from && item.to)
    .slice(0, 12);
}

function normalizeStringList(list, limit) {
  return (Array.isArray(list) ? list : [])
    .map((item) => cleanText(item).slice(0, 300))
    .filter(Boolean)
    .slice(0, limit);
}

const LESSON_STATUSES = new Set(["good", "warn", "weak"]);

function stripOuterQuotes(value) {
  return cleanText(value).replace(/^[“”"']+|[“”"']+$/g, "").trim();
}

function normalizeTaskBreakdown(list, fallback) {
  const items = (Array.isArray(list) ? list : [])
    .map((item) => {
      const label = cleanText(item?.label).slice(0, 40);
      const detail = cleanText(item?.detail).slice(0, 260);
      if (!label || !detail) {
        return null;
      }
      return {
        label,
        status: LESSON_STATUSES.has(item?.status) ? item.status : "warn",
        detail,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
  return items.length ? items : Array.isArray(fallback) ? fallback : [];
}

function normalizeParagraphMap(list, fallback) {
  const items = (Array.isArray(list) ? list : [])
    .map((item, index) => {
      const paragraph = Number(item?.index);
      const role = cleanText(item?.role).slice(0, 30);
      const summary = cleanText(item?.summary).slice(0, 260);
      const strength = cleanText(item?.strength).slice(0, 220);
      const weakness = cleanText(item?.weakness).slice(0, 220);
      const action = cleanText(item?.action).slice(0, 260);
      if (!role || !summary || !action) {
        return null;
      }
      return {
        paragraph:
          Number.isFinite(paragraph) && paragraph > 0
            ? Math.round(paragraph)
            : index + 1,
        role,
        summary,
        strength,
        weakness,
        action,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
  return items.length ? items : Array.isArray(fallback) ? fallback : [];
}

function normalizeSentenceWalkthrough(list, text, fallback) {
  const items = (Array.isArray(list) ? list : [])
    .map((item) => {
      const original = stripOuterQuotes(item?.original).slice(0, 600);
      const diagnosis = cleanText(item?.diagnosis).slice(0, 260);
      const why = cleanText(item?.why).slice(0, 360);
      const upgrade = cleanText(item?.upgrade).slice(0, 700);
      const note = cleanText(item?.note).slice(0, 260);
      if (!original || !text.includes(original) || !diagnosis || !why || !upgrade) {
        return null;
      }
      return { original, diagnosis, why, upgrade, note };
    })
    .filter(Boolean)
    .slice(0, 8);
  return items.length ? items : Array.isArray(fallback) ? fallback : [];
}

function normalizeScoreStrategy(list, fallback) {
  const items = (Array.isArray(list) ? list : [])
    .map((item, index) => {
      const priority = Number(item?.priority);
      const action = cleanText(item?.action).slice(0, 320);
      const expectedGain = cleanText(item?.expectedGain).slice(0, 60);
      if (!action) {
        return null;
      }
      return {
        priority:
          Number.isFinite(priority) && priority > 0
            ? Math.round(priority)
            : index + 1,
        action,
        expectedGain,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority)
    .slice(0, 6)
    .map((item, index) => ({ ...item, priority: index + 1 }));
  return items.length ? items : Array.isArray(fallback) ? fallback : [];
}

function normalizePatterns(list, fallback) {
  const items = (Array.isArray(list) ? list : [])
    .map((item) => {
      const pattern = cleanText(item?.pattern).slice(0, 180);
      const usage = cleanText(item?.usage).slice(0, 220);
      const example = cleanText(item?.example).slice(0, 300);
      if (!pattern || !usage) {
        return null;
      }
      return { pattern, usage, example };
    })
    .filter(Boolean)
    .slice(0, 6);
  return items.length ? items : Array.isArray(fallback) ? fallback : [];
}

function normalizeLesson(lesson, fallback, text) {
  const local = fallback && typeof fallback === "object" ? fallback : {};
  const ai = lesson && typeof lesson === "object" ? lesson : {};
  const overview = cleanText(ai.overview).slice(0, 700);
  const focus = cleanText(ai.focus).slice(0, 320);

  return {
    overview: overview || cleanText(local.overview).slice(0, 700),
    focus: focus || cleanText(local.focus).slice(0, 320),
    taskBreakdown: normalizeTaskBreakdown(
      ai.taskBreakdown,
      local.taskBreakdown,
    ),
    paragraphMap: normalizeParagraphMap(ai.paragraphMap, local.paragraphMap),
    sentenceWalkthrough: normalizeSentenceWalkthrough(
      ai.sentenceWalkthrough,
      text,
      local.sentenceWalkthrough,
    ),
    scoreStrategy: normalizeScoreStrategy(
      ai.scoreStrategy,
      local.scoreStrategy,
    ),
    patterns: normalizePatterns(ai.patterns, local.patterns),
    checklist: normalizeStringList(ai.checklist, 8).length
      ? normalizeStringList(ai.checklist, 8)
      : Array.isArray(local.checklist)
        ? local.checklist
        : [],
  };
}

async function enhanceWithAi({ text, exam, prompt, local }) {
  const config = getAiConfig();
  if (!config) {
    return null;
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "你是严谨的英语考试作文阅卷老师，只输出合法 JSON。",
          },
          { role: "user", content: buildAiPrompt({ text, exam, prompt, local }) },
        ],
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`AI grading failed: ${response.status}`);
    }

    const data = await response.json();
    const parsed = parseAiJson(data?.choices?.[0]?.message?.content);
    if (!parsed) {
      throw new Error("AI grading returned invalid JSON");
    }

    const aiIssues = normalizeIssues(parsed.issues, text.length, local.issues);
    const aiReplacements = normalizeReplacements(parsed.replacements);
    const aiTips = normalizeStringList(parsed.sentenceTips, 8);
    const aiFeedback = normalizeStringList(parsed.feedback, 8);
    const lesson = normalizeLesson(parsed.lesson, local.lesson, text);
    const rawScore = Number(parsed.score);
    const score = Number.isFinite(rawScore)
      ? Math.max(0, Math.min(local.maxScore, Math.round(rawScore)))
      : local.score;

    return {
      ...local,
      engine: "ai",
      score,
      issues: [...local.issues, ...aiIssues].slice(0, 40),
      issueCount: local.issueCount + aiIssues.length,
      replacements: aiReplacements.length ? aiReplacements : local.replacements,
      sentenceTips: aiTips.length ? aiTips : local.sentenceTips,
      feedback: aiFeedback.length ? aiFeedback : local.feedback,
      lesson,
      aiEnhanced: true,
      gradedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn("AI grading fallback:", error?.message || error);
    return null;
  }
}

module.exports = async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "不支持的请求方式" });
    return;
  }

  const body = await readBody(request.body);
  const text = cleanText(body.text);
  const exam = cleanText(body.exam) || cleanText(body.prompt?.exam) || "cet6";

  if (text.length < MIN_TEXT_LENGTH) {
    response.status(400).json({ ok: false, message: "作文内容太短，至少写几句再提交" });
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    response.status(413).json({
      ok: false,
      message: `作文超过 ${MAX_TEXT_LENGTH} 字符上限，请分次批改`,
    });
    return;
  }
  if (!EXAM_WHITELIST.has(exam)) {
    response.status(400).json({ ok: false, message: "未知的考试类型" });
    return;
  }

  const prompt = { ...(body.prompt || {}), exam };
  const local = localEngine.grade({ text, prompt, exam });
  if (!local) {
    response.status(500).json({ ok: false, message: "批改引擎不可用" });
    return;
  }

  const enhanced = await enhanceWithAi({ text, exam, prompt, local });
  response.status(200).json({ ok: true, result: enhanced || local });
};
