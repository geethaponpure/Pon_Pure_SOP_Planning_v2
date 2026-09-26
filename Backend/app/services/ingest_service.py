from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from app.core.database import get_postgres_cursor
from app.ingest.excel_reader import is_xlsx
from app.ingest.loader import DuplicateFileError, UploadError, register_file
from app.ingest.registry import get_spec
from app.ingest.runner import run_ingest

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"      # Backend/uploads, whatever the working dir
UPLOAD_DIR.mkdir(exist_ok=True)


def ingest_excel(path: str, file_type: str, uploaded_by: str, original_name: str | None = None) -> dict:
    """Register the saved file and run the pipeline. Sync: call it through run_in_threadpool."""
    spec = get_spec(file_type)
    conn, _ = get_postgres_cursor()
    try:
        file_id = register_file(conn, spec, path, uploaded_by, original_name=original_name)
    except DuplicateFileError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"message": str(e), "file_id": e.file_id})
    except UploadError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    finally:
        conn.close()
    return run_ingest(file_id, path)


async def inject_excel_to_psg(file: UploadFile, uploaded_by: str, file_type: str) -> dict:
    if not file.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="No file selected")

    original_name = Path(file.filename).name                       # drops any folder part
    path = UPLOAD_DIR / f"{uuid4().hex}_{original_name}"            # unique, stays inside uploads/
    path.write_bytes(await file.read())

    if not is_xlsx(path):                                           # by content, not by extension
        path.unlink()
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            detail="Not an Excel file.")

    return await run_in_threadpool(ingest_excel, str(path), file_type, uploaded_by, original_name)
