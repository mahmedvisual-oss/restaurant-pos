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
        const res = await api("/api/credit/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ledger_id: lid, amount, method })
        });
        if (!res.receipt) throw new Error("لم يتم إنشاء سند القبض");

        const r = res.receipt;
        const methodN = (typeof METHOD_NAMES !== "undefined" && METHOD_NAMES[r.method])
          ? (METHOD_NAMES[r.method][currentLang] || METHOD_NAMES[r.method].ar)
          : (r.method || "نقدي");
        const name = typeof RESTAURANT_NAME !== "undefined" ? RESTAURANT_NAME : "POS";
        const dir = document.documentElement.dir || "rtl";

        // Render inside the current POS page. No window.open(), no popup blocker.
        let box = document.getElementById("credit-settlement-receipt-modal");
        if (!box) {
          box = document.createElement("div");
          box.id = "credit-settlement-receipt-modal";
          document.body.appendChild(box);
        }
        box.innerHTML = "<div style='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px'>" +
          "<div id='credit-settlement-receipt-print' dir='" + esc(dir) + "' style='background:#fff;color:#000;width:340px;max-width:95vw;padding:18px;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.3);font-family:Segoe UI,Tahoma,sans-serif;text-align:center'>" +
          "<img src='/logo.png' style='width:38px;height:38px'><h3 style='margin:5px 0'>" + esc(name) + "</h3>" +
          "<div style='font-weight:bold;font-size:18px'>🧾 " + esc(t("creditVoucher")) + "</div>" +
          "<hr><table style='width:100%;border-collapse:collapse;font-size:13px'>" +
          "<tr><td style='text-align:right;padding:5px'>" + esc(t("dvReceiptNo")) + "</td><td style='text-align:left;padding:5px'><b>" + esc(r.receipt_no) + "</b></td></tr>" +
          "<tr><td style='text-align:right;padding:5px'>" + esc(t("dvPCustomer")) + "</td><td style='text-align:left;padding:5px'>" + esc(r.customer_name || "—") + "</td></tr>" +
          (r.phone ? "<tr><td style='text-align:right;padding:5px'>" + esc(t("dvPPhone")) + "</td><td style='text-align:left;padding:5px'>" + esc(r.phone) + "</td></tr>" : "") +
          "<tr><td style='text-align:right;padding:5px'>" + esc(t("dvPDate")) + "</td><td style='text-align:left;padding:5px'>" + esc(r.date || "") + "</td></tr>" +
          "<tr><td style='text-align:right;padding:5px'>" + esc(t("dvPMethod")) + "</td><td style='text-align:left;padding:5px'>" + esc(methodN) + "</td></tr></table>" +
          "<hr><div style='font-size:13px'>" + esc(t("paidAmount")) + "</div><div style='font-size:23px;font-weight:bold;margin:5px 0 12px'>" + esc(fmtCur(r.amount)) + "</div>" +
          "<div style='display:flex;gap:8px;justify-content:center'><button id='credit-receipt-print-btn' style='padding:9px 18px;cursor:pointer'>🖨️ " + esc(t("print")) + "</button><button id='credit-receipt-close-btn' style='padding:9px 18px;cursor:pointer'>✕ " + esc(t("close")) + "</button></div>" +
          "</div></div>";

        document.getElementById("credit-receipt-close-btn").onclick = function () { box.innerHTML = ""; };
        document.getElementById("credit-receipt-print-btn").onclick = function () {
          const printable = document.getElementById("credit-settlement-receipt-print");
          const old = document.body.innerHTML;
          document.body.innerHTML = printable.outerHTML;
          window.print();
          document.body.innerHTML = old;
          window.location.reload();
        };

        input.value = "";
        if (typeof loadCreditReport === "function") await loadCreditReport();
        toast("✅ " + (res.status === "settled" ? t("rptFullySettled") : t("rptRemainingNow", { amt: fmtCur(res.remaining) })) + " — " + t("rptReceiptNo") + " " + r.receipt_no);
      } catch (e) {
        toast("❌ " + (e.message || e));
      }
    };
    return true;
  }

  let tries = 0;
  const timer = setInterval(function () {
    tries += 1;
    if (install() || tries >= 60) clearInterval(timer);
  }, 100);
  install();
})();
