"""The plan's as-of history.

crm keeps only today's version of the customer plan. To measure a plan on what was known at the time, we keep
our own copies:

  plan_snapshot           the plan lines with a quantity, per header x cycle, on a date. The etl records one at
                          each cycle's hand-off (the approved plan goes to the planners) and at its publish (the
                          projection goes to oracle).
  projection_snapshot     the published projection on the same two dates - what supply actually worked from.
  plan_approval_history   per header x cycle: by which date it was first seen submitted / approved. Kept up to
                          date on every etl run for the current year.

All three are backfilled once from the dated copies crm holds in CRMPROD (SCBusinessMonthlyPlanHdrs_* roughly
monthly since mid 2022 for the status, SCBusinessMonthlyPlanDtls_* for the quantities and
SCBusinessPlanProjections_* for the published projection, on a few dates) - see backfill_from_crm(), run by
scripts/backfill_plan_history.py.
"""

import re
from datetime import date
from psycopg2.extras import execute_values

# approved = status 5, or status 4 in the years up to 2024-25 (the code changed meaning in april 2025)
PLAN_APPROVED_RULE = "({status} = 5 OR ({status} = 4 AND {acc_year} <= '2024-2025'))"

HDRS, DTLS = "SCBusinessMonthlyPlanHdrs", "SCBusinessMonthlyPlanDtls"
PROJ = "SCBusinessPlanProjections"
PROJ_COLS = [c for i in range(1, 14) for c in (f"jc{i}_projection1", f"jc{i}_projection2")]
PROJ_UNPIVOT = "CROSS JOIN LATERAL (VALUES " + ", ".join(f"({i}, x.jc{i}_projection1, x.jc{i}_projection2)" for i in range(1, 14)) + ") AS v (jc_no, p1, p2)"
STATUS_COLS = [f"jc{i}_status" for i in range(1, 14)]
QTY_COLS = [c for i in range(1, 14) for c in (f"jc{i}_week1_user_dfn_qty", f"jc{i}_week2_user_dfn_qty", f"jc{i}_user_dfn_avg_sell_price")]

STATUS_UNPIVOT = "CROSS JOIN LATERAL (VALUES " + ", ".join(f"({i}, h.jc{i}_status)" for i in range(1, 14)) + ") AS s (jc_no, status)"
QTY_UNPIVOT = "CROSS JOIN LATERAL (VALUES " + ", ".join(
    f"({i}, d.jc{i}_week1_user_dfn_qty, d.jc{i}_week2_user_dfn_qty, d.jc{i}_user_dfn_avg_sell_price)" for i in range(1, 14)) + ") AS x (jc_no, w1, w2, price)"


# ------------------------------------------------------------------------------------------------------------------
# the etl step
# ------------------------------------------------------------------------------------------------------------------

# how late a trigger may still be taken. a cycle is about 28 days; past this the plan has moved on and a
# snapshot taken now would not be what the planners saw.
CATCH_UP_DAYS = 21


def _take_plan_snapshot(pg_cur, target_jc_id, acc_year, reason, on_date):
    pg_cur.execute("""
        INSERT INTO plan_snapshot (snapshot_date, plan_id, jc_no, snapshot_source, snapshot_reason, snapshot_jc_id, target_jc_id,
                                   acc_year, customer_id, collector_id, name_key, product_name,
                                   week1_qty, week2_qty, plan_qty, avg_sell_price, status, is_approved, status_source, status_date)
        SELECT %(d)s, f.plan_id, f.jc_no, 'etl', %(reason)s, (SELECT jc_id FROM dim_jc WHERE is_current), %(target)s,
               f.acc_year, f.customer_id, f.collector_id, f.name_key, f.product_name,
               f.week1_qty, f.week2_qty, f.plan_qty, f.avg_sell_price, f.status, f.is_approved, 'etl', %(d)s
        FROM fact_plan_jc f
        WHERE f.acc_year = %(yr)s AND f.has_plan
        ON CONFLICT DO NOTHING""",
        {"d": on_date, "reason": reason, "target": target_jc_id, "yr": acc_year})
    return pg_cur.rowcount


def _take_projection_snapshot(pg_cur, target_jc_id, acc_year, reason, on_date):
    pg_cur.execute("""
        INSERT INTO projection_snapshot (snapshot_date, name_key, collector_id, jc_no, plan_type, snapshot_source, snapshot_reason,
                                         target_jc_id, acc_year, projection1_qty, projection2_qty, projection_qty)
        SELECT %(d)s, x.name_key, x.collector_id, x.jc_no, x.plan_type, 'etl', %(reason)s,
               %(target)s, x.acc_year, sum(x.projection1_qty), sum(x.projection2_qty), sum(x.projection_qty)
        FROM fact_projection_jc x
        WHERE x.acc_year = %(yr)s AND x.jc_id > 0
        GROUP BY x.name_key, x.collector_id, x.jc_no, x.plan_type, x.acc_year
        ON CONFLICT DO NOTHING""",
        {"d": on_date, "reason": reason, "target": target_jc_id, "yr": acc_year})
    return pg_cur.rowcount


def snapshot_plan(pg_cur):
    """Called by the etl after the materialized views are refreshed.

    Records the plan at the two moments that decide a cycle: the hand-off, when the approved plan is compiled and
    given to the planners (first day of week 4 of the previous cycle), and the publish, when the projection goes to
    oracle (last day of the previous cycle). A trigger missed because the etl did not run that day is caught up for
    up to three weeks. Also keeps plan_approval_history current for this year."""

    pg_cur.execute("SELECT 1 FROM pg_matviews WHERE schemaname = current_schema() AND matviewname = 'fact_plan_jc'")
    if pg_cur.fetchone() is None:
        print("plan history: fact_plan_jc not built yet, skipped")
        return
    pg_cur.execute("SELECT jc_id, acc_year FROM dim_jc WHERE is_current")
    row = pg_cur.fetchone()
    if row is None:
        print("plan history: no current cycle in dim_jc, skipped")
        return
    current_jc_id, current_acc_year = row

    # every hand-off / publish due in the last few weeks that we have not recorded yet
    pg_cur.execute("""
        SELECT jc_id, acc_year, reason, on_date FROM (
            SELECT jc_id, acc_year, 'handoff' AS reason, handoff_date AS on_date FROM dim_jc WHERE jc_id > 0
            UNION ALL
            SELECT jc_id, acc_year, 'publish', publish_date FROM dim_jc WHERE jc_id > 0) t
        WHERE on_date IS NOT NULL
          AND on_date <= current_date
          AND on_date > current_date - %s
          AND NOT EXISTS (SELECT 1 FROM plan_snapshot s WHERE s.target_jc_id = t.jc_id AND s.snapshot_reason = t.reason)
        ORDER BY on_date""", (CATCH_UP_DAYS,))
    due = pg_cur.fetchall()

    if not due:
        print("plan history: no hand-off or publish due")
    for jc_id, acc_year, reason, on_date in due:
        lines = _take_plan_snapshot(pg_cur, jc_id, acc_year, reason, on_date)
        proj = _take_projection_snapshot(pg_cur, jc_id, acc_year, reason, on_date)
        print(f"plan history: {reason} snapshot for cycle {jc_id} ({on_date}) - {lines} plan lines, {proj} projection rows")

    pg_cur.execute("""
        INSERT INTO plan_approval_history (plan_id, jc_no, acc_year, first_seen_submitted, first_seen_approved, last_status, last_seen, copies_seen)
        SELECT plan_id, jc_no, acc_year, current_date, CASE WHEN is_approved THEN current_date END, status, current_date, 1
        FROM fact_plan_jc
        WHERE acc_year = %s AND status <> 1
        ON CONFLICT (plan_id, jc_no) DO UPDATE SET
            first_seen_submitted = least(plan_approval_history.first_seen_submitted, EXCLUDED.first_seen_submitted),
            first_seen_approved  = least(plan_approval_history.first_seen_approved, EXCLUDED.first_seen_approved),
            last_status = EXCLUDED.last_status,
            last_seen   = EXCLUDED.last_seen,
            copies_seen = plan_approval_history.copies_seen + CASE WHEN plan_approval_history.last_seen < EXCLUDED.last_seen THEN 1 ELSE 0 END""",
        (current_acc_year,))
    print(f"plan history: approval history of {current_acc_year} updated ({pg_cur.rowcount} header-cycles)")


# ------------------------------------------------------------------------------------------------------------------
# the one-time backfill from crm's dated copies
# ------------------------------------------------------------------------------------------------------------------

def copies_in_crm(sql_cur):
    """The dated copies of the plan tables in CRMPROD: [(table name, 'hdrs' | 'dtls', date created)], oldest first."""

    sql_cur.execute("""
        SELECT name, CONVERT(date, create_date) FROM sys.tables
        WHERE (lower(name) LIKE 'scbusinessmonthlyplanhdrs%' OR lower(name) LIKE 'scbusinessmonthlyplandtls%'
               OR lower(name) LIKE 'scbusinessplanprojections%')
          AND name NOT IN (?, ?, ?) ORDER BY create_date""", (HDRS, DTLS, PROJ))
    out = []
    for name, created in sql_cur.fetchall():
        low = name.lower()
        kind = "hdrs" if low.startswith(HDRS.lower()) else "dtls" if low.startswith(DTLS.lower()) else "proj"
        out.append((name, kind, created))
    return out


def columns_in_crm(sql_cur, table):
    sql_cur.execute("SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(?)", (f"dbo.{table}",))
    return {r[0].lower() for r in sql_cur.fetchall()}


def pull_to_stage(sql_cur, pg_cur, table, columns, stage):
    """Copy the named columns of a crm table into a fresh postgres stage table (all text-free types kept as they come)."""

    pg_cur.execute(f"DROP TABLE IF EXISTS {stage}")
    types = {"header_id": "bigint", "line_id": "bigint", "customer_id": "bigint", "collector_id": "bigint",
             "acc_year": "text", "item_description": "text", "type": "text"}
    pg_cur.execute(f"CREATE TEMP TABLE {stage} (" + ", ".join(
        f"{c} {types.get(c, 'integer' if c.endswith('_status') else 'double precision')}" for c in columns) + ")")
    sql_cur.execute(f"SELECT {', '.join(columns)} FROM dbo.{table} WITH (NOLOCK)")
    n = 0
    while True:
        rows = sql_cur.fetchmany(20000)
        if not rows:
            break
        execute_values(pg_cur, f"INSERT INTO {stage} ({', '.join(columns)}) VALUES %s", [tuple(r) for r in rows], page_size=5000)
        n += len(rows)
    return n


def backfill_approval_from_hdrs_copy(sql_cur, pg_cur, table, copy_date):
    """One dated header copy -> plan_approval_history (first seen submitted / approved by that date)."""

    have = columns_in_crm(sql_cur, table)
    cols = ["header_id", "acc_year"] + [c for c in STATUS_COLS if c in have]
    n = pull_to_stage(sql_cur, pg_cur, table, cols, "hist_hdr")
    for c in STATUS_COLS:
        if c not in have:
            pg_cur.execute(f"ALTER TABLE hist_hdr ADD COLUMN {c} integer")
    pg_cur.execute(f"""
        INSERT INTO plan_approval_history (plan_id, jc_no, acc_year, first_seen_submitted, first_seen_approved, last_status, last_seen, copies_seen)
        SELECT h.header_id, s.jc_no, h.acc_year, %(d)s, CASE WHEN {PLAN_APPROVED_RULE.format(status='s.status', acc_year='h.acc_year')} THEN %(d)s END, s.status, %(d)s, 1
        FROM hist_hdr h {STATUS_UNPIVOT}
        WHERE s.status IS NOT NULL AND s.status <> 1
        ON CONFLICT (plan_id, jc_no) DO UPDATE SET
            first_seen_submitted = least(plan_approval_history.first_seen_submitted, EXCLUDED.first_seen_submitted),
            first_seen_approved  = least(plan_approval_history.first_seen_approved, EXCLUDED.first_seen_approved),
            last_status = CASE WHEN EXCLUDED.last_seen >= plan_approval_history.last_seen THEN EXCLUDED.last_status ELSE plan_approval_history.last_status END,
            last_seen   = greatest(plan_approval_history.last_seen, EXCLUDED.last_seen),
            copies_seen = plan_approval_history.copies_seen + 1""", {"d": copy_date})
    return n, pg_cur.rowcount


def backfill_snapshot_from_dtls_copy(sql_cur, pg_cur, table, copy_date, header_source):
    """One dated detail copy -> plan_snapshot. header_source is (hdrs copy name, its date) for the customer / branch /
    name / status, or None to take them from the live header table (status dated today)."""

    have = columns_in_crm(sql_cur, table)
    cols = ["line_id", "header_id"] + [c for c in QTY_COLS if c in have]
    n = pull_to_stage(sql_cur, pg_cur, table, cols, "hist_dtl")
    for c in QTY_COLS:
        if c not in have:
            pg_cur.execute(f"ALTER TABLE hist_dtl ADD COLUMN {c} double precision")

    if header_source is None:
        status_source, status_date = "live", date.today()
        pg_cur.execute("DROP TABLE IF EXISTS hist_hdr")
        pg_cur.execute(f'CREATE TEMP TABLE hist_hdr AS SELECT header_id, acc_year, customer_id, collector_id, item_description, {", ".join(STATUS_COLS)} FROM "{HDRS}"')
    else:
        status_source, status_date = header_source
        have_h = columns_in_crm(sql_cur, status_source)
        hcols = ["header_id", "acc_year", "customer_id", "collector_id", "item_description"] + [c for c in STATUS_COLS if c in have_h]
        pull_to_stage(sql_cur, pg_cur, status_source, hcols, "hist_hdr")
        for c in STATUS_COLS:
            if c not in have_h:
                pg_cur.execute(f"ALTER TABLE hist_hdr ADD COLUMN {c} integer")

    pg_cur.execute("SELECT jc_id FROM dim_jc WHERE %s BETWEEN jc_start AND jc_end", (copy_date,))
    row = pg_cur.fetchone()
    snapshot_jc_id = row[0] if row else None
    pg_cur.execute(f"""
        WITH cells AS (
            SELECT d.header_id, x.jc_no, max(x.w1) AS w1, max(x.w2) AS w2, max(x.price) AS price
            FROM hist_dtl d {QTY_UNPIVOT}
            GROUP BY d.header_id, x.jc_no
        ),
        st AS (
            SELECT h.header_id, s.jc_no, s.status FROM hist_hdr h {STATUS_UNPIVOT}
        )
        INSERT INTO plan_snapshot (snapshot_date, plan_id, jc_no, snapshot_source, snapshot_reason, snapshot_jc_id, acc_year, customer_id, collector_id,
                                   name_key, product_name, week1_qty, week2_qty, plan_qty, avg_sell_price, status, is_approved, status_source, status_date)
        SELECT %(d)s, c.header_id, c.jc_no, %(src)s, 'crm copy', %(jc)s, h.acc_year, h.customer_id, h.collector_id,
               coalesce(dp.master_name_key, lower(trim(h.item_description))), h.item_description,
               coalesce(c.w1, 0), coalesce(c.w2, 0), coalesce(c.w1, 0) + coalesce(c.w2, 0), nullif(c.price, 0),
               st.status, CASE WHEN st.status IS NULL THEN NULL ELSE {PLAN_APPROVED_RULE.format(status='st.status', acc_year='h.acc_year')} END,
               %(ss)s, %(sd)s
        FROM cells c
        JOIN hist_hdr h ON h.header_id = c.header_id
        LEFT JOIN st ON st.header_id = c.header_id AND st.jc_no = c.jc_no
        LEFT JOIN dim_plan_product dp ON dp.name_key = lower(trim(h.item_description))
        WHERE coalesce(c.w1, 0) + coalesce(c.w2, 0) > 0
        ON CONFLICT DO NOTHING""", {"d": copy_date, "src": table, "jc": snapshot_jc_id, "ss": status_source, "sd": status_date})
    return n, pg_cur.rowcount


def backfill_projection_from_copy(sql_cur, pg_cur, table, copy_date):
    """One dated projection copy -> projection_snapshot (what crm had published on that date)."""

    have = columns_in_crm(sql_cur, table)
    cols = ["line_id", "acc_year", "type", "collector_id", "item_description"] + [c for c in PROJ_COLS if c in have]
    n = pull_to_stage(sql_cur, pg_cur, table, cols, "hist_proj")
    for c in PROJ_COLS:
        if c not in have:
            pg_cur.execute(f"ALTER TABLE hist_proj ADD COLUMN {c} double precision")

    pg_cur.execute("SELECT jc_id FROM dim_jc WHERE %s BETWEEN jc_start AND jc_end", (copy_date,))
    row = pg_cur.fetchone()
    pg_cur.execute(f"""
        INSERT INTO projection_snapshot (snapshot_date, name_key, collector_id, jc_no, plan_type, snapshot_source, snapshot_reason,
                                         target_jc_id, acc_year, projection1_qty, projection2_qty, projection_qty)
        SELECT %(d)s,
               coalesce(dp.master_name_key, lower(trim(x.item_description))),
               x.collector_id, v.jc_no, x.type, %(src)s, 'crm copy', %(jc)s, x.acc_year,
               sum(coalesce(v.p1, 0)), sum(coalesce(v.p2, 0)), sum(coalesce(v.p1, 0) + coalesce(v.p2, 0))
        FROM hist_proj x {PROJ_UNPIVOT}
        LEFT JOIN dim_plan_product dp ON dp.name_key = lower(trim(x.item_description))
        WHERE coalesce(v.p1, 0) <> 0 OR coalesce(v.p2, 0) <> 0
        GROUP BY 2, x.collector_id, v.jc_no, x.type, x.acc_year
        ON CONFLICT DO NOTHING""",
        {"d": copy_date, "src": table, "jc": row[0] if row else None})
    return n, pg_cur.rowcount


def backfill_from_crm(sql_cur, pg, pg_cur, log=print):
    """Load every dated copy: header copies -> plan_approval_history, detail copies -> plan_snapshot (status from
    the header copy nearest in time, or the live table when that is nearer). Safe to rerun: nothing is doubled."""

    copies = copies_in_crm(sql_cur)
    hdrs = [(name, d) for name, kind, d in copies if kind == "hdrs"]
    dtls = [(name, d) for name, kind, d in copies if kind == "dtls"]
    proj = [(name, d) for name, kind, d in copies if kind == "proj"]
    log(f"crm holds {len(hdrs)} header copies, {len(dtls)} detail copies and {len(proj)} projection copies")

    for name, d in hdrs:
        n, m = backfill_approval_from_hdrs_copy(sql_cur, pg_cur, name, d)
        pg.commit()
        log(f"  {name} ({d}): {n} headers read, {m} header-cycles merged")

    today = date.today()
    for name, d in dtls:
        nearest = min(hdrs, key=lambda h: abs((h[1] - d).days), default=None)
        source = None if nearest is None or abs((today - d).days) < abs((nearest[1] - d).days) else nearest
        n, m = backfill_snapshot_from_dtls_copy(sql_cur, pg_cur, name, d, source)
        pg.commit()
        log(f"  {name} ({d}): {n} detail rows read, {m} plan lines kept, status from {source[0] if source else 'the live table'}")

    for name, d in proj:
        n, m = backfill_projection_from_copy(sql_cur, pg_cur, name, d)
        pg.commit()
        log(f"  {name} ({d}): {n} projection rows read, {m} kept")
