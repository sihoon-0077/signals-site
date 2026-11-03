// 공급자 무료 사전등록. 결제·투자 조언이 없는 등록이며, 연락처는 비공개로만 보관한다.
import "server-only";
import { z } from "zod";
import { randomHex } from "@/core/encoding";
import type { Db } from "../db";
import { ConflictError, InputError, isUniqueViolation } from "../sql";

/** 브라우저는 줄바꿈을 1자로 세지만 폼 전송은 CRLF(2자)로 보낸다. 검증 전에 LF로 맞춰 글자 수 한도가 어긋나지 않게 한다. */
const lf = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : v);

/** 손실보전·이익보장으로 오인될 표현(자본시장법 제101조의2 ②). 공개 프로필에 실리기 전에 막는다. */
const PROFIT_PROMISE = /(원금\s*보장|수익\s*보장|확정\s*수익|손실\s*(보전|보상)|무조건|100\s*%\s*(수익|환불)|월\s*\d+\s*%|\d+\s*%\s*(이상\s*)?(수익|확정|보장))/;
const noProfitPromise = (v: string) => !PROFIT_PROMISE.test(v);
const PROMISE_MESSAGE = "수익 보장·확정 수익처럼 오인될 수 있는 표현은 쓸 수 없습니다";

/** 공식 계정으로 오인될 주소 */
const RESERVED_HANDLES = new Set(["admin", "api", "signals", "official", "support", "root", "www", "help", "verify", "anchors", "operator"]);

/**
 * 최근 1시간에 들어온 대기(PENDING) 등록이 이만큼이면 새 등록을 받지 않는다(스크립트 등록이 관리자 목록·DB를 채우는 것을 막는 마지막 방어선).
 * 정상 사전등록은 하루 수 건이라 닿지 않는다. 대기 등록만 세므로 관리자가 스팸을 일괄 거절하면 바로 다시 열린다
 * (거절한 행까지 세면 공격자가 시간당 30건으로 접수를 계속 닫아 둘 수 있었다). 멈춤 상태는 관리자 화면에 보인다.
 */
export const HOURLY_REGISTRATION_LIMIT = 30;

/** 접수를 멈췄을 때의 공개 안내. 공격이 이어지면 더 길어질 수 있어 '언제 열린다'는 약속 대신 다시 시도할 때만 권한다. */
export const REGISTRATION_PAUSED_MESSAGE = "등록 요청이 몰려 잠시 접수를 멈췄습니다. 잠시 뒤(길게는 1시간쯤) 다시 시도해 주세요.";

const PENDING_LAST_HOUR = "SELECT count(*)::int AS n FROM providers WHERE status = 'PENDING' AND created_at > now() - interval '1 hour'";
const registrationPaused = async (q: Db) => Number((await q.query<{ n: number }>(PENDING_LAST_HOUR))[0].n) >= HOURLY_REGISTRATION_LIMIT;

export const RegistrationInput = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,29}$/, "영문 소문자·숫자·하이픈 3~30자(첫 글자는 영문·숫자)")
    .refine((v) => !RESERVED_HANDLES.has(v), "쓸 수 없는 주소입니다"),
  penName: z.string().trim().min(1, "필명을 입력하세요").max(30, "30자 이하").refine(noProfitPromise, PROMISE_MESSAGE),
  // 길이를 형식 검사보다 먼저 본다: 수만 자 이메일이 관리자 화면·DB를 부풀리지 못하게(DB에도 같은 CHECK, 0004).
  email: z.string("이메일 형식이 아닙니다").trim().toLowerCase().max(254, "254자 이하").pipe(z.email("이메일 형식이 아닙니다")),
  strategyType: z.enum(["RULE", "ML", "LLM", "DISCRETIONARY"]),
  market: z.enum(["KR_STOCK", "US_STOCK", "OTHER"]).default("KR_STOCK"),
  holdingStyle: z.enum(["SWING", "POSITION", "DAY"]),
  description: z.preprocess(lf, z.string().trim().max(500, "500자 이하").refine(noProfitPromise, PROMISE_MESSAGE).default("")),
  // http(s)와 일반 도메인만: javascript:·data:·프로토콜 핸들러 같은 링크가 공식 프로필에 실리지 않게 한다.
  channels: z
    .array(z.url({ protocol: /^https?$/, hostname: z.regexes.domain, error: "http(s)로 시작하는 주소만 넣을 수 있습니다" }).max(200, "주소는 200자 이하"))
    .max(3, "최대 3개")
    .default([]),
  /** 만 19세 이상만(계획 09 §2·10 §2-1 P-S4). 1R은 본인인증 없이 스스로 확인받는다. 만 14세 미만 개인정보를 받지 않기 위한 최소 조치. */
  ageConfirmed: z.literal(true, { error: "만 19세 이상만 사전등록할 수 있습니다" }),
  consentPrivacy: z.literal(true, { error: "개인정보 수집·이용에 동의해야 등록할 수 있습니다" }),
  consentMarketing: z.boolean().default(false),
  consentInterview: z.boolean().default(false),
  referralCode: z.string().trim().toLowerCase().max(16).optional(),
  /** 스팸 방지용 숨김 필드. 사람이 채우지 않는 칸이라 값이 있으면 거부한다. */
  website: z.string().max(0).optional(),
});
export type RegistrationInput = z.input<typeof RegistrationInput>;

/**
 * 이미 등록된 이메일. 화면에는 새 등록과 똑같은 응답(같은 주소·같은 화면)을 줘서, 한 번의 제출로는 '이 사람이 등록했는가'가 드러나지 않게 한다.
 * 한계: 같은 handle로 다시 제출하거나(handle 중복 안내) 속도 제한 직전에 연달아 제출하면(새 등록만 건수가 늘어남) 추론할 수 있고, 그때는 관리자 목록에 흔적이 남는다.
 * 완전히 막으려면 이메일 확인 링크 방식이 필요하다(발송 도메인 필요, 1R 범위 밖).
 */
export class DuplicateEmailError extends ConflictError {}

/** 최근 1시간 대기 등록이 상한에 닿아 접수를 잠시 멈춤. 이메일과 상관없이 같은 응답이라 등록 여부를 드러내지 않는다. */
export class TooManyRegistrationsError extends ConflictError {
  constructor(message = REGISTRATION_PAUSED_MESSAGE) {
    super(message);
  }
}

export interface RegistrationResult {
  handle: string;
  referralCode: string;
}

export function fieldErrors(e: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}

const handleTaken = () => new ConflictError("이미 사용 중인 주소(handle)입니다. 다른 주소를 골라 주세요.");

export async function registerProvider(db: Db, raw: unknown): Promise<RegistrationResult> {
  const parsed = RegistrationInput.safeParse(raw);
  if (!parsed.success) throw new InputError("입력값을 확인해 주세요.", fieldErrors(parsed.error));
  const v = parsed.data;
  // 잠금 없는 사전 확인: 상한에 닿은 뒤 몰려드는 요청은 아래 잠금을 기다리며 DB 연결을 잡아 두지 않고 바로 돌려보낸다
  if (await registrationPaused(db)) throw new TooManyRegistrationsError();
  return db.tx(async (q) => {
    // 등록은 하나씩 처리한다. 건수 확인과 INSERT 사이에 다른 요청이 끼면 상한을 넘는다(동시 80건이 80행으로 들어갔다).
    // 트랜잭션 수준 잠금이라 COMMIT·ROLLBACK 때 저절로 풀리고 Supabase 트랜잭션 풀러에서도 동작한다(세션 수준 잠금은 풀러에서 쓸 수 없음).
    // 격리 수준은 기본(READ COMMITTED)이어야 한다: 잠금을 얻은 뒤의 건수 확인이 앞서 커밋된 등록을 본다.
    // 잠금을 쥔 연결이 멈추면 뒤 요청이 함수 제한 시간까지 기다리지 않게 5초에서 끊는다(일시적인 오류 안내로 끝남).
    await q.query("SET LOCAL lock_timeout = '5s'");
    await q.query("SELECT pg_advisory_xact_lock(hashtext('signals:registration'))");
    if (await registrationPaused(q)) throw new TooManyRegistrationsError();
    // handle은 이메일보다 먼저 따로 확인한다. 아래 INSERT가 이메일 중복을 오류 없이 넘기므로, 이 순서가 없으면
    // '이미 있는 handle + 남의 이메일' 제출이 이메일 등록 여부에 따라 다른 응답을 내게 된다.
    if ((await q.query("SELECT 1 FROM providers WHERE handle = $1", [v.handle])).length > 0) throw handleTaken();
    let referredBy: string | null = null;
    if (v.referralCode) {
      // 공개 프로필이 열린(승인된) 공급자의 링크만 초대로 기록한다(탈퇴·거절된 행을 가리키는 관계를 새로 만들지 않게).
      const r = await q.query<{ id: string }>("SELECT id FROM providers WHERE referral_code = $1 AND status = 'APPROVED'", [v.referralCode]);
      referredBy = r[0]?.id ?? null;
    }
    const referralCode = randomHex(4);
    let inserted: { id: string }[];
    try {
      // 이메일 중복은 오류로 받지 않는다(ON CONFLICT): 오류로 받으면 DB 오류 기록(DETAIL)에 이메일 주소가 남는다.
      inserted = await q.query<{ id: string }>(
        `INSERT INTO providers (handle, pen_name, email, strategy_type, market, holding_style, description, channels,
                                referral_code, referred_by, consent_privacy_at, consent_marketing_at, consent_interview_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb, $9, $10, now(), CASE WHEN $11 THEN now() ELSE NULL END, CASE WHEN $12 THEN now() ELSE NULL END)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [v.handle, v.penName, v.email, v.strategyType, v.market, v.holdingStyle, v.description, JSON.stringify([...new Set(v.channels)]), referralCode, referredBy, v.consentMarketing, v.consentInterview],
      );
    } catch (e) {
      // 등록 경로 밖(직접 넣은 행 등)에서 같은 handle이 먼저 들어온 경우. 트랜잭션은 되돌려진다.
      if (isUniqueViolation(e)) throw handleTaken();
      throw e;
    }
    if (inserted.length === 0) throw new DuplicateEmailError("이미 등록된 이메일입니다.");
    return { handle: v.handle, referralCode };
  });
}
