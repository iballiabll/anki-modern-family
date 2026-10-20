/**
 * 「今天」首屏 + 本机最近打开
 * ---------------------------------------------------------------------------
 * 两件事，都用真实数据，不伪造热度、学习时长或完成率：
 *
 *   1. 记录：在任意学习页打开时，把「模块 + 地址 + 标题 + 时间」写进
 *      localStorage 的 iball_recent_items_v1（最多 30 条，按模块去重）。
 *      这是本机记录，不做跨设备同步，所以界面文案统一写「本机最近打开」。
 *   2. 渲染：只有在首页 index.html 上，才把 #todayBand 的日期、继续入口
 *      和最近打开列表填上。没有任何记录时不显示「已恢复」之类的假状态，
 *      而是给出「从一篇材料开始」的三个明确去处。
 *
 * 不依赖任何模块脚本；读不到 localStorage 时静默降级为纯静态首屏。
 */
(function () {
  "use strict";

  var STORE_KEY = "iball_recent_items_v1";
  var COLLAPSE_KEY = "iball:today-collapsed";
  var MAX_ITEMS = 30;

  var MODULES = {
    "reading-intensive.html": { kind: "真题", label: "四级阅读精读" },
    "intensive.html": { kind: "真题", label: "四级听力精读" },
    "cet6-reading.html": { kind: "真题", label: "六级阅读精读" },
    "cet6-listening.html": { kind: "真题", label: "六级听力精读" },
    "kaoyan.html": { kind: "真题", label: "考研英语真题精读" },
    "periodical.html": { kind: "外刊", label: "外刊精读" },
    "movie.html": { kind: "美剧", label: "美剧台词精读" },
    "vocab.html": { kind: "词书", label: "词汇库" },
    "review.html": { kind: "复习", label: "复习" },
    "quiz.html": { kind: "测试", label: "单词测试" },
    "listen.html": { kind: "听写", label: "听句精听" },
    "shadow.html": { kind: "跟读", label: "影子跟读" },
    "speaking.html": { kind: "口语", label: "口语房间" },
    "writing.html": { kind: "写作", label: "写作批改" },
    "writing-corpus.html": { kind: "写作", label: "作文语料库" },
    "reading.html": { kind: "阅读", label: "导入阅读材料" },
    "cet6.html": { kind: "六级", label: "六级备考总览" },
    "cet6-extra.html": { kind: "六级", label: "六级加练" },
  };

  var FALLBACK = [
    { kind: "真题", label: "考研英语真题精读", url: "./kaoyan.html" },
    { kind: "外刊", label: "外刊精读", url: "./periodical.html" },
    { kind: "词书", label: "词汇库", url: "./vocab.html?library=1" },
  ];

  var params = new URLSearchParams(window.location.search);
  var inFrame = window.top !== window.self;
  var isEmbed = params.get("embed") === "1";

  function currentPage() {
    return (window.location.pathname.split("/").pop() || "index.html")
      .toLowerCase();
  }

  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeStore(items) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(items));
    } catch (error) {
      /* 隐私模式或配额满：保持内存态即可，不打断页面。 */
    }
  }

  function recordVisit() {
    var page = currentPage();
    var meta = MODULES[page];
    if (!meta) {
      return;
    }
    if (params.get("library") === "1" || params.get("deck")) {
      meta = { kind: "词书", label: meta.label };
    }
    var entry = {
      module: page,
      contentId: page,
      url: "./" + page + window.location.search,
      title: meta.label,
      kind: meta.kind,
      visitedAt: Date.now(),
    };
    var items = readStore().filter(function (item) {
      return item && item.module !== entry.module;
    });
    items.unshift(entry);
    writeStore(items.slice(0, MAX_ITEMS));
  }

  function formatDate(now) {
    var weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return (
      weekdays[now.getDay()] +
      " · " +
      (now.getMonth() + 1) +
      " 月 " +
      now.getDate() +
      " 日"
    );
  }

  function renderRecent(listNode, items) {
    listNode.replaceChildren();
    var recent = items.filter(function (item) {
      return item && item.module && item.module !== "index.html";
    });
    if (recent.length === 0) {
      var empty = document.createElement("p");
      empty.className = "today-recent-empty";
      empty.textContent =
        "还没有打开记录。打开一篇文章或一本词书后，这里会按真实访问时间列出。";
      listNode.appendChild(empty);
      return;
    }
    recent.slice(0, 3).forEach(function (item) {
      var row = document.createElement("a");
      row.className = "today-recent-row";
      row.href = item.url || "./" + item.module;

      var kind = document.createElement("span");
      kind.className = "today-recent-kind";
      kind.textContent = item.kind || "学习";

      var title = document.createElement("span");
      title.className = "today-recent-title";
      title.textContent = item.title || item.module;

      var go = document.createElement("span");
      go.className = "today-recent-go";
      go.textContent = "继续 →";

      row.append(kind, title, go);
      listNode.appendChild(row);
    });
  }

  function renderResume(items) {
    var titleNode = document.querySelector("#todayResumeTitle");
    var noteNode = document.querySelector("#todayResumeNote");
    var buttonNode = document.querySelector("#todayResumeButton");
    if (!titleNode || !noteNode || !buttonNode) {
      return;
    }
    var recent = items.filter(function (item) {
      return item && item.module && item.module !== "index.html";
    });
    if (recent.length === 0) {
      titleNode.textContent = "从一篇材料开始";
      noteNode.textContent = "还没有打开记录，从下面任意一处开始都可以。";
      buttonNode.href = "./periodical.html";
      buttonNode.textContent = "开始精读";
      return;
    }
    var last = recent[0];
    titleNode.textContent = last.title || last.module;
    noteNode.textContent = "上次打开的是「" + (last.kind || "学习") + "」。";
    buttonNode.href = last.url || "./" + last.module;
    buttonNode.textContent = "继续阅读";
  }

  function wireCollapse(band, toggle) {
    var collapsed = false;
    try {
      collapsed = window.localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch (error) {
      collapsed = false;
    }

    function apply(next) {
      band.classList.toggle("is-collapsed", next);
      toggle.setAttribute("aria-expanded", next ? "false" : "true");
      toggle.textContent = next ? "展开" : "收起";
    }

    apply(collapsed);

    toggle.addEventListener("click", function () {
      var next = !band.classList.contains("is-collapsed");
      apply(next);
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch (error) {
        /* 忽略：只是少记住一次偏好。 */
      }
    });

    // 在素材导航里点开一份素材后，把首屏让给正文（只在本次浏览生效）。
    var list = document.querySelector("#resourceList");
    if (list) {
      list.addEventListener("click", function (event) {
        if (event.target.closest("a, button")) {
          band.classList.add("is-collapsed");
          toggle.setAttribute("aria-expanded", "false");
          toggle.textContent = "展开";
        }
      });
    }
  }

  try {
    if (!inFrame && !isEmbed) {
      recordVisit();
    }
  } catch (error) {
    /* 记录失败不影响页面。 */
  }

  var band = document.querySelector("#todayBand");
  if (!band) {
    return;
  }

  try {
    var dateNode = document.querySelector("#todayBandDate");
    if (dateNode) {
      dateNode.textContent = formatDate(new Date());
    }
    var items = readStore();
    renderResume(items);
    var listNode = document.querySelector("#todayRecentList");
    if (listNode) {
      renderRecent(listNode, items);
    }
    var toggle = document.querySelector("#todayBandToggle");
    if (toggle) {
      wireCollapse(band, toggle);
    }
  } catch (error) {
    /* 首屏渲染失败时保留静态文案。 */
  }
})();
