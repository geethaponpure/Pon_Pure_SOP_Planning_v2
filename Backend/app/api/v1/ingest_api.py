from fastapi import APIRouter, status, File, UploadFile, HTTPException, Form
from app.services.ingest_service import inject_excel_to_psg
from app.schemas.utils_schema import Upload_schema
from typing import Literal


user_router = APIRouter(prefix="/user")



@user_router.post("/upload",status_code=status.HTTP_201_CREATED)
async def extra_data_uplaod_api(file: UploadFile = File(...), 
                                uploaded_by: str = Form(...), 
                                file_type: Literal["bom_extract", "shelf_life", "cycle_time"] = Form(...)):
    return await inject_excel_to_psg(file,uploaded_by,file_type)
    
    