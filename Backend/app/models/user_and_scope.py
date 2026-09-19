from sqlalchemy import Column, BigInteger, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
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
    role_type_id = Column(BigInteger)                                        # 20 values, no master in crm
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
