import { useEffect, useMemo, useState } from 'react';
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
  TradeOrder,
  TradePosition,
  TradingOverlayLine,
} from '@trade/shared';
import { api, json, num } from '../api';
import { useUi } from '../store';
import TradingChart from '../components/TradingChart';
import CalculatorDrawer from '../components/CalculatorDrawer';
import ConfirmDialog from '../components/ConfirmDialog';
import { buildTradingOverlayLines } from '../tradeGrouping';
import { usePreferences } from '../preferences';
import { useI18n } from '../i18n';

interface MarketTicker {
  symbol: string;
  lastPrice: number;
  price24hPcnt: number;
  turnover24h: number;
}

interface InstrumentRules {
  symbol: string;
  tickSize: string;
  qtyStep: string;
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
  const { preferences } = usePreferences();
  const { t } = useI18n();
  const [tickerSearch, setTickerSearch] = useState('');
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [pendingTradingChange, setPendingTradingChange] = useState<{ line: TradingOverlayLine; price: number } | null>(null);

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
    staleTime: 8_000,
    refetchInterval: 10_000,
  });

  const instrument = useQuery<InstrumentRules>({
    queryKey: ['instrument-rules', ui.symbol],
    queryFn: () => api(`/api/market/instrument?symbol=${ui.symbol}`),
    staleTime: 10 * 60_000,
  });

  const candles = useQuery<Candle[]>({
    queryKey: ['candles', ui.symbol, ui.timeframe],
    queryFn: () =>
      api(
        `/api/market/candles?symbol=${ui.symbol}&interval=${ui.timeframe}&limit=1000`,
      ),
    staleTime: 300_000,
    refetchInterval: 300_000,
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

  const tradeOrders = useQuery<TradeOrder[]>({
    queryKey: ['chart-trade-orders'],
    queryFn: () => api('/api/trade/orders'),
    refetchInterval: 5_000,
  });

  const tradePositions = useQuery<TradePosition[]>({
    queryKey: ['chart-trade-positions'],
    queryFn: () => api('/api/trade/positions'),
    refetchInterval: 5_000,
  });

  const tradingLines = useMemo(
    () => buildTradingOverlayLines(ui.symbol, tradeOrders.data || [], tradePositions.data || []),
    [ui.symbol, tradeOrders.data, tradePositions.data],
  );

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
      // Keep Level tool active so several manual levels can be placed with
      // consecutive single clicks. Select/Escape exits drawing mode.
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
      // Keep Alert tool active. The database already supports many independent
      // alerts per symbol, so each click creates a new bell at its own price.
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

  const updateTradingLine = useMutation({
    mutationFn: async ({ line, price }: { line: TradingOverlayLine; price: number }) => {
      if (!line.editTarget) return;
      if (line.editTarget === 'position_sl' || line.editTarget === 'position_tp') {
        return api('/api/trade/position/stops', json('POST', {
          accountId: line.accountId,
          symbol: line.symbol,
          positionIdx: line.positionIdx || 0,
          ...(line.editTarget === 'position_sl' ? { stopLoss: price } : { takeProfit: price }),
        }));
      }
      const patch = line.editTarget === 'order_price'
        ? { price }
        : line.editTarget === 'order_trigger'
          ? { triggerPrice: price }
          : line.editTarget === 'order_sl'
            ? { stopLoss: price }
            : { takeProfit: price };
      return api('/api/trade/orders/amend', json('POST', {
        accountId: line.accountId, symbol: line.symbol, orderId: line.orderId, ...patch,
      }));
    },
    onSuccess: () => {
      setPendingTradingChange(null);
      window.setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ['chart-trade-orders'] });
        void qc.invalidateQueries({ queryKey: ['chart-trade-positions'] });
        void qc.invalidateQueries({ queryKey: ['orders'] });
        void qc.invalidateQueries({ queryKey: ['positions'] });
      }, 500);
    },
  });

  const requestTradingLineChange = (line: TradingOverlayLine, price: number) => {
    if (!Number.isFinite(price) || price <= 0 || !line.editTarget) return;
    if (preferences.tradingOverlays.confirmChanges) setPendingTradingChange({ line, price });
    else updateTradingLine.mutate({ line, price });
  };

  useEffect(() => {
    setLivePrice(null);
  }, [ui.symbol]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && ui.tool !== 'select') {
        ui.setTool('select');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ui]);

  const selectedTicker = useMemo(
    () => tickers.data?.find((ticker) => ticker.symbol === ui.symbol),
    [tickers.data, ui.symbol],
  );

  const currentPrice =
    livePrice || selectedTicker?.lastPrice || candles.data?.at(-1)?.close || 0;

  const levelReferencePrice =
    selectedTicker?.lastPrice || candles.data?.at(-1)?.close || currentPrice;

  const allAuto = useMemo(
    () => [
      ...(levels.data?.mirrorLevels || []),
      ...(levels.data?.limitLevels || []),
    ],
    [levels.data],
  );

  const visibleAuto = useMemo(() => {
    if (!levelReferencePrice) return allAuto;
    const tolerance = ui.levelTolerancePercent / 100;
    return allAuto.filter(
      (level) =>
        Math.abs(level.price - levelReferencePrice) / levelReferencePrice <= tolerance,
    );
  }, [allAuto, levelReferencePrice, ui.levelTolerancePercent]);

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
      {t(label)}
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
    updateTradingLine.error,
  ].find(Boolean) as Error | undefined;

  const priceChange = (selectedTicker?.price24hPcnt || 0) * 100;
  const mirrorCount = levels.data?.mirrorLevels.length || 0;
  const regularCount = levels.data?.limitLevels.length || 0;

  return (
    <div className="page chart-page">
      <div className="page-head">
        <div>
          <h1>{ui.symbol}</h1>
          <p>{t('Market scanner · bars · automatic levels · persistent drawings')}</p>
        </div>

        <div className="top-controls">
          <select
            className="select"
            value={ui.timeframe}
            onChange={(event) => ui.setTimeframe(event.target.value)}
          >
            {[
              ['1', '1m'],
              ['3', '3m'],
              ['5', '5m'],
              ['15', '15m'],
              ['30', '30m'],
              ['60', '1H'],
              ['240', '4H'],
              ['D', '1D'],
              ['W', '1W'],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>


          <button
            className="btn secondary"
            onClick={() => ui.setDrawerOpen(!ui.drawerOpen)}
          >
            <Calculator size={15} />
            {t('Calculator')}
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
            ? t('Click repeatedly to save levels · Esc to finish')
            : ui.tool === 'alert'
              ? t('Click repeatedly to create alerts · Esc to finish')
              : ui.tool === 'risk-reward'
                ? t('Click Entry → Stop · Target is created automatically')
                : null}
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
          tradingLines={tradingLines}
          liveTradingEnabled={config.data?.liveTradingEnabled ?? false}
          tool={ui.tool}
          selectedRiskReward={ui.selectedRiskReward}
          timeframe={ui.timeframe}
          tickSize={instrument.data?.tickSize ?? null}
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
          onRequestTradingLineChange={requestTradingLineChange}
          onUsePriceLevel={(price) => ui.openCalculatorAtPrice(price)}
          onLivePrice={(price) => setLivePrice(price)}
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
              <span>{t('Visible levels')} {visibleAuto.length}/{allAuto.length}</span>
            </div>
            <div className="market-meta">
              <span>{t('Mirror')} {mirrorCount}</span>
              <span>S/R {regularCount}</span>
            </div>
          </div>

          <div className="market-controls">
            <div className="range-field">
              <div className="range-head">
                <label>{t('Min 24h turnover')}</label>
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
                <label>{t('Show auto levels')}</label>
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
              placeholder={t('Search ticker…')}
            />
          </div>

          <div className="ticker-list-head">
            <span>{t('Ticker')}</span>
            <span>24h</span>
            <span>{t('Turnover')}</span>
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
                    <small>{num(ticker.symbol === ui.symbol && livePrice ? livePrice : ticker.lastPrice, 6)}</small>
                  </span>
                  <span className={change >= 0 ? 'positive' : 'negative'}>
                    {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                  </span>
                  <span className="ticker-volume">{formatTurnover(ticker.turnover24h)}</span>
                </button>
              );
            })}

            {!filteredTickers.length && (
              <div className="empty ticker-empty">{t('No tickers match this filter.')}</div>
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

      <ConfirmDialog
        open={Boolean(pendingTradingChange)}
        title={t('Modify exchange order')}
        danger
        confirmLabel={t('Send change')}
        onClose={() => setPendingTradingChange(null)}
        onConfirm={() => { if (pendingTradingChange) updateTradingLine.mutate(pendingTradingChange); }}
        body={pendingTradingChange ? <>
          <b>{pendingTradingChange.line.symbol}</b> · {pendingTradingChange.line.accountName}<br />
          {pendingTradingChange.line.kind.toUpperCase()} {num(pendingTradingChange.line.price, 8)} → <b>{num(pendingTradingChange.price, 8)}</b>
        </> : null}
      />
    </div>
  );
}
