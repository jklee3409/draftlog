// 개발 모드: 확장을 설치한 Chromium을 띄우고, 파일을 저장하면 자동으로 다시 불러온다.
// - sidepanel/ 만 바뀌면 패널 페이지만 새로고침
// - 그 밖의 파일(manifest, background, content, lib, icons)이 바뀌면 확장을 다시 불러오고 채팅 탭도 새로고침
// 로그인 상태는 .dev-profile/ 에 남아서 다음 실행에도 유지된다.
// 실행: npm run dev   (처음 한 번: npx playwright install chromium)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WATCH = ["manifest.json", "background.js", "lib", "sidepanel", "content", "icons"];
const CHAT = /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai)\//;
const START_URL = process.argv[2] || "https://chatgpt.com/";

const ctx = await chromium.launchPersistentContext(path.join(EXT, ".dev-profile"), {
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: process.env.DEV_HEADLESS === "1",
  viewport: null,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
const extId = new URL(sw.url()).host; // 압축해제 확장의 ID는 폴더 경로로 정해져서 다시 불러와도 같다
const panelUrl = () => `chrome-extension://${extId}/sidepanel/index.html`;

// 사이드 패널은 자동화로 열 수 없어서 같은 화면을 탭으로 연다 (툴바 아이콘으로 여는 사이드 패널도 똑같이 동작)
const chat = ctx.pages()[0] || (await ctx.newPage());
await chat.goto(START_URL).catch(() => {});
await (await ctx.newPage()).goto(panelUrl());
await chat.bringToFront();

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
log(`확장 ID ${extId} · 파일을 저장하면 자동으로 다시 불러와요 (종료: Ctrl+C)`);

const isPanel = (p) => p.url().startsWith(`chrome-extension://${extId}/`);
async function reloadExtension() {
  // chrome://extensions의 새로고침 버튼과 같은 동작 (디스크에서 다시 읽음, 확장 페이지는 이때 닫힘)
  // 개발자 모드가 꺼져 있으면 다시 읽은 확장이 비활성화된다
  const mgr = await ctx.newPage();
  await mgr.goto("chrome://extensions/");
  await mgr.evaluate(async (id) => {
    await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
    await chrome.developerPrivate.reload(id, { failQuietly: false });
  }, extId);
  await mgr.close();
  for (const p of ctx.pages()) if (CHAT.test(p.url())) await p.reload().catch(() => {});
  if (!ctx.pages().some(isPanel)) await openPanel();
}
// 다시 켜지는 동안은 ERR_BLOCKED_BY_CLIENT가 나서 잠깐씩 기다렸다가 다시 연다
async function openPanel() {
  const page = await ctx.newPage();
  for (let i = 0; ; i++) {
    try { return await page.goto(panelUrl()); } catch (e) { if (i >= 20) throw e; }
    await new Promise((r) => setTimeout(r, 250));
  }
}
async function reloadPanels() {
  for (const p of ctx.pages()) if (isPanel(p)) await p.reload().catch(() => {});
}

let timer = null, changed = new Set(), busy = Promise.resolve();
for (const target of WATCH) {
  fs.watch(path.join(EXT, target), { recursive: true }, (_, file) => {
    changed.add(fs.statSync(path.join(EXT, target)).isDirectory() ? `${target}/${file}` : target);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const files = [...changed];
      changed = new Set();
      const panelOnly = files.every((f) => f.startsWith("sidepanel/"));
      busy = busy.then(async () => {
        try {
          if (panelOnly) await reloadPanels();
          else await reloadExtension();
          log(`${panelOnly ? "패널 새로고침" : "확장 다시 불러옴"} ← ${files.join(", ")}`);
        } catch (e) {
          log(`다시 불러오지 못했어요: ${e.message}`);
        }
      });
    }, 250);
  });
}

ctx.on("close", () => process.exit(0));
process.on("SIGINT", () => ctx.close().finally(() => process.exit(0)));
