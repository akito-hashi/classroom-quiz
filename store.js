// Firestore とのやり取り。Firebase の部品は外から渡す（ブラウザは gstatic、テストは npm）。
// sessions/{code}                 … 授業（正解は発表まで入れない）
// sessions/{code}/participants/{pid}
// sessions/{code}/seats/{クラス-番号} … 成績用の出席番号の予約
// sessions/{code}/answers/{q}_{pid}
export function createStore(fb, config, { appName, auth: useAuth = false } = {}) {
  const F = fb.firestore;
  let app, db, auth;
  let uid = null;
  const s = {};

  s.init = async () => {
    app = fb.app.initializeApp(config, appName);
    db = F.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
    s.db = db;
    if (useAuth) {
      auth = fb.auth.getAuth(app);
      const cred = auth.currentUser ? { user: auth.currentUser } : await fb.auth.signInAnonymously(auth);
      uid = cred.user.uid;
      s.uid = uid;
    }
  };
  s.close = async () => { await F.terminate(db); await fb.app.deleteApp(app); };

  const sess = (code) => F.doc(db, "sessions", code);
  const sub = (code, name, id) => (id ? F.doc(db, "sessions", code, name, id) : F.collection(db, "sessions", code, name));
  const rows = (snap) => snap.docs.map((d) => d.data());
  const randomId = (n = 20) => {
    const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => a[b % a.length]).join("");
  };

  // ---------- 先生 ----------
  s.createSession = async (settings, qCount) => {
    for (let i = 0; i < 8; i++) {
      const code = String(100000 + Math.floor(Math.random() * 900000));
      const ok = await F.runTransaction(db, async (tx) => {
        if ((await tx.get(sess(code))).exists()) return false;
        tx.set(sess(code), {
          owner: uid, status: "lobby", settings: { mode: settings.mode, timeLimit: settings.timeLimit, ranking: !!settings.ranking },
          qIndex: -1, qCount, current: null, startedAt: null, timeLimit: 0, reveal: null, final: null, createdAt: F.serverTimestamp(),
        });
        return true;
      }).catch((e) => { if (e.code === "permission-denied") return false; throw e; }); // 他の先生が使用中のコード
      if (ok) return code;
    }
    throw new Error("参加コードを作れませんでした。もう一度お試しください");
  };
  s.getSession = async (code) => { const d = await F.getDoc(sess(code)); return d.exists() ? d.data() : null; };
  s.showQuestion = (code, qIndex, current, timeLimit) =>
    F.updateDoc(sess(code), { status: "question", qIndex, current, startedAt: F.serverTimestamp(), timeLimit, reveal: null });
  s.closeQuestion = (code) => F.updateDoc(sess(code), { status: "closed" });
  s.reveal = (code, data) => F.updateDoc(sess(code), { status: "revealed", reveal: data });
  s.finish = (code, data) => F.updateDoc(sess(code), { status: "finished", final: data, current: null });
  s.watchParticipants = (code, cb) => F.onSnapshot(sub(code, "participants"), (q) => cb(rows(q)));
  s.watchAnswers = (code, qIndex, cb) => F.onSnapshot(F.query(sub(code, "answers"), F.where("q", "==", qIndex)), (q) => cb(rows(q)));
  s.getAllAnswers = async (code) => rows(await F.getDocs(sub(code, "answers")));
  s.getParticipants = async (code) => rows(await F.getDocs(sub(code, "participants")));
  s.deleteSession = async (code) => {
    for (const name of ["answers", "participants", "seats"]) {
      const snap = await F.getDocs(sub(code, name));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const b = F.writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    }
    await F.deleteDoc(sess(code));
  };

  // 同じ出席番号での再参加を許可する：座席を新しい pid に付け替え、前の pid の回答を引き継ぐ
  s.approveRejoin = async (code, newPid) => {
    const me = (await F.getDoc(sub(code, "participants", newPid))).data();
    if (!me || me.status !== "pending") throw new Error("許可待ちの参加者ではありません");
    const seat = await F.getDoc(sub(code, "seats", me.seat));
    const oldPid = seat.exists() ? seat.data().pid : null;
    const b = F.writeBatch(db);
    b.set(sub(code, "seats", me.seat), { pid: newPid });
    b.update(sub(code, "participants", newPid), { status: "active", inheritsFrom: oldPid });
    if (oldPid) b.update(sub(code, "participants", oldPid), { status: "replaced" });
    await b.commit();
  };
  s.kick = (code, pid) => F.updateDoc(sub(code, "participants", pid), { status: "kicked" });
  s.requireRename = (code, pid) => F.updateDoc(sub(code, "participants", pid), { renameRequired: true });
  // 自分の古いセッション（hours 時間より前に作ったもの）を消す
  s.cleanupOld = async (hours = 24) => {
    const snap = await F.getDocs(F.query(F.collection(db, "sessions"), F.where("owner", "==", uid)));
    const limit = Date.now() - hours * 3600e3;
    for (const d of snap.docs) {
      const t = d.data().createdAt?.toMillis?.() ?? 0;
      if (t <= limit) await s.deleteSession(d.id);
    }
  };

  // ---------- 生徒 ----------
  s.getMe = async (code, pid) => { const d = await F.getDoc(sub(code, "participants", pid)); return d.exists() ? d.data() : null; };
  s.getMyAnswer = async (code, q, pid) => { const d = await F.getDoc(sub(code, "answers", `${q}_${pid}`)); return d.exists() ? d.data() : null; };
  s.rename = (code, pid, nickname) => F.updateDoc(sub(code, "participants", pid), { nickname, renameRequired: false });
  s.watchSession = (code, cb, onError) => F.onSnapshot(sess(code), (d) => cb(d.exists() ? d.data() : null), onError);
  s.watchMe = (code, pid, cb, onError) => F.onSnapshot(sub(code, "participants", pid), (d) => cb(d.exists() ? d.data() : null), onError);

  // 参加する。pid を渡し、その参加者がまだいれば、その人として戻る
  s.join = async (code, { nickname, cls = "", num = null }, pid) => {
    if (pid) {
      const me = await F.getDoc(sub(code, "participants", pid));
      if (me.exists() && me.data().status !== "replaced") return { pid, status: me.data().status, me: me.data() };
    }
    const session = await s.getSession(code);
    if (!session) { const e = new Error("参加コードが見つかりません"); e.code = "not-found"; throw e; }
    if (session.status === "finished") { const e = new Error("このクイズは終わりました"); e.code = "finished"; throw e; }
    pid = randomId();
    const firstQ = session.status === "lobby" ? 0 : session.status === "question" ? session.qIndex : session.qIndex + 1;
    const base = { pid, nickname, cls: "", num: null, seat: null, status: "active", inheritsFrom: null, renameRequired: false, firstQ, joinedAt: F.serverTimestamp() };
    if (session.settings.mode !== "roster") {
      await F.setDoc(sub(code, "participants", pid), base);
      return { pid, status: "active" };
    }
    const seat = `${cls}-${num}`;
    const p = { ...base, cls, num, seat };
    try {
      const b = F.writeBatch(db);
      b.set(sub(code, "participants", pid), p);
      b.set(sub(code, "seats", seat), { pid });
      await b.commit();
      return { pid, status: "active" };
    } catch (e) {
      if (e.code !== "permission-denied") throw e;
      // 出席番号が使われている → 先生の許可待ちで参加する
      await F.setDoc(sub(code, "participants", pid), { ...p, status: "pending" });
      return { pid, status: "pending" };
    }
  };

  // 回答を送る。8秒で返事がなければ timeout（届いていない可能性）
  s.answer = (code, q, pid, choice) => {
    const write = F.setDoc(sub(code, "answers", `${q}_${pid}`), { pid, q, choice, at: F.serverTimestamp() });
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => { const e = new Error("timeout"); e.code = "timeout"; rej(e); }, 8000); });
    return Promise.race([write, timeout]).finally(() => clearTimeout(t));
  };

  return s;
}
