// HTTP Basic 인증 확인(미들웨어·서버 공용, 의존성 없음 — Edge 런타임에서도 돈다).
// 비밀번호가 설정되지 않았으면 항상 거부한다(설정 실수로 관리자 화면이 열리지 않도록).
// 운영에서는 짧은 비밀값도 설정 실수로 보고 닫는다: 시도 제한이 없어 짧으면 공개 주소에서 대입으로 뚫릴 수 있다.

/** 운영에서 ADMIN_PASSWORD·CRON_SECRET의 최소 길이. DEPLOY.md 3단계 명령은 43자를 만든다(next.config.ts 빌드 검사도 같은 값). */
export const MIN_SECRET_LENGTH = 16;

const isProd = () => process.env.NODE_ENV === "production";

/**
 * 길이가 달라도 일찍 끝나지 않는 비교. 길이가 다르면 비밀값을 자기 자신과 비교해 걸리는 시간을 같게 하고 결과만 false로 둔다
 * (예전 코드는 길이가 다르면 바로 false를 돌려줘 응답 시간으로 비밀값 길이가 드러날 수 있었다). 걸리는 시간은 비밀값 길이에만 달려 있다.
 * Web Crypto의 digest 비교는 비동기라, `if (!checkBasicAuth(...))`에서 await를 하나만 빠뜨려도 Promise가 참으로 읽혀 인증이 열린다. 그래서 동기로 둔다.
 */
function constantTimeEqual(input: string, secret: string): boolean {
  const sameLength = input.length === secret.length;
  const a = sameLength ? input : secret;
  let diff = sameLength ? 0 : 1;
  for (let i = 0; i < secret.length; i++) diff |= a.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

/** 관리자 화면을 열 수 없는 설정이면 그 이유(503으로 보여 줄 문구), 열 수 있으면 null. */
export function adminConfigProblem(user: string | undefined, password: string | undefined, production = isProd()): string | null {
  if (!user || !password) return "ADMIN_USER / ADMIN_PASSWORD 환경변수를 설정해야 관리자 화면을 열 수 있습니다.";
  if (production && password.length < MIN_SECRET_LENGTH) {
    return `ADMIN_PASSWORD가 너무 짧아 관리자 화면을 닫아 두었습니다(${MIN_SECRET_LENGTH}자 이상). DEPLOY.md 3단계 명령으로 다시 만들어 넣은 뒤 재배포하세요.`;
  }
  return null;
}

/** 앵커 호출구를 열 수 없는 설정이면 그 이유, 열 수 있으면 null. */
export function cronSecretProblem(secret: string | undefined, production = isProd()): string | null {
  if (!secret) return "CRON_SECRET이 설정되지 않았습니다.";
  if (production && secret.length < MIN_SECRET_LENGTH) return `CRON_SECRET이 너무 짧아 앵커 호출구를 닫아 두었습니다(${MIN_SECRET_LENGTH}자 이상).`;
  return null;
}

/** "Authorization: Bearer <비밀값>" 확인(일일 앵커 호출용). 비밀값이 없거나(운영에서) 너무 짧으면 항상 거부한다. */
export function checkBearer(header: string | null, secret: string | undefined, production = isProd()): boolean {
  if (!secret || cronSecretProblem(secret, production) || !header?.startsWith("Bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

export function checkBasicAuth(header: string | null, user: string | undefined, password: string | undefined, production = isProd()): boolean {
  // 미들웨어만이 아니라 서버 액션(requireAdmin)도 이 함수를 거치므로, 짧은 비밀번호 차단을 여기에 둬야 둘 다 닫힌다
  if (!user || !password || adminConfigProblem(user, password, production) || !header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    // 브라우저는 charset=UTF-8 요청에 따라 UTF-8 바이트를 base64로 보낸다. atob만 쓰면 바이트가 Latin-1 글자로 풀려 한글 아이디·비밀번호가 항상 틀린다.
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  // 둘 다 끝까지 계산한 뒤 합친다(아이디가 틀렸을 때 비밀번호 비교를 건너뛰면 그 시간 차로 아이디 일치 여부가 드러난다)
  const userOk = constantTimeEqual(decoded.slice(0, i), user);
  const passOk = constantTimeEqual(decoded.slice(i + 1), password);
  return userOk && passOk;
}
