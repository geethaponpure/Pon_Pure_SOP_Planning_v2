-- business_plan views. first half: the calendar, the actuals (ours and crm's), the product-name bridge, the baselines.
-- second half: the plans, the open leads, the plan-vs-actual report and the accuracy scoreboard.
-- run by app/repositories/views.py at api start, in file name order. one statement per ';'.
--
-- what shapes this file (from the crm code and the senior review, sep 2026):
--   grain      crm plans and measures by product NAME, never by item id. names are matched lower(trim()) both sides.
--   cycles     a journey cycle (JC) is ~4 weeks, 13 a year, contiguous since 2013. everything is bucketed by cycle.
--   actuals    crm's own actuals (SPBusinessPlanActualSales) come from oracle invoices: PC, no e-commerce, and NO
--              transaction type filter (samples, cogt, group company are in), values in lakhs. ours come from confirmed
--              dispatches. the two never match exactly - v_actual_bridge shows both and the gap.
--   baselines  a naive same-cycle-last-year forecast beats the human plan at cycle grain. the forecast layer builds on
--              actuals history; the baselines here are the accuracy harness.


-- ---------------------------------------------------------------------------------------------------------------
-- dim_jc_week: the four weeks of every cycle. the planning windows are defined on these weeks.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_jc_week CASCADE;

CREATE VIEW dim_jc_week AS
SELECT w.line_id                                       AS jc_week_id,
       w.acc_yr                                        AS acc_year,
       w.jcno                                          AS jc_no,
       w.weekno                                        AS week_no,
       w.week_period_from                              AS week_start,
       w.week_period_to                                AS week_end,
       w.week_period_to - w.week_period_from + 1       AS days,
       -- the weekday a crm cut-off falls on, inside this week (weeks run sunday to saturday)
       w.week_period_from + ((3 - extract(dow FROM w.week_period_from)::int + 7) % 7) AS wednesday,
       w.week_period_from + ((4 - extract(dow FROM w.week_period_from)::int + 7) % 7) AS thursday,
       current_date BETWEEN w.week_period_from AND w.week_period_to AS is_current
FROM "JcWeeklyCalendars" w;

COMMENT ON VIEW dim_jc_week IS 'The four weeks of every journey cycle, as crm defines them (weeks run Sunday to Saturday). The planning windows sit on these weeks: a cycle''s plan is entered during weeks 2 and 3 of the previous cycle and handed over in week 4. The first week of JC1 and the last of JC13 are short or long so the accounting year fits exactly.';
COMMENT ON COLUMN dim_jc_week.jc_week_id IS 'The crm row (JcWeeklyCalendars.line_id).';
COMMENT ON COLUMN dim_jc_week.acc_year IS 'The accounting year, e.g. 2026-2027.';
COMMENT ON COLUMN dim_jc_week.jc_no IS 'The cycle number 1 .. 13. With acc_year it identifies the cycle in dim_jc.';
COMMENT ON COLUMN dim_jc_week.week_no IS 'Week 1 .. 4 within the cycle.';
COMMENT ON COLUMN dim_jc_week.week_start IS 'First day of the week (a Sunday, except the short first week of JC1).';
COMMENT ON COLUMN dim_jc_week.week_end IS 'Last day of the week (a Saturday, except the long last week of JC13).';
COMMENT ON COLUMN dim_jc_week.days IS 'Length of the week in days - 7 except at the year''s edges.';
COMMENT ON COLUMN dim_jc_week.wednesday IS 'The Wednesday of this week - the branch manager''s cut-off day when the week is week 3.';
COMMENT ON COLUMN dim_jc_week.thursday IS 'The Thursday of this week - the sales executive''s cut-off day when the week is week 2.';
COMMENT ON COLUMN dim_jc_week.is_current IS 'Today falls in this week.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_jc: one row per journey cycle, with the previous / next / same-cycle-last-year links, today's flags, and the
-- dates of the planning window that produced the cycle's plan (they all sit in the previous cycle).
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_jc CASCADE;

CREATE VIEW dim_jc AS
WITH c AS (
    SELECT j.line_id, j.name, j.acc_year, j.effective_from, j.effective_to, j.is_active, j.is_closed,
           nullif(regexp_replace(j.name, '\D', '', 'g'), '')::int AS jc_no,
           row_number() OVER (ORDER BY j.effective_from) AS jc_seq
    FROM "JourneyCalendars" j
    WHERE j.line_id > 0
),
b AS (
    SELECT c.*,
           lag(c.acc_year) OVER (ORDER BY c.effective_from) AS prev_acc_year,
           lag(c.jc_no)    OVER (ORDER BY c.effective_from) AS prev_jc_no
    FROM c
),
win AS (
    -- the plan for a cycle is entered in the PREVIOUS cycle: se in week 2, te / bm / bh in week 3, hand-over in week 4
    SELECT acc_year, jc_no,
           max(thursday)   FILTER (WHERE week_no = 2) AS se_cutoff,
           max(week_start) FILTER (WHERE week_no = 3) AS te_auto_approval,
           max(wednesday)  FILTER (WHERE week_no = 3) AS bm_cutoff,
           max(week_end)   FILTER (WHERE week_no = 3) AS bh_cutoff,
           max(week_start) FILTER (WHERE week_no = 4) AS handoff_date
    FROM dim_jc_week GROUP BY acc_year, jc_no
)
SELECT c.line_id                                       AS jc_id,
       c.name                                          AS jc_name,
       c.jc_no,
       c.acc_year,
       c.jc_seq,
       c.effective_from                                AS jc_start,
       c.effective_to                                  AS jc_end,
       c.effective_to - c.effective_from + 1           AS days,
       min(c.effective_from) OVER (PARTITION BY c.acc_year) AS year_start,
       max(c.effective_to)   OVER (PARTITION BY c.acc_year) AS year_end,
       current_date BETWEEN c.effective_from AND c.effective_to AS is_current,
       c.effective_to < current_date                   AS is_completed,
       c.effective_from > current_date                 AS is_future,
       lag(c.line_id)  OVER (ORDER BY c.effective_from) AS prev_jc_id,
       lead(c.line_id) OVER (ORDER BY c.effective_from) AS next_jc_id,
       lag(c.line_id, 13) OVER (ORDER BY c.effective_from) AS same_jc_last_year_id,
       coalesce(c.is_active, false)                    AS is_active,
       coalesce(c.is_closed, false)                    AS is_closed,
       w.se_cutoff,
       w.te_auto_approval,
       w.bm_cutoff,
       w.bh_cutoff,
       w.handoff_date,
       lag(c.effective_to) OVER (ORDER BY c.effective_from) AS publish_date
FROM b c
LEFT JOIN win w ON w.acc_year = c.prev_acc_year AND w.jc_no = c.prev_jc_no
UNION ALL
SELECT -1, 'unknown', NULL, 'unknown', NULL, NULL, NULL, NULL, NULL, NULL, false, false, false, NULL, NULL, NULL, false, false,
       NULL, NULL, NULL, NULL, NULL, NULL;

COMMENT ON VIEW dim_jc IS 'The planning calendar: one row per journey cycle (JC). A cycle is about four weeks, there are 13 in an accounting year (April to March), and they are contiguous since 2013. Every plan, forecast and actual is bucketed by cycle. Includes the "unknown" cycle (-1) that forecast rows with no cycle point at.';
COMMENT ON COLUMN dim_jc.jc_id IS 'The cycle id (JourneyCalendars.line_id). Forecast rows carry it.';
COMMENT ON COLUMN dim_jc.jc_name IS 'JC1 .. JC13.';
COMMENT ON COLUMN dim_jc.jc_no IS 'The cycle number within the year, 1 .. 13.';
COMMENT ON COLUMN dim_jc.acc_year IS 'The accounting year, e.g. 2026-2027. The plan tables use this spelling.';
COMMENT ON COLUMN dim_jc.jc_seq IS 'A running number across all cycles in date order. Cycle n-1 is the previous cycle, n-13 the same cycle a year earlier.';
COMMENT ON COLUMN dim_jc.jc_start IS 'First day of the cycle.';
COMMENT ON COLUMN dim_jc.jc_end IS 'Last day of the cycle.';
COMMENT ON COLUMN dim_jc.days IS 'Length of the cycle in days.';
COMMENT ON COLUMN dim_jc.year_start IS 'First day of the accounting year.';
COMMENT ON COLUMN dim_jc.year_end IS 'Last day of the accounting year.';
COMMENT ON COLUMN dim_jc.is_current IS 'Today falls in this cycle.';
COMMENT ON COLUMN dim_jc.is_completed IS 'The cycle has ended: its actuals are final.';
COMMENT ON COLUMN dim_jc.is_future IS 'The cycle has not started.';
COMMENT ON COLUMN dim_jc.prev_jc_id IS 'The cycle before this one.';
COMMENT ON COLUMN dim_jc.next_jc_id IS 'The cycle after this one.';
COMMENT ON COLUMN dim_jc.same_jc_last_year_id IS 'The same cycle number one year earlier (13 cycles back). The naive forecast reads its actuals.';
COMMENT ON COLUMN dim_jc.is_active IS 'crm active flag.';
COMMENT ON COLUMN dim_jc.is_closed IS 'crm closed flag.';
COMMENT ON COLUMN dim_jc.se_cutoff IS 'Last day for the sales executives to enter this cycle''s plan: the Thursday of week 2 of the previous cycle.';
COMMENT ON COLUMN dim_jc.te_auto_approval IS 'The technical executives'' stage closes and auto-approves from this day: the start of week 3 of the previous cycle.';
COMMENT ON COLUMN dim_jc.bm_cutoff IS 'Last day for the branch managers: the Wednesday of week 3 of the previous cycle; auto-approval follows.';
COMMENT ON COLUMN dim_jc.bh_cutoff IS 'Last day for the regional / business heads: the last day of week 3 of the previous cycle (they work its final two days); auto-approval follows.';
COMMENT ON COLUMN dim_jc.handoff_date IS 'The day the approved plan is compiled and handed to the planners: the first day of week 4 of the previous cycle. The as-of point a forecast should be scored against.';
COMMENT ON COLUMN dim_jc.publish_date IS 'The day the projection is pushed to oracle: the last day of the previous cycle.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_actual_jc: what shipped, per cycle x product x branch x customer x warehouse, with the flags that decide
-- which universe a report wants (ours: is_demand; crm's: everything invoiced but e-commerce).
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_actual_jc CASCADE;

CREATE MATERIALIZED VIEW fact_actual_jc AS
WITH lines AS (
    SELECT j.jc_id, j.acc_year, j.jc_no, j.jc_seq,
           d.item_id, lower(trim(i.item_name)) AS name_key, d.collector_id, d.customer_id, d.inventory_org_id,
           d.order_kind, d.is_inter_company, d.is_demand,
           lower(trim(d.sale_category)) = 'e-commerce' AS is_ecommerce,
           d.order_kind = 'sample'                     AS is_sample,
           d.quantity, d.line_value
    FROM fact_dispatch d
    JOIN dim_jc j   ON d.dispatch_date BETWEEN j.jc_start AND j.jc_end
    JOIN dim_item i ON i.item_id = d.item_id
    WHERE d.counts_as_dispatched
)
SELECT jc_id, acc_year, jc_no, jc_seq, item_id, name_key, collector_id, customer_id, inventory_org_id,
       order_kind, is_inter_company, is_ecommerce, is_sample, is_demand,
       order_kind NOT IN ('stock transfer', 'job work', 'unknown') AND NOT is_ecommerce AS in_crm_universe,
       sum(quantity)   AS quantity,
       sum(line_value) AS value_inr,
       count(*)        AS dispatch_lines
FROM lines
GROUP BY jc_id, acc_year, jc_no, jc_seq, item_id, name_key, collector_id, customer_id, inventory_org_id,
         order_kind, is_inter_company, is_ecommerce, is_sample, is_demand;

CREATE UNIQUE INDEX ix_fact_actual_jc_key ON fact_actual_jc (jc_id, item_id, collector_id, customer_id, inventory_org_id, order_kind, is_inter_company, is_ecommerce, is_sample, is_demand);
CREATE INDEX ix_fact_actual_jc_jc ON fact_actual_jc (jc_id);
CREATE INDEX ix_fact_actual_jc_item ON fact_actual_jc (item_id, collector_id, jc_seq);
CREATE INDEX ix_fact_actual_jc_name ON fact_actual_jc (name_key, collector_id, jc_seq);
CREATE INDEX ix_fact_actual_jc_customer ON fact_actual_jc (customer_id, jc_seq);

COMMENT ON MATERIALIZED VIEW fact_actual_jc IS 'What actually shipped, bucketed by journey cycle: quantity and value per cycle x product x branch x customer x warehouse, from confirmed dispatches. Two universes on one table: is_demand for customer demand (sales and exports, not inter company), in_crm_universe for what crm''s own plan actuals count (everything invoiced except e-commerce - samples, cogt and group company included).';
COMMENT ON COLUMN fact_actual_jc.jc_id IS 'The cycle. Joins dim_jc.';
COMMENT ON COLUMN fact_actual_jc.acc_year IS 'The accounting year of the cycle.';
COMMENT ON COLUMN fact_actual_jc.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_actual_jc.jc_seq IS 'Running cycle number, for previous / next arithmetic.';
COMMENT ON COLUMN fact_actual_jc.item_id IS 'The product that shipped. Joins dim_item.';
COMMENT ON COLUMN fact_actual_jc.name_key IS 'The product name, lower case and trimmed - the key the plan uses. Joins dim_plan_product.';
COMMENT ON COLUMN fact_actual_jc.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_actual_jc.customer_id IS 'The customer. Joins dim_customer.';
COMMENT ON COLUMN fact_actual_jc.inventory_org_id IS 'The warehouse it shipped from. Joins InventoryOrgs.';
COMMENT ON COLUMN fact_actual_jc.order_kind IS 'sale / export sale / import pass-through / sample / stock transfer / job work / unknown.';
COMMENT ON COLUMN fact_actual_jc.is_inter_company IS 'Shipped on the GROUP COMPANY branch.';
COMMENT ON COLUMN fact_actual_jc.is_ecommerce IS 'A marketplace sale (sale category E-Commerce). crm''s plan actuals leave these out; warehouse demand does not.';
COMMENT ON COLUMN fact_actual_jc.is_sample IS 'A sample. crm''s plan actuals count these; demand does not.';
COMMENT ON COLUMN fact_actual_jc.is_demand IS 'Customer demand: a sale or export sale, not inter company. The universe for forecasting.';
COMMENT ON COLUMN fact_actual_jc.in_crm_universe IS 'What crm''s plan actuals would count: invoiced kinds (sale, export, pass-through, sample - inter company included) and not e-commerce. Use to compare with fact_actual_jc_crm.';
COMMENT ON COLUMN fact_actual_jc.quantity IS 'Quantity shipped in the product''s unit.';
COMMENT ON COLUMN fact_actual_jc.value_inr IS 'Value shipped, tax exclusive, rupees. Empty where the lines were unpriced.';
COMMENT ON COLUMN fact_actual_jc.dispatch_lines IS 'How many dispatch lines went into the row.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_plan_product: one row per product NAME - the grain the plan, the projection and crm's actuals share -
-- with the item master name each spelling stands for: itself, a hand-kept alias (plan_name_alias), or the one
-- master name with the same letters and digits. every name-grain fact carries the resolved key.
-- with the items behind it.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS dim_plan_product CASCADE;

CREATE MATERIALIZED VIEW dim_plan_product AS
WITH names AS (
    SELECT lower(trim(item_description)) AS name_key, min(item_description) AS spelling, 'plan' AS src FROM "SCBusinessMonthlyPlanHdrs" GROUP BY 1
    UNION ALL SELECT lower(trim(item_description)), min(item_description), 'projection' FROM "SCBusinessPlanProjections" GROUP BY 1
    UNION ALL SELECT lower(trim(itemdescription)), min(itemdescription), 'crm_actuals' FROM "SPBusinessPlanActualSales" GROUP BY 1
    UNION ALL SELECT lower(trim(item_description)), min(item_description), 'item_master' FROM "ItemMasters" WHERE item_id > 0 GROUP BY 1
),
keys AS (
    SELECT name_key,
           bool_or(src = 'plan')        AS used_in_plan,
           bool_or(src = 'projection')  AS used_in_projection,
           bool_or(src = 'crm_actuals') AS used_in_crm_actuals,
           bool_or(src = 'item_master') AS is_in_item_master,
           min(spelling) FILTER (WHERE src = 'item_master') AS master_spelling,
           min(spelling)                AS any_spelling
    FROM names GROUP BY name_key
),
compact AS (
    -- item master names by their letters and digits only: 'purit rf406mt' and 'purit rf 406 mt' meet here
    SELECT regexp_replace(name_key, '[^a-z0-9]', '', 'g') AS compact_key, min(name_key) AS name_key, count(*) AS n
    FROM keys WHERE is_in_item_master GROUP BY 1
),
resolved AS (
    SELECT k.name_key,
           CASE WHEN k.is_in_item_master   THEN k.name_key
                WHEN ai.item_id IS NOT NULL THEN lower(trim(ai.item_description))
                WHEN c.n = 1                THEN c.name_key END AS master_name_key,
           CASE WHEN k.is_in_item_master   THEN 'exact'
                WHEN ai.item_id IS NOT NULL THEN 'alias'
                WHEN c.n = 1                THEN 'spelling' END AS resolved_by
    FROM keys k
    LEFT JOIN plan_name_alias a ON a.name_key = k.name_key
    LEFT JOIN "ItemMasters" ai  ON ai.item_id = a.item_id
    LEFT JOIN compact c         ON c.compact_key = regexp_replace(k.name_key, '[^a-z0-9]', '', 'g')
),
items AS (
    SELECT lower(trim(i.item_description)) AS name_key,
           count(*)                     AS item_count,
           array_agg(i.item_id ORDER BY i.item_id) AS item_ids,
           count(DISTINCT i.uom)        AS uom_count,
           min(i.uom)                   AS uom,
           count(DISTINCT i.item_group) AS item_group_count,
           min(i.item_group)            AS item_group,
           count(DISTINCT c.segment2)   AS business_count,
           min(c.segment2)              AS business,
           bool_or(c.item_id IS NOT NULL) AS any_performance_chemicals,
           bool_or(i.status = 'Active' AND i.enabled_flag = 'Y') AS any_usable
    FROM "ItemMasters" i
    LEFT JOIN "ItemCategories" c ON c.item_id = i.item_id
    WHERE i.item_id > 0
    GROUP BY 1
),
primary_item AS (
    -- the item that shipped most since two years ago, else the lowest id
    SELECT name_key, item_id
    FROM (SELECT a.name_key, a.item_id, sum(a.quantity) AS q,
                 row_number() OVER (PARTITION BY a.name_key ORDER BY sum(a.quantity) DESC, a.item_id) AS rn
          FROM fact_actual_jc a WHERE a.is_demand GROUP BY a.name_key, a.item_id) x
    WHERE rn = 1
),
temp AS (
    SELECT lower(trim(temp_itemname)) AS name_key, min(temp_item_id) AS temp_item_id FROM "TempItemmasters" GROUP BY 1
)
SELECT k.name_key,
       coalesce(km.master_spelling, k.any_spelling)    AS product_name,
       k.is_in_item_master,
       r.master_name_key,
       r.resolved_by,
       r.master_name_key IS NOT NULL                   AS is_resolved,
       coalesce(it.item_count, 0)                      AS item_count,
       it.item_ids,
       coalesce(p.item_id, it.item_ids[1])             AS primary_item_id,
       coalesce(it.item_count, 0) > 1                  AS has_several_items,
       coalesce(it.uom_count, 0) > 1                   AS is_mixed_uom,
       CASE WHEN it.uom_count = 1 THEN it.uom END      AS uom,
       CASE WHEN it.uom_count = 1 THEN it.uom ELSE pi.uom END AS plan_uom,
       it.uom_count > 1 AND pi.uom IS NOT NULL         AS uom_assumed,
       coalesce(it.item_group_count, 0) > 1            AS spans_item_groups,
       CASE WHEN it.item_group_count = 1 THEN it.item_group END AS item_group,
       CASE WHEN it.business_count = 1 THEN it.business END     AS business,
       coalesce(it.any_performance_chemicals, false)   AS is_performance_chemicals,
       coalesce(it.any_usable, false)                  AS is_usable,
       t.temp_item_id,
       t.temp_item_id IS NOT NULL AND NOT k.is_in_item_master AS is_temp_item,
       k.used_in_plan,
       k.used_in_projection,
       k.used_in_crm_actuals
FROM keys k
JOIN resolved r          ON r.name_key = k.name_key
LEFT JOIN keys km        ON km.name_key = r.master_name_key
LEFT JOIN items it       ON it.name_key = r.master_name_key
LEFT JOIN primary_item p ON p.name_key = r.master_name_key
LEFT JOIN dim_item pi    ON pi.item_id = coalesce(p.item_id, it.item_ids[1])
LEFT JOIN temp t         ON t.name_key = k.name_key;

CREATE UNIQUE INDEX ix_dim_plan_product_key ON dim_plan_product (name_key);
CREATE INDEX ix_dim_plan_product_primary ON dim_plan_product (primary_item_id);

COMMENT ON MATERIALIZED VIEW dim_plan_product IS 'One row per product NAME - the grain the business plan, the projection and crm''s plan actuals all use - with the items behind that name. A name maps to one item on about half the rows and to several (pack sizes) on the rest; is_mixed_uom and spans_item_groups flag the names whose items cannot simply be added up. Every name seen in the plan, the projection, crm''s actuals or the item master is here.';
COMMENT ON COLUMN dim_plan_product.name_key IS 'The product name, lower case and trimmed. The join key for every name-grain view.';
COMMENT ON COLUMN dim_plan_product.product_name IS 'The name for display: the item master''s spelling when the name exists there, else as the plan spells it.';
COMMENT ON COLUMN dim_plan_product.is_in_item_master IS 'The name exists in the item master exactly as spelled. When false, see master_name_key: most such names still resolve.';
COMMENT ON COLUMN dim_plan_product.master_name_key IS 'The item master name this spelling stands for: itself, the alias kept in plan_name_alias, or the one master name with the same letters and digits. Empty when nothing matched. Every name-grain fact carries this key as name_key, so plan and actuals meet under the master spelling.';
COMMENT ON COLUMN dim_plan_product.resolved_by IS 'How the name was resolved: exact / alias / spelling. Empty when it was not.';
COMMENT ON COLUMN dim_plan_product.is_resolved IS 'The name stands for an item master name.';
COMMENT ON COLUMN dim_plan_product.item_count IS 'How many items carry this name. 0 when it is not in the item master.';
COMMENT ON COLUMN dim_plan_product.item_ids IS 'Those item ids.';
COMMENT ON COLUMN dim_plan_product.primary_item_id IS 'The item that shipped most for this name (customer demand, all history), else the lowest id. Use when one item must stand for the name.';
COMMENT ON COLUMN dim_plan_product.has_several_items IS 'More than one item carries the name (pack sizes, usually).';
COMMENT ON COLUMN dim_plan_product.is_mixed_uom IS 'The items behind the name do not share a unit of measure - their quantities must not be added.';
COMMENT ON COLUMN dim_plan_product.uom IS 'The unit, when all items behind the name share one.';
COMMENT ON COLUMN dim_plan_product.plan_uom IS 'The unit a plan quantity for this name is read in: the shared unit, or - when the items mix units - the unit of the item that ships most. Never empty for a resolved name.';
COMMENT ON COLUMN dim_plan_product.uom_assumed IS 'plan_uom was assumed from the item that ships most because the items behind the name mix units. Confirm with the business owner before trusting the quantity.';
COMMENT ON COLUMN dim_plan_product.spans_item_groups IS 'The items behind the name sit in more than one product group.';
COMMENT ON COLUMN dim_plan_product.item_group IS 'The product group, when consistent.';
COMMENT ON COLUMN dim_plan_product.business IS 'The business (segment2), when consistent across the items.';
COMMENT ON COLUMN dim_plan_product.is_performance_chemicals IS 'At least one item behind the name is a Performance Chemicals product.';
COMMENT ON COLUMN dim_plan_product.is_usable IS 'At least one item behind the name is active and enabled.';
COMMENT ON COLUMN dim_plan_product.temp_item_id IS 'The temp item with this name, when one exists.';
COMMENT ON COLUMN dim_plan_product.is_temp_item IS 'The name exists only as a temp item (planned before the product was created).';
COMMENT ON COLUMN dim_plan_product.used_in_plan IS 'The name appears in the business plan.';
COMMENT ON COLUMN dim_plan_product.used_in_projection IS 'The name appears in the projection.';
COMMENT ON COLUMN dim_plan_product.used_in_crm_actuals IS 'The name appears in crm''s plan actuals.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_actual_jc_crm: crm's own actuals for the plan (SPBusinessPlanActualSales), unpivoted to one row per cycle.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_actual_jc_crm CASCADE;

CREATE MATERIALIZED VIEW fact_actual_jc_crm AS
SELECT a.header_id                                      AS source_id,
       j.jc_id,
       a.accyear                                       AS acc_year,
       x.jc_no,
       j.jc_seq,
       coalesce(dp.master_name_key, lower(trim(a.itemdescription))) AS name_key,
       a.itemdescription                               AS product_name,
       a.collector_id,
       a.customer_id,
       -- crm's writer once divided quantities by 1,000; 2020-21 and 2021-22 were never regenerated. values were not affected.
       x.qty * CASE WHEN a.accyear <= '2021-2022' THEN 1000 ELSE 1 END AS quantity,
       x.val * 100000                                  AS value_inr,
       a.generate_date                                 AS as_of
FROM "SPBusinessPlanActualSales" a
CROSS JOIN LATERAL (VALUES
    (1, a.jc1_qty, a.jc1_value), (2, a.jc2_qty, a.jc2_value), (3, a.jc3_qty, a.jc3_value), (4, a.jc4_qty, a.jc4_value),
    (5, a.jc5_qty, a.jc5_value), (6, a.jc6_qty, a.jc6_value), (7, a.jc7_qty, a.jc7_value), (8, a.jc8_qty, a.jc8_value),
    (9, a.jc9_qty, a.jc9_value), (10, a.jc10_qty, a.jc10_value), (11, a.jc11_qty, a.jc11_value), (12, a.jc12_qty, a.jc12_value),
    (13, a.jc13_qty, a.jc13_value)) AS x (jc_no, qty, val)
LEFT JOIN dim_jc j ON j.acc_year = a.accyear AND j.jc_no = x.jc_no
LEFT JOIN dim_plan_product dp ON dp.name_key = lower(trim(a.itemdescription))
WHERE coalesce(x.qty, 0) <> 0 OR coalesce(x.val, 0) <> 0;

CREATE UNIQUE INDEX ix_fact_actual_jc_crm_key ON fact_actual_jc_crm (source_id, jc_no);
CREATE INDEX ix_fact_actual_jc_crm_name ON fact_actual_jc_crm (name_key, collector_id, jc_seq);
CREATE INDEX ix_fact_actual_jc_crm_jc ON fact_actual_jc_crm (jc_id);

COMMENT ON MATERIALIZED VIEW fact_actual_jc_crm IS 'The actuals crm compares the business plan against, one row per cycle x product name x branch x customer: quantity and value invoiced (from oracle, as crm computes it). Product is a NAME, not an item id. Counts everything invoiced except e-commerce - samples, cogt and group company included. Differs from our dispatch-based actuals by design; see v_actual_bridge. Quantities for 2020-21 and 2021-22 are multiplied by 1,000 here: crm''s writer stored those two years divided by 1,000 and never regenerated them (values were unaffected).';
COMMENT ON COLUMN fact_actual_jc_crm.source_id IS 'The crm row the cycle came from (SPBusinessPlanActualSales.header_id). With jc_no, the unique key.';
COMMENT ON COLUMN fact_actual_jc_crm.jc_id IS 'The cycle. Joins dim_jc.';
COMMENT ON COLUMN fact_actual_jc_crm.acc_year IS 'The accounting year.';
COMMENT ON COLUMN fact_actual_jc_crm.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_actual_jc_crm.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN fact_actual_jc_crm.name_key IS 'The product name key, resolved to the item master spelling where crm''s spelling differs (dim_plan_product.master_name_key). Joins dim_plan_product and fact_actual_jc.name_key.';
COMMENT ON COLUMN fact_actual_jc_crm.product_name IS 'The product name as crm spells it (may differ from the key).';
COMMENT ON COLUMN fact_actual_jc_crm.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_actual_jc_crm.customer_id IS 'The customer. Joins dim_customer.';
COMMENT ON COLUMN fact_actual_jc_crm.quantity IS 'Quantity invoiced in the cycle, in the product''s unit (2020-21 and 2021-22 corrected x1,000, see the view comment).';
COMMENT ON COLUMN fact_actual_jc_crm.value_inr IS 'Value invoiced in rupees (crm stores lakhs; multiplied back).';
COMMENT ON COLUMN fact_actual_jc_crm.as_of IS 'When crm generated the row.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_actual_bridge: ours vs crm's actuals per product name x branch x cycle. never expected to match exactly.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_actual_bridge CASCADE;

CREATE VIEW v_actual_bridge AS
WITH ours AS (
    SELECT name_key, collector_id, jc_id, jc_seq, acc_year, jc_no,
           sum(quantity) FILTER (WHERE is_demand)                       AS demand_qty,
           sum(quantity) FILTER (WHERE in_crm_universe)                 AS crm_universe_qty,
           sum(quantity) FILTER (WHERE is_ecommerce AND is_demand)      AS ecommerce_qty,
           sum(quantity) FILTER (WHERE is_sample)                       AS sample_qty,
           sum(quantity) FILTER (WHERE is_inter_company)                AS inter_company_qty
    FROM fact_actual_jc
    GROUP BY name_key, collector_id, jc_id, jc_seq, acc_year, jc_no
),
theirs AS (
    SELECT name_key, collector_id, jc_id, jc_seq, acc_year, jc_no, sum(quantity) AS crm_qty
    FROM fact_actual_jc_crm
    WHERE jc_id IS NOT NULL
    GROUP BY name_key, collector_id, jc_id, jc_seq, acc_year, jc_no
)
SELECT coalesce(o.name_key, t.name_key)               AS name_key,
       coalesce(o.collector_id, t.collector_id)       AS collector_id,
       coalesce(o.jc_id, t.jc_id)                     AS jc_id,
       coalesce(o.jc_seq, t.jc_seq)                   AS jc_seq,
       coalesce(o.acc_year, t.acc_year)               AS acc_year,
       coalesce(o.jc_no, t.jc_no)                     AS jc_no,
       coalesce(o.demand_qty, 0)                      AS our_demand_qty,
       coalesce(o.crm_universe_qty, 0)                AS our_crm_universe_qty,
       coalesce(t.crm_qty, 0)                         AS crm_qty,
       coalesce(t.crm_qty, 0) - coalesce(o.crm_universe_qty, 0) AS gap_qty,
       coalesce(o.ecommerce_qty, 0)                   AS our_ecommerce_qty,
       coalesce(o.sample_qty, 0)                      AS our_sample_qty,
       coalesce(o.inter_company_qty, 0)               AS our_inter_company_qty,
       o.name_key IS NOT NULL                         AS in_ours,
       t.name_key IS NOT NULL                         AS in_crm
FROM ours o
FULL OUTER JOIN theirs t ON t.name_key = o.name_key AND t.collector_id = o.collector_id AND t.jc_id = o.jc_id;

COMMENT ON VIEW v_actual_bridge IS 'Our dispatch-based actuals next to crm''s invoice-based actuals, per product name x branch x cycle, with the gap. They differ by design: crm counts samples, cogt and group company but not e-commerce, nets returns, and books by invoice date; we count confirmed dispatches by dispatch date. Use it to explain a difference, not to make it zero.';
COMMENT ON COLUMN v_actual_bridge.name_key IS 'The product name key. Joins dim_plan_product.';
COMMENT ON COLUMN v_actual_bridge.collector_id IS 'The branch.';
COMMENT ON COLUMN v_actual_bridge.jc_id IS 'The cycle.';
COMMENT ON COLUMN v_actual_bridge.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN v_actual_bridge.acc_year IS 'Accounting year.';
COMMENT ON COLUMN v_actual_bridge.jc_no IS 'Cycle number.';
COMMENT ON COLUMN v_actual_bridge.our_demand_qty IS 'Our customer demand (is_demand): sales and exports, not inter company, e-commerce included.';
COMMENT ON COLUMN v_actual_bridge.our_crm_universe_qty IS 'Our dispatches restricted to what crm counts: invoiced kinds, e-commerce excluded, inter company and samples included.';
COMMENT ON COLUMN v_actual_bridge.crm_qty IS 'crm''s own actual for the cycle.';
COMMENT ON COLUMN v_actual_bridge.gap_qty IS 'crm minus ours in crm''s universe. Left over: returns netted by crm, invoice vs dispatch timing at cycle boundaries, substitutions, name spelling.';
COMMENT ON COLUMN v_actual_bridge.our_ecommerce_qty IS 'E-commerce demand we count and crm does not.';
COMMENT ON COLUMN v_actual_bridge.our_sample_qty IS 'Samples crm counts and demand does not.';
COMMENT ON COLUMN v_actual_bridge.our_inter_company_qty IS 'Group company supplies crm counts and demand does not.';
COMMENT ON COLUMN v_actual_bridge.in_ours IS 'We shipped something for this name x branch x cycle.';
COMMENT ON COLUMN v_actual_bridge.in_crm IS 'crm invoiced something for it.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_plan_product_mix: how a product name splits into items per branch, from what shipped in the last 4 completed
-- cycles (all history as fallback). the disaggregation key for a name-level number.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_plan_product_mix CASCADE;

CREATE VIEW v_plan_product_mix AS
WITH cur AS (SELECT jc_seq FROM dim_jc WHERE is_current),
recent AS (
    SELECT a.name_key, a.collector_id, a.item_id, sum(a.quantity) AS qty
    FROM fact_actual_jc a, cur
    WHERE a.is_demand AND a.jc_seq BETWEEN cur.jc_seq - 4 AND cur.jc_seq - 1
    GROUP BY 1, 2, 3
),
alltime AS (
    SELECT a.name_key, a.collector_id, a.item_id, sum(a.quantity) AS qty
    FROM fact_actual_jc a WHERE a.is_demand GROUP BY 1, 2, 3
)
SELECT coalesce(r.name_key, t.name_key)               AS name_key,
       coalesce(r.collector_id, t.collector_id)       AS collector_id,
       coalesce(r.item_id, t.item_id)                 AS item_id,
       coalesce(r.qty, 0)                             AS recent_qty,
       coalesce(r.qty, 0) / nullif(sum(r.qty) OVER (PARTITION BY coalesce(r.name_key, t.name_key), coalesce(r.collector_id, t.collector_id)), 0) AS recent_share,
       t.qty                                          AS alltime_qty,
       t.qty / nullif(sum(t.qty) OVER (PARTITION BY coalesce(r.name_key, t.name_key), coalesce(r.collector_id, t.collector_id)), 0) AS alltime_share,
       coalesce(
           coalesce(r.qty, 0) / nullif(sum(r.qty) OVER (PARTITION BY coalesce(r.name_key, t.name_key), coalesce(r.collector_id, t.collector_id)), 0),
           t.qty / nullif(sum(t.qty) OVER (PARTITION BY coalesce(r.name_key, t.name_key), coalesce(r.collector_id, t.collector_id)), 0)) AS share
FROM recent r
FULL OUTER JOIN alltime t ON t.name_key = r.name_key AND t.collector_id = r.collector_id AND t.item_id = r.item_id;

COMMENT ON VIEW v_plan_product_mix IS 'How a product name splits into its items at a branch, from what shipped: the share of each item in the last four completed cycles, with the all-time share as fallback. Multiply a name-level plan or forecast by share to get item-level numbers.';
COMMENT ON COLUMN v_plan_product_mix.name_key IS 'The product name key.';
COMMENT ON COLUMN v_plan_product_mix.collector_id IS 'The branch.';
COMMENT ON COLUMN v_plan_product_mix.item_id IS 'The item.';
COMMENT ON COLUMN v_plan_product_mix.recent_qty IS 'Demand quantity of this item in the last four completed cycles.';
COMMENT ON COLUMN v_plan_product_mix.recent_share IS 'Its share of the name at this branch over those cycles. Empty when the name did not ship recently.';
COMMENT ON COLUMN v_plan_product_mix.alltime_qty IS 'Demand quantity over all history.';
COMMENT ON COLUMN v_plan_product_mix.alltime_share IS 'Its all-time share of the name at this branch.';
COMMENT ON COLUMN v_plan_product_mix.share IS 'The share to use: recent when available, else all-time.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_forecast_baseline_item / _name: the accuracy harness. for every product x branch that had demand, every cycle
-- from 2022-23 to three ahead: the actual, the naive forecast (same cycle last year), the 4-cycle averages, and the errors.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_forecast_baseline_item CASCADE;

CREATE MATERIALIZED VIEW fact_forecast_baseline_item AS
WITH cycles AS (
    SELECT jc_id, jc_seq, acc_year, jc_no, jc_start, jc_end, is_completed, is_current, is_future
    FROM dim_jc
    WHERE jc_id > 0 AND acc_year >= '2021-2022'
      AND jc_seq <= (SELECT jc_seq FROM dim_jc WHERE is_current) + 3
),
pairs AS (
    SELECT item_id, collector_id, min(jc_seq) AS first_seq
    FROM fact_actual_jc WHERE is_demand AND acc_year >= '2021-2022'
    GROUP BY 1, 2
),
actual AS (
    SELECT item_id, collector_id, jc_seq, sum(quantity) AS qty
    FROM fact_actual_jc WHERE is_demand
    GROUP BY 1, 2, 3
),
grid AS (
    SELECT p.item_id, p.collector_id, c.jc_id, c.jc_seq, c.acc_year, c.jc_no, c.is_completed, c.is_current, c.is_future,
           coalesce(a.qty, 0) AS actual_qty, (a.qty IS NOT NULL) AS has_actual
    FROM pairs p
    JOIN cycles c ON c.jc_seq >= p.first_seq
    LEFT JOIN actual a ON a.item_id = p.item_id AND a.collector_id = p.collector_id AND a.jc_seq = c.jc_seq
),
lagged AS (
    SELECT g.*,
           lag(actual_qty, 13) OVER w AS naive_qty,
           (lag(actual_qty, 1) OVER w + lag(actual_qty, 2) OVER w + lag(actual_qty, 3) OVER w + lag(actual_qty, 4) OVER w) / 4.0 AS avg4_qty,
           CASE WHEN (lag(actual_qty, 1) OVER w > 0)::int + (lag(actual_qty, 2) OVER w > 0)::int + (lag(actual_qty, 3) OVER w > 0)::int + (lag(actual_qty, 4) OVER w > 0)::int > 0
                THEN (lag(actual_qty, 1) OVER w + lag(actual_qty, 2) OVER w + lag(actual_qty, 3) OVER w + lag(actual_qty, 4) OVER w)
                     / ((lag(actual_qty, 1) OVER w > 0)::int + (lag(actual_qty, 2) OVER w > 0)::int + (lag(actual_qty, 3) OVER w > 0)::int + (lag(actual_qty, 4) OVER w > 0)::int)
                ELSE 0 END AS avg4_nonzero_qty,
           row_number() OVER w AS n_in_series
    FROM grid g
    WINDOW w AS (PARTITION BY g.item_id, g.collector_id ORDER BY g.jc_seq)
)
SELECT item_id, collector_id, jc_id, jc_seq, acc_year, jc_no, is_completed, is_current, is_future,
       CASE WHEN is_completed OR is_current THEN actual_qty END        AS actual_qty,
       CASE WHEN n_in_series > 13 THEN naive_qty END                    AS naive_qty,
       CASE WHEN n_in_series > 4  THEN avg4_qty END                     AS avg4_qty,
       CASE WHEN n_in_series > 4  THEN avg4_nonzero_qty END             AS avg4_nonzero_qty,
       CASE WHEN is_completed AND n_in_series > 13 THEN abs(actual_qty - naive_qty) END        AS naive_abs_error,
       CASE WHEN is_completed AND n_in_series > 4  THEN abs(actual_qty - avg4_qty) END         AS avg4_abs_error,
       CASE WHEN is_completed AND n_in_series > 4  THEN abs(actual_qty - avg4_nonzero_qty) END AS avg4_nonzero_abs_error
FROM lagged;

CREATE UNIQUE INDEX ix_fcbi_key ON fact_forecast_baseline_item (item_id, collector_id, jc_seq);
CREATE INDEX ix_fcbi_jc ON fact_forecast_baseline_item (jc_id);

COMMENT ON MATERIALIZED VIEW fact_forecast_baseline_item IS 'The accuracy harness at product x branch grain. For every product x branch that had customer demand since 2021-22, one row per cycle from then to three cycles ahead: the actual demand, the naive forecast (the same cycle a year earlier), the average of the previous four cycles (plain, and over non-zero cycles the way crm averages), and the absolute errors on completed cycles. WAPE for a forecast over any slice = sum(abs error) / sum(actual).';
COMMENT ON COLUMN fact_forecast_baseline_item.item_id IS 'The product. Joins dim_item.';
COMMENT ON COLUMN fact_forecast_baseline_item.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_forecast_baseline_item.jc_id IS 'The cycle. Joins dim_jc.';
COMMENT ON COLUMN fact_forecast_baseline_item.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN fact_forecast_baseline_item.acc_year IS 'Accounting year.';
COMMENT ON COLUMN fact_forecast_baseline_item.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_forecast_baseline_item.is_completed IS 'The cycle has ended - the actual is final and the errors are filled.';
COMMENT ON COLUMN fact_forecast_baseline_item.is_current IS 'The cycle running today - the actual is partial.';
COMMENT ON COLUMN fact_forecast_baseline_item.is_future IS 'A cycle ahead - only the forecasts are filled.';
COMMENT ON COLUMN fact_forecast_baseline_item.actual_qty IS 'Customer demand shipped in the cycle (0 when nothing shipped). Empty on future cycles.';
COMMENT ON COLUMN fact_forecast_baseline_item.naive_qty IS 'The naive forecast: what shipped in the same cycle a year earlier. Empty for the first year of a series.';
COMMENT ON COLUMN fact_forecast_baseline_item.avg4_qty IS 'Average of the previous four cycles, zeros counted.';
COMMENT ON COLUMN fact_forecast_baseline_item.avg4_nonzero_qty IS 'Average of the previous four cycles over the cycles that had demand (crm''s way of averaging). 0 when none had.';
COMMENT ON COLUMN fact_forecast_baseline_item.naive_abs_error IS 'abs(actual - naive) on completed cycles.';
COMMENT ON COLUMN fact_forecast_baseline_item.avg4_abs_error IS 'abs(actual - avg4) on completed cycles.';
COMMENT ON COLUMN fact_forecast_baseline_item.avg4_nonzero_abs_error IS 'abs(actual - avg4_nonzero) on completed cycles.';


DROP MATERIALIZED VIEW IF EXISTS fact_forecast_baseline_name CASCADE;

CREATE MATERIALIZED VIEW fact_forecast_baseline_name AS
WITH cycles AS (
    SELECT jc_id, jc_seq, acc_year, jc_no, is_completed, is_current, is_future
    FROM dim_jc
    WHERE jc_id > 0 AND acc_year >= '2021-2022'
      AND jc_seq <= (SELECT jc_seq FROM dim_jc WHERE is_current) + 3
),
pairs AS (
    SELECT name_key, collector_id, min(jc_seq) AS first_seq
    FROM fact_actual_jc WHERE is_demand AND acc_year >= '2021-2022'
    GROUP BY 1, 2
),
actual AS (
    SELECT name_key, collector_id, jc_seq, sum(quantity) AS qty
    FROM fact_actual_jc WHERE is_demand
    GROUP BY 1, 2, 3
),
grid AS (
    SELECT p.name_key, p.collector_id, c.jc_id, c.jc_seq, c.acc_year, c.jc_no, c.is_completed, c.is_current, c.is_future,
           coalesce(a.qty, 0) AS actual_qty
    FROM pairs p
    JOIN cycles c ON c.jc_seq >= p.first_seq
    LEFT JOIN actual a ON a.name_key = p.name_key AND a.collector_id = p.collector_id AND a.jc_seq = c.jc_seq
),
lagged AS (
    SELECT g.*,
           lag(actual_qty, 13) OVER w AS naive_qty,
           (lag(actual_qty, 1) OVER w + lag(actual_qty, 2) OVER w + lag(actual_qty, 3) OVER w + lag(actual_qty, 4) OVER w) / 4.0 AS avg4_qty,
           CASE WHEN (lag(actual_qty, 1) OVER w > 0)::int + (lag(actual_qty, 2) OVER w > 0)::int + (lag(actual_qty, 3) OVER w > 0)::int + (lag(actual_qty, 4) OVER w > 0)::int > 0
                THEN (lag(actual_qty, 1) OVER w + lag(actual_qty, 2) OVER w + lag(actual_qty, 3) OVER w + lag(actual_qty, 4) OVER w)
                     / ((lag(actual_qty, 1) OVER w > 0)::int + (lag(actual_qty, 2) OVER w > 0)::int + (lag(actual_qty, 3) OVER w > 0)::int + (lag(actual_qty, 4) OVER w > 0)::int)
                ELSE 0 END AS avg4_nonzero_qty,
           row_number() OVER w AS n_in_series
    FROM grid g
    WINDOW w AS (PARTITION BY g.name_key, g.collector_id ORDER BY g.jc_seq)
)
SELECT name_key, collector_id, jc_id, jc_seq, acc_year, jc_no, is_completed, is_current, is_future,
       CASE WHEN is_completed OR is_current THEN actual_qty END        AS actual_qty,
       CASE WHEN n_in_series > 13 THEN naive_qty END                    AS naive_qty,
       CASE WHEN n_in_series > 4  THEN avg4_qty END                     AS avg4_qty,
       CASE WHEN n_in_series > 4  THEN avg4_nonzero_qty END             AS avg4_nonzero_qty,
       CASE WHEN is_completed AND n_in_series > 13 THEN abs(actual_qty - naive_qty) END        AS naive_abs_error,
       CASE WHEN is_completed AND n_in_series > 4  THEN abs(actual_qty - avg4_qty) END         AS avg4_abs_error,
       CASE WHEN is_completed AND n_in_series > 4  THEN abs(actual_qty - avg4_nonzero_qty) END AS avg4_nonzero_abs_error
FROM lagged;

CREATE UNIQUE INDEX ix_fcbn_key ON fact_forecast_baseline_name (name_key, collector_id, jc_seq);
CREATE INDEX ix_fcbn_jc ON fact_forecast_baseline_name (jc_id);

COMMENT ON MATERIALIZED VIEW fact_forecast_baseline_name IS 'The accuracy harness at product NAME x branch grain - the grain the business plan and the projection use, so the plan can be scored beside the baselines. Same columns and rules as fact_forecast_baseline_item.';
COMMENT ON COLUMN fact_forecast_baseline_name.name_key IS 'The product name key. Joins dim_plan_product.';
COMMENT ON COLUMN fact_forecast_baseline_name.collector_id IS 'The branch.';
COMMENT ON COLUMN fact_forecast_baseline_name.jc_id IS 'The cycle.';
COMMENT ON COLUMN fact_forecast_baseline_name.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN fact_forecast_baseline_name.acc_year IS 'Accounting year.';
COMMENT ON COLUMN fact_forecast_baseline_name.jc_no IS 'Cycle number.';
COMMENT ON COLUMN fact_forecast_baseline_name.is_completed IS 'The cycle has ended.';
COMMENT ON COLUMN fact_forecast_baseline_name.is_current IS 'The cycle running today.';
COMMENT ON COLUMN fact_forecast_baseline_name.is_future IS 'A cycle ahead.';
COMMENT ON COLUMN fact_forecast_baseline_name.actual_qty IS 'Customer demand shipped in the cycle.';
COMMENT ON COLUMN fact_forecast_baseline_name.naive_qty IS 'Same cycle a year earlier.';
COMMENT ON COLUMN fact_forecast_baseline_name.avg4_qty IS 'Average of the previous four cycles.';
COMMENT ON COLUMN fact_forecast_baseline_name.avg4_nonzero_qty IS 'Average of the previous four cycles over those with demand.';
COMMENT ON COLUMN fact_forecast_baseline_name.naive_abs_error IS 'abs(actual - naive) on completed cycles.';
COMMENT ON COLUMN fact_forecast_baseline_name.avg4_abs_error IS 'abs(actual - avg4) on completed cycles.';
COMMENT ON COLUMN fact_forecast_baseline_name.avg4_nonzero_abs_error IS 'abs(actual - avg4_nonzero) on completed cycles.';


-- ===============================================================================================================
-- second half: the plans (customer plan, its next-cycle forecasts, the lead plan, crm's rolled-up projection),
-- the open leads, crm's plan-vs-actual report rebuilt on our data, and the accuracy scoreboard.
--
--   how a cycle's plan is made (crm, sep 2026): the plan for cycle T is entered during weeks 2 and 3 of cycle T-1,
--             sales executive -> technical executive -> branch manager -> regional / business head, each with its own
--             cut-off day. the same entry gives T (split into two fortnights) and single quantities for T+1 and T+2.
--             the approved plan is handed to the planners on the first day of week 4 and pushed to oracle on the last
--             day of T-1. dim_jc carries those dates.
--   status    the workflow ladder: 1 open -> 2 pending TE -> 3 pending BM -> 4 BM approved, pending RM/BH -> 5 fully
--             approved. it changed meaning in april 2025: up to 2024-25 "4" was the final approval and 5 did not
--             exist. is_approved applies that era rule. crm publishes to oracle from status 4 upward, so is_bm_approved
--             is the flag that matches what crm actually ships.
--   approved  approved is not the same as planned: a header can be approved for a cycle with no quantity in it.
--             has_plan says a quantity exists; is_approved says the workflow passed. use both.
--   dupes     a few plan headers carry thousands of identical detail rows (re-saves). folded by max per header x cycle.
-- ===============================================================================================================


-- ---------------------------------------------------------------------------------------------------------------
-- fact_plan_jc: the customer business plan, long: one row per plan header x cycle that carries anything.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_plan_jc CASCADE;

CREATE MATERIALIZED VIEW fact_plan_jc AS
WITH cells AS (
    SELECT d.header_id, x.jc_no,
           max(x.w1)    AS week1_qty,
           max(x.w2)    AS week2_qty,
           max(x.ach)   AS achieved_qty,
           max(x.price) AS avg_sell_price,
           count(*)     AS detail_rows
    FROM "SCBusinessMonthlyPlanDtls" d
    CROSS JOIN LATERAL (VALUES
        (1,  d.jc1_week1_user_dfn_qty,  d.jc1_week2_user_dfn_qty,  d.jc1_qty_achieved,  d.jc1_user_dfn_avg_sell_price),
        (2,  d.jc2_week1_user_dfn_qty,  d.jc2_week2_user_dfn_qty,  d.jc2_qty_achieved,  d.jc2_user_dfn_avg_sell_price),
        (3,  d.jc3_week1_user_dfn_qty,  d.jc3_week2_user_dfn_qty,  d.jc3_qty_achieved,  d.jc3_user_dfn_avg_sell_price),
        (4,  d.jc4_week1_user_dfn_qty,  d.jc4_week2_user_dfn_qty,  d.jc4_qty_achieved,  d.jc4_user_dfn_avg_sell_price),
        (5,  d.jc5_week1_user_dfn_qty,  d.jc5_week2_user_dfn_qty,  d.jc5_qty_achieved,  d.jc5_user_dfn_avg_sell_price),
        (6,  d.jc6_week1_user_dfn_qty,  d.jc6_week2_user_dfn_qty,  d.jc6_qty_achieved,  d.jc6_user_dfn_avg_sell_price),
        (7,  d.jc7_week1_user_dfn_qty,  d.jc7_week2_user_dfn_qty,  d.jc7_qty_achieved,  d.jc7_user_dfn_avg_sell_price),
        (8,  d.jc8_week1_user_dfn_qty,  d.jc8_week2_user_dfn_qty,  d.jc8_qty_achieved,  d.jc8_user_dfn_avg_sell_price),
        (9,  d.jc9_week1_user_dfn_qty,  d.jc9_week2_user_dfn_qty,  d.jc9_qty_achieved,  d.jc9_user_dfn_avg_sell_price),
        (10, d.jc10_week1_user_dfn_qty, d.jc10_week2_user_dfn_qty, d.jc10_qty_achieved, d.jc10_user_dfn_avg_sell_price),
        (11, d.jc11_week1_user_dfn_qty, d.jc11_week2_user_dfn_qty, d.jc11_qty_achieved, d.jc11_user_dfn_avg_sell_price),
        (12, d.jc12_week1_user_dfn_qty, d.jc12_week2_user_dfn_qty, d.jc12_qty_achieved, d.jc12_user_dfn_avg_sell_price),
        (13, d.jc13_week1_user_dfn_qty, d.jc13_week2_user_dfn_qty, d.jc13_qty_achieved, d.jc13_user_dfn_avg_sell_price)
    ) AS x (jc_no, w1, w2, ach, price)
    GROUP BY d.header_id, x.jc_no
),
rows_ AS (
    SELECT h.header_id, h.acc_year, s.jc_no, s.status,
           h.item_description, h.category_id, h.segment2, h.segment3, h.segment4,
           h.customer_id, h.collector_id, h.bill_to_site_id,
           h.new_customer_name, h.new_customer_marketcircle,
           h.is_new_customer, h.is_key_customer, h.is_new_item, h.creation_date, h.last_update_date,
           coalesce(c.week1_qty, 0)                            AS week1_qty,
           coalesce(c.week2_qty, 0)                            AS week2_qty,
           coalesce(c.week1_qty, 0) + coalesce(c.week2_qty, 0) AS plan_qty,
           coalesce(c.achieved_qty, 0)                         AS achieved_qty,
           nullif(c.avg_sell_price, 0)                         AS avg_sell_price,
           coalesce(c.detail_rows, 0)                          AS detail_rows
    FROM "SCBusinessMonthlyPlanHdrs" h
    CROSS JOIN LATERAL (VALUES
        (1, h.jc1_status), (2, h.jc2_status), (3, h.jc3_status), (4, h.jc4_status), (5, h.jc5_status),
        (6, h.jc6_status), (7, h.jc7_status), (8, h.jc8_status), (9, h.jc9_status), (10, h.jc10_status),
        (11, h.jc11_status), (12, h.jc12_status), (13, h.jc13_status)
    ) AS s (jc_no, status)
    LEFT JOIN cells c ON c.header_id = h.header_id AND c.jc_no = s.jc_no
)
SELECT r.header_id                                      AS plan_id,
       r.acc_year,
       r.jc_no,
       coalesce(j.jc_id, -1)                            AS jc_id,
       j.jc_seq,
       coalesce(dp.master_name_key, lower(trim(r.item_description))) AS name_key,
       r.item_description                               AS product_name,
       r.category_id,
       r.segment2,
       r.segment3,
       r.segment4,
       r.customer_id,
       r.collector_id,
       r.bill_to_site_id,
       r.customer_id = -1                               AS is_prospect,
       r.new_customer_name                              AS prospect_name,
       nullif(lower(trim(r.new_customer_marketcircle)), '') AS prospect_mc_code,
       r.is_new_customer,
       r.is_key_customer,
       r.is_new_item,
       r.week1_qty,
       r.week2_qty,
       r.plan_qty,
       r.plan_qty > 0                                   AS has_plan,
       r.achieved_qty,
       r.avg_sell_price,
       r.plan_qty * r.avg_sell_price                    AS plan_value,
       r.status,
       CASE r.status WHEN 1 THEN 'open, not submitted' WHEN 2 THEN 'pending TE'
                     WHEN 3 THEN 'pending BM'          WHEN 4 THEN 'pending RM/BH'
                     WHEN 5 THEN 'approved'            WHEN 6 THEN 'approved (admin)'
                     WHEN 0 THEN 'legacy'              ELSE 'unknown' END AS status_label,
       r.status = 5 OR (r.status = 4 AND r.acc_year <= '2024-2025') AS is_approved,
       r.status >= 4                                    AS is_bm_approved,
       r.detail_rows,
       r.creation_date                                  AS plan_created_at,
       r.last_update_date                               AS plan_updated_at
FROM rows_ r
LEFT JOIN dim_jc j ON j.acc_year = r.acc_year AND j.jc_no = r.jc_no
LEFT JOIN dim_plan_product dp ON dp.name_key = lower(trim(r.item_description))
WHERE r.plan_qty > 0 OR r.achieved_qty > 0 OR r.status <> 1;

CREATE INDEX ix_fact_plan_jc_name ON fact_plan_jc (name_key, collector_id, jc_seq);
CREATE INDEX ix_fact_plan_jc_jc ON fact_plan_jc (jc_id);
CREATE INDEX ix_fact_plan_jc_customer ON fact_plan_jc (customer_id, jc_seq);
CREATE UNIQUE INDEX ix_fact_plan_jc_key ON fact_plan_jc (plan_id, jc_no);

COMMENT ON MATERIALIZED VIEW fact_plan_jc IS 'The customer business plan, one row per plan header (year x customer x branch x product NAME) x cycle: the planned quantity (first and second fortnight), the achieved quantity crm recorded, the planned selling price and value, and the approval status. Rows with nothing in them (no quantity, nothing achieved, not submitted) are left out. is_approved applies the status era rule (4 up to 2024-25, 5 from 2025-26); has_plan says a quantity exists - the two are independent. Duplicate detail rows (re-saves) are folded by max.';
COMMENT ON COLUMN fact_plan_jc.plan_id IS 'The plan header (SCBusinessMonthlyPlanHdrs.header_id).';
COMMENT ON COLUMN fact_plan_jc.acc_year IS 'The accounting year of the plan, e.g. 2026-2027.';
COMMENT ON COLUMN fact_plan_jc.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_plan_jc.jc_id IS 'The cycle. Joins dim_jc. -1 when the year has no calendar.';
COMMENT ON COLUMN fact_plan_jc.jc_seq IS 'Running cycle number, for previous / next arithmetic.';
COMMENT ON COLUMN fact_plan_jc.name_key IS 'The product name key, resolved to the item master spelling where the planner''s differs (dim_plan_product.master_name_key). Joins dim_plan_product, fact_actual_jc.name_key, fact_forecast_baseline_name.name_key.';
COMMENT ON COLUMN fact_plan_jc.product_name IS 'The product name as the planner spelled it (may differ from the key).';
COMMENT ON COLUMN fact_plan_jc.category_id IS 'The item category the planner picked. Joins ItemCategories.';
COMMENT ON COLUMN fact_plan_jc.segment2 IS 'Item segment 2 (division) as planned. crm joins products on name + segment2 + segment3.';
COMMENT ON COLUMN fact_plan_jc.segment3 IS 'Item segment 3 (business) as planned.';
COMMENT ON COLUMN fact_plan_jc.segment4 IS 'Item segment 4 as planned, when set.';
COMMENT ON COLUMN fact_plan_jc.customer_id IS 'The customer. Joins dim_customer. -1 for a prospect (a customer not yet in the master).';
COMMENT ON COLUMN fact_plan_jc.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_plan_jc.bill_to_site_id IS 'The customer site the plan is for. Joins dim_customer_site.';
COMMENT ON COLUMN fact_plan_jc.is_prospect IS 'The plan is for a prospect, not an existing customer: customer_id is -1 and the name is in prospect_name.';
COMMENT ON COLUMN fact_plan_jc.prospect_name IS 'The prospect''s name as typed by the planner.';
COMMENT ON COLUMN fact_plan_jc.prospect_mc_code IS 'The market circle typed for the prospect, lower case. Soft link to dim_market_circle.';
COMMENT ON COLUMN fact_plan_jc.is_new_customer IS 'Planner flagged the customer as new.';
COMMENT ON COLUMN fact_plan_jc.is_key_customer IS 'Planner flagged the customer as key.';
COMMENT ON COLUMN fact_plan_jc.is_new_item IS 'Planner flagged the product as new for this customer.';
COMMENT ON COLUMN fact_plan_jc.week1_qty IS 'Planned quantity for the first fortnight of the cycle.';
COMMENT ON COLUMN fact_plan_jc.week2_qty IS 'Planned quantity for the second fortnight of the cycle.';
COMMENT ON COLUMN fact_plan_jc.plan_qty IS 'Planned quantity for the cycle = week1 + week2, in the product''s unit.';
COMMENT ON COLUMN fact_plan_jc.has_plan IS 'A quantity was planned for the cycle. Independent of is_approved.';
COMMENT ON COLUMN fact_plan_jc.achieved_qty IS 'The quantity crm recorded as achieved against the plan. Sparse; prefer fact_actual_jc / fact_actual_jc_crm for actuals.';
COMMENT ON COLUMN fact_plan_jc.avg_sell_price IS 'The planned average selling price per unit, rupees. Empty when not given.';
COMMENT ON COLUMN fact_plan_jc.plan_value IS 'plan_qty x avg_sell_price, rupees. Empty when unpriced. The crm value columns are not used: their units are mixed.';
COMMENT ON COLUMN fact_plan_jc.status IS 'crm''s workflow status code for the cycle: 1 open, 2 pending technical executive, 3 pending branch manager, 4 branch manager approved and pending regional / business head, 5 fully approved. 6 is an admin edit and 0 a legacy value; neither is set by any crm procedure. No master table in crm.';
COMMENT ON COLUMN fact_plan_jc.status_label IS 'The status in words, as the approval ladder runs: open, not submitted / pending TE / pending BM / pending RM/BH / approved. From crm''s own workflow, sep 2026.';
COMMENT ON COLUMN fact_plan_jc.is_approved IS 'The plan passed FULL approval for this cycle: status 5, or status 4 in years up to 2024-25 (the code changed meaning in April 2025). crm''s screens filter = 5 only. Stricter than what crm publishes - see is_bm_approved.';
COMMENT ON COLUMN fact_plan_jc.is_bm_approved IS 'The branch manager has approved (status 4 or better). This is the level crm publishes to oracle from, so it matches the projection better than is_approved does; in some cycles a large part of the plan never moves past 4.';
COMMENT ON COLUMN fact_plan_jc.detail_rows IS 'How many detail rows crm held for the header (more than one = re-saves, folded by max).';
COMMENT ON COLUMN fact_plan_jc.plan_created_at IS 'When the plan header was created.';
COMMENT ON COLUMN fact_plan_jc.plan_updated_at IS 'When the plan header was last changed.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_plan_forecast: the planner's rolling forecast, long: one row per plan line x the cycle crm labels it with x
-- horizon (1 = the cycle after the label, 2 = the one after that). the target cycle is what it predicts.
-- the label (jc_type) is one cycle AFTER the cycle the rows were entered in: rows labelled JC7 were typed during JC6.
-- so a horizon-1 forecast was really made two cycles before its target. entered_in_jc_id carries the entry cycle.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_plan_forecast CASCADE;

CREATE MATERIALIZED VIEW fact_plan_forecast AS
WITH f AS (
    SELECT d.header_id                     AS plan_id,
           x.jc_type                       AS projected_in_jc_id,
           max(x.jc_nextmonth1_qty)        AS next1_qty,
           max(x.jc_nextmonth2_qty)        AS next2_qty,
           min(x.creation_date)            AS created_at,
           max(x.last_update_date)         AS updated_at,
           count(*)                        AS detail_rows
    FROM "SCBusinessMonthlyPlanJCDtls" x
    JOIN "SCBusinessMonthlyPlanDtls" d ON d.line_id = x.header_id
    GROUP BY d.header_id, x.jc_type
)
SELECT f.plan_id,
       h.acc_year,
       f.projected_in_jc_id,
       m.jc_seq                                         AS projected_in_jc_seq,
       m.jc_no                                          AS projected_in_jc_no,
       e.jc_id                                          AS entered_in_jc_id,
       e.jc_no                                          AS entered_in_jc_no,
       f.created_at::date                               AS entered_on,
       z.horizon,
       t.jc_id                                          AS target_jc_id,
       m.jc_seq + z.horizon                             AS target_jc_seq,
       t.acc_year                                       AS target_acc_year,
       t.jc_no                                          AS target_jc_no,
       lower(trim(h.item_description))                  AS name_key,
       h.item_description                               AS product_name,
       h.customer_id,
       h.collector_id,
       h.customer_id = -1                               AS is_prospect,
       z.forecast_qty,
       f.projected_in_jc_id = -1                        AS projected_in_unknown_jc,
       f.detail_rows,
       f.created_at                                     AS forecast_entered_at,
       f.updated_at                                     AS forecast_updated_at
FROM f
JOIN "SCBusinessMonthlyPlanHdrs" h ON h.header_id = f.plan_id
LEFT JOIN dim_jc m ON m.jc_id = f.projected_in_jc_id
LEFT JOIN dim_jc e ON e.jc_id > 0 AND f.created_at::date BETWEEN e.jc_start AND e.jc_end
CROSS JOIN LATERAL (VALUES (1, f.next1_qty), (2, f.next2_qty)) AS z (horizon, forecast_qty)
LEFT JOIN dim_jc t ON t.jc_seq = m.jc_seq + z.horizon
WHERE coalesce(z.forecast_qty, 0) <> 0;

CREATE INDEX ix_fact_plan_forecast_target ON fact_plan_forecast (name_key, collector_id, target_jc_seq);
CREATE INDEX ix_fact_plan_forecast_projected ON fact_plan_forecast (projected_in_jc_id);
CREATE UNIQUE INDEX ix_fact_plan_forecast_key ON fact_plan_forecast (plan_id, projected_in_jc_id, horizon);

COMMENT ON MATERIALIZED VIEW fact_plan_forecast IS 'The planner''s rolling forecast (SCBusinessMonthlyPlanJCDtls). When a branch enters the plan for a cycle it also gives one quantity for each of the next two cycles. One row per plan line x the cycle the numbers were given for x horizon (1 = the cycle after that one, 2 = the one after that), with the target cycle they predict. Mind the timing: the plan for cycle T is entered during T-1 (entered_in_jc_id, entered_on), so a horizon-1 forecast was made two cycles before its target - older information than a four-cycle average has. Zero forecasts are left out. Score it against actuals by joining the target cycle.';
COMMENT ON COLUMN fact_plan_forecast.plan_id IS 'The plan header the forecast belongs to. Joins fact_plan_jc.plan_id.';
COMMENT ON COLUMN fact_plan_forecast.acc_year IS 'The accounting year of the plan header.';
COMMENT ON COLUMN fact_plan_forecast.projected_in_jc_id IS 'The cycle the numbers were given for (crm''s jc_type): the plan cycle whose entry window produced them. Joins dim_jc. -1 when crm did not record it. The typing happened one cycle earlier - see entered_in_jc_id.';
COMMENT ON COLUMN fact_plan_forecast.projected_in_jc_seq IS 'Running number of that cycle.';
COMMENT ON COLUMN fact_plan_forecast.projected_in_jc_no IS 'That cycle''s number, 1 .. 13.';
COMMENT ON COLUMN fact_plan_forecast.entered_in_jc_id IS 'The cycle the rows were actually typed in (from creation_date) - the information cutoff. Normally the cycle before projected_in_jc_id, since a cycle''s plan is entered during the previous one. Joins dim_jc.';
COMMENT ON COLUMN fact_plan_forecast.entered_in_jc_no IS 'That cycle''s number, 1 .. 13.';
COMMENT ON COLUMN fact_plan_forecast.entered_on IS 'The day the rows were created.';
COMMENT ON COLUMN fact_plan_forecast.horizon IS '1 = a forecast for the cycle after the one being planned, 2 = for the cycle after that.';
COMMENT ON COLUMN fact_plan_forecast.target_jc_id IS 'The cycle the forecast is for. Joins dim_jc. Empty when the cycle it was made in is unknown.';
COMMENT ON COLUMN fact_plan_forecast.target_jc_seq IS 'Running number of the target cycle = projected_in_jc_seq + horizon.';
COMMENT ON COLUMN fact_plan_forecast.target_acc_year IS 'Accounting year of the target cycle.';
COMMENT ON COLUMN fact_plan_forecast.target_jc_no IS 'Cycle number of the target cycle.';
COMMENT ON COLUMN fact_plan_forecast.name_key IS 'The product name, lower case and trimmed. Joins dim_plan_product.';
COMMENT ON COLUMN fact_plan_forecast.product_name IS 'The product name as planned.';
COMMENT ON COLUMN fact_plan_forecast.customer_id IS 'The customer. Joins dim_customer. -1 for a prospect.';
COMMENT ON COLUMN fact_plan_forecast.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_plan_forecast.is_prospect IS 'The plan is for a prospect.';
COMMENT ON COLUMN fact_plan_forecast.forecast_qty IS 'The forecast quantity for the target cycle, in the product''s unit.';
COMMENT ON COLUMN fact_plan_forecast.projected_in_unknown_jc IS 'crm did not record which cycle the numbers were given for, so the target is unknown too.';
COMMENT ON COLUMN fact_plan_forecast.detail_rows IS 'How many crm rows were folded into this one (re-saves).';
COMMENT ON COLUMN fact_plan_forecast.forecast_entered_at IS 'When the forecast rows were created.';
COMMENT ON COLUMN fact_plan_forecast.forecast_updated_at IS 'When the forecast was last changed.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_lead_plan_jc: the lead business plan (SCLeadTargets), long, placed on branch and customer through the lead.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_lead_plan_jc CASCADE;

CREATE VIEW fact_lead_plan_jc AS
SELECT t.header_id                                      AS lead_plan_id,
       t.lead_id,
       l.lead_no,
       t.acc_yr                                         AS acc_year,
       x.jc_no,
       coalesce(j.jc_id, -1)                            AS jc_id,
       j.jc_seq,
       t.item_id,
       t.temp_item_id,
       coalesce(t.is_temp_item, false)                  AS is_temp_item,
       lower(trim(coalesce(i.item_name, tm.temp_itemname))) AS name_key,
       coalesce(i.item_name, tm.temp_itemname)          AS product_name,
       l.collector_id,
       l.company                                        AS customer_id,
       l.customername                                   AS customer_name,
       coalesce(l.is_temp_customer, false)              AS is_temp_customer,
       l.leadstatus                                     AS lead_status_id,
       CASE l.leadstatus WHEN 1 THEN 'Prospect' WHEN 7 THEN 'Converted' WHEN 8 THEN 'Closed' WHEN 9 THEN 'Temporary Close'
            ELSE 'In progress' END                      AS lead_status,
       l.approve_status                                 AS lead_approve_status,
       coalesce(l.converted, false)                     AS lead_converted,
       coalesce(l.leadstatus, 0) <> 8 AND coalesce(l.approve_status, 0) <> 3 AS counts_for_crm,
       coalesce(x.w1, 0)                                AS week1_qty,
       coalesce(x.w2, 0)                                AS week2_qty,
       coalesce(x.w1, 0) + coalesce(x.w2, 0)            AS plan_qty,
       coalesce(x.w1, 0) + coalesce(x.w2, 0) > 0        AS has_plan,
       coalesce(x.ach, 0)                               AS achieved_qty,
       nullif(x.price, 0)                               AS avg_sell_price,
       (coalesce(x.w1, 0) + coalesce(x.w2, 0)) * nullif(x.price, 0) AS plan_value,
       x.status,
       x.status = 5 OR (x.status = 4 AND t.acc_yr <= '2024-2025') AS is_approved,
       t.potential_qty                                  AS annual_potential_qty,
       t.budget_qty                                     AS annual_budget_qty,
       t.creation_date                                  AS plan_created_at,
       t.last_update_date                               AS plan_updated_at
FROM "SCLeadTargets" t
JOIN "LeadDetails" l ON l.lead_id = t.lead_id
LEFT JOIN dim_item i ON i.item_id = t.item_id
LEFT JOIN "TempItemmasters" tm ON tm.temp_item_id = t.temp_item_id
CROSS JOIN LATERAL (VALUES
    (1,  t.jc1_week1_user_dfn_qty,  t.jc1_week2_user_dfn_qty,  t.jc1_qty_achieved,  t.jc1_user_dfn_avg_sell_price,  t.jc1_status),
    (2,  t.jc2_week1_user_dfn_qty,  t.jc2_week2_user_dfn_qty,  t.jc2_qty_achieved,  t.jc2_user_dfn_avg_sell_price,  t.jc2_status),
    (3,  t.jc3_week1_user_dfn_qty,  t.jc3_week2_user_dfn_qty,  t.jc3_qty_achieved,  t.jc3_user_dfn_avg_sell_price,  t.jc3_status),
    (4,  t.jc4_week1_user_dfn_qty,  t.jc4_week2_user_dfn_qty,  t.jc4_qty_achieved,  t.jc4_user_dfn_avg_sell_price,  t.jc4_status),
    (5,  t.jc5_week1_user_dfn_qty,  t.jc5_week2_user_dfn_qty,  t.jc5_qty_achieved,  t.jc5_user_dfn_avg_sell_price,  t.jc5_status),
    (6,  t.jc6_week1_user_dfn_qty,  t.jc6_week2_user_dfn_qty,  t.jc6_qty_achieved,  t.jc6_user_dfn_avg_sell_price,  t.jc6_status),
    (7,  t.jc7_week1_user_dfn_qty,  t.jc7_week2_user_dfn_qty,  t.jc7_qty_achieved,  t.jc7_user_dfn_avg_sell_price,  t.jc7_status),
    (8,  t.jc8_week1_user_dfn_qty,  t.jc8_week2_user_dfn_qty,  t.jc8_qty_achieved,  t.jc8_user_dfn_avg_sell_price,  t.jc8_status),
    (9,  t.jc9_week1_user_dfn_qty,  t.jc9_week2_user_dfn_qty,  t.jc9_qty_achieved,  t.jc9_user_dfn_avg_sell_price,  t.jc9_status),
    (10, t.jc10_week1_user_dfn_qty, t.jc10_week2_user_dfn_qty, t.jc10_qty_achieved, t.jc10_user_dfn_avg_sell_price, t.jc10_status),
    (11, t.jc11_week1_user_dfn_qty, t.jc11_week2_user_dfn_qty, t.jc11_qty_achieved, t.jc11_user_dfn_avg_sell_price, t.jc11_status),
    (12, t.jc12_week1_user_dfn_qty, t.jc12_week2_user_dfn_qty, t.jc12_qty_achieved, t.jc12_user_dfn_avg_sell_price, t.jc12_status),
    (13, t.jc13_week1_user_dfn_qty, t.jc13_week2_user_dfn_qty, t.jc13_qty_achieved, t.jc13_user_dfn_avg_sell_price, t.jc13_status)
) AS x (jc_no, w1, w2, ach, price, status)
LEFT JOIN dim_jc j ON j.acc_year = t.acc_yr AND j.jc_no = x.jc_no
WHERE coalesce(x.w1, 0) + coalesce(x.w2, 0) > 0 OR coalesce(x.ach, 0) > 0 OR coalesce(x.status, 1) <> 1;

COMMENT ON VIEW fact_lead_plan_jc IS 'The lead business plan: what a branch plans to sell to a lead (a prospect not yet a customer, or a new product at a customer), one row per lead plan line x cycle that carries anything. Same shape and rules as fact_plan_jc (status era, approved vs planned). Branch and customer come from the lead. crm''s projection drops closed and rejected leads: counts_for_crm.';
COMMENT ON COLUMN fact_lead_plan_jc.lead_plan_id IS 'The lead plan line (SCLeadTargets.header_id).';
COMMENT ON COLUMN fact_lead_plan_jc.lead_id IS 'The lead. Joins LeadDetails.';
COMMENT ON COLUMN fact_lead_plan_jc.lead_no IS 'The lead number as shown in crm.';
COMMENT ON COLUMN fact_lead_plan_jc.acc_year IS 'The accounting year of the plan.';
COMMENT ON COLUMN fact_lead_plan_jc.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_lead_plan_jc.jc_id IS 'The cycle. Joins dim_jc.';
COMMENT ON COLUMN fact_lead_plan_jc.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN fact_lead_plan_jc.item_id IS 'The product. Joins dim_item. Empty for a temp item.';
COMMENT ON COLUMN fact_lead_plan_jc.temp_item_id IS 'The temp item (a product not yet in the item master). Joins TempItemmasters.';
COMMENT ON COLUMN fact_lead_plan_jc.is_temp_item IS 'The plan is on a temp item.';
COMMENT ON COLUMN fact_lead_plan_jc.name_key IS 'The product name, lower case and trimmed. Joins dim_plan_product.';
COMMENT ON COLUMN fact_lead_plan_jc.product_name IS 'The product name.';
COMMENT ON COLUMN fact_lead_plan_jc.collector_id IS 'The branch that owns the lead. Joins dim_collector. Empty when the lead''s branch name matched none.';
COMMENT ON COLUMN fact_lead_plan_jc.customer_id IS 'The customer or prospect row behind the lead. Joins dim_customer.';
COMMENT ON COLUMN fact_lead_plan_jc.customer_name IS 'The customer name as typed on the lead.';
COMMENT ON COLUMN fact_lead_plan_jc.is_temp_customer IS 'The lead is on a prospect not yet in the customer master.';
COMMENT ON COLUMN fact_lead_plan_jc.lead_status_id IS 'crm lead status code 1 .. 9.';
COMMENT ON COLUMN fact_lead_plan_jc.lead_status IS 'Prospect / In progress / Converted / Closed / Temporary Close.';
COMMENT ON COLUMN fact_lead_plan_jc.lead_approve_status IS 'crm lead approval code 0 .. 3; 3 = rejected.';
COMMENT ON COLUMN fact_lead_plan_jc.lead_converted IS 'The lead became an order.';
COMMENT ON COLUMN fact_lead_plan_jc.counts_for_crm IS 'crm''s projection includes this lead: not closed and not rejected.';
COMMENT ON COLUMN fact_lead_plan_jc.week1_qty IS 'Planned quantity, first fortnight.';
COMMENT ON COLUMN fact_lead_plan_jc.week2_qty IS 'Planned quantity, second fortnight.';
COMMENT ON COLUMN fact_lead_plan_jc.plan_qty IS 'Planned quantity for the cycle = week1 + week2.';
COMMENT ON COLUMN fact_lead_plan_jc.has_plan IS 'A quantity was planned for the cycle.';
COMMENT ON COLUMN fact_lead_plan_jc.achieved_qty IS 'The quantity crm recorded as achieved. Sparse.';
COMMENT ON COLUMN fact_lead_plan_jc.avg_sell_price IS 'Planned selling price per unit, rupees.';
COMMENT ON COLUMN fact_lead_plan_jc.plan_value IS 'plan_qty x avg_sell_price, rupees. Empty when unpriced.';
COMMENT ON COLUMN fact_lead_plan_jc.status IS 'crm workflow status code for the cycle.';
COMMENT ON COLUMN fact_lead_plan_jc.is_approved IS 'Approved for the cycle, era rule as fact_plan_jc.';
COMMENT ON COLUMN fact_lead_plan_jc.annual_potential_qty IS 'The lead''s yearly potential quantity as entered.';
COMMENT ON COLUMN fact_lead_plan_jc.annual_budget_qty IS 'The lead''s yearly budget quantity as entered.';
COMMENT ON COLUMN fact_lead_plan_jc.plan_created_at IS 'When the lead plan line was created.';
COMMENT ON COLUMN fact_lead_plan_jc.plan_updated_at IS 'When the lead plan line was last changed.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_projection_jc: crm's rolled-up projection (SCBusinessPlanProjections), long. one row per product name x
-- branch x cycle x type (PC = customer plans, Lead = lead plans). this is what crm sends to oracle.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_projection_jc CASCADE;

CREATE VIEW fact_projection_jc AS
SELECT p.line_id                                        AS projection_id,
       p.acc_year,
       p.type                                           AS plan_type,
       x.jc_no,
       coalesce(j.jc_id, -1)                            AS jc_id,
       j.jc_seq,
       coalesce(dp.master_name_key, lower(trim(p.item_description))) AS name_key,
       p.item_description                               AS product_name,
       p.item_id,
       p.collector_id,
       coalesce(x.p1, 0)                                AS projection1_qty,
       coalesce(x.p2, 0)                                AS projection2_qty,
       coalesce(x.p1, 0) + coalesce(x.p2, 0)            AS projection_qty,
       j.jc_seq <= (SELECT jc_seq FROM dim_jc WHERE is_current) AS has_fortnight_split,
       p.creation_date                                  AS projection_created_at,
       p.last_update_date                               AS projection_updated_at
FROM "SCBusinessPlanProjections" p
CROSS JOIN LATERAL (VALUES
    (1, p.jc1_projection1, p.jc1_projection2), (2, p.jc2_projection1, p.jc2_projection2), (3, p.jc3_projection1, p.jc3_projection2),
    (4, p.jc4_projection1, p.jc4_projection2), (5, p.jc5_projection1, p.jc5_projection2), (6, p.jc6_projection1, p.jc6_projection2),
    (7, p.jc7_projection1, p.jc7_projection2), (8, p.jc8_projection1, p.jc8_projection2), (9, p.jc9_projection1, p.jc9_projection2),
    (10, p.jc10_projection1, p.jc10_projection2), (11, p.jc11_projection1, p.jc11_projection2), (12, p.jc12_projection1, p.jc12_projection2),
    (13, p.jc13_projection1, p.jc13_projection2)
) AS x (jc_no, p1, p2)
LEFT JOIN dim_jc j ON j.acc_year = p.acc_year AND j.jc_no = x.jc_no
LEFT JOIN dim_plan_product dp ON dp.name_key = lower(trim(p.item_description))
WHERE coalesce(x.p1, 0) <> 0 OR coalesce(x.p2, 0) <> 0;

COMMENT ON VIEW fact_projection_jc IS 'crm''s rolled-up projection, one row per product name x branch x cycle x type: the approved customer plans (PC) or lead plans (Lead) summed per fortnight. It is what crm hands to oracle for supply, written when the cycle is published (the last day of the previous cycle). A cycle''s quantities are final from the week-4 hand-off, so this matches the plan for cycles already published; a later cycle still differs simply because its own entry window has not finished filling. Use fact_plan_jc / fact_lead_plan_jc for the detail and this to see what crm actually published.';
COMMENT ON COLUMN fact_projection_jc.projection_id IS 'The projection row (SCBusinessPlanProjections.line_id).';
COMMENT ON COLUMN fact_projection_jc.acc_year IS 'The accounting year.';
COMMENT ON COLUMN fact_projection_jc.plan_type IS 'PC = from the customer plans, Lead = from the lead plans.';
COMMENT ON COLUMN fact_projection_jc.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_projection_jc.jc_id IS 'The cycle. Joins dim_jc.';
COMMENT ON COLUMN fact_projection_jc.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN fact_projection_jc.name_key IS 'The product name key, resolved to the item master spelling (dim_plan_product.master_name_key). Joins dim_plan_product.';
COMMENT ON COLUMN fact_projection_jc.product_name IS 'The product name as crm spells it.';
COMMENT ON COLUMN fact_projection_jc.item_id IS 'The item crm resolved the name to, when it did. Joins dim_item.';
COMMENT ON COLUMN fact_projection_jc.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_projection_jc.projection1_qty IS 'crm''s first component. On the current and past cycles it is the first fortnight (weeks 1-2); on future cycles crm puts the whole cycle''s forecast here. has_fortnight_split says which.';
COMMENT ON COLUMN fact_projection_jc.projection2_qty IS 'crm''s second component: the second fortnight (weeks 3-4) while has_fortnight_split holds, 0 on future cycles.';
COMMENT ON COLUMN fact_projection_jc.projection_qty IS 'The full-cycle quantity = projection1 + projection2. Split into fortnights only when has_fortnight_split.';
COMMENT ON COLUMN fact_projection_jc.has_fortnight_split IS 'The two components are fortnights (the cycle has started). On later cycles the whole quantity sits in projection1.';
COMMENT ON COLUMN fact_projection_jc.projection_created_at IS 'When crm created the projection row.';
COMMENT ON COLUMN fact_projection_jc.projection_updated_at IS 'When crm last refreshed it.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_plan_name_jc: the plan side rolled up to the report grain - product name x branch x cycle: the approved plan,
-- the planner's forecasts for the cycle, the lead plan and crm's projection, side by side.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_plan_name_jc CASCADE;

CREATE MATERIALIZED VIEW fact_plan_name_jc AS
WITH plan AS (
    SELECT p.name_key, p.collector_id, p.jc_seq,
           sum(p.plan_qty)   FILTER (WHERE p.is_approved)                AS plan_qty,
           sum(p.plan_qty)   FILTER (WHERE NOT p.is_approved)            AS plan_qty_unapproved,
           sum(p.plan_value) FILTER (WHERE p.is_approved)                AS plan_value,
           count(*)          FILTER (WHERE p.is_approved AND p.has_plan) AS plan_lines,
           count(DISTINCT p.customer_id) FILTER (WHERE p.is_approved AND p.has_plan) AS plan_customers
    FROM fact_plan_jc p
    WHERE p.jc_id > 0
    GROUP BY p.name_key, p.collector_id, p.jc_seq
),
fc AS (
    SELECT f.name_key, f.collector_id, f.target_jc_seq AS jc_seq,
           sum(f.forecast_qty) FILTER (WHERE f.horizon = 1) AS forecast_h1_qty,
           sum(f.forecast_qty) FILTER (WHERE f.horizon = 2) AS forecast_h2_qty
    FROM fact_plan_forecast f
    WHERE f.target_jc_id IS NOT NULL
    GROUP BY f.name_key, f.collector_id, f.target_jc_seq
),
lead AS (
    SELECT l.name_key, l.collector_id, l.jc_seq,
           sum(l.plan_qty) FILTER (WHERE l.is_approved AND l.counts_for_crm) AS lead_plan_qty
    FROM fact_lead_plan_jc l
    WHERE l.jc_id > 0 AND l.collector_id IS NOT NULL
    GROUP BY l.name_key, l.collector_id, l.jc_seq
),
proj AS (
    SELECT x.name_key, x.collector_id, x.jc_seq,
           sum(x.projection_qty) FILTER (WHERE x.plan_type = 'PC')   AS projection_pc_qty,
           sum(x.projection_qty) FILTER (WHERE x.plan_type = 'Lead') AS projection_lead_qty
    FROM fact_projection_jc x
    WHERE x.jc_id > 0
    GROUP BY x.name_key, x.collector_id, x.jc_seq
),
keys AS (
    SELECT name_key, collector_id, jc_seq FROM plan
    UNION SELECT name_key, collector_id, jc_seq FROM fc
    UNION SELECT name_key, collector_id, jc_seq FROM lead
    UNION SELECT name_key, collector_id, jc_seq FROM proj
)
SELECT k.name_key, k.collector_id, j.jc_id, k.jc_seq, j.acc_year, j.jc_no,
       coalesce(p.plan_qty, 0)              AS plan_qty,
       coalesce(p.plan_qty_unapproved, 0)   AS plan_qty_unapproved,
       p.plan_value,
       coalesce(p.plan_lines, 0)            AS plan_lines,
       coalesce(p.plan_customers, 0)        AS plan_customers,
       f.forecast_h1_qty,
       f.forecast_h2_qty,
       coalesce(l.lead_plan_qty, 0)         AS lead_plan_qty,
       coalesce(x.projection_pc_qty, 0)     AS projection_pc_qty,
       coalesce(x.projection_lead_qty, 0)   AS projection_lead_qty
FROM keys k
JOIN dim_jc j    ON j.jc_seq = k.jc_seq
LEFT JOIN plan p ON p.name_key = k.name_key AND p.collector_id = k.collector_id AND p.jc_seq = k.jc_seq
LEFT JOIN fc f   ON f.name_key = k.name_key AND f.collector_id = k.collector_id AND f.jc_seq = k.jc_seq
LEFT JOIN lead l ON l.name_key = k.name_key AND l.collector_id = k.collector_id AND l.jc_seq = k.jc_seq
LEFT JOIN proj x ON x.name_key = k.name_key AND x.collector_id = k.collector_id AND x.jc_seq = k.jc_seq;

CREATE UNIQUE INDEX ix_fact_plan_name_jc_key ON fact_plan_name_jc (name_key, collector_id, jc_seq);
CREATE INDEX ix_fact_plan_name_jc_jc ON fact_plan_name_jc (jc_id);

COMMENT ON MATERIALIZED VIEW fact_plan_name_jc IS 'The plan side at the report grain: one row per product name x branch x cycle with the approved customer plan (all customers summed), what is still unapproved, the planner''s forecasts made one and two cycles earlier, the approved lead plan, and crm''s published projection. The counterpart of fact_forecast_baseline_name (the actual side) on the same key.';
COMMENT ON COLUMN fact_plan_name_jc.name_key IS 'The product name, lower case and trimmed. Joins dim_plan_product, fact_forecast_baseline_name.';
COMMENT ON COLUMN fact_plan_name_jc.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_plan_name_jc.jc_id IS 'The cycle. Joins dim_jc.';
COMMENT ON COLUMN fact_plan_name_jc.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN fact_plan_name_jc.acc_year IS 'Accounting year of the cycle.';
COMMENT ON COLUMN fact_plan_name_jc.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_plan_name_jc.plan_qty IS 'Approved plan quantity for the cycle, all customers of the branch summed (fact_plan_jc, is_approved).';
COMMENT ON COLUMN fact_plan_name_jc.plan_qty_unapproved IS 'Plan quantity still waiting for approval or not submitted.';
COMMENT ON COLUMN fact_plan_name_jc.plan_value IS 'Approved plan value, rupees, where the plan lines were priced.';
COMMENT ON COLUMN fact_plan_name_jc.plan_lines IS 'How many approved plan lines with a quantity are behind plan_qty.';
COMMENT ON COLUMN fact_plan_name_jc.plan_customers IS 'How many distinct customers (prospects counted once) are behind plan_qty.';
COMMENT ON COLUMN fact_plan_name_jc.forecast_h1_qty IS 'What the planners forecast for this cycle one cycle earlier (fact_plan_forecast, horizon 1). Empty when none was given.';
COMMENT ON COLUMN fact_plan_name_jc.forecast_h2_qty IS 'What the planners forecast for this cycle two cycles earlier (horizon 2).';
COMMENT ON COLUMN fact_plan_name_jc.lead_plan_qty IS 'Approved lead plan quantity for the cycle, leads crm counts only (fact_lead_plan_jc).';
COMMENT ON COLUMN fact_plan_name_jc.projection_pc_qty IS 'crm''s published projection from the customer plans.';
COMMENT ON COLUMN fact_plan_name_jc.projection_lead_qty IS 'crm''s published projection from the lead plans.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_open_lead: the products on leads that are still open (not converted, not closed), one row per lead product.
-- crm's projection sums quantity over these per product name x branch.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_open_lead CASCADE;

CREATE VIEW fact_open_lead AS
SELECT p.line_id                                        AS lead_product_id,
       l.lead_id,
       l.lead_no,
       l.collector_id,
       l.user_mc_code                                   AS mc_code,
       l.company                                        AS customer_id,
       l.customername                                   AS customer_name,
       coalesce(l.is_temp_customer, false)              AS is_temp_customer,
       l.industry,
       l.leadstatus                                     AS lead_status_id,
       CASE l.leadstatus WHEN 1 THEN 'Prospect' WHEN 9 THEN 'Temporary Close' ELSE 'In progress' END AS lead_status,
       l.approve_status                                 AS lead_approve_status,
       coalesce(l.approve_status, 0) <> 3               AS counts_for_crm,
       l.creation_date                                  AS lead_created_at,
       current_date - l.creation_date::date             AS lead_age_days,
       p.item_id,
       p.temp_item_id,
       p.temp_item_id IS NOT NULL                       AS is_temp_item,
       coalesce(lower(trim(i.item_name)), dp.master_name_key, lower(trim(p.product_itemname))) AS name_key,
       coalesce(i.item_name, p.product_itemname)        AS product_name,
       p.product_group,
       coalesce(p.quantity, 0)                          AS lead_qty,
       p.quantity_value                                 AS lead_value,
       p.potential                                      AS potential_qty,
       p.potential_value,
       p.annualpotential                                AS annual_potential_qty,
       coalesce(p.consider_pcbusinessplan_flag, false)  AS in_pc_plan,
       coalesce(p.sample_request_flag, false)           AS sample_requested,
       p.creation_date                                  AS product_added_at
FROM "LeadProducts" p
JOIN "LeadDetails" l ON l.lead_id = p.leadid
LEFT JOIN dim_item i ON i.item_id = p.item_id
LEFT JOIN dim_plan_product dp ON dp.name_key = lower(trim(p.product_itemname))
WHERE coalesce(l.leadstatus, 0) NOT IN (7, 8);

COMMENT ON VIEW fact_open_lead IS 'The open lead book: every product on a lead that is neither converted nor closed, with the quantity the lead is expected to bring. crm''s projection report sums lead_qty per product name x branch over these (real items only, not temp items). Temporary-closed leads are kept, flagged by lead_status.';
COMMENT ON COLUMN fact_open_lead.lead_product_id IS 'The lead product row (LeadProducts.line_id).';
COMMENT ON COLUMN fact_open_lead.lead_id IS 'The lead. Joins LeadDetails.';
COMMENT ON COLUMN fact_open_lead.lead_no IS 'The lead number as shown in crm.';
COMMENT ON COLUMN fact_open_lead.collector_id IS 'The branch that owns the lead. Joins dim_collector. Empty when the branch name matched none.';
COMMENT ON COLUMN fact_open_lead.mc_code IS 'The market circle of the lead''s owner. Joins dim_market_circle.';
COMMENT ON COLUMN fact_open_lead.customer_id IS 'The customer or prospect row behind the lead. Joins dim_customer.';
COMMENT ON COLUMN fact_open_lead.customer_name IS 'The customer name as typed on the lead.';
COMMENT ON COLUMN fact_open_lead.is_temp_customer IS 'The lead is on a prospect not yet in the customer master.';
COMMENT ON COLUMN fact_open_lead.industry IS 'The industry typed on the lead.';
COMMENT ON COLUMN fact_open_lead.lead_status_id IS 'crm lead status code (1 .. 6, 9 here; 7 converted and 8 closed are excluded).';
COMMENT ON COLUMN fact_open_lead.lead_status IS 'Prospect / In progress / Temporary Close.';
COMMENT ON COLUMN fact_open_lead.lead_approve_status IS 'crm lead approval code 0 .. 3; 3 = rejected.';
COMMENT ON COLUMN fact_open_lead.counts_for_crm IS 'Not rejected (approve_status <> 3). crm''s lead PROJECTION applies this filter; its open-lead quantity does not - and v_plan_vs_actual follows the open-lead rule, so it ignores this flag.';
COMMENT ON COLUMN fact_open_lead.lead_created_at IS 'When the lead was raised.';
COMMENT ON COLUMN fact_open_lead.lead_age_days IS 'Days since the lead was raised.';
COMMENT ON COLUMN fact_open_lead.item_id IS 'The product. Joins dim_item. Empty for temp items and unresolved products.';
COMMENT ON COLUMN fact_open_lead.temp_item_id IS 'The temp item, when the product is not yet in the item master. Joins TempItemmasters.';
COMMENT ON COLUMN fact_open_lead.is_temp_item IS 'The product is a temp item.';
COMMENT ON COLUMN fact_open_lead.name_key IS 'The product name key: the item''s name when the product resolved, else the typed name resolved through dim_plan_product. Joins dim_plan_product.';
COMMENT ON COLUMN fact_open_lead.product_name IS 'The product name (item master spelling when resolved, else as typed on the lead).';
COMMENT ON COLUMN fact_open_lead.product_group IS 'The product group as typed on the lead.';
COMMENT ON COLUMN fact_open_lead.lead_qty IS 'The quantity the lead is expected to bring, in the product''s unit. What crm counts as open lead quantity.';
COMMENT ON COLUMN fact_open_lead.lead_value IS 'The value entered for that quantity, rupees.';
COMMENT ON COLUMN fact_open_lead.potential_qty IS 'The potential quantity entered.';
COMMENT ON COLUMN fact_open_lead.potential_value IS 'The potential value entered, rupees.';
COMMENT ON COLUMN fact_open_lead.annual_potential_qty IS 'The yearly potential quantity entered.';
COMMENT ON COLUMN fact_open_lead.in_pc_plan IS 'Flagged to be considered in the PC business plan.';
COMMENT ON COLUMN fact_open_lead.sample_requested IS 'A sample was requested for the product.';
COMMENT ON COLUMN fact_open_lead.product_added_at IS 'When the product was added to the lead.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_committed_jc: what is already committed for a cycle - open order balances and confirmed quotes, placed on the
-- cycle their date falls in. this is the adhoc demand the plan does not carry: sales raise a quote or an order with a
-- schedule date and the planner has to cover it. a plain view: the open book changes daily and must not go stale.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_committed_jc CASCADE;

CREATE VIEW fact_committed_jc AS
WITH cur AS (
    SELECT jc_id, jc_seq FROM dim_jc WHERE is_current
),
soc AS (
    SELECT lower(trim(i.item_name)) AS name_key, s.collector_id, s.effective_date AS due_date, s.balance_qty AS qty
    FROM fact_schedule_line s
    JOIN dim_item i ON i.item_id = s.item_id
    WHERE s.is_open AND s.is_demand AND NOT s.has_pending_cancellation
      -- crm stops counting a bulk line once it is all but delivered
      AND NOT (lower(trim(s.sale_category)) = 'bulk' AND s.dispatched_qty >= 0.9 * s.scheduled_qty)
),
quo AS (
    SELECT lower(trim(i.item_name)) AS name_key, q.collector_id,
           coalesce(q.delivery_date, q.quote_date) AS due_date, q.quantity AS qty
    FROM fact_quote_line q
    JOIN dim_item i ON i.item_id = q.item_id
    WHERE q.is_open_pipeline
),
lines AS (
    SELECT 'soc' AS src, name_key, collector_id, due_date, qty FROM soc
    UNION ALL
    SELECT 'quote', name_key, collector_id, due_date, qty FROM quo
),
placed AS (
    SELECT l.src, l.name_key, l.collector_id, l.qty, l.due_date,
           CASE WHEN j.jc_seq IS NULL              THEN 'undated'
                WHEN j.jc_seq < c.jc_seq           THEN 'overdue'
                WHEN j.jc_seq <= c.jc_seq + 2      THEN 'in horizon'
                ELSE 'beyond horizon' END          AS horizon_bucket,
           CASE WHEN j.jc_seq IS NULL              THEN -1
                WHEN j.jc_seq < c.jc_seq           THEN c.jc_id
                WHEN j.jc_seq <= c.jc_seq + 2      THEN j.jc_id
                ELSE -1 END                        AS jc_id
    FROM lines l
    CROSS JOIN cur c
    LEFT JOIN dim_jc j ON j.jc_id > 0 AND l.due_date BETWEEN j.jc_start AND j.jc_end
)
SELECT p.name_key,
       p.collector_id,
       p.jc_id,
       j.jc_seq,
       j.acc_year,
       j.jc_no,
       p.horizon_bucket,
       coalesce(sum(p.qty) FILTER (WHERE p.src = 'soc'), 0)   AS open_soc_qty,
       coalesce(sum(p.qty) FILTER (WHERE p.src = 'quote'), 0) AS quote_qty,
       sum(p.qty)                                             AS committed_qty,
       count(*) FILTER (WHERE p.src = 'soc')                  AS soc_lines,
       count(*) FILTER (WHERE p.src = 'quote')                AS quote_lines,
       min(p.due_date)                                        AS earliest_due_date
FROM placed p
LEFT JOIN dim_jc j ON j.jc_id = p.jc_id
GROUP BY p.name_key, p.collector_id, p.jc_id, j.jc_seq, j.acc_year, j.jc_no, p.horizon_bucket;

COMMENT ON VIEW fact_committed_jc IS 'Demand already committed but not planned - the adhoc side. One row per product name x branch x cycle x horizon bucket: the open order balance and the confirmed-but-unordered quotes, each placed on the cycle its date falls in (an order by its schedule date, a quote by its delivery date). Sales raise these outside the planning window, so the planner sees them here beside the plan. A plain view, not materialized: the open book changes every day and must always be current.';
COMMENT ON COLUMN fact_committed_jc.name_key IS 'The product name key. Joins dim_plan_product, fact_plan_name_jc.';
COMMENT ON COLUMN fact_committed_jc.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_committed_jc.jc_id IS 'The cycle the commitment lands in. Overdue rows carry the current cycle; beyond-horizon and undated rows carry -1.';
COMMENT ON COLUMN fact_committed_jc.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN fact_committed_jc.acc_year IS 'Accounting year of that cycle.';
COMMENT ON COLUMN fact_committed_jc.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN fact_committed_jc.horizon_bucket IS 'in horizon = due in the current cycle or the next two, the window the plan covers. overdue = past due and still open, carried on the current cycle - mostly old quotes nobody closed, so read the order and quote parts separately. beyond horizon = due later than the plan reaches. undated = no usable date.';
COMMENT ON COLUMN fact_committed_jc.open_soc_qty IS 'Open order balance: scheduled minus dispatched on open schedule lines that are customer demand with no pending cancellation, bulk lines dropped once 90 percent delivered (crm''s rule).';
COMMENT ON COLUMN fact_committed_jc.quote_qty IS 'Quantity on quotes confirmed but not yet turned into an order (fact_quote_line, is_open_pipeline).';
COMMENT ON COLUMN fact_committed_jc.committed_qty IS 'open_soc_qty + quote_qty - what is already asked for in this cycle.';
COMMENT ON COLUMN fact_committed_jc.soc_lines IS 'How many open schedule lines are behind the row.';
COMMENT ON COLUMN fact_committed_jc.quote_lines IS 'How many quote lines are behind the row.';
COMMENT ON COLUMN fact_committed_jc.earliest_due_date IS 'The earliest date among them.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_plan_reopen: every time an approved plan was opened again for editing. the exception to "a cycle's plan is
-- final once the window closes".
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_plan_reopen CASCADE;

CREATE VIEW fact_plan_reopen AS
SELECT r.line_id                                       AS reopen_id,
       r.acc_year,
       nullif(regexp_replace(r.jc_type, '\D', '', 'g'), '')::int AS jc_no,
       j.jc_id,
       j.jc_seq,
       r.user_id,
       u.name                                          AS user_name,
       r.mc_code,
       m.collector_id,
       coalesce(r.is_reopen, false)                    AS is_reopen,
       r.creation_date                                 AS reopened_at,
       r.creation_date::date                           AS reopened_on,
       o.jc_id                                         AS reopened_in_jc_id
FROM "PcBusinessPlanReopens" r
LEFT JOIN dim_jc j ON j.acc_year = r.acc_year AND j.jc_no = nullif(regexp_replace(r.jc_type, '\D', '', 'g'), '')::int
LEFT JOIN "Users" u ON u.line_id = r.user_id
LEFT JOIN "MarketCircles" m ON m.mc_code = r.mc_code
LEFT JOIN dim_jc o ON o.jc_id > 0 AND r.creation_date::date BETWEEN o.jc_start AND o.jc_end;

COMMENT ON VIEW fact_plan_reopen IS 'Every reopen of an approved business plan: which cycle was opened again, by whom, from which market circle, and when. A cycle''s plan is normally final once its window closes and the projection is published; these are the exceptions, and there are about a hundred a cycle.';
COMMENT ON COLUMN fact_plan_reopen.reopen_id IS 'The crm row (PcBusinessPlanReopens.line_id).';
COMMENT ON COLUMN fact_plan_reopen.acc_year IS 'The accounting year of the plan that was reopened.';
COMMENT ON COLUMN fact_plan_reopen.jc_no IS 'The cycle number that was reopened, from crm''s JC1 .. JC13 text.';
COMMENT ON COLUMN fact_plan_reopen.jc_id IS 'That cycle. Joins dim_jc.';
COMMENT ON COLUMN fact_plan_reopen.jc_seq IS 'Running number of that cycle.';
COMMENT ON COLUMN fact_plan_reopen.user_id IS 'Who reopened it. Joins Users.';
COMMENT ON COLUMN fact_plan_reopen.user_name IS 'That person''s name.';
COMMENT ON COLUMN fact_plan_reopen.mc_code IS 'The market circle. Joins dim_market_circle.';
COMMENT ON COLUMN fact_plan_reopen.collector_id IS 'The branch that circle belongs to. Joins dim_collector.';
COMMENT ON COLUMN fact_plan_reopen.is_reopen IS 'crm''s own flag on the row.';
COMMENT ON COLUMN fact_plan_reopen.reopened_at IS 'When it was reopened.';
COMMENT ON COLUMN fact_plan_reopen.reopened_on IS 'The day it was reopened.';
COMMENT ON COLUMN fact_plan_reopen.reopened_in_jc_id IS 'The cycle that was running when it was reopened - compare with jc_id to see whether the plan was opened before, during or after its own cycle.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_plan_vs_actual: crm's PC projection report rebuilt on our data, per product name x branch x cycle, from last
-- year to three cycles ahead. the plan, the planner's forecast, crm's projection, the previous four cycles (crm's
-- actuals and ours), the naive reference, and today's open book (open orders, confirmed quotes, open leads).
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_plan_vs_actual CASCADE;

CREATE VIEW v_plan_vs_actual AS
WITH cur AS (
    SELECT jc_seq FROM dim_jc WHERE is_current
),
cycles AS (
    SELECT j.jc_id, j.jc_seq, j.acc_year, j.jc_no, j.jc_name, j.is_completed, j.is_current, j.is_future
    FROM dim_jc j, cur
    WHERE j.jc_id > 0 AND j.jc_seq BETWEEN cur.jc_seq - 13 AND cur.jc_seq + 3
),
plan AS (
    SELECT p.* FROM fact_plan_name_jc p, cur
    WHERE p.jc_seq BETWEEN cur.jc_seq - 13 AND cur.jc_seq + 3
),
ours AS (
    SELECT a.name_key, a.collector_id, a.jc_seq, sum(a.quantity) AS qty
    FROM fact_actual_jc a
    WHERE a.is_demand
    GROUP BY a.name_key, a.collector_id, a.jc_seq
),
crm AS (
    SELECT a.name_key, a.collector_id, a.jc_seq, sum(a.quantity) AS qty
    FROM fact_actual_jc_crm a
    WHERE a.jc_id > 0
    GROUP BY a.name_key, a.collector_id, a.jc_seq
),
pairs AS (
    SELECT name_key, collector_id FROM plan
    UNION SELECT o.name_key, o.collector_id FROM ours o, cur WHERE o.jc_seq >= cur.jc_seq - 26
    UNION SELECT o.name_key, o.collector_id FROM crm  o, cur WHERE o.jc_seq >= cur.jc_seq - 26
),
grid AS (
    SELECT p.name_key, p.collector_id, j.jc_seq
    FROM pairs p
    CROSS JOIN (SELECT j.jc_seq FROM dim_jc j, cur WHERE j.jc_id > 0 AND j.jc_seq BETWEEN cur.jc_seq - 26 AND cur.jc_seq + 3) j
),
hist AS (
    SELECT g.name_key, g.collector_id, g.jc_seq,
           cr.qty                                                  AS crm_qty,
           o.qty                                                   AS our_qty,
           sum(coalesce(cr.qty, 0))               OVER prev4       AS crm_prev4_qty,
           count(*) FILTER (WHERE cr.qty > 0)     OVER prev4       AS crm_prev4_nonzero_cycles,
           lag(cr.qty, 13)                        OVER series      AS crm_naive_qty,
           sum(coalesce(o.qty, 0))                OVER prev4       AS our_prev4_qty,
           count(*) FILTER (WHERE o.qty > 0)      OVER prev4       AS our_prev4_nonzero_cycles,
           lag(o.qty, 13)                         OVER series      AS our_naive_qty
    FROM grid g
    LEFT JOIN crm cr ON cr.name_key = g.name_key AND cr.collector_id = g.collector_id AND cr.jc_seq = g.jc_seq
    LEFT JOIN ours o ON o.name_key = g.name_key AND o.collector_id = g.collector_id AND o.jc_seq = g.jc_seq
    WINDOW series AS (PARTITION BY g.name_key, g.collector_id ORDER BY g.jc_seq),
           prev4  AS (PARTITION BY g.name_key, g.collector_id ORDER BY g.jc_seq ROWS BETWEEN 4 PRECEDING AND 1 PRECEDING)
),
warehouse AS (
    SELECT DISTINCT ON (m.collector_id) m.collector_id, m.inventory_org_id
    FROM "BiCollectorInventoryOrgMapping" m
    WHERE m.enddate IS NULL OR m.enddate >= current_date
    ORDER BY m.collector_id, m.startdate DESC NULLS LAST, m.header_id
),
committed AS (
    SELECT name_key, collector_id, jc_id,
           sum(open_soc_qty)  FILTER (WHERE horizon_bucket = 'in horizon') AS open_soc_qty,
           sum(quote_qty)     FILTER (WHERE horizon_bucket = 'in horizon') AS quote_qty,
           sum(committed_qty) FILTER (WHERE horizon_bucket = 'in horizon') AS committed_qty,
           sum(open_soc_qty)  FILTER (WHERE horizon_bucket = 'overdue')    AS overdue_soc_qty,
           sum(quote_qty)     FILTER (WHERE horizon_bucket = 'overdue')    AS overdue_quote_qty
    FROM fact_committed_jc
    WHERE jc_id > 0
    GROUP BY 1, 2, 3
),
leads AS (
    SELECT l.name_key, l.collector_id,
           sum(l.lead_qty) FILTER (WHERE l.item_id IS NOT NULL) AS open_lead_qty,
           sum(l.lead_qty)                                      AS open_lead_qty_incl_temp
    FROM fact_open_lead l
    GROUP BY 1, 2
)
SELECT k.name_key,
       coalesce(dp.product_name, k.name_key)            AS product_name,
       k.collector_id,
       dc.branch_name,
       w.inventory_org_id                               AS primary_inventory_org_id,
       c.jc_id, c.jc_seq, c.acc_year, c.jc_no, c.jc_name, c.is_completed, c.is_current, c.is_future,
       coalesce(p.plan_qty, 0)                          AS plan_qty,
       coalesce(p.plan_qty_unapproved, 0)               AS plan_qty_unapproved,
       p.plan_value,
       coalesce(p.plan_lines, 0)                        AS plan_lines,
       coalesce(p.plan_customers, 0)                    AS plan_customers,
       p.forecast_h1_qty,
       p.forecast_h2_qty,
       coalesce(p.lead_plan_qty, 0)                     AS lead_plan_qty,
       coalesce(p.projection_pc_qty, 0)                 AS projection_pc_qty,
       coalesce(p.projection_lead_qty, 0)               AS projection_lead_qty,
       CASE WHEN NOT c.is_future THEN coalesce(k.crm_qty, 0) END  AS crm_actual_qty,
       CASE WHEN NOT c.is_future THEN coalesce(k.our_qty, 0) END  AS our_actual_qty,
       k.crm_prev4_qty,
       k.crm_prev4_qty / 4                              AS crm_prev4_avg_qty,
       k.crm_prev4_qty / nullif(k.crm_prev4_nonzero_cycles, 0) AS crm_prev4_avg_nonzero_qty,
       coalesce(k.crm_naive_qty, 0)                     AS crm_naive_qty,
       k.our_prev4_qty,
       k.our_prev4_qty / 4                              AS our_prev4_avg_qty,
       k.our_prev4_qty / nullif(k.our_prev4_nonzero_cycles, 0) AS our_prev4_avg_nonzero_qty,
       coalesce(k.our_naive_qty, 0)                     AS our_naive_qty,
       round((100 * (coalesce(p.plan_qty, 0) - k.crm_prev4_qty / nullif(k.crm_prev4_nonzero_cycles, 0))
                / nullif(k.crm_prev4_qty / nullif(k.crm_prev4_nonzero_cycles, 0), 0))::numeric, 1) AS plan_vs_avg_pct,
       coalesce(cm.open_soc_qty, 0)                     AS open_soc_qty,
       coalesce(cm.quote_qty, 0)                        AS quote_qty,
       coalesce(cm.committed_qty, 0)                    AS committed_qty,
       coalesce(cm.overdue_soc_qty, 0)                  AS overdue_soc_qty,
       coalesce(cm.overdue_quote_qty, 0)                AS overdue_quote_qty,
       greatest(coalesce(cm.committed_qty, 0) - coalesce(p.plan_qty, 0), 0) AS unplanned_qty,
       CASE WHEN NOT c.is_completed THEN coalesce(l.open_lead_qty, 0) END         AS open_lead_qty,
       CASE WHEN NOT c.is_completed THEN coalesce(l.open_lead_qty_incl_temp, 0) END AS open_lead_qty_incl_temp
FROM hist k
JOIN cycles c ON c.jc_seq = k.jc_seq
LEFT JOIN plan p  ON p.name_key = k.name_key AND p.collector_id = k.collector_id AND p.jc_seq = k.jc_seq
LEFT JOIN committed cm ON cm.name_key = k.name_key AND cm.collector_id = k.collector_id AND cm.jc_id = c.jc_id
LEFT JOIN leads l    ON l.name_key = k.name_key AND l.collector_id = k.collector_id
LEFT JOIN warehouse w ON w.collector_id = k.collector_id
LEFT JOIN dim_plan_product dp ON dp.name_key = k.name_key
LEFT JOIN dim_collector dc ON dc.collector_id = k.collector_id;

COMMENT ON VIEW v_plan_vs_actual IS 'crm''s PC projection report rebuilt on our data: one row per product name x branch x cycle, from the same cycle last year to three cycles ahead. Side by side: the approved plan, the planner''s forecasts made one and two cycles earlier, crm''s published projection, the actual (crm''s and ours, on cycles that have started), the previous four cycles and their averages (crm''s and ours), the same cycle last year, and - on cycles not yet completed - today''s open book: open order balance, confirmed quotes without an order, open leads. plan_vs_avg_pct is crm''s "% diff" (plan against the non-zero average of the previous four cycles of crm''s actuals). Product names are matched lower case and trimmed.';
COMMENT ON COLUMN v_plan_vs_actual.name_key IS 'The product name, lower case and trimmed. Joins dim_plan_product.';
COMMENT ON COLUMN v_plan_vs_actual.product_name IS 'The product name for display.';
COMMENT ON COLUMN v_plan_vs_actual.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN v_plan_vs_actual.branch_name IS 'The branch name.';
COMMENT ON COLUMN v_plan_vs_actual.primary_inventory_org_id IS 'The warehouse that serves the branch today (the latest open mapping in BiCollectorInventoryOrgMapping; a branch can have several). Joins InventoryOrgs.';
COMMENT ON COLUMN v_plan_vs_actual.jc_id IS 'The cycle. Joins dim_jc.';
COMMENT ON COLUMN v_plan_vs_actual.jc_seq IS 'Running cycle number.';
COMMENT ON COLUMN v_plan_vs_actual.acc_year IS 'Accounting year of the cycle.';
COMMENT ON COLUMN v_plan_vs_actual.jc_no IS 'Cycle number 1 .. 13.';
COMMENT ON COLUMN v_plan_vs_actual.jc_name IS 'JC1 .. JC13.';
COMMENT ON COLUMN v_plan_vs_actual.is_completed IS 'The cycle has ended.';
COMMENT ON COLUMN v_plan_vs_actual.is_current IS 'Today falls in this cycle.';
COMMENT ON COLUMN v_plan_vs_actual.is_future IS 'The cycle has not started.';
COMMENT ON COLUMN v_plan_vs_actual.plan_qty IS 'Approved plan quantity for the cycle, all customers of the branch summed (fact_plan_jc, is_approved).';
COMMENT ON COLUMN v_plan_vs_actual.plan_qty_unapproved IS 'Plan quantity still waiting for approval or not submitted.';
COMMENT ON COLUMN v_plan_vs_actual.plan_value IS 'Approved plan value, rupees, where the plan lines were priced.';
COMMENT ON COLUMN v_plan_vs_actual.plan_lines IS 'How many approved plan lines with a quantity are behind plan_qty.';
COMMENT ON COLUMN v_plan_vs_actual.plan_customers IS 'How many distinct customers (prospects counted once) are behind plan_qty.';
COMMENT ON COLUMN v_plan_vs_actual.forecast_h1_qty IS 'What the planners forecast for this cycle one cycle earlier (fact_plan_forecast, horizon 1). Empty when none was given.';
COMMENT ON COLUMN v_plan_vs_actual.forecast_h2_qty IS 'What the planners forecast for this cycle two cycles earlier (horizon 2).';
COMMENT ON COLUMN v_plan_vs_actual.lead_plan_qty IS 'Approved lead plan quantity for the cycle (fact_lead_plan_jc, leads crm counts).';
COMMENT ON COLUMN v_plan_vs_actual.projection_pc_qty IS 'crm''s published projection from the customer plans.';
COMMENT ON COLUMN v_plan_vs_actual.projection_lead_qty IS 'crm''s published projection from the lead plans.';
COMMENT ON COLUMN v_plan_vs_actual.crm_actual_qty IS 'crm''s actual for the cycle (invoiced, everything but e-commerce). Empty on future cycles; partial on the current one.';
COMMENT ON COLUMN v_plan_vs_actual.our_actual_qty IS 'Our actual for the cycle: customer demand shipped (fact_actual_jc, is_demand). Empty on future cycles; partial on the current one.';
COMMENT ON COLUMN v_plan_vs_actual.crm_prev4_qty IS 'crm''s actuals summed over the previous four cycles.';
COMMENT ON COLUMN v_plan_vs_actual.crm_prev4_avg_qty IS 'crm''s actuals averaged over the previous four cycles, zeros included.';
COMMENT ON COLUMN v_plan_vs_actual.crm_prev4_avg_nonzero_qty IS 'crm''s actuals averaged over the previous four cycles counting only cycles with sales - the way crm''s report averages. Empty when none of the four had sales.';
COMMENT ON COLUMN v_plan_vs_actual.crm_naive_qty IS 'crm''s actual in the same cycle a year earlier.';
COMMENT ON COLUMN v_plan_vs_actual.our_prev4_qty IS 'Our demand summed over the previous four cycles.';
COMMENT ON COLUMN v_plan_vs_actual.our_prev4_avg_qty IS 'Our demand averaged over the previous four cycles, zeros included.';
COMMENT ON COLUMN v_plan_vs_actual.our_prev4_avg_nonzero_qty IS 'Our demand averaged over the previous four cycles counting only cycles with demand.';
COMMENT ON COLUMN v_plan_vs_actual.our_naive_qty IS 'Our demand in the same cycle a year earlier - the naive forecast.';
COMMENT ON COLUMN v_plan_vs_actual.plan_vs_avg_pct IS 'crm''s "% diff": (plan - crm non-zero average of the previous four cycles) / that average x 100. Empty when there is no average.';
COMMENT ON COLUMN v_plan_vs_actual.open_soc_qty IS 'Open order balance due in THIS cycle (fact_committed_jc): scheduled minus dispatched on open schedule lines that are customer demand with no pending cancellation.';
COMMENT ON COLUMN v_plan_vs_actual.quote_qty IS 'Quantity on confirmed but unordered quotes whose delivery date falls in this cycle.';
COMMENT ON COLUMN v_plan_vs_actual.committed_qty IS 'open_soc_qty + quote_qty: demand already asked for in this cycle, whether or not it was planned.';
COMMENT ON COLUMN v_plan_vs_actual.overdue_soc_qty IS 'Order balance whose schedule date has passed and is still open - real demand that slipped. Carried on the current cycle, so it is zero on every other row.';
COMMENT ON COLUMN v_plan_vs_actual.overdue_quote_qty IS 'Confirmed quotes whose delivery date has passed and that were never ordered. Mostly quotes nobody closed rather than live demand - read it as a hygiene number, not as a commitment. Carried on the current cycle.';
COMMENT ON COLUMN v_plan_vs_actual.unplanned_qty IS 'committed_qty minus the approved plan, never below zero: the part of this cycle''s commitments the plan does not cover. The adhoc demand a planner has to find stock for.';
COMMENT ON COLUMN v_plan_vs_actual.open_lead_qty IS 'Today''s quantity on open leads for real items (fact_open_lead, item resolved) - crm''s rule. Only on cycles not yet completed.';
COMMENT ON COLUMN v_plan_vs_actual.open_lead_qty_incl_temp IS 'Open lead quantity including temp items and unresolved product names.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_forecast_accuracy: the scoreboard. per accounting year (and per branch) x method: how much of the demand the
-- method covered and how far off it was, on both conventions. methods: the naive and average baselines, the approved
-- plan, the planner's one- and two-cycle forecasts. actuals = our customer demand at product name x branch grain.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_forecast_accuracy CASCADE;

CREATE VIEW v_forecast_accuracy AS
WITH cycles AS (
    SELECT jc_seq, acc_year FROM dim_jc WHERE jc_id > 0 AND is_completed AND acc_year >= '2022-2023'
),
grid AS (
    -- the actual side (baseline) and the plan side, full outer joined on product name x branch x cycle
    SELECT c.acc_year,
           coalesce(b.collector_id, p.collector_id)             AS collector_id,
           coalesce(b.actual_qty, 0)                             AS actual_qty,
           b.naive_qty, b.avg4_qty, b.avg4_nonzero_qty,
           nullif(p.plan_qty, 0) AS plan_qty, p.forecast_h1_qty, p.forecast_h2_qty
    FROM fact_forecast_baseline_name b
    FULL JOIN fact_plan_name_jc p ON p.name_key = b.name_key AND p.collector_id = b.collector_id AND p.jc_seq = b.jc_seq
    JOIN cycles c ON c.jc_seq = coalesce(b.jc_seq, p.jc_seq)
),
wide AS (
    -- one pass over the grid, every method's sums side by side; unpivoted below
    SELECT acc_year, collector_id,
           count(*)                                        AS rows_all,
           count(*) FILTER (WHERE actual_qty > 0)          AS rows_with_demand,
           sum(actual_qty)                                 AS actual_qty,
           -- naive
           count(*)                        FILTER (WHERE naive_qty > 0)  AS naive_rows_with_forecast,
           count(*)                        FILTER (WHERE actual_qty > 0 AND naive_qty > 0)    AS naive_rows_both,
           sum(naive_qty)                        FILTER (WHERE naive_qty > 0)  AS naive_forecast_qty,
           sum(actual_qty)                 FILTER (WHERE actual_qty > 0 AND naive_qty > 0)    AS naive_actual_both,
           sum(abs(actual_qty - naive_qty))      FILTER (WHERE actual_qty > 0 AND naive_qty > 0)    AS naive_abs_err_both,
           sum(naive_qty - actual_qty)           FILTER (WHERE actual_qty > 0 AND naive_qty > 0)    AS naive_err_both,
           sum(abs(actual_qty - coalesce(naive_qty, 0)))                  AS naive_abs_err_all,
           sum(coalesce(naive_qty, 0) - actual_qty)                       AS naive_err_all,
           -- avg4
           count(*)                        FILTER (WHERE avg4_qty > 0)  AS avg4_rows_with_forecast,
           count(*)                        FILTER (WHERE actual_qty > 0 AND avg4_qty > 0)    AS avg4_rows_both,
           sum(avg4_qty)                        FILTER (WHERE avg4_qty > 0)  AS avg4_forecast_qty,
           sum(actual_qty)                 FILTER (WHERE actual_qty > 0 AND avg4_qty > 0)    AS avg4_actual_both,
           sum(abs(actual_qty - avg4_qty))      FILTER (WHERE actual_qty > 0 AND avg4_qty > 0)    AS avg4_abs_err_both,
           sum(avg4_qty - actual_qty)           FILTER (WHERE actual_qty > 0 AND avg4_qty > 0)    AS avg4_err_both,
           sum(abs(actual_qty - coalesce(avg4_qty, 0)))                  AS avg4_abs_err_all,
           sum(coalesce(avg4_qty, 0) - actual_qty)                       AS avg4_err_all,
           -- avg4_nonzero
           count(*)                        FILTER (WHERE avg4_nonzero_qty > 0)  AS avg4_nonzero_rows_with_forecast,
           count(*)                        FILTER (WHERE actual_qty > 0 AND avg4_nonzero_qty > 0)    AS avg4_nonzero_rows_both,
           sum(avg4_nonzero_qty)                        FILTER (WHERE avg4_nonzero_qty > 0)  AS avg4_nonzero_forecast_qty,
           sum(actual_qty)                 FILTER (WHERE actual_qty > 0 AND avg4_nonzero_qty > 0)    AS avg4_nonzero_actual_both,
           sum(abs(actual_qty - avg4_nonzero_qty))      FILTER (WHERE actual_qty > 0 AND avg4_nonzero_qty > 0)    AS avg4_nonzero_abs_err_both,
           sum(avg4_nonzero_qty - actual_qty)           FILTER (WHERE actual_qty > 0 AND avg4_nonzero_qty > 0)    AS avg4_nonzero_err_both,
           sum(abs(actual_qty - coalesce(avg4_nonzero_qty, 0)))                  AS avg4_nonzero_abs_err_all,
           sum(coalesce(avg4_nonzero_qty, 0) - actual_qty)                       AS avg4_nonzero_err_all,
           -- plan
           count(*)                        FILTER (WHERE plan_qty > 0)  AS plan_rows_with_forecast,
           count(*)                        FILTER (WHERE actual_qty > 0 AND plan_qty > 0)    AS plan_rows_both,
           sum(plan_qty)                        FILTER (WHERE plan_qty > 0)  AS plan_forecast_qty,
           sum(actual_qty)                 FILTER (WHERE actual_qty > 0 AND plan_qty > 0)    AS plan_actual_both,
           sum(abs(actual_qty - plan_qty))      FILTER (WHERE actual_qty > 0 AND plan_qty > 0)    AS plan_abs_err_both,
           sum(plan_qty - actual_qty)           FILTER (WHERE actual_qty > 0 AND plan_qty > 0)    AS plan_err_both,
           sum(abs(actual_qty - coalesce(plan_qty, 0)))                  AS plan_abs_err_all,
           sum(coalesce(plan_qty, 0) - actual_qty)                       AS plan_err_all,
           -- forecast_h1
           count(*)                        FILTER (WHERE forecast_h1_qty > 0)  AS forecast_h1_rows_with_forecast,
           count(*)                        FILTER (WHERE actual_qty > 0 AND forecast_h1_qty > 0)    AS forecast_h1_rows_both,
           sum(forecast_h1_qty)                        FILTER (WHERE forecast_h1_qty > 0)  AS forecast_h1_forecast_qty,
           sum(actual_qty)                 FILTER (WHERE actual_qty > 0 AND forecast_h1_qty > 0)    AS forecast_h1_actual_both,
           sum(abs(actual_qty - forecast_h1_qty))      FILTER (WHERE actual_qty > 0 AND forecast_h1_qty > 0)    AS forecast_h1_abs_err_both,
           sum(forecast_h1_qty - actual_qty)           FILTER (WHERE actual_qty > 0 AND forecast_h1_qty > 0)    AS forecast_h1_err_both,
           sum(abs(actual_qty - coalesce(forecast_h1_qty, 0)))                  AS forecast_h1_abs_err_all,
           sum(coalesce(forecast_h1_qty, 0) - actual_qty)                       AS forecast_h1_err_all,
           -- forecast_h2
           count(*)                        FILTER (WHERE forecast_h2_qty > 0)  AS forecast_h2_rows_with_forecast,
           count(*)                        FILTER (WHERE actual_qty > 0 AND forecast_h2_qty > 0)    AS forecast_h2_rows_both,
           sum(forecast_h2_qty)                        FILTER (WHERE forecast_h2_qty > 0)  AS forecast_h2_forecast_qty,
           sum(actual_qty)                 FILTER (WHERE actual_qty > 0 AND forecast_h2_qty > 0)    AS forecast_h2_actual_both,
           sum(abs(actual_qty - forecast_h2_qty))      FILTER (WHERE actual_qty > 0 AND forecast_h2_qty > 0)    AS forecast_h2_abs_err_both,
           sum(forecast_h2_qty - actual_qty)           FILTER (WHERE actual_qty > 0 AND forecast_h2_qty > 0)    AS forecast_h2_err_both,
           sum(abs(actual_qty - coalesce(forecast_h2_qty, 0)))                  AS forecast_h2_abs_err_all,
           sum(coalesce(forecast_h2_qty, 0) - actual_qty)                       AS forecast_h2_err_all
    FROM grid
    GROUP BY GROUPING SETS ((acc_year), (acc_year, collector_id))
)
SELECT w.acc_year,
       w.collector_id,
       x.method,
       x.lead_time_cycles,
       w.rows_all,
       w.rows_with_demand,
       x.rows_with_forecast,
       x.rows_both,
       w.actual_qty,
       x.forecast_qty,
       round((100 * x.actual_both / nullif(w.actual_qty, 0))::numeric, 1)      AS coverage_pct,
       round((100 * x.abs_err_both / nullif(x.actual_both, 0))::numeric, 1)    AS wape_pct_where_both,
       round((100 * x.err_both / nullif(x.actual_both, 0))::numeric, 1)        AS bias_pct_where_both,
       round((100 * x.abs_err_all / nullif(w.actual_qty, 0))::numeric, 1)      AS wape_pct_all_rows,
       round((100 * x.err_all / nullif(w.actual_qty, 0))::numeric, 1)          AS bias_pct_all_rows
FROM wide w
CROSS JOIN LATERAL (VALUES
        ('naive', 13, naive_rows_with_forecast, naive_rows_both, naive_forecast_qty, naive_actual_both, naive_abs_err_both, naive_err_both, naive_abs_err_all, naive_err_all),
        ('avg4', 1, avg4_rows_with_forecast, avg4_rows_both, avg4_forecast_qty, avg4_actual_both, avg4_abs_err_both, avg4_err_both, avg4_abs_err_all, avg4_err_all),
        ('avg4_nonzero', 1, avg4_nonzero_rows_with_forecast, avg4_nonzero_rows_both, avg4_nonzero_forecast_qty, avg4_nonzero_actual_both, avg4_nonzero_abs_err_both, avg4_nonzero_err_both, avg4_nonzero_abs_err_all, avg4_nonzero_err_all),
        ('plan', 0.3, plan_rows_with_forecast, plan_rows_both, plan_forecast_qty, plan_actual_both, plan_abs_err_both, plan_err_both, plan_abs_err_all, plan_err_all),
        ('forecast_h1', 1.3, forecast_h1_rows_with_forecast, forecast_h1_rows_both, forecast_h1_forecast_qty, forecast_h1_actual_both, forecast_h1_abs_err_both, forecast_h1_err_both, forecast_h1_abs_err_all, forecast_h1_err_all),
        ('forecast_h2', 2.3, forecast_h2_rows_with_forecast, forecast_h2_rows_both, forecast_h2_forecast_qty, forecast_h2_actual_both, forecast_h2_abs_err_both, forecast_h2_err_both, forecast_h2_abs_err_all, forecast_h2_err_all)
) AS x (method, lead_time_cycles, rows_with_forecast, rows_both, forecast_qty, actual_both, abs_err_both, err_both, abs_err_all, err_all);

COMMENT ON VIEW v_forecast_accuracy IS 'The forecast scoreboard: per accounting year (collector_id empty = all branches) and per branch, one row per method - how much of the customer demand the method covered and how far off it was. Methods: naive (same cycle last year), avg4 and avg4_nonzero (previous four cycles), plan (the approved business plan), forecast_h1 / forecast_h2 (the planner''s forecast labelled one / two cycles ahead - entered one cycle before the label, so h1 is really a two-cycle-ahead forecast and works with older information than avg4). Actual = our customer demand at product name x branch x cycle grain, completed cycles from 2022-23. Two conventions: "where both exist" (rows with demand and a forecast; read with coverage_pct) and "all rows" (misses and phantom forecasts count in full). Lower WAPE is better; bias > 0 means over-forecast. lead_time_cycles says how far ahead each method had to commit, so the comparison is fair.';
COMMENT ON COLUMN v_forecast_accuracy.acc_year IS 'The accounting year scored.';
COMMENT ON COLUMN v_forecast_accuracy.collector_id IS 'The branch, or empty for all branches together. Joins dim_collector.';
COMMENT ON COLUMN v_forecast_accuracy.method IS 'naive / avg4 / avg4_nonzero / plan / forecast_h1 / forecast_h2.';
COMMENT ON COLUMN v_forecast_accuracy.lead_time_cycles IS 'How far ahead of the cycle the method has to commit, in cycles - how old its information is. naive 13 (the same cycle a year back), avg4 and avg4_nonzero 1 (the previous cycle), plan about 0.3 (entered in weeks 2-3 of the cycle before and handed over in week 4), forecast_h1 about 1.3 and forecast_h2 about 2.3. Compare two methods only with this in mind: the one that speaks later has the easier job.';
COMMENT ON COLUMN v_forecast_accuracy.rows_all IS 'Product name x branch x cycle rows scored (every pair with demand history or a plan).';
COMMENT ON COLUMN v_forecast_accuracy.rows_with_demand IS 'Rows with demand in the cycle.';
COMMENT ON COLUMN v_forecast_accuracy.rows_with_forecast IS 'Rows where the method gave a number above zero.';
COMMENT ON COLUMN v_forecast_accuracy.rows_both IS 'Rows with both demand and a forecast - the "where both exist" set.';
COMMENT ON COLUMN v_forecast_accuracy.actual_qty IS 'Total demand in the year, all rows.';
COMMENT ON COLUMN v_forecast_accuracy.forecast_qty IS 'Total forecast by the method, where it gave one.';
COMMENT ON COLUMN v_forecast_accuracy.coverage_pct IS 'Share of the demand that falls in rows where the method gave a forecast. The rest it missed entirely.';
COMMENT ON COLUMN v_forecast_accuracy.wape_pct_where_both IS 'sum(abs(actual - forecast)) / sum(actual) x 100 over rows with both. How good the method is on what it covers.';
COMMENT ON COLUMN v_forecast_accuracy.bias_pct_where_both IS 'sum(forecast - actual) / sum(actual) x 100 over rows with both. Positive = over-forecast.';
COMMENT ON COLUMN v_forecast_accuracy.wape_pct_all_rows IS 'The same over every row, a missing forecast counted as zero. One harsh number.';
COMMENT ON COLUMN v_forecast_accuracy.bias_pct_all_rows IS 'Bias over every row, a missing forecast counted as zero.';
