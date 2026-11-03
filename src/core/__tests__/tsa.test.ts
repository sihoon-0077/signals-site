import { readFileSync } from "node:fs";
import path from "node:path";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";
import { toHex } from "../encoding";
import { TRUSTED_TSA_ANCHORS, buildTimeStampRequest, parseTimestampToken, verifyTimestampToken } from "../tsa";

const dir = path.join(__dirname, "fixtures");
const digest = readFileSync(path.join(dir, "token-digest.txt"), "utf8").trim();
const token = (name: string) => new Uint8Array(readFileSync(path.join(dir, `${name}-token.der`)));

describe("RFC 3161 타임스탬프", () => {
  it("요청에 SHA-256 지문과 certReq가 들어간다", () => {
    const der = buildTimeStampRequest(digest);
    const req = new pkijs.TimeStampReq({ schema: asn1js.fromBER(der).result });
    expect(req.messageImprint.hashAlgorithm.algorithmId).toBe("2.16.840.1.101.3.4.2.1");
    expect(toHex(new Uint8Array(req.messageImprint.hashedMessage.valueBlock.valueHexView))).toBe(digest);
    expect(req.certReq).toBe(true);
  });

  for (const name of ["freetsa", "digicert"]) {
    it(`${name} 실제 토큰: 지문 일치 + TSA 서명 유효`, async () => {
      const info = parseTimestampToken(token(name));
      expect(info.digestHex).toBe(digest);
      const v = await verifyTimestampToken(token(name), digest);
      expect(v.digestMatches).toBe(true);
      expect(v.signatureValid).toBe(true);
      expect(v.ok).toBe(true);
    });

    it(`${name} 토큰은 다른 지문에 대해서는 실패한다`, async () => {
      const v = await verifyTimestampToken(token(name), "0".repeat(64));
      expect(v.ok).toBe(false);
      expect(v.digestMatches).toBe(false);
    });
  }

  it("토큰 바이트를 1바이트 바꾸면 서명 검증이 실패한다", async () => {
    const t = token("freetsa");
    // 서명값이 들어 있는 뒤쪽 바이트를 하나 뒤집는다
    t[t.length - 10] ^= 0xff;
    const v = await verifyTimestampToken(t, digest);
    expect(v.ok).toBe(false);
  });

  for (const name of ["freetsa", "digicert"]) {
    it(`${name} 토큰의 시각(genTime)을 1바이트 바꾸면 실패한다`, async () => {
      const t = token(name);
      const year = new TextEncoder().encode(String(parseTimestampToken(t).genTime.getUTCFullYear()));
      const idx = Buffer.from(t).indexOf(Buffer.from(year));
      expect(idx).toBeGreaterThan(0);
      t[idx + 9] ^= 1;
      const v = await verifyTimestampToken(t, digest);
      expect(v.signatureValid).toBe(false);
    });
  }
});

describe("기관 인증서 고정(자체 서명 가짜 토큰 차단)", () => {
  it("실제 토큰은 각 기관 루트까지 인증서 서명이 이어진다", async () => {
    expect((await verifyTimestampToken(token("freetsa"), digest)).anchor).toBe("FreeTSA Root CA");
    expect((await verifyTimestampToken(token("digicert"), digest)).anchor).toBe("DigiCert Trusted Root G4");
  });

  // 용도 검사(tsa-eku.test.ts)를 더한 뒤에도 실제 기관 토큰은 통과해야 한다: 두 기관의 서명 인증서는 EKU가 timeStamping 하나(critical)이고
  // 발급자는 CA다(DigiCert 중간 CA는 pathLen 0, EKU timeStamping).
  it("실제 기관 토큰의 서명 인증서는 타임스탬프 전용 인증서로 인정된다", async () => {
    for (const name of ["freetsa", "digicert"]) {
      const v = await verifyTimestampToken(token(name), digest);
      expect([v.trusted, v.ok], name).toEqual([true, true]);
      expect(v.reason, name).toMatch(/^지문 일치, 기관 서명 유효\(타임스탬프 전용 인증서, .+까지 CA 인증서 연결 확인\)$/);
    }
  });

  it("믿는 루트 목록에 없는 기관이면 서명이 맞아도 인정하지 않는다", async () => {
    // 운영자가 만든 자체 서명 'FreeTSA' 토큰과 같은 상황: 토큰 안 인증서로는 서명이 맞지만 고정된 루트로 이어지지 않는다.
    const onlyDigicert = TRUSTED_TSA_ANCHORS.filter((a) => a.name.startsWith("DigiCert"));
    const v = await verifyTimestampToken(token("freetsa"), digest, onlyDigicert);
    expect([v.signatureValid, v.trusted, v.ok]).toEqual([true, false, false]);
    expect(v.reason).toContain("위조 의심");
  });

  it("논스는 항상 최소 길이 양수 DER로 인코딩된다(0x00·0x80 시작 값 포함)", () => {
    for (const first of [0x00, 0x80, 0xff]) {
      const der = buildTimeStampRequest(digest, new Uint8Array([first, 0x12, 3, 4, 5, 6, 7, 8]));
      const req = new pkijs.TimeStampReq({ schema: asn1js.fromBER(der).result });
      const bytes = new Uint8Array(req.nonce!.valueBlock.valueHexView);
      expect(bytes.length).toBe(8);
      expect(bytes[0]).toBeGreaterThanOrEqual(1);
      expect(bytes[0]).toBeLessThanOrEqual(0x7f);
    }
  });
});
