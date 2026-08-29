import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, CircleAlert, CircleCheck, TrendingUp, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { localizeNotification, useI18n } from '../i18n';

type NotificationRow={
  id:number;category:'market'|'trading'|'system';eventType:string;severity:string;title:string;message:string;accountName:string|null;symbol:string|null;actionUrl:string|null;readAt:string|null;createdAt:string;payload?:any;
};

const when=(iso:string,language:'en'|'uk'|'ru',nowLabel:string)=>{
  const ms=Date.now()-new Date(iso).getTime();
  if(ms<60_000)return nowLabel;
  if(ms<3_600_000)return `${Math.floor(ms/60_000)}m`;
  if(ms<86_400_000)return `${Math.floor(ms/3_600_000)}h`;
  return new Date(iso).toLocaleDateString(language==='uk'?'uk-UA':language==='ru'?'ru-RU':'en-US');
};

function Icon({row}:{row:NotificationRow}){
  if(row.category==='market')return <TrendingUp size={15}/>;
  if(row.severity==='warning'||row.severity==='error')return <CircleAlert size={15}/>;
  return <CircleCheck size={15}/>;
}

export default function NotificationCenter(){
  const [open,setOpen]=useState(false);const qc=useQueryClient();const navigate=useNavigate();const{language,t}=useI18n();
  const count=useQuery<{count:number}>({queryKey:['notification-count'],queryFn:()=>api('/api/notifications/unread-count'),refetchInterval:3000});
  const rows=useQuery<NotificationRow[]>({queryKey:['notifications'],queryFn:()=>api('/api/notifications?limit=40'),refetchInterval:3000,enabled:open});
  const refresh=()=>{void qc.invalidateQueries({queryKey:['notifications']});void qc.invalidateQueries({queryKey:['notification-count']});};
  const read=useMutation({mutationFn:(id:number)=>api(`/api/notifications/${id}/read`,{method:'POST'}),onSuccess:refresh});
  const readAll=useMutation({mutationFn:()=>api('/api/notifications/read-all',{method:'POST'}),onSuccess:refresh});
  const go=(row:NotificationRow)=>{if(!row.readAt)read.mutate(row.id);setOpen(false);if(row.actionUrl)navigate(row.actionUrl);};
  const unread=count.data?.count??0;
  return <div className="notification-center">
    <button className={open?'notification-bell open':'notification-bell'} onClick={()=>setOpen(v=>!v)} title={t('Notifications')} aria-label={t('Notifications')}>
      <Bell size={18}/>{unread>0&&<span className="notification-badge">{unread>99?'99+':unread}</span>}
    </button>
    {open&&<div className="notification-popover card">
      <div className="notification-head"><div><strong>{t('Notifications')}</strong><small>{unread} {t('unread')}</small></div><div className="notification-head-actions"><button className="mini-btn" disabled={!unread||readAll.isPending} onClick={()=>readAll.mutate()}><CheckCheck size={13}/> {t('Read all')}</button><button className="icon-btn notification-close" onClick={()=>setOpen(false)}><X size={14}/></button></div></div>
      <div className="notification-list">
        {rows.isLoading&&<div className="notification-empty">{t('Loading…')}</div>}
        {!rows.isLoading&&!rows.data?.length&&<div className="notification-empty">{t('No notifications yet.')}</div>}
        {rows.data?.map(raw=>{const row=localizeNotification(raw,language);return <button key={row.id} className={row.readAt?'notification-row':'notification-row unread'} onClick={()=>go(row)}>
          <span className={`notification-icon ${row.category} ${row.severity}`}><Icon row={row}/></span>
          <span className="notification-copy"><span className="notification-title">{row.title}</span><span className="notification-message">{row.message}</span><span className="notification-meta">{[row.accountName,row.symbol,when(row.createdAt,language,t('now'))].filter(Boolean).join(' · ')}</span></span>
          {!row.readAt&&<span className="notification-unread-dot"/>}
        </button>})}
      </div>
    </div>}
  </div>;
}
