import type { PriceResult } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Vitest's default resolver does not read tsconfig `paths`; the app builds with
// them. Point the alias at the real implementation so this stays an
// end-to-end test of the formatter instead of a mock.
vi.mock('@shared/display', async () => import('../../shared/display'));

import { buildBadgeDisplay } from '../../webview/badge-model';

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

beforeEach(() => {
  vi.stubGlobal('backend', { get_prices: vi.fn() });
});

describe('badge display', () => {
  it('formats a green badge against a higher Steam price', () => {
    const display = buildBadgeDisplay(matched(), 59.99, 'de-DE');

    expect(display).not.toBeNull();
    expect(display?.tone).toBe('cheaper');
    expect(display?.priceLabel).toContain('IG');
    expect(display?.priceLabel).toContain('45,99');
    expect(display?.priceLabel).toContain('€');
    expect(display?.discountLabel).toBe('−23 %');
    expect(display?.ariaLabel).toContain('cheaper than on Steam');
    expect(display?.title).toBe(display?.ariaLabel);
    expect(display?.url).toBe('https://www.instant-gaming.com/de/1234-kaufen-elden-ring/');
  });

  it('formats a neutral badge when Steam is equal or cheaper', () => {
    expect(buildBadgeDisplay(matched(), 45.99, 'de-DE')?.tone).toBe('neutral');
    expect(buildBadgeDisplay(matched(), 30, 'de-DE')?.tone).toBe('neutral');
  });

  it('stays neutral when Steam shows no comparable price', () => {
    const display = buildBadgeDisplay(matched(), null, 'de-DE');

    expect(display?.tone).toBe('neutral');
    expect(display?.ariaLabel).toContain('not cheaper than Steam prices');
  });

  it('hides no_match, unavailable, error and out-of-stock results', () => {
    expect(buildBadgeDisplay({ appid: 1, status: 'no_match' }, 59.99)).toBeNull();
    expect(buildBadgeDisplay({ appid: 1, status: 'unavailable' }, 59.99)).toBeNull();
    expect(buildBadgeDisplay({ appid: 1, status: 'error', error: 'timeout' }, 59.99)).toBeNull();
    expect(buildBadgeDisplay(matched({ has_stock: false }), 59.99)).toBeNull();
  });

  it('falls back to the IG discount when retail is unknown', () => {
    const display = buildBadgeDisplay(matched({ retail: null, discount: 10 }), null);

    expect(display?.discountLabel).toBe('−10 %');
    expect(
      buildBadgeDisplay(matched({ retail: null, price: 59.99, discount: 0 }), null)?.discountLabel,
    ).toBeNull();
  });

  it('uses the product currency and handles an unusual locale', () => {
    const display = buildBadgeDisplay(matched({ currency: 'USD', price: 39.5 }), 59.99, 'en-US');

    expect(display?.priceLabel).toContain('39.50');
    expect(display?.priceLabel).toContain('$');
  });
});
