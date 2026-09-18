from sqlalchemy import Column, BigInteger, Text, Boolean, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


# Dispatches, Schedules, DispatchDetails are snapshot tables: performance chemicals from 2021 only,
# wiped and reloaded every run. their fk columns are nullable because a row can arrive minutes
# before its parent lands, the loader blanks the fk and the next run fixes it.
# SocCancelDetails is incremental by header_id, rows never change after creation.
#
#   SaleOrderDtls -> Schedules (planned dispatch per line) -> DispatchDetails (what shipped)
#   SaleOrderDtls -> SocCancelDetails (cancelled / closed lines)
#   Dispatches (note / invoice) -> DispatchDetails
#   Dispatches / Schedules -> SaleOrderHdrs, CustomerMasters, Collectors, CustomerSites


class DeliveryFroms(Base):

    __tablename__ = "DeliveryFroms"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)      # -1 = unknown
    name = Column(Text, nullable=False)                                      # Kandla, Vizag, Ennore ..
    is_active = Column(Boolean)                                              # all true today
    location_id = Column(BigInteger, nullable=False)                         # CompanyLocations id, not loaded
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    order_lines = relationship("SaleOrderDtls", back_populates="delivery_from")



class Dispatches(Base):

    __tablename__ = "Dispatches"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), index=True)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)
    bill_to_customer_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), index=True)
    ship_to_customer_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), index=True)   # where it went
    sale_order_header_id = Column(BigInteger, ForeignKey("SaleOrderHdrs.header_id"), index=True)
    despatch_status_id = Column(BigInteger)                                  # 1 Pending / 3 MoveToOracle / 4 InvoiceCancel
    currency = Column(Text)                                                  # INR / USD / EUR
    sum_of_despatch_quantity = Column(Numeric(18, 2), nullable=False)        # header total, matches detail sum on 98.6%
    inventory_org_id = Column(BigInteger)                                    # shipping warehouse
    trx_number = Column(Text, index=True)                                    # oracle invoice number, empty till invoiced
    trx_date = Column(Date, index=True)                                      # invoice date
    sum_of_despatch_value = Column(Numeric(18, 5))
    trans_type_name = Column(Text)                                           # Taxable / Stock Transfer / Sample ..
    oracle_status = Column(Text)                                             # CANCELLED or empty. second cancel signal, no overlap with status 4
    cancel_reason = Column(Text)                                             # Credit Issue / Wrong Billing Date / Wrong Tax Calculation
    despatch_confirm_date = Column(DateTime)                                 # when the branch confirmed it
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    details = relationship("DispatchDetails", back_populates="dispatch")
    order = relationship("SaleOrderHdrs")
    customer = relationship("CustomerMasters")
    collector = relationship("Collectors")
    bill_to_site = relationship("CustomerSites", foreign_keys=[bill_to_customer_site_id])
    ship_to_site = relationship("CustomerSites", foreign_keys=[ship_to_customer_site_id])



class Schedules(Base):

    __tablename__ = "Schedules"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    sale_order_header_id = Column(BigInteger, ForeignKey("SaleOrderHdrs.header_id"), index=True)
    sale_order_detail_line_id = Column(BigInteger, ForeignKey("SaleOrderDtls.line_id"), index=True)   # ~1 schedule per line
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)     # same as the order line
    sale_category = Column(Text)                                             # Intact / Repack / Bulk
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), index=True)
    schedule_date = Column(Date, index=True)                                 # planned dispatch date, junk year nulled
    reschedule_date = Column(Date)                                           # differs from schedule_date on 18%
    reschedule_reason = Column(Text)                                         # Customer Requested / Stock Not Available ..
    inventory_org_id = Column(BigInteger, nullable=False)                    # planned shipping warehouse
    customer_requested_date = Column(Date)                                   # what the customer asked for
    schedule_quantity = Column(Numeric(18, 2), nullable=False)
    bill_to_customer_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), index=True)
    ship_to_customer_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), index=True)
    schedule_status_id = Column(BigInteger, nullable=False)                  # 1 Pending / 3 Reject / 4 Confirmed / 5 Closed / 6 SOCConfirmed / 7 Cancelled. not a clean open flag
    confirm_status_id = Column(BigInteger, nullable=False)                   # 0 / 1
    order_quantity = Column(Numeric(18, 2), nullable=False)                  # line qty at schedule time
    backtoback_enable = Column(Boolean)
    unit_price = Column(Numeric(18, 5))
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # 42% of rows get edited later
    request_type = Column(Text)                                              # CRM / WMS, empty on old rows

    dispatches = relationship("DispatchDetails", back_populates="schedule")
    order = relationship("SaleOrderHdrs")
    order_line = relationship("SaleOrderDtls")
    item = relationship("ItemMasters")
    customer = relationship("CustomerMasters")
    bill_to_site = relationship("CustomerSites", foreign_keys=[bill_to_customer_site_id])
    ship_to_site = relationship("CustomerSites", foreign_keys=[ship_to_customer_site_id])


class SocCancelDetails(Base):

    __tablename__ = "SocCancelDetails"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    sale_order_header_id = Column(BigInteger, ForeignKey("SaleOrderHdrs.header_id"), nullable=False, index=True)
    sale_order_detail_line_id = Column(BigInteger, ForeignKey("SaleOrderDtls.line_id"), nullable=False, index=True)   # the line being cancelled
    schedule_line_id = Column(BigInteger, nullable=False)                    # reference only, schedule is often deleted after the cancel (60% match)
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), nullable=False, index=True)
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), nullable=False, index=True)
    inventory_org_id = Column(BigInteger, nullable=False)
    sale_category = Column(Text)                                             # Intact / Repack / Bulk ..
    schedule_date = Column(Date)                                             # the schedule that got cancelled
    schedule_quantity = Column(Numeric(18, 2), nullable=False)
    shipped_quantity = Column(Numeric(18, 2), nullable=False)                # already gone before the cancel
    remaining_quantity = Column(Numeric(18, 2), nullable=False)              # the cancelled qty
    close_reason_id = Column(BigInteger, nullable=False)                     # reason code, no master in crm. 19 / 74 / 72 / 73 cover 92%
    status_id = Column(BigInteger, nullable=False)                           # workflow status code, no master in crm. 6 is 92%
    approved_action_date = Column(DateTime)                                  # when the cancel was approved
    comment = Column(Text)                                                   # free text reason
    creation_date = Column(DateTime, index=True)                             # the cancellation date

    order = relationship("SaleOrderHdrs")
    order_line = relationship("SaleOrderDtls")
    item = relationship("ItemMasters")
    customer = relationship("CustomerMasters")


class DispatchDetails(Base):

    __tablename__ = "DispatchDetails"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("Dispatches.header_id"), index=True)   # dispatch note
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)    # item actually shipped, differs from order line on 7%
    uom = Column(Text)                                                       # KG / EA / BOX
    sale_quantity = Column(Numeric(18, 2), nullable=False)                   # dispatched qty
    unit_price = Column(Numeric(18, 5), nullable=False)
    schedule_date = Column(Date, index=True)                                 # the dispatch date. time part dropped, junk year nulled
    sale_category = Column(Text)                                             # Intact / Repack / Bulk / E-Commerce
    packing_cost = Column(Numeric(18, 2), nullable=False)
    inventory_org_id = Column(BigInteger)                                    # shipping warehouse
    sale_order_header_id = Column(BigInteger, ForeignKey("SaleOrderHdrs.header_id"), index=True)
    sale_order_detail_line_id = Column(BigInteger, ForeignKey("SaleOrderDtls.line_id"), index=True)
    schedule_line_id = Column(BigInteger, ForeignKey("Schedules.line_id"), index=True)     # the schedule this dispatch fulfils
    schedule_quantity = Column(Numeric(18, 2), nullable=False)               # what was scheduled, differs from sale_quantity on 8%
    tolerance_quantity = Column(Numeric(18, 2), nullable=False)              # always 0 today
    trading_manufacture = Column(Text)                                       # Manufacturing / Trading
    tax_percentage = Column(Numeric(18, 2))
    total_value = Column(Numeric(18, 5))                                     # dispatch value
    item_segment = Column(Text)                                              # always Performance Chemicals after the filter
    creation_date = Column(DateTime)                                         # empty on pre 2020 history
    last_update_date = Column(DateTime)                                      # half the rows get edited later (billing)

    dispatch = relationship("Dispatches", back_populates="details")
    schedule = relationship("Schedules", back_populates="dispatches")
    order = relationship("SaleOrderHdrs")
    order_line = relationship("SaleOrderDtls")
    item = relationship("ItemMasters")
