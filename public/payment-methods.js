/* POS payment methods — separate accounting categories */
(function () {
  "use strict";

  const PAYMENT_METHODS = {
    credit_bca: "بطاقة ائتمان - BCA",
    credit_mandiri: "بطاقة ائتمان - Mandiri",
    debit_bca: "بطاقة خصم - BCA",
    debit_mandiri: "بطاقة خصم - Mandiri",
    wallet_gopay: "محفظة - GoPay",
    wallet_ovo: "محفظة - OVO",
    wallet_dana: "محفظة - DANA",
    wallet_shopeepay: "محفظة - ShopeePay",
    wallet_linkaja: "محفظة - LinkAja",
    bank_bca: "تحويل بنكي - BCA",
    bank_mandiri: "تحويل بنكي - Mandiri",
    bank_other: "تحويل بنكي - بنك آخر"
  };

 function paymentLabel(key, fallback) {
    return (typeof t === "function") ? t(key) : fallback;
}

const LABELS = {
    credit: "💳 " + (typeof t === "function" ? t("creditCard") : "بطاقة ائتمان"),
    debit: "🏧 " + (typeof t === "function" ? t("debitCard") : "بطاقة خصم"),
    wallet: "📱 " + (typeof t === "function" ? t("wallet") : "محفظة إلكترونية"),
    bank: "💸 " + (typeof t === "function" ? t("bankTransfer") : "تحويل بنكي")
};

  Object.assign(window.__POS_PAYMENT_METHODS__ || (window.__POS_PAYMENT_METHODS__ = {}), PAYMENT_METHODS);

  function optionButtons(items) {
    return items.map(function (item) {
      return '<button type="button" class="pay-method payment-submethod" data-method="' + item.value + '" onclick="setPayMethod(this)">' + item.label + '</button>';
    }).join("");
  }

  function enhancePaymentMethods() {
    const box = document.getElementById("pay-methods");
    if (!box || box.dataset.expanded === "1") return;
    box.innerHTML = [
      '<button type="button" class="pay-method selected" data-method="نقدي" data-i18n="cash" onclick="setPayMethod(this)">💵 ' + paymentLabel("cash", "نقداً") + '</button>',
      '<button type="button" class="pay-method" data-method="آجل" data-i18n="credit" onclick="setPayMethod(this)">📝 ' + paymentLabel("credit", "آجل") + '</button>',
      '<button type="button" class="pay-method" data-method="كيروس" data-i18n="kiros" onclick="setPayMethod(this)">🧾 ' + paymentLabel("kiros", "كيروس") + '</button>',
      '<div class="payment-method-group"><button type="button" class="pay-method payment-group" onclick="togglePaymentGroup(this)">' + LABELS.credit + ' ▾</button><div class="payment-submethods">' + optionButtons([{ value: PAYMENT_METHODS.credit_bca, label: "🏦 BCA" }, { value: PAYMENT_METHODS.credit_mandiri, label: "💳 Mandiri" }]) + '</div></div>',
      '<div class="payment-method-group"><button type="button" class="pay-method payment-group" onclick="togglePaymentGroup(this)">' + LABELS.debit + ' ▾</button><div class="payment-submethods">' + optionButtons([{ value: PAYMENT_METHODS.debit_bca, label: "🏦 BCA" }, { value: PAYMENT_METHODS.debit_mandiri, label: "💳 Mandiri" }]) + '</div></div>',
      '<div class="payment-method-group"><button type="button" class="pay-method payment-group" onclick="togglePaymentGroup(this)">' + LABELS.wallet + ' ▾</button><div class="payment-submethods">' + optionButtons([{ value: PAYMENT_METHODS.wallet_gopay, label: "GoPay" }, { value: PAYMENT_METHODS.wallet_ovo, label: "OVO" }, { value: PAYMENT_METHODS.wallet_dana, label: "DANA" }, { value: PAYMENT_METHODS.wallet_shopeepay, label: "ShopeePay" }, { value: PAYMENT_METHODS.wallet_linkaja, label: "LinkAja" }]) + '</div></div>',
      '<div class="payment-method-group"><button type="button" class="pay-method payment-group" onclick="togglePaymentGroup(this)">' + LABELS.bank + ' ▾</button><div class="payment-submethods">' + optionButtons([{ value: PAYMENT_METHODS.bank_bca, label: "🏦 BCA" }, { value: PAYMENT_METHODS.bank_mandiri, label: "💳 Mandiri" }, { value: PAYMENT_METHODS.bank_other, label: "🏦 بنك آخر" }]) + '</div></div>'
    ].join("");
    box.dataset.expanded = "1";
  }

  window.togglePaymentGroup = function (button) {
    const group = button && button.closest ? button.closest(".payment-method-group") : null;
    if (!group) return;
    document.querySelectorAll("#pay-methods .payment-method-group.open").forEach(function (g) { if (g !== group) g.classList.remove("open"); });
    group.classList.toggle("open");
  };

  if (typeof window.setPayMethod === "function") {
    const originalSetPayMethod = window.setPayMethod;
    window.setPayMethod = function (el) {
      originalSetPayMethod(el);
      document.querySelectorAll("#pay-methods .payment-method-group").forEach(function (g) { g.classList.remove("open"); });
    };
  }

  if (typeof window.showPayment === "function") {
    const originalShowPayment = window.showPayment;
    window.showPayment = function () { originalShowPayment.apply(this, arguments); enhancePaymentMethods(); };
  }

  window.__enhancePaymentMethods = enhancePaymentMethods;

  const style = document.createElement("style");
  style.textContent = `
    #pay-methods .payment-method-group { display:block; margin-top:6px; }
    #pay-methods .payment-group { width:100%; text-align:center; }
    #pay-methods .payment-submethods { display:none; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; margin-top:5px; }
    #pay-methods .payment-method-group.open .payment-submethods { display:grid; }
    #pay-methods .payment-submethod { width:100%; }
    #pay-methods .payment-method-group.open > .payment-group { border-color:var(--accent,#f59e0b); }
    @media (max-width:520px) { #pay-methods .payment-submethods { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);

  document.addEventListener("DOMContentLoaded", function () { enhancePaymentMethods(); });

  // Unified reporting: cashier thermal close + manager full report.
  if (!document.querySelector('script[data-unified-reports="1"]')) {
    const s = document.createElement("script");
    s.src = "/professional-reports-v2.js?v=1";
    s.dataset.unifiedReports = "1";
    s.async = false;
    document.head.appendChild(s);
  }
})();
