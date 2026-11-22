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

/** Reflect the sort state on the standalone toggle, if it exists. */
export function setSortButtonState(doc: Document, active: boolean): void {
  const button = doc.getElementById(SORT_BUTTON_ID) as HTMLButtonElement | null;
  if (button) setButtonState(button, active);
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
    return labels.includes('rabatt') && (labels.includes('name') || labels.includes('preis'));
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
 * Append "Rabatt inkl. IG" to an open sort popup. Idempotent; wiring is added
 * once per native option so picking a Steam sort deactivates IG sorting
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
    option.textContent = 'Rabatt inkl. IG';
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
