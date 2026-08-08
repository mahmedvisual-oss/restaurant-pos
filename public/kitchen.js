const POLL_MS = 4000;
let knownIds = new Set();
let kUser = null;

function api(url, opts) {
  return fetch(url, opts).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(terr(d.error || t("err.generic")));
    return d;
  });
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
  if (map[m]) return t(map[m]);
  return m;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .18, .36].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = i === 2 ? 880 : 660;
      o.type = "sine";
      g.gain.setValueAtTime(0.001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch (e) {}
}

async function loadEmpSelect() {
  try {
    const emps = await api("/api/employees");
    document.getElementById("k-emp").innerHTML = emps.map(e =>
      `<option value="${e.id}">${e.name} — ${e.role === "manager" ? t("managerRole") : t("cashierRole")}</option>`).join("");
  } catch (e) { document.getElementById("k-err").textContent = e.message; }
}

async function kLogin() {
  const id = parseInt(document.getElementById("k-emp").value);
  const pin = document.getElementById("k-pin").value;
  try {
    const d = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: id, pin })
    });
    kUser = d.user;
    document.getElementById("kitchen-login").style.display = "none";
    document.getElementById("kitchen-app").style.display = "block";
    startClock();
    poll();
    setInterval(poll, POLL_MS);
  } catch (e) { document.getElementById("k-err").textContent = e.message; }
}

function startClock() {
  const el = document.getElementById("k-clock");
  const tick = () => el.textContent = new Date().toLocaleTimeString(currentLang, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  tick();
  setInterval(tick, 1000);
}

function fmtTime(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  const m = Math.floor(s / 60);
  if (m < 1) return s + " " + t("secAbbr");
  if (m < 60) return m + " " + t("minAbbr");
  return Math.floor(m / 60) + " " + t("hrAbbr") + " " + (m % 60) + " " + t("minAbbr");
}

function render(orders) {
  const grid = document.getElementById("k-grid");
  const empty = document.getElementById("k-empty");
  const cooking = document.getElementById("k-cooking");
  const ready = document.getElementById("k-ready");
  grid.innerHTML = "";
  if (!orders.length) {
    empty.style.display = "block";
    cooking.textContent = "0";
    ready.textContent = "0";
    return;
  }
  empty.style.display = "none";
  let c = 0, r = 0;
  orders.forEach(o => {
    const isReady = o.kitchen_status === "ready";
    if (isReady) r++; else c++;
    const elapsed = fmtTime(o.sent_ts);
    const warn = o.sent_ts && (Date.now() / 1000 - o.sent_ts) > 900;
    const paid = o.paid > 0 || o.status === "completed";
    const rows = o.items.map(i =>
      `<div class="k-item"><span class="k-item-qty">${i.qty}</span><span class="k-item-name">${i.emoji || ""} ${i.name}</span></div>`).join("");
    grid.innerHTML += `
      <div class="k-order ${isReady ? "ready" : ""} ${paid ? "paid" : ""}" data-id="${o.id}">
        <div class="k-order-head">
          <span class="k-order-table">🪑 ${t("table")} ${o.table_num}</span>
          <span class="k-order-time ${warn ? "warn" : ""}">⏱ ${elapsed}</span>
          <span class="k-order-guests">👥 ${o.guests}</span>
          <span class="k-order-status">${isReady ? t("readyLabel") + " ✅" : (paid ? '<span style="color:var(--success, #22c55e);font-weight:700">💰 ' + t("paidLabel") + '</span>' : t("cookingLabel") + " ⏳")}</span>
        </div>
        <div class="k-items">${rows}</div>
        <div class="k-order-foot">
          <button class="k-ready-btn" ${isReady ? "disabled" : ""} onclick="markReady(${o.id})">✅ ${t("readyLabel")}</button>
          <span class="k-emp">${o.employee || ""}</span>
        </div>
      </div>`;
  });
  cooking.textContent = c;
  ready.textContent = r;
}

async function markReady(id) {
  try {
    await api("/api/kitchen/order/" + id + "/ready", { method: "POST" });
    poll();
  } catch (e) { /* تجاهل */ }
}

async function poll() {
  const conn = document.getElementById("k-conn");
  try {
    const d = await api("/api/kitchen/orders");
    conn.classList.remove("offline");
    conn.textContent = "● " + t("connected");
    const activeIds = new Set(d.orders.map(o => o.id));
    const newOnes = d.orders.filter(o => o.status === "sent" && !knownIds.has(o.id));
    if (newOnes.length) beep();
    knownIds = activeIds;
    render(d.orders);
  } catch (e) {
    conn.classList.add("offline");
    conn.textContent = "● " + t("disconnected");
  }
}

async function init() {
  try { setLang(localStorage.getItem("pos_lang") || "id"); } catch (e) {}
  try { applyLang(); } catch (e) {}
  await loadEmpSelect();
  try {
    const d = await api("/api/me");
    if (d.user) {
      kUser = d.user;
      document.getElementById("kitchen-login").style.display = "none";
      document.getElementById("kitchen-app").style.display = "block";
      startClock();
      poll();
      setInterval(poll, POLL_MS);
    }
  } catch (e) { /* يبقى على شاشة الدخول */ }
}
init();
