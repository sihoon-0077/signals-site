"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CopyStatus = "idle" | "copied" | "manual";

/** el 안의 글자를 모두 선택해 둔다(자동 복사가 막혔을 때 사용자가 바로 복사할 수 있게). */
export function selectContents(el: HTMLElement | null | undefined) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * 클립보드 복사 상태(CopyField·HashText 공용).
 * copy()는 결과("copied" | "manual")를 돌려준다: 막혔을 때 값을 펼친 뒤 선택하는 것처럼, 부르는 쪽이 이어서 할 일이 있을 때 쓴다.
 */
export function useCopy() {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 화면을 떠난 뒤 1.5초 타이머가 상태를 바꾸지 않게 정리한다
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = useCallback(async (value: string, selectEl?: HTMLElement | null): Promise<Exclude<CopyStatus, "idle">> => {
    if (timer.current) clearTimeout(timer.current);
    try {
      // navigator.clipboard가 없으면(http 접속·오래된 브라우저) 여기서 TypeError → 아래 catch로 간다
      await navigator.clipboard.writeText(value);
      setStatus("copied");
      timer.current = setTimeout(() => setStatus("idle"), 1500);
      return "copied";
    } catch {
      // 인앱 브라우저·권한 거부·http 접속에서는 클립보드 API가 막힌다 → 값을 선택해 두고 직접 복사하게 안내한다
      selectContents(selectEl);
      setStatus("manual");
      return "manual";
    }
  }, []);
  return { status, copy };
}
