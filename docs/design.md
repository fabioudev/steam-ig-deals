# IG Deals for Steam — Design

Status: approved 2026-11-22 · Target: Millennium plugin (Windows + Linux)

## Intent

Show Instant Gaming prices and discounts directly where games are browsed:
the Steam wishlist and store pages. Today checking a discount means typing
every title into instant-gaming.com by hand. This plugin removes that loop
without leaving Steam.

## Goals

- Badge with the Instant Gaming price (and savings vs. Steam) on wishlist cards.
- A compact price line on store app pages, linking to the Instant Gaming product.
- Works for the whole wishlist automatically, with a local cache.
- One installable artifact: a Millennium plugin, no separate service, no account.
- Windows and Linux from a single codebase.

## Non-goals

- Buying, cart or checkout automation. The plugin only displays prices and links.
- Covering other key resellers (Eneba, Kinguin, …). Instant Gaming only for v1.
- Historical price charts or price-drop alerts (possible later).
- Loading Instant Gaming inside Steam's embedded browser.

## Anti-goals

- A plugin that silently fails: every state (match, no match, no stock, error)
  must be visible or intentionally hidden, never a spinner that never resolves.
- Telemetry, accounts, or shipping user data anywhere.
- Hammering Instant Gaming: aggressive scraping or per-render requests.

## Constraints

- **Steam UI is CEF/React.** The wishlist lives in the store browser view
  (`webview`), the client UI is React (`frontend`).
- **Instant Gaming has no public API.** Its search is Algolia with a public
  search-only key that is **restricted to the `instant-gaming.com` origin**.
  Browser fetches from Steam's origin are rejected (`403 Method not allowed
  with this referer`).
- **Millennium plugins have a LuaJIT backend** with a native HTTP client
  (libcurl) that can set arbitrary headers, including `Origin`. This is the
  supported way around the origin restriction (same pattern as
  `protondb-millennium`).
- **Steam's embedded Chromium is old.** Never render Instant Gaming pages in it;
  open external links in the system browser.
- **Terms of service are a grey area.** Personal, low-volume use with caching;
  no redistribution of price data; document this in `SECURITY.md`/README.

## Approaches considered

### A. Single Millennium plugin (chosen)

Frontend (React, settings), webview (DOM injection), Lua backend (HTTP, cache,
matching). One artifact, cross-platform, no installation or autostart beyond
Millennium itself. The Lua HTTP client sidesteps CORS and the origin lock.

### B. Plugin + local sidecar service

Plugin talks to `127.0.0.1`; a small Node/Go service does HTTP and caching.
Rejected as the default because it doubles the installation surface (systemd
unit vs. Windows autostart) and can drift out of sync with the plugin. Kept as
a documented fallback if the Lua backend proves unreliable on Windows.

### C. Browser extension / external app

Works on the Steam website but not inside the client, or requires leaving the
client. Rejected: the request is explicitly "inside Steam".

## Architecture

```
webview (wishlist / store page DOM)
   │  backend.get_prices({games, country, currency})
   ▼
Lua backend
   ├─ config discovery: GET instant-gaming.com search page → app id, key, index
   ├─ Algolia query (POST, Origin: https://www.instant-gaming.com)
   ├─ matching: Steam name → IG product (name + platform + region)
   └─ cache: config (24 h) and prices (default 12 h) as JSON on disk
   │  PriceResult[]
   ▼
webview renders badges · frontend renders settings page
```

### Components

- `webview/preload.ts` — observes the wishlist grid and app pages, batches
  requests, injects badges, opens external links.
- `frontend/index.tsx` — Millennium settings page (region/currency, badge
  visibility, cache TTL, diagnostics).
- `backend/main.lua` — RPC entry points; wires together the modules below.
- `backend/http.lua` — thin wrapper around `require("http")`, sets `Origin`,
  timeouts and user agent.
- `backend/algolia.lua` — config discovery from the IG search page, index name,
  query construction, response normalization.
- `backend/matching.lua` — title normalization, candidate scoring, overrides.
- `backend/cache.lua` — atomic JSON read/write, TTL handling, negative cache.
- `shared/` — TypeScript types plus display helpers (price, discount, URL,
  status mapping) shared by webview and frontend.
- `tests/` — Vitest for TypeScript, dependency-free Lua harness for the backend.

### Data flow

1. Webview extracts `{appid, name}` pairs from the DOM (React props where
   available, otherwise link hrefs; never obfuscated class names).
2. One `get_prices` call per visible batch.
3. Backend returns fresh cache entries immediately and resolves the rest.
4. Webview renders: green badge when IG is cheaper, neutral when equal or more
   expensive, nothing for `no_match`/`unavailable`/`error` (errors are logged in
   the settings diagnostics).

### Matching

Instant Gaming results carry no Steam app id, so matching is the core risk.

- Normalize: lowercase, strip ™/®/©, punctuation, diacritics, edition suffixes
  and platform tags.
- Require `platform == "Steam"` and a stock/region-compatible product.
- Score candidates: exact normalized title > one contains the other > token
  overlap; reject below a threshold.
- DLCs (`is_dlc`) and pre-orders are allowed but flagged.
- Manual overrides in a local JSON file, editable via the settings page later.

### Cache

- Config cache: Algolia credentials/index, refreshed every 24 h or on 403.
- Price cache: keyed by appid + country + currency, default TTL 12 h.
- Negative cache for `no_match`, default TTL 24 h, to avoid re-querying the
  whole wishlist on every visit.
- Atomic writes (temp file + rename); corrupt cache is discarded, not fatal.

## Compliance and safety

- Prices are fetched from Instant Gaming's public search index, not from a
  private API. No authentication is bypassed.
- Requests are rate-limited (sequential, small delay) and cached.
- No data leaves the machine except requests to `instant-gaming.com`/Algolia.
- The plugin is not affiliated with Valve or Instant Gaming; naming and README
  make that explicit.
- External links open in the system browser, never inside Steam's CEF.

## Decisions made

- Name: **steam-ig-deals**, display name "IG Deals for Steam", MIT license.
- Single plugin with Lua backend; sidecar only as fallback.
- Wishlist + store pages in v1; library detail page later via the React frontend.
- External browser for links.

## Open for the builder / later

- Exact Millennium Lua API names for plugin data directory and logging.
- Which DOM selectors are stable across Steam client updates.
- Badge visual design and localization (German first, English strings).
- Whether to publish on steambrew.app/plugins once stable.

## Milestones

1. **Foundation** — repo, CI, lint, tests, build, docs, design (this).
2. **Spike** — Lua HTTP with `Origin` against Algolia on Linux and Windows;
   document results.
3. **MVP** — wishlist badges with cache and matching for the user's own list.
4. **Store page** — price line on app pages and settings page.
5. **Hardening** — overrides, diagnostics, rate limiting, error states.
6. **Publish** — release artifacts, steambrew.app submission.
