from sqlalchemy import Column, BigInteger, Integer, Text, Boolean, Double, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.database import Base


# InventoryOrgs: warehouse master, 186 rows. inventory_org_id is the key every fact table carries
# (orders, dispatch, schedules, pos, requisitions, stock). crm rewrites the table wholesale, so upsert.
# BiStockDetail: daily on-hand stock per warehouse x item x sub-inventory x lot, accumulated since
# 2020 (31M rows in crm). loaded incremental by header_id in parallel pk ranges (LARGE_TABLES),
# performance chemicals from 2024 only.
# ItemInventoryOrgMappings: which item may be stocked at which warehouse, one row per pair. the
# planning universe. rows get edited and deleted in crm, so snapshot. PC items only.
# BiCollectorInventoryOrgMapping: which warehouses a branch (collector) is configured to draw from.
# 422 pairs, only 60 of 129 collectors have one, so not the whole truth. snapshot.
#
#   InventoryOrgs -> Collectors                (home collector, the full mapping is BiCollectorInventoryOrgMapping)
#   BiStockDetail -> InventoryOrgs
#   BiStockDetail -> ItemMasters   (item_id is not in crm: derived on stage from item_code, latest id per code)
#   ItemInventoryOrgMappings -> ItemMasters, InventoryOrgs
#   BiCollectorInventoryOrgMapping -> Collectors, InventoryOrgs


class InventoryOrgs(Base):

    __tablename__ = "InventoryOrgs"

    inventory_org_id = Column(BigInteger, primary_key=True, autoincrement=False)   # the oracle warehouse id. -1 = unknown
    organization_id = Column(BigInteger)                                     # operating company, 101 on two thirds. no master loaded
    inventory_org_code = Column(Text)                                        # 101, 202, PMO .. unique
    inventory_org_name = Column(Text)                                        # PPC - Madhavaram ..
    city = Column(Text)
    state = Column(Text)
    is_active = Column(Boolean)                                              # 24 disabled, 4 of them still hold stock. don't filter on it
    disable_date = Column(DateTime)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)   # home collector, filled on 103. null when crm has 0
    is_mfg_orgs = Column(Integer)                                            # 1 = plant (14 rows). null = not set
    is_port = Column(Boolean)                                                # 38 port warehouses. null = not set
    is_methanol = Column(Boolean)                                            # 38. null = not set
    repackwh_enable = Column(Integer)                                        # 1 = repack warehouse (62). null = not set

    stock = relationship("BiStockDetail", back_populates="warehouse")
    collector = relationship("Collectors")



class BiStockDetail(Base):

    __tablename__ = "BiStockDetail"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)    # monotonic with sync_date, the incremental key
    stock_id = Column(BigInteger, index=True)                                # oracle stock line id, new one every day
    sync_date = Column(DateTime)                                             # when crm pulled it
    trans_date = Column(Date, index=True)                                    # the snapshot day
    typeoftrx = Column(Text)                                                 # DailyBasics / FRIDAY / FIRST_DAY / JC_START_DATE, empty before 2023
    company_id = Column(Integer)
    operating_name = Column(Text)                                            # PPC / POI / PCT ..
    inventory_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), index=True)   # -1 when not in the master
    item_code = Column(Text, index=True)                                     # the only item key crm gives here
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)   # not in crm. filled on stage from item_code (DERIVED_COLUMNS), -1 when no match
    subinventory_code = Column(Text)                                         # SHED A / Quarantine / UNRECON ..
    lot_number = Column(Text)
    opening_qty = Column(Double)                                             # on hand that day
    item_cost = Column(Double)                                               # unit cost
    aging_date = Column(Date)                                                # lot receipt date, age = trans_date - aging_date

    warehouse = relationship("InventoryOrgs", back_populates="stock")
    item = relationship("ItemMasters")



class ItemInventoryOrgMappings(Base):

    __tablename__ = "ItemInventoryOrgMappings"
    __table_args__ = (UniqueConstraint("item_id", "inventory_org_id"),)     # the natural key. one duplicate pair in crm is dropped on stage

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), nullable=False, index=True)          # 100% match. -1 if ever missing
    inventory_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), nullable=False, index=True)   # 177 of 186 warehouses appear. -1 if ever missing
    enabled_flag = Column(Text)                                              # Y / N. N = item may not be stocked here (641 rows)
    internal_order_enabled_flag = Column(Text)                               # Y / N. N = no stock transfer into this warehouse for the item (9%). 14 null
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # the flags do get toggled, ~1,400 rows a month

    item = relationship("ItemMasters")
    warehouse = relationship("InventoryOrgs")



class BiCollectorInventoryOrgMapping(Base):

    __tablename__ = "BiCollectorInventoryOrgMapping"
    __table_args__ = (UniqueConstraint("collector_id", "inventory_org_id"),)   # crm re-inserts pairs without closing the old row, 74 copies dropped on stage

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), nullable=False, index=True)           # 100% match. row dropped if ever missing
    inventory_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), nullable=False, index=True)   # 100% match. row dropped if ever missing
    startdate = Column(DateTime)                                             # since when the warehouse serves the branch. 1 null
    enddate = Column(DateTime)                                               # set on 1 row only, mappings are never closed
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    collector = relationship("Collectors")
    warehouse = relationship("InventoryOrgs")
