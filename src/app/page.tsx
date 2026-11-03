import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { isAgentPublic } from "@/lib/agent-visibility";
import { AGENT_STATUS_LABEL, kstDateTime } from "@/lib/format";
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

export default async function Home() {
  // 승인된 공급자의 에이전트와, 공급자가 비활성이어도 봉인 기록이 있는 에이전트를 보여 준다(실패 기록이 목록에서 사라지지 않게).
  // /a/주소 페이지·제목과 같은 규칙(lib/agent-visibility.ts)을 쓴다.
  const agents = (await listAgents(await getDb())).filter(isAgentPublic);
  return (
    <div className="space-y-24">
      <section className="space-y-8 pt-4">
        {/* 출시 전 무료 기록 서비스다. 지금 판매 중인 마켓처럼 읽히는 현재형 문구를 쓰지 않는다(신고 전, 결제 없음). */}
        <Badge variant="secondary">출시 전 무료 기간 · 공급자 사전등록 중</Badge>
        <h1 className="max-w-3xl text-3xl leading-tight font-bold tracking-tight sm:text-5xl sm:leading-tight">
          결과 전에 봉인하고
          <br />
          누구나 다시 대조하는 AI 시그널 기록
        </h1>
        {/* 공개 저장소는 운영자 소유라 운영자가 고칠 수 없다고 쓰면 사실이 아니다. 사실인 것: 고치면 공개 사본·타임스탬프와 어긋나 드러난다. */}
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          AI·퀀트 시그널을 발행하는 순간 봉인해 타임스탬프 기관의 시각 서명을 받고, 매일 전체 기록을 공개 저장소와 비트코인에 고정합니다. 고정한 뒤에
          기록을 지우거나 고치면 공개 사본·타임스탬프와 맞지 않게 되어 누구나 알아챌 수 있습니다. 지금은 시그널을 팔거나 결제를 받지 않습니다.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/providers/join" className={buttonVariants({ size: "lg" })}>
            공급자 무료 사전등록
          </Link>
          <Link href="/verify" className={buttonVariants({ size: "lg", variant: "outline" })}>
            기록 검증해 보기
          </Link>
        </div>
      </section>

      <section className="space-y-10">
        <h2 className="text-xl font-bold sm:text-2xl">어떻게 작동하나요</h2>
        <ol className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li key={s.title} className="space-y-3">
              <p className="text-sm font-medium text-primary">0{i + 1}</p>
              <h3 className="text-lg font-bold">{s.title}</h3>
              <p className="leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-10 sm:grid-cols-2">
        <div className="space-y-4">
          <h2 className="text-xl font-bold sm:text-2xl">증명하는 것</h2>
          {/* 성과·실패를 계산하는 기능은 1R 사이트에 없다. 실제로 확인할 수 있는 것(앵커가 모든 기록·에이전트를 묶음)만 적는다. */}
          <ul className="space-y-2 leading-relaxed text-muted-foreground">
            <li>결과 전에 이 내용으로 기록됐다</li>
            <li>바꾸거나 지우면 드러난다(외부 고정 이후 구간)</li>
            <li>결과와 상관없이 모든 기록이 매일 외부 고정에 들어간다(종료한 에이전트 포함, 빼면 드러남)</li>
          </ul>
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold sm:text-2xl">증명하지 않는 것</h2>
          <ul className="space-y-2 leading-relaxed text-muted-foreground">
            <li>실력과 미래 수익(과거 기록은 미래 수익을 보장하지 않음)</li>
            <li>수익률(시세 데이터 이용계약 전이라 아직 표시하지 않음)</li>
            <li>실계좌 체결(모의 기록 기준)</li>
            <li>공급자가 등록 전에 혼자 시험하고 버린 전략</li>
          </ul>
        </div>
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-xl font-bold sm:text-2xl">공개된 에이전트</h2>
          <Link href="/anchors" className="text-sm text-muted-foreground hover:text-foreground">
            외부 고정 기록 보기
          </Link>
        </div>
        {agents.length === 0 ? (
          <p className="text-muted-foreground">아직 공개된 에이전트가 없습니다.</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {agents.map((a) => (
              <li key={a.id}>
                <Link href={`/a/${a.slug}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-muted/50">
                  <div className="space-y-1">
                    <p className="font-medium">
                      {a.name}
                      {a.is_platform_owned && <span className="ml-2 text-xs text-muted-foreground">플랫폼 운영</span>}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      기록 {a.chain_length}건 · 마지막 발행 {kstDateTime(a.last_published_at)}
                    </p>
                  </div>
                  <Badge variant="outline">{AGENT_STATUS_LABEL[a.status]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-xl bg-muted/60 px-6 py-8 sm:px-10">
        <h2 className="text-xl font-bold">AI·퀀트 시그널을 만들고 계신가요?</h2>
        {/* 공급자 신고 필요 여부는 법률 검토 전이라 중립으로 쓴다(신고가 필요 없다거나 플랫폼이 대신한다고 약속하지 않는다). */}
        <p className="max-w-2xl leading-relaxed text-muted-foreground">
          사전등록 후 이메일 본인 확인과 승인을 거치면 공개 프로필과 공유·초대 링크를 받고, 결과 전 기록을 먼저 쌓을 수 있습니다. 등록과 기록은 무료이며
          지금은 시그널 판매와 결제가 없습니다. 유료 판매는 필요한 유사투자자문업 신고와 법률 검토를 모두 마친 뒤에만 시작합니다. 판매를 시작할 때 공급자의
          신고 필요 여부를 포함한 구조는 법률 검토로 확정해 안내합니다.
        </p>
        <Link href="/providers/join" className={buttonVariants()}>
          무료로 사전등록하기
        </Link>
      </section>
    </div>
  );
}
