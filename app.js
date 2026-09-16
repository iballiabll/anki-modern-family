const MANIFEST_PATH = "./resources.json";
const WORD_API_PATH = "./api/word";
const STORAGE_KEY = "iball-listening-cabin-known";
const FAVORITES_STORAGE_KEY = "iball-listening-cabin-favorites";
const UNKNOWN_STORAGE_KEY = "iball-listening-cabin-unknown";
const PRACTICE_HISTORY_STORAGE_KEY =
  "iball-listening-cabin-speaking-history";
const PRACTICE_SETTINGS_STORAGE_KEY =
  "iball-listening-cabin-speaking-settings";
const REVIEW_PROGRESS_STORAGE_KEY = "iball-listening-cabin-review-v1";
const REVIEW_DAILY_STORAGE_KEY = "iball-listening-cabin-review-daily-v1";
const REVIEW_DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_LEARNING_STEPS_MS = [60 * 1000, 10 * 60 * 1000];
const REVIEW_MAX_INTERVAL_DAYS = 365;
const REVIEW_GRADES = ["again", "hard", "good", "easy"];
const CATEGORY_ORDER = ["0基础", "四级", "六级", "考研", "电影", "其他"];
const AMERICAN_VOICE_NAMES = {
  female: [
    "aria",
    "jenny",
    "michelle",
    "emma",
    "ava",
    "samantha",
    "nicole",
    "serena",
    "victoria",
    "zira",
    "google us english",
  ],
  male: [
    "guy",
    "andrew",
    "brian",
    "christopher",
    "eric",
    "ryan",
    "thomas",
    "alex",
    "fred",
    "david",
    "mark",
  ],
};
const NATURAL_VOICE_HINTS = [
  "natural",
  "neural",
  "online",
  "enhanced",
  "premium",
  "multilingual",
];
const DIALOGUE_SPEAKER_VOICE_PROFILES = {
  Barista: { gender: "female", pitch: 1.02, rateScale: 1 },
  Receptionist: { gender: "female", pitch: 1, rateScale: 0.99 },
  Interviewer: { gender: "male", pitch: 0.94, rateScale: 0.96 },
  Local: { gender: "male", pitch: 0.96, rateScale: 0.99 },
  Doctor: { gender: "female", pitch: 0.98, rateScale: 0.95 },
  Friend: { gender: "female", pitch: 1.04, rateScale: 1.01 },
};
const FREE_CHAT_COACH_PROFILE = {
  gender: "female",
  pitch: 1,
  rateScale: 0.96,
};
const REALTIME_SILENCE_MS = 1000;
const REALTIME_RESTART_DELAY_MS = 260;
const REALTIME_SPEECH_TAIL_MS = 420;
const REALTIME_MAX_RESTARTS = 8;
const FREE_CHAT_TOPICS = {
  daily: {
    label: "日常交流",
    ideas: [
      "描述今天发生的一件小事",
      "说明你喜欢或不喜欢的日常习惯",
      "补充一个原因，再问对方一个问题",
    ],
    replies: [
      {
        english:
          "That sounds like a familiar part of everyday life. What made it stand out to you today, and how did you feel about it afterward?",
        chinese:
          "这听起来是日常生活中很熟悉的一部分。今天是什么让它特别值得一聊？之后你的感受如何？",
      },
      {
        english:
          "Thanks for sharing that. If you could change one detail about your routine, what would you change, and what difference would it make?",
        chinese:
          "谢谢你的分享。如果能改变日常安排中的一个细节，你会改变什么？这会带来什么不同？",
      },
    ],
  },
  study: {
    label: "学习与考试",
    ideas: [
      "说一个最近学到的知识点",
      "解释它为什么有用",
      "举一个实际应用的例子",
    ],
    replies: [
      {
        english:
          "That is a useful way to think about learning. Which part of your study routine helps you remember new material most effectively?",
        chinese:
          "这是看待学习的实用方式。你的学习安排中，哪一部分最能帮助你记住新内容？",
      },
      {
        english:
          "Good point. If you had to explain that idea to a beginner, what example would you use to make it easier to understand?",
        chinese:
          "说得好。如果要把这个想法解释给初学者，你会用什么例子让它更容易理解？",
      },
    ],
  },
  travel: {
    label: "旅行与城市",
    ideas: [
      "描述一个想去或去过的地方",
      "说一个具体场景",
      "比较它和家乡的不同",
    ],
    replies: [
      {
        english:
          "Travel can change the way we see ordinary places. What detail from that experience would you remember most clearly?",
        chinese:
          "旅行会改变我们看待普通地方的方式。那段经历中，哪一个细节你最会记得清楚？",
      },
      {
        english:
          "That makes the place sound vivid. How does it compare with the place where you live now?",
        chinese:
          "你的描述让这个地方很有画面感。它和你现在生活的地方相比有什么不同？",
      },
    ],
  },
  work: {
    label: "工作与职业",
    ideas: [
      "介绍你正在做或想做的事",
      "说一个需要解决的问题",
      "解释你具备的相关能力",
    ],
    replies: [
      {
        english:
          "That sounds like a meaningful challenge. What skill do you rely on most when you deal with that kind of situation?",
        chinese:
          "这听起来是一个很有意义的挑战。处理这类情况时，你最依赖哪项能力？",
      },
      {
        english:
          "I can see why that matters to you. If you could improve one part of the process, what would you focus on first?",
        chinese:
          "我能理解为什么这对你很重要。如果只能先改善流程中的一个部分，你会优先关注什么？",
      },
    ],
  },
  technology: {
    label: "科技与媒体",
    ideas: [
      "说一个常用应用或设备",
      "说明它带来的便利",
      "谈一个可能的风险",
    ],
    replies: [
      {
        english:
          "Technology often shapes our habits without us noticing. How has that tool changed the way you work or communicate?",
        chinese:
          "科技常常在不知不觉中改变我们的习惯。这个工具怎样改变了你的工作或沟通方式？",
      },
      {
        english:
          "That is worth considering. Do you think the benefits outweigh the possible disadvantages? Why?",
        chinese:
          "这确实值得思考。你认为它的好处是否大于潜在缺点？为什么？",
      },
    ],
  },
  culture: {
    label: "文化与生活",
    ideas: [
      "介绍一个文化习惯",
      "说明它和你的经验有何关系",
      "提出一个值得讨论的问题",
    ],
    replies: [
      {
        english:
          "Culture becomes easier to understand when we connect it with everyday examples. How did you first learn about that custom?",
        chinese:
          "当文化和日常例子联系起来时，它会更容易理解。你最初是怎样了解到这个习俗的？",
      },
      {
        english:
          "That is an interesting perspective. What do you think people from another culture might find surprising about it?",
        chinese:
          "这是一个很有意思的视角。你认为来自另一种文化的人会对它的哪一点感到意外？",
      },
    ],
  },
};
const FREE_CHAT_OPENERS = [
  { english: "That makes sense.", chinese: "这说得通。" },
  { english: "I can picture that.", chinese: "我能想象出那个画面。" },
  { english: "Nice, that's a good detail.", chinese: "不错，这个细节很好。" },
  { english: "Got it.", chinese: "明白了。" },
  { english: "I see what you mean.", chinese: "我明白你的意思。" },
  { english: "That sounds familiar.", chinese: "这听起来很熟悉。" },
  { english: "Fair enough.", chinese: "有道理。" },
  { english: "Okay, good to know.", chinese: "好，知道了。" },
];
const FREE_CHAT_KEYWORD_REACTIONS = [
  {
    pattern:
      /\b(work|job|office|career|meeting|project|boss|colleague|company)\b/i,
    english: "Work can eat up a lot of energy.",
    chinese: "工作确实很消耗精力。",
    question: "What part of your work do you enjoy the most?",
    questionZh: "工作中你最享受的部分是什么？",
  },
  {
    pattern:
      /\b(study|studying|exam|test|school|university|class|homework|ielts|english)\b/i,
    english: "Learning something new always takes patience.",
    chinese: "学新东西总是需要耐心。",
    question: "What is the hardest part for you right now?",
    questionZh: "现在对你来说最难的部分是什么？",
  },
  {
    pattern:
      /\b(travel|trip|city|flight|hotel|holiday|vacation|visit|abroad)\b/i,
    english: "Travel usually leaves you with a few strong memories.",
    chinese: "旅行常常会留下几个很深的记忆。",
    question: "What would you like to do there next time?",
    questionZh: "下次去那里你想做什么？",
  },
  {
    pattern:
      /\b(food|eat|eating|cook|cooking|restaurant|dinner|lunch|breakfast|coffee|tea)\b/i,
    english: "Food is such a big part of daily life.",
    chinese: "吃确实是日常生活里很重要的一部分。",
    question: "Do you cook it yourself, or do you usually eat out?",
    questionZh: "你是自己做饭，还是通常在外面吃？",
  },
  {
    pattern:
      /\b(family|mother|father|mom|dad|parents|brother|sister|son|daughter|child|children|kid)\b/i,
    english: "Family things tend to stay with us.",
    chinese: "家里的事往往最让人记挂。",
    question: "How often do you get to spend time together?",
    questionZh: "你们多久能一起待一会儿？",
  },
  {
    pattern:
      /\b(run|running|gym|sport|exercise|walk|walking|swim|basketball|football|yoga|health|sleep)\b/i,
    english: "Keeping that habit going is the hard part.",
    chinese: "能坚持这个习惯才是最难的。",
    question: "How did you get started with it?",
    questionZh: "你最初是怎么开始的？",
  },
  {
    pattern:
      /\b(phone|app|computer|laptop|ai|internet|online|software|video|game|social media)\b/i,
    english: "Technology changes how we spend our time.",
    chinese: "科技会改变我们花时间的方式。",
    question: "Could you live without it for a week?",
    questionZh: "你能一周不用它吗？",
  },
  {
    pattern:
      /\b(happy|glad|excited|tired|stressed|worried|nervous|proud|angry|sad|relaxed|busy)\b/i,
    english: "It sounds like that really shaped your day.",
    chinese: "听起来那件事真的影响了你的这一天。",
    question: "What helped you deal with it?",
    questionZh: "后来是什么帮你应对的？",
  },
  {
    pattern: /\b(music|song|movie|film|book|reading|series|show|concert)\b/i,
    english: "That is a good way to switch off.",
    chinese: "这是放松的好方式。",
    question: "What do you like most about it?",
    questionZh: "你最喜欢它的哪一点？",
  },
  {
    pattern: /\b(weather|rain|sunny|cold|hot|town|park|street|neighbour|neighbor)\b/i,
    english: "Places and weather shape the mood of a day.",
    chinese: "地方和天气会影响一天的心情。",
    question: "Is that typical for where you live?",
    questionZh: "在你住的地方这算典型情况吗？",
  },
];
const FREE_CHAT_TOPIC_FOLLOW_UPS = {
  daily: [
    {
      english: "What does a normal day look like for you?",
      chinese: "你平常的一天是怎样的？",
    },
    {
      english: "Is there anything you would like to change about your routine?",
      chinese: "你的日常安排里有什么想改变的吗？",
    },
    {
      english: "How do you usually relax after a busy day?",
      chinese: "忙完一天你通常怎么放松？",
    },
    {
      english: "Has anything about your daily habits changed recently?",
      chinese: "最近你的日常习惯有什么变化吗？",
    },
  ],
  study: [
    {
      english: "Which part of your studies takes the most effort?",
      chinese: "学习中哪一部分最费力气？",
    },
    {
      english: "How do you usually prepare for a big exam?",
      chinese: "大考前你通常怎么准备？",
    },
    {
      english: "Is there a method that works better for you than others?",
      chinese: "有哪种方法对你特别有效？",
    },
    {
      english: "What would you like to improve in the next few months?",
      chinese: "接下来几个月你想提升什么？",
    },
  ],
  travel: [
    {
      english: "What do you usually enjoy most on a trip?",
      chinese: "旅行中你最享受什么？",
    },
    {
      english: "Do you prefer busy cities or quiet places?",
      chinese: "你更喜欢热闹的城市还是安静的地方？",
    },
    {
      english: "What is the most memorable place you have been to?",
      chinese: "你去过最难忘的地方是哪里？",
    },
    {
      english: "If you could leave tomorrow, where would you go?",
      chinese: "如果明天就能出发，你会去哪里？",
    },
  ],
  work: [
    {
      english: "What does a typical working day look like for you?",
      chinese: "你典型的工作日是怎样的？",
    },
    {
      english: "Which skill matters most in your job?",
      chinese: "你的工作中哪项能力最重要？",
    },
    {
      english: "What would make your work easier?",
      chinese: "什么会让你的工作更轻松？",
    },
    {
      english: "Where would you like to be in a few years?",
      chinese: "几年后你希望自己处在什么位置？",
    },
  ],
  technology: [
    {
      english: "Which app do you open the most during the day?",
      chinese: "你一天里打开最多的应用是哪个？",
    },
    {
      english: "How does it help you in daily life?",
      chinese: "它在日常生活中怎么帮到你？",
    },
    {
      english: "Do you ever feel you spend too much time on screens?",
      chinese: "你会不会觉得看屏幕的时间太长了？",
    },
    {
      english: "What would you change about it if you could?",
      chinese: "如果可以，你会改变它的哪一点？",
    },
  ],
  culture: [
    {
      english: "Is there a custom in your city that visitors find interesting?",
      chinese: "你所在的城市有什么让外地人觉得有趣的习俗？",
    },
    {
      english: "How do people usually celebrate it?",
      chinese: "大家通常怎么庆祝？",
    },
    {
      english: "Has that custom changed since you were a child?",
      chinese: "这个习俗和你小时候相比有变化吗？",
    },
    {
      english: "What do you think it says about the local culture?",
      chinese: "你觉得它体现了怎样的当地文化？",
    },
  ],
};
const FREE_CHAT_GENERIC_FOLLOW_UPS = [
  {
    english: "Could you tell me a bit more about that?",
    chinese: "能再多说一点吗？",
  },
  {
    english: "What happened next?",
    chinese: "后来发生了什么？",
  },
  {
    english: "Why do you think that is?",
    chinese: "你觉得为什么会这样？",
  },
  {
    english: "How did that make you feel at the time?",
    chinese: "当时那让你有什么感受？",
  },
];
const FREE_LANGUAGE_RULES = [
  {
    type: "语法",
    pattern: /\bi\b/g,
    replacement: "I",
    message: "英文中的第一人称代词 I 在任何位置都要大写。",
  },
  {
    type: "语法",
    pattern: /\bI\s+am\s+agree\b/gi,
    replacement: "I agree",
    message: "agree 本身是动词，直接用 I agree，不需要加 am。",
  },
  {
    type: "表达",
    pattern: /\bI\s+(?:very|really very)\s+like\b/gi,
    replacement: "I really like",
    message: "I really like 比 I very like 更符合英语语序和搭配。",
  },
  {
    type: "语法",
    pattern: /\b(he|she|it)\s+don't\b/gi,
    replacement: "$1 doesn't",
    message: "第三人称单数在一般现在时的否定式要用 doesn't。",
  },
  {
    type: "语法",
    pattern: /\bI\s+have\s+(\d+)\s+years?\s+old\b/gi,
    replacement: "I am $1 years old",
    message: "表达年龄用 be + 数字 + years old，不用 have。",
  },
  {
    type: "语法",
    pattern: /\bmore\s+better\b/gi,
    replacement: "better",
    message: "better 已经是比较级，不需要再加 more。",
  },
  {
    type: "词汇",
    pattern: /\bI\s+am\s+boring\b/gi,
    replacement: "I am bored",
    message: "bored 表示“感到无聊”，boring 表示“令人无聊”。",
  },
  {
    type: "语法",
    pattern: /\bdiscuss\s+about\b/gi,
    replacement: "discuss",
    message: "discuss 是及物动词，后面直接接讨论的内容。",
  },
  {
    type: "语法",
    pattern: /\blisten\s+music\b/gi,
    replacement: "listen to music",
    message: "listen 后面接对象时需要加 to。",
  },
  {
    type: "词汇",
    pattern: /\bmarried\s+with\b/gi,
    replacement: "married to",
    message: "固定搭配是 be married to someone。",
  },
  {
    type: "语法",
    pattern: /\bcan\s+to\s+(\w+)\b/gi,
    replacement: "can $1",
    message: "情态动词 can 后直接接动词原形。",
  },
  {
    type: "语法",
    pattern: /\bthere\s+is\s+(many|several|lots of)\b/gi,
    replacement: "there are $1",
    message: "后面接复数名词时，要用 there are。",
  },
  {
    type: "表达",
    pattern: /\bhow\s+to\s+say\b/gi,
    replacement: "How do you say",
    message: "独立提问时应说 How do you say...?。",
  },
  {
    type: "词汇",
    pattern: /\bdo\s+a\s+mistake\b/gi,
    replacement: "make a mistake",
    message: "英语中固定说 make a mistake。",
  },
  {
    type: "词汇",
    pattern: /\bopen\s+the\s+light\b/gi,
    replacement: "turn on the light",
    message: "开灯用 turn on the light，不用 open。",
  },
  {
    type: "词汇",
    pattern: /\blearn\s+knowledge\b/gi,
    replacement: "gain knowledge",
    message: "knowledge 常与 gain 或 acquire 搭配；表达“学到知识”也可说 learn a lot。",
  },
];
const FREE_VOCABULARY_UPGRADES = [
  {
    pattern: /\bvery\s+good\b/gi,
    replacement: "excellent",
    message: "excellent 比 very good 更凝练，也更适合雅思口语。",
  },
  {
    pattern: /\bvery\s+bad\b/gi,
    replacement: "terrible",
    message: "terrible 可以替代 very bad，使表达更简洁。",
  },
  {
    pattern: /\bI\s+think\b/gi,
    replacement: "In my view",
    message: "In my view 是更正式、适合展开观点的开头。",
  },
];
const DIALOGUE_SCENARIOS = [
  {
    id: "cafe",
    title: "咖啡馆点单",
    titleEn: "Ordering at a Cafe",
    category: "日常",
    level: "入门",
    summary: "点饮品、选择规格并完成付款。",
    turns: [
      {
        speaker: "Barista",
        prompt: "Hi, welcome in! What are you having today?",
        promptZh: "你好，欢迎光临！今天想喝点什么？",
        sample: "Could I get a latte, please?",
        sampleZh: "我想要一杯拿铁，谢谢。",
        keywords: [
          {
            label: "说出饮品",
            options: [["latte"], ["coffee"], ["cappuccino"], ["tea"]],
          },
          {
            label: "礼貌点单",
            options: [["i'd like"], ["can i have"], ["could i get"], ["i would like"]],
          },
        ],
      },
      {
        speaker: "Barista",
        prompt: "Sure thing. What size are we doing, and any milk with that?",
        promptZh: "好的。你要什么杯型？需要加牛奶吗？",
        sample: "A medium with oat milk, please.",
        sampleZh: "请给我中杯，加燕麦奶。",
        keywords: [
          {
            label: "说明杯型",
            options: [["small"], ["medium"], ["large"]],
          },
          {
            label: "选择牛奶",
            options: [["milk"], ["oat milk"], ["almond milk"], ["soy milk"]],
          },
        ],
      },
      {
        speaker: "Barista",
        prompt: "All right, that's gonna be five bucks. How do you wanna pay?",
        promptZh: "一共五美元。你想怎么付款？",
        sample: "I'll pay by card. Could I get it to go?",
        sampleZh: "我刷卡。可以帮我做成外带吗？",
        keywords: [
          {
            label: "付款方式",
            options: [["card"], ["cash"], ["apple pay"], ["google pay"]],
          },
          {
            label: "说明堂食或外带",
            options: [["to go"], ["takeaway"], ["for here"], ["to stay"]],
          },
        ],
      },
    ],
  },
  {
    id: "hotel",
    title: "酒店入住",
    titleEn: "Hotel Check-in",
    category: "出行",
    level: "入门",
    summary: "办理入住、出示证件并询问酒店服务。",
    turns: [
      {
        speaker: "Receptionist",
        prompt: "Welcome in! Do you have a reservation with us?",
        promptZh: "欢迎！您有预订吗？",
        sample: "Yes, it's under Li. I have a reservation for two.",
        sampleZh: "有，我用李这个名字预订了。",
        keywords: [
          {
            label: "确认预订",
            options: [["reservation"], ["booked"], ["booking"]],
          },
          {
            label: "说明预订姓名",
            options: [
              ["under li"],
              ["under the name"],
              ["name is"],
              ["my name"],
            ],
          },
        ],
      },
      {
        speaker: "Receptionist",
        prompt: "Could I see your passport and a credit card?",
        promptZh: "可以出示您的护照和一张信用卡吗？",
        sample: "Sure. Here's my passport and credit card.",
        sampleZh: "当然可以。这是我的护照和信用卡。",
        keywords: [
          {
            label: "出示护照",
            options: [["passport"], ["id"]],
          },
          {
            label: "出示信用卡",
            options: [["credit card"], ["card"]],
          },
          {
            label: "礼貌回应",
            options: [
              ["of course"],
              ["sure"],
              ["here's"],
              ["here is"],
              ["here are"],
            ],
          },
        ],
      },
      {
        speaker: "Receptionist",
        prompt: "You're all set. Anything else I can help you with?",
        promptZh: "您的房间准备好了。还需要其他帮助吗？",
        sample: "Yes, what time's breakfast, and is Wi-Fi free?",
        sampleZh: "有，早餐几点开始？Wi-Fi 免费吗？",
        keywords: [
          {
            label: "询问酒店服务",
            options: [
              ["breakfast"],
              ["wifi"],
              ["gym"],
              ["checkout"],
              ["airport shuttle"],
            ],
          },
          {
            label: "礼貌提问",
            options: [
              ["what time's"],
              ["what time"],
              ["is there"],
              ["could you tell me"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "interview",
    title: "求职面试",
    titleEn: "The Job Interview",
    category: "职场",
    level: "进阶",
    summary: "介绍经历、回答追问并表达求职动机。",
    turns: [
      {
        speaker: "Interviewer",
        prompt: "Thanks for coming in. So, tell me a little about yourself.",
        promptZh: "感谢你来面试。可以先介绍一下自己吗？",
        sample:
          "I'm a product designer with three years of experience in mobile apps.",
        sampleZh: "我是一名产品设计师，有三年移动应用经验。",
        keywords: [
          {
            label: "说明职业",
            options: [
              ["designer"],
              ["engineer"],
              ["manager"],
              ["developer"],
              ["student"],
            ],
          },
          {
            label: "说明经验",
            options: [["experience"], ["years"], ["worked"], ["project"]],
          },
        ],
      },
      {
        speaker: "Interviewer",
        prompt: "What makes you a good fit for this role?",
        promptZh: "哪些经历让你适合这个岗位？",
        sample:
          "I led a project that improved retention by twenty percent.",
        sampleZh: "我曾负责一个项目，把用户留存率提高了百分之二十。",
        keywords: [
          {
            label: "举出具体经历",
            options: [["project"], ["led"], ["built"], ["launched"], ["managed"]],
          },
          {
            label: "说明能力和结果",
            options: [
              ["improved"],
              ["increased"],
              ["reduced"],
              ["result"],
              ["skill"],
            ],
          },
        ],
      },
      {
        speaker: "Interviewer",
        prompt: "So, why do you wanna join our team?",
        promptZh: "你为什么想加入我们公司？",
        sample:
          "I admire your product, and I want to grow with a strong team.",
        sampleZh: "我很欣赏贵公司的产品，也希望和优秀的团队一起成长。",
        keywords: [
          {
            label: "表达对公司的兴趣",
            options: [["product"], ["mission"], ["company"], ["team"]],
          },
          {
            label: "说明个人动机",
            options: [["grow"], ["learn"], ["contribute"], ["opportunity"]],
          },
        ],
      },
    ],
  },
  {
    id: "directions",
    title: "街头问路",
    titleEn: "Asking for Directions",
    category: "出行",
    level: "入门",
    summary: "询问目的地、交通方式并确认路线。",
    turns: [
      {
        speaker: "Local",
        prompt: "Hey, you look a little lost. Where are you headed?",
        promptZh: "你好，你好像在找路。你想去哪里？",
        sample: "I'm trying to find the train station.",
        sampleZh: "我想去火车站。",
        keywords: [
          {
            label: "说明目的地",
            options: [
              ["train station"],
              ["museum"],
              ["hotel"],
              ["airport"],
              ["city center"],
            ],
          },
          {
            label: "询问位置",
            options: [["find"], ["get to"], ["where is"], ["looking for"]],
          },
        ],
      },
      {
        speaker: "Local",
        prompt: "You wanna walk, or would you rather take the subway?",
        promptZh: "你想走路，还是坐地铁？",
        sample: "I'd rather take the subway if it's quicker.",
        sampleZh: "如果更快的话，我更想坐地铁。",
        keywords: [
          {
            label: "选择交通方式",
            options: [["walk"], ["subway"], ["bus"], ["taxi"]],
          },
          {
            label: "比较时间",
            options: [["faster"], ["quicker"], ["how long"], ["time"]],
          },
        ],
      },
      {
        speaker: "Local",
        prompt:
          "Take the number two and hop off at Central Park. Make sense?",
        promptZh: "坐二号线，在中央公园下车。记住了吗？",
        sample:
          "Got it, take the number two and get off at Central Park. Thanks!",
        sampleZh: "好，坐二号线，在中央公园下车。谢谢！",
        keywords: [
          {
            label: "复述路线",
            options: [["line two"], ["number two"], ["central park"]],
          },
          {
            label: "确认理解",
            options: [["got it"], ["i see"], ["yes"], ["understand"]],
          },
          {
            label: "表达感谢",
            options: [["thank you"], ["thanks"]],
          },
        ],
      },
    ],
  },
  {
    id: "doctor",
    title: "医院看诊",
    titleEn: "A Doctor's Visit",
    category: "生活",
    level: "进阶",
    summary: "描述症状、说明持续时间并回答医生问题。",
    turns: [
      {
        speaker: "Doctor",
        prompt: "Come on in and have a seat. What's going on today?",
        promptZh: "请进，坐吧。今天哪里不舒服？",
        sample: "I've got a bad headache and a sore throat.",
        sampleZh: "我头很痛，嗓子也疼。",
        keywords: [
          {
            label: "描述症状",
            options: [
              ["headache"],
              ["sore throat"],
              ["cough"],
              ["fever"],
              ["stomachache"],
            ],
          },
          {
            label: "说明严重程度",
            options: [["bad"], ["terrible"], ["painful"], ["hurts"], ["mild"]],
          },
        ],
      },
      {
        speaker: "Doctor",
        prompt: "How long's that been going on?",
        promptZh: "这些症状持续多久了？",
        sample: "Since Monday, so about three days.",
        sampleZh: "从周一开始的，大约三天了。",
        keywords: [
          {
            label: "说明持续时间",
            options: [["days"], ["weeks"], ["since"], ["yesterday"], ["last night"]],
          },
          {
            label: "给出起始时间",
            options: [["monday"], ["tuesday"], ["weekend"], ["three days"]],
          },
        ],
      },
      {
        speaker: "Doctor",
        prompt: "Any allergies to medicine? And are you taking anything right now?",
        promptZh: "你对药物过敏吗？目前有在服药吗？",
        sample: "No allergies, and I'm just taking vitamins.",
        sampleZh: "我没有过敏，只吃维生素。",
        keywords: [
          {
            label: "说明过敏情况",
            options: [["allergic"], ["no allergies"], ["not allergic"]],
          },
          {
            label: "说明用药情况",
            options: [["taking"], ["medicine"], ["medication"], ["vitamins"]],
          },
        ],
      },
    ],
  },
  {
    id: "small-talk",
    title: "朋友闲聊",
    titleEn: "Catching Up",
    category: "社交",
    level: "入门",
    summary: "问候近况、聊周末安排并自然约见。",
    turns: [
      {
        speaker: "Friend",
        prompt: "Hey! Long time no see. How've you been?",
        promptZh: "嗨！好久不见，你最近怎么样？",
        sample: "Pretty good, just busy with work. How about you?",
        sampleZh: "我挺好的，就是工作有点忙。你呢？",
        keywords: [
          {
            label: "回应近况",
            options: [["good"], ["not bad"], ["busy"], ["great"], ["okay"]],
          },
          {
            label: "反问对方",
            options: [["how about you"], ["what about you"], ["and you"]],
          },
        ],
      },
      {
        speaker: "Friend",
        prompt: "So, what'd you get up to over the weekend?",
        promptZh: "你周末做了什么？",
        sample: "I went hiking with friends and caught a movie.",
        sampleZh: "我和朋友去徒步了，还看了一部电影。",
        keywords: [
          {
            label: "说明周末活动",
            options: [
              ["hiking"],
              ["movie"],
              ["shopping"],
              ["visited"],
              ["stayed home"],
            ],
          },
          {
            label: "补充同行或时间",
            options: [["with friends"], ["family"], ["on saturday"], ["sunday"]],
          },
        ],
      },
      {
        speaker: "Friend",
        prompt: "We should grab coffee sometime. When are you free?",
        promptZh: "我们找时间喝杯咖啡吧。你什么时候有空？",
        sample: "I'm free on Friday afternoon. Does that work for you?",
        sampleZh: "我周五下午有空。你方便吗？",
        keywords: [
          {
            label: "提出时间",
            options: [["friday"], ["weekend"], ["afternoon"], ["tomorrow"]],
          },
          {
            label: "确认对方安排",
            options: [["does that work"], ["works for you"], ["how about"], ["are you free"]],
          },
        ],
      },
    ],
  },
  {
    id: "airport",
    title: "机场值机",
    titleEn: "Airport Check-in",
    category: "出行",
    level: "入门",
    summary: "出示证件、办理托运并询问登机信息。",
    turns: [
      {
        speaker: "Agent",
        prompt: "Good morning. May I see your passport and booking reference?",
        promptZh: "早上好。可以出示您的护照和订票号吗？",
        sample: "Good morning. Here's my passport and my booking reference.",
        sampleZh: "早上好。这是我的护照和订票号。",
        keywords: [
          {
            label: "出示护照",
            options: [["passport"], ["id"]],
          },
          {
            label: "提供订票号",
            options: [["booking reference"], ["booking number"], ["reference"]],
          },
          {
            label: "礼貌回应",
            options: [["here's"], ["here is"], ["sure"], ["of course"]],
          },
        ],
      },
      {
        speaker: "Agent",
        prompt: "Are you checking any bags today?",
        promptZh: "今天有需要托运的行李吗？",
        sample: "Yes, I'd like to check one bag, and I'll keep a carry-on with me.",
        sampleZh: "有的，我想托运一件行李，随身再带一个登机箱。",
        keywords: [
          {
            label: "托运行李",
            options: [
              ["check one bag"],
              ["check a bag"],
              ["check in a bag"],
              ["checked bag"],
            ],
          },
          {
            label: "随身行李",
            options: [["carry-on"], ["carry on"], ["hand luggage"]],
          },
        ],
      },
      {
        speaker: "Agent",
        prompt:
          "Your gate is B12, and boarding starts at 10:40. Any questions?",
        promptZh: "您的登机口是 B12，10:40 开始登机。有什么问题吗？",
        sample:
          "Yes, could you tell me where security is and how long it usually takes?",
        sampleZh: "有，可以告诉我安检口在哪里，一般需要多长时间吗？",
        keywords: [
          {
            label: "询问安检",
            options: [["security"], ["security check"], ["security line"]],
          },
          {
            label: "询问时间",
            options: [["how long"], ["how many minutes"], ["what time"]],
          },
          {
            label: "礼貌提问",
            options: [
              ["could you tell me"],
              ["can you tell me"],
              ["do you know"],
              ["where is"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "shopping",
    title: "商店退换货",
    titleEn: "Returning an Item",
    category: "生活",
    level: "入门",
    summary: "说明退换需求、出示凭证并确认退款方式。",
    turns: [
      {
        speaker: "Assistant",
        prompt: "Hi, how can I help you today?",
        promptZh: "你好，今天需要什么帮助？",
        sample: "Hi, I'd like to return this jacket. I bought it last week.",
        sampleZh: "你好，我想退这件夹克。我上周买的。",
        keywords: [
          {
            label: "说明退换",
            options: [["return"], ["refund"], ["exchange"]],
          },
          {
            label: "说明商品",
            options: [["jacket"], ["shirt"], ["shoes"], ["coat"]],
          },
          {
            label: "说明购买时间",
            options: [
              ["last week"],
              ["yesterday"],
              ["a few days ago"],
              ["last month"],
            ],
          },
        ],
      },
      {
        speaker: "Assistant",
        prompt: "Do you have the receipt with you?",
        promptZh: "您带收据了吗？",
        sample: "Yes, I have the receipt here, and I paid by card.",
        sampleZh: "带了，收据在这里，我是刷卡付款的。",
        keywords: [
          {
            label: "提供收据",
            options: [["receipt"], ["proof of purchase"], ["order number"]],
          },
          {
            label: "说明付款方式",
            options: [["card"], ["cash"], ["apple pay"], ["credit card"]],
          },
        ],
      },
      {
        speaker: "Assistant",
        prompt: "Would you like a refund or store credit?",
        promptZh: "您想退款还是换成店内额度？",
        sample:
          "I'd prefer a refund, please. Also, is there anything I need to sign?",
        sampleZh: "我希望退款，谢谢。另外，有需要我签字的地方吗？",
        keywords: [
          {
            label: "选择方案",
            options: [["refund"], ["store credit"], ["gift card"], ["exchange"]],
          },
          {
            label: "询问手续",
            options: [
              ["need to sign"],
              ["fill in a form"],
              ["fill out a form"],
              ["what next"],
            ],
          },
          {
            label: "礼貌请求",
            options: [["please"], ["i'd prefer"], ["could you"], ["would you"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "renting",
    title: "租房看房",
    titleEn: "Viewing an Apartment",
    category: "生活",
    level: "进阶",
    summary: "说明需求、谈租金押金并检查房屋设施。",
    turns: [
      {
        speaker: "Agent",
        prompt:
          "Thanks for coming. So, what kind of place are you looking for?",
        promptZh: "谢谢你来。你想找什么样的房子？",
        sample: "I'm looking for a one-bedroom apartment near the subway.",
        sampleZh: "我在找一套靠近地铁的一居室。",
        keywords: [
          {
            label: "说明房型",
            options: [
              ["one-bedroom"],
              ["studio"],
              ["two-bedroom"],
              ["shared apartment"],
            ],
          },
          {
            label: "说明位置",
            options: [
              ["near the subway"],
              ["near the station"],
              ["city centre"],
              ["city center"],
            ],
          },
        ],
      },
      {
        speaker: "Agent",
        prompt:
          "The rent is 3,200 yuan a month, and utilities are not included. Does that work for you?",
        promptZh: "房租每月 3200 元，水电另算。这个价格可以接受吗？",
        sample:
          "That's a little high for me. Could you tell me what the deposit is?",
        sampleZh: "对我来说有点贵。可以告诉我押金是多少吗？",
        keywords: [
          {
            label: "回应租金",
            options: [
              ["a little high"],
              ["a bit expensive"],
              ["that works"],
              ["within my budget"],
            ],
          },
          {
            label: "询问押金",
            options: [["deposit"], ["advance payment"], ["agency fee"]],
          },
        ],
      },
      {
        speaker: "Agent",
        prompt:
          "The deposit is one month's rent, and the lease is one year. Anything else?",
        promptZh: "押金是一个月房租，租期一年。还有别的问题吗？",
        sample:
          "Yes, can I see the kitchen and check whether the water pressure is good?",
        sampleZh: "有，我可以看看厨房，顺便检查一下水压好不好吗？",
        keywords: [
          {
            label: "要求看房",
            options: [
              ["see the kitchen"],
              ["see the bathroom"],
              ["look around"],
              ["see the bedroom"],
            ],
          },
          {
            label: "检查设施",
            options: [
              ["water pressure"],
              ["hot water"],
              ["air conditioning"],
              ["heating"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "ielts-part-1",
    title: "雅思 Part 1 日常问答",
    titleEn: "IELTS Speaking Part 1",
    category: "雅思口语",
    level: "Part 1",
    summary: "简短问答日常话题，练习自然展开两三句。",
    turns: [
      {
        speaker: "Examiner",
        prompt:
          "Let's talk about where you live. Do you live in a house or an apartment?",
        promptZh: "我们聊聊你的住所。你住在独栋房子还是公寓里？",
        sample: "I live in an apartment in the city centre with my family.",
        sampleZh: "我和家人住在市中心的一套公寓里。",
        keywords: [
          {
            label: "说明住所",
            options: [["apartment"], ["house"], ["flat"]],
          },
          {
            label: "说明同住情况",
            options: [
              ["with my family"],
              ["on my own"],
              ["with my parents"],
              ["with friends"],
            ],
          },
        ],
      },
      {
        speaker: "Examiner",
        prompt: "What do you like most about your neighbourhood?",
        promptZh: "你最喜欢所在社区的哪一点？",
        sample:
          "I like that it's quiet and convenient, because there are shops and a park nearby.",
        sampleZh: "我喜欢这里安静又方便，因为附近有商店和公园。",
        keywords: [
          {
            label: "描述优点",
            options: [["quiet"], ["convenient"], ["friendly"], ["green"]],
          },
          {
            label: "给出原因",
            options: [["because"], ["since"], ["that's why"], ["as a result"]],
          },
          {
            label: "举例说明",
            options: [["there are"], ["for example"], ["such as"], ["there is"]],
          },
        ],
      },
      {
        speaker: "Examiner",
        prompt: "How long have you lived there?",
        promptZh: "你在那里住了多久？",
        sample:
          "I've lived there for about five years, ever since I started university.",
        sampleZh: "我在那里住了大约五年，从上大学开始就住那儿。",
        keywords: [
          {
            label: "说明时长",
            options: [
              ["for about five years"],
              ["for ten years"],
              ["since 2018"],
              ["for a long time"],
            ],
          },
          {
            label: "使用完成时",
            options: [["i've lived"], ["i have lived"], ["i've been living"]],
          },
        ],
      },
    ],
  },
  {
    id: "ielts-part-2",
    title: "雅思 Part 2 个人陈述",
    titleEn: "IELTS Speaking Part 2",
    category: "雅思口语",
    level: "Part 2",
    summary: "按题卡连续陈述，补充细节并回应追问。",
    turns: [
      {
        speaker: "Examiner",
        prompt:
          "Describe a skill you learned recently. You have one minute to prepare. Start when you're ready.",
        promptZh:
          "请描述一项你最近学会的技能。你有一分钟准备时间，准备好了就开始。",
        sample:
          "I'd like to talk about learning to cook, which I started about six months ago.",
        sampleZh: "我想聊聊学做饭这件事，大约六个月前开始学的。",
        keywords: [
          {
            label: "引入主题",
            options: [
              ["i'd like to talk about"],
              ["i want to talk about"],
              ["i'm going to talk about"],
            ],
          },
          {
            label: "说明时间",
            options: [
              ["six months ago"],
              ["last year"],
              ["a few weeks ago"],
              ["recently"],
            ],
          },
        ],
      },
      {
        speaker: "Examiner",
        prompt: "Who taught you, and why did you choose this skill?",
        promptZh: "是谁教你的？你为什么选择学这项技能？",
        sample:
          "My mother taught me, because I wanted to eat healthier food instead of takeaway.",
        sampleZh:
          "是我妈妈教我的，因为我想吃得更健康，而不是总点外卖。",
        keywords: [
          {
            label: "说明人物",
            options: [["my mother"], ["my friend"], ["a teacher"], ["my brother"]],
          },
          {
            label: "说明原因",
            options: [["because"], ["since"], ["that's why"], ["as"]],
          },
          {
            label: "对比细节",
            options: [["instead of takeaway"], ["rather than"], ["compared with"]],
          },
        ],
      },
      {
        speaker: "Examiner",
        prompt: "How has this skill changed your daily life?",
        promptZh: "这项技能怎样改变了你的日常生活？",
        sample:
          "It has saved me money, and I feel more confident when I invite friends over.",
        sampleZh:
          "它帮我省了钱，而且请朋友来家里吃饭时我更有自信了。",
        keywords: [
          {
            label: "说明影响",
            options: [
              ["saved me money"],
              ["helped me relax"],
              ["changed my routine"],
              ["made me healthier"],
            ],
          },
          {
            label: "加入细节",
            options: [
              ["when i invite friends"],
              ["every weekend"],
              ["after work"],
              ["at home"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "ielts-part-3",
    title: "雅思 Part 3 深入讨论",
    titleEn: "IELTS Speaking Part 3",
    category: "雅思口语",
    level: "Part 3",
    summary: "围绕社会话题展开观点、举例并做出预测。",
    turns: [
      {
        speaker: "Examiner",
        prompt:
          "Why do you think some people find it hard to change their habits?",
        promptZh: "你觉得为什么有些人很难改变习惯？",
        sample:
          "In my view, people struggle because habits give them comfort and changing takes effort.",
        sampleZh:
          "在我看来，人们之所以难以改变，是因为习惯让人感到舒适，而改变需要付出努力。",
        keywords: [
          {
            label: "表达观点",
            options: [
              ["in my view"],
              ["i think"],
              ["it seems to me"],
              ["from my perspective"],
            ],
          },
          {
            label: "给出原因",
            options: [["because"], ["since"], ["due to"], ["as"]],
          },
          {
            label: "补充说明",
            options: [
              ["takes effort"],
              ["hard work"],
              ["need patience"],
              ["not easy"],
            ],
          },
        ],
      },
      {
        speaker: "Examiner",
        prompt:
          "How could schools encourage healthier habits among students?",
        promptZh: "学校可以怎样鼓励学生养成更健康的习惯？",
        sample:
          "Schools could offer more sports clubs, and for example they could teach cooking classes.",
        sampleZh:
          "学校可以提供更多运动社团，比如可以开设烹饪课。",
        keywords: [
          {
            label: "提出建议",
            options: [
              ["could offer"],
              ["should provide"],
              ["might introduce"],
              ["need to give"],
            ],
          },
          {
            label: "举例说明",
            options: [["for example"], ["such as"], ["for instance"]],
          },
        ],
      },
      {
        speaker: "Examiner",
        prompt: "Do you think habits will change in the future? Why?",
        promptZh: "你认为未来人们的习惯会改变吗？为什么？",
        sample:
          "I believe technology will help, but I think people will still need support from their families.",
        sampleZh:
          "我相信科技会有帮助，但我觉得人们仍然需要家人的支持。",
        keywords: [
          {
            label: "表达预测",
            options: [
              ["will help"],
              ["will change"],
              ["are going to"],
              ["i believe"],
            ],
          },
          {
            label: "平衡观点",
            options: [["but"], ["however"], ["on the other hand"], ["still need"]],
          },
        ],
      },
    ],
  },
];
const wordLookupCache = new Map();
let activeWordButton = null;
let wordLookupRequestId = 0;
let practiceRecognition = null;
let practiceMediaRecorder = null;
let practiceMediaStream = null;
let practiceAudioChunks = [];
let practiceApiAbortController = null;
let speechVoiceCache = [];
let freeChatRequestId = 0;
const realtimeVoice = {
  recognition: null,
  silenceTimer: 0,
  restartTimer: 0,
  speechTimer: 0,
  speechToken: 0,
  finalText: "",
  interimText: "",
  restartCount: 0,
  stopRequested: false,
};

const state = {
  resources: [],
  categories: [],
  decks: new Map(),
  activeResourceId: "",
  known: new Set(),
  favorites: new Set(),
  unknown: new Set(),
  view: "all",
  query: "",
  materialQuery: "",
  favoriteCategory: "all",
  ankiExportCategory: "all",
  ankiExportSection: "all",
  ankiExportStatus: "",
  ankiExportStatusType: "",
  showAllMeanings: false,
  meaningReveals: new Set(),
  meaningHides: new Set(),
  user: "",
  practiceActive: false,
  practiceSection: "shadow",
  practiceIndex: 0,
  practiceRate: 0.9,
  practiceVoice: "auto",
  practiceListening: false,
  practiceTranscribing: false,
  practiceTranscript: "",
  practiceFinalTranscript: "",
  practiceInterimTranscript: "",
  practiceStatusText: "准备开始",
  practiceMessage: "",
  practiceMessageType: "",
  practiceResult: null,
  practiceHistory: [],
  practiceRecognitionMode: "browser",
  practiceApiUrl: "",
  practiceApiModel: "",
  practiceApiKey: "",
  practiceApiAuth: "bearer",
  dialogueScenarioId: DIALOGUE_SCENARIOS[0].id,
  dialogueTurnIndex: 0,
  dialogueInput: "",
  dialogueHintVisible: false,
  dialogueMessages: [],
  dialogueResult: null,
  freeTopic: "daily",
  freeAutoSpeak: true,
  freeInput: "",
  freeHintVisible: false,
  freeMessages: [],
  freeTurnCount: 0,
  freeChatMode: "local",
  freeChatLoading: false,
  freeChatApiUrl: "",
  freeChatApiModel: "",
  freeChatApiKey: "",
  freeChatApiAuth: "bearer",
  freeChatApiMessage: "",
  freeChatApiMessageType: "",
  realtimeActive: false,
  realtimePhase: "idle",
  realtimeTranscript: "",
  realtimeMessage: "",
  realtimeMessageType: "",
  freeUsedLines: new Set(),
  reviewActive: false,
  reviewCategory: "all",
  reviewSection: "all",
  reviewNewLimit: 20,
  reviewProgress: {},
  reviewDaily: { date: "", reviewedKeys: [], newKeys: [] },
  reviewQueue: [],
  reviewQueueIndex: 0,
  reviewRevealed: false,
  reviewSessionDone: 0,
  reviewMessage: "",
  reviewMessageType: "",
};

const elements = {
  loginView: document.querySelector("#loginView"),
  loginForm: document.querySelector("#loginForm"),
  loginButton: document.querySelector("#loginButton"),
  loginError: document.querySelector("#loginError"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  appView: document.querySelector("#appView"),
  userLabel: document.querySelector("#userLabel"),
  logoutButton: document.querySelector("#logoutButton"),
  resourceCount: document.querySelector("#resourceCount"),
  materialSearchInput: document.querySelector("#materialSearchInput"),
  resourceList: document.querySelector("#resourceList"),
  activeTitle: document.querySelector("#activeTitle"),
  activeDescription: document.querySelector("#activeDescription"),
  progressRing: document.querySelector("#progressRing"),
  progressPercent: document.querySelector("#progressPercent"),
  progressText: document.querySelector("#progressText"),
  vocabularyToolbar: document.querySelector("#vocabularyToolbar"),
  reviewButton: document.querySelector("#reviewButton"),
  reviewStudio: document.querySelector("#reviewStudio"),
  reviewExitButton: document.querySelector("#reviewExitButton"),
  reviewSource: document.querySelector("#reviewSource"),
  reviewCategory: document.querySelector("#reviewCategory"),
  reviewSection: document.querySelector("#reviewSection"),
  reviewNewLimit: document.querySelector("#reviewNewLimit"),
  reviewRestartButton: document.querySelector("#reviewRestartButton"),
  reviewExportButton: document.querySelector("#reviewExportButton"),
  reviewImportButton: document.querySelector("#reviewImportButton"),
  reviewImportInput: document.querySelector("#reviewImportInput"),
  reviewClearButton: document.querySelector("#reviewClearButton"),
  reviewDueCount: document.querySelector("#reviewDueCount"),
  reviewNewCount: document.querySelector("#reviewNewCount"),
  reviewDoneCount: document.querySelector("#reviewDoneCount"),
  reviewTotalCount: document.querySelector("#reviewTotalCount"),
  reviewCardScope: document.querySelector("#reviewCardScope"),
  reviewCardProgress: document.querySelector("#reviewCardProgress"),
  reviewCardSentence: document.querySelector("#reviewCardSentence"),
  reviewCardPrompt: document.querySelector("#reviewCardPrompt"),
  reviewCardAnswer: document.querySelector("#reviewCardAnswer"),
  reviewCardPhrase: document.querySelector("#reviewCardPhrase"),
  reviewCardPhonetic: document.querySelector("#reviewCardPhonetic"),
  reviewCardMeaning: document.querySelector("#reviewCardMeaning"),
  reviewCardTranslation: document.querySelector("#reviewCardTranslation"),
  reviewSpeakButton: document.querySelector("#reviewSpeakButton"),
  reviewShowButton: document.querySelector("#reviewShowButton"),
  reviewGradeActions: document.querySelector("#reviewGradeActions"),
  reviewGradeButtons: document.querySelectorAll("[data-review-grade]"),
  reviewIntervalAgain: document.querySelector("#reviewIntervalAgain"),
  reviewIntervalHard: document.querySelector("#reviewIntervalHard"),
  reviewIntervalGood: document.querySelector("#reviewIntervalGood"),
  reviewIntervalEasy: document.querySelector("#reviewIntervalEasy"),
  reviewStatus: document.querySelector("#reviewStatus"),
  welcomeOverlay: document.querySelector("#welcomeOverlay"),
  searchInput: document.querySelector("#searchInput"),
  showAllMeaningsButton: document.querySelector("#showAllMeaningsButton"),
  hideAllMeaningsButton: document.querySelector("#hideAllMeaningsButton"),
  ankiExportButton: document.querySelector("#ankiExportButton"),
  ankiExportPanel: document.querySelector("#ankiExportPanel"),
  ankiExportCloseButton: document.querySelector(
    "#ankiExportCloseButton",
  ),
  ankiExportCategory: document.querySelector("#ankiExportCategory"),
  ankiExportSection: document.querySelector("#ankiExportSection"),
  ankiExportCount: document.querySelector("#ankiExportCount"),
  ankiExportScope: document.querySelector("#ankiExportScope"),
  ankiExportDownloadButton: document.querySelector(
    "#ankiExportDownloadButton",
  ),
  ankiExportStatus: document.querySelector("#ankiExportStatus"),
  viewSwitcher: document.querySelector("#viewSwitcher"),
  viewButtons: document.querySelectorAll("[data-view]"),
  collectionFilters: document.querySelector("#collectionFilters"),
  collectionFilterList: document.querySelector("#collectionFilterList"),
  favoriteCount: document.querySelector("#favoriteCount"),
  unknownCount: document.querySelector("#unknownCount"),
  visibleCount: document.querySelector("#visibleCount"),
  cardGrid: document.querySelector("#cardGrid"),
  emptyState: document.querySelector("#emptyState"),
  footerResource: document.querySelector("#footerResource"),
  practiceButton: document.querySelector("#practiceButton"),
  practiceStudio: document.querySelector("#practiceStudio"),
  practiceShadowTab: document.querySelector("#practiceShadowTab"),
  practiceDialogueTab: document.querySelector("#practiceDialogueTab"),
  practiceFreeTab: document.querySelector("#practiceFreeTab"),
  practiceHeading: document.querySelector("#practiceHeading"),
  practiceSource: document.querySelector("#practiceSource"),
  practiceExitButton: document.querySelector("#practiceExitButton"),
  practiceCounter: document.querySelector("#practiceCounter"),
  practiceStatus: document.querySelector("#practiceStatus"),
  practiceTarget: document.querySelector("#practiceTarget"),
  practiceTranslation: document.querySelector("#practiceTranslation"),
  practiceRate: document.querySelector("#practiceRate"),
  practiceVoice: document.querySelector("#practiceVoice"),
  practiceVoiceStatus: document.querySelector("#practiceVoiceStatus"),
  practiceListenButton: document.querySelector("#practiceListenButton"),
  practiceRecordButton: document.querySelector("#practiceRecordButton"),
  practiceStopButton: document.querySelector("#practiceStopButton"),
  practiceRecognitionState: document.querySelector(
    "#practiceRecognitionState",
  ),
  practiceTranscript: document.querySelector("#practiceTranscript"),
  practiceNotice: document.querySelector("#practiceNotice"),
  practiceResult: document.querySelector("#practiceResult"),
  practiceScore: document.querySelector("#practiceScore"),
  practiceFeedback: document.querySelector("#practiceFeedback"),
  practiceTargetDiff: document.querySelector("#practiceTargetDiff"),
  practiceExtraWords: document.querySelector("#practiceExtraWords"),
  practiceRetryButton: document.querySelector("#practiceRetryButton"),
  practiceNextButton: document.querySelector("#practiceNextButton"),
  practicePreviousButton: document.querySelector(
    "#practicePreviousButton",
  ),
  practiceShuffleButton: document.querySelector("#practiceShuffleButton"),
  shadowPracticeView: document.querySelector("#shadowPracticeView"),
  dialoguePracticeView: document.querySelector("#dialoguePracticeView"),
  dialogueScenarioMeta: document.querySelector("#dialogueScenarioMeta"),
  dialogueScenarioList: document.querySelector("#dialogueScenarioList"),
  dialoguePartnerLabel: document.querySelector("#dialoguePartnerLabel"),
  dialogueScenarioTitle: document.querySelector("#dialogueScenarioTitle"),
  dialogueTurnCounter: document.querySelector("#dialogueTurnCounter"),
  dialogueMessages: document.querySelector("#dialogueMessages"),
  dialogueAnswerInput: document.querySelector("#dialogueAnswerInput"),
  dialogueRealtimeButton: document.querySelector("#dialogueRealtimeButton"),
  dialogueRealtimeStatus: document.querySelector("#dialogueRealtimeStatus"),
  dialogueListenButton: document.querySelector("#dialogueListenButton"),
  dialogueHintButton: document.querySelector("#dialogueHintButton"),
  dialogueRecordButton: document.querySelector("#dialogueRecordButton"),
  dialogueStopButton: document.querySelector("#dialogueStopButton"),
  dialogueSubmitButton: document.querySelector("#dialogueSubmitButton"),
  dialogueHint: document.querySelector("#dialogueHint"),
  dialogueNotice: document.querySelector("#dialogueNotice"),
  dialogueResult: document.querySelector("#dialogueResult"),
  dialogueScore: document.querySelector("#dialogueScore"),
  dialogueFeedback: document.querySelector("#dialogueFeedback"),
  dialogueKeyPoints: document.querySelector("#dialogueKeyPoints"),
  dialogueCoachLevel: document.querySelector("#dialogueCoachLevel"),
  dialogueCoachMessage: document.querySelector("#dialogueCoachMessage"),
  dialogueCoachTips: document.querySelector("#dialogueCoachTips"),
  dialogueCoachTask: document.querySelector("#dialogueCoachTask"),
  dialogueSampleAnswer: document.querySelector("#dialogueSampleAnswer"),
  dialogueRetryButton: document.querySelector("#dialogueRetryButton"),
  dialogueNextButton: document.querySelector("#dialogueNextButton"),
  freePracticeView: document.querySelector("#freePracticeView"),
  freeModeSummary: document.querySelector("#freeModeSummary"),
  freeTurnCounter: document.querySelector("#freeTurnCounter"),
  freeTopic: document.querySelector("#freeTopic"),
  freeAutoSpeak: document.querySelector("#freeAutoSpeak"),
  freeRestartButton: document.querySelector("#freeRestartButton"),
  freeMessages: document.querySelector("#freeMessages"),
  freeAnswerInput: document.querySelector("#freeAnswerInput"),
  freeRealtimeButton: document.querySelector("#freeRealtimeButton"),
  freeRealtimeStatus: document.querySelector("#freeRealtimeStatus"),
  freeListenButton: document.querySelector("#freeListenButton"),
  freeHintButton: document.querySelector("#freeHintButton"),
  freeRecordButton: document.querySelector("#freeRecordButton"),
  freeStopButton: document.querySelector("#freeStopButton"),
  freeSubmitButton: document.querySelector("#freeSubmitButton"),
  freeHint: document.querySelector("#freeHint"),
  freeNotice: document.querySelector("#freeNotice"),
  freeServiceSettings: document.querySelector("#freeServiceSettings"),
  freeChatModeStatus: document.querySelector("#freeChatModeStatus"),
  freeChatMode: document.querySelector("#freeChatMode"),
  freeChatApiFields: document.querySelector("#freeChatApiFields"),
  freeChatApiUrl: document.querySelector("#freeChatApiUrl"),
  freeChatApiModel: document.querySelector("#freeChatApiModel"),
  freeChatApiKey: document.querySelector("#freeChatApiKey"),
  freeChatApiAuth: document.querySelector("#freeChatApiAuth"),
  freeChatApiSaveButton: document.querySelector("#freeChatApiSaveButton"),
  freeChatApiStatus: document.querySelector("#freeChatApiStatus"),
  practiceClearButton: document.querySelector("#practiceClearButton"),
  practiceModeStatus: document.querySelector("#practiceModeStatus"),
  practiceMode: document.querySelector("#practiceMode"),
  practiceApiFields: document.querySelector("#practiceApiFields"),
  practiceApiUrl: document.querySelector("#practiceApiUrl"),
  practiceApiModel: document.querySelector("#practiceApiModel"),
  practiceApiKey: document.querySelector("#practiceApiKey"),
  practiceApiAuth: document.querySelector("#practiceApiAuth"),
  practiceApiSaveButton: document.querySelector(
    "#practiceApiSaveButton",
  ),
  practiceApiStatus: document.querySelector("#practiceApiStatus"),
  practiceAttemptCount: document.querySelector("#practiceAttemptCount"),
  practiceSentenceCount: document.querySelector("#practiceSentenceCount"),
  practiceAverageScore: document.querySelector("#practiceAverageScore"),
  practiceBestScore: document.querySelector("#practiceBestScore"),
  practiceHistory: document.querySelector("#practiceHistory"),
  wordPopover: document.querySelector("#wordPopover"),
  wordPopoverWord: document.querySelector("#wordPopoverWord"),
  wordPopoverPhonetic: document.querySelector("#wordPopoverPhonetic"),
  wordPopoverContent: document.querySelector("#wordPopoverContent"),
  wordPopoverClose: document.querySelector("#wordPopoverClose"),
};

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN");
}

function compareCategoryNames(left, right) {
  const leftIndex = CATEGORY_ORDER.indexOf(left);
  const rightIndex = CATEGORY_ORDER.indexOf(right);

  if (leftIndex >= 0 && rightIndex >= 0) {
    return leftIndex - rightIndex;
  }
  if (leftIndex >= 0) {
    return -1;
  }
  if (rightIndex >= 0) {
    return 1;
  }
  return left.localeCompare(right, "zh-CN");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((item) => item.some((value) => value.length > 0));
}

function extractAnnotation(back) {
  const groups = [...String(back || "").matchAll(/（([^（）]+)）/g)];
  if (groups.length === 0) {
    return null;
  }

  const annotation = groups.at(-1)[1].trim();
  const firstPart = annotation.split(/[，,]/)[0].trim();
  const equalsIndex = firstPart.indexOf("=");

  if (equalsIndex < 0) {
    return null;
  }

  const phrase = firstPart.slice(0, equalsIndex).trim();
  const remainder = firstPart.slice(equalsIndex + 1).trim();
  const phoneticMatch = remainder.match(/^(.*?)\s*\/([^/]+)\//);

  return {
    phrase,
    meaning: phoneticMatch ? phoneticMatch[1].trim() : remainder,
    phonetic: phoneticMatch ? `/${phoneticMatch[2].trim()}/` : "",
    fullMatch: groups.at(-1)[0],
  };
}

function normalizeCsvHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim();
}

function findVocabularyHeaderRow(rows) {
  return rows.findIndex((row) => {
    const headers = row.map(normalizeCsvHeader);
    return (
      headers.includes("单词") &&
      (headers.includes("中文释义") ||
        headers.includes("英文例句") ||
        headers.includes("例句"))
    );
  });
}

function cleanVocabularyText(value) {
  return String(value || "")
    .replace(/\s*\d*\s*<<\s*零基础词汇讲义Level\s*\d+/gi, " ")
    .replace(/线｜教研团队/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeEmbeddedVocabularyCard(value) {
  const marker =
    /\s+\d{1,4}\s*\.\s*[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3}\s+\/[^/\n]+\//;
  const match = marker.exec(value);
  return match ? value.slice(0, match.index) : value;
}

function splitVocabularyExample(value) {
  const englishParts = [];
  const chineseParts = [];
  const segments = String(value || "")
    .split(/\s*\|\s*/)
    .map((segment) => removeEmbeddedVocabularyCard(segment).trim())
    .filter(Boolean);

  segments.forEach((segment) => {
    const chineseIndex = segment.search(/[\u3400-\u9fff]/);
    const rawEnglish =
      chineseIndex >= 0 ? segment.slice(0, chineseIndex) : segment;
    const rawChinese = chineseIndex >= 0 ? segment.slice(chineseIndex) : "";
    const english = cleanVocabularyText(rawEnglish).replace(
      /^[\s,;:.!?-]+|[\s,;:|-]+$/g,
      "",
    );
    const chinese = cleanVocabularyText(rawChinese);

    if (english) {
      englishParts.push(english);
    }
    if (chinese) {
      chineseParts.push(chinese);
    }
  });

  return {
    sentence: englishParts.join(" | "),
    translation: chineseParts.join(" | "),
  };
}

function parseVocabularyDeck(rows, headerIndex, resource, index) {
  const headers = rows[headerIndex].map(normalizeCsvHeader);
  const findColumn = (...names) =>
    headers.findIndex((header) => names.includes(header));
  const phraseIndex = findColumn("单词", "词/短语", "Front");
  const phoneticIndex = findColumn("音标", "IPA");
  const partOfSpeechIndex = findColumn("词性");
  const meaningIndex = findColumn("中文释义", "释义", "Back");
  const sentenceIndex = findColumn("英文例句", "例句");

  if (phraseIndex < 0) {
    return [];
  }

  return rows
    .slice(headerIndex + 1)
    .map((row, itemIndex) => {
      const phrase = cleanVocabularyText(row[phraseIndex]);
      if (!phrase || findVocabularyHeaderRow([row]) === 0) {
        return null;
      }

      const partOfSpeech = cleanVocabularyText(row[partOfSpeechIndex]);
      const meaning = cleanVocabularyText(row[meaningIndex]);
      const example = splitVocabularyExample(row[sentenceIndex]);
      const combinedMeaning = [partOfSpeech, meaning]
        .filter(Boolean)
        .join(" ");

      return {
        id: `${resource.id}:${index + 1}:${itemIndex + 1}`,
        phrase,
        phonetic: cleanVocabularyText(row[phoneticIndex]),
        meaning: combinedMeaning || "查看例句理解用法",
        sentence: example.sentence || phrase,
        translation: example.translation,
      };
    })
    .filter(Boolean);
}

function parseAnkiDeck(text, resource, index) {
  const metadata = {};
  const dataRows = [];
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const vocabularyHeaderIndex = findVocabularyHeaderRow(rows);

  if (vocabularyHeaderIndex >= 0) {
    return parseVocabularyDeck(
      rows,
      vocabularyHeaderIndex,
      resource,
      index,
    );
  }

  rows.forEach((row) => {
    if (row[0]?.startsWith("#")) {
      const separatorIndex = row[0].indexOf(":");
      if (separatorIndex > 0) {
        metadata[row[0].slice(0, separatorIndex)] = row[0]
          .slice(separatorIndex + 1)
          .trim();
      }
      return;
    }
    dataRows.push(row);
  });

  const columns = String(metadata["#columns"] || "Front,Back")
    .split(",")
    .map((column) => column.trim());
  const frontIndex = Math.max(0, columns.indexOf("Front"));
  const backIndex = Math.max(1, columns.indexOf("Back"));

  return dataRows
    .map((row, itemIndex) => {
      const sentence = String(row[frontIndex] || "").trim();
      const back = String(row[backIndex] || "").trim();
      if (!sentence && !back) {
        return null;
      }

      const annotation = extractAnnotation(back);
      const translation = annotation
        ? back.replace(annotation.fullMatch, "").trim()
        : back;
      const phrase = annotation?.phrase || sentence || `词汇 ${itemIndex + 1}`;

      return {
        id: `${resource.id}:${index + 1}:${itemIndex + 1}`,
        phrase,
        phonetic: annotation?.phonetic || "",
        meaning: annotation?.meaning || "查看原句理解用法",
        sentence,
        translation,
      };
    })
    .filter(Boolean);
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((value) => value.trim().replace(/\*\*(.*?)\*\*/g, "$1"));
}

function parseMarkdownDeck(text, resource, index) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    if (!/^\|.*\|$/.test(line.trim())) {
      return false;
    }
    const headers = splitMarkdownRow(line);
    return headers.includes("#") && headers.includes("词/短语");
  });

  if (headerIndex < 0) {
    return [];
  }

  const headers = splitMarkdownRow(lines[headerIndex]);
  const findColumn = (...names) =>
    headers.findIndex((header) => names.includes(header));
  const phraseIndex = findColumn("词/短语");
  const meaningIndex = findColumn("释义");
  const phoneticIndex = findColumn("IPA", "音标");
  const sentenceIndex = findColumn("英文原句");
  const translationIndex = findColumn("译句");

  return lines
    .slice(headerIndex + 2)
    .filter((line) => /^\|/.test(line.trim()))
    .map((line, itemIndex) => {
      const row = splitMarkdownRow(line);
      const phrase = String(row[phraseIndex] || "").trim();
      const sentence = String(row[sentenceIndex] || "").trim();
      if (!phrase && !sentence) {
        return null;
      }

      return {
        id: `${resource.id}:${index + 1}:${itemIndex + 1}`,
        phrase: phrase || sentence,
        phonetic: String(row[phoneticIndex] || "").trim(),
        meaning: String(row[meaningIndex] || "").trim() || "查看原句理解用法",
        sentence,
        translation: String(row[translationIndex] || "").trim(),
      };
    })
    .filter(Boolean);
}

function parseDeck(text, resource, index) {
  if (resource.attachment) {
    return [];
  }
  if (resource.format === "markdown-table") {
    return parseMarkdownDeck(text, resource, index);
  }
  return parseAnkiDeck(text, resource, index);
}

function restoreSet(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (Array.isArray(stored)) {
      return new Set(stored);
    }
  } catch {
    return new Set();
  }
  return new Set();
}

function persistSet(storageKey, values) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...values]));
  } catch {
    // Marks still work for the current visit when storage is unavailable.
  }
}

function restoreMarks() {
  state.known = restoreSet(STORAGE_KEY);
  state.favorites = restoreSet(FAVORITES_STORAGE_KEY);
  state.unknown = restoreSet(UNKNOWN_STORAGE_KEY);
}

function restorePracticeHistory() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(PRACTICE_HISTORY_STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(stored)) {
      return;
    }

    state.practiceHistory = stored
      .filter(
        (record) =>
          record &&
          Number.isFinite(record.accuracy) &&
          typeof record.target === "string",
      )
      .slice(0, 80);
  } catch {
    state.practiceHistory = [];
  }
}

function persistPracticeHistory() {
  try {
    localStorage.setItem(
      PRACTICE_HISTORY_STORAGE_KEY,
      JSON.stringify(state.practiceHistory.slice(0, 80)),
    );
  } catch {
    // Practice still works for the current visit when storage is unavailable.
  }
}

function restorePracticeSettings() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(PRACTICE_SETTINGS_STORAGE_KEY) || "{}",
    );
    const allowedModes = new Set(["browser", "api", "off"]);
    const allowedAuthModes = new Set(["bearer", "x-api-key", "none"]);
    const allowedVoicePreferences = new Set([
      "auto",
      "female",
      "male",
      "device",
    ]);
    const allowedFreeChatModes = new Set(["local", "api", "off"]);

    state.practiceRecognitionMode = allowedModes.has(stored.mode)
      ? stored.mode
      : "browser";
    state.practiceVoice = allowedVoicePreferences.has(stored.voice)
      ? stored.voice
      : "auto";
    state.practiceApiUrl = String(stored.apiUrl || "").trim();
    state.practiceApiModel = String(stored.apiModel || "").trim();
    state.practiceApiKey = String(stored.apiKey || "").trim();
    state.practiceApiAuth = allowedAuthModes.has(stored.apiAuth)
      ? stored.apiAuth
      : "bearer";
    state.freeChatMode = allowedFreeChatModes.has(stored.freeChatMode)
      ? stored.freeChatMode
      : "local";
    state.freeChatApiUrl = String(stored.freeChatApiUrl || "").trim();
    state.freeChatApiModel = String(stored.freeChatApiModel || "").trim();
    state.freeChatApiKey = String(stored.freeChatApiKey || "").trim();
    state.freeChatApiAuth = allowedAuthModes.has(stored.freeChatApiAuth)
      ? stored.freeChatApiAuth
      : "bearer";
    state.freeAutoSpeak = stored.freeAutoSpeak !== false;
    state.freeTopic = FREE_CHAT_TOPICS[stored.freeTopic]
      ? stored.freeTopic
      : "daily";
  } catch {
    state.practiceRecognitionMode = "browser";
    state.practiceVoice = "auto";
    state.practiceApiUrl = "";
    state.practiceApiModel = "";
    state.practiceApiKey = "";
    state.practiceApiAuth = "bearer";
    state.freeChatMode = "local";
    state.freeChatApiUrl = "";
    state.freeChatApiModel = "";
    state.freeChatApiKey = "";
    state.freeChatApiAuth = "bearer";
    state.freeAutoSpeak = true;
    state.freeTopic = "daily";
  }
}

function persistPracticeSettings() {
  try {
    localStorage.setItem(
      PRACTICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        mode: state.practiceRecognitionMode,
        voice: state.practiceVoice,
        apiUrl: state.practiceApiUrl,
        apiModel: state.practiceApiModel,
        apiKey: state.practiceApiKey,
        apiAuth: state.practiceApiAuth,
        freeChatMode: state.freeChatMode,
        freeChatApiUrl: state.freeChatApiUrl,
        freeChatApiModel: state.freeChatApiModel,
        freeChatApiKey: state.freeChatApiKey,
        freeChatApiAuth: state.freeChatApiAuth,
        freeAutoSpeak: state.freeAutoSpeak,
        freeTopic: state.freeTopic,
      }),
    );
  } catch {
    // Settings still apply for the current visit when storage is unavailable.
  }
}

function getActiveResource() {
  return state.resources.find(
    (resource) => resource.id === state.activeResourceId,
  );
}

function getActiveItems() {
  return state.decks.get(state.activeResourceId) || [];
}

function getItemKey(resourceId, item) {
  return `${resourceId}:${item.id}`;
}

function isMeaningVisible(itemKey) {
  return state.showAllMeanings
    ? !state.meaningHides.has(itemKey)
    : state.meaningReveals.has(itemKey);
}

function setAllMeaningsVisible(visible) {
  state.showAllMeanings = visible;
  state.meaningReveals.clear();
  state.meaningHides.clear();
  render();
}

function getCollectionEntries(collection, category = "all") {
  return state.resources
    .filter(
      (resource) => category === "all" || resource.category === category,
    )
    .flatMap((resource) =>
      (state.decks.get(resource.id) || [])
        .filter((item) =>
          collection.has(getItemKey(resource.id, item)),
        )
        .map((item) => ({ item, resource })),
    );
}

function getBaseEntries() {
  if (state.view === "favorites") {
    return getCollectionEntries(state.favorites, state.favoriteCategory);
  }
  if (state.view === "unknown") {
    return getCollectionEntries(state.unknown);
  }

  const resource = getActiveResource();
  return resource
    ? getActiveItems().map((item) => ({ item, resource }))
    : [];
}

function getVisibleEntries() {
  const query = normalizeText(state.query).trim();
  const entries = getBaseEntries();

  if (!query) {
    return entries;
  }

  return entries.filter(({ item }) => {
    const searchable = [
      item.phrase,
      item.phonetic,
      item.meaning,
      item.sentence,
      item.translation,
    ].join(" ");
    return normalizeText(searchable).includes(query);
  });
}

function normalizeVoiceText(value) {
  return String(value || "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getVoiceLocale(voice) {
  return String(voice?.lang || "")
    .toLocaleLowerCase("en-US")
    .replace("_", "-");
}

function isAmericanEnglishVoice(voice) {
  const locale = getVoiceLocale(voice);
  return locale === "en-us" || locale.startsWith("en-us-");
}

function getVoiceNameRank(voiceName, names) {
  const normalizedName = normalizeVoiceText(voiceName);
  return names.findIndex((name) => normalizedName.includes(name));
}

function scoreSpeechVoice(voice, genderPreference = "") {
  const locale = getVoiceLocale(voice);
  if (!locale.startsWith("en")) {
    return Number.NEGATIVE_INFINITY;
  }

  const voiceName = normalizeVoiceText(voice?.name);
  const naturalHintScore = NATURAL_VOICE_HINTS.reduce(
    (score, hint, index) =>
      voiceName.includes(hint) ? score + 42 - index * 4 : score,
    0,
  );
  let score = locale === "en-us" || locale.startsWith("en-us-") ? 120 : 24;

  score += naturalHintScore;
  if (voiceName.includes("google us english")) {
    score += 58;
  }
  if (voiceName.includes("siri")) {
    score += 36;
  }
  if (voice?.default) {
    score += 6;
  }

  if (genderPreference === "female" || genderPreference === "male") {
    const preferredRank = getVoiceNameRank(
      voiceName,
      AMERICAN_VOICE_NAMES[genderPreference],
    );
    const otherGender = genderPreference === "female" ? "male" : "female";
    const otherRank = getVoiceNameRank(
      voiceName,
      AMERICAN_VOICE_NAMES[otherGender],
    );

    if (preferredRank >= 0) {
      score += 92 - preferredRank * 5;
    }
    if (otherRank >= 0) {
      score -= 48;
    }
  }

  return score;
}

function refreshSpeechVoiceCache() {
  if (!("speechSynthesis" in window)) {
    speechVoiceCache = [];
    return speechVoiceCache;
  }

  speechVoiceCache = Array.from(window.speechSynthesis.getVoices() || []);
  return speechVoiceCache;
}

function getPreferredSpeechVoice(preference = "auto", profile = null) {
  if (!speechVoiceCache.length) {
    refreshSpeechVoiceCache();
  }
  if (!speechVoiceCache.length) {
    return null;
  }

  if (preference === "device") {
    return (
      speechVoiceCache.find((voice) => voice.default) ||
      speechVoiceCache.find(isAmericanEnglishVoice) ||
      speechVoiceCache.find(
        (voice) => getVoiceLocale(voice).startsWith("en"),
      ) ||
      speechVoiceCache[0]
    );
  }

  const genderPreference =
    preference === "female" || preference === "male"
      ? preference
      : profile?.gender || "";
  const rankedVoices = speechVoiceCache
    .map((voice, index) => ({
      voice,
      index,
      score: scoreSpeechVoice(voice, genderPreference),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  return rankedVoices[0]?.voice || speechVoiceCache[0];
}

function getPracticeVoiceStatusText() {
  if (!("speechSynthesis" in window)) {
    return "当前浏览器不支持语音朗读。";
  }

  if (!speechVoiceCache.length) {
    refreshSpeechVoiceCache();
  }
  if (!speechVoiceCache.length) {
    return "正在读取设备声线；播放时会自动选择美式英语。";
  }

  const profile =
    state.practiceSection === "dialogue"
      ? DIALOGUE_SPEAKER_VOICE_PROFILES[
          getCurrentDialogueTurn()?.speaker || ""
        ]
      : state.practiceSection === "free"
        ? FREE_CHAT_COACH_PROFILE
      : null;
  const voice = getPreferredSpeechVoice(state.practiceVoice, profile);
  if (!voice) {
    return "未找到英语声线，将使用设备默认声音。";
  }

  if (!isAmericanEnglishVoice(voice)) {
    return `未找到 en-US 声线，暂用 ${voice.name}。`;
  }

  const voiceName = normalizeVoiceText(voice.name);
  const isNatural = NATURAL_VOICE_HINTS.some((hint) =>
    voiceName.includes(hint),
  );
  return `当前声线：${voice.name}${isNatural ? " · 自然音色" : ""}`;
}

function createSpeechUtterance(text, rate = 0.9, options = {}) {
  const profile = options.profile || null;
  const voice = getPreferredSpeechVoice(
    options.voicePreference || state.practiceVoice,
    profile,
  );
  const rateScale = Number(options.rateScale) || 1;
  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = voice?.lang || "en-US";
  if (voice) {
    utterance.voice = voice;
  }
  utterance.rate = Math.min(
    1.3,
    Math.max(0.5, (Number(rate) || 0.9) * rateScale),
  );
  utterance.pitch = Math.min(
    1.25,
    Math.max(0.75, Number(options.pitch) || 1),
  );
  utterance.volume = 1;
  return utterance;
}

function speak(text, rate = 0.9, options = {}) {
  if (!("speechSynthesis" in window)) {
    return false;
  }

  const utterance = createSpeechUtterance(text, rate, options);
  if (typeof options.onStart === "function") {
    utterance.onstart = options.onStart;
  }
  if (typeof options.onEnd === "function") {
    utterance.onend = options.onEnd;
  }
  if (typeof options.onError === "function") {
    utterance.onerror = options.onError;
  }

  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);
  return utterance;
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function getRealtimeSection() {
  return state.practiceSection === "free" ? "free" : "dialogue";
}

function isRealtimeSectionActive(section) {
  return state.realtimeActive && getRealtimeSection() === section;
}

function getRealtimeSupport() {
  if (!("speechSynthesis" in window)) {
    return {
      supported: false,
      message: "当前浏览器不支持语音朗读，实时对话不可用，可继续用文字练习。",
    };
  }

  if (state.practiceRecognitionMode === "off") {
    return {
      supported: false,
      message: "语音识别已关闭，实时对话需要浏览器免费识别。",
    };
  }

  if (state.practiceRecognitionMode !== "browser") {
    return {
      supported: false,
      message: "实时对话使用浏览器免费识别，请把识别方式切换为“浏览器免费”。",
    };
  }

  if (!getSpeechRecognitionConstructor()) {
    return {
      supported: false,
      message: "当前浏览器不支持连续语音识别，请使用最新版 Chrome、Edge 或 Safari。",
    };
  }

  return { supported: true, message: "" };
}

function setRealtimePhase(phase, message = "") {
  state.realtimePhase = phase;
  state.realtimeMessage = message;
  state.realtimeMessageType = phase === "error" ? "error" : "";

  if (phase === "listening") {
    state.practiceStatusText = "实时聆听";
  } else if (phase === "thinking") {
    state.practiceStatusText = "正在准备回应";
  } else if (phase === "speaking") {
    state.practiceStatusText = "正在朗读回应";
  }

  renderPracticeView();
}

function getRealtimeStatusText(section) {
  const support = getRealtimeSupport();
  if (!isRealtimeSectionActive(section)) {
    if (!support.supported) {
      return support.message;
    }
    return state.realtimeMessage || "未开启";
  }

  if (state.realtimePhase === "thinking") {
    return state.realtimeMessage || "正在理解你的表达…";
  }
  if (state.realtimePhase === "speaking") {
    return state.realtimeMessage || "正在用美音回应…";
  }
  if (state.realtimePhase === "listening") {
    return state.realtimeTranscript
      ? "正在聆听 · 已识别到语音"
      : "正在聆听 · 说完停顿一下自动发送";
  }
  return state.realtimeMessage || "未开启";
}

function renderRealtimeBar(section) {
  const isFree = section === "free";
  const button = isFree
    ? elements.freeRealtimeButton
    : elements.dialogueRealtimeButton;
  const status = isFree
    ? elements.freeRealtimeStatus
    : elements.dialogueRealtimeStatus;
  if (!button || !status) {
    return;
  }

  const support = getRealtimeSupport();
  const active = isRealtimeSectionActive(section);
  const phase = active ? state.realtimePhase : "idle";

  button.textContent = active ? "结束实时对话" : "开始实时对话";
  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("is-active", active);
  button.disabled = !active && !support.supported;
  button.dataset.phase = phase;

  status.dataset.phase = phase;
  status.classList.toggle("is-error", !active && !support.supported);
  status.textContent = getRealtimeStatusText(section);
}

function stopRealtimeRecognition() {
  const recognition = realtimeVoice.recognition;
  realtimeVoice.recognition = null;
  if (!recognition) {
    return;
  }

  recognition.onstart = null;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  try {
    recognition.abort();
  } catch {
    // The recognition session may already have ended.
  }
}

function clearRealtimeTimers() {
  clearTimeout(realtimeVoice.silenceTimer);
  clearTimeout(realtimeVoice.restartTimer);
  clearTimeout(realtimeVoice.speechTimer);
  realtimeVoice.silenceTimer = 0;
  realtimeVoice.restartTimer = 0;
  realtimeVoice.speechTimer = 0;
}

function stopRealtimeConversation(message = "", { silent = false } = {}) {
  const wasActive = state.realtimeActive;

  realtimeVoice.stopRequested = true;
  realtimeVoice.restartCount = 0;
  realtimeVoice.speechToken += 1;
  clearRealtimeTimers();
  stopRealtimeRecognition();

  if ((!silent || wasActive) && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  state.realtimeActive = false;
  state.realtimePhase = "idle";
  state.realtimeTranscript = "";
  state.realtimeMessage = message;
  state.realtimeMessageType = "";
  state.practiceTranscript = "";
  state.practiceFinalTranscript = "";
  state.practiceInterimTranscript = "";
  realtimeVoice.finalText = "";
  realtimeVoice.interimText = "";

  if (wasActive) {
    state.practiceStatusText = "准备开始";
    renderPracticeView();
  }

  return wasActive;
}

function getDialogueSpeechOptions(turn) {
  const profile = DIALOGUE_SPEAKER_VOICE_PROFILES[turn?.speaker] || {};
  return {
    profile,
    pitch: profile.pitch,
    rateScale: profile.rateScale,
    voicePreference: state.practiceVoice,
    rate: 0.9,
  };
}

function getFreeSpeechOptions() {
  return {
    profile: FREE_CHAT_COACH_PROFILE,
    pitch: FREE_CHAT_COACH_PROFILE.pitch,
    rateScale: FREE_CHAT_COACH_PROFILE.rateScale,
    voicePreference: state.practiceVoice,
    rate: 0.94,
  };
}

function speakRealtime(text, options = {}, onDone = null) {
  const speakable = String(text || "").trim();
  if (!state.realtimeActive || !speakable) {
    return false;
  }
  if (!("speechSynthesis" in window)) {
    if (typeof onDone === "function") {
      onDone();
    }
    return false;
  }

  const utterance = createSpeechUtterance(speakable, options.rate || 0.92, options);
  const token = realtimeVoice.speechToken + 1;
  realtimeVoice.speechToken = token;
  realtimeVoice.speechTimer = 0;
  let finished = false;

  const finish = () => {
    if (finished || realtimeVoice.speechToken !== token) {
      return;
    }
    finished = true;
    clearTimeout(realtimeVoice.speechTimer);
    realtimeVoice.speechTimer = window.setTimeout(() => {
      realtimeVoice.speechTimer = 0;
      if (!state.realtimeActive || realtimeVoice.speechToken !== token) {
        return;
      }
      if (typeof onDone === "function") {
        onDone();
      }
    }, REALTIME_SPEECH_TAIL_MS);
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  window.speechSynthesis.speak(utterance);

  const words = speakable.split(/\s+/).filter(Boolean).length;
  const estimated =
    (words / Math.max(1.1, 2.4 * utterance.rate)) * 1000 + 3000;
  realtimeVoice.speechTimer = window.setTimeout(
    finish,
    Math.min(45000, Math.max(8000, estimated)),
  );
  return true;
}

function restartRealtimeRecognitionSoon(delay = REALTIME_RESTART_DELAY_MS) {
  clearTimeout(realtimeVoice.restartTimer);
  realtimeVoice.restartTimer = window.setTimeout(() => {
    realtimeVoice.restartTimer = 0;
    if (!state.realtimeActive || realtimeVoice.stopRequested) {
      return;
    }
    if (state.realtimePhase !== "listening") {
      return;
    }
    startRealtimeRecognition();
  }, delay);
}

function scheduleRealtimeCommit() {
  clearTimeout(realtimeVoice.silenceTimer);
  const wordCount = String(state.realtimeTranscript || "")
    .split(/\s+/)
    .filter(Boolean).length;
  const delay = Math.min(2600, REALTIME_SILENCE_MS + wordCount * 60);
  realtimeVoice.silenceTimer = window.setTimeout(() => {
    realtimeVoice.silenceTimer = 0;
    commitRealtimeUtterance();
  }, delay);
}

function collectRealtimeTranscript(event) {
  let interimText = "";
  const startIndex = Number.isInteger(event.resultIndex) ? event.resultIndex : 0;

  for (let index = startIndex; index < event.results.length; index += 1) {
    const transcript = event.results[index]?.[0]?.transcript || "";
    if (event.results[index]?.isFinal) {
      realtimeVoice.finalText =
        `${realtimeVoice.finalText} ${transcript}`.trim();
    } else {
      interimText = `${interimText} ${transcript}`.trim();
    }
  }

  realtimeVoice.interimText = interimText;
  state.realtimeTranscript =
    `${realtimeVoice.finalText} ${realtimeVoice.interimText}`.trim();

  if (!state.realtimeTranscript) {
    renderPracticeView();
    return;
  }

  scheduleRealtimeCommit();
  renderPracticeView();
}

function startRealtimeRecognition() {
  if (!state.realtimeActive || realtimeVoice.stopRequested) {
    return;
  }

  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    state.practiceMessage =
      "当前浏览器不支持连续语音识别，请使用最新版 Chrome、Edge 或 Safari。";
    state.practiceMessageType = "error";
    stopRealtimeConversation("实时对话不可用。");
    return;
  }

  stopRealtimeRecognition();
  clearTimeout(realtimeVoice.silenceTimer);
  realtimeVoice.silenceTimer = 0;
  realtimeVoice.finalText = "";
  realtimeVoice.interimText = "";
  state.realtimeTranscript = "";

  const recognition = new Recognition();
  realtimeVoice.recognition = recognition;
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (realtimeVoice.recognition !== recognition) {
      return;
    }
    realtimeVoice.restartCount = 0;
    state.realtimeMessage = "";
    state.realtimeMessageType = "";
    renderPracticeView();
  };

  recognition.onresult = (event) => {
    if (realtimeVoice.recognition !== recognition) {
      return;
    }
    collectRealtimeTranscript(event);
  };

  recognition.onerror = (event) => {
    if (realtimeVoice.recognition !== recognition) {
      return;
    }

    const errorType = String(event?.error || "");
    if (errorType === "aborted") {
      return;
    }
    if (errorType === "no-speech") {
      realtimeVoice.restartCount += 1;
      return;
    }
    if (errorType === "not-allowed" || errorType === "service-not-allowed") {
      state.practiceMessage =
        "麦克风权限未开启，请在地址栏允许麦克风后重新开始实时对话。";
      state.practiceMessageType = "error";
      stopRealtimeConversation("麦克风权限未开启。");
      return;
    }

    realtimeVoice.restartCount += 1;
    state.realtimeMessage = getRecognitionErrorMessage(errorType);
    state.realtimeMessageType = "error";
    if (realtimeVoice.restartCount > REALTIME_MAX_RESTARTS) {
      stopRealtimeConversation("语音识别多次中断，已结束实时对话。");
      return;
    }
    renderPracticeView();
  };

  recognition.onend = () => {
    if (realtimeVoice.recognition !== recognition) {
      return;
    }
    realtimeVoice.recognition = null;
    if (!state.realtimeActive || realtimeVoice.stopRequested) {
      return;
    }
    if (state.realtimePhase !== "listening") {
      return;
    }
    if (state.realtimeTranscript) {
      commitRealtimeUtterance();
      return;
    }
    restartRealtimeRecognitionSoon();
  };

  try {
    recognition.start();
  } catch {
    realtimeVoice.recognition = null;
    realtimeVoice.restartCount += 1;
    if (realtimeVoice.restartCount > REALTIME_MAX_RESTARTS) {
      stopRealtimeConversation("语音识别启动失败，已结束实时对话。");
      return;
    }
    restartRealtimeRecognitionSoon(600);
  }
}

function resumeRealtimeListening() {
  if (!state.realtimeActive || realtimeVoice.stopRequested) {
    return;
  }

  state.realtimeTranscript = "";
  state.practiceTranscript = "";
  realtimeVoice.finalText = "";
  realtimeVoice.interimText = "";
  setRealtimePhase("listening");
  restartRealtimeRecognitionSoon();
}

function cancelRealtimeUtteranceCapture() {
  clearTimeout(realtimeVoice.silenceTimer);
  realtimeVoice.silenceTimer = 0;
  stopRealtimeRecognition();
  realtimeVoice.finalText = "";
  realtimeVoice.interimText = "";
  state.realtimeTranscript = "";
  state.practiceTranscript = "";
}

function commitRealtimeUtterance() {
  clearTimeout(realtimeVoice.silenceTimer);
  realtimeVoice.silenceTimer = 0;

  if (!state.realtimeActive || realtimeVoice.stopRequested) {
    return;
  }
  if (state.realtimePhase !== "listening") {
    return;
  }

  const transcript = String(state.realtimeTranscript || "").trim();
  if (!transcript) {
    return;
  }

  stopRealtimeRecognition();
  realtimeVoice.finalText = "";
  realtimeVoice.interimText = "";
  state.realtimeTranscript = "";
  state.practiceTranscript = "";

  if (getRealtimeSection() === "free") {
    setRealtimePhase("thinking", "正在理解你的表达…");
    handleRealtimeFreeUtterance(transcript);
    return;
  }

  setRealtimePhase("thinking", "正在评价你的回答…");
  handleRealtimeDialogueUtterance(transcript);
}

function getRealtimeDialogueReaction(score) {
  const value = Number(score) || 0;
  if (value >= 85) {
    return "Nice, that sounded really natural.";
  }
  if (value >= 65) {
    return "Good, that worked well.";
  }
  if (value >= 40) {
    return "Okay, good try.";
  }
  return "Let's keep going.";
}

function continueDialogueRealtimeAfterAnswer(result) {
  const scenario = getCurrentDialogueScenario();
  if (!state.realtimeActive || !scenario) {
    resumeRealtimeListening();
    return;
  }

  const reaction = getRealtimeDialogueReaction(result?.score ?? 0);
  const isLastTurn = state.dialogueTurnIndex >= scenario.turns.length - 1;

  setRealtimePhase("speaking", "正在回应你的回答…");
  speakRealtime(reaction, getFreeSpeechOptions(), () => {
    if (!state.realtimeActive) {
      return;
    }
    if (isLastTurn) {
      stopRealtimeConversation("这一轮情景已练完，可以再次开始继续。");
      return;
    }

    state.dialogueTurnIndex += 1;
    clearDialogueAttempt({ keepMessages: true });
    state.realtimeTranscript = "";
    renderPracticeView();

    const nextTurn = getCurrentDialogueTurn();
    if (!nextTurn) {
      resumeRealtimeListening();
      return;
    }

    setRealtimePhase("speaking", "正在朗读对方的话…");
    speakRealtime(
      nextTurn.prompt,
      getDialogueSpeechOptions(nextTurn),
      resumeRealtimeListening,
    );
  });
}

function handleRealtimeDialogueUtterance(transcript) {
  const result = submitDialogueAnswer(transcript);
  if (!result) {
    resumeRealtimeListening();
    return;
  }
  continueDialogueRealtimeAfterAnswer(result);
}

async function handleRealtimeFreeUtterance(transcript) {
  const reply = await sendFreeMessage(transcript);
  if (!state.realtimeActive || getRealtimeSection() !== "free") {
    return;
  }
  if (!reply?.english) {
    resumeRealtimeListening();
    return;
  }

  setRealtimePhase("speaking", "正在用美音回应…");
  speakRealtime(reply.english, getFreeSpeechOptions(), resumeRealtimeListening);
}

function startRealtimeConversation() {
  if (state.realtimeActive) {
    return;
  }

  const section = getRealtimeSection();
  const support = getRealtimeSupport();
  if (!support.supported) {
    state.practiceMessage = support.message;
    state.practiceMessageType = "error";
    renderPracticeView();
    return;
  }

  cancelPracticeRecognition();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (section === "free" && state.freeMessages.length === 0) {
    resetFreeConversation();
  }

  realtimeVoice.stopRequested = false;
  realtimeVoice.restartCount = 0;
  realtimeVoice.finalText = "";
  realtimeVoice.interimText = "";
  clearRealtimeTimers();
  state.realtimeActive = true;
  state.realtimePhase = "idle";
  state.realtimeTranscript = "";
  state.realtimeMessage = "";
  state.realtimeMessageType = "";
  state.practiceMessage = "";
  state.practiceMessageType = "";

  if (section === "free") {
    const lastMessage = state.freeMessages[state.freeMessages.length - 1];
    const latestReply = [...state.freeMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.english);

    if (lastMessage?.role === "assistant" && latestReply?.english) {
      setRealtimePhase("speaking", "正在朗读陪练的上一句话…");
      speakRealtime(
        latestReply.english,
        getFreeSpeechOptions(),
        resumeRealtimeListening,
      );
      return;
    }
    resumeRealtimeListening();
    return;
  }

  if (state.dialogueResult) {
    continueDialogueRealtimeAfterAnswer(state.dialogueResult);
    return;
  }

  const turn = getCurrentDialogueTurn();
  if (!turn) {
    stopRealtimeConversation("当前没有可练习的情景对话。");
    return;
  }

  setRealtimePhase("speaking", "正在朗读对方的话…");
  speakRealtime(
    turn.prompt,
    getDialogueSpeechOptions(turn),
    resumeRealtimeListening,
  );
}

function toggleRealtimeConversation() {
  const section = getRealtimeSection();
  if (isRealtimeSectionActive(section)) {
    stopRealtimeConversation("实时对话已结束。");
    return;
  }
  startRealtimeConversation();
}

function getPracticeModeLabel(mode = state.practiceRecognitionMode) {
  const labels = {
    browser: "浏览器免费",
    api: "自定义 API",
    off: "已关闭",
  };
  return labels[mode] || labels.browser;
}

function getPracticeModeAvailability() {
  if (state.practiceRecognitionMode === "off") {
    return {
      available: false,
      message: "语音识别已关闭，仍可使用示范朗读和句子对照。",
    };
  }

  if (state.practiceRecognitionMode === "api") {
    if (!String(state.practiceApiUrl || "").trim()) {
      return {
        available: false,
        message: "请先填写并保存语音转写接口地址。",
      };
    }
    if (!("MediaRecorder" in window)) {
      return {
        available: false,
        message: "当前浏览器不支持录音功能。",
      };
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return {
        available: false,
        message: "当前页面无法访问麦克风，请确认使用 HTTPS 打开网站。",
      };
    }
    return {
      available: true,
      message: "接口录音完成后会自动转写并评分。",
    };
  }

  if (!getSpeechRecognitionConstructor()) {
    return {
      available: false,
      message:
        "当前浏览器不支持免费语音识别，请使用最新版 Chrome 或 Edge，或切换自定义 API。",
    };
  }

  return {
    available: true,
    message: "使用浏览器免费语音识别，需允许麦克风权限。",
  };
}

function getPracticeEntries() {
  return getVisibleEntries();
}

function getCurrentPracticeEntry() {
  const entries = getPracticeEntries();
  if (entries.length === 0) {
    state.practiceIndex = 0;
    return null;
  }

  if (state.practiceIndex < 0 || state.practiceIndex >= entries.length) {
    state.practiceIndex = 0;
  }
  return entries[state.practiceIndex];
}

function getPracticeTarget(entry) {
  return String(entry?.item.sentence || entry?.item.phrase || "").trim();
}

function tokenizePracticeText(text) {
  const matches = String(text || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[a-z0-9]+(?:['’][a-z]+)*/g);

  return matches
    ? matches.map((word) => word.replace(/[’]/g, "'"))
    : [];
}

function comparePracticeText(target, transcript) {
  const targetWords = tokenizePracticeText(target);
  const spokenWords = tokenizePracticeText(transcript);
  const rows = targetWords.length + 1;
  const columns = spokenWords.length + 1;
  const grid = Array.from(
    { length: rows },
    () => new Uint16Array(columns),
  );

  for (let targetIndex = 1; targetIndex < rows; targetIndex += 1) {
    for (
      let spokenIndex = 1;
      spokenIndex < columns;
      spokenIndex += 1
    ) {
      if (
        targetWords[targetIndex - 1] === spokenWords[spokenIndex - 1]
      ) {
        grid[targetIndex][spokenIndex] =
          grid[targetIndex - 1][spokenIndex - 1] + 1;
      } else {
        grid[targetIndex][spokenIndex] = Math.max(
          grid[targetIndex - 1][spokenIndex],
          grid[targetIndex][spokenIndex - 1],
        );
      }
    }
  }

  const matchedTargetIndexes = new Set();
  const matchedSpokenIndexes = new Set();
  let targetIndex = targetWords.length;
  let spokenIndex = spokenWords.length;

  while (targetIndex > 0 && spokenIndex > 0) {
    const isMatch =
      targetWords[targetIndex - 1] === spokenWords[spokenIndex - 1] &&
      grid[targetIndex][spokenIndex] ===
        grid[targetIndex - 1][spokenIndex - 1] + 1;

    if (isMatch) {
      matchedTargetIndexes.add(targetIndex - 1);
      matchedSpokenIndexes.add(spokenIndex - 1);
      targetIndex -= 1;
      spokenIndex -= 1;
    } else if (
      grid[targetIndex - 1][spokenIndex] >=
      grid[targetIndex][spokenIndex - 1]
    ) {
      targetIndex -= 1;
    } else {
      spokenIndex -= 1;
    }
  }

  const missingTargetIndexes = targetWords
    .map((_, index) => index)
    .filter((index) => !matchedTargetIndexes.has(index));
  const extraWords = spokenWords.filter(
    (_, index) => !matchedSpokenIndexes.has(index),
  );
  const accuracy = targetWords.length
    ? Math.round((matchedTargetIndexes.size / targetWords.length) * 100)
    : 0;

  return {
    targetWords,
    spokenWords,
    matchedTargetIndexes,
    missingTargetIndexes,
    extraWords,
    accuracy,
  };
}

function getPracticeFeedback(accuracy) {
  if (accuracy >= 90) {
    return "句子已经很完整，可以继续练下一句。";
  }
  if (accuracy >= 75) {
    return "整体不错，重点补上漏掉的单词。";
  }
  if (accuracy >= 55) {
    return "已经抓住大意，放慢速度再跟一遍。";
  }
  return "先听两遍示范，再按短句分组跟读。";
}

function formatPracticeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function cancelPracticeRecognition() {
  const recognition = practiceRecognition;
  practiceRecognition = null;
  state.practiceListening = false;
  state.practiceTranscribing = false;

  if (recognition) {
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      // The recognition session may already have ended.
    }
  }

  practiceApiAbortController?.abort();
  practiceApiAbortController = null;

  const mediaRecorder = practiceMediaRecorder;
  practiceMediaRecorder = null;
  if (mediaRecorder) {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onerror = null;
    mediaRecorder.onstop = null;
    if (mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch {
        // The recorder may already have stopped.
      }
    }
  }

  if (practiceMediaStream) {
    practiceMediaStream.getTracks().forEach((track) => track.stop());
    practiceMediaStream = null;
  }
  practiceAudioChunks = [];
}

function resetPracticeAttempt() {
  cancelPracticeRecognition();
  state.practiceTranscript = "";
  state.practiceFinalTranscript = "";
  state.practiceInterimTranscript = "";
  state.practiceResult = null;
  state.practiceMessage = "";
  state.practiceMessageType = "";

  const availability = getPracticeModeAvailability();
  if (state.practiceRecognitionMode === "off") {
    state.practiceStatusText = "已关闭";
    state.practiceMessage = availability.message;
    state.practiceMessageType = "info";
  } else if (!availability.available) {
    state.practiceStatusText = "需要设置";
    state.practiceMessage = availability.message;
    state.practiceMessageType = "error";
  } else {
    state.practiceStatusText = "准备开始";
  }
}

function getCurrentDialogueScenario() {
  const scenario =
    DIALOGUE_SCENARIOS.find(
      (item) => item.id === state.dialogueScenarioId,
    ) || DIALOGUE_SCENARIOS[0];

  if (scenario && scenario.id !== state.dialogueScenarioId) {
    state.dialogueScenarioId = scenario.id;
  }
  return scenario || null;
}

function getCurrentDialogueTurn() {
  const scenario = getCurrentDialogueScenario();
  if (!scenario?.turns?.length) {
    state.dialogueTurnIndex = 0;
    return null;
  }

  if (
    state.dialogueTurnIndex < 0 ||
    state.dialogueTurnIndex >= scenario.turns.length
  ) {
    state.dialogueTurnIndex = 0;
  }
  return scenario.turns[state.dialogueTurnIndex];
}

function clearDialogueAttempt({ keepMessages = false } = {}) {
  cancelPracticeRecognition();
  state.practiceTranscript = "";
  state.practiceFinalTranscript = "";
  state.practiceInterimTranscript = "";
  state.practiceMessage = "";
  state.practiceMessageType = "";
  state.dialogueInput = "";
  state.dialogueHintVisible = false;
  state.dialogueResult = null;
  if (!keepMessages) {
    state.dialogueMessages = [];
  }
  state.practiceStatusText =
    state.practiceRecognitionMode === "off"
      ? "已关闭"
      : "准备开始";
}

function selectDialogueScenario(scenarioId) {
  const scenario = DIALOGUE_SCENARIOS.find(
    (item) => item.id === scenarioId,
  );
  if (!scenario) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  state.dialogueScenarioId = scenario.id;
  state.dialogueTurnIndex = 0;
  clearDialogueAttempt();
  renderPracticeView();
}

function normalizeDialogueText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dialogueTextIncludes(text, phrase) {
  const normalizedText = ` ${normalizeDialogueText(text)} `;
  const normalizedPhrase = normalizeDialogueText(phrase);
  return Boolean(
    normalizedPhrase && normalizedText.includes(` ${normalizedPhrase} `),
  );
}

function getDialogueTranscriptMeta(transcript) {
  const normalizedText = normalizeDialogueText(transcript);
  return {
    wordCount: normalizedText ? normalizedText.split(" ").length : 0,
    hasChinese: /[\u3400-\u9fff]/.test(String(transcript || "")),
  };
}

function scoreDialogueAnswer(turn, transcript) {
  const groups = (turn?.keywords || []).map((group) => {
    const options = (group.options || []).map((option) =>
      Array.isArray(option) ? option[0] : option,
    );
    const matchedOption = options.find((option) =>
      dialogueTextIncludes(transcript, option),
    );
    return {
      label: group.label,
      covered: Boolean(matchedOption),
      matchedOption: matchedOption || "",
    };
  });
  const coveredCount = groups.filter((group) => group.covered).length;
  const score = groups.length
    ? Math.round((coveredCount / groups.length) * 100)
    : 0;

  return {
    score,
    groups,
    ...getDialogueTranscriptMeta(transcript),
  };
}

function getDialogueFeedback(score) {
  if (score >= 100) {
    return "这一轮已经可以直接用于真实交流。";
  }
  if (score >= 70) {
    return "整体表达很稳，再连起来说一遍会更自然。";
  }
  if (score >= 40) {
    return "已经开口表达，先补充一个重点再继续。";
  }
  return "先跟着参考表达说一遍，再用自己的话回答。";
}

function getDialogueCoachAdvice(turn, result) {
  const coveredGroups = result.groups.filter((group) => group.covered);
  const missingGroups = result.groups.filter((group) => !group.covered);
  const coveredLabels = coveredGroups
    .slice(0, 2)
    .map((group) => `“${group.label}”`)
    .join("、");
  let message;

  if (result.hasChinese && coveredGroups.length === 0) {
    message =
      "你先把意思表达出来了，接下来把这句话换成简单英文就好。";
  } else if (result.hasChinese) {
    message = `你已经表达出${coveredLabels}，再用英文补完整会更自然。`;
  } else if (result.score >= 100) {
    message = "关键信息都说到了，这一轮回答很完整。";
  } else if (coveredGroups.length > 0) {
    message = `你已经表达了${coveredLabels}，回答方向是对的。`;
  } else {
    message = "先抓住一个最关键的信息，不用一次说到完美。";
  }

  const tips = [];
  if (result.wordCount > 0 && result.wordCount <= 3) {
    tips.push("把单词扩展成一句完整回答。");
  }
  missingGroups.forEach((group) => {
    if (tips.length < 2) {
      tips.push(`补充“${group.label}”相关信息。`);
    }
  });
  if (tips.length === 0) {
    tips.push(
      result.score >= 100
        ? "换一种说法再说一次，练习自然表达。"
        : "用一整句话把现有信息连起来。",
    );
  }

  let task;
  if (result.hasChinese) {
    task = "先跟读参考表达，再用英文说一遍。";
  } else if (missingGroups.length > 0) {
    task = `再回答一次，只补上${missingGroups
      .slice(0, 2)
      .map((group) => `“${group.label}”`)
      .join("和")}。`;
  } else if (turn?.level === "进阶") {
    task = "遮住参考表达，换一种说法再回答一次。";
  } else {
    task = "遮住参考表达，用自己的话再回答一次。";
  }

  return {
    levelLabel: turn?.level || "基础",
    message,
    tips: tips.slice(0, 2),
    task,
  };
}

function renderDialogueScenarioList() {
  const activeScenario = getCurrentDialogueScenario();
  const fragment = document.createDocumentFragment();

  DIALOGUE_SCENARIOS.forEach((scenario) => {
    const button = document.createElement("button");
    const isActive = scenario.id === activeScenario?.id;
    button.type = "button";
    button.className = "dialogue-scenario-button";
    button.classList.toggle("is-active", isActive);
    button.dataset.scenarioId = scenario.id;
    button.setAttribute("aria-pressed", String(isActive));

    const meta = document.createElement("span");
    meta.className = "dialogue-scenario-button-meta";
    meta.textContent = `${scenario.category} · ${scenario.level}`;

    const title = document.createElement("strong");
    title.textContent = scenario.title;

    const summary = document.createElement("span");
    summary.className = "dialogue-scenario-button-summary";
    summary.textContent = scenario.summary;

    button.append(meta, title, summary);
    button.addEventListener("click", () => {
      selectDialogueScenario(scenario.id);
    });
    fragment.append(button);
  });

  elements.dialogueScenarioList.replaceChildren(fragment);
}

function createDialogueMessage(role, label, english, chinese = "") {
  const message = document.createElement("div");
  message.className = `dialogue-message is-${role}`;

  const meta = document.createElement("span");
  meta.className = "dialogue-message-meta";
  meta.textContent = label;

  const englishText = document.createElement("p");
  englishText.className = "dialogue-message-en";
  englishText.lang = "en";
  englishText.textContent = english;

  message.append(meta, englishText);
  if (chinese) {
    const chineseText = document.createElement("p");
    chineseText.className = "dialogue-message-zh";
    chineseText.textContent = chinese;
    message.append(chineseText);
  }
  return message;
}

function renderDialogueMessages() {
  const scenario = getCurrentDialogueScenario();
  const currentTurn = getCurrentDialogueTurn();
  if (!scenario || !currentTurn) {
    elements.dialogueMessages.replaceChildren();
    return;
  }

  const fragment = document.createDocumentFragment();
  const liveTranscript =
    state.practiceListening || state.practiceTranscribing
      ? state.practiceTranscript
      : "";

  scenario.turns.forEach((turn, index) => {
    if (index > state.dialogueTurnIndex) {
      return;
    }

    fragment.append(
      createDialogueMessage(
        "partner",
        `${turn.speaker} · 第 ${index + 1} 轮`,
        turn.prompt,
        turn.promptZh,
      ),
    );

    const answer =
      index === state.dialogueTurnIndex
        ? liveTranscript || state.dialogueMessages[index]
        : state.dialogueMessages[index];
    if (answer) {
      fragment.append(
        createDialogueMessage("user", "你的回答", answer),
      );
    }
  });

  elements.dialogueMessages.replaceChildren(fragment);
}

function renderDialogueHint() {
  const turn = getCurrentDialogueTurn();
  if (!turn || !state.dialogueHintVisible) {
    elements.dialogueHint.hidden = true;
    elements.dialogueHint.replaceChildren();
    elements.dialogueHintButton.textContent = "参考表达";
    return;
  }

  const label = document.createElement("span");
  label.className = "practice-block-label";
  label.textContent = "参考表达";

  const sample = document.createElement("p");
  sample.className = "dialogue-hint-sample";
  sample.lang = "en";
  sample.textContent = turn.sample;

  const translation = document.createElement("p");
  translation.className = "dialogue-hint-translation";
  translation.textContent = turn.sampleZh;

  elements.dialogueHint.replaceChildren(label, sample, translation);
  elements.dialogueHint.hidden = false;
  elements.dialogueHintButton.textContent = "收起提示";
}

function renderDialogueKeyPoints(result) {
  const fragment = document.createDocumentFragment();
  result.groups.forEach((group) => {
    const item = document.createElement("span");
    item.className = "dialogue-key-point";
    item.classList.toggle("is-covered", group.covered);
    item.textContent = group.covered
      ? `${group.label}：已覆盖`
      : `${group.label}：待补充`;
    fragment.append(item);
  });
  elements.dialogueKeyPoints.replaceChildren(fragment);
}

function renderDialogueCoach(turn, result) {
  const advice = getDialogueCoachAdvice(turn, result);
  const fragment = document.createDocumentFragment();

  elements.dialogueCoachLevel.textContent = advice.levelLabel;
  elements.dialogueCoachMessage.textContent = advice.message;
  advice.tips.forEach((tip) => {
    const item = document.createElement("li");
    item.textContent = tip;
    fragment.append(item);
  });
  elements.dialogueCoachTips.replaceChildren(fragment);
  elements.dialogueCoachTask.textContent = advice.task;
}

function updatePracticeSectionViews() {
  const tabs = [
    [elements.practiceShadowTab, "shadow"],
    [elements.practiceDialogueTab, "dialogue"],
    [elements.practiceFreeTab, "free"],
  ];
  tabs.forEach(([tab, section]) => {
    const isActive = state.practiceSection === section;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });

  elements.shadowPracticeView.hidden = state.practiceSection !== "shadow";
  elements.dialoguePracticeView.hidden =
    state.practiceSection !== "dialogue";
  elements.freePracticeView.hidden = state.practiceSection !== "free";
}

function renderDialogueView() {
  const scenario = getCurrentDialogueScenario();
  const turn = getCurrentDialogueTurn();
  const availability = getPracticeModeAvailability();

  if (!scenario || !turn) {
    return;
  }

  elements.dialogueScenarioMeta.textContent =
    `${scenario.category} · ${scenario.level} · ${scenario.turns.length} 轮`;
  elements.dialoguePartnerLabel.textContent = `${turn.speaker} 说`;
  elements.dialogueScenarioTitle.textContent =
    `${scenario.title} · ${scenario.titleEn}`;
  elements.dialogueTurnCounter.textContent =
    `第 ${state.dialogueTurnIndex + 1} / ${scenario.turns.length} 轮`;

  renderDialogueScenarioList();
  renderDialogueMessages();
  renderDialogueHint();
  renderRealtimeBar("dialogue");

  const realtimeActive = isRealtimeSectionActive("dialogue");
  const liveTranscript = realtimeActive
    ? state.realtimeTranscript
    : state.practiceListening || state.practiceTranscribing
      ? state.practiceTranscript
      : "";
  elements.dialogueAnswerInput.value =
    liveTranscript || state.dialogueInput;
  elements.dialogueAnswerInput.disabled =
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive;

  elements.dialogueListenButton.disabled =
    !("speechSynthesis" in window) || realtimeActive;
  elements.dialogueHintButton.disabled =
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive;
  elements.dialogueRecordButton.disabled =
    !availability.available ||
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive;
  elements.dialogueRecordButton.textContent =
    state.practiceTranscribing
      ? "正在转写"
      : state.practiceRecognitionMode === "api"
        ? "开始录音"
        : "开口回答";
  elements.dialogueRecordButton.hidden = state.practiceListening;
  elements.dialogueStopButton.hidden = !state.practiceListening;
  elements.dialogueStopButton.disabled = !state.practiceListening;
  elements.dialogueSubmitButton.disabled =
    !elements.dialogueAnswerInput.value.trim() ||
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive ||
    Boolean(state.dialogueResult);
  elements.dialogueNextButton.disabled =
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive;
  elements.dialogueNextButton.textContent =
    state.dialogueTurnIndex === scenario.turns.length - 1
      ? "再练一遍"
      : "下一轮";
  elements.dialogueRetryButton.disabled = realtimeActive;

  elements.dialogueNotice.hidden = !state.practiceMessage;
  elements.dialogueNotice.textContent = state.practiceMessage;
  elements.dialogueNotice.classList.toggle(
    "is-error",
    state.practiceMessageType === "error",
  );

  const result = state.dialogueResult;
  const showResult = Boolean(
    result &&
      result.scenarioId === scenario.id &&
      result.turnIndex === state.dialogueTurnIndex,
  );
  elements.dialogueResult.hidden = !showResult;
  if (showResult) {
    elements.dialogueScore.textContent = `${result.score}%`;
    elements.dialogueFeedback.textContent = getDialogueFeedback(
      result.score,
    );
    renderDialogueKeyPoints(result);
    renderDialogueCoach(turn, result);
    elements.dialogueSampleAnswer.textContent = turn.sample;
  }
}

function setPracticeSection(section) {
  const allowedSections = new Set(["shadow", "dialogue", "free"]);
  const nextSection = allowedSections.has(section) ? section : "shadow";
  if (state.practiceSection === nextSection) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  cancelPracticeRecognition();
  state.practiceSection = nextSection;
  if (nextSection === "dialogue") {
    clearDialogueAttempt();
  } else if (nextSection === "free") {
    state.practiceMessage = "";
    state.practiceMessageType = "";
    if (state.freeMessages.length === 0) {
      resetFreeConversation();
    }
  } else {
    resetPracticeAttempt();
  }
  render();
}

function playDialoguePrompt() {
  const turn = getCurrentDialogueTurn();
  if (!turn) {
    return;
  }

  const profile = DIALOGUE_SPEAKER_VOICE_PROFILES[turn.speaker] || {};
  if (
    !speak(turn.prompt, 0.9, {
      profile,
      pitch: profile.pitch,
      rateScale: profile.rateScale,
      voicePreference: state.practiceVoice,
    })
  ) {
    state.practiceMessage =
      "当前浏览器不支持语音朗读，请使用最新版 Chrome、Edge 或 Safari。";
    state.practiceMessageType = "error";
    renderDialogueView();
    return;
  }

  state.practiceMessage = "";
  state.practiceMessageType = "";
  renderDialogueView();
}

function toggleDialogueHint() {
  state.dialogueHintVisible = !state.dialogueHintVisible;
  renderDialogueView();
}

function addDialogueHistory(scenario, turnIndex, transcript, score) {
  state.practiceHistory.unshift({
    itemKey: `dialogue:${scenario.id}:${turnIndex}`,
    resourceTitle: scenario.title,
    target: `${scenario.title} · 第 ${turnIndex + 1} 轮`,
    transcript,
    accuracy: score,
    createdAt: new Date().toISOString(),
  });
  state.practiceHistory = state.practiceHistory.slice(0, 80);
  persistPracticeHistory();
}

function submitDialogueAnswer(providedTranscript = "") {
  const scenario = getCurrentDialogueScenario();
  const turn = getCurrentDialogueTurn();
  if (
    !scenario ||
    !turn ||
    state.practiceListening ||
    state.practiceTranscribing ||
    state.dialogueResult
  ) {
    return null;
  }

  const transcript = String(
    providedTranscript || elements.dialogueAnswerInput.value,
  ).trim();
  if (!transcript) {
    state.practiceMessage = "请先说出或输入一个英文回答。";
    state.practiceMessageType = "error";
    renderDialogueView();
    return null;
  }

  const result = scoreDialogueAnswer(turn, transcript);
  state.dialogueInput = transcript;
  state.dialogueMessages[state.dialogueTurnIndex] = transcript;
  state.dialogueHintVisible = false;
  state.dialogueResult = {
    ...result,
    scenarioId: scenario.id,
    turnIndex: state.dialogueTurnIndex,
  };
  state.practiceMessage = "";
  state.practiceMessageType = "";
  addDialogueHistory(
    scenario,
    state.dialogueTurnIndex,
    transcript,
    result.score,
  );
  renderPracticeView();
  updateProgress();
  return state.dialogueResult;
}

function finalizeDialogueAttempt(transcript) {
  submitDialogueAnswer(transcript);
}

function startDialogueRecording() {
  if (state.practiceListening || state.practiceTranscribing) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  const availability = getPracticeModeAvailability();
  if (!availability.available) {
    state.practiceMessage = availability.message;
    state.practiceMessageType =
      state.practiceRecognitionMode === "off" ? "info" : "error";
    renderDialogueView();
    return;
  }

  state.dialogueInput = "";
  state.dialogueResult = null;
  state.dialogueHintVisible = false;
  state.practiceMessage = "";
  state.practiceMessageType = "";

  if (state.practiceRecognitionMode === "api") {
    startApiPracticeRecording({
      onTranscript: finalizeDialogueAttempt,
      requireEntry: false,
    });
    return;
  }

  startBrowserPracticeRecording({
    onTranscript: finalizeDialogueAttempt,
    requireEntry: false,
  });
}

function stopDialogueRecording() {
  stopPracticeRecording();
}

function retryDialogueTurn() {
  const turn = getCurrentDialogueTurn();
  if (!turn) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  cancelPracticeRecognition();
  state.dialogueInput = "";
  state.dialogueMessages[state.dialogueTurnIndex] = "";
  state.dialogueHintVisible = false;
  state.dialogueResult = null;
  state.practiceTranscript = "";
  state.practiceFinalTranscript = "";
  state.practiceInterimTranscript = "";
  state.practiceMessage = "";
  state.practiceMessageType = "";
  renderDialogueView();
}

function moveDialogueTurn() {
  const scenario = getCurrentDialogueScenario();
  if (!scenario || state.practiceListening || state.practiceTranscribing) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  cancelPracticeRecognition();
  if (state.dialogueTurnIndex < scenario.turns.length - 1) {
    state.dialogueTurnIndex += 1;
    clearDialogueAttempt({ keepMessages: true });
  } else {
    state.dialogueTurnIndex = 0;
    clearDialogueAttempt();
  }
  renderPracticeView();
}

function getFreeTopic() {
  return FREE_CHAT_TOPICS[state.freeTopic] || FREE_CHAT_TOPICS.daily;
}

function getFreeChatModeLabel(mode = state.freeChatMode) {
  const labels = {
    local: "本地免费",
    api: "自定义 Chat API",
    off: "关闭自动回复",
  };
  return labels[mode] || labels.local;
}

function getFreeTopicIntro(topicId) {
  const introductions = {
    daily:
      "Hi! I'm your American English conversation coach. Let's start with something simple: what is one small thing that happened in your day?",
    study:
      "Hi! Let's talk about learning and exams. What are you studying at the moment, and what part feels most challenging?",
    travel:
      "Hi! Let's talk about travel and cities. Is there a place you have visited or would love to visit? Tell me what interests you about it.",
    work:
      "Hi! Let's talk about work and careers. What kind of work are you doing now, or what career would you like to build?",
    technology:
      "Hi! Let's talk about technology and media. Which app or device do you use most often, and how does it affect your daily life?",
    culture:
      "Hi! Let's talk about culture and everyday life. What is one custom or habit in your community that visitors might find interesting?",
  };
  return introductions[topicId] || introductions.daily;
}

function getFreeTopicIntroZh(topicId) {
  const introductions = {
    daily:
      "你好！我是你的美式英语对话教练。先从简单的话题开始：今天发生的一件小事是什么？",
    study:
      "你好！我们来聊聊学习和考试。你目前在学习什么？哪一部分最有挑战？",
    travel:
      "你好！我们来聊聊旅行和城市。有没有一个你去过或很想去的地方？说说它哪里吸引你。",
    work:
      "你好！我们来聊聊工作和职业。你现在做什么工作，或者想建立怎样的职业方向？",
    technology:
      "你好！我们来聊聊科技和媒体。你最常用哪个应用或设备？它怎样影响你的日常生活？",
    culture:
      "你好！我们来聊聊文化和日常生活。你的社区里有什么习俗或习惯会让外来者觉得有趣？",
  };
  return introductions[topicId] || introductions.daily;
}

function resetFreeConversation() {
  stopRealtimeConversation("", { silent: true });
  freeChatRequestId += 1;
  const topic = getFreeTopic();
  state.freeMessages = [
    {
      role: "assistant",
      english: getFreeTopicIntro(state.freeTopic),
      chinese: getFreeTopicIntroZh(state.freeTopic),
      source: "local",
      createdAt: new Date().toISOString(),
    },
  ];
  state.freeTurnCount = 0;
  state.freeInput = "";
  state.freeHintVisible = false;
  state.freeChatLoading = false;
  state.practiceMessage = "";
  state.practiceMessageType = "";
  state.freeChatApiMessage = "";
  state.freeChatApiMessageType = "";
  state.freeUsedLines = new Set();
  if (state.practiceSection === "free") {
    renderPracticeView();
  }
}

function cleanFreeEnglish(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+([,.!?;:])/g, "$1");
}

function applyFreeLanguageRules(text) {
  const corrections = [];
  let correctedText = cleanFreeEnglish(text);

  FREE_LANGUAGE_RULES.forEach((rule) => {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    const nextText = correctedText.replace(pattern, rule.replacement);
    if (nextText === correctedText) {
      return;
    }
    correctedText = nextText;
    corrections.push({
      type: rule.type,
      message: rule.message,
    });
  });

  if (/\bbecause\b[\s\S]*\bso\b/i.test(correctedText)) {
    corrections.push({
      type: "连贯性",
      message:
        "英语里 because 和 so 通常不同时使用；保留一个连接词就足够。",
    });
  }
  if (/\balthough\b[\s\S]*\bbut\b/i.test(correctedText)) {
    corrections.push({
      type: "连贯性",
      message:
        "although 和 but 通常不同时出现；可以只保留 although 或 but。",
    });
  }

  return { correctedText, corrections };
}

function buildFreeVocabularySuggestion(text) {
  let suggestedText = text;
  const notes = [];

  FREE_VOCABULARY_UPGRADES.forEach((upgrade) => {
    const pattern = new RegExp(upgrade.pattern.source, upgrade.pattern.flags);
    const nextText = suggestedText.replace(pattern, upgrade.replacement);
    if (nextText === suggestedText) {
      return;
    }
    suggestedText = nextText;
    notes.push({
      type: "词汇",
      message: upgrade.message,
    });
  });

  return { suggestedText, notes };
}

function buildFreeIeltsTips(text) {
  const words = cleanFreeEnglish(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  const lowerText = cleanFreeEnglish(text).toLocaleLowerCase("en-US");
  const tips = [];

  if (words.length < 12) {
    tips.push(
      "流利度：回答偏短。雅思口语 Part 1 通常用 2–3 句展开，可以先回答，再补一个原因或例子。",
    );
  }

  if (
    !/\b(because|since|for example|however|although|while|which|that)\b/i.test(
      lowerText,
    )
  ) {
    tips.push(
      "连贯性：加入 because、for example 或 however，让观点之间的关系更清楚。",
    );
  }

  if (
    !/\b(if|when|although|because|which|who|that|while|before|after)\b/i.test(
      lowerText,
    )
  ) {
    tips.push(
      "语法：尝试加入一个从句，例如 “When I have time, I usually...” 来展示句式变化。",
    );
  }

  if (words.length >= 12 && !tips.length) {
    tips.push(
      "表达：回答长度合适。下一步可以加入一个具体细节、数字或对比，让内容更像真实交流。",
    );
  }

  return tips.slice(0, 2);
}

function analyzeFreeEnglish(text) {
  const original = cleanFreeEnglish(text);
  const { correctedText, corrections } = applyFreeLanguageRules(original);
  const vocabulary = buildFreeVocabularySuggestion(correctedText);
  const allCorrections = [...corrections, ...vocabulary.notes];
  const betterExpression = vocabulary.suggestedText;
  const ieltsTips = buildFreeIeltsTips(correctedText);
  const feedback = {
    correctedText,
    corrections:
      allCorrections.length > 0
        ? allCorrections.slice(0, 4)
        : [
            {
              type: "状态",
              message: "没有发现明显语法错误，继续保持具体表达。",
            },
          ],
    betterExpression:
      betterExpression !== correctedText ? betterExpression : "",
    ieltsTips,
  };

  return feedback;
}

function pickFreeChatLine(pool, namespace) {
  const items = (pool || []).filter(Boolean);
  if (items.length === 0) {
    return null;
  }

  if (!state.freeUsedLines || typeof state.freeUsedLines.has !== "function") {
    state.freeUsedLines = new Set();
  }

  const keyOf = (item) => `${namespace}:${item.english}`;
  const unused = items.filter((item) => !state.freeUsedLines.has(keyOf(item)));
  const candidates = unused.length > 0 ? unused : items;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];

  state.freeUsedLines.add(keyOf(chosen));
  if (state.freeUsedLines.size > 80) {
    state.freeUsedLines = new Set([keyOf(chosen)]);
  }
  return chosen;
}

function buildLocalFreeTurn(text, turnIndex) {
  const feedback = analyzeFreeEnglish(text);
  const opener = pickFreeChatLine(FREE_CHAT_OPENERS, "opener");
  const reaction = FREE_CHAT_KEYWORD_REACTIONS.find((item) =>
    item.pattern.test(text),
  );
  const topicFollowUp = pickFreeChatLine(
    FREE_CHAT_TOPIC_FOLLOW_UPS[state.freeTopic] ||
      FREE_CHAT_TOPIC_FOLLOW_UPS.daily,
    `topic-${state.freeTopic}`,
  );
  const genericFollowUp = pickFreeChatLine(
    FREE_CHAT_GENERIC_FOLLOW_UPS,
    "generic",
  );

  const question =
    reaction && (turnIndex % 2 === 0 || Math.random() < 0.5)
      ? { english: reaction.question, chinese: reaction.questionZh }
      : topicFollowUp || genericFollowUp;
  const english = cleanFreeEnglish(
    [opener?.english, reaction?.english, question?.english]
      .filter(Boolean)
      .join(" "),
  );
  const chinese = [opener?.chinese, reaction?.chinese, question?.chinese]
    .filter(Boolean)
    .join("");

  return {
    feedback,
    reply: {
      english: english || FREE_CHAT_TOPICS.daily.replies[0].english,
      chinese: chinese || FREE_CHAT_TOPICS.daily.replies[0].chinese,
    },
  };
}

function getFreeChatEndpoint() {
  const rawUrl = String(state.freeChatApiUrl || "").trim();
  if (!rawUrl) {
    return "";
  }

  const resolved = new URL(rawUrl, window.location.href);
  const pathname = resolved.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/v1") {
    resolved.pathname = `${pathname || "/v1"}/chat/completions`;
  }
  return resolved.toString();
}

function buildFreeChatHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };
  if (!state.freeChatApiKey || state.freeChatApiAuth === "none") {
    return headers;
  }

  if (state.freeChatApiAuth === "x-api-key") {
    headers["x-api-key"] = state.freeChatApiKey;
  } else {
    headers.Authorization = `Bearer ${state.freeChatApiKey}`;
  }
  return headers;
}

function buildFreeChatSystemPrompt() {
  const topic = getFreeTopic();
  const learnerTurns = state.freeMessages.filter(
    (message) => message.role === "user" && message.english,
  ).length;
  return [
    "You are Mia, a warm, easygoing American conversation partner in your early thirties.",
    "You are talking with a Chinese learner who is preparing for IELTS Speaking. Your reply is read aloud by text-to-speech, so it has to sound natural when spoken.",
    `Current conversation topic: ${topic.label}.`,
    `The learner has already answered ${learnerTurns} time(s) in this conversation; keep building on those details instead of restarting the topic.`,
    "Sound like a real person, not a textbook or an assistant: use contractions, short sentences, and a relaxed spoken rhythm.",
    "React to the specific detail the learner just mentioned first, and paraphrase it in your own words.",
    "Ask at most one follow-up question, and make it specific and easy to answer out loud in a few sentences.",
    "Never begin two replies in the same conversation with the same words, and never repeat a question you already asked.",
    'Avoid formulaic chatbot openers such as "That\'s a great question", "Certainly", or "As an AI". Avoid lists, headings, emoji, and bullet points.',
    "Keep the English reply to 1-3 sentences, roughly 20-45 words, unless the learner clearly asks for more detail.",
    "Use American English spelling and phrasing.",
    "Always provide an accurate Simplified Chinese translation of your English reply.",
    "Correct the learner's grammar, vocabulary, and unnatural expressions. Do not invent errors; if the sentence is already clear, say so.",
    "Give practical IELTS Speaking practice advice about fluency, lexical resource, grammar, or coherence. Never claim an official IELTS score.",
    "Return only a valid JSON object with this exact shape:",
    '{"reply_en":"English reply","reply_zh":"Simplified Chinese translation","corrected_text":"A corrected, natural version of the learner message","corrections":[{"type":"语法|词汇|表达|状态","message":"short explanation in Chinese"}],"better_expression":"A more natural version or an empty string","ielts_tip":"One concise IELTS practice tip in Chinese"}',
  ].join("\n");
}

function extractFreeChatContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("")
      .trim();
  }
  return "";
}

function parseFreeChatJson(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    return null;
  }

  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeFreeCorrections(value) {
  if (value == null || value === "") {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => {
      if (typeof item === "string") {
        return { type: "表达", message: item.trim() };
      }
      if (!item || typeof item !== "object") {
        return null;
      }
      const message = String(
        item.message || item.explanation || item.note || "",
      ).trim();
      if (!message) {
        return null;
      }
      return {
        type: String(item.type || "表达").trim() || "表达",
        message,
      };
    })
    .filter(Boolean);
}

async function requestFreeChatTurn(text) {
  const endpoint = getFreeChatEndpoint();
  if (!endpoint) {
    throw new Error("请先填写 Chat 接口地址。");
  }

  const history = state.freeMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content:
        message.role === "assistant" && message.chinese
          ? `${message.english}\n中文：${message.chinese}`
          : message.english,
    }));
  const messages = [
    { role: "system", content: buildFreeChatSystemPrompt() },
    ...history,
  ];
  const requestBody = {
    model: state.freeChatApiModel || "gpt-4o-mini",
    temperature: 0.85,
    frequency_penalty: 0.3,
    presence_penalty: 0.4,
    max_tokens: 600,
    messages,
  };
  const requestOptions = {
    method: "POST",
    headers: buildFreeChatHeaders(),
    body: JSON.stringify(requestBody),
  };
  let response = await fetch(endpoint, requestOptions);
  let responseText = await response.text();

  // Some OpenAI-compatible providers reject sampling extras such as
  // frequency_penalty even though they accept the core Chat Completions body.
  if (!response.ok && [400, 422].includes(response.status)) {
    const retryBody = { ...requestBody };
    delete retryBody.frequency_penalty;
    delete retryBody.presence_penalty;
    response = await fetch(endpoint, {
      ...requestOptions,
      body: JSON.stringify(retryBody),
    });
    responseText = await response.text();
  }

  let payload = null;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      responseText ||
      `Chat 接口返回 ${response.status}`;
    throw new Error(String(message).slice(0, 180));
  }

  const content = extractFreeChatContent(payload);
  const data = parseFreeChatJson(content);
  if (!data?.reply_en || !data?.reply_zh) {
    throw new Error("Chat 接口没有返回双语 JSON 内容。");
  }

  const corrections = normalizeFreeCorrections(data.corrections);
  return {
    feedback: {
      correctedText: String(
        data.corrected_text || data.correctedText || text,
      ).trim(),
      corrections:
        corrections.length > 0
          ? corrections
          : [
              {
                type: "状态",
                message: "没有发现明显语法错误，继续保持具体表达。",
              },
            ],
      betterExpression: String(
        data.better_expression || data.betterExpression || "",
      ).trim(),
      ieltsTips: String(data.ielts_tip || data.ieltsTip || "")
        .trim()
        ? [String(data.ielts_tip || data.ieltsTip).trim()]
        : [],
    },
    reply: {
      english: String(data.reply_en).trim(),
      chinese: String(data.reply_zh).trim(),
    },
  };
}

function playLatestFreeReply() {
  const latest = [...state.freeMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.english);
  if (!latest) {
    return;
  }

  if (
    !speak(latest.english, 0.94, {
      profile: FREE_CHAT_COACH_PROFILE,
      pitch: FREE_CHAT_COACH_PROFILE.pitch,
      rateScale: FREE_CHAT_COACH_PROFILE.rateScale,
      voicePreference: state.practiceVoice,
    })
  ) {
    state.practiceMessage =
      "当前浏览器不支持语音朗读，请使用最新版 Chrome、Edge 或 Safari。";
    state.practiceMessageType = "error";
    renderFreeView();
  }
}

function toggleFreeHint() {
  state.freeHintVisible = !state.freeHintVisible;
  renderFreeView();
}

async function sendFreeMessage(providedText = "") {
  const text = cleanFreeEnglish(providedText || state.freeInput);
  if (!text || state.freeChatLoading) {
    return null;
  }

  const requestId = freeChatRequestId + 1;
  freeChatRequestId = requestId;
  const userMessage = {
    role: "user",
    english: text,
    feedback: null,
    createdAt: new Date().toISOString(),
  };
  state.freeMessages.push(userMessage);
  state.freeTurnCount += 1;
  state.freeInput = "";
  state.freeHintVisible = false;
  state.practiceMessage = "";
  state.practiceMessageType = "";
  state.freeChatLoading = true;
  renderPracticeView();

  let turn;
  if (state.freeChatMode === "off") {
    userMessage.feedback = {
      correctedText: text,
      corrections: [
        {
          type: "状态",
          message: "自动回复已关闭，你仍然可以保留这段英文练习记录。",
        },
      ],
      betterExpression: "",
      ieltsTips: [],
    };
    state.freeChatLoading = false;
    renderPracticeView();
    return null;
  }

  try {
    turn =
      state.freeChatMode === "api"
        ? await requestFreeChatTurn(text)
        : buildLocalFreeTurn(text, state.freeTurnCount - 1);
  } catch (error) {
    if (requestId !== freeChatRequestId) {
      return null;
    }
    turn = buildLocalFreeTurn(text, state.freeTurnCount - 1);
    state.freeChatApiMessage = `Chat API 调用失败，已切换到本地免费陪练：${
      error?.message || "未知错误"
    }`;
    state.freeChatApiMessageType = "error";
  }

  if (requestId !== freeChatRequestId) {
    return null;
  }

  userMessage.feedback = turn.feedback;
  const assistantMessage = {
    role: "assistant",
    english: turn.reply.english,
    chinese: turn.reply.chinese,
    source: state.freeChatMode,
    createdAt: new Date().toISOString(),
  };
  state.freeMessages.push(assistantMessage);
  state.freeChatLoading = false;
  renderPracticeView();

  if (!state.realtimeActive && state.freeAutoSpeak && turn.reply.english) {
    speak(turn.reply.english, 0.94, {
      profile: FREE_CHAT_COACH_PROFILE,
      pitch: FREE_CHAT_COACH_PROFILE.pitch,
      rateScale: FREE_CHAT_COACH_PROFILE.rateScale,
      voicePreference: state.practiceVoice,
    });
  }
  return assistantMessage;
}

function finalizeFreeAttempt(transcript) {
  state.freeInput = transcript;
  sendFreeMessage(transcript);
}

function startFreeRecording() {
  if (
    state.practiceListening ||
    state.practiceTranscribing ||
    state.freeChatLoading
  ) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  const availability = getPracticeModeAvailability();
  if (!availability.available) {
    state.practiceMessage = availability.message;
    state.practiceMessageType =
      state.practiceRecognitionMode === "off" ? "info" : "error";
    renderFreeView();
    return;
  }

  state.practiceMessage = "";
  state.practiceMessageType = "";
  if (state.practiceRecognitionMode === "api") {
    startApiPracticeRecording({
      onTranscript: finalizeFreeAttempt,
      requireEntry: false,
    });
    return;
  }

  startBrowserPracticeRecording({
    onTranscript: finalizeFreeAttempt,
    requireEntry: false,
  });
}

function stopFreeRecording() {
  stopPracticeRecording();
}

function createFreeFeedbackBlock(feedback) {
  if (!feedback) {
    return null;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "free-feedback";

  const heading = document.createElement("span");
  heading.className = "free-feedback-heading";
  heading.textContent = "教练反馈";
  wrapper.append(heading);

  if (
    feedback.correctedText &&
    feedback.correctedText !== feedback.originalEnglish
  ) {
    const corrected = document.createElement("div");
    corrected.className = "free-feedback-row";
    const label = document.createElement("span");
    label.textContent = "修正后";
    const copy = document.createElement("p");
    copy.lang = "en";
    copy.textContent = feedback.correctedText;
    corrected.append(label, copy);
    wrapper.append(corrected);
  }

  if (feedback.corrections?.length) {
    const corrections = document.createElement("div");
    corrections.className = "free-feedback-row";
    const label = document.createElement("span");
    label.textContent = "纠错";
    const list = document.createElement("ul");
    feedback.corrections.forEach((correction) => {
      const item = document.createElement("li");
      item.textContent = `${correction.type}：${correction.message}`;
      list.append(item);
    });
    corrections.append(label, list);
    wrapper.append(corrections);
  }

  if (feedback.betterExpression) {
    const better = document.createElement("div");
    better.className = "free-feedback-row";
    const label = document.createElement("span");
    label.textContent = "更自然";
    const copy = document.createElement("p");
    copy.lang = "en";
    copy.textContent = feedback.betterExpression;
    better.append(label, copy);
    wrapper.append(better);
  }

  if (feedback.ieltsTips?.length) {
    const ielts = document.createElement("div");
    ielts.className = "free-feedback-row";
    const label = document.createElement("span");
    label.textContent = "雅思练习";
    const list = document.createElement("ul");
    feedback.ieltsTips.forEach((tip) => {
      const item = document.createElement("li");
      item.textContent = tip;
      list.append(item);
    });
    ielts.append(label, list);
    wrapper.append(ielts);
  }

  return wrapper;
}

function createFreeMessageElement(message) {
  const article = document.createElement("article");
  article.className = `free-message is-${message.role}`;

  const header = document.createElement("header");
  const meta = document.createElement("span");
  meta.className = "free-message-meta";
  meta.textContent =
    message.role === "assistant" ? "美音陪练 · 英文 / 中文" : "你的英文";
  header.append(meta);

  if (message.role === "assistant" && message.english) {
    const speakButton = document.createElement("button");
    speakButton.type = "button";
    speakButton.className = "free-message-speak";
    speakButton.textContent = "播放美音";
    speakButton.disabled = !("speechSynthesis" in window);
    speakButton.addEventListener("click", () => {
      speak(message.english, 0.94, {
        profile: FREE_CHAT_COACH_PROFILE,
        pitch: FREE_CHAT_COACH_PROFILE.pitch,
        rateScale: FREE_CHAT_COACH_PROFILE.rateScale,
        voicePreference: state.practiceVoice,
      });
    });
    header.append(speakButton);
  }

  const english = document.createElement("p");
  english.className = "free-message-en";
  english.lang = "en";
  english.textContent = message.english || "";

  article.append(header, english);

  if (message.role === "assistant" && message.chinese) {
    const chinese = document.createElement("p");
    chinese.className = "free-message-zh";
    chinese.textContent = message.chinese;
    article.append(chinese);
  }

  if (message.feedback) {
    const feedback = createFreeFeedbackBlock({
      ...message.feedback,
      originalEnglish: message.english,
    });
    if (feedback) {
      article.append(feedback);
    }
  }

  return article;
}

function renderFreeMessages() {
  const fragment = document.createDocumentFragment();
  state.freeMessages.forEach((message) => {
    fragment.append(createFreeMessageElement(message));
  });

  if (state.freeChatLoading) {
    const loading = document.createElement("div");
    loading.className = "free-message is-assistant is-loading";
    const label = document.createElement("span");
    label.className = "free-message-meta";
    label.textContent = "美音陪练";
    const copy = document.createElement("p");
    copy.className = "free-message-en";
    copy.textContent =
      state.freeChatMode === "api"
        ? "Thinking about your answer..."
        : "Preparing a follow-up...";
    loading.append(label, copy);
    fragment.append(loading);
  }

  elements.freeMessages.replaceChildren(fragment);
  requestAnimationFrame(() => {
    elements.freeMessages.scrollTop = elements.freeMessages.scrollHeight;
  });
}

function renderFreeHint() {
  const topic = getFreeTopic();
  if (!state.freeHintVisible) {
    elements.freeHint.hidden = true;
    elements.freeHint.replaceChildren();
    elements.freeHintButton.textContent = "思路提示";
    return;
  }

  const label = document.createElement("span");
  label.className = "practice-block-label";
  label.textContent = "可以从这些方向展开";
  const list = document.createElement("ul");
  (topic.ideas || []).forEach((idea) => {
    const item = document.createElement("li");
    item.textContent = idea;
    list.append(item);
  });
  elements.freeHint.replaceChildren(label, list);
  elements.freeHint.hidden = false;
  elements.freeHintButton.textContent = "收起提示";
}

function renderFreeServiceSettings() {
  const isFree = state.practiceSection === "free";
  elements.freeServiceSettings.hidden = !isFree;
  if (!isFree) {
    return;
  }

  elements.freeChatMode.value = state.freeChatMode;
  elements.freeChatModeStatus.textContent = getFreeChatModeLabel();
  elements.freeChatApiFields.hidden = state.freeChatMode !== "api";
  elements.freeChatApiUrl.value = state.freeChatApiUrl;
  elements.freeChatApiModel.value = state.freeChatApiModel;
  elements.freeChatApiKey.value = state.freeChatApiKey;
  elements.freeChatApiAuth.value = state.freeChatApiAuth;
  elements.freeChatApiStatus.textContent = state.freeChatApiMessage;
  elements.freeChatApiStatus.classList.toggle(
    "is-error",
    state.freeChatApiMessageType === "error",
  );
}

function renderFreeView() {
  const topic = getFreeTopic();
  const availability = getPracticeModeAvailability();
  const modeSummary = {
    local: "本地免费陪练 · 英文回复、中文翻译、纠错与雅思练习提示",
    api: `自定义 Chat API · ${
      state.freeChatApiModel || "未填写模型"
    } · 费用由你的接口账户结算`,
    off: "自动回复已关闭 · 只保留你的英文练习记录",
  };

  elements.freeModeSummary.textContent =
    modeSummary[state.freeChatMode] || modeSummary.local;
  elements.freeTurnCounter.textContent = `第 ${state.freeTurnCount} 轮`;
  elements.freeTopic.value = state.freeTopic;
  elements.freeAutoSpeak.checked = state.freeAutoSpeak;
  renderRealtimeBar("free");

  const realtimeActive = isRealtimeSectionActive("free");
  const liveTranscript = realtimeActive
    ? state.realtimeTranscript
    : state.practiceListening || state.practiceTranscribing
      ? state.practiceTranscript
      : "";
  elements.freeAnswerInput.value = liveTranscript || state.freeInput;
  elements.freeAnswerInput.disabled =
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive ||
    state.freeChatLoading;
  elements.freeListenButton.disabled =
    !("speechSynthesis" in window) ||
    realtimeActive ||
    state.freeChatLoading ||
    !state.freeMessages.some(
      (message) => message.role === "assistant" && message.english,
    );
  elements.freeHintButton.disabled = state.freeChatLoading || realtimeActive;
  elements.freeRecordButton.disabled =
    !availability.available ||
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive ||
    state.freeChatLoading;
  elements.freeRecordButton.textContent = state.practiceTranscribing
    ? "正在转写"
    : state.practiceRecognitionMode === "api"
      ? "开始录音"
      : "开口说";
  elements.freeRecordButton.hidden = state.practiceListening;
  elements.freeStopButton.hidden = !state.practiceListening;
  elements.freeStopButton.disabled = !state.practiceListening;
  elements.freeSubmitButton.disabled =
    !elements.freeAnswerInput.value.trim() ||
    state.practiceListening ||
    state.practiceTranscribing ||
    realtimeActive ||
    state.freeChatLoading;
  elements.freeRestartButton.disabled =
    state.freeChatLoading || realtimeActive;
  elements.freeTopic.disabled = state.freeChatLoading || realtimeActive;
  elements.freeAutoSpeak.disabled = realtimeActive;

  renderFreeMessages();
  renderFreeHint();
  renderFreeServiceSettings();

  elements.freeNotice.hidden = !state.practiceMessage;
  elements.freeNotice.textContent = state.practiceMessage;
  elements.freeNotice.classList.toggle(
    "is-error",
    state.practiceMessageType === "error",
  );
}

function renderPracticeDiff(result) {
  const fragment = document.createDocumentFragment();

  result.targetWords.forEach((word, index) => {
    const token = document.createElement("span");
    token.className = result.matchedTargetIndexes.has(index)
      ? "practice-token is-matched"
      : "practice-token is-missing";
    token.textContent = word;
    fragment.append(token);
    if (index < result.targetWords.length - 1) {
      fragment.append(" ");
    }
  });

  elements.practiceTargetDiff.replaceChildren(fragment);

  if (result.extraWords.length === 0) {
    elements.practiceExtraWords.textContent = "无";
    elements.practiceExtraWords.classList.add("is-empty");
    return;
  }

  const extraFragment = document.createDocumentFragment();
  result.extraWords.forEach((word, index) => {
    const token = document.createElement("span");
    token.className = "practice-token is-extra";
    token.textContent = word;
    extraFragment.append(token);
    if (index < result.extraWords.length - 1) {
      extraFragment.append(" ");
    }
  });
  elements.practiceExtraWords.replaceChildren(extraFragment);
  elements.practiceExtraWords.classList.remove("is-empty");
}

function renderPracticeStats() {
  const history = state.practiceHistory;
  const attempts = history.length;
  const sentenceCount = new Set(
    history.map((record) => record.itemKey || record.target),
  ).size;
  const average = attempts
    ? Math.round(
        history.reduce((sum, record) => sum + record.accuracy, 0) /
          attempts,
      )
    : 0;
  const best = attempts
    ? Math.max(...history.map((record) => record.accuracy))
    : 0;

  elements.practiceAttemptCount.textContent = String(attempts);
  elements.practiceSentenceCount.textContent = String(sentenceCount);
  elements.practiceAverageScore.textContent = `${average}%`;
  elements.practiceBestScore.textContent = `${best}%`;
  elements.practiceClearButton.disabled = attempts === 0;

  if (attempts === 0) {
    const empty = document.createElement("p");
    empty.className = "practice-history-empty";
    empty.textContent = "还没有练习记录。";
    elements.practiceHistory.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  history.slice(0, 6).forEach((record) => {
    const item = document.createElement("div");
    item.className = "practice-history-item";

    const score = document.createElement("strong");
    score.textContent = `${record.accuracy}%`;
    score.classList.toggle("is-high", record.accuracy >= 85);

    const copy = document.createElement("span");
    copy.className = "practice-history-copy";
    copy.textContent = record.target;

    const time = document.createElement("time");
    time.dateTime = record.createdAt || "";
    time.textContent = formatPracticeTime(record.createdAt);

    item.append(score, copy, time);
    fragment.append(item);
  });
  elements.practiceHistory.replaceChildren(fragment);
}

function renderPracticeView() {
  const entries = getPracticeEntries();
  const entry = getCurrentPracticeEntry();
  const dialogueScenario = getCurrentDialogueScenario();
  const isDialogue = state.practiceSection === "dialogue";
  const isFree = state.practiceSection === "free";
  const hasEntry = Boolean(entry);
  const target = hasEntry ? getPracticeTarget(entry) : "";
  const availability = getPracticeModeAvailability();
  const currentItemKey = hasEntry
    ? getItemKey(entry.resource.id, entry.item)
    : "";

  elements.practiceCounter.textContent = hasEntry
    ? `${state.practiceIndex + 1} / ${entries.length}`
    : "0 / 0";
  elements.practiceSource.textContent = isDialogue
    ? dialogueScenario
      ? `${dialogueScenario.category} · ${dialogueScenario.title} · ${dialogueScenario.turns.length} 轮情景对话`
      : "情景对话加载失败"
    : isFree
      ? `自由对话 · ${getFreeTopic().label} · ${getFreeChatModeLabel()}`
    : hasEntry
      ? `${entry.resource.category} · ${entry.resource.title} · ${entry.item.phrase}`
      : "当前视图没有可练习的句子";
  elements.practiceStatus.textContent = state.practiceStatusText;
  elements.practiceTarget.replaceChildren(
    createSentenceText(target || "暂无可练习句子"),
  );
  elements.practiceTranslation.textContent = hasEntry
    ? entry.item.translation || ""
    : "";
  elements.practiceTranslation.hidden =
    !hasEntry || !entry.item.translation;

  elements.practiceMode.value = state.practiceRecognitionMode;
  elements.practiceVoice.value = state.practiceVoice;
  elements.practiceVoiceStatus.textContent = getPracticeVoiceStatusText();
  elements.practiceModeStatus.textContent = getPracticeModeLabel();
  elements.practiceApiFields.hidden =
    state.practiceRecognitionMode !== "api";
  elements.practiceListenButton.disabled =
    !hasEntry || !("speechSynthesis" in window);
  elements.practiceRecordButton.disabled =
    !hasEntry || !availability.available || state.practiceTranscribing;
  elements.practiceRecordButton.textContent =
    state.practiceRecognitionMode === "api" ? "开始录音" : "开始跟读";
  elements.practiceRecordButton.hidden = state.practiceListening;
  elements.practiceStopButton.hidden = !state.practiceListening;
  elements.practiceStopButton.disabled = !state.practiceListening;
  elements.practicePreviousButton.disabled = entries.length <= 1;
  elements.practiceShuffleButton.disabled = entries.length <= 1;

  if (state.practiceRecognitionMode === "off") {
    elements.practiceRecognitionState.textContent = "已关闭";
  } else if (!availability.available) {
    elements.practiceRecognitionState.textContent = "需要设置";
  } else if (state.practiceTranscribing) {
    elements.practiceRecognitionState.textContent = "转写中";
  } else if (state.practiceListening) {
    elements.practiceRecognitionState.textContent =
      state.practiceRecognitionMode === "api" ? "录音中" : "聆听中";
  } else if (state.practiceTranscript) {
    elements.practiceRecognitionState.textContent = "识别完成";
  } else {
    elements.practiceRecognitionState.textContent =
      state.practiceRecognitionMode === "api" ? "API 待录音" : "未开始";
  }

  elements.practiceTranscript.textContent =
    state.practiceTranscript ||
    (state.practiceTranscribing
      ? "正在转写录音..."
      : state.practiceListening
      ? state.practiceRecognitionMode === "api"
        ? "正在录音..."
        : "正在识别..."
      : state.practiceRecognitionMode === "off"
        ? "识别已关闭"
        : "等待跟读");
  elements.practiceTranscript.classList.toggle(
    "is-placeholder",
    !state.practiceTranscript,
  );

  elements.practiceNotice.hidden = !state.practiceMessage;
  elements.practiceNotice.textContent = state.practiceMessage;
  elements.practiceNotice.classList.toggle(
    "is-error",
    state.practiceMessageType === "error",
  );

  const result = state.practiceResult;
  const showResult = Boolean(
    result && result.itemKey === currentItemKey,
  );
  elements.practiceResult.hidden = !showResult;
  if (showResult) {
    elements.practiceScore.textContent = `${result.accuracy}%`;
    elements.practiceFeedback.textContent = getPracticeFeedback(
      result.accuracy,
    );
    renderPracticeDiff(result);
  }

  updatePracticeSectionViews();
  renderDialogueView();
  renderFreeView();
  renderPracticeStats();
}

function syncPracticeSettingsForm() {
  elements.practiceMode.value = state.practiceRecognitionMode;
  elements.practiceVoice.value = state.practiceVoice;
  elements.practiceApiUrl.value = state.practiceApiUrl;
  elements.practiceApiModel.value = state.practiceApiModel;
  elements.practiceApiKey.value = state.practiceApiKey;
  elements.practiceApiAuth.value = state.practiceApiAuth;
  elements.practiceApiFields.hidden =
    state.practiceRecognitionMode !== "api";
}

function setPracticeRecognitionMode(mode) {
  const allowedModes = new Set(["browser", "api", "off"]);
  if (!allowedModes.has(mode)) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  cancelPracticeRecognition();
  state.practiceRecognitionMode = mode;
  persistPracticeSettings();
  resetPracticeAttempt();
  renderPracticeView();
  updateProgress();
}

function savePracticeApiSettings() {
  const apiUrl = elements.practiceApiUrl.value.trim();
  const apiModel = elements.practiceApiModel.value.trim();
  const apiKey = elements.practiceApiKey.value.trim();
  const apiAuth = elements.practiceApiAuth.value;

  if (apiUrl) {
    try {
      const resolved = new URL(apiUrl, window.location.href);
      if (!["http:", "https:"].includes(resolved.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      elements.practiceApiStatus.textContent =
        "接口地址格式不正确，请填写 http 或 https 地址。";
      elements.practiceApiStatus.classList.add("is-error");
      return;
    }
  }

  state.practiceApiUrl = apiUrl;
  state.practiceApiModel = apiModel;
  state.practiceApiKey = apiKey;
  state.practiceApiAuth = apiAuth;
  persistPracticeSettings();
  elements.practiceApiStatus.textContent = "接口配置已保存在当前浏览器。";
  elements.practiceApiStatus.classList.remove("is-error");
  resetPracticeAttempt();
  renderPracticeView();
}

function setFreeChatMode(mode) {
  const allowedModes = new Set(["local", "api", "off"]);
  if (!allowedModes.has(mode)) {
    return;
  }

  stopRealtimeConversation("", { silent: true });
  state.freeChatMode = mode;
  state.freeChatApiMessage = "";
  state.freeChatApiMessageType = "";
  persistPracticeSettings();
  renderPracticeView();
}

function saveFreeChatApiSettings() {
  const apiUrl = elements.freeChatApiUrl.value.trim();
  const apiModel = elements.freeChatApiModel.value.trim();
  const apiKey = elements.freeChatApiKey.value.trim();
  const apiAuth = elements.freeChatApiAuth.value;

  if (apiUrl) {
    try {
      const resolved = new URL(apiUrl, window.location.href);
      if (!["http:", "https:"].includes(resolved.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      elements.freeChatApiStatus.textContent =
        "接口地址格式不正确，请填写 http 或 https 地址。";
      elements.freeChatApiStatus.classList.add("is-error");
      return;
    }
  }

  state.freeChatApiUrl = apiUrl;
  state.freeChatApiModel = apiModel;
  state.freeChatApiKey = apiKey;
  state.freeChatApiAuth = apiAuth;
  state.freeChatApiMessage = apiUrl
    ? "Chat 接口配置已保存在当前浏览器。"
    : "已清空 Chat 接口地址，自由对话会使用本地免费陪练。";
  state.freeChatApiMessageType = "info";
  persistPracticeSettings();
  renderPracticeView();
}

function openPractice(targetKey = "") {
  stopRealtimeConversation("", { silent: true });
  state.reviewActive = false;
  state.reviewQueue = [];
  state.reviewQueueIndex = 0;
  state.reviewRevealed = false;

  const entries = getPracticeEntries();
  const targetIndex = targetKey
    ? entries.findIndex(
        ({ resource, item }) =>
          getItemKey(resource.id, item) === targetKey,
      )
    : -1;

  if (targetKey) {
    state.practiceSection = "shadow";
  }
  state.practiceActive = true;
  if (targetIndex >= 0) {
    state.practiceIndex = targetIndex;
  } else if (
    state.practiceIndex < 0 ||
    state.practiceIndex >= entries.length
  ) {
    state.practiceIndex = 0;
  }

  if (state.practiceSection === "dialogue") {
    clearDialogueAttempt();
  } else {
    resetPracticeAttempt();
  }
  syncPracticeSettingsForm();
  if (entries.length === 0) {
    state.practiceMessage = "当前视图没有可练习的句子，请先选择其他素材。";
    state.practiceMessageType = "error";
    state.practiceStatusText = "暂无句子";
  }
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closePractice() {
  stopRealtimeConversation("", { silent: true });
  cancelPracticeRecognition();
  state.practiceActive = false;
  state.practiceTranscript = "";
  state.practiceFinalTranscript = "";
  state.practiceInterimTranscript = "";
  state.practiceResult = null;
  render();
  elements.practiceButton.focus();
}

function movePractice(offset) {
  const entries = getPracticeEntries();
  if (entries.length === 0) {
    return;
  }

  cancelPracticeRecognition();
  state.practiceIndex =
    (state.practiceIndex + offset + entries.length) % entries.length;
  resetPracticeAttempt();
  render();
}

function shufflePractice() {
  const entries = getPracticeEntries();
  if (entries.length <= 1) {
    return;
  }

  cancelPracticeRecognition();
  let nextIndex = state.practiceIndex;
  while (nextIndex === state.practiceIndex) {
    nextIndex = Math.floor(Math.random() * entries.length);
  }
  state.practiceIndex = nextIndex;
  resetPracticeAttempt();
  render();
}

function addPracticeHistory(entry, target, transcript, accuracy) {
  state.practiceHistory.unshift({
    itemKey: getItemKey(entry.resource.id, entry.item),
    resourceTitle: entry.resource.title,
    target,
    transcript,
    accuracy,
    createdAt: new Date().toISOString(),
  });
  state.practiceHistory = state.practiceHistory.slice(0, 80);
  persistPracticeHistory();
}

function finalizePracticeAttempt(transcript) {
  const entry = getCurrentPracticeEntry();
  const target = getPracticeTarget(entry);
  if (!entry || !target) {
    return;
  }

  const cleanedTranscript = String(transcript || "").trim();
  const result = comparePracticeText(target, cleanedTranscript);
  state.practiceTranscript = cleanedTranscript;
  state.practiceResult = {
    ...result,
    itemKey: getItemKey(entry.resource.id, entry.item),
    transcript: cleanedTranscript,
  };
  state.practiceStatusText = `${result.accuracy}%`;
  addPracticeHistory(
    entry,
    target,
    cleanedTranscript,
    result.accuracy,
  );
  renderPracticeView();
  updateProgress();
}

function getRecognitionErrorMessage(errorType) {
  const messages = {
    "not-allowed":
      "麦克风权限未开启，请在浏览器地址栏允许麦克风后重试。",
    "service-not-allowed":
      "浏览器未允许语音识别服务，请使用最新版 Chrome 或 Edge。",
    "audio-capture": "没有检测到可用麦克风。",
    network: "语音识别服务连接失败，请检查网络后重试。",
    "no-speech": "没有识别到语音，请靠近麦克风再试一次。",
    aborted: "",
  };
  return messages[errorType] || "语音识别中断，请再试一次。";
}

function extractApiTranscript(text) {
  const rawText = String(text || "").trim();
  if (!rawText) {
    return "";
  }

  try {
    const data = JSON.parse(rawText);
    return String(
      data.text ||
        data.transcript ||
        data.result?.text ||
        data.result?.transcript ||
        data.data?.text ||
        "",
    ).trim();
  } catch {
    return rawText;
  }
}

function buildPracticeApiHeaders() {
  const headers = {};
  if (!state.practiceApiKey || state.practiceApiAuth === "none") {
    return headers;
  }

  if (state.practiceApiAuth === "x-api-key") {
    headers["x-api-key"] = state.practiceApiKey;
  } else {
    headers.Authorization = `Bearer ${state.practiceApiKey}`;
  }
  return headers;
}

async function transcribePracticeAudio(
  audioBlob,
  onTranscript = finalizePracticeAttempt,
) {
  const controller = new AbortController();
  practiceApiAbortController = controller;
  state.practiceTranscribing = true;
  state.practiceMessage = "";
  state.practiceMessageType = "";
  state.practiceStatusText = "正在转写";
  renderPracticeView();

  const formData = new FormData();
  const extension = audioBlob.type.includes("mp4")
    ? "mp4"
    : audioBlob.type.includes("ogg")
      ? "ogg"
      : "webm";
  formData.append("file", audioBlob, `speaking-answer.${extension}`);
  if (state.practiceApiModel) {
    formData.append("model", state.practiceApiModel);
  }
  formData.append("language", "en");

  try {
    const response = await fetch(state.practiceApiUrl, {
      method: "POST",
      headers: buildPracticeApiHeaders(),
      body: formData,
      signal: controller.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      let serverMessage = "";
      try {
        const errorData = JSON.parse(responseText);
        serverMessage =
          errorData.error?.message ||
          errorData.message ||
          errorData.error ||
          "";
      } catch {
        serverMessage = responseText;
      }
      throw new Error(
        String(serverMessage || `语音接口返回 ${response.status}`).slice(
          0,
          180,
        ),
      );
    }

    const transcript = extractApiTranscript(responseText);
    if (!transcript) {
      throw new Error("语音接口没有返回可用文本。");
    }

    state.practiceTranscribing = false;
    practiceApiAbortController = null;
    onTranscript(transcript);
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }

    state.practiceTranscribing = false;
    practiceApiAbortController = null;
    state.practiceMessage =
      error.message ||
      "语音转写失败，请检查接口地址、网络和跨域设置。";
    state.practiceMessageType = "error";
    state.practiceStatusText = "转写失败";
    renderPracticeView();
  }
}

async function startApiPracticeRecording({
  onTranscript = finalizePracticeAttempt,
  requireEntry = true,
} = {}) {
  const availability = getPracticeModeAvailability();
  if (!availability.available) {
    state.practiceMessage = availability.message;
    state.practiceMessageType = "error";
    state.practiceStatusText = "需要设置";
    renderPracticeView();
    return;
  }

  const entry = requireEntry ? getCurrentPracticeEntry() : null;
  if (requireEntry && !entry) {
    state.practiceMessage = "当前没有可跟读的句子。";
    state.practiceMessageType = "error";
    renderPracticeView();
    return;
  }

  cancelPracticeRecognition();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  state.practiceFinalTranscript = "";
  state.practiceInterimTranscript = "";
  state.practiceTranscript = "";
  state.practiceResult = null;
  state.practiceMessage = "";
  state.practiceMessageType = "";
  state.practiceStatusText = "等待麦克风权限";
  state.practiceListening = true;
  renderPracticeView();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    if (!state.practiceActive || !state.practiceListening) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    practiceMediaStream = stream;
    const preferredTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    const mimeType = preferredTypes.find((type) =>
      window.MediaRecorder.isTypeSupported?.(type),
    );
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    practiceMediaRecorder = recorder;
    practiceAudioChunks = [];
    state.practiceStatusText = "正在录音";
    renderPracticeView();

    recorder.ondataavailable = (event) => {
      if (event.data?.size) {
        practiceAudioChunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      cancelPracticeRecognition();
      state.practiceMessage = "录音过程发生错误，请重新开始。";
      state.practiceMessageType = "error";
      state.practiceStatusText = "录音失败";
      renderPracticeView();
    };

    recorder.onstop = () => {
      if (practiceMediaRecorder !== recorder) {
        return;
      }

      practiceMediaRecorder = null;
      state.practiceListening = false;
      if (practiceMediaStream) {
        practiceMediaStream.getTracks().forEach((track) => track.stop());
        practiceMediaStream = null;
      }

      const chunks = practiceAudioChunks;
      practiceAudioChunks = [];
      const audioBlob = new Blob(chunks, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      if (!audioBlob.size) {
        state.practiceMessage = "没有录到音频，请重新开始。";
        state.practiceMessageType = "error";
        state.practiceStatusText = "没有音频";
        renderPracticeView();
        return;
      }

      transcribePracticeAudio(audioBlob, onTranscript);
    };

    recorder.start();
  } catch (error) {
    cancelPracticeRecognition();
    state.practiceMessage =
      error?.name === "NotAllowedError"
        ? "麦克风权限未开启，请在浏览器地址栏允许麦克风后重试。"
        : error?.name === "NotFoundError"
          ? "没有检测到可用麦克风。"
          : "录音启动失败，请检查麦克风权限后重试。";
    state.practiceMessageType = "error";
    state.practiceStatusText = "启动失败";
    renderPracticeView();
  }
}

function startPracticeRecording() {
  if (state.practiceListening || state.practiceTranscribing) {
    return;
  }

  if (state.practiceRecognitionMode === "off") {
    state.practiceMessage =
      "语音识别已关闭，仍可使用示范朗读和句子对照。";
    state.practiceMessageType = "info";
    state.practiceStatusText = "已关闭";
    renderPracticeView();
    return;
  }

  if (state.practiceRecognitionMode === "api") {
    startApiPracticeRecording();
    return;
  }

  startBrowserPracticeRecording();
}

function stopPracticeRecording() {
  if (
    state.practiceRecognitionMode === "api" &&
    practiceMediaRecorder
  ) {
    state.practiceStatusText = "正在转写";
    renderPracticeView();
    try {
      practiceMediaRecorder.stop();
    } catch {
      cancelPracticeRecognition();
      state.practiceMessage = "录音已停止，请重新开始。";
      state.practiceMessageType = "error";
      state.practiceStatusText = "已停止";
      renderPracticeView();
    }
    return;
  }

  if (!practiceRecognition) {
    return;
  }

  state.practiceStatusText = "正在结束";
  renderPracticeView();
  try {
    practiceRecognition.stop();
  } catch {
    cancelPracticeRecognition();
    state.practiceMessage = "语音识别已停止，请重新开始。";
    state.practiceMessageType = "error";
    state.practiceStatusText = "已停止";
    renderPracticeView();
  }
}

function startBrowserPracticeRecording({
  onTranscript = finalizePracticeAttempt,
  requireEntry = true,
} = {}) {
  if (state.practiceListening) {
    return;
  }

  const Recognition = getSpeechRecognitionConstructor();
  const entry = requireEntry ? getCurrentPracticeEntry() : null;
  if (!Recognition) {
    state.practiceMessage =
      "当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。";
    state.practiceMessageType = "error";
    state.practiceStatusText = "浏览器不支持";
    renderPracticeView();
    return;
  }
  if (requireEntry && !entry) {
    state.practiceMessage = "当前没有可跟读的句子。";
    state.practiceMessageType = "error";
    renderPracticeView();
    return;
  }

  cancelPracticeRecognition();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  const recognition = new Recognition();
  state.practiceFinalTranscript = "";
  state.practiceInterimTranscript = "";
  state.practiceTranscript = "";
  state.practiceResult = null;
  state.practiceMessage = "";
  state.practiceMessageType = "";
  state.practiceStatusText = "正在聆听";
  state.practiceListening = true;
  practiceRecognition = recognition;

  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.practiceStatusText = "正在聆听";
    renderPracticeView();
  };

  recognition.onresult = (event) => {
    let interimTranscript = "";
    const startIndex = Number.isInteger(event.resultIndex)
      ? event.resultIndex
      : 0;

    for (
      let resultIndex = startIndex;
      resultIndex < event.results.length;
      resultIndex += 1
    ) {
      const transcript = event.results[resultIndex][0]?.transcript || "";
      if (event.results[resultIndex].isFinal) {
        state.practiceFinalTranscript =
          `${state.practiceFinalTranscript} ${transcript}`.trim();
      } else {
        interimTranscript =
          `${interimTranscript} ${transcript}`.trim();
      }
    }

    state.practiceInterimTranscript = interimTranscript;
    state.practiceTranscript =
      `${state.practiceFinalTranscript} ${interimTranscript}`.trim();
    state.practiceStatusText = state.practiceTranscript
      ? "已识别到语音"
      : "正在聆听";
    renderPracticeView();
  };

  recognition.onerror = (event) => {
    if (event.error === "aborted") {
      return;
    }
    state.practiceMessage = getRecognitionErrorMessage(event.error);
    state.practiceMessageType = "error";
    state.practiceStatusText = "识别中断";
    renderPracticeView();
  };

  recognition.onend = () => {
    if (practiceRecognition !== recognition) {
      return;
    }

    practiceRecognition = null;
    state.practiceListening = false;
    const transcript =
      `${state.practiceFinalTranscript} ${state.practiceInterimTranscript}`.trim();

    if (transcript) {
      onTranscript(transcript);
      return;
    }

    if (!state.practiceMessage) {
      state.practiceMessage =
        "没有识别到语音，请靠近麦克风再试一次。";
      state.practiceMessageType = "error";
    }
    state.practiceStatusText = "未识别到语音";
    renderPracticeView();
  };

  renderPracticeView();
  try {
    recognition.start();
  } catch {
    cancelPracticeRecognition();
    state.practiceMessage = "语音识别启动失败，请刷新页面后重试。";
    state.practiceMessageType = "error";
    state.practiceStatusText = "启动失败";
    renderPracticeView();
  }
}

function playPracticeTarget() {
  const entry = getCurrentPracticeEntry();
  const target = getPracticeTarget(entry);
  if (!target) {
    return;
  }

  if (
    !speak(target, state.practiceRate, {
      voicePreference: state.practiceVoice,
    })
  ) {
    state.practiceMessage =
      "当前浏览器不支持语音朗读，请使用最新版 Chrome、Edge 或 Safari。";
    state.practiceMessageType = "error";
    state.practiceStatusText = "无法朗读";
    renderPracticeView();
    return;
  }

  state.practiceMessage = "";
  state.practiceMessageType = "";
  state.practiceStatusText = "正在播放示范";
  renderPracticeView();
}

function normalizeLookupWord(value) {
  return String(value || "")
    .trim()
    .replace(/[’]/g, "'")
    .toLocaleLowerCase("en-US");
}

function setWordButtonExpanded(button, expanded) {
  if (button) {
    button.setAttribute("aria-expanded", String(expanded));
  }
}

function closeWordPopover() {
  wordLookupRequestId += 1;
  elements.wordPopover.hidden = true;
  setWordButtonExpanded(activeWordButton, false);
  activeWordButton = null;
}

function positionWordPopover(anchor) {
  const anchorRect = anchor.getBoundingClientRect();
  const popoverRect = elements.wordPopover.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 8;
  const maxLeft = Math.max(
    viewportPadding,
    window.innerWidth - popoverRect.width - viewportPadding,
  );
  const maxTop = Math.max(
    viewportPadding,
    window.innerHeight - popoverRect.height - viewportPadding,
  );
  const centeredLeft =
    anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
  let top = anchorRect.bottom + gap;

  if (top > maxTop) {
    top = anchorRect.top - popoverRect.height - gap;
  }

  elements.wordPopover.style.left = `${Math.min(
    Math.max(centeredLeft, viewportPadding),
    maxLeft,
  )}px`;
  elements.wordPopover.style.top = `${Math.min(
    Math.max(top, viewportPadding),
    maxTop,
  )}px`;
}

function renderWordPopoverContent(result) {
  const content = document.createDocumentFragment();
  const translations = Array.isArray(result.translations)
    ? result.translations
    : [];
  const definitions = Array.isArray(result.definitions)
    ? result.definitions
    : [];

  if (translations.length > 0) {
    const label = document.createElement("span");
    label.className = "word-popover-label";
    label.textContent = "中文释义";
    content.append(label);

    translations.forEach((translation) => {
      const meaning = document.createElement("p");
      meaning.className = "word-popover-meaning";
      meaning.textContent = translation;
      content.append(meaning);
    });
  } else if (definitions.length > 0) {
    const label = document.createElement("span");
    label.className = "word-popover-label";
    label.textContent = "英文释义";
    content.append(label);

    definitions.forEach((definition) => {
      const meaning = document.createElement("p");
      meaning.className = "word-popover-meaning";
      meaning.textContent = definition;
      content.append(meaning);
    });
  } else {
    const message = document.createElement("p");
    message.className = "word-popover-status is-error";
    message.textContent = "暂时没有查到这个词。";
    content.append(message);
  }

  elements.wordPopoverContent.replaceChildren(content);
}

async function lookupWord(word, anchor) {
  const normalizedWord = normalizeLookupWord(word);
  if (!normalizedWord) {
    return;
  }

  if (activeWordButton === anchor && !elements.wordPopover.hidden) {
    closeWordPopover();
    return;
  }

  setWordButtonExpanded(activeWordButton, false);
  activeWordButton = anchor;
  setWordButtonExpanded(activeWordButton, true);
  elements.wordPopover.hidden = false;
  elements.wordPopoverWord.textContent = normalizedWord;
  elements.wordPopoverPhonetic.textContent = "";
  elements.wordPopoverPhonetic.hidden = true;

  const loading = document.createElement("p");
  loading.className = "word-popover-status";
  loading.textContent = "正在查询...";
  elements.wordPopoverContent.replaceChildren(loading);
  positionWordPopover(anchor);

  const requestId = ++wordLookupRequestId;

  try {
    let result = wordLookupCache.get(normalizedWord);
    if (!result) {
      const response = await fetch(
        `${WORD_API_PATH}?word=${encodeURIComponent(normalizedWord)}`,
        { cache: "no-store" },
      );
      result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.message || "暂时没有查到这个词");
      }

      if (wordLookupCache.size >= 300) {
        wordLookupCache.delete(wordLookupCache.keys().next().value);
      }
      wordLookupCache.set(normalizedWord, result);
    }

    if (requestId !== wordLookupRequestId) {
      return;
    }

    elements.wordPopoverWord.textContent = result.word || normalizedWord;
    elements.wordPopoverPhonetic.textContent = result.phonetic || "";
    elements.wordPopoverPhonetic.hidden = !result.phonetic;
    renderWordPopoverContent(result);
    positionWordPopover(anchor);
  } catch (error) {
    if (requestId !== wordLookupRequestId) {
      return;
    }

    const message = document.createElement("p");
    message.className = "word-popover-status is-error";
    message.textContent = error.message || "查询失败，请稍后再试。";
    elements.wordPopoverContent.replaceChildren(message);
    positionWordPopover(anchor);
  }
}

function createSentenceText(text) {
  const fragment = document.createDocumentFragment();
  const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  const source = String(text || "");
  let lastIndex = 0;
  let match = pattern.exec(source);

  while (match) {
    if (match.index > lastIndex) {
      fragment.append(source.slice(lastIndex, match.index));
    }

    const word = match[0];
    const wordButton = document.createElement("button");
    wordButton.className = "word-lookup";
    wordButton.type = "button";
    wordButton.dataset.word = word;
    wordButton.textContent = word;
    wordButton.setAttribute("aria-haspopup", "dialog");
    wordButton.setAttribute("aria-expanded", "false");
    wordButton.setAttribute("aria-label", `查看 ${word} 的释义`);
    wordButton.addEventListener("click", (event) => {
      event.stopPropagation();
      lookupWord(word, wordButton);
    });
    fragment.append(wordButton);

    lastIndex = pattern.lastIndex;
    match = pattern.exec(source);
  }

  if (lastIndex < source.length) {
    fragment.append(source.slice(lastIndex));
  }

  return fragment;
}

function formatResourceIndex(index) {
  return String(index + 1).padStart(2, "0");
}

function getCategoryDefinitions() {
  const categories = new Map();

  function registerCategory(name, sections = []) {
    const categoryName = String(name || "").trim();
    if (!categoryName) {
      return;
    }

    if (!categories.has(categoryName)) {
      categories.set(categoryName, new Set());
    }

    const sectionSet = categories.get(categoryName);
    sections.forEach((section) => {
      const sectionName = String(section || "").trim();
      if (sectionName) {
        sectionSet.add(sectionName);
      }
    });
  }

  state.categories.forEach((category) => {
    const categoryName =
      typeof category === "string" ? category : category?.name;
    const sections = Array.isArray(category?.sections)
      ? category.sections
      : [];
    registerCategory(categoryName, sections);
  });

  state.resources.forEach((resource) => {
    registerCategory(resource.category || "未分类素材", [
      resource.section || "",
    ]);
  });

  return [...categories.entries()]
    .sort(([left], [right]) => compareCategoryNames(left, right))
    .map(([name, sections]) => ({
      name,
      sections: [...sections].sort((left, right) =>
        left.localeCompare(right, "zh-CN"),
      ),
    }));
}

function getAnkiExportEntries(
  categoryName = state.ankiExportCategory,
  sectionName = state.ankiExportSection,
) {
  return state.resources
    .filter((resource) => {
      const resourceCategory = resource.category || "未分类素材";
      const resourceSection = resource.section || "";
      if (categoryName !== "all" && resourceCategory !== categoryName) {
        return false;
      }
      return (
        categoryName === "all" ||
        sectionName === "all" ||
        resourceSection === sectionName
      );
    })
    .flatMap((resource) =>
      (state.decks.get(resource.id) || []).map((item) => ({
        item,
        resource,
      })),
    );
}

function getAnkiExportScopeLabel() {
  if (state.ankiExportCategory === "all") {
    return "整个素材库";
  }
  if (state.ankiExportSection === "all") {
    return `${state.ankiExportCategory} · 整个分类`;
  }
  return `${state.ankiExportCategory} / ${state.ankiExportSection}`;
}

function getAnkiExportDeckName() {
  const deckParts = ["iball的小屋"];
  if (state.ankiExportCategory === "all") {
    deckParts.push("全部分类");
  } else {
    deckParts.push(state.ankiExportCategory);
    if (state.ankiExportSection !== "all") {
      deckParts.push(state.ankiExportSection);
    }
  }
  return deckParts
    .map((part) => String(part || "").replace(/::/g, " / ").trim())
    .filter(Boolean)
    .join("::");
}

function escapeAnkiCsvField(value) {
  const text = String(value ?? "").replace(/\r\n|\r|\n/g, "\r\n");
  return `"${text.replace(/"/g, '""')}"`;
}

function buildAnkiExportBack(item) {
  const backParts = [];
  if (item.translation) {
    backParts.push(item.translation);
  }

  const annotation = [];
  if (item.meaning) {
    annotation.push(`释义：${item.meaning}`);
  }
  if (item.phonetic) {
    annotation.push(`音标：${item.phonetic}`);
  }
  if (annotation.length > 0) {
    backParts.push(annotation.join("\n"));
  }

  return backParts.join("\n\n") || item.phrase || "";
}

function buildAnkiExportCsv(entries) {
  const lines = [
    "#separator:Comma",
    "#html:false",
    "#notetype:Basic",
    `#deck:${getAnkiExportDeckName()}`,
    "#columns:Front,Back",
  ];

  entries.forEach(({ item }) => {
    lines.push(
      [
        escapeAnkiCsvField(item.sentence || item.phrase || ""),
        escapeAnkiCsvField(buildAnkiExportBack(item)),
      ].join(","),
    );
  });

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function getAnkiExportFileName() {
  const scope = getAnkiExportScopeLabel()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `iball的小屋-${scope || "Anki"}-${date}.csv`;
}

function setAnkiExportStatus(message = "", type = "") {
  state.ankiExportStatus = message;
  state.ankiExportStatusType = type;
}

function renderAnkiExport() {
  const definitions = getCategoryDefinitions();
  const categoryNames = new Set(definitions.map((category) => category.name));
  if (
    state.ankiExportCategory !== "all" &&
    !categoryNames.has(state.ankiExportCategory)
  ) {
    state.ankiExportCategory = "all";
    state.ankiExportSection = "all";
  }

  const categoryFragment = document.createDocumentFragment();
  const allCategoryOption = document.createElement("option");
  allCategoryOption.value = "all";
  allCategoryOption.textContent = "整个素材库";
  categoryFragment.append(allCategoryOption);
  definitions.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    categoryFragment.append(option);
  });
  elements.ankiExportCategory.replaceChildren(categoryFragment);
  elements.ankiExportCategory.value = state.ankiExportCategory;

  const selectedCategory = definitions.find(
    (category) => category.name === state.ankiExportCategory,
  );
  const sectionNames =
    state.ankiExportCategory === "all"
      ? []
      : selectedCategory?.sections || [];
  if (
    state.ankiExportSection !== "all" &&
    !sectionNames.includes(state.ankiExportSection)
  ) {
    state.ankiExportSection = "all";
  }

  const sectionFragment = document.createDocumentFragment();
  const allSectionOption = document.createElement("option");
  allSectionOption.value = "all";
  allSectionOption.textContent =
    state.ankiExportCategory === "all" ? "整个素材库" : "整个分类";
  sectionFragment.append(allSectionOption);
  sectionNames.forEach((sectionName) => {
    const option = document.createElement("option");
    option.value = sectionName;
    option.textContent = sectionName;
    sectionFragment.append(option);
  });
  elements.ankiExportSection.replaceChildren(sectionFragment);
  elements.ankiExportSection.value = state.ankiExportSection;
  elements.ankiExportSection.disabled =
    state.ankiExportCategory === "all" || sectionNames.length === 0;

  const entries = getAnkiExportEntries();
  elements.ankiExportCount.textContent = String(entries.length);
  elements.ankiExportScope.textContent = `· ${getAnkiExportScopeLabel()}`;
  elements.ankiExportDownloadButton.disabled = entries.length === 0;
  elements.ankiExportStatus.textContent = state.ankiExportStatus;
  elements.ankiExportStatus.classList.toggle(
    "is-error",
    state.ankiExportStatusType === "error",
  );
}

function openAnkiExport() {
  elements.ankiExportPanel.hidden = false;
  elements.ankiExportButton.setAttribute("aria-expanded", "true");
  renderAnkiExport();
  elements.ankiExportCategory.focus();
}

function closeAnkiExport({ restoreFocus = false } = {}) {
  elements.ankiExportPanel.hidden = true;
  elements.ankiExportButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) {
    elements.ankiExportButton.focus();
  }
}

function downloadAnkiExport() {
  const entries = getAnkiExportEntries();
  if (entries.length === 0) {
    setAnkiExportStatus("当前范围没有可导出的词卡。", "error");
    renderAnkiExport();
    return;
  }

  const csv = buildAnkiExportCsv(entries);
  const fileName = getAnkiExportFileName();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);

  setAnkiExportStatus(`已生成 ${entries.length} 条词卡：${fileName}`);
  renderAnkiExport();
}

function getReviewDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function restoreReviewData() {
  try {
    const stored = JSON.parse(
      localStorage.getItem(REVIEW_PROGRESS_STORAGE_KEY) || "{}",
    );
    state.reviewProgress =
      stored && typeof stored === "object" && !Array.isArray(stored)
        ? stored
        : {};
  } catch {
    state.reviewProgress = {};
  }

  const today = getReviewDayKey();
  let daily = null;
  try {
    daily = JSON.parse(
      localStorage.getItem(REVIEW_DAILY_STORAGE_KEY) || "{}",
    );
  } catch {
    daily = null;
  }

  if (daily && daily.date === today) {
    state.reviewDaily = {
      date: today,
      reviewedKeys: Array.isArray(daily.reviewedKeys)
        ? daily.reviewedKeys.filter((key) => typeof key === "string")
        : [],
      newKeys: Array.isArray(daily.newKeys)
        ? daily.newKeys.filter((key) => typeof key === "string")
        : [],
    };
    return;
  }

  state.reviewDaily = { date: today, reviewedKeys: [], newKeys: [] };
}

function persistReviewProgress() {
  try {
    localStorage.setItem(
      REVIEW_PROGRESS_STORAGE_KEY,
      JSON.stringify(state.reviewProgress),
    );
  } catch {
    // Storage may be unavailable in private mode; the session still works.
  }
}

function persistReviewDaily() {
  try {
    localStorage.setItem(
      REVIEW_DAILY_STORAGE_KEY,
      JSON.stringify(state.reviewDaily),
    );
  } catch {
    // Storage may be unavailable in private mode; the session still works.
  }
}

function getReviewEntries() {
  return getAnkiExportEntries(state.reviewCategory, state.reviewSection);
}

function getReviewRecord(cardKey) {
  const record = state.reviewProgress[cardKey];
  return record && typeof record === "object" ? record : null;
}

function formatReviewInterval(milliseconds) {
  const value = Number(milliseconds);
  if (!Number.isFinite(value) || value <= 0) {
    return "现在";
  }

  const minutes = value / 60000;
  if (minutes < 1) {
    return "1 分钟内";
  }
  if (minutes < 60) {
    return `${Math.round(minutes)} 分钟后`;
  }

  const hours = minutes / 60;
  if (hours < 24) {
    return `${Math.round(hours)} 小时后`;
  }

  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days} 天后`;
  }
  if (days < 365) {
    return `${Math.round(days / 30)} 个月后`;
  }
  return `${Math.round(days / 365)} 年后`;
}

function clampReviewEase(value) {
  return Math.min(3.1, Math.max(1.3, value));
}

function computeReviewSchedule(previous, grade, now = Date.now()) {
  const base = previous || {};
  const ease = clampReviewEase(Number(base.ease) || 2.5);
  const previousInterval = Math.max(0, Number(base.intervalDays) || 0);
  const reps = Math.max(0, Number(base.reps) || 0);
  const lapses = Math.max(0, Number(base.lapses) || 0);
  const status = base.status === "review" ? "review" : "learning";
  const step = Math.max(0, Number(base.step) || 0);
  const isReview = status === "review" && previousInterval >= 1;

  const schedule = (intervalDays, nextEase, nextStep, nextStatus, dueAt) => {
    const capped = Math.min(REVIEW_MAX_INTERVAL_DAYS, intervalDays);
    const fuzzed =
      capped >= 3 ? capped * (0.97 + Math.random() * 0.06) : capped;
    const finalDays = Math.max(0, Math.round(fuzzed * 100) / 100);
    return {
      ease: clampReviewEase(nextEase),
      intervalDays: finalDays,
      step: nextStep,
      status: nextStatus,
      reps: reps + 1,
      lapses,
      lastGrade: grade,
      reviewedAt: now,
      dueAt:
        Number.isFinite(dueAt) && dueAt > 0
          ? dueAt
          : now + finalDays * REVIEW_DAY_MS,
    };
  };

  if (grade === "again") {
    return schedule(0, ease - 0.2, 0, "learning", now + 60 * 1000);
  }

  if (grade === "hard") {
    if (isReview) {
      return schedule(
        Math.max(1, previousInterval * 1.2),
        ease - 0.15,
        step,
        "review",
      );
    }
    const delay = step === 0 ? 2 * 60 * 1000 : 8 * 60 * 1000;
    return schedule(0, ease, step, "learning", now + delay);
  }

  if (grade === "good") {
    if (isReview) {
      return schedule(previousInterval * ease, ease, step, "review");
    }
    const nextStep = step + 1;
    if (nextStep >= REVIEW_LEARNING_STEPS_MS.length) {
      return schedule(1, ease, nextStep, "review", now + REVIEW_DAY_MS);
    }
    return schedule(
      0,
      ease,
      nextStep,
      "learning",
      now + REVIEW_LEARNING_STEPS_MS[nextStep],
    );
  }

  if (isReview) {
    return schedule(
      Math.max(2, previousInterval * ease * 1.3),
      ease + 0.15,
      step,
      "review",
    );
  }

  const easyStep = Math.max(step, REVIEW_LEARNING_STEPS_MS.length);
  return schedule(4, ease + 0.15, easyStep, "review", now + 4 * REVIEW_DAY_MS);
}

function markReviewDaily(cardKey, isNew) {
  if (state.reviewDaily.date !== getReviewDayKey()) {
    state.reviewDaily = {
      date: getReviewDayKey(),
      reviewedKeys: [],
      newKeys: [],
    };
  }

  if (!state.reviewDaily.reviewedKeys.includes(cardKey)) {
    state.reviewDaily.reviewedKeys.push(cardKey);
  }
  if (isNew && !state.reviewDaily.newKeys.includes(cardKey)) {
    state.reviewDaily.newKeys.push(cardKey);
  }
  persistReviewDaily();
}

function getCurrentReviewEntry() {
  return state.reviewQueue[state.reviewQueueIndex] || null;
}

function startReviewSession() {
  const entries = getReviewEntries();
  const now = Date.now();
  const dueEntries = [];
  const freshEntries = [];
  let masteredCount = 0;

  entries.forEach((entry) => {
    const record = getReviewRecord(entry.item.id);
    if (!record || !Number(record.reps)) {
      freshEntries.push(entry);
      return;
    }
    if ((Number(record.dueAt) || 0) <= now) {
      dueEntries.push(entry);
      return;
    }
    masteredCount += 1;
  });

  dueEntries.sort(
    (left, right) =>
      (Number(getReviewRecord(left.item.id)?.dueAt) || 0) -
      (Number(getReviewRecord(right.item.id)?.dueAt) || 0),
  );

  const remainingNew = Math.max(
    0,
    state.reviewNewLimit - state.reviewDaily.newKeys.length,
  );
  state.reviewQueue = [
    ...dueEntries,
    ...freshEntries.slice(0, remainingNew),
  ];
  state.reviewQueueIndex = 0;
  state.reviewRevealed = false;
  state.reviewSessionDone = 0;
  state.reviewMessage = entries.length
    ? state.reviewQueue.length
      ? "队列已重新整理。"
      : masteredCount === entries.length
        ? "范围内的卡片都已经安排到未来，稍后再来复习。"
        : "今天的新卡额度已经用完，明天会解锁新的卡片。"
    : "当前范围没有可复习的卡片。";
  state.reviewMessageType = "";
}

function openReview() {
  stopRealtimeConversation("", { silent: true });
  cancelPracticeRecognition();
  state.practiceActive = false;
  state.reviewActive = true;
  startReviewSession();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function closeReview() {
  state.reviewActive = false;
  state.reviewQueue = [];
  state.reviewQueueIndex = 0;
  state.reviewRevealed = false;
  render();
  elements.reviewButton.focus();
}

function revealReviewCard() {
  if (!getCurrentReviewEntry() || state.reviewRevealed) {
    return;
  }
  state.reviewRevealed = true;
  state.reviewMessage = "";
  state.reviewMessageType = "";
  renderReviewView();
}

function gradeReviewCard(grade) {
  if (!REVIEW_GRADES.includes(grade)) {
    return;
  }

  const entry = getCurrentReviewEntry();
  if (!entry || !state.reviewRevealed) {
    return;
  }

  const cardKey = entry.item.id;
  const previous = getReviewRecord(cardKey);
  const isNew = !previous || !Number(previous.reps);
  const record = computeReviewSchedule(previous, grade, Date.now());
  state.reviewProgress[cardKey] = record;
  persistReviewProgress();
  markReviewDaily(cardKey, isNew);

  const needsRelearn = record.status !== "review";
  state.reviewQueue.splice(state.reviewQueueIndex, 1);
  if (needsRelearn) {
    const insertAt = Math.min(
      state.reviewQueue.length,
      state.reviewQueueIndex + 3,
    );
    state.reviewQueue.splice(insertAt, 0, entry);
  }
  if (state.reviewQueueIndex >= state.reviewQueue.length) {
    state.reviewQueueIndex = 0;
  }

  state.reviewRevealed = false;
  state.reviewSessionDone += 1;
  state.reviewMessage = `${entry.item.phrase} · 下次复习 ${
    record.status === "review"
      ? formatReviewInterval(record.dueAt - Date.now())
      : "本次会话内"
  }`;
  state.reviewMessageType = "info";
  renderReviewView();
}

function speakReviewCard() {
  const entry = getCurrentReviewEntry();
  if (!entry || !("speechSynthesis" in window)) {
    return;
  }

  const text = entry.item.sentence || entry.item.phrase;
  speak(text, 0.92, {
    profile: { pitch: 1, rateScale: 1 },
    voicePreference: state.practiceVoice,
  });
}

function renderReviewScope() {
  if (!elements.reviewCategory || !elements.reviewSection) {
    return;
  }

  const definitions = getCategoryDefinitions();
  const categoryNames = new Set(
    definitions.map((category) => category.name),
  );
  if (
    state.reviewCategory !== "all" &&
    !categoryNames.has(state.reviewCategory)
  ) {
    state.reviewCategory = "all";
    state.reviewSection = "all";
  }

  const categoryFragment = document.createDocumentFragment();
  const allCategoryOption = document.createElement("option");
  allCategoryOption.value = "all";
  allCategoryOption.textContent = "整个素材库";
  categoryFragment.append(allCategoryOption);
  definitions.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.name;
    option.textContent = category.name;
    categoryFragment.append(option);
  });
  elements.reviewCategory.replaceChildren(categoryFragment);
  elements.reviewCategory.value = state.reviewCategory;

  const activeCategory = definitions.find(
    (category) => category.name === state.reviewCategory,
  );
  const sectionNames =
    state.reviewCategory === "all"
      ? []
      : activeCategory?.sections || [];
  if (
    state.reviewSection !== "all" &&
    !sectionNames.includes(state.reviewSection)
  ) {
    state.reviewSection = "all";
  }

  const sectionFragment = document.createDocumentFragment();
  const allSectionOption = document.createElement("option");
  allSectionOption.value = "all";
  allSectionOption.textContent =
    state.reviewCategory === "all" ? "整个素材库" : "整个分类";
  sectionFragment.append(allSectionOption);
  sectionNames.forEach((sectionName) => {
    const option = document.createElement("option");
    option.value = sectionName;
    option.textContent = sectionName;
    sectionFragment.append(option);
  });
  elements.reviewSection.replaceChildren(sectionFragment);
  elements.reviewSection.value = state.reviewSection;
  elements.reviewSection.disabled =
    state.reviewCategory === "all" || sectionNames.length === 0;

  elements.reviewNewLimit.value = String(state.reviewNewLimit);
}

function renderReviewStats() {
  const entries = getReviewEntries();
  const now = Date.now();
  let dueCount = 0;
  let freshCount = 0;
  let masteredCount = 0;

  entries.forEach((entry) => {
    const record = getReviewRecord(entry.item.id);
    if (!record || !Number(record.reps)) {
      freshCount += 1;
      return;
    }
    if ((Number(record.dueAt) || 0) <= now) {
      dueCount += 1;
      return;
    }
    masteredCount += 1;
  });

  const remainingNew = Math.max(
    0,
    state.reviewNewLimit - state.reviewDaily.newKeys.length,
  );

  elements.reviewDueCount.textContent = String(dueCount);
  elements.reviewNewCount.textContent = String(
    Math.min(freshCount, remainingNew),
  );
  elements.reviewDoneCount.textContent = String(state.reviewSessionDone);
  elements.reviewTotalCount.textContent = String(entries.length);

  if (state.reviewCategory === "all") {
    elements.reviewSource.textContent = `整个素材库 · ${entries.length} 张卡片 · 已安排 ${masteredCount} 张 · 今日已复习 ${state.reviewDaily.reviewedKeys.length} 张`;
    return;
  }

  const scopeLabel =
    state.reviewSection === "all"
      ? `${state.reviewCategory} · 整个分类`
      : `${state.reviewCategory} / ${state.reviewSection}`;
  elements.reviewSource.textContent = `${scopeLabel} · ${entries.length} 张卡片 · 已安排 ${masteredCount} 张 · 今日已复习 ${state.reviewDaily.reviewedKeys.length} 张`;
}

function renderReviewCard() {
  const entry = getCurrentReviewEntry();
  const hasCard = Boolean(entry);

  elements.reviewSpeakButton.disabled =
    !hasCard || !("speechSynthesis" in window);
  elements.reviewShowButton.disabled = !hasCard || state.reviewRevealed;
  elements.reviewShowButton.hidden = state.reviewRevealed;
  elements.reviewGradeActions.hidden = !state.reviewRevealed || !hasCard;

  if (!hasCard) {
    const entries = getReviewEntries();
    elements.reviewCardScope.textContent = "本次队列已完成";
    elements.reviewCardProgress.textContent = entries.length
      ? `${state.reviewSessionDone} 张已评分`
      : "";
    elements.reviewCardSentence.textContent = entries.length
      ? "这一轮复习结束了"
      : "当前范围还没有卡片";
    elements.reviewCardPrompt.textContent = entries.length
      ? "点“重新排队”可以继续处理到期和新解锁的卡片。"
      : "先在素材库上传或选择带词汇的素材。";
    elements.reviewCardAnswer.hidden = true;
    return;
  }

  const { item, resource } = entry;
  const record = getReviewRecord(item.id);
  elements.reviewCardScope.textContent = `${resource.category} · ${resource.title}`;
  elements.reviewCardProgress.textContent = record?.reps
    ? `已复习 ${record.reps} 次 · ${
        record.lapses ? `遗忘 ${record.lapses} 次` : "暂无遗忘"
      }`
    : "新卡片";
  elements.reviewCardSentence.textContent = item.sentence || item.phrase;
  elements.reviewCardPrompt.textContent = state.reviewRevealed
    ? ""
    : "先回忆它的含义和用法";

  elements.reviewCardAnswer.hidden = !state.reviewRevealed;
  elements.reviewCardPhrase.textContent = item.phrase || "";
  elements.reviewCardPhonetic.textContent = item.phonetic || "";
  elements.reviewCardMeaning.textContent = item.meaning || "";
  elements.reviewCardTranslation.textContent = item.translation || "";

  const now = Date.now();
  const previews = {
    again: computeReviewSchedule(record, "again", now),
    hard: computeReviewSchedule(record, "hard", now),
    good: computeReviewSchedule(record, "good", now),
    easy: computeReviewSchedule(record, "easy", now),
  };
  elements.reviewIntervalAgain.textContent = formatReviewInterval(
    previews.again.dueAt - now,
  );
  elements.reviewIntervalHard.textContent = formatReviewInterval(
    previews.hard.dueAt - now,
  );
  elements.reviewIntervalGood.textContent = formatReviewInterval(
    previews.good.dueAt - now,
  );
  elements.reviewIntervalEasy.textContent = formatReviewInterval(
    previews.easy.dueAt - now,
  );
}

function renderReviewView() {
  if (!elements.reviewStudio) {
    return;
  }
  renderReviewScope();
  renderReviewStats();
  renderReviewCard();
  elements.reviewStatus.textContent = state.reviewMessage;
  elements.reviewStatus.classList.toggle(
    "is-error",
    state.reviewMessageType === "error",
  );
}

function exportReviewProgress() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    progress: state.reviewProgress,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `iball的小屋-在线复习进度-${getReviewDayKey()}.json`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  state.reviewMessage = "复习进度已导出，可以在其他设备导入继续。";
  state.reviewMessageType = "info";
  renderReviewView();
}

async function importReviewProgress(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const incoming = payload?.progress;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      throw new Error("invalid");
    }

    let imported = 0;
    Object.entries(incoming).forEach(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return;
      }
      state.reviewProgress[key] = value;
      imported += 1;
    });
    persistReviewProgress();
    startReviewSession();
    state.reviewMessage = `已导入 ${imported} 张卡片的复习进度。`;
    state.reviewMessageType = "info";
  } catch {
    state.reviewMessage = "导入失败，请选择本站在线复习导出的 JSON 文件。";
    state.reviewMessageType = "error";
  }

  renderReviewView();
}

function clearReviewProgress() {
  const total = Object.keys(state.reviewProgress).length;
  if (
    total > 0 &&
    !window.confirm("确定清空在线复习的全部进度吗？此操作不可撤销。")
  ) {
    return;
  }

  state.reviewProgress = {};
  state.reviewDaily = { date: getReviewDayKey(), reviewedKeys: [], newKeys: [] };
  persistReviewProgress();
  persistReviewDaily();
  startReviewSession();
  state.reviewMessage = "复习进度已清空。";
  state.reviewMessageType = "info";
  renderReviewView();
}

function matchesMaterialQuery(resource, query) {
  const searchable = [
    resource.category,
    resource.section,
    resource.title,
    resource.description,
    resource.file,
  ].join(" ");
  return normalizeText(searchable).includes(query);
}

function openResourceAttachment(resource) {
  const link = document.createElement("a");
  link.href = resource.file;
  link.rel = "noopener noreferrer";

  if (resource.format === "html-page") {
    link.target = "_blank";
  } else {
    const extension = resource.file.match(/\.[^./?#]+(?=($|[?#]))/)?.[0] || "";
    link.download = `${resource.title}${extension}`;
  }

  document.body.append(link);
  link.click();
  link.remove();
}

function createResourceButton(resource, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "resource-button";
  button.classList.toggle("is-attachment", Boolean(resource.attachment));
  button.dataset.resourceId = resource.id;
  if (!resource.attachment) {
    button.setAttribute(
      "aria-pressed",
      String(resource.id === state.activeResourceId),
    );
    button.classList.toggle(
      "is-active",
      resource.id === state.activeResourceId,
    );
  }

  const badge = document.createElement("span");
  badge.className = "resource-index";
  badge.setAttribute("aria-hidden", "true");
  badge.textContent = formatResourceIndex(index);

  const copy = document.createElement("span");
  copy.className = "resource-copy";

  const title = document.createElement("strong");
  title.textContent = resource.title;

  const meta = document.createElement("span");
  meta.textContent = resource.section || resource.category || "上传素材";

  copy.append(title, meta);

  const count = document.createElement("span");
  count.className = "resource-count";
  count.textContent = resource.attachment
    ? resource.format === "html-page"
      ? "打开"
      : "下载"
    : String((state.decks.get(resource.id) || []).length);

  button.append(badge, copy, count);
  button.addEventListener("click", () => {
    if (resource.attachment) {
      openResourceAttachment(resource);
      return;
    }

    stopRealtimeConversation("", { silent: true });
    cancelPracticeRecognition();
    state.practiceActive = false;
    state.reviewActive = false;
    state.reviewQueue = [];
    state.reviewQueueIndex = 0;
    state.reviewRevealed = false;
    state.practiceResult = null;
    state.activeResourceId = resource.id;
    state.view = "all";
    state.query = "";
    state.favoriteCategory = "all";
    elements.searchInput.value = "";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  return button;
}

function renderResourceList() {
  const query = normalizeText(state.materialQuery).trim();
  const definitions = getCategoryDefinitions();
  const fragment = document.createDocumentFragment();
  let visibleResourceCount = 0;
  let visibleCategoryCount = 0;

  definitions.forEach((category) => {
    const categoryResources = state.resources.filter(
      (resource) =>
        (resource.category || "未分类素材") === category.name,
    );
    const categoryNameMatches =
      Boolean(query) && normalizeText(category.name).includes(query);
    const visibleResources = categoryResources.filter(
      (resource) =>
        !query || categoryNameMatches || matchesMaterialQuery(resource, query),
    );

    const sectionNames = new Set(category.sections);
    categoryResources.forEach((resource) => {
      if (resource.section) {
        sectionNames.add(resource.section);
      }
    });
    visibleResources.forEach((resource) => {
      if (resource.section) {
        sectionNames.add(resource.section);
      }
    });

    const visibleSections = [...sectionNames].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    ).filter((section) => {
      if (!query || categoryNameMatches) {
        return true;
      }
      return (
        normalizeText(section).includes(query) ||
        visibleResources.some((resource) => resource.section === section)
      );
    });

    if (
      query &&
      !categoryNameMatches &&
      visibleResources.length === 0 &&
      visibleSections.length === 0
    ) {
      return;
    }

    visibleCategoryCount += 1;
    visibleResourceCount += visibleResources.length;

    const group = document.createElement("section");
    group.className = "resource-group";

    const heading = document.createElement("div");
    heading.className = "resource-group-heading";

    const headingName = document.createElement("strong");
    headingName.textContent = category.name;

    const headingCount = document.createElement("span");
    headingCount.textContent = String(visibleResources.length);

    heading.append(headingName, headingCount);
    group.append(heading);

    const directResources = visibleResources.filter(
      (resource) => !resource.section,
    );
    directResources.forEach((resource) => {
      group.append(
        createResourceButton(resource, state.resources.indexOf(resource)),
      );
    });

    visibleSections.forEach((section) => {
      const sectionResources = visibleResources.filter(
        (resource) => resource.section === section,
      );
      const sectionLabel = document.createElement("div");
      sectionLabel.className = "resource-section-label";
      sectionLabel.textContent = section;
      group.append(sectionLabel);

      if (sectionResources.length === 0) {
        const empty = document.createElement("p");
        empty.className = "resource-empty";
        empty.textContent = "暂无素材";
        group.append(empty);
        return;
      }

      sectionResources.forEach((resource) => {
        group.append(
          createResourceButton(resource, state.resources.indexOf(resource)),
        );
      });
    });

    if (!directResources.length && !visibleSections.length) {
      const empty = document.createElement("p");
      empty.className = "resource-empty";
      empty.textContent = "暂无素材";
      group.append(empty);
    }

    fragment.append(group);
  });

  if (visibleCategoryCount === 0) {
    const empty = document.createElement("p");
    empty.className = "resource-search-empty";
    empty.textContent = "没有找到匹配素材";
    fragment.append(empty);
  }

  elements.resourceList.replaceChildren(fragment);
  elements.resourceCount.textContent = String(
    query ? visibleResourceCount : state.resources.length,
  );
}

function createCard(entry, index) {
  const { item, resource } = entry;
  const card = document.createElement("article");
  const itemKey = getItemKey(resource.id, item);
  const isKnown = state.known.has(itemKey);
  const isFavorite = state.favorites.has(itemKey);
  const isUnknown = state.unknown.has(itemKey);
  card.className = "vocab-card";
  card.classList.toggle("is-known", isKnown);
  card.classList.toggle("is-favorite", isFavorite);
  card.classList.toggle("is-unknown", isUnknown);

  const head = document.createElement("div");
  head.className = "card-head";

  const number = document.createElement("span");
  number.className = "card-number";
  number.setAttribute("aria-hidden", "true");
  number.textContent = formatResourceIndex(index);

  const phraseBlock = document.createElement("div");
  phraseBlock.className = "phrase-block";

  const source = document.createElement("span");
  source.className = "card-source";
  source.textContent = resource.description || resource.title;
  source.hidden = state.view === "all";

  const phrase = document.createElement("h2");
  phrase.className = "phrase";
  phrase.lang = "en";
  phrase.textContent = item.phrase;

  const phonetic = document.createElement("p");
  phonetic.className = "phonetic";
  phonetic.lang = "en";
  phonetic.textContent = item.phonetic;
  phonetic.hidden = !item.phonetic;

  phraseBlock.append(source, phrase, phonetic);

  const speakButton = document.createElement("button");
  speakButton.className = "speak-button";
  speakButton.type = "button";
  speakButton.textContent = "朗读";
  speakButton.setAttribute("aria-label", `播放 ${item.phrase} 的发音`);
  speakButton.addEventListener("click", () =>
    speak(item.phrase, 0.9, { voicePreference: state.practiceVoice }),
  );

  head.append(number, phraseBlock, speakButton);

  const meaning = document.createElement("p");
  meaning.className = "meaning";
  meaning.textContent = item.meaning;

  const sentence = document.createElement("p");
  sentence.className = "sentence";
  sentence.lang = "en";
  sentence.append(createSentenceText(item.sentence));

  if (item.translation) {
    const translation = document.createElement("span");
    translation.className = "translation";
    translation.textContent = item.translation;
    sentence.append(translation);
  }

  const answerPanel = document.createElement("div");
  const meaningVisible = isMeaningVisible(itemKey);
  answerPanel.className = "answer-panel";
  answerPanel.classList.toggle("is-visible", meaningVisible);

  const meaningRevealButton = document.createElement("button");
  meaningRevealButton.className = "meaning-reveal-button";
  meaningRevealButton.type = "button";
  meaningRevealButton.textContent = meaningVisible
    ? "关闭本条释义"
    : "显示本条释义";
  meaningRevealButton.setAttribute(
    "aria-expanded",
    String(meaningVisible),
  );
  meaningRevealButton.setAttribute(
    "aria-label",
    `${meaningVisible ? "关闭" : "显示"} ${item.phrase} 的释义`,
  );
  meaningRevealButton.addEventListener("click", () => {
    const visible = isMeaningVisible(itemKey);
    if (state.showAllMeanings) {
      if (visible) {
        state.meaningHides.add(itemKey);
      } else {
        state.meaningHides.delete(itemKey);
      }
    } else if (visible) {
      state.meaningReveals.delete(itemKey);
    } else {
      state.meaningReveals.add(itemKey);
    }
    render();
  });

  answerPanel.append(meaningRevealButton, meaning, sentence);

  const actions = document.createElement("div");
  actions.className = "card-actions";

  const favoriteButton = document.createElement("button");
  favoriteButton.className = "favorite-button";
  favoriteButton.type = "button";
  favoriteButton.textContent = isFavorite ? "已收藏" : "收藏";
  favoriteButton.setAttribute("aria-pressed", String(isFavorite));
  favoriteButton.setAttribute(
    "aria-label",
    `${isFavorite ? "取消收藏" : "收藏"} ${item.phrase}`,
  );
  favoriteButton.addEventListener("click", () => {
    if (state.favorites.has(itemKey)) {
      state.favorites.delete(itemKey);
    } else {
      state.favorites.add(itemKey);
    }
    persistSet(FAVORITES_STORAGE_KEY, state.favorites);
    render();
  });

  const unknownButton = document.createElement("button");
  unknownButton.className = "unknown-button";
  unknownButton.type = "button";
  unknownButton.textContent = isUnknown ? "已标不会" : "不会";
  unknownButton.setAttribute("aria-pressed", String(isUnknown));
  unknownButton.setAttribute(
    "aria-label",
    `${isUnknown ? "取消标记" : "标记"} ${item.phrase} 为不会`,
  );
  unknownButton.addEventListener("click", () => {
    if (state.unknown.has(itemKey)) {
      state.unknown.delete(itemKey);
    } else {
      state.unknown.add(itemKey);
      state.known.delete(itemKey);
      persistSet(STORAGE_KEY, state.known);
    }
    persistSet(UNKNOWN_STORAGE_KEY, state.unknown);
    render();
  });

  const knownButton = document.createElement("button");
  knownButton.className = "known-button";
  knownButton.type = "button";
  knownButton.textContent = isKnown ? "已掌握" : "标记掌握";
  knownButton.setAttribute("aria-pressed", String(isKnown));
  knownButton.addEventListener("click", () => {
    if (state.known.has(itemKey)) {
      state.known.delete(itemKey);
    } else {
      state.known.add(itemKey);
      state.unknown.delete(itemKey);
      persistSet(UNKNOWN_STORAGE_KEY, state.unknown);
    }
    persistSet(STORAGE_KEY, state.known);
    render();
  });

  const practiceButton = document.createElement("button");
  practiceButton.className = "practice-card-button";
  practiceButton.type = "button";
  practiceButton.textContent = "跟读";
  practiceButton.setAttribute("aria-label", `跟读练习：${item.sentence || item.phrase}`);
  practiceButton.addEventListener("click", () => {
    openPractice(itemKey);
  });

  actions.append(
    favoriteButton,
    unknownButton,
    knownButton,
    practiceButton,
  );
  card.append(head, answerPanel, actions);
  return card;
}

function updateProgress() {
  const items = getActiveItems();
  const knownCount = items.filter((item) =>
    state.known.has(getItemKey(state.activeResourceId, item)),
  ).length;
  const percent = items.length
    ? Math.round((knownCount / items.length) * 100)
    : 0;

  elements.progressRing.style.setProperty("--progress", `${percent}%`);
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressText.textContent = `${knownCount} / ${items.length} 已掌握`;
}

function renderCollectionFilters() {
  const isFavoritesView = state.view === "favorites";
  elements.collectionFilters.hidden = !isFavoritesView;

  if (!isFavoritesView) {
    elements.collectionFilterList.replaceChildren();
    return;
  }

  const definitions = getCategoryDefinitions();
  const categoryNames = new Set(definitions.map((category) => category.name));
  if (
    state.favoriteCategory !== "all" &&
    !categoryNames.has(state.favoriteCategory)
  ) {
    state.favoriteCategory = "all";
  }

  const favoriteEntries = getCollectionEntries(state.favorites, "all");
  const counts = new Map();
  favoriteEntries.forEach(({ resource }) => {
    counts.set(resource.category, (counts.get(resource.category) || 0) + 1);
  });

  const filters = [
    {
      category: "all",
      label: "全部收藏集",
      count: favoriteEntries.length,
    },
    ...definitions.map((category) => ({
      category: category.name,
      label: `${category.name}收藏集`,
      count: counts.get(category.name) || 0,
    })),
  ];

  const fragment = document.createDocumentFragment();
  filters.forEach((filter) => {
    const button = document.createElement("button");
    const isActive = filter.category === state.favoriteCategory;
    button.type = "button";
    button.className = "collection-filter-button";
    button.classList.toggle("is-active", isActive);
    button.dataset.category = filter.category;
    button.setAttribute("aria-pressed", String(isActive));

    const label = document.createElement("span");
    label.textContent = filter.label;

    const count = document.createElement("span");
    count.className = "collection-filter-count";
    count.textContent = String(filter.count);

    button.append(label, count);
    button.addEventListener("click", () => {
      state.favoriteCategory = filter.category;
      render();
    });
    fragment.append(button);
  });

  elements.collectionFilterList.replaceChildren(fragment);
}

function updateViewSwitcher() {
  elements.viewButtons.forEach((button) => {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  elements.favoriteCount.textContent = String(state.favorites.size);
  elements.unknownCount.textContent = String(state.unknown.size);
}

function updateMeaningControls() {
  elements.showAllMeaningsButton.classList.toggle(
    "is-active",
    state.showAllMeanings,
  );
  elements.hideAllMeaningsButton.classList.toggle(
    "is-active",
    !state.showAllMeanings,
  );
  elements.showAllMeaningsButton.setAttribute(
    "aria-pressed",
    String(state.showAllMeanings),
  );
  elements.hideAllMeaningsButton.setAttribute(
    "aria-pressed",
    String(!state.showAllMeanings),
  );
}

function render() {
  closeWordPopover();
  renderAnkiExport();
  const resource = getActiveResource();
  const visibleEntries = getVisibleEntries();

  if (state.reviewActive) {
    elements.vocabularyToolbar.hidden = true;
    elements.practiceStudio.hidden = true;
    elements.reviewStudio.hidden = false;
    elements.cardGrid.hidden = true;
    elements.emptyState.hidden = true;
    elements.activeTitle.textContent = "在线复习";
    elements.activeDescription.textContent =
      "按间隔重复的顺序复习当前素材，复习进度保存在本机浏览器。";
    elements.footerResource.textContent = `在线复习 · ${getReviewEntries().length} 张卡片`;
    renderResourceList();
    updateProgress();
    updateViewSwitcher();
    updateMeaningControls();
    renderCollectionFilters();
    renderReviewView();
    return;
  }

  if (state.practiceActive) {
    const practiceEntries = getPracticeEntries();
    const dialogueScenario = getCurrentDialogueScenario();
    const isDialogue = state.practiceSection === "dialogue";
    const isFree = state.practiceSection === "free";
    elements.vocabularyToolbar.hidden = true;
    elements.practiceStudio.hidden = false;
    elements.reviewStudio.hidden = true;
    elements.cardGrid.hidden = true;
    elements.emptyState.hidden = true;
    elements.practiceHeading.textContent = isDialogue
      ? "情景对话"
      : isFree
        ? "自由对话"
      : "口语跟读";
    elements.activeTitle.textContent = isDialogue
      ? "情景对话"
      : isFree
        ? "自由对话"
      : "口语跟读";
    elements.activeDescription.textContent = isDialogue
      ? "选择生活场景，按自己的表达完成多轮英文对话。"
      : isFree
        ? "用英语自由聊天，获得双语回复、纠错和雅思口语练习建议。"
      : practiceEntries.length
        ? `从“${resource?.title || "当前素材"}”中选择完整句子，听示范并跟读。`
        : "当前视图没有可练习的完整句子，请先返回并选择其他素材。";
    elements.footerResource.textContent = isDialogue
      ? `情景对话 · ${dialogueScenario?.turns.length || 0} 轮`
      : isFree
        ? `自由对话 · ${state.freeTurnCount} 轮`
      : `口语跟读 · ${practiceEntries.length} 句`;
    renderResourceList();
    updateProgress();
    updateViewSwitcher();
    updateMeaningControls();
    renderCollectionFilters();
    renderPracticeView();
    return;
  }

  elements.vocabularyToolbar.hidden = false;
  elements.practiceStudio.hidden = true;
  elements.reviewStudio.hidden = true;
  const fragment = document.createDocumentFragment();

  visibleEntries.forEach((entry, index) => {
    fragment.append(createCard(entry, index));
  });

  elements.cardGrid.replaceChildren(fragment);
  elements.visibleCount.textContent = String(visibleEntries.length);
  elements.cardGrid.hidden = visibleEntries.length === 0;

  if (state.view === "favorites") {
    const isAllFavorites = state.favoriteCategory === "all";
    const collectionName = isAllFavorites
      ? "全部收藏集"
      : `${state.favoriteCategory}收藏集`;
    elements.activeTitle.textContent = collectionName;
    elements.activeDescription.textContent = isAllFavorites
      ? "汇总所有素材中手动收藏的词汇，方便集中复习。"
      : `汇总“${state.favoriteCategory}”分类中手动收藏的词汇，方便集中复习。`;
    elements.footerResource.textContent = `${collectionName} · ${visibleEntries.length} 条`;
  } else if (state.view === "unknown") {
    elements.activeTitle.textContent = "不会的单词";
    elements.activeDescription.textContent =
      "汇总所有素材中标记为不会的词汇，掌握后可随时移出。";
    elements.footerResource.textContent = `不会的单词 · ${state.unknown.size} 条`;
  } else if (resource) {
    elements.activeTitle.textContent = resource.title;
    elements.activeDescription.textContent =
      resource.description || resource.group || "上传素材";
    elements.footerResource.textContent = `${resource.title} · ${
      getActiveItems().length
    } 条`;
  }

  if (visibleEntries.length > 0) {
    elements.emptyState.hidden = true;
  } else {
    elements.emptyState.hidden = false;
    const title = elements.emptyState.querySelector("strong");
    const copy = elements.emptyState.querySelector("span");
    if (state.query) {
      title.textContent = "没有找到匹配内容";
      copy.textContent = "换一个关键词，或切换到其他视图。";
    } else if (state.view === "favorites") {
      title.textContent =
        state.favoriteCategory === "all"
          ? "收藏集还是空的"
          : `${state.favoriteCategory}收藏集还是空的`;
      copy.textContent = "在任意词汇卡片上点“收藏”，它会汇总到这里。";
    } else if (state.view === "unknown") {
      title.textContent = "还没有标记不会的单词";
      copy.textContent = "遇到不熟的词汇时点“不会”，之后可在这里集中复习。";
    } else {
      title.textContent = "素材里还没有卡片";
      copy.textContent = "请检查对应 CSV 文件是否已经上传。";
    }
  }

  renderResourceList();
  updateProgress();
  updateViewSwitcher();
  updateMeaningControls();
  renderCollectionFilters();
}

function showLogin(message = "") {
  elements.loginView.hidden = false;
  elements.appView.hidden = true;
  elements.loginError.textContent = message;
  elements.loginError.hidden = !message;
  elements.username.focus();
}

async function showApp(user) {
  state.user = user;
  elements.userLabel.textContent = user;
  elements.loginView.hidden = true;
  elements.appView.hidden = false;

  if (state.resources.length === 0) {
    await loadLibrary();
  } else {
    render();
  }
  elements.searchInput.focus();
}

async function requestAuth(payload = {}, method = "POST") {
  const response = await fetch("./api/auth", {
    method,
    headers:
      method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(payload) : undefined,
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function checkSession() {
  try {
    const { response, data } = await requestAuth({}, "GET");
    if (response.ok && data.authenticated) {
      await showApp(data.user || "用户");
      return;
    }
  } catch {
    // The login form will report connection problems after submission.
  }
  showLogin();
}

async function loadLibrary() {
  elements.activeTitle.textContent = "正在加载素材";
  elements.activeDescription.textContent =
    "正在读取素材清单和对应的词汇文件。";
  elements.emptyState.hidden = false;

  try {
    const manifestResponse = await fetch(MANIFEST_PATH, { cache: "no-store" });
    if (!manifestResponse.ok) {
      throw new Error(`资源清单加载失败：${manifestResponse.status}`);
    }

    const manifest = await manifestResponse.json();
    state.categories = Array.isArray(manifest.categories)
      ? manifest.categories
      : [];
    state.resources = Array.isArray(manifest.resources)
      ? manifest.resources
      : [];
    const deckEntries = await Promise.all(
      state.resources.map(async (resource, index) => {
        if (resource.attachment) {
          return [resource.id, []];
        }
        const response = await fetch(resource.file, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`${resource.title} 加载失败：${response.status}`);
        }
        const text = await response.text();
        return [resource.id, parseDeck(text, resource, index)];
      }),
    );
    state.decks = new Map(deckEntries);

    if (!state.activeResourceId) {
      const firstDeck = state.resources.find(
        (resource) => !resource.attachment,
      );
      state.activeResourceId = firstDeck?.id || "";
    }
    render();
  } catch (error) {
    state.categories = [];
    state.resources = [];
    state.decks = new Map();
    elements.activeTitle.textContent = "素材加载失败";
    elements.activeDescription.textContent =
      "请检查 materials 目录和素材文件是否已经上传。";
    elements.emptyState.hidden = false;
    elements.emptyState.querySelector("strong").textContent = "暂时无法打开素材";
    elements.emptyState.querySelector("span").textContent =
      "刷新页面后重试，或检查控制台中的具体错误。";
    console.error(error);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "登录中...";
  elements.loginError.hidden = true;

  try {
    const { response, data } = await requestAuth({
      action: "login",
      username: elements.username.value.trim(),
      password: elements.password.value,
    });

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "账号或密码不正确");
    }

    elements.password.value = "";
    await showApp(data.user || elements.username.value.trim());
  } catch (error) {
    showLogin(error.message || "登录服务暂时不可用");
  } finally {
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = "登录";
  }
}

async function handleLogout() {
  elements.logoutButton.disabled = true;
  try {
    await requestAuth({ action: "logout" });
  } catch {
    // Clear the local view even if the network request fails.
  }
  elements.logoutButton.disabled = false;
  state.user = "";
  showLogin();
}

elements.loginForm.addEventListener("submit", handleLogin);
elements.logoutButton.addEventListener("click", handleLogout);
elements.practiceButton.addEventListener("click", () => {
  openPractice();
});
elements.reviewButton.addEventListener("click", openReview);
elements.reviewExitButton.addEventListener("click", closeReview);
elements.reviewRestartButton.addEventListener("click", () => {
  startReviewSession();
  renderReviewView();
});
elements.reviewShowButton.addEventListener("click", revealReviewCard);
elements.reviewSpeakButton.addEventListener("click", speakReviewCard);
elements.reviewGradeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    gradeReviewCard(button.dataset.reviewGrade);
  });
});
elements.reviewCategory.addEventListener("change", (event) => {
  state.reviewCategory = event.target.value;
  state.reviewSection = "all";
  startReviewSession();
  renderReviewView();
});
elements.reviewSection.addEventListener("change", (event) => {
  state.reviewSection = event.target.value;
  startReviewSession();
  renderReviewView();
});
elements.reviewNewLimit.addEventListener("change", (event) => {
  state.reviewNewLimit = Math.max(0, Number(event.target.value) || 0);
  startReviewSession();
  renderReviewView();
});
elements.reviewExportButton.addEventListener("click", exportReviewProgress);
elements.reviewImportButton.addEventListener("click", () => {
  elements.reviewImportInput.click();
});
elements.reviewImportInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  importReviewProgress(file);
  event.target.value = "";
});
elements.reviewClearButton.addEventListener("click", clearReviewProgress);
elements.practiceExitButton.addEventListener("click", closePractice);
elements.practiceShadowTab.addEventListener("click", () => {
  setPracticeSection("shadow");
});
elements.practiceDialogueTab.addEventListener("click", () => {
  setPracticeSection("dialogue");
});
elements.practiceFreeTab.addEventListener("click", () => {
  setPracticeSection("free");
});
elements.practiceListenButton.addEventListener("click", playPracticeTarget);
elements.practiceRecordButton.addEventListener(
  "click",
  startPracticeRecording,
);
elements.practiceStopButton.addEventListener(
  "click",
  stopPracticeRecording,
);
elements.practiceRetryButton.addEventListener("click", () => {
  resetPracticeAttempt();
  renderPracticeView();
});
elements.practiceNextButton.addEventListener("click", () => {
  movePractice(1);
});
elements.practicePreviousButton.addEventListener("click", () => {
  movePractice(-1);
});
elements.practiceShuffleButton.addEventListener("click", shufflePractice);
elements.dialogueListenButton.addEventListener(
  "click",
  playDialoguePrompt,
);
elements.dialogueHintButton.addEventListener(
  "click",
  toggleDialogueHint,
);
elements.dialogueRecordButton.addEventListener(
  "click",
  startDialogueRecording,
);
elements.dialogueStopButton.addEventListener(
  "click",
  stopDialogueRecording,
);
elements.dialogueSubmitButton.addEventListener("click", () => {
  submitDialogueAnswer();
});
elements.dialogueRealtimeButton.addEventListener(
  "click",
  toggleRealtimeConversation,
);
elements.dialogueRetryButton.addEventListener(
  "click",
  retryDialogueTurn,
);
elements.dialogueNextButton.addEventListener(
  "click",
  moveDialogueTurn,
);
elements.dialogueAnswerInput.addEventListener("input", (event) => {
  if (state.dialogueResult) {
    state.dialogueResult = null;
    elements.dialogueResult.hidden = true;
    state.dialogueMessages[state.dialogueTurnIndex] = "";
  }
  state.dialogueInput = event.target.value;
  elements.dialogueSubmitButton.disabled =
    !state.dialogueInput.trim() ||
    state.practiceListening ||
    state.practiceTranscribing ||
    Boolean(state.dialogueResult);
});
elements.dialogueAnswerInput.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey
  ) {
    event.preventDefault();
    submitDialogueAnswer();
  }
});
elements.freeRestartButton.addEventListener(
  "click",
  resetFreeConversation,
);
elements.freeListenButton.addEventListener("click", playLatestFreeReply);
elements.freeHintButton.addEventListener("click", toggleFreeHint);
elements.freeRecordButton.addEventListener("click", startFreeRecording);
elements.freeStopButton.addEventListener("click", stopFreeRecording);
elements.freeSubmitButton.addEventListener("click", () => {
  sendFreeMessage();
});
elements.freeRealtimeButton.addEventListener(
  "click",
  toggleRealtimeConversation,
);
elements.freeTopic.addEventListener("change", (event) => {
  const topicId = event.target.value;
  if (!FREE_CHAT_TOPICS[topicId]) {
    return;
  }

  state.freeTopic = topicId;
  persistPracticeSettings();
  resetFreeConversation();
});
elements.freeAutoSpeak.addEventListener("change", (event) => {
  state.freeAutoSpeak = event.target.checked;
  persistPracticeSettings();
});
elements.freeAnswerInput.addEventListener("input", (event) => {
  state.freeInput = event.target.value;
  elements.freeSubmitButton.disabled =
    !state.freeInput.trim() ||
    state.practiceListening ||
    state.practiceTranscribing ||
    state.freeChatLoading;
});
elements.freeAnswerInput.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey
  ) {
    event.preventDefault();
    sendFreeMessage();
  }
});
elements.freeChatMode.addEventListener("change", (event) => {
  setFreeChatMode(event.target.value);
});
elements.freeChatApiSaveButton.addEventListener(
  "click",
  saveFreeChatApiSettings,
);
elements.practiceClearButton.addEventListener("click", () => {
  if (
    state.practiceHistory.length > 0 &&
    !window.confirm("确定清空本机的口语练习记录吗？")
  ) {
    return;
  }
  state.practiceHistory = [];
  persistPracticeHistory();
  renderPracticeView();
});
elements.practiceMode.addEventListener("change", (event) => {
  setPracticeRecognitionMode(event.target.value);
});
elements.practiceApiSaveButton.addEventListener(
  "click",
  savePracticeApiSettings,
);
elements.practiceRate.addEventListener("change", (event) => {
  state.practiceRate = Number(event.target.value) || 0.9;
});
elements.practiceVoice.addEventListener("change", (event) => {
  const allowedPreferences = new Set([
    "auto",
    "female",
    "male",
    "device",
  ]);
  if (!allowedPreferences.has(event.target.value)) {
    return;
  }

  state.practiceVoice = event.target.value;
  persistPracticeSettings();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  renderPracticeView();
});
elements.materialSearchInput.addEventListener("input", (event) => {
  state.materialQuery = event.target.value;
  renderResourceList();
});
elements.ankiExportButton.addEventListener("click", () => {
  if (elements.ankiExportPanel.hidden) {
    openAnkiExport();
  } else {
    closeAnkiExport({ restoreFocus: true });
  }
});
elements.ankiExportCloseButton.addEventListener("click", () => {
  closeAnkiExport({ restoreFocus: true });
});
elements.ankiExportCategory.addEventListener("change", (event) => {
  state.ankiExportCategory = event.target.value;
  state.ankiExportSection = "all";
  setAnkiExportStatus();
  renderAnkiExport();
});
elements.ankiExportSection.addEventListener("change", (event) => {
  state.ankiExportSection = event.target.value;
  setAnkiExportStatus();
  renderAnkiExport();
});
elements.ankiExportDownloadButton.addEventListener(
  "click",
  downloadAnkiExport,
);
elements.showAllMeaningsButton.addEventListener("click", () => {
  setAllMeaningsVisible(true);
});
elements.hideAllMeaningsButton.addEventListener("click", () => {
  setAllMeaningsVisible(false);
});
elements.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});
elements.viewSwitcher.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) {
    return;
  }
  state.view = button.dataset.view;
  render();
});
elements.wordPopoverClose.addEventListener("click", closeWordPopover);
document.addEventListener("click", (event) => {
  if (
    elements.wordPopover.hidden ||
    elements.wordPopover.contains(event.target) ||
    event.target.closest(".word-lookup")
  ) {
    return;
  }
  closeWordPopover();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.ankiExportPanel.hidden) {
    closeAnkiExport({ restoreFocus: true });
    return;
  }
  if (event.key === "Escape" && !elements.wordPopover.hidden) {
    const button = activeWordButton;
    closeWordPopover();
    button?.focus();
  }
});
document.addEventListener("keydown", (event) => {
  if (!state.reviewActive) {
    return;
  }

  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "SELECT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }

  if (event.key === "Escape") {
    closeReview();
    return;
  }

  if (!getCurrentReviewEntry()) {
    return;
  }

  if (event.code === "Space" || event.key === "Enter") {
    event.preventDefault();
    if (!state.reviewRevealed) {
      revealReviewCard();
      return;
    }
    if (event.code === "Space") {
      gradeReviewCard("good");
    }
    return;
  }

  const shortcuts = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
  const grade = shortcuts[event.key];
  if (grade) {
    event.preventDefault();
    gradeReviewCard(grade);
    return;
  }

  if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    speakReviewCard();
  }
});
window.addEventListener("resize", closeWordPopover);
window.addEventListener("scroll", closeWordPopover, { passive: true });

function dismissWelcomeOverlay() {
  const overlay = elements.welcomeOverlay;
  if (!overlay) {
    return;
  }

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.setTimeout(
    () => {
      overlay.classList.add("is-leaving");
      window.setTimeout(
        () => overlay.remove(),
        reduceMotion ? 150 : 900,
      );
    },
    reduceMotion ? 700 : 3000,
  );
}

if ("speechSynthesis" in window) {
  refreshSpeechVoiceCache();
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    refreshSpeechVoiceCache();
    if (state.practiceActive) {
      renderPracticeView();
    }
  });
}

restoreMarks();
restorePracticeHistory();
restorePracticeSettings();
restoreReviewData();
dismissWelcomeOverlay();
checkSession();
