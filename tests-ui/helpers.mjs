// 画面テストの共通部品：アプリを localhost で配信し、Mac の Chrome を puppeteer-core で動かす。
// APP_BASE を付けると、公開先に対して動かす。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { KnownDevices } from "puppeteer-core";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };

let server;
let browser;
export let BASE = process.env.APP_BASE || "";

export async function start() {
  if (!BASE) {
    server = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const f = path.join(ROOT, u === "/" ? "index.html" : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(f).pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    BASE = `http://localhost:${server.address().port}/`;
  }
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
}

export async function stop() {
  await browser?.close();
  server?.close();
}

// 別々の端末に相当する、まっさらなブラウザ（localStorage も IndexedDB も別）
export async function openPage(hash = "", { device, viewport, beforeLoad } = {}) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  if (device) await p.emulate(KnownDevices[device]);
  if (viewport) await p.setViewport(viewport);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  if (beforeLoad) await p.evaluateOnNewDocument(beforeLoad);
  await p.goto(BASE + hash, { waitUntil: "load" });
  return p;
}

export const text = (p, sel) => p.$eval(sel, (e) => e.textContent.trim());
export const count = (p, sel) => p.$$eval(sel, (es) => es.length);
export async function waitText(p, sel, pattern, timeout = 15000) {
  await p.waitForFunction((s, src) => [...document.querySelectorAll(s)].some((e) => new RegExp(src).test(e.textContent)), { timeout }, sel, pattern.source ?? pattern);
}
// ダウンロード先のフォルダに、名前が pattern に合うファイルができるまで待って中身を返す
export async function waitFile(dir, pattern, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const f = fs.readdirSync(dir).find((n) => pattern.test(n));
    if (f) return fs.readFileSync(path.join(dir, f), "utf8");
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("ダウンロードされたファイルが見つかりません: " + pattern);
}
// ページの横はみ出しがないこと
export const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
export async function setVal(p, sel, v) {
  await p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
}
