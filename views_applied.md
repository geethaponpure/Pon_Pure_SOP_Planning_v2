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
| materialized | a view that is slow to compute is made `MATERIALIZED` (it holds its rows): rebuilt at api start like the others, and refreshed at the end of every etl run. Marked **(materialized)** below |
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
