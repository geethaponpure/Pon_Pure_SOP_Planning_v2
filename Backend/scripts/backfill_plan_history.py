"""One-time backfill of the plan's history from the dated copies crm holds in CRMPROD.

    cd Backend
    ../.venv/Scripts/python.exe scripts/backfill_plan_history.py

Reads every SCBusinessMonthlyPlanHdrs_* copy into plan_approval_history and every SCBusinessMonthlyPlanDtls_* copy
into plan_snapshot. Needs the api to have created the two tables (a restart) and the business_plan views to exist.
Safe to rerun: nothing is doubled. Takes a while - the copies come over the crm link at a few thousand rows a second.
"""

import sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import get_sql_server_cursor, get_postgres_cursor
from app.repositories.plan_history import backfill_from_crm


def main():
    sql_conn, sql_cur = get_sql_server_cursor()
    pg, pg_cur = get_postgres_cursor()
    pg_cur.execute("SET statement_timeout = '30min'")
    pg.commit()
    started = time.time()
    try:
        backfill_from_crm(sql_cur, pg, pg_cur)
        pg_cur.execute("SELECT count(*), count(DISTINCT snapshot_date) FROM plan_snapshot")
        n, d = pg_cur.fetchone()                         #type: ignore
        pg_cur.execute("SELECT count(*), min(first_seen_submitted), max(last_seen) FROM plan_approval_history")
        a, lo, hi = pg_cur.fetchone()                    #type: ignore
        print(f"\nplan_snapshot: {n} lines over {d} dates; plan_approval_history: {a} header-cycles, {lo} .. {hi}")
        print(f"done in {(time.time() - started) / 60:.1f} min")
    finally:
        pg.close()
        sql_conn.close()


if __name__ == "__main__":
    main()
