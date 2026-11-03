// 원문 공개 규칙(03 설계 §7.1, 커밋-리빌). 공개 시점을 운영자의 클릭이 아니라 규칙으로 정한다.
// 운영자가 손실 난 진입(ENTRY)을 청산 처리하지 않고 두면 원문이 영원히 숨겨지는 '선별 공개'를 막기 위해서다.
//   - 운영자가 청산·만료·무효를 기록하면 공개
//   - 청산(EXIT) 시그널은 일일 앵커에 고정되면 공개, 그 짝인 진입(ENTRY)도 같이 공개
//     (EXIT를 발행하는 순간 진입을 공개하면 판매 단계에서 체결 전에 원문이 풀리므로, 외부 고정 뒤로 둔다)
//   - 진입(ENTRY)은 공개 기한이 지나면 공개: 유효기한(valid_until)과 '발행일 + 최대 보유 거래일 15:30 KST' 중 이른 시각
import { type TradingCalendar, defaultCalendar, entryPriceFixedAt, resolveEntry } from "./entry";

export interface RevealInput {
  action: "ENTRY" | "EXIT";
  publishedAt: string;
  validUntil: string | null;
  maxHoldingDays: number | null;
  /** 운영자가 기록한 청산·만료·무효 */
  event: string | null;
  /** 이 기록이 일일 앵커에 포함됨 */
  anchored: boolean;
  /** (ENTRY) 이 진입을 가리키는 EXIT가 일일 앵커에 포함됨 */
  exitAnchored: boolean;
}

const KST = 9 * 3600 * 1000;
const kstDateOf = (t: number) => new Date(t + KST).toISOString().slice(0, 10);

/** 발행일(KST)부터 n번째 거래일 장 마감(15:30 KST). 발행일이 거래일이면 그날을 1일째로 센다. */
export function holdingDeadline(publishedAt: string, days: number, calendar: TradingCalendar = defaultCalendar): Date | null {
  let t = Date.parse(publishedAt);
  let counted = 0;
  for (let guard = 0; guard < days * 3 + 30; guard++) {
    const d = kstDateOf(t);
    if (calendar(d)) {
      counted++;
      if (counted >= days) return new Date(Date.parse(`${d}T15:30:00+09:00`));
    }
    t += 24 * 3600 * 1000;
  }
  return null;
}

/** ENTRY의 공개 기한. 기한 정보가 없으면 null(발행 단계에서 둘 중 하나를 필수로 받는다). */
export function revealDeadline(r: RevealInput, calendar: TradingCalendar = defaultCalendar): Date | null {
  if (r.action !== "ENTRY") return null;
  const candidates: Date[] = [];
  if (r.validUntil) candidates.push(new Date(r.validUntil));
  if (r.maxHoldingDays) {
    const h = holdingDeadline(r.publishedAt, r.maxHoldingDays, calendar);
    if (h) candidates.push(h);
  }
  return candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
}

/**
 * 발행 뒤 TSA 토큰이 찍히기까지의 여유(기관당 제한 10초 + 재시도). 토큰이 늦을수록 진입이 늦어지므로(entry.ts) 늦은 쪽으로 본다.
 * 토큰을 하나도 못 받으면 진입 기준이 18시 앵커로 밀리는데, 그 경우는 발행 시점에 알 수 없어 여기서 막지 못한다.
 */
export const ENTRY_TOKEN_MARGIN_MS = 60_000;

export interface EntryRevealProblem {
  /** 공개 기한을 정한 칸(둘 중 이른 쪽) */
  field: "validUntil" | "maxHoldingDays";
  /** passed: 기한이 발행 시각 이전, before_entry: 기한이 진입가가 정해지는 시각보다 앞 */
  reason: "passed" | "before_entry";
  deadline: Date;
  /** 진입가가 정해지는 시각(before_entry일 때) */
  entryAt: Date | null;
}

/**
 * 이대로 봉인하면 원문이 바로(또는 진입가가 정해지기 전에) 공개되는 ENTRY인지. 문제가 없으면 null.
 * 봉인 기록은 고칠 수 없고 무효 처리도 원문을 공개하므로, 발행 단계에서 거부해야 한다(publish.ts, DB 시계의 발행 시각으로 판정).
 * 예: 수요일 16:00 발행 + 최대 보유 1거래일 → 공개 기한은 그날 15:30(이미 지남), 진입은 목요일 시가.
 * 공개 규칙(holdingDeadline, 발행일이 1일째)은 바꾸지 않는다. 기한이 진입 전에 오는 입력만 거부한다.
 * KRX 시간(entry.ts·holdingDeadline)으로만 판정하므로 발행은 국내 시장 진입만 받는다(lib/agent-rules.ts ENTRY_MARKETS).
 * 다른 시장을 열 때는 시장별 장 시간·휴장일을 이 함수와 resolveEntry·holdingDeadline에 함께 넣어야 한다.
 */
export function entryRevealProblem(
  publishedAt: string,
  validUntil: string | null,
  maxHoldingDays: number | null,
  calendar: TradingCalendar = defaultCalendar,
  marginMs = ENTRY_TOKEN_MARGIN_MS,
): EntryRevealProblem | null {
  const now = Date.parse(publishedAt);
  const v = validUntil ? Date.parse(validUntil) : Infinity;
  const h = maxHoldingDays ? (holdingDeadline(publishedAt, maxHoldingDays, calendar)?.getTime() ?? Infinity) : Infinity;
  const deadline = Math.min(v, h);
  if (!Number.isFinite(deadline)) return null; // 기한이 있는지는 발행 입력 검사(PublishInput)가 본다
  const field = v <= h ? "validUntil" : "maxHoldingDays";
  if (deadline <= now) return { field, reason: "passed", deadline: new Date(deadline), entryAt: null };
  const basis = new Date(now + marginMs);
  const entryAt = entryPriceFixedAt(resolveEntry(new Date(now), basis, null, calendar), basis);
  if (entryAt !== null && deadline < entryAt) return { field, reason: "before_entry", deadline: new Date(deadline), entryAt: new Date(entryAt) };
  return null;
}

export function revealState(r: RevealInput, now: Date, calendar: TradingCalendar = defaultCalendar): { revealed: boolean; reason: string; deadline: Date | null } {
  const deadline = revealDeadline(r, calendar);
  if (r.event) return { revealed: true, reason: "청산·만료·무효 기록", deadline };
  if (r.action === "EXIT" && r.anchored) return { revealed: true, reason: "청산 시그널이 외부에 고정됨", deadline };
  if (r.action === "ENTRY" && r.exitAnchored) return { revealed: true, reason: "청산 시그널이 외부에 고정됨", deadline };
  if (deadline && now.getTime() > deadline.getTime()) return { revealed: true, reason: "공개 기한 경과", deadline };
  return { revealed: false, reason: deadline ? "공개 기한 전" : "청산 시그널 고정 전", deadline };
}
