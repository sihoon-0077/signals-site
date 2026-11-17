import { cn } from "@/lib/utils";

/**
 * 로고 마크(봉인된 블록): 테두리 고리 안에 블록 하나. 장식이라 화면낭독기에서는 숨긴다(옆의 "SIGNALS" 글자가 이름).
 * 색은 토큰과 같은 값(#A3A9FF 링크·포커스, #5A61D8 주 버튼)을 직접 적는다: 인쇄용 밝은 테마에서 토큰이 바뀌어도 로고 색은 그대로여야 한다.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={cn("size-5 shrink-0", className)}>
      <rect x="1.75" y="1.75" width="20.5" height="20.5" rx="5.25" fill="none" stroke="#A3A9FF" strokeWidth="1.5" />
      <rect x="7" y="7" width="10" height="10" rx="2" fill="#5A61D8" />
    </svg>
  );
}
