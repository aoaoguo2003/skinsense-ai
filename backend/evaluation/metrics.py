import json
import math
from statistics import mean, median
from typing import Any, Optional

from services.product_rag import (
    ProductCandidate,
    parse_avoided_ingredients,
    parse_budget_max_usd,
    wants_fragrance_free,
)
from workflows.skin_analysis import REQUIRED_ANALYSIS_SECTIONS


def _rate(values: list[Optional[float]]) -> Optional[float]:
    measured = [value for value in values if value is not None]
    return round(mean(measured), 4) if measured else None


def _percentile(values: list[float], percentile: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return round(ordered[index], 2)


def _candidate_map(workflow: dict[str, Any]) -> dict[str, ProductCandidate]:
    return {
        candidate.catalog_id: candidate
        for candidate in workflow.get("rag_candidates", [])
        if isinstance(candidate, ProductCandidate)
    }


def _recommendations(workflow: dict[str, Any]) -> list[dict[str, Any]]:
    analysis = workflow.get("final_analysis") or {}
    recommendations = analysis.get("product_recommendations", [])
    return recommendations if isinstance(recommendations, list) else []


def _schema_valid(analysis: Any) -> bool:
    return bool(
        isinstance(analysis, dict)
        and all(section in analysis for section in REQUIRED_ANALYSIS_SECTIONS)
        and isinstance(analysis.get("product_recommendations"), list)
    )


def _constraint_rate(
    recommendations: list[dict[str, Any]],
    candidates: dict[str, ProductCandidate],
    predicate,
) -> Optional[float]:
    if not recommendations:
        return 0.0 if candidates else None
    checks = []
    for recommendation in recommendations:
        candidate = candidates.get(str(recommendation.get("catalog_id") or ""))
        checks.append(bool(candidate and predicate(candidate)))
    return round(mean(checks), 4)


def score_case(
    case: dict[str, Any],
    workflow: Optional[dict[str, Any]],
    *,
    latency_ms: float,
    error: Optional[str] = None,
) -> dict[str, Any]:
    if workflow is None:
        return {
            "case_id": case["id"],
            "description": case.get("description", ""),
            "success": False,
            "error": error or "Unknown workflow error",
            "latency_ms": round(latency_ms, 2),
            "metrics": {
                "schema_valid": 0.0,
                "retrieval_has_candidates": 0.0,
                "recommendation_present": 0.0,
                "grounded_recommendation_rate": None,
                "avoided_ingredient_compliance": None,
                "fragrance_compliance": None,
                "budget_compliance": None,
                "texture_preference_match": None,
                "concern_coverage": 0.0,
            },
            "workflow": {},
        }

    questionnaire = case.get("questionnaire", {})
    analysis = workflow.get("final_analysis") or {}
    recommendations = _recommendations(workflow)
    candidates = _candidate_map(workflow)
    remote_candidate_count = workflow.get("remote_candidate_count")
    remote_grounded_count = workflow.get("remote_grounded_count")
    avoided = parse_avoided_ingredients(questionnaire.get("avoid_ingredients"))
    budget_max = parse_budget_max_usd(questionnaire.get("budget"))
    fragrance_free = wants_fragrance_free(
        questionnaire.get("fragrance_preference")
    )
    preferred_texture = str(
        questionnaire.get("preferred_texture") or ""
    ).strip().lower()

    if candidates:
        grounded_rate = _constraint_rate(
            recommendations,
            candidates,
            lambda _candidate: True,
        )
    elif remote_grounded_count is not None and recommendations:
        grounded_rate = round(
            min(int(remote_grounded_count), len(recommendations))
            / len(recommendations),
            4,
        )
    else:
        grounded_rate = None
    avoided_rate = (
        _constraint_rate(
            recommendations,
            candidates,
            lambda candidate: not any(
                term in " ".join(candidate.ingredients).lower()
                for term in avoided
            ),
        )
        if avoided and candidates
        else None
    )
    fragrance_rate = (
        _constraint_rate(
            recommendations,
            candidates,
            lambda candidate: candidate.fragrance_free is True,
        )
        if fragrance_free and candidates
        else None
    )
    budget_rate = (
        _constraint_rate(
            recommendations,
            candidates,
            lambda candidate: (
                candidate.price_min_usd is not None
                and candidate.price_min_usd <= budget_max
            ),
        )
        if budget_max is not None and candidates
        else None
    )
    texture_rate = (
        _constraint_rate(
            recommendations,
            candidates,
            lambda candidate: bool(
                candidate.texture
                and preferred_texture in candidate.texture.lower()
            ),
        )
        if (
            preferred_texture
            and preferred_texture != "no preference"
            and candidates
        )
        else None
    )

    concerns = questionnaire.get("skin_concerns") or []
    if isinstance(concerns, str):
        concerns = [concerns]
    normalized_concerns = [
        str(concern).strip().lower()
        for concern in concerns
        if str(concern).strip()
    ]
    analysis_text = json.dumps(analysis, ensure_ascii=False).lower()
    concern_coverage = (
        round(
            mean(
                concern in analysis_text
                for concern in normalized_concerns
            ),
            4,
        )
        if normalized_concerns
        else None
    )

    metrics = {
        "schema_valid": float(_schema_valid(analysis)),
        "retrieval_has_candidates": float(
            bool(candidates)
            or (
                remote_candidate_count is not None
                and int(remote_candidate_count) > 0
            )
        ),
        "recommendation_present": float(bool(recommendations)),
        "grounded_recommendation_rate": grounded_rate,
        "avoided_ingredient_compliance": avoided_rate,
        "fragrance_compliance": fragrance_rate,
        "budget_compliance": budget_rate,
        "texture_preference_match": texture_rate,
        "concern_coverage": concern_coverage,
    }
    required_checks = [
        metrics["schema_valid"],
        metrics["retrieval_has_candidates"],
        metrics["recommendation_present"],
        metrics["grounded_recommendation_rate"],
        metrics["avoided_ingredient_compliance"],
        metrics["fragrance_compliance"],
        metrics["budget_compliance"],
    ]
    measured_required_checks = [
        value for value in required_checks if value is not None
    ]
    success = bool(
        not error
        and not workflow.get("validation_errors")
        and measured_required_checks
        and all(value == 1.0 for value in measured_required_checks)
    )

    timing_events = workflow.get("timing_events", [])
    return {
        "case_id": case["id"],
        "description": case.get("description", ""),
        "success": success,
        "error": error,
        "latency_ms": round(latency_ms, 2),
        "metrics": metrics,
        "workflow": {
            "trace_id": workflow.get("trace_id"),
            "model_attempts": workflow.get("model_attempts", 0),
            "retrieval_error": workflow.get("retrieval_error"),
            "candidate_count": (
                len(candidates)
                if candidates
                else int(remote_candidate_count or 0)
            ),
            "recommendation_count": len(recommendations),
            "validation_errors": workflow.get("validation_errors", []),
            "timing_events": timing_events,
        },
    }


def aggregate_results(results: list[dict[str, Any]]) -> dict[str, Any]:
    latencies = [float(result["latency_ms"]) for result in results]
    successful = [result for result in results if result["success"]]
    attempts = [
        int(result.get("workflow", {}).get("model_attempts", 0))
        for result in results
        if result.get("workflow")
    ]
    node_durations: dict[str, list[float]] = {}
    for result in results:
        for event in result.get("workflow", {}).get("timing_events", []):
            node_durations.setdefault(event["node"], []).append(
                float(event["duration_ms"])
            )

    metric_names = (
        "schema_valid",
        "retrieval_has_candidates",
        "recommendation_present",
        "grounded_recommendation_rate",
        "avoided_ingredient_compliance",
        "fragrance_compliance",
        "budget_compliance",
        "texture_preference_match",
        "concern_coverage",
    )
    quality = {
        name: _rate(
            [result.get("metrics", {}).get(name) for result in results]
        )
        for name in metric_names
    }
    performance = {
        "average_latency_ms": round(mean(latencies), 2) if latencies else None,
        "median_latency_ms": round(median(latencies), 2) if latencies else None,
        "p95_latency_ms": _percentile(latencies, 0.95),
        "average_model_attempts": round(mean(attempts), 2) if attempts else None,
        "retry_rate": (
            round(mean(attempt > 1 for attempt in attempts), 4)
            if attempts
            else None
        ),
        "retrieval_error_rate": (
            round(
                mean(
                    bool(result.get("workflow", {}).get("retrieval_error"))
                    for result in results
                ),
                4,
            )
            if results
            else None
        ),
        "node_latency_ms": {
            node: {
                "average": round(mean(durations), 2),
                "p95": _percentile(durations, 0.95),
                "executions": len(durations),
            }
            for node, durations in sorted(node_durations.items())
        },
    }
    return {
        "case_count": len(results),
        "passed_case_count": len(successful),
        "case_pass_rate": (
            round(len(successful) / len(results), 4) if results else None
        ),
        "quality": quality,
        "performance": performance,
    }


def compare_summaries(
    current: dict[str, Any],
    baseline: dict[str, Any],
) -> dict[str, Optional[float]]:
    pairs = {
        "case_pass_rate": (
            current.get("case_pass_rate"),
            baseline.get("case_pass_rate"),
        ),
        "grounded_recommendation_rate": (
            current.get("quality", {}).get("grounded_recommendation_rate"),
            baseline.get("quality", {}).get("grounded_recommendation_rate"),
        ),
        "retrieval_has_candidates": (
            current.get("quality", {}).get("retrieval_has_candidates"),
            baseline.get("quality", {}).get("retrieval_has_candidates"),
        ),
        "avoided_ingredient_compliance": (
            current.get("quality", {}).get("avoided_ingredient_compliance"),
            baseline.get("quality", {}).get("avoided_ingredient_compliance"),
        ),
        "average_latency_ms": (
            current.get("performance", {}).get("average_latency_ms"),
            baseline.get("performance", {}).get("average_latency_ms"),
        ),
        "retry_rate": (
            current.get("performance", {}).get("retry_rate"),
            baseline.get("performance", {}).get("retry_rate"),
        ),
    }
    return {
        name: (
            round(float(current_value) - float(baseline_value), 4)
            if current_value is not None and baseline_value is not None
            else None
        )
        for name, (current_value, baseline_value) in pairs.items()
    }
