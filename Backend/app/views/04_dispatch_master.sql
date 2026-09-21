-- dispatch_master views. run by app/repositories/views.py at api start, in file name order.
-- one statement per ';'. plain views are dropped and recreated every start; the materialized one is rebuilt too and
-- refreshed at the end of every etl run.
--
-- crm's own rules these views follow:
--   dispatched     = a dispatch note that is confirmed (despatch_confirm_flag = 'Y') and not cancelled (status 4 InvoiceCancel
--                    or oracle_status CANCELLED)                                                        - fn_SOCScheduleQty
--   open schedule  = balance = schedule_quantity - dispatched > 0, schedule not Reject / Closed / Cancelled, order line OPEN,
--                    effective date = reschedule date when set                                          - FnScheduleDtlPending,
--                    for demand: not GROUP COMPANY, no pending cancellation                             SpSyncSocPendingOrder_Forecasting
--   status codes   = DispatchStatus (1 Pending, 2 Confirmed, 3 MoveToOracle, 4 InvoiceCancel), ScheduleStatus (1 Pending,
--                    2 ReSchedule, 3 Reject, 4 Confirmed, 5 Closed, 6 SOCConfirmed, 7 Cancelled), ApprovalStatus for cancels
--                    (-1 Awaiting, 6 Approve, 7 Reject, 8 Referback ..). small and stable, inlined here
--   what a line is = order_kind / is_sale / is_demand / is_inter_company come from the order header via v_transaction_type


-- ---------------------------------------------------------------------------------------------------------------
-- fact_dispatch: one row per dispatched line (performance chemicals, 2021 on). the sales history.
-- materialized: it is the fact every plan-vs-actual, cover and trend view sums, and it joins six tables.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_dispatch CASCADE;

CREATE MATERIALIZED VIEW fact_dispatch AS
SELECT d.line_id,
       d.header_id                                     AS dispatch_id,
       d.schedule_date                                 AS dispatch_date,
       h.trx_date                                      AS invoice_date,
       nullif(trim(h.trx_number), '')                  AS invoice_number,
       h.despatch_confirm_date                         AS confirmed_at,
       CASE h.despatch_status_id WHEN 1 THEN 'Pending' WHEN 2 THEN 'Confirmed' WHEN 3 THEN 'MoveToOracle' WHEN 4 THEN 'InvoiceCancel' END AS dispatch_status,
       coalesce(h.despatch_confirm_flag = 'Y', false)  AS is_confirmed,
       h.despatch_status_id = 4 OR h.oracle_status = 'CANCELLED' AS is_cancelled,
       coalesce(h.despatch_confirm_flag = 'Y', false) AND NOT (h.despatch_status_id = 4 OR coalesce(h.oracle_status, '') = 'CANCELLED') AS counts_as_dispatched,
       h.customer_id,
       h.bill_to_customer_site_id                      AS bill_to_site_use_id,
       h.ship_to_customer_site_id                      AS ship_to_site_use_id,
       h.collector_id,
       coalesce(d.inventory_org_id, h.inventory_org_id) AS inventory_org_id,
       h.currency,
       d.sale_order_header_id                          AS order_id,
       d.sale_order_detail_line_id                     AS order_line_id,
       d.schedule_line_id,
       oh.trans_type_name                              AS transaction_type,
       coalesce(t.order_kind, 'unknown')               AS order_kind,
       coalesce(t.is_sale, false)   AND NOT coalesce(c.isgroupcompanycollector, false) AS is_sale,
       coalesce(t.is_demand, false) AND NOT coalesce(c.isgroupcompanycollector, false) AS is_demand,
       coalesce(c.isgroupcompanycollector, false)      AS is_inter_company,
       d.item_id,
       od.item_id                                      AS order_item_id,
       od.item_id IS NOT NULL AND od.item_id <> d.item_id AS is_substitution,
       CASE lower(trim(d.sale_category))
            WHEN 'e-commerce'      THEN 'E-Commerce'
            WHEN 'intact'          THEN 'Intact'
            WHEN 'repack'          THEN 'Repack'
            WHEN 'bulk'            THEN 'Bulk'
            WHEN 'customer barrel' THEN 'Customer Barrel'
            WHEN 'customer brl'    THEN 'Customer Barrel'
            WHEN 'small packing'   THEN 'Small Packing'
            ELSE initcap(trim(d.sale_category)) END    AS sale_category,
       d.trading_manufacture,
       CASE upper(trim(d.uom)) WHEN 'KGS' THEN 'KG' WHEN 'LITER' THEN 'L' WHEN 'LITRE' THEN 'L' ELSE upper(trim(d.uom)) END AS uom,
       d.sale_quantity                                 AS quantity,
       d.schedule_quantity                             AS scheduled_qty,
       d.unit_price,
       d.unit_price > 0                                AS has_price,
       CASE WHEN d.unit_price > 0 THEN d.total_value END AS line_value,
       d.tax_percentage,
       d.packing_cost,
       d.creation_date                                 AS created_at
FROM "DispatchDetails" d
LEFT JOIN "Dispatches" h        ON h.header_id = d.header_id
LEFT JOIN "Collectors" c        ON c.collector_id = h.collector_id
LEFT JOIN "SaleOrderHdrs" oh    ON oh.header_id = d.sale_order_header_id
LEFT JOIN "SaleOrderDtls" od    ON od.line_id = d.sale_order_detail_line_id
LEFT JOIN v_transaction_type t  ON t.transaction_type = upper(trim(oh.trans_type_name));

CREATE UNIQUE INDEX ix_fact_dispatch_line ON fact_dispatch (line_id);
CREATE INDEX ix_fact_dispatch_date ON fact_dispatch (dispatch_date);
CREATE INDEX ix_fact_dispatch_item ON fact_dispatch (item_id, dispatch_date);
CREATE INDEX ix_fact_dispatch_customer ON fact_dispatch (customer_id, dispatch_date);
CREATE INDEX ix_fact_dispatch_branch ON fact_dispatch (collector_id, dispatch_date);
CREATE INDEX ix_fact_dispatch_warehouse ON fact_dispatch (inventory_org_id, dispatch_date);
CREATE INDEX ix_fact_dispatch_order_line ON fact_dispatch (order_line_id);
CREATE INDEX ix_fact_dispatch_schedule ON fact_dispatch (schedule_line_id);

COMMENT ON MATERIALIZED VIEW fact_dispatch IS 'What actually shipped: one row per dispatched line for Performance Chemicals products since 2021, with the dispatch note, the order and the customer flattened onto it. The sales history every plan-vs-actual and stock-cover view sums. Filter on counts_as_dispatched for quantities that really left (confirmed, not cancelled) and on is_demand for customer demand.';
COMMENT ON COLUMN fact_dispatch.line_id IS 'The dispatched line id.';
COMMENT ON COLUMN fact_dispatch.dispatch_id IS 'The dispatch note (Dispatches.header_id). Several lines share one note. Empty on a handful of lines whose note is outside the loaded scope.';
COMMENT ON COLUMN fact_dispatch.dispatch_date IS 'The day the goods left. The date axis for sales history.';
COMMENT ON COLUMN fact_dispatch.invoice_date IS 'The oracle invoice date. Empty until the note is invoiced.';
COMMENT ON COLUMN fact_dispatch.invoice_number IS 'The oracle invoice number. Empty until invoiced.';
COMMENT ON COLUMN fact_dispatch.confirmed_at IS 'When the branch confirmed the dispatch.';
COMMENT ON COLUMN fact_dispatch.dispatch_status IS 'Pending / Confirmed / MoveToOracle (invoiced, almost all) / InvoiceCancel.';
COMMENT ON COLUMN fact_dispatch.is_confirmed IS 'The dispatch note carries confirm flag Y. crm counts only these as dispatched.';
COMMENT ON COLUMN fact_dispatch.is_cancelled IS 'The note was cancelled: status InvoiceCancel or oracle says CANCELLED (two different cases, no overlap).';
COMMENT ON COLUMN fact_dispatch.counts_as_dispatched IS 'Confirmed and not cancelled - the goods really left. crm''s own rule (fn_SOCScheduleQty). Use this for every quantity that means "shipped".';
COMMENT ON COLUMN fact_dispatch.customer_id IS 'The customer on the dispatch note. Joins dim_customer.';
COMMENT ON COLUMN fact_dispatch.bill_to_site_use_id IS 'The billing site. Joins dim_customer_site.';
COMMENT ON COLUMN fact_dispatch.ship_to_site_use_id IS 'The delivery site - where the goods went. Joins dim_customer_site.';
COMMENT ON COLUMN fact_dispatch.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_dispatch.inventory_org_id IS 'The warehouse the goods left from (the line''s, else the note''s). Joins InventoryOrgs.';
COMMENT ON COLUMN fact_dispatch.currency IS 'INR for almost all.';
COMMENT ON COLUMN fact_dispatch.order_id IS 'The order. Joins fact_order_line.order_id.';
COMMENT ON COLUMN fact_dispatch.order_line_id IS 'The order line the dispatch fulfils. Joins fact_order_line.line_id. Empty on a few lines whose order line is outside the loaded scope (a non PC product substituted by a PC one).';
COMMENT ON COLUMN fact_dispatch.schedule_line_id IS 'The schedule line it fulfils. Joins fact_schedule_line. Empty on a few hundred lines whose schedule is outside the loaded scope.';
COMMENT ON COLUMN fact_dispatch.transaction_type IS 'The order''s transaction type name.';
COMMENT ON COLUMN fact_dispatch.order_kind IS 'What the order is: sale, export sale, import pass-through, sample, stock transfer, job work, unknown. See v_transaction_type.';
COMMENT ON COLUMN fact_dispatch.is_sale IS 'Invoiced customer revenue and not the GROUP COMPANY branch. Use for sales reporting.';
COMMENT ON COLUMN fact_dispatch.is_demand IS 'Customer demand a planner should count (sale or export sale, not inter company). Use for planning.';
COMMENT ON COLUMN fact_dispatch.is_inter_company IS 'Dispatched on the GROUP COMPANY branch: a supply to a group entity. Real stock movement, unpriced, not customer demand.';
COMMENT ON COLUMN fact_dispatch.item_id IS 'The product that actually shipped. Joins dim_item. Differs from the ordered product on a few percent of lines (substitutions).';
COMMENT ON COLUMN fact_dispatch.order_item_id IS 'The product on the order line.';
COMMENT ON COLUMN fact_dispatch.is_substitution IS 'A different product shipped than was ordered.';
COMMENT ON COLUMN fact_dispatch.sale_category IS 'Intact / Repack / Bulk / E-Commerce / Customer Barrel. Spelling cleaned.';
COMMENT ON COLUMN fact_dispatch.trading_manufacture IS 'Trading or Manufacturing as crm tags the line.';
COMMENT ON COLUMN fact_dispatch.uom IS 'Unit of measure (Kgs / KGS folded into KG, LITER into L).';
COMMENT ON COLUMN fact_dispatch.quantity IS 'The quantity dispatched in uom. The measure.';
COMMENT ON COLUMN fact_dispatch.scheduled_qty IS 'The quantity that was scheduled for this dispatch (differs from quantity on some lines).';
COMMENT ON COLUMN fact_dispatch.unit_price IS 'Unit price, tax exclusive, identical to the order line''s. 0 on inter company and marketplace lines.';
COMMENT ON COLUMN fact_dispatch.has_price IS 'True when the line has a price.';
COMMENT ON COLUMN fact_dispatch.line_value IS 'Dispatched value = quantity x unit price, tax exclusive (crm''s total_value, which is reliable on this table). Empty when unpriced.';
COMMENT ON COLUMN fact_dispatch.tax_percentage IS 'GST percentage on the line.';
COMMENT ON COLUMN fact_dispatch.packing_cost IS 'Packing cost on the line.';
COMMENT ON COLUMN fact_dispatch.created_at IS 'When the line was created in crm.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_schedule_line: one row per schedule line (the planned dispatch of an order line), with what was dispatched
-- against it, the open balance by crm's rule, reschedules and the dates otif needs.
-- materialized: it sums every dispatch line per schedule, ~2 s per query as a plain view.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_schedule_line CASCADE;

CREATE MATERIALIZED VIEW fact_schedule_line AS
WITH shipped AS (
    SELECT schedule_line_id,
           sum(quantity) FILTER (WHERE counts_as_dispatched) AS dispatched_qty,
           min(dispatch_date) FILTER (WHERE counts_as_dispatched) AS first_dispatch_date,
           max(dispatch_date) FILTER (WHERE counts_as_dispatched) AS last_dispatch_date
    FROM fact_dispatch
    WHERE schedule_line_id IS NOT NULL
    GROUP BY schedule_line_id
),
cancels AS (
    SELECT sale_order_detail_line_id AS order_line_id,
           bool_or(status_id = 6)                              AS has_approved_cancellation,
           bool_or(status_id NOT IN (6, 7))                    AS has_pending_cancellation,
           sum(remaining_quantity) FILTER (WHERE status_id = 6) AS cancelled_qty
    FROM "SocCancelDetails"
    GROUP BY sale_order_detail_line_id
)
SELECT s.line_id                                       AS schedule_line_id,
       s.sale_order_header_id                          AS order_id,
       s.sale_order_detail_line_id                     AS order_line_id,
       s.schedule_date,
       s.reschedule_date,
       coalesce(s.reschedule_date, s.schedule_date)    AS effective_date,
       s.reschedule_date IS NOT NULL AND s.reschedule_date <> s.schedule_date AS is_rescheduled,
       CASE WHEN trim(s.reschedule_reason) IN ('', '0') OR s.reschedule_reason IS NULL OR trim(s.reschedule_reason) = chr(160)
            THEN NULL ELSE initcap(trim(s.reschedule_reason)) END AS reschedule_reason,
       s.customer_requested_date,
       CASE s.schedule_status_id WHEN 1 THEN 'Pending' WHEN 2 THEN 'ReSchedule' WHEN 3 THEN 'Reject' WHEN 4 THEN 'Confirmed'
                                 WHEN 5 THEN 'Closed' WHEN 6 THEN 'SOCConfirmed' WHEN 7 THEN 'Cancelled' END AS schedule_status,
       s.schedule_status_id,
       coalesce(s.confirm_status_id = 1, false)        AS is_confirmed,
       s.customer_id,
       s.bill_to_customer_site_id                      AS bill_to_site_use_id,
       s.ship_to_customer_site_id                      AS ship_to_site_use_id,
       oh.collector_id,
       s.inventory_org_id,
       s.item_id,
       coalesce(t.order_kind, 'unknown')               AS order_kind,
       coalesce(t.is_demand, false) AND NOT coalesce(c.isgroupcompanycollector, false) AS is_demand,
       coalesce(c.isgroupcompanycollector, false)      AS is_inter_company,
       CASE lower(trim(s.sale_category))
            WHEN 'e-commerce'      THEN 'E-Commerce'
            WHEN 'intact'          THEN 'Intact'
            WHEN 'repack'          THEN 'Repack'
            WHEN 'bulk'            THEN 'Bulk'
            WHEN 'customer barrel' THEN 'Customer Barrel'
            WHEN 'customer brl'    THEN 'Customer Barrel'
            ELSE initcap(trim(s.sale_category)) END    AS sale_category,
       s.schedule_quantity                             AS scheduled_qty,
       coalesce(sh.dispatched_qty, 0)                  AS dispatched_qty,
       greatest(s.schedule_quantity - coalesce(sh.dispatched_qty, 0), 0) AS balance_qty,
       s.unit_price,
       s.unit_price > 0                                AS has_price,
       CASE WHEN s.unit_price > 0 THEN greatest(s.schedule_quantity - coalesce(sh.dispatched_qty, 0), 0) * s.unit_price END AS balance_value,
       lower(trim(od.status)) = 'open'
         AND s.schedule_status_id NOT IN (3, 5, 7)
         AND s.schedule_quantity - coalesce(sh.dispatched_qty, 0) > 0 AS is_open,
       coalesce(cx.has_approved_cancellation, false)   AS has_approved_cancellation,
       coalesce(cx.has_pending_cancellation, false)    AS has_pending_cancellation,
       cx.cancelled_qty,
       sh.first_dispatch_date,
       sh.last_dispatch_date,
       sh.first_dispatch_date - s.customer_requested_date AS days_vs_requested,
       sh.first_dispatch_date - coalesce(s.reschedule_date, s.schedule_date) AS days_vs_scheduled,
       s.creation_date                                 AS created_at,
       s.last_update_date                              AS updated_at
FROM "Schedules" s
LEFT JOIN "SaleOrderDtls" od    ON od.line_id = s.sale_order_detail_line_id
LEFT JOIN "SaleOrderHdrs" oh    ON oh.header_id = s.sale_order_header_id
LEFT JOIN "Collectors" c        ON c.collector_id = oh.collector_id
LEFT JOIN v_transaction_type t  ON t.transaction_type = upper(trim(oh.trans_type_name))
LEFT JOIN shipped sh            ON sh.schedule_line_id = s.line_id
LEFT JOIN cancels cx            ON cx.order_line_id = s.sale_order_detail_line_id;

CREATE UNIQUE INDEX ix_fact_schedule_line_id ON fact_schedule_line (schedule_line_id);
CREATE INDEX ix_fact_schedule_line_order_line ON fact_schedule_line (order_line_id);
CREATE INDEX ix_fact_schedule_line_open ON fact_schedule_line (is_open, is_demand);
CREATE INDEX ix_fact_schedule_line_item ON fact_schedule_line (item_id, effective_date);
CREATE INDEX ix_fact_schedule_line_branch ON fact_schedule_line (collector_id, effective_date);
CREATE INDEX ix_fact_schedule_line_customer ON fact_schedule_line (customer_id);

COMMENT ON MATERIALIZED VIEW fact_schedule_line IS 'The planned dispatch of each order line and what happened to it: scheduled vs dispatched quantity, the open balance (crm''s rule: line OPEN, schedule not rejected / closed / cancelled, balance left), reschedules with their reason, cancellations, and the dates for on-time delivery. One row per schedule line, Performance Chemicals products since 2021.';
COMMENT ON COLUMN fact_schedule_line.schedule_line_id IS 'The schedule line id. fact_dispatch.schedule_line_id points here.';
COMMENT ON COLUMN fact_schedule_line.order_id IS 'The order. Joins fact_order_line.order_id.';
COMMENT ON COLUMN fact_schedule_line.order_line_id IS 'The order line. Joins fact_order_line.line_id. About one schedule per line, a few lines have several.';
COMMENT ON COLUMN fact_schedule_line.schedule_date IS 'The planned dispatch date as first set.';
COMMENT ON COLUMN fact_schedule_line.reschedule_date IS 'The date it was moved to. crm fills it on every row, equal to schedule_date when never moved.';
COMMENT ON COLUMN fact_schedule_line.effective_date IS 'The date that counts: the reschedule date when there is one, else the schedule date. crm''s open book uses this.';
COMMENT ON COLUMN fact_schedule_line.is_rescheduled IS 'True when the date was actually moved.';
COMMENT ON COLUMN fact_schedule_line.reschedule_reason IS 'Why it was moved: Customer Requested, Stock Not Available, Logistics Issue ... Empty when never moved (crm''s 0 and blank cleaned away).';
COMMENT ON COLUMN fact_schedule_line.customer_requested_date IS 'The date the customer asked for. The on-time reference.';
COMMENT ON COLUMN fact_schedule_line.schedule_status IS 'Pending / ReSchedule / Reject / Confirmed / Closed / SOCConfirmed / Cancelled. Not an open flag: most lines sit at SOCConfirmed after dispatch. Use is_open.';
COMMENT ON COLUMN fact_schedule_line.schedule_status_id IS 'The status code behind schedule_status.';
COMMENT ON COLUMN fact_schedule_line.is_confirmed IS 'The schedule line is confirmed (confirm_status_id = 1).';
COMMENT ON COLUMN fact_schedule_line.customer_id IS 'The customer. Joins dim_customer.';
COMMENT ON COLUMN fact_schedule_line.bill_to_site_use_id IS 'The billing site. Joins dim_customer_site.';
COMMENT ON COLUMN fact_schedule_line.ship_to_site_use_id IS 'The delivery site. Joins dim_customer_site.';
COMMENT ON COLUMN fact_schedule_line.collector_id IS 'The branch that booked the order. Joins dim_collector.';
COMMENT ON COLUMN fact_schedule_line.inventory_org_id IS 'The warehouse planned to ship. Joins InventoryOrgs.';
COMMENT ON COLUMN fact_schedule_line.item_id IS 'The product. Joins dim_item.';
COMMENT ON COLUMN fact_schedule_line.order_kind IS 'What the order is. See v_transaction_type.';
COMMENT ON COLUMN fact_schedule_line.is_demand IS 'Customer demand a planner should count: sale or export sale, not inter company.';
COMMENT ON COLUMN fact_schedule_line.is_inter_company IS 'Booked on the GROUP COMPANY branch.';
COMMENT ON COLUMN fact_schedule_line.sale_category IS 'Intact / Repack / Bulk / E-Commerce / Customer Barrel. Spelling cleaned.';
COMMENT ON COLUMN fact_schedule_line.scheduled_qty IS 'The quantity scheduled.';
COMMENT ON COLUMN fact_schedule_line.dispatched_qty IS 'What really left against this schedule: confirmed, non cancelled dispatch lines only (crm''s rule).';
COMMENT ON COLUMN fact_schedule_line.balance_qty IS 'scheduled_qty minus dispatched_qty, never below 0. The open quantity when is_open.';
COMMENT ON COLUMN fact_schedule_line.unit_price IS 'Unit price, tax exclusive, from the schedule.';
COMMENT ON COLUMN fact_schedule_line.has_price IS 'True when there is a price.';
COMMENT ON COLUMN fact_schedule_line.balance_value IS 'balance_qty x unit_price. Empty when unpriced.';
COMMENT ON COLUMN fact_schedule_line.is_open IS 'crm''s open rule: the order line is OPEN, the schedule is not Reject / Closed / Cancelled, and there is a balance left. For open demand add is_demand and not has_pending_cancellation - that is what crm feeds its forecasting with.';
COMMENT ON COLUMN fact_schedule_line.has_approved_cancellation IS 'An approved cancellation exists on the order line: the cancelled_qty will never ship.';
COMMENT ON COLUMN fact_schedule_line.has_pending_cancellation IS 'A cancellation request is awaiting approval on the order line. crm keeps such lines out of open demand.';
COMMENT ON COLUMN fact_schedule_line.cancelled_qty IS 'Quantity taken out by approved cancellations on the order line.';
COMMENT ON COLUMN fact_schedule_line.first_dispatch_date IS 'When the first confirmed dispatch against this schedule left. Empty if nothing has.';
COMMENT ON COLUMN fact_schedule_line.last_dispatch_date IS 'When the last one left.';
COMMENT ON COLUMN fact_schedule_line.days_vs_requested IS 'First dispatch minus the customer requested date, in days. Positive = late, 0 or negative = on time. Empty until something ships.';
COMMENT ON COLUMN fact_schedule_line.days_vs_scheduled IS 'First dispatch minus the effective schedule date, in days.';
COMMENT ON COLUMN fact_schedule_line.created_at IS 'When the schedule was created in crm.';
COMMENT ON COLUMN fact_schedule_line.updated_at IS 'When it was last changed in crm.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_order_cancellation: one row per cancellation request on an order line, with its approval state and reason.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_order_cancellation CASCADE;

CREATE VIEW fact_order_cancellation AS
SELECT x.header_id                                     AS cancellation_id,
       x.sale_order_header_id                          AS order_id,
       x.sale_order_detail_line_id                     AS order_line_id,
       nullif(x.schedule_line_id, 0)                   AS schedule_line_id,
       x.creation_date::date                           AS requested_date,
       x.approved_action_date::date                    AS decided_date,
       CASE x.status_id WHEN 6 THEN 'Approved' WHEN 7 THEN 'Rejected' WHEN 8 THEN 'Referred back' WHEN -1 THEN 'Awaiting'
                        WHEN 0 THEN 'Draft' WHEN -2 THEN 'Awaiting' ELSE 'Other' END AS approval_status,
       x.status_id = 6                                 AS is_approved,
       x.status_id NOT IN (6, 7)                       AS is_pending,
       r.name                                          AS reason,
       x.comment,
       x.customer_id,
       x.item_id,
       x.inventory_org_id,
       oh.collector_id,
       CASE lower(trim(x.sale_category))
            WHEN 'e-commerce' THEN 'E-Commerce' WHEN 'intact' THEN 'Intact' WHEN 'repack' THEN 'Repack' WHEN 'bulk' THEN 'Bulk'
            WHEN 'customer barrel' THEN 'Customer Barrel' WHEN 'customer brl' THEN 'Customer Barrel'
            ELSE initcap(trim(x.sale_category)) END    AS sale_category,
       x.schedule_date,
       x.schedule_quantity                             AS scheduled_qty,
       x.shipped_quantity                              AS shipped_qty,
       x.remaining_quantity                            AS remaining_qty
FROM "SocCancelDetails" x
LEFT JOIN "Reasons" r          ON r.header_id = x.close_reason_id
LEFT JOIN "SaleOrderHdrs" oh   ON oh.header_id = x.sale_order_header_id;

COMMENT ON VIEW fact_order_cancellation IS 'Requests to cancel or close an order line: who asked to drop what, why, and whether it was approved. An approved request means the remaining quantity will never ship; a pending one keeps the line out of open demand. Performance Chemicals products since 2021.';
COMMENT ON COLUMN fact_order_cancellation.cancellation_id IS 'The request id.';
COMMENT ON COLUMN fact_order_cancellation.order_id IS 'The order. Joins fact_order_line.order_id.';
COMMENT ON COLUMN fact_order_cancellation.order_line_id IS 'The order line being cancelled. Joins fact_order_line.line_id.';
COMMENT ON COLUMN fact_order_cancellation.schedule_line_id IS 'The schedule line, when crm kept it (the schedule is often deleted after the cancel). Soft link.';
COMMENT ON COLUMN fact_order_cancellation.requested_date IS 'When the request was raised.';
COMMENT ON COLUMN fact_order_cancellation.decided_date IS 'When it was approved or rejected.';
COMMENT ON COLUMN fact_order_cancellation.approval_status IS 'Approved / Rejected / Referred back / Awaiting / Draft. Most are approved.';
COMMENT ON COLUMN fact_order_cancellation.is_approved IS 'The cancellation went through.';
COMMENT ON COLUMN fact_order_cancellation.is_pending IS 'Not yet approved or rejected.';
COMMENT ON COLUMN fact_order_cancellation.reason IS 'Why: Incorrect SOC Details, Duplicate SOC, Order Lost, Partial Quantity, Amended / Revised PO ... (from crm''s Reasons list).';
COMMENT ON COLUMN fact_order_cancellation.comment IS 'Free text on the request.';
COMMENT ON COLUMN fact_order_cancellation.customer_id IS 'The customer. Joins dim_customer.';
COMMENT ON COLUMN fact_order_cancellation.item_id IS 'The product. Joins dim_item.';
COMMENT ON COLUMN fact_order_cancellation.inventory_org_id IS 'The warehouse. Joins InventoryOrgs.';
COMMENT ON COLUMN fact_order_cancellation.collector_id IS 'The branch that booked the order. Joins dim_collector.';
COMMENT ON COLUMN fact_order_cancellation.sale_category IS 'Intact / Repack / Bulk ... Spelling cleaned.';
COMMENT ON COLUMN fact_order_cancellation.schedule_date IS 'The schedule date that was cancelled.';
COMMENT ON COLUMN fact_order_cancellation.scheduled_qty IS 'Quantity that had been scheduled.';
COMMENT ON COLUMN fact_order_cancellation.shipped_qty IS 'Quantity already shipped before the cancel.';
COMMENT ON COLUMN fact_order_cancellation.remaining_qty IS 'Quantity being cancelled: the part that will never ship once approved.';
