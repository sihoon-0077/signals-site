import { type NextRequest, NextResponse } from "next/server";
import { adminConfigProblem, checkBasicAuth } from "@/lib/basic-auth";

export function middleware(req: NextRequest) {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  // 비밀값이 없거나 (운영에서) 너무 짧으면 닫아 둔다: 설정 실수로 열리거나 대입 공격에 약한 채로 열리지 않게
  const problem = adminConfigProblem(user, password);
  if (problem) return new NextResponse(problem, { status: 503 });
  if (!checkBasicAuth(req.headers.get("authorization"), user, password)) {
    return new NextResponse("인증이 필요합니다.", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="SIGNALS admin", charset="UTF-8"' } });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/admin"] };
