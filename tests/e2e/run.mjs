// 확장을 실제로 설치한 Chromium에서 핵심 흐름을 확인하는 E2E 테스트.
// chatgpt.com 요청은 가짜 페이지(chatgpt-mock.html)로 가로챈다.
// 실행: npm run test:e2e   (처음 한 번: npx playwright install chromium)
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "../..");
const MOCK = fs.readFileSync(path.join(here, "chatgpt-mock.html"), "utf8");
const shots = process.env.E2E_SCREENSHOTS === "1";

const ctx = await chromium.launchPersistentContext(path.join(here, `.profile-${Date.now()}`), {
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const errors = [];
try {
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(sw.url()).host;
  await ctx.route("https://chatgpt.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: MOCK }));

  // 1) 패널에서 지원서·문항·첫 버전 만들기
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 420, height: 860 });
  panel.on("pageerror", (e) => errors.push("panel: " + e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('[data-act="addApp"]');
  await panel.fill("#fCompany", "한결전자");
  await panel.fill("#fRole", "백엔드 개발");
  await panel.click("#appForm button.primary");
  await panel.fill("#fQTitle", "지원 동기와 입사 후 목표를 기술해 주십시오.");
  await panel.fill("#fQLimit", "300");
  await panel.click("#qForm button.primary");
  await panel.fill("#draft", "저는 어릴 때부터 전자제품에 관심이 많았습니다. 열심히 배워서 회사에 기여하겠습니다.");
  await panel.fill("#commitMsg", "첫 초안");
  await panel.click('[data-act="commit"]');
  await panel.waitForTimeout(300);

  // 2) 채팅 페이지에서 답변 저장
  const chat = await ctx.newPage();
  chat.on("pageerror", (e) => errors.push("chat: " + e.message));
  await chat.goto("https://chatgpt.com/c/e2e");
  await chat.waitForTimeout(500);
  await chat.locator('[data-message-author-role="assistant"]').first().hover();
  const root = chat.locator("#draftlog-root");
  await root.locator("#hoverPill").click();
  if (shots) await chat.screenshot({ path: path.join(here, "save-card.png") });
  await root.locator("#dlSave").click();
  await chat.waitForTimeout(300);

  // 3) 드래그 선택 저장 버튼
  await chat.evaluate(() => {
    const p = document.querySelectorAll(".markdown p")[1];
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await chat.waitForTimeout(100);
  assert.ok(await root.locator("#selPill").isVisible(), "선택 영역 저장 버튼이 떠야 한다");

  // 4) 패널에서 요청문을 입력창에 넣기
  await chat.bringToFront();
  await panel.click('.tabs [data-id="ask"]');
  await panel.waitForTimeout(300);
  await panel.click('[data-act="insert"]');
  await panel.waitForTimeout(300);
  const composer = await chat.locator("#prompt-textarea").innerText();
  assert.match(composer, /\[문항\]\n지원 동기와 입사 후 목표/);

  // 5) 저장 결과 확인
  const db = await sw.evaluate(async () => (await chrome.storage.local.get("db")).db);
  const vers = Object.values(db.vers).sort((a, b) => a.createdAt - b.createdAt);
  assert.equal(vers.length, 2);
  assert.equal(vers[0].source, "me");
  assert.equal(vers[1].source, "gpt");
  assert.equal(vers[1].url, "https://chatgpt.com/c/e2e");
  assert.equal(Object.values(db.qs)[0].draft, vers[1].text, "초안도 저장한 답변으로 바뀌어야 한다");

  // 6) 두 버전 비교
  await panel.click('.tabs [data-id="vers"]');
  const boxes = panel.locator("[data-cmp]");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await panel.click('[data-act="cmpRun"]');
  assert.ok(await panel.locator("#diffBody ins").count(), "비교 화면에 추가 표시가 있어야 한다");
  if (shots) await panel.screenshot({ path: path.join(here, "diff.png") });

  assert.deepEqual(errors, []);
  console.log("E2E 통과: 지원서·문항 생성, 답변 저장, 선택 저장, 입력창 넣기, 비교");
} finally {
  await ctx.close();
  fs.rmSync(path.join(here, fs.readdirSync(here).find((f) => f.startsWith(".profile-")) || "__none__"), { recursive: true, force: true });
}
