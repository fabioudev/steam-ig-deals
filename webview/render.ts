/**
 * Badge rendering and the one-time stylesheet injection.
 *
 * Every badge carries `data-igdeals-badge`; its wrapper carries
 * `data-igdeals-wrap`. Rendering updates an existing badge in place when
 * possible, which makes React re-renders, MutationObserver re-runs and
 * infinite scrolling idempotent.
 *
 * The badge uses Instant Gaming's orange brand palette and sits above Steam's
 * own price block, so the IG price reads as an alternative to the price below
 * it rather than as a second title.
 */

import type { BadgeDisplay } from './badge-model';
import { openExternalUrl } from './external-link';
import { findPriceElement, type WishlistCard } from './extract';

export const BADGE_ATTRIBUTE = 'data-igdeals-badge';
export const BADGE_WRAP_ATTRIBUTE = 'data-igdeals-wrap';
export const BADGE_STYLE_ID = 'igdeals-styles';
const BADGE_SELECTOR = `[${BADGE_ATTRIBUTE}]`;
const WRAP_SELECTOR = `[${BADGE_WRAP_ATTRIBUTE}]`;
const STORE_LINE_ID = 'igdeals-store-line';
const LOGO_URL = 'https://www.instant-gaming.com/themes/igv2/images/logos/logo-instant-gaming.svg';

const STYLES = `
.igdeals-badge-wrap {
  display: flex;
  justify-content: flex-end;
  margin: 0 0 6px;
}
.igdeals-badge-wrap--anchored {
  position: absolute;
  right: 0;
  bottom: 100%;
  z-index: 2;
}
.igdeals-price-anchor { position: relative; }
.igdeals-badge {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: linear-gradient(135deg, #ff8a15 0%, #ff3131 100%);
  color: #ffffff;
  font-family: "Motiva Sans", Arial, sans-serif;
  text-align: left;
  line-height: 1.1;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.igdeals-badge:hover { filter: brightness(1.08); }
.igdeals-badge:focus-visible {
  outline: 2px solid #ffb066;
  outline-offset: 2px;
}
.igdeals-badge--cheaper { border-left: 3px solid #6cc644; }
.igdeals-badge--neutral { opacity: 0.94; }
.igdeals-badge__logo {
  display: block;
  height: 13px;
  width: auto;
  filter: brightness(0) invert(1);
  opacity: 0.95;
}
.igdeals-badge__row {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.igdeals-badge__price {
  font-size: 14px;
  font-weight: 700;
}
.igdeals-badge__discount {
  padding: 0 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.2);
  font-size: 11px;
  font-weight: 700;
  color: #ffe1c4;
}
.igdeals-sort-toggle {
  appearance: none;
  margin-left: 8px;
  padding: 0 12px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 3px;
  background: #2a475e;
  color: #c7d5e0;
  font-family: "Motiva Sans", Arial, sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.igdeals-sort-toggle:hover { background: #3a5a75; color: #ffffff; }
.igdeals-sort-toggle--active {
  background: linear-gradient(135deg, #ff8a15 0%, #ff3131 100%);
  border-color: transparent;
  color: #ffffff;
}
.igdeals-sort-toggle:focus-visible {
  outline: 2px solid #66c0f4;
  outline-offset: 2px;
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

function createWrapper(doc: Document, anchored = false): HTMLDivElement {
  const wrapper = doc.createElement('div');
  wrapper.setAttribute(BADGE_WRAP_ATTRIBUTE, '');
  wrapper.className = anchored
    ? 'igdeals-badge-wrap igdeals-badge-wrap--anchored'
    : 'igdeals-badge-wrap';
  return wrapper;
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

  const label = [display.priceLabel, display.discountLabel].filter(Boolean).join(' ');
  // Compare against a data attribute, not textContent: replacing textContent
  // would fire the MutationObserver and cause an endless render loop.
  if (badge.dataset.igdealsLabel === label) return;

  badge.dataset.igdealsLabel = label;
  badge.replaceChildren();

  const logo = doc.createElement('img');
  logo.className = 'igdeals-badge__logo';
  logo.src = LOGO_URL;
  logo.alt = 'Instant Gaming';
  logo.decoding = 'async';
  logo.referrerPolicy = 'no-referrer';
  logo.addEventListener('error', () => logo.remove(), { once: true });

  const row = doc.createElement('span');
  row.className = 'igdeals-badge__row';

  const price = doc.createElement('span');
  price.className = 'igdeals-badge__price';
  price.textContent = display.priceLabel;
  row.appendChild(price);

  if (display.discountLabel) {
    const discount = doc.createElement('span');
    discount.className = 'igdeals-badge__discount';
    discount.textContent = display.discountLabel;
    row.appendChild(discount);
  }

  badge.appendChild(logo);
  badge.appendChild(row);
}

function findBadge(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(BADGE_SELECTOR);
}

const TITLE_SELECTORS = 'h1, h2, h3, h4, [role="heading"], .title';

/** Title element used when a card exposes no recognizable price element. */
function findTitleAnchor(container: HTMLElement): HTMLElement | null {
  for (const node of container.querySelectorAll<HTMLElement>(TITLE_SELECTORS)) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 120) continue;
    if (/^[\d\s.,:€$£%+\-–—]+$/.test(text)) continue;
    return node;
  }
  return null;
}

/** Create or update the badge above the price inside one wishlist card. */
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

    const priceAnchor = findPriceElement(container);
    let placed = false;

    if (priceAnchor) {
      // Never nest the button inside an <a>: climb out of link wrappers first.
      let top: HTMLElement = priceAnchor;
      while (top.parentElement && top.parentElement.tagName === 'A') {
        top = top.parentElement;
      }
      const parent = top.parentElement;
      if (parent && parent !== container) {
        parent.style.position = 'relative';
        const wrapper = createWrapper(doc, true);
        wrapper.appendChild(badge);
        parent.insertBefore(wrapper, top);
        placed = true;
      } else if (parent && top.tagName !== 'A') {
        // Price element is a direct child of the card (legacy layouts): anchor
        // the badge to the element itself.
        top.style.position = 'relative';
        const wrapper = createWrapper(doc, true);
        wrapper.appendChild(badge);
        top.appendChild(wrapper);
        placed = true;
      }
    }

    if (!placed) {
      const title = findTitleAnchor(container);
      if (title?.parentElement) {
        title.insertAdjacentElement('afterend', badge);
      } else {
        container.appendChild(badge);
      }
    }
  }

  updateBadge(badge, display, doc, card.appid);
}

/** Remove the badge from one card (used for no_match/unavailable/error). */
export function removeCardBadge(card: WishlistCard): void {
  const badge = findBadge(card.element);
  const wrapper = badge?.closest<HTMLElement>(WRAP_SELECTOR);
  if (wrapper) {
    wrapper.remove();
  } else {
    badge?.remove();
  }
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

    const wrapper = createWrapper(doc);
    wrapper.appendChild(badge);

    const purchase = doc.querySelector('#game_area_purchase, .game_area_purchase');
    if (purchase) {
      purchase.prepend(wrapper);
    } else {
      const title =
        doc.querySelector('#appHubAppName') ??
        doc.querySelector('.apphub_AppName') ??
        doc.querySelector('[itemprop="name"]');
      if (title?.parentElement) {
        title.insertAdjacentElement('afterend', wrapper);
      } else {
        return false;
      }
    }
  }

  updateBadge(badge, display, doc, appid);
  return true;
}

/** Remove the store-page price line. */
export function removeStoreBadge(doc: Document = document): void {
  const badge = doc.getElementById(STORE_LINE_ID);
  const wrapper = badge?.closest<HTMLElement>(WRAP_SELECTOR);
  if (wrapper) {
    wrapper.remove();
  } else {
    badge?.remove();
  }
}

/** Remove all badges, e.g. when the user disabled them. */
export function removeAllBadges(doc: Document = document): void {
  for (const wrapper of doc.querySelectorAll(WRAP_SELECTOR)) wrapper.remove();
  for (const badge of doc.querySelectorAll(BADGE_SELECTOR)) badge.remove();
}
