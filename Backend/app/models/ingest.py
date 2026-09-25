from sqlalchemy import (Column, BigInteger, Integer, Text, Double, Date, DateTime, Boolean,
                        ForeignKey, Index, Identity, func, text)
from sqlalchemy.dialects.postgresql import JSONB
from app.core.database import Base
from app.ingest.registry import FILE_SPECS



#   IngestFiles  -> IngestRejects   (why an upload was rejected: one row per bad cell)
#   IngestFiles  -> raw_<spec>      (the rows of one upload, never updated)
#
# a raw table keeps every version ever loaded. which one counts is ingest_files.is_current,
# so the sql models always join raw_* to ingest_files on file_id and is_current.


class IngestFiles(Base):

    __tablename__ = "ingest_files"

    file_id = Column(BigInteger, Identity(), primary_key=True)
    file_type = Column(Text, nullable=False)              # spec key, e.g. bom_extract
    original_name = Column(Text, nullable=False)          # file name as uploaded
    sha256 = Column(Text, nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    uploaded_by = Column(Text, nullable=False)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    period_key = Column(Text)                             # append mode only, e.g. 2026-2027/JC1
    upload_params = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))   # e.g. {"plant": ...}
    status = Column(Text, nullable=False)                 # received -> validating -> loading -> modeling -> published
                                                          # or rejected (any bad row: nothing loaded, reasons
                                                          # in ingest_rejects) / failed (wrong file or system error)
    step = Column(Text)                                   # where it stopped, on rejected / failed
    rows_read = Column(BigInteger)
    rows_deduped = Column(BigInteger)                     # identical rows dropped (dedupe_exact specs)
    rows_loaded = Column(BigInteger)
    rows_rejected = Column(BigInteger)                    # bad rows found. above zero means nothing was loaded
    error = Column(Text)
    is_current = Column(Boolean, nullable=False, server_default=text("false"))
    superseded_by = Column(BigInteger, ForeignKey("ingest_files.file_id"))

    __table_args__ = (
        # one current file per type (replace) or per type + period (append)
        Index("ux_ingest_files_current", "file_type", func.coalesce(period_key, ""),
              unique=True, postgresql_where=text("is_current")),
        # the same bytes twice for one type are refused. a failed or rejected upload does not
        # block a retry of the same file
        Index("ux_ingest_files_sha256", "file_type", "sha256",
              unique=True, postgresql_where=text("status NOT IN ('failed', 'rejected')")),
    )



class IngestRejects(Base):

    __tablename__ = "ingest_rejects"

    reject_id = Column(BigInteger, Identity(), primary_key=True)
    file_id = Column(BigInteger, ForeignKey("ingest_files.file_id", ondelete="CASCADE"), nullable=False, index=True)
    row_no = Column(Integer, nullable=False)              # excel row number, so the user can find it
    column_name = Column(Text, nullable=False)            # target column, or the row_key columns for a duplicate
    reason = Column(Text, nullable=False)
    value = Column(Text)                                  # the bad cell as it was in the file
    row_data = Column(JSONB, nullable=False)              # the whole row under its source headers



# ---------------------------------------------------------------- raw_* tables
# one class per spec, built from the spec's columns so a column is declared only once.
# create_all only creates missing tables: a column added to a spec later needs the raw table
# altered (or dropped and the files reloaded).

_SQL_TYPES = {"str": Text, "int": BigInteger, "float": Double, "date": Date,
              "datetime": DateTime, "bool": Boolean}


def _raw_model(spec):
    attrs = {
        "__tablename__": spec.raw_table,
        "file_id": Column(BigInteger, ForeignKey("ingest_files.file_id", ondelete="CASCADE"), primary_key=True),
        "row_no": Column(Integer, primary_key=True),      # excel row number
    }
    for col in spec.columns:
        attrs[col.target] = Column(_SQL_TYPES[col.dtype], nullable=not col.required)
    name = "".join(part.title() for part in spec.raw_table.split("_"))       # raw_bom_extract -> RawBomExtract
    return type(name, (Base,), attrs)


RAW_MODELS = {key: _raw_model(spec) for key, spec in FILE_SPECS.items()}
