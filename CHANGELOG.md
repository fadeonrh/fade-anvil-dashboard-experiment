# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
