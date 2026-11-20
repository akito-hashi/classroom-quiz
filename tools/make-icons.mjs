// icons/icon.svg から PNG のアイコンを作る（Mac の Chrome を使う）。使い方: node tools/make-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.join(ROOT, "icons/icon.svg"), "utf8");
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage();
for (const size of [180, 192, 512]) {
  await page.setViewport({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join(ROOT, `icons/icon-${size}.png`), omitBackground: false });
}
await browser.close();
