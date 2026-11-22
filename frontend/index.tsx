import type { BackendStatus } from '@shared/types';
import { definePlugin } from 'millennium';
import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import { loadWishlistSettings } from '../webview/settings';

const COLORS = {
  background: '#1b2838',
  panel: '#16202d',
  panelBorder: '#2a475e',
  text: '#c7d5e0',
  muted: '#8f98a0',
  accent: '#66c0f4',
  good: '#a4d007',
  danger: '#e35d5d',
} as const;

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: 4,
    color: COLORS.text,
  },
  card: {
    background: COLORS.panel,
    border: `1px solid ${COLORS.panelBorder}`,
    borderRadius: 4,
    padding: '14px 16px',
  },
  heading: {
    margin: '0 0 10px',
    fontSize: 16,
    fontWeight: 600,
    color: '#ffffff',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    rowGap: 6,
    columnGap: 18,
    margin: 0,
    fontSize: 13,
  },
  term: {
    color: COLORS.muted,
    margin: 0,
  },
  value: {
    margin: 0,
    color: COLORS.text,
  },
  buttonRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  button: {
    padding: '7px 14px',
    borderRadius: 3,
    border: '1px solid rgba(255, 255, 255, 0.16)',
    background: 'linear-gradient(to bottom, #67c1f5 0%, #417a9b 100%)',
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  buttonDisabled: {
    opacity: 0.55,
    cursor: 'default',
  },
  note: {
    margin: '10px 0 0',
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 1.5,
  },
  error: {
    margin: '8px 0 0',
    color: COLORS.danger,
    fontSize: 13,
  },
  notice: {
    margin: '10px 0 0',
    color: COLORS.good,
    fontSize: 13,
  },
} satisfies Record<string, CSSProperties>;

function backendAvailable(): boolean {
  return typeof backend !== 'undefined' && typeof backend.get_status === 'function';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAge(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'not loaded yet';
  if (seconds < 60) return `${Math.round(seconds)} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return `${(seconds / 3600).toFixed(1)} h ago`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'unknown';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

interface StatusView {
  status: BackendStatus | null;
  error: string | null;
  loading: boolean;
}

function useBackendStatus(): StatusView & { reload: () => Promise<void> } {
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    if (!backendAvailable()) {
      setError(
        'Backend unavailable. Make sure the plugin backend is enabled and Steam was restarted.',
      );
      setLoading(false);
      return;
    }

    try {
      const next = await backend.get_status();
      setStatus(next);
      setError(null);
    } catch (cause) {
      setError(`Could not read backend status: ${errorMessage(cause)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, error, loading, reload };
}

function StatusCard({ status, error, loading }: StatusView): React.JSX.Element {
  return (
    <section style={styles.card} aria-labelledby="igdeals-status-heading">
      <h2 id="igdeals-status-heading" style={styles.heading}>
        Backend status
      </h2>

      {loading && !status ? <p style={styles.value}>Reading status…</p> : null}
      {error ? (
        <p role="alert" style={styles.error}>
          {error}
        </p>
      ) : null}

      {status ? (
        <dl style={styles.grid}>
          <dt style={styles.term}>Algolia index</dt>
          <dd style={styles.value}>{status.algolia_index ?? 'not loaded'}</dd>
          <dt style={styles.term}>Config age</dt>
          <dd style={styles.value}>{formatAge(status.config_age_seconds)}</dd>
          <dt style={styles.term}>Cached games</dt>
          <dd style={styles.value}>{status.cached_games.toLocaleString()}</dd>
          <dt style={styles.term}>Price cache TTL</dt>
          <dd style={styles.value}>{formatDuration(status.cache_ttl_seconds)}</dd>
        </dl>
      ) : null}
    </section>
  );
}

function ActionsCard({ onChanged }: { onChanged: () => Promise<void> }): React.JSX.Element {
  const [busy, setBusy] = useState<'cache' | 'config' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const run = async (action: 'cache' | 'config'): Promise<void> => {
    if (!backendAvailable()) {
      setFailed(true);
      setNotice('Backend unavailable. Restart Steam with the plugin enabled.');
      return;
    }

    setBusy(action);
    setFailed(false);
    setNotice(null);

    try {
      if (action === 'cache') {
        const response = await backend.clear_cache();
        setNotice(
          response.ok ? 'Price cache cleared.' : 'The backend did not confirm the cache clear.',
        );
        setFailed(!response.ok);
        await onChanged();
      } else {
        const response = await backend.refresh_config();
        if (response.ok) {
          setNotice(
            response.index
              ? `Algolia configuration refreshed (index: ${response.index}).`
              : 'Algolia configuration refreshed.',
          );
        } else {
          setNotice(
            `Could not refresh the Algolia configuration: ${response.error ?? 'unknown error'}`,
          );
          setFailed(true);
        }
        await onChanged();
      }
    } catch (cause) {
      setFailed(true);
      setNotice(`Backend call failed: ${errorMessage(cause)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section style={styles.card} aria-labelledby="igdeals-actions-heading">
      <h2 id="igdeals-actions-heading" style={styles.heading}>
        Maintenance
      </h2>

      <div style={styles.buttonRow}>
        <button
          type="button"
          style={{ ...styles.button, ...(busy ? styles.buttonDisabled : {}) }}
          disabled={busy !== null}
          onClick={() => void run('cache')}
        >
          {busy === 'cache' ? 'Clearing…' : 'Clear price cache'}
        </button>
        <button
          type="button"
          style={{ ...styles.button, ...(busy ? styles.buttonDisabled : {}) }}
          disabled={busy !== null}
          onClick={() => void run('config')}
        >
          {busy === 'config' ? 'Refreshing…' : 'Refresh Algolia config'}
        </button>
      </div>

      <p style={styles.note}>
        Clearing the price cache keeps the Algolia credentials. Refreshing the configuration
        re-reads them from Instant Gaming, which is useful when Instant Gaming rotates its search
        key.
      </p>

      {notice ? (
        <p role="status" style={failed ? styles.error : styles.notice}>
          {notice}
        </p>
      ) : null}
    </section>
  );
}

function WishlistSettingsCard(): React.JSX.Element {
  // Reading the same key the webview uses. Steam's settings UI and the store
  // view have separate localStorage origins, so today this normally shows the
  // defaults; that is why the card is explicitly read-only.
  const saved = loadWishlistSettings();

  return (
    <section style={styles.card} aria-labelledby="igdeals-wishlist-heading">
      <h2 id="igdeals-wishlist-heading" style={styles.heading}>
        Wishlist badges
      </h2>

      <dl style={styles.grid}>
        <dt style={styles.term}>Badges</dt>
        <dd style={styles.value}>{saved.badgeEnabled ? 'Enabled' : 'Disabled'}</dd>
        <dt style={styles.term}>Country</dt>
        <dd style={styles.value}>{saved.country}</dd>
        <dt style={styles.term}>Currency</dt>
        <dd style={styles.value}>{saved.currency}</dd>
      </dl>

      <p style={styles.note}>
        Read-only preview. The store view keeps the live badge values in its own storage, which this
        page cannot read yet, so the values above are this page&apos;s defaults. Full settings sync
        is planned for the MVP milestone.
      </p>
    </section>
  );
}

function SettingsPage(): React.JSX.Element {
  const { reload, ...statusView } = useBackendStatus();

  return (
    <div style={styles.root}>
      <StatusCard {...statusView} />
      <ActionsCard onChanged={reload} />
      <WishlistSettingsCard />
    </div>
  );
}

export default definePlugin(() => ({
  title: 'IG Deals for Steam',
  content: <SettingsPage />,
}));
