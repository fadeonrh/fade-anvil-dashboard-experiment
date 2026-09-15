import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAnvilSpread,
  DEFAULT_ANVIL_SPREAD_CONFIG,
  type AnvilSpreadInput,
  type AnvilSpreadConfig,
} from "../../src/lib/anvil-spread.js";

function makeInput(overrides: Partial<AnvilSpreadInput> = {}): AnvilSpreadInput {
  return {
    quoteTotalCost: 1000000000000000000n, // 1 token (1e18 wei)
    tokenPriceEth: 0.0002,
    poolTvlUsd: 5000,
    inventorySize: 100,
    flatFeeWei: 2000000000000000n, // 0.002 ETH
    osFloorEth: 0.5,
    osFloorOfferEth: 0.4,
    osFloorListings: 5,
    osTotalListings: 20,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AnvilSpreadConfig> = {}): AnvilSpreadConfig {
  return { ...DEFAULT_ANVIL_SPREAD_CONFIG, ...overrides };
}

describe("computeAnvilSpread", () => {
  describe("early returns", () => {
    it("returns no inventory when quoteTotalCost is null", () => {
      const result = computeAnvilSpread(makeInput({ quoteTotalCost: null }));
      assert.equal(result.tradable, false);
      assert.equal(result.reason, "no Anvil inventory");
    });

    it("returns no inventory when inventorySize < minInventory", () => {
      const result = computeAnvilSpread(makeInput({ inventorySize: 0 }));
      assert.equal(result.tradable, false);
      assert.equal(result.reason, "no Anvil inventory");
    });

    it("returns no DEX pool when tokenPriceEth is null", () => {
      const result = computeAnvilSpread(makeInput({ tokenPriceEth: null }));
      assert.equal(result.tradable, false);
      assert.equal(result.reason, "no DEX pool for collection token");
    });

    it("returns no OpenSea floor when osFloorEth is null", () => {
      const result = computeAnvilSpread(makeInput({ osFloorEth: null }));
      assert.equal(result.tradable, false);
      assert.equal(result.reason, "no OpenSea floor");
    });
  });

  describe("spread calculation", () => {
    it("computes correct buy cost with dexSwapCostEth", () => {
      const result = computeAnvilSpread(
        makeInput({ dexSwapCostEth: 0.1 })
      );
      // buyTokensEth = 0.1 (dexSwapCostEth used directly)
      // buyTotalEth = 0.1 + 0.002 (flatFee) = 0.102
      assert.ok(result.buyTokensEth !== null);
      assert.ok(result.buyTotalEth !== null);
      assert.ok(Math.abs(result.buyTotalEth! - 0.102) < 0.0001);
    });

    it("falls back to linear estimate when dexSwapCostEth is null", () => {
      const result = computeAnvilSpread(makeInput({ dexSwapCostEth: null }));
      // buyTokensEth = (1e18 / 1e18) * 0.0002 * (1 + 300/10000) = 0.0002 * 1.03 = 0.000206
      assert.ok(result.buyTokensEth !== null);
      assert.ok(Math.abs(result.buyTokensEth! - 0.000206) < 0.00001);
    });

    it("computes correct gas cost", () => {
      const result = computeAnvilSpread(makeInput());
      // gas = (1.0 * (350000 + 300000)) / 1e9 = 0.00065 ETH
      assert.ok(result.gasEth !== null);
      assert.ok(Math.abs(result.gasEth! - 0.00065) < 0.00001);
    });

    it("computes correct sell net (floor listing)", () => {
      const result = computeAnvilSpread(makeInput());
      // sellNet = 0.5 * (1 - 250/10000) = 0.5 * 0.975 = 0.4875
      assert.ok(result.sellNetEth !== null);
      assert.ok(Math.abs(result.sellNetEth! - 0.4875) < 0.0001);
    });

    it("computes correct sell net (floor offer)", () => {
      const result = computeAnvilSpread(makeInput());
      // sellNetOffer = 0.4 * (1 - 250/10000) = 0.4 * 0.975 = 0.39
      assert.ok(result.sellNetOfferEth !== null);
      assert.ok(Math.abs(result.sellNetOfferEth! - 0.39) < 0.0001);
    });

    it("computes net spread correctly", () => {
      const result = computeAnvilSpread(makeInput());
      assert.ok(result.netSpreadEth !== null);
      assert.ok(result.netSpreadPct !== null);
      // netSpreadEth = sellNetEth - totalCostEth
      // totalCostEth = buyTotalEth + gasEth
      assert.ok(result.netSpreadEth! > 0, "should be profitable");
      assert.ok(result.netSpreadPct! > 0, "percentage should be positive");
    });
  });

  describe("tradable classification", () => {
    it("marks as tradable when spread exceeds thresholds", () => {
      const result = computeAnvilSpread(
        makeInput({
          dexSwapCostEth: 0.05,
          osFloorEth: 0.5,
          osFloorOfferEth: 0.45,
          osFloorListings: 5,
          sales24h: 5,
          volume24hEth: 0.5,
        })
      );
      assert.equal(result.tradable, true);
      assert.equal(result.liquidityClass, "liquid");
    });

    it("marks as not tradable when spread is below threshold", () => {
      const result = computeAnvilSpread(
        makeInput({
          dexSwapCostEth: 0.45,
          osFloorEth: 0.5,
          osFloorListings: 5,
          sales24h: 5,
          volume24hEth: 0.5,
        })
      );
      assert.equal(result.tradable, false);
    });

    it("marks as not tradable when depth is insufficient", () => {
      const result = computeAnvilSpread(
        makeInput({
          dexSwapCostEth: 0.05,
          osFloorEth: 0.5,
          osFloorListings: 1, // below minFloorListings=2
        })
      );
      assert.equal(result.tradable, false);
      assert.ok(result.reason.includes("depth"));
    });
  });

  describe("liquidity classification", () => {
    it("classifies as dead when sales24h is 0", () => {
      const result = computeAnvilSpread(
        makeInput({ sales24h: 0, volume24hEth: 0 })
      );
      assert.equal(result.liquidityClass, "dead");
      assert.equal(result.tradable, false);
      assert.ok(result.reason.includes("dead"));
    });

    it("classifies as thin when sales24h < minLiquidSales24h", () => {
      const result = computeAnvilSpread(
        makeInput({ sales24h: 0.5, volume24hEth: 0.01 })
      );
      assert.equal(result.liquidityClass, "thin");
    });

    it("classifies as liquid when sales24h >= minLiquidSales24h", () => {
      const result = computeAnvilSpread(
        makeInput({ sales24h: 5, volume24hEth: 0.5 })
      );
      assert.equal(result.liquidityClass, "liquid");
    });

    it("returns null liquidityClass when stats unavailable", () => {
      const result = computeAnvilSpread(makeInput({ sales24h: undefined }));
      assert.equal(result.liquidityClass, null);
    });
  });

  describe("warnings", () => {
    it("warns on thin DEX pool", () => {
      const result = computeAnvilSpread(makeInput({ poolTvlUsd: 500 }));
      assert.ok(result.warnings.some((w) => w.includes("thin DEX pool")));
    });

    it("warns on thin OpenSea depth", () => {
      const result = computeAnvilSpread(makeInput({ osFloorListings: 1 }));
      assert.ok(result.warnings.some((w) => w.includes("thin OpenSea depth")));
    });

    it("warns on thin 24h volume", () => {
      const result = computeAnvilSpread(
        makeInput({ sales24h: 0.3, volume24hEth: 0.01 })
      );
      assert.ok(result.warnings.some((w) => w.includes("thin 24h volume")));
    });
  });

  describe("custom config", () => {
    it("respects custom openseaFeeBps", () => {
      const result = computeAnvilSpread(
        makeInput(),
        makeConfig({ openseaFeeBps: 500 }) // 5% fee
      );
      // sellNet = 0.5 * (1 - 500/10000) = 0.5 * 0.95 = 0.475
      assert.ok(result.sellNetEth !== null);
      assert.ok(Math.abs(result.sellNetEth! - 0.475) < 0.0001);
    });

    it("respects custom minSpreadPct", () => {
      // With dexSwapCostEth=0.45 and osFloorEth=0.5, spread is thin (~370% totalCost)
      // Setting minSpreadPct=500 ensures it fails
      const result = computeAnvilSpread(
        makeInput({
          dexSwapCostEth: 0.45,
          osFloorEth: 0.5,
          osFloorListings: 5,
          sales24h: 5,
          volume24hEth: 0.5,
        }),
        makeConfig({ minSpreadPct: 500 })
      );
      assert.equal(result.tradable, false);
    });
  });
});
