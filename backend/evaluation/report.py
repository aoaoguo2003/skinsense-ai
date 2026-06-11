from typing import Any


def _percent(value: Any) -> str:
    return "N/A" if value is None else f"{float(value) * 100:.1f}%"


def _number(value: Any, suffix: str = "") -> str:
    return "N/A" if value is None else f"{float(value):.2f}{suffix}"


def render_markdown(report: dict[str, Any]) -> str:
    summary = report["summary"]
    quality = summary["quality"]
    performance = summary["performance"]
    lines = [
        "# SkinSense Evaluation Report",
        "",
        f"- Run ID: `{report['run_id']}`",
        f"- Created: `{report['created_at']}`",
        f"- Mode: `{report['mode']}`",
        f"- Dataset: `{report['dataset']}`",
        f"- Cases: **{summary['passed_case_count']} / {summary['case_count']} passed**",
        "",
        "## Quality",
        "",
        "| Metric | Result |",
        "| --- | ---: |",
        f"| Case pass rate | {_percent(summary['case_pass_rate'])} |",
        f"| Schema valid rate | {_percent(quality['schema_valid'])} |",
        f"| Retrieval produced candidates | {_percent(quality['retrieval_has_candidates'])} |",
        f"| Recommendation present | {_percent(quality['recommendation_present'])} |",
        f"| Catalog grounding rate | {_percent(quality['grounded_recommendation_rate'])} |",
        f"| Avoided ingredient compliance | {_percent(quality['avoided_ingredient_compliance'])} |",
        f"| Fragrance compliance | {_percent(quality['fragrance_compliance'])} |",
        f"| Budget compliance | {_percent(quality['budget_compliance'])} |",
        f"| Texture preference match | {_percent(quality['texture_preference_match'])} |",
        f"| Concern coverage | {_percent(quality['concern_coverage'])} |",
        "",
        "## Performance",
        "",
        "| Metric | Result |",
        "| --- | ---: |",
        f"| Average latency | {_number(performance['average_latency_ms'], ' ms')} |",
        f"| Median latency | {_number(performance['median_latency_ms'], ' ms')} |",
        f"| P95 latency | {_number(performance['p95_latency_ms'], ' ms')} |",
        f"| Average model attempts | {_number(performance['average_model_attempts'])} |",
        f"| Retry rate | {_percent(performance['retry_rate'])} |",
        f"| Retrieval error rate | {_percent(performance['retrieval_error_rate'])} |",
        "",
        "## Node Latency",
        "",
        "| Node | Average | P95 | Executions |",
        "| --- | ---: | ---: | ---: |",
    ]
    for node, metrics in performance["node_latency_ms"].items():
        lines.append(
            f"| `{node}` | {_number(metrics['average'], ' ms')} | "
            f"{_number(metrics['p95'], ' ms')} | {metrics['executions']} |"
        )

    comparison = report.get("comparison")
    if comparison:
        lines.extend(
            [
                "",
                "## Baseline Delta",
                "",
                "Positive quality deltas are improvements. Negative latency and retry deltas are improvements.",
                "",
                "| Metric | Delta |",
                "| --- | ---: |",
            ]
        )
        for name, delta in comparison.items():
            lines.append(
                f"| `{name}` | {'N/A' if delta is None else f'{delta:+.4f}'} |"
            )

    failed = [result for result in report["results"] if not result["success"]]
    lines.extend(["", "## Failed Cases", ""])
    if not failed:
        lines.append("No failed cases.")
    else:
        for result in failed:
            details = result.get("error") or ", ".join(
                result.get("workflow", {}).get("validation_errors", [])
            )
            lines.append(f"- `{result['case_id']}`: {details or 'Constraint check failed'}")

    lines.extend(
        [
            "",
            "## Interpretation",
            "",
            "This benchmark measures engineering constraints and workflow performance. "
            "It is not a medical accuracy study and does not replace dermatologist review.",
            "",
        ]
    )
    return "\n".join(lines)
