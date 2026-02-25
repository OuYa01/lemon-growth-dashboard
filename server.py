"""
LemonWatch · Flask Backend (v2 — separated files)
===================================================
Serves:
  /                      → templates/index.html
  /static/style.css      → static/style.css
  /static/dashboard.js   → static/dashboard.js
  /api/data              → JSON payload
  /api/status            → health check
"""

import os
import sqlite3
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template
from flask_cors import CORS

# ── Base directory: always the folder where server.py lives ───────
# This makes paths work correctly no matter which directory you run
# `python server.py` from — the most common cause of "mock data" bugs.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Config ────────────────────────────────────────────────────────
CSV_PATH     = os.environ.get("LEMON_CSV",    os.path.join(BASE_DIR, "data", "lemon_measurements.csv"))
SQLITE_PATH  = os.environ.get("LEMON_SQLITE", os.path.join(BASE_DIR, "data", "lemon_measurements.db"))
SQLITE_TABLE = "lemon_measurements"
CONF_THRESHOLD = 0.70

# Flask paths also anchored to BASE_DIR so templates/static always found
app = Flask(__name__,
            template_folder=os.path.join(BASE_DIR, "templates"),
            static_folder=os.path.join(BASE_DIR, "static"))
CORS(app)


# ── Data loading ──────────────────────────────────────────────────
def load_raw() -> tuple[pd.DataFrame, str]:
    if os.path.exists(CSV_PATH):
        df = pd.read_csv(CSV_PATH, parse_dates=["timestamp"])
        return df, f"csv:{CSV_PATH}"
    if os.path.exists(SQLITE_PATH):
        con = sqlite3.connect(SQLITE_PATH)
        df  = pd.read_sql(f"SELECT * FROM {SQLITE_TABLE}", con, parse_dates=["timestamp"])
        con.close()
        return df, f"sqlite:{SQLITE_PATH}"
    return generate_mock(), "mock"


def process(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df[df["confidence"] >= CONF_THRESHOLD]
    df["date"] = df["timestamp"].dt.normalize().dt.strftime("%Y-%m-%d")
    return df


def build_payload(df: pd.DataFrame) -> dict:
    fleet = (
        df.groupby("date")["diameter_cm"]
        .agg(median=lambda x: float(np.median(x)),
             q25   =lambda x: float(np.quantile(x, 0.25)),
             q75   =lambda x: float(np.quantile(x, 0.75)))
        .reset_index()
    )
    counts = df.groupby("date")["lemon_id"].nunique().rename("count").reset_index()
    fleet  = fleet.merge(counts, on="date").sort_values("date")

    lemon_daily_raw = (
        df.groupby(["lemon_id", "date"])["diameter_cm"]
        .median().reset_index()
    )
    lemon_daily_raw.columns = ["lemon_id", "date", "median"]
    lemon_daily_raw["median"] = lemon_daily_raw["median"].round(3)

    lemon_daily = {}
    for lid, grp in lemon_daily_raw.groupby("lemon_id"):
        lemon_daily[int(lid)] = grp[["date","median"]].sort_values("date").to_dict(orient="records")

    latest_date = df["date"].max()
    latest_dist = df[df["date"] == latest_date]["diameter_cm"].round(3).tolist()
    lemon_ids   = sorted(df["lemon_id"].unique().tolist())

    last  = fleet.iloc[-1]
    prev  = fleet.iloc[-2] if len(fleet) > 1 else last
    summary = {
        "lemons_today":    int(last["count"]),
        "lemons_delta":    int(last["count"] - prev["count"]),
        "median_diameter": round(float(last["median"]), 2),
        "diameter_delta":  round(float(last["median"] - prev["median"]), 2),
        "days_monitored":  int(df["date"].nunique()),
        "date_range":      f"{df['date'].min()} → {df['date'].max()}",
        "avg_confidence":  round(float(df["confidence"].mean()), 3),
        "measurements":    int(len(df)),
        "latest_date":     latest_date,
    }
    return {
        "fleet_daily": fleet.to_dict(orient="records"),
        "lemon_daily": lemon_daily,
        "latest_dist": latest_dist,
        "lemon_ids":   [int(x) for x in lemon_ids],
        "summary":     summary,
    }


def generate_mock(n_lemons=20, n_days=50, seed=42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    start = datetime(2024, 3, 1)
    rows  = []
    for lid in range(1, n_lemons + 1):
        offset   = rng.uniform(0, 12)
        max_diam = rng.uniform(5.5, 8.2)
        k        = rng.uniform(0.12, 0.20)
        for day in range(n_days):
            for _ in range(rng.integers(2, 5)):
                hour   = rng.integers(6, 20)
                minute = int(rng.choice([0, 30]))
                ts     = start + timedelta(days=int(day), hours=int(hour), minutes=minute)
                t      = max(0.0, day - offset)
                diam   = max_diam / (1 + np.exp(-k * (t - 16)))
                diam  += rng.normal(0, 0.12)
                conf   = float(rng.beta(8, 2)) * 0.3 + 0.7
                if rng.random() < 0.08:
                    conf = float(rng.uniform(0.3, 0.69))
                rows.append({
                    "timestamp":   ts.isoformat(),
                    "lemon_id":    lid,
                    "diameter_cm": round(float(max(0.5, diam)), 3),
                    "confidence":  round(float(conf), 3),
                })
    return pd.DataFrame(rows)


# ── Routes ────────────────────────────────────────────────────────
@app.route("/")
def index():
    # Flask looks in templates/index.html automatically
    return render_template("index.html")


@app.route("/api/data")
def api_data():
    raw, source = load_raw()
    df          = process(raw)
    payload     = build_payload(df)
    payload["_meta"] = {
        "source":    source,
        "generated": datetime.utcnow().isoformat() + "Z",
        "rows_raw":  len(raw),
        "rows_kept": len(df),
        "filtered":  len(raw) - len(df),
    }
    return jsonify(payload)


@app.route("/api/download")
def api_download():
    """Return the raw (post-filter) data as a downloadable CSV."""
    from flask import Response
    raw, source = load_raw()
    df          = process(raw)
    # Add a human-readable date column
    df_out = df.copy()
    df_out["date"] = df_out["timestamp"].dt.strftime("%Y-%m-%d")
    csv_str = df_out[["timestamp","lemon_id","diameter_cm","confidence","date"]].to_csv(index=False)
    return Response(
        csv_str,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=lemon_measurements_export.csv"}
    )


@app.route("/api/anomalies")
def api_anomalies():
    """
    Detect per-lemon anomalies: days where diameter change vs prior day
    exceeds threshold (default ±1.5 cm, configurable via ?threshold=X).
    Returns list of {lemon_id, date, diameter, prev_diameter, delta, type}.
    """
    from flask import request as freq
    threshold = float(freq.args.get("threshold", 1.5))
    raw, _  = load_raw()
    df      = process(raw)

    # Daily median per lemon
    daily = (
        df.groupby(["lemon_id","date"])["diameter_cm"]
        .median().reset_index()
        .rename(columns={"diameter_cm":"median"})
        .sort_values(["lemon_id","date"])
    )

    anomalies = []
    for lid, grp in daily.groupby("lemon_id"):
        grp = grp.reset_index(drop=True)
        for i in range(1, len(grp)):
            delta = grp.loc[i,"median"] - grp.loc[i-1,"median"]
            if abs(delta) >= threshold:
                anomalies.append({
                    "lemon_id":      int(lid),
                    "date":          grp.loc[i,"date"],
                    "diameter":      round(float(grp.loc[i,"median"]),3),
                    "prev_diameter": round(float(grp.loc[i-1,"median"]),3),
                    "delta":         round(float(delta),3),
                    "type":          "drop" if delta < 0 else "spike",
                })

    return jsonify({
        "anomalies": sorted(anomalies, key=lambda x: abs(x["delta"]), reverse=True),
        "threshold": threshold,
        "total":     len(anomalies),
    })


@app.route("/api/status")
def api_status():
    raw, source = load_raw()
    df          = process(raw)
    return jsonify({
        "ok":          True,
        "source":      source,
        "latest_date": df["date"].max() if not df.empty else None,
        "total_rows":  len(df),
        "server_time": datetime.utcnow().isoformat() + "Z",
    })


# ── Entry point ───────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n  🍋  LemonWatch Backend")
    print("  ─────────────────────────────────────")
    print(f"  Base dir    : {BASE_DIR}")
    print(f"  CSV path    : {CSV_PATH}")
    print(f"  CSV found   : {os.path.exists(CSV_PATH)}")
    print(f"  SQLite path : {SQLITE_PATH}")
    print(f"  Dashboard   : http://localhost:5000")
    print(f"  Data API    : http://localhost:5000/api/data")
    print(f"  Status      : http://localhost:5000/api/status")
    print("  ─────────────────────────────────────\n")
    if not os.path.exists(CSV_PATH):
        print("  ⚠  WARNING: CSV not found — serving mock data")
        print(f"     Expected file at: {CSV_PATH}\n")
    app.run(debug=True, port=5000)