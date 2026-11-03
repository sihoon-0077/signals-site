import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import { Suspense } from "react";
import { ReferralTracker } from "@/components/referral-tracker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteUrl } from "@/server/config";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  // 공유 링크·검증 안내와 같은 함수로 주소를 정한다. 여기서 localhost로 따로 대체하면 Next의 Vercel 운영 주소 대체가 막혀
  // og:image가 http://localhost:3000으로 나간다. 값이 잘못되면 siteUrl()이 던져 빌드가 멈춘다.
  metadataBase: new URL(siteUrl()),
  // 검색 결과·탭에서 잘려도 앞부분만으로 사실이어야 한다: 지금 하는 일(봉인·대조)을 쓰고, 판매는 말하지 않는다(출시 전 무료 기간).
  title: { default: "SIGNALS — 결과 전에 봉인하고 누구나 대조하는 AI 시그널 기록", template: "%s · SIGNALS" },
  description:
    "AI·퀀트 시그널을 결과가 나오기 전에 봉인하고, 그 지문을 매일 외부에 고정해 누구나 다시 대조할 수 있게 합니다. 지금은 출시 전 무료 기간으로 시그널을 팔거나 결제를 받지 않으며, 투자 조언을 하지 않습니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={notoSansKr.variable}>
      <body className="min-h-screen antialiased">
        <Suspense fallback={null}>
          <ReferralTracker />
        </Suspense>
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8 sm:py-16">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
