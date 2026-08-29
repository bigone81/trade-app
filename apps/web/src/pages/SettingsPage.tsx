import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountPublic } from '@trade/shared';
import { api, json } from '../api';
import { clearChartViews, defaultPreferences, usePreferences } from '../preferences';
import { useUi } from '../store';

type NotificationSettings={marketAlerts:boolean;marketPreAlerts:boolean;tradingAccepted:boolean;tradingFilled:boolean;tradingPartial:boolean;tradingCancelled:boolean;tradingRejected:boolean;systemOffline:boolean;systemReconnect:boolean;telegramMarket:boolean;telegramTrading:boolean;telegramSystem:boolean;systemOfflineSeconds:number};

export default function SettingsPage() {
  const qc=useQueryClient();
  const { preferences, save } = usePreferences();
  const ui = useUi();
  const config = useQuery<{
    accounts: AccountPublic[];
    liveTradingEnabled: boolean;
    defaultSymbol: string;
    defaultTimeframe: string;
    telegramConfigured: boolean;
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

  const notificationSettings=useQuery<NotificationSettings>({queryKey:['notification-settings'],queryFn:()=>api('/api/notification-settings')});
  const saveNotifications=useMutation({
    mutationFn:(patch:Partial<NotificationSettings>)=>api<NotificationSettings>('/api/notification-settings',json('PUT',patch)),
    onSuccess:(data)=>qc.setQueryData(['notification-settings'],data),
  });
  const testNotification=useMutation({mutationFn:(telegram:boolean)=>api('/api/notifications/test',json('POST',{telegram})),onSuccess:()=>{void qc.invalidateQueries({queryKey:['notifications']});void qc.invalidateQueries({queryKey:['notification-count']});}});
  const patchNotification=(patch:Partial<NotificationSettings>)=>{
    if(!notificationSettings.data)return;
    saveNotifications.mutate(patch);
  };

  const accounts = config.data?.accounts || [];
  const exchangeGroups = useMemo(() => {
    const groups = new Map<string, AccountPublic[]>();
    for (const account of accounts) groups.set(account.exchange, [...(groups.get(account.exchange) || []), account]);
    return [...groups.entries()];
  }, [accounts]);

  return (
    <div className="page settings-page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Local interface preferences plus server/exchange status. API secrets never leave the server.</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="card settings-card">
          <h3>Appearance</h3>
          <div className="field">
            <label>Theme</label>
            <select className="select" value={preferences.theme} onChange={(e) => save({ ...preferences, theme: e.target.value as any })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <p className="muted settings-hint">Neutral chart controls use automatic contrast, so white objects do not disappear on a light background.</p>
        </section>

        <section className="card settings-card">
          <h3>Manual level</h3>
          <div className="field-grid">
            <div className="field">
              <label>Color</label>
              <select className="select" value={preferences.manualLevel.colorMode} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, colorMode: e.target.value as any } })}>
                <option value="auto">Auto contrast</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="field">
              <label>Custom color</label>
              <input className="input color-input" type="color" value={preferences.manualLevel.color} disabled={preferences.manualLevel.colorMode !== 'custom'} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, color: e.target.value } })} />
            </div>
          </div>
          <div className="field-grid">
            <div className="field">
              <label>Line style</label>
              <select className="select" value={preferences.manualLevel.style} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, style: e.target.value as any } })}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </div>
            <div className="field">
              <label>Width</label>
              <select className="select" value={preferences.manualLevel.width} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, width: Number(e.target.value) as 1 | 2 | 3 } })}>
                <option value={1}>1 px</option><option value={2}>2 px</option><option value={3}>3 px</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>Opacity · {Math.round(preferences.manualLevel.opacity * 100)}%</label>
            <input className="range" type="range" min="0.25" max="1" step="0.05" value={preferences.manualLevel.opacity} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, opacity: Number(e.target.value) } })} />
          </div>
          <label className="setting-check"><input type="checkbox" checked={preferences.manualLevel.showPriceLabel} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, showPriceLabel: e.target.checked } })} /> Show price label</label>
        </section>

        <section className="card settings-card">
          <h3>Risk / Reward</h3>
          <div className="field-grid">
            <div className="field"><label>Default target · R</label><input className="input" type="number" min="0.5" max="20" step="0.25" value={preferences.riskReward.defaultRatio} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,defaultRatio:Math.max(0.5,Number(e.target.value)||0.5)}})}/></div>
            <div className="field"><label>Default width · bars</label><input className="input" type="number" min="5" max="200" step="1" value={preferences.riskReward.defaultWidthBars} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,defaultWidthBars:Math.max(5,Math.min(200,Number(e.target.value)||30))}})}/></div>
          </div>
          <label className="setting-check"><input type="checkbox" checked={preferences.riskReward.snapToLevels} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,snapToLevels:e.target.checked}})}/> Snap Entry / Stop to nearby chart levels</label>
          <div className="field"><label>Snap distance · {preferences.riskReward.snapPixels}px</label><input className="range" type="range" min="3" max="18" step="1" value={preferences.riskReward.snapPixels} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,snapPixels:Number(e.target.value)}})}/></div>
          <p className="muted settings-hint">R/R is created with two clicks: Entry → Stop. Direction is detected automatically and Target is created at the default R multiple.</p>
        </section>

        <section className="card settings-card">
          <h3>Trading defaults</h3>
          <div className="field-grid">
            <div className="field">
              <label>Default risk · % equity</label>
              <input className="input" type="number" min="0" step="0.05" value={preferences.defaultRiskPercent} onChange={(e) => save({ ...preferences, defaultRiskPercent: Math.max(0, Number(e.target.value)) })} />
            </div>
            <div className="field">
              <label>Default account</label>
              <select className="select" value={preferences.defaultAccountId} onChange={(e) => save({ ...preferences, defaultAccountId: Number(e.target.value) })}>
                <option value={0}>First available account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.demo ? ' · demo' : ''}</option>)}
              </select>
            </div>
          </div>
          <div className="settings-subtitle">Risk override by account</div>
          {accounts.map((a) => {
            const value = preferences.accountRiskPercent[String(a.id)];
            return <div className="account-risk-row" key={a.id}>
              <span>{a.name}</span>
              <input className="input" type="number" min="0" step="0.05" placeholder={`${preferences.defaultRiskPercent}% default`} value={value ?? ''} onChange={(e) => {
                const raw = e.target.value;
                save({ ...preferences, accountRiskPercent: { ...preferences.accountRiskPercent, [String(a.id)]: raw === '' ? null : Math.max(0, Number(raw)) } });
              }} />
            </div>;
          })}
          <p className="muted settings-hint">These are calculator defaults only. You can change risk for an individual trade without changing the default.</p>
        </section>

        <section className="card settings-card">
          <h3>Market scanner</h3>
          <div className="field"><label>Minimum 24h turnover · ${ui.minTurnoverMillions}M</label><input className="range" type="range" min="0" max="1000" step="10" value={ui.minTurnoverMillions} onChange={(e)=>ui.setMinTurnoverMillions(Number(e.target.value))}/></div>
          <div className="field"><label>Automatic levels range · ±{ui.levelTolerancePercent}%</label><input className="range" type="range" min="0.5" max="100" step="0.5" value={ui.levelTolerancePercent} onChange={(e)=>ui.setLevelTolerancePercent(Number(e.target.value))}/></div>
          <p className="muted settings-hint">Scanner preferences are stored locally and are shared with the sliders on the Chart page.</p>
        </section>

        <section className="card settings-card">
          <h3>Chart</h3>
          <div className="field">
            <label>Future drawing space · {preferences.chart.futureBars} bars</label>
            <input className="range" type="range" min="8" max="80" step="1" value={preferences.chart.futureBars} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, futureBars: Number(e.target.value) } })} />
          </div>
          <label className="setting-check"><input type="checkbox" checked={preferences.chart.showGrid} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, showGrid: e.target.checked } })} /> Show grid</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.chart.showCurrentPriceLine} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, showCurrentPriceLine: e.target.checked } })} /> Show current price line</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.chart.autoFollowLive} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, autoFollowLive: e.target.checked } })} /> Follow live when already at the right edge</label>
          <button className="btn secondary" onClick={() => { clearChartViews(); alert('Saved chart positions were cleared.'); }}>Reset saved chart positions</button>
          <p className="muted settings-hint">Each symbol + timeframe remembers its own horizontal zoom and position in this browser.</p>
        </section>

        <section className="card settings-card trading-overlay-settings">
          <h3>Chart · Trading overlays</h3>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showOrders} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showOrders:e.target.checked}})}/> Show active orders</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showPositions} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showPositions:e.target.checked}})}/> Show open positions</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showStopLoss} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showStopLoss:e.target.checked}})}/> Show Stop Loss</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showTakeProfit} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showTakeProfit:e.target.checked}})}/> Show Take Profit</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showLiquidation} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showLiquidation:e.target.checked}})}/> Show liquidation price</label>

          <div className="settings-subtitle">Labels</div>
          <div className="field"><label>Label detail</label><select className="select" value={preferences.tradingOverlays.labelMode} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,labelMode:e.target.value as any}})}><option value="full">Full</option><option value="compact">Compact</option><option value="price">Price only</option></select></div>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showAccountName} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showAccountName:e.target.checked}})}/> Show account name</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showOrderSize} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showOrderSize:e.target.checked}})}/> Show order / position size</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showPnl} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showPnl:e.target.checked}})}/> Show unrealized PnL on position label</label>

          <div className="settings-subtitle">Lines</div>
          <div className="field-grid"><div className="field"><label>Width</label><select className="select" value={preferences.tradingOverlays.lineWidth} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,lineWidth:Number(e.target.value) as 1|2|3}})}><option value={1}>1 px</option><option value={2}>2 px</option><option value={3}>3 px</option></select></div><div className="field"><label>Opacity · {Math.round(preferences.tradingOverlays.opacity*100)}%</label><input className="range" type="range" min="0.3" max="1" step="0.05" value={preferences.tradingOverlays.opacity} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,opacity:Number(e.target.value)}})}/></div></div>
          <div className="field-grid"><div className="field"><label>Order</label><select className="select" value={preferences.tradingOverlays.orderStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,orderStyle:e.target.value as any}})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></div><div className="field"><label>Position</label><select className="select" value={preferences.tradingOverlays.positionStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,positionStyle:e.target.value as any}})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></div></div>
          <div className="field-grid"><div className="field"><label>Stop Loss</label><select className="select" value={preferences.tradingOverlays.stopStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,stopStyle:e.target.value as any}})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></div><div className="field"><label>Take Profit</label><select className="select" value={preferences.tradingOverlays.targetStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,targetStyle:e.target.value as any}})}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></div></div>

          <div className="settings-subtitle">Interaction</div>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.allowDragOrders} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,allowDragOrders:e.target.checked}})}/> Allow dragging pending order price</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.allowDragStops} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,allowDragStops:e.target.checked}})}/> Allow dragging Stop Loss</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.allowDragTargets} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,allowDragTargets:e.target.checked}})}/> Allow dragging Take Profit</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.confirmChanges} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,confirmChanges:e.target.checked}})}/> Confirm chart trading changes before sending to exchange</label>

          <div className="settings-subtitle">Accounts shown on chart</div>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.accountIds.length===0} onChange={(e)=>{if(e.target.checked)save({...preferences,tradingOverlays:{...preferences.tradingOverlays,accountIds:[]}})}}/> All accounts</label>
          {accounts.map((a)=>{const all=preferences.tradingOverlays.accountIds.length===0;const checked=all||preferences.tradingOverlays.accountIds.includes(a.id);return <label className="setting-check nested" key={`overlay-account-${a.id}`}><input type="checkbox" checked={checked} onChange={(e)=>{let ids=all?accounts.map(x=>x.id):[...preferences.tradingOverlays.accountIds];ids=e.target.checked?[...new Set([...ids,a.id])]:ids.filter(id=>id!==a.id);if(ids.length===accounts.length)ids=[];save({...preferences,tradingOverlays:{...preferences.tradingOverlays,accountIds:ids}})}}/> {a.name}{a.demo?' · demo':''}</label>})}
          <p className="muted settings-hint">Order/SL/TP lines come from the exchange and are separate from Manual Levels. Position Entry is read-only.</p>
        </section>

        <section className="card settings-card">
          <h3>Exchanges & accounts</h3>
          {exchangeGroups.map(([exchange, rows]) => <div key={exchange}>
            <div className="exchange-heading"><strong>{exchange.toUpperCase()}</strong><span>{rows.filter((a) => a.configured).length}/{rows.length} configured</span></div>
            {rows.map((a) => (
              <div className="kv" key={a.id}><span>{a.name}</span><b>#{a.id} · {a.market} · {a.configured ? 'configured' : 'no keys'} · {a.environment}</b></div>
            ))}
          </div>)}
          {!exchangeGroups.length && <div className="empty">No exchange accounts registered.</div>}
          <div className="exchange-placeholder">Accounts are loaded from the SQLite registry. Binance / OKX adapters can be added later without changing Chart, Journal or Calculator.</div>
        </section>

        <section className="card settings-card notifications-settings-card">
          <h3>Notifications</h3>
          <div className="kv"><span>Telegram</span><b className={config.data?.telegramConfigured?'positive':'warning-text'}>{config.data?.telegramConfigured?'connected':'not configured'}</b></div>
          {!notificationSettings.data?<p className="muted settings-hint">Loading notification preferences…</p>:<>
            <div className="settings-subtitle">Market</div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.marketAlerts} onChange={(e)=>patchNotification({marketAlerts:e.target.checked})}/> Level reached</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.marketPreAlerts} onChange={(e)=>patchNotification({marketPreAlerts:e.target.checked})}/> Pre-alert when approaching a level</label>
            <label className="setting-check nested"><input type="checkbox" checked={notificationSettings.data.telegramMarket} onChange={(e)=>patchNotification({telegramMarket:e.target.checked})}/> Send market notifications to Telegram</label>

            <div className="settings-subtitle">Trading</div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingAccepted} onChange={(e)=>patchNotification({tradingAccepted:e.target.checked})}/> Order accepted / New</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingFilled} onChange={(e)=>patchNotification({tradingFilled:e.target.checked})}/> Filled / TP / SL / close</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingPartial} onChange={(e)=>patchNotification({tradingPartial:e.target.checked})}/> Partial fill</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingCancelled} onChange={(e)=>patchNotification({tradingCancelled:e.target.checked})}/> Cancelled order</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingRejected} onChange={(e)=>patchNotification({tradingRejected:e.target.checked})}/> Rejected order</label>
            <label className="setting-check nested"><input type="checkbox" checked={notificationSettings.data.telegramTrading} onChange={(e)=>patchNotification({telegramTrading:e.target.checked})}/> Send trading notifications to Telegram</label>

            <div className="settings-subtitle">System</div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.systemOffline} onChange={(e)=>patchNotification({systemOffline:e.target.checked})}/> Connection offline</label>
            <div className="field"><label>Notify after · {notificationSettings.data.systemOfflineSeconds} sec</label><input className="range" type="range" min="10" max="180" step="10" value={notificationSettings.data.systemOfflineSeconds} onChange={(e)=>patchNotification({systemOfflineSeconds:Number(e.target.value)})}/></div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.systemReconnect} onChange={(e)=>patchNotification({systemReconnect:e.target.checked})}/> Notify when connection is restored</label>
            <label className="setting-check nested"><input type="checkbox" checked={notificationSettings.data.telegramSystem} onChange={(e)=>patchNotification({telegramSystem:e.target.checked})}/> Send system notifications to Telegram</label>
          </>}
          <div className="notification-test-actions"><button className="btn secondary" disabled={testNotification.isPending} onClick={()=>testNotification.mutate(false)}>Test in-app</button><button className="btn secondary" disabled={testNotification.isPending||!config.data?.telegramConfigured} onClick={()=>testNotification.mutate(true)}>Test Telegram</button></div>
          {saveNotifications.isPending&&<p className="muted settings-hint">Saving…</p>}
          {testNotification.isError&&<p className="inline-error">{testNotification.error instanceof Error?testNotification.error.message:'Notification test failed'}</p>}
          <p className="muted settings-hint">The bell in the top-right keeps an in-app history. Existing chart bells continue to define which price levels are monitored.</p>
        </section>

        <section className="card settings-card">
          <h3>Safety</h3>
          <div className="kv"><span>API health</span><b>{health.data?.status || '...'}</b></div>
          <div className="kv"><span>Trading actions</span><b className={config.data?.liveTradingEnabled ? 'negative' : 'positive'}>{config.data?.liveTradingEnabled ? 'ENABLED' : 'LOCKED'}</b></div>
          <div className="kv"><span>Default market</span><b>BYBIT · linear · {config.data?.defaultSymbol || '—'}</b></div>
          <p className="muted settings-hint">LIVE_TRADING_ENABLED is server-side and cannot be enabled from the browser.</p>
        </section>

        <section className="card settings-card settings-events">
          <h3>Recent system events</h3>
          {events.data?.map((e) => (
            <div className="kv" key={e.id}>
              <span>{e.created_at} · {e.event_type}{e.symbol ? ` · ${e.symbol}` : ''}</span>
              <b className={e.severity === 'error' ? 'negative' : e.severity === 'warning' ? 'warning-text' : ''}>{e.message}</b>
            </div>
          ))}
          {!events.data?.length && <div className="empty">No events yet.</div>}
        </section>

        <section className="card settings-card">
          <h3>Reset local preferences</h3>
          <p className="muted settings-hint">This resets theme, chart appearance and calculator defaults. Trading data in SQLite is not touched.</p>
          <button className="btn secondary" onClick={() => save(defaultPreferences)}>Restore defaults</button>
        </section>
      </div>
    </div>
  );
}
