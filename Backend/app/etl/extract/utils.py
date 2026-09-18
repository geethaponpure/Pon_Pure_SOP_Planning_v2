

#==================================================================================================
#                       Here Variables is use for table filtering, modification
#==================================================================================================


#---------------- masters: small, and their rows change (lead -> customer, status, circle). read in full ----------------
#---------------- every run and merged on the pk. never truncated, everything else points at these -----------------------
UPSERT_TABLES = {"Collectors", "MarketCircles", "CustomerMasters", "CustomerSites",
                 "ItemMasters", "ItemCategories", "DeliveryFroms", "QuotationStatus", "JourneyCalendars", "ApSuppliers"}


#---------------------------------- no usable key in crm load full data everytime -------------------------------------
SNAPSHOT_TABLES = {"SocPendingDetails", "Dispatches", "Schedules", 
                   "DispatchDetails", "QuotationHdrs", "QuotationDtls",
                   "SCBusinessMonthlyPlanHdrs", "SCBusinessMonthlyPlanDtls", "SCBusinessMonthlyPlanJCDtls",
                   "BiPoDetails", "PurchaseRequisitionHdrs", "PurchaseRequisitionDtls"}




#---------------------------------------------Filter--------------------------------------------------
SOURCE_FILTERS = {
    "ItemCategories": "[segment1] = 'Performance Chemicals'",
    # ~68k of 169k
    "BiPoDetails": "[inventory_item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    "DispatchDetails": "[schedule_date] >= '2021-01-01' AND [item_segment] = 'Performance Chemicals'",
    # only the headers those details point at, so the fk always holds. ~253k of 1.4M
    "Dispatches": "[header_id] IN (SELECT header_id FROM [CRMPROD].[dbo].[DispatchDetails] WHERE [schedule_date] >= '2021-01-01' AND [item_segment] = 'Performance Chemicals')",
    # ~393k of 2.6M
    "Schedules": "[schedule_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # ~17k of 126k
    "SocCancelDetails": "[creation_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # ~380k of 2.65M
    "QuotationDtls": "[creation_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # only the headers those lines point at, so the fk always holds. ~225k of 1.19M
    "QuotationHdrs": "[header_id] IN (SELECT header_id FROM [CRMPROD].[dbo].[QuotationDtls] WHERE [creation_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals'))",
}




#------------------------------ Fix FK-related data on the stage table before insert -------------------------------------
STAGE_FIXES = {
    "CustomerMasters": [
        # 0 means no oracle account. null it so UNIQUE holds
        "UPDATE stage SET customer_id = NULL WHERE customer_id = 0",
        "UPDATE stage SET customer_number = NULL WHERE customer_number = 0",
    ],

    "MarketCircles": [
        'UPDATE stage SET mc_code = lower(trim(mc_code))',
    ],

    "CustomerSites": [
        'UPDATE stage SET mc_code = lower(trim(mc_code))',
        '''UPDATE stage SET mc_code = 'unknown'
            WHERE mc_code IS NULL OR mc_code = ''
               OR NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.mc_code)''',
        # crm double inserted one site (1139548). keep the earlier line
        #Same site, same everything, created in the same second
        "DELETE FROM stage a USING stage b WHERE a.site_use_id = b.site_use_id AND a.line_id > b.line_id",
    ],

    "ItemCategories": [
        'DELETE FROM stage WHERE item_id NOT IN (SELECT item_id FROM "ItemMasters")',
    ],

    "SCBusinessMonthlyPlanHdrs": [
        # prospects carry customer 0 -> unknown customer, the name sits in new_customer_name
        '''UPDATE stage SET customer_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.customer_id = stage.customer_id)''',
        # site is optional here (empty on half the rows), only a wrong value goes to unknown
        '''UPDATE stage SET bill_to_site_id = -1
            WHERE bill_to_site_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.bill_to_site_id)''',
        # soft link, same spelling rule as mc_code everywhere else
        "UPDATE stage SET new_customer_marketcircle = lower(trim(new_customer_marketcircle))",
        '''UPDATE stage SET new_customer_marketcircle = 'unknown'
            WHERE new_customer_marketcircle IS NOT NULL AND new_customer_marketcircle <> ''
              AND NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.new_customer_marketcircle)''',
    ],

    "SCBusinessMonthlyPlanJCDtls": [
        # 7,888 rows carry jc 0 -> unknown journey cycle
        '''UPDATE stage SET jc_type = -1
            WHERE NOT EXISTS (SELECT 1 FROM "JourneyCalendars" c WHERE c.line_id = stage.jc_type)''',
        # header_id is the plan line. 2,744 point at lines crm has deleted, plus the snapshot race. blank them
        '''UPDATE stage SET header_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "SCBusinessMonthlyPlanDtls" d WHERE d.line_id = stage.header_id)''',
    ],
    "SCBusinessMonthlyPlanDtls": [
        # 0 on 38% of rows (prospects and their duplicates) -> unknown customer
        '''UPDATE stage SET customer_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.customer_id = stage.customer_id)''',
        # header not loaded (created between the two snapshots). blank it, next run fixes it
        '''UPDATE stage SET header_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "SCBusinessMonthlyPlanHdrs" h WHERE h.header_id = stage.header_id)''',
    ],

    "PurchaseRequisitionDtls": [
        # 0 means not customer / collector specific, that is a real state -> null
        '''UPDATE stage SET customerid = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.customer_id = stage.customerid)''',
        '''UPDATE stage SET soccollectorid = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.soccollectorid)''',
        # not sent to oracle yet
        "UPDATE stage SET po_line_id = NULL WHERE po_line_id = 0",
        # header not loaded (created between the two snapshots). blank it, next run fixes it
        '''UPDATE stage SET header_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "PurchaseRequisitionHdrs" h WHERE h.header_id = stage.header_id)''',
    ],
    "PurchaseRequisitionHdrs": [
        # 178 unfinished drafts carry supplier 0 -> null
        '''UPDATE stage SET supplier_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "ApSuppliers" a WHERE a.vendor_id = stage.supplier_id)''',
        # 48% carry collector 0 (raised centrally) -> null, that is a real state not a missing parent
        '''UPDATE stage SET collector_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
    ],
    "QuotationHdrs": [
        # crm leaves 0 on a few hundred rows -> unknown customer / site
        '''UPDATE stage SET customer_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.customer_id = stage.customer_id)''',
        '''UPDATE stage SET ship_to_site_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.ship_to_site_id)''',
        '''UPDATE stage SET bill_to_site_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.bill_to_site_id)''',
        # same rule as CustomerSites, 2% blank
        'UPDATE stage SET mc_code = lower(trim(mc_code))',
        '''UPDATE stage SET mc_code = 'unknown'
            WHERE mc_code IS NULL OR mc_code = ''
               OR NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.mc_code)''',
    ],
    
    "QuotationDtls": [
        # 587 lines carry delivery point 0 -> unknown
        '''UPDATE stage SET delivery_from_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "DeliveryFroms" f WHERE f.line_id = stage.delivery_from_id)''',
        # 536 lines carry status 0, not a status
        '''UPDATE stage SET status_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "QuotationStatus" s WHERE s.line_id = stage.status_id)''',
        # one junk date
        "UPDATE stage SET delivery_date = NULL WHERE delivery_date < '2015-01-01' OR delivery_date > '2027-12-31'",
        # header not loaded (created between the two snapshots). blank it, next run fixes it
        '''UPDATE stage SET header_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "QuotationHdrs" h WHERE h.header_id = stage.header_id)''',
    ],

    "SaleOrderHdrs": [
        # sites crm has deleted -> unknown site
        '''UPDATE stage SET ship_to_site_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.ship_to_site_id)''',
        '''UPDATE stage SET bill_to_site_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.bill_to_site_id)''',
    ],

    "SaleOrderDtls": [
        "UPDATE stage SET status = 'Closed' WHERE status = 'CLOSE'",
        # 542 lines carry delivery point 0 -> unknown
        '''UPDATE stage SET delivery_from_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "DeliveryFroms" f WHERE f.line_id = stage.delivery_from_id)''',
    ],

    "SocPendingDetails": [
        'UPDATE stage SET market_circle = lower(trim(market_circle))',
        '''UPDATE stage SET market_circle = 'unknown'
            WHERE market_circle IS NULL OR market_circle = ''
               OR NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.market_circle)''',
    ],

    "Schedules": [
        # a handful of rows sit in year 9019, would break any date axis
        "UPDATE stage SET schedule_date = NULL WHERE schedule_date > '2027-12-31'",
        "UPDATE stage SET reschedule_date = NULL WHERE reschedule_date > '2027-12-31'",
        "UPDATE stage SET customer_requested_date = NULL WHERE customer_requested_date > '2027-12-31'",
        # 17 rows carry site id 0 -> unknown site
        '''UPDATE stage SET ship_to_customer_site_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.ship_to_customer_site_id)''',
        '''UPDATE stage SET bill_to_customer_site_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.bill_to_customer_site_id)''',
    ],

    "DispatchDetails": [
        # one row sits in year 9019, would break any date axis
        "UPDATE stage SET schedule_date = NULL WHERE schedule_date > '2027-12-31'",
        # header / schedule not loaded (created between the snapshots, or outside their filter). blank it, next run fixes it
        '''UPDATE stage SET header_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Dispatches" d WHERE d.header_id = stage.header_id)''',
        '''UPDATE stage SET schedule_line_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Schedules" s WHERE s.line_id = stage.schedule_line_id)''',
    ]
}


#------------------------------------- Catch-all parent rows -------------------------------------
SEED_ROWS = {
    "JourneyCalendars": '''INSERT INTO "JourneyCalendars" (line_id, name, acc_year, effective_from, effective_to, is_active, is_closed)
                          VALUES (-1, 'unknown', 'unknown', '1900-01-01', '1900-01-01', false, false)
                          ON CONFLICT (line_id) DO NOTHING''',
    "DeliveryFroms":   '''INSERT INTO "DeliveryFroms" (line_id, name, is_active, location_id)
                          VALUES (-1, 'unknown', false, -1)
                          ON CONFLICT (line_id) DO NOTHING''',

#-------------------------------------------- customer_master -----------------------------------------------------
    "MarketCircles":   '''INSERT INTO "MarketCircles" (header_id, mc_code, code, region, is_active)
                          VALUES (-1, 'unknown', 'unknown', 'unknown', true)
                          ON CONFLICT (header_id) DO NOTHING''',

    "CustomerMasters": '''INSERT INTO "CustomerMasters" (header_id, customer_id, customer_number, customer_name, status)
                          VALUES (-1, -1, -1, 'unknown', 'I')
                          ON CONFLICT (header_id) DO NOTHING''',

    "CustomerSites":   '''INSERT INTO "CustomerSites" (line_id, header_id, mc_code, cust_acct_site_id, site_use_id, site_use_code, status, primary_flag)
                          VALUES (-1, -1, 'unknown', -1, -1, 'unknown', 'I', 'N')
                          ON CONFLICT (line_id) DO NOTHING''',
}


#-------------- Hold rows whose parent is newer than the current PostgreSQL parent data; retry them on the next sync ---------------------------
PARENT_CHECK = {

#-------------------------------------------- sales_order_soc -----------------------------------------------------
    "SaleOrderHdrs":     [("customer_id",     "CustomerMasters", "customer_id"),
                          ("ship_to_site_id", "CustomerSites",   "site_use_id"),
                          ("bill_to_site_id", "CustomerSites",   "site_use_id")],
    "SaleOrderDtls":     [("header_id",        "SaleOrderHdrs", "header_id"),
                          ("delivery_from_id", "DeliveryFroms", "line_id")],
    "SocPendingDetails": [("order_no",  "SaleOrderHdrs",   "header_id")],

#-------------------------------------------- customer_master -----------------------------------------------------
    "CustomerSites":     [("header_id", "CustomerMasters", "header_id")],

#-------------------------------------------- dispatch_master -----------------------------------------------------
    "Dispatches":      [("sale_order_header_id",     "SaleOrderHdrs",   "header_id"),
                        ("customer_id",              "CustomerMasters", "customer_id"),
                        ("collector_id",             "Collectors",      "collector_id"),
                        ("ship_to_customer_site_id", "CustomerSites",   "site_use_id"),
                        ("bill_to_customer_site_id", "CustomerSites",   "site_use_id")],
    "SocCancelDetails": [("sale_order_detail_line_id", "SaleOrderDtls",   "line_id"),
                         ("sale_order_header_id",      "SaleOrderHdrs",   "header_id"),
                         ("item_id",                   "ItemMasters",     "item_id"),
                         ("customer_id",               "CustomerMasters", "customer_id")],
    "BiPoDetails":     [("inventory_item_id", "ItemMasters", "item_id"),
                        ("vendor_id",         "ApSuppliers", "vendor_id")],
    "PurchaseRequisitionHdrs": [("collector_id", "Collectors",  "collector_id"),
                                ("supplier_id",  "ApSuppliers", "vendor_id")],
    "PurchaseRequisitionDtls": [("header_id",      "PurchaseRequisitionHdrs", "header_id"),
                                ("item_id",        "ItemMasters",             "item_id"),
                                ("customerid",     "CustomerMasters",         "customer_id"),
                                ("soccollectorid", "Collectors",              "collector_id")],
    "Schedules":       [("sale_order_detail_line_id", "SaleOrderDtls",   "line_id"),
                        ("sale_order_header_id",      "SaleOrderHdrs",   "header_id"),
                        ("item_id",                   "ItemMasters",     "item_id"),
                        ("customer_id",               "CustomerMasters", "customer_id"),
                        ("ship_to_customer_site_id",  "CustomerSites",   "site_use_id"),
                        ("bill_to_customer_site_id",  "CustomerSites",   "site_use_id")],

#-------------------------------------------- quotation_master -----------------------------------------------------
    "SCBusinessMonthlyPlanHdrs": [("customer_id",     "CustomerMasters", "customer_id"),
                                  ("collector_id",    "Collectors",      "collector_id"),
                                  ("bill_to_site_id", "CustomerSites",   "site_use_id")],
    "SCBusinessMonthlyPlanJCDtls": [("header_id", "SCBusinessMonthlyPlanDtls", "line_id"),
                                    ("jc_type",   "JourneyCalendars",          "line_id")],
    "SCBusinessMonthlyPlanDtls": [("header_id",    "SCBusinessMonthlyPlanHdrs", "header_id"),
                                  ("customer_id",  "CustomerMasters",           "customer_id"),
                                  ("collector_id", "Collectors",                "collector_id")],
    "QuotationHdrs":   [("collector_id",    "Collectors",      "collector_id"),
                        ("customer_id",     "CustomerMasters", "customer_id"),
                        ("ship_to_site_id", "CustomerSites",   "site_use_id"),
                        ("bill_to_site_id", "CustomerSites",   "site_use_id")],
    "QuotationDtls":   [("header_id",        "QuotationHdrs", "header_id"),
                        ("item_id",          "ItemMasters",   "item_id"),
                        ("delivery_from_id", "DeliveryFroms", "line_id")],
    "DispatchDetails": [("sale_order_detail_line_id", "SaleOrderDtls", "line_id"),
                        ("sale_order_header_id",      "SaleOrderHdrs", "header_id"),
                        ("item_id",                   "ItemMasters",   "item_id")],
}


#---------------------------- Parent tables must load before child tables -------------------------------------
LOAD_LEVELS = [
    ["Collectors", "CustomerMasters", "ItemMasters", "DeliveryFroms", "QuotationStatus", "JourneyCalendars", "ApSuppliers"],   # no parents
    ["MarketCircles", "ItemCategories", "PurchaseRequisitionPtoPts", "BiPoDetails", "PurchaseRequisitionHdrs"],   # need level 0
    ["CustomerSites", "PurchaseRequisitionDtls"],                        # need CustomerMasters + MarketCircles / PurchaseRequisitionHdrs
    ["SaleOrderHdrs", "QuotationHdrs", "SCBusinessMonthlyPlanHdrs"],     # need Collectors, CustomerMasters, CustomerSites (+ MarketCircles, QuotationStatus)
    ["SaleOrderDtls", "SocPendingDetails", "Dispatches", "QuotationDtls", "SCBusinessMonthlyPlanDtls"],   # need the level 3 headers (+ ItemMasters / MarketCircles / sites)
    ["Schedules", "SocCancelDetails", "SCBusinessMonthlyPlanJCDtls"],    # level 5, need SaleOrderDtls / SCBusinessMonthlyPlanDtls
    ["DispatchDetails"],                                                 # level 6, needs Schedules + Dispatches
]
