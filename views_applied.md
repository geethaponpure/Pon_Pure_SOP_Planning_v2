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
