from app.ingest.spec import Col, FileSpec


# PPS Products Cycle Time <date>.xlsx, one sheet per plant. first sheet is read whatever its
# name; the header row is found by header_row="auto".
# Plant must be the same on every row and is written as crm names the org
# (InventoryOrgs.inventory_org_name, e.g. PSM - Thervoykandigai MFG). an upload replaces only
# the earlier sheet of that plant.
# Item Code is the item the plant actually produces - at PSM often the packed item itself, since
# many products are filled straight into the pack. it is the link to crm: division, category, bom
# and sales all come from there, so the sheet carries no division / category. it is optional:
# every row loads, because non-PC products (General Chemicals, Vooki) run on the same equipment
# and count for capacity, and a product can be new before crm has a code for it. the sql model
# flags rows with no code, an unknown code, or a code never made at that plant.
# the row key therefore uses the product name, which every row has.
# pack size is a number plus its unit in UOM (50 + LTRS): one product runs on one machine in
# several pack sizes, so both are in the row key.
# Sl No is left out on purpose: it is only a running number, and without it a row pasted twice
# is an exact duplicate and is dropped by dedupe_exact.

HRS = "Hours for this step of one batch. Decimals allowed (0.5 = half an hour)."

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
        Col("Plant", "plant", required=True,
            help="The plant, spelled exactly as CRM names it. The same on every row: one file per plant.",
            example="PSM - Thervoykandigai MFG"),
        Col("Item Code", "item_code",                                        # blank allowed, flagged in the views
            help="CRM code of the item this plant actually produces - often the packed item. "
                 "Leave blank only if CRM has no code yet; such rows are flagged for checking.",
            example="MTPCBULK00000900"),
        Col("PRODUCT NAME", "product_name", required=True,
            help="Product name as the plant knows it.", example="PUREPRINT BINDER FLR"),
        Col("Equipment ID", "equipment_id", required=True,
            help="The vessel or machine. A product on two machines is two rows.", example="HSD-01"),
        Col("Equipment Capacity (L)", "equipment_capacity_l", "float", null_values=("-",),
            help="Vessel capacity in litres, number only (no 'L').", example=200),
        Col("MIN BATCH SIZE (IN KGS)", "min_batch_kg", "float", null_values=("-",),
            help="Smallest batch in kg, number only. '-' if not applicable.", example=200),
        Col("MAX BATCH SIZE (IN KGS)", "max_batch_kg", "float", required=True, rule="> 0",
            help="Largest batch in kg, number only. Needed to turn demand into batches for capacity.", example=200),
        Col("PACKING SIZE", "packing_size", "float", required=True, rule="> 0",
            help="Pack the batch is filled into, number only. The unit goes in UOM.", example=50),
        Col("UOM", "packing_uom", required=True,                             # LTRS / KGS / IBC
            help="Unit of the pack size: LTRS, KGS or IBC.", example="LTRS"),
        Col("RM Charging Hrs", "rm_charging_hrs", "float", help=HRS, example=1),
        Col("Mixing Hrs", "mixing_hrs", "float", help=HRS, example=1),
        Col("Analysis Hrs", "analysis_hrs", "float", help=HRS, example=0.5),
        Col("Correction Hrs", "correction_hrs", "float", help=HRS, example=0.5),
        Col("Observation HRS", "observation_hrs", "float", help=HRS, example=0),
        Col("Reanalysis Hrs", "reanalysis_hrs", "float", help=HRS, example=0.5),
        Col("Labeling & Packing Hrs", "packing_hrs", "float", help=HRS, example=1),
        Col("EQUIPMENT CLEANING TIME (IN HRS)", "cleaning_hrs", "float",
            help="Hours to clean the vessel after the batch.", example=0.25),
        Col("CYCLE TIME EQUIPMENT WITH CLEANING(IN HRS)", "cycle_hrs_with_cleaning", "float",
            required=True, rule="> 0",
            help="Total hours one batch occupies the machine, cleaning included. This is the number used for capacity.",
            example=4.75),
        Col("CYCLE TIME EQUIPMENT WITH OUT CLEANING TIME(IN HRS)", "cycle_hrs_without_cleaning", "float",
            help="The same total without cleaning.", example=4.5),
        Col("PREVIOUS CYCLE TIME (IN HRS)", "previous_cycle_time_raw",      # 04:00:00, or plant remarks
            help="The earlier cycle time as a time (04:00:00), if there was one.", example="04:00:00"),
        Col("REMARKS", "remarks",
            help="Any note about the product or batch.", example=""),
    ),
    row_key=("plant", "product_name", "equipment_id", "packing_size", "packing_uom"),
    notes=(
        "Always upload the full list for your plant. Products left out of the file disappear from the tool.",
        "One row per product, machine and pack size.",
        "Formulas are fine (for example the cycle time as a SUM of the steps), but save the file in Excel before uploading.",
        "A Sl No column may be kept; it is ignored.",
    ),
)
