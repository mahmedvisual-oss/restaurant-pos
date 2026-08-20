/* Thermal receipt printing for the professional financial report. */
(function () {
  "use strict";

  function esc(v) {
    return String(v ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function thermalHtml() {
    const root = document.getElementById("professional-report");
    if (!root) return null;

    const clone = root.cloneNode(true);
    clone.querySelectorAll("button,input,select,textarea,.pro-actions").forEach(el => el.remove());

    const restaurant = typeof RESTAURANT_NAME !== "undefined" ? RESTAURANT_NAME : "المطعم";
    const dir = document.documentElement.dir || "rtl";

    return `<!doctype html>
<html dir="${dir}">
<head>
<meta charset="utf-8">
<title>التقرير المالي الحراري</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 80mm; background: #fff; color: #111; }
  body { font-family: Arial, "Segoe UI", sans-serif; font-size: 9px; line-height: 1.35; }
  body:after { content: ""; display: block; height: 12mm; }
  .pro-report { width: 72mm; margin: 0 auto; padding: 3mm 0; }
  .pro-report-head { display: block; text-align: center; border-bottom: 1px dashed #111; padding-bottom: 5px; margin-bottom: 6px; }
  .pro-report-head img { display: none; }
  .pro-report-title { font-size: 14px; font-weight: 800; margin-bottom: 2px; }
  .pro-report-sub { font-size: 11px; font-weight: 700; margin-bottom: 3px; }
  .pro-report-meta { text-align: center; font-size: 8px; color: #333; line-height: 1.5; }
  .report-kpi { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; margin: 5px 0 7px; }
  .report-kpi-item { border: 1px solid #aaa; padding: 4px 2px; text-align: center; }
  .report-kpi-value { font-size: 10px; font-weight: 800; }
  .report-kpi-label { font-size: 7px; margin-top: 1px; }
  .report-section { margin: 7px 0; page-break-inside: auto; }
  .report-section-title { font-size: 10px; font-weight: 800; border-bottom: 1px solid #111; padding: 3px 0; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border-bottom: 1px dotted #aaa; padding: 3px 1px; text-align: right; vertical-align: top; overflow-wrap: anywhere; }
  th { font-weight: 800; }
  th:first-child, td:first-child { width: 39%; }
  .total-row th, .total-row td { font-weight: 800; border-top: 1px solid #111; border-bottom: 1px solid #111; }
  .pro-note { border-top: 1px dashed #111; padding-top: 5px; margin-top: 7px; font-size: 7px; }
  .thermal-footer { border-top: 1px dashed #111; text-align: center; margin-top: 8px; padding-top: 5px; font-size: 7px; }
  .report-section:nth-of-type(n+6) { page-break-before: auto; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div style="text-align:center;margin-bottom:3px;font-weight:800;font-size:11px">${esc(restaurant)}</div>
  ${clone.outerHTML}
  <div class="thermal-footer">تم إصدار التقرير بواسطة نظام نقاط البيع<br>تقرير حراري 80mm</div>
</body>
</html>`;
  }

  window.printProfessionalReportThermal = function () {
    const html = thermalHtml();
    if (!html) return;
    if (typeof hiddenPrint === "function") {
      hiddenPrint(html);
    } else {
      const w = window.open("", "_blank", "width=420,height=700");
      if (!w) {
        alert("⚠️ امنع النوافذ المنبثقة للطباعة");
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 150);
    }
  };

  function installButtons() {
    const actions = document.querySelector("#professional-report .pro-actions");
    if (!actions || actions.dataset.thermalReady === "1") return;

    actions.innerHTML = `
      <div class="thermal-print-actions">
        <button type="button" class="btn btn-success btn-sm" onclick="printProfessionalReportThermal()">🧾 طباعة حرارية 80mm</button>
        <button type="button" class="btn btn-info btn-sm" onclick="printProfessionalReport()">📄 طباعة A4</button>
      </div>`;
    actions.dataset.thermalReady = "1";

    if (!document.getElementById("thermal-report-style")) {
      const style = document.createElement("style");
      style.id = "thermal-report-style";
      style.textContent = `
        .thermal-print-actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
        @media(max-width:520px){.thermal-print-actions{display:grid;grid-template-columns:1fr 1fr}.thermal-print-actions .btn{width:100%}}
      `;
      document.head.appendChild(style);
    }
  }

  const observer = new MutationObserver(installButtons);
  function start() {
    installButtons();
    const content = document.getElementById("report-content");
    if (content) observer.observe(content, { childList: true, subtree: true });
    setTimeout(installButtons, 300);
    setTimeout(installButtons, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
