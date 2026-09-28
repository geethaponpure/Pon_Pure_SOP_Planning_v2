-- inventory_master views: what stock we hold, whether it can be sold, how old it is, and how long it will last.
-- run by app/repositories/views.py at api start, in file name order. one statement per ';'.
--
-- what shapes this file (measured sep 2026):
--   an opening balance       BiStockDetail row dated X is the position at the START of X, one row per
--                            day x warehouse x item x sub-inventory x lot (the grain is unique).
--   weekly, then daily       before 15 nov 2024 only five to seven snapshots a month were kept (TypeOfTrx
--                            FIRST_DAY / FRIDAY / JC_START_DATE); daily since. anything measured over
--                            time starts in the daily era.
--   crm decides sellable     crm's own not-for-sale list (LotSubinventoryRestriction) is applied as
--                            subinventory_code NOT IN (...), case-insensitive because sql server is.
--                            it misses Expired / Rejected / Non Moving, which are treated as unsellable too.
--   lot age is not shelf age aging_date is the lot's ORIGINAL receipt date, carried unchanged through every
--                            transfer. time at this warehouse comes from the first sighting here.
--   shelf life              only for manufactured bulk items (qms file), reached from a packed item through
--                            the bom. traded and imported goods have none recorded anywhere - by decision
--                            their expiry stays empty.
--   scope                    performance chemicals from 2024. 62 warehouses hold pc stock; 128 hold any stock.


-- ---------------------------------------------------------------------------------------------------------------
-- dim_subinventory: what kind of stock a sub-inventory holds, and whether it can be sold.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS dim_subinventory CASCADE;

CREATE MATERIALIZED VIEW dim_subinventory AS
WITH codes AS (
    SELECT DISTINCT subinventory_code AS code FROM "BiStockDetail" WHERE subinventory_code IS NOT NULL
),
restricted AS (
    -- crm keeps case variants (LOSS / Loss) that sql server treats as one code; so do we
    SELECT lower(btrim(sub_inv_code)) AS key, min(creation_date)::date AS listed_on
    FROM "LotSubinventoryRestriction"
    GROUP BY 1
)
SELECT c.code                                          AS subinventory_code,
       CASE
           WHEN r.key IS NOT NULL                                           THEN 'crm restricted'
           WHEN lower(c.code) IN ('expired', 'rejected', 'non moving')       THEN 'unsellable, not in crm list'
           WHEN lower(c.code) IN ('wip', 'shop floor', 're-process')         THEN 'production floor'
           WHEN lower(c.code) = 'transport'                                 THEN 'in transit'
           WHEN c.code ILIKE 'pkg-%'                                        THEN 'packaging'
           ELSE 'sellable'
       END                                             AS stock_class,
       r.key IS NULL
         AND lower(c.code) NOT IN ('expired', 'rejected', 'non moving', 'wip', 'shop floor', 're-process', 'transport')
         AND c.code NOT ILIKE 'pkg-%'                  AS is_sellable,
       r.key IS NOT NULL                               AS is_crm_restricted,
       r.listed_on                                     AS crm_restricted_since
FROM codes c
LEFT JOIN restricted r ON r.key = lower(btrim(c.code));

CREATE UNIQUE INDEX dim_subinventory_pk ON dim_subinventory (subinventory_code);

COMMENT ON MATERIALIZED VIEW dim_subinventory IS 'Every sub-inventory that has held stock, and what kind of stock sits there. CRM has no flag for this on the stock itself: whether stock can be sold is decided by CRM''s own not-for-sale list, which its stock check applies by code. Use stock_class rather than just is_sellable - stock in transit is on its way and counts as incoming, not as nothing.';
COMMENT ON COLUMN dim_subinventory.stock_class IS 'sellable; crm restricted (on CRM''s own not-for-sale list - quarantine, returns, rework, unreconciled, samples, scrap and the rest); unsellable, not in crm list (Expired, Rejected, Non Moving - CRM''s list omits them but they plainly cannot be sold); production floor (WIP, shop floor, re-process); in transit (Transport - on its way to this warehouse); packaging (empty and cleaned drums).';
COMMENT ON COLUMN dim_subinventory.is_sellable IS 'True only for the sellable class. This is the stock a planner can promise to a customer.';
COMMENT ON COLUMN dim_subinventory.is_crm_restricted IS 'On CRM''s own not-for-sale list, matched without regard to case or spacing exactly as CRM''s database does. MKT B2B is deliberately NOT restricted: the list holds a row reading "MKT B2B- This was removed ..." - someone''s note that it was taken off, typed into the code field instead of deleting the row.';
COMMENT ON COLUMN dim_subinventory.crm_restricted_since IS 'When CRM added the code to its list. Stock history before that date was sellable by CRM''s rule at the time.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_item_shelf_life_resolved: the shelf life that applies to an item, following the bom down to the bulk item
-- that carries it. only manufactured bulk items are in the qms file.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_item_shelf_life_resolved CASCADE;

CREATE VIEW v_item_shelf_life_resolved AS
WITH RECURSIVE walk AS (
    -- every item that has a primary bom, walked down its components level by level
    SELECT b.assembly_item_code AS item_code, b.component_item_code AS reached, 1 AS depth
    FROM v_bom_line b WHERE b.is_primary
    UNION
    SELECT w.item_code, b.component_item_code, w.depth + 1
    FROM walk w
    JOIN v_bom_line b ON b.assembly_item_code = w.reached AND b.is_primary
    WHERE w.depth < 10
),
via_bom AS (
    -- the nearest level that reaches an item with a shelf life; the shortest life there, to be safe
    SELECT DISTINCT ON (w.item_code) w.item_code, s.shelf_life_days, w.depth, s.item_code AS bulk_item_code
    FROM walk w JOIN v_item_shelf_life s ON s.item_code = w.reached
    ORDER BY w.item_code, w.depth, s.shelf_life_days
)
SELECT s.item_code, s.shelf_life_days, 'direct' AS route, 0 AS bom_depth, s.item_code AS bulk_item_code
FROM v_item_shelf_life s
UNION ALL
SELECT v.item_code, v.shelf_life_days, 'via bom', v.depth, v.bulk_item_code
FROM via_bom v
WHERE NOT EXISTS (SELECT 1 FROM v_item_shelf_life s WHERE s.item_code = v.item_code);

COMMENT ON VIEW v_item_shelf_life_resolved IS 'The shelf life that applies to an item. The quality team records it only for manufactured bulk items, so a packed product takes the shelf life of the bulk item it is filled from, found by walking its bill of materials down. Traded and imported goods have no shelf life recorded anywhere, so they are simply absent here.';
COMMENT ON COLUMN v_item_shelf_life_resolved.route IS 'direct: the item itself is in the quality team''s file. via bom: taken from the bulk item it is made from.';
COMMENT ON COLUMN v_item_shelf_life_resolved.bom_depth IS 'How many bill-of-materials levels down the bulk item sits. Where several components carry a shelf life, the nearest level and the shortest life win.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_stock_daily: the daily position, with its class, value and age. a plain view over the loaded table.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_stock_daily CASCADE;

CREATE VIEW fact_stock_daily AS
SELECT s.trans_date                                    AS stock_date,
       s.inventory_org_id                              AS warehouse_id,
       s.item_id,
       s.item_code,
       s.subinventory_code,
       nullif(btrim(s.lot_number), '')                 AS lot_number,
       k.stock_class,
       k.is_sellable,
       s.opening_qty                                   AS quantity,
       s.item_cost                                     AS unit_cost,
       s.opening_qty * coalesce(s.item_cost, 0)        AS stock_value,
       s.aging_date                                    AS lot_received_on,
       s.trans_date - s.aging_date                     AS lot_age_days,
       coalesce(s.typeoftrx, 'weekly era')             AS snapshot_type,
       s.trans_date >= DATE '2024-11-15'               AS daily_resolution
FROM "BiStockDetail" s
LEFT JOIN dim_subinventory k ON k.subinventory_code = s.subinventory_code;

COMMENT ON VIEW fact_stock_daily IS 'Stock on hand at the start of each day, per warehouse, item, sub-inventory and lot - one row each, the grain is unique. The table is an opening balance: a row dated X is the position on the morning of X. Before mid November 2024 only a handful of snapshots a month were kept, so filter on daily_resolution before measuring anything over time.';
COMMENT ON COLUMN fact_stock_daily.stock_date IS 'The morning this position was taken.';
COMMENT ON COLUMN fact_stock_daily.stock_value IS 'Quantity times the item cost. Every class is valued, so quarantined and expired stock show in rupees as well as units.';
COMMENT ON COLUMN fact_stock_daily.lot_received_on IS 'When the lot was first received into the business - its original receipt, carried unchanged through every transfer. Not the day it reached this warehouse.';
COMMENT ON COLUMN fact_stock_daily.lot_age_days IS 'How old the lot is. For time at this particular warehouse see fact_stock_lot.';
COMMENT ON COLUMN fact_stock_daily.snapshot_type IS 'Why this day was kept: DailyBasics, FRIDAY, FIRST_DAY or JC_START_DATE. "weekly era" before November 2024, when only the weekly kinds were kept and CRM did not record which.';
COMMENT ON COLUMN fact_stock_daily.daily_resolution IS 'The table was daily by this date (from 15 November 2024). Before that, a gap between two rows is days or weeks, not one day.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_stock_position: today, per warehouse x item, split by class - in units and in rupees.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_stock_position CASCADE;

CREATE MATERIALIZED VIEW fact_stock_position AS
WITH today AS (
    SELECT * FROM fact_stock_daily WHERE stock_date = (SELECT max(trans_date) FROM "BiStockDetail")
)
SELECT t.warehouse_id,
       t.item_id,
       min(t.stock_date)                               AS as_of,
       sum(t.quantity)                                 AS total_qty,
       sum(t.quantity)    FILTER (WHERE t.stock_class = 'sellable')                    AS sellable_qty,
       sum(t.quantity)    FILTER (WHERE t.stock_class = 'crm restricted')              AS restricted_qty,
       sum(t.quantity)    FILTER (WHERE t.stock_class = 'unsellable, not in crm list') AS unsellable_qty,
       sum(t.quantity)    FILTER (WHERE t.stock_class = 'production floor')            AS production_qty,
       sum(t.quantity)    FILTER (WHERE t.stock_class = 'in transit')                  AS in_transit_qty,
       sum(t.quantity)    FILTER (WHERE t.stock_class = 'packaging')                   AS packaging_qty,
       sum(t.stock_value)                              AS total_value,
       sum(t.stock_value) FILTER (WHERE t.stock_class = 'sellable')                    AS sellable_value,
       sum(t.stock_value) FILTER (WHERE t.stock_class = 'crm restricted')              AS restricted_value,
       sum(t.stock_value) FILTER (WHERE t.stock_class = 'unsellable, not in crm list') AS unsellable_value,
       sum(t.stock_value) FILTER (WHERE t.stock_class = 'production floor')            AS production_value,
       sum(t.stock_value) FILTER (WHERE t.stock_class = 'in transit')                  AS in_transit_value,
       sum(t.stock_value) FILTER (WHERE t.stock_class = 'packaging')                   AS packaging_value,
       count(*)                                        AS lots,
       max(t.lot_age_days)                             AS oldest_lot_age_days
FROM today t
GROUP BY t.warehouse_id, t.item_id;

CREATE UNIQUE INDEX fact_stock_position_pk ON fact_stock_position (warehouse_id, item_id);
CREATE INDEX fact_stock_position_item ON fact_stock_position (item_id);

COMMENT ON MATERIALIZED VIEW fact_stock_position IS 'Stock on hand this morning, per warehouse and item, split by what kind of stock it is - in units and in rupees. Only the sellable column is stock a customer can be promised; summing total_qty counts quarantined, expired and returned stock as though it could be sold.';
COMMENT ON COLUMN fact_stock_position.sellable_qty IS 'Stock that can be sold today. The number to plan against.';
COMMENT ON COLUMN fact_stock_position.restricted_qty IS 'On CRM''s own not-for-sale list: quarantine, returns, rework, unreconciled, samples, scrap and the like.';
COMMENT ON COLUMN fact_stock_position.unsellable_qty IS 'Expired, rejected or non-moving - not on CRM''s list, but not sellable either.';
COMMENT ON COLUMN fact_stock_position.in_transit_qty IS 'On its way to this warehouse. Counts as incoming supply, not stock on the shelf.';
COMMENT ON COLUMN fact_stock_position.oldest_lot_age_days IS 'Age of the oldest lot here, from its original receipt into the business.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_stock_lot: today at lot grain - how old each lot is, how long it has sat HERE, and when it expires.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_stock_lot CASCADE;

CREATE MATERIALIZED VIEW fact_stock_lot AS
WITH stock_from AS (
    SELECT min(trans_date) AS first_day FROM "BiStockDetail"
),
first_here AS (
    -- the first morning this lot of this item was seen at this warehouse
    SELECT inventory_org_id, item_id, btrim(lot_number) AS lot_number, min(trans_date) AS first_seen
    FROM "BiStockDetail"
    WHERE nullif(btrim(lot_number), '') IS NOT NULL
    GROUP BY 1, 2, 3
)
SELECT t.warehouse_id,
       t.item_id,
       t.item_code,
       t.subinventory_code,
       t.lot_number,
       t.stock_class,
       t.is_sellable,
       t.quantity,
       t.unit_cost,
       t.stock_value,
       t.stock_date                                    AS as_of,
       t.lot_received_on,
       t.lot_age_days,
       CASE
           WHEN t.lot_age_days <= 30  THEN '0-30 days'
           WHEN t.lot_age_days <= 90  THEN '31-90 days'
           WHEN t.lot_age_days <= 180 THEN '91-180 days'
           WHEN t.lot_age_days <= 365 THEN '181-365 days'
           ELSE 'over a year'
       END                                             AS lot_age_band,
       -- the snapshot is the morning position, so the lot arrived the day before it was first seen
       f.first_seen - 1                                AS arrived_here_on,
       t.stock_date - (f.first_seen - 1)               AS days_at_warehouse,
       -- a lot already here on the very first snapshot arrived some time before the stock history starts
       f.first_seen = k.first_day                      AS arrived_before_history,
       sl.shelf_life_days,
       sl.route                                        AS shelf_life_route,
       t.lot_received_on + sl.shelf_life_days::int          AS expires_on,
       (t.lot_received_on + sl.shelf_life_days::int) - t.stock_date AS days_to_expiry,
       t.lot_received_on + sl.shelf_life_days::int < t.stock_date   AS is_expired
FROM fact_stock_daily t
CROSS JOIN stock_from k
LEFT JOIN first_here f ON f.inventory_org_id = t.warehouse_id
                      AND f.item_id = t.item_id
                      AND f.lot_number = t.lot_number
LEFT JOIN v_item_shelf_life_resolved sl ON sl.item_code = t.item_code
WHERE t.stock_date = (SELECT max(trans_date) FROM "BiStockDetail");

CREATE UNIQUE INDEX fact_stock_lot_pk ON fact_stock_lot (warehouse_id, item_id, subinventory_code, lot_number);
CREATE INDEX fact_stock_lot_age ON fact_stock_lot (lot_age_band);

COMMENT ON MATERIALIZED VIEW fact_stock_lot IS 'Every lot on hand this morning, with two different ages and an expiry date. Lot age runs from the lot''s original receipt into the business; days at warehouse runs from when it reached this warehouse - a lot can be old and freshly arrived, after a transfer. Expiry is known only for manufactured goods.';
COMMENT ON COLUMN fact_stock_lot.lot_age_days IS 'Days since the lot was first received into the business, carried unchanged through transfers.';
COMMENT ON COLUMN fact_stock_lot.days_at_warehouse IS 'Days this lot has sat at this warehouse, from the first morning it was seen here. Read it with arrived_before_history: for a lot already here when the stock history began, this is a floor, not the true figure.';
COMMENT ON COLUMN fact_stock_lot.arrived_before_history IS 'The lot was already here on the first day of the stock history (January 2024), so the true arrival is earlier and days_at_warehouse understates it.';
COMMENT ON COLUMN fact_stock_lot.expires_on IS 'Original receipt plus the shelf life. Known only for manufactured goods: directly for bulk items, and through the bill of materials for packed ones. Traded and imported goods have no shelf life recorded anywhere, so this stays empty for them by decision.';
COMMENT ON COLUMN fact_stock_lot.is_expired IS 'Past its expiry date this morning. Null where no shelf life is known.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_stock_movement: how stock changed from one morning to the next, per warehouse and item.
-- the only consumption signal for raw material at the plants, which the bom layer needs.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_stock_movement CASCADE;

CREATE MATERIALIZED VIEW fact_stock_movement AS
WITH daily AS (
    -- daily era only: before it a "previous day" is a week away
    SELECT trans_date, inventory_org_id, item_id, sum(opening_qty) AS qty
    FROM "BiStockDetail"
    WHERE trans_date >= DATE '2024-11-15'
    GROUP BY 1, 2, 3
),
days AS (
    SELECT trans_date AS day, lag(trans_date) OVER (ORDER BY trans_date) AS prev_day
    FROM (SELECT DISTINCT trans_date FROM daily) x
),
both_mornings AS (
    -- an item that runs out has no row the next morning, so compare the two mornings as a pair
    SELECT d.day, d.prev_day, a.inventory_org_id, a.item_id, a.qty AS qty_now, 0 AS qty_before
    FROM days d JOIN daily a ON a.trans_date = d.day
    WHERE d.prev_day IS NOT NULL
    UNION ALL
    SELECT d.day, d.prev_day, a.inventory_org_id, a.item_id, 0, a.qty
    FROM days d JOIN daily a ON a.trans_date = d.prev_day
)
SELECT day                                             AS stock_date,
       prev_day                                        AS previous_date,
       day - prev_day                                  AS gap_days,
       inventory_org_id                                AS warehouse_id,
       item_id,
       sum(qty_before)                                 AS qty_before,
       sum(qty_now)                                    AS qty_after,
       sum(qty_now) - sum(qty_before)                  AS change_qty,
       CASE WHEN sum(qty_now) > sum(qty_before) THEN 'increase' ELSE 'decrease' END AS direction
FROM both_mornings
GROUP BY day, prev_day, inventory_org_id, item_id
HAVING sum(qty_now) <> sum(qty_before);

CREATE UNIQUE INDEX fact_stock_movement_pk ON fact_stock_movement (stock_date, warehouse_id, item_id);
CREATE INDEX fact_stock_movement_item ON fact_stock_movement (item_id, stock_date);

COMMENT ON MATERIALIZED VIEW fact_stock_movement IS 'How much stock of an item changed at a warehouse between one morning and the next, in the daily era only. Only days with a change are kept - on most days nothing moves. A decrease is stock issued (sold, consumed, transferred out); an increase is stock received. It is the net of the day, so a receipt and an issue on the same day partly cancel. For raw material at the plants this is the only consumption signal there is.';
COMMENT ON COLUMN fact_stock_movement.stock_date IS 'The morning the new position was taken. The movement itself happened during the previous day.';
COMMENT ON COLUMN fact_stock_movement.gap_days IS 'Days since the previous snapshot. Nearly always one; more where CRM skipped a day, in which case the change covers several days.';
COMMENT ON COLUMN fact_stock_movement.change_qty IS 'Net change across every sub-inventory at the warehouse. Moves between sub-inventories inside one warehouse cancel out, which is the point.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_item_warehouse_scope: the planning universe - which item may be stocked where, and whether it is.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_item_warehouse_scope CASCADE;

CREATE VIEW v_item_warehouse_scope AS
SELECT m.item_id,
       m.inventory_org_id                              AS warehouse_id,
       coalesce(m.enabled_flag = 'Y', false)           AS is_stockable,
       coalesce(m.internal_order_enabled_flag = 'Y', false) AS transfer_in_allowed,
       p.item_id IS NOT NULL                           AS holds_stock_today,
       coalesce(p.sellable_qty, 0)                     AS sellable_qty,
       coalesce(p.total_value, 0)                      AS stock_value,
       m.last_update_date                              AS mapping_updated_at
FROM "ItemInventoryOrgMappings" m
LEFT JOIN fact_stock_position p ON p.item_id = m.item_id AND p.warehouse_id = m.inventory_org_id;

COMMENT ON VIEW v_item_warehouse_scope IS 'Every item and warehouse pair CRM allows, and whether it holds stock this morning. The planning universe: stock never sits on a pair outside it. Most pairs are allowed but empty, which is normal.';
COMMENT ON COLUMN v_item_warehouse_scope.is_stockable IS 'The item may be stocked here. A handful of pairs are switched off.';
COMMENT ON COLUMN v_item_warehouse_scope.transfer_in_allowed IS 'Stock of this item may be transferred INTO this warehouse. Off on about one pair in eleven - a replenishment plan must respect it.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_branch_warehouse: which warehouses a branch actually ships from, measured from twelve months of dispatches.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_branch_warehouse CASCADE;

CREATE VIEW v_branch_warehouse AS
WITH shipped AS (
    SELECT d.collector_id, d.inventory_org_id AS warehouse_id,
           count(*)                                    AS dispatch_lines,
           sum(d.quantity)                             AS quantity,
           sum(d.line_value)                           AS value_
    FROM fact_dispatch d
    WHERE d.counts_as_dispatched AND d.is_demand
      AND d.dispatch_date >= current_date - 365
      AND d.collector_id IS NOT NULL AND d.inventory_org_id IS NOT NULL
    GROUP BY 1, 2
)
SELECT s.collector_id,
       c.branch_name,
       s.warehouse_id,
       w.warehouse_name,
       s.dispatch_lines,
       s.quantity,
       s.value_                                        AS dispatched_value,
       s.quantity / nullif(sum(s.quantity) OVER (PARTITION BY s.collector_id), 0) AS quantity_share,
       s.value_ / nullif(sum(s.value_) OVER (PARTITION BY s.collector_id), 0)     AS value_share,
       row_number() OVER (PARTITION BY s.collector_id ORDER BY s.value_ DESC NULLS LAST) = 1 AS is_main_warehouse,
       EXISTS (SELECT 1 FROM "BiCollectorInventoryOrgMapping" m
               WHERE m.collector_id = s.collector_id AND m.inventory_org_id = s.warehouse_id) AS is_crm_mapped
FROM shipped s
LEFT JOIN dim_collector c ON c.collector_id = s.collector_id
LEFT JOIN dim_warehouse w ON w.warehouse_id = s.warehouse_id;

COMMENT ON VIEW v_branch_warehouse IS 'Which warehouses each branch actually ships its customers from, and in what share, over the last twelve months of dispatches. Measured rather than configured: CRM''s own branch-to-warehouse table covers only part of the branches, and nearly every branch ships from more than one warehouse. is_crm_mapped says whether CRM''s configuration knows about the pair.';
COMMENT ON COLUMN v_branch_warehouse.quantity_share IS 'This warehouse''s share of everything the branch dispatched. A branch''s main warehouse typically carries about three quarters.';
COMMENT ON COLUMN v_branch_warehouse.is_main_warehouse IS 'The warehouse the branch ships the most value from. Value, not quantity: quantities of different items are in different units and cannot be added fairly.';
COMMENT ON COLUMN v_branch_warehouse.is_crm_mapped IS 'CRM''s own configuration lists this pair. False means the branch ships from a warehouse its configuration does not mention - common, and not an error.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_stock_cover: will we run out. sellable stock, less what is already promised, against how fast it sells.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_stock_cover CASCADE;

CREATE VIEW v_stock_cover AS
WITH demand AS (
    -- the last ninety days of real customer dispatches: inside the daily era, and recent enough to be current
    SELECT d.inventory_org_id AS warehouse_id, d.item_id,
           sum(d.quantity) / 90.0                      AS avg_daily_demand
    FROM fact_dispatch d
    WHERE d.counts_as_dispatched AND d.is_demand
      AND d.dispatch_date > current_date - 90
    GROUP BY 1, 2
),
issued AS (
    -- everything that left the warehouse, whatever the reason: sales, transfers out to branches, plant
    -- consumption. plants and ports mostly feed other warehouses rather than sell, so for them this is
    -- the real rate of use.
    SELECT warehouse_id, item_id, sum(-change_qty) / 90.0 AS avg_daily_issue
    FROM fact_stock_movement
    WHERE direction = 'decrease' AND stock_date > current_date - 90
    GROUP BY 1, 2
),
promised AS (
    -- open orders already promised against this stock, and the part of them due by today
    SELECT s.inventory_org_id AS warehouse_id, s.item_id,
           sum(s.balance_qty)                          AS open_order_qty,
           sum(s.balance_qty) FILTER (WHERE s.effective_date::date <= current_date) AS open_order_due_qty
    FROM fact_schedule_line s
    WHERE s.is_open AND s.is_demand AND NOT s.has_pending_cancellation
    GROUP BY 1, 2
),
on_order AS (
    -- live purchase orders; the abandoned ones are not coming
    SELECT warehouse_id, item_id, sum(pending_qty) AS open_po_qty, min(expected_on) AS next_po_expected_on
    FROM v_open_po
    WHERE NOT is_abandoned
    GROUP BY 1, 2
),
expired AS (
    -- lots past their shelf life that still sit in a sellable area. whether they are really unusable is a
    -- quality question (a retest may extend the life), so they stay in sellable stock and are shown beside it
    SELECT warehouse_id, item_id, sum(quantity) AS sellable_expired_qty
    FROM fact_stock_lot
    WHERE is_expired AND is_sellable
    GROUP BY 1, 2
),
pairs AS (
    SELECT warehouse_id, item_id FROM fact_stock_position
    UNION SELECT warehouse_id, item_id FROM demand
    UNION SELECT warehouse_id, item_id FROM promised
    UNION SELECT warehouse_id, item_id FROM on_order
),
base AS (
    SELECT k.warehouse_id,
           k.item_id,
           coalesce(p.sellable_qty, 0)                 AS sellable_qty,
           coalesce(o.open_order_qty, 0)               AS open_order_qty,
           coalesce(o.open_order_due_qty, 0)           AS open_order_due_qty,
           coalesce(p.sellable_qty, 0) - coalesce(o.open_order_qty, 0) AS available_to_promise,
           coalesce(p.sellable_qty, 0) - coalesce(o.open_order_due_qty, 0) AS available_to_promise_now,
           coalesce(x.sellable_expired_qty, 0)         AS sellable_expired_qty,
           coalesce(p.in_transit_qty, 0)               AS in_transit_qty,
           coalesce(q.open_po_qty, 0)                  AS open_po_qty,
           q.next_po_expected_on,
           d.avg_daily_demand,
           iss.avg_daily_issue,
           -- whichever is faster: customer sales, or everything that leaves. a branch that mostly passes an
           -- item on to other branches sells slowly but empties fast, and must be judged on the faster rate
           greatest(d.avg_daily_demand, iss.avg_daily_issue) AS daily_rate,
           CASE WHEN iss.avg_daily_issue > coalesce(d.avg_daily_demand, 0) THEN 'all outflows'
                WHEN d.avg_daily_demand IS NOT NULL             THEN 'customer dispatches'
           END                                         AS rate_basis
    FROM pairs k
    LEFT JOIN fact_stock_position p ON p.warehouse_id = k.warehouse_id AND p.item_id = k.item_id
    LEFT JOIN demand d   ON d.warehouse_id = k.warehouse_id AND d.item_id = k.item_id
    LEFT JOIN issued iss ON iss.warehouse_id = k.warehouse_id AND iss.item_id = k.item_id
    LEFT JOIN promised o ON o.warehouse_id = k.warehouse_id AND o.item_id = k.item_id
    LEFT JOIN on_order q ON q.warehouse_id = k.warehouse_id AND q.item_id = k.item_id
    LEFT JOIN expired x  ON x.warehouse_id = k.warehouse_id AND x.item_id = k.item_id
)
SELECT b.warehouse_id,
       w.warehouse_name,
       w.is_plant,
       w.is_port,
       b.item_id,
       i.item_code,
       i.item_name,
       i.business,
       b.sellable_qty,
       b.open_order_qty,
       b.open_order_due_qty,
       b.available_to_promise,
       b.available_to_promise_now,
       b.available_to_promise_now < 0                  AS over_promised_now,
       b.sellable_expired_qty,
       b.in_transit_qty,
       b.open_po_qty,
       b.next_po_expected_on,
       b.avg_daily_demand,
       b.avg_daily_issue,
       b.daily_rate,
       b.rate_basis,
       b.sellable_qty / nullif(b.daily_rate, 0)        AS cover_days_on_hand,
       b.available_to_promise / nullif(b.daily_rate, 0) AS cover_days_available,
       (b.available_to_promise + b.in_transit_qty + b.open_po_qty) / nullif(b.daily_rate, 0)
                                                       AS cover_days_with_incoming,
       CASE
           WHEN b.available_to_promise_now < 0               THEN 'over-promised'
           WHEN b.available_to_promise < 0                   THEN 'over-promised by future orders'
           WHEN b.daily_rate IS NULL                         THEN 'not moving'
           WHEN b.available_to_promise / b.daily_rate < 15   THEN 'under 15 days'
           WHEN b.available_to_promise / b.daily_rate < 45   THEN '15 to 45 days'
           ELSE 'over 45 days'
       END                                             AS cover_status
FROM base b
LEFT JOIN dim_warehouse w ON w.warehouse_id = b.warehouse_id
LEFT JOIN dim_item i ON i.item_id = b.item_id;

COMMENT ON VIEW v_stock_cover IS 'How many days of sales the stock covers, per warehouse and item. Built on stock that can actually be promised: sellable stock minus the open orders already promised against it - open orders are around a third of sellable stock, so cover on raw stock on hand overstates badly. A plain view, not materialized: the open book changes daily.';
COMMENT ON COLUMN v_stock_cover.available_to_promise IS 'Sellable stock minus open customer orders not pending cancellation. Negative means more is promised than is on the shelf.';
COMMENT ON COLUMN v_stock_cover.avg_daily_demand IS 'Average daily quantity dispatched to customers over the last ninety days. Null where nothing was dispatched.';
COMMENT ON COLUMN v_stock_cover.avg_daily_issue IS 'Average daily quantity that left the warehouse for any reason over the last ninety days - sales, transfers out, plant consumption. Read from the day-on-day stock change, so a receipt and an issue on the same day partly cancel and this runs a little low.';
COMMENT ON COLUMN v_stock_cover.daily_rate IS 'The rate cover is measured against: the faster of customer dispatches and everything that leaves the warehouse. Plants and ports mostly feed other warehouses rather than selling, and many branches pass an item on to other branches - judged on customer sales alone their stock would look far longer-lasting than it is.';
COMMENT ON COLUMN v_stock_cover.rate_basis IS 'Which rate won: customer dispatches, or all outflows where the item leaves faster than it sells. Null where nothing has left in ninety days.';
COMMENT ON COLUMN v_stock_cover.open_order_due_qty IS 'The part of the open orders scheduled for today or earlier.';
COMMENT ON COLUMN v_stock_cover.available_to_promise_now IS 'Sellable stock minus only the orders due by today. Orders scheduled for later can still be met from stock that arrives before then.';
COMMENT ON COLUMN v_stock_cover.over_promised_now IS 'More is due today than is on the shelf - a real shortage now, not a future scheduling question. Look at these first.';
COMMENT ON COLUMN v_stock_cover.sellable_expired_qty IS 'Stock in sellable areas whose lots are past their shelf life. It is still counted in sellable_qty, because whether it is really unusable is for quality to say - many lots may pass a retest. Known only for manufactured goods.';
COMMENT ON COLUMN v_stock_cover.cover_days_available IS 'Days the available-to-promise stock lasts at daily_rate. The headline number.';
COMMENT ON COLUMN v_stock_cover.cover_days_with_incoming IS 'The same, adding stock in transit to this warehouse and live purchase orders. Does not include stock that will be transferred in from another warehouse, since no transfer is planned until someone raises it.';
COMMENT ON COLUMN v_stock_cover.cover_status IS 'over-promised (orders due by today exceed sellable stock - a real shortage), over-promised by future orders (only later orders exceed it, so it may be met by stock still to arrive), under 15 days, 15 to 45 days, over 45 days, or not moving - nothing has left this warehouse in ninety days, sold or otherwise.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_critical_stock: crm's own aged-stock workflow, so our aging figures agree with what the owners track.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_critical_stock CASCADE;

CREATE VIEW fact_critical_stock AS
WITH run_dates AS (
    SELECT acc_year, jc_type, creation_date::date AS run_date, count(*) AS n
    FROM "CriticalStocks" GROUP BY 1, 2, 3
),
runs AS (
    -- a run is dated by the day that wrote most of its rows: stray rows added weeks later (one on JC6
    -- 2026-27, a month after the run) must not redate it
    SELECT acc_year, jc_type, run_date AS run_at, rank() OVER (ORDER BY run_date DESC) AS run_rank
    FROM (SELECT DISTINCT ON (acc_year, jc_type) acc_year, jc_type, run_date
          FROM run_dates ORDER BY acc_year, jc_type, n DESC, run_date) x
)
SELECT c.header_id                                     AS critical_stock_id,
       c.acc_year,
       c.jc_type                                       AS jc_name,
       j.jc_id                                         AS run_jc_id,
       r.run_at::date                                  AS run_on,
       r.run_rank = 1                                  AS is_latest_run,
       c.customer_hdr_id,
       dc.customer_name,
       c.collector_id,
       b.branch_name,
       c.mc_code,
       lower(btrim(c.item_description))                AS name_key,
       c.item_description                              AS product_name,
       dp.primary_item_id                              AS item_id,
       c.segment2                                      AS division,
       btrim(c.segment3)                               AS segment,
       nullif(btrim(c.segment4), '')                   AS sub_segment,
       c.critical_stock_qty,
       c.critical_stock_value * 100000                 AS critical_stock_value,
       c.stock_days,
       c.avg_sales,
       c.avg_cost,
       c.qgreater90                                    AS qty_over_90_days,
       c.vgreater90 * 100000                           AS value_over_90_days,
       c.target_qty,
       c.target_value * 100000                         AS target_value,
       c.deadline_target_date::date                    AS deadline,
       nullif(btrim(c.te_remarks), '')                 AS te_remarks,
       nullif(btrim(c.bh_remarks), '')                 AS bh_remarks,
       c.status_id,
       c.is_saved,
       cfg.asd                                         AS age_threshold_days,
       cfg.total_stock_value                           AS value_threshold,
       -- the stock figures are the product's, company-wide, repeated on every branch and customer row.
       -- sum them only on this row, once per product per run.
       row_number() OVER (PARTITION BY c.acc_year, c.jc_type, lower(btrim(c.item_description))
                          ORDER BY c.header_id) = 1    AS is_product_row
FROM "CriticalStocks" c
JOIN runs r ON r.acc_year = c.acc_year AND r.jc_type = c.jc_type
LEFT JOIN dim_jc j ON j.acc_year = c.acc_year AND j.jc_name = c.jc_type
LEFT JOIN dim_customer dc ON dc.customer_hdr_id = c.customer_hdr_id
LEFT JOIN dim_collector b ON b.collector_id = c.collector_id
LEFT JOIN dim_plan_product dp ON dp.name_key = lower(btrim(c.item_description))
-- a config names a segment and sometimes a sub-segment; the most specific match wins
LEFT JOIN LATERAL (
    SELECT g.asd, g.total_stock_value
    FROM "CriticalStockConfigs" g
    WHERE g.is_active
      AND btrim(g.segment3) = btrim(c.segment3)
      AND (nullif(btrim(g.segment4), '') IS NULL OR btrim(g.segment4) = btrim(c.segment4))
    ORDER BY nullif(btrim(g.segment4), '') IS NULL
    LIMIT 1) cfg ON true;

COMMENT ON VIEW fact_critical_stock IS 'CRM''s own aged-stock process: once a cycle it lists every product whose stock has sat too long, and assigns the follow-up to the owners of each branch and customer that buys it - the technical executive and the business head record remarks and commit to clearing it by a deadline. One row per customer, branch and product. CAUTION: the stock figures on a row are the PRODUCT''s, company-wide, repeated identically on every branch and customer row - summing them across rows overstates several times over. Sum only where is_product_row, or use v_critical_stock_product. Values in rupees; CRM stores lakhs.';
COMMENT ON COLUMN fact_critical_stock.is_product_row IS 'True on one row per product per run. The only rows on which stock quantities and values may be summed.';
COMMENT ON COLUMN fact_critical_stock.age_threshold_days IS 'CRM''s age threshold for this segment (60 days today), from its configuration - the most specific segment match.';
COMMENT ON COLUMN fact_critical_stock.customer_hdr_id IS 'CRM''s internal customer row (CustomerMasters.header_id) - NOT the Oracle customer_id. Joining on customer_id matches some rows by coincidence on small numbers and attaches stock to the wrong customer.';
COMMENT ON COLUMN fact_critical_stock.name_key IS 'The product, by name. CRM records critical stock by product name, not by item: one name covers several pack sizes. Joins dim_plan_product, the same grain as the business plan.';
COMMENT ON COLUMN fact_critical_stock.item_id IS 'The product''s main item where the name resolves to one. A convenience - the grain is the product name.';
COMMENT ON COLUMN fact_critical_stock.critical_stock_value IS 'Value of the aged stock in rupees (CRM holds lakhs; converted here).';
COMMENT ON COLUMN fact_critical_stock.stock_days IS 'Days of cover this product''s aged stock represents at its average rate of sale. CRM also stores this as ASD on the row.';
COMMENT ON COLUMN fact_critical_stock.value_threshold IS 'CRM''s value floor for this segment: stock older than the age threshold and worth more than this is flagged. 50 thousand to 3 lakh depending on segment.';
COMMENT ON COLUMN fact_critical_stock.te_remarks IS 'What the technical executive wrote about clearing this stock.';
COMMENT ON COLUMN fact_critical_stock.bh_remarks IS 'What the business head wrote.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_critical_stock_product: crm's aged stock, once per product - the grain its stock figures actually have.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_critical_stock_product CASCADE;

CREATE VIEW v_critical_stock_product AS
SELECT f.acc_year,
       f.jc_name,
       f.run_jc_id,
       f.run_on,
       f.is_latest_run,
       f.name_key,
       max(f.product_name)                             AS product_name,
       max(f.item_id)                                  AS item_id,
       max(f.division)                                 AS division,
       max(f.segment)                                  AS segment,
       max(f.critical_stock_qty) FILTER (WHERE f.is_product_row)   AS critical_stock_qty,
       max(f.critical_stock_value) FILTER (WHERE f.is_product_row) AS critical_stock_value,
       max(f.qty_over_90_days) FILTER (WHERE f.is_product_row)     AS qty_over_90_days,
       max(f.value_over_90_days) FILTER (WHERE f.is_product_row)   AS value_over_90_days,
       max(f.stock_days) FILTER (WHERE f.is_product_row)           AS stock_days,
       max(f.age_threshold_days)                       AS age_threshold_days,
       max(f.value_threshold)                          AS value_threshold,
       count(DISTINCT f.collector_id)                  AS branches_following_up,
       count(DISTINCT f.customer_hdr_id)               AS customers_following_up,
       count(*) FILTER (WHERE f.te_remarks IS NOT NULL OR f.bh_remarks IS NOT NULL) AS rows_with_remarks,
       min(f.deadline)                                 AS earliest_deadline
FROM fact_critical_stock f
GROUP BY f.acc_year, f.jc_name, f.run_jc_id, f.run_on, f.is_latest_run, f.name_key;

COMMENT ON VIEW v_critical_stock_product IS 'CRM''s aged stock once per product per run - the grain its stock figures really have. Summing this is safe. It reconciles with our own lot ages: the latest run''s total sits within a few percent of the value of lots over ninety days old in fact_stock_lot. branches_following_up and customers_following_up say how widely the clearing work was spread.';
COMMENT ON COLUMN v_critical_stock_product.critical_stock_value IS 'Value of the product''s aged stock in rupees, counted once.';
COMMENT ON COLUMN v_critical_stock_product.rows_with_remarks IS 'How many of the owner rows carry a remark from the technical executive or business head - a measure of whether anyone is acting on it.';
