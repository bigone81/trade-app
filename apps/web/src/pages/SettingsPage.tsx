import { useQuery } from '@tanstack/react-query';
import type { AccountPublic } from '@trade/shared';
import { api } from '../api';

export default function SettingsPage() {
  const config = useQuery<{
    accounts: AccountPublic[];
    liveTradingEnabled: boolean;
    defaultSymbol: string;
    defaultTimeframe: string;
  }>({ queryKey: ['config'], queryFn: () => api('/api/config') });

  const health = useQuery<any>({
    queryKey: ['health'],
    queryFn: () => api('/api/health'),
    refetchInterval: 10_000,
  });

  const events = useQuery<any[]>({
    queryKey: ['system-events'],
    queryFn: () => api('/api/system/events?limit=20'),
    refetchInterval: 5_000,
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Server-side configuration status. Secrets are never returned to the browser.</p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="card settings-card">
          <h3>Safety</h3>
          <div className="kv"><span>API health</span><b>{health.data?.status || '...'}</b></div>
          <div className="kv">
            <span>Trading actions</span>
            <b className={config.data?.liveTradingEnabled ? 'negative' : 'positive'}>
              {config.data?.liveTradingEnabled ? 'ENABLED' : 'LOCKED'}
            </b>
          </div>
          <div className="kv"><span>Default symbol</span><b>{config.data?.defaultSymbol || '—'}</b></div>
          <div className="kv"><span>Default timeframe</span><b>{config.data?.defaultTimeframe || '—'}</b></div>
          <p className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
            To enable write actions, set LIVE_TRADING_ENABLED=true on the server. Bybit secrets remain only in environment variables.
          </p>
        </div>

        <div className="card settings-card">
          <h3>Bybit accounts</h3>
          {config.data?.accounts.map((a) => (
            <div className="kv" key={a.id}>
              <span>{a.id}. {a.name}</span>
              <b>{a.configured ? 'configured' : 'no keys'} · {a.demo ? 'demo' : 'prod'}</b>
            </div>
          ))}
        </div>

        <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
          <h3>Recent system events</h3>
          {events.data?.map((e) => (
            <div className="kv" key={e.id}>
              <span>{e.created_at} · {e.event_type}{e.symbol ? ` · ${e.symbol}` : ''}</span>
              <b className={e.severity === 'error' ? 'negative' : e.severity === 'warning' ? 'warning-text' : ''}>
                {e.message}
              </b>
            </div>
          ))}
          {!events.data?.length && <div className="empty">No events yet.</div>}
        </div>
      </div>
    </div>
  );
}
