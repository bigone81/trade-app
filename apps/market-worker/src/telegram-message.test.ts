import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterLevels, formatMarketNotification } from '@trade/domain';
import type { MarketObservation } from '@trade/shared';
import { formatTelegramMarketNotification } from './telegram-message.js';

const observation: MarketObservation = {
  symbol: 'NOMUSDT', barTime: 1000, price: .0029, direction: 'UP',
  cluster: clusterLevels([{ id: 'manual:1', price: .002908, type: 'manual', touches: 0, strength: 0, dates: [] }], .0001, .12)[0]!,
  features: [], metrics: { distanceAtr: .08 },
  scores: { approach: 7, breakout: 3, rejection: 11, priority: 'CRITICAL', conflict: false, contributions: { approach: {}, breakout: {}, rejection: {} } },
  scenario: 'REJECTION_SETUP',
};

test('Telegram chart link uses the configured URL, exact level and all notification languages', () => {
  for (const [language, label] of [['en', 'Open chart'], ['ru', 'Открыть график'], ['uk', 'Відкрити графік']] as const) {
    for (const base of ['https://edgedesk.example', 'https://edgedesk.example/']) {
      const message = formatTelegramMarketNotification(observation, language, base);
      assert.ok(message.endsWith(`<a href="https://edgedesk.example/?symbol=NOMUSDT&amp;level=0.002908">${label}</a>`));
      assert.ok(message.startsWith(formatMarketNotification(observation, language)));
    }
  }
});

test('Telegram formatter escapes HTML and omits a link when the public URL is not configured', () => {
  const message = formatTelegramMarketNotification({ ...observation, symbol: 'A&B<USDT>' }, 'ru', '');
  assert.ok(message.startsWith('A&amp;B&lt;USDT&gt;'));
  assert.ok(!message.includes('<a '));
  assert.throws(() => formatTelegramMarketNotification(observation, 'en', 'javascript:alert(1)'), /HTTP or HTTPS/);
});
