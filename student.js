// 生徒の画面：参加 → 待機 → 回答 → 正解発表 → 最終結果
(function () {
  const { h, mount, MARKS, LETTERS } = UI;

  // 端末への保存（LINE 内ブラウザやプライベートモードで使えなくても動くように）
  const mem = new Map();
  const sget = (k) => { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } };
  const sset = (k, v) => { try { localStorage.setItem(k, v); } catch { mem.set(k, v); } };

  let ctx = null;

  function stopCtx() {
    if (!ctx) return;
    ctx.unsubs.forEach((u) => u());
    clearInterval(ctx.timer);
    ctx = null;
  }

  function screen(...kids) {
    const s = ctx?.session;
    const key = s ? `${s.status}:${s.qIndex}` : "";
    const y = window.scrollY;
    const root = mount(h("section", { class: "stu" }, ...kids));
    if (ctx && key && ctx.shownKey === key) window.scrollTo(0, y);
    if (ctx) ctx.shownKey = key;
    return root;
  }
  function message(text, sub) {
    screen(h("div", { class: "stu-msg card" }, h("p", { class: "stu-msg-main" }, text), sub ? h("p", { class: "muted" }, sub) : null,
      h("a", { class: "btn", href: "#" }, "はじめの画面へ")));
  }
  function errorText(e) {
    if (e?.code === "resource-exhausted") return "今日の利用上限に達したため、いまは参加できません。";
    if (e?.code === "unavailable" || e?.code === "timeout") return "通信できませんでした。電波やWi-Fiを確かめてください。";
    return e?.message || "うまくいきませんでした。";
  }

  async function render(code) {
    stopCtx();
    if (!code) { location.hash = "#"; return; }
    screen(h("p", { class: "loading" }, "読み込み中…"));
    let store;
    try {
      store = await (await import("./cloud.js")).getStore("student");
    } catch {
      return message("通信できませんでした。", "電波やWi-Fiを確かめて、ページを読み込み直してください。学校の端末では、通信が制限されていることがあります。");
    }
    const stored = sget("quiz-offset");
    // choices: この端末で選んだ答え、lastOk: 届いたと返事があった答え、verified: サーバーに記録されている答え（締め切り後に確かめる）
    const my = { code, store, unsubs: [], session: undefined, me: undefined, pid: null, choices: {}, send: {}, lastOk: {}, verified: {}, seq: 0,
      offset: stored == null || stored === "" ? null : Number(stored), lastStart: null, first: true, timer: null, reentered: false, justJoined: false, shownKey: null };
    ctx = my;

    const saved = sget("quiz-join-" + code);
    if (saved) {
      try {
        const me = await store.getMe(code, saved);
        if (ctx !== my) return;
        // 別の端末で参加し直したあとの元の端末は、参加画面からやり直せるようにする
        if (me && me.status !== "replaced") { my.reentered = true; return enter(saved); }
      } catch { /* 新しく参加し直す */ }
    }
    let session;
    try { session = await store.getSession(code); } catch (e) { return message(errorText(e)); }
    if (ctx !== my) return;
    if (!session) return message("参加コードが見つかりません。", `入力したコード：${code}`);
    if (session.status === "finished") return message("このクイズはもう終わりました。");
    joinForm(session);
  }

  function joinForm(session) {
    const roster = session.settings.mode === "roster";
    const err = h("p", { class: "form-err", role: "alert" });
    const nick = h("input", { id: "nickname", class: "input", maxlength: 12, autocomplete: "nickname", placeholder: "例：たろう", required: true });
    const cls = roster ? h("input", { id: "cls", class: "input", maxlength: 10, placeholder: "例：1組" }) : null;
    const num = roster ? h("input", { id: "num", class: "input", type: "number", inputmode: "numeric", min: 1, max: 99, placeholder: "例：12" }) : null;
    const btn = h("button", { class: "btn primary big", type: "submit", dataset: { act: "join" } }, "参加する");
    async function submit(e) {
      e.preventDefault();
      const nickname = nick.value.trim();
      const c = roster ? cls.value.trim() : "";
      const n = roster ? Number(num.value) : null;
      if (!nickname || nickname.length > 12) return void (err.textContent = "ニックネームを1〜12文字で入れてください");
      if (roster && (!c || c.includes("/"))) return void (err.textContent = "クラスを入れてください");
      if (roster && !(Number.isInteger(n) && n >= 1 && n <= 99)) return void (err.textContent = "出席番号を1〜99で入れてください");
      btn.disabled = true;
      err.textContent = "";
      try {
        const r = await ctx.store.join(ctx.code, roster ? { nickname, cls: c, num: n } : { nickname });
        sset("quiz-join-" + ctx.code, r.pid);
        ctx.justJoined = true;
        enter(r.pid);
      } catch (e2) {
        err.textContent = e2.code === "permission-denied" ? "参加できませんでした。入力を確かめてください。" : errorText(e2);
        btn.disabled = false;
      }
    }
    screen(h("form", { class: "card stu-join", onsubmit: submit },
      h("p", { class: "join-code" }, "参加コード ", h("strong", null, ctx.code)),
      roster ? h("div", { class: "two" },
        h("label", { class: "field" }, h("span", null, "クラス"), cls),
        h("label", { class: "field" }, h("span", null, "出席番号"), num)) : null,
      h("label", { class: "field" }, h("span", null, "ニックネーム"), nick),
      err, btn));
    nick.focus();
  }

  function enter(pid) {
    const my = ctx;
    my.pid = pid;
    const onErr = (e) => { if (ctx === my) message(errorText(e)); };
    my.unsubs.push(my.store.watchMe(my.code, pid, (me) => {
      // 参加した直後に届く自分の参加時刻（サーバーの時計）で、端末の時計とのずれを測る
      if (my.justJoined && me && me.joinedAt) { my.justJoined = false; observe(my, me.joinedAt.toMillis() - Date.now()); }
      my.me = me;
      draw();
    }, onErr));
    my.unsubs.push(my.store.watchSession(my.code, (s) => {
      if (s && s.status === "question" && s.startedAt) {
        const t = s.startedAt.toMillis();
        if (t !== my.lastStart) {
          // 新しい問題が届いた瞬間のずれも測る（読み込み直後に届いた古い問題は使わない）
          if (!my.first) observe(my, t - Date.now());
          my.lastStart = t;
        }
      }
      my.first = false;
      my.session = s;
      draw();
    }, onErr));
  }

  // ずれの測定値は「サーバーの時刻 − 受け取った時刻」なので、届くのが遅れるほど小さくなる。
  // 一番大きい（遅れが一番少ない）値を使う。画面ロックなどで遅れて届いた値に引きずられないように。
  function observe(my, v) {
    my.offset = my.offset == null ? v : Math.max(my.offset, v);
    sset("quiz-offset", String(my.offset));
  }

  const label = (me) => (me.cls ? `${me.cls} ${me.num}番 ${me.nickname}` : me.nickname);

  function draw() {
    const my = ctx;
    if (!my || my.session === undefined) return;
    clearInterval(my.timer);
    const { me, session: s } = my;
    if (s === null) {
      if (my.finalDone) return; // 先生がデータを消しても、表示した最終結果は残す
      return message("このクイズは終わりました。", "おつかれさまでした。");
    }
    if (!me || !s) return;
    if (me.status === "kicked") return message("先生によって退出になりました。");
    if (me.status === "replaced") return message("別の端末で参加し直したため、この画面は使えなくなりました。");
    if (me.status === "pending") return message("先生の許可を待っています。", "同じクラス・出席番号の人がすでに参加しています。先生に知らせてください。");
    if (me.renameRequired) return renameForm(me);
    const head = h("div", { class: "stu-head" }, h("span", { class: "stu-name" }, label(me)), h("span", { class: "muted" }, `コード ${my.code}`));
    if (s.status === "lobby") return screen(head, h("div", { class: "stu-wait card" }, h("p", { class: "big-emoji", "aria-hidden": "true" }, "✋"), h("p", null, h("strong", null, label(me)), " で参加しました"), h("p", { class: "muted" }, "先生が始めるまでお待ちください")));
    if (s.status === "question") return questionView(head, s);
    if (s.status === "closed") return screen(head, h("div", { class: "stu-wait card" }, h("p", { class: "stu-msg-main" }, "締め切りました"), ...recorded(s), h("p", { class: "muted" }, "正解発表を待っています")));
    if (s.status === "revealed") return revealView(head, s);
    if (s.status === "finished") return finalView(head, s);
  }

  function choiceText(s, c) {
    if (c == null) return "";
    return s.current.type === "tf" ? s.current.choices[c] : `${LETTERS[c]} ${s.current.choices[c]}`;
  }
  // 締め切り後に、サーバーに記録された答えを確かめる。届いたと返事があった答えなら読み直さない
  function ensureVerified(q) {
    const my = ctx;
    if (my.verified[q] !== undefined) return;
    if (my.choices[q] !== undefined && my.send[q] === "sent" && my.lastOk[q] === my.choices[q]) { my.verified[q] = my.choices[q]; return; }
    if (my.choices[q] === undefined && !my.reentered) { my.verified[q] = null; return; } // この端末では一度も押していない
    my.verified[q] = "loading";
    my.store.getConfirmedAnswer(my.code, q, my.pid)
      .then((a) => { my.verified[q] = a ? a.choice : null; })
      .catch(() => { my.verified[q] = undefined; setTimeout(() => { if (ctx === my) draw(); }, 3000); })
      .finally(() => { if (ctx === my) draw(); });
  }
  // 記録された答え（確認中は undefined）
  function recordedChoice(q) {
    ensureVerified(q);
    const v = ctx.verified[q];
    return v === "loading" || v === undefined ? undefined : v;
  }
  function recorded(s) {
    const q = s.qIndex;
    const v = recordedChoice(q);
    if (v === undefined) return [h("p", { class: "muted" }, "答えを確認しています…")];
    const picked = ctx.choices[q];
    const lost = picked != null && picked !== v;
    const out = [h("p", null, v == null ? "回答は記録されていません" : ["あなたの答え：", h("strong", null, choiceText(s, v))])];
    if (lost) out.push(h("p", { class: "lost" }, `最後に選んだ「${choiceText(s, picked)}」は届きませんでした`));
    return out;
  }

  // 読み込み直したときだけ、出題中の問題の自分の答えを読み直す（新しく参加した人は読まない）
  async function loadMyChoice(s) {
    const my = ctx;
    if (!my.reentered || my.choices[s.qIndex] !== undefined || my.loading === s.qIndex) return;
    my.loading = s.qIndex;
    try {
      const a = await my.store.getMyAnswer(my.code, s.qIndex, my.pid);
      if (a && my.choices[s.qIndex] === undefined) { my.choices[s.qIndex] = a.choice; my.lastOk[s.qIndex] = a.choice; my.send[s.qIndex] = "sent"; }
      else if (my.choices[s.qIndex] === undefined) my.choices[s.qIndex] = null;
    } catch { /* 読めなくても回答はできる */ }
    if (ctx === my) draw();
  }

  function remaining(s) {
    if (!s.timeLimit || !s.startedAt) return null;
    const end = s.startedAt.toMillis() + s.timeLimit * 1000;
    return Math.max(0, Math.min(s.timeLimit, Math.ceil((end - (Date.now() + (ctx.offset ?? 0))) / 1000)));
  }

  function questionView(head, s) {
    const my = ctx;
    loadMyChoice(s);
    const q = s.qIndex;
    const sel = my.choices[q];
    const left = remaining(s);
    const over = left === 0;
    const cd = left == null ? null : h("span", { class: "countdown" + (left <= 5 ? " low" : "") }, `残り ${left}秒`);
    const tf = s.current.type === "tf";
    const buttons = s.current.choices.map((c, k) => h("button", {
      class: `choice-btn ${tf ? "tf" + k : "c" + k}`, dataset: { c: String(k) }, "aria-pressed": String(sel === k), disabled: over,
      onclick: () => send(s, k),
    }, tf ? h("span", { class: "tf-big" }, c) : [h("span", { class: "mark" }, MARKS[k]), h("span", { class: "choice-label" }, c)]));
    const st = my.send[q];
    const status = h("p", { class: "send-status " + (st || "") },
      over && st !== "sent" ? "時間切れです" :
        st === "sending" ? "送信中…" :
          st === "sent" ? "送信済み（締め切りまで変えられます）" :
            st === "late" ? "締め切りに間に合わず、届きませんでした" :
              st === "fail" ? "届きませんでした。通信を確かめて、もう一度押してください" :
                st === "quota" ? "今日の利用上限に達したため、届きませんでした" : "答えを選んでください");
    screen(head,
      h("div", { class: "stu-q" },
        h("div", { class: "stu-qhead" }, h("strong", null, `Q${q + 1}`, h("span", { class: "muted" }, ` / ${s.qCount}`)), cd),
        h("p", { class: "stu-qtext" }, s.current.text),
        h("div", { class: "choice-grid" + (tf ? " tf" : "") }, buttons),
        status));
    // 残り時間は文字だけを書き換える（ボタンを作り直すとタップを取りこぼし、スクロールも戻ってしまう）
    if (left != null && !over) my.timer = setInterval(() => {
      const l = remaining(s);
      if (l === 0) return draw();
      cd.textContent = `残り ${l}秒`;
      cd.classList.toggle("low", l <= 5);
    }, 250);
  }

  async function send(s, k) {
    const my = ctx;
    const q = s.qIndex;
    my.choices[q] = k;
    my.send[q] = "sending";
    const seq = ++my.seq;
    draw();
    try {
      await my.store.answer(my.code, q, my.pid, k);
      if (seq === my.seq) { my.send[q] = "sent"; my.lastOk[q] = k; }
    } catch (e) {
      if (seq === my.seq) my.send[q] = e.code === "permission-denied" ? "late" : e.code === "resource-exhausted" ? "quota" : "fail";
    }
    if (ctx === my) draw();
  }

  function revealView(head, s) {
    const my = ctx;
    const c = recordedChoice(s.qIndex);
    if (c === undefined) return screen(head, h("div", { class: "stu-result card none" }, h("p", { class: "muted" }, "答えを確認しています…")));
    const ans = s.reveal.answer;
    const ok = c === ans;
    const correctText = s.current.type === "tf" ? s.current.choices[ans] : `${LETTERS[ans]} ${s.current.choices[ans]}`;
    screen(head, h("div", { class: `stu-result card ${c == null ? "none" : ok ? "ok" : "ng"}` },
      h("p", { class: "result-big" }, c == null ? "未回答" : ok ? "正解！" : "不正解"),
      c == null || !ok ? h("p", null, "正解は ", h("strong", null, correctText)) : null,
      c != null && !ok ? h("p", { class: "muted" }, "あなたの答え：", choiceText(s, c)) : null,
      my.choices[s.qIndex] != null && my.choices[s.qIndex] !== c ? h("p", { class: "lost" }, `最後に選んだ「${choiceText(s, my.choices[s.qIndex])}」は届きませんでした`) : null,
      s.reveal.explanation ? h("p", { class: "expl" }, s.reveal.explanation) : null));
  }

  async function finalView(head, s) {
    const my = ctx;
    const box = h("div", { class: "stu-final card" }, h("p", { class: "stu-msg-main" }, "おつかれさまでした"), h("p", { class: "muted" }, "結果を集計中…"));
    screen(head, box);
    if (my.finalDone) return showFinal(box, s, my.finalDone);
    try {
      // 端末を替えて参加し直した場合も、前の端末の回答を合わせて数える
      const pids = [my.pid];
      let firstQ = my.me.firstQ ?? 0;
      let prev = my.me.inheritsFrom;
      while (prev) {
        pids.push(prev);
        const p = await my.store.getMe(my.code, prev);
        if (!p) break;
        firstQ = Math.min(firstQ, p.firstQ ?? 0);
        prev = p.inheritsFrom;
      }
      const keys = s.final?.answers || [];
      let score = 0;
      for (let q = firstQ; q < keys.length; q++) {
        for (const pid of pids) {
          const a = await my.store.getMyAnswer(my.code, q, pid);
          if (a) { if (a.choice === keys[q]) score++; break; }
        }
      }
      my.finalDone = { score, total: Math.max(0, keys.length - firstQ) };
      if (ctx === my) showFinal(box, s, my.finalDone);
    } catch {
      box.lastChild.textContent = "結果を読み込めませんでした";
    }
  }
  function showFinal(box, s, { score, total }) {
    const top = s.final?.top;
    // replaceChildren に null を渡すと「null」という文字が出るので、空のものは除く
    box.replaceChildren(...[
      h("p", { class: "stu-msg-main" }, "おつかれさまでした"),
      h("p", { class: "final-score" }, `${total}問中 ${score}問 正解`),
      top && top.length ? h("ol", { class: "rank-list small" }, top.map((r) => h("li", null, h("span", { class: "rank" }, `${r.rank}位`), r.nickname, h("span", { class: "muted" }, ` ${r.score}問`)))) : null,
    ].filter(Boolean));
  }

  function renameForm(me) {
    const input = h("input", { id: "rename", class: "input", maxlength: 12, placeholder: "新しいニックネーム" });
    const err = h("p", { class: "form-err", role: "alert" });
    screen(h("form", { class: "card stu-join", onsubmit: async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v || v.length > 12) return void (err.textContent = "1〜12文字で入れてください");
      try { await ctx.store.rename(ctx.code, ctx.pid, v); } catch (e2) { err.textContent = errorText(e2); }
    } },
    h("p", { class: "stu-msg-main" }, "先生から名前の変更をお願いされました"),
    h("p", { class: "muted" }, `今の名前：${me.nickname}`),
    h("label", { class: "field" }, h("span", null, "新しいニックネーム"), input),
    err,
    h("button", { class: "btn primary big", type: "submit", dataset: { act: "rename" } }, "変更する")));
  }

  window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#join")) stopCtx(); });
  window.Student = { render };
})();
