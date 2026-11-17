import type { Metadata } from "next";
import { Anchor, ExternalLink } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { HashText } from "@/components/hash-text";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { kstDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { anchorRepo } from "@/server/config";
import { getDb } from "@/server/db";
import { listAnchors } from "@/server/services/anchor";

export const metadata: Metadata = { title: "외부 고정 기록" };
export const dynamic = "force-dynamic";

export default async function AnchorsPage() {
  const anchors = await listAnchors(await getDb());
  const repo = anchorRepo().url;
  return (
    <div className="mx-auto max-w-3xl space-y-12">
      <PageHeader title="외부 고정 기록(일일 앵커)">
        <p className="leading-relaxed text-muted-foreground">
          매일 18시(KST) 무렵(주말·휴장일 포함, 바뀐 것이 없다는 사실까지) 종료된 에이전트까지 모든 기록의 길이와 마지막 지문을 머클 루트 하나로 묶어
          서명합니다. 루트는 타임스탬프 기관과 OpenTimestamps(비트코인)에 찍고, 문서 전체를 공개 저장소에 올립니다. 우리가 나중에 기록을 지우거나 고치면 이
          루트와 맞지 않게 됩니다.
        </p>
        {/* 예약 실행(GitHub Actions)은 늦어지거나 건너뛸 수 있고, 앵커는 그날(KST)만 만들 수 있다(anchor.ts). 정시·매일을 단정하지 않는다. */}
        <p className="leading-relaxed text-muted-foreground">
          실행은 예약 작업이라 늦어질 수 있습니다(실제 생성 시각은 아래 목록에 표시). 그날 안에 만들지 못한 날은 나중에 채우지 않고 빈 날로 남깁니다. 나중에
          채우면 그날 이미 고정된 것처럼 보이기 때문입니다. 그날 기록은 다음 앵커에 함께 담깁니다.
        </p>
        {repo && (
          // 새 탭으로 여는 바깥 주소라 화살표 아이콘을 붙인다(채널 링크와 같은 모양). 문단 뒤 자리는 그대로 둔다(읽는 순서 유지).
          <a
            href={repo}
            className="inline-flex items-center gap-1 text-sm text-link underline underline-offset-4 transition-colors hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            공개 저장소에서 보기
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
        )}
      </PageHeader>
      {anchors.length === 0 ? (
        <EmptyState icon={Anchor}>아직 앵커가 없습니다.</EmptyState>
      ) : (
        // 사슬 레일(홈 '어떻게 작동하나요'와 같은 모양): 줄마다 왼쪽 1px 선 + 맨 위 9px 속 빈 인디고 원(날짜 줄 가운데). 마지막 줄 아래로는
        // 선을 잇지 않는다(last:before:hidden). 선은 ::before로 '이 원 → 다음 원'만 긋는다(top 7px ~ 아래로 7px 더): li 테두리로 그리면
        // 첫 원 위로 꼬리가 남고 마지막 원 앞에서 선이 끊긴다. 원은 장식이라 화면낭독기에서 숨긴다. 움직이지 않는다(정적).
        <ol>
          {anchors.map((a) => (
            // 모든 폭에서 날짜 → 요약 → 문서 버튼 순으로 한 칸(grid-cols-1 = minmax(0,1fr))에 쌓는다. 넓은 화면에서 버튼만 오른쪽 끝 칸에 두면
            // 글이 끝나는 곳에서 200px쯤 떨어져 레일 위에 떠 있어 어느 기록의 버튼인지 이어 보기 어렵다. 글 칸 min-w-0: 긴 값이 있어도 줄을 넘기지 않는다.
            <li
              key={a.date}
              className="relative grid grid-cols-1 gap-y-2 border-l border-transparent pb-8 pl-7 before:absolute before:top-[7px] before:-bottom-[7px] before:-left-px before:w-px before:bg-line-strong last:pb-0 last:before:hidden sm:pl-9"
            >
              <span aria-hidden="true" className="absolute top-[7px] -left-[5px] size-[9px] rounded-full border border-link bg-background" />
              <div className="min-w-0 space-y-1.5">
                <p className="font-mono text-[0.9375rem] leading-6 font-medium text-foreground tabular-nums">{a.date}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  에이전트 {a.leaf_count}개 · 생성 {kstDateTime(a.created_at)} · 루트 <HashText value={a.merkle_root} head={12} copyLabel="루트" />
                </p>
              </div>
              {/* 격자 칸 너비만큼 늘어나지 않게 justify-self-start를 cn으로 덧붙인다(outline 테두리색과 기본 border-transparent의 병합은
                  buttonVariants 안에서 cn이 한다) */}
              <a href={`/api/anchors/${a.date}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "justify-self-start")}>
                문서(JSON)
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
