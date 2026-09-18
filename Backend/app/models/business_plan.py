from sqlalchemy import Column, BigInteger, Integer, Text, Boolean, Double, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


# the SC (performance chemicals) business plan. one header per customer x product x collector x year
# with the annual numbers, the 13 journey cycle plan sits in the detail tables.
# JourneyCalendars: 13 journey cycles (JC1..JC13) per accounting year, ~4 weeks each, contiguous from 2013-04-01.
#
# plan headers are snapshot (jc status moves every cycle), reloaded in full every run.
# no item_id on the plan - it is keyed on product name + category_id.
#
#   SCBusinessMonthlyPlanHdrs -> SCBusinessMonthlyPlanDtls (13 JC plan, wide) -> SCBusinessMonthlyPlanJCDtls (rolling forecast per JC)
#   SCBusinessMonthlyPlanHdrs / Dtls -> CustomerMasters, Collectors, CustomerSites
#   SCBusinessMonthlyPlanJCDtls.jc_type -> JourneyCalendars


class JourneyCalendars(Base):

    __tablename__ = "JourneyCalendars"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)      # -1 = unknown, for plan rows with jc_type 0
    name = Column(Text, nullable=False)                                      # JC1 .. JC13
    acc_year = Column(Text)                                                  # 2025-2026
    effective_from = Column(Date, nullable=False)                            # first day of the cycle
    effective_to = Column(Date, nullable=False)                              # last day, next cycle starts the day after
    is_active = Column(Boolean, nullable=False)                              # all true today
    is_closed = Column(Boolean)                                              # false or empty today
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)



class SCBusinessMonthlyPlanHdrs(Base):

    __tablename__ = "SCBusinessMonthlyPlanHdrs"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    acc_year = Column(Text, index=True)                                      # 2025-2026, the reliable time key
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), index=True)   # -1 = prospect (crm has 0), see new_customer_name
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)
    bill_to_site_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"), index=True)  # empty on plans from 2024-25 on, crm stopped filling it
    item_description = Column(Text, index=True)                              # product name, no item_id on the plan. maps to one sku only 29% of the time
    category_id = Column(BigInteger, nullable=False)                         # ItemCategories.category_id, not unique there so no fk
    segment2 = Column(Text)                                                  # division
    segment3 = Column(Text)                                                  # category
    segment4 = Column(Text)                                                  # family
    annual_potential_qty = Column(Double, nullable=False)
    annual_potential_value = Column(Double, nullable=False)
    annual_budget_qty = Column(Double, nullable=False)
    annual_budget_value = Column(Double, nullable=False)
    prev_two_yr_qty_achieved = Column(Double, nullable=False)
    prev_two_yr_value_achieved = Column(Double, nullable=False)
    last_yr_avg_sell_price = Column(Double, nullable=False)
    avg_sell_price = Column(Double, nullable=False)
    jc1_status = Column(Integer, nullable=False)                             # 1 .. 6, no master in crm. 1 and 4 cover 96%
    jc2_status = Column(Integer, nullable=False)
    jc3_status = Column(Integer, nullable=False)
    jc4_status = Column(Integer, nullable=False)
    jc5_status = Column(Integer, nullable=False)
    jc6_status = Column(Integer, nullable=False)
    jc7_status = Column(Integer, nullable=False)
    jc8_status = Column(Integer, nullable=False)
    jc9_status = Column(Integer, nullable=False)
    jc10_status = Column(Integer, nullable=False)
    jc11_status = Column(Integer, nullable=False)
    jc12_status = Column(Integer, nullable=False)
    jc13_status = Column(Integer, nullable=False)
    new_customer_name = Column(Text)                                         # prospects only
    new_customer_marketcircle = Column(Text)                                 # prospects only. lower case, 'unknown' when blank or not a circle. soft link
    is_new_customer = Column(Boolean, nullable=False)                        # true exactly when customer_id was 0
    is_key_customer = Column(Boolean, nullable=False)
    is_new_item = Column(Boolean, nullable=False)
    creation_date = Column(DateTime)                                         # empty on 43%, all of 2020-22
    last_update_date = Column(DateTime)                                      # half the rows move after creation (jc status), hence snapshot

    lines = relationship("SCBusinessMonthlyPlanDtls", back_populates="header")
    customer = relationship("CustomerMasters")
    collector = relationship("Collectors")
    bill_to_site = relationship("CustomerSites")



class SCBusinessMonthlyPlanDtls(Base):

    __tablename__ = "SCBusinessMonthlyPlanDtls"

    # the 13 journey cycle plan, stored wide by crm: 7 columns per JC. a third of the rows are exact
    # duplicates and 86% carry no plan at all - load everything (JCDtls points at line_id), dedupe
    # and filter in the views. value columns are user typed in mixed units, use qty x avg price.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)      # SCBusinessMonthlyPlanJCDtls.header_id points here (misnamed in crm)
    header_id = Column(BigInteger, ForeignKey("SCBusinessMonthlyPlanHdrs.header_id"), index=True)
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), index=True)   # 0 on 38% -> -1, prefer the header's customer
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)
    item_description = Column(Text)                                          # same as the header on 99.8%
    category_id = Column(BigInteger, nullable=False)
    # JC1
    jc1_week1_user_dfn_qty = Column(Double, nullable=False)
    jc1_week1_user_dfn_value = Column(Double, nullable=False)
    jc1_week2_user_dfn_qty = Column(Double, nullable=False)
    jc1_week2_user_dfn_value = Column(Double, nullable=False)
    jc1_qty_achieved = Column(Double, nullable=False)
    jc1_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc1_saved = Column(Boolean, nullable=False)
    # JC2
    jc2_week1_user_dfn_qty = Column(Double, nullable=False)
    jc2_week1_user_dfn_value = Column(Double, nullable=False)
    jc2_week2_user_dfn_qty = Column(Double, nullable=False)
    jc2_week2_user_dfn_value = Column(Double, nullable=False)
    jc2_qty_achieved = Column(Double, nullable=False)
    jc2_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc2_saved = Column(Boolean, nullable=False)
    # JC3
    jc3_week1_user_dfn_qty = Column(Double, nullable=False)
    jc3_week1_user_dfn_value = Column(Double, nullable=False)
    jc3_week2_user_dfn_qty = Column(Double, nullable=False)
    jc3_week2_user_dfn_value = Column(Double, nullable=False)
    jc3_qty_achieved = Column(Double, nullable=False)
    jc3_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc3_saved = Column(Boolean, nullable=False)
    # JC4
    jc4_week1_user_dfn_qty = Column(Double, nullable=False)
    jc4_week1_user_dfn_value = Column(Double, nullable=False)
    jc4_week2_user_dfn_qty = Column(Double, nullable=False)
    jc4_week2_user_dfn_value = Column(Double, nullable=False)
    jc4_qty_achieved = Column(Double, nullable=False)
    jc4_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc4_saved = Column(Boolean, nullable=False)
    # JC5
    jc5_week1_user_dfn_qty = Column(Double, nullable=False)
    jc5_week1_user_dfn_value = Column(Double, nullable=False)
    jc5_week2_user_dfn_qty = Column(Double, nullable=False)
    jc5_week2_user_dfn_value = Column(Double, nullable=False)
    jc5_qty_achieved = Column(Double, nullable=False)
    jc5_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc5_saved = Column(Boolean, nullable=False)
    # JC6
    jc6_week1_user_dfn_qty = Column(Double, nullable=False)
    jc6_week1_user_dfn_value = Column(Double, nullable=False)
    jc6_week2_user_dfn_qty = Column(Double, nullable=False)
    jc6_week2_user_dfn_value = Column(Double, nullable=False)
    jc6_qty_achieved = Column(Double, nullable=False)
    jc6_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc6_saved = Column(Boolean, nullable=False)
    # JC7
    jc7_week1_user_dfn_qty = Column(Double, nullable=False)
    jc7_week1_user_dfn_value = Column(Double, nullable=False)
    jc7_week2_user_dfn_qty = Column(Double, nullable=False)
    jc7_week2_user_dfn_value = Column(Double, nullable=False)
    jc7_qty_achieved = Column(Double, nullable=False)
    jc7_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc7_saved = Column(Boolean, nullable=False)
    # JC8
    jc8_week1_user_dfn_qty = Column(Double, nullable=False)
    jc8_week1_user_dfn_value = Column(Double, nullable=False)
    jc8_week2_user_dfn_qty = Column(Double, nullable=False)
    jc8_week2_user_dfn_value = Column(Double, nullable=False)
    jc8_qty_achieved = Column(Double, nullable=False)
    jc8_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc8_saved = Column(Boolean, nullable=False)
    # JC9
    jc9_week1_user_dfn_qty = Column(Double, nullable=False)
    jc9_week1_user_dfn_value = Column(Double, nullable=False)
    jc9_week2_user_dfn_qty = Column(Double, nullable=False)
    jc9_week2_user_dfn_value = Column(Double, nullable=False)
    jc9_qty_achieved = Column(Double, nullable=False)
    jc9_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc9_saved = Column(Boolean, nullable=False)
    # JC10
    jc10_week1_user_dfn_qty = Column(Double, nullable=False)
    jc10_week1_user_dfn_value = Column(Double, nullable=False)
    jc10_week2_user_dfn_qty = Column(Double, nullable=False)
    jc10_week2_user_dfn_value = Column(Double, nullable=False)
    jc10_qty_achieved = Column(Double, nullable=False)
    jc10_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc10_saved = Column(Boolean, nullable=False)
    # JC11
    jc11_week1_user_dfn_qty = Column(Double, nullable=False)
    jc11_week1_user_dfn_value = Column(Double, nullable=False)
    jc11_week2_user_dfn_qty = Column(Double, nullable=False)
    jc11_week2_user_dfn_value = Column(Double, nullable=False)
    jc11_qty_achieved = Column(Double, nullable=False)
    jc11_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc11_saved = Column(Boolean, nullable=False)
    # JC12
    jc12_week1_user_dfn_qty = Column(Double, nullable=False)
    jc12_week1_user_dfn_value = Column(Double, nullable=False)
    jc12_week2_user_dfn_qty = Column(Double, nullable=False)
    jc12_week2_user_dfn_value = Column(Double, nullable=False)
    jc12_qty_achieved = Column(Double, nullable=False)
    jc12_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc12_saved = Column(Boolean, nullable=False)
    # JC13
    jc13_week1_user_dfn_qty = Column(Double, nullable=False)
    jc13_week1_user_dfn_value = Column(Double, nullable=False)
    jc13_week2_user_dfn_qty = Column(Double, nullable=False)
    jc13_week2_user_dfn_value = Column(Double, nullable=False)
    jc13_qty_achieved = Column(Double, nullable=False)
    jc13_user_dfn_avg_sell_price = Column(Double, nullable=False)
    is_jc13_saved = Column(Boolean, nullable=False)
    is_new_customer = Column(Boolean, nullable=False)
    is_key_customer = Column(Boolean, nullable=False)
    is_new_item = Column(Boolean, nullable=False)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # 13% edited after creation, hence snapshot

    header = relationship("SCBusinessMonthlyPlanHdrs", back_populates="lines")
    forecasts = relationship("SCBusinessMonthlyPlanJCDtls", back_populates="plan_line")
    customer = relationship("CustomerMasters")
    collector = relationship("Collectors")



class SCBusinessMonthlyPlanJCDtls(Base):

    __tablename__ = "SCBusinessMonthlyPlanJCDtls"

    # rolling forecast: per plan line and journey cycle, the qty expected in the next one and two
    # months. 87% of rows are all zero, load everything and filter in the views.

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("SCBusinessMonthlyPlanDtls.line_id"), index=True)   # misnamed in crm: it is the plan LINE (Dtls.line_id), not the header
    acc_year = Column(Text, index=True)                                      # 2025-2026. disagrees with the jc's year on 123 rows
    jc_type = Column(BigInteger, ForeignKey("JourneyCalendars.line_id"), index=True)   # the journey cycle. -1 when crm has 0
    jc_nextmonth1_qty = Column(Double, nullable=False)                       # forecast qty, next month
    jc_nextmonth2_qty = Column(Double, nullable=False)                       # forecast qty, month after
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)                                      # 3% edited after creation

    plan_line = relationship("SCBusinessMonthlyPlanDtls", back_populates="forecasts")
    journey_cycle = relationship("JourneyCalendars")
