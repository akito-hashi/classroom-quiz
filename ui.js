// 画面づくりの小さな道具
(function () {
  // h("button", {class: "btn", onclick}, "押す") のように要素を作る
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k in el && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  function mount(...kids) {
    const root = document.getElementById("app");
    root.replaceChildren(...kids);
    window.scrollTo(0, 0);
    return root;
  }

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h("a", { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
  }

  // ファイル名に使えない文字を除く
  const safeName = (s) => (String(s || "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "quiz");

  // 4択の記号と色（色だけに頼らず形でも区別する）
  const MARKS = ["▲", "◆", "●", "■"];
  const LETTERS = ["A", "B", "C", "D"];

  window.UI = { h, mount, download, toast, safeName, MARKS, LETTERS };
})();
