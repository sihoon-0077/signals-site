-- 0003: 리뷰 반영 운영 보강.

-- 1) 추천 링크 방문: 요청마다 행을 쌓으면 누구나 무한히 INSERT해 DB 용량을 채우고 방문 수를 부풀릴 수 있다.
--    (코드, 날짜, 경로 종류)별 카운터로 집계해 행 수에 상한을 두고, 하루 집계에도 상한을 둔다(앱에서 LEAST).
CREATE TABLE referral_daily (
  code       TEXT NOT NULL,
  day        DATE NOT NULL,
  path_kind  TEXT NOT NULL CHECK (path_kind IN ('profile', 'join', 'other')),
  visits     INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0),
  PRIMARY KEY (code, day, path_kind)
);
ALTER TABLE referral_daily ENABLE ROW LEVEL SECURITY;
INSERT INTO referral_daily (code, day, path_kind, visits)
SELECT code,
       (visited_at + interval '9 hours')::date,
       CASE WHEN path LIKE '/p/%' THEN 'profile' WHEN path LIKE '/providers/join%' THEN 'join' ELSE 'other' END,
       LEAST(count(*), 10000)
  FROM referral_visits
 GROUP BY 1, 2, 3;

-- 2) 관리자 목록의 추천 집계가 행마다 전체 스캔하지 않도록
CREATE INDEX providers_referred_by_idx ON providers (referred_by);

-- 3) 인터뷰 요청은 등록에 필요한 처리가 아니므로 필수 동의에서 떼어 선택 동의로 기록한다
ALTER TABLE providers ADD COLUMN consent_interview_at TIMESTAMPTZ;

-- 4) 트리거 함수의 search_path 고정(내장 기능만 쓰므로 안전). Supabase 보안 점검의 'search_path 가변' 경고를 없앤다.
ALTER FUNCTION raise_immutable() SET search_path = '';

-- 5) Supabase에서는 public 스키마 테이블에 anon·authenticated 권한이 기본으로 붙는다.
--    앞으로 만들 테이블까지 권한을 주지 않게 하고, 지금 있는 권한도 거둔다(RLS와 이중 방어). 역할이 없는 DB에서는 건너뛴다.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
  END IF;
END $$;
