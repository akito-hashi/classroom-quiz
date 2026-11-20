// ブラウザで Firebase を読み込み、store を用意する。使うときに初めて読み込まれる（import("./cloud.js")）。
import * as app from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import * as auth from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import * as firestore from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { createStore } from "./store.js";

const ready = {};

// kind: "host"（先生：匿名ログインする）/ "student"（ログインしない）
export function getStore(kind) {
  if (!ready[kind]) {
    ready[kind] = (async () => {
      const s = createStore({ app, auth, firestore }, firebaseConfig, { appName: kind, auth: kind === "host" });
      await s.init();
      return s;
    })().catch((e) => { delete ready[kind]; throw e; });
  }
  return ready[kind];
}
