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

  // Load the non-recursive UI language runtime after app.js has initialized.
  if (!document.querySelector('script[data-pos-ui-language="1"]')) {
    const s = document.createElement("script");
    s.src = "/ui-language-runtime.js?v=1";
    s.dataset.posUiLanguage = "1";
    s.async = false;
    document.head.appendChild(s);
  }

  // Mobile language switcher: keep language selection available on small screens.
  function installMobileLanguageSwitcher() {
    const nav = document.getElementById("mobile-nav");
    if (!nav || nav.querySelector("#mobile-language-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "mobile-language-btn";
    btn.className = "mobile-nav-btn";
    btn.setAttribute("aria-label", "Language");
    btn.innerHTML = "🌐<span>Language</span>";
    btn.onclick = function () {
      const menu = document.getElementById("mobile-language-menu");
      if (menu) menu.classList.toggle("show");
    };
    nav.appendChild(btn);

    const menu = document.createElement("div");
    menu.id = "mobile-language-menu";
    menu.innerHTML = [
      '<button type="button" data-lang="id">🇮🇩 Bahasa Indonesia</button>',
      '<button type="button" data-lang="en">🇬🇧 English</button>',
      '<button type="button" data-lang="ar">🇸🇦 العربية</button>'
    ].join("");
    menu.addEventListener("click", function (event) {
      const choice = event.target.closest("button[data-lang]");
      if (!choice || typeof window.setLang !== "function") return;
      window.setLang(choice.dataset.lang);
      menu.classList.remove("show");
    });
    document.body.appendChild(menu);

    const mobileLangStyle = document.createElement("style");
    mobileLangStyle.textContent = `
      #mobile-language-menu { display:none; position:fixed; left:10px; right:10px; bottom:76px; z-index:10000; padding:8px; border:1px solid var(--border,#444); border-radius:14px; background:var(--card,#222); box-shadow:0 8px 30px rgba(0,0,0,.35); }
      #mobile-language-menu.show { display:grid; gap:6px; }
      #mobile-language-menu button { width:100%; min-height:44px; border:1px solid var(--border,#444); border-radius:10px; background:var(--input,#333); color:var(--text,#fff); font:inherit; cursor:pointer; }
      @media (min-width:769px) { #mobile-language-btn, #mobile-language-menu { display:none !important; } }
    `;
    document.head.appendChild(mobileLangStyle);

    const syncLabel = function () {
      const current = window.currentLang || document.documentElement.lang || "id";
      const labels = { id: "Bahasa", en: "English", ar: "العربية" };
      const span = btn.querySelector("span");
      if (span) span.textContent = labels[current] || "Language";
    };
    syncLabel();
    document.addEventListener("click", function (event) {
      if (!menu.contains(event.target) && event.target !== btn && !btn.contains(event.target)) menu.classList.remove("show");
    });
    window.setTimeout(syncLabel, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installMobileLanguageSwitcher);
  } else {
    installMobileLanguageSwitcher();
  }
})();
