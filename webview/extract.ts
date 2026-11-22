/**
 * DOM extraction for Steam's store views.
 *
 * Steam's React wishlist uses build-generated class names, so nothing here
 * depends on a hashed class. We anchor on:
 *
 * - app links: `a[href*="/app/<id>/"]` (the only stable game identifier),
 * - container hints: `div.Panel[data-index]`, `.wishlist_row`,
 *   `[data-appid]`, `[data-ds-appid]`, `[data-panel]`,
 * - human-readable name fallbacks: data attributes, aria-label/title, image
 *   alt text, nearby heading text, the slug in the app URL,
 * - price text, for comparing against the Instant Gaming price.
 */

import type { SteamGame } from '@shared/types';

export type PageKind = 'wishlist' | 'app' | 'other';

export interface PageInfo {
  kind: PageKind;
  /** Set for `kind: 'app'`. */
  appid: number | null;
}

export interface WishlistCard {
  appid: number;
  name: string;
  /** Element that represents one wishlist card; badges are appended here. */
  element: HTMLElement;
  /** The anchor the card was discovered through. */
  anchor: HTMLAnchorElement;
}

const APP_PATH_RE = /\/app\/(\d+)(?:[/?#]|$)/;
const WISHLIST_PATH_RE = /^\/wishlist(?:\/|$)/;
const STORE_HOST_RE = /(^|\.)steampowered\.com$/i;
const CARD_MARKERS =
  'div.Panel[data-index], .wishlist_row, [data-appid], [data-ds-appid], [data-panel]';
const ANCHOR_NAME_ATTRIBUTES = [
  'data-name',
  'data-app-name',
  'data-game-name',
  'data-title',
  'aria-label',
  'title',
];
// Card-level `title`/`aria-label` often describe toolbar actions rather than
// the game, so only the explicit name attributes are trusted there.
const CARD_NAME_ATTRIBUTES = ['data-name', 'data-app-name', 'data-game-name'];
const NAME_TEXT_SELECTORS = 'h1, h2, h3, h4, [role="heading"], .title';

/** Parse the numeric app id out of a store app URL (absolute or relative). */
export function extractAppIdFromHref(href: string | null | undefined): number | null {
  if (!href) return null;

  let path = href;
  try {
    path = new URL(href, 'https://store.steampowered.com').pathname;
  } catch {
    // Keep the raw string; the regex is anchored on `/app/<id>`.
  }

  const match = APP_PATH_RE.exec(path);
  if (!match?.[1]) return null;

  const appid = Number(match[1]);
  return Number.isSafeInteger(appid) && appid > 0 ? appid : null;
}

/** Decide what kind of page the current URL is. */
export function detectPage(url: string): PageInfo {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'other', appid: null };
  }

  if (!STORE_HOST_RE.test(parsed.hostname)) return { kind: 'other', appid: null };
  if (WISHLIST_PATH_RE.test(parsed.pathname)) return { kind: 'wishlist', appid: null };

  const appid = extractAppIdFromHref(parsed.pathname);
  return appid === null ? { kind: 'other', appid: null } : { kind: 'app', appid };
}

function containsOtherApp(element: Element, appid: number): boolean {
  for (const anchor of element.querySelectorAll<HTMLAnchorElement>('a[href*="/app/"]')) {
    const other = extractAppIdFromHref(anchor.getAttribute('href'));
    if (other !== null && other !== appid) return true;
  }
  return false;
}

/**
 * Walk outwards from the app link until we reach a container that holds only
 * this game. This keeps a badge attached to one card even when Steam wraps rows
 * in several layers of anonymous divs.
 */
function findCardForAnchor(anchor: HTMLAnchorElement, appid: number): HTMLElement {
  const markedCandidate = anchor.closest<HTMLElement>(CARD_MARKERS);
  const marked =
    markedCandidate && !containsOtherApp(markedCandidate, appid) ? markedCandidate : null;
  if (marked) return marked;

  let fallback: HTMLElement | null = null;
  let node: HTMLElement | null = anchor.parentElement;

  for (let depth = 0; node && depth < 12; depth += 1) {
    if (containsOtherApp(node, appid)) break;
    if (node.querySelector('img')) fallback = node;
    if (node === document.body) break;
    node = node.parentElement;
  }

  return fallback ?? marked ?? anchor.parentElement ?? anchor;
}

/**
 * Turn an attribute or text blob into a plausible game title.
 * Rejects prices, empty strings, wishlist action labels and absurd lengths.
 */
function cleanName(value: string | null | undefined): string | null {
  if (!value) return null;

  let text = value.replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'“”«»]+|["'“”«»]+$/g, '').trim();

  // aria-labels on the wishlist buttons read "Add X to your wishlist".
  const wishlistAction = /^(?:add|remove)\s+(.+?)\s+(?:to|from)\s+your wishlist$/i.exec(text);
  if (wishlistAction?.[1]) text = wishlistAction[1].trim();

  if (!text || text.length > 200) return null;
  if (/^[\d\s.,:€$£%+\-–—]+$/.test(text)) return null;
  if (/^(?:add|remove)\b/i.test(text)) return null;

  return text;
}

function nameFromHref(href: string, appid: number): string | null {
  let path: string;
  try {
    path = new URL(href, 'https://store.steampowered.com').pathname;
  } catch {
    return null;
  }

  const match = new RegExp(`/app/${appid}/([^/?#]+)`).exec(path);
  if (!match?.[1]) return null;

  let slug = match[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Keep the encoded value.
  }

  return cleanName(slug.replace(/_+/g, ' '));
}

function extractName(
  element: HTMLElement,
  anchor: HTMLAnchorElement,
  appid: number,
  href: string,
): string | null {
  for (const attribute of ANCHOR_NAME_ATTRIBUTES) {
    const name = cleanName(anchor.getAttribute(attribute));
    if (name) return name;
  }

  const image = anchor.querySelector('img[alt]') ?? element.querySelector('img[alt]');
  const imageName = cleanName(image?.getAttribute('alt'));
  if (imageName) return imageName;

  for (const attribute of CARD_NAME_ATTRIBUTES) {
    const name = cleanName(element.getAttribute(attribute));
    if (name) return name;
  }

  for (const node of [anchor, ...element.querySelectorAll(NAME_TEXT_SELECTORS)]) {
    const name = cleanName(node.textContent);
    if (name) return name;
  }

  return nameFromHref(href, appid);
}

/**
 * Collect visible wishlist cards.
 *
 * Deduplicated by app id: the current React wishlist occasionally renders the
 * same app in more than one sibling component, and the same app can be linked
 * from an image, a title and a hover preview inside one card.
 */
export function collectWishlistCards(root: ParentNode = document): WishlistCard[] {
  const cards: WishlistCard[] = [];
  const seen = new Set<number>();

  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href*="/app/"]')) {
    const appid = extractAppIdFromHref(anchor.getAttribute('href'));
    if (appid === null || seen.has(appid)) continue;

    const element = findCardForAnchor(anchor, appid);
    const name = extractName(element, anchor, appid, anchor.href);
    if (!name) continue;

    seen.add(appid);
    cards.push({ appid, name, element, anchor });
  }

  return cards;
}

/** The unique `{appid, name}` pairs to send to the backend. */
export function collectWishlistGames(root: ParentNode = document): SteamGame[] {
  return collectWishlistCards(root).map(({ appid, name }) => ({ appid, name }));
}

/**
 * The card container used for badge placement can be narrower than the row
 * that also holds Steam's price (hover previews and nested app links make the
 * card detector stop early). Walk up to the nearest ancestor that exposes a
 * price so the badge can compare against Steam instead of always staying
 * neutral.
 */
export function findPriceScope(element: HTMLElement): HTMLElement {
  let node: HTMLElement | null = element;
  for (let depth = 0; node && depth < 8; depth += 1) {
    if (node.querySelector('[data-price-final]')) return node;
    if (/[€$£]/.test(node.textContent ?? '')) return node;
    node = node.parentElement;
  }
  return element;
}

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
export function findPriceElement(container: HTMLElement): HTMLElement | null {
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

/** Steam's discount percentage for a wishlist card, 0 when unknown. */
export function steamDiscountPercent(container: HTMLElement): number {
  const price = findPriceElement(container);
  const haystack = `${price?.getAttribute('aria-label') ?? ''} ${price?.textContent ?? ''}`;
  const values = [...haystack.matchAll(/(\d{1,3})\s*%/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 100);
  return values.length > 0 ? Math.max(...values) : 0;
}

/** Read the game name on a store app page, with URL-slug fallback. */
export function extractAppPageGame(
  doc: Document = document,
  appid: number | null = detectPage(doc.location.href).appid,
): SteamGame | null {
  if (appid === null) return null;

  const selectors = ['#appHubAppName', '.apphub_AppName', '[itemprop="name"]'];
  for (const selector of selectors) {
    const name = cleanName(doc.querySelector(selector)?.textContent);
    if (name) return { appid, name };
  }

  const ogTitle = cleanName(
    doc.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content,
  );
  if (ogTitle) return { appid, name: ogTitle.replace(/\s+on\s+Steam$/i, '').trim() };

  const title = cleanName(doc.title.replace(/\s+on\s+Steam$/i, ''));
  if (title) return { appid, name: title };

  const slugName = nameFromHref(doc.location.href, appid);
  return slugName ? { appid, name: slugName } : null;
}

function parseLocalizedAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator comes last is the decimal separator.
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    normalized = cleaned.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma !== -1) {
    normalized = /,\d{1,2}$/.test(cleaned)
      ? cleaned.replace(',', '.')
      : cleaned.split(',').join('');
  } else if (lastDot !== -1) {
    normalized = /\.\d{1,2}$/.test(cleaned) ? cleaned : cleaned.split('.').join('');
  }

  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) ? amount : null;
}

const AMOUNT_WITH_SYMBOL_RE = /(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d{1,2})?\s*(€|\$|£)/;

function currencyOfSymbol(symbol: string): string | null {
  if (symbol === '€') return 'EUR';
  if (symbol === '£') return 'GBP';
  if (symbol === '$') return 'USD';
  return null;
}

/**
 * Best-effort currency of the price visible on the page.
 *
 * `$` cannot distinguish USD/CAD/AUD. The comparison is skipped unless the
 * symbol maps to the configured currency, which keeps cross-currency numbers
 * from producing a wrong green badge.
 */
export function detectSteamCurrency(root: ParentNode): string | null {
  const match = AMOUNT_WITH_SYMBOL_RE.exec(root.textContent ?? '');
  return match?.[1] ? currencyOfSymbol(match[1]) : null;
}

/**
 * Find Steam's current price inside a card or purchase box.
 *
 * Steam sometimes exposes the final price in cents via `data-price-final`;
 * otherwise we scan the visible text for a currency-signed amount. Percentages
 * carry no currency symbol, so discount labels are ignored. When several
 * prices are present (original + discounted), the lowest is the current one.
 *
 * When `expectedCurrency` is given and the page clearly shows a different
 * currency, `null` is returned: comparing 59.99 USD with 45.99 EUR would be
 * wrong, so the badge stays neutral instead of claiming a saving.
 */
export function extractSteamPrice(root: ParentNode, expectedCurrency?: string): number | null {
  const detectedCurrency = detectSteamCurrency(root);
  if (
    expectedCurrency &&
    detectedCurrency !== null &&
    detectedCurrency !== expectedCurrency.toUpperCase()
  ) {
    return null;
  }

  const centsNode = root.querySelector('[data-price-final]');
  if (centsNode) {
    const cents = centsNode.getAttribute('data-price-final');
    if (cents && /^\d+$/.test(cents)) {
      const value = Number(cents) / 100;
      if (Number.isFinite(value) && value >= 0) return value;
    }
  }

  const text = root.textContent ?? '';
  if (/\b(?:free|free to play|kostenlos|gratis|gratuit)\b/i.test(text) && !/[€$£]/.test(text)) {
    return 0;
  }

  const amounts: number[] = [];
  const amountPattern = /(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d{1,2})?\s*(?:€|\$|£)/g;
  for (const match of text.matchAll(amountPattern)) {
    const amount = parseLocalizedAmount(match[0]);
    if (amount !== null && amount >= 0) amounts.push(amount);
  }

  return amounts.length > 0 ? Math.min(...amounts) : null;
}
