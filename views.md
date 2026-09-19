# Views

Rules that decide *which rows count* and *what a number means* live here, not in the load. The raw tables are a
mirror of crm plus the minimum needed to make the foreign keys hold (`-1` / `unknown` rows, `0` → null, junk dates
→ null). Everything the planning tool reads should come from a view on top.

Two kinds:

- **dim / fact views** - one clean row per thing, ready to join: `dim_customer_site`, `dim_item`, `fact_dispatch` ..
- **fixes** - things we chose not to do at load time because they change meaning or would break a foreign key.

Status: nothing built yet. This is the list of what each table needs.

## customer_master

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| CustomerSites | `dim_customer_site`: one row per `site_use_id` with customer, circle, region, collector flattened (site → mc_code → MarketCircles → Collectors) | the tool needs one hop, the raw chain is three |
| CustomerMasters | `dim_customer`: one row per customer with a "home" circle / collector. Rule: primary active BILL_TO site; 174 customers still tie, take the latest | territory belongs to the site, a customer level answer is a convention |
| CustomerMasters | status filter: `status = 'A'` vs `status <> 'I'` - 14% are null or blank. pick one, document it | either is defensible, the load must not decide |
| CustomerSites | `mc_code = 'unknown'` rows (2,047): show as an "unknown circle" bucket or exclude per report | visible bucket was the choice, reports decide |

## item_master

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| ItemMasters | `dim_item`: item + its category segments (1:1 with ItemCategories) + current PTO / PTS flag | segments and pto/pts sit in two other tables |
| PurchaseRequisitionPtoPts | latest classification per item: `max(FromDate)` row, ~30 rows per item otherwise | it is month wise history, the tool wants "is it PTO today" |
| ItemMasters | `status` is `Active` / `Inactive` (full word), customers use `A` / `I` - normalise in the dim | crm inconsistency, not ours to change in the mirror |

## sales_order_soc

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| SaleOrderDtls | `status` is NOT an open order flag: 900k lines say OPEN, crm never closes them. The open book is `SocPendingDetails`. Views must not use `status` for "pending" | the column is loaded as is, informational |
| SaleOrderHdrs | `quotation_date` has junk (year 0001, 2027): use `po_received_date` for any date axis | junk kept in the mirror |
| SaleOrderHdrs | `trans_type_name` filter for "real sales": exclude Stock Transfer / Sample / Cogt per report | which types count is a business rule |
| SocPendingDetails | today's open book, one `syncdate`. If history is ever wanted, a nightly copy into a history table (accumulate) | replace mode was chosen at load |
| SocPendingDetails | `itemcode` → item: `item_code` is not unique in ItemMasters (6 dups). Join through a dedup of ItemMasters on item_code (latest item_id) | no fk possible |
| SaleOrderHdrs / Dtls | `quotation_line_id` / `quotationdtl_line_id` → quotes: soft, only PC quotes from 2021 are loaded | orders are not PC filtered, quotes are |

## dispatch_master

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| DispatchDetails | `fact_dispatch`: dispatched qty / value per order line per date. Date = `schedule_date`. Item = `item_id` (what shipped, differs from the order line on 7%) | |
| Dispatches | cancelled dispatches: exclude `despatch_status_id = 4` OR `oracle_status = 'CANCELLED'` (two different sets, no overlap) | raw keeps them, reports must drop them |
| DispatchDetails | blank `header_id` / `schedule_line_id` (a few hundred): parent outside the parent's filter. Still join through the order line | |
| Schedules | `schedule_status_id` is NOT an open flag (92% sit at 6 after dispatch). Use `SocPendingDetails` for open, `Schedules` for the per line history and reschedule reasons | |
| Schedules | `dispatched_quantity` is stale in crm and not loaded: dispatched qty comes from `DispatchDetails` via `schedule_line_id` | |
| Schedules | otif: `customer_requested_date` vs `DispatchDetails.schedule_date` per schedule line | |
| SocCancelDetails | `close_reason_id` → `Reasons.header_id` (303 row lookup, not loaded yet). `status_id` has no master | add Reasons, then a join |
| SocCancelDetails | net open book = SocPending minus cancelled remaining qty where the cancel is approved (`status_id = 6`) | |

## quotation_master

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| QuotationHdrs | pipeline = `status_id` in Open / Approved / Confirmed (1, 3, 6). 96% are Closed = converted | |
| QuotationHdrs | `customer_hdr_id` is 0 / null on 92% - use `customer_id` | |
| QuotationDtls | conversion rate: quote line → `SaleOrderDtls.quotationdtl_line_id` (90% soft link) | |
| QuotationDtls | `status_id` 0 on 536 rows loaded as null | |

## business_plan

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| SCBusinessMonthlyPlanDtls | **dedupe**: a third of the rows are exact copies (1,166 headers with 2 copies, 24 prospect headers with ~4,400 copies). Keep the lowest `line_id` per header | JCDtls points at individual copies (both copies of a 2-copy header carry forecasts); deleting on stage would orphan forecast rows |
| SCBusinessMonthlyPlanDtls | **unpivot** to `plan_jc`: one row per plan line × JC (13 × 7 columns → long). Columns: jc, week1_qty, week2_qty, achieved, avg_price, saved | crm stores it wide, every query wants it long |
| SCBusinessMonthlyPlanDtls | **drop empty plans**: 86% of lines have all 26 week quantities at 0 (crm creates a row for every header). Filter `week1_qty + week2_qty > 0` | valid rows, just uninteresting; "customers with a header but no plan" may be a metric |
| SCBusinessMonthlyPlanDtls | **value = qty × `jcN_user_dfn_avg_sell_price`**. The `jcN_weekN_user_dfn_value` columns are user typed in mixed units (12,554 rows in lakhs, 16 in rupees, 947 other) - never read them | no rule identifies the unit per row |
| SCBusinessMonthlyPlanJCDtls | dedupe (72 duplicate header/jc pairs, take latest); drop the 87% all-zero rows; forecast for JC n = row where `jc_type` = that cycle | |
| SCBusinessMonthlyPlanJCDtls | `header_id` is the plan LINE (`Dtls.line_id`), name it `plan_line_id` in the view | misnamed in crm, kept as is in the mirror |
| SCBusinessMonthlyPlanHdrs | **plan vs actual needs a product name rule**: the plan has no `item_id`, only `item_description` + `category_id`. Maps to one sku 29%, several 58% (pack sizes), none 13%. Aggregate dispatch by product name, or build a name → item mapping table | |
| SCBusinessMonthlyPlanHdrs | prospects: `customer_id = -1` with `new_customer_name` / `new_customer_marketcircle`; a `dim_plan_customer` that unions real customers and prospects | |
| SCBusinessMonthlyPlanHdrs | `jcN_status` codes (1 .. 6) have no master; 1 and 4 cover 96%. Ask crm, then a case expression | |
| SCBusinessMonthlyPlanHdrs | duplicate headers: 2,606 groups of same year / customer / collector / category / product. Dedupe with the detail | |
| JourneyCalendars | `jc_type = -1` (7,888 forecast rows with jc 0): "unknown cycle" bucket or exclude | |
| all measures | float32 in crm (`real`): expect `0.20000000298`, round in the view | |

## purchase_master

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| BiPoDetails | open purchase: `pending_qty = greatest(quantity - quantity_received - quantity_cancelled, 0)`. 8% are over-received, real | |
| BiPoDetails | `procurement_type` spelling: `Domestic Procurement` vs `Domestic Procurements` (6 rows) - normalise | |
| BiPoDetails | `purchase_category = '0'` on 37% (old pos): treat as unknown, `procurement_type` is the reliable classifier | |
| BiPoDetails | requisition → po: join `PurchaseRequisitionDtls.po_line_id` = `BiPoDetails.po_line_id`, aggregate the 402 duplicate po lines first | soft link, not unique |
| PurchaseRequisitionHdrs / Dtls | `status_id` codes: hdr 6 = approved (91%), 7 = rejected, 0 = draft; dtl -2 .. 8, negatives = referred back. No master, ask crm | |
| PurchaseRequisitionDtls | `stock_days > 3650` (359 rows) = no sales, crm divide by zero. Treat as null | |
| PurchaseRequisitionDtls | `category_id` is the category at request time (16% differ from today) - use it as history, not as the item's category | |
| ApSuppliers | `dim_supplier`: real suppliers only = `vendor_type_lookup_code = 'SUPPLIER'` (or in a po); active = `end_date_active is null or > today`; `terms_id::bigint` | 24k rows, ~3k are suppliers |

## inventory_master

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| BiStockDetail | `fact_stock_position`: today's stock = rows where `trans_date = max(trans_date)`; by warehouse x item (sum `opening_qty` over sub-inventories and lots), value = `opening_qty x item_cost` | the raw table is one row per lot per day |
| BiStockDetail | stock trend: one row per warehouse x item x `trans_date`; for a weekly series use `TypeOfTrx = 'FRIDAY'`, month start `'FIRST_DAY'` (empty before 2023) | daily rows loaded, the grain is a report choice |
| BiStockDetail | lot aging buckets: `trans_date - aging_date` in days → 0-30 / 31-60 / 61-90 / 90+ per lot; the `Quarantine` / `UNRECON` sub-inventories are not sellable stock, decide per report | |
| BiStockDetail | days of cover = position / average daily dispatch (from `DispatchDetails`, same warehouse x item) | joins two facts, belongs in a view |
| InventoryOrgs | `dim_warehouse`: id, code, name, city, state, plant / port / repack flags, home collector - all on the row now. `is_active` is informational (4 inactive warehouses still hold stock), a report decides whether to show them | |
| InventoryOrgs | the branch ↔ warehouse mapping is `BiCollectorInventoryOrgMapping`, not the `collector_id` on this row | |
| BiCollectorInventoryOrgMapping | `bridge_branch_warehouse`: use it for "which warehouses may branch X draw from". **Never** as "branch X has no warehouse" - 69 collectors have no row at all, 30 of them book orders. For actual serving warehouse use `DispatchDetails.inventory_org_id` grouped by collector | a configured list, not an observed one |
| BiCollectorInventoryOrgMapping | `enddate` is set on 1 row - treat every row as current; `startdate` is the original mapping date (later re-inserts were dropped at load) | |
| ItemInventoryOrgMappings | `dim_item_warehouse`: the planning grid = pairs with `enabled_flag = 'Y'`; left-join the stock position and dispatch onto it so an item a warehouse *may* stock but doesn't shows as zero, not as missing | disabled pairs are loaded too, a report decides whether to show them |
| ItemInventoryOrgMappings | stock / orders on a pair that is **not** mapped (1 stock row today) - an exception report, not an error | |

## cross cutting

- **collector**: an order's `collector_id` (booking collector) differs from the ship-to site's circle collector on ~10% of orders. Both are legitimate; a report must say which one it uses.
- **`-1` / `'unknown'` rows** exist in MarketCircles, CustomerMasters, CustomerSites, DeliveryFroms and JourneyCalendars (not in Collectors or ItemMasters - there a missing parent is null). Every dim view decides: show as an "unknown" bucket (default) or filter out.
- **performance chemicals scope**: quotes, dispatch, schedules, cancels, pos, requisitions are PC only; orders, customers, items are not. A view that joins across must not assume a match exists.
- **snapshot race**: a handful of rows in every snapshot child carry a blank fk (parent created between the two reads). They still join through other keys; the next run heals them.
- **item_code is not unique** (6 codes appear twice in ItemMasters). Any join on code needs a dedup on the master side.
