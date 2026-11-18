import type { Metadata } from "next";
import Link from "next/link";
import { TYPE } from "@/components/typography";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 탭 제목·화면낭독기가 홈 제목으로 소개하지 않게(루트 템플릿으로 "페이지를 찾을 수 없습니다 · SIGNALS").
export const metadata: Metadata = { title: "페이지를 찾을 수 없습니다" };

// 공개된 화면 하나. 위의 '404'는 장식이라 화면낭독기에서는 숨긴다(제목이 같은 뜻을 이미 말한다).
// 카드 없이 캔버스 위 글자 덩어리로 둔다: 큰 mono 숫자(disabled 색은 장식에만) → 제목 → 설명 → 테두리형 버튼. 효과는 넣지 않는다.
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-8 text-center sm:py-16">
      <p aria-hidden="true" className="font-mono text-[4rem] leading-none font-medium tracking-tight text-disabled sm:text-[5rem]">
        404
      </p>
      <h1 className={cn(TYPE.title, "mt-6")}>페이지를 찾을 수 없습니다</h1>
      <p className={cn(TYPE.body, "mt-4")}>
        주소가 틀렸거나, 아직 승인되지 않은 공급자 프로필일 수 있습니다. 사전등록 직후의 프로필은 운영자가 승인한 뒤에 열립니다.
      </p>
      <Link href="/" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "mt-8")}>
        처음으로
      </Link>
    </div>
  );
}
