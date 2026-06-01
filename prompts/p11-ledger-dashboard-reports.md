# P11 — Vendor Ledger + Dashboard + Reports

Read CLAUDE.md first.
These are all read-only display features. Implement all 3 in one session.

## PART A: Vendor Ledger

Backend — add to apps/api/src/routes/reports.ts:

GET /reports/vendor-ledger
- requireRole('admin'), query: vendorId (required), year (required)
- Return 12 months always (zero-fill missing months):
  [{ month, year, invoiced, reconciled, paid, pending }]
- Each row also has grnBreakdown: [{ grnNumber, invoiceNumber, amount, status, paymentRef, paymentDate }]

Frontend — apps/web/src/pages/admin/VendorLedgerPage.tsx:
- Vendor selector + Year selector + "Load" button
- Annual table: Month | Invoiced | Reconciled | Paid | Pending
  Pending > 0 → amber; Pending = 0 → green
  Totals row at bottom
- Each row expandable → GRN breakdown sub-table
- Export Excel button (use SheetJS client-side)
- Export PDF button (window.print() with print CSS)

## PART B: Admin Dashboard

Backend — add to apps/api/src/routes/reports.ts:

GET /reports/dashboard-stats
- requireRole('admin')
- Return single response:
  { totalInvoices, pendingReview, reconciledThisMonth, paidThisMonthAmount,
    monthlyChart: [{ month, year, uploaded, reconciled, paid }] (last 12),
    vendorSummaryCurrentMonth: [{ vendorId, vendorName, invoiced, reconciled, paid, pending }],
    recentActivity: [{ action, entityType, userName, createdAt }] (last 20) }

Frontend — apps/web/src/pages/admin/DashboardPage.tsx:
- 4 summary cards: Total Invoices | Pending Review (amber if >0) | Reconciled This Month | Paid This Month (₹)
- Recharts BarChart: 12 months, 3 bars (Uploaded/Reconciled/Paid), tooltip on hover
- Vendor summary TanStack Table: Vendor | Invoiced | Reconciled | Paid | Pending (click vendor → /admin/ledger?vendorId=X)
- Recent activity list: icon + description + time ago, auto-refresh every 60s

## PART C: Reports

Backend — add to apps/api/src/routes/reports.ts:

GET /reports/reconciliation-summary — query: month, year
GET /reports/pending-invoices — query: departmentId (optional)
GET /reports/audit-log — query: userId, entityType, action, dateFrom, dateTo, page, limit

Frontend — apps/web/src/pages/admin/ReportsPage.tsx:
Tabs: Reconciliation Summary | Pending Invoices | Audit Log

Tab 1: Month/Year picker + Generate → summary cards + By Vendor table + By Dept table + Export Excel
Tab 2: Department filter → table (Invoice No | Vendor | Dept | Amount | Status | Days Pending)
  >30 days: amber row; >60 days: red row. Export Excel.
Tab 3: Filters (User/Action/Date) → table (Timestamp | User | Action | Entity | Details). Export Excel.

Shared utility: apps/web/src/lib/exportToExcel.ts
exportToExcel(filename: string, headers: string[], rows: any[][]): void
Use SheetJS to trigger browser download.
