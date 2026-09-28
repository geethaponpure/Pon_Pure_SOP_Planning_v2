"""The tool's pages and starter roles.

Run by the api at start, after the views. It only ever ADDS what is missing:
  - a page in PAGES that app_page does not have yet is inserted; existing pages are left as they are.
  - a starter role in ROLES that app_role does not have yet is inserted together with its default pages.
    A role that already exists is not touched - once seeded, roles and their pages belong to the admin, and
    a page the admin removed from a role is never put back here.

A page is added to the tool by adding it to PAGES (and to the roles that should have it by default).
"""

from sqlalchemy import text

SEEDED_BY = "seed"

# (page_code, name, section, is_admin_page) - codes are the frontend's nav keys, in nav order
PAGES = [
    ("mydash",          "My Dashboard",                "home",            False),
    ("supplypos",       "My Supply Position",          "supply planning", False),
    ("supply",          "Supply & RM Plan",            "supply planning", False),
    ("supplycards",     "RM Plan — Data",              "supply planning", False),
    ("mfgstock",        "MFG Org Stock",               "supply planning", False),
    ("vooki",           "Vooki Planning",              "supply planning", False),
    ("adhoc",           "Adhoc Planning",              "supply planning", False),
    ("agedrm",          "Aged RM → FG",                "supply planning", False),
    ("msl",             "MSL (Min Stock Level)",       "supply planning", False),
    ("projsales",       "Projection vs Sales",         "demand",          False),
    ("projaccuracy",    "Projection Accuracy",         "demand",          False),
    ("rd-samples",      "R&D Sample Requests",         "samples",         False),
    ("wh-dispatch",     "Warehouse Sample Dispatch",   "samples",         False),
    ("qc-samples",      "QC for R&D Sample",           "samples",         False),
    ("srdms",           "Sample Req & Dispatch",       "samples",         True),
    ("scorecard",       "Supplier Scorecard",          "purchase",        False),
    ("ppv",             "Purchase Price Variance",     "purchase",        False),
    ("prodsched",       "Production Scheduling",       "production",      False),
    ("receipt",         "Item Receipt Schedule",       "production",      False),
    ("planningsetting", "Planning Setting",            "admin",           True),
    ("roles",           "Role Master",                 "admin",           True),
    ("usermaster",      "User Master",                 "admin",           True),
]

ALL_PAGES = [p[0] for p in PAGES]
EVERYDAY_PAGES = [p[0] for p in PAGES if not p[3]]

# code -> (name, description, data_access, {page_code: can_edit})
ROLES = {
    "admin": ("Admin", "Runs the tool: every page, every row.", "all",
              {p: True for p in ALL_PAGES}),
    "planner": ("Planner", "Plans supply, raw material and production.", "all",
                {"mydash": True, "supplypos": True, "supply": True, "supplycards": True, "mfgstock": True,
                 "vooki": True, "adhoc": True, "agedrm": True, "msl": True, "prodsched": True, "receipt": True,
                 "projsales": False, "projaccuracy": False}),
    "purchase": ("Purchase", "Buys: receipts, suppliers and prices.", "all",
                 {"mydash": True, "receipt": True, "scorecard": True, "ppv": True,
                  "supply": False, "supplycards": False}),
    "sales": ("Sales", "Sales and technical staff: their own customers' supply and projections.", "own",
              {"mydash": True, "supplypos": False, "projsales": True, "projaccuracy": False, "rd-samples": True}),
    "management": ("Management", "Reads every everyday page.", "all",
                   {p: False for p in EVERYDAY_PAGES}),
    "rnd": ("R&D", "Raises sample requests.", "all", {"mydash": True, "rd-samples": True}),
    "qc": ("Quality", "Checks R&D samples.", "all", {"mydash": True, "qc-samples": True}),
    "warehouse": ("Warehouse", "Dispatches samples, sees stock of their own warehouses.", "own",
                  {"mydash": True, "wh-dispatch": True, "mfgstock": False}),
}


async def seed_access(conn):
    """Add the pages and starter roles that are missing. Never updates or removes anything."""

    for order, (code, name, section, is_admin) in enumerate(PAGES, start=1):
        await conn.execute(text("""
            INSERT INTO app_page (page_code, name, section, sort_order, is_admin_page)
            VALUES (:code, :name, :section, :order, :is_admin)
            ON CONFLICT (page_code) DO NOTHING"""),
            {"code": code, "name": name, "section": section, "order": order, "is_admin": is_admin})

    for code, (name, description, data_access, pages) in ROLES.items():
        role_id = (await conn.execute(text("""
            INSERT INTO app_role (code, name, description, data_access, created_by)
            VALUES (:code, :name, :description, :data_access, :by)
            ON CONFLICT (code) DO NOTHING
            RETURNING id"""),
            {"code": code, "name": name, "description": description, "data_access": data_access,
             "by": SEEDED_BY})).scalar()

        if role_id is None:          # the role exists already: the admin owns it now
            continue

        for page_code, can_edit in pages.items():
            await conn.execute(text("""
                INSERT INTO app_role_page (role_id, page_code, can_edit, created_by)
                VALUES (:role_id, :page_code, :can_edit, :by)"""),
                {"role_id": role_id, "page_code": page_code, "can_edit": can_edit, "by": SEEDED_BY})

        await conn.execute(text("""
            INSERT INTO app_audit_log (actor, action, role_id, detail)
            VALUES (:by, 'role seeded', :role_id, CAST(:detail AS jsonb))"""),
            {"by": SEEDED_BY, "role_id": role_id,
             "detail": '{"pages": %d, "data_access": "%s"}' % (len(pages), data_access)})
