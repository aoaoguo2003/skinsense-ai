import asyncio

from services.product_rag import initialize_schema


async def main() -> None:
    await initialize_schema()
    print("Product RAG schema initialized.")


if __name__ == "__main__":
    asyncio.run(main())
