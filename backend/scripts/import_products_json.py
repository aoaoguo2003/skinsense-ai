import argparse
import asyncio
import json
from pathlib import Path

from services.product_rag import initialize_schema, upsert_products


async def run(path: Path) -> None:
    products = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(products, list):
        raise ValueError("The JSON file must contain a list of products")
    await initialize_schema()
    imported = await upsert_products(products)
    print(f"Imported {imported} products with embeddings.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Import curated products into pgvector.")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    asyncio.run(run(args.path))
