

#==================================================================================================
#                       Here Variables is use for table filtering, modification
#==================================================================================================


#---------------- masters: small, and their rows change (lead -> customer, status, circle). read in full ----------------
#---------------- every run and merged on the pk. never truncated, everything else points at these -----------------------
UPSERT_TABLES = {"Collectors", "MarketCircles", "CustomerMasters", "CustomerSites",
                 "ItemMasters", "ItemCategories", "DeliveryFroms", "QuotationStatus", 
                 "JourneyCalendars", "ApSuppliers", "ApprovalStatus", "ApTermsTls", "ApSupplierSitesAlls", "InventoryOrgs",
                 "Users", "Roles", "ArCustomers", "Reasons", "FinancialYears", "TempItemmasters", "JcWeeklyCalendars"}



#---------------- incremental tables too big for one read. split into pk ranges, read in parallel ----------------
#---------------- the watermark only moves over contiguous good ranges, a failed range is re-fetched next run -----
LARGE_TABLES  = {"BiStockDetail"}
RANGE_ROWS    = 250_000     # pk ids per range (rows per range are fewer after the source filter)
INNER_WORKERS = 4           # crm connections one large table may open. keep outer x inner <= ~8



#---------------------------------- no usable key in crm load full data everytime -------------------------------------
SNAPSHOT_TABLES = {"SocPendingDetails", "Dispatches", "Schedules",
                   "DispatchDetails", "QuotationHdrs", "QuotationDtls",
                   "SCBusinessMonthlyPlanHdrs", "SCBusinessMonthlyPlanDtls", "SCBusinessMonthlyPlanJCDtls",
                   "BiPoDetails", "BiGrnDetails", "PurchaseRequisitionHdrs", "PurchaseRequisitionDtls",
                   "ItemInventoryOrgMappings", "BiCollectorInventoryOrgMapping",
                   "UserRoles", "UserMarketCircleMappings", "UserCollectorMappings",
                   "UserCustomerMappings", "CollectorMailMappings", "TechnicalUserSegmentMappings",
                   "tempcustomers", "SPBusinessPlanActualSales", "SCBusinessPlanProjections", "PcBusinessPlanReopens", "SCBusinessPlanLogs",
                   "SCLeadTargets", "SCLeadTargetJcDtls", "LeadDetails", "LeadProducts",
                   "BIRawMaterialConsumptions"}



#---------------- columns that are not in crm: they exist on our table, a stage fix fills them, and they ----------------
#---------------- must be copied stage -> table along with the crm columns (TABLES_COLUMNS only drives the crm read) -----
DERIVED_COLUMNS = {
    "BiStockDetail": ["item_id"],      # from item_code, see STAGE_FIXES
    "SCLeadTargets": ["temp_item_id"], # from item_id when is_temp_item, see STAGE_FIXES
    "LeadDetails":   ["collector_id"], # from the branch name, see STAGE_FIXES
    "LeadProducts":  ["item_id"],      # from productid when it is a real item id, see STAGE_FIXES
}



#---------------------------------------------Filter--------------------------------------------------
SOURCE_FILTERS = {
    "ItemCategories": "[segment1] = 'Performance Chemicals'",
    # order lines on performance chemicals products only, like dispatch / quotes / stock. about a sixth of all lines.
    # SaleOrderHdrs stays complete on purpose: it is incremental, and a header that gets a PC line added later would
    # otherwise be missing when that line arrives (its id sits below the watermark, so the parent check can't hold it).
    "SaleOrderDtls": "[item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # the open order book, same scope. no item id on this report, filter by item code
    "SocPendingDetails": "[ITEMCODE] IN (SELECT i.item_code FROM [CRMPROD].[dbo].[ItemMasters] i JOIN [CRMPROD].[dbo].[ItemCategories] c ON c.item_id = i.item_id WHERE c.segment1 = 'Performance Chemicals')",
    # ~68k of 169k
    "BiPoDetails": "[inventory_item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # goods receipts, same scope as the purchase orders they answer. ~311k of 836k
    "BiGrnDetails": "[inventory_item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # ~225k of 324k
    "ItemInventoryOrgMappings": "[item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # no item id on the stock table, filter by item code. ~31% of each day. 2024 on = ~7.5M rows
    "BiStockDetail":"[trans_date] >= '2024-01-01' AND [item_code] IN (SELECT i.item_code FROM [CRMPROD].[dbo].[ItemMasters] i JOIN [CRMPROD].[dbo].[ItemCategories] c ON c.item_id = i.item_id WHERE c.segment1 = 'Performance Chemicals')",
    # by today's classification (item_id), like every other fact and dim_item. the item_segment text on the row is the
    # segment at dispatch time: a product reclassified since would be in or out of scope differently from its order line
    "DispatchDetails": "[schedule_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # only the headers those details point at, so the fk always holds
    "Dispatches": "[header_id] IN (SELECT header_id FROM [CRMPROD].[dbo].[DispatchDetails] WHERE [schedule_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals'))",
    # ~393k of 2.6M
    "Schedules": "[schedule_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # ~17k of 126k
    "SocCancelDetails": "[creation_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # ~380k of 2.65M
    "QuotationDtls": "[creation_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals')",
    # only the headers those lines point at, so the fk always holds. ~225k of 1.19M
    "QuotationHdrs": "[header_id] IN (SELECT header_id FROM [CRMPROD].[dbo].[QuotationDtls] WHERE [creation_date] >= '2021-01-01' AND [item_id] IN (SELECT item_id FROM [CRMPROD].[dbo].[ItemCategories] WHERE [segment1] = 'Performance Chemicals'))",
    # the latest weekly run only (~0.3M of ~49M rows). run_id grows with every run and a run is one unbroken block,
    # so seek the top 2M ids on the clustered key and keep the run of the highest id: 2s instead of a 40s scan.
    # 2M is ~6 runs of headroom; if a run ever grows past it, raise the number
    "BIRawMaterialConsumptions": "[Run_Id] > (SELECT MAX([Run_Id]) FROM [CRMPROD].[dbo].[BIRawMaterialConsumptions]) - 2000000 "
                                 "AND [Creation_Date] = (SELECT [Creation_Date] FROM [CRMPROD].[dbo].[BIRawMaterialConsumptions] "
                                 "WHERE [Run_Id] = (SELECT MAX([Run_Id]) FROM [CRMPROD].[dbo].[BIRawMaterialConsumptions]))",
}




#------------------------------ Fix FK-related data on the stage table before insert -------------------------------------
STAGE_FIXES = {
    "CustomerMasters": [
        # 0 means no oracle account. null it so UNIQUE holds
        "UPDATE stage SET customer_id = NULL WHERE customer_id = 0",
        "UPDATE stage SET customer_number = NULL WHERE customer_number = 0",
    ],

#-------------------------------------------- user_and_scope -----------------------------------------------------
    "Users": [
        # the manager is a self link. 368 rows carry 0 or a user crm has deleted -> null.
        # checked against stage, not the table: upsert reads all users every run so the batch is complete
        '''UPDATE stage SET reporting_to_id = NULL
            WHERE reporting_to_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM stage s WHERE s.line_id = stage.reporting_to_id)''',
    ],
    "UserRoles": [
        # a role row for a user or role we don't have means nothing, drop it (both match 100% today)
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.user_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Roles" r WHERE r.line_id = stage.role_id)''',
        # one role per user is true today. if crm ever adds a second, keep the latest assignment so UNIQUE(user_id) holds
        "DELETE FROM stage a USING stage b WHERE a.user_id = b.user_id AND a.line_id < b.line_id",
    ],
    "UserMarketCircleMappings": [
        # no dedupe here: a user re-assigned to the same circle gets a new row with new dates, that is history we want.
        # a mapping to a user / circle we don't have means nothing, drop it (both match 100% today)
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.user_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.header_id = stage.market_circle_id)''',
    ],
    "UserCollectorMappings": [
        # crm holds the same (user, branch) pair up to 48 times, inserted in the same second. keep the first so the pair is unique
        "DELETE FROM stage a USING stage b WHERE a.user_id = b.user_id AND a.collector_id = b.collector_id AND a.header_id > b.header_id",
        # a mapping to a user / branch we don't have means nothing, drop it (both match 100% today)
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.user_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
    ],
    "UserCustomerMappings": [
        # 228 (user, customer) pairs sit there 2-3 times, all open, just re-inserted on a later date. keep the first so the pair is unique
        "DELETE FROM stage a USING stage b WHERE a.user_id = b.user_id AND a.customer_hdr_id = b.customer_hdr_id AND a.header_id > b.header_id",
        # 120 rows belong to 2 users crm has deleted, 4 rows have no customer (hdr 0). a mapping with one end missing means nothing
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.user_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.header_id = stage.customer_hdr_id)''',
    ],
    "CollectorMailMappings": [
        # one row per branch. no duplicates today, safety net for the unique
        "DELETE FROM stage a USING stage b WHERE a.collector_id = b.collector_id AND a.header_id > b.header_id",
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
        # the six chain columns are optional: a person crm no longer has -> nobody assigned. all match today
        '''UPDATE stage SET bm_user_id = NULL WHERE bm_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.bm_user_id)''',
        '''UPDATE stage SET rm_user_id = NULL WHERE rm_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.rm_user_id)''',
        '''UPDATE stage SET cm_user_id = NULL WHERE cm_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.cm_user_id)''',
        '''UPDATE stage SET bc_user_id = NULL WHERE bc_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.bc_user_id)''',
        '''UPDATE stage SET ed_user_id = NULL WHERE ed_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.ed_user_id)''',
        '''UPDATE stage SET gm_user_id = NULL WHERE gm_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.gm_user_id)''',
    ],
    "TechnicalUserSegmentMappings": [
        # a row for a user / role we don't have means nothing, drop it (both match 100% today)
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.user_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Roles" r WHERE r.line_id = stage.role_id)''',
        # the reporting line is optional
        '''UPDATE stage SET reporting_user_id = NULL
            WHERE reporting_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.reporting_user_id)''',
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
        # the site's own branch. null on ship-to sites in crm, 0 never seen, safety net for a branch crm no longer has
        '''UPDATE stage SET collector_id = NULL
            WHERE collector_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
    ],

    "tempcustomers": [
        # 27 leads have two rows, keep the later one so header_id is unique
        "DELETE FROM stage a USING stage b WHERE a.header_id = b.header_id AND a.line_id < b.line_id",
        # a lead crm has deleted (369 rows) -> nothing to attach the details to, drop
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.header_id = stage.header_id)''',
        # the lead's branch: 0 / gone -> null
        '''UPDATE stage SET collector_id = NULL
            WHERE collector_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
        # the lead's circle, same spelling rule as mc_code on sites
        "UPDATE stage SET market_circle = lower(trim(market_circle))",
        '''UPDATE stage SET market_circle = 'unknown'
            WHERE market_circle IS NULL OR market_circle = ''
               OR NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.market_circle)''',
    ],

    "ArCustomers": [
        # one row per oracle customer, all match today. a record for a customer we don't have means nothing, drop
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.customer_id = stage.customer_id)''',
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

    "SPBusinessPlanActualSales": [
        # both match 100% today. a row for a branch / customer we don't have means nothing, drop
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.customer_id = stage.customer_id)''',
    ],
    "SCBusinessPlanProjections": [
        # item_id is 0 on most rows: the product is the name. 0 is crm's OpeningBalance placeholder item, not a product
        "UPDATE stage SET item_id = NULL WHERE item_id = 0",
        '''UPDATE stage SET item_id = NULL
            WHERE item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ItemMasters" i WHERE i.item_id = stage.item_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
    ],
    "PcBusinessPlanReopens": [
        "UPDATE stage SET mc_code = lower(trim(mc_code))",
        '''UPDATE stage SET mc_code = 'unknown'
            WHERE mc_code IS NULL OR mc_code = '' OR NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.mc_code)''',
    ],
    "SCBusinessPlanLogs": [
        '''UPDATE stage SET header_id = NULL
            WHERE header_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "SCBusinessMonthlyPlanHdrs" h WHERE h.header_id = stage.header_id)''',
    ],
    "LeadDetails": [
        # the branch is a name. resolve it; 2% name a branch crm no longer has -> null
        '''UPDATE stage SET collector_id = c.collector_id
            FROM "Collectors" c WHERE upper(trim(c.name)) = upper(trim(stage.collector))''',
        # the user's circle, same spelling rule as everywhere: lower / trim, unknown when blank or no match
        "UPDATE stage SET user_mc_code = lower(trim(user_mc_code))",
        '''UPDATE stage SET user_mc_code = 'unknown'
            WHERE user_mc_code IS NULL OR user_mc_code = '' OR NOT EXISTS (SELECT 1 FROM "MarketCircles" m WHERE m.mc_code = stage.user_mc_code)''',
        # optional links: 0 / gone -> null
        '''UPDATE stage SET company = NULL
            WHERE company IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.header_id = stage.company)''',
        '''UPDATE stage SET assignleadchk = NULL
            WHERE assignleadchk IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u.line_id = stage.assignleadchk)''',
        '''UPDATE stage SET bill_to_site_use_id = NULL
            WHERE bill_to_site_use_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CustomerSites" s WHERE s.site_use_id = stage.bill_to_site_use_id)''',
        '''UPDATE stage SET close_reason_id = NULL
            WHERE close_reason_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Reasons" r WHERE r.header_id = stage.close_reason_id)''',
    ],
    "LeadProducts": [
        # productid is text: a real item id, TEMPnnn for a temp item, or 0. keep the text, derive the item
        "UPDATE stage SET item_id = productid::bigint WHERE productid ~ '^[0-9]+$' AND productid <> '0'",
        '''UPDATE stage SET item_id = NULL
            WHERE item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ItemMasters" i WHERE i.item_id = stage.item_id)''',
        "UPDATE stage SET temp_item_id = NULL WHERE temp_item_id = 0",
        # most temp products are written as TEMPnnn in productid with temp_item_id left at 0: nnn is the temp item id
        "UPDATE stage SET temp_item_id = substring(productid from 5)::bigint WHERE temp_item_id IS NULL AND productid ~ '^TEMP[0-9]+$'",
        '''UPDATE stage SET temp_item_id = NULL
            WHERE temp_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TempItemmasters" t WHERE t.temp_item_id = stage.temp_item_id)''',
        # a product row for a lead we don't have means nothing (all match today)
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "LeadDetails" l WHERE l.lead_id = stage.leadid)''',
    ],
    "TempItemmasters": [
        # org_item_master_id is 0 on most rows (crm's OpeningBalance placeholder item): not a real item
        "UPDATE stage SET org_item_master_id = NULL WHERE org_item_master_id = 0",
        '''UPDATE stage SET org_item_master_id = NULL
            WHERE org_item_master_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ItemMasters" i WHERE i.item_id = stage.org_item_master_id)''',
    ],
    "SCLeadTargets": [
        # on a temp item the id points at TempItemmasters, not ItemMasters: move it (no such row today)
        "UPDATE stage SET temp_item_id = item_id, item_id = NULL WHERE is_temp_item",
        '''UPDATE stage SET temp_item_id = NULL
            WHERE temp_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TempItemmasters" t WHERE t.temp_item_id = stage.temp_item_id)''',
        # every item resolves today, safety net
        '''UPDATE stage SET item_id = NULL
            WHERE item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ItemMasters" i WHERE i.item_id = stage.item_id)''',
        # a plan row for a lead we don't have means nothing (all match today)
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "LeadDetails" l WHERE l.lead_id = stage.lead_id)''',
    ],
    "SCLeadTargetJcDtls": [
        # a few rows carry jc 0 -> unknown journey cycle
        '''UPDATE stage SET jc_type = -1
            WHERE NOT EXISTS (SELECT 1 FROM "JourneyCalendars" c WHERE c.line_id = stage.jc_type)''',
        # a few point at lead plan rows crm has deleted, plus the snapshot race. blank them
        '''UPDATE stage SET header_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "SCLeadTargets" t WHERE t.header_id = stage.header_id)''',
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
    "BiStockDetail": [
        # warehouse not in the master -> unknown. 100% match today, safety net
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
        # crm gives no item id here, only the code. item_code is not unique in ItemMasters (3 codes with two ids,
        # none of them ever in stock) so take the latest id per code. every code in stock matches today
        '''UPDATE stage SET item_id = i.item_id
            FROM (SELECT DISTINCT ON (item_code) item_code, item_id
                    FROM "ItemMasters" ORDER BY item_code, item_id DESC) i
            WHERE i.item_code = stage.item_code''',
        "UPDATE stage SET item_id = -1 WHERE item_id IS NULL",
    ],
    "InventoryOrgs": [
        # home collector is 0 / empty on 83 warehouses, that is a real state -> null (the full mapping is BiCollectorInventoryOrgMapping)
        '''UPDATE stage SET collector_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
    ],
    "PurchaseRequisitionHdrs": [
        # 178 unfinished drafts carry supplier 0 -> null
        '''UPDATE stage SET supplier_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "ApSuppliers" a WHERE a.vendor_id = stage.supplier_id)''',
        # 48% carry collector 0 (raised centrally) -> null, that is a real state not a missing parent
        '''UPDATE stage SET collector_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
        # both warehouses match today, safety net
        '''UPDATE stage SET ship_to_inv_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.ship_to_inv_org_id)''',
        '''UPDATE stage SET bill_to_inv_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.bill_to_inv_org_id)''',
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
        # warehouse matches today, safety net
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
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
        # 4,591 lines carry warehouse 0 -> unknown
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
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
        # warehouse matches today, safety net
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
    ],

    "DispatchDetails": [
        # one row sits in year 9019, would break any date axis
        "UPDATE stage SET schedule_date = NULL WHERE schedule_date > '2027-12-31'",
        # header / schedule not loaded (created between the snapshots, or outside their filter). blank it, next run fixes it
        '''UPDATE stage SET header_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Dispatches" d WHERE d.header_id = stage.header_id)''',
        '''UPDATE stage SET schedule_line_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "Schedules" s WHERE s.line_id = stage.schedule_line_id)''',
        # a pc item shipped against an order line for a non pc item (a substitution): that line is outside our scope. blank it
        '''UPDATE stage SET sale_order_detail_line_id = NULL
            WHERE NOT EXISTS (SELECT 1 FROM "SaleOrderDtls" d WHERE d.line_id = stage.sale_order_detail_line_id)''',
        # warehouse matches today, safety net
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
    ],

    # warehouse matches on every row today. safety net so the fk never breaks a load
    "Dispatches": [
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
    ],
    "SocCancelDetails": [
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
    ],
    "BiPoDetails": [
        '''UPDATE stage SET inv_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inv_org_id)''',
    ],
    "BiGrnDetails": [
        # every one matches 100% today. safety nets so a new warehouse, vendor or customer never fails the load
        '''UPDATE stage SET inv_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inv_org_id)''',
        '''UPDATE stage SET from_inv_id = NULL
            WHERE from_inv_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.from_inv_id)''',
        '''UPDATE stage SET req_inv_id = NULL
            WHERE req_inv_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.req_inv_id)''',
        '''UPDATE stage SET customer_id = NULL
            WHERE customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "CustomerMasters" c WHERE c.customer_id = stage.customer_id)''',
        '''UPDATE stage SET vendor_id = NULL
            WHERE vendor_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ApSuppliers" a WHERE a.vendor_id = stage.vendor_id)''',
    ],
    "ItemInventoryOrgMappings": [
        # one item (509454) is mapped twice at two warehouses, identical rows. keep the earlier one so (item, warehouse) stays unique
        "DELETE FROM stage a USING stage b WHERE a.item_id = b.item_id AND a.inventory_org_id = b.inventory_org_id AND a.header_id > b.header_id",
        # both match 100% today, safety net
        '''UPDATE stage SET item_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "ItemMasters" i WHERE i.item_id = stage.item_id)''',
        '''UPDATE stage SET inventory_org_id = -1
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
    ],
    "BiCollectorInventoryOrgMapping": [
        # crm re-inserts a (collector, warehouse) pair with a new startdate instead of editing it, and never closes the old row.
        # 67 pairs sit there 2-3 times. keep the original (lowest header_id) so the pair is unique
        "DELETE FROM stage a USING stage b WHERE a.collector_id = b.collector_id AND a.inventory_org_id = b.inventory_org_id AND a.header_id > b.header_id",
        # both match 100% today. a mapping to a branch / warehouse we don't have is worthless, drop it (Collectors has no -1 row)
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "Collectors" c WHERE c.collector_id = stage.collector_id)''',
        '''DELETE FROM stage
            WHERE NOT EXISTS (SELECT 1 FROM "InventoryOrgs" w WHERE w.inventory_org_id = stage.inventory_org_id)''',
    ],
}


#------------------------------------- Catch-all parent rows -------------------------------------
SEED_ROWS = {
    "InventoryOrgs":   '''INSERT INTO "InventoryOrgs" (inventory_org_id, inventory_org_code, inventory_org_name, is_active)
                          VALUES (-1, 'unknown', 'unknown', false)
                          ON CONFLICT (inventory_org_id) DO NOTHING''',
    # for BiStockDetail.item_id when a stock code has no master row (none today)
    "ItemMasters":     '''INSERT INTO "ItemMasters" (item_id, item_code, item_description, status)
                          VALUES (-1, 'unknown', 'unknown', 'Inactive')
                          ON CONFLICT (item_id) DO NOTHING''',
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

#-------------------------------------------- user_and_scope -----------------------------------------------------
    "UserRoles":         [("user_id", "Users", "line_id"),
                          ("role_id", "Roles", "line_id")],
    "UserMarketCircleMappings": [("user_id",          "Users",         "line_id"),
                                 ("market_circle_id", "MarketCircles", "header_id")],
    "UserCollectorMappings":    [("user_id",      "Users",      "line_id"),
                                 ("collector_id", "Collectors", "collector_id")],
    "UserCustomerMappings":     [("user_id",         "Users",           "line_id"),
                                 ("customer_hdr_id", "CustomerMasters", "header_id")],
    "CollectorMailMappings":    [("collector_id", "Collectors", "collector_id"),
                                 ("bm_user_id",   "Users",      "line_id"),
                                 ("rm_user_id",   "Users",      "line_id"),
                                 ("cm_user_id",   "Users",      "line_id"),
                                 ("bc_user_id",   "Users",      "line_id"),
                                 ("ed_user_id",   "Users",      "line_id"),
                                 ("gm_user_id",   "Users",      "line_id")],
    "TechnicalUserSegmentMappings": [("user_id",           "Users", "line_id"),
                                     ("reporting_user_id", "Users", "line_id"),
                                     ("role_id",           "Roles", "line_id")],

#-------------------------------------------- sales_order_soc -----------------------------------------------------
    "SaleOrderHdrs":     [("customer_id",     "CustomerMasters", "customer_id"),
                          ("ship_to_site_id", "CustomerSites",   "site_use_id"),
                          ("bill_to_site_id", "CustomerSites",   "site_use_id")],
    "SaleOrderDtls":     [("header_id",        "SaleOrderHdrs",         "header_id"),
                          ("delivery_from_id", "DeliveryFroms",         "line_id"),
                          ("inventory_org_id", "InventoryOrgs", "inventory_org_id")],
    "SocPendingDetails": [("order_no",  "SaleOrderHdrs",   "header_id")],

#-------------------------------------------- customer_master -----------------------------------------------------
    "CustomerSites":     [("header_id",    "CustomerMasters", "header_id"),
                          ("collector_id", "Collectors",      "collector_id")],
    "tempcustomers":     [("header_id",    "CustomerMasters", "header_id"),
                          ("collector_id", "Collectors",      "collector_id")],
    "ArCustomers":       [("customer_id",  "CustomerMasters", "customer_id")],

#-------------------------------------------- dispatch_master -----------------------------------------------------
    "Dispatches":      [("sale_order_header_id",     "SaleOrderHdrs",   "header_id"),
                        ("customer_id",              "CustomerMasters", "customer_id"),
                        ("collector_id",             "Collectors",      "collector_id"),
                        ("ship_to_customer_site_id", "CustomerSites",   "site_use_id"),
                        ("bill_to_customer_site_id", "CustomerSites",   "site_use_id"),
                        ("inventory_org_id",         "InventoryOrgs", "inventory_org_id")],
    "SocCancelDetails": [("sale_order_detail_line_id", "SaleOrderDtls",   "line_id"),
                         ("sale_order_header_id",      "SaleOrderHdrs",   "header_id"),
                         ("item_id",                   "ItemMasters",     "item_id"),
                         ("customer_id",               "CustomerMasters", "customer_id"),
                         ("inventory_org_id",          "InventoryOrgs", "inventory_org_id"),
                         ("close_reason_id",           "Reasons",         "header_id")],
    "BiPoDetails":     [("inventory_item_id", "ItemMasters",           "item_id"),
                        ("vendor_id",         "ApSuppliers",           "vendor_id"),
                        ("inv_org_id",        "InventoryOrgs", "inventory_org_id")],
    "BiGrnDetails":    [("inventory_item_id", "ItemMasters",           "item_id"),
                        ("vendor_id",         "ApSuppliers",           "vendor_id"),
                        ("customer_id",       "CustomerMasters",       "customer_id"),
                        ("inv_org_id",        "InventoryOrgs", "inventory_org_id")],
    "InventoryOrgs":   [("collector_id",     "Collectors",    "collector_id")],
    "BiStockDetail":   [("inventory_org_id", "InventoryOrgs", "inventory_org_id")],
    "ItemInventoryOrgMappings": [("item_id",          "ItemMasters",   "item_id"),
                                 ("inventory_org_id", "InventoryOrgs", "inventory_org_id")],
    "BiCollectorInventoryOrgMapping": [("collector_id",     "Collectors",    "collector_id"),
                                       ("inventory_org_id", "InventoryOrgs", "inventory_org_id")],
    "ApSupplierSitesAlls": [("vendor_id", "ApSuppliers", "vendor_id")],
    "PurchaseRequisitionHdrs": [("collector_id",       "Collectors",            "collector_id"),
                                ("supplier_id",        "ApSuppliers",           "vendor_id"),
                                ("ship_to_inv_org_id", "InventoryOrgs", "inventory_org_id"),
                                ("bill_to_inv_org_id", "InventoryOrgs", "inventory_org_id")],
    "PurchaseRequisitionDtls": [("header_id",      "PurchaseRequisitionHdrs", "header_id"),
                                ("item_id",        "ItemMasters",             "item_id"),
                                ("customerid",     "CustomerMasters",         "customer_id"),
                                ("soccollectorid", "Collectors",              "collector_id")],
    "Schedules":       [("sale_order_detail_line_id", "SaleOrderDtls",   "line_id"),
                        ("sale_order_header_id",      "SaleOrderHdrs",   "header_id"),
                        ("item_id",                   "ItemMasters",     "item_id"),
                        ("customer_id",               "CustomerMasters", "customer_id"),
                        ("ship_to_customer_site_id",  "CustomerSites",   "site_use_id"),
                        ("bill_to_customer_site_id",  "CustomerSites",   "site_use_id"),
                        ("inventory_org_id",          "InventoryOrgs", "inventory_org_id")],

#-------------------------------------------- quotation_master -----------------------------------------------------
    "SPBusinessPlanActualSales": [("collector_id", "Collectors",      "collector_id"),
                                  ("customer_id",  "CustomerMasters", "customer_id")],
    "SCBusinessPlanProjections": [("collector_id", "Collectors",  "collector_id"),
                                  ("item_id",      "ItemMasters", "item_id")],
    "PcBusinessPlanReopens":    [("user_id",         "Users",           "line_id")],
    "SCBusinessPlanLogs":       [("header_id",       "SCBusinessMonthlyPlanHdrs", "header_id")],
    "SCBusinessMonthlyPlanHdrs": [("customer_id",     "CustomerMasters", "customer_id"),
                                  ("collector_id",    "Collectors",      "collector_id"),
                                  ("bill_to_site_id", "CustomerSites",   "site_use_id")],
    "TempItemmasters":    [("org_item_master_id", "ItemMasters", "item_id")],
    "LeadDetails":        [("company",             "CustomerMasters", "header_id"),
                           ("collector_id",        "Collectors",      "collector_id"),
                           ("assignleadchk",       "Users",           "line_id"),
                           ("bill_to_site_use_id", "CustomerSites",   "site_use_id"),
                           ("close_reason_id",     "Reasons",         "header_id")],
    "LeadProducts":       [("leadid",       "LeadDetails",     "lead_id"),
                           ("item_id",      "ItemMasters",     "item_id"),
                           ("temp_item_id", "TempItemmasters", "temp_item_id")],
    "SCLeadTargets":      [("lead_id",      "LeadDetails",     "lead_id"),
                           ("item_id",      "ItemMasters",     "item_id"),
                           ("temp_item_id", "TempItemmasters", "temp_item_id")],
    "SCLeadTargetJcDtls": [("header_id", "SCLeadTargets",    "header_id"),
                           ("jc_type",   "JourneyCalendars", "line_id")],
    "SCBusinessMonthlyPlanJCDtls": [("header_id", "SCBusinessMonthlyPlanDtls", "line_id"),
                                    ("jc_type",   "JourneyCalendars",          "line_id")],
    "SCBusinessMonthlyPlanDtls": [("header_id",    "SCBusinessMonthlyPlanHdrs", "header_id"),
                                  ("customer_id",  "CustomerMasters",           "customer_id"),
                                  ("collector_id", "Collectors",                "collector_id")],
    "QuotationHdrs":   [("collector_id",    "Collectors",      "collector_id"),
                        ("customer_id",     "CustomerMasters", "customer_id"),
                        ("ship_to_site_id", "CustomerSites",   "site_use_id"),
                        ("bill_to_site_id", "CustomerSites",   "site_use_id")],
    "QuotationDtls":   [("header_id",        "QuotationHdrs",         "header_id"),
                        ("item_id",          "ItemMasters",           "item_id"),
                        ("delivery_from_id", "DeliveryFroms",         "line_id"),
                        ("inventory_org_id", "InventoryOrgs", "inventory_org_id")],
    "DispatchDetails": [("sale_order_detail_line_id", "SaleOrderDtls",         "line_id"),
                        ("sale_order_header_id",      "SaleOrderHdrs",         "header_id"),
                        ("item_id",                   "ItemMasters",           "item_id"),
                        ("inventory_org_id",          "InventoryOrgs", "inventory_org_id")],
}


#---------------------------- Parent tables must load before child tables -------------------------------------
LOAD_LEVELS = [
#================================================ LEVEL 0 ===========================================================
    ["Collectors", "CustomerMasters", "ItemMasters", "DeliveryFroms",
     "QuotationStatus", "JourneyCalendars", "JcWeeklyCalendars", "ApSuppliers", "ApprovalStatus", "ApTermsTls", "Users", "Roles", "Reasons", "FinancialYears",
     "BIRawMaterialConsumptions"],   # no parents (Users only points at itself; the consumption feed carries codes, not ids)

#================================================ LEVEL 1 ===========================================================
    ["MarketCircles", "ItemCategories", "PurchaseRequisitionPtoPts", "InventoryOrgs", "ApSupplierSitesAlls",
     "UserRoles", "UserCollectorMappings", "UserCustomerMappings", "CollectorMailMappings", "TechnicalUserSegmentMappings",
     "ArCustomers", "SPBusinessPlanActualSales", "SCBusinessPlanProjections", "TempItemmasters"],   # need level 0 (InventoryOrgs -> Collectors, the user mappings -> Users / Roles / Collectors / CustomerMasters)

#================================================ LEVEL 2 ===========================================================
    ["CustomerSites", "BiPoDetails", "BiGrnDetails", "PurchaseRequisitionHdrs", "BiStockDetail",
     "ItemInventoryOrgMappings", "BiCollectorInventoryOrgMapping", "UserMarketCircleMappings", "tempcustomers", "PcBusinessPlanReopens"],                                                   # need MarketCircles / InventoryOrgs / TempItemmasters. BiStockDetail is large: 4 inner workers

#================================================ LEVEL 3 ===========================================================
    ["SaleOrderHdrs", "QuotationHdrs", "SCBusinessMonthlyPlanHdrs", "PurchaseRequisitionDtls", "LeadDetails"],   # need Collectors, CustomerMasters, CustomerSites (+ MarketCircles, QuotationStatus) / PurchaseRequisitionHdrs

#================================================ LEVEL 4 ===========================================================
    ["SaleOrderDtls", "SocPendingDetails", "Dispatches", "QuotationDtls", "SCBusinessMonthlyPlanDtls", "LeadProducts", "SCLeadTargets", "SCBusinessPlanLogs"],   # need the level 3 headers (+ ItemMasters / MarketCircles / sites)


#================================================ LEVEL 5 ===========================================================
    ["Schedules", "SocCancelDetails", "SCBusinessMonthlyPlanJCDtls", "SCLeadTargetJcDtls"],    # level 5, need SaleOrderDtls / SCBusinessMonthlyPlanDtls

#================================================ LEVEL 6 ===========================================================
    ["DispatchDetails"],                                                 # level 6, needs Schedules + Dispatches
]
