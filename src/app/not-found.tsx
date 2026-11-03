import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-5 py-10">
      <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
      <p className="leading-relaxed text-muted-foreground">
        주소가 틀렸거나, 아직 승인되지 않은 공급자 프로필일 수 있습니다. 사전등록 직후의 프로필은 운영자가 승인한 뒤에 열립니다.
      </p>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        처음으로
      </Link>
    </div>
  );
}
