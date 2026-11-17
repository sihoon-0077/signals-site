import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TYPE } from "@/components/typography";
import { isSignalKey } from "@/core/verify";
import { anchorRepo } from "@/server/config";
import { VerifyRunner } from "./verify-runner";

export const metadata: Metadata = { title: "기록 검증" };

export default async function VerifySignalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 시그널 ID(UUID)·지문(64자리)이 아니면 찾을 기록이 없다. 그런 값은 브라우저가 요청 주소에 넣지 않게 여기서 끝낸다.
  if (!isSignalKey(id)) notFound();
  // 브랜치도 함께 넘긴다: 저장소 기본 브랜치가 main이 아니면(ANCHOR_REPO_BRANCH) 브라우저 대조가 엉뚱한 브랜치를 읽는다
  const { url: mirrorRepo, branch: mirrorBranch } = anchorRepo();
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div className="space-y-5">
        {/* inline-block: space-y는 아래 여백(margin-block-end)을 주는데, 그냥 inline인 링크에는 세로 여백이 먹지 않아 제목과 붙는다 */}
        <Link href="/verify" className="inline-block text-sm font-medium text-tertiary transition-colors duration-100 hover:text-foreground">
          ← 검증 방법
        </Link>
        {/* 계획서가 정한 이 기록의 공개 이름은 '사전등록 기록'이다(결과 전에 등록·봉인한 기록. 09 §2: 검증 화면에 이 표기). */}
        <h1 className={TYPE.title}>이 사전등록 기록을 직접 검증합니다</h1>
        <p className={TYPE.body}>
          서버는 공개 자료만 보내고, 계산은 지금 이 브라우저가 합니다. 서명에 쓴 공개키와 앵커는{" "}
          {mirrorRepo ? (
            <a href={mirrorRepo} className="text-link underline underline-offset-4 transition-colors hover:text-foreground" target="_blank" rel="noopener noreferrer">
              공개 저장소
            </a>
          ) : (
            "공개 저장소"
          )}
          에서 따로 받아 대조합니다. 다만 이 화면의 코드도 이 사이트가 보내므로, 화면의 앵커 날짜·루트를 공개 저장소의 같은 날짜 파일과 직접 한 번 더 비교해
          보세요. 사이트 코드에 기대지 않는 명령줄 검증기는 공개 예정입니다(아직 공개 전).
        </p>
      </div>
      <VerifyRunner id={id} mirrorRepo={mirrorRepo} mirrorBranch={mirrorBranch} />
    </div>
  );
}
