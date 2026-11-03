#!/usr/bin/env python3
"""앵커 문서 검증기(별도 구현) — 사이트(TypeScript) 코드를 쓰지 않고 같은 규칙을 Python으로 다시 구현한 것.

검사 항목(문서마다):
  1. 리프가 agent_id 오름차순이고 leaf_count가 리프 수와 같다
  2. RFC 6962 머클 루트를 다시 계산하면 merkle_root와 같다
     리프 데이터 = "agent_id|chain_length|head_hash", 리프 해시 = SHA-256(0x00‖데이터), 노드 = SHA-256(0x01‖왼‖오)
  3. keys.json의 checkpoint 공개키(지문 일치, 서명 시각이 유효기간 안)로
     "anchor-v1|date|merkle_root|prev_root|leaf_count" 서명(ECDSA P-256/SHA-256, DER base64)이 맞다
  4. 파일 이름의 날짜와 문서 날짜가 같다
  5. prev_root가 저장소의 바로 앞 앵커 루트와 같다(저장소 첫 문서는 건너뜀)

사용: python3 scripts/verify_anchor.py            # anchors/*.json 전체
      python3 scripts/verify_anchor.py --keys keys.json anchors/2026-11-02.json
필요: cryptography(저장소의 고정 목록으로 설치: python -m pip install --require-hashes -r requirements.txt)
"""
import argparse
import base64
import glob
import hashlib
import json
import os
import sys
from datetime import datetime

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


def leaf_hash(data: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + data).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def merkle_root(leaves: list) -> bytes:
    n = len(leaves)
    if n == 0:
        return hashlib.sha256(b"").digest()
    if n == 1:
        return leaf_hash(leaves[0])
    k = 1
    while k << 1 < n:  # n보다 작은 가장 큰 2의 거듭제곱
        k <<= 1
    return node_hash(merkle_root(leaves[:k]), merkle_root(leaves[k:]))


def parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def checkpoint_key(keys: dict, key_id: str, at: str):
    for k in keys.get("keys", []):
        if k.get("key_id") != key_id or k.get("purpose") != "checkpoint":
            continue
        pub = serialization.load_pem_public_key(k["public_key_pem"].encode())
        spki = pub.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        if hashlib.sha256(spki).hexdigest() != k.get("fingerprint"):
            raise ValueError(f"공개키 {key_id}의 지문이 keys.json 표기와 다릅니다")
        t = parse_time(at)
        if parse_time(k["created_at"]) > t:
            return None
        if k.get("retired_at") and parse_time(k["retired_at"]) < t:
            return None
        return pub
    return None


def verify_document(path: str, keys: dict, expected_prev_root):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    errors = []
    if d.get("version") != "anchor-v1":
        errors.append(f"알 수 없는 버전 {d.get('version')}")
    leaves = d.get("leaves", [])
    ids = [leaf["agent_id"].lower() for leaf in leaves]
    if ids != sorted(ids) or len(set(ids)) != len(ids):
        errors.append("리프가 agent_id 순으로 정렬돼 있지 않거나 같은 에이전트가 두 번 들어 있음")
    if d.get("leaf_count") != len(leaves):
        errors.append(f"leaf_count {d.get('leaf_count')} ≠ 리프 {len(leaves)}개")
    data = [f"{leaf['agent_id'].lower()}|{leaf['chain_length']}|{leaf['head_hash']}".encode() for leaf in sorted(leaves, key=lambda x: x["agent_id"].lower())]
    root = merkle_root(data).hex()
    if root != d.get("merkle_root"):
        errors.append(f"머클 루트 불일치(다시 계산 {root[:16]}…)")
    message = f"anchor-v1|{d['date']}|{d['merkle_root']}|{d.get('prev_root') or ''}|{d['leaf_count']}".encode()
    try:
        pub = checkpoint_key(keys, d.get("checkpoint_key_id", ""), d["created_at"])
    except ValueError as e:
        pub, errors = None, errors + [str(e)]
    if pub is None:
        errors.append(f"유효한 체크포인트 공개키 없음({d.get('checkpoint_key_id')})")
    else:
        try:
            signature = base64.b64decode(d.get("root_signature", ""), validate=True)
            pub.verify(signature, message, ec.ECDSA(hashes.SHA256()))
        except (InvalidSignature, ValueError):  # ValueError: base64·DER 형식 자체가 깨진 경우(binascii.Error 포함)
            errors.append("루트 서명이 맞지 않음")
    if os.path.basename(path) != f"{d.get('date')}.json":
        errors.append("파일 이름과 문서 날짜가 다름")
    if expected_prev_root is not None and d.get("prev_root") != expected_prev_root:
        errors.append(f"prev_root가 저장소 직전 루트({expected_prev_root[:16]}…)와 다름")
    return d, errors


def main() -> int:
    ap = argparse.ArgumentParser(description="SIGNALS 일일 앵커 검증(사이트 코드와 따로 만든 Python 구현)")
    ap.add_argument("files", nargs="*", help="검증할 앵커 파일(생략하면 anchors/*.json 전체)")
    ap.add_argument("--keys", default="keys.json")
    args = ap.parse_args()
    with open(args.keys, encoding="utf-8") as f:
        keys = json.load(f)
    files = sorted(args.files or glob.glob(os.path.join("anchors", "*.json")))
    failed, prev_root, prev_leaves = 0, None, None
    for i, path in enumerate(files):
        d, errors = verify_document(path, keys, prev_root if i > 0 else None)
        # 날짜 사이 대조: 어제 있던 에이전트가 사라지거나, 기록 수가 줄거나, 같은 길이인데 마지막 지문이 바뀌면 과거가 바뀐 것이다.
        # (사이트 코드에도 같은 검사가 있지만, 운영자가 그 코드를 우회해 앵커를 직접 넣으면 여기서만 잡힌다)
        cur = {leaf["agent_id"].lower(): leaf for leaf in d.get("leaves", [])}
        if prev_leaves is not None:
            for aid, old in prev_leaves.items():
                new = cur.get(aid)
                if new is None:
                    errors.append(f"에이전트 {aid[:8]}…가 직전 앵커에는 있었는데 사라짐")
                elif new["chain_length"] < old["chain_length"]:
                    errors.append(f"에이전트 {aid[:8]}…의 기록 수가 {old['chain_length']} → {new['chain_length']}로 줄어듦")
                elif new["chain_length"] == old["chain_length"] and new["head_hash"] != old["head_hash"]:
                    errors.append(f"에이전트 {aid[:8]}…의 기록 수는 같은데 마지막 지문이 바뀜")
        prev_root = d.get("merkle_root")
        prev_leaves = cur
        if errors:
            failed += 1
            print(f"[불일치] {path}: " + "; ".join(errors))
        else:
            print(f"[통과] {path}: 루트 {d['merkle_root'][:16]}… 리프 {d['leaf_count']}개, 서명 유효")
    print(f"검증 {len(files)}건, 불일치 {failed}건")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
