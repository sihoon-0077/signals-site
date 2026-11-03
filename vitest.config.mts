import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig의 jsx: "preserve"는 Next가 JSX를 직접 변환하기 위한 값이다. Vite도 이를 따라 JSX를 그대로 두므로,
  // 테스트에서 .tsx 화면(검증 결과 화면, 공유 카드 이미지)을 불러올 수 있게 여기서만 React 자동 변환을 켠다.
  oxc: { jsx: { runtime: "automatic", importSource: "react" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only는 클라이언트 번들 유출을 막는 표식이다. 테스트(Node)에서는 빈 모듈로 바꾼다.
      "server-only": fileURLToPath(new URL("./src/test/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 30_000,
    // PGlite·소켓 서버 준비는 부하가 있으면 10초 기본값을 넘기도 한다
    hookTimeout: 60_000,
    env: { TSA_URLS: "off" },
  },
});
