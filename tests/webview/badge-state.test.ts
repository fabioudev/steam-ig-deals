// @vitest-environment happy-dom

import type { PriceResult } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideTone, hiddenReason, normalizeTone } from '../../webview/badge-state';

function matched(overrides: Partial<NonNullable<PriceResult['product']>> = {}): PriceResult {
  return {
    appid: 1245620,
    status: 'matched',
    product: {
      prod_id: 42,
      object_id: 'steam-1245620',
      name: 'ELDEN RING',
      full_name: 'ELDEN RING - PC (Steam)',
      platform: 'Steam',
      region: 'DE',
      price: 45.99,
      retail: 59.99,
      discount: 23,
      currency: 'EUR',
      url: 'https://www.instant-gaming.com/de/1234-kaufen-elden-ring/',
      has_stock: true,
      preorder: false,
      is_dlc: false,
      ...overrides,
    },
  };
}

/** Mirrors the expected shared classifyPrice, independent of the real module. */
function classify(result: PriceResult, steamPrice?: number): string {
  if (result.status !== 'matched' || !result.product) return 'hidden';
  if (steamPrice === undefined) return 'neutral';
  return result.product.price < steamPrice ? 'cheaper' : 'neutral';
}

beforeEach(() => {
  vi.stubGlobal('backend', { get_prices: vi.fn() });
});

describe('badge state mapping', () => {
  it('is green when Instant Gaming is cheaper than Steam', () => {
    expect(decideTone(matched(), 59.99, classify)).toBe('cheaper');
  });

  it('is neutral when Instant Gaming matches or exceeds Steam', () => {
    expect(decideTone(matched(), 45.99, classify)).toBe('neutral');
    expect(decideTone(matched(), 30, classify)).toBe('neutral');
  });

  it('is neutral when Steam shows no comparable price', () => {
    expect(decideTone(matched(), null, classify)).toBe('neutral');
  });

  it('hides no_match, unavailable and error results', () => {
    expect(decideTone({ appid: 1, status: 'no_match' }, 59.99, classify)).toBe('hidden');
    expect(decideTone({ appid: 1, status: 'unavailable' }, 59.99, classify)).toBe('hidden');
    expect(decideTone({ appid: 1, status: 'error', error: 'timeout' }, 59.99, classify)).toBe(
      'hidden',
    );
  });

  it('hides matched products without stock', () => {
    expect(decideTone(matched({ has_stock: false }), 59.99, classify)).toBe('hidden');
  });

  it('never turns a hidden classifier answer into a badge', () => {
    expect(decideTone(matched(), 59.99, () => 'hidden')).toBe('hidden');
    expect(decideTone(matched(), 59.99, () => ({ visible: false, tone: 'cheaper' }))).toBe(
      'hidden',
    );
  });
});

describe('tone normalisation', () => {
  it('accepts the string, boolean and object shapes a shared helper may use', () => {
    expect(normalizeTone('cheaper')).toBe('cheaper');
    expect(normalizeTone('DISCOUNT')).toBe('cheaper');
    expect(normalizeTone('good')).toBe('cheaper');
    expect(normalizeTone('hidden')).toBe('hidden');
    expect(normalizeTone('no_match')).toBe('hidden');
    expect(normalizeTone('neutral')).toBe('neutral');
    expect(normalizeTone(true)).toBe('cheaper');
    expect(normalizeTone(false)).toBe('hidden');
    expect(normalizeTone({ tone: 'cheaper' })).toBe('cheaper');
    expect(normalizeTone({ kind: 'hidden' })).toBe('hidden');
    expect(normalizeTone({ visible: false })).toBe('hidden');
    expect(normalizeTone(undefined)).toBe('neutral');
  });
});

describe('hidden reasons', () => {
  it('names the reason used by the console.debug log', () => {
    expect(hiddenReason({ appid: 1, status: 'no_match' })).toBe('no_match');
    expect(hiddenReason({ appid: 1, status: 'error', error: 'timeout' })).toBe('error: timeout');
    expect(hiddenReason(matched({ has_stock: false }))).toBe('matched without stock');
    expect(hiddenReason(matched())).toBeNull();
  });
});
