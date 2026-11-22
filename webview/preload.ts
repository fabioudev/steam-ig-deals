/**
 * Millennium webkit entry point.
 *
 * Runs inside Steam's store browser view (Store, wishlist, community). No
 * React and no imports from the client bundle; the page is plain DOM and the
 * Lua backend is reached through the injected `backend` object.
 *
 * Lifecycle:
 *   boot -> detect page -> (wishlist) collect cards, batch prices, render
 *                       -> (app) fetch one price, render a line
 *   MutationObserver -> debounce 300 ms -> re-run (infinite scroll, React
 *   re-renders). History hooks reset state on client-side navigation.
 */

import type { GetPricesRequest, GetPricesResponse, PriceResult } from '@shared/types';
import { buildBadgeDisplay, hiddenReason } from './badge-model';
import { openExternalUrl } from './external-link';
import {
  collectWishlistCards,
  detectPage,
  extractAppPageGame,
  extractSteamPrice,
  findPriceScope,
  type WishlistCard,
} from './extract';
import {
  attachOverlayListeners,
  clearOverlay,
  hasOverlayEntries,
  isOverlayAttached,
  pruneOverlay,
  reattachOverlay,
  removeOverlayBadge,
  scheduleOverlayPosition,
  showOverlayBadge,
  showOverlaySkeleton,
} from './overlay';
import { injectStyles, removeAllBadges, removeStoreBadge, upsertStoreBadge } from './render';
import { loadWishlistSettings, type WishlistSettings } from './settings';
import {
  appendNewCards,
  applyCachedSort,
  applyIgSort,
  clearSortStyles,
  findSortPopup,
  installSortMenu,
  loadSortActive,
  saveSortActive,
  setSortLabel,
} from './sort';

const BATCH_SIZE = 100;
// Keep the DEBOUNCE short enough that React re-renders do not visibly remove
// badges, but not so short that virtualized scrolling turns into a storm.
const DEBOUNCE_MS = 30;
/** Reordering Steam's virtualized wishlist from the outside is unstable. */
const SORT_ENABLED = false;
/** Verbose console logging for development; keep off in releases. */
const DEBUG = false;

interface PricesBackend {
  get_prices(payload: GetPricesRequest): Promise<GetPricesResponse>;
}

let settings: WishlistSettings = loadWishlistSettings();
let sortActive = SORT_ENABLED && loadSortActive();
let backendWarned = false;
let generation = 0;
let lastPathKey = '';
let refreshTimer: number | null = null;
let observer: MutationObserver | null = null;
let started = false;

const results = new Map<number, PriceResult>();
const inFlight = new Set<number>();

function warnBackendOnce(message: string): void {
  if (backendWarned) return;
  backendWarned = true;
  console.warn(`[igdeals] ${message}`);
}

function getPricesBackend(): PricesBackend | null {
  if (typeof backend === 'undefined' || !backend) {
    warnBackendOnce('backend is unavailable (old Millennium build or dev mode); badges disabled');
    return null;
  }
  if (typeof backend.get_prices !== 'function') {
    warnBackendOnce('backend.get_prices is missing; badges disabled');
    return null;
  }
  return backend;
}

function getLocale(): string | undefined {
  const language = document.documentElement.lang || navigator.language;
  return language || undefined;
}

/** Apply a sort state coming from the toggle or the native sort popup. */
function applySortState(active: boolean): void {
  if (!SORT_ENABLED) return;

  sortActive = active;
  saveSortActive(active);
  setSortLabel(document, active);

  if (active) {
    applyIgSort(collectWishlistCards(document), results);
  } else {
    clearSortStyles(collectWishlistCards(document));
  }
  scheduleOverlayPosition();
  scheduleRefresh(0);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function requestPrices(cards: WishlistCard[], currentGeneration: number): Promise<void> {
  const backendClient = getPricesBackend();
  if (!backendClient) return;

  const missing = cards.filter((card) => !results.has(card.appid) && !inFlight.has(card.appid));
  if (missing.length === 0) return;

  for (const batch of chunk(missing, BATCH_SIZE)) {
    for (const card of batch) inFlight.add(card.appid);
    try {
      const response = await backendClient.get_prices({
        games: batch.map(({ appid, name }) => ({ appid, name })),
        country: settings.country,
        currency: settings.currency,
        force: false,
      });
      if (currentGeneration !== generation) return;
      for (const result of response.results) results.set(result.appid, result);
    } catch (error) {
      console.warn('[igdeals] get_prices failed', error);
      for (const card of batch) removeOverlayBadge(card.appid);
    } finally {
      for (const card of batch) inFlight.delete(card.appid);
    }
  }
}

async function refreshWishlist(currentGeneration: number): Promise<void> {
  const initialCards = collectWishlistCards(document);
  if (DEBUG) console.log(`[igdeals] wishlist cards found: ${initialCards.length}`);

  if (SORT_ENABLED) {
    installSortMenu(
      document,
      () => applySortState(true),
      () => applySortState(false),
      () => sortActive,
    );
    setSortLabel(document, sortActive);
  } else {
    // Remove order styles left behind by an earlier plugin version.
    const cards = collectWishlistCards(document);
    if (
      document.getElementById('igdeals-sort-styles') ||
      cards.some((card) => card.element.hasAttribute('data-igdeals-appid'))
    ) {
      clearSortStyles(cards);
    }
  }

  if (initialCards.length === 0) return;

  // Show placeholders immediately, before waiting for Instant Gaming.
  if (getPricesBackend()) {
    for (const card of initialCards) showOverlaySkeleton(card);
  }

  // Use the previous session's sort keys so the list does not visibly reorder
  // a second time when the prices arrive.
  if (SORT_ENABLED && sortActive) {
    applyCachedSort(collectWishlistCards(document));
  }

  await requestPrices(initialCards, currentGeneration);
  if (currentGeneration !== generation) return;

  // Re-collect: the awaited request may have spanned an infinite-scroll load.
  const locale = getLocale();
  for (const card of collectWishlistCards(document)) {
    const result = results.get(card.appid);
    if (!result) continue;

    const steamPrice = extractSteamPrice(findPriceScope(card.element), settings.currency);
    const display = buildBadgeDisplay(result, steamPrice, locale, settings.country);
    if (display && DEBUG) {
      console.debug(
        `[igdeals] ${card.name}: steam=${steamPrice} ig=${result.product?.price} tone=${display.tone}`,
      );
    }
    if (!display) {
      console.debug(
        `[igdeals] hiding badge for ${card.appid}: ${hiddenReason(result) ?? 'hidden'}`,
      );
      removeOverlayBadge(card.appid);
      continue;
    }
    showOverlayBadge(card, display, document, openExternalUrl);
  }

  const currentCards = collectWishlistCards(document);
  // Drop badges for cards that React recycled for a different game.
  pruneOverlay(new Set(currentCards.map((card) => card.appid)));

  if (SORT_ENABLED && sortActive) {
    appendNewCards(currentCards, results);
  }
  scheduleOverlayPosition();
}

function steamPriceOnAppPage(): number | null {
  // Prefer the first purchase box (usually the base game) over the whole
  // purchase section: the section can also list DLC or upgrades whose prices
  // would otherwise undercut the base game.
  const box =
    document.querySelector(
      '#game_area_purchase .game_area_purchase_game, .game_area_purchase_game',
    ) ?? document.querySelector('#game_area_purchase');
  return box ? extractSteamPrice(box, settings.currency) : null;
}

async function refreshApp(appid: number, currentGeneration: number): Promise<void> {
  if (!results.has(appid) && !inFlight.has(appid)) {
    const game = extractAppPageGame(document, appid);
    const backendClient = getPricesBackend();
    if (!game || !backendClient) return;

    inFlight.add(appid);
    try {
      const response = await backendClient.get_prices({
        games: [game],
        country: settings.country,
        currency: settings.currency,
        force: false,
      });
      if (currentGeneration !== generation) return;
      for (const result of response.results) results.set(result.appid, result);
    } catch (error) {
      console.warn('[igdeals] get_prices failed', error);
      return;
    } finally {
      inFlight.delete(appid);
    }
  }

  const result = results.get(appid);
  if (!result) return;

  const display = buildBadgeDisplay(result, steamPriceOnAppPage(), getLocale(), settings.country);
  if (!display) {
    console.debug(`[igdeals] hiding store line for ${appid}: ${hiddenReason(result) ?? 'hidden'}`);
    removeStoreBadge();
    return;
  }
  upsertStoreBadge(appid, display, openExternalUrl);
}

async function refresh(): Promise<void> {
  if (!settings.badgeEnabled) {
    clearOverlay();
    removeAllBadges();
    return;
  }

  const page = detectPage(window.location.href);
  if (page.kind === 'wishlist') {
    await refreshWishlist(generation);
  } else if (page.kind === 'app' && page.appid !== null) {
    await refreshApp(page.appid, generation);
  }
}

function scheduleRefresh(delay = DEBOUNCE_MS): void {
  if (refreshTimer !== null) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshTimer = null;
    void refresh().catch((error) => console.error('[igdeals] refresh failed', error));
  }, delay);
}

const OUR_NODE_SELECTOR =
  '[data-igdeals-badge], [data-igdeals-wrap], [data-igdeals-sort-option], #igdeals-overlay';

function isOwnMutationNode(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest?.(OUR_NODE_SELECTOR) != null;
}

function startObserver(): void {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    // React may drop the overlay when it re-renders the list/scroller.
    if (hasOverlayEntries() && !isOverlayAttached()) {
      reattachOverlay(document);
      scheduleRefresh(0);
      return;
    }

    // Ignore our own badge, skeleton, overlay and popup-option insertions.
    const relevant = mutations.filter((mutation) => {
      if (mutation.type !== 'childList') return true;
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      return nodes.length === 0 || !nodes.every(isOwnMutationNode);
    });
    if (relevant.length === 0) return;

    // Never touch the page while Steam's sort popup is open.
    if (findSortPopup(document)) return;

    // Re-apply the visual order immediately when React mounts new cards, so
    // switching sorts does not leave the list in Steam's order for a moment.
    if (SORT_ENABLED && sortActive) {
      appendNewCards(collectWishlistCards(document), results);
    }
    scheduleOverlayPosition();

    // Debounced: React mounts cards in bursts and infinite scroll appends many
    // nodes at once. Idempotent rendering makes the extra passes inexpensive.
    scheduleRefresh();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

/** Host + path identify a real page; query/hash changes (sorting, filters) do not. */
function currentPathKey(): string {
  return `${window.location.host}${window.location.pathname}`;
}

function onNavigation(): void {
  const pathKey = currentPathKey();
  if (pathKey === lastPathKey) return;

  lastPathKey = pathKey;
  generation += 1;
  results.clear();
  inFlight.clear();
  settings = loadWishlistSettings();
  sortActive = SORT_ENABLED && loadSortActive();
  clearOverlay();
  removeAllBadges();
  removeStoreBadge();
  scheduleRefresh(0);
}

function installNavigationHooks(): void {
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  history.pushState = function pushState(
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    originalPush(...args);
    onNavigation();
  };
  history.replaceState = function replaceState(
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    originalReplace(...args);
    onNavigation();
  };

  window.addEventListener('popstate', onNavigation);
  window.addEventListener('hashchange', onNavigation);
}

/**
 * Called once per webview load. Millennium loads the compiled default export
 * from the preload bundle.
 */
export default function startIgDeals(): void {
  if (started) return;
  started = true;

  if (DEBUG) console.log('[igdeals] preload attached', window.location.href);
  lastPathKey = currentPathKey();
  settings = loadWishlistSettings();
  installNavigationHooks();
  attachOverlayListeners();
  removeAllBadges();

  const boot = (): void => {
    injectStyles();
    startObserver();
    scheduleRefresh(0);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
