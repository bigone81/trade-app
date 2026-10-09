import assert from 'node:assert/strict';
import test from 'node:test';
import { readPreferences } from '../src/preferences.ts';

test('old settings keep risk/chart/UI preferences and enable fee planning by default', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let raw = { theme: 'light', defaultRiskPercent: 0.75, accountRiskPercent: { 1: 0.3 }, chart: { futureBars: 40 }, riskBase: 'wallet' };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => {
    assert.equal(key, 'trade.settings.v1');
    return JSON.stringify(raw);
  } } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  });
  const old = readPreferences();
  assert.equal(old.theme, 'light');
  assert.equal(old.defaultRiskPercent, 0.75);
  assert.equal(old.accountRiskPercent[1], 0.3);
  assert.equal(old.chart.futureBars, 40);
  assert.equal(old.riskBase, 'wallet');
  assert.deepEqual(old.calculatorFees, { includeFees: true, entryMode: 'auto', manualEntry: 'maker', postOnly: false, manualRates: null, accountRates: {} });
  raw = { ...raw, calculatorFees: { includeFees: false, entryMode: 'manual', manualEntry: 'taker', postOnly: true,
    manualRates: { maker: 0.0001, taker: 0.0004 }, accountRates: { 1: { maker: 0, taker: 0.0003 }, 2: { maker: 0.0002, taker: 0.00055 } } } };
  assert.deepEqual(readPreferences().calculatorFees, raw.calculatorFees);
  raw.calculatorFees = { includeFees: 'false', entryMode: 'invalid', manualRates: { maker: -1, taker: 0.0004 }, accountRates: { 1: { maker: 0, taker: 0.055 } } };
  const invalid = readPreferences().calculatorFees;
  assert.equal(invalid.includeFees, true);
  assert.equal(invalid.entryMode, 'auto');
  assert.equal(invalid.manualRates, null);
  assert.deepEqual(invalid.accountRates, {});
});
