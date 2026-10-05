import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPreferences, readChartBarSpacing, writeChartBarSpacing } from '../src/preferences.ts';

test('shared chart zoom persists across reloads and tolerates unavailable storage', (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });

  assert.equal(readChartBarSpacing(), 3);
  assert.equal(defaultPreferences.chart.futureBars, 24);
  writeChartBarSpacing(2.75);
  assert.equal(readChartBarSpacing(), 2.75);
  for (const invalid of [0, -1, NaN, Infinity]) {
    writeChartBarSpacing(invalid);
    assert.equal(readChartBarSpacing(), 2.75);
  }
  const key = [...values.keys()][0];
  for (const raw of ['', 'garbage', 'Infinity', '-1', '0']) {
    values.set(key, raw);
    assert.equal(readChartBarSpacing(), 3);
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('Storage unavailable'); },
  });
  assert.equal(readChartBarSpacing(), 3);
  assert.doesNotThrow(() => writeChartBarSpacing(4));
});
