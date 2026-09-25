from fastapi import HTTPException, status, UploadFile
from pathlib import Path



UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


async def inject_excel_to_psg(file:UploadFile):

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")

    file_name = file.filename
    ALLOWED_EXTENSIONS = {"xlsx", "xls"}
    
    is_excel =  True if str(file_name).split(".")[1] in ALLOWED_EXTENSIONS else False
    
    if not is_excel:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please Upload a Valid excel file")
    
    file_path = UPLOAD_DIR / file_name

    content = await file.read() 

    with  open(file_path,"wb") as f:
        f.write(content)
    
    return is_excel