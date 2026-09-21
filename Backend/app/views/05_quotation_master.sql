-- quotation_master views. run by app/repositories/views.py at api start, in file name order.
-- one statement per ';'. the materialized view is rebuilt at start and refreshed at the end of every etl run.
--
-- what the data says:
--   a quote here is a pre-order, not a sales pipeline: almost every quote is Closed, and a Closed quote is one that
--   became an order (an order points at it). there is no "lost" status - a quote that never converted stays
--   Confirmed or Approved. the header status is the state of the quote; the line status stays Confirmed after
--   conversion and only matters inside a live quote.
-- crm's rule for the open pipeline (FN_PCProjection_GetConfirmedQuotationQuantity, the PC Projection module):
--   quote Confirmed and line Confirmed and no order exists for the quote -> is_open_pipeline.
-- what a quote is (sale / sample / transfer / inter company) comes from v_transaction_type, like orders and dispatches.


-- ---------------------------------------------------------------------------------------------------------------
-- fact_quote_line: one row per quotation line (performance chemicals, 2021 on), header flattened, conversion resolved.
-- materialized: the conversion columns look up the order line for every quote line.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_quote_line CASCADE;

CREATE MATERIALIZED VIEW fact_quote_line AS
WITH converted AS (
    SELECT quotationdtl_line_id AS quote_line_id,
           min(line_id)         AS order_line_id,
           min(header_id)       AS order_id,
           min(creation_date)   AS first_order_at,
           count(*)             AS order_line_count
    FROM "SaleOrderDtls"
    WHERE quotationdtl_line_id > 0
    GROUP BY quotationdtl_line_id
)
SELECT d.line_id,
       d.header_id                                     AS quote_id,
       h.quotation_number                              AS quote_number,
       coalesce(h.quotation_date, h.creation_date)::date AS quote_date,
       h.creation_date                                 AS quote_created_at,
       h.last_update_date                              AS quote_updated_at,
       coalesce(h.revised_count, 0)                    AS revised_count,
       coalesce(h.is_prequote, false)                  AS is_prequote,
       coalesce(h.is_back_to_back_order, false)        AS is_back_to_back,
       h.quote_creation_type,
       h.customer_id,
       h.bill_to_site_id                               AS bill_to_site_use_id,
       h.ship_to_site_id                               AS ship_to_site_use_id,
       h.collector_id,
       h.mc_code,
       h.company_id                                    AS organization_id,
       h.currency_type                                 AS currency,
       h.trans_type_name                               AS transaction_type,
       coalesce(t.order_kind, 'unknown')               AS order_kind,
       coalesce(t.is_sale, false)   AND NOT coalesce(c.isgroupcompanycollector, false) AS is_sale,
       coalesce(t.is_demand, false) AND NOT coalesce(c.isgroupcompanycollector, false) AS is_demand,
       coalesce(c.isgroupcompanycollector, false)      AS is_inter_company,
       upper(trim(h.trans_type_name)) LIKE 'COGT%'     AS is_cogt,
       hs.name                                         AS quote_status,
       h.status_id                                     AS quote_status_id,
       coalesce(h.close_status_id, 0) = 1              AS is_close_initiated,
       ls.name                                         AS line_status,
       d.status_id                                     AS line_status_id,
       h.status_id NOT IN (4, 7, 8)                    AS is_live,
       h.status_id = 6 AND d.status_id = 6 AND cv.order_line_id IS NULL AND NOT EXISTS
           (SELECT 1 FROM "SaleOrderHdrs" o WHERE o.quotation_line_id = h.header_id) AS is_open_pipeline,
       cv.order_line_id IS NOT NULL                    AS is_converted,
       cv.order_id,
       cv.order_line_id,
       cv.order_line_count,
       (cv.first_order_at::date - coalesce(h.quotation_date, h.creation_date)::date) AS days_to_convert,
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
       CASE upper(trim(d.uom_code)) WHEN 'KGS' THEN 'KG' WHEN 'LITER' THEN 'L' WHEN 'LITRE' THEN 'L' ELSE upper(trim(d.uom_code)) END AS uom,
       d.quantity,
       d.unit_price,
       d.unit_price > 0                                AS has_price,
       CASE WHEN d.unit_price > 0 THEN d.quantity * d.unit_price END AS line_value,
       d.total_sales_price                             AS line_value_crm,
       d.discount_percentage                           AS discount_pct,
       d.discount_value,
       d.tax_percentage                                AS tax_pct,
       d.delivery_date::date                           AS delivery_date,
       d.delivery_from_id,
       d.inventory_org_id,
       d.creation_date                                 AS line_created_at
FROM "QuotationDtls" d
JOIN "QuotationHdrs" h            ON h.header_id = d.header_id
LEFT JOIN "QuotationStatus" hs    ON hs.line_id = h.status_id
LEFT JOIN "QuotationStatus" ls    ON ls.line_id = d.status_id
LEFT JOIN "Collectors" c          ON c.collector_id = h.collector_id
LEFT JOIN v_transaction_type t    ON t.transaction_type = upper(trim(h.trans_type_name))
LEFT JOIN converted cv            ON cv.quote_line_id = d.line_id;

CREATE UNIQUE INDEX ix_fact_quote_line_id ON fact_quote_line (line_id);
CREATE INDEX ix_fact_quote_line_quote ON fact_quote_line (quote_id);
CREATE INDEX ix_fact_quote_line_date ON fact_quote_line (quote_date);
CREATE INDEX ix_fact_quote_line_item ON fact_quote_line (item_id, quote_date);
CREATE INDEX ix_fact_quote_line_customer ON fact_quote_line (customer_id, quote_date);
CREATE INDEX ix_fact_quote_line_branch ON fact_quote_line (collector_id, quote_date);
CREATE INDEX ix_fact_quote_line_pipeline ON fact_quote_line (is_open_pipeline) WHERE is_open_pipeline;
CREATE INDEX ix_fact_quote_line_order_line ON fact_quote_line (order_line_id);

COMMENT ON MATERIALIZED VIEW fact_quote_line IS 'Every quotation line for Performance Chemicals products since 2021, with the quote header flattened onto it and its conversion to an order resolved. A quote here is a pre-order: almost all are Closed, and Closed means it became an order. is_open_pipeline marks what crm''s projection counts as open quotes (confirmed, not yet ordered); is_converted and order_line_id link to the order it became.';
COMMENT ON COLUMN fact_quote_line.line_id IS 'The quotation line id. SaleOrderDtls.quotationdtl_line_id points here.';
COMMENT ON COLUMN fact_quote_line.quote_id IS 'The quotation (QuotationHdrs.header_id). SaleOrderHdrs.quotation_line_id points here.';
COMMENT ON COLUMN fact_quote_line.quote_number IS 'The quotation number as shown in crm.';
COMMENT ON COLUMN fact_quote_line.quote_date IS 'The quotation date (the creation day for the few without one).';
COMMENT ON COLUMN fact_quote_line.quote_created_at IS 'When the quote was created in crm.';
COMMENT ON COLUMN fact_quote_line.quote_updated_at IS 'When the quote was last changed in crm.';
COMMENT ON COLUMN fact_quote_line.revised_count IS 'How many times the quote was revised.';
COMMENT ON COLUMN fact_quote_line.is_prequote IS 'A pre-quote (draft before the real quote).';
COMMENT ON COLUMN fact_quote_line.is_back_to_back IS 'The quote is for a back-to-back deal (a purchase is raised against the order).';
COMMENT ON COLUMN fact_quote_line.quote_creation_type IS 'How the quote was created, as crm tags it.';
COMMENT ON COLUMN fact_quote_line.customer_id IS 'The customer. Joins dim_customer. -1 = unknown.';
COMMENT ON COLUMN fact_quote_line.bill_to_site_use_id IS 'The billing site. Joins dim_customer_site. -1 = unknown.';
COMMENT ON COLUMN fact_quote_line.ship_to_site_use_id IS 'The delivery site. Joins dim_customer_site. -1 = unknown.';
COMMENT ON COLUMN fact_quote_line.collector_id IS 'The branch that quoted. Joins dim_collector.';
COMMENT ON COLUMN fact_quote_line.mc_code IS 'The sales circle on the quote. Joins dim_market_circle. "unknown" on many group company quotes.';
COMMENT ON COLUMN fact_quote_line.organization_id IS 'The oracle operating unit (legal entity). No name table loaded.';
COMMENT ON COLUMN fact_quote_line.currency IS 'INR for almost all.';
COMMENT ON COLUMN fact_quote_line.transaction_type IS 'crm''s transaction type name (Taxable - Intra State, Cogt, Sample, Stock Transfer ...).';
COMMENT ON COLUMN fact_quote_line.order_kind IS 'What the quote is: sale, export sale, import pass-through, sample, stock transfer, job work, unknown. See v_transaction_type.';
COMMENT ON COLUMN fact_quote_line.is_sale IS 'A sale, export sale or import pass-through, and not the GROUP COMPANY branch.';
COMMENT ON COLUMN fact_quote_line.is_demand IS 'Customer demand a planner should count: sale or export sale, not inter company.';
COMMENT ON COLUMN fact_quote_line.is_inter_company IS 'Quoted on the GROUP COMPANY branch: a supply to a group entity, unpriced.';
COMMENT ON COLUMN fact_quote_line.is_cogt IS 'A Cogt transaction (CCL''s own manufactured textile chemicals).';
COMMENT ON COLUMN fact_quote_line.quote_status IS 'The state of the quote: Open / WaitingForApproval / Approved / Rejected / ReferredBack / Confirmed / Closed / Pending ... Closed = converted to an order.';
COMMENT ON COLUMN fact_quote_line.quote_status_id IS 'The code behind quote_status (QuotationStatus.line_id).';
COMMENT ON COLUMN fact_quote_line.is_close_initiated IS 'Someone has initiated closing the quote (crm''s close_status_id = 1).';
COMMENT ON COLUMN fact_quote_line.line_status IS 'The line''s own status. Stays Confirmed after the quote converts, so it only says something inside a live quote (an Open or Rejected line).';
COMMENT ON COLUMN fact_quote_line.line_status_id IS 'The code behind line_status.';
COMMENT ON COLUMN fact_quote_line.is_live IS 'The quote is still in play: not Closed, Rejected or Cancelled.';
COMMENT ON COLUMN fact_quote_line.is_open_pipeline IS 'crm''s projection rule: the quote and the line are Confirmed and no order has been raised on the quote. The open quotation quantity a planner adds to open orders.';
COMMENT ON COLUMN fact_quote_line.is_converted IS 'An order line was raised from this quote line.';
COMMENT ON COLUMN fact_quote_line.order_id IS 'The order raised from it. Joins fact_order_line.order_id.';
COMMENT ON COLUMN fact_quote_line.order_line_id IS 'The order line raised from it. Joins fact_order_line.line_id. The first one when several were.';
COMMENT ON COLUMN fact_quote_line.order_line_count IS 'How many order lines point at this quote line (a quote line can be ordered more than once).';
COMMENT ON COLUMN fact_quote_line.days_to_convert IS 'Days from the quote date to the first order. Empty when not converted.';
COMMENT ON COLUMN fact_quote_line.item_id IS 'The product. Joins dim_item.';
COMMENT ON COLUMN fact_quote_line.sale_category IS 'Intact / Repack / Bulk / E-Commerce / Customer Barrel. Spelling cleaned.';
COMMENT ON COLUMN fact_quote_line.uom IS 'Unit of measure (Kgs / KGS folded into KG, LITER into L). Empty on some lines.';
COMMENT ON COLUMN fact_quote_line.quantity IS 'The quoted quantity in uom.';
COMMENT ON COLUMN fact_quote_line.unit_price IS 'Quoted unit price, tax exclusive. 0 on inter company and marketplace lines.';
COMMENT ON COLUMN fact_quote_line.has_price IS 'True when the line has a price.';
COMMENT ON COLUMN fact_quote_line.line_value IS 'quantity x unit_price, tax exclusive. Empty when unpriced.';
COMMENT ON COLUMN fact_quote_line.line_value_crm IS 'crm''s own total_sales_price, for reference only (same caveats as on orders).';
COMMENT ON COLUMN fact_quote_line.discount_pct IS 'Discount percentage on the line.';
COMMENT ON COLUMN fact_quote_line.discount_value IS 'Discount amount on the line.';
COMMENT ON COLUMN fact_quote_line.tax_pct IS 'GST percentage on the line.';
COMMENT ON COLUMN fact_quote_line.delivery_date IS 'The delivery date quoted.';
COMMENT ON COLUMN fact_quote_line.delivery_from_id IS 'The delivery point (DeliveryFroms). -1 = unknown.';
COMMENT ON COLUMN fact_quote_line.inventory_org_id IS 'The warehouse quoted to serve it. Joins InventoryOrgs. -1 = unknown.';
COMMENT ON COLUMN fact_quote_line.line_created_at IS 'When the line was created in crm.';
