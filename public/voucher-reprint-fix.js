/* CLOUD VOUCHER FIX v3
 * Credit voucher report:
 * - opens invoice details from the current page
 * - loads the linked order from /api/orders/<id>
 * - shows linked credit payments
 * - prints without window.open()
 */
(function () {
  "use strict";

  const ROOT_ID = "cloud-voucher-detail-modal";
  const PRINT_ID = "cloud-voucher-print-layer";
  const PRINT_STYLE_ID = "cloud-voucher-print-style";

  function esc(v) {
    if (typeof escapeHtml === "function") {
      return escapeHtml(v == null ? "" : String(v));
    }
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (m) {
      return ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[m];
    });
  }

  function money(v) {
    return typeof fmtCur === "function"
      ? fmtCur(Number(v) || 0)
      : String(Number(v) || 0);
  }

  function method(v) {
    return typeof methodName === "function"
      ? methodName(v)
      : (v || "????");
  }

  function closeModal() {
    const el = document.getElementById(ROOT_ID);
    if (el) el.remove();
  }

  function cleanupPrint() {
    const layer = document.getElementById(PRINT_ID);
    const style = document.getElementById(PRINT_STYLE_ID);
    if (layer) layer.remove();
    if (style) style.remove();
  }

  function printCurrentPage(html) {
    cleanupPrint();

    const layer = document.createElement("div");
    layer.id = PRINT_ID;
    layer.innerHTML = html;
    layer.style.cssText =
      "position:fixed;inset:0;background:#fff;color:#000;" +
      "z-index:2147483647;overflow:auto;padding:20px;box-sizing:border-box;";

    document.body.appendChild(layer);

    const style = document.createElement("style");
    style.id = PRINT_STYLE_ID;
    style.textContent =
      "@media print {" +
      "body > *:not(#" + PRINT_ID + "){display:none!important;}" +
      "#" + PRINT_ID + "{position:static!important;display:block!important;" +
      "width:100%!important;min-height:0!important;padding:0!important;" +
      "overflow:visible!important;background:#fff!important;color:#000!important;}" +
      "}" +
      "@media screen {" +
      "#" + PRINT_ID + "{max-width:420px;margin:0 auto;}" +
      "}";
    document.head.appendChild(style);

    /*
     * print() is intentionally called from this function after the
     * print layer already exists. No popup and no window.open().
     */
    try {
      window.focus();
      window.print();
    } catch (e) {
      console.error("VOUCHER PRINT ERROR", e);
      if (typeof toast === "function") {
        toast("?? ???? ??? ???????");
      }
    }

    setTimeout(cleanupPrint, 1000);
  }

  function buildReceiptHtml(r, order) {
    const dir = document.documentElement.dir || "rtl";
    const restaurant =
      typeof RESTAURANT_NAME !== "undefined"
        ? RESTAURANT_NAME
        : "POS";

    const items = order && Array.isArray(order.items)
      ? order.items
      : [];

    const rows = items.map(function (item) {
      const subtotal =
        item.subtotal != null
          ? item.subtotal
          : (Number(item.price) || 0) * (Number(item.qty) || 1);

      return (
        "<tr>" +
          "<td style='text-align:right;padding:4px 0'>" +
            esc(item.name || "") +
            " ?" + esc(item.qty || 1) +
          "</td>" +
          "<td style='text-align:left;padding:4px 0'>" +
            money(subtotal) +
          "</td>" +
        "</tr>"
      );
    }).join("");

    const invoiceNo = r.order_id
      ? "#" + esc(r.order_id)
      : "?";

    const total = order && order.total != null
      ? order.total
      : r.amount;

    return (
      "<div style='" +
        "direction:" + esc(dir) + ";" +
        "font-family:Segoe UI,Tahoma,sans-serif;" +
        "width:300px;margin:0 auto;" +
        "font-size:13px;color:#000;" +
      "'>" +

        "<div style='text-align:center'>" +
          "<img src='/logo.png' style='width:35px;height:35px'>" +
          "<h3 style='margin:4px 0'>" + esc(restaurant) + "</h3>" +
          "<div style='font-size:11px;color:#555'>??? ???</div>" +
        "</div>" +

        "<hr style='border:0;border-top:1px dashed #000;margin:8px 0'>" +

        "<table style='width:100%;border-collapse:collapse'>" +
          "<tr><td>??? ?????</td><td style='text-align:left'><b>" +
            esc(r.receipt_no || "?") +
          "</b></td></tr>" +

          "<tr><td>????????</td><td style='text-align:left'><b>" +
            invoiceNo +
          "</b></td></tr>" +

          "<tr><td>???????</td><td style='text-align:left'>" +
            esc(r.date || "?") +
          "</td></tr>" +

          "<tr><td>??????</td><td style='text-align:left'>" +
            esc(r.customer_name || "?") +
          "</td></tr>" +

          "<tr><td>??????</td><td style='text-align:left'>" +
            esc(r.phone || "?") +
          "</td></tr>" +

          "<tr><td>???????</td><td style='text-align:left'>" +
            esc(r.employee || "?") +
          "</td></tr>" +

          "<tr><td>????? ?????</td><td style='text-align:left'>" +
            esc(method(r.method)) +
          "</td></tr>" +
        "</table>" +

        (
          rows
            ? "<hr style='border:0;border-top:1px dashed #000;margin:8px 0'>" +
              "<div style='font-weight:bold;margin-bottom:4px'>?????? ????????</div>" +
              "<table style='width:100%;border-collapse:collapse'>" +
                rows +
              "</table>"
            : ""
        ) +

        "<hr style='border:0;border-top:1px dashed #000;margin:8px 0'>" +

        "<table style='width:100%;border-collapse:collapse'>" +
          "<tr><td>?????? ????????</td>" +
            "<td style='text-align:left;font-weight:bold'>" +
              money(total) +
            "</td>" +
          "</tr>" +

          "<tr><td>?????? ??????</td>" +
            "<td style='text-align:left;font-weight:bold;font-size:18px'>" +
              money(r.amount) +
            "</td>" +
          "</tr>" +
        "</table>" +

        "<hr style='border:0;border-top:1px dashed #000;margin:8px 0'>" +

        "<div style='text-align:center;font-size:11px;color:#555'>" +
          "????? ???????? ????" +
        "</div>" +

      "</div>"
    );
  }

  function getRowData(btn, row) {
    const onclick = btn.getAttribute("onclick") || "";

    /*
     * Read the actual arguments generated by app.js instead of guessing
     * column positions.
     */
    const m = onclick.match(
      /printCustReceipt\(\s*['"]credit_payment['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*([0-9.-]+)\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]*)['"]\s*,\s*([0-9.-]+)\s*\)/
    );

    if (m) {
      return {
        receipt_no: decodeURIComponent(m[1] || ""),
        customer_name: decodeURIComponent(m[2] || ""),
        phone: decodeURIComponent(m[3] || ""),
        amount: Number(m[4]) || 0,
        method: m[5] || "????",
        date: decodeURIComponent(m[6] || ""),
        ledger_id: Number(m[7]) || 0,
        order_id: ""
      };
    }

    const cells = row ? row.querySelectorAll("td") : [];
    if (!cells || cells.length < 7) return null;

    const text = function (i) {
      return cells[i] ? cells[i].textContent.trim() : "";
    };

    const orderMatch = text(3).match(/#(\d+)/);

    return {
      receipt_no: text(0),
      date: text(1),
      customer_name: text(2),
      order_id: orderMatch ? orderMatch[1] : "",
      method: text(4),
      employee: text(5),
      amount: Number(text(6).replace(/[^0-9.-]/g, "")) || 0,
      ledger_id: 0
    };
  }

  async function loadOrder(orderId) {
    if (!orderId) return null;

    try {
      return await api("/api/orders/" + encodeURIComponent(orderId));
    } catch (e) {
      console.warn("Could not load linked order:", e);
      return null;
    }
  }

  async function loadPayments(ledgerId) {
    if (!ledgerId) return [];

    try {
      const rows = await api(
        "/api/credit/" + encodeURIComponent(ledgerId) + "/payments"
      );
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      console.warn("Could not load credit payments:", e);
      return [];
    }
  }

  async function resolveReceiptLink(r) {
    if (r.order_id) return r;

    try {
      const d = await api("/api/credit/receipts?from=&to=");
      const items = Array.isArray(d.items) ? d.items : [];

      const receiptNo = String(r.receipt_no || "").trim();
      const ledgerId = Number(r.ledger_id) || 0;
      const amount = Number(r.amount) || 0;

      let hit = items.find(function (x) {
        return receiptNo && String(x.receipt_no || "").trim() === receiptNo;
      });

      if (!hit && ledgerId) {
        hit = items.find(function (x) {
          return Number(x.ledger_id) === ledgerId &&
                 Math.abs((Number(x.amount) || 0) - amount) < 0.01;
        });
      }

      if (hit) {
        r.order_id = hit.order_id ? String(hit.order_id) : "";
        r.employee = hit.employee || r.employee || "";
        r.phone = hit.phone || r.phone || "";
        r.customer_name = hit.customer_name || r.customer_name || "";
        r.ledger_id = Number(hit.ledger_id || r.ledger_id || 0);
      }

      console.log("CLOUD VOUCHER LINK:", {
        receipt_no: r.receipt_no,
        ledger_id: r.ledger_id,
        order_id: r.order_id
      });

      return r;
    } catch (e) {
      console.error("CLOUD VOUCHER LINK ERROR:", e);
      return r;
    }
  }

  async function showDetails(r) {
    r = await resolveReceiptLink(r);
    closeModal();

    const modal = document.createElement("div");
    modal.id = ROOT_ID;
    modal.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.6);" +
      "z-index:2147483646;display:flex;align-items:center;" +
      "justify-content:center;padding:15px;box-sizing:border-box;";

    modal.innerHTML =
      "<div style='" +
        "background:var(--card,#fff);color:var(--text,#111);" +
        "width:600px;max-width:96vw;max-height:90vh;" +
        "overflow:auto;border-radius:14px;padding:20px;" +
        "box-sizing:border-box;" +
      "'>" +

        "<div style='display:flex;justify-content:space-between;" +
          "align-items:center;margin-bottom:15px'>" +

          "<b style='font-size:18px'>?? ?????? ??? ?????</b>" +

          "<button type='button' class='btn btn-sm' data-close>?</button>" +
        "</div>" +

        "<div data-loading style='text-align:center;padding:25px'>" +
          "???? ????? ?????? ????????..." +
        "</div>" +

      "</div>";

    document.body.appendChild(modal);

    modal.addEventListener("click", function (e) {
      if (
        e.target === modal ||
        e.target.closest("[data-close]")
      ) {
        closeModal();
      }

      if (e.target.closest("[data-print]")) {
        const order = modal.__order || null;
        printCurrentPage(buildReceiptHtml(r, order));
      }
    });

    const order = await loadOrder(r.order_id);
    const payments = await loadPayments(r.ledger_id);

    modal.__order = order;

    const items = order && Array.isArray(order.items)
      ? order.items
      : [];

    const itemsHtml = items.length
      ? (
        "<div style='margin-top:15px;font-weight:bold'>?????? ???????</div>" +
        "<table style='width:100%;border-collapse:collapse;margin-top:6px'>" +
          "<tr>" +
            "<th style='text-align:right'>?????</th>" +
            "<th>??????</th>" +
            "<th style='text-align:left'>??????</th>" +
          "</tr>" +

          items.map(function (item) {
            const subtotal =
              item.subtotal != null
                ? item.subtotal
                : (Number(item.price) || 0) *
                  (Number(item.qty) || 1);

            return (
              "<tr>" +
                "<td style='padding:5px'>" +
                  esc(item.name || "") +
                "</td>" +
                "<td style='text-align:center;padding:5px'>" +
                  esc(item.qty || 1) +
                "</td>" +
                "<td style='text-align:left;padding:5px'>" +
                  money(subtotal) +
                "</td>" +
              "</tr>"
            );
          }).join("") +

        "</table>"
      )
      : (
        "<div style='margin-top:15px;color:var(--muted,#777)'>" +
          (
            r.order_id
              ? "???? ????? ?????? ???????? #" + esc(r.order_id)
              : "?? ???? ?????? ?????? ?????? ???? ?????"
          ) +
        "</div>"
      );

    const paymentsHtml = payments.length
      ? (
        "<div style='margin-top:15px;font-weight:bold'>????? ???????</div>" +
        "<div style='margin-top:6px'>" +
          payments.map(function (p) {
            return (
              "<div style='display:flex;justify-content:space-between;" +
                "gap:10px;border-bottom:1px solid var(--border,#ddd);" +
                "padding:6px 0'>" +
                "<span>" + esc(p.date || "") + "</span>" +
                "<span>" + esc(method(p.method)) + "</span>" +
                "<b>" + money(p.amount) + "</b>" +
              "</div>"
            );
          }).join("") +
        "</div>"
      )
      : "";

    const details = modal.querySelector("[data-loading]");

    details.innerHTML =
      "<table style='width:100%;border-collapse:collapse'>" +

        "<tr><td>??? ?????</td><td><b>" +
          esc(r.receipt_no || "?") +
        "</b></td></tr>" +

        "<tr><td>???????</td><td>" +
          esc(r.date || "?") +
        "</td></tr>" +

        "<tr><td>??????</td><td>" +
          esc(r.customer_name || "?") +
        "</td></tr>" +

        "<tr><td>??????</td><td>" +
          esc(r.phone || "?") +
        "</td></tr>" +

        "<tr><td>????????</td><td><b>" +
          (r.order_id ? "#" + esc(r.order_id) : "?") +
        "</b></td></tr>" +

        "<tr><td>????? ?????</td><td>" +
          esc(method(r.method)) +
        "</td></tr>" +

        "<tr><td>???????</td><td>" +
          esc(r.employee || "?") +
        "</td></tr>" +

        "<tr><td>?????? ??????</td>" +
          "<td style='font-size:18px;font-weight:bold;" +
            "color:var(--success,#059669)'>" +
            money(r.amount) +
          "</td>" +
        "</tr>" +

      "</table>" +

      itemsHtml +
      paymentsHtml +

      "<div style='display:flex;gap:8px;justify-content:flex-end;" +
        "margin-top:18px'>" +

        "<button type='button' class='btn btn-success' data-print>" +
          "??? ????? ???????" +
        "</button>" +

        "<button type='button' class='btn' data-close>" +
          "?????" +
        "</button>" +

      "</div>";
  }

  function enhance() {
    document.querySelectorAll(
      "button[onclick*=\"printCustReceipt\"]"
    ).forEach(function (btn) {

      if (btn.dataset.cloudVoucherFixed === "3") return;

      const row = btn.closest("tr");
      if (!row) return;

      const r = getRowData(btn, row);
      if (!r) return;

      btn.dataset.cloudVoucherFixed = "3";

      /*
       * Remove the old inline popup implementation.
       */
      btn.removeAttribute("onclick");

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        showDetails(r);
      });

      row.style.cursor = "pointer";
      row.title = "??? ?????? ??? ?????";

      row.addEventListener("click", function (e) {
        if (e.target.closest("button")) return;
        showDetails(r);
      });
    });
  }

  /*
   * Keep the legacy global safe for any old code that still calls it.
   */
  window.printCustReceipt = function (
    kind,
    receiptNo,
    customerName,
    phone,
    amount,
    methodNameValue,
    date,
    ledgerId
  ) {
    if (kind !== "credit_payment") return;

    showDetails({
      receipt_no: decodeURIComponent(receiptNo || ""),
      customer_name: decodeURIComponent(customerName || ""),
      phone: decodeURIComponent(phone || ""),
      amount: Number(amount) || 0,
      method: methodNameValue || "????",
      date: decodeURIComponent(date || ""),
      ledger_id: Number(ledgerId) || 0,
      order_id: ""
    });
  };

  enhance();

  new MutationObserver(function () {
    enhance();
  }).observe(document.body, {
    childList: true,
    subtree: true
  });

  setTimeout(enhance, 300);
  setTimeout(enhance, 1000);
  setTimeout(enhance, 2000);
})();
