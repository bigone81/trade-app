# Exchanges and accounts

EdgeDesk currently runs the Bybit linear adapter through `@trade/exchanges-bybit`.

## Current personal/testing mode

Exchange accounts are not stored in SQLite. They are discovered only from `.env` at process start using:

`BYBIT_ACCOUNT<N>_NAME`
`BYBIT_ACCOUNT<N>_KEY`
`BYBIT_ACCOUNT<N>_SECRET`
`BYBIT_ACCOUNT<N>_DEMO`

`<N>` is dynamic and is not limited to 1..5. An account exists in EdgeDesk only when both KEY and SECRET are present. After editing `.env`, recreate the app and worker containers.

The old `exchange_accounts` SQLite registry is dropped automatically when the database is opened. Journal rows keep their historical `account_id` and `account_name` values; they do not depend on the registry.

## Adapter boundary

API and worker resolve the env account and pass it to `BybitAdapter`. Chart, Journal and Trade Control consume normalized shared types, so Binance / OKX adapters can be added later without changing the UI model.

For a future SaaS version, a real user-owned `exchange_accounts` table with encrypted credentials can be introduced again behind the same adapter boundary.
