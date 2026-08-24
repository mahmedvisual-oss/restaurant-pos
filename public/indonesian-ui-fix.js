/* Indonesian UI leakage guard.
 * Keeps Arabic as the source language/backend value, but translates visible UI
 * text when the active language is Indonesian. It is intentionally presentation-only.
 */
(function () {
  "use strict";

  const EXTRA = {
    "العائلات": "Keluarga",
    "الصالة": "Ruang Utama",
    "تيك أواي": "Bawa Pulang",
    "المدير": "Manajer",
    "التقارير": "Laporan",
    "التقرير المالي الاحترافي": "Laporan Keuangan Profesional",
    "📑 التقرير المالي الاحترافي": "📑 Laporan Keuangan Profesional",
    "تقرير مالي احترافي للطباعة": "Laporan keuangan profesional untuk dicetak",
    "جاري تجهيز التقرير...": "Menyiapkan laporan...",
    "الفترة": "Periode",
    "تاريخ الإصدار": "Diterbitkan",
    "طباعة التقرير الاحترافي": "Cetak laporan profesional",
    "صافي المبيعات": "Penjualan bersih",
    "عدد الفواتير": "Jumlah faktur",
    "متوسط الفاتورة": "Rata-rata faktur",
    "الضريبة": "Pajak",
    "الخصومات": "Diskon",
    "المحصّل على الفواتير": "Terkumpul dari faktur",
    "مبيعات الآجل": "Penjualan kredit",
    "تحصيل الآجل خلال الفترة": "Penagihan kredit periode ini",
    "الملخص التنفيذي": "Ringkasan eksekutif",
    "المجموع قبل الضريبة": "Subtotal sebelum pajak",
    "الإجمالي النهائي": "Total akhir",
    "تحصيل نقدي": "Penerimaan tunai",
    "تحصيل إلكتروني / بنكي": "Penerimaan elektronik / bank",
    "الرصيد غير المحصّل من الفواتير": "Saldo faktur belum tertagih",
    "تحليل طرق الدفع": "Analisis metode pembayaran",
    "طريقة الدفع": "Metode pembayaran",
    "العمليات": "Transaksi",
    "المبلغ": "Jumlah",
    "النسبة": "Persentase",
    "الإجمالي": "Total",
    "لا توجد عمليات": "Tidak ada transaksi",
    "أداء الكاشير / الموظفين": "Kinerja kasir / karyawan",
    "الموظف": "Karyawan",
    "الفواتير": "Faktur",
    "المبيعات": "Penjualan",
    "لا توجد بيانات": "Tidak ada data",
    "الأصناف الأكثر مبيعًا": "Item terlaris",
    "الصنف": "Item",
    "الكمية": "Jumlah",
    "الإيراد": "Pendapatan",
    "المبيعات اليومية": "Penjualan harian",
    "التاريخ": "Tanggal",
    "متوسط الفاتورة": "Rata-rata faktur",
    "تم إصدار التقرير بواسطة نظام نقاط البيع": "Laporan diterbitkan oleh sistem POS",
    "المطعم": "Restoran",
    "متاحة": "Tersedia",
    "مشغولة": "Terisi",
    "محجوزة": "Dipesan",
    "طاولة": "Meja",
    "القائمة": "Menu",
    "الفاتورة": "Tagihan",
    "دفع": "Bayar",
    "حفظ": "Simpan",
    "مطبخ": "Dapur",
    "الحجوزات": "Reservasi",
    "إعدادات": "Pengaturan",
    "أدوات المدير": "Alat Manajer",
    "إدارة القائمة": "Kelola Menu",
    "إدارة الطاولات": "Kelola Meja",
    "إدارة أقسام الطاولات": "Kelola Bagian Meja",
    "رقم الطاولة": "Nomor meja",
    "القسم": "Bagian",
    "إضافة طاولة": "Tambah meja",
    "إلغاء التعديل": "Batal edit",
    "إضافة قسم": "Tambah bagian",
    "إغلاق اليوم": "Tutup Hari",
    "إغلاق": "Tutup",
    "إلغاء": "Batal",
    "تأكيد": "Konfirmasi"
  };

  let lastLang = null;
  let scheduled = false;

  function activeLang() {
    try { return typeof currentLang !== "undefined" ? currentLang : "id"; } catch (_) { return "id"; }
  }

  function reverseI18n(lang) {
    const out = Object.create(null);
    try {
      const ar = I18N && I18N.ar;
      const target = I18N && I18N[lang];
      if (!ar || !target) return out;
      Object.keys(ar).forEach(k => {
        const a = ar[k];
        const v = target[k];
        if (typeof a === "string" && typeof v === "string" && a && v) out[a] = v;
      });
    } catch (_) {}
    return out;
  }

  function translateText(text, map) {
    if (!text || !/[\u0600-\u06FF]/.test(text)) return text;
    const trimmed = text.trim();
    if (EXTRA[trimmed]) return text.replace(trimmed, EXTRA[trimmed]);
    if (map[trimmed]) return text.replace(trimmed, map[trimmed]);

    let result = text;
    const keys = Object.keys(EXTRA).sort((a, b) => b.length - a.length);
    for (const k of keys) if (result.includes(k)) result = result.split(k).join(EXTRA[k]);
    if (result !== text) return result;

    const i18nKeys = Object.keys(map).sort((a, b) => b.length - a.length);
    for (const k of i18nKeys) if (result.includes(k)) result = result.split(k).join(map[k]);
    return result;
  }

  function scan(root) {
    if (!root || activeLang() !== "id") return;
    const map = reverseI18n("id");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      if (!n.parentElement || /SCRIPT|STYLE|TEXTAREA/.test(n.parentElement.tagName)) return;
      const next = translateText(n.nodeValue, map);
      if (next !== n.nodeValue) n.nodeValue = next;
    });

    root.querySelectorAll?.("input[placeholder],textarea[placeholder],[title],[aria-label]").forEach(el => {
      ["placeholder", "title", "aria-label"].forEach(attr => {
        if (!el.hasAttribute(attr)) return;
        const old = el.getAttribute(attr);
        const next = translateText(old, map);
        if (next !== old) el.setAttribute(attr, next);
      });
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(document.body); });
  }

  function start() {
    if (activeLang() !== "id") return;
    scan(document.body);
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    setInterval(() => {
      const lang = activeLang();
      if (lang !== lastLang) { lastLang = lang; scan(document.body); }
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
