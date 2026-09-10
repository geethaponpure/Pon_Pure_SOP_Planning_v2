import pandas as pd
import psycopg2
import pyodbc
from app.core.config import settings



def get_sql_server_connection():
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
    return pyodbc.connect(sql_url)



def get_postgres_connection():
    """This function is use to establish connection to Postgress DB"""

    psg_conn = psycopg2.connect(
                                host=settings.POSTGRES_HOST,
                                port=settings.POSTGRES_PORT,
                                database=settings.POSTGRES_DB,
                                user=settings.POSTGRES_USER,
                                password=settings.POSTGRES_PASSWORD)
    return psg_conn