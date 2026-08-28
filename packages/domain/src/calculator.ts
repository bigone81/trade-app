import type { CalculatorInput, CalculatorResult } from '@trade/shared';

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
