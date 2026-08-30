import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, X } from 'lucide-react';
import { calculateRiskReward, calculateTrade } from '@trade/domain';
import type { AccountPublic, AutoLevel, ManualLevel, RiskReward } from '@trade/shared';
import { api, json, money, num } from '../api';
import {
  effectiveRiskPercent,
  readCalculatorAccountSelection,
  usePreferences,
  writeCalculatorAccountSelection,
  type CalculatorAccountSelection,
} from '../preferences';
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

type OrderMode = 'auto' | 'limit' | 'stop_market' | 'stop_limit' | 'market';
type SummaryRow = {
  accountId: number;
  accountName: string;
  equity?: number;
  walletBalance?: number;
  availableBalance?: number;
  online?: boolean;
  error?: string;
};
type OrderPreviewRow = {
  account: AccountPublic;
  summary?: SummaryRow;
  sizingBase: number;
  riskPercent: number;
  riskAmount: number;
  positionSize: number;
  notional: number;
  ready: boolean;
  error: string;
};
type BatchResult = { accountId: number; accountName: string; ok: boolean; error?: string };

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
  const drawerRef = useRef<HTMLElement | null>(null);
  const [accountSelection, setAccountSelectionState] = useState<CalculatorAccountSelection>(() =>
    readCalculatorAccountSelection(accounts, preferences.defaultAccountId),
  );
  const [tradeRiskByAccount, setTradeRiskByAccount] = useState<Record<string, number>>({});
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
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null);
  const [error, setError] = useState('');
  const initializedSymbolRef = useRef('');

  const copy = language === 'uk' ? {
    allAccounts: 'Усі акаунти', selectedAccounts: 'Вибрані акаунти…', singleAccounts: 'Один акаунт', chooseAccounts: 'Акаунти для ордера',
    mixed: 'різні', sizingBase: 'База', risk: 'Ризик', qty: 'К-сть', status: 'Статус', ready: 'готово', offline: 'offline',
    placeOrders: (n:number) => n === 1 ? 'Розмістити ордер' : `Розмістити ${n} ордерів`,
    sent: (ok:number,total:number) => `Відправлено ${ok} з ${total} ордерів`, retry: 'Повторити помилки',
    noAccounts: 'Немає вибраних акаунтів.', fixedMissing: 'Не задано фіксований розмір рахунку', loading: 'завантаження…',
    baseEquity: 'Equity', baseWallet: 'Wallet', baseFixed: 'Fixed',
  } : language === 'ru' ? {
    allAccounts: 'Все аккаунты', selectedAccounts: 'Выбранные аккаунты…', singleAccounts: 'Один аккаунт', chooseAccounts: 'Аккаунты для ордера',
    mixed: 'разные', sizingBase: 'База', risk: 'Риск', qty: 'Кол-во', status: 'Статус', ready: 'готово', offline: 'offline',
    placeOrders: (n:number) => n === 1 ? 'Разместить ордер' : `Разместить ${n} ордеров`,
    sent: (ok:number,total:number) => `Отправлено ${ok} из ${total} ордеров`, retry: 'Повторить ошибки',
    noAccounts: 'Нет выбранных аккаунтов.', fixedMissing: 'Не задан фиксированный размер счёта', loading: 'загрузка…',
    baseEquity: 'Equity', baseWallet: 'Wallet', baseFixed: 'Fixed',
  } : {
    allAccounts: 'All accounts', selectedAccounts: 'Selected accounts…', singleAccounts: 'Single account', chooseAccounts: 'Accounts for this order',
    mixed: 'mixed', sizingBase: 'Base', risk: 'Risk', qty: 'Qty', status: 'Status', ready: 'ready', offline: 'offline',
    placeOrders: (n:number) => n === 1 ? 'Place order' : `Place ${n} orders`,
    sent: (ok:number,total:number) => `${ok} of ${total} orders placed`, retry: 'Retry failed',
    noAccounts: 'No accounts selected.', fixedMissing: 'Fixed account size is not set', loading: 'loading…',
    baseEquity: 'Equity', baseWallet: 'Wallet', baseFixed: 'Fixed',
  };

  const accountSignature = accounts.map((account) => account.id).join(',');
  useEffect(() => {
    if (!accounts.length) return;
    setAccountSelectionState(readCalculatorAccountSelection(accounts, preferences.defaultAccountId));
  }, [accountSignature, preferences.defaultAccountId]);

  const setAccountSelection = (next: CalculatorAccountSelection) => {
    setAccountSelectionState(next);
    writeCalculatorAccountSelection(next);
  };

  const selectedAccounts = useMemo(() => {
    if (accountSelection.mode === 'all') return accounts;
    if (accountSelection.mode === 'selected') {
      const ids = new Set(accountSelection.selectedAccountIds);
      return accounts.filter((account) => ids.has(account.id));
    }
    return accounts.filter((account) => account.id === accountSelection.singleAccountId);
  }, [accounts, accountSelection]);

  const accountSelectorValue = accountSelection.mode === 'single'
    ? `single:${accountSelection.singleAccountId}`
    : accountSelection.mode;

  const onAccountSelectorChange = (value: string) => {
    if (value === 'all') {
      setAccountSelection({ ...accountSelection, mode: 'all' });
      return;
    }
    if (value === 'selected') {
      const selectedAccountIds = accountSelection.selectedAccountIds.length
        ? accountSelection.selectedAccountIds
        : accountSelection.singleAccountId ? [accountSelection.singleAccountId] : accounts[0] ? [accounts[0].id] : [];
      setAccountSelection({ ...accountSelection, mode: 'selected', selectedAccountIds });
      return;
    }
    const id = Number(value.replace('single:', ''));
    if (accounts.some((account) => account.id === id)) setAccountSelection({ ...accountSelection, mode: 'single', singleAccountId: id });
  };

  const toggleSelectedAccount = (id: number, checked: boolean) => {
    const nextIds = checked
      ? [...new Set([...accountSelection.selectedAccountIds, id])]
      : accountSelection.selectedAccountIds.filter((accountId) => accountId !== id);
    setAccountSelection({ ...accountSelection, mode: 'selected', selectedAccountIds: nextIds });
  };

  useEffect(() => {
    if (!open || confirmOpen) return;
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || drawerRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open, confirmOpen, onClose]);

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
    if (preferredPriceLevel !== null && Number.isFinite(preferredPriceLevel) && preferredPriceLevel > 0) {
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

  const summary = useQuery<SummaryRow[]>({
    queryKey: ['summary', 'calculator', accountSignature],
    queryFn: () => api('/api/trade/balances'),
    enabled: open && accounts.length > 0,
    refetchInterval: 15_000,
  });
  const summaryByAccount = useMemo(() => new Map((summary.data || []).map((row) => [row.accountId, row])), [summary.data]);

  const atrQuery = useQuery<{ atr: number }>({
    queryKey: ['atr', symbol],
    queryFn: () => api(`/api/market/atr?symbol=${symbol}&interval=D&period=14`),
    enabled: Boolean(symbol),
  });
  const atr = atrQuery.data?.atr || 0;

  const autoDecisionPrice = selected ? entry : priceLevel + (side === 'Buy' ? 1 : -1) * atr * slipAtr * 0.01;
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
      ...manualLevels.map((level) => ({ key: `manual-${level.id}`, price: level.price, label: level.label || t('Manual'), kind: 'manual' as const, touches: 0 })),
      ...autoLevels.map((level, index) => ({ key: `auto-${level.type}-${level.price}-${index}`, price: level.price, label: level.type === 'mirror' ? t('Mirror') : level.type === 'support' ? t('Support') : t('Resistance'), kind: 'auto' as const, touches: level.touches })),
    ];
    const anchor = currentPrice || priceLevel || 0;
    return rows.sort((a, b) => !anchor ? a.price - b.price : Math.abs(a.price - anchor) - Math.abs(b.price - anchor)).slice(0, 24);
  }, [manualLevels, autoLevels, currentPrice, priceLevel, t]);

  const legacy = useMemo(() => calculateTrade({
    mode: strategyMode,
    stopMode,
    side,
    balance: 1,
    riskPercent: 1,
    atr,
    priceLevel: priceLevel || currentPrice,
    currentPrice,
    triggerAtrPercent: triggerAtr,
    slipAtrPercent: executionMode === 'market' ? 0 : slipAtr,
    stopAtrPercent: stopAtr,
    technicalStop,
    rr: legacyRr,
  }), [strategyMode, executionMode, stopMode, side, atr, priceLevel, currentPrice, triggerAtr, slipAtr, stopAtr, technicalStop, legacyRr]);

  const drawingRr = calculateRiskReward(entry, stop, target);
  const values = selected ? {
    entry,
    stop,
    target,
    trigger: isStopExecution ? (mode === 'auto' ? entry : trigger) : 0,
    rr: drawingRr.ratio,
  } : {
    entry: legacy.entry,
    stop: legacy.stop,
    target: legacy.target,
    trigger: legacy.triggerPoint,
    rr: legacy.rr,
  };
  const riskDistance = Math.abs(values.entry - values.stop);
  const legacyPointTypeLabel = (() => {
    const technical = t('Technical SL');
    const labels: Record<number, string> = {
      10: 'Stop Limit · ATR SL', 11: `Stop Limit · ${technical}`, 20: 'Limit · ATR SL', 21: `Limit · ${technical}`,
      30: 'Market · ATR SL', 31: `Market · ${technical}`,
    };
    return labels[legacy.pointType] || `pointType ${legacy.pointType}`;
  })();
  const validGeometry = side === 'Buy' ? values.stop < values.entry && values.target > values.entry : values.stop > values.entry && values.target < values.entry;

  const riskForAccount = (accountId: number) => {
    const local = tradeRiskByAccount[String(accountId)];
    return typeof local === 'number' && Number.isFinite(local) ? local : effectiveRiskPercent(preferences, accountId);
  };
  const sizingBaseFor = (accountId: number, row?: SummaryRow) => {
    if (preferences.riskBase === 'wallet') return Number(row?.walletBalance || 0);
    if (preferences.riskBase === 'fixed') return Number(preferences.fixedAccountSize[String(accountId)] || 0);
    return Number(row?.equity || 0);
  };

  const orderRows = useMemo<OrderPreviewRow[]>(() => selectedAccounts.map((account) => {
    const row = summaryByAccount.get(account.id);
    const riskPercent = riskForAccount(account.id);
    const sizingBase = sizingBaseFor(account.id, row);
    const riskAmount = sizingBase * Math.max(0, riskPercent) * 0.01;
    const positionSize = riskDistance > 0 ? riskAmount / riskDistance : 0;
    const notional = positionSize * values.entry;
    let rowError = '';
    if (!row) rowError = copy.loading;
    else if (row.online === false) rowError = row.error || copy.offline;
    else if (preferences.riskBase === 'fixed' && sizingBase <= 0) rowError = copy.fixedMissing;
    else if (sizingBase <= 0) rowError = `${copy.sizingBase} = 0`;
    else if (riskPercent <= 0) rowError = `${copy.risk} = 0`;
    else if (!validGeometry || positionSize <= 0) rowError = 'Invalid size';
    return { account, summary: row, sizingBase, riskPercent, riskAmount, positionSize, notional, ready: !rowError, error: rowError };
  }), [selectedAccounts, summaryByAccount, tradeRiskByAccount, preferences.riskBase, preferences.fixedAccountSize, preferences.accountRiskPercent, preferences.defaultRiskPercent, riskDistance, values.entry, validGeometry, language]);

  const selectedRisks = orderRows.map((row) => row.riskPercent);
  const commonRisk = selectedRisks.length && selectedRisks.every((value) => Math.abs(value - selectedRisks[0]!) < 1e-12) ? selectedRisks[0]! : null;
  const setCommonRisk = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    setTradeRiskByAccount((current) => {
      const next = { ...current };
      for (const account of selectedAccounts) next[String(account.id)] = value;
      return next;
    });
  };
  const setAccountRisk = (accountId: number, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    setTradeRiskByAccount((current) => ({ ...current, [String(accountId)]: value }));
  };

  const submitPayload = (row: OrderPreviewRow) => ({
    accountId: row.account.id,
    symbol,
    side,
    orderType: executionMode === 'market' || executionMode === 'stop_market' ? 'Market' : 'Limit',
    executionMode,
    autoMode: mode === 'auto',
    autoReferencePrice: Number(autoDecisionPrice) || undefined,
    qty: row.positionSize,
    price: usesLimitPrice ? values.entry : undefined,
    triggerPrice: isStopExecution ? values.trigger : undefined,
    stopLoss: values.stop,
    takeProfit: values.target,
    pointType: selected ? undefined : legacy.pointType,
    priceLevel: priceLevel || undefined,
    plannedRr: Number(values.rr),
    riskPercent: row.riskPercent,
    riskAmount: row.riskAmount,
    plannedEntry: Number(values.entry),
  });

  const place = useMutation<BatchResult[], Error, number[] | undefined>({
    mutationFn: async (onlyAccountIds) => {
      const requested = onlyAccountIds?.length ? new Set(onlyAccountIds) : null;
      const rows = orderRows.filter((row) => !requested || requested.has(row.account.id));
      return Promise.all(rows.map(async (row) => {
        try {
          await api('/api/trade/order', json('POST', submitPayload(row)));
          return { accountId: row.account.id, accountName: row.account.name, ok: true } as BatchResult;
        } catch (e) {
          return { accountId: row.account.id, accountName: row.account.name, ok: false, error: e instanceof Error ? e.message : String(e) } as BatchResult;
        }
      }));
    },
    onSuccess: (results, requestedIds) => {
      setConfirmOpen(false);
      setError('');
      setBatchResults((previous) => {
        if (!requestedIds?.length || !previous) return results;
        const updates = new Map(results.map((result) => [result.accountId, result]));
        return previous.map((result) => updates.get(result.accountId) || result);
      });
    },
    onError: (e) => { setConfirmOpen(false); setError(e.message); },
  });

  const changeDrawing = (kind: 'entry' | 'stop' | 'target', value: number) => {
    if (kind === 'entry') { setEntry(value); if (selected && mode === 'auto') setTrigger(value); }
    if (kind === 'stop') setStop(value);
    if (kind === 'target') setTarget(value);
    if (selected) {
      const nextEntry = kind === 'entry' ? value : entry;
      const nextStop = kind === 'stop' ? value : stop;
      onUpdateRiskReward(selected.id, { [kind]: value, direction: nextStop < nextEntry ? 'long' : 'short' } as Partial<RiskReward>);
    }
  };

  const totalRisk = orderRows.reduce((sum, row) => sum + row.riskAmount, 0);
  const totalNotional = orderRows.reduce((sum, row) => sum + row.notional, 0);
  const totalBase = orderRows.reduce((sum, row) => sum + row.sizingBase, 0);
  const readyRows = orderRows.filter((row) => row.ready);
  const allReady = orderRows.length > 0 && readyRows.length === orderRows.length;
  const failedResults = batchResults?.filter((result) => !result.ok) || [];
  const successResults = batchResults?.filter((result) => result.ok) || [];
  const riskBaseLabel = preferences.riskBase === 'wallet' ? copy.baseWallet : preferences.riskBase === 'fixed' ? copy.baseFixed : copy.baseEquity;

  return (
    <aside ref={drawerRef} className={open ? 'drawer calculator-drawer' : 'drawer calculator-drawer closed'}>
      <div className="drawer-head">
        <div>
          <h2>{t('Trade calculator')}</h2>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{selected ? `Risk/Reward #${selected.id}` : t('Legacy calculator')} · {symbol}</div>
        </div>
        <button className="icon-btn" onClick={onClose}><X size={16} /></button>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {!liveEnabled && <div className="inline-error" style={{ background: '#2d2717', borderColor: '#5a4a21', color: '#e6c875' }}>{t('Trading actions are locked by LIVE_TRADING_ENABLED=false.')}</div>}
      {!validGeometry && <div className="inline-error">{t('Invalid SL/TP geometry for {side}. Check Entry, Stop and Target.', { side: t(side) })}</div>}

      <div className="field">
        <label>{t('Account')}</label>
        <select className="select" value={accountSelectorValue} onChange={(e) => onAccountSelectorChange(e.target.value)}>
          <option value="all">{copy.allAccounts} ({accounts.length})</option>
          <optgroup label={copy.singleAccounts}>
            {accounts.map((account) => <option key={account.id} value={`single:${account.id}`}>{account.name}{account.demo ? ' · demo' : ''}</option>)}
          </optgroup>
          <option value="selected">{copy.selectedAccounts}</option>
        </select>
      </div>

      {accountSelection.mode === 'selected' && <div className="calculator-account-picker">
        <div className="calculator-account-picker-title">{copy.chooseAccounts}</div>
        {accounts.map((account) => <label key={`calc-account-${account.id}`} className="setting-check">
          <input type="checkbox" checked={accountSelection.selectedAccountIds.includes(account.id)} onChange={(e) => toggleSelectedAccount(account.id, e.target.checked)} />
          {account.name}{account.demo ? ' · demo' : ''}
        </label>)}
      </div>}
      {!selectedAccounts.length && <div className="inline-error">{copy.noAccounts}</div>}

      <div className="field-grid">
        <div className="field"><label>{t('Side')}</label><select className="select" value={side} onChange={(e) => setSide(e.target.value as any)}><option value="Buy">{t('Buy')}</option><option value="Sell">{t('Sell')}</option></select></div>
        <div className="field"><label>{t('Order')}</label><select className="select" value={mode} onChange={(e) => setMode(e.target.value as OrderMode)}><option value="auto">{t('Auto (recommended)')}</option><option value="limit">{t('Limit')}</option><option value="stop_market">{t('Stop Market')}</option><option value="stop_limit">{t('Stop Limit')}</option><option value="market">{t('Market')}</option></select></div>
      </div>

      {mode === 'auto' && <div className="muted" style={{ fontSize: 11, margin: '-2px 0 10px' }}>{t('Auto selected: {type}', { type: executionModeLabel })} · {t('Automatic mode chooses Limit for pullbacks and Stop Market for breakouts.')}</div>}
      {manualCrossesMarket && <div className="inline-error" style={{ background: '#2d2717', borderColor: '#5a4a21', color: '#e6c875' }}>{t('This Limit crosses the current market and may execute immediately. Auto would use {type}.', { type: t('Stop Market') })}</div>}
      {manualStopWrongSide && <div className="inline-error" style={{ background: '#2d2717', borderColor: '#5a4a21', color: '#e6c875' }}>{t('This Stop is already on the triggered side of the market. Auto would use {type}.', { type: t('Limit') })}</div>}

      {selected ? <div className="drawer-section">
        {isStopExecution && mode !== 'auto' && <div className="field"><label>{t('Trigger')}</label><input className="input" type="number" step="any" value={trigger || ''} onChange={(e) => setTrigger(Number(e.target.value))} /></div>}
        <div className="field"><label>{t('Entry')}</label><input className="input" type="number" step="any" value={entry || ''} onChange={(e) => changeDrawing('entry', Number(e.target.value))} /></div>
        <div className="field-grid">
          <div className="field"><label>{t('Stop Loss')}</label><input className="input" type="number" step="any" value={stop || ''} onChange={(e) => changeDrawing('stop', Number(e.target.value))} /></div>
          <div className="field"><label>{t('Take Profit')}</label><input className="input" type="number" step="any" value={target || ''} onChange={(e) => changeDrawing('target', Number(e.target.value))} /></div>
        </div>
      </div> : <div className="drawer-section">
        <div className="field"><label>{t('Stop model')}</label><select className="select" value={stopMode} onChange={(e) => setStopMode(e.target.value as any)}><option value="atr">{t('ATR calculated')}</option><option value="technical">{t('Technical stop')}</option></select></div>
        <div className="field">
          <label>{t('Price level')}</label>
          <input className="input" type="number" step="any" value={priceLevel || ''} onChange={(e) => applyPriceLevel(Number(e.target.value))} />
          {executionMode === 'market' && <small className="muted">{t('Market calculations use the current market price; the selected level is kept here for reference.')}</small>}
        </div>
        <div className="calculator-levels">
          <div className="calculator-levels-head"><span>{t('Levels')}</span><small>{calculatorLevels.length}</small></div>
          <div className="calculator-level-list">
            {calculatorLevels.map((level) => <button type="button" key={level.key} className={Math.abs(level.price - priceLevel) < 1e-9 ? 'calculator-level active' : 'calculator-level'} onClick={() => applyPriceLevel(level.price)}>
              <span className="calculator-level-label">{level.label}{level.kind === 'auto' && level.touches ? ` · ${level.touches}` : ''}</span><strong>{num(level.price, 8)}</strong>
            </button>)}
            {!calculatorLevels.length && <div className="calculator-level-empty">{t('No visible levels')}</div>}
          </div>
        </div>
        {isStopExecution && <div className="field-grid"><div className="field"><label>Trigger % ATR</label><input className="input" type="number" step="0.1" value={triggerAtr} onChange={(e) => setTriggerAtr(Number(e.target.value))} /></div><div className="field"><label>Slip % ATR</label><input className="input" type="number" step="0.1" value={slipAtr} onChange={(e) => setSlipAtr(Number(e.target.value))} /></div></div>}
        {executionMode === 'limit' && <div className="field"><label>Slip % ATR</label><input className="input" type="number" step="0.1" value={slipAtr} onChange={(e) => setSlipAtr(Number(e.target.value))} /></div>}
        {stopMode === 'atr' ? <div className="field"><label>SL % ATR</label><input className="input" type="number" step="0.5" value={stopAtr} onChange={(e) => setStopAtr(Number(e.target.value))} /></div> : <div className="field"><label>{t('Technical SL')}</label><input className="input" type="number" step="any" value={technicalStop || ''} onChange={(e) => setTechnicalStop(Number(e.target.value))} /></div>}
        <div className="field"><label>{t('Target R:R')}</label><input className="input" type="number" step="0.5" min="0.5" value={legacyRr} onChange={(e) => setLegacyRr(Number(e.target.value))} /></div>
        <div className="muted" style={{ fontSize: 10 }}>{legacyPointTypeLabel}</div>
      </div>}

      <div className="field-grid">
        <div className="field"><label>{t('Risk %')}{orderRows.length > 1 ? ` · ${commonRisk === null ? copy.mixed : ''}` : ''}</label><input className="input" type="number" step="0.05" min="0" placeholder={commonRisk === null ? copy.mixed : undefined} value={commonRisk ?? ''} onChange={(e) => { if (e.target.value !== '') setCommonRisk(Math.max(0, Number(e.target.value))); }} /></div>
        <div className="field"><label>ATR (D,14)</label><input className="input" value={atr ? num(atr, 6) : '—'} readOnly /></div>
      </div>

      <div className="drawer-section">
        <div className="metric-grid">
          <div className="metric"><small>{orderRows.length > 1 ? t('Account') : riskBaseLabel}</small><strong>{orderRows.length > 1 ? orderRows.length : money(orderRows[0]?.sizingBase || 0)}</strong></div>
          <div className="metric"><small>{t('Risk amount')}</small><strong>{money(totalRisk)}</strong></div>
          <div className="metric"><small>{t('Entry')}</small><strong>{num(values.entry, 8)}</strong></div>
          <div className="metric"><small>{t('Stop')}</small><strong>{num(values.stop, 8)}</strong></div>
          <div className="metric"><small>{t('Target')}</small><strong>{num(values.target, 8)}</strong></div>
          <div className="metric"><small>R:R</small><strong>{Number(values.rr).toFixed(2)}</strong></div>
          <div className="metric"><small>{orderRows.length > 1 ? copy.sizingBase : t('Position qty')}</small><strong>{orderRows.length > 1 ? money(totalBase) : num(orderRows[0]?.positionSize || 0, 8)}</strong></div>
          <div className="metric"><small>{t('Notional')}</small><strong>{money(totalNotional)}</strong></div>
        </div>
      </div>

      {orderRows.length > 1 && <div className="calculator-batch-preview">
        <div className="calculator-batch-head"><strong>{copy.chooseAccounts}</strong><span>{riskBaseLabel}</span></div>
        {orderRows.map((row) => <div className="calculator-batch-row" key={`preview-${row.account.id}`}>
          <div className="calculator-batch-account"><strong>{row.account.name}</strong><small>{money(row.sizingBase)}</small></div>
          <div className="calculator-batch-risk"><input className="input" type="number" min="0" step="0.05" value={row.riskPercent} onChange={(e) => setAccountRisk(row.account.id, Math.max(0, Number(e.target.value)))} /><small>% · {money(row.riskAmount)}</small></div>
          <div className="calculator-batch-qty"><strong>{num(row.positionSize, 8)}</strong><small>{copy.qty}</small></div>
          <div className={row.ready ? 'calculator-batch-status positive' : 'calculator-batch-status negative'}>{row.ready ? copy.ready : row.error}</div>
        </div>)}
      </div>}

      {batchResults && <div className="calculator-batch-results">
        <strong>{copy.sent(successResults.length, batchResults.length)}</strong>
        {batchResults.map((result) => <div className="calculator-result-row" key={`result-${result.accountId}`}><span>{result.ok ? '✅' : '❌'} {result.accountName}</span><small>{result.ok ? 'OK' : result.error}</small></div>)}
        {failedResults.length > 0 && <button className="btn secondary" disabled={place.isPending} onClick={() => place.mutate(failedResults.map((result) => result.accountId))}>{copy.retry}</button>}
      </div>}

      <div className="drawer-actions">
        <button className="btn primary" disabled={!liveEnabled || !validGeometry || !allReady || place.isPending} onClick={() => { setBatchResults(null); setConfirmOpen(true); }}>
          {copy.placeOrders(orderRows.length)} <ChevronRight size={16} />
        </button>
        <small className="muted">{t('Prices and quantity are aligned to Bybit tickSize / qtyStep on the server before submission.')}</small>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t('Confirm order')}
        danger
        confirmLabel={copy.placeOrders(orderRows.length)}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => place.mutate(undefined)}
        body={<div className="calculator-confirm-batch">
          <b>{symbol} {t(side)}</b><br />{mode === 'auto' ? `${t('Auto')} → ${executionModeLabel}` : executionModeLabel}<br />
          {t('Entry')} {num(values.entry, 8)} · SL {num(values.stop, 8)} · TP {num(values.target, 8)} · R:R {Number(values.rr).toFixed(2)}
          <div className="calculator-confirm-list">{orderRows.map((row) => <div key={`confirm-${row.account.id}`}><span>{row.account.name}</span><span>{row.riskPercent}% · {money(row.riskAmount)} · {copy.qty} {num(row.positionSize, 8)}</span></div>)}</div>
        </div>}
      />
    </aside>
  );
}
