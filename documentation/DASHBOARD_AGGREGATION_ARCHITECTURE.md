# Dashboard Aggregation Architecture

## Aggregation Pipelines
Instead of fetching thousands of raw documents into Node.js, the backend utilizes highly optimized Mongoose/MongoDB Aggregation pipelines (`$facet`, `$group`, `$match`).

### Lead Aggregations
- **Metrics:** Sums total leads and counts the pipeline stage `Converted`.
- **Source Donut:** Groups leads by `source`.
- **Growth Chart:** Groups leads by `createdAt` day format over the last 30 days.

### Review Aggregations
- **Metrics:** Sums total, averages rating, and counts unanswered reviews.
- **Star Distribution:** Groups by 1-5 stars for bar charts.

### Social Aggregations
- **Metrics:** Counts `published` vs `scheduled` statuses.
- **Calendar Panel:** Fetches the next 7 days of scheduled posts.
- **Buffer Calculation:** Finds the *furthest* scheduled post and calculates the delta in days against the current date.
