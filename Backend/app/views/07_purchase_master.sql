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
       coalesce(upper(btrim(s.attribute8)) = 'YES', false) AS is_msme,
       nullif(btrim(s.attribute9), '')                 AS msme_class,
       nullif(btrim(s.attribute10), '')                AS msme_type,
       nullif(btrim(s.attribute11), '')                AS udyam_number,
       -- group companies: an order to one of these is an inter-company move, not a third party purchase
       -- crm's own SupplierTypes maps "GROUP COMPANY" to the oracle type GPO, so the type is the
       -- declared marker; the name patterns catch the ones booked under an ordinary vendor type.
       s.vendor_type_lookup_code LIKE '%GPO%'
         OR upper(s.vendor_name) LIKE 'PON PURE%'
         OR upper(s.vendor_name) LIKE 'PURE CHEMICAL%'
         OR upper(s.vendor_name) LIKE 'PURE ORGANIC%'
         OR upper(s.vendor_name) LIKE 'ALTRA PURE%'
         OR upper(s.vendor_name) LIKE 'COLOR CHEMICALS%' AS is_group_company,
       s.creation_date::date                           AS created_on
FROM "ApSuppliers" s
LEFT JOIN bought b ON b.vendor_id = s.vendor_id;

COMMENT ON VIEW dim_supplier IS 'The oracle vendor master. Only about one row in four is a company that sells us goods - the rest are employees, transporters, service providers and tax authorities. Use is_goods_supplier before counting suppliers, and is_group_company to separate genuine third party purchases from inter-company movements.';
COMMENT ON COLUMN dim_supplier.supplier_id IS 'ApSuppliers.vendor_id. fact_po_line and fact_goods_receipt point here.';
COMMENT ON COLUMN dim_supplier.supplier_number IS 'The oracle vendor number, which is what BiPoDetails carries as vendor_number.';
COMMENT ON COLUMN dim_supplier.supplier_type IS 'Crm''s raw vendor type, 24 values. Seven of them sell us goods: VENDOR, VENDOR-DOMESTIC, VENDOR-INTERNATIONAL, VENDOR-GPO, VENDOR-GPO-INTERNATIONAL, SUPPLY and PACKING. Null on a few dozen rows.';
COMMENT ON COLUMN dim_supplier.is_goods_supplier IS 'True where the vendor type is one that supplies goods, or where the vendor has actually raised a purchase order. Both halves are needed: crm books some import vendors under the catch-all type OTHERS, and most rows with that type never bought anything.';
COMMENT ON COLUMN dim_supplier.has_purchase_history IS 'True where at least one purchase order line exists. A supplier we could buy from is not the same as one we have bought from.';
COMMENT ON COLUMN dim_supplier.po_lines IS 'How many order lines this supplier has ever had. Zero for most of the master.';
COMMENT ON COLUMN dim_supplier.is_active IS 'False once oracle sets an end date. About a quarter are inactive; their history still matters.';
COMMENT ON COLUMN dim_supplier.is_msme IS 'Registered micro, small or medium enterprise - they carry statutory payment deadlines. Crm leaves the field empty on most of the master, and empty is read as not registered rather than unknown.';
COMMENT ON COLUMN dim_supplier.is_group_company IS 'True for our own group entities - either the declared oracle type (GPO, which crm maps to "GROUP COMPANY") or a group name. Purchases from these are inter-company, so exclude them when measuring third party supplier performance.';
COMMENT ON COLUMN dim_supplier.payment_term_id IS 'Payment terms id. Resolves in full against ApTermsTls, crm''s mirror of the oracle terms master, which also covers the supplier site, the requisition header and lastpotermid. Do not reach for crm''s dbo.PaymentTerms: that is the customer receivables master on a different id space and matches none of these.';


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
       upper(btrim(v.country))                         AS country_code_raw,
       -- two codes are wrong at source and would otherwise split a country in two: every KP site is a
       -- south korean firm and every AS site is american. fold them, and keep the raw code beside it.
       CASE upper(btrim(v.country)) WHEN 'KP' THEN 'KR' WHEN 'AS' THEN 'US'
            ELSE nullif(upper(btrim(v.country)), '') END AS country_code,
       CASE CASE upper(btrim(v.country)) WHEN 'KP' THEN 'KR' WHEN 'AS' THEN 'US'
                 ELSE upper(btrim(v.country)) END
           WHEN 'IN' THEN 'India'        WHEN 'CN' THEN 'China'         WHEN 'SG' THEN 'Singapore'
           WHEN 'KR' THEN 'Korea'        WHEN 'MY' THEN 'Malaysia'      WHEN 'TW' THEN 'Taiwan'
           WHEN 'TH' THEN 'Thailand'     WHEN 'US' THEN 'United States' WHEN 'DE' THEN 'Germany'
           WHEN 'ES' THEN 'Spain'        WHEN 'IT' THEN 'Italy'         WHEN 'TR' THEN 'Turkey'
           WHEN 'HK' THEN 'Hong Kong'    WHEN 'BE' THEN 'Belgium'       WHEN 'CH' THEN 'Switzerland'
           WHEN 'JP' THEN 'Japan'        WHEN 'GB' THEN 'United Kingdom' WHEN 'NL' THEN 'Netherlands'
           WHEN 'FR' THEN 'France'       WHEN 'AE' THEN 'United Arab Emirates'
           WHEN 'ID' THEN 'Indonesia'    WHEN 'VN' THEN 'Vietnam'       WHEN 'SA' THEN 'Saudi Arabia'
           WHEN 'RU' THEN 'Russia'       WHEN 'BR' THEN 'Brazil'        WHEN 'LK' THEN 'Sri Lanka'
           WHEN 'PK' THEN 'Pakistan'     WHEN 'OM' THEN 'Oman'          WHEN 'BD' THEN 'Bangladesh'
           WHEN 'AU' THEN 'Australia'    WHEN 'CA' THEN 'Canada'        WHEN 'IL' THEN 'Israel'
           WHEN 'IE' THEN 'Ireland'
           ELSE nullif(upper(btrim(v.country)), '')
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
COMMENT ON COLUMN dim_supplier_site.country IS 'The country spelled out. Unmapped codes fall through as the code itself.';
COMMENT ON COLUMN dim_supplier_site.country_code IS 'The two letter code, with two source errors folded: every site coded KP is a South Korean firm and every site coded AS is American. Grouping on this rather than the raw code keeps those suppliers with their own country.';
COMMENT ON COLUMN dim_supplier_site.country_code_raw IS 'Exactly what oracle holds, before the KP and AS corrections. Keep for tracing back to the source record.';
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
COMMENT ON COLUMN fact_po_line.is_over_received IS 'True where more arrived than was ordered - about one line in 480, usually a bulk tolerance rather than an error.';
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
       nullif(h.payment_term_id, 0)                    AS payment_term_id,
       coalesce(pt.name, h.payment_term)               AS payment_term,
       pt.due_days                                     AS payment_due_days,
       -- what the days are counted from, per oracle's own term group code
       CASE pt.attribute1
           WHEN '1'  THEN 'from term date'
           WHEN '2'  THEN 'from shipment'
           WHEN '3'  THEN 'from shipment (documents against acceptance)'
           WHEN '4'  THEN 'post dated cheque'
           WHEN '6'  THEN 'from shipment (standby letter of credit)'
           WHEN '7'  THEN 'from shipment (letter of credit)'
           WHEN '8'  THEN 'immediate'
           WHEN '9'  THEN 'part advance'
           WHEN '10' THEN 'cash against documents'
           ELSE CASE
               WHEN pt.name ~* 'advance'      THEN 'advance'
               WHEN pt.name ~* 'bl|shipment'  THEN 'from shipment'
               WHEN pt.name ~* 'immedi|cash'  THEN 'immediate'
               WHEN pt.name ~* 'pdc'          THEN 'post dated cheque'
               WHEN pt.name ~* 'term date'    THEN 'from term date'
           END
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
       lt.name                                         AS last_po_payment_term,
       lt.due_days                                     AS last_po_payment_due_days,
       -- null, not true, where there is nothing to compare with: crm writes 0 when the item has no prior order
       CASE WHEN nullif(d.lastpotermid, 0) IS NULL OR nullif(h.payment_term_id, 0) IS NULL THEN NULL
            ELSE d.lastpotermid <> h.payment_term_id END AS payment_term_changed,
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
LEFT JOIN "ApprovalStatus" ah ON ah.header_id = h.status_id
LEFT JOIN "ApTermsTls" pt     ON pt.term_id = nullif(h.payment_term_id, 0)
LEFT JOIN "ApTermsTls" lt     ON lt.term_id = nullif(d.lastpotermid, 0);

COMMENT ON VIEW fact_requisition_line IS 'One row per item on a purchase requisition raised in crm, about 4,500 a year since 2020, all performance chemicals. Valuable because it records what the buyer could see when they decided - stock on hand, stock on the water, average sales, the last price paid. Status is decoded against crm''s own ApprovalStatus master.';
COMMENT ON COLUMN fact_requisition_line.requisition_line_id IS 'PurchaseRequisitionDtls.line_id. The key.';
COMMENT ON COLUMN fact_requisition_line.status IS 'Decoded against crm''s ApprovalStatus master: approve (nine lines in ten), reject, referback, awaiting, refertoED, direct approval, cancel, or one of ten numbered approval levels. Two codes crm writes are not in its own master - 0, which its screens treat as an unfinished draft, and -2, which shows as unknown rather than being guessed at.';
COMMENT ON COLUMN fact_requisition_line.is_approved IS 'Fully approved: code 6 (approve) or 15 (direct approval). Note this is not the same as referback (8), which earlier read as approved-adjacent before the master was loaded.';
COMMENT ON COLUMN fact_requisition_line.is_referred_back IS 'Sent back to the requester - code 8. Previously mislabelled: the negative codes are awaiting, not referred back.';
COMMENT ON COLUMN fact_requisition_line.is_part_approved IS 'Through some but not all approval levels (codes 1 to 5).';
COMMENT ON COLUMN fact_requisition_line.requisition_status IS 'The header''s own status - the stamp of the last approver action on any approval group, NOT a roll-up of its lines. Around nine hundred headers disagree with their own lines, including approved headers holding lines that were never approved. Filter on the line status, not this one.';
COMMENT ON COLUMN fact_requisition_line.onhand_stock IS 'Stock the buyer could see at the time, not today. This is history and must not be refreshed.';
COMMENT ON COLUMN fact_requisition_line.eta_stock IS 'Stock already on order and expected, as at the time of the request.';
COMMENT ON COLUMN fact_requisition_line.stock_days IS 'How many days the stock would last at the then average sales. A few hundred rows are absurd because crm divided by zero sales - stock_days_is_meaningless flags them.';
COMMENT ON COLUMN fact_requisition_line.last_3_cycle_qty IS 'Crm''s own demand baseline: average consumption per cycle over the last three cycles. Only filled from 2023, and only on about one domestic or import line in five - so it is a benchmark where present, not a complete series.';
COMMENT ON COLUMN fact_requisition_line.last_6_cycle_qty IS 'The same over six cycles. Where both exist, the three cycle figure running higher means demand is accelerating.';
COMMENT ON COLUMN fact_requisition_line.payment_due_days IS 'Days to pay, from crm''s own terms master (ApTermsTls, mirrored from oracle). Zero for immediate and advance terms - but an advance is paid before delivery, so read it together with payment_basis.';
COMMENT ON COLUMN fact_requisition_line.payment_basis IS 'What the days are counted from, per oracle''s term group: the term date, the shipping document (plain, letter of credit, standby or documents against acceptance), immediate, cash against documents, a post dated cheque, or part advance. Two terms of sixty days are not the same money if one counts from shipment.';
COMMENT ON COLUMN fact_requisition_line.last_po_payment_term IS 'The term on the previous order of this item, resolved to its name. Null where there was no previous order.';
COMMENT ON COLUMN fact_requisition_line.last_po_payment_term_id IS 'The payment term on the previous order for this item. Null when there was no previous order.';
COMMENT ON COLUMN fact_requisition_line.payment_term_changed IS 'True where this requisition uses different payment terms from the last order of the same item, false where they match, and NULL where there is nothing to compare with - crm writes a zero term id when the item has no previous order. Worth watching: terms drift quietly.';
COMMENT ON COLUMN fact_requisition_line.reached_oracle IS 'True once crm has pushed the line to oracle and stamped a po line on it.';


-- ---------------------------------------------------------------------------------------------------------------
-- fact_internal_transfer: the branch replenishment lane, reconstructed from lot numbers.
--
-- crm cannot give us this (asked sep 2026, declined) and it does not need to. the despatch date is already
-- on the receipt row - crm mislabels it receipt_date. the arrival comes from the lot number.
--
-- three things the stock table forces on us, all measured:
--   it is an OPENING balance   a row dated X is the position at the START of X. checked against vendor
--                              receipts, whose receipt date is real: 97% of their lots first appear on
--                              receipt date + 1 and only 0.1% on the day. so arrival = first_seen - 1,
--                              and a lot first seen ON the despatch day was already there.
--   it starts in 2024          a despatch older than the first snapshot can never be matched; its lot
--                              simply appears on the first snapshot and reads as a long journey.
--   a lot is not an item       lot numbers are receipt batch ids and are reused across items, so the item
--                              has to be part of the key or one item inherits another item's date.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS fact_internal_transfer CASCADE;

CREATE MATERIALIZED VIEW fact_internal_transfer AS
WITH stock_from AS (
    -- the first snapshot in the whole stock table. gate on this one global date, never per warehouse:
    -- some warehouses join the stock table late simply because they are new, and their transfers are real.
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
    -- first day the stock table shows this lot OF THIS ITEM at this warehouse
    SELECT btrim(lot_number) AS lot_number, inventory_org_id, item_id, min(trans_date) AS first_seen
    FROM "BiStockDetail"
    WHERE nullif(btrim(lot_number), '') IS NOT NULL AND item_id IS NOT NULL
    GROUP BY btrim(lot_number), inventory_org_id, item_id
)
SELECT d.transfer_id,
       d.despatch_date,
       CASE WHEN d.despatch_date >= k.first_day AND f.first_seen > d.despatch_date
            THEN f.first_seen - 1 END                  AS arrived_on,
       d.from_warehouse_id,
       d.from_warehouse_name,
       d.to_warehouse_id,
       d.item_id,
       d.item_code,
       d.lot_number,
       d.quantity,
       d.value,
       CASE WHEN d.despatch_date >= k.first_day AND f.first_seen > d.despatch_date
            THEN f.first_seen - d.despatch_date - 1 END AS transit_days,
       -- seen ON the despatch day counts as already there: the snapshot is that morning's position
       coalesce(f.first_seen <= d.despatch_date, false) AS lot_pre_existed,
       f.first_seen IS NOT NULL                        AS lot_was_found,
       d.despatch_date >= k.first_day
         AND f.first_seen IS NOT NULL
         AND f.first_seen > d.despatch_date
         AND f.first_seen - d.despatch_date - 1 <= 60  AS is_measured,
       d.despatch_date >= k.first_day                  AS has_stock_history,
       -- the stock table only became daily in nov 2024. before that it is five to seven snapshots a month,
       -- which pushes transit about two days high.
       d.despatch_date >= DATE '2024-11-15'            AS daily_resolution,
       -- one consignment is often booked as several consecutive receipt rows. transit is identical across
       -- them, so aggregate on the primary row and use the movement quantity, or the lane counts inflate.
       sum(d.quantity) OVER w                          AS movement_quantity,
       sum(d.value) OVER w                             AS movement_value,
       row_number() OVER (w ORDER BY d.transfer_id) = 1 AS is_movement_primary
FROM despatch d
CROSS JOIN stock_from k
LEFT JOIN lot_seen f ON f.lot_number = d.lot_number
                    AND f.inventory_org_id = d.to_warehouse_id
                    AND f.item_id = d.item_id
WINDOW w AS (PARTITION BY d.despatch_date, d.from_warehouse_id, d.to_warehouse_id, d.item_id, d.lot_number);

CREATE UNIQUE INDEX fact_internal_transfer_pk ON fact_internal_transfer (transfer_id);
CREATE INDEX fact_internal_transfer_lane ON fact_internal_transfer (from_warehouse_id, to_warehouse_id);
CREATE INDEX fact_internal_transfer_item ON fact_internal_transfer (item_id, despatch_date);

COMMENT ON MATERIALIZED VIEW fact_internal_transfer IS 'One row per receipt row of stock moved between our own warehouses, with how long it took. Built without any help from crm: the despatch date is what crm calls receipt_date on an internal order row, and the arrival is read from the lot number in the stock table. Filter on is_measured before averaging, and on is_movement_primary before counting - one consignment is often several rows.';
COMMENT ON COLUMN fact_internal_transfer.transfer_id IS 'The receipt row this was built from (fact_goods_receipt.receipt_row_id). Regenerated on every nightly load - never store it anywhere outside this view.';
COMMENT ON COLUMN fact_internal_transfer.despatch_date IS 'When the sending warehouse shipped. Crm stores it as receipt_date, which is a misnomer on internal orders - measured, it falls on the sending warehouse''s own despatch day.';
COMMENT ON COLUMN fact_internal_transfer.arrived_on IS 'The day the stock actually reached the destination. The stock table is an opening balance - a row dated X is the position at the start of X - so this is the first sighting minus one day. Verified against vendor receipts, where the true receipt date is known: 97% first appear the morning after.';
COMMENT ON COLUMN fact_internal_transfer.transit_days IS 'Arrival minus despatch. Includes any quality hold, because a lot sitting in quarantine still counts as present.';
COMMENT ON COLUMN fact_internal_transfer.is_measured IS 'True where the despatch is inside the stock history, the lot was found for this item, it was not already at the destination, and it arrived within sixty days. Always filter on this before averaging.';
COMMENT ON COLUMN fact_internal_transfer.lot_pre_existed IS 'The destination already held this lot of this item on the morning it was despatched - an earlier tranche, or a batch number shared with another consignment. No arrival can be told apart from the stock already there, so these are left unmeasured.';
COMMENT ON COLUMN fact_internal_transfer.lot_was_found IS 'The lot turned up in the stock table at the destination at all. False means a blank lot, or stock consumed between two snapshots.';
COMMENT ON COLUMN fact_internal_transfer.has_stock_history IS 'The despatch is inside the stock table''s history. Older movements cannot be matched: their lot simply appears on the first snapshot, which reads as a journey of weeks rather than days.';
COMMENT ON COLUMN fact_internal_transfer.daily_resolution IS 'The stock table was daily by this despatch date (from mid November 2024). Before that it ran five to seven snapshots a month, which reads about two days high. Filter on it when precision matters.';
COMMENT ON COLUMN fact_internal_transfer.is_movement_primary IS 'One row per real consignment. A consignment booked as several consecutive receipt rows would otherwise be counted several times - transit is identical across them.';
COMMENT ON COLUMN fact_internal_transfer.movement_quantity IS 'Quantity of the whole consignment, summed across its receipt rows. Use this with is_movement_primary; use quantity only at row grain.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_transfer_lane: how long each lane takes. the number a planner needs when moving stock between branches.
-- this, not the per-item figure, is the better predictor: measured out of sample the lane median beats any
-- per-item statistic, because an item moves on several lanes with quite different journeys.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_transfer_lane CASCADE;

CREATE VIEW v_transfer_lane AS
SELECT t.from_warehouse_id,
       t.from_warehouse_name,
       t.to_warehouse_id,
       w.warehouse_name                                AS to_warehouse_name,
       w.branch_name                                   AS to_branch_name,
       count(*)                                        AS movements,
       count(*) FILTER (WHERE t.daily_resolution)      AS movements_daily_era,
       count(DISTINCT t.item_id)                       AS items,
       min(t.despatch_date)                            AS first_movement,
       max(t.despatch_date)                            AS last_movement,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY t.transit_days)  AS transit_days_median,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY t.transit_days)  AS transit_days_p90,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY t.transit_days)
         FILTER (WHERE t.daily_resolution)             AS transit_days_median_daily,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY t.transit_days)
         FILTER (WHERE t.daily_resolution)             AS transit_days_p90_daily,
       max(t.transit_days)                             AS transit_days_max,
       round(sum(t.movement_value)::numeric, 0)        AS value_moved,
       count(*) >= 50                                  AS is_reliable
FROM fact_internal_transfer t
JOIN dim_warehouse w ON w.warehouse_id = t.to_warehouse_id
WHERE t.is_measured AND t.is_movement_primary
GROUP BY t.from_warehouse_id, t.from_warehouse_name, t.to_warehouse_id, w.warehouse_name, w.branch_name;

COMMENT ON VIEW v_transfer_lane IS 'One row per sending warehouse to receiving warehouse lane, with how many days stock actually takes. This is the number to plan a transfer with - better than the per-item figure, because one item moves on several lanes at quite different speeds. Use the median for planning and the p90 for a buffer, and check is_reliable first.';
COMMENT ON COLUMN v_transfer_lane.movements IS 'Measured consignments behind the numbers, counted once each even where crm booked one consignment as several receipt rows.';
COMMENT ON COLUMN v_transfer_lane.is_reliable IS 'At least fifty measured movements. Below that treat the medians as indicative.';
COMMENT ON COLUMN v_transfer_lane.transit_days_median IS 'The typical transit for this lane, over all measured movements.';
COMMENT ON COLUMN v_transfer_lane.transit_days_median_daily IS 'The same over movements since the stock table became daily. Where the two differ the daily figure is the truer one - the weekly era reads about two days high.';
COMMENT ON COLUMN v_transfer_lane.transit_days_p90 IS 'Nine movements in ten arrive within this many days. The number to plan a buffer against.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_supplier_leg: one row per purchase order line that was delivered, with how long it took.
-- the single source both lead-time views read, so they can never drift apart.
--
-- zero-day legs are the trap here. a purchase order booked on the day the goods arrive is paperwork, not
-- supply: 14% of domestic legs and 8% of import legs. leaving them in drags a country's median far below
-- what an actual order takes. they stay in the counts - they really did happen - but out of the percentiles.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_supplier_leg CASCADE;

CREATE VIEW v_supplier_leg AS
WITH po AS (
    -- one po line, one date. the line repeats where a shipment was redirected, so take its earliest order date
    SELECT po_line_id,
           min(po_date)               AS po_date,
           min(item_id)               AS item_id,
           min(procurement_type)      AS procurement_type,
           min(supplier_country_code) AS country_code
    FROM fact_po_line
    WHERE po_line_id IS NOT NULL AND po_date IS NOT NULL
    GROUP BY po_line_id
),
first_receipt AS (
    -- when a po line first saw stock. a line delivered in parts counts from its first delivery
    SELECT po_line_id, min(receipt_date) AS receipt_date
    FROM fact_goods_receipt
    WHERE is_purchase AND po_line_id IS NOT NULL
    GROUP BY po_line_id
)
SELECT p.po_line_id,
       p.item_id,
       p.procurement_type,
       p.country_code,
       p.po_date,
       r.receipt_date,
       r.receipt_date - p.po_date                      AS days,
       r.receipt_date = p.po_date                      AS is_zero_day
FROM first_receipt r
JOIN po p ON p.po_line_id = r.po_line_id
WHERE r.receipt_date >= p.po_date
  AND r.receipt_date - p.po_date <= 365;

COMMENT ON VIEW v_supplier_leg IS 'One row per purchase order line that was actually delivered: what was ordered, from where, and how many days it took. Both lead-time views are built on this one view so they cannot drift apart. Mind is_zero_day - an order booked on the day the goods arrive is paperwork catching up, not a real lead time.';
COMMENT ON COLUMN v_supplier_leg.days IS 'Order date to first delivery. Zero where the order was raised on the day the goods landed.';
COMMENT ON COLUMN v_supplier_leg.is_zero_day IS 'The order and the delivery share a date - the paperwork was raised after the fact. About one domestic leg in seven and one import leg in thirteen. Real, so it stays in the counts, but it is not a lead time and is kept out of the percentiles.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_lead_time_by_country: how long a purchase takes by where it comes from. the tier dim_item_lead_time
-- falls back to, and the only number available for an item we have never received before.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_lead_time_by_country CASCADE;

CREATE VIEW v_lead_time_by_country AS
SELECT procurement_type,
       country_code,
       count(*)                                        AS observations,
       count(*) FILTER (WHERE is_zero_day)             AS zero_day_legs,
       round(100.0 * count(*) FILTER (WHERE is_zero_day) / count(*), 1) AS zero_day_share_pct,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FILTER (WHERE NOT is_zero_day) AS days_median,
       percentile_cont(0.9) WITHIN GROUP (ORDER BY days) FILTER (WHERE NOT is_zero_day) AS days_p90
FROM v_supplier_leg
WHERE country_code IS NOT NULL
GROUP BY 1, 2
HAVING count(*) >= 30;

COMMENT ON VIEW v_lead_time_by_country IS 'How long a purchase takes, by the way it is bought and the country it comes from. Country explains far more of an import lead time than the procurement type does - the United States and Spain are both "import" and weeks apart. Only combinations with at least thirty measured orders appear.';
COMMENT ON COLUMN v_lead_time_by_country.days_median IS 'Typical days from order to first delivery, counting only orders that were not raised on the delivery day.';
COMMENT ON COLUMN v_lead_time_by_country.days_p90 IS 'Nine orders in ten arrive within this many days, on the same basis.';
COMMENT ON COLUMN v_lead_time_by_country.observations IS 'Measured orders behind the numbers, including the zero-day ones. Never fewer than thirty.';
COMMENT ON COLUMN v_lead_time_by_country.zero_day_share_pct IS 'How much of this tier is paperwork raised on the delivery day. A high share means the real ordering process here is not visible in the data at all.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_item_lead_time: per item, how long supply actually takes. the supplier leg and the transfer leg,
-- kept apart. the transfer figure here BLENDS lanes - take the transfer leg from v_transfer_lane instead
-- wherever the warehouses are known.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS dim_item_lead_time CASCADE;

CREATE MATERIALIZED VIEW dim_item_lead_time AS
WITH supplier_stats AS (
    SELECT item_id,
           count(*)                                    AS supplier_observations,
           count(*) FILTER (WHERE is_zero_day)         AS supplier_zero_day_legs,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FILTER (WHERE NOT is_zero_day) AS supplier_days_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY days) FILTER (WHERE NOT is_zero_day) AS supplier_days_p90,
           mode() WITHIN GROUP (ORDER BY procurement_type) AS procurement_type,
           mode() WITHIN GROUP (ORDER BY country_code)     AS country_code
    FROM v_supplier_leg
    GROUP BY item_id
),
type_stats AS (
    SELECT procurement_type,
           count(*)                                    AS observations,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY days) FILTER (WHERE NOT is_zero_day) AS days_median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY days) FILTER (WHERE NOT is_zero_day) AS days_p90
    FROM v_supplier_leg
    GROUP BY procurement_type
),
transfer_stats AS (
    SELECT item_id,
           count(*)                                    AS transfer_observations,
           count(DISTINCT (from_warehouse_id, to_warehouse_id)) AS transfer_lanes,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY transit_days) AS transfer_days_median_blended,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY transit_days) AS transfer_days_p90_blended
    FROM fact_internal_transfer
    WHERE is_measured AND is_movement_primary
    GROUP BY item_id
),
resolved AS (
    SELECT i.item_id,
           i.item_code,
           i.item_name,
           i.division,
           i.business,
           i.pto_pts,
           s.procurement_type,
           s.country_code                              AS supplier_country_code,
           s.supplier_observations,
           s.supplier_zero_day_legs,
           s.supplier_days_median,
           s.supplier_days_p90,
           t.transfer_observations,
           t.transfer_lanes,
           t.transfer_days_median_blended,
           t.transfer_days_p90_blended,
           -- what to plan with: the item's own history when it has enough, else its country, else its type
           CASE WHEN coalesce(s.supplier_observations, 0) >= 3 AND s.supplier_days_median IS NOT NULL THEN 'item'
                WHEN c.days_median IS NOT NULL                 THEN 'country'
                WHEN ty.days_median IS NOT NULL                THEN 'procurement type'
           END                                         AS supplier_days_source,
           coalesce(CASE WHEN s.supplier_observations >= 3 THEN s.supplier_days_median END,
                    c.days_median, ty.days_median)     AS supplier_days,
           coalesce(CASE WHEN s.supplier_observations >= 3 THEN s.supplier_days_p90 END,
                    c.days_p90, ty.days_p90)           AS supplier_days_p90_used,
           coalesce(s.supplier_observations, 0) >= 3   AS supplier_leg_is_reliable,
           coalesce(t.transfer_observations, 0) >= 3   AS transfer_leg_is_reliable
    FROM dim_item i
    LEFT JOIN supplier_stats s ON s.item_id = i.item_id
    LEFT JOIN transfer_stats t ON t.item_id = i.item_id
    LEFT JOIN v_lead_time_by_country c ON c.procurement_type = s.procurement_type
                                      AND c.country_code = s.country_code
    LEFT JOIN type_stats ty ON ty.procurement_type = s.procurement_type
    WHERE i.is_performance_chemicals
      AND (s.item_id IS NOT NULL OR t.item_id IS NOT NULL)
)
SELECT x.*,
       -- built from the planning figures, not the raw medians: an item that fell back to its country has
       -- one or two observations of its own, and adding those back in would be the anecdote we avoided.
       coalesce(x.supplier_days, 0) + coalesce(x.transfer_days_median_blended, 0)
                                                       AS total_days_indicative,
       coalesce(x.supplier_days_p90_used, 0) + coalesce(x.transfer_days_p90_blended, 0)
                                                       AS total_days_indicative_p90
FROM resolved x;

CREATE UNIQUE INDEX dim_item_lead_time_pk ON dim_item_lead_time (item_id);
CREATE INDEX dim_item_lead_time_type ON dim_item_lead_time (procurement_type);

COMMENT ON MATERIALIZED VIEW dim_item_lead_time IS 'Per item, how long supply really takes, measured from what happened rather than from a stated lead time. Two legs kept apart: buying it from a supplier, and moving it between our own warehouses. Only items with at least one measurement appear.';
COMMENT ON COLUMN dim_item_lead_time.supplier_days IS 'The number to plan with. The item''s own median where it has three or more delivered orders, otherwise what everything bought the same way from the same country takes, otherwise the procurement type alone. supplier_days_source says which was used.';
COMMENT ON COLUMN dim_item_lead_time.supplier_days_source IS 'Where supplier_days came from: item, country or procurement type. Half the import book has too few orders of its own, and country is much the better fallback - Spain and the United States are both "import" and weeks apart.';
COMMENT ON COLUMN dim_item_lead_time.supplier_days_median IS 'The item''s own median, over its delivered orders that were not raised on the delivery day. Use supplier_days for planning - this is the raw figure, and on an item with one or two orders it is an anecdote.';
COMMENT ON COLUMN dim_item_lead_time.supplier_zero_day_legs IS 'How many of this item''s orders were raised on the day the goods arrived. They count as observations but are kept out of the medians.';
COMMENT ON COLUMN dim_item_lead_time.supplier_leg_is_reliable IS 'Three or more delivered orders of this item. Below that its own median is a single anecdote - which is what supplier_days and supplier_days_source are for.';
COMMENT ON COLUMN dim_item_lead_time.transfer_days_median_blended IS 'Days to move this item between our own warehouses, BLENDED across every lane it travels. An item on a one day lane and an eleven day lane reports something in between that matches neither. Where the warehouses are known, take the transfer leg from v_transfer_lane instead; transfer_lanes says how many this blends.';
COMMENT ON COLUMN dim_item_lead_time.transfer_lanes IS 'How many distinct lanes the blended transfer figure covers. More than one means the figure describes no actual journey.';
COMMENT ON COLUMN dim_item_lead_time.total_days_indicative IS 'Supplier days plus the blended transfer days - a rough order-to-available figure for ranking items, not a promise. A real total needs the lane, so take it from v_open_po or pair supplier_days with v_transfer_lane. Where a leg was never measured it counts as zero.';
COMMENT ON COLUMN dim_item_lead_time.procurement_type IS 'The way this item is usually bought, taken as the commonest across its orders. Note market procurement is effectively historic: the performance chemicals filter leaves barely any market lines after early 2024, so those rows describe the past.';
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
