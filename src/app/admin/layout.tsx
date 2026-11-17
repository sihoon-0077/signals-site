// 운영자 화면만 넓게 쓴다: 루트 레이아웃의 <main>이 안쪽의 data-layout="wide"를 보고(has-data-[layout=wide]) 최대 폭을 90rem으로 늘린다.
// 헤더·푸터도 같은 표시(body의 group/body)를 보고 안쪽 폭만 90rem으로 늘려 왼쪽 끝을 맞춘다. 인증은 미들웨어와 page.tsx의 requireAdmin()이 맡으므로 여기서는 데이터도 문구도 다루지 않는다.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-layout="wide" className="text-sm">
      {children}
    </div>
  );
}
