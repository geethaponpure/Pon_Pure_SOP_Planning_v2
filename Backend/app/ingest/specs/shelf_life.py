from app.ingest.spec import Col, FileSpec


# FG_Shelf_Life_days_QMS.xlsx, one row per finished good.

SHELF_LIFE = FileSpec(
    key="shelf_life",
    label="FG Shelf Life (QMS)",
    sheet="Sheet1",
    header_row=1,
    mode="replace",
    raw_table="raw_shelf_life",
    model_sql=("08_ingest_models.sql",),          # views over this table; plain views, nothing to refresh
    columns=(
        Col("Itemcode", "item_code", required=True),
        Col("Desc", "item_desc"),
        Col("SHELF_LIFE_DAYS", "shelf_life_days", "int", required=True, rule="> 0"),
        Col("SHELF_LIFE_CODE", "shelf_life_code", "int"),
        Col("CREATION_DATE", "created_at", "datetime"),
        Col("ATTRIBUTE1", "attribute1"),
        Col("PRIMARY_UNIT_OF_MEASURE", "primary_uom"),
    ),
    row_key=("item_code",),
)
