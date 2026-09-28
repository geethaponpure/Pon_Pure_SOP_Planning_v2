from fastapi import APIRouter, status, File, UploadFile, HTTPException, Form, Depends, BackgroundTasks
from fastapi.concurrency import run_in_threadpool
from app.services.ingest_service import fetch_rejects, fetch_file_status
from app.services.ingest_service import inject_excel_to_psg, get_template
from app.schemas.utils_schema import Upload_schema
from typing import Literal
from app.api.deps import get_db
from sqlalchemy.ext.asyncio import AsyncSession


user_router = APIRouter(prefix="/ingest")


#================================= Upload data from Excel to DB =============================================
@user_router.post("/upload",status_code=status.HTTP_202_ACCEPTED)      # accepted: it finishes in the background
async def extra_data_uplaod_api(background:BackgroundTasks,
                                file: UploadFile = File(...), 
                                uploaded_by: str = Form(...), 
                                file_type: Literal["bom_extract", "shelf_life", "cycle_time"] = Form(...),
                                db:AsyncSession=Depends(get_db)):
    return await inject_excel_to_psg(file,uploaded_by,file_type,db,background)
    

#================================= Get Template Download ========================================================
@user_router.get("/template/{file_type}", status_code=status.HTTP_200_OK)
async def get_template_api(file_type:Literal["bom_extract", "shelf_life", "cycle_time"]):
    return await get_template(file_type)



#================================= Poll an Upload's Status ========================================================
@user_router.get("/files/{file_id}", status_code=status.HTTP_200_OK)
async def get_file_status_api(file_id: int, db: AsyncSession = Depends(get_db)):
    return await fetch_file_status(file_id, db)



#================================= Get Problem in File Rows ========================================================
@user_router.get("/files/{file_id}/rejects", status_code=status.HTTP_200_OK)
async def get_rejects_api(file_id: int, db: AsyncSession = Depends(get_db)):
    return await fetch_rejects(file_id, db)


