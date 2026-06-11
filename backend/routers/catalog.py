from fastapi import APIRouter

from services.product_rag import catalog_status


router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/status")
async def status():
    return await catalog_status()
