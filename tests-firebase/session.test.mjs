// 本物の Firebase に対するテスト（npm run test:firebase）
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { host, student, closeAll, waitFor, rejectsWithCode, sleep, fb } from "./helpers.mjs";

after(closeAll);
const F = fb.firestore;
const four = { type: "four", text: "日本で一番長い川は？", choices: ["利根川", "信濃川", "石狩川", "北上川"], hasImage: false };
const tf = { type: "tf", text: "富士山は日本一高い", choices: ["〇", "×"], hasImage: false };
const nick = { mode: "nick", timeLimit: 0, ranking: false };

async function withSession(settings, fn) {
  const h = await host();
  const code = await h.createSession(settings, 3);
  try { await fn(h, code); } finally { await h.deleteSession(code).catch(() => {}); }
}

test("セッションを作ると6桁のコードができ、生徒が参加して先生の一覧に出る", async () => {
  await withSession(nick, async (h, code) => {
    assert.match(code, /^[1-9]\d{5}$/);
    const s = await student();
    const me = await s.join(code, { nickname: "たろう" });
    assert.equal(me.status, "active");
    const ps = await waitFor((cb) => h.watchParticipants(code, cb), (ps) => ps.length === 1);
    assert.equal(ps[0].nickname, "たろう");
    assert.equal(ps[0].firstQ, 0);
    const again = await s.join(code, { nickname: "たろう" }, me.pid);
    assert.equal(again.pid, me.pid, "同じ pid で参加し直すと同じ参加者に戻る");
  });
});

test("出題中は答えを変えられ、先生の集計には最後の答えが届く", async () => {
  await withSession(nick, async (h, code) => {
    const s = await student();
    const me = await s.join(code, { nickname: "はなこ" });
    await h.showQuestion(code, 0, four, 0);
    await waitFor((cb) => s.watchSession(code, cb), (x) => x && x.status === "question");
    await s.answer(code, 0, me.pid, 2);
    await s.answer(code, 0, me.pid, 1);
    const ans = await waitFor((cb) => h.watchAnswers(code, 0, cb), (a) => a.length === 1 && a[0].choice === 1);
    assert.equal(ans[0].pid, me.pid);
  });
});

test("公開されるセッションに正解は入らず、正解を入れようとすると拒否される", async () => {
  await withSession(nick, async (h, code) => {
    await h.showQuestion(code, 0, four, 0);
    const s = await student();
    const sess = await waitFor((cb) => s.watchSession(code, cb), (x) => x && x.status === "question");
    assert.ok(!("answer" in sess.current));
    await rejectsWithCode(h.showQuestion(code, 1, { ...four, answer: 1 }, 0), "permission-denied");
  });
});

test("締め切り後・別の問題・範囲外の選択肢の回答は拒否される", async () => {
  await withSession(nick, async (h, code) => {
    const s = await student();
    const me = await s.join(code, { nickname: "じろう" });
    await h.showQuestion(code, 0, tf, 0);
    await waitFor((cb) => s.watchSession(code, cb), (x) => x && x.status === "question");
    await rejectsWithCode(s.answer(code, 0, me.pid, 2), "permission-denied");
    await rejectsWithCode(s.answer(code, 1, me.pid, 0), "permission-denied");
    await h.closeQuestion(code);
    await waitFor((cb) => s.watchSession(code, cb), (x) => x && x.status === "closed");
    await rejectsWithCode(s.answer(code, 0, me.pid, 0), "permission-denied");
  });
});

test("制限時間3秒の問題に6秒後に答えると拒否される（猶予2秒）", async () => {
  await withSession({ ...nick, timeLimit: 3 }, async (h, code) => {
    const s = await student();
    const me = await s.join(code, { nickname: "おそい" });
    await h.showQuestion(code, 0, four, 3);
    await waitFor((cb) => s.watchSession(code, cb), (x) => x && x.status === "question" && x.startedAt);
    await s.answer(code, 0, me.pid, 0);
    await sleep(6000);
    await rejectsWithCode(s.answer(code, 0, me.pid, 1), "permission-denied");
  });
});

test("生徒はセッションを書き換えられず、参加者や回答の一覧も読めない", async () => {
  await withSession(nick, async (h, code) => {
    const s = await student();
    await s.join(code, { nickname: "いたずら" });
    const db = s.db;
    await rejectsWithCode(F.updateDoc(F.doc(db, "sessions", code), { status: "revealed" }), "permission-denied");
    await rejectsWithCode(F.getDocs(F.collection(db, "sessions", code, "answers")), "permission-denied");
    await rejectsWithCode(F.getDocs(F.collection(db, "sessions", code, "participants")), "permission-denied");
  });
});

test("正解発表と終了のデータが生徒に届く", async () => {
  await withSession(nick, async (h, code) => {
    const s = await student();
    await h.showQuestion(code, 0, four, 0);
    await h.closeQuestion(code);
    await h.reveal(code, { answer: 1, counts: [0, 1, 0, 0], answered: 1, correct: 1, rate: 1, unanswered: 0, explanation: "367km", top: null });
    const r = await waitFor((cb) => s.watchSession(code, cb), (x) => x && x.status === "revealed");
    assert.equal(r.reveal.answer, 1);
    await h.finish(code, { top: null });
    await waitFor((cb) => s.watchSession(code, cb), (x) => x && x.status === "finished");
  });
});
