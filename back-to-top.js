/**
 * 阅读页回顶按钮（共享组件）。
 *
 * 下滑超过大半屏后浮现：
 *   · 正在篇章中段 → 回到当前篇章顶部；
 *   · 已经在篇章顶部，或页面没有篇章结构 → 回到页面顶端。
 * 不改变任何阅读交互；词卡 / 底部面板（z-index 更高）打开时按钮自然被盖住。
 *
 * 图标取自 Lucide（https://lucide.dev，MIT License）的 chevron-up，
 * 内联成 SVG，与 site-nav.js 的处理保持一致。
 */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  // iframe 内嵌页面（如首页里的词汇库）不重复渲染。
  if (window.top !== window.self && params.get("sitepreview") !== "1") {
    return;
  }
  if (params.get("embed") === "1" || !document.body) {
    return;
  }

  var SHOW_AFTER = 520;
  // 词汇库的词表 / 词书列表是「页面内滚动容器」，滚轮停在列表上时
  // window.scrollY 一直是 0，只用窗口位置判断按钮就永远不出现。
  // 这些容器单独用更浅的阈值触发，点击时优先把列表拉回开头。
  var SCROLLER_SELECTOR = [
    ".vocab-list",
    ".vocab-detail",
    ".vocab-wordbook-list",
    ".library-entry",
    ".library-book-list",
  ].join(", ");
  var SCROLLER_SHOW_AFTER = 320;
  var SECTION_MIN_HEIGHT = 240;
  var SECTION_ANCHOR = 160;
  var NEAR_TOP_GAP = 80;
  var activeScroller = null;
  // 站点里明确的「篇章单元」：优先回到这些容器的顶部，
  // 避免把篇章内部的段落行 / 题组当成篇章开头。
  var UNIT_SELECTOR = [
    ".piece-section",
    ".intensive-piece",
    ".periodical-card",
    ".periodical-month",
    ".movie-scene",
    ".reader-content",
    ".vocab-board",
    ".shadow-lines-panel",
    ".upload-panel",
  ].join(", ");
  // 内容外壳（导航 + 所有篇章的公共容器），永远不作为回顶目标。
  var SHELL_SELECTOR = ".intensive-content";

  var button = document.createElement("button");
  button.type = "button";
  button.className = "back-to-top";
  button.setAttribute("aria-label", "回到当前篇章顶部");
  button.setAttribute("title", "回到篇章顶部");
  button.setAttribute("aria-hidden", "true");
  button.tabIndex = -1;
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>';
  document.body.appendChild(button);

  /** 元素是否横跨视口锚点，且高度达到篇章量级。 */
  function spansAnchor(node) {
    var rect = node.getBoundingClientRect();
    return (
      rect.height >= SECTION_MIN_HEIGHT &&
      rect.top <= SECTION_ANCHOR &&
      rect.bottom > SECTION_ANCHOR
    );
  }

  /** 在一组元素里取最内层（top 最大）的那个的文档坐标。 */
  function innermostTop(nodes) {
    var bestTop = null;
    for (var index = 0; index < nodes.length; index += 1) {
      var rect = nodes[index].getBoundingClientRect();
      if (
        rect.height < SECTION_MIN_HEIGHT ||
        rect.top > SECTION_ANCHOR ||
        rect.bottom <= SECTION_ANCHOR
      ) {
        continue;
      }
      // 嵌套篇章取最靠下（最内层）的那个。
      if (bestTop === null || rect.top > bestTop) {
        bestTop = rect.top;
      }
    }
    return bestTop === null ? null : window.scrollY + bestTop;
  }

  /** 当前视口所在篇章的文档坐标顶部；找不到篇章结构时返回 null。 */
  function currentSectionTop() {
    var units = innermostTop(document.querySelectorAll(UNIT_SELECTOR));
    if (units !== null) {
      return units;
    }
    var nodes = [];
    var candidates = document.querySelectorAll("main section, main article");
    for (var index = 0; index < candidates.length; index += 1) {
      if (!candidates[index].matches(SHELL_SELECTOR)) {
        nodes.push(candidates[index]);
      }
    }
    return innermostTop(nodes);
  }

  /** 页面内滚动容器：返回当前滚得最靠下的那个（且仍在文档里）。 */
  function findActiveScroller() {
    var nodes = document.querySelectorAll(SCROLLER_SELECTOR);
    var best = null;
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index];
      if (node.scrollTop <= SCROLLER_SHOW_AFTER) {
        continue;
      }
      var rect = node.getBoundingClientRect();
      if (rect.height < 80 || rect.width < 80) {
        continue;
      }
      if (best === null || node.scrollTop > best.scrollTop) {
        best = node;
      }
    }
    return best;
  }

  function scrollContainerToTop(node) {
    var reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    node.scrollTop = 0;
  }

  function scrollToTop() {
    // 列表里下滑过：先把列表拉回开头，再谈篇章 / 页面。
    if (activeScroller && activeScroller.scrollTop > NEAR_TOP_GAP) {
      scrollContainerToTop(activeScroller);
      return;
    }
    var sectionTop = currentSectionTop();
    var target = sectionTop === null ? 0 : Math.max(0, sectionTop - 12);
    // 已经在篇章开头：再点一次回页面顶端。
    if (sectionTop !== null && window.scrollY - target < NEAR_TOP_GAP) {
      target = 0;
    }
    var reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: target,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }

  function syncVisibility() {
    activeScroller = findActiveScroller();
    var visible = window.scrollY > SHOW_AFTER || activeScroller !== null;
    button.classList.toggle("is-visible", visible);
    button.setAttribute("aria-hidden", visible ? "false" : "true");
    button.tabIndex = visible ? 0 : -1;
  }

  button.addEventListener("click", scrollToTop);
  window.addEventListener("scroll", syncVisibility, { passive: true });
  window.addEventListener("resize", syncVisibility);
  // scroll 事件不冒泡，用捕获阶段统一接住页面内滚动容器。
  document.addEventListener("scroll", syncVisibility, {
    passive: true,
    capture: true,
  });
  syncVisibility();
})();
