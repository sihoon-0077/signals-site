// 헤더의 '현재 화면' 표시(aria-current="page")를 Next의 실제 훅으로 렌더해서 본다. 주소(PathnameContext)와 라우트 트리
// (LayoutRouterContext)를 실제 모양으로 따로 넣는다: 미리 만든 404는 주소가 /providers/join/abc여도 트리는 /_not-found라,
// 주소로 판단하는 구현(옛 usePathname)이면 404 경우가 실패한다. 소스 문자열 검사(site-polish)만으로는 이런 규칙 변화를 알 수 없다.
import { createElement, type ContextType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

// Next 라우터 없이 그리도록 Link만 a로 바꾼다(받은 속성은 그대로 넘긴다). 현재 화면을 판단하는 훅은 진짜다.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { href: string; children?: ReactNode }) => createElement("a", props, children),
}));

import { SiteHeader } from "@/components/site-header";

// 루트 레이아웃 아래 라우트 트리(FlightRouterState 모양: [세그먼트, { children: 아래 }]). 동적 세그먼트는 [이름, 값, 종류].
type Segment = string | [string, string, string];
const tree = (...segments: Segment[]) => {
  let node: unknown = ["__PAGE__", {}];
  for (const s of [...segments].reverse()) node = [s, { children: node }];
  return ["", { children: node }];
};
// next build가 만든 _not-found.rsc의 트리와 같은 모양(세그먼트가 '/_not-found')
const NOT_FOUND = tree("/_not-found");

// 이 주소·트리에서 현재로 표시된 링크들의 href
const currentLinks = (url: string, routeTree: unknown) => {
  const layout = { parentTree: routeTree } as unknown as NonNullable<ContextType<typeof LayoutRouterContext>>;
  const html = renderToStaticMarkup(
    createElement(PathnameContext.Provider, { value: url }, createElement(LayoutRouterContext.Provider, { value: layout }, createElement(SiteHeader))),
  );
  return [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => tag.includes('aria-current="page"'))
    .map((tag) => /href="([^"]*)"/.exec(tag)?.[1]);
};

describe("헤더의 현재 화면 표시", () => {
  it("사전등록 화면과 그 완료 화면에서는 사전등록 버튼만 현재로 표시한다", () => {
    expect(currentLinks("/providers/join", tree("providers", "join"))).toEqual(["/providers/join"]);
    expect(currentLinks("/providers/join/done", tree("providers", "join", "done"))).toEqual(["/providers/join"]);
  });

  it("검증 결과 화면에서는 '기록 검증'만, 외부 고정 기록 화면에서는 그 메뉴만, 홈에서는 아무것도 표시하지 않는다", () => {
    expect(currentLinks("/verify/abc", tree("verify", ["id", "abc", "d"]))).toEqual(["/verify"]);
    expect(currentLinks("/anchors", tree("anchors"))).toEqual(["/anchors"]);
    expect(currentLinks("/", tree())).toEqual([]);
  });

  it("없는 주소에 미리 만든 404를 줄 때는 주소가 메뉴 아래여도 아무것도 표시하지 않는다(서버가 그린 HTML과 같게)", () => {
    // 주소로 판단하면 여기서 버튼·메뉴가 '현재'가 되어 서버 HTML(표시 없음)과 어긋나고, 그 뒤 이동해도 표시가 붙지 않았다(11/18 재현)
    expect(currentLinks("/providers/join/abc", NOT_FOUND)).toEqual([]);
    expect(currentLinks("/verify/a/b", NOT_FOUND)).toEqual([]);
  });

  it("세그먼트 단위로 비교한다: 이름이 메뉴로 시작하기만 하는 화면은 아니고, 라우트 그룹 '(이름)'은 주소에 없으니 건너뛴다", () => {
    expect(currentLinks("/verifyx", tree("verifyx"))).toEqual([]);
    expect(currentLinks("/providers/joinx", tree("providers", "joinx"))).toEqual([]);
    expect(currentLinks("/verify", tree("(site)", "verify"))).toEqual(["/verify"]);
  });
});
