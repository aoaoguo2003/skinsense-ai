# Product RAG

SkinSense uses PostgreSQL with the `pgvector` extension for grounded product
recommendations. RAG is optional: the existing LLM-only analysis continues to work
when it is disabled or not configured.

## Data flow

1. Import product records from Open Beauty Facts or a curated JSON/affiliate feed.
2. Build one searchable document from product name, category, claims and ingredients.
3. Generate embeddings with `text-embedding-3-small`.
4. Store metadata and the 1536-dimensional vector in `catalog_products`.
5. At analysis time, apply market, budget, fragrance and avoided-ingredient filters.
6. Rank the remaining products by cosine similarity.
7. Give the candidates to the LLM and reject recommendations not found in the catalog.

## Setup

Create a PostgreSQL database that supports `pgvector`, then configure:

```env
RAG_ENABLED=true
DATABASE_URL=postgresql://user:password@host:5432/database
OPENAI_API_KEY=...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
RAG_CANDIDATE_LIMIT=12
RAG_BOOTSTRAP_LIMIT=300
```

From `backend/`:

```bash
pip install -r requirements.txt
python -m scripts.init_rag_db
python -m scripts.import_open_beauty_facts --limit 300
```

On Render, `RAG_BOOTSTRAP_LIMIT=300` starts the same import in the background when
the service boots and the catalog is empty. Set it to `0` to disable automatic
bootstrap. This is useful for Free web services, which do not provide shell access.

For licensed affiliate feeds or manually reviewed data:

```bash
python -m scripts.import_products_json path/to/products.json
```

Each JSON product must include `id`, `source`, `brand`, `name`, and may include:

```json
{
  "id": "partner:123",
  "source": "affiliate_partner",
  "source_id": "123",
  "brand": "Example",
  "name": "Barrier Cream",
  "category": "Moisturizer",
  "description": "Fragrance-free barrier moisturizer",
  "ingredients": ["ceramide NP", "glycerin"],
  "concerns": ["dryness", "barrier support"],
  "skin_types": ["dry", "sensitive"],
  "texture": "cream",
  "fragrance_free": true,
  "price_min_usd": 18,
  "price_max_usd": 18,
  "price_tier": "$$",
  "markets": ["US", "GB"],
  "product_url": "https://example.com/product",
  "image_url": "https://example.com/product.jpg"
}
```

`GET /api/catalog/status` reports whether RAG is configured and how many embedded
products are available. `POST /api/analyze` includes retrieval counts in its response.

Open Beauty Facts is community-contributed data. Treat it as a bootstrap source,
retain provenance, and replace or enrich records with licensed retailer/affiliate
feeds before commercial use.
