# Trade App v2

Private Bybit trading dashboard rebuilt from the legacy PHP application with TypeScript end-to-end.

## Stack

- React + TypeScript + Vite
- Fastify API
- Native Node.js `node:sqlite`
- Lightweight Charts
- `bybit-api` V5 REST/WebSocket client
- TypeScript alert/Telegram worker
- Docker Compose

## Safety defaults

Real trading actions are disabled unless `LIVE_TRADING_ENABLED=true` is explicitly set. API keys are server-side only. Closing positions uses reduce-only orders.

## First run

```bash
cp .env.example .env
# edit .env
docker compose up -d --build
```

Open `http://SERVER_IP:8080` (or the port in `APP_PORT`). If `APP_USERNAME` and `APP_PASSWORD` are set, the browser will request HTTP Basic authentication.

## Legacy data migration

A secret-free snapshot of the supplied legacy orders, notes, alerts and screenshots is included in `legacy-data/`. The app container runs the idempotent importer before the API starts, so the 32 historical orders and 13 screenshots appear automatically on the first Docker start.

To import another legacy `public_html` manually:

```bash
DATABASE_PATH=./data/trade.sqlite CHARTS_DIR=./data/charts \
  node scripts/migrate-legacy.mjs /path/to/public_html
```

Repeated imports do not duplicate rows.

## Main areas

- `/` Chart: automatic levels, persistent manual levels, Risk/Reward drawings and calculator drawer.
- `/trade` Trade Control: positions, active orders, executions and history, filterable by account.
- `/alerts` Persistent alerts.
- `/journal` Imported trade journal with notes/screenshots.
- `/settings` connection and safety status.

## Useful commands

```bash
docker compose logs -f
docker compose restart
docker compose down
docker compose up -d --build
```

## Persistent data

Docker volume `trade_data` contains:

- `/data/trade.sqlite`
- `/data/charts/`

Back up both. SQLite runs in WAL mode; for a consistent hot backup use SQLite's backup API or stop the two containers before copying the volume.
