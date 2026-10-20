/**
 * 考研英语作文语料库 · 模块脚本。
 *
 * 只做「读数据 → 渲染 → 搜索/筛选 → 复制」四件事，不依赖任何账号数据，
 * 失败时降级为一条可读的错误提示，不影响页面其它部分。
 *
 * 支持可分享的定位参数（与站内其它模块的旧参数风格一致）：
 *   writing-corpus.html?part=phrase
 *   writing-corpus.html?part=word&cat=负面评价
 *   writing-corpus.html?part=word&q=significant
 */
(function () {
  "use strict";

  var DATA = window.IBALL_WRITING_CORPUS;
  var listEl = document.getElementById("wcorpusList");
  var statsEl = document.getElementById("wcorpusStats");
  var tabsEl = document.getElementById("wcorpusTabs");
  var catsEl = document.getElementById("wcorpusCats");
  var countEl = document.getElementById("wcorpusCount");
  var emptyEl = document.getElementById("wcorpusEmpty");
  var searchEl = document.getElementById("wcorpusSearch");
  var copyAllEl = document.getElementById("wcorpusCopyAll");

  if (!listEl || !DATA || !DATA.parts) {
    if (listEl) {
      listEl.innerHTML =
        '<p class="wcorpus-empty">语料数据没有加载成功。请刷新页面；' +
        "若仍然如此，可以直接打开页面右上角的原件 PDF。</p>";
    }
    return;
  }

  var params = new URLSearchParams(window.location.search);
  var state = {
    part: params.get("part") === "phrase" ? "phrase" : "word",
    cat: params.get("cat") || "",
    q: params.get("q") || "",
  };

  /* ------------------------------------------------------------ 工具 */

  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function highlight(value) {
    var safe = esc(value);
    var needle = state.q.trim();
    if (!needle) return safe;
    try {
      return safe.replace(
        new RegExp(
          "(" + needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")",
          "gi",
        ),
        "<mark>$1</mark>",
      );
    } catch (error) {
      return safe;
    }
  }

  function part(id) {
    for (var i = 0; i < DATA.parts.length; i += 1) {
      if (DATA.parts[i].id === id) return DATA.parts[i];
    }
    return DATA.parts[0];
  }

  function countOf(p) {
    var total = 0;
    p.sections.forEach(function (section) {
      total += section.items.length;
    });
    return total;
  }

  function termOf(item) {
    return item.adv || item.phrase || "";
  }

  function sourceOf(item) {
    return item.basic || "";
  }

  function exampleOf(item) {
    return item.colloc || item.usage || "";
  }

  function lineOf(item) {
    var parts = [termOf(item), item.cn];
    var example = exampleOf(item);
    var source = sourceOf(item);
    if (source) parts.push("（替代 " + source + "）");
    if (example) parts.push("例：" + example);
    return parts.filter(Boolean).join(" | ");
  }

  function currentRows() {
    var p = part(state.part);
    var needle = state.q.trim().toLowerCase();
    var rows = [];
    p.sections.forEach(function (section) {
      if (state.cat && section.title !== state.cat) return;
      section.items.forEach(function (item) {
        if (needle) {
          var haystack = [
            termOf(item),
            item.cn,
            sourceOf(item),
            exampleOf(item),
          ]
            .join(" ")
            .toLowerCase();
          if (haystack.indexOf(needle) === -1) return;
        }
        rows.push({ section: section.title, item: item });
      });
    });
    return rows;
  }

  var toastEl = null;
  var toastTimer = null;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "wcorpus-toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove("is-on");
    }, 1700);
  }

  function copyText(text, label) {
    function done() {
      toast(label || "已复制");
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (error) {
        toast("这个浏览器不允许自动复制");
      }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function syncUrl() {
    if (!window.history || !window.history.replaceState) return;
    var qs = new URLSearchParams();
    qs.set("part", state.part);
    if (state.cat) qs.set("cat", state.cat);
    if (state.q.trim()) qs.set("q", state.q.trim());
    window.history.replaceState(null, "", "?" + qs.toString());
  }

  /* ------------------------------------------------------------ 渲染 */

  function renderStats() {
    var total = 0;
    var sections = 0;
    DATA.parts.forEach(function (p) {
      total += countOf(p);
      sections += p.sections.length;
    });
    var cells = [
      ["总条目", total + " 条"],
      ["单词类", countOf(part("word")) + " 条 · " + part("word").sections.length + " 类"],
      ["词组类", countOf(part("phrase")) + " 条 · " + part("phrase").sections.length + " 类"],
      ["原件", DATA.pages + " 页 PDF"],
    ];
    statsEl.innerHTML = cells
      .map(function (cell) {
        return "<div><dt>" + esc(cell[0]) + "</dt><dd>" + esc(cell[1]) + "</dd></div>";
      })
      .join("");
  }

  function renderTabs() {
    tabsEl.innerHTML = DATA.parts
      .map(function (p) {
        var active = p.id === state.part ? " is-active" : "";
        return (
          '<button type="button" role="tab" class="wcorpus-tab' +
          active +
          '" data-part="' +
          esc(p.id) +
          '" aria-selected="' +
          (p.id === state.part) +
          '">' +
          esc(p.title) +
          "<small>" +
          countOf(p) +
          " 条</small></button>"
        );
      })
      .join("");
  }

  function renderCats() {
    var p = part(state.part);
    var chips = [
      '<button type="button" class="wcorpus-cat' +
        (state.cat ? "" : " is-active") +
        '" data-cat="">全部分类</button>',
    ];
    p.sections.forEach(function (section) {
      var active = section.title === state.cat ? " is-active" : "";
      chips.push(
        '<button type="button" class="wcorpus-cat' +
          active +
          '" data-cat="' +
          esc(section.title) +
          '">' +
          esc(section.title) +
          "</button>",
      );
    });
    catsEl.innerHTML = chips.join("");
  }

  function snippetHtml(item, isPhrase) {
    if (isPhrase) {
      return (
        '<span class="wcorpus-snippet">用法：' +
        highlight(exampleOf(item) || "—") +
        "</span>"
      );
    }
    return (
      '<span class="wcorpus-snippet"><em>≈ ' +
      highlight(sourceOf(item) || "—") +
      "</em>　" +
      highlight(exampleOf(item) || "—") +
      "</span>"
    );
  }

  function renderList() {
    var rows = currentRows();
    var isPhrase = state.part === "phrase";
    var p = part(state.part);

    countEl.textContent =
      "当前显示 " +
      rows.length +
      " 条" +
      (state.cat ? " · " + state.cat : " · " + p.title) +
      (state.q.trim() ? " · 关键词「" + state.q.trim() + "」" : "");

    if (!rows.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.textContent = state.q.trim()
        ? "没有匹配「" + state.q.trim() + "」的表达。换一个关键词，或点「全部分类」看看整类。"
        : "这个分类下暂时没有内容。";
      copyAllEl.disabled = true;
      return;
    }

    emptyEl.hidden = true;
    copyAllEl.disabled = false;

    var html = [];
    var lastSection = null;
    rows.forEach(function (row) {
      if (row.section !== lastSection) {
        lastSection = row.section;
        var groupCount = rows.filter(function (r) {
          return r.section === row.section;
        }).length;
        html.push(
          '<div class="wcorpus-group-head"><h2>' +
            esc(row.section) +
            "</h2><span>" +
            groupCount +
            ' 条</span><button type="button" data-copy-section="' +
            esc(row.section) +
            '">复制本类</button></div>',
        );
      }
      var item = row.item;
      html.push(
        '<article class="wcorpus-item' +
          (isPhrase ? " is-phrase" : "") +
          '">' +
          '<span class="wcorpus-term">' +
          highlight(termOf(item)) +
          "</span>" +
          '<span class="wcorpus-cn">' +
          highlight(item.cn) +
          "</span>" +
          snippetHtml(item, isPhrase) +
          '<button type="button" class="wcorpus-copy" data-copy-index="' +
          html.length +
          '" data-line="' +
          esc(lineOf(item)) +
          '">复制</button>' +
          "</article>",
      );
    });
    listEl.innerHTML = html.join("");
  }

  function render() {
    renderTabs();
    renderCats();
    renderList();
    syncUrl();
  }

  /* ------------------------------------------------------------ 事件 */

  tabsEl.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-part]");
    if (!button) return;
    state.part = button.dataset.part;
    state.cat = "";
    render();
    listEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  catsEl.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-cat]");
    if (!button) return;
    state.cat = button.dataset.cat || "";
    render();
  });

  var searchTimer = null;
  searchEl.addEventListener("input", function () {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(function () {
      state.q = searchEl.value || "";
      render();
    }, 140);
  });

  listEl.addEventListener("click", function (event) {
    var copyButton = event.target.closest("button[data-line]");
    if (copyButton) {
      copyText(copyButton.dataset.line, "已复制这一条");
      copyButton.classList.add("is-done");
      copyButton.textContent = "已复制";
      window.setTimeout(function () {
        copyButton.classList.remove("is-done");
        copyButton.textContent = "复制";
      }, 1400);
      return;
    }
    var sectionButton = event.target.closest("button[data-copy-section]");
    if (sectionButton) {
      var title = sectionButton.dataset.copySection;
      var lines = currentRows()
        .filter(function (row) {
          return row.section === title;
        })
        .map(function (row) {
          return lineOf(row.item);
        });
      copyText(title + "\n" + lines.join("\n"), "已复制「" + title + "」" + lines.length + " 条");
    }
  });

  copyAllEl.addEventListener("click", function () {
    var rows = currentRows();
    if (!rows.length) return;
    var title = part(state.part).title + (state.cat ? " · " + state.cat : "");
    var lines = rows.map(function (row) {
      return lineOf(row.item);
    });
    copyText(title + "\n" + lines.join("\n"), "已复制 " + lines.length + " 条");
  });

  if (searchEl) searchEl.value = state.q;
  renderStats();
  render();
})();
