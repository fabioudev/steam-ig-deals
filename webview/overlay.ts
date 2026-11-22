/**
 * Badge overlay for the wishlist.
 *
 * React re-renders the wishlist cards and removes nodes it did not create, so
 * badges injected into a card briefly vanish. This overlay lives outside
 * React's root: one layer with badges positioned over each card's add-to-cart
 * button.
 *
 * Scrolling: when the wishlist scrolls inside a container, the overlay is
 * appended to that container in document/content coordinates, so Chromium's
 * compositor moves it together with the cards. Fixed positioning plus JS updates
 * lagged behind compositor scrolling. A fixed fallback covers layouts where
 * neither the scroller nor the window is scrollable.
 */

import type { BadgeDisplay } from './badge-model';
import { extractAppIdFromHref, findPriceElement, type WishlistCard } from './extract';
import {
  createOverlayBadge,
  createOverlaySkeleton,
  injectStyles,
  type OpenUrl,
  updateOverlayBadge,
} from './render';

interface OverlayEntry {
  element: HTMLElement;
  card: WishlistCard;
}

type ScrollContext =
  | { kind: 'scroller'; scroller: HTMLElement }
  | { kind: 'window' }
  | { kind: 'fixed' };

// Keyed by card element: the same appid can appear in search results and in the
// suggestions dropdown at the same time, and both should get a badge.
const entries = new Map<HTMLElement, OverlayEntry>();
let overlay: HTMLDivElement | null = null;
let frame: number | null = null;
let listenersAttached = false;

const CART_TEXT_RE = /in den warenkorb|add to cart|add to basket|warenkorb|cart/i;

function findCartButton(container: HTMLElement): HTMLElement | null {
  for (const button of container.querySelectorAll<HTMLElement>('button, [role="button"]')) {
    const text = (button.textContent ?? '').trim();
    if (text.length > 0 && text.length <= 40 && CART_TEXT_RE.test(text)) return button;
  }
  return null;
}

function findScrollContainer(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    if (
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function resolveContext(card: WishlistCard): ScrollContext {
  // Prefer the page scroller when the document itself scrolls. Shop pages have
  // many horizontal carousels; picking the nearest overflow container would
  // anchor badges to the wrong coordinate system.
  const pageScroller = document.scrollingElement ?? document.documentElement;
  if (pageScroller && pageScroller.scrollHeight > pageScroller.clientHeight + 1) {
    return { kind: 'window' };
  }

  const scroller = findScrollContainer(card.element);
  if (scroller) return { kind: 'scroller', scroller };

  return { kind: 'fixed' };
}

function ensureOverlay(card: WishlistCard, doc: Document): HTMLDivElement {
  const context = resolveContext(card);
  const parent = context.kind === 'scroller' ? context.scroller : doc.body;

  if (overlay?.isConnected && overlay.parentElement === parent) {
    overlay.style.position = context.kind === 'fixed' ? 'fixed' : 'absolute';
    return overlay;
  }

  overlay?.remove();
  injectStyles(doc);

  const container = doc.createElement('div');
  container.id = 'igdeals-overlay';
  container.className = 'igdeals-overlay';
  container.style.position = context.kind === 'fixed' ? 'fixed' : 'absolute';

  if (context.kind === 'scroller' && window.getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  parent.appendChild(container);
  overlay = container;

  // Re-creation must not orphan badges that were in a removed overlay.
  for (const entry of entries.values()) container.appendChild(entry.element);

  return container;
}

interface Placement {
  top: number;
  right: number;
  visible: boolean;
  /** Inside the card's top-right corner instead of above the price. */
  corner: boolean;
}

/**
 * True when the element is the topmost hit at its own center. Stacked carousel
 * slides all report the same rect; only the visually front slide passes.
 */
export function isTopmostAtCenter(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;

  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;

  if (typeof document.elementsFromPoint !== 'function') return true;

  const hits = document.elementsFromPoint(x, y);
  if (!hits || hits.length === 0) return true;

  for (const hit of hits) {
    if (hit.closest('#igdeals-overlay')) continue;

    const hitCard = hit.closest<HTMLElement>('[data-ds-appid], [data-appid], [data-index].Panel');
    if (!hitCard) return true; // Not another game card; assume visible.
    return hitCard === element || element.contains(hitCard) || hitCard.contains(element);
  }

  return true;
}

/**
 * True when an ancestor with overflow clipping hides the element, e.g. cards
 * that are off-screen inside a horizontal shop carousel.
 */
export function isElementClipped(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  let node = element.parentElement;

  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (/hidden|auto|scroll|clip/.test(`${style.overflowX} ${style.overflow}`)) {
      const clip = node.getBoundingClientRect();
      if (
        rect.right <= clip.left ||
        rect.left >= clip.right ||
        rect.bottom <= clip.top ||
        rect.top >= clip.bottom
      ) {
        return true;
      }
    }
    node = node.parentElement;
  }

  return false;
}

function computePlacement(card: WishlistCard, context: ScrollContext): Placement | null {
  if (!card.element.isConnected) return null;

  // Real app cards must still link to their appid. Package/edition cards use a
  // synthetic negative id and have no such link, so only check positive ids.
  if (card.appid > 0) {
    const ownHref = card.element.getAttribute('href');
    const linksToApp =
      (ownHref !== null && extractAppIdFromHref(ownHref) === card.appid) ||
      card.element.querySelector(`a[href*="/app/${card.appid}"]`) !== null;
    if (!linksToApp) return null;
  }

  if (isElementClipped(card.element)) {
    // Off-screen carousel slide: hide instead of painting outside the carousel.
    return { top: 0, right: 0, visible: false, corner: false };
  }

  if (!isTopmostAtCenter(card.element)) {
    // Another slide is stacked on top of this one.
    return { top: 0, right: 0, visible: false, corner: false };
  }

  const isSuggestion = card.element.matches('a.match');
  let target: HTMLElement | null = null;
  let corner = false;

  if (isSuggestion) {
    target = card.element;
    corner = true;
  } else {
    const isWishlist = window.location.pathname.startsWith('/wishlist');
    if (isWishlist) {
      target = findCartButton(card.element) ?? findPriceElement(card.element);
      if (!target) {
        target = card.element;
        corner = true;
      }
    } else {
      // Shop cards mix wildly different layouts (1x, 2x, full-width, carousels).
      // Their internal price/cart nodes are not a reliable anchor; the card's
      // top-right corner is.
      target = card.element;
      corner = true;
    }
  }

  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const offset = corner ? 6 : 0;

  if (context.kind === 'scroller') {
    const scrollerRect = context.scroller.getBoundingClientRect();
    return {
      top: rect.top - scrollerRect.top + context.scroller.scrollTop + offset,
      right: scrollerRect.right - rect.right + offset,
      visible: true,
      corner,
    };
  }

  if (context.kind === 'window') {
    const viewportWidth = document.scrollingElement?.clientWidth ?? window.innerWidth;
    return {
      top: rect.top + window.scrollY + offset,
      right: viewportWidth - rect.right + offset,
      visible: true,
      corner,
    };
  }

  return {
    top: rect.top + offset,
    right: window.innerWidth - rect.right + offset,
    visible: rect.bottom > 0 && rect.top < window.innerHeight,
    corner,
  };
}

function applyPlacement(element: HTMLElement, placement: Placement, context: ScrollContext): void {
  element.classList.toggle('igdeals-badge--corner', placement.corner);
  element.style.position = context.kind === 'fixed' ? 'fixed' : 'absolute';
  element.style.display = placement.visible ? '' : 'none';
  if (!placement.visible) return;
  element.style.top = `${Math.max(0, placement.top)}px`;
  element.style.right = `${Math.max(0, placement.right)}px`;
}

function placeStrict(element: HTMLElement, card: WishlistCard, doc: Document): void {
  ensureOverlay(card, doc);
  const context = resolveContext(card);
  const placement = computePlacement(card, context);
  if (!placement) {
    element.style.display = 'none';
    return;
  }
  applyPlacement(element, placement, context);
}

/** Add a loading placeholder for a card, if there is no entry yet. */
export function showOverlaySkeleton(card: WishlistCard, doc: Document = document): void {
  if (entries.has(card.element)) return;
  dropRecycledEntries(card);

  const element = createOverlaySkeleton(doc);
  const container = ensureOverlay(card, doc);
  if (element.parentElement !== container) container.appendChild(element);
  entries.set(card.element, { element, card });
  placeStrict(element, card, doc);
}

/** Remove an entry whose card element now belongs to a different game. */
function dropRecycledEntries(card: WishlistCard): void {
  const existing = entries.get(card.element);
  if (!existing || existing.card.appid === card.appid) return;
  existing.element.remove();
  entries.delete(card.element);
}

/** Create or update the badge for a card in the overlay. */
export function showOverlayBadge(
  card: WishlistCard,
  display: BadgeDisplay,
  doc: Document = document,
  onOpen: OpenUrl,
): void {
  dropRecycledEntries(card);

  const existing = entries.get(card.element);
  let badge: HTMLButtonElement;

  if (existing?.element.tagName === 'BUTTON') {
    badge = existing.element as HTMLButtonElement;
  } else {
    existing?.element.remove();
    badge = createOverlayBadge(doc, onOpen);
  }

  const container = ensureOverlay(card, doc);
  if (badge.parentElement !== container) container.appendChild(badge);

  updateOverlayBadge(badge, display, doc, card.appid);
  entries.set(card.element, { element: badge, card });
  placeStrict(badge, card, doc);
}

export function removeOverlayBadge(appid: number): void {
  for (const [element, entry] of entries) {
    if (entry.card.appid !== appid) continue;
    entry.element.remove();
    entries.delete(element);
  }
}

/** Remove badges for appids that are no longer in the collected wishlist. */
export function pruneOverlay(appids: Set<number>): void {
  for (const [element, entry] of entries) {
    if (appids.has(entry.card.appid)) continue;
    entry.element.remove();
    entries.delete(element);
  }
}

/** Reposition every badge; call after layout changes, sorting or resizing. */
export function positionOverlay(doc: Document = document): void {
  const first = entries.values().next().value as OverlayEntry | undefined;
  if (!first) return;

  const context = resolveContext(first.card);
  const container = ensureOverlay(first.card, doc);

  // Read all rects first, then write all styles: avoids layout thrashing.
  const updates: Array<{ element: HTMLElement; placement: Placement }> = [];
  for (const entry of entries.values()) {
    const placement = computePlacement(entry.card, context);
    if (placement) updates.push({ element: entry.element, placement });
  }

  container.style.position = context.kind === 'fixed' ? 'fixed' : 'absolute';
  for (const { element, placement } of updates) {
    applyPlacement(element, placement, context);
  }
}

/** Coalesce position updates into one animation frame. */
export function scheduleOverlayPosition(doc: Document = document): void {
  if (frame !== null) return;
  frame = window.requestAnimationFrame(() => {
    frame = null;
    positionOverlay(doc);
  });
}

/** Remove the overlay and all badges, e.g. on client-side navigation. */
export function clearOverlay(): void {
  entries.clear();
  overlay?.remove();
  overlay = null;
}

export function hasOverlayEntries(): boolean {
  return entries.size > 0;
}

export function isOverlayAttached(): boolean {
  return !!overlay?.isConnected;
}

/**
 * React may re-render the wishlist scroller and drop our overlay. Re-attach the
 * same container (with its badges) instead of rebuilding everything.
 */
export function reattachOverlay(doc: Document = document): void {
  const first = entries.values().next().value as OverlayEntry | undefined;
  if (!first) return;

  if (!overlay) {
    ensureOverlay(first.card, doc);
    positionOverlay(doc);
    return;
  }

  const context = resolveContext(first.card);
  const parent = context.kind === 'scroller' ? context.scroller : doc.body;
  if (context.kind === 'scroller' && window.getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  if (overlay.parentElement !== parent) parent.appendChild(overlay);
  overlay.style.position = context.kind === 'fixed' ? 'fixed' : 'absolute';
  positionOverlay(doc);
}

/** Keep badges aligned while scrolling or resizing. */
export function attachOverlayListeners(doc: Document = document): void {
  if (listenersAttached) return;
  listenersAttached = true;

  doc.addEventListener(
    'scroll',
    () => {
      // Absolute/scroller badges move with the compositor on vertical scroll;
      // this also keeps horizontal carousels on the shop page aligned. Fixed
      // fallback needs it as well.
      scheduleOverlayPosition(doc);
    },
    { capture: true, passive: true },
  );

  window.addEventListener('resize', () => scheduleOverlayPosition(doc));
}
