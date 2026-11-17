import type { Metadata } from "next";
import { FileLock, Lock } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/empty-state";
import { HashText } from "@/components/hash-text";
import { KpiGrid, KpiTile } from "@/components/kpi";
import { TYPE } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isAgentPublic } from "@/lib/agent-visibility";
import { AGENT_STATUS_LABEL, EVENT_LABEL, kstDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { getAgentBySlug } from "@/server/repo/agents";
import { countTimestampsByAgent, listAgentSignals, revealOf } from "@/server/repo/signals";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = await getAgentBySlug(await getDb(), slug);
  // 페이지와 같은 공개 규칙. 숨긴 에이전트는 없는 주소와 같은 제목을 준다(404 응답에 이름이 실리거나 주소가 있는지 드러나지 않게).
  return { title: a && isAgentPublic(a) ? `${a.name} 기록` : "에이전트를 찾을 수 없습니다" };
}

export default async function AgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDb();
  const a = await getAgentBySlug(db, slug);
  // 봉인 기록이 생긴 에이전트는 공급자를 거절·탈퇴 처리해도 계속 공개한다(실패 기록이 사라지지 않게). 기록이 없을 때만 숨긴다.
  if (!a || !isAgentPublic(a)) notFound();
  const providerActive = a.is_platform_owned || a.provider_status === "APPROVED";
  const signals = await listAgentSignals(db, a.id);
  const tsa = await countTimestampsByAgent(db, a.id);
  return (
    <div className="space-y-12">
      <section className="space-y-6">
        <div className="space-y-4">
          {/* 배지는 무채색만 쓴다('기록 기준 충족'을 초록으로 칠하면 합격·보증처럼 읽힌다) */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{AGENT_STATUS_LABEL[a.status]}</Badge>
            {a.is_platform_owned && <Badge variant="secondary">플랫폼 운영</Badge>}
            {!providerActive && <Badge variant="outline">공급자 비활성(기록은 계속 공개)</Badge>}
          </div>
          <h1 className={TYPE.title}>{a.name}</h1>
          {a.provider_handle && (
            <p className="text-sm text-muted-foreground">
              공급자{" "}
              {providerActive ? (
                <Link
                  href={`/p/${a.provider_handle}`}
                  className="font-medium text-link underline underline-offset-4 transition-colors hover:text-foreground"
                >
                  {a.provider_pen_name}
                </Link>
              ) : (
                a.provider_pen_name
              )}
            </p>
          )}
          {a.description && <p className={cn(TYPE.body, "max-w-2xl")}>{a.description}</p>}
        </div>
        {/* 칸 3개 = KpiGrid 기본 열 수(sm:grid-cols-3). 칸을 늘리거나 줄이면 열 수도 맞춘다(빈 칸이 선 색으로 보임). */}
        <KpiGrid>
          {/* KpiTile 값 칸은 mono인데 이 값에는 한글 단위('건')가 붙는다 → 값째 본문 글꼴로 감싼다(한글을 mono 안에 넣지 않음, 문구는 그대로) */}
          <KpiTile label="봉인된 기록" value={<span className="font-sans">{`${a.chain_length}건`}</span>} />
          <KpiTile label="마지막 발행" value={kstDateTime(a.last_published_at)} />
          <KpiTile label="마지막 지문" value={<HashText value={a.head_hash} copyLabel="지문" />} />
        </KpiGrid>
      </section>

      <section className="space-y-5">
        <h2 className={TYPE.block}>기록</h2>
        {signals.length === 0 ? (
          <EmptyState icon={FileLock}>아직 봉인된 시그널이 없습니다.</EmptyState>
        ) : (
          // 가로 스크롤은 Table 안쪽 칸이 맡는다. 바깥은 둥근 모서리로 자르기만 한다(overflow-hidden).
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 sm:w-16">순번</TableHead>
                  <TableHead className="hidden md:table-cell">발행(서버 접수)</TableHead>
                  <TableHead>내용</TableHead>
                  <TableHead className="hidden lg:table-cell">지문</TableHead>
                  <TableHead className="hidden lg:table-cell">외부 시각</TableHead>
                  <TableHead className="text-right">검증</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((s) => {
                  const rv = revealOf(s);
                  return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{s.sequence_no}</TableCell>
                    <TableCell className="hidden font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums md:table-cell">{kstDateTime(s.published_at)}</TableCell>
                    {/* 표가 가로로 잘리지 않게 폭에 따라 칸을 줄인다: 1024px 미만은 지문·외부 시각(검증 화면에 있음)을, 768px 미만은 발행 칸도 숨기고 발행 시각을 내용 아래 한 줄로 옮긴다(한쪽만 보이므로 화면낭독기도 한 번만 읽음) */}
                    <TableCell className="max-md:whitespace-normal">
                      {rv.revealed ? (
                        <span className="text-foreground">
                          {/* 방향은 시그널이 낸 예상이지 결과가 아니다(맨 '상승'은 주가가 올랐다는 결과로 읽힌다). 원래 값(LONG/SHORT)을 앞에 둬 검증 화면의 정규 문자열과 바로 대조된다 */}
                          {s.ticker} · {s.side === "LONG" ? "LONG(상승 예상)" : "SHORT(하락 예상)"} · {s.action === "ENTRY" ? "진입" : "청산"}
                          {/* 공개 사유: 휴대폰(sm 미만)은 내용 아래 한 줄(block, 들여쓰기 없음), sm 이상은 같은 줄 뒤(inline + 왼쪽 8px).
                              inline에 ml-2만 주면 좁은 칸에서 사유가 줄 맨 앞으로 넘어갈 때 8px 들여쓴 채로 시작한다 */}
                          <span className="mt-1 block text-xs text-tertiary sm:mt-0 sm:ml-2 sm:inline">({s.event ? `${EVENT_LABEL[s.event]} 후 공개` : rv.reason})</span>
                        </span>
                      ) : (
                        // 자물쇠는 '아직 비공개'를 글자 앞에서 한눈에 보이게 하는 장식이다(뜻은 뒤의 글자가 전한다 → 화면낭독기에는 숨김)
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          <Lock aria-hidden="true" className="size-3.5 shrink-0 text-tertiary" />
                          {/* 기한이 없는 것은 청산(EXIT) 기록뿐이다(진입은 발행 때 기한이 필수). */}
                          원문 비공개{rv.deadline ? ` — 늦어도 ${kstDateTime(rv.deadline.toISOString())} 공개` : " — 일일 앵커에 고정되면 공개"}
                        </span>
                      )}
                      <span className="mt-1 block font-mono text-xs text-tertiary tabular-nums md:hidden">{kstDateTime(s.published_at)}</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <HashText value={s.content_hash} className="text-xs text-muted-foreground" />
                    </TableCell>
                    <TableCell className="hidden tabular-nums lg:table-cell">{tsa.get(s.id) ? `${tsa.get(s.id)}곳` : <span className="text-tertiary">없음</span>}</TableCell>
                    <TableCell className="text-right">
                      {/* 지문으로 링크한다: ID를 바꿔치기해도 이 링크는 이 기록만 가리킨다 */}
                      <Link href={`/verify/${s.content_hash}`} className="text-sm font-medium text-link underline-offset-4 hover:underline">
                        직접 검증
                      </Link>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {/* reveal.ts 규칙과 같게 쓴다. 처리 기록은 그 기록만 공개한다(청산에 처리를 적어도 짝 진입은 앵커 고정 전까지 비공개). */}
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          모든 기록은 모의(페이퍼) 기준이며 투자 권유가 아닙니다. 원문은 정해진 규칙에 따라 공개됩니다. 운영자가 청산·만료·무효로 처리한 기록은 바로
          공개되고, 청산 시그널은 일일 앵커에 고정되면 짝이 되는 진입과 함께 공개됩니다. 그렇지 않아도 진입은 공개 기한이 지나면 운영자 처리와 상관없이
          공개됩니다. 공개 기한은 유효기한과 최대 보유 거래일 마감(발행일을 1일째로 센 마지막 거래일 15:30) 중 이른 때이며, 비공개 기록마다 늦어도 공개되는
          시각을 함께 표시합니다.
        </p>
      </section>
    </div>
  );
}
