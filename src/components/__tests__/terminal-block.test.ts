// 명령줄 블록: 가로로 스크롤되는 상자는 Tab으로 멈추므로 화면낭독기가 읽을 이름(화면에 있는 제목)을 단다.
// 줄을 바꾸는 상자는 멈출 일이 없어 아무 속성도 더하지 않는다(verify-runner-view 테스트가 <pre class="…"> 모양을 본다).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalBlock } from "@/components/terminal-block";

// 훅이 없는 서버 컴포넌트라 함수로 바로 불러 그린다(이 저장소의 테스트는 .ts라 JSX를 쓰지 않는다).
describe("TerminalBlock", () => {
  it("가로 스크롤 상자는 Tab 정지점이고, 화면의 제목 id로 이름이 붙은 영역이다", () => {
    const html = renderToStaticMarkup(TerminalBlock({ labelledBy: "cli-title", children: "npm run verify" }));
    expect(html).toMatch(/^<pre class="[^"]*\boverflow-x-auto\b[^"]*" tabindex="0" role="region" aria-labelledby="cli-title">npm run verify<\/pre>$/);
  });

  it("줄을 바꾸는 상자는 class만 단다(정지점·영역·이름 없음)", () => {
    const html = renderToStaticMarkup(TerminalBlock({ wrap: true, children: "v2|abc" }));
    expect(html).toMatch(/^<pre class="[^"]*\bwhitespace-pre-wrap\b[^"]*\bbreak-all\b[^"]*">v2\|abc<\/pre>$/);
  });
});
