-- item_master views. run by app/repositories/views.py at api start, in file name order.
-- one statement per ';'. plain views are dropped and recreated every start, so a column change never breaks a restart.
--
-- PTO / PTS, as crm computes it (SpSyncPoRequisitionPtoPts, monthly on the 1st):
--   sales base  = trailing 6 months of invoice lines (PureGPReports, not loaded), performance chemicals only,
--                 no samples, no raw material businesses, no group company
--   per product = distinct customers, and the share of the single largest customer
--   rule        = fewer than 5 customers -> PTO. 5 or more but the top one takes >= 70% -> PTO (types PTS70%).
--                 5 or more and nobody dominates -> PTS. the bar was 80% before jul 2023.
--   no sales in the window -> no row. crm's screen (fn_GetPTOPTSItemsPC) then shows PTO by default.
--   the same rules run a second time per raw material consumed (types RPTO / RPTS / RPTS70%), into the same table.
--   holes: may 2022 missing, dec 2025 has no raw material rows, 5 rows in mar 2023 were hand edited.


-- ---------------------------------------------------------------------------------------------------------------
-- v_item_pto_pts_monthly: the classification history, one row per product, month and pass.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_item_pto_pts_monthly CASCADE;

CREATE VIEW v_item_pto_pts_monthly AS
SELECT DISTINCT ON (itemid, fromdate, types LIKE 'R%')
       itemid                                             AS item_id,
       fromdate                                           AS month_start,
       todate                                             AS month_end,
       CASE WHEN types LIKE 'R%' THEN 'raw material' ELSE 'finished goods' END AS pass,
       actiontypes                                        AS pto_pts,
       types,
       CASE WHEN types LIKE '%80%' THEN 80
            WHEN types LIKE '%70%' THEN 70
            WHEN fromdate < DATE '2023-07-01' THEN 80
            ELSE 70 END                                   AS threshold_pct,
       customercount                                      AS customer_count,
       overallsaleqty                                     AS total_sale_qty,
       customersaleqty                                    AS top_customer_sale_qty,
       salepercentage                                     AS top_customer_share_pct
FROM "PurchaseRequisitionPtoPts"
ORDER BY itemid, fromdate, types LIKE 'R%', header_id DESC;

COMMENT ON VIEW v_item_pto_pts_monthly IS 'Month by month, whether crm classed a product as PTO (buy against orders) or PTS (keep in stock). One row per product per month per pass: the finished goods pass looks at the product''s own sales, the raw material pass at the sales of the products it goes into. Rule: fewer than 5 customers in the trailing 6 months of invoices, or one customer taking 70% or more (80% before July 2023) -> PTO, otherwise PTS. A product with no invoice sales in the window has no row. May 2022 is missing in crm and December 2025 has no raw material rows.';
COMMENT ON COLUMN v_item_pto_pts_monthly.item_id IS 'The product. Joins dim_item. On the raw material pass this is the raw material, not the product sold.';
COMMENT ON COLUMN v_item_pto_pts_monthly.month_start IS 'First day of the month the classification was made for.';
COMMENT ON COLUMN v_item_pto_pts_monthly.month_end IS 'Last day of that month. crm''s screen uses the row whose month contains today.';
COMMENT ON COLUMN v_item_pto_pts_monthly.pass IS 'finished goods = classified on the product''s own invoice sales. raw material = classified on the sales of the finished goods it is used in.';
COMMENT ON COLUMN v_item_pto_pts_monthly.pto_pts IS 'PTO or PTS for that month and pass.';
COMMENT ON COLUMN v_item_pto_pts_monthly.types IS 'crm''s own tag: PTO / PTS, PTS70% or PTS80% = would be PTS on customer count but one customer dominates so it is PTO; an R in front = raw material pass. Five rows in March 2023 say PTO here and PTS in pto_pts: hand edited, pto_pts is what crm uses.';
COMMENT ON COLUMN v_item_pto_pts_monthly.threshold_pct IS 'The top customer share above which a product is PTO despite having 5 or more customers: 80 up to June 2023, 70 from July 2023. Do not compare shares across that change.';
COMMENT ON COLUMN v_item_pto_pts_monthly.customer_count IS 'Distinct customers who bought the product in the trailing 6 months of invoices.';
COMMENT ON COLUMN v_item_pto_pts_monthly.total_sale_qty IS 'Quantity invoiced in that window.';
COMMENT ON COLUMN v_item_pto_pts_monthly.top_customer_sale_qty IS 'Quantity taken by the single largest customer in that window.';
COMMENT ON COLUMN v_item_pto_pts_monthly.top_customer_share_pct IS 'The largest customer''s share of the quantity, in percent. Compared with threshold_pct.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_item: one row per product, every product (26k), ready to join to any fact on item_id.
-- non performance chemicals products are here too (78% of order lines are on them) with empty classification.
-- pto_pts mirrors crm's screen exactly (fn_GetPTOPTSItemsPC); pto_pts_latest is the product's own last measured class.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_item CASCADE;

CREATE VIEW dim_item AS
WITH this_month AS (
    SELECT item_id, max(pto_pts) AS pto_pts
    FROM v_item_pto_pts_monthly
    WHERE current_date BETWEEN month_start AND month_end
    GROUP BY item_id
),
latest AS (
    -- the product's own sales (finished goods pass) if it ever had any, otherwise its raw material pass
    SELECT DISTINCT ON (item_id) item_id, pto_pts, month_start, pass
    FROM v_item_pto_pts_monthly
    ORDER BY item_id, pass = 'raw material', month_start DESC
)
SELECT i.item_id,
       i.item_code,
       i.item_description                              AS item_name,
       i.item_group,
       i.uom,
       i.uom_description                               AS uom_name,
       coalesce(i.status = 'Active', false)            AS is_active,
       coalesce(i.enabled_flag = 'Y', false)           AS is_enabled,
       c.item_id IS NOT NULL                           AS is_performance_chemicals,
       c.category_id,
       c.segment1                                      AS division,
       CASE regexp_replace(trim(c.segment2), '\s+', ' ', 'g')
            WHEN 'FOOD INGREDIENTS' THEN 'Food Ingredients'
            ELSE regexp_replace(trim(c.segment2), '\s+', ' ', 'g')
       END                                             AS business,
       c.segment3                                      AS category,
       nullif(c.segment4, '')                          AS family,
       CASE WHEN c.item_id IS NOT NULL AND i.status = 'Active' AND i.enabled_flag = 'Y'
            THEN coalesce(m.pto_pts, 'PTO') END        AS pto_pts,
       CASE WHEN c.item_id IS NOT NULL AND i.status = 'Active' AND i.enabled_flag = 'Y'
            THEN m.pto_pts IS NULL END                 AS pto_pts_is_default,
       l.pto_pts                                       AS pto_pts_latest,
       l.month_start                                   AS pto_pts_latest_month,
       l.pass                                          AS pto_pts_latest_pass,
       i.creation_date,
       i.last_update_date
FROM "ItemMasters" i
LEFT JOIN "ItemCategories" c ON c.item_id = i.item_id
LEFT JOIN this_month m ON m.item_id = i.item_id
LEFT JOIN latest     l ON l.item_id = i.item_id;

COMMENT ON VIEW dim_item IS 'The product list, one row per product, with its classification and its PTO / PTS status. Every product is here, including the ones outside Performance Chemicals (they have no classification) and the "unknown" product with id -1 that facts use when crm gave no product. PTO = bought against customer orders, PTS = kept in stock.';
COMMENT ON COLUMN dim_item.item_id IS 'The product id. Every order, quote, dispatch, purchase and stock row carries this.';
COMMENT ON COLUMN dim_item.item_code IS 'The product code. Not unique: three codes belong to two products each, so join on item_id.';
COMMENT ON COLUMN dim_item.item_name IS 'The product name.';
COMMENT ON COLUMN dim_item.item_group IS 'The product group as crm names it (RAW MATERIAL, TEXTILE PURE, PUREPRINT ...).';
COMMENT ON COLUMN dim_item.uom IS 'Unit of measure code: KG, EA, L, BOX ...';
COMMENT ON COLUMN dim_item.uom_name IS 'Unit of measure in words: Kilogram, Each, Litre ...';
COMMENT ON COLUMN dim_item.is_active IS 'True for an active product (crm status Active). About 1,700 products are inactive but still appear in history.';
COMMENT ON COLUMN dim_item.is_enabled IS 'True when crm''s enabled flag is Y. 119 products are disabled; crm treats a product as usable only when it is both active and enabled.';
COMMENT ON COLUMN dim_item.is_performance_chemicals IS 'True when the product belongs to the Performance Chemicals business. Only these have a division / business / category / family. Orders are placed on other products too; dispatches, quotes, purchases and stock are loaded for these only.';
COMMENT ON COLUMN dim_item.category_id IS 'crm''s id for the classification combination. No name table exists for it.';
COMMENT ON COLUMN dim_item.division IS 'Top level of the classification. Always Performance Chemicals for a classified product.';
COMMENT ON COLUMN dim_item.business IS 'Second level: the business the product belongs to, such as Textile & Paper Division, Water Treatment Chemical, Raw Material. Spelling is cleaned here (crm has "Raw  Material" with two spaces and "FOOD INGREDIENTS" in capitals).';
COMMENT ON COLUMN dim_item.category IS 'Third level of the classification.';
COMMENT ON COLUMN dim_item.family IS 'Fourth level of the classification. Empty for a few products.';
COMMENT ON COLUMN dim_item.pto_pts IS 'PTO or PTS exactly as a crm screen shows it today: the classification for the current month if crm made one (PTS wins if the finished goods and raw material passes disagree), otherwise PTO by default. Only for Performance Chemicals products that are active and enabled; empty for the rest. About 80% of products carry the default, not a measurement - see pto_pts_is_default.';
COMMENT ON COLUMN dim_item.pto_pts_is_default IS 'True when pto_pts is the PTO default because the product had no invoice sales in the trailing 6 months, false when crm actually classified it this month. Empty for products outside crm''s scope.';
COMMENT ON COLUMN dim_item.pto_pts_latest IS 'The last classification crm actually measured for the product, whatever month that was: on its own sales if it ever sold (finished goods pass), otherwise on the sales of what it goes into (raw material pass). The data based answer, as opposed to the screen default in pto_pts. Empty when the product was never classified (no invoice sales since July 2020).';
COMMENT ON COLUMN dim_item.pto_pts_latest_month IS 'The month pto_pts_latest is from. Old = the product has not sold since.';
COMMENT ON COLUMN dim_item.pto_pts_latest_pass IS 'Which pass pto_pts_latest comes from: finished goods (the product''s own sales) or raw material (the sales of the products it is used in).';
COMMENT ON COLUMN dim_item.creation_date IS 'When the product was created in crm.';
COMMENT ON COLUMN dim_item.last_update_date IS 'When the product was last changed in crm.';
