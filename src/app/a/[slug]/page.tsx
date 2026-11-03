import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isAgentPublic } from "@/lib/agent-visibility";
import { AGENT_STATUS_LABEL, EVENT_LABEL, kstDateTime, shortHash } from "@/lib/format";
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
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{AGENT_STATUS_LABEL[a.status]}</Badge>
          {a.is_platform_owned && <Badge variant="secondary">플랫폼 운영</Badge>}
          {!providerActive && <Badge variant="outline">공급자 비활성(기록은 계속 공개)</Badge>}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{a.name}</h1>
        {a.provider_handle && (
          <p className="text-sm text-muted-foreground">
            공급자{" "}
            {providerActive ? (
              <Link href={`/p/${a.provider_handle}`} className="text-primary underline-offset-4 hover:underline">
                {a.provider_pen_name}
              </Link>
            ) : (
              a.provider_pen_name
            )}
          </p>
        )}
        {a.description && <p className="max-w-2xl leading-relaxed text-muted-foreground">{a.description}</p>}
        <p className="text-sm text-muted-foreground">
          봉인된 기록 {a.chain_length}건 · 마지막 지문 <code>{shortHash(a.head_hash)}</code>
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-bold">기록</h2>
        {signals.length === 0 ? (
          <p className="rounded-xl border px-5 py-8 text-center text-muted-foreground">아직 봉인된 시그널이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">순번</TableHead>
                  <TableHead>발행(서버 접수)</TableHead>
                  <TableHead>내용</TableHead>
                  <TableHead>지문</TableHead>
                  <TableHead>외부 시각</TableHead>
                  <TableHead className="text-right">검증</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.map((s) => {
                  const rv = revealOf(s);
                  return (
                  <TableRow key={s.id}>
                    <TableCell>{s.sequence_no}</TableCell>
                    <TableCell className="whitespace-nowrap">{kstDateTime(s.published_at)}</TableCell>
                    <TableCell>
                      {rv.revealed ? (
                        <span>
                          {/* 방향은 시그널이 낸 예상이지 결과가 아니다(맨 '상승'은 주가가 올랐다는 결과로 읽힌다). 원래 값(LONG/SHORT)을 앞에 둬 검증 화면의 정규 문자열과 바로 대조된다 */}
                          {s.ticker} · {s.side === "LONG" ? "LONG(상승 예상)" : "SHORT(하락 예상)"} · {s.action === "ENTRY" ? "진입" : "청산"}
                          <span className="ml-2 text-xs text-muted-foreground">({s.event ? `${EVENT_LABEL[s.event]} 후 공개` : rv.reason})</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {/* 기한이 없는 것은 청산(EXIT) 기록뿐이다(진입은 발행 때 기한이 필수). */}
                          원문 비공개{rv.deadline ? ` — 늦어도 ${kstDateTime(rv.deadline.toISOString())} 공개` : " — 일일 앵커에 고정되면 공개"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{shortHash(s.content_hash)}</code>
                    </TableCell>
                    <TableCell className="text-sm">{tsa.get(s.id) ? `${tsa.get(s.id)}곳` : <span className="text-muted-foreground">없음</span>}</TableCell>
                    <TableCell className="text-right">
                      {/* 지문으로 링크한다: ID를 바꿔치기해도 이 링크는 이 기록만 가리킨다 */}
                      <Link href={`/verify/${s.content_hash}`} className="text-sm text-primary underline-offset-4 hover:underline">
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
        <p className="text-sm leading-relaxed text-muted-foreground">
          모든 기록은 모의(페이퍼) 기준이며 투자 권유가 아닙니다. 원문은 정해진 규칙에 따라 공개됩니다. 운영자가 청산·만료·무효로 처리한 기록은 바로
          공개되고, 청산 시그널은 일일 앵커에 고정되면 짝이 되는 진입과 함께 공개됩니다. 그렇지 않아도 진입은 공개 기한이 지나면 운영자 처리와 상관없이
          공개됩니다. 공개 기한은 유효기한과 최대 보유 거래일 마감(발행일을 1일째로 센 마지막 거래일 15:30) 중 이른 때이며, 비공개 기록마다 늦어도 공개되는
          시각을 함께 표시합니다.
        </p>
      </section>
    </div>
  );
}
