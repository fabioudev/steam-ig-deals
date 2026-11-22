/**
 * Opening an Instant Gaming product in the system browser.
 *
 * Steam's embedded CEF must never navigate to instant-gaming.com (the page is
 * heavy and the store view would lose the user's wishlist). There is no single
 * documented API that is guaranteed to exist inside a Millennium webkit
 * preload, so we try a short, documented chain:
 *
 * 1. `SteamClient.System.OpenInSystemBrowser(url)` — the call Millennium's own
 *    frontend uses (src/typescript/frontend/utils/index.tsx). It belongs to the
 *    shared Steam client JS context and is *not* guaranteed to be exposed in a
 *    webview.
 * 2. `SteamClient.URL.ExecuteSteamURL('steam://openurl_external/<url>')` — the
 *    SDK method for executing `steam:` URLs (SDK `steam-client/URL.ts`).
 * 3. Clicking a temporary anchor whose href is `steam://openurl_external/<url>`.
 *    This is exactly what Valve's own `Steam.LinkInNewWindow` in the store's
 *    `shared_global.js` does for external links inside the client.
 * 4. Assigning `window.location.href` to the same `steam:` URL, the fallback
 *    used by Steam userscripts (e.g. GG.deals Steam Companion). The CEF hands
 *    the custom scheme to the OS and does not load Instant Gaming itself.
 * 5. `window.open(url)` as a last resort. It may open Steam's internal browser
 *    instead of the system one, but it is better than a badge that does
 *    nothing; we report whether a window was created.
 *
 * The uncertainty is deliberate: if a future Millennium exposes a documented
 * webview-specific opener, put it first and delete the rest.
 */

const EXTERNAL_URL_PREFIX = 'steam://openurl_external/';

interface SteamClientLike {
  System?: { OpenInSystemBrowser?: (url: string) => void };
  URL?: { ExecuteSteamURL?: (url: string) => void };
}

type WindowWithSteam = Window & { SteamClient?: SteamClientLike };

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Ask Steam to open `url` in the operating system's default browser.
 * Returns true when a mechanism was found; false when every option failed.
 */
export function openExternalUrl(url: string, win: Window = window): boolean {
  if (!isHttpUrl(url)) return false;

  const protocolUrl = `${EXTERNAL_URL_PREFIX}${url}`;
  const steamWindow = win as WindowWithSteam;

  // 1. Shared Steam client API, when this context exposes it.
  try {
    const openInSystemBrowser = steamWindow.SteamClient?.System?.OpenInSystemBrowser;
    if (typeof openInSystemBrowser === 'function') {
      openInSystemBrowser.call(steamWindow.SteamClient?.System, url);
      return true;
    }
  } catch (error) {
    console.debug('[igdeals] OpenInSystemBrowser failed, trying steam: URL', error);
  }

  // 2. SDK URL executor.
  try {
    const executeSteamUrl = steamWindow.SteamClient?.URL?.ExecuteSteamURL;
    if (typeof executeSteamUrl === 'function') {
      executeSteamUrl.call(steamWindow.SteamClient?.URL, protocolUrl);
      return true;
    }
  } catch (error) {
    console.debug('[igdeals] ExecuteSteamURL failed, trying anchor', error);
  }

  // 3. Anchor click. This mirrors Steam's own external-link handling.
  try {
    const body = win.document.body;
    if (body) {
      const anchor = win.document.createElement('a');
      anchor.href = protocolUrl;
      anchor.style.display = 'none';
      anchor.setAttribute('aria-hidden', 'true');
      body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    }
  } catch (error) {
    console.debug('[igdeals] steam: anchor click failed, assigning location', error);
  }

  // 4. Direct location assignment.
  try {
    win.location.href = protocolUrl;
    return true;
  } catch (error) {
    console.debug('[igdeals] steam: location assignment failed', error);
  }

  // 5. Last resort; may stay inside Steam's CEF.
  try {
    const opened = win.open(url, '_blank', 'noopener,noreferrer');
    return opened !== null;
  } catch (error) {
    console.warn('[igdeals] could not open product URL', error);
    return false;
  }
}
