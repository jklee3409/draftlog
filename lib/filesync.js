/*
 * PC 폴더 자동 저장 (File System Access API).
 * 사용자가 고른 폴더에 최신본 draftlog.json과 날짜별 스냅샷을 쓴다.
 * 기준 데이터는 chrome.storage.local이고 파일은 사본이다.
 * 패널(classic script)과 서비스 워커(module) 양쪽에서 쓰도록 globalThis.DLFile에 붙인다.
 */
(function (root) {
  "use strict";
  const MAIN = "draftlog.json";
  const SNAP_DIR = "backups";
  const KEEP_DAYS = 14;
  const MODE = { mode: "readwrite" };

  /* ---------- 폴더 핸들 보관 (IndexedDB, 패널과 서비스 워커가 같이 씀) ---------- */
  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("draftlog", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function kv(mode, fn) {
    const db = await idb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const req = fn(tx.objectStore("kv"));
      tx.oncomplete = () => { db.close(); resolve(req && req.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  const getDir = () => kv("readonly", (s) => s.get("dir")).catch(() => null);
  const setDir = (h) => kv("readwrite", (s) => s.put(h, "dir"));
  const clearDir = () => kv("readwrite", (s) => s.delete("dir"));

  /** granted | prompt | denied. request는 사용자 클릭 안에서만 (패널) */
  async function permission(dir, request) {
    let p = await dir.queryPermission(MODE);
    if (p === "prompt" && request) p = await dir.requestPermission(MODE);
    return p;
  }

  /* ---------- 읽기·쓰기 ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const day = (t) => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };
  const payload = (db, at) => ({ app: "draftlog", exportedAt: new Date(at).toISOString(), updatedAt: at, apps: db.apps, qs: db.qs, vers: db.vers });
  /** 파일끼리 비교할 때 쓰는 내용 지문 (시각은 빼고) */
  const same = (a, b) => JSON.stringify([a.apps, a.qs, a.vers]) === JSON.stringify([b.apps, b.qs, b.vers]);
  const counts = (d) => ({ apps: Object.keys(d.apps || {}).length, qs: Object.keys(d.qs || {}).length, vers: Object.keys(d.vers || {}).length });

  async function writeFile(dir, name, text) {
    const f = await dir.getFileHandle(name, { create: true });
    const w = await f.createWritable(); // 임시 파일에 쓰고 close할 때 한 번에 바꾼다
    await w.write(text);
    await w.close();
  }
  /** 폴더의 draftlog.json. 없으면 null, 깨졌으면 {broken:true} */
  async function readMain(dir) {
    let f;
    try { f = await dir.getFileHandle(MAIN); } catch { return null; }
    try {
      const data = JSON.parse(await (await f.getFile()).text());
      if (!data || !data.apps || !data.qs || !data.vers) return { broken: true };
      data.updatedAt = Number(data.updatedAt) || Date.parse(data.exportedAt) || 0;
      return data;
    } catch { return { broken: true }; }
  }
  /** 최신본과 오늘 스냅샷을 쓰고, 오래된 스냅샷을 지운다 */
  async function writeAll(dir, db, at) {
    const text = JSON.stringify(payload(db, at), null, 2);
    await writeFile(dir, MAIN, text);
    const snaps = await dir.getDirectoryHandle(SNAP_DIR, { create: true });
    await writeFile(snaps, `draftlog-${day(at)}.json`, text);
    const names = [];
    for await (const [name, h] of snaps.entries()) if (h.kind === "file" && /^draftlog-\d{8}\.json$/.test(name)) names.push(name);
    names.sort().reverse();
    for (const name of names.slice(KEEP_DAYS)) await snaps.removeEntry(name).catch(() => {});
  }

  /** 덮어쓰기·불러오기 직전 상태를 backups/에 따로 남긴다 (자동 정리 대상 아님) */
  async function keep(dir, label, data, at) {
    const d = new Date(at);
    const snaps = await dir.getDirectoryHandle(SNAP_DIR, { create: true });
    const name = `${label}-${day(at)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
    await writeFile(snaps, name, JSON.stringify(payload(data, Number(data.updatedAt) || at), null, 2));
    return `${SNAP_DIR}/${name}`;
  }

  root.DLFile = { MAIN, SNAP_DIR, KEEP_DAYS, getDir, setDir, clearDir, permission, readMain, writeAll, keep, same, counts, day };
})(globalThis);
