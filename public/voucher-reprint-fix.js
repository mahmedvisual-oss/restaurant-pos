/* Credit settlement print fix
 * The settlement API is correct. The bug was UI-only: settleCredit() waited
 * for the async API response before calling window.open(), so browsers could
 * block the new receipt window and the old reprint flow appeared instead.
 * Keep the existing app.js report/reprint features, but replace settleCredit
 * with a user-activated popup that is populated after the API returns.
 */
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
    if (window.__creditSettlementPrintFixed) return true;
    window.__creditSettlementPrintFixed = true;

    window.settleCredit = async function (lid, total, paid) {
      const input = document.getElementById("credit-pay-" + lid);
      if (!input) return;

      const amount = parseFloat(input.value) || 0;
      const rem = Number(total || 0) - Number(paid || 0);
      if (amount <= 0) {
        toast(t("rptEnterValidAmount"));
        return;
      }
      if (amount > rem + 0.001) {
        toast(t("rptAmountExceeds", { amt: fmtCur(rem) }));
        return;
      }

      const methodEl = document.getElementById("credit-pay-method-" + lid);
      const method = methodEl ? methodEl.value : "نقدي";

      // IMPORTANT: open synchronously from the click, before awaiting fetch().
      const w = window.open("", "credit-voucher-new", "width=340,height=650");
      if (w) {
        w.document.write("<!doctype html><html><body style='font-family:Segoe UI,Tahoma,sans-serif;text-align:center;padding:30px'>" + esc(t("rptLoading")) + "</body></html>");
        w.document.close();
      }

      try {
        const res = await api("/api/credit/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ledger_id: lid, amount, method })
        });

        if (!res.receipt) throw new Error("لم يتم إنشاء سند القبض");
        const r = res.receipt;
        const methodN = METHOD_NAMES[r.method]
          ? (METHOD_NAMES[r.method][currentLang] || METHOD_NAMES[r.method].ar)
          : (r.method || "نقدي");
        const name = typeof RESTAURANT_NAME !== "undefined" ? RESTAURANT_NAME : "POS";
        const dir = document.documentElement.dir || "rtl";

        const html = "<!doctype html><html dir='" + esc(dir) + "'><head><meta charset='utf-8'><title>" + esc(r.receipt_no) + "</title>" +
          "<style>body{font-family:Segoe UI,Tahoma,sans-serif;width:300px;margin:0 auto;text-align:center;font-size:13px;color:#000}.dash{border-top:1px dashed #000;margin:8px 0}table{width:100%;border-collapse:collapse}td{padding:5px 0}.l{text-align:left}.r{text-align:right}.amount{font-size:20px;font-weight:bold}@media print{body{margin:0}}</style></head><body>" +
          "<img src='/logo.png' style='width:35px;height:35px'><h3 style='margin:4px 0'>" + esc(name) + "</h3>" +
          "<div style='font-weight:bold;font-size:16px'>🧾 " + esc(t("creditVoucher")) + "</div>" +
          "<div class='dash'></div><table>" +
          "<tr><td class='r'>" + esc(t("dvReceiptNo")) + "</td><td class='l'><b>" + esc(r.receipt_no) + "</b></td></tr>" +
          "<tr><td class='r'>" + esc(t("dvPCustomer")) + "</td><td class='l'>" + esc(r.customer_name || "—") + "</td></tr>" +
          (r.phone ? "<tr><td class='r'>" + esc(t("dvPPhone")) + "</td><td class='l'>" + esc(r.phone) + "</td></tr>" : "") +
          "<tr><td class='r'>" + esc(t("dvPDate")) + "</td><td class='l'>" + esc(r.date || "") + "</td></tr>" +
          "<tr><td class='r'>" + esc(t("dvPCashier")) + "</td><td class='l'>" + esc(r.employee || "") + "</td></tr>" +
          "<tr><td class='r'>" + esc(t("dvPMethod")) + "</td><td class='l'>" + esc(methodN) + "</td></tr></table>" +
          "<div class='dash'></div><div>" + esc(t("paidAmount")) + "</div><div class='amount'>" + esc(fmtCur(r.amount)) + "</div>" +
          "<div class='dash'></div><div style='font-size:11px;color:#555'>" + esc(t("thanks")) + "</div></body></html>";

        if (w && !w.closed) {
          w.document.open();
          w.document.write(html);
          w.document.close();
          setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 100);
        } else {
          // If the browser blocked the popup, fall back to the existing receipt renderer.
          if (typeof printCreditReceipt === "function") printCreditReceipt(r);
        }

        input.value = "";
        if (typeof loadCreditReport === "function") await loadCreditReport();
        toast("✅ " + (res.status === "settled" ? t("rptFullySettled") : t("rptRemainingNow", { amt: fmtCur(res.remaining) })) + " — " + t("rptReceiptNo") + " " + r.receipt_no);
      } catch (e) {
        if (w && !w.closed) w.close();
        toast("❌ " + (e.message || e));
      }
    };

    return true;
  }

  let tries = 0;
  const timer = setInterval(function () {
    tries += 1;
    if (install() || tries >= 40) clearInterval(timer);
  }, 100);
  install();
})();
