"""Heuristically tag the catalog so every product has non-empty skin_types
and concerns.

Two passes per product, over name + category + description + ingredients:
  1. keyword-derive skin_types / concerns;
  2. gap-fill any dimension still empty with a sensible default (sunscreen ->
     sun protection, cleanser -> cleansing, else general skincare; skin_types
     default "normal").

This is experiment-grade (keyword-based, not clinically precise) and OVERWRITES
existing tags with the recomputed heuristic values. Run from backend/:
    python -m scripts.tag_catalog

Requires RAG_ENABLED=true + DATABASE_URL (read from backend/.env).
"""
import asyncio
import json

from services.product_rag import get_pool, rag_is_configured

# skin_type tag -> trigger keywords
SKIN_TYPE_RULES = [
    ("oily", ("oil-control", "oily", "sébium", "sebum", "sébum", "matte", "mattif",
              "imperfection", "purif", "acne", "acné", "pore", "blackhead", "salicyl",
              "bha", "clay", "argile", "zinc", "charcoal", "tea tree", "blemish")),
    ("dry", ("dry", "sèche", "seche", "nourish", "riche", "nutri", "barrier",
             "ceramide", "hyaluron", "hydratant", "hydrating", "moistur")),
    ("sensitive", ("sensitiv", "sensible", "intolér", "intoler", "apais", "sooth",
                   "comfort", "doux", "douce", "réactiv", "reactiv", "calm")),
]

# concern tag -> trigger keywords
CONCERN_RULES = [
    ("acne", ("acne", "acné", "imperfection", "purif", "blemish", "blackhead", "sébium", "sebum")),
    ("oiliness", ("oil-control", "oily", "matte", "mattif", "sebum", "sébium")),
    ("enlarged pores", ("pore",)),
    ("dryness", ("dry", "sèche", "seche", "nourish", "riche", "nutri", "barrier", "ceramide")),
    ("redness", ("redness", "rougeur", "apais", "sooth", "calm", "intolér", "réactiv")),
    ("sensitivity", ("sensitiv", "sensible", "intolér", "intoler", "réactiv", "reactiv")),
    ("wrinkles", ("wrinkle", "ride", "anti-âge", "anti-age", "anti-aging", "firm", "lift")),
    ("dark spots", ("bright", "éclat", "eclat", "taches", "radiance", "glow", "whiten")),
]


def _keyword_tags(blob: str):
    skin_types = [t for t, kws in SKIN_TYPE_RULES if any(k in blob for k in kws)]
    concerns = [t for t, kws in CONCERN_RULES if any(k in blob for k in kws)]
    return list(dict.fromkeys(skin_types)), list(dict.fromkeys(concerns))


def _default_concerns(blob: str):
    if any(k in blob for k in ("sunscreen", "spf", "solaire", "sun ")):
        return ["sun protection"]
    if any(k in blob for k in ("cleanser", "nettoyant", "gel lavant", "face wash",
                               "cleansing", "micellar", "micellaire")):
        return ["cleansing"]
    if any(k in blob for k in ("anti-aging", "anti-âge", "anti-age", "anti age")):
        return ["aging"]
    return ["general skincare"]


def tags_for(name, category, description, ingredients_text):
    blob = " ".join([name or "", category or "", description or "", ingredients_text or ""]).lower()
    skin_types, concerns = _keyword_tags(blob)
    if not skin_types:
        skin_types = ["normal"]
    if not concerns:
        concerns = _default_concerns(blob)
    return skin_types, concerns


async def main() -> None:
    if not rag_is_configured():
        raise SystemExit("RAG not configured (need RAG_ENABLED=true + DATABASE_URL).")

    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, name, category, description, ingredients_text FROM catalog_products"
    )

    updates = []
    dist = {}
    for r in rows:
        skin_types, concerns = tags_for(
            r["name"], r["category"], r["description"], r["ingredients_text"]
        )
        for t in skin_types:
            dist[t] = dist.get(t, 0) + 1
        updates.append((r["id"], json.dumps(concerns), json.dumps(skin_types)))

    await pool.executemany(
        "UPDATE catalog_products SET concerns = $2::jsonb, skin_types = $3::jsonb WHERE id = $1",
        updates,
    )

    empties = await pool.fetchval(
        "SELECT COUNT(*) FROM catalog_products "
        "WHERE jsonb_array_length(skin_types) = 0 OR jsonb_array_length(concerns) = 0"
    )
    print(f"tagged {len(updates)} products.")
    print("skin_type distribution:", dict(sorted(dist.items(), key=lambda kv: -kv[1])))
    print(f"products still missing a tag: {empties} (expected 0)")
    print("note: heuristic/noisy tags — refine before production.")


if __name__ == "__main__":
    asyncio.run(main())
