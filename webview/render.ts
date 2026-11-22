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
import type { WishlistCard } from './extract';

export const BADGE_ATTRIBUTE = 'data-igdeals-badge';
export const BADGE_WRAP_ATTRIBUTE = 'data-igdeals-wrap';
export const BADGE_STYLE_ID = 'igdeals-styles';
const BADGE_SELECTOR = `[${BADGE_ATTRIBUTE}]`;
const WRAP_SELECTOR = `[${BADGE_WRAP_ATTRIBUTE}]`;
const STORE_LINE_ID = 'igdeals-store-line';

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
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 10px 6px 9px;
  border: 0;
  border-radius: 4px;
  background: linear-gradient(135deg, #ff7a1a 0%, #f4511e 100%);
  color: #ffffff;
  font-family: "Motiva Sans", Arial, sans-serif;
  text-align: left;
  line-height: 1.15;
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
.igdeals-badge__brand {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.9;
}
.igdeals-badge__row {
  display: flex;
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
.igdeals-badge__tax {
  font-size: 9px;
  opacity: 0.85;
}
.igdeals-badge--block {
  margin: 8px 0 12px;
  padding: 7px 12px;
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

  const label = [display.brandLabel, display.priceLabel, display.discountLabel, display.taxLabel]
    .filter(Boolean)
    .join(' ');
  // Compare against a data attribute, not textContent: replacing textContent
  // would fire the MutationObserver and cause an endless render loop.
  if (badge.dataset.igdealsLabel === label) return;

  badge.dataset.igdealsLabel = label;
  badge.replaceChildren();

  const brand = doc.createElement('span');
  brand.className = 'igdeals-badge__brand';
  brand.textContent = display.brandLabel;

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

  badge.appendChild(brand);
  badge.appendChild(row);

  if (display.taxLabel) {
    const tax = doc.createElement('span');
    tax.className = 'igdeals-badge__tax';
    tax.textContent = display.taxLabel;
    badge.appendChild(tax);
  }
}

function findBadge(root: ParentNode): HTMLButtonElement | null {
  return root.querySelector<HTMLButtonElement>(BADGE_SELECTOR);
}

const TITLE_SELECTORS = 'h1, h2, h3, h4, [role="heading"], .title';
const PRICE_LABEL_RE = /[€$£]|rabatt|reduziert|discount|price|preis/i;

/**
 * Locate the element that represents Steam's current price.
 *
 * The modern wishlist uses hashed class names, so there is no stable
 * `.discount_block` to target. The price link carries an aria-label such as
 * "90 % Rabatt. Regulärer Preis 23,99€ reduziert auf 2,39€." or its text
 * contains an amount; both survive Steam's class-name churn. The legacy
 * `.discount_block` is kept for older layouts and the test fixture.
 */
function findPriceAnchor(container: HTMLElement): HTMLElement | null {
  const legacyBlock = container.querySelector<HTMLElement>(
    '.discount_block, .discount_block_large',
  );
  if (legacyBlock) return legacyBlock;

  for (const node of container.querySelectorAll<HTMLElement>('[role="link"], a')) {
    const label = node.getAttribute('aria-label') ?? '';
    const text = (node.textContent ?? '').trim();
    if (PRICE_LABEL_RE.test(label)) return node;
    if (/[€$£]/.test(text) && text.length <= 120) return node;
  }
  return null;
}

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

    const priceAnchor = findPriceAnchor(container);
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
