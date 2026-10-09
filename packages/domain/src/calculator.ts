import type { CalculatorInput, CalculatorResult, EntryFeeMode, ExecutionMode, FeeLiquidity, FeeRates, Side } from '@trade/shared';

export const isValidFeeRate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0.01;

export function resolveEntryFee(executionMode: ExecutionMode, mode: EntryFeeMode, manual: FeeLiquidity): FeeLiquidity {
  return mode === 'manual' ? manual : executionMode === 'limit' || executionMode === 'stop_limit' ? 'maker' : 'taker';
}

export interface TradeFinanceInput {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  balance: number;
  riskPercent: number;
  includeFees: boolean;
  entryLiquidity: FeeLiquidity;
  rates: FeeRates;
  /** Evaluate a normalized position instead of sizing a new one. */
  quantity?: number;
}

/** Linear USDT contracts. Protective SL/TP orders in the current model are Market. */
export function calculateTradeFinance(input: TradeFinanceInput) {
  const { side, entry, stop, target, balance, riskPercent, includeFees, rates, entryLiquidity } = input;
  if (![entry, stop, target, balance, riskPercent].every(Number.isFinite)
    || Math.min(entry, stop, target) <= 0 || balance <= 0 || riskPercent <= 0
    || !isValidFeeRate(rates.maker) || !isValidFeeRate(rates.taker)
    || !['Buy', 'Sell'].includes(side) || !['maker', 'taker'].includes(entryLiquidity)
    || typeof includeFees !== 'boolean') throw new Error('Invalid sizing inputs or fee rates (allowed: 0–1%).');
  if (!(side === 'Buy' ? stop < entry && target > entry : stop > entry && target < entry)) {
    throw new Error('Invalid SL/TP geometry.');
  }
  const riskBudget = balance * riskPercent / 100;
  const priceRiskPerUnit = Math.abs(entry - stop);
  const totalRiskPerUnit = priceRiskPerUnit + entry * rates[entryLiquidity] + stop * rates.taker;
  const positionSize = input.quantity ?? riskBudget / (includeFees ? totalRiskPerUnit : priceRiskPerUnit);
  if (!Number.isFinite(positionSize) || positionSize <= 0) throw new Error('Invalid position quantity.');
  const priceLoss = positionSize * priceRiskPerUnit;
  const entryFee = positionSize * entry * rates[entryLiquidity];
  const stopFee = positionSize * stop * rates.taker;
  const tpFee = positionSize * target * rates.taker;
  const totalLoss = priceLoss + entryFee + stopFee;
  const grossProfit = positionSize * Math.abs(target - entry);
  const netProfit = grossProfit - entryFee - tpFee;
  const result = {
    riskBudget, priceRiskPerUnit, totalRiskPerUnit, positionSize, notional: positionSize * entry,
    priceLoss, entryFee, stopFee, tpFee, totalLoss, grossProfit, netProfit,
    grossRR: Math.abs(target - entry) / priceRiskPerUnit, netRR: netProfit / totalLoss,
    takerEntryLoss: priceLoss + positionSize * entry * rates.taker + stopFee,
  };
  if (!Object.values(result).every(Number.isFinite)) throw new Error('Sizing inputs exceed numeric limits.');
  return result;
}

export type TradeFinance = ReturnType<typeof calculateTradeFinance>;

const signed = (side: 'Buy' | 'Sell') => side === 'Sell' ? -1 : 1;

export function calculateTrade(input: CalculatorInput): CalculatorResult {
  const {
    mode, stopMode, side, balance, riskPercent, atr, priceLevel, currentPrice,
    triggerAtrPercent, slipAtrPercent, stopAtrPercent, technicalStop, rr,
  } = input;
  const dir = signed(side);
  const atrTrigger = atr * triggerAtrPercent * 0.01;
  const atrSlip = atr * slipAtrPercent * 0.01;
  const atrStop = atr * stopAtrPercent * 0.01;

  let triggerPoint = 0;
  let entry = currentPrice;
  let stop = technicalStop;
  let pointType: CalculatorResult['pointType'];
  let orderType: CalculatorResult['orderType'];

  if (mode === 'stop') {
    pointType = stopMode === 'atr' ? 10 : 11;
    orderType = 'Limit';
    triggerPoint = priceLevel + dir * atrTrigger;
    entry = priceLevel + dir * (atrTrigger + atrSlip);
    stop = stopMode === 'atr' ? entry - dir * atrStop : technicalStop;
  } else if (mode === 'limit') {
    pointType = stopMode === 'atr' ? 20 : 21;
    orderType = 'Limit';
    entry = priceLevel + dir * atrSlip;
    stop = stopMode === 'atr' ? entry - dir * atrStop : technicalStop;
  } else {
    pointType = stopMode === 'atr' ? 30 : 31;
    orderType = 'Market';
    entry = stopMode === 'atr' ? currentPrice + dir * atrSlip : currentPrice;
    stop = stopMode === 'atr' ? entry - dir * atrStop : technicalStop;
  }

  const stopDistance = Math.abs(entry - stop);
  if (!Number.isFinite(stopDistance) || stopDistance <= 0) {
    return {
      pointType, orderType, triggerPoint, entry, stop, target: entry,
      riskAmount: 0, positionSize: 0, notional: 0, stopPercent: 0,
      targetPercent: 0, rr,
    };
  }

  const target = entry + dir * stopDistance * rr;
  const riskAmount = Math.max(0, riskPercent) * 0.01 * Math.max(0, balance);
  const positionSize = riskAmount / stopDistance;
  const notional = positionSize * entry;
  const stopPercent = entry === 0 ? 0 : stopDistance / entry * 100;
  const targetPercent = entry === 0 ? 0 : Math.abs(target - entry) / entry * 100;

  return {
    pointType, orderType, triggerPoint, entry, stop, target, riskAmount,
    positionSize, notional, stopPercent, targetPercent, rr,
  };
}

export function calculateRiskReward(entry: number, stop: number, target: number) {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return {
    risk,
    reward,
    ratio: risk > 0 ? reward / risk : 0,
    direction: target >= entry ? 'long' as const : 'short' as const,
  };
}
