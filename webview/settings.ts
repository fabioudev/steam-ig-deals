/**
 * Wishlist-side settings.
 *
 * These live in the store view's `localStorage`, which is a different origin
 * from the Steam UI settings page. Until the MVP milestone adds a settings RPC
 * to the Lua backend, this is the single source of truth for the webview and
 * the frontend only displays it read-only (see frontend/index.tsx).
 */

export interface WishlistSettings {
  /** Render badges at all. */
  badgeEnabled: boolean;
  /** ISO 3166-1 alpha-2 country sent to the backend. */
  country: string;
  /** ISO 4217 currency sent to the backend. */
  currency: string;
}

export const WISHLIST_SETTINGS_KEY = 'igdeals.wishlist.settings.v1';

export const DEFAULT_WISHLIST_SETTINGS: WishlistSettings = {
  badgeEnabled: true,
  country: 'DE',
  currency: 'EUR',
};

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // localStorage throws in some privacy modes and in sandboxed frames.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Load and validate settings, falling back to DE/EUR on any problem. */
export function loadWishlistSettings(storage: Storage | null = getStorage()): WishlistSettings {
  const fallback: WishlistSettings = { ...DEFAULT_WISHLIST_SETTINGS };
  if (!storage) return fallback;

  try {
    const raw = storage.getItem(WISHLIST_SETTINGS_KEY);
    if (!raw) return fallback;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return fallback;

    const country =
      typeof parsed.country === 'string' && /^[a-z]{2}$/i.test(parsed.country)
        ? parsed.country.toUpperCase()
        : fallback.country;
    const currency =
      typeof parsed.currency === 'string' && /^[a-z]{3}$/i.test(parsed.currency)
        ? parsed.currency.toUpperCase()
        : fallback.currency;

    return {
      badgeEnabled:
        typeof parsed.badgeEnabled === 'boolean' ? parsed.badgeEnabled : fallback.badgeEnabled,
      country,
      currency,
    };
  } catch {
    return fallback;
  }
}
