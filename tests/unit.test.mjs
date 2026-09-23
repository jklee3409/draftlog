import { test } from "node:test";
import assert from "node:assert/strict";

await import("../lib/text.js");
const DL = globalThis.DL;

test("counts: 공백 포함/제외/바이트", () => {
  const c = DL.counts("안녕 AI\n팀");
  assert.deepEqual(c, { with: 7, without: 5, bytes: 11 });
});
