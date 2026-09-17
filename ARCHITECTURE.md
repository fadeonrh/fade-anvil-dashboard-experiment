# Architecture

Technical deep-dive into the F-A-D-E Anvil Dashboard.

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (SPA)                         │
│  Alpine.js ─── fetch /api/markets ──→ render table      │
│  Alpine.js ─── fetch /api/night ────→ Night card        │
│  Auto-refresh 60s · Dark/light · localStorage prefs     │
│  /analytics.html ──→ fetch /api/analytics ──→ charts    │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────┐
│              Vercel Serverless Functions                  │
│                                                          │
│  GET /api/markets                                        │
│    └─ AnvilScanner.spreads()                             │
│         ├─ scanAnvilMarkets()     ← multicall batched    │
│         ├─ readTokenDex()         ← DexScreener pricing  │
│         ├─ resolveOpenSeaSlug()   ← slug (cached 1hr)    │
│         ├─ readOpenSeaFloor()     ← floor (cached 5min)  │
│         ├─ readOpenSeaFloorOffer()← offer (cached 5min)  │
│         ├─ readOpenSeaLiquidity() ← 24h volume/sales     │
│         ├─ readRoyaltyBps()       ← ERC-2981 royalty     │
│         ├─ readV3Pool()           ← V3 pool state        │
│         ├─ wethInForExactOut()    ← exact swap cost      │
│         └─ computeAnvilSpread()   ← pure math            │
│                                                          │
│  GET /api/night                                          │
│    └─ getCurrentNightState() + getVaultPotEth()          │
│                                                          │
│  GET /api/health  ← uptime, scanCount, requestCount      │
│  GET /api/analytics ← full analytics snapshot            │
│                                                          │
│  src/lib/analytics.ts ← in-memory counters               │
│    ├─ trackRequest()  ← per-endpoint, per-minute         │
│    ├─ trackScan()     ← success/fail, duration, markets  │
│    └─ getSnapshot()   ← P50/P95/P99, error breakdown     │
└──────────────────────────┬──────────────────────────────┘
                           │ RPC / HTTPS
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Robinhood Chain    DexScreener API    OpenSea V2 API
   (viem public       (token prices,     (floor, bids,
    client, multicall  pool TVL)          volume, sales)
    batching + token-
    bucket rate lim)
```

## Project Structure

```
fade-anvil-dashboard/
├── api/                          # Vercel serverless handlers
│   ├── markets.ts                # GET /api/markets — full scan + spread
│   ├── night.ts                  # GET /api/night — Nightshades state + config
│   ├── health.ts                 # GET /api/health — liveness + analytics
│   └── analytics.ts              # GET /api/analytics — full snapshot
│
├── src/lib/                      # Core TypeScript library
│   ├── config.ts                 # RPC client with token-bucket rate limiting
│   ├── contracts.ts              # Chain defs, contract addresses, ABI fragments
│   ├── anvil.ts                  # Market scanner — multicall batching, OpenSea caching
│   ├── anvil-spread.ts           # Pure spread computation (includes royalty)
│   ├── anvil-combine.ts          # AnvilScanner orchestrator class
│   ├── v3-pool.ts                # Uniswap V3 constant-product math
│   ├── analytics.ts              # In-memory analytics engine
│   ├── night-detector.ts         # Night state machine (4 states, decay progress)
│   ├── night-settings.ts         # Display-only Nightshades parameters
│   └── erc2981-royalty.ts        # On-chain ERC-2981 royalty reader
│
├── bin/
│   └── fade-anvil.js             # Standalone launcher (npx / npm start)
│
├── public/
│   ├── index.html                # Dashboard SPA (~840 lines)
│   ├── analytics.html            # Analytics dashboard (~350 lines)
│   ├── 404.html                  # Styled error page
│   └── openapi.json              # OpenAPI 3.0 spec
│
├── tests/
│   ├── unit/
│   │   ├── anvil-spread.test.ts  # 22 spread math tests
│   │   └── v3-pool.test.ts       # 9 V3 pool tests
│   └── integration/
│       └── api.test.ts           # 10 API integration tests
│
├── .github/workflows/ci.yml     # GitHub Actions CI
├── vercel.json                   # Build + routing config
├── package.json                  # Scripts, deps, bin entry
└── tsconfig.json                 # TypeScript config
```

## Data Pipeline

A full market sweep runs ~15+ external requests. The pipeline:

### 1. Market Discovery (`anvil.ts`)

Two discovery paths, tried in order:

1. **clutch.market API** — fetches all markets with metadata (verified badges, TVL, APR, governance). Cached for 5 minutes.
2. **On-chain factory** — reads `marketCount()` from `AMMFactory` at `0x8b186717a20845b514344b17fd5e198aDCab9069`, then calls `getMarket(id)` for each.

Markets 1, 2, 3 are excluded (test markets / dead markets).

### 2. Per-Market Enrichment

For each discovered market, concurrently:

| Step | Source | Data |
|------|--------|------|
| DEX pricing | DexScreener API | Token ETH price, pool TVL, pool address |
| OpenSea slug | OpenSea API | Collection slug resolution |
| Floor listing | OpenSea API | Cheapest active listing price |
| Floor offer | OpenSea API | Highest collection-wide bid |
| 24h liquidity | OpenSea API | Volume + sales count (30-min cache per slug) |
| V3 pool state | On-chain RPC | `slot0`, `liquidity`, `fee`, `token0`, `token1` |

### 3. Spread Computation (`anvil-spread.ts`)

Pure math, no I/O:

```
Buy Cost:
  dexSwapCost   = wethInForExactOut(pool, tokensNeeded)   // exact V3 quote
  flatFee       = ~$2 (Robinhood Chain swap fee)
  gasCost       = gasPrice × (buyGas + sellGas)

Sell Proceeds:
  floorProceeds = osFloor × (1 − 2.5% marketplace fee)
  bidProceeds   = osBid × (1 − 2.5% marketplace fee)

Net Spread:
  spreadEth     = floorProceeds − dexSwapCost − flatFee − gasCost
  spreadPct     = spreadEth / totalCost × 100
```

### 4. Classification

| Status | Criteria |
|--------|----------|
| **Tradable** | spread >= 15% AND >= 0.001 ETH AND >= 2 floor listings |
| **Thin** | Spread exists but below thresholds |
| **Dead** | Zero 24h sales on OpenSea |

### 4b. Nightshades State Machine

`night-detector.ts` implements a pure time-based state machine:

| State | Time (EDT) | Description |
|-------|------------|-------------|
| `night_locked` | 10:00–11:00 AM | All faction trading paused |
| `decay` | 11:00 AM–12:00 PM | Anti-snipe tax decays 99% → 0% |
| `recovery` | 12:00–1:00 PM | Trading resumes, recovery window |
| `normal` | All other times | Standard trading |

Decay progress is computed as a fraction of `decayDurationSeconds`. Tax rate uses linear or exponential curve based on `decayCurve` config.

### 4c. ERC-2981 Royalty

`erc2981-royalty.ts` reads on-chain royalties per collection:

1. Calls `royaltyInfo(tokenId=1, salePrice=10000e18)` on the collection contract
2. Computes bps: `royaltyAmount * 10000 / salePrice`
3. Caches per collection for 1 hour
4. Falls back to 0 bps if contract doesn't implement ERC-2981

Royalty is merged into the spread config per market, reducing sell proceeds by the royalty percentage.

### 5. Caching

| Cache | TTL | Scope |
|-------|-----|-------|
| Market scan | 5 min | Full sweep result |
| OpenSea slug | 1 hour | Per collection address |
| OpenSea floor | 5 min | Per slug |
| OpenSea offer | 5 min | Per slug |
| OpenSea stats | 30 min | Per-slug volume/sales |
| ERC-2981 royalty | 1 hour | Per collection address |
| clutch.market | 5 min | All-markets metadata |
| Dedup in-flight | — | Prevents concurrent sweeps |

## Analytics Engine (`analytics.ts`)

In-memory analytics tracking for the dashboard and API.

### Tracked Metrics

| Metric | Granularity | Storage |
|--------|-------------|---------|
| Request count | Per-endpoint | `endpoints[name].count` |
| Request errors | Per-endpoint + error code | `endpoints[name].errors`, `errorCodes[code]` |
| Response times | Last 10,000 samples | `responseTimesMs[]` (for P50/P95/P99) |
| Scan count | Total + success/failed | `scanStats` object |
| Markets per scan | Min/max/avg | `scanStats.totalMarkets` |
| Request rate | Per-minute buckets (last 60 min) | `minuteBuckets[60]` |

### Data Flow

```
Request arrives
  → trackRequest(endpoint, duration, isError, errorCode?)
    → rotates minute buckets
    → updates endpoint stats
    → pushes to responseTimesMs (capped at 10K)

Scan completes
  → trackScan(marketsCount, duration, success)
    → updates scanStats
    → tracks min/max markets

Analytics requested
  → getSnapshot()
    → computes percentiles from responseTimesMs
    → returns full state
```

### Limitations

- **In-memory only** — resets on server restart
- **No persistence** — no JSONL, no database
- **No user tracking** — counts requests, not users
- **Single instance** — no cross-instance aggregation

## Rate Limiting

### RPC (Token Bucket)

`config.ts` wraps the fetch function with a token bucket:

- **Default**: 10 tokens/sec, burst 12
- Tokens refill continuously
- When empty, requests queue and wait
- Purpose: stay under the public node's aggregate limit (dashboard + alert scanner share the same node)

### OpenSea

- Sequential queue at 10 req/s (100ms interval)
- User-provided API keys accepted via `?openseaKey=` query param
- Never stored server-side
- Slug resolution cached 1 hour, floor/offer cached 5 minutes

## V3 Pool Math (`v3-pool.ts`)

Computes exact WETH input for a given collection token output using the Uniswap V3 constant-product formula:

1. Read live pool state: `slot0` (sqrtPriceX96), `liquidity`, `fee`, `token0/token1`
2. Determine swap direction (which token is WETH)
3. Compute sqrt-price movement from the output amount
4. Apply thin-pool guard: rejects if swap would move price > 25% (crosses ticks)
5. Add pool fee on top

The legacy model priced tokens linearly (amount × spot × slippage), ignoring price impact. This module gives the true swap cost.

## Frontend

### Dashboard (`index.html`)

Single HTML file, zero build step:

- **Alpine.js** (CDN) — reactive data binding
- **Fonts**: Orbitron (display) + Share Tech Mono (monospace)
- **Theme**: Dark/light toggle, persisted in localStorage
- **Effects**: CRT scanline overlay, neon glow CSS
- **Auto-refresh**: Fetches `/api/markets` every 60 seconds
- **OpenSea key**: User provides via UI, stored in localStorage, sent as query param
- **Hide markets**: Individual markets can be hidden, persisted in localStorage
- **Social links**: X, Telegram, GitHub, Dexscreener (Arcticons logo)

### Analytics (`analytics.html`)

Full analytics dashboard:

- **Stat cards**: Total requests, scans, errors, uptime
- **Request rate chart**: Canvas bar chart, last 60 minutes
- **Response times**: P50/P95/P99/AVG percentiles
- **Scan statistics**: Count, avg duration, markets per scan
- **Endpoint breakdown**: Per-endpoint request counts, error rates, share bars
- **Error breakdown**: Error count by code with share bars
- **Auto-refresh**: Fetches `/api/analytics` every 5 seconds
- **Theme**: Dark/light toggle, persisted in localStorage

### 404 Page (`404.html`)

Styled error page with FADE branding, social links, and back-to-dashboard button.

## Key Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| AMMFactory | `0x8b186717a20845b514344b17fd5e198aDCab9069` | Market registry |
| BatchRouter | `0x02eA25c9B75D98E4D5c90BEe999493095C2Da3F1` | Batch operations |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | Wrapped ETH on Robinhood Chain |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Multicall batching |

See `src/lib/contracts.ts` for the full address list.

## Manual ABI Decoding

The scanner uses raw hex parsing (`word()`, `wordAddr()`, `decodeString()`) instead of viem's ABI decoding for the factory reads. This handles the 13-word `getMarket()` struct layout directly, avoiding ABI encoding overhead for the high-frequency batch reads.

## Deployment

- **Platform**: Vercel
- **Build**: TypeScript compiled by `tsc`, Vercel handles the rest
- **Routing**: `/api/*` → serverless functions, `/*` → `public/` static files
- **Runtime**: Node.js >= 20
- **CI/CD**: GitHub Actions (typecheck + tests on Node 20/22)
- **API Spec**: OpenAPI 3.0 at `/openapi.json`
