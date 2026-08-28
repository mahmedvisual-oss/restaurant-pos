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

    /* Remaining static UI strings found by the leakage scan. */
    "نقل/دمج طلب الطاولة": "Pindahkan/Gabung pesanan meja",
    "داخل طلب الطاولة": "ke dalam pesanan meja",
    "دمج طلب الطاولة": "Gabungkan pesanan meja",
    "دمج الطلب": "Gabungkan pesanan",
    "نقل": "Pindahkan",
    "اختر طاولة وأضف أصنافاً": "Pilih meja dan tambahkan item",
    "طاولة ${i} - ${capacity} أشخاص": "Meja ${i} - ${capacity} orang",
    "بدون قسم": "Tanpa bagian",
    "طاولة ${tableLabel}": "Meja ${tableLabel}",
    "دمج طلب الطاولة ": "Gabungkan pesanan meja ",
    " داخل طلب الطاولة ": " ke dalam pesanan meja ",
    "؟\\n\\n": "?\\n\\n",
    "سيتم جمع الأصناف وعدد الأشخاص،": "Item dan jumlah orang akan digabung,",
    "وسيصبح طلب الطاولة المصدر مغلقاً.": "dan pesanan meja sumber akan ditutup.",
    "الأصناف": "Item",
    "المجموع": "Subtotal",
    "عدد الفواتير": "Jumlah faktur",
    "فاتورة": "Faktur",
    "فاتورة${p}": "Faktur${p}",
    "المتبقي": "Sisa",
    "بعض الأصناف لم تُوزع على أي فاتورة": "Beberapa item belum dibagikan ke faktur mana pun",
    "توزيع غير مكتمل": "Pembagian belum lengkap",
    "إنهاء": "Selesai",
    "السلة فاضية": "Keranjang kosong",
    "يوجد تقسيم جارٍ، أكمل فاتورة أولاً أو أنهِه": "Pembagian sedang berlangsung, selesaikan faktur terlebih dahulu atau akhiri pembagian",
    "يوجد تقسيم جارٍ بالفعل": "Pembagian sudah berlangsung",
    "يجب توزيع الأصناف أولاً": "Bagikan item terlebih dahulu",
    "تم التقسيم إلى": "Dibagi menjadi",
    "الفاتورة الحالية": "Faktur saat ini",
    "حذف هذه الطاولة؟": "Hapus meja ini?",
    "تم الحذف": "Berhasil dihapus",
    "لا يوجد طاولة محددة": "Belum ada meja yang dipilih",
    "الطاولة غير صحيحة": "Meja tidak valid",
    "تعذر تنفيذ العملية": "Operasi gagal",
    "تم دمج الطلبات في الطاولة": "Pesanan berhasil digabung ke meja",
    "تم نقل الطلب إلى الطاولة": "Pesanan berhasil dipindahkan ke meja",
    "اسحب الطاولات لتغيير مواقعها • اضغط ⚡ لحفظ": "Seret meja untuk mengubah posisi • tekan ⚡ untuk menyimpan",
    "اضغط ✏️ لتعديل مواقع الطاولات": "Tekan ✏️ untuk mengubah posisi meja",
    "حفظ": "Simpan",
    "تعديل": "Edit",
    "ترتيب": "Atur",
    "لا توجد طلبات معلقة": "Tidak ada pesanan tertunda",
    "طلب #${r.order_id}": "Pesanan #${r.order_id}",
    "الطاولة": "Meja",
    "المبلغ": "Jumlah",
    "طلب": "Pesanan",
    "السبب": "Alasan",
    "حماية الإلغاء: يتطلب PIN المدير (الطلب بدرجة جاهز/مدفوع)": "Perlindungan pembatalan: PIN manajer diperlukan (pesanan siap/dibayar)",
    "موافقة": "Setujui",
    "رفض": "Tolak",
    "هذه الفاتورة مدفوعة — سيسجّل النظام سند مردودات مرقّماً عند الإلغاء. حدّد طريقة رد المبلغ للعميل:": "Faktur ini sudah dibayar — sistem akan mencatat bukti pengembalian dana bernomor saat pembatalan. Pilih metode pengembalian dana kepada pelanggan:",
    "اكتب رقم مرجع التحويل للرد": "Masukkan nomor referensi transfer untuk pengembalian",
    "إلغاء بحماية المدير": "Pembatalan dengan perlindungan manajer",
    "تمت الموافقة على الإلغاء": "Pembatalan disetujui",
    "بحماية PIN": "dengan perlindungan PIN",
    "سند مردودات": "Bukti pengembalian dana",
    "تم رفض طلب الإلغاء": "Permintaan pembatalan ditolak",
    "أخرى": "Lainnya",
    "اختر قسم ثم اكتب الاسم الجديد (مثال: OldName=NewName)": "Pilih bagian lalu masukkan nama baru (contoh: OldName=NewName)",
    "اكتب اسم القسم للحذف": "Masukkan nama bagian yang akan dihapus",
    "القسم موجود": "Bagian sudah ada",
    "تمت إضافة القسم": "Bagian berhasil ditambahkan",
    "تم حذف القسم": "Bagian berhasil dihapus",
    "الصيغة: OldName=NewName": "Format: OldName=NewName",
    "اكتب الاسمين": "Masukkan kedua nama",
    "تم التعديل إلى:": "Diubah menjadi:",
    "اكتب الاسم الجديد": "Masukkan nama baru",
    "تم تعديل القسم إلى:": "Bagian diubah menjadi:",
    "لا أقسام": "Tidak ada bagian",
    "أدخل معرف واسم القسم": "Masukkan ID dan nama bagian",
    "حذف القسم؟": "Hapus bagian?",
    "اختيار إيموجي": "Pilih emoji",
    "اختر المادة": "Pilih bahan",
    "لا روابط": "Tidak ada tautan",
    "استبدال القائمة بقائمة مؤقتة جاهزة": "Ganti menu dengan menu sementara siap pakai",
    "قائمة مؤقتة": "Menu sementara",
    "سيتم تعطيل الأصناف الحالية وإضافة قائمة مؤقتة جاهزة (20 صنف). هل تريد المتابعة؟": "Item saat ini akan dinonaktifkan dan menu sementara siap pakai (20 item) akan ditambahkan. Lanjutkan?",
    "المبلغ المدفوع أقل من الإجمالي": "Jumlah yang dibayar kurang dari total",
    "دفع زائد: يُسجّل آجل بقيمة الإجمالي فقط": "Pembayaran berlebih: kredit dicatat sebesar total saja",
    "يُردّ للعميل": "dikembalikan kepada pelanggan",
    "على العميل": "menjadi piutang pelanggan",
    "اكتب اسم صاحب الآجل": "Masukkan nama pelanggan kredit",
    "اكتب رقم مرجع التحويل البنكي": "Masukkan nomor referensi transfer bank",
    "آجل: يُدفع الآن": "Kredit: dibayar sekarang",
    "الحد الأدنى للطلب": "Minimum pesanan",
    "مخزون منخفض!": "Stok rendah!",
    "التكلفة": "Biaya",
    "الحد الأدنى": "Minimum",
    "لا أصناف": "Tidak ada item",
    "لا توجد طاولة محددة": "Belum ada meja yang dipilih",
    "سجل الدخول أولاً": "Silakan masuk terlebih dahulu",
    "متاح للمدير فقط": "Hanya tersedia untuk manajer",
    "PIN غير صحيح": "PIN salah",
    "PIN المدير غير صحيح": "PIN manajer salah",
    "الاسم ورقم PIN مطلوبان": "Nama dan PIN wajib diisi",
    "PIN يجب أن يكون 4 أرقام على الأقل": "PIN harus terdiri dari minimal 4 digit",
    "موظف غير موجود": "Karyawan tidak ditemukan",
    "لا يمكنك تعطيل حسابك الخاص": "Anda tidak dapat menonaktifkan akun sendiri",
    "يجب بقاء مدير واحد نشط على الأقل": "Setidaknya satu manajer aktif harus tetap ada",
    "لا يمكنك حذف حسابك الخاص": "Anda tidak dapat menghapus akun sendiri",
    "نسبة الضريبة بين 0 و 1 (مثال 0.15)": "Tarif pajak harus antara 0 dan 1 (contoh 0.15)",
    "نسبة ضريبة غير صالحة": "Tarif pajak tidak valid",
    "اختر ملف نسخة احتياطية (.db)": "Pilih file cadangan (.db)",
    "الملف ليس قاعدة بيانات SQLite صالحة": "File bukan database SQLite yang valid",
    "قاعدة البيانات تالفة أو غير مكتملة": "Database rusak atau tidak lengkap",
    "تعذر فتح الملف": "Tidak dapat membuka file",
    "اليوم مغلق بالفعل": "Hari sudah ditutup",
    "النسخة غير موجودة": "Cadangan tidak ditemukan",
    "اسم ملف غير صالح": "Nama file tidak valid",
    "غير مسجل": "Belum masuk",
    "الاسم مطلوب": "Nama wajib diisi",
    "أدخل اسم الصنف": "Masukkan nama item",
    "كود غير صالح": "Kode tidak valid",
    "تم استخدام هذا الكود بالفعل": "Kode ini sudah digunakan",
    "انتهت صلاحية الكود": "Kode sudah kedaluwarsa",
    "رقم الهاتف مسجّل لعميل آخر": "Nomor telepon sudah terdaftar untuk pelanggan lain",
    "تعذر فتح النسخة": "Tidak dapat membuka cadangan",
    "تعذر قراءة الملف": "Tidak dapat membaca file",
    "النسخة تالفة": "Cadangan rusak",
    "النقدي": "Tunai",
    "تحويل BCA": "Transfer BCA",
    "تحويل مانديري": "Transfer Mandiri",
    "نقداً": "Tunai"
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
