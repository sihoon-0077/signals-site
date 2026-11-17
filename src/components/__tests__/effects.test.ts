// 효과 컴포넌트가 서버 렌더(테스트·JS 없음)에서 최종 상태를 그리고, 장식 레이어를 화면낭독기에서 숨기는지 본다.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Grain } from "@/components/effects/grain";
import { HashSettle, SKIP_IF_LATE_MS, settleFrame } from "@/components/effects/hash-settle";
import { LedgerGrid } from "@/components/effects/ledger-grid";
import { SealMark } from "@/components/effects/seal-mark";
import { SpotlightCard } from "@/components/effects/spotlight-card";

const HASH = "17a17335f93168ef66a150d193341672d5d084444af763d39a95642e6a745f77";
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

describe("효과 컴포넌트(서버 렌더)", () => {
  it("HashSettle은 최종 값을 글자 그대로 그리고, 요청했을 때만 hold 표시를 단다", () => {
    expect(renderToStaticMarkup(createElement(HashSettle, { value: HASH, className: "font-mono" }))).toBe(`<code class="font-mono">${HASH}</code>`);
    expect(renderToStaticMarkup(createElement(HashSettle, { value: "ab", holdUntilStart: true }))).toBe('<code data-settle="hold">ab</code>');
    expect(renderToStaticMarkup(createElement(HashSettle, { value: "ab", holdUntilStart: true, disabled: true }))).toBe("<code>ab</code>");
    expect(SKIP_IF_LATE_MS).toBeLessThan(1200); // CSS hold 해제(1.2초)보다 먼저 포기해야 JS와 CSS가 같은 프레임을 다투지 않는다
  });

  it("settleFrame은 길이·구분자·대소문자를 바꾸지 않고, 다 정착하면 원래 값이다", () => {
    const short = "03471677bcef4f88…c9fd";
    for (let s = 0; s < short.length; s++) {
      const f = settleFrame(short, s, seeded(s + 3));
      expect(f).toHaveLength(short.length);
      expect(f.slice(0, s)).toBe(short.slice(0, s));
      expect(f.indexOf("…")).toBe(short.indexOf("…"));
    }
    expect(settleFrame("ABCDEF-0123", 0, seeded(9))).toMatch(/^[0-9A-F]{6}-[0-9A-F]{4}$/);
    expect(settleFrame(HASH, HASH.length, seeded(1))).toBe(HASH);
  });

  it("장식 레이어는 aria-hidden이고 내용은 그대로다", () => {
    const card = renderToStaticMarkup(createElement(SpotlightCard, { as: "article", className: "rounded-2xl bg-card" }, createElement("p", null, "내용")));
    expect(card).toMatch(/^<article class="relative isolate overflow-hidden rounded-2xl bg-card">/);
    expect(card).toContain("<p>내용</p>");
    expect(card.match(/aria-hidden="true"/g)).toHaveLength(3);
    expect(renderToStaticMarkup(createElement(Grain, { className: "-z-10" }))).toMatch(/^<div aria-hidden="true"/);
    expect(renderToStaticMarkup(createElement(LedgerGrid))).toMatch(/^<div aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10/);
    expect(renderToStaticMarkup(createElement(SealMark, { delayMs: 400 }))).toMatch(/^<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"/);
  });
});
