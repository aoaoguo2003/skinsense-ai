from functools import lru_cache

from openai import AsyncOpenAI
from pydantic_settings import BaseSettings


class EmbeddingSettings(BaseSettings):
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache
def get_embedding_settings() -> EmbeddingSettings:
    return EmbeddingSettings()


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []

    settings = get_embedding_settings()
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY is required for product embeddings")

    client = AsyncOpenAI(api_key=settings.openai_api_key)
    response = await client.embeddings.create(
        model=settings.embedding_model,
        input=texts,
        dimensions=settings.embedding_dimensions,
    )
    return [item.embedding for item in sorted(response.data, key=lambda item: item.index)]
