# this file is use for
# Register an upload → keep its status → COPY rows into raw_* → make it current,
# or, for a file with any bad row, write the reasons to ingest_rejects and load nothing.
# async, on a pooled AsyncSession (app.core.database.AsyncLocal / get_db): no connect cost per call.
#
# transactions: register_file and set_status commit on their own, so the upload page sees progress.
# load_raw, write_rejects and switch_current do NOT commit: the runner calls load_raw and
# switch_current together and commits once, so a half-loaded file is never visible or current.

import hashlib
import json
from pathlib import Path

import pandas as pd
from asyncpg.exceptions import UniqueViolationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.ingest.spec import FileSpec


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



async def _earlier_upload(session: AsyncSession, file_type: str, sha: str) -> int | None:
    row = (await session.execute(text("""
        SELECT file_id FROM ingest_files
        WHERE file_type = :type AND sha256 = :sha AND status NOT IN ('failed', 'rejected')
        ORDER BY file_id LIMIT 1"""), {"type": file_type, "sha": sha})).first()
    return row[0] if row else None



async def register_file(session: AsyncSession, spec: FileSpec, path, uploaded_by: str,
                        original_name: str | None = None, period_key: str | None = None,
                        upload_params: dict | None = None) -> int:
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
    if spec.scope_column and period_key:
        raise UploadError(f"{spec.key} takes its {spec.scope_column} from the file, not from period_key")
    if spec.mode == "append" and not period_key and not spec.scope_column:
        raise UploadError(f"{spec.key} is loaded per period, period_key is required")
    if spec.mode == "replace" and period_key:
        raise UploadError(f"{spec.key} replaces the whole file, it takes no period_key")

    sha, size = file_sha256(path)                 # a few ms even for the largest file
    earlier = await _earlier_upload(session, spec.key, sha)
    if earlier is not None:
        await session.rollback()
        raise DuplicateFileError(spec.key, earlier)

    try:
        file_id = (await session.execute(text("""
            INSERT INTO ingest_files (file_type, original_name, sha256, size_bytes, uploaded_by,
                                      period_key, upload_params, status)
            VALUES (:type, :name, :sha, :size, :by, :period, CAST(:params AS jsonb), 'received')
            RETURNING file_id"""),
            {"type": spec.key, "name": original_name or Path(path).name, "sha": sha, "size": size,
             "by": uploaded_by, "period": period_key, "params": json.dumps(params)})).scalar_one()
        await session.commit()
    except IntegrityError as e:                   # the same file registered a moment ago by another upload
        await session.rollback()
        if not isinstance(getattr(e.orig, "__cause__", None), UniqueViolationError):
            raise
        raise DuplicateFileError(spec.key, await _earlier_upload(session, spec.key, sha) or 0) from None
    return file_id



async def set_status(session: AsyncSession, file_id: int, status: str, step: str | None = None,
                     error: str | None = None, **counts) -> None:
    """Move the file to a status, optionally with the step it stopped at, an error and row counts.
    Commits (so it also commits anything pending on this session - call it between units)."""

    if status not in STATUSES:
        raise ValueError(f"unknown status {status!r}")
    bad = [k for k in counts if k not in COUNTS]
    if bad:
        raise ValueError(f"unknown counts {bad}")

    sets = ["status = :status", "step = :step", "error = :error"] + [f"{k} = :{k}" for k in counts]
    await session.execute(text(f"UPDATE ingest_files SET {', '.join(sets)} WHERE file_id = :file_id"),
                          {"status": status, "step": step, "error": error, "file_id": file_id, **counts})
    await session.commit()



def _copy_value(v):
    """Python value -> COPY value. Text loses NUL characters, which postgres text cannot hold."""
    return v.replace("\x00", "") if isinstance(v, str) else v



async def load_raw(session: AsyncSession, spec: FileSpec, file_id: int, clean: pd.DataFrame) -> int:
    """COPY the validated rows into the spec's raw table with file_id and row_no. No commit.
    Uses asyncpg's binary COPY on the session's own connection, so it is part of the session's
    transaction and a rollback removes it. Values are already the column's python type (validate)."""

    targets = [c.target for c in spec.columns]
    records = [(file_id, row_no, *(_copy_value(v) for v in values))
               for row_no, *values in zip(clean.index.tolist(), *(clean[t].tolist() for t in targets))]

    # the session opens its transaction on the first statement: run one, so the COPY joins it
    await session.execute(text("SELECT 1"))
    conn = await session.connection()
    raw = await conn.get_raw_connection()
    await raw.driver_connection.copy_records_to_table(                      # type: ignore[union-attr]
        spec.raw_table, records=records, columns=["file_id", "row_no", *targets],
        schema_name=settings.POSTGRES_SCHEMA)
    return len(records)



async def write_rejects(session: AsyncSession, file_id: int, rejects: list[dict]) -> int:
    """Store why a file was rejected: the first MAX_REJECTS problems in row order. A wrong file
    (say, the wrong sheet) can have a bad cell on every row; the summary on ingest_files.error
    still counts all of them. No commit."""

    kept = sorted(rejects, key=lambda r: r["row_no"])[:MAX_REJECTS]
    if not kept:
        return 0
    await session.execute(text("""
        INSERT INTO ingest_rejects (file_id, row_no, column_name, reason, value, row_data)
        VALUES (:file_id, :row_no, :column, :reason, :value, CAST(:row AS jsonb))"""),
        [{"file_id": file_id, "row_no": r["row_no"], "column": r["column"], "reason": r["reason"],
          "value": None if r["value"] is None else str(r["value"]), "row": json.dumps(r["row"])}
         for r in kept])
    return len(kept)



async def set_scope(session: AsyncSession, file_id: int, value: str) -> None:
    """Record the file's scope (e.g. its plant, read from the rows) as its period_key, so
    switch_current replaces only the earlier file of the same scope. No commit."""

    await session.execute(text("UPDATE ingest_files SET period_key = :value WHERE file_id = :file_id"),
                          {"value": value, "file_id": file_id})



async def switch_current(session: AsyncSession, spec: FileSpec, file_id: int) -> int | None:
    """Make file_id the current file of its type (replace) or of its type + period (append).
    The one it replaces gets is_current = false and superseded_by = file_id. Returns that
    earlier file_id, or None. No commit."""

    # two uploads of the same type finishing together would both see the old current file
    await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": f"ingest:{spec.key}"})

    same_scope = ("AND period_key IS NOT DISTINCT FROM (SELECT period_key FROM ingest_files WHERE file_id = :new)"
                  if spec.mode == "append" else "")
    old = (await session.execute(text(f"""
        UPDATE ingest_files SET is_current = false, superseded_by = :new
        WHERE file_type = :type AND is_current AND file_id <> :new {same_scope}
        RETURNING file_id"""), {"new": file_id, "type": spec.key})).first()

    await session.execute(text("UPDATE ingest_files SET is_current = true WHERE file_id = :new"), {"new": file_id})
    return old[0] if old else None
