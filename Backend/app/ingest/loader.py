# this file is use for
# Register an upload → keep its status → COPY rows into raw_* → make it current,
# or, for a file with any bad row, write the reasons to ingest_rejects and load nothing.
# sync psycopg2 on a connection from get_postgres_cursor() (search_path already set).
#
# transactions: register_file and set_status commit on their own, so the upload page sees progress.
# load_raw, write_rejects and switch_current do NOT commit: the runner calls load_raw and
# switch_current together and commits once, so a half-loaded file is never visible or current.

import csv
import hashlib
import io
from datetime import date, datetime, time
from pathlib import Path

import pandas as pd
from psycopg2.errors import UniqueViolation
from psycopg2.extras import Json, execute_values

from app.ingest.spec import FileSpec


CHUNK = 50_000                                    # rows per COPY batch (bounds memory)
MAX_REJECTS = 1_000                               # problems stored per rejected file
STATUSES = ("received", "validating", "loading", "modeling", "published", "rejected", "failed")
COUNTS = ("rows_read", "rows_deduped", "rows_loaded", "rows_rejected")


class DuplicateFileError(Exception):
    """The same file (same sha256) was already uploaded for this type."""

    def __init__(self, file_type: str, file_id: int):
        super().__init__(f"this {file_type} file was already uploaded as file {file_id}")
        self.file_id = file_id


class UploadError(ValueError):
    """Missing or unexpected upload parameters (period_key, plant ...)."""



def file_sha256(path) -> tuple[str, int]:
    h, size = hashlib.sha256(), 0
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size



def register_file(conn, spec: FileSpec, path, uploaded_by: str, original_name: str | None = None,
                  period_key: str | None = None, upload_params: dict | None = None) -> int:
    """Check the upload parameters and the sha256, insert the ingest_files row (status received)
    and return its file_id. Commits."""

    params = {k: v for k, v in (upload_params or {}).items() if v not in (None, "")}
    missing = [p for p in spec.upload_params if p not in params]
    unknown = [p for p in params if p not in spec.upload_params]
    if missing:
        raise UploadError(f"{spec.key} needs {', '.join(missing)}")
    if unknown:
        raise UploadError(f"{spec.key} does not take {', '.join(unknown)}")

    period_key = (period_key or "").strip() or None
    if spec.mode == "append" and not period_key:
        raise UploadError(f"{spec.key} is loaded per period, period_key is required")
    if spec.mode == "replace" and period_key:
        raise UploadError(f"{spec.key} replaces the whole file, it takes no period_key")

    sha, size = file_sha256(path)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT file_id FROM ingest_files
            WHERE file_type = %s AND sha256 = %s AND status NOT IN ('failed', 'rejected')
            ORDER BY file_id LIMIT 1""", (spec.key, sha))
        row = cur.fetchone()
        if row:
            raise DuplicateFileError(spec.key, row[0])

        try:
            cur.execute("""
                INSERT INTO ingest_files (file_type, original_name, sha256, size_bytes, uploaded_by,
                                          period_key, upload_params, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'received')
                RETURNING file_id""",
                (spec.key, original_name or Path(path).name, sha, size, uploaded_by, period_key, Json(params)))
        except UniqueViolation:                   # the same file registered a moment ago by another upload
            conn.rollback()
            cur.execute("SELECT file_id FROM ingest_files WHERE file_type = %s AND sha256 = %s "
                        "AND status NOT IN ('failed', 'rejected')", (spec.key, sha))
            raise DuplicateFileError(spec.key, cur.fetchone()[0]) from None
        file_id = cur.fetchone()[0]
    conn.commit()
    return file_id



def set_status(conn, file_id: int, status: str, step: str | None = None, error: str | None = None,
               **counts) -> None:
    """Move the file to a status, optionally with the step it stopped at, an error and row counts.
    Commits (so it also commits anything pending on this connection - call it between units)."""

    if status not in STATUSES:
        raise ValueError(f"unknown status {status!r}")
    bad = [k for k in counts if k not in COUNTS]
    if bad:
        raise ValueError(f"unknown counts {bad}")

    sets = ["status = %s", "step = %s", "error = %s"] + [f"{k} = %s" for k in counts]
    with conn.cursor() as cur:
        cur.execute(f"UPDATE ingest_files SET {', '.join(sets)} WHERE file_id = %s",
                    (status, step, error, *counts.values(), file_id))
    conn.commit()



def _copy_value(v):
    """Python value -> csv field. None stays None (written unquoted = NULL)."""

    if v is None:
        return None
    if isinstance(v, str):
        return v.replace("\x00", "")               # postgres text cannot hold NUL
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    return v



def load_raw(cur, spec: FileSpec, file_id: int, clean: pd.DataFrame) -> int:
    """COPY the validated rows into the spec's raw table with file_id and row_no. No commit."""

    targets = [c.target for c in spec.columns]
    columns = ", ".join(f'"{c}"' for c in ["file_id", "row_no", *targets])
    # every non-null field is quoted, a null is an empty unquoted field: the csv default NULL,
    # so '' and NULL can never be mixed up (validate already turns blank text into null)
    sql = f'COPY "{spec.raw_table}" ({columns}) FROM STDIN WITH (FORMAT csv)'

    rows = zip(clean.index.tolist(), *(clean[t].tolist() for t in targets))
    total = 0
    while True:
        chunk = [row for _, row in zip(range(CHUNK), rows)]
        if not chunk:
            break
        buffer = io.StringIO()
        writer = csv.writer(buffer, quoting=csv.QUOTE_NOTNULL)
        writer.writerows([file_id, row_no, *(_copy_value(v) for v in values)] for row_no, *values in chunk)
        buffer.seek(0)
        cur.copy_expert(sql, buffer)
        total += len(chunk)
    return total



def write_rejects(cur, file_id: int, rejects: list[dict]) -> int:
    """Store why a file was rejected: the first MAX_REJECTS problems in row order. A wrong file
    (say, the wrong sheet) can have a bad cell on every row; the summary on ingest_files.error
    still counts all of them. No commit."""

    kept = sorted(rejects, key=lambda r: r["row_no"])[:MAX_REJECTS]
    if not kept:
        return 0
    execute_values(cur, """
        INSERT INTO ingest_rejects (file_id, row_no, column_name, reason, value, row_data) VALUES %s""",
        [(file_id, r["row_no"], r["column"], r["reason"],
          None if r["value"] is None else str(r["value"]), Json(r["row"])) for r in kept],
        page_size=5000)
    return len(kept)



def switch_current(cur, spec: FileSpec, file_id: int) -> int | None:
    """Make file_id the current file of its type (replace) or of its type + period (append).
    The one it replaces gets is_current = false and superseded_by = file_id. Returns that
    earlier file_id, or None. No commit."""

    # two uploads of the same type finishing together would both see the old current file
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"ingest:{spec.key}",))

    same_scope = "AND period_key IS NOT DISTINCT FROM (SELECT period_key FROM ingest_files WHERE file_id = %(new)s)" \
        if spec.mode == "append" else ""
    cur.execute(f"""
        UPDATE ingest_files SET is_current = false, superseded_by = %(new)s
        WHERE file_type = %(type)s AND is_current AND file_id <> %(new)s {same_scope}
        RETURNING file_id""", {"new": file_id, "type": spec.key})
    old = cur.fetchone()

    cur.execute("UPDATE ingest_files SET is_current = true WHERE file_id = %s", (file_id,))
    return old[0] if old else None
