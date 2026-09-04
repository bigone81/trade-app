import type { TradeOrder, TradePosition, TradingOverlayLine } from '@trade/shared';

export type ProtectiveKind = 'sl' | 'tp' | null;

export interface GroupedTradeOrder {
  main: TradeOrder;
  stopLossOrder: TradeOrder | null;
  takeProfitOrder: TradeOrder | null;
  children: TradeOrder[];
}

const closeEnough = (a: number | null | undefined, b: number | null | undefined) => {
  if (!a || !b) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / scale < 1e-8;
};

export function protectiveKind(order: TradeOrder, referencePrice?: number): ProtectiveKind {
  const kind = String(order.stopOrderType || '').toLowerCase();
  if (kind.includes('takeprofit') || kind === 'tp') return 'tp';
  if (kind.includes('stoploss') || kind === 'sl') return 'sl';

  if (!order.reduceOnly || !order.triggerPrice || !referencePrice) return null;
  if (order.side === 'Buy') return order.triggerPrice > referencePrice ? 'sl' : 'tp';
  return order.triggerPrice < referencePrice ? 'sl' : 'tp';
}

function matchScore(main: TradeOrder, child: TradeOrder) {
  if (main.accountId !== child.accountId || main.symbol !== child.symbol || main.side === child.side) return Number.POSITIVE_INFINITY;
  const kind = protectiveKind(child, main.price || main.triggerPrice || undefined);
  if (!kind) return Number.POSITIVE_INFINITY;
  const exact = kind === 'sl'
    ? closeEnough(main.stopLoss, child.triggerPrice)
    : closeEnough(main.takeProfit, child.triggerPrice);
  const age = Math.abs((child.createdTime || 0) - (main.createdTime || 0));
  return (exact ? 0 : 1_000_000_000) + age;
}

export function groupActiveOrders(rows: TradeOrder[] = []): GroupedTradeOrder[] {
  const obviousProtective = new Set(
    rows
      .filter((order) => {
        const kind = String(order.stopOrderType || '').toLowerCase();
        return kind.includes('takeprofit') || kind.includes('stoploss');
      })
      .map((order) => order.orderId),
  );

  // Bybit attached TP/SL orders are commonly reduceOnly Market orders with a trigger.
  // Treat them as children only when another opposite-side order exists for the same account/symbol.
  for (const order of rows) {
    if (!order.reduceOnly || !order.triggerPrice) continue;
    if (rows.some((candidate) => candidate.accountId === order.accountId && candidate.symbol === order.symbol && candidate.side !== order.side && candidate.orderId !== order.orderId)) {
      obviousProtective.add(order.orderId);
    }
  }

  const mains = rows.filter((order) => !obviousProtective.has(order.orderId));
  const groups: GroupedTradeOrder[] = mains.map((main) => ({ main, stopLossOrder: null, takeProfitOrder: null, children: [] }));

  for (const child of rows.filter((order) => obviousProtective.has(order.orderId))) {
    let best: GroupedTradeOrder | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      const score = matchScore(group.main, child);
      if (score < bestScore) {
        best = group;
        bestScore = score;
      }
    }

    // If we cannot safely associate a child, keep it visible as a standalone row.
    if (!best || !Number.isFinite(bestScore)) {
      groups.push({ main: child, stopLossOrder: null, takeProfitOrder: null, children: [] });
      continue;
    }

    best.children.push(child);
    const kind = protectiveKind(child, best.main.price || best.main.triggerPrice || undefined);
    if (kind === 'sl') best.stopLossOrder = child;
    if (kind === 'tp') best.takeProfitOrder = child;
  }

  return groups.sort((a, b) => (b.main.createdTime || 0) - (a.main.createdTime || 0));
}


export function buildTradingOverlayLines(symbol: string, orders: TradeOrder[] = [], positions: TradePosition[] = []): TradingOverlayLine[] {
  const upper = symbol.toUpperCase();
  const relevantPositions = positions.filter((position) => position.symbol === upper && position.size > 0);
  const positionKeys = new Set(relevantPositions.map((position) => `${position.accountId}:${position.symbol}`));
  const pendingOrders = orders.filter((order) => order.symbol === upper).filter((order) => {
    if (!positionKeys.has(`${order.accountId}:${order.symbol}`)) return true;
    return !(order.reduceOnly && order.triggerPrice);
  });

  const lines: TradingOverlayLine[] = [];
  for (const group of groupActiveOrders(pendingOrders)) {
    const main = group.main;
    const groupKey = `order:${main.accountId}:${main.orderId}`;
    const mainPrice = main.price || 0;
    if (mainPrice > 0) {
      lines.push({
        id: `order:${main.accountId}:${main.orderId}`,
        kind: 'order',
        price: mainPrice,
        accountId: main.accountId,
        accountName: main.accountName,
        symbol: main.symbol,
        groupKey,
        side: main.side,
        qty: main.qty,
        orderId: main.orderId,
        orderType: main.orderType,
        orderStatus: main.orderStatus,
        editTarget: 'order_price',
      });
    }

    if (main.triggerPrice && main.triggerPrice > 0) {
      lines.push({
        id: `order-trigger:${main.accountId}:${main.orderId}`,
        kind: 'trigger',
        price: main.triggerPrice,
        accountId: main.accountId,
        accountName: main.accountName,
        symbol: main.symbol,
        groupKey,
        side: main.side,
        qty: main.qty,
        orderId: main.orderId,
        orderType: main.orderType,
        orderStatus: main.orderStatus,
        editTarget: 'order_trigger',
      });
    }

    const slPrice = group.stopLossOrder?.triggerPrice || main.stopLoss;
    if (slPrice) {
      lines.push({
        id: `order-sl:${main.accountId}:${group.stopLossOrder?.orderId || main.orderId}`,
        kind: 'sl',
        price: slPrice,
        accountId: main.accountId,
        accountName: main.accountName,
        symbol: main.symbol,
        groupKey,
        side: main.side,
        qty: main.qty,
        orderId: group.stopLossOrder?.orderId || main.orderId,
        editTarget: group.stopLossOrder ? 'order_trigger' : 'order_sl',
      });
    }

    const tpPrice = group.takeProfitOrder?.triggerPrice || main.takeProfit;
    if (tpPrice) {
      lines.push({
        id: `order-tp:${main.accountId}:${group.takeProfitOrder?.orderId || main.orderId}`,
        kind: 'tp',
        price: tpPrice,
        accountId: main.accountId,
        accountName: main.accountName,
        symbol: main.symbol,
        groupKey,
        side: main.side,
        qty: main.qty,
        orderId: group.takeProfitOrder?.orderId || main.orderId,
        editTarget: group.takeProfitOrder ? 'order_trigger' : 'order_tp',
      });
    }
  }

  for (const position of relevantPositions) {
    const groupKey = `position:${position.accountId}:${position.symbol}:${position.positionIdx}`;
    lines.push({
      id: `position:${position.accountId}:${position.symbol}:${position.positionIdx}`,
      kind: 'position',
      price: position.avgPrice,
      accountId: position.accountId,
      accountName: position.accountName,
      symbol: position.symbol,
      groupKey,
      side: position.side,
      qty: position.size,
      pnl: position.unrealisedPnl,
      positionIdx: position.positionIdx,
    });
    if (position.stopLoss) {
      lines.push({
        id: `position-sl:${position.accountId}:${position.symbol}:${position.positionIdx}`,
        kind: 'sl',
        price: position.stopLoss,
        accountId: position.accountId,
        accountName: position.accountName,
        symbol: position.symbol,
        groupKey,
        side: position.side,
        qty: position.size,
        positionIdx: position.positionIdx,
        editTarget: 'position_sl',
      });
    }
    if (position.takeProfit) {
      lines.push({
        id: `position-tp:${position.accountId}:${position.symbol}:${position.positionIdx}`,
        kind: 'tp',
        price: position.takeProfit,
        accountId: position.accountId,
        accountName: position.accountName,
        symbol: position.symbol,
        groupKey,
        side: position.side,
        qty: position.size,
        positionIdx: position.positionIdx,
        editTarget: 'position_tp',
      });
    }
    if (position.liqPrice) {
      lines.push({
        id: `position-liq:${position.accountId}:${position.symbol}:${position.positionIdx}`,
        kind: 'liq',
        price: position.liqPrice,
        accountId: position.accountId,
        accountName: position.accountName,
        symbol: position.symbol,
        groupKey,
        side: position.side,
        qty: position.size,
        positionIdx: position.positionIdx,
      });
    }
  }

  return lines;
}
