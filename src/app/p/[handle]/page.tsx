import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { AGENT_STATUS_LABEL, MARKET_LABEL, STRATEGY_LABEL, STYLE_LABEL, kstDateTime } from "@/lib/format";
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
    <div className="space-y-14">
      <section className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{STRATEGY_LABEL[p.strategy_type]}</Badge>
          <Badge variant="outline">{MARKET_LABEL[p.market]}</Badge>
          <Badge variant="outline">{STYLE_LABEL[p.holding_style]}</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{p.pen_name}</h1>
        {p.description && <p className="max-w-2xl leading-relaxed whitespace-pre-line text-muted-foreground">{p.description}</p>}
        {channels.length > 0 && (
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {channels.map((c) => (
              <li key={c.href}>
                <a href={c.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline-offset-4 hover:underline">
                  {c.label}
                </a>
              </li>
            ))}
          </ul>
        )}
        {/* '승인'은 운영자가 실력을 심사·보증한 것처럼 읽힌다 → 실제 뜻(프로필이 열린 시각)을 쓴다. 가입 경로 기능은 '초대'라 부른다
            (투자 사이트에서 종목을 권하는 말로 읽히는 표현을 피한다). 접속 수는 프로필 공유 링크와 사전등록 초대 링크(?ref=)를 합친 값이고,
            같은 브라우저는 하루 1회만 세지만(referral-tracker) 자동 요청은 거르지 못해 참고용으로만 적는다. */}
        <p className="text-sm text-muted-foreground">
          프로필 공개 {kstDateTime(p.approved_at)} · 공유·초대 링크 접속 {p.referral_visits}회(같은 브라우저는 하루 1회, 자동 요청은 걸러지지 않음·참고용) ·
          이 공급자의 링크로 등록해 프로필이 열린 공급자 {p.referred_signups}명
        </p>
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-bold">결과 전 기록</h2>
        {agents.length === 0 ? (
          <p className="rounded-xl border px-5 py-8 text-center text-muted-foreground">아직 기록을 시작하지 않았습니다. 첫 시그널이 봉인되면 여기에 표시됩니다.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {agents.map((a) => (
              <li key={a.id}>
                <Link href={`/a/${a.slug}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-muted/50">
                  <div className="space-y-1">
                    <p className="font-medium">{a.name}</p>
                    <p className="text-sm text-muted-foreground">
                      봉인된 기록 {a.chain_length}건 · 마지막 발행 {kstDateTime(a.last_published_at)}
                    </p>
                  </div>
                  <Badge variant="outline">{AGENT_STATUS_LABEL[a.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {/* 앵커 전에 사슬 끝 기록을 지우면 다음 앵커에도 흔적이 남지 않는다(services/anchor.ts는 직전 앵커와의 접두만 비교). 그래서 조건을 함께 쓴다. */}
        <p className="text-sm leading-relaxed text-muted-foreground">
          수익률은 시세 데이터 이용계약 전이라 표시하지 않습니다. 각 기록은 결과 전에 봉인됐고, 일일 앵커로 외부에 고정된 뒤에는 지우거나 바꾸면 드러납니다.
        </p>
      </section>

      <section className="space-y-4 rounded-xl bg-muted/60 px-6 py-7">
        <h2 className="font-bold">이 프로필 공유하기</h2>
        <CopyField label="공유 링크" hint="이 링크로 들어온 접속과, 이 링크로 들어와 등록해 프로필이 열린 공급자가 이 공급자에게 집계됩니다." value={shareUrl} />
      </section>
    </div>
  );
}
