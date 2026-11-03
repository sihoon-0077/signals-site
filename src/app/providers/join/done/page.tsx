import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "사전등록 완료" };

// 새 등록과 '이미 등록된 이메일'의 재제출이 똑같은 화면이어야 한다(등록 여부가 드러나지 않게). 그래서 주소의 값·링크를 받지 않는다.
// 프로필 주소와 공유·초대 링크는 본인 확인·승인 뒤 운영자 메일과 공개 프로필(/p/주소)에서 안내한다.
export default function DonePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold sm:text-3xl">사전등록을 받았습니다</h1>
        <p className="leading-relaxed text-muted-foreground">
          운영자가 내용을 확인한 뒤, 적어 주신 이메일로 본인 확인 메일을 보냅니다. 그 메일에 회신해 주시면 승인하고 공개 프로필 주소와 공유·초대 링크를
          안내합니다.
        </p>
        <p className="leading-relaxed text-muted-foreground">
          같은 이메일로 이미 등록했다면 기존 등록이 그대로 유지되고, 이번에 적은 내용은 반영되지 않습니다. 내용을 고치려면 개인정보 처리방침에 있는 연락처로
          알려 주세요.
        </p>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <Link href="/privacy" className="text-muted-foreground hover:text-foreground">
          개인정보 처리방침·연락처
        </Link>
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          처음으로
        </Link>
      </div>
    </div>
  );
}
