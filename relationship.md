# CRM Customer_master Data Model

## 1. Overview

The CRM data model consists of four main tables:

- `Collectors`
- `MarketCircles`
- `CustomerSites`
- `CustomerMasters`

The logical business relationship is:

```text
CustomerMasters
       │
       │ 1 : N
       │ header_id
       ▼ 
CustomerSites
       │
       │ N : 1
       │ mc_code
       ▼
MarketCircles
       │
       │ N : 1
       │ collector_id
       ▼
Collectors