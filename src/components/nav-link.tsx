"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 헤더 메뉴 링크. 지금 보고 있는 화면(또는 그 아래 주소)이면 aria-current="page"를 붙여
 * 화면낭독기가 '현재 페이지'라고 읽고, 스타일은 부르는 쪽이 aria-[current=page]: 변형으로 준다(글자색만이 아니라 배경 칸도 바꿔 색만으로 구분하지 않게).
 */
export function NavLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}
