import type { TradeExecution } from '@trade/shared';

/** A visually grouped, actual closing order linked to its reconstructed entry fills. */
export interface TradeConnection {
  id: string;
  accountId: number;
  accountName: string;
  direction: 'long' | 'short';
  entryTime: number; // ms: earliest known contributing entry fill
  entryPrice: number; // quantity-weighted entry of contributing fills
  exitTime: number; // ms: last fill of the closing order
  exitPrice: number; // quantity-weighted execution price of closing fills
  qty: number;
  entryFee: number;
  exitFee: number;
  closingOrderId: string;
  fillCount: number;
}

interface EntryLot { qty: number; price: number; time: number; feePerQty: number }
interface PositionLots { lots: EntryLot[]; cycle: number }
interface Aggregate extends TradeConnection {
  entryValue: number;
  exitValue: number;
}

/**
 * Do not pair every opposite BUY/SELL: in hedge mode a BUY can open a long
 * while an unrelated short remains open. Bybit's closedSize is the explicit
 * closing part of a real Trade execution. Pair only that quantity, per account
 * and direction. Unmatched closes (entry outside the returned history) are not
 * displayed; funding/settlements never create connections.
 *
 * Within a position we use FIFO attribution to known opening fills. This is a
 * visual connection/price movement, NOT the exchange's accounting PnL.
 */
export function buildTradeConnections(
  executions: TradeExecution[],
  symbol: string,
  accountIds: number[],
): TradeConnection[] {
  const allowed = (id: number) => !accountIds.length || accountIds.includes(id);
  const sorted = executions
    .filter(x => x.symbol === symbol && x.execType === 'Trade' && allowed(x.accountId)
      && Number.isFinite(x.execPrice) && x.execPrice > 0
      && Number.isFinite(x.execQty) && x.execQty > 0
      && Number.isFinite(x.execTime) && x.execTime > 0)
    .sort((a, b) => a.execTime - b.execTime || a.execId.localeCompare(b.execId));

  const positions = new Map<string, PositionLots>();
  const merged = new Map<string, Aggregate>();
  const seen = new Set<string>();
  const EPS = 1e-9;

  const getPosition = (accountId: number, direction: 'long' | 'short'): PositionLots => {
    const key = `${accountId}:${direction}`;
    const existing = positions.get(key);
    if (existing) return existing;
    const state: PositionLots = { lots: [], cycle: 0 };
    positions.set(key, state);
    return state;
  };

  for (const fill of sorted) {
    const fillKey = `${fill.accountId}:${fill.execId}`;
    if (seen.has(fillKey)) continue;
    seen.add(fillKey);
    const closingDirection: 'long' | 'short' = fill.side === 'Sell' ? 'long' : 'short';
    const openingDirection: 'long' | 'short' = fill.side === 'Buy' ? 'long' : 'short';
    const closedSize = Math.max(0, Math.min(fill.execQty, Number(fill.closedSize) || 0));
    let matched = 0;
    let entryValue = 0;
    let earliestEntry = Infinity;
    let entryFee = 0;

    if (closedSize > EPS) {
      const position = getPosition(fill.accountId, closingDirection);
      let remaining = closedSize;
      while (remaining > EPS && position.lots.length) {
        const lot = position.lots[0]!;
        const taken = Math.min(lot.qty, remaining);
        matched += taken;
        entryValue += taken * lot.price;
        entryFee += taken * lot.feePerQty;
        earliestEntry = Math.min(earliestEntry, lot.time);
        remaining -= taken;
        lot.qty -= taken;
        if (lot.qty <= EPS) position.lots.shift();
      }
      // If the position was opened before the history window, do not invent
      // a link from an unrelated newer fill for an only partially known close.
      if (matched >= closedSize - EPS && earliestEntry < fill.execTime) {
        const orderKey = fill.orderId || fill.execId;
        const key = `${fill.accountId}:${closingDirection}:${position.cycle}:${orderKey}`;
        const previous = merged.get(key);
        if (previous) {
          previous.qty += matched;
          previous.entryValue += entryValue;
          previous.exitValue += matched * fill.execPrice;
          previous.entryTime = Math.min(previous.entryTime, earliestEntry);
          previous.exitTime = Math.max(previous.exitTime, fill.execTime);
          previous.entryFee += entryFee;
          previous.exitFee += Number(fill.execFee || 0) * matched / fill.execQty;
          previous.fillCount++;
        } else {
          merged.set(key, {
            id: key,
            accountId: fill.accountId,
            accountName: fill.accountName,
            direction: closingDirection,
            entryTime: earliestEntry,
            entryPrice: 0,
            exitTime: fill.execTime,
            exitPrice: 0,
            qty: matched,
            entryFee,
            exitFee: Number(fill.execFee || 0) * matched / fill.execQty,
            closingOrderId: orderKey,
            fillCount: 1,
            entryValue,
            exitValue: matched * fill.execPrice,
          });
        }
      }
    }

    const openedSize = fill.execQty - closedSize;
    if (openedSize > EPS) {
      const position = getPosition(fill.accountId, openingDirection);
      if (!position.lots.length) position.cycle++;
      position.lots.push({
        qty: openedSize,
        price: fill.execPrice,
        time: fill.execTime,
        feePerQty: Number(fill.execFee || 0) / fill.execQty,
      });
    }
  }

  return [...merged.values()]
    .filter(x => x.qty > EPS && x.entryTime < x.exitTime)
    .map(({ entryValue, exitValue, ...connection }) => ({
      ...connection,
      entryPrice: entryValue / connection.qty,
      exitPrice: exitValue / connection.qty,
    }))
    .sort((a, b) => a.exitTime - b.exitTime);
}
