"use client";

// ?ref=코드 로 들어오면 30일간 기억하고(쿠키), 유입 1회를 기록한다. 서버에는 코드·날짜·방문 수만 남는다.
// 같은 브라우저는 코드마다 하루(KST) 1회만 센다: 탭 단위(sessionStorage)로 세면 공급자 본인이 새 탭에서 링크를 열 때마다 공개 수치가 올랐다.
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export function ReferralTracker() {
  const params = useSearchParams();
  const pathname = usePathname();
  useEffect(() => {
    const ref = params.get("ref");
    if (!ref || !/^[a-z0-9]{6,16}$/.test(ref)) return;
    document.cookie = `ref=${ref}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 날짜(서버 집계와 같은 기준)
    const key = `ref-sent:${ref}:${day}`;
    try {
      if (localStorage.getItem(key)) return;
      // 지난 날짜의 표시는 지운다(하루가 지나면 쓸모가 없어 쌓이기만 한다)
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith("ref-sent:") && !k.endsWith(`:${day}`)) localStorage.removeItem(k);
      }
      localStorage.setItem(key, "1");
    } catch {
      // 사이트 데이터 저장을 막은 브라우저는 접근만 해도 예외가 난다. 모든 화면에 붙는 컴포넌트라 화면을 깨뜨리지 않고 세지 않는다.
      return;
    }
    navigator.sendBeacon?.("/api/ref", JSON.stringify({ code: ref, path: pathname }));
  }, [params, pathname]);
  return null;
}
