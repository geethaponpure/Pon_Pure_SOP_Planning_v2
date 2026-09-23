from sqlalchemy import func, Column, BigInteger, Integer, Text, Boolean, Double, Numeric, Date, DateTime, ForeignKey
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
#   SPBusinessPlanActualSales -> Collectors, CustomerMasters   (crm's own actuals: oracle invoice qty per jc, by product NAME)
#   SCBusinessPlanProjections -> Collectors, ItemMasters       (the approved projection per branch x product name x jc)
#   SCLeadTargets -> ItemMasters / TempItemmasters             (the LEAD plan, by item id; branch and customer via LeadDetails)
#   SCLeadTargetJcDtls -> SCLeadTargets, JourneyCalendars
#   FinancialYears                                             (the accounting years)
#   LeadDetails -> CustomerMasters, Collectors, MarketCircles, Users, CustomerSites, Reasons   (the leads)
#   LeadProducts -> LeadDetails, ItemMasters / TempItemmasters (what a lead is about, crm's open-lead qty)


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



class JcWeeklyCalendars(Base):
    """the four weeks of every journey cycle. crm runs the planning windows on these weeks: a cycle's plan is
    entered during weeks 2 and 3 of the previous cycle, handed to the planners on the first day of week 4 and
    pushed to oracle on the cycle's last day. weeks run sunday to saturday; the first week of JC1 and the last
    of JC13 are short or long so the year fits."""

    __tablename__ = "JcWeeklyCalendars"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    jcno = Column(Integer, nullable=False, index=True)                       # the cycle number 1 .. 13 (not the calendar id)
    weekno = Column(Integer, nullable=False)                                 # 1 .. 4
    week_period_from = Column(Date, nullable=False)
    week_period_to = Column(Date, nullable=False)
    acc_yr = Column(Text, nullable=False, index=True)                        # 2026-2027, matches JourneyCalendars.acc_year
    created_by = Column(BigInteger)
    creation_date = Column(DateTime)
    last_updated_by = Column(BigInteger)
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
    jc1_status = Column(Integer, nullable=False)                             # 1 .. 6, no master in crm. 4 = approved up to 2024-25, 5 from 2025-26 (4 = waiting)
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



class SPBusinessPlanActualSales(Base):
    """the actual sales crm compares the plan against: oracle invoice quantity and value per journey cycle,
    one row per year x branch x customer x product NAME. written by SP_SPDivisionOraSyncCurrentYrSalesData,
    header ids regenerated every sync, so snapshot. SP_PCProjectionReport reads this, not the dispatches."""

    __tablename__ = "SPBusinessPlanActualSales"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    accyear = Column(Text, nullable=False, index=True)                       # 2026-2027
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), nullable=False, index=True)   # 100% match
    customer_id = Column(BigInteger, ForeignKey("CustomerMasters.customer_id"), nullable=False, index=True)  # 100% match
    customer_number = Column(Text)
    itemdescription = Column(Text, nullable=False, index=True)              # the product NAME, the plan's key. 99% match an ItemMasters name
    quantity = Column(Double)                                                # year total, equals the sum of the 13 jc quantities
    jc1_qty = Column(Double)            # quantity invoiced in JC1 .. JC13 of that year
    jc2_qty = Column(Double)            
    jc3_qty = Column(Double)            
    jc4_qty = Column(Double)            
    jc5_qty = Column(Double)            
    jc6_qty = Column(Double)            
    jc7_qty = Column(Double)            
    jc8_qty = Column(Double)            
    jc9_qty = Column(Double)            
    jc10_qty = Column(Double)           
    jc11_qty = Column(Double)           
    jc12_qty = Column(Double)           
    jc13_qty = Column(Double)           
    jc1_value = Column(Double)          # value invoiced per jc
    jc2_value = Column(Double)          
    jc3_value = Column(Double)          
    jc4_value = Column(Double)          
    jc5_value = Column(Double)          
    jc6_value = Column(Double)          
    jc7_value = Column(Double)          
    jc8_value = Column(Double)          
    jc9_value = Column(Double)          
    jc10_value = Column(Double)         
    jc11_value = Column(Double)         
    jc12_value = Column(Double)         
    jc13_value = Column(Double)         
    total_value = Column(Double)
    generate_date = Column(DateTime)                                         # when crm generated the row

    collector = relationship("Collectors")
    customer = relationship("CustomerMasters")



class SCBusinessPlanProjections(Base):
    """the approved projection: per year x branch x product name, two components per journey cycle
    (projection1 / projection2), type PC or Lead. this is what SP_PCBusinessPlan_Projection_SyncToOracle pushes
    to oracle. rows are edited in place, so snapshot. item_id is 0 on most rows - the product is the name."""

    __tablename__ = "SCBusinessPlanProjections"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    acc_year = Column(Text, nullable=False, index=True)
    type = Column(Text, nullable=False)                                      # PC (from the business plan) / Lead (from open leads)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), nullable=False, index=True)   # 100% match
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)   # filled on a sixth of the rows. crm's 0 (its OpeningBalance placeholder item) -> null
    item_description = Column(Text, nullable=False, index=True)             # the product NAME, the key
    jc1_projection1 = Column(Double)
    jc2_projection1 = Column(Double)
    jc3_projection1 = Column(Double)
    jc4_projection1 = Column(Double)
    jc5_projection1 = Column(Double)
    jc6_projection1 = Column(Double)
    jc7_projection1 = Column(Double)
    jc8_projection1 = Column(Double)
    jc9_projection1 = Column(Double)
    jc10_projection1 = Column(Double)
    jc11_projection1 = Column(Double)
    jc12_projection1 = Column(Double)
    jc13_projection1 = Column(Double)
    jc1_projection2 = Column(Double)
    jc2_projection2 = Column(Double)
    jc3_projection2 = Column(Double)
    jc4_projection2 = Column(Double)
    jc5_projection2 = Column(Double)
    jc6_projection2 = Column(Double)
    jc7_projection2 = Column(Double)
    jc8_projection2 = Column(Double)
    jc9_projection2 = Column(Double)
    jc10_projection2 = Column(Double)
    jc11_projection2 = Column(Double)
    jc12_projection2 = Column(Double)
    jc13_projection2 = Column(Double)
    jc1_previous_projection1 = Column(Double)
    jc2_previous_projection1 = Column(Double)
    jc3_previous_projection1 = Column(Double)
    jc4_previous_projection1 = Column(Double)
    jc5_previous_projection1 = Column(Double)
    jc6_previous_projection1 = Column(Double)
    jc7_previous_projection1 = Column(Double)
    jc8_previous_projection1 = Column(Double)
    jc9_previous_projection1 = Column(Double)
    jc10_previous_projection1 = Column(Double)
    jc11_previous_projection1 = Column(Double)
    jc12_previous_projection1 = Column(Double)
    jc13_previous_projection1 = Column(Double)
    jc1_previous_projection2 = Column(Double)
    jc2_previous_projection2 = Column(Double)
    jc3_previous_projection2 = Column(Double)
    jc4_previous_projection2 = Column(Double)
    jc5_previous_projection2 = Column(Double)
    jc6_previous_projection2 = Column(Double)
    jc7_previous_projection2 = Column(Double)
    jc8_previous_projection2 = Column(Double)
    jc9_previous_projection2 = Column(Double)
    jc10_previous_projection2 = Column(Double)
    jc11_previous_projection2 = Column(Double)
    jc12_previous_projection2 = Column(Double)
    jc13_previous_projection2 = Column(Double)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    collector = relationship("Collectors")
    item = relationship("ItemMasters")



class FinancialYears(Base):
    """the accounting years (apr - mar). the projection needs it to find the previous year's cycles."""

    __tablename__ = "FinancialYears"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    name = Column(Text, nullable=False, unique=True)                          # 2026-2027, the acc_year every plan table uses
    effective_from = Column(Date, nullable=False)
    effective_to = Column(Date, nullable=False)
    is_active = Column(Boolean)                                              # the current year
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)



class TempItemmasters(Base):
    """products planned or quoted before they exist in the item master. a few later became real items
    (org_item_master_id). LeadProducts points at them (productid TEMPnnn -> temp_item_id); the lead plan
    (SCLeadTargets) does not today (is_temp_item is 0 on every row)."""

    __tablename__ = "TempItemmasters"

    temp_item_id = Column(BigInteger, primary_key=True, autoincrement=False)
    temp_itemname = Column(Text)
    segment1 = Column(Text)                                                  # spelling is messy (Performence chemicals, wtc, vooki), null on most
    segment2 = Column(Text)
    segment3 = Column(Text)
    segment4 = Column(Text)
    item_group = Column(Text)
    sale_type = Column(Text)
    status_id = Column(BigInteger)                                           # no master
    is_active = Column(Boolean)
    lead_id = Column(BigInteger)                                             # the lead it was raised for. soft, LeadDetails not loaded
    org_item_master_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"))   # the real item it became, a handful. crm's 0 -> null
    org_item_master_code = Column(Text)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    item = relationship("ItemMasters")



class SCLeadTargets(Base):
    """the lead plan: what a branch expects to sell to a LEAD, per product and journey cycle. same shape as the
    customer plan detail but keyed on the item id, one row per lead x item x year. the branch and the customer
    are not on the row - they sit on LeadDetails (collector by name, company = CustomerMasters.header_id).
    same status meaning as the customer plan: 4 = approved up to 2024-25, 5 = approved from 2025-26."""

    __tablename__ = "SCLeadTargets"

    header_id = Column(BigInteger, primary_key=True, autoincrement=False)
    lead_id = Column(BigInteger, ForeignKey("LeadDetails.lead_id"), nullable=False, index=True)   # the lead: its branch and customer are there. all match
    acc_yr = Column(Text, nullable=False, index=True)
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)          # the product, all match today. null when the row is on a temp item
    temp_item_id = Column(BigInteger, ForeignKey("TempItemmasters.temp_item_id"))         # set on stage from item_id when is_temp_item (none today)
    is_temp_item = Column(Boolean)
    potential_qty = Column(Numeric(18, 3))
    potential_value = Column(Numeric(18, 3))
    budget_qty = Column(Numeric(18, 3))
    budget_value = Column(Numeric(18, 3))
    jc1_week1_user_dfn_qty = Column(Double)                       # planned qty, first fortnight of the cycle
    jc2_week1_user_dfn_qty = Column(Double)
    jc3_week1_user_dfn_qty = Column(Double)
    jc4_week1_user_dfn_qty = Column(Double)
    jc5_week1_user_dfn_qty = Column(Double)
    jc6_week1_user_dfn_qty = Column(Double)
    jc7_week1_user_dfn_qty = Column(Double)
    jc8_week1_user_dfn_qty = Column(Double)
    jc9_week1_user_dfn_qty = Column(Double)
    jc10_week1_user_dfn_qty = Column(Double)
    jc11_week1_user_dfn_qty = Column(Double)
    jc12_week1_user_dfn_qty = Column(Double)
    jc13_week1_user_dfn_qty = Column(Double)
    jc1_week2_user_dfn_qty = Column(Double)                       # second fortnight
    jc2_week2_user_dfn_qty = Column(Double)
    jc3_week2_user_dfn_qty = Column(Double)
    jc4_week2_user_dfn_qty = Column(Double)
    jc5_week2_user_dfn_qty = Column(Double)
    jc6_week2_user_dfn_qty = Column(Double)
    jc7_week2_user_dfn_qty = Column(Double)
    jc8_week2_user_dfn_qty = Column(Double)
    jc9_week2_user_dfn_qty = Column(Double)
    jc10_week2_user_dfn_qty = Column(Double)
    jc11_week2_user_dfn_qty = Column(Double)
    jc12_week2_user_dfn_qty = Column(Double)
    jc13_week2_user_dfn_qty = Column(Double)
    jc1_qty_achieved = Column(Double)                             # sparse
    jc2_qty_achieved = Column(Double)
    jc3_qty_achieved = Column(Double)
    jc4_qty_achieved = Column(Double)
    jc5_qty_achieved = Column(Double)
    jc6_qty_achieved = Column(Double)
    jc7_qty_achieved = Column(Double)
    jc8_qty_achieved = Column(Double)
    jc9_qty_achieved = Column(Double)
    jc10_qty_achieved = Column(Double)
    jc11_qty_achieved = Column(Double)
    jc12_qty_achieved = Column(Double)
    jc13_qty_achieved = Column(Double)
    jc1_user_dfn_avg_sell_price = Column(Double)                  # value = qty x this. the _value columns are mixed units, not loaded
    jc2_user_dfn_avg_sell_price = Column(Double)
    jc3_user_dfn_avg_sell_price = Column(Double)
    jc4_user_dfn_avg_sell_price = Column(Double)
    jc5_user_dfn_avg_sell_price = Column(Double)
    jc6_user_dfn_avg_sell_price = Column(Double)
    jc7_user_dfn_avg_sell_price = Column(Double)
    jc8_user_dfn_avg_sell_price = Column(Double)
    jc9_user_dfn_avg_sell_price = Column(Double)
    jc10_user_dfn_avg_sell_price = Column(Double)
    jc11_user_dfn_avg_sell_price = Column(Double)
    jc12_user_dfn_avg_sell_price = Column(Double)
    jc13_user_dfn_avg_sell_price = Column(Double)
    jc1_status = Column(Integer)                                  # 1 pending .. 4 / 5 approved (era dependent), see the customer plan
    jc2_status = Column(Integer)
    jc3_status = Column(Integer)
    jc4_status = Column(Integer)
    jc5_status = Column(Integer)
    jc6_status = Column(Integer)
    jc7_status = Column(Integer)
    jc8_status = Column(Integer)
    jc9_status = Column(Integer)
    jc10_status = Column(Integer)
    jc11_status = Column(Integer)
    jc12_status = Column(Integer)
    jc13_status = Column(Integer)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    item = relationship("ItemMasters")
    temp_item = relationship("TempItemmasters")
    forecasts = relationship("SCLeadTargetJcDtls", back_populates="plan_line")
    lead = relationship("LeadDetails", back_populates="plans")



class SCLeadTargetJcDtls(Base):
    """rolling forecast on the lead plan, per plan row and journey cycle: qty expected next month and the month after."""

    __tablename__ = "SCLeadTargetJcDtls"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("SCLeadTargets.header_id"), index=True)   # the lead plan row. null when crm deleted it
    acc_year = Column(Text)
    jc_type = Column(BigInteger, ForeignKey("JourneyCalendars.line_id"), index=True)     # the journey cycle. -1 when crm has 0
    jc_nextmonth1_qty = Column(Double)
    jc_nextmonth2_qty = Column(Double)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    plan_line = relationship("SCLeadTargets", back_populates="forecasts")
    journey_cycle = relationship("JourneyCalendars")



class LeadDetails(Base):
    """the leads (crm's LMS): a prospect or an existing customer being worked for new business. the lead plan
    (SCLeadTargets) and the lead products hang off it; crm's projection gets the lead plan's branch and customer
    from here. one row per lead. rows are edited all the time and deleted, so snapshot."""

    __tablename__ = "LeadDetails"

    lead_id = Column(BigInteger, primary_key=True, autoincrement=False)
    lead_no = Column(Text)                                                   # LEAD-xxx, the visible number
    company = Column(BigInteger, ForeignKey("CustomerMasters.header_id"), index=True)   # crm's company = the customer or lead row in CustomerMasters (header_id), all but a few match
    collector = Column(Text)                                            # the branch as crm stores it (a name, sometimes with spaces)
    collector_id = Column(BigInteger, ForeignKey("Collectors.collector_id"), index=True)        # resolved from the name on stage. null when the name is gone (CHENNAI, ANKLESHWAR ..)
    user_mc_code = Column(Text, ForeignKey("MarketCircles.mc_code"), index=True)  # the user's circle, lower / trim, "unknown" when blank or no match
    assignleadchk = Column(BigInteger, ForeignKey("Users.line_id"))       # who works the lead. null when gone
    bill_to_site_use_id = Column(BigInteger, ForeignKey("CustomerSites.site_use_id"))   # filled once the lead is a customer, all match
    leadstatus = Column(BigInteger)                                      # 1 Prospect 2 Qualified 3 Visit 4 Credit Evaluation 5 Sampling 6 Quote 7 Converted 8 Close 9 Temporary Close
    approve_status = Column(BigInteger)                                      # 0 .. 3, 3 = rejected (crm's projection drops those)
    lead_close_status = Column(BigInteger)                                   # 0 open, 1 .. 4 closing states
    converted = Column(Boolean)
    is_temp_customer = Column(Boolean)                                       # the customer did not exist when the lead was raised
    segment1 = Column(Text)                                                  # General Chemicals / Performance Chemicals / NPD .. null on a fifth
    industry = Column(Text)
    industry_id = Column(BigInteger)                                         # no master loaded
    customername = Column(Text)                                             # as typed on the lead
    enquiry_id = Column(BigInteger)                                          # the enquiry it came from, soft
    lead_crm_soc_no = Column(BigInteger)                                       # the order the lead turned into. soft, only a fifth are loaded orders
    close_reason_id = Column(BigInteger, ForeignKey("Reasons.header_id"))    # why it was closed. 0 -> null
    approval_date = Column(DateTime)
    uploaded_date = Column(DateTime)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    customer = relationship("CustomerMasters")
    branch = relationship("Collectors")                                      # not "collector": that is the name column
    products = relationship("LeadProducts", back_populates="lead")
    plans = relationship("SCLeadTargets", back_populates="lead")



class LeadProducts(Base):
    """the products a lead is about, with the quantity the lead is for. crm's open-lead quantity on the projection
    screen = quantity on leads that are not converted or closed. product is an item, or a temp item (TEMPnnn)."""

    __tablename__ = "LeadProducts"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    leadid = Column(BigInteger, ForeignKey("LeadDetails.lead_id"), nullable=False, index=True)   # all match
    productid = Column(Text)                                                 # crm's text: an item id, or TEMPnnn, or 0
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), index=True)            # resolved on stage when productid is a real item
    temp_item_id = Column(BigInteger, ForeignKey("TempItemmasters.temp_item_id"))           # crm's column, 0 -> null. all match
    product_itemname = Column(Text)
    product_group = Column(Text)
    quantity = Column(Numeric(18, 2))                                        # the lead quantity - crm's open-lead qty
    quantity_value = Column(Numeric(18, 2))
    potential = Column(Numeric(18, 2))
    potential_value = Column(Numeric(18, 2))
    annualpotential = Column(Numeric(18, 2))
    prod_type_id = Column(BigInteger)                                        # no master
    consider_pcbusinessplan_flag = Column(Boolean)                           # a few hundred true
    sample_request_flag = Column(Boolean)
    creation_date = Column(DateTime)
    last_update_date = Column(DateTime)

    lead = relationship("LeadDetails", back_populates="products")
    item = relationship("ItemMasters")


class PcBusinessPlanReopens(Base):
    """every reopen of an approved customer plan: which user, which market circle, which cycle, when. one row per
    event. crm keeps only today's plan; this log says how often and when a cycle was opened again for editing."""

    __tablename__ = "PcBusinessPlanReopens"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    acc_year = Column(Text, nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("Users.line_id"), index=True)             # who reopened, 100% match
    mc_code = Column(Text, ForeignKey("MarketCircles.mc_code"), index=True)            # the circle, lower / trim, 'unknown' when no match
    jc_type = Column(Text, nullable=False)                                              # the cycle as text: JC1 .. JC13 (not the calendar id)
    is_reopen = Column(Boolean)
    created_by = Column(BigInteger)
    creation_date = Column(DateTime, index=True)                                        # when
    last_updated_by = Column(BigInteger)
    last_update_date = Column(DateTime)

    user = relationship("Users")
    market_circle = relationship("MarketCircles")


class SCBusinessPlanLogs(Base):
    """field-level edit log of the customer plan: the old and new fortnight quantities, price and next-cycle
    forecasts per plan header x cycle. sparse - only some edit paths in crm write it (mid 2025 on)."""

    __tablename__ = "SCBusinessPlanLogs"

    line_id = Column(BigInteger, primary_key=True, autoincrement=False)
    header_id = Column(BigInteger, ForeignKey("SCBusinessMonthlyPlanHdrs.header_id"), index=True)   # the plan header, 100% match
    type_id = Column(Integer)                                                           # 1 / 2, no master
    jc_type = Column(Text)                                                              # the cycle as text: JC1 .. JC13
    old_user_dfn_avg_sell_price = Column(Double)
    old_week1_user_dfn_qty = Column(Double)
    old_week2_user_dfn_qty = Column(Double)
    old_nextmonth1_qty = Column(Double)
    old_nextmonth2_qty = Column(Double)
    old_updated_by = Column(BigInteger)
    new_user_dfn_avg_sell_price = Column(Double)
    new_week1_user_dfn_qty = Column(Double)
    new_week2_user_dfn_qty = Column(Double)
    new_nextmonth1_qty = Column(Double)
    new_nextmonth2_qty = Column(Double)
    remarks = Column(Text)
    is_te_edited = Column(Boolean)                                                      # edited by the territory executive
    is_bh_edited = Column(Boolean)                                                      # edited by the business head
    mail_flag = Column(Text)
    mail_sent_date = Column(DateTime)
    created_by = Column(BigInteger)
    creation_date = Column(DateTime, index=True)                                        # when the edit happened
    last_updated_by = Column(BigInteger)
    last_update_date = Column(DateTime)
    old_user_dfn_qty = Column(BigInteger)
    new_user_dfn_qty = Column(BigInteger)

    plan_header = relationship("SCBusinessMonthlyPlanHdrs")


# ---------------------------------------------------------------------------------------------------------------
# our own tables (not mirrored from crm): the plan's history and the name aliases. never truncated by the etl.
# ---------------------------------------------------------------------------------------------------------------

class PlanSnapshot(Base):
    """the customer plan as it stood on a date: one row per snapshot date x plan header x cycle that had a
    quantity. crm keeps only today's plan, so this is how "what did the plan say before the cycle ran" is
    answered. backfilled once from the dated copies crm holds (SCBusinessMonthlyPlanDtls_* with the Hdrs copy of
    the same day for the status), then appended by the etl at the two moments that matter for a cycle: the hand-off,
    when the approved plan goes to the planners, and the publish, when it goes to oracle (app/repositories/plan_history.py)."""

    __tablename__ = "plan_snapshot"

    snapshot_date = Column(Date, primary_key=True)
    plan_id = Column(BigInteger, primary_key=True)                                      # the plan header. no fk: crm deletes headers
    jc_no = Column(Integer, primary_key=True)
    snapshot_source = Column(Text, nullable=False)                                      # 'etl', or the crm copy the quantities came from
    snapshot_reason = Column(Text)                                                      # handoff / publish / cycle / crm copy - why this snapshot exists
    snapshot_jc_id = Column(BigInteger, index=True)                                     # the cycle running on the snapshot date
    target_jc_id = Column(BigInteger, index=True)                                       # the cycle the handoff / publish belongs to
    acc_year = Column(Text, nullable=False, index=True)
    customer_id = Column(BigInteger)
    collector_id = Column(BigInteger)
    name_key = Column(Text, index=True)                                                 # the product name key, resolved like the views
    product_name = Column(Text)
    week1_qty = Column(Double)
    week2_qty = Column(Double)
    plan_qty = Column(Double, nullable=False)
    avg_sell_price = Column(Double)
    status = Column(Integer)                                                            # the workflow code on the status date
    is_approved = Column(Boolean)
    status_source = Column(Text)                                                        # where the status came from when copied on another day
    status_date = Column(Date)
    taken_at = Column(DateTime, server_default=func.now())


class ProjectionSnapshot(Base):
    """the published projection as it stood on a date: one row per snapshot date x product name x branch x cycle
    x type. the plan's own history is in plan_snapshot; this is what crm actually handed to oracle, which is the
    number supply worked from."""

    __tablename__ = "projection_snapshot"

    snapshot_date = Column(Date, primary_key=True)
    name_key = Column(Text, primary_key=True)
    collector_id = Column(BigInteger, primary_key=True)
    jc_no = Column(Integer, primary_key=True)
    plan_type = Column(Text, primary_key=True)                                          # PC / Lead
    snapshot_source = Column(Text, nullable=False)                                      # 'etl', or the crm copy
    snapshot_reason = Column(Text)                                                      # handoff / publish / crm copy
    target_jc_id = Column(BigInteger, index=True)
    acc_year = Column(Text, nullable=False, index=True)
    projection1_qty = Column(Double)
    projection2_qty = Column(Double)
    projection_qty = Column(Double, nullable=False)
    taken_at = Column(DateTime, server_default=func.now())


class PlanApprovalHistory(Base):
    """when a plan header x cycle was first seen submitted and first seen approved, from the dated header copies
    crm holds (monthly since mid 2022) and the etl's snapshots since. one row per plan header x cycle that was
    ever submitted. the copies bracket the dates, so first_seen_* is "by this date", not the exact day."""

    __tablename__ = "plan_approval_history"

    plan_id = Column(BigInteger, primary_key=True)
    jc_no = Column(Integer, primary_key=True)
    acc_year = Column(Text, nullable=False, index=True)
    first_seen_submitted = Column(Date)                                                 # earliest copy with a status other than 1
    first_seen_approved = Column(Date)                                                  # earliest copy with the approved status (era rule)
    last_status = Column(Integer)
    last_seen = Column(Date, nullable=False)
    copies_seen = Column(Integer, nullable=False)


class PlanNameAlias(Base):
    """plan spellings that are not in the item master, mapped by hand to the item they mean (e.g. 'LG BW 400 R'
    -> item 'BW 400 R'). dim_plan_product applies these before its own spelling match. kept in pgadmin."""

    __tablename__ = "plan_name_alias"

    name_key = Column(Text, primary_key=True)                                           # the plan spelling, lower case and trimmed
    item_id = Column(BigInteger, ForeignKey("ItemMasters.item_id"), nullable=False)      # the item it means
    note = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    item = relationship("ItemMasters")
