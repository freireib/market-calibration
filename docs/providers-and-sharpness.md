# Provider interoperability and comparison protocol

## Status

The dashboard currently exposes two distinct 2026-primary datasets:
1. **Kalshi:** 30 nomination contests, with historical YES bid/ask midpoints and prior-seven-day contract volume.
2. **Polymarket:** 11 curated, fully resolved nomination contests (266 listed candidate contracts and 322 usable forecasts) at four pre-election horizons. Prices are archived YES-token CLOB prices, not reconstructed Kalshi-style bid/ask midpoints. The source catalog is `data/polymarket_primary_events.json`.

The platform datasets are **not pooled**. A single calibration curve contains observations from only the provider selected in the dashboard. The Polymarket pilot is too small and selected to serve as a credible platform-level performance ranking.

## Audited shared event definitions

| Contest | Kalshi catalog event | Polymarket event slug | Primary date |
| --- | --- | --- | --- |
| Florida Republican governor nomination | `KXGOVFLNOMR-26` | `republican-nominee-for-florida-governor` | 2026-08-18 |
| Michigan Democratic Senate nomination | `KXSENATEMID-26` | `michigan-democratic-senate-primary-winner` | 2026-08-04 |
| Maine Democratic Senate nomination | `KXSENATEMED-26` | `maine-democratic-senate-primary-winner` | 2026-06-09 |
| Wisconsin Democratic governor nomination | `KXGOVWINOMD-26` | `wisconsin-governor-democratic-primary-winner` | 2026-08-11 |
| New Hampshire Democratic Senate nomination | `KXSENATENHD-26` | `new-hampshire-democratic-senate-primary-winner` | 2026-09-08 |
| Illinois Democratic Senate nomination | `KXSENATEILD-26` | `illinois-democratic-senate-primary-winner` | 2026-03-17 |
| Texas Democratic Senate nomination | `KXSENATETXD-26` | `texas-democratic-senate-primary-winner` | 2026-03-03 |
| Texas Republican Senate nomination (runoff) | `KXSENATETXR-26` | `texas-republican-senate-primary-winner` | 2026-05-26 |
| Massachusetts Democratic Senate nomination | `KXSENATEMAD-26` | `massachusetts-democratic-senate-primary-winner` | 2026-09-01 |
| Minnesota Democratic Senate nomination | Not yet mapped | `minnesota-democratic-senate-primary-winner` | 2026-08-11 |
| Delaware Democratic Senate nomination | Not yet mapped | `delaware-democratic-senate-primary-winner` | 2026-09-15 |

Matching contest titles is not sufficient to match **candidate contracts**. Kalshi and Polymarket offered different sets of candidates and additional generic or anonymized options. Each same-candidate proposition must be matched and resolution rules inspected before calculating paired performance.

## Differences that prohibit naive pooling

- **Probability statistic:** Kalshi uses midpoint of the historical YES bid and ask with a freshness/spread rule. Polymarket uses archived CLOB YES-token price history. The latter is not a reconstruction of a historical two-sided quoted midpoint.
- **Liquidity/volume:** Kalshi has seven-day pre-snapshot contract volume. The Polymarket pilot does **not** have a comparable seven-day volume series. Lifetime USD volume is not a substitute for previous-seven-day contract volume.
- **Candidate universe and missingness:** A nomination contest is multicategory. Counting each candidate YES market equally means a platform with more candidate contracts gets more low-probability observations, lowering the typical binary-contract Brier even with no superior forecasting skill.
- **Resolution and market wording:** Markets may differ in runoff treatment, replacement candidates, unusual settlement contingencies, and dates. Verify source-specific rules.
- **Timing:** Use exactly the same local clock timestamp for any matched pair. A delayed close, quote gap, or missing early market must remain missing.
- **Scoring:** Primary charts use binary-contract Brier. A fair candidate-level comparison would score **only the intersection of manually matched candidate contracts** on both platforms, and a contest-level comparison would require complete mutually exclusive probabilities and a separate multicategory scoring rule.
- **Inference:** Treat candidates within a primary as correlated; use contest-level bootstrap or other cluster-robust uncertainty rather than ordinary independent-bin Wilson intervals.

## Information diagnostics

For each binary contract forecast, Shannon entropy is `H(p)=-p log2(p)-(1-p) log2(1-p)`, in bits. Mean entropy across all available scored contracts describes **forecast uncertainty**, not forecast accuracy. The complementary measure `1-H(p)` is a relative sharpness measure compared with a 50/50 baseline.

If an individual forecast is calibrated with conditional success probability `p`, its expected Brier loss is `p(1-p)`. The dashboard overlays the average of these calibrated-reference losses against the empirical Brier score **on the same selected observations and weights**. Their difference is not itself a proper decomposition of calibration error: sampling variability, dependence, and outcome mixtures matter. Use reliability diagrams and proper calibration/resolution decompositions for further work.

In addition, the probability distribution chart shows what fraction of forecasts lie near 0%, 100%, or in the middle 25–75%, which helps reveal why a low aggregate Brier can coexist with weak evidence about calibration in the middle.

## Rebuilding Polymarket primary data

```bash
python3 scripts/collect_polymarket.py --self-test
python3 scripts/collect_polymarket.py
```

Or run **GitHub Actions → Collect Polymarket primary pilot → Run workflow**. Source catalog: `data/polymarket_primary_events.json`. Output: `data/polymarket_primaries_2026_pilot.json`.

API sources: [Polymarket market data guide](https://institute.polymarket.com/data), [Polymarket Gamma](https://gamma-api.polymarket.com), and [Polymarket CLOB](https://clob.polymarket.com).
