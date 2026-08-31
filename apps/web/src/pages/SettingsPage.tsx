import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountPublic } from '@trade/shared';
import { api, json } from '../api';
import { clearChartViews, defaultPreferences, usePreferences } from '../preferences';
import { useUi } from '../store';
import { useI18n } from '../i18n';

type NotificationSettings={language:'en'|'uk'|'ru';marketAlerts:boolean;marketPreAlerts:boolean;tradingAccepted:boolean;tradingFilled:boolean;tradingPartial:boolean;tradingCancelled:boolean;tradingRejected:boolean;systemOffline:boolean;systemReconnect:boolean;telegramMarket:boolean;telegramTrading:boolean;telegramSystem:boolean;systemOfflineSeconds:number};

export default function SettingsPage() {
  const qc=useQueryClient();
  const { preferences, save } = usePreferences();
  const { t } = useI18n();
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
          <h1>{t('Settings')}</h1>
          <p>{preferences.language==='uk'?'Налаштування інтерфейсу та стан сервера/біржі. API-ключі не залишають сервер.':preferences.language==='ru'?'Настройки интерфейса и состояние сервера/биржи. API-ключи не покидают сервер.':'Local interface preferences plus server/exchange status. API secrets never leave the server.'}</p>
        </div>
      </div>

      <div className="settings-grid">
        <section className="card settings-card language-settings-card">
          <h3>{t('Language')}</h3>
          <div className="field">
            <label>{t('Interface language')}</label>
            <select className="select" value={preferences.language} onChange={(e)=>{const language=e.target.value as 'en'|'uk'|'ru';save({...preferences,language});saveNotifications.mutate({language});}}>
              <option value="en">English</option><option value="uk">Українська</option><option value="ru">Русский</option>
            </select>
          </div>
          <p className="muted settings-hint">{preferences.language==='uk'?'Мова застосовується одразу. Telegram-сповіщення також використовують цю мову.':preferences.language==='ru'?'Язык применяется сразу. Telegram-уведомления также используют этот язык.':'Language changes apply immediately. Telegram notifications use the same language.'}</p>
        </section>

        <section className="card settings-card">
          <h3>{t('Appearance')}</h3>
          <div className="field">
            <label>{t('Theme')}</label>
            <select className="select" value={preferences.theme} onChange={(e) => save({ ...preferences, theme: e.target.value as any })}>
              <option value="system">{t('System')}</option>
              <option value="light">{t('Light')}</option>
              <option value="dark">{t('Dark')}</option>
            </select>
          </div>
          <p className="muted settings-hint">{t('Neutral chart controls use automatic contrast, so white objects do not disappear on a light background.')}</p>
        </section>

        <section className="card settings-card">
          <h3>{t('Manual Levels')}</h3>
          <div className="field-grid">
            <div className="field">
              <label>{t('Color')}</label>
              <select className="select" value={preferences.manualLevel.colorMode} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, colorMode: e.target.value as any } })}>
                <option value="auto">{t('Auto contrast')}</option>
                <option value="custom">{t('Custom')}</option>
              </select>
            </div>
            <div className="field">
              <label>{t('Custom color')}</label>
              <input className="input color-input" type="color" value={preferences.manualLevel.color} disabled={preferences.manualLevel.colorMode !== 'custom'} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, color: e.target.value } })} />
            </div>
          </div>
          <div className="field-grid">
            <div className="field">
              <label>{preferences.language==='uk'?'Стиль лінії':preferences.language==='ru'?'Стиль линии':'Line style'}</label>
              <select className="select" value={preferences.manualLevel.style} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, style: e.target.value as any } })}>
                <option value="solid">{t('Solid')}</option>
                <option value="dashed">{t('Dashed')}</option>
                <option value="dotted">{t('Dotted')}</option>
              </select>
            </div>
            <div className="field">
              <label>{preferences.language==='uk'?'Товщина':preferences.language==='ru'?'Толщина':'Width'}</label>
              <select className="select" value={preferences.manualLevel.width} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, width: Number(e.target.value) as 1 | 2 | 3 } })}>
                <option value={1}>1 px</option><option value={2}>2 px</option><option value={3}>3 px</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>{t('Opacity')} · {Math.round(preferences.manualLevel.opacity * 100)}%</label>
            <input className="range" type="range" min="0.25" max="1" step="0.05" value={preferences.manualLevel.opacity} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, opacity: Number(e.target.value) } })} />
          </div>
          <label className="setting-check"><input type="checkbox" checked={preferences.manualLevel.showPriceLabel} onChange={(e) => save({ ...preferences, manualLevel: { ...preferences.manualLevel, showPriceLabel: e.target.checked } })} /> {t('Show price label')}</label>
        </section>

        <section className="card settings-card">
          <h3>{t('Risk / Reward')}</h3>
          <div className="field-grid">
            <div className="field"><label>{preferences.language==='uk'?'Цільовий R за замовчуванням':preferences.language==='ru'?'Целевой R по умолчанию':'Default target · R'}</label><input className="input" type="number" min="0.5" max="20" step="0.25" value={preferences.riskReward.defaultRatio} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,defaultRatio:Math.max(0.5,Number(e.target.value)||0.5)}})}/></div>
            <div className="field"><label>{t('Default width · bars')}</label><input className="input" type="number" min="5" max="200" step="1" value={preferences.riskReward.defaultWidthBars} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,defaultWidthBars:Math.max(5,Math.min(200,Number(e.target.value)||30))}})}/></div>
          </div>
          <label className="setting-check"><input type="checkbox" checked={preferences.riskReward.snapToLevels} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,snapToLevels:e.target.checked}})}/> {preferences.language==='uk'?'Прив’язувати Entry / Stop до сусідніх рівнів':preferences.language==='ru'?'Привязывать Entry / Stop к соседним уровням':'Snap Entry / Stop to nearby chart levels'}</label>
          <div className="field"><label>{t('Snap distance · px')} · {preferences.riskReward.snapPixels}px</label><input className="range" type="range" min="3" max="18" step="1" value={preferences.riskReward.snapPixels} onChange={(e)=>save({...preferences,riskReward:{...preferences.riskReward,snapPixels:Number(e.target.value)}})}/></div>
          <p className="muted settings-hint">{t('R/R is created with two clicks: Entry → Stop. Direction is detected automatically and Target is created at the default R multiple.')}</p>
        </section>

        <section className="card settings-card">
          <h3>{preferences.language==='uk'?'Торгові налаштування за замовчуванням':preferences.language==='ru'?'Торговые настройки по умолчанию':'Trading defaults'}</h3>
          <div className="field-grid">
            <div className="field">
              <label>{preferences.language==='uk'?'Ризик за замовчуванням · % equity':preferences.language==='ru'?'Риск по умолчанию · % equity':'Default risk · % equity'}</label>
              <input className="input" type="number" min="0" step="0.05" value={preferences.defaultRiskPercent} onChange={(e) => save({ ...preferences, defaultRiskPercent: Math.max(0, Number(e.target.value)) })} />
            </div>
            <div className="field">
              <label>{t('Default account')}</label>
              <select className="select" value={preferences.defaultAccountId} onChange={(e) => save({ ...preferences, defaultAccountId: Number(e.target.value) })}>
                <option value={0}>{t('First available account')}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.demo ? ' · demo' : ''}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>{preferences.language==='uk'?'База для розрахунку ризику':preferences.language==='ru'?'База для расчёта риска':'Risk sizing base'}</label>
            <select className="select" value={preferences.riskBase} onChange={(e)=>save({...preferences,riskBase:e.target.value as 'equity'|'wallet'|'fixed'})}>
              <option value="equity">{preferences.language==='uk'?'Equity акаунта':preferences.language==='ru'?'Equity аккаунта':'Account equity'}</option>
              <option value="wallet">{preferences.language==='uk'?'Wallet balance':preferences.language==='ru'?'Wallet balance':'Wallet balance'}</option>
              <option value="fixed">{preferences.language==='uk'?'Фіксований розмір акаунта':preferences.language==='ru'?'Фиксированный размер счёта':'Fixed account size'}</option>
            </select>
          </div>
          <div className="settings-subtitle">{preferences.language==='uk'?'Ризик окремо для акаунтів':preferences.language==='ru'?'Риск отдельно для аккаунтов':'Risk override by account'}</div>
          {accounts.map((a) => {
            const value = preferences.accountRiskPercent[String(a.id)];
            const fixed = preferences.fixedAccountSize[String(a.id)];
            return <div className="account-risk-row account-risk-row-wide" key={a.id}>
              <span>{a.name}</span>
              <input className="input" type="number" min="0" step="0.05" placeholder={`${preferences.defaultRiskPercent}% ${preferences.language==='uk'?'типово':preferences.language==='ru'?'по умолчанию':'default'}`} value={value ?? ''} onChange={(e) => {
                const raw = e.target.value;
                save({ ...preferences, accountRiskPercent: { ...preferences.accountRiskPercent, [String(a.id)]: raw === '' ? null : Math.max(0, Number(raw)) } });
              }} />
              {preferences.riskBase==='fixed'&&<input className="input" type="number" min="0" step="100" placeholder={preferences.language==='uk'?'Розмір $':preferences.language==='ru'?'Размер $':'Size $'} value={fixed ?? ''} onChange={(e)=>{const raw=e.target.value;save({...preferences,fixedAccountSize:{...preferences.fixedAccountSize,[String(a.id)]:raw===''?null:Math.max(0,Number(raw))}})}}/>}
            </div>;
          })}
          <p className="muted settings-hint">{preferences.language==='uk'?'Вибране значення — типове для калькулятора. У мультиакаунтному ордері ризик і розмір позиції рахуються окремо для кожного акаунта.':preferences.language==='ru'?'Выбранные значения — настройки калькулятора по умолчанию. В мультиаккаунтном ордере риск и размер позиции считаются отдельно для каждого аккаунта.':'These are calculator defaults. Multi-account orders calculate risk and position size separately for every account.'}</p>
        </section>

        <section className="card settings-card">
          <h3>{preferences.language==='uk'?'Сканер ринку':preferences.language==='ru'?'Сканер рынка':'Market scanner'}</h3>
          <div className="field"><label>{t('Min 24h turnover')} · ${ui.minTurnoverMillions}M</label><input className="range" type="range" min="0" max="1000" step="10" value={ui.minTurnoverMillions} onChange={(e)=>ui.setMinTurnoverMillions(Number(e.target.value))}/></div>
          <div className="field"><label>{preferences.language==='uk'?'Діапазон автоматичних рівнів':preferences.language==='ru'?'Диапазон автоматических уровней':'Automatic levels range'} · ±{ui.levelTolerancePercent}%</label><input className="range" type="range" min="0.5" max="100" step="0.5" value={ui.levelTolerancePercent} onChange={(e)=>ui.setLevelTolerancePercent(Number(e.target.value))}/></div>
          <div className="field">
            <label>{preferences.language==='uk'?'Історія для автоматичних рівнів':preferences.language==='ru'?'История для автоматических уровней':'Automatic levels history'}</label>
            <select className="select" value={preferences.autoLevels.lookbackDays} onChange={(e)=>save({...preferences,autoLevels:{...preferences.autoLevels,lookbackDays:Number(e.target.value) as 30|60|90|180}})}>
              <option value={30}>30 {preferences.language==='uk'?'днів':preferences.language==='ru'?'дней':'days'}</option>
              <option value={60}>60 {preferences.language==='uk'?'днів':preferences.language==='ru'?'дней':'days'}</option>
              <option value={90}>90 {preferences.language==='uk'?'днів':preferences.language==='ru'?'дней':'days'}</option>
              <option value={180}>180 {preferences.language==='uk'?'днів':preferences.language==='ru'?'дней':'days'}</option>
            </select>
          </div>
          <p className="muted settings-hint">{preferences.language==='uk'?'Авторівні завжди рахуються лише з денних свічок. Сила рівня враховує кількість реакцій, щільність цін, давність останнього торкання та тривалість життя рівня.':preferences.language==='ru'?'Автоуровни всегда считаются только по дневным свечам. Сила уровня учитывает число реакций, плотность цен, давность последнего касания и длительность жизни уровня.':'Automatic levels are always calculated from daily candles only. Strength uses reaction count, price compactness, recency and how long the level has persisted.'}</p>
          <p className="muted settings-hint">{t('Scanner preferences are stored locally and are shared with the sliders on the Chart page.')}</p>
        </section>

        <section className="card settings-card">
          <h3>{t('Chart')}</h3>
          <div className="field">
            <label>{t('Future space · bars')} · {preferences.chart.futureBars}</label>
            <input className="range" type="range" min="8" max="80" step="1" value={preferences.chart.futureBars} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, futureBars: Number(e.target.value) } })} />
          </div>
          <label className="setting-check"><input type="checkbox" checked={preferences.chart.showGrid} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, showGrid: e.target.checked } })} /> {t('Show grid')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.chart.showCurrentPriceLine} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, showCurrentPriceLine: e.target.checked } })} /> {t('Show current price line')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.chart.autoFollowLive} onChange={(e) => save({ ...preferences, chart: { ...preferences.chart, autoFollowLive: e.target.checked } })} /> {t('Follow live when already at the right edge')}</label>
          <button className="btn secondary" onClick={() => { clearChartViews(); alert(preferences.language==='uk'?'Збережені позиції графіків очищено.':preferences.language==='ru'?'Сохранённые позиции графиков очищены.':'Saved chart positions were cleared.'); }}>{t('Reset saved chart positions')}</button>
          <p className="muted settings-hint">{t('Each symbol + timeframe remembers its own horizontal zoom and position in this browser.')}</p>
        </section>

        <section className="card settings-card trading-overlay-settings">
          <h3>{t('Chart')} · {t('Trading overlays')}</h3>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showOrders} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showOrders:e.target.checked}})}/> {t('Show active orders')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showPositions} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showPositions:e.target.checked}})}/> {t('Show open positions')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showStopLoss} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showStopLoss:e.target.checked}})}/> {t('Show Stop Loss')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showTakeProfit} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showTakeProfit:e.target.checked}})}/> {t('Show Take Profit')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showLiquidation} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showLiquidation:e.target.checked}})}/> {t('Show liquidation price')}</label>

          <div className="settings-subtitle">{t('Labels')}</div>
          <div className="field"><label>{t('Label detail')}</label><select className="select" value={preferences.tradingOverlays.labelMode} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,labelMode:e.target.value as any}})}><option value="full">{t('Full')}</option><option value="compact">{t('Compact')}</option><option value="price">{t('Price only')}</option></select></div>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showAccountName} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showAccountName:e.target.checked}})}/> {t('Show account name')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showOrderSize} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showOrderSize:e.target.checked}})}/> {t('Show order / position size')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.showPnl} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,showPnl:e.target.checked}})}/> {t('Show unrealized PnL on position label')}</label>

          <div className="settings-subtitle">{t('Lines')}</div>
          <div className="field-grid"><div className="field"><label>{preferences.language==='uk'?'Товщина':preferences.language==='ru'?'Толщина':'Width'}</label><select className="select" value={preferences.tradingOverlays.lineWidth} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,lineWidth:Number(e.target.value) as 1|2|3}})}><option value={1}>1 px</option><option value={2}>2 px</option><option value={3}>3 px</option></select></div><div className="field"><label>Opacity · {Math.round(preferences.tradingOverlays.opacity*100)}%</label><input className="range" type="range" min="0.3" max="1" step="0.05" value={preferences.tradingOverlays.opacity} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,opacity:Number(e.target.value)}})}/></div></div>
          <div className="field-grid"><div className="field"><label>{t('Order')}</label><select className="select" value={preferences.tradingOverlays.orderStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,orderStyle:e.target.value as any}})}><option value="solid">{t('Solid')}</option><option value="dashed">{t('Dashed')}</option><option value="dotted">{t('Dotted')}</option></select></div><div className="field"><label>{t('Position')}</label><select className="select" value={preferences.tradingOverlays.positionStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,positionStyle:e.target.value as any}})}><option value="solid">{t('Solid')}</option><option value="dashed">{t('Dashed')}</option><option value="dotted">{t('Dotted')}</option></select></div></div>
          <div className="field-grid"><div className="field"><label>Stop Loss</label><select className="select" value={preferences.tradingOverlays.stopStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,stopStyle:e.target.value as any}})}><option value="solid">{t('Solid')}</option><option value="dashed">{t('Dashed')}</option><option value="dotted">{t('Dotted')}</option></select></div><div className="field"><label>Take Profit</label><select className="select" value={preferences.tradingOverlays.targetStyle} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,targetStyle:e.target.value as any}})}><option value="solid">{t('Solid')}</option><option value="dashed">{t('Dashed')}</option><option value="dotted">{t('Dotted')}</option></select></div></div>

          <div className="settings-subtitle">{t('Interaction')}</div>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.allowDragOrders} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,allowDragOrders:e.target.checked}})}/> {t('Allow dragging pending order price')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.allowDragStops} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,allowDragStops:e.target.checked}})}/> {t('Allow dragging Stop Loss')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.allowDragTargets} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,allowDragTargets:e.target.checked}})}/> {t('Allow dragging Take Profit')}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.confirmChanges} onChange={(e)=>save({...preferences,tradingOverlays:{...preferences.tradingOverlays,confirmChanges:e.target.checked}})}/> {t('Confirm chart trading changes before sending to exchange')}</label>

          <div className="settings-subtitle">{t('Accounts shown on chart')}</div>
          <label className="setting-check"><input type="checkbox" checked={preferences.tradingOverlays.accountIds.length===0} onChange={(e)=>{if(e.target.checked)save({...preferences,tradingOverlays:{...preferences.tradingOverlays,accountIds:[]}})}}/> {t('All accounts')}</label>
          {accounts.map((a)=>{const all=preferences.tradingOverlays.accountIds.length===0;const checked=all||preferences.tradingOverlays.accountIds.includes(a.id);return <label className="setting-check nested" key={`overlay-account-${a.id}`}><input type="checkbox" checked={checked} onChange={(e)=>{let ids=all?accounts.map(x=>x.id):[...preferences.tradingOverlays.accountIds];ids=e.target.checked?[...new Set([...ids,a.id])]:ids.filter(id=>id!==a.id);if(ids.length===accounts.length)ids=[];save({...preferences,tradingOverlays:{...preferences.tradingOverlays,accountIds:ids}})}}/> {a.name}{a.demo?' · demo':''}</label>})}
          <p className="muted settings-hint">{t('Order/SL/TP lines come from the exchange and are separate from Manual Levels. Position Entry is read-only.')}</p>
        </section>

        <section className="card settings-card">
          <h3>{preferences.language==='uk'?'Щоденник':preferences.language==='ru'?'Журнал':'Journal'}</h3>
          <div className="field">
            <label>{preferences.language==='uk'?'Угод на сторінці':preferences.language==='ru'?'Сделок на странице':'Trades per page'}</label>
            <select className="select" value={preferences.journal.pageSize} onChange={(e)=>save({...preferences,journal:{...preferences.journal,pageSize:Number(e.target.value) as 25|50|100|200}})}>
              <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={200}>200</option>
            </select>
          </div>
          <label className="setting-check"><input type="checkbox" checked={preferences.journal.rememberFilters} onChange={(e)=>save({...preferences,journal:{...preferences.journal,rememberFilters:e.target.checked}})}/> {preferences.language==='uk'?'Запам’ятовувати фільтри та сортування':preferences.language==='ru'?'Запоминать фильтры и сортировку':'Remember filters and sorting'}</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.journal.rememberPage} onChange={(e)=>save({...preferences,journal:{...preferences.journal,rememberPage:e.target.checked}})}/> {preferences.language==='uk'?'Запам’ятовувати останню сторінку':preferences.language==='ru'?'Запоминать последнюю страницу':'Remember last page'}</label>
          <div className="settings-subtitle">{preferences.language==='uk'?'Автоматичні знімки графіка':preferences.language==='ru'?'Автоматические снимки графика':'Automatic chart snapshots'}</div>
          <label className="setting-check"><input type="checkbox" checked={preferences.journal.snapshot5m} onChange={(e)=>save({...preferences,journal:{...preferences.journal,snapshot5m:e.target.checked}})}/> 5m</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.journal.snapshot1h} onChange={(e)=>save({...preferences,journal:{...preferences.journal,snapshot1h:e.target.checked}})}/> 1H</label>
          <label className="setting-check"><input type="checkbox" checked={preferences.journal.snapshot1d} onChange={(e)=>save({...preferences,journal:{...preferences.journal,snapshot1d:e.target.checked}})}/> 1D</label>
          <p className="muted settings-hint">{preferences.language==='uk'?'Нові угоди починаються з результатом BE / 0R. Результат R заповнюється лише вручну. Знімки включають бари, авто/ручні рівні, alerts, R/R та Entry/SL/TP угоди.':preferences.language==='ru'?'Новые сделки начинаются с результата BE / 0R. Результат R заполняется только вручную. Снимки включают бары, авто/ручные уровни, alerts, R/R и Entry/SL/TP сделки.':'New trades start at BE / 0R. Result R is manual-only. Snapshots include bars, auto/manual levels, alerts, R/R and the trade Entry/SL/TP.'}</p>
        </section>

        <section className="card settings-card">
          <h3>{t('Exchanges & accounts')}</h3>
          {exchangeGroups.map(([exchange, rows]) => <div key={exchange}>
            <div className="exchange-heading"><strong>{exchange.toUpperCase()}</strong><span>{rows.filter((a) => a.configured).length}/{rows.length} {t('configured')}</span></div>
            {rows.map((a) => (
              <div className="kv" key={a.id}><span>{a.name}</span><b>#{a.id} · {a.market} · {a.configured ? t('configured') : t('no keys')} · {a.environment}</b></div>
            ))}
          </div>)}
          {!exchangeGroups.length && <div className="empty">{t('No exchange accounts registered.')}</div>}
          <div className="exchange-placeholder">{preferences.language==='uk'?'Акаунти завантажуються тільки з BYBIT_ACCOUNT<N>_* у .env. Щоб додати або прибрати акаунт, змініть .env і пересоздайте контейнери.':preferences.language==='ru'?'Аккаунты загружаются только из BYBIT_ACCOUNT<N>_* в .env. Чтобы добавить или убрать аккаунт, измените .env и пересоздайте контейнеры.':'Accounts are loaded only from BYBIT_ACCOUNT<N>_* in .env. Add/remove an account by changing .env and recreating the containers.'}</div>
        </section>

        <section className="card settings-card notifications-settings-card">
          <h3>{t('Notifications')}</h3>
          <div className="kv"><span>Telegram</span><b className={config.data?.telegramConfigured?'positive':'warning-text'}>{config.data?.telegramConfigured?t('connected'):t('not configured')}</b></div>
          {!notificationSettings.data?<p className="muted settings-hint">{t('Loading notification preferences…')}</p>:<>
            <div className="settings-subtitle">{preferences.language==='uk'?'Ринок':preferences.language==='ru'?'Рынок':'Market'}</div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.marketAlerts} onChange={(e)=>patchNotification({marketAlerts:e.target.checked})}/> {t('Level reached')}</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.marketPreAlerts} onChange={(e)=>patchNotification({marketPreAlerts:e.target.checked})}/> {t('Pre-alert when approaching a level')}</label>
            <label className="setting-check nested"><input type="checkbox" checked={notificationSettings.data.telegramMarket} onChange={(e)=>patchNotification({telegramMarket:e.target.checked})}/> {t('Send market notifications to Telegram')}</label>

            <div className="settings-subtitle">{t('Trading')}</div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingAccepted} onChange={(e)=>patchNotification({tradingAccepted:e.target.checked})}/> {t('Order accepted / New')}</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingFilled} onChange={(e)=>patchNotification({tradingFilled:e.target.checked})}/> {t('Filled / TP / SL / close')}</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingPartial} onChange={(e)=>patchNotification({tradingPartial:e.target.checked})}/> {t('Partial fill')}</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingCancelled} onChange={(e)=>patchNotification({tradingCancelled:e.target.checked})}/> {t('Cancelled order')}</label>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.tradingRejected} onChange={(e)=>patchNotification({tradingRejected:e.target.checked})}/> {t('Rejected order')}</label>
            <label className="setting-check nested"><input type="checkbox" checked={notificationSettings.data.telegramTrading} onChange={(e)=>patchNotification({telegramTrading:e.target.checked})}/> {t('Send trading notifications to Telegram')}</label>

            <div className="settings-subtitle">{t('System')}</div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.systemOffline} onChange={(e)=>patchNotification({systemOffline:e.target.checked})}/> {t('Connection offline')}</label>
            <div className="field"><label>{t('Notify after · {seconds} sec',{seconds:notificationSettings.data.systemOfflineSeconds})}</label><input className="range" type="range" min="10" max="180" step="10" value={notificationSettings.data.systemOfflineSeconds} onChange={(e)=>patchNotification({systemOfflineSeconds:Number(e.target.value)})}/></div>
            <label className="setting-check"><input type="checkbox" checked={notificationSettings.data.systemReconnect} onChange={(e)=>patchNotification({systemReconnect:e.target.checked})}/> {t('Notify when connection is restored')}</label>
            <label className="setting-check nested"><input type="checkbox" checked={notificationSettings.data.telegramSystem} onChange={(e)=>patchNotification({telegramSystem:e.target.checked})}/> {t('Send system notifications to Telegram')}</label>
          </>}
          <div className="notification-test-actions"><button className="btn secondary" disabled={testNotification.isPending} onClick={()=>testNotification.mutate(false)}>{t('Test in-app')}</button><button className="btn secondary" disabled={testNotification.isPending||!config.data?.telegramConfigured} onClick={()=>testNotification.mutate(true)}>{t('Test Telegram')}</button></div>
          {saveNotifications.isPending&&<p className="muted settings-hint">{t('Saving…')}</p>}
          {testNotification.isError&&<p className="inline-error">{testNotification.error instanceof Error?testNotification.error.message:t('Notification test failed')}</p>}
          <p className="muted settings-hint">{t('The bell in the top-right keeps an in-app history. Existing chart bells continue to define which price levels are monitored.')}</p>
        </section>

        <section className="card settings-card">
          <h3>{t('Safety')}</h3>
          <div className="kv"><span>{t('API health')}</span><b>{health.data?.status || '...'}</b></div>
          <div className="kv"><span>{t('Trading actions')}</span><b className={config.data?.liveTradingEnabled ? 'negative' : 'positive'}>{config.data?.liveTradingEnabled ? t('ENABLED') : t('LOCKED')}</b></div>
          <div className="kv"><span>{t('Default market')}</span><b>BYBIT · linear · {config.data?.defaultSymbol || '—'}</b></div>
          <p className="muted settings-hint">{t('LIVE_TRADING_ENABLED is server-side and cannot be enabled from the browser.')}</p>
        </section>

        <section className="card settings-card settings-events">
          <h3>{t('Recent system events')}</h3>
          {events.data?.map((e) => (
            <div className="kv" key={e.id}>
              <span>{e.created_at} · {e.event_type}{e.symbol ? ` · ${e.symbol}` : ''}</span>
              <b className={e.severity === 'error' ? 'negative' : e.severity === 'warning' ? 'warning-text' : ''}>{e.message}</b>
            </div>
          ))}
          {!events.data?.length && <div className="empty">{t('No events yet.')}</div>}
        </section>

        <section className="card settings-card">
          <h3>{t('Reset local preferences')}</h3>
          <p className="muted settings-hint">{t('This resets theme, chart appearance and calculator defaults. Trading data in SQLite is not touched.')}</p>
          <button className="btn secondary" onClick={() => save(defaultPreferences)}>{t('Restore defaults')}</button>
        </section>
      </div>
    </div>
  );
}
