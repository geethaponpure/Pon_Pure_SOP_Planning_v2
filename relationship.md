# CRM Data Model

## CRM Customer_master Data Model

The CRM data model consists of six tables:

- `Collectors`
- `MarketCircles`
- `CustomerSites`
- `CustomerMasters`
- `tempcustomers` (the lead's details: branch, circle, industry segment - leads have no sites)
- `ArCustomers` (oracle's customer record: legal form, industrial segment, division, oracle's circle)

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

Things to know:

- **A customer is either a real customer or a lead.** A real customer has an oracle `customer_id`, sites, and a row in `ArCustomers`. A lead has none of those: its branch, circle, industry segment and address live in `tempcustomers`. About half of `CustomerMasters` are leads; every blank `status` is a lead.
- **Territory belongs to the site, not the customer.** A customer's sites can sit in several circles and even several branches. crm's own "which branch is this customer in" rule (`FN_Customer_GetCollectorName` / `FN_Customer_GetMCCode`): a real customer → any active BILL_TO site's `collector_id` / `mc_code` (`TOP 1`, unordered); a lead → `tempcustomers`. The bill-to and ship-to circles agree on almost every order, and the order's branch is the ship-to site's branch on 96%.
- **`CustomerSites.collector_id` is the site's own branch** (set on bill-to sites, null on ship-to). It usually equals the circle's branch, but not always: retired sites are parked on a branch named `OBSOLETE` (13085) while their circle still points at the real branch, and some sites in the `unknown` circle still carry a real branch. Views take the site's branch first, the circle's as fallback.
- **`primary_flag` is not one per customer** - a customer can have many primary active bill-to sites (almost always in the same circle). Any "home site" needs a tie break.
- **Marketplace channels are customers with thousands of sites** (`SALES THROUGH FLIPKART`, `... AMAZON`, `FREE SAMPLE SALES`): every consumer address became a site. Real, active, ordering.
- **`customergroup` is not a group** - nearly unique per customer, a second name.
- **`MarketCircles.region`** is clean only for SOUTH / WEST / NORTH / EAST; the international circles (`int1-01` ..), `job01`, `map01`, `kan01` carry `'1'`, blank or null. `ECO` is e-commerce.
- **34 branches own no circle**: export and special channels (INTERNATIONAL, EXPORTS, country branches, OBSOLETE, CONSIGNMENT ..), the GROUP COMPANY channel (huge order count, not a territory - crm's own sales rules exclude it), and retired or never used branch records (DELHI, MUMBAI, TIRUPPUR-I/II .. with old orders; DELHI-NCR, RAJKOT .. with none). All 129 are kept because history points at them.
- `ArCustomers.attribute2` is the circle oracle holds for the customer (upper case), `attribute4` the industrial segment (TRADER, PAINT & COATINGS, TEXTILE, PHARMA ..), `attribute6` the division (General Chemicals / Performance Chemicals / NPD / Packing Materials).

Links to the master tables:

```text
CustomerSites.header_id                  → CustomerMasters.header_id
CustomerSites.mc_code                    → MarketCircles.mc_code                    ('unknown' when blank / no match)
CustomerSites.collector_id               → Collectors.collector_id                  (bill-to sites only, null on ship-to)
MarketCircles.collector_id               → Collectors.collector_id
tempcustomers.header_id                  → CustomerMasters.header_id                (unique: 27 leads had two rows, latest kept; rows of deleted leads dropped)
tempcustomers.collector_id               → Collectors.collector_id                  (null when crm has 0)
tempcustomers.market_circle              → MarketCircles.mc_code                    (lower / trim, 'unknown' when blank)
ArCustomers.customer_id                  → CustomerMasters.customer_id              (unique, one per real customer)
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

Things to know:

- `ItemCategories` holds Performance Chemicals products only (15.6k of 26k). Orders are placed on the other products too, so a product without a category row is a real, non PC product - not a missing row.
- crm's own "usable product" test is `status = 'Active'` **and** `enabled_flag = 'Y'` (119 products are disabled while still active).
- `PurchaseRequisitionPtoPts` is written on the 1st of every month by `SpSyncPoRequisitionPtoPts` from the trailing 6 months of invoice lines (`PureGPReports`, not loaded): fewer than 5 customers, or one customer with 70%+ of the quantity (80% before Jul 2023) → PTO, otherwise PTS. `types` says which pass a row is from - the product's own sales (`PTO` / `PTS` / `PTS70%`) or the raw material pass (`RPTO` / `RPTS` / `RPTS70%`), so one item can have two rows a month. A product with no sales in the window has no row; crm's screen (`fn_GetPTOPTSItemsPC`) then shows PTO. May 2022 is missing, Dec 2025 has no raw material rows. `dim_item` mirrors the screen and also exposes the last measured class.

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
- Scope: `SaleOrderDtls` and `SocPendingDetails` are loaded for Performance Chemicals products only (load filter on the item), like dispatch, quotes and stock. `SaleOrderHdrs` stays complete on purpose - it is incremental, and a header that gets a PC line added later would otherwise be missing when that line arrives.

Things to know (confirmed with the crm team, sep 2026):

- **Transaction types.** `Taxable Intra / Inter State` are customer sales. **`Cogt`** is one too - it is Color Chemicals & Dyes LLP's own manufactured textile chemicals sold to third party customers (normal margins, GST, credit terms, dispatched from CCL's warehouses); crm never treats it differently from Taxable, so neither do we. **`BTS` / `HSS`** = Bond Transfer Sales / High Seas Sales: imports sold before customs clearance, tax free, dispatched from port orgs, never touching branch stock; about 40% go to group entities. `Sample`, `Stock Transfer`, `Job Work` are not sales. The mapping lives in the view `v_transaction_type` (`order_kind`, `is_sale`, `is_demand`) and is reused by every fact.
- **`total_sales_price` is not a usable value.** Set once at order entry and never touched again: tax inclusive on some screens (× 1.18 / 1.12 / 1.05), stale when the quantity was edited, 0 on the Dec-2019 migration batch. `unit_price` is the stable fact - identical on the order line, the schedule and the dispatch - so value = `quantity × unit_price` (tax exclusive). Authoritative invoiced revenue lives in `PureGPReports` (not loaded).
- **`unit_price = 0` is structural.** Almost all of it is the GROUP COMPANY branch (supplies to group entities at a transfer price crm never receives; 30% of the open book) and marketplace orders (the price lives in the marketplace feed). Never back filled. The views flag these as `is_inter_company` / `is_ecommerce`.
- **`status` is not the open book.** crm keeps a line `OPEN` until someone closes it (hundreds of thousands of delivered lines are still OPEN). Pending = OPEN **and** a balance left after schedules and dispatches - exactly what crm's daily `SPPendingOrderDtlforUsers` writes into `SocPendingDetails` (bulk counts as done at 95%). Our incremental copy never re-reads a line, so old `OPEN` values drift from crm - harmless, nothing derives pending from them.
- crm has a **PC Projection** module (`SP_PCProjectionReport`, `SCBusinessPlanProjections`, `FN_PCProjection_GetOpenSOCQuantity` = `schedule_quantity - dispatched` on schedules not cancelled with the line OPEN). It combines the business plan, open SOC, confirmed quotes and open leads - to be read end to end with the business_plan cluster.

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
- `SocCancelDetails.close_reason_id` → `Reasons.header_id` (crm's shared reason lookup, loaded; module `Initiate Close`: Incorrect SOC Details, Duplicate SOC, Order Lost, Partial Quantity, Amended PO ..). `status_id` is crm's `ApprovalStatus`: 6 Approve, 7 Reject, 8 Referback, -1 Awaiting, 0 draft - decoded in the views, not loaded.
- Status codes (decoded in the views): `Dispatches.despatch_status_id` = `DispatchStatus` (1 Pending, 2 Confirmed, 3 MoveToOracle = invoiced, 4 InvoiceCancel); `Schedules.schedule_status_id` = `ScheduleStatus` (1 Pending, 2 ReSchedule, 3 Reject, 4 Confirmed, 5 Closed, 6 SOCConfirmed, 7 Cancelled).
- **Dispatched means confirmed.** crm's own rule (`fn_SOCScheduleQty`): a dispatch counts when `despatch_confirm_flag = 'Y'` and the note is not cancelled (status 4, or `oracle_status = 'CANCELLED'` - two different sets). The flag is loaded; `Y` on almost all, `C` on a few hundred, null on the rest.
- **The schedule-line open book** (crm's `FnScheduleDtlPending` / `SpSyncSocPendingOrder_Forecasting`): balance = `schedule_quantity` − confirmed dispatches on the schedule line; open when the order line is OPEN, the schedule is not Reject / Closed / Cancelled and a balance is left; effective date = `reschedule_date` when set. For open *demand* crm also drops GROUP COMPANY and lines with a pending cancellation. `fact_schedule_line` rebuilds this from the tables.
- Dispatch value is clean on this cluster (`total_value = quantity × unit_price` on every line), unlike the order tables. The dispatched item differs from the ordered item on a few percent of lines (substitutions) - the dispatch carries what actually shipped.
- `Schedules.reschedule_date` is filled on every row (equal to the schedule date when never moved); `reschedule_reason` is text, with `0` and blank as junk.
- crm's "despatch performance" report (`FnDespatchPerformanceHdr`) is about freight / LR confirmation (`InvoiceFreightHdrs`, not loaded), a logistics KPI - not on-time delivery. On-time here = first confirmed dispatch vs `customer_requested_date`.
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

## CRM User_and_Scope Data Model

The CRM user / scope data model consists of these tables:

- Users
- Roles
- UserRoles
- UserMarketCircleMappings (a sales executive's territory, with history)
- UserCollectorMappings (which branches a back office user may see)
- UserCustomerMappings (a technical executive's customer portfolio)
- CollectorMailMappings (one row per branch: its management chain)
- TechnicalUserSegmentMappings (technical managers / heads -> item segments and branch lists)

SpAlertSegmentWorkflowHdrs / Dtls (approval routing config) were looked at and left out: workflow, not scope, and their user / segment links are partly broken.

The logical business relationship is:

```text
  ┌───────────────────────────┐
  │           Roles           │   job roles, 108 rows: Sales Executive (256 users), Technical Executive (138),
  │        pk: line_id        │   Branch Manager (79), Technical Manager (72) .. is_deleted on 1 (still used)
  └─────────────▲─────────────┘
                │ role_id  (N : 1)
  ┌───────────────────────────┐
  │         UserRoles         │   one row per user, exactly one role. 1,365 rows (5 users have none).
  │        pk: line_id        │   is_sap_data = the role came from the sap sync (330)
  │      unique: user_id      │
  └─────────────┬─────────────┘
                │ user_id  (1 : 1)
                ▼
  ┌───────────────────────────┐
  │           Users           │   everyone with a crm login, 1,370 rows. 1,217 active, 163 dummies,
  │        pk: line_id        │◄──┐ 548 logged in the last 90 days. username is the identity
  │     index: username       │   │ (unique but for one dummy). reporting_to_id = the manager,
  └──────▲─────────────▲──────┘───┘ a self link, 1,002 of 1,370
         │ user_id      │ user_id
         │              │
  ┌──────┴────────────┐ └──────────────────────────┐
  │ UserMarketCircle  │                  ┌─────────┴──────────────┐
  │     Mappings      │                  │ UserCollectorMappings  │
  │   pk: header_id   │                  │     pk: header_id      │
  └──────┬────────────┘                  │ unique: user_id +      │
         │ market_circle_id              │         collector_id   │
         ▼                               └─────────┬──────────────┘
  MarketCircles.header_id                          │ collector_id
                                                   ▼
  273 rows / 260 users, 241 of them            Collectors.collector_id
  Sales Executives. valid_from / valid_to:
  a re-assignment closes the old row and     9,046 rows in crm -> 8,668 pairs / 202 users,
  opens a new one, so a (user, circle)       avg 44 branches each, 18 users on 100+ (= all).
  pair can repeat - that is history, kept    back office roles: coordinators, accounts,
                                             commercial managers. no dates, no history

  ┌───────────────────────────┐   a technical executive's customer portfolio. 16,485 rows in crm
  │   UserCustomerMappings    │   -> 16,025 pairs / 99 users, avg 163 customers, max 1,046.
  │       pk: header_id       │   user_id -> Users, customer_hdr_id -> CustomerMasters.header_id
  │ unique: user_id +         │   (crm's customer_id column is stale, not loaded).
  │         customer_hdr_id   │   valid_to null = current (all but 125)
  └───────────────────────────┘

  ┌───────────────────────────┐   one row per branch, 129 = all collectors. the management chain
  │   CollectorMailMappings   │   as six user ids: bm (branch manager, 70), rm (regional, 84), cm (94),
  │       pk: header_id       │   bc (104), ed (95), gm (76) -> Users, null = nobody. 38 branches have
  │   unique: collector_id    │   neither bm nor rm. coordinator_user_id is text (ids or a comma list)
  └───────────────────────────┘

  ┌───────────────────────────┐   technical managers (278 rows) / heads (50) -> item segments.
  │ TechnicalUserSegmentMappi │   72 users, up to 35 rows each. segment2/3/4 are text and match
  │       pk: line_id         │   ItemCategories (soft). collector_id is text: a comma list (167),
  │                           │   one id (96), '0' (14) or null (51). user_id, reporting_user_id -> Users,
  └───────────────────────────┘   role_id -> Roles. valid_to null = current (254)

  ───►  enforced foreign key
```

The relationships represent:

- Every user has exactly one role, so `UserRoles` is a 1:1 bridge; a view can put the role name straight on the user. The bridge is kept because crm stores it that way and roles do change (110 changes on record).
- `Users.reporting_to_id` is the manager - a self reference. crm has 0 or a deleted user on 368 rows, those become null.
- **Scope is not on `Users`.** `Users.collector_id` is 0 on every row. Which circle / branches / customers / item segments a user may see lives in four separate mapping tables, each for a different role group.
- `UserMarketCircleMappings` is the Sales Executive's territory: 1 circle (max 3), `is_primary` on 245. It carries **history**: a re-assignment to the same circle closes the old row (`valid_to`) and opens a new one, so 7 (user, circle) pairs appear 2-3 times with chained periods. Nothing is deduped; "current" = `valid_to` null or in the future (237 rows), the 36 closed rows are past territories.
- `UserCollectorMappings` is a permission list for back office roles, not a territory: 202 users, avg 44 branches each, 18 users mapped to 100+ branches. crm holds the same pair up to 48 times (inserted in the same second) - 378 copies dropped on stage, 8,668 pairs kept, `(user_id, collector_id)` unique. 1,027 active users have no row here, so it never answers "which branch is this user in".
- `UserCustomerMappings` is the Technical Executive's portfolio (83 of 101 users are TEs). 228 (user, customer) pairs sit there 2-3 times, all open, just re-inserted on a later date - unlike the circle mappings these are copies, not history: 336 dropped on stage, `(user_id, customer_hdr_id)` unique. 120 rows belong to 2 users crm has deleted and 4 have no customer, dropped. crm's `customer_id` column disagrees with the customer master on 400 rows and its 0 collides with every lead, so it is not loaded; `customer_hdr_id` is the link.
- `CollectorMailMappings` is the branch org chart: one row per collector with the management chain as user ids (`bm` / `rm` / `cm` / `bc` / `ed` / `gm`), every filled id a real user, null = nobody assigned. Role-checked: `bm` is a Branch Manager on 61 of 70, `rm` a Regional Manager on 69 of 84. 38 branches have neither. For "which branch does this manager own" this table is the answer; `Users.collector_id` never is.
- `TechnicalUserSegmentMappings` scopes technical people by product: `segment2/3/4` are text and match `ItemCategories` (100% / 100% / 283 of 285) - a soft link because the category table has no segment key. `collector_id` is a comma-separated list stored as text. The same (user, segments) can appear on several rows with different branch lists - that is a split, not a duplicate; the only 6 exact copies are all expired and left alone.
- All five mappings are snapshots (rows get deleted in crm) and drop any row whose user / circle / branch / customer / role we don't have - a bridge row with one end missing means nothing. Optional links (the six chain columns, `reporting_user_id`) go to null instead.
- The auth columns (`password`, `current_password`, `otp_number`, `OTP`, `daily_OTP`, `push_token_key` and their expiry dates) and `mobile_number` are **never loaded**. `email` is loaded (filled on 952, a few shared mailboxes).

Links to the master tables:

```text
UserRoles.user_id                        → Users.line_id                            (100%, row dropped if ever missing)
UserRoles.role_id                        → Roles.line_id                            (100%, row dropped if ever missing)
Users.reporting_to_id                    → Users.line_id                            (73%, null when crm has 0 / a gone user)
UserMarketCircleMappings.user_id         → Users.line_id                            (100%, row dropped if ever missing)
UserMarketCircleMappings.market_circle_id→ MarketCircles.header_id                  (100%, row dropped if ever missing)
UserCollectorMappings.user_id            → Users.line_id                            (100%, row dropped if ever missing)
UserCollectorMappings.collector_id       → Collectors.collector_id                  (100%, row dropped if ever missing)
UserCustomerMappings.user_id             → Users.line_id                            (99.3%, 120 rows of 2 gone users dropped)
UserCustomerMappings.customer_hdr_id     → CustomerMasters.header_id                (99.98%, 4 rows with 0 dropped)
CollectorMailMappings.collector_id       → Collectors.collector_id                  (100%, unique)
CollectorMailMappings.bm/rm/cm/bc/ed/gm_user_id → Users.line_id                     (100% where filled, null = nobody)
TechnicalUserSegmentMappings.user_id     → Users.line_id                            (100%, row dropped if ever missing)
TechnicalUserSegmentMappings.reporting_user_id → Users.line_id                      (100%, null if ever missing)
TechnicalUserSegmentMappings.role_id     → Roles.line_id                            (100%, row dropped if ever missing)
TechnicalUserSegmentMappings.segment2/3/4  ItemCategories.segment2/3/4              (soft, text. 100% / 100% / 283 of 285)
```

Things to know:

- `Users` and `Roles` are upsert: a user deleted in crm stays in our copy (173 gaps in `line_id`), which is what history needs. `UserRoles` is a snapshot because its rows do get deleted (35 gaps).
- `is_dummy` is null on 1,139 rows - null means a real user. `is_active` false on 153. `designation` / `department` are null on ~380 each. `user_code` is the employee code but 260 rows share one, so it is an attribute, not a key.
- `Roles.role_type_id` (20 values) has no master in crm; `description` and `identifier` are empty on every role.

---

| Level | Table | PK | Mode | Filter | Stage fixes | Seed | Children |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 0 | Collectors | `collector_id` | upsert | – | – | – | MarketCircles, CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails, InventoryOrgs |
| 0 | CustomerMasters | `header_id` | upsert | – | `0` → NULL on customer_id, customer_number | `unknown` (-1) | CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails |
| 0 | ItemMasters | `item_id` | upsert | – | – | `unknown` (-1) | ItemCategories, PurchaseRequisitionPtoPts, SaleOrderDtls, Schedules, SocCancelDetails, DispatchDetails, QuotationDtls, BiPoDetails, PurchaseRequisitionDtls, BiStockDetail |
| 0 | DeliveryFroms | `line_id` | upsert | – | – | `unknown` (-1) | SaleOrderDtls, QuotationDtls |
| 0 | Reasons | `header_id` | upsert | – | – | – | SocCancelDetails |
| 0 | QuotationStatus | `line_id` | upsert | – | – | – | QuotationHdrs, QuotationDtls |
| 0 | JourneyCalendars | `line_id` | upsert | – | – | `unknown` (-1) | SCBusinessMonthlyPlanJCDtls |
| 0 | ApSuppliers | `vendor_id` | upsert | – | – | – | BiPoDetails, PurchaseRequisitionHdrs |
| 0 | Users | `line_id` | upsert | – | reporting_to `0` / gone → NULL (self link, checked on stage) | – | Users, UserRoles |
| 0 | Roles | `line_id` | upsert | – | – | – | UserRoles |
| 1 | MarketCircles | `header_id` | upsert | – | lower/trim | `unknown` (-1) | CustomerSites, SaleOrderHdrs, … |
| 1 | ItemCategories | `header_id` | upsert | PC only | drop orphans | – | – |
| 1 | PurchaseRequisitionPtoPts | `Header_id → header_id` | incremental | – | – | – | – |
| 1 | UserRoles | `line_id` (unique user_id) | snapshot | – | drop row if user / role missing; keep latest per user | – | – |
| 1 | ArCustomers | `header_id` (unique customer_id) | upsert | – | drop row if customer missing | – | – |
| 1 | UserCollectorMappings | `header_id` (unique user_id + collector_id) | snapshot | – | drop copies of a pair (keep lowest header_id); drop row if user / branch missing | – | – |
| 1 | UserCustomerMappings | `header_id` (unique user_id + customer_hdr_id) | snapshot | – | drop copies of a pair (keep lowest header_id); drop row if user / customer missing | – | – |
| 1 | CollectorMailMappings | `header_id` (unique collector_id) | snapshot | – | drop row if branch missing; the six chain user ids → NULL if missing | – | – |
| 1 | TechnicalUserSegmentMappings | `line_id` | snapshot | – | drop row if user / role missing; reporting_user_id → NULL if missing | – | – |
| 1 | InventoryOrgs | `inventory_org_id` | upsert | – | collector `0` → NULL | `unknown` (-1) | BiStockDetail, SaleOrderDtls, Dispatches, Schedules, SocCancelDetails, DispatchDetails, QuotationDtls, BiPoDetails, PurchaseRequisitionHdrs |
| 2 | BiPoDetails | `id` (ours) | snapshot | PC item | – | – | – |
| 2 | PurchaseRequisitionHdrs | `header_id` | snapshot | – | collector `0` → NULL, supplier `0` → NULL | – | PurchaseRequisitionDtls |
| 2 | CustomerSites | `line_id` | upsert | – | lower/trim + `unknown`, drop duplicate site_use_id, site branch → NULL if missing | `unknown` (-1) | SaleOrderHdrs, Dispatches, Schedules, … |
| 2 | BiStockDetail | `header_id` | incremental, **large** (pk ranges, 4 workers) | trans_date ≥ 2024 and PC item code | warehouse not in master → `-1`; `item_id` derived from item_code (latest ItemMasters id per code), `-1` if none | – | – |
| 2 | ItemInventoryOrgMappings | `header_id` (unique item_id + inventory_org_id) | snapshot | PC item | drop duplicate pair (keep lowest header_id); item / warehouse not in master → `-1` | – | – |
| 2 | BiCollectorInventoryOrgMapping | `header_id` (unique collector_id + inventory_org_id) | snapshot | – | drop re-inserted pairs (keep lowest header_id); drop row if collector / warehouse not in master | – | – |
| 2 | UserMarketCircleMappings | `header_id` | snapshot | – | drop row if user / circle missing (no dedupe: repeated pairs are validity history) | – | – |
| 2 | tempcustomers | `line_id` (unique header_id) | snapshot | – | keep latest row per lead; drop row if lead missing; branch `0` → NULL; circle lower/trim + `unknown` | – | – |
| 3 | PurchaseRequisitionDtls | `line_id` | snapshot | – | customer / collector `0` → NULL, po_line_id `0` → NULL, blank header_id if not loaded | – | – |
| 3 | SaleOrderHdrs | `header_id` | incremental | – | missing site → `-1` on bill_to / ship_to | – | SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails |
| 3 | QuotationHdrs | `header_id` | snapshot | headers the loaded QuotationDtls point at | customer / sites `0` → `-1`, mc_code lower/trim + `unknown` | – | QuotationDtls |
| 3 | SCBusinessMonthlyPlanHdrs | `header_id` | snapshot | – | customer `0` → `-1`, wrong site → `-1` (NULL kept), new_customer_marketcircle lower/trim + `unknown` | – | SCBusinessMonthlyPlanDtls, SCBusinessMonthlyPlanJCDtls |
| 4 | SaleOrderDtls | `line_id` | incremental | PC item | `CLOSE` → `Closed`, delivery point `0` → `-1`, warehouse `0` → `-1` | – | Schedules, SocCancelDetails, DispatchDetails |
| 4 | SocPendingDetails | `id` (ours) | snapshot | PC item code | lower/trim + `unknown` on market_circle | – | – |
| 4 | Dispatches | `header_id` | snapshot | headers the loaded DispatchDetails point at | – | – | DispatchDetails |
| 4 | QuotationDtls | `line_id` | snapshot | creation_date ≥ 2021 and PC item | delivery point `0` → `-1`, status `0` → NULL, junk date → NULL, blank header_id if not loaded | – | – |
| 4 | SCBusinessMonthlyPlanDtls | `line_id` | snapshot | – | customer `0` → `-1`, blank header_id if not loaded | – | SCBusinessMonthlyPlanJCDtls |
| 5 | Schedules | `line_id` | snapshot | schedule_date ≥ 2021 and PC item | junk dates → NULL, site `0` → `-1` | – | DispatchDetails |
| 5 | SocCancelDetails | `header_id` | incremental | creation_date ≥ 2021 and PC item | – (close_reason_id → Reasons, 100%) | – | – |
| 5 | SCBusinessMonthlyPlanJCDtls | `line_id` | snapshot | – | jc_type `0` → `-1`, blank header_id (= Dtls.line_id) if not loaded | – | – |
| 6 | DispatchDetails | `line_id` | snapshot | schedule_date ≥ 2021 and PC item (by item_id, like every other fact) | junk date → NULL, blank header_id / schedule_line_id / sale_order_detail_line_id if parent not loaded | – | – |

Snapshot = wiped and reloaded in full every run (rows change after creation in crm). Incremental = `pk > last loaded pk`, rows never change. Upsert = masters: read in full every run and merged on the pk, never truncated (children point at them), so a lead that becomes a customer or a site that moves circle is picked up.
Parents load before children (levels). If a child arrives before its parent (crm moved on during the run), incremental tables hold the row back until the next run; snapshot tables blank the fk and the next full reload fixes it.
Large = an incremental table too big for one read (`LARGE_TABLES`): the pk span is split into ranges of `RANGE_ROWS` ids, `INNER_WORKERS` processes each read one range with its own crm connection and commit it on its own. The watermark moves only over contiguous good ranges, so a failed range is re-fetched next run and rows loaded above it are absorbed by `ON CONFLICT DO NOTHING` - no gaps, no duplicates.
