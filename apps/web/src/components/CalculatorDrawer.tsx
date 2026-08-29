import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { calculateRiskReward, calculateTrade } from '@trade/domain';
import type { AccountPublic, AutoLevel, ManualLevel, RiskReward } from '@trade/shared';
import { api, json, money, num } from '../api';
import { effectiveRiskPercent, usePreferences } from '../preferences';
import ConfirmDialog from './ConfirmDialog';

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
  const [accountId, setAccountId] = useState(() => preferences.defaultAccountId || 2);
  const [risk, setRisk] = useState(() => effectiveRiskPercent(preferences, preferences.defaultAccountId || 2));
  const [mode, setMode] = useState<'stop' | 'limit' | 'market'>('limit');
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
  }, [selected?.id, preferredPriceLevel, preferredPriceLevelSeq, currentPrice, symbol]);

  const summary = useQuery<any[]>({
    queryKey: ['summary', accountId],
    queryFn: () => api(`/api/trade/summary?accountId=${accountId}`),
    refetchInterval: 15_000,
  });
  const balance = Number(summary.data?.[0]?.equity || 0);

  const atrQuery = useQuery<{ atr: number }>({
    queryKey: ['atr', symbol],
    queryFn: () => api(`/api/market/atr?symbol=${symbol}&interval=D&period=14`),
    enabled: Boolean(symbol),
  });
  const atr = atrQuery.data?.atr || 0;

  const calculatorLevels = useMemo(() => {
    const rows = [
      ...manualLevels.map((level) => ({
        key: `manual-${level.id}`,
        price: level.price,
        label: level.label || 'Manual',
        kind: 'manual' as const,
        touches: 0,
      })),
      ...autoLevels.map((level, index) => ({
        key: `auto-${level.type}-${level.price}-${index}`,
        price: level.price,
        label: level.type === 'mirror' ? 'Mirror' : level.type === 'support' ? 'Support' : 'Resistance',
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
  }, [manualLevels, autoLevels, currentPrice, priceLevel]);

  const legacy = useMemo(() => calculateTrade({
    mode,
    stopMode,
    side,
    balance,
    riskPercent: risk,
    atr,
    priceLevel: priceLevel || currentPrice,
    currentPrice,
    triggerAtrPercent: triggerAtr,
    slipAtrPercent: mode === 'market' ? 0 : slipAtr,
    stopAtrPercent: stopAtr,
    technicalStop,
    rr: legacyRr,
  }), [mode, stopMode, side, balance, risk, atr, priceLevel, currentPrice, triggerAtr, slipAtr, stopAtr, technicalStop, legacyRr]);

  const drawingRr = calculateRiskReward(entry, stop, target);
  const values = selected ? {
    entry,
    stop,
    target,
    trigger: mode === 'stop' ? trigger : 0,
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
  const validGeometry = side === 'Buy'
    ? values.stop < values.entry && values.target > values.entry
    : values.stop > values.entry && values.target < values.entry;

  const place = useMutation({
    mutationFn: () => api('/api/trade/order', json('POST', {
      accountId,
      symbol,
      side,
      orderType: mode === 'market' ? 'Market' : 'Limit',
      qty: values.positionSize,
      price: mode === 'market' ? undefined : values.entry,
      triggerPrice: mode === 'stop' ? values.trigger : undefined,
      stopLoss: values.stop,
      takeProfit: values.target,
    })),
    onSuccess: () => { setConfirmOpen(false); setError(''); },
    onError: (e: Error) => { setConfirmOpen(false); setError(e.message); },
  });

  const changeDrawing = (kind: 'entry' | 'stop' | 'target', value: number) => {
    if (kind === 'entry') setEntry(value);
    if (kind === 'stop') setStop(value);
    if (kind === 'target') setTarget(value);
    if (selected) {
      const nextEntry = kind === 'entry' ? value : entry;
      const nextTarget = kind === 'target' ? value : target;
      onUpdateRiskReward(selected.id, {
        [kind]: value,
        direction: nextTarget >= nextEntry ? 'long' : 'short',
      } as Partial<RiskReward>);
    }
  };

  return (
    <aside className={open ? 'drawer calculator-drawer' : 'drawer calculator-drawer closed'}>
      <div className="drawer-head">
        <div>
          <h2>Trade calculator</h2>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {selected ? `Risk/Reward #${selected.id}` : 'Legacy calculator'} · {symbol}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose}><X size={16} /></button>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {!liveEnabled && <div className="inline-error" style={{ background: '#2d2717', borderColor: '#5a4a21', color: '#e6c875' }}>
        Trading actions are locked by LIVE_TRADING_ENABLED=false.
      </div>}
      {!validGeometry && <div className="inline-error">Invalid SL/TP geometry for {side}. Check Entry, Stop and Target.</div>}

      <div className="field">
        <label>Account</label>
        <select className="select" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.demo ? ' · demo' : ''}{!a.configured ? ' · not configured' : ''}</option>)}
        </select>
      </div>

      <div className="field-grid">
        <div className="field"><label>Side</label><select className="select" value={side} onChange={(e) => setSide(e.target.value as any)}><option>Buy</option><option>Sell</option></select></div>
        <div className="field"><label>Order</label><select className="select" value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="limit">Limit</option><option value="stop">Stop Limit</option><option value="market">Market</option></select></div>
      </div>

      {selected ? (
        <div className="drawer-section">
          {mode === 'stop' && <div className="field"><label>Trigger</label><input className="input" type="number" step="any" value={trigger || ''} onChange={(e) => setTrigger(Number(e.target.value))} /></div>}
          <div className="field"><label>Entry</label><input className="input" type="number" step="any" value={entry || ''} onChange={(e) => changeDrawing('entry', Number(e.target.value))} /></div>
          <div className="field-grid">
            <div className="field"><label>Stop Loss</label><input className="input" type="number" step="any" value={stop || ''} onChange={(e) => changeDrawing('stop', Number(e.target.value))} /></div>
            <div className="field"><label>Take Profit</label><input className="input" type="number" step="any" value={target || ''} onChange={(e) => changeDrawing('target', Number(e.target.value))} /></div>
          </div>
        </div>
      ) : (
        <div className="drawer-section">
          <div className="field"><label>Stop model</label><select className="select" value={stopMode} onChange={(e) => setStopMode(e.target.value as any)}><option value="atr">ATR calculated</option><option value="technical">Technical stop</option></select></div>
          <div className="field">
            <label>Price level</label>
            <input className="input" type="number" step="any" value={priceLevel || ''} onChange={(e) => applyPriceLevel(Number(e.target.value))} />
            {mode === 'market' && <small className="muted">Market calculations use the current market price; the selected level is kept here for reference.</small>}
          </div>

          <div className="calculator-levels">
            <div className="calculator-levels-head">
              <span>Levels</span>
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
              {!calculatorLevels.length && <div className="calculator-level-empty">No visible levels</div>}
            </div>
          </div>

          {mode === 'stop' && <div className="field-grid"><div className="field"><label>Trigger % ATR</label><input className="input" type="number" step="0.1" value={triggerAtr} onChange={(e) => setTriggerAtr(Number(e.target.value))} /></div><div className="field"><label>Slip % ATR</label><input className="input" type="number" step="0.1" value={slipAtr} onChange={(e) => setSlipAtr(Number(e.target.value))} /></div></div>}
          {mode === 'limit' && <div className="field"><label>Slip % ATR</label><input className="input" type="number" step="0.1" value={slipAtr} onChange={(e) => setSlipAtr(Number(e.target.value))} /></div>}
          {stopMode === 'atr' ? <div className="field"><label>SL % ATR</label><input className="input" type="number" step="0.5" value={stopAtr} onChange={(e) => setStopAtr(Number(e.target.value))} /></div> : <div className="field"><label>Technical SL</label><input className="input" type="number" step="any" value={technicalStop || ''} onChange={(e) => setTechnicalStop(Number(e.target.value))} /></div>}
          <div className="field"><label>Target R:R</label><input className="input" type="number" step="0.5" min="0.5" value={legacyRr} onChange={(e) => setLegacyRr(Number(e.target.value))} /></div>
          <div className="muted" style={{ fontSize: 10 }}>Legacy strategy pointType: {legacy.pointType}</div>
        </div>
      )}

      <div className="field-grid">
        <div className="field"><label>Risk %</label><input className="input" type="number" step="0.1" min="0" value={risk} onChange={(e) => setRisk(Number(e.target.value))} /></div>
        <div className="field"><label>ATR (D,14)</label><input className="input" value={atr ? num(atr, 6) : '—'} readOnly /></div>
      </div>

      <div className="drawer-section">
        <div className="metric-grid">
          <div className="metric"><small>Equity</small><strong>{money(balance)}</strong></div>
          <div className="metric"><small>Risk amount</small><strong>{money(values.riskAmount)}</strong></div>
          <div className="metric"><small>Entry</small><strong>{num(values.entry, 8)}</strong></div>
          <div className="metric"><small>Stop</small><strong>{num(values.stop, 8)}</strong></div>
          <div className="metric"><small>Target</small><strong>{num(values.target, 8)}</strong></div>
          <div className="metric"><small>R:R</small><strong>{Number(values.rr).toFixed(2)}</strong></div>
          <div className="metric"><small>Position qty</small><strong>{num(values.positionSize, 8)}</strong></div>
          <div className="metric"><small>Notional</small><strong>{money(notional)}</strong></div>
        </div>
      </div>

      <div className="drawer-actions">
        <button className="btn primary" disabled={!liveEnabled || !validGeometry || !values.positionSize || !balance || place.isPending} onClick={() => setConfirmOpen(true)}>
          Place order <ChevronRight size={16} />
        </button>
        <small className="muted">Prices and quantity are aligned to Bybit tickSize / qtyStep on the server before submission.</small>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirm order"
        danger
        confirmLabel="Send to Bybit"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => place.mutate()}
        body={<><b>{symbol} {side}</b><br />{mode.toUpperCase()} · qty {num(values.positionSize, 8)}<br />Entry {num(values.entry, 8)} · SL {num(values.stop, 8)} · TP {num(values.target, 8)}<br />Risk {money(values.riskAmount)} · R:R {Number(values.rr).toFixed(2)}</>}
      />
    </aside>
  );
}
