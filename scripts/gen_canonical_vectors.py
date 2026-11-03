"""정규 직렬화 v2 골든 벡터 생성기 (TypeScript 구현과 따로 만든 Python 구현).

03_시스템_아키텍처_설계.md §6.1 규칙을 Python으로 따로 구현해 정답값을 만든다.
TS 코드(src/core/canonical.ts)로 정답을 만들면 테스트가 자기 자신을 검사하게 되므로, 이 파일이 기준이다.

실행: python -I scripts/gen_canonical_vectors.py  -> src/core/test-vectors/canonical_v2.json 갱신
규칙(v2):
  - 첫 필드는 고정 문자열 "v2"
  - 각 필드: 백슬래시를 먼저 "\\\\"로, 그다음 "|"를 "\\|"로 이스케이프한 뒤 "|"로 연결
  - UUID(agent_id, entry_signal_id)는 소문자로 정규화
  - 소수(가격·비중)는 소수점 4자리 고정 문자열. 4자리를 넘으면 거부(반올림하지 않음). 빈 값은 ""
  - 정수는 10진 문자열, 빈 값은 ""
  - 시각은 ISO 8601 UTC 밀리초 "YYYY-MM-DDTHH:MM:SS.mmmZ", 빈 값은 ""
  - 불리언은 "true" / "false"
"""
import hashlib
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8")

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
DEC_RE = re.compile(r"^(\d+)(?:\.(\d+))?$")


def esc(v: str) -> str:
    return v.replace("\\", "\\\\").replace("|", "\\|")


def uuid_norm(v):
    if v is None:
        return ""
    if not UUID_RE.match(v):
        raise ValueError(f"invalid uuid: {v}")
    return v.lower()


def dec(v):
    if v is None:
        return ""
    m = DEC_RE.match(v)
    if not m:
        raise ValueError(f"invalid decimal: {v}")
    frac = m.group(2) or ""
    if len(frac) > 4:
        raise ValueError(f"more than 4 decimal places: {v}")
    return f"{int(m.group(1))}.{frac.ljust(4, '0')}"


def integer(v):
    return "" if v is None else str(int(v))


def ts(v):
    if v is None:
        return ""
    d = datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def canonical(i: dict) -> str:
    if not i.get("signalId"):
        raise ValueError("signal_id required")
    fields = [
        "v2",
        uuid_norm(i["signalId"]),
        uuid_norm(i["agentId"]),
        integer(i["sequenceNo"]),
        i["market"],
        i["ticker"],
        i["side"],
        i["action"],
        dec(i["targetPrice"]),
        dec(i["stopLossPrice"]),
        dec(i["suggestedWeight"]),
        integer(i["maxHoldingDays"]),
        ts(i["validUntil"]),
        "true" if i["isPaper"] else "false",
        uuid_norm(i["entrySignalId"]),
        i["ruleVersion"],
        i["nonce"],
        i["rationale"],
        ts(i["publishedAt"]),
        i["prevHash"],
    ]
    return "|".join(esc(f) for f in fields)


SIGNAL = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a"
AGENT = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b"
ENTRY = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d"
NONCE = "00112233445566778899aabbccddeeff"
GEN = "0" * 64
H1 = hashlib.sha256(b"prev-1").hexdigest()

BASE = {
    "signalId": SIGNAL, "agentId": AGENT, "sequenceNo": 1, "market": "KOSPI", "ticker": "005930", "side": "LONG", "action": "ENTRY",
    "targetPrice": "78000", "stopLossPrice": "71500.5", "suggestedWeight": "0.1", "maxHoldingDays": 10,
    "validUntil": "2026-11-13T06:30:00.000Z", "isPaper": True, "entrySignalId": None, "ruleVersion": "momo-v1.0",
    "nonce": NONCE, "rationale": "20일선 돌파, 거래량 2배", "publishedAt": "2026-11-02T22:20:15.123Z", "prevHash": GEN,
}


def case(name, **over):
    d = dict(BASE)
    d.update(over)
    return name, d


CASES = [
    case("기본 진입"),
    case("2번째 시그널(prev_hash 연결)", sequenceNo=2, prevHash=H1),
    case("청산(EXIT) + entry_signal_id", action="EXIT", entrySignalId=ENTRY, targetPrice=None, stopLossPrice=None, suggestedWeight=None, maxHoldingDays=None, validUntil=None),
    case("숏 방향", side="SHORT"),
    case("실전 기록(is_paper=false)", isPaper=False),
    case("대문자 UUID 입력은 소문자로 정규화", signalId=SIGNAL.upper(), agentId=AGENT.upper(), entrySignalId=ENTRY.upper(), action="EXIT"),
    case("근거에 파이프 문자", rationale="조건 A | 조건 B"),
    case("근거에 백슬래시", rationale="경로 C:\\data\\x"),
    case("근거에 백슬래시+파이프 연속", rationale="a\\|b"),
    case("빈 근거", rationale=""),
    case("가격 소수 4자리", targetPrice="78000.1234", stopLossPrice="0.0001"),
    case("정수 가격", targetPrice="5", stopLossPrice="4"),
    case("비중 1", suggestedWeight="1"),
    case("빈 가격·비중", targetPrice=None, stopLossPrice=None, suggestedWeight=None),
    case("빈 보유일·유효기한", maxHoldingDays=None, validUntil=None),
    case("코스닥 종목", market="KOSDAQ", ticker="247540"),
    case("미국 종목 티커", market="NASDAQ", ticker="NVDA"),
    case("규칙 버전에 점·하이픈", ruleVersion="llm-agent-2.3.1-beta"),
    case("발행 시각 밀리초 000", publishedAt="2026-11-02T23:00:00.000Z"),
    case("발행 시각 +09:00 표기도 UTC로 정규화", publishedAt="2026-11-03T08:20:15.123+09:00"),
    case("긴 한글 근거", rationale="외국인 3일 연속 순매수, 기관 동반, 업종 지수 상대강도 상위 10%"),
    case("큰 순번", sequenceNo=12345),
]

REJECTS = [
    case("소수 5자리 가격은 거부", targetPrice="78000.12345"),
    case("소수 5자리 비중은 거부", suggestedWeight="0.12345"),
    case("잘못된 UUID는 거부", agentId="not-a-uuid"),
    case("signal_id 없음은 거부", signalId=None),
]

out = {"version": 2, "template": "v2|signal_id|agent_id|sequence_no|market|ticker|side|action|target_price|stop_loss_price|suggested_weight|max_holding_days|valid_until|is_paper|entry_signal_id|rule_version|nonce|rationale|published_at|prev_hash",
       "generator": "scripts/gen_canonical_vectors.py", "cases": [], "rejects": []}
for name, inp in CASES:
    c = canonical(inp)
    out["cases"].append({"name": name, "input": inp, "canonical": c, "sha256": hashlib.sha256(c.encode("utf-8")).hexdigest()})
for name, inp in REJECTS:
    try:
        canonical(inp)
        raise SystemExit(f"reject case did not raise: {name}")
    except ValueError as e:
        out["rejects"].append({"name": name, "input": inp, "error": str(e)})

dst = pathlib.Path(__file__).resolve().parent.parent / "src" / "core" / "test-vectors" / "canonical_v2.json"
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {dst} ({len(out['cases'])} cases, {len(out['rejects'])} rejects)")
