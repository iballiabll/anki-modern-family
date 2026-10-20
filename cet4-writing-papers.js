/**
 * 四级写作题库（人工整理）。
 *
 * 数据性质：题材与题型参照历年四级写作公开题目整理，题干用可复用的英文
 * Directions 重写，范文为本站自写。所以每篇 paper 都带 sourceKind: "curated"，
 * 页面上显示“题材整理”，不冒充官方真题原文。
 *
 * 结构：window.IBALL_CET4_WRITING_PAPERS.papers[]，每篇 paper 含 meta 与 writing[]，
 * 由 scripts/build-writing-prompts.mjs 汇总成 writing-data/cet4-<year>.json 分片。
 *
 * 字段说明：
 *   part            题型标签（Part I · 议论文 / Part I · 应用文 等）
 *   directions      英文题干，写题时原样展示
 *   prompt          与 directions 一致的可检索题干
 *   outline         三段结构提纲（中文）
 *   points          采分点（中文）
 *   rubric          评分标准（中文）
 *   pitfalls        常见失分点（中文）
 *   essay           逐段范文（英文，可缺省）
 *   essayTranslation 范文逐段参考译文（中文，可缺省）
 */
window.IBALL_CET4_WRITING_PAPERS = {
  updatedAt: "2026-09-25",
  papers: [
    {
      id: "cet4-2015",
      meta: {
        year: 2015,
        title: "四级写作 · 2015 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the importance of reading literature. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the importance of reading literature. You should write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜点题立论：交代文学阅读正在被短视频和碎片信息挤走，明确立场——读文学对大学生依然不可替代。",
            "第 2 段｜两条理由加例证：一是文学训练语言与共情，二是文学提供理解复杂人生的经验，用一次读小说的亲身感受作支撑。",
            "第 3 段｜收束并给行动：承认时间有限，提出每天读二十页的可行做法，回扣“不可替代”。",
          ],
          points: [
            "立场要明确：不能只描述“有人爱读、有人不爱读”，必须给出可论证的判断。",
            "理由要有层次：语言与共情属个人能力层，理解人生属认知层，两层递进。",
            "例证要具体：写清读的是哪一类作品、改变了自己哪一点，避免空喊“很有用”。",
          ],
          rubric: [
            "内容切题：全篇围绕文学阅读的价值，不写偏成“读书方法大全”。",
            "结构连贯：三段各司其职，段间用 Furthermore / Admittedly 之类的连接句推进。",
            "语言准确：注意 literature 不可数、the importance of doing 结构、时态一致。",
            "字数格式：卡住 120-180 词区间，结尾不要为凑字数重复开头。",
          ],
          pitfalls: [
            "把 literature 当可数名词写 a literature，是四级高频失分点。",
            "通篇只有 because it is important 这类空句，缺少具体理由与例证。",
          ],
          essay: [
            "Few college students would deny that literature once shaped the way people think, yet today it competes with short videos for every spare minute. In my view, reading literature remains irreplaceable for university students.",
            "To begin with, literature trains both language and empathy. When we follow a character through a long novel, we meet thousands of carefully chosen words and learn to see the world through someone else's eyes. Moreover, literature offers experience that daily life rarely provides. A single story can let us understand failure, ambition and forgiveness before we face them ourselves, which makes us calmer and more thoughtful in real decisions.",
            "Admittedly, students are busy, and it is unrealistic to read a novel every week. Still, twenty pages a day costs only half an hour and gradually builds a habit. That is why literature deserves a fixed place in our schedule rather than a vague intention.",
          ],
          essayTranslation: [
            "很少有大学生会否认文学曾塑造人们的思维方式，但今天它要与短视频争夺每一分钟的闲暇。在我看来，阅读文学对大学生依然不可替代。",
            "首先，文学同时训练语言与共情。当我们跟随一个人物走过一部长篇小说，会遇到成千上万个精心挑选的词，并学会用他人的眼睛看世界。此外，文学提供了日常生活很少给出的经验。一个故事能让我们在自己遭遇之前就理解失败、抱负与宽恕，这让我们在真实抉择中更从容、更周全。",
            "诚然，学生很忙，每周读一部长篇小说并不现实。但每天二十页只需半小时，并会逐渐养成习惯。正因如此，文学应在我们日程里占一个固定位置，而不只是一个模糊的念头。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a letter of advice to your friend Li Ming, who spends too much time on mobile games and is falling behind in his studies. You should write at least 120 words but no more than 180 words. Do not sign your own name at the end of the letter; use “Wang Lin” instead.",
          ],
          prompt:
            "Write a letter of advice to your friend Li Ming about spending too much time on mobile games. Write at least 120 words but no more than 180 words, and sign as “Wang Lin”.",
          outline: [
            "第 1 段｜问候并点明写信目的：表达关心，直接说明想就游戏时间提点建议。",
            "第 2 段｜给出两到三条可执行建议：把游戏安排在固定时段、用运动或社团填满空闲、把手机放在书桌之外。",
            "第 3 段｜鼓励与结尾：表达相信他能调整，愿意一起自习，署名 Wang Lin。",
          ],
          points: [
            "格式分：必须有称呼、正文、结尾祝愿与署名，署名严格用 Wang Lin。",
            "语气分：朋友间建议要委婉，多用 I was wondering whether / It might help if 这类句式。",
            "内容分：建议要具体可执行，不能只写 you should study hard。",
          ],
          rubric: [
            "任务完成：既点明问题又给出建议，语气保持一致。",
            "结构衔接：先关心、再建议、后鼓励，层次清楚。",
            "语言准确：注意 suggest that you (should) do、spend time doing 等固定结构。",
          ],
          pitfalls: [
            "漏写称呼或署名，直接丢格式分。",
            "语气过硬写成命令句（You must stop playing），不像朋友之间的书信。",
          ],
        },
      ],
    },
    {
      id: "cet4-2016",
      meta: {
        year: 2016,
        title: "四级写作 · 2016 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the importance of innovation. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the importance of innovation. You should write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜背景加点题：技术更新越来越快，创新不只是企业的事，也决定个人竞争力。",
            "第 2 段｜论点展开：创新让个人不被重复劳动替代，也让社会用更低成本解决老问题，用移动支付的例子支撑。",
            "第 3 段｜落到做法：把创新理解成日常改进的习惯，从课堂作业和社团项目开始练习。",
          ],
          points: [
            "界定概念：把 innovation 落成“用新方法解决老问题”，避免全篇谈空泛的“要创新”。",
            "例证要贴近生活：移动支付、线上课堂、共享出行都可以，但只选一个写透。",
            "层次递进：个人层面与集体层面各一段论证或一句支撑，避免理由重复。",
          ],
          rubric: [
            "内容切题：始终围绕创新的价值，而不是泛谈科技发展。",
            "结构连贯：段落之间有过渡，末段回应首段。",
            "语言准确：innovate / innovation / innovative 词性不要混用。",
          ],
          pitfalls: [
            "innovation 与 invention 混用，把发明与创新当同义词。",
            "只堆口号 no innovation, no future，没有解释为什么。",
          ],
          essay: [
            "Innovation is often discussed as a task for large companies, but it matters just as much to ordinary people. In a world where technology changes every few years, the ability to find new solutions decides who keeps moving forward.",
            "For individuals, innovation means refusing to solve every problem in the old way. A student who designs a small program to organise study materials, for example, spends less time repeating routine work and more time on real thinking. For society, the effect is even broader. Mobile payment is a familiar case: it replaced long queues with a few seconds of scanning, saving time for millions of people every day.",
            "Therefore, innovation should not be treated as something that happens only in laboratories. It begins with the habit of asking whether there is a better way, and that habit can be practised in every class assignment and every club project.",
          ],
          essayTranslation: [
            "人们常把创新当作大公司的任务，但它对普通人同样重要。在技术几年就更新的世界里，能否找到新的解决办法，决定了谁能一直向前走。",
            "对个人而言，创新意味着拒绝用老办法解决所有问题。比如，一个学生写个小程序来整理学习资料，就减少了重复劳动，把时间投到真正的思考上。对社会而言，影响更广。移动支付是熟悉的例子：它用几秒钟扫码取代了长长的队伍，每天为数百万人节省时间。",
            "因此，创新不该被当作只发生在实验室里的事。它始于“有没有更好的办法”这一习惯，而这个习惯可以在每一次课堂作业和社团项目里练习。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a proposal in the name of the Student Union on holding a “Classics Reading Week” on campus. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write a proposal on holding a “Classics Reading Week” on campus. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜提出倡议背景与目的：校园阅读时间被屏幕挤占，因此建议举办经典阅读周。",
            "第 2 段｜具体安排：开放晚间自习室、每日共读一小时、周末举办读书分享会与书单墙。",
            "第 3 段｜呼吁参与：欢迎各班报名，学生会提供场地与书目清单。",
          ],
          points: [
            "文体特征：倡议书要有标题、称呼（Dear fellow students）、具体安排与呼吁。",
            "内容具体：时间、地点、活动形式三要素齐全，至少两项可执行安排。",
            "语气分：用 We propose that / It is suggested that 等正式表达。",
          ],
          rubric: [
            "任务完成：说明为什么办、怎么办、希望大家做什么，三块齐全。",
            "结构衔接：分类列举清楚，序号或连接词明确。",
            "语言准确：propose that 后接虚拟语气，注意主谓一致。",
          ],
          pitfalls: [
            "写成通知（notice）口吻，缺少倡议与呼吁的部分。",
            "活动安排全是空话，没有时间地点等可落地的信息。",
          ],
        },
      ],
    },
    {
      id: "cet4-2017",
      meta: {
        year: 2017,
        title: "四级写作 · 2017 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the importance of teamwork. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the importance of teamwork. You should write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜点题：个人能力有限，多数真实任务靠协作完成，引出团队合作的重要性。",
            "第 2 段｜两条理由：分工让专业的人做擅长的事；互相检查能减少错误，用小组作业或运动队举例。",
            "第 3 段｜补充条件与收束：合作不等于没有个人主见，好的团队需要清楚表达与承担责任。",
          ],
          points: [
            "论证要落地：写清团队合作具体在哪个环节带来好处，而不是重复 teamwork is important。",
            "例证选一个写透：小组作业、社团活动、球类比赛任选其一，写清起因经过结果。",
            "辩证补充：指出合作的前提是各司其职、敢于表达，体现思维层次。",
          ],
          rubric: [
            "内容切题：全篇围绕合作的价值与条件。",
            "结构连贯：首段立论、中段论证、末段升华，段内不跑题。",
            "语言准确：注意 cooperate with sb. on sth.、play a part in 等搭配。",
          ],
          pitfalls: [
            "把合作写成“团队里不能有个人英雄主义”的批判文，偏离题意。",
            "举例只有一句话，缺少过程与结果，说服力不足。",
          ],
          essay: [
            "Nobody can handle a large project alone, yet many students still believe that working individually is faster. In fact, teamwork is what turns individual strengths into a result that no single person could reach.",
            "On the one hand, teamwork allows people to do what they are best at. In a group assignment, the member who is good at data analysis builds the tables, while the one who writes clearly prepares the report, so each part is finished at a higher standard. On the other hand, cooperation reduces mistakes. Classmates can notice problems that we overlook, which is exactly why sports teams review their matches together after every game.",
            "However, teamwork does not mean staying silent in the crowd. A good team needs members who express their own ideas and take responsibility for their own part. Only then can cooperation produce more than the sum of its members.",
          ],
          essayTranslation: [
            "没有人能独自完成一个大项目，但许多学生仍认为单干更快。事实上，团队合作正是把个人长处转化为任何单个人都无法达到的结果的途径。",
            "一方面，团队合作让人做自己最擅长的事。在小组作业里，擅长数据分析的成员做表格，写作清楚的成员准备报告，于是每个部分都以更高标准完成。另一方面，合作能减少错误。同学能发现我们忽略的问题，这也正是运动队每场比赛后一起复盘的原因。",
            "不过，团队合作并不意味着在人群中保持沉默。好的团队需要成员表达自己的想法，并为自己的那部分负责。只有这样，合作才能产生大于成员之和的成果。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an email to Professor Smith, inviting him to attend the English Corner held by your class and to give a short talk. You should write at least 120 words but no more than 180 words. Do not sign your own name; use “Li Hua” instead.",
          ],
          prompt:
            "Write an email to Professor Smith inviting him to attend the English Corner and give a short talk. Write at least 120 words but no more than 180 words, and sign as “Li Hua”.",
          outline: [
            "第 1 段｜自我介绍与写信目的：说明身份，礼貌发出邀请。",
            "第 2 段｜活动信息：时间、地点、主题与希望他讲的时长和方向。",
            "第 3 段｜期待与联系方式：表示会配合他的安排，留下联系方式，署名 Li Hua。",
          ],
          points: [
            "信息完整：when / where / what / how long 四项齐全，是邀请类作文的主要采分点。",
            "语气得体：用 I would be honoured if、Would it be convenient for you to 等表达礼貌。",
            "细节合理：说明班级人数、活动时长，让邀请显得真实可安排。",
          ],
          rubric: [
            "任务完成：邀请事由清晰，活动信息完整，结尾留出沟通空间。",
            "结构衔接：先介绍、再说明、后期待，层次分明。",
            "语言准确：注意 invite sb. to do sth.、look forward to doing 等结构。",
          ],
          pitfalls: [
            "只写 We invite you，缺少时间地点等具体信息。",
            "结尾写 I am looking forward to see you，to 后误接动词原形。",
          ],
        },
      ],
    },
    {
      id: "cet4-2018",
      meta: {
        year: 2018,
        title: "四级写作 · 2018 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the importance of writing ability and how to develop it. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the importance of writing ability and how to develop it. You should write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜点题：写作能力在课堂、求职与日常沟通中都被反复检验，因此值得专门训练。",
            "第 2 段｜说明重要性：写作迫使思路变得清楚，也在简历与报告中直接影响别人对我们的判断。",
            "第 3 段｜给出方法：先搭结构再写句子，坚持每周写一篇并请人批改，回扣主题。",
          ],
          points: [
            "首段要同时回应题干两问中的第一问，避免只写重要性却漏掉“如何提升”。",
            "方法要可操作：列提纲、固定写作量、找人批改、积累替换词，至少两项。",
            "逻辑顺序：先说为什么值得练，再说怎么练，与题干提示的顺序一致。",
          ],
          rubric: [
            "内容切题：重要性与方法两部分都要有所覆盖。",
            "结构连贯：建议部分层次清楚，避免与前一板块混在一起。",
            "语言准确：注意 ability to do sth.、improve by doing 等搭配。",
          ],
          pitfalls: [
            "只写重要性，把 how to develop it 完全漏掉，直接扣任务分。",
            "方法写成空口号 practise more，没有具体做法与频率。",
          ],
          essay: [
            "Writing ability is tested in almost every stage of college life, from essays and reports to job applications. Because it shapes both our thinking and the way others judge us, it deserves the same attention as speaking and reading.",
            "To begin with, writing forces our ideas into order. A vague opinion feels acceptable until we try to put it into a paragraph, where every weak link becomes visible. In addition, writing decides how our work is received. Two students may know the same content, but the one who organises it clearly, with a logical structure and accurate words, is more likely to be understood and trusted.",
            "As for how to develop it, the method is simple but requires patience. Build an outline before drafting, write one short passage every week, and ask a teacher or a classmate to point out the weak sentences. Half a year of this practice will show clearer progress than memorising templates alone.",
          ],
          essayTranslation: [
            "从论文、报告到求职申请，写作能力几乎在大学生活的每个阶段都会被检验。因为它既塑造我们的思考，也决定别人如何评价我们，所以它值得与口语、阅读同样的重视。",
            "首先，写作迫使我们的想法变得有条理。一个模糊的观点看起来没问题，直到我们试图把它写成一个段落，那时每一个薄弱环节都会暴露。此外，写作决定我们的成果如何被接受。两个学生可能掌握同样的内容，但那个结构清楚、用词准确、组织得当的人更容易被理解与信任。",
            "至于如何提升，方法很简单，但需要耐心。写作前先搭提纲，每周写一篇短文，请老师或同学指出薄弱句子。半年这样的练习，会比单纯背模板带来更明显的进步。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a notice on behalf of the Student Union about recruiting volunteers for a community service programme. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write a notice about recruiting volunteers for a community service programme. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜通知事由：学生会将组织社区服务志愿活动，现招募志愿者。",
            "第 2 段｜具体要求：服务内容（辅导小学生功课、社区图书整理）、时间与人数、报名方式与截止日期。",
            "第 3 段｜号召与落款：欢迎同学报名，注明联系方式与发布单位日期。",
          ],
          points: [
            "通知格式：标题、正文、发布单位与日期缺一不可。",
            "信息完整：报名条件、服务时间、报名截止日期都要写清楚。",
            "语气分：通知面向全体同学，用 formal but friendly 的正式表达。",
          ],
          rubric: [
            "任务完成：招募事由、岗位内容、报名方式三块齐全。",
            "结构衔接：分段清楚，可用 Volunteers are expected to / Those who are interested may 等句式。",
            "语言准确：注意 be expected to 与 be required to 的区别，时间表达规范。",
          ],
          pitfalls: [
            "把通知写成私人信件，加了 Dear friend 与 Yours。",
            "遗漏截止日期与报名方式，志愿者无法行动。",
          ],
        },
      ],
    },
    {
      id: "cet4-2019",
      meta: {
        year: 2019,
        title: "四级写作 · 2019 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a news report on a visit made by your class to a science museum. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write a news report on a class visit to a science museum. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜导语：交代时间、地点、人物与事件，即某班集体参观科技馆。",
            "第 2 段｜过程：参观展区、动手实验、听讲解，写出一两个具体场景与现场反应。",
            "第 3 段｜意义与结尾：引用学生或老师的一句话评价，指出活动对科学兴趣的激发。",
          ],
          points: [
            "新闻导语要素齐全：who / when / where / what 尽量在第一段交代。",
            "使用过去时叙述，结尾引语可用直接引号，增强新闻感。",
            "以事实为主：少用 I think，多写看到、做过的具体内容。",
          ],
          rubric: [
            "任务完成：事件描述完整，信息真实可信。",
            "结构衔接：导语、主体、结尾符合新闻稿习惯。",
            "语言准确：过去时与被动语态使用正确，注意不规则动词。",
          ],
          pitfalls: [
            "全篇用现在时写已发生的活动，时态错误。",
            "只写自己的感受，缺少活动内容，读起来像日记而不是报道。",
          ],
          essay: [
            "Last Saturday, about forty students from Class Two visited the City Science Museum, where they spent a whole morning exploring exhibitions on energy, robots and space.",
            "The visit began with a guided tour of the energy hall, where the guide explained how wind and solar power are turned into electricity. Afterwards, students moved to the hands-on area and tried to build a simple circuit by themselves. Many of them queued twice to test a small robot that could follow a drawn line, and the room was filled with excited discussion.",
            "“Textbooks answer questions, but a museum makes you ask better ones,” said Mr. Zhao, the class teacher. The students returned with notebooks full of observations, and several of them have already asked whether the class can join a weekend science club.",
          ],
          essayTranslation: [
            "上周六，二班约四十名学生参观了市科技馆，在那里用了一个上午参观能源、机器人和太空展区。",
            "参观从能源展厅的讲解开始，讲解员说明了风能与太阳能如何转化为电。随后学生们来到动手区，自己尝试搭建简单电路。许多人排了两次队去测试一个能沿着画线行走的小机器人，展厅里满是兴奋的讨论。",
            "“课本给你答案，而博物馆让你提出更好的问题，”班主任赵老师说。学生们带回记满观察的笔记本，其中几位已经询问班里能否参加周末科学社。",
          ],
        },
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the importance of physical exercise for college students. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the importance of physical exercise for college students. You should write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜现状加观点：大学生久坐、熬夜普遍，规律运动不只是身材问题。",
            "第 2 段｜两条理由：运动改善专注与情绪；运动提供长期健康资本，用跑步后复习效率提高的例子支撑。",
            "第 3 段｜行动建议：每周三次、每次半小时，把运动写进日程而不是等有空。",
          ],
          points: [
            "论证角度不同于体检报告：强调运动对学习效率与情绪的作用，更贴近读者关心。",
            "例证要写因果链条：运动 → 睡眠更好 → 上课更专注。",
            "行动建议要具体：频率、时长、形式三要素。",
          ],
          rubric: [
            "内容切题：围绕运动对大学生的重要性，不写成减肥科普。",
            "结构连贯：说理与建议分开，段间有过渡。",
            "语言准确：注意 benefit from、take regular exercise 等搭配，exercises 用复数形式需注意语境。",
          ],
          pitfalls: [
            "把 exercise 当可数名词乱用 an exercise 表示锻炼。",
            "只写好处不写做法，末段缺少落点。",
          ],
        },
      ],
    },
    {
      id: "cet4-2020",
      meta: {
        year: 2020,
        title: "四级写作 · 2020 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the use of translation apps among college students. You should state your opinion and give reasons. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the use of translation apps among college students. State your opinion and give reasons. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜现象加观点：翻译软件已成日常工具，我的立场是“可依赖但不能依赖到停掉思考”。",
            "第 2 段｜两面论证：它降低阅读门槛、节省时间；但直接抄译文会削弱语感与记忆。",
            "第 3 段｜给出用法：先自己译一遍再对照，把软件当反馈工具而不是答案机器。",
          ],
          points: [
            "题干要求 state your opinion，必须立场鲜明，不能只做利弊罗列。",
            "两面论证要有侧重，写清哪一面更重要或用什么方式平衡。",
            "用具体场景支撑：查文献、看新闻、写作业三个场景任选一二。",
          ],
          rubric: [
            "任务完成：有明确立场，理由与例子对应。",
            "结构连贯：让步与转折衔接自然（Admittedly … However …）。",
            "语言准确：注意 rely on、be tempted to do、instead of doing 等结构。",
          ],
          pitfalls: [
            "通篇写“科技是双刃剑”，没有任何具体分析，属模板套话。",
            "立场前后矛盾：首段说好处多，末段又说完全该禁止。",
          ],
          essay: [
            "Translation apps have become standard equipment for college students: one tap can turn a dense paragraph of English into readable Chinese. In my view, they are useful tools, but they become harmful when students stop thinking altogether.",
            "The advantages are obvious. When reading academic material, an app removes the words that block understanding and allows a beginner to follow the main argument in minutes instead of hours. Admittedly, this convenience has a cost. Students who copy the translated version directly into their homework lose the chance to notice sentence patterns, and they forget the words almost immediately.",
            "Therefore, the sensible habit is to translate first and compare afterwards. Treat the app as a mirror that shows where our understanding went wrong, rather than a machine that hands us ready answers. Used this way, it saves time without taking the thinking away.",
          ],
          essayTranslation: [
            "翻译软件已成为大学生的标配：轻点一下，就能把一大段英文变成可读的中文。在我看来，它们是有用的工具，但当学生彻底停止思考时，它们就变得有害。",
            "优点显而易见。阅读学术材料时，软件扫清了挡住理解的单词，让初学者几分钟而不是几小时就能跟上主要论证。诚然，这种便利有代价。直接把译文抄进作业的学生失去了注意句型的机会，而且几乎立刻就忘了那些词。",
            "因此，合理的习惯是先自己翻译，再对照。把软件当作照出我们理解偏差的镜子，而不是递上现成答案的机器。这样使用，它既节省时间，又不夺走思考。",
          ],
        },
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the best way to stay healthy. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the best way to stay healthy. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜亮出选择：健康方法很多，我认为最有效的是把作息固定下来。",
            "第 2 段｜解释理由：固定作息稳定睡眠、让饮食与运动有节奏，用熬夜后状态变差的对比说明。",
            "第 3 段｜承认其他方法并收束：饮食与运动当然重要，但没有规律作息支撑难以长期坚持。",
          ],
          points: [
            "题干含 best，必须先选一个方法再论证，不能把多种方法平均罗列。",
            "对比写法好用：规律作息与临时突击式养生形成对照。",
            "理由要成链：规律作息 → 睡眠稳定 → 情绪与专注改善 → 更容易坚持运动。",
          ],
          rubric: [
            "内容切题：确实回答了 best way 并给出理由。",
            "结构连贯：立论、论证、让步收束三段分明。",
            "语言准确：注意 the best way to do sth.、keep a regular schedule 等表达。",
          ],
          pitfalls: [
            "把 the best way 理解成“所有方法”，写成方法清单，未作选择。",
            "只写 eat well and exercise more，没有任何具体论证。",
          ],
        },
      ],
    },
    {
      id: "cet4-2021",
      meta: {
        year: 2021,
        title: "四级写作 · 2021 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a letter of thanks to your teacher, Mr. Wang, for his help with your English study. You should write at least 120 words but no more than 180 words. Do not sign your own name; use “Li Hua” instead.",
          ],
          prompt:
            "Write a letter of thanks to your teacher Mr. Wang for his help with your English study. Write at least 120 words but no more than 180 words, and sign as “Li Hua”.",
          outline: [
            "第 1 段｜开门见山致谢：说明写信目的是表达感谢，并点明感谢的原因。",
            "第 2 段｜回忆具体帮助：每周批改作文、课上纠正发音、鼓励我参加演讲比赛，写清这些帮助带来的变化。",
            "第 3 段｜再次感谢并祝福：表示会把这份鼓励传递下去，祝愿老师工作顺利，署名 Li Hua。",
          ],
          points: [
            "感谢信的关键是“具体”：把帮助写成可回忆的事件，避免只写 thank you very much。",
            "语气真诚而不过度：用 I am writing to express my sincere gratitude for 等得体的开头。",
            "要有结果句：说明老师的帮助带来了什么变化，让感谢有落点。",
          ],
          rubric: [
            "任务完成：目的明确，回忆具体，结尾得体并署名。",
            "结构衔接：感谢、回忆、再次致谢三段推进自然。",
            "语言准确：注意 thank sb. for doing sth.、be grateful to sb. for sth.。",
          ],
          pitfalls: [
            "通篇堆 thank you，没有任何具体事件，内容分低。",
            "署名写成自己的真名，违反题目要求。",
          ],
          essay: [
            "Dear Mr. Wang, I am writing to express my sincere gratitude for the help you have given me over the past year.",
            "I still remember the eighteen essays you corrected for me after class. Beside each mistake you wrote a short explanation, and those notes taught me more than any textbook rule. Your patience also changed my attitude towards speaking. When I was too nervous to open my mouth in class, you encouraged me to join the English speech contest, and I finally finished third, which I had never imagined before.",
            "Your support has given me not only better grades but also the confidence to keep learning. I will pass on the same patience to others whenever I can. Thank you again, and I wish you every success in your work. Yours sincerely, Li Hua.",
          ],
          essayTranslation: [
            "尊敬的王老师，我写信是为了对您在过去一年给予我的帮助表达诚挚的感谢。",
            "我仍记得您课下为我批改的十八篇作文。在每个错误旁边，您都写了简短的解释，那些批注比任何语法规则教给我的都多。您的耐心也改变了我对口语的态度。当我在课堂上紧张得不敢开口时，您鼓励我参加英语演讲比赛，我最终获得了第三名，这是我以前从未想象过的。",
            "您的支持不仅给了我更好的成绩，也给了我继续学习的信心。只要有机会，我会把同样的耐心传递给他人。再次感谢您，祝您工作顺利。您真诚的，李华。",
          ],
        },
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the impact of online learning on college students. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the impact of online learning on college students. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜背景加点题：线上学习已成为常态，影响既有便利也有隐忧。",
            "第 2 段｜两面展开：打破地域与时间限制、可反复观看；但缺少课堂约束，容易分心与拖延。",
            "第 3 段｜给出应对：靠固定课表、公开笔记和小组互查把自由变成自律。",
          ],
          points: [
            "impact 类题目写两面更容易展开，但必须给出自己的判断或对策。",
            "例子要具体：回放难点、跨校选课、群里互相督促，任选其二。",
            "末段切忌只重复：提出可执行的自我管理方法，确保文章有推进。",
          ],
          rubric: [
            "内容切题：围绕对大学生的影响，而不是泛谈教育技术。",
            "结构连贯：转折清晰，末段与首段呼应。",
            "语言准确：注意 have an impact on、be tempted to do、keep up with。",
          ],
          pitfalls: [
            "只写优点或只写缺点，缺少自己的立场与对策。",
            "把 affect / effect 混用，造成词性错误。",
          ],
        },
      ],
    },
    {
      id: "cet4-2022",
      meta: {
        year: 2022,
        title: "四级写作 · 2022 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the influence of short videos on the daily life of college students. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the influence of short videos on the daily life of college students. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜现象起笔：短视频填满碎片时间，已实实在在改变大学生的日常节奏。",
            "第 2 段｜收益与代价：拓宽信息、放松情绪；但十五秒的节奏会削弱长内容所需的耐心。",
            "第 3 段｜提出做法：给刷视频设定时段与时长上限，把注意力留给需要长时间投入的事。",
          ],
          points: [
            "用对比揭示代价：短视频快速反馈 vs 阅读与实验需要长时间专注。",
            "尽量写出具体时间量，例如睡前二十分钟，让论证可信。",
            "结论落到自我管理，而不是简单否定平台。",
          ],
          rubric: [
            "内容切题：写的是影响，需有正有负并落到做法。",
            "结构连贯：现象、分析、对策三段清楚。",
            "语言准确：注意 influence on、spend time doing、pay attention to。",
          ],
          pitfalls: [
            "写成平台推荐或使用教程，偏离“影响”的论述方向。",
            "全文只有观点没有例子，内容显得空。",
          ],
          essay: [
            "Short videos now fill almost every gap in a student's day: the queue in the dining hall, the ten minutes before class, the last half hour before sleep. Their influence on daily life is therefore far greater than it first appears.",
            "On the positive side, short videos bring useful information within reach. A two-minute clip can explain a physics experiment or introduce a historical event far more vividly than a page of notes, and a funny video genuinely helps when we are tired. Yet the cost deserves attention. Fifteen seconds is an easy reward, and after a few months of it, reading a long article or finishing a difficult experiment feels unbearably slow, so patience quietly disappears.",
            "Therefore, the goal should not be to quit the platform, but to fix its place: twenty minutes after dinner, never during study time. Once the time is limited, the convenience remains and the distraction goes.",
          ],
          essayTranslation: [
            "短视频几乎填满了学生一天里的每个缝隙：食堂的排队、课前的十分钟、睡前的半小时。因此它对日常生活的影响远比表面看上去更大。",
            "积极的一面是，短视频让有用的信息随手可得。两分钟的视频能把一个物理实验或一个历史事件讲得比一页笔记生动得多，疲惫时一段搞笑视频也确实有帮助。但其代价值得注意。十五秒是廉价的奖励，几个月之后，读一篇长文或完成一个困难实验就变得难以忍受得慢，耐心就这样悄然消失。",
            "因此，目标不是卸载平台，而是给它定好位置：晚饭后二十分钟，绝不放进学习时间。时间一旦被限定，便利留下了，干扰离开了。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a letter of application for a volunteer position in an international cultural festival to be held on your campus. You should write at least 120 words but no more than 180 words. Do not sign your own name; use “Li Hua” instead.",
          ],
          prompt:
            "Write a letter of application for a volunteer position at an international cultural festival on campus. Write at least 120 words but no more than 180 words, and sign as “Li Hua”.",
          outline: [
            "第 1 段｜说明来信目的：从海报得知招募信息，申请担任志愿者。",
            "第 2 段｜展示匹配能力：英语口语能力、半年社团活动经验、能承担翻译与引导工作，并说明可用时间。",
            "第 3 段｜表达期待与联系方式：希望获得面试机会，留下邮箱，署名 Li Hua。",
          ],
          points: [
            "申请信要“岗位对接”：写的能力要对应具体岗位职责，不能泛泛说自己很努力。",
            "证明经历：用做过什么、做过多久来支撑能力，比形容词更有效。",
            "礼貌收尾：留有联系方式与配合意愿，态度积极而不过度。",
          ],
          rubric: [
            "任务完成：申请目的、能力匹配、联系方式三部分齐全。",
            "结构连贯：先说明来意，再证明能力，最后提出请求。",
            "语言准确：注意 apply for、be qualified for、be available on 等表达。",
          ],
          pitfalls: [
            "把 apply for a position 写成 apply a position，缺少介词。",
            "只罗列性格优点，没有与岗位相关的能力与经历。",
          ],
        },
      ],
    },
    {
      id: "cet4-2023",
      meta: {
        year: 2023,
        title: "四级写作 · 2023 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the impact of artificial intelligence on the way college students learn. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the impact of artificial intelligence on the way college students learn. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜点题：AI 工具进入课堂与自习室，学习方式的改变已经发生。",
            "第 2 段｜两面分析：个性化答疑与即时反馈提高效率；但直接索取答案会跳过思考过程。",
            "第 3 段｜给出判断与做法：把 AI 当作陪练与检查员，先独立完成再借它找漏洞。",
          ],
          points: [
            "避免极端化：不要写成“AI 会取代学习”，而要分析条件与用法。",
            "写清机制：为什么即时反馈有效、为什么跳过思考有害，是拉高档次的关键。",
            "末段落到具体做法，例如先用 AI 生成题目自测，再请它批改。",
          ],
          rubric: [
            "内容切题：围绕学习方式的变化与影响展开。",
            "结构连贯：两面分析后给出立场，逻辑闭合。",
            "语言准确：注意 impact on、get access to、instead of doing。",
          ],
          pitfalls: [
            "全篇抽象谈科技进步，没有涉及“如何学习”的本题落点。",
            "动词搭配错误，如 affect on students。",
          ],
          essay: [
            "Artificial intelligence has quietly entered the classroom. Students now ask an AI assistant to explain a difficult paragraph, generate practice questions, or check a draft within seconds, and this is changing how learning is organised.",
            "The benefits are concrete. A patient assistant can explain the same concept five times in five different ways, which is exactly what a slow learner needs, and instant feedback shortens the distance between making a mistake and correcting it. However, the risk is equally real. When an answer arrives in three seconds, the struggle that produces understanding never happens, and the student may pass the exercise while learning very little.",
            "The right attitude, therefore, is to treat AI as a training partner rather than a substitute. Work out the problem first, then let the tool point out the weak parts, and the efficiency it offers will support real learning instead of replacing it.",
          ],
          essayTranslation: [
            "人工智能已悄然走进课堂。现在学生们会在几秒内请 AI 助手解释一段难懂的文字、生成练习题或检查一份草稿，而这正在改变学习的组织方式。",
            "好处很具体。一个有耐心的助手可以用五种不同方式把同一个概念解释五遍，这正是学得慢的人所需要的；即时反馈也缩短了犯错与改正之间的距离。但风险同样真实。当答案三秒就到来，那个产生理解的过程就不会发生，学生也许通过了练习，却学到很少。",
            "因此正确的态度是把 AI 当作训练伙伴而不是替代品。先自己想清问题，再让工具指出薄弱之处，它带来的效率就会支撑真实的学习，而不是取代学习。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a proposal on reducing the use of disposable plastic on campus. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write a proposal on reducing the use of disposable plastic on campus. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜提出背景与倡议：一次性餐具数量惊人，倡议在校园减少塑料使用。",
            "第 2 段｜具体措施：食堂提供自带餐盒折扣、宿舍楼设置回收点、社团举办旧物改造活动。",
            "第 3 段｜呼吁与预期效果：希望各班参与并公布数据，让改变看得见。",
          ],
          points: [
            "倡议要给出措施而不是口号，措施最好分主体（食堂、宿舍、社团）。",
            "写清可衡量目标，例如一学期减少三成一次性餐盒，让倡议可评估。",
            "语气正式：用 We propose that / It is suggested that 等表达保持倡议书语域。",
          ],
          rubric: [
            "任务完成：背景、措施、呼吁三部分完整。",
            "结构连贯：措施之间并列清楚，序号或连接词明确。",
            "语言准确：注意 reduce the use of、disposable、in place of 等表达。",
          ],
          pitfalls: [
            "只写保护环境很重要，没有任何具体安排。",
            "提议内容超出校园范围，例如要求立法，偏离可执行边界。",
          ],
        },
      ],
    },
    {
      id: "cet4-2024",
      meta: {
        year: 2024,
        title: "四级写作 · 2024 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the importance of time management for college students. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the importance of time management for college students. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜点题：大学自由时间多、任务杂，时间管理直接决定成果与状态。",
            "第 2 段｜说明重要性：会安排时间才能把大任务拆成可完成的步骤；也能让休息与运动有位置，用期末论文的例子支撑。",
            "第 3 段｜给出方法：用周计划加每日三件要事，完成后再处理手机消息。",
          ],
          points: [
            "把时间管理与具体后果挂钩：拖延、熬夜、临时抱佛脚都可以作为对比。",
            "方法要可操作：周计划、番茄钟、二八法任选其一写清步骤。",
            "避免道德说教，用“谁受益、怎么受益”说服读者。",
          ],
          rubric: [
            "内容切题：围绕大学生的时间管理展开，不跑偏成“珍惜时间”的抒情。",
            "结构连贯：重要性与方法各有段落，逻辑清楚。",
            "语言准确：注意 manage one's time、put off、in advance 等表达。",
          ],
          pitfalls: [
            "全篇写口号 Time is money，缺少具体做法。",
            "方法段落与重要性段落内容重复，没有推进。",
          ],
          essay: [
            "University life offers more freedom than any period before it, and that freedom is exactly why time management matters. Lectures, club work, part-time jobs and friends all compete for the same twenty-four hours, and no one arranges them for us any more.",
            "Good time management changes the shape of a task. A twelve-page paper feels impossible in one night, but four pages a week for three weeks is a plan any student can follow, and each finished part reduces the anxiety that causes delay. Planning also protects rest. Students who schedule exercise and sleep as deliberately as they schedule classes are less likely to burn out before the final week.",
            "The practice itself can be simple: write a weekly plan on Sunday, choose three important tasks each morning, and check messages only after the first task is finished. These small decisions gradually turn free time into real progress.",
          ],
          essayTranslation: [
            "大学生活比之前任何阶段都更自由，而正是这份自由让时间管理变得重要。课程、社团、兼职和朋友都在争夺同样的二十四小时，而再没有人替我们安排它们。",
            "好的时间管理会改变任务的样子。一篇十二页的论文看起来一夜无法完成，但三周里每周写四页，是任何学生都能执行的计划，而每完成一部分都会减少导致拖延的焦虑。计划也保护休息。那些像安排课程一样认真安排运动与睡眠的学生，更不容易在期末周之前耗尽自己。",
            "具体做法可以很简单：周日写出周计划，每天早上选定三件重要任务，并且只有在完成第一件之后才查看消息。这些细小的决定会逐渐把空闲时间变成真正的进展。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an email to the international students of your university, inviting them to attend a Chinese Culture Festival held by the Student Union. You should write at least 120 words but no more than 180 words. Do not sign your own name; use “Li Hua” instead.",
          ],
          prompt:
            "Write an email inviting international students to a Chinese Culture Festival held by the Student Union. Write at least 120 words but no more than 180 words, and sign as “Li Hua”.",
          outline: [
            "第 1 段｜问候与邀请：说明写信人身份，代表学生会发出邀请。",
            "第 2 段｜活动内容：时间地点、书法与茶艺体验、传统美食与汉服试穿，并说明可线上报名。",
            "第 3 段｜期待与联系方式：欢迎带朋友参加，留下邮箱，署名 Li Hua。",
          ],
          points: [
            "信息完整：when / where / what / how to sign up 四项齐全。",
            "细节动人：写一两个具体的体验项目，比只写 cultural activities 更有吸引力。",
            "语气友好：面向留学生，用 We would be delighted if you could join us。",
          ],
          rubric: [
            "任务完成：邀请事由与活动信息完整，报名方式明确。",
            "结构连贯：问候、介绍、期待三段推进。",
            "语言准确：注意 invite sb. to sth.、be delighted、sign up for。",
          ],
          pitfalls: [
            "只写活动名称，没有时间地点与报名方式。",
            "用词过于随意，如 Come and have fun，不符合正式邀请的语域。",
          ],
        },
      ],
    },
    {
      id: "cet4-2025",
      meta: {
        year: 2025,
        title: "四级写作 · 2025 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on the value of failure in personal growth. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on the value of failure in personal growth. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜点题：失败常被当作终点，但它是了解自己的起点。",
            "第 2 段｜分析价值：失败暴露方法漏洞与能力短板；也训练情绪调整与再次尝试的勇气，用比赛落选或实验失败经历说明。",
            "第 3 段｜补充条件与收束：只有在复盘之后失败才有价值，否则只是重复。",
          ],
          points: [
            "价值要写具体：失败提供的信息、带来的反思过程，都算论证内容。",
            "必须有个人经历，题干中的 personal growth 需要落到真实的成长变化。",
            "避免极端：不要把失败浪漫化，要说明它需要复盘作为前提。",
          ],
          rubric: [
            "内容切题：围绕失败对人的成长价值，兼顾条件。",
            "结构连贯：观点、例证、条件三段递进。",
            "语言准确：注意 fail to do / failure in、learn from、be discouraged by。",
          ],
          pitfalls: [
            "通篇讲名人故事，缺少与 personal growth 的连接。",
            "把 failure 与 fail 词性混用，例如 a fail experience。",
          ],
          essay: [
            "Failure is usually described as something to be avoided, yet anyone who has improved at a difficult skill knows that the first attempt rarely succeeds. Its real value lies not in the pain itself, but in what it reveals.",
            "When I failed my first speech contest, the judges' comments showed that my problem was not vocabulary but structure: I had memorised beautiful sentences and arranged them in no order at all. That single failure told me exactly what to work on, which no compliment could have done. Failure also trains the emotions. Learning to sit with disappointment, wait a few days, and try again is a skill that matters far beyond the classroom.",
            "Still, failure is only useful when it is examined. Without a careful review of what went wrong, it simply repeats itself. Treated as information rather than judgement, every failed attempt becomes a step that brings the next success closer.",
          ],
          essayTranslation: [
            "失败通常被描述成应当避免的事，但任何在一项难技能上有所进步的人都知道，第一次尝试很少成功。它真正的价值不在痛苦本身，而在于它揭示的东西。",
            "我第一次演讲比赛失败时，评委的评语表明我的问题不是词汇，而是结构：我背下了漂亮的句子，却完全没有顺序地堆在一起。那一次失败明确告诉我该练什么，这是任何夸奖都做不到的。失败也训练情绪。学会与失望共处、等几天、再试一次，这种能力远超出课堂的意义。",
            "不过，失败只有在被审视时才有用。若不仔细复盘哪里出了错，它只会不断重复。把失败当作信息而不是判决，每一次失败的尝试都会成为让下一次成功更近的一步。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a letter of advice to your classmate Zhang Wei, who feels anxious about the coming final examinations. You should write at least 120 words but no more than 180 words. Do not sign your own name; use “Li Hua” instead.",
          ],
          prompt:
            "Write a letter of advice to your classmate Zhang Wei, who feels anxious about the coming final examinations. Write at least 120 words but no more than 180 words, and sign as “Li Hua”.",
          outline: [
            "第 1 段｜理解与共情：表示理解他的紧张，说明这种情绪很常见。",
            "第 2 段｜给出具体办法：把科目拆成清单、用真题限时自测、每天固定运动与睡眠时间。",
            "第 3 段｜鼓励与陪伴：提出一起自习，表达相信他能应对，署名 Li Hua。",
          ],
          points: [
            "先共情后建议：开门见山讲道理会让对方更焦虑。",
            "建议必须可执行，且最好给出两三条不同方向的措施（学习、身体、情绪）。",
            "结尾提供陪伴与具体行动，如一起自习、互相提问。",
          ],
          rubric: [
            "任务完成：共情、建议、鼓励三部分完整，格式正确。",
            "结构连贯：建议之间层次清楚，避免堆成一句长句。",
            "语言准确：注意 be anxious about、cope with、remind sb. to do。",
          ],
          pitfalls: [
            "通篇写 Don't worry，没有给出任何可操作建议。",
            "语气居高临下，像老师训话而不是同学之间的信。",
          ],
        },
      ],
    },
    {
      id: "cet4-2026",
      meta: {
        year: 2026,
        title: "四级写作 · 2026 年题材",
        sourceKind: "curated",
        sourceUrl: "",
      },
      writing: [
        {
          part: "Part I · 议论文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write an essay on how college students can use smartphones wisely. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write an essay on how college students can use smartphones wisely. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜现象加点题：手机既是工具也是干扰源，关键在于使用方式。",
            "第 2 段｜具体做法：给娱乐类应用设时限、把手机移出学习区域、用手机承担正向任务（背单词、听听力）。",
            "第 3 段｜效果与收束：规律使用后专注时间变长，手机仍然是好工具。",
          ],
          points: [
            "题干含 how，必须以方法为主，现象描述要短。",
            "方法分两类更清楚：限制干扰与主动利用。",
            "写清预期效果，让做法有结果。",
          ],
          rubric: [
            "内容切题：重点在方法，避免写成手机利弊论。",
            "结构连贯：方法分类列举，末段回应开头。",
            "语言准确：注意 limit the time spent on、keep away from、be beneficial to。",
          ],
          pitfalls: [
            "把 how 写成 why，整篇谈手机的好处与坏处。",
            "建议空泛，写 use it in a good way，不可执行。",
          ],
          essay: [
            "A smartphone can be the most useful study tool a student owns, or the most efficient way to lose an afternoon. The difference lies entirely in how it is used.",
            "Two habits help most. The first is limiting interference: set a daily time limit for entertainment apps, and leave the phone in a bag while studying, because the simple act of reaching for it can break twenty minutes of concentration. The second is using the phone actively rather than passively. Vocabulary apps, listening materials and online courses turn the same device into a tutor that can be used in a queue or on a bus.",
            "After a few weeks, the change is easy to notice: the same hours produce more finished work, and the phone is no longer something to feel guilty about. Used according to a plan, it becomes a tool instead of a habit.",
          ],
          essayTranslation: [
            "手机可以是一个学生拥有的最有用的学习工具，也可以是浪费掉一个下午最有效的方式。区别完全在于如何使用它。",
            "有两个习惯最有帮助。第一是限制干扰：为娱乐类应用设置每日时限，学习时把手机放在包里，因为仅仅伸手去拿这个动作就能打断二十分钟的专注。第二是主动而非被动地使用手机。背单词应用、听力材料和线上课程把同一台设备变成可以在排队或公交上使用的家教。",
            "几周之后变化很容易察觉：同样的时间能完成更多事情，手机也不再是需要感到愧疚的东西。按计划使用，它会成为工具，而不是习惯。",
          ],
        },
        {
          part: "Part I · 应用文",
          directions: [
            "Directions: For this part, you are allowed 30 minutes to write a proposal on improving the study environment of the reading room in your university library. You should write at least 120 words but no more than 180 words.",
          ],
          prompt:
            "Write a proposal on improving the study environment of the library reading room. Write at least 120 words but no more than 180 words.",
          outline: [
            "第 1 段｜说明背景与目的：期末时座位紧张、噪音较多，提出改进建议。",
            "第 2 段｜三条具体建议：划分安静区与讨论区、增加插座与台灯、开放线上座位预约。",
            "第 3 段｜预期与呼吁：希望读者共同维护秩序，并欢迎同学补充意见。",
          ],
          points: [
            "建议要有针对性：针对噪音、座位、设备等具体问题提出。",
            "分条清楚：三条建议各写一句半到两句，避免堆砌。",
            "结尾把责任落到读者，体现倡议书的主体意识。",
          ],
          rubric: [
            "任务完成：问题、建议、呼吁三部分完整。",
            "结构连贯：建议之间并列，句间有连接词。",
            "语言准确：注意 divide A into B、be equipped with、it is suggested that。",
          ],
          pitfalls: [
            "只抱怨环境差，没有提出建议。",
            "建议之间互相包含或重复，如既写安静区又写减少噪音。",
          ],
        },
      ],
    },
  ],
};
