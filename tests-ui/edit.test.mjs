// 先生の問題作成画面（npm run test:ui）
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { start, stop, openPage, text, count, setVal, noHScroll, waitFile, BASE } from "./helpers.mjs";

before(start);
after(stop);

// 1x1 の PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function makeQuiz(p) {
  await p.goto(BASE + "#host", { waitUntil: "load" });
  await p.click("[data-act=new-quiz]");
  await p.waitForSelector("#quiz-title");
  await setVal(p, "#quiz-title", "日本の川");
  await p.click("[data-act=add-four]");
  await setVal(p, ".q-card:nth-of-type(1) .q-text", "日本で一番長い川は？");
  const ch = ["利根川", "信濃川", "石狩川", "北上川"];
  for (let i = 0; i < 4; i++) await setVal(p, `.q-card:nth-of-type(1) .q-choice[data-i="${i}"]`, ch[i]);
  await p.click('.q-card:nth-of-type(1) .q-answer[value="1"]');
  await setVal(p, ".q-card:nth-of-type(1) .q-expl", "信濃川は367km");
  await p.click("[data-act=add-tf]");
  await setVal(p, ".q-card:nth-of-type(2) .q-text", "富士山は日本一高い山である");
  await p.click('.q-card:nth-of-type(2) .q-answer[value="0"]');
  await p.select("#set-time", "30");
  await p.click("#set-mode-roster");
  await p.click("#set-ranking");
}

test("クイズを作り、4択と〇×を追加し、設定を変えて再読み込みしても残っている", async () => {
  const p = await openPage("#host");
  await makeQuiz(p);
  await p.reload({ waitUntil: "load" });
  await p.waitForSelector("#quiz-title");
  assert.equal(await p.$eval("#quiz-title", (e) => e.value), "日本の川");
  await p.click("[data-act=back]");
  await p.waitForSelector(".quiz-item");
  assert.match(await text(p, ".quiz-item"), /日本の川/);
  assert.match(await text(p, ".quiz-item"), /2問/);
  await p.click(".quiz-item [data-act=edit]");
  await p.waitForSelector(".q-card");
  assert.equal(await count(p, ".q-card"), 2);
  assert.equal(await p.$eval(".q-card:nth-of-type(1) .q-text", (e) => e.value), "日本で一番長い川は？");
  assert.equal(await p.$eval('.q-card:nth-of-type(1) .q-answer[value="1"]', (e) => e.checked), true);
  assert.equal(await count(p, ".q-card:nth-of-type(2) .q-choice"), 0, "〇×には選択肢の入力欄がない");
  assert.equal(await p.$eval("#set-time", (e) => e.value), "30");
  assert.equal(await p.$eval("#set-mode-roster", (e) => e.checked), true);
  assert.equal(await p.$eval("#set-ranking", (e) => e.checked), true);
  assert.deepEqual(p.errors, []);
});

test("書き出したファイルを別のブラウザで読み込むと、画像ごと戻る", async () => {
  const a = await openPage("#host");
  await makeQuiz(a);
  const img = path.join(os.tmpdir(), `quiz-ui-${Date.now()}.png`);
  fs.writeFileSync(img, PNG);
  const [chooser] = await Promise.all([a.waitForFileChooser(), a.click(".q-card:nth-of-type(1) [data-act=add-image]")]);
  await chooser.accept([img]);
  await a.waitForSelector(".q-card:nth-of-type(1) img.q-img");
  await a.click("[data-act=back]");
  await a.waitForSelector(".quiz-item");
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), "quiz-dl-"));
  const cdp = await a.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
  await a.click(".quiz-item [data-act=export]");
  const exported = await waitFile(dl, /\.json$/);
  assert.match(exported, /data:image\//);

  const b = await openPage("#host");
  const file = path.join(os.tmpdir(), `quiz-ui-${Date.now()}.json`);
  fs.writeFileSync(file, exported);
  const [ch2] = await Promise.all([b.waitForFileChooser(), b.click("[data-act=import]")]);
  await ch2.accept([file]);
  await b.waitForSelector(".quiz-item");
  assert.match(await text(b, ".quiz-item"), /日本の川/);
  await b.click(".quiz-item [data-act=edit]");
  await b.waitForSelector(".q-card:nth-of-type(1) img.q-img");
  assert.deepEqual(b.errors, []);
});

test("入力エラーがあると開始ボタンが押せず、エラーが表示される", async () => {
  const p = await openPage("#host");
  await p.click("[data-act=new-quiz]");
  await p.waitForSelector("#quiz-title");
  await p.click("[data-act=add-four]");
  await setVal(p, ".q-card:nth-of-type(1) .q-text", "空の選択肢がある問題");
  assert.equal(await p.$eval("[data-act=start]", (e) => e.disabled), true);
  assert.match(await text(p, ".edit-errors"), /1問目：空の選択肢があります/);
});

test("スマホ（375×553）で問題作成画面が横にはみ出さない", async () => {
  const p = await openPage("#host", { viewport: { width: 375, height: 553, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  await makeQuiz(p);
  assert.equal(await noHScroll(p), true);
});

test("正解の丸を先に選んでから入力した選択肢と解説も、再読み込み後に残っている", async () => {
  const p = await openPage("#host");
  await p.click("[data-act=new-quiz]");
  await p.waitForSelector("#quiz-title");
  await setVal(p, "#quiz-title", "順番テスト");
  await p.click("[data-act=add-four]");
  await setVal(p, ".q-card:nth-of-type(1) .q-text", "問題文");
  await p.click('.q-card:nth-of-type(1) .q-answer[value="2"]');
  for (const [i, c] of ["あ", "い", "う", "え"].entries()) await setVal(p, `.q-card:nth-of-type(1) .q-choice[data-i="${i}"]`, c);
  await setVal(p, ".q-card:nth-of-type(1) .q-expl", "解説です");
  await p.reload({ waitUntil: "load" });
  await p.waitForSelector(".q-card");
  assert.deepEqual(await p.$$eval(".q-choice", (es) => es.map((e) => e.value)), ["あ", "い", "う", "え"]);
  assert.equal(await p.$eval(".q-expl", (e) => e.value), "解説です");
  assert.equal(await p.$eval('.q-answer[value="2"]', (e) => e.checked), true);
  assert.equal(await p.$eval("[data-act=start]", (e) => e.disabled), false);
});
