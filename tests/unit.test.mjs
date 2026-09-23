import { test } from "node:test";
import assert from "node:assert/strict";

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
