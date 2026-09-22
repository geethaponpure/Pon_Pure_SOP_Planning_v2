# Views applied

The views that are built and live. One section per cluster. `views.md` keeps the to-do list.

## How views work

```text
  crm tables (exact copy)        views (the rules live here)        who reads them
  ┌─────────────────────┐        ┌──────────────────────────┐        ┌────────────────┐
  │ ItemMasters         │        │ dim_item                 │        │ api endpoints  │
  │ ItemCategories      │ ─────► │ v_item_pto_pts_monthly   │ ─────► │ reports        │
  │ PurchaseRequisition │        │ ...                      │        │ ai agent       │
  │   PtoPts ...        │        └──────────────────────────┘        └────────────────┘
  └─────────────────────┘
   raw, crm quirks intact         one clean row per thing             never read raw tables
```

| | |
| --- | --- |
| where | `Backend/app/views/<nn>_<cluster>.sql` - one file per cluster |
| when | every api start, right after the tables (`app/repositories/views.py`) |
| how | `DROP VIEW ... CASCADE` + `CREATE VIEW` - a change never breaks a restart |
| materialized | a view that is slow to compute is made `MATERIALIZED` (it holds its rows): rebuilt at api start like the others, and refreshed at the end of every etl run - in the order the files define them, so a view never reads a stale one it depends on. Marked **(materialized)** below |
| names | `dim_*` one row per thing · `fact_*` events and measures · `v_*` helpers |
| comments | every view and column has a `COMMENT ON` in plain language - hover a column in pgAdmin, or the ai agent reads it from the catalog |
| pgAdmin | `SET search_path TO ponpure_planner;` once, then view names need no quotes |

---

## item_master  `01_item_master.sql`

### dim_item - the product list

| | |
| --- | --- |
| one row per | product - every product, including non Performance Chemicals products and the `-1` "unknown" |
| join on | `item_id` (every order, quote, dispatch, purchase and stock row carries it) |
| answers | what is this product, which business is it in, is it usable, is it PTO or PTS |

```text
  ItemMasters ──────────────┐
  ItemCategories ───────────┼──► dim_item
  v_item_pto_pts_monthly ───┘
```

**Columns**

| column | meaning | example |
| --- | --- | --- |
| `item_id` | the product id | 4 |
| `item_code` | product code (not unique - a few codes belong to two products) | TRAKMSBR00200004 |
| `item_name` | product name | ACRYLIC RESIN SYNOCURE 867S-60 |
| `item_group` | crm's product group | ACRYLIC |
| `uom`, `uom_name` | unit of measure | KG, Kilogram |
| `is_active` | crm status is Active | true |
| `is_enabled` | crm enabled flag is Y | true |
| `is_performance_chemicals` | has a classification = is a PC product | true |
| `category_id` | crm's id for the classification combination | 2256 |
| `division` › `business` › `category` › `family` | the 4 level classification (empty for non PC products) | Performance Chemicals › PNC Division › Resin - Arkema › Arkema |
| `pto_pts` | **what a crm screen shows today**: PTO or PTS | PTS |
| `pto_pts_is_default` | true = that PTO is a default, not a measurement | false |
| `pto_pts_latest` | the last class crm actually measured, any month | PTS |
| `pto_pts_latest_month` | when that was | 2026-09-01 |
| `pto_pts_latest_pass` | measured on its own sales (finished goods) or on what it goes into (raw material) | finished goods |
| `creation_date`, `last_update_date` | from crm | |

**Rules baked in**

- `is_active` = `status = 'Active'`, `is_enabled` = `enabled_flag = 'Y'`. crm's own "usable product" = both.
- `business` spelling cleaned: `Raw  Material` (two spaces) → `Raw Material`, `FOOD INGREDIENTS` → `Food Ingredients`.
- non PC products stay in the view - most order lines are on them.
- `pto_pts` mirrors crm's function `fn_GetPTOPTSItemsPC` to the row:

```text
  is the product PC + active + enabled?
            │
       no ──┴──► pto_pts = empty (no PTO / PTS decision applies)
            │
           yes
            ▼
  does crm have a classification for THIS month?
            │
     ┌──────┴──────┐
    yes            no
     ▼              ▼
  PTO or PTS      PTO
  (is_default     (is_default = true)
   = false)
```

- when the finished goods pass and the raw material pass disagree in a month, PTS wins (same as crm).
- most products carry the default: a product that has not sold in the last six months is PTO on screen, and `pto_pts_is_default` says so.

---

### v_item_pto_pts_monthly - the PTO / PTS history

| | |
| --- | --- |
| one row per | product · month · pass |
| from | `PurchaseRequisitionPtoPts` (monthly since July 2020) |
| answers | what was the class in month X, and the numbers behind it |

**Columns**

| column | meaning | example |
| --- | --- | --- |
| `item_id` | the product (on the raw material pass: the raw material) | 4 |
| `month_start`, `month_end` | the month | 2026-09-01, 2026-09-30 |
| `pass` | `finished goods` = its own sales · `raw material` = sales of what it goes into | finished goods |
| `pto_pts` | the class that month | PTS |
| `types` | crm's raw tag (PTO / PTS / PTS70% / PTS80%, with R in front = raw material pass) | PTS |
| `threshold_pct` | top customer share that flips it to PTO: 80 until Jun 2023, 70 after | 70 |
| `customer_count` | distinct customers in the trailing 6 months | 10 |
| `total_sale_qty` | quantity invoiced in that window | 7,200 |
| `top_customer_sale_qty` | quantity taken by the single largest customer | 2,400 |
| `top_customer_share_pct` | that customer's share | 33.33 |

**How crm decides (1st of every month, trailing 6 months of invoices, PC only, no samples)**

```text
  customers in 6 months
          │
     < 5 ─┴─► PTO   (too few buyers - buy against the order)
          │
    5 or more
          │
          ▼
  largest customer's share
          │
   ≥ 70% ─┴─► PTO   (one buyer dominates)          tag: PTS70%
          │
   < 70% ────► PTS   (spread demand - keep in stock)
```

- no invoice sales in the window → no row → the screen defaults to PTO.
- the same rules run a second time per raw material → `RPTO` / `RPTS` rows.
- holes in crm: May 2022 missing, Dec 2025 has no raw material rows, a few hand edited rows in Mar 2023.
- recomputing with a different window would need `PureGPReports` (invoice lines, not loaded).

**Quick checks** (pgAdmin, after `SET search_path TO ponpure_planner;`)

```sql
-- must match crm:  SELECT Itemtype, COUNT(*) FROM dbo.fn_GetPTOPTSItemsPC() GROUP BY Itemtype
SELECT pto_pts, count(*) FROM dim_item WHERE pto_pts IS NOT NULL GROUP BY 1;

-- how much of the PTO is default vs measured
SELECT pto_pts, pto_pts_is_default, count(*) FROM dim_item WHERE pto_pts IS NOT NULL GROUP BY 1, 2;

-- one product's history
SELECT * FROM v_item_pto_pts_monthly WHERE item_id = 4 ORDER BY month_start DESC LIMIT 3;
```

---

## customer_master  `02_customer_master.sql`

```text
  Collectors ──────► dim_collector ──────┐
                                         ├──► dim_market_circle ──┐
  MarketCircles ─────────────────────────┘                        ├──► dim_customer_site ──┐
  CustomerSites ──────────────────────────────────────────────────┘                        ├──► dim_customer (materialized)
  CustomerMasters ─────────────────────────────────────────────────────────────────────────┤
  tempcustomers (leads) ───────────────────────────────────────────────────────────────────┤
  ArCustomers (oracle) ────────────────────────────────────────────────────────────────────┘
```

### dim_collector - the branches

| | |
| --- | --- |
| one row per | branch (crm calls them collectors) - all of them, retired ones too |
| join on | `collector_id` |
| answers | what kind of branch is this, does it own territory |

| column | meaning | example |
| --- | --- | --- |
| `collector_id`, `branch_name` | the branch | 1038, CHENNAI - I |
| `is_active` | crm status A | true |
| `is_overseas` | export / special channel | false |
| `is_group_company` | the intra-group sales channel | false |
| `is_obsolete` | the parking branch for retired sites | false |
| `circle_count` | sales circles it owns | 8 |
| `branch_group` | `domestic` · `export / special channel` · `group company` · `obsolete` · `retired or unused` | domestic |

```text
  group company flag ──► group company
  name OBSOLETE ───────► obsolete
  overseas flag ───────► export / special channel
  owns circles ────────► domestic
  else ────────────────► retired or unused   (old branch records; history still points at them)
```

### dim_market_circle - the sales circles

| | |
| --- | --- |
| one row per | circle (territory), plus the `unknown` circle |
| join on | `mc_code` (sites, leads) or `circle_id` (user territory mappings) |
| answers | which branch and region a circle belongs to |

| column | meaning | example |
| --- | --- | --- |
| `circle_id`, `mc_code`, `circle_code` | the circle | 12, che01, CHE |
| `region` | SOUTH / WEST / NORTH / EAST / ECO, empty for international, job and map circles | SOUTH |
| `region_raw` | as crm stores it | SOUTH |
| `is_active`, `is_unknown` | flags | true, false |
| `collector_id`, `branch_name`, `is_overseas`, `is_group_company` | the owning branch | 1038, CHENNAI - I, false, false |

### dim_customer_site - the row every fact joins to

| | |
| --- | --- |
| one row per | customer site: a billing (BILL_TO) or delivery (SHIP_TO) address. Includes the `-1` unknown site |
| join on | `site_use_id` = `bill_to_site_id` / `ship_to_site_id` on orders, quotes, plans, dispatches |
| answers | whose address is this, in which circle and branch, is it still in use |

| column | meaning | example |
| --- | --- | --- |
| `site_use_id`, `site_id`, `cust_acct_site_id` | the site's ids (`site_use_id` is the one facts carry) | 2622 |
| `customer_hdr_id`, `customer_id`, `customer_number`, `customer_name`, `is_lead` | the customer | |
| `site_use_code` | BILL_TO or SHIP_TO | BILL_TO |
| `is_primary`, `is_active` | crm flags (primary is **not** one per customer) | true, true |
| `is_obsolete` | parked on the OBSOLETE branch = retired, even if status says active | false |
| `city`, `state`, `country` | the address | CHENNAI, Tamil Nadu, IN |
| `mc_code`, `circle_code`, `region`, `is_unknown_circle` | the circle | che01, CHE, SOUTH, false |
| `collector_id`, `branch_name`, `branch_source` | the branch: the site's own (`site`) if it has one, else the circle's (`circle`) | 1038, CHENNAI - I, site |
| `is_overseas`, `is_group_company` | branch flags | false, false |

**Rules baked in**

- territory belongs to the site: bill-to and ship-to circles agree on almost every order, and the order's branch is the ship-to site's branch.
- branch = site's own branch first (crm's own customer → branch rule reads this), circle's branch as fallback:

```text
  site has collector_id? ──yes──► that branch          (branch_source = site)
          │
          no
          ▼
  circle known? ──yes──► the circle's branch            (branch_source = circle)
          │
          no ──► no branch                              (branch_source empty)
```

- a site on the OBSOLETE branch is retired whatever its status says → `is_obsolete`.
- sites in the `unknown` circle are kept; some still carry a real branch.

### dim_customer - one row per customer  (materialized)

| | |
| --- | --- |
| one row per | customer - real customers and leads alike, plus the `-1` unknown |
| join on | `customer_id` (orders, quotes, plans, dispatches), `customer_number` (open order book), `customer_hdr_id` (sites, leads, user mappings) |
| answers | who is this customer, what industry and division, where is home |

| column | meaning | example |
| --- | --- | --- |
| `customer_hdr_id`, `customer_id`, `customer_number`, `customer_name` | the customer | |
| `customer_group` | crm's customergroup - nearly unique, not a grouping | |
| `is_lead` | no oracle id yet | false |
| `is_active` | crm status A (blank = lead = not active) | true |
| `legal_form` | SOLE PROPRIETORSHIP / PRIVATE LIMITED / PARTNERSHIP ... (oracle) | PRIVATE LIMITED |
| `industrial_segment` | TRADER / PAINT & COATINGS / TEXTILE / PHARMA ... (oracle for customers, lead details for leads) | PHARMA |
| `division` | General Chemicals / Performance Chemicals / NPD / Packing Materials ... (oracle) | Performance Chemicals |
| `oracle_mc_code` | the circle oracle holds for the customer - a cross check | che01 |
| `is_internal` | oracle customer type I | false |
| `site_count`, `active_site_count`, `is_multi_branch` | how many sites, and whether they span more than one branch | 6, 5, false |
| `home_source` | which rule picked the home (see below) | primary bill-to site |
| `home_site_use_id`, `home_city`, `home_state` | the home site | |
| `home_mc_code`, `home_circle_code`, `home_region` | the home circle | che01, CHE, SOUTH |
| `home_collector_id`, `home_branch_name`, `home_is_overseas` | the home branch | 1038, CHENNAI - I, false |

**Home territory - first rule that matches, latest site on a tie**

```text
  customer has sites?
        │
       yes ──► 1. primary + active + BILL_TO site     (home_source = primary bill-to site)
        │      2. active + BILL_TO site               (active bill-to site)
        │      3. any active site                     (active site)
        │      4. any site                            (any site)
        │
       no ───► lead details (tempcustomers)           (lead details)
                     │
                    none ──► no home
```

- this is crm's own rule (`FN_Customer_GetCollectorName`): an active bill-to site for a customer, the lead details for a lead - made deterministic with the primary flag and the tie break.
- marketplace channels (`SALES THROUGH FLIPKART`, `... AMAZON`) are one customer with thousands of sites: `site_count` shows it, no special flag.
- `is_multi_branch` says the home branch is only one of several - use `dim_customer_site` for the real picture.

**Quick checks** (pgAdmin, after `SET search_path TO ponpure_planner;`)

```sql
SELECT branch_group, count(*) FROM dim_collector GROUP BY 1;
SELECT home_source, count(*) FROM dim_customer GROUP BY 1 ORDER BY 2 DESC;
SELECT branch_source, count(*) FROM dim_customer_site GROUP BY 1;

-- home circle vs the circle oracle holds: should agree on almost all
SELECT home_mc_code = oracle_mc_code AS agree, count(*) FROM dim_customer WHERE oracle_mc_code IS NOT NULL GROUP BY 1;
```

---

## sales_order_soc  `03_sales_order_soc.sql`

```text
  v_transaction_type ─────────┐          (what each crm transaction type means - decided once,
                              │           reused by the dispatch and quotation views later)
  SaleOrderHdrs ──────────────┼──► fact_order_line      every order line for PC products
  SaleOrderDtls ──────────────┘

  SocPendingDetails ─────────────► fact_open_order      the open order book as crm computed it
```

### v_transaction_type - what a transaction type means

| | |
| --- | --- |
| one row per | crm transaction type |
| join on | `upper(trim(trans_type_name))` |
| answers | is this line a sale, is it demand a planner should count |

| kind | crm types | `is_sale` | `is_demand` |
| --- | --- | --- | --- |
| sale | Taxable Intra / Inter State, **Cogt** Intra / Inter, COGT Taxable | yes | yes |
| export sale | Export, SEZ to DTA, SEZ to SEZ | yes | yes |
| import pass-through | BTS (Bond Transfer Sales), HSS (High Seas Sales) | yes - invoiced revenue | no - never touches branch stock |
| sample | Sample | no | no |
| stock transfer | Stock Transfer Intra / Inter | no | no |
| job work | Job Work | no | no |
| unknown | anything else (a few blank rows) | no | no |

- `Cogt` (confirmed with the crm team) is CCL's own manufactured textile chemicals sold to customers - a normal sale.
- on the facts both flags are switched **off** when the branch is GROUP COMPANY; that becomes `is_inter_company`.

### fact_order_line - every order line

| | |
| --- | --- |
| one row per | order line, Performance Chemicals products only (load filter) |
| join on | `item_id` → dim_item · `customer_id` → dim_customer · `ship_to_site_use_id` / `bill_to_site_use_id` → dim_customer_site · `collector_id` → dim_collector · `order_id` → fact_open_order |
| answers | what was ordered, by whom, from which branch, is it a sale, what is it worth |

| column | meaning | example |
| --- | --- | --- |
| `line_id`, `order_id` | the line and its order | |
| `order_date` | the PO received date (junk years fall back to the creation day) | 2026-03-14 |
| `order_created_at`, `customer_po_ref`, `customer_po_date` | order header details | |
| `customer_id`, `bill_to_site_use_id`, `ship_to_site_use_id`, `collector_id` | who and where. The ship-to site is the demand location | |
| `organization_id`, `currency`, `trading_manufacture`, `is_back_to_back` | header flags | 101, INR, Trading, false |
| `quotation_hdr_id`, `quotation_number`, `quotation_line_id` | the quote it came from (soft - only PC quotes since 2021 are loaded) | |
| `transaction_type`, `order_kind` | crm's type and what it means | Cogt - Intra State, sale |
| `is_sale`, `is_demand`, `is_inter_company`, `is_cogt` | the flags reports filter on | true, true, false, true |
| `item_id` | the product | |
| `sale_category`, `is_ecommerce` | Intact / Repack / Bulk / E-Commerce / Customer Barrel, spelling cleaned | Intact, false |
| `uom`, `quantity` | the measure (Kgs / KGS / LITER folded) | KG, 200 |
| `unit_price`, `has_price` | tax exclusive; 0 on inter company and marketplace lines | 105.89, true |
| `line_value` | `quantity × unit_price`, empty when unpriced | 21,178 |
| `line_value_crm` | crm's `total_sales_price`, reference only | |
| `delivery_from_id`, `inventory_org_id`, `delivery_date` | delivery point, warehouse, promised date | |
| `status_crm` | OPEN or Closed - OPEN only means nobody closed it | OPEN |

**Rules baked in**

```text
  line value
       │
  unit_price > 0 ? ──no──► line_value = empty      (inter company / marketplace - crm never has the price)
       │
      yes ──► quantity × unit_price  (tax exclusive)
              crm's total_sales_price is NOT used: tax inclusive on some screens, stale on edited lines
```

```text
  is this a sale / demand ?
       │
  branch = GROUP COMPANY ? ──yes──► is_inter_company = true, is_sale = false, is_demand = false
       │
      no ──► from the transaction type (table above)
```

- `status_crm = OPEN` is **not** the open book - hundreds of thousands of delivered lines are still OPEN in crm. The open book is `fact_open_order`.
- the value of an order is booked value; invoiced revenue lives in crm's invoice table (`PureGPReports`, not loaded).

### fact_open_order - the open order book

| | |
| --- | --- |
| one row per | open schedule line, as crm's daily job computed it (`SocPendingDetails`) |
| join on | `order_id` + `item_id` → fact_order_line (the report has no line id) · `customer_hdr_id` / `customer_id` → dim_customer · `item_id` → dim_item · `collector_id` → dim_collector · `mc_code` → dim_market_circle · `inventory_org_id` → InventoryOrgs |
| answers | what is still to be delivered, for whom, from where, by when |

| column | meaning | example |
| --- | --- | --- |
| `order_id`, `order_date`, `schedule_date`, `customer_requested_date` | the order and its dates | |
| `reschedule_date`, `reschedule_reason` | when it was moved and why | |
| `customer_hdr_id`, `customer_id`, `customer_number` | the customer (resolved from the account number) | |
| `collector_id`, `mc_code` | branch and circle | |
| `item_id`, `item_code` | the product (resolved from the code) | |
| `sale_category`, `transaction_type`, `order_kind`, `is_sale`, `is_demand`, `is_inter_company` | same flags as fact_order_line | |
| `uom`, `ordered_qty`, `scheduled_qty`, `dispatched_qty`, **`pending_qty`** | the quantities; pending is the one that matters | KG, 1000, 1000, 400, 600 |
| `unit_price`, `has_price`, `pending_value` | `pending_qty × unit_price`, empty when unpriced | |
| `dispatch_pct` | crm's dispatched %, bulk General Chemicals lines only | |
| `inventory_org_code`, `inventory_org_id` | the warehouse (resolved from the code) | |
| `as_of` | when crm computed this open book | |

**How crm builds it (daily, `SPPendingOrderDtlforUsers`)**

```text
  order line status = OPEN
       │
       ▼
  balance after schedules and dispatches > 0      (bulk lines count as done at 95%)
       │
       ▼
  one row per open schedule line  ──► SocPendingDetails  ──► we copy it every run, we do not recompute it
```

- a large part of the open book is inter company (`is_inter_company`): real stock movement, no price, not customer demand.
- the schedule-line version built from `Schedules − DispatchDetails` (crm's projection rule) comes with the dispatch cluster.

**Quick checks** (pgAdmin, after `SET search_path TO ponpure_planner;`)

```sql
SELECT order_kind, is_sale, is_demand, count(*) FROM fact_order_line GROUP BY 1, 2, 3 ORDER BY 4 DESC;

-- demand this year by branch
SELECT collector_id, sum(quantity) FROM fact_order_line WHERE is_demand AND order_date >= date_trunc('year', current_date) GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

-- the open book: pending quantity by kind
SELECT order_kind, is_inter_company, count(*), sum(pending_qty) FROM fact_open_order GROUP BY 1, 2 ORDER BY 3 DESC;
```

---

## dispatch_master  `04_dispatch_master.sql`

```text
  Dispatches ─────────┐
  DispatchDetails ────┤
  SaleOrderHdrs/Dtls ─┼──► fact_dispatch (materialized)       what actually shipped
  v_transaction_type ─┘             │
                                    ▼
  Schedules ──────────────► fact_schedule_line (materialized)  planned vs shipped, open balance, on-time
  SocCancelDetails ───────► fact_order_cancellation           cancel requests and their approval
  Reasons ────────────────┘
```

### fact_dispatch - what actually shipped  (materialized)

| | |
| --- | --- |
| one row per | dispatched line, Performance Chemicals products since 2021 |
| join on | `item_id` → dim_item · `customer_id` → dim_customer · `ship_to_site_use_id` → dim_customer_site · `collector_id` → dim_collector · `inventory_org_id` → InventoryOrgs · `order_line_id` → fact_order_line · `schedule_line_id` → fact_schedule_line |
| answers | what shipped, when, to whom, from where, how much, worth what - the sales history |

| column | meaning | example |
| --- | --- | --- |
| `line_id`, `dispatch_id` | the line and its dispatch note | |
| `dispatch_date` | the day the goods left - the date axis | 2026-08-14 |
| `invoice_date`, `invoice_number` | the oracle invoice, empty until invoiced | |
| `dispatch_status` | Pending / Confirmed / MoveToOracle (invoiced) / InvoiceCancel | MoveToOracle |
| `is_confirmed`, `is_cancelled` | the note's confirm flag; cancelled by status or by oracle | true, false |
| **`counts_as_dispatched`** | confirmed and not cancelled - the goods really left. **Filter on this for "shipped"** | true |
| `customer_id`, `bill_to_site_use_id`, `ship_to_site_use_id`, `collector_id`, `inventory_org_id` | who, where to, which branch, which warehouse | |
| `order_id`, `order_line_id`, `schedule_line_id` | what it fulfils | |
| `transaction_type`, `order_kind`, `is_sale`, `is_demand`, `is_inter_company` | the same flags as the order views, inherited from the order | sale, true, true, false |
| `item_id`, `order_item_id`, `is_substitution` | what shipped vs what was ordered | |
| `sale_category`, `trading_manufacture`, `uom` | Intact / Repack / Bulk ..; Trading / Manufacturing; unit (folded) | |
| `quantity`, `scheduled_qty` | what shipped, what was scheduled for it | 500, 500 |
| `unit_price`, `has_price`, `line_value` | tax exclusive; `line_value` = qty × price (crm's total_value, reliable here), empty when unpriced | |
| `tax_percentage`, `packing_cost`, `created_at` | | |

**Rules baked in**

```text
  does this line count as shipped ?
        │
  note confirmed (flag = Y) ? ──no──► counts_as_dispatched = false
        │
       yes
        ▼
  note cancelled (status InvoiceCancel, or oracle CANCELLED) ? ──yes──► false
        │
       no ──► true          (crm's rule, fn_SOCScheduleQty)
```

- `item_id` is the product that **shipped**; when a different product was ordered, `is_substitution` is true and `order_item_id` holds the ordered one.
- `is_sale` / `is_demand` / `is_inter_company` come from the order header through `v_transaction_type` - one decision for orders, dispatches and quotes.
- dispatch value is trustworthy (unlike order value): crm's `total_value` equals qty × price on every line.

### fact_schedule_line - planned vs shipped, per schedule line  (materialized)

| | |
| --- | --- |
| one row per | schedule line (the planned dispatch of an order line) |
| join on | `order_line_id` → fact_order_line · `schedule_line_id` ← fact_dispatch · `item_id`, `customer_id`, `collector_id`, `inventory_org_id` → the dims |
| answers | what is still open, was it on time, was it rescheduled and why, was it cancelled |

| column | meaning | example |
| --- | --- | --- |
| `schedule_line_id`, `order_id`, `order_line_id` | the line and its order | |
| `schedule_date`, `reschedule_date`, **`effective_date`** | planned date, moved-to date, the one that counts | |
| `is_rescheduled`, `reschedule_reason` | moved? why (Customer Requested, Stock Not Available, Logistics Issue ..) | |
| `customer_requested_date` | what the customer asked for - the on-time reference | |
| `schedule_status`, `is_confirmed` | Pending / ReSchedule / Reject / Confirmed / Closed / SOCConfirmed / Cancelled - **not** an open flag | SOCConfirmed |
| `customer_id`, `bill_to_site_use_id`, `ship_to_site_use_id`, `collector_id`, `inventory_org_id`, `item_id` | the dims | |
| `order_kind`, `is_demand`, `is_inter_company`, `sale_category` | as on the order | |
| `scheduled_qty`, `dispatched_qty`, **`balance_qty`** | planned, really shipped (confirmed, not cancelled), left | 1000, 600, 400 |
| `unit_price`, `has_price`, `balance_value` | balance × price | |
| **`is_open`** | crm's open rule (see below) | |
| `has_approved_cancellation`, `has_pending_cancellation`, `cancelled_qty` | cancellations on the order line | |
| `first_dispatch_date`, `last_dispatch_date` | when it shipped | |
| `days_vs_requested`, `days_vs_scheduled` | first dispatch minus requested / effective date. > 0 = late | -2 |

**Open, the way crm computes it**

```text
  order line status = OPEN ?
        │ yes
  schedule not Reject / Closed / Cancelled ?
        │ yes
  scheduled_qty − dispatched_qty > 0 ?
        │ yes
        ▼
     is_open = true
        │
        │  for OPEN DEMAND (what crm feeds its forecasting with) add:
        ▼
  is_demand  AND  NOT has_pending_cancellation
```

- `dispatched_qty` counts only lines with `counts_as_dispatched` - the same rule as fact_dispatch.
- on-time delivery: `days_vs_requested <= 0`. Empty until something ships.

### fact_order_cancellation - requests to drop an order line

| | |
| --- | --- |
| one row per | cancellation request |
| join on | `order_line_id` → fact_order_line · `customer_id`, `item_id`, `collector_id`, `inventory_org_id` → the dims |
| answers | who wanted to drop what, why, and was it approved |

| column | meaning | example |
| --- | --- | --- |
| `cancellation_id`, `order_id`, `order_line_id`, `schedule_line_id` | the request and what it is on | |
| `requested_date`, `decided_date` | raised, decided | |
| `approval_status`, `is_approved`, `is_pending` | Approved / Rejected / Referred back / Awaiting / Draft | Approved |
| `reason` | Incorrect SOC Details / Duplicate SOC / Order Lost / Partial Quantity / Amended PO .. (from `Reasons`) | Duplicate SOC |
| `comment` | free text | |
| `customer_id`, `item_id`, `inventory_org_id`, `collector_id`, `sale_category` | the dims | |
| `schedule_date`, `scheduled_qty`, `shipped_qty`, **`remaining_qty`** | what was planned, what had shipped, what is being cancelled | |

- an **approved** request means `remaining_qty` will never ship; a **pending** one keeps the line out of open demand (crm's rule).

**Quick checks** (pgAdmin, after `SET search_path TO ponpure_planner;`)

```sql
-- shipped demand by month, this year
SELECT date_trunc('month', dispatch_date)::date AS month, sum(quantity) FROM fact_dispatch
WHERE counts_as_dispatched AND is_demand AND dispatch_date >= date_trunc('year', current_date) GROUP BY 1 ORDER BY 1;

-- the open book, crm's forecasting rule
SELECT collector_id, count(*), sum(balance_qty) FROM fact_schedule_line
WHERE is_open AND is_demand AND NOT has_pending_cancellation GROUP BY 1 ORDER BY 3 DESC LIMIT 10;

-- on-time rate by month
SELECT date_trunc('month', effective_date)::date AS month,
       round(100.0 * count(*) FILTER (WHERE days_vs_requested <= 0) / nullif(count(*) FILTER (WHERE days_vs_requested IS NOT NULL), 0), 1) AS on_time_pct
FROM fact_schedule_line WHERE is_demand AND effective_date >= date_trunc('year', current_date) GROUP BY 1 ORDER BY 1;

SELECT approval_status, reason, count(*) FROM fact_order_cancellation GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;
```

---

## quotation_master  `05_quotation_master.sql`

```text
  QuotationHdrs ──────┐
  QuotationDtls ──────┤
  QuotationStatus ────┼──► fact_quote_line (materialized)   every quote line, conversion resolved
  v_transaction_type ─┤
  SaleOrderDtls ──────┘   (which order line came from which quote line)
```

### fact_quote_line - every quote line, and what became of it  (materialized)

| | |
| --- | --- |
| one row per | quotation line, Performance Chemicals products since 2021 |
| join on | `item_id` → dim_item · `customer_id` → dim_customer · `ship_to_site_use_id` → dim_customer_site · `collector_id` → dim_collector · `mc_code` → dim_market_circle · `order_line_id` → fact_order_line |
| answers | what was quoted, to whom, at what price; did it become an order; what is still open |

| column | meaning | example |
| --- | --- | --- |
| `line_id`, `quote_id`, `quote_number` | the line and its quote | |
| `quote_date`, `quote_created_at`, `quote_updated_at`, `revised_count` | dates and revisions | |
| `is_prequote`, `is_back_to_back`, `quote_creation_type` | header flags | |
| `customer_id`, `bill_to_site_use_id`, `ship_to_site_use_id`, `collector_id`, `mc_code` | who and where | |
| `organization_id`, `currency` | legal entity, currency | |
| `transaction_type`, `order_kind`, `is_sale`, `is_demand`, `is_inter_company`, `is_cogt` | the same flags as orders and dispatches | |
| `quote_status`, `quote_status_id` | the state of the quote: Open / WaitingForApproval / Approved / Confirmed / Rejected / Closed ... | Closed |
| `is_close_initiated` | someone started closing it | |
| `line_status`, `line_status_id` | the line's own status - only meaningful inside a live quote | Confirmed |
| `is_live` | not Closed / Rejected / Cancelled | false |
| **`is_open_pipeline`** | crm's rule: quote and line Confirmed, no order yet | false |
| **`is_converted`**, `order_id`, `order_line_id`, `order_line_count` | became an order? which one? | true |
| `days_to_convert` | quote date → first order, in days | 0 |
| `item_id`, `sale_category`, `uom` | the product, Intact / Repack / Bulk .., unit (folded) | |
| `quantity`, `unit_price`, `has_price`, `line_value`, `line_value_crm` | the measure; value = qty × price, empty when unpriced | |
| `discount_pct`, `discount_value`, `tax_pct` | pricing details | |
| `delivery_date`, `delivery_from_id`, `inventory_org_id` | the delivery quoted | |

**What a quote is here**

```text
  quote raised ──► Confirmed ──► order raised the same day ──► quote Closed
                       │
                       └── no order (yet) ──► is_open_pipeline     (crm's projection input)

  Rejected / ReferredBack / Open / Approved ──► is_live, not in the pipeline until Confirmed
```

- `Closed` = converted. There is no "lost" status: a quote that never converted stays `Confirmed` or `Approved`.
- median `days_to_convert` is 0 - quotes are raised with the order. Conversion rate by product or branch is `count(is_converted) / count(*)`.
- `is_open_pipeline` follows `FN_PCProjection_GetConfirmedQuotationQuantity` exactly: header Confirmed **and** line Confirmed **and** no order on the quote.
- `line_status` stays `Confirmed` after conversion - use `quote_status` for the state.
- the header's flags (`is_sale` / `is_demand` / `is_inter_company`) come from `v_transaction_type`, like everywhere else.

**Quick checks** (pgAdmin, after `SET search_path TO ponpure_planner;`)

```sql
-- must agree with crm's projection input: confirmed quotes with no order
SELECT count(DISTINCT quote_id), sum(quantity) FROM fact_quote_line WHERE is_open_pipeline;

-- open pipeline by branch, customer demand only
SELECT collector_id, count(DISTINCT quote_id), sum(quantity) FROM fact_quote_line
WHERE is_open_pipeline AND is_demand GROUP BY 1 ORDER BY 3 DESC LIMIT 10;

-- conversion rate by month
SELECT date_trunc('month', quote_date)::date AS month,
       round(100.0 * count(*) FILTER (WHERE is_converted) / count(*), 1) AS converted_pct
FROM fact_quote_line WHERE is_demand AND quote_date >= date_trunc('year', current_date) GROUP BY 1 ORDER BY 1;
```

---

## business_plan - part 1: calendar, actuals, product names, baselines  `06_business_plan.sql`

```text
JourneyCalendars
      │
      ▼
   dim_jc ───────────────────────────────────────────────┐
      │                                                  │
      │                                                  ▼
fact_dispatch ──► fact_actual_jc (mat.) ───────► v_plan_product_mix
      │                    │
      │                    │
      │                    ├──────────────► fact_forecast_baseline_item (mat.)
      │                    │
      │                    └──────────────► fact_forecast_baseline_name (mat.)
      │
      │
SPBusinessPlanActualSales
      │
      ▼
fact_actual_jc_crm (mat.)
      │
      └──────────────────────┐
                             ▼
fact_actual_jc ─────────► v_actual_bridge
      │                       │
      │                       └─ ours vs CRM + gap
      │
      │
ItemMasters + plan tables
      │
      ▼
dim_plan_product (mat.)
      │
      └─ product NAME → item(s)
```

**Two facts that shape everything here**

- crm plans and measures by **product name**, never by item id. Names are matched lower-case and trimmed on both sides.
- the human plan is a weaker predictor than a naive forecast at cycle grain (see the baselines). The forecast layer is built on actuals history; the plan is a feature and an override, not the engine.

### dim_jc - the cycle calendar

| | |
| --- | --- |
| one row per | journey cycle (JC): ~4 weeks, 13 a year, contiguous since 2013; plus the `-1` unknown |
| join on | `jc_id` |
| answers | which cycle is a date in, which is current, which was the same cycle last year |

| column | meaning | example |
| --- | --- | --- |
| `jc_id`, `jc_name`, `jc_no`, `acc_year` | the cycle | 178, JC7, 7, 2026-2027 |
| `jc_seq` | running number across all cycles - `n-1` is the previous, `n-13` the same cycle last year | 176 |
| `jc_start`, `jc_end`, `days`, `year_start`, `year_end` | dates | |
| `is_current`, `is_completed`, `is_future` | where today falls | |
| `prev_jc_id`, `next_jc_id`, `same_jc_last_year_id` | the links | |

### fact_actual_jc - what shipped, per cycle  (materialized)

| | |
| --- | --- |
| one row per | cycle × product × branch × customer × warehouse × (order kind, inter-company, e-commerce) |
| join on | `jc_id` → dim_jc · `item_id` → dim_item · `name_key` → dim_plan_product · `collector_id`, `customer_id`, `inventory_org_id` → the dims |
| answers | how much of a product a branch shipped in a cycle - in whichever universe a report needs |

| column | meaning |
| --- | --- |
| `quantity`, `value_inr`, `dispatch_lines` | the measures (confirmed dispatches only) |
| **`is_demand`** | customer demand: sales and exports, not inter company. **The universe for forecasting** |
| **`in_crm_universe`** | what crm's plan actuals count: everything invoiced except e-commerce (samples, cogt, group company included) |
| `is_ecommerce`, `is_sample`, `is_inter_company`, `order_kind` | the flags behind those two |

### fact_actual_jc_crm - crm's own actuals  (materialized)

| | |
| --- | --- |
| one row per | cycle × product name × branch × customer, from `SPBusinessPlanActualSales` unpivoted |
| answers | what crm's plan screens show as "actual" |

- from Oracle invoices: net of returns, e-commerce excluded, **no transaction-type filter**; `value_inr` = crm's lakhs × 100,000.

### v_actual_bridge - ours vs theirs

| | |
| --- | --- |
| one row per | product name × branch × cycle (full outer join) |
| answers | why our number and crm's number differ for the same product, branch and cycle |

```text
  our_demand_qty            what a planner should forecast (is_demand)
  our_crm_universe_qty      our dispatches restricted to what crm counts
  crm_qty                   crm's actual
  gap_qty                   crm − ours (crm universe): returns netted by crm, invoice-vs-dispatch timing,
                            substitutions, name spelling
  our_ecommerce_qty / our_sample_qty / our_inter_company_qty   the pieces that explain the rest
```

- never expected to be zero; today the two agree within a few percent per cycle.

### dim_plan_product - the product NAME and the items behind it  (materialized)

| | |
| --- | --- |
| one row per | product name seen in the plan, the projection, crm's actuals or the item master |
| join on | `name_key` |
| answers | which items does this planned name stand for, and can their quantities be added up |

| column | meaning |
| --- | --- |
| `name_key`, `product_name` | the key and the display spelling |
| `is_in_item_master`, `item_count`, `item_ids`, `primary_item_id` | the items (primary = the one that shipped most) |
| `has_several_items`, **`is_mixed_uom`**, `spans_item_groups` | the names whose items must not simply be summed |
| `uom`, `item_group`, `business` | when consistent across the items |
| `is_performance_chemicals`, `is_usable`, `is_temp_item`, `temp_item_id` | flags |
| `used_in_plan`, `used_in_projection`, `used_in_crm_actuals` | where the name appears |

### v_plan_product_mix - splitting a name into items

| | |
| --- | --- |
| one row per | product name × branch × item |
| answers | how to turn a name-level plan or forecast into item-level numbers |

- `share` = the item's share of the name at that branch over the last four completed cycles; all-time share as fallback. Shares sum to 1 per name × branch.

### fact_forecast_baseline_item / _name - the accuracy harness  (materialized)

| | |
| --- | --- |
| one row per | product × branch × cycle (item grain), or product name × branch × cycle (name grain), for every pair with demand since 2022-23, every cycle from then to three ahead |
| answers | how good is a forecast, and what would the simplest forecasts have said |

| column | meaning |
| --- | --- |
| `actual_qty` | customer demand in the cycle (0 when nothing shipped; empty on future cycles) |
| `naive_qty` | the same cycle a year earlier |
| `avg4_qty`, `avg4_nonzero_qty` | average of the previous four cycles - plain, and over non-zero cycles (crm's way) |
| `naive_abs_error`, `avg4_abs_error`, `avg4_nonzero_abs_error` | abs(actual − forecast), on completed cycles |
| `is_completed`, `is_current`, `is_future` | cycle state |

**How to read accuracy** - two conventions, say which one you use:

```text
  WAPE = sum(abs error) / sum(actual)   over a slice (a year, a branch, a business ..)

  "where both exist"   rows with actual > 0 AND forecast > 0     - how good is the forecast on what it covers
                        + coverage = share of demand in those rows - how much it covers
  "all rows"           every completed row, zeros included       - one number, harsher (misses count fully)
```

- the review's figures (naive ≈ 60% WAPE, ≈ 70% coverage) are the "where both exist" convention.

**Quick checks** (pgAdmin, after `SET search_path TO ponpure_planner;`)

```sql
SELECT jc_name, acc_year, jc_start, jc_end FROM dim_jc WHERE is_current;

-- ours vs crm, last year, by cycle
SELECT b.jc_no, round(sum(our_crm_universe_qty)::numeric), round(sum(crm_qty)::numeric)
FROM v_actual_bridge b JOIN dim_jc j USING (jc_id) WHERE b.acc_year = '2025-2026' GROUP BY 1 ORDER BY 1;

-- naive baseline, last year, where both exist: WAPE and coverage
SELECT round(100.0 * sum(naive_abs_error) / sum(actual_qty), 1) AS wape_pct,
       round(100.0 * sum(actual_qty) / (SELECT sum(actual_qty) FROM fact_forecast_baseline_name WHERE acc_year = '2025-2026' AND is_completed), 1) AS coverage_pct
FROM fact_forecast_baseline_name WHERE acc_year = '2025-2026' AND is_completed AND actual_qty > 0 AND naive_qty > 0;
```

---

## business_plan - part 2: the plans, open leads, plan vs actual, accuracy  `06_business_plan.sql`

```text
SCBusinessMonthlyPlanHdrs + Dtls
              │
              ▼
     fact_plan_jc (mat.)
              │
SCBusinessMonthlyPlanJCDtls
              │
              ▼
 fact_plan_forecast (mat.)
              │
SCLeadTargets + LeadDetails
              │
              ▼
  fact_lead_plan_jc
              │
SCBusinessPlanProjections
              │
              ▼
 fact_projection_jc
              │
              └──────────────┐
                             ▼
                  fact_plan_name_jc (mat.)
                    name × branch × cycle
                             │
LeadProducts + LeadDetails   │
              │              │
              ▼              │
      fact_open_lead         │
                             │
                             ▼
fact_plan_name_jc ───────────┼──► v_plan_vs_actual
fact_actual_jc ──────────────┤      CRM projection report
fact_actual_jc_crm ──────────┤
fact_schedule_line ──────────┤
fact_quote_line ─────────────┤
fact_open_lead ──────────────┘

fact_plan_name_jc
        │
        ├────► fact_forecast_baseline_name
        │
        ▼
v_forecast_accuracy
(plan vs baseline scoreboard)
```

**Three rules baked in**

- **status era**: `jcN_status` changed meaning in April 2025. Up to 2024-25 code 4 was the approved plan; from 2025-26 code 5 is, and 4 means waiting. `is_approved` applies the rule; crm's own screens filter `= 5` and cannot show the older years.
- **approved is not planned**: a header can be approved for a cycle with no quantity in it. `has_plan` (a quantity exists) and `is_approved` (the workflow passed) are separate flags. Use both.
- **re-saves folded**: a few plan headers carry thousands of identical detail rows. Folded by max per header × cycle; `detail_rows` says how many were folded.

### fact_plan_jc - the customer plan, long  (materialized)

| | |
| --- | --- |
| one row per | plan header (year × customer × branch × product name) × cycle that carries anything |
| join on | `jc_id` → dim_jc · `name_key` → dim_plan_product · `customer_id` → dim_customer (`-1` = prospect) · `collector_id` → dim_collector · `plan_id` → the crm header |
| answers | what was planned for whom, per cycle; was it approved; was anything planned at all |

| column | meaning |
| --- | --- |
| `week1_qty`, `week2_qty`, **`plan_qty`** | planned quantity per fortnight and for the cycle (their sum) |
| `avg_sell_price`, `plan_value` | planned price per unit; `plan_qty × price`, empty when unpriced. The crm value columns are never read (mixed units) |
| `achieved_qty` | what crm recorded as achieved - sparse, prefer the actuals tables |
| `status`, `status_label`, **`is_approved`**, **`has_plan`** | the workflow state, decoded era-aware, and the two independent flags |
| `is_prospect`, `prospect_name`, `prospect_mc_code` | plans for customers not yet in the master |
| `is_new_customer`, `is_key_customer`, `is_new_item` | the planner's flags |
| `segment2`, `segment3`, `segment4`, `category_id` | how the planner classified the product (crm joins names on these too) |

### fact_plan_forecast - the planner's rolling forecast  (materialized)

| | |
| --- | --- |
| one row per | plan line × cycle it was made in × horizon (1 = next cycle, 2 = the one after) |
| join on | `target_jc_id` → dim_jc (the cycle it predicts) · `made_in_jc_id` → dim_jc · `plan_id` → fact_plan_jc |
| answers | in cycle n, what did the planner expect for n+1 and n+2 - and how right was it (join actuals on the target) |

- `made_in_unknown_jc`: crm did not record the cycle for some rows; their target is unknown.

### fact_lead_plan_jc - the lead plan

| | |
| --- | --- |
| one row per | lead plan line × cycle, same shape and flags as fact_plan_jc |
| join on | `lead_id` → LeadDetails · `item_id` / `temp_item_id` · `collector_id`, `customer_id` from the lead |
| answers | what the branches expect from leads (prospects and new products), per cycle |

- `counts_for_crm`: crm's projection drops closed and rejected leads - the flag says which ones it keeps.

### fact_projection_jc - what crm published

| | |
| --- | --- |
| one row per | product name × branch × cycle × type (`PC` from customer plans, `Lead` from lead plans) |
| answers | what crm handed to oracle for supply |

- computed by crm when it publishes: matches today's approved plan for the current cycle, drifts on cycles whose plans were edited afterwards. For the detail use the two plan tables; use this to see what was actually sent.

### fact_plan_name_jc - the plan side at report grain  (materialized)

| | |
| --- | --- |
| one row per | product name × branch × cycle |
| join on | `name_key`, `collector_id`, `jc_seq` - the same key as fact_forecast_baseline_name (the actual side) |
| answers | everything the plan says about a product at a branch in a cycle, in one row |

| column | meaning |
| --- | --- |
| `plan_qty`, `plan_qty_unapproved`, `plan_value`, `plan_lines`, `plan_customers` | the approved customer plan and what is behind it |
| `forecast_h1_qty`, `forecast_h2_qty` | the planner's forecast for this cycle, made one / two cycles earlier |
| `lead_plan_qty` | the approved lead plan (leads crm counts) |
| `projection_pc_qty`, `projection_lead_qty` | crm's published projection |

### fact_open_lead - the open lead book

| | |
| --- | --- |
| one row per | product on a lead that is neither converted nor closed |
| join on | `lead_id` · `item_id` → dim_item (empty for temp items) · `name_key` · `collector_id` · `customer_id` |
| answers | which leads are open, for what, how much, how old |

- `lead_qty` is what crm's report counts as open lead quantity (real items only); `is_temp_item`, `in_pc_plan`, `sample_requested`, `lead_age_days` on the side.

### v_plan_vs_actual - crm's projection report, rebuilt

| | |
| --- | --- |
| one row per | product name × branch × cycle, from the same cycle last year to three cycles ahead |
| answers | is the plan for this product at this branch reasonable against history, and what is already in the book |

```text
  the plan        plan_qty (approved) · plan_qty_unapproved · forecast_h1_qty · forecast_h2_qty
                  lead_plan_qty · projection_pc_qty · projection_lead_qty
  the actual      crm_actual_qty · our_actual_qty                         (cycles that have started)
  the history     crm_prev4_qty · crm_prev4_avg_qty · crm_prev4_avg_nonzero_qty · crm_naive_qty
                  our_prev4_qty · our_prev4_avg_qty · our_prev4_avg_nonzero_qty · our_naive_qty
  crm's % diff    plan_vs_avg_pct = (plan − crm non-zero average of the previous four cycles) / that average
  today's book    open_soc_qty · open_soc_qty_crm_rule · confirmed_quote_qty · open_lead_qty · open_lead_qty_incl_temp
                  (only on cycles not yet completed - these are today numbers, not cycle numbers)
```

- `open_soc_qty` is our rule: open schedule lines that are customer demand with no pending cancellation. `open_soc_qty_crm_rule` is crm's looser count (every open line). The second is always the larger.
- `primary_inventory_org_id`: the warehouse serving the branch today (latest open mapping); a branch can have several.

### v_forecast_accuracy - the scoreboard

| | |
| --- | --- |
| one row per | accounting year × branch (`collector_id` empty = all branches) × method |
| methods | `naive`, `avg4`, `avg4_nonzero` (the baselines) · `plan` (approved plan) · `forecast_h1`, `forecast_h2` (the planner's forecasts) |
| actual | our customer demand at product name × branch × cycle, completed cycles from 2022-23 |

| column | meaning |
| --- | --- |
| `coverage_pct` | share of the demand that fell in rows where the method gave a number - the rest it missed entirely |
| `wape_pct_where_both`, `bias_pct_where_both` | error and bias on the rows it covered (the "where both exist" convention) |
| `wape_pct_all_rows`, `bias_pct_all_rows` | the same over every row, a missing forecast counted as zero (the harsh convention) |
| `rows_all`, `rows_with_demand`, `rows_with_forecast`, `rows_both`, `actual_qty`, `forecast_qty` | the counts behind the percentages |

- lower WAPE is better; bias above zero means over-forecast. Always say which convention a number uses.
- what it shows today, in words: the four-cycle average is the best of the simple methods, the naive forecast next, the human plan and the planner's forecasts behind both - and the plan covers well under half of the demand.

**Quick checks** (pgAdmin, after `SET search_path TO ponpure_planner;`)

```sql
-- approved vs planned, by year
SELECT acc_year, count(*) FILTER (WHERE is_approved) AS approved_cells, count(*) FILTER (WHERE has_plan) AS planned_cells,
       count(*) FILTER (WHERE is_approved AND has_plan) AS both
FROM fact_plan_jc GROUP BY 1 ORDER BY 1;

-- the current cycle, biggest plans first
SELECT product_name, branch_name, plan_qty, forecast_h1_qty, crm_prev4_avg_nonzero_qty, plan_vs_avg_pct, open_soc_qty, confirmed_quote_qty, open_lead_qty
FROM v_plan_vs_actual WHERE is_current ORDER BY plan_qty DESC LIMIT 20;

-- the scoreboard, last year, all branches
SELECT method, coverage_pct, wape_pct_where_both, bias_pct_where_both, wape_pct_all_rows
FROM v_forecast_accuracy WHERE acc_year = '2025-2026' AND collector_id IS NULL ORDER BY wape_pct_where_both;
```
