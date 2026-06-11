import asyncio
import logging
from datetime import datetime, timezone
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

bootstrap_status = {
    "state": "idle",
    "attempts": 0,
    "imported": 0,
    "last_error": None,
    "updated_at": None,
}


def _update_bootstrap_status(**updates) -> None:
    bootstrap_status.update(
        updates,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )


async def bootstrap_product_catalog() -> None:
    settings = get_rag_settings()
    if settings.rag_bootstrap_limit <= 0:
        _update_bootstrap_status(state="disabled")
        return

    try:
        existing_count = await catalog_product_count()
    except Exception as exc:
        _update_bootstrap_status(
            state="failed",
            last_error=type(exc).__name__,
        )
        logger.exception("Unable to inspect product catalog before bootstrap")
        return
    if existing_count > 0:
        _update_bootstrap_status(
            state="ready",
            imported=existing_count,
            last_error=None,
        )
        return

    from scripts.import_open_beauty_facts import run

    for attempt in range(1, 4):
        _update_bootstrap_status(
            state="running",
            attempts=attempt,
            last_error=None,
        )
        try:
            logger.info(
                "Product catalog is empty; importing %s Open Beauty Facts products "
                "(attempt %s/3)",
                settings.rag_bootstrap_limit,
                attempt,
            )
            await run(
                limit=settings.rag_bootstrap_limit,
                pages=max(3, (settings.rag_bootstrap_limit + 99) // 100),
                page_size=100,
            )
            imported_count = await catalog_product_count()
            _update_bootstrap_status(
                state="ready",
                imported=imported_count,
                last_error=None,
            )
            logger.info(
                "Product catalog bootstrap completed with %s products",
                imported_count,
            )
            return
        except Exception as exc:
            _update_bootstrap_status(
                state="retrying" if attempt < 3 else "failed",
                last_error=type(exc).__name__,
            )
            logger.exception(
                "Product catalog bootstrap attempt %s failed",
                attempt,
            )
            if attempt < 3:
                await asyncio.sleep(10 * attempt)


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
    return {
        "status": "ok",
        "workflow": "langgraph",
        "catalog_bootstrap": bootstrap_status,
    }
