import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  wethInForExactOut,
  ANVIL_WETH,
  type V3PoolState,
} from "../../src/lib/v3-pool.js";

const WETH = ANVIL_WETH;
const COLLECTION = "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`;
const Q96 = 1n << 96n;

function makePool(overrides: Partial<V3PoolState> = {}): V3PoolState {
  return {
    sqrtPriceX96: Q96, // 1:1 price
    liquidity: 1000000000000000000n, // large liquidity
    fee: 3000n, // 0.3% fee
    token0: WETH,
    token1: COLLECTION,
    ...overrides,
  };
}

describe("wethInForExactOut", () => {
  describe("edge cases", () => {
    it("returns 0n for zero amountOut", () => {
      const result = wethInForExactOut(makePool(), 0n);
      assert.equal(result, 0n);
    });

    it("returns null for zero liquidity", () => {
      const result = wethInForExactOut(makePool({ liquidity: 0n }), 1000n);
      assert.equal(result, null);
    });

    it("returns null for invalid fee (>= FEE_DENOMINATOR)", () => {
      const result = wethInForExactOut(
        makePool({ fee: 1000000n }),
        1000n
      );
      assert.equal(result, null);
    });

    it("returns null when pool doesn't pair against WETH", () => {
      const result = wethInForExactOut(
        makePool({
          token0: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          token1: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }),
        1000n
      );
      assert.equal(result, null);
    });
  });

  describe("token0 = WETH direction", () => {
    it("returns positive WETH input for valid swap", () => {
      const pool = makePool({
        sqrtPriceX96: Q96 * 2n, // price = 4
        liquidity: 10000000000000000000n,
      });
      const result = wethInForExactOut(pool, 1000000000000000n); // 0.001 tokens
      assert.ok(result !== null);
      assert.ok(result > 0n, "WETH input should be positive");
    });

    it("returns null when swap would push price > 25% (thin pool)", () => {
      const pool = makePool({
        sqrtPriceX96: Q96,
        liquidity: 100n, // very thin pool
      });
      // Large output relative to liquidity triggers the thin-pool guard
      const result = wethInForExactOut(pool, 1000000000000000000n);
      assert.equal(result, null);
    });
  });

  describe("token1 = WETH direction", () => {
    it("returns positive WETH input for reversed pair", () => {
      const pool = makePool({
        token0: COLLECTION,
        token1: WETH,
        sqrtPriceX96: Q96 * 2n,
        liquidity: 10000000000000000000n,
      });
      const result = wethInForExactOut(pool, 1000000000000000n);
      assert.ok(result !== null);
      assert.ok(result > 0n, "WETH input should be positive");
    });

    it("returns null when swap would push price > 25% (thin pool)", () => {
      const pool = makePool({
        token0: COLLECTION,
        token1: WETH,
        sqrtPriceX96: Q96,
        liquidity: 100n,
      });
      const result = wethInForExactOut(pool, 1000000000000000000n);
      assert.equal(result, null);
    });
  });

  describe("fee calculation", () => {
    it("higher fee results in higher WETH input", () => {
      const lowFee = makePool({ fee: 500n }); // 0.05%
      const highFee = makePool({ fee: 10000n }); // 1%
      const amount = 1000000000000000n;
      const resultLow = wethInForExactOut(lowFee, amount);
      const resultHigh = wethInForExactOut(highFee, amount);
      assert.ok(resultLow !== null);
      assert.ok(resultHigh !== null);
      assert.ok(resultHigh! > resultLow!, "higher fee should cost more WETH");
    });
  });
});
