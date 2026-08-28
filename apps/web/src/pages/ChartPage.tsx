import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Calculator,
  MousePointer2,
  Plus,
  Ratio,
  Trash2,
} from 'lucide-react';
import type {
  AccountPublic,
  AlertRecord,
  AutoLevel,
  Candle,
  ManualLevel,
  RiskReward,
} from '@trade/shared';
import { api, json, num } from '../api';
import { useUi } from '../store';
import TradingChart from '../components/TradingChart';
import CalculatorDrawer from '../components/CalculatorDrawer';

export default function ChartPage() {
  const qc = useQueryClient();
  const ui = useUi();

  const config = useQuery<{
    accounts: AccountPublic[];
    liveTradingEnabled: boolean;
  }>({
    queryKey: ['config'],
    queryFn: () => api('/api/config'),
  });

  const tickers = useQuery<any[]>({
    queryKey: ['tickers'],
    queryFn: () => api('/api/market/tickers'),
    staleTime: 60000,
  });

  const candles = useQuery<Candle[]>({
    queryKey: ['candles', ui.symbol, ui.timeframe],
    queryFn: () =>
      api(
        `/api/market/candles?symbol=${ui.symbol}&interval=${ui.timeframe}&limit=300`,
      ),
    refetchInterval: 15000,
  });

  const levels = useQuery<{
    limitLevels: AutoLevel[];
    mirrorLevels: AutoLevel[];
  }>({
    queryKey: ['levels', ui.symbol],
    queryFn: () => api(`/api/market/levels?symbol=${ui.symbol}&interval=D`),
  });

  const manual = useQuery<ManualLevel[]>({
    queryKey: ['manual-levels', ui.symbol],
    queryFn: () => api(`/api/drawings/levels?symbol=${ui.symbol}`),
  });

  const rr = useQuery<RiskReward[]>({
    queryKey: ['rr', ui.symbol, ui.timeframe],
    queryFn: () =>
      api(
        `/api/drawings/risk-rewards?symbol=${ui.symbol}&timeframe=${ui.timeframe}`,
      ),
  });

  const alerts = useQuery<AlertRecord[]>({
    queryKey: ['alerts', ui.symbol],
    queryFn: () => api(`/api/alerts?symbol=${ui.symbol}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['manual-levels', ui.symbol] });
    void qc.invalidateQueries({ queryKey: ['rr', ui.symbol, ui.timeframe] });
    void qc.invalidateQueries({ queryKey: ['alerts', ui.symbol] });
    void qc.invalidateQueries({ queryKey: ['alerts-all'] });
  };

  const addLevel = useMutation({
    mutationFn: (price: number) =>
      api('/api/drawings/levels',
        json('POST', { symbol: ui.symbol, price, label: null }),
      ),
    onSuccess: invalidate,
  });

  const delLevel = useMutation({
    mutationFn: (id: number) =>
      api(`/api/drawings/levels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const addRR = useMutation({
    mutationFn: (input: Omit<RiskReward, 'id' | 'createdAt' | 'updatedAt'>) =>
      api<RiskReward>(
        '/api/drawings/risk-rewards',
        json('POST', { ...input, symbol: ui.symbol }),
      ),
    onSuccess: (created) => {
      invalidate();
      ui.selectRiskReward(created);
      ui.setTool('select');
    },
  });

  const updateRR = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<RiskReward> }) =>
      api<RiskReward>(`/api/drawings/risk-rewards/${id}`, json('PATCH', patch)),
    onSuccess: (updated) => {
      invalidate();
      if (ui.selectedRiskReward?.id === updated.id) {
        ui.selectRiskReward(updated);
      }
    },
  });

  const delRR = useMutation({
    mutationFn: (id: number) =>
      api(`/api/drawings/risk-rewards/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      ui.selectRiskReward(null);
      invalidate();
    },
  });

  const addAlert = useMutation({
    mutationFn: (price: number) =>
      api(
        '/api/alerts',
        json('POST', {
          symbol: ui.symbol,
          price,
          condition: 'touch',
          preAlertPercent: 0.25,
          telegramEnabled: true,
          triggerOnce: true,
        }),
      ),
    onSuccess: invalidate,
  });

  const delAlert = useMutation({
    mutationFn: (id: number) => api(`/api/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const auto = [
    ...(levels.data?.mirrorLevels || []),
    ...(levels.data?.limitLevels || []),
  ];

  const currentPrice = candles.data?.at(-1)?.close || 0;

  const tool = (name: any, Icon: any, label: string) => (
    <button
      className={ui.tool === name ? 'tool-btn active' : 'tool-btn'}
      onClick={() => ui.setTool(name)}
    >
      <Icon size={15} />
      {label}
    </button>
  );

  const mutationError = [
    addLevel.error,
    delLevel.error,
    addRR.error,
    updateRR.error,
    delRR.error,
    addAlert.error,
    delAlert.error,
  ].find(Boolean) as Error | undefined;

  const objectRowStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '110px minmax(0,1fr) auto',
    gap: 10,
    alignItems: 'center',
    padding: '8px 10px',
    borderBottom: '1px solid #18212e',
    fontSize: 11,
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{ui.symbol}</h1>
          <p>Bars · automatic levels · persistent drawings</p>
        </div>

        <div className="top-controls">
          <input
            className="input"
            list="ticker-list"
            value={ui.symbol}
            onChange={(event) => ui.setSymbol(event.target.value.toUpperCase())}
          />
          <datalist id="ticker-list">
            {tickers.data?.map((ticker) => (
              <option key={ticker.symbol} value={ticker.symbol} />
            ))}
          </datalist>

          <select
            className="select"
            value={ui.timeframe}
            onChange={(event) => ui.setTimeframe(event.target.value)}
          >
            {['1', '3', '5', '15', '30', '60', '120', '240', 'D'].map(
              (value) => (
                <option key={value} value={value}>
                  {value === 'D' ? '1D' : `${value}m`}
                </option>
              ),
            )}
          </select>

          <span className="badge">{currentPrice ? num(currentPrice, 6) : '...'}</span>

          <button
            className="btn secondary"
            onClick={() => ui.setDrawerOpen(!ui.drawerOpen)}
          >
            <Calculator size={15} />
            Calculator
          </button>
        </div>
      </div>

      <div className="toolbar">
        {tool('select', MousePointer2, 'Select')}
        {tool('level', Plus, 'Level')}
        {tool('risk-reward', Ratio, 'Risk/Reward')}
        {tool('alert', Bell, 'Alert')}

        {ui.selectedRiskReward && (
          <button
            className="tool-btn"
            onClick={() => delRR.mutate(ui.selectedRiskReward!.id)}
            title="Delete selected Risk/Reward"
          >
            <Trash2 size={15} />
            Delete selected
          </button>
        )}

        <span style={{ marginLeft: 'auto' }} className="muted">
          {ui.tool === 'level'
            ? 'Click chart to save level'
            : ui.tool === 'alert'
              ? 'Click chart to create Telegram alert'
              : ui.tool === 'risk-reward'
                ? 'Click Entry → Stop → Target'
                : 'Select a drawing'}
        </span>
      </div>

      {candles.error && (
        <div className="inline-error">{(candles.error as Error).message}</div>
      )}

      {mutationError && (
        <div className="inline-error" style={{ marginBottom: 10 }}>
          {mutationError.message}
        </div>
      )}

      <div className="chart-workspace">
        <TradingChart
          candles={candles.data || []}
          autoLevels={auto}
          manualLevels={manual.data || []}
          alerts={alerts.data || []}
          riskRewards={rr.data || []}
          tool={ui.tool}
          selectedRiskReward={ui.selectedRiskReward}
          timeframe={ui.timeframe}
          onCreateLevel={(price) => addLevel.mutate(price)}
          onCreateAlert={(price) => addAlert.mutate(price)}
          onCreateRiskReward={(input) => addRR.mutate(input)}
          onSelectRiskReward={(item) => ui.selectRiskReward(item)}
          onUpdateRiskReward={(id, patch) => updateRR.mutate({ id, patch })}
        />

        <CalculatorDrawer
          open={ui.drawerOpen}
          onClose={() => ui.setDrawerOpen(false)}
          accounts={config.data?.accounts || []}
          selected={ui.selectedRiskReward}
          currentPrice={currentPrice}
          symbol={ui.symbol}
          liveEnabled={config.data?.liveTradingEnabled ?? false}
          onUpdateRiskReward={(id, patch) => updateRR.mutate({ id, patch })}
        />
      </div>

      <div className="card" style={{ marginTop: 10, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 12px',
            borderBottom: '1px solid #1b2533',
          }}
        >
          <strong style={{ fontSize: 12 }}>Saved objects</strong>
          <span className="muted" style={{ fontSize: 10 }}>
            Levels {manual.data?.length || 0} · Alerts {alerts.data?.length || 0} · R/R{' '}
            {rr.data?.length || 0}
          </span>
        </div>

        {!manual.data?.length && !alerts.data?.length && !rr.data?.length && (
          <div className="empty">No saved objects for {ui.symbol}.</div>
        )}

        {(manual.data || []).map((level) => (
          <div style={objectRowStyle} key={`level-${level.id}`}>
            <span className="badge">Manual level</span>
            <div>
              <strong>{num(level.price, 8)}</strong>
              <div className="muted">{level.label || 'Saved level'}</div>
            </div>
            <div className="row-actions">
              <button
                className="mini-btn"
                onClick={() => addAlert.mutate(level.price)}
              >
                <Bell size={11} /> Alert
              </button>
              <button
                className="mini-btn danger"
                onClick={() => delLevel.mutate(level.id)}
              >
                <Trash2 size={11} /> Delete
              </button>
            </div>
          </div>
        ))}

        {(alerts.data || []).map((alert) => (
          <div style={objectRowStyle} key={`alert-${alert.id}`}>
            <span className={alert.active ? 'badge live' : 'badge'}>Alert</span>
            <div>
              <strong>🔔 {num(alert.price, 8)}</strong>
              <div className="muted">
                {alert.condition} · {alert.active ? 'active' : 'inactive'}
              </div>
            </div>
            <button
              className="mini-btn danger"
              onClick={() => delAlert.mutate(alert.id)}
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        ))}

        {(rr.data || []).map((item) => (
          <div
            style={{
              ...objectRowStyle,
              background:
                ui.selectedRiskReward?.id === item.id ? '#121b27' : undefined,
              cursor: 'pointer',
            }}
            key={`rr-${item.id}`}
            onClick={() => ui.selectRiskReward(item)}
          >
            <span className="badge">R/R {item.direction.toUpperCase()}</span>
            <div>
              <strong>
                {num(item.entry, 8)} → {num(item.target, 8)}
              </strong>
              <div className="muted">Stop {num(item.stop, 8)}</div>
            </div>
            <button
              className="mini-btn danger"
              onClick={(event) => {
                event.stopPropagation();
                delRR.mutate(item.id);
              }}
            >
              <Trash2 size={11} /> Delete
            </button>
          </div>
        ))}
      </div>

      <div className="inspector">
        {auto.slice(0, 8).map((level, index) => (
          <div className="inspector-chip" key={`auto-${index}`}>
            <strong>
              {level.type} · {num(level.price, 6)}
            </strong>
            {level.touches} touches · strength {num(level.strength, 2)}
            <button
              className="mini-btn"
              style={{ float: 'right' }}
              onClick={() => addAlert.mutate(level.price)}
            >
              <Bell size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
