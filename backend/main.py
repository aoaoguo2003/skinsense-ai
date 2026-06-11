import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers.analyze import router as analyze_router
from routers.catalog import router as catalog_router
from services.product_rag import (
    catalog_product_count,
    get_rag_settings,
    initialize_schema,
    rag_is_configured,
)

logger = logging.getLogger(__name__)


async def bootstrap_product_catalog() -> None:
    settings = get_rag_settings()
    if settings.rag_bootstrap_limit <= 0:
        return

    try:
        if await catalog_product_count() > 0:
            return

        from scripts.import_open_beauty_facts import run

        logger.info(
            "Product catalog is empty; importing %s Open Beauty Facts products",
            settings.rag_bootstrap_limit,
        )
        await run(
            limit=settings.rag_bootstrap_limit,
            pages=max(3, (settings.rag_bootstrap_limit + 99) // 100),
            page_size=100,
        )
        logger.info("Product catalog bootstrap completed")
    except Exception:
        logger.exception(
            "Product catalog bootstrap failed; the service will continue without RAG products"
        )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    bootstrap_task = None
    if rag_is_configured():
        try:
            await initialize_schema()
            bootstrap_task = asyncio.create_task(bootstrap_product_catalog())
        except Exception:
            logger.exception("Unable to initialize product RAG; starting without retrieval")
    yield
    if bootstrap_task and not bootstrap_task.done():
        bootstrap_task.cancel()


app = FastAPI(title="SkinSense AI", version="1.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_router)
app.include_router(catalog_router)


@app.get("/")
async def root():
    return {"status": "ok"}

@app.get("/health")
async def health():
    return {"status": "ok", "workflow": "langgraph"}
