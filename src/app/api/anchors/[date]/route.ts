// 일일 앵커 문서(JSON). GitHub 공개 저장소의 anchors/날짜.json과 같은 내용이다.
import { isRealDate } from "@/core/date";
import { getDb } from "@/server/db";
import { getAnchor } from "@/server/services/anchor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  // 13월·32일 같은 값이 RangeError(500)로 새지 않고 400이 되도록 공용 검사를 쓴다(src/core/date.ts)
  if (!isRealDate(date)) return Response.json({ error: "bad date" }, { status: 400 });
  const doc = await getAnchor(await getDb(), date);
  if (!doc) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(doc, { headers: { "Access-Control-Allow-Origin": "*" } });
}
