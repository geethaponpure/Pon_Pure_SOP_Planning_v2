import re
import warnings
from pathlib import Path
from zipfile import BadZipFile
import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries
from openpyxl.utils.exceptions import InvalidFileException
from app.ingest.spec import FileSpec


AUTO_HEADER_SCAN = 30                             # rows searched when header_row = "auto"


class ReadError(Exception):
    """Structural failure: the whole file is refused and the previous version stays current."""



def normalise(name) -> str:
    """Header match key: stripped, inner whitespace collapsed, case-insensitive."""
    return " ".join(str(name).split()).lower() if name is not None else ""



def is_xlsx(path) -> bool:
    """By the first bytes, not the name: an xlsx is a zip file (PK). An old .xls, a csv, or an
    Oracle export renamed to .xlsx is not."""

    with open(path, "rb") as f:
        return f.read(2) == b"PK"



def find_header_row(rows: list[tuple], expected: list[str]) -> int:
    """Finds the Excel row containing the required column headers."""

    want = {normalise(e) for e in expected}
    for i, row in enumerate(rows):
        if want <= {normalise(v) for v in row}:
            return i

    raise ReadError(f"header row not found in the first {len(rows)} rows, looked for {sorted(want)}")



def _is_blank(v) -> bool:
    """Checks whether a cell is empty."""
    return v is None or (isinstance(v, str) and not v.strip())



def _header_names(row: tuple) -> list[str]:
    """Converts the Excel header row into usable DataFrame column names."""

    names, seen = [], {}
    for n, v in enumerate(row, start=1):
        name = f"_unnamed_{n}" if _is_blank(v) else str(v)
        if name in seen:                          # repeated header: keep both, suffix the later one
            seen[name] += 1
            name = f"{name}.{seen[name]}"
        else:
            seen[name] = 0
        names.append(name)
    return names



def read_xlsx(path, sheet: str | None, header_row: int | str, expected: list[str]) -> pd.DataFrame:
    """
    Read one sheet. The index is the Excel row number, so rejects can point back to the sheet.
    Merged cells are filled down, then fully blank rows (separators) are dropped.
    Formula cells come back as their saved value.
    """

    with open(path, "rb") as fh:                  # a handle, not a path: openpyxl refuses paths not
        return _read_sheet(fh, sheet, header_row, expected)   # ending .xlsx (uploads land as temp names)



def _read_sheet(fh, sheet, header_row, expected) -> pd.DataFrame:

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")       # "Workbook contains no default style" on oracle exports
            wb = load_workbook(fh, read_only=True, data_only=True)
    except (BadZipFile, KeyError, OSError, InvalidFileException) as e:
        raise ReadError(f"not a readable xlsx workbook: {e}") from e

    try:
        if sheet is None:
            ws = wb.worksheets[0]
        elif sheet in wb.sheetnames:
            ws = wb[sheet]
        else:
            raise ReadError(f"sheet {sheet!r} not found, workbook has {wb.sheetnames}")

        merged, unsaved = _scan_sheet_xml(wb, ws)
        if unsaved:
            raise ReadError("the formulas in this file have no saved results, so their cells read as blank. "
                            "This happens when a file was last saved by a script instead of Excel. "
                            "Open it in Excel, press Save, and upload it again.")

        ws.reset_dimensions()                     # some exports carry a wrong dimension tag, read all rows
        rows = ws.iter_rows(values_only=True)

        if header_row == "auto":
            scanned = [r for _, r in zip(range(AUTO_HEADER_SCAN), rows)]
            h = find_header_row(scanned, expected)
            header, body_start, body = scanned[h], h + 2, scanned[h + 1:]
        else:
            scanned = [r for _, r in zip(range(header_row), rows)]
            if len(scanned) < header_row:
                raise ReadError(f"sheet has fewer than {header_row} rows, no header")
            header, body_start, body = scanned[-1], header_row + 1, []

        names = _header_names(header)
        width = len(names)

        data = [tuple(r[:width]) + (None,) * (width - len(r)) for r in _chain(body, rows)]
        _fill_merged(data, merged, body_start, width)
    finally:
        wb.close()                                # read-only mode keeps the file open until closed

    keep = [i for i, r in enumerate(data) if not all(_is_blank(v) for v in r)]
    index = pd.Index([body_start + i for i in keep], name="row_no")
    return pd.DataFrame([data[i] for i in keep], columns=names, index=index, dtype=object)



_MERGE_REF = re.compile(rb'<mergeCell ref="([A-Z]+[0-9]+:[A-Z]+[0-9]+)"')
# a formula with no saved result: <f>SUM(..)</f><v /> or </f></c>. excel always stores the result;
# a file last saved by a script (openpyxl, pandas) does not, and every formula cell then reads as blank
_UNSAVED_FORMULA = re.compile(rb'(?:</f>|<f[^>]*/>)\s*(?:<v\s*/>|<v></v>|</c>)')


def _scan_sheet_xml(wb, ws) -> tuple[list[tuple[int, int, int, int]], bool]:
    """
    One pass over the sheet xml, in chunks. Returns the merged ranges as (min_col, min_row, max_col,
    max_row) - read-only worksheets do not expose merges - and whether any formula has no saved result.
    """

    path = getattr(ws, "_worksheet_path", None)
    archive = getattr(wb, "_archive", None)
    if path is None or archive is None:           # openpyxl internals moved, read without merges
        return [], False

    refs, tail, unsaved = [], b"", False
    with archive.open(path) as f:
        while chunk := f.read(1 << 20):
            buf = tail + chunk
            unsaved = unsaved or _UNSAVED_FORMULA.search(buf) is not None
            refs.extend(m.group(1).decode() for m in _MERGE_REF.finditer(buf))
            cut = buf.rfind(b"<")                 # carry a possibly split tag into the next chunk
            tail = buf[cut:] if cut != -1 else b""
            if tail and _MERGE_REF.match(tail):   # already counted a complete tag
                tail = b""

    ranges = []
    for ref in refs:
        min_col, min_row, max_col, max_row = range_boundaries(ref)
        if min_col and min_row and max_col and max_row:   # always set for A1:B2 refs; the stub
            ranges.append((min_col, min_row, max_col, max_row))   # allows None for A:A / 1:1
    return ranges, unsaved



def _fill_merged(data: list[tuple], ranges, body_start: int, width: int) -> None:
    """Copy each merged range's top-left value into the rest of the range, as Excel shows it."""

    for min_col, min_row, max_col, max_row in ranges:
        top = min_row - body_start
        if top < 0 or top >= len(data):           # header or above: not data
            continue
        for c in range(min_col - 1, min(max_col, width)):
            value = data[top][c]
            for i in range(top + 1, min(max_row - body_start + 1, len(data))):
                row = list(data[i])
                row[c] = value
                data[i] = tuple(row)



def _chain(first: list, rest):
    yield from first
    yield from rest



def read_file(path, spec: FileSpec) -> pd.DataFrame:
    """Entry point for the runner. Only xlsx is accepted."""

    path = Path(path)
    if not is_xlsx(path):
        raise ReadError(f"{path.name} is not an .xlsx file. Open it in Excel, Save As "
                        "Excel Workbook (.xlsx) and upload that.")

    expected = [c.source for c in spec.columns if c.required]
    return read_xlsx(path, spec.sheet, spec.header_row, expected)
