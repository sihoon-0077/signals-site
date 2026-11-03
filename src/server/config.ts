// 환경변수를 한곳에서 읽는다. 값의 의미와 예시는 .env.example 참고.
import "server-only";

export const TSA_DEFAULT = "freetsa=https://freetsa.org/tsr,digicert=http://timestamp.digicert.com";

export interface TsaEndpoint {
  name: string;
  url: string;
}

/** TSA_URLS="이름=URL,이름=URL". "off"면 타임스탬프를 받지 않는다(테스트·오프라인 개발용). */
export function tsaEndpoints(): TsaEndpoint[] {
  const raw = process.env.TSA_URLS ?? TSA_DEFAULT;
  if (raw.trim() === "" || raw.trim() === "off") return [];
  const eps = raw.split(",").map((pair) => {
    const [name, ...rest] = pair.split("=");
    return { name: name.trim(), url: rest.join("=").trim() };
  });
  // 이름은 저장 키(signal_id, tsa)라 겹치면 두 번째 토큰 저장이 실패한다
  const names = eps.map((e) => e.name);
  if (new Set(names).size !== names.length) throw new Error(`TSA_URLS에 같은 이름이 두 번 있습니다: ${names.join(", ")}`);
  return eps;
}

/**
 * 설정(환경변수) 문제. 앵커 호출구는 공개 기록(앵커 저장소 Actions 로그)에 메시지 대신 이 code만 내보낸다(sql.ts publicError).
 * 메시지에는 운영자가 고칠 곳을 적되 비밀값은 넣지 않는다.
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly code: "CONFIG_MISSING" | "CONFIG_INVALID" | "PREVIEW_BLOCKED" = "CONFIG_MISSING",
  ) {
    super(message);
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * 공개 주소(공유·초대 링크, og:image, 검증 안내). SITE_URL > Vercel 운영 주소(VERCEL_PROJECT_PRODUCTION_URL) > http://localhost:3000.
 * 예전에는 SITE_URL이 없으면 배포에서도 조용히 localhost가 되어, 공급자가 localhost 링크를 그대로 게시할 수 있었다.
 * 값이 잘못되면 멈춘다(layout의 metadataBase에서 부르면 빌드 단계에서 드러난다).
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = explicit || (vercelProd ? `https://${vercelProd}` : "http://localhost:3000");
  let u: URL | null = null;
  try {
    u = new URL(raw);
  } catch {
    u = null;
  }
  if (!u || (u.protocol !== "https:" && u.protocol !== "http:") || u.pathname !== "/" || u.search || u.hash || u.username || u.password) {
    throw new ConfigError("SITE_URL은 http(s)://로 시작하는 사이트 주소만 넣어야 합니다(경로 없이, 예: https://프로젝트.vercel.app). .env.example 참고.", "CONFIG_INVALID");
  }
  // Vercel 배포에 .env.example의 localhost 예시값을 그대로 넣은 경우: 링크·카드 이미지가 전부 쓸 수 없게 된다
  if (process.env.VERCEL === "1" && (u.protocol !== "https:" || LOCAL_HOSTS.has(u.hostname))) {
    throw new ConfigError(`Vercel 배포의 SITE_URL이 공개 https 주소가 아닙니다(${u.origin}). 실제 주소를 넣거나, 비워 두면 Vercel 운영 주소를 씁니다.`, "CONFIG_INVALID");
  }
  return u.origin;
}

export const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Vercel 미리보기·개발 배포인가(브랜치 push·PR마다 자동으로 생기고 NODE_ENV는 production이다).
 * 여기서 운영 DB·서명 키를 쓰면 검토 안 된 코드가 지울 수 없는 기록을 봉인할 수 있어 막는다.
 * 따로 만든 시험용 DB·키를 일부러 넣었을 때만 ALLOW_PREVIEW_DB=1로 연다. Vercel 밖(로컬·스크립트)에서는 false.
 */
export function previewDeploymentBlocked(): boolean {
  return process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "production" && process.env.ALLOW_PREVIEW_DB !== "1";
}

/**
 * 공개 앵커 저장소 주소와 브랜치. 검증 화면이 공개키·앵커 사본을 사이트가 아니라 여기서 직접 받는다.
 * 브랜치 기본값 main은 src/core/verify.ts DEFAULT_MIRROR_BRANCH와 같다(이 파일이 브라우저용 검증 코드를 끌어오지 않게 값만 맞춘다).
 */
export function anchorRepo(): { url: string | null; branch: string } {
  return { url: process.env.ANCHOR_REPO_URL?.trim() || null, branch: process.env.ANCHOR_REPO_BRANCH?.trim() || "main" };
}
