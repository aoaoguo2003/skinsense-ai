CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS catalog_products (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT,
    brand TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
    ingredients_text TEXT NOT NULL DEFAULT '',
    concerns JSONB NOT NULL DEFAULT '[]'::jsonb,
    skin_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    texture TEXT,
    fragrance_free BOOLEAN,
    price_min_usd NUMERIC(10, 2),
    price_max_usd NUMERIC(10, 2),
    price_tier TEXT,
    markets TEXT[] NOT NULL DEFAULT '{}',
    product_url TEXT,
    image_url TEXT,
    embedding VECTOR(1536),
    embedding_model TEXT,
    source_updated_at TIMESTAMPTZ,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS catalog_products_embedding_hnsw
    ON catalog_products USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS catalog_products_markets_gin
    ON catalog_products USING gin (markets);

CREATE INDEX IF NOT EXISTS catalog_products_brand_name_idx
    ON catalog_products (brand, name);
