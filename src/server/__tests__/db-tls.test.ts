// 배포 드라이버(pg)가 DATABASE_CA_PEM으로 서버 인증서를 실제로 확인하는지, 가짜 PostgreSQL TLS 서버로 본다.
// 확인하지 않으면 중간자가 가짜 인증서로 연결을 받아 DB 비밀번호를 그대로 받아 갈 수 있다.
// 인증서와 개인키는 테스트 중에 만든다(저장소에 개인키를 두지 않는다). 127.0.0.1은 TLS를 쓰지 않는 로컬 주소라 127.0.0.2를 쓴다.
import net from "node:net";
import tls from "node:tls";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { postgresDb } from "../db";

const HOST = "127.0.0.2";

const pem = (label: string, der: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

/** HOST(IP)용 자체 서명 인증서(ECDSA P-256) */
async function selfSigned(): Promise<{ cert: string; key: string }> {
  const crypto = globalThis.crypto;
  pkijs.setEngine("webcrypto", new pkijs.CryptoEngine({ name: "webcrypto", crypto }));
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });
  for (const name of [cert.issuer, cert.subject]) {
    name.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "SIGNALS test DB" }) }));
  }
  cert.notBefore.value = new Date(Date.now() - 60_000);
  cert.notAfter.value = new Date(Date.now() + 3_600_000);
  const san = new pkijs.GeneralNames({ names: [new pkijs.GeneralName({ type: 7, value: new asn1js.OctetString({ valueHex: new Uint8Array(HOST.split(".").map(Number)).buffer }) })] });
  cert.extensions = [new pkijs.Extension({ extnID: "2.5.29.17", critical: false, extnValue: san.toSchema().toBER(false) })];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  return { cert: pem("CERTIFICATE", cert.toSchema(true).toBER(false)), key: pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", keys.privateKey)) };
}

describe("DB 서버 인증서 확인(TLS, pg 드라이버)", () => {
  let server: net.Server;
  let port = 0;
  let listening = false;
  let cert = "";
  /** 가짜 서버가 TLS 안에서 받은 첫 메시지(StartupMessage: 사용자 이름 등). 인증서 확인에 실패하면 비어 있어야 한다. */
  let received: string[] = [];

  beforeAll(async () => {
    const pair = await selfSigned();
    cert = pair.cert;
    server = net.createServer((raw) => {
      raw.on("error", () => {});
      raw.once("data", (buf) => {
        if (buf.length < 8 || buf.readInt32BE(4) !== 80877103) return void raw.end(); // SSLRequest가 아니면 평문 시작 → 끊음
        raw.write("S");
        const s = new tls.TLSSocket(raw, { isServer: true, key: pair.key, cert: pair.cert });
        s.on("error", () => {});
        s.once("data", (startup) => {
          received.push(startup.subarray(8).toString("utf8").split("\0").filter(Boolean).join(" "));
          const fields = Buffer.from("SFATAL\0C28000\0Mfake server reached\0\0");
          const head = Buffer.alloc(5);
          head.write("E", 0);
          head.writeInt32BE(4 + fields.length, 1);
          s.end(Buffer.concat([head, fields]));
        });
      });
    });
    listening = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false)); // 127.0.0.2를 쓸 수 없는 환경(macOS 기본 등)이면 건너뜀
      server.listen(0, HOST, () => resolve(true));
    });
    if (listening) port = (server.address() as net.AddressInfo).port;
  });
  afterAll(async () => {
    if (listening) await new Promise((r) => server.close(r));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    received = [];
  });

  const connect = async () => {
    const db = postgresDb(`postgresql://postgres.abcdefghijklmnop:test-pw@${HOST}:${port}/postgres`, { max: 1 });
    try {
      return await db.query("SELECT 1").then(
        () => "ok",
        (e: Error & { code?: string }) => `${e.code ?? ""} ${e.message}`,
      );
    } finally {
      await db.end?.();
    }
  };

  it("인증서(DATABASE_CA_PEM)가 맞으면 TLS 안에서 시작 메시지를 보낸다", async (ctx) => {
    if (!listening) ctx.skip(`${HOST}에서 들을 수 없음`);
    vi.stubEnv("DATABASE_CA_PEM", cert.replace(/\n/g, "\\n"));
    expect(await connect()).toMatch(/fake server reached/);
    expect(received).toEqual([expect.stringContaining("user postgres.abcdefghijklmnop")]);
  });

  it("다른 인증서를 내미는 서버(중간자)는 TLS 단계에서 거부하고, 사용자 이름·비밀번호를 보내지 않는다", async (ctx) => {
    if (!listening) ctx.skip(`${HOST}에서 들을 수 없음`);
    vi.stubEnv("DATABASE_CA_PEM", tls.rootCertificates[0]);
    expect(await connect()).toMatch(/certificate|self.signed|issuer|verify/i);
    expect(received).toEqual([]);
  });

  it("인증서를 넣지 않으면 암호화만 하고 연결한다(서버 확인 없음)", async (ctx) => {
    if (!listening) ctx.skip(`${HOST}에서 들을 수 없음`);
    vi.stubEnv("DATABASE_CA_PEM", "");
    expect(await connect()).toMatch(/fake server reached/);
    expect(received).toHaveLength(1);
  });
});
