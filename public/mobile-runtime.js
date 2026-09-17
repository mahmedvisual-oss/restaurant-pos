/* MOBILE_RUNTIME
 * Single owner for mobile panel switching.
 * The server-rendered #mobile-nav remains the only mobile navigation markup.
 * No accounting, payment, order, or database logic lives here.
 */
(function () {
  "use strict";

  function isSmallScreen() {
    return window.innerWidth <= 768;
  }

  function sync(panel) {
    const panels = document.querySelectorAll(".main > .col[data-panel]");
    panels.forEach(function (el) {
      const active = isSmallScreen() && el.dataset.panel === panel;
      if (isSmallScreen()) {
        el.classList.toggle("mobile-panel-active", active);
        el.style.display = active ? "flex" : "none";
      } else {
        el.classList.remove("mobile-panel-active");
        el.style.removeProperty("display");
      }
    });

    document.querySelectorAll("#mobile-nav .mobile-nav-btn[data-panel-btn]").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.panelBtn === panel && isSmallScreen());
    });
  }

  window.switchPanel = function (panel) {
    const allowed = new Set(["menu", "cart", "tables"]);
    const target = allowed.has(panel) ? panel : "menu";
    sync(target);
    try { localStorage.setItem("pos_mobile_panel", target); } catch (_) {}
  };

  function boot() {
    if (!isSmallScreen()) return;
    let panel = "menu";
    try {
      const saved = localStorage.getItem("pos_mobile_panel");
      if (["menu", "cart", "tables"].includes(saved)) panel = saved;
    } catch (_) {}
    sync(panel);
  }

  window.addEventListener("resize", function () {
    if (isSmallScreen()) {
      const active = document.querySelector("#mobile-nav .mobile-nav-btn.active[data-panel-btn]");
      sync(active ? active.dataset.panelBtn : "menu");
    } else {
      sync(null);
    }
  }, { passive: true });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
