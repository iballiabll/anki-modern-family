/**
 * 封神之路 · 数学资料目录。
 *
 * 这里只放「资料本身的结构」：书名、分册、章节目录，一本书一套导航，
 * 互不共用。完成的题数、正确率、错题这些学习数据全部由 app.js 存在
 * iball 账号空间里，默认是空的，需要自己录入。
 *
 * 字段说明：
 *   key      唯一标识，用于存放学习进度
 *   tab      顶部资料条上的短名
 *   group    资料分组：tiku 习题册 / jiangyi 讲义全书 / zhenti 真题
 *   category 资料分类（基础、强化、专项、模拟、真题等）
 *   focus    主要覆盖科目：高数、线代、概率
 *   stage    适合的复习阶段
 *   phases   分篇（基础篇、强化篇…），没有分篇的书留空数组
 *   total    全书题量（按书名标注），用于算整本完成度
 *   sections 一本书自己的分册与章节，章节之间互不共用
 */
(function () {
  "use strict";

  const groups = [
    { key: "tiku", label: "习题册" },
    { key: "jiangyi", label: "讲义 · 全书" },
    { key: "moni", label: "模拟卷" },
    { key: "zhenti", label: "真题" },
  ];

  const zy18Chapters = [
    "函数、极限、连续",
    "数列极限",
    "导数与微分",
    "微分中值定理",
    "泰勒公式",
    "一元微分学应用",
    "不定积分",
    "定积分及其应用",
    "反常积分",
    "多元函数微分学",
    "二重积分",
    "微分方程",
    "无穷级数",
    "空间解析几何",
    "曲线积分",
    "曲面积分",
    "场论初步",
    "综合题与真题选讲",
  ];

  const tangChapters = [
    "函数、极限、连续",
    "一元函数微分学",
    "一元函数积分学",
    "微分中值定理",
    "多元函数微分学",
    "二重积分与三重积分",
    "曲线积分与曲面积分",
    "微分方程",
    "无穷级数",
    "空间解析几何",
    "综合应用",
  ];

  /** 模拟卷的每一套都带书名，避免不同卷子共用同一套目录。 */
  const monoPapers = (count, label) => [
    { name: "数学一", short: "数一", chapters: monoChapters(count, label) },
    { name: "数学二", short: "数二", chapters: monoChapters(count, label) },
    { name: "数学三", short: "数三", chapters: monoChapters(count, label) },
  ];

  const monoChapters = (count, label) =>
    Array.from({ length: count }, (_, index) => `${label} 第 ${index + 1} 套`);

  /* 下面每一套章节目录各自独立：习题册按自己的篇目和题型分章，
     讲义按「讲」编号，模拟卷按套数，书与书之间不共用导航。 */

  const zy1000Gaoshu = [
    "函数、极限、连续",
    "一元函数微分学",
    "一元函数积分学",
    "多元函数微分学",
    "二重积分",
    "微分方程",
    "无穷级数",
    "向量代数与空间解析几何",
    "曲线积分与曲面积分",
  ];
  const zy1000Xiandai = ["行列式与矩阵", "向量与线性方程组", "特征值与特征向量", "二次型"];
  const zy1000Gailv = [
    "随机事件与概率",
    "一维随机变量及其分布",
    "多维随机变量及其分布",
    "随机变量的数字特征",
    "大数定律与中心极限定理",
    "数理统计",
  ];

  const tang1800Gaoshu = [
    "函数、极限、连续",
    "导数与微分",
    "微分中值定理与导数应用",
    "不定积分",
    "定积分及其应用",
    "多元函数微分学",
    "二重积分",
    "常微分方程",
    "无穷级数",
    "空间解析几何与多元积分学",
  ];
  const tang1800Xiandai = ["行列式", "矩阵", "向量", "线性方程组", "特征值与特征向量", "二次型"];
  const tang1800Gailv = [
    "随机事件与概率",
    "一维随机变量及其分布",
    "多维随机变量及其分布",
    "随机变量的数字特征",
    "大数定律与中心极限定理",
    "数理统计的基本概念",
    "参数估计",
  ];

  const lyl660Gaoshu = [
    "函数、极限与连续",
    "导数与微分",
    "中值定理与导数应用",
    "不定积分与定积分",
    "多元函数微分学",
    "二重积分",
    "无穷级数",
    "常微分方程",
  ];
  const lyl660Xiandai = ["行列式", "矩阵", "向量", "线性方程组", "特征值与特征向量", "二次型"];
  const lyl660Gailv = [
    "随机事件与概率",
    "随机变量及其分布",
    "多维随机变量分布",
    "随机变量的数字特征",
    "数理统计",
  ];

  const lyl330Gaoshu = [
    "极限与连续",
    "一元函数微分学",
    "一元函数积分学",
    "中值定理及其应用",
    "多元微分学与二重积分",
    "无穷级数",
    "微分方程",
  ];
  const lyl330Xiandai = ["行列式与矩阵", "向量与线性方程组", "特征值、相似与二次型"];
  const lyl330Gailv = ["随机变量与分布", "随机变量的数字特征", "大数定律与数理统计"];

  const ll880Gaoshu = [
    "函数、极限、连续",
    "一元函数微分学",
    "一元函数积分学",
    "中值定理与导数应用",
    "多元函数微分学",
    "二重积分",
    "常微分方程",
    "无穷级数",
    "空间解析几何",
    "曲线积分与曲面积分",
  ];
  const ll880Xiandai = ["行列式", "矩阵", "向量", "线性方程组", "特征值与特征向量", "二次型与相似合同"];
  const ll880Gailv = [
    "随机事件与概率",
    "一维随机变量",
    "多维随机变量",
    "随机变量的数字特征",
    "大数定律与中心极限定理",
    "数理统计基本概念",
    "参数估计",
    "假设检验",
  ];

  const ll108Gaoshu = [
    "函数与极限专项",
    "微分学核心方法",
    "积分学核心方法",
    "中值定理与证明题",
    "多元微分与二重积分",
    "级数与微分方程",
    "空间解析几何与曲线曲面积分",
  ];
  const ll108Xiandai = ["行列式与秩", "向量与方程组", "特征值与二次型"];
  const ll108Gailv = ["概率模型与分布", "数字特征与极限定理", "统计推断"];

  const xdf1000Gaoshu = [
    "函数、极限、连续",
    "一元函数微分学",
    "一元函数积分学",
    "多元函数微分学",
    "二重积分",
    "微分方程",
    "无穷级数",
    "综合题与真题改编",
  ];
  const xdf1000Xiandai = ["行列式", "矩阵", "向量", "线性方程组", "特征值与特征向量", "二次型"];
  const xdf1000Gailv = [
    "随机事件与概率",
    "随机变量及其分布",
    "多维随机变量",
    "随机变量的数字特征",
    "数理统计",
  ];

  const jinbangGaoshu = [
    "函数、极限、连续",
    "导数与微分",
    "中值定理与导数应用",
    "不定积分与定积分",
    "多元函数微分学",
    "二重积分",
    "常微分方程",
    "无穷级数",
    "空间解析几何",
    "曲线积分与曲面积分",
    "应用题与证明题",
  ];
  const jinbangXiandai = ["行列式", "矩阵", "向量", "线性方程组", "特征值与特征向量", "二次型"];
  const jinbangGailv = [
    "随机事件与概率",
    "一维随机变量及其分布",
    "多维随机变量及其分布",
    "随机变量的数字特征",
    "大数定律与中心极限定理",
    "数理统计的基本概念",
    "参数估计",
  ];

  const wzxYantiGaoshu = [
    "函数、极限、连续",
    "导数与微分",
    "微分中值定理与导数应用",
    "不定积分与定积分",
    "反常积分",
    "多元函数微分学",
    "二重积分",
    "微分方程",
    "无穷级数",
    "空间解析几何与曲线曲面积分",
  ];

  const zy30Jiang = [
    "第 1 讲 函数、极限、连续",
    "第 2 讲 数列极限",
    "第 3 讲 导数与微分",
    "第 4 讲 中值定理与导数应用",
    "第 5 讲 不定积分",
    "第 6 讲 定积分及其应用",
    "第 7 讲 反常积分",
    "第 8 讲 多元函数微分学",
    "第 9 讲 二重积分",
    "第 10 讲 微分方程",
    "第 11 讲 无穷级数",
    "第 12 讲 空间解析几何",
    "第 13 讲 曲线积分与曲面积分",
    "第 14 讲 综合题与真题改编",
  ];

  const probabilityChapters = [
    "随机事件与概率",
    "一维随机变量及其分布",
    "多维随机变量及其分布",
    "随机变量的数字特征",
    "大数定律与中心极限定理",
    "数理统计的基本概念",
    "参数估计",
    "假设检验",
  ];

  const books = [
    {
      key: "zy1000",
      tab: "张宇1000题",
      title: "张宇 1000题",
      group: "tiku",
      meta: "2027版 · 数学一 · 基础篇 + 强化篇",
      note: "基础篇打底、强化篇拔高，章节目录按书里的篇目走。逐章记完成题数和正确率，做错的题在记录里标错因。",
      icon: "book-open",
      tone: "blue",
      unit: "题",
      total: 1000,
      phases: ["基础篇", "强化篇"],
      sections: [
        { name: "高等数学", short: "高数", chapters: zy1000Gaoshu },
        { name: "线性代数", short: "线代", chapters: zy1000Xiandai },
        { name: "概率论与数理统计", short: "概率", chapters: zy1000Gailv },
      ],
    },
    {
      key: "tang1800",
      tab: "汤家凤1800题",
      title: "汤家凤 1800题",
      group: "tiku",
      meta: "数学一 · 基础篇 + 强化篇",
      note: "题量大，适合按章刷基础。基础篇和强化篇分开记，重点章可以单独加记录。",
      icon: "book-open",
      tone: "cyan",
      unit: "题",
      total: 1800,
      phases: ["基础篇", "强化篇"],
      sections: [
        { name: "高等数学", short: "高数", chapters: tang1800Gaoshu },
        { name: "线性代数", short: "线代", chapters: tang1800Xiandai },
        { name: "概率论与数理统计", short: "概率", chapters: tang1800Gailv },
      ],
    },
    {
      key: "lyl660",
      tab: "李永乐660题",
      title: "李永乐 660题",
      group: "tiku",
      meta: "数学基础过关 · 数一 · 选择 + 填空",
      note: "全是选填小题，一章一章记正确率最有用。没做出来、算错、审题错分开标，别都算成粗心。",
      icon: "pencil-ruler",
      tone: "coral",
      unit: "题",
      total: 660,
      phases: [],
      sections: [
        { name: "高等数学", short: "高数", chapters: lyl660Gaoshu },
        { name: "线性代数", short: "线代", chapters: lyl660Xiandai },
        { name: "概率论与数理统计", short: "概率", chapters: lyl660Gailv },
      ],
    },
    {
      key: "lyl330",
      tab: "李永乐330题",
      title: "李永乐 330题",
      group: "tiku",
      meta: "强化阶段 · 数一 · 综合小题",
      note: "强化阶段的综合小题，按章记正确率，错题直接连到错题本按遗忘曲线复盘。",
      icon: "pencil-ruler",
      tone: "amber",
      unit: "题",
      total: 330,
      phases: [],
      sections: [
        { name: "高等数学", short: "高数", chapters: lyl330Gaoshu },
        { name: "线性代数", short: "线代", chapters: lyl330Xiandai },
        { name: "概率论与数理统计", short: "概率", chapters: lyl330Gailv },
      ],
    },
    {
      key: "ll880",
      tab: "李林880题",
      title: "李林 880题",
      group: "tiku",
      meta: "数一 · 基础篇 + 强化篇",
      note: "基础篇和强化篇难度拉得开，两篇分别记；线代、概率的章节顺序和教材一致。",
      icon: "layers",
      tone: "violet",
      unit: "题",
      total: 880,
      phases: ["基础篇", "强化篇"],
      sections: [
        { name: "高等数学", short: "高数", chapters: ll880Gaoshu },
        { name: "线性代数", short: "线代", chapters: ll880Xiandai },
        { name: "概率论与数理统计", short: "概率", chapters: ll880Gailv },
      ],
    },
    {
      key: "ll108",
      tab: "李林108题",
      title: "李林 108题",
      group: "tiku",
      meta: "冲刺阶段 · 数一 · 综合大题",
      note: "冲刺阶段的大题专项，一题一类；做不出来的直接标成“一直不会”，下一轮优先做。",
      icon: "flame",
      tone: "coral",
      unit: "题",
      total: 108,
      phases: [],
      sections: [
        { name: "高等数学", short: "高数", chapters: ll108Gaoshu },
        { name: "线性代数", short: "线代", chapters: ll108Xiandai },
        { name: "概率论与数理统计", short: "概率", chapters: ll108Gailv },
      ],
    },
    {
      key: "xdf1000",
      tab: "新东方1000题",
      title: "新东方 1000题",
      group: "tiku",
      meta: "数学一 · 强化篇为主",
      note: "强化阶段穿插使用，按章记录完成度和正确率，和 1000 题错开刷。",
      icon: "book-open",
      tone: "cyan",
      unit: "题",
      total: 1000,
      phases: [],
      sections: [
        { name: "高等数学", short: "高数", chapters: xdf1000Gaoshu },
        { name: "线性代数", short: "线代", chapters: xdf1000Xiandai },
        { name: "概率论与数理统计", short: "概率", chapters: xdf1000Gailv },
      ],
    },
    {
      key: "wzx-yanti",
      tab: "武忠祥严选题",
      title: "武忠祥《高等数学严选题》",
      group: "tiku",
      meta: "高数专项 · 强化篇 · 严选题",
      note: "武老师的高数严选题按讲配套，题目偏综合；一讲一记，做不出来的先回讲义对应章节。",
      icon: "pencil-ruler",
      tone: "violet",
      unit: "题",
      total: 700,
      phases: [],
      sections: [
        { name: "高等数学", short: "高数", chapters: wzxYantiGaoshu },
      ],
    },
    {
      key: "wzx",
      tab: "武忠祥高数讲义",
      title: "武忠祥《高等数学辅导讲义》",
      group: "jiangyi",
      meta: "讲义 · 高等数学专题",
      note: "讲义要按讲记：听懂不算完成，独立做出例题才算。每讲记一次正确率。",
      icon: "notebook-text",
      tone: "blue",
      unit: "讲",
      total: 0,
      phases: [],
      sections: [
        {
          name: "高等数学",
          short: "高数",
          chapters: [
            "函数、极限、连续",
            "导数与微分",
            "微分中值定理及其应用",
            "不定积分",
            "定积分及其应用",
            "反常积分",
            "多元函数微分学",
            "二重积分",
            "微分方程",
            "无穷级数",
            "空间解析几何",
            "曲线积分与曲面积分",
            "场论初步",
          ],
        },
      ],
    },
    {
      key: "lyl-xiandai",
      tab: "李永乐线代讲义",
      title: "李永乐《线性代数辅导讲义》",
      group: "jiangyi",
      meta: "讲义 · 线性代数专题",
      note: "线代讲义一章一页笔记，按章记完成度；行列式、方程组、特征值是拿分重点。",
      icon: "notebook-text",
      tone: "amber",
      unit: "讲",
      total: 0,
      phases: [],
      sections: [
        {
          name: "线性代数",
          short: "线代",
          chapters: [
            "行列式",
            "矩阵",
            "向量",
            "线性方程组",
            "特征值与特征向量",
            "二次型",
            "线性空间与线性变换",
          ],
        },
      ],
    },
    {
      key: "wsa",
      tab: "王式安概率讲义",
      title: "王式安《概率论与数理统计辅导讲义》",
      group: "jiangyi",
      meta: "讲义 · 概率专题",
      note: "概率讲义按章推进，多维随机变量和参数估计两章单独用记录盯。",
      icon: "notebook-text",
      tone: "violet",
      unit: "讲",
      total: 0,
      phases: [],
      sections: [
        { name: "概率论与数理统计", short: "概率", chapters: probabilityChapters },
      ],
    },
    {
      key: "fanghao",
      tab: "方浩概率讲义",
      title: "方浩《概率论与数理统计》讲义",
      group: "jiangyi",
      meta: "讲义 · 概率 + 统计",
      note: "方浩的概率讲义偏方法和套路，按章记完成度，错题标清是概念还是计算。",
      icon: "notebook-text",
      tone: "cyan",
      unit: "讲",
      total: 0,
      phases: [],
      sections: [
        {
          name: "概率论",
          short: "概率",
          chapters: [
            "随机事件与概率",
            "一维随机变量及其分布",
            "多维随机变量及其分布",
            "随机变量的数字特征",
            "大数定律与中心极限定理",
          ],
        },
        {
          name: "数理统计",
          short: "统计",
          chapters: ["数理统计的基本概念", "参数估计", "假设检验"],
        },
      ],
    },
    {
      key: "jinbang",
      tab: "复习全书",
      title: "考研数学复习全书（数一）",
      group: "jiangyi",
      meta: "全书 · 基础篇 + 强化篇",
      note: "全书当主线：高数、线代、概率按篇按章推进，第一轮过概念，第二轮只做错题和例题。",
      icon: "book-marked",
      tone: "blue",
      unit: "节",
      total: 0,
      phases: ["基础篇", "强化篇"],
      sections: [
        { name: "高等数学", short: "高数", chapters: jinbangGaoshu },
        { name: "线性代数", short: "线代", chapters: jinbangXiandai },
        { name: "概率论与数理统计", short: "概率", chapters: jinbangGailv },
      ],
    },
    {
      key: "zy18",
      tab: "张宇高数18讲",
      title: "张宇《高等数学 18 讲》",
      group: "jiangyi",
      meta: "讲义 · 高等数学专题",
      note: "一讲一块硬骨头：先独立做例题，再对照讲义整理方法。每讲记一次完成度和正确率。",
      icon: "notebook-text",
      tone: "cyan",
      unit: "讲",
      total: 0,
      phases: [],
      sections: [
        { name: "高等数学", short: "高数", chapters: zy18Chapters },
      ],
    },
    {
      key: "zy30",
      tab: "张宇基础30讲",
      title: "张宇《基础 30 讲》",
      group: "jiangyi",
      meta: "讲义 · 基础篇 · 高等数学",
      note: "零基础入门用，一讲一讲过：先看讲，再独立做课后例题，每讲记一次完成度。",
      icon: "notebook-text",
      tone: "blue",
      unit: "讲",
      total: 0,
      phases: ["基础篇"],
      sections: [
        { name: "高等数学", short: "高数", chapters: zy30Jiang },
      ],
    },
    {
      key: "tang-jy",
      tab: "汤家凤高数讲义",
      title: "汤家凤《高等数学辅导讲义》",
      group: "jiangyi",
      meta: "讲义 · 高等数学专题",
      note: "汤老师的讲义按方法归章，适合零基础跟课；每章先过例题，再把课上例题重做一遍。",
      icon: "notebook-text",
      tone: "amber",
      unit: "讲",
      total: 0,
      phases: [],
      sections: [
        { name: "高等数学", short: "高数", chapters: tangChapters },
      ],
    },
    {
      key: "ll6",
      tab: "李林六套卷",
      title: "李林冲刺六套卷",
      group: "moni",
      meta: "模拟卷 · 数一 / 数二 / 数三",
      note: "冲刺期每周一套，严格计时；每套记总分、选填、解答题，错题当天标错因。",
      icon: "file-stack",
      tone: "blue",
      unit: "套",
      total: 0,
      phases: [],
      sections: monoPapers(6, "李林六套卷"),
    },
    {
      key: "ll4",
      tab: "李林四套卷",
      title: "李林考前四套卷",
      group: "moni",
      meta: "模拟卷 · 数一 / 数二 / 数三",
      note: "考前最后四周的模拟卷，按考试时间做，做完立刻复盘选择题和大题步骤。",
      icon: "file-stack",
      tone: "coral",
      unit: "套",
      total: 0,
      phases: [],
      sections: monoPapers(4, "李林四套卷"),
    },
    {
      key: "zy8",
      tab: "张宇八套卷",
      title: "张宇八套卷",
      group: "moni",
      meta: "模拟卷 · 数一 / 数二 / 数三",
      note: "难度偏高，用来练心态和计算；每套记分后重点整理错因，不追求分数好看。",
      icon: "file-stack",
      tone: "violet",
      unit: "套",
      total: 0,
      phases: [],
      sections: monoPapers(8, "张宇八套卷"),
    },
    {
      key: "zy4",
      tab: "张宇四套卷",
      title: "张宇考前四套卷",
      group: "moni",
      meta: "模拟卷 · 数一 / 数二 / 数三",
      note: "考前十天的保温卷，按套计时，复盘只做错题和模糊题，不刷新题。",
      icon: "file-stack",
      tone: "cyan",
      unit: "套",
      total: 0,
      phases: [],
      sections: monoPapers(4, "张宇四套卷"),
    },
    {
      key: "hg5",
      tab: "合工大超越五套卷",
      title: "合工大超越五套卷",
      group: "moni",
      meta: "模拟卷 · 数一 / 数二 / 数三",
      note: "计算量偏大的传统模拟卷，适合强化后期练速度；每套记用时和失分点。",
      icon: "file-stack",
      tone: "amber",
      unit: "套",
      total: 0,
      phases: [],
      sections: monoPapers(5, "合工大超越五套卷"),
    },
    {
      key: "zhenti",
      tab: "历年真题",
      title: "考研数学历年真题",
      group: "zhenti",
      kind: "zhenti",
      meta: "2016–2026 · 数一 / 数二 / 数三",
      note: "数一为主线，数二数三只刷考纲内公共部分。每套卷记总分、选填、解答题和错因。",
      icon: "file-stack",
      tone: "coral",
      unit: "套",
      total: 0,
      phases: [],
      papers: ["数学一", "数学二", "数学三"],
      years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
      sections: [],
    },
  ];

  const catalogMeta = {
    zy1000: ["基础强化 · 题集", "高数 / 线代 / 概率", "基础到强化"],
    tang1800: ["基础强化 · 题量大", "高数 / 线代 / 概率", "基础到强化"],
    lyl660: ["选填专项 · 基础", "高数 / 线代 / 概率", "基础"],
    lyl330: ["强化综合 · 小题", "高数 / 线代 / 概率", "强化"],
    ll880: ["基础强化 · 分层题", "高数 / 线代 / 概率", "基础到强化"],
    ll108: ["冲刺专项 · 大题", "高数 / 线代 / 概率", "强化到冲刺"],
    xdf1000: ["强化 · 综合训练", "高数 / 线代 / 概率", "强化"],
    "wzx-yanti": ["高数强化 · 严选题", "高等数学", "强化"],
    wzx: ["高数讲义 · 强化", "高等数学", "强化"],
    "lyl-xiandai": ["线代讲义 · 强化", "线性代数", "强化"],
    wsa: ["概率讲义 · 基础强化", "概率论与数理统计", "基础到强化"],
    fanghao: ["概率统计讲义 · 方法", "概率论与数理统计", "强化"],
    jinbang: ["全科全书 · 主线", "高数 / 线代 / 概率", "基础到强化"],
    zy18: ["高数专题 · 强化", "高等数学", "强化"],
    zy30: ["基础入门 · 高数", "高等数学", "基础"],
    "tang-jy": ["高数讲义 · 基础", "高等数学", "基础到强化"],
    ll6: ["冲刺模考 · 六套卷", "数一 / 数二 / 数三", "冲刺"],
    ll4: ["考前模考 · 四套卷", "数一 / 数二 / 数三", "考前"],
    zy8: ["拔高模考 · 八套卷", "数一 / 数二 / 数三", "强化后期"],
    zy4: ["考前保温 · 四套卷", "数一 / 数二 / 数三", "考前"],
    hg5: ["计算强化 · 五套卷", "数一 / 数二 / 数三", "强化后期"],
    zhenti: ["历年真题 · 成套卷", "数一 / 数二 / 数三", "冲刺复盘"],
  };

  for (const book of books) {
    const [category, focus, stage] = catalogMeta[book.key] || ["未分类", "数学", "通用"];
    book.category = book.category || category;
    book.focus = book.focus || focus;
    book.stage = book.stage || stage;
  }

  window.YANTU_MATH = { groups, books };
})();
