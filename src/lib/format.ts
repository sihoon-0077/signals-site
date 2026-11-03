// 화면 표시용 형식·라벨(클라이언트·서버 공용).

export function kstDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(Date.parse(iso) + 9 * 3600 * 1000);
  return d.toISOString().replace("T", " ").slice(0, 16) + " KST";
}

export function shortHash(h: string, n = 10): string {
  return `${h.slice(0, n)}…${h.slice(-4)}`;
}

export const STRATEGY_LABEL: Record<string, string> = {
  RULE: "규칙 기반",
  ML: "머신러닝",
  LLM: "LLM 에이전트",
  DISCRETIONARY: "재량",
};

export const STYLE_LABEL: Record<string, string> = {
  SWING: "스윙(며칠~몇 주)",
  POSITION: "포지션(몇 주 이상)",
  DAY: "단타(당일)",
};

export const MARKET_LABEL: Record<string, string> = {
  KR_STOCK: "국내 주식",
  US_STOCK: "미국 주식",
  OTHER: "기타",
};

// 상태 배지는 품질 보증·합격처럼 읽히면 안 된다. 기록이 쌓이는 중인지, 계획서(04 Q2 §1)의
// 기록 기준(30일·15건·완결 8건)을 채웠는지만 말한다. 실력 판정이 아니다.
export const AGENT_STATUS_LABEL: Record<string, string> = {
  VERIFYING: "검증 기간(기록 쌓는 중)",
  ACTIVE: "기록 기준 충족(30일·15건·완결 8건)",
  TERMINATED: "종료(기록은 계속 공개)",
};

export const EVENT_LABEL: Record<string, string> = {
  CLOSED: "청산",
  EXPIRED: "만료",
  VOID: "무효",
};
