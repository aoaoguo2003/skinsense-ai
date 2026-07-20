"""Read-only validation: does the facial-scan signal steer Top-12 retrieval?

Runs the SAME neutral questionnaire three times — baseline / oily+acne /
dry+sensitive — against the live catalog, scores each result on two axes
(oil-control vs dry-soothing), and tracks where a few marker products land.

Use it to sanity-check that a simulated face pulls retrieval toward the right
products without taking a real photo. Run from backend/:
    python -m scripts.compare_retrieval_signals

Requires RAG_ENABLED=true + DATABASE_URL + OPENAI_API_KEY (read from backend/.env).
"""
import asyncio
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows/GBK-safe
except Exception:
    pass

from services.product_rag import rag_is_configured, retrieve_product_candidates

QUESTIONNAIRE = {
    "skin_concerns": [],
    "preferred_texture": "no preference",
    "fragrance_preference": "no preference",
    "avoid_ingredients": "none",
    "budget": "$60",
}
WEATHER = {"city": "Shanghai", "temp_c": 30, "humidity": 75,
           "description": "hot and humid", "uv_index": 8}

SCENARIOS = [
    ("baseline (no signal)", None),
    ("oily + acne", {
        "skin_type": "oily",
        "primary_concerns": ["acne", "clogged pores", "excess oil"],
        "visible_description": "very shiny oily T-zone, active acne breakouts on cheeks and chin, enlarged pores, blackheads on the nose",
    }),
    ("dry + sensitive", {
        "skin_type": "dry",
        "primary_concerns": ["dryness", "flaking", "redness", "sensitivity"],
        "visible_description": "dry flaky patches on cheeks and forehead, tightness, redness and irritation, sensitive reactive skin, no oiliness",
    }),
]

OIL_KWS = ("acne", "acné", "oil-control", "oily", "pore", "sebum", "sébium", "sébum",
           "blemish", "imperfection", "purif", "matte", "mattif", "salicyl", "bha",
           "zinc", "clay", "argile", "charcoal", "tea tree", "blackhead")
DRY_KWS = ("hydra", "moistur", "barrier", "ceramide", "hyaluron", "sooth", "sensitiv",
           "repair", "nourish", "sèche", "seche", "intolér", "intoler", "apais",
           "riche", "dry", "comfort", "nutri")

MARKERS = {
    "Bioderma Sébium (oil/sebum)": "sébium",
    "Jonzac anti-imperfections (acne)": "imperfection",
    "Avène peaux intolérantes (soothing)": "intolér",
    "Kazidomi peau sèche & sensible (dry)": "sèche",
}


def _blob(c):
    return " ".join([c.name or "", c.category or "", c.description or "",
                     " ".join(str(x) for x in (c.ingredients or []))]).lower()


def _hit(c, kws):
    b = _blob(c)
    return any(k in b for k in kws)


async def main() -> None:
    print("rag_is_configured():", rag_is_configured())
    if not rag_is_configured():
        raise SystemExit("RAG not configured (need RAG_ENABLED=true + DATABASE_URL + OPENAI_API_KEY).")

    results = {}
    for label, sig in SCENARIOS:
        cands = await retrieve_product_candidates(QUESTIONNAIRE, WEATHER, retrieval_signals=sig)
        results[label] = cands
        oil = sum(_hit(c, OIL_KWS) for c in cands)
        dry = sum(_hit(c, DRY_KWS) for c in cands)
        print(f"\n===== [{label}]  oil-relevant={oil}/{len(cands)}  dry/soothe={dry}/{len(cands)} =====")
        for i, c in enumerate(cands, 1):
            tag = ("O" if _hit(c, OIL_KWS) else " ") + ("D" if _hit(c, DRY_KWS) else " ")
            print(f"[{tag}] {i:>2}. sim={c.similarity:.3f}  {c.brand} | {c.name} [{c.category}]")

    print("\n===== marker-product rank per scenario (rank in Top-12, '-' = absent) =====")
    labels = [l for l, _ in SCENARIOS]
    print("marker".ljust(40) + "".join(l.split(" (")[0][:16].ljust(18) for l in labels))
    for name, needle in MARKERS.items():
        row = name.ljust(40)
        for l in labels:
            ranks = [str(i) for i, c in enumerate(results[l], 1) if needle in (c.name or "").lower()]
            row += (",".join(ranks) if ranks else "-").ljust(18)
        print(row)


if __name__ == "__main__":
    asyncio.run(main())
