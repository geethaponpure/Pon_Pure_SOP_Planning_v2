-- user_and_scope views: who people are, what CRM lets them see (rows), and what it lets them do (permissions).
-- run by app/repositories/views.py at api start, in file name order. one statement per ';'.
--
-- what these views are FOR. the tool enforces access through its own admin-controlled grants table: page
-- permissions (which screens) and data scope (which rows). these views are the SEED for those grants - they
-- reproduce CRM's rules faithfully and say, on every row, which rule produced it, so a seeded grant can always
-- be traced back. they do not enforce anything, and they never hard-wire the tool's policy.
--
-- how CRM decides (read from its code, sep 2026):
--   circles       Fn_CD_GetMarketCircleList: sales executive -> own current circles (the whole branch if the
--                 cross-circle flag is set); branch manager -> circles of their reports; regional manager ->
--                 reports and reports' reports; every other role -> ALL circles.
--   branches      SP_GetCollectorList switches on RoleConfigs: User or All Collector -> every branch; Collector ->
--                 its branch list; Market Circle -> the circle rule. technical staff get theirs from
--                 HolidayUserCollectorMappings; managers also get the branches that name them.
--   technical     technical executive = their customers x the product categories they cover; technical
--                 manager / head = product segments.
--   permissions   granted = (the role carries it AND the user is not excluded) OR the user is individually included.
--   dummy users   placeholder managers in the reporting line. CRM walks through them, so do we.
-- role ids CRM's code names: 5 sales executive, 6 technical executive, 7 branch manager, 8 regional manager,
-- 9 business head, 90 technical manager, 91 technical head.


-- ---------------------------------------------------------------------------------------------------------------
-- dim_role: every role, its family, where it ranks, and which scope rule CRM applies to it.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_role CASCADE;

CREATE VIEW dim_role AS
WITH cfg AS (
    SELECT DISTINCT ON (role_id) role_id, config_type_id FROM "RoleConfigs" ORDER BY role_id, header_id
),
rank AS (
    SELECT role_id, min(hierarchy_id) AS hierarchy_rank
    FROM "RoleHierarchies" WHERE NOT coalesce(is_deleted, false)
    GROUP BY role_id
)
SELECT r.line_id                                       AS role_id,
       r.name                                          AS role_name,
       t.name                                          AS role_type,
       k.hierarchy_rank,
       c.config_type_id,
       CASE c.config_type_id WHEN 1 THEN 'user' WHEN 2 THEN 'branch list'
                             WHEN 3 THEN 'market circle' WHEN 4 THEN 'all branches' END AS crm_config,
       -- the rule, in the order CRM's code checks it: the named roles first, then the configuration
       CASE
           WHEN r.line_id = 5                          THEN 'own market circles'
           WHEN r.line_id = 7                          THEN 'circles of their reports'
           WHEN r.line_id = 8                          THEN 'circles of their reports, two levels'
           WHEN r.line_id = 6                          THEN 'customer portfolio x product categories'
           WHEN r.line_id IN (90, 91)                  THEN 'product segments'
           WHEN r.line_id = 9                          THEN 'segment workflow'
           WHEN c.config_type_id = 2                   THEN 'branch list'
           WHEN c.config_type_id IN (1, 4)             THEN 'all branches'
           ELSE 'not configured'
       END                                             AS scope_rule,
       c.config_type_id IN (1, 4) AND r.line_id NOT IN (90, 91)
                                                       AS crm_grants_everything,
       c.config_type_id IS NULL AND r.line_id NOT IN (5, 6, 7, 8, 9, 90, 91)
                                                       AS is_unconfigured,
       coalesce(r.is_active, false)                    AS is_active,
       coalesce(r.is_deleted, false)                   AS is_deleted
FROM "Roles" r
LEFT JOIN "RoleTypes" t ON t.line_id = r.role_type_id
LEFT JOIN cfg c ON c.role_id = r.line_id
LEFT JOIN rank k ON k.role_id = r.line_id;

COMMENT ON VIEW dim_role IS 'Every CRM role: its family, where it ranks, and which scope rule CRM applies to it. The rule comes from CRM''s own configuration (RoleConfigs) plus the handful of roles its code treats specially - nothing here is our own invention. Only about thirty of the hundred-odd roles are configured at all; the rest CRM lets see everything, which is why is_unconfigured matters for access control.';
COMMENT ON COLUMN dim_role.scope_rule IS 'How CRM decides what this role sees: own market circles (sales executive), circles of their reports (branch manager), two levels of reports (regional manager), customer portfolio x product categories (technical executive), product segments (technical manager / head), segment workflow (business head), a branch list, all branches, or not configured.';
COMMENT ON COLUMN dim_role.crm_grants_everything IS 'CRM deliberately gives this role every branch - it is configured that way (All Collector, or User for the export and tele-marketing roles).';
COMMENT ON COLUMN dim_role.is_unconfigured IS 'CRM has no scope configuration for this role and its code falls back to showing everything. For access control this is a policy decision for the tool''s admin, not something to copy: an unconfigured role reaching every customer is CRM''s default, not a choice anyone made.';
COMMENT ON COLUMN dim_role.hierarchy_rank IS 'Where the role sits in CRM''s ladder; lower is more senior (CMD 2, executive director 3 .. branch manager 8, sales executive 9).';
COMMENT ON COLUMN dim_role.crm_config IS 'The raw configuration: user, branch list, market circle or all branches. Null for unconfigured roles. CRM''s own table spells "All Collector" two ways; the id is what counts.';


-- ---------------------------------------------------------------------------------------------------------------
-- dim_user: who someone is - role, manager, whether they are real and actually use CRM.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS dim_user CASCADE;

CREATE VIEW dim_user AS
SELECT u.line_id                                       AS user_id,
       u.name                                          AS user_name,
       u.username,
       u.email,
       u.user_code,
       u.designation,
       u.department,
       ur.role_id,
       r.role_name,
       r.role_type,
       r.scope_rule,
       coalesce(r.crm_grants_everything, false)        AS crm_grants_everything,
       coalesce(r.is_unconfigured, ur.role_id IS NULL) AS is_unconfigured,
       u.reporting_to_id                               AS manager_id,
       m.name                                          AS manager_name,
       CASE WHEN dm.classification IS NOT NULL THEN dm.classification = 'placeholder' ELSE coalesce(m.name ILIKE 'DUMMY%' OR m.username ILIKE 'DUMMY%' OR (coalesce(m.is_dummy, false) AND (m.name ~* '^dum' OR (m.name !~ ' ' AND m.name ~ '[0-9]'))), false) END
                                                       AS manager_is_placeholder,
       -- a technical executive's technical manager is their own manager, when that manager holds a
       -- technical-manager segment row; the technical head is the head that row names
       tm.user_id                                      AS technical_manager_id,
       tm.reporting_user_id                            AS technical_head_id,
       coalesce(u.is_active, false)                    AS is_active,
       coalesce(u.is_dummy, false)                     AS is_dummy,
       -- crm's flag misses placeholders named DUMMY, and is set on some real people who kept an old sales login.
       -- so ours: a placeholder is an account CODE. a flagged account with a person's name is 'confirm' - it keeps
       -- its scope and goes on the admin's worksheet, because wrongly stripping a real person would be silent.
       CASE WHEN du.classification IS NOT NULL THEN du.classification = 'placeholder' ELSE coalesce(u.name ILIKE 'DUMMY%' OR u.username ILIKE 'DUMMY%' OR (coalesce(u.is_dummy, false) AND (u.name ~* '^dum' OR (u.name !~ ' ' AND u.name ~ '[0-9]'))), false) END                                       AS is_placeholder,
       CASE WHEN CASE WHEN du.classification IS NOT NULL THEN du.classification = 'placeholder' ELSE coalesce(u.name ILIKE 'DUMMY%' OR u.username ILIKE 'DUMMY%' OR (coalesce(u.is_dummy, false) AND (u.name ~* '^dum' OR (u.name !~ ' ' AND u.name ~ '[0-9]'))), false) END THEN 'placeholder'
            WHEN du.classification = 'person' THEN NULL
            WHEN coalesce(u.is_dummy, false) THEN 'confirm' END AS placeholder_status,
       -- where the answer came from: a recorded human decision (placeholder_decision), or the automatic rule
       CASE WHEN du.classification IS NOT NULL THEN 'decision'
            WHEN coalesce(u.name ILIKE 'DUMMY%' OR u.username ILIKE 'DUMMY%' OR (coalesce(u.is_dummy, false) AND (u.name ~* '^dum' OR (u.name !~ ' ' AND u.name ~ '[0-9]'))), false) OR coalesce(u.is_dummy, false) THEN 'automatic rule' END AS placeholder_source,
       coalesce(u.is_international, false)             AS is_international,
       u.last_logged_in_date::date                     AS last_login_on,
       coalesce(u.last_logged_in_date > now() - interval '90 days', false) AS uses_crm,
       -- a data-quality flag only: most people without a manager are warehouse, lab and back-office staff
       -- whose scope never uses the reporting line
       coalesce(u.is_active, false) AND NOT (CASE WHEN du.classification IS NOT NULL THEN du.classification = 'placeholder' ELSE coalesce(u.name ILIKE 'DUMMY%' OR u.username ILIKE 'DUMMY%' OR (coalesce(u.is_dummy, false) AND (u.name ~* '^dum' OR (u.name !~ ' ' AND u.name ~ '[0-9]'))), false) END)
         AND (m.line_id IS NULL OR NOT coalesce(m.is_active, false))
                                                       AS has_manager_issue
FROM "Users" u
LEFT JOIN "UserRoles" ur ON ur.user_id = u.line_id
LEFT JOIN dim_role r     ON r.role_id = ur.role_id
LEFT JOIN "Users" m      ON m.line_id = u.reporting_to_id AND m.line_id <> u.line_id
LEFT JOIN LATERAL (
    SELECT pd.classification FROM placeholder_decision pd
    WHERE pd.user_id = u.line_id AND pd.withdrawn_at IS NULL
    ORDER BY pd.decided_at DESC, pd.id DESC LIMIT 1) du ON true
LEFT JOIN LATERAL (
    SELECT pd.classification FROM placeholder_decision pd
    WHERE pd.user_id = m.line_id AND pd.withdrawn_at IS NULL
    ORDER BY pd.decided_at DESC, pd.id DESC LIMIT 1) dm ON true
LEFT JOIN LATERAL (
    SELECT t.user_id, t.reporting_user_id
    FROM "TechnicalUserSegmentMappings" t
    WHERE ur.role_id = 6 AND t.user_id = u.reporting_to_id AND t.role_id = 90 AND t.valid_to IS NULL
    ORDER BY t.line_id LIMIT 1) tm ON true;

COMMENT ON VIEW dim_user IS 'Everyone with a CRM login: role, manager, and whether they are a real, active person who actually uses CRM. Placeholder accounts are kept and flagged: CRM gives a market circle with no sales executive a placeholder login, the technical executive covering the area logs in through it, and CRM walks through placeholders in the reporting line.';
COMMENT ON COLUMN dim_user.scope_rule IS 'The scope rule of the user''s role, from dim_role. The seed for their row-level grants.';
COMMENT ON COLUMN dim_user.is_unconfigured IS 'Their role has no scope configuration in CRM, so CRM would let them see everything. Also true for the few active users with no role at all - so a count of unconfigured users here is a few higher than a count of unconfigured roles'' users. The tool''s admin decides what they get.';
COMMENT ON COLUMN dim_user.is_dummy IS 'CRM''s own placeholder flag, as it stands. Do not use it to decide scope: it misses dozens of DUMMY-named accounts and is set on some real people. Use is_placeholder.';
COMMENT ON COLUMN dim_user.is_placeholder IS 'A placeholder login, never a person: named DUMMY, or flagged by CRM and named like an account code (DUMMY_EX_TEL01, DUM-SE-CHW01). Never receives scope or permissions; its circles go to whoever operates it (placeholder_operator). Not widened to every DUM login - DUMSEBAN07, for one, is a real person.';
COMMENT ON COLUMN dim_user.placeholder_source IS 'Where the placeholder answer came from: decision (a person recorded it in placeholder_decision - it overrides everything) or automatic rule (the name pattern and CRM''s flag). Null for ordinary users.';
COMMENT ON COLUMN dim_user.placeholder_status IS 'placeholder, or confirm: CRM flags the account but it carries a person''s name - usually someone who moved into a technical or management role and kept their old sales login. A confirm account keeps its scope until the admin decides; it is listed on v_placeholder_circle. Null for ordinary users.';
COMMENT ON COLUMN dim_user.uses_crm IS 'Logged in to CRM in the last ninety days. Many accounts never do.';
COMMENT ON COLUMN dim_user.has_manager_issue IS 'An active real user with no manager, or whose manager is inactive. A data-quality flag, not a blocker: most are warehouse, lab and back-office staff whose scope does not depend on the reporting line.';
COMMENT ON COLUMN dim_user.technical_manager_id IS 'For a technical executive: their technical manager. The technical head above them is technical_head_id.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_user_hierarchy: every manager above a user, walking through placeholder managers.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_user_hierarchy CASCADE;

CREATE VIEW v_user_hierarchy AS
WITH RECURSIVE chain AS (
    SELECT u.line_id AS user_id, m.line_id AS manager_id, 1 AS hops,
           CASE WHEN dm.is_placeholder THEN 0 ELSE 1 END AS management_level,
           ARRAY[u.line_id, m.line_id] AS path
    FROM "Users" u
    JOIN "Users" m    ON m.line_id = u.reporting_to_id
    JOIN dim_user dm  ON dm.user_id = m.line_id
    WHERE u.reporting_to_id <> u.line_id
    UNION ALL
    SELECT c.user_id, m.line_id, c.hops + 1,
           c.management_level + CASE WHEN dm.is_placeholder THEN 0 ELSE 1 END,
           c.path || m.line_id
    FROM chain c
    JOIN "Users" a ON a.line_id = c.manager_id
    JOIN "Users" m ON m.line_id = a.reporting_to_id
    JOIN dim_user dm ON dm.user_id = m.line_id
    WHERE NOT m.line_id = ANY (c.path) AND c.hops < 15
)
SELECT c.user_id,
       c.manager_id,
       c.hops,
       c.management_level,
       dm.is_placeholder                               AS manager_is_placeholder,
       coalesce(m.is_active, false)                    AS manager_is_active
FROM chain c
JOIN "Users" m    ON m.line_id = c.manager_id
JOIN dim_user dm  ON dm.user_id = c.manager_id;

COMMENT ON VIEW v_user_hierarchy IS 'Every manager above every user, all the way up. CRM puts placeholder (dummy) accounts in the reporting line as stand-in managers, and walks through them; so does this view. A report sits at management_level 1 under their nearest real manager however many placeholders are in between.';
COMMENT ON COLUMN v_user_hierarchy.hops IS 'Steps up the raw reporting line, placeholders included.';
COMMENT ON COLUMN v_user_hierarchy.management_level IS 'How many REAL managers up this one is. 1 = the user''s direct manager, looking through placeholders. A branch manager sees their level 1 reports; a regional manager levels 1 and 2.';
COMMENT ON COLUMN v_user_hierarchy.manager_is_placeholder IS 'This step is a placeholder account, not a person (dim_user.is_placeholder).';


-- ---------------------------------------------------------------------------------------------------------------
-- v_branch_management: who manages each branch, from CRM's branch table.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_branch_management CASCADE;

CREATE VIEW v_branch_management AS
WITH named AS (
    SELECT m.collector_id, x.position, x.user_id
    FROM "CollectorMailMappings" m
    CROSS JOIN LATERAL (VALUES ('branch manager', m.bm_user_id), ('regional manager', m.rm_user_id),
                               ('commercial manager', m.cm_user_id), ('branch controller', m.bc_user_id),
                               ('executive director', m.ed_user_id), ('general manager', m.gm_user_id)) x (position, user_id)
    WHERE x.user_id IS NOT NULL
    UNION ALL
    -- coordinators are a comma-separated list of user ids in CRM
    SELECT m.collector_id, 'coordinator', btrim(c)::bigint
    FROM "CollectorMailMappings" m
    CROSS JOIN LATERAL unnest(string_to_array(m.coordinator_user_id, ',')) AS c
    WHERE btrim(c) ~ '^[0-9]+$'
)
SELECT n.collector_id,
       b.branch_name,
       n.position,
       n.user_id,
       u.name                                          AS user_name,
       coalesce(u.is_active, false)                    AS user_is_active
FROM named n
LEFT JOIN dim_collector b ON b.collector_id = n.collector_id
LEFT JOIN "Users" u       ON u.line_id = n.user_id;

COMMENT ON VIEW v_branch_management IS 'Who manages each branch, as CRM''s branch table names them: branch manager, regional manager, commercial manager, branch controller, executive director, general manager and coordinators. CRM also uses this table as a scope rule - a manager sees the branches that name them - and it is the fallback for a branch or regional manager with no active reports.';
COMMENT ON COLUMN v_branch_management.position IS 'The role the branch table gives this person for this branch. Coordinators come from a comma-separated list, split here.';
COMMENT ON COLUMN v_branch_management.user_is_active IS 'False where the branch table still names someone who has left.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_user_market_circle: the market circles CRM lets a sales-side user see, and why.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_user_market_circle CASCADE;

CREATE VIEW v_user_market_circle AS
WITH holding AS (
    -- a circle someone holds today
    SELECT m.user_id, m.market_circle_id AS circle_id, coalesce(m.is_primary, false) AS is_primary,
           coalesce(m.cross_marketcircle_segmentaccess_flag, false) AS cross_flag
    FROM "UserMarketCircleMappings" m
    WHERE m.valid_to IS NULL AND (m.valid_from IS NULL OR m.valid_from <= now())
),
people AS (
    -- people, not placeholders. a 'confirm' account is treated as a person: it keeps its scope until the admin decides
    SELECT user_id, role_id FROM dim_user WHERE is_active AND NOT is_placeholder
),
own AS (
    SELECT h.user_id, h.circle_id, 'own circle' AS via, h.user_id AS via_user_id
    FROM holding h JOIN people p ON p.user_id = h.user_id AND p.role_id = 5
    WHERE NOT h.cross_flag
),
own_branch AS (
    -- the cross-circle flag opens every circle of the sales executive's branch. off for everyone today
    SELECT h.user_id, mc2.header_id, 'own branch (cross-circle)', h.user_id
    FROM holding h JOIN people p ON p.user_id = h.user_id AND p.role_id = 5
    JOIN "MarketCircles" mc  ON mc.header_id = h.circle_id
    JOIN "MarketCircles" mc2 ON mc2.collector_id = mc.collector_id
    WHERE h.cross_flag
),
reports AS (
    -- every report, as crm does: a placeholder sales executive holding a vacant territory, or a holder who
    -- has left, still puts that circle in their manager's scope. that is how vacant territories stay covered.
    SELECT p.user_id, h.circle_id,
           CASE p.role_id WHEN 7 THEN 'circles of their reports' ELSE 'circles of their reports, two levels' END,
           y.user_id
    FROM people p
    JOIN v_user_hierarchy y ON y.manager_id = p.user_id
    JOIN holding h          ON h.user_id = y.user_id
    WHERE (p.role_id = 7 AND y.management_level = 1) OR (p.role_id = 8 AND y.management_level <= 2)
),
fallback AS (
    -- a branch or regional manager with no active reports still manages the branches that name them
    SELECT p.user_id, mc.header_id, 'branches that name them (no active reports)', NULL::bigint
    FROM people p
    JOIN v_branch_management b ON b.user_id = p.user_id AND b.position IN ('branch manager', 'regional manager')
    JOIN "MarketCircles" mc    ON mc.collector_id = b.collector_id
    WHERE p.role_id IN (7, 8)
      AND NOT EXISTS (SELECT 1 FROM v_user_hierarchy y JOIN people rep ON rep.user_id = y.user_id
                      WHERE y.manager_id = p.user_id
                        AND ((p.role_id = 7 AND y.management_level = 1) OR (p.role_id = 8 AND y.management_level <= 2)))
),
operated AS (
    -- a placeholder never receives scope itself; the person the admin records as operating it gets its circles
    SELECT o.operator_user_id, h.circle_id, 'placeholder they operate', o.placeholder_user_id
    FROM placeholder_operator o
    JOIN people p   ON p.user_id = o.operator_user_id
    JOIN holding h  ON h.user_id = o.placeholder_user_id
    WHERE o.unassigned_at IS NULL
),
everything AS (
    SELECT * FROM own UNION ALL SELECT * FROM own_branch UNION ALL SELECT * FROM reports
    UNION ALL SELECT * FROM fallback UNION ALL SELECT * FROM operated
)
SELECT e.user_id,
       e.circle_id,
       c.mc_code,
       c.collector_id,
       c.branch_name,
       e.via,
       count(DISTINCT e.via_user_id)                   AS via_users,
       min(e.via_user_id)                              AS example_via_user_id
FROM everything e
LEFT JOIN dim_market_circle c ON c.circle_id = e.circle_id
GROUP BY e.user_id, e.circle_id, c.mc_code, c.collector_id, c.branch_name, e.via;

COMMENT ON VIEW v_user_market_circle IS 'The market circles CRM lets a sales-side user see, one row per user, circle and reason. Reproduces CRM''s own rule: a sales executive sees the circles they hold; a branch manager the circles of their reports; a regional manager two levels down; a manager with no active reports falls back to the branches that name them. Roles CRM lets see every circle are not exploded here - dim_user.crm_grants_everything and is_unconfigured say who they are.';
COMMENT ON COLUMN v_user_market_circle.via IS 'Which rule gave this circle: own circle, own branch (cross-circle), circles of their reports, circles of their reports two levels, branches that name them, or placeholder they operate (recorded by the admin in placeholder_operator). The provenance a seeded grant keeps. A placeholder account never appears here as a user.';
COMMENT ON COLUMN v_user_market_circle.via_users IS 'For a manager, how many of their reports hold this circle.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_customer_ownership: every active customer, the circle it belongs to, and whether anyone owns it.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_customer_ownership CASCADE;

CREATE VIEW v_customer_ownership AS
WITH bill AS (
    -- active bill-to sites, with crm's own circle code kept beside the cleaned one
    SELECT s.customer_hdr_id, s.mc_code, cs.mc_code_raw
    FROM dim_customer_site s
    JOIN "CustomerSites" cs ON cs.site_use_id = s.site_use_id
    WHERE s.site_use_code = 'BILL_TO' AND s.is_active AND coalesce(s.customer_id, 0) <> 0
),
real_circle AS (
    -- a customer belongs to the circle of each active bill-to site, never to the circle on its master row
    SELECT DISTINCT customer_hdr_id, mc_code FROM bill WHERE mc_code <> 'unknown'
),
unknown_only AS (
    -- the loader writes 'unknown' for an empty code AND for a code crm has no circle for; the raw code tells them apart
    SELECT b.customer_hdr_id,
           bool_or(b.mc_code_raw IS NOT NULL)          AS has_orphan_code,
           string_agg(DISTINCT b.mc_code_raw, ', ')    AS raw_codes
    FROM bill b
    WHERE b.mc_code = 'unknown'
      AND NOT EXISTS (SELECT 1 FROM real_circle r WHERE r.customer_hdr_id = b.customer_hdr_id)
    GROUP BY b.customer_hdr_id
),
holders AS (
    SELECT c.mc_code,
           count(DISTINCT u.user_id) FILTER (WHERE u.role_id = 5 AND u.is_active AND NOT u.is_placeholder) AS sales_executives,
           count(DISTINCT u.user_id) FILTER (WHERE u.role_id = 5 AND u.is_active AND NOT u.is_placeholder
                                              AND u.placeholder_status = 'confirm') AS unconfirmed_sales_executives,
           bool_or(u.is_placeholder)                                         AS has_placeholder,
           bool_or(u.role_id <> 5 AND u.is_active AND NOT u.is_placeholder)  AS has_other_role,
           bool_or(NOT u.is_active AND NOT u.is_placeholder)                 AS has_inactive
    FROM "UserMarketCircleMappings" m
    JOIN "MarketCircles" c ON c.header_id = m.market_circle_id
    JOIN dim_user u        ON u.user_id = m.user_id
    WHERE m.valid_to IS NULL
    GROUP BY c.mc_code
),
customers AS (
    SELECT customer_hdr_id, customer_name FROM dim_customer WHERE is_active AND NOT coalesce(is_lead, false)
),
placed AS (
    SELECT c.customer_hdr_id, 'circle' AS placement, r.mc_code, NULL::text AS raw_codes, NULL::boolean AS has_orphan_code
    FROM customers c JOIN real_circle r ON r.customer_hdr_id = c.customer_hdr_id
    UNION ALL
    SELECT c.customer_hdr_id, 'unknown circle', NULL, u.raw_codes, u.has_orphan_code
    FROM customers c JOIN unknown_only u ON u.customer_hdr_id = c.customer_hdr_id
    UNION ALL
    SELECT c.customer_hdr_id, 'no bill-to site', NULL, NULL, NULL
    FROM customers c WHERE NOT EXISTS (SELECT 1 FROM bill b WHERE b.customer_hdr_id = c.customer_hdr_id)
)
SELECT c.customer_hdr_id,
       c.customer_name,
       p.mc_code,
       mc.circle_id,
       mc.collector_id,
       mc.branch_name,
       coalesce(h.sales_executives, 0)                 AS current_sales_executives,
       CASE
           WHEN p.placement = 'no bill-to site'   THEN 'no active bill-to site'
           WHEN p.placement = 'unknown circle'    THEN 'no circle on the bill-to site'
           WHEN h.sales_executives > 0            THEN 'owned'
           WHEN h.has_placeholder                 THEN 'no sales executive, placeholder used by technical staff'
           WHEN h.has_other_role                  THEN 'held by another role'
           WHEN h.has_inactive                    THEN 'held by someone who has left'
           ELSE 'circle held by no one'
       END                                             AS ownership_status,
       coalesce(h.sales_executives, 0) > 0             AS has_active_owner,
       coalesce(h.sales_executives, 0) > 0
         AND h.unconfirmed_sales_executives = h.sales_executives AS owner_needs_confirmation,
       CASE WHEN p.placement = 'unknown circle'
            THEN CASE WHEN p.has_orphan_code THEN 'code with no circle in crm' ELSE 'empty' END
       END                                             AS circle_code_issue,
       p.raw_codes                                     AS crm_circle_codes
FROM placed p
JOIN customers c               ON c.customer_hdr_id = p.customer_hdr_id
LEFT JOIN dim_market_circle mc ON mc.mc_code = p.mc_code
LEFT JOIN holders h            ON h.mc_code = p.mc_code;

COMMENT ON VIEW v_customer_ownership IS 'Every active customer with the circle it belongs to and whether a real sales executive currently holds it. It exists so customers nobody owns stay visible: a user-by-user scope view cannot show a customer that belongs to no one. A customer with active bill-to sites in two circles appears once per circle.';
COMMENT ON COLUMN v_customer_ownership.ownership_status IS 'owned (an active sales executive holds the circle); no sales executive, placeholder used by technical staff (CRM parks the circle on a placeholder login that a technical executive uses - the branch manager above it still covers it); held by another role (an export manager, say); held by someone who has left; circle held by no one; no circle on the bill-to site (the site''s circle code is empty, or names a circle CRM does not have - see circle_code_issue); or no active bill-to site.';
COMMENT ON COLUMN v_customer_ownership.has_active_owner IS 'A real, active sales executive holds this customer''s circle. False covers every kind of unowned; ownership_status says which.';
COMMENT ON COLUMN v_customer_ownership.owner_needs_confirmation IS 'The circle''s only sales executives are accounts CRM flags as placeholders but that carry a person''s name (dim_user.placeholder_status = confirm). Counted as owned, pending the admin''s check.';
COMMENT ON COLUMN v_customer_ownership.circle_code_issue IS 'For a customer with no circle on its bill-to site: empty (CRM holds no code) or code with no circle in crm (a code such as GROUP, TPU01 or the typo CHRO1 that matches no circle - these are for the CRM team to correct).';
COMMENT ON COLUMN v_customer_ownership.crm_circle_codes IS 'The circle code exactly as CRM holds it, for customers whose code names no circle.';
COMMENT ON COLUMN v_customer_ownership.mc_code IS 'The circle of an active bill-to site. CRM places customers by their bill-to site, never by the circle on the customer master.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_user_customer_scope: the customers each user may see, and by which rule.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_user_customer_scope CASCADE;

CREATE VIEW v_user_customer_scope AS
WITH bill_to AS (
    SELECT DISTINCT s.customer_hdr_id, s.mc_code, s.collector_id
    FROM dim_customer_site s
    WHERE s.site_use_code = 'BILL_TO' AND s.is_active AND coalesce(s.customer_id, 0) <> 0 AND s.mc_code <> 'unknown'
),
by_circle AS (
    SELECT DISTINCT uc.user_id, b.customer_hdr_id, uc.via
    FROM v_user_market_circle uc
    JOIN bill_to b ON b.mc_code = uc.mc_code
),
by_portfolio AS (
    -- a technical executive's own customers: by the customer's header id, current rows only
    SELECT DISTINCT m.user_id, m.customer_hdr_id, 'own customer portfolio'
    FROM "UserCustomerMappings" m
    JOIN dim_user u ON u.user_id = m.user_id AND u.is_active AND NOT u.is_placeholder
    WHERE m.valid_to IS NULL AND (m.valid_from IS NULL OR m.valid_from <= now())
),
by_branch AS (
    -- roles configured with a branch list see every customer billed in those branches
    SELECT DISTINCT m.user_id, b.customer_hdr_id, 'branch list'
    FROM "UserCollectorMappings" m
    JOIN dim_user u ON u.user_id = m.user_id AND u.is_active AND NOT u.is_placeholder AND u.scope_rule = 'branch list'
    JOIN bill_to b  ON b.collector_id = m.collector_id
)
SELECT user_id, customer_hdr_id, via FROM by_circle
UNION ALL SELECT * FROM by_portfolio
UNION ALL SELECT * FROM by_branch;

COMMENT ON VIEW v_user_customer_scope IS 'The customers each user may see under CRM''s rules, one row per user, customer and rule. Built from the user''s circles (sales executives and their managers), their own portfolio (technical executives) or their branch list (commercial, accounts and coordinator roles). Roles that see everything are not exploded - see dim_user. Customers nobody owns are in v_customer_ownership. It is large (the branch-list rule alone is most of a million rows): scan it once, or copy it to a temporary table for checks - never read it inside a per-row subquery, which runs for many minutes.';
COMMENT ON COLUMN v_user_customer_scope.user_id IS 'Never a placeholder login. A placeholder''s customers reach the person operating it, with via = placeholder they operate.';
COMMENT ON COLUMN v_user_customer_scope.via IS 'The rule that grants the customer: a circle rule from v_user_market_circle, own customer portfolio, or branch list. A customer reached two ways appears twice, once per rule.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_technical_scope: what technical staff cover - customers, product categories, segments and branches.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_technical_scope CASCADE;

CREATE VIEW v_technical_scope AS
WITH people AS (
    SELECT user_id, role_id FROM dim_user WHERE is_active AND NOT is_placeholder
),
categories AS (
    SELECT DISTINCT category_id, segment1, segment2, segment3, segment4 FROM "ItemCategories"
)
-- technical executive: customers
SELECT m.user_id, p.role_id, 'customer' AS scope_dimension,
       m.customer_hdr_id, NULL::bigint AS category_id,
       NULL::text AS segment2, NULL::text AS segment3, NULL::text AS segment4, NULL::bigint AS collector_id,
       'own customer portfolio' AS via
FROM "UserCustomerMappings" m JOIN people p ON p.user_id = m.user_id AND p.role_id = 6
WHERE m.valid_to IS NULL
UNION ALL
-- technical executive: product categories
SELECT t.user_id, p.role_id, 'product category', NULL, t.category_id,
       c.segment2, c.segment3, c.segment4, NULL, 'categories they cover'
FROM "TechnicalExecutiveSegmentMappings" t
JOIN people p ON p.user_id = t.user_id
LEFT JOIN categories c ON c.category_id = t.category_id
UNION ALL
-- technical manager / head: segments
SELECT s.user_id, s.role_id, 'segment', NULL, NULL,
       nullif(btrim(s.segment2), ''), nullif(btrim(s.segment3), ''), nullif(btrim(s.segment4), ''), NULL,
       CASE WHEN coalesce(btrim(s.collector_id), '') IN ('', '0') THEN 'segments they head, no branch limit'
            ELSE 'segments they head' END
FROM "TechnicalUserSegmentMappings" s JOIN people p ON p.user_id = s.user_id
WHERE s.valid_to IS NULL
UNION ALL
-- technical manager / head: the branches a segment row is limited to (a comma list in CRM)
SELECT s.user_id, s.role_id, 'branch', NULL, NULL,
       nullif(btrim(s.segment2), ''), nullif(btrim(s.segment3), ''), nullif(btrim(s.segment4), ''),
       btrim(b)::bigint, 'branches of a segment they head'
FROM "TechnicalUserSegmentMappings" s
JOIN people p ON p.user_id = s.user_id
CROSS JOIN LATERAL unnest(string_to_array(s.collector_id, ',')) AS b
WHERE s.valid_to IS NULL AND btrim(b) ~ '^[0-9]+$' AND btrim(b) <> '0'
UNION ALL
-- technical executive / manager / head: their direct branch mapping
SELECT h.user_id, p.role_id, 'branch', NULL, NULL, NULL, NULL, NULL, h.collector_id, 'direct branch mapping'
FROM "HolidayUserCollectorMappings" h JOIN people p ON p.user_id = h.user_id
WHERE h.valit_to IS NULL;

COMMENT ON VIEW v_technical_scope IS 'What technical staff cover, one row per user and item of scope. A technical executive''s scope is their customers AND the product categories they cover - both, not either; a technical manager or head covers product segments, sometimes limited to listed branches. Direct branch mappings for all three come from CRM''s HolidayUserCollectorMappings, which despite its name is the branch table for technical staff.';
COMMENT ON COLUMN v_technical_scope.scope_dimension IS 'customer, product category, segment or branch. Read the rows for one user together: a technical executive''s customers and categories combine.';
COMMENT ON COLUMN v_technical_scope.via IS 'Which CRM mapping gave this row. "no branch limit" marks a segment row CRM records with no branch list (blank or 0).';


-- ---------------------------------------------------------------------------------------------------------------
-- v_user_capability: what CRM lets each user DO - their permissions, and where each one comes from.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_user_capability CASCADE;

CREATE VIEW v_user_capability AS
WITH from_role AS (
    SELECT ur.user_id, rc.claim_id FROM "UserRoles" ur JOIN "RoleClaims" rc ON rc.role_id = ur.role_id
),
pairs AS (
    SELECT user_id, claim_id FROM from_role
    UNION
    SELECT user_id, claim_id FROM "UserClaims"
)
SELECT p.user_id,
       p.claim_id,
       c.name                                          AS permission,
       c.group_identifier,
       r.claim_id IS NOT NULL                          AS via_role,
       coalesce(uc.is_include, false)                  AS individually_included,
       coalesce(uc.is_exclude, false)                  AS individually_excluded,
       (r.claim_id IS NOT NULL AND NOT coalesce(uc.is_exclude, false)) OR coalesce(uc.is_include, false)
                                                       AS is_granted,
       CASE
           WHEN coalesce(uc.is_include, false)                               THEN 'individual grant'
           WHEN r.claim_id IS NOT NULL AND NOT coalesce(uc.is_exclude, false) THEN 'role'
           WHEN r.claim_id IS NOT NULL                                       THEN 'role, excluded for this user'
           ELSE 'not granted'
       END                                             AS granted_by,
       c.name ILIKE '%business%plan%' OR c.name ILIKE '%yearly plan%' OR c.name ILIKE '%planner%'
                                                       AS is_planning_permission,
       coalesce(c.is_active, false)                    AS permission_is_active,
       u.is_active                                     AS user_is_active,
       u.is_placeholder                                AS user_is_placeholder
FROM pairs p
JOIN "Claims" c           ON c.line_id = p.claim_id
JOIN dim_user u           ON u.user_id = p.user_id
LEFT JOIN from_role r     ON r.user_id = p.user_id AND r.claim_id = p.claim_id
LEFT JOIN "UserClaims" uc ON uc.user_id = p.user_id AND uc.claim_id = p.claim_id;

COMMENT ON VIEW v_user_capability IS 'What CRM lets each user do: every permission they hold or were refused, and where it comes from. CRM''s rule: a user has a permission when their ROLE carries it and they are not individually excluded, or when they are individually included. Most permissions arrive through the role - counting individual grants alone understates the approvers roughly a hundredfold. The seed for the tool''s page permissions.';
COMMENT ON COLUMN v_user_capability.is_granted IS 'The user holds this permission under CRM''s rule. Filter on this; the other rows record refusals.';
COMMENT ON COLUMN v_user_capability.granted_by IS 'role, individual grant, role excluded for this user (the role carries it but this user was taken off), or not granted.';
COMMENT ON COLUMN v_user_capability.is_planning_permission IS 'A business-plan, yearly-plan or planner-approval permission. Not the same as approval: "Manage PC Business Plan BM" is carried by every sales and technical role and lets them EDIT the plan - it is not a list of approvers. Who approves a plan comes from v_segment_head and the reporting line. "Manage PC Business Plan BH" also reaches the Digital Marketing Co-ordinator role and a role named Dummy through their role - kept as CRM has it, and a configuration question for the CRM team.';
COMMENT ON COLUMN v_user_capability.user_is_active IS 'The user is active. Several thousand granted rows belong to people who have left - filter on this before seeding page permissions.';
COMMENT ON COLUMN v_user_capability.user_is_placeholder IS 'The user is a placeholder login. Placeholders never receive permissions in the tool - filter these out too.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_user_warehouse_scope: the supply side - which warehouses each user works with.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_user_warehouse_scope CASCADE;

CREATE VIEW v_user_warehouse_scope AS
SELECT m.user_id,
       u.user_name,
       u.role_name,
       m.inventory_org_id                              AS warehouse_id,
       w.warehouse_name,
       w.branch_name,
       w.is_plant,
       w.is_port,
       coalesce(o.whapproval_planner_enable, false)    AS warehouse_needs_planner_approval,
       EXISTS (SELECT 1 FROM v_user_capability c
               WHERE c.user_id = m.user_id AND c.permission = 'Manage Planner Approval' AND c.is_granted)
                                                       AS user_can_approve_as_planner
FROM "UserInventoryOrgMappings" m
JOIN dim_user u           ON u.user_id = m.user_id AND u.is_active AND NOT u.is_placeholder
LEFT JOIN dim_warehouse w ON w.warehouse_id = m.inventory_org_id
LEFT JOIN "InventoryOrgs" o ON o.inventory_org_id = m.inventory_org_id;

COMMENT ON VIEW v_user_warehouse_scope IS 'The warehouses each user works with - the supply side''s scope, for warehouse, planning and accounts staff. Many of these users have no customer-side scope at all, so for them this is the only row-level rule.';
COMMENT ON COLUMN v_user_warehouse_scope.warehouse_needs_planner_approval IS 'The warehouse routes its approvals through a planner (a handful of warehouses).';
COMMENT ON COLUMN v_user_warehouse_scope.user_can_approve_as_planner IS 'The user holds CRM''s planner-approval permission. Together with the column before: can this person approve for this warehouse.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_segment_head: the business / division head chain - who approves each segment, for which branches.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_segment_head CASCADE;

CREATE VIEW v_segment_head AS
WITH rows_ AS (
    SELECT d.*, h.segment2, h.divition_head_id, h.divition_head_name
    FROM "SpAlertSegmentWorkflowDtls" d
    JOIN "SpAlertSegmentWorkflowHdrs" h ON h.header_id = d.header_id
),
branches AS (
    -- a comma list of branch ids, or none at all when the row covers every branch ("ALL COLLECTOR")
    SELECT r.line_id, btrim(b)::bigint AS collector_id
    FROM rows_ r CROSS JOIN LATERAL unnest(string_to_array(r.collector_id, ',')) AS b
    WHERE btrim(b) ~ '^[0-9]+$'
)
SELECT r.line_id                                       AS workflow_line_id,
       r.segment2                                      AS division,
       r.divition_head_id                              AS division_head_id,
       r.divition_head_name                            AS division_head_name,
       nullif(btrim(r.segment3), '')                   AS segment,
       nullif(btrim(r.segment4), '')                   AS sub_segment,
       b.collector_id,
       c.branch_name,
       b.collector_id IS NULL                          AS covers_all_branches,
       r.receiver_id                                   AS approver_id,
       r.receiver_name                                 AS approver_name,
       u.role_name                                     AS approver_role,
       upper(coalesce(r.businessplan_approval_req, '')) = 'YES' AS approves_business_plan,
       upper(coalesce(r.quote_approval_req, '')) = 'YES'        AS approves_quotes,
       upper(coalesce(r.rma_approval_req, '')) = 'YES'          AS approves_returns,
       upper(coalesce(r.purchaserequest, '')) = 'YES'           AS approves_purchase_requests,
       upper(coalesce(r.project_approval_req, '')) = 'YES'      AS approves_projects,
       upper(coalesce(r.alert_req, '')) = 'YES'                 AS receives_alerts,
       string_to_array(nullif(btrim(r.approval_req_module), ''), ',') AS approval_modules
FROM rows_ r
LEFT JOIN branches b      ON b.line_id = r.line_id
LEFT JOIN dim_collector c ON c.collector_id = b.collector_id
LEFT JOIN dim_user u      ON u.user_id = r.receiver_id;

COMMENT ON VIEW v_segment_head IS 'The business and division head chain: for each division, segment and branch, who approves and for what. The only place in CRM where business head scope exists, and what CRM''s business-plan approval reads - the plan goes sales or technical executive, then branch manager, then the business head named here for the segment and branch, then the division head. One row per workflow row and branch; a row covering every branch appears once with covers_all_branches.';
COMMENT ON COLUMN v_segment_head.approver_id IS 'The person who receives this segment''s approvals for this branch - usually a regional manager, branch manager, business head or technical head. Null where CRM names someone who is no longer a user.';
COMMENT ON COLUMN v_segment_head.division_head_id IS 'The head of the whole division, the last approver above the segment''s approver.';
COMMENT ON COLUMN v_segment_head.covers_all_branches IS 'CRM records the row as "ALL COLLECTOR" - it applies to every branch.';
COMMENT ON COLUMN v_segment_head.approves_business_plan IS 'This approver signs off the business plan for the segment and branch.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_placeholder_circle: the admin's worksheet for placeholder logins - who should operate each one.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_placeholder_circle CASCADE;

CREATE VIEW v_placeholder_circle AS
WITH accounts AS (
    SELECT user_id, user_name, username, placeholder_status, is_active, uses_crm, last_login_on
    FROM dim_user WHERE placeholder_status IS NOT NULL
),
held AS (
    SELECT a.*, c.header_id AS circle_id, c.mc_code
    FROM accounts a
    JOIN "UserMarketCircleMappings" m ON m.user_id = a.user_id AND m.valid_to IS NULL
    JOIN "MarketCircles" c            ON c.header_id = m.market_circle_id
),
circle_customers AS (
    SELECT DISTINCT s.mc_code, s.customer_hdr_id
    FROM dim_customer_site s
    WHERE s.site_use_code = 'BILL_TO' AND s.is_active AND coalesce(s.customer_id, 0) <> 0
),
circle_size AS (
    SELECT mc_code, count(*) AS customers FROM circle_customers GROUP BY mc_code
),
manager_above AS (
    -- the nearest real, active manager above the account, looking through other placeholders
    SELECT DISTINCT ON (y.user_id) y.user_id, y.manager_id
    FROM v_user_hierarchy y
    JOIN dim_user mu ON mu.user_id = y.manager_id AND mu.is_active
    WHERE NOT y.manager_is_placeholder
    ORDER BY y.user_id, y.hops
),
branch_manager AS (
    SELECT DISTINCT ON (collector_id) collector_id, user_id
    FROM v_branch_management
    WHERE position = 'branch manager' AND user_is_active
    ORDER BY collector_id, user_id
),
te_overlap AS (
    -- technical executives whose own customer portfolio overlaps the circle's customers
    SELECT h.user_id AS account_id, h.circle_id, m.user_id AS te_id, count(DISTINCT cc.customer_hdr_id) AS shared
    FROM held h
    JOIN circle_customers cc          ON cc.mc_code = h.mc_code
    JOIN "UserCustomerMappings" m     ON m.customer_hdr_id = cc.customer_hdr_id AND m.valid_to IS NULL
    JOIN dim_user t                   ON t.user_id = m.user_id AND t.role_id = 6 AND t.is_active AND NOT t.is_placeholder
    GROUP BY h.user_id, h.circle_id, m.user_id
),
best_te AS (
    SELECT DISTINCT ON (account_id, circle_id) account_id, circle_id, te_id, shared
    FROM te_overlap ORDER BY account_id, circle_id, shared DESC, te_id
),
lead_creators AS (
    -- who actually raises leads in the circle - usually the person working it through the placeholder
    SELECT h.user_id AS account_id, h.circle_id, l.created_by, count(*) AS leads,
           row_number() OVER (PARTITION BY h.user_id, h.circle_id ORDER BY count(*) DESC, l.created_by) AS rnk
    FROM held h
    JOIN "LeadDetails" l ON l.user_mc_code = h.mc_code
    JOIN dim_user cu     ON cu.user_id = l.created_by AND cu.is_active AND NOT cu.is_placeholder
    GROUP BY h.user_id, h.circle_id, l.created_by
),
top_creators AS (
    SELECT lc.account_id, lc.circle_id,
           string_agg(u.user_name || ' (' || lc.leads || ')', ', ' ORDER BY lc.rnk) AS top_lead_creators,
           max(lc.created_by) FILTER (WHERE lc.rnk = 1)  AS top_lead_creator_id,
           max(lc.leads) FILTER (WHERE lc.rnk = 1)       AS top_lead_creator_leads
    FROM lead_creators lc JOIN dim_user u ON u.user_id = lc.created_by
    WHERE lc.rnk <= 3
    GROUP BY lc.account_id, lc.circle_id
),
twin AS (
    -- for a person-named account: an active ordinary account with exactly the same name - usually the same person
    SELECT DISTINCT ON (a.user_id) a.user_id, t.user_id AS twin_id
    FROM accounts a
    JOIN dim_user t ON lower(btrim(t.user_name)) = lower(btrim(a.user_name))
                   AND t.user_id <> a.user_id AND t.is_active AND t.placeholder_status IS NULL
    ORDER BY a.user_id, t.user_id
),
operators AS (
    SELECT o.placeholder_user_id, string_agg(u.user_name, ', ' ORDER BY u.user_name) AS current_operators
    FROM placeholder_operator o JOIN dim_user u ON u.user_id = o.operator_user_id
    WHERE o.unassigned_at IS NULL
    GROUP BY o.placeholder_user_id
)
SELECT h.user_id                                       AS account_id,
       h.user_name                                     AS account_name,
       h.username                                      AS login,
       h.placeholder_status,
       h.is_active                                     AS account_is_active,
       h.uses_crm                                      AS logged_in_last_90_days,
       h.last_login_on,
       h.circle_id,
       h.mc_code,
       mc.collector_id,
       mc.branch_name,
       coalesce(cs.customers, 0)                       AS customers,
       ma.manager_id                                   AS manager_above_id,
       mu.user_name                                    AS manager_above_name,
       ma.manager_id IS NULL                           AS has_no_manager_above,
       bm.user_id                                      AS branch_manager_id,
       bmu.user_name                                   AS branch_manager_name,
       bt.te_id                                        AS best_te_id,
       teu.user_name                                   AS best_te_name,
       bt.shared                                       AS best_te_shared_customers,
       round(100.0 * bt.shared / nullif(cs.customers, 0), 1) AS best_te_overlap_pct,
       tc.top_lead_creators,
       tc.top_lead_creator_id,
       tw.twin_id                                      AS same_name_account_id,
       twu.user_name                                   AS same_name_account_name,
       -- the suggested operator, strongest evidence first
       coalesce(tw.twin_id,
                CASE WHEN bt.shared * 2 >= cs.customers THEN bt.te_id END,
                tc.top_lead_creator_id,
                bt.te_id,
                bm.user_id)                            AS suggested_operator_id,
       CASE
           WHEN tw.twin_id IS NOT NULL                          THEN 'same name'
           WHEN bt.te_id IS NOT NULL AND bt.shared * 2 >= cs.customers
                                                                THEN 'covers most of the circle''s customers'
           WHEN tc.top_lead_creator_id IS NOT NULL              THEN 'raises the most leads in the circle'
           WHEN bt.te_id IS NOT NULL                            THEN 'covers some of the circle''s customers'
           WHEN bm.user_id IS NOT NULL                          THEN 'branch manager (no better evidence)'
       END                                             AS suggestion_basis,
       op.current_operators,
       op.current_operators IS NOT NULL                AS has_operator
FROM held h
LEFT JOIN dim_market_circle mc ON mc.circle_id = h.circle_id
LEFT JOIN circle_size cs       ON cs.mc_code = h.mc_code
LEFT JOIN manager_above ma     ON ma.user_id = h.user_id
LEFT JOIN dim_user mu          ON mu.user_id = ma.manager_id
LEFT JOIN branch_manager bm    ON bm.collector_id = mc.collector_id
LEFT JOIN dim_user bmu         ON bmu.user_id = bm.user_id
LEFT JOIN best_te bt           ON bt.account_id = h.user_id AND bt.circle_id = h.circle_id
LEFT JOIN dim_user teu         ON teu.user_id = bt.te_id
LEFT JOIN top_creators tc      ON tc.account_id = h.user_id AND tc.circle_id = h.circle_id
LEFT JOIN twin tw              ON tw.user_id = h.user_id
LEFT JOIN dim_user twu         ON twu.user_id = tw.twin_id
LEFT JOIN operators op         ON op.placeholder_user_id = h.user_id;

COMMENT ON VIEW v_placeholder_circle IS 'The admin''s worksheet for placeholder logins: one row per placeholder (or confirm) account and the circle it holds, with the evidence for who should operate it. CRM gives a circle with no sales executive a placeholder login, and the technical executive covering the area logs in through it - but records no link between the two. The admin reads this, decides, and records the operator in placeholder_operator; the operator then receives the circle''s customers.';
COMMENT ON COLUMN v_placeholder_circle.placeholder_status IS 'placeholder (an account code, never a person) or confirm (CRM flags it, but it carries a person''s name - check whether it is really a placeholder before assigning anyone).';
COMMENT ON COLUMN v_placeholder_circle.logged_in_last_90_days IS 'Someone is actively using this login - which makes finding the operator more urgent, not less.';
COMMENT ON COLUMN v_placeholder_circle.has_no_manager_above IS 'No active real manager above the account, so no branch manager covers the circle through the reporting line either. Its customers are reachable only through branch lists until an operator is assigned.';
COMMENT ON COLUMN v_placeholder_circle.best_te_overlap_pct IS 'Share of the circle''s customers that the best-matching technical executive already has in their own portfolio.';
COMMENT ON COLUMN v_placeholder_circle.top_lead_creators IS 'The three people who raise the most leads in this circle, with their lead counts - usually whoever works it through the placeholder.';
COMMENT ON COLUMN v_placeholder_circle.same_name_account_id IS 'For a confirm account: an active ordinary account with exactly the same name - most likely the same person, now in another role. Matched by name only, never by phone number (one number is shared by about thirty accounts).';
COMMENT ON COLUMN v_placeholder_circle.suggested_operator_id IS 'Who the evidence points to, strongest first: the same-named account; a technical executive who already covers at least half the circle''s customers; whoever raises the most leads there; any technical executive with overlap; the branch manager. A suggestion for the admin, never applied automatically.';
COMMENT ON COLUMN v_placeholder_circle.suggestion_basis IS 'Why suggested_operator_id was chosen, in words.';
COMMENT ON COLUMN v_placeholder_circle.current_operators IS 'Who the admin has already recorded as operating this login.';

