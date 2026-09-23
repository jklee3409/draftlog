import { apply, emptyDb } from "./lib/store.js";
import "./lib/filesync.js";

const F = globalThis.DLFile;

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
  p.then(scheduleFileSync, () => {});
  return p;
}

/* ---------- PC 폴더 자동 저장 ----------
 * 상태는 storage의 fileSync에 둔다: { on, name, state, at, error, file }
 *   state: ok | permission(다시 허용 필요) | conflict(폴더에 다른 데이터) | error
 *   at: 마지막으로 쓴 시각. 폴더 파일의 updatedAt이 이보다 뒤면 다른 곳에서 쓴 것 → 덮어쓰지 않고 conflict
 */
let fileTimer = null, fileChain = Promise.resolve();
function scheduleFileSync() {
  clearTimeout(fileTimer);
  fileTimer = setTimeout(() => fileSync(), 1500);
}
async function setFileState(patch) {
  const { fileSync: cur } = await chrome.storage.local.get("fileSync");
  const next = { ...(cur || {}), ...patch };
  if (JSON.stringify(next) !== JSON.stringify(cur)) await chrome.storage.local.set({ fileSync: next });
  return next;
}
/** mode: "auto" | "overwrite"(폴더 파일을 지금 데이터로) | "adopt"(폴더 파일을 지금 데이터로 불러오기) */
function fileSync(mode = "auto") {
  const p = fileChain.then(async () => {
    const dir = await F.getDir();
    if (!dir) return setFileState({ on: false, state: "off", error: "" });
    const on = { on: true, name: dir.name };
    try {
      if ((await F.permission(dir, false)) !== "granted") return setFileState({ ...on, state: "permission", error: "" });
      const { fileSync: st } = await chrome.storage.local.get("fileSync");
      const file = await F.readMain(dir);
      let db = await load();
      const now = Date.now();
      if (mode === "adopt") {
        if (!file || file.broken) throw new Error("폴더의 draftlog.json을 읽을 수 없어요.");
        await F.keep(dir, "before-load", { ...db, updatedAt: now }, now);
        await run("import", { data: file });
        db = await load();
      } else if (file && (file.broken || (file.updatedAt > ((st && st.at) || 0) && !F.same(file, db)))) {
        if (mode !== "overwrite") {
          const info = file.broken ? { broken: true } : { updatedAt: file.updatedAt, ...F.counts(file) };
          return setFileState({ ...on, state: "conflict", error: "", file: info });
        }
        if (!file.broken) await F.keep(dir, "before-overwrite", file, now);
      }
      await F.writeAll(dir, db, now);
      return setFileState({ ...on, state: "ok", at: now, error: "", file: null });
    } catch (e) {
      if (e && e.name === "NotAllowedError") return setFileState({ ...on, state: "permission", error: "" });
      return setFileState({ ...on, state: "error", error: String((e && e.message) || e) });
    }
  });
  fileChain = p.catch(() => {});
  return p;
}
chrome.runtime.onStartup.addListener(() => fileSync());

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
  if (msg.type === "dl:file") {
    const done = (r) => send({ ok: true, result: r });
    if (msg.act === "off") {
      clearTimeout(fileTimer);
      F.clearDir().then(() => setFileState({ on: false, state: "off", name: "", at: 0, error: "", file: null })).then(done, (e) => send({ ok: false, error: String(e.message || e) }));
    } else if (msg.act === "connect") {
      // 새 폴더는 이전 폴더의 저장 시각과 무관하므로, 기존 파일이 있으면 무조건 확인받는다
      clearTimeout(fileTimer);
      setFileState({ at: 0, file: null }).then(() => fileSync()).then(done, (e) => send({ ok: false, error: String(e.message || e) }));
    } else {
      clearTimeout(fileTimer);
      fileSync(msg.act === "overwrite" || msg.act === "adopt" ? msg.act : "auto").then(done, (e) => send({ ok: false, error: String(e.message || e) }));
    }
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
