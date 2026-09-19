"""Views on top of the mirrored crm tables.

The views live as plain sql in app/views/*.sql, one file per cluster, numbered so they run in
dependency order. The api runs every file at start, right after create_all, so the views are always
in step with the code (same rule as the tables: code owns the schema).

Plain views are written as DROP ... CASCADE + CREATE, so a changed column list never breaks a restart.
Materialized views (later, for the heavy stuff) hold data: they are created IF NOT EXISTS and refreshed
by the etl at the end of a run through refresh_materialized_views().
"""

from pathlib import Path
from sqlalchemy import text

VIEWS_DIR = Path(__file__).resolve().parent.parent / "views"


def split_statements(sql: str):
    """Split a sql file into statements on ';', ignoring ';' and '--' inside quoted strings
    and dropping '--' comments. A view file must not use $$ bodies or block comments."""

    statements, current, in_string, i = [], [], False, 0
    while i < len(sql):
        ch = sql[i]
        if in_string:
            current.append(ch)
            if ch == "'":
                in_string = False
        elif ch == "'":
            in_string = True
            current.append(ch)
        elif sql.startswith("--", i):
            end = sql.find("\n", i)
            i = len(sql) if end == -1 else end
            continue
        elif ch == ";":
            stmt = "".join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
        else:
            current.append(ch)
        i += 1

    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def load_statements():
    """(file name, statement) for every statement in every app/views/*.sql, in file name order."""

    for path in sorted(VIEWS_DIR.glob("*.sql")):
        for stmt in split_statements(path.read_text(encoding="utf-8")):
            yield path.name, stmt


async def create_views(conn):
    """Run every view file on an open async connection (search_path already set)."""

    count = 0
    for file_name, stmt in load_statements():
        try:
            await conn.execute(text(stmt))
        except Exception as e:
            raise RuntimeError(f"{file_name}: {stmt[:80]!r} failed: {e}") from e
        count += 1
    print(f"views: {count} statements run from {VIEWS_DIR.name}/")


def refresh_materialized_views(pg_cur):
    """Refresh every materialized view in the schema. Called by the etl after a run. Sync (psycopg2)."""

    pg_cur.execute("SELECT matviewname FROM pg_matviews WHERE schemaname = current_schema() ORDER BY 1")
    for (name,) in pg_cur.fetchall():
        pg_cur.execute(f'REFRESH MATERIALIZED VIEW "{name}"')
        print(f"refreshed {name}")
