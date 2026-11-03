// 날짜 문자열(YYYY-MM-DD) 검사와 KST 날짜·시각. 공개 API 경로(/api/anchors/<날짜>)와 앵커 생성이 같은 규칙을 쓴다.

/**
 * 실제 달력 날짜이면서 PostgreSQL date로 바꿀 수 있는 값(0001-01-01~9999-12-31)인지.
 * - 13월·32일·0일: Date.parse가 NaN을 준다. 이 값으로 toISOString()을 부르면 RangeError가 나서 400 대신 500이 됐다.
 * - 2월 30일: V8이 다음 달로 넘겨 받아 주므로 왕복 비교로 거른다.
 * - 0000년: JS는 받지만 PostgreSQL에는 0년이 없어 DB 조회가 22008 오류(500)로 끝난다.
 */
export function isRealDate(d: string): boolean {
  // 정규식으로 자릿수를 고정했으므로 문자열 비교가 날짜 비교와 같다
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < "0001-01-01") return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

// 한국은 일광 절약 시간이 없어 UTC+9로 고정이다. 서버 시간대(TZ)와 상관없이 같은 값을 얻으려고 UTC 기준으로 계산한다.
const KST_OFFSET_MS = 9 * 3600 * 1000;

/** KST 기준 날짜(YYYY-MM-DD). 앵커 날짜를 정할 때는 시각을 한 번만 잡아 kstHour와 같은 now를 넘긴다. */
export function kstToday(now = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** KST 기준 시(0~23). 18시(KST) 전에는 앵커를 만들지 않는 규칙에 쓴다. */
export function kstHour(now = new Date()): number {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
}
