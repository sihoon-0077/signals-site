import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { HashText } from "@/components/hash-text";
import { PageHeader } from "@/components/page-header";
import { ListPanel, ListRow } from "@/components/panel";
import { type PillKind, StatusPill } from "@/components/status-pill";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AGENT_STATUS_LABEL, MARKET_LABEL, STRATEGY_LABEL, STYLE_LABEL, kstDateTime } from "@/lib/format";
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

// 섹션 제목은 이 배열 한 곳에만 둔다. 이동 메뉴(넓은 화면은 왼쪽, 좁은 화면은 위)와 각 섹션의 h2가 같은 글을 쓰고, id는 메뉴의 #주소가 된다.
// 메뉴 항목을 따로 적으면 섹션 제목을 고칠 때 메뉴만 옛 이름으로 남는다.
const SECTIONS = [
  { id: "providers", title: "사전등록 공급자" },
  { id: "agents", title: "에이전트" },
  { id: "publish", title: "시그널 발행(봉인)" },
  { id: "open-signals", title: "청산 전 시그널" },
  { id: "anchor", title: "일일 앵커" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// 섹션 사이는 위쪽 hairline으로 나눈다(첫 섹션은 메뉴와 윗선을 맞추려고 선·여백 없음). 점프 위치는 globals.css의 scroll-padding-top이 고정 헤더만큼 띄운다.
function Section({ id, children, desc }: { id: SectionId; desc?: string; children: React.ReactNode }) {
  const title = SECTIONS.find((s) => s.id === id)?.title;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="space-y-4 border-t border-line-subtle pt-8 first:border-t-0 first:pt-0">
      <div className="space-y-1.5">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {desc && <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

// 상태는 색만으로 구분하지 않는다: StatusPill이 종류마다 모양이 다른 아이콘을 글자 앞에 붙인다(승인 통과색, 대기 대기색, 거절·탈퇴 회색).
const PROVIDER_STATUS_KIND: Record<AdminProvider["status"], PillKind> = { APPROVED: "pass", PENDING: "pending", REJECTED: "skip" };

function ProviderStatusBadge({ p }: { p: AdminProvider }) {
  if (p.withdrawn) return <StatusPill kind="skip">탈퇴 처리됨</StatusPill>;
  return <StatusPill kind={PROVIDER_STATUS_KIND[p.status]}>{p.status === "APPROVED" ? "승인" : p.status === "PENDING" ? "대기" : "거절"}</StatusPill>;
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
    <div className="space-y-8">
      <PageHeader title="운영자 화면">
        <p className="text-sm tabular-nums">
          사전등록 대기 {counts.PENDING} · 승인 {counts.APPROVED} · 거절 {counts.REJECTED} · 탈퇴 {counts.WITHDRAWN} · 에이전트 {agents.length}개 · 청산 전 시그널{" "}
          {open.length}건
        </p>
      </PageHeader>
      {counts.lastHour >= HOURLY_REGISTRATION_LIMIT && (
        // 아이콘 옆 글은 한 덩어리 그대로 둔다(flex의 익명 항목이 되어 줄이 바뀌어도 아이콘 오른쪽에 붙어 내려간다)
        <p role="status" className="flex max-w-4xl gap-3 rounded-xl border border-status-fail/40 bg-status-fail/10 px-5 py-4 text-sm leading-relaxed text-status-fail">
          <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
          최근 1시간 대기 등록이 {counts.lastHour}건이라 새 등록을 자동으로 받지 않고 있습니다(최근 1시간 대기 {HOURLY_REGISTRATION_LIMIT}건까지). 스팸이면
          대기 목록에서 일괄 거절하세요. 거절하면 바로 다시 열립니다.
        </p>
      )}

      {/* xl(1280px) 이상: 왼쪽 메뉴(11rem) + 본문. 본문 열은 minmax(0,1fr)이라 넓은 표가 열을 밀어내지 않고 표 안에서 가로로 스크롤된다.
          lg가 아니라 xl부터인 이유: 사전등록 표는 줄을 최대한 접어도 약 950px가 필요한데, 1024~1279px에서 메뉴를 옆에 두면 본문이 742~997px라
          '처리' 버튼이 화면 밖으로 밀린다. 그 폭에서는 메뉴를 위에 두어 표가 본문 폭을 다 쓴다.
          메뉴는 self-start여야 sticky가 움직일 공간(격자 칸 전체 높이)이 생긴다. top-20 = 고정 헤더(h-14) + 여백. */}
      <div className="flex flex-col gap-8 xl:grid xl:grid-cols-[11rem_minmax(0,1fr)] xl:gap-10">
        <nav className="border-b border-line-subtle pb-3 xl:sticky xl:top-20 xl:self-start xl:border-b-0 xl:pb-0">
          <ul className="-mx-3 flex flex-wrap gap-y-1 xl:flex-col xl:gap-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          <Section id="providers" desc="이메일은 이 화면에서만 보이며, 인터뷰·소식 메일은 해당 동의가 있는 사람에게만 보냅니다.">
            <ul className="max-w-4xl list-disc space-y-1.5 rounded-xl border border-line-subtle bg-inset py-4 pr-5 pl-9 text-sm leading-relaxed text-muted-foreground marker:text-tertiary">
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

            {/* 구분 탭: 지금 구분은 aria-current로 표시하고, 배경 칸(selected)과 글자 굵기도 바꿔 색만으로 구분하지 않는다 */}
            <nav aria-label="사전등록 구분" className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-inset p-1">
              {VIEWS.map((v) => (
                <Link
                  key={v.key}
                  href={`/admin?view=${v.param}`}
                  aria-current={v.key === view.key ? "page" : undefined}
                  className="rounded-md px-3 py-1 text-sm text-muted-foreground tabular-nums transition-colors hover:text-foreground aria-[current=page]:bg-selected aria-[current=page]:font-medium aria-[current=page]:text-foreground"
                >
                  {v.label} {counts[v.key]}
                </Link>
              ))}
            </nav>

            {view.key === "PENDING" && counts.PENDING > 0 && (
              // [&>button]:mb-* — 버튼(28px)을 아래끝 정렬된 입력칸(휴대폰 44px → sm 이상 40px)의 가운데 높이에 맞춘다(감싸는 요소 없이): (44-28)/2 = 8px, (40-28)/2 = 6px
              <form action={rejectPendingSinceAction} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card px-4 py-3.5 sm:px-5 [&>button]:mb-2 sm:[&>button]:mb-1.5">
                <div className="space-y-1.5">
                  <Label htmlFor="reject-since" className="leading-snug">스팸이 몰렸을 때: 이 시각(KST) 이후에 들어온 대기 등록</Label>
                  <Input id="reject-since" name="since" type="datetime-local" required defaultValue={sinceDefault} className="w-56" />
                </div>
                <ConfirmSubmit name="confirm" value="yes" label="이 시각 이후 대기 등록 모두 거절" confirmLabel="모두 거절 확인" />
              </form>
            )}

            {providers.length === 0 ? (
              <EmptyState className="py-6">이 구분에 해당하는 등록이 없습니다.</EmptyState>
            ) : (
              // 바깥 칸은 둥근 테두리만 잘라 주고(overflow-hidden), 가로 스크롤은 Table이 감싼 안쪽 칸이 맡는다
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table>
                  <TableHeader className="bg-raised">
                    <TableRow>
                      <TableHead>필명 / 주소</TableHead>
                      <TableHead>이메일</TableHead>
                      <TableHead>방식</TableHead>
                      <TableHead>초대</TableHead>
                      <TableHead>상태</TableHead>
                      <TableHead className="text-right">처리</TableHead>
                    </TableRow>
                  </TableHeader>
                  {/* 줄 높이를 줄인 표(py-1.5). 칸마다 위 여백을 달리해 첫 줄의 가운데를 맞춘다: 글(20px)은 pt-2.5, 상태 알약(24px)은 pt-2, 버튼(28px)은 pt-1.5.
                      표 칸은 기본이 줄바꿈 없음(nowrap)이라, 모두 한 줄로 두면 표가 1,100~1,200px로 넓어져 1280px 화면(왼쪽 메뉴 포함)에서 오른쪽 '처리' 버튼이 밀려난다.
                      그래서 글 줄(동의 안내·초대 칸)만 whitespace-normal로 풀고, 식별자 줄(@주소·등록 시각, 이메일)은 한 줄로 둔다(하이픈에서 끊기지 않게). */}
                  <TableBody>
                    {providers.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-md pt-2.5 pb-1.5 align-top font-medium">
                          {p.pen_name}
                          <br />
                          <span className="text-xs font-normal text-tertiary">
                            @{p.handle}
                            {p.withdrawn && "(사용 중지)"} · 등록 {kstDateTime(p.created_at)}
                          </span>
                          {!p.withdrawn && (
                            <details className="mt-1.5 text-xs font-normal">
                              <summary className="w-fit cursor-pointer text-link">공개될 내용</summary>
                              {/* 표 칸은 줄바꿈 없음(nowrap)이 기본이라 여기서 풀어 준다. 폭은 max-w-sm으로 묶어 긴 소개·채널 주소가 열을 넓히지 않게 한다 */}
                              <div className="mt-2 max-w-sm space-y-1 rounded-lg border border-line-subtle bg-inset px-3 py-2.5 leading-relaxed whitespace-normal text-muted-foreground">
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
                        <TableCell className="pt-2.5 pb-1.5 align-top text-sm">
                          {p.withdrawn ? (
                            <span className="text-tertiary">(지움)</span>
                          ) : (
                            <>
                              <span className="break-all">{p.email}</span>
                              <br />
                              <span className="text-xs whitespace-normal text-muted-foreground">
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
                        <TableCell className="pt-2.5 pb-1.5 align-top text-sm">{STRATEGY_LABEL[p.strategy_type]}</TableCell>
                        <TableCell className="pt-2.5 pb-1.5 align-top text-sm whitespace-normal">
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
                        <TableCell className="pt-2 pb-1.5 align-top">
                          <ProviderStatusBadge p={p} />
                        </TableCell>
                        <TableCell className="py-1.5 text-right align-top">
                          {/* 탈퇴 처리한 행은 승인·거절하지 않는다(승인하면 남겨 둔 주소로 공개 프로필이 다시 열린다). 서버도 막는다 */}
                          {p.withdrawn ? (
                            <span className="text-sm leading-7 text-tertiary">-</span>
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
                                <Link href={`/p/${p.handle}`} className="self-center text-sm text-link underline underline-offset-4">
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
                <span className="tabular-nums">
                  {view.label} {total}명 중 {shownFrom}–{shownTo}(최근 등록순, {ADMIN_PAGE_SIZE}명씩)
                </span>
                <span className="flex gap-2">
                  {pageNo > 1 && (
                    <Link href={`/admin?view=${view.param}&page=${pageNo - 1}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      이전
                    </Link>
                  )}
                  {shownTo < total && providers.length > 0 && (
                    <Link href={`/admin?view=${view.param}&page=${pageNo + 1}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      다음
                    </Link>
                  )}
                </span>
              </div>
            )}
          </Section>

          <Section id="agents" desc="플랫폼 운영 에이전트는 판매 시 전체의 20%를 넘지 않게 관리합니다. 종료해도 기록은 계속 공개됩니다.">
            {/* 에이전트가 하나도 없으면 빈 테두리만 남지 않게 목록 칸을 감춘다(:empty) */}
            <ListPanel className="empty:hidden">
              {agents.map((a) => (
                <ListRow key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/a/${a.slug}`} className="font-medium underline-offset-4 hover:underline">
                      {a.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-tertiary tabular-nums">
                      {a.is_platform_owned ? "플랫폼 운영" : `@${a.provider_handle}`} · 기록 {a.chain_length}건 · 마지막 {kstDateTime(a.last_published_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill kind="neutral">{AGENT_STATUS_LABEL[a.status]}</StatusPill>
                    <AgentStatusForm
                      agentId={a.id}
                      status={a.status}
                      eligible={meetsVerificationPeriod(a)}
                    />
                  </div>
                </ListRow>
              ))}
            </ListPanel>
            <CreateAgentForm providers={approvedProviders.map((p) => ({ id: p.id, handle: p.handle, pen_name: p.pen_name }))} />
          </Section>

          <Section
            id="publish"
            desc="자체 에이전트는 장 시작 전(08:30 이전)에 발행하세요. 공급자 시그널은 받은 메일의 값을 그대로 옮겨 여기서 봉인합니다. 기록 시각은 메일을 보낸 때가 아니라 봉인한 때이고, 진입 기준도 봉인 뒤의 타임스탬프로 정해집니다(DEPLOY.md 8절). 1R은 KOSPI·KOSDAQ 시그널만 봉인합니다(공개 기한·진입 기준이 KRX 시간 기준)."
          >
            {agents.length ? <PublishForm agents={agents.map((a) => ({ id: a.id, name: a.name, status: a.status }))} /> : <EmptyState className="py-6">먼저 에이전트를 만드세요.</EmptyState>}
          </Section>

          <Section id="open-signals" desc="청산·만료·무효로 처리하면 원문이 공개됩니다. 되돌릴 수 없습니다.">
            {open.length === 0 ? (
              <EmptyState className="py-6">없음</EmptyState>
            ) : (
              <ListPanel>
                {open.map((s) => (
                  <ListRow key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <span className="min-w-0 tabular-nums">
                      {s.agentName} #{s.sequence_no} · {s.ticker} {s.side} {s.action} · {kstDateTime(s.published_at)} · <HashText value={s.content_hash} />
                    </span>
                    <SignalEventForm signalId={s.id} />
                  </ListRow>
                ))}
              </ListPanel>
            )}
          </Section>

          <Section
            id="anchor"
            desc="보통은 공개 앵커 저장소의 GitHub Actions가 매일 18시(KST) 무렵 만들고 그 저장소에 올립니다. 이 버튼은 그날 자동 실행이 실패했을 때 18시 이후·24시 전에 복구용으로만 쓰세요. 일찍 누르면 그날 앵커가 그 시각으로 확정되어 이후 발행분은 다음 날 앵커에 담깁니다(같은 날짜는 한 번만 만들어집니다). 첫 앵커가 만들어진 뒤에는 서명 키를 다시 만들거나 DB를 새로 만들면 안 됩니다(DEPLOY.md)."
          >
            <AnchorButton />
          </Section>
        </div>
      </div>
    </div>
  );
}
