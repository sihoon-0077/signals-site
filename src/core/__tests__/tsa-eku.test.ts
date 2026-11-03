// 고정한 기관 루트(DigiCert Trusted Root G4 등)는 타임스탬프 인증서만이 아니라 코드서명 인증서도 발급한다.
// 그래서 '루트까지 이어진다'만으로는 TSA 서명이라는 증거가 아니다(S10): 운영자가 산 코드서명 인증서로 과거 시각의
// 토큰을 만들 수 있었다. 서명 인증서는 RFC 3161 §2.3의 타임스탬프 전용 인증서여야 하고, 그 위 발급자는 모두 CA여야 한다.
// 실제 기관 토큰(tsa.test.ts의 freetsa·digicert)은 계속 통과해야 한다. 여기서는 일회용 루트를 고정 루트로 넘겨 사슬 모양만 바꿔 본다.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";
import { toHex } from "../encoding";
import { verifyTimestampToken } from "../tsa";

pkijs.setEngine("webcrypto", new pkijs.CryptoEngine({ name: "webcrypto", crypto: globalThis.crypto }));
const ALG = { name: "ECDSA", namedCurve: "P-256" };
const TS = "1.3.6.1.5.5.7.3.8"; // id-kp-timeStamping
const CS = "1.3.6.1.5.5.7.3.3"; // id-kp-codeSigning
const SERVER = "1.3.6.1.5.5.7.3.1"; // id-kp-serverAuth
const ANY = "2.5.29.37.0"; // anyExtendedKeyUsage
// keyUsage 첫 바이트(비트 0이 최상위): digitalSignature 0x80, nonRepudiation 0x40, keyCertSign 0x04, cRLSign 0x02
const KU_DS = 0x80;
const KU_CERT_SIGN = 0x04 | 0x02;
const GEN_TIME = new Date("2026-11-03T00:00:01Z");
const digest = "ab".repeat(32);

const kp = async () => (await crypto.subtle.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
let serial = 1;

interface CertSpec {
  subject: string;
  issuer: string;
  pub: CryptoKey;
  signer: CryptoKey;
  /** basicConstraints. null이면 확장 자체를 넣지 않는다 */
  bc?: { cA: boolean; pathLen?: number } | null;
  eku?: { p: string[]; critical: boolean } | null;
  /** keyUsage 첫 바이트. null이면 확장을 넣지 않는다 */
  ku?: number | null;
  notBefore?: string;
  notAfter?: string;
}

async function cert(s: CertSpec): Promise<pkijs.Certificate> {
  const c = new pkijs.Certificate();
  c.version = 2;
  c.serialNumber = new asn1js.Integer({ value: serial++ });
  c.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: s.subject }) }));
  c.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: s.issuer }) }));
  c.notBefore.value = new Date(s.notBefore ?? "2026-01-01T00:00:00Z");
  c.notAfter.value = new Date(s.notAfter ?? "2028-01-01T00:00:00Z");
  c.extensions = [];
  if (s.bc) {
    const bc = new pkijs.BasicConstraints({ cA: s.bc.cA, ...(s.bc.pathLen !== undefined ? { pathLenConstraint: s.bc.pathLen } : {}) });
    c.extensions.push(new pkijs.Extension({ extnID: "2.5.29.19", critical: true, extnValue: bc.toSchema().toBER(false), parsedValue: bc }));
  }
  if (s.ku != null) {
    let unused = 0;
    while (unused < 7 && ((s.ku >> unused) & 1) === 0) unused++;
    const ku = new asn1js.BitString({ valueHex: Uint8Array.of(s.ku).buffer, unusedBits: unused });
    c.extensions.push(new pkijs.Extension({ extnID: "2.5.29.15", critical: true, extnValue: ku.toBER(false), parsedValue: ku }));
  }
  if (s.eku) {
    const e = new pkijs.ExtKeyUsage({ keyPurposes: s.eku.p });
    c.extensions.push(new pkijs.Extension({ extnID: "2.5.29.37", critical: s.eku.critical, extnValue: e.toSchema().toBER(false), parsedValue: e }));
  }
  await c.subjectPublicKeyInfo.importKey(s.pub);
  await c.sign(s.signer, "SHA-256");
  return c;
}

/** leaf 키로 TSTInfo에 서명한 토큰(ContentInfo DER). certs가 토큰에 들어가는 인증서 목록이다. */
async function token(leaf: pkijs.Certificate, key: CryptoKey, certs: pkijs.Certificate[]): Promise<Uint8Array<ArrayBuffer>> {
  const tst = new pkijs.TSTInfo({
    version: 1,
    policy: "1.2.3.4.1",
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: "2.16.840.1.101.3.4.2.1" }),
      hashedMessage: new asn1js.OctetString({ valueHex: Uint8Array.from(Buffer.from(digest, "hex")) }),
    }),
    serialNumber: new asn1js.Integer({ value: 7 }),
    genTime: GEN_TIME,
  });
  const der = tst.toSchema().toBER(false);
  const signed = new pkijs.SignedData({
    version: 3,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: "1.2.840.113549.1.9.16.1.4", eContent: new asn1js.OctetString({ valueHex: der }) }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.3", values: [new asn1js.ObjectIdentifier({ value: "1.2.840.113549.1.9.16.1.4" })] }),
            new pkijs.Attribute({ type: "1.2.840.113549.1.9.4", values: [new asn1js.OctetString({ valueHex: await crypto.subtle.digest("SHA-256", der) })] }),
          ],
        }),
      }),
    ],
    certificates: certs,
  });
  await signed.sign(key, 0, "SHA-256");
  return new Uint8Array(new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) }).toSchema().toBER(false));
}

const setup = (async () => {
  const rootK = await kp();
  const root = await cert({ subject: "Pinned Root", issuer: "Pinned Root", pub: rootK.publicKey, signer: rootK.privateKey, bc: { cA: true }, ku: KU_CERT_SIGN });
  const spki = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", root.subjectPublicKeyInfo.toSchema().toBER(false))));
  return { rootK, root, anchors: [{ name: "Pinned Root", spkiSha256: spki }] };
})();

const TSA_LEAF: Partial<CertSpec> = { bc: { cA: false }, ku: KU_DS, eku: { p: [TS], critical: true } };
const TSA_ICA: Partial<CertSpec> = { bc: { cA: true, pathLen: 0 }, ku: KU_CERT_SIGN | KU_DS, eku: { p: [TS], critical: false } };

/** 고정 루트 → 중간 CA → 서명 인증서 사슬의 토큰을 만들어 검증한다(DigiCert 실제 사슬과 같은 모양이 기본값). */
async function verifyChain(ica: Partial<CertSpec>, leaf: Partial<CertSpec>) {
  const { rootK, root, anchors } = await setup;
  const icaK = await kp();
  const leafK = await kp();
  const icaCert = await cert({ subject: "ICA", issuer: "Pinned Root", pub: icaK.publicKey, signer: rootK.privateKey, ...TSA_ICA, ...ica });
  const leafCert = await cert({ subject: "TSA", issuer: "ICA", pub: leafK.publicKey, signer: icaK.privateKey, ...TSA_LEAF, ...leaf });
  return verifyTimestampToken(await token(leafCert, leafK.privateKey, [leafCert, icaCert, root]), digest, anchors);
}

describe("TSA 서명 인증서 용도(RFC 3161 §2.3)", () => {
  it("실제 기관과 같은 모양(EKU timeStamping 하나·critical, 발급자는 timeStamping CA)은 통과한다", async () => {
    const v = await verifyChain({}, {});
    expect([v.signatureValid, v.trusted, v.ok, v.anchor]).toEqual([true, true, true, "Pinned Root"]);
    expect(v.reason).toContain("타임스탬프 전용 인증서");
    // 선택 확장이 없는 모양(서명 인증서 keyUsage 없음, 중간 CA EKU 없음)도 규칙 위반은 아니다
    expect((await verifyChain({ eku: null }, { ku: null })).ok).toBe(true);
  });

  it("코드서명·서버·EKU 없음·critical 아님·용도 여럿·anyEKU·서명 용도 없는 keyUsage면 거부한다", async () => {
    const cases: [string, Partial<CertSpec>][] = [
      ["codeSigning", { eku: { p: [CS], critical: false } }],
      ["serverAuth", { eku: { p: [SERVER], critical: true } }],
      ["EKU 없음", { eku: null }],
      ["timeStamping, critical 아님", { eku: { p: [TS], critical: false } }],
      ["timeStamping + codeSigning", { eku: { p: [TS, CS], critical: true } }],
      ["anyExtendedKeyUsage", { eku: { p: [ANY], critical: true } }],
      ["keyUsage에 서명 용도 없음", { ku: KU_CERT_SIGN }],
    ];
    for (const [name, leaf] of cases) {
      const v = await verifyChain({}, leaf);
      expect([v.signatureValid, v.trusted, v.ok], name).toEqual([true, false, false]);
      expect(v.reason, name).toContain("타임스탬프 전용 인증서가 아님(위조 의심)");
    }
  });
});

describe("TSA 인증서 발급자(모두 CA, 서명 시각에 유효)", () => {
  it("코드서명 전용 중간 CA 아래의 timeStamping 인증서는 거부한다(DigiCert 코드서명 CA와 같은 모양)", async () => {
    const v = await verifyChain({ eku: { p: [CS], critical: false } }, {});
    expect([v.signatureValid, v.anchor, v.ok]).toEqual([true, null, false]);
    expect(v.reason).toContain("위조 의심");
  });

  it("CA가 아닌 인증서가 발급한 timeStamping 인증서는 거부한다(코드서명 고객 인증서로 만든 가짜 TSA)", async () => {
    const { rootK, root, anchors } = await setup;
    const icaK = await kp();
    const eeK = await kp();
    const fakeK = await kp();
    const ica = await cert({ subject: "Code Signing CA", issuer: "Pinned Root", pub: icaK.publicKey, signer: rootK.privateKey, bc: { cA: true, pathLen: 0 }, ku: KU_CERT_SIGN, eku: { p: [CS], critical: false } });
    const ee = await cert({ subject: "Customer", issuer: "Code Signing CA", pub: eeK.publicKey, signer: icaK.privateKey, bc: { cA: false }, ku: KU_DS, eku: { p: [CS], critical: false }, notBefore: "2026-11-20T00:00:00Z" });
    const fake = await cert({ subject: "Fake TSA", issuer: "Customer", pub: fakeK.publicKey, signer: eeK.privateKey, ...TSA_LEAF, notBefore: "2000-01-01T00:00:00Z", notAfter: "2049-12-31T00:00:00Z" });
    const v = await verifyTimestampToken(await token(fake, fakeK.privateKey, [fake, ee, ica, root]), digest, anchors);
    expect([v.signatureValid, v.anchor, v.ok]).toEqual([true, null, false]);
  });

  it("basicConstraints가 없거나 cA가 아니거나 keyCertSign이 없는 중간 인증서는 발급자로 인정하지 않는다", async () => {
    const cases: [string, Partial<CertSpec>][] = [
      ["basicConstraints 없음", { bc: null }],
      ["cA=false", { bc: { cA: false } }],
      ["keyUsage에 keyCertSign 없음", { ku: KU_DS }],
      ["keyUsage 없음", { ku: null }],
    ];
    for (const [name, ica] of cases) {
      const v = await verifyChain(ica, {});
      expect([v.signatureValid, v.anchor, v.ok], name).toEqual([true, null, false]);
    }
  });

  it("pathLen 0인 CA 아래에 CA를 하나 더 둔 사슬은 거부한다", async () => {
    const { rootK, root, anchors } = await setup;
    const aK = await kp();
    const bK = await kp();
    const leafK = await kp();
    const a = await cert({ subject: "CA-A", issuer: "Pinned Root", pub: aK.publicKey, signer: rootK.privateKey, ...TSA_ICA });
    const b = await cert({ subject: "CA-B", issuer: "CA-A", pub: bK.publicKey, signer: aK.privateKey, ...TSA_ICA, bc: { cA: true } });
    const leaf = await cert({ subject: "TSA", issuer: "CA-B", pub: leafK.publicKey, signer: bK.privateKey, ...TSA_LEAF });
    expect((await verifyTimestampToken(await token(leaf, leafK.privateKey, [leaf, b, a, root]), digest, anchors)).anchor).toBeNull();
    // 같은 사슬에서 A의 pathLen이 1이면 규칙 안이다
    const a1 = await cert({ subject: "CA-A", issuer: "Pinned Root", pub: aK.publicKey, signer: rootK.privateKey, ...TSA_ICA, bc: { cA: true, pathLen: 1 } });
    expect((await verifyTimestampToken(await token(leaf, leafK.privateKey, [leaf, b, a1, root]), digest, anchors)).ok).toBe(true);
  });

  it("서명 시각(genTime)에 유효하지 않은 중간 CA·서명 인증서는 인정하지 않는다", async () => {
    for (const ica of [{ notBefore: "2026-11-20T00:00:00Z" }, { notAfter: "2026-11-02T00:00:00Z" }]) {
      expect((await verifyChain(ica, {})).anchor, JSON.stringify(ica)).toBeNull();
    }
    const late = await verifyChain({}, { notBefore: "2026-11-20T00:00:00Z" });
    expect([late.signatureValid, late.ok]).toEqual([true, false]);
    expect(late.reason).toBe("서명 시각에 기관 인증서가 유효하지 않음");
  });
});
