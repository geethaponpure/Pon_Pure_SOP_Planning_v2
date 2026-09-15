

TABLES_COLUMNS = {

#-------------------------------------------- Item / product master -------------------------------------------    
"item_master" : {
    "ItemMasters": [
        "item_id",
        "item_code",
        "item_description",
        "item_group",
        "uom",
        "uom_description",
        "status",
        "creation_date",
        "last_update_date",
    ],

    "ItemCategories": [
        "header_id",
        "category_id",
        "segment1",
        "segment2",
        "segment3",
        "segment4",
        "item_id",
        "creation_date",
        "last_update_date",
    ],

    "PurchaseRequisitionPtoPts": [
        "Header_id",
        "itemid",
        "itemcode",
        "customercount",
        "OverAllSaleQty",
        "CustomerSaleQty",
        "SalePercentage",
        "Actiontypes",
        "FromDate",
        "Todate",
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
}
}
