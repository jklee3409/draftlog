// icons/src의 SVG로 확장 아이콘 PNG를 만든다. 작은 크기는 단순화한 logo-small.svg를 쓴다.
// 실행: npm run icons
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = (name) => fs.readFileSync(path.join(root, "icons/src", name), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [size, src] of [[16, "logo-small.svg"], [32, "logo-small.svg"], [48, "logo.svg"], [128, "logo.svg"]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(src)}`);
  await page.screenshot({ path: path.join(root, `icons/icon${size}.png`), omitBackground: true });
  console.log(`icons/icon${size}.png`);
}
await browser.close();
