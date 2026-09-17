# F-A-D-E Anvil Dashboard

Real-time NFT arbitrage dashboard for the **Anvil AMM** on **Robinhood Chain (4663)**. Scans every Anvil market, computes buy/sell spreads against OpenSea floors, and classifies liquidity.

**FADE Token:** `0x83C65Dc8857Dc07489cDbeC6Be7A84C35A95fADe`

## What It Does

For each Anvil AMM market the dashboard:

1. Fetches the on-chain AMM floor (tokens required to buy an NFT)
2. Reads the DEX token price from DexScreener
3. Computes exact swap cost via Uniswap V3 pool math
4. Pulls OpenSea floor listing and highest bid
5. Reads on-chain ERC-2981 royalty per collection
6. Calculates net spread (buy cost vs sell proceeds, minus fees, royalty, and gas)
7. Classifies the market as **tradable**, **thin**, or **dead**

The dashboard also displays the **Nightshades** Night phase (Night/Sunrise/Day), countdown to next Night, and total pot value.

## Links

- [X / Twitter](https://x.com/FadeonRH)
- [Telegram](https://t.me/FadeOnRH)
- [GitHub](https://github.com/fadeonrh)
- [Dexscreener](https://dexscreener.com/robinhood/0x7cecd91c194f6ec30b35e4a17da7c52f4411ffe6)

## Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/fadeonrh/fade-anvil-dashboard)

## Local Development

### Prerequisites

- Node.js >= 20
- npm

### Setup

```bash
git clone https://github.com/fadeonrh/fade-anvil-dashboard.git
cd fade-anvil-dashboard
npm install
```

### Run

```bash
npm run dev
```

Dashboard available at `http://localhost:3000`.

### Alternative: Standalone Server

No Vercel CLI required:

```bash
npm start
# or
npx tsx bin/fade-anvil.js
```

Runs on port `3004`. Serves the frontend, API endpoints, and static files.

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vercel dev server (port 3000) |
| `npm start` | Standalone server (port 3004) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests only |

## Environment Variables

All optional. Copy `.env.example` to `.env` to customize.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSEA_API_KEY` | *(none)* | OpenSea API key. Enables floor/offer data. Without it, OS data is disabled. |
| `ROBINHOOD_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | Custom RPC endpoint for Robinhood Chain. |
| `RPC_RPS` | `10` | RPC requests per second (token bucket). |
| `RPC_BURST` | `12` | RPC burst capacity (token bucket). |

### Getting an OpenSea API Key

1. Go to [docs.opensea.io/reference/request-an-api-key](https://docs.opensea.io/reference/request-an-api-key)
2. Create an account and request a key
3. Set it as `OPENSEA_API_KEY` in your Vercel dashboard or `.env` file

Users can also provide their own key via the dashboard UI (stored in browser localStorage, sent as a query parameter, never stored server-side).

## API Endpoints

Interactive API documentation available at `/openapi.json` (OpenAPI 3.0 spec).

### `GET /api/markets`

Returns all Anvil AMM markets with spread data as a JSON array.

**Query Parameters:**

| Param | Description |
|-------|-------------|
| `force` | `true` to bypass 5-minute cache |
| `openseaKey` | User-provided OpenSea API key |

**Example Request:**

```bash
curl http://localhost:3004/api/markets
curl "http://localhost:3004/api/markets?force=true&openseaKey=YOUR_KEY"
```

**Example Response:**

```json
[
  {
    "marketId": 4,
    "collection": "0x1234...abcd",
    "collectionName": "Yardkeepers",
    "collectionSymbol": "YARD",
    "token": "0x5678...ef01",
    "tokenSymbol": "YARD",
    "amm": "0x9abc...def2",
    "tokensPerNFT": "1000000000000000000",
    "randomFeeBps": 10,
    "specificFeeBps": 15,
    "inventorySize": 2583,
    "anvilFloorEth": 0.18267,
    "tokenPriceEth": 0.00018267,
    "poolTvlUsd": 507000,
    "dexId": "robinhood",
    "osSlug": "yardkeepers",
    "osFloorEth": 0.34,
    "osFloorOfferEth": 0.144,
    "osFloorListings": 4,
    "osTotalListings": 12,
    "volume24hEth": 0.153,
    "sales24h": 1,
    "spread": {
      "tradable": true,
      "reason": "spread 375% / 0.384850 ETH",
      "netSpreadEth": 0.38485,
      "netSpreadPct": 375,
      "netSpreadOfferEth": 0.285,
      "buyTotalEth": 0.102,
      "gasEth": 0.00065,
      "liquidityClass": "liquid",
      "warnings": []
    },
    "observedAtMs": 1789478666342,
    "verified": true,
    "liquidityLocked": true,
    "liquiditySoftLocked": false,
    "specialProject": false,
    "governanceEnabled": false,
    "cto": false,
    "deprecated": false,
    "clutchTvl": 2601,
    "clutchApr": 186.5,
    "clutchUtilization": 77.5,
    "clutchTotalSupply": 1000000000,
    "clutchCirculatingSupply": 219620000,
    "clutchNftCount": 3300,
    "verifiedNote": "",
    "liquidityLockedNote": ""
  }
]
```

**Error Response (500):**

```json
{
  "error": {
    "code": "SCAN_FAILED",
    "message": "anvil scan failed: <details>",
    "doc_url": "https://github.com/fadeonrh/fade-anvil-dashboard#api-endpoints"
  }
}
```

### `GET /api/health`

Returns liveness probe with analytics.

**Example Request:**

```bash
curl http://localhost:3004/api/health
```

**Example Response:**

```json
{
  "ok": true,
  "timestamp": 1789478666342,
  "version": "1.3.0",
  "uptime": 3600,
  "scanCount": 42,
  "requestCount": 1337
}
```

### `GET /api/analytics`

Returns full analytics snapshot (in-memory, resets on restart).

**Example Request:**

```bash
curl http://localhost:3004/api/analytics
```

**Example Response:**

```json
{
  "uptime": 3600,
  "startedAt": 1789475066342,
  "now": 1789478666342,
  "requests": {
    "total": 1337,
    "byEndpoint": {
      "/api/markets": { "count": 42, "errors": 0, "totalTimeMs": 126000, "lastAccessedAt": 1789478666342 },
      "/api/health": { "count": 1295, "errors": 0, "totalTimeMs": 6475, "lastAccessedAt": 1789478666342 }
    },
    "perMinute": [0, 0, 0, 5, 3, 2, 1, 0, 0, 0, "...60 values..."]
  },
  "scans": {
    "count": 42,
    "success": 42,
    "failed": 0,
    "totalMarkets": 924,
    "minMarkets": 20,
    "maxMarkets": 25,
    "totalTimeMs": 630000,
    "lastScanAt": 1789478666342
  },
  "errors": {
    "total": 0,
    "byCode": {}
  },
  "responseTimes": {
    "p50": 50,
    "p95": 200,
    "p99": 500,
    "avg": 75
  },
  "markets": {
    "lastCount": 22,
    "avgPerScan": 22
  }
}
```

### `GET /api/night`

Returns current Nightshades Night state, phase, pot value, and config.

**Example Request:**

```bash
curl http://localhost:3004/api/night
```

**Example Response:**

```json
{
  "state": "normal",
  "label": "Day",
  "decayProgress": null,
  "taxBps": null,
  "msUntilNight": 7200000,
  "potEth": 13.7268,
  "config": {
    "nightStartMinutes": 600,
    "nightEndMinutes": 660,
    "recoveryEndMinutes": 780,
    "decayDurationSeconds": 3600,
    "maxTaxRate": 0.99,
    "decayCurve": "linear",
    "safeLaunchLensAddress": "0x25b5Df581f4b2Ed450203f375ad8A28b17F115B3",
    "factionLiquidityVault": "0xfff716727d7E80E29eab5D3498b7F28431e65C58",
    "maxBuyTaxBps": 500,
    "maxSellTaxBps": 1000,
    "minPoolTvlEth": 0.01,
    "minPotSizeEth": 0.005,
    "maxPotToTvlRatio": 0.5
  },
  "now": "2026-09-17T16:00:00.000Z"
}
```

**Night States:**

| State | Time (EDT) | Description |
|-------|------------|-------------|
| `night_locked` | 10:00–11:00 AM | All faction trading paused |
| `decay` | 11:00 AM–12:00 PM | Anti-snipe tax decays 99% → 0% |
| `recovery` | 12:00–1:00 PM | Trading resumes, recovery window |
| `normal` | All other times | Standard trading |

### `GET /nonexistent` (404)

HTML requests receive a styled 404 page. API requests (no `Accept: text/html`) receive:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "not found"
  }
}
```

## Analytics Dashboard

A full analytics dashboard is available at `/analytics.html`. It displays:

- **Request metrics**: total requests, per-endpoint breakdown, request rate chart (last 60 min)
- **Scan statistics**: count, success/fail, avg duration, markets per scan
- **Response times**: P50, P95, P99, AVG percentiles
- **Error tracking**: count by error code, error rate percentage

Analytics are stored in-memory and reset on server restart.

## Spread Formula

```
Buy Cost:
  tokensEth = DEX swap cost (V3 pool quote + flat fee ~$2)
  gasEth    = gas for DEX swap + AMM buy + OpenSea sell

Sell Proceeds:
  floorEth  = OpenSea floor listing
  bidEth    = OpenSea highest bid
  feeEth    = 2.5% OpenSea marketplace fee
  royalty   = on-chain ERC-2981 royalty (per collection)

Net Spread:
  spreadEth = sellProceeds - buyCost - gas
  spreadPct = spreadEth / buyCost * 100
```

Markets are classified as:
- **Tradable**: spread >= 15% AND >= 0.001 ETH AND >= 2 floor listings
- **Thin**: spread exists but below thresholds
- **Dead**: zero 24h sales on OpenSea

## Architecture

- **Frontend**: Single HTML file with Alpine.js (CDN), inline CSS/JS
- **Backend**: Vercel serverless functions (TypeScript)
- **On-chain**: viem library for RPC calls with multicall batching + token-bucket rate limiting
- **Cache**: 5-minute TTL for market scans, 5-minute for floor/offer, 30-minute for stats, 1-hour for slug/royalty
- **Analytics**: In-memory counters (requests, scans, errors, response times)
- **Data Sources**: Robinhood Chain RPC, DexScreener API, OpenSea V2 API, clutch.market API
- **Nightshades**: Time-based Night state machine + on-chain pot reads
- **Royalty**: ERC-2981 on-chain royalty reader (per collection)
- **API Spec**: OpenAPI 3.0 at `/openapi.json`

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical deep-dive.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Alpine.js, Orbitron + Share Tech Mono fonts |
| Backend | Vercel Serverless, TypeScript |
| On-chain | viem, Uniswap V3 pool math, Multicall3 batching |
| APIs | DexScreener, OpenSea V2, clutch.market |
| Nightshades | Time-based state machine, on-chain vault reads |
| Royalty | ERC-2981 on-chain reader |
| Analytics | In-memory counters, canvas charts |
| Chain | Robinhood Chain (4663) |
| Deploy | Vercel |
| CI/CD | GitHub Actions |
| Testing | Node.js test runner (41 tests) |

## License

MIT
