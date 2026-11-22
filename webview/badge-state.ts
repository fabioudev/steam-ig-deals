/**
 * Badge tone decisions, kept free of any `@shared/display` import so the rules
 * can be unit-tested without the formatter module.
 */

import type { PriceResult } from '@shared/types';

export type BadgeTone = 'cheaper' | 'neutral' | 'hidden';

/** The shared classifier, passed in so this module stays dependency-free. */
export type ClassifyPrice = (result: PriceResult, steamPrice?: number) => unknown;

/**
 * `classifyPrice` is defined by the shared display workstream. Its return type
 * is not fixed in this workstream's brief, so accept the plausible shapes
 * (`'cheaper' | 'neutral' | 'hidden'`, booleans, `{ tone }`) and map them onto
 * our small union. This is intentionally tolerant: a hidden result must never
 * turn into a saving badge.
 */
export function normalizeTone(value: unknown): BadgeTone {
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (
      normalized === 'hidden' ||
      normalized === 'none' ||
      normalized === 'hide' ||
      normalized === 'no_match' ||
      normalized === 'unavailable' ||
      normalized === 'error'
    ) {
      return 'hidden';
    }
    if (
      normalized === 'cheaper' ||
      normalized === 'cheap' ||
      normalized === 'good' ||
      normalized === 'green' ||
      normalized === 'saving' ||
      normalized === 'savings' ||
      normalized === 'discount' ||
      normalized === 'lower' ||
      normalized === 'below'
    ) {
      return 'cheaper';
    }
    return 'neutral';
  }

  if (typeof value === 'boolean') return value ? 'cheaper' : 'hidden';

  if (typeof value === 'object' && value !== null) {
    const record = value as { tone?: unknown; kind?: unknown; visible?: unknown };
    if (record.visible === false) return 'hidden';
    const nested = record.tone ?? record.kind;
    if (nested !== undefined) return normalizeTone(nested);
  }

  return 'neutral';
}

/** Human-readable reason for the debug log when a result renders no badge. */
export function hiddenReason(result: PriceResult): string | null {
  if (result.status !== 'matched') {
    return result.error ? `${result.status}: ${result.error}` : result.status;
  }
  if (!result.product) return 'matched without product';
  if (!result.product.has_stock) return 'matched without stock';
  return null;
}

/**
 * Decide whether to show a green, neutral or no badge.
 *
 * Statuses that design.md says must stay silent are short-circuited here, even
 * if the shared classifier would not know about them.
 */
export function decideTone(
  result: PriceResult,
  steamPrice: number | null,
  classify: ClassifyPrice,
): BadgeTone {
  if (result.status !== 'matched' || !result.product || !result.product.has_stock) return 'hidden';
  return normalizeTone(classify(result, steamPrice ?? undefined));
}
