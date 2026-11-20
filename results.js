// 生徒ごとの結果と CSV。ブラウザでは window.Results、Node では require で使う。
// participant: {pid, nickname, cls, num, status: active|pending|kicked|replaced, inheritsFrom, firstQ}
// answer: {pid, q, choice}
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Results = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LETTERS = ["A", "B", "C", "D"];

  // 引き継ぎ（inheritsFrom）をたどって、1人の生徒＝pid の束にまとめる。承認されなかった pending は除く
  function mergeChain(participants) {
    const byPid = new Map(participants.map((p) => [p.pid, p]));
    const replacedBy = new Map();
    for (const p of participants) if (p.inheritsFrom) replacedBy.set(p.inheritsFrom, p.pid);
    const chains = [];
    for (const p of participants) {
      if (p.inheritsFrom && byPid.has(p.inheritsFrom)) continue; // 束の先頭（いちばん古い pid）からたどる
      const pids = [p.pid];
      let cur = p.pid;
      while (replacedBy.has(cur)) { cur = replacedBy.get(cur); pids.push(cur); }
      const head = byPid.get(cur);
      if (head.status === "pending") continue;
      chains.push({ head, pids, firstQ: Math.min(...pids.map((x) => byPid.get(x).firstQ ?? 0)) });
    }
    return chains;
  }

  function choiceLabel(type, c) {
    if (c == null) return "";
    return type === "tf" ? (c === 0 ? "〇" : "×") : LETTERS[c] || "";
  }

  // 出題した asked 問について、生徒ごとの選択・正誤・正解数・分母（参加後の問題数）を出す
  function studentResults(quiz, participants, answers, asked) {
    const qs = quiz.questions.slice(0, asked);
    return mergeChain(participants).map(({ head, pids, firstQ }) => {
      const order = new Map(pids.map((p, i) => [p, i]));
      const pick = new Map();
      for (const a of answers) {
        if (!order.has(a.pid)) continue;
        const prev = pick.get(a.q);
        if (!prev || order.get(a.pid) >= order.get(prev.pid)) pick.set(a.q, a);
      }
      let score = 0;
      let counted = 0;
      const cells = qs.map((q, i) => {
        if (i < firstQ) return { choice: "未参加", mark: "未参加" };
        counted++;
        const a = pick.get(i);
        if (!a) return { choice: "", mark: "未回答" };
        const ok = a.choice === q.answer;
        if (ok) score++;
        return { choice: choiceLabel(q.type, a.choice), mark: ok ? "○" : "×" };
      });
      return { participant: head, cells, score, counted, kicked: head.status === "kicked" };
    });
  }

  function cell(v, text = false) {
    let s = v == null ? "" : String(v);
    if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // Excel で式として動かないように
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function buildCsv({ quiz, participants, answers, asked = quiz.questions.length }) {
    let rows = studentResults(quiz, participants, answers, asked);
    if (quiz.settings && quiz.settings.mode === "roster") {
      rows = rows.slice().sort((a, b) =>
        String(a.participant.cls).localeCompare(String(b.participant.cls), "ja", { numeric: true }) || (a.participant.num ?? 0) - (b.participant.num ?? 0));
    }
    const head = ["クラス", "出席番号", "ニックネーム"];
    for (let i = 1; i <= asked; i++) head.push(`Q${i}選択`, `Q${i}正誤`);
    head.push("正解数", "正解率", "退出");
    const lines = [head.join(",")];
    for (const r of rows) {
      const p = r.participant;
      const out = [cell(p.cls, true), cell(p.num), cell(p.nickname, true)];
      for (const c of r.cells) out.push(cell(c.choice), cell(c.mark));
      out.push(r.score, r.counted ? Math.round((r.score / r.counted) * 100) + "%" : "", r.kicked ? "退出" : "");
      lines.push(out.join(","));
    }
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  return { mergeChain, studentResults, buildCsv, choiceLabel };
});
