import type { PriceResult } from './types';

/**
 * Format a monetary amount for display. Falls back to a plain
 * "<amount> <currency>" string when the runtime rejects the locale/currency.
 */
export function formatPrice(amount: number, currency: string, locale?: string): string {
  if (!Number.isFinite(amount)) {
    return 'N/A';
  }

  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(code)) {
    return `${amount.toFixed(2)} ${code || '???'}`.trim();
  }

  const resolvedLocale = locale && locale.trim() !== '' ? locale : undefined;
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: 'currency',
      currency: code,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

/**
 * Whole-number savings of `price` against `retail`, clamped to 0..100.
 * Returns 0 when either value is missing, non-finite, or there is no saving.
 */
export function savingsPercent(retail: number | null, price: number): number {
  if (retail === null || !Number.isFinite(retail) || retail <= 0) {
    return 0;
  }
  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }

  const percent = ((retail - price) / retail) * 100;
  if (!Number.isFinite(percent) || percent <= 0) {
    return 0;
  }
  return Math.min(100, Math.round(percent));
}

/**
 * Compare the Instant Gaming price with the Steam price.
 * Values are compared at cent precision so float noise does not flip the
 * result; without a usable Steam price the answer is `unknown`.
 */
export function classifyPrice(
  result: PriceResult,
  steamPrice?: number | null,
): 'cheaper' | 'same' | 'pricier' | 'unknown' {
  if (result?.status !== 'matched' || !result.product) {
    return 'unknown';
  }

  const igPrice = result.product.price;
  if (!Number.isFinite(igPrice) || igPrice < 0) {
    return 'unknown';
  }
  if (steamPrice === null || steamPrice === undefined || !Number.isFinite(steamPrice)) {
    return 'unknown';
  }
  if (steamPrice < 0) {
    return 'unknown';
  }

  const difference = Math.round(igPrice * 100) - Math.round(steamPrice * 100);
  if (difference < 0) {
    return 'cheaper';
  }
  if (difference > 0) {
    return 'pricier';
  }
  return 'same';
}
