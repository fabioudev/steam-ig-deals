/**
 * "IG-Rabatt" sort control.
 *
 * Steam's own sort menu is a React popup that does not open for programmatic
 * clicks, so adding an option inside it is fragile. Instead the plugin adds a
 * sibling control next to Steam's sort button. When active, wishlist cards are
 * reordered by the best discount available: Steam's discount or Instant
 * Gaming's discount, whichever is larger.
 *
 * The cards live in a plain block container (not a flex column), so the order
 * is applied by moving the card elements. The MutationObserver in the preload
 * re-applies it after Steam re-renders.
 */

import type { PriceResult } from '@shared/types';
import { steamDiscountPercent, type WishlistCard } from './extract';

export const SORT_STORAGE_KEY = 'igdeals.sortActive';
export const SORT_BUTTON_ID = 'igdeals-sort-toggle';
const ACTIVE_CLASS = 'igdeals-sort-toggle--active';

let originalAppIds: number[] | null = null;

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

function setButtonState(button: HTMLButtonElement, active: boolean): void {
  button.classList.toggle(ACTIVE_CLASS, active);
  button.setAttribute('aria-pressed', String(active));
  button.title = active
    ? 'Sortiert nach dem besten Rabatt (Steam oder Instant Gaming). Klicken zum Ausschalten.'
    : 'Nach dem besten Rabatt sortieren (Steam oder Instant Gaming).';
}

function findSteamSortButton(doc: Document): HTMLElement | null {
  return (
    Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"]')).find((el) =>
      /sortieren nach|sort by/i.test(el.textContent ?? ''),
    ) ?? null
  );
}

/**
 * Insert the toggle next to Steam's sort button (idempotent). The callback
 * fires after the state flips so the caller can re-sort or restore.
 */
export function installSortControl(doc: Document, onChange: (active: boolean) => void): void {
  const existing = doc.getElementById(SORT_BUTTON_ID) as HTMLButtonElement | null;
  if (existing) {
    setButtonState(existing, loadSortActive());
    return;
  }

  const sortButton = findSteamSortButton(doc);
  if (!sortButton?.parentElement) return;

  const button = doc.createElement('button');
  button.id = SORT_BUTTON_ID;
  button.type = 'button';
  button.className = 'igdeals-sort-toggle Focusable';
  button.textContent = 'IG-Rabatt';
  setButtonState(button, loadSortActive());

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const active = !button.classList.contains(ACTIVE_CLASS);
    setButtonState(button, active);
    saveSortActive(active);
    onChange(active);
  });

  sortButton.insertAdjacentElement('afterend', button);
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
 * Reorder the wishlist cards by the best available discount. Idempotent: the
 * DOM is only touched when the current order differs from the target.
 */
export function applyIgSort(cards: WishlistCard[], results: Map<number, PriceResult>): void {
  if (cards.length < 2) return;
  const parent = cards[0]?.element.parentElement;
  if (!parent) return;

  if (!originalAppIds) originalAppIds = cards.map((card) => card.appid);

  const sorted = [...cards].sort((a, b) => {
    const delta = sortKey(b, results) - sortKey(a, results);
    return delta !== 0 ? delta : a.name.localeCompare(b.name);
  });

  const desired = sorted.map((card) => card.element);
  const current = Array.from(parent.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-index].Panel'),
  );
  if (current.length === desired.length && desired.every((el, index) => current[index] === el)) {
    return;
  }

  for (const card of sorted) {
    parent.appendChild(card.element);
  }
}

/** Restore the order captured before the first IG sort, then forget it. */
export function restoreOriginalOrder(cards: WishlistCard[]): void {
  if (!originalAppIds) return;
  const byAppId = new Map(cards.map((card) => [card.appid, card] as const));
  for (const appid of originalAppIds) {
    const card = byAppId.get(appid);
    if (!card) continue;
    card.element.parentElement?.appendChild(card.element);
  }
  originalAppIds = null;
}

/** Forget the captured order, e.g. after client-side navigation. */
export function resetSortState(): void {
  originalAppIds = null;
}
