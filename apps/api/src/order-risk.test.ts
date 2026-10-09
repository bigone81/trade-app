import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTradeFinance, type TradeFinanceInput } from '@trade/domain';
import { checkNormalizedOrderRisk, constrainPlannedRisk, orderTimeInForce, tradeOrderSchema } from './order-risk.js';

const finance: TradeFinanceInput = {
  side: 'Buy', entry: 100.04, stop: 99.06, target: 103, balance: 10000, riskPercent: 1,
  includeFees: true, entryLiquidity: 'maker', rates: { maker: 0.0002, taker: 0.00055 },
};
const rules = { qtyStep: '0.01', minOrderQty: '0.01', minNotionalValue: '5' };
const request = {
  accountId: 1, symbol: 'BTCUSDT', side: 'Buy', orderType: 'Limit', qty: 100,
  executionMode: 'limit', plannedEntry: 100.04, price: 100.04, stopLoss: 99.06, takeProfit: 103, riskAmount: 100,
  fees: { includeInRisk: true, entryMode: 'auto', manualEntry: 'maker', rates: finance.rates, source: 'manual' },
};

test('Post-Only is explicit for ordinary and conditional limits; otherwise GTC is preserved', () => {
  for (const mode of ['limit', 'stop_limit', 'market', 'stop_market'] as const) {
    assert.equal(orderTimeInForce(mode), 'GTC');
    if (mode === 'limit' || mode === 'stop_limit') assert.equal(orderTimeInForce(mode, true), 'PostOnly');
    else assert.throws(() => orderTimeInForce(mode, true), /Post-Only/);
  }
});

test('tick rounding can widen risk: floor quantity and recalculate full planned loss', () => {
  const initial = calculateTradeFinance(finance);
  const normalized = { ...finance, entry: 100.1, stop: 99 };
  assert.ok(calculateTradeFinance({ ...normalized, quantity: initial.positionSize }).totalLoss > 100);
  const result = constrainPlannedRisk(normalized, initial.positionSize, rules);
  assert.ok(Number(result.qty) < initial.positionSize);
  assert.ok(result.result.totalLoss <= 100);
  assert.ok(Math.abs(Number(result.qty) * 100 - Math.round(Number(result.qty) * 100)) < 1e-8);
});

test('Short rounding, tiny stops, arbitrary steps and minimums are safe', () => {
  for (const qtyStep of ['0.001', '0.05', '1', '5']) {
    const input = { ...finance, side: 'Sell' as const, entry: 100, stop: 100.000001, target: 99 };
    const checked = constrainPlannedRisk(input, 1000.007, { ...rules, qtyStep });
    assert.ok(checked.result.totalLoss <= 100);
    assert.ok(Number(checked.qty) <= 1000.007);
  }
  assert.throws(() => constrainPlannedRisk(finance, 0.001, rules), /minimum/);
  assert.throws(() => constrainPlannedRisk(finance, 1, { ...rules, minOrderQty: '2' }), /minimum/);
  assert.throws(() => constrainPlannedRisk(finance, 0.01, rules), /minimum/);
  assert.throws(() => constrainPlannedRisk({ ...finance, stop: finance.entry }, 1, rules), /geometry/);
});

test('schema accepts legacy requests and validates all new fee and Post-Only fields', () => {
  assert.ok(tradeOrderSchema.safeParse({ accountId: 1, symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: 1 }).success);
  for (const mode of ['limit', 'stop_limit']) assert.ok(tradeOrderSchema.safeParse({ ...request, executionMode: mode, postOnly: true }).success);
  for (const mode of ['market', 'stop_market']) assert.equal(tradeOrderSchema.safeParse({ ...request, executionMode: mode, orderType: 'Market', postOnly: true }).success, false);
  for (const patch of [
    { qty: Infinity }, { plannedEntry: NaN }, { postOnly: 'true' }, { riskAmount: 0 }, { stopLoss: undefined },
    { fees: { ...request.fees, entryMode: 'unknown' } }, { fees: { ...request.fees, manualEntry: 'unknown' } },
    { fees: { ...request.fees, includeInRisk: 'true' } }, { fees: { ...request.fees, rates: { maker: -1, taker: 0.01 } } },
    { fees: { ...request.fees, rates: { maker: 0, taker: 0.055 } } }, { executionMode: 'market' },
  ]) assert.equal(tradeOrderSchema.safeParse({ ...request, ...patch }).success, false);
});

test('server uses normalized limit prices, per-account exchange rates and never increases qty', async () => {
  const accounts: number[] = [];
  const adapter = {
    getFeeRates: async (id: number, symbol: string) => { accounts.push(id); return { accountId: id, symbol, source: 'exchange' as const, fetchedAt: 0, maker: id === 1 ? 0.0002 : 0.0004, taker: 0.00055 }; },
    getInstrumentRules: async () => ({ ...rules, tickSize: '0.1', at: 0 }),
    normalizePrice: async (_symbol: string, price: number) => price.toFixed(1),
  };
  const sizes: number[] = [];
  for (const accountId of [1, 2]) {
    const body = tradeOrderSchema.parse({ ...request, accountId, fees: { ...request.fees, rates: { maker: 0, taker: 0 }, source: 'exchange' } });
    const params = { qty: '100.00', price: '100.1', stopLoss: '99.0', takeProfit: '103.0' };
    const result = await checkNormalizedOrderRisk(body, 'limit', params, adapter);
    assert.ok(result!.totalLoss <= 100);
    assert.equal(result!.notional, Number(params.qty) * 100.1);
    sizes.push(Number(params.qty));
  }
  assert.deepEqual(accounts, [1, 2]);
  assert.ok(sizes[0]! > sizes[1]!);
  const legacy = tradeOrderSchema.parse({ accountId: 1, symbol: 'BTCUSDT', side: 'Buy', orderType: 'Market', qty: 1 });
  assert.equal(await checkNormalizedOrderRisk(legacy, 'market', { qty: '1' }, adapter), null);
});

test('market uses normalized planned entry; fees disabled retain old normalized quantity', async () => {
  const adapter = {
    getFeeRates: async () => { throw new Error('Manual rates must not call Bybit'); },
    getInstrumentRules: async () => ({ ...rules, tickSize: '0.1', at: 0 }),
    normalizePrice: async (_symbol: string, price: number) => price.toFixed(1),
  };
  for (const mode of ['market', 'stop_market'] as const) {
    const body = tradeOrderSchema.parse({ ...request, executionMode: mode, orderType: 'Market' });
    const params = { qty: '100.00', stopLoss: '99.0', takeProfit: '103.0' };
    const result = await checkNormalizedOrderRisk(body, mode, params, adapter);
    assert.ok(result!.totalLoss <= 100);
    assert.equal(result!.entryFee, Number(params.qty) * 100 * finance.rates.taker);
  }
  const body = tradeOrderSchema.parse({ ...request, fees: { ...request.fees, includeInRisk: false } });
  const params = { qty: '100.00', price: '100.1', stopLoss: '99.0', takeProfit: '103.0' };
  const result = await checkNormalizedOrderRisk(body, 'limit', params, adapter);
  assert.equal(params.qty, '100.00');
  assert.ok(result!.totalLoss > 100);
});
