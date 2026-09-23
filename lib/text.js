/*
 * 글자수 세기.
 * 사이드 패널과 콘텐츠 스크립트가 같이 쓰도록 전역 DL로 내보낸다 (콘텐츠 스크립트는 ES 모듈을 못 쓴다).
 */
(function (root) {
  "use strict";

  const MODES = { with: "공백 포함", without: "공백 제외", bytes: "바이트" };
  const SOURCES = { me: "나", gpt: "ChatGPT", claude: "Claude" };
  /** 공백 포함 / 공백 제외 / 바이트(한글 2, 영문·숫자·공백 1, 줄바꿈 2) */
  function counts(text) {
    const t = String(text || "").replace(/\r/g, "");
    let bytes = 0;
    for (const ch of t) bytes += ch === "\n" ? 2 : ch.codePointAt(0) > 127 ? 2 : 1;
    return { with: [...t].length, without: [...t.replace(/\s/g, "")].length, bytes };
  }
  const countIn = (t, mode) => counts(t)[mode || "with"];
  const unit = (mode) => (mode === "bytes" ? "byte" : "자");
  const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");

  const DL = { MODES, SOURCES, counts, countIn, unit, fmt };
  root.DL = DL;
  if (typeof module !== "undefined" && module.exports) module.exports = DL;
})(typeof globalThis !== "undefined" ? globalThis : this);
