/**
 * 口语房间的对话引擎（纯逻辑，不碰 DOM，可以在 Node 里直接测）。
 *
 * 两种模式共用一套规则：
 *   1. local：没有 API 也能聊。做法是“先接住你刚说的具体东西，再给一句自己的
 *      经历或看法，最后才问问题”，并且两轮短回答之后会自动换话题，避免审问感。
 *   2. api：把人物的性格、语气和上面的规则写成 system prompt 交给模型，
 *      返回结果再经过一遍去教师腔的过滤。
 *
 * 这里刻意没有“目标句”“关键词得分”“考官”这些东西：真实聊天里没人给你打分。
 */
(function (root) {
  "use strict";

  /* --------------------------------------------------------------- 工具函数 */

  const DEFAULT_PERSONA = {
    id: "sam",
    name: "Sam",
    city: "Boston",
    job: "高中历史老师",
    wake: "Sam 语气像多年没见的老朋友。",
    voiceHint: { gender: "any", pitch: 0.97, rate: 0.98 },
    openers: [
      {
        en: "Okay, it's been way too long, so you're gonna have to catch me up.",
        zh: "好吧，真的太久没见了，你得把近况都补给我。",
      },
    ],
    stories: {},
    opinions: {},
    followUps: ["So what's actually new with you?"],
    habits: { fillers: ["honestly"], signOffs: ["Anyway."] },
  };

  /** 教师腔标志。出现在模型返回里就整句删掉，留着对话像课堂。 */
  const TEACHER_TELLS = [
    /\bthat'?s a (?:great|good|excellent) question\b/i,
    /\b(?:good|great|nice|excellent) job\b/i,
    /\bwell done\b/i,
    /\byou should (?:say|use|try)\b/i,
    /\btry to (?:say|use|answer)\b/i,
    /\bin english,? (?:we|you) (?:say|should)\b/i,
    /\blet'?s practice\b/i,
    /\brepeat after me\b/i,
    /\byour (?:grammar|pronunciation|vocabulary)\b/i,
    /\b(?:small )?mistake\b/i,
    /\bcorrect(?:ion|ed|ly)?\b/i,
    /\bas an ai\b/i,
    /\bcertainly\b/i,
    /\bI (?:am|'m) here to help you\b/i,
    /\b(?:band|score)\s*\d/i,
  ];

  const QUESTION_STARTS =
    /^(?:what|when|where|who|whom|whose|why|how|which|do|does|did|are|is|am|was|were|can|could|would|will|have|has|had|should|any)\b/i;

  const CHINESE_RE = /[\u3400-\u9fff]/;
  const ENGLISH_WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

  function pick(list, state, key) {
    if (!Array.isArray(list) || list.length === 0) {
      return null;
    }
    const used = Array.isArray(state?.[key]) ? state[key] : null;
    const fresh = used ? list.filter((item) => !used.includes(item)) : list;
    const pool = fresh.length ? fresh : list;
    const index = Math.floor(random(state) * pool.length) % pool.length;
    const chosen = pool[index];
    if (used && !used.includes(chosen)) {
      used.push(chosen);
      if (used.length > 40) {
        used.splice(0, used.length - 40);
      }
    }
    return chosen || null;
  }

  /**
   * 可复现的伪随机：同一段会话、同一轮次拿到同样的句子，
   * 测试和线上不会各说一套，但不同轮次之间又不会重复。
   */
  function random(state) {
    const seed = Number.isFinite(state?.seed) ? state.seed : 1;
    const turn = Number.isFinite(state?.turnCount) ? state.turnCount : 0;
    // 同一轮里会连着抽好几次（形状、素材、口头禅），只按 turn 取随机数
    // 每次都会拿到同一个值，等于没抽。这里加一个轮内步进。
    const tick = Number.isFinite(state?.randomTick) ? state.randomTick : 0;
    if (state && typeof state === "object") {
      state.randomTick = tick + 1;
    }
    const hash = (seed * 9301 + (turn + tick * 7) * 49297 + 233280) % 233280;
    return hash / 233280;
  }

  function countWords(text) {
    const matches = String(text || "").match(ENGLISH_WORD_RE);
    return matches ? matches.length : 0;
  }

  function normalize(text) {
    return String(text || "").trim();
  }

  function isMostlyChinese(text) {
    const raw = String(text || "");
    const chinese = (raw.match(/[\u3400-\u9fff]/g) || []).length;
    const english = countWords(raw);
    return chinese >= 2 && chinese > english;
  }

  function isQuestion(text) {
    const raw = normalize(text);
    return /\?\s*$/.test(raw) || QUESTION_STARTS.test(raw);
  }

  function stripFillers(text) {
    return String(text || "")
      .replace(/^[,.\s]+/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ------------------------------------------------------------- 意图识别 */

  const INTENTS = [
    {
      id: "tired",
      tag: "tired",
      pattern: /\b(tired|exhausted|drained|wiped|knackered|no energy|burnt out|burned out)\b/i,
      reactions: [
        { en: "Yeah, that kind of tired doesn't go away with one night of sleep.", zh: "是啊，那种累不是睡一晚就能消的。" },
        { en: "Ugh, I know that feeling way too well.", zh: "唉，这种感觉我太熟了。" },
      ],
      followUps: [
        { en: "Is it the work itself, or just everything at once?", zh: "是工作本身，还是所有事一起压上来？" },
        { en: "How long has it been like that?", zh: "这样多久了？" },
      ],
    },
    {
      id: "busy",
      tag: "work",
      pattern: /\b(busy|swamped| slammed|no time|nonstop|deadline|ton of work|too much work)\b/i,
      reactions: [
        { en: "That sounds like one of those weeks where you blink and it's Friday.", zh: "听起来就是那种一眨眼就到周五的一周。" },
        { en: "I've had stretches like that, and they all blur together afterwards.", zh: "我也经历过那种时期，事后全糊成一片。" },
      ],
      followUps: [
        { en: "What's eating most of the time?", zh: "主要是哪件事在吃你的时间？" },
        { en: "Does it calm down after this week?", zh: "这周之后会缓下来吗？" },
      ],
    },
    {
      id: "good",
      tag: "weekend",
      pattern: /\b(great|awesome|amazing|fantastic|really good|so good|fun|enjoyed|love it)\b/i,
      reactions: [
        { en: "Okay, that's actually nice to hear.", zh: "行，这听着确实不错。" },
        { en: "Good, you needed a week like that.", zh: "挺好，你是需要这样一周。" },
      ],
      followUps: [
        { en: "What made it work so well?", zh: "是什么让它这么顺？" },
        { en: "Are you going to do it again?", zh: "你还会再来一次吗？" },
      ],
    },
    {
      id: "bad",
      tag: "work",
      pattern: /\b(terrible|awful|horrible|rough|stressed|stressful|bad day|worst|annoying|frustrating)\b/i,
      reactions: [
        { en: "Okay, that sounds genuinely rough.", zh: "行吧，这听着是真的难受。" },
        { en: "Some days just refuse to cooperate, huh.", zh: "有些日子就是不配合，是吧。" },
      ],
      followUps: [
        { en: "What was the part that got you?", zh: "最让你受不了的是哪一段？" },
        { en: "Did it start bad or turn bad halfway?", zh: "是一开始就糟，还是中途变糟的？" },
      ],
    },
    {
      id: "work",
      tag: "work",
      pattern: /\b(work|job|office|boss|manager|colleague|coworker|meeting|shift|client|project)\b/i,
      reactions: [
        { en: "Work stuff has a way of following you home, doesn't it.", zh: "工作上的事就是会跟着你回家，对吧。" },
        { en: "Yeah, that tracks with everything I hear from people these days.", zh: "嗯，这跟现在大家说的都对得上。" },
      ],
      followUps: [
        { en: "Is that new, or has it been like that for a while?", zh: "这是新情况，还是已经有一阵子了？" },
        { en: "Who's actually making that harder, the people or the process?", zh: "到底是谁让这事更难，是人还是流程？" },
      ],
    },
    {
      id: "study",
      tag: "study",
      pattern: /\b(study|studying|exam|test|quiz|class|school|university|college|homework|ielts|toefl|cet)\b/i,
      reactions: [
        { en: "Studying on top of everything else is its own full-time thing.", zh: "在别的事之外还要学习，本身就是一份全职。" },
        { en: "I've done the exam grind, and the worst part is the waiting, not the test.", zh: "我也经历过备考那种折磨，最难的是等待，不是考试。" },
      ],
      followUps: [
        { en: "How's it actually going, not the polite answer?", zh: "真实情况怎么样，别说客套话？" },
        { en: "What part of it do you keep avoiding?", zh: "哪一部分你一直在躲？" },
      ],
    },
    {
      // 做饭单独一条：和「去哪吃」共用一套追问时，会出现
      // 「我不吃早饭」被回一句「谁教你做那个的」这种对不上的话。
      id: "cook",
      tag: "cook",
      pattern: /\b(cook|cooking|cooked|baking|bake|recipe|meal prep|made dinner|make dinner|ordering in|takeout|take-out|leftovers)\b/i,
      reactions: [
        { en: "Cooking at home is cheaper until you count what you burn the first ten times.", zh: "在家做饭是便宜，前提是别把前十次烧糊的成本算进去。" },
        { en: "Respect. I plan to cook and then order something anyway.", zh: "佩服。我每次计划做饭，最后还是点了外卖。" },
      ],
      followUps: [
        { en: "What's your go-to when you can't be bothered?", zh: "懒得动的时候你一般做点什么吃？" },
        { en: "Did you always cook, or is this a recent thing?", zh: "你一直都会做饭，还是最近才开始的？" },
      ],
    },
    {
      id: "food",
      tag: "food",
      pattern: /\b(eat|eating|ate|food|lunch|dinner|breakfast|cook|cooking|restaurant|coffee|tea|hungry|snack|noodles|rice)\b/i,
      reactions: [
        { en: "Okay, now I want food, so thanks for that.", zh: "行，现在我想吃东西了，谢谢你啊。" },
        { en: "Food is the one topic I never get tired of.", zh: "吃这个话题我是永远不会腻的。" },
      ],
      followUps: [
        { en: "What's the last meal that was actually worth it?", zh: "你最近一次吃得值的是哪顿？" },
        { en: "Is it a place you'd take somebody, or your private spot?", zh: "那是你会带人去的店，还是你私藏的？" },
      ],
    },
    {
      id: "weekend",
      tag: "weekend",
      pattern: /\b(weekend|holiday|vacation|trip|travel|traveling|travelling|away|days off|day off)\b/i,
      reactions: [
        { en: "I live for that kind of time off, honestly.", zh: "说实话，我就为这种休息时间活着。" },
        { en: "Yeah, a real day off hits different when you actually earned it.", zh: "是啊，真正挣来的休息日感觉完全不一样。" },
      ],
      followUps: [
        { en: "Do you plan those things out or just go?", zh: "你会提前计划还是直接出发？" },
        { en: "What's the last one you actually enjoyed?", zh: "最近哪一次你是真的享受了？" },
      ],
    },
    {
      id: "weather",
      tag: "weather",
      pattern: /\b(weather|rain|raining|snow|snowing|hot|cold|humid|freezing|storm|windy)\b/i,
      reactions: [
        { en: "Weather is the one thing nobody can talk you out of.", zh: "天气是唯一没人能跟你讲道理的事。" },
        { en: "Yeah, it changes what the whole day feels like.", zh: "是啊，天气会改变一整天感觉。" },
      ],
      followUps: [
        { en: "Does it change your plans, or do you just push through?", zh: "它会改变你的计划，还是你就硬上？" },
        { en: "Is this normal for this time of year where you are?", zh: "你那边这个季节这是正常的吗？" },
      ],
    },
    {
      id: "money",
      tag: "money",
      pattern: /\b(money|expensive|rent|rents|cost|costs|price|prices|save|saving|broke|budget|salary|pay|afford)\b/i,
      reactions: [
        { en: "Yeah, everything got more expensive and nobody's salary noticed.", zh: "是啊，什么都涨价，就是工资没反应。" },
        { en: "Money is the topic everybody thinks about and nobody brings up.", zh: "钱是人人都在想、但没人主动聊的话题。" },
      ],
      followUps: [
        { en: "Is that a fixed cost or more of a monthly surprise?", zh: "那是固定开支，还是每个月的惊喜？" },
        { en: "What are you cutting first when it gets tight?", zh: "紧的时候你最先砍掉什么？" },
      ],
    },
    {
      id: "family",
      tag: "family",
      pattern: /\b(family|mom|mum|dad|parents|mother|father|kid|kids|child|children|wife|husband|brother|sister|grandma|grandpa)\b/i,
      reactions: [
        { en: "Family stuff is never just one thing, is it.", zh: "家里的事从来都不是一件事，对吧。" },
        { en: "Yeah, that's the part of life nobody prepares you for.", zh: "是啊，生活的这部分没人教过你。" },
      ],
      followUps: [
        { en: "Do you see them often, or mostly calls?", zh: "你常常见到他们，还是主要打电话？" },
        { en: "How do you usually handle it when it gets complicated?", zh: "事情变复杂的时候你一般怎么处理？" },
      ],
    },
    {
      id: "health",
      tag: "health",
      pattern: /\b(gym|workout|working out|run|running|lift|lifting|exercise|sick|pain|hurt|doctor|injury|injured)\b/i,
      reactions: [
        { en: "Bodies are extremely clear about it when you ignore them.", zh: "你忽视身体的时候，它的表达方式非常直接。" },
        { en: "Yeah, that stuff catches up with you fast.", zh: "是啊，这种事很快就找你算账。" },
      ],
      followUps: [
        { en: "How often are you actually doing it, honestly?", zh: "说实话，你实际多久做一次？" },
        { en: "What made you start in the first place?", zh: "你一开始是因为什么开始的？" },
      ],
    },
    {
      id: "sleep",
      tag: "sleep",
      pattern: /\b(sleep|sleeping|slept|bed|nap|insomnia|awake|wake up|woke up|tired in the morning)\b/i,
      reactions: [
        { en: "Sleep is the thing I sacrifice first and regret the longest.", zh: "睡觉是我最先牺牲、最后悔最久的事。" },
        { en: "Yeah, a bad night makes everything else harder.", zh: "是啊，睡不好别的都变难。" },
      ],
      followUps: [
        { en: "What keeps you up, your head or your phone?", zh: "是什么让你睡不着，脑子还是手机？" },
        { en: "What's your usual bedtime, if you have one?", zh: "你一般几点睡，如果有固定时间的话？" },
      ],
    },
    {
      id: "media",
      tag: "media",
      pattern: /\b(movie|movie|film|show|series|netflix|episode|music|song|band|album|concert|game|gaming|podcast|book|reading)\b/i,
      reactions: [
        { en: "I've had the same three songs on repeat, so I'm not judging anything.", zh: "我最近一直循环同样三首歌，所以没资格评价别人。" },
        { en: "Yeah, whatever you're into says more about your week than your job does.", zh: "是啊，你在看的东西比工作更能说明你这周过得怎么样。" },
      ],
      followUps: [
        { en: "What got you into that?", zh: "你是怎么开始喜欢上这个的？" },
        { en: "Would you recommend it to somebody or is it just yours?", zh: "你会推荐给别人，还是只是自己喜欢？" },
      ],
    },
    {
      id: "tech",
      tag: "tech",
      pattern: /\b(computer|laptop|phone|app|code|coding|program|software|ai|internet|wifi|device|screen)\b/i,
      reactions: [
        { en: "Tech is supposed to save time and mostly just moves it around.", zh: "科技本该省时间，结果大多只是把时间挪来挪去。" },
        { en: "Yeah, I have a love-hate thing with all my devices.", zh: "是啊，我对我的设备都是又爱又恨。" },
      ],
      followUps: [
        { en: "Does it actually help, or is it just more noise?", zh: "它是真有用，还是只是多一份噪音？" },
        { en: "How much time do you lose to that in a day?", zh: "你一天在这上面丢多少时间？" },
      ],
    },
    {
      id: "plan",
      tag: "future",
      pattern: /\b(plan|planning|going to|gonna|next week|next month|tomorrow|intend|decided|decision|soon)\b/i,
      reactions: [
        { en: "Having something on the calendar changes the whole month.", zh: "日历上有点什么，整个月的感觉都不一样。" },
        { en: "I like the plan. The follow-through is the hard part for me.", zh: "这计划我喜欢，执行对我来说才是难的那部分。" },
      ],
      followUps: [
        { en: "What's the first step you'd actually take?", zh: "你实际会迈的第一步是什么？" },
        { en: "What could get in the way?", zh: "什么可能会挡路？" },
      ],
    },
    {
      id: "feeling",
      tag: "week",
      pattern: /\b(happy|sad|angry|worried|nervous|excited|scared|anxious|lonely|proud|upset|fine)\b/i,
      reactions: [
        { en: "Yeah, that's a lot to be carrying around at once.", zh: "是啊，一次要扛这么多挺重的。" },
        { en: "I get that. It's not a small thing.", zh: "我懂，这不是小事。" },
      ],
      followUps: [
        { en: "Has it been building up or did something set it off?", zh: "是一直积着的，还是有件事触发的？" },
        { en: "Who do you usually talk to about that?", zh: "这种事你一般跟谁说？" },
      ],
    },
    {
      id: "question",
      tag: "week",
      pattern: null,
      reactions: [
        { en: "Fair question. I'd say it depends on the week, honestly.", zh: "问得好，说实话我觉得得看是哪一周。" },
        { en: "Huh. I haven't thought about that in a while.", zh: "嗯，这我有一阵没想过了。" },
      ],
      followUps: [
        { en: "What made you think about it right now?", zh: "你怎么突然想到这个的？" },
        { en: "What's your own answer to that?", zh: "你自己怎么回答这个问题？" },
      ],
    },
    {
      id: "agreement",
      tag: "week",
      pattern: /^\s*(?:yeah|yes|yep|yup|true|exactly|right|agreed|same|me too|of course|for sure)\b/i,
      reactions: [
        { en: "Right? I thought it was just me.", zh: "对吧？我还以为只有我这样。" },
        { en: "Okay good, so it's not only my problem.", zh: "行，那就不只是我的问题。" },
      ],
      followUps: [
        { en: "When did you start noticing it?", zh: "你什么时候开始注意到的？" },
        { en: "Does it bother you enough to change anything?", zh: "烦到你愿意为此改变什么吗？" },
      ],
    },
    {
      id: "disagreement",
      tag: "week",
      pattern: /^\s*(?:no|nah|nope|not really|disagree|never|hard no)\b/i,
      reactions: [
        { en: "Okay, tell me why I'm wrong here.", zh: "行，你说说我哪里想错了。" },
        { en: "Fair enough, that's the opposite of my experience.", zh: "行吧，这跟我的经验正好相反。" },
      ],
      followUps: [
        { en: "What made you land there?", zh: "你是怎么得出这个结论的？" },
        { en: "Has it always been that way for you?", zh: "对你来说一直是这样吗？" },
      ],
    },
    {
      // 兜底：一句普通陈述没有命中任何具体话题时用它，
      // 不能借用「问题」那一套（回一句「问得好」会驴唇不对马嘴）。
      id: "open",
      tag: "week",
      pattern: null,
      reactions: [
        { en: "Okay, I'm with you so far.", zh: "行，目前我还跟得上。" },
        { en: "Mm-hm, keep going.", zh: "嗯哼，继续说。" },
        { en: "Right, that tracks.", zh: "嗯，说得通。" },
      ],
      followUps: [
        { en: "What else is going on with that?", zh: "这事还有别的什么吗？" },
        { en: "How do you feel about it now?", zh: "你现在怎么看这件事？" },
        { en: "Give me one more detail on that.", zh: "再给我讲一个细节。" },
      ],
    },
    {
      id: "dunno",
      tag: "small",
      // 必须整句就是「不知道」才算。原来只要句子里出现 don't know / maybe
      // 就命中，于是「不知道，我可能就在家看点什么」会被当成没话说。
      pattern: /^\s*(?:i\s+)?(?:don'?t know|dunno|no idea|not sure|hard to say|whatever|maybe|depends)[\s,.!?]*(?:really|honestly|yet|either)?[\s,.!?]*$/i,
      reactions: [
        { en: "That's alright, not everything needs an answer right away.", zh: "没事，不是所有事都要马上有答案。" },
        { en: "Yeah, half the time I don't know either.", zh: "是啊，一半时候我也不知道。" },
      ],
      followUps: [
        { en: "Just take a guess, whatever comes to mind first.", zh: "那就随便猜一个，第一个冒出来的就行。" },
        { en: "What would you pick if you had to?", zh: "如果非选不可你会选哪个？" },
      ],
    },
  ];

  function detectIntent(text) {
    const raw = normalize(text);
    if (!raw) {
      return { id: "empty", tag: "week" };
    }
    if (isMostlyChinese(raw)) {
      return { id: "chinese", tag: "chinese" };
    }
    for (const intent of INTENTS) {
      if (intent.pattern && intent.pattern.test(raw)) {
        return { id: intent.id, tag: intent.tag };
      }
    }
    if (isQuestion(raw)) {
      return { id: "question", tag: "week" };
    }
    return { id: "open", tag: "week" };
  }

  function getIntent(id) {
    return INTENTS.find((intent) => intent.id === id) || null;
  }

  /** 短回答、纯语气词、答非所问，都算“这轮没接住”，攒两次就换话题。 */
  function isVague(text) {
    const raw = normalize(text);
    if (!raw) {
      return true;
    }
    if (isMostlyChinese(raw)) {
      return false;
    }
    const words = countWords(raw);
    if (words <= 3) {
      return true;
    }
    return /^(?:i don'?t know|dunno|nothing|whatever|maybe|fine|okay|ok|yeah|yes|no)[.!?]*$/i.test(
      raw,
    );
  }

  /* -------------------------------------------------------- 本地回复生成器 */

  const OPEN_MOVES = [
    {
      en: "Hold on, say more about that.",
      zh: "等一下，多说点这个。",
    },
    {
      en: "Okay, I want the details on that one.",
      zh: "行，这个我想听细节。",
    },
    {
      en: "That's the interesting part, go on.",
      zh: "这部分有意思，继续说。",
    },
  ];

  const SHORT_PROBES = [
    {
      en: "That's a short answer. Give me one example.",
      zh: "这回答有点短，给我一个例子。",
    },
    {
      en: "You're being stingy with the details here.",
      zh: "你细节给得太吝啬了啊。",
    },
    {
      en: "Come on, one real thing that happened.",
      zh: "来吧，讲一件真发生的事。",
    },
  ];

  const TOPIC_TRANSITIONS = [
    { en: "Random question though —", zh: "不过随便问一个——" },
    { en: "Okay, different thing.", zh: "行，换个话题。" },
    { en: "Wait, I've been meaning to ask you something.", zh: "等等，我一直想问你个事。" },
    { en: "Let me switch it up.", zh: "我换个方向问。" },
  ];

  const CHINESE_BRIDGES = [
    {
      en: "My Chinese is terrible, so you're gonna lose me there. Say it in English and I'll answer properly.",
      zh: "我中文很烂，你这么一说我就跟丢了。用英文说一遍我好好回答你。",
    },
    {
      en: "I got about half of that. English, and I'll keep up.",
      zh: "我大概听懂一半。用英文说，我能跟上。",
    },
  ];

  const SIGN_OFFS = [
    { en: "But anyway.", zh: "不过话说回来。" },
    { en: "Sorry, rambling.", zh: "抱歉，扯远了。" },
    { en: "Your turn.", zh: "该你了。" },
  ];

  /**
   * 人物素材的 tag 和意图的 tag 不完全同名：房租会识别成 money，
   * 但人物只写了 city。这里限定「可以往哪些近义 tag 借」，
   * 借不到就重复本话题，也不跨到不相干的地方去。
   */
  const TAG_ALIASES = {
    tired: ["tired", "sleep", "work"],
    work: ["work", "city", "tired"],
    busy: ["work", "city", "tired"],
    weekend: ["weekend", "city", "food"],
    study: ["study", "work"],
    cook: ["food", "coffee", "city"],
    food: ["food", "coffee", "city"],
    coffee: ["coffee", "food", "work"],
    weather: ["weather", "city"],
    money: ["money", "city", "work"],
    family: ["family", "city"],
    health: ["health", "tired"],
    sleep: ["sleep", "tired"],
    media: ["media", "city"],
    tech: ["tech", "work"],
    future: ["future", "work"],
    week: ["weekend", "work", "city"],
    small: ["weekend", "work", "city"],
    chinese: [],
  };

  /**
   * 一轮回复的「形状」。老版本每轮固定是「接住 + 我的经历 + 问你」，
   * 连说三轮就听得出是模板；真实通话里很多时候只接一句、只问一句，
   * 或者先唱个反调再问。
   */
  const REPLY_SHAPES = [
    { id: "reactAsk", weight: 4 },
    { id: "react", weight: 3 },
    { id: "reactStory", weight: 3 },
    { id: "storyAsk", weight: 3 },
    { id: "ask", weight: 2 },
    { id: "pushAsk", weight: 2 },
    { id: "story", weight: 1 },
  ];

  /** 不适合展开自己经历的意图，只允许走轻量形状。 */
  const LIGHT_INTENTS = ["dunno", "chinese", "agreement", "disagreement", "empty"];
  const HEAVY_SHAPES = { reactStory: true, storyAsk: true, story: true, pushAsk: true };

  const PUSHBACKS = [
    { en: "See, I don't fully buy that.", zh: "这个我不完全信。" },
    { en: "Hmm, I'd push back on that one.", zh: "嗯，这条我想反驳一下。" },
    { en: "That's the polite version, isn't it.", zh: "这是客气的说法吧。" },
    { en: "I've heard that one before, and it never holds up.", zh: "这话我听过，但从来站不住。" },
    { en: "Okay, I'm going to be the annoying one here.", zh: "行，我来当那个讨人厌的。" },
  ];

  function findAngle(state, topics, persona, { force = false } = {}) {
    const pool = Array.isArray(topics) ? topics : [];
    if (!pool.length) {
      return null;
    }
    const visited = Array.isArray(state.visitedTopics) ? state.visitedTopics : (state.visitedTopics = []);
    const freshTopics = pool.filter((topic) => !visited.includes(topic.id));
    const topicPool = freshTopics.length ? freshTopics : pool;
    const topic = pick(topicPool, state, "usedTopicIds") || topicPool[0];
    if (topic && !visited.includes(topic.id)) {
      visited.push(topic.id);
      if (visited.length > pool.length) {
        visited.splice(0, visited.length - pool.length);
      }
    }
    const angles = Array.isArray(topic?.angles) ? topic.angles : [];
    const angle = pick(angles, state, "usedAngles");
    if (!angle) {
      return null;
    }
    const personaLine = persona ? `I'll go first though. ` : "";
    return {
      topicId: topic.id,
      topicLabel: topic.label || topic.id,
      angle,
      transition: pick(TOPIC_TRANSITIONS, state, "usedTransitions") || TOPIC_TRANSITIONS[0],
      forced: force,
      prefix: personaLine,
    };
  }

  function findTagged(map, tag, state, key) {
    if (!map || typeof map !== "object") {
      return null;
    }
    const used = Array.isArray(state?.[key]) ? state[key] : [];
    // 同一条素材可能同时挂在几个 tag 下，跨 tag 也算用过了，否则会绕回来重讲。
    const usedEverywhere = Array.isArray(state?.[`${key}All`])
      ? state[`${key}All`]
      : [];
    const spoken = new Set([...used, ...usedEverywhere]);
    const aliases = TAG_ALIASES[tag] || [tag];
    const order = [tag, ...aliases.filter((name) => name !== tag)];
    // 话题素材说完了只允许往近义 tag 借。原来是「借任何一个 tag」，
    // 结果聊做饭会突然插一句主管开会，跳得莫名其妙。
    for (const name of order) {
      const list = Array.isArray(map[name]) ? map[name] : [];
      const fresh = list.filter((item) => !spoken.has(item));
      if (fresh.length) {
        return rememberPick(pick(fresh, state, key), state, key);
      }
    }
    // 近义的全说完了才回头重复，也不跳到不相关的话题上去。
    for (const name of order) {
      const list = Array.isArray(map[name]) ? map[name] : [];
      if (list.length) {
        return rememberPick(pick(list, state, key), state, key);
      }
    }
    return null;
  }

  function rememberPick(item, state, key) {
    if (!item || !state) {
      return item || null;
    }
    const all = Array.isArray(state[`${key}All`])
      ? state[`${key}All`]
      : (state[`${key}All`] = []);
    if (!all.includes(item)) {
      all.push(item);
      if (all.length > 60) {
        all.splice(0, all.length - 60);
      }
    }
    return item;
  }

  /** 记住最近说过的话，用来挡住「同一句反复出现」。 */
  function rememberReply(state, text) {
    const value = normalize(text);
    if (!state || !value) {
      return;
    }
    const recent = Array.isArray(state.recentReplies)
      ? state.recentReplies
      : (state.recentReplies = []);
    recent.push(value);
    if (recent.length > 8) {
      recent.splice(0, recent.length - 8);
    }
  }

  function composeSentences(parts) {
    return capitalizeSentences(
      parts
        .map((part) => stripFillers(part))
        .filter(Boolean)
        .join(" ")
        .replace(/\s+([,.!?])/g, "$1")
        .replace(/\s{2,}/g, " ")
        .trim(),
    );
  }

  /** 素材里有小写开头的句子，拼成一段话之后要按英文习惯补上句首大写。 */
  function capitalizeSentences(text) {
    return String(text || "")
      .replace(/^([a-z])/, (letter) => letter.toUpperCase())
      .replace(
        /([.!?]\s+)([a-z])/g,
        (match, head, letter) => `${head}${letter.toUpperCase()}`,
      );
  }

  /**
   * 口头禅跟在句尾：「… 我周日什么都不干, kind of.」
   * 原来塞在句首会拼成「kind of, sunday I ...」，一眼就是机器写的。
   */
  function withFiller(sentence, filler) {
    const line = String(sentence || "").trim();
    const tic = String(filler || "").trim();
    if (!line || !tic) {
      return line;
    }
    return `${line.replace(/[.?!]+$/, "")}, ${tic}.`;
  }

  function limitWords(text, maxWords) {
    const words = String(text || "").split(/\s+/);
    if (words.length <= maxWords) {
      return text;
    }
    const clipped = words.slice(0, maxWords).join(" ");
    return `${clipped.replace(/[,;:]$/, "")}...`;
  }

  /**
   * 共有池子（反应句、追问句、反驳句）在不同人物嘴里要抽到不同位置，
   * 否则同一句种子下 Rob 和 Casey 会一字不差地回同一句话。
   */
  function rotateFor(list, persona, state) {
    if (!Array.isArray(list) || list.length < 2) {
      return list;
    }
    const id = String(persona?.id || persona?.name || "x");
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
      hash = (hash * 31 + id.charCodeAt(index)) % 9973;
    }
    const turn = Number.isFinite(state?.turnCount) ? state.turnCount : 0;
    const offset = (hash + turn) % list.length;
    return list.slice(offset).concat(list.slice(0, offset));
  }

  /** 按权重抽一个回复形状，并且不让同一个形状连着出现两次以上。 */
  function pickShape(state, intent) {
    const light = LIGHT_INTENTS.includes(intent?.id);
    const pool = light
      ? REPLY_SHAPES.filter((shape) => !HEAVY_SHAPES[shape.id])
      : REPLY_SHAPES;
    const recent = Array.isArray(state?.recentShapes) ? state.recentShapes : [];
    const tail = recent.slice(-2);
    const allowed = pool.filter(
      (shape) => tail.filter((id) => id === shape.id).length < 2,
    );
    const usable = allowed.length ? allowed : pool;
    const weighted = usable.flatMap((shape) =>
      Array.from({ length: shape.weight }, () => shape),
    );
    const chosen = pick(weighted, state, "usedShapes") || pool[0];
    const trail = Array.isArray(state.recentShapes)
      ? state.recentShapes
      : (state.recentShapes = []);
    trail.push(chosen.id);
    if (trail.length > 8) {
      trail.splice(0, trail.length - 8);
    }
    return chosen.id;
  }

  /**
   * 口头禅是人物特征，但不能每句都挂。同一轮里已经出现过同一个词就跳过，
   * 而且只在四成左右的回合用，否则 "honestly" 会变成另一台机器音。
   */
  function nextFiller(persona, state, parts) {
    const fillers = Array.isArray(persona?.habits?.fillers) ? persona.habits.fillers : [];
    if (!fillers.length || random(state) > 0.42) {
      return "";
    }
    const spoken = parts.join(" ").toLowerCase();
    const fresh = fillers.filter(
      (filler) => filler && !spoken.includes(String(filler).toLowerCase()),
    );
    if (!fresh.length) {
      return "";
    }
    return fresh[Math.floor(random(state) * fresh.length) % fresh.length];
  }

  /**
   * 本地生成一轮回应。
   * 形状每轮都换（只接住 / 接住+问 / 讲一段自己的事 / 先反驳再问），
   * 素材只在本话题和近义话题里取，避免两轮之间突然跳线。
   */
  function generateLocalReply(options) {
    const persona = options?.persona || DEFAULT_PERSONA;
    const state = options?.state || {};
    const learnerText = normalize(options?.learnerText);
    const topics = options?.topics || [];
    const intent = detectIntent(learnerText);

    if (intent.id === "chinese") {
      const bridge = pick(CHINESE_BRIDGES, state, "usedBridges") || CHINESE_BRIDGES[0];
      return {
        en: bridge.en,
        zh: bridge.zh,
        mood: "asking",
        intent: intent.id,
        topicShift: false,
        source: "local",
      };
    }

    const vague = isVague(learnerText);
    if (vague) {
      state.vagueStreak = (state.vagueStreak || 0) + 1;
    } else {
      state.vagueStreak = 0;
    }

    const wantsTopicShift =
      Boolean(options?.forceTopic) || (state.vagueStreak || 0) >= 2;

    if (wantsTopicShift) {
      const shift = findAngle(state, topics, persona, { force: options?.forceTopic });
      if (shift) {
        const opener = pick(
          [
            { en: "Alright, I'll talk then.", zh: "行，那我说。" },
            { en: "Fine, I'll pick something.", zh: "好，那我来挑点东西说。" },
          ],
          state,
          "usedOpeners",
        ) || { en: "Alright, I'll talk then.", zh: "行，那我说。" };
        state.vagueStreak = 0;
        const shifted = composeSentences([`${shift.transition.en} ${shift.angle.en}`]);
        rememberReply(state, shifted);
        return {
          en: shifted,
          zh: `${shift.transition.zh}${shift.angle.zh}`,
          mood: "curious",
          intent: intent.id,
          topicShift: true,
          topicId: shift.topicId,
          source: "local",
          extra: { en: opener.en, zh: opener.zh },
        };
      }
    }

    const intentDef = getIntent(intent.id) || getIntent("question");
    const shape = pickShape(state, intent);
    const wantsStory =
      !vague && (shape === "reactStory" || shape === "storyAsk" || shape === "story");
    const wantsReact = shape === "react" || shape === "reactAsk" || shape === "reactStory";
    const wantsAsk =
      shape === "reactAsk" || shape === "storyAsk" || shape === "ask" || shape === "pushAsk";

    const parts = [];
    const zhParts = [];

    if (wantsReact) {
      const reaction = pick(
        rotateFor(intentDef?.reactions, persona, state),
        state,
        "usedReactions",
      );
      if (reaction) {
        parts.push(reaction.en);
        zhParts.push(reaction.zh);
      } else {
        const open =
          pick(rotateFor(OPEN_MOVES, persona, state), state, "usedOpenMoves") || OPEN_MOVES[0];
        parts.push(open.en);
        zhParts.push(open.zh);
      }
    }

    if (shape === "pushAsk") {
      const push =
        pick(rotateFor(PUSHBACKS, persona, state), state, "usedPushbacks") || PUSHBACKS[0];
      parts.push(push.en);
      zhParts.push(push.zh);
    }

    if (vague) {
      // 短回答和答非所问只追问，不塞一段自己的经历，否则像在自说自话。
      const probe =
        pick(rotateFor(SHORT_PROBES, persona, state), state, "usedProbes") || SHORT_PROBES[0];
      parts.push(probe.en);
      zhParts.push(probe.zh);
    } else if (wantsStory) {
      const story = findTagged(persona.stories, intent.tag, state, "usedStories");
      const opinion = story
        ? null
        : findTagged(persona.opinions, intent.tag, state, "usedOpinions");
      const material = story || opinion;
      if (material) {
        parts.push(withFiller(material.en, nextFiller(persona, state, parts)));
        zhParts.push(material.zh);
      } else if (!parts.length) {
        const open =
          pick(rotateFor(OPEN_MOVES, persona, state), state, "usedOpenMoves") || OPEN_MOVES[0];
        parts.push(open.en);
        zhParts.push(open.zh);
      }
    }

    if (wantsAsk) {
      const followUp = pick(
        rotateFor(intentDef?.followUps, persona, state),
        state,
        "usedFollowUps",
      );
      const personaFollowUps = Array.isArray(persona.followUps) ? persona.followUps : [];
      const questionLine =
        followUp ||
        (personaFollowUps.length
          ? {
              en: personaFollowUps[Math.floor(random(state) * personaFollowUps.length) % personaFollowUps.length],
              zh: "你呢？",
            }
          : null);
      if (questionLine && !parts.some((part) => part.includes("?"))) {
        parts.push(questionLine.en);
        zhParts.push(questionLine.zh);
      }
    }

    if (!parts.length) {
      parts.push(OPEN_MOVES[0].en);
      zhParts.push(OPEN_MOVES[0].zh);
    }

    let en = limitWords(composeSentences(parts), 46);
    let zh = composeSentences(zhParts);

    // 同一条回复里已经问过问题就不要再补一句口头禅，否则像念稿。
    if (!en.includes("?") && random(state) > 0.62) {
      const signOff = pick(SIGN_OFFS, state, "usedSignOffs");
      if (signOff) {
        en = `${en} ${signOff.en}`;
        zh = `${zh}${signOff.zh}`;
      }
    }

    // 同一句话刚刚说过就换一条还没问过的具体问题，别让本地陪聊听起来像复读。
    const recent = Array.isArray(state.recentReplies) ? state.recentReplies : [];
    if (recent.includes(en)) {
      const shift = findAngle(state, topics, persona);
      const alt = shift ? composeSentences([`${shift.transition.en} ${shift.angle.en}`]) : "";
      if (alt && !recent.includes(alt)) {
        rememberReply(state, alt);
        return {
          en: alt,
          zh: `${shift.transition.zh}${shift.angle.zh}`,
          mood: "curious",
          intent: intent.id,
          topicShift: true,
          topicId: shift.topicId,
          source: "local",
        };
      }
    }
    rememberReply(state, en);

    return {
      en,
      zh,
      mood: intent.id === "question" ? "answering" : "chatting",
      intent: intent.id,
      topicShift: false,
      source: "local",
    };
  }

  /* ------------------------------------------------------------ 提示词构造 */

  function buildPartnerPrompt(options) {
    const persona = options?.persona || DEFAULT_PERSONA;
    const history = Array.isArray(options?.history) ? options.history : [];
    const topic = options?.topic || null;
    const turnCount = history.filter((message) => message.role === "user").length;
    const recent = history
      .slice(-6)
      .map((message) => `${message.role === "user" ? "THEM" : "YOU"}: ${message.english}`)
      .join("\n");

    const lines = [
      `You are ${persona.name}, ${persona.age || ""} ${persona.job || "a regular person"} living in ${persona.city || "the US"}.`.replace(/\s+/g, " "),
      persona.wake || "",
      "You are on a voice call with someone who is practicing English. You are NOT a teacher, tutor, examiner, or assistant.",
      "Rules that matter most:",
      "1. React to the exact thing they just said before adding anything of your own.",
      "2. Talk like a real friend on a call: contractions, short sentences, interruptions, the occasional filler. Slang is fine.",
      "3. Bring your own life into it: an opinion, a small story, something you did recently.",
      "4. Never correct their grammar, pronunciation, or vocabulary. Never praise their English. Never mention that this is practice.",
      "5. Never say things like 'That's a great question', 'Certainly', 'Good job', 'Let's practice', or explain what an English speaker would say.",
      "6. Ask at most one question per reply, and make it specific to their words, not a generic 'How about you?'.",
      "7. If their answer is short or vague, tease them about it lightly and ask for one concrete example.",
      "8. If the conversation stalls for two turns, drop the current thread and start a different topic you actually care about.",
      "9. Keep it to 1-3 sentences, spoken length. No lists, no headings, no emoji, no markdown.",
      "10. Never repeat a question you already asked in this conversation.",
    ];

    if (persona.habits?.fillers?.length) {
      lines.push(`Your speech habits: ${persona.habits.fillers.join(", ")}.`);
    }
    if (topic?.angle) {
      lines.push(`Topic you have in mind right now: ${topic.angle.en}`);
    }
    lines.push(`This is turn ${turnCount + 1} of the call.`);
    if (recent) {
      lines.push("Recent transcript:", recent);
    }
    lines.push(
      "Reply with only a JSON object, no code fence:",
      '{"say":"your spoken English reply","zh":"Simplified Chinese translation of that reply","mood":"chatting|curious|answering|teasing"}',
    );

    return lines.filter(Boolean).join("\n");
  }

  function buildHistoryMessages(history, limit = 12) {
    return (Array.isArray(history) ? history : [])
      .filter((message) => message && (message.role === "user" || message.role === "partner"))
      .slice(-limit)
      .map((message) => ({
        role: message.role === "user" ? "user" : "assistant",
        content: message.english,
      }));
  }

  function stripTeacherTells(text) {
    const raw = normalize(text);
    if (!raw) {
      return "";
    }
    const withoutMarkdown = raw
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/^\s*[-*•]\s+/gm, " ")
      .replace(/[*_`#>]/g, "")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const sentences = withoutMarkdown
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const kept = sentences.filter(
      (sentence) => !TEACHER_TELLS.some((pattern) => pattern.test(sentence)),
    );
    const result = (kept.length ? kept : sentences).join(" ");
    return result.replace(/\s{2,}/g, " ").trim();
  }

  /**
   * stripTeacherTells 在整段都是教师腔时会原样返回（那是给复盘兜底的），
   * 但接口回复不能这样端上来，所以单独判一次：命中就让调用方退回本地陪聊。
   */
  function isTeacherOnly(text) {
    const raw = normalize(text);
    if (!raw) {
      return true;
    }
    return TEACHER_TELLS.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(raw);
    });
  }

  function parsePartnerReply(content) {
    const raw = normalize(content);
    if (!raw) {
      return null;
    }
    const unfenced = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let data = null;
    try {
      data = JSON.parse(unfenced);
    } catch {
      const start = unfenced.indexOf("{");
      const end = unfenced.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          data = JSON.parse(unfenced.slice(start, end + 1));
        } catch {
          data = null;
        }
      }
    }

    if (data && typeof data === "object") {
      const say = stripTeacherTells(data.say || data.reply || data.text || "");
      const zh = normalize(data.zh || data.chinese || data.translation || "");
      if (!say || isTeacherOnly(say)) {
        return null;
      }
      return {
        en: limitWords(say, 70),
        zh,
        mood: normalize(data.mood) || "chatting",
        source: "api",
      };
    }

    // 模型偶尔不吐 JSON，这里兜底：整段当英文回复，用竖线分隔中文。
    const [englishPart, chinesePart] = unfenced.split(/\s*[|｜]\s*/);
    const say = stripTeacherTells(englishPart);
    if (!say || isTeacherOnly(say)) {
      return null;
    }
    return {
      en: limitWords(say, 70),
      zh: normalize(chinesePart || ""),
      mood: "chatting",
      source: "api",
    };
  }

  /* --------------------------------------------------------------- 复盘卡 */

  /** 只在真的命中时才提，宁可少说，也不编一个“错误”出来。 */
  const NATURAL_FIXES = [
    {
      pattern: /\bI\s+very\s+(?:much\s+)?like\b/gi,
      replace: "I really like",
      why: "very 不直接修饰动词，口语里更常说 really like。",
    },
    {
      pattern: /\bI\s+(?:am|'m)\s+agree\b/gi,
      replace: "I agree",
      why: "agree 本身是动词，前面不用 be。",
    },
    {
      pattern: /\bI\s+have\s+(\d+)\s+years?\s+old\b/gi,
      replace: "I'm $1 years old",
      why: "说年龄用 be + 数字 + years old。",
    },
    {
      pattern: /\bI\s+very\s+(tired|busy|happy|sad|hungry)\b/gi,
      replace: "I'm really $1",
      why: "口语里说 I'm really tired，而不是 I very tired。",
    },
    {
      pattern: /\bI\s+(?:am|'m)\s+boring\b/gi,
      replace: "I'm bored",
      why: "bored 是“我觉得无聊”，boring 是“我让人无聊”。",
    },
    {
      pattern: /\bhow\s+to\s+say\b/gi,
      replace: "how do you say",
      why: "提问时用 how do you say 更自然。",
    },
    {
      pattern: /\bopen\s+the\s+(?:light|lights)\b/gi,
      replace: "turn on the light",
      why: "开灯说 turn on，不用 open。",
    },
    {
      pattern: /\bclose\s+the\s+(?:light|lights)\b/gi,
      replace: "turn off the light",
      why: "关灯说 turn off。",
    },
    {
      pattern: /\bplay\s+(?:the\s+)?phone\b/gi,
      replace: "be on my phone",
      why: "玩手机说 be on my phone。",
    },
    {
      pattern: /\bI\s+think\s+(?:that\s+)?(?:is|it's)\s+not\b/gi,
      replace: "I don't think that's",
      why: "英语习惯把否定提前：I don't think that's...。",
    },
    {
      pattern: /\bI\s+am\s+(?=[a-z])/g,
      replace: "I'm ",
      why: "口语里 I am 通常缩成 I'm。",
    },
  ];

  function buildRecap(options) {
    const history = Array.isArray(options?.history) ? options.history : [];
    const topics = Array.isArray(options?.topics) ? options.topics : [];
    const partnerLines = history.filter(
      (message) => message.role === "partner" && normalize(message.english),
    );
    const learnerLines = history.filter(
      (message) => message.role === "user" && normalize(message.english),
    );

    const keep = [];
    for (const message of partnerLines) {
      const text = stripTeacherTells(message.english);
      const words = countWords(text);
      if (words < 5 || words > 18 || text.includes("[")) {
        continue;
      }
      if (keep.some((item) => item.en === text)) {
        continue;
      }
      keep.push({ en: text, zh: normalize(message.chinese) });
      if (keep.length >= 3) {
        break;
      }
    }

    const fixes = [];
    for (const message of learnerLines) {
      const original = normalize(message.english);
      if (!original) {
        continue;
      }
      for (const rule of NATURAL_FIXES) {
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(original)) {
          continue;
        }
        rule.pattern.lastIndex = 0;
        const better = original.replace(rule.pattern, rule.replace).replace(/\s{2,}/g, " ").trim();
        if (better === original) {
          continue;
        }
        if (fixes.some((item) => item.you === original && item.better === better)) {
          continue;
        }
        fixes.push({ you: original, better, why: rule.why });
        break;
      }
      if (fixes.length >= 3) {
        break;
      }
    }

    const usedTopics = new Set(
      history.map((message) => message.topicId).filter(Boolean),
    );
    const next = [];
    for (const topic of topics) {
      if (next.length >= 3) {
        break;
      }
      if (usedTopics.has(topic.id)) {
        continue;
      }
      const angle = Array.isArray(topic.angles) ? topic.angles[0] : null;
      if (angle) {
        next.push({ label: topic.label, ...angle });
      }
    }

    const learnerWords = learnerLines.reduce(
      (total, message) => total + countWords(message.english),
      0,
    );

    return {
      keep,
      fixes,
      next,
      stats: {
        turns: learnerLines.length,
        partnerTurns: partnerLines.length,
        learnerWords,
        averageWords: learnerLines.length
          ? Math.round(learnerWords / learnerLines.length)
          : 0,
      },
      source: options?.source === "api" ? "api" : "local",
    };
  }

  function buildRecapPrompt(options) {
    const history = Array.isArray(options?.history) ? options.history : [];
    const transcript = history
      .filter((message) => message && normalize(message.english))
      .map((message) => `${message.role === "user" ? "LEARNER" : "PARTNER"}: ${message.english}`)
      .join("\n");
    return [
      "Below is a transcript of a casual English conversation.",
      "Give a short debrief that a friend would give, not a teacher.",
      "Do not invent errors. If a line is already natural, leave it out.",
      "Reply with only a JSON object, no code fence:",
      '{"keep":[{"en":"a phrase from the PARTNER worth reusing","zh":"中文"}],"fixes":[{"you":"the learner line","better":"a more natural version","why":"short Chinese reason"}],"next":["one topic to try next time in Chinese"]}',
      "Transcript:",
      transcript,
    ].join("\n");
  }

  function pickOpener(options) {
    const persona = options?.persona || DEFAULT_PERSONA;
    const state = options?.state || {};
    const openers = Array.isArray(persona.openers) && persona.openers.length
      ? persona.openers
      : DEFAULT_PERSONA.openers;
    const opener = pick(openers, state, "usedPersonaOpeners") || openers[0];
    return {
      en: opener.en,
      zh: opener.zh,
      mood: "chatting",
      source: "local",
    };
  }

  const api = {
    DEFAULT_PERSONA,
    TEACHER_TELLS,
    INTENTS,
    NATURAL_FIXES,
    countWords,
    detectIntent,
    isVague,
    isMostlyChinese,
    isQuestion,
    generateLocalReply,
    buildPartnerPrompt,
    buildHistoryMessages,
    parsePartnerReply,
    stripTeacherTells,
    isTeacherOnly,
    buildRecap,
    buildRecapPrompt,
    pickOpener,
    findAngle,
  };

  root.IballSpeakingEngine = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
