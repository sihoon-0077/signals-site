import { Fragment, type ReactNode } from "react";

// 휴대폰 폭에서 기술 용어가 줄 끝에서 갈라지지 않게 한다. 예: 'SHA-/256'(하이픈 뒤), 'RFC / 3161'(빈칸),
// '(OpenTimestamps) / 에'(닫는 괄호 뒤 조사; keep-all이어도 괄호 뒤는 줄바꿈 자리다).
// 정해 둔 용어만 nowrap span으로 감싼다. 글자는 하나도 바꾸지 않으므로(textContent 동일) 소스 문구를 읽는 테스트·복사한 글은 그대로다.
// 긴 괄호 문구까지 붙이면 좁은 화면에서 넘칠 수 있어, 짧은 고정 용어만 목록에 둔다.
const TERMS = /(SHA-256|RFC 3161|\(OpenTimestamps\)에)/;

export function keepTerms(text: string): ReactNode {
  const parts = text.split(TERMS); // 괄호로 잡은 용어도 결과 배열에 남는다: [앞, 용어, 사이, 용어, …]
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
