// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadgeDisplay } from '../../webview/badge-model';
import { collectWishlistCards } from '../../webview/extract';
import {
  BADGE_STYLE_ID,
  removeCardBadge,
  removeStoreBadge,
  upsertCardBadge,
  upsertStoreBadge,
} from '../../webview/render';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/wishlist.html'), 'utf8');

function makeDisplay(overrides: Partial<BadgeDisplay> = {}): BadgeDisplay {
  const url = 'https://www.instant-gaming.com/de/1234-kaufen-elden-ring/';
  return {
    tone: 'cheaper',
    brandLabel: 'Instant Gaming',
    priceLabel: '54,73 €',
    discountLabel: '−23 %',
    taxLabel: 'inkl. 19 % MwSt.',
    ariaLabel:
      'ELDEN RING: Instant Gaming price 54,73 € (inkl. 19 % MwSt.), 23 % below the reference price; cheaper than on Steam. Opens the product page in your browser.',
    title:
      'ELDEN RING: Instant Gaming price 54,73 € (inkl. 19 % MwSt.), 23 % below the reference price; cheaper than on Steam. Opens the product page in your browser.',
    url,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal('backend', { get_prices: vi.fn() });
  document.head.innerHTML = '';
  const parsed = new DOMParser().parseFromString(fixture, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
});

describe('wishlist badge rendering', () => {
  it('renders exactly one badge per card across repeated runs', () => {
    const card = collectWishlistCards(document)[0];
    const display = makeDisplay();
    expect(card).toBeDefined();

    if (!card) return;

    upsertCardBadge(card, display, vi.fn());
    upsertCardBadge(card, display, vi.fn());
    upsertCardBadge(card, display, vi.fn());

    expect(card.element.querySelectorAll('[data-igdeals-badge]')).toHaveLength(1);
    expect(document.querySelectorAll(`#${BADGE_STYLE_ID}`)).toHaveLength(1);
  });

  it('renders price, discount, tone and accessible labels', () => {
    const card = collectWishlistCards(document)[0];
    const display = makeDisplay();
    if (!card) throw new Error('fixture setup failed');

    upsertCardBadge(card, display, vi.fn());
    const badge = card.element.querySelector<HTMLButtonElement>('[data-igdeals-badge]');

    expect(badge).not.toBeNull();
    if (!badge) return;

    expect(badge.textContent).toContain('Instant Gaming');
    expect(badge.textContent).toContain('54,73');
    expect(badge.textContent).toContain('−23 %');
    expect(badge.textContent).toContain('inkl. 19 % MwSt.');
    expect(badge.tagName).toBe('BUTTON');
    expect(badge.getAttribute('href')).toBeNull();
    expect(badge.classList.contains('igdeals-badge--cheaper')).toBe(true);
    expect(badge.tabIndex).toBe(0);
    expect(badge.getAttribute('aria-label')).toContain('Instant Gaming price');
    expect(badge.title).toContain('cheaper than on Steam');
    expect(badge.dataset.igdealsUrl).toBe(display.url);
    expect(badge.dataset.igdealsLabel).toContain('54,73');
  });

  it('anchors the badge above the Steam price element', () => {
    const card = collectWishlistCards(document)[0];
    if (!card) throw new Error('fixture setup failed');

    upsertCardBadge(card, makeDisplay(), vi.fn());

    const priceElement = card.element.querySelector<HTMLElement>('.discount_block');
    const wrapper = priceElement?.querySelector<HTMLElement>('[data-igdeals-wrap]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.classList.contains('igdeals-badge-wrap--anchored')).toBe(true);
    expect(wrapper?.querySelector('[data-igdeals-badge]')).not.toBeNull();
    expect(priceElement?.style.position).toBe('relative');
  });

  it('opens the product URL through the injected opener, not through navigation', () => {
    const card = collectWishlistCards(document)[0];
    const display = makeDisplay();
    const onOpen = vi.fn();
    if (!card) throw new Error('fixture setup failed');

    upsertCardBadge(card, display, onOpen);
    const badge = card.element.querySelector<HTMLButtonElement>('[data-igdeals-badge]');
    if (!badge) throw new Error('badge missing');

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    badge.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledWith(display.url);

    badge.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('updates in place when the tone or price changes', () => {
    const card = collectWishlistCards(document)[0];
    const cheaper = makeDisplay();
    const neutral = makeDisplay({
      tone: 'neutral',
      priceLabel: '68,00 €',
      discountLabel: null,
    });
    if (!card || !cheaper || !neutral) throw new Error('fixture setup failed');

    upsertCardBadge(card, cheaper, vi.fn());
    upsertCardBadge(card, neutral, vi.fn());

    const badges = card.element.querySelectorAll<HTMLButtonElement>('[data-igdeals-badge]');
    expect(badges).toHaveLength(1);

    const badge = badges[0];
    expect(badge?.classList.contains('igdeals-badge--neutral')).toBe(true);
    expect(badge?.classList.contains('igdeals-badge--cheaper')).toBe(false);
    expect(badge?.textContent).toContain('Instant Gaming');
  });

  it('removes the badge for hidden results', () => {
    const card = collectWishlistCards(document)[0];
    const display = makeDisplay();
    if (!card) throw new Error('fixture setup failed');

    upsertCardBadge(card, display, vi.fn());
    removeCardBadge(card);

    expect(card.element.querySelectorAll('[data-igdeals-badge]')).toHaveLength(0);
  });
});

describe('store page price line', () => {
  it('renders one block badge and updates it in place', () => {
    document.body.innerHTML = `
      <div class="apphub_AppName" id="appHubAppName">ELDEN RING</div>
      <div id="game_area_purchase"><div class="game_area_purchase_game"></div></div>
    `;
    const display = makeDisplay();

    expect(upsertStoreBadge(1245620, display, vi.fn())).toBe(true);
    expect(upsertStoreBadge(1245620, display, vi.fn())).toBe(true);

    const lines = document.querySelectorAll('#igdeals-store-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.classList.contains('igdeals-badge--block')).toBe(true);
    expect(lines[0]?.textContent).toContain('54,73');

    removeStoreBadge();
    expect(document.querySelectorAll('#igdeals-store-line')).toHaveLength(0);
  });
});
