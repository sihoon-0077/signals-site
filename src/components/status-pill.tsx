import { CircleAlert, CircleCheck, CircleMinus, CircleX, Clock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PillKind = "pass" | "fail" | "pending" | "skip" | "unchecked" | "neutral";

// Tailwind는 소스의 글자를 그대로 찾아 클래스를 만든다: `bg-status-${kind}`처럼 조립하면 CSS가 생기지 않으므로 전부 적어 둔다.
const KIND_CLASS: Record<PillKind, string> = {
  pass: "border-status-pass/40 bg-status-pass/14 text-status-pass",
  fail: "border-status-fail/40 bg-status-fail/14 text-status-fail",
  pending: "border-status-pending/40 bg-status-pending/14 text-status-pending",
  skip: "border-status-skip/40 bg-status-skip/14 text-status-skip",
  // 확인 못 함: 통과처럼 보이면 안 되고 불일치와도 구분돼야 한다 → 같은 경고색의 속 빈 알약(실선 50% 테두리, 배경 없음)
  unchecked: "border-status-fail/50 bg-transparent text-status-fail",
  neutral: "border-border bg-transparent text-muted-foreground",
};

// 색만으로 상태를 구분하지 않게(색각 이상·흑백 인쇄) 상태마다 모양이 다른 아이콘을 붙인다. 글자 라벨은 children으로 늘 함께 나온다.
const KIND_ICON: Record<PillKind, LucideIcon | null> = {
  pass: CircleCheck,
  fail: CircleX,
  pending: Clock,
  skip: CircleMinus,
  unchecked: CircleAlert,
  neutral: null,
};

export function StatusPill({ kind, children, className }: { kind: PillKind; children: React.ReactNode; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap", KIND_CLASS[kind], className)}>
      {Icon && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      {children}
    </span>
  );
}
