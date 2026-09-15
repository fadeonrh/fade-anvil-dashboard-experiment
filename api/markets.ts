import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createThrottledClient } from "../src/lib/config.js";
import { AnvilScanner } from "../src/lib/anvil-combine.js";

// Module-level singleton — persists across warm invocations
let scanner: AnvilScanner | null = null;

function getScanner(): AnvilScanner {
  if (!scanner) {
    const client = createThrottledClient();
    scanner = new AnvilScanner(client, {
      cacheTtlMs: 300_000, // 5 min cache
      openseaApiKey: process.env.OPENSEA_API_KEY ?? "",
    });
  }
  return scanner;
}

/** bigint-safe JSON serializer */
function serialize<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  ) as T;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const force = req.query.force === "true";
    const userKey = typeof req.query.openseaKey === "string" ? req.query.openseaKey : "";
    const anvilScanner = getScanner();

    // If user provided a key, update the scanner and force refresh
    if (userKey) {
      anvilScanner.updateApiKey(userKey);
    }

    const spreads = await anvilScanner.spreads(force);

    return res.status(200).json(
      serialize(
        spreads.map((s) => ({
          marketId: s.state.info.marketId,
          collection: s.state.info.collection,
          collectionName: s.state.collectionName,
          collectionSymbol: s.state.collectionSymbol,
          token: s.state.info.token,
          tokenSymbol: s.state.tokenSymbol,
          amm: s.state.info.amm,
          tokensPerNFT: s.state.info.tokensPerNFT,
          randomFeeBps: s.state.info.randomFeeBps,
          specificFeeBps: s.state.info.specificFeeBps,
          inventorySize: s.state.quote?.inventorySize ?? 0,
          anvilFloorEth: s.anvilFloorEth,
          tokenPriceEth: s.dex.tokenPriceEth,
          poolTvlUsd: s.dex.poolTvlUsd,
          dexId: s.dex.dexId,
          osSlug: s.opensea.slug,
          osFloorEth: s.opensea.floorEth,
          osFloorOfferEth: s.opensea.floorOfferEth,
          osFloorListings: s.opensea.floorListings,
          osTotalListings: s.opensea.totalListings,
          volume24hEth: s.opensea.volume24hEth,
          sales24h: s.opensea.sales24h,
          spread: s.spread,
          observedAtMs: s.state.observedAtMs,
          // Clutch.market metadata
          verified: s.state.clutch?.verified ?? false,
          liquidityLocked: s.state.clutch?.liquidityLocked ?? false,
          liquiditySoftLocked: s.state.clutch?.liquiditySoftLocked ?? false,
          specialProject: s.state.clutch?.specialProject ?? false,
          governanceEnabled: s.state.clutch?.governanceEnabled ?? false,
          cto: s.state.clutch?.cto ?? false,
          deprecated: s.state.clutch?.deprecated ?? false,
          clutchTvl: s.state.clutch?.tvl ?? 0,
          clutchApr: s.state.clutch?.apr ?? 0,
          clutchUtilization: s.state.clutch?.utilization ?? 0,
          clutchTotalSupply: s.state.clutch?.totalSupply ?? 0,
          clutchCirculatingSupply: s.state.clutch?.circulatingSupply ?? 0,
          clutchNftCount: s.state.clutch?.nftCount ?? 0,
          verifiedNote: s.state.clutch?.verifiedNote ?? "",
          liquidityLockedNote: s.state.clutch?.liquidityLockedNote ?? "",
        })),
      ),
    );
  } catch (e) {
    console.error("Anvil scan failed:", e);
    return res.status(500).json({ error: "anvil scan failed: " + (e as Error).message });
  }
}
