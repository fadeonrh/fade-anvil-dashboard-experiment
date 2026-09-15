# Architecture

Technical deep-dive into the F-A-D-E Anvil Dashboard.

## Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (SPA)                         │
│  Alpine.js ─── fetch /api/markets ──→ render table      │
│  Auto-refresh 60s · Dark/light · localStorage prefs     │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP
┌──────────────────────────▼──────────────────────────────┐
│              Vercel Serverless Functions                  │
│                                                          │
│  GET /api/markets                                        │
│    └─ AnvilScanner.spreads()                             │
│         ├─ scanAnvilMarkets()     ← on-chain discovery   │
│         ├─ readTokenDex()         ← DexScreener pricing  │
│         ├─ readOpenSeaFloor()     ← OpenSea listings     │
│         ├─ readOpenSeaFloorOffer()← OpenSea bids         │
│         ├─ readOpenSeaLiquidity() ← 24h volume/sales     │
│         ├─ readV3Pool()           ← V3 pool state        │
│         ├─ wethInForExactOut()    ← exact swap cost      │
│         └─ computeAnvilSpread()   ← pure math            │
│                                                          │
│  GET /api/health                                         │
└──────────────────────────┬──────────────────────────────┘
                           │ RPC / HTTPS
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   Robinhood Chain    DexScreener API    OpenSea V2 API
   (viem public       (token prices,     (floor, bids,
    client, token-     pool TVL)          volume, sales)
    bucket rate lim)
```

## Project Structure

```
fade-anvil-dashboard/
├── api/                          # Vercel serverless handlers
│   ├── markets.ts                # GET /api/markets — full scan + spread
│   └── health.ts                 # GET /api/health — liveness probe
│
├── src/lib/                      # Core TypeScript library
│   ├── config.ts                 # RPC client with token-bucket rate limiting
│   ├── contracts.ts              # Chain defs, contract addresses, ABI fragments
│   ├── anvil.ts                  # Market scanner (704 lines) — the core
│   ├── anvil-spread.ts           # Pure spread computation (251 lines)
│   ├── anvil-combine.ts          # AnvilScanner orchestrator class
│   └── v3-pool.ts                # Uniswap V3 constant-product math
│
├── public/
│   └── index.html                # Single-page Alpine.js frontend (~710 lines)
│
├── test-server.ts                # Standalone HTTP server (port 3004)
├── vercel.json                   # Build + routing config
├── package.json                  # Scripts, deps
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

### 5. Caching

| Cache | TTL | Scope |
|-------|-----|-------|
| Market scan | 5 min | Full sweep result |
| OpenSea stats | 30 min | Per-slug volume/sales |
| clutch.market | 5 min | All-markets metadata |
| Dedup in-flight | — | Prevents concurrent sweeps |

## Rate Limiting

### RPC (Token Bucket)

`config.ts` wraps the fetch function with a token bucket:

- **Default**: 2 tokens/sec, burst 3
- Tokens refill continuously
- When empty, requests queue and wait
- Purpose: stay under the public node's aggregate limit (dashboard + alert scanner share the same node)

### OpenSea

- Sequential queue at ~8 req/s
- User-provided API keys accepted via `?openseaKey=` query param
- Never stored server-side

## V3 Pool Math (`v3-pool.ts`)

Computes exact WETH input for a given collection token output using the Uniswap V3 constant-product formula:

1. Read live pool state: `slot0` (sqrtPriceX96), `liquidity`, `fee`, `token0/token1`
2. Determine swap direction (which token is WETH)
3. Compute sqrt-price movement from the output amount
4. Apply thin-pool guard: rejects if swap would move price > 25% (crosses ticks)
5. Add pool fee on top

The legacy model priced tokens linearly (amount × spot × slippage), ignoring price impact. This module gives the true swap cost.

## Frontend (`index.html`)

Single HTML file, zero build step:

- **Alpine.js** (CDN) — reactive data binding
- **Fonts**: Orbitron (display) + Share Tech Mono (monospace)
- **Theme**: Dark/light toggle, persisted in localStorage
- **Effects**: CRT scanline overlay, neon glow CSS
- **Auto-refresh**: Fetches `/api/markets` every 60 seconds
- **OpenSea key**: User provides via UI, stored in localStorage, sent as query param
- **Hide markets**: Individual markets can be hidden, persisted in localStorage

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
