// @vitest-environment happy-dom

import type { PriceResult } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WishlistCard } from '../../webview/extract';
import { steamDiscountPercent } from '../../webview/extract';
import {
  appendNewCards,
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
  clearSortStyles([]);
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
  const style = document.getElementById('igdeals-sort-styles')?.textContent ?? '';
  const orderOf = (el: Element): number => {
    const appid = el.getAttribute('data-igdeals-appid');
    if (!appid) return 0;
    const match = new RegExp(`\\[data-igdeals-appid="${appid}"\\]\\s*\\{\\s*order:\\s*(\\d+)`).exec(
      style,
    );
    return match ? Number(match[1]) : 0;
  };
  return Array.from(list.children)
    .sort((a, b) => orderOf(a) - orderOf(b))
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
    expect(list.hasAttribute('data-igdeals-sorted')).toBe(true);
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

  it('appends newly loaded cards without moving the placed ones', () => {
    const list = document.createElement('div');
    const a = makeCard(1, 'Alpha', '<div class="discount_block">-50% 5,00 €</div>');
    const b = makeCard(2, 'Beta', '<div class="discount_block">-20% 8,00 €</div>');
    list.append(a.element, b.element);
    document.body.appendChild(list);

    const results = new Map<number, PriceResult>([
      [1, matched(1, 10)],
      [2, matched(2, 80)],
    ]);
    applyIgSort([a, b], results);
    const attrA = a.element.getAttribute('data-igdeals-appid');
    const attrB = b.element.getAttribute('data-igdeals-appid');

    const c = makeCard(3, 'Gamma', '<div class="discount_block">-10% 9,00 €</div>');
    list.appendChild(c.element);
    const cResults = new Map<number, PriceResult>(results);
    cResults.set(3, matched(3, 95));
    appendNewCards([a, b, c], cResults);

    // The placed cards keep their rank; the later card is appended.
    expect(a.element.getAttribute('data-igdeals-appid')).toBe(attrA);
    expect(b.element.getAttribute('data-igdeals-appid')).toBe(attrB);
    expect(c.element.getAttribute('data-igdeals-appid')).toBe('3');
    expect(visualOrder(list)).toEqual(['2', '1', '3']);
  });

  it('reapplies stored ranks after React rewrites card styles', () => {
    const list = document.createElement('div');
    const a = makeCard(1, 'Alpha', '<div class="discount_block">-50% 5,00 €</div>');
    const b = makeCard(2, 'Beta', '<div class="discount_block">-20% 8,00 €</div>');
    list.append(a.element, b.element);
    document.body.appendChild(list);

    applyIgSort(
      [a, b],
      new Map<number, PriceResult>([
        [1, matched(1, 10)],
        [2, matched(2, 80)],
      ]),
    );

    // React rewrites the inline style attribute; the order lives in our
    // stylesheet and on data attributes, so it must survive.
    a.element.style.cssText = 'width:100%';
    b.element.style.cssText = 'width:100%';

    appendNewCards([a, b], new Map());
    expect(visualOrder(list)).toEqual(['2', '1']);
    expect(document.getElementById('igdeals-sort-styles')?.textContent).toContain('order:');
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
    expect(a.element.hasAttribute('data-igdeals-appid')).toBe(true);

    clearSortStyles([a, b]);
    expect(a.element.hasAttribute('data-igdeals-appid')).toBe(false);
    expect(b.element.hasAttribute('data-igdeals-appid')).toBe(false);
    expect(list.hasAttribute('data-igdeals-sorted')).toBe(false);
    expect(document.getElementById('igdeals-sort-styles')).toBeNull();
  });
});

describe('sort menu entry', () => {
  function makePopup(): HTMLDivElement {
    const popup = document.createElement('div');
    popup.setAttribute('popover', 'manual');
    popup.innerHTML = '<button>Name</button><button>Preis</button><button>Rabatt</button>';
    popup.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList;
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
