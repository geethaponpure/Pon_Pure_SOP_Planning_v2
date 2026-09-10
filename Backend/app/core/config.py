from pydantic_settings import BaseSettings, SettingsConfigDict
from ipaddress import IPv4Address
from pathlib import Path


class Setting(BaseSettings):

    # CRM Credentials
    CRM_DB_DRIVER: str
    CRM_DB_SERVER: IPv4Address
    CRM_DB_PORT:int
    CRM_DB_NAME: str
    CRM_DB_USER: str
    CRM_DB_PASSWORD: str
    CRM_DB_TRUSTED_CONNECTION:str
    CRM_TABLES: list[str]

    #Postgress
    POSTGRES_HOST: str  # hostname or IP - "localhost" is not an IPv4Address
    POSTGRES_PORT: str
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str

    DB_TIMEOUT:int = 120


    model_config = SettingsConfigDict(
    env_file=Path(__file__).resolve().parents[3] / ".env",
    env_file_encoding="utf-8",
    )


settings = Setting()