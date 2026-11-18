"use client";

import Link from "next/link";
import { useSelectedLayoutSegments } from "next/navigation";

/**
 * 헤더 메뉴 링크. 지금 보고 있는 화면(또는 그 아래 화면)이면 aria-current="page"를 붙여
 * 화면낭독기가 '현재 페이지'라고 읽고, 스타일은 부르는 쪽이 aria-[current=page]: 변형으로 준다(글자색만이 아니라 배경 칸도 바꿔 색만으로 구분하지 않게).
 *
 * 주소(usePathname)가 아니라 라우트 트리(useSelectedLayoutSegments)로 판단한다. 없는 주소(예: /providers/join/abc)에 Next는 미리 만든
 * 404 HTML을 주는데, 그 HTML은 /_not-found 트리로 그려져 표시가 없다. 주소로 판단하면 브라우저만 '현재'라고 보고(React는 이 속성 차이를
 * 화면에 고쳐 쓰지 않는다), 그 뒤 이 링크를 눌러 넘어가도 값이 그대로라 표시가 끝내 붙지 않았다(11/18 재현). 트리는 서버·브라우저가 같다.
 * 세그먼트는 '이 컴포넌트를 그린 레이아웃 아래'만 나오므로 루트 레이아웃(SiteHeader)에서만 쓴다. 아래 레이아웃에서 쓰면 경로 앞부분이 빠진다.
 * 비교는 세그먼트 단위로 한다: 라우트 그룹 '(이름)'은 주소에 없으니 빼고, 미리 만든 404의 세그먼트('/_not-found')는 어느 메뉴와도
 * 맞지 않으며, /verifyx는 /verify 아래가 아니다. href="/"는 홈에서만 현재다.
 */
export function NavLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const segments = (useSelectedLayoutSegments() ?? []).filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  const target = href.split("/").filter(Boolean);
  const current = target.length === 0 ? segments.length === 0 : target.every((s, i) => segments[i] === s);
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}
