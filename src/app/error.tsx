"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";
import { TYPE } from "@/components/typography";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 404 화면(not-found.tsx)과 같은 틀: 카드 없이 캔버스 위 가운데 글자 덩어리(제목 → 설명 → 버튼). 효과는 넣지 않는다.
const SCREEN = "mx-auto flex max-w-xl flex-col items-center py-8 text-center sm:py-16";

// 버튼은 네이티브 <button type="button">에 모양만 입힌다(동작·속성은 그대로). 404 화면의 '처음으로'와 같은 테두리형.
const RETRY_BUTTON = cn(buttonVariants({ size: "lg", variant: "outline" }), "mt-8");

// 화면을 그리다 서버 오류가 나면 영문 기본 화면 대신 이 화면을 보여 준다.
// 오류 번호(digest)는 서버 로그의 같은 오류와 짝을 맞추는 값이다(내용은 담기지 않음). Vercel Hobby는 로그를 1시간만 남기므로
// 운영자가 이 번호로 바로 찾을 수 있게 보여 준다.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 새 배포 뒤 예전 화면에서 보낸 서버 액션은 서버에 없어 실행되지 않는다(Vercel Hobby에는 Skew Protection이 없음).
  // reset은 예전 코드를 그대로 다시 쓰므로 소용없고, 새로고침해야 한다. 관리자 발행 폼은 forms.tsx의 guardAction이 먼저 받고,
  // 여기는 그 밖의 폼(공개 사전등록, 관리자 승인·탈퇴 버튼)이 같은 상황을 만났을 때를 맡는다.
  // 주의: 이 함수는 타입 가드라 `error`에 바로 쓰면, 구조가 같은 Error 타입이 아래에서 never로 좁혀져(digest 접근이 타입 오류) 빌드가 실패한다.
  // unknown으로 넓힌 식에 걸어 변수의 타입은 그대로 둔다.
  if (unstable_isUnrecognizedActionError(error as unknown)) {
    return (
      <div role="alert" className={SCREEN}>
        <h1 className={TYPE.title}>사이트가 새 버전으로 바뀌었습니다</h1>
        <p className={cn(TYPE.body, "mt-4")}>방금 보낸 요청은 처리되지 않았습니다(저장되지 않음). 새로고침한 뒤 다시 해 주세요.</p>
        <button type="button" onClick={() => window.location.reload()} className={RETRY_BUTTON}>
          새로고침
        </button>
      </div>
    );
  }
  return (
    <div role="alert" className={SCREEN}>
      <h1 className={TYPE.title}>일시적인 오류가 났습니다</h1>
      <p className={cn(TYPE.body, "mt-4")}>잠시 뒤 다시 시도해 주세요. 문제가 계속되면 개인정보 처리방침에 적힌 연락처로 알려 주세요.</p>
      {error.digest && (
        <p className="mt-4 text-sm text-muted-foreground">
          오류 번호 <code className="rounded-md border border-line-subtle bg-inset px-1.5 py-0.5 font-mono text-xs break-all text-foreground">{error.digest}</code>
        </p>
      )}
      <button type="button" onClick={reset} className={RETRY_BUTTON}>
        다시 시도
      </button>
    </div>
  );
}
