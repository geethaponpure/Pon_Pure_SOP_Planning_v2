from sqlalchemy import Column, BigInteger, Integer, Text, Double, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


# InventoryOrgLocations: warehouse master. inventory_org_id is the key every fact table carries
# (orders, dispatch, schedules, pos, requisitions, stock), header_id is only crm's row id. upsert.
# BiStockDetail: daily on-hand stock per warehouse x item x sub-inventory x lot, accumulated since
# 2020 (31M rows in crm). loaded incremental by header_id in parallel pk ranges (LARGE_TABLES),
# performance chemicals from 2024 only.
#
#   BiStockDetail -> InventoryOrgLocations
#   BiStockDetail.item_code -> ItemMasters.item_code   (soft, item_code is not unique there)


class InventoryOrgLocations(Base):

    __tablename__ = "InventoryOrgLocations"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)    # crm row id. -1 = unknown
    inventory_org_id = Column(BigInteger, unique=True)                       # the oracle warehouse id children point at. -1 = unknown
    inventory_org_code = Column(Text)                                        # 051, 202 ..
    location_id = Column(BigInteger)                                         # InventoryOrgLocationMasters (city), not loaded. empty on 6%
    state_id = Column(Integer)                                               # 10 values, no master loaded
    collector_ids = Column(Text)                                             # comma separated collectors this warehouse serves, e.g. '1038,1039'. split in views
    creation_date = Column(DateTime)                                         # empty on 98%, crm back-filled the table
    last_update_date = Column(DateTime)

    stock = relationship("BiStockDetail", back_populates="warehouse")



class BiStockDetail(Base):

    __tablename__ = "BiStockDetail"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)    # monotonic with sync_date, the incremental key
    stock_id = Column(BigInteger, index=True)                                # oracle stock line id, new one every day
    sync_date = Column(DateTime)                                             # when crm pulled it
    trans_date = Column(Date, index=True)                                    # the snapshot day
    typeoftrx = Column(Text)                                                 # DailyBasics / FRIDAY / FIRST_DAY / JC_START_DATE, empty before 2023
    company_id = Column(Integer)
    operating_name = Column(Text)                                            # PPC / POI / PCT ..
    inventory_org_id = Column(BigInteger, ForeignKey("InventoryOrgLocations.inventory_org_id"), index=True)   # -1 when not in the master
    item_code = Column(Text, index=True)                                     # ItemMasters.item_code, soft link
    subinventory_code = Column(Text)                                         # SHED A / Quarantine / UNRECON ..
    lot_number = Column(Text)
    opening_qty = Column(Double)                                             # on hand that day
    item_cost = Column(Double)                                               # unit cost
    aging_date = Column(Date)                                                # lot receipt date, age = trans_date - aging_date

    warehouse = relationship("InventoryOrgLocations", back_populates="stock")
