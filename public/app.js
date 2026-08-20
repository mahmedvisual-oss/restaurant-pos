/* PRINT_POPUP_TRACE */
(function () {
  const originalOpen = window.open;
  window.open = function () {
    console.error("PRINT_POPUP_TRACE: window.open CALLED", new Error().stack);
    return originalOpen.apply(this, arguments);
  };
})();
let MENU = [];
let CATEGORY_ORDER = {};
let cart = [];
let selectedTable = null;
let currentCategory = "__ALL__";
let discount = 0;
let user = null;
let existingOrderId = null;
let payMethod = "نقدي";
let managerCallback = null;
let managerPinEntered = "";
let TAX_RATE = 0.03;
let splitInvoices = null;   // null = لا تقسيم; array = فواتير مستقلة
let splitCurrent = 0;       // الفاتورة النشطة في وضع التقسيم

function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

let CURRENCY = "ر.س";
let RESTAURANT_NAME = "مطعم الذوق الرفيع";
let promoDiscount = 0;
let promoCode = "";
const SIZE_LEVELS = ["sm", "md", "lg", "xl"];
const SIZE_LABELS = { sm: "100%", md: "115%", lg: "125%", xl: "140%" };
let uiSize = "sm";
let uiTheme = "dark";
const TABLE_SECTION_NAMES = {
  family: "العائلات",
  families: "العائلات",
  "family-room": "العائلات",
  "family_room": "العائلات",
  عائلات: "العائلات",
  العائلات: "العائلات",
  vip: "VIP",
  hall: "الصالة",
  main: "الصالة",
  dining: "الصالة",
  restaurant: "الصالة",
  الصالة: "الصالة",
  takeaway: "تيك أواي",
  "take-away": "تيك أواي",
  "take_away": "تيك أواي",
  تيك_أواي: "تيك أواي",
};

function tableSectionLabel(tb) {
  if (!tb) return "";
  const raw = tb.section_name ?? tb.sectionName ?? tb.section ?? tb.area_name ?? tb.area ?? tb.group ?? tb.room ?? "";
  if (!raw) return "";
  const key = String(raw).trim().toLowerCase();
  return TABLE_SECTION_NAMES[key] || TABLE_SECTION_NAMES[String(raw).trim()] || String(raw).trim();
}

function applyUiPrefs() {
  uiTheme = localStorage.getItem("pos_theme") || "dark";
  uiSize = localStorage.getItem("pos_size") || "sm";
  document.documentElement.setAttribute("data-theme", uiTheme);
  document.documentElement.setAttribute("data-size", uiSize);
  const tb = document.getElementById("btn-theme");
  if (tb) tb.textContent = uiTheme === "dark" ? "☀️" : "🌙";
  const sl = document.getElementById("size-label");
  if (sl) sl.textContent = SIZE_LABELS[uiSize] || "100%";
  applyLang();
  updateLangBtn();
  renderTables();
  updateStats();
  renderCats();
  renderMenu();
  renderCart();
}

function updateLangBtn() {
  const lb = document.getElementById("btn-lang");
  if (lb) lb.textContent = currentLang === "id" ? "🇮🇩" : (currentLang === "en" ? "🇬🇧" : "🇸🇦");
}

function toggleLangDropdown() {
  document.getElementById("lang-menu").classList.toggle("show");
}

function closeLangDropdown() {
  const menu = document.getElementById("lang-menu");
  if (!menu.classList.contains("show")) return;
  menu.classList.remove("show");
  applyLang();
  updateLangBtn();
  renderTables();
  updateStats();
  renderCats();
  renderMenu();
  renderCart();
  updateUserBar();
}

document.addEventListener("click", function(e) {
  if (!document.getElementById("lang-dropdown").contains(e.target)) closeLangDropdown();
  if (!document.getElementById("size-dropdown").contains(e.target)) closeSizeDropdown();
  if (!document.getElementById("discount-dropdown").contains(e.target)) closeDiscountDropdown();
  if (!document.getElementById("manager-dropdown").contains(e.target)) closeManagerDropdown();
});

// اختصارات لوحة المفاتيح
document.addEventListener("keydown", function(e) {
  if (!user) return;
  // لا تعمل إذا المستخدم يكتب في حقل إدخال
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
  switch(e.key) {
    case "F1": e.preventDefault(); showReports(); break;
    case "F2": e.preventDefault(); showMenuManager(); break;
    case "F3": e.preventDefault(); document.getElementById("search").focus(); break;
    case "F4": e.preventDefault(); showPayment(); break;
    case "F5": e.preventDefault(); saveOrder(); break;
    case "F6": e.preventDefault(); sendToKitchen(); break;
    case "F7": e.preventDefault(); clearCart(); break;
    case "F8": e.preventDefault(); showTransferModal(); break;
    case "F9": e.preventDefault(); showSplitModal(); break;
    case "F11": e.preventDefault(); toggleTheme(); break;
    case "Escape":
      // إغلاق أي نافذة مفتوحة
      document.querySelectorAll(".modal.show").forEach(m => { m.classList.remove("show"); });
      break;
  }
});

function toggleTheme() {
  uiTheme = uiTheme === "dark" ? "light" : "dark";
  localStorage.setItem("pos_theme", uiTheme);
  applyUiPrefs();
}

function setSize(s) {
  uiSize = s;
  localStorage.setItem("pos_size", uiSize);
  applyUiPrefs();
}

function toggleSizeDropdown() {
  document.getElementById("size-menu").classList.toggle("show");
}

function closeSizeDropdown() {
  document.getElementById("size-menu").classList.remove("show");
}

const CAT_COLORS = {
  "مشروبات": "#06b6d4",
  "أطباق رئيسية": "#f97316",
  "مقبلات": "#10b981",
  "حلويات": "#ec4899",
};

function fmt(n) {
  const v = parseFloat(n) || 0;
  if (CURRENCY === "Rp") {
    return Math.round(v).toLocaleString("id-ID");
  }
  return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtCur(n) {
  const v = parseFloat(n) || 0;
  if (CURRENCY === "Rp") {
    return "Rp " + Math.round(v).toLocaleString("id-ID");
  }
  return v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + CURRENCY;
}

const METHOD_NAMES = {
  "نقدي": { ar: "نقدي", en: "Cash", id: "Tunai" },
  "آجل": { ar: "آجل", en: "Credit", id: "Kredit" },
  "مانديري": { ar: "مانديري", en: "Mandiri", id: "Mandiri" },
  "BCA": { ar: "BCA", en: "BCA", id: "BCA" },
  "كيروس": { ar: "QRIS", en: "QRIS", id: "QRIS" },
};

const METHOD_SYNONYMS = {
  "نقداً": "نقدي",
  "تحويل BCA": "BCA",
  "تحويل مانديري": "مانديري",
  "Transfer BCA": "BCA",
  "Transfer Mandiri": "مانديري",
};

const TRANSFER_METHODS = new Set(["BCA", "مانديري", "كيروس"]);

function methodName(m) {
  if (!m) return "—";
  const key = METHOD_SYNONYMS[m] || m;
  const e = METHOD_NAMES[key];
  if (!e) return m;
  return e[currentLang] || e.ar || m;
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

function openModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }

async function api(url, opts = {}) {
  const headers = {
    ...(opts.headers || {})
  };

  if (opts.body && typeof opts.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const r = await fetch(url, {
    credentials: "same-origin",
    ...opts,
    headers
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(terr(d.error || t("err.generic")));
  return d;
}

function terr(msg) {
  const m = String(msg || "");
  const map = {
    "سجل الدخول أولاً": "err.loginFirst",
    "متاح للمدير فقط": "err.managerOnly",
    "PIN غير صحيح": "err.wrongPin",
    "PIN المدير غير صحيح": "err.wrongManagerPin",
    "الاسم ورقم PIN مطلوبان": "err.namePinRequired",
    "PIN يجب أن يكون 4 أرقام على الأقل": "err.pinMin4",
    "موظف غير موجود": "err.employeeNotFound",
    "لا يمكنك تعطيل حسابك الخاص": "err.cannotDisableSelf",
    "يجب بقاء مدير واحد نشط على الأقل": "err.needManager",
    "لا يمكنك حذف حسابك الخاص": "err.cannotDeleteSelf",
    "نسبة الضريبة بين 0 و 1 (مثال 0.15)": "err.invalidTax",
    "نسبة ضريبة غير صالحة": "err.invalidTaxValue",
    "اختر ملف نسخة احتياطية (.db)": "err.selectBackupFile",
    "الملف ليس قاعدة بيانات SQLite صالحة": "err.invalidBackup",
    "قاعدة البيانات تالفة أو غير مكتملة": "err.corruptedBackup",
    "تعذر فتح الملف": "err.cannotOpenFile",
    "اليوم مغلق بالفعل": "err.dayAlreadyClosed",
    "النسخة غير موجودة": "err.backupNotFound",
    "اسم ملف غير صالح": "err.invalidFileName",
    "غير مسجل": "err.notLoggedIn",
    "اختر طاولة وأضف أصنافاً": "err.selectTableAndItems",
    "الاسم مطلوب": "err.nameRequired",
    "أدخل اسم الصنف": "toast.enterItemName",
    "كود غير صالح": "err.promoInvalid",
    "تم استخدام هذا الكود بالفعل": "err.promoMaxUses",
    "انتهت صلاحية الكود": "err.promoExpired",
    "الحد الأدنى للطلب": "err.promoMinOrder",
    "النسخة تالفة": "err.invalidBackup",
    "تعذر فتح النسخة": "err.cannotOpenFile",
    "تعذر قراءة الملف": "err.cannotOpenFile",
    "رقم الهاتف مسجّل لعميل آخر": "custPhoneExists",
  };
  if (map[m]) return t(map[m]);
  if (m.indexOf("المبلغ المدفوع أقل من الإجمالي") === 0) return t("err.notEnough");
  if (m.indexOf("الحد الأدنى للطلب") === 0) return t("err.promoMinOrder") + " " + m.replace("الحد الأدنى للطلب", "").trim();
  return m;
}

function logAudit(action, details) {
  api("/api/audit/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, details })
  }).catch(() => {});
}

// ===== تسجيل الدخول / الخروج =====
async function loadEmployees() {
  try {
    const emps = await api("/api/employees");
    const sel = document.getElementById("login-employee");
    sel.innerHTML = emps.map(e => `<option value="${e.id}">${e.name} — ${e.role === "manager" ? t("managerRole") : t("cashierRole")}</option>`).join("");
  } catch (e) { toast(e.message); }
}

async function doLogin() {
  const employee_id = parseInt(document.getElementById("login-employee").value);
  const pin = document.getElementById("login-pin").value;
  if (!pin) { document.getElementById("login-error").textContent = t("toast.enterPin"); return; }
  try {
    const d = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id, pin })
    });
    user = d.user;
    document.getElementById("login-error").textContent = "";
    document.getElementById("login-pin").value = "";
    document.getElementById("login-overlay").style.display = "none";
    updateUserBar();
    startDayReminderPolling();
    const b = window.__boot;
    if (b && b.tables) {
      tableData = {};
      for (const t of b.tables) tableData[t.id] = t;
      renderTables();
      updateStats();
    } else {
      loadTables();
    }
    if (b && b.settings) {
      const s = b.settings;
      CURRENCY = s.currency;
      TAX_RATE = s.tax_rate;
      RESTAURANT_NAME = s.restaurant_name;
      const set1 = document.getElementById("set-name");
      if (set1) set1.value = RESTAURANT_NAME;
      const set2 = document.getElementById("set-tax");
      if (set2) set2.value = TAX_RATE;
      const set3 = document.getElementById("set-currency");
      if (set3) set3.value = CURRENCY;
    }
    loadReports();
  } catch (e) { document.getElementById("login-error").textContent = e.message; }
}
