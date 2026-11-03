// 모든 일일 앵커의 날짜·루트·직전 루트(오래된 순). 공개 앵커 저장소가 매일 자기 사본과 대조해
// 과거 루트가 바뀌거나 사라지면 실패(공개 경보)로 남긴다(deploy/anchors-repo/scripts/pull-anchor.sh).
import { getDb } from "@/server/db";
import { listAnchorRoots } from "@/server/services/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ anchors: await listAnchorRoots(await getDb()) }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
