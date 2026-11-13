#!/usr/bin/env python3
"""BG Said — daily Benjamin Graham screen of the S&P 500.

Run after the US market closes. Writes docs/data/latest.json (+ history) for the
web app and pushes a Top-5 summary to an ntfy topic.

Formula (Graham, revised 1974):
    V = EPS x (8.5 + 2g) x 4.4 / Y
      EPS = trailing-12-month diluted EPS
      g   = expected growth % (LOWER of historical EPS CAGR and next-year EPS growth, clamped 0-15)
      4.4 = AAA corporate bond yield when Graham published the formula
      Y   = today's Moody's Seasoned AAA Corporate Bond Yield (FRED: DAAA)
    Margin of Safety (MOS) = (V - Price) / V

Usage:
    python engine/bgsaid.py              # full run (skips notify on market holidays)
    python engine/bgsaid.py --limit 40   # quick test on 40 tickers
    python engine/bgsaid.py --no-notify  # compute only
    python engine/bgsaid.py --force      # notify even if the market was closed today

Env:
    NTFY_TOPIC   ntfy topic to publish to (no notify if unset)
    NTFY_SERVER  default https://ntfy.sh
    SITE_URL     link opened when the notification is tapped
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import io
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
HIST = DATA / "history"
UNIVERSE_CACHE = Path(__file__).resolve().parent / "sp500.csv"
NY = ZoneInfo("America/New_York")

UNIVERSE_URL = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"
FRED_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DAAA"

G_MIN, G_MAX = 0.0, 15.0          # growth clamp, percent
MIN_QUALITY = 4                    # of 6 checks, to be eligible for Top 5
MAX_PER_SECTOR = 2                 # keep the Top 5 from being one sector
MOS_SANITY = 0.85                  # MOS above this is almost always bad data
NO_BALANCE_SECTORS = {"Financials", "Real Estate", "Utilities"}  # current ratio / D/E not meaningful


# ---------------------------------------------------------------- inputs
def load_universe() -> pd.DataFrame:
    try:
        r = requests.get(UNIVERSE_URL, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        if len(df) > 400:
            df.to_csv(UNIVERSE_CACHE, index=False)
            return df
    except Exception as e:  # noqa: BLE001
        print(f"[universe] fetch failed ({e}); using cache", file=sys.stderr)
    return pd.read_csv(UNIVERSE_CACHE)


def load_aaa_yield() -> tuple[float, str]:
    try:
        r = requests.get(FRED_URL, timeout=30)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        df.columns = ["date", "value"]
        df = df[pd.to_numeric(df["value"], errors="coerce").notna()]
        last = df.iloc[-1]
        return float(last["value"]), str(last["date"])
    except Exception as e:  # noqa: BLE001
        prev = DATA / "latest.json"
        if prev.exists():
            j = json.loads(prev.read_text())
            print(f"[aaa] fetch failed ({e}); reusing {j['aaa_yield']}", file=sys.stderr)
            return j["aaa_yield"], j.get("aaa_date", "")
        return 5.5, "fallback"


def last_trading_day() -> str:
    h = yf.Ticker("SPY").history(period="7d", interval="1d")
    return h.index[-1].tz_convert(NY).date().isoformat() if h.index.tz else h.index[-1].date().isoformat()


# ---------------------------------------------------------------- per stock
def _num(x):
    try:
        x = float(x)
        return None if math.isnan(x) or math.isinf(x) else x
    except (TypeError, ValueError):
        return None


def annual_eps(t: yf.Ticker) -> list[float]:
    """Diluted EPS by fiscal year, oldest first."""
    try:
        inc = t.income_stmt
    except Exception:  # noqa: BLE001
        return []
    if inc is None or inc.empty:
        return []
    for row in ("Diluted EPS", "Basic EPS"):
        if row in inc.index:
            s = inc.loc[row].dropna()
            s = s.sort_index()  # columns are dates
            return [float(v) for v in s.values]
    return []


def fetch_one(sym: str, sector: str, name: str) -> dict | None:
    ysym = sym.replace(".", "-")
    for attempt in range(3):
        try:
            t = yf.Ticker(ysym)
            info = t.info or {}
            price = _num(info.get("currentPrice") or info.get("regularMarketPrice"))
            if price is None:
                raise ValueError("no price")
            eps_hist = annual_eps(t)
            return {"sym": sym, "sector": sector, "name": info.get("shortName") or name,
                    "price": price, "info": info, "eps_hist": eps_hist}
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                print(f"[skip] {sym}: {e}", file=sys.stderr)
                return None
            time.sleep(2 + attempt * 4)
    return None


def evaluate(raw: dict, Y: float) -> dict:
    info, sector = raw["info"], raw["sector"]
    price = raw["price"]
    eps = _num(info.get("trailingEps"))
    fwd_eps = _num(info.get("forwardEps"))
    bvps = _num(info.get("bookValue"))
    eh = raw["eps_hist"]

    # growth
    hist_g = None
    if len(eh) >= 3 and eh[0] > 0 and eh[-1] > 0:
        hist_g = ((eh[-1] / eh[0]) ** (1 / (len(eh) - 1)) - 1) * 100
    fwd_g = None
    if eps and eps > 0 and fwd_eps is not None:
        fwd_g = (fwd_eps / eps - 1) * 100
    # Conservative: the LOWER of historical CAGR and next-year growth (Graham's own caution).
    parts = [g for g in (hist_g, fwd_g) if g is not None]
    g_raw = min(parts) if parts else None
    g = None if g_raw is None else max(G_MIN, min(G_MAX, g_raw))

    value = mos = None
    if eps and eps > 0 and g is not None:
        value = eps * (8.5 + 2 * g) * 4.4 / Y
        mos = (value - price) / value
    graham_number = math.sqrt(22.5 * eps * bvps) if eps and bvps and eps > 0 and bvps > 0 else None

    pe = price / eps if eps and eps > 0 else None
    pb = price / bvps if bvps and bvps > 0 else None
    cr = _num(info.get("currentRatio"))
    de = _num(info.get("debtToEquity"))  # Yahoo reports as percent
    dy = _num(info.get("trailingAnnualDividendYield"))  # fraction
    if dy is None and _num(info.get("dividendYield")) is not None:
        dy = _num(info.get("dividendYield")) / 100  # Yahoo reports this one in percent
    nb = sector in NO_BALANCE_SECTORS

    checks = {
        "stable": bool(len(eh) >= 3 and all(v > 0 for v in eh)),
        "liquidity": True if nb else (cr is not None and cr >= 1.5),
        "debt": True if nb else (de is not None and 0 <= de <= 100),
        "dividend": bool(dy and dy > 0),
        "pe": pe is not None and pe <= 15,
        "pepb": pe is not None and pb is not None and pe * pb <= 22.5,
    }
    quality = sum(checks.values())

    flags = []
    if mos is not None and mos > MOS_SANITY:
        flags.append("mos_outlier")
    if g_raw is not None and g_raw > G_MAX:
        flags.append("g_capped")
    if nb:
        flags.append("balance_na")

    r = lambda x, n=2: None if x is None else round(x, n)  # noqa: E731
    return {
        "sym": raw["sym"], "name": raw["name"], "sector": sector,
        "price": r(price), "eps": r(eps), "fwd_eps": r(fwd_eps), "bvps": r(bvps),
        "eps_hist": [r(v) for v in eh],
        "hist_g": r(hist_g, 1), "fwd_g": r(fwd_g, 1), "g": r(g, 1),
        "value": r(value), "mos": r(mos, 4), "graham_number": r(graham_number),
        "pe": r(pe, 1), "pb": r(pb, 2), "current_ratio": r(cr), "de": r(de, 1),
        "div_yield": r(dy, 4), "mcap": info.get("marketCap"),
        "checks": checks, "quality": quality, "flags": flags,
    }


def pick_top5(rows: list[dict]) -> list[dict]:
    base = [x for x in rows if x["mos"] is not None and x["mos"] > 0
            and "mos_outlier" not in x["flags"] and x["checks"]["stable"]]
    for q in (MIN_QUALITY, MIN_QUALITY - 1, 0):
        pool = sorted([x for x in base if x["quality"] >= q], key=lambda x: x["mos"], reverse=True)
        picked, per = [], {}
        for x in pool:
            if per.get(x["sector"], 0) < MAX_PER_SECTOR:
                picked.append(x)
                per[x["sector"]] = per.get(x["sector"], 0) + 1
            if len(picked) == 5:
                return picked
    return picked


# ---------------------------------------------------------------- outputs
THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]


def thai_date(iso: str) -> str:
    d = datetime.fromisoformat(iso)
    return f"{d.day} {THAI_MONTHS[d.month - 1]} {d.year + 543}"


def notify(top5: list[dict], market_date: str, Y: float) -> None:
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        print("[notify] NTFY_TOPIC not set; skipping")
        return
    server = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    lines = [f"{i}. {x['sym']}  MOS {x['mos']*100:.0f}%  ${x['price']:,.2f} → ${x['value']:,.2f}"
             for i, x in enumerate(top5, 1)]
    lines.append(f"AAA {Y:.2f}% · คุณภาพ ≥{MIN_QUALITY}/6 · ไม่ใช่คำแนะนำการลงทุน")
    body = {
        "topic": topic,
        "title": f"BG Said · 5 หุ้นน่าศึกษา ({thai_date(market_date)})",
        "message": "\n".join(lines),
        "tags": ["chart_with_upwards_trend"],
    }
    if os.environ.get("SITE_URL"):
        body["click"] = os.environ["SITE_URL"]
        body["actions"] = [{"action": "view", "label": "เปิด BG Said", "url": os.environ["SITE_URL"]}]
    r = requests.post(server, data=json.dumps(body).encode(), timeout=30)
    print(f"[notify] {r.status_code}")
    r.raise_for_status()


def write_outputs(payload: dict) -> None:
    HIST.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    (DATA / "latest.json").write_text(txt)
    (HIST / f"{payload['market_date']}.json").write_text(txt)

    idx_path = DATA / "history.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else []
    idx = [d for d in idx if d["date"] != payload["market_date"]]
    idx.append({"date": payload["market_date"], "aaa": payload["aaa_yield"],
                "top5": [{"sym": x["sym"], "mos": x["mos"], "price": x["price"], "value": x["value"]}
                         for x in payload["top5"]]})
    idx.sort(key=lambda d: d["date"])
    idx = idx[-250:]
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")))

    # keep ~3 months of full snapshots (history.json keeps ~1 year of Top 5)
    snaps = sorted(HIST.glob("*.json"))
    for old in snaps[:-60]:
        old.unlink()


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--no-notify", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    today_ny = datetime.now(NY).date().isoformat()
    market_date = last_trading_day()
    market_open_today = market_date == today_ny
    print(f"[run] NY today {today_ny}, last trading day {market_date}")

    Y, aaa_date = load_aaa_yield()
    uni = load_universe()
    if a.limit:
        uni = uni.head(a.limit)
    print(f"[run] AAA {Y}% ({aaa_date}), {len(uni)} tickers")

    t0 = time.time()
    raws = []
    with cf.ThreadPoolExecutor(a.workers) as ex:
        futs = [ex.submit(fetch_one, r.Symbol, r["GICS Sector"], r.Security) for _, r in uni.iterrows()]
        for i, f in enumerate(cf.as_completed(futs), 1):
            if (res := f.result()):
                raws.append(res)
            if i % 50 == 0:
                print(f"  {i}/{len(futs)}  {time.time()-t0:.0f}s")

    rows = [evaluate(x, Y) for x in raws]
    rows.sort(key=lambda x: (x["mos"] is None, -(x["mos"] or 0)))
    top5 = pick_top5(rows)

    payload = {
        "app": "BG Said", "market": "US · S&P 500",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "market_date": market_date, "aaa_yield": Y, "aaa_date": aaa_date,
        "params": {"g_min": G_MIN, "g_max": G_MAX, "min_quality": MIN_QUALITY, "max_per_sector": MAX_PER_SECTOR,
                   "mos_sanity": MOS_SANITY, "base_pe": 8.5, "graham_yield": 4.4},
        "stats": {"universe": len(uni), "fetched": len(rows),
                  "valued": sum(x["mos"] is not None for x in rows),
                  "undervalued": sum((x["mos"] or 0) > 0 for x in rows),
                  "seconds": round(time.time() - t0)},
        "top5": top5, "stocks": rows,
    }
    if len(rows) < 0.8 * len(uni):
        print(f"[run] only {len(rows)}/{len(uni)} fetched — not publishing", file=sys.stderr)
        return 1
    write_outputs(payload)
    print("[run] top5:", ", ".join(f"{x['sym']} {x['mos']*100:.0f}%" for x in top5))

    if a.no_notify:
        return 0
    if market_open_today or a.force:
        notify(top5, market_date, Y)
    else:
        print("[notify] market closed today; skipping")
    return 0


if __name__ == "__main__":
    sys.exit(main())
