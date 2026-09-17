import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  getCurrentNightState,
  getDecayProgress,
  getCurrentTaxBps,
  nightStateLabel,
  getTimeUntilNextNight,
} from "../src/lib/night-detector.js";
import { DEFAULT_NIGHT_CONFIG } from "../src/lib/night-settings.js";
import { createThrottledClient } from "../src/lib/config.js";
import { parseAbi } from "viem";

const VAULT_ADDRESS = "0xfff716727d7E80E29eab5D3498b7F28431e65C58" as const;
const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;
const ERC20_BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/** bigint-safe JSON serializer */
function serialize<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  ) as T;
}

let potCache: { eth: number | null; at: number } = { eth: null, at: 0 };
const POT_CACHE_TTL_MS = 60_000; // 1 min

async function getVaultPotEth(): Promise<number | null> {
  if (Date.now() - potCache.at < POT_CACHE_TTL_MS) return potCache.eth;
  try {
    const client = createThrottledClient({ rps: 1, burst: 1, coalesce: true });
    const balance = await client.readContract({
      address: WETH_ADDRESS,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [VAULT_ADDRESS],
    });
    const eth = Number(balance) / 1e18;
    potCache = { eth, at: Date.now() };
    return eth;
  } catch {
    return potCache.eth;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const now = new Date();
    const timing = {
      lockStartMinutes: DEFAULT_NIGHT_CONFIG.nightStartMinutes,
      lockEndMinutes: DEFAULT_NIGHT_CONFIG.nightEndMinutes,
      recoveryEndMinutes: DEFAULT_NIGHT_CONFIG.recoveryEndMinutes,
    };

    const [state, progress, taxBps, msUntilNight, potEth] = await Promise.all([
      Promise.resolve(getCurrentNightState(now, timing, DEFAULT_NIGHT_CONFIG.decayDurationSeconds)),
      Promise.resolve(getDecayProgress(now, timing, DEFAULT_NIGHT_CONFIG.decayDurationSeconds)),
      Promise.resolve(getCurrentTaxBps(
        now,
        timing,
        DEFAULT_NIGHT_CONFIG.decayDurationSeconds,
        DEFAULT_NIGHT_CONFIG.maxTaxRate,
        DEFAULT_NIGHT_CONFIG.decayCurve,
      )),
      Promise.resolve(getTimeUntilNextNight(now, timing)),
      getVaultPotEth(),
    ]);

    return res.status(200).json(
      serialize({
        state,
        label: nightStateLabel(state),
        decayProgress: progress,
        taxBps,
        msUntilNight,
        potEth,
        config: DEFAULT_NIGHT_CONFIG,
        now: now.toISOString(),
      }),
    );
  } catch (e) {
    return res.status(500).json({
      error: {
        code: "NIGHT_FAILED",
        message: "night state failed: " + (e as Error).message,
      },
    });
  }
}
