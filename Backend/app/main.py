from fastapi import FastAPI
from .core.database import Base, get_db, engine
from .models.metadata import crm_sync_table
from .models.customer_master import CustomerMasters, CustomerSites, Collectors, MarketCircles
from .models.items_master import ItemCategories, ItemMasters, PurchaseRequisitionPtoPts
from .models.sales_order_soc import SaleOrderHdrs, SaleOrderDtls, SocPendingDetails
from .models.dispatch_master import DeliveryFroms, Dispatches, DispatchDetails, Schedules, SocCancelDetails
from .models.quotation_master import QuotationStatus, QuotationHdrs, QuotationDtls
from .models.business_plan import JourneyCalendars, SCBusinessMonthlyPlanHdrs, SCBusinessMonthlyPlanDtls, SCBusinessMonthlyPlanJCDtls
from .models.purchase_master import ApSuppliers, BiPoDetails, PurchaseRequisitionHdrs, PurchaseRequisitionDtls
from .models.inventory_master import BiStockDetail, InventoryOrgs, ItemInventoryOrgMappings, BiCollectorInventoryOrgMapping
from .models.user_and_scope import (Users, Roles, UserRoles, UserMarketCircleMappings, UserCollectorMappings,
                                    UserCustomerMappings, CollectorMailMappings, TechnicalUserSegmentMappings)
from contextlib import asynccontextmanager
from .core.config import settings
from sqlalchemy import text



@asynccontextmanager
async def lifespan(app:FastAPI):

    print("Application starting.......................")

    async with engine.begin() as conn:

        await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.POSTGRES_SCHEMA}"'))

        await conn.execute(text(f'SET search_path TO "{settings.POSTGRES_SCHEMA}"'))

        await conn.run_sync(Base.metadata.create_all)

    yield

    await engine.dispose()
    print("Application closing.........................")
    


app = FastAPI(lifespan=lifespan)