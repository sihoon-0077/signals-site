// 드라이버(PGlite·pg)마다 NUMERIC·TIMESTAMPTZ·BYTEA를 다른 타입으로 돌려주므로,
// SQL에서 문자열로 바꿔 읽어 어느 DB에서도 같은 값을 얻는다. 지문 재계산은 이 문자열을 그대로 쓴다.

/** TIMESTAMPTZ → ISO 8601 UTC 밀리초 문자열 */
export const iso = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class InputError extends Error {
  constructor(
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

/** PostgreSQL 고유 제약 위반(23505)인가 */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "23505" || /duplicate key value/.test(err?.message ?? "");
}

/**
 * pg(node-postgres)가 code 없이 던지는 연결 오류의 고정 문장 → 공개 코드. 문장 전체가 같을 때만 분류한다(완전 일치):
 * 호스트·사용자명이 섞인 메시지는 걸리지 않고, 메시지 원문은 어떤 경우에도 내보내지 않는다.
 * 출처: pg-pool(풀이 연결 대기 시간 초과·연결 시간 초과), pg/lib/client.js(연결 시간 초과·끊김). pg를 올려 문장이 바뀌면
 * 다시 UNKNOWN이 되므로 실제 pg 풀로 이 오류를 만드는 테스트(__tests__/pg-errors.test.ts)가 지킨다.
 */
const PG_CONNECTION_ERRORS: [RegExp, string][] = [
  [/^(Connection terminated due to connection timeout|timeout expired)$/, "DB_CONNECT_TIMEOUT"], // 10초 안에 연결되지 않음(풀러 응답 없음)
  [/^timeout exceeded when trying to connect$/, "DB_POOL_TIMEOUT"], // 풀의 연결이 모두 10초 넘게 쓰이는 중
  [/^(Connection terminated unexpectedly|Client has encountered a connection error and is not queryable)$/, "DB_CONNECTION_LOST"], // 연결 끊김
];

/**
 * 공개 응답에 내보내도 되는 오류 요약(코드 + 정해 둔 문장).
 * 앵커 호출구의 500 응답 본문은 공개 앵커 저장소의 Actions 기록(누구나 봄)에 찍힌다. 오류 메시지에는 DB 호스트·사용자명
 * (postgres.<프로젝트 ID>) 같은 값이 들어갈 수 있어 내보내지 않는다. 대신 코드만으로 원인을 좁힐 수 있게 한다
 * (예: 28P01 DB 비밀번호, 42P01 마이그레이션 안 됨, CONFIG_MISSING 환경변수 누락, ECONNREFUSED 연결 실패,
 * DB_CONNECT_TIMEOUT·DB_POOL_TIMEOUT·DB_CONNECTION_LOST DB 연결 시간 초과·끊김).
 */
export function publicError(e: unknown): { code: string; message: string } {
  const { code, name, message } = (typeof e === "object" && e !== null ? e : {}) as { code?: unknown; name?: unknown; message?: unknown };
  const c =
    typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)
      ? code
      : typeof name === "string" && name !== "Error" && /^[A-Za-z]{2,40}$/.test(name)
        ? name
        : (typeof message === "string" && PG_CONNECTION_ERRORS.find(([re]) => re.test(message))?.[1]) || "UNKNOWN";
  // 공개 저장소 스크립트는 error·message만 찍으므로 코드를 문장 안에도 넣는다
  return { code: c, message: `${publicErrorKind(c)}(코드 ${c})` };
}

function publicErrorKind(code: string): string {
  if (code === "CONFIG_MISSING" || code === "CONFIG_INVALID") return "서버 환경변수 설정 문제로 처리하지 못했습니다. 운영자가 배포 설정을 확인해야 합니다";
  if (code === "PREVIEW_BLOCKED") return "미리보기 배포라 운영 DB·서명 키를 쓰지 않습니다";
  if (/CERT|TLS|SSL|SIGNED|VERIFY/.test(code)) return "DB 연결 인증서 확인에 실패해 처리하지 못했습니다";
  // SQLSTATE: 숫자가 섞인 5자리(28P01, 42P01, XX000)
  if (/^[0-9A-Z]{5}$/.test(code) && /\d/.test(code)) return "DB가 오류를 돌려주어 처리하지 못했습니다";
  if (/^E[A-Z]+$/.test(code) || code.includes("TIMEOUT") || code === "DB_CONNECTION_LOST") return "DB 등 외부 연결에 실패해 처리하지 못했습니다";
  return "예상하지 못한 오류로 처리하지 못했습니다. 자세한 원인은 사이트 로그에 있습니다";
}
