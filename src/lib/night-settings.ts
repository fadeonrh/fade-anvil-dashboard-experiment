/**
 * Nightshades display parameters — read-only configuration for the dashboard.
 * These are the tuning knobs from robinhood-autoarb's Night system, exposed
 * for monitoring/display only. No trade execution settings included.
 *
 * Groups:
 *   1. Timing — Night windows, decay duration
 *   2. Anti-Snipe — tax thresholds, contract addresses
 *   3. Pot & Liquidity — impact estimation, pool filters
 */

// ─── Timing ──────────────────────────────────────────────────────────

/** Night window start (minutes from midnight EDT). Default 600 = 10:00 AM. */
export const NIGHT_START_MINUTES = envInt("NIGHT_START_MINUTES", 600);

/** Night window end (minutes from midnight EDT). Default 660 = 11:00 AM. */
export const NIGHT_END_MINUTES = envInt("NIGHT_END_MINUTES", 660);

/** Recovery window end (minutes from midnight EDT). Default 780 = 1:00 PM. */
export const RECOVERY_END_MINUTES = envInt("RECOVERY_END_MINUTES", 780);

/** Decay duration in seconds. Default 3600 = 1 hour. */
export const DECAY_DURATION_SECONDS = envInt("DECAY_DURATION_SECONDS", 3600);

/** Maximum tax at decay start. Default 0.99 = 99%. */
export const MAX_TAX_RATE = envFloat("MAX_TAX_RATE", 0.99);

/** Decay curve: "linear" or "exponential". Default "linear". */
export const DECAY_CURVE = envStr("DECAY_CURVE", "linear");

// ─── Anti-Snipe ──────────────────────────────────────────────────────

/** SafeLaunchLensV2 — quotes + views (quoteBuy, quoteSell). */
export const SAFE_LAUNCH_LENS_ADDRESS = envAddr(
  "SAFE_LAUNCH_LENS_ADDRESS",
  "0x25b5Df581f4b2Ed450203f375ad8A28b17F115B3",
);

/** FactionLiquidityVault — holds buy boost + per-faction LP pots. */
export const FACTION_LIQUIDITY_VAULT = envAddr(
  "FACTION_LIQUIDITY_VAULT",
  "0xfff716727d7E80E29eab5D3498b7F28431e65C58",
);

/** Max buy-side tax we're willing to pay (bps). Default 500 = 5%. */
export const MAX_BUY_TAX_BPS = envInt("MAX_BUY_TAX_BPS", 500);

/** Max sell-side tax we're willing to pay (bps). Default 1000 = 10%. */
export const MAX_SELL_TAX_BPS = envInt("MAX_SELL_TAX_BPS", 1000);

// ─── Pot & Liquidity ────────────────────────────────────────────────

/** Minimum pool TVL (ETH) to consider a faction for arb. Default 0.01. */
export const MIN_POOL_TVL_ETH = envFloat("MIN_POOL_TVL_ETH", 0.01);

/** Minimum pot size (ETH) to trigger buy signal. Default 0.005. */
export const MIN_POT_SIZE_ETH = envFloat("MIN_POT_SIZE_ETH", 0.005);

/** Max pot-to-TVL ratio to avoid front-running obvious moves. Default 0.5. */
export const MAX_POT_TO_TVL_RATIO = envFloat("MAX_POT_TO_TVL_RATIO", 0.5);

// ─── Defaults for the dashboard config object ────────────────────────

export interface NightDisplayConfig {
  nightStartMinutes: number;
  nightEndMinutes: number;
  recoveryEndMinutes: number;
  decayDurationSeconds: number;
  maxTaxRate: number;
  decayCurve: string;
  safeLaunchLensAddress: string;
  factionLiquidityVault: string;
  maxBuyTaxBps: number;
  maxSellTaxBps: number;
  minPoolTvlEth: number;
  minPotSizeEth: number;
  maxPotToTvlRatio: number;
}

export const DEFAULT_NIGHT_CONFIG: NightDisplayConfig = {
  nightStartMinutes: NIGHT_START_MINUTES,
  nightEndMinutes: NIGHT_END_MINUTES,
  recoveryEndMinutes: RECOVERY_END_MINUTES,
  decayDurationSeconds: DECAY_DURATION_SECONDS,
  maxTaxRate: MAX_TAX_RATE,
  decayCurve: DECAY_CURVE,
  safeLaunchLensAddress: SAFE_LAUNCH_LENS_ADDRESS,
  factionLiquidityVault: FACTION_LIQUIDITY_VAULT,
  maxBuyTaxBps: MAX_BUY_TAX_BPS,
  maxSellTaxBps: MAX_SELL_TAX_BPS,
  minPoolTvlEth: MIN_POOL_TVL_ETH,
  minPotSizeEth: MIN_POT_SIZE_ETH,
  maxPotToTvlRatio: MAX_POT_TO_TVL_RATIO,
};

// ─── Env helpers ─────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envStr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envAddr(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}
