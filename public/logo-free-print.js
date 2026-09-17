/* LOGO_FREE_PRINT + MOBILE_OPERATIONAL_FIX */
(function () {
  "use strict";
  const re = /<img\b[^>]*\bsrc\s*=\s*["']\/logo\.png(?:\?[^"']*)?["'][^>]*>\s*/gi;
  const write = Document.prototype.write;
  Document.prototype.write = function () {
    const args = Array.prototype.map.call(arguments, v => typeof v === "string" ? v.replace(re, "") : v);
    return write.apply(this, args);
  };
  function mobileFix() {
    if (document.getElementById("mobile-operational-fix")) return;
    const s = document.createElement("style");
    s.id = "mobile-operational-fix";
    s.textContent = '@media (max-width:768px){html,body{width:100%;max-width:100%;overflow-x:hidden}body{min-height:100dvh}.topbar{width:100%;max-width:100%;overflow:hidden}.brand-name{min-width:0;flex:1 1 auto}.top-actions{min-width:0;max-width:62vw;overflow-x:auto;scrollbar-width:none}.top-actions::-webkit-scrollbar{display:none}.main{width:100%;max-width:100%}#mobile-nav{position:fixed;left:0;right:0;bottom:0;z-index:9998;padding-bottom:env(safe-area-inset-bottom,0px);overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none}#mobile-nav::-webkit-scrollbar{display:none}#mobile-nav .mobile-nav-btn{flex:0 0 auto;min-width:68px;min-height:52px;touch-action:manipulation}#mobile-language-menu{z-index:10001!important}.modal-content{max-width:calc(100vw - 20px)!important}input,select,button,.btn{touch-action:manipulation}}@media(max-width:380px){#mobile-nav .mobile-nav-btn{min-width:60px;font-size:11px}#mobile-nav .mobile-nav-btn span{font-size:9px}}';
    document.head.appendChild(s);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mobileFix, {once:true});
  else mobileFix();
})();
