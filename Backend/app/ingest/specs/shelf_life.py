from app.ingest.spec import Col, FileSpec


# FG_Shelf_Life_days_QMS.xlsx, one row per finished good.

SHELF_LIFE = FileSpec(
    key="shelf_life",
    label="FG Shelf Life (QMS)",
    sheet=None,                                   # first sheet
    header_row=1,
    mode="replace",
    raw_table="raw_shelf_life",
    strict_headers=True,                          # a system extract: a missing column is a wrong export, not n/a
    model_sql=("08_ingest_models.sql",),          # views over this table; plain views, nothing to refresh
    columns=(
        Col("Itemcode", "item_code", required=True,
            help="The CRM item code of the finished product. One row per item.", example="MDBULKVOFSC00006"),
        Col("Desc", "item_desc",
            help="Product name. For reading only; the name in CRM is used.", example="VOOKI FLOOR+SURFACE CLEANER"),
        Col("SHELF_LIFE_DAYS", "shelf_life_days", "int", required=True, rule="> 0",
            help="Days from manufacture until the product expires.", example=360),
        Col("SHELF_LIFE_CODE", "shelf_life_code", "int",
            help="QMS shelf life control code, as QMS gives it.", example=1),
        Col("CREATION_DATE", "created_at", "datetime",
            help="When the shelf life was set up in QMS.", example="25-Jul-2018 15:09"),
        Col("ATTRIBUTE1", "attribute1",
            help="The product group QMS files it under.", example="FLOOR+SURFACE CLEANER - NPD"),
        Col("PRIMARY_UNIT_OF_MEASURE", "primary_uom",
            help="Unit of measure: Each, Litre, Kilogram ...", example="Litre"),
    ),
    row_key=("item_code",),
    notes=(
        "The upload is the complete shelf life list: it replaces the previous one in full.",
        "Every item code should appear once. Two rows for the same code with different values reject the file.",
    ),
)
