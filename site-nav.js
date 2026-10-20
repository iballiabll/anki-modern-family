/**
 * 全站导航（共享组件）：底部五个一级标签 + 模块抽屉。
 *
 * Astra 改版后的信息架构：今天 / 精读 / 词汇 / 练习 / 我的。
 * 桌面端由 site-nav.css 隐藏，原有顶栏与侧栏导航保持不变；
 * 手机与平板用同一份配置渲染底栏，名称与排序与桌面一级入口一致。
 *
 * 只负责导航重排，不改动任何模块自身的交互；一级入口减少不等于删功能，
 * 抽屉里保留全部既有页面、旧地址与查询参数。
 *
 * 图标取自 Lucide（https://lucide.dev，MIT License），
 * 内联成 SVG 以免多引入一个运行时依赖。
 */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  // iframe 内嵌（如首页的词汇库 ?embed=1）默认不重复渲染底部导航；
  // 三端实机预览页显式带 sitepreview=1，让预览里的 iPad / 手机实例呈现真实底栏。
  if (window.top !== window.self && params.get("sitepreview") !== "1") {
    return;
  }
  if (document.documentElement.dataset.vocabEmbed === "true") {
    return;
  }
  if (params.get("embed") === "1") {
    return;
  }

  var CURRENT_PAGE = (
    window.location.pathname.split("/").pop() || "index.html"
  ).toLowerCase();

  var ICONS = {
    home:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>',
    layers:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 12.18-9.17 4.16a2 2 0 0 1-1.66 0L2 12.18"/><path d="m22 17.18-9.17 4.16a2 2 0 0 1-1.66 0L2 17.18"/></svg>',
    book:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>',
    pen:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  };

  var GROUPS = [
    {
      id: "intensive",
      title: "精读",
      note: "真题、外刊与美剧",
      items: [
        {
          page: "reading-intensive.html",
          badge: "阅",
          title: "四级阅读精读",
          meta: "仔细阅读 / 段落匹配 / 选词填空",
        },
        {
          page: "intensive.html",
          badge: "听",
          title: "四级听力精读",
          meta: "全文翻译 / 出题点 / 答案位置",
        },
        {
          page: "cet6-reading.html",
          badge: "六",
          title: "六级阅读精读",
          meta: "2015-2026 六级阅读真题",
        },
        {
          page: "cet6-listening.html",
          badge: "六",
          title: "六级听力精读",
          meta: "逐段翻译 / 出题点提示",
        },
        {
          page: "kaoyan.html",
          badge: "研",
          title: "考研英语一 / 二",
          meta: "2010-2026 真题精读",
        },
        {
          page: "periodical.html",
          badge: "刊",
          title: "外刊精读",
          meta: "经济学人等外刊原文",
        },
        {
          page: "movie.html",
          badge: "剧",
          title: "美剧台词精读",
          meta: "摩登家庭 · 逐句精翻",
        },
      ],
    },
    {
      id: "vocab",
      title: "词汇",
      note: "词书、生词、复习与测试",
      items: [
        {
          page: "vocab.html?library=1",
          badge: "词",
          title: "词书",
          meta: "内置词库 / 我的词书 / 进度",
        },
        {
          page: "vocab.html?library=1&libraryView=notebook",
          badge: "生",
          title: "生词",
          meta: "按来源回原文 / 收藏筛选",
        },
        {
          page: "review.html",
          badge: "复",
          title: "复习",
          meta: "素材复习 / 生词抽卡 / 词书复习",
        },
        {
          page: "quiz.html",
          badge: "测",
          title: "测试",
          meta: "分级出题 · 成绩与排行榜",
        },
      ],
    },
    {
      id: "practice",
      title: "练习",
      note: "听说读写与自带材料",
      items: [
        {
          page: "listen.html",
          badge: "听",
          title: "听写",
          meta: "逐句听写与复读",
        },
        {
          page: "shadow.html",
          badge: "跟",
          title: "跟读",
          meta: "台词跟读练习",
        },
        {
          page: "speaking.html",
          badge: "说",
          title: "口语",
          meta: "场景 / 雅思 / 自由对话",
        },
        {
          page: "writing.html",
          badge: "写",
          title: "写作",
          meta: "作文评分与模板",
        },
        {
          page: "writing-corpus.html",
          badge: "料",
          title: "作文语料库",
          meta: "高级单词 / 词组替换",
        },
        {
          page: "reading.html",
          badge: "读",
          title: "导入阅读材料",
          meta: "上传题目 · 翻译阅读",
        },
        {
          page: "cet6.html",
          badge: "六",
          title: "六级备考总览",
          meta: "六级模块汇总",
        },
        {
          page: "cet6-extra.html",
          badge: "补",
          title: "六级加练",
          meta: "补充练习与成绩",
        },
      ],
    },
    {
      id: "me",
      title: "我的",
      note: "账号、档案与管理",
      items: [
        {
          page: "xxrj/index.html",
          badge: "档",
          title: "历史学习档案",
          meta: "成绩 / 计划 / 错题 / 待复盘",
        },
        {
          page: "admin.html",
          badge: "管",
          title: "管理台",
          meta: "仅站长账号可见",
        },
      ],
    },
  ];

  // 页面 → 一级标签。一级入口减少不等于删功能，旧地址仍可直接访问。
  var PAGE_TAB = {
    "index.html": "today",
    "vocab.html": "vocab",
    "review.html": "vocab",
    "quiz.html": "vocab",
    "reading-intensive.html": "intensive",
    "intensive.html": "intensive",
    "cet6-reading.html": "intensive",
    "cet6-listening.html": "intensive",
    "kaoyan.html": "intensive",
    "periodical.html": "intensive",
    "movie.html": "intensive",
    "listen.html": "practice",
    "shadow.html": "practice",
    "speaking.html": "practice",
    "writing.html": "practice",
    "writing-corpus.html": "practice",
    "reading.html": "practice",
    "cet6.html": "practice",
    "cet6-extra.html": "practice",
    "admin.html": "me",
  };

  var TABS = [
    { id: "today", label: "今天", icon: "home", page: "index.html" },
    {
      id: "intensive",
      label: "精读",
      icon: "layers",
      sheet: true,
      focus: "intensive",
    },
    { id: "vocab", label: "词汇", icon: "book", page: "vocab.html?library=1" },
    {
      id: "practice",
      label: "练习",
      icon: "pen",
      sheet: true,
      focus: "practice",
    },
    { id: "me", label: "我的", icon: "user", sheet: true, focus: "me" },
  ];

  function iconSpan(name) {
    var span = document.createElement("span");
    span.className = "site-tab-icon";
    span.innerHTML = ICONS[name] || "";
    return span;
  }

  function activeTabId() {
    if (PAGE_TAB[CURRENT_PAGE]) {
      return PAGE_TAB[CURRENT_PAGE];
    }
    if (window.location.pathname.indexOf("/xxrj/") !== -1) {
      return "me";
    }
    return "practice";
  }

  var activeId = activeTabId();

  var root = document.createElement("div");
  root.className = "site-nav-root";

  var tabbar = document.createElement("nav");
  tabbar.className = "site-tabbar";
  tabbar.setAttribute("aria-label", "全站导航");

  var sheetButtons = [];
  TABS.forEach(function (tab) {
    var isActive = tab.id === activeId;
    var node;
    if (tab.sheet) {
      node = document.createElement("button");
      node.type = "button";
      node.setAttribute("aria-expanded", "false");
      node.setAttribute("aria-controls", "siteNavSheet");
      sheetButtons.push(node);
    } else {
      node = document.createElement("a");
      node.href = "./" + tab.page;
      if (isActive) {
        node.setAttribute("aria-current", "page");
      }
    }
    node.className = "site-tab" + (isActive ? " is-active" : "");
    node.dataset.tab = tab.id;
    node.appendChild(iconSpan(tab.icon));
    var label = document.createElement("span");
    label.className = "site-tab-label";
    label.textContent = tab.label;
    node.appendChild(label);
    if (tab.sheet) {
      node.addEventListener("click", function () {
        openSheet(node, tab.focus);
      });
    }
    tabbar.appendChild(node);
  });

  var backdrop = document.createElement("div");
  backdrop.className = "site-nav-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.addEventListener("click", closeSheet);

  var sheet = document.createElement("section");
  sheet.className = "site-nav-sheet";
  sheet.id = "siteNavSheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "siteNavSheetTitle");
  sheet.setAttribute("aria-hidden", "true");

  var head = document.createElement("header");
  head.className = "site-nav-sheet-head";
  var titleWrap = document.createElement("div");
  titleWrap.className = "site-nav-sheet-title";
  var title = document.createElement("strong");
  title.id = "siteNavSheetTitle";
  title.textContent = "全部学习入口";
  var note = document.createElement("span");
  note.textContent = "合并的是入口，能力一个不少";
  titleWrap.append(title, note);
  var closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "site-nav-close";
  closeButton.textContent = "关闭";
  closeButton.addEventListener("click", closeSheet);
  head.append(titleWrap, closeButton);
  sheet.appendChild(head);

  GROUPS.forEach(function (group) {
    var section = document.createElement("div");
    section.className = "site-nav-group";
    section.dataset.group = group.id;
    var heading = document.createElement("h3");
    heading.textContent = group.title + " · " + group.note;
    section.appendChild(heading);

    var list = document.createElement("div");
    list.className = "site-nav-group-list";
    group.items.forEach(function (item) {
      var link = document.createElement("a");
      link.className = "site-nav-link";
      link.href = "./" + item.page;
      if (item.page.replace(/[?#].*$/, "") === CURRENT_PAGE) {
        link.classList.add("is-current");
        link.setAttribute("aria-current", "page");
      }

      var badge = document.createElement("span");
      badge.className = "site-nav-link-badge";
      badge.setAttribute("aria-hidden", "true");
      badge.textContent = item.badge;

      var copy = document.createElement("span");
      var strong = document.createElement("strong");
      strong.textContent = item.title;
      var small = document.createElement("small");
      small.textContent = item.meta;
      copy.append(strong, small);

      var arrow = document.createElement("span");
      arrow.className = "site-nav-link-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "›";

      link.append(badge, copy, arrow);
      list.appendChild(link);
    });
    section.appendChild(list);
    sheet.appendChild(section);
  });

  root.append(tabbar, backdrop, sheet);
  document.body.appendChild(root);
  document.body.classList.add("has-site-tabbar");

  var lastFocus = null;

  function isOpen() {
    return document.body.classList.contains("is-site-sheet-open");
  }

  function openSheet(opener, focusGroup) {
    lastFocus = opener || null;
    document.body.classList.add("is-site-sheet-open");
    sheet.setAttribute("aria-hidden", "false");
    sheetButtons.forEach(function (button) {
      button.setAttribute("aria-expanded", "true");
    });
    sheet.scrollTop = 0;
    if (focusGroup) {
      var target = sheet.querySelector('[data-group="' + focusGroup + '"]');
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "auto" });
      }
    }
    closeButton.focus();
  }

  function closeSheet() {
    if (!isOpen()) {
      return;
    }
    document.body.classList.remove("is-site-sheet-open");
    sheet.setAttribute("aria-hidden", "true");
    sheetButtons.forEach(function (button) {
      button.setAttribute("aria-expanded", "false");
    });
    if (lastFocus && typeof lastFocus.focus === "function") {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  document.addEventListener("keydown", function (event) {
    if (!isOpen()) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    var focusable = sheet.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) {
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // 抽屉里的链接切换页面即可，不做拦截；这里只保证点击后状态复位。
  sheet.addEventListener("click", function (event) {
    var link = event.target.closest("a.site-nav-link");
    if (link) {
      closeSheet();
    }
  });
})();
