import type { Metadata } from "next";
import { siteUrl } from "@/server/config";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "공급자 무료 사전등록" };

// 등록 조건과 기록 공개 조건을 폼보다 먼저 보인다. 초대 링크로 이 화면에 바로 들어오면 홈의 설명을 보지 못하므로,
// 여기서 알리지 않으면 '손실 기록이 남는 줄 몰랐다'는 삭제 요구로 이어진다(봉인 기록은 지우지 않는다).
const CONDITIONS = ["국내 주식 시그널(스윙 중심, 며칠~몇 주 보유)", "규칙·코드·AI로 반복해서 만드는 시그널", "만 19세 이상"];

const TERMS = [
  "봉인한 시그널은 손실이 나도 지우거나 고치지 않고, 모든 기록을 공개합니다.",
  "시그널 원문(종목·방향·가격·근거 등)은 청산·만료·무효로 처리되거나, 청산 시그널이 일일 앵커에 고정되거나(짝이 되는 진입과 함께), 진입의 공개 기한이 지나면 필명과 함께 공개됩니다. 그 전에는 지문(해시)과 발행 시각 같은 검증 정보만 보입니다.",
  "탈퇴하면 이메일·소개·채널은 지우지만, 이미 봉인된 기록은 지우지 않고 「탈퇴한 공급자」 표시로 계속 공개합니다.",
  // 시그널은 등록 이메일에서 운영 메일(CONTACT_EMAIL)로만 받는다(처리방침 1항 시그널 기록·3항 운영 메일, DEPLOY.md 8절). 메신저·설문 폼은 처리방침에 없는 수탁자다
  "등록만으로는 기록이 생기지 않습니다. 본인 확인과 승인 뒤 기록 시작 방법을 안내하고, 등록한 이메일에서 운영 메일(개인정보 처리방침 6항 연락처)로 보내 주신 첫 시그널을 운영자가 봉인한 때부터 기록합니다(기록 시각은 봉인 시각입니다). 시그널은 메일로만 받으며 메신저·설문 폼으로는 받지 않습니다.",
  "지금은 무료이며 시그널 판매와 결제가 없습니다. 판매를 시작할 때 공급자의 신고 필요 여부를 포함한 구조는 법률 검토로 확정해 안내합니다.",
];

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">공급자 무료 사전등록</h1>
        {/* 사이트에는 시그널을 받는 기능이 없고 봉인은 운영자가 /admin에서 발행할 때 일어난다(services/publish.ts). 기록 시각과 진입 기준은
            그 봉인 시각으로 정해지므로, 보낸 시각이 기준인 것처럼 읽히는 '받는 즉시' 같은 약속을 쓰지 않는다. */}
        <p className="leading-relaxed text-muted-foreground">
          규칙·코드·AI로 국내 주식 시그널을 꾸준히 만들고 있다면 등록해 주세요. 승인되면 공개 프로필과 공유·초대 링크가 생깁니다. 보내 주신 시그널은 운영자가
          받아 봉인한 때부터 결과 전 기록이 됩니다. 기록 시각은 보내신 시각이 아니라 봉인 시각이며, 봉인은 운영자가 직접 하므로 보내신 때보다 늦어질 수
          있습니다. 나중에 성과를 계산할 때 쓰는 진입 기준도 봉인 뒤 받은 외부 타임스탬프 시각 이후의 가격으로 정합니다(수익률은 아직 표시하지 않습니다).
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-bold">등록 조건</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
          {CONDITIONS.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="font-bold">등록 전에 확인해 주세요</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </section>

      <JoinForm referralCode={ref && /^[a-z0-9]{6,16}$/.test(ref) ? ref : undefined} profileHost={new URL(siteUrl()).host} />
    </div>
  );
}
