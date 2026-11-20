// 先生の授業画面（先生1人＋生徒数人を別々のブラウザで動かす）。npm run test:ui
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { start, stop, openPage, text, count, setVal, waitText, waitFile, noHScroll } from "./helpers.mjs";
import { student, closeAll } from "../tests-firebase/helpers.mjs";

before(start);
after(async () => { await closeAll(); await stop(); });

const QUIZ = (settings = {}) => ({
  id: "quiz1", title: "日本の川",
  settings: { mode: "nick", timeLimit: 0, ranking: false, ...settings },
  questions: [
    { id: "a", type: "four", text: "日本で一番長い川は？", choices: ["利根川", "信濃川", "石狩川", "北上川"], answer: 1, explanation: "信濃川は367km", imageId: null },
    { id: "b", type: "tf", text: "富士山は日本一高い", choices: ["〇", "×"], answer: 0, explanation: "3776m", imageId: null },
  ],
});
const PC = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 553, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const tap = (p, c) => p.$eval(`.choice-btn[data-c="${c}"]`, (e) => e.click());
const click = (p, sel) => p.$eval(sel, (e) => e.click());

// 先生のページを開き、クイズを入れて「授業で使う」を押す。参加コードを返す
async function teacher(quiz, viewport = PC) {
  const t = await openPage("#host", { viewport });
  await t.evaluate((q) => localStorage.setItem("quiz-library-v1", JSON.stringify({ quizzes: [q] })), quiz);
  await t.reload({ waitUntil: "load" });
  await t.waitForSelector(".quiz-item [data-act=start]");
  await click(t, ".quiz-item [data-act=start]");
  await t.waitForSelector(".live-code", { timeout: 20000 });
  const code = (await text(t, ".live-code")).replace(/\D/g, "");
  assert.match(code, /^\d{6}$/);
  return { t, code };
}
async function join(code, name, extra = {}) {
  const p = await openPage("#join=" + code, { viewport: PHONE });
  await p.waitForSelector("#nickname");
  await setVal(p, "#nickname", name);
  if (extra.cls) { await setVal(p, "#cls", extra.cls); await setVal(p, "#num", String(extra.num)); }
  await p.click("[data-act=join]");
  return p;
}

test("3人が2問に答える授業を通しで行い、集計・正解発表・CSV・削除までできる", async () => {
  const { t, code } = await teacher(QUIZ());
  assert.ok(await t.$(".live-qr svg"), "QRコードが出る");
  const [s1, s2, s3] = [await join(code, "あおい"), await join(code, "いつき"), await join(code, "うみ")];
  await waitText(t, ".people-count", /3人/);

  await click(t, "[data-act=next]");
  await waitText(t, ".live-qtext", /日本で一番長い川/);
  for (const [p, c] of [[s1, 1], [s2, 1], [s3, 0]]) { await p.waitForSelector(".choice-btn"); await tap(p, c); }
  await waitText(t, ".answer-count", /3\s*\/\s*3/);
  await t.waitForSelector(".all-answered");
  assert.ok(await t.$("[data-act=close]"), "全員回答でも締め切られていない");

  await click(t, "[data-act=close]");
  await t.waitForSelector("[data-act=reveal]");
  await click(t, "[data-act=reveal]");
  await waitText(t, ".rate", /67%/);
  assert.equal(await t.$eval(".live-bar", (e) => getComputedStyle(e).backgroundColor), "rgb(31, 42, 68)", "上の帯は紺色のまま");
  assert.ok(await t.$eval(".dist-bar", (e) => e.getBoundingClientRect().height) < 30, "グラフの棒は細い");
  assert.deepEqual(await t.$$eval(".dist-bar", (es) => es.map((e) => Number(e.dataset.count))), [1, 2, 0, 0]);
  assert.match(await text(t, ".live-expl"), /367km/);
  assert.equal(await count(t, ".rank-list"), 0, "ランキングなしでは順位を出さない");
  await waitText(s1, ".stu-result", /正解！/);
  await waitText(s3, ".stu-result", /不正解/);
  assert.equal(await count(s1, ".rank-list"), 0);

  // 2問目の途中で先生が再読み込みしても続きから再開できる
  await click(t, "[data-act=next]");
  await waitText(t, ".live-qtext", /富士山/);
  await s1.waitForSelector('.choice-btn[data-c="0"]');
  await tap(s1, 0);
  await waitText(t, ".answer-count", /1\s*\/\s*3/);
  await t.reload({ waitUntil: "load" });
  await waitText(t, ".live-qtext", /富士山/, 20000);
  await waitText(t, ".answer-count", /1\s*\/\s*3/);
  await s2.waitForSelector('.choice-btn[data-c="1"]');
  await tap(s2, 1);
  await waitText(t, ".answer-count", /2\s*\/\s*3/);
  await click(t, "[data-act=close]");
  await t.waitForSelector("[data-act=reveal]");
  await click(t, "[data-act=reveal]");
  await waitText(t, ".rate", /50%/);
  assert.match(await text(t, ".unanswered"), /1人/);

  await click(t, "[data-act=next]"); // 最後の問題のあとは最終結果へ
  await t.waitForSelector("[data-act=csv]");
  await waitText(s1, ".stu-final", /2問中 2問 正解/);

  const dl = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-csv-"));
  const cdp = await t.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
  await click(t, "[data-act=csv]");
  const csv = await waitFile(dl, /\.csv$/);
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "クラス,出席番号,ニックネーム,Q1選択,Q1正誤,Q2選択,Q2正誤,正解数,正解率,退出");
  assert.ok(lines.includes(",,あおい,B,○,〇,○,2,100%,"), lines.join("\n"));
  assert.ok(lines.includes(",,いつき,B,○,×,×,1,50%,"));
  assert.ok(lines.includes(",,うみ,A,×,,未回答,0,0%,"));

  await click(t, "[data-act=delete]");
  await t.waitForSelector(".quiz-item", { timeout: 20000 });
  const sv = await student();
  assert.equal(await sv.getSession(code), null, "クラウドから消えている");
  for (const p of [t, s1, s2, s3]) assert.deepEqual(p.errors, []);
});

test("ランキングありでは正解発表に上位が出る", async () => {
  const { t, code } = await teacher(QUIZ({ ranking: true }));
  const s1 = await join(code, "らんく");
  const s2 = await join(code, "れいてん");
  await waitText(t, ".people-count", /2人/);
  await click(t, "[data-act=next]");
  await s1.waitForSelector(".choice-btn");
  await tap(s1, 1);
  await s2.waitForSelector(".choice-btn");
  await tap(s2, 0);
  await waitText(t, ".answer-count", /2\s*\/\s*2/);
  await click(t, "[data-act=close]");
  await t.waitForSelector("[data-act=reveal]");
  await click(t, "[data-act=reveal]");
  await waitText(t, ".rank-list", /らんく/);
  assert.doesNotMatch(await text(t, ".rank-list"), /れいてん/, "0問の生徒はランキングに出さない");
  await click(t, "[data-act=finish]");
  await t.waitForSelector("[data-act=delete]");
  await click(t, "[data-act=delete]");
  await t.waitForSelector(".quiz-item", { timeout: 20000 });
});

test("制限時間が過ぎると自動で締め切られる", async () => {
  const { t, code } = await teacher(QUIZ({ timeLimit: 3 }));
  await join(code, "じかん");
  await waitText(t, ".people-count", /1人/);
  await click(t, "[data-act=next]");
  await waitText(t, ".countdown", /\d+秒/);
  await t.waitForSelector("[data-act=reveal]", { timeout: 15000 });
  await click(t, "[data-act=finish]");
  await t.waitForSelector("[data-act=delete]");
  await click(t, "[data-act=delete]");
  await t.waitForSelector(".quiz-item", { timeout: 20000 });
});

test("成績用：同じ出席番号の再参加を先生が許可し、退出・名前変更もできる", async () => {
  const { t, code } = await teacher(QUIZ({ mode: "roster" }));
  const a = await join(code, "たろう", { cls: "1組", num: 7 });
  await waitText(t, ".people-count", /1人/);
  const b = await join(code, "たろう", { cls: "1組", num: 7 });
  await waitText(b, ".stu-msg", /許可を待って/);
  await t.waitForSelector("[data-act=approve]");
  await click(t, "[data-act=approve]");
  await waitText(b, ".stu-wait", /1組 7番 たろう/);
  await waitText(a, ".stu-msg", /別の端末/);

  const c = await join(code, "へんななまえ", { cls: "1組", num: 8 });
  await waitText(t, ".person", /へんななまえ/);
  await click(t, '.person[data-name="へんななまえ"] [data-act=rename-req]');
  await c.waitForSelector("#rename");
  await setVal(c, "#rename", "けい");
  await c.click("[data-act=rename]");
  await waitText(t, ".person", /けい/);
  await click(t, '.person[data-name="けい"] [data-act=kick]');
  await waitText(c, ".stu-msg", /退出/);
  await click(t, "[data-act=finish]");
  await t.waitForSelector("[data-act=delete]");
  await click(t, "[data-act=delete]");
  await t.waitForSelector(".quiz-item", { timeout: 20000 });
});

test("先生の画面をスマホで使っても横にはみ出さない", async () => {
  const { t, code } = await teacher(QUIZ(), PHONE);
  assert.equal(await noHScroll(t), true, "待機画面");
  const s = await join(code, "すまほ");
  await waitText(t, ".people-count", /1人/);
  await click(t, "[data-act=next]");
  await waitText(t, ".live-qtext", /日本で一番長い川/);
  assert.equal(await noHScroll(t), true, "出題画面");
  await s.waitForSelector(".choice-btn");
  await tap(s, 1);
  await waitText(t, ".answer-count", /1\s*\/\s*1/);
  await click(t, "[data-act=close]");
  await t.waitForSelector("[data-act=reveal]");
  await click(t, "[data-act=reveal]");
  await waitText(t, ".rate", /100%/);
  assert.equal(await noHScroll(t), true, "正解発表");
  await click(t, "[data-act=finish]");
  await t.waitForSelector("[data-act=delete]");
  await click(t, "[data-act=delete]");
  await t.waitForSelector(".quiz-item", { timeout: 20000 });
});
