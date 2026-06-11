# Live Evaluation Baseline - 2026-06-11

This reviewed summary records the first 30-run evaluation against the deployed
Render service. Raw model outputs remain local and are not committed.

## Scope

- 30 sequential remote executions
- 12 versioned text-only constraint cases, repeated in dataset order
- Deployed FastAPI + LangGraph workflow
- Open Beauty Facts catalog with 300 embedded products
- OpenAI `text-embedding-3-small`
- Claude multimodal analysis node, without images for this benchmark

## Observed Results

| Observation | Result |
| --- | ---: |
| Attempted requests | 30 |
| Completed workflows | 7 |
| Cases passing the available remote checks | 3 |
| Upstream HTTP 500 responses | 23 |
| Average retrieval-node latency on completed workflows | 747 ms |
| Average model-node latency on completed workflows | 95.7 s |
| P95 model-node latency on completed workflows | 107.4 s |
| Completed cases with catalog candidates | 3 / 7 |

The legacy deployed response did not include recommendation evidence, so
ingredient, fragrance, price, and texture compliance could not be measured
reliably and were recorded as unavailable rather than inferred.

## Findings

1. The model call, not vector retrieval, is the dominant latency bottleneck.
2. Strict fragrance and avoided-ingredient filters frequently return no
   products because Open Beauty Facts has sparse fragrance and price metadata.
3. The deployed version allowed free-form recommendations when retrieval
   returned no candidates. Some recommendations therefore had empty catalog IDs.
4. After seven completed workflows, the remaining requests returned HTTP 500.
   The project owner then received an Anthropic billing notification confirming
   that the Claude API balance had been exhausted.
5. The original aggregate pass rate is not suitable as a product-quality claim:
   most runs failed at infrastructure/provider level, and several constraint
   metrics were unavailable in the legacy response.

## Changes Triggered by the Benchmark

- RAG-enabled analyses now force an empty recommendation list when no catalog
  product satisfies the constraints, preventing ungrounded product invention.
- Upstream workflow failures now return HTTP 503 with a safe error code and
  exception type instead of an opaque HTTP 500.
- Remote evaluation captures safe API error details for provider-level
  attribution.
- The deployed response includes canonical recommendation evidence so future
  runs can measure ingredient, fragrance, budget, and texture compliance.
- Catalog bootstrap now retries failed imports and exposes status through the
  health endpoint.

## Next Baseline Goal

After the latest backend version is live and Claude billing is restored (or the
configured LLM provider is switched), rerun the same 30 samples. The next run should separately
report workflow availability, retrieval coverage, grounded recommendation
quality, constraint compliance, and latency instead of collapsing provider
failures into a single pass rate.
