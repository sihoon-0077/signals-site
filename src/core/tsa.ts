// RFC 3161 타임스탬프 (03 설계 §6.4). 시그널 지문을 외부 타임스탬프 기관(TSA)에 보내
// "이 지문이 이 시각에 존재했다"는 기관 서명(토큰)을 받는다. 진입가 규칙(entry.ts)의 기준 시각이 된다.
// 요청 생성·응답 해석·토큰 검증만 담당한다(네트워크 호출은 서버 쪽 src/server/tsa-client.ts).

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { type Bytes, bytesEqual, fromHex, toHex } from "./encoding";

const SHA256_OID = "2.16.840.1.101.3.4.2.1";

function ensureEngine() {
  // pkijs가 WebCrypto(브라우저·Node 공통)를 쓰도록 지정
  pkijs.setEngine("webcrypto", new pkijs.CryptoEngine({ name: "webcrypto", crypto: globalThis.crypto }));
}

/** SHA-256 지문(hex)에 대한 TimeStampReq DER. certReq=true로 TSA 인증서를 토큰에 넣게 한다. */
export function buildTimeStampRequest(digestHex: string, nonce: Bytes = crypto.getRandomValues(new Uint8Array(8))): Bytes {
  ensureEngine();
  // DER INTEGER는 최소 길이 양수여야 한다: 첫 바이트를 0x01~0x7f로 두면 앞에 0x00을 붙일 일도, 0x00으로 시작할 일도 없다.
  // (0x00 다음 바이트가 0x80 미만이면 '비최소 인코딩'이라 OpenSSL 기반 TSA가 요청을 거부한다.)
  const nonceBytes = new Uint8Array(nonce);
  nonceBytes[0] = (nonceBytes[0] & 0x7f) | 0x01;
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
      hashedMessage: new asn1js.OctetString({ valueHex: fromHex(digestHex) }),
    }),
    nonce: new asn1js.Integer({ valueHex: nonceBytes }),
    certReq: true,
  });
  return new Uint8Array(req.toSchema().toBER(false));
}

export interface TimestampInfo {
  /** TSA가 서명한 시각 */
  genTime: Date;
  /** 토큰에 들어 있는 지문(hex) */
  digestHex: string;
  /** 해시 알고리즘 OID */
  hashAlgorithm: string;
  serialNumber: string;
}

function octetStringBytes(os: asn1js.OctetString): Bytes {
  if (os.idBlock.isConstructed) {
    const parts = (os.valueBlock.value as asn1js.OctetString[]).map((p) => new Uint8Array(p.valueBlock.valueHexView));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
  return new Uint8Array(os.valueBlock.valueHexView);
}

function parseSignedData(tokenDer: Bytes): { signed: pkijs.SignedData; tst: pkijs.TSTInfo } {
  ensureEngine();
  const asn = asn1js.fromBER(tokenDer);
  if (asn.offset === -1) throw new Error("timestamp token is not valid BER");
  const ci = new pkijs.ContentInfo({ schema: asn.result });
  const signed = new pkijs.SignedData({ schema: ci.content });
  const eContent = signed.encapContentInfo.eContent;
  if (!eContent) throw new Error("timestamp token has no TSTInfo");
  const tstAsn = asn1js.fromBER(octetStringBytes(eContent));
  if (tstAsn.offset === -1) throw new Error("invalid TSTInfo");
  return { signed, tst: new pkijs.TSTInfo({ schema: tstAsn.result }) };
}

/** 토큰(ContentInfo DER)에서 시각·지문을 읽는다. 서명 검증은 verifyTimestampToken. */
export function parseTimestampToken(tokenDer: Bytes): TimestampInfo {
  const { tst } = parseSignedData(tokenDer);
  return {
    genTime: tst.genTime,
    digestHex: toHex(new Uint8Array(tst.messageImprint.hashedMessage.valueBlock.valueHexView)),
    hashAlgorithm: tst.messageImprint.hashAlgorithm.algorithmId,
    serialNumber: toHex(new Uint8Array(tst.serialNumber.valueBlock.valueHexView)),
  };
}

/** TimeStampResp DER에서 상태를 확인하고 토큰 DER을 꺼낸다. */
export function extractTokenFromResponse(respDer: Bytes): Bytes {
  ensureEngine();
  const asn = asn1js.fromBER(respDer);
  if (asn.offset === -1) throw new Error("timestamp response is not valid BER");
  const resp = new pkijs.TimeStampResp({ schema: asn.result });
  const status = resp.status.status;
  // 0 = granted, 1 = grantedWithMods
  if (status !== 0 && status !== 1) throw new Error(`TSA rejected request (status ${status})`);
  if (!resp.timeStampToken) throw new Error("TSA response has no token");
  return new Uint8Array(resp.timeStampToken.toSchema().toBER(false));
}

export interface TokenVerification {
  ok: boolean;
  /** 토큰 지문이 기대한 지문과 같은가 */
  digestMatches: boolean;
  /** 토큰 안의 TSA 인증서로 서명이 맞는가 */
  signatureValid: boolean;
  /**
   * 서명 인증서가 타임스탬프 전용 인증서(RFC 3161 §2.3)이고, 고정해 둔 기관 루트 공개키까지 CA 인증서의 서명으로 이어지며,
   * 서명 시각(genTime)에 유효한가(자체 서명 가짜 토큰, 같은 루트 아래 코드서명 인증서로 만든 토큰 차단)
   */
  trusted: boolean;
  /** 이어진 기관 루트 이름(없으면 null) */
  anchor: string | null;
  genTime: Date | null;
  reason: string;
}

export interface TsaTrustAnchor {
  name: string;
  /** SHA-256(SubjectPublicKeyInfo DER), hex */
  spkiSha256: string;
}

/**
 * 믿는 타임스탬프 기관의 루트 공개키. 서명 인증서가 여기까지 서명으로 이어질 때만 토큰을 인정한다.
 * 토큰 안 인증서로만 서명을 확인하면, 운영자가 자체 서명 인증서(CN=FreeTSA)로 만든 가짜 토큰도 통과하기 때문이다.
 * 기관이 서명 인증서를 바꿔도 같은 루트 아래면 그대로 통과한다. 값은 실제 토큰의 인증서에서 계산했다(2026-10-29, 03 §0.6).
 */
export const TRUSTED_TSA_ANCHORS: TsaTrustAnchor[] = [
  { name: "FreeTSA Root CA", spkiSha256: "52c54ba340885605314daa1857c8763b94087d05c636092938d4e2d1818e99b5" },
  { name: "DigiCert Trusted Root G4", spkiSha256: "59df317bfa9f4f0ab7ca514d7772296aa2c765b87664d08b96e57399e364729c" },
];

async function spkiSha256(cert: pkijs.Certificate): Promise<string> {
  const der = cert.subjectPublicKeyInfo.toSchema().toBER(false);
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", der)));
}

const sameName = (a: pkijs.RelativeDistinguishedNames, b: pkijs.RelativeDistinguishedNames) =>
  bytesEqual(new Uint8Array(a.toSchema().toBER(false)), new Uint8Array(b.toSchema().toBER(false)));

const EXT_KEY_USAGE = "2.5.29.15";
const EXT_BASIC_CONSTRAINTS = "2.5.29.19";
const EXT_EXTENDED_KEY_USAGE = "2.5.29.37";
const ID_KP_TIMESTAMPING = "1.3.6.1.5.5.7.3.8";
const ANY_EXTENDED_KEY_USAGE = "2.5.29.37.0";
// keyUsage 비트 번호(RFC 5280 §4.2.1.3): 0 digitalSignature, 1 nonRepudiation, 5 keyCertSign
const KU_DIGITAL_SIGNATURE = 0;
const KU_NON_REPUDIATION = 1;
const KU_KEY_CERT_SIGN = 5;

const extensionsOf = (c: pkijs.Certificate, oid: string) => (c.extensions ?? []).filter((e) => e.extnID === oid);

/** 확장이 없으면 undefined, 하나면 그 확장, 같은 확장이 둘 이상(RFC 5280 위반)이거나 해석하지 못했으면 null(불합격으로 다룬다). */
function singleExtension(c: pkijs.Certificate, oid: string): pkijs.Extension | null | undefined {
  const found = extensionsOf(c, oid);
  if (found.length === 0) return undefined;
  // pkijs는 형식이 틀린 확장을 빈 객체(parsingError 표시)나 undefined로 돌려준다
  const parsed = found.length === 1 ? (found[0].parsedValue as { parsingError?: string } | undefined) : undefined;
  return parsed !== undefined && !parsed.parsingError ? found[0] : null;
}

const keyPurposes = (e: pkijs.Extension): string[] => (e.parsedValue as pkijs.ExtKeyUsage).keyPurposes ?? [];

/** keyUsage 비트 열. 확장이 없으면 undefined, 읽을 수 없으면 null. */
function keyUsageBits(c: pkijs.Certificate): Uint8Array | null | undefined {
  const e = singleExtension(c, EXT_KEY_USAGE);
  if (!e) return e;
  return e.parsedValue instanceof asn1js.BitString ? new Uint8Array(e.parsedValue.valueBlock.valueHexView) : null;
}

const hasBit = (bits: Uint8Array, bit: number) => ((bits[bit >> 3] ?? 0) & (0x80 >> (bit & 7))) !== 0;

/**
 * RFC 3161 §2.3: TSA 서명 인증서는 확장 키 용도(EKU)가 하나뿐이고 critical이며 그 용도는 id-kp-timeStamping 하나다.
 * 고정한 루트(DigiCert Trusted Root G4)는 코드서명 인증서도 발급하므로, 루트까지 이어지는 것만으로는 TSA 서명이라는 증거가 아니다
 * (코드서명 인증서를 산 사람이 과거 시각의 토큰을 만들 수 있다). keyUsage가 있으면 서명 용도(digitalSignature·nonRepudiation)를 포함해야 한다.
 */
function isTsaCertificate(c: pkijs.Certificate): boolean {
  const eku = singleExtension(c, EXT_EXTENDED_KEY_USAGE);
  if (!eku || !eku.critical) return false;
  const purposes = keyPurposes(eku);
  if (purposes.length !== 1 || purposes[0] !== ID_KP_TIMESTAMPING) return false;
  const ku = keyUsageBits(c);
  if (ku === null) return false;
  return ku === undefined || hasBit(ku, KU_DIGITAL_SIGNATURE) || hasBit(ku, KU_NON_REPUDIATION);
}

/**
 * 발급자로 인정할 인증서(RFC 5280 §4.2.1.9·§4.2.1.3): basicConstraints cA=true, pathLen이 있으면 그 아래 CA 수 이하,
 * keyUsage에 keyCertSign이 있어야 한다(CA 인증서는 keyUsage를 반드시 넣는다. 두 기관의 실제 발급자 인증서도 모두 넣었다).
 * EKU가 있으면 timeStamping(또는 anyEKU)을 허용해야 한다(코드서명 전용 CA 아래의 인증서 차단).
 * 이 검사가 없으면 CA가 아닌 코드서명 고객 인증서로 'TSA' 인증서를 직접 발급해도 루트까지 이어진다.
 */
function canIssue(c: pkijs.Certificate, casBelow: number): boolean {
  const bcExt = singleExtension(c, EXT_BASIC_CONSTRAINTS);
  const bc = bcExt?.parsedValue as pkijs.BasicConstraints | undefined;
  if (!bc || bc.cA !== true) return false;
  if (typeof bc.pathLenConstraint === "number" && casBelow > bc.pathLenConstraint) return false;
  const ku = keyUsageBits(c);
  if (!ku || !hasBit(ku, KU_KEY_CERT_SIGN)) return false;
  const eku = singleExtension(c, EXT_EXTENDED_KEY_USAGE);
  if (eku === null) return false;
  return eku === undefined || keyPurposes(eku).some((p) => p === ID_KP_TIMESTAMPING || p === ANY_EXTENDED_KEY_USAGE);
}

const validAt = (c: pkijs.Certificate, t: Date) => c.notBefore.value <= t && t <= c.notAfter.value;

/**
 * 서명 인증서에서 출발해 발급자 서명을 하나씩 확인하며 올라가, 고정된 루트 공개키를 만나면 그 이름을 돌려준다.
 * 발급자는 CA 조건(canIssue)을 지켜야 하고, 고정 루트가 아닌 중간 인증서는 서명 시각(at)에 유효해야 한다.
 * 고정 루트는 인증서가 아니라 공개키로 믿으므로 그 인증서의 유효기간은 보지 않는다(교차 인증서가 만료돼도 옛 토큰은 그대로).
 */
async function chainToAnchor(signer: pkijs.Certificate, certs: pkijs.Certificate[], anchors: TsaTrustAnchor[], at: Date): Promise<string | null> {
  let current = signer;
  for (let depth = 0; depth < 5; depth++) {
    const fp = await spkiSha256(current);
    const hit = anchors.find((a) => a.spkiSha256 === fp);
    if (hit) return hit.name;
    // 서명 인증서(depth 0)의 유효기간은 verifyTimestampToken이 따로 보고 이유도 따로 적는다
    if (depth > 0 && !validAt(current, at)) return null;
    let next: pkijs.Certificate | null = null;
    for (const c of certs) {
      // depth = 발급자 c 아래(서명 인증서 제외)에 있는 CA 수. c의 pathLen과 비교한다
      if (c === current || !sameName(c.subject, current.issuer) || !canIssue(c, depth)) continue;
      try {
        if (await current.verify(c)) {
          next = c;
          break;
        }
      } catch {
        // 서명 알고리즘을 못 읽는 인증서는 건너뛴다
      }
    }
    if (!next) return null;
    current = next;
  }
  return null;
}

/**
 * 토큰이 이 지문에 대한 것인지, TSA 서명이 맞는지, 서명 인증서가 타임스탬프 전용 인증서이고 믿는 기관 루트까지 CA 인증서로 이어지는지 확인한다.
 * 검증 화면·CLI(verify.ts)와 사이트가 TSA 응답을 저장하기 전(server/tsa-client.ts)이 모두 이 함수를 쓴다.
 */
export async function verifyTimestampToken(tokenDer: Bytes, expectedDigestHex: string, anchors: TsaTrustAnchor[] = TRUSTED_TSA_ANCHORS): Promise<TokenVerification> {
  let info: TimestampInfo;
  let signed: pkijs.SignedData;
  try {
    info = parseTimestampToken(tokenDer);
    signed = parseSignedData(tokenDer).signed;
  } catch (e) {
    return { ok: false, digestMatches: false, signatureValid: false, trusted: false, anchor: null, genTime: null, reason: `토큰 해석 실패: ${(e as Error).message}` };
  }
  const digestMatches = info.hashAlgorithm === SHA256_OID && bytesEqual(fromHex(info.digestHex), fromHex(expectedDigestHex));
  let signatureValid = false;
  let tsaCertificate = false;
  let anchor: string | null = null;
  let validAtGenTime = false;
  try {
    // pkijs는 TSTInfo 토큰을 검증할 때 '타임스탬프를 찍은 원본 문서'를 data로 요구하고 직접 해시해 비교한다.
    // 우리는 원본이 아니라 지문만 갖고 있으므로(청산 전 시그널, 앵커 루트) 지문 비교는 위에서 직접 하고,
    // 여기서는 내용 형식을 일반 데이터(id-data)로 바꿔 CMS 서명만 검증하게 한다.
    // 이때도 서명된 속성의 messageDigest와 TSTInfo 해시는 대조되므로, 시각을 1바이트만 바꿔도 실패한다(tsa.test.ts).
    signed.encapContentInfo.eContentType = "1.2.840.113549.1.7.1";
    const r = await signed.verify({ signer: 0, checkChain: false, extendedMode: true });
    signatureValid = r.signatureVerified === true;
    const signer = r.signerCertificate;
    // 용도를 사슬보다 먼저 본다: 타임스탬프 전용이 아닌 인증서면 루트까지 이어져도 기관 서명이 아니다
    tsaCertificate = signatureValid && !!signer && isTsaCertificate(signer);
    if (signer && tsaCertificate) {
      anchor = await chainToAnchor(signer, (signed.certificates ?? []).filter((c): c is pkijs.Certificate => c instanceof pkijs.Certificate), anchors, info.genTime);
      validAtGenTime = validAt(signer, info.genTime);
    }
  } catch {
    signatureValid = false;
  }
  const trusted = tsaCertificate && anchor !== null && validAtGenTime;
  const ok = digestMatches && signatureValid && trusted;
  const reason = !digestMatches
    ? "토큰의 지문이 시그널 지문과 다름"
    : !signatureValid
      ? "TSA 서명 검증 실패"
      : !tsaCertificate
        ? "서명 인증서가 타임스탬프 전용 인증서가 아님(위조 의심)"
        : !anchor
          ? "서명 인증서가 믿는 기관 루트까지 CA 인증서로 이어지지 않음(위조 의심)"
          : !validAtGenTime
            ? "서명 시각에 기관 인증서가 유효하지 않음"
            : `지문 일치, 기관 서명 유효(타임스탬프 전용 인증서, ${anchor}까지 CA 인증서 연결 확인)`;
  return { ok, digestMatches, signatureValid, trusted, anchor, genTime: info.genTime, reason };
}
