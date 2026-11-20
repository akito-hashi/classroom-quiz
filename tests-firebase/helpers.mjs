// 本物の Firebase に対するテスト用の補助。各テストは自分で作ったセッションを最後に削除する。
// 先生（匿名ログイン）は同一 IP で 1時間あたり約100件しか作れないので、2台を使い回す。生徒はログインしない。
import * as app from "firebase/app";
import * as auth from "firebase/auth";
import * as firestore from "firebase/firestore";
import { firebaseConfig } from "../firebase-config.js";
import { createStore } from "../store.js";

export const fb = { app, auth, firestore };
let n = 0;
const opened = [];
const hosts = [];

export async function host(i = 0) {
  if (!hosts[i]) {
    hosts[i] = (async () => {
      const s = createStore(fb, firebaseConfig, { appName: `h${i}-${Date.now()}`, auth: true });
      await s.init();
      opened.push(s);
      return s;
    })();
  }
  return hosts[i];
}

export async function student() {
  const s = createStore(fb, firebaseConfig, { appName: `s${n++}-${Date.now()}`, auth: false });
  await s.init();
  opened.push(s);
  return s;
}

export async function closeAll() {
  for (const s of opened) await s.close().catch(() => {});
}

// watch(cb) で届く値が pred を満たすまで待つ
export function waitFor(watch, pred, ms = 15000) {
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const t = setTimeout(() => { stop(); reject(new Error("waitFor: 時間切れ")); }, ms);
    stop = watch((v) => { if (pred(v)) { clearTimeout(t); stop(); resolve(v); } });
  });
}

export async function rejectsWithCode(promise, code) {
  try { await promise; } catch (e) { if (e.code === code) return; throw e; }
  throw new Error(`${code} になるはずが成功した`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
