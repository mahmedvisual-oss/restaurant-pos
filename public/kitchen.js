const POLL_MS = 8000;
let knownIds = new Set();
let kUser = null;
let pollTimer = null;
let clockTimer = null;
let polling = false;

function tr(key, fallback) {
  try { return typeof t === "function" ? (t(key) || fallback || key) : (fallback || key); }
  catch (e) { return fallback || key; }
}

async function api(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...opts,
      signal: controller.signal,
      headers: { "Cache-Control": "no-cache", ...(opts.headers || {}) }
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 120)}`);
    }
    if (!response.ok) throw new Error(terr(data.error || `HTTP ${response.status}`));
    return data;
  } catch (e) {
    if (e.name === "AbortError") throw new Error("انتهت مهلة الاتصال بالمطبخ");
    throw e;
  } finally { clearTimeout(timeout); }
}

function terr(msg) {
  const m = String(msg || "");
  const map = {
    "سجل الدخول أولاً": "err.loginFirst",
    "متاح للمدير فقط": "err.managerOnly",
    "PIN غير صحيح": "err.wrongPin",
    "الاسم ورقم PIN مطلوبان": "err.namePinRequired",
    "PIN يجب أن يكون 4 أرقام على الأقل": "err.pinMin4",
  };
  return map[m] ? tr(map[m], m) : m;
}

function setConn(online, message) {
  const conn = document.getElementById("k-conn");
  if (!conn) return;
  conn.classList.toggle("offline", !online);
  conn.textContent = online ? "● " + tr("connected", "متصل") : "● " + (message || tr("disconnected", "غير متصل"));
}

function showKitchenError(message) {
  const empty = document.getElementById("k-empty");
  if (!empty) return;
  empty.style.display = "block";
  empty.classList.add("k-error-state");
  empty.innerHTML = `⚠️ <b>تعذر الاتصال بشاشة المطبخ</b><div class="k-error-detail">${String(message || "خطأ غير معروف").replace(/[<>]/g, "")}</div><button class="k-retry-btn" onclick="poll(true)">🔄 إعادة المحاولة</button>`;
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, .18, .36].forEach((delay, i) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = i === 2 ? 880 : 660; o.type = "sine";
      g.gain.setValueAtTime(0.001, ctx.currentTime + delay);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
      o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.2);
    });
  } catch (e) {}
}

async function loadEmpSelect() {
  const select = document.getElementById("k-emp");
  if (!select) return;
  try {
    const emps = await api("/api/employees");
    select.innerHTML = (emps || []).map(e =>
      `<option value="${e.id}">${String(e.name || "").replace(/[<>]/g, "")} — ${e.role === "manager" ? tr("managerRole", "مدير") : tr("cashierRole", "كاشير")}</option>`
    ).join("");
    if (!emps || !emps.length) throw new Error("لا يوجد موظفون متاحون لتسجيل الدخول");
  } catch (e) {
    document.getElementById("k-err").textContent = e.message;
  }
}

function showApp() {
  document.getElementById("kitchen-login").style.display = "none";
  document.getElementById("kitchen-app").style.display = "block";
  startClock();
  poll(true);
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => poll(false), POLL_MS);
}

async function kLogin() {
  const id = parseInt(document.getElementById("k-emp").value, 10);
  const pin = document.getElementById("k-pin").value || "";
  const err = document.getElementById("k-err");
  err.textContent = "";
  if (!id || !pin) { err.textContent = tr("err.namePinRequired", "اختر الموظف وأدخل PIN"); return; }
  try {
    const d = await api("/api/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: id, pin })
    });
    kUser = d.user;
    showApp();
  } catch (e) { err.textContent = e.message; }
}

document.getElementById("k-pin")?.addEventListener("keydown", e => { if (e.key === "Enter") kLogin(); });

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && kUser) poll(true);
});

function startClock() {
  const el = document.getElementById("k-clock");
  const tick = () => {
    if (!el) return;
    const lang = typeof currentLang === "string" ? currentLang : "ar";
    el.textContent = new Date().toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  tick();
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = setInterval(tick, 1000);
}

function fmtTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  const m = Math.floor(s / 60);
  if (m < 1) return s + " " + tr("secAbbr", "ث");
  if (m < 60) return m + " " + tr("minAbbr", "د");
  return Math.floor(m / 60) + " " + tr("hrAbbr", "س") + " " + (m % 60) + " " + tr("minAbbr", "د");
}

function render(orders) {
  const grid = document.getElementById("k-grid");
  const empty = document.getElementById("k-empty");
  const cooking = document.getElementById("k-cooking");
  const ready = document.getElementById("k-ready");
  grid.innerHTML = "";
  empty.classList.remove("k-error-state");
  if (!orders.length) {
    empty.style.display = "block";
    empty.innerHTML = tr("noOrdersNow", "لا توجد طلبات حالياً 🌿");
    cooking.textContent = "0"; ready.textContent = "0"; return;
  }
  empty.style.display = "none";
  let c = 0, r = 0;
  orders.forEach(o => {
    const isReady = o.kitchen_status === "ready";
    if (isReady) r++; else c++;
    const elapsed = fmtTime(o.sent_ts);
    const warn = o.sent_ts && (Date.now() / 1000 - o.sent_ts) > 900;
    const paid = o.paid > 0 || o.status === "completed";
    const rows = (o.items || []).map(i =>
      `<div class="k-item"><span class="k-item-qty">${i.qty}</span><span class="k-item-name">${i.emoji || ""} ${String(i.name || "").replace(/[<>]/g, "")}</span></div>`).join("");
    grid.insertAdjacentHTML("beforeend", `
      <div class="k-order ${isReady ? "ready" : ""} ${paid ? "paid" : ""}" data-id="${o.id}">
        <div class="k-order-head">
          <span class="k-order-table">🪑 ${tr("table", "طاولة")} ${o.table_num ?? "—"}${o.table_section && o.table_section !== "hall" ? ` (${tr(o.table_section, o.table_section)})` : ""}</span>
          <span class="k-order-time ${warn ? "warn" : ""}">⏱ ${elapsed}</span>
          <span class="k-order-guests">👥 ${o.guests || 1}</span>
          <span class="k-order-status">${isReady ? tr("readyLabel", "جاهزة") + " ✅" : (paid ? '<span style="color:var(--success,#22c55e);font-weight:700">💰 ' + tr("paidLabel", "مدفوعة") + '</span>' : tr("cookingLabel", "تحضير") + " ⏳")}</span>
        </div>
        <div class="k-items">${rows || `<div class="k-item-name">—</div>`}</div>
        <div class="k-order-foot">
          <button class="k-ready-btn" ${isReady ? "disabled" : ""} onclick="markReady(${o.id})">✅ ${tr("readyLabel", "جاهزة")}</button>
          <span class="k-emp">${String(o.employee || "").replace(/[<>]/g, "")}</span>
        </div>
      </div>`);
  });
  cooking.textContent = c; ready.textContent = r;
}

async function markReady(id) {
  try { await api("/api/kitchen/order/" + id + "/ready", { method: "POST" }); await poll(true); }
  catch (e) { showKitchenError(e.message); }
}

async function clearKitchen() {
  if (!confirm(tr("kitchenClearConfirm", "إزالة جميع الطلبات من الشاشة؟"))) return;
  try { await api("/api/kitchen/clear", { method: "POST" }); await poll(true); }
  catch (e) { showKitchenError(e.message); }
}

async function poll(force) {
  if (polling && !force) return;
  polling = true;
  try {
    const d = await api("/api/kitchen/orders");
    setConn(true);
    const orders = Array.isArray(d.orders) ? d.orders : [];
    const activeIds = new Set(orders.map(o => o.id));
    const newOnes = orders.filter(o => o.status === "sent" && !knownIds.has(o.id));
    if (newOnes.length) beep();
    knownIds = activeIds;
    render(orders);
  } catch (e) {
    setConn(false, tr("disconnected", "غير متصل"));
    showKitchenError(e.message);
  } finally { polling = false; }
}

async function init() {
  try { if (typeof setLang === "function") setLang(localStorage.getItem("pos_lang") || "id"); } catch (e) {}
  try { if (typeof applyLang === "function") applyLang(); } catch (e) {}

  // إذا كانت جلسة POS موجودة بالفعل، افتح المطبخ مباشرة بدون تسجيل دخول ثانٍ.
  try {
    const me = await api("/api/me");
    if (me.user) { kUser = me.user; showApp(); return; }
  } catch (e) {}
  await loadEmpSelect();
}

init();
