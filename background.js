import { apply, emptyDb } from "./lib/store.js";

const CHAT_PATTERNS = ["https://chatgpt.com/*", "https://chat.openai.com/*", "https://claude.ai/*"];
const HAS_SIDE_PANEL = Boolean(chrome.sidePanel && chrome.sidePanel.setPanelBehavior);

/* ---------- 저장소: 모든 쓰기는 여기서 한 줄로 세워 처리한다 ---------- */
let chain = Promise.resolve();
async function load() {
  const { db } = await chrome.storage.local.get("db");
  return db && db.apps ? db : emptyDb();
}
function run(op, args) {
  const p = chain.then(async () => {
    const db = await load();
    const result = apply(db, op, args);
    await chrome.storage.local.set({ db });
    return result;
  });
  chain = p.catch(() => {});
  return p;
}

/* ---------- 패널 열기 ---------- */
async function openPanelWindow() {
  const url = chrome.runtime.getURL("sidepanel/index.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.windows.create({ url, type: "popup", width: 460, height: 860 });
}

if (HAS_SIDE_PANEL) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} else {
  // 사이드 패널을 지원하지 않는 브라우저(일부 Chromium 계열)는 작은 창으로 연다
  chrome.action.onClicked.addListener(() => openPanelWindow());
}

/* ---------- 우클릭 메뉴 ---------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "dl-save-selection",
      title: "선택한 텍스트를 자소서 버전으로 저장",
      contexts: ["selection"],
      documentUrlPatterns: CHAT_PATTERNS,
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "dl-save-selection" || !tab || tab.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type: "dl:openSave", fallbackText: info.selectionText || "" }).catch(() => {});
});

/* ---------- 메시지 ---------- */
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "dl:op") {
    run(msg.op, msg.args).then(
      (result) => send({ ok: true, result }),
      (e) => send({ ok: false, error: String((e && e.message) || e) }),
    );
    return true;
  }
  if (msg.type === "dl:openPanel") {
    const tabId = sender.tab && sender.tab.id;
    const done = (ok) => send({ ok });
    if (HAS_SIDE_PANEL && tabId != null) {
      chrome.sidePanel.open({ tabId }).then(() => done(true), () => done(false));
    } else {
      openPanelWindow().then(() => done(true), () => done(false));
    }
    return true;
  }
});
