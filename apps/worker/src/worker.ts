import { WebsocketClient } from 'bybit-api';
import { appendSystemEvent, listAlerts, openDatabase } from '@trade/database';

const db=openDatabase(process.env.DATABASE_PATH || './data/trade.sqlite');
const telegramToken=process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId=process.env.TELEGRAM_CHAT_ID || '';
const publicUrl=process.env.PUBLIC_APP_URL || '';

async function telegram(text:string) {
  if(!telegramToken || !telegramChatId) return false;
  const r=await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:telegramChatId,text,parse_mode:'HTML',disable_web_page_preview:true})
  });
  if(!r.ok) throw new Error(`Telegram HTTP ${r.status}: ${await r.text()}`);
  return true;
}

const publicWs=new WebsocketClient();
const subscribed=new Set<string>();
const latest=new Map<string,number>();

publicWs.on('open',(e:any)=>appendSystemEvent(db,{eventType:'ws.public.open',message:`Public WebSocket connected (${e?.wsKey || 'linear'})`}));
publicWs.on('reconnect',(e:any)=>appendSystemEvent(db,{severity:'warning',eventType:'ws.public.reconnect',message:`Public WebSocket reconnecting (${e?.wsKey || 'linear'})`}));
publicWs.on('reconnected',(e:any)=>appendSystemEvent(db,{eventType:'ws.public.reconnected',message:`Public WebSocket reconnected (${e?.wsKey || 'linear'})`}));
publicWs.on('exception',(e:any)=>appendSystemEvent(db,{severity:'error',eventType:'ws.public.error',message:'Public WebSocket error',payload:{message:e?.message || String(e)}}));

function crossed(a:number,b:number,target:number){return (a<=target&&b>=target)||(a>=target&&b<=target);}
async function onPrice(symbol:string,price:number){
  const previous=latest.get(symbol); latest.set(symbol,price);
  const alerts=listAlerts(db,symbol,true);
  for(const a of alerts){
    const distance=Math.abs(price-a.price)/a.price*100;
    if(a.preAlertPercent!==null && !a.preAlertedAt && distance<=a.preAlertPercent){
      db.prepare('UPDATE alerts SET pre_alerted_at=CURRENT_TIMESTAMP,last_price=? WHERE id=?').run(price,a.id);
      const msg=`🟡 <b>${symbol}</b> приближается к уровню\n\nУровень: <b>${a.price}</b>\nЦена: ${price}\nРасстояние: ${distance.toFixed(3)}%`;
      if(a.telegramEnabled) await telegram(msg).catch(err=>appendSystemEvent(db,{severity:'error',eventType:'telegram.error',symbol,message:err.message}));
    }
    if(previous===undefined){db.prepare('UPDATE alerts SET last_price=? WHERE id=?').run(price,a.id);continue;}
    const hit=a.condition==='cross_up' ? previous<a.price&&price>=a.price : a.condition==='cross_down' ? previous>a.price&&price<=a.price : crossed(previous,price,a.price)||distance<=0.02;
    if(!hit){db.prepare('UPDATE alerts SET last_price=? WHERE id=?').run(price,a.id);continue;}
    db.prepare(`UPDATE alerts SET last_price=?,triggered_at=CURRENT_TIMESTAMP,active=CASE WHEN trigger_once=1 THEN 0 ELSE active END WHERE id=?`).run(price,a.id);
    appendSystemEvent(db,{eventType:'alert.triggered',symbol,message:`${symbol} reached ${a.price}`,payload:{alertId:a.id,price}});
    if(a.telegramEnabled){
      const link=publicUrl?`\n\n${publicUrl}/?symbol=${encodeURIComponent(symbol)}`:'';
      await telegram(`🔔 <b>${symbol}</b>\n\nУровень достигнут: <b>${a.price}</b>\nЦена: ${price}${link}`).catch(err=>appendSystemEvent(db,{severity:'error',eventType:'telegram.error',symbol,message:err.message}));
    }
  }
}

publicWs.on('update',(data:any)=>{
  const topic=String(data?.topic || '');
  if(!topic.startsWith('tickers.')) return;
  const symbol=topic.slice('tickers.'.length);
  const payload=Array.isArray(data.data)?data.data[0]:data.data;
  const price=Number(payload?.lastPrice);
  if(Number.isFinite(price)&&price>0) void onPrice(symbol,price);
});

function refreshSubscriptions(){
  const symbols=[...new Set(listAlerts(db,undefined,true).map(a=>a.symbol))];
  for(const symbol of symbols){if(!subscribed.has(symbol)){publicWs.subscribeV5(`tickers.${symbol}`,'linear');subscribed.add(symbol);}}
  for(const symbol of [...subscribed]){if(!symbols.includes(symbol)){publicWs.unsubscribeV5(`tickers.${symbol}`,'linear');subscribed.delete(symbol);latest.delete(symbol);}}
}
refreshSubscriptions(); setInterval(refreshSubscriptions,5000);

for(let id=1;id<=5;id++){
  const prefix=`BYBIT_ACCOUNT${id}_`;
  const key=process.env[`${prefix}KEY`] || ''; const secret=process.env[`${prefix}SECRET`] || '';
  if(!key||!secret) continue;
  const name=process.env[`${prefix}NAME`] || `Account ${id}`;
  const demo=['1','true','yes','on'].includes((process.env[`${prefix}DEMO`]||'').toLowerCase());
  const ws=new WebsocketClient({key,secret,demoTrading:demo});
  ws.on('open',()=>appendSystemEvent(db,{eventType:'ws.private.open',accountId:id,message:`${name} private WebSocket connected`}));
  ws.on('reconnect',()=>appendSystemEvent(db,{severity:'warning',eventType:'ws.private.reconnect',accountId:id,message:`${name} private WebSocket reconnecting`}));
  ws.on('exception',(e:any)=>appendSystemEvent(db,{severity:'error',eventType:'ws.private.error',accountId:id,message:`${name} WebSocket error`,payload:{message:e?.message||String(e)}}));
  ws.on('update',(data:any)=>{
    const topic=String(data?.topic||'');
    if(!['order','execution','position','wallet'].includes(topic)) return;
    appendSystemEvent(db,{eventType:`bybit.${topic}.update`,accountId:id,symbol:Array.isArray(data?.data)&&data.data[0]?.symbol?data.data[0].symbol:null,message:`${name}: ${topic} update`,payload:data?.data});
    if(topic==='execution' && telegramToken && telegramChatId){
      const rows=Array.isArray(data.data)?data.data:[];
      for(const x of rows){void telegram(`✅ <b>${name}</b> · ${x.symbol}\n${x.side} ${x.execQty} @ ${x.execPrice}`).catch(()=>{});}
    }
  });
  ws.subscribeV5(['order','execution','position','wallet'],'linear');
}

appendSystemEvent(db,{eventType:'worker.started',message:'Alert/Bybit worker started'});
console.log('Trade worker started');
