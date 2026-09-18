

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


#-------------------------------------------- Quotation / pipeline ------------------------

"quotation_master" : {
    "QuotationStatus": [          # 21 row lookup, incremental
        "line_id",                # pk. status_id on hdrs and dtls points here
        "name",                   # Open / Approved / Confirmed / Closed ..
        "description",
        "is_active",              # all true today
    ],

    "QuotationHdrs": [            # snapshot. only the headers the loaded lines point at, reloaded every run
        "header_id",              # pk. every SaleOrderHdrs.quotation_line_id points here, soft link (orders are not filtered to PC)
        "quotation_number",       # PPC/2025-26/103315
        "quotation_date",
        "company_id",             # operating unit, same ids as organization_id on orders
        "collector_id",           # -> Collectors
        "customer_id",            # -> CustomerMasters.customer_id. 153 rows carry 0 -> -1
        "bill_to_site_id",        # -> CustomerSites.site_use_id. 300 zeros -> -1
        "ship_to_site_id",        # -> CustomerSites.site_use_id. 716 zeros -> -1
        "status_id",              # -> QuotationStatus. 96% Closed (closes on conversion). Open / Approved / Confirmed = pipeline
        "close_status_id",        # 0 / 1 / 2, no master table
        "trans_type_name",        # Taxable / Stock Transfer / Sample / Export ..
        "is_back_to_back_order",  # quote that triggers a purchase
        "quote_creation_type",    # 1 / 2
        "currency_type",          # INR / USD / EUR
        "conversion_rate",        # to INR
        "mc_code",                # -> MarketCircles.mc_code. lower case, 2% blank -> 'unknown'
        "is_prequote",            # 152 true
        "revised_count",          # how many times the quote was revised
        "creation_date",
        "last_update_date",       # 7% of rows edited later (status moves), hence snapshot
    ],

    "QuotationDtls": [            # snapshot. performance chemicals lines from 2021, reloaded every run
        "line_id",                # pk. SaleOrderDtls.quotationdtl_line_id points here, 90% match, soft link
        "header_id",              # -> QuotationHdrs
        "item_id",                # -> ItemMasters
        "uom_code",               # KG / EA / BOX
        "quantity",               # quoted qty
        "unit_price",
        "total_sales_price",      # quoted value
        "discount_percentage",    # 0 / 5 / 10
        "discount_value",
        "tax_percentage",
        "delivery_from_id",       # -> DeliveryFroms. 587 zeros -> -1
        "sale_category",          # Intact / Repack / Bulk
        "inventory_org_id",       # warehouse
        "delivery_date",          # 1 junk row -> null
        "status_id",              # -> QuotationStatus. 536 rows carry 0 -> null
        "creation_date",
        "last_update_date",       # 7% edited later
    ],
},


#-------------------------------------------- Business plan / projection (S&OP demand) --------------------------------------------

"business_plan" : {
    "JourneyCalendars": [         # planning calendar, 13 cycles a year, ~4 weeks each. incremental, never edited
        "line_id",                # pk. SCBusinessMonthlyPlanJCDtls.jc_type points here, -1 = unknown
        "name",                   # JC1 .. JC13
        "acc_year",               # 2025-2026
        "effective_from",         # first day of the cycle
        "effective_to",           # last day, next cycle starts the day after. no gaps, no overlaps
        "is_active",              # all true today
        "is_closed",              # false or empty today
        "creation_date",
        "last_update_date",
    ],

    "SCBusinessMonthlyPlanHdrs": [    # annual plan per customer x product x collector x year. snapshot, no filter (whole table is PC)
        "header_id",              # pk. SCBusinessMonthlyPlanDtls.header_id points here
        "acc_year",               # 2025-2026, the reliable time key
        "customer_id",            # -> CustomerMasters.customer_id. 9,624 prospects carry 0 -> -1
        "collector_id",           # -> Collectors
        "bill_to_site_id",        # -> CustomerSites.site_use_id. empty on 53%, crm stopped filling it from 2024-25
        "item_description",       # product name. no item_id on the plan, maps to one sku only 29% of the time
        "category_id",            # ItemCategories.category_id, not unique there so no fk
        "segment2",               # division
        "segment3",               # category
        "segment4",               # family
        "annual_potential_qty",
        "annual_potential_value",
        "annual_budget_qty",
        "annual_budget_value",
        "prev_two_yr_qty_achieved",
        "prev_two_yr_value_achieved",
        "last_yr_avg_sell_price",
        "avg_sell_price",
        "jc1_status",     # jc workflow status 1 .. 6, no master in crm. 1 and 4 cover 96%
        "jc2_status",
        "jc3_status",
        "jc4_status",
        "jc5_status",
        "jc6_status",
        "jc7_status",
        "jc8_status",
        "jc9_status",
        "jc10_status",
        "jc11_status",
        "jc12_status",
        "jc13_status",
        "new_customer_name",      # prospects only
        "new_customer_marketcircle",  # prospects only. lower/trim, 'unknown' when blank or not a circle
        "is_new_customer",        # true exactly when customer_id was 0
        "is_key_customer",
        "is_new_item",
        "creation_date",          # empty on 43%, all of 2020-22
        "last_update_date",       # half the rows move after creation
    ],

    "SCBusinessMonthlyPlanDtls": [    # the 13 JC plan, wide. snapshot. a third of rows are exact dups, 86% have no plan - load all, clean in views
        "line_id",                # pk. SCBusinessMonthlyPlanJCDtls.header_id points here (misnamed in crm)
        "header_id",              # -> SCBusinessMonthlyPlanHdrs
        "customer_id",            # -> CustomerMasters.customer_id. 0 on 38% -> -1, prefer the header's customer
        "collector_id",           # -> Collectors
        "item_description",       # same as the header on 99.8%
        "category_id",
        "jc1_week1_user_dfn_qty",      # planned qty, first half of the cycle
        "jc1_week1_user_dfn_value",    # user typed, mixed units (rupees / lakhs). use qty x avg price instead
        "jc1_week2_user_dfn_qty",      # planned qty, second half
        "jc1_week2_user_dfn_value",    # same caveat
        "jc1_qty_achieved",            # sparse, actuals come from dispatch
        "jc1_user_dfn_avg_sell_price", # planned price
        "is_jc1_saved",                # plan entered for this cycle
        "jc2_week1_user_dfn_qty",
        "jc2_week1_user_dfn_value",
        "jc2_week2_user_dfn_qty",
        "jc2_week2_user_dfn_value",
        "jc2_qty_achieved",
        "jc2_user_dfn_avg_sell_price",
        "is_jc2_saved",
        "jc3_week1_user_dfn_qty",
        "jc3_week1_user_dfn_value",
        "jc3_week2_user_dfn_qty",
        "jc3_week2_user_dfn_value",
        "jc3_qty_achieved",
        "jc3_user_dfn_avg_sell_price",
        "is_jc3_saved",
        "jc4_week1_user_dfn_qty",
        "jc4_week1_user_dfn_value",
        "jc4_week2_user_dfn_qty",
        "jc4_week2_user_dfn_value",
        "jc4_qty_achieved",
        "jc4_user_dfn_avg_sell_price",
        "is_jc4_saved",
        "jc5_week1_user_dfn_qty",
        "jc5_week1_user_dfn_value",
        "jc5_week2_user_dfn_qty",
        "jc5_week2_user_dfn_value",
        "jc5_qty_achieved",
        "jc5_user_dfn_avg_sell_price",
        "is_jc5_saved",
        "jc6_week1_user_dfn_qty",
        "jc6_week1_user_dfn_value",
        "jc6_week2_user_dfn_qty",
        "jc6_week2_user_dfn_value",
        "jc6_qty_achieved",
        "jc6_user_dfn_avg_sell_price",
        "is_jc6_saved",
        "jc7_week1_user_dfn_qty",
        "jc7_week1_user_dfn_value",
        "jc7_week2_user_dfn_qty",
        "jc7_week2_user_dfn_value",
        "jc7_qty_achieved",
        "jc7_user_dfn_avg_sell_price",
        "is_jc7_saved",
        "jc8_week1_user_dfn_qty",
        "jc8_week1_user_dfn_value",
        "jc8_week2_user_dfn_qty",
        "jc8_week2_user_dfn_value",
        "jc8_qty_achieved",
        "jc8_user_dfn_avg_sell_price",
        "is_jc8_saved",
        "jc9_week1_user_dfn_qty",
        "jc9_week1_user_dfn_value",
        "jc9_week2_user_dfn_qty",
        "jc9_week2_user_dfn_value",
        "jc9_qty_achieved",
        "jc9_user_dfn_avg_sell_price",
        "is_jc9_saved",
        "jc10_week1_user_dfn_qty",
        "jc10_week1_user_dfn_value",
        "jc10_week2_user_dfn_qty",
        "jc10_week2_user_dfn_value",
        "jc10_qty_achieved",
        "jc10_user_dfn_avg_sell_price",
        "is_jc10_saved",
        "jc11_week1_user_dfn_qty",
        "jc11_week1_user_dfn_value",
        "jc11_week2_user_dfn_qty",
        "jc11_week2_user_dfn_value",
        "jc11_qty_achieved",
        "jc11_user_dfn_avg_sell_price",
        "is_jc11_saved",
        "jc12_week1_user_dfn_qty",
        "jc12_week1_user_dfn_value",
        "jc12_week2_user_dfn_qty",
        "jc12_week2_user_dfn_value",
        "jc12_qty_achieved",
        "jc12_user_dfn_avg_sell_price",
        "is_jc12_saved",
        "jc13_week1_user_dfn_qty",
        "jc13_week1_user_dfn_value",
        "jc13_week2_user_dfn_qty",
        "jc13_week2_user_dfn_value",
        "jc13_qty_achieved",
        "jc13_user_dfn_avg_sell_price",
        "is_jc13_saved",
        "is_new_customer",
        "is_key_customer",
        "is_new_item",
        "creation_date",
        "last_update_date",       # 13% edited after creation
    ],

    "SCBusinessMonthlyPlanJCDtls": [  # rolling forecast per plan line x journey cycle. snapshot. 87% of rows are all zero, filter in views
        "line_id",                # pk
        "header_id",              # -> SCBusinessMonthlyPlanDtls.line_id. misnamed in crm, it is the plan LINE not the header. 2,744 point at deleted lines -> null
        "acc_year",               # 2025-2026. disagrees with the jc's year on 123 rows
        "jc_type",                # -> JourneyCalendars.line_id. 7,888 rows carry 0 -> -1
        "jc_nextmonth1_qty",      # forecast qty, next month
        "jc_nextmonth2_qty",      # forecast qty, month after
        "creation_date",
        "last_update_date",       # 3% edited after creation
    ],
},


#-------------------------------------------- Procurement / purchase --------------------------------------------

"purchase_master" : {
    "ApSuppliers": [              # oracle vendor master, 24k rows, only ~3k ever used. upsert, level 0
        "vendor_id",              # pk. BiPoDetails.vendor_id and PurchaseRequisitionHdrs.supplier_id point here
        "vendor_name",
        "segment1",               # oracle vendor number, = BiPoDetails.vendor_number
        "vendor_type_lookup_code",    # SUPPLIER / EMPLOYEE / TRANSPORTER / CONTRACTOR .. the filter for real suppliers
        "pay_group_lookup_code",  # SUPPLIER / TRANSPORTER / EMPLOYEE, empty on 86%
        "terms_id",               # payment terms id, oracle stores it as float
        "start_date_active",
        "end_date_active",        # set on 23% = inactive vendor
        "attribute8",             # msme registered YES / NO
        "attribute9",             # msme class Micro / Small / Medium
        "attribute10",            # msme type Manufacturing / Services / Trading
        "attribute11",            # udyam registration number
        "creation_date",
        "last_update_date",
    ],

    "BiPoDetails": [              # oracle po extract, regenerated nightly. snapshot with our own id, performance chemicals only
        "sync_date",              # when crm read oracle
        "po_header_id",           # oracle po header
        "po_number",
        "po_line_id",             # oracle po line. PurchaseRequisitionDtls.po_line_id points here. 402 dups, soft link
        "line_num",
        "po_date",
        "company_id",             # operating unit
        "company_code",           # PPC / PSM / POI ..
        "vendor_id",              # -> ApSuppliers.vendor_id, 100% match
        "vendor_name",
        "vendor_site_id",
        "ship_to_location_id",
        "inv_org_id",             # receiving warehouse
        "procurement_type",       # Domestic / Market / Import Procurement / Packing Materials. the reliable classifier
        "purchase_category",      # Market-Packed / Domestic-Bulk .. '0' on 37% (old pos)
        "inventory_item_id",      # -> ItemMasters.item_id, 100% match
        "uom",                    # Kilogram / Each / Litre
        "unit_price",
        "quantity",               # ordered
        "quantity_received",
        "quantity_cancelled",
        "quantity_billed",
        "line_amount",            # pending = greatest(quantity - received - cancelled, 0). 8% are over-received, that is real
    ],

    "PurchaseRequisitionHdrs": [   # requisitions raised in crm, ~4.5k a year, all PC. snapshot, status moves after creation
        "header_id",              # pk. PurchaseRequisitionDtls.header_id points here
        "operating_unit",
        "Requester",              # planner name, 34 of them
        "Collector_id",           # -> Collectors. 0 on 48% (raised centrally) -> null
        "supplier_id",            # -> ApSuppliers.vendor_id. 0 on 178 unfinished drafts -> null
        "supplier_site_id",
        "type",                   # Domestic / Import
        "purchase_category",      # Domestic Procurement / Import Procurement DFF / Market Procurement ..
        "category",               # division e.g. Textile & Paper Division
        "business",               # e.g. Textile / Water Treatment / Paints & Coatings
        "business_division",      # Capital / Service / Speciality
        "currency",               # INR / USD / EURO
        "conversion_type",        # misnamed in crm, it is the conversion rate. 0 on domestic rows
        "payment_term_id",
        "payment_term",           # Immediate / 60 days ..
        "DeliveryTermId",         # CFR / CIF / FOB on imports, else empty
        "ship_to_inv_org_id",     # receiving warehouse
        "bill_to_inv_org_id",
        "status_id",              # 0 .. 7, no master in crm. 6 = approved (91%), 7 = rejected, 0 = draft. status text column is always empty
        "record_submit",          # Y / N / R
        "IsConfirmed",
        "creation_date",
        "last_update_date",
    ],

    "PurchaseRequisitionDtls": [   # one row per item requested, with the stock / price context crm captured. snapshot
        "line_id",                # pk
        "header_id",              # -> PurchaseRequisitionHdrs
        "item_id",                # -> ItemMasters, 100% match, 99.8% PC
        "item_description",
        "UOM",                    # KG / L / EA
        "quantity",
        "unit_price",
        "total_price",            # = quantity x unit_price
        "category_id",            # item category at request time, differs from today's on 16%. keep, it is history
        "needby_date",
        "priority",               # Low / Medium / High, 90% empty
        "pto_pts",                # PTO / PTS
        "import_export",          # Import / Export, empty on domestic
        "PurchaseType",           # Regular / Lab Trial / Pilot Project, 85% empty
        "CustomerId",             # -> CustomerMasters.customer_id. only on customer specific requests, 0 on 78% -> null
        "SOCCollectorId",         # -> Collectors. same, 0 on 78% -> null
        "onhand_stock",           # context at request time
        "eta_stock",
        "pendingreqqty",
        "avgsales",
        "stock_days",             # 359 rows absurd (crm divide by zero), treat > 3650 as no sales
        "lastpoprice",
        "change_in_price_per",    # 100 when there was no last po
        "PendingOrderCount",
        "itemstatus",             # A / I at request time
        "QtyInKgs",               # 2026 feature, 4% populated today
        "UnitpricePerKg",
        "Totalvalue",
        "GPPercentage",
        "status_id",              # -2 .. 8, no master. 6 = approved (90%), 7 = rejected, negatives = referred back
        "record_submit",          # Y / R, empty on 84%
        "po_header_id",           # oracle po raised for this line
        "po_number",
        "po_line_id",             # BiPoDetails.po_line_id, soft link. empty till sent to oracle (11%)
        "PoSenddate",             # when it went to oracle
        "creation_date",
        "last_update_date",       # 64% empty
    ],
},


#-------------------------------------------- Inventory / stock --------------------------------------------
"inventory_master" : {
    "InventoryOrgLocations": [    # warehouse master, 188 rows. upsert, level 0
        "header_id",              # pk, crm row id. -1 = unknown
        "inventory_org_id",       # the oracle warehouse id every fact table carries. unique here, 1 null + 1 dup row dropped on stage
        "inventory_org_code",     # 051, 202 ..
        "location_id",            # InventoryOrgLocationMasters (city), not loaded. empty on 6%
        "State_id",               # 10 values, no master loaded
        "collector_ids",          # comma separated collectors this warehouse serves e.g. '1038,1039'. split in views
        "creation_date",          # empty on 98%, crm back-filled the table
        "last_update_date",
    ],

    "BiStockDetail": [            # daily stock per warehouse x item x lot. 31M rows in crm, we load PC from 2024, incremental in parallel pk ranges
        "header_id",              # pk, monotonic with sync_date. the incremental key
        "stock_id",               # oracle stock line id, a new one every day
        "sync_date",              # when crm pulled it
        "trans_date",             # the snapshot day
        "TypeOfTrx",              # DailyBasics / FRIDAY / FIRST_DAY / JC_START_DATE, empty before 2023
        "company_id",
        "operating_name",         # PPC / POI / PCT ..
        "inventory_org_id",       # -> InventoryOrgLocations.inventory_org_id, 100% match. -1 if ever missing
        "item_code",              # ItemMasters.item_code, soft link (not unique there). no item id on this table
        "subinventory_code",      # SHED A / Quarantine / UNRECON ..
        "lot_number",
        "opening_qty",            # on hand that day
        "ITEM_COST",              # unit cost
        "aging_date",             # lot receipt date, age = trans_date - aging_date
    ],
},

}
