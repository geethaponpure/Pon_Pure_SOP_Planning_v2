# API logic - Excel upload

What the four Excel upload APIs do, in plain words: what each one is for, what you send, and what you get back.

For how a file is checked and loaded behind the scenes, see [data_injestion_excel_to_db.md](data_injestion_excel_to_db.md).

---

## The four APIs at a glance

| # | API | in one line |
| --- | --- | --- |
| 1 | `GET  /ingest/template/{file_type}` | **Get the blank Excel template** to fill in |
| 2 | `POST /ingest/upload` | **Send a filled Excel file** to the tool |
| 3 | `GET  /ingest/files/{file_id}` | **Ask "is my file done yet?"** and see the result |
| 4 | `GET  /ingest/files/{file_id}/rejects` | **See every row that needs fixing** when a file was refused |

`file_type` is always one of three:

| file_type | what it is |
| --- | --- |
| `bom_extract` | BOM - what goes into each product |
| `shelf_life` | Shelf life - how many days a product keeps |
| `cycle_time` | Cycle time - how long one batch takes on one machine, one plant per file |

---

## How they work together

```text
   the user / the screen                                  the tool
 ┌──────────────────────────┐
 │ 1. download the template │ ── GET /ingest/template/cycle_time ──►  sends the .xlsx
 └──────────────────────────┘
              │  fill it in Excel, save it
              ▼
 ┌──────────────────────────┐
 │ 2. upload the file       │ ── POST /ingest/upload ──────────────►  "got it, file 12"
 └──────────────────────────┘                                          (answers at once, works on in the background)
              │
              ▼
 ┌──────────────────────────┐
 │ 3. ask every few seconds │ ── GET /ingest/files/12 ─────────────►  "still checking..."
 │    until done = true     │ ── GET /ingest/files/12 ─────────────►  "done: published"  or  "done: rejected"
 └──────────────────────────┘
              │ rejected?
              ▼
 ┌──────────────────────────┐
 │ 4. show what to fix      │ ── GET /ingest/files/12/rejects ─────►  "row 40, MAX BATCH SIZE: fails rule > 0"
 └──────────────────────────┘
              │  fix the rows in Excel
              └──────────────► upload again (step 2)
```

**Why step 3 exists:** checking and loading a big file can take several seconds (the BOM is the slowest).
Instead of making the user stare at a frozen screen, the upload answers straight away with a file number, and the screen checks back on its own until the file is done.

---

## 1. Download a template

`GET /ingest/template/{file_type}`

**What it is for:** gives the user the correct empty Excel file, so the columns are right from the start.

**What you send:** only the file type in the address, for example `/ingest/template/shelf_life`.

**What you get back:** an `.xlsx` file download with two sheets:

| sheet | what is in it |
| --- | --- |
| **Template** | the header row to fill in. Dark blue columns are required |
| **Guidelines** | what each column means, an example value and the rules it must follow |

**When it says no:**

| answer | meaning |
| --- | --- |
| 404 "file_type not found" | the file type is not one of the three |
| 404 "Template not found" | the template file is missing on the server. Restarting the server creates it again |

---

## 2. Upload a file

`POST /ingest/upload`

**What it is for:** hands a filled Excel file to the tool. The tool keeps a copy, gives it a number and starts checking it.

**What you send** (as a form, the way a browser sends a file):

| field | what to put | example |
| --- | --- | --- |
| `file` | the filled Excel file (.xlsx) | `cycle_time_PSM.xlsx` |
| `file_type` | which of the three files it is | `cycle_time` |
| `uploaded_by` | who is uploading. Spaces around it are removed and it is stored in small letters | `geeta` |

**What you get back** (straight away, code 202 "accepted"):

```json
{
  "file_id": 12,
  "status": "received",
  "poll": "/ingest/files/12"
}
```

This does **not** mean the file is loaded yet. It means "received, now checking". Use the `poll` link (API 3) to follow it.

**When it says no** (the file is not kept):

| answer | meaning | what the user should do |
| --- | --- | --- |
| 400 "No file selected." | no file was attached | choose a file |
| 400 "Not an .xlsx file..." | the file is not a real Excel workbook (an old .xls, a CSV, a renamed file) | open it in Excel, Save As **Excel Workbook (.xlsx)**, upload that |
| 409 "already uploaded as file ..." | this exact same file was uploaded before. The answer also gives that earlier `file_id` | nothing - it is already in, or check the earlier file |
| 422 "uploaded_by is required." | the name was empty | give a name |
| 422 (file type) | the file type is not one of the three | pick the right type |

---

## 3. Check an upload (poll)

`GET /ingest/files/{file_id}`

**What it is for:** answers "where is my file now, and how did it go?". The screen calls it every few seconds after an upload until `done` is `true`.

**What you send:** the `file_id` from the upload answer, for example `/ingest/files/12`.

**What you get back:**

```json
{
  "file_id": 12,
  "file_type": "cycle_time",
  "original_name": "cycle_time_PSM.xlsx",
  "uploaded_by": "geeta",
  "uploaded_at": "2026-09-28T10:15:02",
  "period_key": "PSM - Thervoykandigai MFG",
  "status": "published",
  "step": null,
  "rows_read": 180,
  "rows_deduped": 2,
  "rows_loaded": 178,
  "rows_rejected": 0,
  "error": null,
  "is_current": true,
  "done": true
}
```

**The fields that matter most:**

| field | meaning |
| --- | --- |
| `status` | where the file is (see below) |
| `done` | `true` once the file has finished, one way or the other. Stop asking then |
| `rows_read` | rows found in the Excel sheet |
| `rows_deduped` | exact repeated rows that were dropped (kept once) |
| `rows_loaded` | rows now in the database |
| `rows_rejected` | rows with a problem. Anything above 0 means nothing was loaded |
| `error` | a short summary of what went wrong, in words |
| `is_current` | `true` = this is the file the planning screens are using now |
| `period_key` | for cycle time, the plant this file is for |
| `rejects` | only when rejected: the link to API 4 |

**The status, step by step:**

```text
  received → validating → loading → modeling → published      ✔ loaded and in use
                  │
                  ├──► rejected    ✘ some rows have problems. Nothing loaded. See API 4
                  └──► failed      ✘ the file could not be read or something broke. See "error"
```

| status | what it means for the user | done? |
| --- | --- | --- |
| `received` | the file is in, waiting to start | no |
| `validating` | reading the file and checking every row | no |
| `loading` | saving the rows into the database | no |
| `modeling` | updating the planning data that uses this file | no |
| `published` | **finished and in use** | yes |
| `rejected` | **refused** - some rows must be fixed. The data in use before stays in use | yes |
| `failed` | **could not be processed** - `error` says why (e.g. a column is missing, the file was not saved in Excel, the server restarted mid-upload) | yes |

**When it says no:** 404 "file not found" - there is no upload with that number.

---

## 4. See what to fix

`GET /ingest/files/{file_id}/rejects`

**What it is for:** when a file is `rejected`, lists every problem with its Excel row number and column name, so the user can go straight to the cell and fix it.

**What you send:** the `file_id`, for example `/ingest/files/12/rejects`.

**What you get back:**

```json
{
  "file_id": 12,
  "file_type": "cycle_time",
  "file_name": "cycle_time_PSM.xlsx",
  "status": "rejected",
  "summary": "max_batch_size: fails rule > 0 - 2 rows (row 40, 90)\nplant: required value is missing - 1 rows (row 60)",
  "rows_with_problems": 3,
  "problems_shown": 3,
  "problems": [
    {"row": 40, "column": "MAX BATCH SIZE", "reason": "fails rule > 0", "value": "0"},
    {"row": 60, "column": "Plant", "reason": "required value is missing", "value": null},
    {"row": 90, "column": "MAX BATCH SIZE", "reason": "fails rule > 0", "value": "-5"}
  ]
}
```

| field | meaning |
| --- | --- |
| `summary` | the problems grouped, one line each - good for a heading |
| `rows_with_problems` | how many rows need fixing |
| `problems_shown` | how many problems are listed. At most the first 1,000 are kept |
| `problems[].row` | the **row number as seen in Excel** |
| `problems[].column` | the **column header as seen in Excel** |
| `problems[].reason` | what is wrong |
| `problems[].value` | what was in the cell |

For a file that was published, the list is simply empty.

**When it says no:** 404 "file not found" - there is no upload with that number.

---

## Good to know

- **All or nothing.** One bad row refuses the whole file. Nothing half-loaded ever reaches the planning screens, and the data in use before stays in use.
- **Uploading again replaces.** A new BOM or shelf life file replaces the old one. A cycle time file replaces **only its own plant**. Earlier uploads are kept as history.
- **The same file twice is refused** (409), so nothing is loaded twice by mistake.
- **Refused files are not kept** on the server - only files that were accepted for checking are saved.
- **Save in Excel before uploading.** A file edited by a script or another program may have formulas without their results; the tool refuses it and asks you to open and save it in Excel.
- **A server restart during an upload** marks that upload `failed` with "interrupted". Just upload the file again.
