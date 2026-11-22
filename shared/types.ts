/**
 * Shared types between the webview/frontend (TypeScript) and the Lua backend.
 *
 * The backend serializes the same shapes through cjson. Keep field names in
 * snake_case where they cross the RPC boundary so Lua and TypeScript stay in
 * sync without a mapping layer.
 */

export interface SteamGame {
  appid: number;
  name: string;
}

export interface IgProduct {
  /** Instant Gaming product id (`prod_id` in Algolia). */
  prod_id: number;
  /** Stable Algolia object id. */
  object_id: string;
  /** Display name, e.g. "Elden Ring". */
  name: string;
  /** Full name including platform, e.g. "Elden Ring - PC (Steam)". */
  full_name: string;
  platform: string;
  region: string;
  /** Current Instant Gaming price in `currency`. */
  price: number;
  /** Retail / list price in the same currency as `price`, if known. */
  retail: number | null;
  /** Discount in percent for the selected currency, 0 when unknown. */
  discount: number;
  currency: string;
  /** Canonical product URL. */
  url: string;
  has_stock: boolean;
  preorder: boolean;
  is_dlc: boolean;
}

export type PriceStatus = 'matched' | 'no_match' | 'unavailable' | 'error';

export interface PriceResult {
  appid: number;
  status: PriceStatus;
  product?: IgProduct;
  /** Present when `status` is `error`. */
  error?: string;
}

export interface GetPricesRequest {
  games: SteamGame[];
  /** ISO 3166-1 alpha-2 country code, e.g. "DE". */
  country: string;
  /** ISO 4217 currency code, e.g. "EUR". */
  currency: string;
  /** Bypass fresh cache entries. Default false. */
  force?: boolean;
}

export interface GetPricesResponse {
  results: PriceResult[];
  /** Unix epoch seconds when the backend answered. */
  fetched_at: number;
}

export interface BackendStatus {
  algolia_index: string | null;
  config_age_seconds: number | null;
  cached_games: number;
  cache_ttl_seconds: number;
}
