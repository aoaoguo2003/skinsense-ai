from fastapi import APIRouter, File, Form, UploadFile, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse
from typing import Optional
from pathlib import Path
from datetime import datetime
import json
import os
import re
import uuid
import html
import httpx

from services.llm_service import analyze_skin
from services.weather_service import get_weather_by_city, get_weather_by_coords

router = APIRouter(prefix="/api", tags=["analyze"])

# --- Debug: save uploaded face scans to disk so they can be reviewed ---
SCANS_DIR = Path(os.getenv("SCANS_DIR", "scans"))
# Off by default — only enable locally (SAVE_SCANS=1) for debugging.
# Never enable on the production/Render backend (would store users' faces).
SAVE_SCANS = os.getenv("SAVE_SCANS", "0") == "1"
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")


def _check_token(token: Optional[str]) -> None:
    if ADMIN_TOKEN and token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _save_scan(image_payloads: list, labels: Optional[list[str]], city: Optional[str]) -> None:
    if not (SAVE_SCANS and image_payloads):
        return
    try:
        session = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
        folder = SCANS_DIR / session
        folder.mkdir(parents=True, exist_ok=True)
        for i, (data, media_type) in enumerate(image_payloads):
            label = labels[i] if labels and i < len(labels) else f"image-{i + 1}"
            safe = _slug(label) or f"image-{i + 1}"
            ext = "png" if media_type and "png" in media_type else "jpg"
            (folder / f"{i:02d}-{safe}.{ext}").write_bytes(data)
        meta = {"created": session, "city": city, "labels": labels}
        (folder / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    except Exception:
        # Never let debug persistence break the analysis request.
        pass


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

    # Fetch weather
    weather = None
    if latitude is not None and longitude is not None:
        weather = await get_weather_by_coords(latitude, longitude)
    elif city:
        weather = await get_weather_by_city(city)

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

    # Persist the uploaded scan images for later review (debug feature).
    _save_scan(image_payloads, labels_list, city)

    # Backward compatibility for the service while the app migrates to multi-image scans.
    image_bytes = image_payloads[0][0] if image_payloads else None
    image_media_type = image_payloads[0][1] if image_payloads else None

    result = await analyze_skin(
        questionnaire=q_data,
        weather=weather,
        current_products=products_list,
        image_bytes=image_bytes,
        image_media_type=image_media_type,
        image_payloads=image_payloads,
        image_labels=labels_list,
    )

    return {"status": "ok", "weather": weather, "analysis": result}


@router.get("/scans")
def list_scans(token: Optional[str] = None):
    _check_token(token)
    if not SCANS_DIR.exists():
        return {"sessions": []}
    sessions = []
    for d in sorted(SCANS_DIR.iterdir(), reverse=True):
        if not d.is_dir():
            continue
        images = sorted(p.name for p in d.iterdir() if p.suffix.lower() in _IMAGE_EXTS)
        sessions.append({"id": d.name, "images": images})
    return {"sessions": sessions}


@router.get("/scans/{session}/{filename}")
def get_scan_file(session: str, filename: str, token: Optional[str] = None):
    _check_token(token)
    base = SCANS_DIR.resolve()
    target = (base / session / filename).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)


@router.get("/scans-view", response_class=HTMLResponse)
def scans_view(token: Optional[str] = None):
    _check_token(token)
    q = f"?token={html.escape(token)}" if (ADMIN_TOKEN and token) else ""
    sessions = []
    if SCANS_DIR.exists():
        sessions = sorted((d for d in SCANS_DIR.iterdir() if d.is_dir()), reverse=True)

    blocks = []
    for d in sessions:
        imgs = sorted(p.name for p in d.iterdir() if p.suffix.lower() in _IMAGE_EXTS)
        thumbs = "".join(
            f'<figure><img src="/api/scans/{d.name}/{name}{q}" loading="lazy">'
            f'<figcaption>{html.escape(name)}</figcaption></figure>'
            for name in imgs
        )
        blocks.append(f'<section><h2>{html.escape(d.name)}</h2><div class="row">{thumbs}</div></section>')

    body = "".join(blocks) or "<p>No scans saved yet.</p>"
    page = (
        "<!doctype html><html><head><meta charset='utf-8'><title>Face scans</title>"
        "<style>body{font-family:system-ui,sans-serif;margin:24px;background:#0a0a0a;color:#eee}"
        "h1{font-size:18px}h2{font-size:13px;color:#aaa;margin:24px 0 8px}"
        ".row{display:flex;flex-wrap:wrap;gap:12px}"
        "figure{margin:0;width:200px}img{width:200px;height:200px;object-fit:contain;"
        "background:#161616;border:1px solid #333;border-radius:8px}"
        "figcaption{font-size:11px;color:#888;margin-top:4px;word-break:break-all}</style>"
        f"</head><body><h1>Saved face scans ({len(sessions)})</h1>{body}</body></html>"
    )
    return HTMLResponse(page)


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
