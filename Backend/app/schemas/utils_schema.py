from pydantic import BaseModel
from typing import Literal
from fastapi import APIRouter, status, File, UploadFile, HTTPException, Form



class Upload_schema(BaseModel):
    upload_by: str = Form(...)
    file_type: Literal["bom_extract","shelf_life","cycle_time"] = Form(...)
    file: UploadFile = File(...)