// 시그널 발행 = 봉인(03 설계 §4.2). 순서가 중요하다:
//   1) 에이전트 행을 잠가 같은 에이전트의 동시 발행이 순번을 겹치지 않게 한다
//   2) 발행 시각은 앱 시계가 아니라 DB 시계(clock_timestamp)로, 밀리초까지 잘라 쓴다
//      봉인 전 입력 검사: 국내 시장 진입만(1R), 공급자 신원 정보(필명·프로필 주소·연락처), 이미 지났거나 진입보다 이른 공개 기한(ENTRY)
//   3) 정규 직렬화 v2 → SHA-256 지문 → 서명 → INSERT
//   4) 저장된 행을 다시 읽어 지문을 재계산하고, 다르면 되돌린다(드라이버·NUMERIC 반올림 차이로
//      "정상 시그널이 나중에 위조로 판정되는" 사고를 원천 차단)
//   5) 커밋 후 TSA 토큰을 받아 저장한다(실패해도 발행은 유지, 진입 기준은 다음 앵커로 밀림)
// 같은 요청(requestId = 시그널 ID)을 다시 보내면 새로 봉인하지 않고 이미 봉인된 기록을 돌려준다(응답을 못 받고 다시 누른 경우).
import "server-only";
import { z } from "zod";
import { GENESIS_HASH, type SignalFieldsV2, contentHashV2 } from "@/core/canonical";
import { randomHex, sha256Hex, toBase64 } from "@/core/encoding";
import { entryRevealProblem } from "@/core/reveal";
import { signMessage } from "@/core/signature";
import { ENTRY_MARKETS } from "@/lib/agent-rules";
import { kstDateTime } from "@/lib/format";
import type { Db } from "../db";
import { type IdentityHit, findContact, findProviderNames } from "../identity-guard";
import { loadKey } from "../keys";
import { SIGNAL_SELECT, type SignalRow, getSignal, getTimestamps, rowToFields } from "../repo/signals";
import { ConflictError, InputError, NotFoundError, iso } from "../sql";
import { type ObtainedToken, obtainTimestamps } from "../tsa-client";
import { fieldErrors } from "./registration";

const decimal = z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/, "숫자(소수 4자리까지)");
const optionalDecimal = z.preprocess((v) => (v === "" || v === undefined ? null : v), decimal.nullable());

export const PublishInput = z
  .object({
    // 요청 번호(관리자 폼이 만든 UUID). 그대로 시그널 ID가 된다. 없으면(스크립트·테스트) 서버가 새로 만든다.
    requestId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.uuid("요청 번호 형식이 아닙니다").optional()),
    agentId: z.uuid(),
    market: z.enum(["KOSPI", "KOSDAQ", "NYSE", "NASDAQ", "AMEX"]),
    ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/, "종목 코드 형식"),
    side: z.enum(["LONG", "SHORT"]),
    action: z.enum(["ENTRY", "EXIT"]),
    targetPrice: optionalDecimal,
    stopLossPrice: optionalDecimal,
    suggestedWeight: optionalDecimal.refine((v) => v === null || Number(v) <= 1, "비중은 0~1"),
    maxHoldingDays: z.preprocess((v) => (v === "" || v === undefined ? null : Number(v)), z.number().int().min(1).max(250).nullable()),
    validUntil: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.iso.datetime({ offset: true }).nullable()),
    isPaper: z.boolean().default(true),
    entrySignalId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.uuid().nullable()),
    ruleVersion: z.string().trim().min(1).max(40),
    // 폼 전송의 CRLF를 LF로 맞춘 뒤 봉인한다(화면 글자 수와 서버 글자 수가 어긋나지 않게)
    rationale: z.preprocess((v) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v), z.string().trim().max(500).default("")),
    // 운영자 확인: 규칙 버전·근거에 공급자 프로필 주소·필명과 같은 표기가 있지만 겹치는 일반 낱말일 뿐임(관리자 폼의 확인란).
    // 값은 서버가 확인을 요청하며 준 표시(IdentityAckRequired.ackToken)라, 그때 보여 준 에이전트·문구·걸린 표기에만 적용된다.
    // 문자열이 아닌 값(예전 화면의 true 등)은 확인으로 보지 않는다(입력 오류 대신 다시 묻는다). 봉인 필드가 아니다(inputFields에 넣지 않음).
    // 연락처(메일·링크·메신저 아이디·휴대전화 번호)는 이 값과 상관없이 거부한다.
    identityAck: z.preprocess((v) => (typeof v === "string" ? v.slice(0, 200) : ""), z.string()),
  })
  // 1R은 국내 시장 진입만 새로 봉인한다(ENTRY_MARKETS). 공개 기한(15:30 KST)·진입 기준(entry.ts)·봉인 전 검사(entryRevealProblem)가 모두
  // KRX 시간이라, 미국 시장은 원문이 미국 장 전에 공개되거나 미국 장 마감까지 유효한 정상 시그널이 거부된다. 미국 장 시간 모델을 넣을 때 다시 연다.
  // 청산(EXIT)은 진입과 같은 시장이어야 하므로(봉인 단계에서 대조) 시장 목록 전체를 받는다. 이미 봉인된 기록의 읽기·검증은 이 검사와 상관없다.
  .refine((v) => v.action === "EXIT" || (ENTRY_MARKETS as readonly string[]).includes(v.market), {
    message: "1R은 국내 시장(KOSPI·KOSDAQ) 진입만 봉인합니다(공개 기한·진입 기준이 KRX 시간 기준)",
    path: ["market"],
  })
  .refine((v) => v.action === "ENTRY" || v.entrySignalId !== null, { message: "청산(EXIT)은 진입 시그널을 지정해야 합니다", path: ["entrySignalId"] })
  // 진입은 공개 기한이 있어야 한다(유효기한 또는 최대 보유 거래일). 기한이 없으면 원문 공개가 운영자 손에만 달린다.
  .refine((v) => v.action === "EXIT" || v.validUntil !== null || v.maxHoldingDays !== null, {
    message: "진입(ENTRY)은 유효기한이나 최대 보유 거래일 중 하나를 넣어야 합니다(원문 공개 기한)",
    path: ["maxHoldingDays"],
  });

/** 무효(VOID)는 오타 정정용이다. 결과를 본 뒤 기록을 무효로 돌리지 못하게 발행 직후 짧은 시간에만 허용한다. */
const VOID_WINDOW_MS = 10 * 60 * 1000;
export type PublishInput = z.input<typeof PublishInput>;

export interface PublishResult {
  signal: SignalRow;
  timestamps: { tsa: string; genTime: string }[];
  tsaErrors: string[];
  /** 같은 요청 번호로 이미 봉인돼 있어 새로 봉인하지 않았다 */
  alreadySealed: boolean;
}

/** 입력에서 오는 봉인 필드(ID·순번·nonce·발행 시각·직전 지문 제외) */
function inputFields(v: z.output<typeof PublishInput>) {
  return {
    agentId: v.agentId.toLowerCase(),
    market: v.market,
    ticker: v.ticker,
    side: v.side,
    action: v.action,
    targetPrice: v.targetPrice,
    stopLossPrice: v.stopLossPrice,
    suggestedWeight: v.suggestedWeight,
    maxHoldingDays: v.maxHoldingDays,
    validUntil: v.validUntil ? new Date(v.validUntil).toISOString() : null,
    isPaper: v.isPaper,
    entrySignalId: v.entrySignalId ? v.entrySignalId.toLowerCase() : null,
    ruleVersion: v.ruleVersion,
    rationale: v.rationale,
  };
}

/**
 * 운영자 확인이 필요한 공급자 신원 표기(규칙 버전·근거). 메시지는 걸린 표기를 모두 적는다.
 * ackToken은 이번에 보여 준 묶음(에이전트 + 걸린 칸의 문구 + 걸린 표기)의 지문이고, 관리자 폼이 확인란의 값으로 돌려보낸다(actions.ts → forms.tsx).
 */
export class IdentityAckRequired extends InputError {
  constructor(
    message: string,
    fields: Record<string, string>,
    readonly ackToken: string,
  ) {
    super(message, fields);
  }
}

/**
 * 공급자 에이전트의 규칙 버전·근거에 공급자 신원 정보가 있으면 거부한다(identity-guard.ts).
 * 이 두 칸은 봉인되어 탈퇴해도 고칠 수 없고(UPDATE 금지 트리거), 공개 기한이 지나면 /verify·bundle API로 누구나 받는다.
 * - 메일·링크·메신저 아이디·휴대전화 번호: 항상 거부(확인으로 넘길 수 없음)
 * - 프로필 주소(낱말 단위)·필명: 걸린 표기를 두 칸 모두에서 찾아 전부 보여 주고, 운영자가 그 묶음을 '겹치는 일반 낱말'이라고
 *   확인(identityAck)한 경우만 통과한다. 확인은 보여 준 묶음에만 적용된다: 에이전트를 바꾸거나 걸린 칸의 문구를 고치면 다시 묻는다
 *   (한 번 체크한 확인이 다른 공급자의 에이전트나 보여 주지 않은 필명까지 넘기지 않게).
 * 플랫폼 에이전트(공급자 없음)는 보지 않는다. 거부해도 요청 번호는 폼에 남으므로 고쳐서 다시 누르면 한 번만 봉인된다.
 */
async function assertNoProviderIdentity(
  agent: { id: string; is_platform_owned: boolean; handle: string | null; pen_name: string | null },
  v: { ruleVersion: string; rationale: string; identityAck: string },
): Promise<void> {
  if (agent.is_platform_owned || agent.handle === null || agent.pen_name === null) return;
  const texts = [
    ["ruleVersion", "규칙 버전", v.ruleVersion],
    ["rationale", "근거", v.rationale],
  ] as const;
  for (const [field, , text] of texts) {
    const contact = findContact(text);
    if (contact) {
      throw new InputError(`규칙 버전·근거에는 메일·링크·메신저 아이디·휴대전화 번호를 넣을 수 없습니다(걸린 표기: ${contact}). 봉인하면 탈퇴해도 지울 수 없습니다.`, {
        [field]: "연락처 금지",
      });
    }
  }
  const identity = { handle: agent.handle, pen_name: agent.pen_name };
  const flagged = texts
    .map(([field, name, text]) => ({ field, name, text, hits: findProviderNames(text, identity, { handleAsToken: true }) }))
    .filter((f) => f.hits.length > 0);
  if (!flagged.length) return;
  // 확인 값 = 에이전트 ID·걸린 칸과 그 문구·걸린 표기를 묶은 SHA-256. 하나라도 달라지면 값이 바뀌어 다시 묻는다
  // (비밀값이 아니라 '무엇을 보여 주고 확인받았나'의 표시다. 확인란은 운영자 화면에만 있다).
  const key = (h: IdentityHit) => `${h.kind}:${h.label}`;
  const ackToken = await sha256Hex(JSON.stringify([agent.id, flagged.map((f) => [f.field, f.text, f.hits.map(key)])]));
  if (v.identityAck === ackToken) return;
  const what = (h: IdentityHit) => (h.kind === "handle" ? `프로필 주소 ${h.label}` : `필명 ${h.label}`);
  const shown = flagged.flatMap((f) => f.hits.map((h) => `${f.name}의 ${what(h)}`)).join(", ");
  const mark = (hits: IdentityHit[]) => (hits.length > 1 ? "프로필 주소·필명과 같은 표기" : hits[0].kind === "handle" ? "프로필 주소와 같은 표기" : "필명과 같은 표기");
  throw new IdentityAckRequired(
    `규칙 버전·근거에 공급자 프로필 주소·필명과 같은 표기가 있습니다(걸린 표기: ${shown}). 봉인하면 탈퇴해도 지울 수 없습니다. 공급자를 가리키는 표기면 봉인하지 말고 그 표기를 뺀 시그널을 다시 받고, 모두 겹치는 일반 낱말이면 확인란을 체크한 뒤 다시 누르세요(에이전트나 걸린 칸의 문구를 바꾸면 다시 묻습니다).`,
    { ...Object.fromEntries(flagged.map((f) => [f.field, mark(f.hits)])), identityAck: "확인 필요" },
    ackToken,
  );
}

export async function publishSignal(db: Db, raw: unknown): Promise<PublishResult> {
  const parsed = PublishInput.safeParse(raw);
  if (!parsed.success) throw new InputError("입력값을 확인해 주세요.", fieldErrors(parsed.error));
  const v = parsed.data;
  const key = await loadKey("signal");
  // ID를 앱에서 먼저 만들어 봉인 문자열에 넣는다(ID 바꿔치기 차단, canonical.ts 참고). 관리자 폼은 요청 번호를 넘긴다.
  const signalId = (v.requestId ?? crypto.randomUUID()).toLowerCase();
  const input = inputFields(v);

  const { signal, alreadySealed } = await db.tx(async (t) => {
    const agent = await t.query<{ id: string; status: string; provider_status: string | null; is_platform_owned: boolean; handle: string | null; pen_name: string | null }>(
      `SELECT a.id, a.status, a.is_platform_owned, p.status AS provider_status, p.handle, p.pen_name
         FROM agents a LEFT JOIN providers p ON p.id = a.provider_id
        WHERE a.id = $1 FOR UPDATE OF a`,
      [v.agentId],
    );
    if (!agent[0]) throw new NotFoundError("에이전트가 없습니다.");

    // 커밋 직후 응답이 끊기면 화면은 실패인데 DB에는 봉인돼 있다. 같은 요청 번호로 다시 오면 새로 봉인하지 않고 그 기록을 돌려준다
    // (그대로 봉인하면 같은 내용이 순번+1로 영구히 한 번 더 남는다). 에이전트를 잠근 뒤라 같은 요청이 동시에 와도 하나만 봉인된다.
    const existing = (await t.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.id = $1`, [signalId]))[0];
    if (existing) {
      const same = await contentHashV2({
        ...input,
        signalId: existing.id,
        sequenceNo: existing.sequence_no,
        nonce: existing.nonce,
        publishedAt: existing.published_at,
        prevHash: existing.prev_hash,
      });
      if (same !== existing.content_hash) {
        throw new ConflictError(`이 요청 번호로 이미 다른 내용이 봉인돼 있습니다(순번 ${existing.sequence_no}). 화면을 새로고침한 뒤 새로 입력하세요.`);
      }
      return { signal: existing, alreadySealed: true };
    }

    if (agent[0].status === "TERMINATED") throw new ConflictError("종료된 에이전트는 발행할 수 없습니다.");
    if (!agent[0].is_platform_owned && agent[0].provider_status !== "APPROVED") throw new ConflictError("승인되지 않은 공급자의 에이전트에는 발행할 수 없습니다.");
    await assertNoProviderIdentity(agent[0], v);

    // 서명 키가 이전 발행과 다르면 멈춘다. 잘못된 키(개발용 키, 잃어버린 뒤 새로 만든 키)로 조용히 봉인하면
    // 그 기록은 공개키 목록의 키로 검증되지 않는 채 영구히 남는다. 키 교체는 별도 절차로만 한다.
    const lastKey = await t.query<{ key_id: string }>("SELECT key_id FROM signals ORDER BY published_at DESC LIMIT 1");
    if (lastKey[0] && lastKey[0].key_id !== key.keyId) {
      throw new ConflictError(`서명 키(${key.keyId})가 이전 발행의 키(${lastKey[0].key_id})와 다릅니다. 환경변수의 키를 확인하세요.`);
    }

    if (v.entrySignalId) {
      const entry = await t.query<{ agent_id: string; action: string; market: string; ticker: string; side: string }>(
        "SELECT agent_id, action, market, ticker, side FROM signals WHERE id = $1",
        [v.entrySignalId],
      );
      const e = entry[0];
      if (!e || e.agent_id !== v.agentId || e.action !== "ENTRY") throw new InputError("진입 시그널이 이 에이전트의 ENTRY가 아닙니다.", { entrySignalId: "잘못된 진입 시그널" });
      if (e.market !== v.market || e.ticker !== v.ticker || e.side !== v.side) {
        throw new InputError("청산은 진입과 같은 시장·종목·방향이어야 합니다.", { entrySignalId: `진입: ${e.market} ${e.ticker} ${e.side}` });
      }
      const already = await t.query("SELECT 1 FROM signals WHERE entry_signal_id = $1", [v.entrySignalId]);
      if (already.length) throw new ConflictError("이미 청산 시그널이 있는 진입입니다.");
    }

    const prev = await t.query<{ sequence_no: number; content_hash: string }>(
      "SELECT sequence_no, content_hash FROM signals WHERE agent_id = $1 ORDER BY sequence_no DESC LIMIT 1",
      [v.agentId],
    );
    const now = await t.query<{ now: string }>(`SELECT ${iso("date_trunc('milliseconds', clock_timestamp())")} AS now`);

    // 공개 기한이 이미 지났거나 진입가가 정해지기 전이면, 봉인하는 순간(또는 진입 전에) 원문이 공개된다(core/reveal.ts).
    // 봉인 기록은 고칠 수 없고 무효 처리도 원문을 공개하므로 여기서 거부한다. 발행 시각과 같은 DB 시계로 판정하고, 트랜잭션이라 아무것도 남지 않는다.
    if (v.action === "ENTRY") {
      const p = entryRevealProblem(now[0].now, input.validUntil, input.maxHoldingDays);
      if (p) {
        const deadline = kstDateTime(p.deadline.toISOString());
        const why =
          p.reason === "passed"
            ? `공개 기한(${deadline})이 이미 지났습니다. 이대로 봉인하면 원문이 바로 공개됩니다`
            : `공개 기한(${deadline})이 진입가가 정해지는 시각(${p.entryAt ? kstDateTime(p.entryAt.toISOString()) : "-"})보다 이릅니다. 이대로 봉인하면 원문이 진입 전에 공개됩니다`;
        throw new InputError(`${why}. 유효기한이나 최대 보유 거래일(발행일이 1일째, 장 마감 뒤 발행도 그날부터 셈)을 고치세요.`, {
          [p.field]: p.reason === "passed" ? "공개 기한이 이미 지남" : "공개 기한이 진입보다 먼저",
        });
      }
    }

    const fields: SignalFieldsV2 = {
      ...input,
      signalId,
      sequenceNo: (prev[0]?.sequence_no ?? 0) + 1,
      nonce: randomHex(16),
      publishedAt: now[0].now,
      prevHash: prev[0]?.content_hash ?? GENESIS_HASH,
    };
    const contentHash = await contentHashV2(fields);
    const signature = await signMessage(key.privateKey, contentHash);

    await t.query(
      `INSERT INTO signals (id, agent_id, sequence_no, canonical_version, market, ticker, side, action, target_price, stop_loss_price,
                            suggested_weight, max_holding_days, valid_until, is_paper, entry_signal_id, rule_version, nonce,
                            rationale, published_at, prev_hash, content_hash, signature, key_id)
       VALUES ($1, $2, $3, 2, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11, $12::timestamptz, $13, $14, $15, $16,
               $17, $18::timestamptz, $19, $20, $21, $22)`,
      [
        fields.signalId, fields.agentId, fields.sequenceNo, fields.market, fields.ticker, fields.side, fields.action, fields.targetPrice,
        fields.stopLossPrice, fields.suggestedWeight, fields.maxHoldingDays, fields.validUntil, fields.isPaper, fields.entrySignalId,
        fields.ruleVersion, fields.nonce, fields.rationale, fields.publishedAt, fields.prevHash, contentHash, signature, key.keyId,
      ],
    );

    // 저장 후 재대조: DB가 돌려준 값으로 지문을 다시 만들어 같아야만 커밋한다
    const stored = await t.query<SignalRow>(`${SIGNAL_SELECT} WHERE s.id = $1`, [fields.signalId]);
    const recomputed = await contentHashV2(rowToFields(stored[0]));
    if (recomputed !== contentHash) throw new Error(`저장 후 재대조 실패: ${recomputed} != ${contentHash} (롤백)`);
    return { signal: stored[0], alreadySealed: false };
  });

  if (alreadySealed) {
    // 이미 봉인된 기록에는 타임스탬프를 새로 받지 않는다. 진입 기준 시각은 가장 이른 토큰(없으면 다음 앵커)이라,
    // 늦게 받은 토큰을 붙일 수 있으면 운영자가 시세를 본 뒤 다시 눌러 진입 시각을 고를 수 있게 된다.
    const saved = await getTimestamps(db, signal.id);
    return { signal, timestamps: saved.map((r) => ({ tsa: r.tsa, genTime: r.gen_time })), tsaErrors: [], alreadySealed: true };
  }

  // 커밋 뒤 단계는 실패해도 발행 실패로 보이면 안 된다(운영자가 다시 누르면 같은 내용이 순번+1로 한 번 더 봉인된다).
  const { tokens, errors } = await obtainTimestamps(signal.content_hash);
  const saved: ObtainedToken[] = [];
  for (const tk of tokens) {
    try {
      await db.query(
        "INSERT INTO signal_timestamps (signal_id, tsa, token, gen_time) VALUES ($1, $2, decode($3, 'base64'), $4::timestamptz) ON CONFLICT (signal_id, tsa) DO NOTHING",
        [signal.id, tk.tsa, toBase64(tk.token), tk.genTime.toISOString()],
      );
      saved.push(tk);
    } catch (e) {
      errors.push(`${tk.tsa}: 타임스탬프 저장 실패(${(e as Error).message})`);
    }
  }
  return { signal, timestamps: saved.map((tk) => ({ tsa: tk.tsa, genTime: tk.genTime.toISOString() })), tsaErrors: errors, alreadySealed: false };
}

/** 청산·만료·무효 처리. 이벤트가 생기면 원문이 공개된다(되돌릴 수 없음). */
export async function recordSignalEvent(db: Db, signalId: string, event: "CLOSED" | "EXPIRED" | "VOID", note = ""): Promise<void> {
  const s = await getSignal(db, signalId);
  if (!s) throw new NotFoundError("시그널이 없습니다.");
  if (s.event) throw new ConflictError("이미 청산·만료·무효 처리된 시그널입니다.");
  if (event === "VOID") {
    // 경과 시간을 int4 밀리초로 바꾸면 2^31ms(약 24.86일)가 지난 기록에서 'integer out of range' 오류가 나 안내 대신 오류 화면이 뜬다.
    // DB 안에서 interval끼리 비교해 참/거짓만 받는다. 행이 없거나 NULL이면 거부한다(!== false).
    const age = await db.query<{ too_old: boolean }>(
      "SELECT clock_timestamp() - published_at > make_interval(secs => $2::float8 / 1000) AS too_old FROM signals WHERE id = $1",
      [s.id, VOID_WINDOW_MS],
    );
    if (age[0]?.too_old !== false) throw new ConflictError("무효 처리는 발행 후 10분 안에만 할 수 있습니다(오타 정정용). 청산·만료로 기록하세요.");
  }
  await db.query("INSERT INTO signal_events (signal_id, event, note) VALUES ($1, $2, $3)", [signalId, event, note.slice(0, 200)]);
}
