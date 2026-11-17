import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { NavLink } from "@/components/nav-link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 메뉴 링크: 14px/500 tertiary → hover foreground(100ms). 현재 화면은 aria-current + 5% 채움이라 색만으로 구분하지 않는다.
// 높이·모서리는 옆 사전등록 버튼과 같게(h-8 = 32px, rounded-lg 8px): 채워진 현재 메뉴가 버튼보다 크면 그쪽이 더 무거운 버튼처럼 보인다.
// 높이를 주려면 inline-flex여야 한다(inline 요소는 height를 무시) → sm에서 다시 보일 때도 sm:inline이 아니라 sm:inline-flex.
const NAV =
  "inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium text-tertiary transition-colors duration-100 hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground";

// 스크롤해도 위에 붙어 있는 헤더. 아래 얇은 선은 늘 보인다(스크롤 감지 스크립트 없이).
// 바탕은 페이지와 같은 캔버스색 80% + 뒤 흐림: 페이지보다 밝은 띠가 되지 않고, 아래로 지나가는 내용만 흐리게 비친다.
// 320px 폭 휴대폰: 로고 마크까지 넣으면 넘쳐서 360px 미만에서는 마크를 숨긴다(이름 "SIGNALS"는 늘 보인다).
// 운영자 화면(data-layout="wide")에서는 본문처럼 90rem까지 넓혀 로고와 본문 왼쪽 끝을 맞춘다(body의 group/body 기준, 스크립트 없음).
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-[20px] backdrop-saturate-150 print:static">
      <div className="mx-auto flex h-14 w-full max-w-6xl group-has-data-[layout=wide]/body:max-w-[90rem] items-center justify-between gap-3 px-5 sm:h-16 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-md text-[0.9375rem] font-semibold tracking-[0.06em] text-foreground max-[359px]:tracking-[0.02em]">
          <LogoMark className="hidden min-[360px]:block" />
          SIGNALS
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <NavLink href="/verify" className={NAV}>
            기록 검증
          </NavLink>
          <NavLink href="/anchors" className={cn(NAV, "hidden sm:inline-flex")}>
            외부 고정 기록
          </NavLink>
          {/* 가입 화면 이름('공급자 무료 사전등록')과 맞춘다. '무료'까지 넣으면 320px 폭 휴대폰에서 헤더가 넘쳐 홈·가입 화면 본문에 둔다. */}
          {/* 채운 인디고 버튼은 화면당 1개(홈 히어로의 주 버튼)라 헤더는 반투명 outline 32px로 둔다. */}
          <Link href="/providers/join" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 rounded-lg px-3 text-[0.8125rem]")}>
            공급자 사전등록
          </Link>
        </nav>
      </div>
    </header>
  );
}
