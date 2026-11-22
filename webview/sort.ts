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
  if (!active) return;
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
function applyOrderStyles(parent: HTMLElement, sorted: WishlistCard[]): void {
  if (window.getComputedStyle(parent).display !== 'flex') {
    parent.style.display = 'flex';
    parent.style.flexDirection = 'column';
  }

  sorted.forEach((card, index) => {
    const value = String(index);
    if (card.element.style.order !== value) card.element.style.order = value;
  });
}

/** Remove the visual sort styles so Steam's own order is visible again. */
export function clearSortStyles(cards: WishlistCard[]): void {
  for (const card of cards) card.element.style.order = '';
  const parent = cards[0]?.element.parentElement;
  if (parent) {
    parent.style.display = '';
    parent.style.flexDirection = '';
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

/**
 * Reorder the wishlist cards by the best available discount. Idempotent: the
 * DOM is only touched when the current order differs from the target.
 */
export function applyIgSort(cards: WishlistCard[], results: Map<number, PriceResult>): void {
  if (cards.length < 2) return;
  const parent = cards[0]?.element.parentElement;
  if (!parent) return;

  persistSortKeys(cards, results);

  const sorted = [...cards].sort((a, b) => {
    const delta = sortKey(b, results) - sortKey(a, results);
    return delta !== 0 ? delta : a.name.localeCompare(b.name);
  });

  applyOrderStyles(parent, sorted);
}

/**
 * Sort with the keys persisted by the previous session, before the backend has
 * answered. This prevents the visible second reorder when the prices arrive.
 */
export function applyCachedSort(cards: WishlistCard[]): void {
  if (cards.length < 2) return;

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

  const parent = cards[0]?.element.parentElement;
  if (!parent) return;

  const sorted = [...cards].sort((a, b) => keyOf(b) - keyOf(a) || a.name.localeCompare(b.name));
  applyOrderStyles(parent, sorted);
}

/**
 * Find Steam's open sort popup. The control uses the HTML popover API and
 * renders plain option buttons ("Name", "Preis", "Rabatt", …). We match on the
 * option labels instead of the hashed class names.
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
  return matching.find((popup) => popup.getClientRects().length > 0) ?? matching[0] ?? null;
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
      onIgSelect(true);
      closePopup(popup);
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

      window.setTimeout(() => {
        const popup = findSortPopup(doc);
        if (popup) injectSortOption(popup, doc, isActive(), onIgSelect, onNativeSelect);
      }, 80);
    },
    true,
  );
}
