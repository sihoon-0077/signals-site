import type { Metadata } from "next";
import { ChevronRight, ExternalLink, FileLock } from "lucide-react";
import { notFound } from "next/navigation";
import { CopyField } from "@/components/copy-field";
import { EmptyState } from "@/components/empty-state";
import { ListLinkRow, ListPanel, Panel } from "@/components/panel";
import { TYPE } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { AGENT_STATUS_LABEL, MARKET_LABEL, STRATEGY_LABEL, STYLE_LABEL, kstDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { siteUrl } from "@/server/config";
import { getDb } from "@/server/db";
import { listAgentsByProvider } from "@/server/repo/agents";
import { getApprovedProviderByHandle } from "@/server/repo/providers";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const p = await getApprovedProviderByHandle(await getDb(), handle);
  if (!p) return { title: "공급자를 찾을 수 없습니다" };
  // 검색 결과·공유 미리보기(og:description)에 쓰인다. 승인 직후(기록 0건)와 오늘 발행해 아직 앵커 전인 기록에도 맞게,
  // '외부에 고정한'(이미 끝남)이 아니라 하는 일(매일 고정하는)로 쓴다(공유 카드 문구 opengraph-image.tsx와 같게).
  return {
    title: `${p.pen_name}의 결과 전 기록`,
    description: `${p.pen_name} — ${STRATEGY_LABEL[p.strategy_type]} · ${STYLE_LABEL[p.holding_style]}. 결과 전에 봉인해 매일 외부에 고정하는 모의(페이퍼) 시그널 기록입니다. 수익을 보장하지 않습니다.`,
  };
}

export default async function ProviderPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const db = await getDb();
  const p = await getApprovedProviderByHandle(db, handle);
  if (!p) notFound();
  const agents = await listAgentsByProvider(db, p.id);
  const base = siteUrl();
  const shareUrl = `${base}/p/${p.handle}?ref=${p.referral_code}`;
  // 저장된 값이라도 http(s)만 링크로 그린다(예전 데이터·검증 우회 대비). 같은 사이트의 채널끼리 구분되게 경로 일부도 보여 준다.
  const channels = p.channels.flatMap((c) => {
    try {
      const u = new URL(c);
      if (u.protocol !== "https:" && u.protocol !== "http:") return [];
      const path = u.pathname.replace(/\/$/, "");
      return [{ href: u.href, label: `${u.hostname}${path ? path.slice(0, 24) : ""}` }];
    } catch {
      return [];
    }
  });
  return (
    <div className="space-y-12">
      <section className="space-y-5">
        {/* 프로필 머리: 왼쪽 모노그램이 두 줄(배지 줄 + 이름 줄)에 걸치고 오른쪽에 배지와 이름(h1)을 둔다. 모노그램만 위에 홀로 쌓으면
            이름과 떨어진 아이콘처럼 보인다. 읽는 순서(모노그램 → 배지 → h1)와 문구는 그대로이고, 오른쪽 칸은 minmax(0,1fr)라 긴 필명도 줄을 바꾼다. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 sm:gap-x-5">
          {/* 모노그램: 필명 첫 글자(Array.from은 코드 포인트 단위라 이모지 같은 서로게이트 쌍을 반으로 자르지 않는다).
              데이터에서 만든 장식이고 옆 h1이 같은 이름을 읽어 주므로 화면낭독기에서는 숨긴다(새 문구 없음) */}
          <span aria-hidden="true" className="row-span-2 grid size-12 place-items-center rounded-2xl border bg-raised text-xl font-semibold text-foreground elev-lift sm:size-14 sm:text-2xl">
            {Array.from(p.pen_name)[0] ?? ""}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{STRATEGY_LABEL[p.strategy_type]}</Badge>
            <Badge variant="outline">{MARKET_LABEL[p.market]}</Badge>
            <Badge variant="outline">{STYLE_LABEL[p.holding_style]}</Badge>
          </div>
          <h1 className={TYPE.title}>{p.pen_name}</h1>
        </div>
        {p.description && <p className={cn(TYPE.body, "max-w-2xl whitespace-pre-line")}>{p.description}</p>}
        {channels.length > 0 && (
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {channels.map((c) => (
              <li key={c.href} className="min-w-0">
                {/* 바깥 채널(새 탭): 밑줄로 링크임을 보이고, 화살표 아이콘은 장식이라 화면낭독기에는 숨긴다. 긴 주소는 줄바꿈해 화면 밖으로 넘치지 않게 한다. */}
                <a
                  href={c.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-full items-center gap-1 break-all text-link underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  {c.label}
                  <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        )}
        {/* '승인'은 운영자가 실력을 심사·보증한 것처럼 읽힌다 → 실제 뜻(프로필이 열린 시각)을 쓴다. 가입 경로 기능은 '초대'라 부른다
            (투자 사이트에서 종목을 권하는 말로 읽히는 표현을 피한다). 접속 수는 프로필 공유 링크와 사전등록 초대 링크(?ref=)를 합친 값이고,
            같은 브라우저는 하루 1회만 세지만(referral-tracker) 자동 요청은 거르지 못해 참고용으로만 적는다. */}
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          프로필 공개 {kstDateTime(p.approved_at)} · 공유·초대 링크 접속 {p.referral_visits}회(같은 브라우저는 하루 1회, 자동 요청은 걸러지지 않음·참고용) ·
          이 공급자의 링크로 등록해 프로필이 열린 공급자 {p.referred_signups}명
        </p>
      </section>

      <section className="space-y-4">
        <h2 className={TYPE.block}>결과 전 기록</h2>
        {agents.length === 0 ? (
          <EmptyState icon={FileLock}>아직 기록을 시작하지 않았습니다. 첫 시그널이 봉인되면 여기에 표시됩니다.</EmptyState>
        ) : (
          <ListPanel>
            {agents.map((a) => (
              // 줄 전체가 링크라는 단서: 줄 오른쪽 끝의 화살표(장식, aria-hidden). 내용 칸 | 화살표 칸의 2칸 격자라 휴대폰에서 배지가
              // 아래 줄로 내려가도 화살표는 줄 오른쪽 끝 가운데에 남는다. 마우스를 올리면 2px 밀린다(홈 목록과 같은 모양).
              <ListLinkRow key={a.id} href={`/a/${a.slug}`} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-base font-medium text-foreground">{a.name}</p>
                    {/* 라벨(한글)은 본문 글꼴, 시각 값만 고정폭: 한글을 고정폭 글꼴 안에 두면 빈칸이 고정폭이 되어 띄엄띄엄 보인다 */}
                    <p className="text-[0.8125rem] text-tertiary tabular-nums">
                      봉인된 기록 {a.chain_length}건 · 마지막 발행 <span className="font-mono whitespace-nowrap">{kstDateTime(a.last_published_at)}</span>
                    </p>
                  </div>
                  {/* 상태 배지는 무채색 테두리(기록 기준 충족도 초록으로 칠하지 않는다: 합격·보증처럼 읽힘) */}
                  <Badge variant="outline">{AGENT_STATUS_LABEL[a.status]}</Badge>
                </div>
                <ChevronRight aria-hidden="true" className="size-4 text-tertiary transition-transform duration-150 group-hover:translate-x-0.5" />
              </ListLinkRow>
            ))}
          </ListPanel>
        )}
        {/* 앵커 전에 사슬 끝 기록을 지우면 다음 앵커에도 흔적이 남지 않는다(services/anchor.ts는 직전 앵커와의 접두만 비교). 그래서 조건을 함께 쓴다. */}
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          수익률은 시세 데이터 이용계약 전이라 표시하지 않습니다. 각 기록은 결과 전에 봉인됐고, 일일 앵커로 외부에 고정된 뒤에는 지우거나 바꾸면 드러납니다.
        </p>
      </section>

      <Panel as="section" pad="lg" className="space-y-4">
        <h2 className={TYPE.card}>이 프로필 공유하기</h2>
        <CopyField label="공유 링크" hint="이 링크로 들어온 접속과, 이 링크로 들어와 등록해 프로필이 열린 공급자가 이 공급자에게 집계됩니다." value={shareUrl} />
      </Panel>
    </div>
  );
}
