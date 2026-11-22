/**
 * Badge rendering and the one-time stylesheet injection.
 *
 * Every badge carries `data-igdeals-badge`; cards it was attached to carry
 * `data-igdeals-appid`. Rendering updates an existing badge in place when
 * possible, which makes React re-renders, MutationObserver re-runs and
 * infinite scrolling idempotent.
 */

import type { BadgeDisplay } from './badge-model';
import { openExternalUrl } from './external-link';
import type { WishlistCard } from './extract';

export const BADGE_ATTRIBUTE = 'data-igdeals-badge';
export const BADGE_STYLE_ID = 'igdeals-styles';
const BADGE_SELECTOR = `[${BADGE_ATTRIBUTE}]`;
const STORE_LINE_ID = 'igdeals-store-line';

const STYLES = `
.igdeals-badge {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 6px 0 0 8px;
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(54, 83, 109, 0.92);
  color: #dbe2e6;
  font-family: "Motiva Sans", Arial, sans-serif;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  vertical-align: middle;
}
.igdeals-badge:hover { background: rgba(75, 110, 140, 0.96); }
.igdeals-badge:focus-visible {
  outline: 2px solid #66c0f4;
  outline-offset: 2px;
}
.igdeals-badge--cheaper {
  background: #5c7e10;
  border-color: #7fa614;
  color: #ffffff;
}
.igdeals-badge--cheaper:hover { background: #6b9114; }
.igdeals-badge__discount { color: #beee5c; font-weight: 700; }
.igdeals-badge--neutral .igdeals-badge__discount { color: #c7d5e0; }
.igdeals-badge--block {
  display: flex;
  width: fit-content;
  margin: 8px 0 12px;
  padding: 5px 10px;
  font-size: 13px;
}
`;

export type OpenUrl = (url: string) => void;

/** Inject the plugin stylesheet once per document. */
export function injectStyles(doc: Document = document): void {
  if (doc.getElementById(BADGE_STYLE_ID)) return;

  const style = doc.createElement('style');
  style.id = BADGE_STYLE_ID;
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).appendChild(style);
}

function attachHandlers(badge: HTMLButtonElement, onOpen: OpenUrl): void {
  badge.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const url = badge.dataset.igdealsUrl;
    if (url) onOpen(url);
  });

  // Buttons activate on Enter natively; handle Space here so it opens the
  // product page instead of scrolling. preventDefault avoids a second click.
  badge.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    event.stopPropagation();
    const url = badge.dataset.igdealsUrl;
    if (url) onOpen(url);
  });
}

function createBadge(doc: Document, onOpen: OpenUrl, block: boolean): HTMLButtonElement {
  const badge = doc.createElement('button');
  badge.type = 'button';
  badge.setAttribute(BADGE_ATTRIBUTE, '');
  badge.className = block ? 'igdeals-badge igdeals-badge--block' : 'igdeals-badge';
  badge.tabIndex = 0;
  attachHandlers(badge, onOpen);
  return badge;
}

function updateBadge(
  badge: HTMLButtonElement,
  display: BadgeDisplay,
  doc: Document,
  appid?: number,
): void {
  if (badge.dataset.igdealsUrl !== display.url) badge.dataset.igdealsUrl = display.url;
  if (badge.dataset.igdealsTone !== display.tone) badge.dataset.igdealsTone = display.tone;
  if (appid !== undefined && badge.dataset.igdealsAppid !== String(appid)) {
    badge.dataset.igdealsAppid = String(appid);
  }

  badge.classList.toggle('igdeals-badge--cheaper', display.tone === 'cheaper');
  badge.classList.toggle('igdeals-badge--neutral', display.tone === 'neutral');

  if (badge.getAttribute('aria-label') !== display.ariaLabel) {
    badge.setAttribute('aria-label', display.ariaLabel);
  }
  if (badge.getAttribute('title') !== display.title) badge.setAttribute('title', display.title);

  const label = `${display.priceLabel}${display.discountLabel ? ` ${display.discountLabel}` : ''}`;
  // Compare against a data attribute, not textContent: replacing textContent
  // would fire the MutationObserver and cause an endless render loop.
  if (badge.dataset.igdealsLabel === label) return;

  badge.dataset.igdealsLabel = label;
  badge.replaceChildren();

  const price = doc.createElement('span');
  price.className = 'igdeals-badge__price';
  price.textContent = display.priceLabel;
  badge.appendChild(price);

  if (display.discountLabel) {
    const discount = doc.createElement('span');
    discount.className = 'igdeals-badge__discount';
    discount.textContent = display.discountLabel;
    badge.appendChild(discount);
  }
}

function findBadge(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(BADGE_SELECTOR);
}

/** Create or update the badge inside one wishlist card. */
export function upsertCardBadge(
  card: WishlistCard,
  display: BadgeDisplay,
  onOpen: OpenUrl = openExternalUrl,
  doc: Document = document,
): void {
  injectStyles(doc);

  const container = card.element;
  if (container.dataset.igdealsAppid !== String(card.appid)) {
    container.dataset.igdealsAppid = String(card.appid);
  }

  let badge = findBadge(container);
  if (!badge) {
    badge = createBadge(doc, onOpen, false);
    container.appendChild(badge);
  }

  updateBadge(badge, display, doc, card.appid);
}

/** Remove the badge from one card (used for no_match/unavailable/error). */
export function removeCardBadge(card: WishlistCard): void {
  findBadge(card.element)?.remove();
}

/** Create or update the price line on a store app page. */
export function upsertStoreBadge(
  appid: number,
  display: BadgeDisplay,
  onOpen: OpenUrl = openExternalUrl,
  doc: Document = document,
): boolean {
  injectStyles(doc);

  let badge = doc.getElementById(STORE_LINE_ID) as HTMLButtonElement | null;
  if (!badge) {
    badge = createBadge(doc, onOpen, true);
    badge.id = STORE_LINE_ID;

    const title =
      doc.querySelector('#appHubAppName') ??
      doc.querySelector('.apphub_AppName') ??
      doc.querySelector('[itemprop="name"]');
    const purchase = doc.querySelector('#game_area_purchase, .game_area_purchase');

    if (title?.parentElement) {
      title.insertAdjacentElement('afterend', badge);
    } else if (purchase) {
      purchase.prepend(badge);
    } else {
      return false;
    }
  }

  updateBadge(badge, display, doc, appid);
  return true;
}

/** Remove the store-page price line. */
export function removeStoreBadge(doc: Document = document): void {
  doc.getElementById(STORE_LINE_ID)?.remove();
}

/** Remove all badges, e.g. when the user disabled them. */
export function removeAllBadges(doc: Document = document): void {
  for (const badge of doc.querySelectorAll(BADGE_SELECTOR)) badge.remove();
}
