// @vitest-environment happy-dom

import type { PriceResult } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WishlistCard } from '../../webview/extract';
import { steamDiscountPercent } from '../../webview/extract';
import {
  applyIgSort,
  installSortControl,
  loadSortActive,
  restoreOriginalOrder,
  SORT_BUTTON_ID,
  SORT_STORAGE_KEY,
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

describe('IG-aware sorting', () => {
  it('sorts by the best discount across Steam and Instant Gaming', () => {
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
    expect(Array.from(list.children).map((el) => el.getAttribute('data-index'))).toEqual([
      '2',
      '1',
      '3',
    ]);

    // Idempotent: a second pass does not move anything.
    applyIgSort([a, b, c], results);
    expect(Array.from(list.children).map((el) => el.getAttribute('data-index'))).toEqual([
      '2',
      '1',
      '3',
    ]);

    restoreOriginalOrder([a, b, c]);
    expect(Array.from(list.children).map((el) => el.getAttribute('data-index'))).toEqual([
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

    expect(Array.from(list.children).map((el) => el.getAttribute('data-index'))).toEqual([
      '1',
      '2',
    ]);
  });
});

describe('sort toggle', () => {
  it("inserts next to Steam's sort button and persists the state", () => {
    document.body.innerHTML = `
      <div>
        <button type="button">Sortieren nach: <span>Rabatt</span></button>
      </div>
    `;
    const onChange = vi.fn();
    installSortControl(document, onChange);

    const toggle = document.getElementById(SORT_BUTTON_ID) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.previousElementSibling?.textContent).toContain('Sortieren nach');

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle?.classList.contains('igdeals-sort-toggle--active')).toBe(true);
    expect(loadSortActive()).toBe(true);
    expect(window.localStorage.getItem(SORT_STORAGE_KEY)).toBe('1');

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle?.classList.contains('igdeals-sort-toggle--active')).toBe(false);
    expect(loadSortActive()).toBe(false);
  });
});
