// クイズのデータ（問題の形・チェック・書き出し/読み込み）。ブラウザでは window.QuizData、Node では require で使う。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.QuizData = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const FORMAT = "classroom-quiz/1";

  function uid() {
    const a = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  function newQuiz() {
    return { id: uid(), title: "", settings: { mode: "nick", timeLimit: 20, ranking: false }, questions: [] };
  }

  function newQuestion(type = "four") {
    return normalizeQuestion({ id: uid(), type, text: "", choices: [], answer: 0, explanation: "", imageId: null });
  }

  // 形式に合わせて選択肢と正解をそろえる（〇×に変えたあとに残った3つ目・4つ目は捨てる）
  function normalizeQuestion(q) {
    const type = q.type === "tf" ? "tf" : "four";
    const n = type === "tf" ? 2 : 4;
    const choices = type === "tf" ? ["〇", "×"] : Array.from({ length: 4 }, (_, i) => String((q.choices || [])[i] ?? ""));
    let answer = Number.isInteger(q.answer) ? q.answer : 0;
    if (answer < 0 || answer >= n) answer = 0;
    return { ...q, type, choices, answer, text: String(q.text ?? ""), explanation: String(q.explanation ?? ""), imageId: q.imageId || null };
  }

  function validateQuiz(quiz) {
    const errs = [];
    if (!quiz.questions || quiz.questions.length === 0) errs.push("問題が1問もありません");
    (quiz.questions || []).forEach((raw, i) => {
      const q = normalizeQuestion(raw);
      const label = `${i + 1}問目`;
      if (!q.text.trim()) errs.push(`${label}：問題文が空です`);
      else if (q.type === "four" && q.choices.some((c) => !c.trim())) errs.push(`${label}：空の選択肢があります`);
    });
    return errs;
  }

  // 生徒に配る形（正解と解説は入れない）
  function publicQuestion(raw) {
    const q = normalizeQuestion(raw);
    return { type: q.type, text: q.text, choices: q.choices.slice(), hasImage: !!q.imageId };
  }

  function exportQuiz(quiz, images = {}) {
    const used = {};
    quiz.questions.forEach((q) => { if (q.imageId && images[q.imageId]) used[q.imageId] = images[q.imageId]; });
    return JSON.stringify({ format: FORMAT, quiz, images: used });
  }

  function importQuiz(json) {
    let data;
    try { data = JSON.parse(json); } catch { data = null; }
    if (!data || data.format !== FORMAT || !data.quiz || !Array.isArray(data.quiz.questions)) throw new Error("クイズのファイルではありません");
    const src = data.images || {};
    const images = {};
    const idMap = {};
    const quiz = {
      ...newQuiz(),
      title: String(data.quiz.title ?? ""),
      settings: { ...newQuiz().settings, ...(data.quiz.settings || {}) },
      questions: data.quiz.questions.map((q) => {
        let imageId = null;
        if (q.imageId && src[q.imageId]) {
          imageId = idMap[q.imageId] || (idMap[q.imageId] = uid());
          images[imageId] = src[q.imageId];
        }
        return normalizeQuestion({ ...q, id: uid(), imageId });
      }),
    };
    return { quiz, images };
  }

  return { newQuiz, newQuestion, normalizeQuestion, validateQuiz, publicQuestion, exportQuiz, importQuiz, uid };
});
