from app.core.database import AsyncLocal



async def get_db():
    async with AsyncLocal() as session:
        yield session