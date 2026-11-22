import type { BackendStatus, GetPricesRequest, GetPricesResponse } from '@shared/types';
import type { ReactNode } from 'react';

declare module 'millennium' {
  export interface PluginSettings {
    title: string;
    icon?: ReactNode;
    content: ReactNode;
  }

  /**
   * Registers the plugin's settings page in Millennium.
   * The factory runs once when Steam's UI is ready.
   */
  export function definePlugin(factory: () => PluginSettings): unknown;
}

interface MillenniumBackend {
  /** Resolve Instant Gaming prices for a batch of Steam games. */
  get_prices(payload: GetPricesRequest): Promise<GetPricesResponse>;
  /** Drop the price cache (keeps the Algolia config cache). */
  clear_cache(): Promise<{ ok: boolean }>;
  /** Backend health and cache diagnostics. */
  get_status(): Promise<BackendStatus>;
  /** Re-read the Algolia configuration from Instant Gaming. */
  refresh_config(): Promise<{ ok: boolean; index?: string; error?: string }>;
}

declare global {
  /**
   * RPC proxy to the Lua backend, injected by Millennium into the frontend and
   * the webview preload script.
   */
  const backend: MillenniumBackend;
}
