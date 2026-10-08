import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultMarketMonitorSettings, marketNumericBounds, defaultScoreWeights } from '@trade/shared';
import { marketChartUrl, marketDate, marketFeedPage, marketLabel, marketNumber, marketSettingsIssue } from '../src/marketMonitorPresentation.ts';

test('missing measurements stay unknown and timestamps are presented as dates', () => {
  assert.equal(marketNumber(null), '—'); assert.equal(marketNumber(undefined), '—'); assert.equal(marketNumber(NaN), '—');
  assert.equal(marketNumber(0), '0'); assert.equal(marketNumber(.19671, 8), '0.19671');
  assert.equal(marketDate('invalid', 'ru'), '—'); assert.equal(marketDate(null, 'ru'), '—');
  assert.equal(marketDate('2026-10-08 12:00:00', 'ru'), marketDate('2026-10-08T12:00:00Z', 'ru'));
  assert.equal(marketDate(1791460800, 'ru'), marketDate('2026-10-08T12:00:00Z', 'ru'));
});
test('history lookahead gives a complete page without dropping the next observation', () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({ id: 100 - i }));
  const page = marketFeedPage(rows);
  assert.equal(page.rows.length, 50); assert.equal(page.hasMore, true); assert.equal(page.nextCursor, 51);
  assert.equal(rows.filter(x => x.id < page.nextCursor)[0].id, 50);
  assert.equal(marketFeedPage(rows.slice(0, 50)).hasMore, false);
  assert.equal(marketFeedPage([]).nextCursor, undefined);
});
test('settings validation identifies the hidden field to reveal and focus', () => {
  const s = structuredClone(defaultMarketMonitorSettings);
  assert.equal(marketSettingsIssue(s), null);
  for (const [patch, field] of [[{ exitTurnover: 6e7 }, 'exitTurnover'], [{ nearRetestDays: 35 }, 'farRetestDays'], [{ resetDistanceAtr: .5 }, 'resetDistanceAtr'], [{ closeFarAtr: .1 }, 'closeFarAtr'], [{ bigBarAtr: .5 }, 'bigBarAtr'], [{ concurrency: 2.5 }, 'concurrency'], [{ maxAutoSymbols: NaN }, 'maxAutoSymbols']]) assert.equal(marketSettingsIssue({ ...s, ...patch }).key, field);
});
test('every configurable number and weighted feature has Russian and Ukrainian labels', () => {
  const keys = [...Object.keys(marketNumericBounds), ...Object.values(defaultScoreWeights).flatMap(Object.keys)];
  for (const key of keys) for (const language of ['ru', 'uk']) assert.match(marketLabel(key, language), /[А-Яа-яІіЇїЄє]/, `${language}: ${key}`);
});
test('chart links preserve symbol and level context and safely encode symbols', () => {
  assert.equal(marketChartUrl('XLMUSDT', .19671), '/?symbol=XLMUSDT&level=0.19671');
  assert.equal(marketChartUrl('BTCUSDT'), '/?symbol=BTCUSDT');
  assert.equal(new URL(marketChartUrl('A&BUSDT'), 'http://localhost').searchParams.get('symbol'), 'A&BUSDT');
});
