

#==================================================================================================
#                       Here Variables is use for table filtering, modification
#==================================================================================================


#---------------------------------- no usable key in crm load full data everytime -------------------------------------
SNAPSHOT_TABLES = {"SocPendingDetails"}




#---------------------------------------------Filter--------------------------------------------------
SOURCE_FILTERS = {
    "ItemCategories": "[segment1] = 'Performance Chemicals'",
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
    ],

    "SocPendingDetails": [
        'UPDATE stage SET market_circle = lower(trim(market_circle))',
        '''UPDATE stage SET market_circle = 'unknown'
            WHERE market_circle IS NULL OR market_circle = ''
               OR NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.market_circle)''',
    ],
}


#------------------------------------- Catch-all parent rows -------------------------------------
SEED_ROWS = {
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
    "SaleOrderHdrs":     [("customer_id",     "CustomerMasters", "customer_id"),
                          ("ship_to_site_id", "CustomerSites",   "site_use_id"),
                          ("bill_to_site_id", "CustomerSites",   "site_use_id")],
    "SaleOrderDtls":     [("header_id", "SaleOrderHdrs",   "header_id")],
    "SocPendingDetails": [("order_no",  "SaleOrderHdrs",   "header_id")],
    "CustomerSites":     [("header_id", "CustomerMasters", "header_id")],
}


#---------------------------- Parent tables must load before child tables -------------------------------------
LOAD_LEVELS = [
    ["Collectors", "CustomerMasters", "ItemMasters"],                   # no parents
    ["MarketCircles", "ItemCategories", "PurchaseRequisitionPtoPts"],    # need level 0
    ["CustomerSites"],                                                   # needs CustomerMasters + MarketCircles
    ["SaleOrderHdrs"],                                                   # needs Collectors, CustomerMasters, CustomerSites
    ["SaleOrderDtls", "SocPendingDetails"],                              # need SaleOrderHdrs (+ ItemMasters / MarketCircles)
]
