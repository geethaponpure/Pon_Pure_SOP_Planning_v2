# this file is use for 
# Register → Validate → Retrieve file specifications.

import re
from app.ingest.spec import FileSpec
from app.ingest.validate import parse_rule
from app.ingest.specs.bom_extract import BOM_EXTRACT
from app.ingest.specs.shelf_life import SHELF_LIFE


# the only list of supported file types. the api "types" endpoint reads this dict.
# cycle_time, rm_consumption and po_receipts get added here once their specs are written.

FILE_SPECS: dict[str, FileSpec] = {
    spec.key: spec
    for spec in (
        BOM_EXTRACT,
        SHELF_LIFE,
    )
}


_SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")
_RESERVED = {"file_id", "row_no"}                 # Reserved raw-table columns


def _check(spec: FileSpec) -> None:
    """Fail at import on a spec typo, so it never reaches an upload."""

    targets = [c.target for c in spec.columns]
    sources = [" ".join(c.source.split()).lower() for c in spec.columns]

    bad = [t for t in targets if not _SNAKE.match(t) or t in _RESERVED]
    if bad:
        raise ValueError(f"{spec.key}: bad target names {bad}")
    if len(set(targets)) != len(targets):
        raise ValueError(f"{spec.key}: duplicate target names")
    if len(set(sources)) != len(sources):
        raise ValueError(f"{spec.key}: two columns map the same source header")

    missing = [k for k in spec.row_key if k not in targets]
    if not spec.row_key or missing:
        raise ValueError(f"{spec.key}: row_key must be non-empty spec targets, unknown {missing}")

    for c in spec.columns:
        if c.rule:
            _, kind = parse_rule(c.rule)          # raises on bad syntax
            if kind == "number" and c.dtype not in ("int", "float"):
                raise ValueError(f"{spec.key}: numeric rule {c.rule!r} on {c.dtype} column {c.target}")

    if not _SNAKE.match(spec.raw_table):
        raise ValueError(f"{spec.key}: bad raw_table {spec.raw_table!r}")


for _spec in FILE_SPECS.values():
    _check(_spec)

if len({s.raw_table for s in FILE_SPECS.values()}) != len(FILE_SPECS):
    raise ValueError("two specs share a raw_table")


def get_spec(key: str) -> FileSpec:
    try:
        return FILE_SPECS[key]
    except KeyError:
        raise KeyError(f"unknown file type {key!r}, expected one of {sorted(FILE_SPECS)}") from None
