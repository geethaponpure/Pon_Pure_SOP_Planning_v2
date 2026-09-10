
#-------------------------------------------- Item / product master -------------------------------------------

item_master = {
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
}


#-------------------------------------------- Customer & sales-territory master ------------------------

customer_master = {
        "CustomerMasters",                  # customer_id / number / name
        "CustomerSites",                    # site -> mc_code (market circle), primary_flag
        "CustomerClassificationHeaders",    # customer classification header
        "CustomerClassificationDetails",    # Class / SubClass / Account_Year
        "MarketCircles",                    # mc_code, region, collector_id
        "Collectors",                       # collector id -> name
}