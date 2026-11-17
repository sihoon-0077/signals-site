import { cn } from "@/lib/utils";

/**
 * 명령어·정규 직렬화 문자열처럼 글자 그대로 보여 줄 값(<pre> 하나). 복사 버튼은 두지 않는다.
 * wrap: 줄바꿈 없는 긴 값(지문·서명)이 휴대폰에서 가로로 넘치지 않게 아무 곳에서나 줄을 바꾼다.
 * wrap이 아니면 긴 줄은 상자 안에서 가로로 스크롤된다. Safari는 스크롤 상자에 키보드 포커스를 주지 않아 Tab으로 들어와
 * 화살표로 넘겨 볼 수 없으므로 tabIndex=0을 준다(포커스 테두리는 globals.css의 :focus-visible). wrap이면 넘치지 않아 주지 않는다.
 */
export function TerminalBlock({ children, wrap, className }: { children: string; wrap?: boolean; className?: string }) {
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-lg border border-line-subtle bg-inset px-4 py-3.5 font-mono text-[0.8125rem] leading-[1.7] text-lead",
        wrap && "whitespace-pre-wrap break-all",
        className,
      )}
      tabIndex={wrap ? undefined : 0}
    >
      {children}
    </pre>
  );
}
