import { cn } from "@/lib/utils";

/**
 * 숫자 요약 칸 묶음(<dl>). 칸 사이 1px 선은 gap-px + 테두리색 배경으로 그린다(칸마다 테두리를 주면 맞닿는 곳이 2px가 된다).
 * 칸 수가 열 수로 나눠떨어지지 않으면 빈 자리가 선 색으로 보이므로, 열 수(grid-cols)는 칸 수에 맞춰 className으로 바꾼다.
 */
export function KpiGrid({ className, ...props }: React.ComponentProps<"dl">) {
  // bg-clip-padding: 테두리(8%)와 칸 사이 선 배경(8%)이 둘 다 반투명이라, 배경이 테두리 밑까지 깔리면 바깥 테두리만 두 겹으로 밝아진다.
  // grid-cols-1: 열을 비워 두면 auto 열이 칸 안 긴 값(지문 등)의 최소 폭만큼 늘어날 수 있다 → 휴대폰에서도 minmax(0,1fr) 한 열을 적어 둔다
  return <dl className={cn("grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border bg-clip-padding sm:grid-cols-3", className)} {...props} />;
}

/** 칸 하나: 이름(dt) + 값(dd). 값은 고정폭 숫자라 줄마다 자릿수가 맞는다. */
export function KpiTile({ label, value, className }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 bg-card px-5 py-4", className)}>
      <dt className="text-[0.8125rem] font-medium text-tertiary">{label}</dt>
      <dd className="mt-1.5 font-mono text-lg leading-[1.4] text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
