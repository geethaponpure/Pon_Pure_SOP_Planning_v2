-- ingest_models views: the excel uploads (app/ingest) made usable. bom, shelf life and plant cycle times, the
-- three things crm does not hold. run by app/repositories/views.py at api start, in file name order.
-- one statement per ';'.
--
-- what shapes this file:
--   only the current file counts   every upload stays in its raw_* table for history. ingest_files.is_current marks
--                                  the one in force: one per file type, one per plant for cycle time.
--   every row is kept              non performance chemicals rows (vooki / npd, general chemicals) are not dropped.
--                                  they carry is_pc = false. the pc filter is a WHERE in the screen that needs it.
--                                  cycle time needs them all: they run on the same equipment and use the same hours.
--   is_pc comes from dim_item      ItemCategories is loaded for performance chemicals only, so an item with no
--                                  category row is simply not pc. crm does classify it (npd, general chemicals, misc).
--   joined on item code            the files carry codes, not ids. a code is not unique in crm (three codes belong
--                                  to two products each), so v_item_by_code picks one product per code.


-- ---------------------------------------------------------------------------------------------------------------
-- v_item_by_code: one product per item code, for joining the uploaded files to dim_item.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_item_by_code CASCADE;

CREATE VIEW v_item_by_code AS
SELECT DISTINCT ON (item_code) *
FROM dim_item
WHERE item_code IS NOT NULL
ORDER BY item_code, is_performance_chemicals DESC, (is_active AND is_enabled) DESC, item_id;

COMMENT ON VIEW v_item_by_code IS 'dim_item with one row per item code. Where two products share a code, the performance chemicals one wins, then the active and enabled one, then the lower id. Used to join files that carry codes rather than ids.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_item_made_at_plant: which products each plant has actually produced, from crm's manufacturing feed.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_item_made_at_plant CASCADE;

CREATE VIEW v_item_made_at_plant AS
SELECT inventory_org_code                              AS warehouse_code,
       mfg_item_code                                   AS item_code,
       count(DISTINCT job_number)                      AS jobs,
       min(stock_age)::date                            AS first_made,
       max(stock_age)::date                            AS last_made
FROM "BIRawMaterialConsumptions"
WHERE mfg_item_code IS NOT NULL AND inventory_org_code IS NOT NULL
GROUP BY inventory_org_code, mfg_item_code;

COMMENT ON VIEW v_item_made_at_plant IS 'One row per plant and product the plant has made, from the latest run of crm''s manufacturing consumption feed (history back to 2018). The code is what the job produced: at PSM that is often the packed item itself, not a bulk item. A job reaches the feed only after an oracle-side event, usually within two weeks, so something made very recently may not be here yet.';
COMMENT ON COLUMN v_item_made_at_plant.warehouse_code IS 'The plant, joins dim_warehouse.warehouse_code (e.g. 753).';
COMMENT ON COLUMN v_item_made_at_plant.jobs IS 'Production jobs for this product at this plant.';
COMMENT ON COLUMN v_item_made_at_plant.first_made IS 'Completion date of the first job.';
COMMENT ON COLUMN v_item_made_at_plant.last_made IS 'Completion date of the latest job.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_item_shelf_life: how long a finished product keeps, from the qms shelf life file.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_item_shelf_life CASCADE;

CREATE VIEW v_item_shelf_life AS
SELECT i.item_id,
       s.item_code,
       coalesce(i.item_name, s.item_desc)              AS item_name,
       s.shelf_life_days,
       s.shelf_life_code,
       s.primary_uom,
       s.attribute1                                    AS qms_group,
       s.created_at                                    AS qms_created_at,
       coalesce(i.is_performance_chemicals, false)     AS is_pc,
       i.business,
       i.category,
       i.family,
       i.is_active,
       i.item_id IS NOT NULL                           AS in_item_master,
       s.file_id,
       f.uploaded_at                                   AS loaded_at
FROM raw_shelf_life s
JOIN ingest_files f ON f.file_id = s.file_id AND f.is_current
LEFT JOIN v_item_by_code i ON i.item_code = s.item_code;

COMMENT ON VIEW v_item_shelf_life IS 'Shelf life per finished product, from the current QMS shelf life upload. One row per item code. Every product in the file is here: is_pc is false for the Vooki / NPD and General Chemicals ones.';
COMMENT ON COLUMN v_item_shelf_life.item_id IS 'The product, joins dim_item and every fact. Empty when the code is not in the crm item master.';
COMMENT ON COLUMN v_item_shelf_life.item_name IS 'The crm product name, or the name in the file when crm does not know the code.';
COMMENT ON COLUMN v_item_shelf_life.shelf_life_days IS 'Days from manufacture until the product expires.';
COMMENT ON COLUMN v_item_shelf_life.shelf_life_code IS 'QMS shelf life control code, as in the file.';
COMMENT ON COLUMN v_item_shelf_life.qms_group IS 'The product group QMS files it under (ATTRIBUTE1 in the file).';
COMMENT ON COLUMN v_item_shelf_life.is_pc IS 'True for a Performance Chemicals product. Filter on this for pc screens; do not drop the rest here.';
COMMENT ON COLUMN v_item_shelf_life.in_item_master IS 'False when the file has a code crm does not know.';
COMMENT ON COLUMN v_item_shelf_life.file_id IS 'The upload these rows come from (ingest_files).';
COMMENT ON COLUMN v_item_shelf_life.loaded_at IS 'When that file was uploaded.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_bom_line: the bill of materials, one row per assembly, alternate, component and substitute.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_bom_line CASCADE;

CREATE VIEW v_bom_line AS
SELECT w.warehouse_id,
       b.organization_code                             AS warehouse_code,
       b.organization_name                             AS warehouse_name,
       a.item_id                                       AS assembly_item_id,
       b.assembly_item                                 AS assembly_item_code,
       b.assembly_desc                                 AS assembly_name,
       b.alternate,
       b.alternate = 'Primary'                         AS is_primary,
       b.component_seq,
       b.operation_seq,
       c.item_id                                       AS component_item_id,
       b.component_item                                AS component_item_code,
       b.component_desc                                AS component_name,
       b.component_qty,
       coalesce(b.basis_type = '2', false)             AS is_lot_basis,
       b.wip_supply_type,
       b.supply_subinventory,
       s.item_id                                       AS substitute_item_id,
       b.substitute_item                               AS substitute_item_code,
       b.substitute_desc                               AS substitute_name,
       b.substitute_qty,
       b.bom_type,
       b.segment1                                      AS assembly_segment,
       b.segment2                                      AS assembly_business,
       b.segment3                                      AS assembly_category,
       b.segment4                                      AS assembly_family,
       coalesce(a.is_performance_chemicals, false)     AS assembly_is_pc,
       coalesce(c.is_performance_chemicals, false)     AS component_is_pc,
       b.bom_created_at,
       b.file_id,
       b.row_no
FROM raw_bom_extract b
JOIN ingest_files f ON f.file_id = b.file_id AND f.is_current
LEFT JOIN dim_warehouse w ON w.warehouse_code = b.organization_code
LEFT JOIN v_item_by_code a ON a.item_code = b.assembly_item
LEFT JOIN v_item_by_code c ON c.item_code = b.component_item
LEFT JOIN v_item_by_code s ON s.item_code = b.substitute_item;

COMMENT ON VIEW v_bom_line IS 'Bill of materials from the current BOM extract: what goes into each product at each organisation. One row per assembly, alternate, component and substitute: a component with three substitutes is three rows, so to total component quantity take one row per component (substitute_item_code empty, or distinct component_seq). Covers Performance Chemicals and NPD assemblies.';
COMMENT ON COLUMN v_bom_line.warehouse_id IS 'The organisation the bill is defined in, joins dim_warehouse. PMO is the master organisation.';
COMMENT ON COLUMN v_bom_line.assembly_item_id IS 'The product being made. Joins dim_item.';
COMMENT ON COLUMN v_bom_line.alternate IS 'Primary, or the name of an alternate recipe (OSP, ALT1, RL_...). Free text in crm.';
COMMENT ON COLUMN v_bom_line.is_primary IS 'True for the primary recipe. Most planning uses only these.';
COMMENT ON COLUMN v_bom_line.component_item_id IS 'The ingredient or packing material. Joins dim_item.';
COMMENT ON COLUMN v_bom_line.component_qty IS 'Quantity of the component per one unit of the assembly, or per batch when is_lot_basis.';
COMMENT ON COLUMN v_bom_line.is_lot_basis IS 'True when component_qty is per batch (lot), not per unit made. Oracle basis type 2.';
COMMENT ON COLUMN v_bom_line.substitute_item_code IS 'An allowed replacement for the component, with its own quantity. Empty when there is none.';
COMMENT ON COLUMN v_bom_line.assembly_segment IS 'The assembly''s top level classification as the extract gives it: Performance Chemicals or NPD.';
COMMENT ON COLUMN v_bom_line.assembly_is_pc IS 'True when the assembly is a Performance Chemicals product in dim_item.';
COMMENT ON COLUMN v_bom_line.component_is_pc IS 'True when the component itself is classified Performance Chemicals (bulk intermediates are; most raw and packing materials are not).';
COMMENT ON COLUMN v_bom_line.row_no IS 'Excel row in the uploaded file, for tracing a line back to the sheet.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_cycle_time: how long one batch takes on one machine, per plant, from the plant cycle time sheets.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cycle_time CASCADE;

CREATE VIEW v_cycle_time AS
SELECT w.warehouse_id,
       w.warehouse_code,
       t.plant,
       i.item_id,
       t.item_code,
       t.product_name,
       i.item_name,
       coalesce(i.is_performance_chemicals, false)     AS is_pc,
       i.business,
       i.category,
       i.family,
       t.equipment_id,
       t.equipment_capacity_l,
       t.min_batch_kg,
       t.max_batch_kg,
       t.packing_size,
       t.packing_uom,
       t.rm_charging_hrs,
       t.mixing_hrs,
       t.analysis_hrs,
       t.correction_hrs,
       t.observation_hrs,
       t.reanalysis_hrs,
       t.packing_hrs,
       t.cleaning_hrs,
       t.cycle_hrs_with_cleaning,
       t.cycle_hrs_without_cleaning,
       CASE WHEN t.previous_cycle_time_raw ~ '^\d{1,3}:\d{2}:\d{2}$'
            THEN (extract(epoch FROM t.previous_cycle_time_raw::interval) / 3600)::double precision END AS previous_cycle_hrs,
       t.previous_cycle_time_raw,
       t.remarks,
       CASE WHEN t.item_code IS NULL          THEN 'missing'
            WHEN i.item_id IS NULL            THEN 'not in item master'
            WHEN NOT (i.is_active AND i.is_enabled) THEN 'inactive'
            -- only once the feed has been loaded, so an empty table does not flag every row
            WHEN m.item_code IS NULL AND EXISTS (SELECT 1 FROM "BIRawMaterialConsumptions")
                                              THEN 'not made at this plant'
            ELSE 'ok' END                      AS code_status,
       coalesce(m.jobs, 0)                             AS jobs_at_plant,
       m.last_made                                     AS last_made_at_plant,
       t.file_id,
       t.row_no,
       f.uploaded_at                                   AS loaded_at
FROM raw_cycle_time t
JOIN ingest_files f ON f.file_id = t.file_id AND f.is_current
LEFT JOIN dim_warehouse w ON w.warehouse_name = t.plant
LEFT JOIN v_item_by_code i ON i.item_code = t.item_code
LEFT JOIN v_item_made_at_plant m ON m.warehouse_code = w.warehouse_code AND m.item_code = t.item_code;

COMMENT ON VIEW v_cycle_time IS 'Batch cycle times per plant, product, machine and pack size, from the current sheet of each plant. Every row is kept: General Chemicals and Vooki products run on the same machines, so capacity must count them. Filter on is_pc only for pc screens.';
COMMENT ON COLUMN v_cycle_time.warehouse_id IS 'The plant, joins dim_warehouse. Empty when the Plant in the sheet is not spelled as crm names the organisation.';
COMMENT ON COLUMN v_cycle_time.plant IS 'The plant as written in the sheet (crm organisation name, e.g. PSM - Thervoykandigai MFG).';
COMMENT ON COLUMN v_cycle_time.item_id IS 'The bulk product made, joins dim_item. Empty when the sheet has no code or crm does not know it (see code_status).';
COMMENT ON COLUMN v_cycle_time.product_name IS 'The product as the plant names it. Can differ from the crm name (R&D trial and export lines).';
COMMENT ON COLUMN v_cycle_time.is_pc IS 'True for a Performance Chemicals product.';
COMMENT ON COLUMN v_cycle_time.equipment_id IS 'The vessel or machine. One product can run on several.';
COMMENT ON COLUMN v_cycle_time.equipment_capacity_l IS 'Vessel capacity in litres.';
COMMENT ON COLUMN v_cycle_time.packing_size IS 'Pack the batch is filled into, with packing_uom (LTRS, KGS, IBC). The same product and machine can have rows for several packs.';
COMMENT ON COLUMN v_cycle_time.cycle_hrs_with_cleaning IS 'Hours one batch occupies the machine including cleaning. The number to use for capacity.';
COMMENT ON COLUMN v_cycle_time.cycle_hrs_without_cleaning IS 'The same without cleaning time.';
COMMENT ON COLUMN v_cycle_time.previous_cycle_hrs IS 'The earlier cycle time in hours, where the sheet has it as a time (04:00:00). Empty otherwise.';
COMMENT ON COLUMN v_cycle_time.previous_cycle_time_raw IS 'That column exactly as typed. The plant also uses it for remarks, so it is not always a time.';
COMMENT ON COLUMN v_cycle_time.code_status IS 'ok, or why the item code needs a look: missing, not in item master, inactive, or not made at this plant (crm has no production job for this code at this plant - usually a wrong grade or pack; a brand new product will show here until its first job reaches the feed). A packed code is fine: at PSM many products are made straight into the pack.';
COMMENT ON COLUMN v_cycle_time.jobs_at_plant IS 'Production jobs crm has for this item code at this plant since 2018. 0 = never made here, as far as the feed shows.';
COMMENT ON COLUMN v_cycle_time.last_made_at_plant IS 'Completion date of the latest such job. Old = the plant has not made it for a while.';
COMMENT ON COLUMN v_cycle_time.row_no IS 'Excel row in that plant''s sheet.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_cycle_time_code_check: the cycle time rows whose item code needs someone to look at it.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_cycle_time_code_check CASCADE;

CREATE VIEW v_cycle_time_code_check AS
SELECT plant, row_no, product_name, item_code, item_name, code_status, is_pc, file_id
FROM v_cycle_time
WHERE code_status <> 'ok';

COMMENT ON VIEW v_cycle_time_code_check IS 'Cycle time rows to fix in the plant sheet: no item code, a code crm does not know or has deactivated, or a code the plant has never produced (usually the wrong grade or pack - look in v_item_made_at_plant for what the plant does make under that name). The rows still count in v_cycle_time; this is the to-do list for the next upload.';
