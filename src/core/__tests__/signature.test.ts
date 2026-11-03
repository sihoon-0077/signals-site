import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../encoding";
import {
  derToRaw,
  exportPrivateKeyPem,
  exportPublicKeyPem,
  generateSigningKeyPair,
  importPrivateKeyPem,
  importPublicKeyPem,
  publicKeyPemFromPrivate,
  rawToDer,
  signMessage,
  verifyMessage,
} from "../signature";

describe("ECDSA P-256 서명", () => {
  it("서명하고 검증한다, 메시지를 바꾸면 실패한다", async () => {
    const kp = await generateSigningKeyPair();
    const sig = await signMessage(kp.privateKey, "abc");
    expect(await verifyMessage(kp.publicKey, "abc", sig)).toBe(true);
    expect(await verifyMessage(kp.publicKey, "abd", sig)).toBe(false);
  });

  it("PEM으로 내보내고 다시 읽어도 같은 키다", async () => {
    const kp = await generateSigningKeyPair();
    const privPem = await exportPrivateKeyPem(kp.privateKey);
    const pubPem = await exportPublicKeyPem(kp.publicKey);
    expect(await publicKeyPemFromPrivate(privPem)).toBe(pubPem);
    const sig = await signMessage(await importPrivateKeyPem(privPem), "hello");
    expect(await verifyMessage(await importPublicKeyPem(pubPem), "hello", sig)).toBe(true);
  });

  it("DER 서명이 Node(OpenSSL) 검증기와 서로 호환된다", async () => {
    const kp = await generateSigningKeyPair();
    const privPem = await exportPrivateKeyPem(kp.privateKey);
    const pubPem = await exportPublicKeyPem(kp.publicKey);
    // 우리 서명 → OpenSSL 검증
    const ours = await signMessage(kp.privateKey, "interop");
    expect(nodeVerify("sha256", Buffer.from("interop"), { key: createPublicKey(pubPem), dsaEncoding: "der" }, Buffer.from(fromBase64(ours)))).toBe(true);
    // OpenSSL 서명 → 우리 검증
    const theirs = nodeSign("sha256", Buffer.from("interop2"), { key: createPrivateKey(privPem), dsaEncoding: "der" });
    expect(await verifyMessage(kp.publicKey, "interop2", toBase64(new Uint8Array(theirs)))).toBe(true);
  });

  it("원시 서명 ↔ DER 변환은 되돌릴 수 있다(앞자리 0·최상위 비트 경우 포함)", () => {
    const raw = new Uint8Array(64);
    raw[0] = 0x00;
    raw[1] = 0x01;
    raw[32] = 0x80;
    raw[63] = 0x7f;
    expect(Array.from(derToRaw(rawToDer(raw)))).toEqual(Array.from(raw));
  });

  it("망가진 서명 문자열은 예외 없이 false", async () => {
    const kp = await generateSigningKeyPair();
    expect(await verifyMessage(kp.publicKey, "x", "not-base64!!")).toBe(false);
  });
});
