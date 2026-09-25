# 真实对话与口语训练升级设计

日期：2026-09-25
仓库：`iballiabll/anki-modern-family`

## 目标

在现有英语学习网站上完成一次口语与听力训练升级：

1. 增加成人真实场景对话（职场、租房、医疗、旅行、客服、社交、冲突、面试），内容不幼稚。
2. 增加完整雅思口语模拟：Part 1 → Part 2（准备 + 计时陈述）→ Part 3 追问。
3. 增加日常听力训练来源，复用现有听写页的播放器、句子列表和错题本。
4. 英语朗读默认使用地道美式口音（`en-US`），并允许用户自选声线。
5. 用户可以在页面上自行填写、切换 API 连接（对话模型、语音识别），密钥只留在浏览器。
6. 把考研英语 Skill 的反馈标准接到口语与写作反馈层，不冒充官方分数。
7. 所有记录沿用账号隔离命名空间；注册、登录、找回密码保持现状并继续可用。

## 现状（已存在的可复用部分）

- `app.js` 已经有口语练习区，包含跟读、情景对话、自由聊天三个标签。
- 情景对话已有 3 轮的入门场景与雅思 Part 1/2/3 单轮练习，数据结构为
  `id / title / titleEn / category / level / summary / turns[]`，每轮含
  `speaker / prompt / promptZh / sample / sampleZh / keywords[]`。
- 自由聊天已有本地陪练引擎（`buildLocalFreeTurn`）与 OpenAI 兼容接口
  （`getFreeChatEndpoint` / `requestFreeChatTurn`），设置项包含
  `freeChatApiUrl / freeChatApiModel / freeChatApiKey / freeChatApiAuth`。
- 语音识别支持浏览器 Web Speech 与自定义识别接口
  （`practiceApiUrl / practiceApiModel / practiceApiKey / practiceApiAuth`）。
- 设置与练习历史保存在 `localStorage`，账号数据走 `account-store.js` 的
  `iball:v1:<accountId>:<key>` 命名空间。
- `listen.html` + `listen.js` 已有固定播放器、滚动句子列表、下方答题区与错题本，
  素材来源为 `movie`（美剧原声）与 `cet6`（浏览器朗读）。

## 设计

### 1. 场景数据独立成文件

新增 `speaking-scenarios.js`（成人场景）与 `speaking-ielts.js`（雅思题库），
都用 `window.IBALL_SPEAKING_*` 暴露数据。两者在用户第一次进入口语练习区时才
按需加载，首屏不加载，保持现有首屏预算。

成人场景每场景 5 轮，字段与现有 `DIALOGUE_SCENARIOS` 一致，额外增加：

- `role`：用户在本场景中扮演的角色。
- `register`：口语语域（正式 / 中性 / 随意），用于反馈措辞。
- `phrases`：本场景要带走的高频表达。

雅思题库包含：

- `part1`：话题组，每组 5 问。
- `part2`：题卡，含 4 条要点提示。
- `part3`：与题卡配套的 4 条讨论追问。

### 2. 完整雅思模拟闭环

在口语练习区新增「雅思全真模拟」入口，按官方节奏串起三部分：

1. Part 1：5 问，逐问作答。
2. Part 2：1 分钟准备倒计时 + 2 分钟陈述计时，中途可结束。
3. Part 3：4 条讨论问题，逐条作答。

计时只在前端运行，刷新即重置；结束时给出一份练习报告，包含各部分完成度、
逐轮评分和维度反馈。报告明确标注是练习估算，不是官方成绩。

### 3. 会找话题的对话引擎

本地引擎在现有 `buildLocalFreeTurn` 基础上增加话题推进层：

- 用户回答少于 6 个词时，先给一个可扩展的追问，再换话题。
- 每 3 轮主动引入一个新话题，话题从成人场景包的 `phrases` 与主题池取。
- 话题轮换去重，避免连续重复；记录当前话题，便于报告里回看。

接入自定义 API 时，仍然优先使用用户配置的接口；接口失败时回退到本地引擎，
并在提示区说明回退原因。

### 4. 日常听力

`listen.js` 增加 `daily` 来源，素材来自 `daily-listening-data.js`：

- 每套 8–12 句，围绕一个成人日常场景。
- 没有真人录音时用浏览器朗读，界面注明「浏览器朗读」。
- 复用现有播放、逐句循环、错题本、账号隔离记录，不新增存储体系。

### 5. 美式语音

`speech-transport.js` 已有的声线挑选逻辑继续作为唯一入口：默认按 `en-US`
优先挑选美式声线，用户可在设置中改成本地设备声线或指定性别。自定义 TTS
接口沿用现有识别接口的配置面板形态，不引入服务器密钥。

### 6. 考研反馈标准接入

新增一层口语反馈规则（`speaking-rubric`），维度为：任务完成、表达清晰度、
词汇、语法、连贯性。规则来自本地 `kaoyan-english` Skill 的评分维度，
输出为练习建议，不输出官方分数。写作模块继续使用现有评分逻辑。

### 7. 账号与记录

- 对话记录、雅思报告、听力错题继续按账号命名空间保存。
- 未登录时只写浏览器本地，登录后按账号隔离。
- 不新增服务器端密钥，不把用户 API Key 写入仓库或服务端磁盘。

## 文件改动

新增：

- `speaking-scenarios.js`
- `speaking-ielts.js`
- `daily-listening-data.js`
- `docs/superpowers/specs/2026-09-25-conversation-speaking-design.md`
- `scripts/verify-speaking-modules.mjs`

修改：

- `app.js`：场景懒加载、雅思模拟流程、话题推进、报告渲染。
- `index.html`：入口按钮与雅思模拟控件、脚本版本参数。
- `styles.css`：新增控件样式，沿用现有卡片与按钮风格。
- `listen.js` / `listen.html`：`daily` 来源。
- `scripts/build-manifest.mjs`：把新文件加入静态产物清单。
- `package.json`：`check` 脚本覆盖新文件。

## 验收

自动化：

```bash
npm run check
npm test
npm run build
node scripts/verify-speaking-modules.mjs
node scripts/verify-quiz-e2e.mjs http://127.0.0.1:4176
node scripts/verify-auth-flow.mjs --base http://127.0.0.1:4176
```

浏览器验收（桌面 + 移动）：

- 不配置 API 时能完整跑通成人场景与雅思模拟。
- 配置错误 API 时给出可见提示并回退本地引擎。
- 日常听力能播放、能判分、错题进入错题本。
- 两个账号的对话记录与错题互不可见。

部署：

- 生产入口 `app.iball.top`，`/api/auth` 返回 `storageReady: true`。
- 静态资源带版本参数，Nginx 对 `js/css` 回源校验。
