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
    customercount = Column(BigInteger, nullable=False)
    overallsaleqty = Column(Double, nullable=False)
    customersaleqty = Column(Double, nullable=False)
    salepercentage = Column(Double, nullable=False)
    actiontypes = Column(Text, nullable=False)            # PTO / PTS
    fromdate = Column(Date, nullable=False, index=True)   # month start, ~30 rows per item from jul 2020
    todate = Column(Date, nullable=False)                 # month end

    item = relationship("ItemMasters", back_populates="pto_pts")
