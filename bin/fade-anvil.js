#!/usr/bin/env -S npx tsx
import http from "node:http";
import { createThrottledClient } from "../src/lib/config.js";
import { AnvilScanner } from "../src/lib/anvil-combine.js";
import { trackRequest, trackScan, getSnapshot } from "../src/lib/analytics.js";
import {
  getCurrentNightState,
  getDecayProgress,
  getCurrentTaxBps,
  nightStateLabel,
  getTimeUntilNextNight,
} from "../src/lib/night-detector.js";
import { DEFAULT_NIGHT_CONFIG } from "../src/lib/night-settings.js";
import { parseAbi } from "viem";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3004", 10);

const client = createThrottledClient();
const scanner = new AnvilScanner(client, {
  cacheTtlMs: 300_000,
  openseaApiKey: process.env.OPENSEA_API_KEY ?? "",
});

const VAULT_ADDRESS = "0xfff716727d7E80E29eab5D3498b7F28431e65C58";
const WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

let potCache = { eth: null, at: 0 };
async function getVaultPotEth() {
  if (Date.now() - potCache.at < 60_000) return potCache.eth;
  try {
    const balance = await client.readContract({ address: WETH_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [VAULT_ADDRESS] });
    const eth = Number(balance) / 1e18;
    potCache = { eth, at: Date.now() };
    return eth;
  } catch { return potCache.eth; }
}

function serialize(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
  );
}

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/health") {
    const snapshot = getSnapshot();
    trackRequest("/api/health", Date.now() - start, false);
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      timestamp: Date.now(),
      version: "1.2.0",
      uptime: snapshot.uptime,
      scanCount: snapshot.scans.count,
      requestCount: snapshot.requests.total,
    }));
  }

  if (url.pathname === "/api/analytics") {
    trackRequest("/api/analytics", Date.now() - start, false);
    const snapshot = getSnapshot();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(snapshot));
  }

  if (url.pathname === "/api/night") {
    trackRequest("/api/night", Date.now() - start, false);
    const now = new Date();
    const timing = {
      lockStartMinutes: DEFAULT_NIGHT_CONFIG.nightStartMinutes,
      lockEndMinutes: DEFAULT_NIGHT_CONFIG.nightEndMinutes,
      recoveryEndMinutes: DEFAULT_NIGHT_CONFIG.recoveryEndMinutes,
    };
    const state = getCurrentNightState(now, timing, DEFAULT_NIGHT_CONFIG.decayDurationSeconds);
    const progress = getDecayProgress(now, timing, DEFAULT_NIGHT_CONFIG.decayDurationSeconds);
    const taxBps = getCurrentTaxBps(
      now, timing,
      DEFAULT_NIGHT_CONFIG.decayDurationSeconds,
      DEFAULT_NIGHT_CONFIG.maxTaxRate,
      DEFAULT_NIGHT_CONFIG.decayCurve,
    );
    const msUntilNight = getTimeUntilNextNight(now, timing);
    const potEth = await getVaultPotEth();
    const data = serialize({
      state,
      label: nightStateLabel(state),
      decayProgress: progress,
      taxBps,
      msUntilNight,
      potEth,
      config: DEFAULT_NIGHT_CONFIG,
      now: now.toISOString(),
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(data));
  }

  if (url.pathname === "/api/markets") {
    try {
      console.log("[scan] Starting Anvil market sweep...");
      const force = url.searchParams.get("force") === "true";
      const userKey = url.searchParams.get("openseaKey") || "";
      if (userKey) scanner.updateApiKey(userKey);
      const spreads = await scanner.spreads(force);
      const duration = Date.now() - start;
      trackScan(spreads.length, duration, true);
      trackRequest("/api/markets", duration, false);
      console.log(`[scan] Found ${spreads.length} markets`);
      const data = serialize(spreads.map((s) => ({
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
        royaltyBps: s.royaltyBps,
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
      })));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(data));
    } catch (e) {
      const duration = Date.now() - start;
      console.error("[scan] Error:", e.message);
      trackScan(0, duration, false);
      trackRequest("/api/markets", duration, true, "SCAN_FAILED");
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        error: { code: "SCAN_FAILED", message: "anvil scan failed: " + e.message, doc_url: "https://github.com/fadeonrh/fade-anvil-dashboard#api-endpoints" },
      }));
    }
  }

  // Serve frontend
  const publicDir = path.resolve(__dirname, "../public");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await fs.readFile(path.join(publicDir, "index.html"), "utf8");
    trackRequest(url.pathname, Date.now() - start, false);
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }

  // Serve static files from public/
  const safePath = url.pathname.replace(/\.\./g, "");
  const filePath = path.join(publicDir, safePath);
  try {
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        ".json": "application/json",
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
      };
      const content = await fs.readFile(filePath);
      trackRequest(url.pathname, Date.now() - start, false);
      res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
      return res.end(content);
    }
  } catch {}

  // 404
  trackRequest(url.pathname, Date.now() - start, true, "NOT_FOUND");
  if (req.headers.accept?.includes("text/html")) {
    try {
      const html = await fs.readFile(path.join(publicDir, "404.html"), "utf8");
      res.writeHead(404, { "Content-Type": "text/html" });
      return res.end(html);
    } catch {}
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }));
});

server.listen(PORT, () => {
  console.log(`\n  FADE Anvil Dashboard running at http://localhost:${PORT}\n`);
  console.log(`   API: http://localhost:${PORT}/api/markets`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
