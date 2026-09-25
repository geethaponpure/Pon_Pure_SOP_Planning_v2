from app.ingest.spec import Col, FileSpec


# PPS Products Cycle Time <date>.xlsx, one sheet per plant. first sheet is read whatever its
# name; the header row is found by header_row="auto".
# Plant must be the same on every row and is written as crm names the org
# (InventoryOrgs.inventory_org_name, e.g. PSM - Thervoykandigai MFG). an upload replaces only
# the earlier sheet of that plant.
# Item Code is the bulk (manufactured) item, the link to crm: division, category, bom and sales
# all come from there, so the sheet no longer carries division / category. it is optional:
# every row loads, because non-PC products (General Chemicals, Vooki) run on the same equipment
# and count for capacity, and a product can be new before crm has a code for it. the sql model
# flags rows with no code or a code missing from ItemMasters, and sets is_pc from ItemCategories.
# the row key therefore uses the product name, which every row has.
# pack size is a number plus its unit in UOM (50 + LTRS): one product runs on one machine in
# several pack sizes, so both are in the row key.
# Sl No is left out on purpose: it is only a running number, and without it a row pasted twice
# is an exact duplicate and is dropped by dedupe_exact.

CYCLE_TIME = FileSpec(
    key="cycle_time",
    label="PPS Products Cycle Time",
    header_row="auto",
    mode="append",
    scope_column="plant",
    raw_table="raw_cycle_time",
    model_sql=("08_ingest_models.sql",),          # views over this table; plain views, nothing to refresh
    dedupe_exact=True,
    columns=(
        Col("Plant", "plant", required=True),
        Col("Item Code", "item_code"),                                       # bulk item; blank allowed
        Col("PRODUCT NAME", "product_name", required=True),
        Col("Equipment ID", "equipment_id", required=True),
        Col("Equipment Capacity (L)", "equipment_capacity_l", "float", null_values=("-",)),
        Col("MIN BATCH SIZE (IN KGS)", "min_batch_kg", "float", null_values=("-",)),
        Col("MAX BATCH SIZE (IN KGS)", "max_batch_kg", "float", null_values=("-",)),
        Col("PACKING SIZE", "packing_size", "float", required=True, rule="> 0"),
        Col("UOM", "packing_uom", required=True),                            # LTRS / KGS / IBC
        Col("RM Charging Hrs", "rm_charging_hrs", "float"),
        Col("Mixing Hrs", "mixing_hrs", "float"),
        Col("Analysis Hrs", "analysis_hrs", "float"),
        Col("Correction Hrs", "correction_hrs", "float"),
        Col("Observation HRS", "observation_hrs", "float"),
        Col("Reanalysis Hrs", "reanalysis_hrs", "float"),
        Col("Labeling & Packing Hrs", "packing_hrs", "float"),
        Col("EQUIPMENT CLEANING TIME (IN HRS)", "cleaning_hrs", "float"),
        Col("CYCLE TIME EQUIPMENT WITH CLEANING(IN HRS)", "cycle_hrs_with_cleaning", "float",
            required=True, rule="> 0"),
        Col("CYCLE TIME EQUIPMENT WITH OUT CLEANING TIME(IN HRS)", "cycle_hrs_without_cleaning", "float"),
        Col("PREVIOUS CYCLE TIME (IN HRS)", "previous_cycle_time_raw"),      # 04:00:00, or plant remarks
        Col("REMARKS", "remarks"),
    ),
    row_key=("plant", "product_name", "equipment_id", "packing_size", "packing_uom"),
)
