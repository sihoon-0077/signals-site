import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TYPE } from "@/components/typography";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "사전등록 완료" };

// 홈·404와 같은 테두리형 링크 버튼. size lg가 높이(휴대폰 44px → sm 이상 40px)와 좌우 여백을 정하므로 덧붙일 클래스가 없다.
const LINK_BUTTON = buttonVariants({ size: "lg", variant: "outline" });

// 새 등록과 '이미 등록된 이메일'의 재제출이 똑같은 화면이어야 한다(등록 여부가 드러나지 않게). 그래서 주소의 값·링크를 받지 않는다.
// 프로필 주소와 공유·초대 링크는 본인 확인·승인 뒤 운영자 메일과 공개 프로필(/p/주소)에서 안내한다.
// 카드로 감싸지 않고 캔버스 위 글 묶음으로 둔다(아이콘 타일 → 제목 → 안내 두 문단 → 5% 선 아래 링크 버튼).
// 틀은 다른 읽기 화면과 같은 768px(max-w-3xl, 제목 왼쪽 끝이 화면마다 같다), 안내 문단만 672px(max-w-2xl)로 줄 길이를 지킨다.
export default function DonePage() {
  return (
    <div className="mx-auto max-w-3xl py-4 sm:py-8">
      {/* 장식 아이콘(다음 단계가 메일이라는 것을 보여 줌). 글로 된 안내는 아래 문단이 전부라 화면낭독기에서는 숨긴다 */}
      <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl border bg-raised text-link elev-lift">
        <MailCheck className="size-5" />
      </span>
      <h1 className={cn(TYPE.title, "mt-6")}>사전등록을 받았습니다</h1>
      <div className="mt-4 max-w-2xl space-y-4">
        <p className={TYPE.body}>
          운영자가 내용을 확인한 뒤, 적어 주신 이메일로 본인 확인 메일을 보냅니다. 그 메일에 회신해 주시면 승인하고 공개 프로필 주소와 공유·초대 링크를
          안내합니다.
        </p>
        <p className={TYPE.body}>
          같은 이메일로 이미 등록했다면 기존 등록이 그대로 유지되고, 이번에 적은 내용은 반영되지 않습니다. 내용을 고치려면 개인정보 처리방침에 있는 연락처로
          알려 주세요.
        </p>
      </div>
      <div className="mt-10 flex flex-wrap gap-3 border-t border-line-subtle pt-8">
        <Link href="/privacy" className={LINK_BUTTON}>
          개인정보 처리방침·연락처
        </Link>
        <Link href="/" className={LINK_BUTTON}>
          처음으로
        </Link>
      </div>
    </div>
  );
}
