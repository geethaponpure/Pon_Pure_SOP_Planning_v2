# this file is use for
# Run one registered upload end to end: read → validate → load → refresh models → published.
# all or nothing: a file with any bad row is rejected with its reasons and nothing is loaded.
#
#   received → validating → loading → modeling → published
#                  ↓            ↓          ↓
#              rejected       failed     failed        (step says where)
#
# async on a pooled AsyncSession. reading the excel and checking the rows is cpu work, so it runs in a
# worker thread (asyncio.to_thread) and the api keeps answering other requests meanwhile.
# the api calls register_file then run_ingest with its get_db session; the cli below does both:
#   python -m app.ingest.runner --type bom_extract --by <user> [--period ...] <path>
# cycle_time takes its plant from the Plant column; an upload replaces only that plant's sheet.

import argparse
import asyncio
import logging
import sys
import time
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncLocal, engine
from app.ingest.excel_reader import ReadError, read_file
from app.ingest.loader import (DuplicateFileError, UploadError, load_raw, register_file,
                               set_scope, set_status, switch_current, write_rejects)
from app.ingest.registry import FILE_SPECS, get_spec
from app.ingest.spec import FileSpec
from app.ingest.validate import summarize_rejects, validate
from app.repositories.views import VIEWS_DIR, materialized_view_names, split_statements, view_names


log = logging.getLogger(__name__)


def model_views(spec: FileSpec) -> set[str]:
    """Materialized views defined in the spec's model_sql files. Only these are refreshed after a
    load: plain views read raw_* live, and re-running a view file would DROP ... CASCADE views
    that later files define."""

    names = set()
    for file_name in spec.model_sql:
        sql = (VIEWS_DIR / file_name).read_text(encoding="utf-8")
        names |= {name for stmt in split_statements(sql) for name, is_mat in view_names(stmt) if is_mat}
    return names



async def refresh_views(session: AsyncSession, only: set[str]) -> None:
    """Async twin of repositories.views.refresh_materialized_views for the given views: in definition
    order, concurrently where the view has a unique index. No commit."""

    rows = (await session.execute(text("""
        SELECT m.matviewname,
               EXISTS (SELECT 1 FROM pg_index i
                       JOIN pg_class c ON c.oid = i.indrelid
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = m.schemaname AND c.relname = m.matviewname AND i.indisunique)
        FROM pg_matviews m WHERE m.schemaname = current_schema()"""))).all()
    existing = {name: unique for name, unique in rows}
    for name in materialized_view_names():
        if name in only and name in existing:
            await session.execute(text(f'REFRESH MATERIALIZED VIEW {"CONCURRENTLY " if existing[name] else ""}"{name}"'))



async def run_ingest(file_id: int, path, session: AsyncSession | None = None) -> dict:
    """Take a registered file (status received) through to published, rejected or failed.
    Never raises for a bad file; returns the final ingest_files row as a dict.
    Pass the caller's session (the api's get_db); without one a pooled session is opened here."""

    if session is None:
        async with AsyncLocal() as own:
            return await _run(own, file_id, path)
    return await _run(session, file_id, path)



async def _run(session: AsyncSession, file_id: int, path) -> dict:
    step = "validating"
    try:
        row = (await session.execute(text("SELECT file_type, status FROM ingest_files WHERE file_id = :id"),
                                     {"id": file_id})).first()
        if row is None:
            raise ValueError(f"file {file_id} is not registered")
        file_type, status = row
        if status != "received":
            raise ValueError(f"file {file_id} is already {status}, register the file again to rerun it")
        spec = get_spec(file_type)
        await session.commit()

        # ---- read + validate (cpu work, off the event loop)
        await set_status(session, file_id, "validating")
        t = time.time()
        try:
            df = await asyncio.to_thread(read_file, path, spec)
        except ReadError as e:
            await set_status(session, file_id, "failed", step, str(e))
            return await _final(session, file_id)

        result = await asyncio.to_thread(validate, df, spec)
        counts = {"rows_read": result.rows_read, "rows_deduped": result.duplicates_dropped}
        log.info("ingest %s %s: read %s rows in %.1fs", file_id, file_type, result.rows_read, time.time() - t)

        if result.structural_errors:
            await set_status(session, file_id, "failed", step, "\n".join(result.structural_errors), **counts)
            return await _final(session, file_id)

        if not result.ok:
            await write_rejects(session, file_id, result.rejects)
            await set_status(session, file_id, "rejected", step, summarize_rejects(result.rejects),
                             rows_rejected=result.rows_rejected, **counts)  # commits the rejects too
            return await _final(session, file_id)

        # one file = one plant (or whatever the spec scopes by)
        scope = None
        if spec.scope_column:
            values = sorted({str(v) for v in result.clean[spec.scope_column]})
            if len(values) != 1:
                await set_status(session, file_id, "failed", step,
                                 f"one {spec.scope_column} per file, this file has {len(values)}: {', '.join(values)}",
                                 **counts)
                return await _final(session, file_id)
            scope = values[0]

        # ---- load: rows + scope + current switch + status in one commit
        step = "loading"
        await set_status(session, file_id, "loading", None, None, rows_rejected=0, **counts)
        t = time.time()
        loaded = await load_raw(session, spec, file_id, result.clean)
        if scope is not None:
            await set_scope(session, file_id, scope)
        previous = await switch_current(session, spec, file_id)
        await set_status(session, file_id, "modeling", rows_loaded=loaded)  # commits the load
        log.info("ingest %s %s: loaded %s rows into %s in %.1fs%s", file_id, file_type, loaded, spec.raw_table,
                 time.time() - t, f", replaces file {previous}" if previous else "")

        # ---- model: the data is in and current; a failure here leaves it loaded, marked failed/modeling
        step = "modeling"
        views = model_views(spec)
        if views:
            await refresh_views(session, views)
            await session.commit()

        await set_status(session, file_id, "published")
        return await _final(session, file_id)

    except Exception as e:
        log.exception("ingest %s failed at %s", file_id, step)
        await session.rollback()                  # drops a half-done load; the previous file stays current
        try:
            await set_status(session, file_id, "failed", step, f"{type(e).__name__}: {e}"[:4000])
        except Exception:
            pass                                  # the file row itself may not exist
        raise



async def _final(session: AsyncSession, file_id: int) -> dict:
    final = dict((await session.execute(text("""
        SELECT file_id, file_type, original_name, status, step, period_key, rows_read, rows_deduped,
               rows_loaded, rows_rejected, error, is_current
        FROM ingest_files WHERE file_id = :id"""), {"id": file_id})).mappings().one())
    await session.commit()                        # ends the read, the pooled connection goes back clean
    if final["status"] == "published":
        log.info("ingest %s %s: published, %s rows", file_id, final["file_type"], final["rows_loaded"])
    else:
        first = (final["error"] or "").splitlines()[:1]
        log.warning("ingest %s %s: %s at %s - %s", file_id, final["file_type"], final["status"], final["step"],
                    first[0] if first else "")
    return final



# ---------------------------------------------------------------- cli

async def _cli(args, spec: FileSpec, params: dict) -> int:
    try:
        async with AsyncLocal() as session:
            try:
                file_id = await register_file(session, spec, args.path, args.by, period_key=args.period,
                                              upload_params=params)
            except (DuplicateFileError, UploadError) as e:
                print(e)
                return 2

            print(f"registered file {file_id} ({args.type}, {args.path.name})")
            final = await run_ingest(file_id, args.path, session)
    finally:
        await engine.dispose()                    # close the pool before the event loop ends

    print()
    for key in ("status", "step", "rows_read", "rows_deduped", "rows_loaded", "rows_rejected", "is_current"):
        if final[key] is not None:
            print(f"  {key:<14}{final[key]}")
    if final["error"]:
        print("\n" + final["error"])
    if final["status"] == "rejected":
        print(f"\nevery problem (first 1,000): SELECT * FROM ingest_rejects WHERE file_id = {file_id} ORDER BY row_no;")
    return 0 if final["status"] == "published" else 1


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")   # the cli shows the progress lines
    upload_params = sorted({p for spec in FILE_SPECS.values() for p in spec.upload_params})

    parser = argparse.ArgumentParser(prog="python -m app.ingest.runner",
                                     description="Load one Excel file into its raw_* table.")
    parser.add_argument("--type", required=True, choices=sorted(FILE_SPECS), help="file type (spec key)")
    parser.add_argument("--by", required=True, help="who is uploading, stored as uploaded_by")
    parser.add_argument("--period", help="period_key, required for append-mode types (e.g. 2026-2027/JC1)")
    for p in upload_params:
        parser.add_argument(f"--{p}", help=f"upload parameter {p}")
    parser.add_argument("path", type=Path, help="the .xlsx file")
    args = parser.parse_args(argv)

    if not args.path.is_file():
        print(f"no such file: {args.path}")
        return 2

    spec = get_spec(args.type)
    params = {p: getattr(args, p) for p in upload_params if getattr(args, p) is not None}
    return asyncio.run(_cli(args, spec, params))


if __name__ == "__main__":
    sys.exit(main())
