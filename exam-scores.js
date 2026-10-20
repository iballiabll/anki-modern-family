/**
 * exam-scores.js — 四六级 / 考研的作答记录与得分统计。
 *
 * 设计原则：
 *  1. 只做客观计数，不发明官方分值：没有官方分值的板块只报作答数、正确数与正确率；
 *  2. 沿用各模块原有的答案键，本文件另存一份归一化记录用于统计，不改动旧数据；
 *  3. 存储写在 localStorage，account-store.js 会按账号同步，换设备可继续。
 *
 * 调用示例：
 *   window.ExamScores.recordObjective({
 *     exam: "cet4", paperId: "cet4-2024-06-1", paperLabel: "2024 年 6 月第 1 套",
 *     sectionId: "news-1", sectionLabel: "新闻 1",
 *     questionNo: 3, chosen: "B", answer: "C", answerStatus: "verified",
 *   });
 *   window.ExamScores.render(); // 或由本文件自动刷新
 */
(function () {
  "use strict";

  const STORAGE_KEY = "iball-exam-scores-v1";
  const EXAM_ORDER = ["cet4", "cet6", "kaoyan"];
  const EXAM_LABELS = { cet4: "四级", cet6: "六级", kaoyan: "考研" };
  const EXAM_ALIASES = {
    cet4: "cet4",
    cetfou: "cet4",
    "cet-4": "cet4",
    cet6: "cet6",
    "cet-6": "cet6",
    kaoyan: "kaoyan",
    "english-i": "kaoyan",
    "english-ii": "kaoyan",
    "english-1": "kaoyan",
    "english-2": "kaoyan",
  };

  let renderQueued = false;

  /* ------------------------------------------------------------ 存储读写 */

  function emptyStore() {
    return { version: 1, records: {} };
  }

  function readStore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return emptyStore();
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return emptyStore();
      }
      const records =
        parsed.records && typeof parsed.records === "object" && !Array.isArray(parsed.records)
          ? parsed.records
          : {};
      return { version: 1, records };
    } catch {
      return emptyStore();
    }
  }

  function writeStore(store) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch {
      return false;
    }
  }

  function dispatchChange() {
    window.dispatchEvent(new CustomEvent("iball:exam-scores"));
  }

  /* -------------------------------------------------------------- 工具 */

  function normalizeExam(value) {
    const key = String(value || "").trim().toLowerCase();
    if (!key) {
      return "";
    }
    if (EXAM_ALIASES[key]) {
      return EXAM_ALIASES[key];
    }
    if (key.includes("考研") || key.includes("kaoyan")) {
      return "kaoyan";
    }
    if (key.includes("四级") || key.includes("cet4")) {
      return "cet4";
    }
    if (key.includes("六级") || key.includes("cet6")) {
      return "cet6";
    }
    return "";
  }

  function clean(value, fallback) {
    const text = String(value == null ? "" : value).trim();
    return text || fallback || "";
  }

  function recordKey(kind, exam, paperId, sectionId) {
    return `${kind}|${exam}|${paperId}|${sectionId}`;
  }

  function ensureRecord(store, meta) {
    const key = recordKey(meta.kind, meta.exam, meta.paperId, meta.sectionId);
    let record = store.records[key];
    if (!record || typeof record !== "object") {
      record = {
        exam: meta.exam,
        paperId: meta.paperId,
        paperLabel: meta.paperLabel,
        sectionId: meta.sectionId,
        sectionLabel: meta.sectionLabel,
        kind: meta.kind,
        items: {},
        updatedAt: 0,
      };
      store.records[key] = record;
    }
    // 标题类信息以最新一次调用为准，便于统一命名。
    record.paperLabel = clean(meta.paperLabel, record.paperLabel || meta.paperId);
    record.sectionLabel = clean(meta.sectionLabel, record.sectionLabel || meta.sectionId);
    record.exam = meta.exam;
    record.kind = meta.kind;
    return record;
  }

  function pruneRecord(store, key) {
    const record = store.records[key];
    if (record && Object.keys(record.items || {}).length === 0) {
      delete store.records[key];
    }
  }

  function commit(store) {
    writeStore(store);
    dispatchChange();
    scheduleRender();
  }

  /* ---------------------------------------------------------- 写入接口 */

  function recordObjective(entry) {
    const exam = normalizeExam(entry?.exam);
    if (!exam) {
      return false;
    }
    const paperId = clean(entry?.paperId, "unknown");
    const sectionId = clean(entry?.sectionId, "default");
    const number = Number(entry?.questionNo);
    if (!Number.isFinite(number)) {
      return false;
    }
    const store = readStore();
    const record = ensureRecord(store, {
      kind: "objective",
      exam,
      paperId,
      paperLabel: entry?.paperLabel,
      sectionId,
      sectionLabel: entry?.sectionLabel,
    });
    const answer = clean(entry?.answer, "");
    const chosen = clean(entry?.chosen, "");
    const verified = Boolean(entry?.verified);
    record.items[String(number)] = {
      no: number,
      chosen,
      answer,
      // 只有答案已公开（用户看过答案 / 解析）才判定对错，未验证的选择记为 null。
      correct: verified && answer && chosen ? chosen === answer : null,
      verified,
      at: Date.now(),
    };
    record.updatedAt = Date.now();
    commit(store);
    return true;
  }

  function recordSubjective(entry) {
    const exam = normalizeExam(entry?.exam);
    if (!exam) {
      return false;
    }
    const paperId = clean(entry?.paperId, "unknown");
    const sectionId = clean(entry?.sectionId, "default");
    const itemId = clean(entry?.itemId, "");
    if (!itemId) {
      return false;
    }
    const store = readStore();
    const record = ensureRecord(store, {
      kind: "subjective",
      exam,
      paperId,
      paperLabel: entry?.paperLabel,
      sectionId,
      sectionLabel: entry?.sectionLabel,
    });
    const score = Number(entry?.score);
    const maxScore = Number(entry?.maxScore);
    record.items[itemId] = {
      id: itemId,
      label: clean(entry?.label, itemId),
      status: clean(entry?.status, "draft"),
      words: Number.isFinite(Number(entry?.words)) ? Number(entry.words) : null,
      score: Number.isFinite(score) ? score : null,
      maxScore: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : null,
      official: false,
      note: clean(entry?.note, ""),
      at: Date.now(),
    };
    record.updatedAt = Date.now();
    commit(store);
    return true;
  }

  function removeQuestion(entry) {
    const exam = normalizeExam(entry?.exam);
    if (!exam) {
      return false;
    }
    const key = recordKey(
      "objective",
      exam,
      clean(entry?.paperId, "unknown"),
      clean(entry?.sectionId, "default"),
    );
    const store = readStore();
    const record = store.records[key];
    if (!record) {
      return false;
    }
    delete record.items[String(Number(entry?.questionNo))];
    record.updatedAt = Date.now();
    pruneRecord(store, key);
    commit(store);
    return true;
  }

  function removeSubjective(entry) {
    const exam = normalizeExam(entry?.exam);
    if (!exam) {
      return false;
    }
    const key = recordKey(
      "subjective",
      exam,
      clean(entry?.paperId, "unknown"),
      clean(entry?.sectionId, "default"),
    );
    const store = readStore();
    const record = store.records[key];
    if (!record) {
      return false;
    }
    delete record.items[clean(entry?.itemId, "")];
    record.updatedAt = Date.now();
    pruneRecord(store, key);
    commit(store);
    return true;
  }

  function clearPaper(options) {
    const exam = normalizeExam(options?.exam);
    const paperId = options?.paperId ? String(options.paperId) : "";
    const store = readStore();
    let touched = false;
    Object.entries(store.records).forEach(([key, record]) => {
      if (exam && record.exam !== exam) {
        return;
      }
      if (paperId && record.paperId !== paperId) {
        return;
      }
      delete store.records[key];
      touched = true;
    });
    if (touched) {
      commit(store);
    }
    return touched;
  }

  function clearExam(exam) {
    const normalized = normalizeExam(exam);
    if (!normalized) {
      return false;
    }
    return clearPaper({ exam: normalized });
  }

  function clearAll() {
    const touched = Object.keys(readStore().records).length > 0;
    writeStore(emptyStore());
    dispatchChange();
    scheduleRender();
    return touched;
  }

  /* ---------------------------------------------------------- 统计汇总 */

  function summarize(filter = {}) {
    const exam = normalizeExam(filter.exam);
    const store = readStore();
    const papers = new Map();
    const overall = {
      exam: exam || "all",
      answered: 0,
      correct: 0,
      wrong: 0,
      unverified: 0,
      subjectiveDone: 0,
      subjectiveGraded: 0,
      subjectiveScore: 0,
      subjectiveMax: 0,
      scoreKnown: false,
    };

    Object.values(store.records).forEach((record) => {
      if (!record || typeof record !== "object") {
        return;
      }
      const recordExam = normalizeExam(record.exam);
      if (exam && recordExam !== exam) {
        return;
      }
      const paperKey = `${recordExam}|${record.paperId}`;
      if (!papers.has(paperKey)) {
        papers.set(paperKey, {
          exam: recordExam,
          examLabel: EXAM_LABELS[recordExam] || "考试",
          paperId: record.paperId,
          paperLabel: record.paperLabel || record.paperId,
          sections: new Map(),
          answered: 0,
          correct: 0,
          wrong: 0,
          unverified: 0,
        });
      }
      const paper = papers.get(paperKey);
      const sectionKey = `${record.kind}|${record.sectionId}`;
      if (!paper.sections.has(sectionKey)) {
        paper.sections.set(sectionKey, {
          id: record.sectionId,
          label: record.sectionLabel || record.sectionId,
          kind: record.kind,
          answered: 0,
          correct: 0,
          wrong: 0,
          unverified: 0,
          subjectiveDone: 0,
          subjectiveGraded: 0,
          score: 0,
          maxScore: 0,
          wrongItems: [],
          items: [],
        });
      }
      const section = paper.sections.get(sectionKey);
      const items = Object.values(record.items || {});
      if (record.kind === "objective") {
        items.forEach((item) => {
          const chosen = clean(item?.chosen, "");
          if (!chosen) {
            return;
          }
          const isCorrect = item?.correct === true;
          const settled = item?.correct === true || item?.correct === false;
          section.answered += 1;
          overall.answered += 1;
          if (isCorrect) {
            section.correct += 1;
            overall.correct += 1;
          } else if (settled) {
            section.wrong += 1;
            overall.wrong += 1;
          } else {
            section.unverified += 1;
            overall.unverified += 1;
          }
          section.items.push(item);
          if (settled && !isCorrect) {
            section.wrongItems.push(item);
          }
        });
      } else {
        items.forEach((item) => {
          const graded = item?.status === "graded";
          section.subjectiveDone += 1;
          overall.subjectiveDone += 1;
          if (graded) {
            section.subjectiveGraded += 1;
            overall.subjectiveGraded += 1;
          }
          if (Number.isFinite(item?.score)) {
            section.score += Number(item.score);
            overall.subjectiveScore += Number(item.score);
            overall.scoreKnown = true;
          }
          if (Number.isFinite(item?.maxScore)) {
            section.maxScore += Number(item.maxScore);
            overall.subjectiveMax += Number(item.maxScore);
          }
          section.items.push(item);
        });
      }
    });

    const paperList = [...papers.values()].map((paper) => {
      paper.objectiveAnswered = 0;
      paper.objectiveCorrect = 0;
      paper.objectiveWrong = 0;
      paper.objectiveUnverified = 0;
      paper.sections.forEach((section) => {
        if (section.kind !== "objective") {
          return;
        }
        paper.objectiveAnswered += section.answered;
        paper.objectiveCorrect += section.correct;
        paper.objectiveWrong += section.wrong;
        paper.objectiveUnverified += section.unverified;
      });
      paper.sectionList = [...paper.sections.values()].sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "objective" ? -1 : 1;
        }
        return compareQuestionNumbers(left.id, right.id);
      });
      return paper;
    });

    paperList.sort((left, right) => {
      const order = EXAM_ORDER.indexOf(left.exam) - EXAM_ORDER.indexOf(right.exam);
      if (order !== 0) {
        return order;
      }
      return String(right.paperId).localeCompare(String(left.paperId), "zh-CN");
    });

    overall.accuracy = overall.answered
      ? Math.round((overall.correct / overall.answered) * 100)
      : 0;
    return { exam: exam || "all", overall, papers: paperList };
  }

  function compareQuestionNumbers(left, right) {
    const leftNumber = Number(String(left).replace(/[^\d]/g, ""));
    const rightNumber = Number(String(right).replace(/[^\d]/g, ""));
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    return String(left).localeCompare(String(right), "zh-CN");
  }

  /* ------------------------------------------------------------ 面板渲染 */

  function elapsedLabel(timestamp) {
    const time = Number(timestamp);
    if (!Number.isFinite(time) || time <= 0) {
      return "";
    }
    const date = new Date(time);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  function buildChips(summary) {
    const wrap = document.createElement("div");
    wrap.className = "exam-scores-chips";
    const overall = summary.overall;
    const chips = [
      { value: String(overall.answered), label: "已作答题数" },
      { value: String(overall.correct), label: "答对" },
      { value: String(overall.wrong), label: "答错" },
      { value: overall.answered ? `${overall.accuracy}%` : "—", label: "正确率" },
      {
        value: `${overall.subjectiveDone}`,
        label: overall.subjectiveGraded
          ? `主观题（已批改 ${overall.subjectiveGraded}）`
          : "主观题已作答",
      },
    ];
    chips.forEach((chip) => {
      const node = document.createElement("span");
      node.className = "exam-score-chip";
      const strong = document.createElement("strong");
      strong.textContent = chip.value;
      const label = document.createElement("span");
      label.textContent = chip.label;
      node.append(strong, label);
      wrap.append(node);
    });
    if (overall.unverified) {
      const note = document.createElement("span");
      note.className = "exam-score-chip is-soft";
      const strong = document.createElement("strong");
      strong.textContent = String(overall.unverified);
      const label = document.createElement("span");
      label.textContent = "已选但未验证";
      note.append(strong, label);
      wrap.append(note);
    }
    return wrap;
  }

  function buildTable(summary) {
    const table = document.createElement("table");
    table.className = "exam-scores-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["板块 / 试卷", "作答", "正确", "错误", "正确率"].forEach((label) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = label;
      headRow.append(cell);
    });
    head.append(headRow);
    table.append(head);

    const body = document.createElement("tbody");
    summary.papers.forEach((paper) => {
      if (!paper.objectiveAnswered) {
        return;
      }
      const paperRow = document.createElement("tr");
      paperRow.className = "is-paper";
      const paperCell = document.createElement("th");
      paperCell.scope = "row";
      const paperName = document.createElement("strong");
      paperName.textContent = paper.paperLabel;
      const paperMeta = document.createElement("span");
      paperMeta.textContent = `${paper.examLabel} · ${paper.objectiveAnswered} 题已作答`;
      paperCell.append(paperName, paperMeta);
      paperRow.append(paperCell);
      [
        String(paper.objectiveAnswered),
        String(paper.objectiveCorrect),
        String(paper.objectiveWrong),
        paper.objectiveAnswered
          ? `${Math.round((paper.objectiveCorrect / paper.objectiveAnswered) * 100)}%`
          : "—",
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        paperRow.append(cell);
      });
      body.append(paperRow);

      paper.sectionList
        .filter((section) => section.kind === "objective" && section.answered)
        .forEach((section) => {
          const row = document.createElement("tr");
          const cell = document.createElement("th");
          cell.scope = "row";
          cell.className = "is-section";
          const name = document.createElement("span");
          name.textContent = section.label;
          cell.append(name);
          row.append(cell);
          [
            String(section.answered),
            String(section.correct),
            String(section.wrong),
            section.answered
              ? `${Math.round((section.correct / section.answered) * 100)}%`
              : "—",
          ].forEach((value) => {
            const cellNode = document.createElement("td");
            cellNode.textContent = value;
            row.append(cellNode);
          });
          body.append(row);
        });
    });
    table.append(body);
    return body.childElementCount ? table : null;
  }

  function buildSubjective(summary) {
    const rows = [];
    summary.papers.forEach((paper) => {
      paper.sectionList
        .filter((section) => section.kind === "subjective" && section.subjectiveDone)
        .forEach((section) => {
          rows.push({ paper, section });
        });
    });
    if (!rows.length) {
      return null;
    }
    const block = document.createElement("div");
    block.className = "exam-scores-subjective";
    const title = document.createElement("h4");
    title.textContent = "主观题与作文";
    block.append(title);
    rows.forEach(({ paper, section }) => {
      const row = document.createElement("p");
      row.className = "exam-scores-subjective-row";
      const name = document.createElement("strong");
      name.textContent = `${paper.paperLabel} · ${section.label}`;
      row.append(name);
      const parts = [];
      parts.push(`已作答 ${section.subjectiveDone} 项`);
      if (section.subjectiveGraded) {
        parts.push(`已批改 ${section.subjectiveGraded} 项`);
      }
      if (section.maxScore > 0) {
        parts.push(
          `学习评分 ${section.score} / ${section.maxScore} 分（规则引擎，非官方分数）`,
        );
      } else if (section.score > 0) {
        parts.push(`学习评分合计 ${section.score} 分（非官方分数）`);
      } else {
        parts.push("待批改");
      }
      const detail = document.createElement("span");
      detail.textContent = parts.join(" ｜ ");
      row.append(detail);
      block.append(row);
    });
    return block;
  }

  function buildWrongDetails(summary) {
    const groups = [];
    summary.papers.forEach((paper) => {
      paper.sectionList
        .filter((section) => section.wrongItems.length)
        .forEach((section) => {
          groups.push({ paper, section });
        });
    });
    if (!groups.length) {
      return null;
    }
    const details = document.createElement("details");
    details.className = "exam-scores-wrong";
    const summaryNode = document.createElement("summary");
    const total = groups.reduce((acc, group) => acc + group.section.wrongItems.length, 0);
    summaryNode.textContent = `错题分布（${total} 题，按板块列出）`;
    details.append(summaryNode);
    groups.forEach(({ paper, section }) => {
      const block = document.createElement("div");
      block.className = "exam-scores-wrong-group";
      const heading = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${paper.paperLabel} · ${section.label}`;
      const count = document.createElement("span");
      count.textContent = `${section.wrongItems.length} 题错误`;
      heading.append(strong, count);
      block.append(heading);
      const list = document.createElement("ul");
      section.wrongItems
        .slice()
        .sort((left, right) => Number(left.no) - Number(right.no))
        .forEach((item) => {
          const row = document.createElement("li");
          const number = document.createElement("em");
          number.textContent = `第 ${item.no} 题`;
          const body = document.createElement("span");
          body.textContent = `你选 ${item.chosen} ｜ 正确答案 ${item.answer || "未收录"}`;
          row.append(number, body);
          list.append(row);
        });
      block.append(list);
      details.append(block);
    });
    return details;
  }

  function renderPanel(node) {
    // data-exam="all"（或缺失）表示跨模块汇总，其余按模块过滤。
    const scope = node.dataset.exam || "";
    const exam = scope === "all" ? "" : normalizeExam(scope);
    const summary = summarize({ exam });
    const title = node.dataset.title || "我的得分统计";
    const scopeLabel = exam ? `${EXAM_LABELS[exam]}模块` : "全部模块";

    const head = document.createElement("div");
    head.className = "exam-scores-head";
    const copy = document.createElement("div");
    const heading = document.createElement("h2");
    heading.textContent = title;
    const note = document.createElement("p");
    note.textContent = `统计范围：${scopeLabel}（含本账号同步的全部试卷）｜ 客观题按对错计数，主观题只记完成与学习评分，不换算官方分数。`;
    copy.append(heading, note);
    head.append(copy);
    const actions = document.createElement("div");
    actions.className = "exam-scores-actions";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "exam-scores-clear";
    clear.dataset.examClear = exam || "all";
    clear.textContent = "清空这部分记录";
    actions.append(clear);
    head.append(actions);

    const children = [head, buildChips(summary)];
    const table = buildTable(summary);
    if (table) {
      children.push(table);
    } else {
      const empty = document.createElement("p");
      empty.className = "exam-scores-empty";
      empty.textContent = "还没有作答记录。做完任意一套题，这里会自动出现模块总分与逐板块的正确率。";
      children.push(empty);
    }
    const subjective = buildSubjective(summary);
    if (subjective) {
      children.push(subjective);
    }
    const wrong = buildWrongDetails(summary);
    if (wrong) {
      children.push(wrong);
    }
    const stamp = summary.papers.reduce(
      (latest, paper) =>
        Math.max(
          latest,
          ...paper.sectionList.map((section) =>
            section.items.reduce((acc, item) => Math.max(acc, Number(item?.at) || 0), 0),
          ),
        ),
      0,
    );
    const foot = document.createElement("p");
    foot.className = "exam-scores-foot";
    foot.textContent = stamp
      ? `最近一次作答：${elapsedLabel(stamp)} ｜ 记录保存在本机并随账号同步`
      : "记录保存在本机并随账号同步";
    children.push(foot);

    node.replaceChildren(...children);
  }

  function render() {
    renderQueued = false;
    document.querySelectorAll("[data-exam-scores]").forEach(renderPanel);
  }

  function scheduleRender() {
    if (renderQueued) {
      return;
    }
    renderQueued = true;
    window.requestAnimationFrame(render);
  }

  /* -------------------------------------------------------------- 事件 */

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-exam-clear]");
    if (!trigger) {
      return;
    }
    const scope = trigger.dataset.examClear;
    const label = scope === "all" ? "全部考试模块" : `${EXAM_LABELS[scope] || scope}模块`;
    const confirmed = window.confirm(
      `确定清空${label}的作答统计吗？这只清空统计记录，各页面的作答与答案开关不受影响。`,
    );
    if (!confirmed) {
      return;
    }
    if (scope === "all") {
      clearAll();
    } else {
      clearExam(scope);
    }
  });

  window.addEventListener("iball:exam-scores", scheduleRender);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      scheduleRender();
    }
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  window.ExamScores = {
    storageKey: STORAGE_KEY,
    normalizeExam,
    recordObjective,
    recordSubjective,
    removeQuestion,
    removeSubjective,
    clearPaper,
    clearExam,
    clearAll,
    summarize,
    render,
  };
})();
