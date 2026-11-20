// 1問の集計とランキング。ブラウザでは window.Tally、Node では require で使う。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Tally = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // answers: [{pid, choice}]（参加中の生徒の回答だけを渡す）、activeCount: 参加中の人数
  function tally(type, answer, answers, activeCount) {
    const counts = Array(type === "tf" ? 2 : 4).fill(0);
    for (const a of answers) if (a.choice >= 0 && a.choice < counts.length) counts[a.choice]++;
    const answered = counts.reduce((s, n) => s + n, 0);
    const correct = counts[answer] || 0;
    return { counts, answered, correct, rate: answered ? correct / answered : null, unanswered: Math.max(0, activeCount - answered) };
  }

  function allAnswered(answers, activePids) {
    if (!activePids.length) return false;
    const got = new Set(answers.map((a) => a.pid));
    return activePids.every((p) => got.has(p));
  }

  // rows: [{nickname, score}] → 上位 n 位まで（同点は同じ順位）
  function ranking(rows, n = 5) {
    const sorted = rows.slice().sort((a, b) => b.score - a.score);
    const out = [];
    sorted.forEach((r, i) => {
      const rank = i > 0 && r.score === sorted[i - 1].score ? out[i - 1].rank : i + 1;
      out.push({ rank, nickname: r.nickname, score: r.score });
    });
    return out.filter((r) => r.rank <= n);
  }

  return { tally, allAnswered, ranking };
});
