/* MOBILE_BOOT
 * Keeps the unified POS usable on narrow screens even when the legacy
 * mobile-nav markup is absent from the server-rendered template.
 * UI-only: no accounting, payment, order, or database logic.
 */
(function () {
  "use strict";

  function install() {
    if (document.getElementById("mobile-nav")) return;

    const nav = document.createElement("nav");
    nav.id = "mobile-nav";
    nav.className = "mobile-nav";
    nav.setAttribute("aria-label", "Mobile navigation");
    nav.innerHTML = [
      '<button type="button" class="mobile-nav-btn" data-panel-btn="menu" onclick="switchPanel(\'menu\')">🍽️<span data-i18n="menuFood">القائمة</span></button>',
      '<button type="button" class="mobile-nav-btn" data-panel-btn="cart" onclick="switchPanel(\'cart\')">🧾<span data-i18n="currentInvoice">الفاتورة</span><span class="mob-badge" id="mobile-cart-badge" style="display:none">0</span></button>',
      '<button type="button" class="mobile-nav-btn" data-panel-btn="tables" onclick="switchPanel(\'tables\')">🪑<span data-i18n="tables">الطاولات</span></button>',
      '<button type="button" class="mobile-nav-btn" id="mobile-language-btn" aria-label="Language">🌐<span>Bahasa</span></button>'
    ].join("");

    document.body.appendChild(nav);

    const langMenu = document.createElement("div");
    langMenu.id = "mobile-language-menu";
    langMenu.innerHTML = [
      '<button type="button" data-lang="id">🇮🇩 Bahasa Indonesia</button>',
      '<button type="button" data-lang="en">🇬🇧 English</button>',
      '<button type="button" data-lang="ar">🇸🇦 العربية</button>'
    ].join("");
    document.body.appendChild(langMenu);

    const style = document.createElement("style");
    style.textContent = `
      @media (max-width:768px){
        html,body{width:100%;max-width:100%;overflow-x:hidden}
        body{min-height:100dvh;padding-bottom:68px}
        .topbar{width:100%;max-width:100%;overflow:hidden}
        .brand-name{min-width:0;flex:1 1 auto}
        .top-actions{min-width:0;max-width:62vw;overflow-x:auto;scrollbar-width:none}
        .top-actions::-webkit-scrollbar{display:none}
        .main{width:100%;max-width:100%}
        #mobile-nav{position:fixed;left:0;right:0;bottom:0;z-index:9998;display:flex;gap:4px;padding:6px 6px calc(6px + env(safe-area-inset-bottom,0px));overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;background:var(--card,#fff);border-top:1px solid var(--border,#ddd)}
        #mobile-nav::-webkit-scrollbar{display:none}
        #mobile-nav .mobile-nav-btn{flex:1 0 72px;min-width:72px;min-height:52px;touch-action:manipulation}
        #mobile-language-menu{display:none;position:fixed;left:10px;right:10px;bottom:78px;z-index:10001;padding:8px;border:1px solid var(--border,#444);border-radius:14px;background:var(--card,#222);box-shadow:0 8px 30px rgba(0,0,0,.35)}
        #mobile-language-menu.show{display:grid;gap:6px}
        #mobile-language-menu button{width:100%;min-height:44px;border:1px solid var(--border,#444);border-radius:10px;background:var(--input,#333);color:var(--text,#fff);font:inherit}
        .modal-content{max-width:calc(100vw - 20px)!important}
        input,select,button,.btn{touch-action:manipulation}
      }
      @media(max-width:380px){#mobile-nav .mobile-nav-btn{min-width:60px;font-size:11px}#mobile-nav .mobile-nav-btn span{font-size:9px}}
      @media(min-width:769px){#mobile-nav,#mobile-language-menu{display:none!important}}
    `;
    document.head.appendChild(style);

    const langButton = document.getElementById("mobile-language-btn");
    const menu = document.getElementById("mobile-language-menu");
    langButton.addEventListener("click", function () { menu.classList.toggle("show"); });
    menu.addEventListener("click", function (event) {
      const choice = event.target.closest("button[data-lang]");
      if (!choice || typeof window.setLang !== "function") return;
      window.setLang(choice.dataset.lang);
      menu.classList.remove("show");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
