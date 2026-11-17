import { ArrowRight, ChevronRight, CircleCheck, Inbox, Minus } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { Grain } from "@/components/effects/grain";
import { HashSettle } from "@/components/effects/hash-settle";
import { LedgerGrid } from "@/components/effects/ledger-grid";
import { SealMark } from "@/components/effects/seal-mark";
import { SpotlightCard } from "@/components/effects/spotlight-card";
import { EmptyState } from "@/components/empty-state";
import { keepTerms } from "@/components/keep-terms";
import { ListLinkRow, ListPanel } from "@/components/panel";
import { TYPE } from "@/components/typography";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isAgentPublic } from "@/lib/agent-visibility";
import { AGENT_STATUS_LABEL, kstDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getDb } from "@/server/db";
import { listAgents } from "@/server/repo/agents";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    title: "발행 즉시 봉인",
    body: "시그널 원문을 정해진 순서로 이어 SHA-256 지문을 만들고 플랫폼 키로 서명합니다. 지문에는 직전 기록의 지문도 들어가 기록이 사슬로 이어집니다.",
  },
  {
    title: "시각을 바깥에 고정",
    // 1R 사이트에는 시세·수익률 계산이 없다. 있는 것처럼 읽히지 않게 '나중에'와 '아직 표시하지 않음'을 함께 쓴다.
    body: "지문을 타임스탬프 기관(RFC 3161)에 보내 '이 시각에 존재했다'는 서명을 받습니다. 나중에 성과를 계산할 때 진입가는 이 시각 이후 가격으로만 정합니다(수익률은 시세 데이터 이용계약 전이라 아직 표시하지 않습니다).",
  },
  {
    title: "매일 전체 기록을 고정",
    body: "매일 18시(KST) 무렵, 종료된 에이전트까지 모든 기록의 길이와 마지막 지문을 하나의 값으로 묶어 공개 저장소와 비트코인(OpenTimestamps)에 남깁니다.",
  },
  {
    title: "누구나 직접 대조",
    body: "원문은 정해진 규칙(청산·만료·무효 처리, 청산 시그널의 외부 고정, 공개 기한 경과 중 먼저 오는 때)에 따라 공개됩니다. 검증 페이지는 지문·서명·시각을 브라우저에서 직접 계산하고, 공개키·앵커는 공개 저장소 값과 대조합니다.",
  },
];

// 히어로 오른쪽 '봉인 기록 예시'는 예시일 뿐 실제 기록이 아니다. 원문은 정규 직렬화 v2 형식의 예시 값(종목 칸 EXAMPLE)이고,
// SAMPLE_HASH는 그 문자열의 실제 SHA-256이다(src/app/__tests__/home-sample.test.ts가 다시 계산해 확인). 날짜·루트 같은 기록 값은 넣지 않는다.
const SAMPLE_CANONICAL =
  "v2|00000000-0000-4000-8000-000000000001|00000000-0000-4000-8000-000000000002|1|KOSPI|EXAMPLE|LONG|ENTRY||||10||true||example-v1|00000000000000000000000000000000|example|2026-11-17T00:00:00.000Z|0000000000000000000000000000000000000000000000000000000000000000";
const SAMPLE_HASH = "17a17335f93168ef66a150d193341672d5d084444af763d39a95642e6a745f77";

// 첫 화면 버튼: size lg가 이미 휴대폰 44px(좌우 20px) / sm 이상 40px(좌우 16px)라 덮어쓸 클래스가 없다.
// 채운 인디고 버튼은 화면당 1개: 히어로는 첫 버튼만 CTA, 둘째는 CTA_OUTLINE(헤더 버튼도 outline).
const CTA = buttonVariants({ size: "lg" });
const CTA_OUTLINE = buttonVariants({ size: "lg", variant: "outline" });

// 히어로 등장 순서(첫 페인트 기준): 칩 0 → 문단 100 → 버튼 160 → 영수증 220ms(h1은 처음부터 고정).
// CSS(.reveal-mount)만 쓰므로 JS 없이도 돌고, reduce면 처음부터 완성 화면이다.
const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

// '증명하는 것/않는 것' 목록: 줄마다 아이콘(장식, aria-hidden) + 원래 문구. 아이콘 위치는 여기 한 곳에서 정한다.
// mt-[5px]: 15px 글자·행간 1.7(약 25.5px)의 첫 줄 가운데에 16px 아이콘을 맞춘다((25.5-16)/2 ≈ 5px).
const PROOF_LIST = "space-y-3 text-[0.9375rem] leading-[1.7] text-muted-foreground [&>li]:flex [&>li]:gap-3 [&_svg]:mt-[5px] [&_svg]:size-4 [&_svg]:shrink-0";

export default async function Home() {
  // 승인된 공급자의 에이전트와, 공급자가 비활성이어도 봉인 기록이 있는 에이전트를 보여 준다(실패 기록이 목록에서 사라지지 않게).
  // /a/주소 페이지·제목과 같은 규칙(lib/agent-visibility.ts)을 쓴다.
  const agents = (await listAgents(await getDb())).filter(isAgentPublic);
  return (
    // data-layout="bleed": layout.tsx의 <main>이 폭·여백을 풀고, 섹션마다 헤더와 같은 컨테이너(max-w-6xl + px-5 sm:px-8)를 직접 둔다.
    <div data-layout="bleed">
      {/* 1. 히어로: 화면 폭 전체 띠(격자·그레인·glow는 이 띠 안에서만). 넓은 화면(lg 이상)은 왼쪽 소개·버튼 + 오른쪽 '봉인 기록 예시' 카드,
          그보다 좁으면 카드가 버튼 아래로 내려간다. 열이 생기기 전에도 grid-cols-1을 적어 둔다(빈 열은 auto라 말줄임 줄 폭만큼 늘어난다). */}
      <section className="relative isolate overflow-hidden border-b border-line-subtle">
        <LedgerGrid />
        {/* 띠 전체에 고르게 깔면 띠가 캔버스보다 한 단 밝은 '회색 판'이 되고 아래 경계에서 뚝 끊긴다 → 아래로 갈수록 사라져 캔버스와 이어진다 */}
        <Grain opacity={0.035} className="-z-10 [mask-image:linear-gradient(to_bottom,#000_35%,transparent_92%)]" />
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 px-5 pt-14 pb-16 sm:px-8 sm:pt-20 sm:pb-24 lg:grid-cols-[minmax(0,1fr)_27rem] lg:gap-16 lg:pt-24 lg:pb-28">
          <div>
            {/* 출시 전 무료 기록 서비스다. 지금 판매 중인 마켓처럼 읽히는 현재형 문구를 쓰지 않는다(신고 전, 결제 없음). */}
            <p className="reveal-mount inline-flex h-7 items-center gap-2 rounded-full border border-border bg-white/4 pr-3 pl-2.5 text-[0.8125rem] font-medium text-lead">
              <span aria-hidden="true" className="size-1.5 rounded-[2px] bg-link" />
              출시 전 무료 기간 · 공급자 사전등록 중
            </p>
            {/* 3줄 고정: 8.6em 폭 + 'AI 시그널 기록' 줄바꿈 금지 → 휴대폰에서도 'AI'가 홀로 남지 않는다.
                h1은 등장 연출(.reveal-mount)을 받지 않고 첫 프레임부터 그대로 있다: 등장 연출을 걸었을 때 휴대폰 모션 샷에서 h1만
                통째로 빈 칸으로 찍힌 적이 있다(원인 미확정. background-clip:text 글자에 opacity·transform 애니메이션을 합성할 때의 문제로 의심).
                h1은 휴대폰 첫 화면의 가장 큰 글(LCP 후보)이기도 하다. 등장은 칩·문단·버튼·영수증이 맡는다. */}
            <h1 className={cn(TYPE.display, "headline-gradient mt-6 max-w-[8.6em]")}>
              결과 전에 봉인하고
              <br />
              누구나 다시 대조하는 <span className="whitespace-nowrap">AI 시그널 기록</span>
            </h1>
            {/* 공개 저장소는 운영자 소유라 운영자가 고칠 수 없다고 쓰면 사실이 아니다. 사실인 것: 고치면 공개 사본·타임스탬프와 어긋나 드러난다. */}
            <p className={cn(TYPE.lead, "reveal-mount mt-6 max-w-[34rem]")} style={delay(100)}>
              AI·퀀트 시그널을 발행하는 순간 봉인해 타임스탬프 기관의 시각 서명을 받고, 매일 전체 기록을 공개 저장소와 비트코인에 고정합니다. 고정한 뒤에
              기록을 지우거나 고치면 공개 사본·타임스탬프와 맞지 않게 되어 누구나 알아챌 수 있습니다. 지금은 시그널을 팔거나 결제를 받지 않습니다.
            </p>
            <div className="reveal-mount mt-8 flex flex-col gap-3 min-[440px]:flex-row" style={delay(160)}>
              <Link href="/providers/join" className={CTA}>
                공급자 무료 사전등록
              </Link>
              <Link href="/verify" className={CTA_OUTLINE}>
                기록 검증해 보기
              </Link>
            </div>
          </div>

          {/* 봉인 기록 예시: '예시' 칩은 앞 라벨과 같은 뜻이라 화면낭독기에서 숨긴다. 봉인 표시는 인디고(기록됨)이고 초록(검증 통과)이 아니다.
              예시는 검증할 수 없으므로 /verify로 가는 링크를 달지 않는다. glow는 사이트 전체에서 이 카드 뒤 하나뿐이다. */}
          <div className="relative w-full min-w-0 max-w-[34rem] lg:max-w-none">
            <div aria-hidden="true" className="hero-glow pointer-events-none absolute -inset-x-12 -inset-y-16 -z-10 print:hidden" />
            <SpotlightCard as="article" className="reveal-mount rounded-2xl bg-card p-5 elev-float sm:p-7" style={delay(220)} intensity={0.08} spotlightSize={280}>
              <Grain opacity={0.05} className="-z-10" />
              <div className="flex items-center justify-between gap-3">
                <p className={TYPE.meta}>봉인 기록 예시</p>
                <span aria-hidden="true" className="rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  예시
                </span>
              </div>
              {/* 원문은 한 줄 말줄임(전체는 title). 종목 칸이 EXAMPLE이라 실제 종목·방향이 첫 화면에 보이지 않는다. */}
              <div className="mt-5 rounded-lg border border-line-subtle bg-inset px-3.5 py-3">
                <p className="text-xs font-medium text-tertiary">원문</p>
                <p className="mt-1 truncate font-mono text-xs leading-5 text-muted-foreground" title={SAMPLE_CANONICAL}>
                  {SAMPLE_CANONICAL}
                </p>
              </div>
              {/* 봉인 표시 3개가 400 / 520 / 640ms에 차례로 닫힌다(마지막이 1.16초에 끝남). 지문은 32자 × 2줄(max-w-[32ch]):
                  380px 미만은 12px라야 320px 폭 카드 안쪽(240px)에 32자가 들어간다.
                  세 줄 라벨은 같은 봉인 단계라 같은 색(body)으로 두고, 카드에서 가장 밝은 값은 지문(lead mono)이다.
                  지문은 380px 이상에서 ml-6(표시 16px + 간격 8px)만큼 들여 자기 라벨 'SHA-256 지문'의 글자 시작선에 맞춘다(margin이라
                  32ch 폭은 그대로). 380px 미만은 카드 안쪽이 240px뿐이라 들이면 32자가 한 줄에 들어가지 않아 그대로 둔다. */}
              <ol className="mt-5 divide-y divide-line-subtle text-sm leading-[1.6]">
                <li className="space-y-2.5 pb-4">
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <SealMark delayMs={400} className="text-link" />
                    SHA-256 지문
                  </p>
                  <HashSettle
                    value={SAMPLE_HASH}
                    holdUntilStart
                    delayMs={120}
                    className="block max-w-[32ch] font-mono text-xs leading-[1.7] break-all text-lead min-[380px]:ml-6 min-[380px]:text-[0.8125rem]"
                  />
                </li>
                <li className="flex items-start gap-2 py-4 text-muted-foreground">
                  <SealMark delayMs={520} className="mt-[3px] text-link" />
                  RFC 3161 시각 서명 · FreeTSA, DigiCert
                </li>
                <li className="flex items-start gap-2 pt-4 text-muted-foreground">
                  <SealMark delayMs={640} className="mt-[3px] text-link" />
                  일일 앵커 · 공개 저장소, 비트코인(OpenTimestamps)
                </li>
              </ol>
            </SpotlightCard>
          </div>
        </div>
      </section>

      {/* 2. 증명 범위 띠: 바깥 상자 없이 2열, 가운데 5% 세로선(휴대폰은 위아래로 쌓이고 사이에 가로선). 선은 둘째 칸에 그린다. */}
      <section className="border-b border-line-subtle">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-5 py-14 sm:px-8 sm:py-16 md:grid-cols-2 md:gap-0">
          <div className="space-y-4 md:pr-10 lg:pr-16">
            <h2 className={TYPE.block}>증명하는 것</h2>
            {/* 성과·실패를 계산하는 기능은 1R 사이트에 없다. 실제로 확인할 수 있는 것(앵커가 모든 기록·에이전트를 묶음)만 적는다.
                체크 아이콘은 인디고(기록됨): 초록은 실제 검증 결과의 '통과'에만 쓴다. */}
            <ul className={PROOF_LIST}>
              <li>
                <CircleCheck aria-hidden="true" className="text-link" />
                결과 전에 이 내용으로 기록됐다
              </li>
              <li>
                <CircleCheck aria-hidden="true" className="text-link" />
                바꾸거나 지우면 드러난다(외부 고정 이후 구간)
              </li>
              <li>
                <CircleCheck aria-hidden="true" className="text-link" />
                결과와 상관없이 모든 기록이 매일 외부 고정에 들어간다(종료한 에이전트 포함, 빼면 드러남)
              </li>
            </ul>
          </div>
          <div className="space-y-4 border-t border-line-subtle pt-10 md:border-t-0 md:border-l md:pt-0 md:pl-10 lg:pl-16">
            <h2 className={TYPE.block}>증명하지 않는 것</h2>
            <ul className={PROOF_LIST}>
              <li>
                <Minus aria-hidden="true" className="text-tertiary" />
                실력과 미래 수익(과거 기록은 미래 수익을 보장하지 않음)
              </li>
              <li>
                <Minus aria-hidden="true" className="text-tertiary" />
                수익률(시세 데이터 이용계약 전이라 아직 표시하지 않음)
              </li>
              <li>
                <Minus aria-hidden="true" className="text-tertiary" />
                실계좌 체결(모의 기록 기준)
              </li>
              <li>
                <Minus aria-hidden="true" className="text-tertiary" />
                공급자가 등록 전에 혼자 시험하고 버린 전략
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 3. 작동 방식: 왼쪽 제목(넓은 화면 sticky) + 오른쪽 세로 사슬. 노드 = 속 빈 인디고 원, 마지막 단계 아래로는 선이 없다.
          노드(9px)는 왼쪽 1px 선의 가운데(-5px)에 걸치고, 번호 줄(20px)의 가운데(top 5px)에 맞춘다. 움직이지 않는다.
          선은 li 테두리(li 높이 전체)가 아니라 ::before로 '이 노드 → 다음 노드'만 긋는다(top 5px ~ 아래로 5px 더). 테두리로 그리면
          첫 노드 위로 꼬리가 남고 마지막 노드 앞에서 선이 끊긴다. 테두리 1px은 투명하게 남겨 글·노드 위치를 그대로 둔다. */}
      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className={TYPE.section}>어떻게 작동하나요</h2>
        </div>
        <ol className="mt-10 lg:mt-1">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="relative border-l border-transparent pb-10 pl-7 before:absolute before:top-[5px] before:-bottom-[5px] before:-left-px before:w-px before:bg-line-strong last:pb-0 last:before:hidden sm:pl-9"
            >
              <span aria-hidden="true" className="absolute top-[5px] -left-[5px] size-[9px] rounded-full border border-link bg-background" />
              <p className="font-mono text-xs leading-5 text-tertiary">0{i + 1}</p>
              <h3 className={cn(TYPE.card, "mt-1.5")}>{s.title}</h3>
              <p className={cn(TYPE.body, "mt-2 max-w-[38rem]")}>{keepTerms(s.body)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. 공개된 에이전트 */}
      <section className="mx-auto w-full max-w-6xl px-5 pb-16 sm:px-8 sm:pb-24">
        {/* items-baseline: 링크 글자를 제목 글자의 기준선에 맞춘다(items-end면 줄 상자 아래에 붙어 기준선보다 4px쯤 내려간다) */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className={TYPE.section}>공개된 에이전트</h2>
          <Link href="/anchors" className="inline-flex items-center gap-1 text-sm font-medium text-link underline-offset-4 hover:underline">
            외부 고정 기록 보기
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>
        <div className="mt-8">
          {agents.length === 0 ? (
            <EmptyState icon={Inbox}>
              <p>아직 공개된 에이전트가 없습니다.</p>
            </EmptyState>
          ) : (
            <ListPanel>
              {agents.map((a) => (
                // 상태 배지는 결과(통과·성과)로 읽히지 않게 색 없는 테두리형으로 둔다(초록 금지).
                // 메타 줄은 라벨을 Pretendard로 두고 시각 값만 mono로 감싼다(한글이 mono 안에 들어가면 글자 사이가 벌어져 보인다).
                // 시각 값은 한 덩어리(nowrap): 320px 폭에서 날짜와 시각이 두 줄로 갈라지지 않고 값째 다음 줄로 넘어간다.
                // 줄 전체가 링크라는 단서: 줄 오른쪽 끝의 화살표(장식, aria-hidden). 내용 칸 | 화살표 칸의 2칸 격자라 휴대폰에서 배지가
                // 아래 줄로 내려가도 화살표는 줄 오른쪽 끝 가운데에 남는다. 마우스를 올리면 2px 밀린다(group-hover, 터치에서는 hover 없음).
                <ListLinkRow key={a.id} href={`/a/${a.slug}`} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4">
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-base font-medium text-foreground">
                        {a.name}
                        {a.is_platform_owned && <span className="ml-2 text-xs font-normal text-tertiary">플랫폼 운영</span>}
                      </p>
                      <p className="text-[0.8125rem] text-tertiary tabular-nums">
                        기록 {a.chain_length}건 · 마지막 발행 <span className="font-mono whitespace-nowrap">{kstDateTime(a.last_published_at)}</span>
                      </p>
                    </div>
                    <Badge variant="outline">{AGENT_STATUS_LABEL[a.status]}</Badge>
                  </div>
                  <ChevronRight aria-hidden="true" className="size-4 text-tertiary transition-transform duration-150 group-hover:translate-x-0.5" />
                </ListLinkRow>
              ))}
            </ListPanel>
          )}
        </div>
      </section>

      {/* 5. 마무리 CTA: 넓은 화면은 제목 + 버튼 한 줄, 그 아래 고지 문단(문단은 한 덩어리 그대로). 스크롤로 들어올 때 한 번 떠오른다(.reveal-scroll). */}
      <div className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8 sm:pb-28">
        <SpotlightCard
          as="section"
          className="reveal-scroll rounded-2xl bg-raised px-6 py-10 elev-lift sm:px-12 sm:py-14 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-12"
          intensity={0.08}
        >
          <Grain opacity={0.05} className="-z-10" />
          <h2 className="text-2xl leading-[1.3] font-semibold tracking-[-0.02em] text-foreground sm:text-[2rem] lg:col-start-1 lg:row-start-1">
            AI·퀀트 시그널을 만들고 계신가요?
          </h2>
          {/* 공급자 신고 필요 여부는 법률 검토 전이라 중립으로 쓴다(신고가 필요 없다거나 플랫폼이 대신한다고 약속하지 않는다). */}
          <p className="mt-4 max-w-[44rem] text-[0.9375rem] leading-[1.7] text-muted-foreground lg:col-start-1 lg:row-start-2">
            사전등록 후 이메일 본인 확인과 승인을 거치면 공개 프로필과 공유·초대 링크를 받고, 결과 전 기록을 먼저 쌓을 수 있습니다. 등록과 기록은 무료이며
            지금은 시그널 판매와 결제가 없습니다. 유료 판매는 필요한 유사투자자문업 신고와 법률 검토를 모두 마친 뒤에만 시작합니다. 판매를 시작할 때 공급자의
            신고 필요 여부를 포함한 구조는 법률 검토로 확정해 안내합니다.
          </p>
          <Link href="/providers/join" className={cn(CTA, "mt-8 w-full min-[440px]:w-auto lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0")}>
            무료로 사전등록하기
          </Link>
        </SpotlightCard>
      </div>
    </div>
  );
}
