/**
 * Anvil AMM (clutch.market) market scanner for Robinhood Chain (4663).
 *
 * Discovers every market deployed through the AMMFactory, reads the AMM
 * vault quote (floor in collection tokens + inventory), resolves the
 * collection-token ETH price via DexScreener, and the OpenSea floor via
 * the cheapest active listings. Pure reads — no execution.
 *
 * Factory struct layout (getMarket(uint256), 13 words, verified on-chain):
 *   w0  marketId          w1  collection (NFT addr)
 *   w2  0 (dyn name ptr)  w3  token (CollectionToken ERC20)
 *   w4  escrow            w5  amm (NFTAMMVault)
 *   w6  loan (LoanVault)  w7  stake (SoftStakingVault)
 *   w8  0                 w9  tokensPerNFT (token wei)
 *   w10 randomFeeBps      w11 specificFeeBps
 *   w12 0
 */
import type { PublicClient } from "viem";
import { getFunctionSelector } from "viem";

export const ANVIL_FACTORY = "0x8b186717a20845b514344b17fd5e198aDCab9069" as const;
export const ANVIL_BATCH_ROUTER = "0x02eA25c9B75D98E4D5c90BEe999493095C2Da3F1" as const;

/**
 * Markets excluded from the Anvil sweep, grouped by reason:
 *
 * - TSTDNB (marketId 1, 2): factory test markets — no DEX pool, no real
 *   OpenSea listings, dust inventory.
 * - TGS / The Gold Standard (marketId 3): zero OpenSea volume (0 sales, 0 ETH
 *   total volume, 27 owners) and a single absurd 65 ETH listing — the depth
 *   guard blocks it anyway, so tracking it only adds noise.
 */
export const ANVIL_EXCLUDED_MARKET_IDS = new Set<number>([1, 2, 3]);

const SEL: Record<
  "marketCount" | "getMarket" | "allMarkets" | "name" | "symbol" | "quoteRandomBuy" | "loanCreationFeeWei",
  `0x${string}`
> = {
  marketCount: getFunctionSelector("marketCount()"),
  getMarket: getFunctionSelector("getMarket(uint256)"),
  allMarkets: getFunctionSelector("allMarkets()"),
  name: getFunctionSelector("name()"),
  symbol: getFunctionSelector("symbol()"),
  quoteRandomBuy: getFunctionSelector("quoteRandomBuy()"),
  loanCreationFeeWei: getFunctionSelector("loanCreationFeeWei()"),
};

/** Clutch.market metadata for a market (from the public API). */
export interface ClutchMarketMeta {
  verified: boolean;
  liquidityLocked: boolean;
  liquiditySoftLocked: boolean;
  specialProject: boolean;
  governanceEnabled: boolean;
  cto: boolean;
  deprecated: boolean;
  tvl: number;
  apr: number;
  nftCount: number;
  utilization: number;
  totalSupply: number;
  circulatingSupply: number;
  verifiedNote: string;
  liquidityLockedNote: string;
}

/** Static per-market config from the factory. */
export interface AnvilMarketInfo {
  marketId: number;
  collection: `0x${string}`;
  token: `0x${string}`;
  escrow: `0x${string}`;
  amm: `0x${string}`;
  loan: `0x${string}`;
  stake: `0x${string}`;
  /** Tokens per NFT in token-wei (18 decimals tokens). */
  tokensPerNFT: bigint;
  randomFeeBps: number;
  specificFeeBps: number;
}

/** Live AMM quote for one market. */
export interface AnvilAmmQuote {
  /** Total cost in token-wei for a random buy (base + staker fee + protocol fee). */
  totalCost: bigint;
  baseCost: bigint;
  fee: bigint;
  protocolFee: bigint;
  inventorySize: number;
  nextTokenId: bigint;
}

/** Anvil side state: factory info + names + AMM quote + loan fee. */
export interface AnvilMarketState {
  info: AnvilMarketInfo;
  collectionName: string;
  collectionSymbol: string;
  tokenSymbol: string;
  quote: AnvilAmmQuote | null;
  /** Flat ETH fee charged on every swap/loan on Robinhood Chain (~$2). */
  loanCreationFeeWei: bigint | null;
  observedAtMs: number;
  /** Clutch.market metadata (verified, liquidityLocked, specialProject, etc.). */
  clutch: ClutchMarketMeta | null;
}

/** DexScreener pricing for a collection token. */
export interface AnvilTokenDex {
  /** ETH price per token (priceNative), null when no pool exists. */
  tokenPriceEth: number | null;
  /** USD liquidity of the best pool, null when no pool. */
  poolTvlUsd: number | null;
  dexId: string | null;
  /** Address of the best robinhood WETH-quoted pool (for on-chain V3 swap math). */
  poolAddress: `0x${string}` | null;
}

/** OpenSea listing depth + liquidity for the collection. */
export interface AnvilOpenSeaFloor {
  slug: string | null;
  /** Cheapest active listing in ETH, null when none/no data. */
  floorEth: number | null;
  /** How many listings share (±1%) the floor — depth signal. */
  floorListings: number | null;
  /** Total listings returned by the API (capped at limit). */
  totalListings: number | null;
  /** Highest floor offer (bid) in ETH, null when none/no data. */
  floorOfferEth: number | null;
  /** OpenSea 24h sales volume in ETH, null when stats unavailable. */
  volume24hEth: number | null;
  /** OpenSea 24h sales count, null when stats unavailable. */
  sales24h: number | null;
}

const DEXSCREENER_TOKENS = "https://api.dexscreener.com/latest/dex/tokens";
const OPENSEA_V2 = "https://api.opensea.io/v2";
const CLUTCH_API = "https://anvil.clutch.market/api/markets/list";
const UA = "FadeAnvilDashboard/1.0";
const CLUTCH_CHAIN_ID = 4663;

// ---------------------------------------------------------------- on-chain

function word(hex: `0x${string}` | undefined, i: number): bigint {
  if (!hex) return 0n;
  return BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
}
function wordAddr(hex: `0x${string}` | undefined, i: number): `0x${string}` {
  const zero = ("0x" + "0".repeat(40)) as `0x${string}`;
  if (!hex) return zero;
  return ("0x" + hex.slice(2 + i * 64 + 24, 2 + (i + 1) * 64)) as `0x${string}`;
}
function decodeString(hex: `0x${string}` | undefined): string {
  if (!hex) return "";
  try {
    const len = Number(word(hex, 1));
    if (len === 0 || len > 200) return "";
    return Buffer.from(hex.slice(2 + 128, 2 + 128 + len * 2), "hex").toString("utf8").replace(/\0/g, "");
  } catch {
    return "";
  }
}

export async function readMarketCount(client: PublicClient): Promise<number> {
  const r = await client.call({ to: ANVIL_FACTORY, data: SEL.marketCount });
  return Number(word(r.data, 0));
}

export async function readMarketInfo(
  client: PublicClient,
  marketId: number,
): Promise<AnvilMarketInfo | null> {
  const data = SEL.getMarket + marketId.toString(16).padStart(64, "0");
  const r = await client.call({ to: ANVIL_FACTORY, data: data as `0x${string}` });
  const hex = r.data;
  if (!hex || hex.length < 2 + 13 * 64) return null;
  const collection = wordAddr(hex, 1);
  if (collection === "0x" + "0".repeat(40)) return null;
  return {
    marketId: Number(word(hex, 0)),
    collection,
    token: wordAddr(hex, 3),
    escrow: wordAddr(hex, 4),
    amm: wordAddr(hex, 5),
    loan: wordAddr(hex, 6),
    stake: wordAddr(hex, 7),
    tokensPerNFT: word(hex, 9),
    randomFeeBps: Number(word(hex, 10)),
    specificFeeBps: Number(word(hex, 11)),
  };
}

/**
 * Read ALL markets from the V3 factory in a single call (V2 + V3).
 * Replaces the hardcoded ANVIL_V3_MARKETS list with live on-chain discovery.
 */
export async function readAllMarkets(client: PublicClient): Promise<AnvilMarketInfo[]> {
  try {
    const r = await client.call({ to: ANVIL_FACTORY, data: SEL.allMarkets });
    const hex = r.data;
    if (!hex || hex.length < 2 + 64) return [];
    // ABI: offset (32 bytes) → length (32 bytes) → structs (13 words each)
    const offsetBytes = Number(word(hex, 0)); // byte offset to array data (typically 32)
    const lenPos = 2 + offsetBytes * 2; // hex char position of the length word (skip 0x prefix)
    const len = Number(BigInt("0x" + hex.slice(lenPos, lenPos + 64)));
    if (len === 0 || len > 200) return [];
    const structsStart = lenPos + 64; // hex char position after length word
    const markets: AnvilMarketInfo[] = [];
    for (let i = 0; i < len; i++) {
      const base = structsStart + i * 13 * 64;
      if (base + 13 * 64 > hex.length) break;
      const chunk = ("0x" + hex.slice(base, base + 13 * 64)) as `0x${string}`;
      const collection = wordAddr(chunk, 1);
      if (collection === "0x" + "0".repeat(40)) continue;
      markets.push({
        marketId: Number(word(chunk, 0)),
        collection,
        token: wordAddr(chunk, 3),
        escrow: wordAddr(chunk, 4),
        amm: wordAddr(chunk, 5),
        loan: wordAddr(chunk, 6),
        stake: wordAddr(chunk, 7),
        tokensPerNFT: word(chunk, 9),
        randomFeeBps: Number(word(chunk, 10)),
        specificFeeBps: Number(word(chunk, 11)),
      });
    }
    return markets;
  } catch {
    return [];
  }
}

/** Full clutch API record for a single market on Robinhood Chain. */
export interface ClutchMarketRecord {
  collection: string;
  tokenAddress: string;
  escrowAddress: string;
  ammVaultAddress: string;
  loanVaultAddress: string;
  stakingVaultAddress: string;
  tokensPerNFT: number;
  randomFeeBps: number;
  specificFeeBps: number;
  collectionName: string | null;
  tokenSymbol: string | null;
  marketId: number | null;
}

/**
 * Unified clutch API cache. Shared between readClutchAll() and readClutchMarketMeta().
 * Stores full records (for market discovery) and derived metadata (for badges).
 */
let clutchCache: {
  records: ClutchMarketRecord[];
  meta: Map<string, ClutchMarketMeta>;
  at: number;
} | null = null;
const CLUTCH_TTL_MS = 5 * 60_000;

async function fetchClutchCache(): Promise<typeof clutchCache> {
  const now = Date.now();
  if (clutchCache && now - clutchCache.at < CLUTCH_TTL_MS) return clutchCache;
  try {
    const res = await fetch(CLUTCH_API, { headers: { "User-Agent": UA } });
    if (!res.ok) return clutchCache;
    const body = await res.json() as { data?: Array<Record<string, unknown>> };
    if (!body.data) return clutchCache;
    const records: ClutchMarketRecord[] = [];
    const meta = new Map<string, ClutchMarketMeta>();
    for (const m of body.data) {
      if (m.chainId !== CLUTCH_CHAIN_ID) continue;
      const col = (m.collection as string).toLowerCase();
      records.push({
        collection: m.collection as string,
        tokenAddress: m.tokenAddress as string,
        escrowAddress: m.escrowAddress as string,
        ammVaultAddress: m.ammVaultAddress as string,
        loanVaultAddress: m.loanVaultAddress as string,
        stakingVaultAddress: m.stakingVaultAddress as string,
        tokensPerNFT: Number(m.tokensPerNFT ?? 0),
        randomFeeBps: Number(m.randomFeeBps ?? 0),
        specificFeeBps: Number(m.specificFeeBps ?? 0),
        collectionName: (m.collectionName as string) ?? null,
        tokenSymbol: (m.tokenSymbol as string) ?? null,
        marketId: null,
      });
      meta.set(col, {
        verified: Boolean(m.verified),
        liquidityLocked: Boolean(m.liquidityLocked),
        liquiditySoftLocked: Boolean(m.liquiditySoftLocked),
        specialProject: Boolean(m.specialProject),
        governanceEnabled: Boolean(m.governanceEnabled),
        cto: Boolean(m.cto),
        deprecated: Boolean(m.deprecated),
        tvl: Number(m.tvl ?? 0),
        apr: Number(m.apr ?? 0),
        nftCount: Number(m.nftCount ?? 0),
        utilization: Number(m.utilization ?? 0),
        totalSupply: Number(m.totalSupply ?? 0),
        circulatingSupply: Number(m.circulatingSupply ?? 0),
        verifiedNote: String(m.verifiedNote ?? ""),
        liquidityLockedNote: String(m.liquidityLockedNote ?? ""),
      });
    }
    clutchCache = { records, meta, at: now };
    return clutchCache;
  } catch {
    return clutchCache;
  }
}

/** Fetch all Robinhood Chain markets from clutch API (cached 5 min). */
export async function readClutchAll(): Promise<ClutchMarketRecord[]> {
  const c = await fetchClutchCache();
  return c?.records ?? [];
}

/** Fetch clutch.market metadata badges (cached 5 min, shared with readClutchAll). */
export async function readClutchMarketMeta(): Promise<Map<string, ClutchMarketMeta>> {
  const c = await fetchClutchCache();
  return c?.meta ?? new Map();
}

/** Clear the clutch.market cache (for testing). */
export function clearClutchCache(): void {
  clutchCache = null;
}

/**
 * Read V2 factory markets and return a map of collection → marketId.
 * Used to identify excluded V2 markets when scanning via clutch.
 */
export async function readV2MarketIdMap(client: PublicClient): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const count = Number(word((await client.call({ to: ANVIL_FACTORY, data: SEL.marketCount })).data, 0));
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) => readMarketInfo(client, i + 1)),
    );
    for (const info of results) {
      if (info) map.set(info.collection.toLowerCase(), info.marketId);
    }
  } catch { /* V2 factory unavailable — return empty map */ }
  return map;
}

export async function readAmmQuote(
  client: PublicClient,
  amm: `0x${string}`,
): Promise<AnvilAmmQuote | null> {
  try {
    const r = await client.call({ to: amm, data: SEL.quoteRandomBuy });
    return {
      totalCost: word(r.data, 0),
      baseCost: word(r.data, 1),
      fee: word(r.data, 2),
      protocolFee: word(r.data, 3),
      inventorySize: Number(word(r.data, 4)),
      nextTokenId: word(r.data, 5),
    };
  } catch {
    return null;
  }
}

/**
 * Module-level cache for immutable ERC20 metadata (name, symbol).
 * Keyed by lowercase address. Populated once per address — never changes.
 */
const immutableMetaCache = new Map<string, { name: string; symbol: string }>();

/**
 * Scan every Anvil market on Robinhood Chain.
 *
 * Primary discovery: clutch.market API (all V2 + V3 markets in one call).
 * Falls back to on-chain V2 factory enumeration if the API is unreachable.
 * Enriches each market with on-chain AMM quotes and clutch metadata badges.
 */
export async function scanAnvilMarkets(client: PublicClient): Promise<AnvilMarketState[]> {
  const clutchAll = await readClutchAll(); // primary: all markets with vault addresses
  if (clutchAll.length > 0) {
    return scanFromClutch(client, clutchAll);
  }
  // Fallback: on-chain V2 factory enumeration.
  return scanFromFactory(client);
}

/** Build AnvilMarketInfo from a clutch market record. */
function clutchToInfo(m: ClutchMarketRecord): AnvilMarketInfo {
  return {
    marketId: m.marketId ?? 0,
    collection: m.collection as `0x${string}`,
    token: m.tokenAddress as `0x${string}`,
    escrow: m.escrowAddress as `0x${string}`,
    amm: m.ammVaultAddress as `0x${string}`,
    loan: m.loanVaultAddress as `0x${string}`,
    stake: m.stakingVaultAddress as `0x${string}`,
    tokensPerNFT: BigInt(Math.floor(m.tokensPerNFT ?? 0)),
    randomFeeBps: m.randomFeeBps ?? 0,
    specificFeeBps: m.specificFeeBps ?? 0,
  };
}

/** Scan markets from clutch API records — the primary discovery path. */
async function scanFromClutch(
  client: PublicClient,
  clutchAll: ClutchMarketRecord[],
): Promise<AnvilMarketState[]> {
  // Build V2 marketId map for exclusion filtering.
  const v2IdMap = await readV2MarketIdMap(client);

  // Enrich clutch records with V2 marketIds where available.
  const records = clutchAll.map((m) => {
    const id = v2IdMap.get(m.collection.toLowerCase());
    return { ...m, marketId: id ?? null };
  });

  // Filter excluded V2 markets.
  const included = records.filter((m) => m.marketId === null || !ANVIL_EXCLUDED_MARKET_IDS.has(m.marketId));

  // Fetch clutch metadata badges.
  const clutchMeta = await readClutchMarketMeta();

  const states = await Promise.all(included.map(async (m) => {
    const info = clutchToInfo(m);
    const { collection, token, amm, loan } = info;
    const cKey = collection.toLowerCase();
    const tKey = token.toLowerCase();
    const cCached = immutableMetaCache.get(cKey);
    const tCached = immutableMetaCache.get(tKey);
    const [collectionName, collectionSymbol, tokenSymbol, quote, loanFee] = await Promise.all([
      cCached?.name !== undefined ? Promise.resolve(cCached.name) :
        client.call({ to: collection, data: SEL.name }).then((r) => { const n = decodeString(r.data); immutableMetaCache.set(cKey, { ...immutableMetaCache.get(cKey) ?? { name: "", symbol: "" }, name: n }); return n; }).catch(() => ""),
      cCached?.symbol !== undefined ? Promise.resolve(cCached.symbol) :
        client.call({ to: collection, data: SEL.symbol }).then((r) => { const s = decodeString(r.data); immutableMetaCache.set(cKey, { ...immutableMetaCache.get(cKey) ?? { name: "", symbol: "" }, symbol: s }); return s; }).catch(() => ""),
      tCached?.symbol !== undefined ? Promise.resolve(tCached.symbol) :
        client.call({ to: token, data: SEL.symbol }).then((r) => { const s = decodeString(r.data); immutableMetaCache.set(tKey, { ...immutableMetaCache.get(tKey) ?? { name: "", symbol: "" }, symbol: s }); return s; }).catch(() => ""),
      readAmmQuote(client, amm),
      loan !== "0x0000000000000000000000000000000000000000"
        ? client
            .call({ to: loan, data: SEL.loanCreationFeeWei })
            .then((r) => word(r.data, 0))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      info,
      collectionName: m.collectionName ?? collectionName,
      collectionSymbol,
      tokenSymbol: m.tokenSymbol ?? tokenSymbol,
      quote,
      loanCreationFeeWei: loanFee,
      observedAtMs: Date.now(),
      clutch: clutchMeta.get(cKey) ?? null,
    };
  }));
  return states;
}

/** Fallback: scan from on-chain V2 factory (markets 1..count, minus excluded). */
async function scanFromFactory(client: PublicClient): Promise<AnvilMarketState[]> {
  const count = await readMarketCount(client);
  const ids: number[] = [];
  for (let id = 1; id <= count; id++) {
    if (!ANVIL_EXCLUDED_MARKET_IDS.has(id)) ids.push(id);
  }
  const infos = (await Promise.all(ids.map((id) => readMarketInfo(client, id)))).filter(Boolean) as AnvilMarketInfo[];
  const clutchMeta = await readClutchMarketMeta();
  const states = await Promise.all(infos.map(async (info) => {
    const { collection, token, amm, loan } = info;
    const cKey = collection.toLowerCase();
    const tKey = token.toLowerCase();
    const cCached = immutableMetaCache.get(cKey);
    const tCached = immutableMetaCache.get(tKey);
    const [collectionName, collectionSymbol, tokenSymbol, quote, loanFee] = await Promise.all([
      cCached?.name !== undefined ? Promise.resolve(cCached.name) :
        client.call({ to: collection, data: SEL.name }).then((r) => { const n = decodeString(r.data); immutableMetaCache.set(cKey, { ...immutableMetaCache.get(cKey) ?? { name: "", symbol: "" }, name: n }); return n; }).catch(() => ""),
      cCached?.symbol !== undefined ? Promise.resolve(cCached.symbol) :
        client.call({ to: collection, data: SEL.symbol }).then((r) => { const s = decodeString(r.data); immutableMetaCache.set(cKey, { ...immutableMetaCache.get(cKey) ?? { name: "", symbol: "" }, symbol: s }); return s; }).catch(() => ""),
      tCached?.symbol !== undefined ? Promise.resolve(tCached.symbol) :
        client.call({ to: token, data: SEL.symbol }).then((r) => { const s = decodeString(r.data); immutableMetaCache.set(tKey, { ...immutableMetaCache.get(tKey) ?? { name: "", symbol: "" }, symbol: s }); return s; }).catch(() => ""),
      readAmmQuote(client, amm),
      loan !== "0x0000000000000000000000000000000000000000"
        ? client
            .call({ to: loan, data: SEL.loanCreationFeeWei })
            .then((r) => word(r.data, 0))
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      info,
      collectionName,
      collectionSymbol,
      tokenSymbol,
      quote,
      loanCreationFeeWei: loanFee,
      observedAtMs: Date.now(),
      clutch: clutchMeta.get(cKey) ?? null,
    };
  }));
  return states;
}

// ---------------------------------------------------------------- dex

/** Resolve a collection token's ETH price + pool liquidity via DexScreener. */
export async function readTokenDex(token: `0x${string}`, timeoutMs = 8000): Promise<AnvilTokenDex> {
  const empty: AnvilTokenDex = { tokenPriceEth: null, poolTvlUsd: null, dexId: null, poolAddress: null };
  try {
    const res = await fetch(`${DEXSCREENER_TOKENS}/${token}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      pairs?: Array<{
        chainId?: string;
        dexId?: string;
        priceNative?: string;
        liquidity?: { usd?: number };
        baseToken?: { address?: string };
        quoteToken?: { symbol?: string };
        pairAddress?: string;
      }>;
    };
    // The tokens endpoint returns every pair containing the address on every
    // chain, token as base OR quote, priced against whatever the pair's quote
    // token is. Only a robinhood WETH-quoted pair with our token as base
    // gives a genuine ETH price — anything else can be off by orders of
    // magnitude (verified: DERP's deepest pool is DERP/STONKBROKER).
    const pairs = (data.pairs ?? []).filter(
      (p) =>
        p.chainId === "robinhood" &&
        p.baseToken?.address?.toLowerCase() === token.toLowerCase() &&
        p.quoteToken?.symbol === "WETH",
    );
    if (pairs.length === 0) return empty;
    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]!;
    const price = Number(best.priceNative);
    if (!Number.isFinite(price) || price <= 0) return empty;
    const poolAddress = /^0x[0-9a-fA-F]{40}$/.test(best.pairAddress ?? "")
      ? (best.pairAddress! as `0x${string}`)
      : null;
    return {
      tokenPriceEth: price,
      poolTvlUsd: best.liquidity?.usd ?? null,
      dexId: best.dexId ?? null,
      poolAddress,
    };
  } catch {
    return empty;
  }
}

// ---------------------------------------------------------------- opensea

/**
 * OpenSea API rate limiter — free tier allows 10 requests/second.
 * Simple sequential queue: waits until enough time has passed since the last call.
 */
let osLastCallAt = 0;
const OS_MIN_INTERVAL_MS = 120; // ~8 req/sec (safe margin under 10/sec limit)

async function osAcquire(): Promise<void> {
  const now = Date.now();
  const elapsed = now - osLastCallAt;
  if (elapsed < OS_MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, OS_MIN_INTERVAL_MS - elapsed));
  }
  osLastCallAt = Date.now();
}

/** Resolve the OpenSea slug for an NFT contract on the robinhood chain. */
export async function resolveOpenSeaSlug(
  collection: `0x${string}`,
  apiKey: string,
  timeoutMs = 8000,
): Promise<string | null> {
  if (!apiKey) return null;
  await osAcquire();
  try {
    const res = await fetch(`${OPENSEA_V2}/chain/robinhood/contract/${collection}`, {
      headers: { "user-agent": UA, accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { collection?: string };
    return data.collection ?? null;
  } catch {
    return null;
  }
}

/**
 * Cheapest active listings for a slug — the listing-based floor (more honest
 * than /stats when a collection has a single absurd listing).
 */
export async function readOpenSeaFloor(
  slug: string,
  apiKey: string,
  limit = 10,
  timeoutMs = 8000,
): Promise<AnvilOpenSeaFloor> {
  const empty: AnvilOpenSeaFloor = { slug, floorEth: null, floorListings: null, totalListings: null, floorOfferEth: null, volume24hEth: null, sales24h: null };
  if (!apiKey) return empty;
  await osAcquire();
  try {
    const res = await fetch(`${OPENSEA_V2}/listings/collection/${slug}/all?limit=${limit}`, {
      headers: { "user-agent": UA, accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      listings?: Array<{ price?: { current?: { value?: string; decimals?: number } } }>;
    };
    const listings = data.listings ?? [];
    if (listings.length === 0) return empty;
    const prices: number[] = [];
    for (const l of listings) {
      const cur = l.price?.current;
      if (!cur?.value) continue;
      const eth = Number(cur.value) / 10 ** Number(cur.decimals ?? 18);
      if (Number.isFinite(eth) && eth > 0) prices.push(eth);
    }
    if (prices.length === 0) return empty;
    prices.sort((a, b) => a - b);
    const floor = prices[0]!;
    const atFloor = prices.filter((p) => Math.abs(p - floor) / floor <= 0.01).length;
    return { slug, floorEth: floor, floorListings: atFloor, totalListings: listings.length, floorOfferEth: null, volume24hEth: null, sales24h: null };
  } catch {
    return empty;
  }
}

/**
 * Read the highest collection-wide floor offer (bid) for a collection from
 * OpenSea V2 offer_aggregates endpoint. Returns the ETH value of the
 * highest aggregated collection-wide bid.
 */
export async function readOpenSeaFloorOffer(
  slug: string,
  apiKey: string,
  timeoutMs = 8000,
): Promise<number | null> {
  if (!apiKey) return null;
  await osAcquire();
  try {
    const res = await fetch(`${OPENSEA_V2}/collections/${slug}/offer_aggregates`, {
      headers: { "user-agent": UA, accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      offer_aggregates?: Array<{
        offer_price?: { token_unit?: number; symbol?: string };
        total_offers?: number;
      }>;
    };
    const aggs = data.offer_aggregates ?? [];
    if (aggs.length === 0) return null;
    // Sort by price descending to get the highest bid
    const sorted = aggs.sort((a, b) => (b.offer_price?.token_unit ?? 0) - (a.offer_price?.token_unit ?? 0));
    const best = sorted[0]?.offer_price?.token_unit;
    return best && Number.isFinite(best) && best > 0 ? best : null;
  } catch {
    return null;
  }
}

/**
 * Read 24h OpenSea liquidity for a collection from the V2 /collections/{slug}/stats
 * endpoint. Returns volume + sales from the `intervals` array (matched by
 * `interval === "one_day"` label, NOT by index — bucket order is not guaranteed).
 *
 * Failure/null semantics: returns `{ volume24hEth: null, sales24h: null }` on any
 * error (missing intervals, absent one_day bucket, fetch error) — a transient stats
 * failure never looks like "dead market" (sales===0).
 */
export async function readOpenSeaLiquidity(
  slug: string,
  apiKey: string,
  timeoutMs = 8000,
): Promise<{ volume24hEth: number | null; sales24h: number | null }> {
  if (!apiKey) return { volume24hEth: null, sales24h: null };
  await osAcquire();
  try {
    const res = await fetch(`${OPENSEA_V2}/collections/${slug}/stats`, {
      headers: { "user-agent": UA, accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { volume24hEth: null, sales24h: null };
    const data = (await res.json()) as {
      intervals?: Array<{ interval?: string; volume?: number; sales?: number }>;
    };
    const day = (data.intervals ?? []).find((i) => i.interval === "one_day");
    if (!day) return { volume24hEth: null, sales24h: null };
    return {
      volume24hEth: day.volume != null && Number.isFinite(day.volume) ? day.volume : null,
      sales24h: day.sales != null && Number.isFinite(day.sales) ? day.sales : null,
    };
  } catch {
    return { volume24hEth: null, sales24h: null };
  }
}
