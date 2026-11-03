"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * 공유 링크처럼 복사해 갈 값을 보여 주는 칸.
 * label은 짧게 두고 설명은 hint로 넘긴다: label은 복사 버튼 이름(`${label} 복사`)에도 들어가서, 길면 화면낭독기가 버튼마다 긴 문장을 읽는다.
 */
export function CopyField({ value, label, hint }: { value: string; label: string; hint?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const codeRef = useRef<HTMLElement>(null);
  const labelId = useId();
  const hintId = useId();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      setTimeout(() => setStatus("idle"), 1500);
    } catch {
      // 인앱 브라우저·권한 거부·http 접속에서는 클립보드 API가 막힌다 → 값을 선택해 두고 직접 복사하게 안내한다
      const el = codeRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      setStatus("manual");
    }
  }
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
        <code ref={codeRef} aria-labelledby={labelId} className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 text-sm whitespace-nowrap">
          {value}
        </code>
        <Button type="button" variant="outline" aria-label={`${label} 복사`} aria-describedby={hint ? hintId : undefined} onClick={copy}>
          {status === "copied" ? "복사됨" : "복사"}
        </Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {status === "manual" ? "자동 복사가 막혀 있어 주소를 선택해 두었습니다. 길게 눌러(또는 Ctrl+C) 복사하세요." : status === "copied" ? "복사했습니다." : ""}
      </p>
    </div>
  );
}
