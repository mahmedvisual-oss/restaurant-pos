/* Credit settlement UI fix
 * The API now creates the deposit voucher and linked credit payment atomically.
 * The old settleCredit() opened the print window only AFTER awaiting the API,
 * which loses the browser's user-activation and can trigger the reprint/popup
 * fallback instead of showing the newly created receipt.
 *
 * This file is intentionally standalone. It wraps settleCredit() and opens the
 * print window before the async request, then renders the NEW receipt in that
 * already-authorized window.
 */
(function () {
  "use strict";

  function boot() {
    if (typeof window.settleCredit !== "function" || window.__creditSettleUiFixed) return;
    window.__creditSettleUiFixed = true;

    const originalSettleCredit = window.settleCredit;

    window.settleCredit = async function (lid, total, paid) {
      const input = document.getElementById("credit-pay-" + lid);
      if (!input) return;

      const amount = parseFloat(input.value) || 0;
      const rem = Number(total || 0) - Number(paid || 0);
      if (amount <= 0) {
        if (typeof toast === "function") toast(t("rptEnterValidAmount"));
        return;
      }
      if (amount > rem + 0.001) {
        if (typeof toast === "function") toast(t("rptAmountExceeds", { amt: fmtCur(rem) }));
        return;
      }

      const methodEl = document.getElementById("credit-pay-method-" + lid);
      const method = methodEl ? methodEl.value : "نقدي";

      // Open synchronously from the user's click. This preserves popup permission.
      const printWindow = window.open("", "credit-receipt-new", "width=340,height=650");
      if (printWindow) {
        printWindow.document.write("<!doctype html><html><body style='font-family:Segoe UI,Tahoma,sans-serif;text-align:center;padding:30px'>جاري تجهيز سند القبض...</body></html>");
        printWindow.document.close();
      }

      try {
        const res = await api("/api/credit/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ledger_id: lid, amount, method })
        });

        const receipt = res.receipt;
        if (!receipt) throw new Error("لم يتم إنشاء سند القبض");

        if (typeof toast === "function") {
          toast("✅ " + (res.status === "settled"
            ? t("rptFullySettled")
            : t("rptRemainingNow", { amt: fmtCur(res.remaining) }))
            + " — " + t("rptReceiptNo") + " " + receipt.receipt_no);
        }

        if (printWindow && !printWindow.closed) {
          const dir = document.documentElement.dir || "rtl";
          const name = typeof RESTAURANT_NAME !== "undefined" ? RESTAURANT_NAME : "POS";
          const methodN = typeof METHOD_NAMES !== "undefined" && METHOD_NAMES[receipt.method]
            ? (METHOD_NAMES[receipt.method][currentLang] || METHOD_NAMES[receipt.method].ar)
            : (receipt.method || "نقدي");
          const esc = typeof escapeHtml === "function"
            ? escapeHtml
            : (v) => String(v == null ? "" : v).replace(/[&<>\"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));

          printWindow.document.open();
          printWindow.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(t("creditVoucher"))} ${esc(receipt.receipt_no)}</title><style>
            body{font-family:'Segoe UI',Tahoma,sans-serif;width:300px;margin:0 auto;text-align:center;font-size:13px;color:#000}
            h3{margin:4px 0}.muted{font-size:11px;color:#555}.dash{border-top:1px dashed #000;margin:7px 0}
            table{width:100%;border-collapse:collapse}td{padding:4px 0}.right{text-align:${dir === "rtl" ? "right" : "left"}}.left{text-align:${dir === "rtl" ? "left" : "right"}}
            .badge{background:#2563eb;color:#fff;display:inline-block;padding:3px 12px;border-radius:4px;font-size:14px;font-weight:bold;margin:4px 0}
            .summary{background:#eff6ff;border:1px solid #93c5fd;border-radius:4px;padding:8px;margin:7px 0}.amount{font-size:20px;font-weight:bold;color:#2563eb}
            @media print{body{margin:0}}
          </style></head><body>
            <h3>${esc(name)}</h3><div class="muted">${esc(t("appSubtitle"))}</div>
            <div class="badge">💵 ${esc(t("creditVoucher"))}</div>
            <div class="muted">${esc(t("dvReceiptNo"))}: <b>${esc(receipt.receipt_no)}</b></div>
            <div class="dash"></div>
            <table>
              <tr><td class="right">${esc(t("dvPCustomer"))}</td><td class="left">${esc(receipt.customer_name || "—")}</td></tr>
              ${receipt.phone ? `<tr><td class="right">${esc(t("dvPPhone"))}</td><td class="left">${esc(receipt.phone)}</td></tr>` : ""}
              ${receipt.ledger_id ? `<tr><td class="right">${esc(t("custInvoice"))}</td><td class="left">#${esc(receipt.ledger_id)}</td></tr>` : ""}
              <tr><td class="right">${esc(t("dvPDate"))}</td><td class="left">${esc(receipt.date || "")}</td></tr>
              <tr><td class="right">${esc(t("dvPCashier"))}</td><td class="left">${esc(receipt.employee || "")}</td></tr>
            </table>
            <div class="dash"></div>
            <div class="summary"><table><tr><td class="right">${esc(t("paidAmount"))}</td><td class="left amount">${esc(fmtCur(receipt.amount))}</td></tr><tr><td class="right">${esc(t("dvPMethod"))}</td><td class="left">${esc(methodN)}</td></tr></table></div>
            <div class="dash"></div><div class="muted">${esc(t("thanks"))}</div>
          </body></html>`);
          printWindow.document.close();
          setTimeout(() => { try { printWindow.focus(); printWindow.print(); } catch (e) { console.error(e); } }, 100);
        } else if (typeof printCreditReceipt === "function") {
          // Popup blocked: keep the existing fallback behavior.
          printCreditReceipt(receipt);
        }

        input.value = "";
        if (typeof loadCreditReport === "function") await loadCreditReport();
      } catch (e) {
        if (printWindow && !printWindow.closed) printWindow.close();
        if (typeof toast === "function") toast("❌ " + (e.message || e));
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
    setTimeout(boot, 0);
  } else {
    boot();
  }
})();
