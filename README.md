# Market Calibration

**Analyzing the accuracy, calibration, and predictive performance of prediction markets.**

A lightweight, provider-neutral browser dashboard for historical probability forecasts.
The initial studies cover the **2026 US general election** and **2026 primary nominations**, beginning with Kalshi's historical prices. The app is designed in the spirit of
[CalibrationLab](https://github.com/freireib/calibration-lab): plain HTML, CSS and
JavaScript, mobile friendly, transparent statistics and portable data.

## Status — expanded data (November 12, 2026)

- ✅ Static browser dashboard with reliability diagrams, selectable KDEs, Brier scores, entropy/sharpness summaries, historical volume sensitivity, matched cohort selection, and CSV export.
- ✅ **Kalshi 2026 general election:** 487 verified Democratic-party winner markets: **422 House**, 32 Senate, and 33 gubernatorial races. Their three historical horizons yield **1,402 usable forecasts**, with **1,369** already scorable against finalized exchange outcomes. The new `KXHOUSERACE` series supplies 358 additional House districts without double-counting legacy district contracts.
- ✅ **Kalshi 2026 primaries:** 30 curated resolved nomination contests, 245 listed candidate contracts and 659 scored historical forecasts.
- ✅ **Polymarket 2026 primaries:** 11 curated resolved nomination contests, 266 listed candidate contracts and 322 scored historical CLOB prices, kept strictly separate from Kalshi.
- ✅ Automated validation in GitHub Actions and a **Refresh all market data** workflow. Use the repository Actions tab to run collections; the app's Refresh data button only reloads datasets already published.
- ⚠️ Coverage is **not** a representative sample of all events. The new House districts are mostly high-confidence races; the increased sample size does not imply a comparable increase in forecasts near 50%. Of 435 House districts, 422 currently have one verified Democratic-win market in the study catalog.
- ⚠️ Only exchange-resolved outcomes are scored; independent election-result verification remains future work. Multi-candidate primaries are pooled at the contract level **within their own provider**, not treated as independent elections. Polymarket and Kalshi are never pooled together by default.

## 2026 primary study

Choose **2026 Primaries** in the dashboard's Study menu. The data are collected from archived candidate YES contracts for 30 curated 2026 primary and runoff nomination events; the series/date catalog is at [`data/primary_events_2026.json`](data/primary_events_2026.json). Four date-relative snapshots are supported: 2 months, 1 month, 1 week, and 1 day before each contest.

The primary reliability diagram is **binary candidate-contract calibration**, not a multicategory score of distinct primary elections. Candidate outcomes within an election are dependent, and contests with more candidate contracts contribute more records. See [`docs/primaries.md`](docs/primaries.md) for methods and sampling limitations.

Run `python3 scripts/collect_primaries.py`, or use **Actions → Collect 2026 primary history → Run workflow** to refresh the public `data/primaries_2026.json` dataset.

## Forecast sharpness and additional prediction markets

The current interface includes three new views on the filtered observations:

- **Forecast probability distributions:** overlapping Gaussian kernel-density estimates
  (KDEs), with YES probability on the x-axis and density on the y-axis. One
  curve per forecast horizon uses the same colors as the reliability diagram.
  Kernels reflect at 0% and 100% to avoid edge bias; smoothing bandwidth
  is adjustable (4, 7, 10, or 15 percentage points). Each density integrates
  to 1, so different-sized samples remain comparable in shape.
- **Forecast uncertainty by horizon:** mean binary entropy
  `H(p)=-p log2 p -(1-p) log2(1-p)`, measured in bits.
- **Brier over time versus a calibrated-reference benchmark:** actual mean
  Brier compared with mean `p(1-p)` calculated on the same observations. This
  is a diagnostic reference, not a direct measure of calibration error.

All diagnostics share the office, date/horizon, pre-snapshot volume and matched
cohort filters. The confidence-bin visibility threshold does *not* change
the observations used in these summaries. Different horizons can have
different sample composition; for direct time comparisons turn on Matched cohort.

The provider selector keeps **Kalshi and Polymarket strictly separate**.
The Polymarket study now includes **11 fully resolved 2026 primary contests**
(266 listed candidate contracts and 322 usable pre-election forecast observations),
including nine newly added nomination markets. This is still a curated sample,
not a random sample or an independent set of 322 events.
Polymarket's historical YES-token CLOB prices are *not* the same statistic as
Kalshi's historical YES bid/ask midpoints. The Polymarket pilot does not contain
comparable seven-day historical contract volumes, so those filters are disabled.
It is not a representative sample for ranking platforms.

See [`docs/providers-and-sharpness.md`](docs/providers-and-sharpness.md)
for the matching, candidate-universe, sample dependence and scoring cautions.

## Interactive data controls

**Refresh data** re-fetches the currently selected study's published JSON dataset
without reloading the page or resetting the selected filters. The button does
not invoke Kalshi or run a GitHub Actions collector; run the appropriate collector
workflow first when fresh market settlements are needed.

The calibration filters provide **minimum and maximum seven-day pre-snapshot
contract volume**, equally weighted or volume-weighted scores, and **probability
bins of 5%, 10%, 20%, or 25%**. A minimum observations-per-bin threshold hides
insufficiently populated bins in the reliability chart and audit table.

Volume filters apply to the score, reliability diagram, matched-cohort comparison,
and market table. Observations with unknown seven-day volume are excluded
whenever either volume limit is set. The bin-count visibility filter is *only*
a chart/display filter: **Brier scores still use all forecasts passing the
volume, office, horizon, and matched-cohort filters.** The chart shows how
many forecast observations were hidden in low-count bins.

All thresholds are exploratory. Excluding high-volume markets changes the
population being analyzed; it does not demonstrate market manipulation.

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

The generated `data/markets.json` catalog contains verified 2026 Democratic-win contracts returned by Kalshi. Run `python3 scripts/discover_kalshi.py --scope all` to rebuild it; the repository workflow runs discovery and collection together. Coverage is restricted to listed Kalshi markets and excludes some at-large House series pending a naming-convention fix.

The collector uses public market-data APIs. It requests hourly candlesticks up
to each fixed time horizon, tries the live tier and the archive tier, computes
the midpoint of the most recent two-sided YES bid/ask no older than 24 hours
with spread ≤ $0.20, and computes seven-day pre-snapshot contract volume.
It refuses to use a candle ending after the snapshot.

It writes `data/observations.json` **only after all its requests complete**.
If a request fails, the previous dataset remains unchanged.

### Outcome verification

The first adapter automatically scores **Kalshi-finalized** binary contracts.
Settlement is not the same as an AP election call. To include earlier
independently verified calls, fill out `data/verified_outcomes.csv`:

```csv
event_id,outcome,status,source_url
```

Rows require an exact event ID from the catalog, a 0/1 outcome, a status of
`called`, `certified`, `settled`, or `resolved`, and the specific public source URL.
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

1. Complete a market-by-market discovery audit, including at-large House districts and unexplained missing Kalshi contracts.
2. Preserve reproducible sample cohorts while more election outcomes finalize.
3. Integrate a reliable outcomes feed with explicit *called*, *uncalled* and
   *certified* statuses; retain source provenance.
4. Compare equal-weight, liquidity-filtered, and volume-weighted calibration;
   break results out by office and competitiveness.
5. Add other prediction markets without changing the dashboard schema.
6. Add scheduled refresh after reviewing the one-time workflow runs and the outcome-source policy.

## Sources

- [Kalshi live candlestick endpoint](https://docs.kalshi.com/api-reference/market/get-market-candlesticks)
- [Kalshi historical API](https://docs.kalshi.com/api-reference/historical/get-historical-market-candlesticks)
- [Associated Press Elections API](https://developer.ap.org/ap-elections-api/index.html)
- [CalibrationLab reference project](https://github.com/freireib/calibration-lab)

Not trading advice. The repository contains no simulated actual election results.
