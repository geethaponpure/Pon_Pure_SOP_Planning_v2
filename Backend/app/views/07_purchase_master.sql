-- purchase_master views: the supply side. what we asked for, what we ordered, what actually turned up, and how long it took.
-- run by app/repositories/views.py at api start, in file name order. one statement per ';'.
--
-- what shapes this file (measured sep 2026):
--   no natural key on receipts   BiGrnDetails is rebuilt nightly and its header_id restarts from 1. we load it with
--                                our own id. a receipt line can be split across rows, so always SUM, never count rows.
--   receipt_date lies on transfers  on an INTERNAL ORDER row crm writes the DESPATCH date, not the arrival. measured:
--                                116,589 of 150,558 receipts fall on the sending warehouse's own despatch day.
--                                we turn that into an asset - it gives us the start of every transfer for free.
--   arrival comes from lot numbers  a lot shipped from one warehouse shows up in BiStockDetail at the receiving one
--                                when it lands. 87% of internal receipts find their lot. that difference is transit.
--                                crm cannot give us this (asked sep 2026, declined), and it needs nothing from them.
--   what we still cannot see     when the branch originally asked. crm's REQUISITION_Date on the dispatch is raised
--                                at shipping time (44,467 of 56,368 requisitions are same-day), so it is not the ask.


-- ---------------------------------------------------------------------------------------------------------------
-- dim_warehouse: the places stock sits. every fact in this file and the stock cluster points here.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_warehouse CASCADE;

CREATE VIEW dim_warehouse AS
SELECT w.inventory_org_id                              AS warehouse_id,
       w.inventory_org_code                            AS warehouse_code,
       w.inventory_org_name                            AS warehouse_name,
       w.city,
       w.state,
       w.collector_id,
       c.branch_name,
       coalesce(w.is_mfg_orgs = 1, false)              AS is_plant,
       coalesce(w.is_port, false)                      AS is_port,
       coalesce(w.repackwh_enable = 1, false)          AS is_repack,
       coalesce(w.is_active, false)                    AS is_active,
       w.disable_date
FROM "InventoryOrgs" w
LEFT JOIN dim_collector c ON c.collector_id = w.collector_id;

COMMENT ON VIEW dim_warehouse IS 'Every warehouse, plant and port that holds stock. Row -1 is the catch-all used when a fact arrives with a warehouse crm does not have in its master. Do not filter on is_active: two dozen warehouses are disabled and a few of them still hold stock.';
COMMENT ON COLUMN dim_warehouse.warehouse_id IS 'The oracle warehouse id (InventoryOrgs.inventory_org_id). -1 = unknown.';
COMMENT ON COLUMN dim_warehouse.warehouse_code IS 'Short code, e.g. 101, 202, PMO. Unique.';
COMMENT ON COLUMN dim_warehouse.warehouse_name IS 'Full name, e.g. PPC - Madhavaram.';
COMMENT ON COLUMN dim_warehouse.branch_name IS 'The sales branch this warehouse belongs to, where crm records one (about half of them).';
COMMENT ON COLUMN dim_warehouse.is_plant IS 'True for the manufacturing sites.';
COMMENT ON COLUMN dim_warehouse.is_port IS 'True for the bonded and duty-paid port warehouses imports land at.';
COMMENT ON COLUMN dim_warehouse.is_repack IS 'True where bulk stock is repacked into smaller packs.';
COMMENT ON COLUMN dim_warehouse.is_active IS 'Crm''s enabled flag. Disabled warehouses can still hold stock and still appear in history, so this is information, not a filter.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_supplier: the vendor master. most rows are not suppliers at all - vendor_type tells them apart.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_supplier CASCADE;

CREATE VIEW dim_supplier AS
WITH bought AS (
    SELECT vendor_id, count(*) AS po_lines, min(po_date) AS first_po, max(po_date) AS last_po
    FROM "BiPoDetails" WHERE vendor_id IS NOT NULL GROUP BY vendor_id
)
SELECT s.vendor_id                                     AS supplier_id,
       s.vendor_name                                   AS supplier_name,
       s.segment1                                      AS supplier_number,
       s.vendor_type_lookup_code                       AS supplier_type,
       -- the types that sell us goods, plus anyone who has actually raised a purchase order.
       -- the type list alone misses import vendors booked under OTHERS; OTHERS alone would drag in
       -- 7,400 rows that never bought anything. both together is the honest answer.
       coalesce(s.vendor_type_lookup_code IN ('VENDOR', 'VENDOR-DOMESTIC', 'VENDOR-INTERNATIONAL',
                                              'VENDOR-GPO', 'VENDOR-GPO-INTERNATIONAL', 'SUPPLY', 'PACKING'),
                false)
         OR b.vendor_id IS NOT NULL                    AS is_goods_supplier,
       b.vendor_id IS NOT NULL                         AS has_purchase_history,
       coalesce(b.po_lines, 0)                         AS po_lines,
       b.first_po,
       b.last_po,
       s.pay_group_lookup_code                         AS pay_group,
       nullif(s.terms_id, 0)::bigint                   AS payment_term_id,
       s.start_date_active::date                       AS active_from,
       s.end_date_active::date                         AS active_to,
       s.end_date_active IS NULL                       AS is_active,
       upper(btrim(s.attribute8)) = 'YES'              AS is_msme,
       nullif(btrim(s.attribute9), '')                 AS msme_class,
       nullif(btrim(s.attribute10), '')                AS msme_type,
       nullif(btrim(s.attribute11), '')                AS udyam_number,
       -- group companies: an order to one of these is an inter-company move, not a third party purchase
       upper(s.vendor_name) LIKE 'PON PURE%'
         OR upper(s.vendor_name) LIKE 'PURE CHEMICAL%'
         OR upper(s.vendor_name) LIKE 'PURE ORGANIC%'
         OR upper(s.vendor_name) LIKE 'ALTRA PURE%'
         OR upper(s.vendor_name) LIKE 'COLOR CHEMICALS%' AS is_group_company,
       s.creation_date::date                           AS created_on
FROM "ApSuppliers" s
LEFT JOIN bought b ON b.vendor_id = s.vendor_id;

COMMENT ON VIEW dim_supplier IS 'The oracle vendor master. Only about one row in eight is a company that sells us goods - the rest are employees, transporters, service providers and tax authorities. Use is_goods_supplier before counting suppliers, and is_group_company to separate genuine third party purchases from inter-company movements.';
COMMENT ON COLUMN dim_supplier.supplier_id IS 'ApSuppliers.vendor_id. fact_po_line and fact_goods_receipt point here.';
COMMENT ON COLUMN dim_supplier.supplier_number IS 'The oracle vendor number, which is what BiPoDetails carries as vendor_number.';
COMMENT ON COLUMN dim_supplier.supplier_type IS 'Crm''s raw vendor type, 24 values. VENDOR / VENDOR-DOMESTIC / SUPPLY / PACKING are the ones that sell us goods.';
COMMENT ON COLUMN dim_supplier.is_goods_supplier IS 'True where the vendor type is one that supplies goods, or where the vendor has actually raised a purchase order. Both halves are needed: crm books some import vendors under the catch-all type OTHERS, and most rows with that type never bought anything.';
COMMENT ON COLUMN dim_supplier.has_purchase_history IS 'True where at least one purchase order line exists. A supplier we could buy from is not the same as one we have bought from.';
COMMENT ON COLUMN dim_supplier.po_lines IS 'How many order lines this supplier has ever had. Zero for most of the master.';
COMMENT ON COLUMN dim_supplier.is_active IS 'False once oracle sets an end date. About a quarter are inactive; their history still matters.';
COMMENT ON COLUMN dim_supplier.is_msme IS 'Registered micro, small or medium enterprise - they carry statutory payment deadlines.';
COMMENT ON COLUMN dim_supplier.is_group_company IS 'True for our own group entities. Purchases from these are inter-company, so exclude them when measuring third party supplier performance.';
COMMENT ON COLUMN dim_supplier.payment_term_id IS 'Payment terms id, the same 10xxx id space as the requisition''s payment_term_id and lastpotermid. There is no master for it in crm - its own PaymentTerms table uses a different id space entirely and matches none of these - so the id cannot be resolved to a name here. Where the term matters, read it off the requisition, which carries the name.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_supplier_site: the supplier's address. this is where the country lives, and country is what
-- actually explains an import lead time - far better than the procurement type alone.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_supplier_site CASCADE;

CREATE VIEW dim_supplier_site AS
SELECT v.vendor_site_id                                AS supplier_site_id,
       v.vendor_id                                     AS supplier_id,
       v.vendor_site_code                              AS site_code,
       v.address_line1                                 AS address,
       v.city,
       v.state,
       v.zip,
       v.country                                       AS country_code,
       CASE upper(btrim(v.country))
           WHEN 'IN' THEN 'India'        WHEN 'CN' THEN 'China'         WHEN 'SG' THEN 'Singapore'
           WHEN 'KR' THEN 'Korea'        WHEN 'MY' THEN 'Malaysia'      WHEN 'TW' THEN 'Taiwan'
           WHEN 'TH' THEN 'Thailand'     WHEN 'US' THEN 'United States' WHEN 'DE' THEN 'Germany'
           WHEN 'ES' THEN 'Spain'        WHEN 'IT' THEN 'Italy'         WHEN 'TR' THEN 'Turkey'
           WHEN 'HK' THEN 'Hong Kong'    WHEN 'BE' THEN 'Belgium'       WHEN 'CH' THEN 'Switzerland'
           WHEN 'JP' THEN 'Japan'        WHEN 'GB' THEN 'United Kingdom' WHEN 'NL' THEN 'Netherlands'
           WHEN 'FR' THEN 'France'       WHEN 'AE' THEN 'United Arab Emirates'
           WHEN 'ID' THEN 'Indonesia'    WHEN 'VN' THEN 'Vietnam'       WHEN 'SA' THEN 'Saudi Arabia'
           WHEN 'RU' THEN 'Russia'       WHEN 'BR' THEN 'Brazil'        WHEN 'LK' THEN 'Sri Lanka'
           ELSE nullif(btrim(v.country), '')
       END                                             AS country,
       coalesce(upper(btrim(v.country)) = 'IN', false) AS is_domestic,
       nullif(v.country_of_origin_code, '')            AS country_of_origin_code,
       coalesce(v.purchasing_site_flag = 'Y', false)   AS is_purchasing_site,
       coalesce(v.pay_site_flag = 'Y', false)          AS is_pay_site,
       nullif(v.terms_id, 0)                           AS payment_term_id,
       nullif(v.ship_via_lookup_code, '')              AS carrier,
       nullif(v.freight_terms_lookup_code, '')         AS freight_terms,
       nullif(v.fob_lookup_code, '')                   AS fob,
       v.inactive_date IS NULL                         AS is_active
FROM "ApSupplierSitesAlls" v;

COMMENT ON VIEW dim_supplier_site IS 'One row per supplier address. A supplier can have several - a factory, a sales office, a pay-to address - and every purchase order line names one. This is where the country lives, and country explains import lead times far better than the procurement type does: an order from Spain and an order from the United States are both "import" and are weeks apart.';
COMMENT ON COLUMN dim_supplier_site.supplier_site_id IS 'ApSupplierSitesAlls.vendor_site_id. fact_po_line points here, and every line resolves.';
COMMENT ON COLUMN dim_supplier_site.country IS 'The country spelled out, from the two letter code. Unmapped codes fall through as the code itself.';
COMMENT ON COLUMN dim_supplier_site.country_of_origin_code IS 'Where the goods are actually made, when oracle records it as different from the address.';
COMMENT ON COLUMN dim_supplier_site.is_purchasing_site IS 'Orders can be placed on this address. A supplier''s other sites may be pay-to or remit-to only.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_po_line: one row per purchase order line. what we committed to buy.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_po_line CASCADE;

CREATE MATERIALIZED VIEW fact_po_line AS
WITH line AS (
    -- a redirected shipment leaves two rows on one po line, one per warehouse. the quantity is repeated
    -- on both but the receipt lands on only one, so pending has to be worked out on the line, not the row.
    SELECT po_line_id, count(*) AS copies, sum(coalesce(quantity_received, 0)) AS received_all_copies
    FROM "BiPoDetails" GROUP BY po_line_id
)
SELECT p.id                                            AS po_line_row_id,
       p.po_header_id,
       p.po_number,
       p.po_line_id,
       p.line_num,
       p.po_date,
       p.company_code,
       p.vendor_id                                     AS supplier_id,
       p.vendor_name                                   AS supplier_name,
       p.vendor_site_id                                AS supplier_site_id,
       v.country                                       AS supplier_country_code,
       p.inv_org_id                                    AS warehouse_id,
       p.inventory_item_id                             AS item_id,
       p.uom,
       -- crm writes this four ways with three spellings of Domestic. normalise once, here.
       CASE
           WHEN lower(btrim(p.procurement_type)) LIKE 'domestic procurement%' THEN 'domestic'
           WHEN lower(btrim(p.procurement_type)) LIKE 'import procurement%'   THEN 'import'
           WHEN lower(btrim(p.procurement_type)) = 'market procurement'       THEN 'market'
           WHEN lower(btrim(p.procurement_type)) = 'packing materials'        THEN 'packing'
           ELSE 'other'
       END                                             AS procurement_type,
       p.procurement_type                              AS procurement_type_raw,
       nullif(p.purchase_category, '0')                AS purchase_category,
       p.unit_price,
       p.quantity                                      AS ordered_qty,
       -- oracle ZEROES the quantity when a line is fully cancelled and keeps the original in
       -- quantity_cancelled. so ordered_qty is 0 on every cancelled line - use original_qty for history.
       p.quantity + coalesce(p.quantity_cancelled, 0)  AS original_qty,
       p.quantity = 0 AND coalesce(p.quantity_cancelled, 0) > 0
                                                       AS is_cancelled,
       p.quantity_received                             AS received_qty,
       l.received_all_copies,
       l.copies,
       p.quantity_cancelled                            AS cancelled_qty,
       p.quantity_billed                               AS billed_qty,
       -- only one copy of a redirected line carries the pending, so summing the column stays honest
       row_number() OVER (PARTITION BY p.po_line_id
                          ORDER BY coalesce(p.quantity_received, 0) DESC, p.inv_org_id) = 1
                                                       AS is_primary_copy,
       CASE WHEN row_number() OVER (PARTITION BY p.po_line_id
                                    ORDER BY coalesce(p.quantity_received, 0) DESC, p.inv_org_id) = 1
            THEN greatest(p.quantity - l.received_all_copies - coalesce(p.quantity_cancelled, 0), 0)
            ELSE 0 END                                 AS pending_qty,
       p.quantity_received > p.quantity                AS is_over_received,
       l.received_all_copies >= p.quantity - coalesce(p.quantity_cancelled, 0)
                                                       AS is_closed,
       p.line_amount,
       p.quantity * p.unit_price                       AS ordered_value,
       (p.quantity + coalesce(p.quantity_cancelled, 0)) * p.unit_price
                                                       AS original_value
FROM "BiPoDetails" p
JOIN line l ON l.po_line_id = p.po_line_id
LEFT JOIN "ApSupplierSitesAlls" v ON v.vendor_site_id = p.vendor_site_id;

CREATE UNIQUE INDEX fact_po_line_pk ON fact_po_line (po_line_id, warehouse_id);
CREATE INDEX fact_po_line_item ON fact_po_line (item_id, po_date);
CREATE INDEX fact_po_line_line ON fact_po_line (po_line_id);
CREATE INDEX fact_po_line_supplier ON fact_po_line (supplier_id);

COMMENT ON MATERIALIZED VIEW fact_po_line IS 'One row per purchase order line raised in oracle, performance chemicals only. Crm rebuilds the source nightly, so this is always the order book as it stands today, not history: a line cancelled yesterday looks cancelled in every past cycle too. The key is (po_line_id, warehouse_id). Mind two traps: oracle zeroes the quantity on a cancelled line (use original_qty), and a redirected shipment leaves two rows on one po line (pending sits on the primary copy only).';
COMMENT ON COLUMN fact_po_line.po_line_row_id IS 'The underlying load row. It is regenerated on every nightly load and must never be stored anywhere outside this view - use (po_line_id, warehouse_id) to identify a line.';
COMMENT ON COLUMN fact_po_line.po_line_id IS 'The oracle po line. fact_goods_receipt and fact_requisition_line point at it. It repeats where a shipment was redirected to a second warehouse, so it is unique only together with warehouse_id.';
COMMENT ON COLUMN fact_po_line.original_qty IS 'What was actually ordered, before any cancellation. Oracle zeroes the quantity when a line is fully cancelled and moves the original into quantity_cancelled, so ordered_qty reads 0 on those lines. Anything measuring order history or cancellation rates needs this column, not ordered_qty.';
COMMENT ON COLUMN fact_po_line.is_cancelled IS 'True where the whole line was cancelled - nothing ordered now, something cancelled. About one line in fifteen.';
COMMENT ON COLUMN fact_po_line.copies IS 'How many rows share this po line. More than one means the shipment was redirected to another warehouse.';
COMMENT ON COLUMN fact_po_line.received_all_copies IS 'Receipts across every copy of the line. This is what pending is worked out from.';
COMMENT ON COLUMN fact_po_line.is_primary_copy IS 'The copy that carries the pending quantity - the one that received the most. Sum pending_qty freely: the other copies are zero.';
COMMENT ON COLUMN fact_po_line.po_date IS 'When the order was placed. The start of the supplier lead time.';
COMMENT ON COLUMN fact_po_line.supplier_country_code IS 'Where the supplier site is, as a two letter code. Every line resolves. This is the single best predictor of an import lead time - see dim_item_lead_time.';
COMMENT ON COLUMN fact_po_line.procurement_type IS 'Normalised to domestic / import / market / packing / other. Crm spells Domestic Procurement three different ways; procurement_type_raw keeps the original.';
COMMENT ON COLUMN fact_po_line.pending_qty IS 'Still on the water: ordered minus receipts across all copies of the line minus cancelled, floored at zero, and carried only on the primary copy. Working it out per row instead would invent pending on the warehouse a redirected shipment never reached.';
COMMENT ON COLUMN fact_po_line.is_over_received IS 'True where more arrived than was ordered. Happens on about one line in twelve and is usually a bulk tolerance, not an error.';
COMMENT ON COLUMN fact_po_line.is_closed IS 'Nothing left to come: received covers the order net of cancellation.';
COMMENT ON COLUMN fact_po_line.ordered_value IS 'Quantity times unit price. Prefer this to line_amount, which crm does not always fill.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_goods_receipt: one row per receipt row. what actually turned up, and what it landed at.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_goods_receipt CASCADE;

CREATE MATERIALIZED VIEW fact_goods_receipt AS
SELECT g.id                                            AS receipt_row_id,
       g.receipt_id,
       g.receipt_line_id,
       g.receipt_num,
       g.receipt_date,
       g.source                                        AS receipt_source,
       CASE g.source
           WHEN 'VENDOR'         THEN 'bought from a third party'
           WHEN 'INTERNAL ORDER' THEN 'sent from another of our warehouses'
           WHEN 'INVENTORY'      THEN 'moved between sub-inventories'
           WHEN 'CUSTOMER'       THEN 'returned by a customer'
           ELSE 'manual adjustment'
       END                                             AS receipt_source_label,
       g.source = 'VENDOR'                             AS is_purchase,
       g.source = 'INTERNAL ORDER'                     AS is_internal_transfer,
       -- a sub-inventory move shuffles stock inside one warehouse. it is not new supply.
       g.source <> 'INVENTORY'                         AS adds_stock,
       g.inv_org_id                                    AS warehouse_id,
       g.req_inv_id                                    AS from_warehouse_id,
       g.req_vendor_name                               AS from_warehouse_name,
       g.from_inv_id                                   AS from_subinventory_org_id,
       g.vendor_id                                     AS supplier_id,
       g.vendor_name                                   AS supplier_name,
       g.po_header_id,
       g.po_line_id,
       g.customer_id,
       g.inventory_item_id                             AS item_id,
       g.item_code,
       nullif(btrim(g.lot_number), '')                 AS lot_number,
       g.uom,
       g.quantity_received                             AS quantity,
       g.ullage_loss,
       g.total_cost                                    AS landed_cost_per_unit,
       g.quantity_received * coalesce(g.total_cost, 0) AS landed_value,
       g.po_price_in_inr                               AS base_price_per_unit,
       coalesce(g.ocean_freight_charges, 0) + coalesce(g.insurance, 0) + coalesce(g.duties_per_unit, 0)
         + coalesce(g.cc, 0) + coalesce(g.freight_inward, 0) + coalesce(g.lc, 0) + coalesce(g.forex, 0)
                                                       AS import_cost_per_unit,
       coalesce(g.packing_cost, 0) + coalesce(g.labour_cost, 0) + coalesce(g.machine_cost, 0)
         + coalesce(g.other_cost, 0)                   AS handling_cost_per_unit,
       g.supplier_discount
FROM "BiGrnDetails" g;

CREATE UNIQUE INDEX fact_goods_receipt_pk ON fact_goods_receipt (receipt_row_id);
CREATE INDEX fact_goods_receipt_item ON fact_goods_receipt (item_id, receipt_date);
CREATE INDEX fact_goods_receipt_po ON fact_goods_receipt (po_line_id) WHERE po_line_id IS NOT NULL;
CREATE INDEX fact_goods_receipt_lot ON fact_goods_receipt (lot_number, warehouse_id) WHERE lot_number IS NOT NULL;

COMMENT ON MATERIALIZED VIEW fact_goods_receipt IS 'Everything that arrived at a warehouse, performance chemicals only, from 2018. There is no natural key: a quarter of crm''s rows carry no receipt id, and one delivery put away in pieces becomes several rows. Always SUM quantity, never count rows to mean deliveries. Mind receipt_date on transfers - see is_internal_transfer.';
COMMENT ON COLUMN fact_goods_receipt.receipt_row_id IS 'Our own row id. The only unique key: crm''s header_id restarts from 1 on every nightly rebuild and must never be used.';
COMMENT ON COLUMN fact_goods_receipt.receipt_date IS 'For a purchase this is the receipt. For an internal transfer it is the DESPATCH date, not the arrival - crm takes it from the shipment record. Use fact_internal_transfer for when a transfer actually landed.';
COMMENT ON COLUMN fact_goods_receipt.adds_stock IS 'True where the receipt brought stock into the business - bought in, sent from another warehouse, returned by a customer, or booked by hand. False for sub-inventory moves, which only shuffle stock inside one warehouse. Anything summing receipts as supply must filter on this or it will double count.';
COMMENT ON COLUMN fact_goods_receipt.receipt_source IS 'VENDOR / INTERNAL ORDER / INVENTORY / CUSTOMER / Miss / Direct. It decides which reference columns are filled: only VENDOR rows carry a po, only INTERNAL ORDER rows carry a sending warehouse, only CUSTOMER rows carry a customer.';
COMMENT ON COLUMN fact_goods_receipt.from_warehouse_id IS 'The warehouse that sent an internal transfer. Filled on every internal order back to 2018.';
COMMENT ON COLUMN fact_goods_receipt.lot_number IS 'The batch. Several rows can share one, and it is what links a despatch to its arrival in the stock table.';
COMMENT ON COLUMN fact_goods_receipt.landed_cost_per_unit IS 'Crm''s total landed cost for one unit: base price plus freight, insurance, duty, clearing and handling. Multiply by quantity for the value, which is what landed_value does.';
COMMENT ON COLUMN fact_goods_receipt.import_cost_per_unit IS 'The part of the landed cost that is ocean freight, insurance, duty, clearing, letter of credit and forex. Near zero on domestic receipts.';
COMMENT ON COLUMN fact_goods_receipt.ullage_loss IS 'Short delivery on a bulk tanker - what was ordered but did not arrive in the vessel.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_requisition_line: what the planners asked to buy, with the context crm showed them at that moment.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS fact_requisition_line CASCADE;

CREATE VIEW fact_requisition_line AS
SELECT d.line_id                                       AS requisition_line_id,
       d.header_id                                     AS requisition_id,
       h.requester,
       h.collector_id,
       h.supplier_id,
       h.ship_to_inv_org_id                            AS warehouse_id,
       h.type                                          AS requisition_type,
       h.purchase_category,
       h.business,
       h.currency,
       h.payment_term_id,
       h.payment_term,
       -- crm has no master for these term ids, but the names are regular enough to read:
       -- "45 days (Term date + 45)", "60 Days from BL / Shipment Date", "100% Advance", "Immediate"
       CASE
           WHEN h.payment_term ~* '^\s*[0-9]+\s*days'
               THEN (substring(h.payment_term from '^\s*([0-9]+)\s*[Dd]ays'))::int
           WHEN h.payment_term ~* 'advance|immedi' THEN 0
       END                                             AS payment_due_days,
       CASE
           WHEN h.payment_term ~* 'advance'        THEN 'advance'
           WHEN h.payment_term ~* 'bl|shipment'    THEN 'from shipment'
           WHEN h.payment_term ~* 'immedi'         THEN 'immediate'
           WHEN h.payment_term ~* 'term date'      THEN 'from term date'
       END                                             AS payment_basis,
       d.item_id,
       d.item_description                              AS item_name,
       d.uom,
       d.quantity                                      AS requested_qty,
       d.unit_price,
       d.total_price                                   AS requested_value,
       d.needby_date,
       d.pto_pts,
       -- decoded against crm's own ApprovalStatus master. two codes crm writes are not in it:
       -- 0 (an unfinished draft) and -2, which we leave as unknown rather than guess at.
       CASE
           WHEN d.status_id = 0        THEN 'draft'
           WHEN a.approval_status IS NULL THEN 'unknown'
           ELSE lower(a.approval_status)
       END                                             AS status,
       d.status_id,
       h.status_id                                     AS requisition_status_id,
       CASE
           WHEN h.status_id = 0        THEN 'draft'
           WHEN ah.approval_status IS NULL THEN 'unknown'
           ELSE lower(ah.approval_status)
       END                                             AS requisition_status,
       d.status_id IN (6, 15)                          AS is_approved,
       d.status_id = 8                                 AS is_referred_back,
       d.status_id BETWEEN 1 AND 5                     AS is_part_approved,
       -- the picture the buyer was looking at when they raised the line
       d.onhand_stock,
       d.eta_stock,
       d.pendingreqqty                                 AS pending_requisition_qty,
       d.avgsales                                      AS avg_sales,
       nullif(d.stock_days, 0)                         AS stock_days,
       d.stock_days > 3650                             AS stock_days_is_meaningless,
       d.lastpoprice                                   AS last_po_price,
       nullif(d.lastpotermid, 0)                       AS last_po_payment_term_id,
       nullif(d.lastpotermid, 0) IS DISTINCT FROM h.payment_term_id
                                                       AS payment_term_changed,
       d.change_in_price_per                           AS price_change_pct,
       d.last3jc_qty                                   AS last_3_cycle_qty,
       d.last6jc_qty                                   AS last_6_cycle_qty,
       -- the oracle order it turned into
       d.po_header_id,
       d.po_number,
       d.po_line_id,
       d.po_line_id IS NOT NULL                        AS reached_oracle,
       d.posenddate::date                              AS sent_to_oracle_on,
       d.creation_date::date                           AS requested_on,
       h.creation_date::date                           AS requisition_raised_on
FROM "PurchaseRequisitionDtls" d
JOIN "PurchaseRequisitionHdrs" h ON h.header_id = d.header_id
LEFT JOIN "ApprovalStatus" a  ON a.header_id = d.status_id
LEFT JOIN "ApprovalStatus" ah ON ah.header_id = h.status_id;

COMMENT ON VIEW fact_requisition_line IS 'One row per item on a purchase requisition raised in crm, about 4,500 a year since 2020, all performance chemicals. Valuable because it records what the buyer could see when they decided - stock on hand, stock on the water, average sales, the last price paid. Status is decoded against crm''s own ApprovalStatus master.';
COMMENT ON COLUMN fact_requisition_line.requisition_line_id IS 'PurchaseRequisitionDtls.line_id. The key.';
COMMENT ON COLUMN fact_requisition_line.status IS 'Decoded against crm''s ApprovalStatus master: approve (nine lines in ten), reject, referback, awaiting, refertoED, direct approval, cancel, or one of ten numbered approval levels. Two codes crm writes are not in its own master - 0, which its screens treat as an unfinished draft, and -2, which shows as unknown rather than being guessed at.';
COMMENT ON COLUMN fact_requisition_line.is_approved IS 'Fully approved: code 6 (approve) or 15 (direct approval). Note this is not the same as referback (8), which earlier read as approved-adjacent before the master was loaded.';
COMMENT ON COLUMN fact_requisition_line.is_referred_back IS 'Sent back to the requester - code 8. Previously mislabelled: the negative codes are awaiting, not referred back.';
COMMENT ON COLUMN fact_requisition_line.is_part_approved IS 'Through some but not all approval levels (codes 1 to 5).';
COMMENT ON COLUMN fact_requisition_line.requisition_status IS 'The same decode for the requisition as a whole, from its header.';
COMMENT ON COLUMN fact_requisition_line.onhand_stock IS 'Stock the buyer could see at the time, not today. This is history and must not be refreshed.';
COMMENT ON COLUMN fact_requisition_line.eta_stock IS 'Stock already on order and expected, as at the time of the request.';
COMMENT ON COLUMN fact_requisition_line.stock_days IS 'How many days the stock would last at the then average sales. A few hundred rows are absurd because crm divided by zero sales - stock_days_is_meaningless flags them.';
COMMENT ON COLUMN fact_requisition_line.last_3_cycle_qty IS 'Crm''s own demand baseline: average consumption per cycle over the last three cycles. Only filled from 2023, and only on about one domestic or import line in five - so it is a benchmark where present, not a complete series.';
COMMENT ON COLUMN fact_requisition_line.last_6_cycle_qty IS 'The same over six cycles. Where both exist, the three cycle figure running higher means demand is accelerating.';
COMMENT ON COLUMN fact_requisition_line.payment_due_days IS 'Days to pay, read off the term name because crm publishes no master for these term ids. Null where the name does not carry a number. Zero for advance and immediate terms - but an advance is paid before delivery, so read it together with payment_basis.';
COMMENT ON COLUMN fact_requisition_line.payment_basis IS 'What the days are counted from: the term date, the shipping document, immediate, or advance (paid up front). Two terms of sixty days are not the same money if one counts from shipment.';
COMMENT ON COLUMN fact_requisition_line.last_po_payment_term_id IS 'The payment term on the previous order for this item. Null when there was no previous order.';
COMMENT ON COLUMN fact_requisition_line.payment_term_changed IS 'True where this requisition uses different payment terms from the last order of the same item. Worth watching: terms drift quietly.';
COMMENT ON COLUMN fact_requisition_line.reached_oracle IS 'True once crm has pushed the line to oracle and stamped a po line on it.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_internal_transfer: the branch replenishment lane, reconstructed from lot numbers.
--
-- crm cannot give us this (asked sep 2026, declined) and it does not need to. the despatch date is already on the
-- receipt row - crm mislabels it receipt_date. the arrival is the first day that same lot appears in the stock
-- table at the receiving warehouse. the difference is transit.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_internal_transfer CASCADE;

CREATE MATERIALIZED VIEW fact_internal_transfer AS
WITH stock_from AS (
    SELECT min(trans_date) AS first_day FROM "BiStockDetail"
),
despatch AS (
    SELECT g.id                                        AS transfer_id,
           g.receipt_date                              AS despatch_date,
           g.req_inv_id                                AS from_warehouse_id,
           g.req_vendor_name                           AS from_warehouse_name,
           g.inv_org_id                                AS to_warehouse_id,
           g.inventory_item_id                         AS item_id,
           g.item_code,
           btrim(g.lot_number)                         AS lot_number,
           g.quantity_received                         AS quantity,
           g.quantity_received * coalesce(g.total_cost, 0) AS value
    FROM "BiGrnDetails" g
    WHERE g.source = 'INTERNAL ORDER'
      AND g.req_inv_id IS NOT NULL
      AND nullif(btrim(g.lot_number), '') IS NOT NULL
),
lot_seen AS (
    -- one row per lot and warehouse: the first day the stock table ever saw it there.
    -- that single number answers both questions the rule needs, so no range join is required:
    --   seen before the despatch  -> the lot was already there, nothing can be called an arrival
    --   seen on or after it       -> that first sighting IS the arrival
    SELECT btrim(lot_number) AS lot_number, inventory_org_id, min(trans_date) AS first_seen
    FROM "BiStockDetail"
    WHERE nullif(btrim(lot_number), '') IS NOT NULL
    GROUP BY btrim(lot_number), inventory_org_id
)
SELECT d.transfer_id,
       d.despatch_date,
       CASE WHEN f.first_seen >= d.despatch_date THEN f.first_seen END AS arrived_on,
       d.from_warehouse_id,
       d.from_warehouse_name,
       d.to_warehouse_id,
       d.item_id,
       d.item_code,
       d.lot_number,
       d.quantity,
       d.value,
       CASE WHEN f.first_seen >= d.despatch_date THEN f.first_seen - d.despatch_date END
                                                       AS transit_days,
       coalesce(f.first_seen < d.despatch_date, false) AS lot_pre_existed,
       f.first_seen IS NOT NULL                        AS lot_was_found,
       -- a measurement we trust: the lot was found, the destination did not already hold it,
       -- and it arrived inside a sane window
       f.first_seen IS NOT NULL
         AND f.first_seen >= d.despatch_date
         AND f.first_seen - d.despatch_date <= 60      AS is_measured,
       -- the stock table only starts in 2024, so older despatches can never be matched
       d.despatch_date >= (SELECT first_day FROM stock_from)
                                                       AS has_stock_history
FROM despatch d
LEFT JOIN lot_seen f ON f.lot_number = d.lot_number AND f.inventory_org_id = d.to_warehouse_id;

CREATE UNIQUE INDEX fact_internal_transfer_pk ON fact_internal_transfer (transfer_id);
CREATE INDEX fact_internal_transfer_lane ON fact_internal_transfer (from_warehouse_id, to_warehouse_id);
CREATE INDEX fact_internal_transfer_item ON fact_internal_transfer (item_id, despatch_date);

COMMENT ON MATERIALIZED VIEW fact_internal_transfer IS 'One row per stock movement between our own warehouses, with how long it took. Built without any help from crm: the despatch date is what crm calls receipt_date on an internal order row, and the arrival is the first day that lot turns up in the stock table at the destination. A movement is only measured where the destination did not already hold that lot - see lot_pre_existed. Filter on is_measured before averaging: an unmeasured row has no arrival, not a zero.';
COMMENT ON COLUMN fact_internal_transfer.transfer_id IS 'The receipt row this was built from (fact_goods_receipt.receipt_row_id).';
COMMENT ON COLUMN fact_internal_transfer.despatch_date IS 'When the sending warehouse shipped. Crm stores it as receipt_date, which is a misnomer on internal orders - measured, it falls on the sending warehouse''s own despatch day.';
COMMENT ON COLUMN fact_internal_transfer.arrived_on IS 'First day the stock table saw this lot at the receiving warehouse, counting only from the despatch onward. Null where the lot was never matched, or where the destination already held the lot so no arrival can be told apart from the stock already there.';
COMMENT ON COLUMN fact_internal_transfer.transit_days IS 'Arrival minus despatch. Includes any quality hold, because a lot sitting in quarantine still counts as present.';
COMMENT ON COLUMN fact_internal_transfer.is_measured IS 'True where the lot was found, the destination did not already hold it, and it arrived within sixty days. Always filter on this before averaging.';
COMMENT ON COLUMN fact_internal_transfer.lot_was_found IS 'The lot turned up in the stock table at the destination at all. False means a blank lot, stock consumed between two snapshots, or a despatch older than the stock history. With lot_pre_existed it tells the three reasons a movement is unmeasured apart.';
COMMENT ON COLUMN fact_internal_transfer.lot_pre_existed IS 'The destination already held this lot before the despatch - an earlier tranche, or a supplier batch number shared across warehouses. The first sighting afterwards is then stock that was already there, not an arrival, so these movements are left unmeasured. About one in five would otherwise read as same-day and drag the medians down.';
COMMENT ON COLUMN fact_internal_transfer.has_stock_history IS 'False for despatches older than the stock table, which can never be matched. Resolution is daily only from late 2024, so treat earlier transit times as rough.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_transfer_lane: how long each lane takes. the number a planner needs when moving stock between branches.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_transfer_lane CASCADE;

CREATE VIEW v_transfer_lane AS
SELECT t.from_warehouse_id,
       t.from_warehouse_name,
       t.to_warehouse_id,
       w.warehouse_name                                AS to_warehouse_name,
       w.branch_name                                   AS to_branch_name,
       count(*)                                        AS movements,
       count(DISTINCT t.item_id)                       AS items,
       min(t.despatch_date)                            AS first_movement,
       max(t.despatch_date)                            AS last_movement,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY t.transit_days)  AS transit_days_median,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY t.transit_days)  AS transit_days_p90,
       max(t.transit_days)                             AS transit_days_max,
       round(sum(t.value)::numeric, 0)                 AS value_moved
FROM fact_internal_transfer t
JOIN dim_warehouse w ON w.warehouse_id = t.to_warehouse_id
WHERE t.is_measured
GROUP BY t.from_warehouse_id, t.from_warehouse_name, t.to_warehouse_id, w.warehouse_name, w.branch_name;

COMMENT ON VIEW v_transfer_lane IS 'One row per sending warehouse to receiving warehouse lane, with how many days stock actually takes to get there. Use the median for planning and the p90 for a safety buffer. Lanes with only a handful of movements are noise - check the movements column before trusting a number.';
COMMENT ON COLUMN v_transfer_lane.transit_days_median IS 'The typical transit for this lane. Most are two or three days.';
COMMENT ON COLUMN v_transfer_lane.transit_days_p90 IS 'Nine movements in ten arrive within this many days. The number to plan a buffer against.';
COMMENT ON COLUMN v_transfer_lane.movements IS 'How many measured movements this lane is based on. Below about fifty, treat the medians as indicative.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_lead_time_by_country: how long a purchase takes by where it comes from. the tier dim_item_lead_time
-- falls back to, and the only number available for an item we have never received before.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_lead_time_by_country CASCADE;

CREATE VIEW v_lead_time_by_country AS
WITH po AS (
    SELECT po_line_id, min(po_date) AS po_date, min(procurement_type) AS procurement_type,
           min(supplier_country_code) AS country_code
    FROM fact_po_line WHERE po_line_id IS NOT NULL AND po_date IS NOT NULL
    GROUP BY po_line_id
),
first_receipt AS (
    SELECT po_line_id, min(receipt_date) AS receipt_date
    FROM fact_goods_receipt WHERE is_purchase AND po_line_id IS NOT NULL
    GROUP BY po_line_id
),
leg AS (
    SELECT p.procurement_type, p.country_code, r.receipt_date - p.po_date AS days
    FROM first_receipt r JOIN po p ON p.po_line_id = r.po_line_id
    WHERE r.receipt_date >= p.po_date AND r.receipt_date - p.po_date <= 365
      AND p.country_code IS NOT NULL
)
SELECT procurement_type,
       country_code,
       count(*)                                        AS observations,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS days_median,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS days_p90
FROM leg
GROUP BY 1, 2
HAVING count(*) >= 30;

COMMENT ON VIEW v_lead_time_by_country IS 'How long a purchase takes, by the way it is bought and the country it comes from. Country explains far more of an import lead time than the procurement type does - the United States and Spain are both "import" and weeks apart. Only combinations with at least thirty measured orders appear, so every row is worth planning against.';
COMMENT ON COLUMN v_lead_time_by_country.days_median IS 'Typical days from order to first delivery for this combination.';
COMMENT ON COLUMN v_lead_time_by_country.days_p90 IS 'Nine orders in ten arrive within this many days.';
COMMENT ON COLUMN v_lead_time_by_country.observations IS 'Measured orders behind the numbers. Never fewer than thirty.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_item_lead_time: per item, how long supply actually takes. the supplier leg and the transfer leg, separately.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS dim_item_lead_time CASCADE;

CREATE MATERIALIZED VIEW dim_item_lead_time AS
WITH po AS (
    -- one po line, one date. the line repeats where a shipment was redirected, so take its earliest order date
    SELECT po_line_id, min(po_date) AS po_date, min(procurement_type) AS procurement_type,
           min(supplier_country_code) AS country
    FROM fact_po_line
    WHERE po_line_id IS NOT NULL AND po_date IS NOT NULL
    GROUP BY po_line_id
),
first_receipt AS (
    -- when a po line first saw stock. a line delivered in parts counts from its first delivery
    SELECT po_line_id, item_id, min(receipt_date) AS receipt_date
    FROM fact_goods_receipt
    WHERE is_purchase AND po_line_id IS NOT NULL
    GROUP BY po_line_id, item_id
),
supplier_leg AS (
    SELECT r.item_id,
           p.procurement_type,
           p.country,
           r.receipt_date - p.po_date                  AS days
    FROM first_receipt r
    JOIN po p ON p.po_line_id = r.po_line_id
    WHERE r.receipt_date >= p.po_date
      AND r.receipt_date - p.po_date <= 365
),
supplier_stats AS (
    SELECT item_id,
           count(*)                                    AS supplier_observations,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS supplier_days_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS supplier_days_p90,
           mode() WITHIN GROUP (ORDER BY procurement_type)   AS procurement_type,
           mode() WITHIN GROUP (ORDER BY country)            AS country
    FROM supplier_leg
    GROUP BY item_id
),
-- where an item has too little of its own history, borrow from everything bought the same way from
-- the same country. an order from Spain and one from the United States are both "import" and weeks apart,
-- so the country tier matters far more than the type tier below it.
country_stats AS (
    SELECT procurement_type, country,
           count(*)                                    AS observations,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS days_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS days_p90
    FROM supplier_leg WHERE country IS NOT NULL
    GROUP BY 1, 2 HAVING count(*) >= 30
),
type_stats AS (
    SELECT procurement_type,
           count(*)                                    AS observations,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY days) AS days_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY days) AS days_p90
    FROM supplier_leg
    GROUP BY 1
),
transfer_stats AS (
    SELECT item_id,
           count(*)                                    AS transfer_observations,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY transit_days) AS transfer_days_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY transit_days) AS transfer_days_p90
    FROM fact_internal_transfer
    WHERE is_measured
    GROUP BY item_id
)
SELECT i.item_id,
       i.item_code,
       i.item_name,
       i.division,
       i.business,
       i.pto_pts,
       s.procurement_type,
       s.country                                       AS supplier_country_code,
       s.supplier_observations,
       s.supplier_days_median,
       s.supplier_days_p90,
       -- what to actually plan with: the item's own history when it has enough, else its country, else its type
       CASE WHEN coalesce(s.supplier_observations, 0) >= 3 THEN 'item'
            WHEN c.days_median IS NOT NULL                 THEN 'country'
            WHEN ty.days_median IS NOT NULL                THEN 'procurement type'
       END                                             AS supplier_days_source,
       coalesce(CASE WHEN s.supplier_observations >= 3 THEN s.supplier_days_median END,
                c.days_median, ty.days_median)         AS supplier_days,
       coalesce(CASE WHEN s.supplier_observations >= 3 THEN s.supplier_days_p90 END,
                c.days_p90, ty.days_p90)               AS supplier_days_p90_used,
       t.transfer_observations,
       t.transfer_days_median,
       t.transfer_days_p90,
       -- what to plan with: buying it in, plus moving it to where it is needed
       coalesce(s.supplier_days_median, 0) + coalesce(t.transfer_days_median, 0)
                                                       AS total_days_median,
       coalesce(s.supplier_days_p90, 0) + coalesce(t.transfer_days_p90, 0)
                                                       AS total_days_p90,
       -- how much to trust the row
       coalesce(s.supplier_observations, 0) >= 3       AS supplier_leg_is_reliable,
       coalesce(t.transfer_observations, 0) >= 3       AS transfer_leg_is_reliable
FROM dim_item i
LEFT JOIN supplier_stats s ON s.item_id = i.item_id
LEFT JOIN transfer_stats t ON t.item_id = i.item_id
LEFT JOIN country_stats c  ON c.procurement_type = s.procurement_type AND c.country = s.country
LEFT JOIN type_stats ty    ON ty.procurement_type = s.procurement_type
WHERE i.is_performance_chemicals
  AND (s.item_id IS NOT NULL OR t.item_id IS NOT NULL);

CREATE UNIQUE INDEX dim_item_lead_time_pk ON dim_item_lead_time (item_id);
CREATE INDEX dim_item_lead_time_type ON dim_item_lead_time (procurement_type);

COMMENT ON MATERIALIZED VIEW dim_item_lead_time IS 'Per item, how long supply really takes, measured from what happened rather than from a stated lead time. Two separate legs: buying it from a supplier, and moving it between our own warehouses. Only items with at least one measurement appear. Check the reliability flags before planning on a row - an item with one observation is an anecdote.';
COMMENT ON COLUMN dim_item_lead_time.supplier_days_median IS 'Typical days from placing the order to the first delivery. Around five for domestic, forty for imports.';
COMMENT ON COLUMN dim_item_lead_time.supplier_days_p90 IS 'Nine orders in ten arrive within this many days. Plan buffers against this, not the median.';
COMMENT ON COLUMN dim_item_lead_time.transfer_days_median IS 'Typical days to move the item between our own warehouses, from fact_internal_transfer.';
COMMENT ON COLUMN dim_item_lead_time.total_days_median IS 'The two legs added: order placed to available where it is needed. Where a leg has never been measured it counts as zero, so read it with the observation counts beside it.';
COMMENT ON COLUMN dim_item_lead_time.procurement_type IS 'The way this item is usually bought, taken as the commonest across its orders. Note market procurement is effectively historic: the performance chemicals filter leaves barely any market lines after early 2024, so those rows describe the past.';
COMMENT ON COLUMN dim_item_lead_time.supplier_leg_is_reliable IS 'True with three or more measured orders of this item. Below that its own median is a single anecdote - which is what supplier_days and supplier_days_source are for.';
COMMENT ON COLUMN dim_item_lead_time.supplier_days IS 'The number to plan with. The item''s own median where it has three or more orders, otherwise what everything bought the same way from the same country takes, otherwise the procurement type alone. supplier_days_source says which was used.';
COMMENT ON COLUMN dim_item_lead_time.supplier_days_source IS 'Where supplier_days came from: item, country or procurement type. Half the import book has too few orders of its own, and country is much the better fallback - Spain and the United States are both "import" and weeks apart.';
COMMENT ON COLUMN dim_item_lead_time.supplier_country_code IS 'Where this item is usually bought from, as the commonest country across its orders.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_open_po: what is still on the water, and whether it is late.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_open_po CASCADE;

CREATE VIEW v_open_po AS
SELECT p.po_line_row_id,
       p.po_number,
       p.po_line_id,
       p.po_date,
       p.supplier_id,
       p.supplier_name,
       s.is_group_company                              AS supplier_is_group_company,
       p.warehouse_id,
       w.warehouse_name,
       w.branch_name,
       p.item_id,
       i.item_name,
       i.business,
       p.procurement_type,
       p.uom,
       p.ordered_qty,
       p.received_qty,
       p.pending_qty,
       p.unit_price,
       p.pending_qty * p.unit_price                    AS pending_value,
       p.received_qty > 0 AND p.pending_qty > 0         AS is_partly_received,
       current_date - p.po_date                        AS days_since_order,
       current_date - p.po_date > 365                  AS is_abandoned,
       coalesce(l.supplier_days, cty.days_median)      AS expected_days,
       coalesce(l.supplier_days_p90_used, cty.days_p90) AS expected_days_p90,
       coalesce(l.supplier_days_source,
                CASE WHEN cty.days_median IS NOT NULL THEN 'country (this order)' END)
                                                       AS expected_days_source,
       (p.po_date + (coalesce(l.supplier_days, cty.days_median) || ' days')::interval)::date
                                                       AS expected_on,
       (p.po_date + (coalesce(l.supplier_days_p90_used, cty.days_p90) || ' days')::interval)::date
                                                       AS expected_on_p90,
       j.jc_id                                         AS expected_jc_id,
       j.jc_name                                       AS expected_jc_name,
       j.acc_year                                      AS expected_acc_year,
       -- late against this item's own measured history, not a stated lead time.
       -- four lines in five here are over a year old: orders nobody ever received and nobody ever
       -- cancelled, so crm still shows them pending. they are dead, not late - keep them apart.
       CASE
           WHEN current_date - p.po_date > 365                               THEN 'abandoned'
           WHEN coalesce(l.supplier_days_p90_used, cty.days_p90) IS NULL     THEN 'no history'
           WHEN current_date - p.po_date > coalesce(l.supplier_days_p90_used, cty.days_p90)
                                                                            THEN 'overdue'
           WHEN current_date - p.po_date > coalesce(l.supplier_days, cty.days_median)
                                                                            THEN 'running late'
           ELSE 'on track'
       END                                             AS delivery_status
FROM fact_po_line p
JOIN dim_warehouse w ON w.warehouse_id = p.warehouse_id
JOIN dim_item i ON i.item_id = p.item_id
LEFT JOIN dim_supplier s ON s.supplier_id = p.supplier_id
LEFT JOIN dim_item_lead_time l ON l.item_id = p.item_id
-- an item we have never received has no history of its own, but its order still names a country
LEFT JOIN v_lead_time_by_country cty ON cty.procurement_type = p.procurement_type
                                    AND cty.country_code = p.supplier_country_code
LEFT JOIN dim_jc j ON (p.po_date + (coalesce(l.supplier_days, cty.days_median) || ' days')::interval)::date
                      BETWEEN j.jc_start AND j.jc_end
WHERE NOT p.is_closed
  AND p.pending_qty > 0;

COMMENT ON VIEW v_open_po IS 'Purchase order lines with stock still to come, scored against each item''s own measured delivery history rather than a lead time somebody typed in. Mind is_abandoned: most of what crm shows as pending was ordered years ago and is never arriving. A plain view, not materialized: the open book changes daily and must never be stale.';
COMMENT ON COLUMN v_open_po.pending_qty IS 'Still to arrive: ordered minus received minus cancelled.';
COMMENT ON COLUMN v_open_po.days_since_order IS 'How long this line has been open.';
COMMENT ON COLUMN v_open_po.expected_on IS 'When this line should arrive: the order date plus the item''s own lead time where it has one, else what everything bought the same way from the same country takes, else the procurement type. For an item never received before, the country comes from this very order. expected_days_source says which was used.';
COMMENT ON COLUMN v_open_po.expected_jc_id IS 'The journey cycle the expected arrival falls in. This is what lets supply be compared against the plan, which is measured by cycle.';
COMMENT ON COLUMN v_open_po.is_partly_received IS 'Some of the line has arrived and some has not - a split delivery still running.';
COMMENT ON COLUMN v_open_po.delivery_status IS 'Abandoned (ordered over a year ago - nobody received it and nobody cancelled it, so crm still shows it pending), overdue (past this item''s ninetieth percentile), running late (past its typical days), on track, or no history where the item has never been measured. Four open lines in five are abandoned, so filter them out before reading the live book.';
COMMENT ON COLUMN v_open_po.is_abandoned IS 'Ordered more than a year ago and still showing stock to come. These are housekeeping, not supply - exclude them from any pending value that a planner acts on.';
COMMENT ON COLUMN v_open_po.supplier_is_group_company IS 'True where the order is on one of our own group entities, so it is an inter-company move rather than a third party purchase.';
