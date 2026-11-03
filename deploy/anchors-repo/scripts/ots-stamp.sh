#!/usr/bin/env bash
# OpenTimestamps: 아직 스탬프가 없는 앵커는 비트코인 고정을 요청하고, 대기 중인 증명은 완성본으로 갱신한다.
# ots 동작(0.7.2 소스 확인):
#  - upgrade는 여러 파일을 한 번에 주면 첫 '대기 중' 파일에서 종료 코드 1로 멈춘다 → 파일마다 따로 부른다.
#  - upgrade로 내용이 바뀌면 .ots.bak을 남기고, .bak이 이미 있으면 실패한다 → 매번 지운다.
#  - 비트코인 블록에 들어가기 전(보통 수 시간)에는 '대기 중'이라 1로 끝나는 것이 정상이다.
#  - upgrade는 캘린더 요청에 시간 제한이 없다(get_timestamp(timeout=None)이라 socket.setdefaulttimeout으로도 못 막는다).
#    연결은 받고 답하지 않는 캘린더 하나가 작업 전체를 멈추지 않게 호출마다 60초로 끊고, 새 호출은 시작 후 150초까지만 시작한다.
#    워크플로 단계 상한(5분)보다 먼저 스스로 끝나야, 끊긴 ots가 남아 파일을 고치는 동안 다음 단계(커밋할 파일 넘기기)가 돌지 않는다.
# 캘린더 서버 장애로 stamp·upgrade가 실패하거나 끊겨도 앵커 커밋은 막지 않는다(다음 실행 때 다시 시도).
# 그런 실패가 이틀 넘게 이어지면 커밋 뒤 증명 점검(scripts/proof-age.sh)이 실행을 실패로 표시한다.
# 시험용: OTS_CALL_TIMEOUT(호출 하나의 상한 초, 기본 60), OTS_BUDGET(새 호출을 시작하는 상한 초, 기본 150)
set -euo pipefail
shopt -s nullglob
per_call="${OTS_CALL_TIMEOUT:-60}"
budget="${OTS_BUDGET:-150}"
deadline=$((SECONDS + budget))
# 비트코인 블록 증명(BitcoinBlockHeaderAttestation)의 태그 바이트. 이것이 든 .ots는 완성본이라 upgrade도 캘린더에 묻지 않고 끝난다
# → 부르지 않고 완료로 센다(완성본이 날마다 쌓여도 시간 상한을 쓰지 않게).
btc_tag=$'\x05\x88\x96\x0d\x73\xd7\x19\x01'
late=0

for f in anchors/*.json; do
  [ -f "$f.ots" ] && continue
  if [ "$SECONDS" -ge "$deadline" ]; then late=$((late + 1)); continue; fi
  # -k 5: 60초에 끊어도 끝나지 않으면 5초 뒤 강제 종료
  if timeout -k 5 "$per_call" ots stamp "$f"; then
    echo "스탬프 요청: $f"
  else
    # 끊긴 stamp가 쓰다 만 .ots를 남겼으면 지운다(다음 실행이 '이미 있음'으로 건너뛰어 깨진 증명이 남지 않게)
    rm -f -- "$f.ots"
    echo "::warning::스탬프 실패(다음 실행 때 재시도): $f"
  fi
done

complete=0
pending=0
stalled=0
for p in anchors/*.json.ots; do
  if LC_ALL=C grep -qaF -- "$btc_tag" "$p"; then complete=$((complete + 1)); continue; fi
  if [ "$SECONDS" -ge "$deadline" ]; then late=$((late + 1)); continue; fi
  rc=0
  out="$(timeout -k 5 "$per_call" ots upgrade "$p" 2>&1)" || rc=$?
  timed_out=0
  case "$rc" in 124 | 137) timed_out=1 ;; esac # 124: 60초에 끊음, 137: 그래도 안 끝나 강제 종료
  if [ "$rc" -eq 0 ]; then complete=$((complete + 1)); else pending=$((pending + 1)); fi
  if [ "$timed_out" -eq 1 ]; then
    stalled=$((stalled + 1))
    echo "::warning::증명 갱신이 ${per_call}초 안에 끝나지 않아 끊었습니다(응답 없는 캘린더로 보임, 다음 실행 때 재시도): $p"
  elif [ "$rc" -ne 0 ] && ! grep -qF 'Timestamp not complete' <<< "$out"; then
    # 정상적인 대기 중은 'Failed! Timestamp not complete'로 끝난다. 그 밖의 실패(깨진 증명 파일 등)는 다음 실행에도 낫지 않으므로
    # ots가 남긴 마지막 줄을 경고로 남긴다(이틀이 지나도 완성되지 않으면 커밋 뒤 증명 점검이 실행을 실패로 표시한다).
    echo "::warning::증명 갱신 실패(대기 중이 아님): $p: $(tail -n 1 <<< "$out" | tr -d '\r' | cut -c 1-200)"
  fi
  # .bak이 있으면 ots가 원래 증명을 .bak으로 바꾸고 새 파일을 쓰기 시작했다는 뜻이다. 쓰는 도중에 끊겼거나
  # 새 파일이 온전하지 않으면 원래 증명을 되돌린다(.ots가 빠지거나 쓰다 만 채로 커밋되지 않게). 온전하면 .bak만 지운다.
  if [ -f "$p.bak" ]; then
    if [ "$timed_out" -eq 1 ] || ! timeout 30 ots info "$p" >/dev/null 2>&1; then mv -f -- "$p.bak" "$p"; fi
    rm -f -- "$p.bak"
  fi
done

summary="비트코인 고정 완료 ${complete}건, 대기 중 ${pending}건"
[ "$stalled" -eq 0 ] || summary+="(그중 시간 초과 ${stalled}건)"
echo "$summary"
if [ "$late" -gt 0 ]; then echo "::warning::시간 상한(${budget}초)이 지나 이번에 건너뛴 파일 ${late}건(다음 실행 때 처리)"; fi
