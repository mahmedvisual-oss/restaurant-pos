/* Professional financial reports — presentation layer over existing report APIs */
(function () {
  "use strict";

  function money(v) { return typeof fmtCur === "function" ? fmtCur(Number(v || 0)) : Number(v || 0).toLocaleString(); }
  function esc(v) { return typeof escapeHtml === "function" ? escapeHtml(String(v ?? "")) : String(v ?? ""); }
  function method(v) { return typeof methodName === "function" ? methodName(v) : String(v || "—"); }
  function q(v) { return encodeURIComponent(v || ""); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  function range() {
    const from = document.getElementById("report-from")?.value || new Date().toISOString().slice(0, 10);
    const to = document.getElementById("report-to")?.value || from;
    return { from, to };
  }

  function addTab() {
    const tabs = document.getElementById("report-tabs");
    if (!tabs || tabs.querySelector('[data-pro-report="1"]')) return;
    const b = document.createElement("button");
    b.className = "report-tab";
    b.dataset.proReport = "1";
    b.textContent = "📑 التقرير المالي الاحترافي";
    b.title = "تقرير مالي احترافي للطباعة";
    b.addEventListener("click", openProfessionalReport);
    tabs.appendChild(b);
  }

  function setActive() {
    document.querySelectorAll("#report-tabs .report-tab").forEach(x => x.classList.remove("active"));
    document.querySelector('#report-tabs [data-pro-report="1"]')?.classList.add("active");
  }

  async function openProfessionalReport() {
    const content = document.getElementById("report-content");
    const detail = document.getElementById("report-detail");
    if (!content) return;
    setActive();
    if (detail) detail.innerHTML = "";
    content.innerHTML = '<div class="report-section"><div class="report-section-title">📑 التقرير المالي الاحترافي</div><div style="padding:18px;text-align:center;color:var(--muted)">جاري تجهيز التقرير...</div></div>';

    try {
      const r = range();
      const [d, cr] = await Promise.all([
        api("/api/reports/advanced?from=" + q(r.from) + "&to=" + q(r.to)),
        api("/api/credit/receipts?from=" + q(r.from) + "&to=" + q(r.to)).catch(() => ({ total: 0, items: [] }))
      ]);
      render(d, cr, r);
    } catch (e) {
      content.innerHTML = '<div class="report-section"><div style="color:var(--danger);padding:15px">❌ ' + esc(e.message) + '</div></div>';
    }
  }

  function render(d, cr, r) {
    const content = document.getElementById("report-content");
    const orders = d.orders || [];
    const methods = (d.by_method || []).slice().sort((a, b) => num(b.total) - num(a.total));
    const employees = (d.by_employee || []).slice().sort((a, b) => num(b.total) - num(a.total));
    const items = (d.top_items || []).slice().sort((a, b) => num(b.revenue) - num(a.revenue)).slice(0, 15);

    const subtotal = orders.reduce((s, o) => s + num(o.subtotal), 0);
    const discount = orders.reduce((s, o) => s + num(o.discount), 0);
    const tax = num(d.total_tax);
    const sales = num(d.total_sales);
    const paid = orders.reduce((s, o) => s + Math.max(0, num(o.paid)), 0);
    const creditSales = orders.filter(o => String(o.payment_method || "") === "آجل").reduce((s, o) => s + num(o.total), 0);
    const outstanding = orders.reduce((s, o) => s + Math.max(0, num(o.total) - num(o.paid)), 0);
    const creditCollected = num(cr.total);
    const cash = methods.filter(m => String(m.method) === "نقدي").reduce((s, m) => s + num(m.total), 0);
    const electronic = methods.filter(m => !["نقدي", "آجل"].includes(String(m.method))).reduce((s, m) => s + num(m.total), 0);
    const pct = v => sales > 0 ? (num(v) / sales * 100).toFixed(1) + "%" : "0.0%";

    const kpi = (label, value, cls) => `<div class="report-kpi-item ${cls || ""}"><div class="report-kpi-value">${value}</div><div class="report-kpi-label">${label}</div></div>`;
    const row = (label, value, cls) => `<tr${cls ? ` class="${cls}"` : ""}><th class="row-head">${label}</th><td>${value}</td></tr>`;

    const methodRows = methods.map(m => `<tr><td>${esc(method(m.method))}</td><td>${num(m.count)}</td><td>${money(m.total)}</td><td>${pct(m.total)}</td></tr>`).join("");
    const employeeRows = employees.map(e => `<tr><td>${esc(e.employee || "—")}</td><td>${num(e.count)}</td><td>${money(e.total)}</td><td>${pct(e.total)}</td></tr>`).join("");
    const itemRows = items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td>${num(i.qty)}</td><td>${money(i.revenue)}</td></tr>`).join("");
    const daily = (d.daily || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const dailyRows = daily.map(x => `<tr><td>${esc(x.date)}</td><td>${num(x.count)}</td><td>${money(x.total)}</td><td>${money(num(x.count) ? num(x.total) / num(x.count) : 0)}</td></tr>`).join("");

    content.innerHTML = `
      <div class="report-section pro-report" id="professional-report">
        <div class="pro-report-head">
          <div>
            <div class="pro-report-title">📑 التقرير المالي الاحترافي</div>
            <div class="pro-report-sub">${esc(typeof RESTAURANT_NAME !== "undefined" ? RESTAURANT_NAME : "المطعم")}</div>
          </div>
          <div class="pro-report-meta">الفترة: <b>${esc(r.from)}</b> إلى <b>${esc(r.to)}</b><br>تاريخ الإصدار: ${new Date().toLocaleString()}</div>
        </div>
        <div class="pro-actions"><button class="btn btn-info btn-sm" onclick="printProfessionalReport()">🖨️ طباعة التقرير الاحترافي</button></div>

        <div class="report-kpi pro-kpi">
          ${kpi("صافي المبيعات", money(sales))}
          ${kpi("عدد الفواتير", num(d.order_count))}
          ${kpi("متوسط الفاتورة", money(d.avg_order))}
          ${kpi("الضريبة", money(tax))}
          ${kpi("الخصومات", money(discount))}
          ${kpi("المحصّل على الفواتير", money(paid))}
          ${kpi("مبيعات الآجل", money(creditSales))}
          ${kpi("تحصيل الآجل خلال الفترة", money(creditCollected))}
        </div>

        <div class="report-section">
          <div class="report-section-title">📌 الملخص التنفيذي</div>
          <table class="report-table pro-table"><tbody>
            ${row("المجموع قبل الضريبة", money(subtotal))}
            ${row("الخصومات", "-" + money(discount))}
            ${row("الضريبة", money(tax))}
            ${row("الإجمالي النهائي", money(sales), "total-row")}
            ${row("تحصيل نقدي", money(cash))}
            ${row("تحصيل إلكتروني / بنكي", money(electronic))}
            ${row("مبيعات آجلة", money(creditSales))}
            ${row("الرصيد غير المحصّل من الفواتير", money(outstanding))}
          </tbody></table>
        </div>

        <div class="report-section">
          <div class="report-section-title">💳 تحليل طرق الدفع</div>
          <table class="report-table pro-table"><thead><tr><th>طريقة الدفع</th><th>العمليات</th><th>المبلغ</th><th>النسبة</th></tr></thead><tbody>
            ${methodRows || '<tr><td colspan="4" style="text-align:center">لا توجد عمليات</td></tr>'}
            <tr class="total-row"><th>الإجمالي</th><th>${num(d.order_count)}</th><th>${money(sales)}</th><th>100%</th></tr>
          </tbody></table>
        </div>

        <div class="report-section">
          <div class="report-section-title">👥 أداء الكاشير / الموظفين</div>
          <table class="report-table pro-table"><thead><tr><th>الموظف</th><th>الفواتير</th><th>المبيعات</th><th>النسبة</th></tr></thead><tbody>
            ${employeeRows || '<tr><td colspan="4" style="text-align:center">لا توجد بيانات</td></tr>'}
          </tbody></table>
        </div>

        <div class="report-section">
          <div class="report-section-title">🍽️ الأصناف الأكثر مبيعًا</div>
          <table class="report-table pro-table"><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>الإيراد</th></tr></thead><tbody>
            ${itemRows || '<tr><td colspan="4" style="text-align:center">لا توجد بيانات</td></tr>'}
          </tbody></table>
        </div>

        <div class="report-section">
          <div class="report-section-title">📅 المبيعات اليومية</div>
          <table class="report-table pro-table"><thead><tr><th>التاريخ</th><th>الفواتير</th><th>المبيعات</th><th>متوسط الفاتورة</th></tr></thead><tbody>
            ${dailyRows || '<tr><td colspan="4" style="text-align:center">لا توجد بيانات</td></tr>'}
          </tbody></table>
        </div>

        <div class="pro-note">⚠️ التقرير يوضح الإيرادات والتحصيل والذمم. لا يُعرض صافي الربح الحقيقي إلا عند اكتمال ربط تكلفة البضاعة والمصروفات بالمبيعات.</div>
      </div>`;

    installStyles();
  }

  function installStyles() {
    if (document.getElementById("professional-report-style")) return;
    const s = document.createElement("style");
    s.id = "professional-report-style";
    s.textContent = `
      .pro-report{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px}
      .pro-report-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:2px solid var(--border);padding-bottom:10px;margin-bottom:10px}
      .pro-report-title{font-size:20px;font-weight:800}.pro-report-sub{color:var(--muted);margin-top:3px}
      .pro-report-meta{text-align:left;color:var(--muted);font-size:11px;line-height:1.7}
      .pro-actions{display:flex;justify-content:flex-end;margin-bottom:10px}
      .pro-kpi{grid-template-columns:repeat(4,minmax(0,1fr))}
      .pro-table th,.pro-table td{padding:7px 8px}
      .pro-note{margin-top:14px;padding:9px;border:1px dashed var(--border);border-radius:8px;color:var(--muted);font-size:11px}
      @media(max-width:700px){.pro-report-head{flex-direction:column}.pro-report-meta{text-align:right}.pro-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(s);
  }

  window.printProfessionalReport = function () {
    const root = document.getElementById("professional-report");
    if (!root) return;
    const clone = root.cloneNode(true);
    clone.querySelectorAll("button,input,select,textarea,.pro-actions").forEach(x => x.remove());
    const dir = document.documentElement.dir || "rtl";
    const title = "التقرير المالي الاحترافي";
    const html = `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${title}</title><style>
      @page{size:A4;margin:12mm}body{font-family:Arial,'Segoe UI',sans-serif;color:#111;margin:0;font-size:11px}h1,h2,h3{margin:0}.pro-report{width:100%}.pro-report-head{display:flex;justify-content:space-between;border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:10px}.pro-report-title{font-size:18px;font-weight:800}.pro-report-sub{margin-top:3px}.pro-report-meta{text-align:left;font-size:10px;line-height:1.6}.report-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:8px 0}.report-kpi-item{border:1px solid #bbb;padding:7px;text-align:center}.report-kpi-value{font-size:13px;font-weight:800}.report-kpi-label{font-size:9px;margin-top:3px}.report-section{margin:10px 0;page-break-inside:avoid}.report-section-title{font-size:13px;font-weight:800;border-bottom:1px solid #999;padding:5px 0;margin-bottom:5px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;text-align:right}th{background:#eee}.total-row{font-weight:800;background:#f5f5f5}.pro-note{margin-top:10px;border:1px dashed #888;padding:7px;font-size:9px}@media print{tr{page-break-inside:avoid}}
    if (typeof hiddenPrint === "function") hiddenPrint(html); else window.print();
  };

  document.addEventListener("DOMContentLoaded", function () {
    addTab();
    installStyles();
  });

  // showReports may be invoked before DOMContentLoaded on fast loads; retry once.
  setTimeout(addTab, 300);
})();
