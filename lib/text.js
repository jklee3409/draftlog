/*
 * 글자수 세기, 비교(diff), 채팅 답변 정리.
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
    return coalesce(ops);
  }

  // 짧은 공통 조각으로 잘게 쪼개진 변경을 한 덩어리로 묶는다
  function coalesce(ops) {
    const out = [];
    let k = 0;
    while (k < ops.length) {
      if (ops[k].t === "eq") { out.push(ops[k++]); continue; }
      let del = "", add = "";
      while (k < ops.length) {
        const o = ops[k];
        if (o.t === "del") { del += o.s; k++; continue; }
        if (o.t === "add") { add += o.s; k++; continue; }
        const next = ops[k + 1];
        if (next && next.t !== "eq" && o.s.replace(/\s/g, "").length <= 3) { del += o.s; add += o.s; k++; continue; }
        break;
      }
      if (del) out.push({ t: "del", s: del });
      if (add) out.push({ t: "add", s: add });
    }
    return out;
  }

  function diffStats(a, b, ops) {
    ops = ops || diff(a, b);
    const eq = ops.filter((o) => o.t === "eq").reduce((s, o) => s + o.s.replace(/\s/g, "").length, 0);
    return { add: String(b).replace(/\s/g, "").length - eq, del: String(a).replace(/\s/g, "").length - eq };
  }

  /** 채팅 답변에서 가져온 텍스트 정리: 코드펜스·감싼 따옴표 제거, 과한 빈 줄 정리 */
  function cleanText(t) {
    let s = String(t || "").replace(/\r/g, "").replace(/ /g, " ").trim();
    s = s.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
    s = s.replace(/^"""\s*/, "").replace(/\s*"""$/, "").trim();
    if (/^["“][\s\S]*["”]$/.test(s) && !/["”]\s*\n/.test(s.slice(1, -1))) s = s.slice(1, -1).trim();
    return s.replace(/\n{3,}/g, "\n\n");
  }

  function sourceOf(host) {
    host = String(host || "");
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("chatgpt.com") || host.includes("openai.com")) return "gpt";
    return "me";
  }

  const DL = { MODES, SOURCES, counts, countIn, unit, fmt, diff, diffStats, cleanText, sourceOf };
  root.DL = DL;
  if (typeof module !== "undefined" && module.exports) module.exports = DL;
})(typeof globalThis !== "undefined" ? globalThis : this);
