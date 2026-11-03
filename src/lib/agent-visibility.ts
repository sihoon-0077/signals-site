// 에이전트를 공개 화면에 보일지 정하는 규칙 하나. 홈 목록, /a/주소 페이지, 그 페이지의 제목(generateMetadata)이 모두 이 함수를 쓴다.
// 따로 적으면 한 곳만 어긋난다: 예전에는 페이지가 404로 숨긴 에이전트의 이름이 같은 404 응답의 제목으로 나갔다.
// repo/agents.ts가 아니라 여기(순수 모듈)에 두는 이유: 테스트가 repo 모듈을 통째로 흉내 내도 규칙은 진짜로 남는다.

/**
 * 공개: 플랫폼 운영 에이전트, 승인된 공급자의 에이전트, 그리고 공급자를 거절·탈퇴 처리해도 봉인 기록이 있는 에이전트(실패 기록이 사라지지 않게).
 * 숨김: 그 밖에 기록이 하나도 없는 에이전트.
 */
export function isAgentPublic(a: { is_platform_owned: boolean; provider_status: string | null; chain_length: number }): boolean {
  return a.is_platform_owned || a.provider_status === "APPROVED" || a.chain_length > 0;
}
