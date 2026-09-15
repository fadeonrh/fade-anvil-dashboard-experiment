import http from "node:http";
import { createThrottledClient } from "./src/lib/config.js";
import { AnvilScanner } from "./src/lib/anvil-combine.js";

const PORT = 3004;

const client = createThrottledClient();
const scanner = new AnvilScanner(client, {
  cacheTtlMs: 60_000,
  openseaApiKey: process.env.OPENSEA_API_KEY ?? "",
});

function serialize(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
  }

  // Markets endpoint
  if (url.pathname === "/api/markets") {
    try {
      console.log("[scan] Starting Anvil market sweep...");
      const force = url.searchParams.get("force") === "true";
      const userKey = url.searchParams.get("openseaKey") || "";

      // If user provided a key, update the scanner and force refresh
      if (userKey) {
        scanner.updateApiKey(userKey);
      }

      const spreads = await scanner.spreads(force);
      console.log(`[scan] Found ${spreads.length} markets`);

      const data = serialize(
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
        }))
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(data));
    } catch (e) {
      console.error("[scan] Error:", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "anvil scan failed: " + e.message }));
    }
  }

  // Serve frontend
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const fs = await import("node:fs/promises");
    const html = await fs.readFile("public/index.html", "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }

  // 404 — serve styled error page for HTML requests, JSON for API
  if (req.headers.accept?.includes("text/html")) {
    const fs = await import("node:fs/promises");
    try {
      const html = await fs.readFile("public/404.html", "utf8");
      res.writeHead(404, { "Content-Type": "text/html" });
      return res.end(html);
    } catch {
      // fallback if 404.html missing
    }
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`\n🚀 FADE Anvil Dashboard running at http://localhost:${PORT}\n`);
  console.log(`   API: http://localhost:${PORT}/api/markets`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
