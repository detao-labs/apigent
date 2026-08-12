(function () {
  "use strict";

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function closeMenus() { qsa(".dropdown-menu.show").forEach(function (m) { m.classList.remove("show"); }); }

  // ---------- Toast ----------
  window.showToast = function (message, type) {
    var box = qs(".toast-container");
    if (!box) {
      box = document.createElement("div");
      box.className = "toast-container";
      document.body.appendChild(box);
    }
    var t = document.createElement("div");
    t.className = "toast " + (type || "success");
    t.textContent = message;
    box.appendChild(t);
    setTimeout(function () {
      t.classList.add("out");
      setTimeout(function () { t.remove(); }, 350);
    }, 2400);
  };

  // ---------- Overlay（弹窗 / 抽屉） ----------
  window.openOverlay = function (sel) { var el = qs(sel); if (el) el.classList.add("show"); };
  window.closeOverlay = function (sel) { var el = qs(sel); if (el) el.classList.remove("show"); };

  // ---------- 确认对话框 ----------
  window.confirmMock = function (message, onOk, onCancel) {
    var ov = document.createElement("div");
    ov.className = "overlay center show";
    ov.innerHTML =
      '<div class="dialog"><div class="dialog-head"><h2>请确认</h2></div>' +
      '<div class="dialog-body"><p style="font-size:14px;line-height:1.6">' + message + "</p></div>" +
      '<div class="dialog-foot">' +
      '<button class="btn btn-secondary" data-mock-cancel>取消</button>' +
      '<button class="btn btn-danger" data-mock-ok>确认</button>' +
      "</div></div>";
    document.body.appendChild(ov);
    ov.querySelector("[data-mock-cancel]").addEventListener("click", function () { ov.remove(); if (onCancel) onCancel(); });
    ov.querySelector("[data-mock-ok]").addEventListener("click", function () { ov.remove(); if (onOk) onOk(); });
  };

  // ---------- 复制 ----------
  function copyText(text, done) {
    function legacy() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove();
      done();
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, legacy);
    } else {
      legacy();
    }
  }
  function flash(btn) {
    var old = btn.textContent;
    btn.textContent = "✓ 已复制";
    setTimeout(function () { btn.textContent = old; }, 1500);
  }

  // ---------- 全局委托事件 ----------
  document.addEventListener("click", function (e) {
    var el;

    el = e.target.closest("[data-open]");
    if (el) { window.openOverlay(el.getAttribute("data-open")); return; }

    el = e.target.closest("[data-close]");
    if (el) { window.closeOverlay(el.getAttribute("data-close")); return; }

    el = e.target.closest("[data-toast]");
    if (el) {
      closeMenus();
      window.showToast(el.getAttribute("data-toast"), el.getAttribute("data-toast-type") || "success");
      return;
    }

    el = e.target.closest(".notice-item");
    if (el) {
      el.classList.remove("warn");
      closeMenus();
      showToast("（演示）已标记为已读");
      return;
    }

    el = e.target.closest(".notice-all");
    if (el) { closeMenus(); showToast("通知中心将在 V1 提供", "warn"); return; }

    el = e.target.closest("[data-copy-from]");
    if (el) {
      var src = qs(el.getAttribute("data-copy-from"));
      if (src) copyText(src.textContent.trim(), function () { flash(el); });
      return;
    }

    el = e.target.closest("[data-copy]");
    if (el) { copyText(el.getAttribute("data-copy"), function () { flash(el); }); return; }

    el = e.target.closest("[data-dropdown]");
    if (el) {
      var menu = el.parentElement.querySelector(".dropdown-menu");
      if (menu) menu.classList.toggle("show");
      e.stopPropagation();
      return;
    }

    if (!e.target.closest(".dropdown-menu")) closeMenus();

    el = e.target.closest("[data-theme]");
    if (el) {
      applyTheme(el.getAttribute("data-theme"));
      closeMenus();
      showToast(el.getAttribute("data-theme") === "dark" ? "已切换深色主题" : "已切换浅色主题");
      return;
    }

    el = e.target.closest("[data-lang]");
    if (el) {
      closeMenus();
      showToast(el.getAttribute("data-lang") === "zh" ? "界面语言：中文" : "界面语言：English");
      return;
    }

    el = e.target.closest("tr[data-href]");
    if (el && !e.target.closest("a,button")) {
      window.location.href = el.getAttribute("data-href");
    }
  });

  // ---------- 开关（MCP 等） ----------
  document.addEventListener("change", function (e) {
    var sw = e.target.closest(".switch input");
    if (!sw || sw.hasAttribute("data-confirm-switch")) return;
    window.showToast(
      sw.getAttribute("data-msg") || (sw.checked ? "已启用" : "已关闭"),
      sw.checked ? "success" : "warn"
    );
  });

  // ---------- 主题（浅色 / 深色，跨页面记忆） ----------
  window.applyTheme = function (theme) {
    document.body.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("apigent-mock-theme", theme); } catch (e) {}
  };
  (function initTheme() {
    var saved = "light";
    try { saved = localStorage.getItem("apigent-mock-theme") || "light"; } catch (e) {}
    window.applyTheme(saved);
  })();

  // ---------- 全局搜索（V1 演示） ----------
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.id === "globalSearch") {
      showToast("全局搜索将在 V1 提供（当前为演示）", "warn");
    }
  });

  // ---------- 同页 Tab ----------
  document.addEventListener("click", function (e) {
    var tab = e.target.closest("[data-tab]");
    if (!tab) return;
    var group = tab.getAttribute("data-tab-group") || "tabs";
    var name = tab.getAttribute("data-tab");
    qsa("[data-tab-group='" + group + "']").forEach(function (t) {
      t.classList.toggle("active", t === tab);
    });
    qsa("[data-panel-group='" + group + "']").forEach(function (p) {
      p.classList.toggle("show", p.getAttribute("data-panel") === name);
    });
  });
})();
