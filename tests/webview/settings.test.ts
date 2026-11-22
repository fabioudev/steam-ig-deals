// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WISHLIST_SETTINGS,
  loadWishlistSettings,
  WISHLIST_SETTINGS_KEY,
} from '../../webview/settings';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal('backend', { get_prices: vi.fn() });
});

describe('wishlist settings', () => {
  it('defaults to badges on, DE and EUR', () => {
    expect(loadWishlistSettings(new MemoryStorage())).toEqual(DEFAULT_WISHLIST_SETTINGS);
  });

  it('reads and normalises stored values', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      WISHLIST_SETTINGS_KEY,
      JSON.stringify({ badgeEnabled: false, country: 'at', currency: 'usd' }),
    );

    expect(loadWishlistSettings(storage)).toEqual({
      badgeEnabled: false,
      country: 'AT',
      currency: 'USD',
    });
  });

  it('falls back per field for invalid values and broken JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      WISHLIST_SETTINGS_KEY,
      JSON.stringify({ badgeEnabled: 'yes', country: 'DEU', currency: 42 }),
    );
    expect(loadWishlistSettings(storage)).toEqual(DEFAULT_WISHLIST_SETTINGS);

    storage.setItem(WISHLIST_SETTINGS_KEY, '{not json');
    expect(loadWishlistSettings(storage)).toEqual(DEFAULT_WISHLIST_SETTINGS);
  });

  it('survives a storage implementation that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;

    expect(loadWishlistSettings(throwing)).toEqual(DEFAULT_WISHLIST_SETTINGS);
  });
});
