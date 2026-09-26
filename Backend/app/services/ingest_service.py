from pathlib import Path
from uuid import uuid4
from fastapi import HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import text
from app.ingest.excel_reader import is_xlsx
from app.ingest.loader import DuplicateFileError, UploadError, register_file
from app.ingest.registry import get_spec
from app.ingest.runner import run_ingest
from sqlalchemy.ext.asyncio import AsyncSession


UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"      # Backend/uploads, whatever the working dir
UPLOAD_DIR.mkdir(exist_ok=True)
TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "template"


async def ingest_excel(path: str, file_type: str, uploaded_by: str, db: AsyncSession,
                       original_name: str | None = None) -> dict:
    """Register the saved file and run the pipeline on the request's pooled session."""
    spec = get_spec(file_type)
    try:
        file_id = await register_file(db, spec, path, uploaded_by, original_name=original_name)
    except DuplicateFileError as e:
        Path(path).unlink(missing_ok=True)          # refused: no ingest_files row points at the saved copy
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"message": str(e), "file_id": e.file_id})
    except UploadError as e:
        Path(path).unlink(missing_ok=True)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception:
        Path(path).unlink(missing_ok=True)          # e.g. the database is down: nothing registered either
        raise
    return await run_ingest(file_id, path, db)      # from here the file is kept: it is the record of the upload


async def inject_excel_to_psg(file: UploadFile, uploaded_by: str, file_type: str, db:AsyncSession) -> dict:
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

    result = await ingest_excel(str(path), file_type, uploaded_by, db, original_name)

    if result["status"] == "rejected":
        rejects = await fetch_rejects(result["file_id"], db)
        result["problems"] = rejects["problems"]
        result["problems_shown"] = rejects["problems_shown"]
    
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
