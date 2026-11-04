# 2026 primary election study

This dataset is an **exploratory, contract-level calibration analysis** of Kalshi's 2026 U.S. primary nomination markets. It is not a census of all primaries and is not a statistically independent sample of binary events.

## Data and provenance

- Curated contest catalog: [`data/primary_events_2026.json`](../data/primary_events_2026.json).
- Public, documented primary listing: https://kalshi.com/category/elections/primaries.
- Primary and runoff dates: https://www.ncsl.org/elections-and-campaigns/2026-state-primary-election-dates.
- Kalshi archived market API: `/historical/markets?series_ticker=...`, and archived candlesticks under `/historical/markets/{ticker}/candlesticks`.
- The runner queries current market endpoints where a market has not yet transferred to the archive.
- All downloaded outcomes must be finalized and exactly **one** candidate's YES contract must resolve YES within each event. Any unresolved or inconsistent event is not scored.
- The source for an outcome is the exchange's contract settlement, not an independently verified AP race call.

## Timing

Snapshots are at **3:00 p.m. America/New_York** on the day exactly 1 day, 7 days, 1 calendar month, or 2 calendar months before the primary's decisive election date (including runoff where applicable).

Only bid/ask candlesticks whose timestamps are at or before a snapshot are considered. The quote must be at most 24 hours old, two-sided, and have a spread no greater than 20 cents. Seven-day trading volume is measured prior to the forecast snapshot.

Missing or stale historical quotes are **null**; they are not inferred or set to zero.

## Interpretation

Each primary is a multicategory event: one nominee is chosen from several candidates. Kalshi, however, offers a separate YES/NO contract on each candidate.

The dashboard's primary reliability diagram pools these binary candidate contracts. Its displayed Brier score is the **mean per candidate contract**, not the multicategory Brier of each nomination election. Candidate contracts within one contest are strongly dependent, so the naive Wilson intervals shown on the chart may overstate precision. Elections with more listed candidate contracts can contribute more observations and alter the aggregate score.

To make event-level comparisons later, an appropriate alternative is to calculate a single multicategory score per complete contest, with careful treatment of absent candidate prices and any overround in mutually exclusive market contracts. That is not implemented here.

## Sampling limits

The curated first batch covers 30 Kalshi primary nomination events chosen from highly visible 2026 markets, including statewide and House contests. This is not a random sample, and trading interest determines visibility. Some events were created later than the two-month horizon; their two-month probabilities are missing.

A blank result can mean that an event never traded at that horizon, no valid recent quote existed, or API archival data was unavailable. Data quality should be examined before comparing time horizons. The matched-cohort control compares only candidate contracts with valid forecasts at all **currently selected** horizons.

## Rebuilding

From the repository root:

```bash
python3 scripts/collect_primaries.py --self-test
python3 scripts/collect_primaries.py
```

Or run **GitHub Actions → Collect 2026 primary history → Run workflow**. On success it validates and publishes `data/primaries_2026.json` to GitHub Pages.

We expect to add full multicategory proper scoring rules, cluster-aware uncertainty intervals, stratification by liquidity and race competitiveness, and other prediction-market sources.
