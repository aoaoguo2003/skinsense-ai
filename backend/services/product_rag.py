import asyncio
import json
import re
from dataclasses import asdict, dataclass
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import asyncpg
from pgvector.asyncpg import register_vector
from pydantic_settings import BaseSettings

from services.embedding_service import embed_texts, get_embedding_settings


class RagSettings(BaseSettings):
    rag_enabled: bool = False
    database_url: str = ""
    rag_candidate_limit: int = 12
    rag_bootstrap_limit: int = 300
    cny_per_usd: float = 7.2
    gbp_to_usd: float = 1.27

    model_config = {"env_file": ".env", "extra": "ignore"}


@dataclass
class ProductCandidate:
    catalog_id: str
    source: str
    brand: str
    name: str
    category: str
    description: str
    ingredients: list[str]
    texture: Optional[str]
    fragrance_free: Optional[bool]
    price_min_usd: Optional[float]
    price_max_usd: Optional[float]
    price_tier: Optional[str]
    markets: list[str]
    product_url: Optional[str]
    image_url: Optional[str]
    similarity: float = 0.0

    def to_prompt_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["ingredients"] = self.ingredients[:30]
        return data


@lru_cache
def get_rag_settings() -> RagSettings:
    return RagSettings()


_pool: Optional[asyncpg.Pool] = None
_pool_lock = asyncio.Lock()


async def _register_vector(connection: asyncpg.Connection) -> None:
    await register_vector(connection)


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is not None:
        return _pool

    settings = get_rag_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required when RAG_ENABLED=true")

    async with _pool_lock:
        if _pool is None:
            _pool = await asyncpg.create_pool(
                dsn=settings.database_url,
                min_size=1,
                max_size=5,
                command_timeout=20,
                init=_register_vector,
            )
    return _pool


async def initialize_schema() -> None:
    settings = get_rag_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required to initialize the RAG database")

    sql_path = Path(__file__).resolve().parents[1] / "sql" / "001_product_rag.sql"
    sql = sql_path.read_text(encoding="utf-8")
    connection = await asyncpg.connect(settings.database_url)
    try:
        await connection.execute(sql)
    finally:
        await connection.close()


def rag_is_configured() -> bool:
    settings = get_rag_settings()
    embedding_settings = get_embedding_settings()
    return bool(
        settings.rag_enabled
        and settings.database_url
        and embedding_settings.openai_api_key
    )


def parse_avoided_ingredients(value: Any) -> list[str]:
    if not value or str(value).strip().lower() in {"none", "no", "n/a", "unknown"}:
        return []
    parts = re.split(r"[,;/;；、，]+", str(value))
    return [part.strip().lower() for part in parts if len(part.strip()) >= 2]


def parse_budget_max_usd(value: Any) -> Optional[float]:
    if not value:
        return None

    text = str(value)
    numbers = [float(item) for item in re.findall(r"\d+(?:\.\d+)?", text)]
    if not numbers:
        return None

    maximum = max(numbers)
    settings = get_rag_settings()
    if "¥" in text or "rmb" in text.lower() or "cny" in text.lower():
        return round(maximum / settings.cny_per_usd, 2)
    if "£" in text or "gbp" in text.lower():
        return round(maximum * settings.gbp_to_usd, 2)
    return maximum


def wants_fragrance_free(value: Any) -> bool:
    text = str(value or "").lower()
    return any(term in text for term in ("fragrance-free", "fragrance free", "unscented", "无香"))


def build_retrieval_query(questionnaire: dict, weather: Optional[dict]) -> str:
    concerns = questionnaire.get("skin_concerns") or []
    if isinstance(concerns, str):
        concerns = [concerns]

    parts = [
        "Personalized skincare product",
        f"skin concerns: {', '.join(str(item) for item in concerns)}",
        f"preferred texture: {questionnaire.get('preferred_texture', 'no preference')}",
        f"fragrance preference: {questionnaire.get('fragrance_preference', 'no preference')}",
        f"avoid ingredients: {questionnaire.get('avoid_ingredients', 'none')}",
    ]
    if weather:
        parts.append(
            "weather: "
            f"{weather.get('temp_c', 'unknown')} C, "
            f"{weather.get('humidity', 'unknown')}% humidity, "
            f"{weather.get('description', 'unknown')}"
        )
    return "\n".join(parts)


def build_embedding_text(product: dict[str, Any]) -> str:
    ingredients = product.get("ingredients") or []
    if isinstance(ingredients, str):
        ingredients = [ingredients]
    return "\n".join(
        [
            f"Brand: {product.get('brand', '')}",
            f"Product: {product.get('name', '')}",
            f"Category: {product.get('category', '')}",
            f"Description: {product.get('description', '')}",
            f"Skin types: {', '.join(product.get('skin_types') or [])}",
            f"Concerns: {', '.join(product.get('concerns') or [])}",
            f"Texture: {product.get('texture') or 'unknown'}",
            f"Ingredients: {', '.join(str(item) for item in ingredients)}",
        ]
    )


def _row_to_candidate(row: asyncpg.Record) -> ProductCandidate:
    ingredients = row["ingredients"] or []
    if isinstance(ingredients, str):
        ingredients = json.loads(ingredients)
    return ProductCandidate(
        catalog_id=row["id"],
        source=row["source"],
        brand=row["brand"],
        name=row["name"],
        category=row["category"] or "Skincare",
        description=row["description"] or "",
        ingredients=[str(item) for item in ingredients],
        texture=row["texture"],
        fragrance_free=row["fragrance_free"],
        price_min_usd=float(row["price_min_usd"]) if row["price_min_usd"] is not None else None,
        price_max_usd=float(row["price_max_usd"]) if row["price_max_usd"] is not None else None,
        price_tier=row["price_tier"],
        markets=list(row["markets"] or []),
        product_url=row["product_url"],
        image_url=row["image_url"],
        similarity=float(row["similarity"]),
    )


async def retrieve_product_candidates(
    questionnaire: dict,
    weather: Optional[dict],
    markets: Optional[list[str]] = None,
) -> list[ProductCandidate]:
    if not rag_is_configured():
        return []

    settings = get_rag_settings()
    query = build_retrieval_query(questionnaire, weather)
    query_embedding = (await embed_texts([query]))[0]
    avoided = parse_avoided_ingredients(questionnaire.get("avoid_ingredients"))
    budget_max = parse_budget_max_usd(questionnaire.get("budget"))
    fragrance_free = wants_fragrance_free(questionnaire.get("fragrance_preference"))
    target_markets = [market.upper() for market in (markets or ["US", "GB"])]

    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT
            id, source, brand, name, category, description, ingredients,
            texture, fragrance_free, price_min_usd, price_max_usd, price_tier,
            markets, product_url, image_url,
            1 - (embedding <=> $1) AS similarity
        FROM catalog_products
        WHERE embedding IS NOT NULL
          AND (cardinality(markets) = 0 OR markets && $2::text[])
          AND ($3::boolean = FALSE OR fragrance_free IS TRUE)
          AND ($4::numeric IS NULL OR price_min_usd IS NULL OR price_min_usd <= $4)
          AND NOT EXISTS (
              SELECT 1
              FROM unnest($5::text[]) AS avoided(term)
              WHERE ingredients_text ILIKE '%' || avoided.term || '%'
          )
        ORDER BY embedding <=> $1
        LIMIT $6
        """,
        query_embedding,
        target_markets,
        fragrance_free,
        Decimal(str(budget_max)) if budget_max is not None else None,
        avoided,
        settings.rag_candidate_limit,
    )
    return [_row_to_candidate(row) for row in rows]


async def catalog_status() -> dict[str, Any]:
    if not rag_is_configured():
        return {"enabled": False, "configured": False, "product_count": 0}
    pool = await get_pool()
    count = await pool.fetchval("SELECT COUNT(*) FROM catalog_products WHERE embedding IS NOT NULL")
    return {"enabled": True, "configured": True, "product_count": int(count)}


async def catalog_product_count() -> int:
    if not rag_is_configured():
        return 0
    pool = await get_pool()
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM catalog_products WHERE embedding IS NOT NULL"
    )
    return int(count)


async def upsert_products(products: list[dict[str, Any]], batch_size: int = 50) -> int:
    if not products:
        return 0

    pool = await get_pool()
    embedding_settings = get_embedding_settings()
    imported = 0

    for start in range(0, len(products), batch_size):
        batch = products[start : start + batch_size]
        embeddings = await embed_texts([build_embedding_text(product) for product in batch])
        records = []

        for product, embedding in zip(batch, embeddings):
            ingredients = product.get("ingredients") or []
            if isinstance(ingredients, str):
                ingredients = [ingredients]
            records.append(
                (
                    str(product["id"]),
                    str(product.get("source") or "unknown"),
                    product.get("source_id"),
                    str(product.get("brand") or "").strip(),
                    str(product.get("name") or "").strip(),
                    product.get("category"),
                    product.get("description"),
                    json.dumps(ingredients),
                    ", ".join(str(item) for item in ingredients).lower(),
                    json.dumps(product.get("concerns") or []),
                    json.dumps(product.get("skin_types") or []),
                    product.get("texture"),
                    product.get("fragrance_free"),
                    product.get("price_min_usd"),
                    product.get("price_max_usd"),
                    product.get("price_tier"),
                    product.get("markets") or [],
                    product.get("product_url"),
                    product.get("image_url"),
                    embedding,
                    embedding_settings.embedding_model,
                )
            )

        await pool.executemany(
            """
            INSERT INTO catalog_products (
                id, source, source_id, brand, name, category, description,
                ingredients, ingredients_text, concerns, skin_types, texture,
                fragrance_free, price_min_usd, price_max_usd, price_tier,
                markets, product_url, image_url, embedding, embedding_model
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8::jsonb, $9, $10::jsonb, $11::jsonb, $12,
                $13, $14, $15, $16, $17::text[], $18, $19, $20, $21
            )
            ON CONFLICT (id) DO UPDATE SET
                source = EXCLUDED.source,
                source_id = EXCLUDED.source_id,
                brand = EXCLUDED.brand,
                name = EXCLUDED.name,
                category = EXCLUDED.category,
                description = EXCLUDED.description,
                ingredients = EXCLUDED.ingredients,
                ingredients_text = EXCLUDED.ingredients_text,
                concerns = EXCLUDED.concerns,
                skin_types = EXCLUDED.skin_types,
                texture = EXCLUDED.texture,
                fragrance_free = EXCLUDED.fragrance_free,
                price_min_usd = EXCLUDED.price_min_usd,
                price_max_usd = EXCLUDED.price_max_usd,
                price_tier = EXCLUDED.price_tier,
                markets = EXCLUDED.markets,
                product_url = EXCLUDED.product_url,
                image_url = EXCLUDED.image_url,
                embedding = EXCLUDED.embedding,
                embedding_model = EXCLUDED.embedding_model,
                indexed_at = NOW()
            """,
            records,
        )
        imported += len(records)

    return imported


def normalize_product_key(brand: Any, name: Any) -> str:
    value = f"{brand or ''} {name or ''}".lower()
    return re.sub(r"[^a-z0-9]+", "", value)


def ground_recommendations(
    analysis: dict[str, Any],
    candidates: list[ProductCandidate],
) -> dict[str, Any]:
    if not candidates:
        return analysis

    by_id = {candidate.catalog_id: candidate for candidate in candidates}
    by_name = {
        normalize_product_key(candidate.brand, candidate.name): candidate
        for candidate in candidates
    }
    grounded = []

    for recommendation in analysis.get("product_recommendations", []):
        candidate = by_id.get(str(recommendation.get("catalog_id") or ""))
        if candidate is None:
            candidate = by_name.get(
                normalize_product_key(
                    recommendation.get("brand"),
                    recommendation.get("product_name"),
                )
            )
        if candidate is None:
            continue

        canonical = dict(recommendation)
        canonical.update(
            {
                "catalog_id": candidate.catalog_id,
                "brand": candidate.brand,
                "product_name": candidate.name,
                "category": candidate.category,
                "price_range": candidate.price_tier or recommendation.get("price_range") or "$$",
                "product_url": candidate.product_url,
                "source": candidate.source,
            }
        )
        grounded.append(canonical)

    analysis["product_recommendations"] = grounded
    return analysis
