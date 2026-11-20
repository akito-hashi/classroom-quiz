// 先生：クイズ一覧と問題の作成・編集
(function () {
  const { h, mount, download, toast, safeName, MARKS, LETTERS } = UI;
  const TIMES = [[0, "なし（先生が締め切る）"], [10, "10秒"], [20, "20秒"], [30, "30秒"], [45, "45秒"], [60, "60秒"], [90, "90秒"], [120, "120秒"]];

  // ---------- 一覧 ----------
  function renderLibrary() {
    const fileIn = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: (e) => importFile(e.target.files[0]) });
    const quizzes = Library.list();
    const live = window.HostLive && HostLive.current();
    if (window.HostLive) HostLive.cleanupInBackground();
    mount(
      h("header", { class: "bar" },
        h("a", { class: "brand", href: "#" }, "教室クイズ"),
        h("span", { class: "bar-sub" }, "先生")),
      h("section", { class: "page" },
        h("div", { class: "page-head" },
          h("h1", null, "クイズ一覧"),
          h("div", { class: "row gap wrap" },
            h("button", { class: "btn primary", dataset: { act: "new-quiz" }, onclick: () => {
              const q = QuizData.newQuiz();
              Library.save(q);
              location.hash = "#host/edit/" + q.id;
            } }, "＋ 新しいクイズ"),
            h("button", { class: "btn", dataset: { act: "import" }, onclick: () => fileIn.click() }, "ファイルから読み込む"),
            h("button", { class: "btn", dataset: { act: "share-app" }, onclick: shareApp }, "アプリを共有"),
            fileIn)),
        live ? h("div", { class: "resume-banner", role: "status" },
          h("p", null, "授業中のクイズがあります：", h("strong", null, live.quiz.title || "題名なし"), `（コード ${live.code}）`),
          h("button", { class: "btn primary", dataset: { act: "resume" }, onclick: () => { location.hash = "#live"; } }, "授業に戻る")) : null,
        quizzes.length
          ? h("ul", { class: "quiz-list" }, quizzes.map(quizItem))
          : h("p", { class: "empty" }, "まだクイズがありません。「新しいクイズ」から作りましょう。")));
  }

  // アプリの URL を共有する（スマホ・タブレットは共有メニュー、ないブラウザはコピー）
  async function shareApp() {
    const url = location.origin + location.pathname;
    if (navigator.share) {
      try { await navigator.share({ title: document.title, text: "授業で使える参加型のクイズアプリです", url }); }
      catch (e) { if (e.name !== "AbortError") copyUrl(url); }
      return;
    }
    copyUrl(url);
  }
  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast("アプリのURLをコピーしました");
    } catch {
      prompt("このURLをコピーして送ってください", url);
    }
  }

  function quizItem(quiz) {
    const errs = QuizData.validateQuiz(quiz);
    const n4 = quiz.questions.filter((q) => q.type === "four").length;
    return h("li", { class: "quiz-item" },
      h("div", { class: "quiz-meta" },
        h("strong", { class: "quiz-name" }, quiz.title || "（題名なし）"),
        h("span", { class: "muted" }, `${quiz.questions.length}問（4択${n4}・〇×${quiz.questions.length - n4}）`,
          quiz.settings.mode === "roster" ? "・出席番号あり" : "")),
      h("div", { class: "row gap wrap" },
        h("button", { class: "btn primary", dataset: { act: "start" }, disabled: errs.length > 0, title: errs[0] || "", onclick: () => startQuiz(quiz) }, "授業で使う"),
        h("button", { class: "btn", dataset: { act: "edit" }, onclick: () => { location.hash = "#host/edit/" + quiz.id; } }, "編集"),
        h("button", { class: "btn", dataset: { act: "export" }, onclick: () => exportQuiz(quiz) }, "書き出す"),
        h("button", { class: "btn danger ghost", dataset: { act: "delete" }, onclick: () => deleteQuiz(quiz) }, "削除")));
  }

  function startQuiz(quiz) {
    if (window.HostLive) HostLive.start(quiz.id);
    else toast("授業の画面はまだ準備中です");
  }

  async function exportQuiz(quiz) {
    const ids = quiz.questions.map((q) => q.imageId).filter(Boolean);
    const images = await Library.getImages(ids);
    download(safeName(quiz.title) + ".json", QuizData.exportQuiz(quiz, images), "application/json");
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const { quiz, images } = QuizData.importQuiz(await file.text());
      for (const [id, url] of Object.entries(images)) await Library.putImage(id, url);
      Library.save(quiz);
      toast(`「${quiz.title || "題名なし"}」を読み込みました`);
    } catch (e) {
      alert(e.message || "読み込めませんでした");
    }
    renderLibrary();
  }

  async function deleteQuiz(quiz) {
    if (!confirm(`「${quiz.title || "題名なし"}」を削除します。元に戻せません。よろしいですか？`)) return;
    for (const q of quiz.questions) if (q.imageId) await Library.deleteImage(q.imageId);
    Library.remove(quiz.id);
    renderLibrary();
  }

  // ---------- 編集 ----------
  function renderEditor(id) {
    const quiz = Library.get(id);
    if (!quiz) { location.hash = "#host"; return; }
    const save = () => { Library.save(quiz); refreshErrors(); };
    const errBox = h("div", { class: "edit-errors" });
    const startBtn = h("button", { class: "btn primary", dataset: { act: "start" }, onclick: () => startQuiz(quiz) }, "授業で使う");
    function refreshErrors() {
      const errs = QuizData.validateQuiz(quiz);
      errBox.replaceChildren(...errs.map((e) => h("p", null, e)));
      startBtn.disabled = errs.length > 0;
    }
    const list = h("div", { class: "q-list" });
    function renderList() {
      list.replaceChildren(...quiz.questions.map((q, i) => card(quiz, i, save, renderList)));
      refreshErrors();
    }
    const s = quiz.settings;
    mount(
      h("header", { class: "bar" },
        h("button", { class: "btn ghost light", dataset: { act: "back" }, onclick: () => { location.hash = "#host"; } }, "← 一覧"),
        h("span", { class: "bar-sub" }, "クイズの編集")),
      h("section", { class: "page" },
        h("label", { class: "field" }, h("span", null, "題名"),
          h("input", { id: "quiz-title", class: "input big", value: quiz.title, placeholder: "例：日本の地理 第3回", maxlength: 60, oninput: (e) => { quiz.title = e.target.value; save(); } })),
        h("fieldset", { class: "settings" },
          h("legend", null, "設定"),
          h("div", { class: "set-row" },
            h("span", { class: "set-label" }, "参加のしかた"),
            h("label", { class: "chip" }, h("input", { type: "radio", name: "mode", id: "set-mode-nick", checked: s.mode !== "roster", onchange: () => { s.mode = "nick"; save(); } }), "ニックネームのみ"),
            h("label", { class: "chip" }, h("input", { type: "radio", name: "mode", id: "set-mode-roster", checked: s.mode === "roster", onchange: () => { s.mode = "roster"; save(); } }), "クラス・出席番号も（成績用）")),
          h("div", { class: "set-row" },
            h("label", { class: "set-label", for: "set-time" }, "制限時間"),
            h("select", { id: "set-time", class: "input", onchange: (e) => { s.timeLimit = Number(e.target.value); save(); } },
              TIMES.map(([v, t]) => h("option", { value: v, selected: v === s.timeLimit }, t)))),
          h("div", { class: "set-row" },
            h("span", { class: "set-label" }, "ランキング"),
            h("label", { class: "chip" }, h("input", { type: "checkbox", id: "set-ranking", checked: !!s.ranking, onchange: (e) => { s.ranking = e.target.checked; save(); } }), "正解発表で上位を表示する"))),
        list,
        h("div", { class: "row gap wrap add-row" },
          h("button", { class: "btn", dataset: { act: "add-four" }, onclick: () => { quiz.questions.push(QuizData.newQuestion("four")); save(); renderList(); focusLast(); } }, "＋ 4択の問題"),
          h("button", { class: "btn", dataset: { act: "add-tf" }, onclick: () => { quiz.questions.push(QuizData.newQuestion("tf")); save(); renderList(); focusLast(); } }, "＋ 〇×の問題")),
        errBox,
        h("div", { class: "row end" }, startBtn)));
    renderList();
  }

  function focusLast() {
    const all = document.querySelectorAll(".q-card .q-text");
    all[all.length - 1]?.focus();
  }

  function card(quiz, i, save, rerender) {
    const q = quiz.questions[i];
    const set = (patch) => { Object.assign(q, patch); Object.assign(q, QuizData.normalizeQuestion(q)); save(); };
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= quiz.questions.length) return;
      [quiz.questions[i], quiz.questions[j]] = [quiz.questions[j], quiz.questions[i]];
      save(); rerender();
    };
    const fileIn = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const url = await Library.shrinkImage(f);
        if (q.imageId) await Library.deleteImage(q.imageId);
        const id = QuizData.uid();
        await Library.putImage(id, url);
        set({ imageId: id });
        rerender();
      } catch { toast("画像を読み込めませんでした"); }
    } });
    const img = h("img", { class: "q-img", alt: "問題の画像" });
    if (q.imageId) Library.getImage(q.imageId).then((u) => { if (u) img.src = u; });

    const choices = q.type === "four"
      ? h("div", { class: "choices-edit" }, q.choices.map((c, k) =>
        h("label", { class: `choice-edit c${k}` },
          h("input", { type: "radio", class: "q-answer", name: "ans-" + q.id, value: String(k), checked: q.answer === k, onchange: () => set({ answer: k }), "aria-label": `${LETTERS[k]}を正解にする` }),
          h("span", { class: "mark" }, MARKS[k]),
          h("input", { class: "input q-choice", dataset: { i: String(k) }, value: c, placeholder: `選択肢 ${LETTERS[k]}`, maxlength: 80, oninput: (e) => { q.choices[k] = e.target.value; save(); } }))))
      : h("div", { class: "choices-edit tf" }, ["〇", "×"].map((c, k) =>
        h("label", { class: `choice-edit tf${k}` },
          h("input", { type: "radio", class: "q-answer", name: "ans-" + q.id, value: String(k), checked: q.answer === k, onchange: () => set({ answer: k }) }),
          h("span", { class: "tf-mark" }, c))));

    return h("section", { class: "q-card" },
      h("div", { class: "q-head" },
        h("strong", null, `${i + 1}問目`),
        h("select", { class: "input q-type", "aria-label": "問題の形式", onchange: (e) => { set({ type: e.target.value }); rerender(); } },
          h("option", { value: "four", selected: q.type === "four" }, "4択"),
          h("option", { value: "tf", selected: q.type === "tf" }, "〇×")),
        h("span", { class: "grow" }),
        h("button", { class: "btn icon", title: "上へ", disabled: i === 0, onclick: () => move(-1) }, "↑"),
        h("button", { class: "btn icon", title: "下へ", disabled: i === quiz.questions.length - 1, onclick: () => move(1) }, "↓"),
        h("button", { class: "btn icon danger ghost", title: "この問題を削除", onclick: async () => {
          if (!confirm(`${i + 1}問目を削除します。よろしいですか？`)) return;
          if (q.imageId) await Library.deleteImage(q.imageId);
          quiz.questions.splice(i, 1); save(); rerender();
        } }, "✕")),
      h("textarea", { class: "input q-text", rows: 2, placeholder: "問題文", maxlength: 300, oninput: (e) => { q.text = e.target.value; save(); } }, q.text),
      h("div", { class: "q-image" },
        q.imageId ? img : null,
        h("button", { class: "btn small", dataset: { act: "add-image" }, onclick: () => fileIn.click() }, q.imageId ? "画像を変える" : "画像を付ける（先生画面にだけ表示）"),
        q.imageId ? h("button", { class: "btn small ghost", onclick: async () => { await Library.deleteImage(q.imageId); set({ imageId: null }); rerender(); } }, "画像を外す") : null,
        fileIn),
      h("p", { class: "hint" }, "正解の選択肢の丸を選んでください"),
      choices,
      h("textarea", { class: "input q-expl", rows: 2, placeholder: "解説（正解発表のときに表示）", maxlength: 500, oninput: (e) => { q.explanation = e.target.value; save(); } }, q.explanation));
  }

  window.HostEdit = { renderLibrary, renderEditor };
})();
