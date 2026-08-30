/* Universal UI language leakage guard — presentation only.
 * Translates hard-coded UI strings in the rendered DOM to the active language.
 * Does not modify backend values, database values, menu data, or business logic.
 */
(function () {
  "use strict";

  const EXTRA = {
    "العائلات": "Keluarga", "الصالة": "Ruang Utama", "تيك أواي": "Bawa Pulang",
    "المدير": "Manajer", "التقارير": "Laporan", "طاولة": "Meja", "القائمة": "Menu",
    "الفاتورة": "Tagihan", "دفع": "Bayar", "حفظ": "Simpan", "مطبخ": "Dapur",
    "الحجوزات": "Reservasi", "إعدادات": "Pengaturan", "أدوات المدير": "Alat Manajer",
    "إدارة القائمة": "Kelola Menu", "إغلاق اليوم": "Tutup Hari", "إغلاق": "Tutup",
    "إلغاء": "Batal", "تأكيد": "Konfirmasi", "متاحة": "Tersedia", "مشغولة": "Terisi",
    "محجوزة": "Dipesan", "متوسط الفاتورة": "Rata-rata faktur",
    "المجموع قبل الضريبة": "Subtotal sebelum pajak", "الإجمالي النهائي": "Total akhir",
    "طريقة الدفع": "Metode pembayaran", "المبلغ": "Jumlah", "النسبة": "Persentase",
    "الإجمالي": "Total", "الموظف": "Karyawan", "الفواتير": "Faktur", "المبيعات": "Penjualan",
    "الصنف": "Item", "الكمية": "Jumlah", "الإيراد": "Pendapatan", "التاريخ": "Tanggal",
    "All": "Semua", "Available": "Tersedia", "Occupied": "Terisi", "Reserved": "Dipesan",
    "Current Invoice": "Tagihan Saat Ini", "No table selected": "Belum ada meja dipilih",
    "Number of guests:": "Jumlah tamu:", "Apply": "Terapkan", "Cart is empty": "Keranjang kosong",
    "Select a table then add items": "Pilih meja lalu tambahkan item", "Invoice Summary": "Ringkasan Tagihan",
    "Subtotal": "Subtotal", "Tax": "Pajak", "Total": "Total", "Open Food": "Makanan Terbuka",
    "Open Other": "Lainnya", "Pay": "Bayar", "Discount": "Diskon", "Save Order": "Simpan Pesanan",
    "Send to Kitchen": "Kirim ke Dapur", "Clear All": "Hapus Semua", "Transfer Order": "Pindahkan Pesanan",
    "Split": "Pisah", "Cancel Order": "Batalkan Pesanan", "Tables": "Meja", "Food Menu": "Menu Makanan",
    "Reports": "Laporan", "Receipt Voucher": "Bukti Struk", "Kitchen": "Dapur",
    "Table Reservations": "Reservasi Meja", "Customer Database": "Database Pelanggan", "Close Day": "Tutup Hari",
    "Manage Menu": "Kelola Menu", "Manager Tools": "Alat Manajer", "Settings": "Pengaturan", "Logout": "Keluar",
    "Professional POS System": "Sistem POS Profesional", "No Items": "Tidak ada item", "No records": "Tidak ada catatan"
  };

  let scheduled = false;
  let lastLang = null;

  function activeLang() {
    try { return typeof currentLang !== "undefined" ? currentLang : "id"; }
    catch (_) { return "id"; }
  }

  function buildMap(lang) {
    const out = Object.create(null);
    try {
      const langs = ["ar", "en", "id"];
      const target = I18N && I18N[lang];
      if (!target) return out;

      langs.forEach(sourceLang => {
        const source = I18N && I18N[sourceLang];
        if (!source) return;
        Object.keys(source).forEach(key => {
          const from = source[key];
          const to = target[key];
          if (typeof from === "string" && typeof to === "string" && from && to && from !== to) {
            out[from] = to;
          }
        });
      });

      if (lang === "id") Object.keys(EXTRA).forEach(k => { out[k] = EXTRA[k]; });
    } catch (_) {}
    return out;
  }

  function replaceText(text, map) {
    if (!text || !/[\u0600-\u06FF]|[A-Za-z]/.test(text)) return text;
    let result = String(text);
    const keys = Object.keys(map).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      const value = map[key];
      if (value && result.includes(key)) result = result.split(key).join(value);
    }
    return result;
  }

  function scan(root) {
    if (!root) return;
    const map = buildMap(activeLang());
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(node => {
      const parent = node.parentElement;
      if (!parent || /SCRIPT|STYLE|TEXTAREA|NOSCRIPT/.test(parent.tagName)) return;
      const next = replaceText(node.nodeValue, map);
      if (next !== node.nodeValue) node.nodeValue = next;
    });

    root.querySelectorAll?.("input[placeholder], textarea[placeholder], [title], [aria-label]").forEach(el => {
      ["placeholder", "title", "aria-label"].forEach(attr => {
        if (!el.hasAttribute(attr)) return;
        const oldValue = el.getAttribute(attr);
        const newValue = replaceText(oldValue, map);
        if (newValue !== oldValue) el.setAttribute(attr, newValue);
      });
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(document.body); });
  }

  function start() {
    if (!document.body) return;
    lastLang = activeLang();
    scan(document.body);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(() => {
      const lang = activeLang();
      if (lang !== lastLang) { lastLang = lang; scan(document.body); }
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
