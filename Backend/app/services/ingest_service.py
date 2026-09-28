import logging
from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException, UploadFile, status, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy import text
from app.ingest.excel_reader import is_xlsx
from app.ingest.loader import DuplicateFileError, UploadError, register_file
from app.ingest.registry import get_spec
from app.ingest.runner import run_ingest
from sqlalchemy.ext.asyncio import AsyncSession


log = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"      # Backend/uploads, whatever the working dir
UPLOAD_DIR.mkdir(exist_ok=True)
TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "template"


async def ingest_excel(path: str, file_type: str, uploaded_by: str, db: AsyncSession, original_name: str | None = None) -> int:
    """Register the saved file."""

    spec = get_spec(file_type)

    try:
        file_id = await register_file(db, spec, path, uploaded_by, original_name=original_name)
    except DuplicateFileError as e:
        Path(path).unlink(missing_ok=True)
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"message": str(e), "file_id": e.file_id})
    except UploadError as e:
        Path(path).unlink(missing_ok=True)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception:
        Path(path).unlink(missing_ok=True)
        raise

    return file_id


async def inject_excel_to_psg(file: UploadFile, uploaded_by: str, file_type: str, db:AsyncSession, background:BackgroundTasks) -> dict:
    """run the pipeline and store the file in backend"""

    uploaded_by = (uploaded_by or "").strip().lower()              # "   " is not a name

    if not uploaded_by:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="uploaded_by is required.")

    if not file.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No file selected.")

    original_name = Path(file.filename).name                       # drops any folder part
    path = UPLOAD_DIR / f"{uuid4().hex}_{original_name}"            # unique, stays inside uploads/
    path.write_bytes(await file.read())

    if not is_xlsx(path):                                           # by content, not by extension
        path.unlink()
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail="Not an .xlsx file. Open it in Excel, Save As Excel Workbook (.xlsx), "
                                   "and upload that.")

    file_id = await ingest_excel(str(path), file_type, uploaded_by, db, original_name)

    background.add_task(run_in_background, file_id, str(path))

    return {"file_id": file_id, "status": "received", "poll": f"/ingest/files/{file_id}"}



async def run_in_background(file_id: int, path: str):
    """The pipeline after the response is sent. run_ingest is async: await it (run_in_threadpool would only
    create the coroutine and never run it). No session is passed, so it opens its own pooled one - the
    request's get_db session is already closed by now."""
    try:
        await run_ingest(file_id, path)
    except Exception:
        log.exception("background ingest %s crashed", file_id)   # run_ingest has already marked it failed



async def fetch_file_status(file_id: int, db: AsyncSession) -> dict:
    """Where an upload is now. The ui polls this until done is true."""
    
    FINAL = ("published", "rejected", "failed")
    
    row = (await db.execute(text("""
        SELECT file_id, file_type, original_name, uploaded_by, uploaded_at, period_key,
               status, step, rows_read, rows_deduped, rows_loaded, rows_rejected, error, is_current
        FROM ingest_files WHERE file_id = :id"""), {"id": file_id})).mappings().first()
    await db.commit()                                # ends the read, the pooled connection goes back clean
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"file {file_id} not found")

    result = dict(row)
    result["done"] = result["status"] in FINAL
    if result["status"] == "rejected":
        result["rejects"] = f"/ingest/files/{file_id}/rejects"      # the ui fetches the row list from here
    return result


async def get_template(file_type:str)->FileResponse:
    """Give user file in frontend"""

    templates = {
        "bom_extract": "bom_extract_template.xlsx",
        "shelf_life": "shelf_life_template.xlsx",
        "cycle_time": "cycle_time_template.xlsx",
    }

    if file_type not in templates:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="file_type not found")

    file_path = TEMPLATE_DIR / templates[file_type]


    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,detail=f"{file_type} Template not found")

    return FileResponse(
        path=file_path,
        filename=templates[file_type],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )





async def fetch_rejects(file_id: int, db: AsyncSession) -> dict:
    """The problems that stopped a file from loading, with Excel column names and row numbers."""
    f = (await db.execute(text("""SELECT file_id, file_type, original_name, status, error, rows_rejected
                                  FROM ingest_files WHERE file_id = :id"""), {"id": file_id})).first()
    if f is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"file {file_id} not found")
    file_id, file_type, name, file_status, summary, rows_rejected = f

    rows = (await db.execute(text("""SELECT row_no, column_name, reason, value FROM ingest_rejects
                                     WHERE file_id = :id ORDER BY row_no, reject_id"""), {"id": file_id})).all()
    await db.commit()                                # ends the read, the pooled connection goes back clean

    # database column names -> the headers the user sees in excel
    headers = {c.target: c.source for c in get_spec(file_type).columns}
    def excel_name(column: str) -> str:            # a duplicate names several columns: "plant,product_name,..."
        return ", ".join(headers.get(c, c) for c in column.split(","))

    return {
        "file_id": file_id,
        "file_type": file_type,
        "file_name": name,
        "status": file_status,
        "summary": summary,
        "rows_with_problems": rows_rejected or 0,
        "problems_shown": len(rows),
        "problems": [{"row": r, "column": excel_name(c), "reason": why, "value": v} for r, c, why, v in rows],
    }
