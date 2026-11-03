// 공개키 목록. 같은 내용을 GitHub 앵커 저장소에도 고정한다(키 바꿔치기 방지).
import { publicKeysFile } from "@/server/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await publicKeysFile(), { headers: { "Access-Control-Allow-Origin": "*" } });
}
