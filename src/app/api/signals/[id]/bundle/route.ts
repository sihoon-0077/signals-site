// 공개 검증 묶음 API. 브라우저 검증 페이지와 CLI가 이 JSON만으로 직접 계산한다.
import { getDb } from "@/server/db";
import { getSignalBundle } from "@/server/services/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getSignalBundle(await getDb(), id);
  if (!bundle) return Response.json({ error: "not found" }, { status: 404 });
  // charset을 밝힌다: 없으면 Windows PowerShell 5.1(Invoke-WebRequest)이 본문을 ISO-8859-1로 읽어 한글이 깨진 사본이 변조로 판정된다
  return Response.json(bundle, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}
