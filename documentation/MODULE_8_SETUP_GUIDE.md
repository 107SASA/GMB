# Module 8: Dashboard Setup & Testing Guide

## Setup
Since the dashboard relies entirely on the databases built in Modules 1-7, there are no new environment variables or webhooks to configure! 

## Verification Steps
1. Navigate to your local server: `http://localhost:3000/dashboard`
2. You will see the new unified **AI Command Center**.
3. **Verify Metrics**: Look at the 6 top metric cards. If your `Content Buffer` is less than 7 days, it should highlight in red as a warning.
4. **Verify Charts**: Hover over the Recharts SVG components (Leads Line Chart, Source Donut Chart) to ensure the Tooltips render smoothly.
5. **Verify Live Updates**:
   - Open a new tab and go to the CRM (`/dashboard/crm`).
   - Create a new Dummy Lead via the button.
   - Go back to the Dashboard tab and click the manual "Refresh" button in the top right.
   - The `Total Leads` metric and the `Recent Leads` panel should update instantly!

## Performance Testing
To ensure the MongoDB aggregations are optimized:
1. Open the Network tab in Chrome DevTools.
2. Refresh the page.
3. Observe the `stats?businessId=...` request. Even with a local MongoDB connection, the response time should be well under `300ms` due to the parallel `Promise.all` execution strategy.
