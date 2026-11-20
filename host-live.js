// 先生：授業の画面（待機 → 出題 → 締め切り → 正解発表 → … → 最終結果 → CSV → 削除）
// 正解はこの端末だけが持ち、発表のときにセッションへ書き込む。
(function () {
  const { h, mount, download, toast, safeName, MARKS, LETTERS } = UI;
  const KEY = "quiz-host";
  let ctx = null;

  // 授業中の状態。端末に保存できないブラウザではメモリだけで持つ（再読み込みすると戻れない）
  let memState = null;
  let storable = true;
  const loadState = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { storable = false; return memState; } };
  const saveState = (v) => {
    memState = v;
    try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); localStorage.setItem("quiz-host-used", "1"); }
    catch { storable = false; }
  };
  const storeP = () => import("./cloud.js").then((m) => m.getStore("host"));

  // 「授業で使う」：セッションを作って授業の画面へ
  async function start(quizId) {
    const quiz = Library.get(quizId);
    if (!quiz) return;
    const cur = loadState();
    if (cur && confirm(`授業中のクイズ「${cur.quiz.title || "題名なし"}」（コード ${cur.code}）があります。前の授業に戻りますか？\n\n「キャンセル」を押すと、前の授業を終えずに新しく始めます。`)) {
      location.hash = "#live";
      return;
    }
    try {
      const store = await storeP();
      const code = await store.createSession(quiz.settings, quiz.questions.length);
      saveState({ code, quiz });
      if (!storable) toast("この端末には保存できないため、ページを読み込み直すと授業に戻れません");
      if (location.hash === "#live") render(); else location.hash = "#live";
    } catch (e) {
      alert(e.code === "resource-exhausted" ? "今日の利用上限に達しました。明日もう一度お試しください。" : "授業を始められませんでした。通信を確かめてください。");
    }
  }

  function stopCtx() {
    if (!ctx) return;
    ctx.unsubs.forEach((u) => u());
    ctx.ansUnsub?.();
    clearInterval(ctx.timer);
    ctx = null;
  }

  async function render() {
    stopCtx();
    const st = loadState();
    if (!st) { location.hash = "#host"; return; }
    mount(h("p", { class: "loading" }, "授業の画面を準備中…"));
    let store;
    try { store = await storeP(); } catch { return mount(h("section", { class: "page" }, h("p", null, "通信できませんでした。"), h("button", { class: "btn", onclick: render }, "もう一度"))); }
    const my = { store, code: st.code, quiz: st.quiz, session: undefined, people: [], byQ: {}, ansQ: null, ansUnsub: null, unsubs: [], timer: null, offset: 0, closing: false, loadedAll: false, images: {} };
    ctx = my;
    store.cleanupOld(24).catch(() => {});
    const imgIds = my.quiz.questions.map((q) => q.imageId).filter(Boolean);
    Library.getImages(imgIds).then((m) => { my.images = m; if (ctx === my) draw(); });

    my.unsubs.push(store.watchSession(my.code, (s) => {
      if (s && s.startedAt && s.startedAt.toMillis() !== my.lastStart) {
        my.lastStart = s.startedAt.toMillis();
        if (my.session !== undefined) my.offset = my.lastStart - Date.now();
      }
      my.session = s;
      if (s && s.status !== "lobby" && !my.loadedAll) loadAll(my);
      watchCurrentAnswers(my);
      draw();
    }, (e) => fail(my, e)));
    my.unsubs.push(store.watchParticipants(my.code, (ps) => { my.people = ps; draw(); }, (e) => fail(my, e)));
  }

  function fail(my, e) {
    if (ctx !== my) return;
    toast(e.code === "resource-exhausted" ? "今日の利用上限に達しました" : "通信が不安定です");
  }

  // 再読み込みしたときは、それまでの回答をまとめて読み直す
  async function loadAll(my) {
    my.loadedAll = true;
    try {
      const all = await my.store.getAllAnswers(my.code);
      for (const a of all) {
        const list = (my.byQ[a.q] ||= []);
        if (!list.some((x) => x.pid === a.pid)) list.push(a);
      }
      draw();
    } catch { my.loadedAll = false; }
  }

  function watchCurrentAnswers(my) {
    const s = my.session;
    if (!s || s.qIndex < 0 || my.ansQ === s.qIndex) return;
    my.ansUnsub?.();
    my.ansQ = s.qIndex;
    const q = s.qIndex;
    my.ansUnsub = my.store.watchAnswers(my.code, q, (list) => { my.byQ[q] = list; if (ctx === my) draw(); });
  }

  // 1人＝引き継ぎでまとめた pid の束。今の問題の回答は、束の中の新しい端末を優先する
  function chains(my) { return Results.mergeChain(my.people.map((p) => ({ ...p, firstQ: p.firstQ ?? 0 }))); }
  function activeChains(my) { return chains(my).filter((c) => c.head.status === "active"); }
  function answersFor(my, q) {
    const list = my.byQ[q] || [];
    const out = [];
    for (const c of activeChains(my)) {
      let pick = null;
      for (const pid of c.pids) { const a = list.find((x) => x.pid === pid); if (a) pick = a; }
      if (pick) out.push({ pid: c.head.pid, choice: pick.choice });
    }
    return out;
  }
  function allAnswers(my) { return Object.values(my.byQ).flat(); }

  function remaining(s) {
    if (!s.timeLimit || !s.startedAt) return null;
    const end = s.startedAt.toMillis() + s.timeLimit * 1000;
    return Math.max(0, Math.min(s.timeLimit, Math.ceil((end - (Date.now() + ctx.offset)) / 1000)));
  }

  // ---------- 操作 ----------
  async function act(fn) {
    try { await fn(); } catch (e) { toast(e.code === "resource-exhausted" ? "今日の利用上限に達しました" : "うまくいきませんでした。もう一度押してください"); }
  }
  function nextQuestion() {
    const my = ctx;
    const s = my.session;
    const next = s.qIndex + 1;
    if (next >= my.quiz.questions.length) return finish();
    my.closing = false;
    return act(() => my.store.showQuestion(my.code, next, QuizData.publicQuestion(my.quiz.questions[next]), my.quiz.settings.timeLimit));
  }
  function closeQ() {
    const my = ctx;
    if (my.closing) return;
    my.closing = true;
    return act(() => my.store.closeQuestion(my.code)).finally(() => { my.closing = false; });
  }
  function rankingTop(my, asked) {
    if (!my.quiz.settings.ranking) return null;
    const rows = Results.studentResults(my.quiz, my.people, allAnswers(my), asked)
      .filter((r) => !r.kicked && r.score > 0) // 0問の生徒は順位に出さない
      .map((r) => ({ nickname: r.participant.nickname, score: r.score }));
    return Tally.ranking(rows, 5);
  }
  function reveal() {
    const my = ctx;
    const s = my.session;
    const q = my.quiz.questions[s.qIndex];
    const t = Tally.tally(q.type, q.answer, answersFor(my, s.qIndex), activeChains(my).length);
    return act(() => my.store.reveal(my.code, { answer: q.answer, ...t, explanation: q.explanation || "", top: rankingTop(my, s.qIndex + 1) }));
  }
  function asked(my) {
    const s = my.session;
    if (!s || s.qIndex < 0) return 0;
    return s.status === "question" ? s.qIndex : s.qIndex + 1; // 出題中に終えた問題は数えない
  }
  function finish() {
    const my = ctx;
    if (my.session.status === "question" && !confirm("出題中の問題を数えずに終了します。よろしいですか？")) return;
    const n = asked(my);
    return act(() => my.store.finish(my.code, { asked: n, answers: my.quiz.questions.slice(0, n).map((q) => q.answer), top: rankingTop(my, n) }));
  }
  function saveCsv() {
    const my = ctx;
    const n = my.session?.final?.asked ?? asked(my);
    const csv = Results.buildCsv({ quiz: my.quiz, participants: my.people, answers: allAnswers(my), asked: n });
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    download(`${safeName(my.quiz.title)}_${stamp}.csv`, csv, "text/csv");
    my.csvSaved = true;
    draw();
  }
  async function deleteAll() {
    const my = ctx;
    if (!my.csvSaved && !confirm("CSVをまだ保存していません。保存せずにクラウドのデータを削除しますか？（元に戻せません）")) return;
    if (my.csvSaved && !confirm("クラウドから、この授業のデータ（参加者と回答）を削除します。元に戻せません。よろしいですか？")) return;
    try {
      stopCtx();
      await my.store.deleteSession(my.code);
      saveState(null);
      toast("クラウドのデータを削除しました");
      location.hash = "#host";
    } catch {
      toast("削除できませんでした。もう一度お試しください");
      render();
    }
  }

  // ---------- 描画 ----------
  function draw() {
    const my = ctx;
    if (!my || my.session === undefined) return;
    clearInterval(my.timer);
    const s = my.session;
    if (s === null) { saveState(null); location.hash = "#host"; return; }
    const main =
      s.status === "lobby" ? lobby(my, s) :
        s.status === "question" ? questionView(my, s) :
          s.status === "closed" ? closedView(my, s) :
            s.status === "revealed" ? revealView(my, s) : finalView(my, s);
    const keepScroll = window.scrollY;
    const stage = `${s.status}:${s.qIndex}`;
    if (stage !== my.stage) { my.stage = stage; my.stageAt = Date.now(); }
    mount(topBar(my, s), h("section", { class: "live" }, main, peoplePanel(my, s)));
    window.scrollTo(0, keepScroll);
    const wait = 800 - (Date.now() - my.stageAt);
    if (wait > 0) {
      document.querySelectorAll(".stage-btn").forEach((b) => { b.disabled = true; });
      setTimeout(() => { if (ctx === my) document.querySelectorAll(".stage-btn").forEach((b) => { b.disabled = false; }); }, wait);
    }
  }

  function topBar(my, s) {
    const pending = my.people.filter((p) => p.status === "pending").length;
    return h("header", { class: "bar live-bar" },
      h("strong", { class: "brand" }, my.quiz.title || "クイズ"),
      h("span", { class: "bar-sub" }, `コード ${my.code}`),
      h("span", { class: "grow" }),
      pending ? h("a", { class: "pending-badge", href: "#people", onclick: (e) => { e.preventDefault(); document.getElementById("people")?.setAttribute("open", ""); document.getElementById("people")?.scrollIntoView(); } }, `許可待ち ${pending}人`) : null,
      s.status !== "finished" ? h("button", { class: "btn ghost light small", dataset: { act: "finish" }, onclick: finish }, "終了") : null);
  }

  function joinUrl(code) {
    return location.origin + location.pathname + "#join=" + code;
  }
  function qrSvg(text) {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const box = h("div", { class: "live-qr" });
    box.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    return box;
  }

  function lobby(my, s) {
    const n = activeChains(my).length;
    return h("div", { class: "live-lobby" },
      h("div", { class: "lobby-join card" },
        qrSvg(joinUrl(my.code)),
        h("div", { class: "lobby-text" },
          h("p", { class: "muted" }, "スマホのカメラでQRコードを読み取るか、"),
          h("p", { class: "muted" }, h("strong", null, location.host + location.pathname.replace(/\/$/, "")), " を開いて"),
          h("p", { class: "muted" }, "参加コードを入れてください"),
          h("p", { class: "live-code" }, my.code.slice(0, 3), h("span", { class: "sp" }), my.code.slice(3)))),
      h("div", { class: "lobby-side" },
        h("p", { class: "lobby-count" }, h("strong", null, String(n)), " 人が参加中"),
        h("ul", { class: "lobby-names" }, activeChains(my).map((c) => h("li", null, c.head.nickname))),
        h("button", { class: "btn primary big stage-btn", dataset: { act: "next" }, onclick: nextQuestion }, `1問目を出す（全${my.quiz.questions.length}問）`)));
  }

  function qBlock(my, s, { showAnswer = false, counts = null } = {}) {
    const q = my.quiz.questions[s.qIndex];
    const tf = q.type === "tf";
    const total = counts ? Math.max(1, ...counts) : 1;
    const img = q.imageId && my.images[q.imageId] ? h("img", { class: "live-img", src: my.images[q.imageId], alt: "" }) : null;
    return h("div", { class: "live-q" },
      h("p", { class: "live-qtext" }, q.text),
      img,
      h("div", { class: "live-choices" + (tf ? " tf" : "") }, q.choices.map((c, k) => {
        const isAns = showAnswer && k === q.answer;
        return h("div", { class: `live-choice ${tf ? "tf" + k : "c" + k}${showAnswer ? (isAns ? " correct" : " dim") : ""}` },
          tf ? h("span", { class: "tf-big" }, c) : [h("span", { class: "mark" }, MARKS[k]), h("span", { class: "choice-label" }, c)],
          counts ? h("span", { class: "bar-wrap" }, h("span", { class: "dist-bar", dataset: { count: String(counts[k]) }, style: `width:${(counts[k] / total) * 100}%` }), h("span", { class: "bar-n" }, `${counts[k]}人`)) : null,
          isAns ? h("span", { class: "ok-badge" }, "正解") : null);
      })));
  }

  function qHead(my, s, extra) {
    return h("div", { class: "live-qhead" }, h("strong", null, `Q${s.qIndex + 1}`, h("span", { class: "muted" }, ` / ${my.quiz.questions.length}`)), h("span", { class: "tag" }, my.quiz.questions[s.qIndex].type === "tf" ? "〇×" : "4択"), h("span", { class: "grow" }), extra);
  }

  function questionView(my, s) {
    const ans = answersFor(my, s.qIndex);
    const actives = activeChains(my);
    const done = Tally.allAnswered(ans, actives.map((c) => c.head.pid));
    const left = remaining(s);
    const cd = left == null ? null : h("span", { class: "countdown big" + (left <= 5 ? " low" : "") }, `${left}秒`);
    if (left != null) {
      const deadline = s.startedAt.toMillis() + s.timeLimit * 1000 + 1500; // 生徒側の猶予の内側で締め切る
      my.timer = setInterval(() => {
        if (Date.now() + my.offset >= deadline) { clearInterval(my.timer); closeQ(); return; }
        if (remaining(s) !== left) draw();
      }, 250);
    }
    return h("div", null,
      qHead(my, s, cd),
      qBlock(my, s),
      h("div", { class: "live-foot" },
        h("p", { class: "answer-count" }, "回答 ", h("strong", null, `${ans.length} / ${actives.length}`)),
        done ? h("p", { class: "all-answered" }, "全員回答しました") : null,
        h("span", { class: "grow" }),
        h("button", { class: "btn primary big stage-btn", dataset: { act: "close" }, onclick: closeQ }, "締め切る")));
  }

  function closedView(my, s) {
    const ans = answersFor(my, s.qIndex);
    return h("div", null,
      qHead(my, s, h("span", { class: "tag warn" }, "締め切り")),
      qBlock(my, s),
      h("div", { class: "live-foot" },
        h("p", { class: "answer-count" }, "回答 ", h("strong", null, `${ans.length} / ${activeChains(my).length}`)),
        h("span", { class: "grow" }),
        h("button", { class: "btn primary big stage-btn", dataset: { act: "reveal" }, onclick: reveal }, "正解発表")));
  }

  function revealView(my, s) {
    const r = s.reveal;
    const last = s.qIndex + 1 >= my.quiz.questions.length;
    return h("div", null,
      qHead(my, s, null),
      qBlock(my, s, { showAnswer: true, counts: r.counts }),
      h("div", { class: "live-stats" },
        h("div", { class: "stat" }, h("span", null, "正解率"), h("strong", { class: "rate" }, r.rate == null ? "—" : `${Math.round(r.rate * 100)}%`)),
        h("div", { class: "stat" }, h("span", null, "正解"), h("strong", null, `${r.correct} / ${r.answered}人`)),
        h("div", { class: "stat" }, h("span", null, "未回答"), h("strong", { class: "unanswered" }, `${r.unanswered}人`))),
      r.explanation ? h("div", { class: "live-expl card" }, h("strong", null, "解説"), h("p", null, r.explanation)) : null,
      rankBlock(r.top),
      h("div", { class: "live-foot" }, h("span", { class: "grow" }),
        h("button", { class: "btn primary big stage-btn", dataset: { act: "next" }, onclick: nextQuestion }, last ? "最終結果へ" : "次の問題へ")));
  }

  function rankBlock(top) {
    if (!top || !top.length) return null;
    return h("div", { class: "card live-rank" }, h("strong", null, "ランキング"),
      h("ol", { class: "rank-list" }, top.map((t) => h("li", null, h("span", { class: "rank" }, `${t.rank}位`), t.nickname, h("span", { class: "muted" }, `　${t.score}問`)))));
  }

  function finalView(my, s) {
    const n = s.final?.asked ?? asked(my);
    const rows = my.quiz.questions.slice(0, n).map((q, i) => {
      const t = Tally.tally(q.type, q.answer, answersFor(my, i), activeChains(my).length);
      return h("li", null, h("span", { class: "fq" }, `Q${i + 1}`), h("span", { class: "ft" }, q.text), h("strong", null, t.rate == null ? "—" : `${Math.round(t.rate * 100)}%`));
    });
    return h("div", { class: "live-final" },
      h("h2", null, "おつかれさまでした"),
      h("p", { class: "muted" }, `${activeChains(my).length}人が参加・${n}問を出題`),
      h("ol", { class: "final-list card" }, rows),
      rankBlock(s.final?.top),
      h("div", { class: "card final-actions" },
        h("p", null, "結果をCSVで保存してから、クラウドのデータを削除してください。"),
        h("div", { class: "row gap wrap" },
          h("button", { class: "btn primary big", dataset: { act: "csv" }, onclick: saveCsv }, my.csvSaved ? "CSVをもう一度保存" : "CSVを保存"),
          h("button", { class: "btn danger big", dataset: { act: "delete" }, onclick: deleteAll }, "クラウドから削除して終わる"))));
  }

  function peoplePanel(my, s) {
    const ps = my.people.filter((p) => p.status !== "replaced");
    const pending = ps.filter((p) => p.status === "pending");
    const label = (p) => (p.cls ? `${p.cls} ${p.num}番 ${p.nickname}` : p.nickname);
    const item = (p) => h("li", { class: `person ${p.status}`, dataset: { name: p.nickname, pid: p.pid } },
      h("span", { class: "pname" }, label(p)),
      p.status === "kicked" ? h("span", { class: "tag" }, "退出") : null,
      p.renameRequired ? h("span", { class: "tag warn" }, "名前の変更待ち") : null,
      h("span", { class: "grow" }),
      p.status === "pending" ? h("button", { class: "btn small primary", dataset: { act: "approve" }, onclick: () => act(() => my.store.approveRejoin(my.code, p.pid)) }, "再参加を許可") : null,
      p.status === "active" ? h("button", { class: "btn small", dataset: { act: "rename-req" }, onclick: () => act(() => my.store.requireRename(my.code, p.pid)) }, "名前を変えてもらう") : null,
      p.status === "active" ? h("button", { class: "btn small danger ghost", dataset: { act: "kick" }, onclick: () => { if (confirm(`「${label(p)}」を退出させます。よろしいですか？（回答は記録に残ります）`)) act(() => my.store.kick(my.code, p.pid)); } }, "退出") : null);
    const open = !!pending.length || document.getElementById("people")?.open;
    return h("details", { id: "people", class: "people card", open },
      h("summary", null, h("span", { class: "people-count" }, `参加者 ${activeChains(my).length}人`), pending.length ? h("span", { class: "tag warn" }, `許可待ち ${pending.length}人`) : null),
      pending.length ? h("p", { class: "hint" }, "同じクラス・出席番号で参加し直そうとしている人です。本人か確かめてから許可してください。許可すると、前の端末の回答を引き継ぎます。") : null,
      h("ul", { class: "people-list" }, [...pending, ...ps.filter((p) => p.status !== "pending")].map(item)));
  }

  window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#live")) stopCtx(); });
  function cleanupInBackground() {
    let used = false;
    try { used = !!localStorage.getItem("quiz-host-used"); } catch { /* 保存できない端末では掃除しない */ }
    if (used) storeP().then((s) => s.cleanupOld(24)).catch(() => {});
  }

  window.HostLive = { start, render, current: loadState, cleanupInBackground };
})();
