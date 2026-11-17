"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { HashSettle } from "@/components/effects/hash-settle";
import { selectContents, useCopy } from "@/components/use-copy";
import { shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 해시·루트 같은 긴 값을 앞 head자리…끝 4자리로 줄여 보여 주고(전체 값은 title), copyLabel을 주면 복사 버튼을 붙인다.
 * 문장 안(<p>·<dd>·<td>)에 들어가므로 span·code·button만 쓴다.
 * 자동 복사가 막히면 전체 값을 펼쳐 선택해 둔다: 줄인 값을 선택해 두면 사용자가 잘린 지문을 복사해 간다.
 * settle: 값이 한 번 hex 글자로 정착하며 나타난다(HashSettle). 검증 결과에서 '원문으로 지문 다시 계산'이 통과했을 때만 켠다.
 */
export function HashText({ value, head = 10, copyLabel, className, settle = false }: { value: string; head?: number; copyLabel?: string; className?: string; settle?: boolean }) {
  const { status, copy } = useCopy();
  const [expanded, setExpanded] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  // 응답이 깨져 문자열이 아닌 값이 와도 화면을 깨뜨리지 않는다
  const text = typeof value === "string" ? value : String(value ?? "");
  const n = Number.isFinite(head) && head > 0 ? Math.floor(head) : 10;
  // 줄여도 짧아지지 않는 값은 그대로 보여 준다(앞뒤가 겹쳐 같은 글자가 두 번 나오지 않게)
  const display = text.length > n + 5 ? shortHash(text, n) : text;

  async function onCopy() {
    if ((await copy(text)) === "manual") {
      // 펼친 전체 값이 화면에 그려진 뒤에 선택해야 잘리지 않은 값이 선택된다
      flushSync(() => setExpanded(true));
      selectContents(codeRef.current);
    }
  }

  // 문장 속 글자와 같은 기준선에 놓는다(inline-flex의 기준선 = 첫 항목인 <code>의 기준선).
  // 버튼은 누르는 칸 24px를 지키되 -my-1로 줄 높이를 늘리지 않는다.
  return (
    <span className={cn("inline-flex max-w-full flex-wrap items-center gap-x-1", className)}>
      {settle ? (
        <HashSettle ref={codeRef} value={expanded ? text : display} title={text} className={cn("font-mono text-[0.92em]", expanded && "break-all")} holdUntilStart since="mount" delayMs={150} />
      ) : (
        <code ref={codeRef} title={text} className={cn("font-mono text-[0.92em]", expanded && "break-all")}>
          {expanded ? text : display}
        </code>
      )}
      {copyLabel && (
        <>
          <button
            type="button"
            onClick={onCopy}
            aria-label={`${copyLabel} 복사`}
            title={`${copyLabel} 복사`}
            className="-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-muted hover:text-foreground"
          >
            {/* 복사 완료 체크는 초록이 아니라 글자색: 초록은 실제 검증 통과에만 쓴다(지문·루트 옆 초록 체크는 검증 통과 표시로 읽힌다) */}
            {status === "copied" ? <Check aria-hidden="true" className="size-3.5 text-foreground" /> : <Copy aria-hidden="true" className="size-3.5" />}
          </button>
          {/* 알림 영역은 처음부터 있어야 화면낭독기가 바뀐 글을 읽는다. 복사 완료는 아이콘으로 보이니 글은 낭독용으로만 둔다 */}
          <span role="status" className={status === "manual" ? "basis-full text-xs leading-relaxed text-muted-foreground" : "sr-only"}>
            {status === "manual" ? "자동 복사가 막혀 있어 전체 값을 선택해 두었습니다. 길게 눌러(또는 Ctrl+C) 복사하세요." : status === "copied" ? "복사했습니다." : ""}
          </span>
        </>
      )}
    </span>
  );
}
