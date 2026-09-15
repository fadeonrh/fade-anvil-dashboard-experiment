# F-A-D-E Anvil Dashboard

Real-time NFT arbitrage dashboard for the **Anvil AMM** on **Robinhood Chain (4663)**. Scans every Anvil market, computes buy/sell spreads against OpenSea floors, and classifies liquidity.

**FADE Token:** `0x83C65Dc8857Dc07489cDbeC6Be7A84C35A95fADe`

## What It Does

For each Anvil AMM market the dashboard:

1. Fetches the on-chain AMM floor (tokens required to buy an NFT)
2. Reads the DEX token price from DexScreener
3. Computes exact swap cost via Uniswap V3 pool math
4. Pulls OpenSea floor listing and highest bid
5. Calculates net spread (buy cost vs sell proceeds, minus fees and gas)
6. Classifies the market as **tradable**, **thin**, or **dead**

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
npx tsx test-server.ts
```

Runs on port `3004`. Serves the frontend and API endpoints directly.

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vercel dev server (port 3000) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npx tsx test-server.ts` | Standalone server (port 3004) |

## Environment Variables

All optional. Copy `.env.example` to `.env` to customize.

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENSEA_API_KEY` | *(none)* | OpenSea API key. Enables floor/offer data. Without it, OS data is disabled. |
| `ROBINHOOD_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | Custom RPC endpoint for Robinhood Chain. |
| `RPC_RPS` | `2` | RPC requests per second (token bucket). |
| `RPC_BURST` | `3` | RPC burst capacity (token bucket). |

### Getting an OpenSea API Key

1. Go to [docs.opensea.io/reference/request-an-api-key](https://docs.opensea.io/reference/request-an-api-key)
2. Create an account and request a key
3. Set it as `OPENSEA_API_KEY` in your Vercel dashboard or `.env` file

Users can also provide their own key via the dashboard UI (stored in browser localStorage, sent as a query parameter, never stored server-side).

## API Endpoints

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
      "netSpreadEth": -0.045,
      "netSpreadPct": -24.4,
      "netSpreadOfferEth": 0.145,
      "buyTotalEth": 0.185,
      "gasEth": 0.00004,
      "classification": "tradable"
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

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `marketId` | number | On-chain market ID |
| `collection` | string | NFT collection contract address |
| `collectionName` | string | Human-readable collection name |
| `token` | string | Collection token contract address |
| `amm` | string | Anvil AMM contract address |
| `tokensPerNFT` | string | Tokens required per NFT (wei) |
| `anvilFloorEth` | number | Anvil floor price in ETH |
| `tokenPriceEth` | number | DEX token price in ETH |
| `poolTvlUsd` | number | Pool TVL in USD |
| `osFloorEth` | number | OpenSea floor listing in ETH |
| `osFloorOfferEth` | number | OpenSea highest bid in ETH |
| `spread` | object | Spread calculation (see below) |
| `verified` | boolean | Clutch.market verified badge |
| `liquidityLocked` | boolean | Liquidity lock status |

**Spread Object:**

| Field | Type | Description |
|-------|------|-------------|
| `netSpreadEth` | number | Net spread in ETH (floor exit) |
| `netSpreadPct` | number | Net spread as percentage |
| `netSpreadOfferEth` | number | Net spread in ETH (bid exit) |
| `buyTotalEth` | number | Total buy cost in ETH |
| `gasEth` | estimated gas cost in ETH |
| `classification` | string | `"tradable"`, `"thin"`, or `"dead"` |

**Error Response (500):**

```json
{ "error": "anvil scan failed: <details>" }
```

### `GET /api/health`

Returns liveness probe.

**Example Request:**

```bash
curl http://localhost:3004/api/health
```

**Example Response:**

```json
{
  "ok": true,
  "timestamp": 1789478666342
}
```

### `GET /nonexistent` (404)

HTML requests receive a styled 404 page. API requests (no `Accept: text/html`) receive:

```json
{ "error": "not found" }
```

## Spread Formula

```
Buy Cost:
  tokensEth = DEX swap cost (V3 pool quote + flat fee ~$2)
  gasEth    = gas for DEX swap + AMM buy + OpenSea sell

Sell Proceeds:
  floorEth  = OpenSea floor listing
  bidEth    = OpenSea highest bid
  feeEth    = 2.5% OpenSea marketplace fee

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
- **On-chain**: viem library for RPC calls with token-bucket rate limiting
- **Cache**: 5-minute TTL for market scans, 30-minute for stats
- **Data Sources**: Robinhood Chain RPC, DexScreener API, OpenSea V2 API, clutch.market API

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full technical deep-dive.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Alpine.js, Orbitron + Share Tech Mono fonts |
| Backend | Vercel Serverless, TypeScript |
| On-chain | viem, Uniswap V3 pool math |
| APIs | DexScreener, OpenSea V2, clutch.market |
| Chain | Robinhood Chain (4663) |
| Deploy | Vercel |

## License

MIT
