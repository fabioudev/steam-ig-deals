import type { PriceResult } from '@shared/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Vitest's default resolver does not read tsconfig `paths`; the app builds with
// them. Point the aliases at the real implementations so this stays an
// end-to-end test of the formatter instead of a mock.
vi.mock('@shared/display', async () => import('../../shared/display'));
vi.mock('@shared/vat', async () => import('../../shared/vat'));

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
  it('shows the gross price with VAT and a green tone against Steam', () => {
    const display = buildBadgeDisplay(matched(), 59.99, 'de-DE', 'DE');

    expect(display).not.toBeNull();
    expect(display?.tone).toBe('cheaper');
    expect(display?.priceLabel).toContain('54,73');
    expect(display?.priceLabel).toContain('€');
    expect(display?.discountLabel).toBe('−23 %');
    expect(display?.ariaLabel).toContain('Instant Gaming price');
    expect(display?.ariaLabel).not.toContain('MwSt.');
    expect(display?.ariaLabel).toContain('cheaper than on Steam');
    expect(display?.title).toBe(display?.ariaLabel);
    expect(display?.url).toBe('https://www.instant-gaming.com/de/1234-kaufen-elden-ring/');
  });

  it('falls back to the net price without a known VAT rate', () => {
    const display = buildBadgeDisplay(matched(), 59.99, 'de-DE');

    expect(display?.priceLabel).toContain('45,99');
  });

  it('compares the gross price against Steam', () => {
    expect(buildBadgeDisplay(matched(), 54.73, 'de-DE', 'DE')?.tone).toBe('neutral');
    expect(buildBadgeDisplay(matched(), 50, 'de-DE', 'DE')?.tone).toBe('neutral');
    expect(buildBadgeDisplay(matched(), 55, 'de-DE', 'DE')?.tone).toBe('cheaper');
  });

  it('stays neutral when Steam shows no comparable price', () => {
    const display = buildBadgeDisplay(matched(), null, 'de-DE', 'DE');

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
