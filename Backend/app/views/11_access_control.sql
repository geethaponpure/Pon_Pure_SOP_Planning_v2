-- access_control views: who can log in to the tool, which pages they get, and which rows they see.
-- run by app/repositories/views.py at api start, in file name order. one statement per ';'.
--
-- the admin decides the first two in the tool's own tables (app_user, app_role, app_role_page, app_user_page);
-- the third follows CRM through the user_and_scope views, unless the person's role says "all".
--
--   pages  = the role's default pages + pages added for the person - pages removed for the person
--   rows   = data_access "all"  -> everything
--            data_access "own"  -> what CRM ties to them, per dimension:
--              customer   sales executive / technical executive / branch manager / regional manager and the
--                         branch-list roles: their customers. everyone else: all customers - CRM's own
--                         market-circle rule gives every other role all circles.
--              warehouse  the warehouses CRM maps them to; all warehouses when CRM maps them to none.
--              product    technical executive: the product categories they cover; technical manager / head:
--                         their segments; business head: the segments they approve (division head: the
--                         division). everyone else: all products.


-- ---------------------------------------------------------------------------------------------------------------
-- v_onboard_candidate: the admin's pick list - CRM users who could be onboarded and are not yet.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_onboard_candidate CASCADE;

CREATE VIEW v_onboard_candidate AS
SELECT u.user_id,
       u.user_name,
       u.username,
       u.email,
       u.user_code,
       u.designation,
       u.department,
       u.role_id                                       AS crm_role_id,
       u.role_name                                     AS crm_role_name,
       u.scope_rule                                    AS crm_scope_rule,
       u.manager_name,
       u.last_login_on,
       u.uses_crm,
       u.placeholder_status = 'confirm'                AS needs_confirmation
FROM dim_user u
WHERE u.is_active
  AND NOT u.is_placeholder
  AND nullif(btrim(u.username), '') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app_user a WHERE a.user_id = u.user_id);

COMMENT ON VIEW v_onboard_candidate IS 'The admin''s pick list on User Master: active CRM users who are not yet users of the tool. Placeholder logins and people who have left never appear - the tool only onboards real, current people.';
COMMENT ON COLUMN v_onboard_candidate.crm_scope_rule IS 'How CRM decides what this person sees - what "own" data access will follow once onboarded.';
COMMENT ON COLUMN v_onboard_candidate.needs_confirmation IS 'CRM flags this login as a dummy, but it carries a person''s name. Check it is a real person before onboarding (see v_placeholder_circle).';


-- ---------------------------------------------------------------------------------------------------------------
-- v_app_user: every onboarded user with their role, their data access and whether they may log in.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_app_user CASCADE;

CREATE VIEW v_app_user AS
SELECT a.user_id,
       a.username,
       d.user_name,
       d.email,
       d.role_name                                     AS crm_role_name,
       a.role_id,
       r.code                                          AS role_code,
       r.name                                          AS role_name,
       coalesce(a.data_access_override, r.data_access) AS data_access,
       a.data_access_override IS NOT NULL              AS data_access_set_for_user,
       a.is_active,
       coalesce(d.is_active, false)                    AS crm_user_is_active,
       a.is_active AND coalesce(d.is_active, false) AND NOT coalesce(d.is_placeholder, false)
                                                       AS can_log_in,
       a.password_hash IS NOT NULL                     AS has_password,
       a.must_change_password,
       a.last_login_at,
       a.onboarded_by,
       a.onboarded_at
FROM app_user a
LEFT JOIN app_role r ON r.id = a.role_id
LEFT JOIN dim_user d ON d.user_id = a.user_id;

COMMENT ON VIEW v_app_user IS 'Every user of the tool, one row each: their role, the data access in force, and whether they may log in now. The list on User Master.';
COMMENT ON COLUMN v_app_user.data_access IS 'own (the rows CRM ties to them) or all. The person''s own setting when the admin made one, otherwise the role''s.';
COMMENT ON COLUMN v_app_user.can_log_in IS 'Active in the tool AND still active in CRM. Someone who leaves the company is switched off in CRM and loses the tool the same day, without the admin doing anything.';
COMMENT ON COLUMN v_app_user.must_change_password IS 'The password is a temporary one the admin issued; the next login goes straight to Change Password.';


-- ---------------------------------------------------------------------------------------------------------------
-- v_user_page_access: the pages each user gets - the role's, plus the person's own changes.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_user_page_access CASCADE;

CREATE VIEW v_user_page_access AS
WITH role_pages AS (
    SELECT a.user_id, rp.page_code, rp.can_edit
    FROM app_user a
    JOIN app_role r       ON r.id = a.role_id AND r.is_active
    JOIN app_role_page rp ON rp.role_id = r.id
),
candidates AS (
    SELECT user_id, page_code FROM role_pages
    UNION
    SELECT user_id, page_code FROM app_user_page WHERE effect = 'add'
)
SELECT c.user_id,
       c.page_code,
       p.name                                          AS page_name,
       p.section,
       p.sort_order,
       p.is_admin_page,
       CASE WHEN up.effect = 'add' THEN up.can_edit ELSE rp.can_edit END AS can_edit,
       CASE WHEN rp.page_code IS NULL THEN 'added for this user'
            WHEN up.effect = 'add'    THEN 'role, changed for this user'
            ELSE 'role' END                            AS granted_by
FROM candidates c
JOIN app_page p            ON p.page_code = c.page_code AND p.is_active
JOIN v_app_user u          ON u.user_id = c.user_id AND u.can_log_in
LEFT JOIN role_pages rp    ON rp.user_id = c.user_id AND rp.page_code = c.page_code
LEFT JOIN app_user_page up ON up.user_id = c.user_id AND up.page_code = c.page_code
WHERE up.effect IS DISTINCT FROM 'remove';

COMMENT ON VIEW v_user_page_access IS 'The pages each user may open, one row per user and page: their role''s default pages, plus pages added for them, minus pages removed for them. What the login returns to build the menu, and what the api checks before serving a page. Only users who can log in appear.';
COMMENT ON COLUMN v_user_page_access.can_edit IS 'false = the page opens read-only. A page added for the person carries its own setting.';
COMMENT ON COLUMN v_user_page_access.granted_by IS 'role; added for this user (the role does not have it); or role, changed for this user (the role has it, the admin changed can_edit for this person).';


-- ---------------------------------------------------------------------------------------------------------------
-- v_user_data_scope: the rows each user sees - per dimension, either everything or a list.
-- ---------------------------------------------------------------------------------------------------------------
DROP VIEW IF EXISTS v_user_data_scope CASCADE;

CREATE VIEW v_user_data_scope AS
WITH people AS (
    SELECT a.user_id, a.data_access, d.role_id, d.scope_rule,
           -- CRM limits customers only for these; its market-circle rule gives every other role all circles
           (d.role_id IN (5, 6, 7, 8) OR d.scope_rule = 'branch list')  AS customers_limited,
           d.role_id IN (6, 9, 90, 91)                                  AS products_limited,
           EXISTS (SELECT 1 FROM "UserInventoryOrgMappings" m WHERE m.user_id = a.user_id) AS warehouses_limited
    FROM v_app_user a
    JOIN dim_user d ON d.user_id = a.user_id
    WHERE a.can_log_in
),
dims AS (
    SELECT * FROM (VALUES ('customer'), ('warehouse'), ('product')) v(dimension)
),
-- everything, on a dimension where the person is not limited
everything AS (
    SELECT p.user_id, p.data_access, x.dimension,
           CASE WHEN p.data_access = 'all' THEN 'data access: all'
                WHEN x.dimension = 'customer'  THEN 'CRM does not limit this role''s customers'
                WHEN x.dimension = 'warehouse' THEN 'CRM maps no warehouses to this person'
                ELSE 'CRM does not limit this role''s products' END AS via
    FROM people p CROSS JOIN dims x
    WHERE p.data_access = 'all'
       OR (x.dimension = 'customer'  AND NOT p.customers_limited)
       OR (x.dimension = 'warehouse' AND NOT p.warehouses_limited)
       OR (x.dimension = 'product'   AND NOT p.products_limited)
),
customers AS (
    SELECT DISTINCT ON (s.user_id, s.customer_hdr_id) s.user_id, s.customer_hdr_id, s.via
    FROM v_user_customer_scope s
    JOIN people p ON p.user_id = s.user_id AND p.data_access = 'own' AND p.customers_limited
    ORDER BY s.user_id, s.customer_hdr_id, s.via
),
warehouses AS (
    SELECT DISTINCT w.user_id, w.warehouse_id
    FROM v_user_warehouse_scope w
    JOIN people p ON p.user_id = w.user_id AND p.data_access = 'own'
),
products AS (
    -- technical executive: the product categories they cover
    SELECT t.user_id, t.category_id, t.segment2 AS division, t.segment3 AS segment, t.segment4 AS sub_segment,
           'categories they cover' AS via
    FROM v_technical_scope t
    JOIN people p ON p.user_id = t.user_id AND p.data_access = 'own' AND p.role_id = 6
    WHERE t.scope_dimension = 'product category'
    UNION
    -- technical manager / head: their segments
    SELECT t.user_id, NULL, t.segment2, t.segment3, t.segment4, 'segments they head'
    FROM v_technical_scope t
    JOIN people p ON p.user_id = t.user_id AND p.data_access = 'own' AND p.role_id IN (90, 91)
    WHERE t.scope_dimension = 'segment'
    UNION
    -- business head: the segments CRM's approval workflow names them for
    SELECT h.approver_id, NULL, h.division, h.segment, h.sub_segment, 'segments they approve'
    FROM v_segment_head h
    JOIN people p ON p.user_id = h.approver_id AND p.data_access = 'own' AND p.role_id = 9
    UNION
    SELECT h.division_head_id, NULL, h.division, NULL, NULL, 'division they head'
    FROM v_segment_head h
    JOIN people p ON p.user_id = h.division_head_id AND p.data_access = 'own' AND p.role_id = 9
)
SELECT user_id, data_access, dimension, true AS sees_all,
       NULL::bigint AS customer_hdr_id, NULL::bigint AS warehouse_id,
       NULL::bigint AS category_id, NULL::text AS division, NULL::text AS segment, NULL::text AS sub_segment, via
FROM everything
UNION ALL
SELECT user_id, 'own', 'customer', false, customer_hdr_id, NULL, NULL, NULL, NULL, NULL, via
FROM customers
UNION ALL
SELECT user_id, 'own', 'warehouse', false, NULL, warehouse_id, NULL, NULL, NULL, NULL, 'warehouses CRM maps them to'
FROM warehouses
UNION ALL
SELECT user_id, 'own', 'product', false, NULL, NULL, category_id, division, segment, sub_segment, via
FROM products;

COMMENT ON VIEW v_user_data_scope IS 'The rows each user of the tool may see - the one place every page filters through, so no page re-implements scope. Three dimensions: customer, warehouse and product. For each, a user has either one row with sees_all (no filter on that dimension) or a list of what they may see; a page applies the dimensions it shows, and the lists combine (a technical executive sees their customers AND their product categories). Always filter on user_id - read whole, the branch-list users make it large. A dimension with no rows at all for a user means they see nothing on it: CRM limits them but gives them nothing (a sales executive holding no circle, say).';
COMMENT ON COLUMN v_user_data_scope.data_access IS 'all (the role or the person is set to see everything) or own (follows CRM).';
COMMENT ON COLUMN v_user_data_scope.dimension IS 'customer, warehouse or product.';
COMMENT ON COLUMN v_user_data_scope.sees_all IS 'No filter on this dimension. The id columns are empty on these rows.';
COMMENT ON COLUMN v_user_data_scope.category_id IS 'A product category a technical executive covers. Technical managers, heads and business heads are limited by division / segment / sub_segment instead; an empty segment or sub_segment means the whole level above.';
COMMENT ON COLUMN v_user_data_scope.via IS 'Why the row is there: the CRM rule that gave it, or data access all.';
