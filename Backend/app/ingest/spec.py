from dataclasses import dataclass
from typing import Literal

# Allowed column data types
DType = Literal["str", "int", "float", "date", "datetime", "bool"]

# Supported file readers
Reader = Literal["xlsx", "html", "auto"]         

# Upload behaviour
Mode = Literal["replace", "append"]


@dataclass(frozen=True)
class Col:

    source: str                             # File column name                     
    target: str                             # Application/database name                
    dtype: DType = "str"                    # Expected data type
    date_format: str | tuple[str, ...] | None = None   # Text date format(s), tried in order
    required: bool = False                  # NULL not allowed     
    rule: str | None = None                 # Validation rule       
    null_values: tuple[str, ...] = ()       # Extra NULL values    



@dataclass(frozen=True)
class FileSpec:

    key: str                                 # Internal file identifier
    label: str                               # Name shown to user
    columns: tuple[Col, ...]                 # Expected file columns
    row_key: tuple[str, ...]                 # Columns forming unique row
    raw_table: str                           # Raw PostgreSQL table
    reader: Reader = "auto"                  # File reader
    sheet: str | None = None                 # Excel sheet name
    header_row: int | Literal["auto"] = 1    # Header row number
    mode: Mode = "replace"                   # Replace or append
    upload_params: tuple[str, ...] = ()      # Extra upload fields
    dedupe_exact: bool = False               # Remove exact duplicates
    model_sql: tuple[str, ...] = ()          # SQL models to run after load