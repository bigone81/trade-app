import test from 'node:test';
import assert from 'node:assert/strict';
import { withWorkerChartLink } from './telegram-message.js';

const base = 'https://edgedesk.example/';

test('approaching and reached alerts link to the target level in each language', () => {
  for (const eventType of ['alert.pre', 'alert.triggered']) {
    for (const [language, label] of [['en', 'Open chart'], ['ru', 'Открыть график'], ['uk', 'Відкрити графік']] as const) {
      const text = '🟡 <b>NOMUSDT</b>\nLevel: 0.002908';
      assert.equal(withWorkerChartLink({ eventType, symbol: 'NOMUSDT', payload: { level: .002908, price: .0029 } }, text, language, base),
        `${text}\n\n<a href="https://edgedesk.example/?symbol=NOMUSDT&amp;level=0.002908">${label}</a>`);
    }
  }
});

test('order, SL and TP fills link to the execution price rather than the requested price', () => {
  for (const [stopOrderType, title] of [['', 'Ордер виконано'], ['StopLoss', 'Stop Loss виконано'], ['TakeProfit', 'Take Profit виконано']]) {
    const text = `✅ <b>${title}</b>`;
    const result = withWorkerChartLink({ eventType: 'order.filled', symbol: 'BTCUSDT', payload: { orderStatus: 'Filled', stopOrderType, avgPrice: '62010.5', price: '62000', triggerPrice: '61900' } }, text, 'uk', base);
    assert.equal(result, `${text}\n\n<a href="https://edgedesk.example/?symbol=BTCUSDT&amp;level=62010.5">Відкрити графік</a>`);
  }
});

test('fill price fallbacks preserve usable links when Bybit omits average execution price', () => {
  for (const [payload, query] of [
    [{ avgPrice: '', price: '62000', triggerPrice: '61900' }, '&amp;level=62000'],
    [{ avgPrice: '0', price: '0', triggerPrice: '61900' }, '&amp;level=61900'],
    [{ avgPrice: 'NaN', price: '-1', triggerPrice: 'Infinity' }, ''],
    [null, ''],
  ] as const) {
    const result = withWorkerChartLink({ eventType: 'order.filled', symbol: 'BTCUSDT', payload }, 'Filled', 'en', base);
    assert.equal(result, `Filled\n\n<a href="https://edgedesk.example/?symbol=BTCUSDT${query}">Open chart</a>`);
  }
});

test('missing configuration, duplicate-suppressed and unrelated notifications remain intact', () => {
  const fill = { eventType: 'order.filled', symbol: 'BTCUSDT', payload: {} };
  for (const url of ['', '=https://edgedesk.example', 'javascript:alert(1)']) assert.equal(withWorkerChartLink(fill, 'Filled', 'en', url), 'Filled');
  assert.equal(withWorkerChartLink(null, 'Text', 'en', base), 'Text');
  assert.equal(withWorkerChartLink({ ...fill, symbol: null }, 'Text', 'en', base), 'Text');
  for (const eventType of ['connection.offline', 'order.new', 'order.cancelled']) {
    assert.equal(withWorkerChartLink({ ...fill, eventType }, 'Text', 'en', base), 'Text');
  }
});

test('chart URLs safely encode symbol query parameters', () => {
  const result = withWorkerChartLink({ eventType: 'alert.pre', symbol: 'A&B"<>', payload: { level: 10 } }, 'Text', 'en', base);
  assert.ok(result.includes('?symbol=A%26B%22%3C%3E&amp;level=10"'));
});
