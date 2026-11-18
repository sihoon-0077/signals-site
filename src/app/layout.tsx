import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Suspense } from "react";
import { ReferralTracker } from "@/components/referral-tracker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/server/config";
// 본문 글꼴: Pretendard(OFL) 동적 서브셋. 빌드가 글자 조각(woff2)을 우리 도메인(/_next/static/media)으로 복사하고,
// 페이지에 쓰인 글자가 든 조각만 내려받는다(unicode-range) → 외부 글꼴 요청이 없어 처리방침의 국외 이전 항목이 늘지 않는다.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

// 해시·ID·명령어용 고정폭. next/font/google은 빌드 때 받아 자체 호스팅하므로 방문자 브라우저는 Google에 요청하지 않는다.
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  // 공유 링크·검증 안내와 같은 함수로 주소를 정한다. 여기서 localhost로 따로 대체하면 Next의 Vercel 운영 주소 대체가 막혀
  // og:image가 http://localhost:3000으로 나간다. 값이 잘못되면 siteUrl()이 던져 빌드가 멈춘다.
  metadataBase: new URL(siteUrl()),
  // 검색 결과·탭에서 잘려도 앞부분만으로 사실이어야 한다: 지금 하는 일(봉인·대조)을 쓰고, 판매는 말하지 않는다(출시 전 무료 기간).
  title: { default: "SIGNALS — 결과 전에 봉인하고 누구나 대조하는 AI 시그널 기록", template: "%s · SIGNALS" },
  description:
    "AI·퀀트 시그널을 결과가 나오기 전에 봉인하고, 그 지문을 매일 외부에 고정해 누구나 다시 대조할 수 있게 합니다. 지금은 출시 전 무료 기간으로 시그널을 팔거나 결제를 받지 않으며, 투자 조언을 하지 않습니다.",
  // 공유 미리보기(카카오톡·X 등). og·twitter의 제목·설명은 Next가 화면마다 위 title·description에서 채운다(문구를 두 번 쓰지 않는다).
  // 카드 이미지는 src/app/opengraph-image.tsx(공급자 화면은 자기 카드). 아래 화면에서 openGraph를 따로 정하면 이 묶음이 통째로 바뀌어
  // type·siteName·locale은 물론 사이트 카드 이미지도 빠진다(Next는 그 화면 폴더에 opengraph-image 파일이 있을 때만 이미지를 다시 붙인다).
  // 그때는 셋을 같이 적고, 그 폴더에 opengraph-image를 두거나 images도 적는다(twitter도 같다). canonical은 두지 않는다: 루트에 두면 모든 화면이 "/"를 가리킨다.
  openGraph: { type: "website", siteName: "SIGNALS", locale: "ko_KR" },
  twitter: { card: "summary_large_image" },
};

// 다크 단일 테마: 휴대폰 주소창 색과 브라우저 기본 부품(스크롤바·폼)을 화면 배경과 맞춘다.
export const viewport: Viewport = { themeColor: "#08090A", colorScheme: "dark" };

// 본문이 짧아도 푸터가 화면 아래에 붙게 body는 세로 flex, main(flex-1)이 남는 높이를 채운다.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={jetbrainsMono.variable}>
      <body className="group/body flex min-h-screen flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50 focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm focus:text-foreground"
        >
          본문으로 건너뛰기
        </a>
        <Suspense fallback={null}>
          <ReferralTracker />
        </Suspense>
        <SiteHeader />
        {/* 관리자 화면처럼 넓은 표가 필요한 곳은 자기 레이아웃에 data-layout="wide"를 두면 본문 폭이 넓어진다.
            홈처럼 화면 끝까지 닿는 띠가 필요한 곳은 data-layout="bleed": main의 폭·여백을 풀고, 섹션마다 컨테이너를 직접 둔다 */}
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14 has-data-[layout=wide]:max-w-[90rem] has-data-[layout=bleed]:max-w-none has-data-[layout=bleed]:p-0">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
