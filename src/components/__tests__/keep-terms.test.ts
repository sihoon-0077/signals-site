// keepTerms(기술 용어 줄바꿈 방지)가 글자를 하나도 바꾸지 않고, 정해 둔 용어만 nowrap span으로 감싸는지 본다.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { keepTerms } from "@/components/keep-terms";

const html = (text: string) => renderToStaticMarkup(createElement("p", null, keepTerms(text)));
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, "");

describe("keepTerms", () => {
  it("용어만 nowrap으로 감싸고, 태그를 빼면 원래 문장과 글자 그대로 같다", () => {
    const s = "원문을 이어 SHA-256 지문을 만들고 RFC 3161 서명을 받아 비트코인(OpenTimestamps)에 남깁니다. 다시 SHA-256을 계산합니다.";
    const out = html(s);
    expect(out.match(/<span class="whitespace-nowrap">SHA-256<\/span>/g)).toHaveLength(2);
    expect(out).toContain('<span class="whitespace-nowrap">RFC 3161</span>');
    expect(out).toContain('<span class="whitespace-nowrap">(OpenTimestamps)에</span>');
    expect(textOf(out)).toBe(s);
  });

  it("용어가 없으면 문자열을 그대로 돌려준다(불필요한 span 없음)", () => {
    expect(keepTerms("매일 18시(KST) 무렵")).toBe("매일 18시(KST) 무렵");
  });
});
