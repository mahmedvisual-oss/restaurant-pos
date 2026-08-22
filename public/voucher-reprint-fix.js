/* Credit settlement receipt fix: no popup is used for a NEW receipt. */
(function () {
  "use strict";

  function esc(v) {
    if (typeof escapeHtml === "function") return escapeHtml(v == null ? "" : String(v));
    return String(v == null ? "" : v).replace(/[&<>\"']/g, function (m) {
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[m];
    });
  }

  function install() {
    if (typeof api !== "function" || typeof fmtCur !== "function") return false;
    if (window.__creditSettlementReceiptFixed) return true;
    window.__creditSettlementReceiptFixed = true;

    window.settleCredit = async function (lid, total, paid) {
      const input = document.getElementById("credit-pay-" + lid);
      if (!input) return;
      const amount = parseFloat(input.value) || 0;
      const rem = Number(total || 0) - Number(paid || 0);
      if (amount <= 0) return toast(t("rptEnterValidAmount"));
      if (amount > rem + 0.001) return toast(t("rptAmountExceeds", { amt: fmtCur(rem) }));
      const methodEl = document.getElementById("credit-pay-method-" + lid);
      const method = methodEl ? methodEl.value : "نقدي";
      try {
        const res = await api("/api/credit/settle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ledger_id: lid, amount, method }) });
        if (!res.receipt) throw new Error("لم يتم إنشاء سند القبض");
        const r = res.receipt;
        const methodN = (typeof METHOD_NAMES !== "undefined" && METHOD_NAMES[r.method]) ? (METHOD_NAMES[r.method][currentLang] || METHOD_NAMES[r.method].ar) : (r.method || "نقدي");
        const name = typeof RESTAURANT_NAME !== "undefined" ? RESTAURANT_NAME : "POS";
        const dir = document.documentElement.dir || "rtl";
        let box = document.getElementById("credit-settlement-receipt-modal");
        if (!box) { box = document.createElement("div"); box.id = "credit-settlement-receipt-modal"; document.body.appendChild(box); }
        box.innerHTML = "<div style='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px'><div id='credit-settlement-receipt-print' dir='" + esc(dir) + "' style='background:#fff;color:#000;width:340px;max-width:95vw;padding:18px;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:Segoe UI,Tahoma,sans-serif;text-align:center'><img src='/logo.png' style='width:38px;height:38px'><h3 style='margin:5px 0'>" + esc(name) + "</h3><div style='font-weight:bold;font-size:18px'>🧾 " + esc(t("creditVoucher")) + "</div><hr><table style='width:100%;border-collapse:collapse;font-size:13px'><tr><td style='text-align:right;padding:5px'>" + esc(t("dvReceiptNo")) + "</td><td style='text-align:left;padding:5px'><b>" + esc(r.receipt_no) + "</b></td></tr><tr><td style='text-align:right;padding:5px'>" + esc(t("dvPCustomer")) + "</td><td style='text-align:left;padding:5px'>" + esc(r.customer_name || "—") + "</td></tr>" + (r.phone ? "<tr><td style='text-align:right;padding:5px'>" + esc(t("dvPPhone")) + "</td><td style='text-align:left;padding:5px'>" + esc(r.phone) + "</td></tr>" : "") + "<tr><td style='text-align:right;padding:5px'>" + esc(t("dvPDate")) + "</td><td style='text-align:left;padding:5px'>" + esc(r.date || "") + "</td></tr><tr><td style='text-align:right;padding:5px'>" + esc(t("dvPMethod")) + "</td><td style='text-align:left;padding:5px'>" + esc(methodN) + "</td></tr></table><hr><div style='font-size:13px'>" + esc(t("paidAmount")) + "</div><div style='font-size:23px;font-weight:bold;margin:5px 0 12px'>" + esc(fmtCur(r.amount)) + "</div><div style='display:flex;gap:8px;justify-content:center'><button id='credit-receipt-print-btn' style='padding:9px 18px;cursor:pointer'>🖨️ " + esc(t("print")) + "</button><button id='credit-receipt-close-btn' style='padding:9px 18px;cursor:pointer'>✕ " + esc(t("close")) + "</button></div></div></div>";
        document.getElementById("credit-receipt-close-btn").onclick = function () { box.innerHTML = ""; };
        document.getElementById("credit-receipt-print-btn").onclick = function () {
          const printable = document.getElementById("credit-settlement-receipt-print");
          if (!printable) return;
          const html = "<!doctype html><html dir='" + esc(dir) + "'><head><meta charset='utf-8'><title>" + esc(t("creditVoucher")) + " " + esc(r.receipt_no) + "</title><style>@page{size:80mm auto;margin:2mm}body{margin:0;width:76mm;font-family:Segoe UI,Tahoma,sans-serif;color:#000}#credit-settlement-receipt-print{width:76mm;max-width:none;padding:0;box-shadow:none;border-radius:0}button{display:none!important}</style></head><body>" + printable.outerHTML + "</body></html>";
          if (typeof hiddenPrint === "function") hiddenPrint(html);
          else window.print();
        };
        input.value = "";
        if (typeof loadCreditReport === "function") await loadCreditReport();
        toast("✅ " + (res.status === "settled" ? t("rptFullySettled") : t("rptRemainingNow", { amt: fmtCur(res.remaining) })) + " — " + t("rptReceiptNo") + " " + r.receipt_no);
      } catch (e) { toast("❌ " + (e.message || e)); }
    };

    window.showTransferModal = function () {
      if (!selectedTable) { toast("⚠️ لا يوجد طاولة محددة"); return; }
      const cur = tableData[selectedTable];
      const curSection = cur && typeof tableSectionLabel === "function" ? tableSectionLabel(cur) : "";
      const curLabel = cur ? (curSection ? `${cur.num} — ${curSection}` : `${cur.num}`) : selectedTable;
      let html = `<div style="margin-bottom:14px">نقل / دمج طلب الطاولة <b>${esc(curLabel)}</b> إلى:</div>`;
      const groups = new Map();
      const order = ["families", "vip", "hall", "takeaway"];
      for (const [tid, tb] of Object.entries(tableData || {})) {
        if (parseInt(tid) === Number(selectedTable)) continue;
        const section = typeof tableSectionLabel === "function" ? tableSectionLabel(tb) : (tb.section || "أخرى");
        const key = String(section || "أخرى");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push([tid, tb]);
      }
      const rank = (name) => { const n = String(name || "").toLowerCase(); const i = order.indexOf(n); return i >= 0 ? i : 99; };
      const sortedGroups = Array.from(groups.entries()).sort((a, b) => { const ar = rank(a[0]), br = rank(b[0]); if (ar !== br) return ar - br; return a[0].localeCompare(b[0], "ar"); });
      for (const [sectionName, entries] of sortedGroups) {
        entries.sort((a, b) => (Number(a[1].num) || 0) - (Number(b[1].num) || 0));
        html += `<div style="margin:12px 0 6px;font-weight:700;font-size:14px;border-bottom:1px solid var(--border,#444);padding-bottom:5px">📍 ${esc(sectionName)}</div>`;
        for (const [tid, tb] of entries) {
          const num = tb.num ?? tid;
          const label = `طاولة ${num} — ${sectionName}`;
          const status = tb.active ? "🔴 مشغولة" : (tb.reserved ? "📅 محجوزة" : "🟢 متاحة");
          if (tb.active) {
            html += `<div style="display:flex;align-items:center;gap:8px;width:100%;margin:4px 0;padding:8px 10px;border:1px solid var(--border,#444);border-radius:6px"><span style="flex:1"><b>${esc(label)}</b><br><span style="font-size:12px">${status}</span></span><button type="button" onclick="mergeOrder(${Number(tid)});event.stopPropagation()" style="padding:8px 12px;cursor:pointer">🔗 دمج</button></div>`;
          } else {
            const disabled = tb.reserved ? "disabled" : "";
            html += `<button class="transfer-table-btn" onclick="transferOrder(${Number(tid)})" ${disabled} title="${esc(label)} — ${esc(status)}" style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;margin:4px 0;padding:10px 12px"><span><b>${esc(label)}</b></span><span style="font-size:12px;white-space:nowrap">${esc(status)}</span></button>`;
          }
        }
      }
      if (!sortedGroups.length) html += `<div style="padding:12px;color:var(--muted,#999)">لا توجد طاولات أخرى.</div>`;
      document.getElementById("transfer-body").innerHTML = html;
      openModal("transfer-modal");
    };

    window.mergeOrder = async function (toTable) {
      if (!selectedTable || Number(selectedTable) === Number(toTable)) return;
      const from = tableData[selectedTable] || {};
      const to = tableData[toTable] || {};
      const sectionName = (tb) => typeof tableSectionLabel === "function" ? tableSectionLabel(tb) : (tb.section || "");
      const fromLabel = `طاولة ${from.num ?? selectedTable}${sectionName(from) ? " — " + sectionName(from) : ""}`;
      const toLabel = `طاولة ${to.num ?? toTable}${sectionName(to) ? " — " + sectionName(to) : ""}`;
      if (!confirm(`⚠️ دمج ${fromLabel} مع ${toLabel}؟\n\nسيتم جمع الأصناف في فاتورة الطاولة الوجهة.\nلن يتم الدمج إذا كان هناك دفع مسجل أو فاتورة آجل.`)) return;
      try {
        const res = await api("/api/order/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_table: Number(selectedTable), to_table: Number(toTable), merge: true }) });
        if (!res.ok) throw new Error(res.error || "تعذر دمج الطلبين");
        closeModal("transfer-modal");
        if (typeof loadTables === "function") await loadTables();
        if (typeof selectTable === "function") await selectTable(toTable);
        toast(`✅ تم دمج ${fromLabel} مع ${toLabel} في طلب واحد`);
      } catch (e) { toast("❌ " + (e.message || e)); }
    };

    return true;
  }

  let tries = 0;
  const timer = setInterval(function () { tries += 1; if (install() || tries >= 60) clearInterval(timer); }, 100);
  install();

  // Refresh table state after a successful full transfer. The original app.js
  // selects the destination before refreshing tableData, so the old table can
  // remain visually occupied until a manual reload. Wrap it once, without
  // changing the transfer API itself.
  let wrapTries = 0;
  const wrapTimer = setInterval(function () {
    wrapTries += 1;
    if (typeof window.transferOrder !== "function") {
      if (wrapTries >= 60) clearInterval(wrapTimer);
      return;
    }
    if (window.__transferStatusRefreshFixed) { clearInterval(wrapTimer); return; }
    const originalTransferOrder = window.transferOrder;
    window.transferOrder = async function (toTable) {
      const result = await originalTransferOrder(toTable);
      if (typeof loadTables === "function") await loadTables();
      if (typeof selectTable === "function") await selectTable(Number(toTable));
      return result;
    };
    window.__transferStatusRefreshFixed = true;
    clearInterval(wrapTimer);
  }, 100);
})();

/* Unified customer AR statement override.
   It intentionally runs after app.js so it can replace the old AR report UI
   without touching the working payment, print, transfer, or table code. */
(function () {
  "use strict";

  function esc(v) {
    if (typeof escapeHtml === "function") return escapeHtml(v == null ? "" : String(v));
    return String(v == null ? "" : v).replace(/[&<>\"']/g, function (m) {
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[m];
    });
  }

  function money(v) { return typeof fmtCur === "function" ? fmtCur(Number(v) || 0) : String(Number(v) || 0); }

  function keyForCustomer(row) {
    const name = String(row.customer_name || row.credit_name || "").trim().toLowerCase();
    const phone = String(row.phone || "").trim().toLowerCase();
    return (name || "—") + "|" + phone;
  }

  function printStatement(account) {
    const dir = document.documentElement.dir || "rtl";
    const rows = account.statement.map(function (e) {
      return `<tr><td>${esc(e.date)}</td><td>${esc(e.reference)}</td><td>${esc(e.description)}</td><td>${e.debit ? money(e.debit) : "—"}</td><td>${e.credit ? money(e.credit) : "—"}</td><td>${money(e.balance)}</td></tr>`;
    }).join("");
    const html = `<!doctype html><html dir="${esc(dir)}"><head><meta charset="utf-8"><title>كشف حساب ${esc(account.customer_name)}</title><style>@page{size:auto;margin:8mm}body{font-family:Arial,Tahoma,sans-serif;color:#000;margin:0}h2{margin:0 0 5px}p{margin:4px 0;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}th,td{border:1px solid #999;padding:5px;text-align:center}th{background:#eee}.num{font-weight:bold}</style></head><body><h2>كشف حساب آجل</h2><p><b>العميل:</b> ${esc(account.customer_name || "—")}</p><p><b>الهاتف:</b> ${esc(account.phone || "—")}</p><p><b>إجمالي الفواتير:</b> ${money(account.total_invoiced)} &nbsp; <b>التحصيل الفعلي:</b> ${money(account.actual_collected)} &nbsp; <b>الرصيد:</b> ${money(account.remaining)}</p><table><thead><tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    if (typeof hiddenPrint === "function") hiddenPrint(html); else window.print();
  }

  window.printArCustomerStatement = function (idx) {
    const a = window.__arCustomerAccounts && window.__arCustomerAccounts[idx];
    if (a) printStatement(a);
  };

  window.renderAR = async function (c) {
    const from = document.getElementById("report-from")?.value || "";
    const to = document.getElementById("report-to")?.value || "";
    c.innerHTML = `<div class="report-section"><div class="report-section-title">كشف حساب الآجل</div><p style="color:var(--muted);font-size:12px">${typeof t === "function" ? t("rptLoading") : "جاري التحميل..."}</p></div>`;
    try {
      const d = await trackReportLoad(api("/api/reports/ar?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to)));
      if (d && d.error) throw new Error(d.error);
      const rows = Array.isArray(d?.customers) ? d.customers : [];
      const accountsMap = new Map();

      rows.forEach(function (r) {
        const key = keyForCustomer(r);
        if (!accountsMap.has(key)) {
          accountsMap.set(key, {
            customer_name: String(r.customer_name || r.credit_name || "—").trim() || "—",
            phone: String(r.phone || "").trim(),
            invoices: [],
            payments: [],
            statement: [],
            total_invoiced: 0,
            ledger_paid: 0,
            ledger_due: 0,
            open_count: 0,
            settled_count: 0,
            actual_collected: 0,
            remaining: 0,
            reconciliation_difference: 0
          });
        }
        const a = accountsMap.get(key);
        const total = Number(r.total) || 0;
        const paid = Number(r.paid) || 0;
        const due = Math.max(total - paid, 0);
        a.total_invoiced += total;
        a.ledger_paid += paid;
        a.ledger_due += due;
        if (String(r.status) === "open") a.open_count += 1; else a.settled_count += 1;
        a.invoices.push(r);

        const invoiceDate = r.created_at || r.date || "";
        a.statement.push({
          date: invoiceDate,
          sortDate: String(invoiceDate).slice(0, 19),
          sortId: Number(r.id) || 0,
          reference: r.order_id ? "#" + r.order_id : (r.id ? "#" + r.id : "—"),
          description: "فاتورة آجل",
          debit: total,
          credit: 0,
          balance: 0
        });

        (Array.isArray(r.payments) ? r.payments : []).forEach(function (p) {
          const amount = Number(p.amount) || 0;
          a.actual_collected += amount;
          a.payments.push(p);
          a.statement.push({
            date: p.date || "",
            sortDate: String(p.date || "").slice(0, 19),
            sortId: 100000000 + (Number(p.id) || 0),
            reference: p.receipt_no || (p.id ? "#" + p.id : "—"),
            description: "تحصيل فعلي",
            debit: 0,
            credit: amount,
            balance: 0,
            method: p.method || ""
          });
        });
      });

      const accounts = Array.from(accountsMap.values());
      accounts.forEach(function (a) {
        a.total_invoiced = Number(a.total_invoiced.toFixed(2));
        a.ledger_paid = Number(a.ledger_paid.toFixed(2));
        a.ledger_due = Number(a.ledger_due.toFixed(2));
        a.actual_collected = Number(a.actual_collected.toFixed(2));
        a.remaining = Number(Math.max(a.total_invoiced - a.ledger_paid, 0).toFixed(2));
        a.reconciliation_difference = Number((a.ledger_paid - a.actual_collected).toFixed(2));
        a.statement.sort(function (x, y) { return x.sortDate.localeCompare(y.sortDate) || x.sortId - y.sortId; });
        let running = 0;
        a.statement.forEach(function (e) {
          running = Number((running + e.debit - e.credit).toFixed(2));
          e.balance = running;
        });
      });

      accounts.sort(function (a, b) { return b.remaining - a.remaining || a.customer_name.localeCompare(b.customer_name, "ar"); });
      window.__arCustomerAccounts = accounts;

      const summary = d.summary || {};
      const recon = Number(summary.total_invoiced || 0) - (Number(summary.total_paid || 0) + Number(summary.total_open_due || 0));
      const aging = {};
      (d.aging || []).forEach(function (x) { aging[x.bucket] = x; });
      const L = function (key, fallback) { try { return typeof t === "function" ? (t(key) || fallback) : fallback; } catch (_) { return fallback; } };

      c.innerHTML = `
        <div class="report-section">
          <div class="report-section-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">📒 كشف حساب الآجل <span style="font-weight:400;font-size:11px;color:var(--muted)">حتى ${esc(d.as_of || "")}</span></div>
          <div class="report-kpi">
            <div class="report-kpi-item"><div class="report-kpi-value">${money(summary.total_invoiced)}</div><div class="report-kpi-label">${L("rptTotalInvoiced","إجمالي الآجل")}</div></div>
            <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--success)">${money(summary.total_paid)}</div><div class="report-kpi-label">${L("rptTotalCollected","المسدّد")}</div></div>
            <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--danger)">${money(summary.total_open_due)}</div><div class="report-kpi-label">${L("rptOpenDue","الرصيد المتبقي")}</div></div>
            <div class="report-kpi-item"><div class="report-kpi-value">${accounts.length}</div><div class="report-kpi-label">عدد العملاء</div></div>
            <div class="report-kpi-item"><div class="report-kpi-value">${summary.open_count || 0}</div><div class="report-kpi-label">حسابات مفتوحة</div></div>
          </div>
          <div style="font-size:11px;color:var(--muted)">التسوية العامة: ${money(summary.total_invoiced)} = ${money(summary.total_paid)} + ${money(summary.total_open_due)}${Math.abs(recon) > 0.01 ? ` — فرق: <b style="color:var(--danger)">${money(recon)}</b>` : ""}</div>
        </div>

        <div class="report-section">
          <div class="report-section-title">👥 حساب كل عميل في كشف واحد (${accounts.length})</div>
          ${accounts.length ? accounts.map(function (a, idx) {
            const id = "ar-customer-" + idx;
            const diff = Math.abs(a.reconciliation_difference) > 0.01 ? `<span style="color:var(--warning)">فرق الدفتر/التحصيل: ${money(a.reconciliation_difference)}</span>` : "";
            return `<div style="border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden">
              <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--card);cursor:pointer;flex-wrap:wrap" onclick="toggleArCustomerStatement('${id}')">
                <b style="flex:1;min-width:180px">${esc(a.customer_name)}${a.phone ? " · " + esc(a.phone) : ""}</b>
                <span style="font-size:11px;color:var(--muted)">${a.invoices.length} فاتورة</span>
                <span style="font-size:11px">${a.open_count} مفتوح · ${a.settled_count} مسدد</span>
                <span style="font-size:11px;color:var(--success)">تحصيل: ${money(a.actual_collected)}</span>
                <span style="font-size:13px;color:var(--danger);font-weight:700">الرصيد: ${money(a.remaining)}</span>
                <button class="btn btn-sm" onclick="event.stopPropagation();printArCustomerStatement(${idx})">🖨️ طباعة</button>
                <span id="ar-arrow-${id}" style="font-size:11px">▼</span>
              </div>
              <div id="${id}" style="display:none;padding:8px">
                <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;margin:4px 0 8px">
                  <span>المدين: <b>${money(a.total_invoiced)}</b></span>
                  <span style="color:var(--success)">التحصيل الفعلي: <b>${money(a.actual_collected)}</b></span>
                  <span style="color:var(--danger);font-weight:700">الرصيد: <b>${money(a.remaining)}</b></span>
                  ${diff}
                </div>
                <table class="report-table">
                  <tr><th>التاريخ</th><th>المرجع</th><th>البيان</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr>
                  ${a.statement.length ? a.statement.map(function (e) {
                    return `<tr><td>${esc(e.date || "")}</td><td>${esc(e.reference || "")}</td><td>${esc(e.description || "")}${e.method ? " — " + esc(typeof methodName === "function" ? methodName(e.method) : e.method) : ""}</td><td>${e.debit ? money(e.debit) : "—"}</td><td style="color:var(--success)">${e.credit ? money(e.credit) : "—"}</td><td style="font-weight:700;color:${e.balance > 0 ? "var(--danger)" : "var(--success)"}">${money(e.balance)}</td></tr>`;
                  }).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--muted)">لا توجد حركات</td></tr>`}
                </table>
                <div style="font-size:11px;color:var(--muted);margin-top:6px">الفواتير تظهر مدين، والتحصيلات الفعلية تظهر دائن، والرصيد يتحرك بعد كل حركة.</div>
              </div>
            </div>`;
          }).join("") : `<p style="color:var(--muted)">لا توجد حسابات آجلة.</p>`}
        </div>

        <div class="report-section">
          <div class="report-section-title">💵 عمليات التحصيل في الفترة (${(d.payments || []).length})</div>
          <table class="report-table"><tr><th>#</th><th>التاريخ</th><th>العميل</th><th>المبلغ</th><th>الطريقة</th><th>الكاشير</th></tr>
            ${(d.payments || []).length ? d.payments.map(function (p) { return `<tr><td>#${p.id}</td><td>${esc(p.date || "")}</td><td>${esc(p.customer_name || "")}</td><td style="color:var(--success)">${money(p.amount)}</td><td>${esc(typeof methodName === "function" ? methodName(p.method) : (p.method || ""))}</td><td>${esc(p.employee || "")}</td></tr>`; }).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--muted)">لا توجد تحصيلات في الفترة</td></tr>`}
          </table>
        </div>`;
    } catch (e) {
      c.innerHTML = `<span style="color:var(--danger)">❌ ${esc(e.message || e)}</span>`;
    }
  };

  window.toggleArCustomerStatement = function (id) {
    const el = document.getElementById(id);
    const arrow = document.getElementById("ar-arrow-" + id);
    if (!el) return;
    const show = el.style.display === "none";
    el.style.display = show ? "" : "none";
    if (arrow) arrow.textContent = show ? "▲" : "▼";
  };
})();