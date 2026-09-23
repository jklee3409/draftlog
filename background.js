import { apply, emptyDb } from "./lib/store.js";

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

/* ---------- 패널 ---------- */
// 툴바 아이콘을 누르면 사이드 패널이 열리게 한다
if (HAS_SIDE_PANEL) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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
});
