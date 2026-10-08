import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowUpRight, ListChecks, Radar, Settings2, Trash2 } from 'lucide-react';
import { marketNumericBounds, type MarketMonitorSettings, type MarketMonitorStatus, type MarketNumericKey, type MarketObservation, type MarketSignal, type MarketSymbol } from '@trade/shared';
import { validateMarketSettings } from '@trade/domain';
import { api, json } from '../api';
import { useI18n } from '../i18n';
import { marketLabel, marketNumber as num, marketDate, marketChartUrl, marketFeedPage, marketFeedPageSize, marketSettingsIssue } from '../marketMonitorPresentation';

const base = '/api/market-monitor';
const simpleSettings: MarketNumericKey[] = ['minTurnover', 'maxAutoSymbols', 'cooldownMinutes'];

function Checklist({ observation: o }: { observation: MarketObservation }) {
  const { t, language } = useI18n();
  return <div className="mm-checklist">
    {o.scores.conflict && <p className="warning-text">MIXED / CONFLICTING · {t('Score difference is too small for a directional alert.')}</p>}
    <div className="mm-scores">{(['Approach', 'Breakout', 'Rejection'] as const).map(group => <div className="metric" key={group}><small>{t(group)}</small><strong>{o.scores[group.toLowerCase() as 'approach' | 'breakout' | 'rejection']}</strong></div>)}</div>
    <p className="muted">{t('A dash means the feature was not confirmed; missing measurements are not zero.')}</p>
    <div className="mm-table-wrap"><table className="data-table"><thead><tr><th>{t('Feature')}</th><th>{t('Value')}</th><th>{t('Approach')}</th><th>{t('Breakout')}</th><th>{t('Rejection')}</th></tr></thead><tbody>
      {o.features.map(f => <tr key={f.key} className={f.detected ? '' : 'muted'}><td><span aria-label={t(f.detected ? 'Confirmed' : 'Not confirmed')}>{f.detected ? '✓' : '—'}</span> {marketLabel(f.key, language)}</td><td>{num(f.value, 3)}{f.details && <small className="mm-detail">{Object.entries(f.details).map(([k, v]) => `${marketLabel(k, language)}: ${typeof v === 'number' ? num(v, 3) : typeof v === 'boolean' ? t(v ? 'Yes' : 'No') : String(v)}`).join(' · ')}</small>}</td><td>{f.scoreApproach || '—'}</td><td>{f.scoreBreakout || '—'}</td><td>{f.scoreRejection || '—'}</td></tr>)}
    </tbody></table></div>
    <details><summary>{t('Measurements and level cluster')}</summary><div className="mm-metrics">{Object.entries(o.metrics).map(([key, value]) => <div key={key}><small>{marketLabel(key, language)}</small><strong>{key === 'lastTouchAt' ? marketDate(value, language) : num(value, 4)}</strong></div>)}</div>
      <p>{o.cluster.types.map(type => marketLabel(type, language)).join(' + ')} · {t('Auto touches')}: {o.cluster.autoTouches} · {t('Strength')}: {num(o.cluster.autoStrength)}</p>
      {o.cluster.members.map(m => <div key={m.id}>{marketLabel(m.type, language)} · {num(m.price, 8)} · {m.dates.join(', ')}</div>)}
    </details>
  </div>;
}

function ChecklistDialog({ observation, onClose }: { observation: MarketObservation; onClose: () => void }) {
  const { t, language } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={ref} className="card mm-dialog" aria-labelledby="mm-checklist-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <div className="page-head"><h2 id="mm-checklist-title">{observation.symbol} · {num(observation.cluster.price, 8)}</h2><button autoFocus className="btn secondary" onClick={onClose}>{t('Close')}</button></div>
    <p className="muted">{t('Observation time')}: {marketDate(observation.barTime + 300, language)}</p>
    <Link to={marketChartUrl(observation.symbol, observation.cluster.price)}>{t('Open chart')} ↗</Link>
    <Checklist observation={observation}/>
  </dialog>;
}

function SettingsForm({ initial }: { initial: MarketMonitorSettings }) {
  const { t, language } = useI18n(), qc = useQueryClient();
  const [settings, setSettings] = useState(initial), [symbol, setSymbol] = useState(''), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false), [invalidField, setInvalidField] = useState<string | null>(null), [advanced, setAdvanced] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => { if (!dirty) setSettings(initial); }, [initial, dirty]);
  useEffect(() => {
    if (!invalidField) return;
    form.current?.querySelector<HTMLInputElement>(`[name="${invalidField}"]`)?.focus();
  }, [invalidField, advanced]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const watchlist = useQuery<{ symbol: string; enabled: boolean }[]>({ queryKey: ['mm-watchlist'], queryFn: () => api(`${base}/watchlist`) });
  const save = useMutation({ mutationFn: () => api<MarketMonitorSettings>(`${base}/settings`, json('PUT', validateMarketSettings(settings))), onSuccess: next => { qc.setQueryData(['mm-settings'], next); setSettings(next); setDirty(false); setSaved(true); setError(''); setInvalidField(null); void qc.invalidateQueries({ queryKey: ['mm-status'] }); }, onError: e => setError(e.message) });
  const watch = useMutation({ mutationFn: (data: { symbol: string; enabled?: boolean; remove?: boolean }) => data.remove ? api(`${base}/watchlist/${encodeURIComponent(data.symbol)}`, { method: 'DELETE' }) : api(`${base}/watchlist`, json('POST', data)), onSuccess: (_, variables) => { if (!variables.remove && variables.enabled === undefined) setSymbol(current => current === variables.symbol ? '' : current); void qc.invalidateQueries({ queryKey: ['mm-watchlist'] }); } });
  const update = <K extends keyof MarketMonitorSettings>(key: K, value: MarketMonitorSettings[K]) => { setSettings(s => ({ ...s, [key]: value })); setDirty(true); setSaved(false); setError(''); setInvalidField(null); };
  const numeric = (key: MarketNumericKey) => <label className="field" key={key}><span>{marketLabel(key, language)}</span><input name={key} aria-invalid={invalidField === key} aria-describedby={invalidField === key ? 'mm-settings-error' : undefined} className="input" type="number" min={marketNumericBounds[key][0]} max={marketNumericBounds[key][1]} step={marketNumericBounds[key][2] ? 1 : 'any'} required value={Number.isNaN(settings[key]) ? '' : settings[key]} onChange={e => update(key, e.target.value === '' ? NaN : Number(e.target.value))}/></label>;
  const submit = () => {
    const issue = marketSettingsIssue(settings);
    if (issue) { setError(`${marketLabel(issue.key, language)}: ${t(issue.message, { min: issue.min ?? 0, max: issue.max ?? 0 })}`); setInvalidField(issue.key); if (!simpleSettings.includes(issue.key)) setAdvanced(true); return; }
    for (const group of ['approach', 'breakout', 'rejection'] as const) for (const [key, value] of Object.entries(settings.scoreWeights[group])) {
      if (!Number.isFinite(value) || value < 0 || value > 20) { setError(`${marketLabel(key, language)}: ${t('Enter a number from {min} to {max}.', { min: 0, max: 20 })}`); setInvalidField(`${group}-${key}`); setAdvanced(true); return; }
    }
    save.mutate();
  };
  return <div className="mm-settings"><form ref={form} noValidate onSubmit={e => { e.preventDefault(); submit(); }}>
    <fieldset className="mm-form-fields" disabled={save.isPending}>
    <legend className="mm-sr-only">{t('Settings')}</legend>
    <div className="mm-form-grid">
      {(['enabled', 'alwaysMonitorManualLevels', 'telegramEnabled'] as const).map(key => <label className="setting-check" key={key}><input type="checkbox" checked={settings[key]} onChange={e => update(key, e.target.checked)}/>{t(key === 'enabled' ? 'Market Monitor enabled' : key === 'alwaysMonitorManualLevels' ? 'Always monitor manual levels' : 'Telegram enabled')}</label>)}
      <label className="field"><span>{t('Universe mode')}</span><select className="select" value={settings.universeMode} onChange={e => update('universeMode', e.target.value as MarketMonitorSettings['universeMode'])}>{['AUTO', 'WATCHLIST', 'HYBRID'].map(x => <option key={x}>{x}</option>)}</select></label>
      {simpleSettings.map(numeric)}
      <label className="field"><span>{t('Min Telegram priority')}</span><select className="select" value={settings.minPriority} onChange={e => update('minPriority', e.target.value as MarketMonitorSettings['minPriority'])}>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(x => <option key={x}>{x}</option>)}</select></label>
    </div>
    <p className="muted">{t('Telegram also follows the global market notification setting. Analysis runs after each closed M5 bar.')}</p>
    <details className="mm-advanced" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary><Settings2 size={15}/> {t('Advanced settings')}</summary><div className="mm-form-grid">{(Object.keys(marketNumericBounds) as MarketNumericKey[]).filter(key => !simpleSettings.includes(key)).map(numeric)}</div>
      <h3>{t('Score weights')}</h3><div className="mm-form-grid">{(['approach', 'breakout', 'rejection'] as const).map(group => <fieldset key={group}><legend>{t(group === 'approach' ? 'Approach' : group === 'breakout' ? 'Breakout' : 'Rejection')}</legend>{Object.entries(settings.scoreWeights[group]).map(([key, value]) => <label className="mm-weight" key={key}><span>{marketLabel(key, language)}</span><input name={`${group}-${key}`} aria-invalid={invalidField === `${group}-${key}`} aria-describedby={invalidField === `${group}-${key}` ? 'mm-settings-error' : undefined} className="input" type="number" min={0} max={20} step="any" required value={Number.isNaN(value) ? '' : value} onChange={e => update('scoreWeights', { ...settings.scoreWeights, [group]: { ...settings.scoreWeights[group], [key]: e.target.value === '' ? NaN : Number(e.target.value) } })}/></label>)}</fieldset>)}</div>
    </details>
    </fieldset>
    <div className="mm-save-bar"><button type="submit" className="btn primary" disabled={save.isPending}>{save.isPending ? t('Saving…') : t('Save settings')}</button>{dirty && <span className="warning-text">{t('Unsaved changes')}</span>}{saved && <span role="status" className="positive"> ✓ {t('Saved')}</span>}</div>
    {error && <p id="mm-settings-error" role="alert" className="negative">{error}</p>}
  </form>
  <div className="mm-watchlist"><h3>Watchlist</h3><form className="top-controls" onSubmit={e => { e.preventDefault(); watch.mutate({ symbol }); }}><input className="input" aria-label={t('Watchlist symbol')} placeholder="BTCUSDT" value={symbol} pattern="[A-Za-z0-9]{2,26}[Uu][Ss][Dd][Tt]" required onChange={e => setSymbol(e.target.value.toUpperCase().trim())}/><button className="btn secondary" disabled={watch.isPending}>{t('Add')}</button></form>
    <p className="muted">{t('Only active Bybit USDT perpetual contracts enter the universe. Changes apply on the next scan.')}</p>
    {watchlist.data?.map(row => <div className="mm-watch-row" key={row.symbol}><label><input type="checkbox" checked={row.enabled} disabled={watch.isPending} onChange={e => watch.mutate({ symbol: row.symbol, enabled: e.target.checked })}/> {row.symbol}</label><button className="icon-btn" aria-label={`${t('Delete')} ${row.symbol}`} disabled={watch.isPending} onClick={() => watch.mutate({ symbol: row.symbol, remove: true })}><Trash2 size={14}/></button></div>)}
    {watchlist.isPending && <p role="status">{t('Loading…')}</p>}
    {!watchlist.isPending && !watchlist.error && !watchlist.data?.length && <p className="muted">{t('Watchlist is empty.')}</p>}
    {(watchlist.error || watch.error) && <p role="alert" className="negative">{watchlist.error?.message || watch.error?.message}</p>}
  </div></div>;
}

export default function MarketMonitorPage() {
  const { t, language } = useI18n(), navigate = useNavigate();
  const [tab, setTab] = useState<'live' | 'feed' | 'settings'>('live');
  const [selected, setSelected] = useState<MarketObservation | null>(null);
  const [cursors, setCursors] = useState<(number | undefined)[]>([undefined]);
  const [signalsOnly, setSignalsOnly] = useState(true), [filter, setFilter] = useState('');
  const before = cursors.at(-1);
  const status = useQuery<MarketMonitorStatus>({ queryKey: ['mm-status'], queryFn: () => api(`${base}/status`), refetchInterval: 5000 });
  const symbols = useQuery<MarketSymbol[]>({ queryKey: ['mm-symbols'], queryFn: () => api(`${base}/symbols`), refetchInterval: 10000 });
  const settings = useQuery<MarketMonitorSettings>({ queryKey: ['mm-settings'], queryFn: () => api(`${base}/settings`) });
  const feed = useQuery<MarketSignal[]>({ queryKey: ['mm-feed', before, signalsOnly], queryFn: () => api(`${base}/signals?limit=${marketFeedPageSize + 1}&signalsOnly=${signalsOnly}${before ? `&before=${before}` : ''}`), refetchInterval: before ? false : 10000, enabled: tab === 'feed' });
  const s = status.data, page = marketFeedPage(feed.data ?? []);
  const visibleSymbols = symbols.data?.filter(row => row.symbol.includes(filter.trim().toUpperCase())) ?? [];
  const date = (value: string | number | null | undefined) => marketDate(value, language);
  const currentError = tab === 'live' ? symbols.error : tab === 'feed' ? feed.error : settings.error;
  const workerStatus = status.error ? 'OFFLINE' : s?.workerStatus;
  const retry = () => { void status.refetch(); if (tab === 'live') void symbols.refetch(); else if (tab === 'feed') void feed.refetch(); else void settings.refetch(); };
  return <div className="page mm-page">
    <div className="page-head"><div><h1><Radar size={22}/> Market Monitor <span className={`badge ${workerStatus === 'LIVE' ? 'live' : ''}`}>{workerStatus ?? '…'}</span></h1><p>{t('Market scenarios at your chart levels')}</p></div><span className="mm-count">{s?.monitoring ?? 0} {t('symbols')}</span></div>
    <div className="card mm-status">
      <div><strong>Auto {s?.auto ?? 0}</strong><span>Watchlist {s?.watchlist ?? 0}</span><span>{t('Manual levels')} {s?.manual ?? 0}</span><small>{t('Source counts can overlap; total is deduplicated.')}</small></div>
      <div><span>{t('Last scan')}: {date(s?.lastScan)}</span><span>{t('Next scan')}: {date(s?.nextScan)}</span><span>{t('Worker')}: {workerStatus ?? '…'}</span></div>
      <div className="muted">{t('Scanned')}: {s?.symbolsScanned ?? 0} · {t('Requests')}: {s?.requestsMade ?? 0} · {num((s?.cycleDurationMs ?? 0) / 1000)}s · {t('Errors')}: {s?.errors ?? 0} · Telegram: {s?.alertsSent ?? 0}</div>
    </div>
    {(status.error || currentError || s?.error) && <div className="card mm-error"><p role="alert" className="negative">{status.error?.message || currentError?.message || s?.error}</p><button className="btn secondary" onClick={retry}>{t('Retry')}</button><p className="muted">{t('Previously loaded data may be out of date.')}</p></div>}
    <div className="toolbar mm-tabs" role="tablist" aria-label="Market Monitor">
      {(['live', 'feed', 'settings'] as const).map(key => <button key={key} id={`mm-tab-${key}`} role="tab" aria-selected={tab === key} aria-controls={`mm-panel-${key}`} tabIndex={tab === key ? 0 : -1} className={`tool-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)} onKeyDown={e => {
        const tabs = ['live', 'feed', 'settings'] as const;
        const next = e.key === 'ArrowRight' ? (tabs.indexOf(key) + 1) % 3 : e.key === 'ArrowLeft' ? (tabs.indexOf(key) + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : null;
        if (next !== null) { e.preventDefault(); setTab(tabs[next]!); document.getElementById(`mm-tab-${tabs[next]}`)?.focus(); }
      }}>{key === 'live' ? <Activity size={16}/> : key === 'settings' ? <Settings2 size={16}/> : <Radar size={16}/>} {t(key === 'live' ? 'Live monitor' : key === 'feed' ? 'Signal feed' : 'Settings')}</button>)}
    </div>
    <section id="mm-panel-live" role="tabpanel" aria-labelledby="mm-tab-live" hidden={tab !== 'live'}>
      <div className="top-controls mm-live-controls"><input className="input" aria-label={t('Search ticker…')} placeholder={t('Search ticker…')} value={filter} onChange={e => setFilter(e.target.value)}/><span className="muted">{t('Select a symbol to open its chart; use the checklist button to explain the scores.')}</span></div>
      <div className="card mm-table-wrap" aria-busy={symbols.isPending}>
        <table className="data-table mm-live-table"><thead><tr>{['Symbol', 'Price', 'Direction', 'ATR', 'Move', 'Level', 'Level type', 'Distance', 'Approach', 'Breakout', 'Rejection', 'Priority', 'Last signal', 'Checklist'].map(x => <th key={x} scope="col">{t(x)}</th>)}</tr></thead><tbody>
          {visibleSymbols.map(row => {
            const o = row.observation, href = marketChartUrl(row.symbol, o?.cluster.price);
            return <tr key={row.symbol} className={row.error ? 'mm-stale' : ''} onClick={e => { if (!(e.target as HTMLElement).closest('a,button') && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) navigate(href); }}>
              <td><Link to={href}>{row.symbol} <ArrowUpRight size={11}/></Link>{row.error && <small className="negative mm-detail">{row.error}</small>}<small className="muted mm-detail">{t('Updated')}: {date(row.scannedAt)}</small></td>
              <td>{num(o?.price, 8)}</td><td><span aria-label={o ? t(o.direction === 'UP' ? 'Up' : 'Down') : undefined}>{o ? o.direction === 'UP' ? '↑' : '↓' : '—'}</span></td>
              <td>{o ? <>{num(o.metrics.atr, 6)}<small className="mm-detail">{num(o.metrics.atrExpansion)}×</small></> : '—'}</td>
              <td>{o ? `${num(o.metrics.move3)} ATR` : '—'}</td><td>{num(o?.cluster.price, 8)}</td>
              <td>{o?.cluster.types.map(type => marketLabel(type, language)).join(' + ') ?? '—'}</td>
              <td>{o ? <>{num(o.metrics.distanceAtr)} ATR<small className="mm-detail">{num(o.metrics.distancePercent)}%</small></> : '—'}</td>
              <td>{o?.scores.approach ?? '—'}</td><td>{o?.scores.breakout ?? '—'}</td><td>{o?.scores.rejection ?? '—'}</td>
              <td><span className={`badge mm-priority ${o?.scores.priority ?? ''}`}>{o?.scores.priority ?? '—'}</span>{o?.scores.conflict && <small className="warning-text mm-detail">MIXED / CONFLICTING</small>}</td>
              <td>{row.lastSignal ? marketLabel(row.lastSignal.scenario, language) : '—'}<small className="mm-detail">{date(row.lastSignal?.at)}</small></td>
              <td><button className="icon-btn" disabled={!o} title={t('Explain scores for {symbol}', { symbol: row.symbol })} aria-label={t('Explain scores for {symbol}', { symbol: row.symbol })} onClick={() => setSelected(o)}><ListChecks size={16}/></button></td>
            </tr>;
          })}
        </tbody></table>
        {symbols.isPending && <div role="status" className="empty">{t('Loading…')}</div>}
        {!symbols.isPending && !symbols.error && visibleSymbols.length === 0 && <div role="status" className="empty">{t(filter.trim() ? 'No symbols match this search.' : settings.data?.enabled === false ? 'Enable Market Monitor in Settings to start collecting observations.' : 'Waiting for the first scan. Check the universe and worker status.')}</div>}
      </div>
    </section>
    <section id="mm-panel-feed" role="tabpanel" aria-labelledby="mm-tab-feed" hidden={tab !== 'feed'}>
      <div className="top-controls mm-feed-controls"><label><input type="checkbox" checked={signalsOnly} onChange={e => { setSignalsOnly(e.target.checked); setCursors([undefined]); }}/>{t('Signals only')}</label><button className="btn ghost" disabled={before === undefined} onClick={() => setCursors([undefined])}>{t('Latest')}</button></div>
      {feed.isPending ? <div role="status" className="card empty">{t('Loading…')}</div> : <>
        {page.rows.map(o => <details className="card mm-signal" key={o.id}>
          <summary><span className={`badge mm-priority ${o.scores.priority}`}>{o.scores.priority}</span><strong>{o.symbol}</strong><span>{o.scenario ? marketLabel(o.scenario, language) : t('Observation')}{o.scores.conflict ? ' · MIXED / CONFLICTING' : ''}</span><span>{t('Approach')} {o.scores.approach} / {t('Breakout')} {o.scores.breakout} / {t('Rejection')} {o.scores.rejection}</span><span>{t('Level')}: {num(o.cluster.price, 8)}</span><small>{date(o.createdAt)}</small></summary>
          <Link to={marketChartUrl(o.symbol, o.cluster.price)}>{t('Open chart')} ↗</Link><Checklist observation={o}/>
        </details>)}
        {!feed.error && !page.rows.length && <div role="status" className="card empty">{t(signalsOnly ? 'No signals yet. Turn off Signals only to see all observations.' : 'No observations yet.')}</div>}
      </>}
      <div className="mm-pagination"><button className="btn secondary" disabled={cursors.length <= 1 || feed.isFetching} onClick={() => setCursors(current => current.slice(0, -1))}>{t('Newer observations')}</button><span>{t('Page')} {cursors.length}</span><button className="btn secondary" disabled={!page.hasMore || feed.isFetching || !!feed.error} onClick={() => setCursors(current => [...current, page.nextCursor])}>{t('Older observations')}</button></div>
    </section>
    {/* Keep the settings form mounted so switching tabs never discards a draft. */}
    <section id="mm-panel-settings" role="tabpanel" aria-labelledby="mm-tab-settings" hidden={tab !== 'settings'}>
      <div className="card mm-settings-card">{settings.data ? <SettingsForm initial={settings.data}/> : settings.isPending ? <p role="status">{t('Loading…')}</p> : null}</div>
    </section>
    {selected && <ChecklistDialog observation={selected} onClose={() => setSelected(null)}/>}
  </div>;
}
