/*
 * 저장소 연산. 백그라운드(서비스 워커)만 이 함수로 chrome.storage의 db를 고친다.
 * 순수 함수라서 node 테스트에서도 그대로 돌릴 수 있다.
 */

export const SCHEMA = 1;
export const emptyDb = () => ({ schema: SCHEMA, apps: {}, qs: {}, vers: {} });

const uid = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))
    .replace(/-/g, "").slice(0, 16);
const str = (v, max) => String(v ?? "").slice(0, max);
const MODES = ["with", "without", "bytes"];
const SOURCES = ["me", "gpt", "claude"];

export const versionsOf = (db, qid) =>
  Object.entries(db.vers).filter(([, v]) => v.qid === qid).map(([id, v]) => ({ id, ...v })).sort((a, b) => a.createdAt - b.createdAt);

function need(obj, id, what) {
  if (!obj[id]) throw new Error(`${what}을(를) 찾을 수 없어요.`);
  return obj[id];
}

/** db를 제자리에서 고치고 결과를 돌려준다. now는 테스트용. */
export function apply(db, op, a = {}, now = Date.now()) {
  switch (op) {
    case "addApp": {
      const company = str(a.company, 80).trim();
      if (!company) throw new Error("회사 이름을 적어주세요.");
      const id = uid();
      db.apps[id] = { company, role: str(a.role, 80).trim(), deadline: str(a.deadline, 10), jd: "", createdAt: now };
      return { id };
    }
    case "updateApp": {
      const app = need(db.apps, a.id, "지원서");
      const p = a.patch || {};
      if ("company" in p && str(p.company, 80).trim()) app.company = str(p.company, 80).trim();
      if ("role" in p) app.role = str(p.role, 80).trim();
      if ("deadline" in p) app.deadline = str(p.deadline, 10);
      if ("jd" in p) app.jd = str(p.jd, 8000);
      return {};
    }
    case "delApp": {
      for (const [qid, q] of Object.entries(db.qs)) if (q.appId === a.id) apply(db, "delQ", { id: qid }, now);
      delete db.apps[a.id];
      return {};
    }
    case "addQ": {
      need(db.apps, a.appId, "지원서");
      const title = str(a.title, 500).trim();
      if (!title) throw new Error("문항을 적어주세요.");
      const id = uid();
      const order = Object.values(db.qs).filter((q) => q.appId === a.appId).length + 1;
      db.qs[id] = {
        appId: a.appId, title,
        limit: Math.max(0, Math.min(20000, parseInt(a.limit, 10) || 0)),
        mode: MODES.includes(a.mode) ? a.mode : "with",
        order, draft: "", createdAt: now, updatedAt: now,
      };
      return { id };
    }
    case "updateQ": {
      const q = need(db.qs, a.id, "문항");
      const p = a.patch || {};
      if ("title" in p && str(p.title, 500).trim()) q.title = str(p.title, 500).trim();
      if ("limit" in p) q.limit = Math.max(0, Math.min(20000, parseInt(p.limit, 10) || 0));
      if ("mode" in p && MODES.includes(p.mode)) q.mode = p.mode;
      if ("draft" in p) q.draft = str(p.draft, 20000);
      q.updatedAt = now;
      return {};
    }
    case "delQ": {
      for (const [vid, v] of Object.entries(db.vers)) if (v.qid === a.id) delete db.vers[vid];
      delete db.qs[a.id];
      return {};
    }
    case "addVersion": {
      const q = need(db.qs, a.qid, "문항");
      const text = str(a.text, 20000);
      if (!text.trim()) throw new Error("빈 내용은 저장할 수 없어요.");
      const list = versionsOf(db, a.qid);
      const last = list[list.length - 1];
      if (last && last.text === text) {
        if (a.setDraft) { q.draft = text; q.updatedAt = now; }
        return { dup: true, n: list.length };
      }
      const id = uid();
      db.vers[id] = {
        qid: a.qid, text,
        message: str(a.message, 120).trim() || "수정",
        source: SOURCES.includes(a.source) ? a.source : "me",
        url: /^https:\/\//.test(a.url || "") ? str(a.url, 500) : "",
        createdAt: now, final: false,
      };
      if (a.setDraft) { q.draft = text; q.updatedAt = now; }
      return { id, n: list.length + 1 };
    }
    case "setFinal": {
      const v = need(db.vers, a.id, "버전");
      if (a.on) for (const o of Object.values(db.vers)) if (o.qid === v.qid) o.final = false;
      v.final = Boolean(a.on);
      return {};
    }
    case "delVersion": {
      delete db.vers[a.id];
      return {};
    }
    case "import": {
      const next = validate(a.data);
      db.apps = next.apps; db.qs = next.qs; db.vers = next.vers; db.schema = SCHEMA;
      return { apps: Object.keys(db.apps).length, qs: Object.keys(db.qs).length, vers: Object.keys(db.vers).length };
    }
    default:
      throw new Error("알 수 없는 작업: " + op);
  }
}

/** 백업 파일 검사. 모양이 틀리면 던진다. 참조가 끊긴 항목은 버린다. */
export function validate(data) {
  if (!data || typeof data !== "object" || !data.apps || !data.qs || !data.vers)
    throw new Error("Draft Log 백업 파일이 아니에요.");
  const out = emptyDb();
  for (const [id, a] of Object.entries(data.apps)) {
    if (!a || !str(a.company, 80).trim()) continue;
    out.apps[id] = { company: str(a.company, 80), role: str(a.role, 80), deadline: str(a.deadline, 10), jd: str(a.jd, 8000), createdAt: Number(a.createdAt) || 0 };
  }
  for (const [id, q] of Object.entries(data.qs)) {
    if (!q || !out.apps[q.appId] || !str(q.title, 500).trim()) continue;
    out.qs[id] = {
      appId: q.appId, title: str(q.title, 500), limit: Math.max(0, parseInt(q.limit, 10) || 0),
      mode: MODES.includes(q.mode) ? q.mode : "with", order: Number(q.order) || 0, draft: str(q.draft, 20000),
      createdAt: Number(q.createdAt) || 0, updatedAt: Number(q.updatedAt) || 0,
    };
  }
  for (const [id, v] of Object.entries(data.vers)) {
    if (!v || !out.qs[v.qid] || !str(v.text, 20000).trim()) continue;
    out.vers[id] = {
      qid: v.qid, text: str(v.text, 20000), message: str(v.message, 120) || "수정",
      source: SOURCES.includes(v.source) ? v.source : "me", url: /^https:\/\//.test(v.url || "") ? str(v.url, 500) : "",
      createdAt: Number(v.createdAt) || 0, final: Boolean(v.final),
    };
  }
  return out;
}
