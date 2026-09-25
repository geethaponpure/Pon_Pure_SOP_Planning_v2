from pydantic import BaseModel
from typing import Literal



class Upload_schema(BaseModel):
    User_name: str
    file_type: Literal["bom_extract","shelf_life","cycle_time"]