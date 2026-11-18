import { cn } from "@/lib/utils";

type TerminalBlockProps =
  // wrap: 상자 안에서 줄을 바꿔 넘치지 않는다 → Tab으로 멈출 일이 없어 이름도 필요 없다.
  | { children: string; wrap: true; className?: string; labelledBy?: undefined }
  // 가로 스크롤 상자 → Tab으로 멈추므로, 화면낭독기가 "무엇인지" 읽을 이름(이미 화면에 있는 제목의 id)이 꼭 있어야 한다.
  | { children: string; wrap?: false; className?: string; labelledBy: string };

/**
 * 명령어·정규 직렬화 문자열처럼 글자 그대로 보여 줄 값(<pre> 하나). 복사 버튼은 두지 않는다.
 * wrap: 줄바꿈 없는 긴 값(지문·서명)이 휴대폰에서 가로로 넘치지 않게 아무 곳에서나 줄을 바꾼다.
 * wrap이 아니면 긴 줄은 상자 안에서 가로로 스크롤된다. Safari는 스크롤 상자에 키보드 포커스를 주지 않아 Tab으로 들어와
 * 화살표로 넘겨 볼 수 없으므로 tabIndex=0을 준다(포커스 테두리는 globals.css의 :focus-visible). wrap이면 넘치지 않아 주지 않는다.
 * Tab으로 멈추는 상자는 role="region" + aria-labelledby로 이름을 단다: 이름 없는 정지점은 화면낭독기가 '그룹'이라고만 읽는다.
 * (wrap일 때는 속성을 하나도 더하지 않는다 — 검증 결과 화면 테스트가 <pre class="…"> 모양을 그대로 본다.)
 */
export function TerminalBlock(props: TerminalBlockProps) {
  const { children, wrap, className } = props;
  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-lg border border-line-subtle bg-inset px-4 py-3.5 font-mono text-[0.8125rem] leading-[1.7] text-lead",
        wrap && "whitespace-pre-wrap break-all",
        className,
      )}
      tabIndex={wrap ? undefined : 0}
      role={wrap ? undefined : "region"}
      aria-labelledby={wrap ? undefined : props.labelledBy}
    >
      {children}
    </pre>
  );
}
