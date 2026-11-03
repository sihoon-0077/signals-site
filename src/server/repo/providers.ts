import "server-only";
import type { Db } from "../db";
import { iso } from "../sql";

export interface PublicProvider {
  id: string;
  handle: string;
  pen_name: string;
  strategy_type: "RULE" | "ML" | "LLM" | "DISCRETIONARY";
  market: string;
  holding_style: "SWING" | "POSITION" | "DAY";
  description: string;
  channels: string[];
  referral_code: string;
  approved_at: string | null;
  referred_signups: number;
  referral_visits: number;
}

export interface AdminProvider extends PublicProvider {
  email: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  /** 탈퇴 처리(익명화)한 행. 승인·거절로 되살리지 않는다. */
  withdrawn: boolean;
  consent_marketing_at: string | null;
  consent_interview_at: string | null;
  created_at: string;
  referred_by_handle: string | null;
}

const PUBLIC_COLS = `
  p.id, p.handle, p.pen_name, p.strategy_type, p.market, p.holding_style, p.description, p.channels, p.referral_code,
  ${iso("p.approved_at")} AS approved_at,
  (SELECT count(*)::int FROM providers r WHERE r.referred_by = p.id AND r.status = 'APPROVED') AS referred_signups,
  (SELECT COALESCE(sum(v.visits), 0)::int FROM referral_daily v WHERE v.code = p.referral_code) AS referral_visits`;

/** 탈퇴 처리한 행은 이메일을 'withdrawn+<id>@invalid'로 바꿔 둔다. 실제 이메일은 형식 검사(최상위 도메인 필요) 때문에 '@invalid'로 끝날 수 없다. */
const WITHDRAWN = "p.email LIKE '%@invalid'";
const NOT_WITHDRAWN = "p.email NOT LIKE '%@invalid'";

/** 공개 프로필: 승인된 공급자만, 이메일 등 비공개 정보는 제외. */
export async function getApprovedProviderByHandle(db: Db, handle: string): Promise<PublicProvider | null> {
  const rows = await db.query<PublicProvider>(`SELECT ${PUBLIC_COLS} FROM providers p WHERE p.handle = $1 AND p.status = 'APPROVED'`, [handle.toLowerCase()]);
  return rows[0] ?? null;
}

export async function listApprovedProviders(db: Db): Promise<PublicProvider[]> {
  return db.query<PublicProvider>(`SELECT ${PUBLIC_COLS} FROM providers p WHERE p.status = 'APPROVED' ORDER BY p.approved_at`);
}

/** 관리자 목록의 구분. 탈퇴 처리한 행(상태는 REJECTED)은 거절과 따로 모은다. */
export type AdminProviderView = "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";

const VIEW_WHERE: Record<AdminProviderView, string> = {
  PENDING: `p.status = 'PENDING' AND ${NOT_WITHDRAWN}`,
  APPROVED: `p.status = 'APPROVED' AND ${NOT_WITHDRAWN}`,
  REJECTED: `p.status = 'REJECTED' AND ${NOT_WITHDRAWN}`,
  WITHDRAWN,
};

export const ADMIN_PAGE_SIZE = 100;

/**
 * 관리자 목록: 구분별 최신 등록순 100건씩(page는 0부터). 예전처럼 전체에서 300건만 자르면 스크립트 등록이 쌓였을 때
 * 정상 대기 등록과 승인된 공급자까지 목록에서 밀려났다.
 */
export async function listProvidersForAdmin(db: Db, view: AdminProviderView, page = 0): Promise<AdminProvider[]> {
  const where = VIEW_WHERE[view];
  if (!where) throw new Error(`알 수 없는 목록 구분: ${String(view)}`);
  const offset = (Number.isSafeInteger(page) && page > 0 ? page : 0) * ADMIN_PAGE_SIZE;
  return db.query<AdminProvider>(
    `SELECT ${PUBLIC_COLS}, p.email, p.status, ${WITHDRAWN} AS withdrawn,
            ${iso("p.consent_marketing_at")} AS consent_marketing_at, ${iso("p.consent_interview_at")} AS consent_interview_at,
            ${iso("p.created_at")} AS created_at, rb.handle AS referred_by_handle
       FROM providers p LEFT JOIN providers rb ON rb.id = p.referred_by
      WHERE ${where}
      ORDER BY p.created_at DESC, p.id
      LIMIT ${ADMIN_PAGE_SIZE} OFFSET $1`,
    [offset],
  );
}

export interface ProviderCounts extends Record<AdminProviderView, number> {
  /** 최근 1시간에 들어온 대기(PENDING) 등록. 등록 속도 제한과 같은 기준이라, 거절(일괄 거절 포함)하면 바로 줄어든다. */
  lastHour: number;
}

/** 관리자 화면 머리말의 구분별 인원. 목록을 자른 길이가 아니라 전체를 센다. */
export async function countProvidersForAdmin(db: Db): Promise<ProviderCounts> {
  const [r] = await db.query<{ pending: number; approved: number; rejected: number; withdrawn: number; last_hour: number }>(
    `SELECT count(*) FILTER (WHERE ${VIEW_WHERE.PENDING})::int AS pending,
            count(*) FILTER (WHERE ${VIEW_WHERE.APPROVED})::int AS approved,
            count(*) FILTER (WHERE ${VIEW_WHERE.REJECTED})::int AS rejected,
            count(*) FILTER (WHERE ${WITHDRAWN})::int AS withdrawn,
            count(*) FILTER (WHERE p.status = 'PENDING' AND p.created_at > now() - interval '1 hour')::int AS last_hour
       FROM providers p`,
  );
  return {
    PENDING: Number(r.pending),
    APPROVED: Number(r.approved),
    REJECTED: Number(r.rejected),
    WITHDRAWN: Number(r.withdrawn),
    lastHour: Number(r.last_hour),
  };
}

/**
 * 승인·거절. 탈퇴 처리한 행은 바꾸지 않는다(승인하면 남겨 둔 handle로 공개 프로필이 다시 열리므로). 바꿨으면 true.
 * 거절해도 approved_at은 지우지 않는다: 탈퇴 처리 전 행에서 approved_at이 NULL이면 '공개 프로필이 열린 적 없음'이라는 뜻이고,
 * 1년 파기 대상인지(purgeStaleRegistrations)와 탈퇴 때 행을 통째로 지울지(withdrawStatement)를 정하는 기준이다.
 * 공개 화면은 모두 status = 'APPROVED'로 거르므로 노출은 같다.
 */
export async function setProviderStatus(db: Db, id: string, status: "APPROVED" | "REJECTED"): Promise<boolean> {
  const rows = await db.query(
    `UPDATE providers SET status = $2, approved_at = CASE WHEN $2 = 'APPROVED' THEN now() ELSE approved_at END
      WHERE id = $1 AND email NOT LIKE '%@invalid'
      RETURNING id`,
    [id, status],
  );
  return rows.length > 0;
}

/**
 * 스팸 일괄 거절: since(ISO 시각) 이후에 들어온 대기 등록을 모두 거절한다. 승인·탈퇴 처리한 행은 건드리지 않는다. 거절한 건수를 돌려준다.
 * 대기 행은 승인된 적이 없어 approved_at이 원래 NULL이다(따로 지우지 않는다). 거절하면 등록 속도 제한의 대기 건수에서 바로 빠진다.
 */
export async function rejectPendingSince(db: Db, since: string): Promise<number> {
  const rows = await db.query(
    `UPDATE providers SET status = 'REJECTED'
      WHERE status = 'PENDING' AND created_at >= $1::timestamptz AND email NOT LIKE '%@invalid'
      RETURNING id`,
    [since],
  );
  return rows.length;
}

/** 한 코드의 하루(KST) 방문 합계 상한(경로 종류 합산). 스크립트로 공개 수치를 부풀리는 폭을 줄이고, 상한에 닿으면 행을 더 쓰지 않는다. */
const DAILY_VISIT_CAP = 200;

export async function recordReferralVisit(db: Db, code: string, path: string): Promise<void> {
  if (!/^[a-z0-9]{6,16}$/.test(code)) return;
  const kind = path.startsWith("/p/") ? "profile" : path.startsWith("/providers/join") ? "join" : "other";
  // 승인된 공급자의 코드만 센다(거절·대기·탈퇴 행의 코드로는 공개 수치가 생기지 않게).
  // 날짜는 DB 세션 시간대(TimeZone)와 상관없이 KST로 정한다: (now() + 9시간)::date는 세션이 UTC일 때만 KST 날짜가 된다.
  // 상한 확인과 증가 사이에 요청이 동시에 몰리면 몇 건 넘을 수 있지만, 참고용 수치라 잠그지 않는다.
  await db.query(
    `INSERT INTO referral_daily (code, day, path_kind, visits)
     SELECT $1, d.day, $2, 1
       FROM (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS day) d
      WHERE EXISTS (SELECT 1 FROM providers WHERE referral_code = $1 AND status = 'APPROVED')
        AND (SELECT COALESCE(sum(v.visits), 0) FROM referral_daily v WHERE v.code = $1 AND v.day = d.day) < ${DAILY_VISIT_CAP}
     ON CONFLICT (code, day, path_kind) DO UPDATE SET visits = referral_daily.visits + 1`,
    [code, kind],
  );
}

/**
 * 탈퇴 처리(익명화)에서 바꾸는 값. 공개 프로필이 열린 적 있거나 에이전트가 있는 행은 지우지 않는다:
 * 에이전트(봉인 기록)가 이 행을 외래키로 가리키고, 봉인 기록은 계속 공개한다.
 * - handle은 남긴다: 지우거나 바꾸면 다른 사람이 같은 주소로 다시 등록해 사칭할 수 있다. 공개 프로필은 승인 상태에서만 열리므로 어디에도 보이지 않는다.
 * - 초대 코드는 새 무작위 값으로 바꾼다: 이미 퍼진 ?ref= 링크가 이 행과 다시 이어지지 않게.
 * - 시그널 방식·시장·매매 보유 기간과 등록·동의 일시는 탈퇴 처리 기록으로 남는다(서비스를 운영하는 동안 보관, 처리방침 2항).
 */
const WITHDRAW_SET = `email = 'withdrawn+' || p.id || '@invalid', pen_name = '탈퇴한 공급자', description = '', channels = '[]'::jsonb,
         referred_by = NULL, referral_code = 'w' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15),
         consent_marketing_at = NULL, consent_interview_at = NULL, status = 'REJECTED', approved_at = NULL`;

/**
 * 탈퇴 처리·1년 파기를 한 문장으로 한다(한 문장이라 일부만 반영되는 일이 없고, 트랜잭션 풀러에서도 그대로 원자적이다).
 * - t: 대상 행. 승인된 적 없고(approved_at NULL, 거절해도 지우지 않음) 에이전트도 없는 행은 erase(공개 프로필이 열린 적 없어 사칭 방지로 남길 이유가 없다)
 * - erased: 그 행을 통째로 지운다(같은 주소로 다시 등록할 수 있다). 같은 순간 승인된 행은 지우지 않도록 approved_at을 다시 본다
 * - w: 나머지는 WITHDRAW_SET으로 익명화한다
 * - renamed: 익명화한 공급자의 에이전트 이름·설명(필명이 들어 있을 수 있다). 앵커 리프·봉인 원문에는 들어가지 않아 검증 결과는 그대로다
 * - unlinked·visits: 대상 행이 초대한 다른 공급자와의 관계, 옛 초대 코드의 방문 집계
 * WITH 안의 문장은 모두 문장 시작 시점의 표를 보므로, providers를 다시 읽으면 바꾸기 전 초대 코드가 나온다.
 * 외래키(referred_by)는 문장이 끝날 때 확인하므로, 같은 문장에서 관계를 끊고 행을 지워도 된다. 한 행을 두 하위 문장이 함께 바꾸지 않게
 * unlinked는 대상 행을 빼고 고친다(대상 행의 관계는 erased·w가 정리한다).
 */
const withdrawStatement = (where: string) => `
  WITH t AS (
    SELECT p.id, (p.approved_at IS NULL AND NOT EXISTS (SELECT 1 FROM agents a WHERE a.provider_id = p.id)) AS erase
      FROM providers p
     WHERE ${where} AND ${NOT_WITHDRAWN}),
  erased AS (
    DELETE FROM providers p USING t WHERE p.id = t.id AND t.erase AND p.approved_at IS NULL RETURNING p.id),
  w AS (
    UPDATE providers p SET ${WITHDRAW_SET} FROM t WHERE p.id = t.id AND NOT t.erase RETURNING p.id),
  renamed AS (
    UPDATE agents SET name = '탈퇴한 공급자의 에이전트 ' || substr(replace(id::text, '-', ''), 1, 4), description = ''
     WHERE provider_id IN (SELECT id FROM w)),
  unlinked AS (
    UPDATE providers SET referred_by = NULL
     WHERE referred_by IN (SELECT id FROM t) AND id NOT IN (SELECT id FROM t)),
  visits AS (
    DELETE FROM referral_daily WHERE code IN (SELECT referral_code FROM providers WHERE id IN (SELECT id FROM t)))
  SELECT ((SELECT count(*) FROM erased) + (SELECT count(*) FROM w))::int AS n`;

/**
 * 동의 문구·처리방침 2항의 약속: 한 번도 승인되지 않은 사전등록(approved_at NULL)은 등록일부터 1년 뒤 탈퇴와 같은 방식으로 처리한다
 * (에이전트는 승인된 공급자에게만 만들 수 있어 실제로는 행을 지운다). 승인된 적 있는 등록은 운영자가 거절(프로필 닫기)해도
 * 여기서 건드리지 않는다: 본인이 탈퇴하지 않았는데 이름이 '탈퇴한 공급자'로 바뀌어 되돌릴 수 없게 되므로, 탈퇴를 요청할 때까지 남는다.
 * 처리한 건수를 돌려준다(다시 실행하면 0).
 */
export async function purgeStaleRegistrations(db: Db): Promise<number> {
  const [r] = await db.query<{ n: number }>(
    withdrawStatement("p.approved_at IS NULL AND p.status <> 'APPROVED' AND p.created_at < now() - interval '1 year'"),
  );
  return Number(r.n);
}

/**
 * 탈퇴 처리. 되돌릴 수 없다. 처리했으면 true(이미 처리했거나 지운 행이면 false).
 * - 공개 프로필이 열린 적 없고 에이전트도 없는 등록(대기·스팸·'본인 아님'·만 19세 미만): 행을 지운다
 * - 그 밖: 연락처·소개·채널·초대 관계·선택 동의를 지우고 필명·에이전트 이름을 바꾸며 공개 프로필을 닫는다(주소는 사용 중지로 남김)
 */
export async function anonymizeProvider(db: Db, id: string): Promise<boolean> {
  const [r] = await db.query<{ n: number }>(withdrawStatement("p.id = $1"), [id]);
  return Number(r.n) > 0;
}

const OPTIONAL_CONSENT = { interview: "consent_interview_at", marketing: "consent_marketing_at" } as const;
export type OptionalConsent = keyof typeof OPTIONAL_CONSENT;

/**
 * 선택 동의만 철회(처리방침 4항): 인터뷰 연락 동의 또는 소식(광고성) 메일 수신 동의를 지운다. 나머지 등록 정보는 그대로다.
 * 열 이름은 고정 표에서만 고른다(입력값이 SQL에 들어가지 않음). 탈퇴 처리한 행이나 이미 없는 동의는 바꾸지 않는다. 바꿨으면 true.
 */
export async function clearOptionalConsent(db: Db, id: string, kind: OptionalConsent): Promise<boolean> {
  if (!Object.hasOwn(OPTIONAL_CONSENT, kind)) throw new Error(`알 수 없는 선택 동의: ${String(kind)}`);
  const col = OPTIONAL_CONSENT[kind];
  const rows = await db.query(`UPDATE providers SET ${col} = NULL WHERE id = $1 AND ${col} IS NOT NULL AND email NOT LIKE '%@invalid' RETURNING id`, [id]);
  return rows.length > 0;
}
