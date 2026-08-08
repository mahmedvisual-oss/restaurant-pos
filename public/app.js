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
  document.getElementById("lang-menu").classList.remove("show");
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
  "كيروس": { ar: "كيروس", en: "Kiros", id: "Kiros" },
};

function methodName(m) {
  if (!m) return "—";
  const e = METHOD_NAMES[m];
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

async function api(url, opts) {
  const r = await fetch(url, opts);
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
    loadTables();
    loadSettings();
    checkCancelRequests();
    toast(t("toast.welcome") + " " + user.name + " 👋");
  } catch (e) {
    document.getElementById("login-error").textContent = e.message;
  }
}

async function doLogout() {
  try { await api("/api/logout"); } catch (e) {}
  user = null;
  document.getElementById("login-overlay").style.display = "flex";
  loadEmployees();
  updateUserBar();
  checkCancelRequests();
}

function updateUserBar() {
  const box = document.getElementById("user-box");
  const mgrDropdown = document.getElementById("manager-dropdown");
  const btnMenuMgr = document.getElementById("btn-menu-mgr");
  const shortcutBar = document.getElementById("shortcut-bar");
  const mobileNav = document.getElementById("mobile-nav");
  const mobileMgrBtn = document.getElementById("mobile-mgr-btn");
  const smallScreen = window.innerWidth <= 768;
  if (user) {
    box.style.display = "flex";
    document.getElementById("user-label").textContent = "👤 " + user.name + (user.role === "manager" ? " (" + t("managerRole") + ")" : "");
    const isMgr = user.role === "manager";
    mgrDropdown.style.display = isMgr ? "" : "none";
    if (btnMenuMgr) btnMenuMgr.style.display = isMgr ? "" : "none";
    if (shortcutBar) shortcutBar.style.display = smallScreen ? "none" : "flex";
    if (mobileNav) mobileNav.style.display = smallScreen ? "flex" : "none";
    if (mobileMgrBtn) mobileMgrBtn.style.display = (smallScreen && isMgr) ? "" : "none";
    /* mobile: show menu panel by default */
    if (smallScreen) { switchPanel("menu"); }
  } else {
    box.style.display = "none";
    mgrDropdown.style.display = "none";
    if (btnMenuMgr) btnMenuMgr.style.display = "none";
    if (shortcutBar) shortcutBar.style.display = "none";
    if (mobileNav) mobileNav.style.display = "none";
  }
}

function showMobileMgrMenu() {
  const el = document.getElementById("mobile-mgr-overlay");
  if (el) el.style.display = "flex";
}
function closeMobileMgrMenu() {
  const el = document.getElementById("mobile-mgr-overlay");
  if (el) el.style.display = "none";
}

// ===== إدارة القائمة (للمدير) =====
let _menuItemsCache = [], _menuCatsCache = [], _menuCatFilter = "all";
let _menuInvCache = [];

async function showMenuManager() {
  openModal("modal-menu");
  closeMenuEditor();
  document.getElementById("cat-inline-form").style.display = "none";
  await _loadMenuEditor();
}

async function _loadMenuEditor() {
  try {
    const items = await api("/api/menu/all");
    const orderData = await api("/api/categories/order");
    _menuItemsCache = items;
    const catCounts = {};
    items.forEach(it => { catCounts[it.category] = (catCounts[it.category] || 0) + 1; });
    _menuCatsCache = Object.keys(catCounts).sort((a, b) => (orderData[a] ?? 999) - (orderData[b] ?? 999));
    document.getElementById("cat-list").innerHTML = _menuCatsCache.map(c => `<option value="${c}">`).join("");
    _renderCatTabs();
    _renderMenuCards();
  } catch (e) { toast(e.message); }
}

function _renderCatTabs() {
  const bar = document.getElementById("cat-tabs-bar");
  const total = _menuItemsCache.length;
  let html = `<button class="btn btn-sm ${_menuCatFilter==='all'?'btn-success':''}" onclick="_setMenuCatFilter('all')">${t("all")} (${total})</button>`;
  _menuCatsCache.forEach(c => {
    const cnt = _menuItemsCache.filter(it => it.category === c).length;
    html += `<button class="btn btn-sm ${_menuCatFilter===c?'btn-success':''}" onclick="_setMenuCatFilter('${c.replace(/'/g,"\\'")}')">${c} (${cnt})</button>`;
  });
  bar.innerHTML = html;
}

function _setMenuCatFilter(cat) {
  _menuCatFilter = cat;
  _renderCatTabs();
  _renderMenuCards();
}

function _renderMenuCards() {
  const grid = document.getElementById("menu-cards-grid");
  const filtered = _menuCatFilter === "all" ? _menuItemsCache : _menuItemsCache.filter(it => it.category === _menuCatFilter);
  if (!filtered.length) {
    grid.innerHTML = `<div style="text-align:center;color:var(--muted);padding:30px" data-i18n="noItems">لا أصناف</div>`;
    return;
  }
  grid.innerHTML = `<div class="menu-cards-grid">${filtered.map(it => `
    <div class="menu-card ${it.active ? "" : "menu-card-off"}">
      <div class="menu-card-emoji">${it.emoji}</div>
      <div class="menu-card-name">${it.name}</div>
      <div class="menu-card-cat">${it.category}</div>
      <div class="menu-card-price">${fmtCur(it.price)}</div>
      <div class="menu-card-actions">
        <button class="btn btn-sm btn-info" onclick="_editMenuCard(${it.id})">✏️</button>
        <button class="btn btn-sm ${it.active?"btn-danger":"btn-success"}" onclick="_toggleMenuCard(${it.id},${it.active?0:1})">${it.active?"🚫":"↩️"}</button>
      </div>
    </div>`).join("")}</div>`;
}

function _editMenuCard(id) {
  const it = _menuItemsCache.find(x => x.id === id);
  if (!it) return;
  document.getElementById("mi-emoji").value = it.emoji;
  document.getElementById("mi-name").value = it.name;
  document.getElementById("mi-category").value = it.category;
  document.getElementById("mi-price").value = it.price;
  document.getElementById("mi-edit-id").value = it.id;
  document.getElementById("menu-editor").style.display = "";
  document.getElementById("mi-name").focus();
  loadMenuInvSelect();
  loadMenuInvLinks(it.id);
}

function closeMenuEditor() {
  document.getElementById("menu-editor").style.display = "none";
  document.getElementById("mi-edit-id").value = "";
  ["mi-emoji","mi-name","mi-category","mi-price"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("emoji-picker").style.display = "none";
  const linker = document.getElementById("mi-inventory-linker");
  if (linker) linker.style.display = "none";
}

function openMenuAdd() {
  closeMenuEditor();
  document.getElementById("menu-editor").style.display = "";
  document.getElementById("mi-emoji").focus();
}

const _EMOJIS = ["🍽️","🥗","🥘","🍲","🍜","🍛","🍚","🍔","🍟","🍕","🌭","🍗","🍤","🥩","🍖","🧆","🥙","🌯","🍳","🥚","🍞","🥐","🥯","🧀","🥛","☕","🍵","🥤","🧃","🧋","🍹","🍺","🥂","🍷","🍸","🍻","🍚","🍛","🥟","🍥","🍙","🍣","🍱","🥟","🍨","🍦","🍧","🎂","🍰","🧁","🍫","🍭","🍪","🍩","🍮","🍯","🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭","🍎","🍏","🍐","🍑","🍒","🍓","🥝","🍅","🥑","🍆","🥔","🥕","🌽","🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🍄","🥜","🫘","🍿","🧂","🌶️","🫕","🍢","🍡","🍧","🥞","🧇","🌮","🌯","🫔","🥓","🍞"];

function toggleEmojiPicker() {
  const picker = document.getElementById("emoji-picker");
  if (picker.style.display === "block") { picker.style.display = "none"; return; }
  if (!picker.dataset.loaded) {
    picker.innerHTML = _EMOJIS.map(e => `<span class="emoji-opt" onclick="_pickEmoji('${e}')">${e}</span>`).join("");
    picker.dataset.loaded = "1";
  }
  picker.style.display = "block";
}

function _pickEmoji(e) {
  document.getElementById("mi-emoji").value = e;
  document.getElementById("emoji-picker").style.display = "none";
}

document.addEventListener("click", function(ev) {
  const picker = document.getElementById("emoji-picker");
  const opened = document.getElementById("menu-editor").querySelector('div[style*="position:relative"]');
  if (picker && picker.style.display === "block" && !ev.target.closest("#mi-emoji") && !ev.target.closest(".emoji-opt") && !ev.target.closest('[title="اختيار إيموجي"]')) {
    picker.style.display = "none";
  }
});

async function saveMenuItem() {
  const id = document.getElementById("mi-edit-id").value;
  const body = {
    emoji: document.getElementById("mi-emoji").value || "🍽️",
    name: document.getElementById("mi-name").value.trim(),
    category: document.getElementById("mi-category").value.trim(),
    price: parseFloat(document.getElementById("mi-price").value) || 0
  };
  if (!body.name) { toast("⚠️ " + t("toast.enterItemName")); return; }
  try {
    if (id) {
      await api("/api/menu/item/" + id, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
      toast("✅ " + t("toast.itemUpdated"));
    } else {
      await api("/api/menu/item", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body) });
      toast("✅ " + t("toast.itemAdded"));
    }
    closeMenuEditor();
    await _loadMenuEditor();
    await reloadMenu();
  } catch (e) { toast(e.message); }
}

async function loadMenuInvSelect() {
  try {
    const inv = await api("/api/inventory/list");
    const sel = document.getElementById("mi-inv-select");
    if (!sel) return;
    _menuInvCache = inv;
    sel.innerHTML = `<option value="">-- ${t("chooseInv") || "اختر المادة"} --</option>` + inv.map(i => `<option value="${i.id}">${escapeHtml(i.item_name)}</option>`).join("");
  } catch (e) { /* تجاهل */ }
}

async function loadMenuInvLinks(menuId) {
  const box = document.getElementById("mi-inv-links");
  const linker = document.getElementById("mi-inventory-linker");
  if (!box || !linker) return;
  if (!menuId) { linker.style.display = "none"; box.innerHTML = ""; return; }
  linker.style.display = "";
  try {
    const links = await api("/api/menu-inventory/" + menuId);
    box.innerHTML = links.length ? links.map(l => `
      <div class="inv-link-row">
        <span style="flex:1">${escapeHtml(l.item_name)} <small style="color:var(--muted)">(${l.qty_per} ${l.unit || ""})</small></span>
        <button class="btn btn-sm btn-danger" onclick="removeMenuInvLink(${menuId},${l.inventory_id})">🗑️</button>
      </div>`).join("") : `<span style="color:var(--muted);font-size:11px">${t("noLinks") || "لا روابط"}</span>`;
  } catch (e) { box.innerHTML = `<span style="color:#ef4444;font-size:11px">${e.message}</span>`; }
}

async function addMenuInvLink() {
  const menuId = document.getElementById("mi-edit-id").value;
  const sel = document.getElementById("mi-inv-select");
  const qty = parseFloat(document.getElementById("mi-inv-qty").value) || 1;
  if (!menuId) return;
  if (!sel.value) { toast("⚠️ " + (t("chooseInv") || "اختر المادة")); return; }
  try {
    await api("/api/menu-inventory/" + menuId, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ inventory_id: parseInt(sel.value), qty_per: qty }) });
    await loadMenuInvLinks(menuId);
  } catch (e) { toast(e.message); }
}

async function removeMenuInvLink(menuId, inventoryId) {
  try {
    await api("/api/menu-inventory/" + menuId + "/" + inventoryId, { method: "DELETE" });
    await loadMenuInvLinks(menuId);
  } catch (e) { toast(e.message); }
}

async function _toggleMenuCard(id, active) {
  try {
    if (!active) {
      const it = _menuItemsCache.find(x => x.id === id);
      if (it) await api("/api/menu/item/" + id, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({emoji:it.emoji,name:it.name,category:it.category,price:it.price}) });
    } else {
      await api("/api/menu/item/" + id, { method: "DELETE" });
    }
    await _loadMenuEditor();
    await reloadMenu();
  } catch (e) { toast(e.message); }
}

let _catInlineMode = "";
function showAddCategoryInline() {
  _catInlineMode = "add";
  document.getElementById("cat-inline-input").value = "";
  document.getElementById("cat-inline-input").placeholder = t("categoryPh") || "اسم القسم الجديد";
  document.getElementById("cat-inline-form").style.display = "";
  document.getElementById("cat-inline-input").focus();
}
function showRenameCategoryInline() {
  if (!_menuCatsCache.length) { toast("⚠️ لا أقسام"); return; }
  _catInlineMode = "rename";
  document.getElementById("cat-inline-input").value = "";
  document.getElementById("cat-inline-input").placeholder = "اختر قسم ثم اكتب الاسم الجديد (مثال: OldName=NewName)";
  document.getElementById("cat-inline-form").style.display = "";
  document.getElementById("cat-inline-input").focus();
}
function showDeleteCategoryInline() {
  if (!_menuCatsCache.length) { toast("⚠️ لا أقسام"); return; }
  _catInlineMode = "delete";
  document.getElementById("cat-inline-input").value = "";
  document.getElementById("cat-inline-input").placeholder = "اكتب اسم القسم للحذف";
  document.getElementById("cat-inline-form").style.display = "";
  document.getElementById("cat-inline-input").focus();
}

async function confirmCatInline() {
  const val = document.getElementById("cat-inline-input").value.trim();
  if (!val) { toast("⚠️ اكتب الاسم"); return; }
  try {
    if (_catInlineMode === "add") {
      if (_menuCatsCache.includes(val)) { toast("⚠️ القسم موجود"); return; }
      await api("/api/menu/item", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({emoji:"📂",name:"—",category:val,price:0}) });
      toast("✅ تمت إضافة القسم");
    } else if (_catInlineMode === "delete") {
      const items = _menuItemsCache.filter(it => it.category === val);
      for (const it of items) {
        await api("/api/menu/item/" + it.id, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({category:""}) });
      }
      toast("✅ تم حذف القسم");
    } else if (_catInlineMode === "rename") {
      const parts = val.split("=");
      if (parts.length !== 2) { toast("⚠️ الصيغة: OldName=NewName"); return; }
      const [oldN, newN] = parts.map(s => s.trim());
      if (!oldN || !newN) { toast("⚠️ اكتب الاسمين"); return; }
      const items = _menuItemsCache.filter(it => it.category === oldN);
      for (const it of items) {
        await api("/api/menu/item/" + it.id, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({emoji:it.emoji,name:it.name,category:newN,price:it.price}) });
      }
      toast("✅ تم التعديل إلى: " + newN);
    }
    document.getElementById("cat-inline-form").style.display = "none";
    await _loadMenuEditor();
    await reloadMenu();
  } catch (e) { toast(e.message); }
}

async function moveCategory(cat, dir) {
  try {
    await api("/api/categories/reorder", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({category:cat,direction:dir}) });
    await _loadMenuEditor();
    await reloadMenu();
  } catch (e) { toast(e.message); }
}

let _renameCatOld = "";
function renameCategory(oldName) {
  _renameCatOld = oldName;
  document.getElementById("rename-old-name").textContent = oldName;
  document.getElementById("rename-new-name").value = "";
  openModal("modal-rename-cat");
  setTimeout(() => document.getElementById("rename-new-name").focus(), 200);
}

async function confirmRenameCategory() {
  const newName = (document.getElementById("rename-new-name").value || "").trim();
  if (!newName) { toast("⚠️ اكتب الاسم الجديد"); return; }
  if (newName === _renameCatOld) { closeModal("modal-rename-cat"); return; }
  try {
    const items = await api("/api/menu/all");
    const toUpdate = items.filter(it => it.category === _renameCatOld);
    for (const it of toUpdate) {
      await api("/api/menu/item/" + it.id, { method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify({emoji:it.emoji,name:it.name,category:newName,price:it.price}) });
    }
    closeModal("modal-rename-cat");
    toast("✅ تم تعديل القسم إلى: " + newName);
    await _loadMenuEditor();
    await reloadMenu();
  } catch (e) { toast(e.message); }
}

async function reloadMenu() {
  MENU = await api("/api/menu");
  try { CATEGORY_ORDER = await api("/api/categories/order"); } catch(e) {}
  renderCats();
  renderMenu();
}

// ===== موافقة المدير =====
function requireManager(actionHtml, callback) {
  if (user && user.role === "manager") { callback(); return; }
  managerCallback = callback;
  document.getElementById("manager-pin-action-info").innerHTML = actionHtml;
  document.getElementById("manager-pin-input").value = "";
  document.getElementById("manager-pin-error").textContent = "";
  openModal("modal-manager-pin");
}

async function verifyManagerPin() {
  const pin = document.getElementById("manager-pin-input").value;
  if (!pin) { document.getElementById("manager-pin-error").textContent = t("toast.enterPin"); return; }
  try {
    await api("/api/manager/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
    managerPinEntered = pin;
    closeModal("modal-manager-pin");
    if (managerCallback) managerCallback();
    managerCallback = null;
  } catch (e) {
    document.getElementById("manager-pin-error").textContent = e.message;
  }
}

// ===== سجل التدقيق =====
async function showAudit() {
  try {
    const rows = await api("/api/audit");
    const colors = { "login": "#6366f1", "logout": "#64748b", "place_order": "#10b981", "discount": "#f59e0b", "remove_item": "#ef4444", "clear_cart": "#ef4444", "void": "#ef4444" };
    document.getElementById("audit-body").innerHTML = rows.length
      ? rows.map(r =>
          `<div class="report-card" style="padding:8px 12px">
            <div style="display:flex;justify-content:space-between;gap:8px">
              <span style="font-size:12px;color:var(--text)">${r.employee}</span>
              <span style="font-size:11px;color:${colors[r.action] || "#94a3b8"};font-weight:bold">${r.action}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin:2px 0">${r.details}</div>
            <div style="font-size:10px;color:#64748b">${r.date}</div>
          </div>`).join("")
      : "<p style='text-align:center;color:var(--muted)'>" + t("noRecords") + "</p>";
    openModal("modal-audit");
  } catch (e) { toast(e.message); }
}

// ===== القائمة =====
function renderCats() {
  const cats = ["__ALL__", ...Object.keys(CATEGORY_ORDER).length > 0
    ? [...new Set(MENU.map(m => m.category).filter(Boolean))].sort((a, b) => (CATEGORY_ORDER[a] ?? 999) - (CATEGORY_ORDER[b] ?? 999))
    : [...new Set(MENU.map(m => m.category).filter(Boolean))]];
  const cont = document.getElementById("cats");
  cont.innerHTML = "";
  for (const c of cats) {
    const isAll = c === "__ALL__";
    const label = isAll ? t("all") : c;
    const color = isAll ? "#6366f1" : (CAT_COLORS[c] || "#6366f1");
    cont.innerHTML += `<button class="cat-btn ${c === currentCategory ? "active" : ""}" onclick="selectCat('${c}')" style="${c === currentCategory ? "background:" + color + ";border-color:" + color : ""}">${label}</button>`;
  }
  if (!cats.includes(currentCategory)) currentCategory = "__ALL__";
}

function selectCat(c) {
  currentCategory = c;
  renderCats();
  renderMenu();
}

function renderMenu() {
  const search = (document.getElementById("search").value || "").trim().toLowerCase();
  const cont = document.getElementById("menu-list");
  cont.innerHTML = "";
  const groups = {};
  for (const it of MENU) {
    if (currentCategory !== "__ALL__" && it.category !== currentCategory) continue;
    if (search && !it.name.toLowerCase().includes(search)) continue;
    (groups[it.category] = groups[it.category] || []).push(it);
  }
  const sortedCats = Object.keys(groups).sort((a, b) => (CATEGORY_ORDER[a] ?? 999) - (CATEGORY_ORDER[b] ?? 999));
  for (const cat of sortedCats) {
    const color = CAT_COLORS[cat] || "#6366f1";
    const forcedOpen = currentCategory !== "__ALL__" || !!search;
    const items = groups[cat].map(it =>
      `<button class="acc-item" style="--mcat:${color}" data-action="add-to-cart" data-name="${escapeHtml(it.name)}" data-emoji="${escapeHtml(it.emoji)}" data-price="${it.price}" data-menu-id="${it.id}">
        <span class="acc-emoji">${escapeHtml(it.emoji)}</span>
        <span class="acc-info">
          <span class="acc-name">${escapeHtml(it.name)}</span>
          <span class="acc-price">${fmtCur(it.price)}</span>
        </span>
      </button>`).join("");
    cont.innerHTML += `<div class="acc-group ${forcedOpen ? "open" : ""}" data-cat="${escapeHtml(cat)}">
      <button class="acc-head" style="--mcat:${color}" data-action="toggle-acc">
        <span class="acc-cat">${escapeHtml(cat)}</span>
        <span class="acc-count">${groups[cat].length}</span>
        <span class="acc-chev">▾</span>
      </button>
      <div class="acc-body">${items}</div>
    </div>`;
  }
}

function addToCart(name, emoji, price, menuId) {
  if (!user) return;
  if (!selectedTable) { toast("⚠️ " + t("toast.noTableSelected")); return; }
  for (const item of cart) {
    if (item.name === name && JSON.stringify(item.modifiers) === "[]") {
      item.qty++;
      item.menu_id = menuId || item.menu_id;
      item.subtotal = item.qty * item.price;
      if (splitInvoices) splitInvoices[splitCurrent].items = cart.slice();
      renderCart();
      return;
    }
  }
  cart.push({ name, emoji, price, qty: 1, subtotal: price, modifiers: [], menu_id: menuId || null });
  if (splitInvoices) splitInvoices[splitCurrent].items = cart.slice();
  renderCart();
}

function showModifierModal(name, emoji, price, menuId) {
  fetch("/api/modifiers/" + menuId).then(r => r.json()).then(groups => {
    if (!groups.length) {
      addToCart(name, emoji, price);
      return;
    }
    let html = `<div class="mod-modal-item">${emoji} <b>${name}</b> — ${fmtCur(price)}</div>`;
    html += `<input type="hidden" id="mod-menu-name" value="${name}">`;
    html += `<input type="hidden" id="mod-menu-emoji" value="${emoji}">`;
    html += `<input type="hidden" id="mod-menu-price" value="${price}">`;
    html += `<input type="hidden" id="mod-menu-id" value="${menuId}">`;
    for (const g of groups) {
      const req = g.required ? " *" : "";
      html += `<div class="mod-group-title">${g.name}${req}</div>`;
      html += `<div class="mod-options" data-group="${g.id}" data-max="${g.max_select}" data-required="${g.required}">`;
      for (const o of g.options) {
        const priceLabel = o.price_add > 0 ? ` (+${fmtCur(o.price_add)})` : "";
        const type = g.max_select > 1 ? "checkbox" : "radio";
        html += `<label class="mod-option">
          <input type="${type}" name="mod_${g.id}" value="${o.id}" data-price="${o.price_add}" data-name="${o.name}">
          <span>${o.name}${priceLabel}</span>
        </label>`;
      }
      html += `</div>`;
    }
    document.getElementById("modifier-body").innerHTML = html;
    openModal("modifier-modal");
  });
}

function confirmModifiers() {
  const name = document.getElementById("mod-menu-name").value;
  const emoji = document.getElementById("mod-menu-emoji").value;
  const price = parseFloat(document.getElementById("mod-menu-price").value);
  let totalModPrice = 0;
  const mods = [];
  document.querySelectorAll(".mod-options").forEach(g => {
    const max = parseInt(g.dataset.max);
    const required = parseInt(g.dataset.required);
    const checked = g.querySelectorAll("input:checked");
    if (required && checked.length === 0) {
      toast("⚠️ يرجى اختيار " + g.previousElementSibling.textContent.replace(" *", ""));
      return;
    }
    checked.forEach(inp => {
      totalModPrice += parseFloat(inp.dataset.price);
      mods.push({ name: inp.dataset.name, price: parseFloat(inp.dataset.price) });
    });
  });
  closeModal("modifier-modal");
  const unitPrice = price + totalModPrice;
  for (const item of cart) {
    if (item.name === name && JSON.stringify(item.modifiers) === JSON.stringify(mods)) {
      item.qty++;
      item.subtotal = item.qty * item.price;
      renderCart();
      return;
    }
  }
  cart.push({ name, emoji, price: unitPrice, qty: 1, subtotal: unitPrice, modifiers: mods });
  renderCart();
}

// ===== السلة =====
function removeItem(idx) {
  if (!user) return;
  const it = cart[idx];
  const doIt = () => {
    cart.splice(idx, 1);
    renderCart();
    logAudit("remove_item", `حذف صنف: ${it.emoji} ${it.name} x${it.qty} من السلة`);
  };
  requireManager(`🗑️ <b>${t("removeItemConfirm")}</b><br><span style="font-size:15px;color:var(--text)">${it.emoji} ${it.name} x${it.qty}</span>`, doIt);
}

function changeQty(idx, delta) {
  if (!user) return;
  cart[idx].qty += delta;
  if (cart[idx].qty <= 0) { cart.splice(idx, 1); }
  else { cart[idx].subtotal = cart[idx].qty * cart[idx].price; }
  if (splitInvoices) splitInvoices[splitCurrent].items = cart.slice();
  renderCart();
}

function renderCart() {
  const cont = document.getElementById("cart-list");
  let empty = document.getElementById("cart-empty");
  cont.innerHTML = "";
  if (!cart.length) {
    if (!empty) {
      empty = document.createElement("div");
      empty.id = "cart-empty";
      empty.className = "empty-cart";
      empty.setAttribute("data-i18n", "cartEmpty");
      empty.setAttribute("data-i18n-html", "1");
      empty.innerHTML = t("cartEmpty");
    }
    cont.appendChild(empty);
    empty.style.display = "block";
  } else {
    if (empty) empty.style.display = "none";
    let itemNum = 0;
    for (let i = 0; i < cart.length; i++) {
      const it = cart[i];
      itemNum++;
      const mods = (it.modifiers && it.modifiers.length) 
        ? `<div class="cart-mods">${it.modifiers.map(m => `<span class="cart-mod-tag">${escapeHtml(m.name)}${m.price > 0 ? " +" + fmtCur(m.price) : ""}</span>`).join("")}</div>` 
        : "";
      cont.innerHTML += `<div class="cart-item">
        <div class="top">
          <span class="name"><span class="cart-item-num">${itemNum}</span> ${escapeHtml(it.emoji)} ${escapeHtml(it.name)}</span>
          <span class="amount">${fmtCur(it.subtotal)}</span>
        </div>
        ${mods}
        <div class="bottom">
          <button class="qty-btn qty-del" onclick="removeItem(${i})">🗑️</button>
          <button class="qty-btn qty-dec" onclick="changeQty(${i}, -1)">−</button>
          <span class="qty-num">${it.qty}</span>
          <button class="qty-btn qty-add" onclick="changeQty(${i}, 1)">+</button>
          <span class="unit">${fmtCur(it.price)} × ${it.qty}</span>
        </div>
      </div>`;
    }
  }
  updateSummary();
}

function updateSummary() {
  const sub = cart.reduce((s, i) => s + i.subtotal, 0);
  const tax = sub * TAX_RATE;
  let total = sub + tax - discount - promoDiscount;
  if (total < 0) total = 0;
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);
  document.getElementById("subtotal").textContent = fmtCur(sub);
  document.getElementById("tax").textContent = fmtCur(tax);
  document.getElementById("total").textContent = fmtCur(total > 0 ? total : 0);
  document.getElementById("item-count").textContent = itemCount + " " + t("items");
  const dr = document.getElementById("discount-row");
  if (discount > 0 || promoDiscount > 0) {
    dr.style.display = "flex";
    document.getElementById("discount").textContent = "-" + fmtCur(discount + promoDiscount);
  } else {
    dr.style.display = "none";
  }
  updateStats();
}

// ===== الطاولات =====
let tableData = {};
const TABLE_SECTIONS = [
  { id: "families", icon: "👨‍👩‍👧" },
  { id: "vip", icon: "⭐" },
  { id: "hall", icon: "🛋️" },
  { id: "takeaway", icon: "🛍️" },
];

async function loadTables() {
  try {
    tableData = {};
    const arr = await api("/api/tables");
    for (const t of arr) tableData[t.num] = t;
  } catch (e) { /* لا يهم */ }
  renderTables();
  updateStats();
}

function renderTables() {
  const cont = document.getElementById("tables-list");
  cont.innerHTML = "";
  for (const sec of TABLE_SECTIONS) {
    const list = Object.values(tableData).filter(t => t.section === sec.id).sort((a, b) => a.num - b.num);
    if (!list.length) continue;
    let occupied = 0;
    for (const tb of list) if (tb.active) occupied++;
    let block = `<div class="table-section sec-${sec.id}">
      <div class="table-section-title"><span class="sec-icon">${sec.icon}</span> ${t(sec.id)}
        <span class="sec-count">${occupied}/${list.length}</span>
      </div>
      <div class="table-grid">`;
    for (const tb of list) {
      const i = tb.num;
      const sel = selectedTable === i;
      const cls = sel ? "selected" : (tb.active ? "occupied" : "available");
      const status = sel ? t("selected") : (tb.active ? t("occupied") : t("available"));
      const dot = sel ? "✓" : (tb.active ? "✕" : "●");
      const capacity = tb.capacity || 4;
      const orderInfo = tb.active && tb.order_total ? `<span class="table-order-total">${fmtCur(tb.order_total)}</span>` : "";
      const timeInfo = tb.active && tb.started_at ? `<span class="table-time">${getElapsedTime(tb.started_at)}</span>` : "";
      block += `<button class="table-btn ${cls}" onclick="selectTable(${i})" title="طاولة ${i} - ${capacity} أشخاص">
        <span class="table-num">${i}</span>
        <span class="table-capacity">👥 ${capacity}</span>
        <span class="table-status"><span class="status-dot">${dot}</span>${status}</span>
        ${orderInfo}
        ${timeInfo}
      </button>`;
    }
    block += `</div></div>`;
    cont.innerHTML += block;
  }
}

function getElapsedTime(startTime) {
  if (!startTime) return "";
  const start = new Date(startTime);
  const now = new Date();
  const diff = Math.floor((now - start) / 1000);
  const mins = Math.floor(diff / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

// ===== خريطة الطاولات =====
let tableView = "list";
let floorEdit = false;
let dragTable = null;
let dragOffset = { x: 0, y: 0 };

/* ── Mobile panel switching ── */
function switchPanel(name) {
  const isSmall = window.innerWidth <= 768;
  document.querySelectorAll(".main > .col[data-panel]").forEach(p => {
    p.style.display = (isSmall && p.dataset.panel === name) ? "flex" : "";
    if (isSmall && p.dataset.panel === name) {
      p.style.flexDirection = "column";
    }
  });
  document.querySelectorAll("[data-panel-btn]").forEach(b => {
    b.classList.toggle("active", b.dataset.panelBtn === name);
  });
  currentPanel = name;
  if (name === "tables") { loadTables(); }
  if (name === "cart") { renderCart(); }
}
let currentPanel = "menu";

function setTableView(view) {
  tableView = view;
  document.getElementById("tables-list").style.display = view === "list" ? "" : "none";
  document.getElementById("floor-plan").style.display = view === "floor" ? "" : "none";
  document.getElementById("btn-list-view").classList.toggle("btn-info", view === "list");
  document.getElementById("btn-floor-view").classList.toggle("btn-info", view === "floor");
  if (view === "floor") renderFloorPlan();
}

function renderFloorPlan() {
  const fp = document.getElementById("floor-plan");
  fp.innerHTML = "";
  const isMgr = user && user.role === "manager";

  /* ── مفتاح الألوان ── */
  fp.innerHTML += `<div class="floor-legend">
    <div class="floor-legend-item"><span class="floor-legend-dot free"></span> متاحة</div>
    <div class="floor-legend-item"><span class="floor-legend-dot busy"></span> مشغولة</div>
    <div class="floor-legend-item"><span class="floor-legend-dot my"></span> محددة</div>
  </div>`;

  /* ── أزرار تعديل المواقع ── */
  if (isMgr) {
    fp.innerHTML += `<div class="floor-edit-hint">${floorEdit ? "💡 اسحب الطاولات لتغيير مواقعها • اضغط ⚡ لحفظ" : "💡 اضغط ✏️ لتعديل مواقع الطاولات"}</div>`;
    fp.innerHTML += `<button class="btn btn-sm" style="position:absolute;top:36px;right:8px;z-index:30;font-size:11px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.15)" onclick="toggleFloorEdit()">${floorEdit ? "⚡ حفظ" : "✏️ تعديل"}</button>`;
    if (!floorEdit) {
      fp.innerHTML += `<button class="btn btn-sm" style="position:absolute;top:36px;right:75px;z-index:30;font-size:11px;background:rgba(99,102,241,.15);color:#a5b4fc;border:1px solid rgba(99,102,241,.3)" onclick="autoLayoutFloor()">📐 ترتيب</button>`;
    }
  }

  /* ── ترتيب الطاولات بالأرقام داخل كل قسم ── */
  const sections = {};
  for (const [num, tb] of Object.entries(tableData)) {
    const sec = tb.section || "hall";
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push({ num: parseInt(num), ...tb });
  }
  for (const sec in sections) {
    sections[sec].sort((a, b) => a.num - b.num);
  }

  /* ── مناطق الأقسام ── */
  const zoneLayout = {
    families: { label: "👨‍👩‍👧 العائلات", x: 10, y: 55, cols: 4, gapX: 85, gapY: 95, startOffset: { x: 30, y: 80 } },
    vip:      { label: "⭐ VIP",       x: 350, y: 55, cols: 4, gapX: 85, gapY: 95, startOffset: { x: 370, y: 80 } },
    hall:     { label: "🛋️ الصالة",    x: 10, y: 260, cols: 4, gapX: 100, gapY: 95, startOffset: { x: 30, y: 285 } },
    takeaway: { label: "🛍️ تيك أواي",  x: 420, y: 260, cols: 4, gapX: 85, gapY: 95, startOffset: { x: 440, y: 285 } },
  };

  for (const sec of Object.keys(zoneLayout)) {
    const list = sections[sec];
    if (!list || !list.length) continue;
    const z = zoneLayout[sec];
    fp.innerHTML += `<div class="floor-zone ${sec}" style="left:${z.x}px;top:${z.y}px;width:${z.cols * z.gapX + 20}px;height:${Math.ceil(list.length / z.cols) * z.gapY + 30}px">
      <div class="floor-zone-label">${z.label}</div>
    </div>`;
  }

  /* ── الطاولات ── */
  for (const sec of Object.keys(sections)) {
    const list = sections[sec];
    const z = zoneLayout[sec] || zoneLayout.hall;
    list.forEach((tb, idx) => {
      const n = tb.num;
      const sel = selectedTable === n;
      const cls = sel ? "selected" : (tb.active ? "occupied" : "available");
      let w, h;
      if (tb.shape === "rectangle") { w = 90; h = 55; }
      else if (tb.shape === "square") { w = 60; h = 60; }
      else { w = 65; h = 65; }
      const col = idx % z.cols;
      const row = Math.floor(idx / z.cols);
      const px = (tb.pos_x != null && tb.pos_x > 0) ? tb.pos_x : z.startOffset.x + col * z.gapX;
      const py = (tb.pos_y != null && tb.pos_y > 0) ? tb.pos_y : z.startOffset.y + row * z.gapY;
      const orderInfo = tb.active && tb.orders ? `<span class="ft-order">${tb.orders} طلب</span>` : "";
      const timeInfo = tb.active ? `<span class="ft-time">⏱ ${getElapsedTime(tb.started_at)}</span>` : "";
      fp.innerHTML += `<div class="floor-table ${cls} ${tb.shape || 'round'}" 
        style="width:${w}px;height:${h}px;left:${px}px;top:${py}px" 
        data-num="${n}" data-id="${tb.id}"
        onclick="selectTable(${n})"
        onmousedown="startDrag(event, ${n})"
        ontouchstart="startDrag(event, ${n})">
        <span class="ft-num">${n}</span>
        <span class="ft-cap">👥 ${tb.capacity || 4}</span>
        ${orderInfo}
        ${timeInfo}
        ${isMgr ? `<span class="ft-delete" onclick="event.stopPropagation();deleteFloorTable(${tb.id})">✕</span>` : ""}
      </div>`;
    });
  }
}

function autoLayoutFloor() {
  const sections = {};
  for (const [num, tb] of Object.entries(tableData)) {
    const sec = tb.section || "hall";
    if (!sections[sec]) sections[sec] = [];
    sections[sec].push({ id: tb.id, num: parseInt(num) });
  }
  const zoneLayout = {
    families: { cols: 4, gapX: 85, gapY: 95, startX: 30, startY: 80 },
    vip:      { cols: 4, gapX: 85, gapY: 95, startX: 370, startY: 80 },
    hall:     { cols: 4, gapX: 100, gapY: 95, startX: 30, startY: 285 },
    takeaway: { cols: 4, gapX: 85, gapY: 95, startX: 440, startY: 285 },
  };
  const positions = [];
  for (const sec in sections) {
    const list = sections[sec].sort((a, b) => a.num - b.num);
    const z = zoneLayout[sec] || zoneLayout.hall;
    list.forEach((tb, idx) => {
      const col = idx % z.cols;
      const row = Math.floor(idx / z.cols);
      positions.push({
        id: tb.id,
        pos_x: z.startX + col * z.gapX,
        pos_y: z.startY + row * z.gapY
      });
    });
  }
  api("/api/tables/positions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ positions })
  }).then(() => {
    for (const p of positions) {
      for (const [num, tb] of Object.entries(tableData)) {
        if (tb.id === p.id) { tb.pos_x = p.pos_x; tb.pos_y = p.pos_y; }
      }
    }
    toast("📐 تم ترتيب الطاولات");
    renderFloorPlan();
  }).catch(e => toast(e.message));
}

function toggleFloorEdit() {
  if (floorEdit) {
    saveFloorPositions();
  } else {
    floorEdit = true;
    renderFloorPlan();
  }
}

function startDrag(e, num) {
  if (!floorEdit) return;
  e.preventDefault();
  const el = e.target.closest(".floor-table");
  if (!el) return;
  dragTable = el;
  const rect = el.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  dragOffset.x = clientX - rect.left;
  dragOffset.y = clientY - rect.top;
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", endDrag);
  document.addEventListener("touchmove", onDrag, { passive: false });
  document.addEventListener("touchend", endDrag);
}

function onDrag(e) {
  if (!dragTable) return;
  e.preventDefault();
  const fp = document.getElementById("floor-plan");
  const fpRect = fp.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  let x = clientX - fpRect.left - dragOffset.x + fp.scrollLeft;
  let y = clientY - fpRect.top - dragOffset.y + fp.scrollTop;
  x = Math.max(0, Math.min(x, fp.scrollWidth - dragTable.offsetWidth));
  y = Math.max(0, Math.min(y, fp.scrollHeight - dragTable.offsetHeight));
  dragTable.style.left = x + "px";
  dragTable.style.top = y + "px";
}

function endDrag() {
  dragTable = null;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", endDrag);
  document.removeEventListener("touchmove", onDrag);
  document.removeEventListener("touchend", endDrag);
}

async function saveFloorPositions() {
  const positions = [];
  document.querySelectorAll(".floor-table").forEach(el => {
    positions.push({
      id: parseInt(el.dataset.id),
      pos_x: parseInt(el.style.left) || 0,
      pos_y: parseInt(el.style.top) || 0
    });
  });
  try {
    await api("/api/tables/positions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions })
    });
    toast("✅ تم حفظ مواقع الطاولات");
    for (const p of positions) {
      for (const [num, tb] of Object.entries(tableData)) {
        if (tb.id === p.id) { tb.pos_x = p.pos_x; tb.pos_y = p.pos_y; }
      }
    }
    floorEdit = false;
    renderFloorPlan();
  } catch (e) { toast(e.message); }
}

async function deleteFloorTable(id) {
  if (!confirm("حذف هذه الطاولة؟")) return;
  try {
    await api("/api/tables/" + id, { method: "DELETE" });
    toast("✅ تم الحذف");
    await loadTables();
    renderFloorPlan();
  } catch (e) { toast(e.message); }
}

async function selectTable(n) {
  if (!user) return;
  if (selectedTable === n && tableData[n] && tableData[n].active) return;
  selectedTable = n;
  const tb = tableData[n];
  const capacity = tb ? tb.capacity || 4 : 4;
  document.getElementById("table-badge").innerHTML = `🪑 ${t("table")} ${n} <span style="font-size:10px;color:#e0e7ff">👥 ${capacity}</span>`;
  await loadTableOrder(n);
  renderTables();
  if (window.innerWidth <= 768) { switchPanel("cart"); }
}

async function loadTableOrder(n) {
  try {
    const d = await api("/api/table_order/" + n);
    if (d.order) {
      existingOrderId = d.order.id;
      cart = d.order.items.map(i => ({
        name: i.name, emoji: i.emoji || "", price: i.price, qty: i.qty,
        subtotal: Math.round(i.price * i.qty * 100) / 100
      }));
      discount = d.order.discount || 0;
      document.getElementById("guests").value = d.order.guests || 1;
      toast("📂 " + t("toast.loadedSaved") + " " + n + ")");
    } else {
      existingOrderId = null;
      cart = [];
      discount = 0;
      document.getElementById("guests").value = 1;
    }
  } catch (e) {
    existingOrderId = null;
    cart = [];
    discount = 0;
  }
  renderCart();
}

function updateStats() {
  const list = Object.values(tableData);
  const active = list.filter(t => t.active).length;
  const total = list.length;
  const available = total - active;
  document.getElementById("stat-avail").innerHTML = `✅ <b>${available}</b> ${t("available")}`;
  document.getElementById("stat-occ").innerHTML = `🔴 <b>${active}</b> ${t("occupied")}`;
}

// ===== نقل الطلب =====
function showTransferModal() {
  if (!selectedTable) { toast("⚠️ لا يوجد طاولة محددة"); return; }
  let html = `<div style="margin-bottom:12px">نقل طلب الطاولة <b>${selectedTable}</b> إلى:</div>`;
  for (const [num, tb] of Object.entries(tableData)) {
    if (parseInt(num) === selectedTable) continue;
    const status = tb.active ? "🔴" : "🟢";
    const disabled = tb.active ? "disabled" : "";
    html += `<button class="transfer-table-btn" onclick="transferOrder(${num})" ${disabled}>
      <span>طاولة ${num}</span><span style="font-size:11px">${status}</span>
    </button>`;
  }
  document.getElementById("transfer-body").innerHTML = html;
  openModal("transfer-modal");
}

async function transferOrder(toTable) {
  try {
    const res = await api("/api/order/transfer", { method: "POST", body: JSON.stringify({ from_table: selectedTable, to_table: toTable }) });
    if (res.ok) {
      toast("✅ تم النقل إلى الطاولة " + toTable);
      closeModal("transfer-modal");
      await selectTable(toTable);
    } else {
      toast("❌ " + (res.error || "خطأ"));
    }
  } catch (e) { toast("❌ " + e.message); }
}

// ===== تقسيم الفاتورة =====
function showSplitModal() {
  if (splitInvoices) { toast("⚠️ يوجد تقسيم جارٍ، أكمل فاتورة أولاً أو أنهِه"); return; }
  if (!cart.length) { toast("⚠️ السلة فاضية"); return; }
  let html = `<div class="split-total">الأصناف: <b>${cart.length}</b> • المجموع: <b>${fmtCur(getCartTotal())}</b></div>`;
  html += `<div class="split-inputs"><label>عدد الفواتير: <input type="number" id="split-count" min="2" max="10" value="2" onchange="buildSplitTable()" style="width:60px"></label></div>`;
  html += `<div id="split-items"></div>`;
  html += `<div id="split-preview"></div>`;
  document.getElementById("split-body").innerHTML = html;
  document.getElementById("split-confirm").style.display = "";
  openModal("split-modal");
  buildSplitTable();
}

function getCartTotal() {
  const sub = cart.reduce((s, i) => s + i.subtotal, 0);
  const tax = sub * TAX_RATE;
  const tot = sub + tax - discount - promoDiscount;
  return tot > 0 ? tot : 0;
}

/* بناء جدول التوزيع مرة واحدة فقط (عند الفتح أو تغيير عدد الفواتير) */
function buildSplitTable() {
  const count = Math.max(2, Math.min(10, parseInt(document.getElementById("split-count").value) || 2));
  const itemsDiv = document.getElementById("split-items");
  let table = `<table class="split-table"><thead><tr>
    <th>الصنف</th><th>السعر</th>`;
  for (let p = 1; p <= count; p++) table += `<th>فاتورة${p}</th>`;
  table += `<th>المتبقي</th></tr></thead><tbody>`;

  cart.forEach((it, idx) => {
    const qty = it.qty;
    table += `<tr>
      <td class="split-item-name">${it.emoji} ${it.name}</td>
      <td>${fmtCur(it.price)} × ${qty}</td>`;
    for (let p = 1; p <= count; p++) {
      table += `<td><input type="number" class="split-qty" data-idx="${idx}" data-person="${p}" min="0" max="${qty}" value="${p === 1 ? qty : 0}" oninput="updateSplitLive()"></td>`;
    }
    table += `<td class="split-remain" id="split-remain-${idx}">${qty}</td></tr>`;
  });
  table += `</tbody></table>`;
  itemsDiv.innerHTML = table;
  updateSplitLive();
}

/* تحديث حي بدون إعادة بناء الجدول (حتى لا يمسح ما يكتبه المستخدم) */
function updateSplitLive() {
  const count = Math.max(2, Math.min(10, parseInt(document.getElementById("split-count").value) || 2));
  const preview = document.getElementById("split-preview");
  let used = new Array(cart.length).fill(0);
  let persons = new Array(count).fill(0);
  let allAssigned = true;

  cart.forEach((it, idx) => {
    for (let p = 1; p <= count; p++) {
      const inp = document.querySelector(`.split-qty[data-idx="${idx}"][data-person="${p}"]`);
      let v = inp ? parseInt(inp.value) || 0 : 0;
      v = Math.max(0, Math.min(it.qty, v));
      if (inp) inp.value = v;
      used[idx] += v;
      persons[p - 1] += v * it.price;
    }
    const rem = document.getElementById(`split-remain-${idx}`);
    if (rem) {
      rem.textContent = it.qty - used[idx];
      if (it.qty - used[idx] !== 0) allAssigned = false;
    }
  });

  let result = `<div class="split-result">`;
  let grand = 0;
  for (let p = 1; p <= count; p++) {
    const perTax = persons[p - 1] * TAX_RATE;
    const perTotal = persons[p - 1] + perTax;
    grand += perTotal;
    result += `<div class="split-person">
      <span>📄 فاتورة ${p}</span>
      <span class="split-amount">${fmtCur(persons[p - 1])} <small>+${TAX_RATE * 100}% = <b>${fmtCur(perTotal)}</b></small></span>
    </div>`;
  }
  result += `<div class="split-grand">المجموع: <b>${fmtCur(grand)}</b> (${fmtCur(getCartTotal())})</div>`;
  if (!allAssigned) result += `<div style="color:var(--warn);font-size:12px;margin-top:6px">⚠️ بعض الأصناف لم تُوزع على أي فاتورة</div>`;
  result += `</div>`;
  preview.innerHTML = result;
}

/* إبقاء التوافق مع أي استدعاء قديم */
function updateSplitPreview() { buildSplitTable(); }

function confirmSplit() {
  if (splitInvoices) { toast("⚠️ يوجد تقسيم جارٍ بالفعل"); return; }
  if (!document.getElementById("split-count")) return;
  const count = Math.max(2, Math.min(10, parseInt(document.getElementById("split-count").value) || 2));
  const invoices = [];
  for (let p = 1; p <= count; p++) invoices.push({ items: [], existingOrderId: null, discount: 0, promoDiscount: 0, promoCode: "" });

  let assigned = true;
  cart.forEach((it, idx) => {
    let totalGiven = 0;
    for (let p = 1; p <= count; p++) {
      const inp = document.querySelector(`.split-qty[data-idx="${idx}"][data-person="${p}"]`);
      let v = inp ? parseInt(inp.value) || 0 : 0;
      v = Math.max(0, Math.min(it.qty, v));
      totalGiven += v;
      if (v > 0) invoices[p - 1].items.push({ ...it, qty: v, subtotal: v * it.price });
    }
    if (totalGiven !== it.qty) assigned = false;
  });

  let anyNonEmpty = invoices.some(inv => inv.items.length > 0);
  if (!anyNonEmpty) { toast("⚠️ يجب توزيع الأصناف أولاً"); return; }
  splitInvoices = invoices;
  splitCurrent = 0;
  closeModal("split-modal");
  _loadInvoice(0);
  toast("👥 تم التقسيم إلى " + count + " فواتير مستقلة" + (assigned ? "" : " (⚠️ توزيع غير مكتمل)"));
}

function _loadInvoice(i) {
  if (!splitInvoices) return;
  splitCurrent = i;
  const inv = splitInvoices[i];
  cart = inv.items.slice();
  discount = inv.discount || 0;
  existingOrderId = inv.existingOrderId || null;
  promoDiscount = inv.promoDiscount || 0;
  promoCode = inv.promoCode || "";
  document.getElementById("promo-code").value = promoCode;
  document.getElementById("promo-remove").style.display = promoCode ? "" : "none";
  renderCart();
  renderInvoiceTabs();
}

function _commitInvoice() {
  if (!splitInvoices) return;
  splitInvoices[splitCurrent].items = cart.slice();
  splitInvoices[splitCurrent].existingOrderId = existingOrderId;
  splitInvoices[splitCurrent].discount = discount;
  splitInvoices[splitCurrent].promoDiscount = promoDiscount;
  splitInvoices[splitCurrent].promoCode = promoCode;
}

function switchInvoice(i) {
  if (!splitInvoices || i === splitCurrent) return;
  _commitInvoice();
  _loadInvoice(i);
}

function endSplit() {
  splitInvoices = null;
  splitCurrent = 0;
  discount = 0;
  promoDiscount = 0;
  promoCode = "";
  existingOrderId = null;
  renderInvoiceTabs();
  renderCart();
}

function renderInvoiceTabs() {
  const bar = document.getElementById("invoice-tabs");
  if (!bar) return;
  if (!splitInvoices) { bar.style.display = "none"; bar.innerHTML = ""; return; }
  bar.style.display = "flex";
  bar.innerHTML = splitInvoices.map((inv, i) => {
    const cnt = inv.items.reduce((s, x) => s + x.qty, 0);
    return `<button class="invoice-tab ${i === splitCurrent ? "active" : ""}" onclick="switchInvoice(${i})">📄 فاتورة ${i + 1}<span class="invoice-tab-cnt">${cnt}</span></button>`;
  }).join("") + `<button class="invoice-tab-end" onclick="endSplit()">✕ إنهاء</button>`;
}

// ===== السلة =====
function clearCart() {
  if (!user) return;
  if (!cart.length) return;
  const doIt = () => {
    cart = [];
    discount = 0;
    promoDiscount = 0;
    promoCode = "";
    document.getElementById("promo-code").value = "";
    document.getElementById("promo-remove").style.display = "none";
    existingOrderId = null;
    if (splitInvoices) {
      splitInvoices[splitCurrent].items = [];
      splitInvoices[splitCurrent].discount = 0;
      splitInvoices[splitCurrent].promoDiscount = 0;
      splitInvoices[splitCurrent].promoCode = "";
      splitInvoices[splitCurrent].existingOrderId = null;
      if (splitInvoices.every(inv => inv.items.length === 0)) { endSplit(); }
      else { renderInvoiceTabs(); }
    }
    renderCart();
    logAudit("clear_cart", splitInvoices ? "إفراغ فاتورة " + (splitCurrent + 1) : "إفراغ السلة كاملة");
  };
  requireManager(`🗑️ <b>${t("clearCartConfirm")}</b><br><span style="font-size:13px;color:var(--text)">${t("clearCartConfirmDesc")}</span>`, doIt);
}

async function saveOrder() {
  if (!user) return;
  if (!cart.length) { toast("⚠️ " + t("toast.cartEmpty")); return; }
  if (!selectedTable) { toast("⚠️ " + t("toast.noTableSelected")); return; }
  const guests = parseInt(document.getElementById("guests").value) || 1;
  try {
    const res = await api("/api/order/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_num: selectedTable, items: cart, discount, guests, order_id: existingOrderId || null, new_order: !!(splitInvoices && !existingOrderId) })
    });
    existingOrderId = res.order_id;
    if (splitInvoices) { splitInvoices[splitCurrent].existingOrderId = res.order_id; renderInvoiceTabs(); }
    toast("💾 " + t("toast.saved") + " #" + res.order_id + " — " + t("table") + " " + selectedTable + (splitInvoices ? ` (فاتورة ${splitCurrent + 1})` : ""));
    loadTables();
  } catch (e) { toast(e.message); }
}

// ===== الدفع =====
function showPayment() {
  if (!user) return;
  if (!cart.length) { toast("⚠️ " + t("toast.cartEmpty")); return; }
  if (!selectedTable) { toast("⚠️ " + t("toast.noTableSelected")); return; }
  const sub = cart.reduce((s, i) => s + i.subtotal, 0);
  const tax = sub * TAX_RATE;
  const total = sub + tax - discount - promoDiscount;
  document.getElementById("pay-sub").textContent = fmtCur(sub);
  document.getElementById("pay-tax").textContent = fmtCur(tax);
  document.getElementById("pay-total").textContent = fmtCur(total > 0 ? total : 0);
  document.getElementById("pay-table").textContent = "🪑 " + t("table") + " " + selectedTable;
  document.getElementById("paid").value = Math.round(total > 0 ? total : 0);
  const dr = document.getElementById("pay-discount-row");
  if (discount > 0 || promoDiscount > 0) {
    dr.style.display = "flex";
    document.getElementById("pay-discount").textContent = "-" + fmtCur(discount + promoDiscount);
  } else {
    dr.style.display = "none";
  }
  calcChange();
  setPayMethod(document.querySelector('#pay-methods .pay-method.selected') || null);
  openModal("pay-modal");
}

function setPayMethod(el) {
  if (!el) return;
  payMethod = el.dataset.method;
  document.querySelectorAll("#pay-methods .pay-method").forEach(b => b.classList.remove("selected"));
  el.classList.add("selected");
  const creditRow = document.getElementById("credit-name-row");
  if (creditRow) creditRow.style.display = payMethod === "آجل" ? "" : "none";
}

function calcChange() {
  const sub = cart.reduce((s, i) => s + i.subtotal, 0);
  const total = sub + sub * TAX_RATE - discount - promoDiscount;
  const paid = parseFloat(document.getElementById("paid").value) || 0;
  const change = paid - total;
  const el = document.getElementById("change");
  if (change >= 0) {
    el.textContent = t("remaining") + ": " + fmtCur(change);
    el.style.color = "#10b981";
  } else {
    el.textContent = t("shortfall") + ": " + fmtCur(Math.abs(change));
    el.style.color = "#ef4444";
  }
}

async function confirmPayment() {
  if (!user) return;
  const sub = cart.reduce((s, i) => s + i.subtotal, 0);
  const total = sub + sub * TAX_RATE - discount - promoDiscount;
  const paid = parseFloat(document.getElementById("paid").value) || 0;
  if (paid < total && payMethod !== "آجل") { toast("⚠️ " + t("toast.insufficient")); return; }
  if (payMethod === "آجل") {
    const creditName = (document.getElementById("credit-name").value || "").trim();
    if (!creditName) { toast("⚠️ اكتب اسم صاحب الآجل"); document.getElementById("credit-name").focus(); return; }
  }
  const guests = parseInt(document.getElementById("guests").value) || 1;
  const creditName = payMethod === "آجل" ? (document.getElementById("credit-name").value || "").trim() : null;
  try {
    const res = await api("/api/order/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_num: selectedTable, items: cart, paid, discount: discount + promoDiscount, payment_method: payMethod, guests, credit_name: creditName, order_id: existingOrderId || null, new_order: !!(splitInvoices && !existingOrderId) })
    });
    closeModal("pay-modal");
    toast("✅ " + t("toast.paid") + " #" + res.order_id + " | " + t("toast.remaining") + ": " + fmtCur(res.change) + (splitInvoices ? ` (فاتورة ${splitCurrent + 1})` : ""));
    printReceipt(res);
    if (splitInvoices) {
      /* إنهاء هذه الفاتورة: إفراغ عناصرها */
      splitInvoices[splitCurrent].items = [];
      splitInvoices[splitCurrent].existingOrderId = null;
      splitInvoices[splitCurrent].discount = 0;
      splitInvoices[splitCurrent].promoDiscount = 0;
      splitInvoices[splitCurrent].promoCode = "";
      const remaining = splitInvoices.filter(inv => inv.items.length > 0);
      if (remaining.length === 0) {
        endSplit();
        cart = [];
        discount = 0;
        promoDiscount = 0;
        promoCode = "";
        document.getElementById("promo-code").value = "";
        document.getElementById("promo-remove").style.display = "none";
        existingOrderId = null;
        selectedTable = null;
        document.getElementById("table-badge").textContent = "🪑 " + t("noTableSelected");
        document.getElementById("guests").value = 1;
        document.getElementById("credit-name").value = "";
        renderCart();
        loadTables();
      } else {
        /* الانتقال لأول فاتورة باقية (لا نستدعي commit حتى لا تعود أصناف المدفوعة) */
        const nextIdx = splitInvoices.findIndex(inv => inv.items.length > 0);
        _loadInvoice(nextIdx);
        document.getElementById("guests").value = 1;
        document.getElementById("credit-name").value = "";
        loadTables();
      }
      return;
    }
    cart = [];
    discount = 0;
    promoDiscount = 0;
    promoCode = "";
    document.getElementById("promo-code").value = "";
    document.getElementById("promo-remove").style.display = "none";
    existingOrderId = null;
    selectedTable = null;
    document.getElementById("table-badge").textContent = "🪑 " + t("noTableSelected");
    document.getElementById("guests").value = 1;
    document.getElementById("credit-name").value = "";
    renderCart();
    loadTables();
  } catch (e) {
    toast(e.message);
  }
}

function printReceipt(o) {
  const name = RESTAURANT_NAME;
  const rows = o.items.map(i => {
    const mods = (i.modifiers && i.modifiers.length) 
      ? `<div style="font-size:11px;color:#666;padding-left:8px">${i.modifiers.map(m => `+ ${m.name}${m.price > 0 ? " (" + fmtCur(m.price) + ")" : ""}`).join("<br>")}</div>` 
      : "";
    return `<tr><td class="right">${i.emoji || ""} ${i.name} ×${i.qty}${mods}</td><td class="left">${fmtCur(i.subtotal)}</td></tr>`;
  }).join("");
  const w = window.open("", "_blank", "width=320,height=600");
  if (!w) { toast("⚠️ " + t("toast.allowPopups")); return; }
  const dir = document.documentElement.dir;
  w.document.write(`<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${t("receipt")} #${o.order_id}</title><style>
    body{font-family:'Segoe UI',Tahoma,sans-serif;width:290px;margin:0 auto;text-align:center;font-size:13px;color:#000}
    h3{margin:4px 0}.muted{font-size:11px;color:#555}
    .dash{border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse}td{padding:2px 0}
    .right{text-align:${dir === "rtl" ? "right" : "left"}}.left{text-align:${dir === "rtl" ? "left" : "right"}}.tot{font-weight:bold;font-size:14px}
    .logo{font-size:24px;margin:4px 0}
    .barcode{margin-top:10px;font-family:monospace;font-size:10px;letter-spacing:2px}
    .summary-box{background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:8px;margin:6px 0}
  </style></head><body>
    <div class="logo">🍽️</div>
    <h3>${name}</h3>
    <div class="muted">${t("appSubtitle")}</div>
    <div class="dash"></div>
    <table>
      <tr><td class="right">${t("orderLabel")} #${o.order_id}</td><td class="left">${o.date}</td></tr>
      <tr><td class="right">${t("table")}: ${o.table_num}</td><td class="left">${t("cashier")}: ${o.employee}</td></tr>
      <tr><td class="right">${t("guestsLabel")} ${o.guests || 1}</td><td class="left">${t("paymentMethod")} ${o.payment_method}</td></tr>
      ${o.credit_name ? `<tr><td class="right" style="color:#d97706;font-weight:bold">📝 صاحب الآجل</td><td class="left" style="font-weight:bold">${o.credit_name}</td></tr>` : ""}
    </table>
    <div class="dash"></div>
    <table>${rows}</table>
    <div class="dash"></div>
    <div class="summary-box">
      <table>
        <tr><td class="right">${t("subtotal")}</td><td class="left">${fmtCur(o.subtotal)}</td></tr>
        <tr><td class="right">${t("tax")}</td><td class="left">${fmtCur(o.tax)}</td></tr>
        ${o.discount > 0 ? `<tr><td class="right" style="color:#d97706">${t("discount")}</td><td class="left" style="color:#d97706">-${fmtCur(o.discount)}</td></tr>` : ""}
        <tr class="tot"><td class="right">${t("total")}</td><td class="left" style="color:#059669">${fmtCur(o.total)}</td></tr>
        <tr><td class="right">${t("paidAmount")}</td><td class="left">${fmtCur(o.paid)}</td></tr>
        <tr><td class="right">${t("remaining")}</td><td class="left">${fmtCur(o.change)}</td></tr>
      </table>
    </div>
    <div class="dash"></div>
    <div class="barcode">||||| ${o.order_id} |||||</div>
    <div class="muted" style="margin-top:8px">${t("thanks")}</div>
    <div class="muted">${new Date().toLocaleString()}</div>
  </body></html>`);
  w.document.close();
  w.focus();
  w.print();
  w.close();
}

// ===== الخصم =====
function toggleDiscountDropdown() {
  document.getElementById("discount-menu").classList.toggle("show");
}

function closeDiscountDropdown() {
  document.getElementById("discount-menu").classList.remove("show");
}

function applyDiscount(pct) {
  if (!user) return;
  const sub = cart.reduce((s, i) => s + i.subtotal, 0);
  const doIt = () => {
    discount = pct > 0 ? sub * pct / 100 : 0;
    closeDiscountDropdown();
    renderCart();
    logAudit("discount", `${pct > 0 ? "تطبيق خصم " + pct + "%" : "إلغاء الخصم"} (= ${fmtCur(discount)})`);
  };
  requireManager(`🏷️ <b>${pct > 0 ? t("applyDiscount") + " " + pct + "%" : t("cancelDiscount")}</b><br><span style="font-size:13px;color:var(--text)">${t("discountAmount")} ${fmtCur(pct > 0 ? sub * pct / 100 : discount)}</span>`, doIt);
}

// ===== أكواد الخصم =====
async function applyPromoCode() {
  if (!user) return;
  const code = document.getElementById("promo-code").value.trim().toUpperCase();
  if (!code) { toast("⚠️ " + t("promoCode")); return; }
  const sub = cart.reduce((s, i) => s + i.subtotal, 0);
  try {
    const res = await api("/api/promo/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, order_total: sub })
    });
    promoDiscount = res.discount;
    promoCode = code;
    document.getElementById("promo-remove").style.display = "";
    toast("✅ " + t("promoApplied") + ": -" + fmtCur(res.discount));
    renderCart();
  } catch (e) { toast("⚠️ " + e.message); }
}

function removePromoCode() {
  promoDiscount = 0;
  promoCode = "";
  document.getElementById("promo-code").value = "";
  document.getElementById("promo-remove").style.display = "none";
  toast("✅ " + t("promoRemoved"));
  renderCart();
}

async function showPromoManager() {
  if (!user || user.role !== "manager") return;
  openModal("modal-promo");
  loadPromoList();
}

async function loadPromoList() {
  try {
    const list = await api("/api/promo/list");
    const now = new Date().toISOString().slice(0, 10);
    document.getElementById("promo-list").innerHTML = list.length
      ? list.map(p => {
        const isExpired = p.expires_at && p.expires_at < now;
        const isMaxed = p.max_uses > 0 && p.used_count >= p.max_uses;
        const isInactive = !p.active || isExpired || isMaxed;
        const statusClass = isInactive ? "inactive" : "";
        const statusIcon = isInactive ? "🚫" : "✅";
        const typeLabel = p.discount_type === "percent" ? p.discount_value + "%" : fmtCur(p.discount_value);
        const details = [];
        if (p.min_order > 0) details.push(t("promoMinOrder") + ": " + fmtCur(p.min_order));
        if (p.max_uses > 0) details.push(p.used_count + "/" + p.max_uses);
        if (p.expires_at) details.push(p.expires_at);
        return `
        <div class="menu-manage-row ${statusClass}">
          <span style="font-size:18px">${statusIcon}</span>
          <div class="mi-info">
            <div style="font-weight:bold;font-size:13px">${p.code}</div>
            <div class="mi-meta">${typeLabel}${details.length ? " • " + details.join(" • ") : ""}</div>
          </div>
          <div class="mi-actions">
            <button class="btn btn-sm btn-info" onclick="editPromo(${p.id}, '${p.code}', '${p.discount_type}', ${p.discount_value}, ${p.min_order}, ${p.max_uses}, '${p.expires_at || ''}', ${p.active})">✏️</button>
            <button class="btn btn-sm ${p.active ? "btn-warning" : "btn-success"}" onclick="togglePromo(${p.id}, ${p.active ? 0 : 1})">${p.active ? "🚫" : "↩️"}</button>
            <button class="btn btn-sm btn-danger" onclick="deletePromo(${p.id})">🗑️</button>
          </div>
        </div>`;
      }).join("")
      : "<p style='text-align:center;color:var(--muted)'>" + t("noRecords") + "</p>";
  } catch (e) { toast(e.message); }
}

function editPromo(id, code, type, value, minOrder, maxUses, expires, active) {
  const row = document.querySelector(`[onclick*="editPromo(${id}"]`)?.closest(".menu-manage-row");
  if (!row) return;
  row.innerHTML = `
    <div style="width:100%;display:grid;grid-template-columns:1fr 1fr;gap:6px">
      <input id="edit-promo-code-${id}" class="login-input" value="${code}" style="text-transform:uppercase;font-weight:bold">
      <select id="edit-promo-type-${id}" class="login-input">
        <option value="percent" ${type === "percent" ? "selected" : ""}>نسبة مئوية %</option>
        <option value="fixed" ${type === "fixed" ? "selected" : ""}>مبلغ ثابت</option>
      </select>
      <input id="edit-promo-value-${id}" class="login-input" type="number" step="0.5" min="0" value="${value}">
      <input id="edit-promo-min-${id}" class="login-input" type="number" step="1" min="0" value="${minOrder}">
      <input id="edit-promo-max-${id}" class="login-input" type="number" step="1" min="0" value="${maxUses}">
      <input id="edit-promo-expires-${id}" class="login-input" type="date" value="${expires}">
      <button class="btn btn-sm btn-success" onclick="savePromoEdit(${id})">💾 حفظ</button>
      <button class="btn btn-sm" onclick="loadPromoList()">✕ إلغاء</button>
    </div>`;
}

async function savePromoEdit(id) {
  const code = document.getElementById(`edit-promo-code-${id}`).value.trim().toUpperCase();
  const type = document.getElementById(`edit-promo-type-${id}`).value;
  const value = parseFloat(document.getElementById(`edit-promo-value-${id}`).value) || 0;
  const minOrder = parseFloat(document.getElementById(`edit-promo-min-${id}`).value) || 0;
  const maxUses = parseInt(document.getElementById(`edit-promo-max-${id}`).value) || 0;
  const expires = document.getElementById(`edit-promo-expires-${id}`).value;
  if (!code) { toast("⚠️ " + t("promoCode")); return; }
  if (value <= 0) { toast("⚠️ " + t("promoValue")); return; }
  try {
    await api("/api/promo/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, discount_type: type, discount_value: value, min_order: minOrder, max_uses: maxUses, expires_at: expires })
    });
    toast("✅ تم الحفظ");
    loadPromoList();
  } catch (e) { toast(e.message); }
}

async function togglePromo(id, active) {
  try {
    await api("/api/promo/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active })
    });
    toast("✅ " + (active ? "تم التفعيل" : "تم التعطيل"));
    loadPromoList();
  } catch (e) { toast(e.message); }
}

async function addPromo() {
  if (!user || user.role !== "manager") return;
  const code = document.getElementById("promo-new-code").value.trim().toUpperCase();
  const type = document.getElementById("promo-new-type").value;
  const value = parseFloat(document.getElementById("promo-new-value").value) || 0;
  const minOrder = parseFloat(document.getElementById("promo-new-min").value) || 0;
  const maxUses = parseInt(document.getElementById("promo-new-max").value) || 0;
  const expires = document.getElementById("promo-new-expires").value;
  if (!code) { toast("⚠️ " + t("promoCode")); return; }
  if (value <= 0) { toast("⚠️ " + t("promoValue")); return; }
  try {
    await api("/api/promo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, discount_type: type, discount_value: value, min_order: minOrder, max_uses: maxUses, expires_at: expires })
    });
    toast("✅ " + t("toast.itemAdded"));
    document.getElementById("promo-new-code").value = "";
    document.getElementById("promo-new-value").value = "";
    loadPromoList();
  } catch (e) { toast(e.message); }
}

async function deletePromo(id) {
  if (!user || user.role !== "manager") return;
  if (!confirm(t("confirmDelete"))) return;
  try {
    await api("/api/promo/" + id, { method: "DELETE" });
    toast("✅ " + t("toast.deleted"));
    loadPromoList();
  } catch (e) { toast(e.message); }
}

// ===== المخزون =====
async function showInventoryManager() {
  if (!user || user.role !== "manager") return;
  openModal("modal-inventory");
  loadInventoryList();
}

async function loadInventoryList() {
  try {
    const items = await api("/api/inventory/list");
    const el = document.getElementById("inventory-list");
    if (!items.length) { el.innerHTML = `<div class="empty-state">${t("empty")}</div>`; return; }
    el.innerHTML = items.map(i => {
      const lowStock = i.min_stock > 0 && i.quantity <= i.min_stock;
      return `<div class="emp-row" style="display:flex;justify-content:space-between;align-items:center;border-left:3px solid ${lowStock ? "var(--danger)" : "var(--border)"}">
        <div>
          <b>${esc(i.item_name)}</b>
          <div style="font-size:12px;color:var(--text)">
            <span data-i18n="quantity">الكمية</span>: ${i.quantity} <span data-i18n="unit_${i.unit}">${i.unit}</span>
            ${i.min_stock > 0 ? ` | <span data-i18n="minStock">الحد الأدنى</span>: ${i.min_stock}` : ""}
            ${i.cost > 0 ? ` | <span data-i18n="cost">التكلفة</span>: ${fmtCur(i.cost)}` : ""}
          </div>
          ${lowStock ? `<span style="color:var(--danger);font-size:11px" data-i18n="lowStockWarning">⚠️ مخزون منخفض!</span>` : ""}
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="btn btn-danger" style="padding:4px 8px;font-size:12px" onclick="deleteInventory(${i.id})" data-i18n="delete">🗑️</button>
        </div>
      </div>`;
    }).join("");
  } catch (e) { toast(e.message); }
}

async function addInventory() {
  if (!user || user.role !== "manager") return;
  const item_name = document.getElementById("inv-new-name").value.trim();
  const quantity = parseFloat(document.getElementById("inv-new-qty").value) || 0;
  const unit = document.getElementById("inv-new-unit").value;
  const min_stock = parseFloat(document.getElementById("inv-new-min").value) || 0;
  const cost = parseFloat(document.getElementById("inv-new-cost").value) || 0;
  if (!item_name) { toast("⚠️ " + t("enterItemName")); return; }
  try {
    await api("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_name, quantity, unit, min_stock, cost })
    });
    document.getElementById("inv-new-name").value = "";
    document.getElementById("inv-new-qty").value = "";
    document.getElementById("inv-new-min").value = "";
    document.getElementById("inv-new-cost").value = "";
    toast("✅ " + t("toast.itemAdded") || "تمت الإضافة");
    loadInventoryList();
  } catch (e) { toast(e.message); }
}

async function deleteInventory(id) {
  if (!user || user.role !== "manager") return;
  if (!confirm(t("confirmDelete"))) return;
  try {
    await api("/api/inventory/" + id, { method: "DELETE" });
    toast("✅ " + t("toast.deleted"));
    loadInventoryList();
  } catch (e) { toast(e.message); }
}

// ===== نقاط الولاء =====
let loyaltyCustomer = null;

async function showLoyaltyManager() {
  if (!user) return;
  loyaltyCustomer = null;
  document.getElementById("loyalty-phone").value = "";
  document.getElementById("loyalty-customer-info").style.display = "none";
  document.getElementById("loyalty-new-name").value = "";
  document.getElementById("loyalty-new-phone").value = "";
  openModal("modal-loyalty");
  loadCustomerList();
}

async function lookupCustomer() {
  const phone = document.getElementById("loyalty-phone").value.trim();
  if (!phone) { toast("⚠️ " + t("loyaltyEnterPhone")); return; }
  try {
    const c = await api("/api/customer/lookup?phone=" + encodeURIComponent(phone));
    loyaltyCustomer = c;
    document.getElementById("loyalty-cust-name").textContent = c.name;
    document.getElementById("loyalty-cust-phone").textContent = c.phone;
    document.getElementById("loyalty-cust-points").textContent = c.points;
    document.getElementById("loyalty-customer-info").style.display = "block";
  } catch (e) { toast("⚠️ " + e.message); }
}

async function addLoyaltyPoints() {
  if (!loyaltyCustomer) { toast("⚠️ " + t("loyaltySelectCustomer")); return; }
  const pts = parseInt(document.getElementById("loyalty-add-points").value) || 0;
  if (pts <= 0) { toast("⚠️ " + t("loyaltyInvalidPoints")); return; }
  try {
    const res = await api("/api/customer/" + loyaltyCustomer.id + "/points", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: pts })
    });
    loyaltyCustomer.points = res.points;
    document.getElementById("loyalty-cust-points").textContent = res.points;
    document.getElementById("loyalty-add-points").value = "";
    toast("✅ " + t("toast.loyaltyPointsAdded"));
    loadCustomerList();
  } catch (e) { toast(e.message); }
}

async function createCustomer() {
  const name = document.getElementById("loyalty-new-name").value.trim();
  const phone = document.getElementById("loyalty-new-phone").value.trim();
  if (!name) { toast("⚠️ " + t("loyaltyEnterName")); return; }
  try {
    await api("/api/customer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone })
    });
    document.getElementById("loyalty-new-name").value = "";
    document.getElementById("loyalty-new-phone").value = "";
    toast("✅ " + t("toast.customerAdded"));
    loadCustomerList();
  } catch (e) { toast(e.message); }
}

async function loadCustomerList() {
  try {
    const items = await api("/api/customer/list");
    const el = document.getElementById("loyalty-customer-list");
    if (!items.length) { el.innerHTML = `<div class="empty-state">${t("empty")}</div>`; return; }
    el.innerHTML = items.map(c => `<div class="emp-row" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <b>${esc(c.name)}</b>
        ${c.phone ? `<div style="font-size:12px;color:var(--text)">${c.phone}</div>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <span style="color:var(--primary);font-weight:700">${c.points} ${t("points")}</span>
      </div>
    </div>`).join("");
  } catch (e) { toast(e.message); }
}

// ===== الحجوزات =====
async function showReservationManager() {
  if (!user) return;
  openModal("modal-reservation");
  const sel = document.getElementById("res-new-table");
  sel.innerHTML = "";
  for (const n of Object.values(tableData).map(t => t.num).sort((a, b) => a - b)) {
    const opt = document.createElement("option");
    opt.value = n;
    opt.textContent = t("table") + " " + n;
    sel.appendChild(opt);
  }
  document.getElementById("res-new-date").value = new Date().toISOString().slice(0, 10);
  loadReservationList();
}

async function loadReservationList() {
  try {
    const items = await api("/api/reservation/list");
    const el = document.getElementById("reservation-list");
    if (!items.length) { el.innerHTML = `<div class="empty-state">${t("empty")}</div>`; return; }
    el.innerHTML = items.map(r => `<div class="emp-row" style="display:flex;justify-content:space-between;align-items:center;border-left:3px solid ${r.status === "confirmed" ? "var(--success)" : r.status === "cancelled" ? "var(--danger)" : "var(--warning)"}">
      <div>
        <b>${esc(r.customer_name)}</b>
        <div style="font-size:12px;color:var(--text)">
          <span data-i18n="table">${t("table")}</span> ${r.table_num} | ${r.date} ${r.time} | ${r.guests} <span data-i18n="guests">${t("guests")}</span>
          ${r.phone ? ` | ${r.phone}` : ""}
          ${r.notes ? `<br><i>${esc(r.notes)}</i>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        ${r.status === "pending" ? `<button class="btn btn-success" style="padding:4px 8px;font-size:12px" onclick="updateReservation(${r.id}, 'confirmed')" data-i18n="confirm">✓</button>` : ""}
        ${r.status !== "cancelled" ? `<button class="btn btn-danger" style="padding:4px 8px;font-size:12px" onclick="updateReservation(${r.id}, 'cancelled')" data-i18n="cancel">✕</button>` : ""}
      </div>
    </div>`).join("");
  } catch (e) { toast(e.message); }
}

async function createReservation() {
  if (!user) return;
  const customer_name = document.getElementById("res-new-name").value.trim();
  const phone = document.getElementById("res-new-phone").value.trim();
  const table_num = parseInt(document.getElementById("res-new-table").value);
  const date = document.getElementById("res-new-date").value;
  const time = document.getElementById("res-new-time").value;
  const guests = parseInt(document.getElementById("res-new-guests").value) || 1;
  const notes = document.getElementById("res-new-notes").value.trim();
  if (!customer_name || !date || !time) { toast("⚠️ " + t("reservationMissing")); return; }
  try {
    await api("/api/reservation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_name, phone, table_num, date, time, guests, notes })
    });
    document.getElementById("res-new-name").value = "";
    document.getElementById("res-new-phone").value = "";
    document.getElementById("res-new-guests").value = "1";
    document.getElementById("res-new-notes").value = "";
    toast("✅ " + t("toast.reservationCreated"));
    loadReservationList();
  } catch (e) { toast(e.message); }
}

async function updateReservation(id, status) {
  if (!user) return;
  try {
    await api("/api/reservation/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    toast("✅ " + t("toast.reservationUpdated"));
    loadReservationList();
  } catch (e) { toast(e.message); }
}

// ===== تقارير متقدمة =====
let chartInstances = {};

function destroyCharts() {
  if (!window.Chart) { chartInstances = {}; return; }
  Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch (e) {} });
  chartInstances = {};
}

let _chartJsPromise = null;
function loadChartJs() {
  if (window.Chart) return Promise.resolve();
  if (_chartJsPromise) return _chartJsPromise;
  _chartJsPromise = new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js";
    sc.async = true;
    sc.onload = () => resolve();
    sc.onerror = () => { _chartJsPromise = null; reject(new Error("chart.js")); };
    document.head.appendChild(sc);
  });
  return _chartJsPromise;
}

function renderDailyChart(rows) {
  const el = document.getElementById("chart-daily");
  if (!rows.length) { el.style.display = "none"; return; }
  el.style.display = "block";
  const labels = rows.map(r => r.date).reverse();
  const totals = rows.map(r => r.total).reverse();
  chartInstances.daily = new Chart(el, {
    type: "line",
    data: { labels, datasets: [{ label: t("totalSales"), data: totals, borderColor: "#0ea5e9", backgroundColor: "rgba(14,165,233,0.1)", fill: true, tension: 0.3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

function renderTopItemsChart(rows) {
  const el = document.getElementById("chart-top-items");
  if (!rows.length) { el.style.display = "none"; return; }
  el.style.display = "block";
  const labels = rows.map(r => r.name);
  const values = rows.map(r => r.qty);
  const colors = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];
  chartInstances.topItems = new Chart(el, {
    type: "bar",
    data: { labels, datasets: [{ label: t("orders"), data: values, backgroundColor: colors.slice(0, rows.length) }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", plugins: { legend: { display: false } } }
  });
}

function renderMethodChart(rows) {
  const el = document.getElementById("chart-method");
  if (!rows.length) { el.style.display = "none"; return; }
  el.style.display = "block";
  const labels = rows.map(r => methodName(r.payment_method));
  const values = rows.map(r => r.total);
  const colors = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
  chartInstances.method = new Chart(el, {
    type: "doughnut",
    data: { labels, datasets: [{ data: values, backgroundColor: colors.slice(0, rows.length) }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function renderHourChart(rows) {
  const el = document.getElementById("chart-hour");
  if (!rows.length) { el.style.display = "none"; return; }
  el.style.display = "block";
  const allHours = Array.from({ length: 24 }, (_, i) => i);
  const hourMap = {};
  rows.forEach(r => { hourMap[r.hour] = r.count; });
  const labels = allHours.map(h => h.toString().padStart(2, "0") + ":00");
  const values = allHours.map(h => hourMap[h] || 0);
  chartInstances.hour = new Chart(el, {
    type: "bar",
    data: { labels, datasets: [{ label: t("orders"), data: values, backgroundColor: "#8b5cf6" }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

// ===== أخرى =====
async function sendToKitchen() {
  if (!user) return;
  if (!cart.length) { toast("⚠️ " + t("toast.cartEmpty")); return; }
  if (!selectedTable) { toast("⚠️ " + t("toast.noTableSelected")); return; }
  const guests = parseInt(document.getElementById("guests").value) || 1;
  const w = window.open("", "_blank", "width=320,height=560");
  try {
    const res = await api("/api/order/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_num: selectedTable, items: cart, discount, guests })
    });
    toast("🍳 " + t("toast.sentKitchen") + " #" + res.order_id + " " + t("toast.toKitchen") + " " + selectedTable);
    loadTables();
    if (w) printKitchenTicket(w, res.order_id, selectedTable, guests);
    if (window.innerWidth <= 768) { switchPanel("tables"); }
  } catch (e) {
    if (w) w.close();
    toast(e.message);
  }
}

function printKitchenTicket(w, oid, table, guests) {
  const rows = cart.map(i =>
    `<tr>
      <td style="text-align:right;font-size:19px;padding:4px 0">${i.emoji || ""} ${i.name}</td>
      <td style="text-align:center;font-weight:bold;font-size:22px">x${i.qty}</td>
    </tr>`).join("");
  const now = new Date().toLocaleString(currentLang);
  const dir = document.documentElement.dir;
  w.document.write(`<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${t("kitchenTicket")} #${oid}</title><style>
    body{font-family:'Segoe UI',Tahoma,sans-serif;width:290px;margin:0 auto;text-align:center;font-size:13px;color:#000}
    h2{margin:2px 0;font-size:20px}.muted{font-size:11px;color:#555}
    .dash{border-top:1px dashed #000;margin:6px 0}
    .big{font-size:30px;font-weight:bold}
    table{width:100%;border-collapse:collapse}td{padding:2px 0}
  </style></head><body>
    <h2>🧑‍🍳 ${t("kitchenOrder")}</h2>
    <div class="muted">${RESTAURANT_NAME}</div>
    <div class="dash"></div>
    <div>${t("orderLabel")} #${oid}</div>
    <div class="big">${t("table")} ${table}</div>
    <div class="muted">${t("guestsLabel")} ${guests}</div>
    <div class="dash"></div>
    <table>${rows}</table>
    <div class="dash"></div>
    <div class="muted">${now}</div>
  </body></html>`);
  w.document.close();
  w.focus();
  w.print();
  w.close();
}

async function showReports() {
  if (!user) { toast(t("err.loginFirst")); return; }
  applyLang();
  destroyCharts();
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("report-from").value = today;
  document.getElementById("report-to").value = today;

  if (user.role === "manager") {
    document.getElementById("report-tabs").style.display = "";
    document.getElementById("report-filter").style.display = "";
    openModal("reports-modal");
    await loadReportData();
  } else {
    document.getElementById("report-tabs").style.display = "none";
    document.getElementById("report-filter").style.display = "none";
    openModal("reports-modal");
    await loadCashierReport();
  }
}

async function loadCashierReport() {
  try {
    const d = await api("/api/reports/cashier-daily");
    const c = document.getElementById("report-content");
    c.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t("rptCashierDailyTitle", { name: user.name })}</div>
        <div class="report-kpi">
          <div class="report-kpi-item"><div class="report-kpi-value">${d.my_count}</div><div class="report-kpi-label">${t("rptMyOrdersToday")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.my_total)}</div><div class="report-kpi-label">${t("rptMySalesTotal")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value">${d.all_count}</div><div class="report-kpi-label">${t("rptBranchOrdersTotal")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.all_total)}</div><div class="report-kpi-label">${t("rptBranchSalesTotal")}</div></div>
        </div>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t("rptMyTodayOrders")}</div>
        <table class="report-table">
          <tr><th>${t("rptTime")}</th><th>${t("rptTable")}</th><th>${t("rptAmount")}</th><th>${t("rptMethod")}</th></tr>
          ${(d.my_orders || []).map(o => `<tr><td>${o.date?.split(" ")[1] || o.date}</td><td>${o.table_num}</td><td>${fmtCur(o.total)}</td><td>${methodName(o.payment_method)}</td></tr>`).join("")}
          ${d.my_orders && d.my_orders.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--muted)">' + t("rptNoOrdersToday") + '</td></tr>' : ""}
        </table>
      </div>`;
  } catch (e) { toast(e.message); }
}

let currentReportTab = "overview";
let reportData = {};
let reportOrders = [];
let reportFilters = { method: "", employee: "", item: "", table: "", day: "", month: "", hour: "", section: "" };
let creditFilterStatus = "open";
let creditSearchVal = "";

function escq(s) { return String(s == null ? "" : s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function buildReportQuery() {
  const p = [];
  const from = document.getElementById("report-from").value;
  const to = document.getElementById("report-to").value;
  if (from) p.push("from=" + encodeURIComponent(from));
  if (to) p.push("to=" + encodeURIComponent(to));
  for (const k of ["method", "employee", "item", "table", "day", "month", "hour", "section"]) {
    const v = reportFilters[k];
    if (v !== "") p.push(k + "=" + encodeURIComponent(v));
  }
  return p.join("&");
}

function getActiveFilterLabel() {
  const parts = [];
  if (reportFilters.method) parts.push(t("rptMethod") + ": " + methodName(reportFilters.method));
  if (reportFilters.employee) parts.push(t("rptEmployee") + ": " + reportFilters.employee);
  if (reportFilters.item) parts.push(t("rptItem") + ": " + reportFilters.item);
  if (reportFilters.table) parts.push(t("rptTable") + ": " + reportFilters.table);
  if (reportFilters.day) parts.push(t("rptDate") + ": " + reportFilters.day);
  if (reportFilters.month) parts.push(t("rptMonth") + ": " + reportFilters.month);
  if (reportFilters.hour !== "") parts.push(t("rptHour") + ": " + reportFilters.hour + ":00");
  if (reportFilters.section) parts.push(t("rptSection") + ": " + reportFilters.section);
  return parts.join(" · ");
}

function setReportFilter(k, v) {
  reportFilters[k] = v || "";
  loadReportData();
}

function applyReportDrill(k, v) {
  reportFilters[k] = v || "";
  const map = { method: "filter-method", employee: "filter-employee", item: "filter-item", table: "filter-table" };
  const id = map[k];
  if (id) { const el = document.getElementById(id); if (el) el.value = v || ""; }
  loadReportData();
}

function clearReportFilters() {
  reportFilters = { method: "", employee: "", item: "", table: "", day: "", month: "", hour: "", section: "" };
  ["filter-method", "filter-employee", "filter-item", "filter-table"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  loadReportData();
}

function fillSelect(id, values, selected) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">${t("rptAll")}</option>` + values.map(v =>
    `<option value="${escq(v)}" ${String(v) === String(selected) ? "selected" : ""}>${escapeHtml(v)}</option>`
  ).join("");
}

function populateReportFilters() {
  const d = reportData;
  fillSelect("filter-method", (d.by_method || []).map(m => m.method), reportFilters.method);
  fillSelect("filter-employee", (d.by_employee || []).map(e => e.employee), reportFilters.employee);
  fillSelect("filter-item", (d.top_items || []).map(i => i.name), reportFilters.item);
  const nums = [...new Set(Object.values(tableData).map(t => String(t.num)))].sort((a, b) => Number(a) - Number(b));
  fillSelect("filter-table", nums, reportFilters.table);
  const hint = document.getElementById("report-drill-hint");
  if (hint) hint.style.display = "";
}

async function loadReportData() {
  try {
    reportData = await api("/api/reports/advanced?" + buildReportQuery());
    renderReportTab();
    populateReportFilters();
    await loadReportDetail();
  } catch (e) { toast(e.message); }
}

async function loadReportDetail() {
  const box = document.getElementById("report-detail");
  if (!box) return;
  try {
    const d = await api("/api/reports/orders?" + buildReportQuery());
    reportOrders = d.orders || [];
    renderReportDetail();
  } catch (e) { box.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

function renderReportDetail() {
  const box = document.getElementById("report-detail");
  const orders = reportOrders;
  const label = getActiveFilterLabel();
  const max = 200;
  const shown = orders.slice(0, max);
  box.innerHTML = `
    <div class="report-section" style="margin-top:10px">
      <div class="report-section-title">${t("rptDetailsTitle")} (${orders.length})</div>
      ${label ? `<div class="report-filter-badge">🔎 ${label} <button class="btn btn-sm" onclick="clearReportFilters()">${t("rptClearFilters")}</button></div>` : ""}
      <table class="report-table">
        <tr><th>#</th><th>${t("rptTime")}</th><th>${t("rptTable")}</th><th>${t("rptCashier")}</th><th>${t("rptMethod")}</th><th>${t("rptItems")}</th><th>${t("rptTotal")}</th></tr>
        ${shown.length ? shown.map(o => `
          <tr class="report-order-row" onclick="toggleReportOrderDetail(${o.id})" title="${t("rptDrillHint")}">
            <td>#${o.id}</td><td>${o.date}</td><td>${o.table_num || "-"}</td>
            <td>${escapeHtml(o.employee)}</td><td>${methodName(o.payment_method)}</td>
            <td>${(o.items || []).map(i => `${i.qty || 1}× ${escapeHtml(i.name)}`).join(", ")}</td>
            <td>${fmtCur(o.total)}</td>
          </tr>
          <tr id="order-detail-${o.id}" class="report-order-detail" style="display:none">
            <td colspan="7">
              <table class="report-table report-table-sub">
                <tr><th>${t("rptItem")}</th><th>${t("rptQty")}</th><th>${t("rptPrice")}</th><th>${t("rptAmount")}</th></tr>
                ${(o.items || []).map(i => `<tr><td>${escapeHtml(i.name)}</td><td>${i.qty || 1}</td><td>${fmtCur(i.price)}</td><td>${fmtCur(i.subtotal != null ? i.subtotal : (i.price * (i.qty || 1)))}</td></tr>`).join("")}
                ${o.discount ? `<tr><td>${t("rptDiscountsGiven")}</td><td colspan="2"></td><td class="report-loss">-${fmtCur(o.discount)}</td></tr>` : ""}
                ${o.tax ? `<tr><td>${t("rptTaxCollected")}</td><td colspan="2"></td><td>${fmtCur(o.tax)}</td></tr>` : ""}
                <tr class="total-row"><td colspan="3">${t("rptTotal")}</td><td>${fmtCur(o.total)}</td></tr>
              </table>
            </td>
          </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--muted)">${t("rptNoOrdersMatch")}</td></tr>`}
      </table>
      ${orders.length > max ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">${t("rptShowingFirst", { n: max, total: orders.length })}</div>` : ""}
    </div>`;
}

function toggleReportOrderDetail(id) {
  const el = document.getElementById("order-detail-" + id);
  if (el) el.style.display = (el.style.display === "none") ? "" : "none";
}

async function switchReportTab(tab) {
  currentReportTab = tab;
  document.querySelectorAll(".report-tab").forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");
  await loadReportData();
}

function renderReportTab() {
  const c = document.getElementById("report-content");
  const charts = document.getElementById("report-charts");
  charts.style.display = "none";

  switch (currentReportTab) {
    case "overview": renderOverview(c); charts.style.display = ""; break;
    case "daily": renderDaily(c); break;
    case "monthly": renderMonthly(c); break;
    case "profitloss": renderProfitLoss(c); break;
    case "tax": renderTax(c); break;
    case "employees": renderEmployees(c); break;
    case "inventory": renderInventory(c); break;
    case "peak": renderPeak(c); break;
    case "tables": renderTablesReport(c); break;
    case "credit": renderCredit(c); break;
    case "expenses": renderExpenses(c); break;
    case "income": renderIncome(c); break;
    case "cashflow": renderCashFlow(c); break;
    case "ar": renderAR(c); break;
    case "cancelled": renderCancelled(c); break;
  }
}

function renderOverview(c) {
  const d = reportData;
  c.innerHTML = `
    <div class="report-kpi">
      <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.total_sales)}</div><div class="report-kpi-label">${t("rptTotalSales")}</div></div>
      <div class="report-kpi-item"><div class="report-kpi-value">${d.order_count}</div><div class="report-kpi-label">${t("rptOrderCount")}</div></div>
      <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.avg_order)}</div><div class="report-kpi-label">${t("rptAvgOrder")}</div></div>
      <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.total_tax)}</div><div class="report-kpi-label">${t("rptTotalTax")}</div></div>
    </div>
    <div class="report-section">
      <div class="report-section-title">${t("rptSalesByMethod")}</div>
      <table class="report-table">
        <tr><th>${t("rptMethod")}</th><th>${t("rptOrders")}</th><th>${t("rptAmount")}</th><th>${t("rptPercent")}</th></tr>
        ${(d.by_method || []).map(m => {
          const pct = d.total_sales > 0 ? ((m.total / d.total_sales) * 100).toFixed(1) : 0;
          return `<tr class="report-drill" onclick="applyReportDrill('method', '${escq(m.method)}')" title="${t("rptDrillHint")}"><td>${methodName(m.method)}</td><td>${m.count}</td><td>${fmtCur(m.total)}</td><td>${pct}%</td></tr>`;
        }).join("")}
      </table>
    </div>
    <div class="report-section">
      <div class="report-section-title">${t("rptTopItems")}</div>
      <table class="report-table">
        <tr><th>${t("rptItem")}</th><th>${t("rptQty")}</th><th>${t("rptRevenue")}</th></tr>
        ${(d.top_items || []).slice(0, 10).map(i => `<tr class="report-drill" onclick="applyReportDrill('item', '${escq(i.name)}')" title="${t("rptDrillHint")}"><td>${i.name}</td><td>${i.qty}</td><td>${fmtCur(i.revenue)}</td></tr>`).join("")}
      </table>
    </div>`;
  renderCharts(d);
}

function renderDaily(c) {
  const d = reportData;
  c.innerHTML = `
    <div class="report-kpi">
      <div class="report-kpi-item"><div class="report-kpi-value">${d.order_count}</div><div class="report-kpi-label">${t("rptPeriodOrders")}</div></div>
      <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.total_sales)}</div><div class="report-kpi-label">${t("rptPeriodSales")}</div></div>
    </div>
    <div class="report-section">
      <div class="report-section-title">${t("rptDailySales")}</div>
      <table class="report-table">
        <tr><th>${t("rptDate")}</th><th>${t("rptOrders")}</th><th>${t("rptTotalSales")}</th><th>${t("rptAvg")}</th></tr>
        ${(d.daily || []).map(day => {
          const avg = day.count > 0 ? day.total / day.count : 0;
          return `<tr class="report-drill" onclick="applyReportDrill('day', '${day.date}')" title="${t("rptDrillHint")}"><td>${day.date}</td><td>${day.count}</td><td>${fmtCur(day.total)}</td><td>${fmtCur(avg)}</td></tr>`;
        }).join("")}
        <tr class="total-row"><td>${t("rptTotal")}</td><td>${d.order_count}</td><td>${fmtCur(d.total_sales)}</td><td>${fmtCur(d.avg_order)}</td></tr>
      </table>
    </div>`;
}

function renderMonthly(c) {
  const d = reportData;
  const monthly = {};
  (d.daily || []).forEach(day => {
    const month = day.date.slice(0, 7);
    if (!monthly[month]) monthly[month] = { total: 0, count: 0 };
    monthly[month].total += day.total;
    monthly[month].count += day.count;
  });
  const months = Object.entries(monthly).sort((a, b) => b[0].localeCompare(a[0]));
  c.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t("rptMonthlySales")}</div>
      <table class="report-table">
        <tr><th>${t("rptMonth")}</th><th>${t("rptOrders")}</th><th>${t("rptTotalSales")}</th><th>${t("rptAvg")}</th></tr>
        ${months.map(([m, v]) => {
          const avg = v.count > 0 ? v.total / v.count : 0;
          return `<tr class="report-drill" onclick="applyReportDrill('month', '${m}')" title="${t("rptDrillHint")}"><td>${m}</td><td>${v.count}</td><td>${fmtCur(v.total)}</td><td>${fmtCur(avg)}</td></tr>`;
        }).join("")}
        <tr class="total-row"><td>${t("rptTotal")}</td><td>${d.order_count}</td><td>${fmtCur(d.total_sales)}</td><td>${fmtCur(d.avg_order)}</td></tr>
      </table>
    </div>`;
}

function renderProfitLoss(c) {
  const d = reportData;
  const revenue = d.total_sales || 0;
  const tax = d.total_tax || 0;
  const netRevenue = revenue - tax;
  const expenses = d.expenses_total || 0;
  const cogs = d.cogs_actual || 0;
  const grossProfit = netRevenue - cogs;
  const netProfit = grossProfit - expenses;
  c.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t("rptPLTitle")}</div>
      <table class="report-table">
        <tr><th>${t("rptItemLabel")}</th><th>${t("rptAmount")}</th></tr>
        <tr><td>📊 ${t("rptTotalSales")}</td><td class="report-profit">${fmtCur(revenue)}</td></tr>
        <tr><td>${t("rptTaxPaid")}</td><td class="report-loss">-${fmtCur(tax)}</td></tr>
        <tr><td>${t("rptNetRevenue")}</td><td>${fmtCur(netRevenue)}</td></tr>
        <tr><td>${t("rptCOGS")}</td><td class="report-loss">-${fmtCur(cogs)}</td></tr>
        <tr class="total-row"><td>${t("rptGrossProfit")}</td><td class="${grossProfit >= 0 ? 'report-profit' : 'report-loss'}">${fmtCur(grossProfit)}</td></tr>
        <tr><td>${t("rptExpenses")}</td><td class="report-loss">-${fmtCur(expenses)}</td></tr>
        <tr class="total-row"><td>${t("rptNetProfit")}</td><td class="${netProfit >= 0 ? 'report-profit' : 'report-loss'}">${fmtCur(netProfit)}</td></tr>
      </table>
      ${cogs === 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">${t("rptCOGSNote")}</div>` : ""}
    </div>
    <div class="report-section">
      <div class="report-section-title">${t("rptRatios")}</div>
      <div class="report-kpi">
        <div class="report-kpi-item"><div class="report-kpi-value">${revenue > 0 ? ((tax / revenue) * 100).toFixed(1) : 0}%</div><div class="report-kpi-label">${t("rptTaxRatio")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${revenue > 0 ? ((cogs / revenue) * 100).toFixed(1) : 0}%</div><div class="report-kpi-label">${t("rptCostRatio")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) : 0}%</div><div class="report-kpi-label">${t("rptNetMargin")}</div></div>
      </div>
    </div>`;
}

function renderCashFlow(c) {
  const d = reportData;
  c.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t("rptCashFlowTitle")}</div>
      <table class="report-table">
        <tr><th>${t("rptItemLabel")}</th><th>${t("rptAmount")}</th></tr>
        <tr><td>${t("rptCashReceipts")}</td><td class="report-profit">${fmtCur(d.cash_received || 0)}</td></tr>
        <tr><td>${t("rptCreditCollected")}</td><td class="report-profit">${fmtCur(d.credit_collected || 0)}</td></tr>
        <tr class="total-row"><td>${t("rptTotalInflows")}</td><td class="report-profit">${fmtCur(d.cash_in || 0)}</td></tr>
        <tr><td>${t("rptExpensesPaid")}</td><td class="report-loss">-${fmtCur(d.cash_out || 0)}</td></tr>
        <tr class="total-row"><td>${t("rptNetCashFlow")}</td><td class="${(d.net_cash_flow||0) >= 0 ? 'report-profit' : 'report-loss'}">${fmtCur(d.net_cash_flow || 0)}</td></tr>
      </table>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">${t("rptCashFlowNote", { amt: fmtCur(d.receivable_total || 0) })}</div>
    </div>`;
}

async function renderAR(c) {
  const from = document.getElementById("report-from").value;
  const to = document.getElementById("report-to").value;
  c.innerHTML = `<div class="report-section"><div class="report-section-title">${t("rptARTitle")}</div><p style="color:var(--muted);font-size:12px">${t("rptLoading")}</p></div>`;
  try {
    const d = await api("/api/reports/ar?from=" + encodeURIComponent(from || "") + "&to=" + encodeURIComponent(to || ""));
    const s = d.summary;
    const recon = s.total_invoiced - (s.total_paid + s.total_open_due);
    const agingRows = [
      { k: "current", lbl: t("rptAgingCurrent") },
      { k: "31_60", lbl: t("rptAging31_60") },
      { k: "61_90", lbl: t("rptAging61_90") },
      { k: "90_plus", lbl: t("rptAging90") },
    ];
    const aging = {};
    (d.aging || []).forEach(a => { aging[a.bucket] = a; });
    c.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t("rptARTitle")} <span style="font-weight:400;font-size:11px;color:var(--muted)">${t("rptAsOf")} ${d.as_of}</span></div>
        <div class="report-kpi">
          <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(s.total_invoiced)}</div><div class="report-kpi-label">${t("rptTotalInvoiced")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--success)">${fmtCur(s.total_paid)}</div><div class="report-kpi-label">${t("rptTotalCollected")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--danger)">${fmtCur(s.total_open_due)}</div><div class="report-kpi-label">${t("rptOpenDue")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value">${s.open_count}</div><div class="report-kpi-label">${t("rptOpenAccounts")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value">${s.settled_count}</div><div class="report-kpi-label">${t("rptSettledAccounts")}</div></div>
        </div>
        <div class="report-kpi">
          <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.period_new)}</div><div class="report-kpi-label">${t("rptPeriodNew")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--success)">${fmtCur(d.period_collected)}</div><div class="report-kpi-label">${t("rptPeriodCollected")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value" style="color:${s.overpaid_count ? "var(--danger)" : "var(--muted)"}">${s.overpaid_count}${s.overpaid_amount ? " · " + fmtCur(s.overpaid_amount) : ""}</div><div class="report-kpi-label">${t("rptOverpaid")}</div></div>
        </div>
        <div style="font-size:11px;color:var(--muted)">${t("rptReconNote")}: ${fmtCur(s.total_invoiced)} = ${fmtCur(s.total_paid)} + ${fmtCur(s.total_open_due)}${Math.abs(recon) > 0.01 ? ` <b style="color:${recon > 0 ? "var(--danger)" : "var(--warning)"}">(${t("rptDifference")}: ${fmtCur(recon)})</b>` : ""}</div>
      </div>

      <div class="report-section">
        <div class="report-section-title">${t("rptAgingTitle")}</div>
        <table class="report-table">
          <tr><th>${t("rptAgingBucket")}</th><th>${t("rptAccounts")}</th><th>${t("rptRemaining")}</th></tr>
          ${agingRows.map(a => { const v = aging[a.k] || { count: 0, total: 0 }; return `<tr><td>${a.lbl}</td><td>${v.count}</td><td style="color:var(--danger)">${fmtCur(v.total)}</td></tr>`; }).join("")}
          <tr class="total-row"><td>${t("rptTotal")}</td><td>${s.open_count}</td><td>${fmtCur(s.total_open_due)}</td></tr>
        </table>
      </div>

      <div class="report-section">
        <div class="report-section-title">${t("rptAccountsByCustomer")} (${d.customers.length})</div>
        <table class="report-table">
          <tr><th>#</th><th>${t("rptCustomer")}</th><th>${t("rptInvoice")}</th><th>${t("rptDate")}</th><th>${t("rptTotal")}</th><th>${t("rptPaid")}</th><th>${t("rptRemaining")}</th><th>${t("rptDays")}</th><th>${t("rptStatus")}</th><th></th></tr>
          ${d.customers.length ? d.customers.map(x => `
            <tr class="report-order-row" onclick="toggleArStatement(${x.id})">
              <td>#${x.id}</td>
              <td>${escapeHtml(x.customer_name)}</td>
              <td>#${x.order_id || "-"}</td>
              <td style="font-size:11px">${x.created_at}</td>
              <td>${fmtCur(x.total)}</td>
              <td style="color:var(--success)">${fmtCur(x.paid)}</td>
              <td style="color:${x.due > 0 ? "var(--danger)" : "var(--muted)"};font-weight:bold">${fmtCur(x.due)}</td>
              <td>${x.days_open}</td>
              <td style="color:${x.status === "open" ? "var(--danger)" : "var(--success)"}">${x.status === "open" ? t("rptOpen") : t("rptSettled")}</td>
              <td><button class="btn btn-sm" onclick="event.stopPropagation();toggleArStatement(${x.id})">${t("rptStatement")}</button></td>
            </tr>
            <tr id="ar-statement-${x.id}" class="report-order-detail" style="display:none">
              <td colspan="10">
                ${x.payments && x.payments.length ? `
                  <div style="font-weight:bold;margin-bottom:6px;font-size:12px">${t("rptPaymentOpsFor")}: ${escapeHtml(x.customer_name)}</div>
                  <table class="report-table report-table-sub">
                    <tr><th>#</th><th>${t("rptDate")}</th><th>${t("rptAmount")}</th><th>${t("rptMethod")}</th><th>${t("rptCashier")}</th></tr>
                    ${x.payments.map(p => `<tr><td>#${p.id}</td><td>${p.date}</td><td style="color:var(--success)">+${fmtCur(p.amount)}</td><td>${methodName(p.method)}</td><td>${escapeHtml(p.employee || "")}</td></tr>`).join("")}
                    <tr class="total-row"><td colspan="2">${t("rptTotalCollected")}</td><td>${fmtCur(x.paid)}</td><td colspan="2">${t("rptBalance")}: ${fmtCur(x.due)}</td></tr>
                  </table>
                  <div style="font-size:11px;color:var(--muted);margin-top:4px">${t("rptReconNote")}: ${fmtCur(x.total)} = ${fmtCur(x.paid)} + ${fmtCur(x.due)}</div>` :
                  `<div style="font-size:11px;color:var(--muted)">${t("rptNoPayments")}</div>`}
              </td>
            </tr>`).join("") : `<tr><td colspan="10" style="text-align:center;color:var(--muted)">${t("rptNoAR")}</td></tr>`}
        </table>
      </div>

      <div class="report-section">
        <div class="report-section-title">${t("rptPaymentOps")} (${d.payments.length})</div>
        <table class="report-table">
          <tr><th>#</th><th>${t("rptDate")}</th><th>${t("rptCustomer")}</th><th>${t("rptAmount")}</th><th>${t("rptMethod")}</th><th>${t("rptCashier")}</th></tr>
          ${d.payments.length ? d.payments.map(p => `<tr><td>#${p.id}</td><td>${p.date}</td><td>${escapeHtml(p.customer_name || "")}</td><td style="color:var(--success)">${fmtCur(p.amount)}</td><td>${methodName(p.method)}</td><td>${escapeHtml(p.employee || "")}</td></tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--muted)">${t("rptNoPaymentsPeriod")}</td></tr>`}
        </table>
      </div>`;
  } catch (e) { c.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

function toggleArStatement(id) {
  const el = document.getElementById("ar-statement-" + id);
  if (el) el.style.display = (el.style.display === "none") ? "" : "none";
}

async function renderCancelled(c) {
  const from = document.getElementById("report-from").value;
  const to = document.getElementById("report-to").value;
  c.innerHTML = `<div class="report-section"><div class="report-section-title">${t("rptCancelledTitle")}</div><p style="color:var(--muted);font-size:12px">${t("rptLoading")}</p></div>`;
  try {
    const d = await api("/api/reports/cancelled?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to));
    const el = c.querySelector(".report-section");
    el.innerHTML = `
      <div class="report-section-title">${t("rptCancelledTitle")}</div>
      <div class="report-kpi">
        <div class="report-kpi-item"><div class="report-kpi-value">${d.count}</div><div class="report-kpi-label">${t("rptCancelledOrders")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--danger)">${fmtCur(d.total)}</div><div class="report-kpi-label">${t("rptCancelledValue")}</div></div>
      </div>
      <table class="report-table">
        <tr><th>#</th><th>${t("rptDate")}</th><th>${t("rptTable")}</th><th>${t("rptCashier")}</th><th>${t("rptTotal")}</th><th>${t("rptReason")}</th></tr>
        ${d.items.length ? d.items.map(x => `<tr>
          <td>#${x.id}</td><td>${x.date}</td><td>${x.table_num}</td>
          <td>${escapeHtml(x.employee||"")}</td><td style="color:var(--danger)">${fmtCur(x.total||0)}</td>
          <td>${x.cancel_reason || escapeHtml(x.credit_name||"") || "—"}</td>
        </tr>`).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--muted)">${t("rptNoCancelled")}</td></tr>`}
      </table>`;
  } catch (e) { c.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

function renderTax(c) {
  const d = reportData;
  const taxRate = TAX_RATE || 0.03;
  c.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t("rptTaxReport")}</div>
      <div class="report-kpi">
        <div class="report-kpi-item"><div class="report-kpi-value">${(taxRate * 100).toFixed(0)}%</div><div class="report-kpi-label">${t("rptTaxRate")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.total_tax)}</div><div class="report-kpi-label">${t("rptTotalTaxCollected")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${d.order_count}</div><div class="report-kpi-label">${t("rptTaxableOrders")}</div></div>
      </div>
      <table class="report-table">
        <tr><th>${t("rptMonth")}</th><th>${t("rptTotalTax")}</th><th>${t("rptTotalSales")}</th></tr>
        ${(() => {
          const months = {};
          (d.daily || []).forEach(day => {
            const month = day.date.slice(0, 7);
            if (!months[month]) months[month] = { tax: 0, sales: 0 };
            months[month].tax += day.total * taxRate;
            months[month].sales += day.total;
          });
          return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([m, v]) =>
            `<tr class="report-drill" onclick="applyReportDrill('month', '${m}')" title="${t("rptDrillHint")}"><td>${m}</td><td>${fmtCur(v.tax)}</td><td>${fmtCur(v.sales)}</td></tr>`
          ).join("");
        })()}
        <tr class="total-row"><td>${t("rptTotal")}</td><td>${fmtCur(d.total_tax)}</td><td>${fmtCur(d.total_sales)}</td></tr>
      </table>
    </div>`;
}

function renderEmployees(c) {
  const d = reportData;
  c.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t("rptEmpPerformance")}</div>
      <table class="report-table">
        <tr><th>${t("rptEmployee")}</th><th>${t("rptOrders")}</th><th>${t("rptTotalSales")}</th><th>${t("rptAvg")}</th></tr>
        ${(d.by_employee || []).map(e => {
          const avg = e.count > 0 ? e.total / e.count : 0;
          return `<tr class="report-drill" onclick="applyReportDrill('employee', '${escq(e.employee)}')" title="${t("rptDrillHint")}"><td>${e.employee}</td><td>${e.count}</td><td>${fmtCur(e.total)}</td><td>${fmtCur(avg)}</td></tr>`;
        }).join("")}
        <tr class="total-row"><td>${t("rptTotal")}</td><td>${d.order_count}</td><td>${fmtCur(d.total_sales)}</td><td>${fmtCur(d.avg_order)}</td></tr>
      </table>
    </div>`;
}

function renderInventory(c) {
  c.innerHTML = `<div id="inventory-report-content" class="report-section"><div class="report-section-title">${t("rptInventoryStatus")}</div><p style="color:var(--muted);font-size:12px">${t("rptLoading")}</p></div>`;
  api("/api/inventory/list").then(items => {
    const el = document.getElementById("inventory-report-content");
    if (!el) return;
    const low = items.filter(i => i.quantity <= i.min_stock);
    el.innerHTML = `
      <div class="report-section-title">${t("rptInventoryStatus")}</div>
      <div class="report-kpi">
        <div class="report-kpi-item"><div class="report-kpi-value">${items.length}</div><div class="report-kpi-label">${t("rptTotalItems")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--danger)">${low.length}</div><div class="report-kpi-label">${t("rptLowStock")}</div></div>
      </div>
      <table class="report-table">
        <tr><th>${t("rptItem")}</th><th>${t("rptQty")}</th><th>${t("rptMinStock")}</th><th>${t("rptStatus")}</th></tr>
        ${items.map(i => {
          const status = i.quantity <= i.min_stock ? t("rptLow") : t("rptAvailable");
          return `<tr><td>${escapeHtml(i.item_name)}</td><td>${i.quantity} ${i.unit || ''}</td><td>${i.min_stock}</td><td>${status}</td></tr>`;
        }).join("")}
      </table>`;
  }).catch(() => {});
}

function renderCredit(c) {
  const st = (creditFilterStatus || "open");
  c.innerHTML = `<div id="credit-report-content">
    <div class="report-section-title">${t("rptCreditLedger")}</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      <input type="search" id="credit-search" class="login-input" style="flex:1;min-width:150px" placeholder="${t("rptSearchByName")}"
        oninput="creditSearchVal=this.value; renderCredit(document.getElementById('report-content'))" value="${escq(creditSearchVal||'')}">
      <select id="credit-status" class="login-input" style="width:auto"
        onchange="creditFilterStatus=this.value; renderCredit(document.getElementById('report-content'))">
        <option value="open" ${st==='open'?'selected':''}>${t("rptOpen")}</option>
        <option value="settled" ${st==='settled'?'selected':''}>${t("rptSettled")}</option>
        <option value="" ${st===''?'selected':''}>${t("rptAll")}</option>
      </select>
      <button class="btn btn-sm btn-info" onclick="loadCreditReport()">${t("rptRefresh")}</button>
    </div>
    <div id="credit-report-body" style="color:var(--muted);font-size:12px">${t("rptLoading")}</div>
  </div>`;
  loadCreditReport();
}

async function loadCreditReport() {
  const body = document.getElementById("credit-report-body");
  if (!body) return;
  try {
    const [rows, summary] = await Promise.all([
      api("/api/credit/list?status=" + encodeURIComponent(creditFilterStatus||"") + "&q=" + encodeURIComponent(creditSearchVal||"")),
      api("/api/credit/summary")
    ]);
    const rowsF = (creditSearchVal||"").trim() ? rows : rows;
    body.innerHTML = `
      <div class="report-kpi">
        <div class="report-kpi-item"><div class="report-kpi-value">${summary.open_count}</div><div class="report-kpi-label">${t("rptOpenBalances")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(summary.remaining)}</div><div class="report-kpi-label">${t("rptTotalRemaining")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(summary.today_collected)}</div><div class="report-kpi-label">${t("rptCollectedToday")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${summary.today_opened}</div><div class="report-kpi-label">${t("rptNewToday")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${summary.settled}</div><div class="report-kpi-label">${t("rptSettledCount")}</div></div>
      </div>
      <table class="report-table">
        <tr><th>#</th><th>${t("rptCustomer")}</th><th>${t("rptOrder")}</th><th>${t("rptStatus")}</th><th>${t("rptTotal")}</th><th>${t("rptPaid")}</th><th>${t("rptRemaining")}</th><th>${t("rptPayments")}</th><th>${t("rptCollect")}</th></tr>
        ${rowsF.length ? rowsF.map(r => {
          const rem = r.total - r.paid;
          return `<tr>
            <td>#${r.id}</td><td>${escapeHtml(r.customer_name)}</td>
            <td>#${r.order_id || "-"}</td>
            <td style="color:${r.status==='settled'?'var(--success)':'var(--info)'}">${r.status==='settled'?t("rptSettled"):'&nbsp;'}</td>
            <td>${fmtCur(r.total)}</td><td>${fmtCur(r.paid)}</td>
            <td style="color:${rem>0?'var(--danger)':'var(--muted)'}">${fmtCur(rem)}</td>
            <td><button class="btn btn-sm" onclick="showCreditPayments(${r.id})">👁 ${t("rptPayments")}</button></td>
            <td>
              ${r.status==='open' ? `<div style="display:flex;gap:4px">
                <input type="number" id="credit-pay-${r.id}" class="login-input" style="width:90px;padding:4px;font-size:12px" placeholder="${t("rptAmount")}" min="0">
                <button class="btn btn-sm btn-success" onclick="settleCredit(${r.id}, ${r.total}, ${r.paid})">💵</button>
              </div>` : `<span style="color:var(--muted)">—</span>`}
            </td>
          </tr>`;
        }).join("") : `<tr><td colspan="9" style="text-align:center;color:var(--muted)">${t("rptNoRecords")}</td></tr>`}
      </table>`;
  } catch (e) { body.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

async function showCreditPayments(lid) {
  try {
    const rows = await api("/api/credit/" + lid + "/payments");
    const html = rows.length ? rows.map(p => `
      <div style="display:flex;justify-content:space-between;padding:6px 4px;border-bottom:1px solid var(--border);font-size:13px">
        <span>${p.date}</span>
        <span>${methodName(p.method)}</span>
        <b>${fmtCur(p.amount)}</b>
      </div>`).join("") : `<div style="color:var(--muted);text-align:center;padding:10px">${t("rptNoPayments")}</div>`;
    const d = document.createElement("div");
    d.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000";
    d.innerHTML=`<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;width:360px;max-width:90vw">
      <div style="font-weight:bold;margin-bottom:10px">${t("rptPayHistoryTitle", { id: lid })}</div>
      ${html}
      <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeCreditPayments(this)">${t("rptClose")}</button></div>
    </div>`;
    document.body.appendChild(d);
  } catch (e) { toast(e.message); }
}

function closeCreditPayments(btn) {
  const outer = btn.closest("div[style*='position:fixed']");
  if (outer) outer.remove();
}

async function settleCredit(lid, total, paid) {
  const input = document.getElementById("credit-pay-" + lid);
  if (!input) return;
  const amount = parseFloat(input.value) || 0;
  const rem = total - paid;
  if (amount <= 0) { toast(t("rptEnterValidAmount")); return; }
  if (amount > rem + 0.001) { toast(t("rptAmountExceeds", { amt: fmtCur(rem) })); return; }
  try {
    const res = await api("/api/credit/settle", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ledger_id: lid, amount }) });
    toast("✅ " + (res.status === "settled" ? t("rptFullySettled") : t("rptRemainingNow", { amt: fmtCur(res.remaining) })));
    loadCreditReport();
  } catch (e) { toast(e.message); }
}

function renderExpenses(c) {
  c.innerHTML = `<div id="expense-report-content" class="report-section">
    <div class="report-section-title">${t("rptExpenseTitle")}</div>
    <p style="color:var(--muted);font-size:12px">${t("rptLoading")}</p></div>`;
  loadExpenseList();
}

async function loadExpenseList() {
  const el = document.getElementById("expense-report-content");
  if (!el) return;
  try {
    const d = await api("/api/expenses?from=" + (reportData && reportData.from !== "البداية" ? encodeURIComponent(document.getElementById("report-from").value || "") : "") + "&to=" + encodeURIComponent(document.getElementById("report-to").value || ""));
    el.innerHTML = `
      <div class="report-section-title">${t("rptExpenseTitle")}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        <input id="exp-desc" class="login-input" style="flex:1;min-width:140px" placeholder="${t("rptExpDesc")}">
        <input id="exp-amount" type="number" class="login-input" style="width:110px" placeholder="${t("rptExpAmount")}" min="0">
        <select id="exp-cat" class="login-input" style="width:auto">
          <option>${t("rptExpCat")}</option>
        </select>
        <button class="btn btn-success btn-sm" onclick="addExpense()">${t("rptAdd")}</button>
      </div>
      <div class="report-kpi">
        <div class="report-kpi-item"><div class="report-kpi-value">${d.items.length}</div><div class="report-kpi-label">${t("rptExpenseCount")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--danger)">${fmtCur(d.total)}</div><div class="report-kpi-label">${t("rptTotalExpenses")}</div></div>
      </div>
      <table class="report-table">
        <tr><th>#</th><th>${t("rptDate")}</th><th>${t("rptExpCat")}</th><th>${t("rptExpDesc")}</th><th>${t("rptExpAmount")}</th><th>${t("rptBy")}</th><th></th></tr>
        ${d.items.length ? d.items.map(x => `<tr>
          <td>#${x.id}</td><td>${x.date}</td><td>${escapeHtml(x.category)}</td>
          <td>${escapeHtml(x.description)}</td><td class="report-loss">-${fmtCur(x.amount)}</td>
          <td>${escapeHtml(x.added_by||"")}</td>
          <td><button class="btn btn-sm btn-danger" onclick="delExpense(${x.id})">🗑</button></td>
        </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;color:var(--muted)">${t("rptNoExpenses")}</td></tr>`}
      </table>`;
  } catch (e) { el.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

async function addExpense() {
  const description = document.getElementById("exp-desc").value.trim();
  const amount = parseFloat(document.getElementById("exp-amount").value) || 0;
  const category = document.getElementById("exp-cat").value;
  if (!description || amount <= 0) { toast(t("rptEnterDescAmount")); return; }
  try {
    await api("/api/expenses", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ description, amount, category }) });
    toast(t("rptExpenseAdded"));
    loadExpenseList();
  } catch (e) { toast(e.message); }
}

async function delExpense(id) {
  if (!confirm(t("rptConfirmDeleteExp"))) return;
  try {
    await api("/api/expenses/" + id, { method: "DELETE" });
    toast(t("rptExpenseDeleted"));
    loadExpenseList();
  } catch (e) { toast(e.message); }
}

async function renderIncome(c) {
  const from = document.getElementById("report-from").value;
  const to = document.getElementById("report-to").value;
  c.innerHTML = `<div class="report-section"><div class="report-section-title">${t("rptIncomeTitle")}</div><p style="color:var(--muted);font-size:12px">${t("rptLoading")}</p></div>`;
  try {
    const d = await api("/api/reports/income?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to));
    const netColor = d.net_income >= 0 ? "report-profit" : "report-loss";
    c.innerHTML = `
      <div class="report-section">
        <div class="report-section-title">${t("rptIncomeTitle")}</div>
        <div class="report-kpi">
          <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.total_sales)}</div><div class="report-kpi-label">${t("rptTotalSales")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.cash_received)}</div><div class="report-kpi-label">${t("rptCashReceived")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value">${fmtCur(d.credit_collected)}</div><div class="report-kpi-label">${t("rptCreditCollected")}</div></div>
          <div class="report-kpi-item"><div class="report-kpi-value" style="color:var(--danger)">${fmtCur(d.expenses_total)}</div><div class="report-kpi-label">${t("rptExpenses")}</div></div>
        </div>
        <table class="report-table">
          <tr><th>${t("rptItemLabel")}</th><th>${t("rptAmount")}</th></tr>
          <tr><td>📊 ${t("rptTotalSales")}</td><td>${fmtCur(d.total_sales)}</td></tr>
          <tr><td>${t("rptDiscountsGiven")}</td><td class="report-loss">-${fmtCur(d.total_discount)}</td></tr>
          <tr><td>${t("rptTaxCollected")}</td><td class="report-loss">-${fmtCur(d.total_tax)}</td></tr>
          <tr><td>📒 ${t("rptCreditCollected")}</td><td class="report-profit">+${fmtCur(d.credit_collected)}</td></tr>
          <tr><td>${t("rptCancelledValueIn", { n: d.cancelled_count })}</td><td class="report-loss">-${fmtCur(d.cancelled_total)}</td></tr>
          <tr><td>${t("rptExpenses")}</td><td class="report-loss">-${fmtCur(d.expenses_total)}</td></tr>
          <tr class="total-row"><td>${t("rptNetIncome")}</td><td class="${netColor}">${fmtCur(d.net_income)}</td></tr>
        </table>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t("rptInflowsTitle")}</div>
        <table class="report-table">
          <tr><th>${t("rptItemLabel")}</th><th>${t("rptAmount")}</th></tr>
          <tr><td>${t("rptSalesFromPayments")}</td><td class="report-profit">${fmtCur(d.cash_received)}</td></tr>
          <tr><td>📒 ${t("rptCreditCollected")}</td><td class="report-profit">${fmtCur(d.credit_collected)}</td></tr>
          <tr class="total-row"><td>${t("rptTotalInflows")}</td><td class="report-profit">${fmtCur(d.cash_in)}</td></tr>
          <tr><td>${t("rptExpensesPaid")}</td><td class="report-loss">-${fmtCur(d.expenses_total)}</td></tr>
          <tr><td>${t("rptRefunds")}</td><td class="report-loss">-${fmtCur(d.cancelled_total)}</td></tr>
          <tr class="total-row"><td>${t("rptNetCashFlow")}</td><td class="${d.net_cash_flow >= 0 ? 'report-profit' : 'report-loss'}">${fmtCur(d.net_cash_flow)}</td></tr>
        </table>
      </div>
      <div class="report-section">
        <div class="report-section-title">${t("rptSalesByPayMethod")}</div>
        <table class="report-table">
          <tr><th>${t("rptMethod")}</th><th>${t("rptOrders")}</th><th>${t("rptReceived")}</th><th>${t("rptInvoices")}</th></tr>
          ${d.by_method.length ? d.by_method.map(m => `<tr class="report-drill" onclick="applyReportDrill('method', '${escq(m.method)}')" title="${t("rptDrillHint")}"><td>${methodName(m.method)}</td><td>${m.count}</td><td>${fmtCur(m.paid)}</td><td>${fmtCur(m.total)}</td></tr>`).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--muted)">${t("rptNoSales")}</td></tr>`}
        </table>
      </div>`;
  } catch (e) { c.innerHTML = `<span style="color:var(--danger)">${e.message}</span>`; }
}

function renderPeak(c) {
  const d = reportData;
  c.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t("rptPeakAnalysis")}</div>
      <table class="report-table">
        <tr><th>${t("rptHour")}</th><th>${t("rptOrders")}</th><th>${t("rptTotalSales")}</th></tr>
        ${(() => {
          const all = Array.from({ length: 24 }, (_, i) => i);
          const hourMap = {};
          (d.by_hour || []).forEach(h => { hourMap[h.hour] = h; });
          return all.map(h => {
            const v = hourMap[h];
            const label = h.toString().padStart(2, "0") + ":00";
            if (!v) return `<tr><td>${label}</td><td>0</td><td>0</td></tr>`;
            return `<tr class="report-drill" onclick="applyReportDrill('hour', '${h}')" title="${t("rptDrillHint")}"><td>${label}</td><td>${v.count}</td><td>${fmtCur(v.total)}</td></tr>`;
          }).join("");
        })()}
      </table>
    </div>`;
}

function renderTablesReport(c) {
  const d = reportData;
  const tables = Object.values(tableData);
  const occupied = tables.filter(t => t.active).length;
  const total = tables.length;
  c.innerHTML = `
    <div class="report-section">
      <div class="report-section-title">${t("rptTablesReport")}</div>
      <div class="report-kpi">
        <div class="report-kpi-item"><div class="report-kpi-value">${total}</div><div class="report-kpi-label">${t("rptTotalTables")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${occupied}</div><div class="report-kpi-label">${t("rptOccupied")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${total - occupied}</div><div class="report-kpi-label">${t("rptAvailableTables")}</div></div>
        <div class="report-kpi-item"><div class="report-kpi-value">${total > 0 ? ((occupied / total) * 100).toFixed(0) : 0}%</div><div class="report-kpi-label">${t("rptOccupancy")}</div></div>
      </div>
      <table class="report-table">
        <tr><th>${t("rptSection")}</th><th>${t("rptTables")}</th><th>${t("rptOccupied")}</th><th>${t("rptAvailableTables")}</th></tr>
        ${TABLE_SECTIONS.map(sec => {
          const secTables = tables.filter(t => t.section === sec.id);
          const secOcc = secTables.filter(t => t.active).length;
          return `<tr class="report-drill" onclick="applyReportDrill('section', '${sec.id}')" title="${t("rptDrillHint")}"><td>${sec.icon} ${sec.id}</td><td>${secTables.length}</td><td>${secOcc}</td><td>${secTables.length - secOcc}</td></tr>`;
        }).join("")}
      </table>
    </div>`;
}

function renderCharts(d) {
  if (user.role !== "manager") return;
  loadChartJs().then(() => {
    try {
      renderDailyChart(d.daily || []);
      renderTopItemsChart((d.top_items || []).slice(0, 6));
      renderMethodChart(d.by_method || []);
      renderHourChart(d.by_hour || []);
    } catch (e) { /* تجاهل */ }
  }).catch(() => { /* تجاهل فشل تحميل مكتبة الرسوم */ });
}

function printReports() {
  const w = window.open("", "_blank", "width=800,height=600");
  if (!w) { toast("⚠️ " + t("toast.allowPopups")); return; }
  const dir = document.documentElement.dir;
  let content = document.getElementById("report-content").innerHTML;
  const detail = document.getElementById("report-detail");
  if (detail) content += detail.innerHTML;
  w.document.write(`<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${t("rptPrintTitle")}</title>
    <style>
      body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 20px; direction: ${dir}; font-size: 12px; }
      .report-kpi { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }
      .report-kpi-item { flex: 1; min-width: 120px; text-align: center; border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
      .report-kpi-value { font-size: 18px; font-weight: bold; color: #059669; }
      .report-kpi-label { font-size: 11px; color: #666; }
      .report-section { margin-bottom: 15px; border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
      .report-section-title { font-size: 13px; font-weight: bold; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #ddd; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #f5f5f5; padding: 6px 8px; text-align: right; font-weight: 600; }
      td { padding: 5px 8px; border-bottom: 1px solid #eee; }
      .total-row td { font-weight: bold; border-top: 2px solid #333; }
      h2 { text-align: center; margin-bottom: 10px; }
      .print-date { text-align: center; color: #999; font-size: 10px; margin-bottom: 15px; }
      @media print { body { padding: 10px; } }
    </style>
  </head><body>
    <h2>${RESTAURANT_NAME} — ${t("rptReportTitle")}</h2>
    <div class="print-date">${new Date().toLocaleString()}</div>
    ${content}
    <script>window.onload=function(){window.print();}<\/script>
  </body></html>`);
  w.document.close();
}

function exportCSV() {
  if (!user || user.role !== "manager") return;
  const tables = document.querySelectorAll("#report-content table, #report-detail table");
  let csv = "";
  tables.forEach((tbl, ti) => {
    if (ti > 0) csv += "\n\n";
    tbl.querySelectorAll("tr").forEach(tr => {
      const cells = [];
      tr.querySelectorAll("th, td").forEach(td => {
        let txt = (td.textContent || "").trim().replace(/\s+/g, " ");
        if (txt.startsWith("📦")) txt = txt.replace(/^\S+\s*/, "");
        cells.push('"' + txt.replace(/"/g, '""') + '"');
      });
      csv += cells.join(",") + "\n";
    });
  });
  if (!csv) { toast("⚠️ " + t("rptNoOrdersMatch")); return; }
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "report.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== قائمة المدير =====
function toggleManagerDropdown() {
  document.getElementById("manager-menu").classList.toggle("show");
}

function closeManagerDropdown() {
  document.getElementById("manager-menu").classList.remove("show");
}

function showSettings() {
  if (!user) { toast(t("err.loginFirst")); return; }
  document.getElementById("settings-error").textContent = "";
  document.getElementById("settings-manager").style.display = user.role === "manager" ? "block" : "none";
  loadSettings();
  renderEmployees();
  renderTablesManage();
  openModal("modal-settings");
}

async function loadSettings() {
  try {
    const d = await api("/api/settings");
    document.getElementById("set-name").value = d.restaurant_name;
    document.getElementById("set-tax").value = d.tax_rate;
    document.getElementById("set-currency").value = d.currency;
    document.getElementById("set-autobackup").checked = !!d.auto_backup;
    document.getElementById("set-backup-freq").value = d.backup_freq || "daily";
    CURRENCY = d.currency;
    TAX_RATE = d.tax_rate;
    RESTAURANT_NAME = d.restaurant_name;
    updateAutoBackupLabel();
    applySettings();
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

function updateAutoBackupLabel() {
  document.getElementById("autobackup-label").textContent =
    document.getElementById("set-autobackup").checked ? t("on") : t("off");
}

async function saveSettings() {
  if (!user || user.role !== "manager") return;
  try {
    const res = await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurant_name: document.getElementById("set-name").value,
        tax_rate: parseFloat(document.getElementById("set-tax").value),
        currency: document.getElementById("set-currency").value,
        auto_backup: document.getElementById("set-autobackup").checked,
        backup_freq: document.getElementById("set-backup-freq").value
      })
    });
    TAX_RATE = res.tax_rate;
    CURRENCY = res.currency;
    RESTAURANT_NAME = res.restaurant_name;
    applySettings();
    document.getElementById("set-tax").value = res.tax_rate;
    updateAutoBackupLabel();
    toast("✅ " + t("toast.settingsSaved"));
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

function applySettings() {
  document.title = RESTAURANT_NAME + " - POS";
  const t = document.getElementById("app-title");
  if (t) t.textContent = RESTAURANT_NAME;
  const lt = document.getElementById("login-title");
  if (lt) lt.textContent = RESTAURANT_NAME;
  const tl = document.getElementById("tax-rate-label");
  if (tl) tl.textContent = Math.round(TAX_RATE * 100) + "%";
  document.getElementById("subtotal").textContent = fmtCur(0);
  document.getElementById("tax").textContent = fmtCur(0);
  document.getElementById("total").textContent = fmtCur(0);
}

async function renderEmployees() {
  try {
    const emps = await api("/api/employees");
    const me = user.id;
    document.getElementById("employees-list").innerHTML = emps.map(e => `
      <div class="menu-manage-row">
        <div class="mm-info">
          <span class="mm-name">${e.name}</span>
          <span class="mm-role ${e.role}">${e.role === "manager" ? t("managerRole") : t("cashierRole")}</span>
        </div>
        <div class="mm-actions">
          ${user.role === "manager" ? `
            <button class="btn btn-sm" onclick="editEmployee(${e.id})">✏️</button>
            ${e.id !== me ? `<button class="btn btn-sm" style="background:var(--danger)" onclick="deleteEmployee(${e.id})">🗑️</button>` : ""}
          ` : ""}
        </div>
      </div>`).join("");
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

function editEmployee(id) {
  if (!user || user.role !== "manager") return;
  const row = document.querySelector(`#employees-list .menu-manage-row`);
  if (!row) return;
  const name = prompt(t("newName"));
  if (name === null) return;
  const role = confirm(t("promoteManager")) ? "manager" : "cashier";
  const pin = prompt(t("newPin")) || "";
  updateEmployee(id, { name, role, pin });
}

async function updateEmployee(id, data) {
  try {
    await api("/api/employees/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    toast("✅ " + t("toast.employeeUpdated"));
    renderEmployees();
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

async function addEmployee() {
  if (!user || user.role !== "manager") return;
  const name = document.getElementById("emp-name").value.trim();
  const role = document.getElementById("emp-role").value;
  const pin = document.getElementById("emp-pin").value.trim();
  if (!name) { document.getElementById("settings-error").textContent = t("enterEmployeeName"); return; }
  if (pin.length < 4) { document.getElementById("settings-error").textContent = t("err.pinMin4"); return; }
  try {
    await api("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, pin })
    });
    document.getElementById("emp-name").value = "";
    document.getElementById("emp-pin").value = "";
    toast("✅ " + t("toast.employeeAdded"));
    renderEmployees();
    loadEmployees();
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

async function deleteEmployee(id) {
  if (!user || user.role !== "manager") return;
  if (!confirm(t("confirmDeleteEmployee"))) return;
  try {
    await api("/api/employees/" + id, { method: "DELETE" });
    toast("✅ " + t("toast.employeeDeleted"));
    renderEmployees();
    loadEmployees();
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

// ===== إدارة الطاولات =====
async function renderTablesManage() {
  if (!user) return;
  try {
    const list = await api("/api/tables");
    const cont = document.getElementById("tables-manage-list");
    cont.innerHTML = list.map(tb => `
      <div class="menu-manage-row">
        <span class="mi-emoji">🪑</span>
        <div class="mi-info">
          <div>${t("table")} ${tb.num}</div>
          <div class="mi-meta">${t(tb.section)}</div>
        </div>
        <div class="mi-actions">
          <button class="btn btn-sm btn-info" onclick="editTable(${tb.id})">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTable(${tb.id})">🗑️</button>
        </div>
      </div>`).join("");
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

function resetTableForm() {
  document.getElementById("tbl-edit-id").value = "";
  document.getElementById("tbl-num").value = "";
  document.getElementById("tbl-section").value = "hall";
  document.getElementById("tbl-save-btn").innerHTML = "➕ " + t("addTable");
  document.getElementById("tbl-cancel-edit").style.display = "none";
}

function editTable(id) {
  if (!user || user.role !== "manager") return;
  const row = Object.values(tableData).find(t => t.id === id);
  if (!row) return;
  document.getElementById("tbl-edit-id").value = id;
  document.getElementById("tbl-num").value = row.num;
  document.getElementById("tbl-section").value = row.section;
  document.getElementById("tbl-save-btn").innerHTML = "💾 " + t("saveTable");
  document.getElementById("tbl-cancel-edit").style.display = "";
}

async function saveTable() {
  if (!user || user.role !== "manager") return;
  const id = document.getElementById("tbl-edit-id").value;
  const body = {
    num: parseInt(document.getElementById("tbl-num").value, 10),
    section: document.getElementById("tbl-section").value
  };
  if (!body.num) { document.getElementById("settings-error").textContent = t("enterTableNum"); return; }
  try {
    if (id) {
      await api("/api/tables/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      toast("✅ " + t("toast.tableUpdated"));
    } else {
      await api("/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      toast("✅ " + t("toast.tableAdded"));
    }
    resetTableForm();
    renderTablesManage();
    await loadTables();
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

async function deleteTable(id) {
  if (!user || user.role !== "manager") return;
  if (!confirm(t("confirmDeleteTable"))) return;
  try {
    await api("/api/tables/" + id, { method: "DELETE" });
    toast("🗑️ " + t("toast.tableDeleted"));
    await loadTables();
    renderTablesManage();
  } catch (e) { document.getElementById("settings-error").textContent = e.message; }
}

// ===== النسخ الاحتياطي (للمدير) =====
function showBackup() {
  if (!user || user.role !== "manager") return;
  document.getElementById("backup-err").textContent = "";
  document.getElementById("backup-file").value = "";
  openModal("modal-backup");
  loadBackupList();
}

async function loadBackupList() {
  const el = document.getElementById("backup-list");
  try {
    const d = await api("/api/backup/list");
    if (!d.backups.length) {
      el.innerHTML = '<div class="adv-empty">' + t("noServerBackups") + '</div>';
      return;
    }
    el.innerHTML = d.backups.map(b =>
      `<div class="menu-manage-row">
        <div class="mm-info">
          <span class="mm-name">${b.name}</span>
          <span class="mm-role">${(b.size / 1024).toFixed(1)} KB</span>
        </div>
        <div class="mm-actions">
          <button class="btn btn-sm" onclick="backupDownloadOne('${b.name}')">⬇️</button>
          <button class="btn btn-sm" style="background:var(--danger)" onclick="backupRestoreOne('${b.name}')">♻️</button>
        </div>
      </div>`).join("");
  } catch (e) { el.innerHTML = '<div class="adv-empty">' + e.message + '</div>'; }
}

function backupDownload() {
  window.location.href = "/api/backup/download";
}

function backupDownloadOne(name) {
  window.open("/api/backup/download/" + encodeURIComponent(name), "_blank");
}

function backupImport() {
  const f = document.getElementById("backup-file").files[0];
  if (!f) { document.getElementById("backup-err").textContent = t("err.selectBackupFile"); return; }
  if (!confirm(t("confirmRestore"))) return;
  const fd = new FormData();
  fd.append("file", f);
  fetch("/api/backup/import", { method: "POST", body: fd }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(terr(d.error || t("err.generic")));
    toast("✅ " + t("toast.backupRestored"));
    loadBackupList();
    loadEmployees();
  }).catch(e => { document.getElementById("backup-err").textContent = e.message; });
}

async function backupRestoreOne(name) {
  if (!confirm(t("confirmRestore") + " (" + name + ")")) return;
  try {
    const d = await api("/api/backup/restore/" + encodeURIComponent(name), { method: "POST" });
    toast("✅ " + t("toast.backupRestored"));
    loadBackupList();
    loadEmployees();
  } catch (e) { document.getElementById("backup-err").textContent = e.message; }
}

// ===== إغلاق اليوم (للمدير) =====
let dayData = null;

async function showDayClose() {
  if (!user || user.role !== "manager") return;
  document.getElementById("day-err").textContent = "";
  openModal("modal-day");
  await loadDayStatus();
}

async function loadDayStatus() {
  try {
    dayData = await api("/api/day/status");
    renderDay(dayData);
  } catch (e) { document.getElementById("day-err").textContent = e.message; }
}

function renderDay(d) {
  const body = document.getElementById("day-body");
  const colors = ["#10b981", "#6366f1", "#06b6d4"];
  const cards = [
    [t("totalSales"), d.total_sales],
    [t("orderCount"), d.order_count],
    [t("tax"), d.tax_total],
  ].map(([l, v], i) =>
    `<div class="report-card"><span class="report-value" style="color:${colors[i]}">${fmtCur(v)}</span><span class="report-label">${l}</span></div>`
  ).join("");

  const methodRows = d.by_method.map(m =>
    `<tr><td>${m.method}</td><td>${m.count}</td><td>${fmtCur(m.total)}</td></tr>`).join("");
  const methods = `
    <div class="adv-section"><div class="adv-section-title">💰 ${t("salesByMethod")}</div>
    <table class="adv-table"><thead><tr><th>${t("method")}</th><th>${t("orders")}</th><th>${t("amount")}</th></tr></thead>
    <tbody>${methodRows || '<tr><td colspan="3">' + t("noOrdersToday") + '</td></tr>'}</tbody></table></div>`;

  let closeArea;
  if (d.closed) {
    const cl = d.closure;
    const diff = cl.difference;
    closeArea = `
      <div style="text-align:center;background:rgba(52,211,153,.12);border:1px solid var(--success);border-radius:10px;padding:14px;margin-top:14px">
        <div style="font-size:18px;font-weight:bold;color:var(--success)">✅ ${t("dayClosed")}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">${t("closedBy")}: ${cl.closed_by} — ${cl.closed_at}</div>
        <table style="width:100%;margin-top:10px;border-collapse:collapse;font-size:13px">
          <tr><td style="padding:4px;text-align:right">${t("expectedCash")}</td><td style="text-align:left">${fmtCur(cl.expected_cash)}</td></tr>
          <tr><td style="padding:4px;text-align:right">${t("countedCash")}</td><td style="text-align:left">${fmtCur(cl.counted_cash)}</td></tr>
          <tr><td style="padding:4px;text-align:right">${t("difference")}</td><td style="text-align:left;font-weight:bold;color:${diff < 0 ? "var(--danger)" : "var(--success)"}">${diff < 0 ? "" : "+"}${fmtCur(diff)}</td></tr>
        </table>
        <button class="btn" style="margin-top:10px" onclick="reopenDay()">🔓 ${t("reopenDay")}</button>
      </div>`;
  } else {
    const expected = d.expected_cash;
    closeArea = `
      <div class="settings-section" style="margin-top:16px">🧾 ${t("drawerSettlement")}</div>
      <div class="adv-range">${t("expectedCashInDrawer")}: <b>${fmtCur(expected)}</b></div>
      <label class="settings-label">${t("countedCashActual")}</label>
      <input id="counted-cash" type="number" step="0.5" min="0" class="pay-input" value="${expected}">
      <div style="margin-top:12px"><button class="btn btn-danger" onclick="closeDay()">📆 ${t("confirmCloseDay")}</button></div>`;
  }

  body.innerHTML = `
    <div class="adv-range">${t("dayDate")}: <b>${d.date}</b></div>
    <div class="report-grid">${cards}</div>
    ${methods}
    ${closeArea}`;
}

async function closeDay() {
  const counted = parseFloat(document.getElementById("counted-cash").value) || 0;
  if (!confirm(t("confirmCloseDayText"))) return;
  try {
    const res = await api("/api/day/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counted_cash: counted })
    });
    toast("📆 " + t("toast.dayClosed"));
    dayData = await api("/api/day/status");
    renderDay(dayData);
    dayPrint();
  } catch (e) { document.getElementById("day-err").textContent = e.message; }
}

async function reopenDay() {
  if (!confirm(t("reopenDayConfirm"))) return;
  try {
    await api("/api/day/reopen", { method: "POST" });
    toast("🔓 " + t("toast.dayReopened"));
    loadDayStatus();
  } catch (e) { document.getElementById("day-err").textContent = e.message; }
}

function dayPrint() {
  const d = dayData;
  if (!d) return;
  const cl = d.closure || {};
  const row = (l, v, bold) => `<tr><td style="text-align:right;padding:3px 0">${l}</td><td style="text-align:left;padding:3px 0">${bold ? "<b>" : ""}${v}${bold ? "</b>" : ""}</td></tr>`;
  const methods = (cl.by_method || d.by_method || []).map(m =>
    `<tr><td style="text-align:right;padding:3px 0">${m.method}</td><td style="text-align:center;padding:3px 0">${m.count}</td><td style="text-align:left;padding:3px 0">${fmtCur(m.total)}</td></tr>`).join("");
  const w = window.open("", "_blank", "width=340,height=600");
  if (!w) { toast("⚠️ " + t("toast.allowPopups")); return; }
  const dir = document.documentElement.dir;
  w.document.write(`<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"><title>${t("dayReport")}</title></head>
    <body style="font-family:'Segoe UI',Tahoma,sans-serif;width:300px;margin:0 auto;text-align:center;font-size:13px">
      <div style="font-size:18px;font-weight:bold">${RESTAURANT_NAME}</div>
      <div style="color:#555">📆 ${t("dayCloseReport")}<br><b>${d.date}</b></div>
      <div style="border-top:2px solid #000;border-bottom:2px solid #000;padding:6px 0;margin-top:8px">
        ${row(t("totalSales"), fmtCur(d.total_sales), true)}
        ${row(t("orderCount"), d.order_count, false)}
        ${row(t("totalTax"), fmtCur(d.tax_total), false)}
      </div>
      ${methods ? `<table style="width:100%;margin-top:8px;border-collapse:collapse"><thead><tr><th style="text-align:right">${t("method")}</th><th>${t("orders")}</th><th style="text-align:left">${t("amount")}</th></tr></thead><tbody>${methods}</tbody></table>` : ""}
      <div style="border-top:1px dashed #000;margin-top:8px;padding-top:6px">
        ${row(t("expectedCash"), fmtCur(cl.expected_cash ?? d.expected_cash), false)}
        ${row(t("countedCash"), fmtCur(cl.counted_cash ?? 0), false)}
        ${row(t("difference"), (cl.difference ?? 0) < 0 ? "" : "+" + fmtCur(cl.difference ?? 0), true)}
      </div>
      <div style="margin-top:10px;color:#555;font-size:11px">${cl.closed_by ? t("closedBy") + ": " + cl.closed_by : ""}<br>${cl.closed_at || ""}</div>
    </body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

document.getElementById("paid").addEventListener("input", calcChange);
document.getElementById("set-autobackup").addEventListener("change", updateAutoBackupLabel);

// ===== Event Delegation for menu-list =====
document.getElementById("menu-list").addEventListener("click", function(e) {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.getAttribute("data-action");
  if (action === "toggle-acc") {
    e.preventDefault();
    e.stopPropagation();
    const group = target.closest(".acc-group");
    if (group) group.classList.toggle("open");
  } else if (action === "add-to-cart") {
    const name = target.getAttribute("data-name");
    const emoji = target.getAttribute("data-emoji");
    const price = parseFloat(target.getAttribute("data-price"));
    const menuId = target.getAttribute("data-menu-id");
    addToCart(name, emoji, price, menuId ? parseInt(menuId) : null);
  }
});

// ===== التهيئة =====
const POS_CACHE_KEY = "pos_cache_v1";

function posCacheLoad() {
  try {
    return JSON.parse(localStorage.getItem(POS_CACHE_KEY) || "null");
  } catch (e) { return null; }
}

function posCacheSave(b) {
  try {
    localStorage.setItem(POS_CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      settings: b.settings, menu: b.menu, categoryOrder: b.category_order, employees: b.employees
    }));
  } catch (e) { /* تجاهل */ }
}

function applyBootstrapData(b) {
  const s = b.settings || {};
  TAX_RATE = s.tax_rate;
  CURRENCY = s.currency;
  RESTAURANT_NAME = s.restaurant_name;
  applySettings();
  MENU = b.menu || [];
  CATEGORY_ORDER = b.category_order || {};
  renderCats();
  renderMenu();
  const sel = document.getElementById("login-employee");
  if (b.employees && sel) {
    sel.innerHTML = b.employees.map(e => `<option value="${e.id}">${e.name} — ${e.role === "manager" ? t("managerRole") : t("cashierRole")}</option>`).join("");
  }
}

async function checkLowStock() {
  try {
    const items = await api("/api/inventory/low");
    if (items && items.length > 0) {
      const names = items.map(i => `${i.item_name} (${i.quantity} ${i.unit})`).join(", ");
      toast(`⚠️ ${t("lowStockWarning")}: ${names}`);
    }
  } catch (e) { /* لا يهم */ }
}

async function init() {
  setLang(localStorage.getItem("pos_lang") || "id");
  applyUiPrefs();
  const cache = posCacheLoad();
  const cacheValid = !!(cache && cache.settings && (Date.now() - cache.ts) < 24 * 3600 * 1000);
  if (cacheValid) {
    try { applyBootstrapData(cache); } catch (e) { /* تجاهل */ }
  }
  try {
    const b = await api("/api/bootstrap");
    applyBootstrapData(b);
    tableData = {};
    for (const t of (b.tables || [])) tableData[t.num] = t;
    renderTables();
    updateStats();
    if (b.user) {
      user = b.user;
      document.getElementById("login-overlay").style.display = "none";
      updateUserBar();
      if (b.low_stock && b.low_stock.length) {
        const names = b.low_stock.map(i => `${i.item_name} (${i.quantity} ${i.unit})`).join(", ");
        toast(`⚠️ ${t("lowStockWarning")}: ${names}`);
      }
      checkCancelRequests(b.cancel_count);
    } else {
      document.getElementById("login-overlay").style.display = "flex";
    }
    posCacheSave(b);
  } catch (e) {
    if (!cacheValid) {
      document.getElementById("login-overlay").style.display = "flex";
      loadEmployees();
      try {
        MENU = await api("/api/menu");
        CATEGORY_ORDER = await api("/api/categories/order").catch(() => ({}));
        renderCats();
        renderMenu();
      } catch (_e) { /* لا يهم */ }
      loadTables();
    } else {
      document.getElementById("login-overlay").style.display = "flex";
      loadTables();
    }
  }
}

// ===== طلب إلغاء طلب =====
function showCancelOrderModal() {
  if (!user) { toast("⚠️ سجل الدخول أولاً"); return; }
  if (!selectedTable) { toast("⚠️ اختر طاولة أولاً"); return; }
  if (!existingOrderId) { toast("⚠️ لا يوجد طلب محفوظ لهذه الطاولة"); return; }
  document.getElementById("cancel-reason-custom").style.display = "none";
  openModal("cancel-order-modal");
}

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("cancel-reason");
  if (sel) sel.addEventListener("change", () => {
    document.getElementById("cancel-reason-custom").style.display = sel.value === "أخرى" ? "" : "none";
  });
});

async function submitCancelRequest() {
  if (!user || !selectedTable) return;
  const sel = document.getElementById("cancel-reason");
  const reason = sel.value === "أخرى" ? (document.getElementById("cancel-reason-custom").value || "أخرى") : sel.value;
  try {
    const res = await api("/api/order/cancel-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table_num: selectedTable, order_id: existingOrderId, reason })
    });
    if (res.ok) {
      toast("📩 تم إرسال طلب الإلغاء — بانتظار موافقة المدير");
      closeModal("cancel-order-modal");
    } else {
      toast("❌ " + (res.error || "خطأ"));
    }
  } catch (e) { toast(e.message); }
}

async function showCancelRequests() {
  if (!user || user.role !== "manager") return;
  try {
    const requests = await api("/api/cancel-requests");
    const body = document.getElementById("cancel-requests-body");
    if (!requests.length) {
      body.innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px">لا توجد طلبات معلقة</div>';
    } else {
      body.innerHTML = requests.map(r => {
        const items = r.o_items ? JSON.parse(r.o_items) : [];
        const itemsList = items.map(i => `${i.emoji || ''} ${i.name} ×${i.qty}`).join(", ");
        const sensitive = (r.o_status === "sent" || r.o_status === "ready" || r.o_status === "completed");
        return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <b>طلب #${r.order_id}</b>
            <span style="color:var(--muted);font-size:12px">${r.created_at}</span>
          </div>
          <div style="font-size:13px;margin-bottom:4px">🪑 الطاولة: <b>${r.table_num}</b> — المبلغ: <b>${fmtCur(r.o_total || 0)}</b></div>
          <div style="font-size:13px;margin-bottom:4px">👤 طلب: <b>${r.requested_by}</b></div>
          <div style="font-size:13px;margin-bottom:8px">📝 السبب: <b>${r.reason}</b></div>
          <div style="font-size:12px;color:var(--muted);margin-bottom:8px">الأصناف: ${itemsList || '—'}</div>
          ${sensitive ? `<div style="font-size:11px;color:var(--danger);background:rgba(239,68,68,.1);border-radius:6px;padding:4px 8px;margin-bottom:8px">🔒 حماية الإلغاء: يتطلب PIN المدير (الطلب بدرجة جاهز/مدفوع)</div>` : ""}
          <div style="display:flex;gap:8px">
            <button class="btn btn-success btn-sm" onclick="approveCancel(${r.id},${sensitive?1:0})">✅ موافقة</button>
            <button class="btn btn-danger btn-sm" onclick="rejectCancel(${r.id})">✕ رفض</button>
          </div>
        </div>`;
      }).join("");
    }
    openModal("cancel-requests-modal");
    checkCancelRequests();
  } catch (e) { toast(e.message); }
}

async function approveCancel(id, sensitive) {
  if (sensitive) {
    managerCallback = () => approveCancelNow(id);
    document.getElementById("manager-pin-action-info").innerHTML = t("cancelSensitiveTitle") || "🔒 إلغاء بحماية المدير";
    document.getElementById("manager-pin-input").value = "";
    document.getElementById("manager-pin-error").textContent = "";
    openModal("modal-manager-pin");
    return;
  }
  approveCancelNow(id);
}

async function approveCancelNow(id) {
  try {
    const res = await api("/api/cancel-approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: id, pin: managerPinEntered }) });
    managerPinEntered = "";
    if (res.ok) { toast("✅ تمت الموافقة على الإلغاء" + (res.sensitive ? " (بحماية PIN)" : "")); showCancelRequests(); loadTables(); checkCancelRequests(); }
    else toast("❌ " + (res.error || "خطأ"));
  } catch (e) { toast(e.message); }
}

async function rejectCancel(id) {
  try {
    const res = await api("/api/cancel-reject", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: id }) });
    if (res.ok) { toast("✕ تم رفض طلب الإلغاء"); showCancelRequests(); checkCancelRequests(); }
    else toast("❌ " + (res.error || "خطأ"));
  } catch (e) { toast(e.message); }
}

let cancelPollInterval = null;
async function checkCancelRequests(preCount) {
  if (!user || user.role !== "manager") {
    document.getElementById("btn-cancel-notify").style.display = "none";
    if (cancelPollInterval) { clearInterval(cancelPollInterval); cancelPollInterval = null; }
    return;
  }
  try {
    let count = preCount;
    if (count == null) {
      const d = await api("/api/cancel-count");
      count = d.count;
    }
    const badge = document.getElementById("cancel-notify-badge");
    const btn = document.getElementById("btn-cancel-notify");
    badge.textContent = count;
    btn.style.display = count > 0 ? "" : "none";
  } catch (e) {}
  if (!cancelPollInterval) {
    cancelPollInterval = setInterval(checkCancelRequests, 15000);
  }
}
init();
