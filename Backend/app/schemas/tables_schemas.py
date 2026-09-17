

TABLES_COLUMNS = {

#-------------------------------------------- Item / product master -------------------------------------------    
"item_master" : {
    "ItemMasters": [
        "item_id",              # pk. orders, quotes, dispatch, categories, pto/pts all link on this
        "item_code",            # sku code. not unique, 6 codes appear twice
        "item_description",
        "item_group",
        "uom",                  # KG, LTR etc
        "uom_description",
        "status",               # Active / Inactive (full word, not A / I like customers)
        "creation_date",
        "last_update_date",
    ],

    "ItemCategories": [
        "header_id",            # pk
        "category_id",          # segment combo id, 350 distinct. no master table for it
        "segment1",             # division   e.g. Performance Chemicals
        "segment2",             # business   e.g. Textile & Paper Division
        "segment3",             # category
        "segment4",             # family
        "item_id",              # -> ItemMasters.item_id, one row per item. 36 rows point to deleted items, skip them on load
        "creation_date",
        "last_update_date",
    ],

    "PurchaseRequisitionPtoPts": [
        "Header_id",            # pk
        "itemid",               # -> ItemMasters.item_id, all match
        "itemcode",             # same as ItemMasters.item_code, just a copy
        "customercount",        # how many customers bought it in the month
        "OverAllSaleQty",       # total qty sold in the month
        "CustomerSaleQty",      # qty sold to the top customers
        "SalePercentage",       # CustomerSaleQty / OverAllSaleQty
        "Actiontypes",          # PTO / PTS
        "FromDate",             # month start, ~30 rows per item from jul 2020
        "Todate",               # month end
    ]
},


#-------------------------------------------- Customer & sales-territory master ------------------------

"customer_master" : {
    "CustomerMasters": [
        "header_id",            # pk. quotes and sites link on this
        "customer_id",          # oracle customer id, orders and plans use this. empty for leads
        "customer_number",      # oracle account no. soc pending uses this one, not customer_id
        "customer_name",
        "customergroup",        # parent company, for group level totals
        "status",               # A / I, lot of blanks too
        "creation_date",
        "last_update_date",
    ],

    "CustomerSites": [
        "line_id",              # pk
        "header_id",            # -> CustomerMasters.header_id
        "mc_code",              # -> MarketCircles.mc_code. this is the real link, markert_cirlce_id is always null
        "cust_acct_site_id",    # SaleOrderHdrs.CUST_ACCT_SITE_ID points here
        "status",               # A / I
        "site_use_id",          # bill_to_site_id / ship_to_site_id in orders, quotes and plans point here
        "site_use_code",        # BILL_TO / SHIP_TO
        "city",
        "state",
        "country",
        "creation_date",
        "last_update_date",
        "primary_flag",         # Y / N, use to pick one site per customer
    ],

    "MarketCircles": [
        "header_id",            # pk. UserMarketCircleMappings.market_circle_id points here
        "collector_id",         # -> Collectors, who owns this circle
        "mc_code",              # CHE01, AUR01 etc. unique. sites, quotes and soc pending join on this
        "code",                 # branch code like CHE, AUR
        "region",               # SOUTH / WEST etc. use this one, region on Collectors is half empty
        "is_active",
        "creation_date",
        "last_update_date",
    ],

    "Collectors": [
        "collector_id",         # pk
        "name",                 # branch name like MUMBAI-II, CORPORATE
        "status",               # A for all right now
        "IsOverseasCollector",  # export collectors, keep out of domestic planning
        "creation_date",
        "last_update_date",
        "IsGroupCompanyCollector",  # only one row, internal group company
    ],
},

#-------------------------------------------- Sales orders / SOC (open order book) ------------------------

"sales_order_soc" : {
    "SaleOrderHdrs": [
        "header_id",              # pk. dtls, soc pending (ORDER_NO), dispatch, billings point here
        "quotation_line_id",      # -> QuotationHdrs.header_id, wire the fk when quotation category comes in
        "quotation_number",       # e.g. /2018-2019/000101583
        "quotation_date",         # has junk values (year 0001, 2027). use po_received_date for dates
        "organization_id",        # operating unit, 10 of them
        "collector_id",           # -> Collectors. booking collector, ~10% differ from the site's territory collector
        "customer_id",            # -> CustomerMasters.customer_id
        "bill_to_site_id",        # -> CustomerSites.site_use_id. -1 when the site is gone from crm
        "ship_to_site_id",        # -> CustomerSites.site_use_id. the demand location. -1 when gone
        "is_back_to_back_order",  # order that triggers a purchase
        "CUST_ACCT_SITE_ID",      # CustomerSites.cust_acct_site_id, not unique there so no fk
        "trans_type_name",        # Taxable / Stock Transfer / Sample / Export .. filter for real sales
        "currency",               # INR / USD / EUR
        "customer_po_ref",        # customer's po number
        "customer_po_date",
        "po_received_date",       # the reliable order date
        "trading_manufacture",    # Manufacturing / Trading
        "creation_date",
        "last_update_date",       # 84% empty
    ],

    "SaleOrderDtls": [
        "line_id",                # pk. dispatch, billings, schedules point here
        "header_id",              # -> SaleOrderHdrs
        "item_id",                # -> ItemMasters
        "uom_code",               # Kgs / Liter / Nos
        "quantity",               # ordered qty
        "unit_price",
        "discount_percentage",    # 0 / 5 / 7
        "total_sales_price",      # order value
        "delivery_from_id",       # -> DeliveryFroms.line_id. 542 lines carry 0 -> -1
        "sale_category",          # Intact / Repack / Bulk
        "delivery_date",          # promised date
        "inventory_org_id",       # which warehouse serves the line
        "item_group",             # same as ItemMasters.item_group, just a copy
        "creation_date",
        "last_update_date",       # 99% empty, crm never updates lines
        "status",                 # OPEN / Closed. NOT a reliable open book flag, 900k lines say OPEN. use SocPendingDetails
        "quotationdtl_line_id",   # -> QuotationDtls.line_id, later
    ],

    "SocPendingDetails": [        # crm's daily pending soc report. no key, wiped and reloaded every run, pk is our own id
        "quotation_id",           # SaleOrderHdrs.quotation_line_id
        "ORDER_NO",               # -> SaleOrderHdrs.header_id
        "ORDER_DATE",
        "SCHEDULE_DATE",
        "collector_id",           # -> Collectors
        "CUSTOMER_NUMBER",        # -> CustomerMasters.customer_number
        "category",               # Intact / Repack / Bulk / E-Commerce
        "TRANSACTION_TYPE",       # same values as trans_type_name on hdrs
        "ITEMCODE",               # ItemMasters.item_code, not unique there so no fk
        "UOM",                    # KG / EA / BOX
        "total_quantity",         # ordered
        "SCHEDULED_QTY",
        "DESPATCHED_QTY",
        "BALANCE_QTY",            # still to dispatch, the open book
        "UNITPRICE",
        "TOTALSALEPRICE",
        "customer_req_date",      # when the customer wants it
        "INVENTORY_ORG_CODE",     # which warehouse holds it
        "market_circle",          # -> MarketCircles.mc_code. 35% blank -> 'unknown'
        "SyncDate",               # when crm generated this snapshot, same for every row
        "Dispatch_PER",           # % dispatched
        "RESCHEDULE_DATE",
        "RESCHEDULE_REASON",      # Customer Requested / Stock Not Available ..
    ],
},

#-------------------------------------------- Dispatch / billing history ------------------------

"dispatch_master" : {
    "DeliveryFroms": [            # delivery point lookup, 46 rows, never edited
        "line_id",                # pk. SaleOrderDtls.delivery_from_id points here, -1 = unknown
        "name",                   # Kandla, Vizag, Ennore ..
        "is_active",              # all true today
        "location_id",            # CompanyLocations id, not loaded
        "creation_date",
        "last_update_date",
    ],

    "Dispatches": [               # dispatch note / invoice header. snapshot, only the headers the loaded details point at
        "header_id",              # pk. DispatchDetails.header_id points here
        "customer_id",            # -> CustomerMasters.customer_id
        "collector_id",           # -> Collectors
        "bill_to_customer_site_id",   # -> CustomerSites.site_use_id
        "ship_to_customer_site_id",   # -> CustomerSites.site_use_id, where it went
        "sale_order_header_id",   # -> SaleOrderHdrs
        "despatch_status_id",     # 1 Pending / 3 MoveToOracle / 4 InvoiceCancel
        "currency",               # INR / USD / EUR
        "sum_of_despatch_quantity",   # header total qty
        "inventory_org_id",       # shipping warehouse
        "trx_number",             # oracle invoice number, empty till invoiced (7%)
        "trx_date",               # invoice date
        "sum_of_despatch_value",  # header total value
        "trans_type_name",        # Taxable / Stock Transfer / Sample ..
        "oracle_status",          # CANCELLED or empty. second cancel signal
        "Cancel_reason",          # Credit Issue / Wrong Billing Date / Wrong Tax Calculation
        "despatch_confirm_date",  # when the branch confirmed it
        "creation_date",
        "last_update_date",
    ],

    "Schedules": [                # planned dispatch per order line. snapshot, performance chemicals from 2021
        "line_id",                # pk. DispatchDetails.schedule_line_id points here
        "sale_order_header_id",   # -> SaleOrderHdrs
        "sale_order_detail_line_id",  # -> SaleOrderDtls, about 1 schedule per line
        "item_id",                # -> ItemMasters, same as the order line
        "sale_category",          # Intact / Repack / Bulk
        "customer_id",            # -> CustomerMasters.customer_id
        "schedule_date",          # planned dispatch date. stored as date, junk year row -> null
        "reschedule_date",        # differs from schedule_date on 18% = real reschedules
        "reschedule_reason",      # Customer Requested / Stock Not Available ..
        "inventory_org_id",       # planned shipping warehouse
        "customer_requested_date",    # what the customer asked for
        "schedule_quantity",
        "bill_to_customer_site_id",   # -> CustomerSites.site_use_id, 0 -> -1
        "ship_to_customer_site_id",   # -> CustomerSites.site_use_id, 0 -> -1
        "schedule_status_id",     # 1 Pending / 3 Reject / 4 Confirmed / 5 Closed / 6 SOCConfirmed / 7 Cancelled. NOT a clean open flag, use SocPendingDetails
        "confirm_status_id",      # 0 / 1
        "order_quantity",         # line qty at schedule time
        "backtoback_enable",      # line that triggers a purchase
        "unit_price",
        "creation_date",
        "last_update_date",       # 42% of rows get edited later
        "request_type",           # CRM / WMS, empty on old rows
    ],

    "SocCancelDetails": [         # cancelled / closed soc lines. incremental, rows never change
        "header_id",              # pk
        "sale_order_header_id",   # -> SaleOrderHdrs
        "sale_order_detail_line_id",  # -> SaleOrderDtls, the line being cancelled
        "schedule_line_id",       # Schedules.line_id, reference only. schedule is often deleted after the cancel
        "item_id",                # -> ItemMasters
        "customer_id",            # -> CustomerMasters.customer_id
        "inventory_org_id",       # warehouse
        "sale_category",          # Intact / Repack / Bulk ..
        "schedule_date",          # the schedule that got cancelled
        "schedule_quantity",      # what was scheduled
        "shipped_quantity",       # already gone before the cancel
        "remaining_quantity",     # the cancelled qty
        "close_reason_id",        # reason code, no master table in crm. ask crm team for the list
        "status_id",              # workflow status code, no master table in crm
        "approved_action_date",   # when the cancel was approved
        "comment",                # free text reason, the only human readable why
        "creation_date",          # the cancellation date
    ],

    "DispatchDetails": [          # snapshot table, performance chemicals from 2021 only, reloaded every run
        "line_id",                # pk
        "header_id",              # -> Dispatches.header_id, the dispatch note
        "item_id",                # -> ItemMasters. item actually shipped, not always the ordered one
        "uom",                    # KG / EA / BOX
        "sale_quantity",          # dispatched qty, the number we need
        "unit_price",
        "schedule_date",          # the dispatch date. stored as date, junk year 9019 row -> null
        "sale_category",          # Intact / Repack / Bulk / E-Commerce
        "packing_cost",
        "inventory_org_id",       # shipping warehouse
        "sale_order_header_id",   # -> SaleOrderHdrs
        "sale_order_detail_line_id",  # -> SaleOrderDtls, the main link
        "schedule_line_id",       # -> Schedules.line_id, the schedule this dispatch fulfils
        "schedule_quantity",      # what was scheduled
        "tolerance_quantity",     # always 0 today
        "trading_manufacture",    # Manufacturing / Trading
        "tax_percentage",
        "total_value",            # dispatch value
        "item_segment",           # always Performance Chemicals after the filter
        "creation_date",          # empty on pre 2020 rows
        "last_update_date",       # half the rows get edited later (billing confirmation)
    ],
},
}
