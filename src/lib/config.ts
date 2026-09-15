import { createPublicClient, http, type PublicClient } from "viem";
import { ROBINHOOD_CHAIN } from "./contracts.js";

export const CHAIN_ID = 4663 as const;

export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

export interface ThrottledRpcOptions {
  rps: number;
  burst: number;
  coalesce: boolean;
}

/**
 * Default RPC pacing — deliberately conservative. The dashboard and alert
 * scanner run as separate processes against the SAME public node, so their
 * per-process budgets add up. Defaults aim to stay well under the node's
 * aggregate limit and leave headroom for the operator's own RPC use.
 *
 * Overridable via env: RPC_RPS (tokens/sec) and RPC_BURST (initial burst).
 * Set them lower to reserve more headroom, higher for faster sweeps.
 */
export function defaultThrottleOptions(env: NodeJS.ProcessEnv = process.env): ThrottledRpcOptions {
  const parseNum = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    rps: parseNum(env.RPC_RPS, 2),
    burst: parseNum(env.RPC_BURST, 3),
    coalesce: true,
  };
}

export function createThrottledClient(
  options: ThrottledRpcOptions = defaultThrottleOptions(),
): PublicClient {
  const rpcUrl = process.env.ROBINHOOD_RPC_URL ?? DEFAULT_RPC_URL;
  return createPublicClient({
    chain: ROBINHOOD_CHAIN,
    batch: {
      multicall: {
        batchSize: 512,
        wait: 50,
      },
    },
    transport: http(rpcUrl, {
      fetchFn: throttledFetch(options),
    }),
  });
}

/**
 * Simple rate-limited fetch wrapper for RPC calls.
 * Uses a token bucket algorithm to stay within RPS limits.
 */
function throttledFetch(options: ThrottledRpcOptions) {
  let tokens = options.burst;
  let lastRefill = Date.now();
  const queue: Array<{ resolve: () => void }> = [];

  function refill() {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    tokens = Math.min(options.burst, tokens + elapsed * options.rps);
    lastRefill = now;
  }

  function acquire(): Promise<void> {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      queue.push({ resolve });
      setTimeout(() => {
        refill();
        if (tokens >= 1) {
          tokens -= 1;
          const item = queue.shift();
          if (item) item.resolve();
        }
      }, 1000 / options.rps);
    });
  }

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    await acquire();
    return fetch(input, init);
  };
}
