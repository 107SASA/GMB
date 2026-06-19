# Module 8: AI Command Center Architecture

## Overview
Module 8 acts as the central hub of the platform, pulling together data from the CRM, Review Management, Scheduling, and AI systems into a single executive dashboard.

## Aggregation Strategy
Instead of making multiple frontend API calls (e.g., fetching `/api/leads`, `/api/reviews`, etc.), the dashboard relies on a **Unified Aggregation API** (`GET /api/dashboard/stats`).

### Why Unified Aggregation?
1. **Network Efficiency**: One payload contains all necessary chart data, metrics, and panels.
2. **Database Performance**: By leveraging MongoDB `$facet` and `Promise.all()`, we can query millions of documents across 5 different collections simultaneously in a fraction of a second.
3. **Multi-Tenant Safety**: The query filters `businessId` at the top level of the pipeline, ensuring complete data isolation.

## Component Architecture
- **DashboardHeader**: Contains the business identity and refresh controls.
- **MetricsGrid**: 6 high-level KPI cards with automatic trend/alert styling (e.g., low buffer alerts).
- **ChartsSection**: Utilizes `recharts` to render scalable, responsive SVG charts for growth trends.
- **QuickPanels**: Action-oriented mini-components (e.g., Today's Follow-Ups, Content Calendar) designed to drive the user into the deeper modules.
