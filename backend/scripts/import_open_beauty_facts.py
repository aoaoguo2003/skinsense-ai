import argparse
import asyncio
import hashlib
import re
from typing import Any

import httpx

from services.product_rag import initialize_schema, upsert_products


API_URL = "https://world.openbeautyfacts.org/api/v2/search"
USER_AGENT = "SkinSenseAI/1.0 (product-rag-import; contact: project-maintainer)"
DEFAULT_CATEGORIES = [
    "en:face",
    "en:facial-creams",
    "en:cleansers",
    "en:suncare",
    "en:sunscreen",
    "en:anti-aging-face-care-products",
    "en:face-masks",
]
FIELDS = ",".join(
    [
        "code",
        "product_name",
        "brands",
        "categories",
        "categories_tags",
        "ingredients",
        "ingredients_text",
        "ingredients_text_en",
        "labels_tags",
        "countries_tags",
        "image_front_url",
        "last_modified_t",
    ]
)


def _first_text(value: Any) -> str:
    if isinstance(value, list):
        value = value[0] if value else ""
    return str(value or "").split(",")[0].strip()


def _ingredient_names(product: dict[str, Any]) -> list[str]:
    structured = product.get("ingredients") or []
    names = []
    for ingredient in structured:
        if not isinstance(ingredient, dict):
            continue
        name = ingredient.get("text") or ingredient.get("id")
        if name:
            names.append(str(name).replace("en:", "").strip())
    if names:
        return list(dict.fromkeys(names))

    raw = product.get("ingredients_text_en") or product.get("ingredients_text") or ""
    return [
        item.strip(" .")
        for item in re.split(r"[,;]", str(raw))
        if len(item.strip(" .")) >= 2
    ][:100]


def _markets(product: dict[str, Any]) -> list[str]:
    tags = {str(tag).lower() for tag in product.get("countries_tags") or []}
    markets = []
    if any("united-states" in tag or tag.endswith(":usa") for tag in tags):
        markets.append("US")
    if any("united-kingdom" in tag or tag.endswith(":uk") for tag in tags):
        markets.append("GB")
    return markets


def normalize_product(product: dict[str, Any]) -> dict[str, Any] | None:
    code = str(product.get("code") or "").strip()
    brand = _first_text(product.get("brands"))
    name = _first_text(product.get("product_name"))
    ingredients = _ingredient_names(product)
    if not brand or not name or len(ingredients) < 3:
        return None

    categories = _first_text(product.get("categories"))
    labels = {str(tag).lower() for tag in product.get("labels_tags") or []}
    fragrance_free = True if any("fragrance-free" in tag for tag in labels) else None
    source_id = code or hashlib.sha256(f"{brand}:{name}".encode()).hexdigest()[:20]

    return {
        "id": f"open_beauty_facts:{source_id}",
        "source": "open_beauty_facts",
        "source_id": source_id,
        "brand": brand,
        "name": name,
        "category": categories or "Skincare",
        "description": f"{brand} {name}. {categories}".strip(),
        "ingredients": ingredients,
        "concerns": [],
        "skin_types": [],
        "texture": None,
        "fragrance_free": fragrance_free,
        "price_min_usd": None,
        "price_max_usd": None,
        "price_tier": None,
        "markets": _markets(product),
        "product_url": f"https://world.openbeautyfacts.org/product/{code}" if code else None,
        "image_url": product.get("image_front_url"),
    }


async def fetch_category(
    client: httpx.AsyncClient,
    category: str,
    pages: int,
    page_size: int,
) -> list[dict[str, Any]]:
    products = []
    for page in range(1, pages + 1):
        response = await client.get(
            API_URL,
            params={
                "categories_tags": category,
                "fields": FIELDS,
                "page": page,
                "page_size": page_size,
            },
        )
        response.raise_for_status()
        products.extend(response.json().get("products") or [])
        await asyncio.sleep(1)
    return products


async def run(limit: int, pages: int, page_size: int) -> None:
    await initialize_schema()

    raw_products = []
    async with httpx.AsyncClient(
        timeout=30,
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
    ) as client:
        for category in DEFAULT_CATEGORIES:
            raw_products.extend(await fetch_category(client, category, pages, page_size))

    normalized = {}
    for raw_product in raw_products:
        product = normalize_product(raw_product)
        if product:
            normalized[product["id"]] = product
        if len(normalized) >= limit:
            break

    imported = await upsert_products(list(normalized.values()))
    print(f"Imported {imported} products with embeddings.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import skincare products into pgvector.")
    parser.add_argument("--limit", type=int, default=300)
    parser.add_argument("--pages", type=int, default=3)
    parser.add_argument("--page-size", type=int, default=100)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(run(args.limit, args.pages, args.page_size))
