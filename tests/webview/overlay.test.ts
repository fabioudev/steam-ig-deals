// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadgeDisplay } from '../../webview/badge-model';
import type { WishlistCard } from '../../webview/extract';
import {
  clearOverlay,
  isOverlayAttached,
  pruneOverlay,
  reattachOverlay,
  showOverlayBadge,
  showOverlaySkeleton,
} from '../../webview/overlay';

function makeCard(appid: number): WishlistCard {
  const element = document.createElement('div');
  element.className = 'Panel';
  element.setAttribute('data-index', String(appid));
  element.innerHTML =
    `<a href="https://store.steampowered.com/app/${appid}/Game/">Game</a>` +
    '<div class="discount_block"><div class="discount_final_price">2,39 €</div></div>';

  const price = element.querySelector('.discount_block') as HTMLElement;
  price.getBoundingClientRect = () => ({
    x: 100,
    y: 200,
    left: 100,
    top: 200,
    right: 300,
    bottom: 240,
    width: 200,
    height: 40,
    toJSON: () => ({}),
  });

  return { appid, name: 'Game', element, anchor: document.createElement('a') };
}

function display(): BadgeDisplay {
  return {
    tone: 'cheaper',
    priceLabel: '2,37 €',
    discountLabel: '−91 %',
    ariaLabel: 'Game: Instant Gaming price 2,37 €',
    title: 'Game: Instant Gaming price 2,37 €',
    url: 'https://www.instant-gaming.com/de/1-buy-game/',
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.getElementById('igdeals-overlay')?.remove();
  clearOverlay();
});

describe('overlay badges', () => {
  it('places a badge outside the card in a fixed overlay', () => {
    const card = makeCard(1);
    document.body.appendChild(card.element);
    const onOpen = vi.fn();

    showOverlayBadge(card, display(), document, onOpen);

    const overlay = document.getElementById('igdeals-overlay');
    expect(overlay).not.toBeNull();

    const badge = overlay?.querySelector<HTMLButtonElement>('[data-igdeals-badge]');
    expect(badge).not.toBeNull();
    expect(card.element.querySelector('[data-igdeals-badge]')).toBeNull();
    expect(badge?.style.right).toBe(`${window.innerWidth - 300}px`);
    expect(badge?.style.top).toBe('200px');
    expect(badge?.textContent).toContain('2,37');

    badge?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('positions the badge above the add-to-cart button', () => {
    const card = makeCard(1);
    const cart = document.createElement('button');
    cart.textContent = 'In den Warenkorb';
    cart.getBoundingClientRect = () => ({
      x: 100,
      y: 250,
      left: 100,
      top: 250,
      right: 400,
      bottom: 300,
      width: 300,
      height: 50,
      toJSON: () => ({}),
    });
    card.element.appendChild(cart);
    document.body.appendChild(card.element);

    showOverlayBadge(card, display(), document, vi.fn());

    const badge = document.querySelector<HTMLElement>('#igdeals-overlay [data-igdeals-badge]');
    expect(badge?.style.right).toBe(`${window.innerWidth - 400}px`);
    expect(badge?.style.top).toBe('250px');
  });

  it('replaces a skeleton with the real badge', () => {
    const card = makeCard(1);
    document.body.appendChild(card.element);

    showOverlaySkeleton(card);
    expect(document.querySelector('[data-igdeals-skeleton]')).not.toBeNull();

    showOverlayBadge(card, display(), document, vi.fn());
    expect(document.querySelector('[data-igdeals-skeleton]')).toBeNull();
    expect(document.querySelectorAll('[data-igdeals-badge]')).toHaveLength(1);
  });

  it('re-attaches the overlay with its badges after React removes it', () => {
    const card = makeCard(1);
    document.body.appendChild(card.element);

    showOverlayBadge(card, display(), document, vi.fn());
    document.getElementById('igdeals-overlay')?.remove();
    expect(isOverlayAttached()).toBe(false);

    reattachOverlay(document);

    expect(isOverlayAttached()).toBe(true);
    expect(document.querySelector('#igdeals-overlay [data-igdeals-badge]')).not.toBeNull();
  });

  it('drops badges for appids that are no longer present', () => {
    const a = makeCard(1);
    const b = makeCard(2);
    document.body.append(a.element, b.element);

    showOverlayBadge(a, display(), document, vi.fn());
    showOverlayBadge(b, display(), document, vi.fn());
    expect(document.querySelectorAll('#igdeals-overlay [data-igdeals-badge]')).toHaveLength(2);

    pruneOverlay(new Set([1]));
    expect(document.querySelectorAll('#igdeals-overlay [data-igdeals-badge]')).toHaveLength(1);
  });

  it('replaces the badge when a card element is recycled for another appid', () => {
    const card = makeCard(1);
    document.body.appendChild(card.element);
    showOverlayBadge(card, display(), document, vi.fn());

    // Simulate React reusing the same DOM node for appid 2.
    card.element.innerHTML =
      '<a href="https://store.steampowered.com/app/2/Other/"></a>' +
      '<div class="discount_block"><div class="discount_final_price">4,99 €</div></div>';
    const recycled: WishlistCard = {
      appid: 2,
      name: 'Other',
      element: card.element,
      anchor: card.element.querySelector('a') as HTMLAnchorElement,
    };
    showOverlayBadge(recycled, { ...display(), priceLabel: '4,87 €' }, document, vi.fn());

    const badges = document.querySelectorAll('#igdeals-overlay [data-igdeals-badge]');
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toContain('4,87');
  });

  it('removes the overlay on clear', () => {
    const card = makeCard(1);
    document.body.appendChild(card.element);

    showOverlayBadge(card, display(), document, vi.fn());
    clearOverlay();

    expect(document.getElementById('igdeals-overlay')).toBeNull();
  });
});
