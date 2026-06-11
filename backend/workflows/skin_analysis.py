import copy
import logging
from typing import Any, Literal, Optional, TypedDict
from uuid import uuid4

from langchain_core.runnables import RunnableConfig, RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy

from services.llm_service import analyze_skin
from services.product_rag import (
    ProductCandidate,
    ground_recommendations,
    rag_is_configured,
    retrieve_product_candidates,
)
from services.weather_service import get_weather_by_city, get_weather_by_coords

logger = logging.getLogger(__name__)

MAX_MODEL_ATTEMPTS = 2
REQUIRED_ANALYSIS_SECTIONS = (
    "skin_analysis",
    "weather_adjustment",
    "concern_solutions",
    "product_recommendations",
    "ingredient_conflicts",
    "lifestyle_tips",
)


class AnalysisState(TypedDict, total=False):
    trace_id: str
    questionnaire: dict[str, Any]
    current_products: Optional[list[str]]
    city: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    image_labels: list[str]
    image_count: int
    weather: Optional[dict[str, Any]]
    rag_candidates: list[ProductCandidate]
    retrieval_error: Optional[str]
    analysis_draft: dict[str, Any]
    final_analysis: dict[str, Any]
    validation_errors: list[str]
    model_attempts: int


# Raw biometric images deliberately stay outside graph state so optional
# LangSmith traces contain workflow metadata, not face image bytes.
_ephemeral_images: dict[str, list[tuple[bytes, str]]] = {}


async def fetch_weather_node(state: AnalysisState) -> dict[str, Any]:
    weather = None
    latitude = state.get("latitude")
    longitude = state.get("longitude")
    if latitude is not None and longitude is not None:
        weather = await get_weather_by_coords(latitude, longitude)
    elif state.get("city"):
        weather = await get_weather_by_city(state["city"])
    return {"weather": weather}


async def retrieve_products_node(state: AnalysisState) -> dict[str, Any]:
    if not rag_is_configured():
        return {"rag_candidates": [], "retrieval_error": None}

    try:
        candidates = await retrieve_product_candidates(
            state["questionnaire"],
            state.get("weather"),
        )
        return {"rag_candidates": candidates, "retrieval_error": None}
    except Exception as exc:
        logger.exception(
            "Product RAG retrieval failed for trace %s; continuing without grounding",
            state["trace_id"],
        )
        return {
            "rag_candidates": [],
            "retrieval_error": type(exc).__name__,
        }


async def _invoke_multimodal_model(state: AnalysisState) -> dict[str, Any]:
    image_payloads = _ephemeral_images.get(state["trace_id"], [])
    candidates = state.get("rag_candidates", [])
    draft = await analyze_skin(
        questionnaire=state["questionnaire"],
        weather=state.get("weather"),
        current_products=state.get("current_products"),
        image_bytes=image_payloads[0][0] if image_payloads else None,
        image_media_type=image_payloads[0][1] if image_payloads else None,
        image_payloads=image_payloads,
        image_labels=state.get("image_labels"),
        rag_products=[candidate.to_prompt_dict() for candidate in candidates],
        validation_feedback=state.get("validation_errors") or None,
    )
    return {
        "analysis_draft": draft,
        "model_attempts": state.get("model_attempts", 0) + 1,
    }


model_runnable = RunnableLambda(_invoke_multimodal_model).with_config(
    {"run_name": "multimodal_skin_analysis"}
)


async def analyze_node(
    state: AnalysisState,
    config: RunnableConfig,
) -> dict[str, Any]:
    return await model_runnable.ainvoke(state, config=config)


def validate_analysis(
    draft: Any,
    candidates: list[ProductCandidate],
) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(draft, dict):
        return {}, ["The model response must be a JSON object."]

    errors = [
        f"Missing required section: {section}."
        for section in REQUIRED_ANALYSIS_SECTIONS
        if section not in draft
    ]

    raw_recommendations = draft.get("product_recommendations", [])
    if not isinstance(raw_recommendations, list):
        errors.append("product_recommendations must be a JSON list.")
        raw_recommendations = []

    grounded = ground_recommendations(copy.deepcopy(draft), candidates)
    grounded_recommendations = grounded.get("product_recommendations", [])

    if candidates and len(grounded_recommendations) < len(raw_recommendations):
        errors.append(
            "One or more recommendations were not selected from the retrieved catalog."
        )
    if candidates and not grounded_recommendations:
        errors.append(
            "Return at least one suitable recommendation from the retrieved catalog."
        )

    return grounded, errors


async def validate_node(state: AnalysisState) -> dict[str, Any]:
    final_analysis, errors = validate_analysis(
        state.get("analysis_draft"),
        state.get("rag_candidates", []),
    )
    return {
        "final_analysis": final_analysis,
        "validation_errors": errors,
    }


def route_after_validation(state: AnalysisState) -> Literal["retry", "finish"]:
    if (
        state.get("validation_errors")
        and state.get("model_attempts", 0) < MAX_MODEL_ATTEMPTS
    ):
        return "retry"
    return "finish"


def build_analysis_graph():
    builder = StateGraph(AnalysisState)
    builder.add_node("weather_context", fetch_weather_node)
    builder.add_node("product_retrieval", retrieve_products_node)
    builder.add_node(
        "model_analysis",
        analyze_node,
        retry_policy=RetryPolicy(max_attempts=2),
    )
    builder.add_node("result_validation", validate_node)

    builder.add_edge(START, "weather_context")
    builder.add_edge("weather_context", "product_retrieval")
    builder.add_edge("product_retrieval", "model_analysis")
    builder.add_edge("model_analysis", "result_validation")
    builder.add_conditional_edges(
        "result_validation",
        route_after_validation,
        {
            "retry": "model_analysis",
            "finish": END,
        },
    )
    return builder.compile()


analysis_graph = build_analysis_graph()


async def run_analysis_workflow(
    *,
    questionnaire: dict[str, Any],
    current_products: Optional[list[str]],
    city: Optional[str],
    latitude: Optional[float],
    longitude: Optional[float],
    image_payloads: list[tuple[bytes, str]],
    image_labels: Optional[list[str]],
) -> AnalysisState:
    trace_id = str(uuid4())
    _ephemeral_images[trace_id] = image_payloads
    try:
        return await analysis_graph.ainvoke(
            {
                "trace_id": trace_id,
                "questionnaire": questionnaire,
                "current_products": current_products,
                "city": city,
                "latitude": latitude,
                "longitude": longitude,
                "image_labels": image_labels or [],
                "image_count": len(image_payloads),
                "rag_candidates": [],
                "validation_errors": [],
                "model_attempts": 0,
            },
            config={
                "run_name": "skinsense_analysis_workflow",
                "tags": ["skinsense", "analysis"],
                "metadata": {
                    "trace_id": trace_id,
                    "image_count": len(image_payloads),
                    "rag_enabled": rag_is_configured(),
                },
            },
        )
    finally:
        _ephemeral_images.pop(trace_id, None)
