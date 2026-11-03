"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";

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
      <div className="mx-auto max-w-xl space-y-5 py-10" role="alert">
        <h1 className="text-2xl font-bold">사이트가 새 버전으로 바뀌었습니다</h1>
        <p className="leading-relaxed text-muted-foreground">방금 보낸 요청은 처리되지 않았습니다(저장되지 않음). 새로고침한 뒤 다시 해 주세요.</p>
        <button type="button" onClick={() => window.location.reload()} className="text-primary underline-offset-4 hover:underline">
          새로고침
        </button>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl space-y-5 py-10" role="alert">
      <h1 className="text-2xl font-bold">일시적인 오류가 났습니다</h1>
      <p className="leading-relaxed text-muted-foreground">잠시 뒤 다시 시도해 주세요. 문제가 계속되면 개인정보 처리방침에 적힌 연락처로 알려 주세요.</p>
      {error.digest && (
        <p className="text-sm text-muted-foreground">
          오류 번호 <code>{error.digest}</code>
        </p>
      )}
      <button type="button" onClick={reset} className="text-primary underline-offset-4 hover:underline">
        다시 시도
      </button>
    </div>
  );
}
