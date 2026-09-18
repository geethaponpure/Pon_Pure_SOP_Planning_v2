from sqlalchemy import Column, BigInteger, Integer, Text, Boolean, Numeric, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


# QuotationHdrs / QuotationDtls are snapshot tables: performance chemicals lines from 2021 and the
# headers they point at, wiped and reloaded every run because the status moves after creation.
# fk columns are nullable because a row can arrive before its parent lands, the loader blanks
# the fk and the next run fixes it. QuotationStatus is a 21 row lookup, incremental.
#
#   QuotationHdrs -> QuotationDtls
#   QuotationHdrs -> Collectors, CustomerMasters, CustomerSites, MarketCircles, QuotationStatus
#   QuotationDtls -> ItemMasters, DeliveryFroms, QuotationStatus
#   every SaleOrderHdrs points at a QuotationHdrs (quotation_line_id), soft link - orders are not
#   filtered to performance chemicals but quotes are, so no fk


class QuotationStatus(Base):

    __tablename__ = "QuotationStatus"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    name = Column(Text)                                                      # Open / Approved / Confirmed / Closed ..
    description = Column(Text)
    is_active = Column(Boolean, nullable=False)                              # all true today



class QuotationHdrs(Base):

    __tablename__ = "QuotationHdrs"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    quotation_number = Column(Text)                                          # PPC/2025-26/103315
    quotation_date = Column(DateTime, index=True)
    company_id = Column(BigInteger, nullable=False)                          # operating unit, same ids as organization_id on orders
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), index=True)   # -1 when crm has 0
    bill_to_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), index=True)   # -1 when crm has 0
    ship_to_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), index=True)   # -1 when crm has 0
    status_id = Column(BigInteger, ForeignKey("QuotationStatus.line_id"), index=True)   # 96% Closed, Open / Approved / Confirmed = pipeline
    close_status_id = Column(BigInteger, nullable=False)                     # 0 / 1 / 2, no master
    trans_type_name = Column(Text)                                           # Taxable / Stock Transfer / Sample / Export ..
    is_back_to_back_order = Column(Boolean, nullable=False)
    quote_creation_type = Column(Integer, nullable=False)                    # 1 / 2
    currency_type = Column(Text)                                             # INR / USD / EUR
    conversion_rate = Column(Numeric(18, 5))
    mc_code = Column(Text, ForeignKey("MarketCircles.mc_code"), index=True)  # lower case, 'unknown' when blank
    is_prequote = Column(Boolean)
    revised_count = Column(Integer, nullable=False)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    lines = relationship("QuotationDtls", back_populates="quote")
    status = relationship("QuotationStatus")
    collector = relationship("Collectors")
    customer = relationship("CustomerMasters")
    circle = relationship("MarketCircles")
    bill_to_site = relationship("CustomerSites", foreign_keys=[bill_to_site_id])
    ship_to_site = relationship("CustomerSites", foreign_keys=[ship_to_site_id])



class QuotationDtls(Base):

    __tablename__ = "QuotationDtls"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)      # SaleOrderDtls.quotationdtl_line_id points here, 90%, soft
    header_id = Column(BigInteger, ForeignKey("QuotationHdrs.header_id"), index=True)
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)
    uom_code = Column(Text)                                                  # KG / EA / BOX
    quantity = Column(Numeric(18, 2), nullable=False)
    unit_price = Column(Numeric(18, 5), nullable=False)
    total_sales_price = Column(Numeric(18, 5), nullable=False)
    discount_percentage = Column(Numeric(18, 2), nullable=False)             # 0 / 5 / 10
    discount_value = Column(Numeric(18, 2), nullable=False)
    tax_percentage = Column(Numeric(18, 2), nullable=False)
    delivery_from_id = Column(BigInteger, ForeignKey("DeliveryFroms.line_id"), index=True)   # -1 when crm has 0
    sale_category = Column(Text)                                             # Intact / Repack / Bulk
    inventory_org_id = Column(BigInteger, nullable=False)                    # warehouse
    delivery_date = Column(DateTime)                                         # 1 junk row nulled
    status_id = Column(BigInteger, ForeignKey("QuotationStatus.line_id"), index=True)   # null when crm has 0
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    quote = relationship("QuotationHdrs", back_populates="lines")
    item = relationship("ItemMasters")
    status = relationship("QuotationStatus")
    delivery_from = relationship("DeliveryFroms")
