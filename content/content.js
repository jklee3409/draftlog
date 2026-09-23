/*
 * ChatGPT·Claude 페이지에 붙는 부분.
 * - 답변에 마우스를 올리면 "자소서에 저장" 버튼
 * - 텍스트를 드래그하면 "선택 영역 저장" 버튼 (사이트 구조가 바뀌어도 동작하는 대비책)
 * 페이지 DOM(React)은 건드리지 않고, body 끝에 붙인 shadow DOM 하나에만 그린다.
 */
(function () {
  "use strict";
  if (window.__draftlogLoaded) return;
  window.__draftlogLoaded = true;

  const DL = window.DL;
  const HOST = location.hostname;
  const SITE = DL.sourceOf(HOST); // gpt | claude
  const SITE_NAME = DL.SOURCES[SITE];

  // 사이트가 구조를 바꿀 수 있어서 후보를 여러 개 둔다
  const MESSAGE_SELECTORS =
    SITE === "gpt"
      ? ['[data-message-author-role="assistant"]']
      : ["[data-is-streaming]", ".font-claude-response", ".font-claude-message"];

  /* ---------- shadow DOM ---------- */
  const host = document.createElement("div");
  host.id = "draftlog-root";
  host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483646;";
  const root = host.attachShadow({ mode: "open" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { --bg:#fff; --ink:#18201B; --muted:#5B675F; --line:#D5DCD5; --sunk:#EEF1ED; --accent:#1D6A4E; --accent-ink:#fff; --soft:#DDEEE5; --over:#B3261E;
      --shadow:0 2px 4px rgba(0,0,0,.08),0 12px 40px rgba(0,0,0,.18);
      font: 13px/1.5 "Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif; color: var(--ink); }
    @media (prefers-color-scheme: dark) { :host { --bg:#1B211E; --ink:#E2E8E4; --muted:#9AA69E; --line:#323B35; --sunk:#141916; --accent:#5DC39A; --accent-ink:#0B1D15; --soft:#1C3429; --over:#F2877E; } }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button, input, textarea, select { font: inherit; color: inherit; }
    .pill { position: fixed; display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px 5px 8px; border-radius: 999px;
      background: var(--accent); color: var(--accent-ink); border: 0; font-weight: 600; font-size: 12.5px; cursor: pointer; box-shadow: var(--shadow); white-space: nowrap; }
    .pill:hover { filter: brightness(1.08); }
    .pill .mark { width: 16px; height: 16px; border-radius: 4px; background: var(--accent-ink); color: var(--accent); display: grid; place-items: center; font-size: 11px; font-weight: 800; }
    .card { position: fixed; top: 72px; right: 20px; width: min(420px, calc(100vw - 24px)); max-height: calc(100vh - 96px); overflow: auto;
      background: var(--bg); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); padding: 14px 16px 16px; display: grid; gap: 10px; }
    .head { display: flex; align-items: center; gap: 8px; }
    .head b { flex: 1; font-size: 14px; }
    .x { border: 0; background: transparent; font-size: 18px; line-height: 1; color: var(--muted); cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    .x:hover { background: var(--sunk); color: var(--ink); }
    label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
    select, input[type=text], textarea { width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; background: var(--sunk); color: var(--ink); }
    textarea { min-height: 180px; resize: vertical; font-family: "Gowun Batang","AppleMyungjo","Batang",serif; font-size: 14px; line-height: 1.75; }
    .count { font: 12px ui-monospace, Menlo, Consolas, monospace; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .count.over b { color: var(--over); }
    .check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink); }
    .acts { display: flex; gap: 8px; justify-content: flex-end; }
    .btn { border: 1px solid var(--line); background: var(--bg); border-radius: 8px; padding: 7px 13px; cursor: pointer; font-size: 12.5px; }
    .btn:hover { border-color: var(--muted); }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
    .note { font-size: 12.5px; color: var(--muted); margin: 0; }
    .toast { position: fixed; right: 20px; bottom: 24px; background: var(--ink); color: var(--bg); padding: 10px 14px; border-radius: 10px; font-size: 13px; box-shadow: var(--shadow); max-width: 360px; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = `
    <button class="pill" id="hoverPill" hidden><span class="mark">자</span>자소서에 저장</button>
    <button class="pill" id="selPill" hidden><span class="mark">자</span>선택 영역 저장</button>
    <div class="card" id="card" role="dialog" aria-label="자소서 버전으로 저장" hidden></div>
    <div class="toast" id="toast" role="status" hidden></div>`;
  const $ = (id) => root.getElementById(id);
  document.documentElement.appendChild(host);

  // 카드 안에서 친 키가 채팅 페이지 단축키로 새지 않게 막는다
  for (const type of ["keydown", "keyup", "keypress", "paste", "copy", "cut", "input"]) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let toastT;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 3600);
  }
  const alive = () => { try { return Boolean(chrome.runtime && chrome.runtime.id); } catch { return false; } };

  /* ---------- 답변 찾기 ---------- */
  function findMessage(el) {
    if (!el || !el.closest || host.contains(el)) return null;
    for (const s of MESSAGE_SELECTORS) {
      const m = el.closest(s);
      if (m && !m.querySelector('[data-testid="user-message"]') && !m.closest('[data-testid="user-message"]')) return m;
    }
    return null;
  }
  function messageText(m) {
    return DL.cleanText(m.innerText || m.textContent || "");
  }

  /* ---------- 답변 위 버튼 ---------- */
  let hoverMsg = null, hideT = null;
  const hoverPill = $("hoverPill");
  function placeHover() {
    if (!hoverMsg || !hoverMsg.isConnected) return hideHover();
    const r = hoverMsg.getBoundingClientRect();
    if (r.bottom < 60 || r.top > innerHeight - 20) return (hoverPill.hidden = true);
    hoverPill.hidden = false;
    const w = hoverPill.offsetWidth || 120;
    hoverPill.style.top = Math.max(r.top + 6, 64) + "px";
    hoverPill.style.left = Math.min(Math.max(r.right - w - 6, 8), innerWidth - w - 8) + "px";
  }
  function hideHover() { hoverMsg = null; hoverPill.hidden = true; }
  document.addEventListener("mouseover", (e) => {
    if (host.contains(e.target) || e.composedPath().includes(host)) { clearTimeout(hideT); return; }
    const m = findMessage(e.target);
    if (m) {
      clearTimeout(hideT);
      if (m !== hoverMsg) { hoverMsg = m; placeHover(); }
    } else if (hoverMsg) {
      clearTimeout(hideT);
      hideT = setTimeout(hideHover, 500);
    }
  }, true);
  addEventListener("scroll", () => { if (hoverMsg) requestAnimationFrame(placeHover); if (!selPill.hidden) hideSel(); }, true);
  addEventListener("resize", () => hoverMsg && placeHover());
  hoverPill.addEventListener("mousedown", (e) => e.preventDefault());
  hoverPill.addEventListener("click", () => {
    if (!hoverMsg) return;
    const text = messageText(hoverMsg);
    hideHover();
    if (!text) return toast("답변 내용을 읽지 못했어요. 드래그해서 선택한 뒤 저장해 보세요.");
    openCard(text, `${SITE_NAME} 답변`);
  });

  /* ---------- 선택 영역 버튼 ---------- */
  const selPill = $("selPill");
  let selText = "";
  function hideSel() { selPill.hidden = true; }
  function checkSelection() {
    const sel = getSelection();
    const text = sel ? sel.toString() : "";
    if (!sel || sel.isCollapsed || text.trim().length < 5 || !$("card").hidden) return hideSel();
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (node && node.closest && node.closest('[contenteditable="true"], textarea, input')) return hideSel();
    selText = text;
    const rects = sel.getRangeAt(0).getClientRects();
    const r = rects[rects.length - 1] || sel.getRangeAt(0).getBoundingClientRect();
    selPill.hidden = false;
    const w = selPill.offsetWidth || 120;
    selPill.style.top = Math.min(r.bottom + 8, innerHeight - 40) + "px";
    selPill.style.left = Math.min(Math.max(r.right - w, 8), innerWidth - w - 8) + "px";
  }
  document.addEventListener("mouseup", (e) => { if (!e.composedPath().includes(host)) setTimeout(checkSelection, 10); }, true);
  document.addEventListener("keyup", (e) => { if (e.shiftKey) setTimeout(checkSelection, 10); }, true);
  document.addEventListener("selectionchange", () => { const s = getSelection(); if (!s || s.isCollapsed) hideSel(); });
  selPill.addEventListener("mousedown", (e) => e.preventDefault());
  selPill.addEventListener("click", () => {
    const text = DL.cleanText(selText);
    hideSel();
    if (text) openCard(text, `${SITE_NAME} 답변 일부`);
  });

  /* ---------- 저장 카드 ---------- */
  let cardText = "";
  async function openCard(text, defaultMsg) {
    if (!alive()) return toast("확장 프로그램이 업데이트됐어요. 페이지를 새로고침해 주세요.");
    cardText = text;
    const { db, activeQ } = await chrome.storage.local.get(["db", "activeQ"]);
    const apps = (db && db.apps) || {}, qs = (db && db.qs) || {};
    const card = $("card");
    const qEntries = Object.entries(qs);
    if (!qEntries.length) {
      card.innerHTML = `<div class="head"><b>저장할 문항이 없어요</b><button class="x" data-act="close" aria-label="닫기">×</button></div>
        <p class="note">Draftlog 패널에서 지원서와 문항을 먼저 만들어 주세요. 툴바의 Draftlog 아이콘을 눌러도 열려요.</p>
        <div class="acts"><button class="btn primary" data-act="openPanel">패널 열기</button></div>`;
      card.hidden = false;
      return;
    }
    const groups = Object.entries(apps)
      .sort((a, b) => (a[1].deadline || "9999").localeCompare(b[1].deadline || "9999"))
      .map(([aid, a]) => {
        const items = qEntries.filter(([, q]) => q.appId === aid).sort((x, y) => x[1].order - y[1].order);
        if (!items.length) return "";
        return `<optgroup label="${esc(a.company)}${a.role ? " · " + esc(a.role) : ""}">${items
          .map(([qid, q]) => `<option value="${qid}" ${qid === activeQ ? "selected" : ""}>${esc(q.title.length > 46 ? q.title.slice(0, 46) + "…" : q.title)}</option>`)
          .join("")}</optgroup>`;
      }).join("");
    card.innerHTML = `
      <div class="head"><b>자소서 버전으로 저장</b><button class="x" data-act="close" aria-label="닫기">×</button></div>
      <label>저장할 문항<select id="dlQ">${groups}</select></label>
      <label>내용 <textarea id="dlText" spellcheck="false"></textarea></label>
      <div class="count" id="dlCount"></div>
      <label>메모<input type="text" id="dlMsg" maxlength="120"></label>
      <label class="check"><input type="checkbox" id="dlDraft" checked> 패널의 초안도 이 내용으로 바꾸기</label>
      <div class="acts"><button class="btn" data-act="close">취소</button><button class="btn primary" data-act="save" id="dlSave">버전으로 저장</button></div>`;
    $("dlText").value = text;
    $("dlMsg").value = defaultMsg;
    card.hidden = false;
    card._qs = qs;
    card._vers = (db && db.vers) || {};
    updateCount();
    $("dlText").focus();
    $("dlText").setSelectionRange(0, 0);
    $("dlText").scrollTop = 0;
  }
  function updateCount() {
    const card = $("card");
    const q = card._qs && card._qs[$("dlQ")?.value];
    if (!q) return;
    const t = $("dlText").value, n = DL.countIn(t, q.mode), c = DL.counts(t);
    const nVers = Object.values(card._vers).filter((v) => v.qid === $("dlQ").value).length;
    const el = $("dlCount");
    el.className = "count" + (q.limit && n > q.limit ? " over" : "");
    el.innerHTML = `<span><b>${DL.fmt(n)}</b> / ${DL.fmt(q.limit)}${DL.unit(q.mode)} (${DL.MODES[q.mode]})</span><span>공백 제외 ${DL.fmt(c.without)} · ${DL.fmt(c.bytes)}byte</span>`;
    $("dlSave").textContent = `v${nVers + 1}로 저장`;
  }
  function closeCard() { $("card").hidden = true; $("card").innerHTML = ""; }

  root.addEventListener("input", (e) => { if (e.target.id === "dlText") updateCount(); });
  root.addEventListener("change", (e) => { if (e.target.id === "dlQ") updateCount(); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCard();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !$("card").hidden) $("dlSave")?.click();
  });
  root.addEventListener("click", async (e) => {
    const b = e.target.closest && e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "close") return closeCard();
    if (act === "openPanel") {
      if (!alive()) return toast("페이지를 새로고침해 주세요.");
      const r = await chrome.runtime.sendMessage({ type: "dl:openPanel" }).catch(() => null);
      if (!r || !r.ok) toast("툴바의 Draftlog 아이콘을 눌러 패널을 열어주세요.");
      return closeCard();
    }
    if (act === "save") {
      if (!alive()) return toast("확장 프로그램이 업데이트됐어요. 페이지를 새로고침해 주세요.");
      const qid = $("dlQ").value;
      const text = DL.cleanText($("dlText").value);
      if (!text) return toast("빈 내용은 저장할 수 없어요.");
      b.disabled = true;
      const r = await chrome.runtime
        .sendMessage({ type: "dl:op", op: "addVersion", args: { qid, text, message: $("dlMsg").value, source: SITE, url: location.href, setDraft: $("dlDraft").checked } })
        .catch(() => null);
      b.disabled = false;
      if (!r || !r.ok) return toast((r && r.error) || "저장하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.");
      const title = ($("card")._qs[qid] || {}).title || "";
      closeCard();
      chrome.storage.local.set({ activeQ: qid });
      toast(r.result.dup ? `마지막 버전(v${r.result.n})과 같아서 새로 만들지 않았어요.` : `“${title.slice(0, 18)}${title.length > 18 ? "…" : ""}”에 v${r.result.n}로 저장했어요`);
    }
  });

  /* ---------- 우클릭 메뉴 ---------- */
  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "dl:openSave") {
      const sel = getSelection();
      const text = DL.cleanText((sel && sel.toString()) || msg.fallbackText || "");
      if (text) openCard(text, `${SITE_NAME} 답변 일부`);
      send({ ok: Boolean(text) });
    }
  });
})();
