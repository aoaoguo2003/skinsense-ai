# Claude 10-Run Smoke Evaluation - 2026-06-11

This reviewed summary covers 10 sequential calls to the deployed Render
service after Anthropic billing was restored. Raw model outputs remain local.

## Results

| Metric | Result |
| --- | ---: |
| API workflow availability | 10 / 10 |
| Required response schema | 100% |
| User concern coverage | 100% |
| Catalog grounding for measurable recommendations | 100% |
| Avoided ingredient compliance where measurable | 100% |
| Cases with retrieved catalog candidates | 4 / 10 |
| End-to-end case pass rate | 4 / 10 |
| Average end-to-end latency | 106.7 s |
| P95 end-to-end latency | 133.4 s |
| Average product retrieval latency | 0.66 s |
| Average model latency | 105.1 s |
| Model retries | 0 |
| Retrieval errors | 0 |

Price, texture, and fragrance compliance were reported as unavailable when the
catalog evidence did not contain those fields. Missing evidence is not counted
as a violation.

## Main Finding

All four cases without a fragrance-free requirement retrieved 12 candidates and
passed. All six cases requiring fragrance-free products retrieved zero
candidates and failed the end-to-end quality gate.

The current Open Beauty Facts dataset has sparse `fragrance_free` labels. The
retrieval query intentionally requires `fragrance_free IS TRUE` for sensitive
users, so products with unknown fragrance status are excluded. This behavior is
safe but produces low recall.

## Engineering Interpretation

1. Claude billing recovery restored workflow availability from 7/30 in the
   earlier run to 10/10.
2. The model consistently returned the required structure and covered the
   requested concerns.
3. Vector retrieval is not the performance bottleneck. The model node accounts
   for nearly all request latency.
4. The next quality improvement should target catalog enrichment for fragrance,
   price, and texture evidence rather than prompt changes.
5. The deployed service must be updated to the latest backend commit so
   zero-candidate cases return no product recommendations instead of legacy
   free-form recommendations.
