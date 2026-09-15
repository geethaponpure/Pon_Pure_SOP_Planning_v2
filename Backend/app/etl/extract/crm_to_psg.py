import csv
import io
import pyodbc
from concurrent.futures import ProcessPoolExecutor, as_completed
from app.core.database import get_postgres_cursor, get_sql_server_cursor
from app.schemas.tables_schemas import TABLES_COLUMNS
from app.core.constants import SQL_TO_PG_TYPES, CRM_TABLES
from app.core.config import settings


#==================================================================================

SRC = "[CRMPROD].[dbo]"
CHUNK = 500_000 # rows per COPY batch (bounds memory)
NULL = r"\N" # NULL marker so NULL and '' stay different


# Keys for tables with no declared PK (verified unique). Names must match item_master exactly.
PK_OVERRIDE = {
"CustomerClassificationHeaders": ["Header_Id"],
"CustomerClassificationDetails": ["Line_Id"],
"SocPendingDetails": ["SyncDate"],
}

#table where unique value only in timestamp column
TIMESTAMP_TABLES = {"SocPendingDetails": "SyncDate"}

#==================================================================================


def get_columns_sql_format(columns):
    """Sql server column format."""
    return ", ".join(f"[{column}]" for column in columns)

def get_columns_psg_format(columns):
    """PostgreSQL column format."""
    return ", ".join(f'"{column.lower()}"' for column in columns)



def get_table_schema(sql_cursor:pyodbc.Cursor,table_name):
    """This function is use to get table schema and its foreign key"""

    #query to get table schema
    sql_cursor.execute("""
    SELECT COLUMN_NAME, DATA_TYPE
    FROM CRMPROD.INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME = ?
    ORDER BY ORDINAL_POSITION
    """, table_name)

    table_schema = {column: SQL_TO_PG_TYPES.get(data_type, "TEXT") for column, data_type in sql_cursor.fetchall()}

    #query to get foreign key if not we get then we find in PK_OVERRIDE
    sql_cursor.execute("""
    SELECT k.COLUMN_NAME
    FROM CRMPROD.INFORMATION_SCHEMA.TABLE_CONSTRAINTS t
    JOIN CRMPROD.INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    ON k.CONSTRAINT_NAME = t.CONSTRAINT_NAME AND k.TABLE_SCHEMA = t.TABLE_SCHEMA
    WHERE t.CONSTRAINT_TYPE = 'PRIMARY KEY'
    AND t.TABLE_SCHEMA = 'dbo' AND t.TABLE_NAME = ?
    ORDER BY k.ORDINAL_POSITION""", table_name)

    primary_key = PK_OVERRIDE.get(table_name) or [r[0] for r in sql_cursor.fetchall()]
    return table_schema, primary_key[0]




def ensure_pg_table(pg_cur, table, columns, types, pk):
    """Create the Postgres table add PK, index on the watermark column if incremental."""

    column_with_dtype = ", ".join(f'"{(column.lower())}" {types[column]}' for column in columns)

    pk_sql = f', PRIMARY KEY ("{pk.lower()}")' if pk else ""

    sql_query = f'CREATE TABLE IF NOT EXISTS "{table}" ({column_with_dtype}{pk_sql})'

    pg_cur.execute(sql_query)



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



def sync_table(table, columns, category):
    """This function is used to fetch data from CRM to PostgreSQL."""

    # Get connections and cursors
    ss, ss_cur = get_sql_server_cursor()
    pg, pg_cur = get_postgres_cursor()
    time_clm = TIMESTAMP_TABLES.get(table)

    try:
        # Get table schema
        types, pk_clm = get_table_schema(ss_cur, table)

        # Ensure table exists in PostgreSQL
        ensure_pg_table(pg_cur, table, columns, types, pk_clm)

        # Get last inserted PK value
        last_pk_val = get_last_pk_value(pg_cur, table)

        # SQL Server -> PostgreSQL
        src_cols = get_columns_sql_format(columns)

        if last_pk_val is not None:

            # Second run or after that
            if time_clm:
                where = f"WHERE [{time_clm}] > CAST(? AS datetime2)"
                ss_cur.execute(f"SELECT {src_cols} FROM {SRC}.[{table}] {where}", (last_pk_val,))
            else:
                where = f"WHERE [{pk_clm}] > ?"
                ss_cur.execute(f"SELECT {src_cols} FROM {SRC}.[{table}] {where}", (last_pk_val,))
        else:
            # First run
            pg_cur.execute(f'TRUNCATE "{table}" CASCADE')
            ss_cur.execute(f"SELECT {src_cols} FROM {SRC}.[{table}]")

        # Create temp table
        pg_cur.execute(f'CREATE TEMP TABLE stage (LIKE "{table}") ON COMMIT DROP')

        # Copy data to PostgreSQL
        no_of_rows = copy_rows(ss_cur, pg_cur, "stage", columns)

        # Insert data from stage to original table
        pg_cur.execute(f'INSERT INTO "{table}" ({get_columns_psg_format(columns)}) SELECT {get_columns_psg_format(columns)} FROM stage')

        # Update sync progress
        if no_of_rows > 0:
            pg_cur.execute(f'SELECT MAX("{pk_clm.lower()}") FROM stage')
            new_last_pk = pg_cur.fetchone()[0]  # type: ignore
            save_progress(pg_cur, table,category, new_last_pk, no_of_rows)
        else:
            new_last_pk = last_pk_val
            save_progress(pg_cur, table,category, new_last_pk, no_of_rows, "No_New_Data")

        # Commit transaction
        pg.commit()

        return no_of_rows

    except Exception as e:
        pg.rollback()
        raise

    finally:
        ss.close()
        pg.close()



def export_table_from_sql_to_psg(workers=4):
    """Sync every table in item_master in parallel processes (own connections per table)."""
    with ProcessPoolExecutor(max_workers=workers) as pool:
                jobs = {pool.submit(sync_table, table, cols, category): (category, table)
                        for category, tables in TABLES_COLUMNS.items()
                        for table, cols in tables.items()}


                for job in as_completed(jobs):
                    category, table = jobs[job]
                    try:
                        print(f"[{category}] {table}: {job.result()} rows")
                    except Exception as e:
                        print(f"[{category}] {table}: FAILED -> {e}")



if __name__ == "__main__":
    export_table_from_sql_to_psg()