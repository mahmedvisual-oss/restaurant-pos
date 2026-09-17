/* POS UI language runtime — non-recursive, render-time localization only. */
(function () {
  "use strict";
  if (window.__POS_UI_LANGUAGE_RUNTIME__) return;
  window.__POS_UI_LANGUAGE_RUNTIME__ = true;

  const CATEGORY_LABELS = {
    "مشروبات": { ar: "مشروبات", en: "Beverages", id: "Minuman" },
    "أطباق رئيسية": { ar: "أطباق رئيسية", en: "Main Dishes", id: "Hidangan Utama" },
    "مقبلات": { ar: "مقبلات", en: "Appetizers", id: "Makanan Pembuka" },
    "حلويات": { ar: "حلويات", en: "Desserts", id: "Makanan Penutup" }
  };

  const SECTION_KEYS = {
    families: "families",
    family: "families",
    "family-room": "families",
    "family_room": "families",
    عائلات: "families",
    العائلات: "families",
    vip: "vip",
    hall: "hall",
    main: "hall",
    dining: "hall",
    restaurant: "hall",
    الصالة: "hall",
    takeaway: "takeaway",
    "take-away": "takeaway",
    "take_away": "takeaway",
    تيك_أواي: "takeaway",
    "تيك أواي": "takeaway"
  };

  const SECTION_LABELS = {
    families: { ar: "العائلات", en: "Families", id: "Keluarga" },
    vip: { ar: "VIP", en: "VIP", id: "VIP" },
    hall: { ar: "الصالة", en: "Hall", id: "Ruang Makan" },
    takeaway: { ar: "تيك أواي", en: "Takeaway", id: "Bawa Pulang" }
  };

  function lang() {
    return window.currentLang || document.documentElement.lang || "id";
  }

  function localizedCategory(value) {
    const raw = String(value == null ? "" : value).trim();
    const entry = CATEGORY_LABELS[raw];
    return entry ? (entry[lang()] || entry.id || raw) : raw;
  }

  function sectionKey(value) {
    const raw = String(value == null ? "" : value).trim();
    return SECTION_KEYS[raw.toLowerCase()] || SECTION_KEYS[raw] || raw.toLowerCase();
  }

  function localizedSection(value) {
    const key = sectionKey(value);
    const entry = SECTION_LABELS[key];
    return entry ? (entry[lang()] || entry.id || String(value || "")) : String(value || "").trim();
  }

  function refreshCategoryLabels() {
    document.querySelectorAll("#cats .cat-btn").forEach(function (el) {
      const onclick = el.getAttribute("onclick") || "";
      const m = onclick.match(/selectCat\s*\(\s*['\"]([^'\"]*)['\"]\s*\)/);
      if (m && m[1] !== "__ALL__") {
        el.textContent = localizedCategory(m[1]);
        return;
      }
      const raw = el.dataset.category || el.getAttribute("data-category") || "";
      if (raw && raw !== "__ALL__") el.textContent = localizedCategory(raw);
    });

    document.querySelectorAll("#menu-list .acc-group").forEach(function (group) {
      const cat = group.getAttribute("data-cat") || group.dataset.cat || "";
      const label = group.querySelector(".acc-cat");
      if (label && cat) label.textContent = localizedCategory(cat);
    });
  }

  function refreshTableSectionLabels() {
    document.querySelectorAll("#tables-list .table-section").forEach(function (section) {
      const classes = Array.from(section.classList);
      const cls = classes.find(function (x) { return x.indexOf("sec-") === 0; });
      if (!cls) return;
      const key = cls.slice(4);
      const title = section.querySelector(".table-section-title");
      if (!title) return;
      const icon = title.querySelector(".sec-icon");
      const count = title.querySelector(".sec-count");
      title.textContent = "";
      if (icon) title.appendChild(icon);
      title.appendChild(document.createTextNode(" " + localizedSection(key) + " "));
      if (count) title.appendChild(count);
    });

    document.querySelectorAll("#floor-plan .floor-zone").forEach(function (zone) {
      const key = Array.from(zone.classList).find(function (x) {
        return SECTION_KEYS[x] || SECTION_LABELS[x];
      });
      if (!key) return;
      const label = zone.querySelector(".floor-zone-label");
      if (label) {
        const icon = label.textContent.trim().split(/\s+/)[0] || "🪑";
        label.textContent = icon + " " + localizedSection(key);
      }
    });
  }

  function refreshTableReportLabels() {
    document.querySelectorAll("#report-content tr.report-drill").forEach(function (row) {
      const onclick = row.getAttribute("onclick") || "";
      const m = onclick.match(/applyReportDrill\('section',\s*'([^']+)'\)/);
      if (!m) return;
      const cell = row.querySelector("td");
      if (!cell) return;
      const icon = cell.textContent.trim().split(/\s+/)[0] || "🪑";
      cell.textContent = icon + " " + localizedSection(m[1]);
    });
  }

  const wrappers = [
    ["renderCats", refreshCategoryLabels],
    ["renderMenu", refreshCategoryLabels],
    ["renderTables", refreshTableSectionLabels],
    ["renderFloorPlan", refreshTableSectionLabels],
    ["renderTablesReport", refreshTableReportLabels]
  ];

  function installWrappers() {
    let pending = false;
    wrappers.forEach(function (entry) {
      const name = entry[0];
      const refresh = entry[1];
      const original = window[name];
      if (typeof original !== "function" || original.__uiLanguageWrapped) {
        if (typeof original !== "function") pending = true;
        return;
      }
      const wrapped = function () {
        const result = original.apply(this, arguments);
        try { refresh(); } catch (_) {}
        return result;
      };
      wrapped.__uiLanguageWrapped = true;
      window[name] = wrapped;
    });

    refreshCategoryLabels();
    refreshTableSectionLabels();
    refreshTableReportLabels();

    if (pending) window.setTimeout(installWrappers, 100);
  }

  window.localizedCategoryLabel = localizedCategory;
  window.localizedTableSectionLabel = localizedSection;
  installWrappers();
})();
