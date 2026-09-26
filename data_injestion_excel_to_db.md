# Data ingestion - Excel to database

How the SOP tool takes an Excel file from a user and turns it into clean data the planning screens can use.

Part 1 is for everyone. Part 2 is for developers.

---

## Part 1 - how it works

### In one picture

```text
   user                         the tool                                    the database
 ┌────────────────┐   upload   ┌──────────────────────────────────┐   ┌──────────────────────────┐
 │ downloads the  │ ─────────► │ 1. is it a real .xlsx file?      │   │ raw_<file type>          │
 │ template,      │            │ 2. are the right columns there?  │   │   every upload, kept     │
 │ fills it in,   │            │ 3. is every row correct?         │──►│ ingest_files             │
 │ uploads it     │ ◄───────── │ 4. load it, make it "current"    │   │   who, when, outcome     │
 └────────────────┘   result   └──────────────────────────────────┘   │ views (v_...)            │
                                                                      │   clean data for screens │
                                                                      └──────────────────────────┘
```

**The one rule to remember:** a file is loaded **completely or not at all**.
If even one row has a problem, nothing is loaded, the data already in use stays in use, and the user gets the list of rows to fix.

---

### The three files

Only data that CRM does **not** have comes in by Excel. Everything else is read from CRM automatically.

| file type | what it is | who provides it | one upload replaces |
| --- | --- | --- | --- |
| `bom_extract` | **BOM** - what goes into each product (recipe) | Oracle BOM extract | the whole BOM |
| `shelf_life` | **Shelf life** - how many days a finished product keeps | QMS | the whole shelf life list |
| `cycle_time` | **Cycle time** - how long one batch takes on one machine | each plant | **only that plant's** sheet |

---

### What the user does

```text
  1. download the template      one per file type. Sheet "Template" to fill, sheet "Guidelines" to read
            │
  2. fill the first sheet       keep the header row as it is. dark blue columns are required
            │
  3. save it IN EXCEL           as Excel Workbook (.xlsx)
            │
  4. upload it                  choose the file type, give your name
            │
  5. read the result            loaded  ─ or ─  a list of rows to fix, then upload again
```

---

### What happens to a file

Every upload gets a number (`file_id`) and moves through these steps:

```text
  received ──► validating ──► loading ──► modeling ──► published   ✔ in use now
                   │              │           │
                   ▼              ▼           ▼
               rejected         failed      failed
         (some rows are wrong) (system problem)
                   │
                or failed
         (the file itself is wrong: missing column,
          wrong file type, not saved in Excel)
```

| outcome | meaning | what the user does |
| --- | --- | --- |
| **published** | loaded and now in use | nothing |
| **rejected** | the file is fine, but some rows have mistakes. **Nothing was loaded** | fix the listed rows, upload again |
| **failed** | the file as a whole is wrong (wrong type, missing column, not saved by Excel) | fix the file, upload again |

A rejected or failed upload **never** removes good data. The last published file stays in use.

---

### The checks

| check | example of a problem | result |
| --- | --- | --- |
| real Excel file | an `.xls`, `.csv`, or an Oracle export renamed to `.xlsx` | failed |
| saved by Excel | a file last saved by a script: its formulas have no results | failed, with "open it in Excel and press Save" |
| right columns | `Itemcode` missing in a shelf life file | failed |
| every column kept (BOM, shelf life) | `BASIS_TYPE` deleted from a BOM extract, even though its cells may be blank | failed |
| required cells filled | an empty `PRODUCT NAME` | rejected |
| right kind of value | `50 LTRS` in a number column | rejected |
| allowed range | `SHELF_LIFE_DAYS = 0` (must be more than 0) | rejected |
| one row per thing | two rows for the same product and machine with different hours | rejected |
| one plant per file (cycle time) | two plants in one sheet | failed |
| not the same file twice | the exact same file uploaded again | refused at once |

Things the tool is relaxed about:

- column **order** does not matter, and extra columns are ignored
- header spelling ignores extra spaces and capitals (`" Observation  HRS "` = `Observation HRS`)
- fully blank rows are skipped
- the data must be on the **first sheet**; other sheets are ignored

---

### Duplicate rows - three cases

```text
  every column the same             ──►  the copy is dropped quietly (counted as "deduped")

  same product/machine/pack,
  one row simply has more filled in ──►  the fuller row is kept, the other dropped

  same product/machine/pack,
  but different values              ──►  the file is rejected - someone must decide which is right
```

---

### Cycle time - one sheet per plant

```text
  PSM sheet uploaded   ──►  PSM is current
  Hosur sheet uploaded ──►  Hosur is current, PSM untouched
  new PSM sheet        ──►  replaces the old PSM sheet only
```

- the plant is read from the **Plant** column. It must be spelled exactly as CRM names the plant, and be the same on every row
- always upload the **full** list for the plant. Products left out disappear from the tool
- two people uploading for the same plant: the later **published** one wins. Both uploads are kept in the history

---

### Where the data lives

| table | holds |
| --- | --- |
| `ingest_files` | one row per upload: who, when, file name, status, row counts, the reason if it did not load, whether it is the one in use (`is_current`) and what replaced it |
| `ingest_rejects` | for a rejected upload: every problem - Excel row, column, reason, the wrong value |
| `raw_bom_extract` · `raw_shelf_life` · `raw_cycle_time` | the rows of **every** upload, exactly as loaded. Old uploads stay as history |
| views (`v_...`) | what the screens read: only the upload in use, joined to CRM. See `views_applied.md`, section *ingest_models* |

Rows in the raw tables are never changed after loading. "Which upload counts" is only the `is_current` flag.

---

## Part 2 - for developers

### Code map

```text
Backend/
├── app/ingest/
│   ├── spec.py            what a file type looks like: Col, FileSpec
│   ├── specs/             one file per file type: bom_extract, shelf_life, cycle_time
│   ├── registry.py        FILE_SPECS - the only list of file types. checks every spec at import
│   ├── excel_reader.py    opens the .xlsx, finds the header row, fills merged cells, refuses unsaved formulas
│   ├── validate.py        headers → types → required / rules → duplicates. pure, no database
│   ├── loader.py          register_file, set_status, load_raw (COPY), write_rejects, switch_current
│   ├── runner.py          run_ingest: runs one upload end to end. also the command line tool
│   └── templates.py       builds the Excel templates from the specs
├── app/models/ingest.py   ingest_files, ingest_rejects, and one raw_* table per spec (built from the spec)
├── app/views/08_ingest_models.sql   the views over the raw tables
├── app/services/ingest_service.py   what the api calls
├── app/api/v1/ingest_api.py         the api routes
├── template/              the downloadable templates (created at api start when missing)
└── uploads/               the uploaded files (not in git)
```

### The flow in code

```text
  api: POST /ingest/upload
      │  saves the file as uploads/<random>_<name>, checks it is really an .xlsx
      ▼
  register_file(db, spec, path, uploaded_by)          → file_id, status "received"
      │  refuses: same file already uploaded (DuplicateFileError), wrong upload parameters (UploadError)
      ▼
  run_ingest(file_id, path, db)          reads + checks in a worker thread, db work on the pooled session
      │
      ├─ read_file ─────► ReadError?                   → failed
      ├─ validate ──────► file-level problem?          → failed
      │                   any bad row?                 → write_rejects → rejected
      │
      ├─ load_raw (COPY) + switch_current + status     ← ONE transaction: all or nothing
      │                                                  → modeling
      ├─ refresh materialized views of the spec (none today, the views are plain)
      ▼
  published   returns the ingest_files row as a dict
```

- `register_file` and `set_status` commit on their own, so the status can be followed while it runs.
- the load, the current switch and the status change commit **together**. A half-loaded file can never become current.
- `run_ingest` never raises for a bad file - it returns `status = rejected / failed`. It raises only on a system error, after marking the file failed.
- progress is logged through the `app.ingest.runner` logger.

### Calling it

**From the API** - three routes:

| route | does |
| --- | --- |
| `POST /ingest/upload` | form fields `file`, `uploaded_by`, `file_type` → the `ingest_files` row. 409 duplicate file, 422 bad parameters |
| `GET /ingest/template/{file_type}` | the Excel template |
| `GET /ingest/files/{file_id}/rejects` | the problems of a rejected upload, with Excel column names and row numbers |

The routes pass their `get_db` session down to the pipeline, which is async: `await` it directly, no `run_in_threadpool`.

**From Python:**

```python
from app.core.database import AsyncLocal          # the api's pooled async engine (get_db uses it too)
from app.ingest.registry import get_spec
from app.ingest.loader import register_file
from app.ingest.runner import run_ingest

async with AsyncLocal() as session:
    file_id = await register_file(session, get_spec("shelf_life"), path, uploaded_by="geetha")
    result = await run_ingest(file_id, path, session)   # result["status"], result["error"], row counts ...
```

The pipeline is async on the pooled session: no connection is opened per call. Reading the Excel and checking the rows run in a worker thread, so the api keeps serving other requests during a long upload.

**From the command line** (from `Backend/`):

```text
python -m app.ingest.runner --type shelf_life --by geetha "path/to/file.xlsx"
```

### How a file type is described - the spec

Everything about a file type lives in its spec (`app/ingest/specs/<type>.py`). The reader, the checks, the raw table and the template are all built from it.

| spec field | means |
| --- | --- |
| `key`, `label` | the file type id and its name on screen |
| `columns` | one `Col` per column: Excel header, database name, type, required, rule, what counts as empty, help text, example |
| `row_key` | the columns that identify a row - two rows with the same key are the "same thing" |
| `mode` | `replace` = every upload replaces the previous one · `append` = one upload per period / scope |
| `scope_column` | cycle time: the column (plant) whose value decides what an upload replaces |
| `sheet`, `header_row` | `None` = first sheet · a row number, or `auto` to search for the header |
| `dedupe_exact` | drop rows identical in every column |
| `strict_headers` | every column must be present, optional ones too (the system extracts) |
| `model_sql` | the view file that uses this table |
| `notes` | extra lines for the template's Guidelines sheet |

Column types: `str` text · `int` whole number · `float` number · `date` · `datetime` · `bool`.
Rules: `"> 0"`, `">= 0"` ... or `"~ <regex>"` for text.

### Adding a new file type

```text
  1. write app/ingest/specs/<type>.py          profile the real file first: the row_key must hold on real data,
                                               or every upload will be rejected
  2. add it to FILE_SPECS in registry.py       the registry checks the spec at start (typos fail loudly)
  3. restart the api                           creates raw_<type> and its template
  4. add views for it in app/views/            and point the spec's model_sql at the file
  5. load a real file with the command line    and check the numbers before telling users
```

### Changing an existing file type

- **template**: rebuild after any spec change - `python -m app.ingest.templates --force`. The api only creates missing templates.
- **raw table**: the api creates missing tables but never changes existing ones. A changed column needs an `ALTER TABLE` in pgAdmin, or drop the raw table and reload the files.
- **views**: edit `08_ingest_models.sql`; the api rebuilds it at the next start.

### Things worth knowing

| topic | detail |
| --- | --- |
| row numbers | `row_no` everywhere is the **Excel** row number, so a problem can be found in the sheet |
| formulas | the reader reads the result Excel saved. A file saved by a script (openpyxl, pandas) has none - it is refused with a clear message |
| merged cells | filled down, the way Excel shows them |
| empty vs zero | blank text is stored as NULL, never as an empty string. `0` is a real value |
| same file twice | compared by file content (sha256), per file type. A rejected or failed upload does not block a retry |
| stored problems | the first 1,000 per upload in `ingest_rejects`; the summary in `ingest_files.error` counts all |
| going back | an older upload cannot be made current again by re-uploading it (it counts as a duplicate) |
| PC products | `is_pc` in the views comes from `ItemCategories`, which is loaded for Performance Chemicals only - no row there means "not PC". Non PC rows are kept, not dropped |
| "made at this plant" | cycle time codes are checked against CRM's manufacturing feed (`BIRawMaterialConsumptions`, latest weekly run, loaded by the ETL). At PSM many products are made straight into the pack, so a packed item code is often the right one |

### Checks in pgAdmin

```sql
SET search_path TO ponpure_planner;

-- every upload, newest first
SELECT file_id, file_type, period_key, original_name, uploaded_by, uploaded_at, status, rows_loaded, is_current
FROM ingest_files ORDER BY file_id DESC;

-- what is in use now
SELECT file_type, period_key, file_id, uploaded_by, uploaded_at FROM ingest_files WHERE is_current;

-- why an upload did not load
SELECT row_no, column_name, reason, value FROM ingest_rejects WHERE file_id = <id> ORDER BY row_no;

-- cycle time rows whose item code needs a look (empty = all fine)
SELECT * FROM v_cycle_time_code_check;
```

### Words used here

| word | means |
| --- | --- |
| file type | one of the three kinds of Excel file: BOM, shelf life, cycle time |
| spec | the description of a file type: its columns and rules |
| template | the empty Excel file users download and fill |
| current | the upload in use now - one per file type, one per plant for cycle time |
| rejected | the file had wrong rows; nothing was loaded |
| failed | the file itself was wrong, or something broke; nothing was loaded |
| deduped | rows dropped because they repeated another row |
| raw table | where uploaded rows are kept exactly as loaded |
| view | a ready-made, cleaned query the screens read instead of the raw tables |
