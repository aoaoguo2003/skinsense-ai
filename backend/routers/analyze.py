from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from typing import Optional
import json

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
