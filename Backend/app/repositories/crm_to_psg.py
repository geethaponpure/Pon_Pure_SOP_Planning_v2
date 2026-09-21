import csv
import io
import time
import pyodbc
import psycopg2
from concurrent.futures import ProcessPoolExecutor, as_completed, wait, FIRST_COMPLETED
from app.core.database import get_postgres_cursor, get_sql_server_cursor
from app.schemas.tables_schemas import TABLES_COLUMNS
from app.core.constants import CRM_TABLES
from app.core.config import settings
from app.repositories.views import refresh_materialized_views
from app.repositories.utils import (SOURCE_FILTERS, SEED_ROWS, STAGE_FIXES, LOAD_LEVELS,
                                   SNAPSHOT_TABLES, UPSERT_TABLES, PARENT_CHECK,
                                   LARGE_TABLES, RANGE_ROWS, INNER_WORKERS, DERIVED_COLUMNS)

#==================================================================================

SRC = "[CRMPROD].[dbo]"
CHUNK = 50_000 # rows per COPY batch (bounds memory)
NULL = r"\N" # NULL marker so NULL and '' stay different

# the crm link drops now and then (10054 closed by the remote host, 10060 timed out). a long read is the
# one that gets hit. these are the sqlstates / codes that mean "the link", not "the data or the sql".
LINK_ERRORS = ("08S01", "08001", "HYT00", "10054", "10060")
RETRIES = 3         # attempts per table
RETRY_WAIT = 20     # seconds between them

#==================================================================================


def get_columns_sql_format(columns):
    """Sql server column format."""
    return ", ".join(f"[{column}]" for column in columns)

def get_columns_psg_format(columns):
    """PostgreSQL column format."""
    return ", ".join(f'"{column.lower()}"' for column in columns)



def get_table_PK(pg_cursor:psycopg2.extensions.cursor,table_name):
    """Return the PostgreSQL primary key column name."""
    pg_cursor.execute("""
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = %s::regclass
          AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)
    """, (f'"{table_name}"',))

    row = pg_cursor.fetchone()
    return row[0] if row else None



def clean_values(v):
    """Make one value COPY-safe."""

    if v is None:
        return NULL
    if isinstance(v, (bytes, bytearray)):
        return "\\x" + v.hex() # bytea hex format
    if isinstance(v, str):
        return v.replace("\x00", "") # Postgres text can't hold NUL chars
    return v



def copy_rows(ss_cur, pg_cur, target, columns):
    """Stream the open SQL Server result set into `target` with COPY, chunk by chunk."""
    sql = f"COPY {target} ({get_columns_psg_format(columns)}) FROM STDIN WITH (FORMAT csv, NULL '{NULL}')"

    total = 0
    while rows := ss_cur.fetchmany(CHUNK):
        buffer = io.StringIO()
        csv.writer(buffer).writerows([clean_values(value) for value in row] for row in rows)
        buffer.seek(0)
        pg_cur.copy_expert(sql, buffer)
        total += len(rows)

    return total



def get_last_pk_value(pg_cur, table_name):
    """Use for get pk or unique value or timestamp(incremental format)"""

    pg_cur.execute("SELECT last_pk FROM crm_sync_metadata WHERE table_name = %s", (table_name,))
    row = pg_cur.fetchone()
    return row[0] if row else None



def save_progress(pg_cur, table,category, last_pk, no_of_rows_sync, status="Done", error_message=None):
    """Update the metadata table after successful run"""

    pg_cur.execute("""
    INSERT INTO crm_sync_metadata
    (table_name,table_category, last_pk, last_sync_at, rows_synced, sync_status, error_message)
    VALUES
    (%s, %s,%s, now(), %s, %s, %s)
    ON CONFLICT (table_name) DO UPDATE
    SET last_pk = EXCLUDED.last_pk,
    last_sync_at = now(),
    rows_synced = EXCLUDED.rows_synced,
    sync_status = EXCLUDED.sync_status,
    error_message = EXCLUDED.error_message
    """, (table,category, last_pk, no_of_rows_sync, status, error_message))



def get_child_tables(pg_cur, table):
    """Which tables have foreign keys pointing to this table, directly or indirectly?"""
    pg_cur.execute("""
    WITH RECURSIVE kids AS (
        SELECT c.conrelid AS oid
        FROM pg_constraint c
        WHERE c.contype = 'f'
          AND c.confrelid = %s::regclass

        UNION

        SELECT c.conrelid
        FROM pg_constraint c
        JOIN kids k ON c.confrelid = k.oid
        WHERE c.contype = 'f'
    )
    SELECT cl.relname
    FROM kids
    JOIN pg_class cl ON cl.oid = kids.oid
    """, (f'"{table}"',))

    return [r[0] for r in pg_cur.fetchall()]



def load_stage(pg_cur, ss_cur, table, columns, pk_clm, upsert=False):
    """The open CRM result set -> temp stage -> parent check -> stage fixes -> insert.
    Shared by sync_table (whole table) and sync_range (one pk range of a large table).
    Returns (rows copied, max pk seen, first pk held back because its parent is missing)."""

    # Temporary staging table. TEMP is private to this session, so parallel range workers
    # can all call theirs 'stage' without seeing each other.
    pg_cur.execute(
        f'CREATE TEMP TABLE stage (LIKE "{table}" INCLUDING DEFAULTS) ON COMMIT DROP'
    )

    # Copy data
    no_of_rows = copy_rows(ss_cur, pg_cur, "stage", columns)

    fetched_max_pk, held_from = None, None
    if pk_clm:
        pg_cur.execute(f'SELECT MAX("{pk_clm.lower()}") FROM stage')
        fetched_max_pk = pg_cur.fetchone()[0]           # type: ignore

    # Hold back rows whose parent was created after the parent level loaded
    for fk, parent, ppk in PARENT_CHECK.get(table, []):
        pg_cur.execute(f'SELECT MAX("{ppk}") FROM "{parent}"')
        parent_max = pg_cur.fetchone()[0]               # type: ignore

        if pk_clm:
            pg_cur.execute(f'SELECT MIN("{pk_clm}") FROM stage WHERE "{fk}" > %s', (parent_max,))
            first_new = pg_cur.fetchone()[0]            # type: ignore
            if first_new is not None:
                pg_cur.execute(f'DELETE FROM stage WHERE "{pk_clm}" >= %s', (first_new,))
                held_from = first_new if held_from is None else min(held_from, first_new)
                fetched_max_pk = held_from - 1          # so they're fetched again next run
        else:
            pg_cur.execute(f'UPDATE stage SET "{fk}" = NULL WHERE "{fk}" > %s', (parent_max,))

    # Fix FK-related values
    for fix in STAGE_FIXES.get(table, []):
        pg_cur.execute(fix)

    # Columns to land: what came from crm plus what the stage fixes derived (e.g. BiStockDetail.item_id)
    all_cols = list(columns) + DERIVED_COLUMNS.get(table, [])
    cols = get_columns_psg_format(all_cols)

    #Insert data into PSG table
    if upsert:
        # merge: new rows inserted, existing rows updated column by column
        non_pk = [c for c in all_cols if c.lower() != pk_clm.lower()]           #type: ignore
        set_clause = ", ".join(f'"{c.lower()}" = EXCLUDED."{c.lower()}"' for c in non_pk)
        pg_cur.execute(
            f'INSERT INTO "{table}" ({cols}) '
            f'SELECT {cols} FROM stage '
            f'ON CONFLICT ("{pk_clm.lower()}") DO UPDATE SET {set_clause}'      #type: ignore
        )
    else:
        pg_cur.execute(
            f'INSERT INTO "{table}" ({cols}) '
            f'SELECT {cols} FROM stage '
            f'ON CONFLICT DO NOTHING'
        )

    return no_of_rows, fetched_max_pk, held_from



def is_link_error(e):
    """Did the crm link drop, as opposed to a data or sql error?"""
    msg = str(e)
    return any(code in msg for code in LINK_ERRORS)



def sync_table(table, columns, category):
    """One table, retried when the crm link drops. Every attempt is one transaction on fresh connections,
    so a failed attempt leaves nothing behind and a retry is safe in every mode (snapshot, upsert, incremental).
    Anything that is not a link error fails straight away."""

    for attempt in range(1, RETRIES + 1):
        try:
            return _sync_table_once(table, columns, category)
        except Exception as e:
            if not is_link_error(e) or attempt == RETRIES:
                raise
            print(f"[{category}] {table}: crm link dropped, retry {attempt}/{RETRIES - 1} in {RETRY_WAIT}s")
            time.sleep(RETRY_WAIT)



def _sync_table_once(table, columns, category):
    """One attempt at one table: crm -> stage -> fixes -> table, one transaction."""

    ss, ss_cur = get_sql_server_cursor()
    pg, pg_cur = get_postgres_cursor()

    try:
        if table in SNAPSHOT_TABLES:
            # Snapshot table is fully reloaded.
            # Any child tables are wiped too and their metadata is reset.
            kids = get_child_tables(pg_cur, table)
            names = ", ".join(f'"{t}"' for t in sorted([table] + kids))

            pg_cur.execute(f"LOCK TABLE {names} IN ACCESS EXCLUSIVE MODE")

            pg_cur.execute(f'TRUNCATE "{table}" RESTART IDENTITY CASCADE')

            if kids:
                pg_cur.execute(
                    "DELETE FROM crm_sync_metadata "
                    "WHERE table_name = ANY(%s)",
                    (kids,)
                )

            last_pk_val, pk_clm = None, None
            conditions, params = [], []

        elif table in UPSERT_TABLES:
            # Master table: read in full every run and merge on the pk.
            # No truncate (children point here), no watermark.
            pk_clm = get_table_PK(pg_cur, table)

            if pk_clm is None:
                raise RuntimeError(f"{table}: no primary key in postgres. add it to the model")

            last_pk_val = None
            conditions, params = [], []

        else:
            # Get table PK created by SQLAlchemy models
            pk_clm = get_table_PK(pg_cur, table)

            if pk_clm is None:
                raise RuntimeError(
                    f"{table}: no primary key in postgres. "
                    "add it to the model or to SNAPSHOT_TABLES / UPSERT_TABLES"
                )

            # Get last inserted PK value from postgress
            last_pk_val = get_last_pk_value(pg_cur, table)

            conditions, params = [], []

        #Get columns in SQL server format
        src_cols = get_columns_sql_format(columns)


        if table not in SNAPSHOT_TABLES and table not in UPSERT_TABLES:
            if last_pk_val is not None:
                conditions.append(f"[{pk_clm}] > ?")
                params.append(last_pk_val)

            else: # First run
                kids = get_child_tables(pg_cur, table) #get names of all the child tables 

                names = ", ".join(f'"{t}"' for t in sorted([table] + kids))
                pg_cur.execute(
                    f"LOCK TABLE {names} IN ACCESS EXCLUSIVE MODE"
                )

                pg_cur.execute(f'TRUNCATE "{table}" CASCADE')

                if kids:
                    pg_cur.execute(
                        "DELETE FROM crm_sync_metadata "
                        "WHERE table_name = ANY(%s)",
                        (kids,)
                    )

        # Apply source-side filter
        if table in SOURCE_FILTERS:
            conditions.append(SOURCE_FILTERS[table])

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        ss_cur.execute(
            f"SELECT {src_cols} FROM {SRC}.[{table}] {where}",
            params
        )

        # stage -> parent check -> fixes -> insert (shared with the range workers)
        no_of_rows, fetched_max_pk, _ = load_stage(
            pg_cur, ss_cur, table, columns, pk_clm, upsert=table in UPSERT_TABLES
        )

        # Insert catch-all parent row
        if table in SEED_ROWS:
            pg_cur.execute(SEED_ROWS[table])

        # Update sync progress
        if table in SNAPSHOT_TABLES or table in UPSERT_TABLES:
            save_progress(pg_cur,table,category,None,no_of_rows)
        elif no_of_rows > 0:
            new_last_pk = fetched_max_pk
            save_progress(pg_cur,table,category,new_last_pk,no_of_rows)
        else:
            new_last_pk = last_pk_val
            save_progress(pg_cur,table,category,new_last_pk,no_of_rows,"No_New_Data")


        pg.commit()
        return no_of_rows

    except Exception as e:
        pg.rollback()
        raise 

    finally:
        ss.close()
        pg.close()



def sync_range(table, columns, pk_clm, lo, hi):
    """One pk range (lo, hi] of a large table. Own connections, own transaction, one commit.
    Returns (lo, hi, rows, held_from)."""

    ss, ss_cur = get_sql_server_cursor()
    pg, pg_cur = get_postgres_cursor()

    try:
        conditions = [f"[{pk_clm}] > ?", f"[{pk_clm}] <= ?"]
        if table in SOURCE_FILTERS:
            conditions.append(SOURCE_FILTERS[table])

        ss_cur.execute(
            f"SELECT {get_columns_sql_format(columns)} FROM {SRC}.[{table}] "
            f"WHERE {' AND '.join(conditions)}",
            (lo, hi)
        )

        rows, _, held_from = load_stage(pg_cur, ss_cur, table, columns, pk_clm)
        pg.commit()
        return lo, hi, rows, held_from

    except Exception:
        pg.rollback()
        raise

    finally:
        ss.close()
        pg.close()



def sync_large_table(table, columns, category):
    """Incremental table read in parallel pk ranges (LARGE_TABLES).
    Same level rules as sync_table; inside, INNER_WORKERS processes each take a range.
    The watermark only advances over contiguous good ranges: a failed range is re-fetched
    next run and rows loaded above it are absorbed by ON CONFLICT DO NOTHING."""

    ss, ss_cur = get_sql_server_cursor()
    pg, pg_cur = get_postgres_cursor()

    try:
        pk_clm = get_table_PK(pg_cur, table)
        if pk_clm is None:
            raise RuntimeError(f"{table}: no primary key in postgres. add it to the model")

        last_pk_val = get_last_pk_value(pg_cur, table)

        if last_pk_val is None:
            # First run: same reset as sync_table, committed before any worker starts
            kids = get_child_tables(pg_cur, table)
            names = ", ".join(f'"{t}"' for t in sorted([table] + kids))
            pg_cur.execute(f"LOCK TABLE {names} IN ACCESS EXCLUSIVE MODE")
            pg_cur.execute(f'TRUNCATE "{table}" CASCADE')
            if kids:
                pg_cur.execute("DELETE FROM crm_sync_metadata WHERE table_name = ANY(%s)", (kids,))
            pg.commit()

        # pk span on crm: clustered index, instant
        ss_cur.execute(f"SELECT MIN([{pk_clm}]), MAX([{pk_clm}]) FROM {SRC}.[{table}]")
        src_min, src_max = ss_cur.fetchone()                #type: ignore

        if src_max is None or (last_pk_val is not None and src_max <= last_pk_val):
            save_progress(pg_cur, table, category, last_pk_val, 0, "No_New_Data")
            pg.commit()
            return 0

        lo = (src_min - 1) if last_pk_val is None else last_pk_val
        ranges = []
        while lo < src_max:
            hi = min(lo + RANGE_ROWS, src_max)
            ranges.append((lo, hi))
            lo = hi
    finally:
        ss.close()
        pg.close()

    # fan out: one range per worker, one retry per range (the link drop usually passes second time)
    results = {}                                            # lo -> (hi, rows, held_from) or None when failed
    with ProcessPoolExecutor(max_workers=INNER_WORKERS) as pool:
        pending = {pool.submit(sync_range, table, columns, pk_clm, r[0], r[1]): (r, 0) for r in ranges}
        while pending:
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for job in done:
                r, attempt = pending.pop(job)
                try:
                    lo_, hi_, rows, held = job.result()
                    results[lo_] = (hi_, rows, held)
                except Exception as e:
                    if attempt == 0:
                        pending[pool.submit(sync_range, table, columns, pk_clm, r[0], r[1])] = (r, 1)
                    else:
                        print(f"  {table} range ({r[0]}, {r[1]}] FAILED twice -> {e}")
                        results[r[0]] = None

    # watermark: walk the ranges in pk order, stop at the first failure or hold-back
    total, new_last_pk, failed = 0, last_pk_val, []
    for r_lo, r_hi in ranges:
        res = results.get(r_lo)
        if res is None:
            failed.append((r_lo, r_hi))
            break
        hi_, rows, held = res
        total += rows
        if held is not None:
            new_last_pk = held - 1
            break
        new_last_pk = hi_

    pg, pg_cur = get_postgres_cursor()
    try:
        if table in SEED_ROWS:
            pg_cur.execute(SEED_ROWS[table])
        status = "Partial" if failed else ("Done" if total > 0 else "No_New_Data")
        save_progress(pg_cur, table, category, new_last_pk, total, status)
        pg.commit()
    finally:
        pg.close()

    if failed:
        raise RuntimeError(
            f"{table}: {len(failed)} range(s) failed, watermark held at {new_last_pk}, "
            f"{total} rows loaded and kept"
        )
    return total



def export_table_from_sql_to_psg(workers=4):
    """Sync tables level by level; parallel inside each level."""
    lookup = {table: (category, cols) for category, tables in TABLES_COLUMNS.items() for table, cols in tables.items()}

    with ProcessPoolExecutor(max_workers=workers) as pool:
        for level in LOAD_LEVELS:
            start = time.perf_counter()
            jobs = {pool.submit(sync_large_table if table in LARGE_TABLES else sync_table,
                                table, lookup[table][1], lookup[table][0]): table
                    for table in level if table in lookup}
            for job in as_completed(jobs):
                table = jobs[job]
                category = lookup[table][0]
                try:
                    end = time.perf_counter()
                    print(f"[{category}] {table}: {job.result()} rows = [Time]:{(end-start)/60:.2f}mins")
                except Exception as e:
                    print(f"[{category}] {table}: FAILED -> {e}")

    # the materialized views hold data, so they only see this run once refreshed (plain views need nothing)
    pg, pg_cur = get_postgres_cursor()
    try:
        refresh_materialized_views(pg_cur)
        pg.commit()
    finally:
        pg.close()



if __name__ == "__main__":
    export_table_from_sql_to_psg()