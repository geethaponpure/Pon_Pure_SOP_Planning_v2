import csv
import io
import pyodbc
import psycopg2
from concurrent.futures import ProcessPoolExecutor, as_completed
from app.core.database import get_postgres_cursor, get_sql_server_cursor
from app.schemas.tables_schemas import TABLES_COLUMNS
from app.core.constants import SQL_TO_PG_TYPES, CRM_TABLES
from app.core.config import settings
from app.etl.extract.utils import (SOURCE_FILTERS, SEED_ROWS, STAGE_FIXES, LOAD_LEVELS,
                                   SNAPSHOT_TABLES, UPSERT_TABLES, PARENT_CHECK)

#==================================================================================

SRC = "[CRMPROD].[dbo]"
CHUNK = 50_000 # rows per COPY batch (bounds memory)
NULL = r"\N" # NULL marker so NULL and '' stay different

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



def sync_table(table, columns, category):
    """This function is used to fetch data from CRM to PostgreSQL."""

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

        # Temporary staging table
        pg_cur.execute(
            f'CREATE TEMP TABLE stage (LIKE "{table}" INCLUDING DEFAULTS) ON COMMIT DROP'
        )

        # Copy data
        no_of_rows = copy_rows(ss_cur, pg_cur, "stage", columns)

        if pk_clm:
            pg_cur.execute(f'SELECT MAX("{pk_clm.lower()}") FROM stage')
            fetched_max_pk = pg_cur.fetchone()[0]           # type: ignore
        else:
            fetched_max_pk = None

        # Hold back rows whose parent was created after the parent level loaded
        for fk, parent, ppk in PARENT_CHECK.get(table, []):
            pg_cur.execute(f'SELECT MAX("{ppk}") FROM "{parent}"')
            parent_max = pg_cur.fetchone()[0]               # type: ignore

            if pk_clm:
                pg_cur.execute(f'SELECT MIN("{pk_clm}") FROM stage WHERE "{fk}" > %s', (parent_max,))
                first_new = pg_cur.fetchone()[0]            # type: ignore
                if first_new is not None:
                    pg_cur.execute(f'DELETE FROM stage WHERE "{pk_clm}" >= %s', (first_new,))
                    fetched_max_pk = first_new - 1        # so they're fetched again next run
            else:
                pg_cur.execute(f'UPDATE stage SET "{fk}" = NULL WHERE "{fk}" > %s', (parent_max,))


        # Fix FK-related values
        for fix in STAGE_FIXES.get(table, []):
            pg_cur.execute(fix)

        # Get columns in PSG format
        cols = get_columns_psg_format(columns)

        #Insert data into PSG table
        if table in UPSERT_TABLES:
            # merge: new rows inserted, existing rows updated column by column
            non_pk = [c for c in columns if c.lower() != pk_clm.lower()]            #type: ignore
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



def export_table_from_sql_to_psg(workers=4):
    """Sync tables level by level; parallel inside each level."""
    lookup = {table: (category, cols) for category, tables in TABLES_COLUMNS.items() for table, cols in tables.items()}

    with ProcessPoolExecutor(max_workers=workers) as pool:
        for level in LOAD_LEVELS:
            jobs = {pool.submit(sync_table, table, lookup[table][1], lookup[table][0]): table for table in level if table in lookup}
            for job in as_completed(jobs):
                table = jobs[job]
                category = lookup[table][0]
                try:
                    print(f"[{category}] {table}: {job.result()} rows")
                except Exception as e:
                    print(f"[{category}] {table}: FAILED -> {e}")



if __name__ == "__main__":
    export_table_from_sql_to_psg()