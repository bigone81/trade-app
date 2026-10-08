import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.env.DATABASE_PATH || './data/trade.sqlite', { readOnly: true });
const row = db.prepare('SELECT payload_json FROM market_monitor_runtime WHERE id=1').get() as { payload_json: string } | undefined;
const status = row ? JSON.parse(row.payload_json) : null;
db.close();
process.exit(status?.heartbeatAt && Date.now() - Date.parse(status.heartbeatAt) < 90_000 ? 0 : 1);
