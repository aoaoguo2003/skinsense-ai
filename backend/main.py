import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers.analyze import router as analyze_router
from routers.catalog import router as catalog_router
from services.product_rag import initialize_schema, rag_is_configured

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if rag_is_configured():
        try:
            await initialize_schema()
        except Exception:
            logger.exception("Unable to initialize product RAG; starting without retrieval")
    yield


app = FastAPI(title="SkinSense AI", version="1.1.0", lifespan=lifespan)

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
    return {"status": "ok"}
