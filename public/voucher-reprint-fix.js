/* CLOUD VOUCHER FIX
 * This file is intentionally loaded after app.js by the cloud loader.
 */
(function(){
  function printHtmlSamePage(html){
    const frame=document.createElement('iframe');
    frame.setAttribute('aria-hidden','true');
    frame.style.cssText='position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(frame);
    const doc=frame.contentDocument||frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){ console.error('VOUCHER PRINT ERROR',e); toast('⚠️ تعذر فتح الطباعة'); } setTimeout(()=>frame.remove(),1000); },50);
  }
  function esc(v){ return typeof escapeHtml==='function' ? escapeHtml(v==null?'':v) : String(v==null?'':v).replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\':'&#92;','"':'&quot;'}[m])); }
  function printCreditDirect(r){
    const dir=document.documentElement.dir||'ltr'; const name=typeof RESTAURANT_NAME!=='undefined'?RESTAURANT_NAME:'POS';
    const method=typeof methodName==='function'?methodName(r.method):(r.method||'نقدي');
    const cur=typeof fmtCur==='function'?fmtCur(r.amount):r.amount;
    const html=`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(r.receipt_no)}</title><style>@page{size:auto;margin:6mm}body{font-family:Segoe UI,Tahoma,sans-serif;width:300px;margin:0 auto;text-align:center;font-size:13px;color:#000}h3{margin:4px 0}.muted{font-size:11px;color:#555}.dash{border-top:1px dashed #000;margin:8px 0}table{width:100%;border-collapse:collapse}td{padding:4px 0}.right{text-align:${dir==='rtl'?'right':'left'}}.left{text-align:${dir==='rtl'?'left':'right'}}.amount{font-size:20px;font-weight:bold;color:#2563eb}.badge{display:inline-block;background:#2563eb;color:#fff;padding:4px 12px;border-radius:4px;font-weight:bold}</style></head><body><img src="/logo.png" style="width:30px;height:30px"><h3>${esc(name)}</h3><div class="muted">${esc(typeof t==='function'?t('appSubtitle'):'نظام نقاط البيع')}</div><div class="badge">🧾 ${esc(typeof t==='function'?t('creditVoucher'):'سند قبض')}</div><div class="muted">رقم السند: <b>${esc(r.receipt_no||'—')}</b></div><div class="dash"></div><table><tr><td class="right">العميل</td><td class="left">${esc(r.customer_name||'—')}</td></tr><tr><td class="right">الهاتف</td><td class="left">${esc(r.phone||'—')}</td></tr><tr><td class="right">الفاتورة</td><td class="left">${r.order_id?'#'+esc(r.order_id):(r.ledger_id?'#'+esc(r.ledger_id):'—')}</td></tr><tr><td class="right">التاريخ</td><td class="left">${esc(r.date||'—')}</td></tr><tr><td class="right">الكاشير</td><td class="left">${esc(r.employee||'—')}</td></tr></table><div class="dash"></div><table><tr><td class="right">المبلغ المحصل</td><td class="left amount">${cur}</td></tr><tr><td class="right">طريقة الدفع</td><td class="left">${esc(method)}</td></tr></table><div class="dash"></div><div class="muted">${esc(typeof t==='function'?t('thanks'):'شكراً لتعاملكم معنا')}</div></body></html>`;
    printHtmlSamePage(html);
  }
  function showVoucherDetails(r){
    const old=document.getElementById('cloud-voucher-detail-modal'); if(old) old.remove();
    const dir=document.documentElement.dir||'ltr';
    const html=`<div id="cloud-voucher-detail-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:10000;padding:16px" onclick="if(event.target===this)this.remove()"><div style="background:var(--card,#fff);color:var(--text,#111);border:1px solid var(--border,#ddd);border-radius:14px;padding:20px;width:520px;max-width:96vw;max-height:90vh;overflow:auto;direction:${dir}"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><b style="font-size:18px">🧾 تفاصيل سند القبض</b><button class="btn btn-sm" onclick="this.closest('#cloud-voucher-detail-modal').remove()">✕</button></div><table style="width:100%;border-collapse:collapse"><tr><td>رقم السند</td><td><b>${esc(r.receipt_no||'—')}</b></td></tr><tr><td>التاريخ</td><td>${esc(r.date||'—')}</td></tr><tr><td>العميل</td><td>${esc(r.customer_name||'—')}</td></tr><tr><td>الهاتف</td><td>${esc(r.phone||'—')}</td></tr><tr><td>الفاتورة</td><td>${r.order_id?'#'+esc(r.order_id):(r.ledger_id?'#'+esc(r.ledger_id):'—')}</td></tr><tr><td>طريقة الدفع</td><td>${typeof methodName==='function'?esc(methodName(r.method)):esc(r.method||'نقدي')}</td></tr><tr><td>الكاشير</td><td>${esc(r.employee||'—')}</td></tr><tr><td>المبلغ المحصل</td><td style="font-weight:bold;color:var(--success,#059669)">${typeof fmtCur==='function'?fmtCur(r.amount):r.amount}</td></tr></table><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn btn-success" id="cloud-voucher-detail-print">🖨️ إعادة الطباعة</button><button class="btn" onclick="this.closest('#cloud-voucher-detail-modal').remove()">إغلاق</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',html);
    document.getElementById('cloud-voucher-detail-print').onclick=()=>printCreditDirect(r);
  }
  window.printCustReceipt=function(kind,receiptNo,customerName,phone,amount,method,date,ledgerId){
    if(kind!=='credit_payment'){ return; }
    printCreditDirect({receipt_no:decodeURIComponent(receiptNo||''),customer_name:decodeURIComponent(customerName||''),phone:decodeURIComponent(phone||''),amount:Number(amount)||0,method:method||'نقدي',date:decodeURIComponent(date||''),ledger_id:Number(ledgerId)||0});
  };
  function enhanceRows(){
    document.querySelectorAll('button[onclick*="printCustReceipt(\\'credit_payment\\'"]').forEach(btn=>{
      const row=btn.closest('tr'); if(!row||row.dataset.voucherEnhanced)return; row.dataset.voucherEnhanced='1'; row.style.cursor='pointer'; row.title='عرض تفاصيل سند القبض'; row.addEventListener('click',e=>{ if(e.target.closest('button'))return; const c=row.querySelectorAll('td'); if(c.length<8)return; showVoucherDetails({receipt_no:c[0].textContent.trim(),date:c[1].textContent.trim(),customer_name:c[2].textContent.trim(),order_id:(c[3].textContent.match(/#(\d+)/)||[])[1]||'',method:c[4].textContent.trim(),employee:c[5].textContent.trim(),amount:Number((c[6].textContent||'').replace(/[^0-9.-]/g,''))||0}); });
    });
  }
  const oldLoad=window.loadCreditReport;
  if(typeof oldLoad==='function') window.loadCreditReport=async function(){const r=await oldLoad.apply(this,arguments); setTimeout(enhanceRows,0); return r;};
  enhanceRows();
  new MutationObserver(enhanceRows).observe(document.body,{childList:true,subtree:true});
})();
