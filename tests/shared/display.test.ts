import { describe, expect, test } from 'vitest';
import { classifyPrice, formatPrice, savingsPercent } from '../../shared/display';
import type { IgProduct, PriceResult } from '../../shared/types';

function makeProduct(overrides: Partial<IgProduct> = {}): IgProduct {
  return {
    prod_id: 1,
    object_id: '1',
    name: 'Test Game',
    full_name: 'Test Game - PC (Steam)',
    platform: 'Steam',
    region: 'Europe',
    price: 45.99,
    retail: 59.99,
    discount: 23,
    currency: 'EUR',
    url: 'https://www.instant-gaming.com/en/1-buy-test-game/',
    has_stock: true,
    preorder: false,
    is_dlc: false,
    ...overrides,
  };
}

function matched(price: number, overrides: Partial<IgProduct> = {}): PriceResult {
  return { appid: 1, status: 'matched', product: makeProduct({ price, ...overrides }) };
}

/** Intl inserts narrow/non-breaking spaces in some locales. */
function normalizeSpaces(value: string): string {
  return value.replace(/ | /g, ' ');
}

describe('formatPrice', () => {
  test('formats EUR in en-US and de-DE', () => {
    expect(normalizeSpaces(formatPrice(45.99, 'EUR', 'en-US'))).toBe('€45.99');
    expect(normalizeSpaces(formatPrice(45.99, 'EUR', 'de-DE'))).toBe('45,99 €');
  });

  test('normalizes lowercase currency codes', () => {
    expect(normalizeSpaces(formatPrice(10, 'usd', 'en-US'))).toBe('$10.00');
  });

  test('falls back to a plain string for an invalid currency code', () => {
    expect(formatPrice(45.99, 'EURO', 'en-US')).toBe('45.99 EURO');
    expect(formatPrice(45.99, '', 'en-US')).toBe('45.99 ???');
  });

  test('handles non-finite amounts without throwing', () => {
    expect(formatPrice(Number.NaN, 'EUR', 'en-US')).toBe('N/A');
    expect(formatPrice(Number.POSITIVE_INFINITY, 'EUR', 'en-US')).toBe('N/A');
    expect(formatPrice(Number.NEGATIVE_INFINITY, 'EUR', 'en-US')).toBe('N/A');
  });

  test('formats zero', () => {
    expect(normalizeSpaces(formatPrice(0, 'EUR', 'en-US'))).toBe('€0.00');
  });
});

describe('savingsPercent', () => {
  test('rounds the saving against the retail price', () => {
    expect(savingsPercent(59.99, 45.99)).toBe(23);
    expect(savingsPercent(100, 75)).toBe(25);
    expect(savingsPercent(79.99, 62.59)).toBe(22);
  });

  test('returns 0 when there is no saving', () => {
    expect(savingsPercent(59.99, 59.99)).toBe(0);
    expect(savingsPercent(50, 60)).toBe(0);
    expect(savingsPercent(100, 0)).toBe(100);
  });

  test('returns 0 for missing or invalid retail prices', () => {
    expect(savingsPercent(null, 10)).toBe(0);
    expect(savingsPercent(0, 10)).toBe(0);
    expect(savingsPercent(-10, 10)).toBe(0);
    expect(savingsPercent(Number.NaN, 10)).toBe(0);
    expect(savingsPercent(Number.POSITIVE_INFINITY, 10)).toBe(0);
  });

  test('returns 0 for an invalid sale price', () => {
    expect(savingsPercent(100, Number.NaN)).toBe(0);
    expect(savingsPercent(100, Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('classifyPrice', () => {
  test('classifies cheaper, same and pricier at cent precision', () => {
    expect(classifyPrice(matched(45.99), 59.99)).toBe('cheaper');
    expect(classifyPrice(matched(59.99), 59.99)).toBe('same');
    expect(classifyPrice(matched(62.59), 59.99)).toBe('pricier');
    expect(classifyPrice(matched(59.994), 59.9941)).toBe('same');
  });

  test('returns unknown without a usable Steam price', () => {
    expect(classifyPrice(matched(45.99))).toBe('unknown');
    expect(classifyPrice(matched(45.99), null)).toBe('unknown');
    expect(classifyPrice(matched(45.99), Number.NaN)).toBe('unknown');
    expect(classifyPrice(matched(45.99), -1)).toBe('unknown');
  });

  test('returns unknown for non-matched results', () => {
    expect(classifyPrice({ appid: 1, status: 'no_match' }, 59.99)).toBe('unknown');
    expect(classifyPrice({ appid: 1, status: 'error', error: 'boom' }, 59.99)).toBe('unknown');
    expect(classifyPrice({ appid: 1, status: 'unavailable' }, 59.99)).toBe('unknown');
    expect(classifyPrice({ appid: 1, status: 'matched' }, 59.99)).toBe('unknown');
  });

  test('returns unknown for an invalid product price', () => {
    expect(classifyPrice(matched(Number.NaN), 59.99)).toBe('unknown');
    expect(classifyPrice(matched(Number.POSITIVE_INFINITY), 59.99)).toBe('unknown');
    expect(classifyPrice(matched(-1), 59.99)).toBe('unknown');
  });
});
