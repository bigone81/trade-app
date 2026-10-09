import { DEFAULT_FEE_RATES, type AccountPublic, type FeeLiquidity, type FeeRates } from '@trade/shared';
import { isValidFeeRate, type TradeFinance } from '@trade/domain';
import type { AppPreferences } from '../preferences';
import { useI18n } from '../i18n';
import { money, num } from '../api';

type Fees = AppPreferences['calculatorFees'];
interface FeeRow {
  account: AccountPublic;
  finance: TradeFinance | null;
  rates: FeeRates;
  feeSource: 'exchange' | 'manual' | 'fallback';
}

export default function CalculatorFees({ fees, onChange, usesLimitPrice, entryLiquidity, rows }: {
  fees: Fees; onChange: (next: Fees) => void; usesLimitPrice: boolean; entryLiquidity: FeeLiquidity; rows: FeeRow[];
}) {
  const { t } = useI18n();
  const postOnly = usesLimitPrice && fees.postOnly;
  const rateInputs = (rates: FeeRates, update: (value: FeeRates) => void, label: string) => <div className="field-grid">
    {(['maker', 'taker'] as const).map(kind => <div className="field" key={kind}>
      <label>{kind === 'maker' ? 'Maker' : 'Taker'} %</label>
      <input className="input" type="number" min="0" max="1" step="0.001" aria-label={`${label} ${kind} %`}
        value={Number((rates[kind] * 100).toFixed(6))} onChange={event => {
          const value = Number(event.target.value) / 100;
          if (event.target.value !== '' && isValidFeeRate(value)) update({ ...rates, [kind]: value });
        }} />
    </div>)}
  </div>;
  return <section className="calculator-fees drawer-section" aria-label={t('Trading fees')}>
    <label className="setting-check"><input type="checkbox" checked={fees.includeFees}
      onChange={e => onChange({ ...fees, includeFees: e.target.checked })} />{t('Include fees in risk')}</label>
    <div className="field-grid">
      <div className="field"><label>{t('Entry fee mode')}</label><select className="select" value={fees.entryMode}
        onChange={e => onChange({ ...fees, entryMode: e.target.value as Fees['entryMode'] })}>
        <option value="auto">{t('Auto')}</option><option value="manual">{t('Manual')}</option>
      </select></div>
      <div className="field"><label>{t('Entry fee')}</label><select className="select" disabled={fees.entryMode === 'auto'} value={entryLiquidity}
        onChange={e => onChange({ ...fees, manualEntry: e.target.value as FeeLiquidity })}>
        <option value="maker">Maker{!postOnly ? ` · ${t('expected')}` : ''}</option><option value="taker">Taker</option>
      </select></div>
    </div>
    {usesLimitPrice && <label className="setting-check"><input type="checkbox" checked={fees.postOnly}
      onChange={e => onChange({ ...fees, postOnly: e.target.checked })} />{t('Maker only (Post-Only)')}</label>}
    {postOnly ? <p className="fee-note">{t('Post-Only may cancel the order if it would execute immediately.')}</p>
      : entryLiquidity === 'maker' && <p className="fee-warning">{t('Maker is expected, not assured. Immediate execution may incur Taker fees.')}</p>}
    <details className="fee-rate-settings"><summary>{t('Manual fee rates')}</summary>
      <label className="setting-check"><input type="checkbox" checked={!!fees.manualRates}
        onChange={e => onChange({ ...fees, manualRates: e.target.checked ? { ...DEFAULT_FEE_RATES } : null })} />{t('Override rates for all accounts')}</label>
      {fees.manualRates && rateInputs(fees.manualRates, value => onChange({ ...fees, manualRates: value }), t('All accounts'))}
      <p className="fee-note">{t('Account overrides take priority. Turn off overrides to use exchange or fallback rates.')}</p>
    </details>
    {rows.map(row => {
      const f = row.finance;
      const override = fees.accountRates[String(row.account.id)];
      const source = row.feeSource === 'exchange' ? t('Bybit confirmed') : row.feeSource === 'manual' ? t('Manual rates') : t('Fallback rates (unconfirmed)');
      return <div key={row.account.id} className="calculator-fee-account">
        <strong>{row.account.name}</strong><small className="fee-note">{source}</small>
        <div className="fee-rate-line">{t('Entry fee')}: {entryLiquidity === 'maker' ? 'Maker' : 'Taker'} {(row.rates[entryLiquidity] * 100).toFixed(3)}%</div>
        <div className="fee-rate-line">SL: Taker {(row.rates.taker * 100).toFixed(3)}% · TP: Taker {(row.rates.taker * 100).toFixed(3)}%</div>
        <details className="fee-rate-settings"><summary>{t('Account fee rates')}</summary>
          <label className="setting-check"><input type="checkbox" checked={!!override} onChange={e => {
            const accountRates = { ...fees.accountRates };
            if (e.target.checked) accountRates[String(row.account.id)] = { maker: row.rates.maker, taker: row.rates.taker };
            else delete accountRates[String(row.account.id)];
            onChange({ ...fees, accountRates });
          }} />{t('Override this account')}</label>
          {override && rateInputs(override, value => onChange({ ...fees, accountRates: { ...fees.accountRates, [String(row.account.id)]: value } }), row.account.name)}
        </details>
        {f && <>
          <dl className="fee-results">
            <dt>{t('Risk budget')}</dt><dd>{money(f.riskBudget)}</dd>
            <dt>{t('Planned price loss')}</dt><dd>{money(f.priceLoss)}</dd>
            <dt>{t('Entry fee')}</dt><dd>{money(f.entryFee)}</dd>
            <dt>{t('SL exit fee')}</dt><dd>{money(f.stopFee)}</dd>
            <dt>{t('TP exit fee')}</dt><dd>{money(f.tpFee)}</dd>
            <dt>{t('Total planned risk')}</dt><dd>{money(f.totalLoss)}</dd>
            <dt>{t('Expected net TP profit')}</dt><dd>{money(f.netProfit)}</dd>
            <dt>Gross R:R</dt><dd>1:{f.grossRR.toFixed(2)}</dd>
            <dt>Net R:R</dt><dd>1:{f.netRR.toFixed(2)}</dd>
            <dt>{t('Position qty')}</dt><dd>{num(f.positionSize, 8)}</dd>
            <dt>{t('Notional')}</dt><dd>{money(f.notional)}</dd>
          </dl>
          {!fees.includeFees && f.totalLoss > f.riskBudget + 1e-8 && <p className="fee-warning">{t('Over risk budget')}: +{money(f.totalLoss - f.riskBudget)}</p>}
          {!postOnly && entryLiquidity === 'maker' && f.takerEntryLoss > f.totalLoss + 1e-8 && <p className="fee-warning">{t('Planned risk with Taker entry')}: {money(f.takerEntryLoss)}</p>}
        </>}
      </div>;
    })}
    <p className="fee-note">{t('Planned risk uses the estimated entry price. Actual fills may differ. Funding and slippage are additional costs.')}</p>
  </section>;
}
