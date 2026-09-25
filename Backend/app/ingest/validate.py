# this file is use for
# Map source headers → coerce types → check required / rule → dedupe → row_key.
# all or nothing: one bad row rejects the whole file, and every problem is listed so the user
# can fix the sheet in one go and upload again. nothing of a rejected file is loaded.
# pure function over a DataFrame from excel_reader. no database here; referential checks
# (is this item in ItemMasters) belong to the sql model layer.

import math
import operator
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time

import pandas as pd
from openpyxl.utils.datetime import from_excel

from app.ingest.excel_reader import normalise
from app.ingest.spec import Col, FileSpec


@dataclass
class ValidationResult:

    clean: pd.DataFrame                           # target columns, python values, index = excel row_no
    rejects: list[dict]                           # one per bad cell: row_no, column, reason, value, row
    structural_errors: list[str]                  # the file itself is wrong (missing column, no rows)
    rows_read: int = 0
    duplicates_dropped: int = 0                   # identical rows removed by dedupe_exact
    rows_rejected: int = 0                        # distinct rows with at least one problem
    ignored_columns: list[str] = field(default_factory=list)   # source headers no spec column uses

    @property
    def ok(self) -> bool:
        """True only when every row is good. Anything else rejects the whole file."""
        return not self.structural_errors and not self.rejects



def summarize_rejects(rejects: list[dict], limit: int = 20) -> str:
    """One line per (column, reason) with its row count and first rows, for the upload page and
    ingest_files.error. The full list is in ingest_rejects."""

    groups: dict[tuple[str, str], list[int]] = {}
    for r in rejects:
        groups.setdefault((r["column"], r["reason"]), []).append(r["row_no"])

    lines = []
    for (column, reason), rows in sorted(groups.items(), key=lambda g: -len(g[1]))[:limit]:
        first = ", ".join(str(n) for n in sorted(set(rows))[:5])
        more = " ..." if len(set(rows)) > 5 else ""
        lines.append(f"{column}: {reason} - {len(set(rows))} rows (row {first}{more})")
    if len(groups) > limit:
        lines.append(f"... and {len(groups) - limit} more kinds of problem")
    return "\n".join(lines)


class BadValue(ValueError):
    """A cell that cannot become its column's type."""



# ---------------------------------------------------------------- rules

_OPS = {">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le,
        "=": operator.eq, "!=": operator.ne}
_CMP_RULE = re.compile(r"^\s*(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?)\s*$")


def parse_rule(rule: str):
    """'> 0' / '>= 0' -> numeric check, '~ <regex>' -> full match on text. Bad syntax raises."""

    if rule.lstrip().startswith("~"):
        pattern = re.compile(rule.lstrip()[1:].strip())
        return lambda v: bool(pattern.fullmatch(str(v))), "text"

    m = _CMP_RULE.match(rule)
    if not m:
        raise ValueError(f"cannot parse rule {rule!r}")
    op, limit = _OPS[m.group(1)], float(m.group(2))
    return lambda v: op(v, limit), "number"



# ---------------------------------------------------------------- coercion
# values arrive as text from converted exports and as real cells (int, float, datetime,
# time) from xlsx, so every converter accepts both.

def _is_null(v, null_values: frozenset) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    if isinstance(v, str):
        s = v.strip()
        return not s or s in null_values
    return False


def _to_str(v) -> str:
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))                        # 106.0 -> '106'
    if isinstance(v, datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, (date, time)):
        return v.isoformat()                      # time(4, 0) -> '04:00:00'
    return str(v)


def _to_float(v) -> float:
    if isinstance(v, bool):
        raise BadValue("not a number")
    if isinstance(v, (int, float)):
        f = float(v)
    elif isinstance(v, str):
        try:
            f = float(v.strip())
        except ValueError:
            raise BadValue("not a number") from None
    else:
        raise BadValue("not a number")
    if not math.isfinite(f):
        raise BadValue("not a number")
    return f


def _to_int(v) -> int:
    if isinstance(v, int) and not isinstance(v, bool):
        return v
    f = _to_float(v)
    if not f.is_integer():
        raise BadValue("not a whole number")
    return int(f)


def _parse_text_datetime(s: str, formats: tuple[str, ...]) -> datetime:
    s = s.strip()
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt)      # %b matches JUN / Jun / jun alike
        except ValueError:
            pass
    if not formats:
        try:
            return datetime.fromisoformat(s)
        except ValueError:
            pass
    raise BadValue(f"not a date in format {' or '.join(formats) or 'YYYY-MM-DD'}")


def _to_datetime(v, formats) -> datetime:
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        try:
            return from_excel(v)                  # date cell stored as an excel serial number
        except (ValueError, OverflowError, TypeError):
            raise BadValue("not a date") from None
    if isinstance(v, str):
        return _parse_text_datetime(v, formats)
    raise BadValue("not a date")


def _to_date(v, formats) -> date:
    return _to_datetime(v, formats).date()


_TRUE = {"y", "yes", "true", "1", "t"}
_FALSE = {"n", "no", "false", "0", "f"}


def _to_bool(v) -> bool:
    if isinstance(v, bool):
        return v
    s = _to_str(v).lower()
    if s in _TRUE:
        return True
    if s in _FALSE:
        return False
    raise BadValue("not a yes/no value")


def _converter(col: Col):
    formats = (col.date_format,) if isinstance(col.date_format, str) else tuple(col.date_format or ())
    return {
        "str": _to_str,
        "int": _to_int,
        "float": _to_float,
        "date": lambda v: _to_date(v, formats),
        "datetime": lambda v: _to_datetime(v, formats),
        "bool": _to_bool,
    }[col.dtype]



# ---------------------------------------------------------------- helpers

def _json_safe(v):
    if v is None or isinstance(v, (str, int, bool)):
        return v
    if isinstance(v, float):
        return None if math.isnan(v) else v
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    return str(v)


def _map_headers(df: pd.DataFrame, spec: FileSpec) -> tuple[dict[str, str], list[str], list[str]]:
    """source header in df -> spec target. Returns (mapping, structural errors, ignored headers)."""

    by_norm: dict[str, list[str]] = {}
    for name in df.columns:
        by_norm.setdefault(normalise(name), []).append(name)

    mapping, errors, used = {}, [], set()
    for col in spec.columns:
        found = by_norm.get(normalise(col.source), [])
        if len(found) > 1:
            errors.append(f"column {col.source!r} appears {len(found)} times")
        elif found:
            mapping[found[0]] = col.target
            used.add(found[0])
        elif col.required:
            errors.append(f"required column {col.source!r} is missing")

    ignored = [c for c in df.columns if c not in used and not c.startswith("_unnamed_")]
    return mapping, errors, ignored



# ---------------------------------------------------------------- validate

def validate(df: pd.DataFrame, spec: FileSpec) -> ValidationResult:

    targets = [c.target for c in spec.columns]
    empty = pd.DataFrame(columns=targets, dtype=object)
    result = ValidationResult(clean=empty, rejects=[], structural_errors=[], rows_read=len(df))

    mapping, errors, result.ignored_columns = _map_headers(df, spec)
    if errors:
        result.structural_errors = errors
        return result
    if df.empty:
        result.structural_errors = ["the sheet has a header but no data rows"]
        return result

    source_of = {t: s for s, t in mapping.items()}
    raw = pd.DataFrame(                           # optional column absent from this export -> all null
        {t: (df[source_of[t]] if t in source_of else None) for t in targets},
        index=df.index, dtype=object,
    )

    # exact duplicates first, so a repeated bad row is not rejected twice
    if spec.dedupe_exact:
        dup = raw.map(_to_str_or_none).duplicated(keep="first")
        result.duplicates_dropped = int(dup.sum())
        raw = raw.loc[~dup]

    bad_rows: dict[int, list[tuple[str, str, object]]] = {}
    clean_cols = {}

    for col in spec.columns:
        nulls = frozenset(col.null_values)
        convert = _converter(col)
        check, rule_kind = parse_rule(col.rule) if col.rule else (None, None)
        out = []

        for row_no, v in zip(raw.index.tolist(), raw[col.target].tolist()):
            if _is_null(v, nulls):
                if col.required:
                    bad_rows.setdefault(row_no, []).append((col.target, "required value is missing", v))
                out.append(None)
                continue
            try:
                value = convert(v)
            except BadValue as e:
                bad_rows.setdefault(row_no, []).append((col.target, str(e), v))
                out.append(None)
                continue
            if check is not None:
                probe = value if rule_kind == "text" or isinstance(value, (int, float)) else None
                if probe is None or not check(probe):
                    bad_rows.setdefault(row_no, []).append((col.target, f"fails rule {col.rule}", v))
            out.append(value)

        clean_cols[col.target] = out

    clean = pd.DataFrame(clean_cols, index=raw.index, dtype=object)
    clean = clean.loc[~clean.index.isin(list(bad_rows))]

    # row identity: a later row with the same key is a duplicate. null counts as ''.
    key = clean.loc[:, list(spec.row_key)].map(lambda v: "" if v is None else v)
    dup = key.duplicated(keep="first")
    for row_no in clean.index[dup.to_numpy()].tolist():
        bad_rows[row_no] = [(",".join(spec.row_key), "duplicate", None)]
    clean = clean.loc[~dup]

    # rejects keep the row as it was in the file, under its source headers
    for row_no in sorted(bad_rows):
        row = {source_of.get(t, t): _json_safe(raw.at[row_no, t]) for t in targets}
        for column, reason, value in bad_rows[row_no]:
            result.rejects.append({"row_no": int(row_no), "column": column, "reason": reason,
                                   "value": _json_safe(value), "row": row})

    result.clean = clean
    result.rows_rejected = len(bad_rows)
    return result


def _to_str_or_none(v):
    """Comparable form for exact-duplicate detection: '5', 5 and 5.0 are the same cell."""
    return None if _is_null(v, frozenset()) else _to_str(v)
