#!/usr/bin/env bash
# 사이트에 오늘(KST) 일일 앵커를 만들게 한다. GitHub Actions(.github/workflows/anchor.yml)의 request job이 매일 실행한다.
# CRON_SECRET을 받는 것은 이 스크립트(request job)뿐이다. 이 job에서는 GitHub의 checkout 액션과 러너 기본 도구(bash·curl·jq)만 돌고,
# PyPI 패키지(검증기·ots)는 비밀값이 없는 check job에서만 돈다(같은 job이면 그 코드가 러너 메모리에서 비밀값을 꺼낼 수 있다).
#  - 같은 날짜는 한 번만 만들어진다(이미 있으면 사이트가 저장된 앵커를 돌려줌). KST 18시 전에는 요청하지 않는다.
#  - 요청에 오늘 날짜를 실어 보내고 사이트는 그 날짜가 아직 오늘일 때만 만든다. 시도마다 날짜를 다시 보고,
#    재시도 사이에 KST 자정이 지났으면 더 요청하지 않는다(다음 날 앵커가 00시에 확정되지 않게).
#  - 연결 실패(000)·5xx만 30초 간격으로 다시 보낸다(최대 3번).
# 실패하면(종료 코드 1, 사이트가 과거 기록 불일치를 보고하면 2) 뒤 job(대조·검증·커밋)이 돌지 않아 아무것도 커밋되지 않는다.
# 필요: 환경변수 SITE_URL, CRON_SECRET / 도구: curl, jq(러너 기본 설치)
# 시험용: RETRY_DELAY(재시도 간격 초, 기본 30)
set -euo pipefail
fail() { echo "::error::$2"; exit "$1"; }
[ -n "${SITE_URL:-}" ] || fail 1 "SITE_URL이 없습니다. 저장소 Settings → Secrets and variables → Actions → Variables에 운영 도메인을 넣으세요."
# environment 비밀값은 그 environment를 쓰는 job에만 주어진다. 빈 값이면 environment 이름이나 비밀값 이름이 다르거나 아직 넣지 않은 것
[ -n "${CRON_SECRET:-}" ] ||
  fail 1 "CRON_SECRET이 없습니다. 저장소 Settings → Environments → anchor-cron → Environment secrets에 사이트와 같은 값을 넣으세요."
SITE_URL="${SITE_URL%/}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

# 응답 요약: JSON이면 error·message만, 아니면 앞부분 한 줄(HTML 오류 화면 전체를 공개 로그에 쏟지 않는다)
summary() {
  [ -s "$1" ] || { echo "응답 없음"; return; }
  jq -r '[.error, .message] | map(strings) | join(": ")' "$1" 2>/dev/null || head -c 200 "$1" | tr -s '\r\n\t' '   '
}

today="$(TZ=Asia/Seoul date +%F)"

if [ "$(TZ=Asia/Seoul date +%-H)" -lt 18 ]; then
  # 18시 전에 만들면 그날 앵커가 그 시각으로 확정되어(같은 날짜는 다시 만들 수 없음) 이후 발행분이 다음 날 앵커로 밀린다
  # (18시 전 수동 실행, 자정을 넘겨 늦게 시작된 예약 실행). 그래서 요청하지 않고 성공으로 끝낸다(뒤 job의 대조·미러링은 그대로 돈다).
  echo "::notice::KST 18시 전이라 오늘(${today}) 앵커는 요청하지 않고 대조·미러링만 합니다."
  exit 0
fi

# 같은 날짜는 한 번만 만들어지므로(이미 있으면 저장된 앵커를 돌려줌) 연결 실패(000)·5xx는 다시 시도해도 안전하다.
# 401·409·422 같은 응답은 다시 보내도 같으므로 바로 실패시킨다(409 경보가 재시도에 묻히지 않게).
for attempt in 1 2 3; do
  # 시도마다 날짜를 다시 본다. 재시도 사이에 KST 자정이 지났으면 더 보내지 않는다(사이트도 지난 날짜 요청은 422로 거절해
  # 다음 날 앵커를 00시에 만들지 않는다). 그날은 빈 날로 남고 다음 날 로그에 빈 날 경고가 나온다.
  [ "$(TZ=Asia/Seoul date +%F)" = "$today" ] ||
    fail 1 "KST 자정이 지나 ${today} 앵커를 요청하지 않았습니다(그날은 빈 날로 남습니다)."
  : > "$work/cron.json"
  # curl 자체가 실패하면(연결 실패·시간 초과·응답 도중 끊김) 받은 상태 코드와 상관없이 일시 실패(000)로 본다
  code=$(curl -sS --max-time 90 -o "$work/cron.json" -w '%{http_code}' -X POST -H "Authorization: Bearer ${CRON_SECRET}" "${SITE_URL}/api/cron/anchor?date=${today}") || code="000"
  case "$code" in 000 | 5??) ;; *) break ;; esac
  [ "$attempt" -lt 3 ] || break
  echo "::warning::앵커 생성 요청 일시 실패(HTTP ${code}: $(summary "$work/cron.json")). ${RETRY_DELAY:-30}초 뒤 다시 시도합니다(${attempt}/3)."
  sleep "${RETRY_DELAY:-30}"
done
case "$code" in
  200)
    # 운영 사이트는 KST 18시 전 요청이면 앵커 없이 skipped로 답한다. 이 실행은 18시 이후라고 보고 보냈으므로 두 시계가 다르다.
    if jq -e '.skipped' "$work/cron.json" >/dev/null 2>&1; then
      fail 1 "이 실행은 KST 18시 이후(${today})라고 보고 요청했는데 사이트는 18시 전이라며 앵커를 만들지 않았습니다(skipped: $(jq -c '.skipped' "$work/cron.json")). 러너와 사이트의 시계가 다릅니다. 몇 분 뒤 Run workflow로 다시 실행하세요."
    fi
    jq -e --arg t "$today" '.document.date == $t and (.document.merkle_root | type == "string" and test("^[0-9a-f]{64}$"))' "$work/cron.json" >/dev/null 2>&1 ||
      fail 1 "앵커 생성 응답(HTTP 200)이 ${today} 앵커 문서가 아닙니다. Variables의 SITE_URL이 SIGNALS 사이트 주소인지 확인하세요."
    echo "오늘 앵커: $(jq -r '.document.date + " 루트 " + .document.merkle_root + " 생성 시각 " + (.document.created_at | tostring) + (if .created then " (새로 생성)" else " (이미 있음)" end)' "$work/cron.json")"
    if [ "$(jq '.tsa_errors | length' "$work/cron.json")" != "0" ]; then
      echo "::warning::루트 타임스탬프 일부 실패: $(jq -c '.tsa_errors' "$work/cron.json")"
    fi
    ;;
  # 요청한 날짜가 사이트에서 이미 오늘이 아니게 됐다(요청이 KST 자정을 넘겨 닿음) 등. 다시 보내도 같으므로 재시도하지 않는다.
  422) fail 1 "사이트가 ${today} 앵커를 만들지 않았습니다(HTTP 422: $(summary "$work/cron.json")). 요청이 KST 자정을 넘겨 닿았으면 그날은 빈 날로 남습니다." ;;
  409) fail 2 "사이트가 과거 기록 불일치를 보고했습니다(HTTP 409): $(jq -er '.message // "메시지 없음"' "$work/cron.json" 2>/dev/null || summary "$work/cron.json")" ;;
  401)
    # 사이트 앱의 401은 {"error":"unauthorized"} JSON이다. 그 밖의 401(HTML 로그인 화면)은 앱에 닿기 전에 Vercel 배포 보호가 막은 것
    if jq -e '.error == "unauthorized"' "$work/cron.json" >/dev/null 2>&1; then
      fail 1 "앵커 생성 요청 거부(HTTP 401, 사이트 응답): 이 저장소 environment anchor-cron의 CRON_SECRET이 사이트(Vercel) 환경변수 CRON_SECRET과 다릅니다."
    fi
    fail 1 "앵커 생성 요청이 사이트 코드에 닿기 전에 막혔습니다(HTTP 401, Vercel 로그인 화면으로 보임). Variables의 SITE_URL이 Vercel Settings → Domains의 운영 도메인인지, Settings → Deployment Protection이 Standard Protection인지 확인하세요."
    ;;
  3??) fail 1 "앵커 생성 요청이 다른 주소로 넘겨졌습니다(HTTP ${code}). Variables의 SITE_URL이 https://로 시작하는 운영 도메인(Vercel Settings → Domains)인지 확인하세요." ;;
  *) fail 1 "앵커 생성 요청 실패(HTTP ${code}): $(summary "$work/cron.json")" ;;
esac
