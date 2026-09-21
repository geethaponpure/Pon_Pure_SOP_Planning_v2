from sqlalchemy import Column, BigInteger, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.core.database import Base


#   Collectors -> MarketCircles -> CustomerSites <- CustomerMasters
#   CustomerSites -> Collectors            (the site's own branch, set on bill-to sites. crm's customer -> branch rule reads this)
#   tempcustomers -> CustomerMasters, Collectors, MarketCircles   (the lead's details: branch, circle, segment. leads have no sites)
#   ArCustomers -> CustomerMasters         (oracle's customer record: legal form, industrial segment, division, oracle circle)


class Collectors(Base):

    __tablename__ = "Collectors"

    collector_id = Column(BigInteger, primary_key=True, autoincrement=False)
    name = Column(Text)                                   
    status = Column(Text)                                 
    isoverseascollector = Column(Boolean)                 
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)
    isgroupcompanycollector = Column(Boolean)             

    market_circles = relationship("MarketCircles", back_populates="collector")



class MarketCircles(Base):

    __tablename__ = "MarketCircles"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)     # -1 is the 'unknown' row
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)   # nullable so the unknown row can exist
    mc_code = Column(Text, unique=True)                   
    code = Column(Text)                                   
    region = Column(Text)                                 
    is_active = Column(Boolean)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    collector = relationship("Collectors", back_populates="market_circles")
    sites = relationship("CustomerSites", back_populates="market_circle")



class CustomerMasters(Base):

    __tablename__ = "CustomerMasters"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    customer_id = Column(BigInteger, unique=True)         # orders and plans use this, empty for leads. -1 = unknown
    customer_number = Column(BigInteger, unique=True)     # soc pending uses this one
    customer_name = Column(Text)
    customergroup = Column(Text)                          # parent company
    status = Column(Text)                                 
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    sites = relationship("CustomerSites", back_populates="customer")



class CustomerSites(Base):

    __tablename__ = "CustomerSites"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("CustomerMasters.header_id"), nullable=False, index=True)
    mc_code = Column(Text, ForeignKey("MarketCircles.mc_code"), index=True)    # etl sets 'unknown' when no match
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)   # the site's own branch, set on bill-to sites, null on ship-to. crm's customer -> branch rule uses this, not the circle's branch. 13085 = OBSOLETE, a parking branch for retired sites
    cust_acct_site_id = Column(BigInteger, nullable=False, index=True)          # SaleOrderHdrs.CUST_ACCT_SITE_ID
    status = Column(Text)                                                      
    site_use_id = Column(BigInteger, unique=True)         # bill_to_site_id / ship_to_site_id in orders, quotes, plans point here. -1 = unknown
    site_use_code = Column(Text)                          # BILL_TO / SHIP_TO
    city = Column(Text)
    state = Column(Text)
    country = Column(Text)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)
    primary_flag = Column(Text)                           

    customer = relationship("CustomerMasters", back_populates="sites")
    market_circle = relationship("MarketCircles", back_populates="sites")
    collector = relationship("Collectors")



class TempCustomers(Base):
    """the lead's details. a lead is a CustomerMasters row with no oracle customer_id and no sites: its
    branch, circle, segment and address live here instead. crm's customer -> branch rule reads this for leads."""

    __tablename__ = "tempcustomers"
    __table_args__ = (UniqueConstraint("header_id"),)                        # 27 leads have two rows, the later one is kept on stage

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("CustomerMasters.header_id"), nullable=False)   # the lead. rows for deleted leads are dropped on stage
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)       # the lead's branch. null when crm has 0
    market_circle = Column(Text, ForeignKey("MarketCircles.mc_code"), index=True)   # the lead's circle, lower / trim like mc_code everywhere. 'unknown' when blank
    industry_segment = Column(Text)                                          # ENGINEERING INDUSTRY / PHARMA / PAINT & COATINGS .. blank on some
    business_type = Column(Text)                                             # PRIVATE LIMITED / SOLE PROPRIETORSHIP ..
    city = Column(Text)
    state = Column(Text)
    country = Column(Text)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    customer = relationship("CustomerMasters")
    collector = relationship("Collectors")
    market_circle_ref = relationship("MarketCircles")



class ArCustomers(Base):
    """oracle's customer record, one per real customer (every CustomerMasters row with an oracle id has one).
    the customer level classification lives here: legal form, industrial segment, division, and the
    circle oracle holds for the customer."""

    __tablename__ = "ArCustomers"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), nullable=False, unique=True)   # 100% match
    customer_class_code = Column(Text)                                       # legal form: SOLE PROPRIETORSHIP / PRIVATE LIMITED / PARTNERSHIP .. null on 14%
    customer_type = Column(Text)                                             # R = regular, I = internal (9 rows)
    attribute2 = Column(Text)                                                # the market circle oracle holds for the customer, upper case (ECO1, TEL01 ..)
    attribute4 = Column(Text)                                                # industrial segment: TRADER / PAINT & COATINGS / TEXTILE / PHARMA / PACKAGING .. null on 9%
    attribute6 = Column(Text)                                                # division: General Chemicals / Performance Chemicals / NPD / Packing Materials
    status = Column(Text)                                                    # A / I
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    customer = relationship("CustomerMasters")
