# IPC contract

Millennium injects a `backend` object into the frontend and the webview
preload script. Calls are asynchronous RPC to the plugin's Lua backend.

TypeScript types live in [`shared/types.ts`](../shared/types.ts); the Lua side
must serialize exactly these shapes with `cjson`.

## `get_prices`

Request:

```ts
interface GetPricesRequest {
  games: { appid: number; name: string }[];
  country: string; // "DE"
  currency: string; // "EUR"
  force?: boolean; // bypass fresh price cache
}
```

Response:

```ts
interface GetPricesResponse {
  results: PriceResult[];
  fetched_at: number; // unix epoch seconds
}
```

Rules:

- The backend never throws across the RPC boundary. Failures are reported per
  game as `{ status: "error", error: "..." }`.
- Results preserve the order of `games`.
- `matched` results always include a `product`.
- Duplicate appids in one request are resolved once.
- Maximum batch size 100; larger requests are split by the caller (the backend
  may also split internally).

## `clear_cache`

Response: `{ ok: boolean }`. Removes price cache entries, keeps the Algolia
config cache.

## `get_status`

Response:

```ts
interface BackendStatus {
  algolia_index: string | null;
  config_age_seconds: number | null;
  cached_games: number;
  cache_ttl_seconds: number;
}
```

Used by the settings page for diagnostics.

## `refresh_config`

Re-reads the Algolia app id, search key and index from the Instant Gaming
search page and stores them in the config cache.

Response: `{ ok: boolean; index?: string; error?: string }`.

## External links

Opening a product URL must go through the system browser. Use the Millennium /
Steam API available to the webview (verify against the docs when implementing);
never navigate the Steam browser view to Instant Gaming.
