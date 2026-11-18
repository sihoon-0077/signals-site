// 그레인 타일 캐시: 같은 그림은 한 번만 만들고, 마지막 레이어가 떠날 때 그림이 끝난 뒤 주소를 돌려주며, 돌려준 주소는 다시 내주지 않는다.
import { describe, expect, it } from "vitest";
import { createTileCache } from "@/components/effects/tile-cache";

// 그림이 끝나는 시점(실제로는 PNG 인코딩이 끝날 때)을 테스트가 정한다
function setup() {
  const painted: number[] = [];
  const revoked: string[] = [];
  const finish: Array<(url: string | null) => void> = [];
  const cache = createTileCache(
    (key) => {
      painted.push(key);
      return new Promise<string | null>((resolve) => finish.push(resolve));
    },
    (url) => revoked.push(url),
  );
  return { cache, painted, revoked, finish };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("그레인 타일 캐시", () => {
  it("같은 대비는 한 번만 그리고 같은 타일을 나눠 준다(다른 대비는 따로)", () => {
    const { cache, painted } = setup();
    const a = cache.acquire(0.5);
    const b = cache.acquire(0.5);
    const c = cache.acquire(0.5);
    expect(painted).toEqual([0.5]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a.users).toBe(3);
    cache.acquire(0.2);
    expect(painted).toEqual([0.5, 0.2]);
  });

  it("마지막 레이어가 떠날 때만, 그림이 끝난 뒤 한 번 돌려준다", async () => {
    const { cache, revoked, finish } = setup();
    const tile = cache.acquire(0.5);
    cache.acquire(0.5);
    cache.release(0.5, tile);
    finish[0]("blob:1");
    await settle();
    expect(revoked).toEqual([]); // 아직 한 레이어가 쓴다
    cache.release(0.5, tile);
    await settle();
    expect(revoked).toEqual(["blob:1"]);
  });

  it("다 떠난 뒤 다시 붙으면(StrictMode의 떼었다 붙이기) 새로 그리고, 돌려줄 주소를 내주지 않는다", async () => {
    const { cache, painted, revoked, finish } = setup();
    const first = cache.acquire(0.5);
    cache.release(0.5, first); // 그림이 끝나기 전에 떠남
    const second = cache.acquire(0.5);
    expect(second).not.toBe(first);
    expect(painted).toEqual([0.5, 0.5]);
    finish[0]("blob:1");
    finish[1]("blob:2");
    await settle();
    expect(revoked).toEqual(["blob:1"]); // 떠난 타일만, 그림이 끝난 뒤에
    expect(await second.url).toBe("blob:2");
  });

  it("그리기에 실패하면(null) 돌려줄 주소가 없다", async () => {
    const { cache, revoked, finish } = setup();
    const tile = cache.acquire(0.5);
    finish[0](null);
    cache.release(0.5, tile);
    await settle();
    expect(revoked).toEqual([]);
  });
});
