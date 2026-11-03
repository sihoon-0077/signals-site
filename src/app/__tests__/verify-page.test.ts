// 검증 페이지는 링크 값을 브라우저 요청 주소(/api/signals/<값>/bundle)에 넣는다.
// 시그널 ID(UUID)·지문(64자리)이 아닌 값은 찾을 기록이 없으므로, 화면을 그리기 전에 404로 끝낸다('../' 같은 값으로 다른 주소를 부르지 않게).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import VerifySignalPage from "@/app/verify/[id]/page";

const open = (id: string) => VerifySignalPage({ params: Promise.resolve({ id }) });

describe("검증 페이지 링크 값", () => {
  it("ID·지문 형식이 아니면 404(notFound)로 끝낸다", async () => {
    for (const id of ["../../admin", "..", "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a/../x", "a".repeat(63), "not-a-signal"]) {
      await expect(open(id), id).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_HTTP_ERROR_FALLBACK;404/) });
    }
  });

  it("시그널 ID와 지문(대소문자 무관)은 그대로 화면을 그린다", async () => {
    for (const id of ["3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a", "A".repeat(64), "b".repeat(64)]) {
      await expect(open(id), id).resolves.toBeTruthy();
    }
  });
});

// 검증 방법 화면은 검증기가 실제로 하는 확인만 적는다(tsa.ts 서명 인증서 용도·CA 사슬, verify.ts 키 유효기간·앵커 누락 판정)
describe("검증 방법 안내 문구", () => {
  const page = readFileSync(path.join(process.cwd(), "src/app/verify/page.tsx"), "utf8");
  it("타임스탬프는 기관 루트 연결만이 아니라 서명 인증서 용도와 CA 사슬까지 본다고 적는다", () => {
    expect(page).toContain("서명 인증서가 타임스탬프 전용 인증서인지, 그 인증서가 FreeTSA·DigiCert 루트까지 CA 인증서로 이어지는지도 봅니다");
  });
  it("저장소 대조는 키 유효기간을 포함하고, 오래된 기록의 앵커 누락은 '확인 못 함'이라고 적는다", () => {
    expect(page).toContain("서명에 쓴 공개키(유효기간 포함)와 앵커 루트를");
    expect(page).toContain("발행 후 이틀(KST)이 지난 기록을 사이트가 앵커 없이 보내면 '확인 못 함'으로 표시합니다");
  });
});
