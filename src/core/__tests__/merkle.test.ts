import { describe, expect, it } from "vitest";
import { fromHex, sha256, toHex } from "../encoding";
import { inclusionProof, leafHash, merkleRoot, verifyInclusion } from "../merkle";

// Certificate Transparency 구현체들이 공유하는 테스트 벡터(03_arch_check.py와 같음)
const CT_LEAVES = ["", "00", "10", "2021", "3031", "40414243", "5051525354555657", "606162636465666768696a6b6c6d6e6f"].map(fromHex);
const CT_ROOTS = [
  "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
  "fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125",
  "aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77",
  "d37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7",
  "4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4",
  "76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef",
  "ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c",
  "5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328",
];

describe("RFC 6962 머클 트리", () => {
  it("빈 트리는 SHA-256('')", async () => {
    expect(toHex(await merkleRoot([]))).toBe(toHex(await sha256(new Uint8Array(0))));
  });

  for (let n = 1; n <= 8; n++) {
    it(`CT 벡터 크기 ${n} 루트 일치`, async () => {
      expect(toHex(await merkleRoot(CT_LEAVES.slice(0, n)))).toBe(CT_ROOTS[n - 1]);
    });
  }

  it("모든 리프의 포함 증명이 검증되고, 증명을 바꾸면 실패한다", async () => {
    let checked = 0;
    for (let n = 1; n <= 8; n++) {
      const leaves = CT_LEAVES.slice(0, n);
      const root = await merkleRoot(leaves);
      for (let m = 0; m < n; m++) {
        const lh = await leafHash(leaves[m]);
        const proof = await inclusionProof(m, leaves);
        expect(await verifyInclusion(m, n, lh, proof, root)).toBe(true);
        if (proof.length) {
          const bad = [await sha256(proof[0]), ...proof.slice(1)];
          expect(await verifyInclusion(m, n, lh, bad, root)).toBe(false);
        }
        checked++;
      }
    }
    expect(checked).toBe(36);
  });
});
