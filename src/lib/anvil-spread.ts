/**
 * Anvil spread math — buy an NFT at the Anvil AMM floor (in collection
 * tokens bought on a DEX), sell it on OpenSea. Pure functions, no I/O.
 *
 * Cost side:
 *   buyTokensEth = quoteRandomBuy().totalCost × tokenPriceEth × (1 + slippage)
 *   buyTotalEth  = buyTokensEth + flatFeeEth   (~$2 swap fee on Robinhood Chain)
 * Sell side:
 *   sellNetEth       = osFloor × (1 − openseaFeeBps − royaltyBps)
 *   sellNetOfferEth  = osFloorOffer × (1 − openseaFeeBps − royaltyBps)  (bid exit)
 * Gas (2 tx to buy: DEX swap + AMM buy; 1 tx to sell: OpenSea fulfil):
 *   gasEth       = gasPriceGwei × (buyGasUnits + sellGasUnits) / 1e9
 * Spread (net of everything):
 *   totalCostEth = buyTotalEth + gasEth
 *   netSpreadEth = sellNetEth − totalCostEth
 *   netSpreadPct = netSpreadEth / totalCostEth
 *   netSpreadOfferEth = sellNetOfferEth − totalCostEth   (bid exit, tighter)
 *
 * Per-collection AMM fees (randomFeeBps/specificFeeBps) are already baked
 * into quoteRandomBuy().totalCost (base + staker fee + protocol fee), so
 * they are NOT double-charged here.
 */

export interface AnvilSpreadConfig {
  /** Minimum net spread as % of buy cost to flag tradable (default 15). */
  minSpreadPct: number;
  /** Minimum absolute net spread in ETH (default 0.001). */
  minNetEth: number;
  /** OpenSea marketplace fee in bps (default 250 = 2.5%). */
  openseaFeeBps: number;
  /** Collection royalty in bps, conservative default (default 0 — unknown per collection). */
  royaltyBps: number;
  /** Safety margin on the DEX token purchase in bps (default 300 = 3%). */
  slippageBps: number;
  /** Minimum listings at the OpenSea floor for depth (default 2). */
  minFloorListings: number;
  /** Minimum Anvil AMM inventory (default 1). */
  minInventory: number;
  /** Warns (does not block) when the DEX pool TVL in USD is below this (default 1000). */
  minPoolTvlUsd: number;
  /** Assumed gas price in gwei for the round-trip (default 1.0 — live ≈0.46). */
  gasPriceGwei: number;
  /** Gas units for the buy leg (DEX swap + AMM buy + approvals, default 350k). */
  buyGasUnits: number;
  /** Gas units for the sell leg (OpenSea Seaport fulfil, default 300k). */
  sellGasUnits: number;
  /** Minimum 24h sales to be considered "liquid" (default 1). */
  minLiquidSales24h: number;
  /** Thin-market ETH volume threshold for informational warn (default 0.05 ETH). */
  thinVolumeEth: number;
}

export const DEFAULT_ANVIL_SPREAD_CONFIG: AnvilSpreadConfig = {
  minSpreadPct: 15,
  minNetEth: 0.001,
  openseaFeeBps: 250,
  royaltyBps: 0,
  slippageBps: 300,
  minFloorListings: 2,
  minInventory: 1,
  minPoolTvlUsd: 1000,
  gasPriceGwei: 1.0,
  buyGasUnits: 350_000,
  sellGasUnits: 300_000,
  minLiquidSales24h: 1,
  thinVolumeEth: 0.05,
};

export interface AnvilSpreadInput {
  /** quoteRandomBuy().totalCost in token-wei (18 dec tokens). */
  quoteTotalCost: bigint | null;
  /** ETH price per collection token from DexScreener, null when no pool. */
  tokenPriceEth: number | null;
  /** DEX pool TVL in USD, null when no pool. */
  poolTvlUsd: number | null;
  /** NFTs available in the Anvil AMM vault. */
  inventorySize: number;
  /** Flat ETH fee per swap (loanCreationFeeWei is the on-chain proxy). */
  flatFeeWei: bigint | null;
  /** OpenSea cheapest listing in ETH, null when none. */
  osFloorEth: number | null;
  /** OpenSea highest floor offer (bid) in ETH, null when none. */
  osFloorOfferEth: number | null;
  /** Listings at (±1%) the OpenSea floor. */
  osFloorListings: number | null;
  /** Total OpenSea listings returned. */
  osTotalListings: number | null;
  /**
   * Exact WETH cost of buying quoteTotalCost tokens on the collection's DEX
   * pool (Uniswap V3 amountIn, includes pool fee + price impact). When set,
   * this replaces the linear tokens × spot-price estimate. Omit (or null) to
   * fall back to the linear estimate. Null is also used when the pool can't
   * be read or is too thin to quote.
   */
  dexSwapCostEth?: number | null;
  /** OpenSea 24h sales volume in ETH, null when stats unavailable. */
  volume24hEth?: number | null;
  /** OpenSea 24h sales count, null when stats unavailable. */
  sales24h?: number | null;
}

export interface AnvilSpreadResult {
  /** True when the spread clears both thresholds AND liquidity is real. */
  tradable: boolean;
  /** Human-readable verdict (first blocking reason, or "spread ok"). */
  reason: string;
  buyTokensEth: number | null;
  /** Token buy + flat swap fee (no gas). */
  buyTotalEth: number | null;
  /** Net proceeds selling at the OpenSea floor listing. */
  sellNetEth: number | null;
  /** Net proceeds selling to the OpenSea floor offer (bid), null when none. */
  sellNetOfferEth: number | null;
  /** Estimated gas for the round-trip (buy tx + sell tx), ETH. */
  gasEth: number | null;
  /** buyTotalEth + gasEth — total ETH outlay. */
  totalCostEth: number | null;
  /** Net spread selling at the OpenSea floor listing. */
  netSpreadEth: number | null;
  netSpreadPct: number | null;
  /** Net spread selling to the OpenSea floor offer (bid), null when none. */
  netSpreadOfferEth: number | null;
  netSpreadOfferPct: number | null;
  /** Liquidity classification: "dead" (0 sales), "thin" (<minLiquidSales), "liquid", or null (stats unavailable). */
  liquidityClass: "dead" | "thin" | "liquid" | null;
  /** Non-blocking caution notes (thin depth, tiny pool…). */
  warnings: string[];
}

export function computeAnvilSpread(
  input: AnvilSpreadInput,
  config: AnvilSpreadConfig = DEFAULT_ANVIL_SPREAD_CONFIG,
): AnvilSpreadResult {
  const warnings: string[] = [];
  const empty: AnvilSpreadResult = {
    tradable: false,
    reason: "",
    buyTokensEth: null,
    buyTotalEth: null,
    sellNetEth: null,
    sellNetOfferEth: null,
    gasEth: null,
    totalCostEth: null,
    netSpreadEth: null,
    netSpreadPct: null,
    netSpreadOfferEth: null,
    netSpreadOfferPct: null,
    liquidityClass: null,
    warnings,
  };

  if (input.quoteTotalCost === null || input.inventorySize < config.minInventory) {
    return { ...empty, reason: "no Anvil inventory" };
  }
  if (input.tokenPriceEth === null) {
    return { ...empty, reason: "no DEX pool for collection token" };
  }
  if (input.poolTvlUsd !== null && input.poolTvlUsd < config.minPoolTvlUsd) {
    warnings.push(`thin DEX pool ($${Math.round(input.poolTvlUsd)} TVL)`);
  }
  if (input.osFloorEth === null) {
    return { ...empty, reason: "no OpenSea floor", warnings };
  }

  const buyTokensEth: number =
    input.dexSwapCostEth !== null && input.dexSwapCostEth !== undefined && input.dexSwapCostEth > 0
      ? input.dexSwapCostEth
      : (Number(input.quoteTotalCost) / 1e18) * input.tokenPriceEth * (1 + config.slippageBps / 10_000);
  const flatFeeEth = input.flatFeeWei !== null ? Number(input.flatFeeWei) / 1e18 : 0;
  const buyTotalEth = buyTokensEth + flatFeeEth;
  const gasEth = ((config.gasPriceGwei * (config.buyGasUnits + config.sellGasUnits)) / 1e9);
  const totalCostEth = buyTotalEth + gasEth;
  const sellNetEth =
    input.osFloorEth * (1 - (config.openseaFeeBps + config.royaltyBps) / 10_000);
  const netSpreadEth = sellNetEth - totalCostEth;
  const netSpreadPct = totalCostEth > 0 ? (netSpreadEth / totalCostEth) * 100 : null;

  // Selling to the floor offer (bid) is the realistic immediate exit; it may be
  // lower than the floor listing, giving a tighter (often negative) spread.
  const sellNetOfferEth =
    input.osFloorOfferEth !== null && input.osFloorOfferEth !== undefined
      ? input.osFloorOfferEth * (1 - (config.openseaFeeBps + config.royaltyBps) / 10_000)
      : null;
  const netSpreadOfferEth =
    sellNetOfferEth !== null ? sellNetOfferEth - totalCostEth : null;
  const netSpreadOfferPct =
    netSpreadOfferEth !== null && totalCostEth > 0 ? (netSpreadOfferEth / totalCostEth) * 100 : null;

  if ((input.osFloorListings ?? 0) < config.minFloorListings) {
    warnings.push(
      `thin OpenSea depth (${input.osFloorListings ?? 0} listing(s) at floor)`,
    );
  }

  // --- Liquidity taxonomy (sales-keyed, per LIQUIDITY-24H) ---
  // Null slug/stats = no liquidity gate (never excluded on null).
  // Only a confirmed sales24h===0 from a healthy fetch triggers dead.
  const sales24h = input.sales24h;
  const volume24h = input.volume24hEth;
  let liquidityClass: "dead" | "thin" | "liquid" | null = null;

  if (sales24h !== null && sales24h !== undefined) {
    if (sales24h === 0) {
      liquidityClass = "dead";
      // Dead: exclude from tradable, but don't re-early-return — the spread
      // is still computed for the archive/display (tradable is gated below).
    } else if (sales24h < config.minLiquidSales24h) {
      liquidityClass = "thin";
      warnings.push(`thin 24h volume (${(volume24h ?? 0).toFixed(3)} ETH / ${sales24h} sale(s))`);
    } else {
      liquidityClass = "liquid";
    }
  }

  const spreadOk =
    netSpreadEth >= config.minNetEth && (netSpreadPct ?? 0) >= config.minSpreadPct;
  const depthOk = (input.osFloorListings ?? 0) >= config.minFloorListings;

  let reason: string;
  let tradable: boolean;
  if (liquidityClass === "dead") {
    reason = "dead market (0 sales/24h)";
    tradable = false;
  } else if (!spreadOk) {
    reason = `spread ${(netSpreadPct ?? 0).toFixed(1)}% / ${netSpreadEth.toFixed(6)} ETH below threshold`;
    tradable = false;
  } else if (!depthOk) {
    reason = `spread ok but OpenSea depth < ${config.minFloorListings} listings`;
    tradable = false;
  } else {
    reason = `spread ${netSpreadPct!.toFixed(1)}% / ${netSpreadEth.toFixed(6)} ETH`;
    tradable = true;
  }

  return {
    tradable,
    reason,
    buyTokensEth,
    buyTotalEth,
    sellNetEth,
    sellNetOfferEth,
    gasEth,
    totalCostEth,
    netSpreadEth,
    netSpreadPct,
    netSpreadOfferEth,
    netSpreadOfferPct,
    liquidityClass,
    warnings,
  };
}
