import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Calculator,
  MousePointer2,
  Plus,
  Ratio,
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

interface MarketTicker {
  symbol: string;
  lastPrice: number;
  price24hPcnt: number;
  turnover24h: number;
}

const formatTurnover = (value: number) => {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${num(value, 0)}`;
};

export default function ChartPage() {
  const qc = useQueryClient();
  const ui = useUi();
  const [tickerSearch, setTickerSearch] = useState('');

  const config = useQuery<{
    accounts: AccountPublic[];
    liveTradingEnabled: boolean;
  }>({
    queryKey: ['config'],
    queryFn: () => api('/api/config'),
  });

  const tickers = useQuery<MarketTicker[]>({
    queryKey: ['tickers'],
    queryFn: () => api('/api/market/tickers'),
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const candles = useQuery<Candle[]>({
    queryKey: ['candles', ui.symbol, ui.timeframe],
    queryFn: () =>
      api(
        `/api/market/candles?symbol=${ui.symbol}&interval=${ui.timeframe}&limit=1000`,
      ),
    refetchInterval: 30_000,
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
    // R/R objects use absolute Unix timestamps, so the same object is visible
    // on every timeframe. The timeframe stored on the record is only the
    // timeframe on which it was originally drawn.
    queryKey: ['rr', ui.symbol],
    queryFn: () => api(`/api/drawings/risk-rewards?symbol=${ui.symbol}`),
  });

  const alerts = useQuery<AlertRecord[]>({
    queryKey: ['alerts', ui.symbol],
    queryFn: () => api(`/api/alerts?symbol=${ui.symbol}`),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['manual-levels', ui.symbol] });
    void qc.invalidateQueries({ queryKey: ['rr', ui.symbol] });
    void qc.invalidateQueries({ queryKey: ['alerts', ui.symbol] });
    void qc.invalidateQueries({ queryKey: ['alerts-all'] });
  };

  const addLevel = useMutation({
    mutationFn: (price: number) =>
      api(
        '/api/drawings/levels',
        json('POST', { symbol: ui.symbol, price, label: null }),
      ),
    onSuccess: () => {
      invalidate();
      ui.setTool('select');
    },
  });

  const delLevel = useMutation({
    mutationFn: (id: number) =>
      api(`/api/drawings/levels/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const updateLevel = useMutation({
    mutationFn: ({ id, price }: { id: number; price: number }) =>
      api<ManualLevel>(`/api/drawings/levels/${id}`, json('PATCH', { price })),
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
    onSuccess: () => {
      invalidate();
      ui.setTool('select');
    },
  });

  const delAlert = useMutation({
    mutationFn: (id: number) => api(`/api/alerts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const updateAlert = useMutation({
    mutationFn: ({ id, price }: { id: number; price: number }) =>
      api<AlertRecord>(`/api/alerts/${id}`, json('PATCH', { price })),
    onSuccess: invalidate,
  });

  const selectedTicker = useMemo(
    () => tickers.data?.find((ticker) => ticker.symbol === ui.symbol),
    [tickers.data, ui.symbol],
  );

  const currentPrice =
    selectedTicker?.lastPrice || candles.data?.at(-1)?.close || 0;

  const allAuto = useMemo(
    () => [
      ...(levels.data?.mirrorLevels || []),
      ...(levels.data?.limitLevels || []),
    ],
    [levels.data],
  );

  const visibleAuto = useMemo(() => {
    if (!currentPrice) return allAuto;
    const tolerance = ui.levelTolerancePercent / 100;
    return allAuto.filter(
      (level) => Math.abs(level.price - currentPrice) / currentPrice <= tolerance,
    );
  }, [allAuto, currentPrice, ui.levelTolerancePercent]);

  const filteredTickers = useMemo(() => {
    const query = tickerSearch.trim().toUpperCase();
    const minTurnover = ui.minTurnoverMillions * 1_000_000;
    return [...(tickers.data || [])]
      .filter((ticker) => ticker.symbol.endsWith('USDT'))
      .filter((ticker) => ticker.turnover24h >= minTurnover)
      .filter((ticker) => !query || ticker.symbol.includes(query))
      .sort((a, b) => b.turnover24h - a.turnover24h);
  }, [tickers.data, tickerSearch, ui.minTurnoverMillions]);

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
    updateLevel.error,
    addRR.error,
    updateRR.error,
    delRR.error,
    addAlert.error,
    delAlert.error,
    updateAlert.error,
  ].find(Boolean) as Error | undefined;

  const priceChange = (selectedTicker?.price24hPcnt || 0) * 100;
  const mirrorCount = levels.data?.mirrorLevels.length || 0;
  const regularCount = levels.data?.limitLevels.length || 0;

  return (
    <div className="page chart-page">
      <div className="page-head">
        <div>
          <h1>{ui.symbol}</h1>
          <p>Market scanner · bars · automatic levels · persistent drawings</p>
        </div>

        <div className="top-controls">
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

          <span className="badge">
            {currentPrice ? num(currentPrice, 8) : '...'}
          </span>

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

        <span style={{ marginLeft: 'auto' }} className="muted">
          {ui.tool === 'level'
            ? 'Click chart to save level'
            : ui.tool === 'alert'
              ? 'Click chart to create Telegram alert'
              : ui.tool === 'risk-reward'
                ? 'Click Entry → Stop → Target'
                : 'Click a level to send its price to Calculator'}
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

      <div className="chart-scanner-layout">
        <TradingChart
          symbol={ui.symbol}
          candles={candles.data || []}
          autoLevels={visibleAuto}
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
          onUpdateLevel={(id, price) => updateLevel.mutate({ id, price })}
          onUpdateAlert={(id, price) => updateAlert.mutate({ id, price })}
          onDeleteLevel={(id) => delLevel.mutate(id)}
          onDeleteAlert={(id) => delAlert.mutate(id)}
          onDeleteRiskReward={(id) => delRR.mutate(id)}
          onUsePriceLevel={(price) => ui.openCalculatorAtPrice(price)}
        />

        <aside className="market-panel card">
          <div className="market-selected">
            <div className="market-selected-head">
              <strong>{ui.symbol}</strong>
              <span className={priceChange >= 0 ? 'positive' : 'negative'}>
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
              </span>
            </div>
            <div className="market-price">{currentPrice ? num(currentPrice, 8) : '—'}</div>
            <div className="market-meta">
              <span>24h {formatTurnover(selectedTicker?.turnover24h || 0)}</span>
              <span>Visible levels {visibleAuto.length}/{allAuto.length}</span>
            </div>
            <div className="market-meta">
              <span>Mirror {mirrorCount}</span>
              <span>S/R {regularCount}</span>
            </div>
          </div>

          <div className="market-controls">
            <div className="range-field">
              <div className="range-head">
                <label>Min 24h turnover</label>
                <strong>{ui.minTurnoverMillions}M</strong>
              </div>
              <input
                type="range"
                min="0"
                max="1000"
                step="10"
                value={ui.minTurnoverMillions}
                onChange={(event) =>
                  ui.setMinTurnoverMillions(Number(event.target.value))
                }
              />
            </div>

            <div className="range-field">
              <div className="range-head">
                <label>Show auto levels</label>
                <strong>±{ui.levelTolerancePercent}%</strong>
              </div>
              <input
                type="range"
                min="0.5"
                max="100"
                step="0.5"
                value={ui.levelTolerancePercent}
                onChange={(event) =>
                  ui.setLevelTolerancePercent(Number(event.target.value))
                }
              />
            </div>

            <input
              className="input ticker-search"
              value={tickerSearch}
              onChange={(event) => setTickerSearch(event.target.value)}
              placeholder="Search ticker…"
            />
          </div>

          <div className="ticker-list-head">
            <span>Ticker</span>
            <span>24h</span>
            <span>Turnover</span>
          </div>

          <div className="ticker-list-modern">
            {filteredTickers.map((ticker) => {
              const change = ticker.price24hPcnt * 100;
              return (
                <button
                  key={ticker.symbol}
                  className={ticker.symbol === ui.symbol ? 'ticker-row active' : 'ticker-row'}
                  onClick={() => ui.setSymbol(ticker.symbol)}
                >
                  <span className="ticker-symbol">
                    <strong>{ticker.symbol.replace(/USDT$/, '')}</strong>
                    <small>{num(ticker.lastPrice, 6)}</small>
                  </span>
                  <span className={change >= 0 ? 'positive' : 'negative'}>
                    {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                  </span>
                  <span className="ticker-volume">{formatTurnover(ticker.turnover24h)}</span>
                </button>
              );
            })}

            {!filteredTickers.length && (
              <div className="empty ticker-empty">No tickers match this filter.</div>
            )}
          </div>
        </aside>
      </div>

      <CalculatorDrawer
        open={ui.drawerOpen}
        onClose={() => ui.setDrawerOpen(false)}
        accounts={config.data?.accounts || []}
        selected={ui.selectedRiskReward}
        currentPrice={currentPrice}
        preferredPriceLevel={ui.calculatorPriceLevel}
        preferredPriceLevelSeq={ui.calculatorPriceLevelSeq}
        autoLevels={visibleAuto}
        manualLevels={manual.data || []}
        symbol={ui.symbol}
        liveEnabled={config.data?.liveTradingEnabled ?? false}
        onUpdateRiskReward={(id, patch) => updateRR.mutate({ id, patch })}
      />
    </div>
  );
}
