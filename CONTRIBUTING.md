# Contributing

Development guide for the F-A-D-E Anvil Dashboard.

## Prerequisites

- Node.js >= 20
- npm
- Git

## Setup

```bash
git clone https://github.com/fadeonrh/fade-anvil-dashboard.git
cd fade-anvil-dashboard
npm install
```

## Development

```bash
npm run dev
```

Opens the Vercel dev server at `http://localhost:3000`. The server proxies API requests to the serverless functions and serves `public/` as static files.

### Without Vercel CLI

```bash
npx tsx test-server.ts
```

Standalone server on port `3004`. Useful if you don't want the Vercel CLI overhead.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vercel dev server (port 3000) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npx tsx test-server.ts` | Standalone server (port 3004) |

Always run `npm run typecheck` before committing to catch type errors.

## Project Layout

```
api/                    # Vercel serverless handlers
  markets.ts            # GET /api/markets
  health.ts             # GET /api/health

src/lib/                # Core library (TypeScript)
  config.ts             # RPC client + rate limiting
  contracts.ts          # Chain/address/ABI definitions
  anvil.ts              # Market scanner (largest file, 704 lines)
  anvil-spread.ts       # Pure spread math
  anvil-combine.ts      # AnvilScanner orchestrator
  v3-pool.ts            # Uniswap V3 pool math

public/
  index.html            # Single-page frontend (Alpine.js)

test-server.ts          # Standalone HTTP server
```

## Code Conventions

### TypeScript

- **Target**: ES2022, ESNext modules, bundler resolution
- **Strict mode**: Enabled
- **No unused variables**: Will fail typecheck
- **Manual ABI decoding**: Raw hex parsing with `word()` / `wordAddr()` helpers, not viem ABI decode. This is intentional for the factory struct reads.

### Style

- No comments unless explaining non-obvious logic
- Prefer `const` over `let`
- Use viem's `PublicClient` for all on-chain reads
- Rate-limit all external calls (RPC via token bucket, OpenSea via queue)

### File Organization

- `anvil.ts` — all on-chain reads and external API calls for market discovery
- `anvil-spread.ts` — pure computation, zero I/O
- `anvil-combine.ts` — orchestration, caching, pipeline
- `v3-pool.ts` — isolated V3 math

## Adding a New Data Source

1. Add the fetch function in `src/lib/anvil.ts`
2. Add the data to `AnvilMarketState` interface
3. Wire it into `AnvilScanner.buildSpread()` in `anvil-combine.ts`
4. Add the field to the API response in `api/markets.ts`
5. Add the column to the table in `public/index.html`

## Testing Locally

### API Only

```bash
curl http://localhost:3000/api/markets | jq '.[0]'
```

### With Custom OpenSea Key

```bash
curl "http://localhost:3000/api/markets?openseaKey=YOUR_KEY" | jq '.[0]'
```

### Force Refresh

```bash
curl "http://localhost:3000/api/markets?force=true" | jq '.[0]'
```

### Health Check

```bash
curl http://localhost:3000/api/health
```

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENSEA_API_KEY` | — | OpenSea API key (optional) |
| `ROBINHOOD_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | RPC endpoint |
| `RPC_RPS` | `2` | Requests per second |
| `RPC_BURST` | `3` | Burst capacity |

## Deployment

### Vercel (Recommended)

```bash
npx vercel
```

Or use the deploy button in the README.

### Environment Variables on Vercel

Set these in the Vercel dashboard under Settings > Environment Variables:

- `OPENSEA_API_KEY` — your OpenSea API key
- `ROBINHOOD_RPC_URL` — only if using a private RPC

## Common Tasks

### Add a New Market Field

1. Add to `AnvilMarketInfo` or `AnvilMarketState` in `src/lib/anvil.ts`
2. Add to the spread result in `anvil-spread.ts` if needed
3. Add to the serialized response in `api/markets.ts`
4. Add the table column in `public/index.html`

### Change Spread Thresholds

Edit `DEFAULT_ANVIL_SPREAD_CONFIG` in `src/lib/anvil-spread.ts`:

```typescript
export const DEFAULT_ANVIL_SPREAD_CONFIG: AnvilSpreadConfig = {
  minSpreadPct: 15,       // minimum spread % to flag tradable
  minNetEth: 0.001,       // minimum absolute spread in ETH
  openseaFeeBps: 250,     // OpenSea marketplace fee (2.5%)
  minFloorListings: 2,    // minimum floor listings for depth
  minPoolTvlUsd: 1000,    // minimum pool TVL in USD
  gasPriceGwei: 1,        // fallback gas price
  buyGasUnits: 200_000,   // gas for buy tx
  sellGasUnits: 150_000,  // gas for sell tx
};
```

### Add a New Excluded Market

Edit `ANVIL_EXCLUDED_MARKET_IDS` in `src/lib/anvil.ts`:

```typescript
export const ANVIL_EXCLUDED_MARKET_IDS = new Set<number>([1, 2, 3, NEW_ID]);
```

## License

MIT
