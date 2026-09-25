from fastapi import APIRouter, status, File, UploadFile, HTTPException
from app.services.ingest_service import inject_excel_to_psg


user_router = APIRouter(prefix="/user")



@user_router.post("/upload",status_code=status.HTTP_201_CREATED)
async def extra_data_uplaod_api(file:UploadFile):
    return await inject_excel_to_psg(file)
    
    