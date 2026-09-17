

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
        "delivery_from_id",       # delivery point, 43 of them
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
}
