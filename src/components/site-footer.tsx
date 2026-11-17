import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className="mx-auto w-full max-w-6xl group-has-data-[layout=wide]/body:max-w-[90rem] space-y-4 px-5 pt-12 pb-10 text-[0.8125rem] leading-[1.75] text-muted-foreground sm:px-8 sm:pt-14">
        {/* 모든 화면에 붙는 필수 고지(자본시장법 제101조의3 각 호에 맞춤). 신고 전이므로 '유사투자자문업자'라고 쓰지 않는다. 문구는 footer-notice 테스트가 지킨다 */}
        <p className="max-w-[46rem]">
          SIGNALS는 정식 금융투자업자가 아니며, 유사투자자문업 신고 전입니다. 지금은 무료 사전등록 기간으로 시그널을 판매하거나 결제를 받지 않고, 투자 조언을
          제공하지 않습니다. 개별적인 투자 상담과 자금 운용은 하지 않습니다. 공개된 시그널은 모의(페이퍼) 기록이며 투자 권유가 아닙니다. 투자 판단과 그 결과의
          책임은 투자자 본인에게 있으며, 투자에는 원금 손실이 발생할 수 있고 그 손실은 투자자 본인에게 귀속됩니다. 과거 기록은 미래 수익을 보장하지 않습니다.
        </p>
        {/* 홈의 '(외부 고정 이후 구간)'과 같은 조건: 일일 앵커 전에 지운 사슬 끝 기록은 공개 자료로 드러나지 않는다. '외부에 고정된 뒤'만 쓰면 발행 직후의 타임스탬프로 읽힌다 */}
        <p className="max-w-[46rem]">
          이 기록이 증명하는 것은 &quot;결과 전에 이 내용으로 기록됐고, 일일 앵커로 외부에 고정된 뒤 지우거나 바꾸면 드러난다&quot;까지입니다. 실력(미래
          수익)과 실계좌 체결은 증명하지 않습니다.
        </p>
        {/* 처리방침 링크는 법정 안내라 다른 링크보다 눈에 띄게 둔다(굵게·본문색).
            휴대폰은 2열 격자(그냥 줄바꿈하면 390px에서 링크 하나만 다음 줄로 떨어져 흩어져 보인다), sm 이상은 한 줄.
            justify-items-start: 링크가 칸 폭만큼 늘어나지 않게 해 포커스 테두리가 글자에 맞는다 */}
        <p className="grid grid-cols-2 justify-items-start gap-x-6 gap-y-3 border-t border-line-subtle pt-5 sm:flex sm:flex-wrap sm:gap-y-2">
          <Link href="/privacy" className="font-semibold text-foreground underline-offset-4 hover:underline">
            개인정보 처리방침
          </Link>
          <Link href="/keys.json" className="transition-colors duration-100 hover:text-foreground">
            공개키(keys.json)
          </Link>
          <Link href="/anchors" className="transition-colors duration-100 hover:text-foreground">
            외부 고정 기록
          </Link>
          <Link href="/verify" className="transition-colors duration-100 hover:text-foreground">
            검증 방법
          </Link>
          {/* 화면 효과 일부가 React Bits(MIT + Commons Clause) 코드를 고친 것이라 저작권·라이선스 고지를 함께 둔다.
              빌드된 JS는 압축 때 파일 머리 주석이 지워지므로 public/third-party-notices.txt를 연결한다(정적 파일이라 Link 대신 a) */}
          <a href="/third-party-notices.txt" className="transition-colors duration-100 hover:text-foreground">
            오픈소스 고지
          </a>
        </p>
      </div>
    </footer>
  );
}
