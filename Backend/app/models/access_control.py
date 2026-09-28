from sqlalchemy import Column, BigInteger, Text, DateTime, ForeignKey, CheckConstraint, func
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

