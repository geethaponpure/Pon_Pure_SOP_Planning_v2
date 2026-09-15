from fastapi import FastAPI
from .core.database import Base, get_db, engine
from .models.metadata import crm_sync_table
from .models.customer_master import CustomerMasters, CustomerSites, Collectors, MarketCircles
from .models.items_master import ItemCategories, ItemMasters, PurchaseRequisitionPtoPts
from contextlib import asynccontextmanager
from .core.config import settings
from sqlalchemy import text



@asynccontextmanager
async def lifespan(app:FastAPI):

    print("Application starting.......................")

    async with engine.begin() as conn:

        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.POSTGRES_SCHEMA}"'))

        await conn.execute(text(f'SET search_path TO "{settings.POSTGRES_SCHEMA}"'))

        await conn.run_sync(Base.metadata.create_all)

    yield

    await engine.dispose()
    print("Application closing.........................")
    


app = FastAPI(lifespan=lifespan)