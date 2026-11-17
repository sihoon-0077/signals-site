import { TYPE } from "@/components/typography";
import { cn } from "@/lib/utils";

/**
 * 화면 맨 위 제목 영역. 화면마다 h1은 이것 하나만 둔다(제목이 여러 개면 화면낭독기 사용자가 어디가 시작인지 모른다).
 * children(설명 문단)은 그대로 넣는다: 문구는 각 화면 파일에 있어야 문구 테스트가 그 파일을 읽어 확인할 수 있다.
 */
export function PageHeader({
  title,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-2">
          {eyebrow && <div className={TYPE.meta}>{eyebrow}</div>}
          <h1 className={TYPE.title}>{title}</h1>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="max-w-[42rem] space-y-3 text-base leading-relaxed text-muted-foreground sm:text-[1.0625rem]">{children}</div>}
    </div>
  );
}
