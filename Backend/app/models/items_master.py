from sqlalchemy import Column, BigInteger, Text, Double, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base



#   ItemMasters -> ItemCategories        (one category row per item)
#   ItemMasters -> PurchaseRequisitionPtoPts   (many rows per item, month wise)


class ItemMasters(Base):

    __tablename__ = "ItemMasters"

    item_id = Column(BigInteger, primary_key=True, autoincrement=False)
    item_code = Column(Text, index=True)                  # sku code. not unique, 6 codes appear twice
    item_description = Column(Text)
    item_group = Column(Text)
    uom = Column(Text)
    uom_description = Column(Text)
    status = Column(Text)                                 # Active / Inactive
    enabled_flag = Column(Text)                           # Y / N (119 N). crm treats "active" as status = Active AND enabled_flag = Y
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    category = relationship("ItemCategories", back_populates="item", uselist=False)
    pto_pts = relationship("PurchaseRequisitionPtoPts", back_populates="item")



class ItemCategories(Base):

    __tablename__ = "ItemCategories"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    category_id = Column(BigInteger, nullable=False)      # segment combo id, 350 distinct, no master table for it
    segment1 = Column(Text)                               # division   e.g. Performance Chemicals
    segment2 = Column(Text)                               # business   e.g. Textile & Paper Division
    segment3 = Column(Text)                               # category
    segment4 = Column(Text)                               # family
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), nullable=False, unique=True)
                                                          # one row per item. 36 rows in crm point to deleted items, etl has to skip those
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    item = relationship("ItemMasters", back_populates="category")



class PurchaseRequisitionPtoPts(Base):

    __tablename__ = "PurchaseRequisitionPtoPts"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    itemid = Column(BigInteger, ForeignKey("ItemMasters.item_id"), nullable=False, index=True)
    itemcode = Column(Text, nullable=False)               # copy of ItemMasters.item_code, always same
    customercount = Column(BigInteger, nullable=False)    # distinct customers in the trailing 6 months of invoices
    overallsaleqty = Column(Double, nullable=False)       # qty sold in that window
    customersaleqty = Column(Double, nullable=False)      # qty taken by the single largest customer
    salepercentage = Column(Double, nullable=False)       # that customer's share, percent
    actiontypes = Column(Text, nullable=False)            # PTO / PTS. the class: < 5 customers or top share >= 70% -> PTO, else PTS
    types = Column(Text)                                  # PTO / PTS / PTS70% / PTS80% = finished goods pass, RPTO / RPTS / RPTS70% / RPTS80% = raw material pass. the % tags the threshold (80 before jul 2023)
    fromdate = Column(Date, nullable=False, index=True)   # month start, ~30 rows per item from jul 2020. may 2022 is missing in crm
    todate = Column(Date, nullable=False)                 # month end

    item = relationship("ItemMasters", back_populates="pto_pts")
