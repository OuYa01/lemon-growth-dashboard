# Station El Guerdane — lemon Growth Dashboard

A precision agriculture dashboard for monitoring lemon growth at **Station El Guerdane**. Built on fixed-camera phenotyping with 30-minute capture intervals and nightly computer vision processing.

---

## Features

- **Real-time growth tracking** — fleet-wide median diameter with IQR bands over time
- **Individual lemon curves** — per-lemon sigmoid growth visualization
- **Multi-lemon comparison** — overlay up to 6 lemons on a single chart
- **Anomaly detection** — automatic flagging of diameter spikes and drops (≥ 1.5 cm/day)
- **Diameter distribution** — histogram of all measurements on the latest day
- **Detection quality** — daily lemon count with confidence filtering (< 0.70 excluded)
- **Time filtering** — date pickers, quick presets (7d / 14d / 30d), and a minimap scrubber
- **Zoom & pan** — scroll-wheel zoom and drag-to-pan on all time-series charts
- **CSV export** — download the filtered dataset directly from the browser

---

## Project Structure

```
dashboard/
├── server.py               ← Flask backend (data loading, API endpoints)
├── requirements.txt        ← Python dependencies
├── data/
│   └── lemon_measurements.csv   ← your measurement data goes here
├── templates/
│   └── index.html          ← dashboard HTML (served by Flask)
└── static/
    ├── style.css           ← all styles and layout
    └── dashboard.js        ← all charts, interactions, and logic
```

---

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Add your data

Place your CSV at `data/lemon_measurements.csv`.

Required columns:

| Column         | Type       | Example               |
|----------------|------------|-----------------------|
| `timestamp`    | ISO 8601   | `2024-04-01 08:30`    |
| `lemon_id`     | integer    | `7`                   |
| `diameter_cm`  | float      | `4.821`               |
| `confidence`   | float 0–1  | `0.93`                |

> If no CSV is found, the server automatically falls back to **synthetic mock data** so you can explore the dashboard before connecting real data.

### 3. Start the server

```bash
cd dashboard
python server.py
```

### 4. Open the dashboard

Visit **[http://localhost:5000](http://localhost:5000)** in your browser.

---

## API Endpoints

| Endpoint          | Description                                              |
|-------------------|----------------------------------------------------------|
| `GET /`           | Serves the dashboard                                     |
| `GET /api/data`   | Full processed payload — fleet stats, per-lemon curves   |
| `GET /api/anomalies` | Detected diameter anomalies (`?threshold=1.5`)        |
| `GET /api/status` | Server health check and data source info                 |

---

## Data Pipeline

```
Fixed camera (every 30 min)
        ↓
Nightly CV batch processing
        ↓
lemon_measurements.csv  (append new rows)
        ↓
Flask server  →  filters confidence < 0.70
        ↓
Dashboard auto-refreshes on next page load
```

No server restart is needed when new data is appended — click **↻ Refresh Data** in the dashboard footer.

---

## Configuration

Environment variables for custom paths:

```bash
# Use a different CSV location
LEMON_CSV=path/to/my_data.csv python server.py

# Use SQLite instead of CSV
LEMON_SQLITE=data/lemon_measurements.db python server.py
```

The anomaly detection threshold (default 1.5 cm/day) can be adjusted via the API:

```
/api/anomalies?threshold=2.0
```

---

## Requirements

- Python 3.10+
- Flask, flask-cors, pandas, numpy

```
flask>=3.0
flask-cors>=4.0
pandas>=2.0
numpy>=1.26
```

---

*Station El Guerdane · Precision Agriculture · Citrus Division*