# Database overview

Our planning database is a copy of the CRM data that the planning tool needs, refreshed from the CRM automatically. It holds 38 tables grouped into 9 areas. The master lists (products, customers, warehouses, people) are copied in full. The large history tables are limited to the Performance Chemicals business - order lines and the open order book for PC products, dispatches and quotations from 2021, stock from 2024.

This page explains, in plain words, what each area and each table contains. The technical detail (how the tables connect, known data quirks) is in `relationship.md`.

---

## 1. item_master - what we sell

The products, how they are classified, and whether we buy them against an order or keep them in stock.

- **ItemMasters** - the product list: code, name, unit of measure, active or not.
- **ItemCategories** - the classification of each product: division, business, category, family.
- **PurchaseRequisitionPtoPts** - whether a product is purchase-to-order or purchase-to-stock, month by month.

    - PTO (Purchase To Order): few customers buy most of the product → purchase when ordered.
    - PTS (Purchase To Stock): many customers buy it → keep it in stock.
    - Because this answers “should we stock this product?”

## 2. customer_master - who we sell to, and who looks after them

The customers, the places we deliver to and bill, and the sales territories above them.

- **CustomerMasters** - the customer list: name, account number, group, status.
- **CustomerSites** - the customers' billing and delivery addresses.
- **MarketCircles** - the sales circles (territories) and their regions.
- **Collectors** - the branches.
- **tempcustomers** - the leads' details: branch, sales circle, industry segment, address (a lead has no sites yet).
- **ArCustomers** - Oracle's record of each real customer: legal form, industrial segment, division.

## 3. sales_order_soc - what customers have ordered

The order history, and what is still open today.

- **SaleOrderHdrs** - the orders: customer, locations, branch, PO reference, order type.
- **SaleOrderDtls** - the product lines inside each order: product, quantity, price, value.
- **SocPendingDetails** - the open order book as of today: what is ordered, scheduled, dispatched and still pending.

## 4. dispatch_master - what actually shipped

The planned and actual deliveries against the orders, and the cancellations.

- **Schedules** - the planned dispatch date for each order line, with reschedules and reasons.
- **Dispatches** - the dispatch notes (invoices): number, date, status.
- **DispatchDetails** - what was actually delivered: product, quantity, value, date, warehouse.
- **SocCancelDetails** - order lines that were cancelled or closed, with the reason.
- **DeliveryFroms** - the list of delivery points.

## 5. quotation_master - what we offered before it became an order

The sales pipeline: quotes given to customers.

- **QuotationHdrs** - the quotations: customer, locations, branch, circle, status.
- **QuotationDtls** - the product lines quoted: product, quantity, price, discount.
- **QuotationStatus** - the list of quotation statuses.

## 6. business_plan - what the sales team plans to sell

The monthly plan the branches fill in for their customers, cycle by cycle. A JC (journey cycle) is a four-week selling period.

- **SCBusinessMonthlyPlanHdrs** - the plan header: year, customer, branch, product category, yearly potential and budget.
- **SCBusinessMonthlyPlanDtls** - the plan itself: planned and achieved quantity for each cycle.
- **SCBusinessMonthlyPlanJCDtls** - the forecast entered in each cycle for the coming months.
- **JourneyCalendars** - the cycle calendar: start and end date of every JC.

## 7. purchase_master - what we buy and from whom

The supply side: purchase orders, internal purchase requests and suppliers.

- **BiPoDetails** - purchase order lines: supplier, product, quantity ordered and received, price, receiving warehouse.
- **PurchaseRequisitionHdrs** - purchase requests raised by the branches: supplier, warehouse, terms, status.
- **PurchaseRequisitionDtls** - the product lines requested, and which customer or order they are for.
- **ApSuppliers** - the supplier list.

## 8. inventory_master - what is in stock and where

Stock on hand, the warehouses, and which products belong in which warehouse.

- **InventoryOrgs** - the warehouses: code, name, city, state, active or not.
- **BiStockDetail** - the daily stock position: quantity, cost and age of every lot in every warehouse.
- **ItemInventoryOrgMappings** - which products may be stocked in which warehouse.
- **BiCollectorInventoryOrgMapping** - which warehouse serves which branch.

## 9. user_and_scope - who uses the system and what they may see

The people, their roles, and what each person is responsible for.

- **Users** - the people with a CRM login: name, email, designation, department, manager.
- **Roles** - the job roles: Sales Executive, Technical Executive, Branch Manager and so on.
- **UserRoles** - which role each person has.
- **UserMarketCircleMappings** - which sales circle each Sales Executive is responsible for.
- **UserCollectorMappings** - which branches each back-office person may see.
- **UserCustomerMappings** - which customers each Technical Executive looks after.
- **CollectorMailMappings** - the management chain of each branch: branch manager, regional manager and above.
- **TechnicalUserSegmentMappings** - which product segments and branches each Technical Manager or Head covers.
