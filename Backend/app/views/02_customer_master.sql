-- customer_master views. run by app/repositories/views.py at api start, in file name order.
-- one statement per ';'. plain views are dropped and recreated every start.
--
-- the shape of this cluster:
--   a customer is either a real customer (oracle id, sites, an ArCustomers row) or a lead (none of those, its
--   details live in tempcustomers). territory belongs to the SITE: every order / quote / plan / dispatch points
--   at a site (site_use_id), the site sits in a circle, the circle belongs to a branch. a site can also carry
--   its own branch (bill-to sites do) - crm's own customer -> branch rule reads that one first.


-- ---------------------------------------------------------------------------------------------------------------
-- dim_collector: one row per branch, all of them (history points at retired ones too).
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_collector CASCADE;

CREATE VIEW dim_collector AS
SELECT c.collector_id,
       c.name                                          AS branch_name,
       coalesce(c.status = 'A', false)                 AS is_active,
       coalesce(c.isoverseascollector, false)          AS is_overseas,
       coalesce(c.isgroupcompanycollector, false)      AS is_group_company,
       c.name = 'OBSOLETE'                             AS is_obsolete,
       coalesce(m.circle_count, 0)                     AS circle_count,
       CASE WHEN c.isgroupcompanycollector THEN 'group company'
            WHEN c.name = 'OBSOLETE'       THEN 'obsolete'
            WHEN c.isoverseascollector     THEN 'export / special channel'
            WHEN m.circle_count > 0        THEN 'domestic'
            ELSE                                'retired or unused' END AS branch_group,
       c.creation_date,
       c.last_update_date
FROM "Collectors" c
LEFT JOIN (SELECT collector_id, count(*) AS circle_count FROM "MarketCircles" GROUP BY 1) m ON m.collector_id = c.collector_id;

COMMENT ON VIEW dim_collector IS 'The branches (crm calls them collectors), one row each, including retired ones because old orders still point at them. branch_group says what kind of branch it is.';
COMMENT ON COLUMN dim_collector.collector_id IS 'The branch id. Orders, quotes, plans, dispatches, sites and users all carry it.';
COMMENT ON COLUMN dim_collector.branch_name IS 'The branch name, e.g. CHENNAI - I, MUMBAI-II, CORPORATE.';
COMMENT ON COLUMN dim_collector.is_active IS 'crm status A. True for every branch today, kept for when that changes.';
COMMENT ON COLUMN dim_collector.is_overseas IS 'An export or special channel branch (INTERNATIONAL, EXPORTS, country branches, CONSIGNMENT ...). Keep out of domestic planning.';
COMMENT ON COLUMN dim_collector.is_group_company IS 'The one intra-group sales channel (GROUP COMPANY). Not a territory; a large share of orders, and crm''s own sales rules exclude it.';
COMMENT ON COLUMN dim_collector.is_obsolete IS 'The OBSOLETE parking branch: retired customer sites are moved here.';
COMMENT ON COLUMN dim_collector.circle_count IS 'How many sales circles the branch owns. 0 = not a current domestic territory.';
COMMENT ON COLUMN dim_collector.branch_group IS 'domestic = owns circles, the normal case. export / special channel, group company, obsolete = not territories. retired or unused = a branch record with no circles: old branches replaced by new ones (history still points at them) or never used.';
COMMENT ON COLUMN dim_collector.creation_date IS 'When the branch was created in crm.';
COMMENT ON COLUMN dim_collector.last_update_date IS 'When the branch was last changed in crm.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_market_circle: one row per sales circle, with its branch flattened.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_market_circle CASCADE;

CREATE VIEW dim_market_circle AS
SELECT m.header_id                                     AS circle_id,
       m.mc_code,
       m.code                                          AS circle_code,
       CASE WHEN upper(trim(m.region)) IN ('SOUTH', 'WEST', 'NORTH', 'EAST', 'ECO') THEN upper(trim(m.region)) END AS region,
       m.region                                        AS region_raw,
       coalesce(m.is_active, false)                    AS is_active,
       m.mc_code = 'unknown'                           AS is_unknown,
       m.collector_id,
       c.branch_name,
       c.is_overseas,
       c.is_group_company,
       m.creation_date,
       m.last_update_date
FROM "MarketCircles" m
LEFT JOIN dim_collector c ON c.collector_id = m.collector_id;

COMMENT ON VIEW dim_market_circle IS 'The sales circles (territories), one row each, with the branch that owns the circle. Includes the "unknown" circle that sites with no valid circle are put in.';
COMMENT ON COLUMN dim_market_circle.circle_id IS 'crm''s id of the circle (MarketCircles.header_id). User territory mappings point here.';
COMMENT ON COLUMN dim_market_circle.mc_code IS 'The circle code, lower case (che01, aur01 ...). Sites and leads join on this.';
COMMENT ON COLUMN dim_market_circle.circle_code IS 'The short branch prefix of the circle (CHE, AUR ...).';
COMMENT ON COLUMN dim_market_circle.region IS 'SOUTH / WEST / NORTH / EAST, or ECO for e-commerce. Empty for the international, job and map circles, which have no region.';
COMMENT ON COLUMN dim_market_circle.region_raw IS 'The region exactly as crm stores it (has 1, blank and null on the circles without a region).';
COMMENT ON COLUMN dim_market_circle.is_active IS 'crm active flag.';
COMMENT ON COLUMN dim_market_circle.is_unknown IS 'True only for the "unknown" circle.';
COMMENT ON COLUMN dim_market_circle.collector_id IS 'The branch that owns the circle. Empty on the unknown circle.';
COMMENT ON COLUMN dim_market_circle.branch_name IS 'That branch''s name.';
COMMENT ON COLUMN dim_market_circle.is_overseas IS 'The owning branch is an export / special channel.';
COMMENT ON COLUMN dim_market_circle.is_group_company IS 'The owning branch is the group company channel.';
COMMENT ON COLUMN dim_market_circle.creation_date IS 'When the circle was created in crm.';
COMMENT ON COLUMN dim_market_circle.last_update_date IS 'When the circle was last changed in crm.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_customer_site: one row per customer site - THE row every order / quote / plan / dispatch joins to.
-- branch = the site's own branch if it has one, else the circle's branch (crm's rule, then the fallback).
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_customer_site CASCADE;

CREATE VIEW dim_customer_site AS
SELECT s.site_use_id,
       s.line_id                                       AS site_id,
       s.cust_acct_site_id,
       s.header_id                                     AS customer_hdr_id,
       cm.customer_id,
       cm.customer_number,
       cm.customer_name,
       cm.customer_id IS NULL                          AS is_lead,
       s.site_use_code,
       coalesce(s.primary_flag = 'Y', false)           AS is_primary,
       coalesce(s.status = 'A', false)                 AS is_active,
       coalesce(sb.is_obsolete, false)                 AS is_obsolete,
       nullif(trim(s.city), '')                        AS city,
       nullif(trim(s.state), '')                       AS state,
       nullif(trim(s.country), '')                     AS country,
       s.mc_code,
       mc.circle_code,
       mc.region,
       mc.is_unknown                                   AS is_unknown_circle,
       coalesce(s.collector_id, mc.collector_id)       AS collector_id,
       coalesce(sb.branch_name, mc.branch_name)        AS branch_name,
       CASE WHEN s.collector_id IS NOT NULL THEN 'site'
            WHEN mc.collector_id IS NOT NULL THEN 'circle' END AS branch_source,
       coalesce(sb.is_overseas, mc.is_overseas, false) AS is_overseas,
       coalesce(sb.is_group_company, mc.is_group_company, false) AS is_group_company,
       s.creation_date,
       s.last_update_date
FROM "CustomerSites" s
JOIN "CustomerMasters" cm   ON cm.header_id = s.header_id
LEFT JOIN dim_market_circle mc ON mc.mc_code = s.mc_code
LEFT JOIN dim_collector sb     ON sb.collector_id = s.collector_id;

COMMENT ON VIEW dim_customer_site IS 'One row per customer site (a billing or delivery address), with the customer, the circle and the branch flattened onto it. This is the row every order, quote, plan and dispatch joins to on site_use_id. Includes the "unknown" site (-1) that facts point at when crm gave no site.';
COMMENT ON COLUMN dim_customer_site.site_use_id IS 'The site id that facts carry (bill_to_site_id / ship_to_site_id on orders, quotes, plans, dispatches). Join on this.';
COMMENT ON COLUMN dim_customer_site.site_id IS 'crm''s row id of the site (CustomerSites.line_id).';
COMMENT ON COLUMN dim_customer_site.cust_acct_site_id IS 'Oracle''s account-site id. SaleOrderHdrs.cust_acct_site_id carries it; not unique per site.';
COMMENT ON COLUMN dim_customer_site.customer_hdr_id IS 'The customer (CustomerMasters.header_id). Joins dim_customer.';
COMMENT ON COLUMN dim_customer_site.customer_id IS 'The customer''s oracle id. Empty for a lead.';
COMMENT ON COLUMN dim_customer_site.customer_number IS 'The customer''s oracle account number.';
COMMENT ON COLUMN dim_customer_site.customer_name IS 'The customer''s name.';
COMMENT ON COLUMN dim_customer_site.is_lead IS 'True when the customer is still a lead (no oracle id). Leads normally have no sites, so this is rare here.';
COMMENT ON COLUMN dim_customer_site.site_use_code IS 'BILL_TO (billing address) or SHIP_TO (delivery address). A couple of odd values exist (DELIVER_TO, SELF_SERVICE_USER).';
COMMENT ON COLUMN dim_customer_site.is_primary IS 'crm''s primary flag. Not one per customer: a customer can have several primary bill-to sites.';
COMMENT ON COLUMN dim_customer_site.is_active IS 'crm status A.';
COMMENT ON COLUMN dim_customer_site.is_obsolete IS 'The site is parked on the OBSOLETE branch = retired, even when its status still says active.';
COMMENT ON COLUMN dim_customer_site.city IS 'City, blank cleaned to empty.';
COMMENT ON COLUMN dim_customer_site.state IS 'State.';
COMMENT ON COLUMN dim_customer_site.country IS 'Country code, IN for almost all.';
COMMENT ON COLUMN dim_customer_site.mc_code IS 'The site''s sales circle. "unknown" when crm had none or an invalid one.';
COMMENT ON COLUMN dim_customer_site.circle_code IS 'The circle''s short code (CHE, AUR ...).';
COMMENT ON COLUMN dim_customer_site.region IS 'The circle''s region: SOUTH / WEST / NORTH / EAST / ECO, empty for circles without one.';
COMMENT ON COLUMN dim_customer_site.is_unknown_circle IS 'True when the site sits in the "unknown" circle. Some of those still carry a real branch, see branch_source.';
COMMENT ON COLUMN dim_customer_site.collector_id IS 'The site''s branch: the site''s own branch when it has one (bill-to sites), otherwise the circle''s branch. This is what crm''s customer-to-branch rule uses.';
COMMENT ON COLUMN dim_customer_site.branch_name IS 'That branch''s name.';
COMMENT ON COLUMN dim_customer_site.branch_source IS 'Where the branch came from: site (the site''s own collector_id) or circle (through the circle). Empty when neither is known.';
COMMENT ON COLUMN dim_customer_site.is_overseas IS 'The branch is an export / special channel.';
COMMENT ON COLUMN dim_customer_site.is_group_company IS 'The branch is the group company channel.';
COMMENT ON COLUMN dim_customer_site.creation_date IS 'When the site was created in crm.';
COMMENT ON COLUMN dim_customer_site.last_update_date IS 'When the site was last changed in crm.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_customer: one row per customer (real customers and leads), with a "home" territory.
-- home site, first rule that matches, latest site on a tie:
--   1 primary + active + bill-to    2 active + bill-to    3 any active site    4 any site
--   no site at all (leads, a few customers) -> the lead details in tempcustomers
-- MATERIALIZED: ranking every site for every customer costs ~0.5 s per query as a plain view. rebuilt at every
-- api start (the CASCADE on dim_customer_site drops it anyway), refreshed by the etl at the end of every run.
-- ---------------------------------------------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS dim_customer CASCADE;

CREATE MATERIALIZED VIEW dim_customer AS
WITH ranked AS (
    SELECT s.header_id, s.site_use_id,
           CASE WHEN s.primary_flag = 'Y' AND s.status = 'A' AND s.site_use_code = 'BILL_TO' THEN 1
                WHEN s.status = 'A' AND s.site_use_code = 'BILL_TO' THEN 2
                WHEN s.status = 'A' THEN 3
                ELSE 4 END AS rule_no,
           row_number() OVER (PARTITION BY s.header_id ORDER BY
                CASE WHEN s.primary_flag = 'Y' AND s.status = 'A' AND s.site_use_code = 'BILL_TO' THEN 1
                     WHEN s.status = 'A' AND s.site_use_code = 'BILL_TO' THEN 2
                     WHEN s.status = 'A' THEN 3
                     ELSE 4 END, s.line_id DESC) AS rn
    FROM "CustomerSites" s
),
home AS (
    SELECT r.header_id, r.site_use_id, r.rule_no
    FROM ranked r WHERE r.rn = 1
),
site_stats AS (
    SELECT s.header_id,
           count(*)                                    AS site_count,
           count(*) FILTER (WHERE s.status = 'A')      AS active_site_count,
           count(DISTINCT coalesce(s.collector_id, m.collector_id)) AS branch_count
    FROM "CustomerSites" s
    LEFT JOIN "MarketCircles" m ON m.mc_code = s.mc_code
    GROUP BY s.header_id
)
SELECT cm.header_id                                    AS customer_hdr_id,
       cm.customer_id,
       cm.customer_number,
       cm.customer_name,
       cm.customergroup                                AS customer_group,
       cm.customer_id IS NULL                          AS is_lead,
       coalesce(cm.status = 'A', false)                AS is_active,
       ar.customer_class_code                          AS legal_form,
       coalesce(ar.attribute4, t.industry_segment)     AS industrial_segment,
       CASE WHEN lower(trim(ar.attribute6)) IN ('na', '') THEN NULL ELSE trim(ar.attribute6) END AS division,
       lower(trim(ar.attribute2))                      AS oracle_mc_code,
       coalesce(ar.customer_type = 'I', false)         AS is_internal,
       coalesce(st.site_count, 0)                      AS site_count,
       coalesce(st.active_site_count, 0)               AS active_site_count,
       coalesce(st.branch_count, 0) > 1                AS is_multi_branch,
       -- home territory
       CASE WHEN h.site_use_id IS NOT NULL THEN
                 CASE h.rule_no WHEN 1 THEN 'primary bill-to site' WHEN 2 THEN 'active bill-to site'
                                WHEN 3 THEN 'active site' ELSE 'any site' END
            WHEN t.line_id IS NOT NULL THEN 'lead details' END AS home_source,
       h.site_use_id                                   AS home_site_use_id,
       coalesce(hs.city, nullif(trim(t.city), ''))     AS home_city,
       coalesce(hs.state, nullif(trim(t.state), ''))   AS home_state,
       coalesce(hs.mc_code, t.market_circle)           AS home_mc_code,
       coalesce(hs.circle_code, tmc.circle_code)       AS home_circle_code,
       coalesce(hs.region, tmc.region)                 AS home_region,
       coalesce(hs.collector_id, t.collector_id, tmc.collector_id) AS home_collector_id,
       coalesce(hs.branch_name, tb.branch_name, tmc.branch_name)   AS home_branch_name,
       coalesce(hs.is_overseas, tb.is_overseas, tmc.is_overseas, false) AS home_is_overseas,
       cm.creation_date,
       cm.last_update_date
FROM "CustomerMasters" cm
LEFT JOIN "ArCustomers" ar        ON ar.customer_id = cm.customer_id
LEFT JOIN tempcustomers t         ON t.header_id = cm.header_id
LEFT JOIN dim_market_circle tmc   ON tmc.mc_code = t.market_circle
LEFT JOIN dim_collector tb        ON tb.collector_id = t.collector_id
LEFT JOIN site_stats st           ON st.header_id = cm.header_id
LEFT JOIN home h                  ON h.header_id = cm.header_id
LEFT JOIN dim_customer_site hs    ON hs.site_use_id = h.site_use_id;

CREATE UNIQUE INDEX ix_dim_customer_hdr ON dim_customer (customer_hdr_id);
CREATE INDEX ix_dim_customer_id ON dim_customer (customer_id);
CREATE INDEX ix_dim_customer_home_branch ON dim_customer (home_collector_id);

COMMENT ON MATERIALIZED VIEW dim_customer IS 'One row per customer - real customers and leads alike - with its classification and a "home" territory. Territory really belongs to the site (see dim_customer_site); the home here follows crm''s own rule (an active bill-to site, primary first, latest on a tie) and falls back to the lead details for customers without sites. Includes the "unknown" customer (-1).';
COMMENT ON COLUMN dim_customer.customer_hdr_id IS 'The customer id used inside crm (CustomerMasters.header_id). Sites, leads and user-customer mappings join on this.';
COMMENT ON COLUMN dim_customer.customer_id IS 'The oracle customer id. Orders, quotes, plans and dispatches join on this. Empty for a lead.';
COMMENT ON COLUMN dim_customer.customer_number IS 'The oracle account number. The open order book (SocPendingDetails) uses this one.';
COMMENT ON COLUMN dim_customer.customer_name IS 'The customer''s name.';
COMMENT ON COLUMN dim_customer.customer_group IS 'crm''s customergroup. Nearly unique per customer, so not a grouping - a second name.';
COMMENT ON COLUMN dim_customer.is_lead IS 'True when the customer has no oracle id yet: a lead. About half of all rows.';
COMMENT ON COLUMN dim_customer.is_active IS 'crm status A. Blank status only occurs on leads, so blank counts as not active.';
COMMENT ON COLUMN dim_customer.legal_form IS 'From oracle: SOLE PROPRIETORSHIP / PRIVATE LIMITED / PARTNERSHIP / LIMITED / LLP ... Empty for leads and some customers.';
COMMENT ON COLUMN dim_customer.industrial_segment IS 'The customer''s industry: TRADER / PAINT & COATINGS / TEXTILE / PHARMA / PACKAGING ... From oracle for a real customer, from the lead details for a lead.';
COMMENT ON COLUMN dim_customer.division IS 'The division the customer is filed under in oracle: General Chemicals / Performance Chemicals / NPD / Packing Materials / Services / Lab Products / MISC. Empty for leads and where oracle says na.';
COMMENT ON COLUMN dim_customer.oracle_mc_code IS 'The circle oracle holds for the customer, lower case. Agrees with the home site''s circle almost always; a cross check, not the source of home_mc_code.';
COMMENT ON COLUMN dim_customer.is_internal IS 'oracle customer type I: an internal customer (a handful).';
COMMENT ON COLUMN dim_customer.site_count IS 'How many sites the customer has. Marketplace channels (Sales through Flipkart / Amazon) have thousands.';
COMMENT ON COLUMN dim_customer.active_site_count IS 'How many of them are active.';
COMMENT ON COLUMN dim_customer.is_multi_branch IS 'True when the customer''s sites belong to more than one branch - the home branch is then only one of them.';
COMMENT ON COLUMN dim_customer.home_source IS 'Which rule picked the home territory: primary bill-to site, active bill-to site, active site, any site, or lead details (no sites, taken from tempcustomers). Empty when nothing was found.';
COMMENT ON COLUMN dim_customer.home_site_use_id IS 'The site chosen as home. Join dim_customer_site for its full detail.';
COMMENT ON COLUMN dim_customer.home_city IS 'City of the home site, or of the lead.';
COMMENT ON COLUMN dim_customer.home_state IS 'State of the home site, or of the lead.';
COMMENT ON COLUMN dim_customer.home_mc_code IS 'The home circle.';
COMMENT ON COLUMN dim_customer.home_circle_code IS 'The home circle''s short code.';
COMMENT ON COLUMN dim_customer.home_region IS 'The home circle''s region.';
COMMENT ON COLUMN dim_customer.home_collector_id IS 'The home branch: the home site''s branch (its own, else its circle''s), or the lead''s branch.';
COMMENT ON COLUMN dim_customer.home_branch_name IS 'That branch''s name.';
COMMENT ON COLUMN dim_customer.home_is_overseas IS 'The home branch is an export / special channel.';
COMMENT ON COLUMN dim_customer.creation_date IS 'When the customer was created in crm.';
COMMENT ON COLUMN dim_customer.last_update_date IS 'When the customer was last changed in crm.';
