/* LOGO_FREE_PRINT
 * Remove the legacy /logo.png element from every generated print document.
 * This is intentionally limited to exact logo.png image tags and does not
 * change accounting, payment, order, or report data.
 */
(function () {
  "use strict";

  const LOGO_IMG_RE = /<img\b[^>]*\bsrc\s*=\s*["']\/logo\.png(?:\?[^"']*)?["'][^>]*>\s*/gi;
  const originalWrite = Document.prototype.write;

  Document.prototype.write = function () {
    const cleaned = Array.prototype.map.call(arguments, function (value) {
      return typeof value === "string" ? value.replace(LOGO_IMG_RE, "") : value;
    });
    return originalWrite.apply(this, cleaned);
  };
})();
