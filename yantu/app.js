const EXAM_DATE = new Date("2027-12-25T00:00:00+08:00");
const DAY_MS = 86400000;
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const daysLeft = Math.max(0, Math.ceil((EXAM_DATE - today) / DAY_MS));
const todayText = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
}).format(today);

const initialParams = new URLSearchParams(location.search);
const state = {
  screen: initialParams.get("screen") || "dashboard",
  subject: initialParams.get("subject") || "math",
  entryMode: initialParams.get("edit") === "1" ? "edit" : "create",
  mathResource: initialParams.get("math") || "1000",
  mathSection: 0,
  mathPhase: 0,
  mistakeBoard: initialParams.get("board") || "math",
};

const accentMap = {
  blue: ["var(--blue)", "var(--blue-soft)"],
  green: ["var(--green)", "var(--green-soft)"],
  amber: ["var(--amber)", "var(--amber-soft)"],
  red: ["var(--red)", "var(--red-soft)"],
  violet: ["var(--violet)", "var(--violet-soft)"],
  cyan: ["var(--cyan)", "#e6f7fa"],
};

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function progressBar(value, tone = "") {
  return `<div class="progress ${tone}"><span style="width:${Math.max(0, Math.min(100, value))}%"></span></div>`;
}

function kpiCard({ label, value, unit = "", sub = "", iconName = "activity", accent = "blue", delta = "", deltaDir = "up" }) {
  const [color, soft] = accentMap[accent] || accentMap.blue;
  const deltaHtml = delta
    ? `<span class="delta ${deltaDir === "down" ? "down" : ""}">${icon(deltaDir === "down" ? "arrow-down-right" : "arrow-up-right")}${delta}</span>`
    : "";
  return `
    <article class="card kpi" style="--accent:${color};--accent-soft:${soft}">
      <div class="kpi-head">
        <span>${label}</span>
        <span class="kpi-icon">${icon(iconName)}</span>
      </div>
      <div class="kpi-value">${value}<small>${unit}</small></div>
      <div class="kpi-sub">${sub}${deltaHtml}</div>
    </article>
  `;
}

function smoothPath(points) {
  return points
    .map((point, index) => {
      if (index === 0) return `M${point.x},${point.y}`;
      const previous = points[index - 1];
      const middle = (previous.x + point.x) / 2;
      return `C${middle},${previous.y} ${middle},${point.y} ${point.x},${point.y}`;
    })
    .join(" ");
}

function lineChart(labels, series) {
  const width = 760;
  const height = 260;
  const pad = { left: 36, right: 18, top: 18, bottom: 34 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (innerWidth / (labels.length - 1)) * index;
  const y = (value) => pad.top + innerHeight * (1 - value / 100);
  const grid = [0, 25, 50, 75, 100]
    .map(
      (value) => `
        <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"></line>
        <text class="axis-text" x="6" y="${y(value) + 3}">${value}%</text>
      `,
    )
    .join("");
  const xLabels = labels
    .map((label, index) => `<text class="axis-text" x="${x(index)}" y="${height - 8}" text-anchor="middle">${label}</text>`)
    .join("");
  const lines = series
    .map((item) => {
      const points = item.values.map((value, index) => ({ x: x(index), y: y(value) }));
      const last = points[points.length - 1];
      return `
        <path class="chart-line" d="${smoothPath(points)}" stroke="${item.color}"></path>
        <circle class="chart-dot" cx="${last.x}" cy="${last.y}" r="4" fill="${item.color}"></circle>
      `;
    })
    .join("");
  return `
    <div class="chart-wrap">
      <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="各科得分率趋势">
        ${grid}
        ${xLabels}
        ${lines}
      </svg>
    </div>
  `;
}

function barChart(labels, values) {
  return `
    <div class="bar-chart">
      ${values
        .map(
          (value, index) => `
            <div class="bar-col">
              <span class="bar-value">${value}%</span>
              <span class="bar" style="height:${value}%"></span>
              <span class="bar-label">${labels[index]}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function chartTicks(max) {
  const roughStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks = [];
  for (let value = 0; value < max; value += niceStep) ticks.push(Number(value.toFixed(1)));
  ticks.push(max);
  return ticks;
}

function stackedBarChart({ labels, series, max, target = 0, unit = "" }) {
  const width = 780;
  const height = 360;
  const pad = { left: 42, right: 26, top: 24, bottom: 42 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const band = innerWidth / labels.length;
  const barWidth = Math.min(44, band * 0.46);
  const y = (value) => pad.top + innerHeight * (1 - value / max);
  const gridValues = chartTicks(max);
  const grid = gridValues
    .map(
      (value) => `
        <line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"></line>
        <text class="axis-text" x="6" y="${y(value) + 3}">${value}</text>
      `,
    )
    .join("");
  const bars = labels
    .map((label, index) => {
      const x = pad.left + band * index + (band - barWidth) / 2;
      let cursor = 0;
      const segments = series
        .map((item) => {
          const value = item.values[index];
          const yTop = y(cursor + value);
          const segmentHeight = y(cursor) - yTop;
          cursor += value;
          return `<rect class="stack-segment" x="${x}" y="${yTop}" width="${barWidth}" height="${Math.max(0, segmentHeight)}" fill="${item.color}" rx="2"></rect>`;
        })
        .join("");
      const total = series.reduce((sum, item) => sum + item.values[index], 0);
      return `
        <g>
          ${segments}
          <text class="stack-total" x="${x + barWidth / 2}" y="${y(total) - 9}" text-anchor="middle">${total}${unit}</text>
          <text class="axis-text" x="${x + barWidth / 2}" y="${height - 12}" text-anchor="middle">${label}</text>
        </g>
      `;
    })
    .join("");
  const targetLine = target
    ? `
      <line class="target-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(target)}" y2="${y(target)}"></line>
      <text class="target-text" x="${width - pad.right}" y="${y(target) - 7}" text-anchor="end">目标 ${target}${unit}</text>
    `
    : "";
  return `
    <div class="chart-wrap">
      <svg class="stack-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="历年得分图">
        ${grid}
        ${targetLine}
        ${bars}
      </svg>
    </div>
  `;
}

function lossBarChart(items, totalLost) {
  const max = Math.max(...items.map((item) => item.value));
  return `
    <div class="loss-list">
      ${items
        .map(
          (item, index) => `
            <div class="loss-row ${index === 0 ? "top" : ""}">
              <div class="loss-head">
                <span class="loss-name">${item.label}</span>
                <span class="loss-value">-${item.value} 分</span>
              </div>
              <div class="loss-track">
                <span class="loss-bar" style="width:${(item.value / max) * 100}%;background:${item.color || "var(--red)"}"></span>
              </div>
              <div class="loss-meta">
                <span>${item.note}</span>
                <span>${Math.round((item.value / totalLost) * 100)}%</span>
              </div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function editAction(description = "") {
  return `<button class="row-action" type="button" data-edit-record="${description}" title="编辑这条记录" aria-label="编辑这条记录">${icon("pencil-line")}</button>`;
}

const SUMMARY_DATA = {
  math: {
    subtitle: "数学一为主线，数学二、数学三作为补充卷；分数按年份、卷种、模块和题号汇总，所有记录都能手动新增或修改。",
    segmented: ["数一", "数二", "数三"],
    segmentedActive: 0,
    chartNote: "堆叠显示每年高数、线代、概率的得分构成；虚线为 120 分目标线。",
    lossNote: "近 5 年累计失分按模块排序，红色越深代表失分越集中。",
    lossTip: "无穷级数、二重积分、多维随机变量是当前最值得优先补的三块。",
    kpis: [
      { label: "最近一次总分", value: "118", unit: "/150", sub: "2026 数一 · 得分率 79%", iconName: "file-check-2", accent: "blue", delta: "+9" },
      { label: "近 5 年平均", value: "113.6", unit: "/150", sub: "最高 124 · 最低 102", iconName: "trending-up", accent: "green", delta: "+4%" },
      { label: "累计失分", value: "182", unit: "分", sub: "近 5 年 · 无穷级数最多", iconName: "triangle-alert", accent: "red" },
      { label: "待复盘题目", value: "28", unit: "题", sub: "11 题一直不会 · 6 题今天到期", iconName: "notebook-tabs", accent: "amber" },
    ],
    chart: {
      labels: ["2022", "2023", "2024", "2025", "2026"],
      max: 150,
      target: 120,
      unit: "",
      series: [
        { name: "高等数学", color: "var(--blue)", values: [56, 64, 56, 68, 64] },
        { name: "线性代数", color: "var(--green)", values: [22, 25, 24, 27, 26] },
        { name: "概率统计", color: "var(--amber)", values: [24, 26, 29, 29, 28] },
      ],
    },
    loss: {
      total: 182,
      items: [
        { label: "高等数学 · 无穷级数", value: 32, note: "近 5 年 · 敛散性与幂级数", color: "#dc2626" },
        { label: "高等数学 · 二重积分", value: 28, note: "近 5 年 · 换序与极坐标", color: "#ef4444" },
        { label: "概率论 · 多维随机变量", value: 26, note: "近 5 年 · 联合分布与卷积", color: "#f87171" },
        { label: "线性代数 · 特征值与二次型", value: 24, note: "近 5 年 · 正定与相似对角化", color: "#fb923c" },
        { label: "概率论 · 大数定律与估计", value: 22, note: "近 5 年 · 区间估计", color: "#f59e0b" },
        { label: "高等数学 · 曲线曲面积分", value: 21, note: "近 5 年 · 数一专属", color: "#fbbf24" },
        { label: "其他零散失分", value: 29, note: "计算 / 审题 / 时间", color: "#fdba74" },
      ],
    },
    yearHead: ["年份 / 试卷", "总分", "高等数学", "线性代数", "概率统计", "选填", "解答题", "得分率", "状态"],
    yearRows: [
      ["2026 数一", "118/150", "64", "26", "28", "62/80", "56/70", "79%", ["待复盘", "amber"]],
      ["2025 数一", "124/150", "68", "27", "29", "68/80", "56/70", "83%", ["已复盘", "green"]],
      ["2024 数一", "109/150", "56", "24", "29", "58/80", "51/70", "73%", ["已复盘", "green"]],
      ["2023 数一", "115/150", "64", "25", "26", "64/80", "51/70", "77%", ["已复盘", "green"]],
      ["2022 数一", "102/150", "56", "22", "24", "56/80", "46/70", "68%", ["已复盘", "green"]],
    ],
    questionRows: [
      ["2026 数一", "第 12 题", "高数 · 多元函数微分", "4/10", "-6", "3 次", "一直不会", "今天"],
      ["2026 数一", "第 17 题", "高数 · 无穷级数", "2/10", "-8", "2 次", "需加强", "明天"],
      ["2025 数一", "第 19 题", "线代 · 特征值", "6/11", "-5", "2 次", "需加强", "09-30"],
      ["2024 数一", "第 20 题", "概率 · 多维随机变量", "5/11", "-6", "3 次", "一直不会", "今天"],
      ["2023 数一", "第 18 题", "高数 · 二重积分", "7/12", "-5", "1 次", "正常", "10-02"],
    ],
  },
  english: {
    subtitle: "英语一、英语二分开记录；阅读按年份和篇目、其余题型按模块与题号汇总，手动新增或修改后自动重算总分。",
    segmented: ["英语一", "英语二"],
    segmentedActive: 0,
    chartNote: "堆叠显示每年阅读、完形、新题型、翻译、写作的得分构成；虚线为 75 分目标线。",
    lossNote: "近 5 年英语一累计失分按模块排序，阅读 Part A 仍是最大失分来源。",
    lossTip: "先把阅读 Part A 稳定到 30+，再集中处理写作的逻辑与句式。",
    kpis: [
      { label: "最近一次总分", value: "68", unit: "/100", sub: "2026 英语一 · 阅读 26/40", iconName: "file-check-2", accent: "blue", delta: "+3" },
      { label: "近 5 年平均", value: "67.4", unit: "/100", sub: "最高 74 · 最低 61", iconName: "trending-up", accent: "green", delta: "+2%" },
      { label: "累计失分", value: "163", unit: "分", sub: "近 5 年 · 阅读 Part A 最多", iconName: "triangle-alert", accent: "red" },
      { label: "待复盘题目", value: "17", unit: "题", sub: "7 题一直不会 · 4 题今天到期", iconName: "notebook-tabs", accent: "amber" },
    ],
    chart: {
      labels: ["2022", "2023", "2024", "2025", "2026"],
      max: 100,
      target: 75,
      unit: "",
      series: [
        { name: "阅读 Part A", color: "var(--blue)", values: [26, 24, 28, 30, 26] },
        { name: "完形", color: "var(--green)", values: [7, 6, 6, 7, 7] },
        { name: "新题型", color: "var(--amber)", values: [7, 6, 7, 8, 7] },
        { name: "翻译", color: "var(--violet)", values: [6, 6, 6, 7, 7] },
        { name: "写作", color: "var(--cyan)", values: [20, 19, 21, 22, 21] },
      ],
    },
    loss: {
      total: 163,
      items: [
        { label: "阅读 Part A", value: 52, note: "近 5 年 · 推断与词义句意", color: "#dc2626" },
        { label: "写作", value: 38, note: "近 5 年 · 逻辑与句式", color: "#ef4444" },
        { label: "完形", value: 25, note: "近 5 年 · 逻辑衔接词", color: "#f87171" },
        { label: "翻译", value: 20, note: "近 5 年 · 长难句拆分", color: "#fb923c" },
        { label: "新题型", value: 18, note: "近 5 年 · 段落排序", color: "#f59e0b" },
        { label: "其他零散失分", value: 10, note: "涂卡 / 时间 / 拼写", color: "#fdba74" },
      ],
    },
    yearHead: ["年份 / 试卷", "总分", "阅读 Part A", "完形", "新题型", "翻译", "写作", "得分率", "状态"],
    yearRows: [
      ["2026 英语一", "68/100", "26/40", "7/10", "7/10", "7/10", "21/30", "68%", ["待复盘", "amber"]],
      ["2025 英语一", "74/100", "30/40", "7/10", "8/10", "7/10", "22/30", "74%", ["已复盘", "green"]],
      ["2024 英语一", "68/100", "28/40", "6/10", "7/10", "6/10", "21/30", "68%", ["已复盘", "green"]],
      ["2023 英语一", "61/100", "24/40", "6/10", "6/10", "6/10", "19/30", "61%", ["已复盘", "green"]],
      ["2022 英语一", "66/100", "26/40", "7/10", "7/10", "6/10", "20/30", "66%", ["已复盘", "green"]],
    ],
    questionRows: [
      ["2026 英语一", "Text 4 第 36 题", "阅读 · 词义句意", "0/2", "-2", "3 次", "一直不会", "今天"],
      ["2026 英语一", "Text 3 第 34 题", "阅读 · 推理判断", "0/2", "-2", "2 次", "需加强", "明天"],
      ["2025 英语一", "完形 第 12 题", "完形 · 逻辑衔接", "0/0.5", "-0.5", "2 次", "需加强", "09-30"],
      ["2024 英语一", "翻译 第 46 题", "翻译 · 定语从句", "1/2", "-1", "1 次", "正常", "10-02"],
      ["2023 英语一", "Text 2 第 27 题", "阅读 · 细节题", "0/2", "-2", "2 次", "需加强", "09-30"],
    ],
  },
  cs408: {
    subtitle: "王道四本书课后题与历年真题统一汇总；按年份、四门科目、选择题/大题和题号拆分，便于定位失分来源。",
    segmented: ["历年真题", "王道课后题"],
    segmentedActive: 0,
    chartNote: "堆叠显示每年四门科目的得分构成；虚线为 110 分目标线。",
    lossNote: "近 5 年累计失分按模块排序，组成原理的 Cache、虚存、流水线失分最集中。",
    lossTip: "优先复盘 Cache 地址映射、虚存页表计算和流水线冒险，再补 OS 内存管理。",
    kpis: [
      { label: "最近一次总分", value: "112", unit: "/150", sub: "2026 408 · 选择题 64/80", iconName: "file-check-2", accent: "blue", delta: "+4" },
      { label: "近 5 年平均", value: "103.6", unit: "/150", sub: "最高 112 · 最低 95", iconName: "trending-up", accent: "green", delta: "+3%" },
      { label: "累计失分", value: "232", unit: "分", sub: "近 5 年 · 组成原理最多", iconName: "triangle-alert", accent: "red" },
      { label: "待复盘题目", value: "23", unit: "题", sub: "9 题一直不会 · 5 题今天到期", iconName: "notebook-tabs", accent: "amber" },
    ],
    chart: {
      labels: ["2022", "2023", "2024", "2025", "2026"],
      max: 150,
      target: 110,
      unit: "",
      series: [
        { name: "数据结构", color: "var(--blue)", values: [30, 34, 32, 35, 36] },
        { name: "计算机组成原理", color: "var(--red)", values: [22, 24, 22, 26, 24] },
        { name: "操作系统", color: "var(--green)", values: [24, 26, 25, 26, 28] },
        { name: "计算机网络", color: "var(--amber)", values: [19, 20, 20, 21, 24] },
      ],
    },
    loss: {
      total: 232,
      items: [
        { label: "计算机组成原理", value: 68, note: "近 5 年 · Cache / 虚存 / 流水线", color: "#dc2626" },
        { label: "数据结构", value: 46, note: "近 5 年 · 图 / 树 / 排序", color: "#ef4444" },
        { label: "操作系统", value: 42, note: "近 5 年 · 内存 / 文件 / 同步", color: "#f87171" },
        { label: "计算机网络", value: 36, note: "近 5 年 · TCP / 路由", color: "#fb923c" },
        { label: "综合应用题", value: 24, note: "跨章节组合题", color: "#f59e0b" },
        { label: "其他零散失分", value: 16, note: "审题 / 计算 / 时间", color: "#fdba74" },
      ],
    },
    yearHead: ["年份 / 试卷", "总分", "数据结构", "组成原理", "操作系统", "计算机网络", "选择题", "大题", "得分率", "状态"],
    yearRows: [
      ["2026 408", "112/150", "36", "24", "28", "24", "64/80", "48/70", "75%", ["待复盘", "amber"]],
      ["2025 408", "108/150", "35", "26", "26", "21", "62/80", "46/70", "72%", ["已复盘", "green"]],
      ["2024 408", "99/150", "32", "22", "25", "20", "58/80", "41/70", "66%", ["已复盘", "green"]],
      ["2023 408", "104/150", "34", "24", "26", "20", "60/80", "44/70", "69%", ["已复盘", "green"]],
      ["2022 408", "95/150", "30", "22", "24", "19", "56/80", "39/70", "63%", ["已复盘", "green"]],
    ],
    questionRows: [
      ["2026 408", "第 43 题", "组成原理 · Cache", "4/10", "-6", "3 次", "一直不会", "今天"],
      ["2026 408", "第 45 题", "操作系统 · 内存管理", "6/10", "-4", "2 次", "需加强", "明天"],
      ["2025 408", "第 41 题", "数据结构 · 图", "8/10", "-2", "1 次", "正常", "10-01"],
      ["2025 408", "第 47 题", "计算机网络 · TCP", "6/10", "-4", "2 次", "需加强", "09-30"],
      ["2024 408", "第 44 题", "组成原理 · 指令系统", "5/10", "-5", "2 次", "需加强", "10-02"],
    ],
  },
};

function renderSummary() {
  const data = SUMMARY_DATA[state.subject] || SUMMARY_DATA.math;
  const latestIndex = data.chart.labels.length - 1;
  const latestYear = data.chart.labels[latestIndex];
  const latestTotal = data.chart.series.reduce((sum, item) => sum + item.values[latestIndex], 0);
  return `
    <div class="page-head">
      <div>
        <h1>成绩汇总</h1>
        <p class="page-desc">${data.subtitle}</p>
      </div>
      <div class="head-actions">
        <div class="segmented">
          <button class="${state.subject === "math" ? "active" : ""}" data-subject="math">数学一 / 二 / 三</button>
          <button class="${state.subject === "english" ? "active" : ""}" data-subject="english">英语一 / 二</button>
          <button class="${state.subject === "cs408" ? "active" : ""}" data-subject="cs408">408</button>
        </div>
        <button class="primary-btn" type="button" data-open-entry="create" aria-label="手动新增成绩">${icon("plus")}<span class="btn-label">手动新增成绩</span></button>
      </div>
    </div>

    <div class="filter-row">
      <button class="filter-chip active">全部年份</button>
      ${data.chart.labels.map((label) => `<button class="filter-chip">${label}</button>`).join("")}
      <span class="filter-sep"></span>
      ${data.segmented
        .map((label, index) => `<button class="filter-chip ${index === data.segmentedActive ? "active" : ""}">${label}</button>`)
        .join("")}
      <button class="filter-chip">只看错题</button>
    </div>

    <div class="kpi-grid">
      ${data.kpis.map((item) => kpiCard(item)).join("")}
    </div>

    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">得分图 · 历年模块得分构成</h2>
            <p class="card-note">${data.chartNote}</p>
          </div>
          <div class="tabs">
            ${data.segmented
              .map((label, index) => `<button class="${index === data.segmentedActive ? "active" : ""}">${label}</button>`)
              .join("")}
          </div>
        </div>
        <div class="legend">
          ${data.chart.series.map((item) => `<span><i style="background:${item.color}"></i>${item.name}</span>`).join("")}
        </div>
        ${stackedBarChart(data.chart)}
        <div class="chart-foot">
          <div class="chart-foot-top">
            <span>${latestYear} 年得分构成</span>
            <strong>合计 ${latestTotal}/${data.chart.max}</strong>
          </div>
          <div class="chart-foot-list">
            ${data.chart.series
              .map(
                (item) => `
                  <span class="chart-foot-item">
                    <i style="background:${item.color}"></i>
                    <span>${item.name}</span>
                    <strong>${item.values[latestIndex]}</strong>
                  </span>
                `,
              )
              .join("")}
          </div>
        </div>
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">失分模块图</h2>
            <p class="card-note">${data.lossNote}</p>
          </div>
          <span class="tag red">累计失分 ${data.loss.total}</span>
        </div>
        ${lossBarChart(data.loss.items, data.loss.total)}
        <div class="mini-note">${icon("crosshair")} ${data.lossTip}</div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">年度总分汇总</h2>
            <p class="card-note">每一年的总分、模块分、用时和状态都能手动修改。</p>
          </div>
          <div class="head-actions">
            <button class="secondary-btn">${icon("filter")} 筛选</button>
            <button class="secondary-btn">${icon("download")} 导出</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>${data.yearHead.map((head) => `<th>${head}</th>`).join("")}<th>操作</th></tr>
            </thead>
            <tbody>
              ${data.yearRows
                .map(
                  (row) => `
                    <tr>
                      ${row
                        .map((cell, index) => {
                          if (index === row.length - 1) {
                            const [text, tone] = cell;
                            return `<td><span class="tag ${tone}">${text}</span></td>`;
                          }
                          if (index === 0) return `<td><span class="year-cell">${cell}</span></td>`;
                          if (index === 1) return `<td class="score">${cell}</td>`;
                          return `<td>${cell}</td>`;
                        })
                        .join("")}
                      <td>${editAction(row[0])}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">逐题错题汇总</h2>
            <p class="card-note">定位到年份、题号、考点、失分与复盘状态；支持逐题补录和修改。</p>
          </div>
          <div class="tabs">
            <button class="active">全部</button>
            <button>一直不会</button>
            <button>计算错误</button>
            <button>概念不清</button>
            <button>审题错误</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>年份 / 试卷</th><th>题号</th><th>模块 / 考点</th><th>得分</th><th>失分</th><th>出错次数</th><th>状态</th><th>下次复盘</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${data.questionRows
                .map(
                  ([year, question, module, score, lost, times, status, review]) => `
                    <tr>
                      <td>${year}</td>
                      <td><span class="question-no">${question}</span></td>
                      <td>${module}</td>
                      <td class="score">${score}</td>
                      <td class="lost-cell">${lost}</td>
                      <td>${times}</td>
                      <td><span class="tag ${status === "一直不会" ? "red" : status === "需加强" ? "amber" : "green"}">${status}</span></td>
                      <td>${review}</td>
                      <td>${editAction(`${year} ${question}`)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function heatmap() {
  const cells = Array.from({ length: 84 }, (_, index) => {
    const signal = (Math.sin(index * 1.41) + Math.cos(index * 0.37) + 2) / 4;
    const level = signal > 0.78 ? 4 : signal > 0.57 ? 3 : signal > 0.37 ? 2 : signal > 0.2 ? 1 : 0;
    return `<span class="heat-cell l${level}" title="学习强度 ${Math.round(signal * 100)}%"></span>`;
  }).join("");
  return `<div class="heatmap">${cells}</div>`;
}

function reviewItem(index, title, meta, tone = "red") {
  return `
    <div class="review-item">
      <div class="review-index" style="color:var(--${tone});background:var(--${tone}-soft)">${index}</div>
      <div>
        <p class="review-title">${title}</p>
        <p class="review-meta">${meta}</p>
      </div>
      <button class="review-action" aria-label="查看">${icon("arrow-up-right")}</button>
    </div>
  `;
}

function taskItem(title, meta, done = false) {
  return `
    <div class="task ${done ? "done" : ""}">
      <span class="task-check">${icon(done ? "check" : "circle")}</span>
      <div class="task-body">
        <p class="task-title">${title}</p>
        <p class="task-meta">${meta}</p>
      </div>
      <span class="task-time">${done ? "完成" : "待做"}</span>
    </div>
  `;
}

function planItem(title, meta, priority = "中", tone = "amber") {
  return `
    <div class="plan-item">
      <span class="plan-priority tag ${tone}">${priority}</span>
      <div>
        <p class="plan-title">${title}</p>
        <p class="plan-meta">${meta}</p>
      </div>
      ${icon("chevron-right")}
    </div>
  `;
}

function renderDashboard() {
  return `
    <div class="page-head">
      <div>
        <h1>2028 中科大计算机专硕 · 备考总览</h1>
        <p class="page-desc">${todayText} · 目标总分 390/500（示例，可修改） · 政治模块默认关闭，需要时可在设置中开启</p>
      </div>
      <div class="head-actions">
        <span class="tag green">${icon("cloud-check")} 已同步 · 21:36</span>
        <button class="secondary-btn">${icon("settings-2")} 目标设置</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({
        label: "距 2028 初试",
        value: daysLeft,
        unit: "天",
        sub: "预计 2027-12-25 · 可修改",
        iconName: "timer",
        accent: "red",
      })}
      ${kpiCard({
        label: "今日进度",
        value: "5/8",
        unit: "项",
        sub: "学习 4h 12m · 阅读 2 篇 · 数学 36 题",
        iconName: "list-checks",
        accent: "blue",
        delta: "+38m",
      })}
      ${kpiCard({
        label: "本周完成",
        value: "38/52",
        unit: "项",
        sub: "完成率 73% · 距周目标还差 14 项",
        iconName: "calendar-check-2",
        accent: "green",
        delta: "+9%",
      })}
      ${kpiCard({
        label: "三科当前总分",
        value: "302",
        unit: "/400",
        sub: "英语 68 · 数学 122 · 408 112",
        iconName: "chart-no-axes-column-increasing",
        accent: "violet",
        delta: "+8",
      })}
    </div>

    <div class="grid">
      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">今日进度</h2>
            <p class="card-note">按科目拆到最小任务，完成后自动累计进度。</p>
          </div>
          <span class="tag blue">${icon("flame")} 连续 18 天</span>
        </div>
        <div class="ring-layout">
          <div class="ring" style="--p:63">
            <div class="ring-center">
              <strong>63%</strong>
              <span>今日完成</span>
            </div>
          </div>
          <div class="task-list">
            ${taskItem("英语阅读 Part A · 2018 Text 3", "精读 + 长难句 6 句 · 42 分钟", true)}
            ${taskItem("数学 1000题 · 第 8 章", "20 题 · 正确 14 题 · 70%", true)}
            ${taskItem("408 王道 · Cache 课后题", "18 题 · 正确 13 题 · 72%", true)}
            ${taskItem("错题复盘 · 一直不会的题", "6 题 · 预计 30 分钟", false)}
          </div>
        </div>
        <div class="mini-note">${icon("sparkles")} 晚上 20:30 自动生成明日计划草稿。</div>
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">明日计划</h2>
            <p class="card-note">2026-09-28 · 周一 · 已排 6h 20m</p>
          </div>
          <button class="icon-btn" aria-label="调整">${icon("sliders-horizontal")}</button>
        </div>
        <div class="plan-list">
          ${planItem("数学 1000题 · 第 9 章", "08:30–10:00 · 20 题 + 错题标记", "重点", "red")}
          ${planItem("408 组成原理 · Cache / 虚存", "10:15–11:45 · 王道课后题 20 题", "重点", "amber")}
          ${planItem("英语一 · 2019 Text 2 精读", "14:00–15:30 · 逐句 + 生词 18 个", "常规", "blue")}
          ${planItem("复盘 660 · 第 3 章", "16:00–17:00 · 12 道错题", "复盘", "green")}
        </div>
      </section>

      <section class="card card-pad span-3">
        <div class="card-head">
          <div>
            <h2 class="card-title">推荐计划</h2>
            <p class="card-note">根据近 14 天正确率与遗忘曲线生成。</p>
          </div>
          ${icon("wand-sparkles")}
        </div>
        <div class="recommend-stack">
          <div class="recommend-item">
            <span class="tag red">最高优先</span>
            <p>组成原理 Cache + 虚存</p>
            <span>正确率 48% · 建议 20 题</span>
          </div>
          <div class="recommend-item">
            <span class="tag amber">本周补齐</span>
            <p>数学无穷级数</p>
            <span>章节进度 49% · 建议 15 题</span>
          </div>
          <div class="recommend-item">
            <span class="tag blue">保持手感</span>
            <p>英语 2019 Text 1</p>
            <span>阅读正确率 55% · 建议精读</span>
          </div>
        </div>
        <button class="secondary-btn full-btn">${icon("calendar-plus")} 写入明日计划</button>
      </section>

      <section class="card card-pad span-8">
        <div class="card-head">
          <div>
            <h2 class="card-title">各科得分率趋势</h2>
            <p class="card-note">按每次真题、套卷或章节汇总后的得分率归一化。</p>
          </div>
          <div class="tabs">
            <button>近 30 天</button>
            <button class="active">近 90 天</button>
            <button>全部</button>
          </div>
        </div>
        <div class="legend">
          <span><i style="background:var(--blue)"></i>数学一</span>
          <span><i style="background:var(--green)"></i>英语一</span>
          <span><i style="background:var(--amber)"></i>408</span>
        </div>
        ${lineChart(
          ["7/1", "7/15", "8/1", "8/15", "9/1", "9/15", "9/27"],
          [
            { name: "数学一", color: "var(--blue)", values: [72, 75, 74, 79, 81, 80, 82] },
            { name: "英语一", color: "var(--green)", values: [58, 60, 63, 62, 66, 67, 68] },
            { name: "408", color: "var(--amber)", values: [61, 63, 66, 69, 72, 74, 75] },
          ],
        )}
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">本周节奏</h2>
            <p class="card-note">计划完成度与每日主攻方向。</p>
          </div>
          <span class="tag green">状态良好</span>
        </div>
        <div class="week-strip">
          ${[
            ["一", "数学 1000题", 100, "完成"],
            ["二", "408 组成原理", 100, "完成"],
            ["三", "英语真题", 100, "完成"],
            ["四", "660 错题", 100, "完成"],
            ["五", "王道 OS", 60, "进行中"],
            ["六", "数学模拟卷", 0, "未开始"],
            ["日", "周复盘 + 计划", 0, "未开始"],
          ]
            .map(
              ([day, focus, value, status]) => `
                <div class="day-card">
                  <div class="day-top"><strong>${day}</strong><span>${status}</span></div>
                  <p>${focus}</p>
                  ${progressBar(value, value === 100 ? "green" : value > 0 ? "blue" : "")}
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">模块掌握度</h2>
            <p class="card-note">正确率低于 60% 的模块会自动进入推荐计划。</p>
          </div>
          <button class="ghost-btn">查看全部 ${icon("arrow-right")}</button>
        </div>
        <div class="data-list">
          ${[
            ["英语 · 阅读 Part A", 76, "green", "76%"],
            ["数学 · 高等数学", 61, "amber", "61%"],
            ["数学 · 线性代数", 76, "green", "76%"],
            ["数学 · 概率论", 69, "blue", "69%"],
            ["408 · 数据结构", 78, "green", "78%"],
            ["408 · 计算机组成原理", 48, "red", "48%"],
            ["408 · 操作系统", 69, "blue", "69%"],
            ["408 · 计算机网络", 74, "green", "74%"],
          ]
            .map(
              ([label, value, tone, text]) => `
                <div class="data-row">
                  <span class="label">${label}</span>
                  ${progressBar(value, tone)}
                  <span class="value">${text}</span>
                  <span class="status tag ${tone === "red" ? "red" : tone === "amber" ? "amber" : tone === "green" ? "green" : "blue"}">${value < 60 ? "需补强" : value < 70 ? "跟进" : "稳定"}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">优先复盘</h2>
            <p class="card-note">错误次数多、间隔到期或标记“一直不会”的题。</p>
          </div>
          <span class="tag red">31 题待复盘</span>
        </div>
        <div class="review-list">
          ${reviewItem("01", "数学 · 多元函数微分学 · 第 12 题", "1000题 · 错 3 次 · 今天到期", "red")}
          ${reviewItem("02", "408 · Cache 映射与地址计算", "王道组成原理 · 错 2 次 · 3 天未复盘", "red")}
          ${reviewItem("03", "数学 · 无穷级数敛散性判断", "660 · 错 2 次 · 明天到期", "amber")}
          ${reviewItem("04", "英语 · 2019 Text 1 推理题", "英语一 · 错 2 次 · 待精读", "blue")}
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">学习活跃度</h2>
            <p class="card-note">最近 12 周 · 颜色越深代表当日有效学习时间越长。</p>
          </div>
          <div class="heat-legend">少 <i></i><i></i><i></i><i></i> 多</div>
        </div>
        ${heatmap()}
      </section>
    </div>
  `;
}

function renderEnglish() {
  return `
    <div class="page-head">
      <div>
        <h1>英语一 / 英语二</h1>
        <p class="page-desc">默认按英语一显示；可以随时切换到英语二，两个科目的记录相互独立。</p>
      </div>
      <div class="head-actions">
        <div class="segmented">
          <button class="active">英语一</button>
          <button>英语二</button>
        </div>
        <button class="primary-btn">${icon("plus")} 录入英语成绩</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({ label: "阅读 Part A 正确率", value: "76", unit: "%", sub: "近 10 年真题 · 24/32 题", iconName: "book-open-check", accent: "green", delta: "+4%" })}
      ${kpiCard({ label: "完形正确率", value: "63", unit: "%", sub: "近 5 年 · 12.6/20 题", iconName: "scan-text", accent: "amber", delta: "+2%" })}
      ${kpiCard({ label: "新题型正确率", value: "68", unit: "%", sub: "近 5 年 · 3.4/5 题", iconName: "list-tree", accent: "blue", delta: "+3%" })}
      ${kpiCard({ label: "最近一次真题", value: "68", unit: "/100", sub: "2026 英语一 · 阅读错 8 题", iconName: "file-check-2", accent: "violet", delta: "+6" })}
    </div>

    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">阅读 Part A 历年正确率</h2>
            <p class="card-note">2018–2026 年英语一真题，按四篇阅读合计。</p>
          </div>
          <div class="tabs">
            <button class="active">正确率</button>
            <button>错题数</button>
          </div>
        </div>
        ${barChart(["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"], [56, 62, 60, 68, 70, 66, 74, 72, 76])}
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">各题型得分</h2>
            <p class="card-note">按满分折算为得分率，写作仍在积累样本。</p>
          </div>
        </div>
        <div class="data-list">
          ${[
            ["阅读 Part A", 76, "green", "76%"],
            ["阅读 Part B", 68, "blue", "68%"],
            ["完形", 63, "amber", "63%"],
            ["翻译", 71, "blue", "71%"],
            ["小作文", 72, "green", "72%"],
            ["大作文", 65, "amber", "65%"],
          ]
            .map(
              ([label, value, tone, text]) => `
                <div class="data-row">
                  <span class="label">${label}</span>
                  ${progressBar(value, tone)}
                  <span class="value">${text}</span>
                  <span class="status">${value < 65 ? "加练" : "稳定"}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-8">
        <div class="card-head">
          <div>
            <h2 class="card-title">阅读分篇记录</h2>
            <p class="card-note">按年份和 Text 拆开，便于定位推断题、态度题或词义题的弱点。</p>
          </div>
          <button class="ghost-btn">全部记录 ${icon("arrow-right")}</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>年份 / 篇目</th><th>得分</th><th>正确率</th><th>用时</th><th>薄弱题型</th><th>日期</th></tr>
            </thead>
            <tbody>
              <tr><td>2026 · Text 1</td><td class="score good">8/10</td><td>80%</td><td>17 分钟</td><td>推断题</td><td>09-26</td></tr>
              <tr><td>2026 · Text 2</td><td class="score good">8/10</td><td>80%</td><td>18 分钟</td><td>细节题</td><td>09-26</td></tr>
              <tr><td>2026 · Text 3</td><td class="score warn">6/10</td><td>60%</td><td>21 分钟</td><td>推理题 / 态度题</td><td>09-25</td></tr>
              <tr><td>2026 · Text 4</td><td class="score bad">4/10</td><td>40%</td><td>24 分钟</td><td>词义句意题</td><td>09-25</td></tr>
              <tr><td>2025 · Text 1</td><td class="score good">8/10</td><td>80%</td><td>16 分钟</td><td>细节题</td><td>09-22</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">写作与翻译</h2>
            <p class="card-note">记录分数、批改意见和下一篇改进点。</p>
          </div>
          <button class="icon-btn" aria-label="新增">${icon("plus")}</button>
        </div>
        <div class="review-list">
          ${reviewItem("小", "小作文 · 建议信", "2026-09-24 · 7.2/10 · 格式正确", "green")}
          ${reviewItem("大", "大作文 · 图画作文", "2026-09-21 · 13/20 · 逻辑衔接需加强", "amber")}
          ${reviewItem("译", "翻译 · 2024 英语一", "2026-09-18 · 7.5/10 · 定语从句处理慢", "blue")}
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">最近英语记录</h2>
            <p class="card-note">每次录入自动更新阅读、各模块和总分。</p>
          </div>
          <button class="secondary-btn">${icon("download")} 导出 CSV</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>日期</th><th>科目</th><th>试卷 / 来源</th><th>模块</th><th>得分</th><th>正确率</th><th>用时</th><th>备注</th></tr>
            </thead>
            <tbody>
              <tr><td>2026-09-26</td><td>英语一</td><td>2026 真题</td><td>阅读 Part A</td><td class="score">26/40</td><td>65%</td><td>80 分钟</td><td>Text 4 词义题错 3 题</td></tr>
              <tr><td>2026-09-25</td><td>英语一</td><td>2025 真题</td><td>完形</td><td class="score">13/20</td><td>65%</td><td>18 分钟</td><td>逻辑衔接词仍不稳</td></tr>
              <tr><td>2026-09-24</td><td>英语一</td><td>写作练习</td><td>小作文</td><td class="score">7.2/10</td><td>72%</td><td>25 分钟</td><td>格式正确，句式单一</td></tr>
              <tr><td>2026-09-22</td><td>英语一</td><td>2025 真题</td><td>阅读 Part A</td><td class="score">30/40</td><td>75%</td><td>72 分钟</td><td>细节题稳定</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

const MATH_RESOURCE_ORDER = ["1000", "660", "880", "xdf", "jinbang", "fanghao", "zhenti"];

const MATH_RESOURCES = {
  "1000": {
    key: "1000",
    tab: "1000题",
    title: "张宇 1000题",
    meta: "2027版 · 数学一 · 基础篇 + 强化篇",
    note: "基础篇打底、强化篇拔高。每章同时统计完成度与正确率，做错的题可以直接标注错因和复盘安排。",
    icon: "book-open",
    tone: "blue",
    phases: ["基础篇", "强化篇"],
    bannerValue: "612",
    bannerUnit: "/1000 题",
    bannerPercent: 61,
    bannerFoot: ["正确率 63%", "本周 +96 题"],
    total: 1000,
    accuracy: 63,
    wrong: 28,
    never: 11,
    weekDone: 96,
    sections: [
      {
        name: "高等数学",
        short: "高数",
        done: 342,
        total: 560,
        accuracy: 61,
        chapters: [
          ["函数、极限、连续", 96, 74, 88, 71, 0],
          ["数列极限", 94, 66, 82, 63, 1],
          ["导数与微分", 91, 70, 85, 68, 1],
          ["中值定理及应用", 88, 62, 79, 58, 2],
          ["一元微分学应用", 90, 68, 83, 66, 1],
          ["不定积分", 93, 75, 86, 70, 1],
          ["定积分及应用", 89, 69, 81, 64, 2],
          ["反常积分", 86, 61, 78, 57, 2],
          ["多元函数微分学", 84, 65, 76, 59, 3],
          ["二重积分", 82, 58, 73, 54, 3],
          ["三重积分", 76, 52, 70, 49, 2],
          ["曲线积分", 72, 48, 68, 46, 2],
          ["曲面积分", 70, 44, 65, 42, 3],
          ["微分方程", 85, 71, 80, 67, 1],
          ["无穷级数", 79, 49, 72, 45, 4],
          ["空间解析几何", 80, 55, 74, 52, 1],
          ["场论初步", 68, 41, 64, 40, 2],
          ["综合应用", 74, 46, 69, 43, 2],
        ],
      },
      {
        name: "线性代数",
        short: "线代",
        done: 158,
        total: 240,
        accuracy: 67,
        chapters: [
          ["行列式", 92, 78, 86, 74, 1],
          ["矩阵", 90, 76, 84, 72, 1],
          ["向量", 88, 70, 81, 66, 2],
          ["线性方程组", 86, 68, 79, 63, 2],
          ["特征值与特征向量", 83, 65, 76, 61, 2],
          ["二次型", 80, 61, 72, 57, 3],
          ["线性空间", 74, 50, 68, 48, 2],
          ["矩阵相似与合同", 78, 58, 71, 54, 2],
          ["综合应用", 76, 54, 70, 51, 2],
        ],
      },
      {
        name: "概率论与数理统计",
        short: "概率",
        done: 112,
        total: 200,
        accuracy: 58,
        chapters: [
          ["随机事件与概率", 90, 76, 84, 72, 1],
          ["一维随机变量", 88, 70, 80, 66, 2],
          ["多维随机变量", 82, 57, 74, 53, 3],
          ["随机变量数字特征", 84, 63, 77, 59, 2],
          ["大数定律与中心极限定理", 78, 52, 71, 49, 3],
          ["数理统计基本概念", 76, 55, 70, 51, 2],
          ["参数估计", 74, 53, 68, 50, 3],
          ["假设检验", 70, 47, 65, 44, 3],
          ["综合应用", 72, 49, 67, 46, 2],
        ],
      },
    ],
    records: [
      {
        date: "2026-09-27",
        part: "强化篇",
        chapter: "多元函数微分学",
        score: "28/40",
        rate: 70,
        time: "52 分钟",
        marks: [["概念不清", "red"], ["一直不会", "red"]],
        ann: {
          title: "1000题 · 强化篇 第 12 章 14 题",
          sub: "多元函数微分学 · 错误 3 次 · 高优先",
          types: ["概念不清", "方法不会"],
          status: "一直不会",
          next: "今天",
          note: "换序前先画积分区域；参数为 0 时漏讨论，下次先写区域再动笔。",
        },
      },
      {
        date: "2026-09-26",
        part: "强化篇",
        chapter: "二重积分",
        score: "31/45",
        rate: 69,
        time: "58 分钟",
        marks: [["计算错误", "amber"], ["需加强", "amber"]],
        ann: {
          title: "1000题 · 强化篇 第 10 章 22 题",
          sub: "二重积分 · 错误 2 次",
          types: ["计算错误"],
          status: "需加强",
          next: "3 天后",
          note: "换元后雅可比行列式漏乘，做完用极坐标结果回代检查。",
        },
      },
      {
        date: "2026-09-24",
        part: "基础篇",
        chapter: "无穷级数",
        score: "22/35",
        rate: 63,
        time: "46 分钟",
        marks: [["概念不清", "red"]],
        ann: {
          title: "1000题 · 基础篇 第 15 章 8 题",
          sub: "无穷级数 · 错误 2 次",
          types: ["概念不清", "方法不会"],
          status: "需加强",
          next: "1 天后",
          note: "比值判别法失效时不会换根值法，先背清三种判别法的适用条件。",
        },
      },
      {
        date: "2026-09-22",
        part: "基础篇",
        chapter: "线性方程组",
        score: "26/30",
        rate: 87,
        time: "38 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "1000题 · 基础篇 线代第 4 章 12 题",
          sub: "线性方程组 · 已复盘",
          types: [],
          status: "已消灭",
          next: "7 天后",
          note: "同解变形时忽略秩的讨论；复盘后已能独立完成同类题。",
        },
      },
    ],
    neverItems: [
      { index: "01", title: "二重积分换序 · 1000题 第 12 章 14 题", meta: "错误 3 次 · 今天到期 · 高优先", tone: "red" },
      { index: "02", title: "曲面积分投影 · 1000题 第 13 章 6 题", meta: "错误 3 次 · 明天到期", tone: "red" },
      { index: "03", title: "多维随机变量 · 1000题 第 18 章 9 题", meta: "错误 2 次 · 3 天后", tone: "amber" },
      { index: "04", title: "无穷级数敛散性 · 1000题 第 15 章 8 题", meta: "错误 2 次 · 已安排", tone: "amber" },
    ],
  },
  "660": {
    key: "660",
    tab: "660",
    title: "李永乐 660题",
    meta: "数学基础过关 · 数一 · 选择题 + 填空题",
    note: "以选填题为主，按章节记录正确率；没做出、算错、审题错的题分别标注，避免都当成“粗心”。",
    icon: "pencil-ruler",
    tone: "green",
    phases: [],
    bannerValue: "388",
    bannerUnit: "/660 题",
    bannerPercent: 59,
    bannerFoot: ["正确率 71%", "本周 +48 题"],
    total: 660,
    accuracy: 71,
    wrong: 12,
    never: 3,
    weekDone: 48,
    sections: [
      {
        name: "高等数学",
        short: "高数",
        done: 248,
        total: 420,
        accuracy: 69,
        chapters: [
          ["函数、极限、连续", 78, 72, 2],
          ["导数与微分", 74, 69, 2],
          ["中值定理及应用", 70, 64, 3],
          ["一元函数积分学", 70, 66, 3],
          ["多元函数微分学", 62, 61, 2],
          ["二重积分", 58, 57, 3],
          ["微分方程", 66, 64, 1],
          ["无穷级数", 48, 49, 4],
          ["向量代数", 55, 58, 1],
          ["空间解析几何", 54, 56, 1],
          ["曲线曲面积分", 50, 52, 3],
          ["综合应用", 60, 59, 2],
        ],
      },
      {
        name: "线性代数",
        short: "线代",
        done: 88,
        total: 140,
        accuracy: 74,
        chapters: [
          ["行列式", 82, 78, 1],
          ["矩阵", 80, 75, 1],
          ["向量", 76, 70, 1],
          ["线性方程组", 72, 68, 2],
          ["特征值与特征向量", 70, 64, 2],
          ["二次型", 64, 59, 3],
          ["相似与合同", 66, 60, 2],
          ["综合应用", 62, 58, 2],
        ],
      },
      {
        name: "概率论与数理统计",
        short: "概率",
        done: 52,
        total: 100,
        accuracy: 66,
        chapters: [
          ["随机事件与概率", 80, 76, 1],
          ["一维随机变量", 74, 70, 2],
          ["多维随机变量", 60, 55, 3],
          ["随机变量数字特征", 68, 63, 2],
          ["大数定律与中心极限定理", 54, 50, 2],
          ["数理统计基本概念", 58, 53, 2],
          ["参数估计", 56, 52, 3],
        ],
      },
    ],
    records: [
      {
        date: "2026-09-26",
        part: "选择题",
        chapter: "无穷级数",
        score: "18/30",
        rate: 60,
        time: "48 分钟",
        marks: [["计算错误", "amber"]],
        ann: {
          title: "660 · 第 8 章 21 题",
          sub: "无穷级数敛散性 · 错误 2 次",
          types: ["计算错误", "概念不清"],
          status: "需加强",
          next: "3 天后",
          note: "比值判别法极限算错；把 p 级数与几何级数的结论再默一遍。",
        },
      },
      {
        date: "2026-09-23",
        part: "填空题",
        chapter: "特征值与特征向量",
        score: "16/20",
        rate: 80,
        time: "26 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "660 · 线代第 5 章 14 题",
          sub: "特征值与特征向量 · 已复盘",
          types: ["计算错误"],
          status: "已消灭",
          next: "7 天后",
          note: "特征向量归一化时符号写反；复盘后同类题两次全对。",
        },
      },
      {
        date: "2026-09-20",
        part: "选择题",
        chapter: "二重积分",
        score: "15/25",
        rate: 60,
        time: "35 分钟",
        marks: [["概念不清", "red"]],
        ann: {
          title: "660 · 第 6 章 9 题",
          sub: "二重积分 · 错误 2 次",
          types: ["概念不清"],
          status: "需加强",
          next: "1 天后",
          note: "积分次序与区域可加性混淆，画图后再选次序。",
        },
      },
      {
        date: "2026-09-18",
        part: "填空题",
        chapter: "多维随机变量",
        score: "14/20",
        rate: 70,
        time: "24 分钟",
        marks: [["时间不足", "violet"]],
        ann: {
          title: "660 · 概率第 3 章 11 题",
          sub: "多维随机变量 · 错误 1 次",
          types: ["时间不足"],
          status: "正常",
          next: "3 天后",
          note: "联合分布积分区域画太慢；限时 15 分钟重做同章 10 题。",
        },
      },
    ],
    neverItems: [
      { index: "01", title: "无穷级数敛散性 · 660 第 8 章 21 题", meta: "错误 2 次 · 明天到期", tone: "red" },
      { index: "02", title: "曲线积分与路径无关 · 660 第 11 章 5 题", meta: "错误 2 次 · 3 天后", tone: "amber" },
      { index: "03", title: "参数估计 · 660 概率第 7 章 18 题", meta: "错误 2 次 · 已安排", tone: "amber" },
    ],
  },
  "880": {
    key: "880",
    tab: "880",
    title: "李林 880题",
    meta: "精讲精练 · 数一 · 基础篇 + 综合篇 + 拓展篇",
    note: "三档难度分开统计：基础篇查漏、综合篇拉分、拓展篇冲 130+；标注会区分方法不会和计算错误。",
    icon: "layers-3",
    tone: "amber",
    phases: ["基础篇", "综合篇", "拓展篇"],
    bannerValue: "421",
    bannerUnit: "/880 题",
    bannerPercent: 48,
    bannerFoot: ["正确率 66%", "本周 +62 题"],
    total: 880,
    accuracy: 66,
    wrong: 17,
    never: 5,
    weekDone: 62,
    sections: [
      {
        name: "高等数学",
        short: "高数",
        done: 268,
        total: 560,
        accuracy: 64,
        chapters: [
          ["函数、极限、连续", 92, 74, 58, 86, 70, 52, 1],
          ["一元函数微分学", 90, 70, 55, 83, 66, 50, 2],
          ["一元函数积分学", 88, 68, 52, 80, 63, 48, 2],
          ["多元函数微分学", 82, 62, 47, 76, 58, 44, 3],
          ["二重积分", 80, 59, 44, 73, 55, 42, 3],
          ["三重积分", 72, 50, 36, 68, 47, 35, 2],
          ["曲线曲面积分", 66, 45, 32, 62, 42, 31, 3],
          ["微分方程", 84, 66, 50, 78, 62, 47, 1],
          ["无穷级数", 74, 48, 35, 70, 45, 33, 4],
          ["空间解析几何", 76, 52, 38, 71, 49, 36, 1],
          ["场论初步", 64, 42, 30, 60, 40, 29, 2],
          ["综合应用", 70, 44, 31, 65, 41, 30, 2],
        ],
      },
      {
        name: "线性代数",
        short: "线代",
        done: 98,
        total: 200,
        accuracy: 70,
        chapters: [
          ["行列式", 90, 74, 58, 84, 70, 55, 1],
          ["矩阵", 88, 72, 56, 82, 68, 53, 1],
          ["向量", 84, 66, 50, 78, 62, 48, 2],
          ["线性方程组", 82, 64, 48, 76, 60, 46, 2],
          ["特征值与特征向量", 80, 62, 45, 74, 58, 43, 2],
          ["二次型", 76, 57, 41, 70, 54, 39, 3],
          ["相似与合同", 74, 56, 40, 68, 52, 38, 2],
          ["综合应用", 72, 52, 37, 66, 49, 35, 2],
        ],
      },
      {
        name: "概率论与数理统计",
        short: "概率",
        done: 55,
        total: 120,
        accuracy: 62,
        chapters: [
          ["随机事件与概率", 88, 72, 56, 82, 68, 53, 1],
          ["一维随机变量", 82, 64, 48, 76, 60, 46, 2],
          ["多维随机变量", 74, 54, 39, 69, 51, 37, 3],
          ["随机变量数字特征", 78, 60, 44, 72, 56, 42, 2],
          ["大数定律与中心极限定理", 70, 50, 36, 65, 47, 34, 3],
          ["数理统计基本概念", 72, 52, 38, 67, 49, 36, 2],
          ["参数估计", 68, 48, 34, 63, 45, 32, 3],
        ],
      },
    ],
    records: [
      {
        date: "2026-09-25",
        part: "综合篇",
        chapter: "特征值与特征向量",
        score: "24/30",
        rate: 80,
        time: "44 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "880 · 综合篇 线代第 5 章 17 题",
          sub: "特征值与特征向量 · 已复盘",
          types: [],
          status: "已消灭",
          next: "7 天后",
          note: "相似对角化判定已顺畅；保留一道拓展篇变式周末重做。",
        },
      },
      {
        date: "2026-09-23",
        part: "拓展篇",
        chapter: "二次型",
        score: "15/30",
        rate: 50,
        time: "52 分钟",
        marks: [["概念不清", "red"], ["一直不会", "red"]],
        ann: {
          title: "880 · 拓展篇 线代第 6 章 17 题",
          sub: "二次型正定判断 · 错误 2 次",
          types: ["概念不清", "方法不会"],
          status: "一直不会",
          next: "今天",
          note: "顺序主子式只算了前两个；正定证明要先写清前提条件。",
        },
      },
      {
        date: "2026-09-21",
        part: "综合篇",
        chapter: "无穷级数",
        score: "17/30",
        rate: 57,
        time: "49 分钟",
        marks: [["方法不会", "red"]],
        ann: {
          title: "880 · 综合篇 第 9 章 14 题",
          sub: "无穷级数 · 错误 2 次",
          types: ["方法不会", "概念不清"],
          status: "需加强",
          next: "1 天后",
          note: "幂级数收敛域端点单独讨论这一步总是漏，整理成固定流程。",
        },
      },
      {
        date: "2026-09-19",
        part: "基础篇",
        chapter: "多维随机变量",
        score: "21/30",
        rate: 70,
        time: "41 分钟",
        marks: [["计算错误", "amber"]],
        ann: {
          title: "880 · 基础篇 概率第 3 章 9 题",
          sub: "多维随机变量 · 错误 1 次",
          types: ["计算错误"],
          status: "需加强",
          next: "3 天后",
          note: "卷积公式上下限写反；画联合密度区域再积分。",
        },
      },
    ],
    neverItems: [
      { index: "01", title: "二次型正定判断 · 880 拓展篇 第 5 章 17 题", meta: "错误 2 次 · 今天到期 · 高优先", tone: "red" },
      { index: "02", title: "曲线积分与路径无关 · 880 综合篇 第 7 章 4 题", meta: "错误 2 次 · 明天到期", tone: "red" },
      { index: "03", title: "幂级数收敛域端点 · 880 综合篇 第 9 章 14 题", meta: "错误 2 次 · 3 天后", tone: "amber" },
    ],
  },
  "xdf": {
    key: "xdf",
    tab: "新东方1000题",
    title: "新东方 1000题",
    meta: "考研数学 · 数一 · 基础篇 + 强化篇",
    note: "作为张宇 1000题之外的补充题源，按章节记录正确率，错题与主资料统一进入同一个错题本。",
    icon: "notebook-pen",
    tone: "violet",
    phases: ["基础篇", "强化篇"],
    bannerValue: "268",
    bannerUnit: "/1000 题",
    bannerPercent: 27,
    bannerFoot: ["正确率 58%", "本周 +54 题"],
    total: 1000,
    accuracy: 58,
    wrong: 21,
    never: 6,
    weekDone: 54,
    sections: [
      {
        name: "高等数学",
        short: "高数",
        done: 168,
        total: 520,
        accuracy: 56,
        chapters: [
          ["函数、极限、连续", 72, 54, 64, 50, 3],
          ["一元函数微分学", 68, 50, 61, 47, 3],
          ["一元函数积分学", 64, 46, 58, 44, 4],
          ["多元函数微分学", 58, 40, 53, 39, 3],
          ["二重积分", 52, 34, 48, 34, 4],
          ["微分方程", 60, 44, 56, 42, 2],
          ["无穷级数", 42, 27, 40, 28, 5],
          ["空间解析几何", 48, 32, 45, 33, 2],
          ["曲线曲面积分", 38, 24, 36, 25, 4],
          ["综合应用", 54, 36, 50, 35, 3],
        ],
      },
      {
        name: "线性代数",
        short: "线代",
        done: 62,
        total: 240,
        accuracy: 61,
        chapters: [
          ["行列式", 66, 48, 60, 45, 2],
          ["矩阵", 63, 45, 58, 42, 2],
          ["向量", 58, 40, 53, 38, 3],
          ["线性方程组", 55, 37, 50, 35, 3],
          ["特征值与特征向量", 52, 34, 47, 33, 3],
          ["二次型", 46, 28, 42, 27, 4],
          ["综合应用", 50, 31, 45, 30, 3],
        ],
      },
      {
        name: "概率论与数理统计",
        short: "概率",
        done: 38,
        total: 240,
        accuracy: 52,
        chapters: [
          ["随机事件与概率", 60, 42, 55, 40, 3],
          ["一维随机变量", 55, 37, 50, 35, 3],
          ["多维随机变量", 44, 26, 40, 25, 4],
          ["随机变量数字特征", 50, 32, 45, 30, 3],
          ["大数定律与中心极限定理", 38, 22, 35, 21, 4],
          ["参数估计", 42, 25, 38, 24, 4],
        ],
      },
    ],
    records: [
      {
        date: "2026-09-24",
        part: "强化篇",
        chapter: "随机变量数字特征",
        score: "20/30",
        rate: 67,
        time: "50 分钟",
        marks: [["计算错误", "amber"]],
        ann: {
          title: "新东方1000题 · 强化篇 概率第 4 章 16 题",
          sub: "随机变量数字特征 · 错误 2 次",
          types: ["计算错误"],
          status: "需加强",
          next: "3 天后",
          note: "方差公式漏掉协方差项；先判断是否独立再套公式。",
        },
      },
      {
        date: "2026-09-22",
        part: "强化篇",
        chapter: "二重积分",
        score: "16/30",
        rate: 53,
        time: "54 分钟",
        marks: [["概念不清", "red"], ["一直不会", "red"]],
        ann: {
          title: "新东方1000题 · 强化篇 第 5 章 19 题",
          sub: "二重积分 · 错误 2 次",
          types: ["概念不清", "方法不会"],
          status: "一直不会",
          next: "今天",
          note: "极坐标换序后角度范围写错，区域图必须画出来。",
        },
      },
      {
        date: "2026-09-20",
        part: "基础篇",
        chapter: "无穷级数",
        score: "14/30",
        rate: 47,
        time: "47 分钟",
        marks: [["方法不会", "red"]],
        ann: {
          title: "新东方1000题 · 基础篇 第 7 章 21 题",
          sub: "无穷级数 · 错误 3 次",
          types: ["方法不会", "概念不清"],
          status: "一直不会",
          next: "1 天后",
          note: "交错级数判别只会写莱布尼茨条件，不化简通项。",
        },
      },
      {
        date: "2026-09-17",
        part: "基础篇",
        chapter: "线性方程组",
        score: "21/30",
        rate: 70,
        time: "39 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "新东方1000题 · 基础篇 线代第 4 章 13 题",
          sub: "线性方程组 · 已复盘",
          types: [],
          status: "已消灭",
          next: "7 天后",
          note: "含参方程组按秩分类已形成固定步骤。",
        },
      },
    ],
    neverItems: [
      { index: "01", title: "二重积分换序 · 新东方1000题 第 5 章 19 题", meta: "错误 2 次 · 今天到期", tone: "red" },
      { index: "02", title: "无穷级数判别 · 新东方1000题 第 7 章 21 题", meta: "错误 3 次 · 明天到期", tone: "red" },
      { index: "03", title: "多维随机变量卷积 · 新东方1000题 概率第 3 章 8 题", meta: "错误 2 次 · 3 天后", tone: "amber" },
    ],
  },
  "jinbang": {
    key: "jinbang",
    tab: "金榜全书",
    title: "考研数学金榜全书",
    meta: "复习全书 · 数一 · 基础篇 + 强化篇",
    note: "按复习全书章节记录基础篇、强化篇完成度；重点跟踪概念题、综合题的正确率和二刷安排。",
    icon: "book-open",
    tone: "cyan",
    phases: ["基础篇", "强化篇"],
    bannerValue: "486",
    bannerUnit: "/720 个考点",
    bannerPercent: 68,
    bannerFoot: ["正确率 68%", "本周 +48 个考点"],
    total: 720,
    unit: "个考点",
    accuracy: 68,
    wrong: 24,
    never: 7,
    weekDone: 48,
    sections: [
      {
        name: "高等数学",
        short: "高数",
        done: 342,
        total: 430,
        accuracy: 65,
        chapters: [
          ["函数、极限、连续", 86, 62, 82, 60, 1],
          ["一元函数微分学", 84, 58, 80, 56, 2],
          ["一元函数积分学", 82, 54, 78, 52, 2],
          ["中值定理与证明题", 74, 46, 71, 45, 3],
          ["多元函数微分学", 76, 48, 73, 47, 3],
          ["二重积分与三重积分", 71, 44, 69, 42, 3],
          ["曲线积分与曲面积分", 64, 38, 63, 37, 4],
          ["微分方程", 78, 52, 75, 50, 2],
          ["无穷级数", 68, 40, 66, 39, 4],
          ["空间解析几何与场论", 70, 42, 68, 41, 3],
          ["综合应用与证明", 66, 37, 64, 36, 4],
          ["易错结论回顾", 74, 43, 72, 42, 3],
        ],
      },
      {
        name: "线性代数",
        short: "线代",
        done: 102,
        total: 170,
        accuracy: 72,
        chapters: [
          ["行列式", 86, 64, 83, 62, 1],
          ["矩阵及运算", 84, 61, 81, 59, 1],
          ["向量与线性相关", 79, 56, 76, 54, 2],
          ["线性方程组", 77, 53, 74, 51, 2],
          ["特征值与特征向量", 74, 49, 71, 47, 2],
          ["二次型", 69, 44, 67, 42, 3],
          ["相似与合同综合", 66, 41, 64, 39, 3],
        ],
      },
      {
        name: "概率论与数理统计",
        short: "概率",
        done: 42,
        total: 120,
        accuracy: 64,
        chapters: [
          ["随机事件与概率", 76, 54, 73, 52, 2],
          ["一维随机变量", 72, 50, 70, 48, 2],
          ["多维随机变量", 64, 42, 62, 40, 3],
          ["数字特征", 70, 47, 68, 45, 2],
          ["大数定律与中心极限定理", 61, 39, 59, 38, 3],
          ["参数估计与假设检验", 58, 36, 56, 35, 4],
        ],
      },
    ],
    records: [
      {
        date: "2026-09-26",
        part: "强化篇",
        chapter: "中值定理与证明题",
        score: "18/24",
        rate: 75,
        time: "58 分钟",
        marks: [["方法不会", "red"], ["需加强", "amber"]],
        ann: {
          title: "金榜全书 · 强化篇 高数第 4 讲 12 题",
          sub: "中值定理与证明题 · 错误 2 次",
          types: ["方法不会"],
          status: "需加强",
          next: "3 天后",
          note: "辅助函数构造慢；先按结论反推，再验证端点条件。",
        },
      },
      {
        date: "2026-09-23",
        part: "强化篇",
        chapter: "二次型",
        score: "16/22",
        rate: 73,
        time: "46 分钟",
        marks: [["概念不清", "red"]],
        ann: {
          title: "金榜全书 · 强化篇 线代第 6 讲 8 题",
          sub: "二次型 · 错误 2 次",
          types: ["概念不清"],
          status: "需加强",
          next: "1 天后",
          note: "合同与相似的条件混在一起；先判断变换是否正交。",
        },
      },
      {
        date: "2026-09-20",
        part: "基础篇",
        chapter: "多维随机变量",
        score: "15/22",
        rate: 68,
        time: "49 分钟",
        marks: [["计算错误", "amber"]],
        ann: {
          title: "金榜全书 · 基础篇 概率第 3 讲 9 题",
          sub: "多维随机变量 · 错误 1 次",
          types: ["计算错误"],
          status: "需加强",
          next: "3 天后",
          note: "联合密度积分区域没有画完整，先画图再列上下限。",
        },
      },
      {
        date: "2026-09-17",
        part: "基础篇",
        chapter: "线性方程组",
        score: "20/24",
        rate: 83,
        time: "41 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "金榜全书 · 基础篇 线代第 4 讲 6 题",
          sub: "线性方程组 · 已复盘",
          types: [],
          status: "已消灭",
          next: "14 天后",
          note: "含参讨论的顺序已固定，复盘后能独立完成。",
        },
      },
    ],
    neverItems: [
      { index: "01", title: "中值定理辅助函数 · 金榜全书 高数第 4 讲 12 题", meta: "错误 3 次 · 今天到期 · 高优先", tone: "red" },
      { index: "02", title: "曲线积分方向判断 · 金榜全书 高数第 7 讲 9 题", meta: "错误 2 次 · 明天到期", tone: "red" },
      { index: "03", title: "二次型相似与合同 · 金榜全书 线代第 6 讲 8 题", meta: "错误 2 次 · 3 天后", tone: "amber" },
    ],
  },
  "fanghao": {
    key: "fanghao",
    tab: "方浩概率",
    title: "方浩概率论与数理统计",
    meta: "基础篇 + 强化篇 · 数学一",
    note: "基础篇和强化篇分开记录；重点跟踪多维随机变量、参数估计和假设检验的连续错误次数。",
    icon: "pencil-ruler",
    tone: "violet",
    phases: ["基础篇", "强化篇"],
    bannerValue: "197",
    bannerUnit: "/360 题",
    bannerPercent: 55,
    bannerFoot: ["正确率 64%", "本周 +42 题"],
    total: 360,
    unit: "题",
    accuracy: 64,
    wrong: 15,
    never: 5,
    weekDone: 42,
    sections: [
      {
        name: "概率论",
        short: "概率",
        done: 132,
        total: 200,
        accuracy: 66,
        chapters: [
          ["随机事件与概率", 84, 62, 80, 60, 1],
          ["一维随机变量及其分布", 80, 58, 77, 56, 2],
          ["多维随机变量及其分布", 72, 48, 69, 46, 3],
          ["随机变量数字特征", 76, 52, 73, 50, 2],
          ["大数定律与中心极限定理", 68, 44, 66, 43, 3],
          ["随机变量函数的分布", 64, 41, 62, 40, 3],
          ["综合应用与证明", 60, 38, 58, 37, 4],
          ["易错结论回顾", 70, 45, 68, 44, 3],
        ],
      },
      {
        name: "数理统计",
        short: "统计",
        done: 65,
        total: 160,
        accuracy: 61,
        chapters: [
          ["总体、样本与统计量", 72, 50, 70, 48, 2],
          ["抽样分布", 68, 46, 66, 44, 3],
          ["点估计与矩估计", 64, 42, 62, 41, 3],
          ["最大似然估计", 60, 39, 58, 38, 4],
          ["区间估计", 56, 35, 55, 34, 4],
          ["假设检验", 52, 32, 51, 31, 5],
        ],
      },
    ],
    records: [
      {
        date: "2026-09-27",
        part: "强化篇",
        chapter: "多维随机变量及其分布",
        score: "17/28",
        rate: 61,
        time: "52 分钟",
        marks: [["概念不清", "red"], ["方法不会", "red"]],
        ann: {
          title: "方浩概率 · 强化篇 第 3 章 14 题",
          sub: "多维随机变量 · 错误 3 次",
          types: ["概念不清", "方法不会"],
          status: "一直不会",
          next: "今天",
          note: "卷积公式上下限总是写反，先画联合密度区域再积分。",
        },
      },
      {
        date: "2026-09-24",
        part: "强化篇",
        chapter: "假设检验",
        score: "14/25",
        rate: 56,
        time: "44 分钟",
        marks: [["方法不会", "red"]],
        ann: {
          title: "方浩概率 · 强化篇 统计第 6 章 11 题",
          sub: "假设检验 · 错误 4 次",
          types: ["概念不清", "方法不会"],
          status: "一直不会",
          next: "1 天后",
          note: "拒绝域方向判断错误；先把原假设和备择假设写清楚。",
        },
      },
      {
        date: "2026-09-21",
        part: "基础篇",
        chapter: "随机变量数字特征",
        score: "21/30",
        rate: 70,
        time: "39 分钟",
        marks: [["计算错误", "amber"]],
        ann: {
          title: "方浩概率 · 基础篇 第 4 章 16 题",
          sub: "随机变量数字特征 · 错误 2 次",
          types: ["计算错误"],
          status: "需加强",
          next: "3 天后",
          note: "方差公式漏协方差项；先判断独立再套公式。",
        },
      },
      {
        date: "2026-09-18",
        part: "基础篇",
        chapter: "一维随机变量及其分布",
        score: "24/30",
        rate: 80,
        time: "36 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "方浩概率 · 基础篇 第 2 章 12 题",
          sub: "一维随机变量及其分布 · 已复盘",
          types: [],
          status: "已消灭",
          next: "7 天后",
          note: "分布函数分段讨论已形成固定步骤。",
        },
      },
    ],
    neverItems: [
      { index: "01", title: "多维随机变量卷积 · 方浩概率 第 3 章 14 题", meta: "错误 3 次 · 今天到期 · 高优先", tone: "red" },
      { index: "02", title: "假设检验拒绝域 · 方浩概率 统计第 6 章 11 题", meta: "错误 4 次 · 明天到期", tone: "red" },
      { index: "03", title: "最大似然估计 · 方浩概率 统计第 4 章 9 题", meta: "错误 2 次 · 3 天后", tone: "amber" },
    ],
  },
  "zhenti": {
    key: "zhenti",
    tab: "真题",
    title: "数学一历年真题",
    meta: "2010–2026 · 数一主线 · 数二 / 数三补充",
    note: "数一按套卷和模块双向记录；数二、数三只刷数一考纲内的公共部分，错题合并进同一错题本。",
    icon: "file-check-2",
    tone: "red",
    kind: "zhenti",
    phases: [],
    bannerValue: "113.6",
    bannerUnit: "/150 均分",
    bannerPercent: 76,
    bannerFoot: ["目标 130 分", "近 5 年 +6.4"],
    total: 17,
    accuracy: 76,
    wrong: 11,
    never: 4,
    weekDone: 2,
    examRows: [
      {
        year: "2026 数一",
        total: "118/150",
        choice: "62/80",
        solve: "56/70",
        rate: 79,
        marks: [["待复盘", "amber"], ["二重积分", "red"]],
        ann: {
          title: "2026 数一 · 第 19 题",
          sub: "二重积分 · 换序后区域判断错误",
          types: ["概念不清"],
          status: "需加强",
          next: "3 天后",
          note: "第 19 题换序漏掉一块区域，整题扣 8 分；先画图再定限。",
        },
      },
      {
        year: "2025 数一",
        total: "124/150",
        choice: "68/80",
        solve: "56/70",
        rate: 83,
        marks: [["已复盘", "green"]],
        ann: {
          title: "2025 数一 · 第 21 题",
          sub: "无穷级数 · 已复盘",
          types: ["计算错误"],
          status: "已消灭",
          next: "7 天后",
          note: "幂级数端点讨论已补齐。",
        },
      },
      {
        year: "2024 数一",
        total: "109/150",
        choice: "58/80",
        solve: "51/70",
        rate: 73,
        marks: [["概念不清", "red"]],
        ann: {
          title: "2024 数一 · 第 20 题",
          sub: "曲线积分 · 方向与路径判断错误",
          types: ["概念不清"],
          status: "需加强",
          next: "1 天后",
          note: "第二类曲线积分方向反了，注意起点到终点的方向。",
        },
      },
      {
        year: "2023 数一",
        total: "115/150",
        choice: "64/80",
        solve: "51/70",
        rate: 77,
        marks: [["已复盘", "green"]],
        ann: {
          title: "2023 数一 · 第 18 题",
          sub: "微分方程 · 已复盘",
          types: ["计算错误"],
          status: "已消灭",
          next: "14 天后",
          note: "一阶线性微分方程公式代入已稳定。",
        },
      },
      {
        year: "2022 数一",
        total: "102/150",
        choice: "56/80",
        solve: "46/70",
        rate: 68,
        marks: [["时间不足", "violet"]],
        ann: {
          title: "2022 数一 · 第 22 题",
          sub: "多维随机变量 · 时间不足未完成",
          types: ["时间不足", "计算错误"],
          status: "需加强",
          next: "3 天后",
          note: "前 16 题用时 80 分钟，后面大题被压缩；限时训练选填 70 分钟。",
        },
      },
    ],
    modules: [
      ["高等数学", 74, "blue", "需补强"],
      ["线性代数", 82, "green", "稳定"],
      ["概率论与数理统计", 71, "amber", "需补强"],
      ["选填题", 79, "violet", "稳定"],
      ["解答题", 80, "green", "稳定"],
    ],
    records: [
      {
        date: "2026-09-21",
        part: "数一",
        chapter: "2026 数一 · 整卷",
        score: "118/150",
        rate: 79,
        time: "172 分钟",
        marks: [["待复盘", "amber"], ["二重积分", "red"]],
        ann: {
          title: "2026 数一 · 第 19 题",
          sub: "二重积分 · 失分 8 分",
          types: ["概念不清"],
          status: "需加强",
          next: "3 天后",
          note: "换序漏区域；这卷其余失分集中在概率选择题。",
        },
      },
      {
        date: "2026-09-14",
        part: "数二",
        chapter: "2025 数二 · 公共部分",
        score: "121/150",
        rate: 81,
        time: "168 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "2025 数二 · 第 17 题",
          sub: "一元积分应用 · 已复盘",
          types: [],
          status: "已消灭",
          next: "14 天后",
          note: "旋转体体积公式选择正确。",
        },
      },
      {
        date: "2026-09-07",
        part: "数一",
        chapter: "2025 数一 · 整卷",
        score: "124/150",
        rate: 83,
        time: "168 分钟",
        marks: [["已复盘", "green"]],
        ann: {
          title: "2025 数一 · 第 21 题",
          sub: "无穷级数 · 已复盘",
          types: ["计算错误"],
          status: "已消灭",
          next: "7 天后",
          note: "端点讨论补齐，整卷节奏正常。",
        },
      },
      {
        date: "2026-08-31",
        part: "数三",
        chapter: "2024 数三 · 公共部分",
        score: "116/150",
        rate: 77,
        time: "175 分钟",
        marks: [["概念不清", "red"]],
        ann: {
          title: "2024 数三 · 第 20 题",
          sub: "线性方程组 · 含参讨论",
          types: ["概念不清"],
          status: "需加强",
          next: "1 天后",
          note: "含参讨论的边界值漏了一种情况。",
        },
      },
    ],
    neverItems: [
      { index: "01", title: "二重积分换序 · 2026 数一 第 19 题", meta: "失分 8 分 · 今天到期", tone: "red" },
      { index: "02", title: "曲线积分方向 · 2024 数一 第 20 题", meta: "失分 7 分 · 明天到期", tone: "red" },
      { index: "03", title: "多维随机变量 · 2022 数一 第 22 题", meta: "时间不足 · 3 天后", tone: "amber" },
      { index: "04", title: "含参线性方程组 · 2024 数三 第 20 题", meta: "错误 2 次 · 已安排", tone: "amber" },
    ],
  },
};

const ANNOTATE_TYPES = [
  { key: "concept", label: "概念不清", tone: "red", count: 12, errorCount: 31, reviewCount: 24, hint: "回看定义", mix: "数学 7 · 408 4 · 英语 1" },
  { key: "calc", label: "计算错误", tone: "amber", count: 9, errorCount: 19, reviewCount: 16, hint: "限时计算", mix: "数学 6 · 408 2 · 英语 1" },
  { key: "method", label: "方法不会", tone: "red", count: 7, errorCount: 18, reviewCount: 14, hint: "看解析", mix: "数学 6 · 408 1" },
  { key: "read", label: "审题错误", tone: "blue", count: 6, errorCount: 11, reviewCount: 9, hint: "圈关键词", mix: "英语 4 · 数学 2" },
  { key: "time", label: "时间不足", tone: "violet", count: 4, errorCount: 7, reviewCount: 6, hint: "分段计时", mix: "英语 2 · 数学 1 · 408 1" },
];

const ANNOTATE_STATUS = ["一直不会", "需加强", "正常", "已消灭"];
const ANNOTATE_NEXT = ["今天", "1 天后", "3 天后", "7 天后"];

const MISTAKE_ROWS = [
  {
    tags: "math,never,today,annotated",
    source: "1000题 · 强化篇",
    question: "第 12 章 14 题",
    point: "二重积分换序",
    types: [["概念不清", "red"], ["方法不会", "red"]],
    status: "一直不会",
    statusTone: "red",
    next: "今天",
    reviewCount: 4,
    errorCount: 5,
    note: "换序前先画积分区域；参数为 0 时漏讨论。",
    ann: {
      title: "1000题 · 强化篇 第 12 章 14 题",
      sub: "二重积分换序 · 错误 3 次 · 高优先",
      types: ["概念不清", "方法不会"],
      status: "一直不会",
      next: "今天",
      note: "换序前先画积分区域；参数为 0 时漏讨论，下次先写区域再动笔。",
    },
  },
  {
    tags: "408,today,annotated",
    source: "王道 · 组成原理",
    question: "Cache 映射计算",
    point: "地址映射 / 命中率",
    types: [["概念不清", "red"], ["计算错误", "amber"]],
    status: "需加强",
    statusTone: "amber",
    next: "今天",
    reviewCount: 3,
    errorCount: 4,
    note: "标记位数量总忘加，先算块内地址再算组号。",
    ann: {
      title: "王道 · 组成原理 Cache 映射计算",
      sub: "地址映射 / 命中率 · 错误 2 次",
      types: ["概念不清", "计算错误"],
      status: "需加强",
      next: "今天",
      note: "标记位数量总忘加，先算块内地址和组号再拼地址。",
    },
  },
  {
    tags: "math,annotated",
    source: "660",
    question: "第 8 章 21 题",
    point: "无穷级数敛散性",
    types: [["计算错误", "amber"]],
    status: "需加强",
    statusTone: "amber",
    next: "3 天后",
    reviewCount: 2,
    errorCount: 3,
    note: "比值判别法极限算错，p 级数结论要背牢。",
    ann: {
      title: "660 · 第 8 章 21 题",
      sub: "无穷级数敛散性 · 错误 2 次",
      types: ["计算错误", "概念不清"],
      status: "需加强",
      next: "3 天后",
      note: "比值判别法极限算错；把 p 级数与几何级数的结论再默一遍。",
    },
  },
  {
    tags: "english,annotated",
    source: "英语一",
    question: "2019 英语一 Text 1 第 22 题",
    point: "推理题",
    types: [["审题错误", "blue"]],
    status: "需加强",
    statusTone: "amber",
    next: "1 天后",
    reviewCount: 2,
    errorCount: 3,
    note: "把 infer 当成细节题定位，选项范围选大了。",
    ann: {
      title: "英语一 · 2019 Text 1 第 22 题",
      sub: "推理题 · 错误 2 次",
      types: ["审题错误", "时间不足"],
      status: "需加强",
      next: "1 天后",
      note: "把 infer 当成细节题定位；先看题干限制词再回原文。",
    },
  },
  {
    tags: "math,annotated",
    source: "880 · 拓展篇",
    question: "第 5 章 17 题",
    point: "二次型正定判断",
    types: [["概念不清", "red"]],
    status: "正常",
    statusTone: "blue",
    next: "7 天后",
    reviewCount: 2,
    errorCount: 2,
    note: "顺序主子式只算了前两个。",
    ann: {
      title: "880 · 拓展篇 第 5 章 17 题",
      sub: "二次型正定判断 · 错误 2 次",
      types: ["概念不清"],
      status: "正常",
      next: "7 天后",
      note: "顺序主子式只算了前两个；正定证明要先写清前提条件。",
    },
  },
  {
    tags: "math,never,annotated",
    source: "1000题 · 基础篇",
    question: "第 18 章 9 题",
    point: "多维随机变量",
    types: [["概念不清", "red"], ["方法不会", "red"]],
    status: "一直不会",
    statusTone: "red",
    next: "3 天后",
    reviewCount: 3,
    errorCount: 4,
    note: "卷积公式上下限写反，区域画不清。",
    ann: {
      title: "1000题 · 基础篇 第 18 章 9 题",
      sub: "多维随机变量 · 错误 2 次",
      types: ["概念不清", "方法不会"],
      status: "一直不会",
      next: "3 天后",
      note: "卷积公式上下限写反；先画联合密度区域，再确定积分范围。",
    },
  },
  {
    tags: "408,annotated",
    source: "408 真题",
    question: "2024 408 第 45 题",
    point: "操作系统 · 内存管理",
    types: [["概念不清", "red"]],
    status: "正常",
    statusTone: "blue",
    next: "7 天后",
    reviewCount: 2,
    errorCount: 2,
    note: "页表项和页目录项层级关系混淆。",
    ann: {
      title: "408 真题 · 2024 第 45 题",
      sub: "操作系统 · 内存管理 · 错误 1 次",
      types: ["概念不清"],
      status: "正常",
      next: "7 天后",
      note: "页表项和页目录项层级关系混淆；画两级页表结构图再算。",
    },
  },
  {
    tags: "english,annotated",
    source: "英语一",
    question: "2025 英语一 完形第 12 题",
    point: "逻辑衔接",
    types: [["审题错误", "blue"], ["时间不足", "violet"]],
    status: "需加强",
    statusTone: "amber",
    next: "3 天后",
    reviewCount: 1,
    errorCount: 2,
    note: "转折关系判断错，句子主干没先抓。",
    ann: {
      title: "英语一 · 2025 完形第 12 题",
      sub: "逻辑衔接 · 错误 1 次",
      types: ["审题错误", "时间不足"],
      status: "需加强",
      next: "3 天后",
      note: "转折关系判断错；先抓句子主干再看连接词。",
    },
  },
];

const MISTAKE_DECADE = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const MISTAKE_ANALYSIS_STAMPS = {};

const MISTAKE_ANALYSIS = {
  "mistake-0": {
    "heat": {
      "label": "低频",
      "tone": "blue",
      "total": 1
    },
    "years": [
      2025
    ],
    "itemCount": 1,
    "itemCountText": "1 道题",
    "items": [
      "2025 数一 第 4 题"
    ],
    "recent": {
      "year": 2025,
      "headline": "2025 数学一 · 第 4 题",
      "meta": "选择题 · 5 分 · 交换累次积分次序"
    },
    "method": "只计题干明确要求交换积分次序的题目；2024 年第 19 题未计入。",
    "source": {
      "label": "数学一真题语料 · PondFish-me/fish.888.moe",
      "url": "https://github.com/PondFish-me/fish.888.moe"
    },
    "pitfalls": [
      {
        "title": "换序前不画区域",
        "text": "直接交换 dx、dy 的上下限，区域一变形边界就写错。"
      },
      {
        "title": "上下限写反",
        "text": "x 型与 y 型区域的边界函数没有对应，换序后积分限不匹配。"
      },
      {
        "title": "含参情况漏讨论",
        "text": "参数取 0 或边界值时区域退化，这一步在你的 4 次复盘里反复漏掉。"
      }
    ],
    "knowledge": {
      "main": [
        "二重积分换序",
        "积分区域表示",
        "累次积分"
      ],
      "pre": [
        "区域分块",
        "边界函数求交点",
        "含参讨论"
      ]
    },
    "basis": "基于你的 4 次复盘、5 次错误记录与近 10 年真题统计"
  },
  "mistake-1": {
    "heat": {
      "label": "高频",
      "tone": "red",
      "total": 8
    },
    "years": [
      2016,
      2018,
      2019,
      2020,
      2021,
      2022,
      2023,
      2025
    ],
    "itemCount": 9,
    "itemCountText": "9 道题",
    "items": [
      "2016 408 第 15 题",
      "2016 408 第 45 题",
      "2018 408 第 44 题",
      "2019 408 第 46 题",
      "2020 408 第 44 题",
      "2021 408 第 16 题",
      "2022 408 第 16 题",
      "2023 408 第 43 题",
      "2025 408 第 43 题"
    ],
    "recent": {
      "year": 2025,
      "headline": "2025 408 · 第 43 题",
      "meta": "综合题 · 组号字段与 Cache 缺失率"
    },
    "method": "只计直接考查 Cache 地址映射、标记或组号划分、命中率的题目；2024 年相关题未计入。",
    "source": {
      "label": "408 真题语料 · neville-studio/408-exam-paper",
      "url": "https://github.com/neville-studio/408-exam-paper"
    },
    "pitfalls": [
      {
        "title": "标记位算错",
        "text": "标记位长度 = 地址总位数 - 组号位数 - 块内偏移位数，容易漏减组号位。"
      },
      {
        "title": "组数当成块数",
        "text": "组数 = 块数 ÷ 路数，组相联的组号位数按组数取对数。"
      },
      {
        "title": "命中率分母用错",
        "text": "题目按访问次数给权时，不能简单用命中次数 ÷ 总次数。"
      },
      {
        "title": "写回与写直达混淆",
        "text": "写回法的替换和主存写回时机与写直达不同，影响访存次数统计。"
      }
    ],
    "knowledge": {
      "main": [
        "Cache 地址映射",
        "标记位与组号划分",
        "命中率计算"
      ],
      "pre": [
        "主存地址结构",
        "块与组的关系",
        "替换算法"
      ]
    },
    "basis": "基于你的 3 次复盘、4 次错误记录与近 10 年真题统计"
  },
  "mistake-2": {
    "heat": {
      "label": "中频",
      "tone": "amber",
      "total": 4
    },
    "years": [
      2016,
      2019,
      2023,
      2025
    ],
    "itemCount": 4,
    "itemCountText": "4 道题",
    "items": [
      "2016 数一 第 19 题",
      "2019 数一 第 3 题",
      "2023 数一 第 4 题",
      "2025 数一 第 2 题"
    ],
    "recent": {
      "year": 2025,
      "headline": "2025 数学一 · 第 2 题",
      "meta": "选择题 · 5 分 · 数项级数敛散性"
    },
    "method": "只计数项级数敛散性题；幂级数收敛域与和函数题未计入，因此 2020 年第 4 题未计。",
    "source": {
      "label": "数学一真题语料 · PondFish-me/fish.888.moe",
      "url": "https://github.com/PondFish-me/fish.888.moe"
    },
    "pitfalls": [
      {
        "title": "比值判别法极限算错",
        "text": "通项比值的极限在化简时丢项，是这道题最主要的一次错误。"
      },
      {
        "title": "p 级数边界记混",
        "text": "p > 1 收敛、p ≤ 1 发散，p = 1 要单独判断不能套结论。"
      },
      {
        "title": "判别法适用条件用错",
        "text": "比较、比值、根值判别法都要求正项级数，交错级数不能直接套。"
      }
    ],
    "knowledge": {
      "main": [
        "正项级数判别法",
        "p 级数结论",
        "交错级数"
      ],
      "pre": [
        "极限计算",
        "比较判别法",
        "通项趋于零"
      ]
    },
    "basis": "基于你的 2 次复盘、3 次错误记录与近 10 年真题统计"
  },
  "mistake-3": {
    "heat": {
      "label": "每年出现",
      "tone": "red",
      "total": 10
    },
    "years": [
      2016,
      2017,
      2018,
      2019,
      2020,
      2021,
      2022,
      2023,
      2024,
      2025
    ],
    "itemCount": 31,
    "itemCountText": "31 道题",
    "items": [
      "2016 英语一 Text 2 第 28 题",
      "2016 英语一 Text 4 第 37 题",
      "2016 英语一 Text 4 第 38 题",
      "2017 英语一 Text 2 第 26 题",
      "2017 英语一 Text 2 第 29 题",
      "2017 英语一 Text 3 第 32 题",
      "2017 英语一 Text 3 第 34 题",
      "2018 英语一 Text 1 第 24 题",
      "2019 英语一 Text 1 第 22 题",
      "2019 英语一 Text 4 第 37 题",
      "2020 英语一 Text 1 第 23 题",
      "2020 英语一 Text 2 第 29 题",
      "2020 英语一 Text 3 第 35 题",
      "2020 英语一 Text 4 第 37 题",
      "2020 英语一 Text 4 第 39 题",
      "2021 英语一 Text 1 第 23 题",
      "2021 英语一 Text 4 第 38 题",
      "2022 英语一 Text 2 第 26 题",
      "2022 英语一 Text 2 第 30 题",
      "2022 英语一 Text 4 第 37 题",
      "2022 英语一 Text 4 第 40 题",
      "2023 英语一 Text 1 第 25 题",
      "2023 英语一 Text 4 第 39 题",
      "2024 英语一 Text 1 第 24 题",
      "2024 英语一 Text 2 第 29 题",
      "2024 英语一 Text 3 第 31 题",
      "2024 英语一 Text 4 第 39 题",
      "2025 英语一 Text 1 第 25 题",
      "2025 英语一 Text 2 第 29 题",
      "2025 英语一 Text 3 第 32 题",
      "2025 英语一 Text 3 第 33 题"
    ],
    "recent": {
      "year": 2025,
      "headline": "2025 英语一 · Text 3 第 33 题",
      "meta": "阅读理解 · 2 分 · 推理题"
    },
    "method": "按阅读 Part A 题干中的 infer、imply、suggest、learn 等关键词统计。",
    "source": {
      "label": "英语一真题语料 · LIziak112/structured-kaoyan-english",
      "url": "https://github.com/LIziak112/structured-kaoyan-english"
    },
    "pitfalls": [
      {
        "title": "当成细节题做",
        "text": "看到 infer、imply、suggest 仍回原文找原句，导致选了字面对应的选项。"
      },
      {
        "title": "选项范围选大",
        "text": "正确项通常是原文的同义改写，范围比原文大或绝对化的选项要排除。"
      },
      {
        "title": "忽略题干限定词",
        "text": "题干里的 the author、paragraph 4 限定了信息区间，跳过就会选错段落。"
      }
    ],
    "knowledge": {
      "main": [
        "推理题解题步骤",
        "同义改写识别",
        "选项排除"
      ],
      "pre": [
        "题干定位",
        "段落主旨",
        "作者态度词"
      ]
    },
    "basis": "基于你的 2 次复盘、3 次错误记录与近 10 年真题统计"
  },
  "mistake-4": {
    "heat": {
      "label": "中频",
      "tone": "amber",
      "total": 3
    },
    "years": [
      2021,
      2024,
      2025
    ],
    "itemCount": 4,
    "itemCountText": "4 道题",
    "items": [
      "2021 数一 第 5 题",
      "2021 数一 第 21 题",
      "2024 数一 第 15 题",
      "2025 数一 第 5 题"
    ],
    "recent": {
      "year": 2025,
      "headline": "2025 数学一 · 第 5 题",
      "meta": "选择题 · 5 分 · 正惯性指数"
    },
    "method": "只计直接考查正定性、半正定性或正负惯性指数的题；仅涉及标准形、合同变换的题未计入。",
    "source": {
      "label": "数学一真题语料 · PondFish-me/fish.888.moe",
      "url": "https://github.com/PondFish-me/fish.888.moe"
    },
    "pitfalls": [
      {
        "title": "顺序主子式只算前几个",
        "text": "n 阶矩阵要算完 1 到 n 阶全部顺序主子式，漏一个结论就不成立。"
      },
      {
        "title": "忽略对称前提",
        "text": "顺序主子式判别法只适用于实对称矩阵，先验证 A 是否对称。"
      },
      {
        "title": "含参端点漏讨论",
        "text": "参数使某个主子式为零时要单独讨论，不能直接归入正定或不定。"
      }
    ],
    "knowledge": {
      "main": [
        "二次型正定性",
        "顺序主子式判别法",
        "特征值法"
      ],
      "pre": [
        "对称矩阵",
        "特征值计算",
        "配方法"
      ]
    },
    "basis": "基于你的 2 次复盘、2 次错误记录与近 10 年真题统计"
  },
  "mistake-5": {
    "heat": {
      "label": "高频",
      "tone": "red",
      "total": 6
    },
    "years": [
      2016,
      2017,
      2018,
      2019,
      2020,
      2023
    ],
    "itemCount": 6,
    "itemCountText": "6 道题",
    "items": [
      "2016 数一 第 22 题",
      "2017 数一 第 22 题",
      "2018 数一 第 22 题",
      "2019 数一 第 22 题",
      "2020 数一 第 22 题",
      "2023 数一 第 22 题"
    ],
    "recent": {
      "year": 2023,
      "headline": "2023 数学一 · 第 22 题",
      "meta": "解答题 · 12 分 · Z=X²+Y² 的概率密度"
    },
    "method": "只计二维随机变量函数的分布题；2021 年、2025 年第 22 题不属于该命名考点。",
    "source": {
      "label": "数学一真题语料 · PondFish-me/fish.888.moe",
      "url": "https://github.com/PondFish-me/fish.888.moe"
    },
    "pitfalls": [
      {
        "title": "卷积公式上下限写反",
        "text": "先画联合密度非零区域，再按区域确定积分上下限，不能凭记忆套公式。"
      },
      {
        "title": "区域画不清",
        "text": "z 的取值分段依赖区域形状，分区讨论缺失会直接丢一半分数。"
      },
      {
        "title": "边缘密度与条件密度混淆",
        "text": "求 f_X(x) 时是对 y 积分，别把条件密度的表达式直接搬过来。"
      }
    ],
    "knowledge": {
      "main": [
        "二维随机变量函数的分布",
        "卷积公式",
        "边缘密度"
      ],
      "pre": [
        "联合分布",
        "二重积分区域",
        "密度归一性"
      ]
    },
    "basis": "基于你的 3 次复盘、4 次错误记录与近 10 年真题统计"
  },
  "mistake-6": {
    "heat": {
      "label": "每年出现",
      "tone": "red",
      "total": 10
    },
    "years": [
      2016,
      2017,
      2018,
      2019,
      2020,
      2021,
      2022,
      2023,
      2024,
      2025
    ],
    "itemCount": 15,
    "itemCountText": "15 道可核验代表题",
    "items": [
      "2016 408 第 45 题",
      "2017 408 第 45 题",
      "2018 408 第 44 题",
      "2018 408 第 45 题",
      "2019 408 第 14 题",
      "2019 408 第 31 题",
      "2020 408 第 46 题",
      "2021 408 第 28 题",
      "2021 408 第 29 题",
      "2021 408 第 44 题",
      "2022 408 第 15 题",
      "2023 408 第 43 题",
      "2024 408 第 25 题",
      "2024 408 第 45 题",
      "2025 408 第 43 题"
    ],
    "recent": {
      "year": 2025,
      "headline": "2025 408 · 第 43 题",
      "meta": "综合题 · 页式虚拟存储与地址转换"
    },
    "method": "从页表、页目录、TLB、地址转换与缺页题中筛出可核验代表题，不代表总命中题量。",
    "source": {
      "label": "408 真题语料 · neville-studio/408-exam-paper",
      "url": "https://github.com/neville-studio/408-exam-paper"
    },
    "pitfalls": [
      {
        "title": "页表项与页目录项混淆",
        "text": "两级页表中第一级指向页目录、第二级才是页表项，层级关系要画图确认。"
      },
      {
        "title": "标志位作用记反",
        "text": "有效位、修改位、访问位分别控制缺页、写回和替换，不能混用。"
      },
      {
        "title": "多级页表的作用记错",
        "text": "多级页表节省的是页表本身占用的连续空间，不减少地址转换的访存次数。"
      }
    ],
    "knowledge": {
      "main": [
        "多级页表",
        "地址转换",
        "页表项结构"
      ],
      "pre": [
        "页式管理",
        "TLB",
        "缺页中断"
      ]
    },
    "basis": "基于你的 2 次复盘、2 次错误记录与近 10 年真题统计"
  },
  "mistake-7": {
    "heat": {
      "label": "每年出现",
      "tone": "red",
      "total": 10
    },
    "years": [
      2016,
      2017,
      2018,
      2019,
      2020,
      2021,
      2022,
      2023,
      2024,
      2025
    ],
    "itemCount": 32,
    "itemCountText": "32 道题",
    "items": [
      "2016 英语一 完形第 4 题",
      "2016 英语一 完形第 5 题",
      "2016 英语一 完形第 7 题",
      "2016 英语一 完形第 13 题",
      "2016 英语一 完形第 20 题",
      "2017 英语一 完形第 1 题",
      "2017 英语一 完形第 11 题",
      "2017 英语一 完形第 18 题",
      "2018 英语一 完形第 4 题",
      "2018 英语一 完形第 5 题",
      "2018 英语一 完形第 19 题",
      "2019 英语一 完形第 3 题",
      "2019 英语一 完形第 9 题",
      "2019 英语一 完形第 13 题",
      "2019 英语一 完形第 18 题",
      "2020 英语一 完形第 9 题",
      "2020 英语一 完形第 14 题",
      "2020 英语一 完形第 17 题",
      "2021 英语一 完形第 3 题",
      "2021 英语一 完形第 16 题",
      "2022 英语一 完形第 3 题",
      "2022 英语一 完形第 10 题",
      "2022 英语一 完形第 13 题",
      "2023 英语一 完形第 9 题",
      "2023 英语一 完形第 11 题",
      "2023 英语一 完形第 16 题",
      "2023 英语一 完形第 19 题",
      "2024 英语一 完形第 1 题",
      "2024 英语一 完形第 14 题",
      "2024 英语一 完形第 18 题",
      "2025 英语一 完形第 9 题",
      "2025 英语一 完形第 12 题"
    ],
    "recent": {
      "year": 2025,
      "headline": "2025 英语一 · 完形第 12 题",
      "meta": "完形填空 · 0.5 分 · 逻辑衔接"
    },
    "method": "按完形选项及答案中的逻辑衔接词人工复核；排除 2016 年第 16 题 whatever（限定词），补入 2023 年第 9 题 so that（表目的）。",
    "source": {
      "label": "英语一真题语料 · LIziak112/structured-kaoyan-english",
      "url": "https://github.com/LIziak112/structured-kaoyan-english"
    },
    "pitfalls": [
      {
        "title": "先看选项再看上下文",
        "text": "被选项词义带偏，忽略空格前后的逻辑关系。"
      },
      {
        "title": "只按词义选",
        "text": "转折、递进、因果的衔接词要看语义方向，不是选意思最顺的那个。"
      },
      {
        "title": "忽略复现与同义替换",
        "text": "完形的答案常由上下文的复现词决定，跳读会丢掉线索。"
      }
    ],
    "knowledge": {
      "main": [
        "完形逻辑衔接",
        "连接词辨析",
        "上下文复现"
      ],
      "pre": [
        "句子主干",
        "同义替换",
        "段落主旨"
      ]
    },
    "basis": "基于你的 1 次复盘、2 次错误记录与近 10 年真题统计"
  }
};

const MISTAKE_BOARD_TABS = [
  { key: "math", label: "数学", total: 18, tone: "blue" },
  { key: "english", label: "英语", total: 7, tone: "green" },
  { key: "408", label: "408", total: 13, tone: "amber" },
];

const MISTAKE_BOARD_DATA = {
  math: [
    { title: "二重积分换序", source: "1000题 · 强化篇 第 12 章 14 题", errorCount: 5, reviewCount: 4, status: "一直不会", tone: "red", next: "今天" },
    { title: "二次型正定判断", source: "880 · 拓展篇 线代第 5 章 17 题", errorCount: 4, reviewCount: 4, status: "需加强", tone: "red", next: "今天" },
    { title: "无穷级数敛散性", source: "660 · 第 8 章 21 题", errorCount: 4, reviewCount: 3, status: "需加强", tone: "amber", next: "3 天后" },
    { title: "多维随机变量卷积", source: "方浩概率 · 强化篇 第 3 章 14 题", errorCount: 3, reviewCount: 3, status: "一直不会", tone: "red", next: "今天" },
    { title: "曲线积分与路径无关", source: "880 · 综合篇 第 7 章 4 题", errorCount: 3, reviewCount: 2, status: "需加强", tone: "amber", next: "明天" },
  ],
  english: [
    { title: "2019 英语一 Text 1 第 22 题", source: "英语一 · 推理题", errorCount: 3, reviewCount: 2, status: "需加强", tone: "amber", next: "1 天后" },
    { title: "2025 英语一 完形第 12 题", source: "英语一 · 逻辑衔接", errorCount: 2, reviewCount: 2, status: "需加强", tone: "amber", next: "3 天后" },
    { title: "2024 英语一 Text 2 第 29 题", source: "英语一 · 阅读 Part A", errorCount: 2, reviewCount: 1, status: "需加强", tone: "blue", next: "明天" },
    { title: "翻译长难句", source: "英语一 · 定语从句与倒装", errorCount: 2, reviewCount: 1, status: "正常", tone: "blue", next: "7 天后" },
    { title: "小作文格式", source: "英语一 · 写作练习", errorCount: 1, reviewCount: 1, status: "正常", tone: "green", next: "14 天后" },
  ],
  "408": [
    { title: "Cache 映射计算", source: "王道 · 组成原理", errorCount: 4, reviewCount: 3, status: "一直不会", tone: "red", next: "今天" },
    { title: "2024 408 第 45 题 · 内存管理", source: "408 真题 · 操作系统", errorCount: 3, reviewCount: 2, status: "需加强", tone: "amber", next: "3 天后" },
    { title: "TCP 拥塞控制", source: "王道 · 计算机网络", errorCount: 3, reviewCount: 2, status: "需加强", tone: "amber", next: "明天" },
    { title: "中断与异常", source: "王道 · 组成原理", errorCount: 2, reviewCount: 2, status: "正常", tone: "blue", next: "7 天后" },
    { title: "多级页表结构", source: "王道 · 操作系统", errorCount: 2, reviewCount: 1, status: "需加强", tone: "amber", next: "3 天后" },
  ],
};

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function annotateButton({ id, title = "", sub = "", types = [], status = "需加强", next = "3 天后", note = "", reviewCount, errorCount }) {
  const errorMatch = String(sub).match(/错误\s*(\d+)\s*次/);
  const reviewMatch = String(sub).match(/复盘\s*(\d+)\s*次/);
  const fallbackReview = status === "已消灭" ? 2 : 1;
  const fallbackError = status === "已消灭" ? 1 : 2;
  const resolveCount = (value, fallback) => {
    if (value === undefined || value === null || value === "") return fallback;
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.round(count)) : fallback;
  };
  const resolvedReview = resolveCount(reviewCount, reviewMatch ? Number(reviewMatch[1]) : fallbackReview);
  const resolvedError = resolveCount(errorCount, errorMatch ? Number(errorMatch[1]) : fallbackError);
  const attrs = [
    `data-annotate="${id}"`,
    `data-ann-title="${escapeAttr(title)}"`,
    `data-ann-sub="${escapeAttr(sub)}"`,
    `data-ann-types="${escapeAttr(types.join(","))}"`,
    `data-ann-status="${escapeAttr(status)}"`,
    `data-ann-next="${escapeAttr(next)}"`,
    `data-ann-note="${escapeAttr(note)}"`,
    `data-ann-review="${resolvedReview}"`,
    `data-ann-error="${resolvedError}"`,
  ].join(" ");
  return `<button class="annotate-btn" type="button" ${attrs}>${icon("tag")} 标注</button>`;
}

function analysisButton({ id, title = "" }) {
  const attrs = [
    `data-analyze="${id}"`,
    `data-analysis-title="${escapeAttr(title)}"`,
    'aria-expanded="false"',
  ].join(" ");
  return `<button class="analysis-btn" type="button" title="分析易错点、知识点和近十年真题考频" ${attrs}>${icon("sparkles")} AI 分析</button>`;
}

function annotationPanelHTML(button) {
  const data = button.dataset;
  const activeTypes = (data.annTypes || "").split(",").filter(Boolean);
  return `
    <tr class="annotate-panel-row" data-annotate-panel="${escapeAttr(data.annotate)}">
      <td colspan="99">
        <div class="annotate-panel">
          <div class="annotate-panel-head">
            <div class="annotate-panel-title">
              <span class="annotate-panel-icon">${icon("tag")}</span>
              <div>
                <strong>${data.annTitle || "错题标注"}</strong>
                <span>${data.annSub || "记录错因、卡点和下次复盘安排"}</span>
              </div>
            </div>
            <div class="annotate-panel-actions">
              <button class="secondary-btn compact" type="button" data-annotate-cancel>${icon("x")} 收起</button>
              <button class="primary-btn compact" type="button" data-annotate-save>${icon("check")} 保存标注</button>
            </div>
          </div>
          <div class="annotate-fields">
            <div class="annotate-field">
              <label>错误类型 · 可多选</label>
              <div class="chip-select">
                ${ANNOTATE_TYPES.map((type) => `<button class="filter-chip ${activeTypes.includes(type.label) ? "active" : ""}" type="button" data-annotate-type="${type.label}">${type.label}</button>`).join("")}
              </div>
            </div>
            <div class="annotate-field">
              <label>掌握状态</label>
              <div class="segmented compact">
                ${ANNOTATE_STATUS.map((status) => `<button class="${status === (data.annStatus || "需加强") ? "active" : ""}" type="button" data-annotate-status="${status}">${status}</button>`).join("")}
              </div>
            </div>
            <div class="annotate-field">
              <label>下次复盘</label>
              <div class="segmented compact">
                ${ANNOTATE_NEXT.map((next) => `<button class="${next === (data.annNext || "3 天后") ? "active" : ""}" type="button" data-annotate-next="${next}">${next}</button>`).join("")}
              </div>
            </div>
            <div class="annotate-field count-field">
              <label>复盘次数</label>
              <div class="count-stepper">
                <button type="button" data-count-delta="-1" aria-label="减少复盘次数">-</button>
                <input type="number" min="0" step="1" data-ann-review-count value="${escapeAttr(data.annReview || 1)}" aria-label="复盘次数">
                <button type="button" data-count-delta="1" aria-label="增加复盘次数">+</button>
                <span>次</span>
              </div>
            </div>
            <div class="annotate-field count-field">
              <label>错误次数</label>
              <div class="count-stepper">
                <button type="button" data-count-delta="-1" aria-label="减少错误次数">-</button>
                <input type="number" min="0" step="1" data-ann-error-count value="${escapeAttr(data.annError || 1)}" aria-label="错误次数">
                <button type="button" data-count-delta="1" aria-label="增加错误次数">+</button>
                <span>次</span>
              </div>
            </div>
            <div class="annotate-field wide">
              <label>笔记 · 为什么错、卡在哪一步、下次怎么避免</label>
              <textarea class="annotate-note" rows="3">${escapeAttr(data.annNote || "")}</textarea>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function analysisPanelHTML(button) {
  const id = button.dataset.analyze;
  const data = MISTAKE_ANALYSIS[id];
  if (!data) return "";
  const years = data.years || [];
  const latest = years.length ? Math.max(...years) : null;
  const hitYears = new Set(years);
  const heat = data.heat || { label: "常考", tone: "blue", total: years.length };
  const related = Array.isArray(data.items) ? data.items.slice(-3).reverse() : [];
  const stamp = MISTAKE_ANALYSIS_STAMPS[id] || "";
  return `
    <tr class="analysis-panel-row" data-analysis-panel="${escapeAttr(id)}">
      <td colspan="99">
        <div class="analysis-panel">
          <div class="analysis-head">
            <div class="analysis-title">
              <span class="analysis-icon">${icon("sparkles")}</span>
              <div>
                <strong>${button.dataset.analysisTitle || "错题分析"}</strong>
                <span>${data.basis}${stamp ? ` · ${stamp}` : ""}</span>
              </div>
            </div>
            <div class="analysis-actions">
              <button class="ghost-btn compact" type="button" data-analysis-refresh>${icon("refresh-cw")} 重新生成</button>
              <button class="secondary-btn compact" type="button" data-analysis-close>${icon("x")} 收起</button>
            </div>
          </div>
          <div class="analysis-grid">
            <section class="analysis-block">
              <h3>${icon("triangle-alert")} 易错点</h3>
              <ol class="pitfall-list">
                ${data.pitfalls
                  .map(
                    (item) => `
                      <li>
                        <strong>${item.title}</strong>
                        <span>${item.text}</span>
                      </li>
                    `,
                  )
                  .join("")}
              </ol>
            </section>
            <section class="analysis-block">
              <h3>${icon("layers")} 知识点</h3>
              <div class="knowledge-group">
                <label>本题主线</label>
                <div class="chip-row">
                  ${data.knowledge.main.map((label) => `<span class="knowledge-chip main">${label}</span>`).join("")}
                </div>
              </div>
              <div class="knowledge-group">
                <label>前置知识</label>
                <div class="chip-row">
                  ${data.knowledge.pre.map((label) => `<span class="knowledge-chip">${label}</span>`).join("")}
                </div>
              </div>
              <div class="related-list">
                <label>同考点真题</label>
                ${
                  related.length
                    ? related
                        .map(
                          (item) => `
                      <button class="related-item" type="button" title="打开这道真题">
                        <span>${escapeAttr(item)}</span>
                        <small>原卷题号</small>
                        ${icon("arrow-up-right")}
                      </button>
                    `,
                        )
                        .join("")
                    : '<span class="related-empty">暂无入库题号</span>'
                }
              </div>
            </section>
            <section class="analysis-block">
              <h3>${icon("chart-no-axes-column")} 近十年真题考频</h3>
              <div class="freq-summary">
                <div><strong>${heat.total}</strong><span>年 / 10 年</span></div>
                <span class="tag ${heat.tone}">${heat.label}</span>
              </div>
              <div class="freq-metrics">
                <div><span>题量</span><strong>${escapeAttr(data.itemCountText)}</strong></div>
                <div><span>最近年份</span><strong>${data.recent.year}</strong></div>
              </div>
              <div class="freq-strip" role="img" aria-label="2016 至 2025 年共有 ${heat.total} 个年份覆盖该考点">
                ${MISTAKE_DECADE.map(
                  (year) => `
                    <span class="freq-cell ${hitYears.has(year) ? "hit" : ""} ${year === latest ? "latest" : ""}" title="${year} 年${hitYears.has(year) ? "有考点命中" : "无命中"}">
                      <i></i><em>${String(year).slice(2)}</em>
                    </span>
                  `,
                ).join("")}
              </div>
              <div class="freq-recent">
                <label>最近考查 · ${data.recent.year}</label>
                <strong>${escapeAttr(data.recent.headline)}</strong>
                <span>${escapeAttr(data.recent.meta)}</span>
              </div>
              <div class="freq-method">
                <label>统计口径</label>
                <span>${escapeAttr(data.method)}</span>
              </div>
              <div class="freq-source">
                <label>来源</label>
                <a href="${escapeAttr(data.source.url)}" target="_blank" rel="noreferrer">${escapeAttr(data.source.label)}</a>
              </div>
            </section>
          </div>
          <div class="analysis-foot">
            <span class="analysis-note">${icon("info")} 2016 至 2025 原卷统计；按考点年份计入。</span>
            <div class="analysis-foot-actions">
              <button class="secondary-btn compact" type="button" data-analysis-note>${icon("notebook-pen")} 存进笔记</button>
              <button class="primary-btn compact" type="button" data-analysis-review>${icon("calendar-plus")} 加入今日复盘</button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function analysisSkeletonHTML() {
  const blocks = (count) => Array.from({ length: count }, () => '<div class="sk-card"><i></i><i></i></div>').join("");
  return `
    <section class="analysis-block">
      <h3>${icon("triangle-alert")} 易错点</h3>
      <div class="analysis-skeleton">${blocks(3)}</div>
    </section>
    <section class="analysis-block">
      <h3>${icon("layers")} 知识点</h3>
      <div class="analysis-skeleton">
        <span class="sk-line short"></span>
        <div class="sk-chips"><i></i><i></i><i></i></div>
        <span class="sk-line short"></span>
        <div class="sk-chips"><i></i><i></i><i></i></div>
        <span class="sk-line short"></span>
        <div class="sk-card"><i></i><i></i></div>
        <div class="sk-card"><i></i><i></i></div>
      </div>
    </section>
    <section class="analysis-block">
      <h3>${icon("chart-no-axes-column")} 近十年真题考频</h3>
      <div class="analysis-skeleton">
        <div class="sk-card"><i></i></div>
        <div class="sk-card"><i></i><i></i></div>
        <div class="sk-cells">${Array.from({ length: 10 }, () => "<i></i>").join("")}</div>
        <div class="sk-card"><i></i><i></i><i></i></div>
      </div>
    </section>
  `;
}

function toggleAnnotation(button) {
  const id = button.dataset.annotate;
  const existing = document.querySelector(`[data-annotate-panel="${id}"]`);
  document.querySelectorAll("[data-annotate-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analysis-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analyze]").forEach((item) => item.setAttribute("aria-expanded", "false"));
  if (existing) return;
  const row = button.closest("tr");
  if (!row) return;
  row.insertAdjacentHTML("afterend", annotationPanelHTML(button));
  button.setAttribute("aria-expanded", "true");
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  const panel = document.querySelector(`[data-annotate-panel="${id}"]`);
  if (panel) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function toggleAnalysis(button) {
  const id = button.dataset.analyze;
  const existing = document.querySelector(`[data-analysis-panel="${id}"]`);
  document.querySelectorAll("[data-analysis-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analyze]").forEach((item) => item.setAttribute("aria-expanded", "false"));
  if (existing) return;
  document.querySelectorAll("[data-annotate-panel]").forEach((row) => row.remove());
  const row = button.closest("tr");
  if (!row) return;
  row.insertAdjacentHTML("afterend", analysisPanelHTML(button));
  button.setAttribute("aria-expanded", "true");
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  const panel = document.querySelector(`[data-analysis-panel="${id}"]`);
  if (panel) {
    panel.classList.add("is-fresh");
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function refreshAnalysis(button) {
  const panelRow = button.closest("[data-analysis-panel]");
  if (!panelRow) return;
  if (panelRow.dataset.busy === "1") return;
  const id = panelRow.dataset.analysisPanel;
  const sourceButton = document.querySelector(`[data-analyze="${id}"]`);
  if (!sourceButton) return;
  const panel = panelRow.querySelector(".analysis-panel");
  if (!panel) return;
  panelRow.dataset.busy = "1";
  panel.classList.add("is-loading");
  panel.setAttribute("aria-busy", "true");
  const grid = panel.querySelector(".analysis-grid");
  if (grid) grid.innerHTML = analysisSkeletonHTML();
  panel.querySelectorAll(".analysis-foot-actions button").forEach((item) => {
    item.disabled = true;
  });
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle")} 生成中`;
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  window.setTimeout(() => {
    MISTAKE_ANALYSIS_STAMPS[id] = "刚刚重新生成";
    panelRow.insertAdjacentHTML("beforebegin", analysisPanelHTML(sourceButton));
    panelRow.remove();
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
    const nextRow = document.querySelector(`[data-analysis-panel="${id}"]`);
    if (!nextRow) return;
    nextRow.classList.add("is-fresh");
    nextRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 620);
}

function countCellHTML(reviewCount, errorCount) {
  return `
    <div class="count-cell">
      <span><strong>${reviewCount}</strong> 复盘</span>
      <span><strong>${errorCount}</strong> 错误</span>
    </div>
  `;
}

function saveAnnotation(saveButton) {
  const panelRow = saveButton.closest("[data-annotate-panel]");
  if (!panelRow) return;
  const sourceRow = panelRow.previousElementSibling;
  const types = [...panelRow.querySelectorAll("[data-annotate-type].active")].map((button) => button.dataset.annotateType);
  const statusButton = panelRow.querySelector("[data-annotate-status].active");
  const status = statusButton ? statusButton.dataset.annotateStatus : "需加强";
  const reviewInput = panelRow.querySelector("[data-ann-review-count]");
  const errorInput = panelRow.querySelector("[data-ann-error-count]");
  const reviewCount = Math.max(0, Math.round(Number(reviewInput?.value) || 0));
  const errorCount = Math.max(0, Math.round(Number(errorInput?.value) || 0));
  const toneMap = Object.fromEntries(ANNOTATE_TYPES.map((type) => [type.label, type.tone]));
  const statusTone = status === "一直不会" ? "red" : status === "已消灭" ? "green" : status === "正常" ? "blue" : "amber";
  const cell = sourceRow ? sourceRow.querySelector(".annotate-cell") : null;
  if (cell) {
    cell.innerHTML = [
      ...types.map((type) => `<span class="tag ${toneMap[type] || "red"}">${type}</span>`),
      `<span class="tag ${statusTone}">${status}</span>`,
      `<span class="tag green">${icon("check")} 已保存</span>`,
    ].join("");
  }
  const countCell = sourceRow ? sourceRow.querySelector(".count-cell") : null;
  if (countCell) countCell.innerHTML = countCellHTML(reviewCount, errorCount).trim();
  panelRow.remove();
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function applyMistakeFilter(key) {
  document.querySelectorAll("[data-mistake-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mistakeFilter === key);
  });
  document.querySelectorAll("[data-mistake-row]").forEach((row) => {
    const tags = (row.dataset.mistakeTags || "").split(",");
    row.style.display = key === "all" || tags.includes(key) ? "" : "none";
  });
  document.querySelectorAll("[data-annotate-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analysis-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analyze]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function mathChapterMetrics(row, phaseIndex) {
  if (row.length === 4) {
    return { name: row[0], progress: row[1], accuracy: row[2], wrong: row[3] };
  }
  const phaseCount = (row.length - 2) / 2;
  const index = Math.max(0, Math.min(phaseIndex, phaseCount - 1));
  return {
    name: row[0],
    progress: row[1 + index],
    accuracy: row[1 + phaseCount + index],
    wrong: row[row.length - 1],
  };
}

function chapterCell(row, phaseIndex) {
  const chapter = mathChapterMetrics(row, phaseIndex);
  const tone = chapter.progress >= 80 ? "done" : chapter.progress >= 65 ? "active" : chapter.progress >= 50 ? "warn" : "weak";
  return `
    <div class="chapter-cell ${tone}" title="${chapter.name} · 完成 ${chapter.progress}% · 正确率 ${chapter.accuracy}% · 错题 ${chapter.wrong} 题">
      <span class="chapter-name">${chapter.name}</span>
      <span class="chapter-value">${chapter.progress}%</span>
      <span class="chapter-acc">正确 ${chapter.accuracy}% · 错 ${chapter.wrong}</span>
    </div>
  `;
}

function mathKpis(resource) {
  if (resource.kind === "zhenti") {
    return [
      kpiCard({ label: "已做真题", value: "17", unit: "套", sub: "2010–2026 数一 · 近 5 年已二刷", iconName: "layers", accent: "blue", delta: "+2" }),
      kpiCard({ label: "近 5 年平均", value: "113.6", unit: "/150", sub: "2022–2026 数一 · 目标 130", iconName: "chart-line", accent: "violet", delta: "+6.4" }),
      kpiCard({ label: "选填得分率", value: "77.5", unit: "%", sub: "62/80 · 近 3 套平均 60/80", iconName: "list-checks", accent: "green", delta: "+2%" }),
      kpiCard({ label: "解答题得分率", value: "80", unit: "%", sub: "56/70 · 二重积分失分最多", iconName: "pen-line", accent: "red", delta: "-3%", deltaDir: "down" }),
    ].join("");
  }
  return [
    kpiCard({ label: `${resource.tab}进度`, value: resource.bannerValue, unit: `/${resource.total} ${resource.unit || "题"}`, sub: resource.sections.map((section) => `${section.short} ${section.done}`).join(" · "), iconName: "list-checks", accent: resource.tone, delta: `+${resource.weekDone}` }),
    kpiCard({ label: "正确率", value: resource.accuracy, unit: "%", sub: "近 30 天 · 含错题重做", iconName: "target", accent: "green", delta: "+3%" }),
    kpiCard({ label: "待复盘错题", value: resource.wrong, unit: "题", sub: "统一进入错题本，按遗忘曲线复习", iconName: "notebook-tabs", accent: "amber", delta: "-5", deltaDir: "down" }),
    kpiCard({ label: "一直不会", value: resource.never, unit: "题", sub: "连续两次复盘仍无法独立完成", iconName: "circle-alert", accent: "red", delta: "+2" }),
  ].join("");
}

function chapterCard(resource, section, sectionIndex, phaseIndex) {
  return `
    <section class="card card-pad span-7">
      <div class="card-head">
        <div>
          <h2 class="card-title">章节进度与正确率</h2>
          <p class="card-note">左侧切换分册，右上切换篇章；格子显示当前篇完成度，下方为正确率和错题数。</p>
        </div>
        ${resource.phases && resource.phases.length
          ? `<div class="tabs">${resource.phases.map((phase, index) => `<button class="${index === phaseIndex ? "active" : ""}" data-math-phase="${index}">${phase}</button>`).join("")}</div>`
          : `<span class="tag ${resource.tone}">正确率 ${resource.accuracy}%</span>`}
      </div>
      <div class="section-tabs">
        ${resource.sections.map((item, index) => `
          <button class="${index === sectionIndex ? "active" : ""}" data-math-section="${index}">
            <strong>${item.name}</strong>
            <span>${item.done}/${item.total} 题 · 正确率 ${item.accuracy}%</span>
          </button>
        `).join("")}
      </div>
      <div class="chapter-grid resource-grid">
        ${section.chapters.map((row) => chapterCell(row, phaseIndex)).join("")}
      </div>
      <div class="chapter-legend">
        <span><i></i>未开始</span>
        <span><i></i>已完成</span>
        <span><i></i>进行中</span>
        <span><i></i>需复习</span>
        <span><i></i>薄弱</span>
      </div>
    </section>
  `;
}

function zhentiCards(resource) {
  return `
    <section class="card card-pad span-7">
      <div class="card-head">
        <div>
          <h2 class="card-title">真题分卷记录</h2>
          <p class="card-note">数一为主线，数二、数三作为补充卷；点“标注”记录错因和复盘安排。</p>
        </div>
        <div class="tabs">
          <button class="active">数一</button>
          <button>数二</button>
          <button>数三</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>年份</th><th>总分</th><th>选填</th><th>解答题</th><th>错因标注</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${resource.examRows.map((row, index) => `
              <tr>
                <td class="year-cell">${row.year}</td>
                <td class="score ${row.rate >= 80 ? "good" : row.rate >= 72 ? "warn" : "bad"}">${row.total}</td>
                <td>${row.choice}</td>
                <td>${row.solve}</td>
                <td class="annotate-cell">${row.marks.map(([label, tone]) => `<span class="tag ${tone}">${label}</span>`).join("")}</td>
                <td><div class="row-actions">${annotateButton({ id: `${resource.key}-exam-${index}`, ...row.ann })}${editAction(`${row.year} 数学一 ${row.total}`)}</div></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="card card-pad span-5">
      <div class="card-head">
        <div><h2 class="card-title">分模块得分率</h2><p class="card-note">近 5 年数一真题按模块拆分，标出拉分和失分集中区。</p></div>
      </div>
      <div class="data-list">
        ${resource.modules.map(([label, value, tone, status]) => `
          <div class="data-row">
            <span class="label">${label}</span>
            ${progressBar(value, tone)}
            <span class="value">${value}%</span>
            <span class="status tag ${tone}">${status}</span>
          </div>
        `).join("")}
      </div>
      <div class="mini-note">${icon("layers")} 数二、数三只刷数一考纲内的公共部分；近 5 年真题计划 10 月完成二刷。</div>
    </section>
  `;
}

function rankClass(index) {
  return index === 0 ? "rank-1" : index === 1 ? "rank-2" : index === 2 ? "rank-3" : "";
}

function categoryLeaderboardCard(spanClass = "span-5") {
  const total = ANNOTATE_TYPES.reduce((sum, type) => sum + type.count, 0);
  const max = Math.max(...ANNOTATE_TYPES.map((type) => type.count));
  return `
    <section class="card card-pad ${spanClass}">
      <div class="card-head">
        <div>
          <h2 class="card-title">错题分类排行榜</h2>
          <p class="card-note">按题目数量排序，同时累计错误次数和复盘次数。</p>
        </div>
        <span class="tag red">${total} 题</span>
      </div>
      <div class="rank-list">
        ${ANNOTATE_TYPES.map((type, index) => `
          <div class="rank-row category-row">
            <span class="rank-no ${rankClass(index)}">${String(index + 1).padStart(2, "0")}</span>
            <div class="rank-main">
              <div class="rank-title">
                <strong>${type.label}</strong>
                <span class="tag ${type.tone}">${type.count} 题</span>
              </div>
              <div class="rank-meta">累计错误 ${type.errorCount} 次 · 复盘 ${type.reviewCount} 次</div>
              ${progressBar(Math.round((type.count / max) * 100), type.tone)}
              <div class="rank-meta">${type.mix}</div>
            </div>
            <div class="rank-value">${type.errorCount}<small>错误</small></div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function overallLeaderboardCard() {
  const activeKey = MISTAKE_BOARD_DATA[state.mistakeBoard] ? state.mistakeBoard : "math";
  const activeTab = MISTAKE_BOARD_TABS.find((tab) => tab.key === activeKey) || MISTAKE_BOARD_TABS[0];
  const rows = MISTAKE_BOARD_DATA[activeKey] || MISTAKE_BOARD_DATA.math;
  return `
    <section class="card card-pad span-7">
      <div class="card-head">
        <div>
          <h2 class="card-title">错题总榜 · ${activeTab.label}</h2>
          <p class="card-note">按错误次数排名，次数相同再比较复盘次数；切换科目查看高频错题。</p>
        </div>
        <div class="segmented compact board-tabs">
          ${MISTAKE_BOARD_TABS.map((tab) => `
            <button class="${tab.key === activeKey ? "active" : ""}" type="button" data-mistake-board="${tab.key}">${tab.label} ${tab.total}</button>
          `).join("")}
        </div>
      </div>
      <div class="rank-list">
        ${rows.map((item, index) => `
          <div class="rank-row board-row">
            <span class="rank-no ${rankClass(index)}">${String(index + 1).padStart(2, "0")}</span>
            <div class="rank-main">
              <div class="rank-title">
                <strong>${item.title}</strong>
                <span class="tag ${item.tone}">${item.status}</span>
              </div>
              <div class="rank-meta">${item.source} · 下次复盘 ${item.next}</div>
            </div>
            <div class="rank-stats">
              <span class="rank-stat"><strong>${item.errorCount}</strong><small>错误</small></span>
              <span class="rank-stat"><strong>${item.reviewCount}</strong><small>复盘</small></span>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="mini-note">${icon("trophy")} 总榜只统计已进入错题本的题目；连续错误会优先排进今日复盘。</div>
    </section>
  `;
}

function annotationStatsCard(spanClass = "span-5") {
  const total = ANNOTATE_TYPES.reduce((sum, type) => sum + type.count, 0);
  const max = Math.max(...ANNOTATE_TYPES.map((type) => type.count));
  return `
    <section class="card card-pad ${spanClass}">
      <div class="card-head">
        <div>
          <h2 class="card-title">错题标注分布</h2>
          <p class="card-note">每道错题可多选错误类型，再单独标记掌握状态。</p>
        </div>
        <span class="tag red">${total} 次标注</span>
      </div>
      <div class="data-list">
        ${ANNOTATE_TYPES.map((type) => `
          <div class="data-row">
            <span class="label">${type.label}</span>
            ${progressBar(Math.round((type.count / max) * 100), type.tone)}
            <span class="value">${type.count} 题</span>
            <span class="status tag ${type.tone}">${type.hint}</span>
          </div>
        `).join("")}
      </div>
      <div class="action-list">
        <div class="action-item"><span class="tag red">概念不清 · 12 题</span><span>回看定义与定理条件，再做 10 道同考点题</span></div>
        <div class="action-item"><span class="tag amber">计算错误 · 9 题</span><span>限时计算训练，每题写出关键步骤</span></div>
      </div>
      <div class="mini-note">${icon("tag")} 在记录或错题本里点“标注”，可记录错因、卡点和下次复盘时间。</div>
    </section>
  `;
}

function recentRecordsCard(resource, spanClass = "span-12") {
  return `
    <section class="card card-pad ${spanClass}">
      <div class="card-head">
        <div>
          <h2 class="card-title">最近${resource.tab}记录</h2>
          <p class="card-note">一条记录同时更新资料进度、章节正确率、错题标注和总成绩。</p>
        </div>
        <div class="head-actions">
          <button class="secondary-btn">${icon("download")} 导出 CSV</button>
          <button class="secondary-btn" data-open-entry="create">${icon("plus")} 新增记录</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>日期</th><th>${resource.kind === "zhenti" ? "卷种" : "篇"}</th><th>章节 / 卷面</th><th>得分</th><th>正确率</th><th>用时</th><th>错题标注</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${resource.records.map((record, index) => `
              <tr>
                <td>${record.date}</td>
                <td><span class="tag">${record.part}</span></td>
                <td>${record.chapter}</td>
                <td class="score ${record.rate >= 80 ? "good" : record.rate >= 65 ? "warn" : "bad"}">${record.score}</td>
                <td>${record.rate}%</td>
                <td>${record.time}</td>
                <td class="annotate-cell">${record.marks.map(([label, tone]) => `<span class="tag ${tone}">${label}</span>`).join("")}</td>
                <td>
                  <div class="row-actions">
                    ${annotateButton({ id: `${resource.key}-rec-${index}`, ...record.ann })}
                    ${editAction(`${record.date} · ${resource.tab} · ${record.chapter} · ${record.score}`)}
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function neverCard(resource) {
  return `
    <section class="card card-pad span-12">
      <div class="card-head">
        <div>
          <h2 class="card-title">一直不会的题</h2>
          <p class="card-note">不是普通错题，而是连续两次复盘仍无法独立做出的题；会自动提高复盘频率并优先排进计划。</p>
        </div>
        <button class="secondary-btn" data-screen="mistakes">${icon("arrow-right")} 打开错题本</button>
      </div>
      <div class="review-list four">
        ${resource.neverItems.map((item, index) => reviewItem(item.index || String(index + 1).padStart(2, "0"), item.title, item.meta, item.tone)).join("")}
      </div>
    </section>
  `;
}

function renderMath() {
  const resource = MATH_RESOURCES[state.mathResource] || MATH_RESOURCES["1000"];
  const [resourceColor, resourceSoft] = accentMap[resource.tone] || accentMap.blue;
  const isZhenti = resource.kind === "zhenti";
  const sections = resource.sections || [];
  const sectionIndex = sections.length ? Math.max(0, Math.min(state.mathSection, sections.length - 1)) : 0;
  const section = sections[sectionIndex];
  const phaseCount = resource.phases && resource.phases.length ? resource.phases.length : 1;
  const phaseIndex = Math.max(0, Math.min(state.mathPhase, phaseCount - 1));

  return `
    <div class="page-head">
      <div>
        <h1>数学一</h1>
        <p class="page-desc">按资料分册、篇章、考点和单题标注四条线记录；数学二、数学三真题作为补充训练。</p>
      </div>
      <div class="head-actions">
        <div class="segmented">
          ${MATH_RESOURCE_ORDER.map((key) => {
            const item = MATH_RESOURCES[key];
            return `<button class="${key === resource.key ? "active" : ""}" data-math-resource="${key}">${item.tab}</button>`;
          }).join("")}
        </div>
        <button class="primary-btn" data-open-entry="create">${icon("plus")} 录入数学成绩</button>
      </div>
    </div>

    <section class="card resource-banner" style="--res-color:${resourceColor};--res-soft:${resourceSoft}">
      <div class="resource-icon">${icon(resource.icon)}</div>
      <div class="resource-info">
        <div class="resource-title-row">
          <h2>${resource.title}</h2>
          <span class="tag ${resource.tone}">数学一</span>
          <span class="tag">${resource.meta}</span>
        </div>
        <p>${resource.note}</p>
      </div>
      <div class="resource-progress">
        <div class="resource-progress-top">
          <strong>${resource.bannerValue}</strong>
          <span>${resource.bannerUnit}</span>
          <em>${resource.bannerPercent}%</em>
        </div>
        ${progressBar(resource.bannerPercent, resource.tone)}
        <div class="resource-progress-foot"><span>${resource.bannerFoot[0]}</span><span>${resource.bannerFoot[1]}</span></div>
      </div>
    </section>

    <div class="kpi-grid">${mathKpis(resource)}</div>

    <div class="grid">
      ${isZhenti
        ? `${zhentiCards(resource)}${annotationStatsCard("span-5")}${recentRecordsCard(resource, "span-7")}`
        : `${chapterCard(resource, section, sectionIndex, phaseIndex)}${annotationStatsCard("span-5")}${recentRecordsCard(resource, "span-12")}`}
      ${neverCard(resource)}
    </div>
  `;
}

function renderMistakes() {
  return `
    <div class="page-head">
      <div>
        <h1>不会题 / 错题本</h1>
        <p class="page-desc">数学、英语、408 的错题统一管理；每题都能标注错误类型、复盘次数、错误次数和下次复习时间。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn">${icon("filter")} 高级筛选</button>
        <button class="primary-btn" data-open-entry="create">${icon("plus")} 新增错题</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({ label: "待复盘", value: "31", unit: "题", sub: "今天到期 6 题 · 高优先 3 题", iconName: "notebook-tabs", accent: "blue", delta: "-5", deltaDir: "down" })}
      ${kpiCard({ label: "一直不会", value: "11", unit: "题", sub: "连续两次复盘仍未独立完成", iconName: "circle-alert", accent: "red", delta: "+2" })}
      ${kpiCard({ label: "平均错误次数", value: "2.1", unit: "次", sub: "平均复盘 2.4 次 · 数学最高", iconName: "repeat-2", accent: "amber" })}
      ${kpiCard({ label: "近 7 天已消灭", value: "14", unit: "题", sub: "复盘后可独立做对", iconName: "check-check", accent: "green", delta: "+6" })}
    </div>

    <div class="filter-row">
      <button class="filter-chip active" data-mistake-filter="all">全部 31</button>
      <button class="filter-chip" data-mistake-filter="never">一直不会 11</button>
      <button class="filter-chip" data-mistake-filter="today">今天到期 6</button>
      <button class="filter-chip" data-mistake-filter="math">数学 18</button>
      <button class="filter-chip" data-mistake-filter="408">408 13</button>
      <button class="filter-chip" data-mistake-filter="english">英语 7</button>
      <span class="filter-sep"></span>
      <button class="filter-chip" data-mistake-filter="annotated">已标注 22</button>
    </div>

    <div class="grid">
      ${categoryLeaderboardCard("span-5")}
      ${overallLeaderboardCard()}
    </div>

    <div class="grid">
      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">逐题错题汇总</h2>
            <p class="card-note">点“AI 分析”查看易错点、知识点和近十年真题考频；点“标注”记录错因、复盘安排；两类面板都需要手动展开。</p>
          </div>
          <span class="tag blue">按下次复盘时间排序</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>来源</th><th>题目</th><th>考点</th><th>错误类型</th><th>掌握状态</th><th>下次复盘</th><th>复盘 / 错误</th><th>笔记摘要</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${MISTAKE_ROWS.map((row, index) => `
                <tr data-mistake-row data-mistake-tags="${row.tags}">
                  <td>${row.source}</td>
                  <td><span class="question-no">${row.question}</span></td>
                  <td>${row.point}</td>
                  <td class="annotate-cell">${row.types.map(([label, tone]) => `<span class="tag ${tone}">${label}</span>`).join("")}</td>
                  <td><span class="tag ${row.statusTone}">${row.status}</span></td>
                  <td>${row.next}</td>
                  <td>${countCellHTML(row.reviewCount, row.errorCount)}</td>
                  <td class="note-cell" title="${escapeAttr(row.note)}">${row.note}</td>
                  <td><div class="row-actions">${analysisButton({ id: `mistake-${index}`, title: row.ann.title })}${annotateButton({ id: `mistake-${index}`, ...row.ann, reviewCount: row.reviewCount, errorCount: row.errorCount })}${editAction(`${row.source} ${row.question} ${row.point}`)}</div></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card card-pad span-6">
        <div class="card-head">
          <div><h2 class="card-title">错因 → 行动建议</h2><p class="card-note">根据标注自动生成下周专项训练。</p></div>
        </div>
        <div class="recommend-stack">
          <div class="recommend-item">
            <span class="tag red">概念不清 · 12 题</span>
            <p>回看定义与定理条件，再做 10 道同考点题</p>
            <span>优先：无穷级数、多维随机变量</span>
          </div>
          <div class="recommend-item">
            <span class="tag amber">计算错误 · 9 题</span>
            <p>限时计算训练，每题写出关键步骤</p>
            <span>每次 20 分钟 · 连做 5 天</span>
          </div>
          <div class="recommend-item">
            <span class="tag blue">审题错误 · 6 题</span>
            <p>读题时圈关键词、写已知和所求</p>
            <span>做完先检查条件是否用全</span>
          </div>
        </div>
      </section>

      <section class="card card-pad span-6">
        <div class="card-head">
          <div><h2 class="card-title">今日复盘队列</h2><p class="card-note">按遗忘曲线排序，完成后自动安排下次。</p></div>
          <span class="tag red">6 题</span>
        </div>
        <div class="review-list">
          ${reviewItem("01", "二重积分换序 · 1000题 第 12 章 14 题", "概念不清 · 错误 3 次 · 高优先", "red")}
          ${reviewItem("02", "Cache 映射计算 · 王道组成原理", "概念不清 + 计算错误 · 错误 2 次", "amber")}
          ${reviewItem("03", "无穷级数敛散性 · 660 第 8 章 21 题", "计算错误 · 复盘后重做 5 题", "blue")}
          ${reviewItem("04", "2024 408 真题 · 第 45 题", "内存管理 · 对照错因笔记复盘", "green")}
        </div>
      </section>
    </div>
  `;
}

function render408() {
  const books = [
    ["数据结构", 78, "green", "8 章 · 286/368 题", "books", "var(--green)", "var(--green-soft)"],
    ["计算机组成原理", 61, "red", "7 章 · 198/326 题", "cpu", "var(--red)", "var(--red-soft)"],
    ["操作系统", 69, "blue", "6 章 · 205/298 题", "monitor-cog", "var(--blue)", "var(--blue-soft)"],
    ["计算机网络", 74, "amber", "6 章 · 221/300 题", "network", "var(--amber)", "var(--amber-soft)"],
  ];
  const chapterNames = [
    "绪论", "线性表", "栈队列", "串", "树", "图", "查找", "排序",
    "系统概述", "数据表示", "存储系统", "指令系统", "CPU", "总线", "IO",
    "概述", "进程", "内存", "文件", "IO", "死锁",
    "体系结构", "物理层", "数据链路", "网络层", "传输层", "应用层",
  ];
  return `
    <div class="page-head">
      <div>
        <h1>408 计算机学科专业基础</h1>
        <p class="page-desc">王道四本书课后题 + 历年真题；按章节、题型和真题年份三层记录。</p>
      </div>
      <div class="head-actions">
        <div class="segmented">
          <button class="active">王道课后题</button>
          <button>历年真题</button>
        </div>
        <button class="primary-btn">${icon("plus")} 录入 408 成绩</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({ label: "四本书总进度", value: "71", unit: "%", sub: "910 / 1292 题 · 本月 +126 题", iconName: "library-big", accent: "blue", delta: "+6%" })}
      ${kpiCard({ label: "真题平均分", value: "104", unit: "/150", sub: "近 5 年 · 选择题 58/80", iconName: "file-check-2", accent: "violet", delta: "+7" })}
      ${kpiCard({ label: "选择题正确率", value: "74", unit: "%", sub: "近 30 天 · 正确 186 / 251", iconName: "list-checks", accent: "green", delta: "+3%" })}
      ${kpiCard({ label: "大题得分率", value: "61", unit: "%", sub: "近 5 年 · 薄弱在组成原理", iconName: "pen-line", accent: "red", delta: "+2%" })}
    </div>

    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">王道四本书进度</h2>
            <p class="card-note">进度、正确率、错题数分别记录，不把“看过”当成“会做”。</p>
          </div>
          <span class="tag blue">本周计划 126 题</span>
        </div>
        <div class="book-grid">
          ${books
            .map(
              ([name, value, tone, meta, iconName, color, soft]) => `
                <article class="book-card" style="--book-color:${color};--book-soft:${soft}">
                  <div class="book-top">
                    <span class="book-icon">${icon(iconName)}</span>
                    <div>
                      <p class="book-name">${name}</p>
                      <p class="book-meta">${meta}</p>
                    </div>
                    <span class="book-score">${value}%</span>
                  </div>
                  ${progressBar(value, tone)}
                  <div class="book-foot"><span>正确率 ${value - 3}%</span><span>${value < 65 ? "需重点补强" : "节奏正常"}</span></div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">模块得分率</h2>
            <p class="card-note">按真题大题和选择题拆分后的综合得分率。</p>
          </div>
        </div>
        <div class="data-list">
          ${[
            ["数据结构", 78, "green", "78%"],
            ["计算机组成原理", 61, "red", "61%"],
            ["操作系统", 69, "blue", "69%"],
            ["计算机网络", 74, "amber", "74%"],
          ]
            .map(
              ([label, value, tone, text]) => `
                <div class="data-row">
                  <span class="label">${label}</span>
                  ${progressBar(value, tone)}
                  <span class="value">${text}</span>
                  <span class="status tag ${tone}">${value < 65 ? "需补强" : "稳定"}</span>
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="mini-note">${icon("crosshair")} 组成原理的 Cache、虚存、流水线是当前最高优先项。</div>
      </section>

      <section class="card card-pad span-8">
        <div class="card-head">
          <div>
            <h2 class="card-title">章节完成热力图</h2>
            <p class="card-note">按王道四本书的章节顺序排列；颜色代表完成度。</p>
          </div>
          <div class="tabs">
            <button class="active">完成度</button>
            <button>正确率</button>
          </div>
        </div>
        <div class="chapter-grid wide">
          ${chapterNames
            .map((name, index) => {
              const value = ((index * 13 + 41) % 62) + 38;
              const tone = value >= 82 ? "done" : value >= 65 ? "active" : value >= 52 ? "warn" : "weak";
              return `<div class="chapter-cell ${tone}"><span class="chapter-name">${name}</span><span class="chapter-value">${value}%</span></div>`;
            })
            .join("")}
        </div>
        <div class="chapter-legend">
          <span><i></i>未开始</span>
          <span><i></i>已完成</span>
          <span><i></i>进行中</span>
          <span><i></i>需复习</span>
          <span><i></i>薄弱</span>
        </div>
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">真题记录</h2>
            <p class="card-note">最近 5 年 408 真题得分。</p>
          </div>
          <span class="tag green">趋势 +7</span>
        </div>
        <div class="review-list">
          ${reviewItem("26", "2026 408 真题", "112/150 · 选择题 64 · 大题 48", "green")}
          ${reviewItem("25", "2025 408 真题", "108/150 · 选择题 62 · 大题 46", "green")}
          ${reviewItem("24", "2024 408 真题", "99/150 · 选择题 58 · 大题 41", "amber")}
          ${reviewItem("23", "2023 408 真题", "104/150 · 选择题 60 · 大题 44", "blue")}
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">最近 408 记录</h2>
            <p class="card-note">课后题和真题分开统计，但共用同一套错题与复盘系统。</p>
          </div>
          <button class="secondary-btn">${icon("download")} 导出 CSV</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>日期</th><th>来源</th><th>章节 / 年份</th><th>选择题</th><th>大题</th><th>总分 / 进度</th><th>薄弱点</th></tr>
            </thead>
            <tbody>
              <tr><td>2026-09-27</td><td>王道课后题</td><td>组成原理 · Cache</td><td>9/12</td><td>4/8</td><td class="score warn">72%</td><td>地址映射计算</td></tr>
              <tr><td>2026-09-26</td><td>王道课后题</td><td>操作系统 · 内存管理</td><td>11/12</td><td>6/8</td><td class="score good">85%</td><td>页面置换算法</td></tr>
              <tr><td>2026-09-25</td><td>408 真题</td><td>2025 真题</td><td>62/80</td><td>46/70</td><td class="score">108/150</td><td>组成原理大题</td></tr>
              <tr><td>2026-09-24</td><td>王道课后题</td><td>数据结构 · 图</td><td>10/12</td><td>7/8</td><td class="score good">85%</td><td>最短路径</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderPlan() {
  const phases = [
    ["基础阶段", "2026.09 – 2027.02", "数学教材 + 1000题第一轮；408 王道四本书第一轮；英语单词 + 长难句。", "done"],
    ["强化阶段", "2027.03 – 2027.08", "数学 660/880/新东方1000题；408 第二轮 + 真题选择题；英语阅读真题精读。", "active"],
    ["真题阶段", "2027.09 – 2027.11", "数学数一/二/三真题；408 历年真题；英语套卷 + 写作模板；每周一次模拟。", ""],
    ["冲刺阶段", "2027.12", "全真模拟、错题最后一轮、作文背诵、政治冲刺；按考试时间作息。", ""],
  ];
  return `
    <div class="page-head">
      <div>
        <h1>学习计划与目标</h1>
        <p class="page-desc">把“目标学校”倒推成每日进度、明日计划和一周计划；推荐计划会随着正确率和遗忘曲线动态调整。</p>
      </div>
      <div class="head-actions">
        <div class="segmented">
          <button class="active">日 / 周计划</button>
          <button>阶段路线</button>
          <button>推荐计划</button>
        </div>
        <button class="primary-btn">${icon("wand-sparkles")} 生成推荐计划</button>
      </div>
    </div>

    <section class="card goal-hero">
      <div class="goal-main">
        <span class="tag red">${icon("target")} 目标院校</span>
        <h2>中国科学技术大学 · 计算机专硕</h2>
        <p>2028 考研 · 目标总分 390/500 · 计划可根据实际进度自动重新排程</p>
      </div>
      <div class="goal-stats">
        <div class="goal-stat"><strong>${daysLeft}</strong><span>距初试天数</span></div>
        <div class="goal-stat"><strong>7</strong><span>本周待完成任务</span></div>
        <div class="goal-stat"><strong>73%</strong><span>本周计划完成率</span></div>
      </div>
    </section>

    <div class="grid">
      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">今日进度</h2>
            <p class="card-note">${todayText} · 当前 4h 12m / 目标 6h 30m</p>
          </div>
          <span class="tag green">连续 18 天</span>
        </div>
        <div class="ring-layout">
          <div class="ring" style="--p:65">
            <div class="ring-center"><strong>65%</strong><span>今日完成</span></div>
          </div>
          <div class="task-list">
            ${taskItem("英语阅读 + 长难句", "已完成 · 2 篇 / 42 分钟", true)}
            ${taskItem("数学 1000题 第 8 章", "已完成 · 20 题 / 70%", true)}
            ${taskItem("408 组成原理 Cache", "已完成 · 18 题 / 72%", true)}
            ${taskItem("错题复盘 6 题", "未完成 · 预计 30 分钟", false)}
          </div>
        </div>
      </section>

      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">明日计划</h2>
            <p class="card-note">2026-09-28 · 周一 · 6h 20m；可拖动任务、调整顺序或一键接受推荐。</p>
          </div>
          <div class="head-actions">
            <button class="secondary-btn">${icon("wand-sparkles")} 按推荐填充</button>
            <button class="icon-btn" aria-label="更多">${icon("ellipsis")}</button>
          </div>
        </div>
        <div class="plan-list">
          ${planItem("数学 1000题 · 第 9 章 · 20 题", "08:30–10:00 · 重点补强无穷级数相关章节", "重点", "red")}
          ${planItem("408 组成原理 · Cache / 虚存", "10:15–11:45 · 王道课后题 20 题 + 复盘", "重点", "amber")}
          ${planItem("英语一 · 2019 Text 2 精读", "14:00–15:30 · 逐句翻译 + 生词 18 个", "常规", "blue")}
          ${planItem("660 · 第 3 章错题复盘", "16:00–17:00 · 12 道错题，要求独立重做", "复盘", "green")}
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">一周计划</h2>
            <p class="card-note">每周固定留出半天机动时间；推荐计划会把薄弱模块自动插入下一天。</p>
          </div>
          <div class="tabs">
            <button class="active">本周</button>
            <button>下周草稿</button>
          </div>
        </div>
        <div class="week-board">
          ${[
            ["周一", "数学 1000题\n第 9 章", "6.5h", 100, "已完成"],
            ["周二", "408 组成原理\nCache + 虚存", "6.0h", 100, "已完成"],
            ["周三", "英语二真题\n阅读 + 完形", "5.5h", 100, "已完成"],
            ["周四", "数学 660\n错题复盘", "5.5h", 100, "已完成"],
            ["周五", "王道 OS\n内存管理", "6.0h", 60, "进行中"],
            ["周六", "数学一模拟\n+ 408 选择题", "7.5h", 0, "未开始"],
            ["周日", "周复盘\n下周计划", "4.0h", 0, "未开始"],
          ]
            .map(
              ([day, focus, hours, value, status]) => `
                <div class="day-card large">
                  <div class="day-top"><strong>${day}</strong><span>${status}</span></div>
                  <p>${focus.replace("\n", "<br />")}</p>
                  <div class="day-hours">${icon("clock-3")} ${hours}</div>
                  ${progressBar(value, value === 100 ? "green" : value > 0 ? "blue" : "")}
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">推荐学习路线</h2>
            <p class="card-note">按 2027-12-25 初试倒推；目标、科目权重和实际正确率变化后自动重排。</p>
          </div>
          <span class="tag blue">倒推计划 · 可手动调整</span>
        </div>
        <div class="phase-timeline">
          ${phases
            .map(
              ([name, time, description, status]) => `
                <div class="phase ${status}">
                  <div class="phase-head"><strong>${name}</strong><span>${time}</span></div>
                  <p>${description}</p>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderGoal() {
  return `
    <div class="page-head">
      <div>
        <h1>目标与倒计时</h1>
        <p class="page-desc">目标学校和考试日期可修改；所有计划都从这个日期倒推。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn">${icon("pencil-line")} 修改目标</button>
      </div>
    </div>

    <section class="card goal-hero">
      <div class="goal-main">
        <span class="tag red">${icon("graduation-cap")} 2028 考研</span>
        <h2>中国科学技术大学 · 计算机专硕</h2>
        <p>当前目标总分 390/500；初试日期按 2027-12-25 预计，可在设置中改为官方公布日期。</p>
      </div>
      <div class="goal-stats">
        <div class="goal-stat"><strong>${daysLeft}</strong><span>距初试</span></div>
        <div class="goal-stat"><strong>390</strong><span>目标总分</span></div>
        <div class="goal-stat"><strong>302</strong><span>当前三科总分</span></div>
      </div>
    </section>

    <div class="grid">
      <section class="card card-pad span-6">
        <div class="card-head">
          <div><h2 class="card-title">目标分数</h2><p class="card-note">每一项都可以手动修改，系统按目标差值计算每日任务量。</p></div>
        </div>
        <div class="goal-score-grid">
          ${[
            ["政治", "70", "/100", "可选模块"],
            ["英语一", "75", "/100", "当前 68"],
            ["数学一", "130", "/150", "当前 122"],
            ["408", "115", "/150", "当前 112"],
          ]
            .map(
              ([name, value, total, note]) => `
                <div class="goal-score">
                  <span>${name}</span>
                  <strong>${value}<small>${total}</small></strong>
                  <em>${note}</em>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
      <section class="card card-pad span-6">
        <div class="card-head">
          <div><h2 class="card-title">关键里程碑</h2><p class="card-note">用阶段检查点防止“每天都在学，但不知道自己走到哪”。</p></div>
        </div>
        <div class="review-list">
          ${reviewItem("1", "数学一 1000题第一轮完成", "目标 2027-02-28 · 当前 61.2%", "blue")}
          ${reviewItem("2", "408 王道四本书第一轮完成", "目标 2027-03-31 · 当前 71%", "green")}
          ${reviewItem("3", "英语一近 15 年真题阅读完成", "目标 2027-08-31 · 当前 8/15 年", "amber")}
          ${reviewItem("4", "数学一/408 全真模拟稳定达标", "目标 2027-11-30 · 尚未开始", "red")}
        </div>
      </section>
    </div>
  `;
}

function renderData() {
  return `
    <div class="page-head">
      <div>
        <h1>数据与备份</h1>
        <p class="page-desc">长期保存优先：本地数据库为主，服务器自动备份；支持导出和迁移。</p>
      </div>
      <div class="head-actions"><button class="primary-btn">${icon("database-backup")} 立即备份</button></div>
    </div>
    <div class="kpi-grid">
      ${kpiCard({ label: "最近备份", value: "21:36", unit: "", sub: "今天 · 自动备份成功", iconName: "cloud-check", accent: "green" })}
      ${kpiCard({ label: "数据记录", value: "1,284", unit: "条", sub: "成绩 / 题记录 / 计划", iconName: "database", accent: "blue" })}
      ${kpiCard({ label: "附件与截图", value: "86", unit: "个", sub: "错题截图与作文批改", iconName: "image", accent: "violet" })}
      ${kpiCard({ label: "存储占用", value: "42", unit: "MB", sub: "服务器剩余 48 GB", iconName: "hard-drive", accent: "amber" })}
    </div>
    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head"><div><h2 class="card-title">备份策略</h2><p class="card-note">默认每天 21:30 自动备份，保留 30 天；数据库和附件分开存储。</p></div></div>
        <div class="review-list">
          ${reviewItem("日", "每日自动备份", "保留 30 天 · 当前正常", "green")}
          ${reviewItem("周", "每周完整快照", "保留 12 周 · 可一键恢复", "blue")}
          ${reviewItem("月", "每月归档", "保留 24 个月 · 可导出到本地", "violet")}
        </div>
      </section>
      <section class="card card-pad span-5">
        <div class="card-head"><div><h2 class="card-title">导出与迁移</h2><p class="card-note">数据始终属于你，不锁在平台里。</p></div></div>
        <div class="plan-list">
          ${planItem("导出全部数据（JSON）", "包含成绩、计划、错题和设置", "推荐", "blue")}
          ${planItem("导出成绩表（CSV）", "适合 Excel / WPS 分析", "表格", "green")}
          ${planItem("导入备份", "从 JSON 恢复全部历史数据", "迁移", "amber")}
        </div>
      </section>
    </div>
  `;
}

const screens = {
  dashboard: { title: "总览", render: renderDashboard },
  summary: { title: "成绩汇总", render: renderSummary },
  plan: { title: "学习计划", render: renderPlan },
  english: { title: "英语一 / 二", render: renderEnglish },
  math: { title: "数学一", render: renderMath },
  cs408: { title: "408", render: render408 },
  mistakes: { title: "不会题 / 错题本", render: renderMistakes },
  goal: { title: "目标与倒计时", render: renderGoal },
  data: { title: "数据与备份", render: renderData },
};

function render() {
  const screen = screens[state.screen] || screens.dashboard;
  document.getElementById("crumb-current").textContent = screen.title;
  document.getElementById("app").innerHTML = screen.render();
  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === state.screen);
  });
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  }
  window.__ready = true;
}

const entryModal = document.getElementById("entry-modal");
const entryTitle = document.getElementById("entry-title");
const editBannerText = document.getElementById("edit-banner-text");
const entryModeTabs = document.getElementById("entry-mode-tabs");
const saveEntryLabel = document.querySelector("#save-entry span");
const entrySubject = document.getElementById("entry-subject");
const entrySource = document.getElementById("entry-source");
const entryPaperType = document.getElementById("entry-paper-type");
const entryModule = document.getElementById("entry-module");
const entryQuestion = document.getElementById("entry-question");
const entryFull = document.getElementById("entry-full");
const entryScore = document.getElementById("entry-score");
const entryLost = document.getElementById("entry-lost");

const ENTRY_OPTIONS = {
  "数学一": {
    sources: ["数学一真题", "1000题", "660", "880", "新东方1000题", "数学二真题", "数学三真题"],
    papers: ["数学一", "数学二", "数学三"],
    modules: [
      "高等数学 · 多元函数微分学",
      "高等数学 · 无穷级数",
      "高等数学 · 二重积分",
      "线性代数 · 特征值与特征向量",
      "概率论 · 多维随机变量",
    ],
  },
  "英语一": {
    sources: ["英语一真题", "英语二真题"],
    papers: ["英语一", "英语二"],
    modules: ["英语阅读 Part A", "英语完形", "英语新题型", "英语翻译", "英语写作"],
  },
  "英语二": {
    sources: ["英语二真题", "英语一真题"],
    papers: ["英语二", "英语一"],
    modules: ["英语阅读 Part A", "英语完形", "英语新题型", "英语翻译", "英语写作"],
  },
  "408": {
    sources: ["王道课后题", "408真题"],
    papers: ["408"],
    modules: [
      "王道 · 数据结构",
      "王道 · 计算机组成原理",
      "王道 · 操作系统",
      "王道 · 计算机网络",
      "408 真题",
    ],
  },
};

function setSelectOptions(select, values, preferredValue) {
  select.innerHTML = values.map((value) => `<option>${value}</option>`).join("");
  if (values.includes(preferredValue)) select.value = preferredValue;
}

function syncEntryOptions() {
  const options = ENTRY_OPTIONS[entrySubject.value] || ENTRY_OPTIONS["数学一"];
  setSelectOptions(entrySource, options.sources, entrySource.value);
  setSelectOptions(entryPaperType, options.papers, entryPaperType.value);
  setSelectOptions(entryModule, options.modules, entryModule.value);
}

function updateLostScore() {
  const full = Number(entryFull.value) || 0;
  const score = Number(entryScore.value) || 0;
  const lost = Math.max(0, full - score);
  entryLost.value = Number.isInteger(lost) ? String(lost) : lost.toFixed(1);
}

function setEntryMode(mode = "create", description = "") {
  state.entryMode = mode === "edit" ? "edit" : "create";
  const editing = state.entryMode === "edit";
  document.body.classList.toggle("entry-edit", editing);
  entryModeTabs.querySelectorAll("[data-entry-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.entryMode === state.entryMode);
  });
  entryTitle.textContent = editing ? "编辑成绩与进度" : "录入成绩与进度";
  saveEntryLabel.textContent = editing ? "保存修改" : "保存记录";
  editBannerText.textContent = description || "数学一 · 2026 数学一真题 · 第 12 题";
}

function openEntry(mode = "create", description = "") {
  setEntryMode(mode, description);
  syncEntryOptions();
  updateLostScore();
  document.body.classList.add("entry-open");
}

function closeEntry() {
  document.body.classList.remove("entry-open");
}

function editEntry(description) {
  openEntry("edit", description);
  if (description.includes("英语一")) entrySubject.value = "英语一";
  else if (description.includes("英语二")) entrySubject.value = "英语二";
  else if (description.includes("408")) entrySubject.value = "408";
  else entrySubject.value = "数学一";
  syncEntryOptions();

  const yearMatch = description.match(/(20\d{2})/);
  if (yearMatch && [...document.getElementById("entry-year").options].some((option) => option.value === yearMatch[1])) {
    document.getElementById("entry-year").value = yearMatch[1];
  }
  if (description.includes("王道")) entrySource.value = "王道课后题";
  else if (entrySubject.value === "408") entrySource.value = "408真题";
  else if (entrySubject.value.startsWith("英语")) entrySource.value = `${entrySubject.value}真题`;
  else entrySource.value = "数学一真题";

  if (description.includes("无穷级数") && entrySubject.value === "数学一") entryModule.value = "高等数学 · 无穷级数";
  if (description.includes("多元函数") && entrySubject.value === "数学一") entryModule.value = "高等数学 · 多元函数微分学";
  if (description.includes("Cache")) entryModule.value = "王道 · 计算机组成原理";
  if (description.includes("内存管理")) entryModule.value = "王道 · 操作系统";

  const match = description.match(/(第\s*\d+\s*题|Text\s*\d+\s*第\s*\d+\s*题|完形\s*第\s*\d+\s*题|翻译\s*第\s*\d+\s*题)/i);
  entryQuestion.value = match ? match[0] : description;
  entryFull.value = entrySubject.value.startsWith("英语") ? "2" : "10";
  entryScore.value = description.includes("2025") ? "6" : description.includes("2024") ? "5" : "4";
  updateLostScore();
}

function setPanelOption(button, attribute) {
  const panel = button.closest("[data-annotate-panel]");
  if (!panel) return;
  panel.querySelectorAll(`[${attribute}].active`).forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}

document.addEventListener("click", (event) => {
  const screenButton = event.target.closest("[data-screen]");
  if (screenButton) {
    state.screen = screenButton.dataset.screen;
    history.replaceState(null, "", `?screen=${state.screen}&subject=${state.subject}`);
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const subjectButton = event.target.closest("[data-subject]");
  if (subjectButton) {
    state.subject = subjectButton.dataset.subject;
    history.replaceState(null, "", `?screen=summary&subject=${state.subject}`);
    render();
    return;
  }

  const entryButton = event.target.closest("[data-open-entry]");
  if (entryButton) {
    openEntry(entryButton.dataset.openEntry === "edit" ? "edit" : "create");
    return;
  }

  const mathResourceButton = event.target.closest("[data-math-resource]");
  if (mathResourceButton) {
    state.mathResource = mathResourceButton.dataset.mathResource;
    state.mathSection = 0;
    state.mathPhase = 0;
    history.replaceState(null, "", `?screen=math&math=${state.mathResource}`);
    render();
    return;
  }

  const mathSectionButton = event.target.closest("[data-math-section]");
  if (mathSectionButton) {
    state.mathSection = Number(mathSectionButton.dataset.mathSection) || 0;
    render();
    return;
  }

  const mathPhaseButton = event.target.closest("[data-math-phase]");
  if (mathPhaseButton) {
    state.mathPhase = Number(mathPhaseButton.dataset.mathPhase) || 0;
    render();
    return;
  }

  const annotateOpen = event.target.closest("[data-annotate]");
  if (annotateOpen) {
    toggleAnnotation(annotateOpen);
    return;
  }

  const annotateCancel = event.target.closest("[data-annotate-cancel]");
  if (annotateCancel) {
    const panelRow = annotateCancel.closest("[data-annotate-panel]");
    if (panelRow) panelRow.remove();
    return;
  }

  const annotateSave = event.target.closest("[data-annotate-save]");
  if (annotateSave) {
    saveAnnotation(annotateSave);
    return;
  }

  const analysisOpen = event.target.closest("[data-analyze]");
  if (analysisOpen) {
    toggleAnalysis(analysisOpen);
    return;
  }

  const analysisClose = event.target.closest("[data-analysis-close]");
  if (analysisClose) {
    const panelRow = analysisClose.closest("[data-analysis-panel]");
    const id = panelRow ? panelRow.dataset.analysisPanel : "";
    if (panelRow) panelRow.remove();
    if (id) {
      const sourceButton = document.querySelector(`[data-analyze="${id}"]`);
      if (sourceButton) sourceButton.setAttribute("aria-expanded", "false");
    }
    return;
  }

  const analysisRefresh = event.target.closest("[data-analysis-refresh]");
  if (analysisRefresh) {
    refreshAnalysis(analysisRefresh);
    return;
  }

  const analysisNote = event.target.closest("[data-analysis-note]");
  if (analysisNote) {
    if (analysisNote.classList.contains("is-done")) return;
    analysisNote.classList.add("is-done");
    analysisNote.innerHTML = `${icon("check")} 已存进笔记`;
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
    return;
  }

  const analysisReview = event.target.closest("[data-analysis-review]");
  if (analysisReview) {
    if (analysisReview.classList.contains("is-done")) return;
    analysisReview.classList.add("is-done");
    analysisReview.innerHTML = `${icon("check")} 已加入今日复盘`;
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
    return;
  }

  const annotateType = event.target.closest("[data-annotate-type]");
  if (annotateType) {
    annotateType.classList.toggle("active");
    return;
  }

  const annotateStatus = event.target.closest("[data-annotate-status]");
  if (annotateStatus) {
    setPanelOption(annotateStatus, "data-annotate-status");
    return;
  }

  const annotateNext = event.target.closest("[data-annotate-next]");
  if (annotateNext) {
    setPanelOption(annotateNext, "data-annotate-next");
    return;
  }

  const countDelta = event.target.closest("[data-count-delta]");
  if (countDelta) {
    const stepper = countDelta.closest(".count-stepper");
    const input = stepper ? stepper.querySelector("input[type='number']") : null;
    if (input) {
      const delta = Number(countDelta.dataset.countDelta) || 0;
      input.value = Math.max(0, (Number(input.value) || 0) + delta);
    }
    return;
  }

  const mistakeBoardButton = event.target.closest("[data-mistake-board]");
  if (mistakeBoardButton) {
    state.mistakeBoard = mistakeBoardButton.dataset.mistakeBoard;
    history.replaceState(null, "", `?screen=mistakes&board=${state.mistakeBoard}`);
    render();
    return;
  }

  const mistakeFilter = event.target.closest("[data-mistake-filter]");
  if (mistakeFilter) {
    applyMistakeFilter(mistakeFilter.dataset.mistakeFilter);
    return;
  }

  const editButton = event.target.closest("[data-edit-record]");
  if (editButton) {
    editEntry(editButton.dataset.editRecord);
    return;
  }

  const modeButton = event.target.closest("[data-entry-mode]");
  if (modeButton) {
    setEntryMode(modeButton.dataset.entryMode);
  }
});

document.getElementById("close-entry").addEventListener("click", closeEntry);
document.getElementById("cancel-entry").addEventListener("click", closeEntry);
document.getElementById("cancel-edit").addEventListener("click", () => setEntryMode("create"));
document.getElementById("save-entry").addEventListener("click", closeEntry);
entrySubject.addEventListener("change", syncEntryOptions);
entryFull.addEventListener("input", updateLostScore);
entryScore.addEventListener("input", updateLostScore);
entryModal.addEventListener("click", (event) => {
  if (event.target === entryModal) closeEntry();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeEntry();
});

setEntryMode(state.entryMode);
syncEntryOptions();
updateLostScore();

if (new URLSearchParams(location.search).get("entry") === "1") {
  const record = new URLSearchParams(location.search).get("record") || "";
  openEntry(state.entryMode, record);
}

render();
