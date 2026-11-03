// 로컬 시연용 데이터: 자체 에이전트 3개(든든·파도·질주, 08 §8), 승인된 공급자 1명과 그 에이전트,
// 시그널 몇 건(실제 TSA 토큰 포함), 청산 1건, 오늘 앵커. 로컬 PGlite(.data/pglite)에만 쓴다.
// 사용: npm run seed:dev   (TSA_URLS=off 로 실행하면 타임스탬프 없이 만든다)
import { closeDb, getDb } from "../src/server/db";
import { createAgent, getAgentBySlug, listAgentsByProvider } from "../src/server/repo/agents";
import { setProviderStatus } from "../src/server/repo/providers";
import { buildDailyAnchor } from "../src/server/services/anchor";
import { publishSignal, recordSignalEvent } from "../src/server/services/publish";
import { registerProvider } from "../src/server/services/registration";

async function ensureAgent(db: Awaited<ReturnType<typeof getDb>>, providerId: string | null, slug: string, name: string, description: string) {
  const found = await getAgentBySlug(db, slug);
  return found ? found.id : createAgent(db, { providerId, slug, name, description });
}

async function main() {
  if (process.env.DATABASE_URL) throw new Error("seed:dev는 로컬 PGlite 전용입니다. DATABASE_URL을 비우고 실행하세요.");
  const db = await getDb();
  const own = [
    await ensureAgent(db, null, "dundeun", "든든", "대형주 20일선 돌파 + 거래량 조건, 보수적 손절"),
    await ensureAgent(db, null, "pado", "파도", "업종 상대강도 상위 종목의 눌림목 진입"),
    await ensureAgent(db, null, "jilju", "질주", "52주 신고가 돌파 추세 추종"),
  ];
  let providerId = (await db.query<{ id: string }>("SELECT id FROM providers WHERE handle = 'blue-forest'"))[0]?.id;
  if (!providerId) {
    await registerProvider(db, {
      handle: "blue-forest",
      penName: "파란숲",
      email: "demo@example.com",
      strategyType: "RULE",
      holdingStyle: "SWING",
      description: "직장인 부업 퀀트. 20일선 돌파와 거래량 조건으로 국내 대형주 스윙 시그널을 냅니다.",
      channels: ["https://blog.example.com/blue-forest"],
      ageConfirmed: true,
      consentPrivacy: true,
    });
    providerId = (await db.query<{ id: string }>("SELECT id FROM providers WHERE handle = 'blue-forest'"))[0].id;
    await setProviderStatus(db, providerId, "APPROVED");
  }
  // 공급자 에이전트의 주소·이름에는 필명·프로필 주소를 넣지 않는다(탈퇴 뒤에도 기록은 계속 공개되므로, 운영 관례의 본보기).
  // 예전 시드로 만든 로컬 DB에는 이미 에이전트가 있으니 그것을 그대로 쓴다(빈 에이전트가 하나 더 생기지 않게).
  const providerAgent =
    (await listAgentsByProvider(db, providerId))[0]?.id ??
    (await createAgent(db, { providerId, slug: "kr-largecap-swing", name: "대형주 스윙", description: "국내 대형주 스윙(시연용 수동 사전등록)" }));

  const existing = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM signals");
  if (existing[0].n === 0) {
    const plan = [
      { agentId: own[0], ticker: "005930", targetPrice: "78000", stopLossPrice: "71500" },
      { agentId: own[1], ticker: "000660", targetPrice: "245000", stopLossPrice: "221000" },
      { agentId: own[2], ticker: "035420", targetPrice: "212000", stopLossPrice: "191000" },
      { agentId: providerAgent, ticker: "051910", targetPrice: "355000", stopLossPrice: "322000" },
      { agentId: own[0], ticker: "005380", targetPrice: "265000", stopLossPrice: "241000" },
    ];
    const ids: string[] = [];
    for (const p of plan) {
      const r = await publishSignal(db, { ...p, market: "KOSPI", side: "LONG", action: "ENTRY", suggestedWeight: "0.1", maxHoldingDays: 10, ruleVersion: "demo-v1.0", rationale: "시연용 모의 시그널" });
      ids.push(r.signal.id);
      console.log(`발행 #${r.signal.sequence_no} ${p.ticker} 지문 ${r.signal.content_hash.slice(0, 12)}… 타임스탬프 ${r.timestamps.length}건${r.tsaErrors.length ? ` (실패: ${r.tsaErrors.join("; ")})` : ""}`);
    }
    await recordSignalEvent(db, ids[0], "CLOSED", "시연: 목표가 도달 가정");
    console.log("첫 시그널을 청산 처리해 원문을 공개했습니다.");
  }
  const a = await buildDailyAnchor(db);
  console.log(`앵커 ${a.created ? "생성" : "이미 있음"}: ${a.document.date} 루트 ${a.document.merkle_root.slice(0, 16)}…`);
}

// process.exit()를 부르지 않는다(scripts/anchor.ts와 같은 이유: Windows Node 24에서 TSA 요청 직후 0xC0000409로 죽을 수 있음).
// 연 DB를 닫아야 곧바로 끝난다(열어 둔 PGlite는 10초쯤 종료를 붙잡는다). 오류면 종료 코드 1.
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb().catch(() => undefined));
