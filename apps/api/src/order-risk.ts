import { z } from 'zod';
import { calculateTradeFinance, resolveEntryFee, type TradeFinanceInput } from '@trade/domain';
import type { ExecutionMode } from '@trade/shared';
import type { BybitAdapter } from '@trade/exchanges-bybit';

const positive = () => z.number().finite().positive();
export function orderTimeInForce(mode: ExecutionMode, postOnly = false): 'GTC' | 'PostOnly' {
  if (postOnly && mode !== 'limit' && mode !== 'stop_limit') throw new Error('Post-Only requires a Limit or Stop Limit order.');
  return postOnly ? 'PostOnly' : 'GTC';
}
export const tradeOrderSchema = z.object({
  accountId: z.number().int().positive(), symbol: z.string().regex(/^[a-zA-Z0-9]{2,30}$/), side: z.enum(['Buy', 'Sell']),
  orderType: z.enum(['Market', 'Limit']), qty: positive(),
  executionMode: z.enum(['market', 'limit', 'stop_market', 'stop_limit']).optional(), autoMode: z.boolean().optional(), autoReferencePrice: positive().optional(),
  price: positive().optional(), triggerPrice: positive().optional(), stopLoss: positive().optional(), takeProfit: positive().optional(), positionIdx: z.number().int().default(0),
  pointType: z.number().int().optional(), priceLevel: positive().optional(), plannedRr: z.number().finite().optional(),
  riskPercent: z.number().finite().min(0).optional(), riskAmount: z.number().finite().min(0).optional(), plannedEntry: positive().optional(),
  postOnly: z.boolean().optional(),
  fees: z.object({
    includeInRisk: z.boolean(), entryMode: z.enum(['auto', 'manual']), manualEntry: z.enum(['maker', 'taker']),
    rates: z.object({ maker: z.number().finite().min(0).max(0.01), taker: z.number().finite().min(0).max(0.01) }),
    source: z.enum(['exchange', 'manual', 'fallback']),
  }).optional(),
}).superRefine((b, ctx) => {
  const mode = b.executionMode ?? (b.triggerPrice ? (b.orderType === 'Market' ? 'stop_market' : 'stop_limit') : b.orderType === 'Market' ? 'market' : 'limit');
  const limit = mode === 'limit' || mode === 'stop_limit';
  if (b.postOnly && !limit) ctx.addIssue({ code: 'custom', message: 'Post-Only requires a Limit or Stop Limit order.', path: ['postOnly'] });
  if ((b.fees || b.postOnly !== undefined) && b.orderType !== (limit ? 'Limit' : 'Market')) {
    ctx.addIssue({ code: 'custom', message: 'Order type does not match execution mode.', path: ['orderType'] });
  }
  if (b.fees && (!b.plannedEntry || !b.stopLoss || !b.takeProfit || !b.riskAmount)) {
    ctx.addIssue({ code: 'custom', message: 'Fee planning requires positive plannedEntry, SL, TP and riskAmount.', path: ['fees'] });
  }
});

type InstrumentRules = { qtyStep: string; minOrderQty: string; minNotionalValue: string };

/** Only decrease quantity, including when tick rounding widens the stop. */
export function constrainPlannedRisk(input: TradeFinanceInput, requestedQty: number, rules: InstrumentRules) {
  const step = Number(rules.qtyStep), minimum = Number(rules.minOrderQty), minNotional = Number(rules.minNotionalValue);
  if (![step, minimum, minNotional].every(Number.isFinite) || step <= 0 || minimum <= 0 || minNotional < 0) throw new Error('Invalid instrument quantity rules.');
  const sized = calculateTradeFinance({ ...input, quantity: undefined });
  const cap = input.includeFees ? Math.min(requestedQty, sized.positionSize) : requestedQty;
  const decimals = rules.qtyStep.includes('.') ? rules.qtyStep.replace(/0+$/, '').split('.')[1]!.length : 0;
  let units = Math.floor(cap / step);
  let qty = Number((units * step).toFixed(decimals));
  let result = calculateTradeFinance({ ...input, quantity: qty || step });
  // Floating-point multiplication must never turn a downward step into an over-budget order.
  if (qty > cap || (input.includeFees && result.totalLoss > result.riskBudget)) {
    units -= 1;
    qty = Number((units * step).toFixed(decimals));
  }
  if (qty <= 0 || qty < minimum || qty * input.entry < minNotional) {
    throw new Error('Planned risk budget cannot fund the minimum Bybit quantity/notional after rounding.');
  }
  result = calculateTradeFinance({ ...input, quantity: qty });
  if (input.includeFees && result.totalLoss > result.riskBudget) throw new Error('Rounded position exceeds the planned risk budget.');
  return { qty: qty.toFixed(decimals), result };
}

export async function checkNormalizedOrderRisk(
  body: z.infer<typeof tradeOrderSchema>, mode: ExecutionMode,
  params: { qty: string; price?: string; stopLoss?: string; takeProfit?: string },
  adapter: Pick<BybitAdapter, 'getFeeRates' | 'getInstrumentRules' | 'normalizePrice'>,
) {
  if (!body.fees) return null; // Old clients retain their existing sizing behavior.
  const { fees } = body;
  const rates = fees.source === 'manual' ? fees.rates : await adapter.getFeeRates(body.accountId, body.symbol);
  const entry = params.price ? Number(params.price) : Number(await adapter.normalizePrice(body.symbol, body.plannedEntry!));
  const input: TradeFinanceInput = {
    side: body.side, entry, stop: Number(params.stopLoss), target: Number(params.takeProfit),
    balance: body.riskAmount!, riskPercent: 100, includeFees: fees.includeInRisk,
    entryLiquidity: resolveEntryFee(mode, fees.entryMode, fees.manualEntry), rates,
  };
  const rules = await adapter.getInstrumentRules(body.symbol);
  const checked = constrainPlannedRisk(input, Math.min(body.qty, Number(params.qty)), rules);
  // With fees disabled retain the old requested size after exchange rounding.
  params.qty = checked.qty;
  return checked.result;
}
