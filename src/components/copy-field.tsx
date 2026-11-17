"use client";

import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/components/use-copy";

/**
 * 공유 링크처럼 복사해 갈 값을 보여 주는 칸.
 * label은 짧게 두고 설명은 hint로 넘긴다: label은 복사 버튼 이름(`${label} 복사`)에도 들어가서, 길면 화면낭독기가 버튼마다 긴 문장을 읽는다.
 */
export function CopyField({ value, label, hint }: { value: string; label: string; hint?: string }) {
  const { status, copy } = useCopy();
  const codeRef = useRef<HTMLElement>(null);
  const labelId = useId();
  const hintId = useId();
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {label}
      </p>
      {hint && (
        <p id={hintId} className="text-sm leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
      <div className="flex gap-2">
        <code ref={codeRef} aria-labelledby={labelId} className="flex min-h-11 min-w-0 flex-1 items-center overflow-x-auto rounded-lg border border-line-subtle bg-inset px-3 py-2 font-mono text-[0.8125rem] whitespace-nowrap text-lead sm:min-h-10">
          {value}
        </code>
        <Button type="button" variant="outline" className="h-auto min-h-11 px-4 sm:min-h-10" aria-label={`${label} 복사`} aria-describedby={hint ? hintId : undefined} onClick={() => copy(value, codeRef.current)}>
          {status === "copied" ? "복사됨" : "복사"}
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {status === "manual" ? "자동 복사가 막혀 있어 주소를 선택해 두었습니다. 길게 눌러(또는 Ctrl+C) 복사하세요." : status === "copied" ? "복사했습니다." : ""}
      </p>
    </div>
  );
}
