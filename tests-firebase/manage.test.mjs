// 成績用の参加と、先生の管理操作（npm run test:firebase）
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { host, student, closeAll, waitFor, rejectsWithCode, fb } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const Results = require("../results.js");
after(closeAll);
const F = fb.firestore;
const four = { type: "four", text: "q", choices: ["a", "b", "c", "d"], hasImage: false };
const roster = { mode: "roster", timeLimit: 0, ranking: false };
const nick = { mode: "nick", timeLimit: 0, ranking: false };

async function withSession(settings, fn) {
  const h = await host();
  const code = await h.createSession(settings, 3);
  try { await fn(h, code); } finally { await h.deleteSession(code).catch(() => {}); }
}

test("同じ出席番号の2人目は許可待ちになり、許可すると前の回答を引き継いで1行にまとまる", async () => {
  await withSession(roster, async (h, code) => {
    const a = await student();
    const meA = await a.join(code, { nickname: "たろう", cls: "1組", num: 3 });
    assert.equal(meA.status, "active");
    await h.showQuestion(code, 0, four, 0);
    await a.answer(code, 0, meA.pid, 1);

    const b = await student();
    const meB = await b.join(code, { nickname: "たろう", cls: "1組", num: 3 });
    assert.equal(meB.status, "pending");
    await rejectsWithCode(b.answer(code, 0, meB.pid, 2), "permission-denied");

    await h.approveRejoin(code, meB.pid);
    const me = await waitFor((cb) => b.watchMe(code, meB.pid, cb), (p) => p && p.status === "active");
    assert.equal(me.inheritsFrom, meA.pid);
    await rejectsWithCode(a.answer(code, 0, meA.pid, 3), "permission-denied");
    await h.closeQuestion(code);
    await h.showQuestion(code, 1, four, 0);
    await b.answer(code, 1, meB.pid, 0);

    const quiz = { settings: roster, questions: [{ type: "four", answer: 1 }, { type: "four", answer: 0 }] };
    const csv = Results.buildCsv({ quiz, participants: await h.getParticipants(code), answers: await h.getAllAnswers(code), asked: 2 });
    const lines = csv.slice(1).trim().split("\r\n");
    assert.equal(lines.length, 2);
    assert.equal(lines[1], "1組,3,たろう,B,○,A,○,2,100%,");
  });
});

test("出席番号の範囲外や、ニックネームのみのクイズでの出席番号は受け付けない", async () => {
  await withSession(roster, async (h, code) => {
    const s = await student();
    await rejectsWithCode(s.join(code, { nickname: "x", cls: "1組", num: 0 }), "permission-denied");
    await rejectsWithCode(s.join(code, { nickname: "", cls: "1組", num: 1 }), "permission-denied");
  });
});

test("退出させた生徒は回答も名前の変更もできず、CSV には退出の印付きで残る", async () => {
  await withSession(nick, async (h, code) => {
    const s = await student();
    const me = await s.join(code, { nickname: "いたずら" });
    await h.showQuestion(code, 0, four, 0);
    await s.answer(code, 0, me.pid, 0);
    await h.kick(code, me.pid);
    await waitFor((cb) => s.watchMe(code, me.pid, cb), (p) => p && p.status === "kicked");
    await rejectsWithCode(s.answer(code, 0, me.pid, 1), "permission-denied");
    await rejectsWithCode(s.rename(code, me.pid, "まじめ"), "permission-denied");
    const quiz = { settings: nick, questions: [{ type: "four", answer: 0 }] };
    const csv = Results.buildCsv({ quiz, participants: await h.getParticipants(code), answers: await h.getAllAnswers(code), asked: 1 });
    assert.match(csv, /いたずら,A,○,1,100%,退出/);
  });
});

test("名前の変更を求められた生徒は名前を変えられ、回答は残る", async () => {
  await withSession(nick, async (h, code) => {
    const s = await student();
    const me = await s.join(code, { nickname: "へんななまえ" });
    await h.showQuestion(code, 0, four, 0);
    await s.answer(code, 0, me.pid, 2);
    await h.requireRename(code, me.pid);
    await waitFor((cb) => s.watchMe(code, me.pid, cb), (p) => p && p.renameRequired === true);
    await s.rename(code, me.pid, "さくら");
    const ps = await waitFor((cb) => h.watchParticipants(code, cb), (ps) => ps[0]?.nickname === "さくら" && ps[0].renameRequired === false);
    assert.equal(ps[0].status, "active");
    assert.equal((await h.getAllAnswers(code)).length, 1);
  });
});

test("セッションを削除すると参加者・回答・座席・本体がすべて消える", async () => {
  const h = await host();
  const code = await h.createSession(roster, 1);
  const s = await student();
  const me = await s.join(code, { nickname: "a", cls: "2組", num: 1 });
  await h.showQuestion(code, 0, four, 0);
  await s.answer(code, 0, me.pid, 0);
  await h.deleteSession(code);
  assert.equal(await h.getSession(code), null);
  // セッション本体が消えると一覧は読めなくなるので、ID を指定して1件ずつ確かめる。
  // 座席は先生しか読めず、本体が消えると先生も確かめられないので、参加者・回答と同じ手順で消えることに頼る
  for (const path of [["participants", me.pid], ["answers", `0_${me.pid}`]]) {
    const d = await F.getDoc(F.doc(s.db, "sessions", code, ...path));
    assert.equal(d.exists(), false, path.join("/"));
  }
});

test("他の先生のセッションは削除できない", async () => {
  await withSession(nick, async (h, code) => {
    const other = await host(1);
    await rejectsWithCode(F.deleteDoc(F.doc(other.db, "sessions", code)), "permission-denied");
    await rejectsWithCode(other.kick(code, "x".repeat(20)), "permission-denied");
  });
});

test("cleanupOld は自分の古いセッションを消す", async () => {
  const h = await host();
  const code = await h.createSession(nick, 1);
  await h.cleanupOld(0);
  assert.equal(await h.getSession(code), null);
});

test("生徒は出席番号の予約（座席）を読めない（他人の pid を知る手段がない）", async () => {
  await withSession(roster, async (h, code) => {
    const a = await student();
    await a.join(code, { nickname: "たろう", cls: "1組", num: 12 });
    const evil = await student();
    await rejectsWithCode(F.getDoc(F.doc(evil.db, "sessions", code, "seats", "1組-12")), "permission-denied");
  });
});

test("名前の変更を求められていない生徒は、自分で名前を変えられない", async () => {
  await withSession(nick, async (h, code) => {
    const s = await student();
    const me = await s.join(code, { nickname: "まじめ" });
    await rejectsWithCode(s.rename(code, me.pid, "わるくち"), "permission-denied");
  });
});

test("セッションには、消し忘れても自動で消すための期限（作成から48時間）が付く", async () => {
  await withSession(nick, async (h, code) => {
    const s = await h.getSession(code);
    const hours = (s.expireAt.toMillis() - s.createdAt.toMillis()) / 3600e3;
    assert.ok(hours > 47.9 && hours < 48.1, String(hours));
  });
});
