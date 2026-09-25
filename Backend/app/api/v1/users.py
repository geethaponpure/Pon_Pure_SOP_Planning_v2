from fastapi import APIRouter, status, File, UploadFile




user_router = APIRouter(prefix="/user")



@user_router.post("/upload")
async def extra_data_uplaod(file:UploadFile):
    return file.filename