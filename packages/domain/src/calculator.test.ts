import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTrade, calculateTradeFinance, resolveEntryFee, type TradeFinanceInput } from './calculator.js';

const example: TradeFinanceInput = {
  side: 'Buy', entry: 1582.005, stop: 1576.2178912968, target: 1599.3663261093,
  balance: 93018.65, riskPercent: 0.5, includeFees: true, entryLiquidity: 'maker',
  rates: { maker: 0.0002, taker: 0.00055 },
};
const near = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('reference trade: price-only, Maker and Taker entry with unchanged geometry', () => {
  const snapshot = structuredClone(example);
  const old = calculateTradeFinance({ ...example, includeFees: false });
  const maker = calculateTradeFinance(example);
  const taker = calculateTradeFinance({ ...example, entryLiquidity: 'taker' });
  near(maker.riskBudget, 465.09325);
  near(old.positionSize, 80.36711834);
  near(maker.positionSize, 66.72375742);
  near(taker.positionSize, 61.81354789);
  near(maker.totalLoss, maker.riskBudget);
  near(taker.totalLoss, taker.riskBudget);
  near(maker.grossRR, 3);
  near(maker.netRR, 2.32, 0.005);
  near(taker.netRR, 2.07, 0.005);
  near(maker.entryFee, maker.positionSize * example.entry * example.rates.maker);
  near(maker.stopFee, maker.positionSize * example.stop * example.rates.taker);
  near(maker.tpFee, maker.positionSize * example.target * example.rates.taker);
  assert.ok(old.totalLoss > old.riskBudget);
  assert.ok(maker.takerEntryLoss > maker.totalLoss);
  near(old.netRR, maker.netRR);
  assert.deepEqual(example, snapshot);
});

test('Short uses exit notionals and supports net losses on very tight stops', () => {
  const short = calculateTradeFinance({ ...example, side: 'Sell', entry: 100, stop: 101, target: 97 });
  near(short.totalLoss, short.riskBudget);
  near(short.grossRR, 3);
  near(short.stopFee, short.positionSize * 101 * example.rates.taker);
  near(short.tpFee, short.positionSize * 97 * example.rates.taker);
  const tight = calculateTradeFinance({ ...example, entry: 100, stop: 99.999999, target: 100.000003 });
  near(tight.totalLoss, tight.riskBudget);
  assert.ok(tight.netProfit < 0);
  assert.ok(tight.positionSize < 10000);
});

test('invalid geometry, rates, nonfinite and nonpositive inputs cannot size orders', () => {
  for (const patch of [
    { stop: example.entry }, { stop: example.entry + 1 }, { target: example.entry }, { target: example.entry - 1 },
    { side: 'Sell' as const }, { entry: NaN }, { stop: Infinity }, { target: 0 }, { balance: 0 }, { riskPercent: -1 },
    { quantity: 0 }, { quantity: Infinity }, { rates: { maker: -0.01, taker: 0 } }, { rates: { maker: 0, taker: 0.02 } },
  ]) assert.throws(() => calculateTradeFinance({ ...example, ...patch }));
});

test('account rates, bases and risk percentages size independently', () => {
  const first = calculateTradeFinance(example);
  const second = calculateTradeFinance({ ...example, balance: 12000, riskPercent: 1, rates: { maker: 0.0001, taker: 0.0004 } });
  near(second.riskBudget, 120);
  near(second.totalLoss, 120);
  assert.notEqual(first.positionSize, second.positionSize);
  assert.notEqual(first.netRR, second.netRR);
  const zero = calculateTradeFinance({ ...example, rates: { maker: 0, taker: 0 } });
  near(zero.netRR, zero.grossRR);
});

test('Auto follows the resolved order type; Manual survives changes and switching back restores Auto', () => {
  for (const mode of ['limit', 'stop_limit', 'market', 'stop_market'] as const) {
    const auto = mode === 'limit' || mode === 'stop_limit' ? 'maker' : 'taker';
    assert.equal(resolveEntryFee(mode, 'auto', 'maker'), auto);
    assert.equal(resolveEntryFee(mode, 'auto', 'taker'), auto);
    assert.equal(resolveEntryFee(mode, 'manual', 'maker'), 'maker');
    assert.equal(resolveEntryFee(mode, 'manual', 'taker'), 'taker');
  }
});

test('legacy stop ATR formula stays compatible', () => {
  const result = calculateTrade({
    mode: 'stop', stopMode: 'atr', side: 'Buy', balance: 10000, riskPercent: 1,
    atr: 100, priceLevel: 1000, currentPrice: 1000, triggerAtrPercent: 10,
    slipAtrPercent: 5, stopAtrPercent: 20, technicalStop: 0, rr: 3,
  });
  assert.equal(result.pointType, 10);
  assert.equal(result.triggerPoint, 1010);
  assert.equal(result.entry, 1015);
  assert.equal(result.stop, 995);
  assert.equal(result.target, 1075);
  assert.equal(result.riskAmount, 100);
  assert.equal(result.positionSize, 5);
});

test('legacy market technical formula stays compatible', () => {
  const result = calculateTrade({
    mode: 'market', stopMode: 'technical', side: 'Sell', balance: 5000, riskPercent: 2,
    atr: 10, priceLevel: 0, currentPrice: 250, triggerAtrPercent: 0,
    slipAtrPercent: 0, stopAtrPercent: 0, technicalStop: 255, rr: 2,
  });
  assert.equal(result.pointType, 31);
  assert.equal(result.entry, 250);
  assert.equal(result.stop, 255);
  assert.equal(result.target, 240);
  assert.equal(result.positionSize, 20);
});
