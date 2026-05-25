import httpx
from typing import Optional
import os


OPENWEATHER_API_KEY = os.getenv("OPENWEATHER_API_KEY", "")


async def get_weather_by_city(city: str) -> Optional[dict]:
    if not OPENWEATHER_API_KEY:
        return None

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={
                    "q": city,
                    "appid": OPENWEATHER_API_KEY,
                    "units": "metric",
                    "lang": "en",
                },
            )
            resp.raise_for_status()
            data = resp.json()

            return {
                "city": data["name"],
                "country": data["sys"]["country"],
                "temp_c": round(data["main"]["temp"], 1),
                "humidity": data["main"]["humidity"],
                "description": data["weather"][0]["description"],
                "uv_index": None,
            }
        except Exception:
            return None


async def get_weather_by_coords(lat: float, lon: float) -> Optional[dict]:
    if not OPENWEATHER_API_KEY:
        return None

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={
                    "lat": lat,
                    "lon": lon,
                    "appid": OPENWEATHER_API_KEY,
                    "units": "metric",
                    "lang": "en",
                },
            )
            resp.raise_for_status()
            data = resp.json()

            # Try to get UV index
            uv_index = None
            try:
                uv_resp = await client.get(
                    "https://api.openweathermap.org/data/2.5/uvi",
                    params={"lat": lat, "lon": lon, "appid": OPENWEATHER_API_KEY},
                )
                if uv_resp.status_code == 200:
                    uv_index = uv_resp.json().get("value")
            except Exception:
                pass

            return {
                "city": data["name"],
                "country": data["sys"]["country"],
                "temp_c": round(data["main"]["temp"], 1),
                "humidity": data["main"]["humidity"],
                "description": data["weather"][0]["description"],
                "uv_index": uv_index,
            }
        except Exception:
            return None
