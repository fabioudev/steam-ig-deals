import { describe, expect, it } from 'vitest';
import { grossPrice, vatRate } from '../../shared/vat';

describe('VAT rates', () => {
  it('knows the German standard rate', () => {
    expect(vatRate('DE')).toBe(19);
    expect(vatRate(' de ')).toBe(19);
  });

  it('returns null for unknown or malformed countries', () => {
    expect(vatRate('US')).toBeNull();
    expect(vatRate('XX')).toBeNull();
    expect(vatRate('')).toBeNull();
    expect(vatRate(null)).toBeNull();
    expect(vatRate(undefined)).toBeNull();
  });
});

describe('gross prices', () => {
  it('adds German VAT and rounds to cents', () => {
    expect(grossPrice(45.99, 'DE')).toEqual({ amount: 54.73, vatPercent: 19 });
    expect(grossPrice(1.99, 'DE')).toEqual({ amount: 2.37, vatPercent: 19 });
  });

  it('keeps the net amount when the country has no known rate', () => {
    expect(grossPrice(45.99, 'US')).toEqual({ amount: 45.99, vatPercent: null });
    expect(grossPrice(45.99)).toEqual({ amount: 45.99, vatPercent: null });
  });
});
