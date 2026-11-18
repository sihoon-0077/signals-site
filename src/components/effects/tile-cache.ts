// 여러 레이어가 같은 그림 하나를 나눠 쓰는 캐시(grain.tsx의 노이즈 타일). 키마다 그림을 한 번만 만들고(paint), 쓰는 레이어 수(users)를 센다.
// 마지막 레이어가 떠나면 항목을 바로 지우고, 그림이 다 만들어진 뒤 그 주소를 돌려준다(revoke).
// paint·revoke를 밖에서 받는 이유: 캔버스 없이(Node 테스트) 세는 규칙만 따로 확인하려고(__tests__/tile-cache.test.ts).
export type SharedTile = { url: Promise<string | null>; users: number };

export function createTileCache(paint: (key: number) => Promise<string | null>, revoke: (url: string) => void) {
  const tiles = new Map<number, SharedTile>();
  return {
    acquire(key: number): SharedTile {
      let tile = tiles.get(key);
      if (!tile) {
        tile = { url: paint(key), users: 0 };
        tiles.set(key, tile);
      }
      tile.users += 1;
      return tile;
    },
    release(key: number, tile: SharedTile): void {
      tile.users -= 1;
      if (tile.users > 0) return;
      // 지우기는 바로 한다: 다음 acquire(예: 개발 모드 StrictMode가 효과를 떼었다 다시 붙일 때)는 새 그림을 받는다.
      // 이것을 아래 then 안으로 옮기면, 그림이 끝나기 전에 붙은 레이어가 곧 돌려줄 주소를 받아 텅 빈다.
      if (tiles.get(key) === tile) tiles.delete(key);
      void tile.url.then((url) => {
        if (url) revoke(url);
      });
    },
  };
}
