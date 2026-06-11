import argparse
import asyncio
import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, Optional
from uuid import uuid4

import httpx
from dotenv import load_dotenv

from evaluation.metrics import (
    aggregate_results,
    compare_summaries,
    score_case,
)
from evaluation.report import render_markdown
from services.product_rag import ProductCandidate
from workflows.skin_analysis import run_analysis_workflow

BACKEND_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATASET = BACKEND_DIR / "evaluation" / "datasets" / "core_cases.json"
DEFAULT_OUTPUT_DIR = BACKEND_DIR / "evaluation" / "reports"


def load_dataset(path: Path) -> dict[str, Any]:
    dataset = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(dataset.get("cases"), list) or not dataset["cases"]:
        raise ValueError("Evaluation dataset must contain a non-empty cases list")
    seen = set()
    for case in dataset["cases"]:
        case_id = case.get("id")
        if not case_id or case_id in seen:
            raise ValueError("Every evaluation case must have a unique id")
        if not isinstance(case.get("questionnaire"), dict):
            raise ValueError(f"Case {case_id} must contain a questionnaire object")
        seen.add(case_id)
    return dataset


def _serialize_workflow(workflow: dict[str, Any]) -> dict[str, Any]:
    serialized = dict(workflow)
    serialized["rag_candidates"] = [
        asdict(candidate) if isinstance(candidate, ProductCandidate) else candidate
        for candidate in workflow.get("rag_candidates", [])
    ]
    return serialized


async def run_live_case(case: dict[str, Any]) -> tuple[Optional[dict[str, Any]], float, Optional[str]]:
    started_at = perf_counter()
    try:
        location = case.get("location", {})
        workflow = await run_analysis_workflow(
            questionnaire=case["questionnaire"],
            current_products=case.get("current_products"),
            city=location.get("city"),
            latitude=location.get("latitude"),
            longitude=location.get("longitude"),
            image_payloads=[],
            image_labels=[],
        )
        return workflow, (perf_counter() - started_at) * 1000, None
    except Exception as exc:
        return None, (perf_counter() - started_at) * 1000, (
            f"{type(exc).__name__}: {exc}"
        )


async def run_remote_case(
    client: httpx.AsyncClient,
    base_url: str,
    case: dict[str, Any],
) -> tuple[Optional[dict[str, Any]], float, Optional[str]]:
    started_at = perf_counter()
    location = case.get("location", {})
    form_data = {
        "questionnaire": json.dumps(case["questionnaire"]),
    }
    if case.get("current_products"):
        form_data["current_products"] = json.dumps(case["current_products"])
    for key in ("city", "latitude", "longitude"):
        value = location.get(key)
        if value is not None:
            form_data[key] = str(value)

    try:
        response = await client.post(
            f"{base_url.rstrip('/')}/api/analyze",
            data=form_data,
        )
        if not response.is_success:
            detail = response.text[:500]
            raise RuntimeError(
                f"Remote API returned {response.status_code}: {detail}"
            )
        payload = response.json()
        retrieval = payload.get("retrieval", {})
        workflow_metadata = payload.get("workflow", {})
        workflow = {
            "trace_id": payload.get("trace_id"),
            "weather": payload.get("weather"),
            "final_analysis": payload.get("analysis") or {},
            "rag_candidates": [
                ProductCandidate(**candidate)
                for candidate in retrieval.get("recommendation_evidence", [])
            ],
            "remote_candidate_count": retrieval.get("candidate_count"),
            "remote_grounded_count": retrieval.get(
                "grounded_recommendation_count"
            ),
            "retrieval_error": retrieval.get("error"),
            "validation_errors": workflow_metadata.get(
                "validation_errors",
                [],
            ),
            "model_attempts": workflow_metadata.get("model_attempts", 0),
            "timing_events": workflow_metadata.get("timing_events", []),
        }
        return workflow, (perf_counter() - started_at) * 1000, None
    except Exception as exc:
        return None, (perf_counter() - started_at) * 1000, (
            f"{type(exc).__name__}: {exc}"
        )


def select_cases(
    dataset: dict[str, Any],
    *,
    limit: Optional[int],
    runs: Optional[int],
) -> list[dict[str, Any]]:
    cases = dataset["cases"][:limit] if limit else dataset["cases"]
    if not runs:
        return cases
    return [cases[index % len(cases)] for index in range(runs)]


async def run_live_dataset(
    dataset: dict[str, Any],
    *,
    limit: Optional[int],
    runs: Optional[int],
    base_url: Optional[str],
) -> list[dict[str, Any]]:
    cases = select_cases(dataset, limit=limit, runs=runs)
    results = []
    async with httpx.AsyncClient(timeout=300) as client:
        for index, case in enumerate(cases, start=1):
            print(
                f"[{index}/{len(cases)}] Evaluating {case['id']}...",
                flush=True,
            )
            if base_url:
                workflow, latency_ms, error = await run_remote_case(
                    client,
                    base_url,
                    case,
                )
            else:
                workflow, latency_ms, error = await run_live_case(case)
            result = score_case(
                case,
                workflow,
                latency_ms=latency_ms,
                error=error,
            )
            result["sample_index"] = index
            if workflow is not None:
                result["raw_workflow"] = _serialize_workflow(workflow)
            results.append(result)
    return results


def score_replay(
    dataset: dict[str, Any],
    replay_path: Path,
) -> list[dict[str, Any]]:
    replay = json.loads(replay_path.read_text(encoding="utf-8"))
    if "runs" in replay:
        replay_items = replay["runs"]
    elif "results" in replay:
        replay_items = [
            {
                "case_id": item["case_id"],
                "latency_ms": item.get("latency_ms", 0),
                "workflow": item.get("raw_workflow"),
                "error": item.get("error"),
            }
            for item in replay["results"]
            if item.get("raw_workflow")
        ]
    else:
        raise ValueError("Replay file must contain runs or evaluation results")
    by_case = {item["case_id"]: item for item in replay_items}
    results = []
    for case in dataset["cases"]:
        item = by_case.get(case["id"])
        if item is None:
            results.append(
                score_case(
                    case,
                    None,
                    latency_ms=0,
                    error="Case missing from replay file",
                )
            )
            continue
        workflow = dict(item["workflow"])
        workflow["rag_candidates"] = [
            ProductCandidate(**candidate)
            for candidate in workflow.get("rag_candidates", [])
        ]
        results.append(
            score_case(
                case,
                workflow,
                latency_ms=float(item.get("latency_ms", 0)),
                error=item.get("error"),
            )
        )
    return results


def build_report(
    *,
    dataset: dict[str, Any],
    dataset_path: Path,
    mode: str,
    results: list[dict[str, Any]],
    baseline_path: Optional[Path],
) -> dict[str, Any]:
    summary = aggregate_results(results)
    report = {
        "run_id": str(uuid4()),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "dataset": dataset.get("name") or dataset_path.name,
        "dataset_version": dataset.get("version"),
        "summary": summary,
        "results": results,
    }
    if baseline_path:
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        report["baseline_run_id"] = baseline.get("run_id")
        report["comparison"] = compare_summaries(
            summary,
            baseline["summary"],
        )
    return report


def save_report(report: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    json_path = output_dir / f"evaluation-{stamp}.json"
    markdown_path = output_dir / f"evaluation-{stamp}.md"
    json_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    markdown_path.write_text(render_markdown(report), encoding="utf-8")
    return json_path, markdown_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the SkinSense quality and performance benchmark."
    )
    parser.add_argument(
        "--mode",
        choices=("validate", "live", "replay"),
        default="validate",
        help=(
            "validate checks the dataset without API calls; live runs the real "
            "workflow; replay scores previously captured workflow outputs."
        ),
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--input", type=Path, help="Replay JSON file")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--runs",
        type=int,
        help="Total live executions. Cases repeat in dataset order.",
    )
    parser.add_argument(
        "--base-url",
        help="Evaluate a deployed SkinSense backend instead of local services.",
    )
    return parser.parse_args()


async def async_main() -> int:
    args = parse_args()
    load_dotenv(BACKEND_DIR / ".env")
    dataset = load_dataset(args.dataset)

    if args.mode == "validate":
        print(
            f"Dataset '{dataset.get('name', args.dataset.name)}' is valid "
            f"with {len(dataset['cases'])} cases. No APIs were called."
        )
        return 0
    if args.mode == "replay":
        if not args.input:
            raise ValueError("--input is required in replay mode")
        results = score_replay(dataset, args.input)
    else:
        results = await run_live_dataset(
            dataset,
            limit=args.limit,
            runs=args.runs,
            base_url=args.base_url,
        )

    report = build_report(
        dataset=dataset,
        dataset_path=args.dataset,
        mode=args.mode,
        results=results,
        baseline_path=args.baseline,
    )
    json_path, markdown_path = save_report(report, args.output_dir)
    print(
        f"Pass rate: {report['summary']['case_pass_rate']}\n"
        f"JSON report: {json_path}\n"
        f"Markdown report: {markdown_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(async_main()))
