import Link from "next/link";
import { TYPE } from "@/components/typography";
import { cn } from "@/lib/utils";

// 면의 층: 페이지(background) < 카드(panel) < 메뉴·강조(raised). inset은 페이지보다 한 단 어두운 칸(코드·입력·검색)이다.
// raised는 면 한 단 + elev-lift(위쪽 가장자리 빛 + 바깥 1px 검은 테두리, globals.css)로 '들어 올린' 카드가 된다.
const TONE = {
  panel: "bg-card",
  inset: "bg-inset",
  raised: "bg-raised elev-lift",
} as const;

const PAD = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
} as const;

type PanelProps = React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article";
  tone?: keyof typeof TONE;
  pad?: keyof typeof PAD;
};

/** 1px 테두리의 카드 면. 문구는 children으로만 받는다(겉모양 전용). */
export function Panel({ as: Tag = "div", tone = "panel", pad = "md", className, ...props }: PanelProps) {
  return <Tag className={cn("rounded-xl border", TONE[tone], PAD[pad], className)} {...props} />;
}

/** 카드 머리: 제목 1개 + 설명 + 오른쪽 동작(버튼·링크). description은 블록이 들어와도 되게 div로 감싼다(<p> 안의 <p> 금지). */
export function PanelHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0 flex-1 space-y-1">
        <Heading className={TYPE.card}>{title}</Heading>
        {description && <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 줄 사이에 얇은 선이 있는 목록 카드(<ul>). 줄은 ListRow·ListLinkRow로 채운다. */
export function ListPanel({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("divide-y divide-line-subtle overflow-hidden rounded-xl border bg-card", className)} {...props} />;
}

export function ListRow({ className, ...props }: React.ComponentProps<"li">) {
  return <li className={cn("px-4 py-4 sm:px-6", className)} {...props} />;
}

/**
 * 줄 전체가 링크인 목록 줄. next/link에는 href·className·children만 넘긴다(테스트의 단순 <a> 대체와 맞춤).
 * 카드가 overflow-hidden이라 바깥으로 그리는 포커스 테두리가 잘린다 → 안쪽(-2px)으로 그린다.
 */
export function ListLinkRow({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className={cn("block px-4 py-4 transition-colors duration-150 hover:bg-muted focus-visible:-outline-offset-2 sm:px-6", className)}>
        {children}
      </Link>
    </li>
  );
}
