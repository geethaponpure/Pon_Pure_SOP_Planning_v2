from fastapi import FastAPI
from .core.database import Base,engine
from .api.deps import get_db
from .models.metadata import crm_sync_table
from .models.customer_master import CustomerMasters, CustomerSites, Collectors, MarketCircles, TempCustomers, ArCustomers
from .models.items_master import ItemCategories, ItemMasters, PurchaseRequisitionPtoPts
from .models.sales_order_soc import SaleOrderHdrs, SaleOrderDtls, SocPendingDetails
from .models.dispatch_master import DeliveryFroms, Reasons, Dispatches, DispatchDetails, Schedules, SocCancelDetails
from .models.quotation_master import QuotationStatus, QuotationHdrs, QuotationDtls
from .models.business_plan import (JourneyCalendars, JcWeeklyCalendars, SCBusinessMonthlyPlanHdrs, SCBusinessMonthlyPlanDtls, SCBusinessMonthlyPlanJCDtls,
                                   SPBusinessPlanActualSales, SCBusinessPlanProjections,
                                   FinancialYears, TempItemmasters, SCLeadTargets, SCLeadTargetJcDtls, LeadDetails, LeadProducts,
                                   PcBusinessPlanReopens, SCBusinessPlanLogs, PlanSnapshot, ProjectionSnapshot,
                                   PlanApprovalHistory, PlanNameAlias)
from .models.purchase_master import (ApprovalStatus, ApTermsTls, ApSuppliers, ApSupplierSitesAlls,
                                     BiPoDetails, BiGrnDetails, PurchaseRequisitionHdrs, PurchaseRequisitionDtls)
from .models.inventory_master import BiStockDetail, InventoryOrgs, ItemInventoryOrgMappings, BiCollectorInventoryOrgMapping
from .models.user_and_scope import (Users, Roles, UserRoles, UserMarketCircleMappings, UserCollectorMappings,
                                    UserCustomerMappings, CollectorMailMappings, TechnicalUserSegmentMappings)
from .models.manufacturing import BIRawMaterialConsumptions
from .models.ingest import IngestFiles, IngestRejects, RAW_MODELS
from .repositories.views import create_views
from contextlib import asynccontextmanager
from .core.config import settings
from sqlalchemy import text
from .api.v1.ingest_api import user_router
from .ingest.templates import write_templates



@asynccontextmanager
async def lifespan(app:FastAPI):

    print("Application starting.......................")

    async with engine.begin() as conn:

        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.POSTGRES_SCHEMA}"'))

        await conn.execute(text(f'SET search_path TO "{settings.POSTGRES_SCHEMA}"'))

        await conn.execute(text(f"SET lock_timeout = '{settings.PG_LOCK_TIMEOUT}'"))

        await conn.run_sync(Base.metadata.create_all)

        await create_views(conn)

    # the downloadable excel templates, created from the specs when missing (existing ones are kept)
    write_templates()

    yield

    await engine.dispose()
    print("Application closing.........................")
    


app = FastAPI(lifespan=lifespan)

app.include_router(user_router)