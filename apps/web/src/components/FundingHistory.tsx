import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useI18n } from '../i18n';

type FundingRow = {
  id: string;
  accountId: number;
  accountName: string;
  symbol: string;
  currency: string;
  amount: number;
  time: number;
};
type FundingResponse = {
  rows: FundingRow[];
  totalFundingUsdt: number;
  currency: 'USDT';
  periodStart: number;
  periodEnd: number;
  truncated: boolean;
  errors: {accountId: number;error: string}[];
};

/** Account/symbol funding ledger. Never attribute funding to one order by matching symbol alone. */
export default function FundingHistory({accountId,symbol}:{accountId:number;symbol:string}) {
  const {language}=useI18n();
  const uk=language==='uk',ru=language==='ru';
  const label=(ua:string,rus:string,en:string)=>uk?ua:ru?rus:en;
  const params=new URLSearchParams();
  if(accountId)params.set('accountId',String(accountId));
  if(symbol.trim())params.set('symbol',symbol.trim().toUpperCase());
  const qs=params.toString();
  const query=useQuery<FundingResponse>({
    queryKey:['journal-funding',qs],
    queryFn:()=>api(`/api/journal/funding${qs?`?${qs}`:''}`),
    staleTime:60_000,
    refetchOnWindowFocus:false,
  });
  const result=query.data;
  const cash=(amount:number)=>`${amount>=0?'+':''}${amount.toFixed(4)} USDT`;
  const date=(value:number)=>new Date(value).toLocaleString(uk?'uk-UA':ru?'ru-RU':'en-US');
  return <div className="card table-card journal-table-card">
    <div style={{padding:'14px 18px'}}>
      <h3>{label('Фінансування','Финансирование','Funding')}</h3>
      <p className="muted">{label('Фактичні нарахування Bybit за останні 7 днів. Додатна сума — отримано, від’ємна — сплачено.','Фактические начисления Bybit за последние 7 дней. Положительная сумма — получено, отрицательная — уплачено.','Actual Bybit funding for the last 7 days. Positive means received; negative means paid.')}</p>
      {query.isPending&&<p>{label('Завантаження…','Загрузка…','Loading…')}</p>}
      {query.isError&&<p className="negative">{query.error instanceof Error?query.error.message:String(query.error)}</p>}
      {result&&<>
        <h3 className={result.totalFundingUsdt<0?'negative':'positive'}>{label('Вплив фінансування на PnL','Влияние финансирования на PnL','Funding impact on PnL')}: {cash(result.totalFundingUsdt)}</h3>
        <p className="muted">{date(result.periodStart)} — {date(result.periodEnd)} · USDT. {label('Це окремий грошовий результат, не PnL окремого ордера.','Это отдельный денежный результат, не PnL отдельного ордера.','This is a separate cash result, not a particular order’s PnL.')}</p>
        {(result.truncated||result.errors.length>0)&&<p className="negative">{label('Увага: підсумок неповний (обмеження сторінок або помилка запиту акаунта).','Внимание: итог неполный (лимит страниц или ошибка запроса аккаунта).','Attention: total incomplete (page limit or account error).')}{result.errors.map(e=>` ${e.accountId}: ${e.error}`).join('; ')}</p>}
        <table className="data-table journal-table"><thead><tr><th>{label('Дата','Дата','Date')}</th><th>{label('Акаунт','Аккаунт','Account')}</th><th>{label('Тікер','Тикер','Symbol')}</th><th>{label('Нарахування','Начисление','Funding')}</th></tr></thead><tbody>
          {result.rows.map(row=><tr key={`${row.accountId}:${row.id}:${row.time}:${row.symbol}`}><td>{date(row.time)}</td><td>{row.accountName}</td><td>{row.symbol}</td><td className={row.amount<0?'negative':'positive'}>{cash(row.amount)}</td></tr>)}
        </tbody></table>
        {!result.rows.length&&<p className="muted">{label('Нарахувань немає за вибраний період і фільтри.','Нет начислений за выбранный период и фильтры.','No funding transactions for this period and filters.')}</p>}
      </>}
    </div>
  </div>;
}
