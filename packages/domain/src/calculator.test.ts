import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTrade } from './calculator.js';

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
