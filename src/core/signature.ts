// ECDSA P-256 / SHA-256 서명 (03 설계 §6.2: DER → base64 저장).
//
// 서명 대상은 지문(content_hash) 16진 문자열의 UTF-8이다.
// 원문 대신 지문에 서명하면, 청산 전이라 원문이 비공개인 시그널도 누구나 서명을 확인할 수 있다
// ("플랫폼이 이 지문을 이 키로 확정했다"). 원문과 지문의 연결은 청산 후 공개 때 해시 재계산으로 확인한다.
//
// WebCrypto는 서명을 r‖s(각 32바이트) 원시 형식으로 주고받으므로, 저장·교환용 DER과 서로 변환한다.

import { type Bytes, concatBytes, fromBase64, sha256Hex, toBase64, utf8 } from "./encoding";

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" } as const;

export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ALG, true, ["sign", "verify"]) as Promise<CryptoKeyPair>;
}

function toPem(label: string, der: Uint8Array): string {
  const b64 = toBase64(der).replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function fromPem(pem: string, label: string): Bytes {
  const re = new RegExp(`-----BEGIN ${label}-----([\\s\\S]*?)-----END ${label}-----`);
  const m = re.exec(pem.replace(/\\n/g, "\n"));
  if (!m) throw new Error(`PEM block not found: ${label}`);
  return fromBase64(m[1].replace(/\s+/g, ""));
}

export async function exportPublicKeyPem(key: CryptoKey): Promise<string> {
  return toPem("PUBLIC KEY", new Uint8Array(await crypto.subtle.exportKey("spki", key)));
}

export async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
  return toPem("PRIVATE KEY", new Uint8Array(await crypto.subtle.exportKey("pkcs8", key)));
}

export async function importPublicKeyPem(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", fromPem(pem, "PUBLIC KEY"), ALG, true, ["verify"]);
}

export async function importPrivateKeyPem(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", fromPem(pem, "PRIVATE KEY"), ALG, true, ["sign"]);
}

/** 공개키 지문 = SHA-256(SPKI DER). keys.json에 함께 공개해 키 바꿔치기를 막는다. */
export async function publicKeyFingerprint(pem: string): Promise<string> {
  return sha256Hex(fromPem(pem, "PUBLIC KEY"));
}

/** 개인키 PEM에서 공개키 PEM을 만든다(환경변수에는 개인키만 두기 위해). */
export async function publicKeyPemFromPrivate(privatePem: string): Promise<string> {
  const priv = await crypto.subtle.importKey("pkcs8", fromPem(privatePem, "PRIVATE KEY"), ALG, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  delete jwk.d;
  jwk.key_ops = ["verify"];
  const pub = await crypto.subtle.importKey("jwk", jwk, ALG, true, ["verify"]);
  return exportPublicKeyPem(pub);
}

// ---- 원시(r‖s) ↔ DER 변환 ----

function trimInteger(b: Uint8Array): Bytes {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.slice(i);
  return v[0] & 0x80 ? concatBytes(new Uint8Array([0]), v) : new Uint8Array(v);
}

export function rawToDer(raw: Uint8Array): Bytes {
  if (raw.length !== 64) throw new Error("raw P-256 signature must be 64 bytes");
  const r = trimInteger(raw.slice(0, 32));
  const s = trimInteger(raw.slice(32));
  const body = concatBytes(new Uint8Array([0x02, r.length]), r, new Uint8Array([0x02, s.length]), s);
  return concatBytes(new Uint8Array([0x30, body.length]), body);
}

export function derToRaw(der: Uint8Array): Bytes {
  if (der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error("invalid DER signature");
  let off = 2;
  const read = () => {
    if (der[off] !== 0x02) throw new Error("invalid DER integer");
    const len = der[off + 1];
    const v = der.slice(off + 2, off + 2 + len);
    off += 2 + len;
    let i = 0;
    while (i < v.length - 1 && v[i] === 0) i++;
    const t = v.slice(i);
    if (t.length > 32) throw new Error("DER integer too long");
    const out = new Uint8Array(32);
    out.set(t, 32 - t.length);
    return out;
  };
  const r = read();
  const s = read();
  if (off !== der.length) throw new Error("trailing bytes in DER signature");
  return concatBytes(r, s);
}

/** 메시지(문자열)에 서명해 DER base64를 돌려준다. */
export async function signMessage(privateKey: CryptoKey, message: string): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.sign(SIGN_ALG, privateKey, utf8(message)));
  return toBase64(rawToDer(raw));
}

export async function verifyMessage(publicKey: CryptoKey, message: string, signatureB64: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify(SIGN_ALG, publicKey, derToRaw(fromBase64(signatureB64)), utf8(message));
  } catch {
    return false;
  }
}
