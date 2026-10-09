import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateMarketSettings } from '@trade/domain';
import { deleteMarketWatchSymbol, getMarketSettings, getMarketSignal, getMarketStatus, getMarketSymbols, getMarketWatchlist, listMarketSignalPage, listMarketSignals, saveMarketSettings, saveMarketWatchSymbol, type SqliteDb } from '@trade/database';

const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,26}USDT$/);
const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const sortSchema = z.enum(['newest', 'oldest', 'priority_desc', 'priority_asc']);
const paginatedSymbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,30}$/);
const utcDateSchema = z.string().refine(value => value.endsWith('Z') && !Number.isNaN(Date.parse(value)), 'Expected a UTC ISO date');
const legacySignalsQuery = z.object({
  symbol: symbolSchema.optional(), before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), signalsOnly: z.enum(['true', 'false']).optional(),
}).strict();
const paginatedSignalsQuery = z.object({
  page: z.coerce.number().int().min(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
  symbol: paginatedSymbolSchema.optional(), priority: prioritySchema.optional(), signalsOnly: z.enum(['true', 'false']).default('false'),
  dateFromUtc: utcDateSchema.optional(), dateToUtcExclusive: utcDateSchema.optional(), sort: sortSchema.default('newest'),
}).strict().superRefine((value, context) => {
  if (value.dateFromUtc && value.dateToUtcExclusive && Date.parse(value.dateFromUtc) >= Date.parse(value.dateToUtcExclusive)) {
    context.addIssue({ code: 'custom', path: ['dateToUtcExclusive'], message: 'dateFromUtc must be before dateToUtcExclusive' });
  }
});
function sqliteUtcDate(value: string) { return new Date(value).toISOString().slice(0, 19).replace('T', ' '); }
export function registerMarketMonitorRoutes(app: FastifyInstance, db: SqliteDb) {
  const base = '/api/market-monitor';
  app.get(`${base}/settings`, async () => getMarketSettings(db));
  app.put(`${base}/settings`, async (req, reply) => {
    try {
      const patch = z.record(z.string(), z.unknown()).parse(req.body);
      const settings = validateMarketSettings({ ...getMarketSettings(db), ...patch });
      return saveMarketSettings(db, settings);
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Invalid settings' }); }
  });
  app.get(`${base}/watchlist`, async () => getMarketWatchlist(db));
  app.post(`${base}/watchlist`, async (req, reply) => {
    const result = z.object({ symbol: symbolSchema, enabled: z.boolean().default(true) }).safeParse(req.body);
    if (!result.success) return reply.code(400).send({ error: 'Expected a Bybit USDT symbol and boolean enabled' });
    if (getMarketWatchlist(db).length >= 500 && !getMarketWatchlist(db).some(x => x.symbol === result.data.symbol)) return reply.code(400).send({ error: 'Watchlist limit: 500' });
    saveMarketWatchSymbol(db, result.data.symbol, result.data.enabled);
    return reply.code(201).send(getMarketWatchlist(db));
  });
  app.delete(`${base}/watchlist/:symbol`, async (req, reply) => {
    const result = symbolSchema.safeParse((req.params as { symbol: string }).symbol);
    if (!result.success) return reply.code(400).send({ error: 'Invalid symbol' });
    return deleteMarketWatchSymbol(db, result.data) ? { ok: true } : reply.code(404).send({ error: 'Symbol not found' });
  });
  app.get(`${base}/status`, async () => getMarketStatus(db));
  app.get(`${base}/symbols`, async () => getMarketSymbols(db));
  app.get(`${base}/signals`, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(query, 'page')) {
      const result = paginatedSignalsQuery.safeParse(query);
      if (!result.success) return reply.code(400).send({ error: 'Invalid paginated signal filters' });
      return listMarketSignalPage(db, {
        ...result.data,
        symbolSearch: result.data.symbol,
        signalsOnly: result.data.signalsOnly === 'true',
        dateFromUtc: result.data.dateFromUtc ? sqliteUtcDate(result.data.dateFromUtc) : undefined,
        dateToUtcExclusive: result.data.dateToUtcExclusive ? sqliteUtcDate(result.data.dateToUtcExclusive) : undefined,
      });
    }
    const result = legacySignalsQuery.safeParse(query);
    if (!result.success) return reply.code(400).send({ error: 'Invalid signal filters' });
    return listMarketSignals(db, { ...result.data, signalsOnly: result.data.signalsOnly === 'true' });
  });
  app.get(`${base}/signals/:id`, async (req, reply) => {
    const result = z.coerce.number().int().positive().safeParse((req.params as { id: string }).id);
    if (!result.success) return reply.code(400).send({ error: 'Invalid signal ID' });
    return getMarketSignal(db, result.data) ?? reply.code(404).send({ error: 'Signal not found' });
  });
}
