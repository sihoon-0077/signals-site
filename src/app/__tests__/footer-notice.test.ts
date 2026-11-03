// 모든 화면에 붙는 푸터 고지가 빠지거나 흐려지지 않게 지킨다(계획 09 §2 '필수 고지 3종', 자본시장법 제101조의3 각 호의 내용).
// JSX 문구는 줄바꿈으로 갈라지므로 공백을 하나로 모아 렌더링된 글과 같은 모양으로 비교한다.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 주석을 빼고(설명 주석에 금지어를 인용해도 걸리지 않게) 공백을 하나로 모은 소스 */
const read = (p: string) =>
  readFileSync(path.join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, " ");

describe("푸터 필수 고지", () => {
  const footer = read("src/components/site-footer.tsx");

  it("정식 금융투자업자가 아님·개별 상담 없음·손실 귀속·과거 기록과 미래 수익·무료(결제 없음)를 모두 적는다", () => {
    for (const re of [
      /정식 금융투자업자가 아니며/,
      /개별적인 투자 상담과 자금 ?운용은 하지 않습니다/,
      /원금 손실이 발생할 수 있고 그 손실은 투자자 본인에게 귀속됩니다/,
      /투자 판단과 그 결과의 책임은 투자자 본인에게/,
      /과거 기록은 미래 수익을 보장하지 않습니다/,
      /투자 권유가 아닙니다/,
      /시그널을 판매하거나 결제를 받지 않/,
    ]) {
      expect(footer).toMatch(re);
    }
  });

  it("사실과 다르거나 과장된 표현을 쓰지 않는다", () => {
    // 신고 전이므로 '유사투자자문업자'라고 하지 않는다. 공급자 기록에 맞지 않는 '보여 주기 위한 모의 기록'도 쓰지 않는다.
    for (const re of [/유사투자자문업자/, /기록 방식을 보여 주기 위한/, /독립/, /추천/, /영구/, /변조 불가/, /검증된/]) {
      expect(footer).not.toMatch(re);
    }
  });

  it("'지우거나 바꾸면 드러난다'에 일일 앵커 고정 조건을 붙인다(앵커 전에 지운 마지막 기록은 공개 자료로 드러나지 않음)", () => {
    expect(footer).toContain("결과 전에 이 내용으로 기록됐고, 일일 앵커로 외부에 고정된 뒤 지우거나 바꾸면 드러난다");
    expect(footer).not.toMatch(/기록됐고, 지우거나 바꾸면 드러난다/);
  });

  it("루트 레이아웃이 푸터를 모든 화면에 붙인다", () => {
    expect(read("src/app/layout.tsx")).toMatch(/<SiteFooter ?\/>/);
  });
});
