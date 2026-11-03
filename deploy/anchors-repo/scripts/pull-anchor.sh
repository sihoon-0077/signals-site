#!/usr/bin/env bash
# 사이트 → 공개 앵커 저장소 미러링과 대조. GitHub Actions(.github/workflows/anchor.yml)의 check job이 매일 실행한다.
# 오늘 앵커 생성 요청은 앞 job이 따로 한다(scripts/request-anchor.sh). 이 스크립트는 비밀값 없이 사이트의 공개 주소만 읽는다
# (이 job에서는 뒤에 PyPI 패키지가 돌므로 비밀값을 두지 않는다).
#  1) 공개키 목록: 이 저장소에 있는 키가 사이트에서 사라지거나 바뀌면(이미 적힌 폐기 시각 포함) 실패하고 덮어쓰지 않는다. 새 키는 추가된다.
#  2) 앵커 목록: 저장소에 있는 날짜의 문서가 사이트와 다르거나 사이트에서 사라졌으면 실패(덮어쓰지 않음).
#     저장소에 없는 날짜는 받아서 저장한다.
# 사이트에서 받는 요청(GET)은 일시 오류면 5초 간격으로 3번 더 받고, 그래도 못 받으면 종료 코드 1로 끝난다.
# 실패하면 워크플로가 커밋하지 않는다(공개키·과거 앵커 경보는 종료 코드 2). 실패한 실행은 Actions 탭에 공개로 보이지만
# GitHub 보관 기간(공개 저장소 최대 90일)이 지나면 지워지고 저장소 관리자도 지울 수 있다.
# 필요: 환경변수 SITE_URL / 도구: curl, jq(러너 기본 설치라 Python 설치보다 먼저 돌 수 있다)
set -euo pipefail
fail() { echo "::error::$2"; exit "$1"; }
[ -n "${SITE_URL:-}" ] || fail 1 "SITE_URL이 없습니다. 저장소 Settings → Secrets and variables → Actions → Variables에 운영 도메인을 넣으세요."
SITE_URL="${SITE_URL%/}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

# 사이트 GET(다시 보내도 안전): 일시 오류는 5초 간격으로 3번 더 받는다. 파이프가 아니라 파일(-o)로 받는다:
# curl은 재시도 전에 받다 만 내용을 일반 파일에서만 지운다(파이프면 끊긴 응답 뒤에 재시도 응답이 이어 붙어 거짓 '과거 변경'이 된다).
# 받은 JSON은 jq -S로 맞춰 저장한다. 커밋 직전에 accept-files.sh의 site()가 같은 방식으로 다시 받아 바이트 단위로 대조하므로 함께 바꾼다.
# jq -e: 빈 응답(200이지만 본문 없음)을 빈 파일로 저장해 거짓 '키 바꿔치기' 경보를 내지 않게 여기서 실패시킨다.
get() { # $1 사이트 경로, $2 저장할 파일
  rm -f -- "$work/get.raw"
  curl -f --no-progress-meter --retry 3 --retry-all-errors --retry-delay 5 --max-time 30 -o "$work/get.raw" "${SITE_URL}$1" ||
    fail 1 "사이트에서 $1을(를) 받지 못했습니다(4번 시도). 사이트 /api/health를 확인한 뒤 Run workflow로 다시 실행하세요."
  jq -e -S '.' "$work/get.raw" > "$2" ||
    fail 1 "사이트의 $1 응답이 JSON 문서가 아닙니다(빈 응답 등). 사이트 /api/health를 확인한 뒤 Run workflow로 다시 실행하세요."
}

today="$(TZ=Asia/Seoul date +%F)"

# 1) 공개키: 이 저장소에 이미 있는 키가 사이트에서 사라지거나 바뀌면 실패하고 keys.json을 덮어쓰지 않는다
#    (새 키 추가와 retired_at을 새로 적는 것만 반영). 저장소 관리자가 이 파일을 직접 고치는 것은 막지 못한다(커밋 기록에 남음).
get /keys.json "$work/keys.json"
if [ -f keys.json ]; then
  for id in $(jq -r '.keys[].key_id' keys.json); do
    pick='.keys[] | select(.key_id == $id) | {purpose, algorithm, public_key_pem, fingerprint, created_at}'
    old=$(jq -c --arg id "$id" "$pick" keys.json)
    new=$(jq -c --arg id "$id" "$pick" "$work/keys.json")
    [ "$old" = "$new" ] || fail 2 "공개키 ${id}가 사이트에서 사라졌거나 바뀌었습니다(키 바꿔치기 의심)."
    # 이미 적힌 폐기 시각이 지워지거나 바뀌면 폐기한 키를 되살리는 것과 같다 → 같이 막는다(새로 적는 것만 허용)
    ret='.keys[] | select(.key_id == $id) | .retired_at // ""'
    old_ret=$(jq -r --arg id "$id" "$ret" keys.json)
    [ -z "$old_ret" ] || [ "$old_ret" = "$(jq -r --arg id "$id" "$ret" "$work/keys.json")" ] ||
      fail 2 "공개키 ${id}의 폐기 시각(retired_at)이 사이트에서 지워지거나 바뀌었습니다."
  done
fi
cp "$work/keys.json" keys.json

# 2) 앵커 목록 대조와 미러링
get /api/anchors "$work/list.json"
mkdir -p anchors
shopt -s nullglob
for f in anchors/*.json; do
  d="$(basename "$f" .json)"
  site_root=$(jq -r --arg d "$d" '.anchors[] | select(.date == $d) | .merkle_root' "$work/list.json")
  [ -n "$site_root" ] || fail 2 "${d} 앵커가 사이트에서 사라졌습니다."
  [ "$site_root" = "$(jq -r '.merkle_root' "$f")" ] || fail 2 "${d} 앵커 루트가 저장소에 고정된 값과 다릅니다(과거 변경)."
  # 목록의 루트 값만 보면, 루트 열은 그대로 두고 문서 본문(리프·서명·시각)만 바꾼 경우를 놓친다 → 문서 전체를 다시 받아 비교한다
  get "/api/anchors/${d}" "$work/recheck.json"
  cmp -s "$work/recheck.json" <(jq -S '.' "$f") || fail 2 "${d} 앵커 문서가 저장소에 고정된 내용과 다릅니다(과거 변경)."
done
added=0
for d in $(jq -r '.anchors[].date' "$work/list.json"); do
  # 사이트가 준 날짜를 주소·파일 이름에 넣기 전에 실제 달력 날짜인지 본다(GNU date가 2월 30일 같은 값을 거부)
  [[ "$d" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [ "$(date -u -d "$d" +%F 2>/dev/null)" = "$d" ] || fail 1 "잘못된 날짜 형식: $d"
  # 앵커는 그날(KST)에만 만들어지므로 오늘보다 늦은 날짜는 있을 수 없다 → 받아 두지 않고 경보로 남긴다
  if [[ "$d" > "$today" ]]; then fail 2 "사이트 목록에 오늘(KST ${today})보다 늦은 날짜의 앵커(${d})가 있습니다."; fi
  [ -f "anchors/${d}.json" ] && continue
  get "/api/anchors/${d}" "anchors/${d}.json"
  echo "저장: anchors/${d}.json"
  added=$((added + 1))
done
# ls로 세면 파일이 하나도 없을 때(nullglob) 현재 폴더 전체를 센다 → 배열로 센다
saved=(anchors/*.json)
echo "새로 저장한 앵커 ${added}개, 저장소 전체 ${#saved[@]}개"

# 빠진 날 알림: 어제(KST) 앵커가 없으면(첫 앵커 이전은 제외) 경고로 남긴다.
# 앵커는 그날에만 만들 수 있어 빠진 날은 나중에 채우지 않으며, 그 사이 기록은 다음 앵커에 담긴다.
yday="$(date -u -d "${today} -1 day" +%F)"
if jq -e --arg y "$yday" 'any(.anchors[]; .date < $y) and (any(.anchors[]; .date == $y) | not)' "$work/list.json" >/dev/null; then
  echo "::warning::${yday} 앵커가 없습니다(그날 만들지 못한 날은 나중에 채우지 않고 빈 날로 남습니다). 그 사이 기록은 다음 앵커에 담깁니다."
fi
