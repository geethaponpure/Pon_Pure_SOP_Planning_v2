# CRM Data Model

## CRM Customer_master Data Model

The CRM data model consists of four main tables:

- `Collectors`
- `MarketCircles`
- `CustomerSites`
- `CustomerMasters`

The logical business relationship is:

```text
CustomerMasters
       │
       │ 1 : N
       │ header_id
       ▼ 
CustomerSites
       │
       │ N : 1
       │ mc_code
       ▼
MarketCircles
       │
       │ N : 1
       │ collector_id
       ▼
Collectors
```

---

## CRM Item_Master Data Model

The CRM Item Master data model consists of three main tables:

- ItemMasters
- ItemCategories
- PurchaseRequisitionPtoPts

The logical business relationship is:

```text
ItemMasters
       │
       ├───────────────────────┐
       │                       │
       │ 1 : 1                 │ 1 : N
       │ item_id               │ item_id → itemid
       ▼                       ▼
ItemCategories       PurchaseRequisitionPtoPts
```

The relationships represent:

- One `ItemMasters` record has one `ItemCategories` record.
- One `ItemMasters` record can have many `PurchaseRequisitionPtoPts` records.
- `ItemMasters` is the parent table for both tables.

---

## CRM Sales_Order_SOC Data Model

The CRM Sales Order / SOC data model consists of three main tables:

- SaleOrderHdrs
- SaleOrderDtls
- SocPendingDetails

The logical business relationship is:

```text
SaleOrderHdrs
       │
       ├───────────────────────┐
       │                       │
       │ 1 : N                 │ 1 : N
       │ header_id             │ header_id → order_no
       ▼                       ▼
SaleOrderDtls           SocPendingDetails
```

The relationships represent:

- One `SaleOrderHdrs` record has many `SaleOrderDtls` records (one per item line).
- One `SaleOrderHdrs` record can have many `SocPendingDetails` records (one per pending schedule line).
- `SaleOrderHdrs` is the parent table for both tables.
- `SocPendingDetails` has no link to `SaleOrderDtls` - the report carries no line id, so a pending row joins the order, never a specific line.
- `SocPendingDetails` is a daily snapshot from CRM. It has no key of its own, so it is wiped and reloaded every run with our own `id` as primary key.

Links to the master tables:

```text
SaleOrderHdrs.collector_id       → Collectors.collector_id
SaleOrderHdrs.customer_id        → CustomerMasters.customer_id
SaleOrderHdrs.bill_to_site_id    → CustomerSites.site_use_id      (-1 = unknown site)
SaleOrderHdrs.ship_to_site_id    → CustomerSites.site_use_id      (-1 = unknown site)
SaleOrderDtls.item_id            → ItemMasters.item_id
SocPendingDetails.collector_id   → Collectors.collector_id
SocPendingDetails.customer_number→ CustomerMasters.customer_number
SocPendingDetails.market_circle  → MarketCircles.mc_code          ('unknown' when blank)
SocPendingDetails.itemcode       → ItemMasters.item_code          (soft link, item_code is not unique)
```

---

## CRM Dispatch Data Model

The CRM Dispatch data model consists of five main tables:

- DeliveryFroms
- Dispatches
- Schedules
- SocCancelDetails
- DispatchDetails

The logical business relationship is:

```text
DeliveryFroms
(delivery point lookup, 46 rows)
       ▲
       │ N : 1
       │ delivery_from_id → line_id
       │
SaleOrderDtls
       │
       ├──────────────────────────┬──────────────────────────┐
       │ 1 : N                    │ 1 : N                    │ 1 : N
       │ line_id                  │ line_id                  │ line_id
       ▼                          ▼                          ▼
Schedules                  SocCancelDetails           DispatchDetails
(planned dispatch)         (cancelled lines)          (what shipped)
       │                                                     ▲
       │ 1 : N                                               │ N : 1
       │ line_id → schedule_line_id                          │ header_id
       └─────────────────────────────────────────────────────┤
                                                             │
                                                        Dispatches
                                                        (note / invoice)
```

The relationships represent:

- One `SaleOrderDtls` line has about one `Schedules` row (planned dispatch date, reschedules, status).
- One `Schedules` row can have many `DispatchDetails` rows (partial shipments).
- One `Dispatches` note (invoice) has many `DispatchDetails` lines, avg 1.8.
- One `SaleOrderDtls` line can have many `SocCancelDetails` rows (cancellation requests, usually one).
- `DeliveryFroms` is a 46 row lookup for `SaleOrderDtls.delivery_from_id`; `-1` = unknown for the 542 lines crm left at 0.
- `SocCancelDetails.schedule_line_id` is a reference only, no fk - the schedule is often deleted after the cancel (60% match).
- `Dispatches`, `Schedules` and `DispatchDetails` are snapshot tables: filtered to Performance Chemicals from 2021 and reloaded in full every run, because crm edits them after creation (status, reschedules, billing confirmation).
- `SocCancelDetails` and `DeliveryFroms` are incremental - their rows never change.

Links to the master tables:

```text
Dispatches.customer_id                   → CustomerMasters.customer_id
Dispatches.collector_id                  → Collectors.collector_id
Dispatches.bill_to_customer_site_id      → CustomerSites.site_use_id
Dispatches.ship_to_customer_site_id      → CustomerSites.site_use_id
Dispatches.sale_order_header_id          → SaleOrderHdrs.header_id
Schedules.customer_id                    → CustomerMasters.customer_id
Schedules.bill_to_customer_site_id       → CustomerSites.site_use_id      (-1 = unknown site)
Schedules.ship_to_customer_site_id       → CustomerSites.site_use_id      (-1 = unknown site)
Schedules.sale_order_header_id           → SaleOrderHdrs.header_id
Schedules.item_id                        → ItemMasters.item_id
SocCancelDetails.customer_id             → CustomerMasters.customer_id
SocCancelDetails.sale_order_header_id    → SaleOrderHdrs.header_id
SocCancelDetails.item_id                 → ItemMasters.item_id
DispatchDetails.sale_order_header_id     → SaleOrderHdrs.header_id
DispatchDetails.item_id                  → ItemMasters.item_id          (item actually shipped, differs from the order line on 7%)
```

Things to know:

- The dispatch date is `DispatchDetails.schedule_date`, stored as a date. `Dispatches.trx_date` is the invoice date.
- Cancelled dispatches: `Dispatches.despatch_status_id = 4` (InvoiceCancel) or `Dispatches.oracle_status = 'CANCELLED'`. Two different sets, no overlap.
- `Schedules.schedule_status_id` is not a clean open flag (92% sit at 6 SOCConfirmed even after dispatch). `SocPendingDetails` is the authoritative open book; `Schedules` gives the per line history.
- `Schedules.dispatched_quantity` is stale in crm and not loaded. Dispatched qty comes from `DispatchDetails` via `schedule_line_id`.
- `SocCancelDetails.close_reason_id` and `status_id` are codes with no master table in crm.
- A few hundred `DispatchDetails` rows have a blank `header_id` or `schedule_line_id`: their parent falls outside the parent's filter. They still join through the order line.

---

## CRM Quotation Data Model

The CRM Quotation data model consists of three main tables:

- QuotationStatus
- QuotationHdrs
- QuotationDtls

The logical business relationship is:

```text


                    ┌──────────────────┐
                    │  QuotationStatus │
                    │  21 rows:        │
                    │  Open / Approved │
                    │  Confirmed /     │
                    │  Closed / ...    │
                    │  pk: line_id     │
                    └────────▲─────────┘
                             │
                             │ status_id
                             │ N : 1
                             │
            ┌────────────────┴────────────────┐
            │                                 │
  ┌─────────┴─────────┐             ┌─────────┴─────────┐
  │   QuotationHdrs   │◄────────────│   QuotationDtls   │
  │   pk: header_id   │  header_id  │   pk: line_id     │
  │                   │    N : 1    │                   │
  └─────────▲─────────┘             └─────────▲─────────┘
            ┆                                 ┆
            ┆ quotation_line_id               ┆ quotationdtl_line_id
            ┆ soft link, no FK                ┆ soft link, no FK
            ┆ 100% match in CRM               ┆ 90% match in CRM
            ┆                                 ┆
  ┌─────────┴─────────┐             ┌─────────┴─────────┐
  │   SaleOrderHdrs   │             │   SaleOrderDtls   │
  └───────────────────┘             └───────────────────┘


  ───►  Enforced foreign key
  ┄┄►   Soft link — joinable but not enforced
```

The relationships represent:

- One `QuotationHdrs` has many `QuotationDtls` lines (avg 2.2, one per item).
- Every sale order comes from a quote: `SaleOrderHdrs.quotation_line_id` points at `QuotationHdrs.header_id` for all 1.1M orders. 92% of quotes convert.
- That link stays **soft** (no fk): orders are loaded for every segment, quotes only for Performance Chemicals, so most orders point at a quote that is not loaded. It becomes a hard fk only if orders get the same filter.
- `status_id` on both tables points at `QuotationStatus`. 96% of headers are `Closed` - a quote closes when it converts. `Open / Approved / Confirmed` is the live pipeline.
- `QuotationHdrs` and `QuotationDtls` are snapshot tables: lines with `creation_date >= 2021` and a Performance Chemicals item, plus the headers those lines point at. Reloaded in full every run because status moves after creation.
- `QuotationStatus` is incremental, level 0.

Links to the master tables:

```text
QuotationHdrs.collector_id       → Collectors.collector_id
QuotationHdrs.customer_id        → CustomerMasters.customer_id     (-1 = unknown, 153 zeros in crm)
QuotationHdrs.bill_to_site_id    → CustomerSites.site_use_id       (-1 = unknown site)
QuotationHdrs.ship_to_site_id    → CustomerSites.site_use_id       (-1 = unknown site)
QuotationHdrs.mc_code            → MarketCircles.mc_code           ('unknown' when blank, 2%)
QuotationDtls.item_id            → ItemMasters.item_id
QuotationDtls.delivery_from_id   → DeliveryFroms.line_id           (-1 = unknown, 587 zeros in crm)
```

Things to know:

- `customer_hdr_id` on the header is 0 or null on 92% of rows - use `customer_id`.
- ~60 columns on `QuotationHdrs` are export-only (98% null): ports, containers, fob values, bank, agent. Not loaded.
- `QuotationDtls.status_id` is 0 on 536 rows; loaded as null.
- `close_status_id` (0 / 1 / 2) has no master table in crm.

---

## CRM Business_Plan Data Model

The CRM Business Plan data model consists of four main tables:

- JourneyCalendars
- SCBusinessMonthlyPlanHdrs
- SCBusinessMonthlyPlanDtls
- SCBusinessMonthlyPlanJCDtls

The logical business relationship is:

```text
  ┌───────────────────────────┐
  │ SCBusinessMonthlyPlanHdrs │   annual plan: one row per customer x product x collector x year
  │ pk: header_id             │   potential, budget, avg price, jc1..jc13 status
  └─────────────▲─────────────┘
                │ header_id  (N : 1)
                │
  ┌───────────────────────────┐
  │ SCBusinessMonthlyPlanDtls │   the 13 JC plan for that line, stored WIDE by crm
  │ pk: line_id               │   (week1 / week2 qty & value, achieved, avg price, saved  x 13)
  └─────────────▲─────────────┘
                │ header_id  (N : 1)   ← misnamed in crm: it is Dtls.line_id, not the header
                │
  ┌───────────────────────────┐          ┌───────────────────────────┐
  │SCBusinessMonthlyPlanJCDtls│ jc_type  │     JourneyCalendars      │  13 journey cycles (JC1..JC13) per year,
  │ pk: line_id               │─────────►│     pk: line_id           │  ~4 weeks each, contiguous 2013-04-01 ..
  └───────────────────────────┘ (N : 1)  └───────────────────────────┘  2027-03-31. -1 = unknown
   rolling forecast: per plan line x journey cycle,
   qty expected next month and the month after

  ───►  enforced foreign key
```

The relationships represent:

- One `SCBusinessMonthlyPlanHdrs` (the annual plan for a customer / product / collector / year) has ~1.5 `SCBusinessMonthlyPlanDtls` rows - it should be 1, the extras are crm double inserts (see below).
- One `SCBusinessMonthlyPlanDtls` line has up to 13 `SCBusinessMonthlyPlanJCDtls` rows, one per journey cycle, holding the rolling next-month forecast.
- `SCBusinessMonthlyPlanJCDtls.jc_type` says which `JourneyCalendars` cycle the forecast was made in.
- `SCBusinessMonthlyPlanJCDtls.header_id` is **misnamed** in crm: it matches `SCBusinessMonthlyPlanDtls.line_id` (99.7%), not `SCBusinessMonthlyPlanHdrs.header_id` (47%, coincidence). The fk goes to the detail line.
- The plan has **no item_id**. It is keyed on `item_description` (product name) + `category_id`. That pair maps to exactly one `ItemMasters` row only 29% of the time (58% several pack sizes, 13% none). Plan vs actual needs a product-name rule in the views.
- No Performance Chemicals filter is needed: "SC" is the PC plan (its divisions are exactly the PC `segment2` values). GC / PC plans live in other crm tables.
- `JourneyCalendars` is incremental (never edited). The three plan tables are snapshot: jc status, plans and forecasts move after creation.

Links to the master tables:

```text
SCBusinessMonthlyPlanHdrs.customer_id      → CustomerMasters.customer_id     (-1 = prospect, crm has 0)
SCBusinessMonthlyPlanHdrs.collector_id     → Collectors.collector_id
SCBusinessMonthlyPlanHdrs.bill_to_site_id  → CustomerSites.site_use_id       (empty on 53%, crm stopped filling it from 2024-25)
SCBusinessMonthlyPlanDtls.customer_id      → CustomerMasters.customer_id     (-1 on 38%, prefer the header's customer)
SCBusinessMonthlyPlanDtls.collector_id     → Collectors.collector_id
SCBusinessMonthlyPlanHdrs.category_id        ItemCategories.category_id      (soft, not unique there)
SCBusinessMonthlyPlanHdrs.new_customer_marketcircle  MarketCircles.mc_code   (soft, prospects only, 'unknown' when not a circle)
```

Things to know:

- **Prospects**: 9,624 headers have `customer_id = 0` in crm - customers not yet in `CustomerMasters`. They load as `-1` with `is_new_customer = true`, the name in `new_customer_name` and the circle in `new_customer_marketcircle`.
- **Duplicates**: a third of `SCBusinessMonthlyPlanDtls` (107k of 312k rows) are exact copies - same header, product and all 13 JC plans; one header has 4,443 identical lines. Also 2,606 duplicate header groups. Loaded as-is because `JCDtls` points at individual line ids. Dedupe in the views.
- **Empty plans**: 86% of detail lines have all 26 week quantities at 0 and 87% of forecast rows are 0 / 0. crm creates a row for every header whether or not anything was planned. Filter in the views.
- **Value columns are user typed in mixed units** (`jcN_weekN_user_dfn_value`: rupees on some rows, lakhs or ratios on most). Use `qty x jcN_user_dfn_avg_sell_price` instead.
- `jcN_status` (1 .. 6) has no master table in crm; 1 and 4 cover 96%. `jcN_qty_achieved` is sparse - actuals come from `DispatchDetails`.
- All measures are float32 in crm (`real`), stored as double precision. Expect float artefacts like `0.20000000298`.
- 2,744 forecast rows point at plan lines crm has deleted (loaded with `header_id` null); 7,888 carry `jc_type = 0` (loaded as `-1`); 123 have an `acc_year` that disagrees with the cycle's year.
- `creation_date` is empty on 43% of headers (all of 2020-22). `acc_year` is the reliable time key.

---

## CRM Purchase_Master Data Model

The CRM Purchase data model consists of four main tables:

- ApSuppliers
- PurchaseRequisitionHdrs
- PurchaseRequisitionDtls
- BiPoDetails

The logical business relationship is:

```text
  ┌───────────────────────────┐
  │       ApSuppliers         │   oracle vendor master, 24k rows, ~3k ever used
  │       pk: vendor_id       │   (the rest are employees, transporters, tax authorities)
  └──────▲─────────────▲──────┘
         │ supplier_id │ vendor_id
         │ (N : 1)     │ (N : 1)
  ┌──────┴────────────┐│
  │PurchaseRequisition││        what was ASKED for (crm)
  │Hdrs  pk: header_id││
  └──────▲────────────┘│
         │ header_id   │
         │ (N : 1)     │
  ┌──────┴────────────┐│       ┌───────────────────────────┐
  │PurchaseRequisition│┆       │       BiPoDetails         │  what oracle actually ORDERED
  │Dtls  pk: line_id  │┆       │       pk: id (ours)       │  nightly extract, every approved po line since 2018
  └───────────────────┘┆       └─────────────▲─────────────┘
         ┆ po_line_id  ┆                     │
         ┆ soft link   ┆─────────────────────┘
         ┆ (po_line_id is not unique in BiPoDetails, 402 dups)
         ▼
  BiPoDetails.po_line_id

  ───►  enforced foreign key        ┄┄►  soft link, joinable but not enforced
  both PurchaseRequisitionDtls and BiPoDetails also point at ItemMasters (item_id / inventory_item_id)
```

The relationships represent:

- One `PurchaseRequisitionHdrs` (who / from whom / where to) has ~2 `PurchaseRequisitionDtls` lines (item, qty, price, and the stock / price context crm captured at that moment).
- A requisition line, once approved, becomes an oracle po line: `PurchaseRequisitionDtls.po_line_id` → `BiPoDetails.po_line_id` on 89% of lines (the rest are drafts / rejected). Soft link, because `po_line_id` is not unique in the extract and `BiPoDetails` is regenerated every night.
- `BiPoDetails` is the open-purchase source: `quantity - quantity_received - quantity_cancelled` is what is still in transit (36k lines).
- `ApSuppliers` is the vendor master for both: `BiPoDetails.vendor_id` (100%) and `PurchaseRequisitionHdrs.supplier_id` (all but 178 drafts).
- `ApSuppliers` is upsert (rows change - msme status, holds). The three others are snapshot: `BiPoDetails` because its `header_id` restarts from 1 every night (we use our own `id`), the requisition tables because status and the po link move after creation.

Links to the master tables:

```text
BiPoDetails.inventory_item_id            → ItemMasters.item_id           (100%)
BiPoDetails.vendor_id                    → ApSuppliers.vendor_id         (100%)
PurchaseRequisitionHdrs.supplier_id      → ApSuppliers.vendor_id         (null on 178 drafts, crm has 0)
PurchaseRequisitionHdrs.collector_id     → Collectors.collector_id       (null on 48%: raised centrally, crm has 0)
PurchaseRequisitionDtls.item_id          → ItemMasters.item_id           (100%)
PurchaseRequisitionDtls.customerid       → CustomerMasters.customer_id   (null on 78%: not customer specific)
PurchaseRequisitionDtls.soccollectorid   → Collectors.collector_id       (null on 78%)
```

Things to know:

- Filters: `BiPoDetails` is cut to performance chemicals items (68k of 169k). Requisitions need no filter - every one is PC.
- `BiPoDetails.header_id` is not loaded: crm reassigns it from 1 on every nightly regeneration. `po_line_id` is the stable oracle id.
- `BiPoDetails.purchase_category` is `'0'` on 37% (older pos, before the field existed). `procurement_type` is the reliable classifier.
- 8% of po lines are over-received (`received + cancelled > quantity`) - tolerance receipts, real. Pending qty = `greatest(quantity - received - cancelled, 0)`.
- `PurchaseRequisitionHdrs.conversion_type` is misnamed: it is the conversion rate (0 on domestic rows). `status` (text) is always empty, `status_id` has no master: 6 = approved (91%), 7 = rejected, 0 = draft.
- `PurchaseRequisitionDtls.stock_days` is absurd on 359 rows (crm divide by zero): treat `> 3650` as no sales. `category_id` is the item's category at request time and differs from today's on 16% - it is history, keep it.
- `ApSuppliers` msme data lives in oracle dff columns: `attribute8` registered, `attribute9` class, `attribute10` type, `attribute11` udyam number. `terms_id` is a float in oracle.
- Zeros in `collector_id` / `customerid` / `soccollectorid` / `supplier_id` mean "not applicable", not "unknown" - loaded as null, no `-1` rows.

## CRM Inventory_Master Data Model

The CRM Inventory data model consists of these tables:

- InventoryOrgs (replaced `InventoryOrgLocations`: same 186 warehouse ids, but clean and with name / city / state / active flag)
- BiStockDetail
- ItemInventoryOrgMappings (which item may be stocked at which warehouse)
- BiCollectorInventoryOrgMapping (which warehouses a branch is configured to draw from)

The logical business relationship is:

```text
          Collectors.collector_id
                ▲
                │ collector_id  (home collector, 103 of 186, null when crm has 0)
  ┌───────────────────────────┐
  │       InventoryOrgs       │   warehouse master, 186 rows. inventory_org_id is the key every
  │   pk: inventory_org_id    │   fact table carries (orders, dispatch, schedules, pos, requisitions,
  │                           │   stock). -1 = unknown. name, city, state, is_active, plant / port flags
  └─────────────▲─────────────┘
                │ inventory_org_id  (N : 1)
                │
  ┌───────────────────────────┐
  │       BiStockDetail       │   daily on-hand stock per warehouse x item x sub-inventory x lot.
  │       pk: header_id       │   31M rows in crm since 2020 (~36k a day), we load performance
  └─────────────┬─────────────┘   chemicals from 2024-01-01, incremental by header_id
                │ item_id  (N : 1)
                │ not in crm: filled on stage from item_code, latest ItemMasters id per code, -1 if none
                ▼
          ItemMasters.item_id
                ▲
                │ item_id  (N : 1)
  ┌───────────────────────────┐
  │ ItemInventoryOrgMappings  │   which item may be stocked at which warehouse, one row per pair.
  │       pk: header_id       │   225k PC pairs (15,637 items x 177 warehouses, avg 14 warehouses an
  │ unique: item_id +         │   item). enabled_flag N = not allowed. the planning universe: every
  │         inventory_org_id  │   stock row today but one sits on a mapped pair
  └─────────────┬─────────────┘
                │ inventory_org_id  (N : 1)
                ▼
          InventoryOrgs.inventory_org_id
                ▲
                │ inventory_org_id  (N : 1)
  ┌───────────────────────────┐
  │BiCollectorInventoryOrgMapp│   which warehouses a branch is configured to draw from. 422 pairs,
  │       pk: header_id       │   60 of 129 collectors, 71 warehouses. not the whole truth: 30
  │ unique: collector_id +    │   collectors with 2025+ orders have no row. who actually ships to
  │         inventory_org_id  │   whom is DispatchDetails.inventory_org_id
  └─────────────┬─────────────┘
                │ collector_id  (N : 1)
                ▼
          Collectors.collector_id

  ───►  enforced foreign key
```

The relationships represent:

- One warehouse (`InventoryOrgs`) has many stock rows per day: one `BiStockDetail` row per item x sub-inventory x lot, each day. `stock_id` / `header_id` are new every day, so the same lot appears once per snapshot day.
- crm gives `BiStockDetail` **no item id**, only `item_code`, and `item_code` is not unique in `ItemMasters` (3 codes carry two ids, one of them referenced by an order line, so the master cannot simply be made unique on code). Our table therefore adds `item_id` itself: a stage fix looks the code up in `ItemMasters` (latest id per code) and the column is a hard fk to `ItemMasters.item_id`, `-1` (the unknown item seed) when nothing matches. All 5,475 codes in stock match exactly one id today, so `BiStockDetail` joins every other fact on `item_id` like the rest of the model. `DERIVED_COLUMNS` in `utils.py` tells the loader to copy such columns from stage even though they are not read from crm.
- `InventoryOrgs` is upsert (master). `BiStockDetail` is incremental by `header_id` - rows are appended daily and never edited - and it is the first **large table**: read in parallel pk ranges (`LARGE_TABLES`, 250k ids per range, 4 workers), the watermark only advances over contiguous good ranges.
- `ItemInventoryOrgMappings` is the item x warehouse universe: one row per pair, `enabled_flag` says whether the item may be stocked there, `internal_order_enabled_flag` whether it may be transferred in. crm edits the flags (~1,400 rows a month) **and deletes rows** (187 gaps in `header_id`), so it is a snapshot, PC items only. One pair in crm appears twice (item `509454` at two warehouses, identical rows) - the later copy is dropped on stage and `(item_id, inventory_org_id)` is unique in our table.
- `BiCollectorInventoryOrgMapping` is the branch to warehouse bridge - but a configured one, not an observed one: 60 of 129 collectors have rows, 30 collectors that booked orders in 2025+ have none, and it agrees with the warehouse's own `collector_id` on only 47 of 103. crm re-inserts a pair with a new `startdate` instead of editing it and never sets `EndDate` (1 row in 496), so 67 pairs sit there 2-3 times: the original row is kept, 74 copies dropped on stage, `(collector_id, inventory_org_id)` unique. Snapshot, rows get deleted (75 gaps). A row whose branch or warehouse is missing is dropped rather than pointed at `-1` - `Collectors` has no unknown row and a bridge row without both ends means nothing.
- Eight already loaded tables carry the warehouse id and hold a hard fk to this master: `SaleOrderDtls`, `Dispatches`, `Schedules`, `SocCancelDetails`, `DispatchDetails`, `QuotationDtls` (`inventory_org_id`), `BiPoDetails` (`inv_org_id`), `PurchaseRequisitionHdrs` (`ship_to_inv_org_id`, `bill_to_inv_org_id`). All matched 100% except 4,591 `SaleOrderDtls` lines carrying `0` -> `-1`. The fks were added to the loaded tables with a one-time alter (`wire_warehouse_fk.sql`); the models carry them for any rebuild.

Links to the master tables:

```text
BiStockDetail.inventory_org_id           → InventoryOrgs.inventory_org_id   (100%, -1 if ever missing)
SaleOrderDtls / Dispatches / Schedules / SocCancelDetails / DispatchDetails / QuotationDtls .inventory_org_id
BiPoDetails.inv_org_id, PurchaseRequisitionHdrs.ship_to_inv_org_id / bill_to_inv_org_id
                                         → InventoryOrgs.inventory_org_id   (100%, SaleOrderDtls 0 -> -1)
BiStockDetail.item_id                    → ItemMasters.item_id                     (derived from item_code on stage, 100%, -1 if none)
InventoryOrgs.collector_id               → Collectors.collector_id                  (103 of 186, null when crm has 0)
ItemInventoryOrgMappings.item_id         → ItemMasters.item_id                      (100%)
ItemInventoryOrgMappings.inventory_org_id→ InventoryOrgs.inventory_org_id           (100%)
BiCollectorInventoryOrgMapping.collector_id      → Collectors.collector_id          (100%, row dropped if ever missing)
BiCollectorInventoryOrgMapping.inventory_org_id  → InventoryOrgs.inventory_org_id   (100%, row dropped if ever missing)
```

Things to know:

- `BiStockDetail` is 73% of everything in crm and has **no index on `sync_date`**: any date filter on the source is a 31M row scan. `header_id` is the clustered key and monotonic with `sync_date` (a new day starts at a higher id), so all access goes through `header_id` ranges; the date and item filters are applied inside each range.
- Filter: `trans_date >= 2024-01-01` and performance chemicals item codes. ~31% of each day is PC (11,400 of 36,530 rows on 2026-09-18). Moving the start date is one string in `SOURCE_FILTERS` plus a reset of the table's `crm_sync_metadata` row.
- `TypeOfTrx` tags the snapshot day: `DailyBasics`, `FRIDAY`, `FIRST_DAY` (of month), `JC_START_DATE`; empty before 2023. Views can pick a weekly or month-start series from it without re-loading.
- `trans_date` is the snapshot day, `sync_date` the time crm pulled it, `aging_date` the lot's receipt date (`age = trans_date - aging_date`). `opening_qty` is on hand that day, `ITEM_COST` the unit cost (`transaction_cost` is 94% empty and not loaded).
- `InventoryOrgs` is clean: 186 rows, id / code / name all unique, no nulls. crm rewrites the whole table (185 rows carry the same creation timestamp), so its dates are not loaded and the table is upsert. `is_active` is informational only - 4 of the 129 warehouses holding stock today are flagged inactive. `location_id` there does **not** match the 35 row city master (different id space), city and state are on the row as text instead.
- We first loaded `InventoryOrgLocations` (188 rows, one null id, one duplicate, a comma separated `collector_ids` string) and swapped it for `InventoryOrgs` once we saw both carry the same 186 ids. The branch to warehouse mapping now comes from `BiCollectorInventoryOrgMapping` instead of splitting a string.
- Today's stock position = rows where `trans_date = max(trans_date)`; the history gives the stock trend.

---

| Level | Table | PK | Mode | Filter | Stage fixes | Seed | Children |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 0 | Collectors | `collector_id` | upsert | – | – | – | MarketCircles, CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails, InventoryOrgs |
| 0 | CustomerMasters | `header_id` | upsert | – | `0` → NULL on customer_id, customer_number | `unknown` (-1) | CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails |
| 0 | ItemMasters | `item_id` | upsert | – | – | `unknown` (-1) | ItemCategories, PurchaseRequisitionPtoPts, SaleOrderDtls, Schedules, SocCancelDetails, DispatchDetails, QuotationDtls, BiPoDetails, PurchaseRequisitionDtls, BiStockDetail |
| 0 | DeliveryFroms | `line_id` | upsert | – | – | `unknown` (-1) | SaleOrderDtls, QuotationDtls |
| 0 | QuotationStatus | `line_id` | upsert | – | – | – | QuotationHdrs, QuotationDtls |
| 0 | JourneyCalendars | `line_id` | upsert | – | – | `unknown` (-1) | SCBusinessMonthlyPlanJCDtls |
| 0 | ApSuppliers | `vendor_id` | upsert | – | – | – | BiPoDetails, PurchaseRequisitionHdrs |
| 1 | MarketCircles | `header_id` | upsert | – | lower/trim | `unknown` (-1) | CustomerSites, SaleOrderHdrs, … |
| 1 | ItemCategories | `header_id` | upsert | PC only | drop orphans | – | – |
| 1 | PurchaseRequisitionPtoPts | `Header_id → header_id` | incremental | – | – | – | – |
| 1 | InventoryOrgs | `inventory_org_id` | upsert | – | collector `0` → NULL | `unknown` (-1) | BiStockDetail, SaleOrderDtls, Dispatches, Schedules, SocCancelDetails, DispatchDetails, QuotationDtls, BiPoDetails, PurchaseRequisitionHdrs |
| 2 | BiPoDetails | `id` (ours) | snapshot | PC item | – | – | – |
| 2 | PurchaseRequisitionHdrs | `header_id` | snapshot | – | collector `0` → NULL, supplier `0` → NULL | – | PurchaseRequisitionDtls |
| 2 | CustomerSites | `line_id` | upsert | – | lower/trim + `unknown`, drop duplicate site_use_id | `unknown` (-1) | SaleOrderHdrs, Dispatches, Schedules, … |
| 2 | BiStockDetail | `header_id` | incremental, **large** (pk ranges, 4 workers) | trans_date ≥ 2024 and PC item code | warehouse not in master → `-1`; `item_id` derived from item_code (latest ItemMasters id per code), `-1` if none | – | – |
| 2 | ItemInventoryOrgMappings | `header_id` (unique item_id + inventory_org_id) | snapshot | PC item | drop duplicate pair (keep lowest header_id); item / warehouse not in master → `-1` | – | – |
| 2 | BiCollectorInventoryOrgMapping | `header_id` (unique collector_id + inventory_org_id) | snapshot | – | drop re-inserted pairs (keep lowest header_id); drop row if collector / warehouse not in master | – | – |
| 3 | PurchaseRequisitionDtls | `line_id` | snapshot | – | customer / collector `0` → NULL, po_line_id `0` → NULL, blank header_id if not loaded | – | – |
| 3 | SaleOrderHdrs | `header_id` | incremental | – | missing site → `-1` on bill_to / ship_to | – | SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails |
| 3 | QuotationHdrs | `header_id` | snapshot | headers the loaded QuotationDtls point at | customer / sites `0` → `-1`, mc_code lower/trim + `unknown` | – | QuotationDtls |
| 3 | SCBusinessMonthlyPlanHdrs | `header_id` | snapshot | – | customer `0` → `-1`, wrong site → `-1` (NULL kept), new_customer_marketcircle lower/trim + `unknown` | – | SCBusinessMonthlyPlanDtls, SCBusinessMonthlyPlanJCDtls |
| 4 | SaleOrderDtls | `line_id` | incremental | – | `CLOSE` → `Closed`, delivery point `0` → `-1` | – | Schedules, SocCancelDetails, DispatchDetails |
| 4 | SocPendingDetails | `id` (ours) | snapshot | – | lower/trim + `unknown` on market_circle | – | – |
| 4 | Dispatches | `header_id` | snapshot | headers the loaded DispatchDetails point at | – | – | DispatchDetails |
| 4 | QuotationDtls | `line_id` | snapshot | creation_date ≥ 2021 and PC item | delivery point `0` → `-1`, status `0` → NULL, junk date → NULL, blank header_id if not loaded | – | – |
| 4 | SCBusinessMonthlyPlanDtls | `line_id` | snapshot | – | customer `0` → `-1`, blank header_id if not loaded | – | SCBusinessMonthlyPlanJCDtls |
| 5 | Schedules | `line_id` | snapshot | schedule_date ≥ 2021 and PC item | junk dates → NULL, site `0` → `-1` | – | DispatchDetails |
| 5 | SocCancelDetails | `header_id` | incremental | creation_date ≥ 2021 and PC item | – | – | – |
| 5 | SCBusinessMonthlyPlanJCDtls | `line_id` | snapshot | – | jc_type `0` → `-1`, blank header_id (= Dtls.line_id) if not loaded | – | – |
| 6 | DispatchDetails | `line_id` | snapshot | schedule_date ≥ 2021 and item_segment = PC | junk date → NULL, blank header_id / schedule_line_id if parent not loaded | – | – |

Snapshot = wiped and reloaded in full every run (rows change after creation in crm). Incremental = `pk > last loaded pk`, rows never change. Upsert = masters: read in full every run and merged on the pk, never truncated (children point at them), so a lead that becomes a customer or a site that moves circle is picked up.
Parents load before children (levels). If a child arrives before its parent (crm moved on during the run), incremental tables hold the row back until the next run; snapshot tables blank the fk and the next full reload fixes it.
Large = an incremental table too big for one read (`LARGE_TABLES`): the pk span is split into ranges of `RANGE_ROWS` ids, `INNER_WORKERS` processes each read one range with its own crm connection and commit it on its own. The watermark moves only over contiguous good ranges, so a failed range is re-fetched next run and rows loaded above it are absorbed by `ON CONFLICT DO NOTHING` - no gaps, no duplicates.
