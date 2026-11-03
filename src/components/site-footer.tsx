import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto w-full max-w-5xl space-y-3 px-5 py-10 text-xs leading-relaxed text-muted-foreground sm:px-8">
        {/* 모든 화면에 붙는 필수 고지(자본시장법 제101조의3 각 호에 맞춤). 신고 전이므로 '유사투자자문업자'라고 쓰지 않는다. 문구는 footer-notice 테스트가 지킨다 */}
        <p>
          SIGNALS는 정식 금융투자업자가 아니며, 유사투자자문업 신고 전입니다. 지금은 무료 사전등록 기간으로 시그널을 판매하거나 결제를 받지 않고, 투자 조언을
          제공하지 않습니다. 개별적인 투자 상담과 자금 운용은 하지 않습니다. 공개된 시그널은 모의(페이퍼) 기록이며 투자 권유가 아닙니다. 투자 판단과 그 결과의
          책임은 투자자 본인에게 있으며, 투자에는 원금 손실이 발생할 수 있고 그 손실은 투자자 본인에게 귀속됩니다. 과거 기록은 미래 수익을 보장하지 않습니다.
        </p>
        {/* 홈의 '(외부 고정 이후 구간)'과 같은 조건: 일일 앵커 전에 지운 사슬 끝 기록은 공개 자료로 드러나지 않는다. '외부에 고정된 뒤'만 쓰면 발행 직후의 타임스탬프로 읽힌다 */}
        <p>
          이 기록이 증명하는 것은 &quot;결과 전에 이 내용으로 기록됐고, 일일 앵커로 외부에 고정된 뒤 지우거나 바꾸면 드러난다&quot;까지입니다. 실력(미래
          수익)과 실계좌 체결은 증명하지 않습니다.
        </p>
        <p className="flex flex-wrap gap-4 pt-2">
          <Link href="/privacy" className="font-semibold text-foreground hover:underline">
            개인정보 처리방침
          </Link>
          <Link href="/keys.json" className="hover:text-foreground">
            공개키(keys.json)
          </Link>
          <Link href="/anchors" className="hover:text-foreground">
            외부 고정 기록
          </Link>
          <Link href="/verify" className="hover:text-foreground">
            검증 방법
          </Link>
        </p>
      </div>
    </footer>
  );
}
