/*
 * 成人真实场景口语包。
 *
 * 字段与 app.js 里的 DIALOGUE_SCENARIOS 保持一致，额外补充：
 *   role      —— 学习者在本场景里扮演的角色
 *   register  —— 语域：正式 / 中性 / 随意，用于反馈措辞
 *   phrases   —— 本场景结束后应该能带走的高频表达
 *
 * 场景取材于真实生活会遇到的事情，默认按美式英语口语习惯撰写。
 */
(function () {
  const scenarios = [
    {
      id: "workplace-standup",
      title: "职场站会汇报",
      titleEn: "Speaking Up in a Stand-up",
      category: "职场",
      level: "进阶",
      role: "团队里的工程师",
      register: "中性",
      summary: "汇报进度、说明卡点、接下新任务并给出时间承诺。",
      phrases: [
        "I'm on track to ...",
        "I'm blocked on ...",
        "Let me follow up after this",
      ],
      turns: [
        {
          speaker: "Manager",
          prompt:
            "Morning. Let's keep it quick. Where are you on the migration task?",
          promptZh: "早上好，我们简单过一下。迁移那个任务你进展到哪了？",
          sample:
            "I'm about seventy percent done. I finished the data mapping yesterday and I'm testing the rollback path today.",
          sampleZh:
            "我大概完成七成了。昨天做完了数据映射，今天在测试回滚路径。",
          keywords: [
            {
              label: "说明进度",
              options: [
                ["i'm about"],
                ["i finished"],
                ["i'm on track"],
                ["i've done"],
              ],
            },
            {
              label: "说明今天做什么",
              options: [
                ["i'm testing"],
                ["i'm working on"],
                ["today i"],
                ["i'll finish"],
              ],
            },
          ],
        },
        {
          speaker: "Manager",
          prompt: "Any blockers I should know about?",
          promptZh: "有什么需要我知道的阻碍吗？",
          sample:
            "I'm blocked on the staging database. I've asked ops for access, and if I don't get it by noon I'll shift to the docs.",
          sampleZh:
            "我卡在预发布数据库上。已经找运维要权限了，如果中午还没拿到我就先转去写文档。",
          keywords: [
            {
              label: "说明卡点",
              options: [
                ["i'm blocked on"],
                ["i'm waiting on"],
                ["the blocker is"],
                ["i can't"],
              ],
            },
            {
              label: "给出应对方案",
              options: [
                ["i've asked"],
                ["if i don't"],
                ["i'll shift to"],
                ["i'll follow up"],
              ],
            },
          ],
        },
        {
          speaker: "Manager",
          prompt:
            "Got it. Could you also take the customer escalation that came in last night?",
          promptZh: "明白。你能顺便接下昨晚进来的客户升级问题吗？",
          sample:
            "Sure, I can pick that up. Just so I plan my day, is it more urgent than the migration?",
          sampleZh:
            "可以，我接。为了安排今天的工作，这个问题比迁移更急吗？",
          keywords: [
            {
              label: "接受任务",
              options: [
                ["i can pick that up"],
                ["sure"],
                ["happy to"],
                ["i'll take it"],
              ],
            },
            {
              label: "确认优先级",
              options: [
                ["is it more urgent"],
                ["which one comes first"],
                ["should i prioritize"],
                ["what's the priority"],
              ],
            },
          ],
        },
        {
          speaker: "Manager",
          prompt:
            "The escalation is urgent — the customer's account is locked out. Can you give me an estimate?",
          promptZh: "升级问题更急，客户账号被锁了。你能给我一个时间估计吗？",
          sample:
            "Give me twenty minutes to look into it. I'll update you by eleven, even if I don't have a fix yet.",
          sampleZh:
            "给我二十分钟排查。我十一点前同步一次，即使那时还没修好。",
          keywords: [
            {
              label: "给出时间估计",
              options: [
                ["give me"],
                ["about twenty minutes"],
                ["by eleven"],
                ["within an hour"],
              ],
            },
            {
              label: "承诺进度同步",
              options: [
                ["i'll update you"],
                ["i'll let you know"],
                ["i'll circle back"],
                ["i'll keep you posted"],
              ],
            },
          ],
        },
        {
          speaker: "Manager",
          prompt: "Perfect. Anything you need from me?",
          promptZh: "很好。你需要我做什么吗？",
          sample:
            "Two things: approve the access request, and let me know if the customer wants a call today.",
          sampleZh:
            "两件事：批一下权限申请；另外告诉我客户今天是否想通电话。",
          keywords: [
            {
              label: "提出请求",
              options: [
                ["could you approve"],
                ["i need"],
                ["two things"],
                ["can you"],
              ],
            },
            {
              label: "确认后续",
              options: [
                ["let me know"],
                ["if the customer"],
                ["after this"],
                ["i'll follow up"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "rental-viewing",
      title: "租房看房与议价",
      titleEn: "Renting an Apartment",
      category: "生活",
      level: "进阶",
      role: "看房的租客",
      register: "中性",
      summary: "询问条件、提出预算、确认租期与押金，并试着谈价格。",
      phrases: [
        "Is the rent negotiable?",
        "What's included in the rent?",
        "When would the lease start?",
      ],
      turns: [
        {
          speaker: "Agent",
          prompt:
            "Come on in. This is the living room — the unit was renovated last year. What do you think?",
          promptZh:
            "进来看看。这是客厅，这套房去年翻新过。你觉得怎么样？",
          sample:
            "It looks bright. How much natural light does it get in the afternoon?",
          sampleZh: "看起来采光不错。下午的自然光怎么样？",
          keywords: [
            {
              label: "表示印象",
              options: [
                ["it looks"],
                ["it seems"],
                ["nice"],
                ["bright"],
              ],
            },
            {
              label: "追问细节",
              options: [
                ["how much"],
                ["does it get"],
                ["what about"],
                ["is there"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt: "The rent is nineteen hundred a month. What's your budget?",
          promptZh: "月租一千九百美元。你的预算是多少？",
          sample:
            "I was hoping to stay around seventeen hundred. Is the rent negotiable if I sign a longer lease?",
          sampleZh:
            "我希望能控制在一千七左右。如果我签更长的租约，租金有商量余地吗？",
          keywords: [
            {
              label: "说明预算",
              options: [
                ["i was hoping"],
                ["my budget"],
                ["around"],
                ["i can do"],
              ],
            },
            {
              label: "试探议价",
              options: [
                ["is the rent negotiable"],
                ["would you consider"],
                ["any flexibility"],
                ["if i sign"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "Possibly. What's included matters too — utilities are separate here.",
          promptZh:
            "有可能。包含什么也很重要——这里的水电是另外算的。",
          sample:
            "Good to know. What exactly is included in the rent — water, heat, or trash?",
          sampleZh: "了解。租金具体包含什么？水费、取暖费还是垃圾处理费？",
          keywords: [
            {
              label: "询问包含项",
              options: [
                ["what's included"],
                ["is water included"],
                ["what does the rent cover"],
                ["utilities"],
              ],
            },
            {
              label: "回应对方信息",
              options: [
                ["good to know"],
                ["that makes sense"],
                ["i see"],
                ["understood"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "Water and trash are covered. How soon are you looking to move in?",
          promptZh: "水费和垃圾费包含在内。你打算多快入住？",
          sample:
            "I'd like to move in by the first of next month. Could you hold the unit for a week while I decide?",
          sampleZh:
            "我希望下个月一号前入住。能帮我把这套房保留一周吗，让我考虑一下？",
          keywords: [
            {
              label: "说明时间",
              options: [
                ["by the first"],
                ["next month"],
                ["in two weeks"],
                ["as soon as"],
              ],
            },
            {
              label: "礼貌请求",
              options: [
                ["could you hold"],
                ["would it be possible"],
                ["can we"],
                ["i'd like to"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt: "I can, but I'll need a deposit to take it off the market.",
          promptZh: "可以，不过要把房源下架，需要先付押金。",
          sample:
            "That's fair. How much is the deposit, and under what conditions is it refundable?",
          sampleZh:
            "可以理解。押金多少？在什么情况下可以退还？",
          keywords: [
            {
              label: "询问金额",
              options: [
                ["how much is"],
                ["what's the deposit"],
                ["the deposit"],
                ["it's"],
              ],
            },
            {
              label: "确认退还条件",
              options: [
                ["is it refundable"],
                ["under what conditions"],
                ["when do i get it back"],
                ["is it returned"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "clinic-visit",
      title: "诊所看病",
      titleEn: "At the Doctor's Office",
      category: "健康",
      level: "进阶",
      role: "看诊的病人",
      register: "正式",
      summary: "说清症状和病史、回答追问、确认用药与复诊安排。",
      phrases: [
        "I've had ... for about a week.",
        "It gets worse when ...",
        "How often should I take it?",
      ],
      turns: [
        {
          speaker: "Doctor",
          prompt: "What brings you in today?",
          promptZh: "今天哪里不舒服？",
          sample:
            "I've had a sore throat and a mild fever for about five days, and it's getting worse at night.",
          sampleZh:
            "喉咙痛加低烧大概五天了，晚上会更严重。",
          keywords: [
            {
              label: "说明症状",
              options: [
                ["i've had"],
                ["i have a"],
                ["sore throat"],
                ["fever"],
              ],
            },
            {
              label: "说明时长与变化",
              options: [
                ["for about"],
                ["for five days"],
                ["getting worse"],
                ["at night"],
              ],
            },
          ],
        },
        {
          speaker: "Doctor",
          prompt: "Any other symptoms, like a cough or body aches?",
          promptZh: "还有其他症状吗，比如咳嗽或者全身酸痛？",
          sample:
            "Yes, a dry cough, and I've been unusually tired. I don't have any chest pain, though.",
          sampleZh:
            "有，干咳，而且特别容易累。不过我胸口不疼。",
          keywords: [
            {
              label: "补充症状",
              options: [
                ["dry cough"],
                ["body aches"],
                ["tired"],
                ["headache"],
              ],
            },
            {
              label: "排除症状",
              options: [
                ["i don't have"],
                ["no chest pain"],
                ["i haven't had"],
                ["without"],
              ],
            },
          ],
        },
        {
          speaker: "Doctor",
          prompt: "Are you on any medication? Any allergies?",
          promptZh: "你目前在吃什么药吗？有过敏史吗？",
          sample:
            "I'm not on anything regularly, but I'm allergic to penicillin — it gave me a rash last time.",
          sampleZh:
            "我平时不吃常备药，但我对青霉素过敏，上次吃过起了皮疹。",
          keywords: [
            {
              label: "说明用药情况",
              options: [
                ["i'm not on"],
                ["i take"],
                ["regularly"],
                ["nothing"],
              ],
            },
            {
              label: "说明过敏",
              options: [
                ["i'm allergic to"],
                ["allergy"],
                ["it gave me"],
                ["rash"],
              ],
            },
          ],
        },
        {
          speaker: "Doctor",
          prompt:
            "It looks like a throat infection. I'll prescribe an antibiotic — do you have any questions?",
          promptZh:
            "看起来是咽喉感染。我给你开一种抗生素——你有问题吗？",
          sample:
            "A couple: how often should I take it, and are there side effects I should watch for?",
          sampleZh:
            "有两个：多久吃一次？有没有需要注意的副作用？",
          keywords: [
            {
              label: "询问用法",
              options: [
                ["how often"],
                ["how many times"],
                ["should i take"],
                ["with food"],
              ],
            },
            {
              label: "询问副作用",
              options: [
                ["side effects"],
                ["should i watch for"],
                ["is it safe"],
                ["any warnings"],
              ],
            },
          ],
        },
        {
          speaker: "Doctor",
          prompt:
            "Twice a day for seven days. Come back if it isn't better in three days. Anything else?",
          promptZh:
            "一天两次，连吃七天。如果三天内没好转就回来复诊。还有别的事吗？",
          sample:
            "One more thing — can I go back to the gym, or should I rest until the fever breaks?",
          sampleZh:
            "还有一件事：我能去健身房吗，还是应该休息到退烧？",
          keywords: [
            {
              label: "确认注意事项",
              options: [
                ["can i"],
                ["should i rest"],
                ["before i"],
                ["is it ok to"],
              ],
            },
            {
              label: "复述医嘱",
              options: [
                ["twice a day"],
                ["for seven days"],
                ["come back"],
                ["if it isn't better"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "airport-delay",
      title: "航班延误改签",
      titleEn: "Rebooking a Delayed Flight",
      category: "出行",
      level: "进阶",
      role: "被延误的旅客",
      register: "正式",
      summary: "问清延误原因、争取改签、确认行李和酒店安排。",
      phrases: [
        "What are my options?",
        "Is there an earlier connection?",
        "Could you put that in writing?",
      ],
      turns: [
        {
          speaker: "Agent",
          prompt:
            "Thanks for waiting. Your flight is delayed by four hours. How can I help?",
          promptZh:
            "感谢等待。您的航班延误四个小时。有什么可以帮您？",
          sample:
            "I'll miss my connection in Chicago. What are my options to get there tonight?",
          sampleZh:
            "我会错过在芝加哥的转机。今晚还有哪些方式能到那里？",
          keywords: [
            {
              label: "说明影响",
              options: [
                ["i'll miss"],
                ["my connection"],
                ["i'm connecting"],
                ["that means"],
              ],
            },
            {
              label: "询问方案",
              options: [
                ["what are my options"],
                ["is there"],
                ["can you rebook"],
                ["what can i do"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "I can put you on a later flight that arrives at eleven, or an earlier one tomorrow morning.",
          promptZh:
            "我可以给您改到今晚十一点到的航班，或者明早更早的一班。",
          sample:
            "I'd rather get in tonight, even if it's late. Is there anything through Denver?",
          sampleZh:
            "我更想今晚到，即使很晚。有没有经丹佛的航线？",
          keywords: [
            {
              label: "表达偏好",
              options: [
                ["i'd rather"],
                ["i prefer"],
                ["tonight"],
                ["if possible"],
              ],
            },
            {
              label: "询问其他航线",
              options: [
                ["is there anything through"],
                ["any other route"],
                ["what about"],
                ["could you check"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "There is, but it's a tight connection — about thirty-five minutes.",
          promptZh: "有，但转机时间很紧——大约三十五分钟。",
          sample:
            "That's risky. Could you check whether the first flight is running on time before you book it?",
          sampleZh:
            "这有点冒险。改签之前能先查一下第一段是否准点吗？",
          keywords: [
            {
              label: "表达顾虑",
              options: [
                ["that's risky"],
                ["that's tight"],
                ["i'm worried"],
                ["sounds risky"],
              ],
            },
            {
              label: "提出请求",
              options: [
                ["could you check"],
                ["would you mind checking"],
                ["can you confirm"],
                ["before you book"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt: "It's on time. What about your checked bag?",
          promptZh: "是准点的。您的托运行李怎么处理？",
          sample:
            "The bag is checked through to my final destination. Can you make sure it follows the new routing?",
          sampleZh:
            "行李是直挂到最终目的地的。能确认它会跟着新的航段走吗？",
          keywords: [
            {
              label: "说明行李",
              options: [
                ["checked through"],
                ["my bag"],
                ["checked bag"],
                ["final destination"],
              ],
            },
            {
              label: "要求确认",
              options: [
                ["can you make sure"],
                ["please confirm"],
                ["follow the new"],
                ["will it"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "I'll reissue the ticket now. Because it's weather-related, we can't cover a hotel.",
          promptZh:
            "我现在重出票。因为是天气原因，我们无法承担酒店费用。",
          sample:
            "I understand. Could you give me a written delay notice for my travel insurance?",
          sampleZh:
            "我理解。能给我一份书面的延误证明吗，我要用保险理赔。",
          keywords: [
            {
              label: "表示理解",
              options: [
                ["i understand"],
                ["that's fair"],
                ["i see"],
                ["no problem"],
              ],
            },
            {
              label: "索要凭证",
              options: [
                ["written"],
                ["a notice"],
                ["for my insurance"],
                ["could you give me"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "customer-refund",
      title: "客服退款交涉",
      titleEn: "Getting a Refund",
      category: "消费",
      level: "进阶",
      role: "要退款的顾客",
      register: "中性",
      summary: "说明问题、出示订单信息、坚持诉求并确认到账时间。",
      phrases: [
        "I'd like to request a refund.",
        "That doesn't quite work for me.",
        "Could you confirm the timeline?",
      ],
      turns: [
        {
          speaker: "Agent",
          prompt:
            "Thanks for calling. Can I get your order number and a quick description of the issue?",
          promptZh:
            "感谢来电。能提供订单号，并简单说下问题吗？",
          sample:
            "Sure, the order is B-four-seven-two-nine. The headphones arrived with a cracked headband.",
          sampleZh:
            "好的，订单号是 B-4729。耳机到货时头梁是裂的。",
          keywords: [
            {
              label: "提供订单信息",
              options: [
                ["the order is"],
                ["order number"],
                ["i ordered"],
                ["it's"],
              ],
            },
            {
              label: "说明问题",
              options: [
                ["arrived with"],
                ["it's damaged"],
                ["cracked"],
                ["doesn't work"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "I'm sorry about that. I can offer a replacement, or store credit.",
          promptZh: "很抱歉。我们可以换货，或者给您店铺余额。",
          sample:
            "I'd rather have a refund. I've already bought another pair, so a replacement isn't useful to me.",
          sampleZh:
            "我还是想要退款。我已经买了别的耳机，换货对我没用了。",
          keywords: [
            {
              label: "坚持诉求",
              options: [
                ["i'd rather"],
                ["i'd like a refund"],
                ["a refund"],
                ["i prefer"],
              ],
            },
            {
              label: "说明原因",
              options: [
                ["i've already"],
                ["because"],
                ["isn't useful"],
                ["so"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "Our policy says refunds are only available within fourteen days, and you're on day twenty.",
          promptZh:
            "我们的政策是十四天内才能退款，您已经第二十天了。",
          sample:
            "I understand the policy, but the item arrived damaged, so it isn't a change of mind. Could you make an exception?",
          sampleZh:
            "我理解政策，但商品到货就是损坏的，不是改变主意。能通融一次吗？",
          keywords: [
            {
              label: "承认政策",
              options: [
                ["i understand"],
                ["i appreciate"],
                ["that's your policy"],
                ["i get that"],
              ],
            },
            {
              label: "争取例外",
              options: [
                ["make an exception"],
                ["in this case"],
                ["isn't a change of mind"],
                ["could you"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt:
            "Let me check with my supervisor. Can you send a photo of the damage?",
          promptZh: "我跟主管确认一下。您能发一张损坏的照片吗？",
          sample:
            "I'll send two photos right now, including the packaging. Would you mind noting the case number?",
          sampleZh:
            "我马上发两张照片，包括外包装。能麻烦您记一下工单号吗？",
          keywords: [
            {
              label: "配合提供材料",
              options: [
                ["i'll send"],
                ["right now"],
                ["photos"],
                ["attached"],
              ],
            },
            {
              label: "请求记录",
              options: [
                ["would you mind"],
                ["case number"],
                ["noting"],
                ["reference number"],
              ],
            },
          ],
        },
        {
          speaker: "Agent",
          prompt: "Approved. Anything else I can do?",
          promptZh: "已经批准了。还有其他需要吗？",
          sample:
            "Just one question — how long will the refund take to show up on my card?",
          sampleZh:
            "就一个问题：退款多久会出现在我的银行卡上？",
          keywords: [
            {
              label: "确认到账时间",
              options: [
                ["how long"],
                ["will it take"],
                ["show up"],
                ["when will"],
              ],
            },
            {
              label: "确认方式",
              options: [
                ["on my card"],
                ["to my account"],
                ["by email"],
                ["confirmation"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "networking-small-talk",
      title: "行业活动社交",
      titleEn: "Small Talk at a Meetup",
      category: "社交",
      level: "中级",
      role: "参加活动的从业者",
      register: "随意",
      summary: "自然开场、介绍自己、把闲聊推进成一次真实交流。",
      phrases: [
        "What brought you here tonight?",
        "I work on ...",
        "Let's keep in touch.",
      ],
      turns: [
        {
          speaker: "Attendee",
          prompt:
            "Hey, is this seat taken? That talk on deployment was packed, huh?",
          promptZh:
            "嗨，这位子有人吗？刚才那场关于部署的分享人很多啊。",
          sample:
            "Go ahead, it's free. Yeah, I got here early and still ended up standing at the back.",
          sampleZh:
            "请坐，没人。是啊，我到得挺早，结果还是站在后面。",
          keywords: [
            {
              label: "回应开场",
              options: [
                ["go ahead"],
                ["it's free"],
                ["yeah"],
                ["no one's sitting there"],
              ],
            },
            {
              label: "延续话题",
              options: [
                ["i got here early"],
                ["still ended up"],
                ["it was packed"],
                ["same here"],
              ],
            },
          ],
        },
        {
          speaker: "Attendee",
          prompt: "What do you do? Are you a developer?",
          promptZh: "你是做什么的？是开发者吗？",
          sample:
            "I work on backend systems, mostly APIs. What about you?",
          sampleZh:
            "我做后端系统，主要是 API。你呢？",
          keywords: [
            {
              label: "介绍自己",
              options: [
                ["i work on"],
                ["i'm a"],
                ["i do"],
                ["my background"],
              ],
            },
            {
              label: "把问题抛回去",
              options: [
                ["what about you"],
                ["how about you"],
                ["and you"],
                ["what do you do"],
              ],
            },
          ],
        },
        {
          speaker: "Attendee",
          prompt:
            "Nice — I'm on the data side. Are you working on anything interesting right now?",
          promptZh:
            "不错，我偏数据方向。你最近在做什么有意思的项目吗？",
          sample:
            "I'm rebuilding our search service. It's tedious but kind of fun — I finally understand why ranking is so hard.",
          sampleZh:
            "我在重做搜索服务。挺枯燥但有点意思——我终于明白排序为什么这么难了。",
          keywords: [
            {
              label: "介绍项目",
              options: [
                ["i'm rebuilding"],
                ["i'm working on"],
                ["right now"],
                ["we're building"],
              ],
            },
            {
              label: "给出一句评价",
              options: [
                ["it's tedious"],
                ["kind of fun"],
                ["it's interesting"],
                ["hard"],
              ],
            },
          ],
        },
        {
          speaker: "Attendee",
          prompt:
            "That's right up my alley. Do you have a card, or should we connect on LinkedIn?",
          promptZh:
            "这正对我的路子。你有名片吗，还是我们加个 LinkedIn？",
          sample:
            "Let's connect on LinkedIn — I'll send you the article I mentioned. I'm fairly easy to find by name.",
          sampleZh:
            "我们加 LinkedIn 吧——我把我提到的文章发给你。按名字应该很好找。",
          keywords: [
            {
              label: "选择联系方式",
              options: [
                ["let's connect"],
                ["linkedin"],
                ["i'll send you"],
                ["here's my"],
              ],
            },
            {
              label: "承诺后续动作",
              options: [
                ["i'll send you"],
                ["i'll share"],
                ["keep in touch"],
                ["follow up"],
              ],
            },
          ],
        },
        {
          speaker: "Attendee",
          prompt:
            "Great. Are you staying for the last session, or heading out?",
          promptZh: "太好了。你要留下来听最后一场，还是先走？",
          sample:
            "I'll stick around for the last one. If you're free afterward, a few of us usually grab food nearby.",
          sampleZh:
            "我留下来听最后一场。你之后有空的话，我们几个人一般会在附近吃点东西。",
          keywords: [
            {
              label: "说明安排",
              options: [
                ["i'll stick around"],
                ["i'm staying"],
                ["heading out"],
                ["i'll stay"],
              ],
            },
            {
              label: "发出邀请",
              options: [
                ["if you're free"],
                ["afterward"],
                ["grab food"],
                ["join us"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "landlord-dispute",
      title: "押金与维修交涉",
      titleEn: "Dealing With a Landlord",
      category: "生活",
      level: "高阶",
      role: "要拿回押金的租客",
      register: "正式",
      summary: "用事实讲清问题、引用合同条款、设定合理期限。",
      phrases: [
        "According to the lease ...",
        "I'd like to resolve this in writing.",
        "What's a fair timeline?",
      ],
      turns: [
        {
          speaker: "Landlord",
          prompt:
            "I'm keeping part of your deposit for cleaning. That's standard, you know.",
          promptZh:
            "我要扣你一部分押金作为清洁费。这是常规做法。",
          sample:
            "I'd like to understand the charge first. Could you itemize what was cleaned and what it cost?",
          sampleZh:
            "我想先弄清楚这笔费用。能把清洁项目和金额逐条列出来吗？",
          keywords: [
            {
              label: "要求说明",
              options: [
                ["could you itemize"],
                ["break down"],
                ["i'd like to understand"],
                ["what it cost"],
              ],
            },
            {
              label: "保持冷静",
              options: [
                ["first"],
                ["before we"],
                ["i'd like to"],
                ["can we"],
              ],
            },
          ],
        },
        {
          speaker: "Landlord",
          prompt:
            "Well, the place needed a deep clean. I don't have receipts for that.",
          promptZh:
            "嗯，房子需要深度清洁。这部分我没有收据。",
          sample:
            "According to the lease, cleaning charges need receipts. Without one, that deduction is hard to justify.",
          sampleZh:
            "按合同，清洁费用需要收据。没有收据的话，这笔扣款很难说得通。",
          keywords: [
            {
              label: "引用合同",
              options: [
                ["according to the lease"],
                ["the lease says"],
                ["it's stated"],
                ["section"],
              ],
            },
            {
              label: "表达异议",
              options: [
                ["hard to justify"],
                ["i can't agree to"],
                ["that's not"],
                ["doesn't hold up"],
              ],
            },
          ],
        },
        {
          speaker: "Landlord",
          prompt:
            "Look, this is how I've always done it. What do you want me to do?",
          promptZh:
            "听着，我一直都这么做的。你想让我怎么办？",
          sample:
            "Two things: return the deposit in full, and fix the water heater that stopped working in March.",
          sampleZh:
            "两件事：全额退还押金；还有修好三月就不出热水的热水器。",
          keywords: [
            {
              label: "提出明确诉求",
              options: [
                ["two things"],
                ["return the deposit"],
                ["in full"],
                ["i'd like"],
              ],
            },
            {
              label: "陈述事实",
              options: [
                ["stopped working"],
                ["in march"],
                ["hasn't worked"],
                ["since"],
              ],
            },
          ],
        },
        {
          speaker: "Landlord",
          prompt:
            "I'll think about it. I'm pretty busy this month, honestly.",
          promptZh: "我考虑一下。说实话这个月我很忙。",
          sample:
            "I appreciate that, but this has been open since March. Let's put it in writing with a two-week deadline.",
          sampleZh:
            "我理解，但这事从三月拖到现在了。我们书面确认一下，定两周的期限吧。",
          keywords: [
            {
              label: "设定期限",
              options: [
                ["two-week deadline"],
                ["by the end of"],
                ["let's put it in writing"],
                ["timeline"],
              ],
            },
            {
              label: "礼貌但坚定",
              options: [
                ["i appreciate that"],
                ["but"],
                ["has been open"],
                ["let's"],
              ],
            },
          ],
        },
        {
          speaker: "Landlord",
          prompt:
            "Fine. Email me and I'll look at it. Anything else before I go?",
          promptZh:
            "行。给我发邮件，我看一下。走之前还有别的事吗？",
          sample:
            "One more: please reply in writing so we both have a record. I'll send the summary today.",
          sampleZh:
            "还有一件：请书面回复，双方都有个记录。我今天就把摘要发过去。",
          keywords: [
            {
              label: "要求书面确认",
              options: [
                ["in writing"],
                ["so we both have a record"],
                ["reply by email"],
                ["confirm"],
              ],
            },
            {
              label: "承诺后续",
              options: [
                ["i'll send"],
                ["today"],
                ["the summary"],
                ["this evening"],
              ],
            },
          ],
        },
      ],
    },
    {
      id: "interview-deep-dive",
      title: "行为面试深挖",
      titleEn: "Behavioral Interview",
      category: "职场",
      level: "高阶",
      role: "面试候选人",
      register: "正式",
      summary: "用 STAR 结构讲经历，接住追问，问出关键信息。",
      phrases: [
        "The situation was ...",
        "What I owned was ...",
        "What I'd do differently is ...",
      ],
      turns: [
        {
          speaker: "Interviewer",
          prompt:
            "Tell me about a project you're proud of, and what your specific role was.",
          promptZh:
            "讲讲一个你引以为豪的项目，以及你具体负责什么。",
          sample:
            "The situation was a checkout flow losing users at payment. I owned the frontend rewrite and the rollout plan.",
          sampleZh:
            "背景是结账流程在支付环节大量流失用户。我负责前端重写和上线方案。",
          keywords: [
            {
              label: "交代背景",
              options: [
                ["the situation was"],
                ["at the time"],
                ["we had"],
                ["the problem was"],
              ],
            },
            {
              label: "说明职责",
              options: [
                ["i owned"],
                ["my role was"],
                ["i was responsible for"],
                ["i led"],
              ],
            },
          ],
        },
        {
          speaker: "Interviewer",
          prompt: "What was the hardest part, and how did you handle it?",
          promptZh: "最难的部分是什么？你怎么处理的？",
          sample:
            "Honestly, the hardest part was the disagreement with the payments team. I set up a weekly review so we argued with data instead of opinions.",
          sampleZh:
            "说实话，最难的是和支付团队的冲突。我建了每周评审，让大家用数据讨论而不是凭感觉。",
          keywords: [
            {
              label: "承认难点",
              options: [
                ["the hardest part"],
                ["honestly"],
                ["the challenge"],
                ["what made it hard"],
              ],
            },
            {
              label: "说明做法",
              options: [
                ["i set up"],
                ["i handled it by"],
                ["so we"],
                ["my approach"],
              ],
            },
          ],
        },
        {
          speaker: "Interviewer",
          prompt:
            "Give me a number. What was the impact, and how do you know it was your work?",
          promptZh:
            "给个数字。带来了什么影响？你怎么确定是你的功劳？",
          sample:
            "Payment completion went from sixty-eight to eighty-one percent. I can't claim all of it, but we A/B tested the change, so the lift is measurable.",
          sampleZh:
            "支付完成率从 68% 提到 81%。不能全算我的功劳，但我们做了 A/B 测试，提升是可量化的。",
          keywords: [
            {
              label: "给出数字",
              options: [
                ["went from"],
                ["to eighty-one"],
                ["percent"],
                ["increased by"],
              ],
            },
            {
              label: "诚实归因",
              options: [
                ["i can't claim all of it"],
                ["we tested"],
                ["measurable"],
                ["the data shows"],
              ],
            },
          ],
        },
        {
          speaker: "Interviewer",
          prompt:
            "If you joined us, how would you approach a similar problem with less headcount?",
          promptZh:
            "如果你加入我们，在人手更少的情况下会怎么处理类似问题？",
          sample:
            "I'd narrow the scope first. With less headcount I'd fix the drop-off point with the highest impact, measure for two weeks, then decide what's next.",
          sampleZh:
            "我会先缩小范围。人手少的时候先修流失最严重的那一环，观察两周，再决定下一步。",
          keywords: [
            {
              label: "给出方法",
              options: [
                ["i'd narrow"],
                ["first"],
                ["highest impact"],
                ["then decide"],
              ],
            },
            {
              label: "说明验证方式",
              options: [
                ["measure for"],
                ["two weeks"],
                ["decide"],
                ["check"],
              ],
            },
          ],
        },
        {
          speaker: "Interviewer",
          prompt: "Good. Any questions for me?",
          promptZh: "不错。你有什么想问我的吗？",
          sample:
            "Two, if that's alright: how do you measure success for this role in the first six months, and what would make you say this hire didn't work out?",
          sampleZh:
            "如果可以的话，两个问题：这个岗位前六个月的成功标准是什么？什么情况会让你觉得招错了人？",
          keywords: [
            {
              label: "提出问题",
              options: [
                ["how do you measure"],
                ["what would make you"],
                ["in the first six months"],
                ["success for this role"],
              ],
            },
            {
              label: "礼貌铺垫",
              options: [
                ["if that's alright"],
                ["two questions"],
                ["do you mind"],
                ["i'm curious"],
              ],
            },
          ],
        },
      ],
    },
  ];

  window.IBALL_SPEAKING_SCENARIOS = scenarios;
})();
