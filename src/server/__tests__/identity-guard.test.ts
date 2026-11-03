// 공급자 신원 정보 검사(identity-guard.ts)의 잡는 것·넘기는 것. 발행(규칙 버전·근거)과 에이전트 만들기가 같은 검사를 쓴다.
// 넘기는 쪽 목록은 실제 근거·규칙 버전에 흔한 표기다(가격 앞 '@', 매매 표기 '@VWAP', 종목 표기의 점, 종목 코드 + 수량·날짜, 버전 번호).
// 연락처는 확인으로 넘길 수 없어 여기서 걸리면 정상 발행이 막힌다.
import { describe, expect, it } from "vitest";
import { findContact, findProviderName, findProviderNames } from "../identity-guard";

const blue = { handle: "blue-forest", pen_name: "파란숲" };
const fox = { handle: "bluefox", pen_name: "파란여우" };
const token = { handleAsToken: true };
const substring = { handleAsToken: false };
const zw = (s: string) => s.replace(/\|/g, String.fromCharCode(0x200b)); // '|' 자리에 폭 없는 공백(복사해 붙인 글에 섞이는 글자)

describe("연락처(메일·링크·메신저 주소)", () => {
  it("잡는다: 메일, 링크, 메신저·단축 주소, @아이디, 흔한 도메인, 전각으로 쓴 표기", () => {
    for (const t of [
      "문의 bluefox@gmail.com",
      "Mail: BLUE.FOX@Naver.COM",
      "https://blog.naver.com/xyz",
      "http://x.y",
      "www.bluefox.kr",
      "t.me/bluefox",
      "오픈채팅 open.kakao.com/o/abc",
      "bit.ly/3abc",
      "텔레그램 @bluefox_kr",
      "문의@bluefox",
      "blog.naver.com/bluefox",
      "x.com/bluefox",
      "youtu.be/abc",
      "brunch.co.kr/@x",
      "ｔ．ｍｅ／bluefox",
      "문의＠bluefox",
    ]) {
      expect(findContact(t), t).not.toBeNull();
    }
  });

  it("넘긴다: 버전 번호, 비율·가격 표기, 종목 표기, 가격 앞 @, 'buy@open'", () => {
    for (const t of [
      "momo-v1.0",
      "v2.1.3",
      "20일선 돌파 | 거래량 2배, 손절 1.5%",
      "RSI 30 이탈 매수, 손절 -3.5%",
      "BRK.B 실적 발표 전",
      "005930.KS 외국인 순매수",
      "목표 @78000",
      "buy@open sell@close",
      "PER 8.5배, e.g. 갭 상승",
      "MA20/MA60 골든크로스",
    ]) {
      expect(findContact(t), t).toBeNull();
    }
  });

  it("걸린 표기를 알려 준다(운영자가 어디를 고칠지 알 수 있게)", () => {
    expect(findContact("근거: 20일선, 자세히는 t.me/bluefox 참고")).toBe("t.me/bluefox");
    expect(findContact("문의 bluefox@gmail.com 로")).toBe("bluefox@gmail.com");
    expect(findContact("20일선 (blog.example.com/blue) 참고")).toBe("blog.example.com/blue");
    expect(findContact("RSI 30 이탈 매수, 문의 010-1234-5678")).toBe("010-1234-5678");
  });

  it("잡는다: 휴대전화 번호, 영문 라벨에 붙은 @아이디, 폭 없는 문자로 나눈 주소", () => {
    for (const t of [
      "RSI 30 이탈 매수, 문의 010-1234-5678",
      "연락 01012345678",
      "010 1234 5678",
      "010.1234.5678",
      "+82 10-1234-5678",
      "+82-10-1234-5678",
      "문의:010-1234-5678.",
      "０１０－１２３４－５６７８",
      "IG@bluefox_kr",
      "insta@bluefox",
      "Instagram@bluefox",
      "카톡ID@bluefox",
      "telegram@bluefox_kr",
      "IG@ bluefox",
      "kakao@bluefox",
      "KakaoTalk@bluefox",
      "TG@bluefox_kr",
      "DM@bluefox",
      "Kakao@open.chat",
      zw("@|bluefox_kr"),
      zw("t|.me/bluefox"),
      zw("t.|me/bluefox"),
      zw("bluefox@gmail.c|om"),
      zw("open.kakao|.com/o/abc"),
      `@${String.fromCharCode(0x2060)}bluefox`,
      `@${String.fromCharCode(0x00ad)}bluefox`,
    ]) {
      expect(findContact(t), t).not.toBeNull();
    }
  });

  it("넘긴다: 매매 표기(@VWAP·@MKT·@open·@close·@MA20), 가격 앞 @, 국내 거래소 접미사, 종목 코드 + 수량·날짜, 다른 낱말 끝의 id@, 라벨 뒤의 매매 표기·가격", () => {
    for (const t of [
      "진입 @VWAP, 손절 -3%",
      "매수 @open, 매도 @close",
      "BUY @MKT",
      "SELL @MARKET 15:20",
      "진입 @MA20.",
      "진입 @EMA20, 손절 @-3%",
      "@SMA200 지지",
      "@TWAP 분할, @POC 부근, @limit 주문, @stop 이탈, @target 도달",
      "sell @high, buy @low, @bid·@ask 확인",
      "목표 @78,000",
      "000660.KS 외국인 순매수, 035720.KQ 반등",
      "롯데케미칼 011170 1000주 분할 매수",
      "고려아연 010130 2026-11-02 진입",
      "016360 1500 돌파",
      "018880 4500원 지지 확인 후 진입",
      "010950 1230 1450 구간 박스",
      "005930 010130 011170",
      "거래량 1,016,789주",
      "2026-11-02 10:00",
      "KR7010130003",
      "bid@open mid@vwap valid@close paid@close",
      "Kakao@open, Naver@close",
      "TG@open 매수",
      "IG@open 매수, ID@VWAP 진입, DM@close 정리",
      "Kakao@78,000 지지, Kakao@시가",
      "PER 8.5. Co-founder 지분 매도 이후 반등",
      zw("buy|@open"),
    ]) {
      expect(findContact(t), t).toBeNull();
    }
  });

  it("매매 표기와 같은 낱말로 시작해도 뒤에 영문·숫자·'_'·'.영문'이 이어지면 아이디로 본다. 최상위 도메인과 같은 접미사는 그대로 거부한다", () => {
    for (const t of ["@open.chat", "@stop.loss", "@stopper", "@marketing_kr", "@close_friends", "@target_kr", "@highlight", "@ma20x", "bluefox.me", "bluefox.co", "AAPL.US", "C3.ai"]) {
      expect(findContact(t), t).not.toBeNull();
    }
  });
});

describe("공급자 프로필 주소·필명", () => {
  it("주소는 대소문자·하이픈 생략·'_'·'.'·공백·전각 표기도 잡고, 필명은 띄어 쓰거나 자모가 분리된 채 붙여 넣어도 잡는다", () => {
    for (const t of ["Blue-Forest-v1", "blueforest 전략", "BLUE_FOREST", "blue forest", "blue.forest-v2", "ｂｌｕｅ－ｆｏｒｅｓｔ"]) {
      expect(findProviderName(t, blue, token), t).toEqual({ kind: "handle", label: "@blue-forest" });
    }
    const zwsp = String.fromCharCode(0x200b); // 복사해 붙인 글에 섞이는 폭 없는 공백
    for (const t of ["파란숲 20일선", "파란 숲 20일선", `${"파란숲".normalize("NFD")}의 전략`, `파란${zwsp}숲 전략`]) {
      expect(findProviderName(t, blue, token), t).toEqual({ kind: "pen_name", label: "파란숲" });
    }
  });

  it("하이픈 없는 주소도 글자 사이를 띄우거나 기호·폭 없는 문자를 끼운 표기를 잡고, 발행은 바로 붙인 버전 번호도 잡는다", () => {
    for (const t of ["Blue Fox 20일선 전략", "blue fox 전략 20일선", "BLUE FOX v1", "blue_fox", "blue.fox", "blue-fox-v1", "Blue·Fox", zw("blue|fox 전략")]) {
      expect(findProviderName(t, fox, token), t).toEqual({ kind: "handle", label: "@bluefox" });
    }
    for (const t of ["bluefox2", "BlueFoxV2", "BlueFox2026", "bluefox-v2", "bluefox_v2"]) {
      expect(findProviderName(t, fox, token), t).toEqual({ kind: "handle", label: "@bluefox" });
    }
    // 에이전트 만들기(부분 문자열)
    for (const t of ["blue-fox-swing", "Blue Fox 스윙", "blue fox 스윙", "blue_fox 20일선", "bluefoxswing"]) {
      expect(findProviderName(t, fox, substring), t).toEqual({ kind: "handle", label: "@bluefox" });
    }
    // 하이픈 있는 주소에 숫자를 붙이거나 폭 없는 문자를 끼운 표기, 숫자가 든 주소를 띄어 쓴 표기
    for (const t of ["blue-forest2", "BlueForestV2", zw("blue|forest")]) {
      expect(findProviderName(t, blue, token), t).toEqual({ kind: "handle", label: "@blue-forest" });
    }
    expect(findProviderName("sihoon 77 전략", { handle: "sihoon77", pen_name: "시훈" }, token)?.kind).toBe("handle");
    expect(findProviderName("Quant King 모멘텀", { handle: "quantking", pen_name: "퀀트왕" }, token)?.kind).toBe("handle");
  });

  it("발행(낱말 단위)은 다른 영문 낱말에 붙은 주소를 넘긴다(버전 번호가 아닌 영문이 뒤에 붙음)", () => {
    expect(findProviderName("bluefoxes 패턴", fox, token)).toBeNull();
    expect(findProviderName("bluefoxswing", fox, token)).toBeNull(); // 알려진 한계(운영자가 직접 읽는다)
    expect(findProviderName("rsix 지표 확인", { handle: "rsi", pen_name: "zz" }, token)).toBeNull();
  });

  it("발행(낱말 단위)은 주소가 다른 낱말의 일부일 때 넘기고, 에이전트 만들기(부분 문자열)는 잡는다", () => {
    const mom = { handle: "mom", pen_name: "모" };
    expect(findProviderName("momo-v1.0", mom, token)).toBeNull();
    expect(findProviderName("momentum 전략", mom, token)).toBeNull();
    expect(findProviderName("mom-v1", mom, token)?.kind).toBe("handle");
    expect(findProviderName("momo-swing", mom, { handleAsToken: false })?.kind).toBe("handle");
  });

  it("1글자 필명은 보지 않는다. 지표·용어와 같은 주소·필명은 걸린다(발행은 운영자 확인으로 넘긴다)", () => {
    expect(findProviderName("모멘텀 20일선", { handle: "zzz-quant", pen_name: "모" }, token)).toBeNull();
    const rsi = { handle: "rsi", pen_name: "돌파" };
    expect(findProviderName("RSI 30 이탈 매수", rsi, token)).toEqual({ kind: "handle", label: "@rsi" });
    expect(findProviderName("20일선 돌파", rsi, token)).toEqual({ kind: "pen_name", label: "돌파" });
  });

  it("관계없는 문구는 넘긴다", () => {
    for (const t of ["20일선 돌파 | 거래량 2배", "momo-v1.0", "RSI 30 이탈", "파란색 양봉", "숲 속 같은 횡보"]) {
      expect(findProviderName(t, blue, token), t).toBeNull();
    }
  });

  it("주소와 필명이 함께 걸리면 둘 다 돌려준다(주소 먼저). 첫 번째만 보는 findProviderName은 주소를 돌려준다", () => {
    const rsi = { handle: "rsi", pen_name: "돌파왕" };
    expect(findProviderNames("RSI 30 이탈 매수 — 돌파왕 전략", rsi, token)).toEqual([
      { kind: "handle", label: "@rsi" },
      { kind: "pen_name", label: "돌파왕" },
    ]);
    expect(findProviderNames("돌파왕 본인 전략: 20일선 돌파", rsi, token)).toEqual([{ kind: "pen_name", label: "돌파왕" }]);
    expect(findProviderNames("20일선 돌파", rsi, token)).toEqual([]);
    expect(findProviderName("RSI 30 이탈 매수 — 돌파왕 전략", rsi, token)).toEqual({ kind: "handle", label: "@rsi" });
  });
});
