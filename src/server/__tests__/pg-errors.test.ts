// pg(node-postgres)가 code 없이 던지는 연결 오류가 공개 오류 코드(DB_CONNECT_TIMEOUT·DB_POOL_TIMEOUT·DB_CONNECTION_LOST)로
// 분류되는지, 손으로 쓴 메시지가 아니라 실제 pg 풀(postgresDb)로 오류를 만들어 본다. pg를 올려 문장이 바뀌면 이 테스트가 잡는다
// (예전에는 이 오류들이 모두 UNKNOWN으로 나가 공개 Actions 기록만으로는 DB 연결 문제인지 알 수 없었다).
// 가짜 서버 세 가지(모두 127.0.0.1 → TLS 없음): 응답하지 않음 / 시작 메시지를 받자마자 끊음 / 연결은 받아 주고 쿼리에는 답하지 않음.
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresDb } from "../db";
import { publicError } from "../sql";

interface FakeServer {
  url: string;
  sockets: Set<net.Socket>;
  close(): Promise<void>;
}

async function fakeServer(onConnect: (s: net.Socket) => void): Promise<FakeServer> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => {});
    s.on("close", () => sockets.delete(s));
    onConnect(s);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `postgresql://postgres.abcdefghijklmnop:pw@127.0.0.1:${port}/postgres`,
    sockets,
    close: () => {
      sockets.forEach((s) => s.destroy());
      return new Promise((r) => server.close(() => r()));
    },
  };
}

/** 시작 메시지(StartupMessage)를 받으면 인증 성공(AuthenticationOk)과 ReadyForQuery만 보내고, 그 뒤 쿼리에는 답하지 않는다. */
function readyThenSilent(s: net.Socket) {
  s.once("data", () => {
    const auth = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]); // 'R' len 8, 0 = AuthenticationOk
    const ready = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]); // 'Z' len 5, 'I'
    s.write(Buffer.concat([auth, ready]));
  });
}

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => "no error",
    (e: unknown) => publicError(e).code,
  );

describe("pg 연결 오류 → 공개 코드(실제 pg 풀)", () => {
  let silent: FakeServer;
  let slam: FakeServer;
  let stall: FakeServer;

  beforeAll(async () => {
    silent = await fakeServer(() => {}); // TCP는 받지만 아무것도 보내지 않음(풀러 응답 없음)
    slam = await fakeServer((s) => s.once("data", () => s.end())); // 시작 메시지를 받자마자 정상 종료(FIN)
    stall = await fakeServer(readyThenSilent);
  });
  afterAll(async () => {
    await Promise.all([silent, slam, stall].map((s) => s?.close()));
  });

  it("연결 시간 초과(서버가 응답하지 않음) → DB_CONNECT_TIMEOUT, 공개 문장에 호스트·사용자명이 없다", async () => {
    const db = postgresDb(silent.url, { max: 1, connectionTimeoutMillis: 200 });
    try {
      const err = await db.query("SELECT 1").then(
        () => null,
        (e: unknown) => e,
      );
      expect(publicError(err)).toEqual({ code: "DB_CONNECT_TIMEOUT", message: "DB 등 외부 연결에 실패해 처리하지 못했습니다(코드 DB_CONNECT_TIMEOUT)" });
      expect(JSON.stringify(publicError(err))).not.toMatch(/127\.0\.0\.1|abcdefghijklmnop/);
      // 매개변수가 있는 쿼리(확장 프로토콜)와 트랜잭션도 같은 코드
      expect(await codeOf(db.query("SELECT $1::int", [1]))).toBe("DB_CONNECT_TIMEOUT");
      expect(await codeOf(db.tx((t) => t.query("SELECT 1")))).toBe("DB_CONNECT_TIMEOUT");
    } finally {
      await db.end?.();
    }
  });

  it("연결이 끊김(시작 직후 서버가 닫음) → DB_CONNECTION_LOST", async () => {
    const db = postgresDb(slam.url, { max: 1, connectionTimeoutMillis: 2_000 });
    try {
      expect(await codeOf(db.query("SELECT 1"))).toBe("DB_CONNECTION_LOST");
    } finally {
      await db.end?.();
    }
  });

  it("풀의 연결이 모두 쓰이는 중이라 대기 시간 초과 → DB_POOL_TIMEOUT, 쓰던 연결이 쿼리 중에 끊기면 DB_CONNECTION_LOST", async () => {
    // 첫 연결의 시작 절차(로컬, 수 ms)가 이 시간 안에 끝나야 한다. 부하가 큰 PC에서도 넉넉하게 500ms.
    const db = postgresDb(stall.url, { max: 1, connectionTimeoutMillis: 500 });
    try {
      const first = codeOf(db.query("SELECT 1")); // 하나뿐인 연결을 잡고 답을 기다림
      await new Promise((r) => setTimeout(r, 50));
      expect(await codeOf(db.query("SELECT 2"))).toBe("DB_POOL_TIMEOUT");
      stall.sockets.forEach((s) => s.destroy()); // 풀러·NAT가 쓰던 연결을 끊은 상황
      expect(await first).toBe("DB_CONNECTION_LOST");
    } finally {
      await db.end?.();
    }
  });
});
