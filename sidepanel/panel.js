/* Draft Log — 사이드 패널 */
(function () {
  "use strict";
  const { counts, countIn, unit, fmt, diff, diffStats, buildPrompt, MODES, SOURCES, ACTIONS, sourceOf } = window.DL;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHAT_HOSTS = ["chatgpt.com", "chat.openai.com", "claude.ai"];

  const S = {
    db: { apps: {}, qs: {}, vers: {} },
    active: null,          // 선택한 문항 id
    view: "list",          // list | q
    tab: "write",          // write | vers | ask
    search: "",
    pending: {},           // 저장 대기 중인 초안
    addingApp: false, addingQ: null, confirm: null,
    openVer: null, cmp: [], action: "feedback",
    target: null,          // {tabId, source, title}
    edQ: null, lastVerCount: null, importData: null,
  };

  /* ---------- 저장소 ---------- */
  function op(name, args) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "dl:op", op: name, args }, (r) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (r && r.ok) resolve(r.result);
        else reject(new Error((r && r.error) || "응답이 없어요."));
      });
    });
  }
  async function reload() {
    const { db, activeQ } = await chrome.storage.local.get(["db", "activeQ"]);
    S.db = db && db.apps ? db : { apps: {}, qs: {}, vers: {} };
    for (const id in S.pending) if (S.db.qs[id]) S.db.qs[id] = { ...S.db.qs[id], draft: S.pending[id] };
    if (activeQ && S.db.qs[activeQ]) S.active = activeQ;
    else if (S.active && !S.db.qs[S.active]) S.active = null;
  }
  async function mutate(name, args, okMsg) {
    try {
      const r = await op(name, args);
      await reload();
      if (okMsg) toast(okMsg);
      return r;
    } catch (e) {
      toast(e.message || "저장하지 못했어요.");
      return null;
    }
  }
  function setActive(id) {
    S.active = id;
    chrome.storage.local.set({ activeQ: id || null });
  }

  /* ---------- 조회 ---------- */
  const cur = () => (S.active && S.db.qs[S.active] ? { id: S.active, ...S.db.qs[S.active] } : null);
  const draftOf = (q) => (q ? S.pending[q.id] ?? q.draft ?? "" : "");
  const versOf = (qid) =>
    Object.entries(S.db.vers).filter(([, v]) => v.qid === qid).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.createdAt - b.createdAt);
  const qsOf = (aid) =>
    Object.entries(S.db.qs).filter(([, q]) => q.appId === aid).map(([id, q]) => ({ id, ...q })).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  const appsSorted = () =>
    Object.entries(S.db.apps).map(([id, a]) => ({ id, ...a })).sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || a.createdAt - b.createdAt);
  const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const vno = (qid, id) => versOf(qid).findIndex((v) => v.id === id) + 1;
  function dday(d) {
    if (!d) return null;
    const today = new Date(new Date().toDateString());
    const days = Math.round((new Date(d + "T00:00:00") - today) / 864e5);
    if (days < 0) return { txt: "마감", cls: "past" };
    return { txt: days === 0 ? "D-DAY" : "D-" + days, cls: days <= 3 ? "soon" : "" };
  }
  function when(ts) {
    const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ---------- 공통 UI ---------- */
  let toastT;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 3200);
  }
  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch { toast("복사하지 못했어요. 직접 선택해서 복사해 주세요."); }
  }
  function openDiff(a, b, la, lb) {
    const ops = diff(a, b), st = diffStats(a, b, ops);
    $("#dlgTitle").textContent = `${la} → ${lb}`;
    $("#dstat").innerHTML = `<span class="p">+${fmt(st.add)}</span> / <span class="m">−${fmt(st.del)}</span>자`;
    $("#diffBody").innerHTML = ops.map((o) => (o.t === "eq" ? esc(o.s) : o.t === "add" ? `<ins>${esc(o.s)}</ins>` : `<del>${esc(o.s)}</del>`)).join("");
    $("#overlay").hidden = false;
    $('#overlay [data-act="closeDiff"]').focus();
  }
  /** 다시 그려도 입력 중인 값과 포커스를 지킨다 */
  function preserve(root, fn) {
    const vals = {}, open = {};
    const act = document.activeElement;
    const actId = act && root.contains(act) ? act.id : null;
    const sel = actId && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
    root.querySelectorAll("input[id],textarea[id],select[id]").forEach((el) => { if (el.type !== "checkbox" && el.type !== "file") vals[el.id] = el.value; });
    root.querySelectorAll("details[id]").forEach((d) => (open[d.id] = d.open));
    fn();
    for (const id in vals) { const el = document.getElementById(id); if (el && root.contains(el) && el.dataset.keep !== "no") el.value = vals[id]; }
    for (const id in open) { const d = document.getElementById(id); if (d) d.open = open[id]; }
    if (actId) { const el = document.getElementById(actId); if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch {} } }
  }

  /* ---------- 그리기 ---------- */
  function render() {
    const main = $("#main");
    if (S.search.trim()) { S.edQ = null; main.innerHTML = searchHTML(); return; }
    const q = cur();
    if (S.view === "q" && q) {
      if (S.edQ !== q.id || !$("#draft")) {
        main.innerHTML = qShellHTML(q);
        S.edQ = q.id;
        renderPane();
      } else {
        syncHead(q);
        preserve($("#pane"), renderPane);
      }
      return;
    }
    S.edQ = null;
    preserve(main, () => (main.innerHTML = listHTML()));
  }

  function listHTML() {
    const apps = appsSorted();
    if (!apps.length) {
      return `<div class="welcome">
        <svg class="welcome-logo" aria-hidden="true"><use href="#i-logo"/></svg>
        <h2>AI와 고친 자소서,<br>버전으로 남겨요</h2>
        <p class="lead">ChatGPT·Claude 답변을 문항별 버전으로 저장하고, 무엇이 바뀌었는지 비교하세요.</p>
        <ol class="howto">
          <li><span><b>지원서</b>와 <b>문항</b>을 만들어요</span></li>
          <li><span><b>AI에게 묻기</b>로 첨삭 요청을 채팅창에 넣어요</span></li>
          <li><span>답변 위 <b>자소서에 저장</b>을 눌러요</span></li>
          <li><span><b>버전</b> 탭에서 바뀐 부분을 비교해요</span></li>
        </ol>
        ${S.addingApp ? appFormHTML() : `<button class="btn primary lg" data-act="addApp">${icon("plus")}첫 지원서 추가</button>`}</div>`;
    }
    let h = `<div class="list"><div class="list-head"><h2>지원서 <span class="num">${apps.length}</span></h2><button class="btn sm" data-act="addApp">${icon("plus")}지원서</button></div>`;
    if (S.addingApp) h += appFormHTML();
    for (const a of apps) {
      const d = dday(a.deadline), qs = qsOf(a.id);
      h += `<section class="app"><div class="app-head"><div class="app-name"><strong>${esc(a.company)}</strong><span class="role">${esc(a.role || "직무 미입력")}${a.deadline ? ` · ${a.deadline.slice(5).replace("-", "/")} 마감` : ""}</span></div>
        ${d ? `<span class="dday ${d.cls}">${d.txt}</span>` : ""}</div>`;
      if (qs.length) h += `<ul class="qlist">`;
      for (const q of qs) {
        const vs = versOf(q.id), c = countIn(draftOf(q), q.mode), pct = q.limit ? Math.min(100, (c / q.limit) * 100) : 0;
        const st = q.limit && c > q.limit ? "over" : q.limit && c / q.limit >= 0.9 ? "near" : "";
        h += `<li><button class="q-btn ${q.id === S.active ? "sel" : ""}" data-act="selQ" data-id="${q.id}"><span class="qt">${esc(q.title)}</span>
          <span class="qm"><span class="mini ${st}"><i style="width:${pct}%"></i></span><span class="num ${st}">${fmt(c)}${q.limit ? "/" + fmt(q.limit) : ""}${unit(q.mode)}</span>
          <span class="vc">${vs.some((v) => v.final) ? icon("star", "fin") : ""}v${vs.length}</span></span></button></li>`;
      }
      if (qs.length) h += `</ul>`;
      else if (S.addingQ !== a.id) h += `<p class="empty">아직 문항이 없어요.</p>`;
      if (S.addingQ === a.id) h += qFormHTML(a.id);
      const ck = "app:" + a.id;
      h += `<div class="app-foot"><button class="btn ghost sm" data-act="addQ" data-id="${a.id}">${icon("plus")}문항</button>
        <button class="btn ghost sm danger" data-act="delApp" data-id="${a.id}">${S.confirm === ck ? "한 번 더 누르면 삭제" : "지원서 삭제"}</button></div></section>`;
    }
    return h + `</div>`;
  }
  const appFormHTML = () => `<form class="form" id="appForm">
      <label>회사<input id="fCompany" required maxlength="80" placeholder="예: 한결전자"></label>
      <div class="row"><label>직무<input id="fRole" maxlength="80" placeholder="예: 백엔드 개발"></label>
      <label>마감일<input id="fDeadline" type="date"></label></div>
      <div class="acts"><button type="button" class="btn ghost" data-act="cancelApp">취소</button><button class="btn primary">추가</button></div></form>`;
  const qFormHTML = (appId) => `<form class="form" id="qForm" data-app="${appId}">
      <label>문항<textarea id="fQTitle" rows="3" required maxlength="500" placeholder="문항을 그대로 붙여넣으세요"></textarea></label>
      <div class="row"><label>글자수 제한<input id="fQLimit" type="number" min="0" step="50" value="1000"></label>
      <label>세는 기준<select id="fQMode"><option value="with">공백 포함</option><option value="without">공백 제외</option><option value="bytes">바이트</option></select></label></div>
      <div class="acts"><button type="button" class="btn ghost" data-act="cancelQ">취소</button><button class="btn primary">추가</button></div></form>`;

  function qShellHTML(q) {
    const a = S.db.apps[q.appId] || {};
    const n = versOf(q.id).length;
    return `<div class="qv">
      <button class="back" data-act="toList" title="목록으로">${icon("back")}<span>${esc(a.company)}${a.role ? " · " + esc(a.role) : ""}</span></button>
      <textarea class="q-title" id="qTitle" rows="2" maxlength="500" aria-label="문항">${esc(q.title)}</textarea>
      <div class="q-meta">
        <label class="field">제한 <input id="qLimit" type="number" min="0" step="50" value="${q.limit}"></label>
        <label class="field">기준 <select id="qMode">${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${q.mode === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <button class="btn ghost sm danger" data-act="delQ" id="delQBtn">문항 삭제</button>
      </div>
      <div class="tabs" role="tablist">
        <button role="tab" data-act="tab" data-id="write" aria-selected="${S.tab === "write"}">작성</button>
        <button role="tab" data-act="tab" data-id="vers" aria-selected="${S.tab === "vers"}" id="versTab">버전 <span class="num">${n}</span></button>
        <button role="tab" data-act="tab" data-id="ask" aria-selected="${S.tab === "ask"}">AI에게 묻기</button>
      </div>
      <div class="pane" id="pane"></div></div>`;
  }
  function syncHead(q) {
    const t = $("#qTitle"); if (t && document.activeElement !== t && t.value !== q.title) t.value = q.title;
    const l = $("#qLimit"); if (l && document.activeElement !== l) l.value = q.limit;
    const m = $("#qMode"); if (m && document.activeElement !== m) m.value = q.mode;
    const vt = $("#versTab"); if (vt) vt.innerHTML = `버전 <span class="num">${versOf(q.id).length}</span>`;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === S.tab)));
    const d = $("#delQBtn"); if (d) d.textContent = S.confirm === "q:" + q.id ? "한 번 더 누르면 삭제" : "문항 삭제";
  }

  function renderPane() {
    const q = cur(), pane = $("#pane");
    if (!q || !pane) return;
    if (S.tab === "write") {
      if (!$("#draft")) {
        pane.innerHTML = `<div class="sheet">
          <textarea class="draft" id="draft" data-keep="no" placeholder="직접 쓰거나, ChatGPT·Claude 답변을 저장하면 여기에 들어와요. 쓰는 내용은 자동으로 저장돼요." spellcheck="false"></textarea>
          <div class="meter"><div class="bar-g" id="barG"><i></i></div><div class="counts"><span class="main" id="cMain"></span><span class="sub" id="cSub"></span></div></div></div>
          <div class="state" id="state"><i></i><span></span></div>
          <div class="commit"><input id="commitMsg" maxlength="120" placeholder="무엇을 바꿨나요? (예: 두괄식으로 수정)">
            <button class="btn primary" data-act="commit" title="Ctrl/⌘+S">버전 저장</button><button class="btn" data-act="copyDraft">복사</button></div>`;
        $("#draft").value = draftOf(q);
      } else {
        const ta = $("#draft");
        if (document.activeElement !== ta && S.pending[q.id] === undefined && ta.value !== q.draft) ta.value = q.draft;
      }
      updateCounter();
    } else if (S.tab === "vers") {
      pane.innerHTML = versHTML(q);
    } else {
      pane.innerHTML = askHTML(q);
    }
  }

  function updateCounter() {
    const q = cur(), ta = $("#draft");
    if (!q || !ta) return;
    const text = ta.value, c = counts(text), mode = q.mode, n = c[mode], lim = q.limit;
    const pct = lim ? n / lim : 0;
    const bar = $("#barG");
    bar.className = "bar-g" + (pct > 1 ? " over" : pct >= 0.9 ? " near" : "");
    bar.firstElementChild.style.width = Math.min(100, pct * 100) + "%";
    const main = $("#cMain");
    main.className = "main" + (lim && n > lim ? " over" : "");
    main.textContent = lim
      ? `${fmt(n)} / ${fmt(lim)}${unit(mode)} · ${Math.round(pct * 100)}%${n > lim ? ` · ${fmt(n - lim)}${unit(mode)} 초과` : ""}`
      : `${fmt(n)}${unit(mode)}`;
    $("#cSub").innerHTML = `<span>공백 포함 <b class="num">${fmt(c.with)}</b></span><span>공백 제외 <b class="num">${fmt(c.without)}</b></span><span><b class="num">${fmt(c.bytes)}</b> byte</span>`;
    const vs = versOf(q.id), last = vs[vs.length - 1], st = $("#state");
    if (!last) { st.className = "state dirty"; st.lastElementChild.textContent = "아직 저장된 버전이 없어요"; }
    else if (last.text === text) { st.className = "state"; st.lastElementChild.textContent = `v${vs.length}과 같아요`; }
    else { st.className = "state dirty"; st.lastElementChild.textContent = `v${vs.length} 이후 고친 내용이 있어요 · 버전으로 저장하면 v${vs.length + 1}이 돼요`; }
  }

  function versHTML(q) {
    const vs = versOf(q.id);
    if (!vs.length) return `<div class="empty-state"><b>아직 버전이 없어요</b><p><b>작성</b> 탭에서 버전을 저장하거나, ChatGPT·Claude 답변 위의 <b>자소서에 저장</b>을 누르면 v1부터 쌓여요.</p></div>`;
    S.cmp = S.cmp.filter((id) => S.db.vers[id] && S.db.vers[id].qid === q.id);
    const draft = draftOf(q);
    let h = `<div class="hist-top"><span>${S.cmp.length === 2 ? "선택한 두 버전을 비교해요" : `비교할 버전 두 개를 체크하세요 <span class="num">${S.cmp.length}/2</span>`}</span>
      <button class="btn sm ${S.cmp.length === 2 ? "primary" : ""}" data-act="cmpRun" ${S.cmp.length === 2 ? "" : "disabled"}>${S.cmp.length === 2 ? `v${vno(q.id, S.cmp[0])} ↔ v${vno(q.id, S.cmp[1])} 비교` : "비교"}</button></div><ul class="vers">`;
    for (let i = vs.length - 1; i >= 0; i--) {
      const v = vs[i], prev = vs[i - 1], c = countIn(v.text, q.mode);
      const delta = prev ? c - countIn(prev.text, q.mode) : null;
      const ck = "v:" + v.id, lk = "load:" + v.id, same = v.text === draft;
      h += `<li class="ver ${v.final ? "final" : ""} ${S.cmp.includes(v.id) ? "picked" : ""}"><span class="dot"></span><div class="ver-card">
        <div class="ver-top"><span class="vno">v${i + 1}</span><span class="chip ${v.source}">${SOURCES[v.source] || v.source}</span>${v.final ? `<span class="chip final">${icon("star")}최종본</span>` : ""}${same ? '<span class="chip cur">작성 중</span>' : ""}
          <label class="cmpbox" title="비교할 버전으로 선택"><input type="checkbox" data-cmp="${v.id}" ${S.cmp.includes(v.id) ? "checked" : ""}>비교</label></div>
        <div class="ver-msg">${esc(v.message)}</div>
        <div class="ver-meta"><span>${when(v.createdAt)}</span><span>${fmt(c)}${unit(q.mode)}</span>${delta !== null ? `<span class="${delta >= 0 ? "p" : "m"}">${delta >= 0 ? "+" : "−"}${fmt(Math.abs(delta))}</span>` : ""}</div>
        ${S.openVer === v.id ? `<div class="ver-body">${esc(v.text)}</div>` : ""}
        <div class="ver-act">
          ${same ? "" : `<button class="btn ghost sm accent" data-act="verLoad" data-id="${v.id}" title="이 버전 내용을 작성 탭으로 가져와 이어서 고쳐요. 다른 버전은 그대로 남아요.">${S.confirm === lk ? "한 번 더 누르면 덮어써요" : "이 버전으로 이어 쓰기"}</button>
          <button class="btn ghost sm" data-act="verDiff" data-id="${v.id}" title="이 버전과 작성 탭의 글을 비교해요">지금 글과 비교</button>`}
          <button class="btn ghost sm" data-act="verOpen" data-id="${v.id}">${S.openVer === v.id ? "접기" : "보기"}</button>
          <span class="sp"></span>
          <button class="btn ghost sm ico ${v.final ? "on" : ""}" data-act="verFinal" data-id="${v.id}" title="${v.final ? "최종본 표시 해제" : "제출할 최종본으로 표시"}" aria-label="${v.final ? "최종본 해제" : "최종본으로 표시"}" aria-pressed="${Boolean(v.final)}">${icon("star")}</button>
          ${v.url ? `<a class="btn ghost sm ico" href="${esc(v.url)}" target="_blank" rel="noopener" title="이 답변이 나온 대화 열기" aria-label="대화 열기">${icon("link")}</a>` : ""}
          <button class="btn ghost sm ico danger" data-act="verDel" data-id="${v.id}" title="버전 삭제" aria-label="버전 삭제">${S.confirm === ck ? "한 번 더 누르면 삭제" : icon("trash")}</button>
        </div></div></li>`;
    }
    return h + `</ul><p class="hint foot">버전은 지워지지 않고 쌓여요. <b>이어 쓰기</b>로 예전 버전을 작성 탭에 가져와 고친 뒤 저장하면 새 버전이 돼요.</p>`;
  }

  function askHTML(q) {
    const a = S.db.apps[q.appId] || {};
    const t = S.target;
    const targetTxt = t ? `${SOURCES[t.source]} 탭에 넣어요 · ${esc(t.title || "")}` : "열린 ChatGPT·Claude 탭이 없어요. 요청문을 복사해서 붙여넣으세요.";
    return `<div class="ask">
      <div class="target ${t ? t.source : ""}"><i></i><span>${targetTxt}</span></div>
      <details class="jd" id="jdBox" ${a.jd ? "" : "open"}><summary>회사·공고 메모<small>이 지원서의 모든 문항에 함께 들어가요</small></summary>
        <textarea id="jd" rows="4" placeholder="채용공고의 주요 업무, 자격요건, 인재상을 붙여넣으세요.">${esc(a.jd || "")}</textarea></details>
      <h3>요청</h3>
      <div class="seg">${Object.entries(ACTIONS).map(([k, v]) => `<button data-act="action" data-id="${k}" aria-pressed="${S.action === k}">${v.label}</button>`).join("")}</div>
      <p class="adesc">${ACTIONS[S.action].desc}</p>
      <textarea id="extra" rows="2" placeholder="${S.action === "custom" ? "예: 리더십보다 문제 해결 과정을 강조해서 다시 써줘" : "추가로 바라는 점 (선택) 예: 두괄식 유지"}"></textarea>
      <div class="ask-btns"><button class="btn primary" data-act="insert">${t ? SOURCES[t.source] + " 입력창에 넣기" : "요청문 복사"}</button><button class="btn" data-act="copyPrompt">복사만</button></div>
      <ol class="steps">
        <li>입력창에 들어간 요청을 확인하고 <b>보내기</b>를 눌러요.</li>
        <li>답이 오면 답변에 마우스를 올려 <b>자소서에 저장</b>을 눌러요. 일부만 쓰려면 드래그해서 저장해요.</li>
        <li>이 문항의 새 버전으로 들어와요. <b>버전</b> 탭에서 비교해요.</li>
      </ol></div>`;
  }

  function searchHTML() {
    const term = S.search.trim().toLowerCase();
    const hits = [];
    for (const [qid, q] of Object.entries(S.db.qs)) {
      const a = S.db.apps[q.appId] || {};
      versOf(qid).forEach((v, i) => { if (v.text.toLowerCase().includes(term)) hits.push({ qid, vid: v.id, label: `v${i + 1}`, src: v.source, text: v.text, a, q, ts: v.createdAt }); });
      const d = draftOf({ id: qid, ...q });
      if (d.toLowerCase().includes(term) && !versOf(qid).some((v) => v.text === d)) hits.push({ qid, label: "작성 중", text: d, a, q, ts: q.updatedAt });
    }
    hits.sort((x, y) => y.ts - x.ts);
    const snip = (t) => {
      const i = t.toLowerCase().indexOf(term), s = Math.max(0, i - 40), e = Math.min(t.length, i + term.length + 70);
      const part = t.slice(s, e), k = part.toLowerCase().indexOf(term);
      return (s ? "…" : "") + esc(part.slice(0, k)) + "<mark>" + esc(part.slice(k, k + term.length)) + "</mark>" + esc(part.slice(k + term.length)) + (e < t.length ? "…" : "");
    };
    return `<div class="results"><div class="hist-top"><span>“${esc(S.search.trim())}” ${hits.length}건</span><button class="btn ghost sm" data-act="clearSearch">닫기</button></div>
      ${hits.map((h) => `<button class="res" data-act="goHit" data-q="${h.qid}" data-v="${h.vid || ""}">
        <span class="rh"><b>${esc(h.a.company || "")}</b><span>${esc(h.q.title.slice(0, 30))}${h.q.title.length > 30 ? "…" : ""}</span><span class="chip ${h.src || "me"}">${h.label}${h.src ? " · " + SOURCES[h.src] : ""}</span></span>
        <span class="rs">${snip(h.text)}</span></button>`).join("") || '<p class="hint">일치하는 답변이 없어요.</p>'}</div>`;
  }

  /* ---------- 초안 자동 저장 ---------- */
  let draftTimer = null, draftWrite = Promise.resolve();
  async function flushDraft(qid) {
    clearTimeout(draftTimer);
    if (!qid || S.pending[qid] === undefined) return;
    const v = S.pending[qid];
    await draftWrite;
    draftWrite = op("updateQ", { id: qid, patch: { draft: v } }).catch(() => toast("작성 중인 글을 저장하지 못했어요."));
    await draftWrite;
    if (S.pending[qid] === v) delete S.pending[qid];
  }
  function setDraft(text) {
    const q = cur(); if (!q) return;
    S.pending[q.id] = text;
    const ta = $("#draft"); if (ta) ta.value = text;
    updateCounter();
    flushDraft(q.id);
  }

  /* ---------- 채팅 탭 찾기 / 입력창에 넣기 ---------- */
  async function findTarget() {
    try {
      const tabs = await chrome.tabs.query({ active: true });
      const chat = tabs.filter((t) => t.url && CHAT_HOSTS.some((h) => new URL(t.url).hostname === h));
      let pick = null;
      if (chat.length) {
        const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null);
        pick = chat.find((t) => win && t.windowId === win.id) || chat[0];
      }
      const next = pick ? { tabId: pick.id, source: sourceOf(new URL(pick.url).hostname), title: pick.title } : null;
      const changed = JSON.stringify(next) !== JSON.stringify(S.target);
      S.target = next;
      if (changed && S.view === "q" && S.tab === "ask") preserve($("#pane"), renderPane);
    } catch { S.target = null; }
  }
  function currentPrompt() {
    const q = cur(), a = S.db.apps[q.appId] || {};
    return buildPrompt({ action: S.action, company: a.company, role: a.role, jd: a.jd, title: q.title, limit: q.limit, mode: q.mode, draft: draftOf(q), extra: ($("#extra")?.value || "").trim() });
  }
  function checkAsk() {
    const q = cur();
    const extra = ($("#extra")?.value || "").trim();
    if (S.action === "custom" && !extra) { toast("어떻게 고칠지 요청을 적어주세요."); return false; }
    if (S.action !== "custom" && !draftOf(q).trim()) { toast("작성 탭에 글이 있어야 해요. 없으면 ‘직접’으로 새로 써달라고 해보세요."); return false; }
    return true;
  }
  async function insertPrompt() {
    if (!checkAsk()) return;
    const text = currentPrompt();
    await findTarget();
    if (!S.target) return copy(text, "요청문을 복사했어요. ChatGPT나 Claude 입력창에 붙여넣으세요.");
    try {
      const r = await chrome.tabs.sendMessage(S.target.tabId, { type: "dl:insert", text });
      if (r && r.ok) toast(`${SOURCES[S.target.source]} 입력창에 넣었어요. 확인하고 보내세요.`);
      else throw new Error("no composer");
    } catch {
      copy(text, "입력창을 찾지 못해 복사했어요. 탭을 새로고침했거나 붙여넣어 주세요.");
    }
  }

  /* ---------- 확인이 필요한 삭제 ---------- */
  function arm(key) {
    S.confirm = key;
    render();
    setTimeout(() => { if (S.confirm === key) { S.confirm = null; render(); } }, 3000);
  }

  async function openQ(id, tab) {
    if (S.active && S.active !== id) await flushDraft(S.active);
    setActive(id);
    S.view = "q";
    S.tab = tab || "write";
    S.cmp = []; S.openVer = null; S.edQ = null;
    S.lastVerCount = versOf(id).length;
    render();
    scrollTo(0, 0);
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act, id = b.dataset.id, q = cur();
    switch (act) {
      case "menu": $("#menu").hidden = !$("#menu").hidden; b.setAttribute("aria-expanded", String(!$("#menu").hidden)); break;
      case "export": exportBackup(); break;
      case "doImport": {
        if (!S.importData) return;
        if (S.confirm !== "import") { S.confirm = "import"; b.textContent = "한 번 더 누르면 덮어써요"; setTimeout(() => { if (S.confirm === "import") { S.confirm = null; b.textContent = "지금 데이터를 이 백업으로 바꾸기"; } }, 3000); return; }
        S.confirm = null;
        const r = await mutate("import", { data: S.importData });
        S.importData = null; $("#importConfirm").innerHTML = ""; $("#menu").hidden = true;
        if (r) { toast(`불러왔어요: 지원서 ${r.apps}개, 문항 ${r.qs}개, 버전 ${r.vers}개`); S.view = "list"; setActive(null); render(); }
        break;
      }
      case "addApp": S.addingApp = true; S.addingQ = null; S.view = "list"; render(); $("#fCompany")?.focus(); break;
      case "cancelApp": S.addingApp = false; render(); break;
      case "addQ": S.addingQ = id; S.addingApp = false; render(); $("#fQTitle")?.focus(); break;
      case "cancelQ": S.addingQ = null; render(); break;
      case "selQ": openQ(id); break;
      case "toList": if (q) await flushDraft(q.id); S.view = "list"; render(); break;
      case "delApp":
        if (S.confirm !== "app:" + id) return arm("app:" + id);
        S.confirm = null;
        await mutate("delApp", { id }, "지원서를 삭제했어요");
        render(); break;
      case "delQ":
        if (!q) return;
        if (S.confirm !== "q:" + q.id) return arm("q:" + q.id);
        S.confirm = null; delete S.pending[q.id];
        await mutate("delQ", { id: q.id }, "문항을 삭제했어요");
        setActive(null); S.view = "list"; render(); break;
      case "tab":
        if (S.tab === "write" && q) await flushDraft(q.id);
        S.tab = id; syncHead(q); $("#pane").innerHTML = ""; renderPane();
        if (id === "ask") findTarget();
        break;
      case "commit": {
        if (!q) return;
        const text = $("#draft").value;
        if (!text.trim()) return toast("빈 답변은 버전으로 저장할 수 없어요.");
        await flushDraft(q.id);
        const r = await mutate("addVersion", { qid: q.id, text, message: $("#commitMsg").value.trim() || "수정", source: "me" });
        if (r) {
          toast(r.dup ? `v${r.n}과 내용이 같아서 새로 만들지 않았어요.` : `v${r.n} 저장했어요`);
          if (!r.dup) $("#commitMsg").value = "";
          S.lastVerCount = versOf(q.id).length;
          render();
        }
        break;
      }
      case "copyDraft": copy($("#draft").value, "답변을 복사했어요"); break;
      case "verOpen": S.openVer = S.openVer === id ? null : id; renderPane(); break;
      case "verDiff": openDiff(S.db.vers[id].text, draftOf(q), `v${vno(q.id, id)}`, "작성 중인 글"); break;
      case "verLoad": {
        const draft = draftOf(q), vs = versOf(q.id);
        // 버전으로 남기지 않은 글을 덮어쓸 때만 한 번 더 확인
        if (draft.trim() && !vs.some((v) => v.text === draft) && S.confirm !== "load:" + id) return arm("load:" + id);
        S.confirm = null;
        setDraft(S.db.vers[id].text);
        S.tab = "write"; syncHead(q); $("#pane").innerHTML = ""; renderPane();
        toast(`v${vno(q.id, id)} 내용을 작성 탭으로 가져왔어요. 고친 뒤 저장하면 v${vs.length + 1}이 돼요`);
        break;
      }
      case "verFinal": await mutate("setFinal", { id, on: !S.db.vers[id].final }); renderPane(); break;
      case "verDel":
        if (S.confirm !== "v:" + id) return arm("v:" + id);
        S.confirm = null; S.cmp = S.cmp.filter((x) => x !== id);
        await mutate("delVersion", { id }, "버전을 삭제했어요");
        S.lastVerCount = versOf(q.id).length; render(); break;
      case "cmpRun": {
        if (S.cmp.length !== 2) return;
        const [x, y] = S.cmp.map((i) => ({ id: i, ...S.db.vers[i] })).sort((m, n) => m.createdAt - n.createdAt);
        openDiff(x.text, y.text, `v${vno(q.id, x.id)}`, `v${vno(q.id, y.id)}`);
        break;
      }
      case "closeDiff": $("#overlay").hidden = true; break;
      case "action": S.action = id; preserve($("#pane"), renderPane); break;
      case "insert": insertPrompt(); break;
      case "copyPrompt": if (checkAsk()) copy(currentPrompt(), "요청문을 복사했어요"); break;
      case "clearSearch": S.search = ""; $("#search").value = ""; render(); break;
      case "goHit": {
        S.search = ""; $("#search").value = "";
        await openQ(b.dataset.q, b.dataset.v ? "vers" : "write");
        if (b.dataset.v) { S.openVer = b.dataset.v; renderPane(); }
        break;
      }
    }
  });

  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "appForm") {
      const r = await mutate("addApp", { company: $("#fCompany").value, role: $("#fRole").value, deadline: $("#fDeadline").value });
      if (r) { S.addingApp = false; S.addingQ = r.id; render(); $("#fQTitle")?.focus(); toast("지원서를 추가했어요. 이제 문항을 넣어주세요."); }
    }
    if (f.id === "qForm") {
      const r = await mutate("addQ", { appId: f.dataset.app, title: $("#fQTitle").value, limit: $("#fQLimit").value, mode: $("#fQMode").value });
      if (r) { S.addingQ = null; openQ(r.id); }
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "draft") {
      const q = cur(); if (!q) return;
      S.pending[q.id] = t.value;
      updateCounter();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => flushDraft(q.id), 700);
    }
    if (t.id === "search") { S.search = t.value; render(); }
  });

  document.addEventListener("change", async (e) => {
    const t = e.target, q = cur();
    if (t.dataset.cmp) {
      const id = t.dataset.cmp;
      S.cmp = t.checked ? [...S.cmp.filter((x) => x !== id), id].slice(-2) : S.cmp.filter((x) => x !== id);
      renderPane(); return;
    }
    if (t.id === "importFile") return readImport(t);
    if (!q) return;
    if (t.id === "qTitle" && t.value.trim() && t.value.trim() !== q.title) await mutate("updateQ", { id: q.id, patch: { title: t.value } });
    if (t.id === "qLimit") { await mutate("updateQ", { id: q.id, patch: { limit: t.value } }); updateCounter(); }
    if (t.id === "qMode") { await mutate("updateQ", { id: q.id, patch: { mode: t.value } }); updateCounter(); }
    if (t.id === "jd") await mutate("updateApp", { id: q.appId, patch: { jd: t.value } }, "공고 메모를 저장했어요");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#overlay").hidden) $("#overlay").hidden = true;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && S.view === "q" && S.tab === "write") {
      e.preventDefault();
      document.querySelector('[data-act="commit"]')?.click();
    }
  });
  $("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") $("#overlay").hidden = true; });

  /* ---------- 백업 ---------- */
  function exportBackup() {
    const data = JSON.stringify({ app: "draftlog", exportedAt: new Date().toISOString(), ...S.db }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    const d = new Date();
    a.href = url;
    a.download = `draftlog-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("백업 파일을 내려받았어요");
  }
  function readImport(input) {
    const file = input.files && input.files[0];
    input.value = "";
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result));
        if (!data.apps || !data.qs || !data.vers) throw new Error();
        S.importData = data;
        $("#importConfirm").innerHTML = `<p class="hint">지원서 ${Object.keys(data.apps).length}개 · 문항 ${Object.keys(data.qs).length}개 · 버전 ${Object.keys(data.vers).length}개. 지금 데이터는 사라져요.</p>
          <button class="btn danger" data-act="doImport">지금 데이터를 이 백업으로 바꾸기</button>`;
      } catch { toast("Draft Log 백업 파일이 아니에요."); }
    };
    r.readAsText(file);
  }

  /* ---------- 외부 변경(채팅 페이지에서 저장 등) ---------- */
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (!changes.db && !changes.activeQ) return;
    const before = S.active ? versOf(S.active).length : null;
    await reload();
    const q = cur();
    if (changes.activeQ && S.active && S.view !== "q") { /* 다른 곳에서 문항을 바꾼 경우 목록 강조만 갱신 */ }
    if (q && before !== null && S.lastVerCount !== null && versOf(q.id).length > S.lastVerCount) {
      const vs = versOf(q.id), last = vs[vs.length - 1];
      if (last.source !== "me") toast(`${SOURCES[last.source]} 답변이 v${vs.length}로 저장됐어요`);
      S.lastVerCount = vs.length;
    }
    render();
  });
  chrome.tabs.onActivated.addListener(findTarget);
  chrome.tabs.onUpdated.addListener((_, info) => { if (info.url || info.title || info.status === "complete") findTarget(); });
  if (chrome.windows && chrome.windows.onFocusChanged) chrome.windows.onFocusChanged.addListener(findTarget);
  window.addEventListener("pagehide", () => { if (S.active) flushDraft(S.active); });

  /* ---------- 시작 ---------- */
  (async () => {
    await reload();
    if (S.active) { S.view = "q"; S.lastVerCount = versOf(S.active).length; }
    render();
    findTarget();
  })();
})();
