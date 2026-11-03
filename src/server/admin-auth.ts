// 관리자 인증(운영자 1명용 HTTP Basic). 미들웨어가 /admin을 막고, 서버 액션도 각자 다시 확인한다.
// 서버 액션은 어느 페이지에서든 호출될 수 있는 공개 엔드포인트라, 미들웨어만 믿으면 안 된다.
// 공급자 로그인이 필요해지는 판매 단계에서는 Supabase Auth 같은 서비스로 바꾼다(직접 구현하지 않는다).
import "server-only";
import { headers } from "next/headers";
import { adminConfigProblem, checkBasicAuth } from "@/lib/basic-auth";

export class UnauthorizedError extends Error {}

export async function requireAdmin(): Promise<void> {
  const h = await headers();
  // 설정 문제(비밀값 없음·너무 짧음)면 미들웨어의 503 문구와 같은 이유로 거부한다(checkBasicAuth도 거부하지만 이유가 드러나게)
  const problem = adminConfigProblem(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD);
  if (problem) throw new UnauthorizedError(problem);
  if (!checkBasicAuth(h.get("authorization"), process.env.ADMIN_USER, process.env.ADMIN_PASSWORD)) {
    throw new UnauthorizedError("관리자 인증이 필요합니다.");
  }
}
