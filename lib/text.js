/*
 * 글자수 세기, 비교(diff).
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

  function tokens(t) {
    return String(t || "").match(/\s+|[.,!?·"'()]|[^\s.,!?·"'()]+/g) || [];
  }

  /** 어절 단위 LCS diff → [{t:'eq'|'add'|'del', s}] */
  function diff(a, b) {
    const A = tokens(a), B = tokens(b), n = A.length, m = B.length;
    if (n * m > 6e6) return [{ t: "del", s: a }, { t: "add", s: b }];
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    const push = (t, s) => {
      const l = ops[ops.length - 1];
      if (l && l.t === t) l.s += s; else ops.push({ t, s });
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { push("eq", A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", A[i++]);
      else push("add", B[j++]);
    }
    while (i < n) push("del", A[i++]);
    while (j < m) push("add", B[j++]);
    return ops;
  }

  const DL = { MODES, SOURCES, counts, countIn, unit, fmt, diff };
  root.DL = DL;
  if (typeof module !== "undefined" && module.exports) module.exports = DL;
})(typeof globalThis !== "undefined" ? globalThis : this);
