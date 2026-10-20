/*
 * 雅思口语题库：Part 1 话题组、Part 2 题卡、Part 3 讨论追问。
 *
 * 每道题的字段和 app.js 的情景对话轮次保持一致（speaker / prompt /
 * promptZh / sample / sampleZh / keywords），这样评分、提示、复述都能
 * 复用同一套渲染逻辑，不额外造一套。
 *
 * 这里的评分是练习估算，不是官方成绩。
 */
(function () {
  const part1 = [
    {
      id: "p1-home",
      label: "住所与城市",
      labelZh: "Hometown and Living Space",
      questions: [
        {
          speaker: "Examiner",
          prompt: "Let's talk about where you live. Do you live in a house or an apartment?",
          promptZh: "我们聊聊你的住所。你住独栋房子还是公寓？",
          sample:
            "I live in an apartment on the east side of the city, and I've been there for about three years now.",
          sampleZh: "我住在城市东边的一套公寓里，到现在大概三年了。",
          keywords: [
            {
              label: "说明住处",
              options: [
                ["i live in an apartment"],
                ["a house"],
                ["a flat"],
                ["i rent"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "What do you like most about your neighbourhood?",
          promptZh: "你最喜欢所在社区的哪一点？",
          sample:
            "What I like most is how walkable it is, because I can get groceries and coffee without driving.",
          sampleZh:
            "我最喜欢的是这里很适合步行，因为买日用品和咖啡都不用开车。",
          keywords: [
            {
              label: "说明喜欢的点并给原因",
              options: [
                ["what i like most"],
                ["because"],
                ["so i can"],
                ["the best thing"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "How long have you lived there?",
          promptZh: "你在那里住多久了？",
          sample:
            "I've lived there for about three years, ever since I changed jobs.",
          sampleZh: "我在那里住了大约三年，从我换工作开始。",
          keywords: [
            {
              label: "用现在完成时说明时长",
              options: [
                ["i've lived there for"],
                ["i have lived"],
                ["since"],
                ["for about"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Would you like to move somewhere else in the future?",
          promptZh: "以后你想搬到别的地方吗？",
          sample:
            "Possibly. I'd consider moving closer to the river, mainly because I'd like a shorter commute.",
          sampleZh:
            "有可能。我会考虑搬到离河更近的地方，主要想缩短通勤时间。",
          keywords: [
            {
              label: "表达未来意愿",
              options: [
                ["i'd consider"],
                ["possibly"],
                ["mainly because"],
                ["in the future"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Is your city a good place for young people to live?",
          promptZh: "你所在的城市适合年轻人居住吗？",
          sample:
            "On the whole, yes, though rent is getting steep. There are plenty of jobs, but housing is the real problem.",
          sampleZh:
            "总体来说是的，不过房租越来越贵。工作机会很多，住房才是真问题。",
          keywords: [
            {
              label: "给出有层次的判断",
              options: [
                ["on the whole"],
                ["though"],
                ["however"],
                ["the real problem"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p1-work-study",
      label: "工作与学习",
      labelZh: "Work and Study",
      questions: [
        {
          speaker: "Examiner",
          prompt: "Do you work or are you a student?",
          promptZh: "你在工作还是在读书？",
          sample:
            "I work full-time as a software engineer, and I also study part-time in the evenings.",
          sampleZh: "我全职做软件工程师，晚上还会兼职读书。",
          keywords: [
            {
              label: "说明身份",
              options: [
                ["i work as"],
                ["full-time"],
                ["i'm a student"],
                ["i study"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "What do you enjoy most about your work?",
          promptZh: "你最喜欢工作的哪一点？",
          sample:
            "I enjoy solving problems that other people find fiddly, especially when I can see the result quickly.",
          sampleZh:
            "我喜欢解决别人觉得琐碎的问题，尤其是能很快看到结果的时候。",
          keywords: [
            {
              label: "说明喜欢之处",
              options: [
                ["i enjoy"],
                ["especially when"],
                ["what i like"],
                ["the best part"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Is there anything you would like to change about your job?",
          promptZh: "你的工作有想改变的地方吗？",
          sample:
            "If I could change one thing, I'd cut down on meetings. Too much of my day goes into status updates.",
          sampleZh:
            "如果要改一件事，我会减少会议。我一天太多时间花在进度同步上了。",
          keywords: [
            {
              label: "提出假设并说明",
              options: [
                ["if i could change"],
                ["i'd cut down"],
                ["one thing"],
                ["i'd rather"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Do you prefer working in a team or on your own?",
          promptZh: "你更喜欢团队合作还是独立工作？",
          sample:
            "It depends on the task. I'd rather work alone when I need to focus, but I get better ideas in a team.",
          sampleZh:
            "看任务。需要专注时我更愿意一个人做，但团队里我能得到更好的想法。",
          keywords: [
            {
              label: "比较两种方式",
              options: [
                ["it depends"],
                ["i'd rather"],
                ["but"],
                ["on the other hand"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "What skills do you think you'll need in the future?",
          promptZh: "你觉得未来你需要哪些技能？",
          sample:
            "I'll probably need to get better at explaining technical ideas to non-technical people, since that's where I struggle.",
          sampleZh:
            "我大概需要更擅长把技术问题讲给非技术的人听，这方面我比较吃力。",
          keywords: [
            {
              label: "预测并说明理由",
              options: [
                ["i'll probably need"],
                ["since"],
                ["because"],
                ["i struggle"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p1-tech-daily",
      label: "科技与日常",
      labelZh: "Technology and Daily Life",
      questions: [
        {
          speaker: "Examiner",
          prompt: "How often do you use your phone during the day?",
          promptZh: "你一天用手机的频率如何？",
          sample:
            "More than I'd like, honestly. I check it first thing in the morning, probably out of habit.",
          sampleZh:
            "老实说比我想的要多。我早上第一件事就是看手机，大概是习惯。",
          keywords: [
            {
              label: "说明频率并评价",
              options: [
                ["more than i'd like"],
                ["honestly"],
                ["probably"],
                ["usually"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Do you think people rely too much on technology?",
          promptZh: "你觉得人们是否过度依赖科技？",
          sample:
            "In some ways, yes. I'd say we've traded memory for convenience, which isn't always a good deal.",
          sampleZh:
            "某些方面是的。我觉得我们用记忆力换了便利，这笔交易不一定划算。",
          keywords: [
            {
              label: "给出保留态度的判断",
              options: [
                ["in some ways"],
                ["i'd say"],
                ["which isn't always"],
                ["to some extent"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "What app do you use most, and why?",
          promptZh: "你最常用哪个应用？为什么？",
          sample:
            "Probably a note-taking app. I use it to dump ideas during the day, so I can go back to them later.",
          sampleZh:
            "大概是笔记应用。我一天里会把想法丢进去，之后可以回头看。",
          keywords: [
            {
              label: "说明用途",
              options: [
                ["i use it to"],
                ["so i can"],
                ["mainly"],
                ["because"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Have you ever tried to spend a day without your phone?",
          promptZh: "你试过一整天不用手机吗？",
          sample:
            "Once, on a hiking trip. It was uncomfortable for the first few hours, but by the evening I stopped reaching for it.",
          sampleZh:
            "试过一次，去徒步的时候。头几个小时很难受，但到晚上我就不再想摸了。",
          keywords: [
            {
              label: "讲一段经历",
              options: [
                ["once"],
                ["at first"],
                ["but by"],
                ["i tried"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Would you like to learn a new device or program this year?",
          promptZh: "今年你想学新的设备或软件吗？",
          sample:
            "Yes, I'd like to get comfortable with video editing, mainly so I can put together better course material.",
          sampleZh:
            "想，我想把视频剪辑学熟，主要是想把课程材料做得更好。",
          keywords: [
            {
              label: "说明计划与目的",
              options: [
                ["i'd like to"],
                ["mainly so"],
                ["so i can"],
                ["this year"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p1-leisure",
      label: "休闲与习惯",
      labelZh: "Leisure and Routines",
      questions: [
        {
          speaker: "Examiner",
          prompt: "What do you usually do in the evening?",
          promptZh: "你晚上通常做什么？",
          sample:
            "I usually cook something simple, then read for half an hour before bed.",
          sampleZh: "我一般做点简单的饭，睡前读半小时书。",
          keywords: [
            {
              label: "说明习惯",
              options: [
                ["i usually"],
                ["then"],
                ["before bed"],
                ["most evenings"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Do you prefer to spend your free time alone or with friends?",
          promptZh: "空闲时间你更喜欢独处还是和朋友一起？",
          sample:
            "A bit of both, really. I need quiet time to recharge, but I'm miserable if I go a whole week without seeing anyone.",
          sampleZh:
            "其实两种都要。我需要安静时间恢复精力，但一周都不见人的话我会很难受。",
          keywords: [
            {
              label: "表达平衡观点",
              options: [
                ["a bit of both"],
                ["but"],
                ["really"],
                ["depends on"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "How often do you exercise?",
          promptZh: "你多久运动一次？",
          sample:
            "About three times a week. I run on weekdays and swim at the weekend if I have the energy.",
          sampleZh:
            "一周大概三次。工作日跑步，周末有精力就去游泳。",
          keywords: [
            {
              label: "说明频率与安排",
              options: [
                ["about three times"],
                ["on weekdays"],
                ["if i have"],
                ["a week"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Has your idea of a good weekend changed over time?",
          promptZh: "你对“好周末”的定义有变化吗？",
          sample:
            "Definitely. It used to mean going out late, whereas now I'd rather have a slow morning and get something done.",
          sampleZh:
            "肯定有变化。以前是出去玩到很晚，现在我更想慢慢过个早晨，再做点事情。",
          keywords: [
            {
              label: "对比过去与现在",
              options: [
                ["it used to"],
                ["whereas"],
                ["now i'd rather"],
                ["these days"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Is there a hobby you would like to take up?",
          promptZh: "有你想开始的新爱好吗？",
          sample:
            "I've been meaning to learn to play the guitar, but I keep putting it off because of work.",
          sampleZh:
            "我一直想学吉他，但总因为工作往后拖。",
          keywords: [
            {
              label: "说明意愿与阻碍",
              options: [
                ["i've been meaning to"],
                ["but i keep"],
                ["because of"],
                ["i'd like to take up"],
              ],
            },
          ],
        },
      ],
    },
  ];

  /*
   * Part 2 题卡：每张卡 4 个提示点，和真实考试一样先给 1 分钟准备、
   * 再连续说 1 到 2 分钟。sample 用来做示范，不是唯一答案。
   */
  const part2 = [
    {
      id: "p2-person",
      label: "一个有影响的人",
      labelZh: "A Person Who Influenced You",
      topicLine: "Describe a person who has had a big influence on you.",
      bullets: [
        "who this person is",
        "how you know each other",
        "what this person is like",
        "and explain why they influenced you",
      ],
      bulletsZh: [
        "这个人是谁",
        "你们怎么认识的",
        "这个人的性格怎么样",
        "并说明他/她为什么影响了你",
      ],
      sample:
        "The person I'd pick is my first manager, Dana. I met her when I joined my first job straight out of university, and we worked together for about two years. She's direct but never harsh, and she always asked questions instead of giving answers. What stuck with me is how she handled a project that went sideways: she stayed calm, told the client the truth early, and then rebuilt the plan with the team. That taught me that honesty is faster than pretending, and I still work that way today.",
      sampleZh:
        "我要选的人是我的第一位主管 Dana。我大学毕业进第一份工作时认识她，我们一起工作了大概两年。她说话直接但不尖刻，而且总是提问，而不是直接给答案。让我印象最深的是她处理一个失控项目的方式：她保持冷静，很早就把实情告诉客户，然后和团队一起重建计划。这让我明白坦诚比假装更省时间，我到今天还是这样做事。",
      keywords: [
        {
          label: "交代人物与关系",
          options: [
            ["the person i'd pick is"],
            ["i met her when"],
            ["we worked together"],
            ["she's my"],
          ],
        },
        {
          label: "描述性格",
          options: [
            ["she's direct"],
            ["he's the kind of person who"],
            ["what i admire is"],
            ["she always"],
          ],
        },
        {
          label: "给出影响并收尾",
          options: [
            ["what stuck with me"],
            ["that taught me"],
            ["i still"],
            ["which is why"],
          ],
        },
      ],
      part3Id: "p3-people",
    },
    {
      id: "p2-place",
      label: "一个常去的地方",
      labelZh: "A Place You Like to Spend Time In",
      topicLine: "Describe a place you like to spend time in.",
      bullets: [
        "where it is",
        "how often you go there",
        "what you do there",
        "and explain why you like it",
      ],
      bulletsZh: [
        "它在哪儿",
        "你多久去一次",
        "你在那里做什么",
        "并说明你为什么喜欢它",
      ],
      sample:
        "There's a small coffee shop about ten minutes from my apartment, right next to a park. I go there maybe twice a week, usually on weekday mornings when it's still quiet. I order a flat white, put my headphones on, and work through whatever I've been putting off. The reason I keep going back is the light, honestly. The whole front wall is glass, so it's bright even in winter, and nobody rushes you. It's the one place where I can think in a straight line.",
      sampleZh:
        "我家公寓走十分钟有一家小咖啡店，就在公园旁边。我大概一周去两次，通常是工作日上午，那时还很安静。我点一杯馥芮白，戴上耳机，把一直拖延的事情处理掉。说实话，我一直回去的原因是那里的光线。整面墙都是玻璃，所以冬天也很明亮，而且没人催你走。那是唯一让我能顺着一条线想事情的地方。",
      keywords: [
        {
          label: "说明地点与频率",
          options: [
            ["there's a"],
            ["about ten minutes from"],
            ["i go there maybe"],
            ["usually on"],
          ],
        },
        {
          label: "描述在那里做什么",
          options: [
            ["i order"],
            ["i work through"],
            ["i usually spend"],
            ["what i do there"],
          ],
        },
        {
          label: "解释喜欢的原因",
          options: [
            ["the reason i keep going back"],
            ["honestly"],
            ["it's the one place where"],
            ["that's why"],
          ],
        },
      ],
      part3Id: "p3-places",
    },
    {
      id: "p2-decision",
      label: "一个改变节奏的决定",
      labelZh: "A Decision That Changed Your Routine",
      topicLine: "Describe a decision you made that changed your daily routine.",
      bullets: [
        "what the decision was",
        "when you made it",
        "what changed afterwards",
        "and explain whether it was a good decision",
      ],
      bulletsZh: [
        "这个决定是什么",
        "你什么时候做的决定",
        "之后有什么改变",
        "并说明这是不是一个好决定",
      ],
      sample:
        "About a year ago I decided to stop taking work home on weeknights. I made the call on a Sunday evening after I realised I'd spent the whole weekend catching up. The biggest change is that my evenings have a shape now: I cook something simple, go for a run, and read for half an hour. My output at work didn't drop, which honestly surprised me. So yes, I'd call it a good decision, mainly because it made the rest of the week easier to plan.",
      sampleZh:
        "大概一年前我决定工作日晚上不再把工作带回家。那个周日晚上我做了这个决定，因为我意识到整个周末都在补工作。最大的变化是我的晚上有了结构：做点简单的饭、去跑步、读半小时书。我的工作产出并没有下降，说实话这让我很意外。所以我会说这是个好决定，主要是因为它让一周剩下的时间更好安排。",
      keywords: [
        {
          label: "说明决定与时间",
          options: [
            ["i decided to"],
            ["i made the call"],
            ["about a year ago"],
            ["i realised"],
          ],
        },
        {
          label: "描述变化",
          options: [
            ["the biggest change is"],
            ["now i"],
            ["instead of"],
            ["what changed is"],
          ],
        },
        {
          label: "评价决定",
          options: [
            ["i'd call it a good decision"],
            ["mainly because"],
            ["it turned out"],
            ["looking back"],
          ],
        },
      ],
      part3Id: "p3-decisions",
    },
    {
      id: "p2-problem",
      label: "一次紧急解决问题",
      labelZh: "A Time You Solved a Problem Under Pressure",
      topicLine:
        "Describe a time when you had to solve a problem under time pressure.",
      bullets: [
        "what the situation was",
        "what made it urgent",
        "what you did about it",
        "and explain what you learned from it",
      ],
      bulletsZh: [
        "当时的情况是什么",
        "为什么很紧急",
        "你做了什么",
        "并说明你从中得到了什么经验",
      ],
      sample:
        "Last spring a client demo broke about an hour before the meeting. Half the accounts couldn't log in, and the person who owned that code was on a flight. What made it urgent was the timing, because we couldn't move the meeting. I split the team in two: one person rolled back the release, and I traced the login errors line by line until we found a bad config. We went live with twenty minutes to spare. The lesson I took away is to decide the first step out loud instead of freezing.",
      sampleZh:
        "去年春天，一次客户演示在会议前一小时崩了。一半账号无法登录，而负责那段代码的人正在飞机上。之所以紧急是因为时间点没法改，会议不能推迟。我把团队分成两组：一个人回滚版本，我一行行追登录报错，最后找到一个错的配置。我们在还剩二十分钟时上线了。我得到的教训是把第一步说出口，而不是卡在那里。",
      keywords: [
        {
          label: "交代情况与紧迫性",
          options: [
            ["last spring"],
            ["about an hour before"],
            ["what made it urgent was"],
            ["we couldn't"],
          ],
        },
        {
          label: "说明你的行动",
          options: [
            ["i split the team"],
            ["i traced"],
            ["until we found"],
            ["we went live"],
          ],
        },
        {
          label: "总结经验",
          options: [
            ["the lesson i took away"],
            ["what i learned is"],
            ["since then"],
            ["i'd do the same thing"],
          ],
        },
      ],
      part3Id: "p3-problems",
    },
  ];

  /*
   * Part 3 讨论组：和 Part 2 题卡一一对应，每题都要求"观点 + 原因 + 例子"，
   * 这是 7 分以上最常缺的一块。
   */
  const part3 = [
    {
      id: "p3-people",
      for: "p2-person",
      label: "人物、影响与社会",
      labelZh: "People and Influence",
      questions: [
        {
          speaker: "Examiner",
          prompt: "Do you think teachers or parents have more influence on children?",
          promptZh: "你认为老师还是家长对孩子影响更大？",
          sample:
            "I'd say parents set the baseline, but teachers tend to shape how children see the wider world. Parents decide the daily habits; teachers decide whether a subject feels exciting or impossible.",
          sampleZh:
            "我会说家长决定基准，但老师往往塑造孩子如何看待更大的世界。家长决定日常习惯，老师决定一门学科是让人兴奋还是让人觉得自己学不会。",
          keywords: [
            {
              label: "给出立场并给理由",
              options: [
                ["i'd say"],
                ["parents set the baseline"],
                ["but teachers"],
                ["tend to"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Has the way young people choose role models changed in recent years?",
          promptZh: "这几年年轻人选择榜样偶像的方式有变化吗？",
          sample:
            "Definitely. Twenty years ago a role model was usually someone you could actually meet, whereas now it's often someone with a following online. That's not automatically worse, but the image people admire is edited and much harder to see through.",
          sampleZh:
            "当然有。二十年前的榜样通常是你真能见到的人，而现在常常是网上有很多粉丝的人。这不一定是坏事，但人们崇拜的形象是剪辑过的，也更难被看穿。",
          keywords: [
            {
              label: "对比过去与现在",
              options: [
                ["definitely"],
                ["twenty years ago"],
                ["whereas now"],
                ["compared with the past"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Should famous people be responsible for setting a good example?",
          promptZh: "名人是否应该负责树立好榜样？",
          sample:
            "To some extent, yes, because influence comes with the job. That said, I think we overdo it, and we end up holding entertainers to a standard we don't apply to ourselves.",
          sampleZh:
            "某种程度上是的，因为影响力是这份职业自带的东西。不过我觉得我们有点过了，最后对艺人的要求比对汪自己还严。",
          keywords: [
            {
              label: "有限度地同意",
              options: [
                ["to some extent"],
                ["that said"],
                ["i think we overdo it"],
                ["to a certain degree"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Can a person be a good role model without being successful?",
          promptZh: "一个人不成功也能成为好榜样吗？",
          sample:
            "I'd argue yes. My aunt never had a famous career, but she raised three kids and cared for her parents at the same time, and that shows more character than a job title does.",
          sampleZh:
            "我认为可以。我姑姑没有知名的事业，但她养了三个孩子，同时还照顾自己的父母，这比一个职位头衔更能体现品格。",
          keywords: [
            {
              label: "用例子支撑观点",
              options: [
                ["i'd argue yes"],
                ["she never had"],
                ["for example"],
                ["that shows more"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p3-places",
      for: "p2-place",
      label: "城市空间与生活",
      labelZh: "Cities and Public Space",
      questions: [
        {
          speaker: "Examiner",
          prompt: "Why do people need places outside home and work?",
          promptZh: "为什么人需要家和公司以外的地方？",
          sample:
            "Because we behave differently depending on where we are. A third place lets you be social without performing, and that's hard to do in an office or in your own living room.",
          sampleZh:
            "因为人在不同地方的行为方式不同。第三空间让人可以社交但不用表演，这在办公室或自家客厅里很难做到。",
          keywords: [
            {
              label: "解释原因",
              options: [
                ["because"],
                ["lets you"],
                ["hard to do"],
                ["that's why"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Are cafés and libraries as important as parks in a city?",
          promptZh: "咖啡馆和图书馆在城市里和公园一样重要吗？",
          sample:
            "I'd put them in the same category. Parks give you air and space, while libraries and cafés give you somewhere to sit with other people around, which matters just as much in a cold climate.",
          sampleZh:
            "我会把它们归到同一类。公园提供空气和空间，而图书馆和咖啡馆给你一个身边有人的地方坐，这在寒冷气候里同样重要。",
          keywords: [
            {
              label: "并列比较",
              options: [
                ["i'd put them"],
                ["while"],
                ["just as much"],
                ["the same category"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Do you think online spaces can replace physical ones?",
          promptZh: "你觉得线上空间能取代实体空间吗？",
          sample:
            "Partly, but not fully. Online communities are great for finding people with the same interest, yet they can't reproduce bumping into a neighbour, and that kind of unplanned contact keeps a place feeling alive.",
          sampleZh:
            "部分可以，但不完全。线上社群很适合找到兴趣相同的人，但它们无法复制和邻居偶遇这种事，而这种非计划中的接触才让一个地方显得有生气。",
          keywords: [
            {
              label: "部分认同并给转折",
              options: [
                ["partly"],
                ["but not fully"],
                ["yet they can't"],
                ["on the other hand"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "How might cities change in the next twenty years?",
          promptZh: "未来二十年城市可能有什么变化？",
          sample:
            "My guess is they'll get denser but quieter, because electric transport cuts the noise and remote work cuts the commute. The risk is that the affordable districts keep getting pushed further out.",
          sampleZh:
            "我猜城市会更密集但更安静，因为电动交通减少噪音，远程办公减少通勤。风险在于便宜的区域会被不断推到更远的地方。",
          keywords: [
            {
              label: "预测并补充风险",
              options: [
                ["my guess is"],
                ["they'll get"],
                ["the risk is"],
                ["likely to"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p3-decisions",
      for: "p2-decision",
      label: "决定、习惯与自律",
      labelZh: "Decisions and Habits",
      questions: [
        {
          speaker: "Examiner",
          prompt: "Why is it hard for people to change their daily habits?",
          promptZh: "为什么人很难改变日常习惯？",
          sample:
            "Mostly because habits save energy. If you had to decide everything from scratch, you'd be exhausted by lunchtime, so the brain keeps the old routine even when it's not great.",
          sampleZh:
            "主要是因为习惯能省力气。如果所有事都要从头决定，你到午饭时间就累垮了，所以大脑会保留旧流程，即使它并不好。",
          keywords: [
            {
              label: "解释机制",
              options: [
                ["mostly because"],
                ["the brain keeps"],
                ["if you had to"],
                ["that's why"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Is it better to make big changes or small ones?",
          promptZh: "做大改变还是小改变更好？",
          sample:
            "Small ones usually last longer, but they're easy to ignore, so the two work best together: one clear decision, then a small version of it that you repeat until it stops feeling like effort.",
          sampleZh:
            "小改变通常更持久，但它们容易被忽略，所以两者配合最好：先做一个明确的决定，然后重复它的一个小版本，直到它不再像在用力。",
          keywords: [
            {
              label: "给出建议并说明",
              options: [
                ["small ones usually"],
                ["the two work best together"],
                ["until it stops"],
                ["i'd suggest"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Do people need self-discipline to be successful?",
          promptZh: "成功需要自律吗？",
          sample:
            "It helps, but I think systems matter more. If you set up your environment so the right action is the easiest one, you don't have to rely on willpower every single day.",
          sampleZh:
            "有帮助，但我认为机制更重要。如果你把环境设计成正确的事最容易做，你就不必每天依赖意志力。",
          keywords: [
            {
              label: "提出不同侧重",
              options: [
                ["it helps"],
                ["but i think"],
                ["matter more"],
                ["you don't have to"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Should schools teach students how to manage their time?",
          promptZh: "学校应该教学生管理时间吗？",
          sample:
            "Absolutely, and it should be practical rather than theoretical. Let students plan a real deadline, then review what went wrong, because that's the part adults usually learn the hard way.",
          sampleZh:
            "当然应该，而且要实操而不是讲理论。让学生规划一个真实的截止日期，然后复盘哪里出了问题，因为这部分成年人通常是用代价换来的。",
          keywords: [
            {
              label: "强烈认同并具体化",
              options: [
                ["absolutely"],
                ["it should be practical"],
                ["rather than"],
                ["because that's the part"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "p3-problems",
      for: "p2-problem",
      label: "压力、问题解决与团队",
      labelZh: "Pressure and Problem Solving",
      questions: [
        {
          speaker: "Examiner",
          prompt: "Why do some people perform better under pressure?",
          promptZh: "为什么有些人在压力下表现更好？",
          sample:
            "Usually because they've been there before. Familiarity turns panic into a checklist, so instead of wondering what to do, they start with the first step they already trust.",
          sampleZh:
            "通常是因为他们经历过。熟悉感会把慌乱变成清单，于是他们不会纠结该做什么，而是直接做自己已经信得过的第一步。",
          keywords: [
            {
              label: "解释并对比",
              options: [
                ["usually because"],
                ["instead of"],
                ["they start with"],
                ["familiarity"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Is it better to solve a problem alone or ask for help?",
          promptZh: "解决问题是自己解决还是求助更好？",
          sample:
            "It depends on the clock. If you have time, working it out alone builds skill, but when a deadline is close, asking early is the professional move, not a weakness.",
          sampleZh:
            "这取决于时间。如果有时间，自己解决能积累能力；但如果截止时间很近，早点提问才是专业做法，不是软弱。",
          keywords: [
            {
              label: "分情况回答",
              options: [
                ["it depends"],
                ["if you have time"],
                ["but when"],
                ["rather than"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "How should a team handle a mistake that affects customers?",
          promptZh: "团队应该怎么处理影响客户的错误？",
          sample:
            "Tell customers early and plainly, fix the immediate damage, and then review the cause without hunting for someone to blame. Customers forgive a mistake far more easily than they forgive silence.",
          sampleZh:
            "早点坦率地告诉客户，先修好眼前的损失，再复盘原因，而不是找人背锅。客户原谅错误的程度远高于原谅沉默。",
          keywords: [
            {
              label: "给出步骤",
              options: [
                ["tell customers early"],
                ["and then"],
                ["rather than"],
                ["the first thing"],
              ],
            },
          ],
        },
        {
          speaker: "Examiner",
          prompt: "Do deadlines improve the quality of work?",
          promptZh: "截止日期会提升工作质量吗？",
          sample:
            "Up to a point. A realistic deadline forces decisions, while an impossible one just produces rushed work and a team that stops telling you the truth about progress.",
          sampleZh:
            "到一定程度会。合理的截止日期会逼人做决定，而不可能完成的截止日期只会产出赶工的结果，还让团队不再如实汇报进度。",
          keywords: [
            {
              label: "有保留地认同",
              options: [
                ["up to a point"],
                ["while"],
                ["forces decisions"],
                ["that said"],
              ],
            },
          ],
        },
      ],
    },
  ];

  window.IBALL_SPEAKING_IELTS = {
    part1,
    part2,
    part3,
    prepSeconds: 60,
    longTurnSeconds: 120,
  };
})();
