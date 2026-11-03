#!/usr/bin/env bash
# 커밋 뒤 비트코인 증명 점검. GitHub Actions(.github/workflows/anchor.yml)의 proofs job이 publish job의 커밋 뒤에 실행한다(bash만, 읽기 권한).
# 비트코인 고정 단계(ots-stamp.sh)는 캘린더 장애로 실패해도 앵커 커밋을 막지 않는다. 그래서 장애가 이어지거나 증명 파일이 깨져
# 완성되지 않아도 실행은 초록색으로 끝난다. 이 점검은 그런 증명을 찾으면 실패(종료 코드 1)로 끝나 실패 알림이 가게 한다.
#  - 문서 날짜가 이틀 전(KST) 이전인 앵커는 .json.ots가 있고 완성본(비트코인 블록 증명 태그가 든 파일)이어야 한다.
#    증명은 보통 몇 시간 안에 완성되므로, 이틀이면 그 사이 실행(하루 두 번)이 여러 번 갱신을 시도한 뒤다.
#  - 완성 여부는 태그 바이트로만 본다(ots-stamp.sh와 같은 기준). 증명 내용이 옳은지는 보지 않는다(누구나 ots로 확인할 수 있다).
#  - 이 점검이 실패해도 그 실행의 앵커 커밋은 이미 끝났다. 늦게 받아 온 날짜(그날 저장소에 받지 못한 앵커)는
#    받은 뒤 증명이 완성될 때까지 한두 번 실패로 보일 수 있다.
# 시험용: PROOF_TODAY(오늘 날짜 YYYY-MM-DD, 기본은 KST 오늘)
set -euo pipefail
shopt -s nullglob
# 비트코인 블록 증명 태그. ots-stamp.sh·accept-files.sh와 같은 값이다(한쪽을 바꾸면 같이 바꾼다).
btc_tag=$'\x05\x88\x96\x0d\x73\xd7\x19\x01'
today="${PROOF_TODAY:-$(TZ=Asia/Seoul date +%F)}"
cutoff="$(date -u -d "$today -2 days" +%F)"

bad=()
complete=0
young=0
for f in anchors/*.json; do
  d="$(basename "$f" .json)"
  if [ -f "$f.ots" ] && LC_ALL=C grep -qaF -- "$btc_tag" "$f.ots"; then complete=$((complete + 1)); continue; fi
  # 이틀이 안 된 앵커는 아직 대기 중이어도 정상이다
  if [[ "$d" > "$cutoff" ]]; then young=$((young + 1)); continue; fi
  if [ -f "$f.ots" ]; then bad+=("$f.ots(미완성)"); else bad+=("$f.ots(없음)"); fi
done
echo "비트코인 증명: 완성 ${complete}건, 이틀이 안 된 대기 중·스탬프 전 ${young}건"
if [ "${#bad[@]}" -gt 0 ]; then
  echo "::error::앵커는 이미 커밋됐습니다. 문서 날짜가 ${cutoff} 이전인 앵커 중 비트코인 증명이 완성되지 않은 것 ${#bad[@]}건: ${bad[*]}"
  exit 1
fi
