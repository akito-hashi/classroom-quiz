// 生徒の画面（npm run test:ui）。先生側はテストから store を直接操作する。
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, openPage, text, count, setVal, noHScroll, waitText } from "./helpers.mjs";
import { host, closeAll, waitFor } from "../tests-firebase/helpers.mjs";

let h;
const codes = [];
before(async () => { await start(); h = await host(); });
after(async () => { for (const c of codes) await h.deleteSession(c).catch(() => {}); await closeAll(); await stop(); });

const four = { type: "four", text: "日本で一番長い川は？", choices: ["利根川", "信濃川", "石狩川", "北上川"], hasImage: false };
const tf = { type: "tf", text: "富士山は日本一高い", choices: ["〇", "×"], hasImage: false };
const nick = { mode: "nick", timeLimit: 0, ranking: false };
const PHONE = { width: 375, height: 553, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

async function newSession(settings = nick, qCount = 2) {
  const code = await h.createSession(settings, qCount);
  codes.push(code);
  return code;
}
async function joinAs(p, name, extra = {}) {
  await p.waitForSelector("#nickname");
  await setVal(p, "#nickname", name);
  if (extra.cls) { await setVal(p, "#cls", extra.cls); await setVal(p, "#num", String(extra.num)); }
  await p.click("[data-act=join]");
}
const participants = (code) => h.getParticipants(code);
const tap = (p, c) => p.$eval(`.choice-btn[data-c="${c}"]`, (e) => e.click());

test("#join=コードを開くとコードが入っていて、参加すると待機画面に名前が出る", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await p.waitForSelector("#nickname");
  assert.match(await text(p, ".join-code"), new RegExp(code));
  await joinAs(p, "たろう");
  await waitText(p, ".stu-wait", /たろう/);
  assert.equal((await participants(code)).length, 1);
  assert.deepEqual(p.errors, []);
});

test("答えを変えると最後の答えが届き、「送信済み」と出る", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "はなこ");
  await waitText(p, ".stu-wait", /はなこ/);
  await h.showQuestion(code, 0, four, 0);
  await p.waitForSelector('.choice-btn[data-c="1"]');
  await tap(p, 1);
  await waitText(p, ".send-status", /送信済み/);
  await tap(p, 2);
  await waitText(p, ".send-status", /送信済み/);
  const ans = await waitFor((cb) => h.watchAnswers(code, 0, cb), (a) => a.length === 1 && a[0].choice === 2);
  assert.equal(ans.length, 1);
  assert.equal(await p.$eval('.choice-btn[data-c="2"]', (e) => e.getAttribute("aria-pressed")), "true");
});

test("通信が切れているときに押すと「届きませんでした」と出る", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "けんじ");
  await waitText(p, ".stu-wait", /けんじ/);
  await h.showQuestion(code, 0, tf, 0);
  await p.waitForSelector('.choice-btn[data-c="0"]');
  await p.setOfflineMode(true);
  await tap(p, 0);
  await waitText(p, ".send-status", /届きませんでした/, 20000);
  await p.setOfflineMode(false);
});

test("再読み込みすると元の参加者として戻り、参加者は増えない", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "もどる");
  await waitText(p, ".stu-wait", /もどる/);
  await p.reload({ waitUntil: "load" });
  await waitText(p, ".stu-wait", /もどる/);
  assert.equal((await participants(code)).length, 1);
});

test("端末に保存できないブラウザでも、参加と回答ができる", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, {
    viewport: PHONE,
    beforeLoad: () => {
      const no = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: no });
    },
  });
  await joinAs(p, "ほぞんなし");
  await waitText(p, ".stu-wait", /ほぞんなし/);
  await h.showQuestion(code, 0, four, 0);
  await p.waitForSelector('.choice-btn[data-c="3"]');
  await tap(p, 3);
  await waitText(p, ".send-status", /送信済み/);
  assert.deepEqual(p.errors, []);
});

test("正解発表で正解・不正解が出て、終了後に自分の正解数が出る", async () => {
  const code = await newSession(nick, 2);
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "さくら");
  await waitText(p, ".stu-wait", /さくら/);
  const [me] = await participants(code);
  await h.showQuestion(code, 0, four, 0);
  await p.waitForSelector('.choice-btn[data-c="1"]');
  await tap(p, 1);
  await waitText(p, ".send-status", /送信済み/);
  await h.closeQuestion(code);
  await h.reveal(code, { answer: 1, counts: [0, 1, 0, 0], answered: 1, correct: 1, rate: 1, unanswered: 0, explanation: "", top: null });
  await waitText(p, ".stu-result", /正解/);
  assert.doesNotMatch(await text(p, ".stu-result"), /不正解/);
  await h.showQuestion(code, 1, tf, 0);
  await p.waitForSelector('.choice-btn[data-c="1"]');
  await tap(p, 1);
  await waitText(p, ".send-status", /送信済み/);
  await h.closeQuestion(code);
  await h.reveal(code, { answer: 0, counts: [0, 1], answered: 1, correct: 0, rate: 0, unanswered: 0, explanation: "", top: null });
  await waitText(p, ".stu-result", /不正解/);
  assert.match(await text(p, ".stu-result"), /〇/);
  await h.finish(code, { answers: [1, 0], top: null });
  await waitText(p, ".stu-final", /2問中 1問 正解/);
  void me;
});

test("退出させられると、その旨が表示される", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "いたずら");
  await waitText(p, ".stu-wait", /いたずら/);
  const [me] = await participants(code);
  await h.kick(code, me.pid);
  await waitText(p, ".stu-msg", /退出/);
});

test("名前の変更を求められると、新しい名前を入れられる", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "うんこ");
  await waitText(p, ".stu-wait", /うんこ/);
  const [me] = await participants(code);
  await h.requireRename(code, me.pid);
  await p.waitForSelector("#rename");
  await setVal(p, "#rename", "ゆうき");
  await p.click("[data-act=rename]");
  await waitText(p, ".stu-wait", /ゆうき/);
});

test("成績用：クラスと出席番号で参加し、同じ番号の2人目は許可待ちになる", async () => {
  const code = await newSession({ mode: "roster", timeLimit: 0, ranking: false });
  const a = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(a, "たろう", { cls: "1組", num: 7 });
  await waitText(a, ".stu-wait", /1組 7番/);
  const b = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(b, "たろう", { cls: "1組", num: 7 });
  await waitText(b, ".stu-msg", /許可を待って/);
});

test("スマホ・タブレット・PCで、選択肢がはみ出さず画面内に収まる", async () => {
  const code = await newSession();
  for (const vp of [PHONE, { width: 820, height: 1180, isMobile: true, hasTouch: true }, { width: 1280, height: 800 }]) {
    const p = await openPage("#join=" + code, { viewport: vp });
    await joinAs(p, "がめん" + vp.width);
    await waitText(p, ".stu-name", /がめん/);
    await h.showQuestion(code, 0, { ...four, text: "とても長い問題文".repeat(6), choices: ["とても長い選択肢の文章です".repeat(2), "b", "c", "d"] }, 0);
    await p.waitForSelector('.choice-btn[data-c="3"]');
    assert.equal(await noHScroll(p), true, `横はみ出し ${vp.width}`);
    const bottom = await p.$eval('.choice-btn[data-c="3"]', (e) => e.getBoundingClientRect().bottom);
    assert.ok(bottom <= vp.height, `最後の選択肢が画面内 ${vp.width}: ${bottom}`);
    await h.closeQuestion(code);
  }
});

test("通信が切れて届かなかった答えは、締め切り後も正解発表でも「届かなかった」と分かる", async () => {
  const code = await newSession();
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "とどかず");
  await waitText(p, ".stu-wait", /とどかず/);
  await h.showQuestion(code, 0, four, 0);
  await p.waitForSelector('.choice-btn[data-c="1"]');
  await p.setOfflineMode(true);
  await tap(p, 1);
  await waitText(p, ".send-status", /届きませんでした/, 20000);
  await h.closeQuestion(code);
  await p.setOfflineMode(false);
  await waitText(p, ".stu-wait", /届きませんでした/, 20000);
  await h.reveal(code, { answer: 1, counts: [0, 0, 0, 0], answered: 0, correct: 0, rate: null, unanswered: 1, explanation: "", top: null });
  await waitText(p, ".stu-result", /未回答/);
  assert.doesNotMatch(await text(p, ".stu-result"), /正解！/);
});

test("画面のロックなどで問題が遅れて届いても、残り時間は実際の締め切りに合わせて表示される", async () => {
  const code = await newSession({ mode: "nick", timeLimit: 30, ranking: false });
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "おくれ");
  await waitText(p, ".stu-wait", /おくれ/);
  await p.setOfflineMode(true);
  await h.showQuestion(code, 0, four, 30);
  await new Promise((r) => setTimeout(r, 8000));
  await p.setOfflineMode(false);
  await p.waitForSelector(".countdown", { timeout: 30000 });
  const sec = Number((await text(p, ".countdown")).replace(/\D/g, ""));
  assert.ok(sec <= 24, `残り ${sec} 秒と表示（実際は約22秒以下）`);
});

test("カウントダウン中も、選択肢のボタンは作り直されず、スクロール位置も保たれる", async () => {
  const code = await newSession({ mode: "nick", timeLimit: 30, ranking: false });
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "すくろーる");
  await waitText(p, ".stu-wait", /すくろーる/);
  await h.showQuestion(code, 0, { ...four, text: "長い問題文です。".repeat(40) }, 30);
  await p.waitForSelector('.choice-btn[data-c="3"]');
  await p.evaluate(() => { window.__btn = document.querySelector('.choice-btn[data-c="3"]'); window.scrollTo(0, 200); });
  const y0 = await p.evaluate(() => window.scrollY);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(await p.evaluate(() => window.__btn === document.querySelector('.choice-btn[data-c="3"]')), true, "ボタンが作り直された");
  assert.equal(await p.evaluate(() => window.scrollY), y0, "スクロールが先頭に戻った");
});

test("別の端末で参加し直したあと、元の端末を開き直すと参加画面に戻れる", async () => {
  const code = await newSession({ mode: "roster", timeLimit: 0, ranking: false });
  const a = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(a, "たろう", { cls: "2組", num: 3 });
  await waitText(a, ".stu-wait", /2組 3番/);
  const b = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(b, "たろう", { cls: "2組", num: 3 });
  await waitText(b, ".stu-msg", /許可を待って/);
  const pending = (await participants(code)).find((x) => x.status === "pending");
  await h.approveRejoin(code, pending.pid);
  await a.bringToFront(); // 裏のタブはタイマーが間引かれて通知が遅れるため
  await waitText(a, ".stu-msg", /別の端末/);
  await a.reload({ waitUntil: "load" });
  await a.waitForSelector("#nickname");
});

test("先生がクラウドのデータを消しても、表示済みの最終結果は消えない", async () => {
  const code = await h.createSession(nick, 1);
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await joinAs(p, "さいご");
  await waitText(p, ".stu-wait", /さいご/);
  await h.showQuestion(code, 0, four, 0);
  await p.waitForSelector('.choice-btn[data-c="1"]');
  await tap(p, 1);
  await waitText(p, ".send-status", /送信済み/);
  await h.closeQuestion(code);
  await h.finish(code, { asked: 1, answers: [1], top: null });
  await waitText(p, ".stu-final", /1問中 1問 正解/);
  await h.deleteSession(code);
  await new Promise((r) => setTimeout(r, 2000));
  assert.match(await text(p, ".stu-final"), /1問中 1問 正解/);
});
