from sqlalchemy import Column, BigInteger, Text, Boolean, Numeric, Double, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


# BiPoDetails is an oracle purchase order extract that crm regenerates every night (one sync_date,
# header_id restarts from 1). loaded as a snapshot with our own id, performance chemicals only.
#
#   PurchaseRequisitionHdrs -> PurchaseRequisitionDtls   (what was asked for)
#   BiPoDetails -> ItemMasters                             (what oracle actually ordered)
#   BiPoDetails / PurchaseRequisitionHdrs -> ApSuppliers   (vendor master)
#   PurchaseRequisitionDtls.po_line_id -> BiPoDetails.po_line_id   (soft, po_line_id is not unique)


class ApSuppliers(Base):

    __tablename__ = "ApSuppliers"

    # oracle vendor master, 24k rows of which only ~3k are ever used by a po or requisition.
    # the rest are employees, transporters, tax authorities - vendor_type_lookup_code tells them apart.
    # upsert: rows are edited (msme status, holds).

    vendor_id = Column(BigInteger, primary_key=True, autoincrement=False)
    vendor_name = Column(Text)
    segment1 = Column(Text)                                                  # oracle vendor number, = BiPoDetails.vendor_number
    vendor_type_lookup_code = Column(Text, index=True)                       # SUPPLIER / EMPLOYEE / TRANSPORTER / CONTRACTOR / CAPITAL .. 24 values
    pay_group_lookup_code = Column(Text)                                     # SUPPLIER / TRANSPORTER / EMPLOYEE, empty on 86%
    terms_id = Column(Double)                                                # payment terms id, oracle stores it as float. cast in views
    start_date_active = Column(DateTime)
    end_date_active = Column(DateTime)                                       # set on 23% = inactive vendor
    attribute8 = Column(Text)                                                # msme registered YES / NO
    attribute9 = Column(Text)                                                # msme class Micro / Small / Medium
    attribute10 = Column(Text)                                               # msme type Manufacturing / Services / Trading
    attribute11 = Column(Text)                                               # udyam registration number
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    purchase_orders = relationship("BiPoDetails", back_populates="vendor")
    requisitions = relationship("PurchaseRequisitionHdrs", back_populates="supplier")



class BiPoDetails(Base):

    __tablename__ = "BiPoDetails"

    id = Column(BigInteger, primary_key=True)                                # ours, restarts every load. not in TABLES_COLUMNS
    sync_date = Column(DateTime)                                             # when crm read oracle
    po_header_id = Column(BigInteger, index=True)                            # oracle po header
    po_number = Column(Text)                                                 # 104048
    po_line_id = Column(BigInteger, index=True)                              # oracle po line. PurchaseRequisitionDtls.po_line_id points here. 402 dups, no unique
    line_num = Column(BigInteger)
    po_date = Column(Date, index=True)
    company_id = Column(BigInteger)                                          # operating unit
    company_code = Column(Text)                                              # PPC / PSM / POI ..
    vendor_id = Column(BigInteger, ForeignKey("ApSuppliers.vendor_id"), index=True)
    vendor_name = Column(Text)
    vendor_site_id = Column(BigInteger)
    ship_to_location_id = Column(BigInteger)
    inv_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), index=True)   # receiving warehouse. -1 if not in the master
    procurement_type = Column(Text)                                          # Domestic / Market / Import Procurement / Packing Materials. the reliable classifier
    purchase_category = Column(Text)                                         # Market-Packed / Domestic-Bulk .. '0' on old pos
    inventory_item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)
    uom = Column(Text)                                                       # Kilogram / Each / Litre
    unit_price = Column(Double)
    quantity = Column(Double)                                                # ordered
    quantity_received = Column(Double)
    quantity_cancelled = Column(Double)
    quantity_billed = Column(Double)
    line_amount = Column(Double)                                             # pending = greatest(quantity - received - cancelled, 0). 8% are over-received

    item = relationship("ItemMasters")
    vendor = relationship("ApSuppliers", back_populates="purchase_orders")
    warehouse = relationship("InventoryOrgs")



class PurchaseRequisitionHdrs(Base):

    __tablename__ = "PurchaseRequisitionHdrs"

    # requisitions raised in crm since 2020, ~4.5k a year, all performance chemicals. snapshot,
    # status moves after creation. quantities and items sit on the detail table.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    operating_unit = Column(BigInteger, nullable=False)
    requester = Column(Text)                                                 # planner name, 34 of them
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)   # empty on 48%: raised centrally, crm has 0
    supplier_id = Column(BigInteger, ForeignKey("ApSuppliers.vendor_id"), index=True)   # 0 on 178 unfinished drafts -> null
    supplier_site_id = Column(BigInteger)
    type = Column(Text)                                                      # Domestic / Import
    purchase_category = Column(Text)                                         # Domestic Procurement / Import Procurement DFF / Market Procurement ..
    category = Column(Text)                                                  # division, e.g. Textile & Paper Division
    business = Column(Text)                                                  # e.g. Textile / Water Treatment / Paints & Coatings
    business_division = Column(Text)                                         # Capital / Service / Speciality
    currency = Column(Text)                                                  # INR / USD / EURO
    conversion_type = Column(Numeric(18, 2), nullable=False)                 # misnamed in crm: it is the conversion rate, 0 on domestic rows
    payment_term_id = Column(BigInteger, nullable=False)
    payment_term = Column(Text)
    deliverytermid = Column(Text)                                            # CFR / CIF / FOB on imports
    ship_to_inv_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), nullable=False, index=True)   # receiving warehouse. -1 if not in the master
    bill_to_inv_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), nullable=False, index=True)
    status_id = Column(BigInteger, nullable=False)                           # 0 .. 7, no master in crm. 6 = approved (91%), 7 = rejected, 0 = draft
    record_submit = Column(Text)                                             # Y / N / R
    isconfirmed = Column(Boolean)
    creation_date = Column(DateTime, index=True)
    last_update_date = Column(DateTime)

    lines = relationship("PurchaseRequisitionDtls", back_populates="header")
    collector = relationship("Collectors")
    supplier = relationship("ApSuppliers", back_populates="requisitions")
    ship_to_warehouse = relationship("InventoryOrgs", foreign_keys=[ship_to_inv_org_id])
    bill_to_warehouse = relationship("InventoryOrgs", foreign_keys=[bill_to_inv_org_id])



class PurchaseRequisitionDtls(Base):

    __tablename__ = "PurchaseRequisitionDtls"

    # one row per item requested, with the procurement context crm captured at that moment
    # (stock on hand, eta, last po price, avg sales) and the oracle po line raised for it.
    # snapshot, status and po link move after creation.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("PurchaseRequisitionHdrs.header_id"), index=True)
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)
    item_description = Column(Text)
    uom = Column(Text)                                                       # KG / L / EA
    quantity = Column(Numeric(18, 2), nullable=False)
    unit_price = Column(Numeric(18, 3), nullable=False)
    total_price = Column(Numeric(18, 3), nullable=False)                     # = quantity x unit_price
    category_id = Column(BigInteger, nullable=False)                         # item category at request time, differs from today's on 16%
    needby_date = Column(Date)
    priority = Column(Text)                                                  # Low / Medium / High, 90% empty
    pto_pts = Column(Text)                                                   # PTO / PTS
    import_export = Column(Text)                                             # Import / Export, empty on domestic
    purchasetype = Column(Text)                                              # Regular / Lab Trial / Pilot Project, 85% empty
    customerid = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), index=True)   # only on customer specific requests, crm has 0 on 78% -> null
    soccollectorid = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)   # same, 0 on 78% -> null
    onhand_stock = Column(Numeric(18, 2), nullable=False)                    # context at request time
    eta_stock = Column(Numeric(18, 2), nullable=False)
    pendingreqqty = Column(Numeric(18, 2), nullable=False)
    avgsales = Column(Numeric(18, 2), nullable=False)
    stock_days = Column(BigInteger, nullable=False)                          # 359 rows are absurd (crm divide by zero), treat > 3650 as no sales
    lastpoprice = Column(Numeric(18, 3), nullable=False)
    change_in_price_per = Column(Numeric(18, 3), nullable=False)             # 100 when there was no last po
    pendingordercount = Column(BigInteger)
    itemstatus = Column(Text)                                                # A / I at request time
    qtyinkgs = Column(Numeric(18, 2), nullable=False)                        # 2026 feature, 4% populated
    unitpriceperkg = Column(Numeric(18, 2), nullable=False)
    totalvalue = Column(Numeric(18, 2), nullable=False)
    gppercentage = Column(Numeric(18, 2), nullable=False)
    status_id = Column(BigInteger, nullable=False)                           # -2 .. 8, no master. 6 = approved (90%), 7 = rejected, negatives = referred back
    record_submit = Column(Text)                                             # Y / R, empty on 84%
    po_header_id = Column(BigInteger)                                        # oracle po raised for this line
    po_number = Column(Text)
    po_line_id = Column(BigInteger, index=True)                              # BiPoDetails.po_line_id, soft link (not unique there). empty till sent to oracle
    posenddate = Column(DateTime)                                            # when it went to oracle
    creation_date = Column(DateTime, index=True)
    last_update_date = Column(DateTime)                                      # 64% empty

    header = relationship("PurchaseRequisitionHdrs", back_populates="lines")
    item = relationship("ItemMasters")
    customer = relationship("CustomerMasters")
    collector = relationship("Collectors")
