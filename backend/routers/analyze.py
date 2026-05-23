from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import os
import httpx

from services.llm_service import analyze_skin
from services.weather_service import get_weather_by_city, get_weather_by_coords

router = APIRouter(prefix="/api", tags=["analyze"])


@router.post("/analyze")
async def analyze_endpoint(
    questionnaire: str = Form(...),
    current_products: Optional[str] = Form(None),
    city: Optional[str] = Form(None),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    image: Optional[UploadFile] = File(None),
):
    try:
        q_data = json.loads(questionnaire)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Invalid questionnaire JSON")

    products_list = None
    if current_products:
        try:
            products_list = json.loads(current_products)
        except json.JSONDecodeError:
            products_list = [p.strip() for p in current_products.split(",") if p.strip()]

    # Fetch weather
    weather = None
    if latitude is not None and longitude is not None:
        weather = await get_weather_by_coords(latitude, longitude)
    elif city:
        weather = await get_weather_by_city(city)

    # Read image bytes
    image_bytes = None
    image_media_type = None
    if image and image.filename:
        image_bytes = await image.read()
        image_media_type = image.content_type or "image/jpeg"
        if len(image_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large (max 10MB)")

    result = await analyze_skin(
        questionnaire=q_data,
        weather=weather,
        current_products=products_list,
        image_bytes=image_bytes,
        image_media_type=image_media_type,
    )

    return {"status": "ok", "weather": weather, "analysis": result}


@router.get("/image")
async def image_search(q: str):
    api_key = os.getenv("GOOGLE_API_KEY", "")
    cx = os.getenv("GOOGLE_CX", "")
    if not api_key or not cx:
        return {"image_url": None}
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            resp = await client.get(
                "https://www.googleapis.com/customsearch/v1",
                params={
                    "key": api_key,
                    "cx": cx,
                    "q": q,
                    "searchType": "image",
                    "num": 3,
                    "safe": "active",
                    "imgType": "photo",
                },
            )
            data = resp.json()
            if "items" in data and data["items"]:
                # Try each result until one proxies successfully
                for item in data["items"]:
                    url = item["link"]
                    try:
                        img_resp = await client.get(
                            url,
                            headers={"Referer": "https://www.google.com/"},
                            timeout=4,
                            follow_redirects=True,
                        )
                        if img_resp.status_code == 200 and "image" in img_resp.headers.get("content-type", ""):
                            return {"image_url": f"/api/image-proxy?url={httpx.URL(url)}", "direct_url": url}
                    except Exception:
                        continue
        except Exception:
            pass
    return {"image_url": None}


@router.get("/image-proxy")
async def image_proxy(url: str):
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as client:
        try:
            resp = await client.get(
                url,
                headers={"Referer": "https://www.google.com/", "User-Agent": "Mozilla/5.0"},
            )
            content_type = resp.headers.get("content-type", "image/jpeg")
            return StreamingResponse(iter([resp.content]), media_type=content_type)
        except Exception:
            raise HTTPException(status_code=404, detail="Image not available")
