// ホーム画面に追加できること・一度開けば通信なしでも画面が出ること（npm run test:ui）
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { start, stop, openPage, BASE } from "./helpers.mjs";

before(start);
after(stop);

test("manifest とアイコンが読め、Service Worker が登録される", async () => {
  const p = await openPage("");
  const man = await p.evaluate(async () => (await fetch(document.querySelector("link[rel=manifest]").href)).json());
  assert.equal(man.name, "教室クイズ");
  for (const icon of man.icons) {
    const ok = await p.evaluate(async (src) => (await fetch(src)).ok, icon.src);
    assert.ok(ok, icon.src);
  }
  const scope = await p.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  assert.equal(scope, BASE);
});

test("一度開いたあとは、通信が切れていても先生の画面と参加画面が開ける", async () => {
  const p = await openPage("");
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await p.reload({ waitUntil: "load" }); // Service Worker の管理下で読み直し、ファイルを保存させる
  await p.waitForFunction(() => navigator.serviceWorker.controller);
  await p.setOfflineMode(true);
  await p.goto(BASE + "#host", { waitUntil: "load" });
  await p.waitForSelector("[data-act=new-quiz]");
  await p.goto(BASE + "?x#", { waitUntil: "load" });
  await p.waitForSelector("#home-code");
  await p.setOfflineMode(false);
});
