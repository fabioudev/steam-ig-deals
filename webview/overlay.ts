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
import { findPriceElement, type WishlistCard } from './extract';
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

const entries = new Map<number, OverlayEntry>();
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
  const scroller = findScrollContainer(card.element);
  if (scroller) return { kind: 'scroller', scroller };

  const pageScroller = document.scrollingElement ?? document.documentElement;
  if (pageScroller && pageScroller.scrollHeight > pageScroller.clientHeight + 1) {
    return { kind: 'window' };
  }
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
}

function computePlacement(card: WishlistCard, context: ScrollContext): Placement | null {
  if (!card.element.isConnected) return null;

  // Virtualized lists recycle DOM nodes for other games. Never place a badge
  // on an element that no longer links to this appid.
  if (!card.element.querySelector(`a[href*="/app/${card.appid}"]`)) return null;

  const target = findCartButton(card.element) ?? findPriceElement(card.element) ?? null;
  if (!target) return null;

  const rect = target.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  if (context.kind === 'scroller') {
    const scrollerRect = context.scroller.getBoundingClientRect();
    return {
      top: rect.top - scrollerRect.top + context.scroller.scrollTop,
      right: scrollerRect.right - rect.right,
      visible: true,
    };
  }

  if (context.kind === 'window') {
    const viewportWidth = document.scrollingElement?.clientWidth ?? window.innerWidth;
    return {
      top: rect.top + window.scrollY,
      right: viewportWidth - rect.right,
      visible: true,
    };
  }

  return {
    top: rect.top,
    right: window.innerWidth - rect.right,
    visible: rect.bottom > 0 && rect.top < window.innerHeight,
  };
}

function applyPlacement(element: HTMLElement, placement: Placement, context: ScrollContext): void {
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
  if (entries.has(card.appid)) return;
  dropRecycledEntries(card);

  const element = createOverlaySkeleton(doc);
  const container = ensureOverlay(card, doc);
  if (element.parentElement !== container) container.appendChild(element);
  entries.set(card.appid, { element, card });
  placeStrict(element, card, doc);
}

/** Remove entries whose card element now belongs to a different game. */
function dropRecycledEntries(card: WishlistCard): void {
  for (const [appid, entry] of entries) {
    if (appid === card.appid) continue;
    if (entry.card.element === card.element) {
      entry.element.remove();
      entries.delete(appid);
    }
  }
}

/** Create or update the badge for a card in the overlay. */
export function showOverlayBadge(
  card: WishlistCard,
  display: BadgeDisplay,
  doc: Document = document,
  onOpen: OpenUrl,
): void {
  dropRecycledEntries(card);

  const existing = entries.get(card.appid);
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
  entries.set(card.appid, { element: badge, card });
  placeStrict(badge, card, doc);
}

export function removeOverlayBadge(appid: number): void {
  const entry = entries.get(appid);
  if (!entry) return;
  entry.element.remove();
  entries.delete(appid);
}

/** Remove badges for appids that are no longer in the collected wishlist. */
export function pruneOverlay(appids: Set<number>): void {
  for (const [appid, entry] of entries) {
    if (appids.has(appid)) continue;
    entry.element.remove();
    entries.delete(appid);
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
      const first = entries.values().next().value as OverlayEntry | undefined;
      if (!first) return;
      // Scroller and window modes move with the compositor; only the fixed
      // fallback needs JavaScript updates here.
      if (resolveContext(first.card).kind === 'fixed') positionOverlay(doc);
    },
    { capture: true, passive: true },
  );

  window.addEventListener('resize', () => scheduleOverlayPosition(doc));
}
