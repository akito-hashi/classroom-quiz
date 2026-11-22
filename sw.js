// 一度開けば通信なしでも画面が出るようにする Service Worker。
// アプリのファイル：ネットから最新を取り、つながらないときだけ保存済みを使う。
// Firebase SDK（版を固定）：一度読み込んだものを保存して使う。
// ファイルを追加・改名したときは FILES を直し、VERSION の数字を上げる。
const VERSION = "v7";
const CACHE = "classroom-quiz-" + VERSION;
const SDK_CACHE = "classroom-quiz-sdk";
const SDK = "https://www.gstatic.com/firebasejs/11.10.0/";
const FILES = [
  "./", "./index.html", "./style.css",
  "./quizdata.js", "./tally.js", "./results.js", "./joincode.js", "./ui.js", "./library.js",
  "./host-edit.js", "./host-live.js", "./student.js", "./app.js", "./vendor/qrcode.js",
  "./store.js", "./cloud.js", "./firebase-config.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("classroom-quiz-") && k !== CACHE && k !== SDK_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.url.startsWith(SDK)) {
    event.respondWith(caches.open(SDK_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : null))
          .then((r) => r || Response.error()))
  );
});
