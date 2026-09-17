

#==================================================================================================
#                       Here Variables is use for table filtering, modification
#==================================================================================================


#---------------------------------- no usable key in crm load full data everytime -------------------------------------
SNAPSHOT_TABLES = {"SocPendingDetails", "Dispatches", "Schedules", "DispatchDetails"}




#---------------------------------------------Filter--------------------------------------------------
SOURCE_FILTERS = {
    "ItemCategories": "[segment1] = 'Performance Chemicals'",
    "DispatchDetails": "[schedule_date] >= '2021-01-01' AND [item_segment] = 'Performance Chemicals'",
    # only the headers those details point at, so the fk always holds. ~253k of 1.4M
    "Dispatches": "[header_id] IN (SELECT header_id FROM [CRMPROD].[dbo].[DispatchDetails] WHERE [schedule_date] >= '2021-01-01' AND [item_segment] = 'Performance Chemicals')",
    # ~393k of 2.6M
    "Schedules": "[schedule_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # ~17k of 126k
    "SocCancelDetails": "[creation_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
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
    "Schedules":       [("sale_order_detail_line_id", "SaleOrderDtls",   "line_id"),
                        ("sale_order_header_id",      "SaleOrderHdrs",   "header_id"),
                        ("item_id",                   "ItemMasters",     "item_id"),
                        ("customer_id",               "CustomerMasters", "customer_id"),
                        ("ship_to_customer_site_id",  "CustomerSites",   "site_use_id"),
                        ("bill_to_customer_site_id",  "CustomerSites",   "site_use_id")],
    "DispatchDetails": [("sale_order_detail_line_id", "SaleOrderDtls", "line_id"),
                        ("sale_order_header_id",      "SaleOrderHdrs", "header_id"),
                        ("item_id",                   "ItemMasters",   "item_id")],
}


#---------------------------- Parent tables must load before child tables -------------------------------------
LOAD_LEVELS = [
    ["Collectors", "CustomerMasters", "ItemMasters", "DeliveryFroms"],   # no parents
    ["MarketCircles", "ItemCategories", "PurchaseRequisitionPtoPts"],    # need level 0
    ["CustomerSites"],                                                   # needs CustomerMasters + MarketCircles
    ["SaleOrderHdrs"],                                                   # needs Collectors, CustomerMasters, CustomerSites
    ["SaleOrderDtls", "SocPendingDetails", "Dispatches"],                # need SaleOrderHdrs (+ ItemMasters / MarketCircles / sites)
    ["Schedules", "SocCancelDetails"],                                   # level 5, need SaleOrderDtls
    ["DispatchDetails"],                                                 # level 6, needs Schedules + Dispatches
]
