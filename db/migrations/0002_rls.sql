-- 행 수준 보안(RLS) 켜기. 정책은 일부러 하나도 만들지 않는다.
-- 이유: Supabase는 public 스키마의 테이블을 REST API(PostgREST)로 자동 공개한다. RLS가 꺼져 있으면
--       프로젝트의 anon 키만으로 providers(이메일 포함)를 읽고 쓸 수 있다.
--       RLS를 켜고 정책을 두지 않으면 anon·authenticated 역할은 아무것도 못 하고,
--       이 앱이 쓰는 테이블 소유자(postgres) 연결만 지금처럼 동작한다(소유자는 RLS를 우회).
-- 일반 PostgreSQL·PGlite에서도 소유자로 접속하므로 동작이 바뀌지 않는다.
-- schema_migrations는 실행기(src/server/migrate.ts)가 만들고 RLS도 직접 켠다. 실행기 없이(SQL Editor 등) 적용해도 멈추지 않게 IF EXISTS.
ALTER TABLE IF EXISTS schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_timestamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE chain_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE anchor_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_visits ENABLE ROW LEVEL SECURITY;
