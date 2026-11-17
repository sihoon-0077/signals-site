import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CircleX } from "lucide-react";
import { keepTerms } from "@/components/keep-terms";
import { PageHeader } from "@/components/page-header";
import { TerminalBlock } from "@/components/terminal-block";
import { TYPE } from "@/components/typography";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { anchorRepo, siteUrl } from "@/server/config";

export const metadata: Metadata = { title: "검증 방법" };

async function go(form: FormData) {
  "use server";
  const raw = String(form.get("signalId") ?? "").trim();
  // 지문(64자리)을 먼저 찾는다: 지문 링크는 ID를 바꿔치기해도 같은 기록만 가리킨다
  const hash = /(?:^|[^0-9a-f])([0-9a-f]{64})(?:$|[^0-9a-f])/i.exec(raw)?.[1];
  const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(raw)?.[1];
  const target = hash ?? id;
  redirect(target ? `/verify/${target.toLowerCase()}` : "/verify?e=1");
}

// 원문은 청산 때만이 아니라 처리 기록·외부 고정·공개 기한으로도 공개된다(reveal.ts) → '청산 전/후' 대신 '원문 공개 전/후'로 쓴다.
const CHECKS = [
  ["원문으로 지문 다시 계산", "원문이 공개되면 정규 직렬화 v2로 이어 붙여 SHA-256을 계산하고, 기록된 지문과 같은지 봅니다."],
  ["공개키로 서명 확인", "플랫폼이 이 지문을 확정했다는 서명을 공개키로 확인합니다. 공개키 지문은 표기를 믿지 않고 다시 계산합니다."],
  ["직전 기록과 사슬 연결", "직전 기록의 지문이 이 기록 안에 들어 있는지 봅니다. 원문 공개 전에는 값만 대조하고, 원문이 공개되면 지문 재계산으로 확정합니다."],
  [
    "외부 타임스탬프 확인",
    "타임스탬프 기관(RFC 3161)이 이 지문에 서명한 시각을 확인합니다. 서명 인증서가 타임스탬프 전용 인증서인지, 그 인증서가 FreeTSA·DigiCert 루트까지 CA 인증서로 이어지는지도 봅니다(자체 서명 인증서나 같은 루트 아래 다른 용도의 인증서로 만든 가짜 토큰 차단).",
  ],
  ["일일 앵커에 포함", "매일 모든 에이전트의 기록을 묶은 머클 루트를 다시 계산하고 서명을 확인합니다. 앵커가 이 기록 뒤의 기록까지 묶었으면 그 사슬도 이어 봅니다."],
  // 가격을 확인하는 검사가 아니다(1R에는 시세가 없다): 시각만으로 나중에 쓸 진입 기준을 정해 보여 준다.
  [
    "진입 기준 시각",
    "외부 타임스탬프 시각으로, 나중에 성과를 계산할 때 쓸 진입 기준(그날 시가·장중 5분 거래량가중평균가·다음 거래일 시가 중 하나)을 정해 보여 줍니다. 이 기준은 늘 타임스탬프 이후 가격입니다. 외부 시각 증거가 없으면 정하지 않습니다(서버가 적은 시각은 쓰지 않음). 수익률은 시세 데이터 이용계약 전이라 아직 표시하지 않습니다.",
  ],
  [
    "공개 저장소와 대조(공개키·앵커)",
    "서명에 쓴 공개키(유효기간 포함)와 앵커 루트를 이 사이트가 아니라 공개 저장소(GitHub)에서 직접 받아 같은지 봅니다. 사이트가 키를 바꿔 다시 서명한 가짜 기록은 여기서 드러납니다. 저장소의 keys.json까지 고치면 그 변경은 저장소 커밋 기록에 남습니다. 발행 후 이틀(KST)이 지난 기록을 사이트가 앵커 없이 보내면 '확인 못 함'으로 표시합니다.",
  ],
];

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const repo = anchorRepo();
  const mirrorArgs = repo.url ? ` --mirror ${repo.url}${repo.branch === "main" ? "" : ` --branch ${repo.branch}`}` : "";
  return (
    <div className="mx-auto max-w-3xl space-y-14 sm:space-y-16">
      <div className="space-y-8">
        <PageHeader title="기록 검증">
          <p>
            서버의 &quot;맞다&quot;는 답 대신, 이 브라우저가 공개 자료로 아래 7가지를 직접 계산합니다. 공개키와 앵커는 이 사이트가 아니라 공개 저장소에서 따로
            받아 대조합니다.
          </p>
        </PageHeader>
        {/* 검색칸은 상자로 감싸지 않는다: 보이는 라벨 → 입력칸 + 버튼(휴대폰은 위아래, sm 이상 한 줄) → 형식 오류 문장 순서.
            라벨 글은 입력칸 aria-label과 같은 문장이다(htmlFor로 이어 클릭하면 칸에 포커스가 간다).
            지문·ID는 글자 폭이 같아야 자리를 맞춰 읽기 쉬우므로 고정폭 글꼴로 받는다. 안내 문구(placeholder)만 본문 글꼴:
            고정폭이면 한글 사이 빈칸이 넓어져 휴대폰에서 문구가 일찍 잘린다. 높이는 휴대폰 48px · sm 이상 44px(버튼과 같게). */}
        <form action={go} className="space-y-2.5">
          <label htmlFor="verify-id" className="block text-sm font-medium text-foreground">지문 또는 시그널 ID</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="verify-id"
              name="signalId"
              placeholder="지문(64자리) 또는 시그널 ID·기록 페이지 링크"
              aria-label="지문 또는 시그널 ID"
              aria-invalid={e ? true : undefined}
              aria-describedby={e ? "verify-id-error" : undefined}
              className="h-12 font-mono placeholder:font-sans sm:h-11"
            />
            <Button type="submit" size="lg" className="sm:h-11 sm:px-6">검증</Button>
          </div>
          {e && (
            <p id="verify-id-error" className="flex items-start gap-1.5 text-sm text-status-fail">
              <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              지문(64자리) 또는 시그널 ID 형식이 아닙니다.
            </p>
          )}
        </form>
      </div>
      {/* 7가지 검사 = 홈 '어떻게 작동하나요'·/anchors와 같은 사슬 레일(상자 없이 세로 1px 선 + 속 빈 인디고 원). 움직이지 않는다(정적).
          원(9px, 장식이라 화면낭독기에서 숨김)은 왼쪽 선의 가운데(-5px)에 걸치고 번호 줄(20px)의 가운데(top 5px)에 맞춘다.
          선은 li 테두리가 아니라 ::before로 '이 원 → 다음 원'만 긋는다(마지막 항목 아래로는 선이 없다). 테두리 1px은 투명하게 남겨 글 위치를 그대로 둔다.
          번호는 강조색이 아니라 고정폭 회색 글자로 둔다(강조색으로 숫자를 칠하지 않는다). */}
      <ol>
        {CHECKS.map(([t, d], i) => (
          <li
            key={t}
            className="relative border-l border-transparent pb-8 pl-7 before:absolute before:top-[5px] before:-bottom-[5px] before:-left-px before:w-px before:bg-line-strong last:pb-0 last:before:hidden sm:pl-9"
          >
            <span aria-hidden="true" className="absolute top-[5px] -left-[5px] size-[9px] rounded-full border border-link bg-background" />
            <span className="block font-mono text-xs leading-5 text-tertiary">0{i + 1}</span>
            <p className={cn(TYPE.card, "mt-1.5")}>{t}</p>
            <p className="mt-1.5 max-w-[42rem] text-[0.9375rem] leading-[1.7] text-muted-foreground">{keepTerms(d)}</p>
          </li>
        ))}
      </ol>
      {/* 명령줄 검증기는 아직 비공개 저장소에만 있다. 지금 쓸 수 있는 것처럼 보이지 않게 '공개 후'를 제목에 붙인다.
          지문으로 안내한다: 지문은 서버가 다른 기록을 보내면 바로 드러나지만 ID는 그렇지 않다.
          '코드 창' 모양: 카드 머리줄(제목 + 아래 5% 선) + 몸통 안 우물(TerminalBlock). 몸통 여백 20px는 우물의 포커스 테두리가 잘리지 않게 한다.
          휴대폰(sm 미만)에서는 명령을 줄바꿈해 다 보여 준다: 가로 스크롤 상자는 스크롤된다는 표시가 없어 명령이 잘린 것처럼 보인다.
          break-words라 빈칸(인자 사이)에서 먼저 줄을 바꾸고, 한 줄보다 긴 주소만 중간에서 끊는다. sm 이상은 그대로 한 줄 + 가로 스크롤. */}
      <section className="overflow-hidden rounded-xl border bg-card">
        <p className="border-b border-line-subtle px-5 py-3.5 text-sm font-medium text-foreground sm:px-6">명령줄로 검증하기(검증기 공개 후 사용 가능)</p>
        <div className="space-y-3 px-5 py-5 text-sm leading-[1.7] sm:px-6">
          <TerminalBlock className="max-sm:whitespace-pre-wrap max-sm:break-words">{`npm run verify -- ${siteUrl()} <지문64자리>${mirrorArgs}`}</TerminalBlock>
          <p className="text-muted-foreground">
            명령줄 검증기 코드는 공개 저장소에 함께 올릴 예정이며, 아직 공개 전입니다. 그 전에는 각 기록의 원본 JSON을 받아 두고, OpenTimestamps 증명은 공개
            저장소의 .ots 파일로 확인합니다.
          </p>
        </div>
      </section>
    </div>
  );
}
