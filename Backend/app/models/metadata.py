from sqlalchemy import Column, String, BigInteger, Boolean, DateTime, Text, func
from app.core.database import Base


class crm_sync_table(Base):

    __tablename__ = "crm_sync_metadata"

    table_name = Column(String,primary_key=True)
    last_pk = Column(BigInteger)
    last_sync_at = Column(DateTime(timezone=True),server_default=func.now())
    rows_synced = Column(BigInteger,default=0)
    sync_status = Column(String(20),default="PENDING")
    error_message = Column(Text,nullable=True)