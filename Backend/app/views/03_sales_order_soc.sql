-- sales_order_soc views. run by app/repositories/views.py at api start, in file name order.
-- one statement per ';'. plain views are dropped and recreated every start.
--
-- what the crm team confirmed (sep 2026) and these views bake in:
--   Cogt        = a customer sale like Taxable: CCL's own manufactured textile chemicals, real demand, normal margins
--   BTS / HSS   = import pass-through (Bond Transfer Sales / High Seas Sales): invoiced revenue, tax free, never
--                 touches branch stock. about 40% of it goes to group entities
--   value       = quantity x unit_price, tax exclusive. total_sales_price is set once at entry, sometimes tax
--                 inclusive, sometimes stale, zero on a 2019 migration batch - never use it as the number
--   price = 0   = inter company (GROUP COMPANY branch, transfer price never reaches crm) or marketplace orders
--                 (the price lives in the marketplace feed). structural, never back filled
--   open        = SaleOrderDtls.status OPEN means "nobody closed it"; pending = crm's daily SocPendingDetails
--   scope       = order LINES and the open book are performance chemicals only (load filter). headers are complete.


-- ---------------------------------------------------------------------------------------------------------------
-- v_transaction_type: what each crm transaction type is. decided once, reused by order, dispatch and quote views.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_transaction_type CASCADE;

CREATE VIEW v_transaction_type AS
SELECT * FROM (VALUES
    ('TAXABLE - INTRA STATE',        'sale',                 true,  true),
    ('TAXABLE - INTER STATE',        'sale',                 true,  true),
    ('COGT - INTRA STATE',           'sale',                 true,  true),
    ('COGT - INTER STATE',           'sale',                 true,  true),
    ('COGT TAXABLE - INTRA STATE',   'sale',                 true,  true),
    ('EXPORT',                       'export sale',          true,  true),
    ('SEZ TO DTA',                   'export sale',          true,  true),
    ('SEZ TO SEZ',                   'export sale',          true,  true),
    ('BTS',                          'import pass-through',  true,  false),
    ('HSS',                          'import pass-through',  true,  false),
    ('HSS/BTS',                      'import pass-through',  true,  false),
    ('SAMPLE',                       'sample',               false, false),
    ('STOCK TRANSFER - INTRA STATE', 'stock transfer',       false, false),
    ('STOCK TRANSFER - INTER STATE', 'stock transfer',       false, false),
    ('JOB WORK',                     'job work',             false, false)
) AS t (transaction_type, order_kind, is_sale, is_demand);

COMMENT ON VIEW v_transaction_type IS 'What each crm transaction type means for reporting, decided once. Join on upper(trim(trans_type_name)). A type not in this list is "unknown" and counts as neither a sale nor demand.';
COMMENT ON COLUMN v_transaction_type.transaction_type IS 'The crm transaction type name, upper case.';
COMMENT ON COLUMN v_transaction_type.order_kind IS 'sale (Taxable and Cogt), export sale (Export, SEZ), import pass-through (BTS, HSS: sold before customs clearance), sample, stock transfer, job work.';
COMMENT ON COLUMN v_transaction_type.is_sale IS 'True when the line is invoiced customer revenue: sale, export sale, import pass-through. Samples, stock transfers and job work are not.';
COMMENT ON COLUMN v_transaction_type.is_demand IS 'True when the line is customer demand a planner should see: sale and export sale. Import pass-through never touches branch stock, so it is revenue but not demand.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_order_line: one row per order line (performance chemicals products), header flattened onto it.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_order_line CASCADE;

CREATE VIEW fact_order_line AS
SELECT d.line_id,
       d.header_id                                     AS order_id,
       CASE WHEN h.po_received_date::date BETWEEN DATE '2015-01-01' AND current_date + INTERVAL '1 year'
            THEN h.po_received_date::date ELSE h.creation_date::date END AS order_date,
       h.creation_date                                 AS order_created_at,
       h.customer_po_ref,
       h.customer_po_date,
       h.customer_id,
       h.bill_to_site_id                               AS bill_to_site_use_id,
       h.ship_to_site_id                               AS ship_to_site_use_id,
       h.collector_id,
       h.organization_id,
       h.currency,
       h.trading_manufacture,
       coalesce(h.is_back_to_back_order, false)        AS is_back_to_back,
       nullif(h.quotation_line_id, 0)                  AS quotation_hdr_id,
       h.quotation_number,
       nullif(d.quotationdtl_line_id, 0)               AS quotation_line_id,
       h.trans_type_name                               AS transaction_type,
       coalesce(t.order_kind, 'unknown')               AS order_kind,
       coalesce(t.is_sale, false)   AND NOT coalesce(c.isgroupcompanycollector, false) AS is_sale,
       coalesce(t.is_demand, false) AND NOT coalesce(c.isgroupcompanycollector, false) AS is_demand,
       coalesce(c.isgroupcompanycollector, false)      AS is_inter_company,
       upper(trim(h.trans_type_name)) LIKE 'COGT%'     AS is_cogt,
       d.item_id,
       CASE lower(trim(d.sale_category))
            WHEN 'e-commerce'      THEN 'E-Commerce'
            WHEN 'intact'          THEN 'Intact'
            WHEN 'repack'          THEN 'Repack'
            WHEN 'bulk'            THEN 'Bulk'
            WHEN 'customer barrel' THEN 'Customer Barrel'
            WHEN 'customer brl'    THEN 'Customer Barrel'
            WHEN 'small packing'   THEN 'Small Packing'
            ELSE initcap(trim(d.sale_category)) END    AS sale_category,
       lower(trim(d.sale_category)) = 'e-commerce'     AS is_ecommerce,
       CASE upper(trim(d.uom_code)) WHEN 'KGS' THEN 'KG' WHEN 'LITER' THEN 'L' WHEN 'LITRE' THEN 'L' ELSE upper(trim(d.uom_code)) END AS uom,
       d.quantity,
       d.unit_price,
       d.unit_price > 0                                AS has_price,
       CASE WHEN d.unit_price > 0 THEN d.quantity * d.unit_price END AS line_value,
       d.total_sales_price                             AS line_value_crm,
       d.delivery_from_id,
       d.inventory_org_id,
       d.delivery_date,
       CASE WHEN lower(trim(d.status)) = 'open' THEN 'OPEN' ELSE 'Closed' END AS status_crm,
       d.creation_date                                 AS line_created_at
FROM "SaleOrderDtls" d
JOIN "SaleOrderHdrs" h    ON h.header_id = d.header_id
LEFT JOIN "Collectors" c  ON c.collector_id = h.collector_id
LEFT JOIN v_transaction_type t ON t.transaction_type = upper(trim(h.trans_type_name));

COMMENT ON VIEW fact_order_line IS 'One row per order line for Performance Chemicals products, with the order header flattened onto it. Quantity is the measure; value is quantity x unit price (tax exclusive) and empty when the line has no price. is_sale / is_demand / is_inter_company say what the line is; status_crm only says whether someone closed it - the open book is fact_open_order.';
COMMENT ON COLUMN fact_order_line.line_id IS 'The order line id. Schedules, dispatches and cancellations point at it.';
COMMENT ON COLUMN fact_order_line.order_id IS 'The order (SaleOrderHdrs.header_id). The open book and dispatches carry it.';
COMMENT ON COLUMN fact_order_line.order_date IS 'The date the customer PO was received. A few orders carry junk years in crm; those fall back to the day the order was created.';
COMMENT ON COLUMN fact_order_line.order_created_at IS 'When the order was created in crm.';
COMMENT ON COLUMN fact_order_line.customer_po_ref IS 'The customer''s PO number.';
COMMENT ON COLUMN fact_order_line.customer_po_date IS 'The customer''s PO date.';
COMMENT ON COLUMN fact_order_line.customer_id IS 'The customer. Joins dim_customer.customer_id.';
COMMENT ON COLUMN fact_order_line.bill_to_site_use_id IS 'The billing site. Joins dim_customer_site. -1 = unknown.';
COMMENT ON COLUMN fact_order_line.ship_to_site_use_id IS 'The delivery site - the demand location. Joins dim_customer_site. -1 = unknown.';
COMMENT ON COLUMN fact_order_line.collector_id IS 'The branch that booked the order. Joins dim_collector. Usually the ship-to site''s branch.';
COMMENT ON COLUMN fact_order_line.organization_id IS 'The oracle operating unit (legal entity) the order belongs to. No name table loaded.';
COMMENT ON COLUMN fact_order_line.currency IS 'INR for almost all, USD / EUR on exports.';
COMMENT ON COLUMN fact_order_line.trading_manufacture IS 'Trading or Manufacturing as crm tags the order. Empty on older orders.';
COMMENT ON COLUMN fact_order_line.is_back_to_back IS 'The order triggers a purchase (back to back).';
COMMENT ON COLUMN fact_order_line.quotation_hdr_id IS 'The quotation the order came from (QuotationHdrs.header_id). Soft: only Performance Chemicals quotes from 2021 are loaded, so it does not always resolve.';
COMMENT ON COLUMN fact_order_line.quotation_number IS 'The quotation number as text.';
COMMENT ON COLUMN fact_order_line.quotation_line_id IS 'The quotation line the order line came from (QuotationDtls.line_id). Soft, same reason.';
COMMENT ON COLUMN fact_order_line.transaction_type IS 'crm''s transaction type name as is (Taxable - Intra State, Cogt - Intra State, Sample, Stock Transfer ...).';
COMMENT ON COLUMN fact_order_line.order_kind IS 'What the transaction type means: sale, export sale, import pass-through, sample, stock transfer, job work, unknown. See v_transaction_type.';
COMMENT ON COLUMN fact_order_line.is_sale IS 'Invoiced customer revenue: a sale, export sale or import pass-through, and not booked on the GROUP COMPANY branch. Use for sales reporting.';
COMMENT ON COLUMN fact_order_line.is_demand IS 'Customer demand a planner should count: a sale or export sale, not inter company. Import pass-through, samples, transfers and job work are out. Use for planning.';
COMMENT ON COLUMN fact_order_line.is_inter_company IS 'Booked on the GROUP COMPANY branch: a supply to a group entity. The quantity moves stock, the value is unknown to crm (price is 0), it is not customer demand.';
COMMENT ON COLUMN fact_order_line.is_cogt IS 'A Cogt transaction: CCL''s own manufactured textile chemicals sold to customers. A normal sale, flagged so entity level reports can land it under Color Chemicals & Dyes LLP.';
COMMENT ON COLUMN fact_order_line.item_id IS 'The product. Joins dim_item.';
COMMENT ON COLUMN fact_order_line.sale_category IS 'Intact / Repack / Bulk / E-Commerce / Customer Barrel / Small Packing. Spelling cleaned.';
COMMENT ON COLUMN fact_order_line.is_ecommerce IS 'A marketplace order (Amazon, Flipkart, Vooki ...). Usually unpriced in crm: the price lives in the marketplace feed.';
COMMENT ON COLUMN fact_order_line.uom IS 'Unit of measure, KG / EA / BOX / L ... (Kgs and KGS folded into KG, LITER into L).';
COMMENT ON COLUMN fact_order_line.quantity IS 'The ordered quantity in uom. The reliable measure.';
COMMENT ON COLUMN fact_order_line.unit_price IS 'Unit price, tax exclusive. Identical on the schedule and the dispatch. 0 on inter company and marketplace lines.';
COMMENT ON COLUMN fact_order_line.has_price IS 'True when the line has a price.';
COMMENT ON COLUMN fact_order_line.line_value IS 'quantity x unit_price, tax exclusive. Empty when there is no price - never 0 for an unpriced line.';
COMMENT ON COLUMN fact_order_line.line_value_crm IS 'crm''s own total_sales_price, for reference only: set once at entry, tax inclusive on some screens, not recomputed when the quantity changed, 0 on a 2019 migration batch.';
COMMENT ON COLUMN fact_order_line.delivery_from_id IS 'The delivery point (DeliveryFroms). -1 = unknown.';
COMMENT ON COLUMN fact_order_line.inventory_org_id IS 'The warehouse that serves the line. Joins InventoryOrgs. -1 = unknown.';
COMMENT ON COLUMN fact_order_line.delivery_date IS 'The promised delivery date. Empty on a tenth of the lines.';
COMMENT ON COLUMN fact_order_line.status_crm IS 'OPEN or Closed as crm has it. OPEN only means nobody closed the line, not that anything is pending - many delivered lines stay OPEN. The open book is fact_open_order.';
COMMENT ON COLUMN fact_order_line.line_created_at IS 'When the line was created in crm.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_open_order: crm's daily open order book (SocPendingDetails), resolved to ids. one row per open schedule line.
-- crm computes it: line OPEN and balance left after schedules and dispatches (bulk counts as done at 95%).
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_open_order CASCADE;

CREATE VIEW fact_open_order AS
SELECT p.id,
       p.order_no                                      AS order_id,
       p.order_date::date                              AS order_date,
       p.schedule_date::date                           AS schedule_date,
       p.customer_req_date::date                       AS customer_requested_date,
       p.reschedule_date::date                         AS reschedule_date,
       p.reschedule_reason,
       cm.header_id                                    AS customer_hdr_id,
       cm.customer_id,
       p.customer_number,
       p.collector_id,
       p.market_circle                                 AS mc_code,
       i.item_id,
       p.itemcode                                      AS item_code,
       p.category                                      AS sale_category,
       p.transaction_type,
       coalesce(t.order_kind, 'unknown')               AS order_kind,
       coalesce(t.is_sale, false)   AND NOT coalesce(c.isgroupcompanycollector, false) AS is_sale,
       coalesce(t.is_demand, false) AND NOT coalesce(c.isgroupcompanycollector, false) AS is_demand,
       coalesce(c.isgroupcompanycollector, false)      AS is_inter_company,
       CASE upper(trim(p.uom)) WHEN 'KGS' THEN 'KG' WHEN 'LITER' THEN 'L' WHEN 'LITRE' THEN 'L' ELSE upper(trim(p.uom)) END AS uom,
       p.total_quantity                                AS ordered_qty,
       p.scheduled_qty,
       p.despatched_qty                                AS dispatched_qty,
       p.balance_qty                                   AS pending_qty,
       p.unitprice                                     AS unit_price,
       p.unitprice > 0                                 AS has_price,
       CASE WHEN p.unitprice > 0 THEN p.balance_qty * p.unitprice END AS pending_value,
       p.dispatch_per                                  AS dispatch_pct,
       p.inventory_org_code,
       w.inventory_org_id,
       nullif(p.quotation_id, 0)                       AS quotation_hdr_id,
       p.syncdate                                      AS as_of
FROM "SocPendingDetails" p
LEFT JOIN "CustomerMasters" cm ON cm.customer_number = p.customer_number
LEFT JOIN "Collectors" c       ON c.collector_id = p.collector_id
LEFT JOIN v_transaction_type t ON t.transaction_type = upper(trim(p.transaction_type))
LEFT JOIN LATERAL (SELECT im.item_id FROM "ItemMasters" im WHERE im.item_code = p.itemcode ORDER BY im.item_id DESC LIMIT 1) i ON true
LEFT JOIN "InventoryOrgs" w    ON w.inventory_org_code = p.inventory_org_code;

COMMENT ON VIEW fact_open_order IS 'The open order book as crm computed it at the last sync: one row per open schedule line for Performance Chemicals products, with what was ordered, scheduled, dispatched and is still pending. This - not the status on the order line - is what "open" means. Reloaded every run; as_of says when crm computed it.';
COMMENT ON COLUMN fact_open_order.id IS 'Our own row id (the crm report has no key).';
COMMENT ON COLUMN fact_open_order.order_id IS 'The order (SaleOrderHdrs.header_id). Joins fact_order_line.order_id; there is no line id on this report, so match on order + product.';
COMMENT ON COLUMN fact_open_order.order_date IS 'The order date as the report carries it.';
COMMENT ON COLUMN fact_open_order.schedule_date IS 'The planned dispatch date.';
COMMENT ON COLUMN fact_open_order.customer_requested_date IS 'The date the customer asked for.';
COMMENT ON COLUMN fact_open_order.reschedule_date IS 'The new date when the schedule was moved.';
COMMENT ON COLUMN fact_open_order.reschedule_reason IS 'Why it was moved.';
COMMENT ON COLUMN fact_open_order.customer_hdr_id IS 'The customer (CustomerMasters.header_id), resolved from the account number. Joins dim_customer.customer_hdr_id.';
COMMENT ON COLUMN fact_open_order.customer_id IS 'The customer''s oracle id. Joins dim_customer.customer_id.';
COMMENT ON COLUMN fact_open_order.customer_number IS 'The oracle account number the report carries.';
COMMENT ON COLUMN fact_open_order.collector_id IS 'The branch. Joins dim_collector.';
COMMENT ON COLUMN fact_open_order.mc_code IS 'The sales circle. Joins dim_market_circle. "unknown" when the report had none.';
COMMENT ON COLUMN fact_open_order.item_id IS 'The product, resolved from the code. Joins dim_item.';
COMMENT ON COLUMN fact_open_order.item_code IS 'The product code the report carries.';
COMMENT ON COLUMN fact_open_order.sale_category IS 'Intact / Repack / Bulk / E-Commerce as the report carries it.';
COMMENT ON COLUMN fact_open_order.transaction_type IS 'crm''s transaction type name.';
COMMENT ON COLUMN fact_open_order.order_kind IS 'What the transaction type means. See v_transaction_type.';
COMMENT ON COLUMN fact_open_order.is_sale IS 'Customer revenue (sale, export sale, import pass-through) and not the GROUP COMPANY branch.';
COMMENT ON COLUMN fact_open_order.is_demand IS 'Customer demand a planner should count: sale or export sale, not inter company.';
COMMENT ON COLUMN fact_open_order.is_inter_company IS 'Booked on the GROUP COMPANY branch. A large part of the open book: real stock movement, no price.';
COMMENT ON COLUMN fact_open_order.uom IS 'Unit of measure (Kgs folded into KG).';
COMMENT ON COLUMN fact_open_order.ordered_qty IS 'Quantity on the order line.';
COMMENT ON COLUMN fact_open_order.scheduled_qty IS 'Quantity scheduled for dispatch.';
COMMENT ON COLUMN fact_open_order.dispatched_qty IS 'Quantity already dispatched.';
COMMENT ON COLUMN fact_open_order.pending_qty IS 'Quantity still to deliver. The number that matters.';
COMMENT ON COLUMN fact_open_order.unit_price IS 'Unit price, tax exclusive. 0 on inter company and marketplace lines.';
COMMENT ON COLUMN fact_open_order.has_price IS 'True when the line has a price.';
COMMENT ON COLUMN fact_open_order.pending_value IS 'pending_qty x unit_price. Empty when there is no price.';
COMMENT ON COLUMN fact_open_order.dispatch_pct IS 'crm''s dispatched percentage, filled for bulk General Chemicals lines only.';
COMMENT ON COLUMN fact_open_order.inventory_org_code IS 'The warehouse code the report carries.';
COMMENT ON COLUMN fact_open_order.inventory_org_id IS 'The warehouse, resolved from the code. Joins InventoryOrgs.';
COMMENT ON COLUMN fact_open_order.quotation_hdr_id IS 'The quotation the order came from. Soft link.';
COMMENT ON COLUMN fact_open_order.as_of IS 'When crm computed this open book.';
