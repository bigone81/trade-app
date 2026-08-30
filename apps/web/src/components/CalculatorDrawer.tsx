import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { calculateRiskReward, calculateTrade } from '@trade/domain';
import type { AccountPublic, AutoLevel, ManualLevel, RiskReward } from '@trade/shared';
import { api, json, money, num } from '../api';
import { effectiveRiskPercent, usePreferences } from '../preferences';
import ConfirmDialog from './ConfirmDialog';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  accounts: AccountPublic[];
  selected: RiskReward | null;
  currentPrice: number;
  preferredPriceLevel: number | null;
  preferredPriceLevelSeq: number;
  autoLevels: AutoLevel[];
  manualLevels: ManualLevel[];
  symbol: string;
  liveEnabled: boolean;
  onUpdateRiskReward: (id: number, patch: Partial<RiskReward>) => void;
}

export default function CalculatorDrawer({
  open,
  onClose,
  accounts,
  selected,
  currentPrice,
  preferredPriceLevel,
  preferredPriceLevelSeq,
  autoLevels,
  manualLevels,
  symbol,
  liveEnabled,
  onUpdateRiskReward,
}: Props) {
  const { preferences } = usePreferences();
  const { t, language } = useI18n();
  const [accountId, setAccountId] = useState(() => preferences.defaultAccountId || accounts[0]?.id || 0);
  const [risk, setRisk] = useState(() => effectiveRiskPercent(preferences, preferences.defaultAccountId || accounts[0]?.id || 0));
  type OrderMode = 'auto' | 'limit' | 'stop_market' | 'stop_limit' | 'market';
  const [mode, setMode] = useState<OrderMode>('auto');
  const [stopMode, setStopMode] = useState<'atr' | 'technical'>('technical');
  const [side, setSide] = useState<'Buy' | 'Sell'>('Buy');
  const [entry, setEntry] = useState(currentPrice);
  const [stop, setStop] = useState(currentPrice * 0.99);
  const [target, setTarget] = useState(currentPrice * 1.02);
  const [trigger, setTrigger] = useState(currentPrice);
  const [priceLevel, setPriceLevel] = useState(currentPrice);
  const [triggerAtr, setTriggerAtr] = useState(0.5);
  const [slipAtr, setSlipAtr] = useState(0.5);
  const [stopAtr, setStopAtr] = useState(10);
  const [technicalStop, setTechnicalStop] = useState(currentPrice * 0.99);
  const [legacyRr, setLegacyRr] = useState(3);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState('');
  const initializedSymbolRef = useRef('');
  const lastDefaultAccountRef = useRef(accountId);

  useEffect(() => {
    if (!accounts.some((a) => a.id === accountId) && accounts.length) {
      setAccountId(accounts[0]!.id);
    }
  }, [accounts, accountId]);

  useEffect(() => {
    if (lastDefaultAccountRef.current !== accountId) {
      lastDefaultAccountRef.current = accountId;
      setRisk(effectiveRiskPercent(preferences, accountId));
    }
  }, [accountId, preferences]);

  const applyPriceLevel = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    setPriceLevel(value);
    setEntry(value);
    setTrigger(value);
  };

  useEffect(() => {
    if (!open) return;
    if (selected) {
      initializedSymbolRef.current = symbol;
      setEntry(selected.entry);
      setStop(selected.stop);
      setTarget(selected.target);
      setTrigger(selected.entry);
      setSide(selected.direction === 'long' ? 'Buy' : 'Sell');
      return;
    }

    if (
      preferredPriceLevel !== null &&
      Number.isFinite(preferredPriceLevel) &&
      preferredPriceLevel > 0
    ) {
      initializedSymbolRef.current = symbol;
      applyPriceLevel(preferredPriceLevel);
      return;
    }

    if (currentPrice && initializedSymbolRef.current !== symbol) {
      initializedSymbolRef.current = symbol;
      setEntry(currentPrice);
      setPriceLevel(currentPrice);
      setTrigger(currentPrice);
      setTechnicalStop(currentPrice * 0.99);
    }
  }, [open, selected?.id, selected?.entry, selected?.stop, selected?.target, preferredPriceLevel, preferredPriceLevelSeq, currentPrice, symbol]);

  const summary = useQuery<any[]>({
    queryKey: ['summary', accountId],
    queryFn: () => api(`/api/trade/summary?accountId=${accountId}`),
    enabled: accountId > 0,
    refetchInterval: 15_000,
  });
  const balance = Number(summary.data?.[0]?.equity || 0);

  const atrQuery = useQuery<{ atr: number }>({
    queryKey: ['atr', symbol],
    queryFn: () => api(`/api/market/atr?symbol=${symbol}&interval=D&period=14`),
    enabled: Boolean(symbol),
  });
  const atr = atrQuery.data?.atr || 0;

  const autoDecisionPrice = selected
    ? entry
    : priceLevel + (side === 'Buy' ? 1 : -1) * atr * slipAtr * 0.01;
  const autoExecutionMode = useMemo<'limit' | 'stop_market' | 'market'>(() => {
    if (!Number.isFinite(autoDecisionPrice) || autoDecisionPrice <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) return 'limit';
    const epsilon = Math.max(Math.abs(currentPrice) * 1e-10, 1e-12);
    if (Math.abs(autoDecisionPrice - currentPrice) <= epsilon) return 'market';
    if (side === 'Buy') return autoDecisionPrice > currentPrice ? 'stop_market' : 'limit';
    return autoDecisionPrice < currentPrice ? 'stop_market' : 'limit';
  }, [autoDecisionPrice, currentPrice, side]);
  const executionMode: Exclude<OrderMode, 'auto'> = mode === 'auto' ? autoExecutionMode : mode;
  const strategyMode: 'stop' | 'limit' | 'market' = executionMode === 'market' ? 'market' : executionMode === 'limit' ? 'limit' : 'stop';
  const isStopExecution = executionMode === 'stop_market' || executionMode === 'stop_limit';
  const usesLimitPrice = executionMode === 'limit' || executionMode === 'stop_limit';
  const manualCrossesMarket = mode === 'limit' && autoExecutionMode === 'stop_market';
  const manualStopWrongSide = (mode === 'stop_market' || mode === 'stop_limit') && autoExecutionMode === 'limit';
  const executionModeLabel = executionMode === 'stop_market' ? t('Stop Market') : executionMode === 'stop_limit' ? t('Stop Limit') : executionMode === 'market' ? t('Market') : t('Limit');

  const calculatorLevels = useMemo(() => {
    const rows = [
      ...manualLevels.map((level) => ({
        key: `manual-${level.id}`,
        price: level.price,
        label: level.label || t('Manual'),
        kind: 'manual' as const,
        touches: 0,
      })),
      ...autoLevels.map((level, index) => ({
        key: `auto-${level.type}-${level.price}-${index}`,
        price: level.price,
        label: level.type === 'mirror' ? t('Mirror') : level.type === 'support' ? t('Support') : t('Resistance'),
        kind: 'auto' as const,
        touches: level.touches,
      })),
    ];

    const anchor = currentPrice || priceLevel || 0;
    return rows
      .sort((a, b) => {
        if (!anchor) return a.price - b.price;
        return Math.abs(a.price - anchor) - Math.abs(b.price - anchor);
      })
      .slice(0, 24);
  }, [manualLevels, autoLevels, currentPrice, priceLevel, t]);

  const legacy = useMemo(() => calculateTrade({
    mode: strategyMode,
    stopMode,
    side,
    balance,
    riskPercent: risk,
    atr,
    priceLevel: priceLevel || currentPrice,
    currentPrice,
    triggerAtrPercent: triggerAtr,
    slipAtrPercent: executionMode === 'market' ? 0 : slipAtr,
    stopAtrPercent: stopAtr,
    technicalStop,
    rr: legacyRr,
  }), [strategyMode, executionMode, stopMode, side, balance, risk, atr, priceLevel, currentPrice, triggerAtr, slipAtr, stopAtr, technicalStop, legacyRr]);

  const drawingRr = calculateRiskReward(entry, stop, target);
  const values = selected ? {
    entry,
    stop,
    target,
    trigger: isStopExecution ? (mode === 'auto' ? entry : trigger) : 0,
    rr: drawingRr.ratio,
    riskAmount: balance * risk / 100,
    positionSize: drawingRr.risk > 0 ? (balance * risk / 100) / drawingRr.risk : 0,
  } : {
    entry: legacy.entry,
    stop: legacy.stop,
    target: legacy.target,
    trigger: legacy.triggerPoint,
    rr: legacy.rr,
    riskAmount: legacy.riskAmount,
    positionSize: legacy.positionSize,
  };
  const notional = values.positionSize * values.entry;
  const legacyPointTypeLabel = (() => {
    const technical = t('Technical SL');
    const labels: Record<number, string> = {
      10: 'Stop Limit · ATR SL',
      11: `Stop Limit · ${technical}`,
      20: 'Limit · ATR SL',
      21: `Limit · ${technical}`,
      30: 'Market · ATR SL',
      31: `Market · ${technical}`,
    };
    return labels[legacy.pointType] || `pointType ${legacy.pointType}`;
  })();
  const validGeometry = side === 'Buy'
    ? values.stop < values.entry && values.target > values.entry
    : values.stop > values.entry && values.target < values.entry;

  const place = useMutation({
    mutationFn: () => api('/api/trade/order', json('POST', {
      accountId,
      symbol,
      side,
      orderType: executionMode === 'market' || executionMode === 'stop_market' ? 'Market' : 'Limit',
      executionMode,
      autoMode: mode === 'auto',
      autoReferencePrice: Number(autoDecisionPrice) || undefined,
      qty: values.positionSize,
      price: usesLimitPrice ? values.entry : undefined,
      triggerPrice: isStopExecution ? values.trigger : undefined,
      stopLoss: values.stop,
      takeProfit: values.target,
      pointType: selected ? undefined : legacy.pointType,
      priceLevel: priceLevel || undefined,
      plannedRr: Number(values.rr),
      riskPercent: risk,
      riskAmount: Number(values.riskAmount),
      plannedEntry: Number(values.entry),
    })),
    onSuccess: () => { setConfirmOpen(false); setError(''); },
    onError: (e: Error) => { setConfirmOpen(false); setError(e.message); },
  });

  const changeDrawing = (kind: 'entry' | 'stop' | 'target', value: number) => {
    if (kind === 'entry') {
      setEntry(value);
      if (selected && mode === 'auto') setTrigger(value);
    }
    if (kind === 'stop') setStop(value);
    if (kind === 'target') setTarget(value);
    if (selected) {
      const nextEntry = kind === 'entry' ? value : entry;
      const nextStop = kind === 'stop' ? value : stop;
      onUpdateRiskReward(selected.id, {
        [kind]: value,
        direction: nextStop < nextEntry ? 'long' : 'short',
      } as Partial<RiskReward>);
    }
  };

  return (
    <aside className={open ? 'drawer calculator-drawer' : 'drawer calculator-drawer closed'}>
      <div className="drawer-head">
        <div>
          <h2>{t('Trade calculator')}</h2>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {selected ? `Risk/Reward #${selected.id}` : t('Legacy calculator')} · {symbol}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose}><X size={16} /></button>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {!liveEnabled && <div className="inline-error" style={{ background: '#2d2717', borderColor: '#5a4a21', color: '#e6c875' }}>
        {t('Trading actions are locked by LIVE_TRADING_ENABLED=false.')}
      </div>}
      {!validGeometry && <div className="inline-error">{t('Invalid SL/TP geometry for {side}. Check Entry, Stop and Target.',{side:t(side)})}</div>}

      <div className="field">
        <label>{t('Account')}</label>
        <select className="select" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.demo ? ' · demo' : ''}{!a.configured ? ` · ${t('not configured')}` : ''}</option>)}
        </select>
      </div>

      <div className="field-grid">
        <div className="field"><label>{t('Side')}</label><select className="select" value={side} onChange={(e) => setSide(e.target.value as any)}><option value="Buy">{t('Buy')}</option><option value="Sell">{t('Sell')}</option></select></div>
        <div className="field"><label>{t('Order')}</label><select className="select" value={mode} onChange={(e) => setMode(e.target.value as OrderMode)}><option value="auto">{t('Auto (recommended)')}</option><option value="limit">{t('Limit')}</option><option value="stop_market">{t('Stop Market')}</option><option value="stop_limit">{t('Stop Limit')}</option><option value="market">{t('Market')}</option></select></div>
      </div>

      {mode === 'auto' && (
        <div className="muted" style={{ fontSize: 11, margin: '-2px 0 10px' }}>
          {t('Auto selected: {type}', { type: executionModeLabel })} · {t('Automatic mode chooses Limit for pullbacks and Stop Market for breakouts.')}
        </div>
      )}
      {manualCrossesMarket && (
        <div className="inline-error" style={{ background: '#2d2717', borderColor: '#5a4a21', color: '#e6c875' }}>
          {t('This Limit crosses the current market and may execute immediately. Auto would use {type}.', { type: t('Stop Market') })}
        </div>
      )}
      {manualStopWrongSide && (
        <div className="inline-error" style={{ background: '#2d2717', borderColor: '#5a4a21', color: '#e6c875' }}>
          {t('This Stop is already on the triggered side of the market. Auto would use {type}.', { type: t('Limit') })}
        </div>
      )}

      {selected ? (
        <div className="drawer-section">
          {isStopExecution && mode !== 'auto' && <div className="field"><label>{t('Trigger')}</label><input className="input" type="number" step="any" value={trigger || ''} onChange={(e) => setTrigger(Number(e.target.value))} /></div>}
          <div className="field"><label>{t('Entry')}</label><input className="input" type="number" step="any" value={entry || ''} onChange={(e) => changeDrawing('entry', Number(e.target.value))} /></div>
          <div className="field-grid">
            <div className="field"><label>{t('Stop Loss')}</label><input className="input" type="number" step="any" value={stop || ''} onChange={(e) => changeDrawing('stop', Number(e.target.value))} /></div>
            <div className="field"><label>{t('Take Profit')}</label><input className="input" type="number" step="any" value={target || ''} onChange={(e) => changeDrawing('target', Number(e.target.value))} /></div>
          </div>
        </div>
      ) : (
        <div className="drawer-section">
          <div className="field"><label>{t('Stop model')}</label><select className="select" value={stopMode} onChange={(e) => setStopMode(e.target.value as any)}><option value="atr">{t('ATR calculated')}</option><option value="technical">{t('Technical stop')}</option></select></div>
          <div className="field">
            <label>{t('Price level')}</label>
            <input className="input" type="number" step="any" value={priceLevel || ''} onChange={(e) => applyPriceLevel(Number(e.target.value))} />
            {executionMode === 'market' && <small className="muted">{t('Market calculations use the current market price; the selected level is kept here for reference.')}</small>}
          </div>

          <div className="calculator-levels">
            <div className="calculator-levels-head">
              <span>{t('Levels')}</span>
              <small>{calculatorLevels.length}</small>
            </div>
            <div className="calculator-level-list">
              {calculatorLevels.map((level) => (
                <button
                  type="button"
                  key={level.key}
                  className={Math.abs(level.price - priceLevel) < 1e-9 ? 'calculator-level active' : 'calculator-level'}
                  onClick={() => applyPriceLevel(level.price)}
                >
                  <span className="calculator-level-label">
                    {level.label}{level.kind === 'auto' && level.touches ? ` · ${level.touches}` : ''}
                  </span>
                  <strong>{num(level.price, 8)}</strong>
                </button>
              ))}
              {!calculatorLevels.length && <div className="calculator-level-empty">{t('No visible levels')}</div>}
            </div>
          </div>

          {isStopExecution && <div className="field-grid"><div className="field"><label>Trigger % ATR</label><input className="input" type="number" step="0.1" value={triggerAtr} onChange={(e) => setTriggerAtr(Number(e.target.value))} /></div><div className="field"><label>Slip % ATR</label><input className="input" type="number" step="0.1" value={slipAtr} onChange={(e) => setSlipAtr(Number(e.target.value))} /></div></div>}
          {executionMode === 'limit' && <div className="field"><label>Slip % ATR</label><input className="input" type="number" step="0.1" value={slipAtr} onChange={(e) => setSlipAtr(Number(e.target.value))} /></div>}
          {stopMode === 'atr' ? <div className="field"><label>SL % ATR</label><input className="input" type="number" step="0.5" value={stopAtr} onChange={(e) => setStopAtr(Number(e.target.value))} /></div> : <div className="field"><label>{t('Technical SL')}</label><input className="input" type="number" step="any" value={technicalStop || ''} onChange={(e) => setTechnicalStop(Number(e.target.value))} /></div>}
          <div className="field"><label>{t('Target R:R')}</label><input className="input" type="number" step="0.5" min="0.5" value={legacyRr} onChange={(e) => setLegacyRr(Number(e.target.value))} /></div>
          <div className="muted" style={{ fontSize: 10 }}>{legacyPointTypeLabel}</div>
        </div>
      )}

      <div className="field-grid">
        <div className="field"><label>{t('Risk %')}</label><input className="input" type="number" step="0.1" min="0" value={risk} onChange={(e) => setRisk(Number(e.target.value))} /></div>
        <div className="field"><label>ATR (D,14)</label><input className="input" value={atr ? num(atr, 6) : '—'} readOnly /></div>
      </div>

      <div className="drawer-section">
        <div className="metric-grid">
          <div className="metric"><small>{t('Equity')}</small><strong>{money(balance)}</strong></div>
          <div className="metric"><small>{t('Risk amount')}</small><strong>{money(values.riskAmount)}</strong></div>
          <div className="metric"><small>{t('Entry')}</small><strong>{num(values.entry, 8)}</strong></div>
          <div className="metric"><small>{t('Stop')}</small><strong>{num(values.stop, 8)}</strong></div>
          <div className="metric"><small>{t('Target')}</small><strong>{num(values.target, 8)}</strong></div>
          <div className="metric"><small>R:R</small><strong>{Number(values.rr).toFixed(2)}</strong></div>
          <div className="metric"><small>{t('Position qty')}</small><strong>{num(values.positionSize, 8)}</strong></div>
          <div className="metric"><small>{t('Notional')}</small><strong>{money(notional)}</strong></div>
        </div>
      </div>

      <div className="drawer-actions">
        <button className="btn primary" disabled={!liveEnabled || !validGeometry || !values.positionSize || !balance || place.isPending} onClick={() => setConfirmOpen(true)}>
          {t('Place order')} <ChevronRight size={16} />
        </button>
        <small className="muted">{t('Prices and quantity are aligned to Bybit tickSize / qtyStep on the server before submission.')}</small>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('Confirm order')}
        danger
        confirmLabel={t('Send to Bybit')}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => place.mutate()}
        body={<><b>{symbol} {t(side)}</b><br />{mode === 'auto' ? `${t('Auto')} → ${executionModeLabel}` : executionModeLabel} · {t('Qty')} {num(values.positionSize, 8)}<br />{t('Entry')} {num(values.entry, 8)} · SL {num(values.stop, 8)} · TP {num(values.target, 8)}<br />{language==='uk'?'Ризик':language==='ru'?'Риск':'Risk'} {money(values.riskAmount)} · R:R {Number(values.rr).toFixed(2)}</>}
      />
    </aside>
  );
}
