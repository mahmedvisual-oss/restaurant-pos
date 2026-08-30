/* Indonesian UI leakage guard — presentation only.
 * Does not modify backend values, database values, menu data, or business logic.
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
    "تأكيد": "Konfirmasi",

    "All": "Semua",
    "Available": "Tersedia",
    "Occupied": "Terisi",
    "Reserved": "Dipesan",
    "Current Invoice": "Tagihan Saat Ini",
    "No table selected": "Belum ada meja dipilih",
    "Number of guests:": "Jumlah tamu:",
    "Apply": "Terapkan",
    "Cart is empty": "Keranjang kosong",
    "Select a table then add items": "Pilih meja lalu tambahkan item",
    "Invoice Summary": "Ringkasan Tagihan",
    "Subtotal": "Subtotal",
    "Tax": "Pajak",
    "Total": "Total",
    "Open Food": "Makanan Terbuka",
    "Open Other": "Lainnya",
    "Pay": "Bayar",
    "Discount": "Diskon",
    "Save Order": "Simpan Pesanan",
    "Send to Kitchen": "Kirim ke Dapur",
    "Clear All": "Hapus Semua",
    "Transfer Order": "Pindahkan Pesanan",
    "Split": "Pisah",
    "Cancel Order": "Batalkan Pesanan",
    "Tables": "Meja",
    "Food Menu": "Menu Makanan",
    "Reports": "Laporan",
    "Receipt Voucher": "Bukti Struk",
    "Kitchen": "Dapur",
    "Table Reservations": "Reservasi Meja",
    "Customer Database": "Database Pelanggan",
    "Close Day": "Tutup Hari",
    "Manage Menu": "Kelola Menu",
    "Manager Tools": "Alat Manajer",
    "Settings": "Pengaturan",
    "Logout": "Keluar",
    "Professional POS System": "Sistem POS Profesional",
    "No Items": "Tidak ada item",
    "No records": "Tidak ada catatan",
    "Available": "Tersedia",
    "Occupied": "Terisi",
    "Reserved": "Dipesan"
  };

  let observer = null;
  let scheduled = false;
  let lastLang = null;

  function activeLang() {
    try {
      return typeof currentLang !== "undefined" ? currentLang : "id";
    } catch (_) {
      return "id";
    }
  }

  function reverseI18n(lang) {
    const out = Object.create(null);

    try {
      const ar = I18N && I18N.ar;
      const target = I18N && I18N[lang];

      if (!ar || !target) return out;

      Object.keys(ar).forEach(key => {
        const source = ar[key];
        const translated = target[key];

        if (
          typeof source === "string" &&
          typeof translated === "string" &&
          source &&
          translated &&
          source !== translated
        ) {
          out[source] = translated;
        }
      });
    } catch (_) {}

    return out;
  }

  function replaceFromMap(text, map) {
    if (!text || !/[\u0600-\u06FF]|[A-Za-z]/.test(text)) {
      return text;
    }

    let result = String(text);

    const keys = Object.keys(EXTRA)
      .concat(Object.keys(map))
      .sort((a, b) => b.length - a.length);

    for (const key of keys) {
      const value = Object.prototype.hasOwnProperty.call(EXTRA, key)
        ? EXTRA[key]
        : map[key];

      if (typeof value === "string" && value && result.includes(key)) {
        result = result.split(key).join(value);
      }
    }

    return result;
  }

  function scan(root) {
    if (!root || activeLang() !== "id") return;

    const map = reverseI18n("id");

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );

    const nodes = [];

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    nodes.forEach(node => {
      const parent = node.parentElement;

      if (!parent) return;

      if (/SCRIPT|STYLE|TEXTAREA|NOSCRIPT/.test(parent.tagName)) {
        return;
      }

      const next = replaceFromMap(node.nodeValue, map);

      if (next !== node.nodeValue) {
        node.nodeValue = next;
      }
    });

    root.querySelectorAll?.(
      "input[placeholder], textarea[placeholder], [title], [aria-label]"
    ).forEach(el => {
      ["placeholder", "title", "aria-label"].forEach(attr => {
        if (!el.hasAttribute(attr)) return;

        const oldValue = el.getAttribute(attr);
        const newValue = replaceFromMap(oldValue, map);

        if (newValue !== oldValue) {
          el.setAttribute(attr, newValue);
        }
      });
    });
  }

  function schedule() {
    if (scheduled) return;

    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;

      if (activeLang() === "id") {
        scan(document.body);
      }
    });
  }

  function start() {
    if (!document.body) return;

    lastLang = activeLang();

    if (lastLang === "id") {
      scan(document.body);
    }

    observer = new MutationObserver(schedule);

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    setInterval(() => {
      const lang = activeLang();

      if (lang !== lastLang) {
        lastLang = lang;

        if (lang === "id") {
          scan(document.body);
        }
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
