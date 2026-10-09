#!/usr/bin/env python3
"""Print Bybit V5 maker/taker fees for accounts configured in the root .env."""

import argparse
import hashlib
import hmac
import json
import re
import sys
import time
import urllib.error
import urllib.request
from decimal import Decimal
from pathlib import Path


def load_env(path):
    if not path.is_file():
        raise ValueError(f"Не найден .env рядом со скриптом: {path}")
    values = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        name, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[name.strip()] = value
    return values


def get_fees(key, secret, symbol, demo):
    host = "https://api-demo.bybit.com" if demo else "https://api.bybit.com"
    query = f"category=linear&symbol={symbol}"
    timestamp = str(int(time.time() * 1000))
    window = "5000"
    message = f"{timestamp}{key}{window}{query}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        f"{host}/v5/account/fee-rate?{query}",
        headers={
            "X-BAPI-API-KEY": key,
            "X-BAPI-TIMESTAMP": timestamp,
            "X-BAPI-RECV-WINDOW": window,
            "X-BAPI-SIGN": signature,
        },
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        data = json.load(response)
    if data.get("retCode") != 0:
        raise ValueError(f"Bybit {data.get('retCode')}: {data.get('retMsg')}")
    items = data.get("result", {}).get("list", [])
    if not items:
        raise ValueError("Bybit не вернул комиссии для выбранной пары")
    item = items[0]
    return Decimal(item["makerFeeRate"]) * 100, Decimal(item["takerFeeRate"]) * 100


def main():
    parser = argparse.ArgumentParser(description="Комиссии Bybit Futures из .env")
    parser.add_argument("--account", type=int, help="Номер BYBIT_ACCOUNT, например 3")
    parser.add_argument("--symbol", default="BTCUSDT", help="Торговая пара (по умолчанию BTCUSDT)")
    args = parser.parse_args()
    symbol = args.symbol.upper()
    if not re.fullmatch(r"[A-Z0-9]{2,35}", symbol):
        parser.error("Неверный символ")
    try:
        env = load_env(Path(__file__).resolve().parent / ".env")
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Ошибка: {exc}\n")

    slots = sorted({int(m.group(1)) for name in env
                    if (m := re.fullmatch(r"BYBIT_ACCOUNT(\d+)_KEY", name))})
    if args.account is not None:
        slots = [args.account]
    if not slots:
        parser.exit(1, "В .env не найдены BYBIT_ACCOUNT<N>_KEY\n")

    had_error = False
    for slot in slots:
        prefix = f"BYBIT_ACCOUNT{slot}_"
        name = env.get(prefix + "NAME", f"Account {slot}")
        key, secret = env.get(prefix + "KEY"), env.get(prefix + "SECRET")
        demo = env.get(prefix + "DEMO", "false").lower() in ("1", "true", "yes", "on")
        print(f"\n{name} [#{slot}, {'DEMO' if demo else 'LIVE'}] — {symbol}")
        if not key or not secret:
            print("  Нет KEY/SECRET в .env")
            had_error = True
            continue
        try:
            maker, taker = get_fees(key, secret, symbol, demo)
            print(f"  Maker: {maker}%")
            print(f"  Taker: {taker}%")
            print(f"  Taker вход + выход: ≈ {taker * 2}%")
        except (ValueError, KeyError, urllib.error.URLError, TimeoutError) as exc:
            print(f"  Ошибка запроса: {exc}")
            if demo:
                print("  Примечание: endpoint комиссий может быть недоступен в Demo Trading.")
            had_error = True
    return 1 if had_error else 0


if __name__ == "__main__":
    sys.exit(main())
