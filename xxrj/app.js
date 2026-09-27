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
const YM = window.YANTU_MATH || { groups: [], books: [] };
const YM_GROUPS = Array.isArray(YM.groups) ? YM.groups : [];
const YM_BOOKS = Array.isArray(YM.books) ? YM.books : [];
const YM_BY_KEY = Object.fromEntries(YM_BOOKS.map((book) => [book.key, book]));
const STORE = window.YANTU_STORE;
/** 与 vocab.js 的 DATA_VERSION 对齐：词表更新时同步改这里。 */
const VOCAB_DATA_VERSION = "20260927-867effa";

const state = {
  screen: initialParams.get("screen") || "dashboard",
  subject: initialParams.get("subject") || "math",
  entryMode: initialParams.get("edit") === "1" ? "edit" : "create",
  mathResource: initialParams.get("math") || (YM_BOOKS[0] ? YM_BOOKS[0].key : "zy1000"),
  mathSection: 0,
  mathPhase: 0,
  mistakeBoard: initialParams.get("board") || "math",
  englishPaper: initialParams.get("paper") || "英语一",
  planBoard: initialParams.get("plan") || "today",
  taskEditId: "",
  recordEditId: "",
  knowledgeEditId: "",
  reviewLogId: "",
  reviewFilter: "all",
  progressChapter: null,
};

const accentMap = {
  blue: ["var(--blue)", "var(--blue-soft)"],
  green: ["var(--green)", "var(--green-soft)"],
  amber: ["var(--amber)", "var(--amber-soft)"],
  red: ["var(--red)", "var(--red-soft)"],
  violet: ["var(--violet)", "var(--violet-soft)"],
  cyan: ["var(--cyan)", "#e6f7fa"],
  coral: ["var(--coral)", "var(--coral-soft)"],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 本地日期字符串（YYYY-MM-DD），不用 UTC 以免跨时区偏一天。 */
function dateKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDate(days, from = new Date()) {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

const TODAY_KEY = dateKey(today);

/* ------------------------------------------- 真实数据派生工具（全部来自 STORE） */

function recordsAll() {
  return STORE ? STORE.records() : [];
}

function subjectKeyOf(record) {
  const subject = String((record && record.subject) || "");
  if (subject.startsWith("数学")) return "math";
  if (subject.startsWith("英语")) return "english";
  if (subject.includes("408")) return "cs408";
  if (subject.includes("政治")) return "politics";
  return "";
}

function recordsOfSubject(key) {
  return recordsAll().filter((record) => subjectKeyOf(record) === key);
}

/** 得分率：优先用满分/得分，其次用题数/做对题数；两者都没有时返回 null。 */
function recordRate(record) {
  if (!record) return null;
  if (Number(record.full) > 0) {
    return Math.max(0, Math.min(100, Math.round((Number(record.score) || 0) / record.full * 100)));
  }
  if (Number(record.count) > 0) {
    return Math.max(0, Math.min(100, Math.round((Number(record.correct) || 0) / record.count * 100)));
  }
  return null;
}

/** 按题数加权的整体得分率，样本少的时候不会因为一条小记录被拉高。 */
function weightedRate(records) {
  let got = 0;
  let max = 0;
  for (const record of records || []) {
    if (Number(record.full) > 0) {
      got += Number(record.score) || 0;
      max += Number(record.full);
    } else if (Number(record.count) > 0) {
      got += Number(record.correct) || 0;
      max += Number(record.count);
    }
  }
  return max > 0 ? Math.max(0, Math.min(100, Math.round((got / max) * 100))) : null;
}

/** 是否算一条“错题”：有错因、标记了复盘、或者逐题记录里没做对。 */
function isMistakeRecord(record) {
  if (!record) return false;
  if (String(record.errorType || "").trim()) return true;
  if (record.status === "错题复盘" || record.status === "一直不会的题") return true;
  if (record.reviewDate) return true;
  if (Number(record.reviewCount) > 0) return true;
  if (record.question && Number(record.full) > 0 && Number(record.score) < Number(record.full)) return true;
  if (record.question && Number(record.count) > 0 && Number(record.correct) < Number(record.count)) return true;
  return false;
}

function mistakeRecordsOf(subject) {
  const list = subject ? recordsOfSubject(subject) : recordsAll();
  return list.filter(isMistakeRecord);
}

/** 待复盘：没消灭，且没有排期或排期已经到了。 */
function pendingReviewRecords(records) {
  return (records || []).filter((record) => {
    if (!isMistakeRecord(record)) return false;
    if (record.status === "已消灭") return false;
    if (!record.reviewDate) return true;
    return record.reviewDate <= TODAY_KEY;
  });
}

/* ------------------------------- 英语三分类：整套卷 / 单纯阅读 / 其他模块 */

const ENGLISH_KINDS = [
  { key: "paper", label: "整套卷" },
  { key: "reading", label: "单纯阅读" },
  { key: "other", label: "其他模块" },
];
const ENGLISH_KIND_LABEL = Object.fromEntries(ENGLISH_KINDS.map((item) => [item.key, item.label]));

/**
 * 英语记录分三类：
 *   · 录入时明确选了类型 → 用选的那一类；
 *   · 没选但有满分 → 整套卷；
 *   · 模块 / 来源里带「阅读」→ 单纯阅读；
 *   · 其余 → 其他模块。
 */
function englishKindOf(record) {
  if (!record) return "other";
  const explicit = String(record.kind || "");
  if (ENGLISH_KIND_LABEL[explicit]) return explicit;
  if (Number(record.full) > 0) return "paper";
  if (`${record.module} ${record.source}`.includes("阅读")) return "reading";
  return "other";
}

function englishKindLabel(record) {
  return ENGLISH_KIND_LABEL[englishKindOf(record)] || "其他模块";
}

/** 英语三类各自一行汇总：条数、得分率、累计失分、待复盘。 */
function englishKindRows(records) {
  return ENGLISH_KINDS.map((kind) => {
    const list = (records || []).filter((record) => englishKindOf(record) === kind.key);
    return {
      key: kind.key,
      label: kind.label,
      count: list.length,
      rate: weightedRate(list),
      lost: sumBy(list, (record) => Math.max(0, Number(record.full) - Number(record.score))),
      pending: pendingReviewRecords(list).length,
      latest: sortedByDate(list, -1)[0] || null,
    };
  });
}

/* ------------------------------------------------- 错题 / 知识点汇总 */

/** 错题分组：条数、累计失分、得分率，失分多的排前面。 */
function mistakeBuckets(records, keyFn) {
  return [...groupBy(records || [], keyFn).entries()]
    .map(([name, list]) => ({
      name,
      count: list.length,
      lost: sumBy(list, (record) => Math.max(0, Number(record.full) - Number(record.score))),
      rate: weightedRate(list),
      pending: pendingReviewRecords(list).length,
    }))
    .sort((left, right) => right.lost - left.lost || right.count - left.count);
}

function mistakePaperKey(record) {
  return `${summaryYearOf(record)} ${summaryPaperOf(record)}`.trim();
}

/** 真题（整套卷）成绩：一份卷一行，备注可直接在表里改。 */
function wholePaperRows(records) {
  const papers = (records || []).filter(
    (record) => Number(record.full) > 0 && subjectKeyOf(record) !== "english",
  );
  const englishPapers = (records || []).filter(
    (record) => subjectKeyOf(record) === "english" && englishKindOf(record) === "paper",
  );
  return [...papers, ...englishPapers]
    .sort((left, right) => `${right.date}${right.createdAt}`.localeCompare(`${left.date}${left.createdAt}`))
    .map((record) => ({
      id: record.id,
      date: record.date || "",
      subject: record.subject || "",
      label: `${summaryYearOf(record)} ${summaryPaperOf(record)}`.trim(),
      module: record.module || "",
      score: Number(record.score) || 0,
      full: Number(record.full) || 0,
      rate: recordRate(record),
      note: record.note || "",
      pending: pendingReviewRecords([record]).length > 0,
    }));
}

function knowledgeAll() {
  return STORE ? STORE.knowledge() : [];
}

function knowledgeOfDate(date) {
  return knowledgeAll().filter((item) => item.date === date);
}

/** 待复盘知识点：还没排期，或者排期已经到今天。 */
function pendingKnowledge(items) {
  return (items || []).filter((item) => {
    if (item.status !== "待复盘") return false;
    if (!item.reviewDate) return true;
    return item.reviewDate <= TODAY_KEY;
  });
}

function rateTone(rate) {
  if (rate === null || rate === undefined) return "blue";
  if (rate < 50) return "red";
  if (rate < 65) return "amber";
  if (rate < 80) return "violet";
  return "blue";
}

function rateToneText(rate) {
  if (rate === null || rate === undefined) return "缺数据";
  if (rate < 50) return "薄弱";
  if (rate < 65) return "需补强";
  if (rate < 80) return "跟进";
  return "稳定";
}

/** 复盘列表的色块：一直不会用红色，其余跟着得分率走。 */
function reviewToneOf(record) {
  if (!record) return "blue";
  if (record.status === "一直不会的题") return "red";
  const tone = rateTone(recordRate(record));
  return tone === "violet" ? "blue" : tone;
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list || []) {
    const key = keyFn(item);
    if (key === undefined || key === null || key === "") continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function sumBy(list, valueFn) {
  return (list || []).reduce((sum, item) => sum + (Number(valueFn(item)) || 0), 0);
}

function recentRecords(records, days) {
  const from = dateKey(shiftDate(-(Math.max(1, days) - 1)));
  return (records || []).filter((record) => record.date && record.date >= from);
}

function sortedByDate(records, direction = -1) {
  return [...(records || [])].sort((left, right) => direction * `${left.date}${left.createdAt}`.localeCompare(`${right.date}${right.createdAt}`));
}

function examDaysLeft(profile) {
  const key = profile && profile.examDate;
  if (!key) return daysLeft;
  const target = new Date(`${key}T00:00:00+08:00`);
  if (Number.isNaN(target.getTime())) return daysLeft;
  return Math.max(0, Math.ceil((target - today) / DAY_MS));
}

function weekdayText(key) {
  const target = new Date(`${key}T00:00:00`);
  if (Number.isNaN(target.getTime())) return "";
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][target.getDay()];
}

function minutesText(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  if (!value) return "";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest} 分钟`;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

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
  if (!Array.isArray(labels) || labels.length < 2 || !Array.isArray(series) || !series.length) {
    return `
      <div class="empty-state compact">
        ${icon("chart-line")}
        <strong>趋势图需要至少两次记录</strong>
        <span>再录入一次同科目的成绩，这里就会自动画出走势。</span>
      </div>
    `;
  }
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
  if (!Array.isArray(items) || !items.length || !totalLost) {
    return `
      <div class="empty-state compact">
        ${icon("chart-bar")}
        <strong>还没有可统计的失分</strong>
        <span>录入整卷成绩时填上满分和得分，这里会自动按模块汇总失分。</span>
      </div>
    `;
  }
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
  return `<button class="row-action" type="button" data-edit-record="${escapeHtml(description)}" title="编辑这条记录" aria-label="编辑这条记录">${icon("pencil-line")}</button>`;
}

/** 用真实 record.id 打开编辑弹窗，不靠描述字符串猜记录。 */
function recordEditAction(id) {
  return `<button class="row-action" type="button" data-record-edit="${escapeHtml(id)}" title="编辑这条记录" aria-label="编辑这条记录">${icon("pencil-line")}</button>`;
}

function recordRemoveAction(id) {
  return `<button class="row-action" type="button" data-record-remove="${escapeHtml(id)}" title="删除这条记录" aria-label="删除这条记录">${icon("trash-2")}</button>`;
}

const SUMMARY_META = {
  math: {
    title: "数学一 / 二 / 三",
    subtitle: "数学一为主线，数学二、数学三作为补充卷；分数按年份、卷种、模块和题号汇总，所有记录都能手动新增或修改。",
    segmented: ["数一", "数二", "数三"],
    chartNote: "按年份堆叠各模块得分；虚线为目标线，数据全部来自你录入的成绩。",
    lossNote: "累计失分按模块排序，红色越深代表失分越集中。",
    max: 150,
    target: 120,
    colors: ["var(--blue)", "var(--violet)", "var(--coral)", "var(--amber)", "var(--cyan)", "var(--red)"],
  },
  english: {
    title: "英语一 / 二",
    subtitle: "英语一、英语二分开记录；阅读按年份和篇目、其余题型按模块与题号汇总，手动新增或修改后自动重算。",
    segmented: ["英语一", "英语二"],
    chartNote: "按年份堆叠各题型得分；虚线为 75 分目标线，数据来自你录入的英语成绩。",
    lossNote: "累计失分按题型排序，阅读和写作通常占大头。",
    max: 100,
    target: 75,
    colors: ["var(--blue)", "var(--violet)", "var(--coral)", "var(--amber)", "var(--cyan)", "var(--red)"],
  },
  cs408: {
    title: "408",
    subtitle: "王道四本书课后题与历年真题统一汇总；按年份、四门科目和题号拆分，便于定位失分来源。",
    segmented: ["历年真题", "王道课后题"],
    chartNote: "按年份堆叠四门科目得分；虚线为 110 分目标线，数据来自你录入的 408 成绩。",
    lossNote: "累计失分按科目排序，组成原理和数据结构通常是重点。",
    max: 150,
    target: 110,
    colors: ["var(--blue)", "var(--coral)", "var(--violet)", "var(--amber)", "var(--cyan)", "var(--red)"],
  },
};

function summaryYearOf(record) {
  return String(record.year || (record.date || "").slice(0, 4) || "未填年份");
}

function summaryPaperOf(record) {
  return String(record.paper || record.subject || "未分卷");
}

function summaryModuleOf(record) {
  return String(record.module || record.source || record.subject || "未分类");
}

function summaryStatusOf(record) {
  if (record.status === "已消灭" || record.status === "已复盘") return ["已复盘", "green"];
  if (pendingReviewRecords([record]).length) return record.reviewDate && record.reviewDate <= TODAY_KEY ? ["今天到期", "red"] : ["待复盘", "amber"];
  return ["已录入", "blue"];
}

/** 汇总页的全部数字都从 STORE 记录推导，没有记录就返回 null 走空状态。 */
function buildSummaryData(key) {
  const meta = SUMMARY_META[key] || SUMMARY_META.math;
  const records = recordsOfSubject(key);
  if (!records.length) return null;

  const whole = sortedByDate(records.filter((record) => Number(record.full) > 0), 1);
  const latest = whole[whole.length - 1] || null;
  const avgRate = weightedRate(whole.length ? whole : records);
  const lostTotal = sumBy(whole, (record) => Math.max(0, Number(record.full) - Number(record.score)));
  const pending = pendingReviewRecords(records);

  const kpis = [
    {
      label: "最近一次总分",
      value: latest ? latest.score : "—",
      unit: latest ? `/${latest.full}` : "",
      sub: latest ? `${summaryYearOf(latest)} ${summaryPaperOf(latest)} · 得分率 ${recordRate(latest)}%` : "还没有填满分的整卷记录",
      iconName: "file-check-2",
      accent: "blue",
    },
    {
      label: "平均得分率",
      value: avgRate === null ? "—" : avgRate,
      unit: avgRate === null ? "" : "%",
      sub: whole.length ? `${whole.length} 套整卷记录加权平均` : `${records.length} 条记录加权平均`,
      iconName: "trending-up",
      accent: "violet",
    },
    {
      label: "累计失分",
      value: lostTotal,
      unit: "分",
      sub: whole.length ? `${whole.length} 套整卷合计` : "填了满分和得分后自动统计",
      iconName: "triangle-alert",
      accent: "coral",
    },
    {
      label: "待复盘题目",
      value: pending.length,
      unit: "题",
      sub: pending.length ? "含今天到期和未排期的错题" : "没有到期的错题",
      iconName: "notebook-tabs",
      accent: "amber",
    },
  ];

  const yearBuckets = groupBy(whole, (record) => `${summaryYearOf(record)} ${summaryPaperOf(record)}`);
  const labels = [...yearBuckets.keys()].slice(-6);
  const topModules = [...groupBy(records, summaryModuleOf).entries()]
    .map(([name, list]) => ({ name, score: sumBy(list, (record) => record.score), count: list.length }))
    .sort((left, right) => right.score - left.score || right.count - left.count)
    .slice(0, 4)
    .map((item) => item.name);

  const series = topModules.map((name, index) => ({
    name,
    color: meta.colors[index % meta.colors.length],
    values: labels.map((label) => sumBy(yearBuckets.get(label), (record) => (summaryModuleOf(record) === name ? record.score : 0))),
  }));
  const yearTotals = labels.map((label) => sumBy(yearBuckets.get(label), (record) => record.score));
  const chartMax = Math.max(meta.max, ...yearTotals, 1);

  const lossBuckets = [...groupBy(records.filter((record) => Number(record.full) > 0), summaryModuleOf).entries()]
    .map(([name, list]) => ({
      label: name,
      value: sumBy(list, (record) => Math.max(0, Number(record.full) - Number(record.score))),
      note: `${list.length} 条记录`,
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 6)
    .map((item, index) => ({ ...item, color: meta.colors[index % meta.colors.length] }));
  const lossTotal = sumBy(lossBuckets, (item) => item.value);
  const worst = lossBuckets[0];

  const yearHead = ["年份 / 试卷", "总分", ...topModules.slice(0, 3), "得分率", "状态"];
  const yearRows = labels
    .map((label) => {
      const list = yearBuckets.get(label) || [];
      const score = sumBy(list, (record) => record.score);
      const full = sumBy(list, (record) => record.full);
      const rate = full ? Math.round((score / full) * 100) : 0;
      const moduleCells = topModules.slice(0, 3).map((name) => {
        const value = sumBy(list, (record) => (summaryModuleOf(record) === name ? record.score : 0));
        return value ? String(value) : "-";
      });
      const flag = list.some((record) => pendingReviewRecords([record]).length);
      const newest = sortedByDate(list, -1)[0];
      return {
        id: newest ? newest.id : "",
        cells: [label, `${score}/${full}`, ...moduleCells, `${rate}%`, flag ? ["待复盘", "amber"] : ["已复盘", "green"]],
      };
    })
    .reverse();

  const questionRows = sortedByDate(
    records.filter((record) => record.question || isMistakeRecord(record)),
    -1,
  )
    .slice(0, 12)
    .map((record) => {
      const lost = Number(record.full) > 0 ? Math.max(0, Number(record.full) - Number(record.score)) : 0;
      const [text, tone] = summaryStatusOf(record);
      return {
        id: record.id,
        cells: [
          `${summaryYearOf(record)} ${summaryPaperOf(record)}`.trim(),
          record.question || record.status || "整卷",
          summaryModuleOf(record),
          Number(record.full) > 0 ? `${record.score}/${record.full}` : `${record.correct}/${record.count}`,
          lost ? `-${lost}` : "-",
          `${record.reviewCount || 0} 次`,
          [text, tone],
          record.reviewDate || "未排期",
        ],
      };
    });

  return {
    subtitle: meta.subtitle,
    segmented: meta.segmented,
    chartNote: meta.chartNote,
    lossNote: meta.lossNote,
    lossTip: worst ? `当前最该优先补的是「${worst.label}」，累计失分 ${worst.value} 分。` : "录入整卷成绩后，这里会指出最该优先补的模块。",
    kpis,
    chart: { labels, max: chartMax, target: meta.target, unit: "", series },
    loss: { total: lostTotal, items: lossBuckets },
    yearHead,
    yearRows,
    questionRows,
    totalRecords: records.length,
  };
}

function summaryEmptyPage() {
  const meta = SUMMARY_META[state.subject] || SUMMARY_META.math;
  return `
    <div class="page-head">
      <div>
        <h1>成绩汇总</h1>
        <p class="page-desc">${meta.subtitle}</p>
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
    <section class="card card-pad">
      <div class="empty-state">
        ${icon("chart-column")}
        <strong>${meta.title}还没有成绩记录</strong>
        <span>做完整卷或某个模块后录一次，这里会自动生成得分构成、失分模块和逐题汇总。</span>
        <div class="head-actions">
          <button class="primary-btn" type="button" data-open-entry="create">${icon("plus")} 录入第一条成绩</button>
          <button class="secondary-btn" type="button" data-screen="plan">${icon("calendar-range")} 先去排今日计划</button>
        </div>
      </div>
    </section>
  `;
}

function renderSummary() {
  const data = buildSummaryData(state.subject);
  if (!data) return summaryEmptyPage();
  const subjectRecords = recordsOfSubject(state.subject);
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
      <button class="filter-chip active">全部 ${data.totalRecords} 条</button>
      ${data.chart.labels.map((label) => `<button class="filter-chip">${escapeHtml(label)}</button>`).join("")}
      <span class="filter-sep"></span>
      ${data.segmented.map((label, index) => `<button class="filter-chip ${index === 0 ? "active" : ""}">${escapeHtml(label)}</button>`).join("")}
    </div>

    <div class="kpi-grid">
      ${data.kpis.map((item) => kpiCard(item)).join("")}
    </div>

    <div class="grid">
      ${mistakeSummaryHTML(subjectRecords)}
      ${paperScoreHTML(subjectRecords, { title: "真题 / 整套卷成绩汇总" })}

      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">得分图 · 模块得分构成</h2>
            <p class="card-note">${data.chartNote}</p>
          </div>
        </div>
        <div class="legend">
          ${data.chart.series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.name)}</span>`).join("")}
        </div>
        ${stackedBarChart(data.chart)}
        ${
          latestIndex >= 0
            ? `<div class="chart-foot">
                <div class="chart-foot-top">
                  <span>${escapeHtml(latestYear)} 得分构成</span>
                  <strong>合计 ${latestTotal}/${data.chart.max}</strong>
                </div>
                <div class="chart-foot-list">
                  ${data.chart.series
                    .map(
                      (item) => `
                        <span class="chart-foot-item">
                          <i style="background:${item.color}"></i>
                          <span>${escapeHtml(item.name)}</span>
                          <strong>${item.values[latestIndex]}</strong>
                        </span>
                      `,
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }
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
        <div class="mini-note">${icon("crosshair")} ${escapeHtml(data.lossTip)}</div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">年度总分汇总</h2>
            <p class="card-note">每一年的总分、模块分和状态都能点铅笔直接修改。</p>
          </div>
          <div class="head-actions">
            <button class="secondary-btn" type="button" data-export-json>${icon("download")} 导出备份</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>${data.yearHead.map((head) => `<th>${escapeHtml(head)}</th>`).join("")}<th>操作</th></tr>
            </thead>
            <tbody>
              ${
                data.yearRows.length
                  ? data.yearRows
                      .map(
                        (row) => `
                    <tr>
                      ${row.cells
                        .map((cell, index) => {
                          if (index === row.cells.length - 1) {
                            const [text, tone] = cell;
                            return `<td><span class="tag ${tone}">${escapeHtml(text)}</span></td>`;
                          }
                          if (index === 0) return `<td><span class="year-cell">${escapeHtml(cell)}</span></td>`;
                          if (index === 1) return `<td class="score">${escapeHtml(cell)}</td>`;
                          return `<td>${escapeHtml(cell)}</td>`;
                        })
                        .join("")}
                      <td>${row.id ? recordEditAction(row.id) : ""}</td>
                    </tr>
                  `,
                      )
                      .join("")
                  : `<tr><td colspan="${data.yearHead.length + 1}">还没有填写满分的整卷记录。</td></tr>`
              }
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
            <button>需加强</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>年份 / 试卷</th><th>题号</th><th>模块 / 考点</th><th>得分</th><th>失分</th><th>复盘次数</th><th>状态</th><th>下次复盘</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${
                data.questionRows.length
                  ? data.questionRows
                      .map(
                        (row) => `
                    <tr>
                      ${row.cells
                        .map((cell, index) => {
                          if (index === row.cells.length - 2) {
                            const [text, tone] = cell;
                            return `<td><span class="tag ${tone}">${escapeHtml(text)}</span></td>`;
                          }
                          if (index === 0) return `<td><span class="year-cell">${escapeHtml(cell)}</span></td>`;
                          if (index === 1) return `<td><span class="question-no">${escapeHtml(cell)}</span></td>`;
                          if (index === 4) return `<td class="lost-cell">${escapeHtml(cell)}</td>`;
                          return `<td>${escapeHtml(cell)}</td>`;
                        })
                        .join("")}
                      <td>${recordEditAction(row.id)}</td>
                    </tr>
                  `,
                      )
                      .join("")
                  : `<tr><td colspan="9">还没有逐题记录；录入成绩时填上题号，就会出现在这里。</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

const HEATMAP_WEEKS = 12;
const HEATMAP_SUBJECTS = [
  { key: "math", label: "数学" },
  { key: "english", label: "英语" },
  { key: "cs408", label: "408" },
  { key: "politics", label: "政治" },
];

/** 逐题详情（主记录-q题号）已经算进主记录的题数，热力图跳过它避免双算。 */
function isEntryDetailRecord(record) {
  return /-q\d+$/.test(String((record && record.id) || ""));
}

/** 复盘日志是 ISO 时间戳，按本地时区还原成 YYYY-MM-DD，纯日期串直接取前 10 位。 */
function localDateKeyOf(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(text) && !text.includes("T")) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : dateKey(parsed);
}

/**
 * 近 84 天、按科目聚合每天的学习量：
 *   · 完成题数 = 当天主记录 count 之和，轮次只做拆分；
 *   · 复盘题数 = 错题「上次复盘日」＋知识点复盘日志，历史多次复盘只能还原最近一次。
 */
function heatmapDayStats() {
  const stats = new Map();
  const bucketOf = (date, subject) => {
    const key = `${date}|${subject}`;
    if (!stats.has(key)) stats.set(key, { done: 0, review: 0, rounds: new Map() });
    return stats.get(key);
  };
  const addReview = (date, subject) => {
    if (!date || !subject) return;
    bucketOf(date, subject).review += 1;
  };

  const all = recordsAll();
  // 有逐题详情时，复盘按每道题统计；主记录只在详情还没记复盘日时兜底一次，避免同一组题被算两遍。
  const detailReviewIds = new Set();
  all.forEach((record) => {
    if (!isEntryDetailRecord(record)) return;
    if (!isMistakeRecord(record) || !record.lastReviewDate) return;
    detailReviewIds.add(String(record.id).replace(/-q\d+$/, ""));
  });

  for (const record of all) {
    const subject = subjectKeyOf(record);
    if (!subject) continue;
    if (!isEntryDetailRecord(record) && record.date) {
      const done = Number(record.count) || 0;
      if (done > 0) {
        const entry = bucketOf(record.date, subject);
        const round = mathRoundMeta(record.round).label;
        entry.done += done;
        entry.rounds.set(round, (entry.rounds.get(round) || 0) + done);
      }
    }
    if (!isMistakeRecord(record) || !record.lastReviewDate) continue;
    if (!isEntryDetailRecord(record) && detailReviewIds.has(String(record.id))) continue;
    addReview(localDateKeyOf(record.lastReviewDate), subject);
  }

  for (const item of knowledgeAll()) {
    const subject = subjectKeyOf({ subject: item.subject });
    if (!subject) continue;
    const logs = Array.isArray(item.logs) ? item.logs : [];
    logs.forEach((log) => addReview(localDateKeyOf(log && log.at), subject));
    // 早期知识点没有日志，只能拿最近一次复盘日顶一下。
    if (!logs.length && item.lastReviewDate) addReview(localDateKeyOf(item.lastReviewDate), subject);
  }
  return stats;
}

function heatCellTitle(date, subjectLabel, entry) {
  const done = entry ? entry.done : 0;
  const review = entry ? entry.review : 0;
  if (!done && !review) return `${date} · ${subjectLabel} · 没有记录`;
  const rounds = entry && entry.rounds.size
    ? `（${[...entry.rounds.entries()].map(([label, value]) => `${label} ${value}`).join(" / ")}）`
    : "";
  return `${date} · ${subjectLabel} · 完成 ${done} 道${rounds} · 复盘 ${review} 道`;
}

function heatmap() {
  const stats = heatmapDayStats();
  const dayCount = HEATMAP_WEEKS * 7;
  const days = Array.from({ length: dayCount }, (_, index) => dateKey(shiftDate(index - (dayCount - 1))));
  const doneMax = Math.max(0, ...[...stats.values()].map((item) => item.done));
  const totals = new Map(HEATMAP_SUBJECTS.map((item) => [item.key, { done: 0, review: 0 }]));

  const cells = days
    .flatMap((date) =>
      HEATMAP_SUBJECTS.map((subject) => {
        const entry = stats.get(`${date}|${subject.key}`);
        const done = entry ? entry.done : 0;
        const review = entry ? entry.review : 0;
        const total = totals.get(subject.key);
        total.done += done;
        total.review += review;
        const signal = doneMax > 0 ? done / doneMax : 0;
        const level = !done ? 0 : signal > 0.75 ? 4 : signal > 0.5 ? 3 : signal > 0.25 ? 2 : 1;
        const classes = ["heat-cell", `l${level}`];
        if (!done && review) classes.push("is-review");
        return `<span class="${classes.join(" ")}" data-date="${date}" data-subject="${subject.key}" data-done="${done}" data-review="${review}" title="${escapeAttr(heatCellTitle(date, subject.label, entry))}">${done ? `<b>${done}</b>` : ""}${review ? `<i>${review}</i>` : ""}</span>`;
      }),
    )
    .join("");

  const labels = HEATMAP_SUBJECTS.map((subject) => {
    const total = totals.get(subject.key);
    return `<span class="heat-subject" title="${escapeAttr(`${subject.label}：近 ${HEATMAP_WEEKS} 周完成 ${total.done} 道，复盘 ${total.review} 道`)}"><b>${subject.label}</b><i>${total.done} / ${total.review}</i></span>`;
  }).join("");

  return `
    <div class="heatmap-board">
      <div class="heatmap-subjects" aria-hidden="true">${labels}</div>
      <div class="heatmap-scroll" tabindex="0" role="group" aria-label="近 ${HEATMAP_WEEKS} 周每日刷题热力图，可横向滚动查看更早的日期">
        <div class="heatmap-grid">${cells}</div>
      </div>
    </div>
  `;
}

/* 热力图默认停在最右边（今天），用户自己滚过之后按原位置还原。 */
let heatmapScrollLeft = null;

function syncHeatmapScroll() {
  const scroll = document.querySelector(".heatmap-scroll");
  if (!scroll) {
    heatmapScrollLeft = null;
    return;
  }
  scroll.scrollLeft = heatmapScrollLeft === null ? scroll.scrollWidth : heatmapScrollLeft;
  scroll.addEventListener("scroll", () => {
    heatmapScrollLeft = scroll.scrollLeft;
  });
}

/** action 传空时保留原来的箭头按钮，复盘队列会换成可点的「复盘」按钮。 */
function reviewItem(index, title, meta, tone = "red", action = "") {
  return `
    <div class="review-item">
      <div class="review-index" style="color:var(--${tone});background:var(--${tone}-soft)">${index}</div>
      <div>
        <p class="review-title">${title}</p>
        <p class="review-meta">${meta}</p>
      </div>
      ${action || `<button class="review-action" aria-label="查看">${icon("arrow-up-right")}</button>`}
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

/* ------------------------------------------- 恋练有词 · 每日学习情况 */

/**
 * 这一块直接吃词汇库的背词记录（window.IballVocabRecite.daily）：
 * 词汇库页面里按「斩 · 已会」记过的词算已斩，不再计进待背；
 * 今日新学 / 今日复习 / 连续天数都按本地日期算，账号同步后自动刷新。
 */
const LLYC_DECK = "llyc2027";
const LLYC_TOTAL_FALLBACK = 8095;
const llycMeta = { total: LLYC_TOTAL_FALLBACK, source: "fallback" };
let llycUnsubscribe = null;

function llycDaily() {
  const api = window.IballVocabRecite;
  if (!api || typeof api.daily !== "function") {
    return null;
  }
  try {
    return api.daily(LLYC_DECK, { days: 7 });
  } catch {
    return null;
  }
}

function llycSparkline(days) {
  const peak = days.reduce((max, day) => Math.max(max, day.total), 0);
  const total = days.reduce((sum, day) => sum + day.total, 0);
  return `
    <div class="llyc-spark" role="img" aria-label="近 7 天共记录 ${total} 次背词">
      ${days
        .map((day) => {
          const ratio = peak > 0 ? day.total / peak : 0;
          const height = day.total === 0 ? 6 : Math.max(18, Math.round(ratio * 100));
          return `
            <div class="llyc-spark-col${day.isToday ? " is-today" : ""}">
              <span class="llyc-spark-value">${day.total || ""}</span>
              <span class="llyc-spark-bar" style="height:${height}%"></span>
              <span class="llyc-spark-label">${day.isToday ? "今天" : `周${day.weekday}`}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function llycPanelBody() {
  const daily = llycDaily();
  if (!daily) {
    return `<p class="llyc-empty">背词接口还没就绪：刷新页面后这里会显示恋练有词的每日学习情况。</p>`;
  }
  const total = llycMeta.total || LLYC_TOTAL_FALLBACK;
  const { today: todayStats, totals, streak } = daily;
  const studiedPct = total ? Math.min((totals.studied / total) * 100, 100) : 0;
  const slainPct = totals.studied ? (totals.known / totals.studied) * 100 : 0;
  const untouched = Math.max(total - totals.studied, 0);
  const cards = [
    { label: "今日新学", value: todayStats.newWords, unit: "词" },
    { label: "今日复习", value: todayStats.reviews, unit: "次" },
    { label: "今日斩词", value: todayStats.known, unit: "词" },
    { label: "连续打卡", value: streak, unit: "天" },
  ];
  const lastActive = daily.updatedAt
    ? `最近一次记录 ${daily.updatedAt.slice(0, 10)}`
    : "还没有背词记录";
  return `
    <div class="llyc-overview">
      <div class="llyc-stats">
        ${cards
          .map(
            (card) => `
              <div class="llyc-stat">
                <span class="llyc-stat-value">${card.value}<small>${card.unit}</small></span>
                <span class="llyc-stat-label">${card.label}</span>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="llyc-progress">
        <div class="llyc-progress-head">
          <strong>已斩 ${totals.known} / ${total} 词</strong>
          <span>模糊 ${totals.fuzzy} · 不认识 ${totals.unknown} · 未背 ${untouched}</span>
        </div>
        <div class="llyc-track">
          <span class="llyc-fill is-studied" style="width:${studiedPct.toFixed(2)}%">
            <span class="llyc-fill is-slain" style="width:${slainPct.toFixed(2)}%"></span>
          </span>
        </div>
        <div class="llyc-legend">
          <span><i class="is-slain"></i>已斩</span>
          <span><i class="is-studied"></i>背过还没斩</span>
          <span><i class="is-rest"></i>没背过</span>
        </div>
      </div>
    </div>
    <div class="llyc-days">
      <div class="llyc-days-head">
        <strong>近 7 天</strong>
        <span>${streak > 0 ? `已连续 ${streak} 天，今天别断` : "今天还没开始背词"}</span>
      </div>
      ${llycSparkline(daily.days)}
    </div>
    <div class="llyc-foot">
      <a class="primary-btn" href="../vocab.html?deck=llyc2027">${icon("swords")} 去背词</a>
      <a class="secondary-btn" href="../vocab.html?deck=llyc2027&hideKnown=1">只看没斩的</a>
      <span class="llyc-note">${icon("database")} ${lastActive} · 跟账号同步</span>
    </div>
  `;
}

function paintLlycPanel() {
  const host = document.getElementById("llycPanel");
  if (!host) {
    return;
  }
  host.innerHTML = llycPanelBody();
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  }
}

function mountLlycPanel() {
  if (!document.getElementById("llycPanel")) {
    return;
  }
  paintLlycPanel();
  if (!llycUnsubscribe && window.IballVocabRecite?.subscribe) {
    llycUnsubscribe = window.IballVocabRecite.subscribe(() => paintLlycPanel());
  }
}

async function loadLlycDeckMeta() {
  try {
    // 词表更新后旧 CDN 副本可能还在，用版本号强制取新清单。
    const response = await fetch(`../vocab-index/lexemes.json?v=${VOCAB_DATA_VERSION}`, { cache: "no-cache" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    const deck = (data?.decks || []).find((item) => item.deck === LLYC_DECK);
    if (deck?.words) {
      llycMeta.total = deck.words;
      llycMeta.source = "index";
      paintLlycPanel();
    }
  } catch {
    // 拿不到清单就用内置词量，面板照常显示。
  }
}

/** 本周从周一到周日的日期键，用于总览里的节奏统计。 */
function weekKeys(base = today) {
  const offset = (base.getDay() + 6) % 7;
  const monday = shiftDate(-offset, base);
  return Array.from({ length: 7 }, (_, index) => dateKey(shiftDate(index, monday)));
}

/** 最近 N 天按科目算平均得分率，低分排前面，用来生成推荐计划。 */
function subjectRates(records, days = 14) {
  const since = dateKey(shiftDate(-days));
  const buckets = new Map();
  records
    .filter((record) => record.date >= since && record.full > 0)
    .forEach((record) => {
      const key = record.subject || "未分类";
      const list = buckets.get(key) || [];
      list.push(Math.max(0, Math.min(100, Math.round((record.score / record.full) * 100))));
      buckets.set(key, list);
    });
  return [...buckets.entries()]
    .map(([subject, list]) => ({
      subject,
      rate: Math.round(list.reduce((sum, value) => sum + value, 0) / list.length),
      count: list.length,
    }))
    .sort((left, right) => left.rate - right.rate);
}

/* ------------------------------------------- 真实数据 → 页面区块的公共零件 */

const SUBJECT_LABELS = { math: "数学", english: "英语", cs408: "408", politics: "政治" };

function subjectLabelOf(key) {
  return SUBJECT_LABELS[key] || String(key || "未分类");
}

function recordScoreText(record) {
  if (Number(record.full) > 0) return `${record.score}/${record.full}`;
  if (Number(record.count) > 0) return `${record.correct}/${record.count}`;
  return "-";
}

function scoreClass(rate) {
  if (rate === null || rate === undefined) return "";
  return rate >= 80 ? "good" : rate >= 65 ? "warn" : "bad";
}

/** 按考点 / 模块把记录聚成得分率列表，样本少的排后面。 */
function moduleMasteryRows(records, limit = 8) {
  return [...groupBy(records, (record) => record.module || record.source || record.subject || "未分类").entries()]
    .map(([name, list]) => ({ name, rate: weightedRate(list), count: list.length }))
    .filter((item) => item.rate !== null)
    .sort((left, right) => left.rate - right.rate || right.count - left.count)
    .slice(0, limit);
}

/** 近 N 天的得分率走势：按记录日期取点，每个科目一条线。 */
function scoreTrend(records, days = 90) {
  const scoped = recentRecords(
    (records || []).filter((record) => recordRate(record) !== null),
    days,
  ).sort((left, right) => `${left.date}${left.createdAt}`.localeCompare(`${right.date}${right.createdAt}`));
  const keys = [...new Set(scoped.map((record) => record.date).filter(Boolean))].slice(-8);
  if (keys.length < 2) return { labels: [], series: [] };
  const colors = ["var(--blue)", "var(--coral)", "var(--amber)", "var(--violet)", "var(--cyan)", "var(--red)"];
  const groups = [...new Set(scoped.map((record) => subjectKeyOf(record) || record.subject || "未分类"))];
  const series = groups.slice(0, 4).map((key, index) => ({
    name: subjectLabelOf(key),
    color: colors[index % colors.length],
    values: keys.map((date) => {
      const dayRecords = scoped.filter((record) => record.date === date && (subjectKeyOf(record) || record.subject || "未分类") === key);
      return weightedRate(dayRecords) ?? 0;
    }),
  }));
  return {
    labels: keys.map((key) => key.slice(5).replace("-", "/")),
    series,
  };
}

/** 通用记录表：英语、408、按书数学都用同一套列，操作按钮走真实编辑 / 删除。 */
function recordTableHTML(records, limit = 12) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>日期</th><th>科目</th><th>来源</th><th>章节 / 模块</th><th>题目</th><th>得分</th><th>得分率</th><th>用时</th><th>备注</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${records
            .slice(0, limit)
            .map((record) => {
              const rate = recordRate(record);
              const kindText = subjectKeyOf(record) === "english" ? englishKindLabel(record) : "";
              return `
                <tr>
                  <td>${escapeHtml(record.date || "-")}</td>
                  <td>${escapeHtml(record.subject || "-")}</td>
                  <td>${escapeHtml(record.source || "-")}${kindText ? `<span class="tag blue kind-chip">${escapeHtml(kindText)}</span>` : ""}</td>
                  <td>${escapeHtml(record.module || record.paper || "-")}</td>
                  <td>${escapeHtml(record.question || "-")}</td>
                  <td class="score ${scoreClass(rate)}">${recordScoreText(record)}</td>
                  <td>${rate === null ? "-" : `${rate}%`}</td>
                  <td>${minutesText(record.minutes) || "-"}</td>
                  <td class="note-cell" title="${escapeAttr(record.note)}">${escapeHtml(record.note || "-")}</td>
                  <td><div class="row-actions">
                    ${recordEditAction(record.id)}
                    ${recordRemoveAction(record.id)}
                  </div></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function recordEmptyState({ title, note, subject = "", source = "" }) {
  return `
    <div class="empty-state">
      ${icon("clipboard-list")}
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(note)}</span>
      <div class="head-actions">
        <button class="primary-btn" type="button" data-open-entry-subject="${escapeAttr(subject || "数学一")}"${source ? ` data-entry-source="${escapeAttr(source)}"` : ""}>${icon("plus")} 录入第一条记录</button>
        <button class="secondary-btn" type="button" data-screen="plan">${icon("calendar-range")} 先去排今日计划</button>
      </div>
    </div>
  `;
}

/** 表内可编辑备注：失焦或回车直接写回记录，不用弹窗。 */
function noteInputHTML(record, placeholder = "点这里写备注") {
  const label = `备注 ${record.subject || ""} ${record.module || ""}`.trim();
  return `<input class="note-input" type="text" value="${escapeAttr(record.note || "")}" placeholder="${escapeAttr(placeholder)}" data-note-record="${escapeAttr(record.id)}" aria-label="${escapeAttr(label || "备注")}" />`;
}

/** 错题汇总：按模块和按真题各排一张榜，含条数、失分、得分率、待复盘。 */
function mistakeSummaryHTML(records, { limit = 8 } = {}) {
  const list = (records || []).filter(isMistakeRecord);
  const byModule = mistakeBuckets(list, (record) => record.module || record.paper || record.source || "未填模块").slice(0, limit);
  const byPaper = mistakeBuckets(list, mistakePaperKey).slice(0, limit);
  const totalLost = sumBy(list, (record) => Math.max(0, Number(record.full) - Number(record.score)));
  const rate = weightedRate(list);
  const rowsHTML = (rows, emptyText) =>
    rows.length
      ? rows
          .map(
            (row) => `
              <div class="data-row wide-status">
                <span class="label">${escapeHtml(row.name)}</span>
                ${progressBar(row.rate === null ? 0 : row.rate, rateTone(row.rate))}
                <span class="value">${row.rate === null ? "—" : `${row.rate}%`}</span>
                <span class="status tag ${rateTone(row.rate)}">${row.count} 条 · 失分 ${row.lost} · 待复盘 ${row.pending}</span>
              </div>
            `,
          )
          .join("")
      : `<div class="empty-state compact">${icon("notebook-tabs")}<strong>${emptyText}</strong><span>录入错题时填上模块或年份，这里会自动分组。</span></div>`;

  return `
    <section class="card card-pad span-12">
      <div class="card-head">
        <div>
          <h2 class="card-title">错题汇总</h2>
          <p class="card-note">同一批错题按模块、按真题各排一遍；失分多的排前面，分成几块一目了然。</p>
        </div>
        <div class="head-actions">
          <span class="tag red">${list.length} 条错题 · 累计失分 ${totalLost}</span>
          <span class="tag ${rateTone(rate)}">整体得分率 ${rate === null ? "—" : `${rate}%`}</span>
        </div>
      </div>
      <div class="split-2">
        <div>
          <div class="list-title">${icon("layers")} 按模块 / 考点</div>
          <div class="data-list">${rowsHTML(byModule, "还没有带模块的错题")}</div>
        </div>
        <div>
          <div class="list-title">${icon("file-text")} 按真题 / 试卷</div>
          <div class="data-list">${rowsHTML(byPaper, "还没有带年份的错题")}</div>
        </div>
      </div>
      <button class="secondary-btn full-btn" type="button" data-screen="mistakes">${icon("notebook-tabs")} 去错题本逐题复盘</button>
    </section>
  `;
}

/** 真题 / 整套卷成绩汇总：一份卷一行，备注直接在表里改。 */
function paperScoreHTML(records, { limit = 12, title = "真题成绩汇总" } = {}) {
  const rows = wholePaperRows(records).slice(0, limit);
  const average = weightedRate(
    (records || []).filter((record) => Number(record.full) > 0 && subjectKeyOf(record) !== "english"),
  );
  return `
    <section class="card card-pad span-12">
      <div class="card-head">
        <div>
          <h2 class="card-title">${escapeHtml(title)}</h2>
          <p class="card-note">每一份真题 / 整套卷一行；备注栏点一下就能写，写完自动存进这条记录。</p>
        </div>
        <div class="head-actions">
          <span class="tag blue">${rows.length} 份卷</span>
          <span class="tag ${rateTone(average)}">卷面平均 ${average === null ? "—" : `${average}%`}</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="paper-table">
          <thead>
            <tr><th>日期</th><th>科目 / 试卷</th><th>得分</th><th>得分率</th><th>状态</th><th>备注（可直接改）</th><th>操作</th></tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows
                    .map(
                      (row) => `
                        <tr>
                          <td>${escapeHtml(row.date || "-")}</td>
                          <td><span class="year-cell">${escapeHtml(row.label || row.subject || "-")}</span></td>
                          <td class="score">${row.score}/${row.full}</td>
                          <td>${row.rate === null ? "-" : `${row.rate}%`}</td>
                          <td><span class="tag ${row.pending ? "amber" : "green"}">${row.pending ? "待复盘" : "已复盘"}</span></td>
                          <td>${noteInputHTML({ id: row.id, note: row.note, subject: row.subject, module: row.module })}</td>
                          <td>${recordEditAction(row.id)}</td>
                        </tr>
                      `,
                    )
                    .join("")
                : `<tr><td colspan="7">还没有满分的整卷记录；录入时填上「满分」和「得分」，这里就按卷统计。</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDashboard() {
  const profile = STORE ? STORE.profile() : null;
  const tasks = STORE ? STORE.tasks() : [];
  const records = STORE ? STORE.records() : [];
  const todayTasks = STORE ? STORE.tasksOf(TODAY_KEY) : [];
  const tomorrowKey = dateKey(shiftDate(1));
  const tomorrowTasks = STORE ? STORE.tasksOf(tomorrowKey) : [];
  const todayDone = todayTasks.filter((task) => task.done).length;
  const todayPercent = todayTasks.length ? Math.round((todayDone / todayTasks.length) * 100) : 0;
  const todayMinutes = todayTasks.reduce((sum, task) => sum + (task.done ? task.minutes || 0 : 0), 0);
  const week = weekKeys();
  const weekTasks = tasks.filter((task) => week.includes(task.date));
  const weekDone = weekTasks.filter((task) => task.done).length;
  const weekPercent = weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0;
  const target = profile ? profile.target : { math: 0, english: 0, cs408: 0, politics: 0 };
  const targetTotal = target.math + target.english + target.cs408 + (profile?.showPolitics ? target.politics : 0);
  const examKey = profile?.examDate || "";
  const examDate = examKey ? new Date(`${examKey}T00:00:00+08:00`) : null;
  const examDays = examDate && !Number.isNaN(examDate.getTime()) ? Math.max(0, Math.ceil((examDate - today) / DAY_MS)) : daysLeft;
  const entered = STORE ? STORE.enteredChapters() : 0;
  const rates = subjectRates(records);
  const trend = scoreTrend(records, 90);
  const mastery = moduleMasteryRows(records, 8);
  const pendingReview = sortedByDate(pendingReviewRecords(records), -1);
  return `
    <div class="page-head">
      <div>
        <h1>XXRJ · 备考总览</h1>
        <p class="page-desc">${todayText} · 目标 ${targetTotal} 分 · 政治模块${profile?.showPolitics ? "已开启" : "默认关闭，可在目标设置里开启"}</p>
      </div>
      <div class="head-actions">
        <span class="tag ${todayTasks.length && todayDone === todayTasks.length ? "coral" : "blue"}">${icon("flame")} ${todayTasks.length ? `今日 ${todayDone}/${todayTasks.length} 项` : "今天还没安排"}</span>
        <button class="secondary-btn" type="button" data-task-new="${TODAY_KEY}">${icon("plus")} 加任务</button>
        <button class="secondary-btn" type="button" data-screen="goal">${icon("settings-2")} 目标设置</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({
        label: "距初试",
        value: examDays,
        unit: "天",
        sub: examKey ? `按目标日期 ${examKey} 计算` : "在目标设置里填考试日期",
        iconName: "timer",
        accent: "red",
      })}
      ${kpiCard({
        label: "今日进度",
        value: `${todayDone}/${todayTasks.length}`,
        unit: "项",
        sub: todayTasks.length ? `已完成 ${todayDone} 项 · 用时 ${minutesText(todayMinutes) || "0 分钟"}` : "今天还没有任务，点「加任务」随时布置",
        iconName: "list-checks",
        accent: "blue",
      })}
      ${kpiCard({
        label: "本周完成",
        value: `${weekDone}/${weekTasks.length}`,
        unit: "项",
        sub: weekTasks.length ? `完成率 ${weekPercent}% · 周一到周日` : "本周还没有安排任务",
        iconName: "calendar-check-2",
        accent: "coral",
      })}
      ${kpiCard({
        label: "已录入",
        value: records.length,
        unit: "条",
        sub: `章节进度 ${entered} 章 · 数学按书分开统计`,
        iconName: "database",
        accent: "violet",
      })}
    </div>

    <section class="card card-pad llyc-card">
      <div class="card-head">
        <div>
          <h2 class="card-title">恋练有词 · 每日学习</h2>
          <p class="card-note">数据从词汇库的背词记录直接读；词卡上「斩 · 已会」的词算已会，不再排进待背。</p>
        </div>
        <span class="tag violet">${icon("book-marked")} 恋练有词 2027</span>
      </div>
      <div id="llycPanel" class="llyc-panel"></div>
    </section>

    <div class="grid">
      ${dailyReviewSummaryHTML()}
      ${mistakeSummaryHTML(records)}
      ${paperScoreHTML(records)}

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">今日进度</h2>
            <p class="card-note">今天计划里的任务，勾一条变一条，随时改。</p>
          </div>
          <button class="secondary-btn compact" type="button" data-task-new="${TODAY_KEY}">${icon("plus")} 加任务</button>
        </div>
        <div class="ring-layout">
          <div class="ring" style="--p:${todayPercent}">
            <div class="ring-center">
              <strong>${todayPercent}%</strong>
              <span>今日完成</span>
            </div>
          </div>
          <div class="task-list">
            ${
              todayTasks.length
                ? todayTasks
                    .slice(0, 5)
                    .map((task) =>
                      taskItem(
                        escapeHtml(task.title),
                        `${task.subject ? `${escapeHtml(task.subject)} · ` : ""}${minutesText(task.minutes) || "未填用时"} · ${escapeHtml(task.priority)}优先`,
                        task.done,
                      ),
                    )
                    .join("")
                : `<div class="empty-state compact">${icon("calendar-plus")}<strong>今天还没有任务</strong><span>点右上角「加任务」，不用提前一天布置。</span></div>`
            }
          </div>
        </div>
        <div class="mini-note">${icon("sparkles")} 计划随时能加、能改、能删，做完直接勾掉。</div>
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">明日计划</h2>
            <p class="card-note">${tomorrowKey} · ${weekdayText(tomorrowKey)} · ${tomorrowTasks.length ? `已排 ${minutesText(tomorrowTasks.reduce((sum, task) => sum + (task.minutes || 0), 0)) || "0 分钟"}` : "还没安排"}</p>
          </div>
          <button class="secondary-btn compact" type="button" data-task-new="${tomorrowKey}">${icon("plus")} 加一项</button>
        </div>
        ${planTaskList(tomorrowTasks, "明天还没有安排")}
      </section>

      <section class="card card-pad span-3">
        <div class="card-head">
          <div>
            <h2 class="card-title">推荐计划</h2>
            <p class="card-note">按近 14 天录入成绩的得分率排序，低分优先。</p>
          </div>
          ${icon("wand-sparkles")}
        </div>
        <div class="recommend-stack">
          ${
            rates.length
              ? rates
                  .slice(0, 3)
                  .map(
                    (item) => `
                      <div class="recommend-item">
                        <span class="tag ${item.rate < 60 ? "red" : item.rate < 75 ? "amber" : "blue"}">${item.rate < 60 ? "优先补强" : item.rate < 75 ? "继续跟进" : "保持手感"}</span>
                        <p>${escapeHtml(item.subject)} · 近 14 天得分率 ${item.rate}%</p>
                        <span>${item.count} 条录入记录</span>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="empty-state compact">${icon("chart-line")}<strong>还没有成绩记录</strong><span>录入成绩后，这里按最近 14 天得分率给出优先项。</span></div>`
          }
        </div>
        <button class="secondary-btn full-btn" type="button" data-task-new="${tomorrowKey}">${icon("calendar-plus")} 新增明日任务</button>
      </section>

      <section class="card card-pad span-8">
        <div class="card-head">
          <div>
            <h2 class="card-title">各科得分率趋势</h2>
            <p class="card-note">近 90 天录入的得分率，按日期取点；至少要两次记录才会连线。</p>
          </div>
          <span class="tag blue">${icon("chart-line")} 近 90 天</span>
        </div>
        ${
          trend.series.length
            ? `<div class="legend">
                ${trend.series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.name)}</span>`).join("")}
              </div>
              ${lineChart(trend.labels, trend.series)}`
            : lineChart([], [])
        }
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">本周节奏</h2>
            <p class="card-note">按本周计划任务的完成情况统计，点「计划」页可以随时调整。</p>
          </div>
          <span class="tag ${weekTasks.length ? (weekPercent >= 80 ? "coral" : weekPercent >= 50 ? "amber" : "red") : "blue"}">${weekTasks.length ? `完成 ${weekDone}/${weekTasks.length}` : "本周还没安排"}</span>
        </div>
        <div class="week-strip">
          ${week
            .map((key, index) => {
              const dayTasks = tasks.filter((task) => task.date === key);
              const done = dayTasks.filter((task) => task.done).length;
              const value = dayTasks.length ? Math.round((done / dayTasks.length) * 100) : 0;
              const status = !dayTasks.length ? "未安排" : done === dayTasks.length ? "完成" : done ? "进行中" : "未开始";
              const focus = dayTasks.length ? dayTasks[0].title : "还没有安排";
              return `
                <div class="day-card${key === TODAY_KEY ? " today" : ""}">
                  <div class="day-top"><strong>${["一", "二", "三", "四", "五", "六", "日"][index]}</strong><span>${status}</span></div>
                  <p>${escapeHtml(focus)}</p>
                  ${progressBar(value, value === 100 ? "green" : value > 0 ? "blue" : "")}
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">模块掌握度</h2>
            <p class="card-note">按你录入的考点 / 模块计算得分率，低的排前面。</p>
          </div>
          <button class="ghost-btn" data-screen="summary">成绩汇总 ${icon("arrow-right")}</button>
        </div>
        <div class="data-list">
          ${
            mastery.length
              ? mastery
                  .map(
                    (item) => `
                <div class="data-row wide-status">
                  <span class="label">${escapeHtml(item.name)}</span>
                  ${progressBar(item.rate, rateTone(item.rate))}
                  <span class="value">${item.rate}%</span>
                  <span class="status tag ${rateTone(item.rate)}">${rateToneText(item.rate)} · ${item.count} 条</span>
                </div>
              `,
                  )
                  .join("")
              : `<div class="empty-state compact">${icon("layers")}<strong>还没有模块数据</strong><span>录入成绩时填上考点 / 模块，这里就会按得分率排出来。</span></div>`
          }
        </div>
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">优先复盘</h2>
            <p class="card-note">错误次数多、间隔到期或标记“一直不会”的题。</p>
          </div>
          <span class="tag ${pendingReview.length ? "red" : "blue"}">${pendingReview.length ? `${pendingReview.length} 题待复盘` : "没有待复盘"}</span>
        </div>
        <div class="review-list">
          ${
            pendingReview.length
              ? pendingReview
                  .slice(0, 4)
                  .map((record, index) =>
                    reviewItem(
                      String(index + 1).padStart(2, "0"),
                      escapeHtml(`${record.subject || ""} ${record.module || record.source || ""} ${record.question || ""}`.trim() || "错题"),
                      escapeHtml(`${record.source || ""}${record.errorType ? ` · ${record.errorType}` : ""} · ${nextReviewRoundText(record)} · ${record.reviewDate ? `${record.reviewDate} 到期` : "未排期"}`),
                      record.status === "一直不会的题" ? "red" : rateTone(recordRate(record)),
                      reviewOpenButton(record),
                    ),
                  )
                  .join("")
              : `<div class="empty-state compact">${icon("notebook-tabs")}<strong>没有待复盘的题</strong><span>录入错题并标注下次复盘时间后，这里会按到期顺序提醒。</span></div>`
          }
        </div>
        <button class="secondary-btn full-btn" type="button" data-screen="mistakes">${icon("notebook-tabs")} 打开错题本</button>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">每日刷题热力图</h2>
            <p class="card-note">最近 12 周 · 每一门一行，格内上面是完成题数、下面是复盘题数；颜色越深当天完成越多。</p>
          </div>
          <div class="heat-legend">
            <span class="heat-legend-item"><b>上</b> 完成题数</span>
            <span class="heat-legend-item"><b>下</b> 复盘题数</span>
            <span class="heat-legend-item">少 <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> 多</span>
            <span class="heat-legend-item"><i class="is-review"></i> 只复盘</span>
          </div>
        </div>
        ${heatmap()}
        <p class="heat-note">复盘按错题「上次复盘日」和知识点复盘日志统计，同一道题更早的复盘记录无法还原；鼠标停在格子上可看当天轮次拆解。</p>
      </section>
    </div>
  `;
}

/** 英语页：KPI、得分率、逐年阅读和记录表全部从 STORE 的英语记录推导。 */
function renderEnglish() {
  const records = STORE ? recordsOfSubject("english") : [];
  const sorted = sortedByDate(records, -1);
  const latest = sorted[0] || null;
  const latestRate = latest ? recordRate(latest) : null;
  const average = weightedRate(records);
  const pending = pendingReviewRecords(records).length;
  const kindRows = englishKindRows(records);
  const readBuckets = [...groupBy(
    records.filter((record) => `${record.module} ${record.source}`.includes("阅读") && record.year),
    (record) => String(record.year),
  ).entries()]
    .map(([year, list]) => ({ year, rate: weightedRate(list) ?? 0, count: list.length }))
    .sort((left, right) => left.year.localeCompare(right.year))
    .slice(-8);
  const modules = moduleMasteryRows(records, 8);
  return `
    <div class="page-head">
      <div>
        <h1>英语一 / 英语二</h1>
        <p class="page-desc">英语一和英语二的记录都在这里，按模块和年份汇总；背词进度看词汇库。</p>
      </div>
      <div class="head-actions">
        <a class="secondary-btn" href="/vocab.html">${icon("book-marked")} 打开词汇库</a>
        <button class="primary-btn" type="button" data-open-entry-subject="英语一" data-entry-source="英语一真题">${icon("plus")} 录入英语成绩</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({ label: "录入记录", value: records.length, unit: "条", sub: latest ? `最近 ${escapeHtml(latest.date || "未填日期")}` : "还没有英语记录", iconName: "database", accent: "blue" })}
      ${kpiCard({ label: "最近一次得分率", value: latestRate === null ? "—" : latestRate, unit: latestRate === null ? "" : "%", sub: latest ? escapeHtml(`${latest.module || latest.source || latest.subject}`) : "录入后自动统计", iconName: "file-check-2", accent: "coral" })}
      ${kpiCard({ label: "平均得分率", value: average === null ? "—" : average, unit: average === null ? "" : "%", sub: records.length ? `${records.length} 条记录加权平均` : "按满分 / 题数加权", iconName: "trending-up", accent: "violet" })}
      ${kpiCard({ label: "待复盘", value: pending, unit: "题", sub: pending ? "到期的错题去错题本复盘" : "没有到期的错题", iconName: "notebook-tabs", accent: "amber" })}
    </div>
    ${
      records.length
        ? `
    <div class="grid">
      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">整套卷 / 单纯阅读 / 其他模块</h2>
            <p class="card-note">三类分开算得分率，整套卷的分数不会把单篇阅读拉高。录入时选「英语类型」，没选的按满分和模块自动归类。</p>
          </div>
          <span class="tag blue">${records.length} 条英语记录</span>
        </div>
        <div class="data-list">
          ${kindRows
            .map(
              (row) => `
                <div class="data-row">
                  <span class="label">${escapeHtml(row.label)}</span>
                  ${progressBar(row.rate === null ? 0 : row.rate, rateTone(row.rate))}
                  <span class="value">${row.rate === null ? "—" : `${row.rate}%`}</span>
                  <span class="status tag ${rateTone(row.rate)}">${row.count} 条 · 失分 ${row.lost} · 待复盘 ${row.pending}</span>
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="mini-note">${icon("info")} 「整套卷」按卷面满分算分；「单纯阅读」「其他模块」按题数或小分算，两者不混在一起。</div>
      </section>

      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">阅读逐年得分率</h2>
            <p class="card-note">录入阅读记录时填上「年份」，这里按年对比。</p>
          </div>
          <span class="tag blue">${readBuckets.length} 个年份</span>
        </div>
        ${
          readBuckets.length
            ? barChart(readBuckets.map((item) => item.year), readBuckets.map((item) => item.rate))
            : `<div class="empty-state compact">${icon("bar-chart-3")}<strong>还没有阅读年份数据</strong><span>录一条阅读记录并填上「年份」，这里自动生成对比图。</span></div>`
        }
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">题型得分率</h2>
            <p class="card-note">按模块聚合，低的排前面。</p>
          </div>
        </div>
        <div class="data-list">
          ${
            modules.length
              ? modules
                  .map(
                    (item) => `
                <div class="data-row">
                  <span class="label">${escapeHtml(item.name)}</span>
                  ${progressBar(item.rate, rateTone(item.rate))}
                  <span class="value">${item.rate}%</span>
                  <span class="status tag ${rateTone(item.rate)}">${rateToneText(item.rate)}</span>
                </div>
              `,
                  )
                  .join("")
              : `<div class="empty-state compact">${icon("layers")}<strong>还没有模块数据</strong><span>录入时填「模块 / 题型」，这里按得分率排序。</span></div>`
          }
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">全部英语记录</h2>
            <p class="card-note">改一条、删一条，上面的统计立刻跟着变。</p>
          </div>
        </div>
        ${recordTableHTML(sorted, 12)}
      </section>
    </div>`
        : `
    <section class="card card-pad">
      ${recordEmptyState({
        title: "英语还没有记录",
        note: "做完一套真题或一个模块后录一次，这里会自动生成得分率和薄弱项。",
        subject: "英语一",
        source: "英语一真题",
      })}
    </section>`
    }
  `;
}
const ANNOTATE_TYPES = [
  { key: "concept", label: "概念不清", tone: "red" },
  { key: "calc", label: "计算错误", tone: "amber" },
  { key: "method", label: "方法不会", tone: "coral" },
  { key: "read", label: "审题错误", tone: "blue" },
  { key: "time", label: "时间不足", tone: "violet" },
];

const ANNOTATE_STATUS = ["一直不会", "需加强", "正常", "已消灭"];
const ANNOTATE_NEXT = ["今天", "1 天后", "3 天后", "7 天后"];

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
              <p class="annotate-hint" data-ann-next-hint>复盘日：${reviewDateFromNext(data.annNext || "3 天后")}</p>
            </div>
            <div class="annotate-field count-field">
              <label>第几次复盘</label>
              <div class="count-stepper">
                <button type="button" data-count-delta="-1" aria-label="减少复盘次数">-</button>
                <input type="number" min="0" step="1" data-ann-review-count value="${escapeAttr(data.annReview || 1)}" aria-label="第几次复盘">
                <button type="button" data-count-delta="1" aria-label="增加复盘次数">+</button>
                <span>次</span>
              </div>
              <p class="annotate-hint">默认是下一次的编号，也可以自己改成任意第几次。</p>
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
            <div class="annotate-field wide">
              <label>本次复盘</label>
              <label class="annotate-check">
                <input type="checkbox" data-ann-done checked />
                <span>今天完成这次复盘，记进「上次复盘」；下次日期看上面的选择</span>
              </label>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

/** 「存进笔记」写的就是面板上这几项，内容全部来自自己的录入。 */
function analysisNoteSummary(record) {
  const types = errorTypeKeysOf(record);
  const rate = recordRate(record);
  return [
    `【分析 ${TODAY_KEY}】`,
    types.length ? `错因 ${types.join("、")}` : "错因未标注",
    record.module ? `考点 ${record.module}` : "",
    rate === null ? "" : `得分率 ${rate}%`,
    `掌握状态 ${annotateStatusText(record)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 分析面板只读当前 iball 账号的数据：错因、同考点记录和按年份的自我统计。 */
function analysisPanelHTML(button) {
  const id = button.dataset.analyze;
  const record = STORE ? STORE.getRecord(id) : null;
  if (!record) return "";
  const keyword = String(record.module || record.source || "").split(/[·\s]/).filter(Boolean)[0] || "";
  const related = recordsAll()
    .filter((item) => item.id !== record.id && keyword)
    .filter((item) => `${item.module} ${item.source} ${item.paper} ${item.question}`.includes(keyword))
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, 6);
  const years = [...new Set(related.map((item) => Number(item.year)).filter((year) => year >= 2016 && year <= 2025))].sort((left, right) => left - right);
  const decade = Array.from({ length: 10 }, (_, index) => 2016 + index);
  const latestYear = years.length ? years[years.length - 1] : null;
  const hitYears = new Set(years);
  const heat = years.length >= 3
    ? { label: "自有记录里高频", tone: "red", total: years.length }
    : years.length
      ? { label: "出现过", tone: "amber", total: years.length }
      : { label: "暂无年份记录", tone: "blue", total: 0 };
  const types = errorTypeKeysOf(record);
  const noteLines = String(record.note || "")
    .split(/\n|；|;|。/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
  const rate = recordRate(record);
  const pitfalls = [
    ...(types.length ? [{ title: types.join(" + "), text: "这是你在标注里选中的错因，下次做题前先把对应的检查动作写在草稿纸上。" }] : []),
    ...noteLines.map((line, index) => ({ title: `笔记 ${index + 1}`, text: line })),
  ];
  if (!pitfalls.length) {
    pitfalls.push({ title: "还没有错因笔记", text: "点下面「标注」写下为什么错、卡在哪一步，这里就会显示出来。" });
  }
  const mainChips = [record.module, record.question].filter(Boolean);
  const preChips = [record.source, record.paper, record.subject, record.year].filter(Boolean);
  return `
    <tr class="analysis-panel-row" data-analysis-panel="${escapeAttr(id)}" data-analysis-id="${escapeAttr(id)}">
      <td colspan="99">
        <div class="analysis-panel">
          <div class="analysis-head">
            <div class="analysis-title">
              <span class="analysis-icon">${icon("sparkles")}</span>
              <div>
                <strong>${escapeHtml(button.dataset.analysisTitle || "错题分析")}</strong>
                <span>基于当前账号的 ${related.length + 1} 条同考点记录${rate === null ? "" : ` · 本条得分率 ${rate}%`}</span>
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
                ${pitfalls
                  .map(
                    (item) => `
                      <li>
                        <strong>${escapeHtml(item.title)}</strong>
                        <span>${escapeHtml(item.text)}</span>
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
                  ${mainChips.length ? mainChips.map((label) => `<span class="knowledge-chip main">${escapeHtml(label)}</span>`).join("") : '<span class="knowledge-chip main">未填模块</span>'}
                </div>
              </div>
              <div class="knowledge-group">
                <label>来源与年份</label>
                <div class="chip-row">
                  ${preChips.length ? preChips.map((label) => `<span class="knowledge-chip">${escapeHtml(label)}</span>`).join("") : '<span class="knowledge-chip">未填来源</span>'}
                </div>
              </div>
              <div class="related-list">
                <label>同考点记录</label>
                ${
                  related.length
                    ? related
                        .map(
                          (item) => `
                      <div class="related-item">
                        <span>${escapeHtml(`${item.date || ""} ${item.source || item.subject || ""} ${item.question || ""}`.trim())}</span>
                        <small>${escapeHtml(recordScoreText(item))}</small>
                        ${icon("chart-line")}
                      </div>
                    `,
                        )
                        .join("")
                    : '<span class="related-empty">还没有同考点记录</span>'
                }
              </div>
            </section>
            <section class="analysis-block">
              <h3>${icon("chart-no-axes-column")} 同考点年份分布</h3>
              <div class="freq-summary">
                <div><strong>${years.length}</strong><span>年 / 10 年</span></div>
                <span class="tag ${heat.tone}">${heat.label}</span>
              </div>
              <div class="freq-metrics">
                <div><span>同考点记录</span><strong>${related.length} 条</strong></div>
                <div><span>最近年份</span><strong>${latestYear ?? "—"}</strong></div>
              </div>
              <div class="freq-strip" role="img" aria-label="2016 至 2025 年中你有 ${years.length} 个年份的同考点记录">
                ${decade
                  .map(
                    (year) => `
                    <span class="freq-cell ${hitYears.has(year) ? "hit" : ""} ${year === latestYear ? "latest" : ""}" title="${year} 年${hitYears.has(year) ? "有你录入的同考点记录" : "暂无记录"}">
                      <i></i><em>${String(year).slice(2)}</em>
                    </span>
                  `,
                  )
                  .join("")}
              </div>
              <div class="freq-recent">
                <label>最近一次同考点</label>
                <strong>${escapeHtml(related[0] ? `${related[0].date || ""} ${related[0].source || related[0].subject || ""}`.trim() : "还没有记录")}</strong>
                <span>${escapeHtml(related[0] ? `${related[0].module || related[0].paper || ""} · ${recordScoreText(related[0])}` : "录入同考点记录后自动汇总")}</span>
              </div>
              <div class="freq-method">
                <label>统计口径</label>
                <span>只看当前 iball 账号里模块关键词相同、且填了年份的记录，不是全量题库统计。</span>
              </div>
              <div class="freq-source">
                <label>数据来源</label>
                <span>XXRJ · 成绩录入（本地 + iball 账号同步）</span>
              </div>
            </section>
          </div>
          <div class="analysis-foot">
            <span class="analysis-note">${icon("info")} 由你自己的录入数据生成，不会编造考频。</span>
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
function toggleAnnotation(button) {
  const id = button.dataset.annotate;
  const existing = document.querySelector(`[data-annotate-panel="${id}"]`);
  document.querySelectorAll("[data-annotate-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analysis-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-cs408-panel]").forEach((row) => row.remove());
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

/** 复盘队列里的入口：不在错题本就先切过去，再展开这条记录的复盘面板。 */
function openReviewPanel(id) {
  if (!id) return;
  const button = document.querySelector(`[data-annotate="${id}"]`);
  if (button) {
    toggleAnnotation(button);
    return;
  }
  state.screen = "mistakes";
  history.replaceState(null, "", `?screen=mistakes&subject=${state.subject}`);
  render();
  window.setTimeout(() => {
    const target = document.querySelector(`[data-annotate="${id}"]`);
    if (target) toggleAnnotation(target);
  }, 0);
}

function toggleAnalysis(button) {
  const id = button.dataset.analyze;
  const existing = document.querySelector(`[data-analysis-panel="${id}"]`);
  document.querySelectorAll("[data-analysis-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analyze]").forEach((item) => item.setAttribute("aria-expanded", "false"));
  document.querySelectorAll("[data-cs408-panel]").forEach((row) => row.remove());
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

/** 面板内容全部来自当前账号的录入数据，重新生成＝按最新记录重算一次。 */
function refreshAnalysis(button) {
  const panelRow = button.closest("[data-analysis-panel]");
  if (!panelRow) return;
  const id = panelRow.dataset.analysisPanel;
  const sourceButton = document.querySelector(`[data-analyze="${id}"]`);
  if (!sourceButton) return;
  const next = analysisPanelHTML(sourceButton);
  if (!next) return;
  panelRow.insertAdjacentHTML("beforebegin", next);
  panelRow.remove();
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  const nextRow = document.querySelector(`[data-analysis-panel="${id}"]`);
  if (!nextRow) return;
  nextRow.classList.add("is-fresh");
  nextRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** 「今天 / 1 天后 / 3 天后 / 7 天后」换算成具体日期，写进记录里。 */
function reviewDateFromNext(next) {
  const days = next === "今天" ? 0 : next === "1 天后" ? 1 : next === "3 天后" ? 3 : next === "7 天后" ? 7 : 3;
  return dateKey(new Date(Date.parse(`${TODAY_KEY}T00:00:00`) + days * DAY_MS));
}

function countCellHTML(record) {
  return `
    <div class="count-cell" title="${escapeAttr(reviewSummaryText(record))}">
      <span><strong>${Math.max(0, Math.round(Number(record.reviewCount) || 0))}</strong> 复盘</span>
      <span><strong>${Math.max(0, Math.round(Number(record.errorCount) || 0))}</strong> 错误</span>
    </div>
  `;
}

/** 标注结果写回 STORE，订阅者会用新数据重绘表格，刷新页面也不会丢。 */
function saveAnnotation(saveButton) {
  const panelRow = saveButton.closest("[data-annotate-panel]");
  if (!panelRow) return;
  const id = panelRow.dataset.annotatePanel;
  const record = STORE && id ? STORE.getRecord(id) : null;
  if (!record) {
    panelRow.remove();
    return;
  }
  const types = [...panelRow.querySelectorAll("[data-annotate-type].active")].map((button) => button.dataset.annotateType);
  const statusButton = panelRow.querySelector("[data-annotate-status].active");
  const nextButton = panelRow.querySelector("[data-annotate-next].active");
  const status = statusButton ? statusButton.dataset.annotateStatus : annotateStatusText(record);
  const next = nextButton ? nextButton.dataset.annotateNext : "3 天后";
  const readCount = (selector, fallback) => {
    const input = panelRow.querySelector(selector);
    const value = Math.round(Number(input ? input.value : NaN));
    return Number.isFinite(value) ? Math.max(0, value) : fallback;
  };
  const noteInput = panelRow.querySelector(".annotate-note");
  const doneInput = panelRow.querySelector("[data-ann-done]");
  const doneToday = doneInput ? doneInput.checked : true;
  STORE.upsertRecord({
    id,
    errorType: types.join("、"),
    status: status === "一直不会" ? "一直不会的题" : status,
    reviewCount: readCount("[data-ann-review-count]", record.reviewCount || 0),
    errorCount: readCount("[data-ann-error-count]", record.errorCount || 0),
    reviewDate: reviewDateFromNext(next),
    lastReviewDate: doneToday ? TODAY_KEY : record.lastReviewDate || "",
    note: noteInput ? noteInput.value.slice(0, 2000) : record.note,
  });
  panelRow.remove();
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

/* ------------------------------------------------- 封神之路 · 数学资料 */

function mathBook() {
  return YM_BY_KEY[state.mathResource] || YM_BOOKS[0] || null;
}

const MATH_ROUNDS = [
  { value: 1, label: "一刷", plan: "基础覆盖" },
  { value: 2, label: "二刷", plan: "强化巩固" },
  { value: 3, label: "三刷", plan: "错题回炉" },
  { value: 4, label: "四刷", plan: "套卷冲刺" },
  { value: 5, label: "五刷", plan: "考前保温" },
];

function cleanMathRound(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 1;
  return Math.max(1, Math.min(5, number));
}

function mathRoundMeta(value) {
  const round = cleanMathRound(value);
  return MATH_ROUNDS.find((item) => item.value === round) || MATH_ROUNDS[0];
}

function mathBookRoundKey(bookKey) {
  return `math:${bookKey}`;
}

function mathBookRound(bookKey) {
  return STORE ? cleanMathRound(STORE.bookRound(mathBookRoundKey(bookKey))) : 1;
}

function clampIndex(value, length) {
  return length ? Math.max(0, Math.min(Number(value) || 0, length - 1)) : 0;
}

/** 每本书、每个分册、每一章单独一个进度键，互不共用。 */
function mathProgressKey(bookKey, sectionName, chapter, round = mathBookRound(bookKey)) {
  return `math:${bookKey}:r${cleanMathRound(round)}:${sectionName}:${chapter}`;
}

/** v1 的旧进度没有轮次字段，统一按一刷读取；保存一刷后写入新键。 */
function legacyMathProgressKey(bookKey, sectionName, chapter) {
  return `math:${bookKey}:${sectionName}:${chapter}`;
}

function mathChapterInfo(book, section, chapter, round = mathBookRound(book.key)) {
  const normalizedRound = cleanMathRound(round);
  const key = mathProgressKey(book.key, section.name, chapter, normalizedRound);
  const legacyKey = legacyMathProgressKey(book.key, section.name, chapter);
  const saved = STORE
    ? STORE.progressOf(key) || (normalizedRound === 1 ? STORE.progressOf(legacyKey) : null)
    : null;
  const done = saved ? saved.done : 0;
  const total = saved ? saved.total : 0;
  const accuracy = saved ? saved.accuracy : 0;
  const wrong = saved ? saved.wrong : 0;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : done ? 100 : 0;
  return { saved, done, total, accuracy, wrong, percent, entered: Boolean(saved), round: normalizedRound, key, legacyKey };
}

function mathSectionStats(book, section, round = mathBookRound(book.key)) {
  const chapters = Array.isArray(section.chapters) ? section.chapters : [];
  let done = 0;
  let total = 0;
  let wrong = 0;
  let accuracyWeight = 0;
  let entered = 0;
  for (const chapter of chapters) {
    const info = mathChapterInfo(book, section, chapter, round);
    done += info.done;
    total += info.total;
    wrong += info.wrong;
    accuracyWeight += info.accuracy * (info.done || 1);
    if (info.entered) entered += 1;
  }
  const accuracy = done ? Math.round(accuracyWeight / done) : 0;
  return { done, total, wrong, accuracy, entered, chapters: chapters.length };
}

function mathBookStats(book, round = mathBookRound(book.key)) {
  let done = 0;
  let total = 0;
  let wrong = 0;
  let accuracyWeight = 0;
  let entered = 0;
  let chapters = 0;
  for (const section of book.sections || []) {
    const stats = mathSectionStats(book, section, round);
    done += stats.done;
    total += stats.total;
    wrong += stats.wrong;
    accuracyWeight += stats.accuracy * (stats.done || 1);
    entered += stats.entered;
    chapters += stats.chapters;
  }
  return {
    done,
    total,
    wrong,
    entered,
    chapters,
    accuracy: done ? Math.round(accuracyWeight / done) : 0,
  };
}

function mathRoundStats(book, round = mathBookRound(book.key)) {
  const normalizedRound = cleanMathRound(round);
  if (book.kind === "zhenti") {
    const years = Array.isArray(book.years) ? book.years.length : 0;
    const records = STORE
      ? STORE.records().filter((record) => mathRecordMatch(record, book) && cleanMathRound(record.round) === normalizedRound)
      : [];
    const done = records.length;
    return {
      done,
      total: years,
      chapters: years,
      entered: done,
      percent: years ? Math.min(100, Math.round((done / years) * 100)) : 0,
      summary: `${done}/${years || "未设"} 套`,
    };
  }
  const stats = mathBookStats(book, normalizedRound);
  return {
    ...stats,
    percent: stats.chapters ? Math.min(100, Math.round((stats.entered / stats.chapters) * 100)) : 0,
    summary: `${stats.entered}/${stats.chapters} 章`,
  };
}

/** 这本书在指定轮次里的全部成绩记录；轮次、书籍都互不混用。 */
function mathBookRecords(book, round = mathBookRound(book.key)) {
  const normalizedRound = cleanMathRound(round);
  return STORE
    ? STORE.records().filter((record) => mathRecordMatch(record, book) && cleanMathRound(record.round) === normalizedRound)
    : [];
}

/** 把一组成绩折算成可比较的得分：满分/得分优先，其次题数/做对数。 */
function mathRecordScore(records) {
  const scored = records.filter((record) => Number(record.full) > 0);
  if (scored.length) {
    const score = scored.reduce((sum, record) => sum + Math.max(0, Number(record.score) || 0), 0);
    const full = scored.reduce((sum, record) => sum + Math.max(0, Number(record.full) || 0), 0);
    return {
      kind: "score",
      value: `${score}/${full}`,
      rate: full ? Math.round((score / full) * 100) : 0,
      records: records.length,
    };
  }
  const counted = records.filter((record) => Number(record.count) > 0);
  if (counted.length) {
    const correct = counted.reduce((sum, record) => sum + Math.max(0, Number(record.correct) || 0), 0);
    const count = counted.reduce((sum, record) => sum + Math.max(0, Number(record.count) || 0), 0);
    return {
      kind: "correct",
      value: `${correct}/${count}`,
      rate: count ? Math.round((correct / count) * 100) : 0,
      records: records.length,
    };
  }
  return { kind: "empty", value: "—", rate: 0, records: records.length };
}

/** 普通书按分册聚合，真题按数一 / 数二 / 数三聚合。 */
function mathScoreSections(book) {
  if (Array.isArray(book.sections) && book.sections.length) return book.sections;
  if (book.kind === "zhenti" || book.group === "zhenti") {
    return [
      { name: "数学一", short: "数一", chapters: [] },
      { name: "数学二", short: "数二", chapters: [] },
      { name: "数学三", short: "数三", chapters: [] },
    ];
  }
  return [];
}

/** 章节进度没有满分字段，用完成题数加权的正确率作为得分率的兜底。 */
function mathProgressScore(book, sections, round) {
  let done = 0;
  let weighted = 0;
  let entered = 0;
  let chapters = 0;
  let wrong = 0;
  for (const section of sections) {
    const stats = mathSectionStats(book, section, round);
    done += stats.done;
    weighted += stats.accuracy * (stats.done || 0);
    entered += stats.entered;
    chapters += stats.chapters;
    wrong += stats.wrong;
  }
  return { done, entered, chapters, wrong, rate: done ? Math.round(weighted / done) : 0 };
}

function mathRoundScore(book, round) {
  const normalizedRound = cleanMathRound(round);
  const records = mathBookRecords(book, normalizedRound);
  const recorded = mathRecordScore(records);
  const progress = mathProgressScore(book, mathScoreSections(book), normalizedRound);
  const hasRecorded = recorded.kind !== "empty";
  return {
    round: normalizedRound,
    records,
    recorded,
    progress,
    value: hasRecorded ? recorded.value : progress.done ? `${progress.rate}%` : "—",
    rate: hasRecorded ? recorded.rate : progress.rate,
    detail: hasRecorded
      ? `${recorded.kind === "score" ? "加权得分率" : "正确率"} ${recorded.rate}% · ${recorded.records} 条记录`
      : progress.done
        ? `章节正确率 ${progress.rate}% · 已录 ${progress.entered}/${progress.chapters} 章`
        : "还没有可汇总的得分",
  };
}

function mathSectionAliases(section) {
  const aliases = [section.name, section.short, ...(section.chapters || [])].filter(Boolean).map(String);
  const shortToPaper = { 数一: "数学一", 数二: "数学二", 数三: "数学三" };
  if (shortToPaper[section.short]) aliases.push(shortToPaper[section.short]);
  return [...new Set(aliases)];
}

function mathRecordInSection(record, section) {
  const haystack = `${record.module} ${record.paper} ${record.source} ${record.subject} ${record.question}`;
  return mathSectionAliases(section).some((alias) => alias && haystack.includes(alias));
}

function mathSectionRoundScore(book, section, round) {
  const records = mathBookRecords(book, round).filter((record) => mathRecordInSection(record, section));
  const recorded = mathRecordScore(records);
  if (recorded.kind !== "empty") {
    return {
      value: recorded.value,
      rate: recorded.rate,
      detail: `${recorded.rate}% · ${recorded.records} 条`,
      kind: recorded.kind,
    };
  }
  if (book.kind !== "zhenti" && book.group !== "zhenti") {
    const progress = mathProgressScore(book, [section], round);
    if (progress.done) {
      return {
        value: `${progress.rate}%`,
        rate: progress.rate,
        detail: `章节正确率 · ${progress.done} 题`,
        kind: "progress",
      };
    }
  }
  return { value: "—", rate: 0, detail: "未录入", kind: "empty" };
}

function mathScoreCell(score) {
  const tone = !score.rate ? "empty" : score.rate >= 80 ? "good" : score.rate >= 65 ? "warn" : "bad";
  return `<td class="section-score-cell ${tone}"><strong>${escapeHtml(score.value)}</strong><span>${escapeHtml(score.detail)}</span></td>`;
}

function mathScoreBoard(book) {
  const sections = mathScoreSections(book);
  const tones = { 1: "blue", 2: "coral", 3: "violet", 4: "amber", 5: "cyan" };
  const roundScores = MATH_ROUNDS.map((round) => ({ ...round, score: mathRoundScore(book, round.value) }));
  const unassigned = MATH_ROUNDS.map((round) =>
    mathBookRecords(book, round.value).filter((record) => !sections.some((section) => mathRecordInSection(record, section))),
  );
  const hasUnassigned = unassigned.some((records) => records.length);
  return `
    <section class="card card-pad score-board">
      <div class="card-head">
        <div>
          <h2 class="card-title">各刷得分总览</h2>
          <p class="card-note">一刷到五刷分开统计；有满分就按得分加权，没有满分就按做对数，最后回退到章节正确率。</p>
        </div>
        <span class="tag blue">一刷 → 五刷</span>
      </div>
      <div class="score-grid">
        ${roundScores
          .map(
            (round) => `
              <article class="round-score-card ${round.value === mathBookRound(book.key) ? "active" : ""}"
                data-round-score="${round.value}">
                <div class="round-score-head"><span>${round.label}得分</span><em>${round.plan}</em></div>
                <strong>${escapeHtml(round.score.value)}</strong>
                ${progressBar(round.score.rate, tones[round.value])}
                <p>${escapeHtml(round.score.detail)}</p>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="section-score-head">
        <div>
          <h3 class="card-title">分板块得分</h3>
          <p class="card-note">按这本书自己的分册、数一数二数三拆开看，每格都是一刷到五刷的独立成绩。</p>
        </div>
        <span class="tag violet">${sections.length} 个板块</span>
      </div>
      ${
        sections.length
          ? `<div class="table-wrap section-score-wrap">
              <table class="section-score-table">
                <thead>
                  <tr><th>板块</th>${MATH_ROUNDS.map((round) => `<th>${round.label}</th>`).join("")}</tr>
                </thead>
                <tbody>
                  ${sections
                    .map(
                      (section) => `
                        <tr>
                          <th><strong>${escapeHtml(section.name)}</strong><span>${escapeHtml(section.short || "")}</span></th>
                          ${MATH_ROUNDS.map((round) => mathScoreCell(mathSectionRoundScore(book, section, round.value))).join("")}
                        </tr>
                      `,
                    )
                    .join("")}
                  ${
                    hasUnassigned
                      ? `<tr>
                          <th><strong>未分板块</strong><span>未匹配到分册</span></th>
                          ${MATH_ROUNDS.map((round, index) =>
                            mathScoreCell(mathRecordScore(unassigned[index])),
                          ).join("")}
                        </tr>`
                      : ""
                  }
                </tbody>
              </table>
            </div>`
          : `<div class="empty-state compact">${icon("layout-grid")}<strong>这本书还没有可拆分板块</strong><span>录入成绩时会按数一 / 数二 / 数三归入对应板块。</span></div>`
      }
    </section>
  `;
}

function mathRoundSwitcher(book) {
  const current = mathBookRound(book.key);
  const currentMeta = mathRoundMeta(current);
  return `
    <section class="card card-pad round-board">
      <div class="round-board-head">
        <div>
          <h2 class="card-title">刷题轮次</h2>
          <p class="card-note">每一轮的章节进度和真题记录独立保存；当前是 ${currentMeta.label} · ${currentMeta.plan}。</p>
        </div>
        <span class="tag blue">${currentMeta.label}</span>
      </div>
      <div class="round-switcher" role="tablist" aria-label="${escapeAttr(book.tab)} 刷题轮次">
        ${MATH_ROUNDS.map((round) => {
          const stats = mathRoundStats(book, round.value);
          const active = round.value === current;
          const complete = stats.chapters > 0 && stats.entered >= stats.chapters;
          return `
            <button class="round-button ${active ? "active" : ""} ${complete ? "complete" : ""}" type="button"
              role="tab" aria-selected="${active ? "true" : "false"}" data-math-round="${round.value}">
              <span>${round.label}</span>
              <strong>${stats.summary}</strong>
              <em>${round.plan}${stats.percent ? ` · ${stats.percent}%` : ""}</em>
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function mathRecordMatch(record, book) {
  if (!record || !book) return false;
  const keys = [book.tab, book.title, book.short, ...(book.match || [])].filter(Boolean);
  const haystack = `${record.source} ${record.module} ${record.paper}`;
  if (keys.some((key) => haystack.includes(key))) return true;
  return book.kind === "zhenti"
    ? record.subject === "数学一" && haystack.includes("真题")
    : false;
}

function bookRecordTable(book, records) {
  if (!records.length) {
    return `
      <div class="empty-state">
        ${icon("clipboard-list")}
        <strong>还没有这本书的记录</strong>
        <span>做完整章或整套卷后，用「录入成绩」记一次，进度和正确率会自动汇总。</span>
        <button class="secondary-btn" type="button" data-open-entry-subject="数学一" data-entry-source="${escapeAttr(book.tab)}" data-entry-round="${mathBookRound(book.key)}">录入一条记录</button>
      </div>
    `;
  }
  return `
    <div class="table-wrap" data-record-table="1">
      <table>
        <thead>
          <tr><th>日期</th><th>轮次</th><th>来源</th><th>章节 / 卷面</th><th>得分</th><th>正确率</th><th>备注</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${records
            .slice(0, 12)
            .map((record) => {
              const rate = record.full ? Math.round((record.score / record.full) * 100) : record.count ? Math.round((record.correct / record.count) * 100) : 0;
              return `
                <tr>
                  <td>${escapeHtml(record.date)}</td>
                  <td><span class="tag blue">${escapeHtml(mathRoundMeta(record.round).label)}</span></td>
                  <td>${escapeHtml(record.source || record.subject)}</td>
                  <td>${escapeHtml(record.module || record.paper || "-")}${record.question ? ` · ${escapeHtml(record.question)}` : ""}</td>
                  <td class="score ${rate >= 80 ? "good" : rate >= 65 ? "warn" : "bad"}">${record.full ? `${record.score}/${record.full}` : record.count ? `${record.correct}/${record.count}` : "-"}</td>
                  <td>${rate ? `${rate}%` : "-"}</td>
                  <td class="note-cell" title="${escapeAttr(record.note)}">${escapeHtml(record.note || "-")}</td>
                  <td><div class="row-actions">
                    <button class="row-action" type="button" data-record-edit="${escapeAttr(record.id)}" title="编辑这条记录">${icon("pencil-line")}</button>
                    <button class="row-action" type="button" data-record-remove="${escapeAttr(record.id)}" title="删除这条记录">${icon("trash-2")}</button>
                  </div></td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function mathBookPage(book) {
  const [bookColor, bookSoft] = accentMap[book.tone] || accentMap.blue;
  const currentRound = mathBookRound(book.key);
  const currentRoundMeta = mathRoundMeta(currentRound);
  const stats = book.kind === "zhenti" ? mathRoundStats(book, currentRound) : mathBookStats(book, currentRound);
  const percent = stats.total ? Math.min(100, Math.round((stats.done / stats.total) * 100)) : 0;
  const records = STORE
    ? STORE.records().filter((record) => mathRecordMatch(record, book) && cleanMathRound(record.round) === currentRound)
    : [];

  if (book.kind === "zhenti") {
    return `
      <section class="card resource-banner" style="--res-color:${bookColor};--res-soft:${bookSoft}">
        <div class="resource-icon">${icon(book.icon || "file-stack")}</div>
        <div class="resource-info">
          <div class="resource-title-row">
            <h2>${escapeHtml(book.title)}</h2>
            <span class="tag ${book.tone}">真题</span>
            <span class="tag blue resource-category">${escapeHtml(book.category)}</span>
            <span class="tag">${escapeHtml(book.meta)}</span>
          </div>
          <p>${escapeHtml(book.note)}</p>
          <div class="resource-meta-line">
            <span>${escapeHtml(book.focus)}</span>
            <span>${escapeHtml(book.stage)}</span>
            <span>${currentRoundMeta.label} · ${currentRoundMeta.plan}</span>
          </div>
        </div>
        <div class="resource-progress">
          <div class="resource-progress-top">
            <strong>${records.length}</strong>
            <span>套已录入</span>
            <em>${book.years ? book.years[0] : ""}–${book.years ? book.years[book.years.length - 1] : ""}</em>
          </div>
          ${progressBar(book.years && book.years.length ? Math.round((records.length / book.years.length) * 100) : 0, book.tone)}
          <div class="resource-progress-foot"><span>${currentRoundMeta.label}已录入 ${records.length} 套</span><span>数一 / 数二 / 数三</span></div>
        </div>
      </section>
      ${mathRoundSwitcher(book)}
      ${mathScoreBoard(book)}
      <div class="kpi-grid">
        ${kpiCard({ label: `${currentRoundMeta.label}真题`, value: records.length, unit: "套", sub: `共 ${book.years ? book.years.length : 0} 个年份可选`, iconName: "layers", accent: "blue" })}
        ${kpiCard({ label: "最近一次", value: records[0] && records[0].full ? records[0].score : "—", unit: records[0] && records[0].full ? `/${records[0].full}` : "", sub: records[0] ? `${records[0].date} · ${records[0].paper || records[0].subject}` : "还没有记录", iconName: "file-check-2", accent: "violet" })}
        ${kpiCard({ label: "平均得分率", value: records.length ? Math.round(records.filter((item) => item.full).reduce((sum, item) => sum + item.score / item.full, 0) / Math.max(1, records.filter((item) => item.full).length) * 100) : "—", unit: "%", sub: "只统计填了满分的套卷", iconName: "target", accent: "coral" })}
        ${kpiCard({ label: "待复盘错题", value: records.filter((item) => item.reviewDate).length, unit: "条", sub: "填了下次复盘日期的记录", iconName: "notebook-tabs", accent: "amber" })}
      </div>
      <div class="grid">
        <section class="card card-pad span-12">
          <div class="card-head">
            <div>
              <h2 class="card-title">真题分卷记录</h2>
              <p class="card-note">当前只看 ${currentRoundMeta.label}；数一、数二、数三分开记，每套卷一条记录。</p>
            </div>
            <button class="primary-btn" type="button" data-open-entry-subject="数学一" data-entry-source="历年真题" data-entry-round="${currentRound}">${icon("plus")} 录入${currentRoundMeta.label}成绩</button>
          </div>
          ${bookRecordTable(book, records)}
        </section>
      </div>
    `;
  }

  const sections = Array.isArray(book.sections) ? book.sections : [];
  const sectionIndex = clampIndex(state.mathSection, sections.length);
  const section = sections[sectionIndex] || { name: "", short: "", chapters: [] };
  const chapters = Array.isArray(section.chapters) ? section.chapters : [];
  const sectionStats = mathSectionStats(book, section, currentRound);

  return `
    <section class="card resource-banner" style="--res-color:${bookColor};--res-soft:${bookSoft}">
      <div class="resource-icon">${icon(book.icon || "book-open")}</div>
      <div class="resource-info">
        <div class="resource-title-row">
          <h2>${escapeHtml(book.title)}</h2>
          <span class="tag ${book.tone}">${escapeHtml(book.tab)}</span>
          <span class="tag blue resource-category">${escapeHtml(book.category)}</span>
          <span class="tag">${escapeHtml(book.meta)}</span>
        </div>
        <p>${escapeHtml(book.note)}</p>
        <div class="resource-meta-line">
          <span>${escapeHtml(book.focus)}</span>
          <span>${escapeHtml(book.stage)}</span>
          <span>${currentRoundMeta.label} · ${currentRoundMeta.plan}</span>
        </div>
      </div>
      <div class="resource-progress">
        <div class="resource-progress-top">
          <strong>${stats.done}</strong>
          <span>/${stats.total || "未设"} ${book.unit || "题"}</span>
          <em>${percent}%</em>
        </div>
        ${progressBar(percent, book.tone)}
        <div class="resource-progress-foot"><span>${currentRoundMeta.label}已录入 ${stats.entered}/${stats.chapters} 章</span><span>${stats.accuracy ? `正确率 ${stats.accuracy}%` : "还没有正确率数据"}</span></div>
      </div>
    </section>
    ${mathRoundSwitcher(book)}
    ${mathScoreBoard(book)}

    <div class="kpi-grid">
      ${kpiCard({ label: `${currentRoundMeta.label}进度`, value: stats.done, unit: `/${stats.total || "未设"} ${book.unit || "题"}`, sub: stats.total ? `完成 ${percent}%` : "按章节录入后会累计", iconName: "list-checks", accent: book.tone })}
      ${kpiCard({ label: "正确率", value: stats.accuracy || "—", unit: stats.accuracy ? "%" : "", sub: "按已录入章节加权平均", iconName: "target", accent: "violet" })}
      ${kpiCard({ label: "待复盘错题", value: stats.wrong, unit: "题", sub: "章节录入时填写的错题数", iconName: "notebook-tabs", accent: "amber" })}
      ${kpiCard({ label: "已录入章节", value: `${stats.entered}/${stats.chapters}`, unit: "", sub: stats.entered ? "点击章节可随时修改" : "点击任意章节开始录入", iconName: "book-open-check", accent: "coral" })}
    </div>

    <div class="grid">
      <section class="card card-pad span-8">
        <div class="card-head">
          <div>
            <h2 class="card-title">章节进度 · ${escapeHtml(section.name)} · ${currentRoundMeta.label}</h2>
            <p class="card-note">当前轮次独立保存；点任意一章录入完成题数、正确率和错题，切轮后不会覆盖。</p>
          </div>
          <span class="tag ${book.tone}">${sectionStats.done}/${sectionStats.total || "未设"} ${book.unit || "题"}</span>
        </div>
        <div class="section-tabs">
          ${sections
            .map((item, index) => {
              const itemStats = mathSectionStats(book, item, currentRound);
              return `
                <button class="${index === sectionIndex ? "active" : ""}" type="button" data-math-section="${index}">
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${itemStats.entered}/${itemStats.chapters} 章已录入${itemStats.done ? ` · ${itemStats.done} 题` : ""}</span>
                </button>
              `;
            })
            .join("")}
        </div>
        <div class="chapter-grid resource-grid">
          ${chapters
            .map((chapter, index) => {
              const info = mathChapterInfo(book, section, chapter, currentRound);
              const tone = !info.entered ? "blank" : info.percent >= 100 ? "done" : info.percent >= 60 ? "active" : info.percent >= 30 ? "warn" : "weak";
              return `
                <button class="chapter-cell ${tone}" type="button" data-math-chapter="${index}"
                  title="${escapeAttr(chapter)} · ${currentRoundMeta.label} · ${info.entered ? `完成 ${info.percent}% · 正确率 ${info.accuracy}% · 错题 ${info.wrong} 题` : "还没有录入进度"}">
                  <span class="chapter-name">${escapeHtml(chapter)}</span>
                  <span class="chapter-value">${info.entered ? `${info.percent}%` : "未录入"}</span>
                  <span class="chapter-acc">${info.entered ? `正确 ${info.accuracy}% · 错 ${info.wrong}` : "点击录入进度"}</span>
                </button>
              `;
            })
            .join("")}
        </div>
        <div class="chapter-legend">
          <span><i></i>未录入</span>
          <span><i></i>进行中</span>
          <span><i></i>需复习</span>
          <span><i></i>已完成</span>
        </div>
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">这本书的记录</h2>
            <p class="card-note">只显示和这本资料有关的记录，不混用其它书的导航和进度。</p>
          </div>
          <button class="icon-btn" type="button" data-open-entry-subject="数学一" data-entry-source="${escapeAttr(book.tab)}" data-entry-round="${currentRound}" aria-label="新增记录">${icon("plus")}</button>
        </div>
        ${records.length
          ? `<div class="review-list">${records
              .slice(0, 6)
              .map((record) => reviewItem(record.date.slice(5) || "--", escapeHtml(record.module || record.paper || record.source), `${currentRoundMeta.label} · ${escapeHtml(record.source)} · ${record.full ? `${record.score}/${record.full}` : record.count ? `${record.correct}/${record.count} 题` : "已记录"}`, book.tone))
              .join("")}</div>`
          : `<div class="empty-state compact">${icon("clipboard-list")}<strong>还没有记录</strong><span>整章做完后点右上角加号记一次。</span></div>`}
      </section>
    </div>
  `;
}

function renderMath() {
  const book = mathBook();
  if (!book) {
    return `
      <div class="page-head">
        <div><h1>XXRJ · 数学</h1><p class="page-desc">数学资料目录加载失败，请刷新页面重试。</p></div>
      </div>
      <section class="card card-pad">${icon("triangle-alert")} 没有读到 math-books.js 里的资料目录。</section>
    `;
  }
  const [bookColor, bookSoft] = accentMap[book.tone] || accentMap.blue;
  const groupKey = YM_GROUPS.some((group) => group.key === book.group) ? book.group : YM_GROUPS[0]?.key;
  const groupBooks = YM_BOOKS.filter((item) => item.group === groupKey);

  return `
    <div class="page-head">
      <div>
        <h1>XXRJ · 数学</h1>
        <p class="page-desc">22 本现有资料各自分类、各自章节导航；每本都能切一刷到五刷，进度、正确率、错题按轮次独立保存。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn" data-screen="plan">${icon("calendar-range")} 今日计划</button>
        <button class="primary-btn" data-open-entry-subject="数学一" data-entry-source="${escapeAttr(book.tab)}" data-entry-round="${mathBookRound(book.key)}">${icon("plus")} 录入数学成绩</button>
      </div>
    </div>

    <div class="book-picker">
      <div class="segmented book-groups">
        ${YM_GROUPS.map((group) => `<button type="button" class="${group.key === groupKey ? "active" : ""}" data-math-group="${escapeAttr(group.key)}">${escapeHtml(group.label)}</button>`).join("")}
      </div>
      <div class="book-tabs">
        ${groupBooks
          .map(
            (item) => `
              <button type="button" class="book-tab ${item.key === book.key ? "active" : ""}" style="--book-color:${(accentMap[item.tone] || accentMap.blue)[0]}" data-math-resource="${escapeAttr(item.key)}">
                <span>${escapeHtml(item.tab)}</span>
                <b>${escapeHtml(item.category)}</b>
                <em>${(item.sections || []).length ? `${(item.sections || []).length} 个分册` : "真题卷"}</em>
                <span class="book-tab-rounds" aria-label="${escapeAttr(item.tab)} 一刷到五刷完成标记">
                  ${MATH_ROUNDS.map((round) => {
                    const roundStats = mathRoundStats(item, round.value);
                    const active = mathBookRound(item.key) === round.value;
                    const complete = roundStats.chapters > 0 && roundStats.entered >= roundStats.chapters;
                    return `<i class="${active ? "active" : ""} ${complete ? "complete" : ""}" title="${escapeAttr(`${round.label} · ${roundStats.summary}`)}">${round.value}</i>`;
                  }).join("")}
                </span>
              </button>
            `,
          )
          .join("")}
      </div>
    </div>

    ${mathBookPage(book)}
  `;
}

/** 错题本：每一条都来自 STORE 里被标记过错因 / 复盘 / 做错的记录。 */

function typeToneOf(label) {
  const match = ANNOTATE_TYPES.find((type) => type.label === label);
  return match ? match.tone : "blue";
}

function annotateStatusText(record) {
  if (record.status === "一直不会的题") return "一直不会";
  if (record.status === "已消灭") return "已消灭";
  if (record.status === "正常") return "正常";
  return "需加强";
}

function annotateStatusTone(record) {
  const text = annotateStatusText(record);
  return text === "一直不会" ? "red" : text === "已消灭" ? "green" : text === "正常" ? "blue" : "amber";
}

function masteryTagText(record) {
  const rate = recordRate(record);
  if (record.status === "已消灭") return "已消灭";
  if (record.status === "一直不会的题") return "一直不会";
  if (rate === null) return annotateStatusText(record);
  return rateToneText(rate);
}

function reviewNextText(record) {
  if (!record.reviewDate) return "今天";
  const days = Math.round((new Date(`${record.reviewDate}T00:00:00`) - new Date(`${TODAY_KEY}T00:00:00`)) / DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return "今天";
  if (days <= 1) return "1 天后";
  if (days <= 3) return "3 天后";
  return "7 天后";
}

/** 下一次复盘的编号：已完成几次 + 1，面板里可以自己改。 */
function nextReviewRound(record) {
  return Math.max(1, Math.round(Number(record && record.reviewCount) || 0) + 1);
}

function nextReviewRoundText(record) {
  return `第 ${nextReviewRound(record)} 次复盘`;
}

/** 复盘间隔：第 1 次后 1 天，第 2 次后 3 天，第 3 次起 7 天。 */
function reviewRoundGap(round) {
  const value = Math.max(1, Math.round(Number(round) || 1));
  return value <= 1 ? 1 : value === 2 ? 3 : 7;
}

function reviewSummaryText(record) {
  const done = Math.max(0, Math.round(Number(record.reviewCount) || 0));
  const last = record.lastReviewDate ? ` · 上次 ${record.lastReviewDate}` : "";
  return `已完成 ${done} 次${last}`;
}

/** 面板底部提示实际复盘日期，点了哪个间隔就跟着变。 */
function syncReviewNextHint(panel) {
  if (!panel) return;
  const hint = panel.querySelector("[data-ann-next-hint]");
  if (!hint) return;
  const active = panel.querySelector("[data-annotate-next].active");
  hint.textContent = `复盘日：${reviewDateFromNext(active ? active.dataset.annotateNext : "3 天后")}`;
}

/** 复盘编号变了就顺手把「下次复盘」调到对应间隔，用户仍然可以手动改。 */
function syncReviewNextFromRound(panel) {
  if (!panel) return;
  const input = panel.querySelector("[data-ann-review-count]");
  const label = `${reviewRoundGap(input ? input.value : 1)} 天后`;
  const target = panel.querySelector(`[data-annotate-next="${label}"]`);
  if (target) {
    panel.querySelectorAll("[data-annotate-next]").forEach((button) => button.classList.toggle("active", button === target));
  }
  syncReviewNextHint(panel);
}

/** 复盘队列右侧的入口：打开这条记录的复盘面板，编号和笔记都能改。 */
function reviewOpenButton(record) {
  return `<button class="review-action" type="button" title="复盘并记笔记" aria-label="复盘并记笔记" data-review-open="${escapeAttr(record.id)}">${icon("notebook-pen")}</button>`;
}

function mistakeTagsOf(record) {
  const tags = [];
  const key = subjectKeyOf(record);
  if (key) tags.push(key);
  if (record.status === "一直不会的题") tags.push("never");
  if (record.status !== "已消灭" && (!record.reviewDate || record.reviewDate <= TODAY_KEY)) tags.push("today");
  if (record.errorType || record.note) tags.push("annotated");
  return tags.join(",");
}

const ERROR_TYPE_ADVICE = {
  概念不清: { tone: "red", action: "回看定义与定理条件，再做 10 道同考点题" },
  计算错误: { tone: "amber", action: "限时计算训练，每题写出关键步骤" },
  方法不会: { tone: "coral", action: "先看解析总结套路，再独立重做一遍" },
  审题错误: { tone: "blue", action: "读题圈关键词、写已知和所求" },
  时间不足: { tone: "violet", action: "分段计时，先拿稳拿的分" },
  一直不会: { tone: "red", action: "回到定义和例题，把这道题拆成两步重做" },
};

function errorTypeKeysOf(record) {
  return String(record.errorType || "")
    .split(/[、,，/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderMistakes() {
  const rows = sortedByDate(mistakeRecordsOf(), -1);
  const pending = sortedByDate(pendingReviewRecords(rows), -1);
  const never = rows.filter((record) => record.status === "一直不会的题");
  const averageError = rows.length
    ? (rows.reduce((sum, record) => sum + (Number(record.errorCount) || 0), 0) / rows.length).toFixed(1)
    : "0.0";
  const killed = rows.filter((record) => record.status === "已消灭").length;
  const advice = [...groupBy(rows, (record) => errorTypeKeysOf(record)[0] || "未标注错因").entries()]
    .map(([name, list]) => ({ name, count: list.length, tone: typeToneOf(name) }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
  const filterCounts = {
    all: rows.length,
    never: never.length,
    today: rows.filter((record) => mistakeTagsOf(record).split(",").includes("today")).length,
    math: rows.filter((record) => subjectKeyOf(record) === "math").length,
    "408": rows.filter((record) => subjectKeyOf(record) === "cs408").length,
    english: rows.filter((record) => subjectKeyOf(record) === "english").length,
    annotated: rows.filter((record) => record.errorType || record.note).length,
  };
  return `
    <div class="page-head">
      <div>
        <h1>不会题 / 错题本</h1>
        <p class="page-desc">数学、英语、408 的错题统一管理；标注错误类型、复盘次数、错误次数和下次复盘时间，都会写进当前 iball 账号。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn" type="button" data-screen="data">${icon("database")} 数据与备份</button>
        <button class="primary-btn" type="button" data-open-entry="create">${icon("plus")} 新增错题</button>
      </div>
    </div>

    ${
      rows.length
        ? `
    <div class="kpi-grid">
      ${kpiCard({ label: "待复盘", value: pending.length, unit: "题", sub: pending.length ? `今天到期 ${filterCounts.today} 题` : "没有到期的错题", iconName: "notebook-tabs", accent: "blue" })}
      ${kpiCard({ label: "一直不会", value: never.length, unit: "题", sub: "连续复盘仍未独立完成的题", iconName: "circle-alert", accent: "red" })}
      ${kpiCard({ label: "平均错误次数", value: averageError, unit: "次", sub: `共 ${rows.length} 条错题记录`, iconName: "repeat-2", accent: "amber" })}
      ${kpiCard({ label: "已消灭", value: killed, unit: "题", sub: killed ? "复盘后能独立做对" : "还没有标记已消灭的题", iconName: "check-check", accent: "green" })}
    </div>

    <div class="filter-row">
      <button class="filter-chip active" data-mistake-filter="all">全部 ${filterCounts.all}</button>
      <button class="filter-chip" data-mistake-filter="never">一直不会 ${filterCounts.never}</button>
      <button class="filter-chip" data-mistake-filter="today">今天到期 ${filterCounts.today}</button>
      <button class="filter-chip" data-mistake-filter="math">数学 ${filterCounts.math}</button>
      <button class="filter-chip" data-mistake-filter="408">408 ${filterCounts["408"]}</button>
      <button class="filter-chip" data-mistake-filter="english">英语 ${filterCounts.english}</button>
      <span class="filter-sep"></span>
      <button class="filter-chip" data-mistake-filter="annotated">已标注 ${filterCounts.annotated}</button>
    </div>

    <div class="grid">
      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">逐题错题汇总</h2>
            <p class="card-note">点「AI 分析」看错因、知识点和同考点记录；点「标注」记录错因和下次复盘，保存后立刻写进账号数据。</p>
          </div>
          <span class="tag blue">按日期倒序</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>来源</th><th>题目</th><th>考点 / 模块</th><th>错误类型</th><th>掌握状态</th><th>下次复盘</th><th>复盘轮次 / 错误</th><th>笔记摘要</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${rows
                .map((record) => {
                  const types = errorTypeKeysOf(record);
                  const title = `${record.subject || ""} ${record.source || ""} ${record.question || ""}`.trim();
                  return `
                <tr data-mistake-row data-mistake-tags="${escapeAttr(mistakeTagsOf(record))}">
                  <td>${escapeHtml(`${record.subject || ""}${record.source ? ` · ${record.source}` : ""}`)}</td>
                  <td><span class="question-no">${escapeHtml(record.question || "整卷记录")}</span></td>
                  <td>${escapeHtml(record.module || record.paper || "-")}</td>
                  <td class="annotate-cell">${
                    types.length
                      ? types.map((type) => `<span class="tag ${typeToneOf(type)}">${escapeHtml(type)}</span>`).join("")
                      : '<span class="tag blue">未标注</span>'
                  }</td>
                  <td><span class="tag ${annotateStatusTone(record)}">${escapeHtml(masteryTagText(record))}</span></td>
                  <td>${escapeHtml(record.reviewDate || "未排期")}</td>
                  <td>${countCellHTML(record)}</td>
                  <td class="note-cell" title="${escapeAttr(record.note)}">${escapeHtml(record.note || "-")}</td>
                  <td><div class="row-actions">
                    ${analysisButton({ id: record.id, title })}
                    ${annotateButton({
                      id: record.id,
                      title,
                      sub: `${record.source || ""}${record.date ? ` · ${record.date}` : ""}`,
                      types,
                      status: annotateStatusText(record),
                      next: reviewNextText(record),
                      note: record.note || "",
                      reviewCount: nextReviewRound(record),
                      errorCount: record.errorCount || 0,
                    })}
                    ${recordEditAction(record.id)}
                    ${recordRemoveAction(record.id)}
                  </div></td>
                </tr>
              `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card card-pad span-6">
        <div class="card-head">
          <div><h2 class="card-title">错因 → 行动建议</h2><p class="card-note">按你标注的错误类型统计，最多的排前面。</p></div>
          <span class="tag red">${filterCounts.annotated} 题已标注</span>
        </div>
        <div class="recommend-stack">
          ${
            advice.length
              ? advice
                  .map((item) => {
                    const meta = ERROR_TYPE_ADVICE[item.name] || { tone: "blue", action: "重做一遍，写清卡在哪一步" };
                    const sample = rows.find((record) => (errorTypeKeysOf(record)[0] || "未标注错因") === item.name);
                    return `
                      <div class="recommend-item">
                        <span class="tag ${meta.tone}">${escapeHtml(item.name)} · ${item.count} 题</span>
                        <p>${escapeHtml(meta.action)}</p>
                        <span>${sample && sample.module ? `最近涉及：${escapeHtml(sample.module)}` : "录入更多错题后会自动给出优先项"}</span>
                      </div>
                    `;
                  })
                  .join("")
              : `<div class="empty-state compact">${icon("tag")}<strong>还没有错因标注</strong><span>用「标注」记下为什么错，这里会自动给行动建议。</span></div>`
          }
        </div>
      </section>

      <section class="card card-pad span-6">
        <div class="card-head">
          <div><h2 class="card-title">今日复盘队列</h2><p class="card-note">未排期或已经到期的错题，按日期排。</p></div>
          <span class="tag ${pending.length ? "red" : "blue"}">${pending.length} 题</span>
        </div>
        <div class="review-list">
          ${
            pending.length
              ? pending
                  .slice(0, 5)
                  .map((record, index) =>
                    reviewItem(
                      String(index + 1).padStart(2, "0"),
                      escapeHtml(`${record.source || record.subject || ""}${record.question ? ` · ${record.question}` : ""}`.trim() || "错题"),
                      escapeHtml(`${record.errorType || "未标注错因"} · ${nextReviewRoundText(record)} · 错误 ${record.errorCount || 0} 次 · ${record.reviewDate ? `${record.reviewDate} 到期` : "未排期"}`),
                      reviewToneOf(record),
                      reviewOpenButton(record),
                    ),
                  )
                  .join("")
              : `<div class="empty-state compact">${icon("check-check")}<strong>今天没有到期的错题</strong><span>新录入或被标注的错题会自动排到这里。</span></div>`
          }
        </div>
      </section>
    </div>`
        : `
    <section class="card card-pad">
      ${recordEmptyState({
        title: "错题本还是空的",
        note: "录入成绩时填了错因、复盘时间，或者逐题记录里没做对的题，会自动出现在这里。",
        subject: "数学一",
      })}
    </section>`
    }
  `;
}
/* --------------------------------------------------------- 408 题目讲解
 * 讲解模板按王道四本书的考点体系整理，写法参考公开的 408 开源笔记
 * （CyC2018/CS-Notes 一类）。生成的是骨架，正文由你自己改，保存后写进
 * 当前 iball 账号的这条记录里，不联网、不调用任何第三方账号。
 */

const CS408_BOOKS = [
  {
    book: "数据结构",
    match: ["数据", "线性表", "树", "二叉树", "图", "排序", "查找", "哈希", "散列", "栈", "队列", "链表", "串", "复杂度"],
    steps: [
      "先看清操作对象是线性结构还是树 / 图，再决定用数组、链表还是指针模拟。",
      "把题目条件写成不变量（长度、指针、平衡条件），按不变量逐步推。",
      "手算时每一步都写出关键状态，别跳步，最后回代验证边界情况。",
    ],
    traps: ["边界情况（空表、单元素、首尾节点）最先漏", "同一题里混用 0 开始和 1 开始的下标"],
  },
  {
    book: "计算机组成原理",
    match: ["组成", "计组", "总线", "存储", "cache", "Cache", "指令", "cpu", "CPU", "流水线", "浮点", "中断", "编址"],
    steps: [
      "先把题目里的位数、容量、频率换算成同一单位（字节 / 位 / Hz）。",
      "画出数据通路或地址划分（标记、行号、块内偏移），再代公式。",
      "算完检查数量级和单位，有明显不合理的直接回查换算。",
    ],
    traps: ["块内偏移位数按块大小取 log2，别按字长", "相对寻址的基准是下一条指令地址"],
  },
  {
    book: "操作系统",
    match: ["操作系统", "进程", "线程", "内存", "分页", "分段", "页表", "文件", "磁盘", "死锁", "调度", "虚拟", "信号量", "TLB"],
    steps: [
      "先判断这题考的是资源分配、地址转换还是调度，选对模型再动手。",
      "资源类题画资源分配图或列表，地址类题先拆位段，调度类题按时间轴重排。",
      "用一致性检查收尾：总量守恒、安全序列能跑完、地址在容量范围内。",
    ],
    traps: ["页内偏移位数由页大小决定，不是页表项大小", "安全序列不唯一，写出一个完整可执行的即可"],
  },
  {
    book: "计算机网络",
    match: ["网络", "TCP", "IP", "HTTP", "路由", "以太", "子网", "可靠传输", "滑动窗口", "DNS", "UDP", "MAC", "CSMA"],
    steps: [
      "先定位协议层次（应用层 / 传输层 / 网络层 / 数据链路层），层次对了公式才对。",
      "按题目要求画时间轴或窗口推进图，把每个字段的变化写出来。",
      "最后用端到端视角验算：报文能不能按序到达、窗口有没有超界。",
    ],
    traps: ["可用主机数要减掉网络号和广播地址", "接收窗口和拥塞窗口取值取小的那个"],
  },
];

const CS408_EXPLAIN_LIB = [
  {
    keys: ["复杂度", "渐进", "时间复杂"],
    title: "复杂度分析",
    book: "数据结构",
    steps: [
      "数基本操作的执行次数，循环嵌套就按层数相乘或相加。",
      "只保留最高阶项、去掉常数系数，写成 O(·)。",
      "分清最坏、平均、摊还三种口径，题目问哪个就答哪个。",
    ],
    traps: ["把 O(1) 和 O(log n) 记混：二分才带 log", "递归式漏算递归调用本身的代价"],
  },
  {
    keys: ["二叉树", "遍历", "树", "哈夫曼", "平衡"],
    title: "树与二叉树的遍历和性质",
    book: "数据结构",
    steps: [
      "先确定遍历口径（先序 / 中序 / 后序 / 层序），写出序列再对齐。",
      "用 n₀ = n₂ + 1 和完全二叉树的编号性质推节点与高度。",
      "由先序 + 中序建树时，先定根，再切左右子树区间，逐层递归。",
    ],
    traps: ["中序序列定根时漏掉空子树区间", "完全二叉树编号从 1 开始，从 0 开始会整体错位"],
  },
  {
    keys: ["图", "最短路径", "拓扑", "关键路径", "最小生成树", "并查集"],
    title: "图算法",
    book: "数据结构",
    steps: [
      "先判断有向 / 无向、带权 / 无权，再看是求路径、生成树还是拓扑序。",
      "按场景选算法：Dijkstra / Floyd 求最短路，Prim / Kruskal 求最小生成树。",
      "手算时列距离数组，每轮只更新有变化的格子，最后写清选边顺序。",
    ],
    traps: ["Dijkstra 不能处理负权边", "拓扑序列和最小生成树都不唯一，只要求写出合法的那一个"],
  },
  {
    keys: ["排序", "快排", "堆", "归并", "插入"],
    title: "排序算法比较",
    book: "数据结构",
    steps: [
      "先看题目问的是稳定性、时间复杂度、空间还是趟数，逐项筛算法。",
      "手算时只写每趟变化的位置，不重抄整个数组。",
      "给出结论时同时写时间复杂度（最好 / 平均 / 最坏）和稳定性。",
    ],
    traps: ["快排平均 O(n log n) 但最坏 O(n²)", "建堆是 O(n)，堆排序总体仍是 O(n log n)"],
  },
  {
    keys: ["查找", "哈希", "散列", "折半", "B树", "B+树", "ASL"],
    title: "查找与哈希",
    book: "数据结构",
    steps: [
      "先确认表是否有序、是否要求 ASL 成功 / 失败分开算。",
      "哈希题按冲突处理方式（开放地址 / 链地址）逐个算比较次数。",
      "B 树、B+ 树看阶数定关键字上下界，注意叶子节点是否存数据。",
    ],
    traps: ["折半查找要求顺序存储且有序", "开放地址法删除后要留标记，否则查找链会断"],
  },
  {
    keys: ["cache", "Cache", "存储", "虚拟存储", "命中率", "映射"],
    title: "Cache 映射与命中率",
    book: "计算机组成原理",
    steps: [
      "由主存地址算位数，再按映射方式划成标记 / 行号（组号）/ 块内偏移。",
      "命中率 = 命中次数 ÷ 访问次数；平均访问时间 = 命中时间 + 缺失率 × 缺失代价。",
      "写策略分开算：写直达和写回对主存的访问次数不同。",
    ],
    traps: ["块内偏移位数按块大小取 log2", "写回法要额外算脏块写回主存的次数"],
  },
  {
    keys: ["指令", "寻址", "编址", "字长", "机器数", "补码"],
    title: "指令格式与寻址方式",
    book: "计算机组成原理",
    steps: [
      "先分清按字节编址还是按字编址，必要时换算成同一单位。",
      "逐个算操作数地址：立即数取指令里、直接寻址取一次、间接寻址取两次。",
      "相对寻址以 PC（下一条指令地址）为基准，算偏移量的符号别丢。",
    ],
    traps: ["相对寻址基准是下一条指令地址，不是当前指令", "补码表示范围比原码多一个负数"],
  },
  {
    keys: ["流水线", "冒险", "相关", "吞吐率", "加速比"],
    title: "流水线性能与冒险",
    book: "计算机组成原理",
    steps: [
      "流水线周期 = 最慢一段的用时；理想执行时间 = 周期 ×（指令数 + 段数 − 1）。",
      "吞吐率与加速比都相对非流水线基准算，注意题目给的是理想还是实际。",
      "冒险分结构、数据、控制三类，逐条判断插入气泡还是旁路。",
    ],
    traps: ["把理想情况当实际，忘了气泡开销", "数据旁路只解决一部分 RAW，load-use 仍需停顿"],
  },
  {
    keys: ["中断", "IO", "I/O", "DMA", "总线", "外设"],
    title: "中断与 I/O 方式",
    book: "计算机组成原理",
    steps: [
      "区分程序查询、程序中断、DMA 三种方式的 CPU 参与程度。",
      "算中断响应和处理开销：响应时间、每次传输的指令数、总线占用。",
      "总线带宽 = 宽度 × 频率，算完核对单位是 B/s 还是 b/s。",
    ],
    traps: ["中断隐指令由硬件完成，不占指令条数", "DMA 和 CPU 会争用总线，要算周期挪用"],
  },
  {
    keys: ["进程", "线程", "死锁", "银行家", "信号量", "PV", "同步"],
    title: "进程同步与死锁",
    book: "操作系统",
    steps: [
      "先写资源总量和每个进程的最大需求，画分配 + 需求表。",
      "用安全性算法试跑：找到 Need ≤ Available 的进程，回收资源继续跑。",
      "信号量题先写清每个 P、V 保护的是什么资源，再排执行顺序。",
    ],
    traps: ["死锁四个必要条件缺一不可", "安全序列不唯一，写出一个能跑通的即可"],
  },
  {
    keys: ["内存", "分页", "分段", "页表", "虚拟", "TLB", "缺页", "置换"],
    title: "地址转换与缺页",
    book: "操作系统",
    steps: [
      "把逻辑地址拆成页号 + 页内偏移，偏移位数由页大小决定。",
      "逐级查页表 / 快表，得到物理块号后拼出物理地址。",
      "缺页按置换算法模拟：FIFO、LRU、OPT 逐次写内存块状态，算缺页率。",
    ],
    traps: ["有效访问时间要把 TLB 命中率算进去", "页表项大小决定页表占几页，别和页大小搞混"],
  },
  {
    keys: ["文件", "磁盘", "索引", "inode", "FAT", "目录"],
    title: "文件系统与磁盘",
    book: "操作系统",
    steps: [
      "算文件最大长度：索引项能指向的直接 / 一级 / 二级 / 三级块逐层展开。",
      "注意索引块本身也占数据块，间接索引要减掉这一块。",
      "磁盘调度按算法画磁头移动轨迹，再累加寻道距离。",
    ],
    traps: ["间接索引块本身也要占一个块", "不同调度算法的初始方向假设会影响结果，题目没说就按约定写清"],
  },
  {
    keys: ["TCP", "可靠传输", "滑动窗口", "拥塞", "三次握手", "四次挥手"],
    title: "TCP 可靠传输与拥塞控制",
    book: "计算机网络",
    steps: [
      "画发送窗口和接收窗口的推进过程，标清每个确认号的含义。",
      "拥塞控制按慢开始→拥塞避免→快重传→快恢复四阶段推窗口变化。",
      "算吞吐量时把往返时延（RTT）和窗口大小对应起来。",
    ],
    traps: ["超时后阈值减半、窗口重置为 1，不是直接翻倍", "发送窗口取接收窗口和拥塞窗口的较小值"],
  },
  {
    keys: ["IP", "子网", "路由", "掩码", "CIDR", "分片"],
    title: "IP 地址与路由",
    book: "计算机网络",
    steps: [
      "由掩码算网络地址、广播地址和可用主机数，主机数记得减 2。",
      "路由转发按最长前缀匹配，掩码长的优先，别只看表里顺序。",
      "分片题按 MTU 算每片数据长度，片偏移量以 8 字节为单位。",
    ],
    traps: ["可用主机数 = 2^主机位 − 2", "片偏移字段的单位是 8 字节，不是 1 字节"],
  },
  {
    keys: ["HTTP", "DNS", "应用层", "邮件", "FTP", "SMTP"],
    title: "应用层协议",
    book: "计算机网络",
    steps: [
      "先定位协议属于哪一层，再回忆默认端口和报文格式。",
      "HTTP 题写出请求行 / 首部 / 实体，注意持久连接与流水线。",
      "DNS 分辨递归查询和迭代查询：谁发起、谁负责追根。",
    ],
    traps: ["DNS 迭代查询由本地域名服务器发起，不是主机", "HTTP 默认 80、HTTPS 443，题目没写就别乱改"],
  },
  {
    keys: ["以太", "MAC", "CSMA", "交换机", "VLAN", "冲突域", "网桥"],
    title: "以太网与交换",
    book: "计算机网络",
    steps: [
      "算最小帧长：64 字节，冲突窗口是往返传播时延的两倍。",
      "交换机自学习看源 MAC 建表，转发看目的 MAC 查表。",
      "按设备划分冲突域和广播域：集线器不隔离，交换机和路由器各管一段。",
    ],
    traps: ["集线器既不隔离冲突域也不隔离广播域", "交换机隔离冲突域但不隔离广播域"],
  },
];

function cs408BookOf(record) {
  const haystack = `${record.module} ${record.question} ${record.source} ${record.paper} ${record.errorType} ${record.note}`;
  const hit = CS408_BOOKS.find((item) => item.match.some((key) => haystack.includes(key)));
  return hit ? hit.book : "408 综合";
}

function cs408ExplainTopic(record) {
  const haystack = `${record.module} ${record.question} ${record.source} ${record.paper} ${record.errorType} ${record.note}`;
  return CS408_EXPLAIN_LIB.find((item) => item.keys.some((key) => haystack.includes(key))) || null;
}

/** 模块名已经带书名时不再重复拼一次，例如「操作系统 · 进程管理」。 */
function cs408ModuleLabel(record, book) {
  const module = String(record.module || record.paper || "").trim();
  if (!module) return book;
  return module.startsWith(book) ? module : `${book} · ${module}`;
}

/** 生成讲解骨架：考点定位 + 解题步骤 + 易错点 + 自己的错因和下一步。 */
function cs408ExplainDraft(record) {
  const topic = cs408ExplainTopic(record);
  const book = topic ? topic.book : cs408BookOf(record);
  const fallback = CS408_BOOKS.find((item) => item.book === book);
  const steps = topic ? topic.steps : fallback ? fallback.steps : [
    "把题干拆成已知条件和所求，先写能直接得到的关系式。",
    "按王道书对应章节的解法走一遍，卡住的步骤单独标出来。",
    "合上答案独立重做一遍，确认每一步都能说清理由。",
  ];
  const traps = topic ? topic.traps : fallback ? fallback.traps : ["先写清已知和所求再动笔", "复盘时独立重做，不看答案"];
  const moduleText = cs408ModuleLabel(record, book);
  const errorLine = record.errorType ? `${record.errorType}${record.errorCount ? ` · 已经错过 ${record.errorCount} 次` : ""}` : "还没标错因，去错题本标一次";
  const noteLine = String(record.note || "").split(/\n/).map((line) => line.trim()).filter(Boolean)[0] || "还没有写笔记";
  return [
    `【考点定位】${moduleText}${topic ? ` · ${topic.title}` : ""}`,
    record.question ? `【题目】${record.question}` : "【题目】整卷记录",
    "",
    "【解题步骤】",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "【易错点】",
    ...traps.map((trap) => `- ${trap}`),
    "",
    `【我的错因】${errorLine}`,
    `【我的笔记】${noteLine}`,
    `【复盘动作】照着上面步骤独立重做一遍，卡在第几步就回王道对应章节补那一节。`,
  ].join("\n");
}

function cs408ExplainPanelHTML(button) {
  const id = button.dataset.cs408Explain;
  const record = STORE ? STORE.getRecord(id) : null;
  if (!record) return "";
  const topic = cs408ExplainTopic(record);
  const book = topic ? topic.book : cs408BookOf(record);
  const draft = record.explanation || cs408ExplainDraft(record);
  const saved = Boolean(record.explanation);
  const related = recordsOfSubject("cs408")
    .filter((item) => item.id !== record.id && item.module && item.module === record.module)
    .slice(0, 4);
  return `
    <tr class="analysis-panel-row" data-cs408-panel="${escapeAttr(id)}">
      <td colspan="99">
        <div class="analysis-panel cs408-panel">
          <div class="analysis-head">
            <div class="analysis-title">
              <span class="analysis-icon">${icon("book-open-check")}</span>
              <div>
                <strong>题目讲解 · ${escapeHtml(record.question || "整卷记录")}</strong>
                <span>${escapeHtml(cs408ModuleLabel(record, book))} · ${saved ? "已保存自己的讲解" : "模板骨架，先改成自己的话"}</span>
              </div>
            </div>
            <div class="analysis-actions">
              <span class="tag ${saved ? "green" : "amber"}" data-cs408-state>${saved ? "已写讲解" : "待写讲解"}</span>
              <button class="secondary-btn compact" type="button" data-cs408-close>${icon("x")} 收起</button>
            </div>
          </div>
          <div class="analysis-grid">
            <section class="analysis-block cs408-explain-main">
              <h3>${icon("list-checks")} 讲解正文</h3>
              <textarea class="cs408-explain-text" rows="16" data-cs408-text aria-label="题目讲解">${escapeHtml(draft)}</textarea>
              <p class="cs408-explain-tip">${icon("info")} 直接改成自己的话再存；保存后写进当前 iball 账号，下次打开还是这份讲解。</p>
            </section>
            <section class="analysis-block">
              <h3>${icon("layers")} 这道题</h3>
              <div class="knowledge-group">
                <label>考点</label>
                <div class="chip-row">
                  <span class="knowledge-chip main">${escapeHtml(book)}</span>
                  ${record.module ? `<span class="knowledge-chip">${escapeHtml(record.module)}</span>` : ""}
                  ${topic ? `<span class="knowledge-chip">${escapeHtml(topic.title)}</span>` : ""}
                </div>
              </div>
              <div class="knowledge-group">
                <label>来源</label>
                <div class="chip-row">
                  ${[record.source, record.paper, record.year, record.date].filter(Boolean).map((label) => `<span class="knowledge-chip">${escapeHtml(label)}</span>`).join("") || '<span class="knowledge-chip">未填来源</span>'}
                </div>
              </div>
              <div class="freq-metrics">
                <div><span>错误次数</span><strong>${Number(record.errorCount) || 0} 次</strong></div>
                <div><span>复盘次数</span><strong>${Number(record.reviewCount) || 0} 次</strong></div>
              </div>
              <div class="related-list">
                <label>同模块的 408 记录</label>
                ${
                  related.length
                    ? related
                        .map(
                          (item) => `
                      <div class="related-item">
                        <span>${escapeHtml(`${item.date || ""} ${item.source || item.subject || ""} ${item.question || ""}`.trim())}</span>
                        <small>${escapeHtml(recordScoreText(item))}</small>
                        ${icon("chart-line")}
                      </div>
                    `,
                        )
                        .join("")
                    : '<span class="related-empty">还没有同模块记录</span>'
                }
              </div>
            </section>
          </div>
          <div class="analysis-foot">
            <span class="analysis-note">${icon("book-marked")} 模板按王道四本书的考点体系整理，写法参考公开的 408 开源笔记；讲解正文以你自己的复盘为准。</span>
            <div class="analysis-foot-actions">
              <button class="ghost-btn compact" type="button" data-cs408-template>${icon("refresh-cw")} 生成讲解模板</button>
              <button class="primary-btn compact" type="button" data-cs408-save>${icon("check")} 保存讲解</button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  `;
}

function toggleCs408Explain(button) {
  const id = button.dataset.cs408Explain;
  const existing = document.querySelector(`[data-cs408-panel="${id}"]`);
  document.querySelectorAll("[data-cs408-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-annotate-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-analysis-panel]").forEach((row) => row.remove());
  document.querySelectorAll("[data-cs408-explain]").forEach((item) => item.setAttribute("aria-expanded", "false"));
  if (existing) return;
  const row = button.closest("tr");
  if (!row) return;
  row.insertAdjacentHTML("afterend", cs408ExplainPanelHTML(button));
  button.setAttribute("aria-expanded", "true");
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  const panel = document.querySelector(`[data-cs408-panel="${id}"]`);
  if (panel) panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

/** 保存讲解：写进这条 408 记录，随账号同步。 */
function saveCs408Explain(button) {
  const panelRow = button.closest("[data-cs408-panel]");
  if (!panelRow) return;
  const id = panelRow.dataset.cs408Panel;
  const textarea = panelRow.querySelector("[data-cs408-text]");
  const text = String(textarea ? textarea.value : "").trim();
  if (!id || !text) return;
  STORE.upsertRecord({ id, explanation: text.slice(0, 6000) });
  const state = document.querySelector(`[data-cs408-panel="${id}"] [data-cs408-state]`);
  if (state) {
    state.textContent = "已保存";
    state.classList.remove("amber");
    state.classList.add("green");
  }
}

function cs408QuestionRows(records) {
  return records.filter((record) => record.question || isMistakeRecord(record)).slice(0, 8);
}

/** 408 讲解区：每题一个入口，点开生成骨架 → 改成自己的话 → 存进这条记录。 */
function cs408ExplainSection(records) {
  const rows = cs408QuestionRows(records);
  const written = records.filter((record) => record.explanation).length;
  return `
    <section class="card card-pad">
      <div class="card-head">
        <div>
          <h2 class="card-title">408 题目讲解</h2>
          <p class="card-note">选中一条题目，生成讲解骨架（考点定位、解题步骤、易错点），改成自己的话保存；写进当前 iball 账号。</p>
        </div>
        <span class="tag ${written ? "green" : "blue"}">${written ? `${written} 题已写讲解` : `${rows.length} 题可写讲解`}</span>
      </div>
      ${
        rows.length
          ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>来源</th><th>题目</th><th>模块 / 考点</th><th>错因</th><th>讲解状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${rows
                .map((record) => {
                  const topic = cs408ExplainTopic(record);
                  const book = topic ? topic.book : cs408BookOf(record);
                  const types = errorTypeKeysOf(record);
                  return `
                <tr data-cs408-row data-cs408-id="${escapeAttr(record.id)}">
                  <td>${escapeHtml(`${record.source || "408"}${record.year ? ` · ${record.year}` : ""}`)}</td>
                  <td><span class="question-no">${escapeHtml(record.question || "整卷记录")}</span></td>
                  <td>${escapeHtml(cs408ModuleLabel(record, book))}${topic ? ` <span class="tag blue">${escapeHtml(topic.title)}</span>` : ""}</td>
                  <td>${types.length ? types.map((type) => `<span class="tag ${typeToneOf(type)}">${escapeHtml(type)}</span>`).join("") : '<span class="tag blue">未标注</span>'}</td>
                  <td><span class="tag ${record.explanation ? "green" : "amber"}">${record.explanation ? "已写讲解" : "待写讲解"}</span></td>
                  <td><div class="row-actions">
                    <button class="analysis-btn" type="button" data-cs408-explain="${escapeAttr(record.id)}" aria-expanded="false" title="生成这道题的讲解，可改成自己的话保存">${icon("book-open-check")} 讲解</button>
                    ${recordEditAction(record.id)}
                  </div></td>
                </tr>
              `;
                })
                .join("")}
            </tbody>
          </table>
        </div>`
          : `<div class="empty-state compact">${icon("book-open-check")}<strong>还没有可以讲解的 408 题目</strong><span>录入一条带题号或错因的 408 记录，这里就会出现「讲解」入口。</span></div>`
      }
      <div class="mini-note">${icon("book-marked")} 讲解模板按王道四本书的考点体系整理，写法参考公开的 408 开源笔记（CS-Notes 一类），正文由你改，不调用第三方账号。</div>
    </section>
  `;
}

/** 408 页：四本书、模块和真题记录全部从 STORE 的 408 记录推导。 */
function render408() {
  const records = STORE ? recordsOfSubject("cs408") : [];
  const sorted = sortedByDate(records, -1);
  const books = [
    { name: "数据结构", iconName: "git-branch", tone: "blue", match: ["数据结构"] },
    { name: "计算机组成原理", iconName: "cpu", tone: "red", match: ["组成原理", "计组", "存储系统"] },
    { name: "操作系统", iconName: "monitor-cog", tone: "coral", match: ["操作系统"] },
    { name: "计算机网络", iconName: "network", tone: "amber", match: ["计算机网络", "网络"] },
  ].map((book) => {
    const list = records.filter((record) => {
      const haystack = `${record.module} ${record.source} ${record.paper}`;
      return book.match.some((key) => haystack.includes(key));
    });
    return { ...book, list, rate: weightedRate(list), count: list.length };
  });
  const average = weightedRate(records);
  const latest = sorted[0] || null;
  const latestRate = latest ? recordRate(latest) : null;
  const pending = pendingReviewRecords(records).length;
  const zhenti = sorted
    .filter((record) => `${record.source} ${record.paper} ${record.module}`.includes("真题"))
    .slice(0, 6);
  const modules = moduleMasteryRows(records, 8);
  const weakest = books.filter((book) => book.rate !== null).sort((left, right) => left.rate - right.rate)[0];
  return `
    <div class="page-head">
      <div>
        <h1>408 计算机学科专业基础</h1>
        <p class="page-desc">王道四本书课后题 + 历年真题；按模块、章节和年份记录，全部数据来自当前 iball 账号。</p>
      </div>
      <div class="head-actions">
        <a class="secondary-btn" href="/vocab.html">${icon("book-marked")} 词汇库</a>
        <button class="primary-btn" type="button" data-open-entry-subject="408" data-entry-source="王道课后题">${icon("plus")} 录入 408 成绩</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({ label: "录入记录", value: records.length, unit: "条", sub: latest ? `最近 ${escapeHtml(latest.date || "未填日期")}` : "还没有 408 记录", iconName: "database", accent: "blue" })}
      ${kpiCard({ label: "平均得分率", value: average === null ? "—" : average, unit: average === null ? "" : "%", sub: records.length ? `${records.length} 条记录加权平均` : "按满分 / 题数加权", iconName: "trending-up", accent: "violet" })}
      ${kpiCard({ label: "最近一次", value: latestRate === null ? "—" : latestRate, unit: latestRate === null ? "" : "%", sub: latest ? escapeHtml(`${latest.source || latest.subject} · ${latest.module || latest.paper || "未填模块"}`) : "录入后自动统计", iconName: "file-check-2", accent: "coral" })}
      ${kpiCard({ label: "待复盘", value: pending, unit: "题", sub: pending ? "到期的错题去错题本复盘" : "没有到期的错题", iconName: "notebook-tabs", accent: "amber" })}
    </div>

    ${cs408ExplainSection(sorted)}

    ${
      records.length
        ? `
    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">王道四本书进度</h2>
            <p class="card-note">按你录入的模块归属到四本书；没录过的书显示等待数据。</p>
          </div>
          <span class="tag blue">${books.filter((book) => book.count).length}/4 本有记录</span>
        </div>
        <div class="book-grid">
          ${books
            .map((book) => {
              const [color, soft] = accentMap[book.tone] || accentMap.blue;
              return `
                <article class="book-card" style="--book-color:${color};--book-soft:${soft}">
                  <div class="book-top">
                    <span class="book-icon">${icon(book.iconName)}</span>
                    <div>
                      <p class="book-name">${book.name}</p>
                      <p class="book-meta">${book.count ? `${book.count} 条记录` : "还没有记录"}</p>
                    </div>
                    <span class="book-score">${book.rate === null ? "—" : `${book.rate}%`}</span>
                  </div>
                  ${progressBar(book.rate ?? 0, book.rate === null ? "" : rateTone(book.rate))}
                  <div class="book-foot"><span>${book.rate === null ? "等待录入" : `得分率 ${book.rate}%`}</span><span>${book.rate === null ? "先录一条" : book.rate < 65 ? "需重点补强" : "节奏正常"}</span></div>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">模块得分率</h2>
            <p class="card-note">按你填的模块 / 考点聚合，低的排前面。</p>
          </div>
        </div>
        <div class="data-list">
          ${
            modules.length
              ? modules
                  .map(
                    (item) => `
                <div class="data-row">
                  <span class="label">${escapeHtml(item.name)}</span>
                  ${progressBar(item.rate, rateTone(item.rate))}
                  <span class="value">${item.rate}%</span>
                  <span class="status tag ${rateTone(item.rate)}">${rateToneText(item.rate)}</span>
                </div>
              `,
                  )
                  .join("")
              : `<div class="empty-state compact">${icon("layers")}<strong>还没有模块数据</strong><span>录入时填「模块 / 章节」，这里按得分率排序。</span></div>`
          }
        </div>
        <div class="mini-note">${icon("crosshair")} ${weakest ? `当前最该优先补的是「${escapeHtml(weakest.name)}」，得分率 ${weakest.rate}%。` : "录入模块成绩后，这里会指出最该优先补的一本书。"}</div>
      </section>

      <section class="card card-pad span-4">
        <div class="card-head">
          <div>
            <h2 class="card-title">真题记录</h2>
            <p class="card-note">来源含「真题」的记录，最近 6 条。</p>
          </div>
          <span class="tag blue">${zhenti.length} 条</span>
        </div>
        <div class="review-list">
          ${
            zhenti.length
              ? zhenti
                  .map((record, index) =>
                    reviewItem(
                      escapeHtml(record.year || String(index + 1).padStart(2, "0")),
                      escapeHtml(`${record.source || "408 真题"} ${record.module || record.paper || ""}`.trim()),
                      escapeHtml(`${record.date || ""} · ${recordScoreText(record)} · 得分率 ${recordRate(record) ?? 0}%`),
                      reviewToneOf(record),
                    ),
                  )
                  .join("")
              : `<div class="empty-state compact">${icon("file-check-2")}<strong>还没有真题记录</strong><span>做完一套 408 真题后录一次，这里按年份列出来。</span></div>`
          }
        </div>
      </section>

      <section class="card card-pad span-8">
        <div class="card-head">
          <div>
            <h2 class="card-title">最近 408 记录</h2>
            <p class="card-note">课后题和真题分开统计，但共用同一套错题与复盘系统。</p>
          </div>
        </div>
        ${recordTableHTML(sorted, 10)}
      </section>
    </div>`
        : `
    <section class="card card-pad">
      ${recordEmptyState({
        title: "408 还没有记录",
        note: "做完一章王道课后题或一套真题后录一次，四本书的得分率和错题会自动汇总。",
        subject: "408",
        source: "王道课后题",
      })}
    </section>`
    }
  `;
}
/* ------------------------------------------------------- 封神之路 · 计划 */

function taskPriorityTone(priority) {
  return priority === "高" ? "red" : priority === "低" ? "blue" : "amber";
}

function planTaskRow(task) {
  const tone = taskPriorityTone(task.priority);
  return `
    <div class="plan-task ${task.done ? "done" : ""}">
      <button class="task-check-btn" type="button" data-task-toggle="${escapeAttr(task.id)}" aria-label="${task.done ? "标记为未完成" : "标记为已完成"}">${icon(task.done ? "check-circle-2" : "circle")}</button>
      <div class="plan-task-main">
        <p class="plan-task-title">${escapeHtml(task.title)}</p>
        <p class="plan-task-meta">
          <span class="tag ${tone}">${escapeHtml(task.priority)}</span>
          ${task.subject ? `<span>${escapeHtml(task.subject)}</span>` : ""}
          ${task.minutes ? `<span>${minutesText(task.minutes)}</span>` : ""}
          <span>${escapeHtml(task.date)}</span>
        </p>
        ${task.note ? `<p class="plan-task-note">${escapeHtml(task.note)}</p>` : ""}
      </div>
      <div class="row-actions">
        <button class="row-action" type="button" data-task-edit="${escapeAttr(task.id)}" title="修改这条计划">${icon("pencil-line")}</button>
        <button class="row-action" type="button" data-task-remove="${escapeAttr(task.id)}" title="删除这条计划">${icon("trash-2")}</button>
      </div>
    </div>
  `;
}

function planTaskList(tasks, emptyText) {
  if (!tasks.length) {
    return `
      <div class="empty-state compact">
        ${icon("calendar-plus")}
        <strong>${escapeHtml(emptyText)}</strong>
        <span>不用提前一天布置，随时点「新增任务」就能加进当天计划。</span>
      </div>
    `;
  }
  return `<div class="plan-task-list">${tasks.map(planTaskRow).join("")}</div>`;
}

function renderPlan() {
  const profile = STORE ? STORE.profile() : null;
  const tasks = STORE ? STORE.tasks() : [];
  const sortTasks = (list) =>
    [...list].sort(
      (left, right) =>
        Number(left.done) - Number(right.done) ||
        left.priority.localeCompare(right.priority) ||
        left.createdAt.localeCompare(right.createdAt),
    );
  const todayTasks = sortTasks(tasks.filter((task) => task.date === TODAY_KEY));
  const tomorrowKey = dateKey(shiftDate(1));
  const tomorrowTasks = sortTasks(tasks.filter((task) => task.date === tomorrowKey));
  const weekKeys = Array.from({ length: 7 }, (_, index) => dateKey(shiftDate(index)));
  const weekTasks = tasks.filter((task) => weekKeys.includes(task.date));
  const overdue = sortTasks(tasks.filter((task) => task.date && task.date < TODAY_KEY && !task.done));
  const doneToday = todayTasks.filter((task) => task.done).length;
  const doneWeek = weekTasks.filter((task) => task.done).length;
  const todayPercent = todayTasks.length ? Math.round((doneToday / todayTasks.length) * 100) : 0;
  const target = profile ? profile.target : { math: 130, english: 75, cs408: 115, politics: 70 };
  const targetTotal = target.math + target.english + target.cs408 + (profile && profile.showPolitics ? target.politics : 0);

  return `
    <div class="page-head">
      <div>
        <h1>今日计划 · 随时可改</h1>
        <p class="page-desc">今天、明天、本周的任务都能当场新增、修改、勾选完成；不需要提前一天排好。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn" data-screen="goal">${icon("target")} 目标与倒计时</button>
        <button class="primary-btn" type="button" data-task-new="${TODAY_KEY}">${icon("plus")} 新增任务</button>
      </div>
    </div>

    <section class="card goal-hero">
      <div class="goal-main">
        <span class="tag red">${icon("target")} ${profile && profile.school ? escapeHtml(profile.school) : "还没填目标院校"}</span>
        <h2>${profile && profile.major ? escapeHtml(profile.major) : "目标专业待设置"}</h2>
        <p>${profile ? escapeHtml(profile.examDate) : "2027-12-25"} 初试 · 当前目标总分 ${targetTotal}/500 · 计划可以随进度随时改</p>
      </div>
      <div class="goal-stats">
        <div class="goal-stat"><strong>${daysLeft}</strong><span>距初试天数</span></div>
        <div class="goal-stat"><strong>${todayTasks.length}</strong><span>今日任务</span></div>
        <div class="goal-stat"><strong>${todayPercent}%</strong><span>今日完成率</span></div>
      </div>
    </section>

    <div class="kpi-grid">
      ${kpiCard({ label: "今日任务", value: `${doneToday}/${todayTasks.length}`, unit: "项", sub: todayTasks.length ? "点左侧圆圈即可勾选完成" : "今天还没有任务", iconName: "list-checks", accent: "blue" })}
      ${kpiCard({ label: "本周任务", value: `${doneWeek}/${weekTasks.length}`, unit: "项", sub: weekTasks.length ? `完成率 ${Math.round((doneWeek / weekTasks.length) * 100)}%` : "本周还没有安排", iconName: "calendar-range", accent: "violet" })}
      ${kpiCard({ label: "待补任务", value: overdue.length, unit: "项", sub: overdue.length ? "逾期未完成，可以改到今天" : "没有逾期任务", iconName: "triangle-alert", accent: "amber" })}
      ${kpiCard({ label: "全部任务", value: tasks.length, unit: "项", sub: tasks.length ? `今日 ${todayTasks.length} 项 · 明日 ${tomorrowTasks.length} 项` : "从今天开始记录", iconName: "database", accent: "coral" })}
    </div>

    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div>
            <h2 class="card-title">今日计划</h2>
            <p class="card-note">${todayText} · ${doneToday}/${todayTasks.length} 项完成</p>
          </div>
          <button class="secondary-btn" type="button" data-task-new="${TODAY_KEY}">${icon("plus")} 加一项</button>
        </div>
        ${planTaskList(todayTasks, "今天还没有安排")}
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div>
            <h2 class="card-title">本周排布</h2>
            <p class="card-note">往后 7 天，哪天空着就点哪天补任务。</p>
          </div>
        </div>
        <div class="week-board compact">
          ${weekKeys
            .map((key) => {
              const dayTasks = tasks.filter((task) => task.date === key);
              const dayDone = dayTasks.filter((task) => task.done).length;
              const isToday = key === TODAY_KEY;
              const minutes = dayTasks.reduce((sum, task) => sum + task.minutes, 0);
              return `
                <button class="day-card large ${isToday ? "today" : ""}" type="button" data-task-new="${key}">
                  <div class="day-top"><strong>${isToday ? "今天" : weekdayText(key)}</strong><span>${key.slice(5)}</span></div>
                  <p>${dayTasks.length ? `${dayTasks.slice(0, 2).map((task) => escapeHtml(task.title)).join("<br />")}` : "还没有任务"}</p>
                  <div class="day-hours">${icon("clock-3")} ${minutes ? minutesText(minutes) : "未排"}</div>
                  ${progressBar(dayTasks.length ? Math.round((dayDone / dayTasks.length) * 100) : 0, dayDone && dayDone === dayTasks.length ? "green" : "blue")}
                </button>
              `;
            })
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-6">
        <div class="card-head">
          <div>
            <h2 class="card-title">明日计划</h2>
            <p class="card-note">${tomorrowKey} · ${weekdayText(tomorrowKey)} · ${tomorrowTasks.length} 项</p>
          </div>
          <button class="secondary-btn" type="button" data-task-new="${tomorrowKey}">${icon("plus")} 加一项</button>
        </div>
        ${planTaskList(tomorrowTasks, "明天还没有安排")}
      </section>

      <section class="card card-pad span-6">
        <div class="card-head">
          <div>
            <h2 class="card-title">待补任务</h2>
            <p class="card-note">之前没做完的会自动留在这里，随时改日期或删掉。</p>
          </div>
          <span class="tag ${overdue.length ? "amber" : "blue"}">${overdue.length} 项</span>
        </div>
        ${planTaskList(overdue, "没有逾期任务")}
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">全部任务</h2>
            <p class="card-note">按日期列出所有任务；点铅笔改内容、日期、用时和优先级。</p>
          </div>
          <button class="primary-btn" type="button" data-task-new="${TODAY_KEY}">${icon("plus")} 新增任务</button>
        </div>
        ${
          tasks.length
            ? `<div class="table-wrap">
                <table>
                  <thead><tr><th>日期</th><th>任务</th><th>科目</th><th>用时</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead>
                  <tbody>
                    ${[...tasks]
                      .sort((left, right) => (right.date || "").localeCompare(left.date || "") || left.createdAt.localeCompare(right.createdAt))
                      .map(
                        (task) => `
                          <tr class="${task.done ? "row-done" : ""}">
                            <td>${escapeHtml(task.date || "-")}</td>
                            <td>${escapeHtml(task.title)}</td>
                            <td>${escapeHtml(task.subject || "-")}</td>
                            <td>${task.minutes ? minutesText(task.minutes) : "-"}</td>
                            <td><span class="tag ${taskPriorityTone(task.priority)}">${escapeHtml(task.priority)}</span></td>
                            <td>${task.done ? '<span class="tag blue">已完成</span>' : '<span class="tag amber">待完成</span>'}</td>
                            <td><div class="row-actions">
                              <button class="row-action" type="button" data-task-toggle="${escapeAttr(task.id)}" title="切换完成状态">${icon(task.done ? "rotate-ccw" : "check")}</button>
                              <button class="row-action" type="button" data-task-edit="${escapeAttr(task.id)}" title="修改">${icon("pencil-line")}</button>
                              <button class="row-action" type="button" data-task-remove="${escapeAttr(task.id)}" title="删除">${icon("trash-2")}</button>
                            </div></td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : `<div class="empty-state">${icon("calendar-plus")}<strong>还没有任何任务</strong><span>现在就能加今天的任务，不用等到明天。</span><button class="primary-btn" type="button" data-task-new="${TODAY_KEY}">新增第一个任务</button></div>`
        }
      </section>
    </div>
  `;
}

function renderGoal() {
  const profile = STORE ? STORE.profile() : null;
  if (!profile) {
    return `<section class="card card-pad">${icon("triangle-alert")} 数据层未加载。</section>`;
  }
  const targetTotal = profile.target.math + profile.target.english + profile.target.cs408 + (profile.showPolitics ? profile.target.politics : 0);
  const daysToExam = Math.max(0, Math.ceil((new Date(`${profile.examDate}T00:00:00+08:00`) - today) / DAY_MS));
  return `
    <div class="page-head">
      <div>
        <h1>目标与倒计时</h1>
        <p class="page-desc">考试日期、院校专业和目标分数都能改；计划页会跟着这个日期和分数走。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn" data-screen="plan">${icon("calendar-range")} 去排今日计划</button>
      </div>
    </div>

    <section class="card goal-hero">
      <div class="goal-main">
        <span class="tag red">${icon("graduation-cap")} 2028 考研</span>
        <h2>${escapeHtml(profile.school || "目标院校待填写")} · ${escapeHtml(profile.major || "目标专业待填写")}</h2>
        <p>初试日期 ${escapeHtml(profile.examDate)} · 目标总分 ${targetTotal}/500${profile.showPolitics ? "" : " · 政治模块默认关闭"} </p>
      </div>
      <div class="goal-stats">
        <div class="goal-stat"><strong>${daysToExam}</strong><span>距初试</span></div>
        <div class="goal-stat"><strong>${targetTotal}</strong><span>目标总分</span></div>
        <div class="goal-stat"><strong>${STORE.tasks().length}</strong><span>已排任务</span></div>
      </div>
    </section>

    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div><h2 class="card-title">目标设置</h2><p class="card-note">改完点保存，下一次打开还是这份设置。</p></div>
        </div>
        <div class="form-grid">
          <div class="field">
            <label for="goal-exam-date">初试日期</label>
            <input id="goal-exam-date" type="date" value="${escapeAttr(profile.examDate)}" />
          </div>
          <div class="field">
            <label for="goal-school">目标院校</label>
            <input id="goal-school" type="text" value="${escapeAttr(profile.school)}" placeholder="例如 中国科学技术大学" />
          </div>
          <div class="field span-12">
            <label for="goal-major">目标专业</label>
            <input id="goal-major" type="text" value="${escapeAttr(profile.major)}" placeholder="例如 计算机专硕 085404" />
          </div>
          <div class="field">
            <label for="goal-math">数学目标分</label>
            <input id="goal-math" type="number" min="0" max="150" value="${profile.target.math}" />
          </div>
          <div class="field">
            <label for="goal-english">英语目标分</label>
            <input id="goal-english" type="number" min="0" max="100" value="${profile.target.english}" />
          </div>
          <div class="field">
            <label for="goal-cs408">408 目标分</label>
            <input id="goal-cs408" type="number" min="0" max="150" value="${profile.target.cs408}" />
          </div>
          <div class="field">
            <label for="goal-politics">政治目标分</label>
            <input id="goal-politics" type="number" min="0" max="100" value="${profile.target.politics}" />
          </div>
          <label class="field span-12 checkbox-field">
            <input id="goal-show-politics" type="checkbox" ${profile.showPolitics ? "checked" : ""} />
            <span>在总分里计入政治（不考政治可以一直关着）</span>
          </label>
        </div>
        <div class="head-actions">
          <button class="primary-btn" type="button" data-save-profile>${icon("check")} 保存目标</button>
        </div>
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div><h2 class="card-title">怎么用</h2><p class="card-note">三步把 XXRJ 跑起来。</p></div>
        </div>
        <div class="review-list">
          ${reviewItem("1", "数学页录入章节进度", "选书 → 选分册 → 点某一章 → 填完成题数、正确率、错题", "blue")}
          ${reviewItem("2", "计划页记今天要做什么", "随时加、随时改、随时勾完成，不需要提前一天", "violet")}
          ${reviewItem("3", "数据与备份导出 JSON", "换电脑或重装手机时导入同一份文件即可恢复", "coral")}
        </div>
        <div class="mini-note">${icon("cloud-check")} 登录 iball 账号后，进度会跟随账号同步；不接入任何第三方登录。</div>
      </section>
    </div>
  `;
}

function renderData() {
  const usage = STORE ? STORE.usageBytes() : 0;
  const kb = usage ? (usage / 1024).toFixed(1) : "0";
  const tasks = STORE ? STORE.tasks() : [];
  const records = STORE ? STORE.records() : [];
  const entered = STORE ? STORE.enteredChapters() : 0;
  return `
    <div class="page-head">
      <div>
        <h1>数据与备份</h1>
        <p class="page-desc">计划、成绩、章节进度都存在当前 iball 账号的空间里；支持导出、导入和一键初始化。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn" type="button" data-export-json>${icon("download")} 导出 JSON</button>
        <button class="secondary-btn" type="button" data-import-json>${icon("upload")} 导入 JSON</button>
        <button class="secondary-btn danger" type="button" data-reset-data>${icon("trash-2")} 初始化全部数据</button>
        <input id="import-json-file" type="file" accept="application/json,.json" hidden />
      </div>
    </div>
    <div class="kpi-grid">
      ${kpiCard({ label: "计划任务", value: tasks.length, unit: "条", sub: tasks.filter((task) => task.date === TODAY_KEY).length ? `今天 ${tasks.filter((task) => task.date === TODAY_KEY).length} 条` : "今天还没有任务", iconName: "list-checks", accent: "blue" })}
      ${kpiCard({ label: "录入记录", value: records.length, unit: "条", sub: records.length ? `最近 ${records[records.length - 1].date || "未填日期"}` : "还没有录入成绩", iconName: "database", accent: "violet" })}
      ${kpiCard({ label: "已录入章节", value: entered, unit: "章", sub: "数学章节进度，按书分开", iconName: "book-open-check", accent: "coral" })}
      ${kpiCard({ label: "存储占用", value: kb, unit: "KB", sub: "浏览器本地存储；登录后同步到 iball 账号", iconName: "hard-drive", accent: "amber" })}
    </div>
    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div><h2 class="card-title">账号与同步</h2><p class="card-note">只绑定 iball 账号：同一个账号在任何设备上打开都是同一份数据。</p></div>
        </div>
        <div class="review-list">
          ${reviewItem("账", "账号命名空间", "不同 iball 账号的数据互不可见", "blue")}
          ${reviewItem("云", "登录后自动同步", "改一条自动进同步队列，不需要手动保存", "violet")}
          ${reviewItem("本地", "未登录也能用", "没登录时先存在本机，登录同一个账号后再同步", "coral")}
        </div>
        <div class="mini-note" id="data-sync-note">${icon("cloud-check")} 当前状态：本地模式，未绑定 iball 账号。</div>
      </section>
      <section class="card card-pad span-5">
        <div class="card-head">
          <div><h2 class="card-title">导出与初始化</h2><p class="card-note">导出的 JSON 就是当前账号的全部学习数据。</p></div>
        </div>
        <div class="plan-list">
          <button class="list-action" type="button" data-export-json>${icon("download")}<span><strong>导出全部数据（JSON）</strong><em>包含计划、成绩记录、章节进度、知识点与复盘历史</em></span></button>
          <button class="list-action" type="button" data-import-json>${icon("upload")}<span><strong>导入备份</strong><em>用之前导出的 JSON 覆盖当前账号数据</em></span></button>
          <button class="list-action danger" type="button" data-reset-data>${icon("trash-2")}<span><strong>初始化全部数据</strong><em>清空测试数据回到全新状态，执行前会再确认一次</em></span></button>
        </div>
      </section>
    </div>
  `;
}

const GUIDE_LINKS = [
  ["XXRJ（封神之路，当前页）", "/xxrj/", "考研 11408 学习档案：数学章节进度、今日计划、成绩录入、目标与备份"],
  ["词汇库", "/vocab.html", "恋练有词 2027 等词书：斩 / 已会、背词记录、默认词书顺序与字母序"],
  ["考研英语", "/kaoyan.html", "历年真题逐题精读、全文翻译和作文批改"],
  ["外刊精读", "/periodical.html", "经济学人等外刊的逐段精读与检验题"],
  ["影视英语", "/movie.html", "按剧集和电影练听力与口语表达"],
  ["听力训练", "/listen.html", "每日听力与真题听写"],
  ["影子跟读", "/shadow.html", "逐句跟读与发音对比"],
  ["口语陪练", "/speaking.html", "雅思 / 考研复试口语场景练习"],
  ["自测与检验", "/quiz.html", "按记忆曲线出题检验"],
  ["复习中心", "/review.html", "到期复习队列"],
  ["阅读理解", "/reading.html", "长难句与阅读专项"],
  ["写作批改", "/writing.html", "作文打分与逐句修改"],
  ["精读训练", "/intensive.html", "逐句拆解与语法标注"],
  ["六级专区", "/cet6.html", "六级真题与词汇"],
  ["后台管理", "/admin.html", "词库、站点设置和用户数据管理"],
];

function renderGuide() {
  const site = "https://www.iball.top";
  return `
    <div class="page-head">
      <div>
        <h1>使用说明与网址</h1>
        <p class="page-desc">XXRJ（封神之路）是 iball 小屋里的考研学习模块；下面是完整入口和最短上手指南。</p>
      </div>
    </div>

    <div class="grid">
      <section class="card card-pad span-7">
        <div class="card-head">
          <div><h2 class="card-title">XXRJ 怎么用</h2><p class="card-note">四步就能每天用起来。</p></div>
        </div>
        <div class="review-list">
          ${reviewItem("1", "数学：先选书，再选分册，点章节录入", "数学页顶部按「习题册 / 讲义 / 模拟卷 / 真题」分组；每本书有自己的章节导航，各自记进度，不会互相覆盖", "blue")}
          ${reviewItem("2", "今天计划：随时加、随时改", "计划页点「新增任务」写今天要做什么；任务卡片上的圆圈勾完成，铅笔改内容或日期，垃圾桶删除", "violet")}
          ${reviewItem("3", "录入成绩：整卷、章节、错题都能记", "右上角「录入成绩」选科目和来源；数学的来源就是各本资料的书名，记完自动汇总", "coral")}
          ${reviewItem("4", "数据与备份：导出 JSON", "换设备或重装前先导出；登录 iball 账号后会自动同步，不接入第三方账号", "amber")}
        </div>
      </section>

      <section class="card card-pad span-5">
        <div class="card-head">
          <div><h2 class="card-title">数学资料覆盖</h2><p class="card-note">共 ${YM_BOOKS.length} 本资料，每本一套章节导航。</p></div>
        </div>
        <div class="guide-books">
          ${YM_GROUPS
            .map(
              (group) => `
                <div class="guide-book-group">
                  <strong>${escapeHtml(group.label)}</strong>
                  <p>${YM_BOOKS.filter((book) => book.group === group.key).map((book) => escapeHtml(book.tab)).join(" · ")}</p>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="card card-pad span-12">
        <div class="card-head">
          <div><h2 class="card-title">全部网址</h2><p class="card-note">直接在浏览器输入下面地址即可打开对应模块。</p></div>
          <a class="primary-btn" href="${site}/xxrj/" target="_blank" rel="noopener">${icon("external-link")} 打开 XXRJ</a>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>模块</th><th>网址</th><th>用途</th></tr></thead>
            <tbody>
              ${GUIDE_LINKS.map(
                ([name, path, note]) => `
                  <tr>
                    <td><strong>${escapeHtml(name)}</strong></td>
                    <td><a class="link" href="${site}${path}" target="_blank" rel="noopener">${site}${path}</a></td>
                    <td>${escapeHtml(note)}</td>
                  </tr>
                `,
              ).join("")}
            </tbody>
          </table>
        </div>
        <div class="mini-note">${icon("shield-check")} 账号只和 iball 绑定：用主站同一个账号登录，学习数据按账号隔离；没有第三方登录，也不会把数据交给别的平台。</div>
      </section>
    </div>
  `;
}

/* --------------------------------------------------- 待复盘（知识点 + 错题） */

const KNOWLEDGE_SUBJECTS = ["数学一", "英语一", "英语二", "408", "政治"];
const KNOWLEDGE_STATUSES = ["待复盘", "已复盘", "已掌握"];

function knowledgeTone(subject) {
  const text = String(subject || "");
  if (text.startsWith("数学")) return "blue";
  if (text.startsWith("英语")) return "violet";
  if (text.includes("408")) return "amber";
  if (text.includes("政治")) return "coral";
  return "cyan";
}

function knowledgeStatusTone(status) {
  if (status === "已掌握") return "green";
  if (status === "已复盘") return "blue";
  return "amber";
}

/** 知识点排期状态：逾期、今天到期、已排期或未排期。 */
function knowledgeDueText(item) {
  if (item.status === "已掌握") return "已掌握";
  if (!item.reviewDate) return "未排期";
  if (item.reviewDate < TODAY_KEY) return `逾期 ${item.reviewDate}`;
  if (item.reviewDate === TODAY_KEY) return "今天到期";
  return `下次 ${item.reviewDate}`;
}

function knowledgeDueTone(item) {
  if (item.status === "已掌握") return "green";
  if (!item.reviewDate) return "amber";
  if (item.reviewDate <= TODAY_KEY) return "red";
  return "blue";
}

/** 一条知识点一张卡：状态、排期、复盘历史、写复盘和顺延都在卡上完成。 */
function knowledgeCardHTML(item) {
  return `
    <article class="knowledge-card" data-knowledge-card="${escapeAttr(item.id)}">
      <div class="knowledge-top">
        <div class="knowledge-tags">
          <span class="tag ${knowledgeTone(item.subject)}">${escapeHtml(item.subject || "未填科目")}</span>
          <span class="tag ${knowledgeStatusTone(item.status)}">${escapeHtml(item.status)}</span>
          <span class="tag ${knowledgeDueTone(item)}">${escapeHtml(knowledgeDueText(item))}</span>
        </div>
        <div class="row-actions">
          <button class="ghost-btn" type="button" data-knowledge-edit="${escapeAttr(item.id)}">${icon("pencil")} 编辑</button>
          <button class="ghost-btn danger" type="button" data-knowledge-remove="${escapeAttr(item.id)}">${icon("trash-2")} 删除</button>
        </div>
      </div>
      <h3 class="knowledge-topic">${escapeHtml(item.topic || "未填知识点")}</h3>
      ${item.detail ? `<p class="knowledge-detail">${escapeHtml(item.detail)}</p>` : ""}
      <div class="knowledge-meta">
        <span>${icon("calendar")} 记录 ${escapeHtml(item.date || "未填")}</span>
        <span>${icon("repeat-2")} 已复盘 ${item.reviewCount} 次</span>
        <span>${icon("history")} 最近 ${escapeHtml(item.lastReviewDate || "还没复盘")}</span>
      </div>
      ${reviewHistoryHTML(item)}
      <div class="knowledge-foot">
        <button class="primary-btn" type="button" data-knowledge-log="${escapeAttr(item.id)}">${icon("notebook-pen")} 写复盘</button>
        <div class="snooze-group">
          <span>顺延</span>
          <button class="ghost-btn" type="button" data-knowledge-snooze="${escapeAttr(item.id)}" data-days="1">明天</button>
          <button class="ghost-btn" type="button" data-knowledge-snooze="${escapeAttr(item.id)}" data-days="3">3 天</button>
          <button class="ghost-btn" type="button" data-knowledge-snooze="${escapeAttr(item.id)}" data-days="7">一周</button>
        </div>
        <label class="status-select">
          <span>状态</span>
          <select data-knowledge-status="${escapeAttr(item.id)}" aria-label="知识点状态">
            ${KNOWLEDGE_STATUSES.map(
              (status) => `<option${status === item.status ? " selected" : ""}>${status}</option>`,
            ).join("")}
          </select>
        </label>
      </div>
    </article>
  `;
}

/** 总览用的一行待复盘汇总，和侧栏徽章口径一致。 */
function dailyReviewSummaryHTML() {
  const knowledge = knowledgeAll();
  const dueKnowledge = pendingKnowledge(knowledge);
  const mistakes = mistakeRecordsOf();
  const dueMistakes = pendingReviewRecords(mistakes);
  const total = dueKnowledge.length + dueMistakes.length;
  return `
    <section class="card card-pad span-12 review-summary-card">
      <div class="card-head">
        <div>
          <h2 class="card-title">待复盘</h2>
          <p class="card-note">知识点和错题里今天该复盘的，都汇总在这里。</p>
        </div>
        <div class="head-actions">
          <span class="tag ${total ? "amber" : "green"}">${total ? `今天待复盘 ${total} 条` : "今天没有到期的复盘"}</span>
          <button class="primary-btn" type="button" data-screen="daily-review">${icon("notebook-pen")} 去复盘</button>
        </div>
      </div>
      <div class="review-summary-grid">
        <button class="review-summary-item" type="button" data-screen="daily-review">
          <strong>${dueKnowledge.length}</strong>
          <span>知识点待复盘</span>
          <em>共 ${knowledge.length} 条 · 已掌握 ${knowledge.filter((item) => item.status === "已掌握").length} 条</em>
        </button>
        <button class="review-summary-item" type="button" data-screen="mistakes">
          <strong>${dueMistakes.length}</strong>
          <span>错题待复盘</span>
          <em>错题本共 ${mistakes.length} 题</em>
        </button>
      </div>
    </section>
  `;
}

function pendingMistakeTableHTML(records, limit = 12) {
  const rows = records.slice(0, limit);
  if (!rows.length) {
    return `
      <div class="empty-state compact">
        ${icon("check-check")}
        <strong>没有到期的错题</strong>
        <span>错题本里排了期的题，到期后会出现在这里。</span>
      </div>
    `;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>日期</th><th>科目</th><th>题目</th><th>模块 / 考点</th><th>下次复盘</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (record) => `
                <tr>
                  <td>${escapeHtml(record.date || "-")}</td>
                  <td>${escapeHtml(record.subject || "-")}</td>
                  <td><span class="question-no">${escapeHtml(record.question || record.source || "整卷记录")}</span></td>
                  <td>${escapeHtml(record.module || record.paper || "-")}</td>
                  <td>${escapeHtml(record.reviewDate || "未排期")}</td>
                  <td><span class="tag ${annotateStatusTone(record)}">${escapeHtml(masteryTagText(record))}</span></td>
                  <td><button class="ghost-btn" type="button" data-screen="mistakes">${icon("notebook-tabs")} 去错题本</button></td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
    ${records.length > limit ? `<div class="mini-note">${icon("info")} 还有 ${records.length - limit} 题，去错题本看完整列表。</div>` : ""}
  `;
}

function renderDailyReview() {
  const knowledge = knowledgeAll();
  const pending = knowledge.filter((item) => item.status === "待复盘");
  const due = pendingKnowledge(knowledge);
  const reviewed = knowledge.filter((item) => item.status === "已复盘");
  const mastered = knowledge.filter((item) => item.status === "已掌握");
  const mistakes = sortedByDate(mistakeRecordsOf(), -1);
  const dueMistakes = sortedByDate(pendingReviewRecords(mistakes), -1);
  const filters = {
    all: knowledge,
    pending,
    due,
    reviewed,
    mastered,
  };
  const activeFilter = filters[state.reviewFilter] ? state.reviewFilter : "all";
  const visible = filters[activeFilter];
  const filterChips = [
    ["all", "全部", knowledge.length],
    ["pending", "待复盘", pending.length],
    ["due", "今天到期", due.length],
    ["reviewed", "已复盘", reviewed.length],
    ["mastered", "已掌握", mastered.length],
  ];

  return `
    <div class="page-head">
      <div>
        <h1>待复盘</h1>
        <p class="page-desc">知识点按排期进入复盘队列；每次复盘追加一条历史，不覆盖之前写过的内容，和错题本共享同一天的复盘节奏。</p>
      </div>
      <div class="head-actions">
        <button class="secondary-btn" type="button" data-screen="mistakes">${icon("notebook-tabs")} 错题本</button>
        <button class="primary-btn" type="button" data-knowledge-new>${icon("plus")} 新增知识点</button>
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard({ label: "待复盘知识点", value: pending.length, unit: "条", sub: due.length ? `今天到期 / 未排期 ${due.length} 条` : "没有到期的知识点", iconName: "notebook-pen", accent: "amber" })}
      ${kpiCard({ label: "错题待复盘", value: dueMistakes.length, unit: "题", sub: `错题本共 ${mistakes.length} 题`, iconName: "notebook-tabs", accent: "red" })}
      ${kpiCard({ label: "已复盘", value: reviewed.length, unit: "条", sub: reviewed.length ? "已经写过复盘、等待下次排期" : "还没有写过复盘", iconName: "history", accent: "blue" })}
      ${kpiCard({ label: "已掌握", value: mastered.length, unit: "条", sub: mastered.length ? "不再进入待复盘队列" : "还没有标记已掌握的知识点", iconName: "check-check", accent: "green" })}
    </div>

    <div class="filter-row">
      ${filterChips
        .map(
          ([key, label, count]) =>
            `<button class="filter-chip${key === activeFilter ? " active" : ""}" type="button" data-review-filter="${key}">${label} ${count}</button>`,
        )
        .join("")}
    </div>

    ${
      visible.length
        ? `<div class="grid knowledge-grid">${visible.map((item) => knowledgeCardHTML(item)).join("")}</div>`
        : `
          <section class="card card-pad span-12">
            <div class="empty-state">
              ${icon("notebook-pen")}
              <strong>${knowledge.length ? "这个筛选下没有知识点" : "还没有待复盘的知识点"}</strong>
              <span>${knowledge.length ? "换一个筛选看看。" : "把今天卡住的概念、公式或题型记下来，排好下次复盘的时间。"}</span>
              <button class="primary-btn" type="button" data-knowledge-new>${icon("plus")} 新增知识点</button>
            </div>
          </section>
        `
    }

    <div class="grid">
      <section class="card card-pad span-12">
        <div class="card-head">
          <div>
            <h2 class="card-title">错题待复盘</h2>
            <p class="card-note">已到排期或还没排期的错题；在错题本里标注错因、复盘次数和下次时间。</p>
          </div>
          <div class="head-actions">
            <span class="tag ${dueMistakes.length ? "red" : "green"}">${dueMistakes.length} 题</span>
            <button class="secondary-btn" type="button" data-screen="mistakes">${icon("external-link")} 打开错题本</button>
          </div>
        </div>
        ${pendingMistakeTableHTML(dueMistakes)}
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
  "daily-review": { title: "待复盘", render: renderDailyReview },
  goal: { title: "目标与倒计时", render: renderGoal },
  guide: { title: "使用说明与网址", render: renderGuide },
  data: { title: "数据与备份", render: renderData },
};

function render() {
  const screen = screens[state.screen] || screens.dashboard;
  // 标题跟着页面走：浏览器标签页好认，管理台的模块使用也靠它区分小屋内的页面。
  document.title = `${screen.title} · 小屋`;
  document.getElementById("crumb-current").textContent = screen.title;
  document.getElementById("app").innerHTML = screen.render();
  syncHeatmapScroll();
  document.querySelectorAll("[data-screen]").forEach((button) => {
    button.classList.toggle("active", button.dataset.screen === state.screen);
  });
  const planBadge = document.querySelector('.nav-item[data-screen="plan"] .nav-badge');
  if (planBadge && STORE) {
    const todayCount = STORE.tasksOf(TODAY_KEY).length;
    planBadge.textContent = String(todayCount);
    planBadge.hidden = todayCount === 0;
  }
  const reviewBadge = document.getElementById("review-badge");
  const mistakesBadge = document.getElementById("mistakes-badge");
  if (STORE && (reviewBadge || mistakesBadge)) {
    const dueKnowledge = pendingKnowledge(knowledgeAll()).length;
    const dueMistakes = pendingReviewRecords(mistakeRecordsOf()).length;
    if (reviewBadge) {
      const total = dueKnowledge + dueMistakes;
      reviewBadge.textContent = String(total);
      reviewBadge.hidden = total === 0;
      reviewBadge.title = `今天待复盘：知识点 ${dueKnowledge} 条 · 错题 ${dueMistakes} 题`;
    }
    if (mistakesBadge) {
      mistakesBadge.textContent = String(dueMistakes);
      mistakesBadge.hidden = dueMistakes === 0;
      mistakesBadge.title = `待复盘错题 ${dueMistakes} 题`;
    }
  }
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  }
  mountLlycPanel();
  paintAccountChrome();
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
const entryKindField = document.getElementById("entry-kind-field");
const entryKind = document.getElementById("entry-kind");
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
  setSelectOptions(entrySource, entrySources(entrySubject.value, options), entrySource.value);
  setSelectOptions(entryPaperType, options.papers, entryPaperType.value);
  setSelectOptions(entryModule, options.modules, entryModule.value);
  // 「英语类型」只对英语一 / 英语二有意义，其它科目录进来的 kind 一律清空。
  const english = entrySubject.value.startsWith("英语");
  if (entryKindField) entryKindField.hidden = !english;
  if (!english && entryKind) entryKind.value = "";
  refreshChoiceFields(entryModal);
  renderWrongGrid([]);
  syncWrongFieldVisibility();
}

/** 数学一的来源里带上全部资料名，录成绩时能直接对上封神之路里的书。 */
function entrySources(subject, options) {
  if (subject !== "数学一") return options.sources;
  const bookNames = YM_BOOKS.map((book) => book.tab).filter(Boolean);
  return [...new Set([...options.sources, ...bookNames])];
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

const entryDate = document.getElementById("entry-date");
const entryYear = document.getElementById("entry-year");
const entryRound = document.getElementById("entry-round");
const entryStatus = document.getElementById("entry-status");
const entryCount = document.getElementById("entry-count");
const entryCorrect = document.getElementById("entry-correct");
const entryTime = document.getElementById("entry-time");
const entryErrorType = document.getElementById("entry-error-type");
const entryReview = document.getElementById("entry-review");
const entryNote = document.getElementById("entry-note");
const entryModalNote = document.getElementById("entry-modal-note");
const ENTRY_NOTE_DEFAULT = "失分自动计算；保存后写进当前 iball 账号的数据档案。";

/* ------------------------------------------- 逐题标记：做对 / 做错分开多选 */

const entryWrongField = document.getElementById("entry-wrong-field");
const entryWrongLabel = document.getElementById("entry-wrong-label");
const entryWrongGrid = document.getElementById("entry-wrong-grid");
const entryWrongCount = document.getElementById("entry-wrong-count");
const entryMarkModes = document.getElementById("entry-mark-modes");
const entryMarkSummary = document.getElementById("entry-mark-summary");

/** 题号范围按科目给一套够用的默认值。 */
const WRONG_QUESTION_RANGES = [
  { key: "math", match: (subject) => subject.startsWith("数学"), max: 23, label: "数学真题" },
  { key: "english", match: (subject) => subject.startsWith("英语"), max: 48, label: "英语真题" },
  { key: "cs408", match: (subject) => subject === "408" || subject.includes("408"), max: 47, label: "408 真题" },
];

/** wrong 进复盘，correct 只算完成题数。 */
const ENTRY_MARKS = ["wrong", "correct"];
const ENTRY_MARK_HINT =
  "先选「做错」或「做对」，再点题号；同一个题号再点一次取消。做对和做错分开统计，做错的自动进入待复盘。";
let entryMarkMode = "wrong";

function wrongRangeFor(subject) {
  const key = String(subject || "");
  return WRONG_QUESTION_RANGES.find((item) => item.match(key)) || WRONG_QUESTION_RANGES[0];
}

function setEntryMarkMode(mode) {
  entryMarkMode = ENTRY_MARKS.includes(mode) ? mode : "wrong";
  entryMarkModes?.querySelectorAll("[data-entry-mark]").forEach((node) => {
    const active = node.dataset.entryMark === entryMarkMode;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  });
}

/** 题号格当前状态：题号 -> wrong / correct。 */
function selectedEntryMarks() {
  const marks = new Map();
  if (!entryWrongGrid) return marks;
  entryWrongGrid.querySelectorAll(".question-cell").forEach((cell) => {
    const number = Number(cell.dataset.question);
    const mark = String(cell.dataset.mark || "");
    if (Number.isFinite(number) && number > 0 && ENTRY_MARKS.includes(mark)) {
      marks.set(number, mark);
    }
  });
  return marks;
}

/** 旧口径：只关心做错的题号。 */
function selectedWrongNumbers() {
  return [...selectedEntryMarks().entries()]
    .filter(([, mark]) => mark === "wrong")
    .map(([number]) => number)
    .sort((left, right) => left - right);
}

function entryMarkCounts(marks = selectedEntryMarks()) {
  let wrong = 0;
  let correct = 0;
  marks.forEach((mark) => {
    if (mark === "wrong") wrong += 1;
    else if (mark === "correct") correct += 1;
  });
  return { wrong, correct, total: wrong + correct };
}

function syncWrongFieldVisibility() {
  if (!entryWrongField) return;
  const status = entryStatus ? entryStatus.value : "";
  entryWrongField.hidden = status === "学习进度";
}

/** 学习题数和刷题轮次分开显示：题数只看标记，轮次只做标签。 */
function syncEntryMarkSummary(counts = entryMarkCounts()) {
  if (!entryMarkSummary) return;
  if (!counts.total) {
    entryMarkSummary.textContent = ENTRY_MARK_HINT;
    return;
  }
  const round = mathRoundMeta(entryRound ? entryRound.value : 1);
  entryMarkSummary.textContent = `本次学习 ${counts.total} 道 · ${round.label}：做对 ${counts.correct} 道，做错 ${counts.wrong} 道（做错的自动进入待复盘）。`;
}

function syncWrongGridState() {
  const counts = entryMarkCounts();
  if (entryWrongCount) {
    entryWrongCount.textContent = counts.total
      ? `做对 ${counts.correct} · 做错 ${counts.wrong}`
      : "未选择";
  }
  if (entryWrongLabel) {
    const range = wrongRangeFor(entrySubject.value);
    entryWrongLabel.textContent = `${range.label} · 第 1-${range.max} 题，点哪个算哪个`;
  }
  syncEntryMarkSummary(counts);
}

/** 重画题号格；Map 是题号到标记，数组 / Set 按旧口径当成「全做错」。 */
function renderWrongGrid(marks = selectedEntryMarks()) {
  if (!entryWrongGrid) return;
  const range = wrongRangeFor(entrySubject.value);
  const source =
    marks instanceof Map
      ? marks
      : new Map(
          (Array.isArray(marks) ? marks : [...(marks || [])]).map((number) => [Number(number), "wrong"]),
        );
  entryWrongGrid.dataset.range = String(range.max);
  entryWrongGrid.innerHTML = Array.from({ length: range.max }, (_, index) => index + 1)
    .map((number) => {
      const mark = ENTRY_MARKS.includes(source.get(number)) ? source.get(number) : "";
      const classes = ["question-cell"];
      if (mark) classes.push("active");
      if (mark === "wrong") classes.push("is-wrong");
      if (mark === "correct") classes.push("is-correct");
      return `<button class="${classes.join(" ")}" type="button" data-question="${number}" data-mark="${mark}" aria-pressed="${mark ? "true" : "false"}">${number}</button>`;
    })
    .join("");
  syncWrongGridState();
}

/** 点一下按当前模式打标记，点同一个再取消。 */
function toggleQuestionMark(cell) {
  if (!cell) return;
  const next = String(cell.dataset.mark || "") === entryMarkMode ? "" : entryMarkMode;
  cell.dataset.mark = next;
  cell.classList.toggle("active", Boolean(next));
  cell.classList.toggle("is-wrong", next === "wrong");
  cell.classList.toggle("is-correct", next === "correct");
  cell.setAttribute("aria-pressed", String(Boolean(next)));
  syncWrongGridState();
}

/** 主记录下每题挂一条详情；id 固定成「主记录-q题号」，编辑时不会重复生成。 */
function entryDetailId(summaryId, number) {
  return `${summaryId}-q${number}`;
}

function entryDetailRecordsOf(summaryId) {
  if (!STORE || !summaryId) return [];
  return STORE.records().filter((record) => record.id.startsWith(`${summaryId}-q`));
}

function entryDetailNumber(record) {
  return Number(String((record && record.question) || "").replace(/[^\d]/g, ""));
}

/** 旧口径：只返回做错的题号。 */
function entryDetailNumbersOf(summaryId) {
  return [...entryDetailMarksOf(summaryId).entries()]
    .filter(([, mark]) => mark === "wrong")
    .map(([number]) => number)
    .sort((left, right) => left - right);
}

/** 编辑回填：逐题详情还原成题号 -> wrong / correct。 */
function entryDetailMarksOf(summaryId) {
  const marks = new Map();
  entryDetailRecordsOf(summaryId).forEach((record) => {
    const number = entryDetailNumber(record);
    if (!Number.isFinite(number) || number <= 0) return;
    const wrong =
      record.status === "错题复盘" ||
      record.status === "一直不会的题" ||
      Boolean(String(record.errorType || "").trim()) ||
      Boolean(record.reviewDate) ||
      (Number(record.count) > 0 && Number(record.correct) < Number(record.count));
    marks.set(number, wrong ? "wrong" : "correct");
  });
  return marks;
}

/** 保存主记录时同步逐题详情：做错生成待复盘错题，做对只留一条已完成记录。 */
function syncEntryDetails(summary, marks) {
  if (!STORE || !summary || !summary.id) return 0;
  const source = marks instanceof Map ? marks : new Map();
  const existing = entryDetailRecordsOf(summary.id);
  if (!source.size && !existing.length) return 0;
  const keep = new Set([...source.keys()].map((number) => entryDetailId(summary.id, number)));
  existing.forEach((record) => {
    if (!keep.has(record.id)) STORE.removeRecord(record.id);
  });
  source.forEach((mark, number) => {
    const wrong = mark === "wrong";
    STORE.upsertRecord({
      id: entryDetailId(summary.id, number),
      date: summary.date,
      subject: summary.subject,
      source: summary.source,
      year: summary.year,
      paper: summary.paper,
      module: summary.module,
      kind: summary.kind,
      round: summary.round,
      status: wrong ? "错题复盘" : "已复盘",
      question: `第 ${number} 题`,
      count: 1,
      correct: wrong ? 0 : 1,
      errorType: wrong ? summary.errorType : "",
      errorCount: wrong ? 1 : 0,
      reviewDate: wrong ? summary.reviewDate : "",
      reviewCount: 0,
      note: summary.note,
    });
  });
  return source.size;
}

const taskModal = document.getElementById("task-modal");
const taskModalTitle = document.getElementById("task-modal-title");
const taskModalNote = document.getElementById("task-modal-note");
const taskTitleInput = document.getElementById("task-title");
const taskDateInput = document.getElementById("task-date");
const taskSubjectInput = document.getElementById("task-subject");
const taskMinutesInput = document.getElementById("task-minutes");
const taskPriorityInput = document.getElementById("task-priority");
const taskNoteInput = document.getElementById("task-note");
const TASK_NOTE_DEFAULT = "一行保存一项；保存后每条都能单独修改。";

const progressModal = document.getElementById("progress-modal");
const progressTitle = document.getElementById("progress-title");
const progressSub = document.getElementById("progress-sub");
const progressNoteInput = document.getElementById("progress-note");
const progressModalNote = document.getElementById("progress-modal-note");
const progressDone = document.getElementById("progress-done");
const progressTotal = document.getElementById("progress-total");
const progressAccuracy = document.getElementById("progress-accuracy");
const progressWrong = document.getElementById("progress-wrong");
const progressRoundOptions = document.getElementById("progress-round-options");
const clearProgressButton = document.getElementById("clear-progress");
const PROGRESS_NOTE_DEFAULT = "只影响这一本书这一章；错题请到「录入成绩」里逐题标注。";

const knowledgeModal = document.getElementById("knowledge-modal");
const knowledgeModalTitle = document.getElementById("knowledge-title");
const knowledgeModalNote = document.getElementById("knowledge-modal-note");
const knowledgeDate = document.getElementById("knowledge-date");
const knowledgeSubject = document.getElementById("knowledge-subject");
const knowledgeTopic = document.getElementById("knowledge-topic");
const knowledgeStatus = document.getElementById("knowledge-status");
const knowledgeReview = document.getElementById("knowledge-review");
const knowledgeDetail = document.getElementById("knowledge-detail");
const KNOWLEDGE_NOTE_DEFAULT = "保存后按状态进入待复盘队列；复盘笔记在卡片上一条条追加。";

const reviewLogModal = document.getElementById("review-log-modal");
const reviewLogSub = document.getElementById("review-log-sub");
const reviewLogText = document.getElementById("review-log-text");
const reviewLogNext = document.getElementById("review-log-next");
const reviewLogHistory = document.getElementById("review-log-history");
const reviewLogNote = document.getElementById("review-log-note");
const REVIEW_LOG_NOTE_DEFAULT = "这条笔记会追加到历史里，不会覆盖之前写过的内容。";

function modalNote(element, text, isWarning = false) {
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("warn", Boolean(isWarning));
}

/** select 里没有这个值时补一个，避免历史数据把下拉框悄悄改掉。 */
function setSelectValue(select, value) {
  if (!select || value === undefined || value === null || value === "") return;
  const target = String(value);
  if (![...select.options].some((option) => option.value === target)) {
    select.add(new Option(target, target));
  }
  select.value = target;
  refreshChoiceField(select);
}

/** 多选字段存的是「、」分隔的字符串，回填时逐个点选；下拉框里没有的值补进去。 */
function setMultiSelectValue(select, value) {
  if (!select) return;
  const wanted = String(value || "")
    .split(/[、,，/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const matched = new Set();
  [...select.options].forEach((option) => {
    const label = String(option.textContent || "").trim();
    const hit = wanted.includes(label) || wanted.includes(option.value);
    option.selected = hit;
    if (hit) matched.add(label);
  });
  wanted
    .filter((item) => !matched.has(item))
    .forEach((item) => select.add(new Option(item, item, true, true)));
  refreshChoiceField(select);
}

/** 多选字段往外写的时候统一用「、」连接，保持旧数据的字符串口径。 */
function selectedChoiceValues(select) {
  if (!select) return [];
  return [...select.options]
    .filter((option) => option.selected)
    .map((option) => String(option.textContent || "").trim())
    .filter(Boolean);
}

/* ------------------------------------------- 高密度点击格（热力图式点选） */

/** 原生 select 仍是唯一数据源，点击格只是它的可视化外壳。 */
function choiceGridFor(select, create = true) {
  if (!select) return null;
  const field = select.closest(".field");
  if (!field) return null;
  let grid = field.querySelector(".choice-grid");
  if (!grid && create) {
    grid = document.createElement("div");
    grid.className = "choice-grid";
    select.insertAdjacentElement("afterend", grid);
    select.classList.add("choice-native");
  }
  return grid;
}

function refreshChoiceField(select) {
  if (!select || !select.hasAttribute("data-choice-control")) return;
  const grid = choiceGridFor(select);
  if (!grid) return;
  const multiple = Boolean(select.multiple);
  grid.dataset.choiceFor = select.id;
  grid.setAttribute("role", multiple ? "group" : "radiogroup");
  grid.innerHTML = [...select.options]
    .map((option, index) => {
      const active = option.selected;
      const label = String(option.textContent || option.value || "").trim() || "未填";
      return `<button class="choice-tile${active ? " active" : ""}" type="button" data-choice-for="${escapeAttr(select.id)}" data-choice-index="${index}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(label)}</button>`;
    })
    .join("");
}

function refreshChoiceFields(root = document) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll("[data-choice-control]").forEach(refreshChoiceField);
}

function resetEntryForm() {
  entryDate.value = TODAY_KEY;
  if (entrySubject.options.length) entrySubject.selectedIndex = 0;
  syncEntryOptions();
  [entrySource, entryPaperType, entryModule, entryYear, entryStatus, entryErrorType].forEach((select) => {
    if (select && select.options.length) select.selectedIndex = 0;
  });
  entryQuestion.value = "";
  entryFull.value = "";
  entryScore.value = "";
  entryCount.value = "";
  entryCorrect.value = "";
  entryTime.value = "";
  entryReview.value = "";
  entryNote.value = "";
  entryLost.value = "";
  if (entryRound) entryRound.value = "1";
  if (entryKind) entryKind.value = "";
  modalNote(entryModalNote, ENTRY_NOTE_DEFAULT);
  refreshChoiceFields(entryModal);
  renderWrongGrid([]);
  syncWrongFieldVisibility();
}

function fillEntryForm(record) {
  entryDate.value = record.date || TODAY_KEY;
  entryQuestion.value = record.question || "";
  entryFull.value = record.full ? String(record.full) : "";
  entryScore.value = record.score ? String(record.score) : "";
  entryCount.value = record.count ? String(record.count) : "";
  entryCorrect.value = record.correct ? String(record.correct) : "";
  entryTime.value = record.minutes ? String(record.minutes) : "";
  entryReview.value = record.reviewDate || "";
  entryNote.value = record.note || "";
  if (entryRound) entryRound.value = String(cleanMathRound(record.round));
  modalNote(entryModalNote, ENTRY_NOTE_DEFAULT);
  syncEntryOptions();
  setSelectValue(entrySubject, record.subject);
  syncEntryOptions();
  setSelectValue(entrySource, record.source);
  setSelectValue(entryYear, record.year);
  setSelectValue(entryPaperType, record.paper);
  setSelectValue(entryModule, record.module);
  setSelectValue(entryStatus, record.status);
  setMultiSelectValue(entryErrorType, record.errorType);
  setSelectValue(entryKind, record.kind || "");
  refreshChoiceFields(entryModal);
}

function entryRecordFromForm(existing) {
  return {
    id: existing ? existing.id : "",
    date: entryDate.value || TODAY_KEY,
    subject: entrySubject.value,
    source: entrySource.value,
    year: entryYear.value,
    paper: entryPaperType.value,
    module: entryModule.value,
    status: entryStatus.value,
    question: entryQuestion.value.trim(),
    full: Number(entryFull.value) || 0,
    score: Number(entryScore.value) || 0,
    count: Number(entryCount.value) || 0,
    correct: Number(entryCorrect.value) || 0,
    minutes: Number(entryTime.value) || 0,
    errorType: selectedChoiceValues(entryErrorType).join("、"),
    reviewDate: entryReview.value,
    kind: entrySubject.value.startsWith("英语") && entryKind ? entryKind.value : "",
    round: cleanMathRound(entryRound ? entryRound.value : existing?.round),
    reviewCount: existing ? existing.reviewCount : 0,
    note: entryNote.value.trim(),
  };
}

/** 打开录入弹窗：新建时清空成空白表单，编辑已有记录时按 id 回填。 */
function openEntry(mode = "create", description = "", record = null) {
  state.recordEditId = record ? record.id : "";
  setEntryMode(record || mode === "edit" ? "edit" : "create", description);
  if (record) {
    fillEntryForm(record);
  } else if (mode !== "edit") {
    resetEntryForm();
  }
  syncEntryOptions();
  renderWrongGrid(record ? entryDetailMarksOf(record.id) : []);
  syncWrongFieldVisibility();
  updateLostScore();
  document.body.classList.add("entry-open");
  if (entryDate) entryDate.focus();
}

function closeEntry() {
  document.body.classList.remove("entry-open");
  state.recordEditId = "";
  modalNote(entryModalNote, ENTRY_NOTE_DEFAULT);
}

function saveEntry() {
  if (!STORE) return false;
  const existing = state.recordEditId ? STORE.getRecord(state.recordEditId) : null;
  const marks = selectedEntryMarks();
  const markCounts = entryMarkCounts(marks);
  const record = entryRecordFromForm(existing);
  // 逐题标记就是本次学习题数；一刷 / 二刷只留在 round 里，不参与题数。
  if (marks.size) {
    record.count = markCounts.total;
    record.correct = markCounts.correct;
  }
  if (!record.full && !record.score && !record.count && !record.correct) {
    modalNote(entryModalNote, "至少填一项：满分 / 得分，或者本次题数 / 做对题数。", true);
    return false;
  }
  if (record.count && record.correct > record.count) {
    modalNote(entryModalNote, "做对题数不能大于本次题数。", true);
    return false;
  }
  if (record.full && record.score > record.full) {
    modalNote(entryModalNote, "得分不能大于满分。", true);
    return false;
  }
  const saved = STORE.upsertRecord(record);
  syncEntryDetails(saved, marks);
  closeEntry();
  setEntryMode("create");
  render();
  return true;
}

/* ------------------------------------------- 计划与章节进度弹窗 */

/** 一行一项；兼容从聊天或清单里粘进来的项目符号和编号。 */
function taskTitlesFromInput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.、)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((line) => line.slice(0, 200));
}

function openTaskModal(date = TODAY_KEY, id = "") {
  if (!STORE) return;
  const task = id ? STORE.getTask(id) : null;
  state.taskEditId = task ? task.id : "";
  taskModalTitle.textContent = task ? "修改任务" : "新建任务";
  taskTitleInput.value = task ? task.title : "";
  taskDateInput.value = task && task.date ? task.date : date || TODAY_KEY;
  setMultiSelectValue(taskSubjectInput, task && task.subject ? task.subject : "数学一");
  taskMinutesInput.value = task && task.minutes ? String(task.minutes) : "";
  taskPriorityInput.value = task && task.priority ? task.priority : "中";
  taskNoteInput.value = task ? task.note : "";
  refreshChoiceFields(taskModal);
  modalNote(
    taskModalNote,
    task ? "改完立刻生效；粘贴多行会新增其余任务。" : TASK_NOTE_DEFAULT,
  );
  document.body.classList.add("task-open");
  taskTitleInput.focus();
}

function closeTaskModal() {
  document.body.classList.remove("task-open");
  state.taskEditId = "";
  modalNote(taskModalNote, TASK_NOTE_DEFAULT);
}

function saveTask() {
  if (!STORE) return;
  const titles = taskTitlesFromInput(taskTitleInput.value);
  if (!titles.length) {
    modalNote(taskModalNote, "任务内容不能为空。", true);
    taskTitleInput.focus();
    return;
  }
  const basePayload = {
    date: taskDateInput.value || TODAY_KEY,
    subject: selectedChoiceValues(taskSubjectInput).join("、"),
    minutes: Number(taskMinutesInput.value) || 0,
    priority: taskPriorityInput.value,
    note: taskNoteInput.value.trim(),
  };
  if (state.taskEditId) {
    STORE.updateTask(state.taskEditId, { ...basePayload, title: titles[0] });
    titles.slice(1).forEach((title) => STORE.addTask({ ...basePayload, title }));
  } else {
    titles.forEach((title) => STORE.addTask({ ...basePayload, title }));
  }
  closeTaskModal();
  render();
}

function syncProgressRoundButtons(round) {
  if (!progressRoundOptions) return;
  const normalized = cleanMathRound(round);
  progressRoundOptions.querySelectorAll("[data-progress-round]").forEach((button) => {
    const active = cleanMathRound(button.dataset.progressRound) === normalized;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

/** 按 target.round 重新读取这一本书、这一章、这一轮的进度并回填弹窗。 */
function fillProgressForm(target) {
  if (!target) return;
  const book = YM_BY_KEY[target.book];
  const sections = book && Array.isArray(book.sections) ? book.sections : [];
  const section = sections.find((item) => item.name === target.section);
  if (!book || !section) return;
  const info = mathChapterInfo(book, section, target.chapter, target.round);
  const meta = mathRoundMeta(info.round);
  target.round = info.round;
  progressTitle.textContent = `${book.tab} · ${target.chapter}`;
  progressSub.textContent = `${book.title} · ${section.name} · ${meta.label}独立记录，不和其它轮次或其它资料共用进度。`;
  progressDone.value = info.done ? String(info.done) : "";
  progressTotal.value = info.total ? String(info.total) : "";
  progressAccuracy.value = info.accuracy ? String(info.accuracy) : "";
  progressWrong.value = info.wrong ? String(info.wrong) : "";
  progressNoteInput.value = info.saved ? info.saved.note || "" : "";
  clearProgressButton.disabled = !info.saved;
  syncProgressRoundButtons(info.round);
}

function openProgressModal(book, section, chapter, round = mathBookRound(book.key)) {
  state.progressChapter = { book: book.key, section: section.name, chapter, round: cleanMathRound(round) };
  fillProgressForm(state.progressChapter);
  modalNote(progressModalNote, PROGRESS_NOTE_DEFAULT);
  document.body.classList.add("progress-open");
  progressDone.focus();
}

function closeProgressModal() {
  document.body.classList.remove("progress-open");
  state.progressChapter = null;
  modalNote(progressModalNote, PROGRESS_NOTE_DEFAULT);
}

function saveProgress() {
  const target = state.progressChapter;
  if (!target || !STORE) return;
  const round = cleanMathRound(target.round);
  let done = Math.max(0, Number(progressDone.value) || 0);
  const total = Math.max(0, Number(progressTotal.value) || 0);
  if (total && done > total) done = total;
  STORE.setProgress(mathProgressKey(target.book, target.section, target.chapter, round), {
    done,
    total,
    accuracy: Math.max(0, Math.min(100, Number(progressAccuracy.value) || 0)),
    wrong: Math.max(0, Number(progressWrong.value) || 0),
    note: progressNoteInput.value.trim(),
  });
  // 保存哪一轮就把这本书切到哪一轮，回到页面能直接看到刚录入的数据。
  STORE.setBookRound(mathBookRoundKey(target.book), round);
  closeProgressModal();
  render();
}

function clearProgress() {
  const target = state.progressChapter;
  if (!target || !STORE) return;
  const round = cleanMathRound(target.round);
  const meta = mathRoundMeta(round);
  if (!window.confirm(`清除「${target.chapter}」${meta.label}的进度记录？其它轮次、章节和分册不受影响。`)) return;
  const keys = [mathProgressKey(target.book, target.section, target.chapter, round)];
  // v1 旧数据没有轮次字段，按一刷读取；清一刷时把旧键一起清掉，避免清完又冒出来。
  if (round === 1) keys.push(legacyMathProgressKey(target.book, target.section, target.chapter));
  STORE.removeProgressKeys(keys);
  closeProgressModal();
  render();
}

/* -------------------------------------------- 待复盘：知识点弹窗与复盘记录 */

function openKnowledgeModal(id = "") {
  if (!STORE) return;
  const item = id ? STORE.getKnowledge(id) : null;
  state.knowledgeEditId = item ? item.id : "";
  knowledgeModalTitle.textContent = item ? "编辑知识点" : "新增知识点";
  knowledgeDate.value = item ? item.date || TODAY_KEY : TODAY_KEY;
  setSelectValue(knowledgeSubject, item && item.subject ? item.subject : "数学一");
  knowledgeTopic.value = item ? item.topic : "";
  setSelectValue(knowledgeStatus, item && item.status ? item.status : "待复盘");
  knowledgeReview.value = item ? item.reviewDate || "" : "";
  knowledgeDetail.value = item ? item.detail : "";
  modalNote(knowledgeModalNote, item ? "改完保存，状态和下次复盘时间立刻更新。" : KNOWLEDGE_NOTE_DEFAULT);
  refreshChoiceFields(knowledgeModal);
  document.body.classList.add("knowledge-open");
  knowledgeTopic.focus();
}

function closeKnowledgeModal() {
  document.body.classList.remove("knowledge-open");
  state.knowledgeEditId = "";
  modalNote(knowledgeModalNote, KNOWLEDGE_NOTE_DEFAULT);
}

function saveKnowledge() {
  if (!STORE) return;
  const topic = knowledgeTopic.value.trim();
  if (!topic) {
    modalNote(knowledgeModalNote, "知识点不能为空。", true);
    knowledgeTopic.focus();
    return;
  }
  const payload = {
    date: knowledgeDate.value || TODAY_KEY,
    subject: knowledgeSubject.value,
    topic,
    detail: knowledgeDetail.value.trim(),
    reviewDate: knowledgeReview.value,
    status: knowledgeStatus.value,
  };
  if (state.knowledgeEditId) {
    STORE.updateKnowledge(state.knowledgeEditId, payload);
  } else {
    STORE.addKnowledge(payload);
  }
  closeKnowledgeModal();
  render();
}

function reviewHistoryHTML(item, { full = false } = {}) {
  const logs = [...(item.logs || [])].reverse();
  if (!logs.length) {
    return `<div class="knowledge-empty-log">还没有复盘记录，第一条会出现在这里。</div>`;
  }
  const visible = full ? logs : logs.slice(0, 3);
  return `
    <ol class="knowledge-logs${full ? " full" : ""}">
      ${visible
        .map(
          (log) => `
            <li>
              <time>${escapeHtml(String(log.at || "").slice(0, 10))}</time>
              <p>${escapeHtml(log.text)}</p>
            </li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function openReviewLogModal(id) {
  if (!STORE) return;
  const item = STORE.getKnowledge(id);
  if (!item) return;
  state.reviewLogId = item.id;
  reviewLogSub.textContent = `${item.subject || "未填科目"} · ${item.topic || "未填知识点"} · 已复盘 ${item.reviewCount} 次`;
  reviewLogText.value = "";
  reviewLogNext.value = "";
  reviewLogHistory.innerHTML = reviewHistoryHTML(item, { full: true });
  // 留空＝这次复盘收尾；要重排期就在下面填新日期，旧日期只作提示。
  modalNote(
    reviewLogNote,
    item.reviewDate
      ? `留空表示这条复盘收尾、不再挂在待复盘队列；现在排的下次是 ${item.reviewDate}，要重排就填新日期。`
      : REVIEW_LOG_NOTE_DEFAULT,
  );
  document.body.classList.add("review-log-open");
  reviewLogText.focus();
}

function closeReviewLogModal() {
  document.body.classList.remove("review-log-open");
  state.reviewLogId = "";
  reviewLogText.value = "";
  modalNote(reviewLogNote, REVIEW_LOG_NOTE_DEFAULT);
}

function saveReviewLog() {
  if (!STORE || !state.reviewLogId) return;
  const text = reviewLogText.value.trim();
  if (!text) {
    modalNote(reviewLogNote, "这次复盘写了什么？至少写一句。", true);
    reviewLogText.focus();
    return;
  }
  const updated = STORE.appendKnowledgeLog(state.reviewLogId, text);
  if (!updated) {
    modalNote(reviewLogNote, "这条知识点已经不在了。", true);
    return;
  }
  // 填了下次时间就重新排队；下次到期时它会再回到「今天待复盘」。
  if (reviewLogNext.value) {
    STORE.updateKnowledge(updated.id, { reviewDate: reviewLogNext.value, status: "待复盘" });
  } else if (updated.reviewDate) {
    // 没填新日期＝收尾：顺手清掉旧的排期，卡片不再显示逾期。
    STORE.updateKnowledge(updated.id, { reviewDate: "" });
  }
  closeReviewLogModal();
  render();
}

/** 表内备注：失焦或回车直接写回记录，不弹窗。 */
function saveInlineNote(input) {
  if (!STORE || !input) return;
  const record = STORE.getRecord(input.dataset.noteRecord);
  if (!record) return;
  const value = input.value.trim().slice(0, 2000);
  if (value === (record.note || "")) return;
  STORE.upsertRecord({ id: record.id, note: value });
  input.classList.add("note-saved");
  window.setTimeout(() => input.classList.remove("note-saved"), 1200);
}

/* ------------------------------------------------- 导出 / 导入 / 初始化 */

function exportData() {
  if (!STORE) return;
  const blob = new Blob([STORE.exportJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `xxrj-backup-${TODAY_KEY}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importData() {
  const input = document.getElementById("import-json-file");
  if (input) input.click();
}

function resetData() {
  if (!STORE) return;
  if (!window.confirm("初始化全部数据？计划、成绩记录、章节进度、知识点与复盘历史都会清空，且不能撤销。")) return;
  if (!window.confirm("再确认一次：清空当前 iball 账号下的 XXRJ 数据？")) return;
  STORE.reset();
  state.mathSection = 0;
  render();
}

async function readImportFile(file) {
  if (!file || !STORE) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!window.confirm("导入备份会覆盖当前账号的计划、成绩、章节进度和知识点记录，继续吗？")) return;
    STORE.replace(parsed);
    render();
  } catch {
    window.alert("这个文件不是有效的 XXRJ 备份 JSON。");
  }
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
  const choiceTile = event.target.closest("[data-choice-for][data-choice-index]");
  if (choiceTile) {
    const select = document.getElementById(choiceTile.dataset.choiceFor);
    const option = select ? select.options[Number(choiceTile.dataset.choiceIndex)] : null;
    if (select && option) {
      if (select.multiple) option.selected = !option.selected;
      else select.selectedIndex = option.index;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      refreshChoiceFields(select.closest(".form-grid") || document);
    }
    return;
  }

  const markModeButton = event.target.closest("#entry-mark-modes [data-entry-mark]");
  if (markModeButton) {
    setEntryMarkMode(markModeButton.dataset.entryMark);
    return;
  }

  const questionCell = event.target.closest("#entry-wrong-grid .question-cell");
  if (questionCell) {
    toggleQuestionMark(questionCell);
    return;
  }

  const clearWrongButton = event.target.closest("#clear-entry-wrong");
  if (clearWrongButton) {
    renderWrongGrid([]);
    return;
  }

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

  const entrySubjectButton = event.target.closest("[data-open-entry-subject]");
  if (entrySubjectButton) {
    openEntry("create");
    setSelectValue(entrySubject, entrySubjectButton.dataset.openEntrySubject);
    syncEntryOptions();
    setSelectValue(entrySource, entrySubjectButton.dataset.entrySource);
    if (entryRound) {
      const selectedBook = YM_BY_KEY[state.mathResource] || null;
      const fallbackRound = selectedBook && String(entrySubjectButton.dataset.openEntrySubject || "").startsWith("数学")
        ? mathBookRound(selectedBook.key)
        : 1;
      entryRound.value = String(cleanMathRound(entrySubjectButton.dataset.entryRound || fallbackRound));
    }
    return;
  }

  const recordEditButton = event.target.closest("[data-record-edit]");
  if (recordEditButton && STORE) {
    const record = STORE.getRecord(recordEditButton.dataset.recordEdit);
    if (record) openEntry("edit", `${record.subject} · ${record.source}`, record);
    return;
  }

  const recordRemoveButton = event.target.closest("[data-record-remove]");
  if (recordRemoveButton && STORE) {
    if (window.confirm("删除这条成绩记录？删掉后这本书的汇总会跟着更新。")) {
      STORE.removeRecord(recordRemoveButton.dataset.recordRemove);
      render();
    }
    return;
  }

  const mathGroupButton = event.target.closest("[data-math-group]");
  if (mathGroupButton) {
    const nextBook = YM_BOOKS.find((book) => book.group === mathGroupButton.dataset.mathGroup);
    if (nextBook) {
      state.mathResource = nextBook.key;
      state.mathSection = 0;
      history.replaceState(null, "", `?screen=math&math=${state.mathResource}`);
      render();
    }
    return;
  }

  const mathRoundButton = event.target.closest("[data-math-round]");
  if (mathRoundButton) {
    const book = mathBook();
    if (book && STORE) {
      STORE.setBookRound(mathBookRoundKey(book.key), mathRoundButton.dataset.mathRound);
      render();
    }
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

  const mathChapterButton = event.target.closest("[data-math-chapter]");
  if (mathChapterButton) {
    const book = mathBook();
    if (book) {
      const sections = Array.isArray(book.sections) ? book.sections : [];
      const section = sections[clampIndex(state.mathSection, sections.length)];
      const chapters = section && Array.isArray(section.chapters) ? section.chapters : [];
      const chapterIndex = Number(mathChapterButton.dataset.mathChapter);
      if (section && chapters[chapterIndex]) {
        openProgressModal(book, section, chapters[chapterIndex], mathBookRound(book.key));
      }
    }
    return;
  }

  const progressRoundButton = event.target.closest("[data-progress-round]");
  if (progressRoundButton && state.progressChapter) {
    state.progressChapter.round = cleanMathRound(progressRoundButton.dataset.progressRound);
    fillProgressForm(state.progressChapter);
    return;
  }

  const taskNewButton = event.target.closest("[data-task-new]");
  if (taskNewButton) {
    openTaskModal(taskNewButton.dataset.taskNew || TODAY_KEY);
    return;
  }

  const taskEditButton = event.target.closest("[data-task-edit]");
  if (taskEditButton) {
    openTaskModal(TODAY_KEY, taskEditButton.dataset.taskEdit);
    return;
  }

  const taskRemoveButton = event.target.closest("[data-task-remove]");
  if (taskRemoveButton && STORE) {
    const task = STORE.getTask(taskRemoveButton.dataset.taskRemove);
    if (task && window.confirm(`删除计划「${task.title}」？`)) {
      STORE.removeTask(task.id);
      render();
    }
    return;
  }

  const taskToggleButton = event.target.closest("[data-task-toggle]");
  if (taskToggleButton && STORE) {
    const task = STORE.getTask(taskToggleButton.dataset.taskToggle);
    if (task) {
      STORE.updateTask(task.id, { done: !task.done });
      render();
    }
    return;
  }

  const saveProfileButton = event.target.closest("[data-save-profile]");
  if (saveProfileButton && STORE) {
    const value = (id) => {
      const field = document.getElementById(id);
      return field ? field.value : "";
    };
    const number = (id, fallback) => {
      const parsed = Number(value(id));
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    };
    const current = STORE.profile();
    STORE.updateProfile({
      examDate: value("goal-exam-date") || current.examDate,
      school: value("goal-school").trim(),
      major: value("goal-major").trim(),
      showPolitics: Boolean(document.getElementById("goal-show-politics")?.checked),
      target: {
        math: number("goal-math", current.target.math),
        english: number("goal-english", current.target.english),
        cs408: number("goal-cs408", current.target.cs408),
        politics: number("goal-politics", current.target.politics),
      },
    });
    render();
    return;
  }

  const exportButton = event.target.closest("[data-export-json]");
  if (exportButton) {
    exportData();
    return;
  }

  const importButton = event.target.closest("[data-import-json]");
  if (importButton) {
    importData();
    return;
  }

  const resetButton = event.target.closest("[data-reset-data]");
  if (resetButton) {
    resetData();
    return;
  }

  const reviewOpen = event.target.closest("[data-review-open]");
  if (reviewOpen) {
    openReviewPanel(reviewOpen.dataset.reviewOpen);
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
    const panelRow = analysisNote.closest("[data-analysis-panel]");
    const id = panelRow ? panelRow.dataset.analysisPanel : "";
    const record = STORE && id ? STORE.getRecord(id) : null;
    if (record) {
      const merged = record.note ? `${record.note}\n${analysisNoteSummary(record)}` : analysisNoteSummary(record);
      STORE.upsertRecord({ id, note: merged.slice(0, 2000) });
    }
    return;
  }

  const analysisReview = event.target.closest("[data-analysis-review]");
  if (analysisReview) {
    const panelRow = analysisReview.closest("[data-analysis-panel]");
    const id = panelRow ? panelRow.dataset.analysisPanel : "";
    const record = STORE && id ? STORE.getRecord(id) : null;
    if (record) {
      STORE.upsertRecord({
        id,
        reviewDate: TODAY_KEY,
        status: record.status === "已消灭" ? "错题复盘" : record.status,
      });
    }
    return;
  }

  const annotateType = event.target.closest("[data-annotate-type]");
  if (annotateType) {
    annotateType.classList.toggle("active");
    return;
  }

  const cs408ExplainOpen = event.target.closest("[data-cs408-explain]");
  if (cs408ExplainOpen) {
    toggleCs408Explain(cs408ExplainOpen);
    return;
  }

  const cs408ExplainClose = event.target.closest("[data-cs408-close]");
  if (cs408ExplainClose) {
    const panelRow = cs408ExplainClose.closest("[data-cs408-panel]");
    const id = panelRow ? panelRow.dataset.cs408Panel : "";
    if (panelRow) panelRow.remove();
    if (id) {
      const sourceButton = document.querySelector(`[data-cs408-explain="${id}"]`);
      if (sourceButton) sourceButton.setAttribute("aria-expanded", "false");
    }
    return;
  }

  const cs408Template = event.target.closest("[data-cs408-template]");
  if (cs408Template) {
    const panelRow = cs408Template.closest("[data-cs408-panel]");
    const id = panelRow ? panelRow.dataset.cs408Panel : "";
    const record = STORE && id ? STORE.getRecord(id) : null;
    const textarea = panelRow ? panelRow.querySelector("[data-cs408-text]") : null;
    if (record && textarea) {
      textarea.value = cs408ExplainDraft(record);
      textarea.focus();
    }
    return;
  }

  const cs408Save = event.target.closest("[data-cs408-save]");
  if (cs408Save) {
    saveCs408Explain(cs408Save);
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
    syncReviewNextHint(annotateNext.closest(".annotate-panel"));
    return;
  }

  const countDelta = event.target.closest("[data-count-delta]");
  if (countDelta) {
    const stepper = countDelta.closest(".count-stepper");
    const input = stepper ? stepper.querySelector("input[type='number']") : null;
    if (input) {
      const delta = Number(countDelta.dataset.countDelta) || 0;
      input.value = Math.max(0, (Number(input.value) || 0) + delta);
      if (input.hasAttribute("data-ann-review-count")) syncReviewNextFromRound(countDelta.closest(".annotate-panel"));
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

  const knowledgeNewButton = event.target.closest("[data-knowledge-new]");
  if (knowledgeNewButton) {
    openKnowledgeModal();
    return;
  }

  const knowledgeEditButton = event.target.closest("[data-knowledge-edit]");
  if (knowledgeEditButton) {
    openKnowledgeModal(knowledgeEditButton.dataset.knowledgeEdit);
    return;
  }

  const knowledgeLogButton = event.target.closest("[data-knowledge-log]");
  if (knowledgeLogButton) {
    openReviewLogModal(knowledgeLogButton.dataset.knowledgeLog);
    return;
  }

  const knowledgeRemoveButton = event.target.closest("[data-knowledge-remove]");
  if (knowledgeRemoveButton && STORE) {
    const item = STORE.getKnowledge(knowledgeRemoveButton.dataset.knowledgeRemove);
    if (item && window.confirm(`删除知识点「${item.topic || "未填"}」？复盘历史会一起删掉。`)) {
      STORE.removeKnowledge(item.id);
      render();
    }
    return;
  }

  const knowledgeSnoozeButton = event.target.closest("[data-knowledge-snooze]");
  if (knowledgeSnoozeButton && STORE) {
    const item = STORE.getKnowledge(knowledgeSnoozeButton.dataset.knowledgeSnooze);
    const days = Number(knowledgeSnoozeButton.dataset.days) || 1;
    if (item) {
      STORE.updateKnowledge(item.id, {
        reviewDate: dateKey(shiftDate(days)),
        status: item.status === "已掌握" ? "已掌握" : "待复盘",
      });
      render();
    }
    return;
  }

  const reviewFilterButton = event.target.closest("[data-review-filter]");
  if (reviewFilterButton) {
    state.reviewFilter = reviewFilterButton.dataset.reviewFilter || "all";
    render();
    return;
  }

  const modeButton = event.target.closest("[data-entry-mode]");
  if (modeButton) {
    setEntryMode(modeButton.dataset.entryMode);
  }
});

document.getElementById("close-entry").addEventListener("click", closeEntry);
document.getElementById("cancel-entry").addEventListener("click", closeEntry);
document.getElementById("cancel-edit").addEventListener("click", () => {
  state.recordEditId = "";
  setEntryMode("create");
  resetEntryForm();
});
document.getElementById("save-entry").addEventListener("click", saveEntry);
entrySubject.addEventListener("change", syncEntryOptions);
entryStatus.addEventListener("change", syncWrongFieldVisibility);
entryRound?.addEventListener("change", syncWrongGridState);
entryFull.addEventListener("input", updateLostScore);
entryScore.addEventListener("input", updateLostScore);
entryModal.addEventListener("click", (event) => {
  if (event.target === entryModal) closeEntry();
});

document.getElementById("close-task").addEventListener("click", closeTaskModal);
document.getElementById("cancel-task").addEventListener("click", closeTaskModal);
document.getElementById("save-task").addEventListener("click", saveTask);
taskModal.addEventListener("click", (event) => {
  if (event.target === taskModal) closeTaskModal();
});
taskTitleInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveTask();
});

document.getElementById("close-progress").addEventListener("click", closeProgressModal);
document.getElementById("cancel-progress").addEventListener("click", closeProgressModal);
document.getElementById("save-progress").addEventListener("click", saveProgress);
clearProgressButton.addEventListener("click", clearProgress);
progressModal.addEventListener("click", (event) => {
  if (event.target === progressModal) closeProgressModal();
});

document.getElementById("close-knowledge").addEventListener("click", closeKnowledgeModal);
document.getElementById("cancel-knowledge").addEventListener("click", closeKnowledgeModal);
document.getElementById("save-knowledge").addEventListener("click", saveKnowledge);
knowledgeModal.addEventListener("click", (event) => {
  if (event.target === knowledgeModal) closeKnowledgeModal();
});
knowledgeTopic.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveKnowledge();
});

document.getElementById("close-review-log").addEventListener("click", closeReviewLogModal);
document.getElementById("cancel-review-log").addEventListener("click", closeReviewLogModal);
document.getElementById("save-review-log").addEventListener("click", saveReviewLog);
reviewLogModal.addEventListener("click", (event) => {
  if (event.target === reviewLogModal) closeReviewLogModal();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target && target.id === "import-json-file") {
    const file = target.files && target.files[0];
    target.value = "";
    readImportFile(file);
  }
  if (target && target.hasAttribute && target.hasAttribute("data-knowledge-status") && STORE) {
    const nextStatus = target.value;
    const item = STORE.updateKnowledge(target.dataset.knowledgeStatus, {
      status: nextStatus,
      ...(nextStatus === "已掌握" ? { reviewDate: "" } : {}),
    });
    if (item) render();
  }
});

/** 表内备注失焦即保存，不需要再点保存按钮。 */
document.addEventListener("focusout", (event) => {
  const input = event.target;
  if (input && input.matches && input.matches("[data-note-record]")) saveInlineNote(input);
});

/** 复盘编号输入框：手打数字也同步「下次复盘」的间隔和日期。 */
document.addEventListener("input", (event) => {
  const input = event.target;
  if (input && input.hasAttribute && input.hasAttribute("data-ann-review-count")) {
    syncReviewNextFromRound(input.closest(".annotate-panel"));
  }
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (event.key === "Enter" && target && target.matches && target.matches("[data-note-record]")) {
    event.preventDefault();
    saveInlineNote(target);
    target.blur();
    return;
  }
  if (event.key !== "Escape") return;
  closeProgressModal();
  closeTaskModal();
  closeKnowledgeModal();
  closeReviewLogModal();
  closeEntry();
});

setEntryMode(state.entryMode);
syncEntryOptions();
updateLostScore();
refreshChoiceFields();

/* ------------------------------------------- 账号：只绑定 iball 账号 */

const NAMESPACE_RELOAD_FLAG = "iball:namespace-reload";
const PRE_ACTIVATION_NAMESPACE = window.iballAccounts?.namespace() || "";
let ACCOUNT_SESSION = null;

function setSyncLine(text, online) {
  const node = document.getElementById("sync-status");
  if (node && text) node.textContent = text;
  const dot = document.querySelector(".sync-dot");
  if (dot) dot.classList.toggle("online", Boolean(online));
}

/** 切换本地命名空间并接入云端同步；和主站 app.js 用的是同一套逻辑。 */
async function activateAccount(account) {
  if (!window.iballAccounts || !window.iballProgress) return false;
  window.iballAccounts.activate(account?.id || "");

  if (window.iballAccounts.namespace() !== PRE_ACTIVATION_NAMESPACE) {
    let alreadyReloaded = false;
    try {
      alreadyReloaded = sessionStorage.getItem(NAMESPACE_RELOAD_FLAG) === "1";
      if (!alreadyReloaded) sessionStorage.setItem(NAMESPACE_RELOAD_FLAG, "1");
    } catch {
      alreadyReloaded = true;
    }
    if (!alreadyReloaded) {
      window.location.reload();
      return true;
    }
  }

  try {
    sessionStorage.removeItem(NAMESPACE_RELOAD_FLAG);
  } catch {
    // 隐私模式下没有 sessionStorage，忽略即可。
  }

  await window.iballProgress.enableSync();
  window.iballProgress.startHeartbeat();
  return false;
}

/** 同步状态变化时刷新侧栏那行字，不改动其它界面。 */
function watchSyncStatus() {
  if (!window.iballProgress?.onStatus) return;
  window.iballProgress.onStatus((status) => {
    if (!status || !status.enabled || status.state === "off") return;
    if (status.state === "syncing" || status.state === "pending") {
      setSyncLine(`正在同步${status.pending ? ` · ${status.pending} 项待传` : ""}`, true);
      return;
    }
    if (status.state === "error") {
      setSyncLine("同步暂时失败 · 数据已存在本机", false);
      return;
    }
    setSyncLine("已绑定 iball 账号 · 已同步", true);
  });
}

/** 有账号服务、能真正写盘的正式入口。 */
const MAIN_SITE_URL = "https://app.iball.top";

/**
 * 只读镜像判定：接口在，但服务器没有可写账号目录（典型是 Vercel 那份部署）。
 * 这种站点登录不进账号库、同步也写不进去，必须如实说"只存本机"，
 * 否则页面会一直提示去登录，登录完回来还是未登录。
 */
function isReadOnlyMirror() {
  return Boolean(
    ACCOUNT_SESSION &&
      ACCOUNT_SESSION.mode === "server" &&
      ACCOUNT_SESSION.registration &&
      ACCOUNT_SESSION.registration.storageReady === false,
  );
}

function paintAccountChrome() {
  const session = ACCOUNT_SESSION;
  const serverMode = Boolean(session && session.mode === "server");
  const online = Boolean(serverMode && session.authenticated);
  const mirror = isReadOnlyMirror();
  const localMode = !serverMode;
  const nameNode = document.getElementById("account-name");
  const planNode = document.getElementById("account-plan");
  const banner = document.getElementById("account-banner");
  const bannerText = document.getElementById("account-banner-text");
  const bannerAction = document.getElementById("account-banner-action");
  const syncNote = document.getElementById("data-sync-note");

  if (online && !mirror) {
    const who = session.user || "iball 账号";
    if (nameNode) nameNode.textContent = who;
    if (planNode) planNode.textContent = "已绑定 iball 账号 · 数据跟着账号走";
    setSyncLine("已绑定 iball 账号", true);
    if (banner) banner.hidden = true;
    if (syncNote) {
      syncNote.innerHTML = `${icon("cloud-check")} 当前状态：已登录 ${escapeHtml(who)}，计划、成绩、章节进度按账号同步。`;
    }
  } else if (online && mirror) {
    // 身份是真的，但这台服务器没有可写的账号目录：云端同步用不了，
    // 数据只在本机，所以不再提示去登录。
    const who = session.user || "iball 账号";
    if (nameNode) nameNode.textContent = who;
    if (planNode) planNode.textContent = "已绑定 iball 账号 · 本机记录";
    setSyncLine("本机记录 · 云端同步不可用", false);
    if (banner) banner.hidden = true;
    if (syncNote) {
      syncNote.innerHTML = `${icon("triangle-alert")} 当前状态：已登录 ${escapeHtml(who)}，但这台服务器没有可写的账号目录，计划与成绩只保存在本机。需要跨设备同步时到主站 ${MAIN_SITE_URL} 用同一个账号登录使用。`;
    }
  } else if (mirror) {
    // 未登录的只读镜像：登录也写不进账号库，直接把用户引到可写的主站。
    if (nameNode) nameNode.textContent = "本机模式";
    if (planNode) planNode.textContent = "只读镜像 · 云端同步不可用";
    setSyncLine("本机模式 · 数据只在这台设备", false);
    if (banner) banner.hidden = false;
    if (bannerText) {
      bannerText.textContent =
        "当前访问的是只读镜像：计划、成绩只保存在这台设备。需要跨设备同步请到主站登录。";
    }
    if (bannerAction) {
      bannerAction.textContent = "去主站登录";
      // 带上 next：主站登录页认这个参数，登录成功后会直接跳回 /xxrj/，
      // 不会再停在小屋首页让用户自己找回来。
      bannerAction.href = `${MAIN_SITE_URL}/index.html?next=/xxrj/`;
    }
    if (syncNote) {
      syncNote.innerHTML = `${icon("triangle-alert")} 当前状态：只读镜像，数据只在本机；需要账号同步请到主站 ${MAIN_SITE_URL}。`;
    }
  } else {
    if (nameNode) nameNode.textContent = "未绑定 iball 账号";
    if (planNode) planNode.textContent = "只和 iball 账号绑定 · 不接第三方登录";
    setSyncLine(localMode ? "本地模式 · 数据只在这台设备" : "未登录 · 数据先存在本机", false);
    if (banner) banner.hidden = false;
    if (bannerText) {
      bannerText.textContent = localMode
        ? "当前是本地模式：登录 iball 账号后，XXRJ 的计划、成绩和章节进度会跟着账号同步。"
        : "还没有登录 iball 账号：现在录入的数据先存在这台设备，登录后自动同步到账号里。";
    }
    if (bannerAction) {
      bannerAction.textContent = "绑定 iball 账号";
      bannerAction.href = "/index.html?next=/xxrj/";
    }
    if (syncNote) {
      syncNote.innerHTML = `${icon("triangle-alert")} 当前状态：未绑定 iball 账号，数据只在本机；登录同一个 iball 账号后自动同步。`;
    }
  }
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

async function initAccount() {
  let session = null;
  try {
    session = window.iballSession ? await window.iballSession.probe() : null;
  } catch {
    session = null;
  }

  ACCOUNT_SESSION = session;
  const mirror = isReadOnlyMirror();
  const authenticated = Boolean(
    session && session.mode === "server" && session.authenticated,
  );

  if (authenticated && !mirror) {
    const reloading = await activateAccount(session.account);
    if (reloading) return;
  } else {
    // 只读镜像上账号库写不进去，切命名空间没有意义：数据继续留在本机，
    // 同时关掉云端同步，免得每改一条都报一次同步失败。
    await activateAccount(null);
    if (mirror) {
      window.iballProgress?.disableSync(
        "只读镜像：这台服务器没有可写的账号目录。",
      );
    }
  }

  paintAccountChrome();
  watchSyncStatus();
  if (STORE) {
    // 全量同步会把云端合并结果写回本地存储，这里重新读一次再渲染。
    STORE.reload();
    render();
  }
}

if (STORE) {
  STORE.subscribe(() => {
    const modalOpen =
      document.body.classList.contains("entry-open") ||
      document.body.classList.contains("task-open") ||
      document.body.classList.contains("progress-open");
    if (!modalOpen) render();
  });
}

if (new URLSearchParams(location.search).get("entry") === "1") {
  const record = new URLSearchParams(location.search).get("record") || "";
  openEntry(state.entryMode, record);
}

render();
loadLlycDeckMeta();
initAccount();
