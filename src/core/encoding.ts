// 바이트·문자열 변환과 SHA-256.
// src/core 전체 원칙: Next.js·DB·Node 전용 모듈을 import하지 않는다(WebCrypto만 사용).
// 그래야 브라우저 검증 페이지, 서버, CLI, 나중에 옮길 NestJS에서 같은 코드를 그대로 쓴다.

/** ArrayBuffer로 뒷받침되는 바이트 배열(WebCrypto 입력 타입과 맞추기 위해 명시). */
export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function utf8(s: string): Bytes {
  return new Uint8Array(encoder.encode(s));
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(h: string): Bytes {
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new Error("invalid hex string");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromBase64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export async function sha256Hex(data: Bytes | string): Promise<string> {
  return toHex(await sha256(typeof data === "string" ? utf8(data) : data));
}

/** 암호학적 난수 hex (nonce·초대 코드용). */
export function randomHex(byteLength: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}
