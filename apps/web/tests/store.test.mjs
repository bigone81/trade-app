import assert from 'node:assert/strict';
import test from 'node:test';

test('scanner preferences load from localStorage', async (t) => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const values = new Map();
  const turnoverKey = 'trade.scanner.minTurnoverMillions';
  const toleranceKey = 'trade.scanner.levelTolerancePercent';
  let importId = 0;
  const loadStore = async () => (await import(`../src/store.ts?test=${importId++}`)).useUi;

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '' },
  });
  t.after(() => {
    if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor);
    else delete globalThis.localStorage;
    if (locationDescriptor) Object.defineProperty(globalThis, 'location', locationDescriptor);
    else delete globalThis.location;
  });

  for (const raw of [null, '', ' \t\n ', 'NaN', 'invalid', '12oops', 'null', 'Infinity', '-Infinity', '1e309']) {
    await t.test(`uses defaults for ${JSON.stringify(raw)}`, async () => {
      values.clear();
      if (raw !== null) {
        values.set(turnoverKey, raw);
        values.set(toleranceKey, raw);
      }
      const state = (await loadStore()).getState();
      assert.equal(state.minTurnoverMillions, 50);
      assert.equal(state.levelTolerancePercent, 10);
      assert.equal(values.get(turnoverKey) ?? null, raw);
      assert.equal(values.get(toleranceKey) ?? null, raw);
    });
  }

  for (const [raw, expected] of [['0', 0], ['125', 125], ['0.5', 0.5], [' 25 ', 25], ['1e2', 100]]) {
    await t.test(`preserves saved numeric value ${JSON.stringify(raw)}`, async () => {
      values.clear();
      values.set(turnoverKey, raw);
      values.set(toleranceKey, raw);
      const state = (await loadStore()).getState();
      assert.equal(state.minTurnoverMillions, expected);
      assert.equal(state.levelTolerancePercent, expected);
    });
  }

  await t.test('defaults each setting independently', async () => {
    values.clear();
    values.set(turnoverKey, '120');
    let state = (await loadStore()).getState();
    assert.equal(state.minTurnoverMillions, 120);
    assert.equal(state.levelTolerancePercent, 10);

    values.clear();
    values.set(toleranceKey, '2.5');
    state = (await loadStore()).getState();
    assert.equal(state.minTurnoverMillions, 50);
    assert.equal(state.levelTolerancePercent, 2.5);
  });

  await t.test('reloads preferences saved through the store', async () => {
    values.clear();
    const store = await loadStore();
    store.getState().setMinTurnoverMillions(0);
    store.getState().setLevelTolerancePercent(2.5);
    assert.equal(store.getState().minTurnoverMillions, 0);
    assert.equal(store.getState().levelTolerancePercent, 2.5);
    assert.equal(values.get(turnoverKey), '0');
    assert.equal(values.get(toleranceKey), '2.5');

    const reloaded = (await loadStore()).getState();
    assert.equal(reloaded.minTurnoverMillions, 0);
    assert.equal(reloaded.levelTolerancePercent, 2.5);
  });
});
