import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="text-base font-bold tracking-tight">
          SIGNALS
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <Link href="/verify" className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground">
            기록 검증
          </Link>
          <Link href="/anchors" className="hidden rounded-md px-3 py-2 text-muted-foreground hover:text-foreground sm:inline">
            외부 고정 기록
          </Link>
          {/* 가입 화면 이름('공급자 무료 사전등록')과 맞춘다. '무료'까지 넣으면 320px 폭 휴대폰에서 헤더가 넘쳐 홈·가입 화면 본문에 둔다. */}
          <Link href="/providers/join" className={buttonVariants({ size: "sm" })}>
            공급자 사전등록
          </Link>
        </nav>
      </div>
    </header>
  );
}
