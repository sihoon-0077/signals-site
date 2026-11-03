// 발행 재시도(같은 요청 번호), 봉인 전 입력 검사(국내 시장, 공급자 신원 정보, 이미 지난 공개 기한), 무효 처리 기한.
// 공유 DB(integration.test.ts)와 섞이지 않게 이 파일 전용 PGlite를 쓴다(가짜 key_id 행이 키 연속성 검사·앵커에 섞이지 않도록).
// 가짜 key_id 행을 넣는 무효 처리 기한 묶음은 맨 끝에 둔다(그 뒤에 발행하면 키 연속성 검사에 걸린다).
// 서명 키는 이 파일에서 만든 일회용 키를 환경변수로 준다(개발용 키 파일 .data/keys를 읽거나 만들지 않게).
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expectedKeyId } from "@/core/keys";
import { exportPrivateKeyPem, exportPublicKeyPem, generateSigningKeyPair, publicKeyFingerprint } from "@/core/signature";
import { type Db, pgliteDb } from "../db";
import { runMigrations } from "../migrate";
import { createAgent, setAgentStatus } from "../repo/agents";
import { setProviderStatus } from "../repo/providers";
import { listAgentSignals } from "../repo/signals";
import { ConflictError, InputError } from "../sql";
import { IdentityAckRequired, PublishInput, publishSignal, recordSignalEvent } from "../services/publish";
import { registerProvider } from "../services/registration";

let pg: PGlite;
let db: Db;
let signingKeyId: string;

beforeAll(async () => {
  const kp = await generateSigningKeyPair();
  signingKeyId = expectedKeyId("signal", await publicKeyFingerprint(await exportPublicKeyPem(kp.publicKey)));
  vi.stubEnv("SIGNING_KEY_ID", signingKeyId);
  vi.stubEnv("SIGNING_PRIVATE_KEY_PEM", await exportPrivateKeyPem(kp.privateKey));
  vi.stubEnv("SIGNING_KEY_CREATED_AT", "2026-01-01T00:00:00.000Z");
  pg = new PGlite();
  db = pgliteDb(pg);
  await runMigrations(db);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await pg.close();
});

const entry = (agentId: string, over: Record<string, unknown> = {}) => ({
  requestId: crypto.randomUUID(),
  agentId,
  market: "KOSPI",
  ticker: "005930",
  side: "LONG",
  action: "ENTRY",
  targetPrice: "78000",
  stopLossPrice: "71500.5",
  maxHoldingDays: 10,
  ruleVersion: "idem-v1",
  rationale: "재시도 확인",
  ...over,
});

describe("같은 요청 번호로 다시 발행(응답을 못 받고 다시 누른 경우)", () => {
  it("새로 봉인하지 않고 이미 봉인된 기록을 돌려준다. 내용이 다르면 거부한다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "idem-entry", name: "재시도" });
    const input = entry(agentId);
    const first = await publishSignal(db, input);
    expect([first.alreadySealed, first.signal.id, first.signal.sequence_no]).toEqual([false, input.requestId, 1]);
    // 폼은 값을 문자열로 다시 보낸다(줄바꿈은 CRLF). 같은 내용이면 같은 요청으로 본다.
    const again = await publishSignal(db, { ...input, maxHoldingDays: "10", rationale: "재시도 확인\r\n" });
    expect([again.alreadySealed, again.signal.id, again.signal.content_hash]).toEqual([true, first.signal.id, first.signal.content_hash]);
    await expect(publishSignal(db, { ...input, targetPrice: "79000" })).rejects.toThrow(/이미 다른 내용이 봉인돼 있습니다\(순번 1\)/);
    await expect(publishSignal(db, { ...input, requestId: input.requestId.toUpperCase() })).resolves.toMatchObject({ alreadySealed: true });
    expect((await listAgentSignals(db, agentId)).length).toBe(1);
  });

  it("청산(EXIT) 재시도는 '이미 청산된 진입' 오류가 아니라 이미 봉인된 청산을 돌려주고, 종료한 뒤에도 같은 요청은 결과를 알려 준다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "idem-exit", name: "청산 재시도" });
    const e = await publishSignal(db, entry(agentId));
    const exit = entry(agentId, { action: "EXIT", entrySignalId: e.signal.id, targetPrice: "", stopLossPrice: "", maxHoldingDays: "" });
    const first = await publishSignal(db, exit);
    expect((await publishSignal(db, exit)).alreadySealed).toBe(true);
    await setAgentStatus(db, agentId, "TERMINATED");
    expect((await publishSignal(db, exit)).signal.id).toBe(first.signal.id);
    await expect(publishSignal(db, entry(agentId))).rejects.toBeInstanceOf(ConflictError);
  });

  it("같은 요청이 동시에 두 번 와도 하나만 봉인된다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "idem-race", name: "동시 재시도" });
    const input = entry(agentId);
    const results = await Promise.all([publishSignal(db, input), publishSignal(db, input)]);
    expect(results.map((r) => r.alreadySealed).sort()).toEqual([false, true]);
    expect((await listAgentSignals(db, agentId)).length).toBe(1);
  });

  it("요청 번호는 UUID여야 한다(없으면 서버가 새로 만든다)", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "idem-bad", name: "형식" });
    const err = await publishSignal(db, entry(agentId, { requestId: "not-a-uuid" })).catch((x) => x);
    expect(err).toBeInstanceOf(InputError);
    expect(Object.keys((err as InputError).fields)).toEqual(["requestId"]);
    const r = await publishSignal(db, entry(agentId, { requestId: "" }));
    expect(r.signal.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("다시 보낸 요청에는 타임스탬프를 새로 받지 않는다(늦은 토큰으로 진입 기준 시각을 고를 수 없게)", async () => {
    let hits = 0;
    const tsa = createServer((_req, res) => {
      hits++;
      res.statusCode = 503;
      res.end();
    });
    await new Promise<void>((r) => tsa.listen(0, "127.0.0.1", r));
    vi.stubEnv("TSA_URLS", `fake=http://127.0.0.1:${(tsa.address() as AddressInfo).port}/tsr`);
    try {
      const agentId = await createAgent(db, { providerId: null, slug: "idem-tsa", name: "토큰" });
      const input = entry(agentId);
      const first = await publishSignal(db, input);
      expect(first.tsaErrors.length).toBe(1);
      const before = hits;
      expect(before).toBeGreaterThan(0);
      const again = await publishSignal(db, input);
      expect([again.alreadySealed, again.tsaErrors, again.timestamps, hits]).toEqual([true, [], [], before]);
    } finally {
      // TSA 주소만 되돌린다(전부 되돌리면 beforeAll의 일회용 서명 키 환경변수도 사라져, 뒤 테스트가 개발용 키 파일을 찾게 된다)
      vi.stubEnv("TSA_URLS", "off");
      await new Promise((r) => tsa.close(r));
    }
  });
});

/** 승인된 공급자와 그 에이전트를 만든다(사전등록 → 승인 → 에이전트) */
async function providerAgent(handle: string, penName: string, slug: string): Promise<string> {
  await registerProvider(db, { handle, penName, email: `${handle}@example.com`, strategyType: "RULE", holdingStyle: "SWING", ageConfirmed: true, consentPrivacy: true });
  const [p] = await db.query<{ id: string }>("SELECT id FROM providers WHERE handle = $1", [handle]);
  await setProviderStatus(db, p.id, "APPROVED");
  return createAgent(db, { providerId: p.id, slug, name: "대형주 스윙" });
}

describe("공급자 신원 정보 차단(규칙 버전·근거는 봉인되어 탈퇴해도 지울 수 없다)", () => {
  it("프로필 주소·필명·연락처가 든 규칙 버전·근거는 거부하고 아무것도 봉인하지 않는다(걸린 칸을 알려 준다)", async () => {
    const agentId = await providerAgent("blue-forest", "파란숲", "kr-largecap-swing");
    const cases: [Record<string, unknown>, string, string][] = [
      [{ ruleVersion: "Blue-Forest-v1" }, "ruleVersion", "프로필 주소와 같은 표기"],
      [{ ruleVersion: "BlueForest_v2" }, "ruleVersion", "프로필 주소와 같은 표기"],
      [{ rationale: "파란숲 20일선" }, "rationale", "필명과 같은 표기"],
      [{ rationale: "파란 숲의 20일선".normalize("NFD") }, "rationale", "필명과 같은 표기"], // 띄어 쓰거나 자모가 분리된 채 붙여 넣은 필명
      [{ rationale: "문의 bluefox@gmail.com" }, "rationale", "연락처 금지"],
      [{ rationale: "설명은 t.me/bluefox" }, "rationale", "연락처 금지"],
      [{ rationale: "https://blog.naver.com/xyz 참고" }, "rationale", "연락처 금지"],
      [{ rationale: "20일선 (blog.example.com/blue)" }, "rationale", "연락처 금지"],
      [{ rationale: "텔레그램 @bluefox_kr" }, "rationale", "연락처 금지"],
      [{ rationale: "오픈채팅 open.kakao.com/o/abc" }, "rationale", "연락처 금지"],
    ];
    for (const [over, field, why] of cases) {
      const err = await publishSignal(db, entry(agentId, over)).catch((e) => e);
      expect(err, JSON.stringify(over)).toBeInstanceOf(InputError);
      expect((err as InputError).fields[field], JSON.stringify(over)).toBe(why);
    }
    // 연락처는 운영자가 확인란을 체크해도 거부한다(서버가 준 확인 값을 그대로 보내도)
    const prompt = (await publishSignal(db, entry(agentId, { rationale: "파란숲 20일선" })).catch((e) => e)) as IdentityAckRequired;
    expect(prompt).toBeInstanceOf(IdentityAckRequired);
    const acked = await publishSignal(db, entry(agentId, { rationale: "파란숲 20일선, 문의 t.me/bluefox", identityAck: prompt.ackToken })).catch((e) => e);
    expect(acked).toBeInstanceOf(InputError);
    expect((acked as InputError).fields).toEqual({ rationale: "연락처 금지" });
    expect((await listAgentSignals(db, agentId)).length).toBe(0);
    // 관계없는 정상 문구(가격 '@', 매매 표기 '@VWAP'·'@MKT', 종목 표기 포함)는 봉인된다
    for (const [ruleVersion, rationale] of [
      ["momo-v1.0", "20일선 돌파 | 거래량 2배, 손절 1.5%"],
      ["v2.1.3", "BRK.B 실적 전, 목표 @78,000, buy@open sell@close"],
      ["vwap-v1", "진입 @VWAP, 손절 -3%. 매수 @open, 매도 @close, BUY @MKT"],
      ["kr-v3", "롯데케미칼 011170 1000주 분할 매수, 000660.KS 외국인 순매수"],
    ]) {
      await publishSignal(db, entry(agentId, { ruleVersion, rationale }));
    }
    expect((await listAgentSignals(db, agentId)).length).toBe(4);
  });

  it("휴대전화 번호, 영문 라벨에 붙은 @아이디, 폭 없는 문자로 나눈 연락처도 거부하고, 확인으로 넘길 수 없다", async () => {
    // 메신저 아이디가 SIGNALS 프로필 주소와 다른 공급자(주소 검사로는 걸리지 않는 경우)
    const agentId = await providerAgent("deep-forest", "깊은숲", "kr-deep-swing");
    const zwsp = String.fromCharCode(0x200b);
    for (const over of [
      { rationale: "RSI 30 이탈 매수, 문의 010-1234-5678" },
      { rationale: "+82 10-1234-5678 로 문의" },
      { ruleVersion: "IG@bluefox_kr" },
      { rationale: "카톡ID@bluefox 로 문의" },
      { rationale: `자세히는 t${zwsp}.me/bluefox 참고` },
      { rationale: `텔레그램 @${zwsp}bluefox_kr` },
      { rationale: `문의 bluefox@gmail.c${zwsp}om` },
    ]) {
      const err = await publishSignal(db, entry(agentId, over)).catch((e) => e);
      expect(err, JSON.stringify(over)).toBeInstanceOf(InputError);
      expect(err, JSON.stringify(over)).not.toBeInstanceOf(IdentityAckRequired);
      expect((err as InputError).fields, JSON.stringify(over)).toEqual({ [Object.keys(over)[0]]: "연락처 금지" });
      expect((err as Error).message).toMatch(/휴대전화 번호를 넣을 수 없습니다/);
    }
    expect((await listAgentSignals(db, agentId)).length).toBe(0);
  });

  it("하이픈 없는 주소를 띄어 쓰거나 버전 번호를 바로 붙인 규칙 버전·근거도 확인을 요구하고 아무것도 봉인하지 않는다", async () => {
    const agentId = await providerAgent("bluefox", "파란여우", "kr-midcap-swing");
    for (const over of [{ ruleVersion: "BlueFoxV2" }, { ruleVersion: "bluefox2" }, { rationale: "Blue Fox 20일선 전략" }, { rationale: "blue fox 전략 20일선" }]) {
      const err = await publishSignal(db, entry(agentId, over)).catch((e) => e);
      expect(err, JSON.stringify(over)).toBeInstanceOf(IdentityAckRequired);
      expect((err as InputError).fields, JSON.stringify(over)).toEqual({ [Object.keys(over)[0]]: "프로필 주소와 같은 표기", identityAck: "확인 필요" });
    }
    expect((await listAgentSignals(db, agentId)).length).toBe(0);
  });

  it("일반 낱말과 겹친 주소·필명은 운영자 확인(identityAck)으로 넘기고, 고쳐서 같은 요청 번호로 다시 보내도 한 번만 봉인된다", async () => {
    // 주소 'rsi'·필명 '돌파'처럼 지표·용어와 같은 공급자. 근거 하나에 주소('RSI')와 필명('돌파')이 함께 걸린다: 둘 다 알린다
    const agentId = await providerAgent("rsi", "돌파", "rsi-breakout");
    const input = entry(agentId, { rationale: "RSI 30 이탈, 20일선 돌파" });
    const err = (await publishSignal(db, input).catch((e) => e)) as IdentityAckRequired;
    expect(err).toBeInstanceOf(IdentityAckRequired);
    expect(err.fields).toEqual({ rationale: "프로필 주소·필명과 같은 표기", identityAck: "확인 필요" });
    expect(err.message).toContain("걸린 표기: 근거의 프로필 주소 @rsi, 근거의 필명 돌파");
    expect(err.message).toMatch(/확인란을 체크한 뒤 다시 누르세요/);
    // 확인란을 체크해 같은 요청 번호로 다시 보낸다(폼은 요청 번호와 서버가 준 확인 값을 남긴다)
    const ok = await publishSignal(db, { ...input, identityAck: err.ackToken });
    expect([ok.alreadySealed, ok.signal.id, ok.signal.sequence_no]).toEqual([false, input.requestId, 1]);
    // 확인 여부는 봉인 필드가 아니다: 응답을 못 받고 다시 누르면(확인란이 풀려 있어도) 이미 봉인된 기록을 돌려준다
    expect((await publishSignal(db, input)).alreadySealed).toBe(true);
    // 낱말 단위로 본다: 주소가 다른 낱말의 일부일 때('rsi' ⊂ 'rsix')는 걸리지 않는다
    await publishSignal(db, entry(agentId, { rationale: "rsix 지표 확인" }));
    expect((await listAgentSignals(db, agentId)).length).toBe(2);
  });

  it("걸린 표기를 두 칸 모두에서 보여 주고, 확인은 보여 준 묶음(에이전트·걸린 칸의 문구·표기)에만 적용된다", async () => {
    // 주소 'macd'(지표 이름)·필명 '돌파왕'. 규칙 버전에는 주소가, 근거에는 필명이 있다(첫 번째만 알리면 필명이 확인 없이 봉인된다)
    const agentId = await providerAgent("macd", "돌파왕", "macd-swing");
    const input = entry(agentId, { ruleVersion: "macd-v1", rationale: "돌파왕 본인 전략: 20일선 돌파" });
    const err = (await publishSignal(db, input).catch((e) => e)) as IdentityAckRequired;
    expect(err).toBeInstanceOf(IdentityAckRequired);
    expect(err.message).toContain("걸린 표기: 규칙 버전의 프로필 주소 @macd, 근거의 필명 돌파왕");
    expect(err.fields).toEqual({ ruleVersion: "프로필 주소와 같은 표기", rationale: "필명과 같은 표기", identityAck: "확인 필요" });
    // 예전 화면의 'on'·true 같은 값은 확인으로 보지 않는다(입력 오류가 아니라 다시 묻는다)
    for (const stale of ["on", "true", true, ""]) {
      const again = (await publishSignal(db, { ...input, identityAck: stale }).catch((e) => e)) as IdentityAckRequired;
      expect(again, String(stale)).toBeInstanceOf(IdentityAckRequired);
      expect(again.ackToken).toBe(err.ackToken); // 같은 에이전트·문구면 같은 확인 값
    }
    // 걸린 칸의 문구를 고치면(같은 표기가 남아도) 다시 묻는다
    const edited = (await publishSignal(db, { ...input, rationale: "돌파왕 본인 전략: 60일선 돌파", identityAck: err.ackToken }).catch((e) => e)) as IdentityAckRequired;
    expect(edited).toBeInstanceOf(IdentityAckRequired);
    expect(edited.ackToken).not.toBe(err.ackToken);
    // 다른 공급자의 에이전트로 바꾸면 그 공급자 표기를 다시 묻는다(체크한 확인 값이 남아 있어도)
    const otherId = await providerAgent("deep-river", "깊은강", "deep-river-swing");
    const switched = (await publishSignal(db, entry(otherId, { ruleVersion: "v2", rationale: "깊은강 전략: 20일선 돌파", identityAck: err.ackToken })).catch((e) => e)) as IdentityAckRequired;
    expect(switched).toBeInstanceOf(IdentityAckRequired);
    expect(switched.message).toContain("근거의 필명 깊은강");
    expect((await listAgentSignals(db, otherId)).length).toBe(0);
    expect((await listAgentSignals(db, agentId)).length).toBe(0);
    // 보여 준 묶음을 그대로 확인하면 봉인한다
    const ok = await publishSignal(db, { ...input, identityAck: err.ackToken });
    expect(ok.signal.sequence_no).toBe(1);
  });

  it("플랫폼 에이전트(공급자 없음)는 보지 않는다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "guard-platform", name: "플랫폼 운영" });
    const r = await publishSignal(db, entry(agentId, { ruleVersion: "blue-forest-v1", rationale: "파란숲 20일선" }));
    expect(r.signal.sequence_no).toBe(1);
  });
});

describe("공개 기한이 이미 지났거나 진입보다 이른 진입(ENTRY)은 봉인하지 않는다", () => {
  it("지난 유효기한은 거부하고 아무것도 봉인하지 않는다. 고친 뒤 같은 요청 번호로 다시 보내면 순번 1로 봉인된다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "reveal-past", name: "지난 기한" });
    const input = entry(agentId, { maxHoldingDays: "", validUntil: new Date(Date.now() - 60_000).toISOString() });
    const err = await publishSignal(db, input).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect((err as InputError).fields).toEqual({ validUntil: "공개 기한이 이미 지남" });
    expect((err as Error).message).toMatch(/이대로 봉인하면 원문이 바로 공개됩니다/);
    expect((await listAgentSignals(db, agentId)).length).toBe(0);
    const fixed = await publishSignal(db, { ...input, validUntil: "", maxHoldingDays: 10 });
    expect([fixed.alreadySealed, fixed.signal.id, fixed.signal.sequence_no]).toEqual([false, input.requestId, 1]);
  });

  it("진입가가 정해지기 전에 오는 유효기한(2분 뒤)은 하루 중 언제 발행해도 거부한다", async () => {
    // 진입가는 빨라도 토큰 여유 1분 + 거래량가중평균가 창 10분 뒤에 정해진다(장 전이면 그날 09:00, 장 마감 뒤·휴장일이면 다음 시가)
    const agentId = await createAgent(db, { providerId: null, slug: "reveal-early", name: "이른 기한" });
    const err = await publishSignal(db, entry(agentId, { maxHoldingDays: "", validUntil: new Date(Date.now() + 2 * 60_000).toISOString() })).catch((e) => e);
    expect(err).toBeInstanceOf(InputError);
    expect((err as InputError).fields).toEqual({ validUntil: "공개 기한이 진입보다 먼저" });
    expect((err as Error).message).toMatch(/원문이 진입 전에 공개됩니다/);
    expect((await listAgentSignals(db, agentId)).length).toBe(0);
  });

  it("청산(EXIT)은 공개 기한을 따로 받지 않으므로 보지 않는다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "reveal-exit", name: "청산" });
    const e = await publishSignal(db, entry(agentId));
    const x = await publishSignal(db, entry(agentId, { action: "EXIT", entrySignalId: e.signal.id, targetPrice: "", stopLossPrice: "", maxHoldingDays: "" }));
    expect(x.signal.sequence_no).toBe(2);
  });
});

describe("1R은 국내 시장(KOSPI·KOSDAQ) 진입만 봉인한다(공개 기한·진입 기준이 KRX 시간 기준)", () => {
  it("진입은 KOSPI·KOSDAQ만 받고, 청산은 진입과 같은 시장이면 이미 봉인된 다른 시장 기록도 닫을 수 있다(입력 형식)", () => {
    const base = { agentId: crypto.randomUUID(), ticker: "005930", side: "LONG", maxHoldingDays: 10, ruleVersion: "r1" };
    for (const market of ["KOSPI", "KOSDAQ"]) expect(PublishInput.safeParse({ ...base, market, action: "ENTRY" }).success, market).toBe(true);
    for (const market of ["NYSE", "NASDAQ", "AMEX"]) {
      const r = PublishInput.safeParse({ ...base, market, action: "ENTRY" });
      expect(r.success, market).toBe(false);
      expect(r.error?.issues.map((i) => i.path), market).toEqual([["market"]]);
    }
    for (const market of ["KOSPI", "NASDAQ"]) {
      expect(PublishInput.safeParse({ ...base, market, action: "EXIT", entrySignalId: crypto.randomUUID() }).success, market).toBe(true);
    }
  });

  it("미국 시장 진입은 거부하고 아무것도 봉인하지 않는다. 같은 에이전트의 KOSPI·KOSDAQ 진입은 봉인된다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "market-krx", name: "국내 시장" });
    for (const market of ["NYSE", "NASDAQ", "AMEX"]) {
      const err = await publishSignal(db, entry(agentId, { market, ticker: "AAPL" })).catch((e) => e);
      expect(err, market).toBeInstanceOf(InputError);
      expect((err as InputError).fields, market).toEqual({ market: "1R은 국내 시장(KOSPI·KOSDAQ) 진입만 봉인합니다(공개 기한·진입 기준이 KRX 시간 기준)" });
    }
    expect((await listAgentSignals(db, agentId)).length).toBe(0);
    expect((await publishSignal(db, entry(agentId, { market: "KOSPI" }))).signal.sequence_no).toBe(1);
    expect((await publishSignal(db, entry(agentId, { market: "KOSDAQ", ticker: "035720" }))).signal.sequence_no).toBe(2);
  });

  it("제한 전에 봉인된 미국 시장 진입은 같은 시장의 청산(EXIT)과 청산 기록으로 닫을 수 있다", async () => {
    const agentId = await createAgent(db, { providerId: null, slug: "market-legacy", name: "이전 기록" });
    // 제한 전 봉인 기록을 흉내 낸 행(서명 키는 이 파일의 키라 키 연속성 검사에 걸리지 않는다)
    const legacy = async (seq: number) =>
      (
        await db.query<{ id: string }>(
          `INSERT INTO signals (agent_id, sequence_no, market, ticker, side, action, max_holding_days, is_paper, rule_version, nonce,
                                published_at, prev_hash, content_hash, signature, key_id)
           VALUES ($1, $2, 'NASDAQ', 'AAPL', 'LONG', 'ENTRY', 10, true, 'us-v1', md5($3), date_trunc('milliseconds', clock_timestamp()),
                   repeat('0', 64), md5($3) || md5($3 || 'x'), 'sig', $4) RETURNING id`,
          [agentId, seq, `market-legacy-${seq}`, signingKeyId],
        )
      )[0].id;
    const first = await legacy(1);
    const exit = await publishSignal(db, entry(agentId, { market: "NASDAQ", ticker: "AAPL", action: "EXIT", entrySignalId: first, targetPrice: "", stopLossPrice: "", maxHoldingDays: "" }));
    expect([exit.signal.sequence_no, exit.signal.market]).toEqual([2, "NASDAQ"]);
    const second = await legacy(3);
    await recordSignalEvent(db, second, "CLOSED");
    expect((await listAgentSignals(db, agentId)).map((s) => [s.sequence_no, s.market, s.event])).toEqual([
      [3, "NASDAQ", "CLOSED"],
      [2, "NASDAQ", null],
      [1, "NASDAQ", null],
    ]);
  });
});

describe("무효(VOID) 처리 기한", () => {
  it("발행 10분 안만 받고, 25일·400일 지난 기록도 오류 대신 안내로 거부한다(예전에는 약 24.8일 뒤 integer out of range)", async () => {
    const [a] = await db.query<{ id: string }>("INSERT INTO agents (slug, name, is_platform_owned) VALUES ('void-age', '무효 기한', true) RETURNING id");
    const ages = ["1 minute", "9 minutes 59 seconds", "10 minutes 1 second", "25 days", "400 days"];
    const ids: string[] = [];
    for (const [i, age] of ages.entries()) {
      const [s] = await db.query<{ id: string }>(
        `INSERT INTO signals (agent_id, sequence_no, market, ticker, side, action, max_holding_days, is_paper, rule_version, nonce,
                              published_at, prev_hash, content_hash, signature, key_id)
         VALUES ($1, $2, 'KOSPI', '005930', 'LONG', 'ENTRY', 250, true, 'r1', md5($3), date_trunc('milliseconds', clock_timestamp() - $4::interval),
                 repeat('0', 64), md5($3) || md5($3 || 'x'), 'sig', 'k') RETURNING id`,
        [a.id, i + 1, `void-age-${i}`, age],
      );
      ids.push(s.id);
    }
    const outcome = async (id: string) =>
      recordSignalEvent(db, id, "VOID", "오타").then(
        () => "기록",
        (e: Error) => (e instanceof ConflictError && /10분 안에만/.test(e.message) ? "거부" : `오류: ${e.message}`),
      );
    const got: string[] = [];
    for (const id of ids) got.push(await outcome(id));
    expect(got).toEqual(["기록", "기록", "거부", "거부", "거부"]);
  });
});
