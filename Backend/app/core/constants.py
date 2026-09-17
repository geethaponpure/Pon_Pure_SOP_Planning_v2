SQL_TO_PG_TYPES = {
    "bigint": "bigint",
    "int": "integer",
    "smallint": "smallint",
    "tinyint": "smallint",
    "bit": "boolean",
    "decimal": "numeric",
    "numeric": "numeric",
    "money": "numeric(19,4)",
    "smallmoney": "numeric(10,4)",
    "float": "double precision",
    "real": "real",
    "date": "date",
    "datetime": "timestamp",
    "datetime2": "timestamp",
    "smalldatetime": "timestamp",
    "datetimeoffset": "timestamptz",
    "time": "time",
    "char": "text",
    "nchar": "text",
    "varchar": "text",
    "nvarchar": "text",
    "text": "text",
    "ntext": "text",
    "uniqueidentifier": "uuid",
    "binary": "bytea",
    "varbinary": "bytea",
    "image": "bytea",
    "xml": "xml",
}


CRM_TABLES = {

    # ── Item / product master ─────────────────────────────────────────────
    "item_master": [
        "itemmasters",                      # The main product/item master.
        "ItemCategories",                   # Assigns a category/segment/classification to an item.
        "PurchaseRequisitionPtoPts",        # Stores purchase requisition / PTO-PTS related item requirements.
    ],

    # ── Customer & sales-territory master ─────────────────────────────────
    "customer_master": [
        "CustomerMasters",                  # Stores the main/customer-level information like customer_id / number / name
        "CustomerSites",                    # Stores the individual locations/sites of customers.
        "MarketCircles",                    # Defines the market/sales circles assigned to collectors.
        "Collectors",                       # Person responsible for customers/collections
    ],

    # ── Sales orders / SOC (open order book) ──────────────────────────────
    "sales_order_soc": [
        "SaleOrderHdrs",                    #Order header/history
        "SaleOrderdtls",                    #Order line items
        "SocPendingDetails",                #Current open-order/SOC snapshot
        # "FnOrderDtlPending",              
        # "FnScheduleDtlPending",           
    ],

    # ── Dispatch / billing history ────────────────────────────────────────
    "dispatch": [
        "dispatchdetails",                  # dispatched qty per SOC line
        # "FnDespatchDetails",              # TVF - dispatch cube (item x customer x collector x MC)
    ],

    # ── Quotation / pipeline ──────────────────────────────────────────────
    "quotation": [
        "QuotationHdrs",                    # quote header (status_id, customer, collector)
        "QuotationDtls",                    # quote lines (qty, value)
        "QuotationStatus",                  # status master (open vs won/lost)
        # "FnQuotationDetails",             # TVF - quote details (legacy adapter path)
    ],

    # ── Business plan / projection (S&OP demand) ──────────────────────────
    "business_plan": [
        "SCBusinessMonthlyPlanHdrs",        # plan header + annual potential/budget + JC status
        "SCBusinessMonthlyPlanDtls",        # per-JC week1/week2 user-defined qty
        "SCBusinessMonthlyPlanJCDtls",      # next-month-1 / next-month-2 JC qty
        "JourneyCalendars",                 # JC master (name, effective_from/to, active/closed)
    ],

    # ── Procurement / purchase ────────────────────────────────────────────
    "purchase": [
        "BiPoDetails",                      
        "PurchaseRequisitionHdrs",          
        "PurchaseRequisitionDtls",          
    ],

    # ── Inventory / stock ─────────────────────────────────────────────────
    "inventory": [
        "BiStockDetail",                    
    ],

    # ── Users, roles & data-scope mappings ────────────────────────────────
    "user_and_scope": [
        "Users",                            
        "UserRoles",                        
        "Roles",                            
        "UserMarketCircleMappings",         
        "UserCustomerMappings",             
        "TechnicalUserSegmentMappings",     
        "CollectorMailMappings",            
        "SpAlertSegmentWorkflowHdrs",       
        "SpAlertSegmentWorkflowDtls",       
    ],
}

