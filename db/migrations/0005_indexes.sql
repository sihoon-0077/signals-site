-- 0005: 조회 인덱스. 행을 바꾸지 않으므로 봉인 기록 불변 트리거와 무관하고, 첫 발행 전후 언제 적용해도 된다.
-- 마이그레이션 실행기(src/server/migrate.ts)가 파일마다 트랜잭션으로 감싸므로 CONCURRENTLY는 쓸 수 없다(표가 작아 잠금은 순간).

-- 1) 청산(EXIT) → 진입 찾기: 공개 여부(exit_anchored) 계산, 발행 때 '이미 청산된 진입' 확인.
--    없으면 시그널 행마다 signals 전체를 다시 훑어, 매일 앵커 검사 시간이 기록 수의 제곱으로 늘어난다.
CREATE INDEX signals_entry_signal_id_idx ON signals (entry_signal_id);

-- 2) 에이전트별 최대 체인 길이(앵커 포함 여부)와 이 기록을 처음 담은 앵커 찾기.
--    기본 키가 (checkpoint_date, agent_id)라 agent_id로 시작하는 인덱스가 없었다.
CREATE INDEX chain_checkpoints_agent_len_idx ON chain_checkpoints (agent_id, chain_length);

-- 3) 공급자별 에이전트(외래키 인덱스, Supabase 점검 'unindexed foreign keys' 정리)
CREATE INDEX agents_provider_id_idx ON agents (provider_id);
