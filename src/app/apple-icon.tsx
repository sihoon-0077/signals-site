// iPhone·iPad 홈 화면 아이콘(<link rel="apple-touch-icon">). icon.svg와 같은 그림을 180px로 그린다:
// 32칸 격자에서 바탕 + 가운데 14×14 인디고 사각형(모서리 3). 바탕은 모서리까지 꽉 채운다 — iOS가 모서리를 직접 둥글게 깎고,
// 투명한 모서리는 검게 채운다. 글자가 없어 글꼴을 받지 않는다(빌드 때 정적 생성).
import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const UNIT = size.width / 32;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0D10" }}>
        <div style={{ width: 14 * UNIT, height: 14 * UNIT, borderRadius: 3 * UNIT, background: "#5A61D8" }} />
      </div>
    ),
    { ...size },
  );
}
