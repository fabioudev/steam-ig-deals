// @vitest-environment happy-dom

import type { PriceResult } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WishlistCard } from '../../webview/extract';
import { steamDiscountPercent } from '../../webview/extract';
import {
  applyCachedSort,
  applyIgSort,
  clearSortStyles,
  findSortPopup,
  injectSortOption,
  loadSortActive,
  SORT_STORAGE_KEY,
  saveSortActive,
  setSortLabel,
} from '../../webview/sort';

function makeCard(appid: number, name: string, priceHtml: string): WishlistCard {
  const element = document.createElement('div');
  element.className = 'Panel';
  element.setAttribute('data-index', String(appid));
  element.innerHTML = `<a href="https://store.steampowered.com/app/${appid}/Game/">${name}</a>${priceHtml}`;
  return {
    appid,
    name,
    element,
    anchor: element.querySelector('a') as HTMLAnchorElement,
  };
}

function matched(appid: number, discount: number, hasStock = true): PriceResult {
  return {
    appid,
    status: 'matched',
    product: {
      prod_id: appid,
      object_id: String(appid),
      name: `Game ${appid}`,
      full_name: `Game ${appid}`,
      platform: 'Steam',
      region: 'DE',
      price: 10,
      retail: 20,
      discount,
      currency: 'EUR',
      url: `https://www.instant-gaming.com/de/${appid}-kaufen-game/`,
      has_stock: hasStock,
      preorder: false,
      is_dlc: false,
    },
  };
}

beforeEach(() => {
  document.documentElement.lang = 'de';
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('steamDiscountPercent', () => {
  it('reads the discount from the price element', () => {
    const card = makeCard(1, 'Game', '<div class="discount_block">-75% 4,99 €</div>');
    expect(steamDiscountPercent(card.element)).toBe(75);
  });

  it('returns 0 when the card has no price', () => {
    const card = makeCard(1, 'Game', '<span>No price</span>');
    expect(steamDiscountPercent(card.element)).toBe(0);
  });
});

function visualOrder(list: HTMLElement): (string | null)[] {
  return Array.from(list.children)
    .sort(
      (a, b) =>
        Number((a as HTMLElement).style.order || 0) - Number((b as HTMLElement).style.order || 0),
    )
    .map((el) => el.getAttribute('data-index'));
}

describe('IG-aware sorting', () => {
  it('sorts by the best discount with flex order, without moving DOM nodes', () => {
    const list = document.createElement('div');
    const a = makeCard(1, 'Alpha', '<div class="discount_block">-50% 5,00 €</div>');
    const b = makeCard(2, 'Beta', '<div class="discount_block">-20% 8,00 €</div>');
    const c = makeCard(3, 'Gamma', '<div class="discount_block">-30% 7,00 €</div>');
    list.append(a.element, b.element, c.element);
    document.body.appendChild(list);

    const results = new Map<number, PriceResult>([
      [1, matched(1, 10)],
      [2, matched(2, 80)],
      [3, { appid: 3, status: 'no_match' }],
    ]);

    applyIgSort([a, b, c], results);
    expect(visualOrder(list)).toEqual(['2', '1', '3']);
    expect(list.style.display).toBe('flex');
    // The DOM order is untouched so React does not remount the list.
    expect(Array.from(list.children).map((el) => el.getAttribute('data-index'))).toEqual([
      '1',
      '2',
      '3',
    ]);

    // Idempotent: a second pass keeps the same visual order.
    applyIgSort([a, b, c], results);
    expect(visualOrder(list)).toEqual(['2', '1', '3']);
  });

  it('applies the cached order before prices arrive', () => {
    const results = new Map<number, PriceResult>([
      [1, matched(1, 10)],
      [2, matched(2, 80)],
      [3, { appid: 3, status: 'no_match' }],
    ]);

    const first = document.createElement('div');
    const a = makeCard(1, 'Alpha', '<div class="discount_block">-50% 5,00 €</div>');
    const b = makeCard(2, 'Beta', '<div class="discount_block">-20% 8,00 €</div>');
    const c = makeCard(3, 'Gamma', '<div class="discount_block">-30% 7,00 €</div>');
    first.append(a.element, b.element, c.element);
    document.body.appendChild(first);
    applyIgSort([a, b, c], results);

    // A fresh page: new elements in Steam's own DOM order.
    const second = document.createElement('div');
    const a2 = makeCard(1, 'Alpha', '<div class="discount_block">-50% 5,00 €</div>');
    const b2 = makeCard(2, 'Beta', '<div class="discount_block">-20% 8,00 €</div>');
    const c2 = makeCard(3, 'Gamma', '<div class="discount_block">-30% 7,00 €</div>');
    second.append(a2.element, b2.element, c2.element);
    document.body.appendChild(second);

    applyCachedSort([a2, b2, c2]);
    expect(visualOrder(second)).toEqual(['2', '1', '3']);
    expect(Array.from(second.children).map((el) => el.getAttribute('data-index'))).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('ignores Instant Gaming results without stock', () => {
    const list = document.createElement('div');
    const a = makeCard(1, 'Alpha', '<div class="discount_block">-50% 5,00 €</div>');
    const b = makeCard(2, 'Beta', '<div class="discount_block">-20% 8,00 €</div>');
    list.append(a.element, b.element);
    document.body.appendChild(list);

    const results = new Map<number, PriceResult>([[2, matched(2, 90, false)]]);
    applyIgSort([a, b], results);

    expect(visualOrder(list)).toEqual(['1', '2']);
  });

  it('clears the visual order when sorting is turned off', () => {
    const list = document.createElement('div');
    const a = makeCard(1, 'Alpha', '<div class="discount_block">-50% 5,00 €</div>');
    const b = makeCard(2, 'Beta', '<div class="discount_block">-20% 8,00 €</div>');
    list.append(a.element, b.element);
    document.body.appendChild(list);

    applyIgSort([a, b], new Map([[1, matched(1, 10)]]));
    expect(a.element.style.order).not.toBe('');

    clearSortStyles([a, b]);
    expect(a.element.style.order).toBe('');
    expect(b.element.style.order).toBe('');
    expect(list.style.display).toBe('');
  });
});

describe('sort menu entry', () => {
  function makePopup(): HTMLDivElement {
    const popup = document.createElement('div');
    popup.setAttribute('popover', 'manual');
    popup.innerHTML = '<button>Name</button><button>Preis</button><button>Rabatt</button>';
    document.body.appendChild(popup);
    return popup;
  }

  it('finds the Steam sort popup by its option labels', () => {
    const popup = makePopup();
    expect(findSortPopup(document)).toBe(popup);
  });

  it('injects the IG option once and wires the native options', () => {
    const popup = makePopup();
    const onIg = vi.fn();
    const onNative = vi.fn();

    injectSortOption(popup, document, false, onIg, onNative);
    const option = popup.querySelector<HTMLButtonElement>('[data-igdeals-sort-option]');
    expect(option?.textContent).toBe('Rabatt inkl. IG');

    option?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onIg).toHaveBeenCalledWith(true);

    injectSortOption(popup, document, true, onIg, onNative);
    expect(popup.querySelectorAll('[data-igdeals-sort-option]')).toHaveLength(1);
    expect(option?.classList.contains('igdeals-sort-option--active')).toBe(true);
    expect(option?.getAttribute('aria-pressed')).toBe('true');

    popup.querySelector<HTMLButtonElement>('button')?.click();
    expect(onNative).toHaveBeenCalled();
  });
});

describe('sort label', () => {
  it('shows the IG choice instead of the stale native sort', () => {
    document.body.innerHTML = `
      <div>
        <button type="button">Sortieren nach: <span>Rabatt</span></button>
      </div>
    `;
    const span = document.querySelector('span') as HTMLElement;

    setSortLabel(document, true);
    expect(span.textContent).toBe('Rabatt inkl. IG');

    // Idempotent, and deactivation leaves Steam's own label alone.
    setSortLabel(document, true);
    expect(span.textContent).toBe('Rabatt inkl. IG');
    setSortLabel(document, false);
    expect(span.textContent).toBe('Rabatt inkl. IG');
  });

  it('persists the sort state', () => {
    expect(loadSortActive()).toBe(false);
    saveSortActive(true);
    expect(loadSortActive()).toBe(true);
    expect(window.localStorage.getItem(SORT_STORAGE_KEY)).toBe('1');
  });
});
