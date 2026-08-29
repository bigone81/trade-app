import { WebsocketClient } from 'bybit-api';
import {
  appendSystemEvent,
  createNotification,
  getNotificationSettings,
  listAlerts,
  markNotificationTelegram,
  openDatabase,
  recordJournalBybitExecution,
  syncJournalBybitOrder,
  type NotificationRecord,
} from '@trade/database';

const db=openDatabase(process.env.DATABASE_PATH || './data/trade.sqlite');
const telegramToken=process.env.TELEGRAM_BOT_TOKEN || '';
const telegramChatId=process.env.TELEGRAM_CHAT_ID || '';
const publicUrl=(process.env.PUBLIC_APP_URL || '').replace(/\/$/,'');

async function telegram(text:string) {
  if(!telegramToken || !telegramChatId) return false;
  const r=await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:telegramChatId,text,parse_mode:'HTML',disable_web_page_preview:true})
  });
  if(!r.ok) throw new Error(`Telegram HTTP ${r.status}: ${await r.text()}`);
  return true;
}

async function deliverTelegram(notification:NotificationRecord|null,text:string,enabled:boolean){
  if(!notification || !enabled)return;
  if(!telegramToken || !telegramChatId){markNotificationTelegram(db,notification.id,'not_configured');return;}
  try{await telegram(text);markNotificationTelegram(db,notification.id,'sent');}
  catch(e){const message=e instanceof Error?e.message:String(e);markNotificationTelegram(db,notification.id,'error',message);appendSystemEvent(db,{severity:'error',eventType:'telegram.error',accountId:notification.accountId,symbol:notification.symbol,message});}
}

const publicWs=new WebsocketClient();
const subscribed=new Set<string>();
const latest=new Map<string,number>();

type ConnectionState={timer:ReturnType<typeof setTimeout>|null;offlineAt:number;notified:boolean;title:string;accountId?:number;accountName?:string};
const connections=new Map<string,ConnectionState>();

function scheduleOffline(key:string,input:{title:string;accountId?:number;accountName?:string}){
  const previous=connections.get(key);if(previous?.timer)return;
  const state:ConnectionState={timer:null,offlineAt:Date.now(),notified:false,...input};
  const settings=getNotificationSettings(db);
  state.timer=setTimeout(()=>{
    state.timer=null;
    if(!settings.systemOffline)return;
    const message=`${state.title} не отвечает более ${settings.systemOfflineSeconds} сек.`;
    const n=createNotification(db,{category:'system',eventType:'connection.offline',severity:'warning',title:'Проблема соединения',message,accountId:state.accountId??null,accountName:state.accountName??null,actionUrl:'/settings',dedupeKey:`offline:${key}:${state.offlineAt}`});
    state.notified=Boolean(n);connections.set(key,state);
    void deliverTelegram(n,`⚠️ <b>Проблема соединения</b>\n\n${message}`,settings.telegramSystem);
  },settings.systemOfflineSeconds*1000);
  connections.set(key,state);
}

function restored(key:string,input:{title:string;accountId?:number;accountName?:string}){
  const state=connections.get(key);
  if(state?.timer)clearTimeout(state.timer);
  if(state?.notified){
    const settings=getNotificationSettings(db);
    if(settings.systemReconnect){
      const downtime=Math.max(1,Math.round((Date.now()-state.offlineAt)/1000));
      const message=`${input.title} восстановлено. Простой: ${downtime} сек.`;
      const n=createNotification(db,{category:'system',eventType:'connection.restored',severity:'info',title:'Соединение восстановлено',message,accountId:input.accountId??null,accountName:input.accountName??null,actionUrl:'/settings',dedupeKey:`restored:${key}:${state.offlineAt}`});
      void deliverTelegram(n,`✅ <b>Соединение восстановлено</b>\n\n${message}`,settings.telegramSystem);
    }
  }
  connections.delete(key);
}

publicWs.on('open',(e:any)=>{restored('public',{title:'Bybit market data'});appendSystemEvent(db,{eventType:'ws.public.open',message:`Public WebSocket connected (${e?.wsKey || 'linear'})`});});
publicWs.on('reconnect',(e:any)=>{scheduleOffline('public',{title:'Bybit market data'});appendSystemEvent(db,{severity:'warning',eventType:'ws.public.reconnect',message:`Public WebSocket reconnecting (${e?.wsKey || 'linear'})`});});
publicWs.on('reconnected',(e:any)=>{restored('public',{title:'Bybit market data'});appendSystemEvent(db,{eventType:'ws.public.reconnected',message:`Public WebSocket reconnected (${e?.wsKey || 'linear'})`});});
publicWs.on('exception',(e:any)=>appendSystemEvent(db,{severity:'error',eventType:'ws.public.error',message:'Public WebSocket error',payload:{message:e?.message || String(e)}}));

function crossed(a:number,b:number,target:number){return (a<=target&&b>=target)||(a>=target&&b<=target);}
async function onPrice(symbol:string,price:number){
  const previous=latest.get(symbol);latest.set(symbol,price);
  const alerts=listAlerts(db,symbol,true);
  const settings=getNotificationSettings(db);
  for(const a of alerts){
    const distance=Math.abs(price-a.price)/a.price*100;
    if(settings.marketPreAlerts && a.preAlertPercent!==null && !a.preAlertedAt && distance<=a.preAlertPercent){
      db.prepare('UPDATE alerts SET pre_alerted_at=CURRENT_TIMESTAMP,last_price=? WHERE id=?').run(price,a.id);
      const message=`${symbol} приближается к ${a.price}. Цена ${price}, расстояние ${distance.toFixed(3)}%.`;
      const n=createNotification(db,{category:'market',eventType:'alert.pre',severity:'info',title:`${symbol} приближается к уровню`,message,symbol,actionUrl:`/?symbol=${encodeURIComponent(symbol)}`,payload:{alertId:a.id,level:a.price,price,distance}});
      void deliverTelegram(n,`🟡 <b>${symbol}</b> приближается к уровню\n\nУровень: <b>${a.price}</b>\nЦена: ${price}\nРасстояние: ${distance.toFixed(3)}%`,a.telegramEnabled&&settings.telegramMarket);
    }
    if(previous===undefined){db.prepare('UPDATE alerts SET last_price=? WHERE id=?').run(price,a.id);continue;}
    const hit=a.condition==='cross_up' ? previous<a.price&&price>=a.price : a.condition==='cross_down' ? previous>a.price&&price<=a.price : crossed(previous,price,a.price)||distance<=0.02;
    if(!hit){db.prepare('UPDATE alerts SET last_price=? WHERE id=?').run(price,a.id);continue;}
    db.prepare(`UPDATE alerts SET last_price=?,triggered_at=CURRENT_TIMESTAMP,active=CASE WHEN trigger_once=1 THEN 0 ELSE active END WHERE id=?`).run(price,a.id);
    appendSystemEvent(db,{eventType:'alert.triggered',symbol,message:`${symbol} reached ${a.price}`,payload:{alertId:a.id,price}});
    if(settings.marketAlerts){
      const message=`${symbol} достиг уровня ${a.price}. Текущая цена ${price}.`;
      const n=createNotification(db,{category:'market',eventType:'alert.triggered',severity:'info',title:`${symbol} · уровень достигнут`,message,symbol,actionUrl:`/?symbol=${encodeURIComponent(symbol)}`,payload:{alertId:a.id,level:a.price,price,sourceType:a.sourceType}});
      const link=publicUrl?`\n\n${publicUrl}/?symbol=${encodeURIComponent(symbol)}`:'';
      void deliverTelegram(n,`🔔 <b>${symbol}</b>\n\nУровень достигнут: <b>${a.price}</b>\nЦена: ${price}${link}`,a.telegramEnabled&&settings.telegramMarket);
    }
  }
}

publicWs.on('update',(data:any)=>{
  const topic=String(data?.topic || '');if(!topic.startsWith('tickers.'))return;
  const symbol=topic.slice('tickers.'.length);const payload=Array.isArray(data.data)?data.data[0]:data.data;const price=Number(payload?.lastPrice);
  if(Number.isFinite(price)&&price>0)void onPrice(symbol,price);
});

function refreshSubscriptions(){
  const symbols=[...new Set(listAlerts(db,undefined,true).map(a=>a.symbol))];
  for(const symbol of symbols)if(!subscribed.has(symbol)){publicWs.subscribeV5(`tickers.${symbol}`,'linear');subscribed.add(symbol);}
  for(const symbol of [...subscribed])if(!symbols.includes(symbol)){publicWs.unsubscribeV5(`tickers.${symbol}`,'linear');subscribed.delete(symbol);latest.delete(symbol);}
}
refreshSubscriptions();setInterval(refreshSubscriptions,5000);

function tradingNotification(id:number,name:string,x:any){
  const status=String(x.orderStatus||'');
  const settings=getNotificationSettings(db);
  const symbol=String(x.symbol||'');const orderId=String(x.orderId||'');const cum=String(x.cumExecQty||'0');
  let enabled=false;let title='';let severity='info';
  if(status==='New'){enabled=settings.tradingAccepted;title='Ордер принят';}
  else if(status==='Untriggered'){enabled=settings.tradingAccepted;title='Условный ордер принят';}
  else if(status==='Filled'){enabled=settings.tradingFilled;const stopType=String(x.stopOrderType||x.createType||'').toLowerCase();title=stopType.includes('stoploss')?'Stop Loss исполнен':stopType.includes('takeprofit')?'Take Profit исполнен':x.reduceOnly?'Закрытие позиции исполнено':'Ордер исполнен';}
  else if(status==='PartiallyFilled'){enabled=settings.tradingPartial;title='Частичное исполнение';}
  else if(['Cancelled','Deactivated','PartiallyFilledCanceled'].includes(status)){enabled=settings.tradingCancelled;title='Ордер отменён';}
  else if(status==='Rejected'){enabled=settings.tradingRejected;title='Ордер отклонён';severity='warning';}
  if(!enabled||!title)return;
  const avg=Number(x.avgPrice)||Number(x.price)||0;const qty=Number(x.cumExecQty)||Number(x.qty)||0;
  const message=`${name} · ${symbol} · ${x.side||''} ${qty}${avg?` @ ${avg}`:''} · ${status}`;
  const n=createNotification(db,{category:'trading',eventType:`order.${status.toLowerCase()}`,severity,title,message,accountId:id,accountName:name,symbol,actionUrl:'/trade',payload:x,dedupeKey:`bybit:order:${id}:${orderId}:${status}:${cum}`});
  const icon=severity==='warning'?'⚠️':(['New','Untriggered'].includes(status)?'🟦':'✅');
  void deliverTelegram(n,`${icon} <b>${title}</b>\n\nBybit · ${name}\n<b>${symbol}</b> ${x.side||''}\n${qty?`Qty: ${qty}\n`:''}${avg?`Цена: ${avg}\n`:''}Статус: ${status}`,settings.telegramTrading);
}

for(let id=1;id<=5;id++){
  const prefix=`BYBIT_ACCOUNT${id}_`;const key=process.env[`${prefix}KEY`]||'';const secret=process.env[`${prefix}SECRET`]||'';if(!key||!secret)continue;
  const name=process.env[`${prefix}NAME`]||`Account ${id}`;const demo=['1','true','yes','on'].includes((process.env[`${prefix}DEMO`]||'').toLowerCase());
  const ws=new WebsocketClient({key,secret,demoTrading:demo});const connKey=`private:${id}`;const conn={title:`Bybit · ${name}`,accountId:id,accountName:name};
  ws.on('open',()=>{restored(connKey,conn);appendSystemEvent(db,{eventType:'ws.private.open',accountId:id,message:`${name} private WebSocket connected`});});
  ws.on('reconnect',()=>{scheduleOffline(connKey,conn);appendSystemEvent(db,{severity:'warning',eventType:'ws.private.reconnect',accountId:id,message:`${name} private WebSocket reconnecting`});});
  ws.on('reconnected',()=>{restored(connKey,conn);appendSystemEvent(db,{eventType:'ws.private.reconnected',accountId:id,message:`${name} private WebSocket reconnected`});});
  ws.on('exception',(e:any)=>appendSystemEvent(db,{severity:'error',eventType:'ws.private.error',accountId:id,message:`${name} WebSocket error`,payload:{message:e?.message||String(e)}}));
  ws.on('update',(data:any)=>{
    const topic=String(data?.topic||'');if(!['order','execution','position','wallet'].includes(topic))return;
    appendSystemEvent(db,{eventType:`bybit.${topic}.update`,accountId:id,symbol:Array.isArray(data?.data)&&data.data[0]?.symbol?data.data[0].symbol:null,message:`${name}: ${topic} update`,payload:data?.data});
    const rows=Array.isArray(data.data)?data.data:[];
    if(topic==='order')for(const x of rows){syncJournalBybitOrder(db,{accountId:id,accountName:name,order:x});tradingNotification(id,name,x);}
    if(topic==='execution')for(const x of rows)recordJournalBybitExecution(db,{accountId:id,accountName:name,execution:x});
  });
  ws.subscribeV5(['order','execution','position','wallet'],'linear');
}

appendSystemEvent(db,{eventType:'worker.started',message:'Alert/Bybit worker started'});
console.log('Trade worker started');
