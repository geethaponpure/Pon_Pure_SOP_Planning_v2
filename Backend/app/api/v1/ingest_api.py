from fastapi import APIRouter, status, File, UploadFile, HTTPException, Form
from fastapi.concurrency import run_in_threadpool
from app.services.ingest_service import fetch_rejects
from app.services.ingest_service import inject_excel_to_psg, get_template
from app.schemas.utils_schema import Upload_schema
from typing import Literal


user_router = APIRouter(prefix="/ingest")


#================================= Upload data from Excel to DB =============================================
@user_router.post("/upload",status_code=status.HTTP_201_CREATED)
async def extra_data_uplaod_api(file: UploadFile = File(...), 
                                uploaded_by: str = Form(...), 
                                file_type: Literal["bom_extract", "shelf_life", "cycle_time"] = Form(...)):
    return await inject_excel_to_psg(file,uploaded_by,file_type)
    

#================================= Get Template Download ========================================================
@user_router.get("/template/{file_type}", status_code=status.HTTP_200_OK)
async def get_template_api(file_type:Literal["bom_extract", "shelf_life", "cycle_time"]):
    return await get_template(file_type)



#================================= Get Problem in File Rows ========================================================
@user_router.get("/files/{file_id}/rejects", status_code=status.HTTP_200_OK)
async def get_rejects_api(file_id: int):
    return await run_in_threadpool(fetch_rejects, file_id)


