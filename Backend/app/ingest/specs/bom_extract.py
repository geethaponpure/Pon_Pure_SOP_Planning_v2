from app.ingest.spec import Col, FileSpec


# BOM Extract.xlsx, first sheet (Output; the SQL sheet after it is the oracle query that made it, ignored).
# one row per component per substitute: a component with three substitutes is three rows,
# so substitute_item is part of the row key.

BOM_EXTRACT = FileSpec(
    key="bom_extract",
    label="BOM Extract",
    sheet=None,                                   # first sheet (the extract has Output first, SQL second)
    header_row=1,
    mode="replace",
    raw_table="raw_bom_extract",
    model_sql=("08_ingest_models.sql",),          # views over this table; plain views, nothing to refresh
    strict_headers=True,                          # a system extract: a missing column is a wrong export, not n/a
    dedupe_exact=True,                            # 3 identical lines in the extract: the query groups by
                                                  # substitute_component_id, which is not in the output
    columns=(
        Col("ORGANIZATION_ID", "organization_id", "int",
            help="Oracle id of the organisation the bill is defined in.", example=753),
        Col("ORGANIZATION_CODE", "organization_code", required=True,
            help="Organisation code. PMO is the master organisation.", example="753"),
        Col("ORGANIZATION_NAME", "organization_name",
            help="Organisation name.", example="PSM - Thervoykandigai MFG"),
        Col("ASSEMBLY_ITEM", "assembly_item", required=True,
            help="Item code of the product being made.", example="MCPCBULK00000016"),
        Col("ASSEMBLY_DESC", "assembly_desc",
            help="Name of the product being made.", example="PURCAT S 146"),
        Col("BASIS_TYPE", "basis_type",                                      # blank or 2, kept as text
            help="Blank = quantity per unit made. 2 = quantity per batch.", example=""),
        Col("ALTERNATE_BOM_DESIGNATOR", "alternate", required=True,        # 'Primary' or free text
            help="Primary, or the name of the alternate recipe (ALT1, OSP, RL_...).", example="Primary"),
        Col("COMPONENT_ITEM_SEQ", "component_seq", "int", required=True,
            help="Line number of the component in the bill.", example=10),
        Col("OPERATION_SEQ_NUM", "operation_seq", "int", required=True,
            help="Operation step the component is used in.", example=1),
        Col("WIP_SUPPLY_TYPE", "wip_supply_type",                            # Push or null
            help="How the component is issued to the job (Push), or blank.", example="Push"),
        Col("COMPONENT_ITEM", "component_item", required=True,
            help="Item code of the ingredient or packing material.", example="TD04HDCB00050043"),
        Col("COMP_ITEM_DESC", "component_desc",
            help="Name of the component.", example="ASPP001"),
        Col("COMPONENT_QUANTITY", "component_qty", "float", required=True, rule=">= 0",
            help="Quantity of the component per unit made (per batch when BASIS_TYPE is 2).", example=0.4),
        Col("SUBSTITUTE_ITEM", "substitute_item",
            help="Item code of an allowed replacement for the component. Blank if none.", example="TDBNAX0000IPA001"),
        Col("SUBSTITUTE_ITEM_DESC", "substitute_desc",
            help="Name of the substitute.", example="ISO PROPYL ALCOHOL"),
        Col("SUBSTITUTE_ITEM_QUANTITY", "substitute_qty", "float",          # '' when no substitute
            help="Quantity of the substitute, used instead of the component quantity.", example=0.6),
        Col("SUPPLY_SUBINVENTORY", "supply_subinventory",
            help="Sub-inventory the component is taken from.", example="WIP"),
        Col("BOM_TYPE", "bom_type",
            help="MFG, REPACK or RELABLE.", example="MFG"),
        Col("DISABLE_DATE", "disable_date", "date",                          # always null today, extract filters on it
            help="Date the component line stops being used. Usually blank.", example=""),
        Col("SEGMENT1", "segment1", help="Product division, e.g. Performance Chemicals.", example="Performance Chemicals"),
        Col("SEGMENT2", "segment2", help="Business.", example="PNC Division"),
        Col("SEGMENT3", "segment3", help="Category.", example="Pure Chemicals"),
        Col("SEGMENT4", "segment4", help="Family.", example="Catalyst"),
        Col("SEGMENT5", "segment5", help="Usually blank.", example=""),
        Col("SEGMENT6", "segment6", help="Usually blank.", example=""),
        Col("BOM_CREATION_DATE", "bom_created_at", "datetime",
            help="When the bill was created in Oracle.", example="10-Jun-2025 22:58"),
    ),
    row_key=("organization_code", "assembly_item", "alternate", "component_seq",
             "operation_seq", "component_item", "substitute_item"),
    notes=(
        "Paste the Oracle BOM extract into the first sheet. Other sheets (such as the SQL sheet) are ignored.",
        "The upload is the complete BOM: it replaces the previous one in full.",
        "One row per component per substitute: a component with three substitutes is three rows.",
        "Rows that are identical in every column are dropped automatically.",
    ),
)
