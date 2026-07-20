import copy
import logging
import operator
from time import perf_counter
from typing import Annotated, Any, Literal, Optional, TypedDict
from uuid import uuid4

from langchain_core.runnables import RunnableConfig, RunnableLambda
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy

from services.llm_service import diagnose_skin, recommend_products
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
    skin_diagnosis: dict[str, Any]
    retrieval_signals: dict[str, Any]
    rag_candidates: list[ProductCandidate]
    rag_grounding_enabled: bool
    retrieval_error: Optional[str]
    recommendation_draft: dict[str, Any]
    final_analysis: dict[str, Any]
    validation_errors: list[str]
    model_attempts: int
    timing_events: Annotated[list[dict[str, Any]], operator.add]


# Raw biometric images deliberately stay outside graph state so optional
# LangSmith traces contain workflow metadata, not face image bytes.
_ephemeral_images: dict[str, list[tuple[bytes, str]]] = {}


async def fetch_weather_node(state: AnalysisState) -> dict[str, Any]:
    started_at = perf_counter()
    weather = None
    latitude = state.get("latitude")
    longitude = state.get("longitude")
    if latitude is not None and longitude is not None:
        weather = await get_weather_by_coords(latitude, longitude)
    elif state.get("city"):
        weather = await get_weather_by_city(state["city"])
    return {
        "weather": weather,
        "timing_events": [_timing_event("weather_context", started_at)],
    }


async def retrieve_products_node(state: AnalysisState) -> dict[str, Any]:
    started_at = perf_counter()
    if not rag_is_configured():
        return {
            "rag_candidates": [],
            "rag_grounding_enabled": False,
            "retrieval_error": None,
            "timing_events": [
                _timing_event("product_retrieval", started_at, status="skipped")
            ],
        }

    try:
        candidates = await retrieve_product_candidates(
            state["questionnaire"],
            state.get("weather"),
            retrieval_signals=state.get("retrieval_signals"),
        )
        return {
            "rag_candidates": candidates,
            "rag_grounding_enabled": True,
            "retrieval_error": None,
            "timing_events": [_timing_event("product_retrieval", started_at)],
        }
    except Exception as exc:
        logger.exception(
            "Product RAG retrieval failed for trace %s; continuing without grounding",
            state["trace_id"],
        )
        return {
            "rag_candidates": [],
            "rag_grounding_enabled": True,
            "retrieval_error": type(exc).__name__,
            "timing_events": [
                _timing_event(
                    "product_retrieval",
                    started_at,
                    status="degraded",
                    detail=type(exc).__name__,
                )
            ],
        }


async def _invoke_diagnosis(state: AnalysisState) -> dict[str, Any]:
    started_at = perf_counter()
    image_payloads = _ephemeral_images.get(state["trace_id"], [])
    diagnosis = await diagnose_skin(
        questionnaire=state["questionnaire"],
        weather=state.get("weather"),
        image_payloads=image_payloads,
        image_labels=state.get("image_labels"),
    )
    if not isinstance(diagnosis, dict):
        diagnosis = {}
    retrieval_signals = diagnosis.pop("retrieval_signals", None)
    if not isinstance(retrieval_signals, dict):
        retrieval_signals = {}
    return {
        "skin_diagnosis": diagnosis,
        "retrieval_signals": retrieval_signals,
        "timing_events": [_timing_event("skin_diagnosis", started_at)],
    }


async def _invoke_recommendation(state: AnalysisState) -> dict[str, Any]:
    started_at = perf_counter()
    candidates = state.get("rag_candidates", [])
    draft = await recommend_products(
        questionnaire=state["questionnaire"],
        weather=state.get("weather"),
        current_products=state.get("current_products"),
        diagnosis=state.get("skin_diagnosis") or {},
        rag_products=[candidate.to_prompt_dict() for candidate in candidates],
        validation_feedback=state.get("validation_errors") or None,
    )
    return {
        "recommendation_draft": draft,
        "model_attempts": state.get("model_attempts", 0) + 1,
        "timing_events": [
            _timing_event(
                "recommendation",
                started_at,
                attempt=state.get("model_attempts", 0) + 1,
            )
        ],
    }


diagnosis_runnable = RunnableLambda(_invoke_diagnosis).with_config(
    {"run_name": "multimodal_skin_diagnosis"}
)
recommendation_runnable = RunnableLambda(_invoke_recommendation).with_config(
    {"run_name": "product_recommendation"}
)


async def diagnosis_node(
    state: AnalysisState,
    config: RunnableConfig,
) -> dict[str, Any]:
    return await diagnosis_runnable.ainvoke(state, config=config)


async def recommendation_node(
    state: AnalysisState,
    config: RunnableConfig,
) -> dict[str, Any]:
    return await recommendation_runnable.ainvoke(state, config=config)


def validate_analysis(
    draft: Any,
    candidates: list[ProductCandidate],
    *,
    grounding_required: bool = False,
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

    if grounding_required and not candidates:
        grounded = copy.deepcopy(draft)
        grounded["product_recommendations"] = []
        return grounded, errors

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
    started_at = perf_counter()
    merged_draft = {
        **(state.get("skin_diagnosis") or {}),
        **(state.get("recommendation_draft") or {}),
    }
    final_analysis, errors = validate_analysis(
        merged_draft,
        state.get("rag_candidates", []),
        grounding_required=state.get("rag_grounding_enabled", False),
    )
    return {
        "final_analysis": final_analysis,
        "validation_errors": errors,
        "timing_events": [
            _timing_event(
                "result_validation",
                started_at,
                status="passed" if not errors else "failed",
                attempt=state.get("model_attempts", 0),
            )
        ],
    }


def _timing_event(
    node: str,
    started_at: float,
    *,
    status: str = "ok",
    attempt: Optional[int] = None,
    detail: Optional[str] = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "node": node,
        "duration_ms": round((perf_counter() - started_at) * 1000, 2),
        "status": status,
    }
    if attempt is not None:
        event["attempt"] = attempt
    if detail:
        event["detail"] = detail
    return event


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
    builder.add_node(
        "skin_diagnosis",
        diagnosis_node,
        retry_policy=RetryPolicy(max_attempts=2),
    )
    builder.add_node("product_retrieval", retrieve_products_node)
    builder.add_node(
        "recommendation",
        recommendation_node,
        retry_policy=RetryPolicy(max_attempts=2),
    )
    builder.add_node("result_validation", validate_node)

    builder.add_edge(START, "weather_context")
    builder.add_edge("weather_context", "skin_diagnosis")
    builder.add_edge("skin_diagnosis", "product_retrieval")
    builder.add_edge("product_retrieval", "recommendation")
    builder.add_edge("recommendation", "result_validation")
    builder.add_conditional_edges(
        "result_validation",
        route_after_validation,
        {
            "retry": "recommendation",
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
                "rag_grounding_enabled": rag_is_configured(),
                "validation_errors": [],
                "model_attempts": 0,
                "timing_events": [],
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
