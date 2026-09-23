import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, emptyDb, versionsOf } from "../lib/store.js";

await import("../lib/text.js");
const DL = globalThis.DL;

test("counts: 공백 포함/제외/바이트", () => {
  const c = DL.counts("안녕 AI\n팀");
  assert.deepEqual(c, { with: 7, without: 5, bytes: 11 });
});

test("diff: 원문과 수정본을 그대로 복원한다", () => {
  const a = "저는 백엔드 개발자가 되고 싶습니다. 열심히 하겠습니다.";
  const b = "저는 안정적인 서버를 만드는 백엔드 개발자가 되겠습니다.";
  const ops = DL.diff(a, b);
  assert.equal(ops.filter((o) => o.t !== "add").map((o) => o.s).join(""), a);
  assert.equal(ops.filter((o) => o.t !== "del").map((o) => o.s).join(""), b);
});

test("buildPrompt: 문항·제한·공고·요청이 들어간다", () => {
  const p = DL.buildPrompt({ action: "fit", company: "한결전자", role: "백엔드", jd: "Kafka 우대", title: "지원동기", limit: 700, mode: "with", draft: "초안입니다", extra: "두괄식" });
  assert.match(p, /공백 포함 기준 700자 이내 — 현재 5자/);
  assert.match(p, /Kafka 우대/);
  assert.match(p, /\[추가 요청\]\n두괄식/);
});

test("cleanText: 코드펜스·감싼 따옴표를 벗기고 빈 줄을 줄인다", () => {
  assert.equal(DL.cleanText("```\n본문\n\n\n\n둘째\n```"), "본문\n\n둘째");
  assert.equal(DL.cleanText("“본문입니다”"), "본문입니다");
});

test("sourceOf", () => {
  assert.equal(DL.sourceOf("chatgpt.com"), "gpt");
  assert.equal(DL.sourceOf("claude.ai"), "claude");
});

test("store: 지원서→문항→버전, 중복 버전은 건너뛴다", () => {
  const db = emptyDb();
  const { id: appId } = apply(db, "addApp", { company: "한결전자", role: "백엔드", deadline: "2026-10-01" });
  const { id: qid } = apply(db, "addQ", { appId, title: "지원동기", limit: 700, mode: "with" });
  const v1 = apply(db, "addVersion", { qid, text: "첫 답", source: "gpt", url: "https://chatgpt.com/c/1", setDraft: true }, 1);
  assert.equal(v1.n, 1);
  assert.equal(db.qs[qid].draft, "첫 답");
  const dup = apply(db, "addVersion", { qid, text: "첫 답", source: "me" }, 2);
  assert.equal(dup.dup, true);
  apply(db, "addVersion", { qid, text: "둘째 답", source: "claude" }, 3);
  assert.equal(versionsOf(db, qid).length, 2);
  assert.equal(versionsOf(db, qid)[1].source, "claude");
});

test("store: 최종본은 문항당 하나", () => {
  const db = emptyDb();
  const { id: appId } = apply(db, "addApp", { company: "A" });
  const { id: qid } = apply(db, "addQ", { appId, title: "Q" });
  const a = apply(db, "addVersion", { qid, text: "1" }, 1).id;
  const b = apply(db, "addVersion", { qid, text: "2" }, 2).id;
  apply(db, "setFinal", { id: a, on: true });
  apply(db, "setFinal", { id: b, on: true });
  assert.equal(db.vers[a].final, false);
  assert.equal(db.vers[b].final, true);
});

test("store: 지원서 삭제 시 문항·버전도 지운다", () => {
  const db = emptyDb();
  const { id: appId } = apply(db, "addApp", { company: "A" });
  const { id: qid } = apply(db, "addQ", { appId, title: "Q" });
  apply(db, "addVersion", { qid, text: "1" });
  apply(db, "delApp", { id: appId });
  assert.deepEqual([Object.keys(db.apps).length, Object.keys(db.qs).length, Object.keys(db.vers).length], [0, 0, 0]);
});
