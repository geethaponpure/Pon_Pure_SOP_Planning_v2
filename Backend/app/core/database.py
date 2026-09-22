import pandas as pd
import psycopg2
import pyodbc
from .config import settings
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import MetaData, URL


metadata = MetaData(schema=settings.POSTGRES_SCHEMA)

class Base(DeclarativeBase):
    metadata = metadata


from sqlalchemy.engine import URL

psg_async_url = URL.create(
    drivername="postgresql+asyncpg",
    username=settings.POSTGRES_USER,
    password=settings.POSTGRES_PASSWORD,
    host=settings.POSTGRES_HOST,
    port=settings.POSTGRES_PORT,
    database=settings.POSTGRES_DB,
)


engine = create_async_engine(url=psg_async_url,echo=True,future=True)

AsyncLocal = async_sessionmaker(bind=engine,class_=AsyncSession,expire_on_commit=False)


async def get_db():
    async with AsyncLocal() as session:
        yield session



def get_sql_server_cursor():
    """This function is use to establish connection to MYSQL DB {CRM}"""
    sql_url = (
        f"DRIVER={settings.CRM_DB_DRIVER};"
        f"SERVER={settings.CRM_DB_SERVER},{settings.CRM_DB_PORT};"
        f"DATABASE={settings.CRM_DB_NAME};"
        f"UID={settings.CRM_DB_USER};"
        f"PWD={settings.CRM_DB_PASSWORD};"
        "Trusted_Connection=no;"
        "TrustServerCertificate=yes;"
    )

    sql_conn = pyodbc.connect(sql_url)
    return sql_conn, sql_conn.cursor()



def get_postgres_cursor():
    """This function is use to establish connection to Postgress DB"""

    psg_conn = psycopg2.connect(
                                host=settings.POSTGRES_HOST,
                                port=settings.POSTGRES_PORT,
                                database=settings.POSTGRES_DB,
                                user=settings.POSTGRES_USER,
                                password=settings.POSTGRES_PASSWORD)

    psg_cur = psg_conn.cursor()

    psg_cur.execute(
        f'SET search_path TO "{settings.POSTGRES_SCHEMA}"'
    )
    
    psg_cur.execute(f"SET lock_timeout = '{settings.PG_LOCK_TIMEOUT}'")

    return psg_conn,psg_cur 