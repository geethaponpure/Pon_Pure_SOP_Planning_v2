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



















| Level | Table | PK | Filter | Stage fixes | Seed | Children |
|---:|---|---|---|---|---|---|
| 0 | Collectors | `collector_id` | – | – | – | MarketCircles, CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails |
| 0 | CustomerMasters | `header_id` | – | `0` → NULL on customer_id, customer_number | `unknown` (-1) | CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails |
| 0 | ItemMasters | `item_id` | – | – | – | ItemCategories, PurchaseRequisitionPtoPts, SaleOrderDtls |
| 1 | MarketCircles | `header_id` | – | lower/trim | `unknown` (-1) | CustomerSites, SaleOrderHdrs, SaleOrderDtls, SocPendingDetails |
| 1 | ItemCategories | `header_id` | PC only | drop orphans | – | – |
| 1 | PurchaseRequisitionPtoPts | `Header_id → header_id` | – | – | – | – |
| 2 | CustomerSites | `line_id` | – | lower/trim + `unknown`, drop duplicate site_use_id | `unknown` (-1) | SaleOrderHdrs, SaleOrderDtls, SocPendingDetails |
| 3 | SaleOrderHdrs | `header_id` | – | missing site → `-1` on bill_to / ship_to | – | SaleOrderDtls, SocPendingDetails |
| 4 | SaleOrderDtls | `line_id` | – | `CLOSE` → `Closed` | – | – |
| 4 | SocPendingDetails | `id` (ours, snapshot) | – | lower/trim + `unknown` on market_circle | – | – |
