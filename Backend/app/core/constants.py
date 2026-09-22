CRM_TABLES = {

# ────────────────────────────── Item / product master ─────────────────────────────────────────────
    "item_master": [
        "itemmasters",                      
        "ItemCategories",                   
        "PurchaseRequisitionPtoPts",        
    ],

# ────────────────────────────── Customer & sales-territory master ─────────────────────────────────
    "customer_master": [
        "CustomerMasters",                  
        "CustomerSites",                   
        "MarketCircles",                   
        "Collectors",                      
        "tempcustomers",                    
        "ArCustomers",                      
        # "CustomerClassificationHeaders",
        # "CustomerClassificationDetails", 
        # "Companies", 
        # "PaymentTerms"
    ],

# ────────────────────────────── Sales orders / SOC (open order book) ──────────────────────────────
    "sales_order_soc": [
        "SaleOrderHdrs",                   
        "SaleOrderdtls",                   
        "SocPendingDetails",               
        # "FnOrderDtlPending",              
        # "FnScheduleDtlPending",           
    ],

# ────────────────────────────── Dispatch / billing history ────────────────────────────────────────
    "dispatch_master": [
        "DispatchDetails",                  
        "Dispatches",                       
        "Schedules",                        
        "SocCancelDetails",                 
        "DeliveryFroms",                    
        "Reasons",                          
        # "Billings",                       # invoice lines - add with finance scope
        # "DespatchDeliveryDates",          # actual delivery date per invoice line - add for OTIF
        # "FnDespatchDetails",              # TVF - dispatch cube (item x customer x collector x MC)
    ],

# ────────────────────────────── Quotation / pipeline ──────────────────────────────────────────────
    "quotation_master": [
        "QuotationHdrs",                    
        "QuotationDtls",                    
        "QuotationStatus",                  
        # "FnQuotationDetails",             # TVF - quote details (legacy adapter path)
    ],

# ────────────────────────────── Business plan / projection (S&OP demand) ──────────────────────────
    "business_plan": [
        "SCBusinessMonthlyPlanHdrs",        
        "SCBusinessMonthlyPlanDtls",        
        "SCBusinessMonthlyPlanJCDtls",      
        "JourneyCalendars",                 
        "SPBusinessPlanActualSales",        
        "SCBusinessPlanProjections",        
        "SCLeadTargets",                    
        "SCLeadTargetJcDtls",               
        "FinancialYears",                   
        "TempItemmasters",                  
        "LeadDetails",                      
        "LeadProducts",                     
    ],

# ────────────────────────────── Procurement / purchase ────────────────────────────────────────────
    "purchase_master": [
        "BiPoDetails",                      
        "PurchaseRequisitionHdrs",          
        "PurchaseRequisitionDtls",
        "ApSuppliers"                       
    ],

# ────────────────────────────── Inventory / stock ─────────────────────────────────────────────────
    "inventory_master": [
        "InventoryOrgs",                    
        "BiStockDetail",
        "ItemInventoryOrgMappings",         
        "BiCollectorInventoryOrgMapping"    
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

