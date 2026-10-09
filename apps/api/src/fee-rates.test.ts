import test from 'node:test';
import assert from 'node:assert/strict';
import { BybitAdapter } from '@trade/exchanges-bybit';
import { DEFAULT_FEE_RATES } from '@trade/shared';

function adapter(demo = false) {
  return new BybitAdapter(id => ({ id, exchange: 'bybit', market: 'linear', name: `Account ${id}`,
    environment: demo ? 'demo' : 'prod', demo, configured: true, enabled: true, apiKey: 'test-secret-key', apiSecret: 'test-secret-value' }));
}

test('fee cache deduplicates concurrent calls, isolates account/symbol and expires after 30 minutes', async t => {
  const a = adapter();
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const calls: { accountId: number; symbol: string; category: string }[] = [];
  t.mock.method(a, 'getPrivateClient', (accountId: number) => ({ getFeeRate: async (p: { category: string; symbol: string }) => {
    calls.push({ accountId, ...p });
    return { retCode: 0, result: { list: [{ symbol: p.symbol, makerFeeRate: '0.0001', takerFeeRate: '0.0004' }] } };
  } }) as unknown as ReturnType<BybitAdapter['getPrivateClient']>);
  const result = await Promise.all([a.getFeeRates(1, 'BTCUSDT'), a.getFeeRates(1, 'btcusdt')]);
  assert.deepEqual(result[0], result[1]);
  assert.equal(calls.length, 1);
  assert.equal(result[0]!.source, 'exchange');
  assert.equal(result[0]!.maker, 0.0001);
  await a.getFeeRates(2, 'BTCUSDT');
  await a.getFeeRates(1, 'ETHUSDT');
  assert.deepEqual(calls.map(x => `${x.accountId}:${x.symbol}:${x.category}`), ['1:BTCUSDT:linear', '2:BTCUSDT:linear', '1:ETHUSDT:linear']);
  now += 30 * 60_000;
  await a.getFeeRates(1, 'BTCUSDT');
  assert.equal(calls.length, 4);
});

test('Demo never calls private fee API; LIVE API errors return cached, clearly unconfirmed fallback without secrets', async t => {
  for (const demo of [true, false]) {
    const a = adapter(demo);
    let calls = 0;
    t.mock.method(a, 'getPrivateClient', () => ({ getFeeRate: async () => {
      calls++;
      throw new Error('test-secret-key test-secret-value');
    } }) as unknown as ReturnType<BybitAdapter['getPrivateClient']>);
    const result = await a.getFeeRates(1, 'BTCUSDT');
    await a.getFeeRates(1, 'BTCUSDT');
    assert.equal(calls, demo ? 0 : 1);
    assert.equal(result.source, 'fallback');
    assert.equal(result.maker, DEFAULT_FEE_RATES.maker);
    assert.equal(result.taker, DEFAULT_FEE_RATES.taker);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('invalid rates, exchange rejections and wrong symbols never become confirmed rates', async t => {
  for (const row of [
    { symbol: 'BTCUSDT', makerFeeRate: '', takerFeeRate: '0.00055' },
    { symbol: 'BTCUSDT', makerFeeRate: '-0.01', takerFeeRate: '0.00055' },
    { symbol: 'BTCUSDT', makerFeeRate: 'NaN', takerFeeRate: '0.00055' },
    { symbol: 'BTCUSDT', makerFeeRate: '0.0002', takerFeeRate: '0.055' },
    { symbol: 'ETHUSDT', makerFeeRate: '0.0002', takerFeeRate: '0.00055' },
  ]) {
    const a = adapter();
    t.mock.method(a, 'getPrivateClient', () => ({ getFeeRate: async () => ({ retCode: 0, result: { list: [row] } }) }) as unknown as ReturnType<BybitAdapter['getPrivateClient']>);
    assert.equal((await a.getFeeRates(1, 'BTCUSDT')).source, 'fallback');
  }
  const a = adapter();
  t.mock.method(a, 'getPrivateClient', () => ({ getFeeRate: async () => ({ retCode: 10001 }) }) as unknown as ReturnType<BybitAdapter['getPrivateClient']>);
  assert.equal((await a.getFeeRates(1, 'BTCUSDT')).source, 'fallback');
});
