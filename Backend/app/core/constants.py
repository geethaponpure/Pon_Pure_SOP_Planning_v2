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
        "itemmasters",                      # 
        "ItemCategories",                   # 
        "PurchaseRequisitionPtoPts",        # 
    ],

    # ── Customer & sales-territory master ─────────────────────────────────
    "customer_master": [
        "CustomerMasters",                  # customer_id / number / name
        "CustomerSites",                    # Individual customer/business location
        "MarketCircles",                    # Territory/group/market assigned to a collector
        "Collectors",                       # Person responsible for customers/collections
    ],

    # ── Sales orders / SOC (open order book) ──────────────────────────────
    "sales_order_soc": [
        "SaleOrderHdrs",                    # SOC header
        "SaleOrderdtls",                    # SOC lines (status = 'OPEN')
        "SocPendingDetails",                # CRM's daily pending-SOC snapshot (Commit Risk)
        # "FnOrderDtlPending",              # TVF - pending order header
        # "FnScheduleDtlPending",           # TVF - pending schedule lines (balance qty)
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
        "BiPoDetails",                      # open PO in-transit (ordered - received - cancelled)
        "PurchaseRequisitionHdrs",          # requisition header (supplier)
        "PurchaseRequisitionDtls",          # requisition lines: unit_price vs lastpoprice (RM price)
    ],

    # ── Inventory / stock ─────────────────────────────────────────────────
    "inventory": [
        "BiStockDetail",                    # on-hand by org / subinv / lot + aging + item cost
    ],

    # ── Users, roles & data-scope mappings ────────────────────────────────
    "user_and_scope": [
        "Users",                            # dbo.Users - CRM user master
        "UserRoles",                        # user -> role link
        "Roles",                            # role master (Technical Head, Business Head, ...)
        "UserMarketCircleMappings",         # Sales Executive -> market circle
        "UserCustomerMappings",             # Technical Executive -> customer
        "TechnicalUserSegmentMappings",     # Technical Head/Manager -> segment + collectors
        "CollectorMailMappings",            # Branch Manager / Regional Manager -> collectors
        "SpAlertSegmentWorkflowHdrs",       # Division Head -> segment2
        "SpAlertSegmentWorkflowDtls",       # Business Head -> segment3/4 + collectors
    ],
}

