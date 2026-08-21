EKSBASE Dual Date Filters + Yellow/White Theme

Date filters:
1. Sales Date = salesTime
   - Enabled by default
   - Default period = Today

2. Activation Date = resignTime
   - Disabled by default
   - Can be enabled independently

Both filters can be used together:
Sales Date condition AND Activation Date condition.

Quick periods:
- Yesterday
- Today
- Week (Monday through today)
- Month (1st of current month through today)
- Customize

Behavior:
- KPI cards follow both enabled date filters.
- Area drill-down follows both enabled date filters.
- Model/Color data follows both enabled date filters.
- Fuzzy search follows both enabled date filters.
- Search-selected active filters continue to work.
- Excel export follows both enabled date filters and current dashboard/search scope.
- Current inventory remains a current stock snapshot; the date filters determine Sell-out/Sales Amount activity associated with the inventory view.

Theme:
- Yellow + White
- Dark text for readability
- Yellow KPI cards, active buttons, table highlights, search/filter highlights

Replace:

BACKEND
1. src/database/serialRepository.js
2. src/services/kingdeeService.js
3. src/services/dashboardService.js
4. src/controllers/dashboardController.js
5. src/routes/dashboard.js

FRONTEND
6. index.html
7. css/styles.css
8. js/app.js

No new npm package is required.
