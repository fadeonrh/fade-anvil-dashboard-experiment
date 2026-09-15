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

### Standalone Server

```bash
npm start
# or
npx tsx bin/fade-anvil.js
```

Standalone server on port `3004`. Serves frontend, API, static files, and analytics. No Vercel CLI required.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vercel dev server (port 3000) |
| `npm start` | Standalone server (port 3004) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run all tests (41 tests) |
| `npm run test:unit` | Unit tests only (31 tests) |
| `npm run test:integration` | Integration tests only (10 tests) |

Always run `npm run typecheck` and `npm test` before committing.

## Project Layout

```
api/                    # Vercel serverless handlers
  markets.ts            # GET /api/markets — full scan + spread
  health.ts             # GET /api/health — liveness + analytics
  analytics.ts          # GET /api/analytics — full snapshot

src/lib/                # Core library (TypeScript)
  config.ts             # RPC client + rate limiting
  contracts.ts          # Chain/address/ABI definitions
  anvil.ts              # Market scanner (largest file, 704 lines)
  anvil-spread.ts       # Pure spread math
  anvil-combine.ts      # AnvilScanner orchestrator
  v3-pool.ts            # Uniswap V3 pool math
  analytics.ts          # In-memory analytics engine

bin/
  fade-anvil.js         # Standalone launcher (npx / npm start)

public/
  index.html            # Dashboard SPA (Alpine.js)
  analytics.html        # Analytics dashboard
  404.html              # Styled error page
  openapi.json          # OpenAPI 3.0 spec

tests/
  unit/
    anvil-spread.test.ts  # 22 spread math tests
    v3-pool.test.ts       # 9 V3 pool tests
  integration/
    api.test.ts           # 10 API integration tests

.github/workflows/ci.yml  # GitHub Actions CI
test-server.ts             # Legacy standalone server
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
- `analytics.ts` — in-memory analytics tracking

## Testing

### Run Tests

```bash
npm test              # all 41 tests
npm run test:unit     # 31 unit tests (spread math + V3 pool)
npm run test:integration  # 10 integration tests (API endpoints)
```

### Test Structure

- **Unit tests** (`tests/unit/`): Pure functions, no I/O. Test spread computation and V3 pool math.
- **Integration tests** (`tests/integration/`): HTTP requests against a running server. Test health, markets, 404, CORS, error format.

### Writing Tests

- Use Node.js built-in test runner (`node:test` + `node:assert/strict`)
- Run with `npx tsx --test` (TypeScript support)
- Unit tests: mock data, test edge cases
- Integration tests: hit live server on port 3004

## Adding a New Data Source

1. Add the fetch function in `src/lib/anvil.ts`
2. Add the data to `AnvilMarketState` interface
3. Wire it into `AnvilScanner.buildSpread()` in `anvil-combine.ts`
4. Add the field to the API response in `api/markets.ts`
5. Add the column to the table in `public/index.html`

## Testing Locally

### API Only

```bash
curl http://localhost:3004/api/markets | jq '.[0]'
```

### With Custom OpenSea Key

```bash
curl "http://localhost:3004/api/markets?openseaKey=YOUR_KEY" | jq '.[0]'
```

### Force Refresh

```bash
curl "http://localhost:3004/api/markets?force=true" | jq '.[0]'
```

### Health Check

```bash
curl http://localhost:3004/api/health
```

### Analytics

```bash
curl http://localhost:3004/api/analytics | jq '.requests.total'
```

### OpenAPI Spec

```bash
curl http://localhost:3004/openapi.json | jq '.info'
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

### Add a New Analytics Metric

1. Add the counter/tracker in `src/lib/analytics.ts`
2. Add tracking calls in the relevant endpoint (`api/markets.ts`, `api/health.ts`, or `bin/fade-anvil.js`)
3. Add the field to `AnalyticsSnapshot` interface
4. Add display in `public/analytics.html`

## License

MIT
