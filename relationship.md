# CRM Customer_master Data Model

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

<br>
<br>
<br>



# CRM Item_Master Data Model


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

* One `ItemMasters` record has one `ItemCategories` record.
* One `ItemMasters` record can have many `PurchaseRequisitionPtoPts` records.
* `ItemMasters` is the parent table for both tables.

<br>
<br>
<br>


# CRM Sales_Order_SOC Data Model


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

* One `SaleOrderHdrs` record has many `SaleOrderDtls` records (one per item line).
* One `SaleOrderHdrs` record can have many `SocPendingDetails` records (one per pending schedule line).
* `SaleOrderHdrs` is the parent table for both tables.
* `SocPendingDetails` has no link to `SaleOrderDtls` - the report carries no line id, so a pending row joins the order, never a specific line.
* `SocPendingDetails` is a daily snapshot from CRM. It has no key of its own, so it is wiped and reloaded every run with our own `id` as primary key.

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


<br>
<br>
<br>

# CRM Dispatch Data Model


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

* One `SaleOrderDtls` line has about one `Schedules` row (planned dispatch date, reschedules, status).
* One `Schedules` row can have many `DispatchDetails` rows (partial shipments).
* One `Dispatches` note (invoice) has many `DispatchDetails` lines, avg 1.8.
* One `SaleOrderDtls` line can have many `SocCancelDetails` rows (cancellation requests, usually one).
* `DeliveryFroms` is a 46 row lookup for `SaleOrderDtls.delivery_from_id`; `-1` = unknown for the 542 lines crm left at 0.
* `SocCancelDetails.schedule_line_id` is a reference only, no fk - the schedule is often deleted after the cancel (60% match).
* `Dispatches`, `Schedules` and `DispatchDetails` are snapshot tables: filtered to Performance Chemicals from 2021 and reloaded in full every run, because crm edits them after creation (status, reschedules, billing confirmation).
* `SocCancelDetails` and `DeliveryFroms` are incremental - their rows never change.

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

* The dispatch date is `DispatchDetails.schedule_date`, stored as a date. `Dispatches.trx_date` is the invoice date.
* Cancelled dispatches: `Dispatches.despatch_status_id = 4` (InvoiceCancel) or `Dispatches.oracle_status = 'CANCELLED'`. Two different sets, no overlap.
* `Schedules.schedule_status_id` is not a clean open flag (92% sit at 6 SOCConfirmed even after dispatch). `SocPendingDetails` is the authoritative open book; `Schedules` gives the per line history.
* `Schedules.dispatched_quantity` is stale in crm and not loaded. Dispatched qty comes from `DispatchDetails` via `schedule_line_id`.
* `SocCancelDetails.close_reason_id` and `status_id` are codes with no master table in crm.
* A few hundred `DispatchDetails` rows have a blank `header_id` or `schedule_line_id`: their parent falls outside the parent's filter. They still join through the order line.


<br>
<br>
<br>

# CRM Quotation Data Model


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

* One `QuotationHdrs` has many `QuotationDtls` lines (avg 2.2, one per item).
* Every sale order comes from a quote: `SaleOrderHdrs.quotation_line_id` points at `QuotationHdrs.header_id` for all 1.1M orders. 92% of quotes convert.
* That link stays **soft** (no fk): orders are loaded for every segment, quotes only for Performance Chemicals, so most orders point at a quote that is not loaded. It becomes a hard fk only if orders get the same filter.
* `status_id` on both tables points at `QuotationStatus`. 96% of headers are `Closed` - a quote closes when it converts. `Open / Approved / Confirmed` is the live pipeline.
* `QuotationHdrs` and `QuotationDtls` are snapshot tables: lines with `creation_date >= 2021` and a Performance Chemicals item, plus the headers those lines point at. Reloaded in full every run because status moves after creation.
* `QuotationStatus` is incremental, level 0.

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

* `customer_hdr_id` on the header is 0 or null on 92% of rows - use `customer_id`.
* ~60 columns on `QuotationHdrs` are export-only (98% null): ports, containers, fob values, bank, agent. Not loaded.
* `QuotationDtls.status_id` is 0 on 536 rows; loaded as null.
* `close_status_id` (0 / 1 / 2) has no master table in crm.


<br>
<br>
<br>



# CRM Business_Plan Data Model


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

* One `SCBusinessMonthlyPlanHdrs` (the annual plan for a customer / product / collector / year) has ~1.5 `SCBusinessMonthlyPlanDtls` rows - it should be 1, the extras are crm double inserts (see below).
* One `SCBusinessMonthlyPlanDtls` line has up to 13 `SCBusinessMonthlyPlanJCDtls` rows, one per journey cycle, holding the rolling next-month forecast.
* `SCBusinessMonthlyPlanJCDtls.jc_type` says which `JourneyCalendars` cycle the forecast was made in.
* `SCBusinessMonthlyPlanJCDtls.header_id` is **misnamed** in crm: it matches `SCBusinessMonthlyPlanDtls.line_id` (99.7%), not `SCBusinessMonthlyPlanHdrs.header_id` (47%, coincidence). The fk goes to the detail line.
* The plan has **no item_id**. It is keyed on `item_description` (product name) + `category_id`. That pair maps to exactly one `ItemMasters` row only 29% of the time (58% several pack sizes, 13% none). Plan vs actual needs a product-name rule in the views.
* No Performance Chemicals filter is needed: "SC" is the PC plan (its divisions are exactly the PC `segment2` values). GC / PC plans live in other crm tables.
* `JourneyCalendars` is incremental (never edited). The three plan tables are snapshot: jc status, plans and forecasts move after creation.

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

* **Prospects**: 9,624 headers have `customer_id = 0` in crm - customers not yet in `CustomerMasters`. They load as `-1` with `is_new_customer = true`, the name in `new_customer_name` and the circle in `new_customer_marketcircle`.
* **Duplicates**: a third of `SCBusinessMonthlyPlanDtls` (107k of 312k rows) are exact copies - same header, product and all 13 JC plans; one header has 4,443 identical lines. Also 2,606 duplicate header groups. Loaded as-is because `JCDtls` points at individual line ids. Dedupe in the views.
* **Empty plans**: 86% of detail lines have all 26 week quantities at 0 and 87% of forecast rows are 0 / 0. crm creates a row for every header whether or not anything was planned. Filter in the views.
* **Value columns are user typed in mixed units** (`jcN_weekN_user_dfn_value`: rupees on some rows, lakhs or ratios on most). Use `qty x jcN_user_dfn_avg_sell_price` instead.
* `jcN_status` (1 .. 6) has no master table in crm; 1 and 4 cover 96%. `jcN_qty_achieved` is sparse - actuals come from `DispatchDetails`.
* All measures are float32 in crm (`real`), stored as double precision. Expect float artefacts like `0.20000000298`.
* 2,744 forecast rows point at plan lines crm has deleted (loaded with `header_id` null); 7,888 carry `jc_type = 0` (loaded as `-1`); 123 have an `acc_year` that disagrees with the cycle's year.
* `creation_date` is empty on 43% of headers (all of 2020-22). `acc_year` is the reliable time key.











<br>
<br>
<br>
<br>


| Level | Table | PK | Mode | Filter | Stage fixes | Seed | Children |
|---:|---|---|---|---|---|---|---|
| 0 | Collectors | `collector_id` | incremental | – | – | – | MarketCircles, CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails |
| 0 | CustomerMasters | `header_id` | incremental | – | `0` → NULL on customer_id, customer_number | `unknown` (-1) | CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails, Dispatches, Schedules, SocCancelDetails, DispatchDetails |
| 0 | ItemMasters | `item_id` | incremental | – | – | – | ItemCategories, PurchaseRequisitionPtoPts, SaleOrderDtls, Schedules, SocCancelDetails, DispatchDetails |
| 0 | DeliveryFroms | `line_id` | incremental | – | – | `unknown` (-1) | SaleOrderDtls, QuotationDtls |
| 0 | QuotationStatus | `line_id` | incremental | – | – | – | QuotationHdrs, QuotationDtls |
| 0 | JourneyCalendars | `line_id` | incremental | – | – | `unknown` (-1) | SCBusinessMonthlyPlanJCDtls |
| 1 | MarketCircles | `header_id` | incremental | – | lower/trim | `unknown` (-1) | CustomerSites, SaleOrderHdrs, … |
| 1 | ItemCategories | `header_id` | incremental | PC only | drop orphans | – | – |
| 1 | PurchaseRequisitionPtoPts | `Header_id → header_id` | incremental | – | – | – | – |
| 2 | CustomerSites | `line_id` | incremental | – | lower/trim + `unknown`, drop duplicate site_use_id | `unknown` (-1) | SaleOrderHdrs, Dispatches, Schedules, … |
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

Snapshot = wiped and reloaded in full every run (rows change after creation in crm). Incremental = `pk > last loaded pk`, rows never change.
Parents load before children (levels). If a child arrives before its parent (crm moved on during the run), incremental tables hold the row back until the next run; snapshot tables blank the fk and the next full reload fixes it.



