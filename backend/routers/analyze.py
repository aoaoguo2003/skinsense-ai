from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import os
import httpx

from services.product_rag import rag_is_configured
from workflows.skin_analysis import run_analysis_workflow

router = APIRouter(prefix="/api", tags=["analyze"])


@router.post("/analyze")
async def analyze_endpoint(
    questionnaire: str = Form(...),
    current_products: Optional[str] = Form(None),
    city: Optional[str] = Form(None),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    image: Optional[UploadFile] = File(None),
    images: Optional[list[UploadFile]] = File(None),
    image_labels: Optional[str] = Form(None),
):
    try:
        q_data = json.loads(questionnaire)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid questionnaire JSON")

    labels_list = None
    if image_labels:
        try:
            parsed = json.loads(image_labels)
            if isinstance(parsed, list):
                labels_list = [str(x) for x in parsed]
        except json.JSONDecodeError:
            labels_list = None

    products_list = None
    if current_products:
        try:
            products_list = json.loads(current_products)
        except json.JSONDecodeError:
            products_list = [p.strip() for p in current_products.split(",") if p.strip()]

    # Read image bytes. Keep the legacy single-image field, but prefer the
    # scanner's multi-image payload when it is provided.
    image_payloads = []
    upload_images = images or []
    if not upload_images and image and image.filename:
        upload_images = [image]

    if len(upload_images) > 6:
        upload_images = upload_images[:6]
    if labels_list is not None:
        labels_list = labels_list[: len(upload_images)]

    total_image_bytes = 0
    for upload in upload_images:
        if not upload.filename:
            continue
        image_bytes = await upload.read()
        total_image_bytes += len(image_bytes)
        if len(image_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large (max 10MB each)")
        if total_image_bytes > 20 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Images too large (max 20MB total)")
        image_payloads.append((image_bytes, upload.content_type or "image/jpeg"))

    workflow = await run_analysis_workflow(
        questionnaire=q_data,
        current_products=products_list,
        city=city,
        latitude=latitude,
        longitude=longitude,
        image_payloads=image_payloads,
        image_labels=labels_list,
    )
    result = workflow["final_analysis"]
    rag_candidates = workflow.get("rag_candidates", [])

    return {
        "status": "ok",
        "trace_id": workflow["trace_id"],
        "weather": workflow.get("weather"),
        "analysis": result,
        "retrieval": {
            "enabled": rag_is_configured(),
            "candidate_count": len(rag_candidates),
            "grounded_recommendation_count": len(result.get("product_recommendations", [])),
            "error": workflow.get("retrieval_error"),
        },
        "workflow": {
            "engine": "langgraph",
            "model_attempts": workflow.get("model_attempts", 0),
            "validation_errors": workflow.get("validation_errors", []),
            "timing_events": workflow.get("timing_events", []),
        },
    }


@router.get("/image")
async def image_search(q: str):
    api_key = os.getenv("SERPER_API_KEY", "")
    if not api_key:
        return {"image_url": None}
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            resp = await client.post(
                "https://google.serper.dev/images",
                headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
                json={"q": q, "num": 3},
            )
            data = resp.json()
            images = data.get("images", [])
            if images:
                return {
                    "image_url": images[0]["imageUrl"],
                    "fallbacks": [img["imageUrl"] for img in images[1:]],
                }
            return {"image_url": None, "error": "no results"}
        except Exception as e:
            return {"image_url": None, "error": str(e)}


@router.get("/image-proxy")
async def image_proxy(url: str):
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        try:
            resp = await client.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Referer": "https://www.google.com/",
                    "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            content_type = resp.headers.get("content-type", "image/jpeg")
            return StreamingResponse(iter([resp.content]), media_type=content_type)
        except Exception:
            raise HTTPException(status_code=404, detail="Image not available")
