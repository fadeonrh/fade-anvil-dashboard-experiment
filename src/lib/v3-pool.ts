/**
 * Uniswap V3 pool math for the Anvil scan — compute the exact WETH input
 * needed to buy a given number of collection tokens on the token's DEX pool.
 *
 * The legacy spread model priced the token buy linearly (tokens × spot price
 * × slippage), which ignores both the pool's swap fee and price impact. This
 * module reads the live pool (slot0 → sqrtPriceX96, liquidity, fee) and
 * computes the true `amountIn` for the exact `amountOut` using the V3
 * constant-product formula inside the current tick range.
 *
 * Direction normalisation: the collection token can sit on either side of the
 * WETH pair (token0 or token1). We always sell WETH to receive the collection
 * token, moving the sqrt-price in whichever direction that swap implies.
 */
import type { PublicClient } from "viem";
import { getFunctionSelector } from "viem";

const Q96 = 1n << 96n;
const FEE_DENOMINATOR = 1_000_000n;

/** Robinhood Chain WETH (canonical). */
export const ANVIL_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

const SEL = {
  slot0: getFunctionSelector("slot0()"),
  liquidity: getFunctionSelector("liquidity()"),
  fee: getFunctionSelector("fee()"),
  token0: getFunctionSelector("token0()"),
  token1: getFunctionSelector("token1()"),
} as const;

export interface V3PoolState {
  /** sqrtPriceX96 — sqrt(token1/token0) in Q96. */
  sqrtPriceX96: bigint;
  liquidity: bigint;
  fee: bigint;
  token0: `0x${string}`;
  token1: `0x${string}`;
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return a === 0n ? 0n : (a - 1n) / b + 1n;
}

function word(hex: `0x${string}`, i: number): bigint {
  return BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
}
function wordAddr(hex: `0x${string}`, i: number): `0x${string}` {
  return ("0x" + hex.slice(2 + i * 64 + 24, 2 + (i + 1) * 64)) as `0x${string}`;
}
/** sqrtPriceX96 is uint160 — right-aligned in word 0 of slot0(). */
function sqrtFromSlot0(hex: `0x${string}`): bigint {
  return BigInt("0x" + hex.slice(2 + 64 - 40, 2 + 64));
}

export async function readV3Pool(
  client: PublicClient,
  pool: `0x${string}`,
): Promise<V3PoolState | null> {
  try {
    const [slot0, liqHex, feeHex, t0Hex, t1Hex] = await Promise.all([
      client.call({ to: pool, data: SEL.slot0 }),
      client.call({ to: pool, data: SEL.liquidity }),
      client.call({ to: pool, data: SEL.fee }),
      client.call({ to: pool, data: SEL.token0 }),
      client.call({ to: pool, data: SEL.token1 }),
    ]);
    if (!slot0.data || !liqHex.data || !feeHex.data || !t0Hex.data || !t1Hex.data) return null;
    const liquidity = word(liqHex.data, 0);
    if (liquidity === 0n) return null;
    return {
      sqrtPriceX96: sqrtFromSlot0(slot0.data),
      liquidity,
      fee: word(feeHex.data, 0),
      token0: wordAddr(t0Hex.data, 0),
      token1: wordAddr(t1Hex.data, 0),
    };
  } catch {
    return null;
  }
}

/**
 * WETH input for an exact collection-token output, selling WETH on the pool.
 * Returns null when the output would push the swap past the current tick
 * (pool too thin for the size) or the pool doesn't pair against WETH.
 */
export function wethInForExactOut(
  state: V3PoolState,
  amountOutTokenWei: bigint,
): bigint | null {
  const weth = ANVIL_WETH.toLowerCase();
  const t0 = state.token0.toLowerCase();
  const t1 = state.token1.toLowerCase();

  if (amountOutTokenWei <= 0n) return 0n;
  if (state.liquidity <= 0n) return null;
  if (state.fee >= FEE_DENOMINATOR) return null;

  // token0 = WETH, token1 = collection: sell WETH (token0), receive token1.
  // price (token1/token0) drops → sqrtPrice decreases.
  if (t0 === weth && t1 !== weth) {
    const sqrtP = state.sqrtPriceX96;
    const delta = ceilDiv(amountOutTokenWei * Q96, state.liquidity);
    // Swap pushing the price more than ~25% past the current tick means the
    // pool is too thin for this size — the one-tick formula would be wildly
    // wrong (crosses ticks). Signal "can't quote" instead of a fake number.
    if (delta * 4n > sqrtP) return null;
    const sqrtNext = sqrtP - delta;
    const amount0 = ceilDiv(state.liquidity * Q96, sqrtNext) - ceilDiv(state.liquidity * Q96, sqrtP);
    return ceilDiv(amount0 * FEE_DENOMINATOR, FEE_DENOMINATOR - state.fee);
  }

  // token1 = WETH, token0 = collection: sell WETH (token1), receive token0.
  // price (token1/token0) rises → sqrtPrice increases.
  if (t1 === weth && t0 !== weth) {
    const sqrtP = state.sqrtPriceX96;
    const delta = ceilDiv(amountOutTokenWei * Q96, state.liquidity);
    // Same thin-pool guard, symmetric direction.
    if (delta * 4n > sqrtP) return null;
    const sqrtNext = sqrtP + delta;
    const amount1 = ceilDiv(state.liquidity * (sqrtNext - sqrtP), Q96);
    return ceilDiv(amount1 * FEE_DENOMINATOR, FEE_DENOMINATOR - state.fee);
  }

  return null;
}
