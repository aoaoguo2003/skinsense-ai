import json
import tempfile
import unittest
from pathlib import Path

from evaluation.metrics import (
    aggregate_results,
    compare_summaries,
    score_case,
)
from evaluation.report import render_markdown
from evaluation.runner import (
    build_report,
    load_dataset,
    save_report,
    select_cases,
    score_replay,
)
from services.product_rag import ProductCandidate


def make_candidate(
    *,
    catalog_id: str = "catalog:1",
    ingredients: list[str] | None = None,
    fragrance_free: bool | None = True,
    price_min_usd: float | None = 20,
    texture: str | None = "cream",
) -> ProductCandidate:
    return ProductCandidate(
        catalog_id=catalog_id,
        source="test",
        brand="Example",
        name="Barrier Cream",
        category="Moisturizer",
        description="Barrier support",
        ingredients=ingredients or ["ceramide", "glycerin"],
        texture=texture,
        fragrance_free=fragrance_free,
        price_min_usd=price_min_usd,
        price_max_usd=price_min_usd,
        price_tier="$$",
        markets=["US", "GB"],
        product_url="https://example.com/product",
        image_url=None,
    )


def make_analysis(catalog_id: str = "catalog:1") -> dict:
    return {
        "skin_analysis": {
            "main_concerns": ["dryness", "redness"],
        },
        "weather_adjustment": {},
        "concern_solutions": [
            {"concern": "dryness"},
            {"concern": "redness"},
        ],
        "product_recommendations": [
            {
                "catalog_id": catalog_id,
                "brand": "Example",
                "product_name": "Barrier Cream",
            }
        ],
        "ingredient_conflicts": {},
        "lifestyle_tips": [],
    }


def make_case() -> dict:
    return {
        "id": "case-1",
        "description": "Constraint test",
        "questionnaire": {
            "skin_concerns": ["dryness", "redness"],
            "budget": "$0-$25",
            "preferred_texture": "cream",
            "avoid_ingredients": "fragrance, alcohol",
            "fragrance_preference": "Prefer fragrance-free",
        },
    }


class EvaluationMetricTests(unittest.TestCase):
    def test_compliant_grounded_result_passes(self):
        result = score_case(
            make_case(),
            {
                "trace_id": "trace-1",
                "final_analysis": make_analysis(),
                "rag_candidates": [make_candidate()],
                "validation_errors": [],
                "model_attempts": 1,
                "retrieval_error": None,
                "timing_events": [
                    {
                        "node": "model_analysis",
                        "duration_ms": 100,
                        "status": "ok",
                    }
                ],
            },
            latency_ms=120,
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["metrics"]["schema_valid"], 1.0)
        self.assertEqual(
            result["metrics"]["avoided_ingredient_compliance"],
            1.0,
        )
        self.assertEqual(result["metrics"]["budget_compliance"], 1.0)

    def test_constraint_violations_fail_case(self):
        result = score_case(
            make_case(),
            {
                "trace_id": "trace-2",
                "final_analysis": make_analysis(),
                "rag_candidates": [
                    make_candidate(
                        ingredients=["alcohol", "fragrance"],
                        fragrance_free=False,
                        price_min_usd=50,
                    )
                ],
                "validation_errors": [],
                "model_attempts": 1,
                "retrieval_error": None,
                "timing_events": [],
            },
            latency_ms=200,
        )

        self.assertFalse(result["success"])
        self.assertEqual(
            result["metrics"]["avoided_ingredient_compliance"],
            0.0,
        )
        self.assertEqual(result["metrics"]["fragrance_compliance"], 0.0)
        self.assertEqual(result["metrics"]["budget_compliance"], 0.0)

    def test_missing_catalog_candidates_cannot_pass(self):
        result = score_case(
            make_case(),
            {
                "trace_id": "trace-3",
                "final_analysis": make_analysis(),
                "rag_candidates": [],
                "validation_errors": [],
                "model_attempts": 1,
                "retrieval_error": None,
                "timing_events": [],
            },
            latency_ms=50,
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["metrics"]["retrieval_has_candidates"], 0.0)

    def test_aggregation_and_baseline_comparison(self):
        passing = score_case(
            make_case(),
            {
                "final_analysis": make_analysis(),
                "rag_candidates": [make_candidate()],
                "validation_errors": [],
                "model_attempts": 1,
                "timing_events": [
                    {
                        "node": "model_analysis",
                        "duration_ms": 100,
                        "status": "ok",
                    }
                ],
            },
            latency_ms=120,
        )
        failing = score_case(
            make_case(),
            None,
            latency_ms=300,
            error="timeout",
        )

        summary = aggregate_results([passing, failing])
        self.assertEqual(summary["case_pass_rate"], 0.5)
        self.assertEqual(summary["performance"]["p95_latency_ms"], 300)
        self.assertEqual(
            summary["performance"]["node_latency_ms"]["model_analysis"][
                "executions"
            ],
            1,
        )

        comparison = compare_summaries(
            summary,
            {
                "case_pass_rate": 0.25,
                "quality": {
                    "grounded_recommendation_rate": 0.5,
                    "retrieval_has_candidates": 0.5,
                    "avoided_ingredient_compliance": 0.5,
                },
                "performance": {
                    "average_latency_ms": 250,
                    "retry_rate": 0.2,
                },
            },
        )
        self.assertEqual(comparison["case_pass_rate"], 0.25)

        markdown = render_markdown(
            {
                "run_id": "run-1",
                "created_at": "2026-06-11T00:00:00+00:00",
                "mode": "replay",
                "dataset": "test",
                "summary": summary,
                "results": [passing, failing],
                "comparison": comparison,
            }
        )
        self.assertIn("## Quality", markdown)
        self.assertIn("## Node Latency", markdown)
        self.assertIn("case-1", markdown)


class EvaluationDatasetTests(unittest.TestCase):
    def test_select_cases_repeats_dataset_to_requested_run_count(self):
        dataset = {
            "cases": [
                {"id": "a", "questionnaire": {}},
                {"id": "b", "questionnaire": {}},
            ]
        }

        selected = select_cases(dataset, limit=None, runs=5)

        self.assertEqual(
            [case["id"] for case in selected],
            ["a", "b", "a", "b", "a"],
        )

    def test_dataset_requires_unique_case_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "dataset.json"
            path.write_text(
                json.dumps(
                    {
                        "cases": [
                            {"id": "duplicate", "questionnaire": {}},
                            {"id": "duplicate", "questionnaire": {}},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                load_dataset(path)

    def test_replay_can_generate_json_and_markdown_reports(self):
        case = make_case()
        candidate = make_candidate()
        replay = {
            "runs": [
                {
                    "case_id": case["id"],
                    "latency_ms": 150,
                    "workflow": {
                        "trace_id": "trace-replay",
                        "final_analysis": make_analysis(),
                        "rag_candidates": [
                            {
                                "catalog_id": candidate.catalog_id,
                                "source": candidate.source,
                                "brand": candidate.brand,
                                "name": candidate.name,
                                "category": candidate.category,
                                "description": candidate.description,
                                "ingredients": candidate.ingredients,
                                "texture": candidate.texture,
                                "fragrance_free": candidate.fragrance_free,
                                "price_min_usd": candidate.price_min_usd,
                                "price_max_usd": candidate.price_max_usd,
                                "price_tier": candidate.price_tier,
                                "markets": candidate.markets,
                                "product_url": candidate.product_url,
                                "image_url": candidate.image_url,
                                "similarity": candidate.similarity,
                            }
                        ],
                        "validation_errors": [],
                        "model_attempts": 1,
                        "retrieval_error": None,
                        "timing_events": [],
                    },
                }
            ]
        }
        dataset = {"name": "test", "version": "1", "cases": [case]}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            replay_path = root / "replay.json"
            replay_path.write_text(json.dumps(replay), encoding="utf-8")

            results = score_replay(dataset, replay_path)
            report = build_report(
                dataset=dataset,
                dataset_path=root / "dataset.json",
                mode="replay",
                results=results,
                baseline_path=None,
            )
            json_path, markdown_path = save_report(report, root / "reports")

            self.assertTrue(results[0]["success"])
            self.assertTrue(json_path.exists())
            self.assertTrue(markdown_path.exists())
            self.assertIn(
                "SkinSense Evaluation Report",
                markdown_path.read_text(encoding="utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
