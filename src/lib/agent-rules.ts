// 에이전트 상태·발행 규칙. 서버 액션 파일("use server")은 async 함수만 내보낼 수 있어 상수는 여기에 둔다.

/**
 * 1R에 새로 봉인하는 진입(ENTRY)의 시장. 발행 폼의 선택지(admin/forms.tsx)와 서버 검사(services/publish.ts PublishInput)가 같이 쓴다.
 * 공개 기한·진입 기준이 KRX 시간 기준이라 미국 시장은 미국 장 시간 모델을 넣을 때 연다.
 */
export const ENTRY_MARKETS = ["KOSPI", "KOSDAQ"] as const;

/**
 * '기록 기준 충족' 기준 중 기간·건수(03 §4.1 AGT-020/021: 첫 등록 후 30일, 봉인 기록 15건)만 본다.
 * 계획의 전이 조건은 이것 AND 품질 기준(AGT-023: 완결 8건, 최대낙폭 −40% 이내 등)이라 1R은 ACTIVE로 바꾸지 않는다(admin/actions.ts).
 * 다시 열 때는 완결 8건 확인을 반드시 같이 넣어야 배지가 실제보다 많은 것을 주장하지 않는다.
 */
export const ACTIVE_MIN_DAYS = 30;
export const ACTIVE_MIN_SIGNALS = 15;

export function meetsVerificationPeriod(a: { chain_length: number; created_at: string }, now = Date.now()): boolean {
  return a.chain_length >= ACTIVE_MIN_SIGNALS && now - Date.parse(a.created_at) >= ACTIVE_MIN_DAYS * 86_400_000;
}
