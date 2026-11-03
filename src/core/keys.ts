// 공개키 목록(keys.json). GitHub 공개 저장소에 고정해, 나중에 키를 바꿔 과거 기록 전체를 다시 서명하는 것을 막는다.
// purpose: signal(시그널 서명) / checkpoint(일일 체크포인트 루트 서명) — 03 설계 §6.2에 따라 키를 분리한다.

export type KeyPurpose = "signal" | "checkpoint";

export interface PublicKeyEntry {
  key_id: string;
  purpose: KeyPurpose;
  algorithm: "ECDSA-P256-SHA256";
  public_key_pem: string;
  /** SHA-256(SPKI DER) */
  fingerprint: string;
  created_at: string;
  retired_at: string | null;
}

export interface KeysFile {
  version: 1;
  keys: PublicKeyEntry[];
}

/**
 * 운영 키 ID 규칙(scripts/keygen.ts): 용도 접두(sig·cp) + 공개키 지문 앞 12자리.
 * 키 ID·생성 시각·개인키 줄이 다른 키 파일에서 섞이면 이 값과 달라지므로, 서버와 보관본 확인 스크립트가 짝을 확인하는 데 쓴다.
 */
export function expectedKeyId(purpose: KeyPurpose, fingerprint: string): string {
  return `${purpose === "signal" ? "sig" : "cp"}-${fingerprint.slice(0, 12)}`;
}

/** key_id·용도가 맞고, 서명 시각이 키 유효기간 안에 있는 공개키를 찾는다. */
export function findKey(keys: KeysFile, keyId: string, purpose: KeyPurpose, at: string): PublicKeyEntry | null {
  const t = Date.parse(at);
  const k = keys.keys.find((e) => e.key_id === keyId && e.purpose === purpose);
  if (!k) return null;
  if (Date.parse(k.created_at) > t) return null;
  if (k.retired_at && Date.parse(k.retired_at) < t) return null;
  return k;
}
