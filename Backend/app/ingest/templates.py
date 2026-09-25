# this file is use for
# Build the downloadable Excel template of every file type from its spec, so a template matches
# what the upload expects. sheet 1 is the template the user fills, sheet 2 the guidelines.
# created in Backend/template/ at api start when missing. after changing a spec, rebuild with:
#   python -m app.ingest.templates --force

from pathlib import Path
from typing import Any, cast

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

from app.ingest.registry import FILE_SPECS
from app.ingest.spec import Col, FileSpec
from app.ingest.validate import _CMP_RULE


TEMPLATE_DIR = Path(__file__).resolve().parents[2] / "template"      # Backend/template
FORMAT_ROWS = 1000                                # rows pre-formatted and checked on the template sheet

REQUIRED_FILL = PatternFill("solid", fgColor="1F4E78")
OPTIONAL_FILL = PatternFill("solid", fgColor="D9E1F2")
TITLE = Font(bold=True, size=14)
BOLD = Font(bold=True)
WRAP = Alignment(wrap_text=True, vertical="top")

TYPE_WORDS = {"str": "Text", "int": "Whole number", "float": "Number", "date": "Date (e.g. 25-Sep-2026)",
              "datetime": "Date and time", "bool": "Yes / No"}
NUMBER_FORMATS = {"str": "@", "int": "0", "date": "dd-mmm-yyyy", "datetime": "dd-mmm-yyyy hh:mm"}
RULE_WORDS = {">": "greater than", ">=": "at least", "<": "less than", "<=": "at most", "=": "equal to", "!=": "not"}
EXCEL_OPERATORS = {">": "greaterThan", ">=": "greaterThanOrEqual", "<": "lessThan", "<=": "lessThanOrEqual",
                   "=": "equal", "!=": "notEqual"}


def template_path(key: str) -> Path:
    return TEMPLATE_DIR / f"{key}_template.xlsx"



def _rule_parts(col: Col) -> tuple[str, str] | None:
    """('>=', '0') for a numeric rule, None otherwise."""
    if not col.rule or col.rule.lstrip().startswith("~"):
        return None
    m = _CMP_RULE.match(col.rule)                 # the same syntax validate accepts
    return (m.group(1), m.group(2)) if m else None


def _allowed(col: Col) -> str:
    parts = []
    rule = _rule_parts(col)
    if rule:
        parts.append(f"{RULE_WORDS[rule[0]]} {rule[1]}")
    elif col.rule:
        parts.append(f"must match {col.rule.lstrip()[1:].strip()}")
    if col.null_values:
        parts.append(" or ".join(f"'{v}'" for v in col.null_values) + " for empty")
    return "; ".join(parts)


def _how_it_works(spec: FileSpec) -> list[str]:
    sheet = f"'{spec.sheet}'" if spec.sheet else "the first sheet"
    key_words = ", ".join(next(c.source for c in spec.columns if c.target == k) for k in spec.row_key)

    if spec.scope_column:
        scope = next(c.source for c in spec.columns if c.target == spec.scope_column)
        mode = (f"One {scope} per file: every row must have the same {scope}. Your upload replaces only the "
                f"previous file of that {scope}; files of other {scope}s are not touched.")
    elif spec.mode == "replace":
        mode = "Every upload is the complete list and replaces the previous upload in full."
    else:
        mode = "Every upload covers one period and replaces only the earlier upload of the same period."

    lines = [
        f"Fill {sheet} of this workbook. Keep the header row exactly as it is: do not rename or delete header "
        "cells. Column order does not matter, and extra columns are ignored.",
        "Dark blue headers are required columns: every row needs a value there. Light blue headers are optional.",
        "Hover over a header to see what to enter. The table below lists every column.",
        "Save the file in Excel as Excel Workbook (.xlsx) and upload that. Not .xls or .csv, and not a file "
        "last saved by another program: formulas would have no results.",
        mode,
        "If any row has a problem (a required cell empty, text in a number column, a value outside the allowed "
        "range) the whole file is rejected, nothing is loaded, and you get the list of Excel rows to fix. "
        "The previous upload stays in use until a correct file is loaded.",
        f"Each row is identified by: {key_words}. Two rows with the same values there but different details "
        "reject the file; if one of them simply has more filled in, that one is kept.",
    ]
    if spec.dedupe_exact:
        lines.append("Rows that are identical in every column are counted once.")
    lines.append("Uploading the exact same file twice is refused.")
    return lines



def build_template(spec: FileSpec) -> Workbook:
    wb = Workbook()

    # ---------------- sheet 1: the template
    ws = wb.active
    assert ws is not None
    ws.title = "Template"                         # every spec reads the first sheet, whatever its name
    assert spec.sheet is None, f"{spec.key}: a template named 'Template' would not match sheet={spec.sheet!r}"
    ws.freeze_panes = "A2"

    for i, col in enumerate(spec.columns, start=1):
        letter = get_column_letter(i)
        cell = ws.cell(1, i, col.source)
        cell.fill = REQUIRED_FILL if col.required else OPTIONAL_FILL
        cell.font = Font(bold=True, color="FFFFFF" if col.required else "000000")
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        note = ("Required. " if col.required else "Optional. ") + (col.help or "")
        if _allowed(col):
            note += f" Allowed: {_allowed(col)}."
        cell.comment = Comment(note.strip(), "SOP tool", width=300, height=110)
        ws.column_dimensions[letter].width = min(max(len(col.source) + 4, 14), 42)

        fmt = NUMBER_FORMATS.get(col.dtype)
        if fmt:
            for r in range(2, FORMAT_ROWS + 2):
                ws.cell(r, i).number_format = fmt

        # excel's own check, so a typo is caught while typing. skipped where text like '-' is allowed
        if col.dtype in ("int", "float") and not col.null_values:
            rule = _rule_parts(col)
            kind = "whole" if col.dtype == "int" else "decimal"
            if rule:
                dv = DataValidation(type=kind, operator=cast(Any, EXCEL_OPERATORS[rule[0]]), formula1=rule[1],
                                    allow_blank=True)
                dv.error = f"{col.source}: a {TYPE_WORDS[col.dtype].lower()} {RULE_WORDS[rule[0]]} {rule[1]}."
            else:
                dv = DataValidation(type=kind, operator="between", formula1="-1000000000", formula2="1000000000",
                                    allow_blank=True)
                dv.error = f"{col.source}: a {TYPE_WORDS[col.dtype].lower()} only, no units or text."
            dv.errorTitle, dv.showErrorMessage = "Not allowed here", True
            ws.add_data_validation(dv)
            dv.add(f"{letter}2:{letter}{FORMAT_ROWS + 1}")
    ws.row_dimensions[1].height = 45

    # ---------------- sheet 2: the guidelines
    gd = wb.create_sheet("Guidelines")
    gd.column_dimensions["A"].width = 40
    for letter, width in zip("BCDEF", (11, 22, 24, 60, 28)):
        gd.column_dimensions[letter].width = width

    gd.append([f"{spec.label} - how to fill the template"])
    gd["A1"].font = TITLE
    gd.append([])
    gd.append(["How the upload works"])
    gd.cell(gd.max_row, 1).font = BOLD
    for line in _how_it_works(spec):
        gd.append([f"• {line}"])
        gd.merge_cells(start_row=gd.max_row, start_column=1, end_row=gd.max_row, end_column=6)
        gd.cell(gd.max_row, 1).alignment = WRAP
        gd.row_dimensions[gd.max_row].height = 15 * (1 + len(line) // 150)

    if spec.notes:
        gd.append([])
        gd.append(["About this file"])
        gd.cell(gd.max_row, 1).font = BOLD
        for line in spec.notes:
            gd.append([f"• {line}"])
            gd.merge_cells(start_row=gd.max_row, start_column=1, end_row=gd.max_row, end_column=6)
            gd.cell(gd.max_row, 1).alignment = WRAP
            gd.row_dimensions[gd.max_row].height = 15 * (1 + len(line) // 150)

    gd.append([])
    gd.append(["Column", "Required", "Type", "Allowed values", "What to enter", "Example"])
    head = gd.max_row
    for cell in gd[head]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = REQUIRED_FILL
    for col in spec.columns:
        example = "" if col.example is None else col.example
        gd.append([col.source, "Yes" if col.required else "", TYPE_WORDS[col.dtype], _allowed(col), col.help, example])
        for cell in gd[gd.max_row]:
            cell.alignment = WRAP
        gd.cell(gd.max_row, 6).number_format = "@"
        gd.cell(gd.max_row, 6).alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
        if col.required:
            gd.cell(gd.max_row, 1).font = BOLD
    gd.freeze_panes = gd.cell(head + 1, 1)

    wb.active = 0
    return wb



def write_templates(folder: Path = TEMPLATE_DIR, overwrite: bool = False) -> list[Path]:
    """Create the template of every registered file type that does not have one yet, and return the
    files created. An existing template is left alone; after a spec change, delete it (or run with
    --force) so it is built again."""
    folder.mkdir(parents=True, exist_ok=True)
    created = []
    for key, spec in FILE_SPECS.items():
        path = folder / f"{key}_template.xlsx"
        if path.exists() and not overwrite:
            continue
        build_template(spec).save(path)
        created.append(path)
    return created


if __name__ == "__main__":
    import sys
    made = write_templates(overwrite="--force" in sys.argv)
    print("\n".join(str(p) for p in made) if made else f"all templates already exist in {TEMPLATE_DIR} (use --force to rebuild)")
