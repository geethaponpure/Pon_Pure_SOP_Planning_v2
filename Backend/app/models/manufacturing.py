from sqlalchemy import Column, BigInteger, Text, Double, DateTime, Index
from app.core.database import Base


# BIRawMaterialConsumptions is crm's copy of oracle's manufacturing consumption report
# (pure_mfg_consumptions_stg): every production job with the raw materials it used.
# crm rebuilds it in full every week (friday 02:00, plus the odd extra run) and keeps every run,
# so the crm table holds hundreds of copies. we load only the latest run (see SOURCE_FILTERS),
# as a snapshot. all segments, not just performance chemicals: the plant cycle time check needs
# the general chemicals and vooki jobs too.
#
# one row per job x output lot x raw material: a job with 30 output lots and 3 raw materials is
# 90 rows. so never SUM qty_consumed straight - take one row per (job, raw material, qty, value)
# first. output_quantity likewise repeats per raw material.
#
# known gap: a job only enters the report after an oracle-side event (usually within two weeks,
# some wait for a periodic sweep), and some closed bulk jobs at POI Alathur / PSM are missing.
# so "not in this table" means "not seen yet", not "never happened".


class BIRawMaterialConsumptions(Base):

    __tablename__ = "BIRawMaterialConsumptions"

    run_id = Column(BigInteger, primary_key=True, autoincrement=False)       # crm's row id, grows with every run
    creation_date = Column(DateTime)                                         # the run this row belongs to. one value per load
    syncdate = Column(DateTime)                                              # when crm read oracle
    mfg_item_code = Column(Text)                                             # what the job made. at psm often the packed item itself
    item_description = Column(Text)
    item_group = Column(Text)
    item_category = Column(Text)                                             # oracle segment1: Performance Chemicals / NPD / General Chemicals ...
    product_group = Column(Text)
    product_category = Column(Text)
    product_sub_category = Column(Text)
    uom = Column(Text)                                                       # unit of the made item
    output_quantity = Column(Double)                                         # output of this lot. negative on reversals
    job_number = Column(BigInteger, index=True)                              # the oracle wip job
    stock_age = Column(DateTime)                                             # job completion date (= creation date on most jobs)
    subinventory_code = Column(Text)
    lot_number = Column(Text)                                                # output lot. one row per lot per raw material
    inventory_org_code = Column(Text)                                        # the plant, e.g. 753
    inventory_org_name = Column(Text)                                        # e.g. PSM - Thervoykandigai MFG
    company_code = Column(Text)
    rw_item_code = Column(Text)                                              # the raw material consumed
    item_description_r = Column(Text)
    uom_r = Column(Text)
    qty_consumed = Column(Double)                                            # repeats per output lot, see above
    rate_per_unit = Column(Double)
    value_of_raw_material = Column(Double)

    __table_args__ = (
        Index("ix_birmc_org_item", "inventory_org_code", "mfg_item_code"),  # "was this item made at this plant"
    )
