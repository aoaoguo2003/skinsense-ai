import unittest

from services.product_rag import (
    ProductCandidate,
    build_embedding_text,
    build_retrieval_query,
    ground_recommendations,
    parse_avoided_ingredients,
    parse_budget_max_usd,
    wants_fragrance_free,
)
from services.llm_service import _build_recommendation_prompt


class ProductRagTests(unittest.TestCase):
    def test_parse_avoided_ingredients(self):
        self.assertEqual(
            parse_avoided_ingredients("Alcohol, fragrance；mineral oil"),
            ["alcohol", "fragrance", "mineral oil"],
        )
        self.assertEqual(parse_avoided_ingredients("None"), [])

    def test_parse_budget_converts_supported_currencies(self):
        self.assertAlmostEqual(parse_budget_max_usd("¥0-720 (per item)"), 100.0)
        self.assertAlmostEqual(parse_budget_max_usd("£10-20"), 25.4)
        self.assertEqual(parse_budget_max_usd("$10-$50"), 50.0)

    def test_fragrance_free_preference(self):
        self.assertTrue(wants_fragrance_free("Prefer fragrance-free"))
        self.assertFalse(wants_fragrance_free("No preference"))

    def test_embedding_text_contains_retrieval_evidence(self):
        text = build_embedding_text(
            {
                "brand": "Example",
                "name": "Barrier Cream",
                "category": "Moisturizer",
                "ingredients": ["ceramide", "glycerin"],
                "concerns": ["dryness"],
                "skin_types": ["dry"],
            }
        )
        self.assertIn("Barrier Cream", text)
        self.assertIn("ceramide", text)
        self.assertIn("dryness", text)

    def test_retrieval_query_includes_face_signals(self):
        query = build_retrieval_query(
            questionnaire={"skin_concerns": ["dryness"]},
            weather=None,
            retrieval_signals={
                "skin_type": "Combination",
                "primary_concerns": ["enlarged pores", "redness"],
                "visible_description": "oily T-zone with visible pores on the nose",
            },
        )
        self.assertIn("observed skin type: combination", query)
        self.assertIn("enlarged pores", query)
        self.assertIn("visible skin signals from facial scan:", query)

    def test_retrieval_query_without_signals_is_unchanged(self):
        query = build_retrieval_query(
            questionnaire={"skin_concerns": ["dryness"]},
            weather=None,
        )
        self.assertNotIn("visible skin signals", query)
        self.assertNotIn("observed skin type", query)

    def test_grounding_drops_hallucinated_products(self):
        candidate = ProductCandidate(
            catalog_id="catalog:1",
            source="test",
            brand="Example",
            name="Barrier Cream",
            category="Moisturizer",
            description="",
            ingredients=["ceramide"],
            texture="cream",
            fragrance_free=True,
            price_min_usd=20,
            price_max_usd=20,
            price_tier="$$",
            markets=["US"],
            product_url="https://example.com/product",
            image_url=None,
        )
        analysis = {
            "product_recommendations": [
                {
                    "catalog_id": "catalog:1",
                    "brand": "Wrong",
                    "product_name": "Wrong",
                    "why_recommended": "Fits dry skin",
                },
                {
                    "catalog_id": "invented:2",
                    "brand": "Invented",
                    "product_name": "Magic Serum",
                },
            ]
        }

        grounded = ground_recommendations(analysis, [candidate])
        self.assertEqual(len(grounded["product_recommendations"]), 1)
        recommendation = grounded["product_recommendations"][0]
        self.assertEqual(recommendation["brand"], "Example")
        self.assertEqual(recommendation["product_name"], "Barrier Cream")
        self.assertEqual(recommendation["product_url"], "https://example.com/product")

    def test_prompt_requires_catalog_grounding(self):
        prompt = _build_recommendation_prompt(
            questionnaire={"skin_concerns": ["dryness"]},
            weather=None,
            current_products=None,
            diagnosis={"skin_analysis": {"skin_type": "dry"}},
            rag_products=[
                {
                    "catalog_id": "catalog:1",
                    "brand": "Example",
                    "name": "Barrier Cream",
                }
            ],
        )
        self.assertIn("Every product recommendation MUST be selected from this catalog", prompt)
        self.assertIn('"catalog_id": "catalog:1"', prompt)


if __name__ == "__main__":
    unittest.main()
