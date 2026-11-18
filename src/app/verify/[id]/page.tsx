import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TYPE } from "@/components/typography";
import { isSignalKey } from "@/core/verify";
import { anchorRepo } from "@/server/config";
import { VerifyRunner } from "./verify-runner";

// 형식이 아닌 값은 제목을 정할 때도 404로 끝낸다. 페이지 본문에서만 notFound()를 부르면 서버 HTML은 404 제목이지만,
// 브라우저가 화면을 이어받으며 이 화면의 제목('기록 검증')으로 탭 제목을 되돌린다.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!isSignalKey(id)) notFound();
  return { title: "기록 검증" };
}

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
      {/* 결과 칸의 최소 높이 = 화면 높이 − 20rem. 그러면 이 칸의 시작 위치가 20rem − main 아래 여백(sm 이상 264px, 휴대폰 280px)보다
          아래인 한, 계산 중에도 푸터가 첫 화면 밖에 있다(11/18 측정 시작 위치: 1280px 폭 약 355px, 390px 폭 약 464px → 여유 91px·184px.
          소개 문단이 넓게 줄 바뀌는 휴대폰 배치의 넓은 쪽, 약 600px 폭에서는 여유가 약 65px로 가장 작다고 추정).
          그래서 로딩 카드가 짧은 오류 문장이나 긴 결과로 바뀌어도 보이는 곳에서 밀리는 것이 없다(운영 실측: 푸터가 보이면 CLS가 0.1을 넘었다).
          위 소개 문단을 크게 줄이면 이 조건을 다시 확인한다. 인쇄에서는 100vh가 종이 높이라 빈 자리만 남기므로 끈다(print:min-h-0). */}
      <div className="min-h-[calc(100vh-20rem)] print:min-h-0">
        <VerifyRunner id={id} mirrorRepo={mirrorRepo} mirrorBranch={mirrorBranch} />
      </div>
    </div>
  );
}
