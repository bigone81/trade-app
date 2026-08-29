import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Image as ImageIcon, RefreshCw, Trash2, UploadCloud, X } from 'lucide-react';
import type { AccountPublic } from '@trade/shared';
import { api, json, money, num } from '../api';
import { useI18n } from '../i18n';

type JournalRow = {
  id:number; account_id:number|null; legacy_account:string|null; occurred_at:string; symbol:string; side:string|null; order_type:string|null;
  trigger_price:number|null; entry_price:number|null; exit_price:number|null; stop_loss:number|null; take_profit:number|null; quantity:number|null;
  point_type:number|null; price_level:number|null; status:number|null; rr:number|null; style:number|null; note:string|null; chart_path:string|null;
  exchange:string|null; pnl:number|null; fees:number|null; setup:string|null; tags_json:string|null; execution_quality:string|null; image_count?:number|null;
};

type JournalImage={id:number;journal_order_id:number;kind:'before'|'entry'|'management'|'exit'|'other';path:string;original_name:string|null;mime:string;size_bytes:number;created_at:string};
const shotKinds=[['before','Before'],['entry','Entry'],['management','Management'],['exit','Exit'],['other','Other']] as const;
const kindLabel=(kind:string)=>shotKinds.find(x=>x[0]===kind)?.[1]||kind;
const fileToBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error||new Error('Could not read image'));reader.onload=()=>{const value=String(reader.result||'');resolve(value.includes(',')?value.slice(value.indexOf(',')+1):value);};reader.readAsDataURL(file);});

const styleMap:Record<number,string>={0:'—',1:'Breakout',2:'LP',3:'Rebound'};
const statusMap:Record<number,string>={0:'New',1:'Filled',2:'Cancelled'};
const pointTypeMap:Record<number,string>={10:'Stop Limit · ATR',11:'Stop Limit · Technical',20:'Limit · ATR',21:'Limit · Technical',30:'Market · ATR',31:'Market · Technical'};
const rrOptions=[-1,0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5];
const parseTags=(value:string|null)=>{try{const x=JSON.parse(value||'[]');return Array.isArray(x)?x.map(String):[];}catch{return[];}};
const dateOnly=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);};

export default function JournalPage(){
  const qc=useQueryClient();
  const { t, language } = useI18n();
  const[tab,setTab]=useState<'trades'|'analytics'>('trades');
  const[account,setAccount]=useState(0);const[symbol,setSymbol]=useState('');const[side,setSide]=useState('');const[style,setStyle]=useState('');const[status,setStatus]=useState('');const[pointType,setPointType]=useState('');const[dateFrom,setDateFrom]=useState('');const[dateTo,setDateTo]=useState('');
  const[selected,setSelected]=useState<JournalRow|null>(null);const[image,setImage]=useState<string|null>(null);const[shotKind,setShotKind]=useState<JournalImage['kind']>('before');const[dropActive,setDropActive]=useState(false);
  const fileInput=useRef<HTMLInputElement|null>(null);
  const config=useQuery<{accounts:AccountPublic[]}>({queryKey:['config'],queryFn:()=>api('/api/config')});
  const q=useQuery<JournalRow[]>({queryKey:['journal-all'],queryFn:()=>api('/api/journal?limit=1000'),refetchInterval:5000});
  const images=useQuery<JournalImage[]>({queryKey:['journal-images',selected?.id],queryFn:()=>api(`/api/journal/${selected!.id}/images`),enabled:Boolean(selected)});
  const update=useMutation({mutationFn:({id,patch}:{id:number;patch:any})=>api<JournalRow>(`/api/journal/${id}`,json('PATCH',patch)),onSuccess:(row)=>{setSelected(row);void qc.invalidateQueries({queryKey:['journal-all']});}});
  const uploadImages=useMutation({mutationFn:async({files,kind}:{files:File[];kind:JournalImage['kind']})=>{if(!selected)throw new Error('Select a journal trade first');for(const file of files){if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Only PNG, JPEG and WEBP images are allowed');if(file.size>8*1024*1024)throw new Error(`${file.name} is larger than 8 MB`);const dataBase64=await fileToBase64(file);await api(`/api/journal/${selected.id}/images`,json('POST',{kind,name:file.name,mime:file.type,dataBase64}));}},onSuccess:()=>{void qc.invalidateQueries({queryKey:['journal-images',selected?.id]});void qc.invalidateQueries({queryKey:['journal-all']});}});
  const deleteImage=useMutation({mutationFn:(id:number)=>api(`/api/journal/images/${id}`,{method:'DELETE'}),onSuccess:()=>{void qc.invalidateQueries({queryKey:['journal-images',selected?.id]});void qc.invalidateQueries({queryKey:['journal-all']});}});
  const syncJournal=useMutation({mutationFn:()=>api('/api/journal/sync',{method:'POST'}),onSuccess:()=>void qc.invalidateQueries({queryKey:['journal-all']})});

  const accountNames=useMemo(()=>Object.fromEntries((config.data?.accounts||[]).map(a=>[a.id,a.name])),[config.data]);
  const rows=useMemo(()=>{return(q.data||[]).filter(r=>{
    if(account&&r.account_id!==account)return false;if(symbol&&!r.symbol.toUpperCase().includes(symbol.toUpperCase()))return false;if(side&&r.side!==side)return false;if(style!==''&&String(r.style??0)!==style)return false;if(status!==''&&String(r.status??0)!==status)return false;if(pointType!==''&&String(r.point_type??0)!==pointType)return false;
    const d=dateOnly(r.occurred_at);if(dateFrom&&d<dateFrom)return false;if(dateTo&&d>dateTo)return false;return true;
  });},[q.data,account,symbol,side,style,status,pointType,dateFrom,dateTo]);

  const metrics=useMemo(()=>{
    const scored=rows.filter(r=>Number.isFinite(Number(r.rr))).map(r=>Number(r.rr));
    const wins=scored.filter(v=>v>0),losses=scored.filter(v=>v<0);const grossWin=wins.reduce((a,b)=>a+b,0),grossLoss=Math.abs(losses.reduce((a,b)=>a+b,0));
    const decided=wins.length+losses.length;const net=scored.reduce((a,b)=>a+b,0);const avg=scored.length?net/scored.length:0;
    return{trades:rows.length,winrate:decided?wins.length/decided*100:0,net,avg,pf:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),avgWin:wins.length?grossWin/wins.length:0,avgLoss:losses.length?losses.reduce((a,b)=>a+b,0)/losses.length:0};
  },[rows]);

  const buildBreakdown=(key:(row:JournalRow)=>string)=>{const map=new Map<string,{name:string;trades:number;wins:number;losses:number;net:number}>();for(const row of rows){const name=key(row)||'—';const x=map.get(name)||{name,trades:0,wins:0,losses:0,net:0};x.trades++;const rr=Number(row.rr||0);x.net+=rr;if(rr>0)x.wins++;if(rr<0)x.losses++;map.set(name,x);}return[...map.values()].sort((a,b)=>b.trades-a.trades);};
  const breakdowns=useMemo(()=>({
    style:buildBreakdown(r=>styleMap[Number(r.style||0)]||`Style ${r.style}`),
    account:buildBreakdown(r=>accountNames[r.account_id||0]||r.legacy_account||`Account ${r.account_id||'—'}`),
    side:buildBreakdown(r=>r.side||'—'),
    point:buildBreakdown(r=>pointTypeMap[Number(r.point_type||0)]||String(r.point_type||'—')),
    setup:buildBreakdown(r=>r.setup||'Unclassified'),
  }),[rows,accountNames]);

  const patch=(values:any)=>{if(selected)update.mutate({id:selected.id,patch:values});};
  const tags=selected?parseTags(selected.tags_json):[];
  const acceptFiles=(files:File[])=>{const list=files.filter(Boolean);if(list.length)uploadImages.mutate({files:list,kind:shotKind});};
  useEffect(()=>{if(!selected)return;const onPaste=(event:ClipboardEvent)=>{const fromItems=Array.from(event.clipboardData?.items||[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>Boolean(file));const pasted=fromItems.length?fromItems:Array.from(event.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/'));if(!pasted.length)return;event.preventDefault();acceptFiles(pasted);};window.addEventListener('paste',onPaste);return()=>window.removeEventListener('paste',onPaste);},[selected,shotKind]);

  return <div className="page journal-page">
    <div className="page-head"><div><h1>{t('Journal')}</h1><p>{language==='uk'?'Торговий щоденник, розбір і аналітика в R. Старі нотатки та скріншоти збережені.':language==='ru'?'Торговый дневник, разбор и аналитика в R. Старые заметки и скриншоты сохранены.':'Trading diary, review and R-based analytics. Legacy notes and screenshots are preserved.'}</p></div><button className="btn secondary" disabled={syncJournal.isPending} onClick={()=>syncJournal.mutate()}><RefreshCw size={14}/>{syncJournal.isPending?(language==='uk'?'Синхронізація…':language==='ru'?'Синхронизация…':'Syncing…'):'Sync Bybit'}</button></div>
    <div className="journal-tabs"><button className={tab==='trades'?'tab active':'tab'} onClick={()=>setTab('trades')}>{t('Trades')}</button><button className={tab==='analytics'?'tab active':'tab'} onClick={()=>setTab('analytics')}>{t('Analytics')}</button></div>
    <div className="card journal-filterbar">
      <select className="select" value={account} onChange={e=>setAccount(Number(e.target.value))}><option value={0}>{t('All accounts')}</option>{config.data?.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <input className="input" placeholder={t('Symbol')} value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())}/>
      <select className="select" value={side} onChange={e=>setSide(e.target.value)}><option value="">Long + Short</option><option value="Buy">{t('Buy')}</option><option value="Sell">{t('Sell')}</option></select>
      <select className="select" value={style} onChange={e=>setStyle(e.target.value)}><option value="">{language==='uk'?'Усі стилі':language==='ru'?'Все стили':'All styles'}</option><option value="1">Breakout</option><option value="2">LP</option><option value="3">Rebound</option><option value="0">{language==='uk'?'Без класифікації':language==='ru'?'Без классификации':'Unclassified'}</option></select>
      <select className="select" value={status} onChange={e=>setStatus(e.target.value)}><option value="">{language==='uk'?'Усі статуси':language==='ru'?'Все статусы':'All status'}</option><option value="0">{t('New')}</option><option value="1">{t('Filled')}</option><option value="2">{t('Cancelled')}</option></select>
      <select className="select" value={pointType} onChange={e=>setPointType(e.target.value)}><option value="">{language==='uk'?'Усі типи входу':language==='ru'?'Все типы входа':'All entry types'}</option>{Object.entries(pointTypeMap).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
      <input className="input" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/><input className="input" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
      <button className="btn ghost" onClick={()=>{setAccount(0);setSymbol('');setSide('');setStyle('');setStatus('');setPointType('');setDateFrom('');setDateTo('');}}>{language==='uk'?'Скинути':language==='ru'?'Сбросить':'Reset'}</button>
    </div>

    <div className="journal-metrics">
      <div className="metric-card"><small>{t('Trades')}</small><strong>{metrics.trades}</strong></div>
      <div className="metric-card"><small>{t('Winrate')}</small><strong>{metrics.winrate.toFixed(1)}%</strong></div>
      <div className="metric-card"><small>{t('Net R')}</small><strong className={metrics.net>=0?'positive':'negative'}>{metrics.net>=0?'+':''}{metrics.net.toFixed(2)}R</strong></div>
      <div className="metric-card"><small>{t('Profit Factor')}</small><strong>{metrics.pf===Infinity?'∞':metrics.pf.toFixed(2)}</strong></div>
      <div className="metric-card"><small>{t('Expectancy')}</small><strong>{metrics.avg>=0?'+':''}{metrics.avg.toFixed(2)}R</strong></div>
    </div>

    {tab==='trades'?<div className="card table-card journal-table-card"><table className="data-table journal-table"><thead><tr><th>{t('Date')}</th><th>{t('Exchange')}</th><th>{t('Account')}</th><th>{t('Symbol')}</th><th>{t('Side')}</th><th>{t('Entry')}</th><th>{t('SL')}</th><th>{t('TP / Exit')}</th><th>R</th><th>{t('Style')}</th><th>{t('Setup')}</th><th>{t('Status')}</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id} onClick={()=>setSelected(r)}>
      <td>{r.occurred_at}</td><td>{String(r.exchange||'bybit').toUpperCase()}</td><td>{accountNames[r.account_id||0]||r.legacy_account||`Account ${r.account_id||'—'}`}</td><td><b>{r.symbol}</b>{Boolean(r.chart_path||Number(r.image_count||0)>0)&&<button className="journal-chart-icon" onClick={e=>{e.stopPropagation();setSelected(r);}} title={language==='uk'?'Відкрити скріншоти':language==='ru'?'Открыть скриншоты':'Open screenshots'}><ImageIcon size={13}/><span>{Number(r.image_count||0)+(r.chart_path?1:0)}</span></button>}</td><td className={r.side==='Buy'?'positive':'negative'}>{r.side?t(r.side):'—'}</td><td>{num(r.entry_price||0,8)}</td><td>{num(r.stop_loss||0,8)}</td><td>{num(r.exit_price||r.take_profit||0,8)}</td><td><span className={`rr-chip ${Number(r.rr)>0?'win':Number(r.rr)<0?'loss':''}`}>{Number(r.rr)>0?'+':''}{Number(r.rr||0)}R</span></td><td>{styleMap[Number(r.style||0)]||'—'}</td><td>{r.setup||'—'}</td><td>{t(statusMap[Number(r.status||0)]||String(r.status??'—'))}</td><td>{r.note?'📝':''}</td>
    </tr>)}</tbody></table>{!rows.length&&<div className="empty">{t('No journal entries for the selected filters.')}</div>}</div>:
    <div className="analytics-grid"><section className="card analytics-card"><h3>{t('Performance')}</h3><div className="kv"><span>{t('Average winner')}</span><b>+{metrics.avgWin.toFixed(2)}R</b></div><div className="kv"><span>{t('Average loser')}</span><b>{metrics.avgLoss.toFixed(2)}R</b></div><div className="kv"><span>{t('Expectancy / trade')}</span><b>{metrics.avg>=0?'+':''}{metrics.avg.toFixed(2)}R</b></div><div className="kv"><span>{t('Net result')}</span><b className={metrics.net>=0?'positive':'negative'}>{metrics.net>=0?'+':''}{metrics.net.toFixed(2)}R</b></div></section>
    {([['By trading style',breakdowns.style],['By account',breakdowns.account],['Long / Short',breakdowns.side],['By entry type',breakdowns.point],['By setup',breakdowns.setup]] as const).map(([title,data])=><section key={title} className="card analytics-card analytics-wide"><h3>{t(title)}</h3><table className="data-table"><thead><tr><th>{t('Group')}</th><th>{t('Trades')}</th><th>{t('Winrate')}</th><th>{t('Net R')}</th><th>{t('Avg R')}</th></tr></thead><tbody>{data.map(x=>{const decided=x.wins+x.losses;return<tr key={x.name}><td>{x.name}</td><td>{x.trades}</td><td>{decided?(x.wins/decided*100).toFixed(1):'0.0'}%</td><td className={x.net>=0?'positive':'negative'}>{x.net>=0?'+':''}{x.net.toFixed(2)}R</td><td>{x.trades?(x.net/x.trades).toFixed(2):'0.00'}R</td></tr>})}</tbody></table></section>)}</div>}

    {selected&&<aside className="drawer journal-drawer"><div className="drawer-head"><div><h2>{selected.symbol} · {selected.side?t(selected.side):'—'}</h2><div className="muted">{selected.occurred_at} · {(selected.exchange||'bybit').toUpperCase()} · {accountNames[selected.account_id||0]||selected.legacy_account}</div></div><button className="icon-btn" onClick={()=>setSelected(null)}><X size={16}/></button></div>
      <div className="metric-grid"><div className="metric"><small>{t('Entry')}</small><strong>{num(selected.entry_price||0,8)}</strong></div><div className="metric"><small>{t('SL')}</small><strong>{num(selected.stop_loss||0,8)}</strong></div><div className="metric"><small>{t('TP')}</small><strong>{num(selected.take_profit||0,8)}</strong></div><div className="metric"><small>{t('Point type')}</small><strong>{pointTypeMap[Number(selected.point_type||0)]||selected.point_type||'—'}</strong></div></div>
      <div className="drawer-section"><div className="field-grid"><div className="field"><label>{t('Result R')}</label><select className="select" value={Number(selected.rr||0)} onChange={e=>patch({rr:Number(e.target.value)})}>{rrOptions.map(v=><option key={v} value={v}>{v>0?'+':''}{v===0?'BE':`${v}R`}</option>)}</select></div><div className="field"><label>{t('Style')}</label><select className="select" value={Number(selected.style||0)} onChange={e=>patch({style:Number(e.target.value)})}><option value={0}>—</option><option value={1}>Breakout</option><option value={2}>LP</option><option value={3}>Rebound</option></select></div></div>
      <div className="field-grid"><div className="field"><label>{t('Status')}</label><select className="select" value={Number(selected.status||0)} onChange={e=>patch({status:Number(e.target.value)})}><option value={0}>{t('New')}</option><option value={1}>{t('Filled')}</option><option value={2}>{t('Cancelled')}</option></select></div><div className="field"><label>{t('Execution quality')}</label><select className="select" value={selected.execution_quality||''} onChange={e=>patch({executionQuality:e.target.value||null})}><option value="">—</option><option value="Excellent">{t('Excellent')}</option><option value="Good">{t('Good')}</option><option value="Average">{t('Average')}</option><option value="Poor">{t('Poor')}</option></select></div></div>
      <div className="field"><label>{t('Setup')}</label><input className="input" value={selected.setup||''} placeholder={t('Daily mirror + rejection')} onChange={e=>setSelected({...selected,setup:e.target.value})} onBlur={e=>patch({setup:e.target.value||null})}/></div>
      <div className="field"><label>{t('Tags · comma separated')}</label><input className="input" value={tags.join(', ')} placeholder={t('FOMO, daily level, high volume')} onChange={e=>setSelected({...selected,tags_json:JSON.stringify(e.target.value.split(',').map(x=>x.trim()).filter(Boolean))})} onBlur={e=>patch({tags:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></div>
      <div className="field"><label>{t('Notes')}</label><textarea className="input journal-note" value={selected.note||''} placeholder={t('What was the idea? What went well? What should change next time?')} onChange={e=>setSelected({...selected,note:e.target.value})} onBlur={e=>patch({note:e.target.value||null})}/></div>
      </div>
      <div className="drawer-section journal-images-section"><div className="journal-images-title"><div><h3>{t('Screenshots')}</h3><p>{t('Upload, drag an image here, or press Ctrl+V after making a Print Screen.')}</p></div><select className="select journal-kind-select" value={shotKind} onChange={e=>setShotKind(e.target.value as JournalImage['kind'])}>{shotKinds.map(([value,label])=><option key={value} value={value}>{t(label)}</option>)}</select></div>
        <input ref={fileInput} className="journal-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>{acceptFiles(Array.from(e.target.files||[]));e.currentTarget.value='';}}/>
        <button type="button" className={`journal-dropzone ${dropActive?'active':''}`} onClick={()=>fileInput.current?.click()} onDragEnter={e=>{e.preventDefault();setDropActive(true);}} onDragOver={e=>e.preventDefault()} onDragLeave={e=>{e.preventDefault();if(e.currentTarget===e.target)setDropActive(false);}} onDrop={e=>{e.preventDefault();setDropActive(false);acceptFiles(Array.from(e.dataTransfer.files).filter(f=>f.type.startsWith('image/')));}}>
          <UploadCloud size={20}/><span><b>{uploadImages.isPending?t('Uploading…'):t('Add screenshot')}</b><small>PNG / JPG / WEBP · up to 8 MB</small></span><span className="journal-paste-hint"><ClipboardPaste size={14}/> Ctrl+V</span>
        </button>
        {uploadImages.error&&<div className="journal-upload-error">{uploadImages.error instanceof Error?uploadImages.error.message:t('Upload failed')}</div>}
        <div className="journal-image-grid">
          {selected.chart_path&&<article className="journal-image-card legacy"><button className="journal-image-preview" onClick={()=>setImage(`/charts/${selected.chart_path}`)}><img src={`/charts/${selected.chart_path}`} alt="Legacy trade chart"/></button><div className="journal-image-meta"><span>{t('Legacy')}</span><small>{t('Original screenshot')}</small></div></article>}
          {(images.data||[]).map(item=><article className="journal-image-card" key={item.id}><button className="journal-image-preview" onClick={()=>setImage(`/charts/${item.path}`)}><img src={`/charts/${item.path}`} alt={`${kindLabel(item.kind)} screenshot`}/></button><div className="journal-image-meta"><span>{t(kindLabel(item.kind))}</span><small>{item.original_name||new Date(item.created_at).toLocaleString()}</small></div><button className="journal-image-delete" disabled={deleteImage.isPending} onClick={()=>{if(window.confirm(t('Delete this screenshot?')))deleteImage.mutate(item.id);}} title={t('Delete screenshot')}><Trash2 size={13}/></button></article>)}
        </div>
        {!selected.chart_path&&!images.isLoading&&!(images.data||[]).length&&<div className="journal-images-empty">{t('No screenshots yet. The easiest way: take a Print Screen and press Ctrl+V.')}</div>}
      </div>
    </aside>}
    {image&&<div className="image-modal" onClick={()=>setImage(null)}><img src={image}/></div>}
  </div>;
}
