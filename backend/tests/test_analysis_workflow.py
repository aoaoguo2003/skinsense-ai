import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from services.product_rag import ProductCandidate
from workflows.skin_analysis import (
    _ephemeral_images,
    route_after_validation,
    run_analysis_workflow,
    validate_analysis,
)


def make_candidate() -> ProductCandidate:
    return ProductCandidate(
        catalog_id="catalog:1",
        source="test",
        brand="Example",
        name="Barrier Cream",
        category="Moisturizer",
        description="Barrier support",
        ingredients=["ceramide", "glycerin"],
        texture="cream",
        fragrance_free=True,
        price_min_usd=20,
        price_max_usd=20,
        price_tier="$$",
        markets=["US", "GB"],
        product_url="https://example.com/product",
        image_url=None,
    )


def make_analysis(
    catalog_id: str,
    brand: str = "Example",
    product_name: str = "Barrier Cream",
) -> dict:
    return {
        "skin_analysis": {},
        "weather_adjustment": {},
        "concern_solutions": [],
        "product_recommendations": [
            {
                "catalog_id": catalog_id,
                "brand": brand,
                "product_name": product_name,
            }
        ],
        "ingredient_conflicts": {},
        "lifestyle_tips": [],
    }


class AnalysisWorkflowTests(unittest.IsolatedAsyncioTestCase):
    def test_validation_routes_invalid_catalog_product_to_retry(self):
        _, errors = validate_analysis(
            make_analysis("invented:1", "Invented", "Magic Serum"),
            [make_candidate()],
        )

        self.assertTrue(errors)
        self.assertEqual(
            route_after_validation(
                {"validation_errors": errors, "model_attempts": 1}
            ),
            "retry",
        )
        self.assertEqual(
            route_after_validation(
                {"validation_errors": errors, "model_attempts": 2}
            ),
            "finish",
        )

    async def test_workflow_retries_only_model_after_validation_failure(self):
        weather = {
            "city": "London",
            "country": "GB",
            "temp_c": 18,
            "humidity": 60,
            "description": "cloudy",
            "uv_index": 2,
        }
        candidate = make_candidate()

        with (
            patch(
                "workflows.skin_analysis.get_weather_by_city",
                new=AsyncMock(return_value=weather),
            ) as weather_mock,
            patch(
                "workflows.skin_analysis.retrieve_product_candidates",
                new=AsyncMock(return_value=[candidate]),
            ) as retrieval_mock,
            patch(
                "workflows.skin_analysis.analyze_skin",
                new=AsyncMock(
                    side_effect=[
                        make_analysis("invented:1", "Invented", "Magic Serum"),
                        make_analysis("catalog:1"),
                    ]
                ),
            ) as model_mock,
            patch(
                "workflows.skin_analysis.rag_is_configured",
                return_value=True,
            ),
        ):
            result = await run_analysis_workflow(
                questionnaire={"budget": "$50"},
                current_products=None,
                city="London",
                latitude=None,
                longitude=None,
                image_payloads=[],
                image_labels=[],
            )

        weather_mock.assert_awaited_once()
        retrieval_mock.assert_awaited_once()
        self.assertEqual(model_mock.await_count, 2)
        self.assertEqual(result["model_attempts"], 2)
        self.assertEqual(result["validation_errors"], [])
        timing_nodes = [event["node"] for event in result["timing_events"]]
        self.assertEqual(timing_nodes.count("weather_context"), 1)
        self.assertEqual(timing_nodes.count("product_retrieval"), 1)
        self.assertEqual(timing_nodes.count("model_analysis"), 2)
        self.assertEqual(timing_nodes.count("result_validation"), 2)
        self.assertEqual(
            result["final_analysis"]["product_recommendations"][0]["catalog_id"],
            "catalog:1",
        )
        self.assertNotIn(result["trace_id"], _ephemeral_images)


class AnalysisApiTests(unittest.TestCase):
    def test_analyze_endpoint_returns_workflow_metadata(self):
        workflow_result = {
            "trace_id": "trace-test",
            "weather": None,
            "rag_candidates": [],
            "retrieval_error": None,
            "final_analysis": make_analysis(""),
            "model_attempts": 1,
            "validation_errors": [],
            "timing_events": [],
        }

        with (
            patch(
                "routers.analyze.run_analysis_workflow",
                new=AsyncMock(return_value=workflow_result),
            ),
            patch("routers.analyze.rag_is_configured", return_value=False),
        ):
            response = TestClient(app).post(
                "/api/analyze",
                data={"questionnaire": '{"budget": "$50"}'},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["trace_id"], "trace-test")
        self.assertEqual(body["workflow"]["engine"], "langgraph")
        self.assertEqual(body["workflow"]["model_attempts"], 1)
        self.assertEqual(body["workflow"]["timing_events"], [])
        self.assertEqual(
            body["retrieval"]["recommendation_evidence"],
            [],
        )


if __name__ == "__main__":
    unittest.main()
