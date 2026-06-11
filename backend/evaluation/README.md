# SkinSense Evaluation System

This package measures whether a change improves or regresses the analysis
workflow. It focuses on product grounding, user constraint compliance,
reliability, retries, and latency.

It does **not** claim to measure medical diagnosis accuracy. The current core
dataset is text-only, so multimodal face-analysis accuracy remains a separate
future benchmark requiring consented and professionally labeled images.

## Metrics

- Required JSON schema validity
- Retrieval candidate availability
- Recommendation presence
- Catalog-grounded recommendation rate
- Avoided ingredient compliance
- Fragrance-free compliance
- Budget compliance
- Texture preference match
- User concern coverage
- Case pass rate
- Average, median, and P95 end-to-end latency
- Per-node LangGraph latency
- Model retry rate and retrieval error rate

## Commands

Validate the dataset without calling any external API:

```powershell
cd backend
python -m evaluation.runner --mode validate
```

Run the real workflow:

```powershell
python -m evaluation.runner --mode live
```

Run 30 evaluations against the deployed Render backend:

```powershell
python -m evaluation.runner --mode live --runs 30 --base-url https://your-service.onrender.com
```

Live runs save `evaluation/reports/live-progress.json` after every request. If
the terminal or network is interrupted, resume without repeating completed
calls:

```powershell
python -m evaluation.runner --mode live --runs 30 --base-url https://your-service.onrender.com --resume
```

Use a small smoke run while developing:

```powershell
python -m evaluation.runner --mode live --limit 3
```

Compare a new run with an earlier JSON report:

```powershell
python -m evaluation.runner --mode live --baseline evaluation/reports/evaluation-YYYYMMDDTHHMMSSZ.json
```

The runner writes a machine-readable JSON report and a Markdown summary to
`evaluation/reports/`. Reports are ignored by Git by default because live
outputs can contain generated user-profile details. Publish only reviewed,
anonymized benchmark summaries.

GitHub Actions runs the unit tests and dataset validation on every backend push
and pull request. Live evaluation remains explicit because it uses paid model,
embedding, weather, and database services.

## Replay Format

Replay mode scores saved workflow outputs without calling external services:

```powershell
python -m evaluation.runner --mode replay --input replay.json
```

```json
{
  "runs": [
    {
      "case_id": "dry-sensitive-budget",
      "latency_ms": 1200,
      "workflow": {
        "trace_id": "example",
        "rag_candidates": [],
        "final_analysis": {},
        "validation_errors": [],
        "model_attempts": 1,
        "timing_events": []
      }
    }
  ]
}
```
