/* CLOUD VOUCHER FIX v2
 * Loaded after app.js. Handles credit-payment voucher rows without window.open().
 */
(function(){
  'use strict';

  function esc(v){
    if (typeof escapeHtml === 'function') return escapeHtml(v == null ? '' : String(v));
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(m){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }

  function printHtmlSamePage(html){
    // Never use window.open(). Render the receipt in a temporary print layer
    // inside the current page, then invoke the browser's print dialog.
    var old = document.getElementById('cloud-voucher-print-layer');
    if (old) old.remove();
    var layer = document.createElement('div');
    layer.id = 'cloud-voucher-print-layer';
    layer.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147483647;overflow:auto;';
    layer.innerHTML = html;
    document.body.appendChild(layer);

    var style = document.createElement('style');
    style.id = 'cloud-voucher-print-style';
    style.textContent = '@media print { body > *:not(#cloud-voucher-print-layer){display:none!important} #cloud-voucher-print-layer{position:static!important;display:block!important;overflow:visible!important} } @media screen { #cloud-voucher-print-layer{padding:20px;box-sizing:border-box} }';
    document.head.appendChild(style);

    setTimeout(function(){
      try {
        window.focus();
        window.print();
      } catch(e) {
        console.error('VOUCHER PRINT ERROR', e);
        if (typeof toast === 'function') toast('⚠️ تعذر فتح الطباعة');
      }
      setTimeout(function(){
        var l=document.getElementById('cloud-voucher-print-layer'); if(l) l.remove();
        var st=document.getElementById('cloud-voucher-print-style'); if(st) st.remove();
      },500);
    },100);
  }

  function printCreditDirect(r){
    var dir=document.documentElement.dir || 'ltr';
    var name=(typeof RESTAURANT_NAME !== 'undefined' ? RESTAURANT_NAME : 'POS');
    var method=(typeof methodName === 'function' ? methodName(r.method) : (r.method || 'نقدي'));
    var cur=(typeof fmtCur === 'function' ? fmtCur(Number(r.amount)||0) : String(r.amount||0));
    var html='<div style="font-family:Segoe UI,Tahoma,sans-serif;width:300px;margin:0 auto;text-align:center;font-size:13px;color:#000;direction:'+dir+'">'
      +'<img src="/logo.png" style="width:30px;height:30px">'
      +'<h3>'+esc(name)+'</h3>'
      +'<div style="font-size:11px;color:#555">'+esc(typeof t==='function'?t('appSubtitle'):'نظام نقاط البيع')+'</div>'
      +'<div style="margin:10px 0;font-weight:bold">🧾 سند قبض</div>'
      +'<div style="font-size:11px;color:#555">رقم السند: <b>'+esc(r.receipt_no||'—')+'</b></div>'
      +'<hr style="border:0;border-top:1px dashed #000;margin:8px 0">'
      +'<table style="width:100%;border-collapse:collapse"><tr><td style="text-align:right">العميل</td><td style="text-align:left">'+esc(r.customer_name||'—')+'</td></tr>'
      +'<tr><td style="text-align:right">الهاتف</td><td style="text-align:left">'+esc(r.phone||'—')+'</td></tr>'
      +'<tr><td style="text-align:right">الفاتورة</td><td style="text-align:left">'+(r.order_id?'#'+esc(r.order_id):(r.ledger_id?'#'+esc(r.ledger_id):'—'))+'</td></tr>'
      +'<tr><td style="text-align:right">التاريخ</td><td style="text-align:left">'+esc(r.date||'—')+'</td></tr>'
      +'<tr><td style="text-align:right">الكاشير</td><td style="text-align:left">'+esc(r.employee||'—')+'</td></tr></table>'
      +'<hr style="border:0;border-top:1px dashed #000;margin:8px 0">'
      +'<div style="display:flex;justify-content:space-between"><b>المبلغ المحصل</b><b style="font-size:20px">'+cur+'</b></div>'
      +'<div style="display:flex;justify-content:space-between;margin-top:8px"><b>طريقة الدفع</b><span>'+esc(method)+'</span></div>'
      +'<hr style="border:0;border-top:1px dashed #000;margin:8px 0">'
      +'<div style="font-size:11px;color:#555">شكراً لتعاملكم معنا</div></div>';
    printHtmlSamePage(html);
  }

  function showVoucherDetails(r){
    var old=document.getElementById('cloud-voucher-detail-modal'); if(old) old.remove();
    var dir=document.documentElement.dir || 'ltr';
    var modal=document.createElement('div');
    modal.id='cloud-voucher-detail-modal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483646;padding:16px;direction:'+dir+';';
    modal.innerHTML='<div style="background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:14px;padding:20px;width:520px;max-width:96vw;max-height:90vh;overflow:auto">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><b style="font-size:18px">🧾 تفاصيل سند القبض</b><button type="button" class="btn btn-sm" data-voucher-close>✕</button></div>'
      +'<table style="width:100%;border-collapse:collapse"><tr><td>رقم السند</td><td><b>'+esc(r.receipt_no||'—')+'</b></td></tr>'
      +'<tr><td>التاريخ</td><td>'+esc(r.date||'—')+'</td></tr><tr><td>العميل</td><td>'+esc(r.customer_name||'—')+'</td></tr>'
      +'<tr><td>الهاتف</td><td>'+esc(r.phone||'—')+'</td></tr><tr><td>الفاتورة</td><td>'+(r.order_id?'#'+esc(r.order_id):(r.ledger_id?'#'+esc(r.ledger_id):'—'))+'</td></tr>'
      +'<tr><td>طريقة الدفع</td><td>'+esc(typeof methodName==='function'?methodName(r.method):(r.method||'نقدي'))+'</td></tr>'
      +'<tr><td>الكاشير</td><td>'+esc(r.employee||'—')+'</td></tr><tr><td>المبلغ المحصل</td><td style="font-weight:bold;color:var(--success,#059669)">'+(typeof fmtCur==='function'?fmtCur(Number(r.amount)||0):esc(r.amount))+'</td></tr></table>'
      +'<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button type="button" class="btn btn-success" data-voucher-print>🖨️ إعادة الطباعة</button><button type="button" class="btn" data-voucher-close>إغلاق</button></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',function(e){
      if(e.target===modal || e.target.closest('[data-voucher-close]')) modal.remove();
      if(e.target.closest('[data-voucher-print]')) printCreditDirect(r);
    });
  }

  function getVoucherFromRow(row){
    var c=row.querySelectorAll('td');
    if(c.length<7) return null;
    var text=function(i){return c[i]?c[i].textContent.trim():'';};
    var amountText=text(6).replace(/[^0-9.-]/g,'');
    return {
      receipt_no:text(0), date:text(1), customer_name:text(2),
      order_id:(text(3).match(/#(\d+)/)||[])[1]||'', method:text(4), employee:text(5),
      amount:Number(amountText)||0
    };
  }

  function enhanceRows(){
    // Do not rely on a fragile CSS attribute selector. Find the actual buttons
    // and inspect their onclick text instead.
    document.querySelectorAll('button').forEach(function(btn){
      var onclick=btn.getAttribute('onclick')||'';
      if(onclick.indexOf('printCustReceipt')===-1 || onclick.indexOf('credit_payment')===-1) return;
      if(btn.dataset.cloudVoucherFixed==='1') return;
      var row=btn.closest('tr'); if(!row) return;
      btn.dataset.cloudVoucherFixed='1';

      // Remove the old popup-based handler completely.
      btn.removeAttribute('onclick');
      btn.onclick=function(e){
        e.preventDefault(); e.stopPropagation();
        var r=getVoucherFromRow(row);
        if(r) printCreditDirect(r);
      };

      row.dataset.voucherEnhanced='1';
      row.style.cursor='pointer';
      row.title='عرض تفاصيل سند القبض';
      row.addEventListener('click',function(e){
        if(e.target.closest('button')) return;
        var r=getVoucherFromRow(row);
        if(r) showVoucherDetails(r);
      });
    });
  }

  // Also override the legacy global so any existing inline call cannot invoke
  // the old window.open() implementation.
  window.printCustReceipt=function(kind,receiptNo,customerName,phone,amount,method,date,ledgerId){
    if(kind!=='credit_payment') return;
    printCreditDirect({receipt_no:decodeURIComponent(receiptNo||''),customer_name:decodeURIComponent(customerName||''),phone:decodeURIComponent(phone||''),amount:Number(amount)||0,method:method||'نقدي',date:decodeURIComponent(date||''),ledger_id:Number(ledgerId)||0});
  };

  enhanceRows();
  new MutationObserver(enhanceRows).observe(document.body,{childList:true,subtree:true});
})();
