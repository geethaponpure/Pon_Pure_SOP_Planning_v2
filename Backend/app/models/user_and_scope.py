from sqlalchemy import Column, BigInteger, Integer, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.database import Base


# Users: everyone with a crm login, 1,370 rows. the hub every scope mapping points at. the auth columns
# (password, otp, tokens) are never loaded. upsert.
# Roles: job roles (Sales Executive, Branch Manager ..), 108 rows. upsert.
# UserRoles: one role per user, a 1:1 bridge. rows get deleted, so snapshot.
# UserMarketCircleMappings: a sales executive's territory, with validity periods (history kept). snapshot.
# UserCollectorMappings: which branches a back office user may see, no dates. snapshot.
# UserCustomerMappings: a technical executive's customer portfolio. snapshot.
# CollectorMailMappings: one row per branch with its management chain (bm / rm / cm / bc / ed / gm). snapshot.
# TechnicalUserSegmentMappings: technical managers / heads -> item segments (text) and branch lists (text). snapshot.
#
#   Users -> Users               (reporting_to_id, the manager. null on 368)
#   UserRoles -> Users, Roles
#   UserMarketCircleMappings -> Users, MarketCircles
#   UserCollectorMappings -> Users, Collectors
#   UserCustomerMappings -> Users, CustomerMasters (header_id)
#   CollectorMailMappings -> Collectors, Users x6
#   TechnicalUserSegmentMappings -> Users x2, Roles.  segments and collector list are soft (text)


class Users(Base):

    __tablename__ = "Users"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)      # deleted users leave gaps, we keep our copy for history
    name = Column(Text)                                                      # always filled. first / last name are not, so this is the one
    username = Column(Text, index=True)                                      # the login. unique but for one dummy (DUMBMMAR, one active one not)
    email = Column(Text)                                                     # filled on 952, a few shared mailboxes
    user_code = Column(Text)                                                 # employee code, not unique (260 rows share one)
    designation = Column(Text)                                               # Executive / Manager .. null on 381
    department = Column(Text)                                                # Sales / Warehouse / Accounts .. null on 376
    reporting_to_id = Column(BigInteger, ForeignKey("Users.line_id"), index=True)   # the manager. null when crm has 0 or the manager is gone
    is_active = Column(Boolean)                                              # 1,217 active
    is_dummy = Column(Boolean)                                               # 163 placeholder users (DUMMY_EX_..). null = real user
    is_international = Column(Boolean)                                       # 17
    last_logged_in_date = Column(DateTime)                                   # null on 806, who actually uses crm
    creation_date = Column(DateTime)                                         # null on 34
    last_update_date = Column(DateTime)

    manager = relationship("Users", remote_side=[line_id])
    role_link = relationship("UserRoles", back_populates="user", uselist=False)



class Roles(Base):

    __tablename__ = "Roles"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    name = Column(Text)                                                      # Sales Executive / Technical Executive / Branch Manager .. unique
    is_prime = Column(Boolean)                                               # 64
    is_active = Column(Boolean)                                              # all 108
    is_deleted = Column(Boolean)                                             # 1 (SS Quote), still on 7 users. loaded, not filtered
    role_type_id = Column(BigInteger)                                        # -> RoleTypes.line_id (All Access / Senior Management / Sales ..), 100%. soft: both load at level 0
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    users = relationship("UserRoles", back_populates="role")



class UserRoles(Base):

    __tablename__ = "UserRoles"
    __table_args__ = (UniqueConstraint("user_id"),)                         # one role per user. a second one would be deduped on stage, latest wins

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False)               # 100% match. row dropped if ever missing
    role_id = Column(BigInteger, ForeignKey("Roles.line_id"), nullable=False, index=True)   # 100% match. row dropped if ever missing
    is_sap_data = Column(Boolean)                                            # 330 true, the role came from the sap sync
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # 110 role changes on record

    user = relationship("Users", back_populates="role_link")
    role = relationship("Roles", back_populates="users")



class UserMarketCircleMappings(Base):

    __tablename__ = "UserMarketCircleMappings"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)                  # 100% match. row dropped if ever missing
    market_circle_id = Column(BigInteger, ForeignKey("MarketCircles.header_id"), nullable=False, index=True)   # 100% match. row dropped if ever missing
    valid_from = Column(DateTime)                                            # always filled
    valid_to = Column(DateTime)                                              # null = current (237). a user re-assigned to the same circle gets a new row, the old one closed
    is_primary = Column(Boolean)                                             # 245 true
    cross_marketcircle_segmentaccess_flag = Column(Boolean)                  # crm's scope rule reads it: a sales executive with it set sees every circle of their branch. false on all today
    creation_date = Column(DateTime)                                         # null on 145
    last_update_date = Column(DateTime)

    user = relationship("Users")
    circle = relationship("MarketCircles")



class UserCollectorMappings(Base):

    __tablename__ = "UserCollectorMappings"
    __table_args__ = (UniqueConstraint("user_id", "collector_id"),)          # crm holds the same pair up to 48 times, copies dropped on stage

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)              # 100% match. row dropped if ever missing
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), nullable=False, index=True)   # 100% match. row dropped if ever missing
    creation_date = Column(DateTime)                                         # null on 2,190
    last_update_date = Column(DateTime)                                      # null on 1,689

    user = relationship("Users")
    collector = relationship("Collectors")



class UserCustomerMappings(Base):

    __tablename__ = "UserCustomerMappings"
    __table_args__ = (UniqueConstraint("user_id", "customer_hdr_id"),)       # 336 re-inserted copies dropped on stage

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)                 # 83 of 101 are Technical Executives. row dropped if the user is gone (120 rows, 2 users)
    customer_hdr_id = Column(BigInteger, ForeignKey("CustomerMasters.header_id"), nullable=False, index=True)   # the real link. crm's customer_id column is stale on 400 rows and not loaded
    valid_from = Column(DateTime)                                            # always filled
    valid_to = Column(DateTime)                                              # null = current (all but 125)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # null on 11,156

    user = relationship("Users")
    customer = relationship("CustomerMasters")



class CollectorMailMappings(Base):

    __tablename__ = "CollectorMailMappings"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), nullable=False, unique=True)   # one row per branch, all 129
    bm_user_id = Column(BigInteger, ForeignKey("Users.line_id"))             # branch manager, 70 filled
    rm_user_id = Column(BigInteger, ForeignKey("Users.line_id"))             # regional manager, 84
    cm_user_id = Column(BigInteger, ForeignKey("Users.line_id"))             # 94, 22 people
    bc_user_id = Column(BigInteger, ForeignKey("Users.line_id"))             # 104, 8 people
    ed_user_id = Column(BigInteger, ForeignKey("Users.line_id"))             # executive director, 95, 2 people
    gm_user_id = Column(BigInteger, ForeignKey("Users.line_id"))             # 76, 11 people
    coordinator_user_id = Column(Text)                                       # text in crm: a single user id (71) or a comma list (25). split in views
    division = Column(Text)                                                  # '1' / '2', a few '0' / null
    sp_workflow_req = Column(Boolean)                                        # 16
    commitmentenableflag = Column(Text)                                      # 'Y' on 85, else null
    commitmenteffectivedate = Column(DateTime)
    holdremovalweekno = Column(BigInteger)                                   # 1 .. 4

    collector = relationship("Collectors")
    bm = relationship("Users", foreign_keys=[bm_user_id])
    rm = relationship("Users", foreign_keys=[rm_user_id])
    cm = relationship("Users", foreign_keys=[cm_user_id])
    bc = relationship("Users", foreign_keys=[bc_user_id])
    ed = relationship("Users", foreign_keys=[ed_user_id])
    gm = relationship("Users", foreign_keys=[gm_user_id])



class TechnicalUserSegmentMappings(Base):

    __tablename__ = "TechnicalUserSegmentMappings"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    segment2 = Column(Text)                                                  # ItemCategories.segment2, matches 100%. text, soft link
    segment3 = Column(Text)                                                  # ItemCategories.segment3, matches 100%
    segment4 = Column(Text)                                                  # ItemCategories.segment4, filled on 285, 283 match
    collector_id = Column(Text)                                              # text in crm: a comma list of collectors (167), a single id (96), '0' (14) or null (51). split in views
    role_id = Column(BigInteger, ForeignKey("Roles.line_id"), nullable=False)               # Technical Manager (278) / Technical Head (50)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)    # 72 users, up to 35 rows each
    reporting_user_id = Column(BigInteger, ForeignKey("Users.line_id"))      # 100% match today, null if ever gone
    valid_to = Column(DateTime)                                              # null = current (254)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # null on 121

    role = relationship("Roles")
    user = relationship("Users", foreign_keys=[user_id])
    reports_to = relationship("Users", foreign_keys=[reporting_user_id])



# ---------------------------------------------------------------------------------------------------------------
# role configuration: how crm decides what a role may see and do. the rules themselves live in crm's code
# (Fn_CD_GetMarketCircleList and friends); these tables are what that code reads.
# ---------------------------------------------------------------------------------------------------------------

class RoleTypes(Base):

    __tablename__ = "RoleTypes"

    # the family a role belongs to: All Access / Senior Management / Sales .. 20 rows. Roles.role_type_id points here.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    name = Column(Text)
    description = Column(Text)
    hierarchy_id = Column(Integer)
    is_prime = Column(Boolean)
    is_active = Column(Boolean)
    is_deleted = Column(Boolean)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)



class RoleConfigs(Base):

    __tablename__ = "RoleConfigs"

    # which scope rule crm applies to a role: User / Collector / Market Circle / All Collector. only 31 of 108 roles
    # are configured; crm's code gives every other role everything. "All Collecto" is a typo of "All Collector"
    # (same config_type_id 4) - use config_type_id, not the name.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    role_id = Column(BigInteger, ForeignKey("Roles.line_id"), nullable=False, index=True)   # 100%
    role_name = Column(Text)
    config_type_id = Column(BigInteger)                                      # 1 User / 2 Collector / 3 Market Circle / 4 All Collector
    type_name = Column(Text)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    role = relationship("Roles")



class RoleHierarchies(Base):

    __tablename__ = "RoleHierarchies"

    # where a role sits in crm's ladder (Admin, CMD, Executive Director ..), 89 rows.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    name = Column(Text)
    description = Column(Text)
    hierarchy_id = Column(Integer)                                           # the rung. lower = more senior
    role_id = Column(BigInteger, ForeignKey("Roles.line_id"), nullable=False, index=True)   # 100%
    is_prime = Column(Boolean)
    is_active = Column(Boolean)
    is_deleted = Column(Boolean)
    division_id = Column(BigInteger)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    role = relationship("Roles")



# ---------------------------------------------------------------------------------------------------------------
# permissions (crm calls them claims). a user holds a claim when their ROLE has it and they are not excluded,
# or when they are individually included:  (RoleClaims AND NOT UserClaims.is_exclude) OR UserClaims.is_include.
# most people get a permission through their role - read UserClaims alone and you miss nearly all of them.
# ---------------------------------------------------------------------------------------------------------------

class Claims(Base):

    __tablename__ = "Claims"

    # every permission crm knows, 297: Manage PC Business Plan BM / View PCBusinessPlan / Manage Planner Approval ..

    line_id = Column(Integer, primary_key=True, autoincrement=False)
    name = Column(Text)
    description = Column(Text)
    is_active = Column(Boolean)
    group_identifier = Column(Text)



class RoleClaims(Base):

    __tablename__ = "RoleClaims"
    __table_args__ = (UniqueConstraint("role_id", "claim_id"),)

    # the permissions a role carries, 995 rows. the main source of a user's permissions.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    role_id = Column(BigInteger, ForeignKey("Roles.line_id"), nullable=False, index=True)
    claim_id = Column(Integer, ForeignKey("Claims.line_id"), nullable=False, index=True)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    role = relationship("Roles")
    claim = relationship("Claims")



class UserClaims(Base):

    __tablename__ = "UserClaims"
    __table_args__ = (UniqueConstraint("user_id", "claim_id"),)              # 4 pairs repeat in crm; the latest setting is kept on stage

    # a user's individual exceptions to their role: is_include grants a claim the role lacks, is_exclude takes
    # away one the role gives. 3,320 rows, 539 of them exclusions.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)
    claim_id = Column(Integer, ForeignKey("Claims.line_id"), nullable=False, index=True)
    is_include = Column(Boolean)
    is_exclude = Column(Boolean)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    user = relationship("Users")
    claim = relationship("Claims")



# ---------------------------------------------------------------------------------------------------------------
# more data-scope mappings
# ---------------------------------------------------------------------------------------------------------------

class TechnicalExecutiveSegmentMappings(Base):

    __tablename__ = "TechnicalExecutiveSegmentMappings"

    # the product categories a technical executive covers, 1,025 rows / 99 users. their scope in crm is these
    # categories AND their customers (UserCustomerMappings). category_id is an item category, shared by many
    # items, so a soft link to ItemCategories. rows of users crm has deleted are dropped on stage.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)
    category_id = Column(BigInteger, index=True)                             # ItemCategories.category_id, soft
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    user = relationship("Users")



class UserInventoryOrgMappings(Base):

    __tablename__ = "UserInventoryOrgMappings"
    __table_args__ = (UniqueConstraint("user_id", "inventory_org_id"),)      # 58 repeated pairs in crm, the first kept on stage

    # the warehouses a user works with - the supply side's scope (warehouse, planning, accounts). 3,389 rows / 170 users.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)
    inventory_org_id = Column(BigInteger, ForeignKey("InventoryOrgs.inventory_org_id"), nullable=False, index=True)   # 4 rows name a warehouse not in the master, dropped
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    user = relationship("Users")
    warehouse = relationship("InventoryOrgs")



class HolidayUserCollectorMappings(Base):

    __tablename__ = "HolidayUserCollectorMappings"

    # despite the name, the direct branch mapping for technical executives, managers and heads. 222 rows, all current.

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), nullable=False, index=True)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)
    valit_to = Column(DateTime)                                              # crm's spelling of valid_to. null = current (all today)

    user = relationship("Users")
    collector = relationship("Collectors")



# ---------------------------------------------------------------------------------------------------------------
# the business / division head chain: who heads each division, and who receives each segment's approvals.
# ---------------------------------------------------------------------------------------------------------------

class SpAlertSegmentWorkflowHdrs(Base):

    __tablename__ = "SpAlertSegmentWorkflowHdrs"

    # one row per division (segment2) with its division head, 15 rows. crm spells division "divition".

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    segment2 = Column(Text)                                                  # the division, e.g. Textile & Paper Division
    divition_head_id = Column(BigInteger, ForeignKey("Users.line_id"), index=True)   # the division head, 100%
    divition_head_name = Column(Text)
    divition_head_mail_id = Column(Text)
    hdr_project_approvl_req = Column(Text)                                   # Yes / No
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    head = relationship("Users")
    details = relationship("SpAlertSegmentWorkflowDtls", back_populates="header")



class SpAlertSegmentWorkflowDtls(Base):

    __tablename__ = "SpAlertSegmentWorkflowDtls"

    # per division: which segment and branches go to which approver (the business head), and for which modules.
    # 87 rows. the branch list and the module list are comma-separated text - split in views.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("SpAlertSegmentWorkflowHdrs.header_id"), nullable=False, index=True)
    segment3 = Column(Text)
    segment4 = Column(Text)
    collector = Column(Text)                                                 # branch NAMES, comma list
    collector_id = Column(Text)                                              # branch ids, comma list. the one to use
    receiver_id = Column(BigInteger, ForeignKey("Users.line_id"), index=True)   # the approver. null where crm names a user it no longer has (10)
    receiver_name = Column(Text)
    receiver_mail_id = Column(Text)
    project_approval_req = Column(Text)                                      # YES / NO per approval kind
    alert_req = Column(Text)
    rma_approval_req = Column(Text)
    purchaserequest = Column(Text)
    quote_approval_req = Column(Text)
    businessplan_approval_req = Column(Text)
    approval_req_module = Column(Text)                                       # module ids, comma list
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    header = relationship("SpAlertSegmentWorkflowHdrs", back_populates="details")
    receiver = relationship("Users")
