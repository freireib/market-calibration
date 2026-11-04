# Market Calibration

**Analyzing the accuracy, calibration, and predictive performance of prediction markets.**

A lightweight, provider-neutral browser dashboard for historical probability forecasts.
The first research study is **2026 US midterm elections**, beginning with Kalshi quote
snapshots. The app is designed in the spirit of
[CalibrationLab](https://github.com/freireib/calibration-lab): plain HTML, CSS and
JavaScript, mobile friendly, transparent statistics and portable data.

## Status — v0.1

- ✅ Static web interface: multi-horizon reliability curves, scores, market browser and CSV export
- ✅ Provider-neutral versioned JSON data contract, with no invented election outcomes
- ✅ Kalshi source adapter with curated market catalog and offline self-test
- ⏳ **Real history has not yet been collected.** The checked-in dataset is empty.
- ⏳ Market discovery, independent AP race calls, additional market sources and automated refresh are future work.
- ⚠️ The API collector has **not yet been exercised against the live Kalshi API**. Review any responses and the market catalog before presenting empirical scores.

## Run the app locally

Use Python 3 and serve the repository; loading JSON from a `file://` page may
be blocked by your browser.

```bash
git clone https://github.com/freireib/market-calibration.git
cd market-calibration
python3 -m http.server 8000
```

Open **http://localhost:8000/**.

To publish the same static app with GitHub Pages, open the repository's
**Settings → Pages**, select **Deploy from a branch**, and choose `main` /
`/(root)`. No build step or hosting API key is necessary.

## Collect the first Kalshi observations

The standard-library-only collector requires Python **3.9+ with zoneinfo**.

```bash
python3 scripts/collect_kalshi.py --self-test
python3 scripts/collect_kalshi.py
```

The initial `data/markets.json` catalog contains **only one pilot market**:
a Democratic-win contract for CA-22. That is a test of the collection pathway,
**not** a representative sample of all US House races. Verify the ticker and
market semantics from the exchange before adding more contracts. A full
reliability study requires a comprehensive, deduplicated catalog.

The collector uses public market-data APIs. It requests hourly candlesticks up
to each fixed time horizon, tries the live tier and the archive tier, computes
the midpoint of the most recent two-sided YES bid/ask no older than 24 hours
with spread ≤ $0.20, and computes seven-day pre-snapshot contract volume.
It refuses to use a candle ending after the snapshot.

It writes `data/observations.json` **only after all its requests complete**.
If a request fails, the previous dataset remains unchanged.

### Outcome verification

The first adapter automatically scores **Kalshi-settled** binary contracts.
Settlement is not the same as an AP election call. To include earlier
independently verified calls, fill out `data/verified_outcomes.csv`:

```csv
event_id,outcome,status,source_url
```

Rows require an exact event ID from the catalog, a 0/1 outcome, a status of
`called`, `certified`, or `settled`, and the specific public source URL.
Do **not** infer an election winner from a candidate's lead in reported votes.
Only populate trusted outcomes. The adapter does not yet fetch AP or NYT calls
automatically.

**Definition:** A contract is a binary YES proposition. Its event outcome is 1
if that proposition occurs and 0 if it does not. For the initial pilot, YES
means the Democratic candidate wins CA-22.

## Snapshot design

| Horizon | Time in US Eastern |
| --- | --- |
| Two months | 2026-09-03 15:00 |
| One month | 2026-10-03 15:00 |
| One day | 2026-11-02 15:00 |

These are *calendar* months rather than fixed multiples of 30 days. For each
event and horizon the input stores one quote-implied probability (bid/ask
midpoint), source, timestamp, quality information and pre-snapshot volume.
A quote midpoint is a market-implied estimate, not necessarily a perfectly
calibrated real-world probability.

### Versioned web-data schema

`data/observations.json` contains:

- `schema_version: 1`
- `generated_at`, `source`
- `records`: array of `{provider, event_id, label, category, market_ticker,
  horizon, snapshot_utc, probability, outcome, volume_7d, spread,
  outcome_status, outcome_source}` (collector also adds quote quality fields)

Use `null` for unknown probabilities and outcomes. The browser refuses
duplicate provider / event / horizon combinations and rejects invalid
probabilities or outcomes. A non-null outcome requires an explicit call,
certification, settlement, or other resolved status.

The same schema can be produced later by Polymarket or other providers.
A provider is part of each market's identity, allowing side-by-side analyses.

## Statistical methodology

For an event with implied probability `p` and eventual binary outcome `y`:

```text
Brier = (p - y)^2
Mean Brier = sum(w_i * (p_i - y_i)^2) / sum(w_i)
```

The primary weights are `w_i = 1`. Secondary options are previous seven-day
contract volume or its square root. The dashboard aggregates outcomes in
0.10-wide probability bins and plots the mean observed rate against the mean
forecast. Its intervals use the Wilson formula at 95%, and for weighted
bins an approximate Kish effective sample size. Correlations among election
outcomes violate simple independent-bin assumptions, so these intervals are
exploratory.

The **matched cohort** switch restricts comparisons to events with valid,
resolved forecasts at all three horizons. Each event counts once at each
horizon; the same event is not scored twice merely because complementary
YES/NO or Republican/Democratic contracts exist.

Low-liquidity, missing, stale or wide-spread quotes are excluded rather than
guessed. The 24-hour, $0.20, and volume thresholds are explicit modeling
choices to sensitivity-test, not properties guaranteed by the exchange.

## Near-term roadmap

1. Run and debug a pilot historical download; inspect raw API payloads.
2. Expand and audit a complete 2026 House/Senate/Governor binary-event catalog.
3. Integrate a reliable outcomes feed with explicit *called*, *uncalled* and
   *certified* statuses; retain source provenance.
4. Compare equal-weight, liquidity-filtered, and volume-weighted calibration;
   break results out by office and competitiveness.
5. Add other prediction markets without changing the dashboard schema.
6. Automate collection only after the manual pipeline has been validated.

## Sources

- [Kalshi live candlestick endpoint](https://docs.kalshi.com/api-reference/market/get-market-candlesticks)
- [Kalshi historical API](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks)
- [Associated Press Elections API](https://developer.ap.org/ap-elections-api/index.html)
- [CalibrationLab reference project](https://github.com/freireib/calibration-lab)

Not trading advice. The repository contains no simulated actual election results.
