from sqlalchemy import Column, BigInteger, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


#   Collectors -> MarketCircles -> CustomerSites <- CustomerMasters


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
    customer_id = Column(BigInteger, index=True)          # orders and plans use this, empty for leads
    customer_number = Column(BigInteger, index=True)      # soc pending uses this one
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
    cust_acct_site_id = Column(BigInteger, nullable=False, index=True)          # SaleOrderHdrs.CUST_ACCT_SITE_ID
    status = Column(Text)                                                      
    site_use_id = Column(BigInteger, index=True)          # bill_to_site_id / ship_to_site_id in orders, quotes, plans point here. not unique
    site_use_code = Column(Text)                          # BILL_TO / SHIP_TO
    city = Column(Text)
    state = Column(Text)
    country = Column(Text)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)
    primary_flag = Column(Text)                           

    customer = relationship("CustomerMasters", back_populates="sites")
    market_circle = relationship("MarketCircles", back_populates="sites")
