#!/usr/bin/env bash
# 쓰기 권한이 있는 publish job에서, check job이 넘긴 파일을 확인한 뒤 이 저장소 작업 폴더에 옮긴다(커밋은 워크플로의 다음 단계).
# check job에서는 PyPI 패키지(검증기·ots)가 돌았으므로 넘겨받은 파일을 그대로 믿지 않는다.
#  - 이름: keys.json, anchors/YYYY-MM-DD.json, anchors/YYYY-MM-DD.json.ots인 일반 파일만 받는다. 그 밖의 것(링크·다른 이름)이 있으면 실패.
#  - 이 저장소에 이미 있는 앵커(.json)는 한 바이트라도 다르면 실패한다(고정된 앵커는 다시 쓰지 않는다).
#  - 새 앵커(.json)와 keys.json은 이 job이 사이트에서 직접 다시 받아 pull-anchor.sh와 같은 방식(jq -S)으로 맞춘 내용과 같아야 한다.
#    그래서 커밋하는 앵커·공개키는 사이트가 주는 그대로이고, check job의 검증기가 확인한 내용과도 같다.
#  - .ots: OpenTimestamps 파일 머리로 시작하고 그 안에 적힌 문서 지문(SHA-256)이 같은 날짜 .json과 맞는 1MB 이하 파일만 받는다.
#    이미 있는 증명은 대기 중→완성본(비트코인 블록 증명 태그가 생긴 것)으로만 바꾼다(옛 실행의 Re-run이 완성본을 되돌리지 않게).
#    증명 내용(캘린더·비트코인 블록)은 여기서 보지 않는다(Python·PyPI를 쓰지 않기 위해). 누구나 ots로 확인할 수 있다.
# 파일을 지우지는 않는다(넘겨받지 못한 파일은 저장소에 있던 그대로 둔다).
# 사용: bash scripts/accept-files.sh <넘겨받은 파일 폴더>   필요: 환경변수 SITE_URL / 도구: curl, jq, cmp, od, sha256sum, grep(러너 기본 설치)
set -euo pipefail
in="${1:?check job이 넘긴 파일 폴더가 필요합니다}"
: "${SITE_URL:?SITE_URL이 필요합니다}"
SITE_URL="${SITE_URL%/}"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

fail() { echo "::error::$1"; exit 1; }
# 파일 이름을 로그에 찍을 때 줄바꿈·제어 문자가 그대로 나가지 않게 따옴표 형태로 바꾼다
q() { printf '%q' "$1"; }
# pull-anchor.sh의 get()과 같은 방식으로 받는다(일시 오류는 5초 간격으로 3번 더, 파이프가 아니라 파일로 받은 뒤 jq -S).
# 한쪽을 바꾸면 다른 쪽도 같이 바꾼다(같은 바이트가 나와야 아래 cmp가 맞는다).
site() {
  rm -f -- "$work/site.raw"
  curl -f --no-progress-meter --retry 3 --retry-all-errors --retry-delay 5 --max-time 30 -o "$work/site.raw" "${SITE_URL}$1" &&
    jq -e -S '.' "$work/site.raw"
}

{ [ -d "$in" ] && [ ! -L "$in" ]; } || fail "넘겨받은 파일 폴더가 없습니다: $(q "$in")"
{ [ ! -L anchors ] && { [ ! -e anchors ] || [ -d anchors ]; }; } || fail "작업 폴더의 anchors가 일반 폴더가 아닙니다."

# 1) 이름·종류 확인(내용을 보기 전에 전부 본다)
has_keys=0
jsons=()
otss=()
while IFS= read -r -d '' entry; do
  kind="${entry%% *}"
  rel="${entry#* }"
  case "$kind" in
    d)
      [ "$rel" = anchors ] || fail "넘겨받은 파일에 예상하지 못한 폴더가 있습니다: $(q "$rel")"
      continue
      ;;
    f) ;;
    *) fail "넘겨받은 파일에 일반 파일이 아닌 것(링크 등)이 있습니다: $(q "$rel")" ;;
  esac
  if [ "$rel" = keys.json ]; then
    has_keys=1
  elif [[ "$rel" =~ ^anchors/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json$ ]]; then
    jsons+=("$rel")
  elif [[ "$rel" =~ ^anchors/[0-9]{4}-[0-9]{2}-[0-9]{2}\.json\.ots$ ]]; then
    otss+=("$rel")
  else
    fail "넘겨받은 파일에 예상하지 못한 이름이 있습니다: $(q "$rel")"
  fi
done < <(find "$in" -mindepth 1 -printf '%y %P\0')
[ "$has_keys" = 1 ] || fail "넘겨받은 파일에 keys.json이 없습니다."

# 2) 공개키 목록: 이 job이 사이트에서 다시 받은 것과 같아야 한다
site /keys.json > "$work/keys.json" ||
  fail "사이트에서 keys.json을 다시 받지 못했습니다. 커밋되지 않았습니다. 사이트 /api/health를 확인한 뒤 Run workflow로 다시 실행하세요."
cmp -s "$work/keys.json" "$in/keys.json" ||
  fail "넘겨받은 keys.json이 사이트의 /keys.json과 다릅니다(넘겨받는 사이에 바뀜). Run workflow로 다시 실행하세요."

# 3) 앵커 문서: 저장소에 있는 날짜는 그대로여야 하고, 새 날짜는 사이트에서 다시 받은 것과 같아야 한다
new_jsons=()
for rel in "${jsons[@]}"; do
  d="$(basename "$rel" .json)"
  if [ -e "$rel" ]; then
    cmp -s "$in/$rel" "$rel" || fail "${d} 앵커가 이 저장소에 고정된 내용과 다릅니다(넘겨받은 파일이 바뀜)."
    continue
  fi
  site "/api/anchors/${d}" > "$work/${d}.json" ||
    fail "사이트에서 ${d} 앵커를 다시 받지 못했습니다. 커밋되지 않았습니다. 사이트 /api/health를 확인한 뒤 Run workflow로 다시 실행하세요."
  cmp -s "$work/${d}.json" "$in/$rel" ||
    fail "새 ${d} 앵커가 사이트의 문서와 다릅니다(넘겨받는 사이에 바뀜). Run workflow로 다시 실행하세요."
  new_jsons+=("$rel")
done

# 4) OpenTimestamps 증명: 파일 머리(31바이트) 뒤에 버전 1(0x01), 문서 해시 SHA-256(0x08), 문서의 SHA-256 32바이트가 온다
printf '\000OpenTimestamps\000\000Proof\000\277\211\342\350\204\350\222\224' > "$work/magic"
# 비트코인 블록 증명 태그. ots-stamp.sh·proof-age.sh와 같은 값이다(한쪽을 바꾸면 같이 바꾼다).
btc_tag=$'\x05\x88\x96\x0d\x73\xd7\x19\x01'
changed_ots=()
for rel in "${otss[@]}"; do
  doc="${rel%.ots}"
  if [ -f "$in/$doc" ]; then docfile="$in/$doc"; elif [ -f "$doc" ]; then docfile="$doc"; else fail "증명에 맞는 앵커 문서가 없습니다: $(q "$rel")"; fi
  [ "$(wc -c < "$in/$rel")" -le 1048576 ] || fail "1MB보다 큰 증명 파일입니다: $(q "$rel")"
  cmp -s -n 31 "$work/magic" "$in/$rel" || fail "OpenTimestamps 증명 파일 형식이 아닙니다: $(q "$rel")"
  [ "$(od -An -v -tx1 -j 31 -N 34 "$in/$rel" | tr -d ' \n')" = "0108$(sha256sum < "$docfile" | cut -d' ' -f1)" ] ||
    fail "증명에 적힌 문서 지문이 앵커 문서와 맞지 않습니다: $(q "$rel")"
  if [ -f "$rel" ] && cmp -s "$in/$rel" "$rel"; then continue; fi
  # 증명은 한 방향으로만 바꾼다(없음→새 증명, 대기 중→완성본). 오래된 실행을 'Re-run failed jobs'로 다시 돌리면
  # 그 실행의 check job이 남긴(하루 보관) 옛 증명이 넘어오므로, 완성본을 되돌리거나 대기 중 증명끼리 바꾸지 않는다.
  # (태그 바이트만 보므로 check job에서 만든 가짜 완성본까지 걸러 내지는 못한다. 위 머리말의 '증명 내용은 보지 않는다'와 같은 한계)
  if [ -f "$rel" ]; then
    if LC_ALL=C grep -qaF -- "$btc_tag" "$rel"; then
      echo "::warning::이미 완성된 증명은 바꾸지 않습니다(저장소 사본 유지. 옛 실행을 Re-run했거나 check job에서 파일이 바뀜): $(q "$rel")"
      continue
    fi
    if ! LC_ALL=C grep -qaF -- "$btc_tag" "$in/$rel"; then
      echo "대기 중 증명끼리는 바꾸지 않습니다(저장소 사본 유지): $(q "$rel")"
      continue
    fi
  fi
  changed_ots+=("$rel")
done

# 5) 모두 확인한 뒤에만 옮긴다(링크로 된 자리에는 쓰지 않는다)
mkdir -p anchors # 앵커가 하나도 없는 첫 실행에도 다음 단계의 git add anchors가 실패하지 않게
for rel in keys.json "${new_jsons[@]}" "${changed_ots[@]}"; do
  [ ! -L "$rel" ] || fail "작업 폴더의 이 자리가 링크라 덮어쓰지 않습니다: $(q "$rel")"
done
cp -- "$work/keys.json" keys.json
for rel in "${new_jsons[@]}"; do
  d="$(basename "$rel" .json)"
  cp -- "$work/${d}.json" "$rel"
  echo "새 앵커: $rel"
done
for rel in "${changed_ots[@]}"; do
  cp -- "$in/$rel" "$rel"
  echo "증명 반영: $rel"
done
echo "넘겨받은 파일 확인 끝: 새 앵커 ${#new_jsons[@]}개, 바뀐 증명 ${#changed_ots[@]}개, keys.json 사이트와 같음"
