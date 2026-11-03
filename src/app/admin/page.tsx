import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AGENT_STATUS_LABEL, MARKET_LABEL, STRATEGY_LABEL, STYLE_LABEL, kstDateTime, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/admin-auth";
import { getDb } from "@/server/db";
import { listAgents } from "@/server/repo/agents";
import { ADMIN_PAGE_SIZE, type AdminProvider, type AdminProviderView, countProvidersForAdmin, listApprovedProviders, listProvidersForAdmin } from "@/server/repo/providers";
import { listAgentSignals } from "@/server/repo/signals";
import { HOURLY_REGISTRATION_LIMIT } from "@/server/services/registration";
import { meetsVerificationPeriod } from "@/lib/agent-rules";
import { anonymizeProviderAction, setProviderStatusAction } from "./actions";
import { AgentStatusForm, AnchorButton, ConfirmSubmit, CreateAgentForm, PublishForm, SignalEventForm } from "./forms";
import { clearOptionalConsentAction, rejectPendingSinceAction } from "./provider-actions";

export const metadata: Metadata = { title: "운영자", robots: { index: false } };
export const dynamic = "force-dynamic";
// 발행·앵커 서버 액션이 타임스탬프 기관(TSA)에 요청한다(기관당 최대 10초). 서버리스 기본 제한에 걸리지 않게 늘려 둔다.
export const maxDuration = 60;

// 사전등록 목록은 구분별로 100건씩 나눠 본다(?view=·?page=). 한 목록에 모두 그리면 스크립트 등록이 쌓였을 때 화면이 무거워지고 정상 등록이 묻힌다.
const VIEWS: { key: AdminProviderView; param: string; label: string }[] = [
  { key: "PENDING", param: "pending", label: "대기" },
  { key: "APPROVED", param: "approved", label: "승인" },
  { key: "REJECTED", param: "rejected", label: "거절" },
  { key: "WITHDRAWN", param: "withdrawn", label: "탈퇴" },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function Section({ title, children, desc }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{title}</h2>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function ProviderStatusBadge({ p }: { p: AdminProvider }) {
  if (p.withdrawn) return <Badge variant="outline">탈퇴 처리됨</Badge>;
  return <Badge variant={p.status === "APPROVED" ? "default" : "outline"}>{p.status === "APPROVED" ? "승인" : p.status === "PENDING" ? "대기" : "거절"}</Badge>;
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.param === first(sp.view)) ?? VIEWS[0];
  const pageNo = Math.min(Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1), 100_000); // 화면의 쪽 번호는 1부터
  const db = await getDb();
  // 에이전트 소유자 목록은 사전등록 목록과 따로 읽는다(대기 등록이 아무리 많아도 승인된 공급자의 에이전트를 만들 수 있게).
  const [counts, providers, approvedProviders, agents] = await Promise.all([
    countProvidersForAdmin(db),
    listProvidersForAdmin(db, view.key, pageNo - 1),
    listApprovedProviders(db),
    listAgents(db),
  ]);
  const open = (await Promise.all(agents.map(async (a) => (await listAgentSignals(db, a.id)).filter((s) => !s.event).map((s) => ({ ...s, agentName: a.name }))))).flat();
  const total = counts[view.key];
  const shownFrom = providers.length ? (pageNo - 1) * ADMIN_PAGE_SIZE + 1 : 0;
  const shownTo = (pageNo - 1) * ADMIN_PAGE_SIZE + providers.length;
  // 일괄 거절 입력칸의 기본값: 지금부터 1시간 전(KST, datetime-local 형식)
  const sinceDefault = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16);
  return (
    <div className="space-y-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">운영자 화면</h1>
        <p className="text-sm text-muted-foreground">
          사전등록 대기 {counts.PENDING} · 승인 {counts.APPROVED} · 거절 {counts.REJECTED} · 탈퇴 {counts.WITHDRAWN} · 에이전트 {agents.length}개 · 청산 전 시그널{" "}
          {open.length}건
        </p>
        {counts.lastHour >= HOURLY_REGISTRATION_LIMIT && (
          <p role="status" className="rounded-xl border border-destructive/40 px-5 py-4 text-sm text-destructive">
            최근 1시간 대기 등록이 {counts.lastHour}건이라 새 등록을 자동으로 받지 않고 있습니다(최근 1시간 대기 {HOURLY_REGISTRATION_LIMIT}건까지). 스팸이면
            대기 목록에서 일괄 거절하세요. 거절하면 바로 다시 열립니다.
          </p>
        )}
      </div>

      <Section title="사전등록 공급자" desc="이메일은 이 화면에서만 보이며, 인터뷰·소식 메일은 해당 동의가 있는 사람에게만 보냅니다.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>승인하면 소개·채널이 공개 프로필에 그대로 실립니다. 승인 전에 각 행의 &apos;공개될 내용&apos;을 확인하세요.</li>
          <li>
            사이트에는 이메일 소유 확인 기능이 없습니다. 등록 이메일로 본인 확인 메일을 보내 회신을 받은 뒤 승인하고, 본인이 아니라는 회신이 오거나 회신이
            없으면 승인하지 말고 탈퇴 처리하세요.
          </li>
          <li>만 19세 미만으로 확인되면 승인하지 말고 탈퇴 처리하세요.</li>
          <li>
            탈퇴 처리: 승인된 적 없고 에이전트도 없는 등록은 모든 항목을 지웁니다(같은 주소로 다시 등록할 수 있음). 그 밖에는 연락처·소개·채널·초대 관계·선택
            동의를 지우고 필명·에이전트 이름을 바꾸며, 주소는 사용 중지로 남깁니다.
          </li>
          <li>인터뷰 연락 철회·소식 수신 거부를 알려 오면 이메일 칸의 버튼으로 그 동의만 지우세요(본인 확인·회신 기한은 DEPLOY.md).</li>
          <li>
            공급자 에이전트의 주소·이름·설명과 시그널의 규칙 버전·근거에는 필명·프로필 주소·연락처(메일·링크·메신저 아이디·전화번호)를 넣지 마세요. 탈퇴한
            뒤에도 기록은 계속 공개됩니다. 화면은 메일·링크·@아이디·휴대전화 번호 형태와 필명·주소와 같은 표기만 거르고 바꿔 쓴 표기·&apos;@&apos; 없는
            아이디·유선 번호는 못 거르니, 붙여 넣기 전에 직접 확인하세요.
          </li>
        </ul>

        <nav aria-label="사전등록 구분" className="flex flex-wrap gap-2">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/admin?view=${v.param}`}
              aria-current={v.key === view.key ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                v.key === view.key ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label} {counts[v.key]}
            </Link>
          ))}
        </nav>

        {view.key === "PENDING" && counts.PENDING > 0 && (
          <form action={rejectPendingSinceAction} className="flex flex-wrap items-end gap-3 rounded-xl border px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="reject-since">스팸이 몰렸을 때: 이 시각(KST) 이후에 들어온 대기 등록</Label>
              <Input id="reject-since" name="since" type="datetime-local" required defaultValue={sinceDefault} className="w-56" />
            </div>
            <ConfirmSubmit name="confirm" value="yes" label="이 시각 이후 대기 등록 모두 거절" confirmLabel="모두 거절 확인" />
          </form>
        )}

        {providers.length === 0 ? (
          <p className="rounded-xl border px-5 py-8 text-center text-sm text-muted-foreground">이 구분에 해당하는 등록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>필명 / 주소</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead>방식</TableHead>
                  <TableHead>초대</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">처리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-md align-top">
                      {p.pen_name}
                      <br />
                      <span className="text-xs text-muted-foreground">
                        @{p.handle}
                        {p.withdrawn && "(사용 중지)"} · 등록 {kstDateTime(p.created_at)}
                      </span>
                      {!p.withdrawn && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-primary">공개될 내용</summary>
                          <div className="mt-2 space-y-1">
                            <p>
                              {MARKET_LABEL[p.market]} · {STYLE_LABEL[p.holding_style]}
                            </p>
                            <p className="whitespace-pre-line">{p.description || "(소개 없음)"}</p>
                            {p.channels.map((c) => (
                              <p key={c} className="break-all">
                                {c}
                              </p>
                            ))}
                          </div>
                        </details>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      {p.withdrawn ? (
                        <span className="text-muted-foreground">(지움)</span>
                      ) : (
                        <>
                          <span className="break-all">{p.email}</span>
                          <br />
                          <span className="text-xs text-muted-foreground">
                            인터뷰 {p.consent_interview_at ? "동의" : "-"} · 소식 {p.consent_marketing_at ? "동의(발송 전 기록표의 회신 확인)" : "-"}
                          </span>
                          {/* 선택 동의만 철회(처리방침 4항). 동의가 남아 있을 때만 보인다. 등록·공개 프로필은 그대로다 */}
                          {(p.consent_interview_at || p.consent_marketing_at) && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {p.consent_interview_at && (
                                <form action={clearOptionalConsentAction}>
                                  <input type="hidden" name="providerId" value={p.id} />
                                  <ConfirmSubmit name="kind" value="interview" label="인터뷰 동의 철회" confirmLabel="철회 확인(되돌릴 수 없음)" />
                                </form>
                              )}
                              {p.consent_marketing_at && (
                                <form action={clearOptionalConsentAction}>
                                  <input type="hidden" name="providerId" value={p.id} />
                                  <ConfirmSubmit name="kind" value="marketing" label="소식 수신 거부" confirmLabel="수신 거부 확인(되돌릴 수 없음)" />
                                </form>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="align-top text-sm">{STRATEGY_LABEL[p.strategy_type]}</TableCell>
                    <TableCell className="align-top text-sm">
                      {p.referred_by_handle ? `초대한 공급자 @${p.referred_by_handle}` : "-"}
                      {p.status === "APPROVED" && (
                        <>
                          <br />
                          {/* 링크 방문 수는 스크립트로도 오를 수 있어 공개 판단 근거로 쓰지 않는다 */}
                          <span className="text-xs text-muted-foreground">
                            링크 방문 {p.referral_visits}회(중복·자동 요청 포함) · 초대로 승인 {p.referred_signups}명
                          </span>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <ProviderStatusBadge p={p} />
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {/* 탈퇴 처리한 행은 승인·거절하지 않는다(승인하면 남겨 둔 주소로 공개 프로필이 다시 열린다). 서버도 막는다 */}
                      {p.withdrawn ? (
                        <span className="text-sm text-muted-foreground">-</span>
                      ) : (
                        <div className="flex justify-end gap-2">
                          {p.status !== "APPROVED" && (
                            <form action={setProviderStatusAction}>
                              <input type="hidden" name="providerId" value={p.id} />
                              <input type="hidden" name="status" value="APPROVED" />
                              <Button size="sm" type="submit">
                                승인
                              </Button>
                            </form>
                          )}
                          {p.status !== "REJECTED" && (
                            <form action={setProviderStatusAction}>
                              <input type="hidden" name="providerId" value={p.id} />
                              <input type="hidden" name="status" value="REJECTED" />
                              <Button size="sm" variant="outline" type="submit">
                                거절
                              </Button>
                            </form>
                          )}
                          {p.status === "APPROVED" && (
                            <Link href={`/p/${p.handle}`} className="self-center text-sm text-primary">
                              프로필
                            </Link>
                          )}
                          <form action={anonymizeProviderAction}>
                            <input type="hidden" name="providerId" value={p.id} />
                            <ConfirmSubmit label="탈퇴 처리" confirmLabel="탈퇴 처리 확인(되돌릴 수 없음)" />
                          </form>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {(total > 0 || pageNo > 1) && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {view.label} {total}명 중 {shownFrom}–{shownTo}(최근 등록순, {ADMIN_PAGE_SIZE}명씩)
            </span>
            <span className="flex gap-4">
              {pageNo > 1 && (
                <Link href={`/admin?view=${view.param}&page=${pageNo - 1}`} className="text-primary">
                  이전
                </Link>
              )}
              {shownTo < total && providers.length > 0 && (
                <Link href={`/admin?view=${view.param}&page=${pageNo + 1}`} className="text-primary">
                  다음
                </Link>
              )}
            </span>
          </div>
        )}
      </Section>

      <Section title="에이전트" desc="플랫폼 운영 에이전트는 판매 시 전체의 20%를 넘지 않게 관리합니다. 종료해도 기록은 계속 공개됩니다.">
        <ul className="divide-y rounded-xl border">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <Link href={`/a/${a.slug}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {a.is_platform_owned ? "플랫폼 운영" : `@${a.provider_handle}`} · 기록 {a.chain_length}건 · 마지막 {kstDateTime(a.last_published_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{AGENT_STATUS_LABEL[a.status]}</Badge>
                <AgentStatusForm
                  agentId={a.id}
                  status={a.status}
                  eligible={meetsVerificationPeriod(a)}
                />
              </div>
            </li>
          ))}
        </ul>
        <CreateAgentForm providers={approvedProviders.map((p) => ({ id: p.id, handle: p.handle, pen_name: p.pen_name }))} />
      </Section>

      <Section
        title="시그널 발행(봉인)"
        desc="자체 에이전트는 장 시작 전(08:30 이전)에 발행하세요. 공급자 시그널은 받은 메일의 값을 그대로 옮겨 여기서 봉인합니다. 기록 시각은 메일을 보낸 때가 아니라 봉인한 때이고, 진입 기준도 봉인 뒤의 타임스탬프로 정해집니다(DEPLOY.md 8절). 1R은 KOSPI·KOSDAQ 시그널만 봉인합니다(공개 기한·진입 기준이 KRX 시간 기준)."
      >
        {agents.length ? <PublishForm agents={agents.map((a) => ({ id: a.id, name: a.name, status: a.status }))} /> : <p className="text-sm text-muted-foreground">먼저 에이전트를 만드세요.</p>}
      </Section>

      <Section title="청산 전 시그널" desc="청산·만료·무효로 처리하면 원문이 공개됩니다. 되돌릴 수 없습니다.">
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">없음</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {open.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                <span>
                  {s.agentName} #{s.sequence_no} · {s.ticker} {s.side} {s.action} · {kstDateTime(s.published_at)} · <code>{shortHash(s.content_hash)}</code>
                </span>
                <SignalEventForm signalId={s.id} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="일일 앵커"
        desc="보통은 공개 앵커 저장소의 GitHub Actions가 매일 18시(KST) 무렵 만들고 그 저장소에 올립니다. 이 버튼은 그날 자동 실행이 실패했을 때 18시 이후·24시 전에 복구용으로만 쓰세요. 일찍 누르면 그날 앵커가 그 시각으로 확정되어 이후 발행분은 다음 날 앵커에 담깁니다(같은 날짜는 한 번만 만들어집니다). 첫 앵커가 만들어진 뒤에는 서명 키를 다시 만들거나 DB를 새로 만들면 안 됩니다(DEPLOY.md)."
      >
        <AnchorButton />
      </Section>
    </div>
  );
}
