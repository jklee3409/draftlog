/*
 * 글자수 세기, 비교(diff), 프롬프트 만들기.
 * 사이드 패널과 콘텐츠 스크립트가 같이 쓰도록 전역 DL로 내보낸다 (콘텐츠 스크립트는 ES 모듈을 못 쓴다).
 */
(function (root) {
  "use strict";

  const MODES = { with: "공백 포함", without: "공백 제외", bytes: "바이트" };
  const SOURCES = { me: "나", gpt: "ChatGPT", claude: "Claude" };
  const ACTIONS = {
    feedback: { label: "첨삭", desc: "강점·고칠 점·예상 꼬리질문을 짚어달라고 해요. 다시 쓰지는 않아요." },
    fit: { label: "글자수", desc: "핵심 사례와 수치는 살리고 제한의 90~98%로 맞춰 다시 써달라고 해요." },
    polish: { label: "다듬기", desc: "내용은 그대로, 문장만 자연스럽고 간결하게 고쳐달라고 해요." },
    custom: { label: "직접", desc: "아래에 적은 요청대로 다시 써달라고 해요. 초안이 비어 있으면 새로 써요." },
  };

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

  /** 채팅창에 넣을 요청문. p = {action, company, role, jd, title, limit, mode, draft, extra} */
  function buildPrompt(p) {
    const text = String(p.draft || "").trim();
    const mode = p.mode || "with";
    const n = countIn(text, mode);
    const u = unit(mode);
    const lim = p.limit
      ? `${MODES[mode]} 기준 ${p.limit}${u} 이내` +
        (mode === "bytes" ? " (한글 2byte, 영문·숫자·공백 1byte, 줄바꿈 2byte)" : "") +
        (text ? ` — 현재 ${n}${u}` : "")
      : "제한 없음";

    let s =
      "너는 한국 기업 채용 자기소개서를 첨삭하는 전문 컨설턴트야. " +
      "내가 쓴 사실(경험, 수치, 고유명사)은 절대 지어내거나 바꾸지 마.\n\n";
    s += `[지원 정보]\n회사: ${p.company || "-"}\n직무: ${p.role || "-"}\n`;
    if (String(p.jd || "").trim()) s += `\n[채용공고·인재상 메모]\n${String(p.jd).trim().slice(0, 4000)}\n`;
    s += `\n[문항]\n${p.title}\n\n[글자수 제한]\n${lim}\n\n[현재 답변]\n"""\n${text || "(아직 비어 있음)"}\n"""\n\n[요청]\n`;

    const bodyOnly =
      "다시 쓴 답변은 설명 없이 본문만 한 덩어리로 보여줘. 바꾼 이유는 본문 뒤에 3줄 이내로 짧게 덧붙여도 돼.";
    switch (p.action) {
      case "feedback":
        s +=
          "채용 담당자 시선으로 평가해 줘.\n1. 한 줄 총평\n2. 잘한 점 2~3개\n" +
          "3. 고칠 점 3~5개 (원문 일부 인용 → 왜 문제인지 → 수정 예시)\n" +
          "4. 공고·인재상과의 연결이 약한 부분\n5. 면접에서 나올 만한 꼬리질문 2개\n답변 전체를 다시 쓰지는 마.";
        break;
      case "fit":
        s +=
          "글자수 제한의 90~98% 안에 들어오도록 다시 써 줘. 핵심 사례와 수치는 반드시 남기고, " +
          "중복되거나 추상적인 문장부터 줄여. 제한이 넉넉하면 구체적인 행동과 결과를 보강해. " + bodyOnly;
        break;
      case "polish":
        s +=
          "사례와 사실관계는 그대로 두고 문장을 자연스럽고 간결하게 다듬어 줘. 두괄식으로 쓰고, " +
          '뻔한 표현("열심히 하겠습니다", "많은 것을 배웠습니다")은 구체적인 표현으로 바꿔. 글자수 제한을 넘지 마. ' + bodyOnly;
        break;
      default:
        s +=
          (text
            ? "아래 추가 요청을 반영해서 다시 써 줘."
            : "현재 답변이 비어 있으니, 문항과 추가 요청을 바탕으로 초안을 써 줘. 내가 채워야 할 구체적 경험은 [대괄호]로 비워 둬.") +
          " 글자수 제한을 넘지 마. " + bodyOnly;
    }
    const extra = String(p.extra || "").trim();
    if (extra) s += `\n\n[추가 요청]\n${extra.slice(0, 1000)}`;
    return s;
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

  const DL = { MODES, SOURCES, ACTIONS, counts, countIn, unit, fmt, diff, diffStats, buildPrompt, cleanText, sourceOf };
  root.DL = DL;
  if (typeof module !== "undefined" && module.exports) module.exports = DL;
})(typeof globalThis !== "undefined" ? globalThis : this);
