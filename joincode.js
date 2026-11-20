// 参加コード（6桁の数字）の作成と読み取り。ブラウザでは window.JoinCode、Node では require で使う。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.JoinCode = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function genCode() {
    return String(100000 + Math.floor(Math.random() * 900000));
  }

  // "123456"・全角数字・空白入り・"…#join=123456" の URL を受け付ける
  function parseJoin(input) {
    let s = String(input || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    const m = s.match(/#join=(\d{6})\b/);
    if (m) return m[1];
    s = s.replace(/\s+/g, "");
    return /^\d{6}$/.test(s) ? s : null;
  }

  return { genCode, parseJoin };
});
