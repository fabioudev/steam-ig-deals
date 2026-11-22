// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from '../../webview/external-link';

const url = 'https://www.instant-gaming.com/de/1234-kaufen-elden-ring/';

beforeEach(() => {
  vi.stubGlobal('backend', { get_prices: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('external product links', () => {
  it('prefers SteamClient.System.OpenInSystemBrowser', () => {
    const openInSystemBrowser = vi.fn();
    vi.stubGlobal('SteamClient', { System: { OpenInSystemBrowser: openInSystemBrowser } });

    expect(openExternalUrl(url)).toBe(true);
    expect(openInSystemBrowser).toHaveBeenCalledWith(url);
  });

  it('falls back to ExecuteSteamURL with the openurl_external protocol', () => {
    const executeSteamURL = vi.fn();
    vi.stubGlobal('SteamClient', { URL: { ExecuteSteamURL: executeSteamURL } });

    expect(openExternalUrl(url)).toBe(true);
    expect(executeSteamURL).toHaveBeenCalledWith(`steam://openurl_external/${url}`);
  });

  it('refuses non-http URLs', () => {
    expect(openExternalUrl('javascript:alert(1)')).toBe(false);
    expect(openExternalUrl('file:///etc/passwd')).toBe(false);
  });
});
