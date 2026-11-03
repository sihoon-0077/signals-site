// 공유·초대 링크 유입 기록(sendBeacon). 코드가 승인된 공급자 것일 때만, 코드별 하루 상한 안에서 센다(repo/providers.ts).
// 브라우저가 아닌 요청(스크립트)도 막지 못하므로 공개 수치는 '참고용'으로만 표시한다. 호출 폭은 Vercel Firewall 속도 제한이 맡는다(DEPLOY.md).
import { getDb } from "@/server/db";
import { recordReferralVisit } from "@/server/repo/providers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // 이 사이트 페이지에서 보낸 것만 센다. 다른 사이트가 방문자 브라우저로 쏘는 요청(sendBeacon)은 무시한다.
  if (req.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 204 });
  // 정상 본문은 {code, path} 수십 바이트다. 큰 본문은 읽거나 JSON으로 풀며 함수 시간·메모리를 쓰지 않게 바로 버린다.
  if (Number(req.headers.get("content-length") ?? 0) > 1024) return new Response(null, { status: 204 });
  const text = await req.text();
  if (text.length > 1024) return new Response(null, { status: 204 });
  let body: { code?: unknown; path?: unknown };
  try {
    body = JSON.parse(text) as { code?: unknown; path?: unknown };
  } catch {
    return new Response(null, { status: 204 }); // 형식이 틀린 요청은 조용히 무시한다
  }
  if (typeof body?.code === "string" && typeof body.path === "string") {
    try {
      await recordReferralVisit(await getDb(), body.code, body.path);
    } catch (e) {
      console.error("[api/ref]", e); // DB 오류(용량 초과·연결 실패)는 삼키지 않고 로그로 남긴다
    }
  }
  return new Response(null, { status: 204 });
}
