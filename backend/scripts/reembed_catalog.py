"""Recompute catalog embeddings from the current rows so that the
concerns / skin_types tags are folded into each product's vector.

`build_embedding_text` already includes concerns/skin_types, but embeddings
created before those tags were populated don't reflect them. Run this after
tagging the catalog so the tags influence semantic similarity (not just the
skin_type ranking bonus).

Run from the backend/ directory:
    python -m scripts.reembed_catalog

Requires RAG_ENABLED=true + DATABASE_URL + OPENAI_API_KEY (read from backend/.env).
"""
import asyncio
import json

from services.embedding_service import embed_texts, get_embedding_settings
from services.product_rag import build_embedding_text, get_pool, rag_is_configured


def _arr(value):
    return json.loads(value) if isinstance(value, str) else (value or [])


def _row_to_product(row) -> dict:
    return {
        "brand": row["brand"],
        "name": row["name"],
        "category": row["category"],
        "description": row["description"],
        "skin_types": _arr(row["skin_types"]),
        "concerns": _arr(row["concerns"]),
        "texture": row["texture"],
        "ingredients": _arr(row["ingredients"]),
    }


async def main(batch_size: int = 50) -> None:
    if not rag_is_configured():
        raise SystemExit(
            "RAG not configured (need RAG_ENABLED=true + DATABASE_URL + OPENAI_API_KEY)."
        )

    pool = await get_pool()
    model = get_embedding_settings().embedding_model
    rows = await pool.fetch(
        "SELECT id, brand, name, category, description, skin_types, concerns, "
        "texture, ingredients FROM catalog_products ORDER BY id"
    )
    print(f"re-embedding {len(rows)} products with {model} ...")

    done = 0
    for start in range(0, len(rows), batch_size):
        batch = rows[start : start + batch_size]
        texts = [build_embedding_text(_row_to_product(r)) for r in batch]
        embeddings = await embed_texts(texts)
        records = [(r["id"], emb, model) for r, emb in zip(batch, embeddings)]
        await pool.executemany(
            "UPDATE catalog_products "
            "SET embedding = $2, embedding_model = $3, indexed_at = NOW() "
            "WHERE id = $1",
            records,
        )
        done += len(batch)
        print(f"  {done}/{len(rows)}")

    print("done.")


if __name__ == "__main__":
    asyncio.run(main())
