import {
  BarSeries,
  ColorType,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type {
  AutoLevel,
  Candle,
  ManualLevel,
  RiskReward,
} from '@trade/shared';
import { api } from './api';
import { resolvedTheme, type AppPreferences } from './preferences';

export type SnapshotTrade = {
  id:number;
  account_id:number|null;
  legacy_account:string|null;
  occurred_at:string;
  symbol:string;
  side:string|null;
  status:number|null;
  order_type:string|null;
  entry_price:number|null;
  exit_price:number|null;
  stop_loss:number|null;
  take_profit:number|null;
  quantity:number|null;
};

export type SnapshotInterval = '5' | '60' | 'D';

type SnapshotSpec = {
  interval:SnapshotInterval;
  label:'5m'|'1H'|'1D';
  limit:number;
  before:number;
  after:number;
};

const specs:Record<SnapshotInterval,SnapshotSpec>={
  '5':{interval:'5',label:'5m',limit:260,before:150,after:70},
  '60':{interval:'60',label:'1H',limit:230,before:130,after:55},
  'D':{interval:'D',label:'1D',limit:180,before:100,after:35},
};

const timeframeSeconds=(interval:SnapshotInterval)=>interval==='D'?86400:Number(interval)*60;

const decimalsFromTickSize=(tickSize:string)=>{
  const text=String(tickSize||'').trim().toLowerCase();
  const scientific=text.match(/^([0-9]+(?:\.[0-9]+)?)e-([0-9]+)$/);
  if(scientific){const coefficientDecimals=(scientific[1]!.split('.')[1]||'').replace(/0+$/,'').length;return Math.max(0,Number(scientific[2])+coefficientDecimals);}
  return (text.split('.')[1]||'').replace(/0+$/,'').length;
};

const priceFormat=(tickSize:string|null,fallbackPrice=0)=>{
  const minMove=Number(tickSize);
  if(Number.isFinite(minMove)&&minMove>0)return{type:'price' as const,precision:decimalsFromTickSize(String(tickSize)),minMove};
  const value=Math.abs(fallbackPrice);const precision=value>0&&value<0.01?6:value<1?4:2;
  return{type:'price' as const,precision,minMove:10**-precision};
};

const rgba=(hex:string,opacity:number)=>{
  const clean=hex.replace('#','');const value=clean.length===3?clean.split('').map(x=>x+x).join(''):clean;const n=Number.parseInt(value,16);
  if(!Number.isFinite(n))return hex;return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${Math.max(0,Math.min(1,opacity))})`;
};

const lineStyle=(style:'solid'|'dashed'|'dotted')=>style==='dashed'?LineStyle.Dashed:style==='dotted'?LineStyle.Dotted:LineStyle.Solid;

const waitPaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));

const nearestIndex=(candles:Candle[],time:number)=>{
  if(!candles.length)return 0;let best=0,bestDistance=Infinity;
  candles.forEach((c,index)=>{const distance=Math.abs(c.time-time);if(distance<bestDistance){best=index;bestDistance=distance;}});
  return best;
};

const logicalAtTime=(candles:Candle[],time:number,step:number)=>{
  if(!candles.length)return 0;if(candles.length===1)return(time-candles[0]!.time)/step;
  if(time<=candles[0]!.time)return(time-candles[0]!.time)/step;
  const last=candles.length-1;if(time>=candles[last]!.time)return last+(time-candles[last]!.time)/step;
  let lo=0,hi=last;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(candles[mid]!.time<=time)lo=mid;else hi=mid;}
  const a=candles[lo]!,b=candles[hi]!;return lo+(time-a.time)/Math.max(1,b.time-a.time);
};

function drawRiskRewards(ctx:CanvasRenderingContext2D,chart:IChartApi,series:ISeriesApi<'Bar'>,candles:Candle[],items:RiskReward[],step:number,scaleX:number,scaleY:number){
  ctx.save();ctx.scale(scaleX,scaleY);
  const timeToX=(time:number)=>{
    const direct=chart.timeScale().timeToCoordinate(time as UTCTimestamp);if(direct!==null)return direct;
    return (chart.timeScale() as any).logicalToCoordinate(logicalAtTime(candles,time,step)) as number|null;
  };
  for(const item of items){
    const x1=timeToX(item.startTime),x2=timeToX(item.endTime);const entryY=series.priceToCoordinate(item.entry),stopY=series.priceToCoordinate(item.stop),targetY=series.priceToCoordinate(item.target);
    if(x1===null||x2===null||entryY===null||stopY===null||targetY===null)continue;
    const left=Math.min(x1,x2),width=Math.max(2,Math.abs(x2-x1));
    ctx.fillStyle='rgba(49,196,141,0.14)';ctx.fillRect(left,Math.min(entryY,targetY),width,Math.max(1,Math.abs(targetY-entryY)));
    ctx.fillStyle='rgba(239,102,117,0.14)';ctx.fillRect(left,Math.min(entryY,stopY),width,Math.max(1,Math.abs(stopY-entryY)));
    ctx.lineWidth=1;ctx.strokeStyle='rgba(230,237,247,0.72)';ctx.strokeRect(left,Math.min(targetY,stopY),width,Math.max(1,Math.abs(stopY-targetY)));
    const risk=Math.abs(item.entry-item.stop);const reward=Math.abs(item.target-item.entry);const ratio=risk>0?reward/risk:0;
    ctx.font='12px sans-serif';ctx.fillStyle='rgba(230,237,247,0.92)';ctx.fillText(`${item.direction.toUpperCase()} · ${ratio.toFixed(2)}R`,left+8,Math.max(16,Math.min(entryY,stopY,targetY)-7));
  }
  ctx.restore();
}

const canvasToFile=(canvas:HTMLCanvasElement,name:string)=>new Promise<File>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(new File([blob],name,{type:'image/png'})):reject(new Error('Could not create chart image')),'image/png'));

async function buildOne(trade:SnapshotTrade,preferences:AppPreferences,spec:SnapshotSpec):Promise<File>{
  const symbol=trade.symbol.toUpperCase();const occurred=Math.floor(new Date(trade.occurred_at).getTime()/1000);if(!Number.isFinite(occurred))throw new Error('Invalid journal trade date');
  const step=timeframeSeconds(spec.interval);const endMs=Math.min(Date.now(),(occurred+spec.after*step)*1000);
  const qSymbol=encodeURIComponent(symbol);
  const [candles,levels,manual,riskRewards,instrument]=await Promise.all([
    api<Candle[]>(`/api/market/candles?symbol=${qSymbol}&interval=${spec.interval}&limit=${spec.limit}&end=${Math.floor(endMs)}`),
    api<{limitLevels:AutoLevel[];mirrorLevels:AutoLevel[]}>(`/api/market/levels?symbol=${qSymbol}&interval=D&end=${Math.floor(Math.min(Date.now(),(occurred+86400)*1000))}`),
    api<ManualLevel[]>(`/api/drawings/levels?symbol=${qSymbol}`),
    api<RiskReward[]>(`/api/drawings/risk-rewards?symbol=${qSymbol}`),
    api<{tickSize:string|null}>(`/api/market/instrument?symbol=${qSymbol}`),
  ]);
  if(!candles.length)throw new Error(`No ${spec.label} candles returned for ${symbol}`);

  const theme=resolvedTheme(preferences.theme);const light=theme==='light';const width=1280,height=720;
  const host=document.createElement('div');host.style.cssText=`position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;background:${light?'#fff':'#0a0f16'};`;document.body.appendChild(host);
  const chart=createChart(host,{width,height,layout:{background:{type:ColorType.Solid,color:light?'#ffffff':'#0a0f16'},textColor:light?'#526071':'#6f7f94'},grid:{vertLines:{color:preferences.chart.showGrid?(light?'#e8edf3':'#111a25'):'transparent'},horzLines:{color:preferences.chart.showGrid?(light?'#e8edf3':'#111a25'):'transparent'}},rightPriceScale:{borderColor:light?'#d7dee7':'#202b3a'},timeScale:{borderColor:light?'#d7dee7':'#202b3a',timeVisible:true,secondsVisible:false,rightOffset:8}});
  const series=chart.addSeries(BarSeries,{upColor:'#31c48d',downColor:'#ef6675',openVisible:true,thinBars:false,priceLineVisible:false,priceFormat:priceFormat(instrument.tickSize,candles.at(-1)?.close||0)});
  series.setData(candles.map(c=>({...c,time:c.time as UTCTimestamp})) as any);

  const auto=[...(levels.limitLevels||[]),...(levels.mirrorLevels||[])];
  for(const level of auto)series.createPriceLine({price:level.price,color:level.type==='mirror'?'#7387ff':level.type==='support'?'#3a9b79':'#b85b6c',lineWidth:1,lineStyle:LineStyle.Dashed,axisLabelVisible:true,title:`${level.type} · ${level.touches}`});
  for(const level of manual){const autoColor=light?'#1f2937':'#e5e7eb';const color=preferences.manualLevel.colorMode==='auto'?autoColor:preferences.manualLevel.color;series.createPriceLine({price:level.price,color:rgba(color,preferences.manualLevel.opacity),lineWidth:preferences.manualLevel.width,lineStyle:lineStyle(preferences.manualLevel.style),axisLabelVisible:preferences.manualLevel.showPriceLabel,title:level.label||'Manual'});}
  const account=trade.legacy_account||`Account ${trade.account_id??'—'}`;const own=(price:number|null|undefined,title:string,color:string,style=LineStyle.Solid)=>{if(Number(price)>0)series.createPriceLine({price:Number(price),color,lineWidth:2,lineStyle:style,axisLabelVisible:true,title});};
  own(trade.entry_price,trade.status===0?'ORDER':'ENTRY','#4da3ff');own(trade.stop_loss,'SL','#ef6675',LineStyle.Dashed);own(trade.take_profit,'TP','#31c48d',LineStyle.Dashed);own(trade.exit_price,'EXIT','#b783ff',LineStyle.Dotted);

  const tradeIndex=nearestIndex(candles,occurred);const from=Math.max(0,tradeIndex-spec.before);const to=Math.min(candles.length-1+8,tradeIndex+spec.after);(chart.timeScale() as any).setVisibleLogicalRange({from,to});
  await waitPaint();
  const shot=chart.takeScreenshot();const out=document.createElement('canvas');out.width=shot.width;out.height=shot.height;const ctx=out.getContext('2d');if(!ctx)throw new Error('Canvas is unavailable');ctx.drawImage(shot,0,0);
  const visibleStart=candles[Math.max(0,from)]?.time??candles[0]!.time;const visibleEnd=candles[Math.min(candles.length-1,Math.floor(to))]?.time??candles.at(-1)!.time;const visibleRiskRewards=riskRewards.filter(item=>Math.max(item.startTime,item.endTime)>=visibleStart-step*2&&Math.min(item.startTime,item.endTime)<=visibleEnd+step*2);
  drawRiskRewards(ctx,chart,series,candles,visibleRiskRewards,step,shot.width/width,shot.height/height);
  const scaleX=shot.width/width,scaleY=shot.height/height;ctx.save();ctx.scale(scaleX,scaleY);ctx.fillStyle=light?'rgba(255,255,255,.88)':'rgba(10,15,22,.88)';ctx.fillRect(12,10,360,48);ctx.fillStyle=light?'#111827':'#e6edf7';ctx.font='600 16px sans-serif';ctx.fillText(`${symbol} · ${spec.label}`,22,30);ctx.font='12px sans-serif';ctx.fillStyle=light?'#526071':'#93a4b8';ctx.fillText(`${new Date(trade.occurred_at).toLocaleString()} · ${account}`,22,49);ctx.restore();
  chart.remove();host.remove();
  return canvasToFile(out,`auto-chart-${spec.label.toLowerCase()}-${symbol}-${trade.id}.png`);
}

export async function createJournalChartSnapshots(trade:SnapshotTrade,preferences:AppPreferences,intervals:SnapshotInterval[]){
  const files:File[]=[];
  for(const interval of intervals)files.push(await buildOne(trade,preferences,specs[interval]));
  return files;
}
