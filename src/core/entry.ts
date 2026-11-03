// 진입 기준가 규칙 v2 (03 설계 §7.2). 진입가는 시그널의 외부 타임스탬프 시각 "이후" 가격으로만 정한다.
// 이유: 일일 앵커(18:00)만 있으면 운영자가 장 마감 뒤에 "아침에 낸 것처럼" 시그널을 끼워 넣어
//       그날 시가로 진입시켜도 외부 기록으로 반박할 수 없다.
//
//   - 기준 시각(토큰 genTime) ≤ 거래일 08:30 KST → 그날 시가 (08:30부터 시가 단일가 주문·예상 체결가가 공개됨)
//   - 08:30 ~ 15:10 → max(기준 시각, 09:00) + 5~10분 VWAP (15:20 종가 단일가 전에 창이 끝나도록)
//   - 15:10 이후·휴장일 → 다음 거래일 시가
//   - 토큰이 없으면 다음 일일 앵커 시각을 기준 시각으로 쓴다
//   - 토큰 시각 < 서버 접수 시각 → 서버 시계 이상(CLOCK_ANOMALY), 판정 보류
// 정답 사례는 signals/docs/calc/03_arch_check.py의 entry_v2 사례 9개와 같다(__tests__/entry.test.ts).

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CUTOFF_MIN = 8 * 60 + 30;
const OPEN_MIN = 9 * 60;
const LAST_INTRADAY_MIN = 15 * 60 + 10;

/**
 * KRX 고정일 휴장일(MM-DD). 설·추석·대체공휴일·선거일은 해마다 달라 아래 목록에 넣지 않았다.
 * 성과 계산을 시작하기 전에 KRX 공식 휴장일 파일로 바꿔야 한다(현재 1R 사이트는 수익률을 계산하지 않는다).
 */
export const KRX_FIXED_HOLIDAYS = new Set(["01-01", "03-01", "05-01", "05-05", "06-06", "08-15", "10-03", "10-09", "12-25", "12-31"]);

export type TradingCalendar = (kstDate: string) => boolean;

export const defaultCalendar: TradingCalendar = (kstDate) => {
  const d = new Date(`${kstDate}T00:00:00Z`);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !KRX_FIXED_HOLIDAYS.has(kstDate.slice(5));
};

export type EntryResult =
  | { kind: "OPEN"; date: string }
  | { kind: "VWAP"; date: string; window: string }
  | { kind: "PENDING_ANCHOR" }
  | { kind: "CLOCK_ANOMALY" }
  | { kind: "OUT_OF_CALENDAR" };

function kstParts(t: Date): { date: string; minutes: number } {
  const k = new Date(t.getTime() + KST_OFFSET_MS);
  return { date: k.toISOString().slice(0, 10), minutes: k.getUTCHours() * 60 + k.getUTCMinutes() + k.getUTCSeconds() / 60 + k.getUTCMilliseconds() / 60000 };
}

function addDays(kstDate: string, n: number): string {
  const d = new Date(`${kstDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hhmm(totalMinutes: number): string {
  const m = Math.floor(totalMinutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * 토큰 시각과 서버 접수 시각 비교의 허용 오차.
 * TSA 시각(genTime)은 보통 초 단위로 잘려 나오므로, 밀리초까지 있는 접수 시각보다 최대 1초 이르게 보일 수 있다.
 * 허용 오차가 없으면 정상 시그널이 "시계 이상"으로 잘못 판정된다.
 */
export const CLOCK_TOLERANCE_MS = 2000;

export function resolveEntry(
  receivedAt: Date,
  tsaAt: Date | null,
  nextAnchorAt: Date | null = null,
  calendar: TradingCalendar = defaultCalendar,
  toleranceMs: number = CLOCK_TOLERANCE_MS,
): EntryResult {
  let basis = tsaAt;
  if (basis === null) {
    if (nextAnchorAt === null) return { kind: "PENDING_ANCHOR" };
    basis = nextAnchorAt;
  }
  if (basis.getTime() < receivedAt.getTime() - toleranceMs) return { kind: "CLOCK_ANOMALY" };
  const { date, minutes } = kstParts(basis);
  for (let i = 0; i < 40; i++) {
    const d = addDays(date, i);
    if (!calendar(d)) continue;
    if (i === 0) {
      if (minutes <= CUTOFF_MIN) return { kind: "OPEN", date: d };
      if (minutes < LAST_INTRADAY_MIN) {
        const start = Math.max(minutes, OPEN_MIN) + 5;
        return { kind: "VWAP", date: d, window: `${hhmm(start)}~${hhmm(start + 5)}` };
      }
      continue;
    }
    return { kind: "OPEN", date: d };
  }
  return { kind: "OUT_OF_CALENDAR" };
}

/**
 * 진입가가 정해지는 시각(ms). 시가는 그날 09:00 KST, 거래량가중평균가는 창이 끝나는 시각(max(기준 시각, 09:00) + 10분,
 * resolveEntry의 '+5~10분' 창과 같은 규칙). 창 표기(HH:MM)는 초를 버리므로 여기서는 기준 시각에서 바로 계산한다.
 * 기준 시각이 없거나 판정 보류인 결과는 null. basis는 resolveEntry에 넘긴 기준 시각(토큰·앵커 시각)이다.
 */
export function entryPriceFixedAt(r: EntryResult, basis: Date): number | null {
  if (r.kind === "OPEN") return Date.parse(`${r.date}T09:00:00+09:00`);
  if (r.kind === "VWAP") return Math.max(basis.getTime(), Date.parse(`${r.date}T09:00:00+09:00`)) + 10 * 60 * 1000;
  return null;
}

export function describeEntry(r: EntryResult): string {
  switch (r.kind) {
    case "OPEN":
      return `${r.date} 시가`;
    case "VWAP":
      return `${r.date} ${r.window} 거래량가중평균가`;
    case "PENDING_ANCHOR":
      return "외부 타임스탬프 대기 중";
    case "CLOCK_ANOMALY":
      return "서버 시계 이상 — 판정 보류";
    default:
      return "거래일 계산 범위 밖";
  }
}
