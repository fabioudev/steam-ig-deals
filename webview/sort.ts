/**
 * IG-aware wishlist sorting.
 *
 * Steam's sort control opens an HTML popover with plain option buttons. The
 * plugin appends a localized "Rabatt inkl. IG" / "Discount incl. IG" option and
 * reflects the choice in the sort button label, so the control no longer shows
 * the previous Steam sort while IG sorting is active.
 *
 * The list is switched to a flex column and the cards receive CSS `order`
 * values. Moving React-managed DOM nodes made Steam remount the list (a visible
 * flash), so the order is applied visually instead. The MutationObserver in the
 * preload re-applies it after Steam re-renders.
 */

import type { PriceResult } from '@shared/types';
import { steamDiscountPercent, type WishlistCard } from './extract';

export const SORT_STORAGE_KEY = 'igdeals.sortActive';
const SORT_KEYS_STORAGE = 'igdeals.sortKeys';
const SORT_RANKS_STORAGE = 'igdeals.sortRanks';
const SORT_STYLE_ID = 'igdeals-sort-styles';

export function loadSortActive(): boolean {
  try {
    return window.localStorage.getItem(SORT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveSortActive(active: boolean): void {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, active ? '1' : '0');
  } catch {
    // Storage can be unavailable; sorting still works for this page load.
  }
}

function isGerman(doc: Document): boolean {
  const lang =
    (doc.documentElement.lang || (typeof navigator !== 'undefined' ? navigator.language : '')) ??
    '';
  return lang.toLowerCase().startsWith('de');
}

/** Localized label used both in the popup and on the sort button. */
export function sortOptionLabel(doc: Document): string {
  return isGerman(doc) ? 'Rabatt inkl. IG' : 'Discount incl. IG';
}

function findSteamSortButton(doc: Document): HTMLElement | null {
  return (
    Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"]')).find((el) =>
      /sortieren nach|sort by/i.test(el.textContent ?? ''),
    ) ?? null
  );
}

/**
 * While IG sorting is active, show it on Steam's sort button instead of the
 * stale native selection. Idempotent; the preload calls it on every refresh so
 * a React re-render cannot leave the old label behind.
 */
export function setSortLabel(doc: Document, active: boolean): void {
  // Do not mutate the sort control while its popup is open; that re-renders
  // the menu and makes it flicker.
  if (!active || findSortPopup(doc)) return;
  const label = findSteamSortButton(doc)?.querySelector<HTMLElement>('span');
  const text = sortOptionLabel(doc);
  if (label && label.textContent !== text) {
    label.textContent = text;
  }
}

function sortKey(card: WishlistCard, results: Map<number, PriceResult>): number {
  const steam = steamDiscountPercent(card.element);
  const result = results.get(card.appid);
  const ig =
    result?.status === 'matched' && result.product?.has_stock
      ? Number(result.product.discount) || 0
      : 0;
  return Math.max(steam, ig);
}

/**
 * Apply the visual order with CSS `order` instead of moving DOM nodes. Steam's
 * list is React-managed; moving its children makes React remount cards (the
 * list flashes empty and reappears). Flex order leaves the DOM untouched.
 */
/**
 * Persistent appid -> rank map. React rewrites card style attributes, which
 * used to drop our `order` values; keeping the ranks lets us re-apply the exact
 * same order without re-sorting (and therefore without visible jumps).
 */
let ranks: Map<number, number> | null = null;

function loadRanks(): Map<number, number> {
  if (ranks) return ranks;
  ranks = new Map();

  try {
    const raw = window.localStorage.getItem(SORT_RANKS_STORAGE);
    if (!raw) return ranks;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      const appid = Number(key);
      const rank = Number(value);
      if (Number.isSafeInteger(appid) && Number.isFinite(rank)) ranks.set(appid, rank);
    }
  } catch {
    // Corrupt storage: fall back to an empty map.
  }
  return ranks;
}

function saveRanks(): void {
  if (!ranks) return;
  try {
    window.localStorage.setItem(SORT_RANKS_STORAGE, JSON.stringify(Object.fromEntries(ranks)));
  } catch {
    // Storage can be unavailable; the current page still works.
  }
}

/**
 * The order is applied by a generated stylesheet that targets data attributes
 * on the cards, not by inline styles. React rewrites card `style` attributes
 * (which used to drop our order), but it does not own our stylesheet, so the
 * visual order survives re-renders and virtualization.
 */
function renderSortStyle(doc: Document): void {
  const rules = [
    '[data-igdeals-sorted] { display: flex !important; flex-direction: column !important; }',
  ];
  for (const [appid, rank] of loadRanks()) {
    rules.push(`[data-igdeals-appid="${appid}"] { order: ${rank} !important; }`);
  }

  let style = doc.getElementById(SORT_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = SORT_STYLE_ID;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  const content = rules.join('\n');
  if (style.textContent !== content) style.textContent = content;
}

function applyRankStyles(parent: HTMLElement, cards: WishlistCard[]): void {
  parent.setAttribute('data-igdeals-sorted', '');
  const rankMap = loadRanks();
  for (const card of cards) {
    if (!rankMap.has(card.appid)) continue;
    const value = String(card.appid);
    if (card.element.getAttribute('data-igdeals-appid') !== value) {
      card.element.setAttribute('data-igdeals-appid', value);
    }
  }
  renderSortStyle(parent.ownerDocument);
}

/** Rebuild the rank map from scratch (explicit "Rabatt inkl. IG" selection). */
function rebuildRanks(cards: WishlistCard[], results: Map<number, PriceResult>): void {
  ranks = new Map();
  sortedCards(cards, results).forEach((card, index) => {
    ranks?.set(card.appid, index);
  });
  saveRanks();
}

/** Give cards loaded later a rank after all existing ones; never move placed ones. */
function ensureNewRanks(cards: WishlistCard[], results: Map<number, PriceResult>): void {
  const rankMap = loadRanks();
  if (rankMap.size === 0) {
    rebuildRanks(cards, results);
    return;
  }

  const fresh = cards.filter((card) => !rankMap.has(card.appid));
  if (fresh.length === 0) return;

  let maxRank = -1;
  for (const rank of rankMap.values()) maxRank = Math.max(maxRank, rank);
  sortedCards(fresh, results).forEach((card, index) => {
    rankMap.set(card.appid, maxRank + 1 + index);
  });
  saveRanks();
}

/** Remove the visual sort styles and the stored ranks. */
export function clearSortStyles(cards: WishlistCard[]): void {
  for (const card of cards) card.element.removeAttribute('data-igdeals-appid');
  const parent = cards[0]?.element.parentElement;
  parent?.removeAttribute('data-igdeals-sorted');

  const doc = cards[0]?.element.ownerDocument ?? document;
  doc.getElementById(SORT_STYLE_ID)?.remove();

  ranks = null;
  try {
    window.localStorage.removeItem(SORT_RANKS_STORAGE);
  } catch {
    // Ignore unavailable storage.
  }
}

function persistSortKeys(cards: WishlistCard[], results: Map<number, PriceResult>): void {
  const keys: Record<string, number> = {};
  for (const card of cards) keys[String(card.appid)] = sortKey(card, results);
  try {
    window.localStorage.setItem(SORT_KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // Storage can be unavailable; the next load just sorts a little later.
  }
}

function sortedCards(cards: WishlistCard[], results: Map<number, PriceResult>): WishlistCard[] {
  return [...cards].sort((a, b) => {
    const delta = sortKey(b, results) - sortKey(a, results);
    return delta !== 0 ? delta : a.name.localeCompare(b.name);
  });
}

/**
 * Re-sort the loaded cards (explicit selection). Rebuilds the rank map, so this
 * is the only operation that can visibly reorder already placed cards.
 */
export function applyIgSort(cards: WishlistCard[], results: Map<number, PriceResult>): void {
  if (cards.length < 2) return;
  const parent = cards[0]?.element.parentElement;
  if (!parent) return;

  persistSortKeys(cards, results);
  rebuildRanks(cards, results);
  applyRankStyles(parent, cards);
}

/**
 * Re-apply the stored ranks after a re-render and append newly loaded cards
 * after the placed ones. Re-sorting the growing set on every scroll made the
 * visible order jump.
 */
export function appendNewCards(cards: WishlistCard[], results: Map<number, PriceResult>): void {
  if (cards.length === 0) return;
  const parent = cards[0]?.element.parentElement;
  if (!parent) return;

  ensureNewRanks(cards, results);
  applyRankStyles(parent, cards);
}

/**
 * Sort with the ranks persisted by the previous session, before the backend has
 * answered. Falls back to the cached sort keys when no rank map exists yet.
 */
export function applyCachedSort(cards: WishlistCard[]): void {
  if (cards.length < 2) return;
  const parent = cards[0]?.element.parentElement;
  if (!parent) return;

  if (loadRanks().size > 0) {
    applyRankStyles(parent, cards);
    return;
  }

  let keys: Record<string, unknown>;
  try {
    keys = JSON.parse(window.localStorage.getItem(SORT_KEYS_STORAGE) ?? '{}') as Record<
      string,
      unknown
    >;
  } catch {
    return;
  }
  if (!keys || typeof keys !== 'object') return;

  const keyOf = (card: WishlistCard): number => {
    const value = keys[String(card.appid)];
    return typeof value === 'number' && Number.isFinite(value) ? value : -1;
  };
  if (cards.filter((card) => keyOf(card) >= 0).length < 2) return;

  const sorted = [...cards].sort((a, b) => keyOf(b) - keyOf(a) || a.name.localeCompare(b.name));
  ranks = new Map();
  sorted.forEach((card, index) => {
    ranks?.set(card.appid, index);
  });
  saveRanks();
  applyRankStyles(parent, cards);
}

function isPopupVisible(element: HTMLElement): boolean {
  try {
    if (element.matches(':popover-open')) return true;
  } catch {
    // Older engines do not know the pseudo-class; fall back to layout boxes.
  }
  return element.getClientRects().length > 0;
}

/**
 * Find Steam's open sort popup. The control uses the HTML popover API and
 * renders plain option buttons ("Name", "Preis", "Rabatt", …). We match on the
 * option labels instead of the hashed class names. Hidden popups are ignored:
 * Steam keeps them in the DOM after closing.
 */
export function findSortPopup(doc: Document): HTMLElement | null {
  const popups = Array.from(
    doc.querySelectorAll<HTMLElement>('[popover], [role="menu"], [role="listbox"]'),
  );
  const matching = popups.filter((popup) => {
    const labels = Array.from(popup.querySelectorAll('button')).map((button) =>
      (button.textContent ?? '').trim().toLowerCase(),
    );
    const hasDiscount = labels.includes('rabatt') || labels.some((l) => l.includes('discount'));
    const hasName = labels.includes('name');
    const hasPrice = labels.includes('preis') || labels.includes('price');
    return hasDiscount && (hasName || hasPrice);
  });
  return matching.find(isPopupVisible) ?? null;
}

function closePopup(popup: HTMLElement): void {
  const hide = (popup as HTMLElement & { hidePopover?: () => void }).hidePopover;
  if (typeof hide === 'function') {
    try {
      hide.call(popup);
      return;
    } catch {
      // Fall through to the style fallback.
    }
  }
  popup.style.display = 'none';
}

/**
 * Append the localized IG sort option to an open popup. Idempotent; wiring is
 * added once per native option so picking a Steam sort deactivates IG sorting
 * without restoring the old order (Steam will reorder anyway).
 */
export function injectSortOption(
  popup: HTMLElement,
  doc: Document,
  active: boolean,
  onIgSelect: (active: boolean) => void,
  onNativeSelect: () => void,
): void {
  let option = popup.querySelector<HTMLButtonElement>('[data-igdeals-sort-option]');
  if (!option) {
    option = doc.createElement('button');
    option.type = 'button';
    option.setAttribute('role', 'button');
    option.className = 'Focusable igdeals-sort-option';
    option.setAttribute('data-igdeals-sort-option', '');
    option.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Close first so the sort-label update is not skipped by the
      // "popup is open" guard.
      closePopup(popup);
      onIgSelect(true);
    });
    popup.appendChild(option);

    for (const button of popup.querySelectorAll<HTMLButtonElement>(
      'button:not([data-igdeals-sort-option])',
    )) {
      if (button.hasAttribute('data-igdeals-sort-native')) continue;
      button.setAttribute('data-igdeals-sort-native', '');
      button.addEventListener('click', () => onNativeSelect());
    }
  }

  const text = sortOptionLabel(doc);
  if (option.textContent !== text) option.textContent = text;
  option.classList.toggle('igdeals-sort-option--active', active);
  option.setAttribute('aria-pressed', String(active));
}

let menuListenerInstalled = false;

/**
 * Watch sort-button clicks and inject the extra option once the popup has
 * rendered. Steam's popup opens asynchronously, hence the small delay.
 */
export function installSortMenu(
  doc: Document,
  onIgSelect: (active: boolean) => void,
  onNativeSelect: () => void,
  isActive: () => boolean,
): void {
  if (menuListenerInstalled) return;
  menuListenerInstalled = true;

  doc.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      const sortButton = target?.closest<HTMLElement>('button, [role="button"]');
      if (!sortButton || !/sortieren nach|sort by/i.test(sortButton.textContent ?? '')) return;

      // The popup renders asynchronously. Poll briefly so the option appears
      // with the menu, and keep it present if React replaces the popup.
      let found = false;
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        const popup = findSortPopup(doc);
        if (popup) {
          found = true;
          injectSortOption(popup, doc, isActive(), onIgSelect, onNativeSelect);
        } else if (found || attempts > 40) {
          window.clearInterval(timer);
        }
      }, 25);
      window.setTimeout(() => window.clearInterval(timer), 4000);
    },
    true,
  );
}
