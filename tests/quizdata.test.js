const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../quizdata.js");

const four = (over = {}) => ({ id: "q1", type: "four", text: "日本で一番長い川は？", choices: ["利根川", "信濃川", "石狩川", "北上川"], answer: 1, explanation: "信濃川は367km", imageId: null, ...over });

test("newQuiz は既定の設定（ニックネームのみ・20秒・ランキングなし）と空の問題で作られる", () => {
  const z = Q.newQuiz();
  assert.ok(z.id);
  assert.deepEqual(z.settings, { mode: "nick", timeLimit: 20, ranking: false });
  assert.deepEqual(z.questions, []);
});

test("〇×に変えた問題は選択肢が〇×の2つになり、正解の3は0に直る", () => {
  const q = Q.normalizeQuestion(four({ type: "tf", answer: 3 }));
  assert.deepEqual(q.choices, ["〇", "×"]);
  assert.equal(q.answer, 0);
});

test("4択は選択肢がちょうど4つにそろえられる", () => {
  const q = Q.normalizeQuestion(four({ choices: ["a", "b"], answer: 1 }));
  assert.deepEqual(q.choices, ["a", "b", "", ""]);
  assert.equal(q.answer, 1);
});

test("publicQuestion には正解と解説が含まれない", () => {
  const p = Q.publicQuestion(four({ imageId: "img1" }));
  assert.deepEqual(p, { type: "four", text: "日本で一番長い川は？", choices: ["利根川", "信濃川", "石狩川", "北上川"], hasImage: true });
  assert.ok(!("answer" in p) && !("explanation" in p));
});

test("validateQuiz は問題0問・空の問題文・空の選択肢をエラーにする", () => {
  const z = Q.newQuiz();
  z.title = "テスト";
  assert.equal(Q.validateQuiz(z).length, 1);
  z.questions = [four({ text: " " }), four({ choices: ["a", "", "c", "d"] })];
  const errs = Q.validateQuiz(z);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /1問目/);
  assert.match(errs[1], /2問目/);
  z.questions = [four(), four({ type: "tf", answer: 1 })];
  assert.deepEqual(Q.validateQuiz(z), []);
});

test("書き出し→読み込みで中身と画像が戻り、idは振り直される", () => {
  const z = Q.newQuiz();
  z.title = "川";
  z.questions = [four({ imageId: "img1" })];
  const json = Q.exportQuiz(z, { img1: "data:image/jpeg;base64,AAAA" });
  const { quiz, images } = Q.importQuiz(json);
  assert.equal(quiz.title, "川");
  assert.notEqual(quiz.id, z.id);
  assert.equal(quiz.questions[0].text, "日本で一番長い川は？");
  const newImg = quiz.questions[0].imageId;
  assert.ok(newImg && newImg !== "img1");
  assert.equal(images[newImg], "data:image/jpeg;base64,AAAA");
});

test("壊れたファイルの読み込みは分かりやすいエラーになる", () => {
  assert.throws(() => Q.importQuiz("{}"), /クイズのファイルではありません/);
  assert.throws(() => Q.importQuiz("not json"), /クイズのファイルではありません/);
});
