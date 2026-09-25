"""Views on top of the mirrored crm tables.

The views live as plain sql in app/views/*.sql, one file per cluster, numbered so they run in
dependency order. Every file is written as DROP ... CASCADE + CREATE, so a changed column list never
breaks a rebuild. Materialized views hold data and are refreshed by the etl at the end of a run
(refresh_materialized_views), concurrently where the view has a unique index so readers never wait.

The api does not rebuild everything on every start - that costs minutes. It keeps a hash of each file in
the small table view_files and at start runs only from the first file that changed (or whose views are
missing) onward; later files are rerun because a DROP ... CASCADE in an earlier file may have taken their
views with it. An unchanged set of files runs nothing and the materialized views keep their last data.
"""

import hashlib
import re
from pathlib import Path
from sqlalchemy import text

VIEWS_DIR = Path(__file__).resolve().parent.parent / "views"

VIEW_NAME_RE = re.compile(r'CREATE\s+(MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)', re.I)


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


def view_files():
    """The sql files in run order."""

    return sorted(VIEWS_DIR.glob("*.sql"))


def load_statements():
    """(file name, statement) for every statement in every app/views/*.sql, in file name order."""

    for path in view_files():
        for stmt in split_statements(path.read_text(encoding="utf-8")):
            yield path.name, stmt


def view_names(sql: str):
    """(name, is_materialized) for every view a file creates."""

    return [(m.group(2), bool(m.group(1))) for m in VIEW_NAME_RE.finditer(sql)]


async def create_views(conn):
    """Bring the views in step with the sql files on an open async connection (search_path already set).
    Runs from the first changed or incomplete file onward; nothing when nothing changed."""

    await conn.execute(text(
        "CREATE TABLE IF NOT EXISTS view_files (file_name text PRIMARY KEY, sha256 text NOT NULL, "
        "applied_at timestamptz NOT NULL DEFAULT now())"))
    stored = {r[0]: r[1] for r in (await conn.execute(text("SELECT file_name, sha256 FROM view_files"))).fetchall()}
    existing = {r[0] for r in (await conn.execute(text(
        "SELECT viewname FROM pg_views WHERE schemaname = current_schema() "
        "UNION SELECT matviewname FROM pg_matviews WHERE schemaname = current_schema()"))).fetchall()}

    files = [(path, path.read_text(encoding="utf-8")) for path in view_files()]
    start = None
    for i, (path, sql) in enumerate(files):
        sha = hashlib.sha256(sql.encode("utf-8")).hexdigest()
        missing = [name for stmt in split_statements(sql) for name, _ in view_names(stmt) if name not in existing]
        if stored.get(path.name) != sha or missing:
            start = i
            why = "changed" if stored.get(path.name) != sha else f"missing {', '.join(missing)}"
            print(f"views: {path.name} {why} - rebuilding from here")
            break
    if start is None:
        print(f"views: {len(files)} files unchanged, nothing to run")
        return

    count = 0
    for path, sql in files[start:]:
        for stmt in split_statements(sql):
            try:
                await conn.execute(text(stmt))
            except Exception as e:
                raise RuntimeError(f"{path.name}: {stmt[:80]!r} failed: {e}") from e
            count += 1
        await conn.execute(text(
            "INSERT INTO view_files (file_name, sha256, applied_at) VALUES (:f, :h, now()) "
            "ON CONFLICT (file_name) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = now()"),
            {"f": path.name, "h": hashlib.sha256(sql.encode("utf-8")).hexdigest()})
    print(f"views: {count} statements run from {VIEWS_DIR.name}/ ({len(files) - start} of {len(files)} files)")


def materialized_view_names():
    """The materialized views in the order the sql files define them - which is their dependency order,
    since a view can only be built from views defined before it."""

    return [name for _, stmt in load_statements()
            for name, is_mat in view_names(stmt) if is_mat]


def refresh_materialized_views(pg_cur, only=None):
    """Refresh every materialized view, in definition order so a view never reads a stale one it depends on.
    Concurrently where the view has a unique index (readers keep reading the old data meanwhile); a plain,
    blocking refresh otherwise. Called by the etl after a run. Sync (psycopg2).
    only: a set of view names to limit the refresh to (the excel ingest refreshes just its own views)."""

    pg_cur.execute("""
        SELECT m.matviewname,
               EXISTS (SELECT 1 FROM pg_index i
                       JOIN pg_class c ON c.oid = i.indrelid
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = m.schemaname AND c.relname = m.matviewname AND i.indisunique)
        FROM pg_matviews m WHERE m.schemaname = current_schema()""")
    existing = {r[0]: r[1] for r in pg_cur.fetchall()}
    for name in materialized_view_names():
        if name in existing and (only is None or name in only):
            concurrently = "CONCURRENTLY " if existing[name] else ""
            pg_cur.execute(f'REFRESH MATERIALIZED VIEW {concurrently}"{name}"')
            print(f"refreshed {name}{' (concurrently)' if concurrently else ''}")
