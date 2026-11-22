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

export type PageKind = 'wishlist' | 'app' | 'search' | 'store' | 'other';

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
  if (/^\/search\/?$/i.test(parsed.pathname)) return { kind: 'search', appid: null };

  const appid = extractAppIdFromHref(parsed.pathname);
  if (appid !== null) return { kind: 'app', appid };
  if (parsed.pathname === '/' || parsed.pathname === '') {
    return { kind: 'store', appid: null };
  }
  return { kind: 'other', appid: null };
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

const STORE_NAME_SELECTORS = [
  '.title',
  '.match_name',
  '.tab_item_title',
  '[class*="item_title"]',
  '[class*="app_name"]',
  '[class*="capsule_title"]',
];

function elementAppId(element: Element): number | null {
  for (const attribute of ['data-ds-appid', 'data-appid', 'data-steam-appid']) {
    const value = element.getAttribute(attribute);
    if (value && /^\d+$/.test(value)) return Number(value);
  }

  const itemKey = element.getAttribute('data-ds-itemkey');
  const appMatch = /^App_(\d+)$/.exec(itemKey ?? '');
  if (appMatch?.[1]) return Number(appMatch[1]);

  return extractAppIdFromHref(element.getAttribute('href'));
}

function hasOtherApp(element: Element, appid: number): boolean {
  for (const link of element.querySelectorAll<HTMLAnchorElement>('a[href*="/app/"]')) {
    const id = extractAppIdFromHref(link.getAttribute('href'));
    if (id !== null && id !== appid) return true;
  }
  return false;
}

function appIdFromImageUrl(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /\/apps\/(\d+)\//.exec(value);
  if (!match?.[1]) return null;
  const appid = Number(match[1]);
  return Number.isSafeInteger(appid) && appid > 0 ? appid : null;
}

function imageAppId(image: HTMLImageElement): number | null {
  for (const attribute of ['src', 'data-delayed-image', 'data-src', 'data-lazy-src', 'srcset']) {
    const id = appIdFromImageUrl(image.getAttribute(attribute));
    if (id !== null) return id;
  }
  return null;
}

function hasOtherImageApp(element: Element, appid: number): boolean {
  for (const image of element.querySelectorAll<HTMLImageElement>('img')) {
    const id = imageAppId(image);
    if (id !== null && id !== appid) return true;
  }
  for (const node of element.querySelectorAll<HTMLElement>('[style*="apps/"]')) {
    const id = appIdFromImageUrl(node.getAttribute('style'));
    if (id !== null && id !== appid) return true;
  }
  return false;
}

/** Walk outwards from a capsule image/background to its card container. */
function findImageCard(start: HTMLElement, appid: number): HTMLElement {
  let best: HTMLElement = start;
  let node: HTMLElement | null = start;

  for (let depth = 0; node && depth < 8; depth += 1) {
    if (hasOtherApp(node, appid) || hasOtherImageApp(node, appid)) break;
    if (
      node.querySelector('[class*="title"], [class*="name"], [class*="price"]') ||
      node.querySelector('img')
    ) {
      best = node;
    }
    if (node === document.body) break;
    node = node.parentElement;
  }

  return best;
}

/** Walk outwards from an app link to its card, stopping at other games. */
function findAnchorCard(anchor: HTMLAnchorElement, appid: number): HTMLElement {
  let best: HTMLElement = anchor;
  let node: HTMLElement | null = anchor;

  for (let depth = 0; node && depth < 8; depth += 1) {
    if (hasOtherApp(node, appid)) break;
    if (node.querySelector('img') || node.querySelector('[class*="title"], [class*="name"]')) {
      best = node;
    }
    if (node === document.body) break;
    node = node.parentElement;
  }

  return best;
}

function elementName(element: Element, appid: number): string | null {
  for (const selector of STORE_NAME_SELECTORS) {
    const name = cleanName(element.querySelector(selector)?.textContent);
    if (name) return name;
  }

  const imageName = cleanName(element.querySelector('img[alt]')?.getAttribute('alt'));
  if (imageName) return imageName;

  const link = element.matches('a[href*="/app/"]')
    ? element
    : element.querySelector('a[href*="/app/"]');
  return nameFromHref(link?.getAttribute('href') ?? '', appid);
}

/** Cards on the store search results page. */
export function collectSearchCards(root: ParentNode = document): WishlistCard[] {
  const cards: WishlistCard[] = [];
  const seen = new Set<number>();

  for (const row of root.querySelectorAll<HTMLAnchorElement>(
    'a.search_result_row[data-ds-appid]',
  )) {
    const appid = elementAppId(row);
    if (appid === null || seen.has(appid)) continue;
    const name = elementName(row, appid);
    if (!name) continue;
    seen.add(appid);
    cards.push({ appid, name, element: row, anchor: row });
  }

  return cards;
}

/**
 * App cards throughout the main shop page. The page mixes many formats, so
 * this covers explicit `data-*-appid` cards first and then falls back to any
 * app link, walking outwards to the nearest single-game card container.
 */
export function collectStoreCards(root: ParentNode = document): WishlistCard[] {
  const cards: WishlistCard[] = [];

  const overlaps = (element: HTMLElement): boolean =>
    cards.some(
      (card) =>
        card.element === element ||
        card.element.contains(element) ||
        element.contains(card.element),
    );

  const add = (element: HTMLElement, appid: number, anchor: HTMLAnchorElement | null): void => {
    if (overlaps(element)) return;
    if (
      !element.querySelector('img') &&
      !element.querySelector('[class*="title"], [class*="name"]')
    ) {
      return;
    }
    const name = elementName(element, appid);
    if (!name) return;
    cards.push({ appid, name, element, anchor: anchor ?? (element as HTMLAnchorElement) });
  };

  for (const node of root.querySelectorAll<HTMLElement>(
    '[data-ds-appid], [data-appid], [data-steam-appid]',
  )) {
    if (node.closest('a.search_result_row, a.match')) continue;
    const appid = elementAppId(node);
    if (appid === null) continue;
    if (hasOtherApp(node, appid)) continue; // Section wrapper, not a card.
    const anchor = node.matches('a[href*="/app/"]')
      ? (node as HTMLAnchorElement)
      : node.querySelector<HTMLAnchorElement>('a[href*="/app/"]');
    add(node, appid, anchor);
  }

  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href*="/app/"]')) {
    if (anchor.closest('a.search_result_row, a.match')) continue;
    const appid = extractAppIdFromHref(anchor.getAttribute('href'));
    if (appid === null) continue;
    add(findAnchorCard(anchor, appid), appid, anchor);
  }

  // Carousels and featured banners often expose the appid only through the
  // capsule image URL, without data attributes or app links.
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    const appid = imageAppId(image);
    if (appid === null) continue;
    add(findImageCard(image, appid), appid, image.closest<HTMLAnchorElement>('a[href*="/app/"]'));
  }

  for (const node of root.querySelectorAll<HTMLElement>('[style*="apps/"]')) {
    const appid = appIdFromImageUrl(node.getAttribute('style'));
    if (appid === null) continue;
    add(
      findImageCard(node, appid),
      appid,
      node.querySelector<HTMLAnchorElement>('a[href*="/app/"]'),
    );
  }

  return cards;
}

/** Rows in Steam's search autocomplete dropdown. */
export function collectSuggestionCards(root: ParentNode = document): WishlistCard[] {
  const cards: WishlistCard[] = [];
  const seen = new Set<number>();

  for (const row of root.querySelectorAll<HTMLAnchorElement>('a.match[data-ds-appid]')) {
    const appid = elementAppId(row);
    if (appid === null || seen.has(appid)) continue;
    const name =
      cleanName(row.querySelector('.match_name')?.textContent) ?? elementName(row, appid);
    if (!name) continue;
    seen.add(appid);
    cards.push({ appid, name, element: row, anchor: row });
  }

  return cards;
}

/**
 * DLC rows and purchase editions/packages on a store app page. DLCs are normal
 * appids; packages have no appid, so they get a synthetic negative id and are
 * matched by name.
 */
export function collectAppPageExtras(
  root: ParentNode = document,
  primaryAppId: number | null = null,
): WishlistCard[] {
  const cards: WishlistCard[] = [];
  const seen = new Set<number>();
  const primaryName = cleanName(root.querySelector('#appHubAppName, .apphub_AppName')?.textContent);

  for (const row of root.querySelectorAll<HTMLElement>(
    'a.game_area_dlc_row[data-ds-appid], .game_area_dlc_row[data-ds-appid]',
  )) {
    const appid = elementAppId(row);
    if (appid === null || appid === primaryAppId || seen.has(appid)) continue;

    let name: string | null = null;
    const nameElement = row.querySelector('.game_area_dlc_name');
    if (nameElement) {
      const clone = nameElement.cloneNode(true) as HTMLElement;
      // "New"/"Neu"/... highlight labels are part of the name container.
      clone.querySelector('.dlc_highlight_reason_container')?.remove();
      name = cleanName(clone.textContent);
    }
    name = name ?? elementName(row, appid);
    if (!name) continue;

    seen.add(appid);
    cards.push({ appid, name, element: row, anchor: row as HTMLAnchorElement });
  }

  for (const game of root.querySelectorAll<HTMLElement>('.game_area_purchase_game')) {
    const rawTitle = cleanName(game.querySelector('h2.title, .title')?.textContent);
    const title = rawTitle
      ?.replace(/^Buy\s+/i, '')
      .replace(/\s+(?:kaufen|buy|purchase|acheter|comprar|acquista|compra)\s*$/i, '')
      .trim();
    if (!title) continue;
    if (primaryName && title.toLowerCase() === primaryName.toLowerCase()) continue;

    const subid = game.querySelector<HTMLInputElement>('input[name="subid"]')?.value;
    const idMatch = /add_to_cart_(\d+)/.exec(game.id);
    const packageId = Number(subid ?? idMatch?.[1] ?? Number.NaN);
    if (!Number.isFinite(packageId) || packageId <= 0) continue;

    const synthetic = -(1_000_000_000 + packageId);
    if (seen.has(synthetic)) continue;
    seen.add(synthetic);

    cards.push({
      appid: synthetic,
      name: title,
      element: game,
      anchor: (game.querySelector('a[href*="/app/"]') ?? game) as HTMLAnchorElement,
    });
  }

  return cards;
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

  const priceLike = container.querySelector<HTMLElement>('[data-price-final], [class*="price"]');
  if (priceLike) return priceLike;

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
