-- 0004: 공급자 사전등록 개인정보·남용 대비 보강. 운영 DB를 만들기 전이라 지금 바꾸는 것이 가장 싸다.

-- 1) 판매 경험·신고 여부 자기신고를 받지 않는다. 이메일·프로필 주소와 같은 행에 '유료 판매 + 미신고'로 읽힐 기록이
--    남으면 유출·법적 요청 때 가장 민감한 자료가 되고, 탈퇴한 뒤에도 행과 함께 남는다(계획 10 §4-5).
--    이 질문은 이메일을 받지 않는 익명 설문에서만 묻는다.
ALTER TABLE providers DROP COLUMN has_sold_before, DROP COLUMN has_filed_advisory;

-- 2) 이메일 길이 상한(254자). 앱 검증을 거치지 않은 긴 값이 관리자 화면·DB 용량을 부풀리지 못하게 DB에서도 막는다.
--    탈퇴 처리 값('withdrawn+<uuid>@invalid', 54자)도 이 안에 든다.
ALTER TABLE providers ADD CONSTRAINT providers_email_len CHECK (char_length(email) <= 254);

-- 3) 등록 속도 제한(최근 1시간 건수)과 관리자 목록(상태별 최신순 100건씩)이 스팸이 쌓여도 표 전체를 읽지 않게 한다.
CREATE INDEX IF NOT EXISTS providers_created_at_idx ON providers (created_at);
