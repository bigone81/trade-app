import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import type { AccountPublic, TradeExecution, TradeOrder, TradePosition } from '@trade/shared';
import { api, json, money, num } from '../api';
import ConfirmDialog from '../components/ConfirmDialog';
import { groupActiveOrders } from '../tradeGrouping';
import { useI18n } from '../i18n';

type Tab = 'positions' | 'orders' | 'executions' | 'history';
type Action =
  | { kind: 'cancel'; order: TradeOrder; childOrderIds: string[] }
  | { kind: 'cancelAll'; accountId: number; accountName: string; symbol: string }
  | { kind: 'close'; position: TradePosition; percent: number }
  | { kind: 'flatten'; position: TradePosition }
  | null;

export default function TradePage() {
  const qc = useQueryClient();
  const { t, language } = useI18n();
  const [account, setAccountState] = useState(() => { const value=Number(localStorage.getItem('edgedesk.trade.account.v1')||0); return Number.isFinite(value)?value:0; });
  const setAccount=(value:number)=>{setAccountState(value);localStorage.setItem('edgedesk.trade.account.v1',String(value));};
  const [symbol, setSymbol] = useState('');
  const [tab, setTab] = useState<Tab>('positions');
  const [action, setAction] = useState<Action>(null);
  const [selected, setSelected] = useState<TradePosition | null>(null);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [trailing, setTrailing] = useState('');

  const config = useQuery<{ accounts: AccountPublic[]; liveTradingEnabled: boolean }>({
    queryKey: ['config'],
    queryFn: () => api('/api/config'),
  });
  useEffect(()=>{
    if(!config.data?.accounts.length)return;
    if(account!==0&&!config.data.accounts.some((item)=>item.id===account))setAccount(0);
  },[config.data?.accounts,account]);
  const suffix = account ? `?accountId=${account}` : '';
  const summary = useQuery<any[]>({ queryKey: ['trade-summary', account], queryFn: () => api(`/api/trade/summary${suffix}`), refetchInterval: 10_000 });
  const positions = useQuery<TradePosition[]>({ queryKey: ['positions', account], queryFn: () => api(`/api/trade/positions${suffix}`), refetchInterval: 7_000 });
  const orders = useQuery<TradeOrder[]>({ queryKey: ['orders', account], queryFn: () => api(`/api/trade/orders${suffix}`), refetchInterval: 7_000 });
  const executions = useQuery<TradeExecution[]>({ queryKey: ['executions', account], queryFn: () => api(`/api/trade/executions${suffix}`), refetchInterval: 12_000 });
  const history = useQuery<TradeOrder[]>({ queryKey: ['trade-history', account], queryFn: () => api(`/api/trade/history${suffix}`), refetchInterval: 30_000 });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['trade-summary'] })
    .then(() => qc.invalidateQueries({ queryKey: ['positions'] }))
    .then(() => qc.invalidateQueries({ queryKey: ['orders'] }));

  const run = useMutation({
    mutationFn: async (a: NonNullable<Action>) => {
      if (a.kind === 'cancel') return api('/api/trade/orders/cancel-group', json('POST', { accountId: a.order.accountId, symbol: a.order.symbol, orderIds: [...a.childOrderIds, a.order.orderId] }));
      if (a.kind === 'cancelAll') return api('/api/trade/orders/cancel-all', json('POST', { accountId: a.accountId, symbol: a.symbol }));
      if (a.kind === 'close') return api('/api/trade/position/close', json('POST', { accountId: a.position.accountId, symbol: a.position.symbol, percent: a.percent, positionIdx: a.position.positionIdx }));
      return api('/api/trade/position/flatten', json('POST', { accountId: a.position.accountId, symbol: a.position.symbol, positionIdx: a.position.positionIdx }));
    },
    onSettled: () => { setAction(null); setTimeout(refresh, 700); },
  });

  const updateStops = useMutation({
    mutationFn: (override: { stopLoss?: number; takeProfit?: number; trailingStop?: number } = {}) => selected
      ? api('/api/trade/position/stops', json('POST', {
        accountId: selected.accountId,
        symbol: selected.symbol,
        positionIdx: selected.positionIdx,
        stopLoss: override.stopLoss ?? (Number(sl) || 0),
        takeProfit: override.takeProfit ?? (Number(tp) || 0),
        trailingStop: override.trailingStop ?? (Number(trailing) || 0),
      }))
      : Promise.resolve(),
    onSuccess: () => { setTimeout(refresh, 700); },
  });

  const filter = <T extends { symbol: string }>(rows: T[] | undefined) => rows?.filter((row) => !symbol || row.symbol.includes(symbol.toUpperCase())) || [];
  const live = config.data?.liveTradingEnabled ?? false;
  const groupedOrders = useMemo(() => {
    const rows = orders.data || [];
    const positionKeys = new Set((positions.data || []).map((p) => `${p.accountId}:${p.symbol}`));
    const displayRows = rows.filter((order) => {
      const protective = Boolean(order.triggerPrice && order.reduceOnly) || /stoploss|takeprofit/i.test(String(order.stopOrderType || ''));
      if (!protective) return true;
      const hasPendingParent = rows.some((candidate) => candidate.accountId === order.accountId && candidate.symbol === order.symbol && candidate.orderId !== order.orderId && !candidate.reduceOnly && candidate.side !== order.side);
      if (hasPendingParent) return true;
      return !positionKeys.has(`${order.accountId}:${order.symbol}`);
    });
    return groupActiveOrders(displayRows);
  }, [orders.data, positions.data]);
  const visibleGroupedOrders = useMemo(() => groupedOrders.filter((group) => !symbol || group.main.symbol.includes(symbol.toUpperCase())), [groupedOrders, symbol]);
  const accountGroupedCount = (accountId: number) => groupedOrders.filter((group) => group.main.accountId === accountId).length;

  const tabs: [Tab, string, number][] = [
    ['positions', 'Positions', positions.data?.length || 0],
    ['orders', 'Orders', groupedOrders.length],
    ['executions', 'Executions', executions.data?.length || 0],
    ['history', 'History', history.data?.length || 0],
  ];

  const actionBody = useMemo(() => {
    if (!action) return null;
    if (action.kind === 'cancel') return <>{language==='uk'?'Скасувати':language==='ru'?'Отменить':'Cancel'} <b>{action.order.symbol}</b> {language==='uk'?'ордер':language==='ru'?'ордер':'order'}{action.childOrderIds.length ? <> {language==='uk'?'разом із':language==='ru'?'вместе с':'together with'} <b>{action.childOrderIds.length} SL/TP</b></> : null}?</>;
    if (action.kind === 'cancelAll') return <>{language==='uk'?'Скасувати всі':language==='ru'?'Отменить все':'Cancel all'} <b>{action.symbol}</b> {language==='uk'?'ордери на':language==='ru'?'ордера на':'orders on'} <b>{action.accountName}</b>?</>;
    if (action.kind === 'close') return <>{language==='uk'?'Закрити':language==='ru'?'Закрыть':'Close'} <b>{action.percent}%</b> {language==='uk'?'позиції':language==='ru'?'позиции':'of'} <b>{action.position.symbol} {t(action.position.side)}</b> Market reduce-only?</>;
    return <>{language==='uk'?'Скасувати всі ордери та повністю закрити':language==='ru'?'Отменить все ордера и полностью закрыть':'Cancel all orders and close the entire'} <b>{action.position.symbol} {t(action.position.side)}</b> Market?</>;
  }, [action, language, t]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{t('Trade Control')}</h1><p>{t('Real-time positions, orders and fills across exchange accounts')}</p></div>
        <div className="top-controls">
          <select className="select" value={account} onChange={(e) => setAccount(Number(e.target.value))}>
            <option value={0}>{t('All accounts')}</option>
            {config.data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.demo ? ' · demo' : ''}</option>)}
          </select>
          <input className="input" placeholder={t('Symbol filter')} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          <button className="btn secondary" onClick={refresh}><RefreshCw size={14} />{t('Refresh')}</button>
          {!live && <span className="badge demo">{t('actions locked')}</span>}
        </div>
      </div>

      <div className="account-cards">
        {summary.data?.map((s) => (
          <div className={account === s.accountId ? 'account-card card active' : 'account-card card'} key={s.accountId} onClick={() => setAccount(account === s.accountId ? 0 : s.accountId)}>
            <h3>{s.accountName || `Account ${s.accountId}`} {s.online ? <span className="badge live">{t('online')}</span> : <span className="badge">{t('offline')}</span>}</h3>
            <div className="account-stat"><span>{t('Equity')}</span><b>{s.online ? money(s.equity) : '—'}</b></div>
            <div className="account-stat"><span>{t('Unrealized')}</span><b className={s.unrealisedPnl >= 0 ? 'positive' : 'negative'}>{s.online ? money(s.unrealisedPnl) : '—'}</b></div>
            <div className="account-stat"><span>{t('Positions / Orders')}</span><b>{s.online ? `${s.positions} / ${accountGroupedCount(s.accountId)}` : '—'}</b></div>
          </div>
        ))}
      </div>

      <div className="tabs">{tabs.map(([id, label, count]) => <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>{t(label)} {count}</button>)}</div>

      <div className="card table-card">
        {tab === 'positions' && <table className="data-table"><thead><tr><th>{t('Account')}</th><th>{t('Symbol')}</th><th>{t('Side')}</th><th>{t('Size')}</th><th>{t('Entry')}</th><th>{t('Mark')}</th><th>{t('uPnL')}</th><th>{t('SL')}</th><th>{t('TP')}</th><th>{t('Liq')}</th><th>{t('Actions')}</th></tr></thead><tbody>
          {filter(positions.data).map((p) => <tr key={`${p.accountId}-${p.symbol}-${p.positionIdx}`} onClick={() => { setSelected(p); setSl(String(p.stopLoss || '')); setTp(String(p.takeProfit || '')); setTrailing(String(p.trailingStop || '')); }}>
            <td>{p.accountName}</td><td><b>{p.symbol}</b></td><td className={p.side === 'Buy' ? 'positive' : 'negative'}>{t(p.side)}</td><td>{num(p.size, 6)}</td><td>{num(p.avgPrice, 6)}</td><td>{num(p.markPrice, 6)}</td><td className={p.unrealisedPnl >= 0 ? 'positive' : 'negative'}>{money(p.unrealisedPnl)}</td><td>{p.stopLoss ? num(p.stopLoss, 6) : '—'}</td><td>{p.takeProfit ? num(p.takeProfit, 6) : '—'}</td><td>{p.liqPrice ? num(p.liqPrice, 6) : '—'}</td>
            <td><div className="row-actions" onClick={(e) => e.stopPropagation()}><button className="mini-btn" disabled={!live} onClick={() => setAction({ kind: 'close', position: p, percent: 25 })}>25%</button><button className="mini-btn" disabled={!live} onClick={() => setAction({ kind: 'close', position: p, percent: 50 })}>50%</button><button className="mini-btn danger" disabled={!live} onClick={() => setAction({ kind: 'close', position: p, percent: 100 })}>{t('Close')}</button><button className="mini-btn danger" disabled={!live} onClick={() => setAction({ kind: 'flatten', position: p })}>Flatten</button></div></td>
          </tr>)}
        </tbody></table>}

        {tab === 'orders' && <table className="data-table"><thead><tr><th>{t('Account')}</th><th>{t('Symbol')}</th><th>{t('Side')}</th><th>{t('Type')}</th><th>{t('Status')}</th><th>{t('Price')}</th><th>{t('Qty')}</th><th>{t('Filled')}</th><th>{t('Trigger')}</th><th>{t('SL')}</th><th>{t('TP')}</th><th /></tr></thead><tbody>
          {visibleGroupedOrders.map((group) => {
            const o = group.main;
            const slPrice = group.stopLossOrder?.triggerPrice || o.stopLoss;
            const tpPrice = group.takeProfitOrder?.triggerPrice || o.takeProfit;
            return <tr key={`${o.accountId}-${o.orderId}`} title={group.children.length ? `${group.children.length} protective order(s) grouped under this order` : undefined}>
              <td>{o.accountName}</td><td><b>{o.symbol}</b>{group.children.length ? <span className="badge order-child-badge"> +{group.children.length} SL/TP</span> : null}</td><td className={o.side === 'Buy' ? 'positive' : 'negative'}>{t(o.side)}</td><td>{o.orderType}</td><td>{t(o.orderStatus)}</td><td>{num(o.price || o.triggerPrice || 0, 6)}</td><td>{num(o.qty, 6)}</td><td>{num(o.cumExecQty, 6)}</td><td>{o.triggerPrice && o.price ? num(o.triggerPrice, 6) : '—'}</td><td>{slPrice ? num(slPrice, 6) : '—'}</td><td>{tpPrice ? num(tpPrice, 6) : '—'}</td>
              <td><div className="row-actions"><button className="mini-btn danger" disabled={!live} onClick={() => setAction({ kind: 'cancel', order: o, childOrderIds: group.children.map((child) => child.orderId) })}>{t('Cancel')}</button><button className="mini-btn" disabled={!live} onClick={() => setAction({ kind: 'cancelAll', accountId: o.accountId, accountName: o.accountName, symbol: o.symbol })}>{t('Cancel all')}</button></div></td>
            </tr>;
          })}
        </tbody></table>}

        {tab === 'executions' && <table className="data-table"><thead><tr><th>{t('Account')}</th><th>{t('Time')}</th><th>{t('Symbol')}</th><th>{t('Side')}</th><th>{t('Price')}</th><th>{t('Qty')}</th><th>{t('Fee')}</th><th>{t('Order ID')}</th></tr></thead><tbody>{filter(executions.data).map((x) => <tr key={`${x.accountId}-${x.execId}`}><td>{x.accountName}</td><td>{new Date(x.execTime).toLocaleString()}</td><td><b>{x.symbol}</b></td><td>{t(x.side)}</td><td>{num(x.execPrice, 6)}</td><td>{num(x.execQty, 6)}</td><td>{num(x.execFee, 6)}</td><td>{x.orderId}</td></tr>)}</tbody></table>}

        {tab === 'history' && <table className="data-table"><thead><tr><th>{t('Account')}</th><th>{t('Time')}</th><th>{t('Symbol')}</th><th>{t('Side')}</th><th>{t('Type')}</th><th>{t('Status')}</th><th>{language==='uk'?'Сер. / Ціна':language==='ru'?'Ср. / Цена':'Avg / Price'}</th><th>{t('Qty')}</th><th>{t('Filled')}</th></tr></thead><tbody>{filter(history.data).map((o) => <tr key={`${o.accountId}-${o.orderId}`}><td>{o.accountName}</td><td>{new Date(o.updatedTime).toLocaleString()}</td><td><b>{o.symbol}</b></td><td>{t(o.side)}</td><td>{o.orderType}</td><td>{t(o.orderStatus)}</td><td>{num(o.price, 6)}</td><td>{num(o.qty, 6)}</td><td>{num(o.cumExecQty, 6)}</td></tr>)}</tbody></table>}

        {((tab === 'positions' && !filter(positions.data).length) || (tab === 'orders' && !visibleGroupedOrders.length) || (tab === 'executions' && !filter(executions.data).length) || (tab === 'history' && !filter(history.data).length)) && <div className="empty">{t('No data for the selected filters.')}</div>}
      </div>

      {selected && <aside className="drawer" style={{ position: 'fixed', right: 14, top: 14, bottom: 14, zIndex: 60, maxHeight: 'none' }}>
        <div className="drawer-head"><div><h2>{selected.symbol} {t(selected.side)}</h2><div className="muted">{selected.accountName} · {language==='uk'?'розмір':language==='ru'?'размер':'size'} {num(selected.size, 6)}</div></div><button className="icon-btn" onClick={() => setSelected(null)}><X size={16} /></button></div>
        <div className="metric-grid"><div className="metric"><small>{t('Entry')}</small><strong>{num(selected.avgPrice, 6)}</strong></div><div className="metric"><small>{t('Mark')}</small><strong>{num(selected.markPrice, 6)}</strong></div><div className="metric"><small>uPnL</small><strong className={selected.unrealisedPnl >= 0 ? 'positive' : 'negative'}>{money(selected.unrealisedPnl)}</strong></div><div className="metric"><small>{t('Liquidation')}</small><strong>{selected.liqPrice ? num(selected.liqPrice, 6) : '—'}</strong></div></div>
        <div className="drawer-section"><div className="field"><label>{t('Stop Loss')}</label><input className="input" type="number" step="any" value={sl} onChange={(e) => setSl(e.target.value)} /></div><div className="field"><label>{t('Take Profit')}</label><input className="input" type="number" step="any" value={tp} onChange={(e) => setTp(e.target.value)} /></div><div className="field"><label>{t('Trailing Stop distance')}</label><input className="input" type="number" step="any" value={trailing} onChange={(e) => setTrailing(e.target.value)} /></div><div className="drawer-actions"><button className="btn secondary" disabled={!live || updateStops.isPending} onClick={() => updateStops.mutate({})}>{t('Update SL / TP / Trail')}</button><button className="btn secondary" disabled={!live || updateStops.isPending} onClick={() => updateStops.mutate({ stopLoss: selected.avgPrice })}>{t('Move SL to breakeven')}</button><button className="btn ghost" onClick={() => { location.href = `/?symbol=${encodeURIComponent(selected.symbol)}`; }}>{t('Open on chart')}</button></div></div>
        <div className="drawer-section"><h3 style={{ fontSize: 12 }}><AlertTriangle size={14} /> {t('Emergency')}</h3><div className="drawer-actions"><button className="btn warning" disabled={!live} onClick={() => setAction({ kind: 'close', position: selected, percent: 50 })}>{t('Close 50%')}</button><button className="btn danger" disabled={!live} onClick={() => setAction({ kind: 'close', position: selected, percent: 100 })}>{t('Force close 100%')}</button><button className="btn danger" disabled={!live} onClick={() => setAction({ kind: 'flatten', position: selected })}>{t('Flatten symbol')}</button></div></div>
      </aside>}

      <ConfirmDialog
        open={Boolean(action)}
        title={action?.kind === 'flatten' ? t('Emergency flatten') : action?.kind === 'close' ? t('Close position') : action?.kind === 'cancelAll' ? t('Cancel all orders') : t('Cancel order')}
        body={actionBody}
        danger
        onClose={() => setAction(null)}
        onConfirm={() => { if (action) run.mutate(action); }}
        confirmLabel={action?.kind === 'flatten' ? t('FLATTEN NOW') : action?.kind === 'close' ? t('Close position') : action?.kind === 'cancelAll' ? t('Cancel all') : t('Cancel order')}
      />
    </div>
  );
}
