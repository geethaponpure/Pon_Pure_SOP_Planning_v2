from app.ingest.spec import Col, FileSpec


# BOM Extract.xlsx, sheet Output (the SQL sheet is the oracle query that made it, ignored).
# one row per component per substitute: a component with three substitutes is three rows,
# so substitute_item is part of the row key.

BOM_EXTRACT = FileSpec(
    key="bom_extract",
    label="BOM Extract",
    reader="xlsx",
    sheet="Output",
    header_row=1,
    mode="replace",
    raw_table="raw_bom_extract",
    dedupe_exact=True,                            # 3 identical lines in the extract: the query groups by
                                                  # substitute_component_id, which is not in the output
    columns=(
        Col("ORGANIZATION_ID", "organization_id", "int"),
        Col("ORGANIZATION_CODE", "organization_code", required=True),
        Col("ORGANIZATION_NAME", "organization_name"),
        Col("ASSEMBLY_ITEM", "assembly_item", required=True),
        Col("ASSEMBLY_DESC", "assembly_desc"),
        Col("BASIS_TYPE", "basis_type"),                                     # blank or 2, kept as text
        Col("ALTERNATE_BOM_DESIGNATOR", "alternate", required=True),       # 'Primary' or free text
                                                                             # (OSP, ALT1, RL_*, alt ...)
        Col("COMPONENT_ITEM_SEQ", "component_seq", "int", required=True),
        Col("OPERATION_SEQ_NUM", "operation_seq", "int", required=True),
        Col("WIP_SUPPLY_TYPE", "wip_supply_type"),                           # Push or null
        Col("COMPONENT_ITEM", "component_item", required=True),
        Col("COMP_ITEM_DESC", "component_desc"),
        Col("COMPONENT_QUANTITY", "component_qty", "float", required=True, rule=">= 0"),
        Col("SUBSTITUTE_ITEM", "substitute_item"),
        Col("SUBSTITUTE_ITEM_DESC", "substitute_desc"),
        Col("SUBSTITUTE_ITEM_QUANTITY", "substitute_qty", "float"),          # '' when no substitute
        Col("SUPPLY_SUBINVENTORY", "supply_subinventory"),
        Col("BOM_TYPE", "bom_type"),
        Col("DISABLE_DATE", "disable_date", "date"),                         # always null today, extract filters on it
        Col("SEGMENT1", "segment1"),
        Col("SEGMENT2", "segment2"),
        Col("SEGMENT3", "segment3"),
        Col("SEGMENT4", "segment4"),
        Col("SEGMENT5", "segment5"),
        Col("SEGMENT6", "segment6"),
        Col("BOM_CREATION_DATE", "bom_created_at", "datetime"),
    ),
    row_key=("organization_code", "assembly_item", "alternate", "component_seq",
             "operation_seq", "component_item", "substitute_item"),
)
