import type { Metadata } from "next";
import { kstDateTime, shortHash } from "@/lib/format";
import { anchorRepo } from "@/server/config";
import { getDb } from "@/server/db";
import { listAnchors } from "@/server/services/anchor";

export const metadata: Metadata = { title: "외부 고정 기록" };
export const dynamic = "force-dynamic";

export default async function AnchorsPage() {
  const anchors = await listAnchors(await getDb());
  const repo = anchorRepo().url;
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">외부 고정 기록(일일 앵커)</h1>
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
          <a href={repo} className="text-sm text-primary underline-offset-4 hover:underline" target="_blank" rel="noopener noreferrer">
            공개 저장소에서 보기
          </a>
        )}
      </div>
      {anchors.length === 0 ? (
        <p className="rounded-xl border px-5 py-8 text-center text-muted-foreground">아직 앵커가 없습니다.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {anchors.map((a) => (
            <li key={a.date} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="space-y-1">
                <p className="font-medium">{a.date}</p>
                <p className="text-sm text-muted-foreground">
                  에이전트 {a.leaf_count}개 · 생성 {kstDateTime(a.created_at)} · 루트 <code>{shortHash(a.merkle_root, 12)}</code>
                </p>
              </div>
              <a href={`/api/anchors/${a.date}`} className="text-sm text-primary underline-offset-4 hover:underline">
                문서(JSON)
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
