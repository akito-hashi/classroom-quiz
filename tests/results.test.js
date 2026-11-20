const test = require("node:test");
const assert = require("node:assert/strict");
const { tally, allAnswered, ranking } = require("../tally.js");
const { mergeChain, studentResults, buildCsv } = require("../results.js");
const { genCode, parseJoin } = require("../joincode.js");

test("分布[5,22,3,2]・正解B・参加35人 → 回答32、正解22、正解率22/32、未回答3", () => {
  const ans = [];
  [5, 22, 3, 2].forEach((n, c) => { for (let i = 0; i < n; i++) ans.push({ pid: `p${c}_${i}`, choice: c }); });
  const t = tally("four", 1, ans, 35);
  assert.deepEqual(t.counts, [5, 22, 3, 2]);
  assert.equal(t.answered, 32);
  assert.equal(t.correct, 22);
  assert.equal(t.rate, 22 / 32);
  assert.equal(t.unanswered, 3);
});

test("回答0件の正解率は null、〇×は分布が2つ", () => {
  const t = tally("tf", 0, [], 10);
  assert.deepEqual(t.counts, [0, 0]);
  assert.equal(t.rate, null);
  assert.equal(t.unanswered, 10);
});

test("allAnswered は参加中の全員が答えたときだけ true（退出者の回答は数えない）", () => {
  assert.equal(allAnswered([{ pid: "a" }, { pid: "b" }], ["a", "b"]), true);
  assert.equal(allAnswered([{ pid: "a" }, { pid: "x" }], ["a", "b"]), false);
  assert.equal(allAnswered([], []), false);
});

test("ranking は同点を同じ順位にし、5位までを返す", () => {
  const rows = [["A", 3], ["B", 5], ["C", 5], ["D", 1], ["E", 2], ["F", 0], ["G", 0]].map(([nickname, score]) => ({ nickname, score }));
  const r = ranking(rows, 5);
  assert.deepEqual(r.map((x) => [x.rank, x.nickname]), [[1, "B"], [1, "C"], [3, "A"], [4, "E"], [5, "D"]]);
});

const quiz = {
  title: "川",
  settings: { mode: "roster" },
  questions: [
    { type: "four", text: "q1", choices: ["a", "b", "c", "d"], answer: 1, explanation: "" },
    { type: "tf", text: "q2", choices: ["〇", "×"], answer: 0, explanation: "" },
    { type: "four", text: "q3", choices: ["a", "b", "c", "d"], answer: 2, explanation: "" },
  ],
};
const P = (pid, nickname, cls, num, extra = {}) => ({ pid, nickname, cls, num, status: "active", inheritsFrom: null, firstQ: 0, ...extra });

test("引き継いだ2つのpidは1人分にまとまり、新しい端末の回答が優先される", () => {
  const ps = [P("old", "たろう", "1組", 3, { status: "replaced" }), P("new", "たろう", "1組", 3, { inheritsFrom: "old", firstQ: 1 }), P("pend", "?", "1組", 4, { status: "pending" })];
  const chains = mergeChain(ps);
  assert.equal(chains.length, 1);
  assert.deepEqual(chains[0].pids, ["old", "new"]);
  assert.equal(chains[0].firstQ, 0);
  const answers = [{ pid: "old", q: 0, choice: 1 }, { pid: "old", q: 1, choice: 1 }, { pid: "new", q: 1, choice: 0 }];
  const [r] = studentResults(quiz, ps, answers, 3);
  assert.deepEqual(r.cells.map((c) => c.mark), ["○", "○", "未回答"]);
  assert.equal(r.score, 2);
  assert.equal(r.counted, 3);
});

test("Q3から参加した生徒は Q1・Q2 が未参加で、正解率の分母から外れる", () => {
  const ps = [P("a", "はなこ", "1組", 1, { firstQ: 2 })];
  const [r] = studentResults(quiz, ps, [{ pid: "a", q: 2, choice: 2 }], 3);
  assert.deepEqual(r.cells.map((c) => c.mark), ["未参加", "未参加", "○"]);
  assert.equal(r.counted, 1);
  assert.equal(r.score, 1);
});

test("CSV：BOM付き、見出し、出席番号順、退出の印、未参加、正解率", () => {
  const ps = [P("b", "じろう", "1組", 10), P("a", "はなこ", "1組", 2, { firstQ: 2 }), P("k", "いたずら", "1組", 5, { status: "kicked" })];
  const answers = [{ pid: "b", q: 0, choice: 1 }, { pid: "b", q: 1, choice: 1 }, { pid: "a", q: 2, choice: 2 }, { pid: "k", q: 0, choice: 0 }];
  const csv = buildCsv({ quiz, participants: ps, answers, asked: 3 });
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).trim().split("\r\n");
  assert.equal(lines[0], "クラス,出席番号,ニックネーム,Q1選択,Q1正誤,Q2選択,Q2正誤,Q3選択,Q3正誤,正解数,正解率,退出");
  assert.equal(lines[1], "1組,2,はなこ,未参加,未参加,未参加,未参加,C,○,1,100%,");
  assert.equal(lines[2], "1組,5,いたずら,A,×,,未回答,,未回答,0,0%,退出");
  assert.equal(lines[3], "1組,10,じろう,B,○,×,×,,未回答,1,33%,");
});

test("CSV：カンマ・改行・引用符はエスケープし、= で始まる名前は式にならない", () => {
  const ps = [P("a", '=1+1', "1,組", 1), P("b", 'よ"し\nお', "1組", 2)];
  const csv = buildCsv({ quiz, participants: ps, answers: [], asked: 1 });
  assert.ok(csv.includes(`"1,組",1,'=1+1,`));
  assert.ok(csv.includes(`1組,2,"よ""し\nお",`));
});

test("ニックネームのみのクイズは参加順に並び、クラスと番号は空", () => {
  const nq = { ...quiz, settings: { mode: "nick" } };
  const ps = [P("z", "ぜっと", "", null), P("a", "えー", "", null)];
  const lines = buildCsv({ quiz: nq, participants: ps, answers: [], asked: 1 }).slice(1).trim().split("\r\n");
  assert.ok(lines[1].startsWith(",,ぜっと,"));
  assert.ok(lines[2].startsWith(",,えー,"));
});

test("genCode は6桁の数字（先頭0なし）、parseJoin は全角やURLも受け付ける", () => {
  for (let i = 0; i < 50; i++) assert.match(genCode(), /^[1-9]\d{5}$/);
  assert.equal(parseJoin("１２３４５６"), "123456");
  assert.equal(parseJoin(" 123 456 "), "123456");
  assert.equal(parseJoin("https://x.github.io/quiz/#join=654321"), "654321");
  assert.equal(parseJoin("12345"), null);
  assert.equal(parseJoin("abcdef"), null);
});
