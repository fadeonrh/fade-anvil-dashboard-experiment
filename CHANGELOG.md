# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-09-17

### Added
- **Nightshades integration** — live Night phase display (Night/Sunrise/Day), countdown to next Night, total pot value from on-chain vault
- **ERC-2981 royalty reader** — reads on-chain collection royalties per market, displayed as % in table
- **`api/night.ts`** — `GET /api/night` endpoint returning Night state, config, and pot value
- **`src/lib/night-detector.ts`** — pure time-based Night state machine (4 states: normal, night_locked, decay, recovery)
- **`src/lib/night-settings.ts`** — display-only Nightshades parameters (timing, anti-snipe thresholds, pot/liquidity)
- **`src/lib/erc2981-royalty.ts`** — on-chain ERC-2981 royalty reader with 1-hour cache
- Nightshades overlay on market rows — purple left border + background tint for faction collections (GHOSTNFT, KNIGHTNFT, WATCHNFT, ZOMBIENFT)
- Phase badge (🌙/🌅/☀️) on Nightshades market rows
- Zebra striping on table rows for readability

### Changed
- **Multicall batching** — all per-market RPC reads (name, symbol, quote, fee) batched into single multicall instead of individual calls
- **RPC rate limit** — increased from 2 RPS / 3 burst to 10 RPS / 12 burst
- **OpenSea slug cache** — cached 1 hour per collection (eliminates redundant lookups)
- **OpenSea floor + offer cache** — cached 5 minutes across sweeps
- **OpenSea rate limit** — tightened from 120ms to 100ms (10 req/s)
- **Parallel reads** — DexScreener, royalty, slug resolution, floor, offer all run concurrently
- **Pre-resolved slugs** — all slugs resolved before building spreads (no per-market blocking)
- Collection name truncates with ellipsis on narrow screens
- Badges wrap to next line instead of truncating

### Fixed
- **"+-0.0013 ETH"** — proper sign handling in BEST SPREAD card (only "+" for positive values)
- **Night phase detection** — Sunrise now correctly bounded to 11AM-12PM (was incorrectly spanning 11AM-1PM)
- **Double arrow on collapsible sections** — native marker hidden, custom ▶ rotates on open/close
- **Cursor pointer** on collapsible section headers

### Removed
- Status column from Anvil Markets table
- Nightshades config section (kept card only)

## [1.3.0] - 2026-09-15

### Added
- Full analytics dashboard at `/analytics.html`
- `src/lib/analytics.ts` — in-memory analytics engine (request tracking, scan stats, response time percentiles, error breakdown)
- `GET /api/analytics` — returns full analytics snapshot
- Request rate chart (canvas, last 60 minutes)
- Endpoint breakdown table with request share bars
- Response time percentiles (P50, P95, P99, AVG)
- Scan statistics (count, avg duration, markets per scan)
- Error breakdown by code
- Navigation link to analytics in main dashboard header
- Theme toggle on analytics page (dark/light)

### Changed
- `api/health.ts` — uses analytics module for uptime/counts
- `api/markets.ts` — tracks request duration, scan success/failure, errors
- `bin/fade-anvil.js` — tracks all requests, scans, errors, static files, 404s
- Version bumped to 1.3.0

## [1.2.0] - 2026-09-15

### Added
- `bin/fade-anvil.js` entry point for `npx` launcher (`npx fade-anvil`)
- `public/openapi.json` — OpenAPI 3.0 spec for all API endpoints
- `.github/workflows/ci.yml` — GitHub Actions CI (typecheck + tests on Node 20/22)
- Server-side analytics in `/api/health` (uptime, scanCount, requestCount)
- Structured error responses with `code`, `message`, and `doc_url` fields
- `npm start` script runs standalone server via `node bin/fade-anvil.js`

### Changed
- `package.json` version bumped to 1.2.0
- `package.json` `start` script changed from `vercel dev` to `node bin/fade-anvil.js`
- API error format: `{ error: { code, message, doc_url } }` (was `{ error: "string" }`)
- Health endpoint returns `version: "1.2.0"` (was `"1.0.0"`)

## [1.1.0] - 2026-09-15

### Added
- HTML 404 error page with FADE branding, social links, and back-to-dashboard link
- `public/404.html` served for non-API routes on 404
- `CONTRIBUTING.md` with dev workflow, code conventions, and common tasks
- `ARCHITECTURE.md` with technical deep-dive (pipeline diagram, rate limiting, V3 math)
- Focus-visible indicators on all interactive elements
- Tabular numbers on table cells for alignment
- Button active/pressed state (`scale(0.97)`)
- Pulsing animation on "Scanning..." loading state
- Touch targets bumped to 40px (social links) and 44px min-height (buttons)
- CHANGELOG.md

### Changed
- Header title: "FADE Anvil" → "F-A-D-E"
- CA address displayed below title in mono font
- Social links (X, Telegram, GitHub, Dexscreener) added to header
- FADE logo wrapped in clickable link to X/Twitter
- Mobile breakpoint enhanced with flex-direction: column and overflow-x: auto on table
- CA line font-size bumped from 0.5rem to 0.625rem

### Fixed
- 404 responses now serve styled HTML page instead of raw JSON
- Vercel routing updated to serve `public/404.html` on unmatched routes
- Social link transition changed from `all` to specific properties

## [1.0.0] - 2026-09-01

### Added
- Initial release
- Real-time Anvil AMM market scanning on Robinhood Chain (4663)
- OpenSea floor/offer pricing integration
- DexScreener token pricing and pool TVL
- Spread calculation (buy cost vs sell proceeds)
- Liquidity classification (dead/thin/liquid)
- Clutch.market metadata (verified, TVL, APR, governance)
- Dark/light theme toggle with localStorage persistence
- Auto-refresh every 60 seconds
- OpenSea API key input (user-provided, browser-only storage)
- CRT scanline overlay effect
- Vercel serverless deployment
- Token-bucket RPC rate limiting
- Uniswap V3 pool math for exact swap cost
- Standalone test server (`test-server.ts`)
