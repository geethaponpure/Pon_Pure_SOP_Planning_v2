from sqlalchemy import Column, BigInteger, Text, Boolean, Numeric, Double, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


# same rules as the other model files. SocPendingDetails is a snapshot table, pk is ours.
#
#   SaleOrderHdrs -> SaleOrderDtls
#   SaleOrderHdrs <- SocPendingDetails (order_no)


class SaleOrderHdrs(Base):

    __tablename__ = "SaleOrderHdrs"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    quotation_line_id = Column(BigInteger, nullable=False, index=True)       # fk to QuotationHdrs once that category is in
    quotation_number = Column(Text)
    quotation_date = Column(DateTime, nullable=False)                        # has junk values (0001, 2027), use po_received_date
    organization_id = Column(BigInteger, nullable=False)                     # operating unit, 10 of them
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), nullable=False, index=True)
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), nullable=False, index=True)
    bill_to_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), nullable=False, index=True)
    ship_to_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), nullable=False, index=True)
    is_back_to_back_order = Column(Boolean)
    cust_acct_site_id = Column(BigInteger, nullable=False, index=True)       # CustomerSites.cust_acct_site_id, not unique there so no fk
    trans_type_name = Column(Text)                                           # Taxable / Stock Transfer / Sample / Export ..
    currency = Column(Text)
    customer_po_ref = Column(Text)
    customer_po_date = Column(DateTime, nullable=False)
    po_received_date = Column(DateTime, nullable=False, index=True)
    trading_manufacture = Column(Text)                                       # Manufacturing / Trading
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    lines = relationship("SaleOrderDtls", back_populates="order")
    pending = relationship("SocPendingDetails", back_populates="order")
    collector = relationship("Collectors")
    customer = relationship("CustomerMasters")
    bill_to_site = relationship("CustomerSites", foreign_keys=[bill_to_site_id])
    ship_to_site = relationship("CustomerSites", foreign_keys=[ship_to_site_id])



class SaleOrderDtls(Base):

    __tablename__ = "SaleOrderDtls"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("SaleOrderHdrs.header_id"), nullable=False, index=True)
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), nullable=False, index=True)
    uom_code = Column(Text)                                                  # Kgs / Liter / Nos
    quantity = Column(Numeric(18, 2), nullable=False)
    unit_price = Column(Numeric(18, 5), nullable=False)
    discount_percentage = Column(Numeric(18, 2), nullable=False)
    total_sales_price = Column(Numeric(18, 5), nullable=False)
    delivery_from_id = Column(BigInteger, nullable=False)
    sale_category = Column(Text)                                             # Intact / Repack / Bulk
    delivery_date = Column(DateTime)
    inventory_org_id = Column(BigInteger, nullable=False)                    # which warehouse serves it
    item_group = Column(Text)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # 99% empty, crm never updates lines
    status = Column(Text)                                                    # OPEN / Closed, informational only
    quotationdtl_line_id = Column(BigInteger, nullable=False)                # fk to QuotationDtls once that category is in

    order = relationship("SaleOrderHdrs", back_populates="lines")
    item = relationship("ItemMasters")



class SocPendingDetails(Base):

    __tablename__ = "SocPendingDetails"

    id = Column(BigInteger, primary_key=True)                                # ours, restarts every load. not in TABLES_COLUMNS
    quotation_id = Column(BigInteger)                                        # SaleOrderHdrs.quotation_line_id
    order_no = Column(BigInteger, ForeignKey("SaleOrderHdrs.header_id"), index=True)
    order_date = Column(Date)
    schedule_date = Column(Date)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)
    customer_number = Column(BigInteger, ForeignKey("CustomerMasters.customer_number"), index=True)
    category = Column(Text)                                                  # Intact / Repack / Bulk / E-Commerce
    transaction_type = Column(Text)
    itemcode = Column(Text, index=True)                                      # ItemMasters.item_code, not unique there so no fk
    uom = Column(Text)
    total_quantity = Column(Double)
    scheduled_qty = Column(Double)
    despatched_qty = Column(Double)
    balance_qty = Column(Double)                                             # the open book
    unitprice = Column(Double)
    totalsaleprice = Column(Double)
    customer_req_date = Column(Date)
    inventory_org_code = Column(Text)
    market_circle = Column(Text, ForeignKey("MarketCircles.mc_code"), index=True)   # 'unknown' when blank
    syncdate = Column(DateTime)                                              # when crm generated this snapshot
    dispatch_per = Column(Double)
    reschedule_date = Column(DateTime)
    reschedule_reason = Column(Text)                                         # Customer Requested / Stock Not Available ..

    order = relationship("SaleOrderHdrs", back_populates="pending")
    collector = relationship("Collectors")
    customer = relationship("CustomerMasters")
    circle = relationship("MarketCircles")
