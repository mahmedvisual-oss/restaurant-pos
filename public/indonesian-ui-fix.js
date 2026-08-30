/* Universal UI language guard — presentation only.
 * Keeps visible interface text in the selected language.
 * Business values (prices, totals, customer names, menu item names, API data)
 * are never modified by this file.
 */
(function () {
  "use strict";

  const STATIC = {
    "العائلات": { ar: "العائلات", en: "Families", id: "Keluarga" },
    "الصالة": { ar: "الصالة", en: "Main Hall", id: "Ruang Utama" },
    "تيك أواي": { ar: "تيك أواي", en: "Takeaway", id: "Bawa Pulang" },
    "العائلات": { ar: "العائلات", en: "Families", id: "Keluarga" },
    "VIP": { ar: "VIP", en: "VIP", id: "VIP" },

    "مشروبات": { ar: "مشروبات", en: "Beverages", id: "Minuman" },
    "أطباق رئيسية": { ar: "أطباق رئيسية", en: "Main Dishes", id: "Hidangan Utama" },
    "مقبلات": { ar: "مقبلات", en: "Appetizers", id: "Makanan Pembuka" },
    "حلويات": { ar: "حلويات", en: "Desserts", id: "Makanan Penutup" },

    "المدير": { ar: "المدير", en: "Manager", id: "Manajer" },
    "التقارير": { ar: "التقارير", en: "Reports", id: "Laporan" },
    "طاولة": { ar: "طاولة", en: "Table", id: "Meja" },
    "القائمة": { ar: "القائمة", en: "Menu", id: "Menu" },
    "الفاتورة": { ar: "الفاتورة", en: "Invoice", id: "Tagihan" },
    "دفع": { ar: "دفع", en: "Pay", id: "Bayar" },
    "حفظ": { ar: "حفظ", en: "Save", id: "Simpan" },
    "مطبخ": { ar: "مطبخ", en: "Kitchen", id: "Dapur" },
    "الحجوزات": { ar: "الحجوزات", en: "Reservations", id: "Reservasi" },
    "إعدادات": { ar: "إعدادات", en: "Settings", id: "Pengaturan" },
    "أدوات المدير": { ar: "أدوات المدير", en: "Manager Tools", id: "Alat Manajer" },
    "إدارة القائمة": { ar: "إدارة القائمة", en: "Manage Menu", id: "Kelola Menu" },
    "إغلاق اليوم": { ar: "إغلاق اليوم", en: "Close Day", id: "Tutup Hari" },
    "إغلاق": { ar: "إغلاق", en: "Close", id: "Tutup" },
    "إلغاء": { ar: "إلغاء", en: "Cancel", id: "Batal" },
    "تأكيد": { ar: "تأكيد", en: "Confirm", id: "Konfirmasi" },
    "متاحة": { ar: "متاحة", en: "Available", id: "Tersedia" },
    "مشغولة": { ar: "مشغولة", en: "Occupied", id: "Terisi" },
    "محجوزة": { ar: "محجوزة", en: "Reserved", id: "Dipesan" },
    "متوسط الفاتورة": { ar: "متوسط الفاتورة", en: "Average Invoice", id: "Rata-rata Faktur" },
    "المجموع قبل الضريبة": { ar: "المجموع قبل الضريبة", en: "Subtotal before tax", id: "Subtotal sebelum pajak" },
    "الإجمالي النهائي": { ar: "الإجمالي النهائي", en: "Final Total", id: "Total akhir" },
    "طريقة الدفع": { ar: "طريقة الدفع", en: "Payment Method", id: "Metode Pembayaran" },
    "المبلغ": { ar: "المبلغ", en: "Amount", id: "Jumlah" },
    "النسبة": { ar: "النسبة", en: "Percentage", id: "Persentase" },
    "الإجمالي": { ar: "الإجمالي", en: "Total", id: "Total" },
    "الموظف": { ar: "الموظف", en: "Employee", id: "Karyawan" },
    "الفواتير": { ar: "الفواتير", en: "Invoices", id: "Faktur" },
    "المبيعات": { ar: "المبيعات", en: "Sales", id: "Penjualan" },
    "الصنف": { ar: "الصنف", en: "Item", id: "Item" },
    "الكمية": { ar: "الكمية", en: "Quantity", id: "Jumlah" },
    "الإيراد": { ar: "الإيراد", en: "Revenue", id: "Pendapatan" },
    "التاريخ": { ar: "التاريخ", en: "Date", id: "Tanggal" },

    "All": { ar: "الكل", en: "All", id: "Semua" },
    "Available": { ar: "متاحة", en: "Available", id: "Tersedia" },
    "Occupied": { ar: "مشغولة", en: "Occupied", id: "Terisi" },
    "Reserved": { ar: "محجوزة", en: "Reserved", id: "Dipesan" },
    "Selected": { ar: "محددة", en: "Selected", id: "Dipilih" },
    "Current Invoice": { ar: "الفاتورة الحالية", en: "Current Invoice", id: "Tagihan Saat Ini" },
    "No table selected": { ar: "لم يتم اختيار طاولة", en: "No table selected", id: "Meja belum dipilih" },
    "Number of guests:": { ar: "عدد الأشخاص:", en: "Number of guests:", id: "Jumlah orang:" },
    "Apply": { ar: "تطبيق", en: "Apply", id: "Terapkan" },
    "Cart is empty": { ar: "السلة فارغة", en: "Cart is empty", id: "Keranjang kosong" },
    "Select a table then add items": { ar: "اختر طاولة ثم أضف أصناف", en: "Select a table then add items", id: "Pilih meja lalu tambah item" },
    "Invoice Summary": { ar: "ملخص الفاتورة", en: "Invoice Summary", id: "Ringkasan Faktur" },
    "Subtotal": { ar: "المجموع الفرعي", en: "Subtotal", id: "Subtotal" },
    "Tax": { ar: "الضريبة", en: "Tax", id: "Pajak" },
    "Total": { ar: "الإجمالي", en: "Total", id: "Total" },
    "Open Food": { ar: "أطعمة مفتوحة", en: "Open Food", id: "Makanan Terbuka" },
    "Open Other": { ar: "أخرى مفتوحة", en: "Open Other", id: "Lainnya Terbuka" },
    "Pay": { ar: "دفع", en: "Pay", id: "Bayar" },
    "Discount": { ar: "الخصم", en: "Discount", id: "Diskon" },
    "Save Order": { ar: "حفظ الطلب", en: "Save Order", id: "Simpan Pesanan" },
    "Send to Kitchen": { ar: "إرسال للمطبخ", en: "Send to Kitchen", id: "Kirim ke Dapur" },
    "Clear All": { ar: "إلغاء الكل", en: "Clear All", id: "Batal Semua" },
    "Transfer Order": { ar: "نقل الطلب", en: "Transfer Order", id: "Pindahkan Pesanan" },
    "Split": { ar: "تقسيم", en: "Split", id: "Pisah" },
    "Cancel Order": { ar: "إلغاء الطلب", en: "Cancel Order", id: "Batalkan Pesanan" },
    "Tables": { ar: "الطاولات", en: "Tables", id: "Meja" },
    "Food Menu": { ar: "قائمة الطعام", en: "Food Menu", id: "Menu Makanan" },
    "Reports": { ar: "التقارير", en: "Reports", id: "Laporan" },
    "Receipt Voucher": { ar: "سند قبض", en: "Receipt Voucher", id: "Bukti Struk" },
    "Kitchen": { ar: "المطبخ", en: "Kitchen", id: "Dapur" },
    "Table Reservations": { ar: "الحجوزات", en: "Table Reservations", id: "Reservasi Meja" },
    "Customer Database": { ar: "قاعدة العملاء", en: "Customer Database", id: "Database Pelanggan" },
    "Close Day": { ar: "إغلاق اليوم", en: "Close Day", id: "Tutup Hari" },
    "Manage Menu": { ar: "إدارة القائمة", en: "Manage Menu", id: "Kelola Menu" },
    "Manager Tools": { ar: "أدوات المدير", en: "Manager Tools", id: "Alat Manajer" },
    "Settings": { ar: "الإعدادات", en: "Settings", id: "Pengaturan" },
    "Logout": { ar: "خروج", en: "Logout", id: "Keluar" },
    "Professional POS System": { ar: "نظام نقاط البيع الاحترافي", en: "Professional POS System", id: "Sistem POS Profesional" },
    "No Items": { ar: "لا أصناف", en: "No Items", id: "Tidak ada item" },
    "No records": { ar: "لا توجد سجلات", en: "No records", id: "Tidak ada catatan" }
  };

  let scheduled = false;
  let lastLang = null;

  function activeLang() {
    try { return (typeof currentLang !== "undefined" && currentLang) ? currentLang : "id"; }
    catch (_) { return "id"; }
  }

  function flattenI18n(source, out) {
    if (!source || typeof source !== "object") return;
    Object.keys(source).forEach(key => {
      const value = source[key];
      if (value && typeof value === "object" && !Array.isArray(value)) flattenI18n(value, out);
      else if (typeof value === "string" && value) out.push([key, value]);
    });
  }

  function buildMap(lang) {
    const map = Object.create(null);
    const target = I18N && I18N[lang];
    if (!target) return map;

    const sources = [];
    ["ar", "en", "id"].forEach(sourceLang => {
      const source = I18N && I18N[sourceLang];
      if (source) flattenI18n(source, sources);
    });

    const targetPairs = [];
    flattenI18n(target, targetPairs);
    const targetValues = Object.create(null);
    targetPairs.forEach(([key, value]) => { targetValues[key] = value; });

    sources.forEach(([key, from]) => {
      const to = targetValues[key];
      if (from && to && from !== to) map[from] = to;
    });

    Object.keys(STATIC).forEach(source => {
      const row = STATIC[source];
      if (!row || !row[lang]) return;
      if (row[lang] !== source) map[source] = row[lang];
      ["ar", "en", "id"].forEach(sourceLang => {
        const from = row[sourceLang];
        const to = row[lang];
        if (sourceLang !== lang && from && to && from !== to) map[from] = to;
      });
    });

    return map;
  }

  function replaceText(text, map) {
    if (!text || !/[\u0600-\u06FF]|[A-Za-z]/.test(text)) return text;
    let result = String(text);
    Object.keys(map).sort((a, b) => b.length - a.length).forEach(key => {
      const value = map[key];
      if (value && result.includes(key)) result = result.split(key).join(value);
    });
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

    root.querySelectorAll?.("input[placeholder], textarea[placeholder], select option, [title], [aria-label]").forEach(el => {
      ["placeholder", "title", "aria-label"].forEach(attr => {
        if (!el.hasAttribute(attr)) return;
        const oldValue = el.getAttribute(attr);
        const newValue = replaceText(oldValue, map);
        if (newValue !== oldValue) el.setAttribute(attr, newValue);
      });
      if (el.tagName === "OPTION") {
        const next = replaceText(el.textContent, map);
        if (next !== el.textContent) el.textContent = next;
      }
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
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
    setInterval(() => {
      const lang = activeLang();
      if (lang !== lastLang) { lastLang = lang; scan(document.body); }
    }, 250);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();