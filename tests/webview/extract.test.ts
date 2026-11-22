// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collectAppPageExtras,
  collectSearchCards,
  collectStoreCards,
  collectSuggestionCards,
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

  it('recognises the shop home and search pages', () => {
    expect(detectPage('https://store.steampowered.com/')).toEqual({ kind: 'store', appid: null });
    expect(detectPage('https://store.steampowered.com/search/?term=elden')).toEqual({
      kind: 'search',
      appid: null,
    });
  });
});

describe('shop and search extraction', () => {
  it('collects search result rows', () => {
    document.body.innerHTML = `
      <a class="search_result_row" data-ds-appid="1245620" href="https://store.steampowered.com/app/1245620/ELDEN_RING/">
        <span class="title">ELDEN RING</span>
        <div class="discount_block"><div class="discount_final_price">59,99€</div></div>
      </a>
    `;

    const cards = collectSearchCards(document);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.appid).toBe(1245620);
    expect(cards[0]?.name).toBe('ELDEN RING');
  });

  it('collects store cards from data-ds-appid', () => {
    document.body.innerHTML = `
      <a class="tab_row_item" data-ds-appid="5196330" href="https://store.steampowered.com/app/5196330/IT_THINKS/">
        <img alt="IT THINKS! - Build Your Own GPU">
        <div class="tab_item_title">IT THINKS! - Build Your Own GPU</div>
        <div class="tab_item_price"><div class="discount_block">-20% 15,99€</div></div>
      </a>
    `;

    const cards = collectStoreCards(document);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.appid).toBe(5196330);
    expect(cards[0]?.name).toBe('IT THINKS! - Build Your Own GPU');
  });

  it('collects search suggestion rows', () => {
    document.body.innerHTML = `
      <a class="match match_app" data-ds-appid="1245620" href="https://store.steampowered.com/app/1245620/ELDEN_RING">
        <div class="match_name">ELDEN RING</div>
        <div class="match_subtitle">59,99€</div>
      </a>
    `;

    const cards = collectSuggestionCards(document);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.appid).toBe(1245620);
    expect(cards[0]?.name).toBe('ELDEN RING');
  });

  it('collects DLC rows and purchase editions on an app page', () => {
    document.body.innerHTML = `
      <div id="appHubAppName">ELDEN RING</div>
      <a class="game_area_dlc_row" data-ds-appid="3655690" href="https://store.steampowered.com/app/3655690/Tarnished_Pack/">
        <div class="game_area_dlc_name">ELDEN RING Tarnished Pack</div>
      </a>
      <div class="game_area_purchase_game" id="game_area_purchase_section_add_to_cart_440408">
        <input type="hidden" name="subid" value="440408" />
        <h2 class="title">Buy ELDEN RING</h2>
      </div>
      <div class="game_area_purchase_game" id="game_area_purchase_section_add_to_cart_1010505">
        <input type="hidden" name="subid" value="1010505" />
        <h2 class="title">Buy ELDEN RING Shadow of the Erdtree Edition</h2>
      </div>
    `;

    const cards = collectAppPageExtras(document, 1245620);
    expect(cards.map((card) => card.name)).toEqual([
      'ELDEN RING Tarnished Pack',
      'ELDEN RING Shadow of the Erdtree Edition',
    ]);
    expect(cards[0]?.appid).toBe(3655690);
    expect(cards[1]?.appid).toBe(-1001010505);
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
