# Views

Rules that decide *which rows count* and *what a number means* live here, not in the load. The raw tables are a
mirror of crm plus the minimum needed to make the foreign keys hold (`-1` / `unknown` rows, `0` → null, junk dates
→ null). Everything the planning tool reads should come from a view on top.

Two kinds:

- **dim / fact views** - one clean row per thing, ready to join: `dim_customer_site`, `dim_item`, `fact_dispatch` ..
- **fixes** - things we chose not to do at load time because they change meaning or would break a foreign key.

Built views are documented in `views_applied.md` (what each view is, columns, rules, diagrams). This file is only the to-do list.

Status: item_master, customer_master, sales_order_soc done. Next: dispatch_master.

## customer_master - built, see `views_applied.md`

## item_master - built, see `views_applied.md`

## sales_order_soc - built, see `views_applied.md`

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
| Schedules / DispatchDetails | **schedule-line open book** (crm's own forecasting feed, `SpSyncSocPendingOrder_Forecasting`): line OPEN, balance = `schedule_quantity − dispatched` > 0, not GROUP COMPANY, **no pending cancellation** (`SocCancelDetails.status_id not in 6, 7`), effective date = `reschedule_date` when set else `schedule_date`. This is `is_demand` on the open book | crm computes it into `SocPendingAlertToBUSINESS_FORECASTING`; we rebuild it from the two tables |
| DispatchDetails | "dispatched" must mean **confirmed**: `despatch_confirm_flag = 'Y'` and note not cancelled (`despatch_status_id <> 4`) - crm's `fn_SOCScheduleQty` rule. Check the flag is loaded on `Dispatches` | |

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

## user_and_scope

| Table | What the view has to do | Why not at load |
| --- | --- | --- |
| Users | `dim_user`: user + role name (through `UserRoles`, 1:1) + manager name (self join on `reporting_to_id`) | three tables, the tool wants one row |
| Users | "real, current users" = `is_active` and `coalesce(is_dummy, false) = false`; 163 dummies and 153 inactive are loaded as is | which users count is a report choice; dummies carry history |
| Users | a user's branch / circle / customers come from the mapping tables (next), not from `Users` - `collector_id` there is empty on every row | |
| Roles | the deleted role `SS Quote` still has 7 users - show it, don't drop it | |
| UserMarketCircleMappings | `user_territory_current`: rows where `valid_to is null or valid_to >= today` (237). The 36 closed rows are past territories - keep them out of scope checks, use them for "who owned this circle in 2023" | history is kept at load, the cut-off is a rule |
| UserMarketCircleMappings | a Sales Executive's branch = `MarketCircles.collector_id` of their current primary circle (`is_primary`); nobody has more than 3 circles | |
| UserCollectorMappings | branch **permission** for back office users, not location: 18 users see 100+ branches (= all). Do not derive "user's branch" from it; for managers use `CollectorMailMappings` | |
| UserCustomerMappings | `user_customers_current`: rows where `valid_to is null or valid_to >= today`; join `CustomerMasters` on `customer_hdr_id`, never on `customer_id` | |
| CollectorMailMappings | **unpivot** into `branch_role_user (collector_id, role, user_id)` with role in bm / rm / cm / bc / ed / gm, nulls dropped - then "branches this manager owns" is one filter. 38 branches have neither bm nor rm: fall back to `MarketCircles.collector_id` → `Collectors`, or leave blank per report | crm stores the chain wide |
| CollectorMailMappings | split `coordinator_user_id` (text, ids or a comma list) into the same bridge as role `coordinator` | |
| TechnicalUserSegmentMappings | `user_segments_current`: `valid_to` null or future. Join `ItemCategories` on `segment2 + segment3 (+ segment4 when filled)` to get the items a technical person covers; then split `collector_id` (comma list, `'0'` / null = all branches) to narrow by branch | the segment key is text on both sides, no fk |
| all mappings | **a user's scope** = union of: their current circle(s) (Sales Exec), branches (back office), customers (TE), segments x branches (TM / TH), branches managed (chain). Roles decide which one applies - build one `user_scope` view keyed by user with the four lists, rather than four separate joins in every report | |

## cross cutting

- **collector**: an order's `collector_id` (booking collector) differs from the ship-to site's circle collector on ~10% of orders. Both are legitimate; a report must say which one it uses.
- **`-1` / `'unknown'` rows** exist in MarketCircles, CustomerMasters, CustomerSites, DeliveryFroms and JourneyCalendars (not in Collectors or ItemMasters - there a missing parent is null). Every dim view decides: show as an "unknown" bucket (default) or filter out.
- **performance chemicals scope**: quotes, dispatch, schedules, cancels, pos, requisitions are PC only; orders, customers, items are not. A view that joins across must not assume a match exists.
- **snapshot race**: a handful of rows in every snapshot child carry a blank fk (parent created between the two reads). They still join through other keys; the next run heals them.
- **item_code is not unique** (6 codes appear twice in ItemMasters). Any join on code needs a dedup on the master side.
