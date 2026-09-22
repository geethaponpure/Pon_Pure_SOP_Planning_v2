CRM_TABLES = {

# ────────────────────────────── Item / product master ─────────────────────────────────────────────
    "item_master": [
        "itemmasters",                      # The main product/item master.
        "ItemCategories",                   # Assigns a category/segment/classification to an item.
        "PurchaseRequisitionPtoPts",        # monthly PTO / PTS classification per item (purchase-to-order vs to-stock), from sales concentration. not a requisition
    ],

# ────────────────────────────── Customer & sales-territory master ─────────────────────────────────
    "customer_master": [
        "CustomerMasters",                  # Stores the main/customer-level information like customer_id / number / name
        "CustomerSites",                    # Stores the individual locations/sites of customers.
        "MarketCircles",                    # Defines the market/sales circles assigned to collectors.
        "Collectors",                       # Person responsible for customers/collections
        "tempcustomers",                    # the lead's details: branch, circle, industry segment (leads have no sites)
        "ArCustomers",                      # oracle's customer record: legal form, industrial segment, division
        # "CustomerClassificationHeaders",
        # "CustomerClassificationDetails", 
        # "Companies", 
        # "PaymentTerms"
    ],

# ────────────────────────────── Sales orders / SOC (open order book) ──────────────────────────────
    "sales_order_soc": [
        "SaleOrderHdrs",                    #Order header/history
        "SaleOrderdtls",                    #Order line items
        "SocPendingDetails",                #Current open-order/SOC snapshot
        # "FnOrderDtlPending",              
        # "FnScheduleDtlPending",           
    ],

# ────────────────────────────── Dispatch / billing history ────────────────────────────────────────
    "dispatch_master": [
        "DispatchDetails",                  # dispatched qty per SOC line (what shipped)
        "Dispatches",                       # dispatch note header: invoice no/date, status, cancel flag
        "Schedules",                        # planned dispatch per SOC line, with reschedules and status
        "SocCancelDetails",                 # cancelled / closed SOC lines, remaining qty and reason
        "DeliveryFroms",                    # delivery point lookup for SaleOrderDtls.delivery_from_id
        "Reasons",                          # reason lookup: the soc cancel reasons (and the other screens' reasons, small)
        # "Billings",                       # invoice lines - add with finance scope
        # "DespatchDeliveryDates",          # actual delivery date per invoice line - add for OTIF
        # "FnDespatchDetails",              # TVF - dispatch cube (item x customer x collector x MC)
    ],

# ────────────────────────────── Quotation / pipeline ──────────────────────────────────────────────
    "quotation_master": [
        "QuotationHdrs",                    # quote header (status_id, customer, collector)
        "QuotationDtls",                    # quote lines (qty, value)
        "QuotationStatus",                  # status master (open vs won/lost)
        # "FnQuotationDetails",             # TVF - quote details (legacy adapter path)
    ],

# ────────────────────────────── Business plan / projection (S&OP demand) ──────────────────────────
    "business_plan": [
        "SCBusinessMonthlyPlanHdrs",        # plan header + annual potential/budget + JC status
        "SCBusinessMonthlyPlanDtls",        # 13-JC detailed plan, per-JC week1/week2 user-defined qty
        "SCBusinessMonthlyPlanJCDtls",      # Next-month forecast for this JC, next-month-1 / next-month-2 JC qty
        "JourneyCalendars",                 # What JC is this?, JC master (name, effective_from/to, active/closed)
        "SPBusinessPlanActualSales",        # crm's own actuals for the plan: oracle invoice qty per JC, by product name
        "SCBusinessPlanProjections",        # the approved projection per branch x product x JC (what goes to oracle)
        "SCLeadTargets",                    # the lead plan: per lead x product x JC (branch / customer via LeadDetails)
        "SCLeadTargetJcDtls",               # rolling forecast on the lead plan
        "FinancialYears",                   # the accounting years apr - mar
        "TempItemmasters",                  # products planned before they exist in the item master
        "LeadDetails",                      # the leads: branch, customer, status. the lead plan and lead products hang off it
        "LeadProducts",                     # the products a lead is about, with the lead quantity (crm's open-lead qty)
    ],

# ────────────────────────────── Procurement / purchase ────────────────────────────────────────────
    "purchase_master": [
        "BiPoDetails",                      
        "PurchaseRequisitionHdrs",          
        "PurchaseRequisitionDtls",
        "ApSuppliers"                       #Who are the companies/people/organizations that Pon Pure can purchase from or has registered as a vendor?
    ],

# ────────────────────────────── Inventory / stock ─────────────────────────────────────────────────
    "inventory_master": [
        "InventoryOrgs",                    # warehouse master, replaces InventoryOrgLocations (same 186 ids, richer)
        "BiStockDetail",
        "ItemInventoryOrgMappings",         # which item may be stocked at which warehouse
        "BiCollectorInventoryOrgMapping"    # which warehouse serves which collector
    ],

# ────────────────────────────── Users, roles & data-scope mappings ────────────────────────────────
    "user_and_scope": [
        "Users",                            
        "UserRoles",                        
        "Roles",                            
        "UserMarketCircleMappings",
        "UserCollectorMappings",         
        "UserCustomerMappings",             
        "TechnicalUserSegmentMappings",     
        "CollectorMailMappings",            
        # "SpAlertSegmentWorkflowHdrs",       
        # "SpAlertSegmentWorkflowDtls",       
    ],
}

