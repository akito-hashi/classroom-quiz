// 画面の切り替え（URL の # で決める）
//   #               … はじめの画面（参加する／先生）
//   #join=123456    … 生徒の画面
//   #host           … 先生：クイズ一覧
//   #host/edit/ID   … 先生：クイズの編集
//   #live           … 先生：授業の画面
(function () {
  const { h, mount } = UI;

  function renderHome() {
    const input = h("input", { id: "home-code", class: "input code-input", inputmode: "numeric", autocomplete: "off", placeholder: "参加コード（6桁）", maxlength: 12 });
    const go = () => {
      const code = JoinCode.parseJoin(input.value);
      if (!code) { UI.toast("6桁の参加コードを入れてください"); input.focus(); return; }
      location.hash = "#join=" + code;
    };
    mount(
      h("section", { class: "home" },
        h("h1", { class: "home-title" }, "教室クイズ"),
        h("form", { class: "card join-card", onsubmit: (e) => { e.preventDefault(); go(); } },
          h("h2", null, "クイズに参加する"),
          h("p", { class: "muted" }, "先生の画面に出ている参加コードを入れるか、QRコードを読み取ってください。"),
          input,
          h("button", { class: "btn primary big", type: "submit" }, "参加する")),
        h("a", { class: "host-link", href: "#host" }, "先生はこちら（クイズを作る・出題する）")));
  }

  function route() {
    const hash = location.hash;
    if (hash.startsWith("#join")) {
      if (window.Student) return Student.render(JoinCode.parseJoin(hash) || "");
      return renderHome();
    }
    if (hash.startsWith("#live")) {
      if (window.HostLive) return HostLive.render();
      return HostEdit.renderLibrary();
    }
    const m = hash.match(/^#host\/edit\/([\w-]+)/);
    if (m) return HostEdit.renderEditor(m[1]);
    if (hash.startsWith("#host")) return HostEdit.renderLibrary();
    renderHome();
  }

  window.addEventListener("hashchange", route);
  route();
})();
