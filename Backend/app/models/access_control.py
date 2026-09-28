from sqlalchemy import (Column, BigInteger, Integer, Text, Boolean, DateTime, ForeignKey, CheckConstraint,
                        UniqueConstraint, func)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from app.core.database import Base


# tables the TOOL owns for access control - not copies of crm. the admin writes them from the frontend; the
# loader never touches them. every row keeps who did what and when, so the history of a grant can be read back.


class PlaceholderOperator(Base):

    __tablename__ = "placeholder_operator"

    # who actually uses a placeholder login. crm gives a market circle with no sales executive a placeholder
    # account (DUMMY_EX_..), and the technical executive covering that area logs in through it - crm records no
    # link between the two. the admin records it here; the operator then receives the placeholder's customers
    # (v_user_customer_scope, via = 'placeholder they operate'). the placeholder itself never receives scope.
    #
    # ending an assignment sets unassigned_at rather than deleting the row, so it stays auditable.
    # the current operators of a placeholder are the rows with unassigned_at null.

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    placeholder_user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)
    operator_user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)
    assigned_by = Column(Text, nullable=False)                               # the admin who made the assignment
    assigned_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    unassigned_at = Column(DateTime(timezone=True))                          # null = current
    unassigned_by = Column(Text)
    note = Column(Text)                                                      # why this person, e.g. "top lead creator in the circle"

    placeholder = relationship("Users", foreign_keys=[placeholder_user_id])
    operator = relationship("Users", foreign_keys=[operator_user_id])



class PlaceholderDecision(Base):

    __tablename__ = "placeholder_decision"
    __table_args__ = (CheckConstraint("classification IN ('person', 'placeholder')", name="placeholder_decision_classification"),)

    # a human decision that overrides the automatic placeholder rule for one account. crm's own dummy flag is wrong
    # both ways - it misses placeholder logins and is set on some real people - and a name pattern can only guess.
    # when the admin (or the crm team) knows better, it is recorded here and dim_user follows it.
    #
    # withdrawing a decision sets withdrawn_at rather than deleting the row, so the history stays readable.
    # the decision in force for an account is its latest row with withdrawn_at null.

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), nullable=False, index=True)
    classification = Column(Text, nullable=False)                           # person / placeholder
    decided_by = Column(Text, nullable=False)                               # who decided, e.g. the crm team
    decided_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    note = Column(Text)                                                     # why
    withdrawn_at = Column(DateTime(timezone=True))                          # null = in force
    withdrawn_by = Column(Text)

    user = relationship("Users")



# ---------------------------------------------------------------------------------------------------------------
# who may use the tool, and which pages they get. the admin onboards a crm user, gives them one role, and the
# role's default pages follow; pages can then be added or removed for that one person. the data inside a page
# is not granted here: it follows crm (v_user_data_scope), or everything when the role says so.
#
# the tool's users are always crm users, but app_user does NOT carry a foreign key to "Users": a load that
# truncated "Users" with cascade would take every login with it. the api checks the id against crm instead.
# ---------------------------------------------------------------------------------------------------------------

class AppPage(Base):

    __tablename__ = "app_page"

    # the screens of the tool, keyed by the code the frontend uses (mydash, supply, usermaster ..). seeded by
    # app/repositories/access_seed.py. a page is retired with is_active, never deleted, so old grants still read.

    page_code = Column(Text, primary_key=True)
    name = Column(Text, nullable=False)
    section = Column(Text, nullable=False)                                   # the nav group: supply planning, samples, admin ..
    sort_order = Column(Integer, nullable=False)
    is_admin_page = Column(Boolean, nullable=False, server_default="false")  # role master, user master, settings
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())



class AppRole(Base):

    __tablename__ = "app_role"
    __table_args__ = (CheckConstraint("data_access IN ('own', 'all')", name="app_role_data_access"),)

    # a role in the tool: a default set of pages, plus how much data its users see. not crm's roles - the admin
    # keeps a few of these and fits individuals with page changes, instead of inventing a role per person.
    #
    # data_access  own = the rows crm ties to the user (their customers, warehouses, product segments)
    #              all = every row on the pages they have

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    code = Column(Text, nullable=False, unique=True)
    name = Column(Text, nullable=False)
    description = Column(Text)
    data_access = Column(Text, nullable=False, server_default="own")
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_by = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_by = Column(Text)
    updated_at = Column(DateTime(timezone=True))

    pages = relationship("AppRolePage", back_populates="role")



class AppRolePage(Base):

    __tablename__ = "app_role_page"
    __table_args__ = (UniqueConstraint("role_id", "page_code"),)

    # the default pages of a role. can_edit false = the page opens read-only.

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    role_id = Column(BigInteger, ForeignKey("app_role.id", ondelete="CASCADE"), nullable=False, index=True)
    page_code = Column(Text, ForeignKey("app_page.page_code"), nullable=False)
    can_edit = Column(Boolean, nullable=False, server_default="false")
    created_by = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    role = relationship("AppRole", back_populates="pages")
    page = relationship("AppPage")



class AppUser(Base):

    __tablename__ = "app_user"
    __table_args__ = (CheckConstraint("data_access_override IS NULL OR data_access_override IN ('own', 'all')",
                                      name="app_user_data_access_override"),)

    # a crm user the admin has onboarded. the admin issues a temporary password and the user must replace it at
    # the first login (must_change_password). switching is_active off blocks the login and keeps the history.

    user_id = Column(BigInteger, primary_key=True, autoincrement=False)      # crm "Users".line_id - soft, see above
    username = Column(Text, nullable=False, unique=True)                     # crm's login name
    password_hash = Column(Text)                                             # never the password itself. null until one is issued
    must_change_password = Column(Boolean, nullable=False, server_default="true")
    password_changed_at = Column(DateTime(timezone=True))
    role_id = Column(BigInteger, ForeignKey("app_role.id"), index=True)      # null until the admin assigns one = no pages
    data_access_override = Column(Text)                                      # own / all for this person only. null = the role's
    is_active = Column(Boolean, nullable=False, server_default="true")
    onboarded_by = Column(Text, nullable=False)
    onboarded_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_by = Column(Text)
    updated_at = Column(DateTime(timezone=True))
    last_login_at = Column(DateTime(timezone=True))

    role = relationship("AppRole")
    page_changes = relationship("AppUserPage", back_populates="user")



class AppUserPage(Base):

    __tablename__ = "app_user_page"
    __table_args__ = (UniqueConstraint("user_id", "page_code"),
                      CheckConstraint("effect IN ('add', 'remove')", name="app_user_page_effect"))

    # one person's change to their role's pages: add a page the role lacks (or change its can_edit), or remove
    # one it has. their pages = the role's pages + adds - removes (v_user_page_access).

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("app_user.user_id", ondelete="CASCADE"), nullable=False, index=True)
    page_code = Column(Text, ForeignKey("app_page.page_code"), nullable=False)
    effect = Column(Text, nullable=False)
    can_edit = Column(Boolean, nullable=False, server_default="false")       # used with add
    note = Column(Text)
    created_by = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    user = relationship("AppUser", back_populates="page_changes")
    page = relationship("AppPage")



class AppAuditLog(Base):

    __tablename__ = "app_audit_log"

    # every admin action and password event, written by the api: onboarded, role changed, page added, page
    # removed, password issued, password changed, deactivated .. the tables above hold the current state; this
    # holds how it got there. rows are only ever added.

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    actor = Column(Text, nullable=False)                                     # who did it: the admin, or the user themself
    action = Column(Text, nullable=False)
    user_id = Column(BigInteger, index=True)                                 # the person it was done to
    role_id = Column(BigInteger)
    page_code = Column(Text)
    detail = Column(JSONB)                                                   # before / after values

