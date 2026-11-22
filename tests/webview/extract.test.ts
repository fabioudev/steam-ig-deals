// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectWishlistCards,
  collectWishlistGames,
  detectPage,
  detectSteamCurrency,
  extractAppIdFromHref,
  extractAppPageGame,
  extractSteamPrice,
} from '../../webview/extract';

const fixture = readFileSync(resolve(process.cwd(), 'tests/fixtures/wishlist.html'), 'utf8');

function loadFixture(): void {
  const parsed = new DOMParser().parseFromString(fixture, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

beforeEach(() => {
  vi.stubGlobal('backend', { get_prices: vi.fn() });
  document.head.innerHTML = '';
  loadFixture();
});

describe('wishlist extraction', () => {
  it('collects unique games from the grid', () => {
    const games = collectWishlistGames(document);

    expect(games.map((game) => game.appid)).toEqual([1245620, 1091500, 292030]);
    expect(games).toHaveLength(3);
  });

  it('uses stable name anchors: aria-label, title, then URL slug', () => {
    const names = new Map(collectWishlistGames(document).map((game) => [game.appid, game.name]));

    expect(names.get(1245620)).toBe('ELDEN RING');
    expect(names.get(1091500)).toBe('Cyberpunk 2077');
    expect(names.get(292030)).toBe('The Witcher 3 Wild Hunt');
  });

  it('falls back to the URL slug when no accessible name is present', () => {
    const panel = document.querySelector('div.Panel[data-index="4"]');
    panel?.querySelector('img')?.removeAttribute('alt');

    const witcher = collectWishlistGames(document).find((game) => game.appid === 292030);

    expect(witcher?.name).toBe('The Witcher 3 Wild Hunt');
  });

  it('deduplicates an app linked more than once', () => {
    const cards = collectWishlistCards(document);
    const eldenRing = cards.filter((card) => card.appid === 1245620);

    expect(eldenRing).toHaveLength(1);
    expect(document.querySelectorAll('a[href*="/app/"]')).toHaveLength(6);
  });

  it('ignores wishlist, bundle and id-less app links', () => {
    const appids = new Set(collectWishlistGames(document).map((game) => game.appid));

    expect(appids.has(1234)).toBe(false);
    expect(appids.has(0)).toBe(false);
    expect(appids.size).toBe(3);
  });

  it('parses app ids from absolute and relative hrefs', () => {
    expect(extractAppIdFromHref('https://store.steampowered.com/app/1245620/ELDEN_RING/')).toBe(
      1245620,
    );
    expect(extractAppIdFromHref('/app/1091500/Cyberpunk_2077/?snr=1')).toBe(1091500);
    expect(extractAppIdFromHref('https://store.steampowered.com/app/292030')).toBe(292030);
    expect(extractAppIdFromHref('https://store.steampowered.com/bundle/1234/Some_Bundle/')).toBe(
      null,
    );
    expect(extractAppIdFromHref('https://store.steampowered.com/app/')).toBe(null);
    expect(extractAppIdFromHref(null)).toBe(null);
  });
});

describe('page detection', () => {
  it('recognises wishlist and app pages', () => {
    expect(
      detectPage('https://store.steampowered.com/wishlist/profiles/76561198000000000/'),
    ).toEqual({ kind: 'wishlist', appid: null });
    expect(detectPage('https://store.steampowered.com/wishlist/id/123/#sort=price')).toEqual({
      kind: 'wishlist',
      appid: null,
    });
    expect(detectPage('https://store.steampowered.com/app/1245620/ELDEN_RING/')).toEqual({
      kind: 'app',
      appid: 1245620,
    });
  });

  it('ignores non-store URLs', () => {
    expect(detectPage('https://steamcommunity.com/app/1245620/')).toEqual({
      kind: 'other',
      appid: null,
    });
    expect(detectPage('not a url')).toEqual({ kind: 'other', appid: null });
  });
});

describe('Steam price extraction', () => {
  it('reads the current price and ignores the discount percentage', () => {
    const eldenRing = document.querySelector('[data-appid="1245620"]');
    const cyberpunk = document.querySelector('a[href*="/app/1091500/"]')?.closest('div.Panel');

    expect(eldenRing).not.toBeNull();
    expect(cyberpunk).not.toBeNull();
    expect(extractSteamPrice(eldenRing as Element)).toBe(59.99);
    expect(extractSteamPrice(cyberpunk as Element)).toBe(39.99);
  });

  it('prefers data-price-final in cents when present', () => {
    const card = document.createElement('div');
    card.innerHTML = '<div data-price-final="4599"></div><div>59,99 €</div>';

    expect(extractSteamPrice(card)).toBe(45.99);
  });

  it('returns zero for free games and null without a price', () => {
    const free = document.createElement('div');
    free.textContent = 'Kostenlos';
    const empty = document.createElement('div');
    empty.textContent = 'Erscheint bald';

    expect(extractSteamPrice(free)).toBe(0);
    expect(extractSteamPrice(empty)).toBe(null);
  });

  it('refuses to compare prices in a different currency', () => {
    const eldenRing = document.querySelector('[data-appid="1245620"]');
    if (!eldenRing) throw new Error('fixture missing');

    expect(detectSteamCurrency(eldenRing)).toBe('EUR');
    expect(extractSteamPrice(eldenRing, 'EUR')).toBe(59.99);
    expect(extractSteamPrice(eldenRing, 'USD')).toBe(null);
    expect(extractSteamPrice(eldenRing, 'eur')).toBe(59.99);
  });
});

describe('store app page name', () => {
  it('reads the app hub title', () => {
    document.body.innerHTML = '<div id="appHubAppName">Hades</div>';

    expect(extractAppPageGame(document, 1145360)).toEqual({ appid: 1145360, name: 'Hades' });
  });

  it('falls back to the document title without "on Steam"', () => {
    document.title = 'Hades on Steam';
    document.body.innerHTML = '';

    expect(extractAppPageGame(document, 1145360)).toEqual({ appid: 1145360, name: 'Hades' });
  });
});
