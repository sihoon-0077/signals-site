import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 아직 항목이 없을 때의 안내 칸. 점선 테두리로 '비어 있음'을 실제 카드와 구분한다. 문구는 children으로만 받는다.
 * 아이콘은 40px 타일(raised + elev-lift) 안에 둔다. 장식이라 타일째 화면낭독기에서 숨긴다.
 */
export function EmptyState({ children, icon: Icon, className }: { children: React.ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-4 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-sm leading-relaxed text-muted-foreground", className)}>
      {Icon && (
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl border bg-raised elev-lift">
          <Icon className="size-5 text-tertiary" />
        </span>
      )}
      <div className="max-w-md">{children}</div>
    </div>
  );
}
