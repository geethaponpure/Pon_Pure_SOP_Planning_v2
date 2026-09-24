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
#   BiGrnDetails -> ItemMasters / ApSuppliers / InventoryOrgs      (what actually arrived)


# note: crm's dbo.PaymentTerms (206 rows, ids 4 / 5 / 1000+) is NOT the master for the term ids our data
# carries. ApSuppliers.terms_id, PurchaseRequisitionHdrs.payment_term_id and lastpotermid all use a 10xxx
# id space with no overlap at all - measured sep 2026, zero matches either way. crm does not expose that
# master, but the requisition carries the term NAME, so the due days are read off the name instead.
# see fact_requisition_line.payment_due_days.


class ApSupplierSitesAlls(Base):

    __tablename__ = "ApSupplierSitesAlls"

    # one row per supplier ADDRESS. a supplier can have several - a factory, an office, a pay-to site.
    # this is where the country lives, which is what actually explains import lead times.
    # every purchase order line resolves to a site here, and every site to a country.

    vendor_site_id = Column(BigInteger, primary_key=True, autoincrement=False)
    vendor_id = Column(BigInteger, ForeignKey("ApSuppliers.vendor_id"), index=True)
    vendor_site_code = Column(Text)
    address_line1 = Column(Text)
    city = Column(Text)
    state = Column(Text)
    zip = Column(Text)
    country = Column(Text, index=True)                                       # two letter code: IN, SG, CN, DE ..
    country_of_origin_code = Column(Text)                                    # where the goods are made, when it differs
    purchasing_site_flag = Column(Text)                                      # Y = orders can be placed on this address
    pay_site_flag = Column(Text)                                             # Y = invoices are paid to it
    terms_id = Column(BigInteger)                                            # -> PaymentTerms, this site's own terms
    ship_via_lookup_code = Column(Text)                                      # carrier
    freight_terms_lookup_code = Column(Text)                                 # who pays the freight
    fob_lookup_code = Column(Text)                                           # where title passes
    inactive_date = Column(DateTime)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    supplier = relationship("ApSuppliers")


class ApprovalStatus(Base):

    __tablename__ = "ApprovalStatus"

    # crm's master for the requisition workflow codes, 17 rows. PurchaseRequisitionHdrs.status_id and
    # PurchaseRequisitionDtls.status_id decode against it. no foreign key: crm also writes 0 and -2,
    # which are not in the master.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)    # the status code itself
    approval_status = Column(Text)                                           # Awaiting / First Level Approved / Approve / Reject / Referback ..


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



class BiGrnDetails(Base):

    __tablename__ = "BiGrnDetails"

    # what actually arrived at a warehouse. an oracle receipt extract crm rebuilds in full every night,
    # so nothing on it is stable between runs - snapshot with our own id, performance chemicals only.
    #
    # there is no natural key: a quarter of the rows carry no receipt id at all, and a receipt line can be
    # split into several rows when one delivery is put away in pieces. so in views always SUM quantity_received,
    # never count rows, and never join on header_id.
    #
    # `source` says what kind of receipt it is, and decides which reference columns are filled:
    #   VENDOR          bought from a third party      po_header_id, po_line_id, vendor_id       -> supplier lead time
    #   INTERNAL ORDER  sent from another of our orgs  req_inv_id, req_vendor_name (the sender)  -> transfer lead time
    #   INVENTORY       moved between sub-inventories  from_inv_id
    #   CUSTOMER        a sales return                 order_header_id, customer_id
    #   Miss / Direct   a manual adjustment            nothing

    id = Column(BigInteger, primary_key=True)                                # ours, restarts every load. not in TABLES_COLUMNS
    header_id = Column(BigInteger)                                           # crm's own id. restarts from 1 on every rebuild - never a key, never a watermark
    sync_date = Column(DateTime)                                             # when crm read oracle
    company_id = Column(BigInteger)                                          # operating unit
    company_name = Column(Text)
    company_code = Column(Text)
    inv_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), index=True)   # the warehouse that received
    inv_org_code = Column(Text)
    inv_org_name = Column(Text)
    receipt_id = Column(BigInteger, index=True)                              # empty on Miss / Direct rows
    receipt_line_id = Column(BigInteger, index=True)                         # same. not unique even where present
    receipt_num = Column(Text)
    receipt_date = Column(Date, index=True)                                  # careful: on internal orders crm uses the despatch date, so 1 to 3 days early
    source = Column(Text, index=True)                                        # VENDOR / INTERNAL ORDER / INVENTORY / CUSTOMER / Miss / Direct
    vendor_id = Column(BigInteger, ForeignKey("ApSuppliers.vendor_id"), index=True)   # third party supplier, VENDOR rows only
    vendor_number = Column(Text)
    vendor_name = Column(Text)
    vendor_site_id = Column(BigInteger)
    vendor_site = Column(Text)
    po_header_id = Column(BigInteger, index=True)                            # the purchase order, VENDOR rows only
    po_line_id = Column(BigInteger, index=True)                              # -> BiPoDetails.po_line_id, soft link. this is what dates the supplier lead time
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), index=True)   # sales returns only
    customer_number = Column(Text)
    customer_name = Column(Text)
    cust_site_use_id = Column(BigInteger)
    cust_site_name = Column(Text)
    order_header_id = Column(BigInteger)                                     # returns only. empty on internal orders, which is why a transfer has no start date yet
    order_line_id = Column(BigInteger)
    from_inv_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), index=True)   # sub-inventory transfers only
    from_inv_code = Column(Text)
    from_inv_name = Column(Text)
    req_inv_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), index=True)   # the org that sent it, on every internal order back to 2018
    req_inv_code = Column(Text)
    req_vendor_name = Column(Text)                                           # that org's name, e.g. PPC - Malur-KH
    line_num = Column(BigInteger)
    inventory_item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)
    item_code = Column(Text)
    lot_number = Column(Text)                                                # the batch. several rows can share one
    uom = Column(Text)
    quantity_received = Column(Double)
    ullage_loss = Column(Double)                                             # short delivery on a bulk tanker

    po_price_in_inr = Column(Double)                                         # the landed cost build-up below is all per unit
    ocean_freight_charges = Column(Double)
    insurance = Column(Double)
    duties_per_unit = Column(Double)
    cc = Column(Double)                                                      # clearing charges
    freight_inward = Column(Double)
    packing_cost = Column(Double)
    labour_cost = Column(Double)
    machine_cost = Column(Double)
    other_cost = Column(Double)
    forex = Column(Double)
    lc = Column(Double)                                                      # letter of credit charges
    supplier_discount = Column(Double)
    total_cost = Column(Double)                                              # the landed cost per unit

    item = relationship("ItemMasters")
    supplier = relationship("ApSuppliers")
    warehouse = relationship("InventoryOrgs", foreign_keys=[inv_org_id])
    from_warehouse = relationship("InventoryOrgs", foreign_keys=[from_inv_id])
    sending_warehouse = relationship("InventoryOrgs", foreign_keys=[req_inv_id])
    customer = relationship("CustomerMasters")



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
    last3jc_qty = Column(Double)                                             # crm's own demand baseline: average consumption per cycle over the last 3 cycles
    last6jc_qty = Column(Double)                                             # same over 6 cycles. only on domestic and import lines from 2023, about 1 in 5
    stock_days = Column(BigInteger, nullable=False)                          # 359 rows are absurd (crm divide by zero), treat > 3650 as no sales
    lastpoprice = Column(Numeric(18, 3), nullable=False)
    lastpotermid = Column(BigInteger, nullable=False)                        # payment term on the last po for this item, same ids as payment_term_id on the header. 0 = no previous po
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
