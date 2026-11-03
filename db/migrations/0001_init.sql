-- SIGNALS 1R 사이트 스키마.
-- 테이블·컬럼 이름은 03 설계 §5에 맞춘다(나중에 기존 코드베이스로 옮길 때 그대로 쓰도록).
-- 원칙: 봉인 기록(signals)과 증거 테이블은 수정·삭제·비우기를 DB가 거부한다.
--       공개·청산 같은 상태 변화는 원본을 고치지 않고 이벤트 테이블에 덧붙인다.

CREATE OR REPLACE FUNCTION raise_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable table: % (% is blocked)', TG_TABLE_NAME, TG_OP;
END $$;

-- 공급자 사전등록. email은 비공개(공개 화면에 내보내지 않는다).
CREATE TABLE providers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle                TEXT NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9][a-z0-9-]{2,29}$'),
  pen_name              TEXT NOT NULL CHECK (char_length(pen_name) BETWEEN 1 AND 30),
  email                 TEXT NOT NULL UNIQUE,
  strategy_type         TEXT NOT NULL CHECK (strategy_type IN ('RULE', 'ML', 'LLM', 'DISCRETIONARY')),
  market                TEXT NOT NULL DEFAULT 'KR_STOCK' CHECK (market IN ('KR_STOCK', 'US_STOCK', 'OTHER')),
  holding_style         TEXT NOT NULL CHECK (holding_style IN ('SWING', 'POSITION', 'DAY')),
  description           TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  channels              JSONB NOT NULL DEFAULT '[]'::jsonb,
  has_sold_before       BOOLEAN NOT NULL DEFAULT false,
  has_filed_advisory    BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  referral_code         TEXT NOT NULL UNIQUE,
  referred_by           UUID REFERENCES providers(id),
  consent_privacy_at    TIMESTAMPTZ NOT NULL,
  consent_marketing_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at           TIMESTAMPTZ
);

-- 에이전트. provider_id가 없으면 플랫폼 운영 에이전트(전체의 20% 상한, 화면에 '플랫폼 운영' 표시).
CREATE TABLE agents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        UUID REFERENCES providers(id),
  slug               TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  is_platform_owned  BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'VERIFYING' CHECK (status IN ('VERIFYING', 'ACTIVE', 'TERMINATED')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (is_platform_owned = (provider_id IS NULL))
);

-- 봉인된 시그널(정규 직렬화 v2, 03 §5.1·§6.1). 한 번 쓰면 바꾸거나 지울 수 없다.
CREATE TABLE signals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id           UUID NOT NULL REFERENCES agents(id),
  sequence_no        INTEGER NOT NULL CHECK (sequence_no >= 1),
  canonical_version  SMALLINT NOT NULL DEFAULT 2,
  market             TEXT NOT NULL,
  ticker             TEXT NOT NULL,
  side               TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  action             TEXT NOT NULL CHECK (action IN ('ENTRY', 'EXIT')),
  target_price       NUMERIC(18, 4),
  stop_loss_price    NUMERIC(18, 4),
  suggested_weight   NUMERIC(18, 4),
  max_holding_days   INTEGER,
  valid_until        TIMESTAMPTZ,
  is_paper           BOOLEAN NOT NULL,
  entry_signal_id    UUID REFERENCES signals(id),
  rule_version       TEXT NOT NULL,
  nonce              CHAR(32) NOT NULL,
  rationale          TEXT NOT NULL DEFAULT '',
  published_at       TIMESTAMPTZ NOT NULL,
  prev_hash          CHAR(64) NOT NULL,
  content_hash       CHAR(64) NOT NULL UNIQUE,
  signature          TEXT NOT NULL,
  key_id             TEXT NOT NULL,
  UNIQUE (agent_id, sequence_no)
);
CREATE TRIGGER signals_no_update   BEFORE UPDATE   ON signals FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER signals_no_delete   BEFORE DELETE   ON signals FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER signals_no_truncate BEFORE TRUNCATE ON signals FOR EACH STATEMENT EXECUTE FUNCTION raise_immutable();

-- 시그널별 RFC 3161 토큰(진입가 기준 시각, 03 §5.2·§7.2).
CREATE TABLE signal_timestamps (
  signal_id  UUID NOT NULL REFERENCES signals(id),
  tsa        TEXT NOT NULL,
  token      BYTEA NOT NULL,
  gen_time   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (signal_id, tsa)
);
CREATE TRIGGER signal_timestamps_no_update   BEFORE UPDATE   ON signal_timestamps FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER signal_timestamps_no_delete   BEFORE DELETE   ON signal_timestamps FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER signal_timestamps_no_truncate BEFORE TRUNCATE ON signal_timestamps FOR EACH STATEMENT EXECUTE FUNCTION raise_immutable();

-- 청산·만료·무효 이벤트. 이벤트가 있으면 원문을 공개한다(공개 시점을 규칙으로 고정, 03 §7.1).
CREATE TABLE signal_events (
  signal_id    UUID PRIMARY KEY REFERENCES signals(id),
  event        TEXT NOT NULL CHECK (event IN ('CLOSED', 'EXPIRED', 'VOID')),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  note         TEXT NOT NULL DEFAULT ''
);
CREATE TRIGGER signal_events_no_update   BEFORE UPDATE   ON signal_events FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER signal_events_no_delete   BEFORE DELETE   ON signal_events FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER signal_events_no_truncate BEFORE TRUNCATE ON signal_events FOR EACH STATEMENT EXECUTE FUNCTION raise_immutable();

-- 일일 체크포인트(에이전트별 체인 길이·마지막 지문, 03 §5.2). 종료된 에이전트도 포함한다.
CREATE TABLE chain_checkpoints (
  checkpoint_date  DATE NOT NULL,
  agent_id         UUID NOT NULL REFERENCES agents(id),
  chain_length     INTEGER NOT NULL CHECK (chain_length >= 0),
  head_hash        CHAR(64) NOT NULL,
  PRIMARY KEY (checkpoint_date, agent_id)
);
CREATE TRIGGER chain_checkpoints_no_update   BEFORE UPDATE   ON chain_checkpoints FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER chain_checkpoints_no_delete   BEFORE DELETE   ON chain_checkpoints FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER chain_checkpoints_no_truncate BEFORE TRUNCATE ON chain_checkpoints FOR EACH STATEMENT EXECUTE FUNCTION raise_immutable();

-- 일일 앵커(머클 루트·서명·루트 타임스탬프). 문서 전체(JSON)를 함께 보관해 공개 API와 GitHub에 그대로 내보낸다.
CREATE TABLE anchor_records (
  checkpoint_date    DATE PRIMARY KEY,
  merkle_root        CHAR(64) NOT NULL,
  leaf_count         INTEGER NOT NULL,
  prev_root          CHAR(64),
  root_signature     TEXT NOT NULL,
  checkpoint_key_id  TEXT NOT NULL,
  document           JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER anchor_records_no_update   BEFORE UPDATE   ON anchor_records FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER anchor_records_no_delete   BEFORE DELETE   ON anchor_records FOR EACH ROW       EXECUTE FUNCTION raise_immutable();
CREATE TRIGGER anchor_records_no_truncate BEFORE TRUNCATE ON anchor_records FOR EACH STATEMENT EXECUTE FUNCTION raise_immutable();

-- 추천 링크 유입 기록(공급자 홍보 효과 측정). 개인정보는 남기지 않는다.
CREATE TABLE referral_visits (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT NOT NULL,
  path        TEXT NOT NULL,
  visited_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX referral_visits_code_idx ON referral_visits (code);
