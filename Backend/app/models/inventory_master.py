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
#   LotSubinventoryRestriction     crm's own not-for-sale list of sub-inventories (no fk, matched by code)
#   CriticalStockConfigs           crm's aged-stock thresholds per segment (no fk, matched by segment name)
#   CriticalStocks -> CustomerMasters (by header_id, NOT customer_id), Collectors


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
    whapproval_planner_enable = Column(Boolean)                              # the warehouse's approvals go through a planner

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



class LotSubinventoryRestriction(Base):

    __tablename__ = "LotSubinventoryRestriction"

    # crm's own list of sub-inventories whose stock may not be sold. its stock check and mobile stock
    # views apply it as subinventory_code NOT IN (...). still maintained: codes are added as recently as 2026.
    # two traps. crm keeps case variants (LOSS / Loss, PKG-CUST / PKG-Cust) that sql server treats as one
    # code, so match it case-insensitively or it will not reproduce crm. and one row's code is a sentence
    # someone typed instead of deleting the row ("MKT B2B- This was removed ...") - it matches nothing.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    sub_inv_code = Column(Text)                                              # OSP / NO SALE / Quarantine / Return ..
    creation_date = Column(DateTime)                                         # when the code was added to the list



class CriticalStockConfigs(Base):

    __tablename__ = "CriticalStockConfigs"

    # crm's thresholds for its aged-stock process, per segment: stock older than asd days AND worth more
    # than total_stock_value is "critical". matched to CriticalStocks by segment NAME, not id.
    # one segment3 carries a trailing newline ("Fine Chemicals\n"), so always compare trimmed.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    asd = Column(Double)                                                     # age threshold in days, 60 everywhere today
    total_stock_value = Column(Double)                                       # value floor in rupees, 50k to 3 lakh
    segment3 = Column(Text)                                                  # the segment, e.g. Textile Pure / PURIT
    segment4 = Column(Text)                                                  # sub-segment, set on the LMA / PURIT / Turtle Wax rows
    is_active = Column(Boolean)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)



class CriticalStocks(Base):

    __tablename__ = "CriticalStocks"

    # crm's aged-stock workflow: one run per cycle, one row per customer x branch x PRODUCT NAME whose
    # stock has sat too long. the owners (technical executive, business head) write remarks and commit
    # to deadlines. performance chemicals only, since jul 2022. snapshot: rows are edited as owners respond.
    #
    # there is NO item id. the product is item_description, the same name grain as the business plan
    # (one name covers several pack sizes), so join it on lower(trim(item_description)) = name_key.
    # values are in LAKHS, not rupees.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    acc_year = Column(Text, index=True)                                      # the run's accounting year
    jc_type = Column(Text, index=True)                                       # the run's cycle, JC1 .. JC13. (acc_year, jc_type) = one run
    type = Column(Text)
    is_new_customer = Column(Boolean)
    is_temp_customer = Column(Boolean)
    customer_hdr_id = Column(BigInteger, ForeignKey("CustomerMasters.header_id"), index=True)   # crm's internal customer row, NOT the oracle customer_id
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)
    mc_code = Column(Text)                                                   # market circle
    category_id = Column(BigInteger)                                         # item category. many items share one, so not an item key
    segment2 = Column(Text)                                                  # division
    segment3 = Column(Text)                                                  # segment, matches CriticalStockConfigs.segment3
    segment4 = Column(Text)
    item_description = Column(Text)                                          # the product NAME. the only product key on this table
    critical_stock_qty = Column(Double)
    critical_stock_value = Column(Double)                                    # lakhs. the PRODUCT's figure, company-wide, repeated on every branch/customer row
    avg_price = Column(Double)
    target_qty = Column(Double)                                              # what the owners committed to clear
    target_value = Column(Double)                                            # lakhs
    avg_sales = Column(Double)
    stock_days = Column(Integer)                                             # days of cover at the average sales rate
    avg_cost = Column(Double)
    current_jc_qty = Column(Double)
    current_jc_value = Column(Double)
    difference = Column(Double)
    deadline_target_date = Column(DateTime)
    diff_type = Column(Text)
    te_remarks = Column(Text)                                                # technical executive's remarks
    bh_remarks = Column(Text)                                                # business head's remarks
    status_id = Column(Integer)
    is_saved = Column(Boolean)
    asd = Column(Double)                                                     # the row's MEASURED stock days (= stock_days), not the threshold - that is in CriticalStockConfigs
    total_stock_value = Column(Double)                                       # duplicates critical_stock_value, lakhs
    te_id = Column(BigInteger)
    bh_id = Column(BigInteger)
    creation_date = Column(DateTime)                                         # when the run wrote the row
    last_update_date = Column(DateTime)
    jc1_deadline_target_date = Column(DateTime)
    jc2_deadline_target_date = Column(DateTime)
    jc3_deadline_target_date = Column(DateTime)
    jc4_deadline_target_date = Column(DateTime)
    jc5_deadline_target_date = Column(DateTime)
    jc6_deadline_target_date = Column(DateTime)
    jc7_deadline_target_date = Column(DateTime)
    jc8_deadline_target_date = Column(DateTime)
    jc9_deadline_target_date = Column(DateTime)
    jc10_deadline_target_date = Column(DateTime)
    jc11_deadline_target_date = Column(DateTime)
    jc12_deadline_target_date = Column(DateTime)
    jc13_deadline_target_date = Column(DateTime)
    qgreater90 = Column(Double)                                              # quantity older than 90 days
    vgreater90 = Column(Double)                                              # value older than 90 days, lakhs
    billtositeid = Column(BigInteger)

    customer = relationship("CustomerMasters")
    collector = relationship("Collectors")
