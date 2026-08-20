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
        document.getElementById("credit-receipt-print-btn").onclick = function () { const printable = document.getElementById("credit-settlement-receipt-print"); const old = document.body.innerHTML; document.body.innerHTML = printable.outerHTML; window.print(); document.body.innerHTML = old; window.location.reload(); };
        input.value = "";
        if (typeof loadCreditReport === "function") await loadCreditReport();
        toast("✅ " + (res.status === "settled" ? t("rptFullySettled") : t("rptRemainingNow", { amt: fmtCur(res.remaining) })) + " — " + t("rptReceiptNo") + " " + r.receipt_no);
      } catch (e) { toast("❌ " + (e.message || e)); }
    };

    // ===== نافذة نقل / دمج الطلب =====
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
        const res = await api("/api/order/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_table: Number(selectedTable), to_table: Number(toTable) }) });
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
})();