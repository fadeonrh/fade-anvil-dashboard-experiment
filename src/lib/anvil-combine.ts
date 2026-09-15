/**
 * Anvil scan pipeline — combines factory reads, AMM quotes, DexScreener
 * token pricing and OpenSea listing floors into one spread view per
 * market. Cached with a TTL so the 60s alert cadence doesn't hammer
 * the factory/DexScreener/OpenSea (a full sweep is ~15+ requests).
 */
import type { PublicClient } from "viem";
import {
  scanAnvilMarkets,
  readTokenDex,
  resolveOpenSeaSlug,
  readOpenSeaFloor,
  readOpenSeaFloorOffer,
  readOpenSeaLiquidity,
  type AnvilMarketState,
  type AnvilTokenDex,
  type AnvilOpenSeaFloor,
} from "./anvil.js";
import {
  readV3Pool,
  wethInForExactOut,
} from "./v3-pool.js";
import {
  computeAnvilSpread,
  type AnvilSpreadResult,
  type AnvilSpreadConfig,
  DEFAULT_ANVIL_SPREAD_CONFIG,
} from "./anvil-spread.js";

export interface AnvilMarketSpread {
  state: AnvilMarketState;
  dex: AnvilTokenDex;
  opensea: AnvilOpenSeaFloor;
  /** Anvil floor in ETH (quote × token price), null when unpriceable. */
  anvilFloorEth: number | null;
  spread: AnvilSpreadResult;
  /** DEX swap cost in ETH (from V3 pool quote), null when unpriceable. */
  dexSwapCostEth?: number | null;
}

export interface AnvilScanOptions {
  /** Cache TTL in ms (default 300_000 = 5 min). */
  cacheTtlMs?: number;
  openseaApiKey?: string;
  spreadConfig?: AnvilSpreadConfig;
}

export class AnvilScanner {
  private cache: { at: number; spreads: AnvilMarketSpread[] } | null = null;
  private inFlight: Promise<AnvilMarketSpread[]> | null = null;
  private readonly ttlMs: number;
  private apiKey: string;
  private spreadConfig: AnvilSpreadConfig;
  /** Per-market stats cache: slug → { data, fetchedAt, healthy }. */
  private statsCache = new Map<string, { volume24hEth: number | null; sales24h: number | null; fetchedAt: number; healthy: boolean }>();
  private readonly STATS_TTL_MS = 30 * 60_000; // 30 min (longer than sweep TTL)
  /** Semaphore for serializing stats fetches (max 1 concurrent). */
  private statsSemaphore = 0;

  constructor(
    private readonly client: PublicClient,
    options: AnvilScanOptions = {},
  ) {
    this.ttlMs = options.cacheTtlMs ?? 300_000;
    this.apiKey = options.openseaApiKey ?? process.env.OPENSEA_API_KEY ?? "";
    this.spreadConfig = options.spreadConfig ?? DEFAULT_ANVIL_SPREAD_CONFIG;
  }

  /** Update config (e.g. from shared JSON file). Called before each sweep. */
  updateConfig(config: AnvilSpreadConfig) {
    this.spreadConfig = config;
  }

  /** Update OpenSea API key (e.g. from user-provided key). */
  updateApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** Cached spread sweep (fresh when TTL expired). */
  async spreads(force = false): Promise<AnvilMarketSpread[]> {
    if (!force && this.cache && Date.now() - this.cache.at < this.ttlMs) {
      return this.cache.spreads;
    }
    // If force, wait for any in-flight sweep to finish, then start a new one
    if (force && this.inFlight) {
      await this.inFlight;
      this.inFlight = null;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.sweep().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async sweep(): Promise<AnvilMarketSpread[]> {
    const states = await scanAnvilMarkets(this.client);
    // Use the live chain gas price for the gas leg (fallback to the config default).
    let gasPriceGwei = this.spreadConfig.gasPriceGwei;
    try {
      const gp = await this.client.getGasPrice();
      const gwei = Number(gp) / 1e9;
      if (Number.isFinite(gwei) && gwei > 0) gasPriceGwei = gwei;
    } catch {
      /* keep config default */
    }
    const spreads = await Promise.all(states.map((s) => this.buildSpread(s, gasPriceGwei)));
    spreads.sort((a, b) => (b.spread.netSpreadEth ?? -1) - (a.spread.netSpreadEth ?? -1));
    this.cache = { at: Date.now(), spreads };
    return spreads;
  }

  private async buildSpread(state: AnvilMarketState, gasPriceGwei: number): Promise<AnvilMarketSpread> {
    const dex = await readTokenDex(state.info.token);
    const slug = await resolveOpenSeaSlug(state.info.collection, this.apiKey);
    const opensea = slug
      ? await readOpenSeaFloor(slug, this.apiKey)
      : { slug: null, floorEth: null, floorListings: null, totalListings: null, floorOfferEth: null, volume24hEth: null, sales24h: null };
    if (slug && opensea.floorEth !== null) {
      opensea.floorOfferEth = await readOpenSeaFloorOffer(slug, this.apiKey);
    }
    // Fetch 24h liquidity data (volume + sales) for the dead/thin/liquid taxonomy.
    // Null slug → stats not fetched. Null stats on error → {null, null}, never confused with "dead" (sales===0).
    // Uses per-market cache (30-min TTL) + semaphore (max 1 concurrent fetch).
    if (slug) {
      const now = Date.now();
      const cached = this.statsCache.get(slug!);
      if (cached && now - cached.fetchedAt < this.STATS_TTL_MS) {
        // Serve from cache — don't fabricate "fresh fetch succeeded"
        opensea.volume24hEth = cached.volume24hEth;
        opensea.sales24h = cached.sales24h;
      } else {
        // Serialize stats fetches (max 1 concurrent via semaphore)
        while (this.statsSemaphore > 0) {
          await new Promise((r) => setTimeout(r, 200));
        }
        this.statsSemaphore++;
        try {
          const liq = await readOpenSeaLiquidity(slug!, this.apiKey);
          opensea.volume24hEth = liq.volume24hEth;
          opensea.sales24h = liq.sales24h;
          const healthy = liq.volume24hEth !== null || liq.sales24h !== null;
          this.statsCache.set(slug!, { volume24hEth: liq.volume24hEth, sales24h: liq.sales24h, fetchedAt: now, healthy });
        } finally {
          this.statsSemaphore--;
        }
      }
    }

    // Exact DEX swap cost (Uniswap V3 amountIn for quoteTotalCost tokens, incl.
    // pool fee + price impact). Null when no pool / pool too thin to quote.
    let dexSwapCostEth: number | null = null;
    if (state.quote && dex.poolAddress) {
      const pool = await readV3Pool(this.client, dex.poolAddress);
      if (pool) {
        const wethIn = wethInForExactOut(pool, state.quote.totalCost);
        if (wethIn !== null) dexSwapCostEth = Number(wethIn) / 1e18;
      }
    }

    const anvilFloorEth =
      state.quote && dex.tokenPriceEth !== null
        ? (Number(state.quote.totalCost) / 1e18) * dex.tokenPriceEth
        : null;

    const spread = computeAnvilSpread(
      {
        quoteTotalCost: state.quote?.totalCost ?? null,
        tokenPriceEth: dex.tokenPriceEth,
        poolTvlUsd: dex.poolTvlUsd,
        inventorySize: state.quote?.inventorySize ?? 0,
        flatFeeWei: state.loanCreationFeeWei,
        osFloorEth: opensea.floorEth,
        osFloorOfferEth: opensea.floorOfferEth,
        osFloorListings: opensea.floorListings,
        osTotalListings: opensea.totalListings,
        dexSwapCostEth,
      volume24hEth: opensea.volume24hEth,
      sales24h: opensea.sales24h,
      },
      { ...this.spreadConfig, gasPriceGwei },
    );

    return { state, dex, opensea, anvilFloorEth, spread, dexSwapCostEth };
  }
}
