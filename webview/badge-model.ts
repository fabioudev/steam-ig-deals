/**
 * Turns a backend `PriceResult` plus Steam's visible price into the text and
 * tone of a badge.
 *
 * Display formatting is shared with the settings page through
 * `@shared/display`; keeping it there means the webview and the frontend use
 * the same separators, currency placement and rounding.
 *
 * Instant Gaming prices arrive net. The badge shows the gross price for the
 * configured country (`shared/vat.ts`) and compares it against Steam's gross
 * price, so the green "cheaper" state is a real saving.
 */

import { classifyPrice, formatPrice, savingsPercent } from '@shared/display';
import type { PriceResult } from '@shared/types';
import { grossPrice } from '@shared/vat';
import { type BadgeTone, decideTone } from './badge-state';

export type { BadgeTone } from './badge-state';
export { hiddenReason } from './badge-state';

export interface BadgeDisplay {
  /** Never `hidden`; a hidden result returns `null` instead. */
  tone: Exclude<BadgeTone, 'hidden'>;
  /** Gross price for the configured country, e.g. "2,37 €". */
  priceLabel: string;
  /** e.g. "−23 %", or null when there is no known reference price. */
  discountLabel: string | null;
  /** Accessible name and hover title. */
  ariaLabel: string;
  title: string;
  /** Canonical Instant Gaming product URL. */
  url: string;
}

/**
 * Build the badge for one result.
 *
 * Returns `null` for no match, unavailable products, errors, and whenever the
 * shared classifier says the badge should stay hidden.
 */
export function buildBadgeDisplay(
  result: PriceResult,
  steamPrice: number | null,
  locale?: string,
  country?: string | null,
): BadgeDisplay | null {
  if (result.status !== 'matched' || !result.product || !result.product.has_stock) return null;

  const product = result.product;
  const gross = grossPrice(product.price, country);
  const grossRetail = product.retail === null ? null : grossPrice(product.retail, country).amount;

  const comparisonResult: PriceResult = {
    ...result,
    product: { ...product, price: gross.amount },
  };
  const tone = decideTone(comparisonResult, steamPrice, classifyPrice);
  if (tone === 'hidden') return null;

  const currency = product.currency || 'EUR';
  const formattedPrice = formatPrice(gross.amount, currency, locale);

  const percent =
    grossRetail !== null && grossRetail > gross.amount
      ? savingsPercent(grossRetail, gross.amount)
      : product.discount;
  const roundedPercent = Number.isFinite(percent) ? Math.round(percent) : 0;
  const discountLabel = roundedPercent > 0 ? `−${roundedPercent} %` : null;

  const comparison = tone === 'cheaper' ? 'cheaper than on Steam' : 'not cheaper than Steam prices';
  const discountCopy =
    discountLabel === null ? '' : `, ${roundedPercent} % below the reference price`;
  const ariaLabel =
    `${product.name}: Instant Gaming price ${formattedPrice}${discountCopy}; ` +
    `${comparison}. Opens the product page in your browser.`;

  return {
    tone,
    priceLabel: formattedPrice,
    discountLabel,
    ariaLabel,
    title: ariaLabel,
    url: product.url,
  };
}
