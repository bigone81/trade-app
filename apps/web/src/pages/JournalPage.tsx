import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, X } from 'lucide-react';
import type { AccountPublic } from '@trade/shared';
import { api, json, money, num } from '../api';

type JournalRow = {
  id:number; account_id:number|null; legacy_account:string|null; occurred_at:string; symbol:string; side:string|null; order_type:string|null;
  trigger_price:number|null; entry_price:number|null; exit_price:number|null; stop_loss:number|null; take_profit:number|null; quantity:number|null;
  point_type:number|null; price_level:number|null; status:number|null; rr:number|null; style:number|null; note:string|null; chart_path:string|null;
  exchange:string|null; pnl:number|null; fees:number|null; setup:string|null; tags_json:string|null; execution_quality:string|null;
};

const styleMap:Record<number,string>={0:'—',1:'Breakout',2:'LP',3:'Rebound'};
const statusMap:Record<number,string>={0:'New',1:'Filled',2:'Cancelled'};
const pointTypeMap:Record<number,string>={10:'Stop Limit · ATR',11:'Stop Limit · Technical',20:'Limit · ATR',21:'Limit · Technical',30:'Market · ATR',31:'Market · Technical'};
const rrOptions=[-1,0,0.5,1,1.5,2,2.5,3,3.5,4,4.5,5];
const parseTags=(value:string|null)=>{try{const x=JSON.parse(value||'[]');return Array.isArray(x)?x.map(String):[];}catch{return[];}};
const dateOnly=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10);};

export default function JournalPage(){
  const qc=useQueryClient();
  const[tab,setTab]=useState<'trades'|'analytics'>('trades');
  const[account,setAccount]=useState(0);const[symbol,setSymbol]=useState('');const[side,setSide]=useState('');const[style,setStyle]=useState('');const[status,setStatus]=useState('');const[pointType,setPointType]=useState('');const[dateFrom,setDateFrom]=useState('');const[dateTo,setDateTo]=useState('');
  const[selected,setSelected]=useState<JournalRow|null>(null);const[image,setImage]=useState<string|null>(null);
  const config=useQuery<{accounts:AccountPublic[]}>({queryKey:['config'],queryFn:()=>api('/api/config')});
  const q=useQuery<JournalRow[]>({queryKey:['journal-all'],queryFn:()=>api('/api/journal?limit=1000')});
  const update=useMutation({mutationFn:({id,patch}:{id:number;patch:any})=>api<JournalRow>(`/api/journal/${id}`,json('PATCH',patch)),onSuccess:(row)=>{setSelected(row);void qc.invalidateQueries({queryKey:['journal-all']});}});

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

  return <div className="page journal-page">
    <div className="page-head"><div><h1>Journal</h1><p>Trading diary, review and R-based analytics. Legacy notes and screenshots are preserved.</p></div></div>
    <div className="journal-tabs"><button className={tab==='trades'?'tab active':'tab'} onClick={()=>setTab('trades')}>Trades</button><button className={tab==='analytics'?'tab active':'tab'} onClick={()=>setTab('analytics')}>Analytics</button></div>
    <div className="card journal-filterbar">
      <select className="select" value={account} onChange={e=>setAccount(Number(e.target.value))}><option value={0}>All accounts</option>{config.data?.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <input className="input" placeholder="Symbol" value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())}/>
      <select className="select" value={side} onChange={e=>setSide(e.target.value)}><option value="">Long + Short</option><option value="Buy">Buy</option><option value="Sell">Sell</option></select>
      <select className="select" value={style} onChange={e=>setStyle(e.target.value)}><option value="">All styles</option><option value="1">Breakout</option><option value="2">LP</option><option value="3">Rebound</option><option value="0">Unclassified</option></select>
      <select className="select" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All status</option><option value="0">New</option><option value="1">Filled</option><option value="2">Cancelled</option></select>
      <select className="select" value={pointType} onChange={e=>setPointType(e.target.value)}><option value="">All entry types</option>{Object.entries(pointTypeMap).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select>
      <input className="input" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/><input className="input" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/>
      <button className="btn ghost" onClick={()=>{setAccount(0);setSymbol('');setSide('');setStyle('');setStatus('');setPointType('');setDateFrom('');setDateTo('');}}>Reset</button>
    </div>

    <div className="journal-metrics">
      <div className="metric-card"><small>Trades</small><strong>{metrics.trades}</strong></div>
      <div className="metric-card"><small>Winrate</small><strong>{metrics.winrate.toFixed(1)}%</strong></div>
      <div className="metric-card"><small>Net R</small><strong className={metrics.net>=0?'positive':'negative'}>{metrics.net>=0?'+':''}{metrics.net.toFixed(2)}R</strong></div>
      <div className="metric-card"><small>Profit Factor</small><strong>{metrics.pf===Infinity?'∞':metrics.pf.toFixed(2)}</strong></div>
      <div className="metric-card"><small>Expectancy</small><strong>{metrics.avg>=0?'+':''}{metrics.avg.toFixed(2)}R</strong></div>
    </div>

    {tab==='trades'?<div className="card table-card journal-table-card"><table className="data-table journal-table"><thead><tr><th>Date</th><th>Exchange</th><th>Account</th><th>Symbol</th><th>Side</th><th>Entry</th><th>SL</th><th>TP / Exit</th><th>R</th><th>Style</th><th>Setup</th><th>Status</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r.id} onClick={()=>setSelected(r)}>
      <td>{r.occurred_at}</td><td>{String(r.exchange||'bybit').toUpperCase()}</td><td>{accountNames[r.account_id||0]||r.legacy_account||`Account ${r.account_id||'—'}`}</td><td><b>{r.symbol}</b>{r.chart_path&&<button className="journal-chart-icon" onClick={e=>{e.stopPropagation();setImage(`/charts/${r.chart_path}`);}} title="Open chart"><ImageIcon size={13}/></button>}</td><td className={r.side==='Buy'?'positive':'negative'}>{r.side}</td><td>{num(r.entry_price||0,8)}</td><td>{num(r.stop_loss||0,8)}</td><td>{num(r.exit_price||r.take_profit||0,8)}</td><td><span className={`rr-chip ${Number(r.rr)>0?'win':Number(r.rr)<0?'loss':''}`}>{Number(r.rr)>0?'+':''}{Number(r.rr||0)}R</span></td><td>{styleMap[Number(r.style||0)]||'—'}</td><td>{r.setup||'—'}</td><td>{statusMap[Number(r.status||0)]||r.status}</td><td>{r.note?'📝':''}</td>
    </tr>)}</tbody></table>{!rows.length&&<div className="empty">No journal entries for the selected filters.</div>}</div>:
    <div className="analytics-grid"><section className="card analytics-card"><h3>Performance</h3><div className="kv"><span>Average winner</span><b>+{metrics.avgWin.toFixed(2)}R</b></div><div className="kv"><span>Average loser</span><b>{metrics.avgLoss.toFixed(2)}R</b></div><div className="kv"><span>Expectancy / trade</span><b>{metrics.avg>=0?'+':''}{metrics.avg.toFixed(2)}R</b></div><div className="kv"><span>Net result</span><b className={metrics.net>=0?'positive':'negative'}>{metrics.net>=0?'+':''}{metrics.net.toFixed(2)}R</b></div></section>
    {([['By trading style',breakdowns.style],['By account',breakdowns.account],['Long / Short',breakdowns.side],['By entry type',breakdowns.point],['By setup',breakdowns.setup]] as const).map(([title,data])=><section key={title} className="card analytics-card analytics-wide"><h3>{title}</h3><table className="data-table"><thead><tr><th>Group</th><th>Trades</th><th>Winrate</th><th>Net R</th><th>Avg R</th></tr></thead><tbody>{data.map(x=>{const decided=x.wins+x.losses;return<tr key={x.name}><td>{x.name}</td><td>{x.trades}</td><td>{decided?(x.wins/decided*100).toFixed(1):'0.0'}%</td><td className={x.net>=0?'positive':'negative'}>{x.net>=0?'+':''}{x.net.toFixed(2)}R</td><td>{x.trades?(x.net/x.trades).toFixed(2):'0.00'}R</td></tr>})}</tbody></table></section>)}</div>}

    {selected&&<aside className="drawer journal-drawer"><div className="drawer-head"><div><h2>{selected.symbol} · {selected.side}</h2><div className="muted">{selected.occurred_at} · {(selected.exchange||'bybit').toUpperCase()} · {accountNames[selected.account_id||0]||selected.legacy_account}</div></div><button className="icon-btn" onClick={()=>setSelected(null)}><X size={16}/></button></div>
      <div className="metric-grid"><div className="metric"><small>Entry</small><strong>{num(selected.entry_price||0,8)}</strong></div><div className="metric"><small>SL</small><strong>{num(selected.stop_loss||0,8)}</strong></div><div className="metric"><small>TP</small><strong>{num(selected.take_profit||0,8)}</strong></div><div className="metric"><small>Point type</small><strong>{pointTypeMap[Number(selected.point_type||0)]||selected.point_type||'—'}</strong></div></div>
      <div className="drawer-section"><div className="field-grid"><div className="field"><label>Result R</label><select className="select" value={Number(selected.rr||0)} onChange={e=>patch({rr:Number(e.target.value)})}>{rrOptions.map(v=><option key={v} value={v}>{v>0?'+':''}{v===0?'BE':`${v}R`}</option>)}</select></div><div className="field"><label>Style</label><select className="select" value={Number(selected.style||0)} onChange={e=>patch({style:Number(e.target.value)})}><option value={0}>—</option><option value={1}>Breakout</option><option value={2}>LP</option><option value={3}>Rebound</option></select></div></div>
      <div className="field-grid"><div className="field"><label>Status</label><select className="select" value={Number(selected.status||0)} onChange={e=>patch({status:Number(e.target.value)})}><option value={0}>New</option><option value={1}>Filled</option><option value={2}>Cancelled</option></select></div><div className="field"><label>Execution quality</label><select className="select" value={selected.execution_quality||''} onChange={e=>patch({executionQuality:e.target.value||null})}><option value="">—</option><option>Excellent</option><option>Good</option><option>Average</option><option>Poor</option></select></div></div>
      <div className="field"><label>Setup</label><input className="input" value={selected.setup||''} placeholder="Daily mirror + rejection" onChange={e=>setSelected({...selected,setup:e.target.value})} onBlur={e=>patch({setup:e.target.value||null})}/></div>
      <div className="field"><label>Tags · comma separated</label><input className="input" value={tags.join(', ')} placeholder="FOMO, daily level, high volume" onChange={e=>setSelected({...selected,tags_json:JSON.stringify(e.target.value.split(',').map(x=>x.trim()).filter(Boolean))})} onBlur={e=>patch({tags:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></div>
      <div className="field"><label>Notes</label><textarea className="input journal-note" value={selected.note||''} placeholder="What was the idea? What went well? What should change next time?" onChange={e=>setSelected({...selected,note:e.target.value})} onBlur={e=>patch({note:e.target.value||null})}/></div>
      </div>
      {selected.chart_path&&<div className="drawer-section"><h3>Chart</h3><button className="journal-screenshot" onClick={()=>setImage(`/charts/${selected.chart_path}`)}><img src={`/charts/${selected.chart_path}`} alt="Trade chart"/></button></div>}
    </aside>}
    {image&&<div className="image-modal" onClick={()=>setImage(null)}><img src={image}/></div>}
  </div>;
}
